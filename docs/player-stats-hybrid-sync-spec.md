# 게스트/로그인 통합 전적 통계 — 설계 검토 + 1단계 구현

2026-10-02 접수된 제안서를 실제 코드와 대조해 정리한 문서. 같은 날 §4 권장안대로 **1단계(전 게임 기본 전적 + 로그인 병합)를 구현했다** — §6 참고. 게임별 세부 지표(2단계)와 §5 결정 항목은 아직 남아 있다.

## 1. 제안 요약

- 게스트: 브라우저 `localStorage`(`boardgame_stats_<GAME>`)에 즉시 기록.
- 로그인 유저: 같은 기록을 Supabase `player_game_stats`(user_id × game_type, `details` JSONB)에 upsert.
- 로그인 순간 `syncAndMergeOnLogin(userId)`가 로컬 게스트 전적을 계정 전적에 합산(판수·승·패는 더하기, `highest*`는 max, `lowest*`는 min, 나머지 숫자는 합).
- 대상 9종: 달무티, 오이 다섯 개, 코요테, 페루도, 위대한 투자, 센추리, 랫어탯캣, 틀린그림찾기, 그림전화기. 게임마다 고유 지표를 `details`에 둔다.

## 2. 이 저장소와 맞지 않는 전제

| 제안 내용 | 실제 코드 |
| --- | --- |
| `src/types/stats.ts`, `src/lib/statsManager.ts`, `src/lib/supabaseClient.ts` | `src/types/`는 없다. Supabase 클라이언트는 `src/lib/supabase/client.ts`·`authClient.ts`에 있다 |
| `src/pages/AuthCallbackPage.tsx` + `navigate()` | App Router 프로젝트. 콜백은 서버 라우트 `src/app/auth/callback/route.ts`(2026-10-02 소셜 로그인 작업, 아직 커밋 전)라서 `localStorage`를 읽을 수 없다. 병합은 콜백이 리디렉트한 뒤의 클라이언트 쪽에서 해야 한다 |
| 게임 키 `'DALMUTI'` 등 대문자 enum | 레지스트리 id는 `dalmuti`, `five-cucumbers`, `coyote`, `perudo`, `great-legacy`, `century`, `rat-a-tat-cat`, `spot-difference`, `doodle-phone` 같은 소문자 문자열. 새 enum을 만들지 말고 이 id를 그대로 쓴다 |
| 1차 저장소가 `localStorage` | 이 프로젝트의 1차 저장소는 IndexedDB(`src/lib/db/`, [architecture.md §1.1](./architecture.md)). 게임 종료 시 이미 `saveGameResult()`가 `GameResultRecord`를 IndexedDB에 쌓고 있다(`src/app/games/[gameId]/page.tsx`의 `handleGameComplete`) |
| "위대한 투자": 0원 수표 낙찰, 30번 랜드마크, 파산 | `great-legacy`(화면 이름 "최고의 투자")에는 수표·랜드마크가 없다. 0원 수표와 30번 매물은 **For Sale**(`src/games/forSale/`)의 규칙이다. → 2026-10-02 확인: 위대한 투자와 For Sale은 **서로 다른 게임**. 지표를 게임별로 나눠 각각 적용했다(§7) |
| 그림전화기: 명예의 전당 '좋아요' 득표, 트롤러 지수 | `doodlePhone`에는 좋아요·명예의 전당 기능이 없다. "원문 보존율"을 재려면 문장 유사도 판정도 새로 만들어야 한다 |
| 틀린그림찾기: MASTER 봇 | 봇 난이도는 Lv.1–10 숫자다. "Lv.10 상대 승리"로 바꿔야 한다 |

나머지 지표(달무티 혁명·조커, 오이 탈락, 코요테 MAX→0, 페루도 팔라피코·칼자, 센추리 금/은 코인, 랫어탯캣 스왑)는 엔진에 해당 개념이 있다. 다만 "블러핑 성공률", "눈먼 카드 승부"처럼 엔진이 이벤트로 남기지 않는 지표는 판정 규칙부터 정해야 한다.

## 3. 설계상 문제 (그대로 구현하면 안 되는 부분)

1. **재로그인 때 이중 합산.** 로그인하면 로컬에 계정 전적이 내려오거나 병합본이 저장된다. 로그아웃 후 다시 로그인하면 그 로컬 값(이미 계정 몫이 포함된 값)이 "게스트 전적"으로 한 번 더 더해진다. 게스트 몫은 누적값이 아니라 **아직 올리지 않은 경기 기록(델타)**으로 따로 보관하고, 업로드에 성공하면 비워야 한다.
2. **기기 간 덮어쓰기.** `recordMatchResult`는 로컬 누적값 전체를 upsert한다. 폰과 PC에서 번갈아 플레이하면 마지막에 쓴 기기의 값이 다른 기기의 기록을 지운다. 서버는 증분만 받아 더해야 한다(`matches_played = matches_played + 1`).
3. **RPC 권한 구멍.** `merge_guest_stats(p_user_id, …)`가 `SECURITY DEFINER`인데 `p_user_id`를 인자로 받아서, 아무나 남의 전적을 바꿀 수 있다. `auth.uid()`만 쓰고 `set search_path = public`을 넣어야 한다. 제안서의 RPC는 `details = EXCLUDED.details`로 덮어쓰므로 이름과 달리 합산도 하지 않는다.
4. **전적 위조.** 클라이언트가 `player_game_stats`에 직접 INSERT/UPDATE할 수 있으면 콘솔 한 줄로 승수를 바꿀 수 있다. 락스텝 구조라 서버가 경기 결과를 검증할 방법도 없다([cloud-sync.md](./cloud-sync.md)). 공개 랭킹에 쓰려면 직접 쓰기는 막고, "경기 1건 기록" RPC 하나로만 쓰게 하고 값 범위를 검사해야 한다. 그래도 위조를 완전히 막을 수는 없으므로 랭킹은 "참고용"으로 표시한다.
5. **봇이 대신 둔 경기.** 끊긴 좌석을 봇이 이어받은 경기(투표 기반 봇 인계 정책)는 원래 주인의 승패로 기록하지 않는다.
6. **`.single()` 오류.** 행이 없을 때 `.single()`은 에러를 낸다. `.maybeSingle()`을 쓰고, 9개 게임을 하나씩 조회하지 말고 한 번에 가져온다.
7. **rating 필드.** 레이팅 계산 규칙(상대 레이팅, 다인전 처리)이 없다. 정하기 전까지는 컬럼을 만들지 않는다.

## 4. 권장 구현 방향

- **기록 지점은 한 곳.** `handleGameComplete`가 이미 모든 게임의 종료를 받으므로, 여기서 `recordStats(gameId, mySeatResult, details)`를 호출한다. 게임별 세부 지표는 각 게임이 `GameCompletionResult`에 `statsDelta`를 실어 보낸다(지원하지 않는 게임은 생략, 기본 승/패/판수만 기록).
- **로컬 저장.** IndexedDB에 스토어 두 개를 둔다. `statTotals`(화면 표시용 누적값)와 `statPending`(서버에 아직 올리지 않은 경기 델타, `matchId`를 붙임).
- **서버 저장.** `record_match_stats(p_game_id text, p_match_id text, p_delta jsonb)` RPC 하나만 둔다. `auth.uid()`로 행을 찾아 증분을 더하고, `(user_id, match_id)` 유니크 키로 같은 경기가 두 번 반영되지 않게 한다. 지표별 합산 방식(sum/max/min)은 서버의 게임별 화이트리스트로 정한다.
- **로그인 병합.** 로그인 후 클라이언트에서 `statPending`을 RPC로 비운다(게스트 시절 기록도 같은 경로로 올라간다). 그 다음 서버 누적값을 내려받아 `statTotals`를 덮어쓴다. match_id 중복 방지가 있으니 재시도나 재로그인에도 안전하다.
- **SQL 검증.** 운영 반영 전에 로컬 embedded-postgres로 SQL을 먼저 돌려 본다(embedded-postgres + Supabase 스텁). 운영 Supabase에는 SQL을 사람이 직접 실행해야 한다.

## 5. 결정 필요

1. ~~공개 랭킹 여부~~ → **공개 랭킹으로 결정**(2026-10-02, §7).
2. ~~위대한 투자 = ?~~ → 위대한 투자(`great-legacy`)와 For Sale(`for-sale`)은 다른 게임. 각각 적용(§7).
3. 첫 단계 범위: 9종 전부의 세부 지표를 한 번에 할지, 기본 승/패/판수를 전 게임에 먼저 깔고 세부 지표를 게임별로 붙일지(후자 권장).
4. 소셜 로그인 작업(`src/app/auth/`, `supabase/social_auth.sql`)이 아직 커밋되지 않았다. 병합 기능은 그 작업이 들어간 다음에 붙인다.

## 6. 1단계 구현 (2026-10-02)

| 파일 | 역할 |
| --- | --- |
| `src/games/types.ts` | `GameCompletionResult.self?: { rank, playerCount, botPlayed }` — 이 기기 플레이어의 결과 |
| `src/games/shared/selfResult.ts` | `computeRankings()` 결과 + `mySeat` + `botTakeover.takeovers`로 `self`를 만든다. 20개 온라인 게임(`ids[r.seat]` 공통 패턴 19개 + 그림전화기)이 `onComplete`에 실어 보낸다 |
| `src/app/games/[gameId]/page.tsx` | `handleGameComplete`에서 `res.self`가 있으면 `recordMatchStat()` |
| `src/lib/db/client.ts` | IndexedDB v3: `statTotals`(표시용 누적), `statPending`(업로드 대기 경기) |
| `src/lib/stats/playerStats.ts` | 기록 → 큐 → RPC 업로드 → 서버 누적값으로 로컬 갱신. 로그아웃 시 계정 누적값 삭제 후 게스트 대기분만 남김 |
| `src/components/stats/PlayerStatsSync.tsx` | 루트 레이아웃. 첫 로드·`SIGNED_IN`·`online` 때 동기화, `SIGNED_OUT` 때 초기화 |
| `src/app/stats/page.tsx` | "내 전적" 페이지(헤더 "전적" 링크). 게스트도 볼 수 있음 |
| `supabase/player_stats.sql` | `player_game_stats`, `player_match_log`, `record_match_stats()` RPC |

### §3 문제 → 이렇게 막았다

1. 이중 합산 → 서버에는 누적값을 보내지 않고 `statPending`의 경기 단위 델타만 보낸다. 업로드 성공 시 큐에서 지운다.
2. 기기 간 덮어쓰기 → 서버가 `played = played + 1`로 더한다. 로컬 누적값은 동기화 후 서버 값으로 교체된다.
3. RPC 권한 → 인자에 user_id가 없고 `auth.uid()`만 쓴다. `security definer set search_path = public`, anon 실행 권한 회수.
4. 위조 → 테이블 직접 INSERT/UPDATE 정책 없음(RLS로 차단). RPC가 rank 범위, `won = (rank = 1)`, 게임 id 형식, 미래 날짜, 시간당 300판을 검사한다. 읽기는 본인 행만(공개 랭킹은 미정).
5. 같은 경기 중복 → `(user_id, match_id)` PK, 중복이면 `false` 반환하고 무시.
6. 봇 대리 경기 → `self.botPlayed`면 기록 자체를 안 한다. `mySeat`가 없는 로컬/핫시트 판도 기록 안 함.
7. 다른 계정 → 로그인 상태에서 친 판은 `userId`가 붙어 그 계정이 로그인했을 때만 올라간다. 게스트 판(`userId: null`)은 다음에 로그인하는 계정으로 합쳐진다.

승패 기준: 1위(공동 1위 포함)면 승, 나머지는 패. 1인 솔로 게임(배고픈 상어, 크랩 서바이벌)과 `self`를 안 보내는 게임은 기록되지 않는다.

### 검증

- `npx tsc --noEmit`, eslint 통과. `selfResult` 단위 테스트.
- `player_stats.sql`을 embedded-postgres(Supabase 역할/auth 스텁)에서 실행: 재실행 안전, 중복 match_id 무시, 사용자별 격리, anon 호출·직접 INSERT 차단, 잘못된 rank/won/게임 id/미래 날짜 거부 확인.

### 운영 적용 (사람이 해야 함)

Supabase SQL Editor에서 `supabase/player_stats.sql` 실행. 실행 전에는 업로드가 실패해 큐에 쌓여 있다가, 실행 후 첫 동기화 때 한꺼번에 올라간다(그 사이 기록은 유실되지 않음).

## 7. 공개 랭킹 + 게임별 세부 지표 (2026-10-02)

### 공개 랭킹
- `public_leaderboard(p_game_id, p_sort, p_min_played, p_limit)` RPC(anon도 호출 가능). 원본 테이블은 여전히 본인만 읽을 수 있고, 이 함수는 **닉네임·아바타·판/승/패/승률/최고순위/세부지표만** 돌려준다(user_id·이메일 없음).
- `p_game_id = null`이면 전체 게임 합산. 정렬: `wins`(승수) / `rate`(승률, 10판 이상만).
- 상위 N명 + **내 행(`is_me`)은 순위 밖이어도 항상 포함**. 닉네임은 `user_profiles.nickname`, 없으면 `게이머_xxxxxx`.
- `player_stats.sql`이 `user_profiles`를 `social_auth.sql`과 같은 정의로 `create table if not exists` 한다 — 그 파일을 안 돌렸어도 랭킹이 깨지지 않게.
- 클라이언트: `src/lib/stats/leaderboard.ts`, `/stats`의 "공개 랭킹" 탭(게임 선택, 승수/승률 정렬, 내 행 강조). "결과는 각 기기에서 계산되는 참고용 랭킹" 문구 표시.

### 게스트 주의 문구
`/stats` 상단에 비로그인일 때만 노란 테두리 경고 박스(`role="alert"`): 이 브라우저에만 저장, 데이터 삭제·시크릿 모드·저장공간 정리·기기 변경 시 복구 불가, 랭킹 미등재, 로그인하면 계정에 합쳐진다는 안내 + 로그인 버튼.

### 세부 지표 공통 구조
- `GameSelfResult.details?: Record<string, number>` → 대기 큐 → RPC `p_details` → `player_game_stats.details`(jsonb).
- 합산 규칙(클라 `src/lib/stats/details.ts`, 서버 `merge_stat_details()` 동일): 키가 `max`로 시작하면 최댓값, `min`으로 시작하면 최솟값(§8에서 추가), 나머지는 합. RPC는 키 24개 이하, 키 형식, 0~10억 숫자만 허용.
- 화면 라벨: `STAT_DETAIL_ROWS`(게임 id → 표시 행). `/stats` 내 전적 표에서 행을 누르면 펼쳐진다.

### 위대한 투자 (`great-legacy`, 화면 이름 "최고의 투자") — `src/games/greatLegacy/stats.ts`
엔진에 `PlayerState.winningBids?: number[]`(일반 경매 낙찰가 기록, 역경매 제외) 추가.

| 키 | 의미 |
| --- | --- |
| `maxScore` / `totalScore` | 최고 점수 / 평균 점수용 합 |
| `maxWinningBid` | 한 번에 가장 비싸게 낙찰받은 금액 |
| `totalPaid` / `totalAssetScore` | 투자 효율(자산점수 ÷ 낙찰가) |
| `synergies` / `maxSynergies` | 완성한 마켓·섹터 컬렉션 수 |
| `boosted` / `crashed` | 초대형호재 / 악재·어닝쇼크를 맞은 자산 |
| `delisted` | 상장폐지·강제반대매매로 잃은 자산 |
| `brokeGames` | 코인 0으로 끝낸 판(파산) |

### For Sale (`for-sale`) — `src/games/forSale/stats.ts`
엔진에 `PlayerState.sales?: { property, check }[]`(판매 기록) 추가.

| 키 | 의미 |
| --- | --- |
| `maxTotal` / `totalMoney` | 최고 / 평균 최종 자산 |
| `maxCheck` | 받은 가장 큰 수표 |
| `zeroChecks` | 0원 수표 받은 횟수 |
| `had30` / `won30` | 30번 매물 보유한 판 / 보유하고 1위 |
| `sold30ForZero` | 30번 매물을 0원 수표에 판 굴욕 |

나머지 8개 게임은 §8에서 추가했다.

### 검증
- tsc / eslint 통과. vitest: `mergeStatDetails`, 두 게임 `stats.ts`(봇끼리 끝까지 둔 판에서 지표 계산 확인), 기존 For Sale·최고의 투자 테스트 포함 126개 통과.
- embedded-postgres: 이전 버전 SQL 위에 새 SQL 적용·재실행 안전, details 합산(max/합) 정확, 잘못된 details(문자열·음수·배열) 거부, anon이 랭킹은 보지만 원본 테이블은 0행, limit 밖의 내 행 포함, 승률 정렬 최소 판수, 프로필 닉네임 반영 확인.

### 운영 적용
`supabase/player_stats.sql`을 **다시 한 번** SQL Editor에서 실행(이전 버전을 이미 돌렸어도 안전하게 업그레이드됨).

## 8. 나머지 8개 게임 세부 지표 + 랭킹 닉네임 (2026-10-02)

### 공통: 엔진 안의 이벤트 카운터
"페루도! 적중"처럼 라운드마다 일어나는 일은 최종 상태에 남지 않는다. 컴포넌트에서 세면 재접속(`state-sync`) 때 중복/누락되므로, 각 엔진 상태에 `statTally?: StatTally`(좌석 → 키 → 숫자)를 두고 리듀서 안에서 센다 — `src/games/shared/statTally.ts`(`tallyAdd`/`tallyMax`/`tallyFlag`). 락스텝 결정론이 유지되고 state-sync로 그대로 넘어간다. 필드가 선택적이라 진행 중이던 판도 그대로 로드된다.

각 게임 `stats.ts`가 최종 상태 + `statTally`로 `details`를 만들고, `*Game.tsx`의 `selfResult(..., details)`로 넘긴다. 화면 라벨은 `STAT_DETAIL_ROWS`.

| 게임 | 지표 (키) |
| --- | --- |
| 페루도 | 페루도!/맞아! 호출·적중(`dudoCalls/dudoCorrect`, `calzaCalls/calzaCorrect`), 내 선언이 들킴/버팀(`bluffsCaught/bidsHeld`), 경계 적중(`exactHits`), 주사위 1개에서 역전승(`oneDieComebacks`), 한 번에 잃은 최대 주사위(`maxDiceLostOnce`) |
| 달무티 | 1등/꼴찌(`finishedFirst/finishedLast`), 농노→1등(`winAsPeon`), 달무티→꼴찌(`loseAsDalmuti`), 혁명/대혁명, 조커로 마무리(`jokerFinishes`), 한 번에 낸 최대 장수 |
| 오이 다섯 개 | 누적 오이(`cucumbersEaten`), 마지막 트릭 참여/생존(`finalTricks/finalTricksSurvived`), 15로 딴 트릭(`topCardTricks`), 마지막 트릭 1로 방어(`oneCardDefenses`), 한 번에 먹은 최대 오이, 탈락 |
| 코요테 | 코요테! 호출·적중, 내 선언 의심받음/버팀, 하트 무손실 1위(`flawlessWins`), 이마에 ?·MAX→0·x2가 붙은 라운드. 원작 "깃털 3개"는 이 구현에서 하트 2개(`STARTING_HEARTS`) |
| 랫어탯캣 | 최저 점수(`minHandScore`, 낮을수록 좋음), 평균 점수, 0점 핸드, 랫어탯캣! 선언 후 1등, Swap 사용/이득 본 Swap |
| 센추리 | 최고/평균 승점, 금화/은화, 승점 카드 수, 갈색(시나몬) 확보량(`brownGained`), 가장 빨리 이긴 라운드(`minWinRounds`, 이긴 판에만) |
| 틀린그림찾기 | 찾은 곳, 오클릭, 한 판 최다, 오답 없는 판, Lv.10 봇(상대 팀) 상대 승리. 원작 지표의 "MASTER 봇"은 Lv.10으로 |
| 그림전화기 | 그린 그림/쓴 문장, 원래 문장 정확히 맞힘(`exactGuesses`), 받은 반응(😂🤯👏❤️🤔 — 제안서의 "좋아요"에 해당), 한 장 최다 반응, 받은 투표(점수 모드), 시간 초과 자동 제출 |

빠진 것: 제안서의 "평균 탐색 시간"(틀린그림찾기)은 엔진이 벽시계를 쓰지 않아 제외, "트롤러 지수"(그림전화기)는 판정 기준이 없어 제외.

### 랭킹 닉네임
- **어디서 바꾸나**: `/stats` → 공개 랭킹 탭의 "내 랭킹 닉네임 [정하기/변경]", 또는 헤더 아바타/`/account`의 "닉네임 · 프로필 이미지 변경" → 프로필 모달 맨 위.
- 소셜 로그인은 `user_profiles.nickname`/`avatar_url`에 **실명·실사진이 들어올 수 있어** 랭킹에 쓰지 않는다. 대신 새 컬럼 `public_name`(본인이 정한 랭킹 닉네임)과 `public_avatar_url`(이 사이트에 올린 프로필 이미지 — `/api/profile/avatar`가 함께 기록)만 쓴다. 안 정하면 `게이머_xxxxxx`.
- `set_my_public_name(p_name)` RPC: 2~12자, 한글·영문·숫자·밑줄·공백, 대소문자 무시 중복 금지(부분 유니크 인덱스), `관리자`·`admin`·`게이머_…` 등 예약어 금지, 빈 값이면 해제.

### 검증
- tsc / eslint 통과. 10개 게임 + 통계 테스트 646개 통과, 봇 풀게임으로 페루도·코요테·오이 지표 정합성 확인(`src/lib/stats/gameDetails.test.ts`).
- embedded-postgres: 이전 배포본 위에 적용·재실행 안전, `min*` 합산(최솟값 유지), 닉네임 규칙 5종 거부·anon 거부, 소셜 실명이 랭킹에 안 나옴, 아바타 미러 반영, 닉네임 해제 시 `게이머_` 복귀.

### 운영 적용
`supabase/player_stats.sql`을 다시 한 번 실행.

## 9. 이번 판 기록 카드 + 세부 지표 랭킹 + 운영 점검 (2026-10-02)

### 이번 판 기록 카드
- `src/components/stats/MatchRecordCard.tsx`, `src/app/games/[gameId]/page.tsx`에서 `recordMatchStat()`이 끝나면 띄운다(이제 갱신된 누적값을 돌려줌).
- 내용: 승/패 · 순위/인원, 이번 판에 **실제로 일어난** 세부 기록만(0인 항목 숨김, 단 `min*` 점수는 0도 표시), 누적 판/승/패/승률 + 전적 보기 링크, 비로그인이면 노란 "사라질 수 있어요" 경고.
- 온라인 게임은 방 안에서 자체 결과 화면을 쓰므로(스테이지를 바꾸면 Realtime 채널이 끊김) 화면을 바꾸지 않고 **떠 있는 카드**로 띄운다. 모바일은 상단 전체 폭, 데스크톱은 우상단. 닫기·접기 가능, 20초 뒤 자동으로 사라짐.
- 표시 행 설정: `src/lib/stats/presentation.ts`의 `MATCH_SUMMARY_ROWS`.

### 세부 지표 랭킹
- `/stats` → 공개 랭킹 → 게임을 고르면 "세부 기록" 칩이 나온다(게임당 3개, `STAT_RANK_METRICS`). 예: 페루도 "페루도! 적중률"(10번 이상 호출한 회원만), 랫어탯캣 "최저 점수"(낮을수록 위), 센추리 "최단 승리".
- RPC `public_metric_leaderboard(p_game_id, p_num, p_den, p_asc, p_min_den, p_limit)`: `p_den` 있으면 비율(`'played'`면 판당 평균) + 최소 분모, 없으면 값 그대로이고 기록 없음/0(높을수록 좋은 순위)인 사람은 제외. 키는 정규식으로 검사(SQL 주입 불가). 노출 범위는 `public_leaderboard`와 같음(랭킹 닉네임·사이트 아바타만, 내 행은 순위 밖이어도 포함).
- RPC가 없으면(PGRST202) 랭킹 탭에 "랭킹 서버 설정이 아직 끝나지 않았어요" 안내.

### 운영 점검 스크립트
`node scripts/check-player-stats.mjs` — `.env.local`의 Supabase에 4개 RPC가 있는지(anon 키, 아무것도 쓰지 않음) 확인하고, `SUPABASE_SERVICE_ROLE_KEY`가 있으면 저장된 회원×게임 행 수, 기록된 판 수, 랭킹 닉네임 수, 최근 5판(세부 지표 개수 포함)을 보여준다.

2026-10-02 실행 결과: **4개 RPC 모두 없음 = `player_stats.sql` 미적용**(`user_profiles`는 있음 = `social_auth.sql`은 적용됨). 적용 전까지 로그인 유저의 기록은 각 브라우저 대기 큐에 쌓여 있다가, SQL 실행 후 다음 접속/로그인 때 올라간다.

### 검증
- tsc / eslint 통과, 통계 단위 테스트 34개(`presentation.test.ts` 포함) 통과.
- embedded-postgres: 비율(최소 분모)·판당 평균·낮을수록 순위·값 0 제외·키 주입 거부·limit 밖 내 행 포함 확인. 이전 배포본 위 재적용 안전.
