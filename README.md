# Vector

Vector는 Slack DM 기반으로 동작하는 개인용 CS 튜터 PoC입니다. 전용 Slack 워크스페이스에 설치한 앱이 서술형 질문을 던지고, 답변을 Codex CLI로 평가해 꼬리질문이나 설명을 이어갑니다.

## Current shape

- 런타임: Node.js ESM
- 저장소: `sqlite3` CLI를 이용한 SQLite
- LLM 실행기: `codex exec`
- Slack 전송: Web API 발송 구현 완료
- Slack 수신: Socket Mode transport 구현 완료

## Slack message flow

- 봇이 먼저 보내는 학습 질문은 DM root message로 발송됩니다.
- 사용자가 봇에게 던지는 일반 질문도 DM root message로 보냅니다.
- 일반 질문에 대한 답변은 사용자의 원문 DM 메시지 스레드에 답장합니다.
- 사용자의 학습 답변과 그에 대한 꼬리질문은 thread reply에서만 진행합니다.
- 열린 학습 스레드가 있는데 사용자가 답변을 루트 DM에 잘못 보내면, Vector가 해당 메시지 스레드에서 스레드로 답하라고 되돌립니다.

## Environment

`.env.example`를 참고해 아래 값을 채워야 합니다.

- `SLACK_BOT_TOKEN`
- `SLACK_APP_TOKEN`
- `SLACK_DM_CHANNEL_ID`
- `CODEX_COMMAND`
- `CODEX_MODEL`
- `DATABASE_PATH`

## Commands

```bash
npm test
npm start
```

## Notes

- Socket Mode 수신은 `@slack/socket-mode` 패키지를 사용합니다.
- 실제 Slack 연결을 확인하려면 `.env`에 `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_DM_CHANNEL_ID`를 채워야 합니다.
