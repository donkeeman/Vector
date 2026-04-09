import test from "node:test";
import assert from "node:assert/strict";

import { normalizeBanmalText } from "../../src/llm/codex-cli-runner.js";
import { checkPersonaViolations, isEmptyResponse } from "../../src/persona/persona-rules.js";

const VALID_BANMAL_SAMPLES = [
  "이벤트 루프가 뭔지도 모르면서 비동기 얘기하냐? 콜 스택부터 설명해봐.",
  "그건 틀렸어. V8 엔진이 싱글 스레드라는 건 메인 스레드 얘기야. libuv 스레드풀은 별개지.",
  "흥, 그 정도는 맞았네. 근데 마이크로태스크 큐랑 매크로태스크 큐 차이는 알아?",
  "TCP 3-way handshake 순서도 모르면서 네트워크 안다고? SYN, SYN-ACK, ACK 순서야.",
  "인덱스가 뭔지 대충은 아는구나. 그럼 B+Tree 인덱스가 해시 인덱스보다 범위 검색에 유리한 이유는?",
  "페이지 교체 알고리즘 중 LRU가 왜 실제로는 근사치만 쓰는지 설명해봐.",
  "가비지 컬렉션의 Mark-and-Sweep이 뭔지는 아는 거지? 그럼 세대별 GC는?",
  "그건 맞아. 프로세스는 독립 메모리 공간, 스레드는 힙을 공유하지.",
  "데드락 4가지 조건 중 하나만 말해봐. 상호 배제 말고 다른 거.",
  "REST API에서 PUT이랑 PATCH 차이도 구분 못 하면 API 설계는 멀었어.",
];

const HONORIFIC_FIXTURES = [
  { raw: "한번 해보시겠어요?", normalized: "한번 해볼래?" },
  { raw: "좀 해주시겠어요?", normalized: "좀 해줄래?" },
  { raw: "가능하시겠어요?", normalized: "가능하겠어?" },
  { raw: "가능하시겠습니다.", normalized: "가능하겠어." },
  { raw: "사실이죠.", normalized: "사실이지." },
  { raw: "그건 진짜예요.", normalized: "그건 진짜야." },
  { raw: "문제점이 있습니다.", normalized: "문제점이 있어." },
  { raw: "이건 정답입니다.", normalized: "이건 정답이야." },
  { raw: "이게 맞나요?", normalized: "이게 맞나?" },
  { raw: "갈까요?", normalized: "갈까?" },
  { raw: "그건 해요.", normalized: "그건 해." },
];

test("올바른 반말 응답은 페르소나 위반이 없다", () => {
  for (const sample of VALID_BANMAL_SAMPLES) {
    const violations = checkPersonaViolations(sample);
    assert.deepEqual(violations, [], `위반 발견: "${sample}" → ${violations.join(", ")}`);
  }
});

test("honorific fixture는 normalizeBanmalText 후 페르소나 위반이 해소된다", () => {
  for (const { raw, normalized } of HONORIFIC_FIXTURES) {
    const rewritten = normalizeBanmalText(raw);
    assert.equal(rewritten, normalized, `정규화 결과가 예상과 다름: "${raw}"`);
    assert.deepEqual(
      checkPersonaViolations(rewritten),
      [],
      `정규화 후에도 위반이 남음: "${raw}" → "${rewritten}"`,
    );
  }
});

test("raw honorific fixture는 정규화 전 위반을 가진다", () => {
  for (const { raw } of HONORIFIC_FIXTURES) {
    assert.notEqual(
      checkPersonaViolations(raw).length,
      0,
      `원문이 위반으로 잡히지 않음: "${raw}"`,
    );
  }
});

test("빈 응답은 감지된다", () => {
  assert.ok(isEmptyResponse(""));
  assert.ok(isEmptyResponse(null));
  assert.ok(isEmptyResponse("   "));
  assert.ok(!isEmptyResponse("뭔가 있어"));
});
