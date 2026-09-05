# 보드게임 허브 — 개발/관리 문서

이 폴더(`docs/`)는 저장소 루트의 `README.md`(사용자/설치 안내)를 보완하는 **개발자용 심화 문서**다. 루트 `README.md`가 "무엇을 어떻게 켜는가"를 다룬다면, 여기는 "왜 이렇게 만들었는가, 뭐가 터졌었는가, 다음에 뭘 봐야 하는가"를 다룬다.

> 새 세션을 시작한다면: 먼저 저장소 루트의 **`HANDOFF.md`**(직전 세션 인수인계, 살아있는 문서)를 읽고, 신규 게임을 추가한다면 **`ARCHITECTURE.md`**(표준 계약)를 읽을 것. 이 폴더는 그보다 안정적인 배경 지식이 필요할 때 참조.

---

## 한눈에 보기

| 항목 | 내용 |
|---|---|
| 프레임워크 | Next.js 16 (App Router, Turbopack) + React 19 + TypeScript(strict) |
| 스타일 | Tailwind CSS v4 |
| 클라이언트 상태 | Zustand (`useBettingStore`) |
| **주 데이터베이스** | 브라우저 내장 **IndexedDB** (`idb` 래퍼) — 완전 오프라인 동작, 서버 없이 전체 기능 사용 가능 |
| **클라우드 백엔드(선택)** | Supabase — Realtime(Broadcast/Presence)으로 10개 온라인 대전 게임 필수, Postgres 2테이블로 기기 간 식별 매칭·내기 기록 백업(선택) |
| AI/LLM 연동 | 없음 (확인 완료, [ai.md](./ai.md)) |
| PWA / 서비스 워커 | 없음 (확인 완료, [deployment.md §5](./deployment.md#5-pwa--캐시-정책--해당-없음-확인됨)) |
| 배포 | Vercel, 프로덕션 `https://board-game-tau-navy.vercel.app` |
| 테스트 | Vitest — 게임 엔진 10종 유닛 테스트(UI 컴포넌트 테스트 없음, 아래 "기억할 것 하나" 참고). 정확한 개수는 `npx vitest run` 실행 결과 참고(세션마다 갱신되므로 이 문서엔 고정 숫자를 적지 않음) |
| 실제 플레이 가능 게임 | 하나미코지 · 뱅! · 그리드 포커 · 아발론 · 노땡스(No Thanks!) · 페루도(Perudo) · 센추리(Century: Spice Road) · 틀린 그림 찾기 · 스플렌더(Splendor) · 오이 다섯 개(Five Cucumbers) (총 23종 카탈로그 중 10종, 나머지는 "준비중") |

---

## 문서 목록

| 문서 | 다루는 내용 |
|---|---|
| [../ARCHITECTURE.md](../ARCHITECTURE.md) | **신규 게임 추가 시 지켜야 할 표준 계약** — 엔진 규격, 모듈 레이아웃, 등록 4단계, 공용 유틸 |
| [architecture.md](./architecture.md) | 핵심 설계 원칙(파생 상태 금지, 게임/내기 로직 분리 등)의 "왜" — IndexedDB 데이터 모델·인덱스 전략, 온라인 대전 신뢰 모델, 디렉토리 구조 |
| [cloud-sync.md](./cloud-sync.md) | 10개 온라인 대전 게임이 공유하는 락스텝(lockstep) 동기화 패턴, 방 생명주기, 재접속(`state-request`/`state-sync`), 좌석 충돌 자가치유 |
| [troubleshooting.md](./troubleshooting.md) | 실제로 발생했던 버그 10건 — 증상/원인/해결법/교훈/검증 방법. "알려진 사각지대" 포함 |
| [history.md](./history.md) | **시간순** 프로젝트 히스토리 — Phase별 마일스톤과 "왜 그 시점에 그렇게 결정했는가". troubleshooting.md/architecture.md와 달리 연대기 순서로 읽는 문서 |
| [ai.md](./ai.md) | AI/LLM 연동 현황(없음, 확인 완료) + 오인하기 쉬운 로직 경계 정리 |
| [deployment.md](./deployment.md) | Vercel 배포 절차, 환경변수, 빌드/검증 파이프라인, Supabase 스키마 배포, PWA 해당 없음 확인 |
| [features.md](./features.md) | 대시보드/카탈로그, 내기 정산 시스템, 플레이어 식별, 게임별 룰 해석 판단 기록 |
| [analytics-local-store-limitations.md](./analytics-local-store-limitations.md) | 방문/게임 통계를 로컬 파일(`localStore.ts`)로 저장하기로 한 결정이 Vercel 프로덕션에서 구체적으로 어떤 충돌 시나리오·불편함을 낳는지 정리 |
| [visual-verification.md](./visual-verification.md) | Playwright 스크린샷으로 UI를 육안 확인하는 방법, 토큰 비용 계산, `visual-check-gate` 스킬이 지금 형태(범위 규율)로 정착하기까지의 시행착오 기록 |

루트 문서(이 폴더 밖):

- `README.md` — 사용자용 설치·실행·기능 안내(한국어, 이 프로젝트의 "제품 설명서") + 게임 카탈로그 표
- `ARCHITECTURE.md` — 무한 확장 모듈형 게임 플러그인 표준 계약(이 폴더의 `architecture.md`와 역할이 다름 — 위 표 참고)
- `HANDOFF.md` — **현재 스냅샷**만 담는 살아있는 문서(Executive Summary/현재 아키텍처·상태/다음 할 일/재개 프롬프트 4개 섹션 고정). 시간순 기록은 여기 대신 [history.md](./history.md)로, 버그 대응 기록은 [troubleshooting.md](./troubleshooting.md)로 넘어간다(2026-08-08 문서 체계 재정비, [history.md Phase 8](./history.md#phase-8--인수인계-문서-체계-재정비-2026-08-08) 참고).
- `boardGameRule/*.md` — 게임별 공식 룰 원문(파일명이 아직 게임마다 표기가 제각각 — kebab-case 통일은 다른 세션과의 편집 충돌로 보류됨, [HANDOFF.md](../HANDOFF.md) 참고) — 엔진 구현의 근거 자료
- `AGENTS.md` / `CLAUDE.md` — 이 저장소에서 AI 코딩 에이전트가 지켜야 할 프로젝트 지침

---

## 개발 명령어

```bash
npm install       # 의존성 설치
npm run dev       # 개발 서버 (http://localhost:3000)
npm run build     # 프로덕션 빌드 (Turbopack)
npm run start     # 빌드된 프로덕션 서버 실행
npm run lint      # ESLint
npm run test      # = npx vitest run — 게임 엔진 유닛 테스트 전체 (src/**/*.test.ts)
npx tsc --noEmit  # 타입 체크 (별도 npm 스크립트 없음, 직접 실행)
```

작업을 마무리할 때 이 4가지(`tsc`, `lint`, `test`, 그리고 필요시 `build`)를 전부 통과시키는 것이 이 저장소의 최소 기준선이다. 자세한 배포 절차는 [deployment.md](./deployment.md) 참고.

---

## 기억할 것 하나

> **`npm run test`가 전부 통과해도, UI 컴포넌트(`<Game>Board.tsx`)의 버그는 하나도 못 잡는다.**

10개 게임 전부 `engine.ts`(순수 리듀서)만 Vitest로 테스트하고, React 컴포넌트를 실제로 렌더링해 상호작용을 검증하는 인프라(jsdom, `@testing-library/react`)는 이 저장소에 아예 설치되어 있지 않다(`vitest.config.mts`가 `environment: "node"`). 그래서 "엔진은 100% 정상, UI 레이어가 그 값을 잘못 소비"하는 버그가 자동 테스트를 전부 통과한 채로 프로덕션에 배포될 수 있다 — 실제로 이 패턴의 버그가 **세 번** 발생했다: 하나미코지의 경쟁 액션 제출 버튼이 영원히 비활성화된 사례, 뱅!의 손패 제한 로직이 액션 페이즈 내내 모든 카드 사용을 막아버린 사례, 그리고 노땡스의 코인 애니메이션이 카드 숫자를 가리는 순수 레이아웃 버그(전부 코드 리뷰만으로 "고쳤다"고 잘못 판단했다가 실제 화면 확인 후에야 드러남, 셋 다 [troubleshooting.md](./troubleshooting.md) 참고).

React 컴포넌트의 조건부 렌더링/이벤트 핸들러 로직을 고칠 때는 **테스트 통과만으로 안심하지 말고, 코드를 직접 추적해서 실제 동작을 검증할 것**. 컴포넌트 테스트 인프라 도입은 이 프로젝트의 최우선 개선 후보로 남아 있다.

곁들여 기억할 두 가지:

- **온라인 대전은 서버 권위 엔진이 아니다** — 모든 클라이언트가 상대의 손패/비밀 역할을 포함한 전체 상태를 메모리에 들고 있다(문서화된 의도적 트레이드오프, [architecture.md §2](./architecture.md#2-온라인-대전의-신뢰-모델-문서화된-의도적-한계)). "친구끼리 캐주얼 플레이" 기준을 벗어나는 요구가 생기면 이 가정부터 재검토해야 한다.
- **Supabase는 항상 선택 사항이어야 한다** — 새 기능을 추가할 때 `getSupabase()`가 `null`을 반환하는 경로(미설정 상태)에서도 앱이 크래시하지 않고 우아하게 그 기능만 꺼지는지 반드시 확인할 것. 이 계약이 깨지면 "IndexedDB만으로 완전히 동작한다"는 프로젝트의 핵심 전제가 깨진다.
