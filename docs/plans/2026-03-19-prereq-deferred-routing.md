# Prerequisite Deferred Routing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 사용자가 현재 질문을 감당하기 어려운 경우 스레드를 미완(deferred)으로 종료하고, 하위 개념 질문을 우선 배치한 뒤 원 질문 재검증을 나중으로 미룬다.

**Architecture:** 기존 `blocked`와 별개로 `deferred` 의미를 추가해 “조금 막힘”과 “수준 미스매치”를 분리한다. 스케줄러는 `prereq > normal > deferred` 우선순위를 강제하고, deferred 질문은 prerequisite 충족 전까지 재출제하지 않는다. 별도 `root` 명시는 두지 않고, 일반 deferred 항목으로 통합 관리한다.

**Tech Stack:** Node.js ESM, sqlite3 CLI, built-in test runner, topic memory scheduler, Slack DM thread flow

---

### Task 1: Deferred 의미 추가

**Files:**
- Modify: `src/domain/topic-memory.js`
- Modify: `src/storage/sqlite-store.js`
- Modify: `test/domain/review-policy.test.js`
- Modify: `test/storage/sqlite-store.test.js`

**Step 1: Write the failing test**

`learningState=deferred`가 기존 `blocked`와 다르게 분류되는 테스트를 추가합니다.

**Step 2: Run test to verify it fails**

Run: `node --test test/domain/review-policy.test.js test/storage/sqlite-store.test.js`  
Expected: FAIL (`deferred` 미분류/미저장)

**Step 3: Write minimal implementation**

- `deferred` 상태를 메모리/저장소 직렬화에 추가
- 기존 상태와의 하위호환 유지

**Step 4: Run test to verify it passes**

Run: `node --test test/domain/review-policy.test.js test/storage/sqlite-store.test.js`  
Expected: PASS

**Step 5: Commit**

```bash
git add src/domain/topic-memory.js src/storage/sqlite-store.js test/domain/review-policy.test.js test/storage/sqlite-store.test.js
git commit -m "feat: deferred 상태 추가"
```

### Task 2: Prerequisite 우선순위 도입

**Files:**
- Create: `src/domain/prerequisite-policy.js`
- Modify: `src/app/tutor-question-dispatcher.js`
- Modify: `src/storage/sqlite-store.js`
- Create: `test/domain/prerequisite-policy.test.js`
- Modify: `test/app/tutor-bot.test.js`

**Step 1: Write the failing test**

스케줄러 우선순위가 `prereq > normal > deferred`로 동작하는 테스트를 추가합니다.

**Step 2: Run test to verify it fails**

Run: `node --test test/domain/prerequisite-policy.test.js test/app/tutor-bot.test.js`  
Expected: FAIL (기존 스케줄러는 prerequisite 개념이 없음)

**Step 3: Write minimal implementation**

- prerequisite 후보 큐 조회 로직 추가
- deferred topic은 prerequisite 충족 전까지 제외
- 기존 open-thread 가드/리마인더 로직 유지

**Step 4: Run test to verify it passes**

Run: `node --test test/domain/prerequisite-policy.test.js test/app/tutor-bot.test.js`  
Expected: PASS

**Step 5: Commit**

```bash
git add src/domain/prerequisite-policy.js src/app/tutor-question-dispatcher.js src/storage/sqlite-store.js test/domain/prerequisite-policy.test.js test/app/tutor-bot.test.js
git commit -m "feat: prerequisite 우선순위 도입"
```

### Task 3: 수준 미스매치 종료 플로우 연결

**Files:**
- Modify: `src/app/tutor-thread-handler.js`
- Modify: `src/llm/codex-cli-runner.js`
- Modify: `test/app/tutor-bot.test.js`

**Step 1: Write the failing test**

“도저히 현재 질문을 감당 못함” 신호에서:
- 현재 스레드 `deferred` 종료
- 안내 문구 전송
- prerequisite topic enqueue

검증 테스트를 추가합니다.

**Step 2: Run test to verify it fails**

Run: `node --test test/app/tutor-bot.test.js`  
Expected: FAIL (deferred 종료/큐 연결 미구현)

**Step 3: Write minimal implementation**

- evaluate 결과에 `blocked_prereq`(또는 동등 플래그) 수용
- 스레드 종료 사유 `deferred`
- prerequisite enqueue 기록

**Step 4: Run test to verify it passes**

Run: `node --test test/app/tutor-bot.test.js`  
Expected: PASS

**Step 5: Commit**

```bash
git add src/app/tutor-thread-handler.js src/llm/codex-cli-runner.js test/app/tutor-bot.test.js
git commit -m "feat: 수준 미스매치 defer 연결"
```

### Task 4: 회귀 검증

**Files:**
- Modify: `docs/plans/2026-03-19-prereq-deferred-routing.md` (필요 시 구현 결과 반영)

**Step 1: Run full test suite**

Run: `npm test`  
Expected: PASS

**Step 2: Commit**

```bash
git add .
git commit -m "feat: deferred prerequisite 플로우 도입"
```
