import test from "node:test";
import assert from "node:assert/strict";

import { classifyFreshness } from "../../src/domain/freshness-classifier.js";

test("최신성 질문은 버전 단서가 있으면 volatile로 분류된다", () => {
  const result = classifyFreshness("React 19에서 새로 추가된 use() 훅이 뭐야?");

  assert.equal(result.type, "volatile");
  assert.ok(result.signals.includes("framework_version"));
});

test("최신성 질문은 최신 키워드가 있으면 volatile로 분류된다", () => {
  const result = classifyFreshness("최신 Node.js에서 권장하는 패키지 매니저가 뭐야?");

  assert.equal(result.type, "volatile");
  assert.ok(result.signals.includes("freshness_keyword"));
});

test("최신성 질문은 연도 언급이 있으면 volatile로 분류된다", () => {
  const result = classifyFreshness("2026년 기준으로 가장 인기 있는 프레임워크가 뭐야?");

  assert.equal(result.type, "volatile");
  assert.ok(result.signals.includes("year_reference"));
});

test("기본 개념 질문은 evergreen으로 분류된다", () => {
  const result = classifyFreshness("TCP 3-way handshake가 왜 필요해?");

  assert.equal(result.type, "evergreen");
  assert.ok(result.signals.includes("protocol_name"));
});

test("일반 질문은 unknown으로 분류된다", () => {
  const result = classifyFreshness("커피 추천해줘");

  assert.equal(result.type, "unknown");
  assert.deepEqual(result.signals, []);
});

test("volatile과 evergreen 단서가 함께 있으면 volatile이 우선한다", () => {
  const result = classifyFreshness("React 19에서 가상 DOM 동작 원리가 바뀌었어?");

  assert.equal(result.type, "volatile");
  assert.ok(result.signals.includes("framework_version"));
});

test("빈 입력은 unknown이다", () => {
  assert.deepEqual(classifyFreshness(""), {
    type: "unknown",
    signals: [],
  });
});

test("null 입력은 unknown이다", () => {
  assert.deepEqual(classifyFreshness(null), {
    type: "unknown",
    signals: [],
  });
});

const VOLATILE_CASES = [
  ["버전 번호는 volatile", "Python 3.12에서 바뀐 점이 뭐야?", "version_number"],
  ["프레임워크 버전은 volatile", "Next.js 15에서 달라진 게 뭐야?", "framework_version"],
  ["변경점 언급은 volatile", "Go 1.22 변경점 알려줘", "migration_keyword"],
  ["마이그레이션은 volatile", "Next.js 14에서 15로 마이그레이션할 때 주의점이 뭐야?", "migration_keyword"],
  ["최근 키워드는 volatile", "최근 TypeScript 업데이트에서 뭐가 달라졌어?", "freshness_keyword"],
  ["지원 중단은 volatile", "componentWillMount가 지원 중단된 이유가 뭐야?", "freshness_keyword"],
  ["deprecated는 volatile", "이 API가 deprecated된 이유가 뭐야?", "freshness_keyword"],
  ["연도 언급은 volatile", "2026년 기준으로 뭐가 제일 좋아?", "year_reference"],
  ["방금 출시 언급은 volatile", "방금 나온 Bun 릴리즈에서 뭐가 달라졌어?", "recent_release"],
  ["복합 신호는 volatile", "React 19에서 최신 변경점이 뭐야?", "framework_version"],
];

for (const [name, input, expectedSignal] of VOLATILE_CASES) {
  test(name, () => {
    const result = classifyFreshness(input);

    assert.equal(result.type, "volatile");
    assert.ok(result.signals.includes(expectedSignal));
  });
}

const EVERGREEN_CASES = [
  ["개념 질문은 evergreen", "자료구조 개념이 뭐야?", "concept_keyword"],
  ["왜 질문은 evergreen", "왜 해시 테이블이 O(1)이야?", "mechanism_question"],
  ["네트워크는 evergreen", "네트워크 차이가 뭐야?", "cs_fundamental"],
  ["프로토콜은 evergreen", "HTTP와 TCP 차이가 뭐야?", "protocol_name"],
  ["자료구조는 evergreen", "스택이랑 큐 차이가 뭐야?", "data_structure"],
  ["알고리즘은 evergreen", "BFS는 어떻게 동작해?", "algorithm"],
  ["운영체제는 evergreen", "프로세스랑 스레드 차이가 뭐야?", "os_concept"],
  ["데드락은 evergreen", "데드락이 왜 생겨?", "os_concept"],
  ["가상 메모리는 evergreen", "가상 메모리 작동 원리 설명해봐", "os_concept"],
  ["DB는 evergreen", "데이터베이스 정규화가 뭐야?", "cs_fundamental"],
];

for (const [name, input, expectedSignal] of EVERGREEN_CASES) {
  test(name, () => {
    const result = classifyFreshness(input);

    assert.equal(result.type, "evergreen");
    assert.ok(result.signals.includes(expectedSignal));
  });
}

const UNKNOWN_CASES = [
  "커피 추천해줘",
  "점심 뭐 먹지",
  "좋은 아침",
  "그냥 알려줘",
  "오늘 기분 어때",
];

for (const input of UNKNOWN_CASES) {
  test(`unknown 케이스: ${input}`, () => {
    const result = classifyFreshness(input);

    assert.equal(result.type, "unknown");
    assert.deepEqual(result.signals, []);
  });
}
