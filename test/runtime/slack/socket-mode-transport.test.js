import test from "node:test";
import assert from "node:assert/strict";

import { SocketModeTransport } from "../../../src/runtime/slack/socket-mode-transport.js";

test("Socket Mode transport는 events_api를 ack한 뒤 메시지 핸들러에 전달한다", async () => {
  const events = [];
  const fakeClient = createFakeSocketClient();
  const callOrder = [];
  const transport = new SocketModeTransport({
    appToken: "xapp-test",
    clientFactory: () => fakeClient,
    onMessageEvent: async (event) => {
      callOrder.push("handler");
      events.push(event);
    },
  });

  await transport.start();

  await fakeClient.emitEvent("events_api", {
    ack: async () => {
      callOrder.push("ack");
    },
    body: {
      event: {
        type: "message",
        channel_type: "im",
        channel: "D123",
        user: "U123",
        text: "질문",
        ts: "1000.1",
      },
    },
  });

  assert.deepEqual(callOrder, ["ack", "handler"]);
  assert.deepEqual(events, [
    {
      type: "message",
      channel_type: "im",
      channel: "D123",
      user: "U123",
      text: "질문",
      ts: "1000.1",
    },
  ]);
});

test("Socket Mode transport는 핸들러 에러가 나도 예외를 삼키고 onError로 넘긴다", async () => {
  const fakeClient = createFakeSocketClient();
  const errors = [];
  const transport = new SocketModeTransport({
    appToken: "xapp-test",
    clientFactory: () => fakeClient,
    onMessageEvent: async () => {
      throw new Error("boom");
    },
    onError(error, event) {
      errors.push({ message: error.message, event });
    },
  });

  await transport.start();

  await fakeClient.emitEvent("events_api", {
    ack: async () => {},
    body: {
      event: {
        type: "message",
        channel_type: "im",
        channel: "D123",
        user: "U123",
        text: "질문",
        ts: "1000.2",
      },
    },
  });

  assert.deepEqual(errors, [
    {
      message: "boom",
      event: {
        type: "message",
        channel_type: "im",
        channel: "D123",
        user: "U123",
        text: "질문",
        ts: "1000.2",
      },
    },
  ]);
});

function createFakeSocketClient() {
  return {
    listeners: new Map(),
    started: false,
    on(name, handler) {
      this.listeners.set(name, handler);
      return this;
    },
    async start() {
      this.started = true;
      return { ok: true };
    },
    async emitEvent(name, payload) {
      const handler = this.listeners.get(name);
      if (!handler) {
        throw new Error(`missing listener for ${name}`);
      }

      return handler(payload);
    },
  };
}
