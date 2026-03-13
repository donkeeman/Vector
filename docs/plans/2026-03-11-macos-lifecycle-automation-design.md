# Vector macOS Lifecycle Automation Design

**Date:** 2026-03-11

## Goal

맥 로그인/앱 기동/잠금 해제/깨움 시 Vector 세션이 자동으로 시작되고, 화면 잠금/잠자기 시 자동으로 멈추게 만듭니다. 동시에 `!start`와 `!stop`은 Slack에 확인 댓글을 남기지 않는 무음 명령으로 바꿉니다.

## Requirements

- 맥 로그인 후 앱이 자동 실행되어야 합니다.
- 앱이 시작되면 `!start`와 동일한 세션 활성화가 자동 적용되어야 합니다.
- 화면 잠금 또는 시스템 잠자기 시 `!stop`과 동일한 세션 중지가 자동 적용되어야 합니다.
- 화면 잠금 해제 또는 시스템 깨움 시 `!start`와 동일한 세션 시작이 자동 적용되어야 합니다.
- 수동/자동 구분은 저장하지 않습니다. 사용자가 직접 `!stop`했더라도 깨움/잠금 해제 이벤트가 오면 다시 시작합니다.
- `!start`, `!stop`은 Slack 스레드에 확인 댓글을 남기지 않습니다.
- `!help`는 기존처럼 사용법 응답을 남깁니다.

## Current Problem

- 현재 앱은 사용자가 Slack에서 `!start`나 `!stop`을 보냈을 때만 세션 상태가 바뀝니다.
- 앱 기동, 잠자기, 깨움, 잠금, 잠금 해제 같은 macOS lifecycle 이벤트와 세션 상태가 연결되어 있지 않습니다.
- `!start`와 `!stop`은 현재 같은 메시지 스레드에 확인 댓글을 달아서 잡음이 됩니다.

## Approach

### 1. Silent session control path

- `TutorBot`에 명령 적용 전용 내부 경로를 둡니다.
- Slack 명령과 macOS lifecycle 이벤트가 모두 같은 `start/stop` 적용 메서드를 타게 만듭니다.
- `start`가 이미 active인 경우에는 세션을 재생성하지 않고 그대로 둡니다.
- `stop`이 이미 paused/inactive인 경우에도 그대로 둡니다.
- `start`가 적용될 때 열린 `study` 스레드가 없으면 즉시 다음 질문을 하나 발송합니다.

### 2. macOS lifecycle monitor

- 별도 npm 패키지 없이 작은 Swift 스크립트를 repo 안에 둡니다.
- Node가 이 스크립트를 child process로 실행하고, stdout으로 전달되는 JSON 이벤트를 읽습니다.
- Swift 스크립트는 다음 이벤트를 감지합니다.
  - `NSWorkspace.willSleepNotification`
  - `NSWorkspace.didWakeNotification`
  - distributed notification: `com.apple.screenIsLocked`
  - distributed notification: `com.apple.screenIsUnlocked`
- Node는 이 이벤트를 각각 `stop/start`에 매핑합니다.

### 3. LaunchAgent install path

- repo 안에 LaunchAgent plist 템플릿과 설치 스크립트를 둡니다.
- 실제 `~/Library/LaunchAgents` 설치는 사용자 머신에서 한 번 실행하는 식으로 둡니다.
- LaunchAgent는 로그인 시 `node src/main.js`를 실행하게 구성합니다.

## Data Flow

1. 사용자 로그인 후 LaunchAgent가 Vector 프로세스를 실행
2. `main.js`가 초기화 후 자동 `start` 적용
3. 열린 `study` 스레드가 없으면 첫 질문 발송
4. 사용자가 화면을 잠그거나 시스템이 잠들면 lifecycle monitor가 `stop` 이벤트 전달
5. `TutorBot`이 세션을 paused로 저장
6. 사용자가 잠금을 해제하거나 시스템이 깨면 lifecycle monitor가 `start` 이벤트 전달
7. 열린 `study` 스레드가 없으면 새 질문 발송

## Error Handling

- Swift 런타임이 없거나 lifecycle monitor 실행에 실패하면 앱은 계속 동작하고, 자동 lifecycle 연동만 비활성화합니다.
- LaunchAgent 설치 전에는 자동 로그인 실행만 빠지고, 나머지 코드는 수동 `npm start`에서도 동작합니다.
- lifecycle 이벤트가 중복으로 들어와도 `start/stop` 적용은 idempotent하게 유지합니다.

## Testing

- `!start`와 `!stop`이 더 이상 Slack 답장을 남기지 않는지 검증합니다.
- `start`가 inactive를 active로 만들고, paused는 resume하며, active는 그대로 두는지 검증합니다.
- `stop`이 active를 paused로 만들고, paused/inactive는 그대로 두는지 검증합니다.
- lifecycle event handler가 `sleep/lock -> stop`, `wake/unlock -> start`로 매핑되는지 검증합니다.
- auto-start 시 열린 `study` 스레드가 없을 때만 질문을 한 번 보내는지 검증합니다.

## Operational Note

- Slack 알림 강조를 위한 멘션은 이번 작업에 넣지 않습니다.
- 사용자 알림 문제는 Slack 환경설정으로 먼저 해결하는 방향으로 둡니다.
