const VOLATILE_SIGNALS = [
  { pattern: /(?:최신|최근|새로운|새로 나온|업데이트|변경|릴리즈|deprecated|지원 중단)/iu, name: "freshness_keyword" },
  { pattern: /\b(?:v?\d+\.\d+(?:\.\d+)?)\b/u, name: "version_number" },
  { pattern: /\b20[2-3]\d\b/u, name: "year_reference" },
  { pattern: /(?:React|Next\.?js|Vue|Angular|Svelte|Python|Node\.?js?|Java|Swift|Kotlin|Go|Rust|TypeScript|Deno|Bun)\s*\d+/iu, name: "framework_version" },
  { pattern: /(?:변경점|마이그레이션|breaking change|migration)/iu, name: "migration_keyword" },
  { pattern: /(?:방금|이번|올해|지금)\s*(?:나온|출시|릴리즈)/iu, name: "recent_release" },
];

const EVERGREEN_SIGNALS = [
  { pattern: /(?:원리|개념|기본|기초|이론|정의|차이|비교)/u, name: "concept_keyword" },
  { pattern: /(?:왜|어떻게|무슨 원리|동작 방식|작동 원리|메커니즘)/u, name: "mechanism_question" },
  { pattern: /(?:자료\s*구조|알고리즘|운영\s*체제|네트워크|데이터베이스|DB|컴파일러|OS)/iu, name: "cs_fundamental" },
  { pattern: /(?:TCP|UDP|HTTP|DNS|OSI|IP|ARP)/u, name: "protocol_name" },
  { pattern: /(?:스택|큐|힙|트리|그래프|해시|링크드\s*리스트|배열)/u, name: "data_structure" },
  { pattern: /(?:정렬|탐색|DFS|BFS|다익스트라|DP|동적\s*프로그래밍)/u, name: "algorithm" },
  { pattern: /(?:프로세스|스레드|세마포어|뮤텍스|데드락|페이지|가상\s*메모리)/u, name: "os_concept" },
];

export function classifyFreshness(questionText) {
  const text = String(questionText ?? "").trim();
  if (!text) {
    return { type: "unknown", signals: [] };
  }

  const volatileSignals = collectSignals(text, VOLATILE_SIGNALS);
  if (volatileSignals.length > 0) {
    return { type: "volatile", signals: volatileSignals };
  }

  const evergreenSignals = collectSignals(text, EVERGREEN_SIGNALS);
  if (evergreenSignals.length > 0) {
    return { type: "evergreen", signals: evergreenSignals };
  }

  return { type: "unknown", signals: [] };
}

function collectSignals(text, rules) {
  return rules.filter((rule) => rule.pattern.test(text)).map((rule) => rule.name);
}
