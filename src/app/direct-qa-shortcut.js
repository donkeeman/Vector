const INTRO_REPLY_TEXT =
  "나? 네가 CS 공부하다 절망에 빠지는 순간을 실시간으로 감상하러 온 천재, 벡터 라고 해. 긴장 좀 하는 게 좋을걸?";

const USAGE_REPLY_TEXT =
  "별거 없어. 덤빌 준비됐으면 `!start` 치고, 도저히 못 버티겠으면 `!stop` 치고 도망가든가. 도움말이 필요하면 `!help`나 쳐. 간단하지?";

const INTRO_PHRASES = [
  "너 누구",
  "너는 누구",
  "넌 누구",
  "정체가 뭐",
  "정체 뭐",
  "이름이 뭐",
  "이름 뭐",
  "이름 알려",
  "네 이름",
  "니 이름",
];

const USAGE_PHRASES = [
  "!help",
  "사용법",
  "어떻게 써",
  "어떻게 쓰면",
  "뭐 할 수",
  "뭘 할 수",
  "무슨 기능",
  "help",
];

export function getDirectQaShortcutReply(text) {
  const normalized = normalizeShortcutText(text);

  if (!normalized) {
    return null;
  }

  if (includesAny(normalized, INTRO_PHRASES)) {
    return INTRO_REPLY_TEXT;
  }

  if (includesAny(normalized, USAGE_PHRASES)) {
    return USAGE_REPLY_TEXT;
  }

  return null;
}

function includesAny(text, phrases) {
  return phrases.some((phrase) => text.includes(phrase));
}

function normalizeShortcutText(text) {
  return String(text ?? "")
    .trim()
    .toLowerCase()
    .replace(/[?？!.,]/gu, (character) => (character === "!" ? "!" : " "))
    .replace(/\s+/gu, " ");
}

export { INTRO_REPLY_TEXT, USAGE_REPLY_TEXT };
