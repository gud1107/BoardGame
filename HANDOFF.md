# HANDOFF — 현재 스냅샷

_최종 갱신: 2026-08-09 (대시보드 기본 정렬: 플레이 가능한 게임 우선 노출 세션)_

> **이 문서는 "지금 이 순간"의 스냅샷만 담는다.** 새 세션이 `/clear` 직후 가장 먼저 읽어야 할 문서이며, 여기 담긴 정보만으로 이전 맥락을 복원할 수 있어야 한다. **시간순 기록(무엇을 왜 그 순서로 만들었는가)은 [docs/history.md](./docs/history.md)로, 버그 대응 이력은 [docs/troubleshooting.md](./docs/troubleshooting.md)로 넘어갔다** — 이 파일 자체는 계속 짧게 유지하고, 완료된 세션 내용은 매번 `history.md`로 옮겨 적을 것.

---

## 1. Executive Summary

### 목표
**보드게임 허브** — 여러 보드게임을 한 곳에서 플레이하고, 게임 결과에 연동된 "내기(베팅)" 정산까지 관리하는 Next.js 웹앱. 완전 오프라인 동작(IndexedDB 1차 저장소)이 기본이고, Supabase는 온라인 대전 8종에만 필수인 선택적 보강 레이어. 실제 배포 URL: **https://board-game-tau-navy.vercel.app**

### 현재 달성률
- 카탈로그 21종 중 **8종 실제 플레이 가능**: 하나미코지 · 뱅!(Bang!) · 그리드 포커 · 아발론(Avalon) · 노땡스(No Thanks!) · 페루도(Perudo) · 센추리: 향신료의 길(Century: Spice Road) · 틀린 그림 찾기(Spot the Difference). 나머지 13종은 `playable: false`로 "준비중" 카드만 노출(의도된 상태, 버그 아님).
- `npx tsc --noEmit` / `npm run lint`(경고 0) / `npx vitest run`(**312개 전부 통과**) / `npm run build` 전부 그린.
- 이번 세션 작업은 **커밋·푸시·배포까지 완료됨**(사용자가 이번 요청에 명시적으로 포함해 요청).

### 이번 세션 주요 변경 사항
대시보드가 `GAME_REGISTRY` 등록 순서를 그대로 노출해 플레이 가능 8종과 "준비중" 13종이 뒤섞여 있던 것을, 플레이 가능한 게임이 먼저 보이고 "준비중" 게임은 뒤로 밀리도록 기본 정렬을 바꿔달라는 요청. 상세 설계 판단은 [docs/history.md Phase 24](./docs/history.md#phase-24--대시보드-기본-정렬-플레이-가능한-게임-우선-노출-2026-08-09) 참고.

1. **`sortByPlayability` 공용 helper 신설** — `registry.ts`에 `GameMeta.playable`만 보고 "플레이 가능 그룹 먼저 / 준비중 그룹 나중" 순서를 강제하는 정렬 함수를 추가. `Array.prototype.sort`의 안정 정렬(stable sort, ES2019+ 보장) 특성을 이용해 각 그룹 **내부** 순서(카탈로그 순서 혹은 그 앞에 적용된 검색/필터 결과 순서)는 그대로 보존, 원본 배열은 변경하지 않음(`[...games].sort(...)`).
2. **대시보드 필터링 파이프라인 마지막 단계로 적용** — `src/app/page.tsx`의 검색어/인원수 필터 `useMemo`가 걸러낸 결과에 `sortByPlayability`를 통과시켜, 사용자가 검색어를 입력하거나 인원수 필터를 바꿔도 필터링된 하위집합 안에서 항상 "준비중" 항목이 뒤로 가도록 유지.
3. **검증** — `registry.test.ts` 신설(4개 케이스). `npx tsc --noEmit`/`npm run lint`(경고 0)/`npx vitest run`(**312개 전부 통과**, 신규 4개 포함)/`npm run build` 전부 그린. 배열 정렬 순서만 바꾼 것이라 `GameGrid`/`GameCard` 자체는 무변경 — 별도 스크린샷 검증은 생략(docs/history.md Phase 24 §3 판단 근거).

**직전 세션(게임 카드 이미지 잘림 수정 + 대시보드 그리드 레이아웃 개편)**은 [docs/history.md Phase 23](./docs/history.md#phase-23--게임-카드-이미지-잘림-수정object-contain--대시보드-그리드-레이아웃-개편-2026-08-08-같은-날-열다섯-번째-세션)에, **페루도 실제 WebGL 3D 주사위 + 게임 카드 실사 이미지**는 [Phase 22](./docs/history.md#phase-22--페루도-실제-webgl-3d-주사위threejsr3frapier--게임-카드-실사-이미지-2026-08-08-같은-날-열네-번째-세션)에, **페루도 차등 페널티 + CSS 3D 주사위**는 [Phase 21](./docs/history.md#phase-21--페루도-차등-페널티-룰-변경--3d-입체-주사위-ui-2026-08-08-같은-날-열세-번째-세션)에, **틀린 그림 찾기 신규 게임**은 [Phase 20](./docs/history.md#phase-20--틀린-그림-찾기spot-the-difference-신규-게임-2026-08-08)에, **그리드 포커 커스텀 제한시간**은 [Phase 19](./docs/history.md#phase-19--그리드-포커-방-설정에-커스텀-제한시간초-옵션-추가-2026-08-08-같은-날-열한-번째-세션)에, **센추리 UI 전면 개편**은 [Phase 18](./docs/history.md#phase-18--센추리-ui-전면-개편-실물-스파이스-로드-보드판-리스킨-2026-08-08-같은-날-열-번째-세션)에, **센추리 신규 구현**은 [Phase 12](./docs/history.md#phase-12--센추리-향신료의-길-신규-게임-2026-08-08)에 전부 기록되어 있다.

---

## 2. 현재 시스템 상태 및 구조

### 기술 스택
| 항목 | 내용 |
|---|---|
| 프레임워크 | Next.js 16(App Router, Turbopack) + React 19 + TypeScript(strict) |
| 스타일 | Tailwind CSS v4 |
| 클라이언트 상태 | Zustand(`useBettingStore`) |
| 주 데이터베이스 | 브라우저 IndexedDB(`idb` 래퍼) — 완전 오프라인 동작 |
| 클라우드(선택) | Supabase — Realtime(Broadcast/Presence)이 온라인 대전 8종의 통신 수단 자체, Postgres 2테이블(기기 식별 힌트, 내기 기록 백업)은 완전 선택 |
| 배포 | Vercel, 프로덕션 자동 별칭 `board-game-tau-navy.vercel.app` |
| 테스트 | Vitest **312개**(게임 엔진 8종 + 카탈로그 정렬 helper 유닛 테스트 — **UI 컴포넌트 테스트 인프라 없음**, jsdom 미설치) |

### 주요 의존성 (`package.json`)
| 패키지 | 역할 |
|---|---|
| `next` 16.2.12 / `react`·`react-dom` 19.2.4 | 프레임워크 (App Router, Turbopack) |
| `@supabase/supabase-js` ^2.111.0 | 온라인 대전 8종의 Realtime(Broadcast/Presence) + 선택적 클라우드 백업 |
| `idb` ^8.0.3 | IndexedDB 래퍼 — 1차 저장소 전체가 이 위에서 동작 |
| `zustand` ^5.0.14 | 내기 세션 전역 상태(`useBettingStore`) |
| `uuid` ^14.0.1 | 플레이어/세션/기록 레코드 ID 생성 |
| `tailwindcss` ^4 / `@tailwindcss/postcss` | 스타일링 |
| `vitest` ^4.1.10 | 게임 엔진 유닛 테스트 (jsdom 미설치 — UI 컴포넌트 테스트 불가) |
| `typescript` ^5 / `eslint` ^9 + `eslint-config-next` | 타입 체크 · 린트 |
| `three` / `@react-three/fiber` / `@react-three/drei` / `@react-three/rapier` / `three-stdlib` | 페루도 전용 실제 WebGL 3D 주사위(Phase 22) — 물리 굴림 연출 + 8인 테이블용 공유 캔버스. 다른 7게임은 관여하지 않음 |

**의도적으로 없는 것**: 상태 관리 라이브러리(Redux 등) 추가 없음(Zustand 하나로 충분), ORM 없음(IndexedDB를 `idb`로 직접 다룸), 데이터 페칭 라이브러리(react-query 등) 없음, 테스트 러너 외 e2e/컴포넌트 테스트 도구 없음 — 전부 "이미 있는 도구로 충분한데 새 의존성을 추가하지 않는다"는 이 프로젝트의 반복된 판단([docs/architecture.md §1.2](./docs/architecture.md#12-dexiejs-대신-기존-idb-유지--중복-추상화를-피함), [§1.3](./docs/architecture.md#13-bettingcontext-요청--이미-있는-zustand-스토어)). **Three.js 계열 5개(위 표)는 이 원칙에 대한 명시적 예외**다 — 사용자가 페루도 3D 주사위를 이 정확한 기술 스택으로 지정해 요청했고, CSS만으로는 실제 물리 기반 3D 렌더링을 구현할 수 없어 불가피했다. 새 게임/기능에 무거운 신규 의존성이 필요할 것 같으면, 이번처럼 사용자가 명시적으로 그 기술 스택을 요청한 경우가 아닌 한 먼저 확인받을 것.

### 핵심 파일 구조
```
src/
  app/                  Next.js 라우팅만 (대시보드, /games/[gameId] 스테이지 머신, /history)
  components/           범용 UI + 내기 사이드바 일체
  games/
    registry.ts          GAME_REGISTRY(순수 데이터, 21종)
    playableGames.tsx     GameId → 동적 import 매핑(7종만 실제 등록)
    <game-id>/            게임마다 동일한 5파일 패턴:
      engine.ts             순수 리듀서. React/네트워크/시간 모름. 랜덤은 시드 인자.
      <Game>Board.tsx        제어 컴포넌트. state는 props로만, 클릭은 onAction으로만.
      <Game>Game.tsx          방 로비 + Supabase Realtime 동기화(락스텝).
      RulebookModal.tsx, meta.ts, <Game>.test.ts
      (perudo만) PerudoFaceIcon.tsx  순수 인라인 SVG 아이콘, 외부 이미지 자산 없음
      (perudo만) dice3d/               실제 WebGL 3D 주사위(Phase 22) — DiceMesh/DiceStage/DiceCup3D/faceMath/colorways/diceTexture
      (century만) cards.ts             상인 카드 32장/점수 카드 36장 데이터 + 자원 번들 연산
      (century만) ResourceIcon.tsx     4색 자원 아이콘 2종(배지용 `ResourceIcon`, 3D 큐브용 `ResourceCube`), 순수 인라인 SVG/CSS
      (century만) MerchantEffects.tsx  상인 카드 획득 시 "자원 수거" 플라잉 이펙트(no-thanks AuctionEffects.tsx와 동일 기법)
      (spot-difference만) scenes.ts           기본 스테이지 도형 씬 데이터(순수 데이터, diff 좌표가 곧 정답 좌표)
      (spot-difference만) SpotDifferenceScene.tsx  씬 도형 SVG 렌더러(순수 프레젠테이션)
      (spot-difference만) PhotoStageCanvas.tsx      사진 업로드 모드 — Canvas 2D로 diff 좌표에 실시간 픽셀 변형 적용
  lib/                  db(IndexedDB) / betting(정산 원장) / identity(기기·플레이어 매핑) / supabase
  store/bettingStore.ts  Zustand — 내기 세션 오케스트레이션
public/games/<gameId>.{png,jpg}  게임 카드 실사 박스 표지(5종만, Phase 22) — GameMeta.thumbnail.image가 가리킴, 나머지는 이모지+그라디언트 생성 방식 그대로
boardGameRule/*.md      게임별 공식 룰 원문 — 엔진 구현의 근거 자료(7게임 전부 있음, Century.md 포함)
docs/                   개발자 심화 문서(아래 "관련 문서" 참고)
```
전체 디렉토리 규칙과 계층 의존 방향은 [docs/architecture.md §5](./docs/architecture.md#5-디렉토리-구조-및-계층-규칙)에 도식으로 정리되어 있음.

### 현재 작동 중인 주요 로직
- **온라인 대전 8종 전부 같은 락스텝(lockstep) 패턴**: 방장이 시드 하나만 브로드캐스트 → 모든 클라이언트가 독립적으로 동일 초기 상태 계산 → 이후 액션은 `EngineAction`으로 브로드캐스트해 같은 순수 리듀서로 재생. 서버 권위 엔진 없음(의도적, [docs/architecture.md §2](./docs/architecture.md#2-온라인-대전의-신뢰-모델-문서화된-의도적-한계)). 재접속(`state-request`/`state-sync`)과 좌석 충돌 자가치유(deviceId 사전순)도 8게임 공통 적용됨([docs/cloud-sync.md](./docs/cloud-sync.md)).
- **파생 상태(derived state) 금지 원칙**: 같은 사실을 두 상태로 따로 표현하지 않기([docs/architecture.md §1.4](./docs/architecture.md#14-파생-상태derived-state-금지-원칙)). 센추리에서도 승자/순위는 저장하지 않고 `computeRankings(state)`로 매번 파생 계산하며, 점수 카드 코인 지급도 "카드에 코인이 물리적으로 붙어있는지"를 별도로 추적하지 않고 "슬롯 0/1을 완성하면 은행 공급량에서 지급"으로 단순화했다(왜 안전한 단순화인지는 history.md Phase 12 참고).
- **센추리 핵심 설계**: (1) 자원 4단계(노란색<빨간색<초록색<갈색)와 4가지 턴 행동(카드 사용/상인 카드 획득/휴식/점수 카드 완성)을 `applyAction` 하나의 리듀서로 구현. (2) 상인 카드 획득 시 N번째 카드를 가져오려면 그 앞 카드들 위에 자원을 1개씩 올려야 하며, 그 자원은 **슬롯이 아니라 카드 자체에 붙어** 시장이 밀릴 때도 함께 이동한다(`merchantMarketResources`를 `merchantMarket`과 항상 같은 인덱스로 필터링). (3) 자원 10개 한도 초과 시 `phase: "discarding"`으로 게이트되어 `discardToLimit` 액션 없이는 다음 사람 턴으로 못 넘어간다. (4) 업그레이드 카드는 `simulateUpgrade`(엔진과 UI 미리보기가 공유하는 단일 함수)로 "같은 자원을 연속 승급"과 "여러 자원에 분산"을 모두 지원. (5) 누군가 점수 카드 목표치를 채우면 `endTriggered` 플래그만 세우고, 마지막 좌석(`playerCount - 1`)이 턴을 마칠 때 `gameOver`로 전환. (6) UI는 카드 시장 2단(상인 6장/점수 5장) + 내 수레 게이지 + 업그레이드/교환/획득/버리기 전용 모달로 구성.
- **"엔진 테스트 100% 통과 ≠ UI 정상"**: `<Game>Board.tsx`는 8게임 전부 자동 테스트 대상 밖(jsdom 미설치). 과거 이 사각지대에서 발생한 버그가 4건 있음([docs/troubleshooting.md](./docs/troubleshooting.md) #1, #6, #7, #10). 센추리 보드 UI(Phase 18)/그리드 포커 방 설정 폼(Phase 19)/틀린 그림 찾기 보드+방 생성 폼(Phase 20)/페루도 CSS 3D 주사위(Phase 21)/페루도 실제 WebGL 3D 주사위(이번 세션, Phase 22)는 실제 렌더링 스크린샷으로 검증했지만, **실제 Supabase 온라인 로비를 거친 멀티 디바이스 동기화는 다섯 세션 다 여전히 미검증**이다.
- **페루도 주사위는 `active3D` 플래그로 실제 WebGL 3D와 CSS 폴백 사이를 디스패치**(Phase 22, `src/games/perudo/dice3d/`): `DieFace`/`DieBack`/`BettingDie`가 `useWebglSupport()`(SSR-safe) + 사용자 "3D 끄기" 토글을 보고 매번 선택한다. 3D 쪽은 `DiceMesh`(`three-stdlib`의 `RoundedBoxGeometry` — 진짜 6면 독립 머티리얼, drei 자체 `RoundedBox`는 부적합) 하나를 모든 주사위가 공유하고, 정적 타일은 `DiceStage.tsx`의 drei `View` 기반 공유 캔버스로, 물리 굴림 연출은 `DiceCup3D.tsx`(Rapier, 결과는 항상 `engine.ts` 값에 강제 정렬)로 나뉜다. CSS 쪽(`DiceCube`/`*Css` 접미사 컴포넌트, Phase 21에서 만든 것)은 그대로 남아 있다 — 새 주사위 변형이 필요하면 3D는 `colorways.ts`에 새 `DiceColorway`를, CSS 폴백도 맞춰서 `CubeColorway`를 추가할 것. 자세한 설계 판단은 [docs/history.md Phase 22](./docs/history.md#phase-22--페루도-실제-webgl-3d-주사위threejsr3frapier--게임-카드-실사-이미지-2026-08-08-같은-날-열네-번째-세션) 참고.
- **게임 카드 이미지는 `GameMeta.thumbnail.image`가 있을 때만 실사, 없으면 이모지+그라디언트**(Phase 22): `GameThumbnail.tsx` 공유 컴포넌트가 분기하며, `GameCard`/게임 준비중 페이지/온라인 로비 헤더 3곳이 재사용한다. 이미지가 있는 5종(`public/games/`)은 전부 퍼블리셔 소유 박스 표지 원본이라는 점에 유의(docs/history.md Phase 22 §8) — 새 게임에 이미지를 추가할 때도 출처를 문서화할 것. **기본 `imageClassName`은 `object-contain`**(Phase 23) — 박스 표지가 세로형이라 `object-cover`를 쓰면 위아래가 잘리기 때문. `next/image`의 `fill`은 부모의 패딩을 무시하고 자신을 채우므로, 레터박스 여백이 필요하면 컨테이너가 아니라 `imageClassName`에 직접 `p-*`를 실어야 한다(docs/history.md Phase 23 §1).
- **센추리 보드 매트 3단 레이어**: `MAT`(목재 탁자) → `FELT`(마켓 펠트) → `CARAVAN_STYLE`(내 수레 목재) 순서로 감싸는 CSS 전용 배경 레이어. `ResourceIcon`(배지용 다이아몬드)과 `ResourceCube`(실물에 얹힌 자원용 3D 큐브)는 용도가 다른 별개 컴포넌트이니 새로 자원을 그릴 자리를 추가할 때 어느 쪽이 맞는지 먼저 확인할 것.
- **페루도 베팅 트랙 = "보드 위 말(piece)" 모델**: `BidTrack`(트랙 칸 그리드)과 `BettingDie`(보라색 다이스)가 분리되어 있고, 실제 베팅 값(`state.currentBid`)과 로컬 베팅 초안(`pendingFace`/`pendingQuantity`, 내 차례일 때만 존재)이 별개 개념이다 — 내 차례가 아닐 때 트랙 위 보라색 다이스는 항상 `state.currentBid`를 그대로 보여주고, 내 차례가 되면 그 자리에서 초안으로 바뀌어 조작 가능해진다. 이동 가능 범위(`minValidQuantityForFace`)는 새로 만들지 않고 기존 엔진 헬퍼를 그대로 재사용한다.
- **그리드 포커 룸 설정값은 `GridPokerState` 자체에 편입**: 방장이 고른 `TimerSettings`(모드/배치초/제출초)는 별도 동기화 채널 없이 `startGame()`이 상태에 박아 넣고 `game-start` 브로드캐스트 payload로 전파한다 — 카운트다운의 *틱 자체*는 여전히 클라이언트 로컬(useCountdown.ts, 합의 대상 아님)이지만 *몇 초짜리인지*는 상태의 일부라 전 클라이언트가 항상 일치한다. 새로운 방-레벨 설정을 추가할 때 이 패턴(ref로 스냅샷 → game-start payload에 포함 → state 필드로 편입)을 재사용할 것.
- **틀린 그림 찾기는 "좌표를 전송하지 않고 시드에서 파생" 원칙을 사진 업로드 모드까지 확장**: 다른 게임들이 RNG 시드만 공유해 카드/타일 배치를 각자 계산하는 것처럼, 사진 모드도 실제 사진 데이터(`imageDataUrl`)만 `game-start`로 전송하고 "어디를 어떻게 바꿀지"(좌표+효과+강도)는 `generatePhotoDiffSpots(seed, count)`가 이미지 없이 순수 계산한다 — 정답 좌표를 별도로 전송/저장하지 않는다. 오답 페널티 잠금도 `Date.now()`를 리듀서에서 직접 읽지 않고 클릭 액션에 실린 `atMs`로 결정론을 유지한다(RNG 시드와 같은 트릭).

### 작업 규칙 (이 저장소에서 계속 지킬 것)
- **커밋은 기능 단위로 잘게 분리**(conventional commits: `feat(game):`, `fix(game):`, `docs:`, `test(game):`). 각 커밋 시점에도 빌드가 깨지지 않게 파일 단위로 묶어 커밋.
- **커밋/푸시/배포는 매번 명시적으로 승인받고 진행** — 사용자가 매번 명시한 뒤에만 진행. 다음 세션에서도 먼저 나서서 배포하지 말 것. (이번 세션은 사용자가 요청 자체에 커밋·푸시·배포까지 명시적으로 포함했음.)
- **시각적/레이아웃 버그는 코드 리뷰만으로 "고쳤다"고 단정하지 말 것** — 노땡스 세션에서 정확히 이 실수로 1차 수정이 틀렸다는 게 사용자 스크린샷으로 드러난 전례가 있다([docs/troubleshooting.md #7](./docs/troubleshooting.md#7-노땡스-코인칩-배지가-중앙-카드의-숫자를-가리는-버그-1차-시도-실패--구조적-재수정)). 오프라인 상태로는 `<Game>Game.tsx`의 Supabase 로비를 거칠 수 없어 육안 확인이 막힐 때는, Phase 14가 쓴 방법(대상 컴포넌트를 고정 state/props로 직접 렌더링하는 임시 라우트를 만들어 `npx playwright screenshot`으로 찍고 확인 후 삭제)을 재사용할 것 — 실제 온라인 락스텝 동기화까지는 검증하지 못하지만 순수 렌더링 결과는 확인할 수 있다. **그리드 포커 방 생성 폼(Phase 19)은 이 방식으로 검증 완료했지만, 실제 온라인 동기화는 여전히 미검증**(§3의 1번 항목).
- **작업 지시와 참조 문서(룰북 등)가 서로 다른 사실을 말하면, 룰북 원문 쪽을 채택하고 그 판단을 문서에 명시적으로 남길 것** — 이번 세션에서 두 번(자원 순서, 금/은화 대체 규칙) 실제로 있었던 상황([docs/history.md Phase 12](./docs/history.md#phase-12--센추리-향신료의-길-신규-게임-2026-08-08) 참고).
- React Hooks 엄격 lint 규칙 유효(early-return 뒤 훅 호출 금지 / 렌더 중 ref 쓰기 금지 / effect 안 동기 setState 금지). `eslint-disable-next-line`은 **경고가 실제로 리포트되는 줄 바로 위**에 둬야 먹힌다.
- `.clinerules.md`/`instructions.md`(저장소 루트, 미확인 파일)는 **Cline 전용 자동화 규칙**(승인 없이 자동 커밋·배포 지시)이라 이 프로젝트의 실제 지침이 아님 — 계속 무시할 것. 실제 지침은 `CLAUDE.md`→`AGENTS.md`뿐.
- Vercel/GitHub 인증은 이미 세팅됨(`.vercel/project.json` 링크됨) — 별도 로그인 없이 `git push` / `npx vercel deploy --prod` 바로 가능.
- **세션 시작 시 `git status`를 항상 먼저 확인할 것 — 이 대화에서 만들지 않은 커밋되지 않은 변경이 나타날 수 있다.** 이번 문서화 세션 중 실제로 겪은 사례: 그리드 포커 커스텀 제한시간(Phase 19) 커밋 이후, 이 대화가 만들지 않은 페루도 "차등 페널티" 규칙 변경(`engine.ts`의 `dudo`/`calza`, `boardGameRule/Perudo.md`, `PerudoBoard.tsx`, `RulebookModal.tsx`, `Perudo.test.ts` 5개 파일 — 판정을 "무조건 1개 상실"에서 "틀린 차이만큼 상실"로 바꾸는 내용)이 워킹 트리에 커밋되지 않은 채 남아 있었고, 기존 테스트 3개가 새 로직과 안 맞아 실패 중이었다. 사용자에게 확인한 결과 **되돌리기(revert)로 결정** — `git checkout -- <5개 파일>`로 마지막 커밋(`626f5d2`) 상태로 복원했다(이 되돌리기 자체는 별도 커밋 불필요, 애초에 커밋된 적 없는 워킹 트리 변경이었으므로). 되돌리는 과정에서 `git status`가 파일마다 순차적으로 다른 결과를 보여주는 불안정한 현상도 관찰됐다(같은 세션 내 다른 프로세스가 동시에 파일을 쓰고 있었을 가능성) — 되돌린 뒤에는 몇 초 텀을 두고 `git status`를 재확인해 안정화됐는지 확인하는 습관을 들일 것. **다음 세션에서 페루도 관련 파일에 다시 이런 변경이 나타나면, 이 저장소 밖의 다른 세션/프로세스가 그 작업을 계속 진행 중이라는 뜻일 수 있으니 임의로 지우지 말고 먼저 사용자에게 확인할 것.** — 실제로 바로 다음 세션(이번 세션, Phase 21)에서 똑같은 현상(편집이 다음 턴에 원본으로 되돌아감)이 두 차례 재발했다. 사용자에게 그대로 보고 후, `git log`로 이 저장소 밖에서 만들어진 실제 커밋(틀린 그림 찾기 Phase 20)을 확인해 "여러 세션이 같은 워킹 디렉터리를 동시에 쓰고 있었을 가능성"으로 결론짓고, 매 파일 편집 직후 `git diff --stat`으로 즉시 반영 여부를 확인하며 처음부터 재작업해 최종적으로 커밋까지 완료했다(경위는 [docs/history.md Phase 21 §0](./docs/history.md#phase-21--페루도-차등-페널티-룰-변경--3d-입체-주사위-ui-2026-08-08-같은-날-열세-번째-세션) 참고). **여러 Claude Code 세션을 이 저장소에 동시에 띄우지 않는 것을 권장** — 정 필요하다면 세션마다 별도 워크트리(`git worktree`)를 쓸 것.

### 관련 문서
| 문서 | 언제 볼 것 |
|---|---|
| [docs/README.md](./docs/README.md) | `docs/` 전체 색인 + 개발 명령어 |
| [docs/architecture.md](./docs/architecture.md) | "왜 이렇게 설계했는가" — 항상 유효한 현재 설계 원칙 |
| [docs/cloud-sync.md](./docs/cloud-sync.md) | 락스텝 동기화 프로토콜 세부사항 |
| [docs/troubleshooting.md](./docs/troubleshooting.md) | 실제 발생한 버그 10건 — 증상/원인/해결/교훈 |
| [docs/history.md](./docs/history.md) | 시간순 프로젝트 연대기 — Phase 19가 이번 세션(그리드 포커 커스텀 제한시간) 내용 |
| [docs/features.md](./docs/features.md) | 기능/게임별 룰 해석 판단 기록(센추리 절 신설됨) |
| [docs/deployment.md](./docs/deployment.md) | 배포 절차, 환경변수, 검증 파이프라인 |

---

## 3. Next Action Items (우선순위 순)

1. **(최우선, 부분적으로만 검증됨)** 페루도 실제 WebGL 3D 주사위 + 차등 페널티(Phase 21+22, 이번 세션까지)는 8인 고정 시드 상태를 임시 라우트 스크린샷으로만 검증했음(§2 참고). 아직 남은 것:
   - **온라인 방을 2대 이상 실제 기기로 열어** 물리 굴림 연출이 기기마다 달라 보여도 최종 착지 값(과 차등 페널티 손실 폭)이 모든 기기에 동일하게 반영되는지, 저사양 기기에서 공유 캔버스(`DiceStage`)/물리(`DiceCup3D`) 성능이 실제로 버티는지, 그리고 페루도의 기존 미검증 항목(컵 쉐이킹 SFX 타이밍, 팔라피코 배너, 내 로컬 베팅 초안이 새어나가지 않는지)까지 함께 확인.
   - **8인 확장 손패/로스터 스트립 실사용**에서 물리 굴림 애니메이션의 프레임 드랍 여부, 여러 플레이어가 동시에 굴릴 때(각자 손패) 화면이 버티는지.
2. **(최우선, 부분적으로만 검증됨)** 틀린 그림 찾기 신규 게임(Phase 20)은 고정 state 렌더링 + 방 생성 폼만 임시 라우트 스크린샷으로 검증했음(§2 참고). 아직 남은 것:
   - **온라인 방을 2대 이상 실제 기기로 열어** 팀 배정이 양쪽에서 똑같이 보이는지, 한쪽에서 클릭한 정답이 다른 기기에도 즉시 마킹/스코어 반영되는지, 오답 페널티 잠금이 클릭한 그 좌석에서만 걸리는지 확인.
   - **사진 업로드 모드를 실제 온라인 방에서** 큰 사진으로 테스트해 압축 후에도 Supabase Realtime 브로드캐스트 페이로드 한도를 넘지 않는지, 넘을 경우 어떤 실패 양상을 보이는지(현재 실패 시 에러 처리 없음) 확인.
   - 재접속(`state-request`/`state-sync`) 시에도 진행 중이던 스테이지/발견 현황/타이머가 정확히 복원되는지.
3. **(최우선, 부분적으로만 검증됨)** 그리드 포커 커스텀 제한시간 기능(Phase 19)은 방 생성 폼만 임시 라우트 스크린샷으로 검증했음(§2 참고). 아직 남은 것:
   - **온라인 방을 2대 이상 실제 기기로 열어** 방장이 고른 초 값이 `game-start` 브로드캐스트를 타고 다른 기기의 `startGame`/카운트다운 시작값에도 정확히 반영되는지, "시간 제한 없음" 선택 시 모든 기기에서 카운트다운 UI가 동일하게 사라지는지 확인.
   - 재접속(`state-request`/`state-sync`) 시에도 `timerSettings`가 원래 방장이 고른 값 그대로 복원되는지(이론상 `GridPokerState`에 편입돼 있어 자동으로 되어야 하지만 실네트워크 경로 미확인).
4. **(최우선, 부분적으로만 검증됨)** 센추리 보드 UI 전면 개편(Phase 18)은 임시 라우트 스크린샷 + 모달 클릭 시뮬레이션으로 검증했지만, 아직 남은 것:
   - **온라인 방을 2대 이상 실제 기기로 열어** 락스텝 동기화 확인 — 카드를 획득/사용/휴식/완성할 때 다른 기기 화면에도 새 매트/수레/코인스택 비주얼이 즉시 반영되는지, 재접속 시 정상 복구되는지(단일 고정 state 렌더링만 확인, 실제 네트워크 경로는 미검증).
   - 5인 게임처럼 자원 개수가 많을 때 손패 부채꼴(`transform: rotate/translateY`)이 화면 폭을 넘기지 않는지, 카드에 얹은 자원 큐브(회전 배치)가 자원 5개까지 쌓였을 때도 서로 겹쳐 안 보이지 않는지.
   - 실제 태블릿/저해상도 기기에서 목재/펠트 텍스처(다중 CSS 그라디언트 레이어)의 렌더링 성능과 터치 조작감.
   - 새로 반영된 공식 32장/36장 카드 데이터(Phase 16)로 실제 몇 판 진행해보고 카드 밸런스가 체감상 자연스러운지 — Phase 16부터 계속 이월 중인 항목.
5. **(해소됨)** 센추리 카드 데이터를 사용자 자체 설계셋 대신 실제 공식 42/36장으로 교체 완료(Phase 16), UI 전면 개편도 완료(Phase 18) — 자원 가치 순서(룰북 §4.1 채택)와 금화 소진 시 은화 미대체 판단은 여전히 유효하며 [Phase 12](./docs/history.md#phase-12--센추리-향신료의-길-신규-게임-2026-08-08) 기록 참고.
6. **(이전 세션부터 이어짐, 미해결)** 노땡스 "코인이 카드 숫자를 가리는 버그" 수정([docs/troubleshooting.md #7](./docs/troubleshooting.md#7-노땡스-코인칩-배지가-중앙-카드의-숫자를-가리는-버그-1차-시도-실패--구조적-재수정))도 여전히 실제 기기 육안 재확인이 안 된 상태로 남아 있음.
7. **(이전 세션부터 이어짐, 미해결)** `<Game>Board.tsx`/`<Game>Game.tsx` 전용 테스트 인프라 없음(jsdom/@testing-library 미설치). 저비용 대안으로 Playwright 스크린샷 회귀 테스트도 고려([docs/troubleshooting.md "알려진 사각지대"](./docs/troubleshooting.md#알려진-사각지대-다음에-볼-것)).
8. **(선택)** 저장소 루트의 `.clinerules.md`/`instructions.md` — 이 사용자의 실제 선호(매번 명시 승인)와 반대되는 자동화 지시를 담고 있음. 계속 무시 중이나, 지우거나 남겨둘지는 아직 사용자에게 확답받지 않음.
9. **(선택)** 방장 이탈 시 호스트 권한 승계 로직 없음 / 4자리 초대 코드 중복 확인 없음 / 대규모 동시 접속 스트레스 테스트 미실행 — 낮은 우선순위로 계속 이월 중.
10. **(선택)** 센추리·페루도 외 나머지 준비중 게임(스플렌더, 카탄, 코드네임, 마피아 등 13종)은 우선순위 논의된 바 없음.
11. **(선택)** 그리드 포커 방장이 "방 만들기" 이후 대기실에서도 제한시간 설정을 바꿀 수 있게 할지(현재는 방 생성 폼에서만 결정, 방 생성 후엔 고정) — 사용자 요청 원문의 "옵션 변경" 문구를 방 생성 폼 내 선택으로 해석했음, 별도 화면이 필요하다면 후속 요청 필요.
12. **(선택)** 틀린 그림 찾기 팀 배정은 좌석 순서 기반 자동 절반 나누기뿐 — 방장이 수동으로 팀을 편성하는 UI는 없음. 별도 요청 시 추가 검토.
13. **(선택)** 여러 Claude Code 세션을 이 저장소에 동시에 띄우면 워킹 트리 편집이 서로 덮어써질 수 있음이 이번 세션에서 실제로 확인됨(§2 작업 규칙 참고) — 근본 해결책(예: 세션마다 `git worktree` 분리)은 아직 도입되지 않음.
14. **(선택, 사용자 재검토 권장)** `public/games/`의 게임 카드 이미지 5장(Phase 22)은 `PerudoFaceIcon.tsx` 같은 오리지널 SVG가 아니라 퍼블리셔 소유 박스 표지 사진 원본임(docs/history.md Phase 22 §8) — 지금은 이미 실명·실제 규칙으로 구현 중인 게임을 식별하는 용도로만 쓰였지만, 앱을 더 넓게 배포/홍보할 계획이 있다면 라이선스 검토가 필요할 수 있음.

---

## 4. Resume Prompt

다음 세션 `/clear` 직후 아래 한 줄을 그대로 붙여넣을 것:

> `HANDOFF.md`부터 읽고, §3의 1번 항목(페루도 실제 WebGL 3D 주사위 + 차등 페널티를 실제 Supabase 온라인 방·2대 이상 기기, 8인 확장 실사용으로 검증하는 것)부터 확인해줘.
