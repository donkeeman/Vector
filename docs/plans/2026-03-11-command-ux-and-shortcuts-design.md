# Vector Command UX And Shortcut Matching Design

**Date:** 2026-03-11

## Goal

DM에서 Vector를 조작하는 인터페이스를 `!start`, `!stop`, `!help`로 강하게 통일하고, 자기소개/사용법 같은 고정 응답은 정규식 뭉치 대신 키워드 조합 규칙으로 판정합니다.

## Current Problem

- 현재 제어 명령은 `start`, `stop`, `resume`, `/study-start` 같은 과거 alias가 너무 많이 남아 있습니다.
- 사용법 안내 문구도 `/start`, `/stop` 기준이라 실제 원하는 UX와 어긋납니다.
- 자기소개/사용법 고정 응답은 정규식 몇 줄에 박혀 있어서 `너는 누구야?` 같은 자연스러운 변형에서 구멍이 생깁니다.
- Slack slash command와 비슷하게 `/start`를 쓰면 Slack이 자체 slash command로 해석할 여지가 있어, DM 입력 경험이 불안정합니다.

## Requirements

- 공식 명령은 `!start`, `!stop`, `!help`만 지원합니다.
- `start`, `stop`, `/study-start`, `/study-end`, `resume`, `pause`, `end` 같은 과거 alias는 더 이상 제어 명령으로 인식하지 않습니다.
- 자기소개와 사용법은 LLM을 호출하지 않고 고정 문구로 빠르게 답합니다.
- 고정 응답 판정은 키워드 포함 여부와 간단한 조합 규칙으로 처리합니다.
- 기존 direct Q&A 스레드 저장, 학습 스레드 처리, 오프트픽 차단 흐름은 유지합니다.

## Approach

### 1. Command normalization

- `normalizeControlCommand()`는 `!start`와 `!stop`만 `start`/`stop`으로 정규화합니다.
- `!help`는 제어 명령이 아니라 사용법 shortcut으로 처리합니다.
- 이 변경으로 사용자 입장에서는 `!`가 붙은 입력만 명령처럼 동작합니다.

### 2. Keyword-based shortcut matcher

- direct Q&A shortcut 판정 로직을 별도 헬퍼로 분리합니다.
- 소개 intent는 `너/넌/너는` 같은 대상 키워드와 `누구/정체/이름` 같은 소개 키워드 조합으로 판정합니다.
- 사용법 intent는 `사용법`, `help`, `어떻게 써`, `뭐 할 수`, `뭘 할 수` 같은 키워드 조합으로 판정합니다.
- 단순 포함 규칙이지만 너무 넓게 잡지 않도록 조합이 필요한 쪽은 조합으로 제한합니다.

### 3. Router flow

- 루트 DM 처리 순서는 다음과 같습니다.
  1. `!start` / `!stop` 제어 명령
  2. 자기소개 / 사용법 shortcut (`!help` 포함)
  3. 기술 질문 판정
  4. 오프트픽 차단
- direct_qa 스레드 reply에서도 같은 shortcut matcher를 재사용합니다.

## Copy Changes

- 사용법 안내: `!start`, `!stop`, `!help` 기준으로 교체합니다.
- 오프트픽 차단 문구도 `(!stop)` 기준으로 교체합니다.
- stop 확인 문구 역시 새 사용법 문구를 재사용합니다.

## Error Handling

- shortcut matcher는 로컬 로직이라 외부 실패 지점이 없습니다.
- `!help`는 LLM을 호출하지 않으므로 지연 없이 같은 스레드에 답합니다.
- 예전 alias가 들어오면 제어 명령으로 인식하지 않고 일반 질문/오프트픽 흐름으로 내려갑니다.

## Testing

- `!start`, `!stop`만 제어 명령으로 인식하는지 검증합니다.
- `start`, `/study-start`, `resume`, `end` 등이 더 이상 제어 명령이 아닌지 검증합니다.
- `!help`가 LLM 없이 사용법 문구로 응답하는지 검증합니다.
- `너는 누구야`, `정체가 뭐야`, `이름이 뭐야` 같은 변형이 자기소개로 매핑되는지 검증합니다.
- 사용법 관련 변형과 `!help`가 같은 사용법 응답으로 귀결되는지 검증합니다.

## Follow-up Note

- 맥 부팅 시 서버 자동 실행은 `launchd`의 `LaunchAgent`로 처리할 수 있습니다.
- 다만 이것은 커맨드 UX 변경과는 별도 운영/배포 문제이므로, 이번 작업에서는 코드 레벨 반영 대신 후속 런타임 작업으로 분리합니다.
