# 보드게임 허브

1~10명이 폰이나 데스크톱으로 함께 즐기는 보드게임 대시보드 + 내기(순위 상금/벌금) 정산 시스템.

- **호스팅**: [Vercel](https://vercel.com/) — 프로덕션: <https://board-game-tau-navy.vercel.app>
- **주 데이터베이스**: 브라우저 내장 **IndexedDB** (완전 오프라인 동작, 서버 없이도 전체 기능 사용 가능)
- **클라우드 DB (선택)**: [Supabase](https://supabase.com/) — 기기 간 플레이어 식별 매칭 + 내기 기록 백업용. 설정하지 않아도 앱의 나머지 기능은 정상 동작합니다. 단, **아래 카탈로그의 "온라인대전" 표시가 있는 10개 게임은 Supabase Realtime이 반드시 필요**합니다(기기들을 실시간으로 이어줄 다른 서버가 없기 때문).

## 스택

Next.js 16 (App Router, Turbopack) · TypeScript · Tailwind CSS v4 · Zustand · idb (IndexedDB) · Supabase JS (선택)

## 시작하기

```bash
npm install
npm run dev
```

<http://localhost:3000> 접속. Supabase 없이도 모든 기능(게임 플레이, 내기 시스템, 기록)이 브라우저에만 저장되어 동작합니다.

Supabase를 연동하려면 `.env.example`을 `.env.local`로 복사해 값을 채우고, `supabase/schema.sql`을 Supabase SQL Editor에서 실행하세요.

```bash
npm run build   # 프로덕션 빌드
npm run lint    # ESLint
npm run test    # Vitest 단위 테스트 (게임 엔진 로직)
```

## 게임 카탈로그

전체 23종(플레이 가능 10종 + 준비중 13종) 중 실제 플레이 가능한 게임:

| 게임 | 인원 | 온라인대전 | 하우스룰 / 특수 모드 | 특수 UI | 룰북 |
|---|---|---|---|---|---|
| 하나미코지 (Hanamikoji) | 2 | ✅ | — | — | 없음¹ |
| 뱅! (Bang!) | 4~7 | ✅ | — | — | [rulebook](boardGameRule/bang.md) |
| 그리드 포커 (Grid Poker) | 2~6 | ✅ | 방 생성 시 제한시간(초) 커스텀 | — | [rulebook](<boardGameRule/Grid Poker.md>) |
| 아발론 (Avalon) | 5~10 | ✅ | — | — | [rulebook](boardGameRule/Avalon.md) |
| 노땡스 (No Thanks!) | 3~7 | ✅ | 칩 공개/비밀 모드(호스트 선택) | 코인토스 연출 | [rulebook](boardGameRule/noThanks.md) |
| 페루도 (Perudo) | 2~8 | ✅ | 차등 페널티(룰북 §4) | 실제 WebGL 3D 주사위(Three.js/R3F/Rapier) | [rulebook](boardGameRule/Perudo.md) |
| 센추리: 향신료의 길 | 2~5 | ✅ | — | 3D 자원 큐브 | [rulebook](boardGameRule/Century.md) |
| 틀린 그림 찾기 | 2~8 | ✅ | 사진 업로드 커스텀 스테이지 | Canvas 픽셀 변형 | [rulebook](boardGameRule/spotTheDifference.md) |
| 스플렌더 (Splendor) | 2~4 | ✅ | — | — | [rulebook](<boardGameRule/스플랜더.md>) |
| 오이 다섯 개 (Five Cucumbers) | 2~6 | ✅ | 탈락 기준 오이 5개/6개 토글(호스트 선택) | — | [rulebook](<boardGameRule/오이다섯개.md>) |

¹ 하나미코지는 룰북 원문 파일이 없고(공식 규칙을 직접 구현), 나머지 9종은 `boardGameRule/`에 원전이 있습니다. 파일명은 아직 게임마다 표기가 제각각(영문/한글/공백 혼용)입니다 — `<gameId>.md` kebab-case로 통일하는 작업은 시도했으나, 마침 다른 세션이 같은 폴더를 동시에(다른 규칙으로) 재구성 중이어서 충돌을 피해 이번 세션에서는 보류했습니다(다음 세션 To-do, [HANDOFF.md](./HANDOFF.md) 참고).

나머지 13종(카탄, 티켓 투 라이드, 도미니언, 코드네임, 마피아, 우노, 루미큐브, 할리갈리, 아그리콜라, 7 원더스, 텔레스트레이션, 딕싯, 젠가)은 `registry.ts`에 데이터로만 등록된 "준비중" 상태입니다.

각 게임의 규칙 해석·엣지케이스 판단은 [docs/features.md](./docs/features.md), 온라인 대전 신뢰 모델은 [docs/architecture.md §2](./docs/architecture.md#2-온라인-대전의-신뢰-모델-문서화된-의도적-한계) 참고.

## 새 게임 추가하기

게임 카탈로그는 순수 데이터입니다. `src/games/registry.ts`의 `GAME_REGISTRY` 배열에 항목 하나를 추가하면 대시보드에 즉시 카드가 나타납니다(`playable: false`면 "준비중" 배지가 붙은 미리보기 카드로 표시).

실제로 플레이 가능한 게임을 추가하는 전체 표준(파일 구조, 엔진 계약, 등록 4단계, 재사용해야 할 공용 유틸)은 **[ARCHITECTURE.md](./ARCHITECTURE.md)**에 정리되어 있습니다. 요약하면:

1. `src/games/<gameId>/`에 순수 리듀서(`engine.ts`) + 제어 컴포넌트를 표준 레이아웃대로 작성.
2. `src/games/playableGames.tsx`의 `PLAYABLE_GAME_COMPONENTS`에 **동적 import**로 등록(대시보드 번들에 영향 없음).
3. `registry.ts`의 해당 항목을 `playable: true`로 전환.

`supportsAutoRanking`이 true인 게임은 `onComplete`에서 순위를 직접 계산해 넘겨줘야 하며(예: 하나미코지의 승/패), 그렇지 않은 게임은 플레이 후 순위를 수동으로 입력하는 화면(`RoundResultEntry`)이 자동으로 뜹니다. 각 게임의 실제 규칙/보드 UI는 내기 시스템을 전혀 알지 못합니다 — 승자만 `onGameEnd`로 보고하면 `<Game>Game.tsx` 어댑터가 이를 내기 정산용 순위 배열로 변환합니다.

## 내기(정산) 시스템

화면 우측 하단의 **🎲 플로팅 버튼**으로 여닫는 **내기 관리 사이드바**(`src/components/betting/BettingSidebar.tsx`)에서 참가자 닉네임(최대 10명)·등수별 상금/벌금표를 입력하고, 매 판의 결과가 자동으로 누적 정산됩니다. 상금표는 합계가 정확히 0원이어야 시작할 수 있고(제로섬 검증), 동점(공동 순위) 구간은 자동으로 평균 배분되어 항상 합계 0을 유지합니다. "내기끝"을 누르면 오늘 날짜로 최종 순위/금액이 `기록` 페이지에 저장됩니다.

내기를 시작하지 않아도 게임은 순위 기록 없이 자유롭게 플레이할 수 있습니다. 온라인 대전 결과는 (현재는) 내기 시스템과 별개로 이 기기의 게임 기록에만 저장됩니다. 상세 동작(플레이어 식별 매핑, 동점 처리 규칙 등)은 [docs/features.md](./docs/features.md) 참고.

## Vercel 배포

1. <https://vercel.com/new> 에서 GitHub 저장소(`gud1107/BoardGame`)를 Import 합니다.
2. **Framework Preset: `Next.js`** 를 선택하세요(레포에 `next.config.ts`가 있어 대부분 자동 인식됩니다). Build/Output/Install Command는 Next.js 기본값 그대로 둡니다.
3. Supabase 기능(10개 게임 온라인 대전, 기기 간 식별 매칭, 내기 기록 클라우드 백업)을 쓰려면 Environment Variables에 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`를 추가합니다. 비워두면 그 기능들만 "설정 필요" 화면으로 자동 비활성화되고 나머지(대시보드, 내기 정산 등)는 정상 동작합니다.
4. Deploy. IndexedDB가 주 데이터베이스이므로 별도 DB 프로비저닝 없이 바로 배포됩니다.

## 프로젝트 구조

```
src/
  app/                     라우팅 (대시보드, 게임 상세/플레이, 기록, /api/ip)
  components/              공용 UI(Overlay, Tooltip) + 내기 관리 사이드바 (betting/)
  games/                   게임 카탈로그(registry.ts) + 각 게임의 자기완결 모듈
    types.ts / registry.ts / playableGames.tsx
    <game-id>/             표준 레이아웃 — 정확한 파일 구성은 ARCHITECTURE.md §2 참고
  lib/                     db(IndexedDB) / betting(정산) / identity(기기·플레이어 매핑) / supabase(선택) / rng(공유 난수 유틸)
  store/                   Zustand — 내기 세션 전역 상태
boardGameRule/*.md         게임별 공식 룰 원문 — 엔진 구현의 근거 자료
supabase/schema.sql        선택적 Supabase 테이블 정의
docs/                      개발자 심화 문서 (설계 근거, 트러블슈팅, 배포 절차 등)
```

더 깊은 설계 배경/데이터 모델/개발 문서 전체 색인은 **[docs/README.md](./docs/README.md)**, 지금 이 순간의 프로젝트 스냅샷(진행 상황·다음 할 일)은 **[HANDOFF.md](./HANDOFF.md)**를 참고하세요.
