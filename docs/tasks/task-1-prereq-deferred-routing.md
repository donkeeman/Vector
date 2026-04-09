# Task 1: Prerequisite Deferred Routing

## Goal

사용자가 현재 질문을 감당하기 어려운 경우(수준 미스매치), 스레드를 `deferred`로 종료하고 하위 개념 질문을 우선 배치한 뒤 원 질문을 나중으로 미룬다.

## Project Context

- Runtime: Node.js ESM (package.json `"type": "module"`)
- Test runner: `node --test` (Node.js built-in)
- DB: SQLite via `sqlite3` CLI (`src/storage/sqlite-store.js`)
- LLM: CLI subprocess (`codex exec` or `claude -p`)
- Convention: code=English, comments=Korean, commit=Korean 반말체 + Conventional Commits

## Architecture Overview

```
SlackMessageRouter → TutorBot → TutorThreadHandler → LLM Runner
                                     ↓
                              evaluate → outcome: continue|blocked|mastered
                                           ↓ blocked
                                         teach → stack.push (drill deeper)
```

현재 `blocked`는 "스택을 한 단계 더 깊이 파고든다"를 의미한다. 하지만 스택 깊이 한계(5)에 도달하거나, 근본적으로 수준이 안 맞는 경우를 별도로 처리하는 `deferred` 개념이 필요하다.

## Sub-Tasks (TDD)

### Sub-Task 1: `deferred` learningState 추가

**수정 파일:**
- `src/domain/topic-memory.js`
- `test/domain/review-policy.test.js`

**현재 상태:**
`learningState`는 `new | fuzzy | blocked | mastered_clean | mastered_recovered` 5개 값.

`classifyReviewPriority()` (topic-memory.js:108-139):
```js
if (current.learningState === "blocked") return 4;
if (current.learningState === "fuzzy") return 3;
if (current.learningState === "mastered_recovered") return 2;
if (current.learningState === "mastered_clean") return 1;
return null;
```

`resolveLearningState()` (topic-memory.js:218-240):
```js
if (outcome === "blocked") return "blocked";
if (outcome === "continue") return "fuzzy";
if (outcome === "mastered") { ... }
```

**구현 내용:**
1. `resolveLearningState()`에 `outcome === "deferred"` 분기 추가 → `return "deferred"`
2. `classifyReviewPriority()`에서 `deferred` 우선순위 추가: deferred는 blocked(4)보다 낮은 0 (재출제 대상에서 제외). 또는 `null`을 반환해서 review 대상에서 완전히 빠지게 할 수도 있음. **deferred는 prerequisite가 충족되기 전까지 review 대상에서 제외되어야 하므로 `null` 반환이 적절**
3. `updateTopicMemory()`에서 `outcome === "deferred"` 처리 (blocked와 유사하되 learningState만 다름)

**테스트 (test/domain/review-policy.test.js에 추가):**
```js
test("deferred outcome은 learningState를 deferred로 전이한다", () => {
  const now = new Date("2026-03-10T10:00:00+09:00");
  const empty = createEmptyTopicMemory();
  const deferred = updateTopicMemory(empty, "deferred", now);
  assert.equal(deferred.learningState, "deferred");
});

test("deferred learningState는 review 우선순위에서 제외된다", () => {
  const now = new Date("2026-03-10T10:00:00+09:00");
  const deferredMemory = {
    ...createEmptyTopicMemory(),
    timesAsked: 1,
    learningState: "deferred",
    nextReviewAt: now,
  };
  assert.equal(classifyReviewPriority(deferredMemory, now), null);
});
```

**커밋:** `feat: deferred learningState 추가`

---

### Sub-Task 2: Prerequisite 우선순위 도입

**생성 파일:**
- `src/domain/prerequisite-policy.js`
- `test/domain/prerequisite-policy.test.js`

**수정 파일:**
- `src/storage/sqlite-store.js`
- `src/app/tutor-question-dispatcher.js`

**개념:**
prerequisite 큐는 `topic_memory` 테이블에 새 필드를 추가하여 관리한다:
- `prerequisite_for` (TEXT, nullable): 이 토픽이 어떤 deferred 토픽의 선행 학습인지
- prerequisite 토픽의 learningState가 `mastered_clean` 또는 `mastered_recovered`가 되면, 해당 deferred 토픽을 review 대상으로 복원

**prerequisite-policy.js 설계:**
```js
// prerequisite 큐에서 아직 mastered 안 된 선행 토픽들 조회
export function filterPrerequisiteTopics(topics, memories) { ... }

// deferred 토픽의 prerequisite가 모두 충족되었는지 확인
export function isPrerequisiteSatisfied(deferredTopicId, memories) { ... }

// 토픽 선택 우선순위: prereq > normal > (deferred는 제외)
export function applyPrerequisitePriority(topics, memories) { ... }
```

**tutor-question-dispatcher.js 수정:**
`pickTopicForContinuousFlow()` (line 288-359)에서 토픽 선택 시:
1. prerequisite 토픽이 있으면 최우선 선택
2. 없으면 기존 new/review 로직
3. deferred 토픽은 prerequisite 충족 전까지 후보에서 제외

현재 토픽 선택 흐름:
```js
const newTopicCandidates = topics.filter(t => classifyTopicLane(memory) === "new");
const reviewCandidates = topics.filter(t => classifyReviewPriority(memory, now) !== null);
const lane = selectStudyLane({ hasNewTopic, hasReviewTopic, random });
```

여기서 prerequisite 후보를 먼저 체크하는 로직을 앞에 추가.

**sqlite-store.js 수정:**
`topic_memory` 테이블에 `prerequisite_for` 컬럼 추가 (ensureColumn 패턴 사용).
prerequisite 관련 조회/저장 메서드 추가:
- `savePrerequisite(topicId, prerequisiteForTopicId)`
- `listPendingPrerequisites()` — mastered 안 된 prerequisite 토픽 목록

**테스트:**
```js
test("prerequisite 토픽은 일반 토픽보다 우선 선택된다", () => { ... });
test("deferred 토픽은 prerequisite 미충족 시 선택에서 제외된다", () => { ... });
test("prerequisite 충족 시 deferred 토픽이 review 대상으로 복원된다", () => { ... });
```

**커밋:** `feat: prerequisite 우선순위 도입`

---

### Sub-Task 3: 수준 미스매치 종료 플로우 연결

**수정 파일:**
- `src/app/tutor-thread-handler.js`
- `src/llm/codex-cli-runner.js`
- `test/app/tutor-bot.test.js`

**현재 evaluate 결과 처리 (tutor-thread-handler.js):**
```
outcome === "continue" → followup (stack.stay)
outcome === "blocked"  → teach (stack.push)
outcome === "mastered" → close reply (stack.pop)
```

**추가할 분기:**
```
outcome === "blocked" + 스택이 sealed (깊이 한계 도달) → deferred 종료
```

또는 evaluate가 직접 `"deferred"` outcome을 반환하도록 할 수도 있다. 두 접근 중 택 1:

**접근 A (추천): evaluate의 outcome은 그대로 두고, blocked + 조건으로 deferred 판단**
- `blocked`인데 스택이 이미 sealed(maxDepth 도달) → deferred로 전환
- 기존 LLM 지시문 변경 없음

**접근 B: evaluate TASK_INSTRUCTIONS에 `deferred` outcome 추가**
- LLM이 직접 "이건 수준 미스매치"를 판단
- TASK_INSTRUCTIONS 수정 필요

접근 A가 더 안전하다. 기존 LLM 동작 변경 없이 도메인 로직에서 처리.

**tutor-thread-handler.js 수정 (line 232 부근, blocked 분기 내):**
```js
if (normalizedEvaluation.outcome === "blocked") {
  // 스택이 sealed 상태면 deferred로 전환
  const stack = normalizeDirectQaStackState(sessionBoundThread.directQaStack);
  if (stack.sealed && stack.frames.length >= stack.maxDepth) {
    // deferred 종료 플로우
    const deferredMemory = updateTopicMemory(currentMemory, "deferred", now, { ... });
    await store.saveTopicMemory(repliedThread.topicId, deferredMemory);

    // prerequisite 토픽 enqueue (LLM에게 prerequisite 토픽 제안 요청)
    const prereqSuggestion = await llmRunner.runTask("suggest_prerequisite", {
      thread: sessionBoundThread,
      topicId: repliedThread.topicId,
      // ...
    });
    // 또는 단순히 현재 teach의 challengePrompt를 prerequisite 토픽으로 등록

    const closedThread = closeThread(sessionBoundThread, "deferred", now);
    await store.saveThread(closedThread);

    await slackClient.postThreadReply(threadTs,
      "...이건 네 현재 수준에선 좀 이르다. 기초부터 다시 밟고 올 때 꺼내줄게."
    );

    return {
      thread: closedThread,
      memory: deferredMemory,
      shouldScheduleNextQuestion: true,
    };
  }

  // 기존 blocked 로직...
}
```

**thread-policy.js의 closeThread는 이미 범용:**
```js
export function closeThread(thread, status, now) {
  return { ...thread, status, closedAt: now };
}
```
`status: "deferred"`를 넘기면 된다.

**TASK_INSTRUCTIONS 수정 (codex-cli-runner.js):**
- `teach` 태스크에 prerequisite 토픽 제안 필드 추가 (선택적):
  `"prerequisiteHint":"..."` — 사용자가 먼저 알아야 할 하위 개념 힌트

**테스트:**
```js
test("blocked + sealed 스택이면 deferred로 종료하고 다음 질문을 스케줄한다", async () => {
  // store에 sealed 스택 스레드 설정
  // evaluate가 blocked 반환하도록 mock
  // handleThreadMessage 호출
  // thread.status === "deferred" 확인
  // shouldScheduleNextQuestion === true 확인
});
```

**커밋:** `feat: 수준 미스매치 deferred 종료 플로우 연결`

---

### Sub-Task 4: 회귀 검증

```bash
npm test
```

모든 기존 테스트 + 새 테스트 통과 확인.

**커밋:** `test: deferred prerequisite 전체 회귀 검증`

---

## Key Files Reference

| File | Role |
|------|------|
| `src/domain/topic-memory.js` | learningState 전이, review 우선순위 |
| `src/domain/thread-policy.js` | 스레드 상태 생성/종료 |
| `src/domain/direct-qa-stack-policy.js` | 질의 스택 push/pop/stay/close |
| `src/app/tutor-thread-handler.js` | 학습 스레드 턴별 처리 (evaluate→followup/teach) |
| `src/app/tutor-question-dispatcher.js` | 토픽 선택 및 질문 디스패치 |
| `src/storage/sqlite-store.js` | SQLite CRUD |
| `src/llm/codex-cli-runner.js` | TASK_INSTRUCTIONS, LLM 호출 |
| `test/domain/review-policy.test.js` | topic-memory 테스트 |
| `test/app/tutor-bot.test.js` | TutorBot 통합 테스트 |
