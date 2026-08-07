# HANDOFF — 현재 스냅샷

_최종 갱신: 2026-08-08_

> **이 문서는 "지금 이 순간"의 스냅샷만 담는다.** 새 세션이 `/clear` 직후 가장 먼저 읽어야 할 문서이며, 여기 담긴 정보만으로 이전 맥락을 복원할 수 있어야 한다. **시간순 기록(무엇을 왜 그 순서로 만들었는가)은 [docs/history.md](./docs/history.md)로, 버그 대응 이력은 [docs/troubleshooting.md](./docs/troubleshooting.md)로 넘어갔다** — 이 파일 자체는 계속 짧게 유지하고, 완료된 세션 내용은 매번 `history.md`로 옮겨 적을 것(§2026-08-08 문서 체계 재정비 참고, [docs/history.md Phase 8](./docs/history.md#phase-8--인수인계-문서-체계-재정비-2026-08-08)).

---

## 1. Executive Summary

### 목표
**보드게임 허브** — 여러 보드게임을 한 곳에서 플레이하고, 게임 결과에 연동된 "내기(베팅)" 정산까지 관리하는 Next.js 웹앱. 완전 오프라인 동작(IndexedDB 1차 저장소)이 기본이고, Supabase는 온라인 대전 5종에만 필수인 선택적 보강 레이어. 실제 배포 URL: **https://board-game-tau-navy.vercel.app**

### 현재 달성률
- 카탈로그 19종 중 **5종 실제 플레이 가능**: 하나미코지 · 뱅!(Bang!) · 그리드 포커 · 아발론(Avalon) · **노땡스(No Thanks!, 최신 추가)**. 나머지 14종은 `playable: false`로 "준비중" 카드만 노출(의도된 상태, 버그 아님).
- `npx tsc --noEmit` / `npm run lint` / `npx vitest run`(**189개 전부 통과**) / `npm run build` 전부 그린.
- `origin/main` 최신 상태로 푸시 완료, Vercel 프로덕션 배포 완료.
- 개발자 문서(`docs/`) 6종 + 이번에 신설된 `docs/history.md` 전부 노땡스 기준으로 최신화됨.

### 직전 세션 주요 변경 사항
1. **노땡스(No Thanks!) 신규 게임 5-Part 연속 세션** 완료 — 엔진/보드/온라인 방 신규 구현 → 칩 표시 개선+코인 애니메이션 → "칩 공개 여부"를 host-선택 실제 게임 규칙으로 승격 → 덱 스택 시각화 → 콘솔 디버그 헬퍼(`노땡스()`) + **"코인이 카드 숫자를 가리는" 버그의 근본 수정**(1차 시도는 사용자 스크린샷으로 실패가 드러났고, 2차 시도에서 정적 배지 위치가 아니라 코인 애니메이션의 착지 지점 자체가 원인임을 밝혀내 카드/배지 레이아웃을 구조적으로 분리). 상세 내용·커밋 해시는 [docs/history.md Phase 7](./docs/history.md#phase-7--노땡스no-thanks-신규-게임-5-part-세션-2026-08-0708), 버그 원인 분석은 [docs/troubleshooting.md #7](./docs/troubleshooting.md#7-노땡스-코인칩-배지가-중앙-카드의-숫자를-가리는-버그-1차-시도-실패--구조적-재수정).
2. **인수인계 문서 체계 재정비**(이 문서 포함) — `HANDOFF.md`를 "Part를 계속 쌓아가는 로그"에서 이 4-섹션 스냅샷 템플릿으로 재구성하고, 시간순 기록은 신설된 `docs/history.md`로, 오늘 발견된 버그는 `docs/troubleshooting.md`(#7)로 이전. `docs/README.md`·`architecture.md`·`features.md`·`cloud-sync.md`의 게임 수(4→5)·테스트 수(134→189) 등 뒤처진 수치도 동기화.

---

## 2. 현재 시스템 상태 및 구조

### 기술 스택
| 항목 | 내용 |
|---|---|
| 프레임워크 | Next.js 16(App Router, Turbopack) + React 19 + TypeScript(strict) |
| 스타일 | Tailwind CSS v4 |
| 클라이언트 상태 | Zustand(`useBettingStore`) |
| 주 데이터베이스 | 브라우저 IndexedDB(`idb` 래퍼) — 완전 오프라인 동작 |
| 클라우드(선택) | Supabase — Realtime(Broadcast/Presence)이 온라인 대전 5종의 통신 수단 자체, Postgres 2테이블(기기 식별 힌트, 내기 기록 백업)은 완전 선택 |
| 배포 | Vercel, 프로덕션 자동 별칭 `board-game-tau-navy.vercel.app` |
| 테스트 | Vitest **189개**(게임 엔진 5종 유닛 테스트만 — **UI 컴포넌트 테스트 인프라 없음**, jsdom 미설치) |

### 핵심 파일 구조
```
src/
  app/                  Next.js 라우팅만 (대시보드, /games/[gameId] 스테이지 머신, /history)
  components/           범용 UI + 내기 사이드바 일체
  games/
    registry.ts          GAME_REGISTRY(순수 데이터, 19종)
    playableGames.tsx     GameId → 동적 import 매핑(5종만 실제 등록)
    <game-id>/            게임마다 동일한 5파일 패턴:
      engine.ts             순수 리듀서. React/네트워크/시간 모름. 랜덤은 시드 인자.
      <Game>Board.tsx        제어 컴포넌트. state는 props로만, 클릭은 onAction으로만.
      <Game>Game.tsx          방 로비 + Supabase Realtime 동기화(락스텝).
      RulebookModal.tsx, meta.ts, <Game>.test.ts
  lib/                  db(IndexedDB) / betting(정산 원장) / identity(기기·플레이어 매핑) / supabase
  store/bettingStore.ts  Zustand — 내기 세션 오케스트레이션
boardGameRule/*.md      게임별 공식 룰 원문 — 엔진 구현의 근거 자료(5게임 전부 있음, noThanks.md 포함)
docs/                   개발자 심화 문서(아래 "관련 문서" 참고)
```
전체 디렉토리 규칙과 계층 의존 방향은 [docs/architecture.md §5](./docs/architecture.md#5-디렉토리-구조-및-계층-규칙)에 도식으로 정리되어 있음.

### 현재 작동 중인 주요 로직
- **온라인 대전 5종 전부 같은 락스텝(lockstep) 패턴**: 방장이 시드 하나만 브로드캐스트 → 모든 클라이언트가 독립적으로 동일 초기 상태 계산 → 이후 액션은 `EngineAction`으로 브로드캐스트해 같은 순수 리듀서로 재생. 서버 권위 엔진 없음(의도적, [docs/architecture.md §2](./docs/architecture.md#2-온라인-대전의-신뢰-모델-문서화된-의도적-한계)). 재접속(`state-request`/`state-sync`)과 좌석 충돌 자가치유(deviceId 사전순)도 5게임 공통 적용됨([docs/cloud-sync.md](./docs/cloud-sync.md)).
- **파생 상태(derived state) 금지 원칙**: 같은 사실을 두 상태로 따로 표현하지 않기 — 하나미코지·뱅!에서 이 원칙 위반으로 실제 치명 버그가 두 번 났던 뒤 프로젝트 전역 원칙으로 굳어짐([docs/architecture.md §1.4](./docs/architecture.md#14-파생-상태derived-state-금지-원칙)).
- **노땡스 최신 기능 3가지**: (1) `ChipVisibility`("secret"/"public") — 방장이 방 생성 시 고르는 실제 게임 규칙, 엔진 상태에 포함되어 전원에게 동일 적용. (2) `window.노땡스()` 콘솔 디버그 헬퍼 — 제외된 9장/남은 덱 순서 확인용. (3) 코인 토스 애니메이션 착지 지점과 칩 배지를 카드 숫자 박스에서 완전히 분리한 레이아웃(오늘 막 수정, §3의 1번 항목 참고).
- **"엔진 테스트 100% 통과 ≠ UI 정상"**: `<Game>Board.tsx`는 5게임 전부 자동 테스트 대상 밖(jsdom 미설치). 실제로 이 사각지대에서 발생한 버그가 3건 있음([docs/troubleshooting.md](./docs/troubleshooting.md) #1, #6, #7) — React 컴포넌트를 고칠 때는 테스트 통과만 믿지 말고 코드를 직접 추적/검증할 것.

### 작업 규칙 (이 저장소에서 계속 지킬 것)
- **커밋은 기능 단위로 잘게 분리**(conventional commits: `feat(game):`, `fix(game):`, `docs:`, `test(game):`). 각 커밋 시점에도 빌드가 깨지지 않게 파일 단위로 묶어 커밋.
- **커밋/푸시/배포는 매번 명시적으로 승인받고 진행** — 사용자가 매번 "커밋하고 푸쉬해서 배포해주세요"라고 명시한 뒤에만 진행. 다음 세션에서도 먼저 나서서 배포하지 말 것.
- **시각적/레이아웃 버그는 코드 리뷰만으로 "고쳤다"고 단정하지 말 것** — 오늘 정확히 이 실수로 1차 수정이 틀렸다는 게 사용자 스크린샷으로 드러났다([docs/troubleshooting.md #7](./docs/troubleshooting.md#7-노땡스-코인칩-배지가-중앙-카드의-숫자를-가리는-버그-1차-시도-실패--구조적-재수정)). 가능하면 실제 화면 확인을 요청하거나, 최소한 "코드 검증만 했고 육안 확인은 안 됨"을 솔직히 밝힐 것.
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
| [docs/history.md](./docs/history.md) | 시간순 프로젝트 연대기 — "언제 무엇을 왜" |
| [docs/features.md](./docs/features.md) | 기능/게임별 룰 해석 판단 기록 |
| [docs/deployment.md](./docs/deployment.md) | 배포 절차, 환경변수, 검증 파이프라인 |

---

## 3. Next Action Items (우선순위 순)

1. **(최우선, 재발 이력 있음)** "코인이 숫자를 가리는 버그" 수정을 **실제 기기에서 눈으로 재확인**할 것 — 1차 시도가 코드 추론만으로 "고쳤다"고 판단했다가 사용자 스크린샷으로 틀렸음이 드러난 전례가 있음. 최소 확인: (a) 칩이 1개~두 자리 수까지 쌓이는 동안 애니메이션 도중/정지 상태 모두 카드 숫자가 안 가려지는지, (b) 코인이 카드 아래 배지 슬롯으로 자연스럽게 날아가 앉는지, (c) 모바일 좁은 화면(iPhone Safari 등, 이번 버그가 재현된 환경)에서도 동일한지.
2. **(권장)** `DeckStack`(덱 스택 시각화)도 코드 검증만 했고 실제 브라우저 육안 확인 안 함 — 장수 감소에 따라 레이어가 실제로 얇아지는지, 0장일 때 빈 슬롯 전환이 되는지 확인.
3. **(권장)** 노땡스의 코인 애니메이션·상대 칩 공개 토글·`chipVisibility` 게임 모드 전부 **코드 리뷰로만 검증**했고 실제 멀티 디바이스 온라인 대전으로는 수동 테스트 안 함. 확인 목록: 다른 사람이 행동했을 때 내 화면에서도 애니메이션이 같이 재생되는지 / "공개 모드"에서 늦게 들어온 참가자도 처음부터 전원 칩이 보이는지 / "다시하기" 후에도 처음 고른 모드가 유지되는지 / 재접속 직후 애니메이션이 이상하게 안 남는지.
4. **(이전 세션부터 이어짐, 미해결)** `<Game>Board.tsx`/`<Game>Game.tsx` 전용 테스트 인프라 없음(jsdom/@testing-library 미설치). 이번 세션의 시각적 버그도 정확히 이 공백에서 나왔음 — 우선순위를 사용자에게 재확인. 저비용 대안으로 Playwright 스크린샷 회귀 테스트도 고려([docs/troubleshooting.md "알려진 사각지대"](./docs/troubleshooting.md#알려진-사각지대-다음에-볼-것)).
5. **(선택)** 저장소 루트의 `.clinerules.md`/`instructions.md` — 이 사용자의 실제 선호(매번 명시 승인)와 반대되는 자동화 지시를 담고 있음. 계속 무시 중이나, 지우거나 남겨둘지는 아직 사용자에게 확답받지 않음.
6. **(선택)** 방장 이탈 시 호스트 권한 승계 로직 없음 / 4자리 초대 코드 중복 확인 없음 / 대규모 동시 접속 스트레스 테스트 미실행 — 낮은 우선순위로 계속 이월 중.
7. **(선택, 아이디어)** 노땡스에서 확립된 "상태 diff → 애니메이션"(`detectAuctionEvent`) 패턴과 "상태 기반 시각화"(`DeckStack`) 패턴을 다른 게임(뱅!의 카드 플레이, 그리드 포커의 카드 더미 등)에도 적용 가능 — 사용자가 요청하면 진행.
8. **(선택)** 노땡스 외 나머지 준비중 게임(스플렌더, 카탄, 코드네임, 마피아 등 14종)은 우선순위 논의된 바 없음.

---

## 4. Resume Prompt

다음 세션 `/clear` 직후 아래 한 줄을 그대로 붙여넣을 것:

> `HANDOFF.md`부터 읽고, §3의 1번 항목(노땡스 "코인이 카드 숫자를 가리는 버그" 수정을 실제 기기에서 육안 확인하는 것)부터 확인해줘. 문제가 남아있으면 docs/troubleshooting.md #7을 참고해서 원인을 다시 짚어줘.
