import { SocketModeClient } from "@slack/socket-mode";

const NOOP_LOGGER = {
  debug() {},
  error() {},
};

export class SocketModeTransport {
  constructor({
    appToken,
    clientFactory = (options) => new SocketModeClient(options),
    onMessageEvent = async () => {},
    onError = defaultTransportErrorHandler,
    logger = NOOP_LOGGER,
  }) {
    this.appToken = appToken;
    this.clientFactory = clientFactory;
    this.onMessageEvent = onMessageEvent;
    this.onError = onError;
    this.logger = logger;
    this.client = null;
  }

  async start() {
    this.logger.debug("socket_mode.starting");
    this.client = this.clientFactory({
      appToken: this.appToken,
    });

    this.client.on("message", async ({ ack, body, event }) => {
      const messageEvent = event ?? body?.event ?? null;
      this.logger.debug("socket_mode.message_received", {
        channel: messageEvent?.channel ?? null,
        ts: messageEvent?.ts ?? null,
        threadTs: messageEvent?.thread_ts ?? null,
        user: messageEvent?.user ?? null,
      });
      await ack();
      this.logger.debug("socket_mode.message_acked", {
        channel: messageEvent?.channel ?? null,
        ts: messageEvent?.ts ?? null,
      });

      try {
        await this.onMessageEvent(messageEvent);
      } catch (error) {
        this.logger.error("socket_mode.message_handler_failed", {
          channel: messageEvent?.channel ?? null,
          ts: messageEvent?.ts ?? null,
          message: error.message,
        });
        this.onError(error, messageEvent);
      }
    });

    const result = await this.client.start();
    this.logger.debug("socket_mode.started");
    return result;
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
