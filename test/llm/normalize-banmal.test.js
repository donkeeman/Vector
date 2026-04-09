import test from "node:test";
import assert from "node:assert/strict";

import { normalizeBanmalText } from "../../src/llm/codex-cli-runner.js";

const BANMAL_CASES = [
  { name: "해보시겠어요는 해볼래로 바뀐다", input: "한번 해보시겠어요?", expected: "한번 해볼래?" },
  { name: "해보시겠어는 해볼래로 바뀐다", input: "한번 해보시겠어?", expected: "한번 해볼래?" },
  { name: "해주시겠어요는 해줄래로 바뀐다", input: "좀 해주시겠어요?", expected: "좀 해줄래?" },
  { name: "해주시겠어는 해줄래로 바뀐다", input: "좀 해주시겠어?", expected: "좀 해줄래?" },
  { name: "시겠어요는 겠어로 바뀐다", input: "가능하시겠어요?", expected: "가능하겠어?" },
  { name: "시겠어는 겠어로 바뀐다", input: "가능하시겠어?", expected: "가능하겠어?" },
  { name: "시겠습니다는 겠어로 바뀐다", input: "가능하시겠습니다.", expected: "가능하겠어." },
  { name: "이죠는 이지로 바뀐다", input: "사실이죠.", expected: "사실이지." },
  { name: "죠는 지로 바뀐다", input: "그렇죠.", expected: "그렇지." },
  { name: "뭐예요는 뭐야로 바뀐다", input: "이게 뭐예요?", expected: "이게 뭐야?" },
  { name: "뭐예는 뭐야로 바뀐다", input: "이게 뭐예?", expected: "이게 뭐야?" },
  { name: "이에요는 이야로 바뀐다", input: "그건 사실이에요.", expected: "그건 사실이야." },
  { name: "예요는 야로 바뀐다", input: "그건 진짜예요.", expected: "그건 진짜야." },
  { name: "입니다는 이야로 바뀐다", input: "이건 정답입니다.", expected: "이건 정답이야." },
  { name: "있습니다는 있어로 바뀐다", input: "문제점이 있습니다.", expected: "문제점이 있어." },
  { name: "없습니다는 없어로 바뀐다", input: "문제점이 없습니다.", expected: "문제점이 없어." },
  { name: "알겠습니다는 알겠어로 바뀐다", input: "알겠습니다.", expected: "알겠어." },
  { name: "겠습니다는 겠어로 바뀐다", input: "하겠습니다.", expected: "하겠어." },
  { name: "겠어요는 겠어로 바뀐다", input: "가겠어요?", expected: "가겠어?" },
  { name: "됩니다는 돼로 바뀐다", input: "이렇게 됩니다.", expected: "이렇게 돼." },
  { name: "가능합니다는 가능해로 바뀐다", input: "이건 가능합니다.", expected: "이건 가능해." },
  { name: "합니다는 해로 바뀐다", input: "그건 잘합니다.", expected: "그건 잘해." },
  { name: "해주세요는 해줘로 바뀐다", input: "한번 해주세요.", expected: "한번 해줘." },
  { name: "해보세요는 해봐로 바뀐다", input: "직접 해보세요.", expected: "직접 해봐." },
  { name: "하세요는 해로 바뀐다", input: "그냥 하세요.", expected: "그냥 해." },
  { name: "십시오는 해로 바뀐다", input: "십시오.", expected: "해." },
  { name: "인가요는 인가로 바뀐다", input: "사실인가요?", expected: "사실인가?" },
  { name: "나요는 나로 바뀐다", input: "이게 맞나요?", expected: "이게 맞나?" },
  { name: "까요는 까로 바뀐다", input: "갈까요?", expected: "갈까?" },
  { name: "해요는 해로 바뀐다", input: "좋아요. 해요.", expected: "좋아요. 해." },
  { name: "돼요는 돼로 바뀐다", input: "이렇게 돼요.", expected: "이렇게 돼." },
  { name: "있어요는 있어로 바뀐다", input: "문제가 있어요.", expected: "문제가 있어." },
  { name: "없어요는 없어로 바뀐다", input: "문제가 없어요.", expected: "문제가 없어." },
  { name: "맞아요는 맞아로 바뀐다", input: "그 말이 맞아요.", expected: "그 말이 맞아." },
  { name: "아니에요는 아니야로 바뀐다", input: "그건 아니에요.", expected: "그건 아니야." },
  { name: "그래요는 그래로 바뀐다", input: "그래요.", expected: "그래." },
];

for (const { name, input, expected } of BANMAL_CASES) {
  test(name, () => {
    assert.equal(normalizeBanmalText(input), expected);
  });
}

test("문장 끝 요는 제거된다", () => {
  assert.equal(normalizeBanmalText("고마워요"), "고마워");
});

test("이미 반말인 텍스트는 그대로 유지된다", () => {
  const text = "이건 네가 직접 해봐야 알아.";
  assert.equal(normalizeBanmalText(text), text);
});

test("빈 문자열은 그대로 반환된다", () => {
  assert.equal(normalizeBanmalText(""), "");
});

test("문장 중간의 요는 제거하지 않는다", () => {
  const text = "이 요소가 중요해.";
  assert.equal(normalizeBanmalText(text), text);
});

test("복합 존댓말 문장은 모두 반말로 변환된다", () => {
  const input = "이건 가능합니다. 해보시겠어요?";
  const expected = "이건 가능해. 해볼래?";
  assert.equal(normalizeBanmalText(input), expected);
});

test("문장 중간 패턴도 경계 조건에 맞게 변환된다", () => {
  const input = "그건 됩니다. 근데 이건 안 됩니다.";
  const expected = "그건 돼. 근데 이건 안 돼.";
  assert.equal(normalizeBanmalText(input), expected);
});
