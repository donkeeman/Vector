# Blocked Recovery State Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** blocked teaching을 같은 스레드에서 계속 이어가고, mastery를 clean/recovered로 나눠 사용자 표시와 복습 간격에 반영한다.

**Architecture:** study thread는 `blocked` 이후에도 `open`을 유지하고 `blockedOnce` 플래그로 회복형 mastery를 판정한다. topic memory에는 `lastMasteryKind`를 추가해 recovered mastery는 clean mastery보다 더 짧은 간격으로 재출제한다. major transition에서는 상태 답글을 추가로 남긴다.

**Tech Stack:** Node ESM, node:test, sqlite3 CLI

---

### Task 1: review policy 테스트 추가

**Files:**
- Modify: `/Users/hwlee/Projects/Vector/test/domain/review-policy.test.js`
- Modify: `/Users/hwlee/Projects/Vector/src/domain/topic-memory.js`

**Step 1: Write the failing test**
- clean mastery와 recovered mastery의 nextReviewAt이 다르게 나오는 테스트를 추가한다.
- recovered mastery가 clean보다 한 단계 짧은 간격인지 검증한다.

**Step 2: Run test to verify it fails**

Run: `npm test -- test/domain/review-policy.test.js`
Expected: FAIL because memory does not track mastery kind yet.

**Step 3: Write minimal implementation**
- topic memory에 `lastMasteryKind`를 추가한다.
- `scheduleReview`와 `updateTopicMemory`가 mastery kind를 받아 다르게 계산하게 한다.

**Step 4: Run test to verify it passes**

Run: `npm test -- test/domain/review-policy.test.js`
Expected: PASS

### Task 2: tutor bot blocked/open teaching 테스트 추가

**Files:**
- Modify: `/Users/hwlee/Projects/Vector/test/app/tutor-bot.test.js`
- Modify: `/Users/hwlee/Projects/Vector/src/app/tutor-bot.js`
- Modify: `/Users/hwlee/Projects/Vector/src/domain/thread-policy.js`

**Step 1: Write the failing test**
- blocked 시 teaching 답글 + blocked 상태 답글이 나가고 thread가 계속 `open`인지 검증한다.
- blocked 이후 mastery가 나오면 recovered mastery 상태 답글을 쓰고 닫는지 검증한다.
- 처음부터 mastery면 clean mastery 상태 답글을 쓰고 닫는지 검증한다.

**Step 2: Run test to verify it fails**

Run: `npm test -- test/app/tutor-bot.test.js`
Expected: FAIL because blocked currently closes the thread and mastery kind is not split.

**Step 3: Write minimal implementation**
- thread에 `blockedOnce`를 추가한다.
- blocked 결과는 `open` 유지 + 상태 답글 추가로 바꾼다.
- mastery 시 `blockedOnce`에 따라 clean/recovered를 판정하고 상태 답글을 다르게 보낸다.

**Step 4: Run test to verify it passes**

Run: `npm test -- test/app/tutor-bot.test.js`
Expected: PASS

### Task 3: stale cleanup 상태 답글 추가

**Files:**
- Modify: `/Users/hwlee/Projects/Vector/test/app/tutor-bot.test.js`
- Modify: `/Users/hwlee/Projects/Vector/src/app/tutor-bot.js`
- Modify: `/Users/hwlee/Projects/Vector/src/runtime/macos/session-lifecycle-manager.js`

**Step 1: Write the failing test**
- stale cleanup이 study thread를 닫기 전에 stale 상태 답글을 남기는지 검증한다.

**Step 2: Run test to verify it fails**

Run: `npm test -- test/app/tutor-bot.test.js test/runtime/macos/session-lifecycle-manager.test.js`
Expected: FAIL because stale cleanup only closes the thread.

**Step 3: Write minimal implementation**
- stale cleanup helper가 Slack thread reply를 남기고 그 뒤 stale로 닫게 한다.
- lifecycle start 경로는 그대로 이 helper만 호출한다.

**Step 4: Run test to verify it passes**

Run: `npm test -- test/app/tutor-bot.test.js test/runtime/macos/session-lifecycle-manager.test.js`
Expected: PASS

### Task 4: store compatibility

**Files:**
- Modify: `/Users/hwlee/Projects/Vector/src/storage/sqlite-store.js`
- Modify: `/Users/hwlee/Projects/Vector/test/storage/sqlite-store.test.js`

**Step 1: Write the failing test**
- thread의 `blockedOnce`, topic memory의 `lastMasteryKind` 저장/복원이 되는지 검증한다.

**Step 2: Run test to verify it fails**

Run: `npm test -- test/storage/sqlite-store.test.js`
Expected: FAIL because schema and mapping are missing.

**Step 3: Write minimal implementation**
- sqlite schema migration과 row mapping을 추가한다.

**Step 4: Run test to verify it passes**

Run: `npm test -- test/storage/sqlite-store.test.js`
Expected: PASS

### Task 5: 전체 검증

**Files:**
- Verify only

**Step 1: Run focused regression**

Run: `npm test -- test/domain/review-policy.test.js test/app/tutor-bot.test.js test/storage/sqlite-store.test.js test/runtime/macos/session-lifecycle-manager.test.js`
Expected: PASS

**Step 2: Run full suite**

Run: `npm test`
Expected: PASS
