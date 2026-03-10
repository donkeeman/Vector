const COUNTER_QUESTION_PATTERN =
  /[?？]$|^(왜|어떻게|그럼|그러면|근데|what|why|how|can|is|are)\b/i;

export function looksLikeCounterQuestion(text) {
  return COUNTER_QUESTION_PATTERN.test(text.trim());
}
