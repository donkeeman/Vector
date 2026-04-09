import test from "node:test";
import assert from "node:assert/strict";

import { searchRagLiteChunks } from "../../src/domain/rag-lite-retriever.js";

test("query와 겹치는 토큰 기준으로 top-k chunk를 반환한다", async () => {
  const chunks = await searchRagLiteChunks({
    query: "event loop microtask 순서",
    topK: 3,
    topicId: "event-loop",
    recentAttempts: [
      {
        topicId: "event-loop",
        misconceptionSummary: "microtask가 task보다 늦다고 착각",
        answerSummary: "순서를 반대로 설명함",
      },
    ],
    latestTeachingMemory: {
      topicId: "event-loop",
      teachingSummary: "event loop에서는 task 다음 microtask checkpoint를 돈다",
      challengeSummary: "Promise.then과 setTimeout(0) 순서를 말해봐",
    },
    history: [
      {
        role: "assistant",
        text: "event loop 핵심은 microtask 우선 처리야",
      },
    ],
    store: {
      async listTopics() {
        return [
          {
            id: "event-loop",
            title: "Event Loop",
            category: "runtime",
            promptSeed: "event loop microtask macrotask",
          },
        ];
      },
    },
  });

  assert.equal(chunks.length, 3);
  assert.equal(chunks.some((chunk) => chunk.source === "topic:event-loop"), true);
  assert.equal(chunks.some((chunk) => chunk.source.startsWith("teaching:event-loop")), true);
  assert.equal(chunks.some((chunk) => chunk.source.startsWith("history:")), true);
});

test("query가 비어 있으면 빈 결과를 반환한다", async () => {
  const chunks = await searchRagLiteChunks({
    query: "   ",
    recentAttempts: [
      {
        topicId: "os",
        misconceptionSummary: "context switch를 모름",
      },
    ],
  });

  assert.deepEqual(chunks, []);
});

test("store.listTopics가 없어도 fallback context만으로 검색한다", async () => {
  const chunks = await searchRagLiteChunks({
    query: "raft leader election",
    recentAttempts: [
      {
        topicId: "raft",
        misconceptionSummary: "leader election term 역할을 헷갈림",
      },
    ],
    history: [
      {
        role: "assistant",
        text: "raft leader election은 term 기반으로 안전성을 지켜",
      },
    ],
  });

  assert.equal(chunks.length > 0, true);
  assert.equal(chunks[0].source.startsWith("history:") || chunks[0].source.startsWith("attempt:"), true);
});
