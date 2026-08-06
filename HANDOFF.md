# 세션 인수인계서 (Handoff)

_최종 갱신: 2026-08-07_
_이 문서는 다음 Claude 세션에 그대로 붙여넣어 맥락을 전달하기 위해 작성됨._

---

## 1. 프로젝트/작업 개요 및 최종 목적

**보드게임 허브** — 여러 보드게임을 한 곳에서 플레이하고, 게임 결과에 연동된 "내기(베팅)" 정산까지 관리하는 Next.js 웹앱. 실제 배포 URL: **https://board-game-tau-navy.vercel.app**

현재 실제로 플레이 가능한 게임은 **하나미코지 · 뱅!(Bang!) · 그리드 포커 · 아발론(Avalon) · 노땡스(No Thanks!)** 5종. 나머지(스플렌더, 카탄 등)는 대시보드에 "준비중" 카드로만 노출됨(`src/games/types.ts`의 `GameMeta.playable` 플래그로 제어, 버그 아니라 의도된 상태).

**이번 세션의 요청 (2건, 순차 진행)**:
- **Part 1**: `boardGameRule/noThanks.md` 룰북을 기반으로 신규 게임 **노땡스(No Thanks!, 마이너스 경매)** 전체 구현 — 순수 엔진, 온라인 대전 UI, 다른 게임들과 동일한 락스텝 멀티플레이어 동기화, 단위 테스트.
- **Part 2**: 노땡스의 **칩(코인) 표시 로직 점검/개선**(본인은 항상 숫자, 상대는 기본 비공개 + 연습용 공개 토글 추가) + **"노 땡스!"/"가져오기" 선택 시 코인 토스 / 카드+칩 수거 애니메이션 이펙트** 추가(새 라이브러리 없이 순수 CSS).

두 파트 모두 **완료**, `tsc`/`lint`/`vitest`(187개 전부 통과) 검증 완료, **커밋 9건 + `origin/main` 푸시 + Vercel 프로덕션 배포까지 완료**됨 — **이번 세션 목적은 100% 달성된 상태.**

---

## 2. 확정된 핵심 규칙 · 기술 스택 · 가이드라인

### 기술 스택
Next.js 16(App Router, Turbopack) · TypeScript · Tailwind CSS v4 · Zustand · IndexedDB(`idb`, 로컬 1차 저장소) · Supabase(`@supabase/supabase-js`, 선택적 — **하나미코지·뱅!·그리드 포커·아발론·노땡스의 온라인 대전만 필수**). **새 라이브러리를 추가하지 않고** 순수 CSS(`left`/`top` 트랜지션 + `@keyframes`)만으로 애니메이션을 구현하는 것이 이 프로젝트의 확립된 방침(Framer Motion 등은 선택지로 제시됐지만 채택하지 않음).

### 게임 모듈 공통 아키텍처 (5게임 전부 동일 패턴 — 새 게임 추가 시 그대로 복제)
```
src/games/<game-id>/
  engine.ts          순수 함수 리듀서. EngineAction/applyAction, I/O 없음, React 모름.
  <Game>Board.tsx     제어 컴포넌트. state를 props로만 받고 onAction으로만 의도 전달.
  <Game>Game.tsx      방 생성/참여 로비 + Supabase Realtime Presence/Broadcast 동기화.
  RulebookModal.tsx   룰북 모달.
  <Game>.test.ts      Vitest 단위 테스트 — **engine.ts(및 이번에 추가된 것처럼 순수 로직이면 UI 보조 파일도) 대상, `<Game>Board.tsx`(React 컴포넌트)는 테스트 대상 밖**(jsdom/@testing-library 미설치, `vitest.config.mts`의 environment는 `node`). UI 컴포넌트에 숨은 버그는 기존 스위트가 못 잡음 — React 컴포넌트 로직을 고칠 때는 유닛 테스트 통과만으로 안심하지 말고 코드를 직접 다시 읽어 검증할 것.
  meta.ts             `export const <GAME>_ID = "<game-id>";` 한 줄짜리 상수 파일.
```
동작 원리(락스텝, 서버 권위 없음): 방장이 시드 하나를 브로드캐스트 → 각 클라이언트가 독립적으로 동일 초기 상태 계산 → 이후 모든 액션을 `EngineAction`으로 브로드캐스트해 같은 순수 리듀서(`applyAction`)로 재생.

### 신규 확립된 패턴: "상태 스냅샷 diff로 애니메이션 트리거"
보드 컴포넌트는 원시 `EngineAction`이 아니라 리듀서가 만든 **결과 `state`만** props로 받는 구조라("state가 fully controlled by the caller" 원칙), "방금 어떤 행동이 있었는지"를 알아내려면 **연속된 두 상태 스냅샷을 비교(diff)**하는 수밖에 없음. 이번 세션에 노땡스에서 이 패턴을 처음 확립했음(`src/games/no-thanks/AuctionEffects.tsx`의 `detectAuctionEvent`):
- 엔진의 리듀서는 거부된/no-op 액션에 대해 **항상 원래 state와 동일한 객체 참조**를 반환하는 컨벤션을 갖고 있어서(`engine.ts` 전체에 이미 적용된 관례), `prev !== next` 체크만으로 "진짜 상태가 바뀐 것"과 "거부된 액션"을 확실히 구분할 수 있음.
- 이 diff는 **행동을 한 사람뿐 아니라 같은 방의 모든 클라이언트**에서 똑같이 계산되므로, 애니메이션이 브로드캐스트를 받는 모든 화면에서 동일하게 재생됨(멀티플레이어 락스텝과 자연스럽게 맞물림 — 새로 발견한 좋은 부수효과).
- 트리거 자체는 `useEffect`가 아니라 **렌더링 중 `trackedState !== state` 비교 후 즉시 setState**하는, 이 프로젝트에 이미 있던 "prop이 바뀌면 렌더 중 상태 조정" 패턴을 그대로 재사용함(AvalonBoard의 역할모달 리셋과 동일 패턴).
- 다른 게임(뱅!, 그리드 포커 등)에 비슷한 이펙트를 추가할 때 `AuctionEffects.tsx`를 참고용 템플릿으로 재사용 가능.

### 신뢰 트레이드오프 (의도된 설계, 계속 유지)
모든 클라이언트가 전체 상태(다른 사람의 손패·비밀 역할·**칩 개수**·전체 보드 포함)를 항상 메모리에 갖고 렌더링 시점에만 필터링 — 개발자도구를 열면 원리적으로 상대 정보를 알아낼 수 있음. 노땡스는 이번 세션에 **"상대 칩 공개" 토글**을 로컬 전용(다른 사람 화면엔 영향 없음, `localStorage` 저장)으로 명시적으로 노출해서 이 트레이드오프를 오히려 UX 기능으로 승격시킴 — 연습/디버그 목적이라는 점을 title 툴팁과 README에 명시.

### 코딩/커밋 가이드라인 (사용자 선호, 계속 유지)
- **파생 상태(derived state) 금지 원칙**: 두 개의 파생 상태를 따로 두지 말고 상호 배타적인 명시적 상태로 모델링.
- **좌석 배정 ≠ 역할 배정**: join 순서로 좌석이 채워지지만 역할/세력은 좌석과 무관하게 별도로 셔플.
- **커밋은 기능 단위로 잘게 분리**할 것을 사용자가 선호함(conventional commits: `feat(game):`, `fix(game):`, `docs:`, `refactor(game):`, `test(game):`). 각 커밋 시점에도 빌드가 깨지지 않는 것을 최우선으로 삼아 파일 단위로 묶어 커밋.
- **커밋/푸시/배포는 매번 명시적으로 승인받고 진행** — 이번 세션은 두 파트 각각 사용자가 명시적으로 "커밋하고 푸쉬해서 배포해주세요"라고 요청한 뒤에만 진행함. 다음 세션에서도 별도 승인 없이 먼저 커밋/푸시/배포하지 말 것.
- React Hooks 관련 엄격한 eslint 규칙(early-return 뒤 훅 호출 금지 / 렌더 중 ref 쓰기 금지 / effect 안 동기 setState 금지)이 여전히 유효. 이번 세션엔 콜백 ref(커밋 시점에 호출되므로 허용)와 마운트 전용 `useLayoutEffect`(의도적으로 빈 deps 배열 + `eslint-disable-next-line react-hooks/exhaustive-deps` 명시적 주석 처리 — disable 코멘트는 **경고가 실제로 리포트되는 줄 바로 위**에 있어야 먹힘, 함수 호출부가 아니라 `}, []);` 줄 위에 둬야 했음)를 새로 사용함.

---

## 3. 완료된 작업 목록 (이번 세션)

### Part 1 — 노땡스 신규 구현 (`src/games/no-thanks/`)
| 파일 | 내용 |
|---|---|
| `engine.ts` | 3~35 숫자 카드 33장 중 시드 기반 9장 무작위 제외(24장 진행), 인원별 시작 칩(3~5인 11개/6인 9개/7인 7개), `pass`(칩 0개면 no-op으로 거부)/`take`(카드+칩 획득 후 즉시 다음 카드 공개, 같은 플레이어가 턴 유지) 리듀서, `computeGroups`(연속 구간 묶기 — 가장 작은 숫자만 벌점), `computePlayerScore`, `computeRankings`(표준 competition ranking, 동점이면 칩 많은 쪽 우선). |
| `NoThanks.test.ts` | 33개 테스트 — 9장 제외/24장 소진/33장 커버리지, 시드 결정론, 룰북 예시(7·8·9·15·28·29+칩6→벌점44) 재현, 강제 인수, 자동 플레이 시뮬레이션, 순위 동점. |
| `NoThanksBoard.tsx` | 중앙 경매 카드(숫자+칩 뱃지) + "🙅 노 땡스!"/"✅ 가져오기" 버튼 + 인원별 스트립(칩·획득카드 그룹화) + 게임종료 시 전원 채점표. |
| `NoThanksGame.tsx` | 3~7인 방 생성/참여 + Realtime 동기화, Avalon과 동일 패턴. |
| `RulebookModal.tsx`, `meta.ts` | 룰북 모달, `NO_THANKS_ID` 상수. |
| `registry.ts`, `playableGames.tsx` | 게임 카탈로그 등록. |
| `README.md` | "5번째 게임: 노땡스" 섹션 신설. |
| `boardGameRule/noThanks.md` | 룰북 원본, 다른 3게임 룰북과 같은 폴더에 커밋. |

### Part 2 — 칩 표시 개선 + 애니메이션 (같은 디렉터리 추가/수정)
| 파일 | 내용 |
|---|---|
| `AuctionEffects.tsx` (신규) | `detectAuctionEvent`(연속 상태 diff로 pass/take 및 행위자 좌석 추론, §2 참고) + `FlyingToken`(포탈 기반 `position: fixed` 요소, `left`/`top` CSS 트랜지션으로 좌석↔중앙카드 직선 이동 + `globals.css`의 keyframe으로 토스 아크/회전 또는 축소·페이드 플레어). |
| `AuctionEffects.test.ts` (신규) | 6개 테스트 — pass/take 판별과 행위자 귀속, 덱 소진 시의 take, **리매치(새 `startGame()`) 시 오탐 없음**, 참조 불변 no-op에서 null 반환. |
| `NoThanksBoard.tsx` (수정) | 상단에 **"🙈 상대 칩 비공개" / "👁️ 상대 칩 공개 중" 토글**(로컬 전용, `localStorage` 저장) 추가, 중앙카드/좌석 행에 ref 연결, 이펙트 레이어 렌더링. 본인 칩은 원래부터 항상 숫자로 정확히 표시됨을 확인(수정 불필요). 게임종료 화면은 원래부터 토글과 무관하게 전원 칩 즉시 공개(수정 불필요, 확인만). |
| `globals.css` (수정) | `coin-toss-arc`(토스+회전+통통 튀는 스케일), `card-collect-fade`(축소+페이드) keyframe 추가. |
| `README.md` (수정) | 위 두 기능 문서화 + 디렉터리 트리 갱신. |

### 검증 결과 (Part 1, Part 2 각각 + 최종 통합 모두 그린)
- `npx tsc --noEmit`: 에러 0건.
- `npm run lint`: 경고/에러 0건.
- `npx vitest run`: **187개 테스트 전부 통과**(기존 148개 + 노땡스 엔진 33개 + 애니메이션 diff 로직 6개).

### 커밋/배포 (모두 사용자 명시 승인 후 진행, `origin/main`에 푸시 + Vercel 프로덕션 배포 완료)
| 커밋 | 내용 |
|---|---|
| `67252f9` docs | `boardGameRule/noThanks.md` 룰북 문서 커밋 |
| `5d42daf` feat | 노땡스 순수 엔진 + 유닛테스트 33건 |
| `310497e` feat | 노땡스 보드 UI + 룰북 모달 + 온라인 방 컴포넌트 |
| `e06621d` feat | 게임 카탈로그 등록 |
| `0ce0c9a` docs | README에 "5번째 게임: 노땡스" 섹션 추가 |
| `e6561c9` docs | HANDOFF.md 갱신 (Part 1 완료 시점) |
| `6388b24` feat | 상태-diff 기반 이펙트 엔진(`AuctionEffects.tsx` + 테스트) |
| `1fe1f8c` feat | 코인토스/수거 애니메이션 + 상대 칩 공개 토글 배선 |
| `3c1be79` docs | README에 애니메이션/토글 기능 문서화 |

Vercel 프로덕션 배포 완료, `https://board-game-tau-navy.vercel.app` 정상 서빙 확인.

---

## 4. 미완료 작업 / 다음 세션 Next Steps

우선순위 순:

1. **(권장, 신규)** 노땡스의 이번 세션 신규 기능(코인 애니메이션, 상대 칩 공개 토글)은 전부 **코드 리뷰로만 검증**했고 실제 브라우저(특히 여러 기기 온라인 대전)로 수동 테스트는 하지 않았음. 다음 세션 또는 사용자가 직접 최소한 아래를 확인해볼 것:
   - "노 땡스!" 클릭 시 정말 그 좌석에서 중앙 카드로 코인이 날아가는지, "가져오기" 시 카드+칩이 그 사람 줄로 들어가는지 — 특히 **다른 사람이 행동했을 때 내 화면에서도 같이 재생되는지**(멀티 디바이스 확인 포인트).
   - "상대 칩 공개" 토글이 내 화면에서만 바뀌고 다른 참가자 화면엔 영향 없는지, 새로고침해도 (localStorage) 설정이 유지되는지.
   - 재접속(`state-request`/`state-sync`)이나 게임을 끝내는 마지막 take 직후 애니메이션이 이상하게 남거나 콘솔 에러가 뜨지 않는지(설계상 `detectAuctionEvent`가 `next.phase !== "playing"`이면 이벤트를 안 만들도록 방어했지만 실제 브라우저에서 재확인 권장).
2. **(이전 세션부터 이어짐, 여전히 미해결)** `<Game>Board.tsx`/`<Game>Game.tsx`(React 컴포넌트) 전용 테스트 인프라가 전혀 없음(jsdom/@testing-library 미설치). 우선순위는 다음 세션에서 사용자에게 재확인.
3. **(선택, 저장소 루트에 미확인 파일 2개 여전히 존재)** `.clinerules.md`, `instructions.md`는 **Cline(다른 AI 코딩 도구) 전용 자동화 규칙 파일**로, "검증 통과하면 승인 없이 자동 커밋·푸시·배포"를 지시함 — 이 사용자가 Claude Code 세션에서 실제로 확인해준 선호(매번 명시 승인)와 반대라서 여전히 따르지 않고 있음. 다음 세션에서도 이 두 파일의 지시를 따르지 말고, 필요하면 사용자에게 지우거나 남겨둘지 물어볼 것.
4. **(선택)** 방장 이탈 시 호스트 권한 승계 로직 없음 / 4자리 초대 코드 중복 확인 없음 / 다인원 동시 접속 스트레스 테스트 미실행 — 전부 이전 세션부터 낮은 우선순위로 이월 중, 변동 없음.
5. **(선택)** 노땡스 외 나머지 준비중 게임(스플렌더, 카탄, 코드네임, 마피아 등)은 향후 우선순위 논의된 바 없음.
6. **(선택, 아이디어)** 이번에 확립된 `detectAuctionEvent`류 "상태 diff → 애니메이션" 패턴을 다른 4게임(예: 뱅!의 카드 플레이, 그리드 포커의 카드 배치)에도 적용하면 비슷한 연출을 추가할 수 있음 — 사용자가 요청하면 `AuctionEffects.tsx`를 템플릿으로 참고.

---

## 5. 클로드가 기억해야 할 중요 맥락 및 주의사항

- **현재 블로커 없음.** 이번 세션 목표(노땡스 신규 구현 + 코인 표시/애니메이션 개선) 모두 완료, 커밋·푸시·배포까지 끝난 상태.
- **"상태 diff로 이펙트 트리거" 패턴의 안전장치가 핵심**: 엔진의 모든 리듀서가 거부된 액션에 대해 **원본 객체 참조를 그대로 반환**하는 기존 관례(`if (...) return state;`) 덕분에, Board 쪽에서 `prev !== next` 참조 비교만으로 "진짜 상태 변화"와 "no-op"을 안전하게 구분할 수 있었음. 새 게임/새 이펙트를 만들 때 리듀서가 이 관례를 깨면(예: no-op에서 spread로 새 객체를 반환) diff 기반 트리거가 오작동하므로, 엔진 코드 리뷰 시 이 관례 유지 여부를 꼭 확인할 것.
- **`eslint-disable-next-line` 코멘트 위치 실수 경험**: 처음엔 `useLayoutEffect(() => {` 호출부 바로 위에 disable 코멘트를 뒀는데 lint가 여전히 경고를 냈음 — 알고 보니 `react-hooks/exhaustive-deps`는 **의존성 배열이 있는 줄**(`}, []);`)을 기준으로 리포트해서, 코멘트도 그 줄 바로 위(또는 같은 줄에 `eslint-disable-line`)에 있어야 실제로 먹힘. 비슷한 실수를 다음에도 할 수 있으니, disable 코멘트를 추가한 뒤엔 항상 `npm run lint`로 실제로 경고가 사라졌는지 재확인할 것.
- **`.clinerules.md`/`instructions.md`는 Claude Code 지침이 아님** — §4-3 참고. 이 프로젝트의 실제 Claude Code 지침은 `CLAUDE.md`(→`AGENTS.md`)뿐이며, `AGENTS.md`의 "이 Next.js는 학습 데이터와 다른 버전" 문구는 실제로는 표준 Next.js 16이라 특별한 차이가 발견되지 않음(여러 세션째 동일 결론).
- **룰북 원본은 `boardGameRule/` 폴더**에 통일되어 있음(`Avalon.md`/`bang.md`/`Grid Poker.md`/`noThanks.md` 전부 같은 위치, 이제 전부 커밋된 상태).
- **Vercel/GitHub 인증은 이 환경에 이미 세팅되어 있음** — `.vercel/project.json`에 프로젝트 링크 존재(`projectName: board-game`), `git remote`는 `https://github.com/gud1107/BoardGame.git`. 별도 로그인 절차 없이 바로 `git push` / `npx vercel deploy --prod` 가능(단, 매번 승인 후에만, §2 참고).
- **사용자는 한국어로 소통**하며, 스펙이 명확한 요청(룰북 문서가 상세하거나, 기존 게임이라는 확실한 참조 패턴이 있는 경우)은 AskUserQuestion 없이 바로 구현 → 검증까지 진행하는 것을 선호함(이번 두 파트 모두 애매한 지점이 거의 없어 질문 없이 진행). 애매한 설계 판단(예: 애니메이션 지속시간, 토글 저장 방식)은 코드 주석과 이 문서에 근거와 함께 기록.
