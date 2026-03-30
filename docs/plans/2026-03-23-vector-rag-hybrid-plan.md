# Vector RAG Hybrid Plan

**Date:** 2026-03-23
**Scope:** 설계/계획 문서만 작성 (구현 보류)

## Goal

Vector의 핵심 컨셉(사용자 CS 학습 보조, 마스터리까지 반복 학습)은 유지하면서,
답변/교정 품질을 근거 기반으로 강화한다.

핵심 목표는 아래 3가지다.
- 정확성: 답변 근거를 명시할 수 있어야 한다.
- 일관성: 같은 질문에 대한 설명 편차를 줄인다.
- 최신성: 버전/변동성이 큰 주제는 라이브 검색으로 보완한다.

## Non-Goals

- 모든 CS 영역을 한 번에 RAG로 커버하지 않는다.
- 기존 대화 흐름(세션/스레드/학습 상태머신)을 전면 교체하지 않는다.
- "최신이면 항상 정답"이라는 가정을 시스템 목표로 두지 않는다.

## Product Positioning (중요)

RAG 도입 후에도 Vector의 본질은 변하지 않는다.
- Before: LLM + 대화 메모리 중심 튜터
- After: LLM + 대화 메모리 + 근거 검색 튜터

즉, Vector는 여전히 "사용자가 마스터할 때까지 밀어붙이는 튜터"이고,
RAG는 설명/교정 단계의 신뢰도를 높이는 내부 메커니즘이다.

## Knowledge Strategy: Hybrid Retrieval

질문 유형에 따라 검색 소스를 분기한다.

1) Evergreen 지식 (변화 적음)
- 예: 자료구조/알고리즘 기본, OS 기본 개념, DB 정규화 원리
- 우선순위: 내부 검증 지식베이스 > 외부 검색

2) Volatile 지식 (변화 큼)
- 예: 프레임워크 최신 버전, API 변화, 도구 릴리즈 변경점
- 우선순위: 공식 문서 라이브 검색 > 내부 지식베이스

3) Mixed 지식
- 원리는 내부 지식베이스로 설명
- 최신 구현/버전 주의점은 라이브 검색으로 보강

## Data Model (최소)

### sources
- source_id
- name
- domain
- tier (A/B/C)
- source_type (official/blog/internal)

### documents
- doc_id
- source_id
- url_or_path
- title
- published_at
- ingested_at
- content_hash
- freshness_type (evergreen/volatile)

### chunks
- chunk_id
- doc_id
- text
- token_count
- section_path
- embedding

### claims
- claim_id
- chunk_id
- topic
- subtopic
- claim_type (definition/mechanism/tradeoff/pitfall)
- difficulty (beginner/intermediate/advanced)
- confidence

### retrieval_logs
- retrieval_id
- question
- route (internal/live/hybrid)
- topk_chunk_ids
- topk_scores
- created_at

### answer_citations
- answer_id
- chunk_id
- citation_text

## Retrieval Routing Policy

질문 분류 -> 라우팅 -> 검색 -> 검증의 4단계로 고정.

### Step 1. Question Classifier
- classify: evergreen / volatile / mixed
- classify: topic/subtopic
- classify: expected difficulty

### Step 2. Route Selection
- evergreen -> internal-first
- volatile -> live-official-first
- mixed -> hybrid

### Step 3. Retrieval
- internal: vector top-k (필요하면 rerank)
- live: 허용 도메인 기반 최근 문서 검색 + chunk화
- hybrid: internal 1차 + live 2차 보강

### Step 4. Confidence Gate
- 근거 점수 미달 시:
  - 답변을 단정하지 않는다.
  - "추가 확인 필요" 문구와 함께 보수 응답.

## Answer Policy

응답 형식 규칙:
- 핵심 답변 (짧게)
- 왜 그런지 (근거 요약)
- 출처 1~2개 (title/url/date)
- 불확실성 표시(필요 시)

금지 규칙:
- 출처 없는 단정
- 최신성/정확성 혼동("최신이라 무조건 맞다")

## Integration Point in Vector

기존 구조를 유지하며 `direct_question`, `direct_thread_turn`, `teach` 단계에서만 RAG를 호출한다.
- 질문 생성(topic 생성)은 기존 로직 유지
- 평가(evaluate)는 기존 기준 유지 + 필요 시 근거 조회
- 교정(teach)에서 RAG 우선 사용

## Quality Metrics (초기)

- citation_coverage: 답변 중 출처 포함 비율
- grounded_answer_rate: 근거 기반으로 답한 비율
- unsupported_claim_rate: 출처 없는 단정 비율
- fallback_rate: "추가 확인 필요" 응답 비율

초기 목표:
- citation_coverage >= 80%
- unsupported_claim_rate <= 10%

## Rollout Plan (2단계)

### Phase 1: RAG-lite (1~2주)
- 도메인 2~3개만 온보딩 (예: DB/OS/Network)
- internal retrieval + citation 출력
- 평가셋 20~30문항으로 품질 체크

### Phase 2: Hybrid Live Search
- volatile 주제에 한해 공식 문서 라이브 검색 추가
- 도메인 allowlist 적용
- freshness metadata/date 기반 응답 정책 적용

## Risks / Mitigations

1) 최신 자료 오염
- 대응: 도메인 allowlist + source tier

2) 검색 실패 시 환각
- 대응: confidence gate + 보수 응답

3) 복잡도 과상승
- 대응: RAG를 teach/direct_answer 경로에만 제한

4) 운영 비용 증가
- 대응: top-k 제한, 캐시, 주제별 인덱스 분리

## Decision Checklist (구현 전 확인)

- 내부 지식 소스 최소 범위 확정 (도메인 2~3개)
- live 검색 허용 도메인 목록 확정
- citation 출력 포맷 확정
- 품질 측정 질문셋(20~30개) 준비
- 실패 시 fallback 문구 확정

## Definition of Ready

아래 조건을 만족하면 구현 착수 가능.
- 도메인 범위와 소스 tier 규칙이 합의됨
- 평가셋이 준비됨
- Phase 1 범위가 "RAG-lite"로 제한됨

