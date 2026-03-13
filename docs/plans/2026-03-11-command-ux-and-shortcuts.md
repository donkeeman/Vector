# Vector Command UX And Shortcut Matching Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Vector DM 인터페이스를 `!start`, `!stop`, `!help`로 통일하고, 자기소개/사용법 고정 응답을 키워드 조합 규칙으로 판정한다.

**Architecture:** 제어 명령 정규화는 `!start`와 `!stop`만 남기고, `!help`는 라우터의 shortcut matcher가 처리한다. shortcut matcher는 별도 헬퍼에서 소개/사용법 intent를 키워드 조합으로 판정하고, 라우터는 이 결과를 루트 DM과 direct_qa 스레드 reply 양쪽에서 재사용한다.

**Tech Stack:** Node.js ESM, built-in test runner, sqlite3 CLI, Slack Socket Mode

---

### Task 1: 제어 명령 기대값을 failing test로 고정

**Files:**
- Modify: `test/app/control-command.test.js`
- Modify: `src/app/control-command.js`
- Test: `test/app/control-command.test.js`

**Step 1: Write the failing test**

`!start`, `!stop`만 정규화되고, `start`, `/study-start`, `resume`, `end`는 `null`이 되도록 테스트를 바꾼다.

**Step 2: Run test to verify it fails**

Run: `node --test test/app/control-command.test.js`
Expected: FAIL because legacy aliases are still accepted.

**Step 3: Write minimal implementation**

`normalizeControlCommand()` alias 맵을 `!start`, `!stop`만 남기도록 최소 수정한다.

**Step 4: Run test to verify it passes**

Run: `node --test test/app/control-command.test.js`
Expected: PASS

### Task 2: shortcut 동작을 failing test로 고정

**Files:**
- Modify: `test/app/slack-message-router.test.js`
- Test: `test/app/slack-message-router.test.js`

**Step 1: Write the failing test**

- `!help`가 LLM 없이 사용법 문구로 답하는 테스트를 추가한다.
- 소개/사용법 문구가 `!start`, `!stop`, `!help` 기준으로 바뀐 것을 검증한다.
- `정체가 뭐야`, `이름이 뭐야` 같은 변형이 소개 응답으로 가는 테스트를 추가한다.

**Step 2: Run test to verify it fails**

Run: `node --test test/app/slack-message-router.test.js`
Expected: FAIL because router still uses regex-based matcher and old copy.

**Step 3: Write minimal implementation**

필요한 matcher 헬퍼를 만들고, 라우터가 `!help`와 키워드 shortcut을 새 규칙으로 처리하게 바꾼다.

**Step 4: Run test to verify it passes**

Run: `node --test test/app/slack-message-router.test.js`
Expected: PASS

### Task 3: shortcut matcher를 구현하고 문구를 정리

**Files:**
- Create: `src/app/direct-qa-shortcut.js`
- Modify: `src/app/slack-message-router.js`
- Test: `test/app/slack-message-router.test.js`

**Step 1: Write minimal implementation**

- 소개/사용법 intent를 반환하는 키워드 조합 헬퍼를 구현한다.
- `slack-message-router.js`에서 정규식 `getDirectQaShortcutReply()`를 제거하고 새 헬퍼를 사용한다.
- 사용법/오프트픽 문구를 `!start`, `!stop`, `!help` 기준으로 바꾼다.

**Step 2: Run focused tests**

Run: `node --test test/app/slack-message-router.test.js test/app/control-command.test.js`
Expected: PASS

### Task 4: 전체 회귀 검증

**Files:**
- Modify: `README.md` (if needed)
- Test: `npm test`

**Step 1: Run full test suite**

Run: `npm test`
Expected: PASS

**Step 2: Refresh docs only if user-facing command text appears anywhere stale**

필요하면 README의 명령 예시만 최소 수정한다.

**Step 3: Re-run full suite**

Run: `npm test`
Expected: PASS
