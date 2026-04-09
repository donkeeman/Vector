export const HONORIFIC_PATTERNS = [
  { pattern: /습니다/u, name: "습니다 ending" },
  { pattern: /입니다/u, name: "입니다 ending" },
  { pattern: /세요/u, name: "세요 ending" },
  { pattern: /십시오/u, name: "십시오 ending" },
  { pattern: /예요(?=\s*[.!?,…~]|$)/u, name: "예요 ending" },
  { pattern: /이에요(?=\s*[.!?,…~]|$)/u, name: "이에요 ending" },
  { pattern: /이죠(?=\s*[.!?,…~]|$)/u, name: "이죠 ending" },
  { pattern: /겠어요(?=\s*[.!?,…~]|$)/u, name: "겠어요 ending" },
  { pattern: /해요(?=\s*[.!?,…~]|$)/u, name: "해요 ending" },
  { pattern: /돼요(?=\s*[.!?,…~]|$)/u, name: "돼요 ending" },
  { pattern: /있어요(?=\s*[.!?,…~]|$)/u, name: "있어요 ending" },
  { pattern: /없어요(?=\s*[.!?,…~]|$)/u, name: "없어요 ending" },
  { pattern: /까요(?=\s*[?!]|$)/u, name: "까요 ending" },
  { pattern: /나요(?=\s*[?!]|$)/u, name: "나요 ending" },
  { pattern: /드리/u, name: "드리 (deferential)" },
];

export const OVERLY_POLITE_PATTERNS = [
  { pattern: /감사합니다/u, name: "감사합니다" },
  { pattern: /감사해요/u, name: "감사해요" },
  { pattern: /부탁드/u, name: "부탁드리다" },
  { pattern: /죄송/u, name: "죄송" },
  { pattern: /실례/u, name: "실례" },
];

export function checkPersonaViolations(text) {
  const normalized = String(text ?? "");
  const violations = [];
  const seen = new Set();

  for (const rule of [...HONORIFIC_PATTERNS, ...OVERLY_POLITE_PATTERNS]) {
    if (rule.pattern.test(normalized) && !seen.has(rule.name)) {
      seen.add(rule.name);
      violations.push(rule.name);
    }
  }

  return violations;
}

export function isEmptyResponse(text) {
  return !String(text ?? "").trim();
}
