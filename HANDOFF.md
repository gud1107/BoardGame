# HANDOFF — 현재 스냅샷

## ⚠️ 배포 프로토콜 변경 (2026-09-08) — 반드시 읽을 것

**`vercel deploy --prod`를 수동으로 실행하지 마세요.** 이 프로젝트의 Vercel 프로젝트(`board-game`,
`me-3871` 팀)는 **GitHub 저장소(`gud1107/BoardGame`)와 이미 연결되어 있고**, `git push origin main`이
성공하는 순간 Vercel이 웹훅으로 자동 프로덕션 배포를 트리거합니다(보통 1분 이내 완료, alias
`board-game-git-main-me-3871.vercel.app` + `board-game-tau-navy.vercel.app`에 자동 반영).

**그동안 여러 세션이 반복해서 겪은 "격리 워크트리로 `vercel deploy --prod` 시도 → `status: UNKNOWN`,
`Builds: . [0ms]`로 몇 시간이고 멈춤" 현상의 진짜 원인**: 이 저장소는 동시에 여러 Claude Code 세션이
같은 계정/프로젝트에 각자 수동 CLI 배포(`vercel deploy --prod`)를 반복 시도해왔고, 그 수동 CLI 배포
요청들이 서로 빌드 큐에서 경합하며 대부분 죽어버리는 것으로 보임(2026-09-08 세션에서 실측: 동시에
7개의 `vc.js deploy` 프로세스가 떠 있었고, 그중 다수가 `UNKNOWN` 상태로 17시간 넘게 멈춰 있었음 —
`npx vercel ls`로 확인 가능, `npx vercel rm <url> --yes`로 정리 가능하나 이 자체는 근본 해결책이
아님). **반면 GitHub 웹훅으로 트리거된 자동 배포는 이 경합의 영향을 받지 않고 안정적으로 ~1분 내
성공**했음 — 실측: 커밋 `106096f`가 17:58:59에 푸시되자 5초 뒤(17:59:04) 자동 배포가 시작돼 정상
`READY` 상태로 완료, `curl`/Vercel API(`githubCommitSha`)로 프로덕션이 정확히 그 커밋을 서빙 중임을
확인함.

**결론 및 향후 프로토콜**: 코드 변경 후 `git push origin main`까지만 하면 배포는 자동으로 처리됩니다.
배포 결과를 확인하려면 수동으로 `vercel deploy`를 또 실행하지 말고, 아래로 확인하세요:
1. `npx vercel inspect <production-url>`의 `status`가 `● Ready`인지, 또는
2. Vercel API로 `meta.githubCommitSha`가 방금 푸시한 커밋 해시와 일치하는지
   (`curl https://api.vercel.com/v13/deployments/<dpl_id>?teamId=<teamId> -H "Authorization: Bearer <token>"`,
   토큰은 `~/AppData/Roaming/xdg.data/com.vercel.cli/auth.json`), 또는
3. 간단히 `curl -s -o /dev/null -w "%{http_code}" https://board-game-tau-navy.vercel.app/`로 200 확인 +
   몇 분 기다렸다가(웹훅 배포 완료 시간) 실제 화면 변경사항 확인.

푸시 후 자동 배포가 몇 분이 지나도 시작되지 않는 것으로 의심되면(웹훅 실패 등 드문 경우), 그때만
`vercel deploy --prod`를 **한 번만** 시도하고, 다른 세션들의 동시 수동 배포 시도와 경합할 수 있으니
길게 재시도하지 마세요.

## 📚 문서 이력 관리 방침 (2026-11-01 갱신)

**이 문서가 다시 무거워지지 않게 하려면, 이 섹션의 규칙을 계속 지킬 것.**

- `HANDOFF.md`는 "지금 이 순간" 스냅샷 + **최근 1주일 이내** 세션 기록만 담는다. 그보다 오래된 날짜별 항목은 [docs/history.md](./docs/history.md)로 옮겨 적는다(버그 대응 성격이 강한 항목은 [docs/troubleshooting.md](./docs/troubleshooting.md)로).
- **2026-09-19 문서 정리 세션에서 실제로 있었던 일**: 이 규칙이 2026-08-09(Phase 28) 이후 약 40일간 지켜지지 않아 `HANDOFF.md`가 9,206줄/1.8MB까지 불어나 있었다. 아래쪽 "1. Executive Summary"~"4. Resume Prompt" 고정 섹션도 실제로는 Phase 27~29 시점(2026-08-09~23) 내용에서 멈춰 있어 최신 상태와 전혀 안 맞았다. 이번 세션에서 2026-08-14~09-12 사이의 날짜별 항목(약 4,700줄)을 전부 `docs/history.md`에 "Phase 29+ 대량 이관 아카이브"로 원문 그대로 옮기고, 아래 고정 4개 섹션은 현재 코드베이스를 다시 조사해 새로 썼다. **이관된 옛 기록이 필요하면 `docs/history.md`를 열어볼 것** — 이 파일에는 더 이상 없다.
- **2026-11-01 두 번째 정리**: 같은 일이 또 일어나 7,311줄/약 1MB가 됐다. 10-25 이전 날짜 섹션 104개(2026-09-14~10-23, 약 7,000줄)를 `docs/history.md` "Phase 30+" 아카이브로 원문 그대로 옮겼다. 3,500줄이 넘던 "🌗 테마 토글" 섹션도 함께 옮겼다. 한 헤더 밑에 여러 날짜의 후속 세션 기록을 `_이전 갱신: ..._` 식으로 계속 이어 붙이지 말 것.
- **세션을 마칠 때마다** 내 섹션을 맨 위에 추가하고, 1주일 넘은 섹션은 그 자리에서 history.md 맨 끝 아카이브(현재 Phase 30+, "앞으로 이 문서에 추가할 때" 바로 위)로 옮길 것. 다음 정리를 또 한 달 넘게 미루지 말 것.

## 🃏 달무티 — 손패 카드 숫자 잘 보이게 — 2026-11-01 (커밋 `750fec4`/푸시)

"손패 숫자가 잘 안 보인다". 원인 두 가지: ① 3D 화면 손패 줄은 카드가 최소 18px까지 겹치는데 숫자는 카드 가운데에만 있어서 옆 카드에 가려졌다(주석은 "왼쪽 가장자리 숫자가 보인다"고 했지만 실제로는 왼쪽 가장자리에 숫자가 없었다). ② 내 차례가 아니면 손패 전체가 `opacity-40`.
- `CardArt.tsx` `CardFace`(초상화 없는 기본 앞면): 왼쪽 위 모서리 숫자(검정 칩, 15px) 추가, 가운데 숫자 24→34px + 외곽선·그림자, 이모지는 오른쪽 위로, 이름 글씨 조금 키움.
- `DalmutiBoard.tsx` `renderHandCard`: 차례가 아닐 땐 흐리게 하지 않음. 내 차례에 낼 수 없는 카드만 `opacity-50 saturate-50`.
- 확인: tsc/eslint 0. **화면 캡처는 안 했다.**

## 🎁 보상 도전 — 5등급·보상 25종 + 게임 화면 접이식 진행도 창 — 2026-11-01 (커밋 `a999805`·`4f38638`/푸시, 배포는 웹훅 자동)

"해금 조건을 모르겠다" → "보상 종류·등급을 더 많이 + 게임 중 접을 수 있는 창으로 항시 확인".
- `src/lib/skins/unlocks.ts`: 해금 목표 6개 → **25개**, 등급 `TIERS` 5단계(🥉브론즈 5·🥈실버 6·🥇골드 6·💎다이아 5·👑레전드 3). 세는 항목(`TRACKS`, 각각 플레이어용 설명 포함) 10종: 판수(봇 포함)·사람과 함께 판/승·게임 종류·이긴 게임 종류·업적·Lv.8+/Lv.10 봇 판 승리(`byBotLevel`)·한 게임 최다승(mastery)·1인 도전. `rewardsFor(id)`는 카탈로그에서 보상을 찾아오므로 둘이 어긋나지 않는다. `nextGoals`는 달성률 높은 순. 등급 색은 `tierVars/tierText/...`(라이트 모드 전용 진한 색 — 실버·다이아 파스텔이 흰 바탕에서 안 보였음).
- **버그 수정**: 1인 게임(`players.max===1`: 배고픈 상어·게 생존·프리즘 파이브)은 판마다 "봇 없는 1등"으로 기록돼 "사람과 함께 판·승"에 섞였다(배고픈 상어 30판 → 🏆 전설). 이제 1인 게임은 판수·승수·mastery·게임 승리 종류에서 빠지고 `soloRuns` 트랙만 채운다. "게임 종류"와 업적은 계속 센다. 해금 상태는 저장하지 않고 매번 계산하므로, 1인 게임으로 열었던 사람은 다시 잠긴다.
- 새 보상 스킨 19개(무늬형, 그림 생성 쿼터 안 씀): 뒷면 9(기사단·비취·자수정·불사조·번개·태양·흑요석·다이아·은하수), 테이블 5(고서 서재·숲속 오두막·사막 오아시스·용암 화산·우주 정거장), 이름표 5(탐험가·백전노장·챔피언·정복자·그랜드마스터). 소품은 보상 없음.
- `src/components/skins/RewardTracker.tsx`: 공용 게임 페이지(`src/app/games/[gameId]/page.tsx`)의 `stage==="playing" && hydrated`에서 마운트 → 모든 게임. 헤더 아래 **왼쪽 위** 알약(오른쪽 위 공개방 알약과 대칭) "🎁 보상 n/25 · 다음: …" → 펼치면 ✨새로 열린 보상 / 🎯다음 목표 3개 / 등급별 `<details>` 전체 목록(진행 막대 + 보상 이름) / ⓘ 어떻게 세나요 / 🎨 스킨 창 버튼. 펼침 상태 `bg_reward_tracker_open`, 본 해금 목록 `bg_reward_seen_v1`(첫 방문엔 이미 열린 것을 NEW로 안 띄움, 닫을 때 NEW 해제). 스킨 창 보상 칸에도 등급 배지.
- 확인: tsc/eslint 0, vitest skins+constants 83(1인 제외·봇 레벨 집계·모든 목표에 보상·같은 트랙에서 목표가 높으면 등급도 같거나 높음·다음 목표 순서). 운영 캡처 1280×800(배포 직전 빌드, 배치만)·390×780(라이트, 수정 후) — 잘림·겹침 없음.
- **안 한 것/남은 점**: 휴대폰에서 펼치면 게임 위를 덮는다(접으면 해결, 기본은 접힘). 3D 전체 화면 게임에서 왼쪽 위 🎨/카메라 오버레이와 겹치는지는 미확인. 해금 순간 축하 연출은 NEW 배지+깜빡임뿐. 해금 판정은 여전히 클라이언트 전용. 앞서 만든 프리뷰 아티팩트(claude.ai/artifact/FT5Csxyoy1hSnbGJeUxea3)는 옛 6개 기준이라 낡음.

## 🃏 쿠 — 내 손패 아래 능력 표시 + 진짜인 행동·막기 강조 — 2026-11-01 (다른 세션, 커밋 `313744e`/푸시)

다른 세션 작업이라 커밋 메시지만 옮겨 적음. 내 손에 실제로 있는 캐릭터의 행동·막기 버튼은 초록 ✓ 배지로 빛나고, 버튼에 마우스를 올리면 근거가 되는 카드가 밝아진다. 손패 카드마다 ▶ 행동 / 🛡 막기 설명이 붙는다(`CoupBoard.tsx`, `ResponseDock.tsx`, `CardArt.tsx`).

## 🔐 라이어를 찾아라 — 서버 판정 매치(개발자 도구로 라이어 못 보게) — 2026-11-01 (커밋 `c47b04f`/푸시, **운영에선 아직 꺼져 있음**)

10-31 QA에서 cityChase·memoryFeast를 뺀 온라인 게임 전부가 `game-start`에 셔플 `seed`를 브로드캐스트한다는 게 드러났다. 그래서 누구나 개발자 도구로 손패·직업·제시어를 다시 계산할 수 있다. 사용자가 "방장만 암호화"가 아니라 "서버 판정"을 골랐고, 라이어 게임에 먼저 적용했다.
- 게임과 무관한 공용 코어 `src/lib/secureMatch/`: `core.ts`(순수 advance/act/view), `store.ts`(`version` CAS), `client.ts`(`useSecureMatch`). API `/api/match`(POST op: start/view/act/bots), 테이블 `supabase/secure_matches.sql`. 세부 내용은 docs/cloud-sync.md §6.
- 자리 인증: 방마다 기기별 랜덤 토큰(localStorage). presence에는 SHA-256 해시만 올린다. 타이머·봇은 서버가 맡는다(`botDueAt`). 클라이언트는 시각이 되면 사람 순위대로 시차를 두고 서버를 깨운다.
- 라이어 게임 시점: `src/games/liarGame/secure.ts` `liarView`. 라이어는 제시어를 받지 않고, 시민은 라이어가 누군지 받지 않는다. 남의 공개 전 설명·투표는 비워서 보낸다.
- **자동 대체**: API가 503/404를 주거나, 사람 중 한 명이라도 tokenHash가 없으면(옛 클라이언트) 기존 락스텝으로 시작한다. 그래서 설정 전에 배포해도 안전했다.
- **운영에서 켜려면(사용자 몫)**: ① `supabase/secure_matches.sql` 실행 ② Vercel에 `SUPABASE_SERVICE_ROLE_KEY` 추가 후 재배포. 켜졌는지는 `POST /api/match {op:"start",...}`가 503이 아닌지로 확인한다.
- 로컬 테스트(키 없이): `SECURE_MATCH_MEMORY=1 npx next dev`(메모리 저장소) + Playwright 컨텍스트 2개.
- 다음 이전 예정: 마피아(직업) → 아발론/쿠/러브레터/뱅/페루도/코요테. 게임마다 `<game>/secure.ts` SecureGameDef를 만들어 games.ts에 등록하고, "어떤 문자열 값도 비밀과 같지 않다" 테스트를 붙인다.
- 같은 날 `176d62e`: 봇 시뮬 테스트가 무작위로 타임아웃 나던 문제를 testTimeout 30s로 고침. 시뮬은 동기 실행이라 5s 제한이 멈춤을 끊지 못하고 병렬 부하에서만 무작위로 실패했다.

## 🎨 내 스킨 — 카드 뒷면·테이블(방 테마)·3D 이름판·소품, 방 전체에 보임 — 2026-10-31 (커밋 `5c4b7f0`~`6763e11` 5개/푸시, 배포는 웹훅 자동)

"사용자별 커스텀" 요청 = 배경·카드 스킨(하우스룰 아님). 사용자가 "나만 보기"가 아니라 "모두에게 보이기"를 골랐다.
- 카탈로그 `src/lib/skins/catalog.ts`(뒷면·테이블·이름판·소품, 뒷면마다 무늬+문양이 다름), 저장 `mySkin.ts`(localStorage `bg_my_skin_v1` + 로그인 시 `user_metadata.skin`), 훅 `useSkins.ts`.
- 공유: 기존 `room-chars` presence(`roomCharacters.ts`)에 `skin`·`host`를 실어 보낸다. 게임별 프로토콜 변경은 없다. 자리 이름 기준이라 같은 닉네임 충돌은 캐릭터와 같다.
- 누구 것이 보이나: 테이블 = 방장 것, 카드 뒷면·이름판 = 그 자리 주인 것. **공용 더미는 게임 기본 뒷면 유지.** 반지의 제왕 대결·스플렌더 대결·달무티 2D 뒷면은 뒷면이 장·레벨·등급 정보를 담고 있어 일부러 뺐다.
- 3D: TableScene `useSkinnedTheme`(방장 테이블) + `CardBackOwner` 컨텍스트 → `HeldFan`이 뒷면을 바꾼다. 이름판은 `labelTexture(..., { plate })`(자리 색은 안쪽 테두리로 남고, 자리 비움은 회색 그대로). 2D는 쿠·러브레터·하나미코지·블러프 룰렛의 숨긴 손패만 `owner`를 받는다.
- 6763e11: 테이블 스킨이 "방 테마"가 됨(조명 색·의자 색·떠다니는 파티클 꽃잎/별/눈/거품/불씨/반짝이 — 저사양 모드에선 꺼짐). 소품 스킨 = 페루도 컵 몸통·고리 + 게임이 색을 안 넘기는 CoinStack. FLUX 그림 뒷면 4종(`public/images/skins/backs/*.webp`; nouveau는 schnell이 가짜 숫자를 그려 모서리를 잘라냄) + 오로라 테이블 + 전설 이름판은 `unlocks.ts`로 잠금. 무료 스킨 한 번에 끼기 세트(`SKIN_SETS`, 무료만 — 테스트로 강제). 모든 3D 테이블 카메라 오버레이에 🎨 버튼.
- 해금 조건(`unlocks.ts`): 사람과 함께 5판/10승/30승(봇이 낀 판은 `noBot`에서 빠짐), 서로 다른 게임 8종, 업적 20/40개. /stats 동기화 수치를 쓰므로 계정을 따라간다.
- 확인: 운영에서 Playwright 컨텍스트 2개로 방장 스킨이 손님 화면에 보이는 것을 확인했다.
- **안 한 것/남은 점**
  - 해금 판정은 이 기기 브라우저에서만 한다. localStorage를 고치면 잠긴 스킨을 낄 수 있다(꾸미기라 피해 없다고 보고 스킨 창에서만 막음). 받는 쪽도 검사하지 않으므로 고친 사람의 잠긴 스킨이 방 전체에 보인다.
  - 3D 손패는 대부분 옆으로 서 있어 그림 뒷면이 잘 안 보인다. 제안만 한 것: "테이블 앞에 놓인 카드에도 적용".
  - 그림 생성 무료 쿼터(하루 약 6장) 중 4장을 10-31에 썼다. 그만큼 쿠·아발론·달무티 초상화 일일 큐(`~/.claude/art-staging/portrait-queue.mjs`)가 밀렸다.
  - 페루도 컵 스킨은 화면 캡처로 확인하지 않았다(코드·tsc만).
  - 2D 페이지 배경 스킨, 블러프 룰렛 3D 카드 뒷면은 미적용.
  - 새 카드 게임은 CardBack에 `owner`를 넘기거나 TableScene 자리 안에서 HeldFan을 써야 스킨을 받는다.

## 🎥 3D 테이블 23종 — 1인칭 | 테이블 시점 + 내 캐릭터 — 2026-10-29 (커밋/푸시, 배포는 웹훅 자동)

"다른 게임도 동일하게, 게임 특색에 맞게" → 5 오이(아래 섹션)에서 만든 걸 공용화. 보드 파일은 안 건드리고 각 `*Table3D`에 두 줄만.
- `TableScene cameraKey="<game>-camera"`: 씬이 시점을 직접 관리(`managed` — 게임이 `firstPerson`/`selfBody`를 직접 넘기면 꺼짐, 5 오이가 그 경우). 캔버스 왼쪽 위 DOM 오버레이 `CameraOverlay`: "🎥 1인칭 | 🪑 테이블" 선택 + 1인칭일 때 "🙋 이름 (나) · sub · tag"(1인칭에선 내 이름판/태그가 안 그려지니까). 기본 1인칭, 게임별 localStorage.
- `selfView={ held?, mood?, pitch? }`: 내 몸이 쥘 것. 기본은 내 자리 mood·빈손(무릎). 1인칭에서 held가 있으면 카드를 놓는 mood는 rest로. 내 몸은 `out`(탈락)도 반영.
- 게임별: 장수만 아는 카드 게임(뱅·달무티·운명전쟁39·로스트 시티·텔레파시) = 내 장수만큼 뒷면 부채(앞면은 2D 손패 칸). 쿠·러브레터는 내 카드가 이미 내 앞에 세워져/펼쳐져 있어 빈손으로 내려다봄. 쥐쥐·칩/주머니·주사위·사회추리 게임은 빈손. 달무티 = 더미 맨 위 패를 낸 사람 이름표(더미가 한 곳에 쌓여 전부 달면 겹침). **아발론 임무 카드는 누가 냈는지가 비밀이라 이름표 없음.**
- 코요테·라이어 게임은 TableScene이 아니라 자체 장면(`FirstPersonCamera` 직접 사용)이라 이번에 미적용.
- 페루도: 1인칭에서 내 컵(front)이 시야 한가운데를 막아 `selfView.frontShift=[0.5,0.05]`(오른손 옆) + pitch 0.06 (606b586). `frontShift`는 1인칭에서만 내 `front`를 옆으로 옮기는 공용 옵션.
- 확인: tsc/eslint 0, vitest src/games+constants 2753 통과(merge-defense 봇 시뮬 1건 플레이키, 재실행 64/64). 운영 1인칭 캡처 = 5 오이·달무티·페루도·쿠·마피아(나머지 19종은 공용 코드라 미캡처 — 게임 자체 DOM 오버레이와 왼쪽 위 버튼이 겹치는지 미확인). 테스트 가이드(캡처·링크·체크리스트): claude.ai/artifact/27FwsYRWH7PVoYM7NQhBfh.

## 🎥 5 오이 1인칭(라이어스 바식) — 내 캐릭터가 손패를 쥠 — 2026-10-29 (커밋/푸시, 배포는 웹훅 자동)

"라이어스 바처럼 1인칭" → 프리뷰 2회(카메라만 바꾼 렌더, 내 VRM 몸 + 큰 손패) 후 "5 오이만 이대로". 공용 키트엔 **켜는 옵션만** 추가, 다른 게임은 그대로.
- `TableScene` `firstPerson={ held, pitch, mood }`: 내 자리에 이름판 대신 내 VRM(`VrmPerson firstPerson`)을 `seatR - FPV_SEAT_IN(0.2)`에 앉힘. 내 태그·말풍선은 안 그림(보드 HUD로).
- `VrmPerson firstPerson`: three-vrm `vrm.firstPerson.setup()` (레이어 9=머리 없는 몸, 10=전체) + 주석 없는 머리 부품/이식된 머리카락은 이름(`HEAD_PART`)으로 10번 레이어로. 대기 동작(think/shrug, 카드를 내려놓음) 끔, 모자 portal 안 그림.
- `FirstPersonCamera fpv={ pitch }`: 눈 높이 1.5m, 가로 드래그 ±1.5rad, 마우스만 세로 드래그(터치 세로는 페이지 스크롤 유지), 놓으면 정면 복귀. 레이어 9 켜고 10 끔, overview(게임 끝)에선 반대로(머리 보임).
- 5 오이: 헤더 `CameraToggle`(localStorage `five-cucumbers-camera`, 기본 fpv). fpv면 캔버스가 프레임 전체, DOM 손패 대신 상단 띠(아래쪽은 손패와 휴대폰 사이트 플로팅 💬/🎲 버튼 자리라 위로 — 🥒 내 오이 · 장수 · 👇 손패 보기/👀 테이블 보기 — 이번 턴만 덮어씀, 기본은 내 차례=내려보기). `MyHand3D`: 왼쪽 위 큰 숫자 손패 그림(`cucumber-hand:` 캐시), 낼 수 있는 카드 금색 테두리+들림, 나머지 어둡게, 탭(드래그 8px 넘으면 무시) → `playCard`. 카드 크기는 화면비가 아니라 **손패 위치에서 보이는 폭**(fov·aspect, `FAN_DIST` 0.55, 여유 0.68)에 7장이 맞게 계산 + 숫자 순 정렬, 다음 카드가 폭의 40%(`UNCOVERED`)를 남겨 두 자리 숫자가 보임. (1차 배포 때 운영 PC 프레임이 588×654 세로형이라 '휴대폰용 큰 카드'가 걸려 숫자가 가려졌던 것을 이 방식으로 고침.)
- 확인: tsc/eslint 0, vitest 5 오이+shared three 74 + constants 68. 헤드리스(SwiftShader) 실제 코드 렌더 900×560·390×520 + 운영 프레임 크기 588×654·334×514 — 머리 안 보임, 손가락이 카드 쥠, 7장 숫자 모두 읽힘, 빛나는 카드 클릭 → `PLAYED c13/c15`. 프리뷰: claude.ai/artifact/PFetWCcHqWFUApVkgwX8SU.
- **후속(같은 날) — 두 시점 + 테이블 시점에도 내 몸 + 누가 낸 카드**: `CameraToggle`을 "🎥 1인칭 | 🪑 테이블" 두 칸 선택(aria-pressed)으로. `TableScene selfBody={held, mood}` = 테이블 시점에서도 내 VRM을 내 자리에(전신, 등받이가 카메라 아래를 막아 **스툴**), 5 오이는 `showMe`로 뒷면 부채를 쥠. 트릭 카드 아래 `ScreenSprite` 이름표(자리 색, 내 것 "나", 크기 fpv 0.5 / 테이블 0.85, 카드 간격보다 넓어지지 않게). 내 "🥒 내 오이" 3D 태그는 이름표와 겹쳐서 빼고 DOM(손패 칸 제목 / 1인칭 상단 띠)으로. 확인: 588×508·334×514 렌더.
- **안 한 것/남은 점**: 운영 실제 방 캡처·실기기 터치·FPS, 6인전(좌우 상대가 화면 밖 — 휴대폰은 맞은편만 보임), 탈락 후 내 몸(빈 손), 다른 23개 TableScene 게임 적용.

## 🗂 로그인 병합 후속 — 꽉 찬 저장칸 대기, 탭 두 개 경합 — 2026-10-29 (커밋/푸시, 배포는 웹훅 자동)

테스터 질문 3개 후속.
- **방 안에서 바뀌면?** 이미 즉시 반영됨: `useRoomCharacterSync`가 `character` 변경 시 presence `track` 재전송 → 같은 방 사람 화면도 재입장 없이 바뀜(코드 변경 없음).
- **저장칸 8개 꽉 참**: 밀려난 계정 캐릭터를 버리지 않고 `parked`(localStorage `bg_my_character_parked_v1` + `user_metadata.parkedCharacter`)로 보관. 내가 만든 캐릭터 위 호박색 배너 — "바꿔 입기"(`swapParked`, 지금 입은 것과 맞바꿈이라 어느 쪽도 안 사라짐) / "버리기"(confirm). 저장 캐릭터 하나 지우면 그 칸에 자동으로 들어감(`removeSaved`).
- **탭 두 개**: 실제 버그였음 — 게스트가 탭 B에서 저장하면 메모리상 옛 목록으로 탭 A 저장분을 localStorage째 덮어씀(로그인 무관), 로그인 병합도 각 탭 메모리 값으로 해서 나중 탭이 이김. 수정: `storage` 이벤트로 탭 메모리 동기화(캐릭터·저장목록·대기, 닉네임), 병합은 `navigator.locks`(`bg-my-character-sync`/`bg-game-nickname-sync`) 안에서 localStorage 기준으로 한 탭씩.
- **시나리오 테스트** [myCharacter.signIn.test.ts](./src/lib/character/myCharacter.signIn.test.ts): 가짜 auth + 공유 localStorage + 탭별 새 모듈(`vi.resetModules`) + FIFO 락으로 ①게스트 꾸미기→로그인→새로고침 ②두 탭 게스트 저장→한쪽 로그인 = 둘 다 계정에 ③꽉 찬 목록 대기→하나 삭제 시 입주. storage 리스너를 끄면 ②가 실패하는 것 확인. 주의: 탭 동작은 `act()`로 그 탭의 window를 잡고 실행해야 함(전역 stub 공유).
- 확인: vitest character/identity 29 통과, eslint/tsc 0. **실제 브라우저 + 실계정 로그인 시나리오는 안 함**(prod Supabase 테스트 계정 필요).

## 🔀 게스트 때 꾸민 프로필 → 로그인 시 잃지 않게 — 2026-10-29 (커밋/푸시, 배포는 웹훅 자동)

테스터 질문 "게스트로 꾸민 뒤 로그인하면 누가 이기나" → 기존엔 **계정이 이겨서 게스트 작업이 localStorage째 덮여 사라짐**(다음 새로고침 시점), 로그인(`router.push`) 직후엔 아무 동기화도 없었고, 계정이 비어 있으면 게스트 캐릭터가 계정에 안 올라감, 저장 목록은 계정에 키만 있어도 통째로 대체.
- 로그아웃 상태에서 바꾸면 표시: `bg_my_character_guest_edits_v1`(`{look,saved}`), `bg_game_nickname_guest_edit_v1`. 로그인 시(`SIGNED_IN` 리스너 + 로드 시 init) 순수 함수 `mergeGuestEdits`/`mergeGuestNickname`으로 병합.
- 규칙: 게스트가 바꾼 게 있으면 **게스트 쪽이 이김**, 밀려난 계정 캐릭터는 내가 만든 캐릭터에 "예전 계정 캐릭터"로 보관(같은 모습이 이미 있거나 8개 꽉 차면 생략). 저장 목록은 합집합(계정 먼저, id·모습 중복 제거, 8개 상한). 게스트가 닉네임을 지운 건 계정 닉네임을 지우지 않음. 표시가 없으면 예전처럼 계정 우선, 계정이 비면 기기 값을 업로드.
- 계정 반영은 `updateUser` 한 번, 실패하면 표시를 남겨 다음에 재시도. 프로필 게스트 안내 문구에 이 동작 설명 추가.
- 확인: vitest character/identity 26 통과(병합 테스트 4개 추가), eslint/tsc 0. 실제 로그인 흐름은 브라우저로 안 해 봄.

## 🙂 게스트도 프로필 수정 — 2026-10-29 (커밋/푸시, 배포는 웹훅 자동)

"프로필 수정 비로그인 게스트도 할 수 있게" → 헤더(SiteHeader) 프로필 버튼을 `configured && userId` 조건 없이 항상 표시. 게임 닉네임(`myNickname`)·3D 캐릭터/저장 캐릭터(`myCharacter`)는 원래 localStorage로 게스트를 지원했으므로 ProfileModal에서 그대로 동작.
- 게스트일 때: 랭킹 닉네임 칸·"공개 랭킹에도 같은 이름으로" 체크박스 숨김(계정 전용 `setPublicName`), 대신 "이 기기에만 저장 · 로그인하면 계정 저장/다른 기기/랭킹 닉네임" 안내 + /login 링크.
- /account 페이지는 그대로 로그인 전용.
- 확인: eslint 0, tsc(기존 proceduralSuites 외) 0. 화면 캡처는 안 함.

## 🥒 5 오이 3D — 테이블 트릭 카드 크게 — 2026-10-29 (커밋/푸시, 배포는 웹훅 자동)

"오이다섯개 테이블에 카드가 크게 보이게" → `CucumberTable3D`의 `Trick`: 카드 0.34×0.48 → **0.66×0.92**, 바닥에 눕히지 않고 내 쪽 모서리를 축으로 **0.75rad 세움**(`TRICK_CARD_TILT` — 낮은 카메라에선 눕힌 카드가 납작하게 눌려 보였음). 줄은 중앙에서 0.3 안쪽(내 🥒 태그에 안 가리게), 간격 상한 `tableR*1.4/(n-1)`, ImpactRing 1.1, 트릭 팻말 y 0.85(`f83180a`, `a2a7885`, `557b259`).
- 확인: tsc·5 오이 테스트 51개 통과. **운영 실제 방(봇 3) 캡처** 1280px·390px — 카드 숫자가 크게 읽힘.
- **남은 점**: 트릭 팻말("라운드 1 · 트릭 1/7")이 자동으로 내려와 카드 윗단에 살짝 겹침, 세운 카드가 맞은편 사람 몸통을 일부 가림(필요하면 `TRICK_CARD_TILT`를 0.55~0.6으로). 6인전·트릭 6장 캡처는 안 함.

## 👥 같은 닉네임 구분 · 랭킹 닉네임 맞추기 · 자동 입력 안내 — 2026-10-28 (커밋/푸시, 배포는 웹훅 자동)

테스터 질문 3개 반영.
- **같은 이름**: 새 [uniqueNames.ts](./src/games/shared/room/uniqueNames.ts) `withUniqueNames` — 48개 온라인 게임 전부의 presence sync(`setOccupants(Object.values(raw).flat())`)에 끼움. 낮은 좌석이 이름 유지, 나머지 "상어 2/3"(이미 있는 이름은 건너뜀), 모든 클라이언트가 같은 presence로 같은 라벨 → 전송 데이터는 그대로. 채팅이 있는 28개 게임은 `senderName`을 `occupantsRef`의 내 라벨로(없으면 myName). 테스트 3개.
- **랭킹 닉네임**: 프로필 게임 닉네임 저장 시 "공개 랭킹에도 같은 이름으로" 체크(기본 켬) → `setPublicName` 호출(중복/규칙 위반이면 랭킹 닉네임 칸에 에러, 랭킹 이름은 그대로).
- **자동 입력 안내**: RoomNicknameField가 시작 이름(프로필 게임 닉네임/지난 이름)과 같은 동안 칸을 호박색 테두리 + "🏷️ '상어'(으)로 들어가요 — 프로필의 게임 닉네임이에요…" 문구.
- 확인: vitest room/identity 통과, eslint/tsc 0, 헤드리스 375px 입장칸 캡처 1장. 실제 두 기기 같은 이름 입장은 안 해 봄.

## 🏷️ 게임 닉네임 — 프로필에서 정하고 방 입장 때 자동 입력 — 2026-10-28 (커밋/푸시, 배포는 웹훅 자동)

"이름과 닉네임을 프로필에서 정하고, 게임 입장 시에도 동일하게" → 새 [myNickname.ts](./src/lib/identity/myNickname.ts) (`useMyNickname`): localStorage `bg_game_nickname_v1` + 로그인 시 `user_metadata.gameNickname`(계정 우선), 12자.

- 프로필(ProfileModal): 랭킹 닉네임 위에 "게임 닉네임" 칸(저장, 랭킹 닉네임이 있고 게임 닉네임이 없으면 "랭킹 닉네임과 같게"). 랭킹 닉네임(public_name, 공개·중복 불가)과는 별개.
- 방 입장(RoomNicknameField, 48개 게임 공용): 이름칸이 비어 있으면 게임 닉네임 → 없으면 마지막으로 쓴 방 이름으로 1회 채움. 방에서 다른 이름을 쓰면 "⭐ 기본 닉네임으로 저장" 링크(게스트도 이 기기에 저장). 꽃게 서바이벌(자체 입력칸, 10자)은 이름 없는 게만 게임 닉네임으로 시작.
- 확인: 헤드리스로 RoomNicknameField 자동 입력·"기본 닉네임으로 저장" 동작 확인(캡처 없이 값 검사). vitest identity/crab 70 통과, eslint/tsc 0. 실제 게임 로비 화면 캡처는 안 함.

## 💾 내가 만든 캐릭터 저장 — 2026-10-28 (커밋/푸시, 배포는 웹훅 자동)

"한번 만들어둔 건 저장할 수 있게" → `useMyCharacter`에 `saved`/`saveLook`/`removeSaved`. localStorage `bg_my_character_saved_v1` + 로그인 시 `user_metadata.savedCharacters`(계정 쪽이 우선, 로그인 전 저장분은 계정에 없으면 올림). 최대 `MAX_SAVED`=8, 이름 12자, **같은 이름으로 저장 = 덮어쓰기**. 검증 `sanitizeSaved`/`withSaved`(테스트 2개).

- UI: 꾸미기 패널 상단(미리보기 아래, sticky)에 이름 입력 + "💾 저장/덮어쓰기", 목록 맨 위 "💾 내가 만든 캐릭터 (n/8)" 카드(3D 썸네일, 누르면 입기, × 삭제는 confirm). 모바일 미리보기 h-40(sm:h-48)으로 낮춤.
- 확인: 헤드리스 375px로 꾸미기→이름 입력→저장→목록 복귀 흐름 실행, localStorage 저장·카드·썸네일·선택 표시 확인(1장). vitest character 20 통과, eslint/tsc 0.

## 🤲 3D 캐릭터 손 — 카드 실제로 쥐기 + 자연스러운 손가락 — 2026-10-28 (커밋/푸시, 배포는 웹훅 자동)

"손모양 자연스럽게, 인게임에서 카드를 실제로 잡은 것처럼" → 원인: 카드(`held`)는 가슴 앞 [0,1.07,0.46]에 떠 있고 팔은 만화 리그용 관절각(HOLD_ARMS)이라 VRM 긴 팔이 양옆으로 벌어져 손이 카드에 안 닿았음. 손가락은 4개가 같은 각도, 엄지는 관절 하나만.

- 새 [vrmHands.ts](./src/games/shared/three/vrmHands.ts): 차분한 무드에서 팔을 **2-bone IK**(월드 공간, VRM0/1 공통)로 배치 — 카드 들면 `cards` 그립(손바닥은 본인 쪽, 손가락은 카드 뒤, 손목은 부채 아래 모서리), 빈손이면 `lap` 그립(무릎 위 손바닥 아래). 손목은 손가락 방향+검지 방향 기저를 맞춰 회전. 제스처 무드(cheer/point/shock…)는 기존 채널 포즈, 둘 사이 ~0.3초 블렌드(`ikW`).
- 손가락: `fingerAngles`(검지→새끼 캐스케이드, 마디별 비율, 너클 펼침) + `thumbAngles`(엄지 3마디). 50단계 캐시로 프레임 할당 없음.
- 카드 위치 `HOLD_AT` [0,1.0,0.3]로 당김(어른 팔이 닿게). `LAP_MOODS` = rest/sad/slump/nervous/smug.
- 확인: 헤드리스 클로즈업 3회(전/IK 1차/손바닥 방향 수정) — 옆에서 손가락이 카드 뒤를 감쌈, 무릎 휴식 OK. vitest shared/three+character 41 통과(손가락 테스트 추가), eslint/tsc 0. prod 실제 게임 화면 캡처는 안 함. 남은 것: 엄지가 카드 앞면을 누르는 디테일, 제스처 중 손 모양.

## ✏️ 직접 꾸미기 — PC 우측 패널 / 모바일 전환 화면 — 2026-10-28 (커밋/푸시, 배포는 웹훅 자동)

"꾸미기는 스크롤을 내려야 해서 불편, PC는 버튼 누르면 우측 영역에, 모바일도 가능하면" → 새 [CharacterStudio.tsx](./src/components/profile/CharacterStudio.tsx)가 프로필 모달(ProfileModal)과 방 입장 "내 3D 캐릭터"(CharacterButton) 둘 다 담당.

- CharacterPicker를 목록(`CharacterPicker`) + 꾸미기(`CharacterCustomizer`, 상단에 미리보기 sticky)로 분리, 공통 상태는 `useCharacterEdit` 훅. 목록 위 "✏️ 직접 꾸미기" 버튼(예전 `<details>` 접기 대체).
- ≥1024px: Overlay `wide="xl"`(lg:max-w-5xl) 2단 — 왼쪽 프로필+목록(미리보기는 숨김, 캔버스 1개 유지), 오른쪽 꾸미기 패널 sticky + 자체 스크롤. 그 미만: 꾸미기가 목록을 대체, "← 캐릭터 목록"으로 복귀. 새 훅 `useMediaQuery`.
- 확인: 헤드리스로 1366px·375px 캡처 각 1장(우측 패널/전환 화면, 가로 넘침 0). eslint/tsc 0. 실제 prod 화면 캡처는 안 함.

## 🏆 공개 랭킹에 내가 고른 캐릭터 얼굴 — 2026-10-27 (커밋/푸시, SQL은 10-28 사용자 실행 완료)

- **10-28 갱신**: 사용자가 합친 SQL(player_stats → game_champions)을 prod에서 실행. 첫 시도는 game_champions 부분만 돌아 `p.public_portrait does not exist` → game_champions.sql도 컬럼을 직접 추가하게 고침(c7fcc44). 재실행 후 anon 프로브: `public_game_board` 응답 OK, `public_portrait` 컬럼 존재, `set_my_public_portrait`는 anon 거부(42501 = 설치됨). 패치노트 v1.108.0(랭킹 얼굴 + 이번 달 1위 칩) 추가.

"공개 랭킹은 내가 프로필에서 고른 게 나오게" → /stats 공개 랭킹 3개 RPC(`public_leaderboard`·`public_metric_leaderboard`·`public_bot_level_board`)가 `public_avatar_url`(업로드 사진)만 내보내고 있었음. 이제 `coalesce(public_portrait, public_avatar_url)` — 캐릭터 초상화 우선, 없으면 예전 업로드 사진.

- `public_portrait` 컬럼 + `set_my_public_portrait`를 game_champions.sql에서 **player_stats.sql로 옮김**(랭킹이 쓰니까). game_champions.sql은 player_stats.sql 뒤에 실행(기존 안내 그대로).
- **prod 상태(10-27 anon 프로브)**: `public_portrait` 컬럼 없음, `set_my_public_portrait`/`public_game_board` PGRST202 → **사용자가 Supabase SQL Editor에서 `supabase/player_stats.sql` → `supabase/game_champions.sql` 순서로 실행해야** 보임. 실행 후 각자 브라우저(`PublicPortraitPublisher`)가 다음 접속 때 초상화를 올림(실패한 시도는 스탬프 안 남겨 재시도).
- 확인: 로컬 embedded-postgres로 player_stats.sql 2회 + game_champions.sql 실행 → 랭킹·게임 보드에 초상화 data URL 나옴. 클라이언트 코드 변경 없음. 패치노트는 prod에 보일 때 추가.

## 🖼 프로필 이미지 업로드 제거 — 2026-10-27 (커밋/푸시, 배포는 웹훅 자동)

"이미지 업로드는 필요 없다, 기능 삭제" → 프로필 사진 = 3D 캐릭터 초상화만.

- 삭제: ProfileModal의 파일 선택·업로드 버튼·"내 3D 캐릭터/업로드한 사진" 토글, `profileStore.uploadAvatar`(+용량/형식 검사), `myCharacter`의 `photoMode`/`setPhotoMode`(localStorage `bg_profile_photo_mode_v1`는 더 안 읽음). `useProfilePhoto`는 초상화만, `PublicPortraitPublisher`는 초상화 있으면 게시·없으면 지움.
- 남긴 것: 예전에 올린 사진(`profiles.avatar_url` → `user_profiles.public_avatar_url`)이 공개 랭킹(/stats)·1위 칩(초상화 없을 때)에 계속 나오므로, 그런 계정에만 "예전에 올린 사진 삭제" 버튼. `/api/profile/avatar`는 이제 `avatarUrl: null`(삭제)만 받음. Supabase `avatars` 버킷·정책·컬럼은 그대로(DB 변경 없음).
- 확인: eslint/tsc(기존 proceduralSuites 외) 0, vitest character/constants/store 86 통과. 화면 캡처는 안 함.

## 💄 캐릭터 메이크업 — 같은 모델도 다른 사람처럼 — 2026-10-27 (커밋/푸시, 배포는 웹훅 자동)

"프로필 캐릭터들이 눈코입은 똑같고 머리만 다르다, 메이크업처럼 다르게 꾸밀 수 있나 + 설명을 지금 모습에 맞게" → 21명 프리셋이 VRM 12개를 나눠 쓰고(남자 6명이 전부 seed-san), `eyes/face/mark/lip` 필드는 VRM에 반영 안 되던 상태였음.

- **새 모듈 [vrmMakeup.ts](./src/games/shared/three/vrmMakeup.ts)**: VRoid 얼굴 텍스처는 모든 export(클래식·three-vrm-girl·pixiv-sample)가 같은 UV 배치 → 고정 UV에 캔버스로 아이섀도·블러셔·립 틴트(multiply)·점/주근깨를 칠함(텍스처+메이크업 조합별 공유, refcount로 해제). 렌즈 = EyeIris 회색화 후 색 곱하기, seed-san은 눈 아틀라스의 홍채 타원만 재채색(`SEED_IRIS`). 눈매 = Fcl_BRW/EYE 모프를 상시 오프셋(블링크·강한 표정 때 0으로 페이드, 매 프레임 expression update 전에 되돌림 `liftMorphs`/`holdMorphs`), seed-san은 자체 모프명. 눈 크기 = raw 눈 뼈 scale, 얼굴형 = raw head scale.x. 눈썹은 염색한 머리색을 따라감.
- **데이터**: `PersonLook`/`AvatarProfile`에 `iris`·`blush`·`shadow`(hex, 없으면 메이크업 없음). 프리셋 21명 재구성 — 같은 모델 공유 시 눈매·렌즈·메이크업이 모두 다르게(테스트로 강제), 일부는 옷/머리 graft(서아=고스 코트, 현·이안=서로 머리 교환). `concept` 설명은 실제 보이는 헤어·눈매·렌즈·메이크업으로 다시 씀. `PORTRAIT_RIG` 3으로 올려 저장된 초상화 재촬영.
- **프로필 UI**: 직접 꾸미기에 "💄 얼굴 · 메이크업" — 눈매·얼굴형·렌즈·아이섀도·립·블러셔·포인트. seed-san은 섀도/블러셔/립/점 안 보여서 숨기고 안내 문구.
- **확인**: 헤드리스 얼굴 클로즈업 2회(조정 전/후)로 칠 위치·렌즈·섀도 확인. seed-san `cheek` 모프는 안 보여서 블러셔 대상에서 뺌. vitest character/constants/shared three 106+ 통과, eslint 0, tsc(기존 proceduralSuites 외) 0. 실제 프로필 화면·게임 테이블 캡처는 안 함.
- **남은 것**: 코 모양은 못 바꿈(모프 없음). 더 다른 얼굴이 필요하면 클래식끼리 Face 메시를 graft하고 모프를 이름(Fcl_*)으로 동기화하는 방식이 가능(이번엔 안 함). 이미 프리셋을 골라 저장한 사용자는 저장된 옛 look 그대로(새 렌즈/섀도 없음, 눈매·립·점은 이제 보임) — 프리셋을 다시 누르면 새 모습.

## 🃏 3D 한 프레임 통합 — 카드게임 6종 — 2026-10-28 (커밋/푸시, 배포는 웹훅 자동)

텔레파시에 이어 "분리된 게임 리스트" 조사 → 전/후 프리뷰 캔버스(6보드) → "있는 내용 전부 변경후로". 노 땡스·포 세일·하나미코지·러브 윈즈 올·그리드 포커·달무티를 5 오이 방식으로: `Frame3D` 대신 전용 프레임, 캔버스는 아래를 비우고 그 자리에 내 손패+조작 DOM 오버레이, 3D와 중복되는 2D 칸은 `!is3D`로 숨기거나 "📋 … 펼치기" 토글. 2D 화면은 같은 조각(상수로 추출)으로 예전 그대로.

- 노 땡스: 손패 칸 = 내 칩·카드 묶음 + 노 땡스/가져오기. 2D 경매 칸 숨김, 플레이어 줄 토글(`stripOpen`). 2D 코인/카드 비행 FX는 3D에선 큐에 안 넣음(3D `lastEvent`가 대신).
- 포 세일: 프레임 h 576/636/676, 손패 칸 236/244 — 매입: 내 부동산(sm)+입찰 스테퍼/입찰/포기(`bidControls`), 판매: 제출 카드(`submitCards`), 정산 결과(`saleResult`)는 캔버스 위 카드. 매물 줄·내 부동산 칸 숨김, 입찰 현황 토글(`bidsOpen`). 비행 FX 3D 제외.
- 하나미코지: 손패 칸 256/264 — 부채꼴(sm, `renderHandFan(compact)`)+행동 4개 소형 버튼+확정, 뽑기 버튼. 선물/경쟁 응답(`offerBlock`)은 캔버스 위. 상대 쪽 숨김, 게이샤 판 토글(`geishaOpen`).
- 러브 윈즈 올: 하단 칸 300/320(스크롤 가능, `mt-auto`) — `myCards`+`actionControls`(베팅/선언). 상대 손패 줄 숨김. 위쪽 PlayerHeader 줄(콜아웃 배지)은 유지.
- 그리드 포커(부분 통합): 프레임 680/760/800, 하단 390/440 — 이번 카드+내 5×5 판(`myBoardGrid`), 제출 단계엔 라인 목록(`lineButtons`). DealerReveal·2D 내 판·제출 칸 숨김, 상대 판 토글(`opponentsOpen`). 순위 띠는 유지.
- 달무티: 프레임 596/676/716, 손패 칸 236/244 — "찌그러지는 줄"(각 칸 basis-16→최소 18px, 카드가 오른쪽 이웃 밑으로)+패스/내기·세금 반환(`handActions`). 계급표 토글(`scoreOpen`). 계급표 접힘 상태에선 `PassBubble` 대신 `BubbleTimer`(1초 뒤 clear — 3D `passing` 표시 유지용).
- 확인: tsc·eslint 0, 6게임 테스트 339개 통과. **운영 실제 방(봇 채움) 390px 캡처 6개** — 모두 3D 프레임 한 장 안에 손패+조작, 가로 넘침 0. 캡처로 잡은 것 2건 수정(`3d9d57a`): 그리드 포커 `lineButtons`가 빈 칸 판에서도 계산돼 'reading kind of null' 크래시 → `renderLineButtons()`로 제출 단계에서만, 포 세일 입찰액·±버튼이 라이트 모드에서 어두운 띠 위에 안 보임 → 3D에선 light: 덮어쓰기 제외. 그리드 포커 5번째 줄 잘림 → 하단 432/484로(`d8e3387`).
- **안 한 것**: 판매/선물·경쟁 응답/선언/세금 반환 단계 캡처, 6인전, 실기기 터치. 러브 윈즈 올은 레이즈 패널이 길어 하단 칸 안에서 스크롤해야 함. 그리드 포커·러브 윈즈 올의 일부 패널은 라이트 모드에서 흰 패널로 보임(기존 2D와 같은 스타일).

## 📡 텔레파시 3D — 오이다섯개식 한 프레임 통합 — 2026-10-27 (커밋/푸시, 배포는 웹훅 자동)

"텔레파시도 오이다섯개처럼 아래에 분리하지 않고 합치기" → 프리뷰(디자인 캔버스, 지금 vs 통합안 3보드) 확인 후 구현. 텔레파시는 3D를 얹고 2D 가운데 무대(같은 더미 중복)·버린 카드 칸·손패 패널(번뜩임/다시 맞추기 설명 상자 포함)을 전부 아래에 남긴 덧붙이기형이었음.

- `TelepathyBoard`: 가운데 무대 내용을 `syncStage`/`flowStage`/`eventStage`(실수·번뜩임 공개·레벨 통과)/`voteOverlay`로, 손패 패널을 `safeBanner`/`handChips`/`holdButton(compact)`/`autoSwitch`/`holdHint`/`starPanel`/`resyncPanel` 상수로 쪼갬 — 2D는 예전 그대로 조립.
- 3D(`is3D`): `Frame3D` 대신 전용 프레임(h 556/616/656). 캔버스는 아래 196/204px를 비우고 그 자리에 손패 오버레이(⚡/🖐 버튼 · 꾹 누르기 카드 compact · 다음 카드 칩, 머리줄에 🤖 자동 스위치·"나만 남음" 안내). 캔버스 위: 진행 알약(이번 레벨 n/m장 + ⏱), 아래쪽에 번뜩임/실수 버린 카드 칩 + "✋ 내려는 중!"/"⏩ 남은 사람" 배너. sync는 캔버스 영역 위 카드, 실수·번뜩임 공개·레벨 통과는 프레임 전체를 덮는 반투명 카드(스크롤 가능), 투표는 기존 inset-0 오버레이가 프레임을 덮음. 설명 상자는 "❔ 도움말 펼치기"(`helpOpen`) 아래로. `RewardTrack compact`(통과 보상 줄 숨김).
- 확인: tsc·eslint 0, 텔레파시 19 + 패치노트 68 테스트. **운영 실제 방(봇 2) 캡처** 390px·1280px — sync 카드가 테이블 위에, 진행 알약·꾹 누르기 카드·⚡/🖐 버튼이 한 프레임 안, 가로 넘침 0, 도움말 펼치기 동작. 390px에서 "다시 맞추기 2"·도움말 문구 줄바꿈 → 칸 폭·문구 조정(`78da43b`).
- **안 한 것**: 실수·레벨 통과·번뜩임 투표 오버레이 실캡처(코드상 프레임 전체를 덮는 카드), 6인전, 실기기 터치. 페이지 머리(사이트 헤더·제목·레벨 막대)가 위 460px를 차지해 모바일 첫 화면엔 프레임이 반쯤만 보이는 건 5 오이와 같음.

## 🔉 3D 캐릭터 감정 음성 — 중요한 순간에만 — 2026-10-27 (커밋 c588352/푸시)

- **요청**: "AI 봇 음성이 거의 1턴마다 나온다, 정말 중요한 순간에만". 원인: 각 게임 3D 테이블이 매 턴 mood를 `smug`(제출 후)·`nervous`(대기)·`shrug`(패스) 등으로 바꾸고, [characterVoice.ts](./src/lib/audio/characterVoice.ts)가 감정 mood 변화마다 말했음(간격 테이블 0.9초/좌석 2.5초).
- **변경**: `VoiceGate`가 `SPOKEN`(cheer·shock·sad·slump)만 소리 내고, 나머지(smug·nervous·shrug·clap·raise·point·laugh)는 **말풍선 캡션만**. 간격 테이블 14초 / 좌석 30초 / shock·cheer는 6초 뒤부터 끼어들기 가능. 캡션 빈도는 그대로(TableScene 2.5초 제한).
- **검증**: characterVoice 테스트 11개(새 게이트 규칙 포함)·패치노트 테스트 통과. 실제 소리는 사람 귀로 확인 안 함. 여전히 잦다고 하면 `VOICE_GAP` 숫자나 `SPOKEN` 집합만 조절하면 됨.

## 🥒 5 오이 3D — 내 손패를 테이블 프레임 안에, 중복 트릭칸·점수판 정리 — 2026-10-27 (커밋/푸시, 배포는 웹훅 자동)

"2D/3D 분리 전수조사 + 5 오이 내 테이블에 카드가 보이게" → 조사 결과 31개 `useBoardView` 게임 중 10개(5 오이·포 세일·최고의 투자·그리드 포커·하나미코지·러브 윈즈 올·노 땡스·쇼미더코인·소환사의 협곡·운명전쟁39)는 3D를 **위에 얹기만** 하고 2D를 전부 남긴 "덧붙이기형"(3D 분기 1개, 2D 숨김 0개). 코요테·페루도·스플렌더 등은 3D가 2D 보드를 대체. 5 오이를 먼저 대체형으로 바꿈(`ead82a6`, `1ed5931`).

- `FiveCucumbersBoard`: `is3D`일 때 `Frame3D` 대신 전용 프레임(h 516/616/656) — 캔버스는 아래 112/136/148px를 비워 두고, 그 자리에 **내 손패를 DOM 오버레이**(`handFan`, 2D와 같은 CardFace·합법 카드 금색, 3D에선 `flex-nowrap`). 2D 트릭 칸 숨김, 점수판은 "📋 점수표 펼치기" 토글(`scoresOpen`). 2D DOM 연출(`FlyingPlayedCard`/`FlyingCucumber`)은 3D에선 큐에 안 넣고, 3D로 바뀌면 남은 이벤트를 비움(3D `FlyIn`이 대신). 홀드 진행바·스킵은 그대로.
- 확인: tsc(기존 오류만)·eslint, 5 오이+패치노트 테스트 119개. **운영 실제 방(봇 3) 캡처** 390px·1280px — 손패 7장이 테이블 아래에 보이고 점수표 토글 존재. 390px에서 부채꼴 끝 카드가 프레임 밖으로 17px 잘려 pb-6로 수정(`1ed5931`).
- **후속(`3a7a3e1`, `f9e5c44`) — "카드가 각자 자기 쪽으로 놓여 안 보인다"**: `CucumberTable3D`의 `Trick`이 이제 낸 카드를 모두 **내 자리 기준으로 똑바로**(`angleOf(viewerSeat)`) 낸 순서대로 왼→오 한 줄에 놓음(0.34×0.48, 간격은 `tableR*1.5/(n-1)`로 제한, 중앙에서 살짝 안쪽 −0.04 — 내 🥒 태그에 안 가리게). FlyIn 출발점은 각 낸 사람 자리 그대로. 운영 캡처(1280px, 트릭 4장) 확인. 남은 점: 내가 트릭을 이기면 내 말풍선("이 트릭은 내 거!")이 홀드 동안 줄 위에 겹침.
- **안 한 것**: 나머지 덧붙이기형 9게임, 실기기 터치 손맛, 라운드 종료 장면 캡처, 6인전 배치(카드 6장 간격).

## 🧍 옛 만화풍 캐릭터 완전 제거 — 2026-10-27 (커밋/푸시)

"이전 캐릭터가 프로필·게임 접속 시 같이 보인다" → 원인: `VrmPerson`이 VRM을 받는 동안(실패 시엔 계속) 옛 만화풍 `SeatedPerson` 몸을 대신 그렸음. 이제 그 사이엔 **빈 의자 + 들고 있는 카드 + 이름표(children)만** 보이고(`PLACEHOLDER_SEAT_Y = 0.5`, 의자는 `Chair` 함수로 분리), 프로필 미리보기(`CharacterPreview3D`)는 "캐릭터 불러오는 중…" 문구.

- **코드 삭제**: `SeatedPerson.tsx`의 만화 몸·머리카락·얼굴 그리기 코드(~650줄) 삭제 — 파일엔 공용 어휘(PersonMood·POSES/TABLE_POSES·FACES·blinking·Hat·holdPose·SeatedPersonProps·STRONG_MOODS)만 남음. 아무도 안 쓰던 `RealisticPerson.tsx`·`glamFace.ts`·`kpopEyes.ts` 삭제. `TableScene`은 항상 `VrmPerson`(`personStyle`은 카메라·좌석 배치 옵션으로만 남김, 현재 미사용).
- **남은 것**: 블러프 룰렛(`src/games/bluffRoulette/Character.tsx`)은 리볼버 연출이 붙은 게임 전용 만화 캐릭터라 이번엔 그대로 둠. `avatar.ts`의 hairStyle/face/eyes/build/mark 필드도 저장 호환 때문에 유지(VRM엔 반영 안 됨).
- 확인: tsc(기존 proceduralSuites 오류 외) 0, eslint 0, vitest shared/three + character 38/38. 화면 캡처는 안 함.

## ⚠️ 비로그인 기록 "언제 사라질지 모름 / 다른 브라우저에서 로그인하면 사라짐" 명시 — 2026-10-27 (커밋/푸시)

/stats `GuestWarning`, 게임 끝 `MatchRecordCard` 경고, 새 랭킹 모달(`GameChampionChip`, 비로그인일 때 금색 경고 + "이 브라우저에서 로그인하기")에 같은 내용을 명시. 사실 관계: 비로그인 기록(IndexedDB `statPending` userId null)은 **그 브라우저에서 로그인할 때만** 계정으로 합쳐지고, 다른 브라우저에서 로그인하면 넘어가지 않음. 랭킹 모달 경고는 game_champions.sql 실행 전엔 칩이 숨겨져 안 보임. eslint 0, 화면 확인 안 함.

## 👑 게임별 "이번 달 1위" 칩 + 캐릭터 초상화 랭킹 — 2026-10-27 (커밋/푸시, **SQL 실행 필요**)

"캐릭터 이미지와 함께 '이 게임은 내가 이번 달 1위' / 전체 랭킹" 요청. 공통 게임 페이지(`src/app/games/[gameId]/page.tsx`) 제목 아래에 `GameChampionChip` — 이번 달(KST) 그 게임 1위의 캐릭터 초상화 + 닉네임, 내가 1위면 금색 "👑 이 게임은 내가 이번 달 1위!". 누르면 `Overlay` 모달 **이번 달 / 전체** 탭(상위 10 + 내 줄, 초상화·승·판·승률). 1인 게임(`players.max === 1`)은 제외.

- **SQL `supabase/game_champions.sql`(사용자 실행 필요, player_stats.sql 다음에)**: `user_profiles.public_portrait`(≤30k자 data URL, webp/png/jpeg만) + `set_my_public_portrait()`(authenticated만) + `public_game_board(game, 'month'|'all', limit)`(anon 가능). 이번 달은 `player_match_log.recorded_at`(서버 시각) 기준 KST 월, 전체는 `player_game_stats`. 정렬은 /stats 기본과 같음(승 수 → 승률, 봇 판 포함). 실행 전에는 RPC가 PGRST202 → 칩이 아예 안 보임.
- **초상화 공개**: `PublicPortraitPublisher`(ProfilePhoto.tsx, SiteHeader에 마운트) — 로그인 상태에서 프로필 사진이 3D 캐릭터면 그 초상화를 72px webp로 줄여 올리고, 업로드 사진 모드/캐릭터 없음이면 지움(업로드 사진은 원래 `public_avatar_url`로 나감). 계정+초상화 키당 기기에서 한 번만 전송(localStorage `bg_public_portrait_sent_v1`).
- 확인: eslint 0, tsc는 기존 `proceduralSuites.test.ts` 오류 2개 외 0, vitest `gameChampions.test.ts` 2/2. SQL은 로컬 embedded-postgres로 실행 — 이번 달/전체 순위 차이, 잘못된 이미지·anon 쓰기 거부, 재실행 확인. **브라우저 화면 확인은 안 함**(운영에 SQL이 없어 칩이 렌더되지 않음). 패치노트는 SQL 실행 후 실제로 보일 때 추가할 것.

## 🏁 코요테 마지막 승부 5초+ 유지 + 📜 이전 판정 기록 — 2026-10-26 (커밋/푸시, 배포는 웹훅 자동)

"마지막 승부의 결과가 5초 이상 보이게 + 이전 결과를 볼 수 있는 기능" 요청. 원래는 마지막 판정에서 엔진이 곧장 `gameOver`가 되어 보드가 즉시 순위 화면으로 바뀌었다(테이블·판정 패널을 아예 못 봄).

- **마지막 승부**: `CoyoteBoard`가 `gameOver`여도 `rankingOpen`이 false면 일반 판정과 같은 테이블+판정 패널(머리에 "🏁 마지막 승부")을 그린다. `FINAL_SHOWDOWN_HOLD_MS = 5000` 뒤에야 "🏆 최종 순위 보기"가 눌림(버튼이 5초 동안 차오르는 `coyote-hold-fill`). 스킵은 연출만 건너뛰고 5초 제한은 그대로. 자동으로 넘어가지는 않음. 순위 화면에 "🏁 마지막 승부 다시 보기" 버튼.
- **판정 기록**: 엔진 `CoyoteState.resolutionHistory?: RoundResult[]`(`roundNumber`·`resolution`·`heartsAfter`) — 판정마다 추가(락스텝이라 모든 기기가 같음, optional이라 옛 상태도 유효). 새 `CoyoteHistory.tsx` 모달(최신순, `FormulaBar` 재사용, 모든 좌석 카드, 내 카드 강조, 탈락 표시). 헤더 "📜 기록 N" + 순위 화면 "📜 판정 기록 N판". 헤더 버튼은 `whitespace-nowrap` + 줄바꿈 허용(390px에서 4개라 글자가 깨졌음).
- 확인: tsc/eslint 0, vitest 코요테 77/77(기록 테스트 1개 추가). 헤드리스 Chromium 390px — 2.5초에 버튼 비활성·순위 안 보임, 5.7초에 활성 → 클릭 시 순위 → 기록 모달, 가로 넘침·페이지 오류 없음. 운영 화면 캡처는 안 함.
- 주의: 로비 미리보기 녹화(`scripts/poster-videos/record.cjs`)가 "결과 확정하고 계속하기"를 누르는 흐름이면 코요테는 이제 "🏆 최종 순위 보기"를 먼저 눌러야 함(녹화 재실행 시 확인).

## 🐺 코요테 판정 패널에 "내 숫자" 카드 — 2026-10-26 (커밋/푸시, 배포는 웹훅 자동)

"코요테 외치면 '판정 승리' 아래에 내 숫자를 내려서 확인할 수 있게" → `CoyoteBoard.tsx`의 `ShowdownMatchup`에 `viewerRole`/`myCard` 추가. 판정이 찍히는 순간(`verdictShown`) 내가 외친 사람/선언자면 내 칸의 "✓ 판정 승리"·"💔 하트 −1" 바로 아래, 둘 다 아니면 대진표 아래 줄에 "👀 내 숫자" + `CardFace`가 위에서 떨어져 내려옴(`globals.css` `coyote-my-card-drop`). 내 카드가 "?"였으면 바뀐 카드를 보여줌. 탈락자(카드 없음)는 안 보임. 2D 패널 기준(3D 보기에서도 같은 하단 패널이라 똑같이 보임).

- 확인: tsc/eslint 0, vitest 코요테 76/76. 실제 컴포넌트 rolldown 번들 + 헤드리스 Chromium 390px로 외친 사람/선언자/구경자 시점 스크린샷 — 가로 넘침 없음. 운영 화면 캡처는 안 함.

## 1. Executive Summary

### 목표
**보드게임 허브** — 여러 보드게임을 한 곳에서 플레이하고, 게임 결과에 연동된 "내기(베팅)" 정산까지 관리하는 Next.js 웹앱. 완전 오프라인 동작(IndexedDB 1차 저장소)이 기본이고, Supabase Realtime은 온라인 대전 게임들의 통신 수단으로만 쓰이는 선택적 레이어. 실제 배포 URL: **https://board-game-tau-navy.vercel.app**

### 현재 카탈로그 규모 (2026-11-01 기준, `src/games/registry.ts`/`playableGames.tsx` 실측)
| 항목 | 수 |
|---|---|
| `GAME_REGISTRY` 전체 카탈로그 | 62종 |
| 실제 플레이 가능(구현 완료, `playableGames.tsx`에 동적 등록) | 51종 (`playable: true`) |
| 준비중(카탈로그엔 있으나 미구현) | 11종 (`playable: false`) |
| Vitest 테스트 파일 | 129개(`src/**/*.test.ts`) — 케이스 수는 `npx vitest run` 결과를 참고(10-29 기준 src/games+constants만 2,753개) |

최근 굵직한 흐름(10-21~11-01): 3D 테이블 공용 키트(TableScene) + VRM 캐릭터 + 1인칭 시점, 프로필·캐릭터 꾸미기, 🎨 스킨, 라이어 게임 서버 판정(secureMatch). 10-24 이전 신규 게임(체스·컬링·알까기·와르르 타워·단어 마천루·여관 난투·갓생 플래너·라이어·텔레파시·큐플레이 등) 기록은 [docs/history.md](./docs/history.md) "Phase 30+" 아카이브에 있다.

---

## 2. 현재 시스템 상태 및 구조

### 기술 스택 (`package.json` 실측)
| 항목 | 내용 |
|---|---|
| 프레임워크 | Next.js 16.2.12(App Router, Turbopack) + React 19.2.4 + TypeScript(strict) |
| 스타일 | Tailwind CSS v4(CSS-first, `tailwind.config.js` 없음 — 새 키프레임은 항상 `globals.css`에 추가) |
| 클라이언트 상태 | Zustand ^5.0.14(`useBettingStore`) |
| 주 데이터베이스 | 브라우저 IndexedDB(`idb` ^8.0.3 래퍼) — 완전 오프라인 동작 |
| 클라우드(선택) | `@supabase/supabase-js` ^2.111.0 — Realtime(Broadcast/Presence)이 온라인 대전 게임들의 통신 수단 자체, Postgres 테이블(기기 식별 힌트·내기 기록 백업·`active_rooms`)은 선택 |
| 배포 | Vercel, GitHub(`gud1107/BoardGame`) 웹훅 자동 배포 — **`vercel deploy --prod` 수동 실행 금지**(위 "배포 프로토콜" 섹션 참고) |
| 테스트 | Vitest(엔진 유닛 테스트) — **UI 컴포넌트 테스트 인프라 없음**(jsdom 미설치, `vitest.config.mts`가 `environment: "node"`) |

새 의존성이 필요할 것 같으면 먼저 확인받을 것 — 이 프로젝트는 반복적으로 "이미 있는 도구로 충분한데 새 의존성을 안 늘린다"는 판단을 해왔다([docs/architecture.md](./docs/architecture.md) 참고).

### 핵심 파일 구조
표준 게임 모듈 레이아웃(신규 게임이 지켜야 할 계약)은 **[ARCHITECTURE.md](./ARCHITECTURE.md)**가 단일 출처. 여기는 스냅샷만:
```
src/
  app/                  Next.js 라우팅 (대시보드, /games/[gameId] 스테이지 머신, /patch-notes, /admin/stats 등)
  components/           범용 UI + 내기 사이드바 + 로비(DesktopDashboard.tsx 등)
  games/
    registry.ts          GAME_REGISTRY(순수 데이터, 62종)
    playableGames.tsx     GameId → 동적 import 매핑(51종 실제 등록)
    <game-id>/            표준 레이아웃(ARCHITECTURE.md §2) + 게임별 추가 파일
  lib/                  db(IndexedDB) / betting(정산 원장) / identity(기기·플레이어 매핑) / supabase / rng(공유 시드 난수)
  store/bettingStore.ts  Zustand — 내기 세션 오케스트레이션
public/games/<gameId>.*  게임 카드 표지 이미지(일부는 퍼블리셔 소유 박스 표지 원본 — 라이선스 검토 필요 항목, §3 참고)
boardGameRule/*.md       게임별 공식 룰 원문 — 파일명이 아직 게임마다 표기가 제각각(한글/영문 혼재, kebab-case 통일 미완료)
docs/                    개발자 심화 문서 — 아래 표 참고
```
전체 디렉토리 규칙/계층 의존 방향은 [docs/architecture.md §5](./docs/architecture.md#5-디렉토리-구조-및-계층-규칙) 참고.

### 현재 작동 중인 핵심 로직
- **온라인 대전 게임들은 공유 락스텝(lockstep) 패턴**: 방장이 시드를 브로드캐스트 → 모든 클라이언트가 동일 초기 상태를 독립 계산 → 이후 액션은 `EngineAction`으로 브로드캐스트해 같은 순수 리듀서로 재생. 서버 권위 엔진 없음(의도적 설계, [docs/architecture.md §2](./docs/architecture.md#2-온라인-대전의-신뢰-모델-문서화된-의도적-한계)). 재접속 복원과 이탈 투표 기반 봇 대체([[bot-takeover-feature-decisions]])도 대부분의 온라인 게임에 공통 적용돼 있다 — 신규 게임을 만들 때 이 패턴을 재사용할 것. 공유 `roomManager.ts` 같은 것은 **없다**(게임마다 방 생성/입장 플로우가 개별 구현돼 있음, `CreateRoomModal` 공용 컴포넌트도 없음).
- **파생 상태(derived state) 금지 원칙**: 같은 사실을 두 상태로 따로 표현하지 않는다([docs/architecture.md §1.4](./docs/architecture.md#14-파생-상태derived-state-금지-원칙)) — 순위/승자 등은 항상 `computeRankings(state)`류 함수로 매번 파생 계산.
- **"엔진 테스트 100% 통과 ≠ UI 정상"**: `<Game>Board.tsx`는 자동 테스트 대상 밖이다. 시각적/레이아웃 버그를 코드 리뷰만으로 "고쳤다"고 단정하지 말 것 — 실제로 이 사각지대에서 발생한 버그가 여러 건 있다([docs/troubleshooting.md](./docs/troubleshooting.md), [[react-forced-remount-sibling-key-collision]] 등). 캐시된 Playwright Chromium으로 실제 화면을 스크린샷/터치 시뮬레이션까지 검증하는 것이 최근 세션들의 표준 관행이 됐다.
- **요청 브리프의 파일 구조 전제가 실체와 다른 경우가 매우 잦다**(이 저장소에서 반복 관찰된 패턴, memory의 "premise-mismatch" 계열 기록 다수) — 새 요청을 받으면 언급된 파일/컴포넌트가 실제로 존재하는지 먼저 확인할 것.

### 작업 규칙 (계속 지킬 것)
- 커밋은 기능 단위로 잘게 분리(conventional commits: `feat(game):`, `fix(game):`, `docs:` 등).
- 작업이 끝나면 커밋·푸시까지 따로 묻지 않고 진행한다(사용자 지시, 2026-10). 다른 세션의 커밋/푸시/배포가 진행 중일 때만 기다린다. 공유 git 인덱스에 다른 세션 파일이 올라가 있을 수 있으니 `git commit -- <경로>`로 내 파일만 커밋할 것. 배포는 `git push origin main`까지만 하면 자동으로 처리됨(§"배포 프로토콜" 참고).
- 작업 지시와 참조 문서(룰북 등)가 서로 다른 사실을 말하면, 룰북 원문 쪽을 채택하고 그 판단을 코드/문서에 명시적으로 남길 것.
- React Hooks 엄격 lint 규칙 유효(early-return 뒤 훅 호출 금지 / 렌더 중 ref 쓰기 금지 / effect 안 동기 setState 금지 — `sessionStorage` 복원 등은 lazy `useState` 초기화 함수로).
- `.clinerules.md`/`instructions.md`(저장소 루트)는 **Cline 전용 자동화 규칙**(승인 없이 자동 커밋·배포 지시)이라 이 프로젝트의 실제 지침이 아님 — 계속 무시할 것. 실제 지침은 `CLAUDE.md`→`AGENTS.md`뿐.
- **여러 Claude Code 세션이 이 저장소를 동시에 쓰는 일이 실제로 잦다** — 세션 시작 시 `git status`/`git worktree list`를 먼저 확인할 것. 현재도 `boardGame-hot-photos`(`feat/hill-of-truth-evidence-photos`)와 `.claude/worktrees/deploy-memory-feast` 워크트리가 떠 있음. 커밋되지 않은 낯선 변경을 발견하면 임의로 지우지 말고 사용자에게 먼저 확인할 것.
- `next dev`/Turbopack이 이 머신에서 반복적으로 OOM 크래시할 수 있음([[dev-server-oom-environment-limit]]) — `tsc`/`eslint`/`vitest`는 상대적으로 안정적이니 먼저 그쪽으로 검증하고, `next dev`를 여러 번 재시도 루프에 넣지 말 것.

### 관련 문서
| 문서 | 언제 볼 것 |
|---|---|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 신규 게임 추가 시 지켜야 할 표준 계약 |
| [docs/README.md](./docs/README.md) | `docs/` 전체 색인 + 개발 명령어 |
| [docs/architecture.md](./docs/architecture.md) | "왜 이렇게 설계했는가" — 항상 유효한 현재 설계 원칙 |
| [docs/cloud-sync.md](./docs/cloud-sync.md) | 락스텝 동기화 프로토콜 세부사항 |
| [docs/troubleshooting.md](./docs/troubleshooting.md) | 실제 발생한 버그 사례 — 증상/원인/해결/교훈 |
| [docs/history.md](./docs/history.md) | 시간순 프로젝트 연대기(Phase 1~28) + 대량 이관 아카이브: 2026-08-14~09-12(Phase 29+), 2026-09-14~10-24(Phase 30+) |
| [docs/features.md](./docs/features.md) | 기능/게임별 룰 해석 판단 기록 |
| [docs/deployment.md](./docs/deployment.md) | 배포 절차, 환경변수, 검증 파이프라인 |

---

## 3. Next Action Items (우선순위 순)

이 섹션은 **여러 게임에 걸친 시스템 수준 항목**만 담는다. 특정 게임 하나의 "실브라우저 미검증" 같은 세부 항목은 각 게임을 다룬 최근 세션 기록(이 문서 상단 "최근 N일" 섹션, 또는 [docs/history.md](./docs/history.md))에 이미 있으니 여기 다시 옮겨 적지 않는다 — 예전에 이 섹션이 통째로 Phase 27~29 시점에 박제된 채 한 달 넘게 안 갱신된 전례(위 "📚 문서 이력 관리 방침" 참고)를 반복하지 않기 위한 의도적 결정.

0. **(최우선)** `docs/history.md`에 통째로 이관한 아카이브 두 덩어리(Phase 29+ 2026-08-14~09-12 약 4,700줄, Phase 30+ 2026-09-14~10-24 약 7,000줄 — 후자의 "🌗 테마 토글" 항목 하나만 3,500줄+)는 개별 Phase 번호를 매기지 않고 원문 그대로 붙여넣은 상태다 — 여유가 있는 세션에서 Phase 29·30…으로 재정리하거나, 최소한 목차만이라도 추가하면 탐색이 쉬워진다.
1. **(높음)** 온라인 게임 ~48종이 셔플 시드를 브로드캐스트해 숨김 정보가 개발자 도구로 보인다. 라이어 게임만 서버 판정으로 옮겼고, 그것도 운영에선 사용자가 SQL·서비스 키를 넣기 전까지 꺼져 있다(위 🔐 섹션). 다음은 마피아.
2. **(높음, 오래 이월)** `<Game>Board.tsx`/`<Game>Game.tsx` 전용 테스트 인프라 없음(jsdom/@testing-library 미설치) — 저비용 대안으로 Playwright 스크린샷 회귀 테스트 도입을 계속 고려 중.
3. **(중간, 오래 이월)** `boardGameRule/` 파일명 kebab-case 통일이 여러 세션에 걸쳐 시도→동시 편집 충돌로 보류를 반복하고 있다 — 다른 세션과 겹치지 않는 시점을 잡아 한 번에 끝낼 것.
4. **(중간, 오래 이월)** 여러 Claude Code 세션이 이 저장소를 동시에 편집/배포하면서 생기는 충돌(워킹 트리 덮어쓰기, Vercel 수동 배포 경합)이 반복 관찰됨 — 세션마다 `git worktree` 분리를 표준 관행으로 정착시킬 것(부분적으로만 실천 중, 위 "작업 규칙" 참고).
5. **(낮음)** `public/games/`의 일부 게임 카드 이미지는 퍼블리셔 소유 박스 표지 사진 원본 — 앱을 더 넓게 배포/홍보할 계획이 생기면 라이선스 검토 필요.
6. **(낮음)** 저장소 루트의 `.clinerules.md`/`instructions.md`는 계속 무시 중이나, 지우거나 남겨둘지는 아직 사용자에게 확답받지 않음.
7. **(낮음)** `docs/troubleshooting.md`(버그 사례 큐레이션)는 이번 대량 이관에 포함되지 않았다 — `docs/history.md`의 Phase 29+ 아카이브를 훑어 troubleshooting.md 형식(증상/원인/해결/교훈)에 맞는 굵직한 사례가 있으면 추려서 옮기는 후속 작업이 남아 있다.

---

## 4. Resume Prompt

다음 세션 `/clear` 직후 아래 한 줄을 그대로 붙여넣을 것:

> `HANDOFF.md`를 읽고 현재 프로젝트 상태를 파악한 뒤, "3. Next Action Items"의 최우선 항목부터 진행해줘. 작업 전에 `git status`와 `git worktree list`로 다른 세션의 흔적이 없는지 먼저 확인하고, 배포는 `git push origin main`까지만 하고 별도로 `vercel deploy`를 실행하지 마.
