# HANDOFF — 현재 스냅샷

_최종 갱신: 2026-08-08 (페루도 UI 고도화 세션)_

> **이 문서는 "지금 이 순간"의 스냅샷만 담는다.** 새 세션이 `/clear` 직후 가장 먼저 읽어야 할 문서이며, 여기 담긴 정보만으로 이전 맥락을 복원할 수 있어야 한다. **시간순 기록(무엇을 왜 그 순서로 만들었는가)은 [docs/history.md](./docs/history.md)로, 버그 대응 이력은 [docs/troubleshooting.md](./docs/troubleshooting.md)로 넘어갔다** — 이 파일 자체는 계속 짧게 유지하고, 완료된 세션 내용은 매번 `history.md`로 옮겨 적을 것.

---

## 1. Executive Summary

### 목표
**보드게임 허브** — 여러 보드게임을 한 곳에서 플레이하고, 게임 결과에 연동된 "내기(베팅)" 정산까지 관리하는 Next.js 웹앱. 완전 오프라인 동작(IndexedDB 1차 저장소)이 기본이고, Supabase는 온라인 대전 6종에만 필수인 선택적 보강 레이어. 실제 배포 URL: **https://board-game-tau-navy.vercel.app**

### 현재 달성률
- 카탈로그 20종 중 **6종 실제 플레이 가능**: 하나미코지 · 뱅!(Bang!) · 그리드 포커 · 아발론(Avalon) · 노땡스(No Thanks!) · **페루도(Perudo, 최신 추가)**. 나머지 14종은 `playable: false`로 "준비중" 카드만 노출(의도된 상태, 버그 아님).
- `npx tsc --noEmit` / `npm run lint` / `npx vitest run`(**228개 전부 통과**) / `npm run build` 전부 그린.
- 이번 세션 작업은 **커밋·푸시·배포까지 완료됨**(사용자가 명시적으로 요청). 배포 URL은 위 목표 섹션과 동일.
- 개발자 문서(`docs/`)는 이번 세션에서 UI 고도화 + 8인 확장 내용을 모두 반영했다. `docs/history.md`에도 이번 세션들의 Phase 항목이 실제 커밋 해시와 함께 추가되었다(아래 "관련 문서" 참고).

### 직전 세션 주요 변경 사항
직전 세션(페루도 신규 구현, 6인 한도)에 이어 **같은 날 두 번의 후속 세션**으로 아래를 추가했다:

**세션 A — 용어/UI 고도화**
1. **용어 일치: "파코" → "페루도"** — 룰북(`boardGameRule/Perudo.md`), 엔진 주석, 보드 UI, 룰북 모달, 테스트 설명 문자열, 프로젝트 문서(README/docs) 전반에서 다이스 조커 용어를 "페루도"로 통일. "페루도!"(의심 외침 액션)와 "1(페루도)"(다이스 눈) 두 용어가 같은 단어를 쓰게 됐다는 점은 사용자 요청을 그대로 따른 결과이며, 헷갈리지 않도록 문맥상 괄호/느낌표로 구분해뒀다.
2. **스컬 이모지 → 실물 다이스 기반 커스텀 아이콘**: 사용자가 보내준 실물 페루도 다이스 사진(빨간 다이스에 흰색으로 새겨진 크레스트)을 참고해 `PerudoFaceIcon.tsx`(순수 인라인 SVG, 외부 이미지 자산 없음)를 새로 만들고 `💀` 자리를 전부 교체. 페루도 눈금 다이스는 실물처럼 빨간 배경으로 렌더링.
3. **실물 보드판 기반 클릭형 베팅 트랙** — `PerudoBoard.tsx`의 `BidTrack`: 그리드의 테두리 칸(`buildTrackCells`)이 중앙 게임 영역을 액자처럼 둘러싸는 레이아웃. 눈금을 먼저 고르고(`FacePicker`) 트랙에서 개수 칸을 누르면 바로 그 선언(`raise`)이 나간다. `minValidQuantityForFace`보다 작은 칸은 자동 비활성화 — "이전 베팅 이하는 클릭 불가" 요구사항 그대로.
4. **컵 쉐이킹 → 리빌 연출 + SFX** — 라운드가 바뀔 때마다(첫 마운트 포함) 실제 다이스 값 대신 흔들리는 컵(`ShakingCup`, `globals.css`의 `cup-shake` 키프레임)을 보여주며 `soundEngine.ts`에 새로 추가한 `playDiceRattle`/`playCupThud`(순수 Web Audio 합성)를 재생한 뒤 실제 눈금을 드러낸다. 순수 로컬 연출(네트워크 무관). 구현 세부: "렌더 중 상태 조정"(NoThanksBoard의 `trackedState`와 동일 패턴)으로 셰이크 시작을 트리거하고 타이머/사운드만 `useEffect`에 둬서 "effect 안 동기 setState 금지" lint 규칙(`react-hooks/set-state-in-effect`)을 지켰다 — 처음엔 걸렸다가 이 패턴으로 고침.
5. **현황판 2종** — 상단 `TotalDiceBanner`(전체 주사위 개수, 모든 phase 공통 표시) + 하단 `MyDiceStatsPanel`(내 눈금별 개수 + 전체 주사위÷3 1/3 기대값).

**세션 B — 최대 인원 6인 → 8인 확장**
6. **`MAX_PLAYERS` 6 → 8** (`engine.ts`) — 실물 박스는 6색상 컵만 제공하지만, 이 웹앱은 디지털 전용 확장으로 8인까지 지원(`boardGameRule/Perudo.md`에 명시).
7. **베팅 트랙 그리드를 하드코딩에서 자동 역산으로 리팩터** — 세션 A에서 만든 트랙이 9×8/30칸으로 **하드코딩**돼 있어, `MAX_PLAYERS`가 6→8이 되자 `TRACK_LENGTH`(=`MAX_PLAYERS×STARTING_DICE`)가 30→40으로 바뀌며 곧장 런타임 `throw`로 이어졌다. `computeTrackDimensions(length)`를 새로 만들어 그리드 가로/세로를 길이로부터 매번 계산하도록 고쳐, 앞으로 `MAX_PLAYERS`가 또 바뀌어도 같은 드리프트가 재발하지 않는다.
8. **방 생성 인원수 스테퍼**(`PerudoGame.tsx`)와 **카탈로그**(`registry.ts`의 `players.max`)를 8로 갱신, 상/하한 텍스트도 엔진 상수(`MIN_PLAYERS`/`MAX_PLAYERS`)를 직접 참조하도록 바꿔 앞으로 숫자가 또 바뀌어도 UI 문구가 따로 드리프트하지 않게 함.
9. **플레이어 목록 UI**(`PerudoBoard.tsx`)를 세로 1열 → 반응형 그리드(좁은 화면 1열/넓은 화면 2열)로 바꿔 8명이 꽉 찬 테이블에서도 과도한 스크롤 없이 보이게 함.

문서화된 두 가지 룰 해석 판단(§ [docs/features.md](./docs/features.md)의 페루도 항목)은 그대로 유지됨 — "맞아!"(calza) 턴 무관 호출, 팔라피코 파생 계산.

---

## 2. 현재 시스템 상태 및 구조

### 기술 스택
| 항목 | 내용 |
|---|---|
| 프레임워크 | Next.js 16(App Router, Turbopack) + React 19 + TypeScript(strict) |
| 스타일 | Tailwind CSS v4 |
| 클라이언트 상태 | Zustand(`useBettingStore`) |
| 주 데이터베이스 | 브라우저 IndexedDB(`idb` 래퍼) — 완전 오프라인 동작 |
| 클라우드(선택) | Supabase — Realtime(Broadcast/Presence)이 온라인 대전 6종의 통신 수단 자체, Postgres 2테이블(기기 식별 힌트, 내기 기록 백업)은 완전 선택 |
| 배포 | Vercel, 프로덕션 자동 별칭 `board-game-tau-navy.vercel.app` |
| 테스트 | Vitest **228개**(게임 엔진 6종 유닛 테스트만 — **UI 컴포넌트 테스트 인프라 없음**, jsdom 미설치) |

### 핵심 파일 구조
```
src/
  app/                  Next.js 라우팅만 (대시보드, /games/[gameId] 스테이지 머신, /history)
  components/           범용 UI + 내기 사이드바 일체
  games/
    registry.ts          GAME_REGISTRY(순수 데이터, 20종)
    playableGames.tsx     GameId → 동적 import 매핑(6종만 실제 등록)
    <game-id>/            게임마다 동일한 5파일 패턴:
      engine.ts             순수 리듀서. React/네트워크/시간 모름. 랜덤은 시드 인자.
      <Game>Board.tsx        제어 컴포넌트. state는 props로만, 클릭은 onAction으로만.
      <Game>Game.tsx          방 로비 + Supabase Realtime 동기화(락스텝).
      RulebookModal.tsx, meta.ts, <Game>.test.ts
      (perudo만) PerudoFaceIcon.tsx  순수 인라인 SVG 아이콘, 외부 이미지 자산 없음
  lib/                  db(IndexedDB) / betting(정산 원장) / identity(기기·플레이어 매핑) / supabase
  store/bettingStore.ts  Zustand — 내기 세션 오케스트레이션
boardGameRule/*.md      게임별 공식 룰 원문 — 엔진 구현의 근거 자료(6게임 전부 있음, Perudo.md 포함)
docs/                   개발자 심화 문서(아래 "관련 문서" 참고)
```
전체 디렉토리 규칙과 계층 의존 방향은 [docs/architecture.md §5](./docs/architecture.md#5-디렉토리-구조-및-계층-규칙)에 도식으로 정리되어 있음.

### 현재 작동 중인 주요 로직
- **온라인 대전 6종 전부 같은 락스텝(lockstep) 패턴**: 방장이 시드 하나만 브로드캐스트 → 모든 클라이언트가 독립적으로 동일 초기 상태 계산 → 이후 액션은 `EngineAction`으로 브로드캐스트해 같은 순수 리듀서로 재생. 서버 권위 엔진 없음(의도적, [docs/architecture.md §2](./docs/architecture.md#2-온라인-대전의-신뢰-모델-문서화된-의도적-한계)). 재접속(`state-request`/`state-sync`)과 좌석 충돌 자가치유(deviceId 사전순)도 6게임 공통 적용됨([docs/cloud-sync.md](./docs/cloud-sync.md)).
- **파생 상태(derived state) 금지 원칙**: 같은 사실을 두 상태로 따로 표현하지 않기 — 하나미코지·뱅!에서 이 원칙 위반으로 실제 치명 버그가 두 번 났던 뒤 프로젝트 전역 원칙으로 굳어짐([docs/architecture.md §1.4](./docs/architecture.md#14-파생-상태derived-state-금지-원칙)). 페루도의 팔라피코 판정도 이 원칙을 그대로 따름.
- **페루도 핵심 설계**: (1) 선언 올리기 검증(`validateRaise`)이 룰북 §3의 4가지 공식(일반↔일반, 일반→페루도, 페루도→일반, 페루도→페루도)을 그대로 구현. (2) "맞아!"(calza)는 턴과 무관하게 아무 좌석이나 호출 가능(문서화된 의도적 해석). (3) 라운드 종료 시 "reveal"(전원 주사위 공개) phase를 거친 뒤 "continue" 액션으로 재굴림 — 그 사이에 결과 요약(`lastResolution`)을 보여줌. (4) 순위는 탈락 역순(`eliminationOrder` 역순)으로 계산. (5) UI는 클릭형 베팅 트랙(`BidTrack`, 칸 수는 `computeTrackDimensions`가 `MAX_PLAYERS × STARTING_DICE`에서 매번 역산) + 컵 쉐이킹 연출/SFX + 상단·하단 현황판으로 구성. 다이스 조커 용어는 전부 "페루도"(구 "파코"). (6) 최대 인원 **8인**(`MAX_PLAYERS`, 실물 박스의 6색상 컵을 넘어서는 디지털 전용 확장).
- **"엔진 테스트 100% 통과 ≠ UI 정상"**: `<Game>Board.tsx`는 6게임 전부 자동 테스트 대상 밖(jsdom 미설치). 과거 이 사각지대에서 발생한 버그가 3건 있음([docs/troubleshooting.md](./docs/troubleshooting.md) #1, #6, #7). **페루도 보드 UI(신규 트랙/컵 연출 포함)는 이번에도 코드 검증만 했고 실제 브라우저 육안 확인을 하지 않았다** — §3의 최우선 항목 참고.

### 작업 규칙 (이 저장소에서 계속 지킬 것)
- **커밋은 기능 단위로 잘게 분리**(conventional commits: `feat(game):`, `fix(game):`, `docs:`, `test(game):`). 각 커밋 시점에도 빌드가 깨지지 않게 파일 단위로 묶어 커밋.
- **커밋/푸시/배포는 매번 명시적으로 승인받고 진행** — 사용자가 매번 "커밋하고 푸쉬해서 배포해주세요"라고 명시한 뒤에만 진행. 다음 세션에서도 먼저 나서서 배포하지 말 것. (이번 세션은 사용자가 명시적으로 요청해 커밋·푸시·배포까지 완료함.)
- **시각적/레이아웃 버그는 코드 리뷰만으로 "고쳤다"고 단정하지 말 것** — 노땡스 세션에서 정확히 이 실수로 1차 수정이 틀렸다는 게 사용자 스크린샷으로 드러난 전례가 있다([docs/troubleshooting.md #7](./docs/troubleshooting.md#7-노땡스-코인칩-배지가-중앙-카드의-숫자를-가리는-버그-1차-시도-실패--구조적-재수정)). **페루도 보드 UI(용어/아이콘/트랙/컵 연출/8인 확장 전부 포함)는 배포까지 됐지만 실제 화면 확인은 아직 안 됐으므로** 같은 원칙이 적용된다.
- React Hooks 엄격 lint 규칙 유효(early-return 뒤 훅 호출 금지 / 렌더 중 ref 쓰기 금지 / effect 안 동기 setState 금지). `eslint-disable-next-line`은 **경고가 실제로 리포트되는 줄 바로 위**에 둬야 먹힌다(의존성 배열 줄 `}, []);` 기준).
- `.clinerules.md`/`instructions.md`(저장소 루트, 미확인 파일)는 **Cline 전용 자동화 규칙**(승인 없이 자동 커밋·배포 지시)이라 이 프로젝트의 실제 지침이 아님 — 계속 무시할 것. 실제 지침은 `CLAUDE.md`→`AGENTS.md`뿐.
- Vercel/GitHub 인증은 이미 세팅됨(`.vercel/project.json` 링크됨) — 별도 로그인 없이 `git push` / `npx vercel deploy --prod` 바로 가능.

### 관련 문서
| 문서 | 언제 볼 것 |
|---|---|
| [docs/README.md](./docs/README.md) | `docs/` 전체 색인 + 개발 명령어 |
| [docs/architecture.md](./docs/architecture.md) | "왜 이렇게 설계했는가" — 항상 유효한 현재 설계 원칙 |
| [docs/cloud-sync.md](./docs/cloud-sync.md) | 락스텝 동기화 프로토콜 세부사항 |
| [docs/troubleshooting.md](./docs/troubleshooting.md) | 실제 발생한 버그 7건 — 증상/원인/해결/교훈 |
| [docs/history.md](./docs/history.md) | 시간순 프로젝트 연대기 — "언제 무엇을 왜" (이번 세션들의 Phase 항목이 실제 커밋 해시와 함께 추가됨) |
| [docs/features.md](./docs/features.md) | 기능/게임별 룰 해석 판단 기록(페루도 UI 고도화·8인 확장 내용 반영됨) |
| [docs/deployment.md](./docs/deployment.md) | 배포 절차, 환경변수, 검증 파이프라인 |

---

## 3. Next Action Items (우선순위 순)

1. **(최우선, 아직 검증 안 됨)** 페루도 보드 UI를 **실제 기기/브라우저에서 육안으로 확인**할 것 — `tsc`/`lint`/`vitest`/`build`만 통과시켰고 렌더링 결과는 전혀 보지 않았다. 이번 세션들에서 새로 생긴 항목 위주로:
   - **베팅 트랙**(`BidTrack`)이 8인 기준 40칸으로 늘어난 뒤에도 모바일 좁은 화면에서 잘리거나 숫자가 안 보이지 않는지, 셀 탭이 실제로 정확한 칸을 누르는지(터치 타겟이 너무 작지 않은지).
   - **컵 쉐이킹 애니메이션 + 효과음** 타이밍이 자연스러운지(너무 짧거나 길지 않은지), 🔊 음소거 버튼이 실제로 작동하는지, iOS Safari처럼 오디오 자동재생 제약이 있는 브라우저에서도 사운드가 실제로 들리는지(사용자 제스처 unlock 타이밍 재확인).
   - **페루도(1) 다이스의 빨간 배경 + 커스텀 아이콘**이 실제 렌더링에서 의도대로 보이는지(스컬 이모지보다 나아졌는지 사용자 확인 필요 — 이 아이콘은 실물 사진을 참고해 새로 그린 추정 재현이라 실물과 얼마나 비슷한지도 사용자 판단이 필요함).
   - **8인 풀 테이블**로 실제 방을 열어 플레이어 목록 2열 그리드, 컵/주사위 수 표시, 트랙 좌표 계산이 전부 안 깨지는지(자동 테스트는 `startGame(8, seed)` 레벨까지만 확인했고 실제 렌더링은 미검증).
   - 상단/하단 현황판 숫자가 실제 게임 진행에 따라 올바르게 갱신되는지.
   - 온라인 방을 **2대 이상 실제 기기로 열어** 락스텝 동기화 확인(이전부터 이어지는 항목): 특히 "맞아!"(calza)가 턴과 무관하게 다른 기기에도 즉시 반영되는지, 팔라피코 라운드 진입 시 UI가 전원 화면에 동일하게 뜨는지, 재접속 시 "reveal" phase 중간에 들어와도 정상 복구되는지.
2. **(권장, 여전히 미검증)** 페루도의 룰 해석 판단들이 사용자 의도와 맞는지 확인 — (a) "맞아!"를 턴과 무관하게 아무나 호출 가능하게 한 것, (b) 2인 플레이 허용(`MIN_PLAYERS=2`, 공식 룰북엔 인원수 하한 명시 없음), (c) 최대 8인 확장(`MAX_PLAYERS=8`, 실물 박스의 6색상 컵을 넘어서는 자체 판단).
3. **(이전 세션부터 이어짐, 미해결)** 노땡스 "코인이 카드 숫자를 가리는 버그" 수정([docs/troubleshooting.md #7](./docs/troubleshooting.md#7-노땡스-코인칩-배지가-중앙-카드의-숫자를-가리는-버그-1차-시도-실패--구조적-재수정))도 여전히 실제 기기 육안 재확인이 안 된 상태로 남아 있음.
4. **(이전 세션부터 이어짐, 미해결)** `<Game>Board.tsx`/`<Game>Game.tsx` 전용 테스트 인프라 없음(jsdom/@testing-library 미설치). 이번 세션에 확장된 페루도 보드도 정확히 이 공백 안에 있음 — 우선순위를 사용자에게 재확인. 저비용 대안으로 Playwright 스크린샷 회귀 테스트도 고려([docs/troubleshooting.md "알려진 사각지대"](./docs/troubleshooting.md#알려진-사각지대-다음에-볼-것)).
5. **(선택)** 저장소 루트의 `.clinerules.md`/`instructions.md` — 이 사용자의 실제 선호(매번 명시 승인)와 반대되는 자동화 지시를 담고 있음. 계속 무시 중이나, 지우거나 남겨둘지는 아직 사용자에게 확답받지 않음.
6. **(선택)** 방장 이탈 시 호스트 권한 승계 로직 없음 / 4자리 초대 코드 중복 확인 없음 / 대규모 동시 접속 스트레스 테스트 미실행 — 낮은 우선순위로 계속 이월 중.
7. **(선택)** 페루도 외 나머지 준비중 게임(스플렌더, 카탄, 코드네임, 마피아 등 14종)은 우선순위 논의된 바 없음.

---

## 4. Resume Prompt

다음 세션 `/clear` 직후 아래 한 줄을 그대로 붙여넣을 것:

> `HANDOFF.md`부터 읽고, §3의 1번 항목(페루도 보드판 트랙·컵 연출·현황판·8인 확장을 포함한 전체 UI + 온라인 동기화를 실제 기기에서 육안/멀티 디바이스로 확인하는 것, 특히 8인 풀 테이블)부터 확인해줘.
