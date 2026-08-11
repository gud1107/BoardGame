# 아키텍처 표준 — 무한 확장 모듈형 보드게임 플러그인 규격

이 문서는 **신규 게임을 추가할 때 반드시 지켜야 할 계약**이다. "왜 이렇게 설계했는가"(트레이드오프, 데이터 모델, 온라인 대전 신뢰 모델의 상세 근거)는 [docs/architecture.md](./docs/architecture.md)를 보라 — 그쪽은 심화 설계 노트, 이 문서는 표준 그 자체다. 락스텝 동기화 프로토콜의 세부사항은 [docs/cloud-sync.md](./docs/cloud-sync.md)에 있다.

10개 게임(하나미코지·뱅!·그리드 포커·아발론·노땡스·페루도·센추리·틀린 그림 찾기·스플렌더·오이 다섯 개)이 전부 아래 규격을 따르며 실제로 검증됐다(Vitest 유닛 테스트 전량 통과, 프로덕션 배포 중).

---

## 1. 게임 엔진 규격 (`GameEngine<State, Action>`)

모든 게임의 규칙은 **순수 리듀서** 한 함수로 표현된다:

```ts
applyAction(state: State, action: Action): State
```

지켜야 할 세 가지 계약:

1. **순수 함수** — React, 네트워크(Supabase 등), 벽시계 시간(`Date.now()`, `Math.random()`)을 직접 호출하지 않는다. 시간이 필요하면 액션에 값을 실어 전달한다(예: 틀린 그림 찾기의 오답 페널티 잠금은 클릭 액션에 `atMs`를 실어 결정론을 유지한다).
2. **불변성** — `state`를 직접 변형(mutate)하지 않고 항상 새 객체를 반환한다.
3. **결정론적 테스트 가능성** — 무작위성이 필요한 초기화(`startGame(...)`)는 항상 시드 인자로 난수 생성기를 주입받는다(`src/lib/rng.ts`의 `seededRng(seed)`). 같은 시드 → 항상 같은 결과라서, 온라인 대전에서 방장이 시드 하나만 브로드캐스트하면 모든 클라이언트가 각자 동일한 초기 상태를 재현할 수 있다(락스텝의 기반, [docs/cloud-sync.md](./docs/cloud-sync.md)).

이 세 계약 덕분에 `<Game>.test.ts`가 `engine.ts` 하나만 import해서 100% 결정론적으로 전체 규칙을 검증할 수 있다.

## 2. 표준 모듈 레이아웃

신규 게임은 `src/games/<gameId>/` 아래 독립 폴더로 격리한다. 다른 게임 폴더를 import하지 않는다 — 게임 간 코드 결합은 0이어야 한다(공용 로직은 §4의 `src/lib/`, `src/games/types.ts`로만 공유).

```
src/games/<gameId>/
  engine.ts            순수 리듀서 — §1 계약을 지키는 유일한 규칙 소스. 테스트 대상.
  <Game>Board.tsx       제어(controlled) 컴포넌트 — state는 props로만 받고, 사용자 조작은
                         EngineAction으로 변환해 onAction 콜백으로만 위임한다. 네트워크/내기
                         시스템을 모른다.
  <Game>Game.tsx         방 로비(생성/참여) + Supabase Realtime 락스텝 동기화 + PlayableGameProps
                         구현. 게임 규칙 자체는 engine.ts 함수 호출로만 알고 있다.
  RulebookModal.tsx      인앱 룰북 요약 모달 (boardGameRule/<gameId>.md 원문 기반)
  <Game>.test.ts         Vitest 유닛 테스트 — engine.ts만 import, 시드 고정으로 결정론적 검증

  (선택, 게임별로 필요할 때만 추가 — 기본 계약엔 없음)
  cards.ts               카드/타일 등 대량 정적 데이터 + 관련 연산 헬퍼 (예: century, splendor)
  <Feature>Icon.tsx       순수 인라인 SVG 아이콘 (외부 이미지 자산 없이 그 게임 전용 비주얼)
  dice3d/ 등 하위 폴더    그 게임에만 필요한 복잡한 렌더링 서브모듈 (예: perudo의 실제 3D 주사위)
```

3계층(엔진 / 보드 UI / 네트워크 어댑터)이 서로 알면 안 되는 것에 대한 상세 표와 근거는 [docs/architecture.md §1.6](./docs/architecture.md#16-순수-엔진--제어-컴포넌트--얇은-네트워크-어댑터-3계층)을 보라.

**알려진 사각지대**: `<Game>Board.tsx`/`<Game>Game.tsx`는 자동 테스트 대상 밖이다(jsdom 미설치, `vitest.config.mts`가 `environment: "node"`). 엔진 테스트가 100% 통과해도 UI가 그 값을 잘못 소비하는 버그는 잡히지 않는다 — 실제 사례 10건이 [docs/troubleshooting.md](./docs/troubleshooting.md)에 있다. UI 변경 후에는 실제 렌더링(임시 라우트 스크린샷 등, [docs/troubleshooting.md의 검증 방법](./docs/troubleshooting.md) 참고)으로 육안 확인할 것.

## 3. 게임 등록 절차 (4단계)

1. **카탈로그에 데이터로 등록**: `src/games/registry.ts`의 `GAME_REGISTRY` 배열에 `GameMeta` 객체 하나 추가(`playable: false`로 시작해도 "준비중" 카드로 즉시 대시보드에 노출됨 — `GameMeta`/`PlayableGameProps` 타입은 `src/games/types.ts`).
2. **엔진 + 컴포넌트 구현**: §2의 표준 레이아웃대로 `src/games/<gameId>/`를 채운다. 룰 원전은 `boardGameRule/<gameId>.md`를 근거 자료로 삼는다(§5 참고).
3. **동적 import로 연결**: `src/games/playableGames.tsx`의 `PLAYABLE_GAME_COMPONENTS`에 `dynamic(() => import("./<gameId>/<Game>Game"), { ssr: false })`로 등록. **반드시 동적 import** — 대시보드 번들이 구현된 게임 수에 비례해 커지지 않게 하는 유일한 장치다(게임이 100종으로 늘어도 첫 로딩은 무거워지지 않는다).
4. **`playable: true`로 전환**: registry.ts의 해당 항목만 뒤집으면 끝.

`supportsAutoRanking`이 `true`면 엔진이 스스로 `GameCompletionResult.rankings`를 계산해 `onComplete`로 보고해야 하고(승자/순위 비교 로직은 게임마다 다르되 모양은 항상 이 인터페이스), `false`면 플레이 후 수동 순위 입력 화면(`RoundResultEntry`)이 자동으로 뜬다. `onlineMultiplayer: true`면 `/games/[gameId]`가 로컬 참가자 선택 단계를 건너뛰고 게임 자신의 방 로비로 위임한다.

## 4. 재사용해야 할 공용 빌딩 블록

새 게임을 만들 때 아래를 먼저 확인하고, 있으면 반드시 재사용한다(중복 정의 금지):

| 무엇 | 위치 | 용도 |
|---|---|---|
| `seededRng(seed)`, `shuffle(arr, rng)` | `src/lib/rng.ts` | 결정론적 난수/셔플. 게임마다 새로 구현하지 말 것. |
| `PlayableGameProps`, `GameMeta`, `GameCompletionResult` | `src/games/types.ts` | 카탈로그·내기 시스템과 맞물리는 계약 타입. |
| 락스텝 온라인 동기화 패턴(시드 브로드캐스트 → 각자 계산 → `EngineAction` 재생, 재접속 `state-request`/`state-sync`, 좌석 충돌 자가치유) | [docs/cloud-sync.md](./docs/cloud-sync.md) | 대부분의 `<Game>Game.tsx`가 이 프로토콜을 그대로 재사용한다. 새 게임도 새 프로토콜을 발명하지 말 것 — **단, 지렁이처럼 이산 액션이 아니라 연속 물리 시뮬레이션인 장르는 예외**([docs/cloud-sync.md §5](./docs/cloud-sync.md#5-예외-지렁이는-락스텝이-아니라-호스트-권위-실시간-동기화를-쓴다)의 호스트 권위 스냅샷 패턴을 재사용할 것). |
| 파생 상태(derived state) 금지 원칙 | [docs/architecture.md §1.4](./docs/architecture.md#14-파생-상태derived-state-금지-원칙) | 같은 사실을 두 상태로 따로 표현하지 말 것 — 과거 버그 3건의 공통 원인. |
| 게임 로직 ↔ 내기(정산) 로직 분리 | [docs/architecture.md §1.5](./docs/architecture.md#15-게임-로직과-내기정산-로직의-완전한-분리) | `<Game>Board.tsx`/`engine.ts`는 내기 시스템의 존재를 몰라야 한다. `<Game>Game.tsx`가 유일한 변환 지점. |

## 5. 룰북 원전 (`boardGameRule/`)

각 플레이 가능 게임은 대응하는 룰북 마크다운을 엔진 구현의 근거 자료로 삼는다. 작업 지시와 룰북 원문이 다른 사실을 말하면 **룰북 원문 쪽을 채택**하고 그 판단을 엔진 파일 상단 주석 또는 문서에 남긴다(실제 사례: 센추리 자원 가치 순서, 페루도 차등 페널티 수식).

**목표 규격(아직 미적용)**: 파일명을 `boardGameRule/<gameId>.md`(게임 ID와 1:1, kebab-case)로 통일하고, 모든 룰북을 `개요 / 구성품 / 핵심 룰 / 하우스 룰` 4단 템플릿으로 맞춘다. 이 표준화는 2026-08-09 문서 재정리 세션에서 시도했으나, 같은 폴더를 동시에 다른 이름 규칙(한글 파일명)으로 재구성하던 별도 세션과 충돌해 되돌리고 보류했다 — 실제 적용 전에는 파일명이 게임마다 표기가 제각각(영문/한글/공백 혼용)일 수 있다는 점을 감안할 것. 최신 상태는 [HANDOFF.md](./HANDOFF.md)를 확인.

## 6. 테스트/결정론 체크리스트 (새 엔진 작성 시)

- [ ] `applyAction`이 순수 함수인가 (React/네트워크/`Date.now()`/`Math.random()` 직접 호출 없음)
- [ ] 초기화(`startGame` 등)가 시드 인자를 받는가, 그 시드로 재현 가능한가
- [ ] `<Game>.test.ts`가 시드를 고정해 승리 조건/엣지 케이스를 결정론적으로 검증하는가
- [ ] 온라인 대전이라면 `<Game>Game.tsx`가 [docs/cloud-sync.md](./docs/cloud-sync.md)의 표준 락스텝 프로토콜을 그대로 따르는가(새 동기화 채널을 발명하지 않았는가)
- [ ] UI 변경분을 실제 렌더링(스크린샷 등)으로 육안 확인했는가 — 엔진 테스트 통과는 UI 정상 동작을 보장하지 않는다(§2 "알려진 사각지대")
