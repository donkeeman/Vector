const MASTERED_LEARNING_STATES = new Set([
  "mastered_clean",
  "mastered_recovered",
]);

export function filterPrerequisiteTopics(topics, memories) {
  const memoryMap = toMemoryMap(memories);
  const pendingDeferredIds = getPendingDeferredTopicIds(memoryMap);

  return normalizeTopics(topics).filter((topic) => {
    const memory = memoryMap.get(topic.id) ?? null;
    if (!memory?.prerequisiteFor || !pendingDeferredIds.has(memory.prerequisiteFor)) {
      return false;
    }

    return !isMasteredLearningState(memory.learningState);
  });
}

export function isPrerequisiteSatisfied(deferredTopicId, memories) {
  const targetId = String(deferredTopicId ?? "").trim();
  if (!targetId) {
    return true;
  }

  const memoryMap = toMemoryMap(memories);

  for (const memory of memoryMap.values()) {
    if (String(memory?.prerequisiteFor ?? "").trim() !== targetId) {
      continue;
    }

    if (!isMasteredLearningState(memory.learningState)) {
      return false;
    }
  }

  return true;
}

export function applyPrerequisitePriority(topics, memories) {
  const topicList = normalizeTopics(topics);
  if (topicList.length === 0) {
    return [];
  }

  const memoryMap = toMemoryMap(memories);
  const prerequisiteTopicIds = new Set(
    filterPrerequisiteTopics(topicList, memoryMap).map((topic) => topic.id),
  );
  const blockedDeferredTopicIds = getPendingDeferredTopicIds(memoryMap);
  const prioritized = [];
  const seen = new Set();

  for (const topic of topicList) {
    if (!prerequisiteTopicIds.has(topic.id)) {
      continue;
    }

    prioritized.push(topic);
    seen.add(topic.id);
  }

  for (const topic of topicList) {
    if (seen.has(topic.id) || blockedDeferredTopicIds.has(topic.id)) {
      continue;
    }

    prioritized.push(topic);
    seen.add(topic.id);
  }

  return prioritized;
}
function getPendingDeferredTopicIds(memoryMap) {
  const pending = new Set();

  for (const memory of memoryMap.values()) {
    const targetId = String(memory?.prerequisiteFor ?? "").trim();
    if (!targetId || isMasteredLearningState(memory?.learningState)) {
      continue;
    }

    pending.add(targetId);
  }

  return pending;
}

function isMasteredLearningState(learningState) {
  return MASTERED_LEARNING_STATES.has(learningState);
}

function normalizeTopics(topics) {
  return Array.isArray(topics) ? topics.filter((topic) => Boolean(topic?.id)) : [];
}

function toMemoryMap(memories) {
  if (memories instanceof Map) {
    return memories;
  }

  if (!memories || typeof memories !== "object") {
    return new Map();
  }

  return new Map(
    Object.entries(memories)
      .map(([topicId, memory]) => [topicId, memory ?? null]),
  );
}
