# Direct Q&A State And Codex Session Design

## Goal
- direct Q&A 스레드에서도 질문/답변/역질문 흐름을 명시적으로 구분해, `벡터가 뭐야? -> [3,4] 길이? -> 1이잖아` 같은 후속 답변이 오프트픽 거절로 잘리는 문제를 없앤다.
- direct Q&A 스레드별로 Codex session을 저장하고 재개해, 같은 Slack 스레드 안의 생성 맥락이 다른 DM 질문과 섞이지 않도록 한다.

## Problem Summary
- 현재 direct Q&A는 SQLite history를 매번 payload로 넘기는 방식이라 “맥락 문자열”은 유지되지만, “대화 상태”는 없다.
- 그래서 assistant가 설명 끝에 시험용 질문을 던져도, 다음 user message는 항상 `direct_followup`으로 처리된다.
- off-topic 판단도 최신 user message만 보고 이뤄져 `1이잖아` 같은 짧은 답변 시도가 잘못 거절된다.
- prompt도 질문을 문자 그대로 먼저 해석하라는 제약이 약해, `벡터`처럼 봇 이름과 기술 용어가 겹치는 단어에서 불필요한 설정을 지어낸다.

## Chosen Approach
- 하이브리드 접근을 쓴다.
- 앱이 direct Q&A thread state를 source of truth로 관리한다.
- Codex session은 같은 Slack thread의 장기 문맥을 보조하는 계층으로 사용한다.
- SQLite history는 계속 유지해 resume 실패, 앱 재시작, 디버깅 시 fallback source로 쓴다.

## Data Model
- `threads`에 direct Q&A용 상태를 추가한다.
- 필요한 필드:
  - `codex_session_id`: direct Q&A thread에 연결된 Codex thread/session id
  - `direct_qa_state`: `open` 또는 `awaiting_answer`
  - `last_assistant_prompt`: assistant가 마지막에 던진 시험용 질문 원문
- study thread는 기존 의미를 유지한다.
- direct Q&A history 테이블은 그대로 둔다.

## Runtime Flow

### Root Direct Question
- root DM 질문은 direct Q&A thread를 연다.
- 첫 direct question 실행은 Codex 새 session으로 보낸다.
- `--json` stdout의 `thread.started` 이벤트에서 session id를 잡아 thread row에 저장한다.
- response JSON은 `text` 외에 `expectsAnswer`와 optional `challengePrompt`를 포함한다.
- assistant가 시험용 질문으로 끝냈다면 thread state를 `awaiting_answer`로 전환한다.

### Direct Q&A Thread Reply
- thread state가 `open`이면 기존 direct follow-up처럼 처리한다.
- thread state가 `awaiting_answer`이면 latest user message를 새 질문이 아니라 “직전 challenge에 대한 답변”으로 평가한다.
- 이 평가는 study thread와 비슷하지만 direct Q&A 전용 task를 둔다.
- 평가 결과는 최소한 다음 정보를 준다:
  - `outcome`: `continue | blocked | mastered`
  - `text`: 사용자가 받게 될 실제 답변
  - `expectsAnswer`: 다시 시험용 질문으로 끝났는지 여부
  - `challengePrompt`: 다시 시험용 질문이 있으면 그 질문 원문
- outcome이 무엇이든 assistant가 다시 challenge를 던지지 않으면 state를 `open`으로 되돌린다.

### Codex Session Lifecycle
- direct Q&A task는 `--ephemeral`을 쓰지 않는다.
- direct Q&A thread에 `codex_session_id`가 있으면 `codex exec resume <id>`로 이어간다.
- session id가 없거나 resume이 실패하면:
  - SQLite history를 payload로 넘겨 새 session을 다시 시작한다.
  - 새 `thread.started` id를 다시 저장한다.
- study/evaluate/followup/teach 쪽은 기존처럼 ephemeral task로 유지한다.

## Prompt Rules
- direct Q&A prompt 전반을 강화한다.
- 반드시 포함할 규칙:
  - 질문을 문자 그대로 먼저 해석할 것
  - 사용자의 혼동, 숨은 의도, 배경을 지어내지 말 것
  - 용어가 봇 이름과 겹쳐도 기술 의미부터 설명할 것
  - direct Q&A thread에서 직전 assistant가 시험용 질문을 던졌다면 latest user message를 답변 시도로 우선 해석할 것
  - off-topic 거절은 진짜 새 화제 잡담일 때만 하라

## Error Handling
- Codex session id를 못 얻어도 direct Q&A는 계속 동작해야 한다.
- `resume` 실패 시 direct Q&A history fallback으로 새 session을 연다.
- JSON schema가 깨지면 기존 retry 경로를 재사용한다.
- session 저장 실패는 로그에 남기고, 사용자에겐 일반 실패 문구만 보낸다.

## Testing
- direct question이 `expectsAnswer=true` 응답을 주면 thread state가 `awaiting_answer`로 저장되는지 검증
- `awaiting_answer` 상태의 user reply가 off-topic reject가 아니라 evaluation task로 가는지 검증
- evaluation 결과가 다시 challenge를 만들면 state가 유지되는지 검증
- direct Q&A task가 session id를 캡처/저장하는지 검증
- `resume` 실패 시 fallback 새 session 생성으로 복구되는지 검증
- ambiguous term 질문(`벡터가 뭐야`)이 invented intent 없이 literal-first 설명을 요구하는 prompt를 쓰는지 검증
