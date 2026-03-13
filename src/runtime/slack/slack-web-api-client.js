import { previewText } from "../../debug/debug-logger.js";

const NOOP_LOGGER = {
  debug() {},
  error() {},
};

export class SlackWebApiClient {
  constructor({ botToken, channelId, fetchImpl = fetch, logger = NOOP_LOGGER }) {
    this.botToken = botToken;
    this.channelId = channelId;
    this.fetchImpl = fetchImpl;
    this.logger = logger;
  }

  async postDirectMessage(text) {
    return this.#postMessage({
      channel: this.channelId,
      text,
    });
  }

  async postThreadReply(threadTs, text) {
    return this.#postMessage({
      channel: this.channelId,
      thread_ts: threadTs,
      text,
    });
  }

  async #postMessage(body) {
    this.logger.debug("slack.post.start", {
      channel: body.channel,
      threadTs: body.thread_ts ?? null,
      textPreview: previewText(body.text),
    });

    const response = await this.fetchImpl("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        authorization: `Bearer ${this.botToken}`,
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json();

    if (!payload.ok) {
      this.logger.error("slack.post.error", {
        channel: body.channel,
        threadTs: body.thread_ts ?? null,
        error: payload.error ?? "unknown_error",
      });
      throw new Error(`Slack API error: ${payload.error ?? "unknown_error"}`);
    }

    this.logger.debug("slack.post.success", {
      channel: body.channel,
      threadTs: body.thread_ts ?? null,
      ts: payload.ts ?? null,
    });
    return payload;
  }
}
