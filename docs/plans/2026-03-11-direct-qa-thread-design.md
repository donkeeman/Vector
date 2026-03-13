# Vector Direct Q&A Thread Persistence Design

**Date:** 2026-03-11

## Goal

사용자가 루트 DM으로 직접 던진 기술 질문도 저장형 스레드로 취급해서, 같은 스레드의 꼬리질문에 맥락을 유지하며 계속 답할 수 있게 만듭니다. 동시에 자기소개/사용법은 고정문구로 빠르게 응답합니다.

## Current Problem

- 현재 자동 질문으로 열린 학습 스레드만 `threads`에 저장됩니다.
- 루트 DM 직접 질문은 답글만 달고 상태를 저장하지 않으므로, 그 아래 스레드 답글은 `getThread(threadTs)`에서 `null`이 되어 무시됩니다.
- 그래서 사용자는 direct question에 대한 follow-up을 달아도 아무 반응을 받지 못합니다.

## Requirements

- 루트 DM 기술 질문은 새 `direct_qa` 스레드로 저장되어야 합니다.
- 해당 스레드의 reply는 이전 대화 맥락을 기반으로 계속 이어져야 합니다.
- 학습 스레드(`study`)의 기존 평가/teach/followup 흐름은 유지합니다.
- 자기소개(`너 누구야`)와 사용법(`뭐 할 수 있어`, `어떻게 써`)은 고정문구로 즉답합니다.
- 오프트픽 차단 정책은 유지합니다.

## Approach

### 1. Thread kind separation

- `threads`에 `kind` 컬럼을 추가합니다.
- 값은 `study` 또는 `direct_qa`입니다.
- 기존 학습 스레드는 기본적으로 `study`로 간주되도록 마이그레이션합니다.
- `topic_id`는 direct Q&A에는 필요 없으므로 nullable로 다루는 새 매핑 로직을 도입합니다.

### 2. Direct Q&A history storage

- `direct_qa_messages` 테이블을 추가합니다.
- 각 row는 `thread_ts`, `role` (`user`/`assistant`), `text`, `recorded_at`를 가집니다.
- 루트 DM direct question 처리 시:
  - 새 `direct_qa` thread 저장
  - user turn 저장
  - assistant 답변 후 assistant turn 저장
- 이후 스레드 reply도 같은 방식으로 turn을 누적합니다.

### 3. Routing split

- `SlackMessageRouter`는 루트 DM에서 세 갈래로 분기합니다.
  - 자기소개/사용법: 고정문구 reply
  - 기술 질문: 새 direct_qa thread 생성 후 `direct_question`
  - 비기술 질문: 기존 차단문구
- 스레드 reply가 들어오면:
  - `study` thread -> 기존 `TutorBot.handleThreadMessage()`
  - `direct_qa` thread -> 새 direct Q&A 핸들러

### 4. LLM task

- `direct_followup` task를 추가합니다.
- 입력 payload에는 최근 direct Q&A turns와 새 user message를 넣습니다.
- 출력은 기존과 동일하게 `{ "text": "..." }`입니다.

## Data Flow

1. User sends root DM technical question
2. Router classifies as allowed technical question
3. Store creates `threads.kind = direct_qa`
4. Store appends user message
5. `llmRunner.runTask("direct_question", ...)`
6. Slack replies in same thread
7. Store appends assistant message
8. User replies in thread
9. Router loads thread by `thread_ts`
10. If `kind === direct_qa`, load recent direct Q&A history and call `direct_followup`
11. Reply in same thread and append assistant turn

## Error Handling

- direct Q&A follow-up failure도 같은 스레드에 기존 실패 문구를 답합니다.
- 자기소개/사용법은 로컬 고정문구라 실패 지점이 없습니다.
- direct Q&A thread가 저장되기 전에 실패하면 스레드 기록만 남고 assistant turn이 빠질 수 있으나, 이후 follow-up 문맥에는 큰 문제가 없도록 user turn 기준으로 구성합니다.

## Testing

- 루트 DM 기술 질문 시 direct_qa thread가 저장되고 이후 스레드 reply가 direct_followup으로 이어지는지 검증합니다.
- 자기소개/사용법 질문은 고정문구 reply이며 LLM을 호출하지 않는지 검증합니다.
- `study` thread reply는 여전히 `TutorBot.handleThreadMessage()`로 가는지 검증합니다.
- SQLite store 테스트에서 `kind`와 direct Q&A message history 저장/조회가 되는지 검증합니다.

