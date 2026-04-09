const DEFAULT_TOP_K = 3;
const MAX_TEXT_LENGTH = 240;
const MAX_TOPIC_CANDIDATES = 60;
const MAX_HISTORY_CANDIDATES = 8;
const MAX_TOPIC_RESULTS_PER_QUERY = 24;
const TOPIC_INDEX_CACHE = new WeakMap();

export async function searchRagLiteChunks({
  query,
  topK = DEFAULT_TOP_K,
  store = null,
  topicId = null,
  recentAttempts = [],
  latestTeachingMemory = null,
  history = [],
}) {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) {
    return [];
  }

  const queryTokens = tokenize(normalizedQuery);
  if (queryTokens.size === 0) {
    return [];
  }

  const candidates = [];
  collectAttemptCandidates(candidates, recentAttempts);
  collectTeachingCandidates(candidates, latestTeachingMemory, topicId);
  collectHistoryCandidates(candidates, history);
  await collectTopicCandidates(candidates, store, topicId, queryTokens);

  const scored = candidates
    .map((candidate) => ({
      ...candidate,
      score: scoreCandidate(candidate.text, queryTokens),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.source.localeCompare(right.source);
    });

  const seen = new Set();
  const limit = normalizeTopK(topK);
  const result = [];

  for (const candidate of scored) {
    const dedupeKey = `${candidate.source}::${candidate.text}`;
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    result.push({
      source: candidate.source,
      text: candidate.text,
    });

    if (result.length >= limit) {
      break;
    }
  }

  return result;
}

function collectAttemptCandidates(candidates, recentAttempts) {
  if (!Array.isArray(recentAttempts)) {
    return;
  }

  for (let index = 0; index < recentAttempts.length; index += 1) {
    const attempt = recentAttempts[index];
    const topicId = normalizeText(attempt?.topicId) ?? "unknown";
    addCandidate(
      candidates,
      `attempt:${topicId}:${index + 1}:misconception`,
      attempt?.misconceptionSummary,
    );
    addCandidate(
      candidates,
      `attempt:${topicId}:${index + 1}:answer`,
      attempt?.answerSummary ?? attempt?.answer,
    );
  }
}

function collectTeachingCandidates(candidates, latestTeachingMemory, topicId) {
  if (!latestTeachingMemory || typeof latestTeachingMemory !== "object") {
    return;
  }

  const ownerTopicId = normalizeText(topicId)
    ?? normalizeText(latestTeachingMemory.topicId)
    ?? "unknown";
  addCandidate(
    candidates,
    `teaching:${ownerTopicId}:summary`,
    latestTeachingMemory.teachingSummary,
  );
  addCandidate(
    candidates,
    `teaching:${ownerTopicId}:challenge`,
    latestTeachingMemory.challengeSummary,
  );
}

function collectHistoryCandidates(candidates, history) {
  if (!Array.isArray(history)) {
    return;
  }

  const recent = history.slice(-MAX_HISTORY_CANDIDATES);
  for (let index = 0; index < recent.length; index += 1) {
    const item = recent[index];
    const role = normalizeText(item?.role) ?? "unknown";
    addCandidate(candidates, `history:${role}:${index + 1}`, item?.text);
  }
}

async function collectTopicCandidates(candidates, store, topicId, queryTokens) {
  if (typeof store?.listTopics !== "function") {
    return;
  }

  const topics = await store.listTopics();
  if (!Array.isArray(topics) || topics.length === 0) {
    return;
  }

  const topicIndex = getTopicIndex(store, topics);

  if (topicId) {
    const matched = topicIndex.byId.get(topicId);
    if (!matched) {
      return;
    }

    addCandidate(candidates, matched.source, matched.text);
    return;
  }

  const rankedTopicIds = rankTopicIdsByQueryMatch(topicIndex, queryTokens);
  for (const matchedTopicId of rankedTopicIds) {
    const matched = topicIndex.byId.get(matchedTopicId);
    if (!matched) {
      continue;
    }
    addCandidate(candidates, matched.source, matched.text);
  }
}

function getTopicIndex(store, topics) {
  const signature = buildTopicSignature(topics);
  const cached = TOPIC_INDEX_CACHE.get(store);
  if (cached?.signature === signature) {
    return cached;
  }

  const byId = new Map();
  const inverted = new Map();

  for (const topic of topics.slice(0, MAX_TOPIC_CANDIDATES)) {
    if (!topic?.id) {
      continue;
    }

    const text = normalizeText(
      [topic.title, topic.category, topic.promptSeed].filter(Boolean).join(" "),
    );
    if (!text) {
      continue;
    }

    const tokens = tokenize(text);
    if (tokens.size === 0) {
      continue;
    }

    const entry = {
      id: topic.id,
      source: `topic:${topic.id}`,
      text,
      tokens,
    };
    byId.set(topic.id, entry);

    for (const token of tokens) {
      const posting = inverted.get(token) ?? [];
      posting.push(topic.id);
      inverted.set(token, posting);
    }
  }

  const next = { signature, byId, inverted };
  TOPIC_INDEX_CACHE.set(store, next);
  return next;
}

function buildTopicSignature(topics) {
  return topics
    .slice(0, MAX_TOPIC_CANDIDATES)
    .map((topic) =>
      [
        topic?.id ?? "",
        normalizeText(topic?.title) ?? "",
        normalizeText(topic?.category) ?? "",
        normalizeText(topic?.promptSeed) ?? "",
      ].join("|"))
    .join("||");
}

function rankTopicIdsByQueryMatch(topicIndex, queryTokens) {
  if (!(queryTokens instanceof Set) || queryTokens.size === 0) {
    return [];
  }

  const scores = new Map();

  for (const token of queryTokens) {
    const matchedIds = topicIndex.inverted.get(token) ?? [];
    for (const matchedId of matchedIds) {
      scores.set(matchedId, (scores.get(matchedId) ?? 0) + 1);
    }
  }

  return Array.from(scores.entries())
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }

      return String(left[0]).localeCompare(String(right[0]));
    })
    .slice(0, MAX_TOPIC_RESULTS_PER_QUERY)
    .map(([topicId]) => topicId);
}

function addCandidate(candidates, source, text) {
  const normalizedSource = normalizeText(source);
  const normalizedText = normalizeText(text);
  if (!normalizedSource || !normalizedText) {
    return;
  }

  candidates.push({
    source: normalizedSource,
    text: normalizedText.slice(0, MAX_TEXT_LENGTH),
  });
}

function scoreCandidate(text, queryTokens) {
  const candidateTokens = tokenize(text);
  if (candidateTokens.size === 0) {
    return 0;
  }

  let score = 0;
  for (const token of queryTokens) {
    if (candidateTokens.has(token)) {
      score += 1;
    }
  }

  return score;
}

function tokenize(text) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return new Set();
  }

  const tokens = normalized
    .toLowerCase()
    .split(/[^0-9a-zA-Z가-힣._+-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);

  return new Set(tokens);
}

function normalizeText(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
}

function normalizeTopK(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_TOP_K;
  }

  return Math.max(1, Math.round(parsed));
}
