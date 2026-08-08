# HANDOFF — 현재 스냅샷

_최종 갱신: 2026-08-08 (센추리 실물 카드 비주얼 + 동전 스택 + 카드 위 자원 올리기 UI 세션)_

> **이 문서는 "지금 이 순간"의 스냅샷만 담는다.** 새 세션이 `/clear` 직후 가장 먼저 읽어야 할 문서이며, 여기 담긴 정보만으로 이전 맥락을 복원할 수 있어야 한다. **시간순 기록(무엇을 왜 그 순서로 만들었는가)은 [docs/history.md](./docs/history.md)로, 버그 대응 이력은 [docs/troubleshooting.md](./docs/troubleshooting.md)로 넘어갔다** — 이 파일 자체는 계속 짧게 유지하고, 완료된 세션 내용은 매번 `history.md`로 옮겨 적을 것.

---

## 1. Executive Summary

### 목표
**보드게임 허브** — 여러 보드게임을 한 곳에서 플레이하고, 게임 결과에 연동된 "내기(베팅)" 정산까지 관리하는 Next.js 웹앱. 완전 오프라인 동작(IndexedDB 1차 저장소)이 기본이고, Supabase는 온라인 대전 7종에만 필수인 선택적 보강 레이어. 실제 배포 URL: **https://board-game-tau-navy.vercel.app**

### 현재 달성률
- 카탈로그 21종 중 **7종 실제 플레이 가능**: 하나미코지 · 뱅!(Bang!) · 그리드 포커 · 아발론(Avalon) · 노땡스(No Thanks!) · 페루도(Perudo) · 센추리: 향신료의 길(Century: Spice Road). 나머지 14종은 `playable: false`로 "준비중" 카드만 노출(의도된 상태, 버그 아님).
- `npx tsc --noEmit` / `npm run lint` / `npx vitest run`(**272개 전부 통과**) / `npm run build` 전부 그린.
- 이번 세션 작업은 **커밋·푸시·배포까지 완료됨**(사용자가 이번 요청에 명시적으로 포함해 요청).

### 이번 세션 주요 변경 사항
사용자가 실물 센추리 카드 사진 두 장(상인 카드의 자원→화살표→자원 아이콘 배치, 점수 카드의 큰 숫자+하단 큐브 4개)을 보내며 그 비주얼을 본떠 개편해 달라고 요청 — 직전 세션(Phase 12)에서 "코드 검증만 하고 실제 화면은 안 봤다"고 남겨둔 미검증 항목(§3) 중 **비주얼 파트**를 다뤘다. 상세 설계 판단은 [docs/history.md Phase 13](./docs/history.md#phase-13--센추리-실물-카드-비주얼--동전-스택--카드-위-자원-올리기-ui-2026-08-08-같은-날-다섯-번째-세션) 참고.

1. **금화/은화 입체 동전 스택(`CoinStack`)** — 점수 카드 마켓 1/2번째 칸 위에 남은 개수만큼 원판이 겹쳐 쌓인 것처럼 보이는 신규 컴포넌트(`CenturyBoard.tsx` 내부). `playerCount * 2`(엔진의 초기 공급량)만큼의 슬롯을 항상 렌더링해두고 `visible`한 슬롯만 opacity/transform을 켜는 방식이라, 코인이 소진될 때 `transition-all duration-500`으로 스택이 부드럽게 낮아지는 것처럼 보인다. 시각적 슬롯은 8개로 캡(5인 게임 초기 공급량 10개까지 물리적으로 쌓으면 카드보다 커지므로).
2. **상인 카드/점수 카드 얼굴 재설계** — 레이어드 `inset box-shadow`로 "엔그레이빙된 양피지 프레임"(`CARD_FRAME_STYLE`) 느낌을 공유. 상인 카드는 사진 속 "자원 큐브 스택 → 화살표 → 자원 큐브 스택" 배치를 `CubeStack`/`ArrowGlyph`(생산/업그레이드/교환별 라벨+아이콘 상이, 업그레이드는 대응 그림이 없어 `UpgradeGlyph`로 추상화)로 재현. 점수 카드는 상단 큰 세리프체 숫자 + 하단 요구 자원 큐브 바 배치.
3. **상인 카드 위 자원 "올리기" UI + 수거 애니메이션** — 카드 아래 작은 "+자원" 배지 대신, 카드 이미지 **위**에 회전을 가진 큐브들이 얹혀있는 것처럼 표시(`absolute -top-2.5`). 카드가 실제로 획득될 때 그 위 자원이 "함께 수거되는" 효과는 no-thanks `AuctionEffects.tsx`가 확립한 기법(연속 두 락스텝 상태 diff → `document.body`에 포탈한 고정 위치 엘리먼트를 `left`/`top` CSS 트랜지션으로 날리고 `globals.css` 기존 키프레임 `card-collect-fade`를 재사용)을 신규 파일 `MerchantEffects.tsx`(`detectAcquireEvent` + `FlyingResourceBurst`)로 그대로 이식 — 액션을 누른 로컬 클라이언트뿐 아니라 락스텝으로 상태를 받는 모든 접속자에게 동일하게 재생된다.
4. 이번 세션도 **UI는 코드 리뷰 + `tsc`/`lint`/`vitest`/`build`만으로 검증했고 실제 브라우저 육안 확인은 하지 않았다** — §3 1번 항목에 확인 대상이 그대로 추가됨.

**이전 세션(센추리 신규 구현)의 세부 설계 판단**(자원 순서, 코인 대체 규칙, 카드 데이터 재현 범위, 공용 자원 보울 미모델링, 상인 카드 자원의 "카드 귀속 이동" vs 점수 카드 코인의 "슬롯 기반 지급" 구분)은 [docs/history.md Phase 12](./docs/history.md#phase-12--센추리-향신료의-길-신규-게임-2026-08-08)에 전부 기록되어 있다.

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
- **"엔진 테스트 100% 통과 ≠ UI 정상"**: `<Game>Board.tsx`는 7게임 전부 자동 테스트 대상 밖(jsdom 미설치). 과거 이 사각지대에서 발생한 버그가 3건 있음([docs/troubleshooting.md](./docs/troubleshooting.md) #1, #6, #7). **센추리 보드 UI는 이번 세션에 코드 검증만 했고 실제 브라우저 육안 확인을 하지 않았다** — §3의 최우선 항목 참고.

### 작업 규칙 (이 저장소에서 계속 지킬 것)
- **커밋은 기능 단위로 잘게 분리**(conventional commits: `feat(game):`, `fix(game):`, `docs:`, `test(game):`). 각 커밋 시점에도 빌드가 깨지지 않게 파일 단위로 묶어 커밋.
- **커밋/푸시/배포는 매번 명시적으로 승인받고 진행** — 사용자가 매번 명시한 뒤에만 진행. 다음 세션에서도 먼저 나서서 배포하지 말 것. (이번 세션은 사용자가 요청 자체에 커밋·푸시·배포까지 명시적으로 포함했음.)
- **시각적/레이아웃 버그는 코드 리뷰만으로 "고쳤다"고 단정하지 말 것** — 노땡스 세션에서 정확히 이 실수로 1차 수정이 틀렸다는 게 사용자 스크린샷으로 드러난 전례가 있다([docs/troubleshooting.md #7](./docs/troubleshooting.md#7-노땡스-코인칩-배지가-중앙-카드의-숫자를-가리는-버그-1차-시도-실패--구조적-재수정)). **센추리 보드 UI(카드 시장/모달/버리기 UI 전부 포함)와 페루도 보드 UI(트랙/컵 연출/8인 확장) 둘 다 배포까지 됐지만 실제 화면 확인은 아직 안 됐으므로** 같은 원칙이 적용된다.
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
2. **(권장, 여전히 미검증)** 센추리의 판단 지점들이 사용자 의도와 맞는지 확인 — (a) 자원 가치 순서를 작업 지시 프롬프트 대신 룰북 문서 쪽으로 확정한 것, (b) 금화 소진 시 은화 대체를 넣지 않은 것, (c) 42/36장의 실제 공식 카드 대신 자체 설계한 카드 데이터셋(`cards.ts`)을 쓴 것 — 실제 카드 텍스트/수치를 나중에 구하면 이 파일만 교체하면 되도록 만들어뒀다.
3. **(이전 세션부터 이어짐, 미검증)** 페루도 보드 UI(베팅 트랙 8인 확장, 컵 쉐이킹/SFX, 실물 리스킨)도 실제 기기 육안 확인이 아직 안 된 채로 남아 있음 — 자세한 체크리스트는 [docs/features.md 페루도 절](./docs/features.md) 참고.
4. **(이전 세션부터 이어짐, 미해결)** 노땡스 "코인이 카드 숫자를 가리는 버그" 수정([docs/troubleshooting.md #7](./docs/troubleshooting.md#7-노땡스-코인칩-배지가-중앙-카드의-숫자를-가리는-버그-1차-시도-실패--구조적-재수정))도 여전히 실제 기기 육안 재확인이 안 된 상태로 남아 있음.
5. **(이전 세션부터 이어짐, 미해결)** `<Game>Board.tsx`/`<Game>Game.tsx` 전용 테스트 인프라 없음(jsdom/@testing-library 미설치). 저비용 대안으로 Playwright 스크린샷 회귀 테스트도 고려([docs/troubleshooting.md "알려진 사각지대"](./docs/troubleshooting.md#알려진-사각지대-다음에-볼-것)).
6. **(선택)** 저장소 루트의 `.clinerules.md`/`instructions.md` — 이 사용자의 실제 선호(매번 명시 승인)와 반대되는 자동화 지시를 담고 있음. 계속 무시 중이나, 지우거나 남겨둘지는 아직 사용자에게 확답받지 않음.
7. **(선택)** 방장 이탈 시 호스트 권한 승계 로직 없음 / 4자리 초대 코드 중복 확인 없음 / 대규모 동시 접속 스트레스 테스트 미실행 — 낮은 우선순위로 계속 이월 중.
8. **(선택)** 센추리·페루도 외 나머지 준비중 게임(스플렌더, 카탄, 코드네임, 마피아 등 14종)은 우선순위 논의된 바 없음.

---

## 4. Resume Prompt

다음 세션 `/clear` 직후 아래 한 줄을 그대로 붙여넣을 것:

> `HANDOFF.md`부터 읽고, §3의 1번 항목(센추리 카드 시장·모달·버리기 UI·온라인 동기화를 실제 기기에서 육안/멀티 디바이스로 확인하는 것)부터 확인해줘.
