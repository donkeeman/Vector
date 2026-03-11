# Direct Thread Turn Design

## Goal
- direct Q&A 스레드에서 예외 케이스가 늘어날수록 task 타입이 더 쪼개지는 문제를 멈춘다.
- direct Q&A 해석 단위를 `root question`과 `thread turn` 두 개로 단순화한다.
- `모르겠어. 근데 임베딩이 뭐야?`처럼 답변 포기와 새 기술 질문 피벗이 섞인 메시지도 자연스럽게 처리한다.

## Problem Summary
- 지금 direct Q&A는 `direct_question`, `direct_followup`, `direct_answer_evaluate`로 나뉘어 있다.
- 이 구조는 “직전 challenge에 대한 답변”, “새 기술 질문”, “포기 후 피벗”을 미리 코드에서 갈라야 해서 예외 규칙이 계속 늘어난다.
- 실제 문제는 맥락 기억 부족보다 “현재 턴 의도 해석”이다.
- 따라서 상태는 최소화하고, thread reply 해석은 하나의 task에 맡기는 편이 더 안정적이다.

## Chosen Approach
- root DM direct question은 `direct_question`으로 유지한다.
- direct Q&A thread reply는 모두 `direct_thread_turn` 하나로 처리한다.
- 앱이 직접 분기하는 상태는 `open`과 `awaiting_answer` 두 개만 둔다.
- direct Q&A thread는 Codex session id를 계속 저장하고 `resume`으로 이어간다.
- SQLite history는 계속 source of record로 유지한다.

## Data Model
- direct Q&A thread의 `mode`는 고정으로 `direct_qa`만 쓴다.
- direct Q&A 제어용 상태는 `directQaState`로만 표현한다.
  - `open`
  - `awaiting_answer`
- `lastAssistantPrompt`와 `codexSessionId`는 유지한다.

## Runtime Flow

### Root Direct Question
- root DM 질문은 `direct_question`으로 처리한다.
- response는 다음 형태를 준다:
  - `text`
  - `nextState: "open" | "awaiting_answer"`
  - `challengePrompt: string | null`
- thread row는 이 응답에 따라 갱신된다.

### Direct Q&A Thread Turn
- direct Q&A thread reply는 무조건 `direct_thread_turn`으로 보낸다.
- payload에는 다음이 포함된다:
  - current thread state
  - history
  - latest user text
  - last assistant challenge prompt
  - codex session id
- LLM은 현재 턴을 아래 중 하나로 스스로 해석한다:
  - 직전 challenge에 대한 답변 시도
  - 같은 맥락의 새 기술 질문
  - 포기 후 새 기술 질문으로 피벗
  - 진짜 오프트픽 잡담
- output은 `text`, `nextState`, `challengePrompt`만 돌려준다.
- 앱은 이 output을 thread state로 반영하기만 한다.

## Prompt Rules
- direct Q&A prompt는 아래를 강하게 명시한다.
  - 질문을 문자 그대로 먼저 해석할 것
  - 사용자의 혼동, 숨은 의도, 배경을 지어내지 말 것
  - 기술 용어가 봇 이름과 겹쳐도 기술 의미를 먼저 설명할 것
  - `awaiting_answer` 상태에서 user가 “모르겠다 + 새 기술 질문”을 섞어 보내면, 이전 challenge는 실패로 닫고 새 기술 질문에 답할 것
  - 오프트픽 거절은 진짜 비기술 잡담일 때만 할 것

## Codex Session Use
- direct Q&A root/thread task는 계속 Codex session-aware 경로를 탄다.
- `codex exec --json`의 `thread.started` id를 잡아 저장한다.
- 이후 같은 Slack thread는 `codex exec resume <id>`로 이어간다.
- resume 실패 시엔 history 기반 새 session으로 fallback한다.

## Error Handling
- `direct_thread_turn` 결과가 state 필드를 빠뜨리면 앱은 `open`과 `null`로 보정한다.
- Codex session id를 못 읽어도 direct Q&A는 계속 동작해야 한다.
- resume 실패 시 새 session 생성 + history fallback으로 복구한다.

## Testing
- direct Q&A open state thread reply가 `direct_thread_turn`으로 가는지
- direct Q&A awaiting_answer state thread reply도 동일하게 `direct_thread_turn`으로 가는지
- `모르겠어 + 새 기술 질문` reply가 off-topic 거절이 아니라 정상 답변으로 이어지는지
- direct_question/direct_thread_turn prompt가 literal-first와 no invented intent 규칙을 포함하는지
- direct Q&A state가 `nextState`만으로 갱신되는지
