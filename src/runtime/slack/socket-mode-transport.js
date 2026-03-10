import { SocketModeClient } from "@slack/socket-mode";

export class SocketModeTransport {
  constructor({
    appToken,
    clientFactory = (options) => new SocketModeClient(options),
    onMessageEvent = async () => {},
    onError = defaultTransportErrorHandler,
  }) {
    this.appToken = appToken;
    this.clientFactory = clientFactory;
    this.onMessageEvent = onMessageEvent;
    this.onError = onError;
    this.client = null;
  }

  async start() {
    this.client = this.clientFactory({
      appToken: this.appToken,
    });

    this.client.on("events_api", async ({ ack, body, event }) => {
      const messageEvent = event ?? body?.event ?? null;
      await ack();

      if (messageEvent?.type !== "message") {
        return;
      }

      try {
        await this.onMessageEvent(messageEvent);
      } catch (error) {
        this.onError(error, messageEvent);
      }
    });

    return this.client.start();
  }
}

function defaultTransportErrorHandler(error, event) {
  console.error("Socket Mode event handling failed.", {
    error: String(error),
    eventType: event?.type ?? "unknown",
    channel: event?.channel ?? null,
    ts: event?.ts ?? null,
  });
}
