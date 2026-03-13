import { normalizeControlCommand } from "./control-command.js";
import { looksLikeCounterQuestion } from "./counter-question.js";
import { getDirectQaShortcutReply } from "./direct-qa-shortcut.js";
import { createThreadState } from "../domain/thread-policy.js";
import { previewText } from "../debug/debug-logger.js";

const ROOT_REPLY_REDIRECT_TEXT =
  "너 스레드가 뭔지 몰라? 엉뚱한 데다 혼잣말하지 말고, 원래 대화하던 스레드에 가서 제대로 대답해. 기본적인 툴 사용법까지 내가 하나하나 가르쳐줘야 돼? 귀찮게 진짜.";
const DIRECT_QUESTION_FAILURE_TEXT =
  "...아, 시스템 상태가 왜 이래. 네 조잡한 질문 수준에 내 뇌가 굳이 대답할 가치를 못 느꼈나 본데. 나중에 다시 물어봐. 지금은 굳이 처리해주기 귀찮으니까.";
const THREAD_FAILURE_TEXT =
  "...아, 시스템 상태가 왜 이래. 네 조잡한 질문 수준에 내 뇌가 굳이 대답할 가치를 못 느꼈나 본데. 나중에 다시 물어봐. 지금은 굳이 처리해주기 귀찮으니까.";

const DIRECT_QUESTION_PATTERN =
  /[?？]$|^(왜|어떻게|뭐|무엇|언제|어디|누구|what|why|how|can|is|are|do|does|did|should|would|could)\b|(?:설명|알려|말해|비교|정리|요약|차이|의미|원리|구조|뜻).*(?:해|해줘|해주세요|해봐|줘)$|(?:뭐야|뭐지|무슨 뜻이야|무슨 뜻이지|의미가 뭐야|원리가 뭐야)$/i;

const NOOP_LOGGER = {
  debug() {},
  error() {},
};

export class SlackMessageRouter {
  constructor({
    store,
    tutorBot,
    llmRunner,
    slackClient,
    now = () => new Date(),
    onError = console.error,
    onControlCommandApplied = async () => {},
    onStudyThreadClosed = async () => {},
    logger = NOOP_LOGGER,
  }) {
    this.store = store;
    this.tutorBot = tutorBot;
    this.llmRunner = llmRunner;
    this.slackClient = slackClient;
    this.now = now;
    this.onError = onError;
    this.onControlCommandApplied = onControlCommandApplied;
    this.onStudyThreadClosed = onStudyThreadClosed;
    this.logger = logger;
  }

  async handleMessageEvent(event) {
    if (!shouldHandleMessageEvent(event)) {
      this.logger.debug("router.message_ignored", {
        channel: event?.channel ?? null,
        ts: event?.ts ?? null,
        type: event?.type ?? null,
        channelType: event?.channel_type ?? null,
        subtype: event?.subtype ?? null,
        botId: event?.bot_id ?? null,
        hasText: typeof event?.text === "string" && Boolean(event.text.trim()),
        hasThreadTs: Boolean(event?.thread_ts),
        user: event?.user ?? null,
      });
      return null;
    }

    if (isThreadReply(event)) {
      return this.#handleThreadReply(event);
    }

    return this.#handleRootDirectMessage(event);
  }

  async #handleRootDirectMessage(event) {
    const command = normalizeControlCommand(event.text);

    if (command) {
      this.logger.debug("router.route.control", {
        channel: event.channel,
        ts: event.ts,
        command,
      });
      try {
        const session = await this.tutorBot.applyControlCommand(command, this.now());
        await this.onControlCommandApplied(command, session);
      } catch (error) {
        this.onError(error, event);
      }
      return null;
    }

    const shortcutReply = getDirectQaShortcutReply(event.text);
    if (shortcutReply) {
      this.logger.debug("router.route.direct_shortcut", {
        channel: event.channel,
        ts: event.ts,
        textPreview: previewText(event.text),
      });
      await this.#startDirectQaThread({
        threadTs: event.ts,
        text: event.text,
        replyText: shortcutReply,
        openedAt: this.now(),
      });
      return null;
    }

    if (await this.#isInactiveSession()) {
      this.logger.debug("router.route.inactive_root", {
        channel: event.channel,
        ts: event.ts,
        textPreview: previewText(event.text),
      });
      return null;
    }

    const openThreads = await this.store.listOpenThreads();

    if (openThreads.length > 0 && !looksLikeDirectQuestion(event.text)) {
      this.logger.debug("router.route.redirect_to_thread", {
        channel: event.channel,
        ts: event.ts,
        openThreadCount: openThreads.length,
        textPreview: previewText(event.text),
      });
      await this.slackClient.postThreadReply(event.ts, ROOT_REPLY_REDIRECT_TEXT);
      return null;
    }

    this.logger.debug("router.route.direct_question", {
      channel: event.channel,
      ts: event.ts,
      textPreview: previewText(event.text),
    });
    try {
      const threadTs = event.ts;
      const openedAt = this.now();
      await this.#startDirectQaThread({
        threadTs,
        text: event.text,
        openedAt,
        replyFactory: async () => this.llmRunner.runTask("direct_question", {
          text: event.text,
        }),
      });
    } catch (error) {
      this.onError(error, event);
      await this.slackClient.postThreadReply(event.ts, DIRECT_QUESTION_FAILURE_TEXT);
    }

    return null;
  }

  async #handleThreadReply(event) {
    const command = normalizeControlCommand(event.text);
    if (command) {
      this.logger.debug("router.route.control_thread", {
        channel: event.channel,
        ts: event.ts,
        threadTs: event.thread_ts,
        command,
      });
      try {
        const session = await this.tutorBot.applyControlCommand(command, this.now());
        await this.onControlCommandApplied(command, session);
      } catch (error) {
        this.onError(error, event);
      }
      return null;
    }

    if (await this.#isInactiveSession()) {
      this.logger.debug("router.route.inactive_thread", {
        channel: event.channel,
        ts: event.ts,
        threadTs: event.thread_ts,
        textPreview: previewText(event.text),
      });
      return null;
    }

    const thread = await this.store.getThread(event.thread_ts);

    if (thread?.kind === "direct_qa" && thread?.status === "open") {
      return this.#handleDirectQaThreadReply(event, thread);
    }

    this.logger.debug("router.route.thread_reply", {
      channel: event.channel,
      ts: event.ts,
      threadTs: event.thread_ts,
      textPreview: previewText(event.text),
    });
    try {
      const result = await this.tutorBot.handleThreadMessage({
        threadTs: event.thread_ts,
        text: event.text,
        now: this.now(),
      });
      if (result?.shouldScheduleNextQuestion) {
        await this.onStudyThreadClosed(result);
      }
      return result;
    } catch (error) {
      this.onError(error, event);
      await this.slackClient.postThreadReply(event.thread_ts, THREAD_FAILURE_TEXT);
      return null;
    }
  }

  async #isInactiveSession() {
    if (typeof this.store.getSession !== "function") {
      return false;
    }

    const session = await this.store.getSession();
    return session?.state === "inactive";
  }

  async #handleDirectQaThreadReply(event, thread) {
    const activeThread = normalizeDirectQaThread(thread);
    await this.store.saveThread(activeThread);

    this.logger.debug("router.route.direct_qa_thread_reply", {
      channel: event.channel,
      ts: event.ts,
      threadTs: event.thread_ts,
      textPreview: previewText(event.text),
    });

    const shortcutReply = getDirectQaShortcutReply(event.text);
    if (shortcutReply) {
      await this.#appendDirectQaExchange({
        threadTs: activeThread.slackThreadTs,
        userText: event.text,
        assistantText: shortcutReply,
        now: this.now(),
      });
      await this.slackClient.postThreadReply(activeThread.slackThreadTs, shortcutReply);
      return null;
    }

    const history = (await this.store.listDirectQaMessages(activeThread.slackThreadTs))
      .map(({ role, text }) => ({ role, text }));
    const now = this.now();
    await this.store.saveDirectQaMessage({
      threadTs: activeThread.slackThreadTs,
      role: "user",
      text: event.text,
      recordedAt: now,
    });

    try {
      const rawReply = await this.llmRunner.runTask("direct_thread_turn", {
        thread: activeThread,
        history,
        text: event.text,
        ...(activeThread.codexSessionId ? { codexSessionId: activeThread.codexSessionId } : {}),
      });
      const reply = normalizeDirectQaReply(rawReply);
      await this.slackClient.postThreadReply(activeThread.slackThreadTs, reply.text);
      await this.store.saveDirectQaMessage({
        threadTs: activeThread.slackThreadTs,
        role: "assistant",
        text: reply.text,
        recordedAt: this.now(),
      });
      await this.store.saveThread(applyDirectQaReplyState(activeThread, reply));
      return null;
    } catch (error) {
      this.onError(error, event);
      await this.slackClient.postThreadReply(activeThread.slackThreadTs, DIRECT_QUESTION_FAILURE_TEXT);
      return null;
    }
  }

  async #startDirectQaThread({ threadTs, text, replyFactory, replyText, openedAt }) {
    const initialThread = createThreadState({
      slackThreadTs: threadTs,
      topicId: null,
      openedAt,
      kind: "direct_qa",
    });
    await this.store.saveThread(initialThread);

    await this.store.saveDirectQaMessage({
      threadTs,
      role: "user",
      text,
      recordedAt: openedAt,
    });

    const reply = normalizeDirectQaReply(replyText
      ? { text: replyText, nextState: "open", challengePrompt: null, codexSessionId: null }
      : await replyFactory());
    await this.slackClient.postThreadReply(threadTs, reply.text);
    await this.store.saveDirectQaMessage({
      threadTs,
      role: "assistant",
      text: reply.text,
      recordedAt: this.now(),
    });
    await this.store.saveThread(applyDirectQaReplyState(initialThread, reply));
  }

  async #appendDirectQaExchange({ threadTs, userText, assistantText, now }) {
    await this.store.saveDirectQaMessage({
      threadTs,
      role: "user",
      text: userText,
      recordedAt: now,
    });
    await this.store.saveDirectQaMessage({
      threadTs,
      role: "assistant",
      text: assistantText,
      recordedAt: this.now(),
    });
  }
}

function shouldHandleMessageEvent(event) {
  return Boolean(
    event
      && event.type === "message"
      && event.channel_type === "im"
      && !event.bot_id
      && !event.subtype
      && typeof event.text === "string"
      && event.text.trim(),
  );
}

function isThreadReply(event) {
  return Boolean(event.thread_ts && event.thread_ts !== event.ts);
}

function looksLikeDirectQuestion(text) {
  const normalized = text.trim();
  return DIRECT_QUESTION_PATTERN.test(normalized)
    || looksLikeCounterQuestion(normalized);
}

function applyDirectQaReplyState(thread, reply) {
  if (reply?.nextState === "awaiting_answer") {
    return {
      ...thread,
      mode: "direct_qa",
      directQaState: "awaiting_answer",
      lastAssistantPrompt: reply.challengePrompt ?? reply.text,
      lastChallengePrompt: reply.challengePrompt ?? reply.text ?? thread.lastChallengePrompt ?? null,
      codexSessionId: reply.codexSessionId ?? thread.codexSessionId ?? null,
    };
  }

  return {
    ...thread,
    mode: "direct_qa",
    directQaState: "open",
    lastAssistantPrompt: null,
    lastChallengePrompt: null,
    codexSessionId: reply?.codexSessionId ?? thread.codexSessionId ?? null,
  };
}

function normalizeDirectQaReply(reply) {
  if (typeof reply === "string") {
    return {
      text: reply,
      nextState: "open",
      challengePrompt: null,
      codexSessionId: null,
    };
  }

  const nextState = reply?.nextState === "awaiting_answer"
    || (reply?.nextState !== "open" && reply?.expectsAnswer === true)
    || (reply?.nextState !== "open" && reply?.nextState !== "awaiting_answer" && reply?.challengePrompt)
    ? "awaiting_answer"
    : "open";

  return {
    text: reply?.text ?? "",
    nextState,
    challengePrompt: reply?.challengePrompt ?? null,
    codexSessionId: reply?.codexSessionId ?? null,
  };
}

function normalizeDirectQaThread(thread) {
  return {
    ...thread,
    mode: "direct_qa",
    directQaState: thread.directQaState === "awaiting_answer" ? "awaiting_answer" : "open",
    lastAssistantPrompt: thread.lastAssistantPrompt ?? null,
    lastChallengePrompt: thread.lastChallengePrompt ?? null,
    codexSessionId: thread.codexSessionId ?? null,
  };
}
