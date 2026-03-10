# Slack Socket Mode Design

## Goal

Vector가 Slack DM과 thread reply를 구분해서 처리하도록 Socket Mode 수신 레이어를 붙인다. 기존 `TutorBot` 도메인 로직은 유지하고, Slack 이벤트를 현재 앱 계층 메서드로 안전하게 라우팅한다.

## Constraints

- 런타임은 Node.js ESM이다.
- 저장소는 현재 Git 메타데이터가 없어서 설계 문서 커밋은 수행할 수 없다.
- Slack 수신은 `@slack/socket-mode`를 사용한다.
- Slack 발송은 기존 `SlackWebApiClient`를 유지한다.
- DM root message와 thread reply의 의미를 엄격히 구분한다.

## Interaction Rules

- 봇이 먼저 보내는 질문은 DM root message다.
- 사용자가 봇에게 던지는 일반 질문도 DM root message다.
- 사용자의 학습 답변과 그에 대한 꼬리질문은 thread reply에서만 진행한다.
- root DM에 답변처럼 보이는 메시지가 오면 새 질문으로 해석하지 않고, 해당 메시지 스레드에 "스레드에 답하라"는 안내를 보낸다.

## Routing Design

- `SocketModeTransport`가 Slack `events_api`를 수신한다.
- transport는 이벤트를 받으면 먼저 `ack()`를 호출한다.
- transport는 bot message, `subtype` message, DM 외 채널 메시지를 무시한다.
- DM root message는 다음 순서로 해석한다.
  - 제어 명령이면 `TutorBot.handleControlInput()`
  - 답변처럼 보이면 안내 문구를 해당 root message의 스레드에 reply
  - 그 외에는 일반 질문으로 처리하고, LLM 응답도 해당 root message의 스레드에 reply
- DM thread reply는 `TutorBot.handleThreadMessage()`로 전달한다.

## App Layer Changes

- `TutorBot`은 기존 역할을 그대로 유지한다.
- root DM 일반 질문 처리는 별도 앱 계층 메서드로 분리한다.
- Slack 이벤트 라우팅과 예외 처리는 transport 또는 얇은 app orchestrator에서 담당한다.

## Error Handling

- Slack `ack()` 이후의 처리 에러는 연결을 끊지 않는다.
- 예외는 `console.error`에 이벤트 타입과 Slack 식별자 정도만 남긴다.
- 일반 질문 처리 실패 시에도 원문 DM 메시지의 스레드에 실패 응답을 단다.
- thread reply 처리 실패 시에도 같은 스레드에 실패 응답을 단다.
- 제어 명령 처리 실패는 상태를 임의로 바꾸지 않는다.

## Testing

- transport 단위 테스트를 추가한다.
- DM root 제어 명령 라우팅 테스트
- DM root 일반 질문 라우팅 테스트
- DM thread reply 라우팅 테스트
- 답변처럼 보이는 root DM 안내 테스트
- bot/subtype/non-DM 무시 테스트
- LLM 실패 시 같은 스레드에 실패 응답을 다는 테스트
