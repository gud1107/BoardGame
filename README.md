# 보드게임 허브

1~10명이 폰이나 데스크톱으로 함께 즐기는 보드게임 대시보드 + 내기(순위 상금/벌금) 정산 시스템.

- **호스팅**: [Vercel](https://vercel.com/)
- **주 데이터베이스**: 브라우저 내장 **IndexedDB** (완전 오프라인 동작, 서버 없이도 전체 기능 사용 가능)
- **클라우드 DB (선택)**: [Supabase](https://supabase.com/) — 기기 간 플레이어 식별 매칭 + 내기 기록 백업용. 설정하지 않아도 앱은 정상 동작합니다.

## 스택

Next.js 16 (App Router, Turbopack) · TypeScript · Tailwind CSS v4 · Zustand · idb (IndexedDB) · Supabase JS (선택)

## 시작하기

```bash
npm install
npm run dev
```

http://localhost:3000 접속. Supabase 없이도 모든 기능(게임 플레이, 내기 시스템, 기록)이 브라우저에만 저장되어 동작합니다.

Supabase를 연동하려면 `.env.example`을 `.env.local`로 복사해 값을 채우고, `supabase/schema.sql`을 Supabase SQL Editor에서 실행하세요.

```bash
npm run build   # 프로덕션 빌드
npm run lint    # ESLint
```

## 아키텍처 — 게임 20~100종으로 확장하기

게임 카탈로그는 순수 데이터입니다. `src/games/registry.ts`의 `GAME_REGISTRY` 배열에 항목 하나를 추가하면 대시보드에 즉시 카드가 나타납니다 (`playable: false`면 "준비중" 배지가 붙은 미리보기 카드로 표시).

실제로 플레이 가능한 게임을 추가하려면:

1. `src/games/<game-id>/` 아래에 순수 로직 엔진(`engine.ts`)과 React 컴포넌트를 작성합니다. 컴포넌트는 `PlayableGameProps`(`participants`, `onComplete`)를 구현해야 합니다 (`src/games/types.ts`).
2. `src/games/playableGames.tsx`의 `PLAYABLE_GAME_COMPONENTS`에 동적 import로 등록합니다 (대시보드 번들에 영향 없음).
3. `registry.ts`의 해당 항목을 `playable: true`로 바꿉니다.

`supportsAutoRanking`이 true인 게임은 `onComplete`에서 순위를 직접 계산해 넘겨줘야 하며(예: 하나미코지의 승/패), 그렇지 않은 게임은 플레이 후 순위를 수동으로 입력하는 화면(`RoundResultEntry`)이 자동으로 뜹니다.

## 1번째 게임: 하나미코지

공식 규칙을 최대한 충실히 구현했습니다.

- 21장의 아이템 카드(게이샤 호감도 2,2,2,3,3,4,5장에 대응), 라운드 시작 시 1장 비공개 제외 후 각 6장 배분.
- 매 턴 1장 드로우 후 **비밀 / 거래 / 선물 / 경쟁** 4가지 액션을 라운드당 한 번씩 사용.
- 라운드 종료 시 게이샤별 카드 수를 비교해 다수를 가져간 쪽이 게이샤를 획득 — **게이샤 소유권은 다음 라운드에도 유지**됩니다.
- 누적 게이샤 4개 이상 또는 호감도 11점 이상을 먼저 달성하면 즉시 매치 승리.
- 한 기기를 주고받는 패스 앤 플레이(pass-and-play) 방식이며, 상대 손패를 봐서는 안 되는 시점마다 "탭하여 확인" 화면이 끼어듭니다.

## 내기(정산) 시스템

- 대시보드 헤더의 **"🎲 내기시작"**으로 진입. 참가자 닉네임(최대 10명)을 추가하고, 등수별 상금/벌금 표를 입력합니다.
- **제로섬 검증**: 합계가 정확히 0원이 아니면 시작할 수 없습니다 (`src/lib/betting/zeroSum.ts`). 기본값은 스펙 예시(8명 기준 4000~-4000)와 동일한 로직으로 인원수에 맞게 자동 생성됩니다.
- 내기를 시작하지 않으면(=="내기시작"을 누르지 않으면) 게임은 순위 기록 없이 자유롭게 플레이됩니다.
- 내기 중에는 게임을 몇 개든 이어서 고를 수 있고, 매 판의 결과가 등수표를 소비해 상금/벌금을 계산 → 누적됩니다. 실제로 플레이한 인원(예: 2인 전용 게임)만 자동 순위가 매겨지고, 나머지 참가자는 공동 순위로 자동 배정되며 필요하면 직접 조정할 수 있습니다.
- **"내기끝"**을 누르면 오늘 날짜로 최종 순위/금액이 `기록` 페이지에 저장되고 내기 상태는 초기화됩니다.
- 동점(공동 순위) 처리 시 해당 구간의 등수표 금액을 평균 배분하므로, 어떤 방식으로 순위를 입력해도 항상 합계 0원이 보장됩니다.

## 플레이어 식별 (일자별 닉네임 매핑)

동일 인물이 날마다 닉네임을 바꿔도 데이터가 이어지도록 3가지 신호를 조합합니다 (`src/lib/identity/`):

1. **정확히 같은 닉네임**이 이미 있으면 자동으로 같은 사람으로 처리합니다.
2. 닉네임은 다르지만 **이전 닉네임(별칭) 기록**, **같은 기기의 최근 사용 이력**, 또는 (Supabase 연동 시) **같은 IP의 다른 기기 이력**과 일치하면 "동일 인물로 보입니다" 확인 프롬프트를 띄웁니다.
3. 최종 판단은 항상 **사용자 확인**을 거칩니다 — 자동으로 조용히 병합하지 않습니다. (한 기기로 여러 명의 이름을 입력하는 것이 일반적인 사용 패턴이라, 기기 ID만으로 자동 확정하면 서로 다른 사람이 잘못 합쳐질 수 있기 때문입니다.)

IndexedDB만으로는 브라우저 하나에 국한되므로, 서로 다른 기기 간 매칭(같은 IP)은 Supabase를 연동해야 동작합니다.

## Vercel 배포

1. https://vercel.com/new 에서 GitHub 저장소(`gud1107/BoardGame`)를 Import 합니다.
2. **Framework Preset: `Next.js`** 를 선택하세요 (레포에 `next.config.ts`가 있어 대부분 자동 인식됩니다). Build Command / Output Directory / Install Command는 전부 Next.js 기본값(`next build` / `.next` / `npm install`) 그대로 두면 됩니다.
3. Supabase를 쓸 경우에만 Environment Variables에 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`를 추가합니다. 비워두면 Supabase 관련 기능만 자동으로 비활성화되고 나머지는 정상 동작합니다.
4. Deploy. IndexedDB가 주 데이터베이스이므로 별도 DB 프로비저닝 없이 바로 배포됩니다.

## 프로젝트 구조

```
src/
  app/                     라우팅 (대시보드, 게임 상세/플레이, 기록, /api/ip)
  components/              공용 UI + 내기 시스템 UI (betting/)
  games/                   게임 카탈로그(registry.ts)와 각 게임의 엔진/컴포넌트
  lib/
    db/                    IndexedDB 스키마 + repository
    betting/                제로섬 검증, 정산 로직
    identity/               기기/닉네임 기반 플레이어 식별
    supabase/               선택적 클라우드 동기화 (no-op if unconfigured)
  store/                   Zustand (내기 세션 전역 상태)
supabase/schema.sql        선택적 Supabase 테이블 정의
```
