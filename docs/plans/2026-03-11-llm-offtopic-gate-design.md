# LLM Offtopic Gate Design

**Goal**

로컬의 기술 키워드 allowlist를 제거하고, `direct_question` / `direct_followup` 프롬프트가 CS/개발/인접 기술이 아닌 질문을 직접 거절하도록 바꿉니다.

**Current Context**

- 현재 [technical-question.js](/Users/hwlee/Projects/Vector/src/app/technical-question.js)는 질문형 패턴과 기술 키워드 패턴을 둘 다 만족해야 통과시킵니다.
- 이 구조는 `ETag`, `Last-Modified`처럼 키워드 목록에 없는 개발 질문을 오프트픽으로 오판합니다.
- 사용자는 로컬 잡담/기술 판정을 없애고, `!start`, `!stop`, `!help`, 자기소개/사용법 고정문구, 그리고 기존 “답변은 스레드에 달아라” 규칙만 로컬에 남기길 원합니다.

**Approach Options**

1. 키워드 allowlist 계속 확장
   - 장점: 로컬 차단이 빠릅니다.
   - 단점: 빠지는 용어가 계속 생깁니다.

2. 전부 LLM에 위임
   - 장점: 로컬 기준이 거의 사라집니다.
   - 단점: 열린 스레드가 있을 때 답변처럼 온 루트 DM도 전부 새 질문으로 흘러갈 수 있습니다.

3. 하이브리드
   - 로컬에는 제어 명령, 고정문구, 답변 redirect만 남깁니다.
   - 주제 판정과 오프트픽 거절은 `direct_question` / `direct_followup` 프롬프트가 맡습니다.
   - 장점: 키워드 누락 문제를 없애면서, 기존 스레드 UX는 유지됩니다.

**Decision**

3번으로 갑니다.

**Design**

- [slack-message-router.js](/Users/hwlee/Projects/Vector/src/app/slack-message-router.js)
  - `isAllowedTechnicalQuestion()` 의존을 제거합니다.
  - 루트 DM 흐름:
    - control/shortcut 먼저 처리
    - 열린 스레드가 있고 `질문처럼 보이지 않는` 메시지면 기존처럼 redirect
    - 그 외는 전부 `direct_question`
  - `direct_qa` 스레드 흐름:
    - shortcut만 로컬 처리
    - 나머지는 전부 `direct_followup`

- [codex-cli-runner.js](/Users/hwlee/Projects/Vector/src/llm/codex-cli-runner.js)
  - `direct_question` / `direct_followup` 지시에 다음 규칙을 추가합니다.
  - 최신 사용자 메시지가 CS, 개발, 소프트웨어 엔지니어링, 또는 인접 기술(수학/논리 포함)이 아니면 고정 거절문만 반환
  - 맞는 질문이면 기존 Vector 톤으로 답변

- [technical-question.js](/Users/hwlee/Projects/Vector/src/app/technical-question.js)
  - 라우팅에서 더 이상 사용하지 않습니다.
  - 당장 파일 삭제는 필수는 아니고, 우선 unused 상태로 둘 수 있습니다.

**Testing**

- 개발 질문 allowlist 누락 사례 `ETag와 Last-Modified가 뭐야?`가 `direct_question`으로 전달되는지 검증
- 루트 DM 잡담도 로컬 차단 없이 `direct_question`으로 전달되는지 검증
- `direct_qa` 스레드의 잡담도 로컬 차단 없이 `direct_followup`으로 전달되는지 검증
- `direct_question` / `direct_followup` 지시문이 오프트픽이면 고정 거절문을 반환하라고 명시하는지 검증
