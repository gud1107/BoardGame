# HANDOFF — 현재 스냅샷

_최종 갱신: 2026-08-08_

> **이 문서는 "지금 이 순간"의 스냅샷만 담는다.** 새 세션이 `/clear` 직후 가장 먼저 읽어야 할 문서이며, 여기 담긴 정보만으로 이전 맥락을 복원할 수 있어야 한다. **시간순 기록(무엇을 왜 그 순서로 만들었는가)은 [docs/history.md](./docs/history.md)로, 버그 대응 이력은 [docs/troubleshooting.md](./docs/troubleshooting.md)로 넘어갔다** — 이 파일 자체는 계속 짧게 유지하고, 완료된 세션 내용은 매번 `history.md`로 옮겨 적을 것.

---

## 1. Executive Summary

### 목표
**보드게임 허브** — 여러 보드게임을 한 곳에서 플레이하고, 게임 결과에 연동된 "내기(베팅)" 정산까지 관리하는 Next.js 웹앱. 완전 오프라인 동작(IndexedDB 1차 저장소)이 기본이고, Supabase는 온라인 대전 6종에만 필수인 선택적 보강 레이어. 실제 배포 URL: **https://board-game-tau-navy.vercel.app**

### 현재 달성률
- 카탈로그 20종 중 **6종 실제 플레이 가능**: 하나미코지 · 뱅!(Bang!) · 그리드 포커 · 아발론(Avalon) · 노땡스(No Thanks!) · **페루도(Perudo, 최신 추가)**. 나머지 14종은 `playable: false`로 "준비중" 카드만 노출(의도된 상태, 버그 아님).
- `npx tsc --noEmit` / `npm run lint` / `npx vitest run`(**227개 전부 통과**) / `npm run build` 전부 그린.
- **이번 세션 작업은 아직 커밋/푸시/배포되지 않음** — 워킹 트리에만 존재. 사용자가 명시적으로 승인하기 전까지 다음 세션에서도 먼저 커밋하지 말 것.
- 개발자 문서(`docs/`)는 이번 세션에서 페루도 기준으로 카운트만 동기화했고, `docs/history.md`에 이번 세션의 Phase 항목은 **아직 추가하지 않았다**(history.md는 실제 커밋 해시를 남기는 문서라 커밋 전에는 채울 수 없음 — 다음 세션에서 커밋 후 반드시 추가할 것, 아래 Next Action Items 참고).

### 직전 세션 주요 변경 사항
1. **페루도(Perudo) 신규 게임 구현** — 순수 엔진(`src/games/perudo/engine.ts`, 유닛테스트 38개) → 보드 UI(`PerudoBoard.tsx`) → 룰북 모달 → 온라인 방(`PerudoGame.tsx`, 노땡스와 동일한 락스텝 패턴 재사용) → 카탈로그 등록(`registry.ts`/`playableGames.tsx`) 순으로 한 세션에 진행. 두 가지 룰 해석 판단을 문서화했다(§ [docs/features.md](./docs/features.md)의 페루도 항목 참고):
   - **"맞아!"(calza)는 룰북 원문("차례와 상관없이") 그대로 구현** — 다른 모든 액션(선언 올리기, 페루도!)은 턴 제한이 있지만, calza만은 살아있는 아무 좌석이나 아무 때나 호출 가능.
   - **팔라피코(Palafico)는 별도 플래그 없이 매번 파생 계산**("라운드 선(先)의 주사위가 현재 1개인가") — 이 프로젝트의 "파생 상태 금지" 원칙([architecture.md §1.4](./docs/architecture.md#14-파생-상태derived-state-금지-원칙))을 신규 게임에도 그대로 적용한 사례.
2. **문서 카운트 동기화** — `docs/README.md`·`architecture.md`·`cloud-sync.md`·`features.md`·루트 `README.md`의 게임 수(5→6)·카탈로그 수(19→20)·테스트 수(189→227) 등을 페루도 기준으로 갱신.

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
| 테스트 | Vitest **227개**(게임 엔진 6종 유닛 테스트만 — **UI 컴포넌트 테스트 인프라 없음**, jsdom 미설치) |

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
  lib/                  db(IndexedDB) / betting(정산 원장) / identity(기기·플레이어 매핑) / supabase
  store/bettingStore.ts  Zustand — 내기 세션 오케스트레이션
boardGameRule/*.md      게임별 공식 룰 원문 — 엔진 구현의 근거 자료(6게임 전부 있음, Perudo.md 포함)
docs/                   개발자 심화 문서(아래 "관련 문서" 참고)
```
전체 디렉토리 규칙과 계층 의존 방향은 [docs/architecture.md §5](./docs/architecture.md#5-디렉토리-구조-및-계층-규칙)에 도식으로 정리되어 있음.

### 현재 작동 중인 주요 로직
- **온라인 대전 6종 전부 같은 락스텝(lockstep) 패턴**: 방장이 시드 하나만 브로드캐스트 → 모든 클라이언트가 독립적으로 동일 초기 상태 계산 → 이후 액션은 `EngineAction`으로 브로드캐스트해 같은 순수 리듀서로 재생. 서버 권위 엔진 없음(의도적, [docs/architecture.md §2](./docs/architecture.md#2-온라인-대전의-신뢰-모델-문서화된-의도적-한계)). 재접속(`state-request`/`state-sync`)과 좌석 충돌 자가치유(deviceId 사전순)도 6게임 공통 적용됨([docs/cloud-sync.md](./docs/cloud-sync.md)).
- **파생 상태(derived state) 금지 원칙**: 같은 사실을 두 상태로 따로 표현하지 않기 — 하나미코지·뱅!에서 이 원칙 위반으로 실제 치명 버그가 두 번 났던 뒤 프로젝트 전역 원칙으로 굳어짐([docs/architecture.md §1.4](./docs/architecture.md#14-파생-상태derived-state-금지-원칙)). 페루도의 팔라피코 판정도 이 원칙을 그대로 따름.
- **페루도 핵심 설계**: (1) 선언 올리기 검증(`validateRaise`)이 룰북 §3의 4가지 공식(일반↔일반, 일반→파코, 파코→일반, 파코→파코)을 그대로 구현. (2) "맞아!"(calza)는 턴과 무관하게 아무 좌석이나 호출 가능(문서화된 의도적 해석). (3) 라운드 종료 시 "reveal"(전원 주사위 공개) phase를 거친 뒤 "continue" 액션으로 재굴림 — 그 사이에 결과 요약(`lastResolution`)을 보여줌. (4) 순위는 탈락 역순(`eliminationOrder` 역순)으로 계산.
- **"엔진 테스트 100% 통과 ≠ UI 정상"**: `<Game>Board.tsx`는 6게임 전부 자동 테스트 대상 밖(jsdom 미설치). 과거 이 사각지대에서 발생한 버그가 3건 있음([docs/troubleshooting.md](./docs/troubleshooting.md) #1, #6, #7). **페루도 보드 UI는 이번 세션에서 코드 검증만 했고 실제 브라우저 육안 확인을 하지 않았다** — §3의 최우선 항목 참고.

### 작업 규칙 (이 저장소에서 계속 지킬 것)
- **커밋은 기능 단위로 잘게 분리**(conventional commits: `feat(game):`, `fix(game):`, `docs:`, `test(game):`). 각 커밋 시점에도 빌드가 깨지지 않게 파일 단위로 묶어 커밋.
- **커밋/푸시/배포는 매번 명시적으로 승인받고 진행** — 사용자가 매번 "커밋하고 푸쉬해서 배포해주세요"라고 명시한 뒤에만 진행. 다음 세션에서도 먼저 나서서 배포하지 말 것. **이번 세션의 페루도 작업도 아직 커밋 전이다.**
- **시각적/레이아웃 버그는 코드 리뷰만으로 "고쳤다"고 단정하지 말 것** — 노땡스 세션에서 정확히 이 실수로 1차 수정이 틀렸다는 게 사용자 스크린샷으로 드러난 전례가 있다([docs/troubleshooting.md #7](./docs/troubleshooting.md#7-노땡스-코인칩-배지가-중앙-카드의-숫자를-가리는-버그-1차-시도-실패--구조적-재수정)). 페루도 보드 UI도 아직 실제 화면 확인이 안 됐으므로 같은 원칙이 적용된다.
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
| [docs/history.md](./docs/history.md) | 시간순 프로젝트 연대기 — "언제 무엇을 왜" (이번 세션 Phase는 아직 미기재, 커밋 후 추가 예정) |
| [docs/features.md](./docs/features.md) | 기능/게임별 룰 해석 판단 기록(페루도 항목 이번 세션에 추가됨) |
| [docs/deployment.md](./docs/deployment.md) | 배포 절차, 환경변수, 검증 파이프라인 |

---

## 3. Next Action Items (우선순위 순)

1. **(최우선, 이번 세션에서 검증 안 됨)** 페루도 보드 UI를 **실제 기기/브라우저에서 육안으로 확인**할 것 — 이번 세션은 `tsc`/`lint`/`vitest`/`build`만 통과시켰고 렌더링 결과는 전혀 보지 않았다. 최소 확인 목록:
   - 주사위 pip 레이아웃(`DieFace`의 3×3 그리드)이 실제로 정상적인 주사위 눈 모양으로 보이는지, 파코(1)의 💀 표시가 다른 값들과 시각적으로 구분되는지.
   - 선언 올리기 UI(숫자 픽커 + 개수 스테퍼)가 모바일 좁은 화면에서 겹치거나 잘리지 않는지.
   - "reveal" phase의 전원 주사위 공개 패널과 결과 요약 문구가 실제로 읽기 편한지.
   - 온라인 방을 **2대 이상 실제 기기로 열어** 락스텝 동기화 확인: 특히 "맞아!"(calza)가 **턴과 무관하게** 다른 기기에도 즉시 반영되는지(이번 세션에서 룰북 원문 그대로 구현했지만 멀티 디바이스로 실측 안 함), 팔라피코 라운드 진입 시 UI 배지·선언 잠금이 전원 화면에 동일하게 뜨는지, 재접속(`state-request`/`state-sync`) 시 "reveal" phase 중간에 들어와도 정상 복구되는지.
2. **(권장, 이번 세션에서 결정됐지만 미검증)** 페루도의 두 가지 룰 해석 판단이 사용자 의도와 맞는지 확인 — (a) "맞아!"를 턴과 무관하게 아무나 호출 가능하게 한 것(다른 액션은 전부 턴 제한), (b) 2인 플레이 허용(공식 룰북엔 인원수 하한이 명시돼 있지 않아 자체 판단으로 `MIN_PLAYERS=2`로 설정함). 필요하면 `boardGameRule/Perudo.md`에 명문화하고 `docs/features.md`도 갱신할 것.
3. **(필수, 커밋 시점에)** 이번 세션 작업을 커밋하면 **`docs/history.md`에 새 Phase 항목을 추가**하고 실제 커밋 해시를 남길 것(history.md의 문서 원칙상 커밋 전에는 채울 수 없어 이번 세션엔 비워둠).
4. **(이전 세션부터 이어짐, 미해결)** 노땡스 "코인이 카드 숫자를 가리는 버그" 수정([docs/troubleshooting.md #7](./docs/troubleshooting.md#7-노땡스-코인칩-배지가-중앙-카드의-숫자를-가리는-버그-1차-시도-실패--구조적-재수정))도 여전히 실제 기기 육안 재확인이 안 된 상태로 남아 있음.
5. **(이전 세션부터 이어짐, 미해결)** `<Game>Board.tsx`/`<Game>Game.tsx` 전용 테스트 인프라 없음(jsdom/@testing-library 미설치). 이번 세션에 추가된 페루도 보드도 정확히 이 공백 안에 있음 — 우선순위를 사용자에게 재확인. 저비용 대안으로 Playwright 스크린샷 회귀 테스트도 고려([docs/troubleshooting.md "알려진 사각지대"](./docs/troubleshooting.md#알려진-사각지대-다음에-볼-것)).
6. **(선택)** 저장소 루트의 `.clinerules.md`/`instructions.md` — 이 사용자의 실제 선호(매번 명시 승인)와 반대되는 자동화 지시를 담고 있음. 계속 무시 중이나, 지우거나 남겨둘지는 아직 사용자에게 확답받지 않음.
7. **(선택)** 방장 이탈 시 호스트 권한 승계 로직 없음 / 4자리 초대 코드 중복 확인 없음 / 대규모 동시 접속 스트레스 테스트 미실행 — 낮은 우선순위로 계속 이월 중.
8. **(선택)** 페루도 외 나머지 준비중 게임(스플렌더, 카탄, 코드네임, 마피아 등 14종)은 우선순위 논의된 바 없음.

---

## 4. Resume Prompt

다음 세션 `/clear` 직후 아래 한 줄을 그대로 붙여넣을 것:

> `HANDOFF.md`부터 읽고, §3의 1번 항목(페루도 보드 UI + 온라인 동기화를 실제 기기에서 육안/멀티 디바이스로 확인하는 것)부터 확인해줘. 문제가 없으면 커밋 승인 여부를 먼저 물어보고, 커밋하게 되면 `docs/history.md`에 이번 페루도 세션 Phase를 실제 커밋 해시와 함께 추가해줘.
