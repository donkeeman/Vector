# Vector RAG-lite 최소 계획 (Vector-First 아님)

작성일: 2026-03-23
범위: 설계/계획만 작성 (구현 보류)

## 1) 목표

- Vector의 설명/교정 답변에 근거를 붙인다.
- 기존 학습 플로우(질문 -> 평가 -> 꼬리질문)는 유지한다.
- **1차는 벡터 없이** RAG 파이프라인을 먼저 완성한다.

## 2) 범위 (최소)

- 도메인 2개만 시작: DB, OS
- 적용 지점: `teach`, `direct_question`
- 검색 방식: **키워드 기반(top-k)**

## 3) 저장 필드 (최소)

### documents
- `id`
- `source` (url/path)
- `title`
- `text`
- `updated_at`

### chunks
- `id`
- `document_id`
- `text`
- `keywords` (json/문자열)

### qa_logs
- `id`
- `question`
- `retrieved_chunk_ids` (json)
- `answer`
- `created_at`

## 4) 동작 흐름 (최소)

1. 문서 수집 -> `documents` 저장
2. 문서 청크 분할 + 키워드 추출 -> `chunks` 저장
3. 질문 입력 시 키워드 매칭 top-k(기본 3) 검색
4. 검색 결과를 LLM 프롬프트에 넣어 답변 생성
5. 답변 + 사용 chunk id를 `qa_logs`에 저장

## 5) 답변 규칙 (최소)

- 근거 chunk가 있으면 답변 끝에 출처 1개 이상 표시
- 근거가 없으면 단정하지 않고 "추가 확인 필요"로 응답

## 6) 완료 기준 (DoD)

- DB/OS 문서 각 5개 이상 인덱싱
- `teach/direct_question`에서 citation 출력 동작
- 샘플 질문 20개 중 80% 이상이 근거 포함 답변

## 7) 다음 단계 (2차 확장)

- 키워드 검색 한계(동의어/표현 차이) 확인 후 벡터 검색 추가
- `chunks.embedding` 필드 추가
- 검색 전략을 hybrid(BM25 + vector)로 확장

