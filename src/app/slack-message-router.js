import { normalizeControlCommand } from "./control-command.js";
import { looksLikeCounterQuestion } from "./counter-question.js";

const CONTROL_CONFIRMATIONS = {
  start: "좋아. 도망치진 않겠다는 거네. 준비되면 첫 질문부터 받아.",
  pause: "흥, 잠깐 숨 돌리겠다는 거지. 도망간 건 아니라고 믿어보지.",
  resume: "다시 오네. 좋아. 이번엔 얼버무리지 마.",
  end: "여기까지 하겠다는 거군. 이번 판은 닫아두지.",
};

const ROOT_REPLY_REDIRECT_TEXT =
  "뜬금없이 무슨 소리야? 그 답변은 네가 열어둔 스레드에 달아. 거기서 끝까지 보자고.";
const DIRECT_QUESTION_FAILURE_TEXT =
  "흠, 지금은 응답이 꼬였어. 같은 스레드에 다시 던져.";
const THREAD_FAILURE_TEXT =
  "흥, 판정이 잠깐 꼬였네. 같은 스레드에 다시 답해.";
const CONTROL_FAILURE_TEXT =
  "명령 처리부터 꼬였네. 같은 스레드에 다시 던져.";

const DIRECT_QUESTION_PATTERN =
  /[?？]$|^(왜|어떻게|뭐|무엇|언제|어디|누구|what|why|how|can|is|are|do|does|did|should|would|could)\b|(?:설명|알려|말해|비교|정리|요약|차이|의미|원리|구조).*(?:해|해줘|해주세요|해봐|줘)$/i;

export class SlackMessageRouter {
  constructor({ store, tutorBot, llmRunner, slackClient, now = () => new Date(), onError = console.error }) {
    this.store = store;
    this.tutorBot = tutorBot;
    this.llmRunner = llmRunner;
    this.slackClient = slackClient;
    this.now = now;
    this.onError = onError;
  }

  async handleMessageEvent(event) {
    if (!shouldHandleMessageEvent(event)) {
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
      try {
        const now = this.now();
        await this.tutorBot.handleControlInput(event.text, now);
        if (command === "start") {
          await this.tutorBot.dispatchNextQuestion(now);
        }
        await this.slackClient.postThreadReply(event.ts, CONTROL_CONFIRMATIONS[command]);
      } catch (error) {
        this.onError(error, event);
        await this.slackClient.postThreadReply(event.ts, CONTROL_FAILURE_TEXT);
      }
      return null;
    }

    const openThreads = await this.store.listOpenThreads();
    if (openThreads.length > 0 && !looksLikeDirectQuestion(event.text)) {
      await this.slackClient.postThreadReply(event.ts, ROOT_REPLY_REDIRECT_TEXT);
      return null;
    }

    try {
      const reply = await this.llmRunner.runTask("direct_question", {
        text: event.text,
      });
      await this.slackClient.postThreadReply(event.ts, reply.text);
    } catch (error) {
      this.onError(error, event);
      await this.slackClient.postThreadReply(event.ts, DIRECT_QUESTION_FAILURE_TEXT);
    }

    return null;
  }

  async #handleThreadReply(event) {
    try {
      return await this.tutorBot.handleThreadMessage({
        threadTs: event.thread_ts,
        text: event.text,
        now: this.now(),
      });
    } catch (error) {
      this.onError(error, event);
      await this.slackClient.postThreadReply(event.thread_ts, THREAD_FAILURE_TEXT);
      return null;
    }
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
  return DIRECT_QUESTION_PATTERN.test(normalized) || looksLikeCounterQuestion(normalized);
}
