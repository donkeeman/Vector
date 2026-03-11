# Stale Study Thread Reset Design

## Goal
- 테스트 중 앱 재시작이나 wake/unlock이 자주 일어나도, 예전에 열린 study 스레드 때문에 자동 질문이 막히지 않게 한다.
- 이 동작은 lifecycle start 경로에만 적용해서 manual `!start` / `!stop` 의미는 유지한다.

## Problem Summary
- 현재 `TutorBot.applyControlCommand("start")`는 열린 study 스레드가 있으면 새 자동 질문을 보내지 않는다.
- SQLite에 열린 study 스레드가 남아 있으면 앱 재기동이나 wake 이후에도 같은 상태가 복구되어 자동 질문이 막힌다.
- 테스트 중에는 이 복구가 오히려 방해가 된다.

## Chosen Approach
- lifecycle manager의 app launch, wake, unlock start 경로에서만 stale cleanup을 수행한다.
- cleanup은 열린 `study` 스레드만 찾아 `stale` 상태로 닫는다.
- `direct_qa` 스레드는 유지한다.
- cleanup 후 기존 start 경로를 그대로 타서, 열린 study 스레드가 없으면 자동 질문이 다시 발송된다.

## Alternatives Considered
- `!start` 자체가 열린 study 스레드를 전부 닫게 하기
  - 단순하지만 manual 재개 의미까지 바뀐다.
- 열린 study 스레드가 있으면 새 질문 대신 재촉 메시지를 보내기
  - 운영 UX로는 더 자연스럽지만, 지금 테스트 중 문제를 바로 푸는 데는 느리다.

## Data / Status
- thread status에 `stale` 값을 새로 사용한다.
- `status === "open"`만 열림으로 간주하는 기존 로직과 충돌하지 않는다.
- topic memory나 attempt 기록은 건드리지 않는다.

## Runtime Flow
- app launch:
  - 열린 study 스레드 stale cleanup
  - `start` 적용
  - 열린 study 스레드가 없으면 첫 질문 dispatch
- wake/unlock:
  - 열린 study 스레드 stale cleanup
  - `start` 적용
- stop/sleep/lock:
  - 기존 로직 그대로 유지

## Testing
- tutor bot에 `closeOpenStudyThreadsAsStale` 같은 helper를 추가하고:
  - 열린 study 스레드만 `stale`로 닫는지
  - direct Q&A는 남기는지 검증
- lifecycle manager test에서:
  - app launch와 wake/unlock 시 cleanup이 start보다 먼저 호출되는지 검증

