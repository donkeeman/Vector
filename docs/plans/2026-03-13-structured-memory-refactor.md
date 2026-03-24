# Structured Memory Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** `study` 흐름에 structured learning memory를 도입해, 사용자 학습 상태를 기억하고 그 메모리를 기반으로 출제·평가·재출제·재촉 흐름을 일관되게 운영한다.

**Architecture:** 현재의 `masteryScore + lastOutcome` 중심 모델을 `topic memory + attempt memory + teaching memory + prompt retrieval` 구조로 분리한다. 출제는 `new` / `review` lane으로 나누고, `review` 내부에서 `blocked > fuzzy > mastered_recovered > mastered_clean` 우선순위를 적용한다. 동시에 `study` 스레드에는 “아직 답 안 한 최신 DM이면 새 질문 대신 그 스레드로 유도”와 “무응답 한 번 재촉”을 붙여, 열린 학습 흐름이 끊기지 않게 만든다.

**Tech Stack:** Node ESM, node:test, sqlite3 CLI store, Slack DM/thread routing, Codex/Claude CLI runners

---

## Phase 1: Learning Memory Data Model

### Task 1: 새 topic memory taxonomy를 테스트로 정의

**Files:**
- Modify: `/Users/hwlee/Projects/Vector/test/domain/review-policy.test.js`
- Modify: `/Users/hwlee/Projects/Vector/src/domain/topic-memory.js`

**Step 1: Write the failing test**

추가할 테스트:
- `createEmptyTopicMemory()`가 `learningState`, `timesAsked`, `timesBlocked`, `timesRecovered`, `timesMasteredClean`, `timesMasteredRecovered`, `lastMisconceptionSummary`, `lastTeachingSummary`, `lastAskedAt`, `lastAnsweredAt`, `lastOutcome`, `nextReviewAt`를 기본값으로 가진다.
- outcome 전이가 아래 규칙으로 계산된다.
  - 첫 성공: `mastered_clean`
  - `blocked` 후 성공: `mastered_recovered`
  - 애매한 답변: `fuzzy`
  - 전혀 모름: `blocked`
- `new > review` lane에서 review 우선순위는 `blocked > fuzzy > mastered_recovered > mastered_clean`로 분류된다.

**Step 2: Run test to verify it fails**

Run: `npm test -- test/domain/review-policy.test.js`
Expected: FAIL because `topic-memory.js` still uses `masteryScore`-centric shape and old bucket logic.

**Step 3: Write minimal implementation**

구현 방향:
- `createEmptyTopicMemory()`를 새 shape로 바꾼다.
- 기존 `masteryScore`, `successCount`, `failureCount`, `masteredStreak` 중심 전이를 상태 중심 전이로 옮긴다.
- 기존 `pickNextTopic()`는 나중 Phase에서 옮길 것이므로, Phase 1에서는 상태 계산 helper와 review bucket helper만 먼저 안정화한다.

**Step 4: Run test to verify it passes**

Run: `npm test -- test/domain/review-policy.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add test/domain/review-policy.test.js src/domain/topic-memory.js
git commit -m "refactor: 학습 메모리 상태 모델 정의"
```

### Task 2: SQLite schema를 structured memory 기준으로 확장

**Files:**
- Modify: `/Users/hwlee/Projects/Vector/test/storage/sqlite-store.test.js`
- Modify: `/Users/hwlee/Projects/Vector/src/storage/sqlite-store.js`

**Step 1: Write the failing test**

추가할 테스트:
- `topic_memory`가 새 필드를 저장/복원한다.
- `attempts`가 `misconception_summary`, `answer_summary`, `attempt_kind` 같은 retrieval용 필드를 저장/복원한다.
- 새 `teaching_memory` 테이블이 `topic_id`, `thread_ts`, `teaching_summary`, `challenge_summary`, `created_at`를 저장/복원한다.
- `threads`가 `awaiting_user_reply_at`, `last_user_reply_at`, `reminder_sent_at`를 저장/복원한다.

**Step 2: Run test to verify it fails**

Run: `npm test -- test/storage/sqlite-store.test.js`
Expected: FAIL because current schema does not include structured memory or reminder-tracking columns.

**Step 3: Write minimal implementation**

구현 방향:
- `topic_memory` 컬럼을 새 shape로 확장한다.
- `attempts` 테이블에 retrieval용 요약 컬럼을 추가한다.
- `teaching_memory` 테이블을 신설한다.
- `threads`에 unanswered/re-reminder tracking 컬럼을 추가한다.
- 대응하는 `save*`, `get*`, `list*` accessor를 추가한다.

**Step 4: Run test to verify it passes**

Run: `npm test -- test/storage/sqlite-store.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add test/storage/sqlite-store.test.js src/storage/sqlite-store.js
git commit -m "feat: structured memory 저장소 추가"
```

## Phase 2: Evaluation Recording And Retrieval Context

### Task 3: thread handler가 attempt memory와 teaching memory를 기록하도록 바꾸기

**Files:**
- Modify: `/Users/hwlee/Projects/Vector/test/app/tutor-bot.test.js`
- Modify: `/Users/hwlee/Projects/Vector/src/app/tutor-thread-handler.js`
- Modify: `/Users/hwlee/Projects/Vector/src/domain/topic-memory.js`

**Step 1: Write the failing test**

추가할 테스트:
- `blocked` 시 `topic memory.learningState`가 `blocked`로 바뀌고 `teaching_memory`가 저장된다.
- `continue` 시 `learningState`가 `fuzzy`로 남고 attempt 요약이 저장된다.
- `mastered_clean`, `mastered_recovered`가 각각 다른 상태와 카운터를 남긴다.
- 같은 topic 재도전에서 `timesBlocked`, `timesRecovered`가 누적된다.

**Step 2: Run test to verify it fails**

Run: `npm test -- test/app/tutor-bot.test.js`
Expected: FAIL because current handler only writes legacy `attempts` and legacy `topic_memory`.

**Step 3: Write minimal implementation**

구현 방향:
- `evaluate`, `followup`, `teach` 결과를 저장할 때 새로운 topic memory transition helper를 사용한다.
- `saveAttempt()` payload에 retrieval 필드를 채운다.
- `blocked` teaching이 일어나면 `saveTeachingMemory()`를 호출한다.
- `mastered_clean` vs `mastered_recovered`는 `blockedOnce`뿐 아니라 새 memory counter와 함께 정리한다.

**Step 4: Run test to verify it passes**

Run: `npm test -- test/app/tutor-bot.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add test/app/tutor-bot.test.js src/app/tutor-thread-handler.js src/domain/topic-memory.js
git commit -m "feat: 학습 이력 기록 연결"
```

### Task 4: question/evaluate/followup/teach payload에 retrieval context를 붙이기

**Files:**
- Modify: `/Users/hwlee/Projects/Vector/test/domain/llm-runner.test.js`
- Modify: `/Users/hwlee/Projects/Vector/src/app/tutor-question-dispatcher.js`
- Modify: `/Users/hwlee/Projects/Vector/src/app/tutor-thread-handler.js`
- Modify: `/Users/hwlee/Projects/Vector/src/llm/codex-cli-runner.js`
- Modify: `/Users/hwlee/Projects/Vector/src/llm/claude-cli-runner.js`

**Step 1: Write the failing test**

추가할 테스트:
- `question` task payload가 `topicMemory`, `recentAttempts`, `latestTeachingMemory`를 포함한다.
- `evaluate`, `followup`, `teach` payload가 같은 topic의 이전 misconception / teaching summary를 포함한다.
- prompt instruction이 “repeat failure”, “recovered mastery”, “same misconception repeated”를 해석할 수 있게 바뀐다.

**Step 2: Run test to verify it fails**

Run: `npm test -- test/domain/llm-runner.test.js test/app/tutor-bot.test.js`
Expected: FAIL because current payloads only send `topicMemory` or thread-local challenge prompt.

**Step 3: Write minimal implementation**

구현 방향:
- dispatcher/handler에서 store accessor를 사용해 retrieval context를 조립한다.
- runner는 payload 구조를 그대로 prompt JSON에 싣고, task instructions에 retrieval usage rules를 추가한다.
- direct_qa에는 이 retrieval을 억지로 넣지 않는다. 이번 Phase는 `study`만 다룬다.

**Step 4: Run test to verify it passes**

Run: `npm test -- test/domain/llm-runner.test.js test/app/tutor-bot.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add test/domain/llm-runner.test.js test/app/tutor-bot.test.js src/app/tutor-question-dispatcher.js src/app/tutor-thread-handler.js src/llm/codex-cli-runner.js src/llm/claude-cli-runner.js
git commit -m "feat: retrieval 기반 프롬프트 컨텍스트 추가"
```

## Phase 3: Scheduler And Review Lanes

### Task 5: `new` / `review` lane scheduler를 테스트로 고정

**Files:**
- Modify: `/Users/hwlee/Projects/Vector/test/domain/review-policy.test.js`
- Modify: `/Users/hwlee/Projects/Vector/src/domain/topic-memory.js`
- Modify: `/Users/hwlee/Projects/Vector/src/app/tutor-question-dispatcher.js`

**Step 1: Write the failing test**

추가할 테스트:
- 신규 질문이 항상 review보다 높은 비중으로 선택된다.
- review lane이 선택되면 `blocked > fuzzy > mastered_recovered > mastered_clean` 순으로 고른다.
- 신규 topic이 충분히 남아 있으면 같은 review topic만 반복 뽑지 않는다.

**Step 2: Run test to verify it fails**

Run: `npm test -- test/domain/review-policy.test.js test/app/tutor-bot.test.js`
Expected: FAIL because current scheduler uses a single candidate pool with legacy bucket logic.

**Step 3: Write minimal implementation**

구현 방향:
- `pickNextTopic()`를 lane selector와 review selector로 나눈다.
- 기본 lane 비율은 `new: 60`, `review: 40`으로 둔다.
- `question dispatcher`는 먼저 lane을 고르고, review lane일 때만 due review 후보를 뽑는다.

**Step 4: Run test to verify it passes**

Run: `npm test -- test/domain/review-policy.test.js test/app/tutor-bot.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add test/domain/review-policy.test.js test/app/tutor-bot.test.js src/domain/topic-memory.js src/app/tutor-question-dispatcher.js
git commit -m "feat: 신규 우선 복습 스케줄러 추가"
```

## Phase 4: Unanswered DM Guidance And One-Time Nudge

### Task 6: `!start` 시 답 안 한 최신 study DM 유도 분기 추가

**Files:**
- Modify: `/Users/hwlee/Projects/Vector/test/app/tutor-bot.test.js`
- Modify: `/Users/hwlee/Projects/Vector/test/app/slack-message-router.test.js`
- Modify: `/Users/hwlee/Projects/Vector/src/app/tutor-session-controller.js`
- Modify: `/Users/hwlee/Projects/Vector/src/storage/sqlite-store.js`

**Step 1: Write the failing test**

추가할 테스트:
- 최근 incomplete study thread가 `open`이고 `last_user_reply_at`이 비어 있으면 `!start`는 새 DM을 보내지 않고 그 스레드에 고정 대사 4번을 단다.
- 이 경우 thread를 reopen하지 않고, 기존 `open` 상태를 유지한다.
- 이미 답변이 한 번이라도 있었던 study thread면 기존 재개 대사를 사용한다.

**Step 2: Run test to verify it fails**

Run: `npm test -- test/app/tutor-bot.test.js test/app/slack-message-router.test.js`
Expected: FAIL because current `!start` flow only distinguishes “stopped study” vs “no incomplete study”.

**Step 3: Write minimal implementation**

구현 방향:
- store에 “latest incomplete study thread + hasUserReply” 판단 helper를 추가한다.
- session controller가 `awaiting_first_reply` 상황과 `resume_existing_thread` 상황을 구분한다.
- 고정 문구 4번을 상수로 추가한다.

**Step 4: Run test to verify it passes**

Run: `npm test -- test/app/tutor-bot.test.js test/app/slack-message-router.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add test/app/tutor-bot.test.js test/app/slack-message-router.test.js src/app/tutor-session-controller.js src/storage/sqlite-store.js
git commit -m "feat: 무응답 study dm 유도 추가"
```

### Task 7: 답이 없을 때 한 번만 스레드 재촉을 보낸다

**Files:**
- Modify: `/Users/hwlee/Projects/Vector/test/runtime/study-loop.test.js`
- Modify: `/Users/hwlee/Projects/Vector/test/app/tutor-bot.test.js`
- Modify: `/Users/hwlee/Projects/Vector/src/runtime/study-loop.js`
- Modify: `/Users/hwlee/Projects/Vector/src/app/tutor-question-dispatcher.js`
- Modify: `/Users/hwlee/Projects/Vector/src/storage/sqlite-store.js`

**Step 1: Write the failing test**

추가할 테스트:
- 열린 study thread가 있고 아직 사용자 답이 없으면 일정 시간이 지난 뒤 한 번만 재촉을 보낸다.
- 이미 `reminder_sent_at`이 있으면 같은 thread에는 다시 재촉하지 않는다.
- 사용자가 답을 달면 reminder 상태가 초기화되고, 같은 스레드에서 다시 follow-up을 기다리는 경우 새 reminder를 한 번 보낼 수 있다.
- 재촉이 존재하는 동안에는 새 질문 DM을 보내지 않는다.

**Step 2: Run test to verify it fails**

Run: `npm test -- test/runtime/study-loop.test.js test/app/tutor-bot.test.js`
Expected: FAIL because current study loop only knows “schedule next question”, not unanswered reminder semantics.

**Step 3: Write minimal implementation**

구현 방향:
- `StudyLoop`에 “next question”과 별개로 “pending reminder” 슬롯을 추가하거나, dispatcher가 unanswered thread를 우선 점검하게 만든다.
- simplest path: `dispatchNextQuestion()` 시작 시 unanswered thread를 먼저 조회하고, reminder due이면 DM 새 발송 대신 해당 스레드에 재촉 reply를 단다.
- thread metadata로 `awaiting_user_reply_at`, `reminder_sent_at`, `last_user_reply_at`를 사용한다.

**Step 4: Run test to verify it passes**

Run: `npm test -- test/runtime/study-loop.test.js test/app/tutor-bot.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add test/runtime/study-loop.test.js test/app/tutor-bot.test.js src/runtime/study-loop.js src/app/tutor-question-dispatcher.js src/storage/sqlite-store.js
git commit -m "feat: 무응답 study 재촉 추가"
```

## Phase 5: Regression And Cleanup

### Task 8: 전체 회귀 검증과 dead path 정리

**Files:**
- Verify only
- Optionally Modify: `/Users/hwlee/Projects/Vector/src/domain/topic-memory.js`
- Optionally Modify: `/Users/hwlee/Projects/Vector/src/app/tutor-question-dispatcher.js`
- Optionally Modify: `/Users/hwlee/Projects/Vector/src/app/tutor-thread-handler.js`

**Step 1: Run focused regression**

Run: `npm test -- test/domain/review-policy.test.js test/storage/sqlite-store.test.js test/domain/llm-runner.test.js test/app/tutor-bot.test.js test/app/slack-message-router.test.js test/runtime/study-loop.test.js`
Expected: PASS

**Step 2: Run full suite**

Run: `npm test`
Expected: PASS

**Step 3: Review and remove dead helpers**

정리 후보:
- `masteryScore` 기반 잔재
- old bucket comments / names
- unanswered reminder와 충돌하는 legacy helper

**Step 4: Commit**

```bash
git add src/domain/topic-memory.js src/app/tutor-question-dispatcher.js src/app/tutor-thread-handler.js
git commit -m "refactor: structured memory 잔여 경로 정리"
```

### Task 9: Branch completion checkpoint

**Files:**
- Verify only

**Step 1: Check branch status**

Run: `git status --short`
Expected: empty working tree

**Step 2: Capture final verification**

Run: `npm test`
Expected: PASS

**Step 3: Prepare merge handoff**

정리 내용:
- structured memory schema
- lane scheduler
- unanswered study guidance
- one-time reminder

