# Direct Q&A 스택 설계

**Date:** 2026-03-17

## 목표

- direct Q&A 스레드에서 질문-꼬리질문 관계를 명시적 스택으로 관리합니다.
- "이전 질문에 답할게" 같은 레퍼런스가 길어진 스레드에서도 항상 해석 가능한 상태를 유지합니다.
- 꼬리질문만 대충 맞히고 루트 질문이 미해결로 남는 종료 누수를 막습니다.

## 문제

- 현재 모델은 `lastChallengePrompt` 1개만 유지합니다.
- 스레드가 길어지면 "이전 질문"이 무엇인지 애매해지고, 루트 미해결 상태가 누락됩니다.
- 최대 깊이 제한이 없어 꼬리질문 연쇄가 길어지면 제어가 약해집니다.

## 합의 규칙

- 최대 깊이: `5` (루트 포함).
- 질문 관리: LIFO 스택.
- 정답(`mastered`) 처리: `pop`.
- 스택이 비면 스레드 종료.
- 루트 질문을 바로 맞히면 즉시 종료.
- 한 번이라도 최대 깊이에 도달하면 `sealed=true`로 고정.
- `sealed=true` 이후에는 절대 `push` 금지.
- 최대 깊이 도달 이후에는 top 프레임 해결(`pop`)만 허용.
- 프레임이 1개만 남은 상태에서 "간신히 맞힘"이면 동일 프레임 검증 1회 후 종료 판단.

## 접근 비교

### 1) 앱 규칙 기반 전부 해석
- 장점: 결정적, 디버깅 쉬움.
- 단점: 자연어 의도 해석 정확도가 낮아 질문 전환/재서술 처리 취약.

### 2) LLM 자율 해석 + 단일 상태(현행)
- 장점: 구현 단순.
- 단점: 스택 불변식 보장이 불가, "이전 질문" 모호성 재발.

### 3) 하이브리드(채택)
- 장점: 의도 해석은 LLM, 상태 전이는 앱이 강제하므로 불변식 보장.
- 단점: 출력 스키마/파서 확장이 필요.

## 상태 모델

### Thread 필드 확장

- `directQaStackJson: TEXT | NULL`
- `directQaStackSealed: INTEGER(0|1) DEFAULT 0`

기존 필드(`directQaState`, `lastChallengePrompt`)는 하위호환용으로 유지하되, 실질 제어는 스택을 기준으로 수행합니다.

### Stack 프레임

```json
{
  "id": "uuid-or-turn-ts",
  "prompt": "현재 프레임 질문",
  "status": "awaiting_answer",
  "weakPassUsed": false,
  "createdAt": "ISO-8601"
}
```

### Stack 상태

```json
{
  "frames": [],
  "sealed": false,
  "maxDepth": 5
}
```

## LLM 출력 계약

`direct_thread_turn` 출력을 아래로 확장합니다.

```json
{
  "text": "...",
  "operation": "push|pop|stay|close",
  "nextPrompt": "string|null",
  "passQuality": "strong|weak|null"
}
```

- `push`: `nextPrompt`를 새 프레임으로 추가 시도.
- `pop`: top 프레임 해소.
- `stay`: 동일 프레임 유지.
- `close`: 스택 종료 제안(앱에서 최종 검증).
- `passQuality=weak`: 단일 프레임 구간에서 검증 1회 허용 플래그로 사용.

기존 `{ nextState, challengePrompt }` 출력은 fallback으로 허용하고, 미지정 값은 `stay`로 정규화합니다.

## 전이 규칙

1. `push` 요청 시:
 - `sealed=false`이고 `depth < 5`일 때만 반영.
 - 반영 후 `depth===5`면 즉시 `sealed=true`.
 - 불가 시 강등: `stay`로 처리.
2. `pop` 요청 시:
 - `depth>0`이면 top 제거.
 - pop 후 `depth===0`이면 thread 종료.
3. `close` 요청 시:
 - `depth===0`일 때만 즉시 종료.
 - `depth>0`이면 `pop` 또는 `stay`로 강등.
4. `sealed=true`일 때:
 - `push`는 무조건 차단.
 - top 해결 중심(`pop/stay`)만 허용.

## 라우터/저장소 반영

- `SlackMessageRouter`는 direct Q&A reply마다 stack 상태를 로드해 LLM payload에 전달합니다.
- LLM 결과를 `directQaStackPolicy`로 정규화/검증한 뒤 thread 상태를 저장합니다.
- `lastChallengePrompt`는 `stack.top.prompt`로 동기화해 기존 로깅/분기와 호환합니다.
- `sqlite-store`는 신규 컬럼을 자동 마이그레이션으로 보장합니다.

## 오류/복구

- LLM이 비정상 JSON 또는 미지원 operation을 주면 `stay`로 강등.
- stack JSON 파싱 실패 시 빈 스택 + `sealed=false`로 복구하고 경고 로그 기록.
- 하위호환 row(`directQaStackJson` 없음)는 기존 `directQaState` 기준으로 1회 보정 마이그레이션.

## 테스트 기준

- 최대 깊이 5에서 `sealed` 전환 확인.
- `sealed` 이후 `push` 차단 확인.
- `pop` 연쇄로 빈 스택이 되면 thread 종료 확인.
- 루트 정답 시 즉시 종료 확인.
- `weak pass` 단일 검증 1회 규칙 확인.
- 저장/재시작 후 stack+sealed 복원 확인.
