# Stale Study Thread Reset Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 앱 시작/깨움 시 남아 있는 열린 study 스레드를 stale로 닫아 테스트 중 자동 질문이 다시 시작되게 한다.

**Architecture:** lifecycle start 경로에서만 stale cleanup을 호출하고, manual `!start` 동작은 유지한다. TutorBot이 열린 study 스레드를 닫는 helper를 제공하고 SessionLifecycleManager가 launch/wake/unlock 전에 호출한다.

**Tech Stack:** Node ESM, node:test, in-memory test doubles

---

### Task 1: 튜터봇 stale cleanup 테스트 추가

**Files:**
- Modify: `/Users/hwlee/Projects/Vector/test/app/tutor-bot.test.js`

**Step 1: Write the failing test**
- 열린 study 스레드 하나와 열린 direct_qa 스레드 하나를 store에 넣는다.
- `closeOpenStudyThreadsAsStale(now)` 호출 후 study만 `stale`로 닫히는지 검증한다.

**Step 2: Run test to verify it fails**

Run: `npm test -- test/app/tutor-bot.test.js`
Expected: FAIL because helper does not exist yet.

**Step 3: Write minimal implementation**
- `TutorBot`에 stale cleanup helper를 추가한다.

**Step 4: Run test to verify it passes**

Run: `npm test -- test/app/tutor-bot.test.js`
Expected: PASS

### Task 2: lifecycle manager start 경로 테스트 추가

**Files:**
- Modify: `/Users/hwlee/Projects/Vector/test/runtime/macos/session-lifecycle-manager.test.js`

**Step 1: Write the failing test**
- `handleAppLaunch`, `system_did_wake`, `screen_unlocked`에서 stale cleanup이 start 전에 호출되는지 검증한다.

**Step 2: Run test to verify it fails**

Run: `npm test -- test/runtime/macos/session-lifecycle-manager.test.js`
Expected: FAIL because cleanup is not called yet.

**Step 3: Write minimal implementation**
- `SessionLifecycleManager`가 launch/start 이벤트에서 stale cleanup 후 `applyControlCommand("start")`를 호출하게 한다.

**Step 4: Run test to verify it passes**

Run: `npm test -- test/runtime/macos/session-lifecycle-manager.test.js`
Expected: PASS

### Task 3: 전체 검증

**Files:**
- Verify only

**Step 1: Run focused regression**

Run: `npm test -- test/app/tutor-bot.test.js test/runtime/macos/session-lifecycle-manager.test.js`
Expected: PASS

**Step 2: Run full suite**

Run: `npm test`
Expected: PASS
