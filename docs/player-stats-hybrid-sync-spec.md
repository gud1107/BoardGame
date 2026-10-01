# 게스트/로그인 통합 전적 통계 — 설계 검토 (미구현)

2026-10-02 접수된 제안서를 실제 코드와 대조해 정리한 문서. **아직 구현하지 않았다.** 아래 "결정 필요" 항목이 정해지면 그때 구현한다.

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
| "위대한 투자": 0원 수표 낙찰, 30번 랜드마크, 파산 | `great-legacy`(화면 이름 "최고의 투자")에는 수표·랜드마크·파산 개념이 없다. 0원 수표와 30번 매물은 **For Sale**(`src/games/forSale/`)의 규칙이다. 두 게임이 섞인 것으로 보인다 |
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

1. 전적을 **공개 랭킹**에 쓸 것인가, 본인만 보는 기록장인가. 공개 랭킹이면 3-4의 위조 대책이 필수다.
2. "위대한 투자"가 `great-legacy`인지 `for-sale`인지. 지표는 For Sale 쪽 내용이다.
3. 첫 단계 범위: 9종 전부의 세부 지표를 한 번에 할지, 기본 승/패/판수를 전 게임에 먼저 깔고 세부 지표를 게임별로 붙일지(후자 권장).
4. 소셜 로그인 작업(`src/app/auth/`, `supabase/social_auth.sql`)이 아직 커밋되지 않았다. 병합 기능은 그 작업이 들어간 다음에 붙인다.
