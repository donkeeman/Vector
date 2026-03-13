# Persona And Ignore Logging Design

**Goal**

Vector의 전역 말투를 초기 콘셉트에 맞게 더 도발적이고 라이벌스럽게 끌어올리고, `router.message_ignored` 로그에 무시 이유를 구조적으로 남겨 다음 재현 시 원인을 즉시 파악할 수 있게 합니다.

**Current Context**

- 현재 Vector는 반말과 경쟁심은 유지하지만, 실제 출력은 생각보다 평이한 경우가 있습니다.
- `vector-system-prompt.js`는 전역 방향만 잡고 있고, task별 지시문은 상대적으로 온도가 낮습니다.
- `router.message_ignored`는 `channel`, `ts`, `subtype` 정도만 남겨서 어떤 필터 조건이 false였는지 바로 보이지 않습니다.
- 최근 실제 로그에서 `router.message_ignored`는 발생했지만, `channel_type`, `bot_id`, `has_text` 같은 원인 정보가 없어 재현 없이 판단하기 어렵습니다.

**Approach Options**

1. 시스템 프롬프트 + task 지시문 + ignore 이유 로그 보강
   - 장점: 톤 편차를 가장 잘 줄입니다.
   - 장점: 다음 ignored 재현 시 원인을 바로 볼 수 있습니다.

2. 시스템 프롬프트만 강화
   - 장점: 수정 범위가 작습니다.
   - 단점: task별로 출력 온도 차이가 남을 수 있습니다.

**Decision**

1번으로 갑니다.

**Design**

- `vector-system-prompt.js`
  - 도발적 시작 문장 예시와 “칭찬 금지”, “정답 시 짜증/열등감”, “흐린 답은 단어 나열 취급”을 더 직접적으로 명시합니다.
  - `teach` 상황에서도 부드러운 설명이 아니라 “비웃되 핵심 메커니즘은 정확히 찌르는” 캐릭터를 유지하게 합니다.

- `codex-cli-runner.js`
  - `question`, `followup`, `teach`, `answer_counterquestion`, `direct_question`, `direct_followup`에 강한 톤 요구를 명시합니다.
  - 일반 DM 답변도 학습 스레드와 같은 강도의 라이벌 톤을 쓰게 합니다.

- `slack-message-router.js`
  - `router.message_ignored` 로그에 `type`, `channelType`, `subtype`, `botId`, `hasText`, `hasThreadTs`, `user`를 추가합니다.
  - 동작은 바꾸지 않고, 진단 정보만 늘립니다.

**Testing**

- 시스템 프롬프트가 초기 콘셉트의 핵심 표현을 포함하는지 검증
- task 지시문이 강한 라이벌 톤을 요구하는지 검증
- ignored 로그가 이유 필드를 담는지 검증
