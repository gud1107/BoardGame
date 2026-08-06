# 세션 인수인계서 (Handoff)

_최종 갱신: 2026-08-07_
_이 문서는 다음 Claude 세션에 그대로 붙여넣어 맥락을 전달하기 위해 작성됨._

---

## 1. 프로젝트/작업 개요 및 최종 목적

**보드게임 허브** — 여러 보드게임을 한 곳에서 플레이하고, 게임 결과에 연동된 "내기(베팅)" 정산까지 관리하는 Next.js 웹앱. 실제 배포 URL: **https://board-game-tau-navy.vercel.app**

현재 실제로 플레이 가능한 게임은 **하나미코지 · 뱅!(Bang!) · 그리드 포커 · 아발론(Avalon)** 4종. 나머지(스플렌더, 카탄 등)는 대시보드에 "준비중" 카드로만 노출됨(`src/games/types.ts`의 `GameMeta.playable` 플래그로 제어, 버그 아니라 의도된 상태).

**이번 세션의 요청 (2건, 순차 진행)**:
- **Part 1**: 그리드 포커 UI/UX 대개편 — 보드·카드 크기 확대(반응형), 상대 배치 영역 암전 처리, 딜러 카드 공개 연출, 덱빌딩 20초/최종배팅 15초 타이머 + 효과음, 긴장감 있는 BGM.
- **Part 2**: 내기 시스템 정비 — 순위별 금액 수기 입력 + 빠른 정산 버튼, 제로섬 검증 로직 강화, 그리고 게임별 방 입장 닉네임과 내기 시스템 유저 프로필 간의 매핑 구조 개편(4개 온라인 게임 전체).

두 파트 모두 **완료**, `tsc`/`lint`/`vitest`(148개 전부 통과) 검증 완료, 커밋 6건으로 `origin/main`에 푸시, Vercel 프로덕션 배포 및 200 응답 확인까지 완료됨 — **이번 세션 목적은 100% 달성된 상태.**

---

## 2. 확정된 핵심 규칙 · 기술 스택 · 가이드라인

### 기술 스택
Next.js 16(App Router, Turbopack) · TypeScript · Tailwind CSS v4 · Zustand · IndexedDB(`idb`, 로컬 1차 저장소) · Supabase(`@supabase/supabase-js`, 선택적 — **하나미코지·뱅!·그리드 포커·아발론의 온라인 대전만 필수**). **새 라이브러리 추가 없이** Web Audio API(순수 코드 합성 사운드)와 순수 CSS 애니메이션만으로 이번 세션 기능을 구현함(사용자와 사전 합의).

### 게임 모듈 공통 아키텍처 (4게임 전부 동일 패턴 — 새 게임 추가 시 그대로 복제)
```
src/games/<game-id>/
  engine.ts          순수 함수 리듀서. EngineAction/applyAction, I/O 없음, React 모름.
  <Game>Board.tsx     제어 컴포넌트. state를 props로만 받고 onAction으로만 의도 전달.
  <Game>Game.tsx      방 생성/참여 로비 + Supabase Realtime Presence/Broadcast 동기화.
  RulebookModal.tsx   룰북 모달.
  <Game>.test.ts      Vitest 단위 테스트 — **engine.ts만 테스트함, `<Game>Board.tsx`(React 컴포넌트)는 테스트 대상 밖**(jsdom/@testing-library 미설치, `vitest.config.mts`의 environment는 `node`). UI 컴포넌트에 숨은 버그는 기존 스위트가 못 잡음 — React 컴포넌트 로직을 고칠 때는 유닛 테스트 통과만으로 안심하지 말고 코드를 직접 다시 읽어 검증할 것.
  meta.ts             `export const <GAME>_ID = "<game-id>";` 한 줄짜리 상수 파일.
```
동작 원리(락스텝, 서버 권위 없음): 방장이 시드 하나를 브로드캐스트 → 각 클라이언트가 독립적으로 동일 초기 상태 계산 → 이후 모든 액션을 `EngineAction`으로 브로드캐스트해 같은 순수 리듀서(`applyAction`)로 재생.

### 신뢰 트레이드오프 (의도된 설계, 계속 유지)
모든 클라이언트가 전체 상태(다른 사람의 손패·비밀 역할·전체 보드 포함)를 항상 메모리에 갖고 렌더링 시점에만 필터링 — 개발자도구를 열면 원리적으로 상대 정보를 알아낼 수 있음. "친구끼리 하는 캐주얼 플레이" 기준으로 수용한 결정이며 README에 명시됨. 그리드 포커의 "상대 배치 영역 암전"(§3)도 이 트레이드오프 위에서 순수 렌더링 레벨로만 구현됨 — `p.board[i]`는 항상 메모리에 있고, 화면에 안 그리는 것뿐임.

### 타이머(락스텝 환경에서의 클라이언트 로컬 카운트다운) 패턴 — 이번 세션 신규 확립
서버 권위가 없으므로 "20초/15초 제한시간"은 **각 클라이언트가 자기 자신의 좌석에 대해서만** 로컬로 카운트하고, 만료 시 **자기 좌석의** 무작위 액션만 브로드캐스트한다(다른 사람 대신 액션을 만들지 않음). 클라이언트 간 시계가 약간 어긋나도 무방 — 타이머는 UX 넛지이지 합의 메커니즘이 아님. 재사용 가능한 훅: `src/games/grid-poker/useCountdown.ts`.

### React Hooks 관련 엄격한 lint 규칙 (이번 세션에 처음 부딪힘, 다음에도 유의)
이 프로젝트의 `eslint` 설정은 다음을 엄격히 금지함:
- **early return 뒤에 훅 호출 금지**: 컴포넌트 안에 조건부 `return`(예: 게임 종료 화면 분기)이 있다면, 모든 `useState`/`useEffect`/커스텀 훅은 그 `return`보다 **먼저** 호출되어야 함.
- **렌더링 중 ref 쓰기 금지**(`react-hooks/refs`): `someRef.current = x`는 오직 이펙트/이벤트 핸들러 안에서만. 렌더 본문에서 직접 대입하면 안 됨.
- **effect 안에서 동기적으로 setState 금지**(`react-hooks/set-state-in-effect`): "prop이 바뀌면 상태를 리셋"하는 패턴은 `useEffect(() => setX(...), [key])`가 아니라, **렌더링 중에 이전 key와 비교해서 즉시 setState하는 패턴**(React 공식 문서의 "Adjusting state when a prop changes")을 써야 함 — 이 프로젝트에는 `BettingSidebar.tsx`에도 이미 이 패턴이 쓰이고 있었음(`if (session && session.id !== livePayoutForSession) { ... }`), 이번 세션의 `useCountdown.ts`도 동일 패턴으로 재작성함.

### Tailwind 동적 클래스명 함정 (이번 세션에 회피함)
Tailwind는 소스 파일에 **리터럴로 존재하는** 클래스 문자열만 스캔한다 — `` `border-${accent}-400` `` 같은 템플릿 보간으로 만든 클래스명은 빌드에서 통째로 빠진다. 여러 게임에서 서로 다른 accent 색(emerald/amber/rose)을 쓰는 공용 컴포넌트(`RoomNicknameField.tsx`)를 만들 때는 accent별 완전한 클래스 문자열을 맵(`ACCENT_CLASSES`)에 미리 다 적어두는 방식을 사용함. 앞으로 공용 컴포넌트에 색상 variant를 추가할 때 이 패턴을 그대로 따를 것.

### 코딩/커밋 가이드라인 (사용자 선호, 계속 유지)
- **파생 상태(derived state) 금지 원칙**: 두 개의 파생 상태를 따로 두지 말고 상호 배타적인 명시적 상태로 모델링.
- **좌석 배정 ≠ 역할 배정**: join 순서로 좌석이 채워지지만 역할/세력은 좌석과 무관하게 별도로 셔플.
- **커밋은 기능 단위로 잘게 분리**할 것을 사용자가 선호함(conventional commits: `feat(game):`, `fix(game):`, `docs:`, `refactor(game):`, `test(game):`). 이번 세션엔 파일이 여러 기능에 걸쳐 얽힌 경우(예: `GridPokerGame.tsx`가 BGM 배선과 닉네임 매핑 배선을 동시에 담고 있음), **각 커밋 시점에도 빌드가 깨지지 않는 것**을 최우선으로 삼아 파일 단위로 묶어 커밋함(하나의 파일을 훅 단위로 쪼개 부분 커밋하지 않음) — 완벽한 원자성보다 "각 커밋이 항상 컴파일 가능한 상태"를 우선시할 것.
- **커밋/푸시/배포는 매번 명시적으로 승인받고 진행** — 이번 세션은 코드 작업 완료 후 "제가 요청하는 모든파일을 커밋, 푸쉬, 배포해주세요"라는 명시적 승인을 받고서야 진행함. 다음 세션에서도 별도 승인 없이 먼저 커밋/푸시/배포하지 말 것.
- 스펙이 애매한 지점은 임의로 하나를 확정하고 그 이유를 코드 주석/문서/사용자 보고에 남기는 방식으로 처리. 이번 세션은 작업 범위가 크고 설계 판단(사운드 소스 방식, 타이머 만료 처리, 애니메이션 라이브러리 여부, 4게임 전체 적용 여부)이 여러 개라 **AskUserQuestion으로 4가지를 사전에 확인**받고(전부 "권장" 옵션 선택됨) 진행함 — 애매함이 크고 여러 선택지가 있을 때는 임의 결정보다 이렇게 확인받는 편이 안전.

---

## 3. 완료된 작업 목록

이번 세션 커밋 이력(`origin/main`에 푸시 완료 + Vercel 프로덕션 배포·200 확인 완료):

| 커밋 | 내용 |
|---|---|
| `74fd851` feat(audio) | `src/lib/audio/soundEngine.ts` 신규 — Web Audio API로 BGM(드론/하트비트/불협 아르페지오 3모티프, 루프마다 무작위 선택) + SFX(밧줄 타는 지글거림 노이즈) 직접 합성. AudioContext는 첫 사용자 제스처에서 lazy 생성, 뮤트 상태는 localStorage(`bg_sound_muted`) 저장. |
| `5455bc3` feat(grid-poker) | 카드/보드 반응형 확대(`cardDisplay.tsx`), 상대 배치 완료 칸 암전 오버레이(`GridPokerBoard.tsx`의 `Cell` `hiddenOccupied` 상태), 딜러 카드 공개 애니메이션(`DealerReveal.tsx` 신규 + `globals.css`의 `deal-flip` 키프레임), 배치 20초/제출 15초 카운트다운(`useCountdown.ts` 신규) + 만료 시 본인 좌석 무작위 자동 액션 + 긴급 시 SFX, BGM 시작/정지(`GridPokerGame.tsx`) + 🔊/🔇 토글. **`RoomNicknameField.tsx`(공용 신규 컴포넌트, §2 참고)도 이 커밋에서 함께 도입하고 그리드 포커 방 입장 화면에 배선함**(GridPokerGame.tsx가 이 컴포넌트에 의존하므로 같은 커밋으로 묶음). |
| `a860a7d` feat(identity) | 뱅!/아발론/하나미코지 3개 게임의 방 입장 닉네임 입력을 `RoomNicknameField`로 교체 — 아래 §5의 "닉네임 매핑 구조" 참고. |
| `3579468` feat(betting) | `PayoutTableEditor.tsx`에 단위 선택 칩(1천/2천/5천/1만원) + "⚡빠른 정산 적용" 원클릭 버튼(기존 `generateDefaultPayoutTable(n, unit)` 재사용) + 각 순위 칸 ±스텝 버튼. |
| `1a7b211` fix(betting) | `RoundResultEntry.tsx`의 숨은 버그 수정 — 자동 매칭 안 된 참가자 전원이 동일한 `nextRank` 하나로 몰리던 것을 참가자별 순차 증가로 수정. |
| `5021d14` test(betting) | `src/lib/betting/{zeroSum,ledger}.test.ts` 신규 — 그동안 테스트가 전혀 없던 정산 핵심 로직에 유닛 테스트 14건 추가(제로섬 검증, 8인/1천원 단위 스펙 예시, 동점 처리, 최종 순위 계산 등). |

### 이번 세션에서 발견하고 고친 진짜 원인 (Part 2 4단계)
사용자가 보고한 "게임마다 닉네임 재입력 시 매핑 깨짐" 문제를 조사한 결과, 실제 원인은 오타보다 훨씬 근본적이었음: **4개 온라인 게임 전부, 게임 종료 시 `rankings.playerId`가 처음부터 `` `${roomCode}:${seat}` `` 같은 완전 합성 ID였고, 내기 시스템의 실제 `PlayerRecord.id`와 애초에 연결된 적이 전혀 없었음.** 그래서 이름을 아무리 정확히 똑같이 입력해도 `RoundResultEntry`의 "자동 채움"은 항상 실패하고 있었음(우연히 이름이 일치해도 ID 자체가 다른 체계라 매칭 불가). 게다가 자동매칭 실패 시 수동 fallback도 버그(§3의 `1a7b211`)가 있어서 모든 미매칭 참가자가 한 순위로 몰렸음.

**해결책**: `src/components/identity/RoomNicknameField.tsx`(신규) — 이 디바이스에 활성 내기 세션(`useBettingStore`)이 있으면 세션의 `participants` 목록에서 "나"를 칩으로 선택하게 하고(실제 `playerId` 그대로 재사용, 오타/중복 생성 원천 차단), 없으면 기존처럼 자유 텍스트 입력. 4개 게임의 `Occupant` 타입에 `playerId?: string`을 추가해 Realtime presence로 실어 나르고, `ids`(랭킹에 쓰이는 최종 ID) 계산 시 `occupant.playerId ?? 합성ID` 순으로 우선순위를 둠.

**단, 이 매핑은 "내기 세션이 열려 있는 그 기기"에서만 의미가 있음** — 내기 시스템은 IndexedDB(디바이스 로컬) 기반이라 진행 중인 세션이 여러 기기에 실시간 공유되지 않음(`src/lib/supabase/sync.ts`는 IP 매칭/최종 기록 백업만 담당). 온라인 대전은 각자 자기 기기로 접속하므로, 실제로 판정(`recordRound`)에 쓰이는 매핑은 **보통 방장/총무의 기기**에서만 유효함 — 다른 플레이어들의 기기엔 애초에 내기 세션이 없으므로 그냥 자유 텍스트 입력이 그대로 뜸(정상 동작, 회귀 아님).

### 마무리
- `npx tsc --noEmit` 통과(에러 0건), `npm run lint` 통과(경고/에러 0건), `npx vitest run` **148개 테스트 전부 통과**(이전 134개 + 신규 14개).
- `git push origin main` 완료(커밋 6건), `npx vercel deploy --prod` 완료, `https://board-game-tau-navy.vercel.app` 응답 200 확인.
- 승인된 계획 원문은 `C:\Users\choi\.claude\plans\deep-kindling-ladybug.md`에 남아있음(로컬 클로드 설정 경로, 저장소 밖).

---

## 4. 미완료 작업 / 다음 세션 Next Steps

우선순위 순:

1. **(권장, 신규)** 이번 세션 기능(타이머, 딜러 애니메이션, 암전 오버레이, BGM/SFX, 닉네임 매핑 4게임 배선)은 전부 **코드 리뷰로만 검증**했고 실제 브라우저(특히 여러 기기로 온라인 대전)로 수동 테스트는 하지 않았음. 다음 세션 또는 사용자가 직접, 최소한 아래를 확인해볼 것:
   - 그리드 포커: 20초/15초 타이머가 실제로 카운트다운되고 만료 시 무작위 액션이 정상 발동하는지, BGM이 자연스럽게 순환되는지, 모바일 화면에서 카드가 잘리지 않는지.
   - 4개 게임 모두: 내기 세션이 켜진 상태에서 방을 만들 때 참가자 칩이 뜨고, 선택 후 게임이 끝나면 `RoundResultEntry`에 정말 "자동" 뱃지가 붙어서 나오는지(이게 이번 세션의 핵심 버그 수정 검증 포인트).
2. **(이전 세션부터 이어짐, 여전히 미해결)** `<Game>Board.tsx`/`<Game>Game.tsx`(React 컴포넌트) 전용 테스트 인프라가 전혀 없음(jsdom/@testing-library 미설치). 이번 세션에 추가된 타이머/오디오/애니메이션 로직도 전부 이 사각지대에 들어감 — 우선순위는 다음 세션에서 사용자에게 재확인.
3. **(선택)** BGM/SFX를 지금은 Web Audio API 코드 합성으로 구현함(사용자와 사전 합의된 방식). 만약 더 고품질의 실제 음원을 원하면, 사용자가 직접 mp3 파일을 `public/sounds/`에 넣어주는 방식으로 전환 가능 — `src/lib/audio/soundEngine.ts`의 합성 함수들을 `new Audio(url)` 재생으로 교체하면 됨(구조는 그대로 재사용 가능).
4. **(선택)** 그리드 포커 "족보 강도(n/9)" 표시 방식이 사용자 의도와 다를 수 있음(2세션째 이월) — 다른 형태를 원하면 `GridPokerBoard.tsx`의 해당 `<span>` 부분만 교체.
5. **(선택, 오래 이월 중)** 저장소 루트의 `.clinerules.md`, `instructions.md`, 그리고 이번에 새로 눈에 띈 `boardGameRule/noThanks.md`(untracked) 정체 확인 — 다음 세션에서 사용자에게 이 파일들이 뭔지, 커밋해야 하는지 물어볼 것. `noThanks.md`는 "마이너스 경매(No Thanks!)" 룰북으로 보이며, 이 게임을 다음에 구현할 계획이 있는지도 함께 확인하면 좋음.
6. **(선택)** 방장 이탈 시 호스트 권한 승계 로직 없음 / 4자리 초대 코드 중복 확인 없음 / 5~7인 동시 접속 스트레스 테스트 미실행 — 전부 이전 세션부터 낮은 우선순위로 이월 중, 변동 없음.
7. **(선택)** 아발론 외 나머지 게임(스플렌더, 카탄, 코드네임, 마피아 등)은 실제 로직 없이 "준비중" 상태 — 향후 우선순위는 논의된 바 없음.

---

## 5. 클로드가 기억해야 할 중요 맥락 및 주의사항

- **현재 블로커 없음.** 이번 세션 목표(그리드 포커 UI 개편 + 내기 시스템 정비)는 완전히 해결되어 프로덕션에 배포됨.
- **"온라인 게임의 랭킹 ID는 원래 내기 시스템과 전혀 연결되어 있지 않았다"는 이번 세션의 핵심 발견**: 겉보기엔 "닉네임 오타" 문제처럼 보고됐지만, 실제로는 4개 온라인 게임 전부가 `roomCode:seat` 합성 ID를 랭킹에 써서 애초에 실제 `playerId`와 무관했음. 비슷하게 "증상만 보고 판단하지 말고 실제 데이터 흐름(ID가 어디서 만들어져서 어디로 흘러가는지)을 코드로 직접 추적"하는 습관이 이번에도 진짜 원인을 찾는 데 결정적이었음.
- **내기 세션은 디바이스 로컬(IndexedDB)이라 여러 기기에 실시간 공유되지 않는다**는 사실이 이번 매핑 구조 설계의 핵심 제약이었음 — "모든 플레이어의 닉네임을 서버에서 일괄 매핑"하는 설계가 아니라 "이 기기에 활성 세션이 있으면 그 세션에서 선택, 없으면 자유 입력"으로 설계함. 향후 내기 시스템을 실시간 멀티디바이스 동기화로 바꾸는 큰 리팩터를 한다면 이 가정 자체가 바뀌므로 `RoomNicknameField.tsx`도 재검토 필요.
- **락스텝/서버 권위 없음 모델에 "클라이언트 로컬 타이머"라는 새 패턴이 추가됨** — 각 클라이언트는 자기 좌석에 대해서만 카운트하고 자기 좌석에 대해서만 자동 액션을 브로드캐스트. 다른 게임(뱅!, 아발론 등)에 비슷한 시간제한을 추가할 때 `src/games/grid-poker/useCountdown.ts`를 그대로 재사용/복제 가능.
- **이 프로젝트의 eslint 설정이 React Hooks 관련해 꽤 엄격함**(§2 참고: early-return 뒤 훅 호출 금지, 렌더 중 ref 쓰기 금지, effect 안 동기 setState 금지) — 처음엔 이걸 놓쳐서 `npm run lint`에서 6개 에러가 났었고, 훅을 early-return보다 위로 옮기고 `useCountdown.ts`를 "렌더링 중 key 비교" 패턴으로 재작성해서 해결함. 앞으로 React 컴포넌트에 새 훅/조건부 로직을 추가할 때 이 세 가지를 먼저 염두에 둘 것.
- **Vercel/GitHub 인증은 이 환경에 이미 세팅되어 있음** — `.vercel/project.json`에 프로젝트 링크 존재(`projectName: board-game`), `git remote`는 `https://github.com/gud1107/BoardGame.git`. 별도 로그인 절차 없이 바로 `git push` / `npx vercel deploy --prod` 가능.
- **룰북 원본은 `boardGameRule/` 폴더**에 보관되며 커밋됨(`Avalon.md`, `bang.md`, `Grid Poker.md` + 이번에 눈에 띈 untracked `noThanks.md`). 향후 룰 정확성 재검증 시 이 파일들을 기준으로 diff할 것.
- **`AGENTS.md`의 안내 문구**("이 Next.js는 학습 데이터와 다른 버전이니 `node_modules/next/dist/docs/`를 먼저 읽어라")는 실제로는 이 프로젝트가 표준 Next.js 16을 그대로 쓰고 있어 특별히 다른 점을 발견하지 못했음(이전 세션과 동일 결론, 이번 세션에도 재확인 불필요했음).
- **사용자는 한국어로 소통**하며, 이번 세션처럼 스펙이 크고 설계 선택지가 여러 개인 작업은 AskUserQuestion으로 사전 확인받는 것을 선호함(이번엔 4가지 질문 모두 "권장" 옵션 선택). 작업 규모가 클 때는 EnterPlanMode로 탐색 → 계획 작성 → 승인 후 구현 흐름을 거치는 것이 이번 세션에 잘 맞았음. 커밋 메시지는 영어 conventional-commit 스타일, 커밋은 기능 단위로 분리(단 빌드 깨짐 방지가 최우선, §2 참고).
