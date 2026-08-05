# 배포

## 1. 배포 플랫폼: Vercel

- **프로덕션 URL**: https://board-game-tau-navy.vercel.app
- **Vercel 프로젝트**: `board-game` (`.vercel/project.json`, `projectId: prj_mzCWxT3q4UHH8kL7qHPJElizgYMY`) — 저장소 클론 시 자동으로 링크되어 있어 별도 `vercel link` 없이 바로 `npx vercel deploy --prod` 가능.
- **GitHub 저장소**: `gud1107/BoardGame` — Vercel의 Git 연동을 쓰면 `main` 브랜치 푸시마다 자동 배포되지만, 이 프로젝트는 지금까지 **로컬에서 `npx vercel deploy --prod`를 수동 실행**하는 방식으로 배포해왔다(자동 배포 훅 설정 여부는 Vercel 대시보드에서 별도 확인 필요).
- **Framework Preset**: `Next.js` — `next.config.ts`가 있어 Vercel이 자동 인식한다. Build/Output/Install 커맨드는 전부 Next.js 기본값(`next build` / `.next` / `npm install`) 그대로 둔다.

### 새로 Import하는 경우 (아직 링크 안 된 새 환경)

1. https://vercel.com/new 에서 GitHub 저장소를 Import.
2. Framework Preset: `Next.js`.
3. §2의 환경변수를 등록(선택).
4. Deploy — IndexedDB가 주 저장소라 별도 DB 프로비저닝이 필요 없다.

## 2. 환경변수

| 변수 | 필수 여부 | 용도 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | 선택 | Supabase 프로젝트 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 선택 | Supabase anon(공개) 키 |

**두 값 모두 `NEXT_PUBLIC_` 프리픽스가 붙는다** — Next.js에서 이 프리픽스는 값이 클라이언트 번들에 그대로 포함된다는 뜻이다. 이 프로젝트는 서버 사이드 인증 계층이 없으므로 애초에 anon 키가 "공개돼도 되는" 권한만 갖도록 Supabase RLS 정책이 설계되어 있다(`supabase/schema.sql`의 `anon` 롤 정책 참고, [architecture.md §3](./architecture.md#3-데이터-모델) 및 아래 §4).

**비워두면**: `getSupabase()`(`src/lib/supabase/client.ts`)가 `null`을 반환하고, 이를 참조하는 모든 기능이 예외 없이 "설정 필요" 화면으로 안전하게 대체된다(§[architecture.md §1.1](./architecture.md#11-indexeddb가-주-저장소-supabase는-선택적-보강-레이어)). 대시보드·내기 정산·기록 열람 등 나머지 기능은 정상 동작 — 즉 이 두 변수는 **배포 필수 조건이 아니라 기능 토글**이다.

로컬 개발: `.env.example`을 `.env.local`로 복사해 값을 채운다(`.env.local`은 `.gitignore`로 커밋 제외됨).

## 3. 빌드/검증 파이프라인

배포 전 로컬에서 항상 실행하는 3종 검증(CI가 별도로 구성되어 있지 않으므로 **사람이 직접 실행**해야 함):

```bash
npx tsc --noEmit   # 타입 체크 (별도 스크립트 없음, 직접 실행)
npm run lint       # ESLint (eslint-config-next 기반, core-web-vitals + typescript 룰셋)
npm run test       # = npx vitest run — src/**/*.test.ts 전체 (게임 엔진 유닛 테스트만, 아래 참고)
npm run build      # 프로덕션 빌드 (Turbopack)
```

**`npm run test`(vitest)가 커버하지 않는 것**: 각 게임의 `<Game>Board.tsx`(React 컴포넌트)는 테스트 대상이 아니다 — `vitest.config.mts`가 `environment: "node"`이고 jsdom/React Testing Library가 설치되어 있지 않다. 즉 이 4개 명령이 전부 통과해도 UI 컴포넌트 로직의 버그는 잡아내지 못한다(실제로 [troubleshooting.md #6](./troubleshooting.md)이 이 사각지대에서 나왔다). 배포 전 최소한 주요 플레이 경로는 `npm run dev`로 수동 확인하는 걸 권장.

## 4. Supabase 스키마 배포 (선택)

Supabase 기능을 쓰려면 `supabase/schema.sql`을 Supabase 프로젝트의 SQL Editor에서 1회 실행한다. 이 파일이 만드는 건 딱 두 테이블뿐이다:

- `device_sightings(ip, device_id, player_id, name, seen_at)` — 기기 간 플레이어 식별 힌트.
- `daily_records(id, payload jsonb, created_at)` — 종료된 내기 세션의 클라우드 백업.

**Realtime(온라인 대전용 Broadcast/Presence)은 이 스키마와 무관하다** — 별도 테이블이 필요 없고, Supabase 프로젝트가 기본 상태(Realtime Authorization 미적용)라면 아무 설정 없이 바로 동작한다. 최신 프로젝트에서 Broadcast/Presence에 RLS 인가를 요구하도록 켜둔 경우에만 `realtime.messages`에 대한 정책 추가가 필요하다([cloud-sync.md §4](./cloud-sync.md#4-의도적으로-없는-것들)).

**보안 트레이드오프(스키마 파일에 명시된 그대로)**: 이 앱엔 인증(auth) 레이어가 없어서 `anon` 키를 가진 누구나 두 테이블을 읽고 쓸 수 있는 정책으로 설계되어 있다. "친구들끼리 쓰는 사설 스코어보드" 기준으로는 허용 가능한 트레이드오프지만, 더 민감한 용도로 확장한다면 Postgres 함수 + service role 경유나 Supabase Auth 도입으로 좁혀야 한다.

## 5. PWA / 캐시 정책 — 해당 없음 (확인됨)

`public/` 디렉터리가 비어 있고, `manifest.json`/`sw.js`(서비스 워커) 등 PWA 관련 파일이나 `next-pwa` 같은 의존성이 전혀 없다. **이 앱은 PWA가 아니다** — "완전 오프라인 동작"은 서비스 워커의 에셋 캐싱이 아니라 **IndexedDB를 1차 데이터 저장소로 쓰는 것**만으로 달성된다(정적 자산 자체는 매번 네트워크에서 받아야 하므로, 앱 셸을 오프라인에서 여는 것은 별개 문제다). 오프라인 앱 셸 캐싱이나 "홈 화면에 추가" 같은 PWA 기능이 필요해지면 이 섹션을 갱신하고 캐시 무효화 정책(특히 게임 엔진 로직이 바뀔 때 오래된 서비스 워커가 낡은 `engine.ts`를 캐싱하고 있으면 락스텝 동기화가 깨질 수 있다는 점)을 여기에 기록할 것.

## 6. 배포 후 확인 체크리스트

1. `curl -s -o /dev/null -w "%{http_code}" https://board-game-tau-navy.vercel.app` → `200` 확인.
2. Supabase 환경변수를 등록한 배포라면, 온라인 대전 게임 하나(예: 하나미코지)를 두 탭으로 열어 방 생성 → 참여 → 실시간 동기화가 되는지 수동 확인(자동화된 e2e 없음, [troubleshooting.md의 "알려진 사각지대"](./troubleshooting.md#알려진-사각지대-다음에-볼-것) 참고).
3. Supabase 미설정 배포라면 온라인 대전 카드가 "설정이 필요합니다" 화면으로 안전하게 막히는지 확인(크래시 없이).
