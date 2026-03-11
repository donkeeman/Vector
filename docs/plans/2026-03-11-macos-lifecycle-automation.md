# Vector macOS Lifecycle Automation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** macOS 로그인/잠금/깨움 lifecycle에 맞춰 Vector 세션을 자동으로 시작/중지하고, `!start`/`!stop`은 Slack에서 무음 명령으로 동작하게 만든다.

**Architecture:** `TutorBot`에 무음 `start/stop` 적용 경로를 추가하고, Slack 라우터와 macOS lifecycle monitor가 이 경로를 공통 사용한다. macOS lifecycle monitor는 repo 안의 Swift 스크립트를 child process로 실행해 sleep/wake/lock/unlock 이벤트를 JSON line으로 전달하고, `main.js`는 이를 받아 세션을 자동 제어한다. 로그인 자동 실행은 LaunchAgent 템플릿과 설치 스크립트로 제공한다.

**Tech Stack:** Node.js ESM, built-in test runner, sqlite3 CLI, Slack Socket Mode, macOS `launchd`, Swift script runtime

---

### Task 1: 무음 `!start`/`!stop` 기대 동작을 failing test로 고정

**Files:**
- Modify: `test/app/slack-message-router.test.js`
- Modify: `test/app/tutor-bot.test.js`
- Test: `test/app/slack-message-router.test.js`
- Test: `test/app/tutor-bot.test.js`

**Step 1: Write the failing test**

- `!start`와 `!stop`이 Slack reply를 남기지 않는 테스트로 바꾼다.
- `TutorBot`에서 `start`가 active 상태면 세션을 그대로 유지하는 테스트를 추가한다.

**Step 2: Run tests to verify they fail**

Run: `node --test test/app/slack-message-router.test.js test/app/tutor-bot.test.js`
Expected: FAIL because router still posts confirmation replies and `start` is not idempotent.

**Step 3: Write minimal implementation**

- `TutorBot`에 `startSession()` / `stopSession()` 같은 내부 경로를 추가한다.
- Slack router는 `!start` / `!stop`에서 reply 없이 이 경로만 호출하게 바꾼다.

**Step 4: Run tests to verify they pass**

Run: `node --test test/app/slack-message-router.test.js test/app/tutor-bot.test.js`
Expected: PASS

### Task 2: macOS lifecycle event 매핑을 failing test로 고정

**Files:**
- Create: `src/runtime/macos/session-lifecycle-manager.js`
- Create: `test/runtime/macos/session-lifecycle-manager.test.js`
- Test: `test/runtime/macos/session-lifecycle-manager.test.js`

**Step 1: Write the failing test**

- `screen_locked`, `system_will_sleep`는 `stop`
- `screen_unlocked`, `system_did_wake`는 `start`
- 중복 `start`/`stop` 이벤트가 와도 idempotent 제어 경로를 타는지 검증한다.

**Step 2: Run test to verify it fails**

Run: `node --test test/runtime/macos/session-lifecycle-manager.test.js`
Expected: FAIL because manager does not exist.

**Step 3: Write minimal implementation**

Node lifecycle manager를 만들고, `onEvent(eventName)`이 `TutorBot` start/stop 내부 경로를 호출하게 구현한다.

**Step 4: Run test to verify it passes**

Run: `node --test test/runtime/macos/session-lifecycle-manager.test.js`
Expected: PASS

### Task 3: Swift monitor와 main 배선을 추가

**Files:**
- Create: `src/runtime/macos/power-events.swift`
- Create: `src/runtime/macos/session-lifecycle-monitor.js`
- Modify: `src/config.js`
- Modify: `src/main.js`
- Modify: `.env.example`
- Test: `npm test`

**Step 1: Write minimal implementation**

- Swift 스크립트가 sleep/wake/lock/unlock 이벤트를 JSON line으로 출력하게 만든다.
- Node monitor가 스크립트를 실행하고 lifecycle manager로 이벤트를 전달하게 만든다.
- `main.js`가 초기화 직후 auto-start를 적용하고, monitor를 darwin에서만 시작하게 만든다.
- 필요한 env 플래그를 추가한다.

**Step 2: Run full tests**

Run: `npm test`
Expected: PASS

### Task 4: LaunchAgent 설치 경로를 repo 안에 준비

**Files:**
- Create: `scripts/install-launch-agent.sh`
- Create: `scripts/uninstall-launch-agent.sh`
- Create: `ops/macos/com.donkeeman.vector.plist.template`
- Modify: `README.md`

**Step 1: Add template and scripts**

- 현재 workspace 경로와 node 실행 경로를 반영하는 설치 스크립트를 만든다.
- uninstall 스크립트도 같이 둔다.

**Step 2: Document usage**

- README에 설치/해제 방법과 재로그인 없이 `launchctl bootstrap/kickstart`로 반영하는 방법을 적는다.

**Step 3: Re-run tests**

Run: `npm test`
Expected: PASS
