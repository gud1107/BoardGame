# HANDOFF — 현재 스냅샷

_최종 갱신: 2026-08-08 (페루도 보라색 베팅 주사위 보드-트랙 UI 개편 세션)_

> **이 문서는 "지금 이 순간"의 스냅샷만 담는다.** 새 세션이 `/clear` 직후 가장 먼저 읽어야 할 문서이며, 여기 담긴 정보만으로 이전 맥락을 복원할 수 있어야 한다. **시간순 기록(무엇을 왜 그 순서로 만들었는가)은 [docs/history.md](./docs/history.md)로, 버그 대응 이력은 [docs/troubleshooting.md](./docs/troubleshooting.md)로 넘어갔다** — 이 파일 자체는 계속 짧게 유지하고, 완료된 세션 내용은 매번 `history.md`로 옮겨 적을 것.

---

## 1. Executive Summary

### 목표
**보드게임 허브** — 여러 보드게임을 한 곳에서 플레이하고, 게임 결과에 연동된 "내기(베팅)" 정산까지 관리하는 Next.js 웹앱. 완전 오프라인 동작(IndexedDB 1차 저장소)이 기본이고, Supabase는 온라인 대전 7종에만 필수인 선택적 보강 레이어. 실제 배포 URL: **https://board-game-tau-navy.vercel.app**

### 현재 달성률
- 카탈로그 21종 중 **7종 실제 플레이 가능**: 하나미코지 · 뱅!(Bang!) · 그리드 포커 · 아발론(Avalon) · 노땡스(No Thanks!) · 페루도(Perudo) · 센추리: 향신료의 길(Century: Spice Road). 나머지 14종은 `playable: false`로 "준비중" 카드만 노출(의도된 상태, 버그 아님).
- `npx tsc --noEmit` / `npm run lint` / `npx vitest run`(**273개 전부 통과**) / `npm run build` 전부 그린.
- 이번 세션 작업은 **커밋·푸시·배포까지 완료됨**(사용자가 이번 요청에 명시적으로 포함해 요청).

### 이번 세션 주요 변경 사항
사용자가 페루도의 베팅 방식을 "숫자 스테퍼로 선언"에서 **보드판 트랙 위에 놓인 보라색 주사위를 직접 옮기고 눈금을 돌려서 베팅하는 인터랙티브 UI**로 개편해 달라고 요청했다. 상세 설계 판단은 [docs/history.md Phase 17](./docs/history.md#phase-17--페루도-보라색-베팅-주사위-보드-트랙-ui-개편-2026-08-08-같은-날-아홉-번째-세션) 참고.

1. **보라색 베팅 주사위(`BettingDie`, `PerudoBoard.tsx`)** — 실제 굴리는 상아색/적색 다이스와 구분되는 보라색 전용 다이스 컴포넌트를 신설. 항상 `state.currentBid`의 개수 칸(`BidTrack`의 같은 그리드 셀) 위에 얹혀 렌더링되어, 모든 플레이어가 "지금 베팅이 트랙 어디에 있는지"를 한눈에 본다.
2. **눈금·위치를 먼저 정하고 확정하는 2단계 흐름** — 내 차례가 되면 이 주사위가 로컬 "베팅 초안"(`pendingFace`/`pendingQuantity`)으로 바뀌어 조작 가능해진다: 주사위를 직접 클릭하면 다음 가능한 눈금으로 순환(cycle)하고, 주사위 옆 컨트롤러(`FacePicker`, 1~6 버튼)로 원하는 눈금을 바로 찍을 수도 있다. 트랙 칸을 클릭하면 초안 위치가 그 칸으로 이동한다. 실제 `raise` 액션은 오직 새로 추가한 **"베팅 확정"** 버튼을 눌러야만 나간다 — 그 전까지는 로컬 상태만 바뀌고 `onAction`이 전혀 호출되지 않는다(Century의 확인 모달들과 같은 "확정 전엔 아무것도 보내지 않는" 패턴).
3. **베팅 위치/눈금 제한 로직** — 트랙 칸은 `minValidQuantityForFace(state.currentBid, pendingFace, palafico)`(기존 엔진 헬퍼, 신규 로직 없음)보다 낮은 칸은 항상 비활성화해 "이전 베팅보다 낮은 칸으로 이동 불가"를 강제한다. 눈금을 바꿀 때마다 그 눈금 기준 최소 개수를 다시 계산해 초안 개수를 필요하면 끌어올리므로, 일반(2~6)↔페루도(1) 전환의 룰북 §3 공식(2배+1 / 절반 올림)이 항상 정확히 반영된다. 팔라피코 라운드에서는 기존처럼 시작 플레이어가 연 눈금 외 나머지가 전부 비활성화된다.
4. **`engine.ts`는 전혀 건드리지 않았다** — 전부 `PerudoBoard.tsx`의 순수 UI 상태(로컬 베팅 초안)와 기존 엔진 헬퍼(`minValidQuantityForFace`) 재사용으로 구현. 회귀 없음(273개 테스트 그대로 유지 — 페루도 보드 UI는 다른 게임과 동일하게 jsdom 미설치로 자동 테스트 대상 밖).
5. **육안 확인 완료** — `src/app/dev-perudo-preview/`에 고정 상태로 `PerudoBoard`를 렌더링하는 임시 라우트를 만들어 `npx playwright`로 스크린샷/클릭 시뮬레이션을 돌려 확인 후 삭제했다(커밋 미포함): 주사위 이동·눈금 순환·확정→턴 전환·불법 칸 클릭 무시(상태 불변)까지 전부 정상 동작 확인.

**직전 세션(Century.md 카드 데이터 최신화 + 카드 플레이 취소 기능)의 판단**은 [docs/history.md Phase 16](./docs/history.md#phase-16--centurymd-카드-데이터-최신화와-카드-플레이-취소-기능-2026-08-08-같은-날-여덟-번째-세션)에, **수레 인벤토리 UI + 시작 카드 필터 판단(Phase 16에서 뒤집힘)**은 [Phase 15](./docs/history.md#phase-15--센추리-상인-카드-덱-필터링-버그-수정--수레-10칸-인벤토리-슬롯-ui-2026-08-08-같은-날-일곱-번째-세션)에, **페루도 주사위 비주얼(이번 세션이 그 위에 베팅 트랙 UI를 얹음)**은 [Phase 14](./docs/history.md#phase-14--페루도-주사위-비주얼-개편--페루도1-아이콘-교체--통계-현황판-재배치-2026-08-08-같은-날-여섯-번째-세션)에, **센추리 실물 카드 비주얼**은 [Phase 13](./docs/history.md#phase-13--센추리-실물-카드-비주얼--동전-스택--카드-위-자원-올리기-ui-2026-08-08-같은-날-다섯-번째-세션)에, **센추리 신규 구현**은 [Phase 12](./docs/history.md#phase-12--센추리-향신료의-길-신규-게임-2026-08-08)에 전부 기록되어 있다.

---

## 2. 현재 시스템 상태 및 구조

### 기술 스택
| 항목 | 내용 |
|---|---|
| 프레임워크 | Next.js 16(App Router, Turbopack) + React 19 + TypeScript(strict) |
| 스타일 | Tailwind CSS v4 |
| 클라이언트 상태 | Zustand(`useBettingStore`) |
| 주 데이터베이스 | 브라우저 IndexedDB(`idb` 래퍼) — 완전 오프라인 동작 |
| 클라우드(선택) | Supabase — Realtime(Broadcast/Presence)이 온라인 대전 7종의 통신 수단 자체, Postgres 2테이블(기기 식별 힌트, 내기 기록 백업)은 완전 선택 |
| 배포 | Vercel, 프로덕션 자동 별칭 `board-game-tau-navy.vercel.app` |
| 테스트 | Vitest **272개**(게임 엔진 7종 유닛 테스트만 — **UI 컴포넌트 테스트 인프라 없음**, jsdom 미설치) |

### 주요 의존성 (`package.json`)
| 패키지 | 역할 |
|---|---|
| `next` 16.2.12 / `react`·`react-dom` 19.2.4 | 프레임워크 (App Router, Turbopack) |
| `@supabase/supabase-js` ^2.111.0 | 온라인 대전 7종의 Realtime(Broadcast/Presence) + 선택적 클라우드 백업 |
| `idb` ^8.0.3 | IndexedDB 래퍼 — 1차 저장소 전체가 이 위에서 동작 |
| `zustand` ^5.0.14 | 내기 세션 전역 상태(`useBettingStore`) |
| `uuid` ^14.0.1 | 플레이어/세션/기록 레코드 ID 생성 |
| `tailwindcss` ^4 / `@tailwindcss/postcss` | 스타일링 |
| `vitest` ^4.1.10 | 게임 엔진 유닛 테스트 (jsdom 미설치 — UI 컴포넌트 테스트 불가) |
| `typescript` ^5 / `eslint` ^9 + `eslint-config-next` | 타입 체크 · 린트 |

**의도적으로 없는 것**: 상태 관리 라이브러리(Redux 등) 추가 없음(Zustand 하나로 충분), ORM 없음(IndexedDB를 `idb`로 직접 다룸), 데이터 페칭 라이브러리(react-query 등) 없음, 테스트 러너 외 e2e/컴포넌트 테스트 도구 없음 — 전부 "이미 있는 도구로 충분한데 새 의존성을 추가하지 않는다"는 이 프로젝트의 반복된 판단([docs/architecture.md §1.2](./docs/architecture.md#12-dexiejs-대신-기존-idb-유지--중복-추상화를-피함), [§1.3](./docs/architecture.md#13-bettingcontext-요청--이미-있는-zustand-스토어)).

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
      (century만) cards.ts             상인 카드 32장/점수 카드 36장 데이터 + 자원 번들 연산
      (century만) ResourceIcon.tsx     4색 자원 큐브 아이콘, 순수 인라인 SVG
      (century만) MerchantEffects.tsx  상인 카드 획득 시 "자원 수거" 플라잉 이펙트(no-thanks AuctionEffects.tsx와 동일 기법)
  lib/                  db(IndexedDB) / betting(정산 원장) / identity(기기·플레이어 매핑) / supabase
  store/bettingStore.ts  Zustand — 내기 세션 오케스트레이션
boardGameRule/*.md      게임별 공식 룰 원문 — 엔진 구현의 근거 자료(7게임 전부 있음, Century.md 포함)
docs/                   개발자 심화 문서(아래 "관련 문서" 참고)
```
전체 디렉토리 규칙과 계층 의존 방향은 [docs/architecture.md §5](./docs/architecture.md#5-디렉토리-구조-및-계층-규칙)에 도식으로 정리되어 있음.

### 현재 작동 중인 주요 로직
- **온라인 대전 7종 전부 같은 락스텝(lockstep) 패턴**: 방장이 시드 하나만 브로드캐스트 → 모든 클라이언트가 독립적으로 동일 초기 상태 계산 → 이후 액션은 `EngineAction`으로 브로드캐스트해 같은 순수 리듀서로 재생. 서버 권위 엔진 없음(의도적, [docs/architecture.md §2](./docs/architecture.md#2-온라인-대전의-신뢰-모델-문서화된-의도적-한계)). 재접속(`state-request`/`state-sync`)과 좌석 충돌 자가치유(deviceId 사전순)도 7게임 공통 적용됨([docs/cloud-sync.md](./docs/cloud-sync.md)).
- **파생 상태(derived state) 금지 원칙**: 같은 사실을 두 상태로 따로 표현하지 않기([docs/architecture.md §1.4](./docs/architecture.md#14-파생-상태derived-state-금지-원칙)). 센추리에서도 승자/순위는 저장하지 않고 `computeRankings(state)`로 매번 파생 계산하며, 점수 카드 코인 지급도 "카드에 코인이 물리적으로 붙어있는지"를 별도로 추적하지 않고 "슬롯 0/1을 완성하면 은행 공급량에서 지급"으로 단순화했다(왜 안전한 단순화인지는 history.md Phase 12 참고).
- **센추리 핵심 설계**: (1) 자원 4단계(노란색<빨간색<초록색<갈색)와 4가지 턴 행동(카드 사용/상인 카드 획득/휴식/점수 카드 완성)을 `applyAction` 하나의 리듀서로 구현. (2) 상인 카드 획득 시 N번째 카드를 가져오려면 그 앞 카드들 위에 자원을 1개씩 올려야 하며, 그 자원은 **슬롯이 아니라 카드 자체에 붙어** 시장이 밀릴 때도 함께 이동한다(`merchantMarketResources`를 `merchantMarket`과 항상 같은 인덱스로 필터링). (3) 자원 10개 한도 초과 시 `phase: "discarding"`으로 게이트되어 `discardToLimit` 액션 없이는 다음 사람 턴으로 못 넘어간다. (4) 업그레이드 카드는 `simulateUpgrade`(엔진과 UI 미리보기가 공유하는 단일 함수)로 "같은 자원을 연속 승급"과 "여러 자원에 분산"을 모두 지원. (5) 누군가 점수 카드 목표치를 채우면 `endTriggered` 플래그만 세우고, 마지막 좌석(`playerCount - 1`)이 턴을 마칠 때 `gameOver`로 전환. (6) UI는 카드 시장 2단(상인 6장/점수 5장) + 내 수레 게이지 + 업그레이드/교환/획득/버리기 전용 모달로 구성.
- **"엔진 테스트 100% 통과 ≠ UI 정상"**: `<Game>Board.tsx`는 7게임 전부 자동 테스트 대상 밖(jsdom 미설치). 과거 이 사각지대에서 발생한 버그가 3건 있음([docs/troubleshooting.md](./docs/troubleshooting.md) #1, #6, #7). **센추리 보드 UI는 코드 검증만 했고 실제 브라우저 육안 확인을 하지 않았다** — §3의 최우선 항목 참고.
- **페루도 베팅 트랙 = "보드 위 말(piece)" 모델**: `BidTrack`(트랙 칸 그리드)과 `BettingDie`(보라색 다이스)가 분리되어 있고, 실제 베팅 값(`state.currentBid`)과 로컬 베팅 초안(`pendingFace`/`pendingQuantity`, 내 차례일 때만 존재)이 별개 개념이다 — 내 차례가 아닐 때 트랙 위 보라색 다이스는 항상 `state.currentBid`를 그대로 보여주고, 내 차례가 되면 그 자리에서 초안으로 바뀌어 조작 가능해진다. 이동 가능 범위(`minValidQuantityForFace`)는 새로 만들지 않고 기존 엔진 헬퍼를 그대로 재사용한다.

### 작업 규칙 (이 저장소에서 계속 지킬 것)
- **커밋은 기능 단위로 잘게 분리**(conventional commits: `feat(game):`, `fix(game):`, `docs:`, `test(game):`). 각 커밋 시점에도 빌드가 깨지지 않게 파일 단위로 묶어 커밋.
- **커밋/푸시/배포는 매번 명시적으로 승인받고 진행** — 사용자가 매번 명시한 뒤에만 진행. 다음 세션에서도 먼저 나서서 배포하지 말 것. (이번 세션은 사용자가 요청 자체에 커밋·푸시·배포까지 명시적으로 포함했음.)
- **시각적/레이아웃 버그는 코드 리뷰만으로 "고쳤다"고 단정하지 말 것** — 노땡스 세션에서 정확히 이 실수로 1차 수정이 틀렸다는 게 사용자 스크린샷으로 드러난 전례가 있다([docs/troubleshooting.md #7](./docs/troubleshooting.md#7-노땡스-코인칩-배지가-중앙-카드의-숫자를-가리는-버그-1차-시도-실패--구조적-재수정)). **센추리 보드 UI(카드 시장/모달/버리기 UI 전부 포함)는 배포까지 됐지만 실제 화면 확인이 아직 안 됐다** — 같은 원칙이 적용된다. 오프라인 상태로는 `<Game>Game.tsx`의 Supabase 로비를 거칠 수 없어 육안 확인이 막힐 때는, Phase 14가 쓴 방법(보드 컴포넌트를 고정 state로 직접 렌더링하는 임시 라우트를 만들어 `npx playwright screenshot`으로 찍고 확인 후 삭제)을 재사용할 것 — 실제 온라인 락스텝 동기화까지는 검증하지 못하지만 순수 렌더링 결과는 확인할 수 있다.
- **작업 지시와 참조 문서(룰북 등)가 서로 다른 사실을 말하면, 룰북 원문 쪽을 채택하고 그 판단을 문서에 명시적으로 남길 것** — 이번 세션에서 두 번(자원 순서, 금/은화 대체 규칙) 실제로 있었던 상황([docs/history.md Phase 12](./docs/history.md#phase-12--센추리-향신료의-길-신규-게임-2026-08-08) 참고).
- React Hooks 엄격 lint 규칙 유효(early-return 뒤 훅 호출 금지 / 렌더 중 ref 쓰기 금지 / effect 안 동기 setState 금지). `eslint-disable-next-line`은 **경고가 실제로 리포트되는 줄 바로 위**에 둬야 먹힌다.
- `.clinerules.md`/`instructions.md`(저장소 루트, 미확인 파일)는 **Cline 전용 자동화 규칙**(승인 없이 자동 커밋·배포 지시)이라 이 프로젝트의 실제 지침이 아님 — 계속 무시할 것. 실제 지침은 `CLAUDE.md`→`AGENTS.md`뿐.
- Vercel/GitHub 인증은 이미 세팅됨(`.vercel/project.json` 링크됨) — 별도 로그인 없이 `git push` / `npx vercel deploy --prod` 바로 가능.

### 관련 문서
| 문서 | 언제 볼 것 |
|---|---|
| [docs/README.md](./docs/README.md) | `docs/` 전체 색인 + 개발 명령어 |
| [docs/architecture.md](./docs/architecture.md) | "왜 이렇게 설계했는가" — 항상 유효한 현재 설계 원칙 |
| [docs/cloud-sync.md](./docs/cloud-sync.md) | 락스텝 동기화 프로토콜 세부사항 |
| [docs/troubleshooting.md](./docs/troubleshooting.md) | 실제 발생한 버그 9건 — 증상/원인/해결/교훈 |
| [docs/history.md](./docs/history.md) | 시간순 프로젝트 연대기 — Phase 12가 이번 세션(센추리) 내용 |
| [docs/features.md](./docs/features.md) | 기능/게임별 룰 해석 판단 기록(센추리 절 신설됨) |
| [docs/deployment.md](./docs/deployment.md) | 배포 절차, 환경변수, 검증 파이프라인 |

---

## 3. Next Action Items (우선순위 순)

1. **(최우선, 아직 검증 안 됨)** 센추리 보드 UI를 **실제 기기/브라우저에서 육안으로 확인**할 것 — `tsc`/`lint`/`vitest`/`build`만 통과시켰고 렌더링 결과는 전혀 보지 않았다:
   - 카드 시장(상인 6장 + 점수 5장) 레이아웃이 좁은 화면에서 잘리지 않는지, 새로 얹은 금/은 동전 스택(`CoinStack`)이 점수 카드 위와 겹치거나 잘리지 않는지.
   - 상인 카드 재설계(양피지 프레임 + 자원/화살표 아이콘 배치)가 실제로 원본 카드 느낌에 가깝게 읽히는지, 카드 위에 얹은 자원 큐브(회전 배치)가 자원 개수가 많을 때(5인 게임 마지막 칸, 5개 자원) 서로 겹쳐 안 보이지 않는지.
   - 상인 카드 획득 시 재생되는 "자원 수거" 플라잉 이펙트(`MerchantEffects.tsx`)가 실제 클릭 흐름에서 타이밍 좋게 보이는지, 온라인 2인 이상에서 상대방이 획득했을 때도 내 화면에 똑같이 재생되는지.
   - 업그레이드 모달(자원 체이닝/분산), 교환 모달(반복 횟수 스테퍼), 상인 카드 획득 모달(N개 자원 배치)이 실제 클릭 흐름에서 자연스러운지.
   - 자원 10개 초과 시 뜨는 강제 버리기 모달이 실제로 다음 턴을 막고, 정확히 10개가 될 때까지 확정 버튼이 비활성 상태를 유지하는지.
   - 온라인 방을 **2대 이상 실제 기기로 열어** 락스텝 동기화 확인: 카드를 획득/사용/휴식/완성할 때 다른 기기 화면에도 즉시 반영되는지, 재접속 시 정상 복구되는지.
   - **(Phase 15 신규)** 개인 수레의 10칸 인벤토리 슬롯(`CartInventory`)이 실제로 "몇 개 찼는지 한눈에 보이는지", 10개 초과 시 장미색 "초과 슬롯"이 시각적으로 확실히 구분되는지, 상대방 요약 행에 넣은 축소판 10칸 슬롯이 다른 정보(금/은화·점수 카드 수 등)와 줄바꿈 없이 자연스럽게 배치되는지.
   - **(Phase 16 신규)** 생산 카드 사용/무료 상인 카드 획득/점수 카드 완성에 새로 추가된 `ConfirmActionModal`이 실제 클릭 흐름에서 "그냥 원클릭으로 바로 하던 걸 왜 두 번 눌러야 하나"처럼 번거롭게 느껴지지 않는지, 자원이 부족해 애초에 클릭이 막혀야 하는 카드에서 확인 모달이 잘못 뜨지 않는지.
   - **(Phase 16 신규)** 새로 반영된 공식 32장/36장 카드 데이터로 실제 몇 판 진행해보고, 카드 밸런스(특히 갈색5→20점처럼 고비용 점수 카드에 도달 가능한지, 32장 상인 덱이 5인 게임에서 너무 일찍 바닥나지 않는지)가 체감상 자연스러운지.
2. **(해소됨)** 센추리 카드 데이터를 사용자 자체 설계셋 대신 실제 공식 42/36장으로 교체 완료(Phase 16) — 자원 가치 순서(룰북 §4.1 채택)와 금화 소진 시 은화 미대체 판단은 여전히 유효하며 [Phase 12](./docs/history.md#phase-12--센추리-향신료의-길-신규-게임-2026-08-08) 기록 참고.
3. **(이전 세션부터 이어짐, 부분적으로만 검증됨)** 페루도 보드 UI — Phase 14에서 주사위 비주얼/페루도(1) 아이콘/통계 현황판 위치를, **Phase 17(이번 세션)에서 새 보라색 베팅 다이스(이동/눈금 순환/확정/불법 칸 차단)를** 각각 임시 라우트 스크린샷·클릭 시뮬레이션으로 육안 확인했지만, **8인 확장 레이아웃에서 트랙이 실제로 안 잘리는지, 컵 쉐이킹 애니메이션/SFX 실제 타이밍, reveal/gameOver 화면, 팔라피코 배너, 그리고 실제 Supabase 온라인 로비를 거친 멀티 디바이스 동기화(특히 내 로컬 베팅 초안이 상대방 화면에 절대 새어나가지 않는지)는 여전히 미검증**으로 남아 있음 — 자세한 체크리스트는 [docs/features.md 페루도 절](./docs/features.md) 참고.
4. **(이전 세션부터 이어짐, 미해결)** 노땡스 "코인이 카드 숫자를 가리는 버그" 수정([docs/troubleshooting.md #7](./docs/troubleshooting.md#7-노땡스-코인칩-배지가-중앙-카드의-숫자를-가리는-버그-1차-시도-실패--구조적-재수정))도 여전히 실제 기기 육안 재확인이 안 된 상태로 남아 있음.
5. **(이전 세션부터 이어짐, 미해결)** `<Game>Board.tsx`/`<Game>Game.tsx` 전용 테스트 인프라 없음(jsdom/@testing-library 미설치). 저비용 대안으로 Playwright 스크린샷 회귀 테스트도 고려([docs/troubleshooting.md "알려진 사각지대"](./docs/troubleshooting.md#알려진-사각지대-다음에-볼-것)).
6. **(선택)** 저장소 루트의 `.clinerules.md`/`instructions.md` — 이 사용자의 실제 선호(매번 명시 승인)와 반대되는 자동화 지시를 담고 있음. 계속 무시 중이나, 지우거나 남겨둘지는 아직 사용자에게 확답받지 않음.
7. **(선택)** 방장 이탈 시 호스트 권한 승계 로직 없음 / 4자리 초대 코드 중복 확인 없음 / 대규모 동시 접속 스트레스 테스트 미실행 — 낮은 우선순위로 계속 이월 중.
8. **(선택)** 센추리·페루도 외 나머지 준비중 게임(스플렌더, 카탄, 코드네임, 마피아 등 14종)은 우선순위 논의된 바 없음.

---

## 4. Resume Prompt

다음 세션 `/clear` 직후 아래 한 줄을 그대로 붙여넣을 것:

> `HANDOFF.md`부터 읽고, §3의 1번 항목(센추리 카드 시장·모달·버리기 UI·온라인 동기화를 실제 기기에서 육안/멀티 디바이스로 확인하는 것)부터 확인해줘.
