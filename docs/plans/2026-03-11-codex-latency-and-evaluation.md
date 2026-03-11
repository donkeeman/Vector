# Vector Codex Latency And Evaluation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Codex 응답 시간을 줄이기 위해 task별 reasoning과 `--ephemeral`을 적용하고, 사용자가 명시적으로 막혔을 때는 더 빨리 `blocked -> teach`로 전환한다.

**Architecture:** `CodexCliRunner`는 task별 실행 프로필을 바탕으로 reasoning config override와 `--ephemeral`을 붙여 실행한다. `TutorBot`은 `evaluate` 결과가 `continue`여도 답변 텍스트에 강한 uncertainty 신호가 있으면 로컬 override로 `blocked` 처리하고 `teach` 경로로 보낸다. `teach` prompt는 직전 막힘 포인트를 직접 설명하도록 강화한다.

**Tech Stack:** Node.js ESM, built-in test runner, Codex CLI

---

### Task 1: runner 실행 프로필을 failing test로 고정

**Files:**
- Modify: `src/llm/codex-cli-runner.js`
- Modify: `test/domain/llm-runner.test.js`
- Test: `test/domain/llm-runner.test.js`

**Step 1: Write the failing test**

- `evaluate` task args에 `model_reasoning_effort="high"`가 들어가는 테스트를 추가한다.
- `direct_question` task args에 `model_reasoning_effort="medium"`과 `--ephemeral`이 들어가는 테스트를 추가한다.

**Step 2: Run test to verify it fails**

Run: `node --test test/domain/llm-runner.test.js`
Expected: FAIL because runner has no task-specific args builder yet.

**Step 3: Write minimal implementation**

- task별 execution profile과 args builder를 도입한다.
- 공통으로 `--ephemeral`을 붙인다.

**Step 4: Run test to verify it passes**

Run: `node --test test/domain/llm-runner.test.js`
Expected: PASS

### Task 2: explicit uncertainty override를 failing test로 고정

**Files:**
- Modify: `test/app/tutor-bot.test.js`
- Modify: `src/app/tutor-bot.js`
- Test: `test/app/tutor-bot.test.js`

**Step 1: Write the failing test**

- `evaluate`가 `continue`를 반환해도 답변이 `그것까지는 모르겠어`면 `teach`가 호출되고 스레드가 `blocked`로 닫히는 테스트를 추가한다.

**Step 2: Run test to verify it fails**

Run: `node --test test/app/tutor-bot.test.js`
Expected: FAIL because current code always `continue -> followup`.

**Step 3: Write minimal implementation**

- uncertainty phrase 헬퍼를 만들고 `continue` 경로 전에 override를 적용한다.

**Step 4: Run test to verify it passes**

Run: `node --test test/app/tutor-bot.test.js`
Expected: PASS

### Task 3: teach prompt를 막힘 지점 중심으로 강화

**Files:**
- Modify: `src/llm/codex-cli-runner.js`
- Modify: `test/domain/llm-runner.test.js`
- Test: `test/domain/llm-runner.test.js`

**Step 1: Write the failing test**

- `teach` instruction에 “직전 막힘 포인트”와 “질문에 대한 정답 구조”를 직접 설명하라는 문구가 들어가는지 검증한다.

**Step 2: Run test to verify it fails**

Run: `node --test test/domain/llm-runner.test.js`
Expected: FAIL because current instruction is too generic.

**Step 3: Write minimal implementation**

- `teach` task instruction을 강화한다.

**Step 4: Run test to verify it passes**

Run: `node --test test/domain/llm-runner.test.js`
Expected: PASS

### Task 4: 전체 회귀 검증

**Files:**
- Test: `npm test`

**Step 1: Run full test suite**

Run: `npm test`
Expected: PASS
