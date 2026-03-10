export class SlackWebApiClient {
  constructor({ botToken, channelId, fetchImpl = fetch }) {
    this.botToken = botToken;
    this.channelId = channelId;
    this.fetchImpl = fetchImpl;
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
      throw new Error(`Slack API error: ${payload.error ?? "unknown_error"}`);
    }

    return payload;
  }
}
