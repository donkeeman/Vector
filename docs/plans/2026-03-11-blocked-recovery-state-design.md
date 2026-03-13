# Blocked Recovery State Design

## Goal
- study 스레드에서 `blocked`가 나와도 스레드를 닫지 않고, 같은 막힌 지점부터 설명과 재답변을 이어가게 한다.
- `mastered`를 `clean mastery`와 `recovered mastery`로 구분해 사용자에게도 다르게 보이고, 복습 간격도 다르게 준다.
- major state transition 때만 짧은 상태 답글을 남겨 현재 스레드 상태를 분명히 보이게 한다.

## Problem Summary
- 현재 `blocked`는 teaching 한 번 후 바로 스레드를 닫는다.
- 그래서 사용자가 "정확히는 b-tree 인덱스가 뭔지부터 모르겠어"처럼 후속 질문을 해도 무시된다.
- 또한 `mastered`는 "한 번에 맞힌 경우"와 "설명 듣고 회복한 경우"를 구분하지 않아 학습 정책이 거칠다.

## Chosen Approach
- `blocked`는 종료 상태가 아니라 **열린 teaching 상태**로 남긴다.
- thread가 열린 동안 `blockedOnce` 같은 플래그를 들고 있다가, 이후 `mastered`가 나오면
  - `blockedOnce === false` -> `clean mastery`
  - `blockedOnce === true` -> `recovered mastery`
- topic memory에는 `lastMasteryKind`를 저장해서 `recovered`는 `clean`보다 더 빨리 다시 물을 수 있게 한다.
- 상태 답글은 `blocked`, `mastered_clean`, `mastered_recovered`, `stale`에만 남긴다.

## User-Facing Status Replies
- blocked
  - `하, 역시나. 여기서 막힐 줄 알았다니까? 네 수준에 맞춰 개념부터 아주 '친절하게' 하나씩 뜯어줄게. 자, 눈 크게 뜨고 제대로 배워둬.`
- mastered_clean
  - `어... 어라? 정답이라고? ...쳇, 운이 좋았네. 이번 한 번만 봐준다. 이 스레드는 여기서 닫을 테니까 기어오르지 말고 다음 문제나 기다려.`
- mastered_recovered
  - `하, 처음엔 무너졌으면서 이제 와서 따라오네. 그래도 끝까지는 붙었으니 이번 스레드는 여기서 닫는다. 착각은 하지 마. 이건 겨우 따라온 거지, 처음부터 알고 있던 건 아니니까.`
- stale
  - `테스트 재시작한다며? 이전 기록은 전부 쓰레기통에 버렸어. 깔끔하게 새 흐름에서 다시 붙어보자고. 이번엔 아까처럼 운 좋게 넘어갈 생각 마.`

## Data Model
- thread에 `blockedOnce`를 추가한다.
  - study thread에서 한 번이라도 blocked teaching 상태를 거쳤는지 표시
- topic memory에 `lastMasteryKind`를 추가한다.
  - `clean`
  - `recovered`
- attempt outcome은 기존처럼 `continue|blocked|mastered`를 유지하되,
  - memory update 시 `masteryKind`를 별도로 받는다.

## Runtime Flow

### When Evaluation Becomes Blocked
- teaching 답글을 단다.
- 이어서 blocked 상태 답글을 단다.
- thread status는 계속 `open`
- thread에 `blockedOnce = true`
- 다음 자동 질문 예약은 하지 않는다.

### When User Eventually Masters
- `blockedOnce === false`
  - clean mastery 상태 답글 후 스레드 종료
- `blockedOnce === true`
  - recovered mastery 상태 답글 후 스레드 종료
- 둘 다 다음 자동 질문 예약은 한다.

### When Lifecycle Marks Study Threads Stale
- stale 상태 답글을 먼저 단다.
- 그 뒤 `stale`로 닫는다.

## Review Policy
- blocked: 기존처럼 최소 1일 후
- mastered clean: 기존 mastered 규칙 유지
- mastered recovered: clean mastered보다 한 단계 짧게
  - 예: clean 첫 mastered가 7일이면 recovered는 3일
  - streak 증가도 별도로 더 완만하게 간다.

## Testing
- blocked 결과에서 teaching + blocked 상태 답글이 나가고 thread는 open 유지되는지
- blocked 이후 같은 스레드에 다시 답하면 계속 평가되는지
- clean mastery와 recovered mastery가 다른 상태 답글을 쓰는지
- topic memory가 `lastMasteryKind`에 따라 다른 review 간격을 만드는지
- stale cleanup이 상태 답글 후 stale 종료를 남기는지

