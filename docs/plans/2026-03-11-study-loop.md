# Study Loop Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** `!start` 이후 열린 `study` 스레드가 끝날 때마다 `1~3분` 랜덤 지연 뒤 다음 질문을 자동으로 다시 던지는 런타임 루프를 추가합니다.

**Architecture:** `TutorBot`은 `study` 스레드 종료 여부만 반환하고, 새 `StudyLoop` 런타임 컴포넌트가 예약 타이머 1개를 관리합니다. `SlackMessageRouter`와 `SessionLifecycleManager`는 제어 명령 후 `StudyLoop`에 취소 신호를 전달하고, `main.js`가 전체 배선을 담당합니다.

**Tech Stack:** Node.js ESM, node:test, SQLite store, Slack Socket Mode runtime

---

### Task 1: 간격 정책과 TutorBot 보호조건

**Files:**
- Modify: `/Users/hwlee/Projects/Vector/src/app/interval-policy.js`
- Modify: `/Users/hwlee/Projects/Vector/src/app/tutor-bot.js`
- Test: `/Users/hwlee/Projects/Vector/test/app/interval-policy.test.js`
- Test: `/Users/hwlee/Projects/Vector/test/app/tutor-bot.test.js`

**Step 1: Write the failing tests**

- `interval-policy.test.js`에서 `1~3분` 범위와 `0.5 -> 2분` 기대값으로 수정
- `tutor-bot.test.js`에 열린 `study` 스레드가 있으면 `dispatchNextQuestion()`가 no-op인 테스트 추가
- `tutor-bot.test.js`에 `blocked`와 `mastered` 결과가 다음 질문 예약 신호를 반환하는 테스트 추가

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="랜덤 발송 간격|열린 study 스레드|다음 질문 예약"`

Expected: 기존 `10~20분` 기대값 또는 예약 신호 부재로 FAIL

**Step 3: Write minimal implementation**

- `createDispatchDelayMs()`를 `1~3분`으로 변경
- `dispatchNextQuestion()`가 열린 `study` 스레드가 있으면 즉시 `null` 반환
- `handleThreadMessage()`가 `blocked`/`mastered`에서 `shouldScheduleNextQuestion: true`를 포함하도록 수정

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="랜덤 발송 간격|열린 study 스레드|다음 질문 예약"`

Expected: PASS

### Task 2: StudyLoop 런타임 컴포넌트

**Files:**
- Create: `/Users/hwlee/Projects/Vector/src/runtime/study-loop.js`
- Test: `/Users/hwlee/Projects/Vector/test/runtime/study-loop.test.js`

**Step 1: Write the failing tests**

- 예약 시 지정 지연으로 타이머 1개를 잡는 테스트
- 예약 발화 시 `tutorBot.dispatchNextQuestion(now)`를 호출하는 테스트
- `stop` 또는 `start` 제어 후 예약이 취소되는 테스트
- 재예약 시 이전 타이머를 취소하는 테스트

**Step 2: Run test to verify it fails**

Run: `npm test -- /Users/hwlee/Projects/Vector/test/runtime/study-loop.test.js`

Expected: 모듈 부재 또는 메서드 부재로 FAIL

**Step 3: Write minimal implementation**

- `scheduleNextQuestion()` / `handleControlCommand()` / `cancelPendingDispatch()` 구현
- `setTimeout` / `clearTimeout` / `now` 주입으로 테스트 가능하게 작성
- 타이머 내부 에러는 logger로만 남김

**Step 4: Run test to verify it passes**

Run: `npm test -- /Users/hwlee/Projects/Vector/test/runtime/study-loop.test.js`

Expected: PASS

### Task 3: Router / lifecycle / main 배선

**Files:**
- Modify: `/Users/hwlee/Projects/Vector/src/app/slack-message-router.js`
- Modify: `/Users/hwlee/Projects/Vector/src/runtime/macos/session-lifecycle-manager.js`
- Modify: `/Users/hwlee/Projects/Vector/src/main.js`
- Test: `/Users/hwlee/Projects/Vector/test/app/slack-message-router.test.js`
- Test: `/Users/hwlee/Projects/Vector/test/runtime/macos/session-lifecycle-manager.test.js`

**Step 1: Write the failing tests**

- control command 적용 후 router가 `StudyLoop` hook을 호출하는 테스트
- study 스레드가 닫힌 뒤 router가 예약 hook을 호출하는 테스트
- lifecycle manager가 start/stop 적용 뒤 cancel hook을 호출하는 테스트

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="study loop|lifecycle manager|router"`

Expected: hook 미호출로 FAIL

**Step 3: Write minimal implementation**

- router에 `onControlCommandApplied`, `onStudyThreadClosed` hook 추가
- lifecycle manager에 `onControlCommandApplied` hook 추가
- `main.js`에서 `StudyLoop` 인스턴스를 만들고 router/lifecycle에 연결

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="study loop|lifecycle manager|router"`

Expected: PASS

### Task 4: 전체 검증과 문서 확인

**Files:**
- Verify: `/Users/hwlee/Projects/Vector/README.md`

**Step 1: Run the full test suite**

Run: `npm test`

Expected: all tests PASS

**Step 2: Smoke-check runtime wiring**

Run: `npm start`

Expected: core init log, Slack transport start log if env is set, no immediate crash

**Step 3: Final review**

- 불필요한 API나 설정이 없는지 확인
- auto-start / stop 동작과 충돌하는 지점이 없는지 확인
