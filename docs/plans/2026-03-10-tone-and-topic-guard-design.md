# Vector Tone And Topic Guard Design

**Date:** 2026-03-10

## Goal

Vector의 루트 DM 답변을 일관된 한국어 반말로 고정하고, CS/개발/인접 기술이 아닌 질문은 LLM 호출 없이 즉시 차단합니다.

## Context

- 현재 루트 DM 일반 질문은 `SlackMessageRouter`에서 `direct_question`으로 바로 `CodexCliRunner`에 전달됩니다.
- 말투는 `VECTOR_SYSTEM_PROMPT`와 `direct_question` 지시가 느슨해서 존댓말이 섞일 수 있습니다.
- 잡담이나 자기소개 같은 비기술 질문도 현재는 LLM까지 전달되어 지연과 불필요한 비용을 만듭니다.

## Requirements

- Vector는 한국어 답변에서 존댓말이 아니라 반말을 사용해야 합니다.
- 허용 질문은 CS, 프로그래밍, 개발 도구, 시스템, 네트워크, 데이터베이스, 알고리즘, 수학/논리 같은 인접 기술 범위입니다.
- 비허용 질문은 짧게 차단하되, "나는 CS/개발 얘기만 받는다"는 뉘앙스를 유지합니다.
- 오프트픽 질문은 `Codex`를 호출하지 않아야 합니다.
- 애매한 질문은 차단보다 허용 쪽으로 기울여 오탐을 줄입니다.

## Approach

### 1. Persona tightening

- `src/persona/vector-system-prompt.js`에서 한국어 스타일을 `반말`로 명시합니다.
- `src/llm/codex-cli-runner.js`의 `direct_question` 지시도 반말을 명확하게 강제합니다.

### 2. Local topic gate

- 루트 DM 질문에 대해 로컬 규칙 기반 판정을 추가합니다.
- 질문이 명백히 잡담, 자기소개 요구, 일상/감정 대화면 즉시 차단 답변을 같은 스레드에 답합니다.
- 질문이 기술 키워드, 수학/논리 용어, 개발 동사/명사 패턴을 포함하면 허용합니다.
- 애매한 경우는 허용으로 두어 거짓 양성 차단을 줄입니다.

### 3. Slack routing behavior

- 제어 명령, 열린 스레드 리다이렉트, 스레드 답변 흐름은 유지합니다.
- 오프트픽 루트 DM은 새 분기로 처리하고 `Codex` 호출 없이 고정 차단 문구를 답합니다.

## Error Handling

- 오프트픽 차단은 LLM 실패와 무관한 순수 로컬 처리이므로 별도 오류 지점이 없습니다.
- 기존의 direct question 실패 응답과 thread 실패 응답은 그대로 유지합니다.

## Testing

- 시스템 프롬프트 테스트에서 반말 요구가 명시되는지 검증합니다.
- 라우터 테스트에서 비기술 질문은 차단 문구를 보내고 `llmRunner.runTask`를 호출하지 않는지 검증합니다.
- 인접 기술 질문은 계속 `direct_question`으로 통과하는지 검증합니다.

