# Study Loop Design

**Goal**

`!start` 이후 `!stop` 전까지, 열린 `study` 스레드가 끝날 때마다 `1~3분` 랜덤 지연 뒤 다음 질문을 자동으로 다시 던집니다.

**Current Context**

- `TutorBot.applyControlCommand("start")`는 active 세션이고 열린 `study` 스레드가 없으면 즉시 첫 질문을 보냅니다.
- `TutorBot.handleThreadMessage()`는 현재 스레드 평가와 reply만 처리하고, 다음 질문 예약 신호는 밖으로 내보내지 않습니다.
- `interval-policy.js`는 아직 `10~20분` 기준이고, 실제 런타임에 반복 루프는 연결되어 있지 않습니다.
- macOS lifecycle 자동 start/stop은 이미 구현되어 있으므로, 자동 루프는 이 제어 흐름과 충돌 없이 같은 기준을 따라야 합니다.

**Approach Options**

1. 이벤트 기반 단일 스케줄러
   - `study` 스레드가 `blocked`/`mastered`로 닫히는 순간만 예약합니다.
   - `start`/`stop`과 lifecycle 이벤트에서 예약을 취소합니다.
   - 장점: 중복 발송을 가장 쉽게 막습니다.
   - 장점: 현재 구조에 가장 작은 변경으로 붙습니다.

2. 주기적 폴링 루프
   - 일정 간격으로 세션과 열린 스레드를 확인하고 필요하면 질문을 던집니다.
   - 장점: 구현은 단순합니다.
   - 단점: 불필요한 체크가 많고, 타이밍이 부정확합니다.

3. DB 기반 예약 시각 저장
   - 다음 발송 예정 시각을 저장하고 재시작 후에도 복구합니다.
   - 장점: 가장 복원력이 좋습니다.
   - 단점: PoC에는 과합니다.

**Decision**

이벤트 기반 단일 스케줄러로 갑니다.

**Architecture**

- 새 `StudyLoop` 런타임 컴포넌트가 예약 타이머 1개만 유지합니다.
- `TutorBot.handleThreadMessage()`는 `study` 스레드가 닫혔는지 여부를 결과로 알려줍니다.
- `SlackMessageRouter`는 `study` 스레드 종료 결과를 받으면 `StudyLoop`에 다음 질문 예약을 요청합니다.
- `SlackMessageRouter`와 `SessionLifecycleManager`는 `start`/`stop` 제어 명령이 적용되면 `StudyLoop`에 취소 신호를 전달합니다.
- `TutorBot.dispatchNextQuestion()` 자체도 열린 `study` 스레드가 있으면 아무 것도 보내지 않도록 강화합니다.

**Data Flow**

1. `!start` 또는 auto-start
   - active 세션 전환
   - 열린 `study` 스레드가 없으면 즉시 첫 질문 발송
   - 대기 중 예약이 있으면 취소

2. 사용자가 `study` 스레드에 답변
   - `continue`면 같은 스레드에서 follow-up만 보냄
   - `blocked`/`mastered`면 스레드 닫기
   - `StudyLoop`가 `1~3분` 랜덤 지연으로 다음 질문 예약

3. 예약 타이머 발화
   - 세션이 active이고 열린 `study` 스레드가 없으면 다음 질문 발송
   - 아니라면 아무 것도 하지 않음

4. `!stop`, 잠금, 잠자기
   - 세션 paused
   - 예약 타이머 취소

**Error Handling**

- 예약 타이머 콜백 내부 에러는 로깅만 하고 프로세스를 죽이지 않습니다.
- 예약 발화 시점에 세션이 paused이거나 열린 `study` 스레드가 있으면 무시합니다.
- 중복 예약 요청이 오면 기존 타이머를 먼저 취소하고 새로 예약합니다.

**Testing**

- `interval-policy`가 `1~3분`으로 계산되는지 검증
- `TutorBot.dispatchNextQuestion()`가 열린 `study` 스레드가 있으면 발송하지 않는지 검증
- `TutorBot.handleThreadMessage()`가 `blocked`/`mastered`일 때만 다음 질문 예약 신호를 주는지 검증
- `StudyLoop`가 예약, 재예약, 취소, 발화 보호조건을 지키는지 검증
- `SessionLifecycleManager`와 `SlackMessageRouter`가 제어 명령 후 `StudyLoop` 취소 hook을 호출하는지 검증
