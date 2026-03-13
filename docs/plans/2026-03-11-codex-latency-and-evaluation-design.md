# Vector Codex Latency And Evaluation Design

**Date:** 2026-03-11

## Goal

Codex 응답 시간을 줄이면서도 채점 품질은 유지하고, 사용자가 명시적으로 막혔을 때는 너무 오래 꼬리질문으로 몰아붙이지 않고 더 빨리 `blocked -> teach`로 전환하게 만듭니다.

## Current Problem

- 현재 Codex 기본 설정은 `gpt-5.4`와 `model_reasoning_effort = "xhigh"`라서 direct Q&A와 follow-up까지 지나치게 느립니다.
- 앱 로그 기준으로 `evaluate`와 `followup`이 각각 20~30초대까지 걸리고 있습니다.
- 사용자가 `모르겠어`, `헷갈려`처럼 명시적으로 막혔는데도 `continue`가 이어져 대화가 부자연스러워질 수 있습니다.
- `teach`도 막힌 지점을 직접 다루기보다 너무 일반적인 event loop 설명으로 후퇴할 위험이 있습니다.

## Requirements

- `evaluate`는 신중하게 유지하되 나머지 task는 더 빠르게 실행되어야 합니다.
- Codex 실행 시 불필요한 세션 상태 저장 오버헤드를 줄여야 합니다.
- 사용자가 강한 불확실성/포기를 드러내면 `continue` 대신 더 빨리 `blocked`로 전환해야 합니다.
- `teach`는 바로 직전 질문의 핵심 막힘 지점을 직접 설명해야 합니다.

## Approaches

### 1. 권장안: task별 reasoning 분리 + explicit uncertainty override

- `evaluate = high`
- `question`, `followup`, `teach`, `direct_question`, `direct_followup`, `answer_counterquestion = medium`
- `codex exec`에 `--ephemeral` 추가
- 답변 텍스트에 강한 uncertainty 신호가 있으면 `continue`를 `blocked`로 override

장점:
- 느린 부분과 품질이 중요한 부분을 분리해 가장 실용적인 균형을 잡을 수 있습니다.
- 사용자가 실제로 막혔을 때 teach로 넘어가는 흐름이 빨라집니다.

단점:
- 채점 판단이 LLM + 로컬 override 혼합이 됩니다.

### 2. 단순안: 전 task medium 통일

장점:
- 구현이 가장 단순합니다.

단점:
- `evaluate` 품질 저하 가능성이 있습니다.
- teach 전환 문제는 그대로 남습니다.

### 3. heavy verifier 안 추가

- 기존 평가 뒤 별도 verifier pass를 넣어 `mastered`만 재검증

장점:
- 채점 안전성은 더 좋아집니다.

단점:
- 지금 원하는 속도 개선 방향과 정면 충돌합니다.

## Recommendation

1번으로 갑니다. `evaluate`만 `high`, 나머지는 `medium`, `--ephemeral` 추가, 그리고 강한 uncertainty 표현은 로컬에서 `blocked`로 승격합니다.

## Design

### 1. Codex task execution profile

- `CodexCliRunner`에 task별 실행 옵션 테이블을 둡니다.
- reasoning effort는 task별로 설정합니다.
- 모든 exec 호출에 `--ephemeral`을 넣습니다.
- 출력 파일, 모델, 샌드박스는 기존 방식을 유지합니다.

### 2. Explicit uncertainty override

- `TutorBot`에 `looksExplicitlyStuckAnswer(text)` 같은 로컬 헬퍼를 둡니다.
- 예: `모르겠`, `헷갈`, `까먹`, `잘 모르`, `정확히는 모르`, `그것까지는 모르`, `기억 안 나`
- `evaluate.outcome === "continue"`일 때만 override를 적용해 `blocked`로 바꿉니다.
- 이미 `blocked`나 `mastered`면 건드리지 않습니다.

### 3. Teach prompt tightening

- `teach` instruction은 “막힌 바로 그 지점을 직접 설명하고, 직전 질문에 대한 정답 구조를 짧게 복원하라” 쪽으로 강화합니다.
- 너무 일반적인 개념 재설명으로 도망가지 못하게 만듭니다.

## Testing

- task별 reasoning override와 `--ephemeral`이 args에 반영되는지 검증합니다.
- explicit uncertainty가 있는 답변에서 `evaluate`가 `continue`를 반환해도 `teach`로 전환되는지 검증합니다.
- uncertainty가 없는 경우 기존 `continue -> followup` 흐름은 유지되는지 회귀 확인합니다.

