# LLM Offtopic Gate Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 로컬 기술 allowlist를 제거하고, direct Q&A 계열 프롬프트가 비기술 질문을 고정 거절문으로 처리하게 만듭니다.

**Architecture:** 라우터는 제어 명령, 고정문구, 스레드 redirect만 로컬 처리하고, 나머지 root DM/direct_qa 메시지는 모두 direct Q&A task로 보냅니다. off-topic 차단은 LLM 지시문으로 이동합니다.

**Tech Stack:** Node.js ESM, node:test

---

### Task 1: 실패 테스트 추가

**Files:**
- Modify: `/Users/hwlee/Projects/Vector/test/app/slack-message-router.test.js`
- Modify: `/Users/hwlee/Projects/Vector/test/domain/llm-runner.test.js`

**Step 1: Write the failing tests**

- `ETag와 Last-Modified가 뭐야?`가 `direct_question`으로 전달되는 테스트
- `오늘 점심 뭐 먹지`가 로컬 차단되지 않고 `direct_question`으로 전달되는 테스트
- `direct_qa` 스레드의 비기술 질문이 `direct_followup`으로 전달되는 테스트
- `direct_question` / `direct_followup` 지시문이 비기술 질문 거절 규칙을 포함하는지 테스트

**Step 2: Run test to verify it fails**

Run: `npm test -- /Users/hwlee/Projects/Vector/test/app/slack-message-router.test.js /Users/hwlee/Projects/Vector/test/domain/llm-runner.test.js`

Expected: 기존 로컬 off-topic 차단 때문에 FAIL

### Task 2: 최소 구현

**Files:**
- Modify: `/Users/hwlee/Projects/Vector/src/app/slack-message-router.js`
- Modify: `/Users/hwlee/Projects/Vector/src/llm/codex-cli-runner.js`

**Step 1: Write minimal implementation**

- router에서 `isAllowedTechnicalQuestion()` 분기를 제거
- root DM은 redirect 조건이 아니면 모두 `direct_question`
- direct_qa thread는 shortcut 외에는 모두 `direct_followup`
- direct Q&A 지시문에 비기술 질문 시 고정 거절문만 반환하라는 규칙 추가

**Step 2: Run targeted tests**

Run: `npm test -- /Users/hwlee/Projects/Vector/test/app/slack-message-router.test.js /Users/hwlee/Projects/Vector/test/domain/llm-runner.test.js`

Expected: PASS

### Task 3: 전체 검증

**Step 1: Run full test suite**

Run: `npm test`

Expected: all tests PASS
