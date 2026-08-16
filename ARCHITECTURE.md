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
  dice/ 등 하위 폴더      그 게임에만 필요한 복잡한 렌더링 서브모듈 (예: perudo의 탑뷰 CSS/SVG 주사위)
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
- [ ] **엔진이 `getValidMoves`/`chooseBotAction`을 export하는가, `<Game>Game.tsx`가 `useBotAutoplay`와 로비 봇 슬롯 UI를 연결했는가** — §7 참고, **모든 신규 온라인 대전 게임의 필수 계약**이다.

## 7. AI 플레이어 지원 (모든 신규 게임 필수 계약)

**사람이 한 명도 없어도(또는 일부만 있어도) 즉시 플레이할 수 있어야 한다.** 온라인 대전 게임(`onlineMultiplayer: true`)을 새로 추가할 때는 반드시 아래 세 가지를 함께 구현한다 — "나중에 추가"가 아니라 최초 구현 시점의 기본 계약이다. 2026-08-12 세션에서 하나미코지·노땡스·페루도·스플렌더 4종에 파일럿으로 전면 적용해 패턴을 확립했다(`git log`에서 `feat(bot):`로 검색). 나머지 기존 게임(15종)은 아직 이 계약 적용 전이므로, 그 게임들을 다음에 만지는 세션에서 함께 적용할 것 — 신규 게임은 처음부터 이 계약을 지켜야 한다.

### 7.1 엔진: `getValidMoves` + `chooseBotAction`

`engine.ts`가 두 함수를 추가로 export한다:

```ts
/** seat가 지금 제출할 수 있는 모든 합법 EngineAction. applyAction의 가드를 그대로 거울처럼 반영 — 여기서 만든 액션은 절대 no-op으로 거부되지 않는다. */
export function getValidMoves(state: State, seat: Seat): EngineAction[]

/** getValidMoves 중 최고점 액션을 고른다(동점은 rng로 타이브레이크). seat가 지금 할 게 없으면 null. rng는 기본 Math.random — 봇 판단은 로컬 UX일 뿐 엔진 결정론 계약(§1) 밖이다. */
export function chooseBotAction(state: State, seat: Seat, rng?: () => number): EngineAction | null
```

`getValidMoves`는 각 액션 핸들러가 이미 쓰는 가드(현재 phase, 활성 좌석 등)를 그대로 재사용해서 액션을 열거한다 — 새 검증 로직을 따로 만들지 않는다. 응답 대기(예: 하나미코지의 gift/compete 응답, 스플렌더의 discard/noble 선택)처럼 "활성 좌석"이 아니라 다른 좌석이 결정할 차례인 phase가 있다면, `getValidMoves(state, seat)`가 그 phase에서 실제 결정권자에게만 비어있지 않은 배열을 반환하도록 한다 — 호출자는 phase를 따로 분기하지 않고 "이 seat가 지금 뭘 할 수 있는지"만 물어보면 된다.

`chooseBotAction`의 점수 매기기는 **완전 탐색이 아니라 간단한 휴리스틱**이면 충분하다(각 게임 engine.ts의 `scoreMove` 참고 — 예: 하나미코지는 카드 가치 기준 최선/최악 헤아리기, 페루도는 EV 근사, 스플렌더는 그리디 포인트/색상 유틸리티). 단, **정보 공정성을 지킨다** — 이 프로젝트의 모든 클라이언트는 상대방의 숨겨진 정보(카드/주사위 등)까지 포함한 전체 상태를 들고 있지만([docs/architecture.md §2](./docs/architecture.md#2-온라인-대전의-신뢰-모델-문서화된-의도적-한계)의 신뢰 모델), 봇은 그 상태 중 **자신의 seat가 실제로 볼 수 있는 정보만** 판단에 써야 한다(페루도의 `estimateExpectedCount`가 다른 좌석의 `dice` 배열을 절대 읽지 않는 것이 예시).

### 7.2 컨트롤러: `useBotAutoplay`

`src/games/shared/bot/useBotAutoplay.ts`의 범용 훅을 그대로 재사용한다(새로 만들지 않는다):

```ts
useBotAutoplay<State, Action, Seat>({
  active: isHost && phase === "playing", // 호스트 클라이언트에서만 true
  state: gameState,
  currentActor: gameCurrentActor,        // 모듈 스코프 순수 함수 — 지금 누가 결정할 차례인지
  botSeats: botSeatSet,                  // useMemo(() => new Set(botSeats), [botSeats])
  chooseAction: gameChooseAction,        // (state, actor) => chooseBotAction(state, actor)
  dispatch: handleAction,
});
```

**호스트만 봇을 굴린다** — 봇은 자기 기기가 없으므로, 방을 만든 호스트 클라이언트가 봇의 결정을 로컬로 계산해서 사람의 액션과 똑같이 `game-action`으로 브로드캐스트한다. 다른 클라이언트는 그 결과를 그냥 재생만 한다 — 락스텝의 단일 쓰기자 불변조건(§1, [docs/cloud-sync.md §1](./docs/cloud-sync.md#1-왜-서버-권위-엔진이-아니라-락스텝인가))을 그대로 지킨다. 0.5~1.5초 랜덤 딜레이는 훅 기본값 그대로 쓴다(사람처럼 "생각하는" 텀).

`currentActor`/`chooseAction`은 **컴포넌트 밖, 모듈 스코프의 순수 함수**로 선언한다(인라인 클로저 금지) — 매 렌더마다 새 함수 참조가 생기면 훅의 effect가 불필요하게 재구동된다.

### 7.3 로비: 봇 슬롯 추가/제거

`src/components/lobby/BotSeatControls.tsx`(`AddBotButton`/`RemoveBotButton`/`BotSeatBadge`)와 `src/games/shared/bot/botNaming.ts`(`botLabel`/`botDisplayName`, "🤖 AI 봇 N" 표기)를 재사용한다. 대기실(`waiting` phase) UI에서:

- **빈 좌석만** 봇으로 채울 수 있다 — 이미 접속한 사람을 강제로 대체하지 않는다(호스트 전용 컨트롤).
- 호스트의 로컬 `botSeats`/`botRoles` 상태가 유일한 진실 공급원이다. 추가/제거 시 `bot-roster` 브로드캐스트 이벤트로 다른 클라이언트에 알리고, `game-start`/`state-sync` 페이로드에도 실어 보내 재접속·매치 시작 시점에도 항상 동일한 로스터가 재현되게 한다(새 이벤트 타입이지만 기존 락스텝 프로토콜을 확장하는 것이지 새로 발명하는 게 아니다).
- 사람이 나중에 봇이 있던 좌석을 실제로 점유하면, 호스트가 자동으로 그 좌석을 로스터에서 제외한다(렌더 중 파생 상태로 처리 — `useEffect` 안에서 `setState`하면 `react-hooks/set-state-in-effect` 린트 규칙에 걸리므로, §2의 "좌석 충돌 자가치유"와 같은 "compare and setState during render" 패턴을 그대로 쓴다. 단, 렌더 중에는 `ref` 쓰기나 네트워크 브로드캐스트 같은 부수효과를 절대 실행하지 않는다 — 호스트 전용 시작 조건만 갱신하면 충분하고, 다른 클라이언트는 어차피 실제 Presence 접속자를 봇 배지보다 우선해서 렌더링하므로 즉시 알 필요가 없다).
- "N명이 모이면 자동 시작" 카운트는 `occupants.length + botSeats.length`로 계산한다 — 봇도 좌석을 채운 것으로 취급.

### 7.4 신규 게임 체크리스트

새 온라인 대전 게임을 추가할 때:

1. `engine.ts`에 `getValidMoves`/`chooseBotAction` 작성(§7.1).
2. `<Game>Game.tsx`에 `botSeats`/`botRoles` 상태 + `bot-roster` 브로드캐스트 + 대기실 봇 추가/제거 버튼(§7.3) + `useBotAutoplay` 연결(§7.2).
3. `<Game>.test.ts`에 최소한: (a) `getValidMoves`가 활성/비활성 좌석을 올바르게 가르는지, (b) `chooseBotAction`이 항상 합법 액션을 반환하는지(널 아님), (c) 봇끼리 끝까지 자동 진행시켜도 게임이 정상 종료하는지(무한루프/예외 없음) — 세 가지를 반드시 커버한다.
4. §2의 "알려진 사각지대"(Board/Game 컴포넌트는 자동 테스트 밖)가 여기도 적용된다 — 로비 봇 버튼/자동 턴 진행의 실제 UI 동작은 엔진 테스트로 보장되지 않으니 실제 렌더링으로 육안 확인할 것.
5. Level 1~10 난이도까지 원한다면 §7.5도 함께 적용한다(선택 — 아래 "적용 상태" 참고, 필수 계약은 아니다).

### 7.5 Level 1~10 난이도 (선택적 확장 계층, 2026-08-13 신규)

§7.1의 `chooseBotAction`은 원래 난이도가 없는 "항상 최고점 액션" 봇이었다. 그 위에 **선택적으로** Level 1~10 난이도를 얹을 수 있다 — 대상 게임은 시그니처를 `chooseBotAction(state, seat, level, rng?)`로 확장한다(레벨 없는 파일럿 게임과 섞여 있어도 무방 — 레벨은 계약이 아니라 확장).

- **공용 커브**: `src/games/shared/bot/botDifficulty.ts`가 게임 전체가 공유하는 단 하나의 난이도 곡선을 제공한다.
  - `botTier(level)`: 1~3=`novice`, 4~7=`core`, 8~10=`expert` 3단계.
  - `pickByLevel(candidates, level, rng)`: 게임별 `scoreMove`가 매긴 점수 목록을 받아, 레벨이 낮을수록 (a) 점수 무시하고 완전 무작위를 고르는 "실수" 확률이 높고 (b) "최고점과 동률"로 봐주는 오차 허용폭이 넓다. 레벨 10은 실수 확률 0%·허용폭 0(항상 순수 argmax). **게임마다 이 커브를 새로 만들지 말 것** — `scoreMove`(게임별 휴리스티) 따로, "그 점수를 얼마나 잘 따르는가"는 이 한 함수가 전담.
- **점수 함수 설계 지침**: `core`(4~7)는 "기본 규칙+확률 고려" 수준의 단순 휴리스틱, `expert`(8~10)는 그 게임에서 공개적으로 알 수 있는 정보(상대의 보이는 카드, 이미 드러난 덱 구성, 공개된 장비/자원 등 — §7.1의 정보 공정성 원칙 그대로)를 더 깊게 활용한 근사치. **완전탐색/실제 미니맥스가 아니어도 된다** — "레벨이 오를수록 실제로 더 잘 둔다"가 테스트로 검증되면 충분하다(아래 참고).
- **로비 UI**: `botNaming.ts`의 `botLabel`/`botDisplayName`에 선택적 `level` 인자를 넘기면 `[Lv.N]`이 라벨에 접두된다(인자 생략 시 레벨 없는 기존 표기 그대로 — 하위 호환). `BotSeatControls.tsx`의 `AddBotButton`은 `onAddWithLevel` prop을 받으면 Lv.1~10 드롭다운을 자동으로 함께 렌더링한다.
- **테스트**: `<Game>.test.ts`에 "Lv.1(강제로 실수 경로를 타게 만든 rng)과 Lv.10(실수 0%)의 실제 선택이 갈린다"를 검증하는 결정론적 테스트를 반드시 추가한다 — 두 레벨 모두 같은 `rng`(예: 항상 0을 반환)를 주입해도 Lv.1은 후보 목록의 "첫 번째"(무작위 픽 경로가 선택), Lv.10은 "점수 최고"(argmax 경로)로 갈리도록 시나리오를 설계하면 결정론적으로 재현 가능하다(forSale/coyote/lasVegas/grid-poker/summonersRift의 기존 테스트가 예시).
- **적용 상태**: 온라인 대전 19종 중 15종 완료 — 포세일·코요테·라스베가스·그리드 포커·소환사의 협곡(2026-08-13 신규 적용) + 오이 다섯 개·달무티·러브레터·레지스탕스 쿠·언어의 조각·말달리자·틀린 그림 찾기·센추리·아발론·뱅!(같은 날 후속 세션, HANDOFF.md 참고). 하나미코지·노땡스·페루도·스플렌더 4종은 봇은 있지만 아직 레벨이 없다(§7.1 시그니처 그대로 — 다음에 만지는 세션에서 `pickByLevel`로 리팩터링). 지렁이는 호스트 권위 실시간 물리 시뮬레이션이라 "누가 지금 결정할 차례인가"라는 턴 개념 자체가 없어 §7.1/§7.2의 표준 패턴이 그대로 안 맞는 유일한 예외 — 별도 설계가 필요하며 아직 미착수.
