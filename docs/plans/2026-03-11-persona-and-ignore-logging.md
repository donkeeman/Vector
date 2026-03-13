# Persona And Ignore Logging Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Vector의 전역 도발 톤을 강화하고, ignored 메시지 로그에 원인 필드를 추가합니다.

**Architecture:** 전역 시스템 프롬프트와 task 지시문을 함께 강화해 출력 편차를 줄이고, 라우터 필터는 그대로 둔 채 ignored 로그에 진단 필드만 추가합니다.

**Tech Stack:** Node.js ESM, node:test

---

### Task 1: 실패 테스트 추가

**Files:**
- Modify: `/Users/hwlee/Projects/Vector/test/persona/vector-system-prompt.test.js`
- Modify: `/Users/hwlee/Projects/Vector/test/domain/llm-runner.test.js`
- Modify: `/Users/hwlee/Projects/Vector/test/app/slack-message-router.test.js`

**Step 1: Write the failing tests**

- 시스템 프롬프트에 도발적 시작/칭찬 배제/단어 나열 비판/정답 시 짜증 표현 기대값 추가
- 주요 task 지시문이 강한 Vector 톤을 포함하는지 기대값 추가
- ignored 로그가 `channelType`, `botId`, `hasText`, `hasThreadTs` 등을 포함하는지 테스트 추가

**Step 2: Run test to verify it fails**

Run: `npm test -- /Users/hwlee/Projects/Vector/test/persona/vector-system-prompt.test.js /Users/hwlee/Projects/Vector/test/domain/llm-runner.test.js /Users/hwlee/Projects/Vector/test/app/slack-message-router.test.js`

Expected: 새 기대값 부재로 FAIL

### Task 2: 최소 구현

**Files:**
- Modify: `/Users/hwlee/Projects/Vector/src/persona/vector-system-prompt.js`
- Modify: `/Users/hwlee/Projects/Vector/src/llm/codex-cli-runner.js`
- Modify: `/Users/hwlee/Projects/Vector/src/app/slack-message-router.js`

**Step 1: Write minimal implementation**

- 시스템 프롬프트에 초기 페르소나 표현 반영
- 주요 task 지시문을 더 직접적이고 도발적으로 강화
- ignored 로그에 진단 필드 추가

**Step 2: Run targeted tests**

Run: `npm test -- /Users/hwlee/Projects/Vector/test/persona/vector-system-prompt.test.js /Users/hwlee/Projects/Vector/test/domain/llm-runner.test.js /Users/hwlee/Projects/Vector/test/app/slack-message-router.test.js`

Expected: PASS

### Task 3: 전체 검증

**Step 1: Run full test suite**

Run: `npm test`

Expected: all tests PASS
