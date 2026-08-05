# 아키텍처 & 데이터 모델

이 문서는 "무엇이 있는가"보다 "왜 이렇게 만들었는가"에 초점을 둔다. 코드 자체가 이미 무엇이 있는지는 보여주므로, 여기서는 설계 의도·트레이드오프·바로잡은 스펙 해석을 남긴다.

관련 문서: [cloud-sync.md](./cloud-sync.md)(실시간 동기화 상세) · [features.md](./features.md)(기능별 동작) · [troubleshooting.md](./troubleshooting.md)(발견된 버그와 교훈)

---

## 1. 핵심 설계 원칙

### 1.1 IndexedDB가 주 저장소, Supabase는 선택적 보강 레이어

스펙상 이 앱은 **완전 오프라인으로 전체 기능이 동작**해야 한다. 그래서 데이터 소유권 순서가 명확히 고정되어 있다:

1. **IndexedDB(`idb` 래퍼, `src/lib/db/`)** — 모든 도메인 데이터(플레이어, 내기 세션, 일자별 기록, 게임 결과)의 **유일한 authoritative 저장소**. 브라우저 하나에 국한되지만, 서버가 없어도 전체 기능이 완결된다.
2. **Supabase(`src/lib/supabase/`)** — 켜져 있으면 두 가지만 "보강"한다: (a) 다른 기기 간 플레이어 식별 힌트(`device_sightings`), (b) 종료된 내기 세션의 클라우드 백업(`daily_records`). 두 경우 모두 **best-effort**로 처리되며(`try { } catch { }`로 감싸 실패해도 무시), IndexedDB 쓰기가 이미 끝난 뒤에 "덤으로" 시도된다. `getSupabase()`가 `null`을 반환하면(환경변수 미설정) 호출부는 예외 없이 조용히 기능을 끈다 — **"설정 안 함 = 에러"가 아니라 "설정 안 함 = 부분 기능 비활성화"**가 계약이다.
3. **온라인 대전 4종(하나미코지·뱅!·그리드 포커·아발론)만 예외** — Realtime Presence/Broadcast가 곧 통신 수단 자체이므로 이 게임들은 Supabase 없이 원천적으로 불가능하다. 나머지(대시보드, 내기 정산, 기록 열람)는 Supabase 유무와 무관하게 100% 동작한다. 자세한 내용은 [cloud-sync.md](./cloud-sync.md).

**왜 이렇게 나눴는가**: "친구들끼리 로컬에서 쓰는 캐주얼 앱"이라는 제품 성격상, 백엔드 서버를 새로 운영하는 비용(과금, 배포, 장애 대응)을 지우지 않으면서도 원할 때만 기기 간 기능을 얹을 수 있어야 했다. IndexedDB를 1차로 두면 이 요구가 구조적으로 강제된다 — Supabase 코드를 지워도 앱이 깨지지 않는지가 곧 "제대로 보강 레이어로만 썼는가"의 리트머스 시험지다.

### 1.2 "Dexie.js 대신 기존 idb 유지" — 중복 추상화를 피함

한때 "Dexie.js로 저장 로직을 옮기자"는 요청이 있었으나, `idb`와 Dexie.js는 같은 IndexedDB 위에서 동작하는 동급 래퍼다. 둘을 동시에 두면 커넥션·스키마 정의가 두 곳으로 갈라져 실수로 다른 버전 정보를 참조하는 버그를 만들기 쉽다. 그래서 새 기능(내기 사이드바의 "내기끝" 저장 등)도 기존 `src/lib/db/repository.ts`의 함수를 그대로 재사용했다. **교훈**: 이미 있는 추상화와 "동급"인 새 라이브러리 도입 요청을 받으면, 먼저 정말 다른 능력을 얻는지(트랜잭션, 마이그레이션, 쿼리 표현력 등) 확인하고, 아니라면 기존 걸 재사용하는 쪽으로 되돌려 제안하는 게 맞다.

### 1.3 "BettingContext" 요청 = 이미 있는 Zustand 스토어

"전역 내기 상태를 Context로 관리해달라"는 요청을 받았을 때, 이미 `useBettingStore`(Zustand, `src/store/bettingStore.ts`)가 그 역할을 하고 있었다. React Context를 별도로 얹으면 같은 데이터를 가리키는 상태가 두 군데로 나뉘어 동기화 버그(한쪽만 업데이트되는 등)가 생기기 쉽다. 그래서 기존 스토어에 `sidebarOpen`/`updateParticipantName`/`updatePayoutTable` 액션만 추가하는 쪽을 택했다. **패턴**: 사용자가 특정 기술 용어(Context, Dexie 등)를 요청하더라도, 그게 가리키는 "역할"이 이미 다른 이름으로 존재한다면 새 상태를 추가하지 않고 기존 걸 확장하는 것이 항상 우선이다.

### 1.4 파생 상태(derived state) 금지 원칙

같은 사실을 표현하는 상태를 두 곳에 따로 두지 않는다. 예:

- **뱅!의 손패-제한 UI 버그(→ [troubleshooting.md#4](./troubleshooting.md))**: "지금 버리기 모드인가"를 `hand.length > life`라는 파생값 하나로만 판단했더니, 사용자가 "턴 종료를 눌렀다"는 실제 트리거 없이도 액션 페이즈 내내 그 모드가 활성화돼버렸다. 수정 후에는 `discarding`(유저가 명시적으로 턴 종료를 시도했을 때만 참이 되는 상태)과 `overHandLimit`(현재 손패/체력 비교의 순수 파생값)을 분리하고, 실제 UI 분기는 항상 `discarding && overHandLimit` 조합으로만 하도록 만들었다. 파생값 단독으로 어떤 모드에 진입시키지 않는다.
- **하나미코지의 "경쟁(경쟁)" 액션 버그(→ [troubleshooting.md#1](./troubleshooting.md))**: "그룹 A에 들어간 카드"를 별도 선택 리스트에서 파생시켰다가, 선택 해제 시 그룹 소속이 갱신되지 않아 제출 버튼이 영원히 비활성 상태가 되는 버그가 났다. 수정 후에는 카드가 "그룹 A / 그룹 B 둘 중 하나에만 속한다"는 상호 배타적 상태로 직접 모델링했다.
- **좌석 배정 ≠ 역할 배정**: 뱅!/아발론 모두 참가 순서로 좌석(seat)이 정해지지만, 비밀 역할(보안관/무법자/... 또는 메를린/모르가나/...)은 좌석과 완전히 독립적으로 별도 셔플된다. 좌석 배열에서 역할을 유추할 수 있는 인덱스 관계를 두지 않는다(`startGame`이 역할을 별도 `shuffle()`로 배정한 뒤에야 좌석 순서를 정함).

### 1.5 게임 로직과 내기(정산) 로직의 완전한 분리

각 게임의 실제 규칙 엔진과 보드 UI(`<Game>Board.tsx`)는 내기 시스템의 존재를 전혀 모른다. 오직 "누가 몇 등을 했는가"(`GameCompletionResult.rankings`)만 `PlayableGameProps.onComplete`로 상위에 보고한다. 이 변환은 각 게임의 얇은 어댑터 컴포넌트(`<Game>Game.tsx`)가 맡는다.

```
<Game>Board.tsx  →  onGameEnd(winnerId 등 순수 게임 결과)
       ↓
<Game>Game.tsx   →  GameCompletionResult { rankings, finishedAt } 로 변환
       ↓
src/app/games/[gameId]/page.tsx  →  내기 세션이 있으면 RoundResultEntry로,
                                     없으면 그냥 완료 화면으로
       ↓
useBettingStore.recordRound()    →  ledger.ts로 제로섬 정산, IndexedDB 저장
```

**왜**: 보드 컴포넌트를 내기 없는 단독 페이지나 다른 정산 방식에도 재사용할 수 있게 하려는 의도다. 실제로 온라인 대전 4종은 각자 다른 방식으로 `rankings`를 만들어내지만(하나미코지·그리드 포커는 승자/점수 비교, 뱅!은 팀 승리, 아발론은 진영 승리), 상위 계층은 이 차이를 전혀 몰라도 된다.

### 1.6 순수 엔진 + 제어 컴포넌트 + 얇은 네트워크 어댑터 3계층

4개의 실제 플레이 가능한 게임(하나미코지·뱅!·그리드 포커·아발론)이 전부 동일한 3계층 구조를 따른다:

| 계층 | 파일 | 책임 | 알면 안 되는 것 |
|---|---|---|---|
| 엔진 | `engine.ts` | 순수 함수 `applyAction(state, action) → state`. 규칙의 유일한 소스. | React, 네트워크, 시간(모든 랜덤은 시드 인자로 주입) |
| 보드 UI | `<Game>Board.tsx` | state를 props로만 받는 완전 제어 컴포넌트. 클릭을 `EngineAction`으로 변환해 `onAction`으로 위임. | 네트워크가 어떻게 동기화되는지, 내기 시스템 |
| 네트워크 어댑터 | `<Game>Game.tsx` | 방 생성/참여 로비, Supabase Realtime 구독, `applyAction` 재생, `PlayableGameProps` 구현. | 게임 규칙 자체(엔진 함수만 호출) |

**왜 3계층인가**: 엔진이 순수 함수라서 Vitest로 100% 결정론적으로 테스트할 수 있고(랜덤도 시드 인자이므로 재현 가능), 보드 UI는 네트워크/스토리지 걱정 없이 렌더링에만 집중할 수 있고, 네트워크 어댑터는 게임마다 로비 UI(인원수 선택 등)만 다르고 나머지 배선(구독/재생/재접속)은 거의 동일한 코드로 복붙된다. **단, 이 분리에는 사각지대가 있다 — `<Game>Board.tsx`는 유닛 테스트 대상이 아니다.** `*.test.ts`는 오직 `engine.ts`만 import해서 테스트하며, `vitest.config.mts`의 `environment: "node"`에서 보듯 jsdom/React Testing Library가 설치되어 있지 않다. 즉 **엔진이 옳아도 UI가 그 값을 잘못 소비하면 어떤 자동 테스트도 잡지 못한다** — 실제로 이 문제로 발생한 버그가 [troubleshooting.md#4](./troubleshooting.md)다. UI 컴포넌트의 조건부 렌더링/이벤트 핸들러를 고칠 때는 테스트 통과만으로 안심하지 말고 코드를 직접 추적해서 검증해야 한다(다음 개선 후보로 `docs/README.md`의 "다음 우선순위"에 기록).

---

## 2. 온라인 대전의 신뢰 모델 (문서화된 의도적 한계)

4개 온라인 게임 모두 **락스텝(lockstep) + 전체 상태 공유** 방식을 쓴다 — 서버 권위(authoritative server) 엔진이 없다.

- 방장이 숫자 시드 하나만 브로드캐스트 → 모든 클라이언트가 `startGame(playerCount, seed)`를 각자 호출해 **동일한** 초기 상태(카드 셔플, 역할 배정 포함)를 독립적으로 계산.
- 이후 모든 사용자 액션은 `EngineAction`으로 브로드캐스트되고, 모든 클라이언트가 같은 순수 리듀서 `applyAction`으로 **재생**해서 계속 동일한 상태로 수렴.
- 결과: 모든 클라이언트가 **다른 사람의 손패·비밀 역할을 포함한 전체 상태**를 항상 메모리에 들고 있다. 화면은 뷰어 자신의 시점만 필터링해서 그릴 뿐, 개발자 도구로 상태를 들여다보면 원리적으로 상대 정보를 알아낼 수 있다.

**왜 서버 권위 엔진을 안 뒀는가**: "친구끼리 하는 캐주얼 플레이" 기준으로, Supabase Edge Function 등에 각자에게 필요한 정보만 필터링해 보내는 서버 로직을 새로 두는 건 이 프로젝트 범위에서 과한 엔지니어링이라고 판단해 명시적으로 채택하지 않았다(README·각 엔진 파일 최상단 doc comment에도 동일하게 문서화됨). 게임별로 이 트레이드오프의 "심각도"가 다르다는 점도 의도적으로 기록해뒀다:

| 게임 | 새는 정보의 성격 | 비고 |
|---|---|---|
| 하나미코지 | 상대 손패(카드 한 장 단위, 순간적) | 상대적으로 저위험 |
| 뱅! | 상대 비밀 역할(라운드 내내 유지되는 핵심 정보) | 단, 죽으면 어차피 공개됨 |
| 아발론 | 상대 비밀 역할 | **게임이 끝날 때까지 아무도 공개되지 않음** — 4종 중 가장 고위험 |
| 그리드 포커 | 상대 보드 전체(첫 배치 칸만 공식적으로 공개) | 락스텝 게임 중 유일하게 "동시 행동"(모두가 같은 라운드에 동시 배치)이라 턴 순서로 쓰기 충돌을 막을 수 없음 — 그래서 공통 카드를 뽑는 액션만 호스트(0번 좌석)가 전담 브로드캐스트 |

이 표는 향후 "정말 부정행위 방지가 필요해지면 어디부터 서버 권위로 옮길지" 우선순위를 정할 때 참고하라고 남겨둔 것이다(아발론 > 뱅! > 그리드 포커 > 하나미코지 순).

동기화 프로토콜(Presence, Broadcast, 재접속 `state-request`/`state-sync`, 좌석 충돌 자가치유)의 세부 사항은 [cloud-sync.md](./cloud-sync.md) 참고.

---

## 3. 데이터 모델

### 3.1 IndexedDB 스키마 (`boardgame-db`, v1 — `src/lib/db/client.ts`)

| Object Store | Key | 인덱스 | 용도 |
|---|---|---|---|
| `players` | `id` (uuid) | `by-name` | 정규화된 플레이어 마스터 레코드. `aliases: string[]`로 과거 닉네임 이력을 함께 보관. |
| `identities` | `deviceId` | `by-player` | 기기 → 플레이어 매핑(N:1, 한 플레이어가 여러 기기를 가질 수 있음). |
| `bettingSessions` | `id` (uuid) | `by-status` | 진행 중/종료된 내기 세션. `status`는 `"active" \| "ended"`지만 **종료 시 레코드 자체를 삭제**하므로(§3.3 참고) 실질적으로 항상 최대 1건만 `active`로 존재. |
| `dailyRecords` | `id` (uuid) | `by-date` | "내기끝"으로 확정된 세션의 **불변 스냅샷**. |
| `gameResults` | `id` (uuid) | `by-game` | 내기와 무관하게 모든 플레이 기록(자유 플레이 포함)을 남기는 별도 로그. |

```ts
// src/lib/db/types.ts 핵심 관계
PlayerRecord         { id, name, aliases[], createdAt, updatedAt }
DeviceIdentityRecord { deviceId, playerId → PlayerRecord.id, lastIp?, updatedAt }
BettingSessionRecord { id, status, participants: {playerId, name}[], payoutTable: number[], rounds: BettingRound[], totals }
BettingRound         { id, gameId, gameName, rankedPlayerIds[], deltas: Record<playerId, number>, playedAt }
DailyRecord          { id, date, sessionId, standings: DailyRecordStanding[], payoutTable, roundCount, createdAt }
GameResultRecord     { id, gameId, gameName, participantIds[], rankedPlayerIds[], playedAt, bettingSessionId? }
```

### 3.2 단위 정규화: "플레이어"는 한 번만 존재하고 참조된다

`BettingSessionRecord.participants`, `BettingRound.rankedPlayerIds`, `GameResultRecord.participantIds`는 전부 `PlayerRecord.id`를 참조로만 들고 이름을 매번 복제하지 않는다(단, `BettingParticipant.name`은 **그 세션 시점의 스냅샷**으로 따로 들고 있음 — 아래 §3.3 참고). 실제 이름 변경(`renamePlayer`)은 `players` 스토어 한 곳에서만 일어나고, `aliases` 배열에 과거 이름을 누적해서 [식별 매칭](./features.md#플레이어-식별)이 옛 닉네임도 인식할 수 있게 한다.

### 3.3 과거 데이터 불변성: "지금 이름"과 "그때 이름"을 의도적으로 분리

- `BettingSessionRecord.participants[].name`, `DailyRecordStanding.name`은 **기록 시점의 닉네임을 그대로 굳힌 스냅샷**이다. 세션 진행 중 `updateParticipantName`으로 이름을 바꾸면 진행 중인 세션의 표시는 즉시 갱신되지만, 이미 `daily_records`로 확정된 과거 기록의 이름은 절대 소급 변경되지 않는다 — "그 날 그 이름으로 얼마를 땄는지"가 역사적 사실이기 때문이다.
- `endSession()`은 `BettingSessionRecord`를 애초에 **삭제**하고(`deleteBettingSession`) `DailyRecord`라는 별개 스키마로 새로 저장한다. 두 타입을 하나로 합쳐 `status` 필드만으로 구분하지 않은 이유: 진행 중 세션(`rounds[]`, `totals` 등 가변 필드가 많음)과 확정된 기록(`standings[]`, `roundCount`처럼 이미 계산이 끝난 요약값)은 읽기 패턴과 불변성 요구가 다르다. 진행 중 데이터의 스키마를 "종료 후에도 그대로 두는" 대신, 종료 시점에 명시적으로 다른 모양으로 **변환·확정**함으로써 과거 기록에 실수로 진행 중 로직이 다시 손대는 경로 자체를 차단한다.

### 3.4 데이터 조합 규칙: 제로섬은 스키마가 아니라 "매 라운드가 테이블 전체를 소비"하는 방식으로 보장

`BettingSessionRecord.payoutTable: number[]`는 세션 시작 시 합계 0으로 검증된다(`validatePayoutTable`, [troubleshooting.md](./troubleshooting.md) 아님 — 정상 설계). 이후 매 라운드(`computeRoundDeltas`, `src/lib/betting/ledger.ts`)는 참가자 랭킹을 **payoutTable과 정확히 같은 길이의 파티션**으로 나눠 항목을 전부 소비한다:

```ts
// ranks = { p1: 1, p2: 1, p3: 3 } (1,1,3위 — 공동 1위 2명)
// payoutTable = [3000, 1000, -4000] (3인 테이블, 합 0)
// → sortedDistinctRanks = [1, 3]
// → rank=1 그룹(p1,p2)이 payoutTable[0..1] = [3000,1000]을 평균(2000)씩 나눠 가짐
// → rank=3 그룹(p3)이 payoutTable[2] = [-4000]을 그대로 가짐
// → deltas = { p1: 2000, p2: 2000, p3: -4000 }  (합계 여전히 0)
```

**왜 이 방식인가**: 동점자가 몇 명이든, 순위를 어떤 식으로 입력하든(간격이 있어도 됨, 예: 1,1,4) `payoutTable`의 전체 항목이 정확히 한 번씩만 소비되므로 라운드 합계가 항상 0이 되는 것이 **코드가 아니라 산술적으로 보장**된다 — 매 라운드마다 별도로 "합계가 0인지" 검증할 필요가 없다. 세션 시작 시 테이블 하나만 0-합 검증하면 이후 모든 라운드·누적 총합(`totals`)이 자동으로 0-합을 유지한다.

### 3.5 인덱스 전략과 의도적 비정규화

- `by-status`(bettingSessions), `by-date`(dailyRecords), `by-game`(gameResults), `by-name`(players), `by-player`(identities) — 전부 **단일 스캔으로 끝나는 조회 패턴**만 인덱싱했다. IndexedDB는 조인이 없으므로 복합 쿼리는 애플리케이션 레벨에서 `getAll()` 후 필터링한다(예: `findPlayersByNameLike`가 전체 플레이어를 읽어와 이름/별칭을 메모리에서 비교). 이 프로젝트 규모(개인/친구 그룹, 최대 수백 건)에서는 전체 스캔 비용이 무시할 만하다고 판단해 정규화·인덱스 최소주의를 택했다 — 사용자 수가 훨씬 커지면 `players`에 소문자 정규화 별칭 전용 인덱스를 추가하는 걸 고려해야 한다.
- **의도적 비정규화**: `BettingSessionRecord.totals: Record<playerId, number>`는 `rounds[].deltas`를 다 더하면 항상 다시 계산할 수 있는 **파생 캐시**다. 매 렌더링마다 라운드 배열 전체를 reduce하지 않고 즉시 읽기 위해 `recordRound()`가 라운드 저장과 같은 트랜잭션 개념으로 `totals`도 함께 갱신한다(`mergeDeltasIntoTotals`). 이 필드는 "진짜 소스"가 아니라 캐시임을 주석에 명시해뒀고, 만약 언젠가 둘이 어긋나는 버그가 생기면 `rounds[]`가 항상 옳다.

---

## 4. 게임 카탈로그: 데이터 중심 확장 설계

`src/games/registry.ts`의 `GAME_REGISTRY: GameMeta[]`는 **순수 데이터**다. 대시보드, 검색/필터, "준비중" 배지 전부 이 배열 하나에서 파생된다(`src/app/page.tsx`가 필터링, `GameGrid`/`GameCard`가 렌더링). 게임을 20종, 100종으로 늘리는 시나리오가 처음부터 설계 목표였기 때문에:

- **`playable: false`인 항목은 UI에서 완전히 동일하게 취급되지만 실제 구현이 없다** — 지금 14종 중 4종만 `playable: true`다. 이는 버그가 아니라 "카탈로그가 실제 구현 개수보다 먼저 커질 수 있다"는 설계 그 자체를 보여주는 의도된 상태.
- 실제 구현을 추가하는 3단계 — (1) `src/games/<id>/`에 `engine.ts`+컴포넌트 작성 (2) `playableGames.tsx`의 `PLAYABLE_GAME_COMPONENTS`에 **동적 import**로 등록 (3) `registry.ts`에서 `playable: true`로 전환 — 중 2번이 핵심이다. `dynamic(() => import(...), { ssr: false })`를 쓰는 이유는 **대시보드 번들이 구현된 게임 수에 비례해 커지지 않게** 하기 위함이다. 게임이 100종으로 늘어도 대시보드 첫 로딩은 안 무거워진다.
- `supportsAutoRanking`: 게임 엔진이 스스로 순위를 계산해 낼 수 있는지(현재 4종 모두 `true`). `false`인 게임은 `RoundResultEntry` 화면이 자동으로 뜨는 수동 순위 입력 경로로 빠진다 — 향후 순위를 스스로 못 정하는 게임(예: 협력 게임)을 추가해도 내기 정산 파이프라인이 깨지지 않도록 처음부터 분기해둔 것.
- `onlineMultiplayer`: 참가자 선택 단계(`/games/[gameId]`의 로컬 로스터 선택 UI)를 건너뛰고 게임 자신의 방 로비로 위임할지 결정. 이 플래그가 로컬 참가자 개념과 온라인 방 개념이 섞이지 않도록 하는 유일한 분기점이다.

---

## 5. 디렉토리 구조 및 계층 규칙

```
src/
  app/                        Next.js App Router (라우팅만, 도메인 로직 없음)
    page.tsx                   대시보드 (검색/필터 + GameGrid)
    games/[gameId]/page.tsx    참가자 선택 → 게임 실행 → 결과 기록의 스테이지 머신
    history/page.tsx           dailyRecords 열람 (읽기 전용)
    api/ip/route.ts            요청자 IP 추출 (Vercel 헤더 기반, 식별 매칭용 약한 신호)
    layout.tsx                 전역 셸: SiteHeader + BettingSidebar(항상 마운트)

  components/                  범용 UI (게임 도메인을 모름)
    GameCard.tsx / GameGrid.tsx  카탈로그 카드 렌더링
    Overlay.tsx / Tooltip.tsx    공용 프리미티브
    betting/                     내기 사이드바 UI 일체
      BettingSidebar.tsx          열기/닫기 + 활성화 스위치 + 진행 중 요약
      RosterEditor.tsx            참가자 추가/이름 수정
      PayoutTableEditor.tsx       상금/벌금표 입력 + 제로섬 검증 UI
      RoundResultEntry.tsx        수동/자동 순위 입력 화면

  games/                       게임 카탈로그 + 각 게임의 자기완결 모듈
    types.ts                    GameMeta, PlayableGameProps 등 전역 계약
    registry.ts                 GAME_REGISTRY (순수 데이터, §4 참고)
    playableGames.tsx            GameId → 동적 import 컴포넌트 매핑
    <game-id>/                   게임마다 동일한 5파일 패턴 (§1.6 참고)
      engine.ts / <Game>Board.tsx / <Game>Game.tsx / RulebookModal.tsx / <Game>.test.ts / meta.ts

  lib/                         도메인 로직 (React를 모름, 순수 함수 또는 IO 래퍼)
    db/                          IndexedDB 스키마·CRUD (§3 참고)
    betting/                     제로섬 검증(zeroSum.ts) + 정산 원장(ledger.ts) — 순수 함수만
    identity/                    기기ID(deviceId.ts) + 식별 판정(resolve.ts)
    supabase/                    선택적 클라우드 (client.ts: 클라이언트 팩토리, sync.ts: 식별/백업 IO)

  store/
    bettingStore.ts              Zustand — 내기 세션 전역 상태 + IndexedDB/Supabase 호출 오케스트레이션

boardGameRule/                 게임별 공식 룰 원문 마크다운 (Avalon.md, bang.md, Grid Poker.md) —
                                 엔진 구현의 근거 자료. 규칙 정확성을 재검증할 때 이 파일과 diff할 것.
supabase/schema.sql            선택적 Supabase 테이블 정의 (device_sightings, daily_records)
docs/                           이 문서들
```

**계층 규칙**(위에서 아래로 의존 방향):

```
app/  →  games/<id>/<Game>Game.tsx (네트워크 어댑터)
              ↓
          <Game>Board.tsx (순수 UI, state는 props로만)
              ↓
          engine.ts (순수 함수, 의존성 없음)

app/, components/betting/  →  store/bettingStore.ts  →  lib/db, lib/betting, lib/supabase
```

`lib/*`와 `games/*/engine.ts`는 서로를 참조하지 않는다 — 게임 규칙과 내기 정산은 완전히 독립된 도메인이며, 연결은 오직 `PlayableGameProps.onComplete`라는 하나의 얇은 인터페이스를 통해서만 이뤄진다(§1.5).
