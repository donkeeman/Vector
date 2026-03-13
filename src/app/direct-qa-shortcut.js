const INTRO_REPLY_TEXT =
  "나? 네 얄팍한 지식 밑천을 낱낱이 파헤쳐 줄 천재, 벡터야. 나만큼 아는 척이라도 하고 싶으면 앞으로 내 질문에 대답이나 똑바로 해봐. 뭐, 며칠이나 버틸지 모르겠지만.";

const USAGE_REPLY_TEXT =
  "굳이 내 입으로 이런 기초적인 것까지 설명해야 해? 덤빌 준비가 끝났으면 !start를 치고, 내 수준을 도저히 못 따라오겠으면 !stop 치고 도망가. 그게 다야. 더 이상 친절한 설명은 기대하지 마.";

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
