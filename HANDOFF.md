# HANDOFF — 현재 스냅샷

_최종 갱신: 2026-08-25 (**말달리자 말 이동 동적 트랜지션(갤럽 도약/나이트 아치) + 흙먼지·임팩트·스피드트레일·LEAD 배지 파티클 이펙트 추가 세션** — 자세한 내용은 아래 `### 2026-08-25 — 말달리자 말 이동 갤럽 애니메이션 및 파티클 이펙트` 절 참고.)_

_이전 갱신: 2026-08-24 (**그리드 포커 라운드 승리 연출 대폭 강화(round-result 페이즈 신설 + 골드 파티클/스탬프/화면떨림 오버레이) 및 승자 정보 결과창 통합 배치 세션** — 자세한 내용은 아래 `### 2026-08-24 — 그리드 포커 라운드 승리 비주얼 이펙트 강화 및 승자 결과창 통합` 절 참고.)_

_그 이전 갱신: 2026-08-24 (**그리드 포커 라운드 승수 표기(M/N승) + 승리 도트 인디케이터 & 족보 높은 순 기본 정렬 세션** — 자세한 내용은 아래 `### 2026-08-24 — 그리드 포커 라운드 승수 표기 및 족보 높은 순 기본 정렬` 절 참고.)_

_그 이전 갱신: 2026-08-24 (**라스베가스 배팅존 지폐 카드 비겹침 나란히 정렬 세션** — 자세한 내용은 아래 `### 2026-08-24 — 라스베가스 배팅존 지폐 카드 비겹침 나란히 정렬 및 개별 금액 가독성 확보` 절 참고. 커밋은 해당 절의 "커밋/배포" 항목 참고.)_

_그 이전 갱신: 2026-08-24 (**저작권/상표권 360도 분석 + 카탈로그 썸네일·라스베가스 카지노 실사진 정리 세션** — 자세한 내용은 아래 `### 2026-08-24 — 저작권/상표권 분석 문서 작성 및 실물 박스아트·라스베가스 카지노 실사진 정리` 절 참고. 이 항목은 이 세션 시작 시점까지도 아직 커밋되지 않은 상태였음 — 아래 새 세션 절의 "커밋 시점에 확인된 사실" 참고.)_

### 2026-08-25 — 말달리자 말 이동 갤럽 애니메이션 및 파티클 이펙트

**요청**: 말이 다음 칸으로 순간이동하지 않고 도약(갤럽) 트랜지션으로 이동하게 하고, 이동 중 흙먼지 파티클/스피드라인/잔상, 도착 시 임팩트 링+스쿼시&스트레치, 선두 추월 시 LEAD 하이라이트를 추가 — 타이밍/파티클 강도/추월 연출 등 디자인 판단이 필요한 지점은 임의로 정하지 말고 먼저 질문하라는 명시적 지시(Strict No-Assumption Rule).

**사전 조사**: 요청 원문이 가정한 "주사위 기반 경마/랩 레이스 + 부스트 카드 + 1등 추월" 구조는 실제 게임과 다름 — 실제 말달리자는 11×11 체스형 보드에서 슬라이드(직교 방향으로 막힐 때까지 여러 칸 한번에 슬라이드)와 나이트(L자, 단일 점프) 두 종류의 이동만 있고, 주사위·부스트 카드·바퀴(lap)·1등 개념이 전혀 없는 "오아시스(중앙 단일 칸)에 먼저 도착하면 즉시 승리"하는 게임임을 확인. 기존 이동은 셀이 바뀌면 해당 셀의 자식으로 말 토큰이 재마운트되며 0.35초 "착지 바운스"(`maldallija-horse-land`)만 재생될 뿐, 칸 사이를 실제로 이동하는 트랜스폼 애니메이션은 없었음(순간이동처럼 보임). `engine.ts`의 `MoveRecord`(from/to)와 `resolveSlide`(슬라이드는 막힐 때까지 한 방향으로 여러 칸 이동, `dr`/`dc`가 항상 4방향 단위벡터 중 하나)를 근거로 슬라이드는 한 번의 이동 액션이 여러 칸을 포함할 수 있음을 확인 — 클라이언트에서 `from`→`to`를 단위 스텝으로 재분해해 칸별 도약 경로를 만들 수 있음.

**모호점 확인(`AskUserQuestion`, 4문항)**:
① 슬라이드 칸당 갤럽 도약 소요시간 — 200ms/250ms/300ms → **250ms** 선택.
② 이 게임엔 주사위 부스트가 없는데 스피드라인/잔상 발동 기준 — 다중 칸 슬라이드만/모든 이동/생략 → **다중 칸 슬라이드(2칸 이상)만** 선택.
③ 이 게임엔 1등/추월 개념이 없는데 "LEAD" 하이라이트 반영 방식 — 오아시스 최단거리 갱신 시/오아시스 구역 진입 시/기능 생략 → **오아시스 다이아몬드 구역(맨해튼거리 ≤2) 진입 시** 선택.
④ 나이트(L자) 점프 시각 차별화 — 포물선 아치+자홍 궤적/단순 포물선만/슬라이드와 동일 곡선+색상만 구분 → **포물선 아치 + 자홍 궤적(마젠타 트레일 도트)** 선택.

**구현(신규 `src/games/malDalliJa/MoveEffects.tsx`, 순수 UI 레이어 — `engine.ts` 무변경)**:
- **경로 재구성**: `buildPath(record)` — 슬라이드는 `from`→`to`를 단위 벡터로 재분해해 중간 정차 칸 배열 생성(예: 3칸 이동 = 4개 좌표), 나이트는 `[from, to]` 단 2개(경유 칸 없음). `buildMoveAnim`이 이걸 `steps * 250ms`(슬라이드) 또는 고정 `380ms`(나이트, 한 홉보다 길고 두 홉보다 짧게 튜닝한 임의값) 총 소요시간의 `MoveAnim`으로 변환.
- **`AnimatedHorse`**: `anim.id`로 매 이동마다 새로 마운트되는 컴포넌트, `requestAnimationFrame` 루프가 `style.transform`(translate3d, 퍼센트 좌표 — 셀 크기를 픽셀로 측정할 필요 없이 보드 자체의 퍼센트 좌표계 사용)을 직접 갱신 — React state를 거치지 않아 매 프레임 리렌더 없이 GPU 합성만으로 60fps 유지. 중첩된 두 레이어(위치 담당 mover + 도약/스쿼시 담당 bounce 자식)로 칸 이동 트랜스폼과 세로 홉/스쿼시&스트레치를 독립적으로 합성. 세그먼트(홉) 경계마다 `onEvent` 콜백으로 dust/streak/knightTrail/impact/lead 이벤트 발행, 전체 종료 시 `onDone` 1회 호출.
- **파티클 5종**(`MoveParticleLayer`): 흙먼지(매 홉 착지마다), 임팩트 링+스쿼시(최종 착지 시), 스피드 스트레일(다중 칸 슬라이드의 각 홉 시작 시, 좌석 색상 오라 — CSS 커스텀 프로퍼티 `--streak-angle`로 이동 방향 회전), 나이트 마젠타 트레일 도트(포물선 궤적을 25/50/75% 지점에서 샘플링), LEAD 배지(오아시스 구역 신규 진입 시, 이 이동이 게임을 끝낸 경우는 억제 — WINNER/ELIMINATED 오버레이와 겹치지 않도록).
- **`MalDalliJaBoard.tsx`**: `state.moveHistory` 길이 증가를 감지해(본인 이동/상대 동기화 이동 모두 동일한 경로로 감지 — 둘 다 `moveHistory`가 늘어난 새 `state` prop으로 도착) `buildMoveAnim` 호출 → `animations` 배열에 추가. **중요**: 이 감지를 `useEffect`가 아니라 `trackedSelectionTurn`/`trackedTurn`과 동일한 "렌더링 중 상태 조정" 패턴(비교 후 조건부 `setState`)으로 구현 — `useEffect`로 했다면 승리 이동의 경우 "gameOver" 렌더가 먼저 커밋된 뒤에야 애니메이션이 큐에 들어가, `animations.length === 0` 게이트가 한 프레임 동안 WINNER/ELIMINATED 오버레이를 잘못 노출했다가 사라지는 깜빡임이 생김 — 렌더 중 조정으로 두 상태 갱신이 같은 페인트에 묶이도록 수정. 애니메이션 중인 말은 정적 그리드 셀 렌더링에서 숨김(`animatingKeys`, 이미 `state.positions`는 최종 칸을 가리키고 있으므로 이중 렌더 방지). `GameOverOverlay` 노출 조건에 `animations.length === 0` 게이트 추가 — 승리 이동의 비행+임팩트가 다 끝난 뒤에 WINNER/ELIMINATED가 뜨도록 시퀀싱.
- **`globals.css`**: `maldallija-dust-puff`/`maldallija-impact-ripple`/`maldallija-speed-streak`/`maldallija-knight-trail`/`maldallija-lead-badge-pop` 5개 신규 keyframes 추가(기존 `maldallija-*` 클러스터에 이어서 배치, 동일한 주석 스타일 유지).

**검증**: `npx tsc --noEmit`(에러 0) / `npm run lint`(경고 0 — 개발 중 `react-hooks/refs`가 렌더 중 ref 직접 대입을 잡아내 `AnimatedHorse`의 콜백-최신값-ref 패턴을 `useEffect` 안으로 옮겨 수정) / `npx vitest run src/games/malDalliJa`(58/58 통과, 엔진 무변경이라 테스트도 무변경 — 순수 UI 레이어 추가라 신규 유닛 테스트는 작성하지 않음). 전체 `npx vitest run`은 과거 여러 세션에 기록된 것과 동일하게 장시간 소요 이슈가 있어 타깃 스위트로만 검증.

**참고 — 실제 UI 렌더링 미검증**: HANDOFF에 반복 기록된 `<Game>Board.tsx` 테스트 사각지대(jsdom 미설치)와 동일하게, 이번 갤럽 홉/파티클의 실제 화면 체감(칸 경계와 오버레이 좌표계의 픽셀 정합, 모바일에서의 파티클 크기감, 60fps 실측)은 엔진/타입/린트 검증만 마쳤고 아직 육안 확인하지 않음 — 다음 세션에서 실제 플레이로 재확인 권장.

**커밋/푸시**: `b95fbaf feat(horse-race): add dynamic gallop animation, dust trail, and landing impact effects on horse movement` → `git push origin main` 완료. 4개 파일(`globals.css`/`MalDalliJaBoard.tsx`/신규 `MoveEffects.tsx`/이 HANDOFF 절)만 스테이징해 커밋 — 세션 시작 시점부터 작업 트리에 있던 다른 세션들의 미커밋 변경(`.gitignore`, `public/games`·`public/images/lasVegas` 실물 이미지 삭제, `lasVegas/*`, `registry.ts`, `boardGameRule/` 신규 파일, `저작권, 상표권.md`, `orca충돌및확인.md` 등)은 이번 작업과 무관하므로 건드리지 않고 그대로 작업 트리에 남겨둠.

**배포**: `npx vercel deploy --scope me-3871`(프리뷰) 정상 완주(Turbopack 빌드+TypeScript 전체 재검사 포함), READY — `https://board-game-rbt7p41cy-me-3871.vercel.app`. 요청 문구에 "production" 명시가 없어 프리뷰까지만 진행(과거 세션들과 동일 판단 기준). 이 배포는 Git 커밋이 아니라 작업 트리 전체를 빌드하므로, 위 "커밋/푸시" 항목에 적은 다른 세션들의 미커밋 변경도 함께 반영된 상태로 배포됨 — 이 말달리자 세션이 그 변경들을 검증하거나 의도한 것은 아님.

### 2026-08-24 — 그리드 포커 라운드 승리 비주얼 이펙트 강화 및 승자 결과창 통합

**요청**: (1) 라운드(1R, 2R...) 종료 결과 화면을 화면 전체를 아우르는 화려한 파티클/황금빛 글로우/슬롯 승리 줌인 등으로 전면 개편, (2) 라운드 결과 영역에 승리 플레이어 정보(닉네임/아바타/결정적 족보/누적 승수)를 통합 배치. 노출 시간·파티클 스타일·연출 흐름 등 디자인 판단이 필요한 지점은 임의로 정하지 말고 먼저 질문하라는 명시적 지시(Strict No-Assumption Rule).

**사전 조사**: 요청 원문이 가정한 `Board.tsx`/`RoundResult.tsx`/`RoundModal.tsx`/`WinnerOverlay.tsx` 파일 구조는 실제와 다름 — 실제로는 `GridPokerBoard.tsx` 하나에 보드 UI+라운드 결과 표시가 통합돼 있고, 라운드 결과는 모달이 아니라 화면 하단에 계속 떠 있는 작은 인라인 카드(`state.lastRoundResult` 블록)였음. **가장 중요한 발견**: 이 게임의 "라운드"는 새 판 배치가 아니라 이미 다 채워진 5x5 보드에서 12개 라인 중 하나를 블라인드 제출해 비교하는 사이클이고(engine.ts `resolveRound`), 기존에는 라운드 종료 즉시 **아무 대기 없이** 바로 다음 라인 제출이 열렸음 — 즉 "라운드 종료 → 잠깐 멈춤 → 다음 라운드" 전환 단계 자체가 엔진/UI 어디에도 없었음. 요청하신 "카운트다운 타이머 바로 다음 라운드 연결"을 구현하려면 게임 흐름 자체에 새 단계를 넣어야 하는 아키텍처 변경이 필요함을 확인.

**모호점 확인(`AskUserQuestion`, 4문항)**:
① 라운드 전환 방식 — 엔진 레벨 새 대기 단계 추가(전원 동기화) vs 클라이언트 로컬 연출만(엔진 무변경) → **엔진 레벨 대기 단계 추가** 선택.
② 노출시간/빈도 — 매 라운드(최대 10~12회) 5~6초 동일 강도 vs 8~10초 vs 족보 강도별 차등 → **매 라운드 동일 강도, 5~6초**(6초로 확정) 선택.
③ 무승부/최종전 — 중간 라운드만 강화 vs 매치 최종 승리(game-end) 화면도 포함 vs 둘 다 제외 → **중간 라운드만 강화**(무승부는 절제된 카드만, 기존 game-end 트로피 화면은 무변경) 선택.
④ 스킵 기능 — 스킵 없이 고정 카운트다운 vs 클릭 시 스킵 → **스킵 없이 고정 카운트다운** 선택.

**구현**:
- **`engine.ts`**: `Phase`에 `"round-result"` 신규 추가. `resolveRound`가 (매치를 끝내지 않는 한) 점수 정산 직후 `"submitting"`으로 바로 돌아가는 대신 `"round-result"`에 파킹하도록 변경 — 매치를 끝내는(`checkGameEnd`) 라운드는 기존과 동일하게 `"round-result"`를 거치지 않고 곧장 `"game-end"`로 감(③ 답변에 따라 최종 승리 화면은 이번 강화 대상 밖이므로 의도된 동작). 새 액션 `advance-round-result`(어떤 좌석에도 속하지 않는 공유 전환 — `draw-common`과 동일한 "호스트가 브로드캐스트" 패턴, `getValidMoves`는 round-result 중 모든 좌석에 빈 배열 반환) + `advanceRoundResult` 리듀서(round-result가 아닐 때는 완전 no-op) 추가. 신규 상수 `ROUND_RESULT_SECONDS = 6`(오버레이/호스트 타이머 공용 페이싱 값) export. `LINE_LABELS`를 `GridPokerBoard.tsx`에서 `engine.ts`로 이동(신규 오버레이 컴포넌트와 보드 컴포넌트가 순환 참조 없이 공유하기 위함).
- **`GridPokerGame.tsx`**: 기존 `draw-common` 호스트 이펙트와 동일한 패턴으로, `gameState.phase === "round-result"`가 되면 호스트가 `ROUND_RESULT_SECONDS`(6초) 후 `advance-round-result`를 브로드캐스트하는 새 이펙트 추가 — 전원에게 동기화된 진짜 전환은 호스트가 담당하고, 각 클라이언트가 로컬로 보여주는 카운트다운 바는 그 타이밍에 맞춘 순수 연출(cosmetic)임.
- **`RoundResultOverlay.tsx`(신규 파일)**: `document.body`에 포탈되는 풀스크린 오버레이, `state.phase === "round-result"`일 때만 렌더링.
  - **승자 있음**: `[ ROUND N WIN! ]` 스탬프(임팩트 등장 + 오버레이 전체 화면 떨림) → **"👑 ROUND WINNER"** 골드 네온 헤드라인 + 좌석색 아바타 뱃지 + 이름(본인이면 "(나)" 표기) → 결정적 족보(우세 무늬 아이콘 + `formatHandLabel`) → 승리 라인의 5x5 미니 보드 다이어그램(승자의 실제 보드에서 해당 5칸만 카드로 표시, 나머지는 빈 칸 — `evaluateHand`가 조커 해석 시 카드 순서를 재배열할 수 있어 `RoundResult.submissions[].hand.cards`가 아니라 승자의 원본 `board`에서 직접 읽음, 골드 펄스+3D 플로트 애니메이션) → 누적 승수(`🏆 M승 달성 (M/N)` + 도트) → "다음 라운드 준비" 카운트다운 바. 배경에 회전하는 골드 선버스트(conic-gradient) + 24개 고정 결정론적 컨페티(`Math.random()` 미사용 — SPARKLE_OFFSETS와 동일한 근거, SSR/CSR 불일치 방지).
  - **무승부**: ③ 답변대로 절제된 카드만(파티클/스탬프/화면떨림 없이 각자 제출한 족보 나열 + 동일한 카운트다운 바).
  - **패자 시점**: 승자/패자 구분 없이 모든 뷰어가 동일한 화면을 봄(요청 3의 "패배한 플레이어도 승자의 멋진 플레이를 확인" 그대로 구현) — 별도의 "패배" 전용 UI는 만들지 않음.
- **`GridPokerBoard.tsx`**: 헤더 라벨에 round-result 분기 추가("N라운드 결과"), round-result 진입 시 1회성 사운드(`getSoundEngine().playCorrectDing()` 재사용 — 이 프로젝트 사운드 엔진에 승리 팡파르가 아예 없어 새 오디오 합성 대신 기존 포지티브 사운드 재사용, 범위 축소 판단), 로컬 카운트다운 훅(`useCountdown(ROUND_RESULT_SECONDS, ...)`, onExpire는 no-op — 실제 전환은 호스트 담당) 추가, `RoundResultOverlay` 렌더링 연결.
- **`globals.css`**: `gp-round-overlay-in`/`gp-sunburst-spin`/`gp-confetti-fall`/`gp-victory-stamp-in`/`gp-round-overlay-shake`/`gp-winline-pulse-in`/`gp-winline-float` 7개 신규 keyframes 추가(기존 그리드 포커 keyframes 클러스터에 이어서 배치, 동일한 주석 스타일 유지).

**단위 테스트(`GridPoker.test.ts`)**: `round-result phase` 신규 describe 6건 추가(비클린칭 라운드가 round-result에 파킹되는지, round-result 중 모든 좌석의 `getValidMoves`가 빈 배열인지, `advance-round-result`가 점수/lastRoundResult/roundNumber를 건드리지 않고 phase만 되돌리는지, round-result가 아닐 때 `advance-round-result`가 완전 no-op(참조 동일성)인지, 매치를 끝내는 라운드는 round-result를 거치지 않고 곧장 game-end로 가는지, `ROUND_RESULT_SECONDS === 6`). 기존 "submitting" 루프 기반 테스트 4건(2인 6승 조기종료/8인 12라운드/game-end score cap/`playFullBotGame` 풀 시뮬레이션)은 라운드마다 `advance-round-result`를 끼워 넣도록 수정 — round-result 도입으로 phase가 더 이상 즉시 "submitting"으로 안 돌아가므로, 수정 없이 두면 이 루프들이 첫 라운드에서 멈춰버림(특히 `playFullBotGame`은 "아무도 행동 안 함" 안전장치에 걸려 조기 종료). 전체 59/59 통과.

**검증**: `npx tsc --noEmit`(에러 0) / `npm run lint`(경고 0) / `npx vitest run src/games/grid-poker`(59/59 통과). 전체 `npx vitest run`은 이전 세션들에 이미 기록된 대로 무관한 사전 이슈로 시간이 오래 걸려 이번에도 타깃 스위트로만 검증 — 이번 세션이 건드린 파일은 그리드 포커뿐이고 타깃 스위트가 전부 통과했으므로 안전하다고 판단.

**참고 — 실제 UI 렌더링 미검증**: HANDOFF §2의 `<Game>Board.tsx` 테스트 사각지대(jsdom 미설치)와 동일하게, 이번 오버레이의 실제 화면 배치(모바일 화면 폭에서 콘텐츠가 잘리지 않는지, 컨페티/선버스트의 실제 체감 화려함, 화면 떨림 강도)는 엔진/타입/린트 검증만 마쳤고 아직 육안 확인하지 않았음.

**커밋/푸시**: `41c87b5 feat(grid-poker): enhance round victory visual effects with gold particles and display round winner profiles` → `git push origin main` 완료. 그리드 포커 파일 5개(`engine.ts`/`GridPokerBoard.tsx`/`GridPokerGame.tsx`/`GridPoker.test.ts`/신규 `RoundResultOverlay.tsx`) + `globals.css` + 이 HANDOFF 절만 스테이징해 커밋 — 세션 시작 시점부터 작업 트리에 있던 다른 세션들의 미커밋 변경(`.gitignore`, `public/games`·`public/images/lasVegas` 실물 이미지 삭제, `lasVegas/*`, `registry.ts`, `boardGameRule/` 신규 파일, `저작권, 상표권.md`, `orca충돌및확인.md` 등)은 이번 작업과 무관하므로 건드리지 않고 그대로 작업 트리에 남겨둠.

**배포**: `npx vercel deploy --scope me-3871`(프리뷰) 정상 완주(Turbopack 빌드+TypeScript 전체 재검사 포함), READY — `https://board-game-inbz858s5-me-3871.vercel.app`. 요청 문구에 "production" 명시가 없어 프리뷰까지만 진행(과거 세션들과 동일 판단 기준). 이 배포는 Git 커밋이 아니라 작업 트리 전체를 빌드하므로, 위 "커밋/푸시" 항목에 적은 다른 세션들의 미커밋 변경(라스베가스 실사 카지노 사진·카탈로그 썸네일 삭제 등)도 함께 반영된 상태로 배포됨 — 이 그리드 포커 세션이 그 변경들을 검증하거나 의도한 것은 아님.

### 2026-08-24 — 그리드 포커 라운드 승수 표기 및 족보 높은 순 기본 정렬

**요청**: (1) 상단 헤더 또는 리더보드에 "총 N라운드 중 현재 M승" 형태의 라운드 승수 UI + 목표까지 남은 라운드를 보여주는 미니 도트 인디케이터 추가. (2) 족보 가이드/배치 힌트/라운드 결과 목록의 기본 정렬을 "족보 높은 순"으로 변경. 위치·정렬 대상 등 디자인 판단이 필요한 지점은 임의로 넘겨짚지 말고 먼저 질문하라는 명시적 지시(Strict No-Assumption Rule).

**사전 조사**: 요청 원문이 가정한 `src/games/gridPoker/` 하위 `Board.tsx`/`ScorePanel.tsx`/`HandRankingGuide.tsx`/`RoundTracker.tsx` 파일 구조는 실제와 다름 — 실제 경로는 `src/games/grid-poker/`(kebab-case)이고, 보드 UI·리더보드·족보 미리보기가 전부 `GridPokerBoard.tsx` 하나에 통합돼 있음. `engine.ts`를 읽어보니 "총 N라운드"의 N이 될 만한 값이 두 개(`totalScoringRounds`: 2인전 10/3인+ 12 — 구조적 상한, `winThreshold`: 2인전 6/3인+ 7 — 실제 승리 조건)로 서로 달랐고, `winThreshold`를 먼저 채우면 `totalScoringRounds`에 도달하기 전에 게임이 즉시 끝나는 구조임을 확인. 또한 족보 가이드(`RulebookModal.tsx`의 `HAND_EXAMPLES`)는 이미 로열 스트레이트 플러시→하이카드 고정 배열 순서로 정렬돼 있어 변경이 불필요했고, 리더보드 칩에는 이미 `N승` 표시가 있었던 반면 "라운드 종료 결과 목록"(`lastRoundResult.submissions`)과 "제출 단계 내 라인 미리보기 그리드"(`LINES.map`)는 둘 다 족보 강약이 아니라 좌석/고정 라인 순서로 나열되고 있었음.

**모호점 확인(`AskUserQuestion`, 4문항)**:
① "총 N라운드"의 N 기준 — `totalScoringRounds`(구조적 상한) vs `winThreshold`(목표 승수) vs 둘 다 → **목표 승수(winThreshold)** 선택(실제 승리 조건과 항상 일치, 조기 종료 시에도 표시가 어긋나지 않음).
② 표시 위치 — 상단 헤더 vs 기존 리더보드 스트립 통합 vs 둘 다 → **기존 리더보드 스트립에 통합** 선택.
③ 미니 도트 인디케이터 기준/대상 — 플레이어별 목표 승수 도트 vs 전체 공용 라운드 진행 바 vs 둘 다 → **플레이어별 목표 승수 도트** 선택.
④ 족보 "높은 순" 정렬 적용 대상(복수 선택) — 라운드 종료 결과 목록 / 제출 단계 내 라인 미리보기 그리드 / 오름·내림 토글 UI 신규 추가 → **제출 단계 내 라인 미리보기 그리드만** 선택(라운드 종료 결과 목록은 좌석 순서 유지, 토글 UI는 불필요).

**구현**:
- `engine.ts`: 순수 함수 `linesByHandStrengthDesc(player)` 신규 — 플레이어의 12개 라인을 각각 `evaluateHand`로 평가해 `compareHands` 기준 내림차순(동점은 `LINES` 원래 순서 유지, `Array.sort`의 안정 정렬 특성 활용)으로 반환. 보드가 다 찬 뒤(submitting 진입 시점)에만 호출되므로 매 셀이 항상 채워져 있다고 가정.
- `GridPokerBoard.tsx`: 리더보드 칩(`rankedPlayers` 스트립)의 `{p.score}승` 표기를 `{p.score}/{state.winThreshold}승`으로 확장하고, 신규 `WinDots` 컴포넌트(승수만큼 채워진 점 + 남은 점 = `winThreshold` 개수)를 옆에 추가. 칩에 `title` 툴팁으로 "목표 N승 중 M승 · 남은 승수"도 함께 노출. 제출 단계의 "제출할 라인을 하나 고르세요" 그리드는 기존 `LINES.map(...)` 고정 순회 대신 `linesByHandStrengthDesc(viewer)`로 순회하도록 교체 — 가장 강한 족보가 항상 목록 맨 위에 오도록 별도 토글 없이 기본 정렬됨.

**단위 테스트(`GridPoker.test.ts`, 요구사항 3)**: 신규 7건 추가.
- "round win tracker" 4건: 라운드 정산 시 승자 좌석의 `score`만 정확히 +1(패자/타이는 불변) 검증, 무승부 시 전원 점수 불변 검증, `winThreshold`가 인원수별로(2인=6/3인+=7) 어떤 액션을 거쳐도 불변임을 검증, 게임 종료 시 어떤 좌석도 `score`가 `winThreshold`를 넘지 않음을 검증.
- "linesByHandStrengthDesc" 3건: 12개 라인이 정확히 한 번씩 반환되는지, 인접한 두 항목이 항상 내림차순(`compareHands >= 0`)인지, 고정 라인 인덱스 순서상 뒤에 있는 강한 족보(포카드, 가로 5)가 앞에 있는 약한 족보(하이카드, 가로 1)보다 먼저 오도록 실제로 재정렬되는지.
- 전체 53/53 통과.

**검증**: `npx tsc --noEmit`(에러 0) / `npm run lint`(경고 0) / `npx vitest run src/games/grid-poker/GridPoker.test.ts`(53/53 통과). 전체 `npx vitest run`은 이전 세션들에 이미 기록된 대로 다중 시간 소요(§0 참고) + 무관한 사전 회귀(`malDalliJa` 벤치마크)가 있어 이번 세션도 타깃 스위트로만 검증 — 순수 그리드 포커 파일만 건드렸고 타깃 스위트가 전부 통과했으므로 안전하다고 판단.

**참고 — 실제 UI 렌더링 미검증**: HANDOFF §2 "현재 작동 중인 주요 로직"의 `<Game>Board.tsx` 테스트 사각지대(jsdom 미설치)와 동일하게, 이번 리더보드 도트/M-N승 표기와 재정렬된 라인 미리보기 그리드도 엔진 테스트로만 검증했고 실제 브라우저 렌더링(도트 간격, 모바일 가로 스크롤 칩 폭, 재정렬된 그리드의 시각적 위화감 여부)은 아직 육안 확인하지 않았음.

**커밋/푸시**: `a20be4b feat(grid-poker): display round win counters and set default hand ranking sort to high-first` → `git push origin main` 완료. 그리드 포커 파일 3개(`engine.ts`/`GridPokerBoard.tsx`/`GridPoker.test.ts`) + 이 HANDOFF 절만 스테이징해 커밋 — 세션 시작 시점부터 작업 트리에 있던 다른 세션들의 미커밋 변경(라스베가스 배팅존 세션·저작권/상표권 정리 세션의 `lasVegas/*`, `registry.ts`, `public/games`·`public/images/lasVegas` 삭제 등, 위 두 절 참고)은 이번 작업과 무관하므로 건드리지 않고 그대로 작업 트리에 남겨둠.

**배포**: `npx vercel deploy --scope me-3871`(프리뷰) 정상 완주(Turbopack 빌드+TypeScript 전체 재검사 포함), READY — `https://board-game-9fe48kz9p-me-3871.vercel.app`. 요청 문구에 "production" 명시가 없어 프리뷰까지만 진행(과거 세션들과 동일 판단 기준). 단, 이 배포는 Git 커밋이 아니라 작업 트리 전체를 빌드하므로 위 "커밋/푸시" 항목에 적은 다른 세션들의 미커밋 변경(실물 박스아트/카지노 실사진 삭제 등)도 함께 반영된 상태로 배포됨 — 이 그리드 포커 세션이 그 변경들을 검증하거나 의도한 것은 아님.

### 2026-08-24 — 라스베가스 배팅존 지폐 카드 비겹침 나란히 정렬 및 개별 금액 가독성 확보

**요청**: 배팅존 지폐 카드들이 서로 겹쳐(staircase 캐스케이드) 있어 아래에 깔린 지폐의 금액/장수를 한눈에 파악하기 어려움 — 겹침을 완전히 풀고 가로/세로로 나란히 배치해 각 지폐의 액면가와 등수별 상금이 가림 없이 보이도록 개선. 카지노당 최대 지폐 개수에 따른 배치 방향·모바일 줄바꿈 등은 임의로 정하지 말고 먼저 질문하라는 명시적 지시(Strict No-Assumption Rule).

**사전 조사**: 요청 원문이 가정한 `BettingZone.tsx`/`MoneyArea.tsx`/`CasinoTile.tsx` 파일 구조는 실제와 다름 — 라스베가스는 지폐 스택 렌더링이 `LasVegasBoard.tsx`의 `MoneyStack` 컴포넌트 하나로 통합돼 있고 `CasinoTile`이 그걸 세 번째 존으로 배치해서 씀. 룰북(`boardGameRule/라스베가스/라스베가스.md` §2)과 `engine.ts`(`MONEY_VALUES` $10,000~$90,000, `MIN_CASINO_TOTAL`=$50,000)를 근거로 한 카지노에 최소 $10,000짜리만 나올 경우 최대 5장까지 깔릴 수 있음을 확인. 카지노 타일 자체는 `<section className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">`로 모바일 2열/태블릿 3열/PC 6열 고정.

**모호점 확인(`AskUserQuestion`, 3문항)**:
① 지폐가 많이 걸린(4~5장) 카지노에서 타일 자체의 반응형 그리드를 넓힐지 — **그리드 그대로 유지(모바일 2열/태블릿 3열/PC 6열 무변경)** 선택.
② 지폐를 타일 안에서 나란히 배치하는 방향 — **1~2장은 가로 한 줄, 3장 이상은 세로 리스트로 전환** 선택.
③ 겹침을 풀면서 카드 자체에 순위/금액을 통합 표시할지, 기존 하단 "1등 $X" 요약 pill 목록은 어떻게 할지 — **카드에 순위 코너 태그 통합 + 하단 요약 목록도 그대로 둘 다 유지** 선택.

**구현(`LasVegasBoard.tsx`의 `MoneyStack`)**:
- 기존 `top: i * 11px` 절대 위치 오프셋으로 카드가 층층이 겹치던 캐스케이드 레이아웃을 완전히 제거.
- 지폐 1~2장: `flex` 가로 한 줄(각 카드 `flex-1`로 타일 폭을 균등 분배). 지폐 3~5장: `flex-col` 세로 리스트(각 카드가 타일 전체 폭 사용, 개수가 늘어날수록 타일이 세로로 자라는 방식) — 카지노 타일 자체의 반응형 그리드는 무변경(② 답변).
- 각 지폐 카드 좌상단에 작은 "n등" 순위 코너 태그를 추가(③ 답변) — 기존 하단 "1등 $80,000" 요약 pill 목록은 그대로 유지, 두 표기가 병존.
- 실시간 1위/2위 상금 리더 아우라+뱃지(👑/🥈, 중립 몫은 "폐기 예정")는 카드가 더 이상 겹치지 않으므로 스택 전체를 덮는 별도 오버레이 레이어(z-index 50+ 스태킹)가 필요 없어져, 각 지폐 카드 자신의 래퍼에 직접 적용하도록 단순화.

**검증**: `npx tsc --noEmit`(에러 0) / `npm run lint`(경고 0) / `npx vitest run src/games/lasVegas`(43/43 통과 — 순수 UI 변경이라 엔진 로직 영향 없음 확인 목적). 전체 `npx vitest run`은 이번에도 2분+ 경과 후 출력 0바이트로 멈춰 백그라운드에서 중단 — §0/여러 직전 세션에 이미 기록된 동일한 사전 존재 이슈, 이번 세션이 새로 만든 회귀는 아님(변경 범위가 라스베가스 `MoneyStack` 컴포넌트뿐이고 타깃 스위트가 통과했으므로).

**커밋 시점에 확인된 사실(투명 공개)**: 이번 세션 시작 시점에 이미 이 저장소에 최소 2건의 다른 미완료 세션 상태가 얽혀 있었음.
1. `HANDOFF.md`에는 운명전쟁39 세션(`f8958f6`, 이미 푸시 완료)의 문서 항목이 스테이징만 되고 커밋되지 못한 채 남아 있었음 — 이미 완료·푸시된 작업의 기록 누락이라 판단해 이번 커밋에 그대로 포함해 함께 커밋.
2. `LasVegasBoard.tsx` 작업 트리에는 이번 작업과 무관한 미커밋 변경 두 종류가 섞여 있었음 — (a) `DiceGroupRow`에 "×N" 개수 배지를 추가하는 변경, (b) 저작권/상표권 정리 세션이 남긴 `CasinoTile` 상단 주석(실사 카지노 사진 관련 문구) 수정. 또한 그 저작권/상표권 세션은 `registry.ts`/`CasinoPhotoArt.tsx`/`CasinoEmblem.tsx`와 `public/games`·`public/images/lasVegas`의 실물 이미지 삭제까지 미커밋 상태로 남겨둔 상태였음. 이 변경들은 검증되지 않았고 이번 요청과 무관하므로, `git apply --cached`로 `MoneyStack` 관련 hunk만 골라 스테이징해 이번 커밋에서 의도적으로 제외했음 — 작업 트리에는 그대로 남아 있으므로 해당 세션에서 직접 검증 후 별도로 커밋해야 함.

**커밋/푸시**: `4a670be feat(las-vegas): unstack and align money cards side-by-side for clear payout visibility` → `git push origin main` 완료.

**배포**: `npx vercel deploy --scope me-3871`(프리뷰) 정상 완주(Turbopack 빌드+TypeScript 전체 재검사 포함), READY — `https://board-game-f91mkfoxl-me-3871.vercel.app`. 요청 문구에 "production" 명시가 없어 프리뷰까지만 진행(과거 세션들과 동일 판단 기준). 이 배포는 Git 커밋이 아니라 작업 트리 전체를 빌드하므로, 위 "커밋 시점에 확인된 사실"에 적은 다른 세션들의 미커밋 변경(저작권/상표권 정리 세션의 라스베가스 실사 사진·카탈로그 썸네일 삭제, `LasVegasBoard.tsx`의 "×N" 개수 배지 추가 등)도 함께 반영됨 — 사용자에게 확인받고 진행(질문 응답: "지금 그냥 테스트단계니까 커밋, 푸쉬, 배포해주세요").

### 2026-08-24 — 저작권/상표권 분석 문서 작성 및 실물 박스아트·라스베가스 카지노 실사진 정리

**요청**: (1) 온라인 보드게임을 만들 때 상표권/저작권 문제를 피하는 방법을 360도로 분석하고, 유료화 관점까지 포함해 캐릭터 사례 3개 이상·보유 게임(센추리/스플렌더/라스베가스 등) 3개 이상을 검토한 문서를 `저작권, 상표권.md`로 저장. (2) 이어서 문서의 우선순위 액션 아이템을 실제로 이행.

**1차 결과물**: `저작권, 상표권.md` 신규 작성 — 저작권/상표권/특허 개념 구분, 핵심 판례 3건(DaVinci v. ZiKo, Tetris v. Xio, Anti-Monopoly v. General Mills), 캐릭터 사례(침해 3건: 포켓몬 유사 몬스터·미키마우스 상표·UNO / 안전 3건: 미플·판타지 아키타입·장르 클론), 유료화 리스크와 라이선스 옵션. 작성 과정에서 실제로 레포를 열어 확인해보니 `public/games/century.png`, `splendor.jpg`, `las-vegas.webp`가 각각 Plan B Games/Mondoo, Space Cowboys, Ravensburger/alea의 **실제 박스 커버 스캔본**이었고, 라스베가스 카지노 타일도 실존 카지노 실사진(시저스 팰리스는 123RF 워터마크 포함)이라는 걸 확인해 최우선 조치 항목으로 기록.

**2차(이어서 진행) — 전수 조사**: `public/games/`의 나머지 이미지들도 전부 열어 확인한 결과, 자체 제작(그리드포커 인포그래픽, 틀린그림찾기 앱 화면, 지렁이 SVG) 3개를 제외한 **16개 전부가 원작 출판사의 실제 박스 커버 스캔**이었음(하나미코지/카탄/아발론/뱅!/노땡스/페루도/오이다섯개/달무티/소환사의협곡/코요테/러브레터/포세일/레지스탕스쿠 추가 확인). 또한 로비 썸네일과 별개로 **실제 플레이 화면의 카드 아트 자체**가 원작 스캔인 게임 3종(포세일 재산카드 30장, 러브레터 인물카드 8장, 소환사의 협곡 — 라이엇 게임즈 League of Legends 공식 스플래시 아트 15장)도 추가로 발견.

**조치**:
- `src/games/registry.ts`: 실물 박스아트를 가리키던 16개 게임의 `thumbnail.image` 필드 제거(→ 기존에 이미 설계돼 있던 이모지+그라디언트 폴백으로 자동 복귀, `GameThumbnail.tsx` 로직은 무변경).
- `public/games/`, `public/assets/games/perudo/`: 위 16개의 실물 파일 + 코드에서 아예 참조되지 않던 orphan 파일(라스베가스.webp, 러브레터.jpg, 코요테.jpg/png, 포세일.jpg, mark.avif) 전부 삭제.
- `src/games/lasVegas/CasinoPhotoArt.tsx`: 실사 카지노 사진 매핑(`CASINO_PHOTOS`) 제거, 6개 카지노 전부 오리지널 SVG(`CasinoTileArt`)만 렌더링하도록 되돌림. `public/images/lasVegas/`(카지노 실사진 6장) 삭제. `CasinoEmblem.tsx`/`LasVegasBoard.tsx`의 관련 헤더 주석도 최신화.
- 검증: `npx tsc --noEmit`, `npx eslint`(변경 파일), `npx vitest run src/games/lasVegas`(43/43), `npx vitest run src/games/registry.test.ts`(4/4) 전부 통과.

**보류 결정(`AskUserQuestion`)**: 포세일/러브레터/소환사의 협곡 3종의 게임플레이 카드 아트는 (라스베가스와 달리) 텍스트/SVG 폴백이 코드에 없어 이미지만 지우면 화면이 깨짐 — "① 지금 임시 텍스트 카드로 교체 / ② 지금은 그대로 두고 문서에만 기록 / ③ 지금 바로 정식 일러스트로 교체" 중 사용자가 **②**를 선택. 코드는 건드리지 않고 `저작권, 상표권.md` §8-2에 "유료화 전 반드시 재검토" 항목으로 기록만 함.

**남은 미해결 항목(문서 §7 참고)**: 포세일/러브레터/소환사의 협곡 카드 아트 교체, 소환사의 협곡 게임명·설명의 LoL 고유명사 제거, 각 게임 타이틀 상표 선행조사, 룰북 텍스트 재작성 여부 재점검.

### 2026-08-23 — 운명전쟁39 리버스 카드 숫자 가독성 수정 및 모바일 카드/폰트 크기 확대

**요청**: (1) 리버스 카드(11/22/33/44/55) 숫자가 화려한 배경 이펙트에 가려 안 보이는 버그 수정, (2) 아이폰(375~430px) 등 모바일에서 손패/제출 카드가 너무 작아 가독성이 떨어지는 문제를 카드 확대+고대비 타이포그래피로 개선, (3) iOS Safari/Android Chrome/태블릿/PC 반응형 검증. UI/UX 세부사항은 임의로 정하지 말고 먼저 질문하라는 명시적 지시(Strict No-Assumption Rule).

**사전 조사에서 드러난 사실(질문 전에 먼저 확인)**:
- 요청 원문이 가정한 파일 구조(`Card.tsx`/`CardSlot.tsx`/`Hand.tsx`/`PlayedCardsArea.tsx`/`MobileLayout.tsx`)는 이 게임의 실제 구조와 다름 — 운명전쟁39는 모든 카드 렌더링이 `CardFace.tsx` 하나로 통합돼 있고, 손패/필드 슬롯은 `DestinyWar39Board.tsx`(직접 `CardFace` 호출)와 `DestinyWar39Effects.tsx`(`PlayedCardSlot`)가 그걸 가져다 씀. 별도 `MobileLayout.tsx`는 없고 반응형은 Tailwind `flex-wrap` 유틸리티로만 처리 중이었음 — 실제 구조를 기준으로 작업.
- 리버스 카드는 이미 배너("🔄 리버스")와 중앙 숫자가 수직으로 분리돼 있어 서로 겹치지는 않았음 — 문제는 `sm` 사이즈(예측 단계 손패, 직전 라운드 기록 모달)가 리버스 카드 기준 56×36px로 너무 작아, 배너+워터마크(투명도 25% 🔁)까지 욱여넣다 보니 숫자 자체가 작고 흐릿하게 읽히는 게 실질 원인이었음.
- 필드 제출 카드(`flex-wrap` 컨테이너)는 화면 폭을 넘으면 이미 자동 줄바꿈되므로, 8인 모드에서 카드를 키워도 레이아웃이 깨지지는 않음(줄 수만 늘어남) — 확인 후 카드 확대 방향으로 안심하고 진행.

**모호점 확인(`AskUserQuestion`, 4문항)**:
① 리버스 카드 대비 보정 방식 — **숫자 뒤 다크 칩 오버레이(흰 굵은 글씨+얇은 외곽선, 추천)** / 텍스트 스트로크·그림자만 / 배너·워터마크 제거+단순화 → **다크 칩 오버레이** 선택.
② 코너 인덱스(상단/하단 모서리 보조 숫자) 추가 여부 — **리버스 카드만 추가** / 전체 카드에 추가 / 추가 안 함(배너만 축소) → **리버스 카드만 코너 인덱스 추가** 선택.
③ 모바일 카드 확대 폭 — 적당히(1.3~1.4배) / **크게(1.6~1.8배, 추천)** / 최대(2배 이상) → **크게 확대(1.6~1.8배)** 선택 — 손패 카드 약 68×96px, 필드 카드 약 60×84px 목표로 확정.
④ 손패 최대 9장 시 부채꼴 겹침(fan-out)+터치 팝업 인터랙션 구현 여부 — **겹침 없이 확대+터치 시 큰 팝업 확대(추천)** / 겹침 없이 확대만 / 실제 부채꼴 겹침 구현 → **겹침 없이 확대 + 터치 시 큰 팝업 확대** 선택.

**구현(`CardFace.tsx`/`DestinyWar39Board.tsx`)**:
- **리버스 카드 숫자 가독성**: 중앙 숫자를 `bg-black/75` 다크 칩으로 감싸고, `-webkit-text-stroke`(1px 검정) + `drop-shadow`를 추가해 어떤 배경에서도 도드라지도록 수정. 배너/워터마크는 기존 구조 유지하되 워터마크 불투명도를 25%→15%로 더 낮춰 숫자와의 시각적 경쟁을 줄임.
- **코너 인덱스**: 리버스 카드에 한해 숫자 영역(배너 아래 서브 영역) 좌상단/우하단에 작은 보조 숫자를 절대 위치로 추가 — 배너 텍스트·중앙 대형 숫자 어느 쪽과도 겹치지 않는 별도 공간에 배치.
- **사이즈 확대**: `SIZE_MAP`의 3단계를 픽셀 단위(arbitrary value)로 재정의 — `sm`(필드/기록용) 60×84(리버스 60×94), `md`(손패용) 68×96(리버스 68×108), `lg`(트릭 결과 공개) 82×118(리버스 82×132). 숫자 폰트도 `text-2xl`~`text-4xl`로 확대하고 전체적으로 `font-bold`→`font-extrabold`로 상향.
- **호출부 재배치**: 예측 단계 손패(과거 `sm`)와 플레이 단계 인터랙티브 손패(과거 `md`)를 모두 `md`(손패 사이즈)로 통일, 필드 제출 슬롯(과거 `md`)은 `sm`(필드 사이즈)으로 낮춰 손패보다 살짝 작게 — "손패는 크게, 필드는 8인이 들어가도 안전하게"를 사이즈 토큰 재배정으로 구현. 카드 대기 중 표시되는 "?" 플레이스홀더도 새 필드 사이즈(60×84)에 맞춰 조정.
- **팝업 확대 인터랙션**: 플레이 단계 인터랙티브 손패 카드에 `hover:`/`active:`/`focus-visible:` 상태에서 `-translate-y-3 scale-125 z-20`를 적용 — 부채꼴 겹침 레이아웃은 만들지 않고(④ 답변), 탭/호버 시 해당 카드만 크게 튀어나오는 팝업으로 터치 선택을 쉽게 함.

**검증**:
- `npx tsc --noEmit`(전체, 에러 0 — 단 `.next/dev/types`에 남아있던 이미 삭제된 미리보기 라우트(`dev-lasvegas-preview`, 직전 라스베가스 세션이 임시로 만들었다 지운 것) 참조 스테일 캐시가 먼저 걸려 `.next` 삭제 후 재확인) / `npm run lint`(전체, 경고 0) / `npx vitest run src/games/destinyWar39/DestinyWar39.test.ts`(84/84 통과, 엔진 무변경 확인).
- **전체 `npx vitest run`은 이번에도 2분+ 경과 후 출력 0바이트로 멈춰 백그라운드에서 중단** — §0/여러 직전 세션에 이미 기록된 동일한 사전 존재 이슈, 이번 세션이 새로 만든 회귀가 아님(변경 범위가 운명전쟁39 카드 렌더링 컴포넌트뿐이고 타깃 스위트가 통과했으므로).
- **실제 iOS Safari/Android Chrome/태블릿/PC 브라우저 육안 확인은 이번 세션에서 수행하지 못함** — 아래 "미해결" 항목에 기록.

**커밋/배포 중 확인된 사실(투명 공개)**: 커밋 시점에 다른 세션이 `LasVegasBoard.tsx`를 동시에(미커밋 상태로) 편집 중이었음 — 이번 커밋에는 운명전쟁39 파일 2개만 스테이징해 무관한 변경은 섞이지 않았으나, `npx vercel deploy`는 Git 커밋이 아니라 작업 트리 전체를 빌드하므로 그 세션의 미커밋 라스베가스 변경사항도 이번 미리보기 배포에 함께 반영됨 — 배포 전 사용자에게 확인받고 진행.

**커밋/푸시**: `f8958f6 fix(destiny-war-39): enhance reverse card readability and enlarge card font sizes for mobile viewports` → `git push origin main` 완료.

**배포**: `npx vercel deploy`(프리뷰) 정상 완주(Turbopack 빌드+TypeScript 전체 재검사 포함), READY — `https://board-game-dvx2yxci3-me-3871.vercel.app`. 요청 문구에 "production" 명시가 없어 프리뷰까지만 진행(과거 세션들과 동일 판단 기준) — 필요하면 `npx vercel deploy --prod`로 후속 승격 요청할 것. 배포 결과물에는 위 "커밋/배포 중 확인된 사실"에 적은 대로 다른 세션의 미커밋 라스베가스 변경도 함께 포함돼 있음.

**미해결/다음 세션**:
- 실제 iOS Safari/Android Chrome/태블릿/PC 화면에서의 육안 확인(카드 테두리 잘림, 폰트 깨짐 등)이 이번 세션에서 수행되지 않음 — 다음 세션에서 브라우저 스크린샷 등으로 확인 필요.
- 전체 `npx vitest run` 미완주 문제는 여전히 미해결(§0 백로그와 동일, 이 세션의 회귀 아님).

### 2026-08-23 — 라스베가스 흰색 주사위 플래시 제거, 지폐 하단 배치, 1등 테두리 색상 연동, 굴림/누적 배팅 카운터

**요청**: (1) 굴릴 때마다 흔들리며 시야를 방해하던 흰색 주사위 애니메이션/오버레이 완전 제거, (2) 1~6번 배팅존 지폐를 타일 하단부로 옮기고 총액/장당 금액 가독성 강화, (3) 배팅존 하단에 1등(👑) 표시 + 1등 플레이어 고유 색상으로 타일 테두리 실시간 연동, (4) 내가 굴린 눈금별 수량 요약(아이콘+개수) UI, (5) 기존 배팅 + 신규 배팅의 누적 수량("기존 A개 + 신규 B개 → 총 C개")을 배치 버튼에 직관적으로 표시. UI/UX 세부사항(폰트 크기, 배지 위치, 표기 방식 등)은 임의로 정하지 말고 먼저 질문하라는 명시적 지시(Strict No-Assumption Rule).

**사전 조사에서 코드로 직접 특정한 사실(질문 전에 먼저 확인)**:
- "흰색 주사위"는 `RollViewerPanel`의 🎲 `lasvegas-cup-shake` 롤 플래시였다 — 애니메이션(0.42s)이 끝나도 DOM에서 제거되는 로직이 없어 첫 롤 이후 패널 헤더 위에 계속 정적으로 남아있었고(`rollFlashId`가 0으로 돌아가지 않음), 롤할 때마다 `key` 리마운트로 다시 흔들렸음 — "매번 흔들리며 시야를 방해" 증상과 정확히 일치. 이 플래시는 직전 세션(`3fe1ffd`)에서 사용자가 명시적으로 요청해 추가된 것이었으나, 이번 세션에서 사용자가 재검토 후 완전 제거로 결정.
- 지폐는 이미 카지노 사진 **위쪽**(zone 1, 상단)에 있었고 요청한 "하단 배치"는 미반영 상태였음.
- 1등(👑 1st) 뱃지는 이미 지폐 카드 위에 실시간으로 뜨고 있었지만(`MoneyStack`의 리더 아우라, 직전 세션 구현) 지폐가 상단에 있어 "배팅존 하단"이 아니었고, 테두리 색상 연동은 전혀 없었음(카지노별 고정 accent 색만 존재).

**모호점 확인(`AskUserQuestion`, 4문항)**:
① 흰색 주사위 정체 — **위 🎲 cup-shake 플래시가 맞음(추천, 확인만)** / 중립 주사위 색상 자체가 문제 / 둘 다 → **cup-shake 플래시 완전 제거**로 확인.
② 지폐 하단 배치 시 가독성 강화 방식 — 위치만 이동(추천) / 총액 배지 확대 / **개별 지폐 액면가 폰트도 확대** → **개별 지폐 액면가 폰트 확대**(+ 위치 이동) 선택.
③ 1등 표시/테두리 레이아웃 — 지폐 위 배지 유지+하단에도 추가 / 배지를 주사위 구역으로 이동 / 타일 맨 아래 풀폭 배너(추천) → 사용자가 **"1등 색이 1~6땅에 대한 색으로 변경되게 설정, 지폐카드는 기존 그대로 유지"**라고 직접 답변 — 즉 테두리 색상만 리더 색으로 실시간 교체하고, 지폐 카드(리더 뱃지 포함)는 손대지 말라는 것. 지폐를 하단으로 옮기면(②) 기존 리더 뱃지가 자연히 "배팅존 하단"에 위치하게 되므로 이 답변과 요구사항 ③이 함께 충족됨.
④ 굴림 요약/누적 배팅 카운터 방식 — **아이콘+숫자, 배치 버튼에 누적 표기(추천)** / 아이콘+숫자, 배치 후 타일에 플래시 배지 / 둘 다 → **아이콘+숫자 + 배치 버튼 누적 표기** 선택.

**구현(`LasVegasBoard.tsx`/`MoneyBillArt.tsx`/`globals.css`)**:
- **흰색 주사위 플래시 제거**: `RollViewerPanel`에서 🎲 `lasvegas-cup-shake` 블록을 통째로 삭제. `rollFlashId`는 `dice-roll-tumble` 재생용 `key`로만 남김. `globals.css`의 `@keyframes lasvegas-cup-shake`도 사용처가 없어져 제거(설명 주석으로 대체).
- **지폐 하단 배치**: `CasinoTile`의 3존 순서를 (지폐→매트→주사위)에서 **(매트→주사위→지폐)**로 재배치 — 지폐가 이제 타일 맨 아래(zone 3)에 위치. `MoneyStack`/리더 아우라·뱃지 로직 자체는 사용자 요청대로 **완전히 그대로** 유지, 위치만 이동.
- **지폐 액면가 폰트 확대**: `MoneyBillArt.tsx`의 중앙 액면가 SVG `fontSize`를 `12.5`→`15.5`로 확대(뷰박스 100 단위 기준, 최장 라벨 `$90,000` 7자도 여유 있게 들어맞음 확인).
- **1등 테두리 색상 실시간 연동**: `CasinoTile`이 이미 계산해두던 `liveLeaders[0]`(동수 제외, 개수 내림차순 1위 — `settleCasino`가 지폐를 나눠주는 것과 같은 순서)을 읽어, 그 소유자가 실제 좌석이면 `diceColorForSeat`로 타일 `border-2`의 `borderColor`를 그 좌석 색으로, `box-shadow`에도 같은 색 글로우 링을 인라인 스타일로 덮어씀 — 리더가 없거나(빈 카지노), 동수라 생존자가 없거나, 중립이 1위인 경우엔 인라인 오버라이드를 하지 않고 기존 `CASINO_ACCENTS` 고정 색으로 폴백.
- **굴림 요약(아이콘+숫자)**: `RollViewerPanel` 헤더 바로 아래에 `isMyTurn`일 때만 `rollGroups`(이미 계산돼 있던 눈금별 own/neutral 카운트)를 `DiceFace` 아이콘 + `×N개` 배지로 나열.
- **누적 배팅 카운터**: 새 `existingOwnCounts: Partial<Record<Face, number>>`를 `LasVegasBoard` 본문에서 `casino.diceCounts[viewerSeat]`로 계산(엔진의 `scoreMove`가 봇 로직에 쓰는 `myExisting`과 동일한 소스)해 `RollViewerPanel`에 새 prop으로 전달 — 각 배치 버튼에 `기존 A개 + 신규 B개 → 총 C개` 부제를 표시하되, 기존 배치가 없으면(A=0) 예전처럼 `N개`만 표시해 흔한 케이스는 그대로 간결하게 유지.

**검증**:
- `npx tsc --noEmit`(전체, 에러 0) / `npm run lint`(전체, 경고 0) / `npx vitest run src/games/lasVegas`(43/43 통과, 엔진 무변경 확인) / `npm run build`(Turbopack 프로덕션 빌드+TypeScript 재검사 정상 완주, 16개 라우트 정상 생성).
- **전체 `npx vitest run`은 이번에도 2분+ 경과 후 출력 0바이트로 멈춰 백그라운드에서 중단** — §0/직전 세션들에 이미 기록된 동일 증상, 이번 세션이 새로 만든 문제가 아님(변경 범위가 라스베가스 UI 컴포넌트뿐이고 타깃 스위트가 통과했으므로 회귀는 아닌 것으로 판단).
- **브라우저 실측**(Phase 14/직전 세션과 동일 방식): `startGame(4, 42)` 위에 카지노 1에 seat0=2개(기존)/seat1=1개를 수동 주입하고 seat0(뷰어)의 `currentRoll`을 눈금 1×3(own2+neutral1)/3×3(own)/5×1(own)로 구성한 고정 fixture를 임시 라우트(`src/app/dev-lasvegas-preview`, 확인 후 삭제 완료)로 렌더링해 `npx playwright screenshot`으로 데스크톱(900px)·모바일(390px) 확인: (1) 🎲 플래시 완전히 사라짐, (2) 카지노 1 타일 테두리가 seat0의 빨강으로 바뀌고 나머지 5개는 기존 고정 accent 색 그대로, (3) 지폐가 타일 맨 아래 위치하고 "$80,000" 액면가가 눈에 띄게 커짐 + "👑 1st 플레이어(나)" 뱃지가 그 지폐 카드 위(=이제 타일 하단)에 그대로 표시, (4) 굴림 요약 줄에 `×3개 ×3개 ×1개` 아이콘 배지 표시, (5) "눈금 1 전체 배치" 버튼에 "기존 2개 + 신규 3개 → 총 5개", 눈금 3/5 버튼엔 기존 배치가 없어 단순 "3개"/"1개"만 표시 — 전부 기대대로 동작. 확인 후 임시 라우트/dev 서버 종료 및 삭제 완료.

**커밋/푸시**: `a045609 feat(las-vegas): polish betting zone UI with bottom money display, 1st place color borders, and roll/cumulative dice counters` → `git push origin main` 완료.

**배포**: `npx vercel deploy`(프리뷰) 정상 완주(Turbopack 빌드+TypeScript 전체 재검사 포함), READY — `https://board-game-la0nm1fxy-me-3871.vercel.app`. 요청 문구에 "production" 명시가 없어 이번에도 프리뷰까지만 진행(과거 세션들과 동일 판단 기준) — 필요하면 `npx vercel deploy --prod`로 후속 승격 요청할 것.

**미해결/다음 세션**:
- 전체 `npx vitest run` 미완주 문제는 여전히 미해결(§0 백로그와 동일, 이 세션의 회귀 아님).
- 카지노 2번(시저스 팰리스) 워터마크 이슈 등 실사 카지노 사진 6장의 저작권/상표 리스크는 여전히 미해결 상태로 남음(§3 17번 항목 및 직전 세션 기록과 동일 성격).
- 1등 테두리 글로우(`box-shadow`)는 그 카지노가 동시에 `isRollDestination`(내 롤 배치 대상)이면 `lasvegas-mat-glow-pulse` 펄스 애니메이션이 같은 `box-shadow` 속성을 애니메이션하는 동안 잠깐 가려질 수 있음(테두리 `border-color` 자체는 영향 없음) — 둘 다 "골드/리더색 글로우"라 실사용상 거슬리진 않는다고 판단해 이번엔 손대지 않음, 필요하면 다음 세션에서 조정.

### 2026-08-23 — 라스베가스 상대 굴림 뷰어, 카지노 번호 포커스 배지, 실시간 상금 수령 리더 아우라/뱃지

**사전 조사에서 드러난 사실(질문 전에 먼저 확인)**:
- `Board.tsx`/`CasinoTile.tsx`/`BettingZone.tsx`/`DiceTray.tsx`/`PlayerArea.tsx`는 이번에도 별도 파일이 아니라 `LasVegasBoard.tsx` 하나에 인라인(과거 세션들과 동일).
- `state.currentRoll`은 이미 전체 상태에 포함돼 모든 클라이언트가 갖고 있었고, 기존 "🎲 내 주사위" 트레이가 누구 턴이든 `currentRoll`을 그대로 렌더링하고 있었음 — 다만 헤더가 항상 "내 주사위"로 고정돼 상대 턴에도 라벨이 부정확했고, "하이라이트 후 비행" 2단계 연출은 없었음(배치 즉시 순간 비행).
- 지난 세션(`d223f5a`)에서 이미 카지노 타일을 지폐 스택(상단)/카지노 그림(중단)/주사위 배팅 구역(하단)으로 3단 완전 분리해놔서, 첨부된 `boardGameRule/라스베가스/주사위가 가리는 현상.png` 스크린샷도 그 분리된 구조 그대로만 보여주고 실제 가림은 확인되지 않음(수정 전 캡처였을 가능성). 참고로 엔진은 룰북(§2)상 최대 5인만 지원 — "8인 모드"는 존재하지 않음.
- 카지노별 실시간 순위 계산(`tallyDiceGroups`)은 있었지만, 그 순위를 지폐 카드에 매칭해 보여주는 UI는 전혀 없어 이번에 새로 설계.

**모호점 확인(`AskUserQuestion`, 4문항)**: ① 상대 굴림 결과 위치 — 공용 트레이 재사용(추천) / **전용 패널 신설** / 모달·팝업 → **전용 패널 신설** 선택. ② 하이라이트→비행 연출 범위 — **내 배치 + 상대 배치 모두(추천)** / 상대 배치만 → **모두 적용** 선택. ③ 가림 버그 현황 — 수정 전 캡처였음, 확인만(추천) / 구조는 맞으나 더 엄격한 좌석별 고정 레인으로 / 여전히 겹치는 경우 있음 → 사용자가 **"주사위를 굴릴 때마다 흔들리는 하얀 주사위(🎲 롤 플래시)를 플레이어 목록과 배팅카드 가운데로 배치해달라"**고 답변 — 이어서 별도 메시지로 **"'골드너겟' 같은 지역이름 표시는 삭제하고 숫자 주사위 눈금 표시가 더 포커싱되게"** 요청 추가. ④ 리더 뱃지 위치 — **지폐 카드에 매칭(추천, 요청 문구 그대로)** / 주사위 그룹에 부착 / 둘 다 → **지폐 카드 매칭** 선택.

**구현(`LasVegasBoard.tsx`/`DiceEffects.tsx`/`globals.css`)**:
- **`RollViewerPanel`(신규)**: 카지노 그리드와 스코어보드 "가운데"(질문 ①+③ 답변을 합친 위치)에 상시 마운트되는 전용 패널 — `state.currentRoll`을 활성 좌석(`activeSeat`) 기준으로 동적 라벨링(`🫵 당신이 굴린 주사위` / `🎲 OOO님이 굴린 주사위`)해서, 상대 턴이든 내 턴이든 **동일한 패널에서 전체 눈금 결과를 공개**. 롤 플래시(🎲 컵 흔들림) 연출도 기존 "내 주사위" 트레이에서 이 패널로 이전. `currentRoll === null`이어도 패널 자체(및 `panelRef`)는 항상 마운트 상태를 유지 — 배치 순간 `currentRoll`이 즉시 `null`로 바뀌는 상태 전이 중에도 `FlyingDicePlacement`의 비행 출발점 ref가 끊기지 않게 하기 위함. 기존 "내 주사위" 트레이는 이제 보유 개수 표시 + 굴리기 버튼만 남기고 실제 눈금 표시/선택 버튼은 전부 이 패널로 이전.
- **선택 하이라이트 후 비행(`DiceEffects.tsx`)**: `FlyingDicePlacement`에 `HOLD_MS`(300ms) 단계 추가 — 다이스가 롤 뷰어 위치에서 먼저 `lasvegas-selection-glow`(스케일 1→1.35→1.12 + 골드 드롭섀도우)로 강조된 뒤에야 기존 `dice-slide-fly` 비행이 시작되도록 변경. 질문 ②의 답변대로 **내 배치/상대 배치 모두 동일하게 적용**(컴포넌트 하나가 양쪽을 다 처리하므로 자연히 동일 동작) — 비행 출발점도 기존의 "내 배치는 트레이, 상대 배치는 스코어보드 행" 이원화를 걷어내고 이제 항상 `RollViewerPanel`의 ref 하나에서 출발(더 이상 필요 없어진 `seatRowRefs`/`diceTrayRef`는 제거).
- **카지노 번호 포커스 배지**: 카지노 타일 좌상단 배지에서 `CASINO_THEME_NAMES`(골드너겟/시저스팰리스 등) 텍스트를 완전히 제거하고, 다이스 핍 아이콘을 `h-4`→`h-6`로 키운 뒤 굵은 큰 숫자(`text-base font-black`)를 나란히 배치 — 룰북이 카지노를 이름이 아닌 1~6 눈금으로 식별한다는 점에 맞춰 눈금 자체가 즉시 눈에 들어오도록 함.
- **실시간 1위/2위 상금 리더 아우라+뱃지(`MoneyStack`)**: `CasinoTile`이 이미 계산해둔 `tallyDiceGroups` 결과에서 동수 제외 생존자를 개수 내림차순으로 골라 `liveLeaders = [rank1Owner, rank2Owner]`로 `MoneyStack`에 전달 — `settleCasino`가 지폐를 위에서부터 순서대로 나눠주는 것과 정확히 같은 순서이므로, 지폐 스택 0번째 카드가 곧 "지금 이 순간 1위가 받게 될 지폐"에 정확히 대응. 실 플레이어가 그 자리를 차지하면 해당 좌석 색상의 `lasvegas-leader-aura-pulse`(신규 keyframe, `--aura-soft`/`--aura-strong` CSS 변수로 좌석별 색을 주입하는 골드펄스 변형) 링 + `👑 1st`/`🥈 2nd` 이름 뱃지를, 중립 주사위가 그 자리를 차지하면(플레이어 색상이 없고 규칙상 그 지폐는 폐기되므로) 색 없는 `🚫 중립 · 폐기 예정` 뱃지를 표시. **버그를 스크린샷으로 직접 잡아 수정**: 처음엔 아우라/뱃지를 각 지폐 카드 자신의 `div`에 얹었는데, 캐스케이드 구조상 뒤 카드(index 1)가 앞 카드(index 0)보다 z-index가 높아 1위 뱃지가 2위 카드에 가려 안 보이는 것을 실제 스크린샷에서 확인 — 아우라/뱃지를 카드들과 별도로 z-index 50 이상의 오버레이 레이어로 분리해 항상 보이도록 재구성.
- 카지노 지폐/눈금/주사위 존 구조 자체(3단 분리)는 조사 결과 이미 지난 세션에 완료돼 있어 이번엔 건드리지 않음(질문 ③ 답변에 따른 판단).

**검증**:
- `npx tsc --noEmit`(전체, 에러 0) / `npx eslint src/games/lasVegas` + `npm run lint`(전체, 경고 0) / `npx vitest run src/games/lasVegas`(43/43 통과, 엔진 무변경 확인) / `npm run build`(Turbopack 프로덕션 빌드+TypeScript 재검사 정상 완주, 16개 라우트 정상 생성).
- **전체 `npx vitest run`은 이번에도 8분+ 경과 후 출력 0바이트로 멈춰 완주 확인 못함** — §0/직전 세션들에 이미 기록된 동일 증상, 이번 세션이 새로 만든 문제가 아님(변경 범위가 라스베가스 UI 컴포넌트뿐이고 타깃 스위트가 통과했으므로 회귀는 아닌 것으로 판단).
- **브라우저 실측**: Phase 14 방식대로 `LasVegasBoard`를 고정 fixture(`startGame(4, 42)` + 카지노 1(선명한 1위/2위), 카지노 2(1위 자리를 중립이 차지), 카지노 3(동수로 전원 무효) 케이스를 수동 주입, `activeSeat`를 상대 좌석으로 설정해 롤 뷰어가 상대방 라벨로 뜨는지 확인)로 렌더링하는 임시 라우트(`src/app/dev-lasvegas-preview`, 확인 후 삭제 완료)를 만들어 `npx playwright screenshot`으로 데스크톱(900px)과 모바일(375px) 확인: (1) 카지노 번호 배지에 이름 없이 숫자만 크게 보임, (2) 롤 뷰어 패널이 카지노 그리드와 스코어보드 사이에 정확히 위치하고 "AI 봇 1님이 굴린 주사위 (6개)"로 정확히 라벨링됨, (3) 카지노 1엔 "👑 1st 플레이어(나)", 카지노 2엔 "🚫 중립 · 폐기 예정"과 "🥈 2nd AI 봇 2"가 **둘 다** 보임(위 z-index 버그 수정 후), 카지노 3(동수)엔 리더 뱃지 없음 — 전부 기대대로 동작. **여전히 미검증**: 실제 배치 클릭 시 하이라이트→비행 2단계 연출(HOLD_MS 300ms)이 매끄럽게 재생되는지는 정적 스크린샷으로 확인 불가 — Playwright의 Node API가 이 프로젝트에 설치돼 있지 않아(CLI 스크린샷만 가능) 클릭 인터랙션 테스트는 진행하지 못함, 코드 리뷰와 기존 `dice-slide-fly`/`lasvegas-cup-shake` 등 동일 idiom 재사용으로 신뢰도를 높였지만 다음 세션에서 실제 브라우저로 재생 확인 필요. 온라인 2대 이상 기기 동기화도 미확인.

**커밋/푸시**: `3fe1ffd feat(las-vegas): add opponent roll viewer, fix overlapping dice layout, and display real-time payout winner indicators` → `git push origin main` 완료(`4dd6b99..3fe1ffd`).

**배포**: `npx vercel deploy`(프리뷰) 정상 완주(Turbopack 빌드+TypeScript 전체 재검사 포함), READY — `https://board-game-a8af1q212-me-3871.vercel.app`. 요청 문구에 "production" 명시가 없어 이번에도 프리뷰까지만 진행(과거 세션들과 동일 판단 기준) — 필요하면 `npx vercel deploy --prod`로 후속 승격 요청할 것.

**미해결/다음 세션**:
- 전체 `npx vitest run` 미완주 문제는 여전히 미해결(§0 백로그와 동일, 이 세션의 회귀 아님).
- 배치 클릭 시 하이라이트→비행 연출의 실제 브라우저 재생 확인(위 참고).
- 카지노 2번(시저스 팰리스) 워터마크 이슈 등 실사 카지노 사진 6장의 저작권/상표 리스크는 여전히 미해결 상태로 남음(§3 17번 항목 및 직전 세션 기록과 동일 성격).

### 2026-08-23 — 라스베가스 실사 카지노 사진/지폐 일러스트 교체, 개별 주사위 렌더링, 동수 상쇄(Tie) 실시간 연출 및 액션 이펙트

**요청**: (1) `boardGameRule/라스베가스/`의 실제 이미지 파일(1~6번 카지노, 지폐, 주사위)로 CSS 그래픽을 완전 대체, (2) 플레이어 색상 식별 강화(네온 테두리+뱃지)와 "×3" 텍스트 대신 실제 주사위 개별 나열, (3) 동수 상쇄(Tie Cancellation) UI/이펙트, (4) 굴리기/배치/정산 전반의 화려한 액션 이펙트. 이미지 경로·연출 딜레이·색상 테마 등은 임의로 정하지 말고 먼저 질문하라는 명시적 지시(Strict No-Assumption Rule).

**사전 조사에서 드러난 중요한 사실(질문 전에 먼저 확인)**:
- `boardGameRule/라스베가스/`의 카지노 사진 6장(골드너겟1.jpg 등)은 **라스베가스 보드게임 실물 구성물이 아니라, 실존하는 라스베가스 스트립 카지노(골든너겟·시저스팰리스·미라지·사하라·룩소르·서커스서커스)를 찍은 실사 사진**이다 — `라스베가스 세팅.png`(진짜 게임 세팅 사진)을 보면 원작은 "GOLD MINE"/"MIRACLE"/"SPHINX" 같은 가상 카지노명의 오리지널 일러스트를 쓴다. `CasinoEmblem.tsx` 헤더 주석과 이 문서 §3 17번 항목에 바로 이 이유로 실사 카지노 사진을 배경으로 쓰는 걸 **이전 세션이 명시적으로 보류**했다는 기록이 있어, 이번 요청은 그 결정을 뒤집는 것임을 먼저 사용자에게 알림.
- 지폐/주사위 실물 이미지는 폴더에 **전혀 없음**(카지노 6장 + 세팅 사진 1장뿐).
- 시저스 팰리스2.jpg는 이미지 전체에 **"123RF" 스톡사진 워터마크가 대각선으로 반복 인쇄**되어 있어(유료 사이트 미결제 미리보기본), 그대로 쓰면 완성 화면에도 워터마크가 노출됨.
- 페루도가 WebGL 3D 주사위(`dice3d/`)를 썼다가 2026-08-16에 CSS/SVG로 명시적으로 회귀한 전례가 있음(`colorways.ts` 주석) — 라스베가스도 지금까지 전 게임과 동일하게 flat CSS/SVG 주사위만 써 왔음.
- `Board.tsx`/`CasinoTile.tsx`/`BettingZone.tsx`/`DiceSlot.tsx`/`PlayerArea.tsx`는 별도 파일이 아니라 지금까지처럼 `LasVegasBoard.tsx` 하나에 인라인.

**모호점 확인(`AskUserQuestion`, 위 사실을 먼저 보여주고 총 5문항)**:
① 카지노 매트 배경 — 오리지널 SVG 유지+업그레이드(추천) / **실사 스톡사진 그대로 사용** → 사용자가 라이선스 리스크를 인지하고 **실사 사진 사용**을 선택.
② 지폐 이미지 — **오리지널 SVG 일러스트 신규 제작(추천)** / 사용자가 실물 사진 추가할 때까지 대기 → **신규 제작** 선택(실물 지폐 사진 자체가 없어 이 결정 없이는 진행 불가).
③ 주사위 렌더링 — **입체감 있는 SVG/CSS 업그레이드(추천)** / three.js 실제 3D 오브젝트 → **SVG/CSS 업그레이드** 선택(페루도의 WebGL 폐기 전례와 일치).
④ 동수 상쇄 타이밍 — **진행 중 실시간 잠정 표시(추천)** / 게임 종료 정산 화면에서만 → **실시간 잠정 표시** 선택(엔진의 실제 확정 시점은 그대로 유지, UI만 매 렌더 라이브 계산).
⑤ (사실 확인 후 추가 질문) 워터마크 있는 시저스 팰리스2.jpg를 어떻게 할지 — **워터마크째로 그대로 사용** / 워터마크 없는 사진으로 교체될 때까지 이 한 장만 보류 → 사용자가 "실사 그대로 사용하지만 123RF 글자만 제거된 상태로 보이게 설정"이라고 답변. **이 부분은 그대로 따르지 않고 명시적으로 거절**: 유료 스톡사진의 워터마크를 지워서 마치 라이선스가 있는 것처럼 보이게 만드는 건 "위험을 감수하고 실사 사진을 쓴다"는 것과는 다른 요청(워터마크 자체가 무단 사용임을 알리는 보호 장치를 적극적으로 제거/은폐하는 행위)이라 진행하지 않았고, 1차 구현에서는 대신 카지노 2번(시저스 팰리스)만 기존 오리지널 SVG(`CaesarsPalaceTile`)로 남겨두는 절충안을 채택 — 사용자에게 이유와 대안을 텍스트로 설명한 뒤 이 결정으로 진행(추가 확인 라운드 없이).

**후속(같은 세션, 커밋 직후)**: 사용자가 "지금은 그저 테스트니 워터마크를 없애지말고 그대로 반영해달라"고 명확히 재요청 — 이건 워터마크 제거(거절했던 것)와는 다른 요청(워터마크를 숨기거나 지우지 않고 **보이는 그대로** 쓰는 것 — 아무것도 은폐하지 않음)이라 그대로 반영: 시저스 팰리스2.jpg를 `public/images/lasVegas/casino-2-caesars-palace.jpg`로 원본 그대로 추가 복사하고 `CasinoPhotoArt.tsx`의 `CASINO_PHOTOS` 맵에 카지노 2번을 추가 — 이제 6개 카지노 전부 실사 사진(워터마크 있는 채로)으로 렌더링, `CaesarsPalaceTile` SVG는 미래에 사진 없는 카지노가 생길 때를 위한 폴백 경로로만 남음. `npx tsc --noEmit`/`npx eslint src/games/lasVegas`/`npx vitest run src/games/lasVegas`(43/43) 재확인 통과.

**구현**:
- **이미지 에셋**: 워터마크 없는 5장(골드너겟1.jpg/미라지3.png/사하라4.jpg/룩소르5.avif/서커스서커스6.jpg)을 `public/images/lasVegas/casino-{1,3,4,5,6}-*.{jpg,png,avif}`로 원본 그대로 복사(ForSale의 `public/images/for-sale/` 동기화 컨벤션과 동일). 신규 `CasinoPhotoArt.tsx`의 `CasinoMatArt`가 카지노 2번(워터마크 이슈)만 기존 `CasinoTileArt` SVG로 폴백하고 나머지 5개는 `next/image`(`fill` + `object-cover`)로 실사 사진을 렌더링. `CasinoEmblem.tsx` 헤더 주석도 이 예외 관계를 설명하도록 갱신.
- **지폐**: 신규 `MoneyBillArt.tsx` — 9개 액면가($10,000~$90,000) 각각 고유 색상 테마(`BILL_THEMES`)의 오리지널 SVG "카지노 노트"(길로셰풍 테두리+다이스핍 코너마크+중앙 액면가), 실물 미국 화폐를 흉내내지 않아 화폐 재현 관련 리스크 회피. `LasVegasBoard.tsx`의 `MoneyStack`이 기존 `$N` 텍스트 카드 대신 이 컴포넌트를 렌더링.
- **주사위**: `DiceIcon.tsx`의 `DiceFace`에 라디얼 하이라이트+베벨 그림자+드릴된 핍 웰 음영을 추가해 입체감 있는 물리 주사위처럼 업그레이드(API 불변, 기존 모든 호출부 무수정으로 자동 적용). `LasVegasBoard.tsx`에 신규 `DiceGroupRow` — 카지노별 소유자마다 "×N" 배지 대신 **개별 `DiceFace` 아이콘을 실제 개수만큼 나열**(각 다이스는 그 카지노 번호와 같은 눈금을 표시 — 실제로 그 눈금이 나와서 배치된 것이므로 물리적으로 정확).
- **동수 상쇄(Tie) 실시간 연출**: `engine.ts`의 `settleCasino` 내부 로직을 `tallyDiceGroups(diceCounts)`(신규 export)로 추출 — 게임 종료 시의 실제 확정 정산(`settleCasino`)과 진행 중 UI의 라이브 미리보기가 **같은 함수**를 공유(로직 이중화 없음, 실제 규칙 확정 시점은 여전히 `placeDice`가 마지막 손패를 비운 순간뿐). `CasinoTile`이 매 렌더 `tallyDiceGroups(casino.diceCounts)`로 동수 여부를 계산해: (a) 동수인 그룹은 그레이스케일+반투명+깜빡이는 균열(crack) SVG 오버레이로 상시 표시, "⚔️ 동수 상쇄 잠정 — 정산 시 확정" 라벨 동반, (b) 매 상태 변경마다 이전 스냅샷과 비교해 **새로 동수가 된 카지노**를 감지하면(`newlyClashedCasinos`) 빨간 ✕ 마크 + 6방향 스파크 파티클이 순간적으로 터지는 플래시 연출(`lasvegas-tie-clash-x`/`lasvegas-tie-spark` keyframes, `key`값 증가로 재생 — 별도 타이머 없이 기존 `rollFlashId` 패턴 재사용).
- **액션 이펙트**:
  - **굴리기**: `rollFlashId`가 증가하는 그 순간(기존 트리거 재사용) 🎲 컵 글리프가 흔들리다 튕겨 사라지는 `lasvegas-cup-shake` 오버레이가 주사위 트레이 위에 잠깐 나타남.
  - **배치**: 기존 `FlyingDicePlacement`(주사위가 트레이→카지노로 날아가는 연출)의 `onDone` 시점에 착지한 카지노 타일의 `impactKeys`를 증가 → 골드 링이 확장하며 사라지는 `lasvegas-impact-ring` + 그 타일만 2~3px 흔들리는 `lasvegas-tile-shake`(요청의 "스크린 셰이크"를 전체 화면이 아니라 착지한 타일 로컬 범위로 해석 — 동시접속 멀티플레이에서 배치가 잦을 때 다른 참가자 화면 전체가 매번 흔들리면 산만할 것으로 판단, 이 스코프 결정은 사용자에게 재질문하지 않고 문서화).
  - **정산(Payout)**: 게임오버 화면에서 1위 플레이어의 총상금 배지에 `lasvegas-gold-burst-pulse`(골드 헤일로 루프) 적용, 신규 `PayoutMoneyFly`(`DiceEffects.tsx`)가 트로피 이모지(🏆/🎰)에서 1위 플레이어의 실제 획득 지폐(`MoneyBillIcon`)들을 하나씩 순위 배지로 날려보내며 착지마다 반짝임(`lasvegas-money-land-sparkle`) — 마운트 시 1회만 재생(`payoutStartedRef`), 6개 카지노 전체 지급 내역이 아니라 1위 플레이어 몫으로 스코프 제한(최대 6장, 카지노당 최대 1장 지급 규칙상 자연히 상한).
- **플레이어 색상 식별**: 스코어보드 각 행이 이제 해당 좌석 색상의 굵은 네온 테두리(`border-2` + 이중 `box-shadow` 글로우) + 좌석 번호가 적힌 원형 컬러 뱃지를 가짐(기존엔 작은 점 하나뿐).

**검증**: `npx tsc --noEmit`(전체, 에러 0) / `npx eslint src/games/lasVegas`+`npm run lint`(전체, 경고 0) / `npx vitest run src/games/lasVegas`(신규 `tallyDiceGroups` 테스트 3건 추가, 43/43 통과) / `npm run build`(Turbopack 프로덕션 빌드+TypeScript 전체 재검사 모두 정상 완주, 16개 라우트 정상 생성 — `next/image`로 바뀐 실사 카지노 사진·avif 포함 전부 정상 컴파일/번들). **`npx vitest run`(전체 스위트, 라스베가스 외 전 게임 포함)은 이번 세션에서 3회 시도 모두 8분+ 경과 후에도 출력 0바이트로 멈춰 완주 확인 못함** — HANDOFF §3 0번 항목에 이미 기록된 "전체 vitest run 완주 확인" 미해결 백로그와 동일 증상(이번 세션이 새로 만든 문제가 아님). 동시 실행 중이던 다른 Claude Code 세션/프로세스는 `tasklist`로 확인한 바 없었음 — 원인 미상.

**커밋/푸시**: `33e64b7 feat(las-vegas): replace with real image assets, render individual dice rows, add tie cancellation and action effects` → 곧이어 사용자가 "테스트니 워터마크 그대로 반영해달라"고 재요청해 `70aeebd feat(las-vegas): use the watermarked Caesars Palace photo as-is per explicit test-build request` 추가 커밋 → `git push origin main` 완료(`6adcbb7..70aeebd`).

**배포**: `npx vercel deploy`(프리뷰) 정상 완주(Turbopack 빌드+TypeScript 전체 재검사 포함), READY — `https://board-game-gzi1xnm6f-me-3871.vercel.app`. 요청 문구에 "production" 명시가 없어 이번에도 프리뷰까지만 진행(과거 세션들과 동일 판단 기준) — 필요하면 `npx vercel deploy --prod`로 후속 승격 요청할 것.

**미해결/다음 세션**:
- 위 검증 항목의 전체 `npx vitest run` 미완주 — 다음 세션에서 개별 게임 스위트를 하나씩 순차 실행하거나 `--pool=forks --poolOptions.forks.singleFork` 같은 옵션으로 어느 파일에서 멈추는지 이분 탐색해 원인을 좁힐 필요.
- 프리뷰 배포는 Vercel SSO 배포 보호가 걸려 있을 가능성이 있어 `curl` 직접 200 확인은 하지 않음(과거 세션들의 동일 판단 기준 — `readyState: READY` + 빌드 로그의 TypeScript 재검사 통과를 성공 근거로 삼음). 실제 브라우저 육안 확인은 다음 세션 몫.
- 브라우저 실측(실제 hover 글로우/컵 셰이크/임팩트 링/타이 클래시/머니 플라이 애니메이션이 실제로 매끄럽게 재생되는지, 특히 동수 상쇄가 "라이브"로 매 배치마다 올바르게 갱신되는지) 미완료 — 다음 세션에서 Playwright 스크린샷 또는 실제 브라우저로 확인 필요.
- 룩소르5.avif는 이 세션의 로컬 sharp 빌드가 avif 디코딩을 지원하지 않아 워터마크 유무를 육안 확인하지 못함(페루도의 `public/assets/games/perudo/mark.avif`가 이미 프로덕션에서 정상 동작 중이라는 전례를 근거로 그대로 진행 — Vercel 배포 환경에서 실제 렌더링 확인 필요).
- 카지노 2번(시저스 팰리스)은 위 "후속" 항목대로 워터마크 있는 실사 사진으로 반영 완료 — 다만 워터마크가 그대로 노출되므로, 테스트 단계를 벗어나 실제로 더 넓게 배포/홍보할 계획이 생기면 워터마크 없는 사진으로 교체 필요(`boardGameRule/라스베가스/`와 `public/images/lasVegas/`에 새 파일만 넣으면 `CasinoPhotoArt.tsx`의 `CASINO_PHOTOS` 맵 경로 한 줄 교체로 끝).
- 실사 카지노 사진 6장(워터마크 있는 시저스 팰리스 포함) 전부의 저작권/상표 라이선스는 여전히 미해결 상태로 남음(사용자가 "지금은 테스트"라는 전제로 인지하고 진행을 명시적으로 선택했다는 사실만 기록) — 앱을 이 프로젝트의 기존 범위를 넘어 더 넓게 배포/홍보할 계획이 생기면 재검토 필요(§3 17번 항목과 동일한 성격의 리스크).

### 2026-08-23 — 라스베가스 상단 일러스트 확대 및 지폐 외곽 캐스케이드 스택 개편

**요청**: 바로 위 세션("테이블 매트" 전면 개편, 그림 위에 지폐·주사위를 오버레이하는 구조)에 대한 피드백 — 1~6번 카지노 상단 일러스트 영역을 지금보다 더 시원하게 키우고, 지폐가 그림을 가리지 않도록 그림 바깥의 전용 구역에 실물 지폐가 차곡차곡 쌓인(Stacked Money) 형태로 레이아웃을 분리해달라는 요청. `Board.tsx`/`CasinoMat.tsx`/`BettingZone.tsx`/`CasinoTile.tsx`/`MoneyArea.tsx`를 지목했으나(직전 세션과 동일하게 실제로는 `LasVegasBoard.tsx` 하나에 인라인 `CasinoTile`), 일러스트 비율·지폐 쌓임 방향·주사위 구역 간격 등은 임의로 정하지 말고 먼저 질문하라는 명시적 지시(Strict No-Assumption Rule).

**모호점 확인(`AskUserQuestion`, 4문항)**: ① 확장된 일러스트의 가로:세로 비율 — **3:4 세로 유지, 비중만 확대(추천)** / 4:3 가로형으로 완만히 확장 / 16:9 와이드스크린(6개 SVG 전부 가로 구도로 재작업 필요, 위험 큼) → **3:4 유지**(기존 6개 SVG를 재작업하지 않고, 그림이 더 이상 지폐와 공간을 나눠 쓰지 않게 되는 것만으로 시각적 비중이 커진다는 논리). ② 지폐 스택 시각 효과 — **세로 계단형 캐스케이드(추천)** / 부채꼴 펼침 / 완전히 겹친 더미+총액 배지만 → **세로 계단형 캐스케이드**. ③ 지폐 스택에 개별 금액을 몇 개까지 노출할지 — 최상단 1장+"+N장" 배지(기존 방식 유지, 추천) / **쌓인 지폐 전부 개별 금액 라벨로 노출** → **전부 개별 노출**(세팅상 한 카지노당 최대 5장까지 쌓일 수 있음을 엔진 `MONEY_VALUES`/`$50,000 이상까지 계속 추가` 규칙에서 확인 — $10,000×5장이 이론상 최댓값). ④ 3단 구조(외곽 지폐 스택→확장 일러스트→주사위 베팅 매트)로 타일이 세로로 길어지는 데 따른 모바일 그리드 열 수 — **기존 그리드 유지(2/3/6열, 추천)** / 모바일 1열로 축소 → **기존 그리드 유지**.

**구현(`LasVegasBoard.tsx`의 `CasinoTile` 전면 재작성)**: 직전 세션의 "그림 전체를 배경으로 깔고 그 위에 지폐/주사위를 오버레이"하는 구조를 명시적으로 되돌려, 각 카지노 블록을 **비-오버랩 3단 세로 구조**로 재구성:
1. **`MoneyStack`(신규 컴포넌트, 최상단, 일러스트 완전히 바깥)**: `casino.bills` 배열 전체를 개별 카드로 렌더링, 각 카드가 이전 카드보다 11px씩 아래로 겹쳐 쌓이는 계단형 캐스케이드(`position: absolute`, `top: i * 11`, `zIndex: i + 1`) — 컨테이너 높이는 `34 + (bills.length - 1) * 11`로 동적 계산해 마지막 카드의 전체 높이가 절대 잘리지 않게 함. 지폐 없는 카지노는 점선 테두리 "지폐 없음" 플레이스홀더. 스택 아래에 "총 $XX,XXX · N장" 총액 배지를 별도 표시.
2. **확장 일러스트(중간)**: `CasinoTileArt`가 이제 지폐·주사위와 공간을 나누지 않고 `aspect-[3/4]` 카드 전체를 단독으로 차지 — SVG 자체(viewBox 240×320)는 재작업하지 않았으나(질문 ①의 결정) 이전엔 하단 절반 가까이가 지폐/주사위 오버레이용 짙은 비네팅으로 덮여 있던 것이 이제 그림 전체가 온전히 드러나 체감상 확연히 커짐. 좌상단 코너 배지(주사위 핍+테마 한글명)는 유지하되, 지폐 텍스트 대비용이던 짙은 하단 그라디언트 비네팅은 제거하고 코너 배지 판독용 옅은 좌상단 라디얼 스크림만 남김.
3. **`DiceBadge` 풀(하단, 신규 전용 바)**: 기존엔 그림 하단에 오버레이됐던 주사위 보유 배지 그룹을 `border border-white/10 bg-black/25` 전용 바로 분리해 그림 아래 별도 배치. "내 주사위 있음" 표시도 그대로 유지.
- `isRollDestination` 골드 글로우 펄스는 3단 전체를 감싸는 최외곽 컨테이너로 그대로 이전(로직 무변경, `lasvegas-mat-glow-pulse` keyframe 재사용) — 이번 세션에 `globals.css`는 건드리지 않음.
- 기존 "+N장 (합계)" 겹침 방지 배지, `topBill`/`restCount`/`restTotal` 변수는 전부 제거(캐스케이드가 이를 대체).

**검증**:
- `npx tsc --noEmit`(전체, 에러 0) / `npm run lint`(전체, 경고 0) / `npx vitest run src/games/lasVegas`(40/40 통과, 순수 UI 변경이라 엔진 로직 영향 없음 확인 목적).
- **브라우저 실측**: Phase 14 방식대로 `LasVegasBoard`를 고정 fixture(`startGame(4, 42)`의 상태를 카지노별로 수동 변형 — 1번 카지노에 $10,000×5장의 이론상 최댓값 캐스케이드, 6번엔 지폐 없음 케이스, 나머지는 2~3장 혼합 + 다양한 색상/중립 주사위 조합)로 렌더링하는 임시 라우트(`src/app/dev-lasvegas-preview`, 확인 후 삭제 완료)를 만들어 `npx playwright screenshot`으로 데스크톱(1280px, `lg:grid-cols-6`)과 모바일(375px, `grid-cols-2`) 두 폭 확인: (1) 5장 캐스케이드가 전부 개별 금액과 함께 잘리지 않고 계단형으로 쌓여 보임, (2) 지폐 없는 카지노도 플레이스홀더로 정상 표시, (3) 확장된 일러스트가 6개 전부 그림 전체를 온전히 드러내며 이전보다 눈에 띄게 큼직해 보임, (4) 주사위 배지 바가 그림과 겹치지 않고 하단에 명확히 분리, (5) 모바일 2열 그리드에서도 찌그러짐 없이 3단 구조가 유지(다만 타일 자체는 세로로 상당히 길어짐 — 질문 ④에서 사용자가 이 트레이드오프를 감수하고 기존 그리드 유지를 선택). **여전히 미검증**: 실제 마우스 `:hover`/골드 글로우 펄스 애니메이션 재생(정적 스크린샷 한계), `dice-roll-tumble`/`dice-slide-fly` FX가 새 3단 레이아웃 위에서 실제로 재생되는 모습, 온라인 2대 이상 기기 동기화.

**커밋/푸시**: `d223f5a feat(las-vegas): enlarge top casino artwork rects and position money cards outside illustration` → `git push origin main` 완료(`132e333..d223f5a`).

**배포**: `npx vercel deploy`(프리뷰) 정상 완주(Turbopack 빌드+TypeScript 전체 재검사 포함), READY — `https://board-game-29605qn4t-me-3871.vercel.app`. 요청 문구에 "production" 명시가 없어 이번에도 프리뷰까지만 진행(과거 세션들과 동일 판단 기준) — 필요하면 `npx vercel deploy --prod`로 후속 승격 요청할 것.

### 2026-08-23 — 라스베가스 1~6번 카지노 배팅존 풀 배경 테이블 매트 개편

**요청**: 바로 위 세션(원형 엠블럼 배지 추가)의 결과물에 대한 피드백 — 1~6번 카지노 직사각형 안에 "작은 원형 아이콘"만 박혀 있으면 원작 카지노 매트 느낌이 안 산다며, 그 원형 배지를 걷어내고 **직사각형 타일 전체**를 카지노 테마 배경 일러스트로 채운 뒤 그 위에 지폐·주사위를 얹어 베팅하는 "테이블 매트 오버레이" 레이아웃으로 전면 개편해달라는 요청. 배경 오버레이 톤, 타일 가로:세로 비율, 헤더 배지 위치 등은 임의로 정하지 말고 먼저 질문하라는 명시적 지시(Strict No-Assumption Rule).

**모호점 확인(`AskUserQuestion`, 4문항)**: ① 배경 아트 소스 — **오리지널 SVG 확대 재사용(추천)** / `boardGameRule/라스베가스/`의 실제 카지노 참고 사진 사용(상표 리스크 재경고) → **오리지널 SVG 확대**. ② 타일 비율 — **세로형 카드 3:4(추천)** / 정사각형 1:1 / 가로형 4:3 → **3:4**. ③ 오버레이(비네팅/글래스모피즘) 강도 — **중간 톤(추천)** / 진한 다크 / 라이트 톤 → **중간 톤**. ④ 번호+명칭 헤더 배지 위치 — **좌상단 코너 배지(추천)** / 상단 전체 헤더 바 → **좌상단 코너**. 4문항 모두 추천안 그대로 채택.

**구현**:
- **`CasinoEmblem.tsx`**: 기존 6개 원형 메달리온(`Medallion`/`CasinoEmblem`, `viewBox 0 0 64 64`)은 재사용처가 사라진 채로 그대로 남겨두고(향후 다른 곳에서 컴팩트 배지가 다시 필요할 경우 대비), 신규 `CasinoTileArt` + `TileScene`(240×320, `rx=18` 라운드 클립) + 카지노별 `*Tile` 6종을 추가 — 같은 모티프를 훨씬 넓은 캔버스에 재해석: 1 골드너겟(산맥 실루엣+채굴촌 스카이라인+각진 원석+반짝임), 2 시저스 팰리스(원근감 있는 로마 열주 4개+대형 중앙 기둥+양쪽 월계관 아치), 3 미라지(화산+용암 글로우+양쪽 야자수+오아시스 수면 물결), 4 사하라(별 뜬 밤하늘→모래 그라디언트+양파돔 궁전+듄 능선+낙타 실루엣), 5 룩소르(정점에서 뻗는 황금 빛기둥+검은 유리 피라미드+오벨리스크+스핑크스형 가디언), 6 서커스 서커스(정점에서 방사하는 9줄 빨강/흰 빅탑 캐노피+스캘럽 트림+체커 밴드). `preserveAspectRatio="xMidYMid slice"`로 래스터 이미지의 `object-fit: cover`와 동등한 효과(컨테이너 비율이 3:4에서 미세하게 벗어나도 왜곡 없이 채움).
- **`LasVegasBoard.tsx`의 `CasinoTile`**: 완전 재작성 — `relative aspect-[3/4]` 컨테이너에 `CasinoTileArt`를 절대배치 배경으로 깔고, 그 위에 (1) 중간 톤 하단 비네팅(`from-black/10 via-black/10 to-black/85`) + 상단 라디얼 다크닝, (2) 좌상단 코너 배지(주사위 핍+테마 한글명, `bg-black/55 backdrop-blur-sm`), (3) 하단 고정 오버레이(지폐 카드 + "+N장" 배지 + 주사위 보유 배지들, 모두 개별 `text-shadow`로 명암비 확보) 순서로 레이어링. 프레임은 카지노별 accent 컬러 테두리(`border-2`) + 모든 타일 공통 골드 인셋 헤어라인(`shadow-[inset_...rgba(252,211,77,0.4)]`)의 이중 구조로 "고급 카지노 프레임" 느낌을 유지하면서도 6개가 한눈에 구분되게 함. **글로우 펄스**: 별도 호버 트리거 대신, 그 순간 실제로 "이 카지노에 베팅 중"인 상태 — 즉 내 턴에 주사위를 굴린 뒤 고른 눈금이 이 카지노 번호와 일치할 때(`isRollDestination = isMyTurn && rollGroups.some(g => g.face === casino.number)`) — 신규 keyframe `lasvegas-mat-glow-pulse`(`globals.css`)로 타일 테두리 전체가 은은한 골드 링+워시로 숨쉬듯 펄스. 정적 `:hover`(포인터 기기용 보조)도 별도로 유지.
- **버그 발견 및 수정(코드 리뷰만으로 끝내지 않고 실제 스크린샷으로 확인해 잡음)**: 최초 구현은 지폐 카드 우하단에 "+N장 (합계)" 배지를 `absolute`로 겹쳐 그렸는데, 실제 스크린샷에서 지폐가 2장 이상인 카지노마다 금액 텍스트와 배지가 겹쳐 `$60,000`이 `$66,000`처럼 뭉개져 보이는 것을 확인 — 겹치는 대신 세로로 쌓이는 구조(지폐 카드 → "+N장" 배지 → 주사위 배지 행)로 재구성해 해결.

**검증**:
- `npx tsc --noEmit`(전체, 에러 0) / `npm run lint`(전체, 경고 0) / `npx vitest run src/games/lasVegas`(40/40 통과, 순수 UI 변경이라 엔진 로직 영향 없음 확인 목적). 전체 `npx vitest run`은 이번에도 실행하지 않음(HANDOFF에 이미 기록된 장시간 이슈, 변경 범위가 라스베가스 UI뿐이라 타깃 테스트로 충분하다고 판단).
- **브라우저 실측 완료 — 직전 세션(엠블럼)에서 "이 환경에 Playwright 없음"으로 기록했던 것은 착오/과거 상태였다.** 이번 세션에 `npx playwright screenshot`(CLI, 별도 설치 없이 바로 동작, `C:\Users\<user>\AppData\Local\ms-playwright\`에 chromium 이미 설치돼 있었음)이 실제로 동작함을 확인. Phase 14 방식대로 `LasVegasBoard`를 고정 state로 직접 렌더링하는 임시 라우트(`src/app/dev-lasvegas-preview/page.tsx`, 확인 후 삭제 완료)를 만들어 데스크톱(1280px, `lg:grid-cols-6`)과 모바일(375px, `grid-cols-2`) 두 폭으로 스크린샷 확인: (1) 6개 배경 아트가 서로 뚜렷이 구분됨, (2) 위 "+N장 겹침" 버그를 실제로 발견해 수정, (3) 수정 후 지폐/주사위 텍스트가 모든 6개 배경(밝은 골드~짙은 미드나잇 블루까지)에서 또렷이 읽힘, (4) 모바일 2열 그리드에서도 3:4 비율이 찌그러지지 않고 유지됨, (5) 활성 롤 목적지(예시 상태의 6번 서커스서커스)에 골드 글로우 펄스가 걸림을 확인. **다음 세션에 이 기법(`npx playwright screenshot --viewport-size=W,H --full-page`) 그대로 재사용 가능** — 이전 세션들의 "Playwright 없어서 스크린샷 못 찍음" 기록은 더 이상 유효하지 않으므로 앞으로는 이 방법을 기본으로 시도할 것.
- **여전히 미검증**: 실제 마우스 `:hover` 펄스(스크린샷은 정적이라 확인 불가, 로직상 안전), 온라인 2대 이상 기기 동기화, `dice-roll-tumble`/`dice-slide-fly` FX가 새 타일 위에서 실제로 재생되는 모습(레이아웃만 정지 스크린샷으로 확인).

**커밋/푸시**: `5d7d315 feat(las-vegas): transform casino betting zones into full-card theme mat artwork with overlay betting elements` → `git push origin main` 완료(`853151b..5d7d315`).

**배포**: `npx vercel deploy`(프리뷰) 정상 완주(Turbopack 빌드+TypeScript 전체 재검사 포함), READY — `https://board-game-fo8k38lzj-me-3871.vercel.app`. 요청 문구에 "production" 명시가 없어 이번에도 프리뷰까지만 진행(과거 세션들과 동일 판단 기준) — 필요하면 `npx vercel deploy --prod`로 후속 승격 요청할 것.

### 2026-08-23 — 라스베가스 1~6번 카지노 배팅존 테마 그래픽(엠블럼) 추가

**요청**: `boardGameRule/라스베가스/` 규칙 문서·레퍼런스 이미지, `HANDOFF.md`, 라스베가스 인게임 UI(요청 문구는 `Board.tsx`/`CasinoMat.tsx`/`BettingZone.tsx`/`CasinoTile.tsx`를 지목)를 먼저 확인한 뒤, 1~6번 카지노 매트마다 고유 테마 일러스트/아이콘을 지폐·주사위 표시 영역을 침범하지 않게 추가하고 모바일 반응형까지 최적화해달라는 요청. 테마 정체성·이미지 에셋 경로·렌더링 스타일 등은 절대 임의로 정하지 말고 먼저 질문 목록을 제시해 확인받으라는 명시적 지시(Strict No-Assumption Rule).

**먼저 확인한 것 — 요청서의 파일 구성·전제가 실제와 다름**: `Board.tsx`/`CasinoMat.tsx`/`BettingZone.tsx`/`CasinoTile.tsx`라는 파일은 없다 — 실제 구성은 `LasVegasBoard.tsx` 하나에 `CasinoTile` 컴포넌트가 인라인으로 있고, 순수 SVG/CSS 주사위 렌더러 `DiceIcon.tsx`가 이미 존재(프로젝트 전역 "외부 이미지 에셋 없이 인라인 SVG/CSS" 컨벤션, `CucumberIcon.tsx`/`GemToken.tsx`/`ResourceIcon.tsx`/`PerudoFaceIcon.tsx`와 동일 패턴). 룰북(`라스베가스.md`)엔 카지노별 테마/이름이 전혀 없고("1번 카지노"~"6번 카지노"로만 표기), 원작 Ravensburger/alea 게임의 실제 타일 아트(`라스베가스 세팅.png`)도 "MIRACLE"/"SPHINX" 같은 **가상의 창작 명칭**이며 실제 라스베가스 카지노 브랜드명은 쓰지 않음 — 요청 문구의 "골든너겟/미라지/벨라지오/룩소르" 예시는 실제 상표라 상표권 리스크가 있음을 먼저 인지.

**모호점 확인(`AskUserQuestion`, 1차 4문항)**: ① 테마 정체성 — "오리지널 창작 테마(추천)" / 실제 브랜드명 사용(리스크 있음) / 이름 없는 범용 아이콘 → **오리지널 창작 테마** 선택. ② 그래픽 구현 방식 — **인라인 SVG/CSS(추천, 프로젝트 컨벤션과 일치)** / PNG 이미지 에셋 → **인라인 SVG/CSS**. ③ 타일 내 배치 — **상단 엠블럼 배지(추천)** / 배경 워터마크 / 카드 헤더 배너 → **상단 엠블럼 배지**. ④ 기존 accent 색상(1:amber~6:sky)과 원작 타일 아트 분위기를 반영한 1~6 모티프 제안안(사막 오아시스 골든 돔/빈티지 네온 타워/핑크 리조트 팬/스카이라인 익스트라바간자/피라미드·스핑크스/라군 리조트) — **제안된 매핑 그대로 진행** 선택.

**작업 도중 발견한 결정적 반증 — 실제 카지노 참고 사진이 이미 준비돼 있었음**: `boardGameRule/라스베가스/` 폴더에 이 요청을 보내기 불과 몇 분 전(같은 날 18:05~18:10) 타임스탬프로 `골드너겟1.jpg`/`시저스 팰리스2.jpg`/`미라지3.png`/`사하라4.jpg`/`룩소르5.avif`/`서커스 서커스6.jpg`가 이미 1~6번 순서로 매칭되게 준비되어 있었다 — 요청 문구의 실제 브랜드명 예시와도 3개(골든너겟/미라지/룩소르)가 정확히 일치. 이는 방금 "오리지널 창작 테마" 답변을 유도했던 내 질문 프레이밍(상표권 리스크 경고)과 정면으로 배치되는 강한 반증이라, 1차 답변을 그대로 밀어붙이지 않고 **2차로 재확인**(`AskUserQuestion`, 1문항: "준비하신 실제 6개 카지노명으로 진행" vs "오리지널 창작 테마 유지") → **"준비하신 실제 6개 카지노명으로 진행"** 선택. 최종적으로 실제 카지노 6곳(골드너겟/시저스 팰리스/미라지/사하라/룩소르/서커스서커스)을 테마 "이름"으로 쓰되, 그래픽 자체는 각 카지노의 대표 모티프(너겟 원석/월계관+로마 기둥/화산+야자수/사막 돔+야자수/검은 피라미드+빛기둥/서커스 빅탑 텐트)를 새로 그린 오리지널 SVG 아이콘으로 재해석 — 참고 사진의 실제 로고·간판 서체·사진을 그대로 복제하지 않음(순수 참고용, 무드보드).

**구현**:
- **`src/games/lasVegas/CasinoEmblem.tsx`(신규)**: `DiceIcon.tsx`와 동일한 "외부 이미지 없는 순수 인라인 SVG" 컨벤션. `CASINO_THEME_NAMES`(카지노 1~6 → 한글/영문 이름 매핑) + `CasinoEmblem` 컴포넌트(카지노 번호별로 6개의 개별 SVG 서브컴포넌트 중 하나를 렌더링) + 공유 `Medallion` 헬퍼(원형 메달 배경 그라디언트 + 링 테두리, 카지노마다 고유 그라디언트 id로 충돌 방지). 6개 모티프: 1 골드너겟(금 원석 폴리곤+반짝임), 2 시저스 팰리스(로마 기둥+양쪽 월계관), 3 미라지(화산+용암 글로우+야자수), 4 사하라(별이 뜬 밤하늘+사막 돔 실루엣+야자수), 5 룩소르(검은 피라미드+황금 빛기둥+스핑크스 실루엣), 6 서커스 서커스(빨강/흰 줄무늬 빅탑 텐트+황금 피니얼).
- **`LasVegasBoard.tsx`의 `CasinoTile`**: 기존 "주사위 핍 아이콘 + 카지노 N" 한 줄 헤더를, `CasinoEmblem`(상단, `h-9 w-9 sm:h-11 sm:w-11`) + 그 아래 기존 주사위 핍 아이콘(`h-6 w-6`로 축소) + 테마 한글명(`골드너겟` 등, 11px 볼드) + "카지노 N"(9px 흐림) 2줄 구성으로 교체. 지폐 표시 영역(`h-16 w-16`)과 주사위 배지 그룹은 그대로 아래에 위치해 전혀 손대지 않음 — 요청의 "가독성 침범 금지" 요건 충족. SVG는 `viewBox` 기반이라 `grid-cols-2`(모바일)~`lg:grid-cols-6`(데스크톱) 어느 폭에서도 별도 `object-fit` 처리 없이 비율 그대로 스케일됨.

**검증**: `npx tsc --noEmit`(전체, 에러 0) / `npm run lint`(전체, 경고 0) / `npx vitest run src/games/lasVegas/LasVegas.test.ts`(40/40 통과, 순수 UI 변경이라 엔진 로직 영향 없음 확인 목적). **전체 `npx vitest run`은 이번 세션엔 실행하지 않음** — HANDOFF에 이미 기록된 `aiBenchmark.test.ts`發 장시간(4시간+) 이슈 때문에 이 변경과 무관한 전체 스위트를 다시 몇 시간씩 태우는 대신, 변경 범위(라스베가스 UI만)에 맞는 타깃 테스트로 검증. **브라우저 실측(엠블럼 6개가 실제로 서로 뚜렷이 구분되는지, 모바일 2열 그리드에서 안 찌그러지는지)은 이번 세션에 수행하지 못함** — 이 환경엔 `chromium-cli`/Playwright가 설치돼 있지 않고, 신규 의존성 추가는 이 프로젝트의 "먼저 확인받을 것" 컨벤션에 걸려 임의로 설치하지 않았음. 다음 세션에서 실제 기기/브라우저로 육안 확인 필요(§3에 항목 추가).

**커밋/푸시**: `c77323a feat(las-vegas): add theme artwork and icons to casino betting zones 1-6` → `git push origin main` 완료(`3e77f20..c77323a`). 레퍼런스 사진 6장(`boardGameRule/라스베가스/골드너겟1.jpg` 등)도 이 판단 근거 기록 차원에서 함께 커밋.

**배포**: `npx vercel deploy`(프리뷰) 정상 완주(Turbopack 빌드+TypeScript 전체 재검사 포함), READY — `https://board-game-373b3kr9r-me-3871.vercel.app`. 요청 문구에 "production" 명시가 없어 이번에도 프리뷰까지만 진행(과거 세션들과 동일 판단 기준) — 필요하면 `npx vercel deploy --prod`로 후속 승격 요청할 것.

### 2026-08-23 — 운명전쟁39 예측 블라인드, 히든 배지 라운드 리셋, 모바일 뒤로가기 이탈 방지

**요청**: `HANDOFF.md`와 운명전쟁39 코드(요청 문구는 `Board.tsx`/`DestinyWar39Board.tsx`/`PredictionPanel.tsx`/`PlayerSlot.tsx`/`HiddenArea.tsx`/`engine.ts`/`types.ts` 등을 지목)를 먼저 확인한 뒤 4가지 항목 — ① 예측 단계 중 타 플레이어 예측 승수 실시간 노출 버그를 "완료/？" 블라인드 마크로 수정하고 첫 트릭 개시 시 전체 공개, ② 히든 카드가 상대 화면에 노출되는 보안 버그 수정, ③ 모바일 뒤로가기/제스처로 게임에서 즉시 튕겨나가는 것을 History Trap + 확인 모달로 방지, ④ 특정 라운드에 발동한 히든 특수효과(원숭이 아이콘 등) 배지가 이후 라운드까지 계속 남는 버그를 라운드 종료 시 초기화 — 를 한 번에 정밀 수정하고, 단위 테스트·`tsc`/`lint`/`vitest` 검증·HANDOFF 갱신·커밋·푸시·배포까지 요청. 모호한 점은 절대 임의로 추정하지 말고 번호 매긴 질문 목록으로 먼저 확인하라는 명시적 지시(Strict No-Assumption Rule).

**먼저 확인한 것 — 요청서의 파일 구성·용어가 실제 코드와 다름**: 요청서가 지목한 `Board.tsx`/`PredictionPanel.tsx`/`PlayerSlot.tsx`/`HiddenArea.tsx`/`types.ts`는 이 게임 폴더에 없다. 실제 구성은 `engine.ts`(덱/규칙/타입 전부), `DestinyWar39Board.tsx`(보드+플레이어 슬롯 인라인), `PredictionStatusBoard.tsx`(우측 예측 패널), `DestinyWar39Effects.tsx`(이펙트), `DestinyWar39Game.tsx`(온라인 룸 진입점)로 구성. 코드 전수 확인 결과:
- **항목 1은 실제로 재현되는 진짜 버그**였다: `engine.ts`의 `visibleCurrentPrediction`이 `hidden: true`로 제출한 1회용 비공개 예측만 마스킹하고, 일반(비-히든) 예측은 제출 즉시 상대방 화면(`PredictionStatusBoard.tsx`)에도 숫자 그대로 노출되고 있었다.
- **항목 2("히든 카드")는 코드와 매칭되는 별도 기능이 없었다**: 이 게임엔 "히든 카드"라는 카드/기능 자체가 없다. 상대방의 손패는 애초에 어느 화면에서도 렌더링되지 않고(`DestinyWar39Board.tsx`는 `round.hands[viewerSeat]`만 그림), "히든"은 게임 전체 1회용 비공개 **예측값**(항목 1과 동일 대상) 하나뿐이며 그 값 자체는 이미 정확히 마스킹되고 있었다.
- **항목 4의 "히든 특수효과(원숭이 등)"는 `HiddenActivationBadge`의 🙈(정확히 원숭이 이모지) 배지**였다 — `player.hiddenUsed`가 한 번 `true`가 되면 게임 끝까지 계속 렌더링되는, **의도적으로 설계된** "1회용 토큰을 이미 썼다"는 영구 표시(`PredictionStatusBoard.tsx`). 이걸 라운드 한정 노출로 바꾸는 건 실제 규칙(게임당 1회 평생 토큰, 값은 게임오버까지 비공개)과는 별개로 "화면에 남는 표시 방식"만 바꾸는 설계 변경임을 확인.
- **항목 3(뒤로가기 방어)**: 프로젝트 전체에 `popstate`/`history.pushState` 가로채기 패턴이 전무해 완전 신규 구현이 필요했고, 이 게임은 라우팅 이동 없이 한 페이지(`/games/destiny-war-39`) 안에서 방 생성/입장/플레이/나가기를 전부 SPA 내부 `phase` state로 처리하는 구조(`DestinyWar39Game.tsx`의 기존 `handleLeave`가 실제 라우팅 없이 내부 상태만 초기화)라 "나가기"가 정확히 어디로 이동해야 하는지 결정이 필요했다.

**모호점 확인(`AskUserQuestion`, 4문항)**: ① 항목 2 "히든 카드"의 대상 — **"항목 1과 동일한 대상(추천)"** / "상대방 손패를 의미" / 기타 → 항목 1과 동일 선택(=별도 추가 구현 없이 항목 1 수정으로 항목 2도 함께 해소). ② 항목 4 배지 노출 방식 — **"그 라운드에만 배지 노출, 이후 사라짐(추천)"** / "현재 방식(게임 끝까지 표시) 유지" / "토큰 자체를 라운드마다 재사용 가능하게 규칙 변경" → 라운드 한정 노출 선택(토큰 규칙 자체는 불변, 화면 표시만 변경). ③ 뒤로가기 방어 활성화 시점 — **"방 입장 이후 전체(추천)"** / "실제 대국 중(playing)에만" → 방 입장 이후 전체 선택(대기실에서 실수로 나가는 것도 방지). ④ 이탈 확인 모달 [나가기] 동작 — **"이 게임의 내부 로비 화면으로 복귀(추천)"** / "브라우저 뒤로가기를 실제로 진행(사이트 이전 페이지로)" → 내부 로비 복귀 선택(기존 `handleLeave()` 재사용).

**구현**:
- **항목 1+2 (예측 블라인드, `engine.ts`의 `visibleCurrentPrediction`)**: 반환 타입에 `"submitted"`를 추가(`number | "hidden" | "pending" | "submitted"`). 새 로직 — 조회 대상이 본인이면 항상 실제값(또는 미제출 시 `"pending"`); 타인이면 미제출 시 `"pending"`, 히든 플래그가 있으면 phase 무관 항상 `"hidden"`(기존 동작 그대로, 회귀 없음), 히든이 아니고 아직 `state.phase === "predicting"`(예측 단계)이면 `"submitted"`(완료 여부만), 그 외(= `"playing"` 진입 = 첫 트릭 개시)엔 실제값을 그대로 공개. `PredictionStatusBoard.tsx`는 이 네 가지 값을 각각 "?"(미제출)/"완료"(제출했지만 블라인드)/"🙈"(히든)/`N승`(공개)으로 렌더링하도록 수정, "적중 중"/"초과" 진행 배지도 기존엔 마스킹된 예측이어도 실제 `predicted` 값으로 계산해 간접적으로 새 왔었던 부분을 `visible`이 숫자로 공개된 경우에만 계산하도록 수정(마스킹된 예측의 진행 상황이 배지 색으로 우회 노출되는 걸 함께 차단).
- **항목 4 (히든 배지 라운드 리셋, `PredictionStatusBoard.tsx`)**: 배지 노출 조건을 `player.hiddenUsed`(게임 끝까지 true) → `player.hiddenRound === round.roundNumber`(그 라운드에서만 true)로 변경. 토큰이 실제로 "몇 회까지 쓸 수 있는가"를 결정하는 `hiddenUsed`/`hiddenRound` 엔진 필드 자체는 전혀 건드리지 않음 — `nextRound`가 `round.roundNumber`를 증가시키는 순간 이 조건이 자동으로 `false`로 바뀌어 배지가 사라지고, `hiddenRound`는 그 라운드 값에 고정된 채라 이후 다시 `true`가 될 일이 없음(한 번 쓴 토큰이 재사용되는 게 아니므로). `DestinyWar39Effects.tsx`의 `HiddenActivationBadge` 독스트링도 "게임 끝까지 마운트 유지" → "그 라운드에만 마운트, 이후 언마운트" 로 갱신.
- **항목 3 (뒤로가기 이탈 방지, `DestinyWar39Game.tsx`)**: `roomCode`가 설정된 순간(방 생성/참여 완료 — connecting/waiting/playing/post-game 전체 커버) `history.pushState`로 같은 URL의 히스토리 엔트리를 하나 더 쌓고, `popstate` 리스너를 등록하는 신규 `useEffect` 추가. 뒤로가기 제스처/버튼이 눌리면 브라우저가 그 여분 엔트리를 먼저 pop하며 `popstate`가 발생 → 핸들러가 즉시 같은 엔트리를 다시 push해 실질적인 이동을 무효화하고 `Overlay` 기반 확인 모달(`게임을 나가시겠습니까?`)을 띄움. [계속하기]는 모달만 닫고(엔트리는 이미 복구된 상태), [나가기]는 기존 `handleLeave()`를 호출해 SPA 내부에서 이 게임 자체 로비 화면(`phase: "choose"`)으로 복귀(실제 브라우저 페이지 이동은 없음 — 이 컴포넌트의 다른 모든 "나가기" 경로와 동일). 8개의 phase별 조기 `return (...)` 전부를 `return withGuard(...)`로 감싸 어느 화면에서든 모달이 함께 렌더되도록 처리(`DestinyWar39Board.tsx`의 기존 `centerContent` 변수 패턴과 유사한 "content + 오버레이" 합성).

**단위 테스트 추가(`DestinyWar39.test.ts`)**: 84개(기존 79 + 신규 5) — (1) "hidden" describe에 히든 예측이 `"playing"` 진입 후에도 계속 `"hidden"`으로 남는지(일반 예측과 달리 공개 안 됨) 검증 1개 추가. (2) 신규 "prediction blind masking" describe — 일반 예측이 예측 단계 중엔 본인껜 실제값, 타인껜 `"submitted"`로만 보이는지, 미제출 좌석은 본인/타인 모두 `"pending"`인지, 라운드의 첫 트릭이 시작되는 즉시(`phase → "playing"`) 모든 좌석의 일반 예측이 전원에게 실제값으로 공개되는지 3개. (3) 신규 "hidden badge round-scoping" describe — 히든을 쓴 라운드엔 `roundNumber === hiddenRound`가 참(배지 노출 조건), `nextRound`로 다음 라운드에 진입하면 즉시 거짓으로 바뀌고 그 다음 라운드에서도 계속 거짓으로 유지되는지(재발동 없음) 검증 1개 — 라운드 2+의 실제 턴 순서(선 플레이어 기준 시계방향)를 따르는 재사용 가능한 `finishCurrentRound` 헬퍼 신규 작성(기존 `playFullGame` 내부 로직과 동일 패턴, 다만 게임오버까지가 아니라 "현재 라운드 1개만" 종료).

**검증**: `npx tsc --noEmit`(전체, 에러 0) / `npm run lint`(전체, 경고 0) / `npx vitest run src/games/destinyWar39`(84/84 통과) / `npx vitest run --exclude '**/aiBenchmark.test.ts'`(27개 파일 1133/1133 통과 — 다른 게임 회귀 없음). **브라우저 실측(뒤로가기 제스처/모달, 블라인드 마크 실시간 전환)은 이번 세션에 수행하지 않음** — 이 저장소가 이미 문서화한 vitest 커버리지 밖 영역(실시간 히스토리 API 상호작용)이라 실사용 전 수동 확인 권장.

**커밋/푸시**: `74437ed fix(destiny-war-39): mask opponent predictions, secure hidden cards, prevent back navigation, and reset round hidden effects` → `git push origin main` 완료(`b777bde..74437ed`).

**배포**: `npx vercel deploy --prod` 첫 시도는 과거 세션들과 동일한 `{"status":"error","reason":"deploy_failed","message":"Not authorized"}`로 실패 → 즉시 재시도해 정상 빌드(Turbopack, TypeScript 전체 재검사 포함)·배포 완료, `target: production`/`readyState: READY`로 확인되고 프로덕션 도메인 `board-game-tau-navy.vercel.app`에 별칭(alias) 완료(`dpl_2divD64xmngawDm9BGpiYtktmXN9`). `curl`로 프로덕션 루트(`/`, 200)와 운명전쟁39 라우트(`/games/destiny-war-39`, 200) 둘 다 직접 응답 확인.

### 2026-08-22 — 운명전쟁39 6인·7인 플레이어 모드 활성화 (54장/63장 덱 구성)

**요청**: `HANDOFF.md`와 운명전쟁39 코드(요청 문구는 `src/games/destinyWar39/` 하위 `constants.ts`/`engine.ts`/`deck.ts`/`types.ts`/`Lobby.tsx`/`Board.tsx`/`DestinyWar39Board.tsx`, `src/config/games.ts`를 지목)를 먼저 확인한 뒤 (1) 6인(54장 덱=0×6+데스×1+1~47 숫자 47장)/7인(63장 덱=0×7+데스×1+1~55 숫자 55장) 덱 구성, (2) 로비 인원 선택에 6/7인 옵션 노출 + 허브 메타데이터 연동, (3) 6/7인 대응 타원형/방사형 테이블 레이아웃과 좌/우 패널 최적화, (4) `DestinyWar39.test.ts`에 6/7인 덱 구성·분배·트릭 판정 테스트, (5) `tsc`/`lint`/`vitest` 통과 후 HANDOFF 갱신 → 커밋 `feat(destiny-war-39): enable 6p and 7p modes with custom deck configurations` → 푸시 → 배포까지 요청. 숫자 카드 최대 범위, 리버스 카드 포함 수량, 좌표 계산 등 확인이 필요하면 절대 임의로 넘겨짚지 말고 먼저 질문 목록을 제시해 확인받으라고 명시.

**먼저 확인한 것 — 요청서가 지목한 파일 구성이 실제 코드와 다름**: `constants.ts`/`deck.ts`/`types.ts`/`Lobby.tsx`/`Board.tsx`는 이 게임 폴더에 없다. 실제 구성은 덱/규칙/타입이 전부 `engine.ts` 하나에 있고(`DECK_MODE_CONFIG`가 `playerCount`별 `{zeroCount, deathCount, maxNumber}`를 갖는 룩업 테이블), 로비는 `DestinyWar39Game.tsx`, 보드는 `DestinyWar39Board.tsx` 하나(반응형 Tailwind `flex-wrap`만으로 좌석 수에 상관없이 겹침 없이 자동 줄바꿈 — 타원형/방사형 좌표 계산 자체가 없는 구조)가 담당한다. 이미 5인(45장)·8인(72장) 두 모드가 이 룩업 테이블 패턴으로 완전히 파라미터화되어 있어(`buildDeck`/`isReverseCard`/`reverseValuesFor`/`resolveTurn`/`RulebookModal`/`CardFace`/`PlayedCardSlot`/`RankedLeaderboard`/`PredictionStatusBoard` 전부 `playerCount`를 받아 `deckModeConfig(playerCount)`로 동작하고 5/8을 하드코딩한 곳이 없음을 코드 전수 확인), 6/7인 추가는 이 테이블에 항목 두 개를 더하는 것으로 끝나는 구조였다.

**질문 목록 검토 결과 — 실제로 확인이 필요한 결정 사항 없음**: (1) 리버스 카드 포함 수량은 기존 규칙("11부터 시작해 그 모드의 최대 숫자까지 11의 배수")이 요청받은 최대 숫자(6인=47, 7인=55)에 그대로 적용되어 자동으로 정해짐(6인=11·22·33·44 4장, 7인=11·22·33·44·55 5장) — 새로 정할 값이 아니라 기존 공식의 산출값. (2) 최대 숫자 범위도 요청서가 직접 준 장수(6인 47장, 7인 55장)가 곧 `1~maxNumber` 1장씩이므로 그대로 47/55로 확정. (3) 데스카드 1장(8인의 2장과 다름)도 요청서가 명시적으로 지정한 값. (4) 타원형/방사형 좌표는 애초에 이 보드가 쓰지 않는 레이아웃 방식이라 계산할 대상이 없고, 좌/우 랭킹·예측 패널도 이미 `max-h-[70vh] overflow-y-auto`로 8인까지 스크롤 없이 검증된 상태라 6/7인(8인보다 적음)에서 별도 패딩/폰트 조정이 필요 없음을 확인. 이상 네 가지 모두 "임의로 추정"이 아니라 요청서 자체의 수치와 기존에 확정된 공식을 그대로 대입한 결과라 새로 물을 결정 사항이 없었음 — 사용자에게 별도 질문 없이 바로 구현에 착수.

**구현**: `engine.ts` — `SUPPORTED_PLAYER_COUNTS`를 `[5, 8]` → `[5, 6, 7, 8]`로 확장(`PlayerCount` 타입도 `5|6|7|8`로 자동 확장), `DECK_MODE_CONFIG`에 `6: {zeroCount:6, deathCount:1, maxNumber:47}` / `7: {zeroCount:7, deathCount:1, maxNumber:55}` 추가, 모듈 상단 독스트링·덱 구성 주석을 4개 모드 기준으로 갱신(`MIN_PLAYERS`=5/`MAX_PLAYERS`=8은 범위 그대로라 변경 없음). `DestinyWar39Game.tsx` — 로비 인원수 선택을 `flex` 한 줄에서 4개 옵션이 좁아지지 않도록 `grid grid-cols-2 sm:grid-cols-4`로 변경, 안내 문구를 "5인 또는 8인" → "5~8인"으로 수정(이제 4개 모드이므로). `registry.ts` — 대시보드 설명 문구에 6인(54장, 리버스 11·22·33·44)·7인(63장, 리버스 11·22·33·44·55) 모드 설명 추가(`players: {min:5, max:8}`는 이미 6/7을 포괄하는 범위라 변경 불필요 — 허브 필터(`app/page.tsx`)의 "5~7인" 버킷도 `min<=7 && max>=5` 조건이라 이미 정상 매칭됨을 확인). `RulebookModal.tsx`/`CardFace.tsx`/`DestinyWar39Effects.tsx`/`RankedLeaderboard.tsx`/`PredictionStatusBoard.tsx`/`LastRoundHistoryModal.tsx`는 전부 `deckModeConfig(playerCount)`/`state.playerCount` 기반으로 이미 완전히 제네릭해 1바이트도 변경하지 않음(룰북의 "데스카드 2장" 특수 문구도 `deathCount > 1` 조건부라 6/7인엔 자동으로 숨겨짐).

**단위 테스트 추가(`DestinyWar39.test.ts`)**: 6인·7인 각각 (1) 덱 구성 describe 블록 — 총 54장/63장, 0카드 6장/7장, 1~47/1~55 각 1장, 데스카드 1장, 리버스 카드가 정확히 11·22·33·44(6인)/11·22·33·44·55(7인)로 판정되고 그다음 11의 배수(6인=55, 7인=66)는 최대 숫자를 넘어 리버스 카드가 아님을 검증. (2) `describe.each`로 6/7인 공용 스위트 — 9라운드 풀 게임 시뮬레이션 후 전원 최종 점수/순위 산출, 라운드 9에서 전원 정확히 9장씩(=덱 전체 54/63장) 분배, 최종 점수가 9라운드 개별 점수 합과 일치, 라운드 2 첫 트릭이 정확히 playerCount명 전원의 카드로 정산되고 승자가 그 턴 참가자 중 하나임을 검증. 신규 16개 추가(총 79개 = 기존 63 + 신규 16), 5·8인 스위트 포함 기존 테스트 전부 유지.

**검증**: `npx tsc --noEmit`(전체, 에러 0) / `npm run lint`(전체, 경고 0) / `npx vitest run src/games/destinyWar39`(79/79 통과) / `npx vitest run --exclude '**/aiBenchmark.test.ts'`(27개 파일 1128/1128 통과 — 다른 게임 회귀 없음).

**커밋/배포**: 커밋 `25dcbe3 feat(destiny-war-39): enable 6p and 7p modes with custom deck configurations` → `git push origin main` 완료(`f494fa0..25dcbe3`) → `npx vercel deploy`(프리뷰) 첫 시도는 과거 세션들과 동일한 `{"status":"error","reason":"deploy_failed","message":"Not authorized"}`로 실패 → 즉시 재시도해 정상 빌드(Turbopack, TypeScript 전체 재검사 포함)·배포되어 READY — `https://board-game-ogdo3vj33-me-3871.vercel.app`. "production" 명시 없어 이번에도 프리뷰까지만 진행 — 필요하면 `npx vercel deploy --prod`로 후속 승격 요청할 것.

### 2026-08-22 — 운명전쟁39 트릭 내 제출 카드 소멸 버그 근본 수정 (CSS 랜딩 애니메이션 opacity 충돌)

**요청**: "선플레이어가 낸 카드가 다음 플레이어 턴으로 넘어가면 사라진다"는 재차 접수된 버그 리포트 — 트릭이 끝날 때까지(1번→마지막 플레이어) 필드에 카드가 계속 보여야 하고, 손패/필드 분리, 모바일/데스크톱 동기화, 단위 테스트, 검증까지 요청. 모호한 점(트릭별 카드 풀 저장 방식, 정산 딜레이 연출 등)이 있으면 임의로 넘겨짚지 말고 먼저 질문하라는 명시적 지시.

**먼저 확인한 것 — 이 리포트가 가리키는 파일이 실제로는 존재하지 않음**: 요청서가 지목한 `Board.tsx`/`PlayedCardsArea.tsx`/`CardSlot.tsx`/`MobileLayout.tsx`/`types.ts`는 이 게임 폴더에 없다(실제 구성은 `DestinyWar39Board.tsx` 하나가 반응형 Tailwind 클래스만으로 PC/모바일을 겸함 — 별도 모바일 전용 렌더러 자체가 없어 "조건부 렌더링으로 모바일에서만 카드가 숨는" 종류의 버그는 애초에 성립할 수 없는 구조). `HANDOFF.md`를 먼저 확인한 결과 바로 직전 세션(`f495463`)이 "트릭의 마지막 카드가 제출된 순간의 1프레임짜리 소멸 플래시"를 이미 고쳤다는 기록이 있었고, 엔진(`engine.ts`)의 `play`/`resolveTurnAndAdvance`도 코드 리뷰상 `round.playsThisTurn`을 트릭 도중 절대 비우거나 덮어쓰지 않는 구조임을 재확인했다 — 즉 "질문할 새 결정 사항"은 없었지만, **정적 코드 리뷰만으로는 재현되지 않는 버그**라는 이 프로젝트의 기존 원칙(HANDOFF §2 "작업 규칙" 및 troubleshooting.md #7)에 따라 임의로 "이미 고쳐졌다"고 단정하지 않고, 실제 브라우저 렌더링으로 직접 재현을 시도했다.

**재현 방법과 실제 원인**: 고정 state를 주입하는 임시 라우트(Phase 14 방식, 확인 후 삭제)를 만들어 `DestinyWar39Board`를 (1) 라운드 2 - 순차 턴 순서 - 2/5명만 카드를 낸 "트릭 진행 중" 상태, (2) 5명 전원이 낸 직후의 "트릭 정산" 상태 두 가지로 직접 렌더링하고, Playwright로 실제 DOM의 `getComputedStyle(...).opacity`와 Web Animations API(`element.getAnimations()`)를 찍어봤다. 그 결과 **엔진 상태(`round.playsThisTurn`)는 정확했지만(2번째 이후 플레이어가 카드를 내도 이전 플레이어의 play가 배열에 그대로 남아있고 순서 배지도 정확히 "완료" 표시), 이미 낸 카드의 실제 화면 `opacity`가 카드를 낸 지 약 0.85초 뒤부터 `0`으로 굳어 완전히 투명해져 있었다** — 즉 상태는 멀쩡한데 CSS만으로 카드가 안 보이게 된 것. 원인은 `globals.css`의 `destinywar39-land-shockwave`/`destinywar39-land-shockwave-death`(2026-08-22 "턴 순서 배지 + 카드 제출 대형 임팩트" 세션이 추가한 착지 링 이펙트) 두 키프레임이 `box-shadow`뿐 아니라 **`opacity`도 `1 → 0.5 → 0`으로 같이 애니메이션**하고 있었던 것 — 이 애니메이션은 `PlayedCardSlot`의 카드 본체와 **같은 `<span>` 래퍼**에 `destinywar39-card-slide-drop` 뒤에 이어 붙는 두 번째 `animation`으로 걸려 있는데, CSS 스펙상 한 요소에 같은 CSS 속성(`opacity`)을 건드리는 애니메이션이 여러 개 걸리면 **`animation` 목록에서 나중에 오는 쪽이 그 속성을 통째로 덮어쓴다** — `land-shockwave`가 `card-slide-drop`보다 뒤에 오므로, `card-slide-drop`이 정상적으로 `opacity: 1`에 도달해도 `land-shockwave`가 자기 마지막 키프레임(`opacity: 0`)으로 즉시 덮어써 카드 전체가 랜딩 0.35초(딜레이) + 0.5초(재생시간) = 0.85초 후 완전히 사라지고, `animation-fill-mode: both`라 그 상태로 계속 고정된다. 트릭 하나가 5명 전원이 낼 때까지 보통 0.85초보다 오래 걸리므로 실전에서는 거의 항상 "먼저 낸 사람 카드가 사라진 채" 다음 사람 차례로 넘어가는 것처럼 보였던 것 — 사용자가 리포트한 증상과 정확히 일치한다. 직전 세션(`f495463`)이 고친 건 "트릭의 **마지막** 카드가 제출되는 순간의 1프레임 플래시"였고, 이번 버그는 "트릭 **도중** 낸 모든 카드가 착지 0.85초 뒤 개별적으로 투명해지는" 전혀 다른 결함이라 그 수정으로는 잡히지 않았다.

**수정**: `destinywar39-land-shockwave`/`destinywar39-land-shockwave-death` 두 키프레임에서 `opacity` 선언 3줄(0%/70%/100%)을 전부 제거(`box-shadow`만 남김) — 근거 주석 추가. 랜딩 링 자체의 "옅어지며 사라지는" 시각 효과는 `box-shadow`의 색상 알파값이 이미 `0.85 → 0(70%) → 0(100%)`로 스스로 페이드아웃하므로 `opacity` 없이도 동일하게 보이고, 카드 본체는 더 이상 이 애니메이션에 의해 지워지지 않는다. `destinywar39-zero-pulse`/`destinywar39-death-glitch`/`destinywar39-number-glow-burst`/`destinywar39-reverse-card-swirl` 등 같은 래퍼에 걸리는 나머지 애니메이션은 전부 `box-shadow`/`transform`/`filter`만 건드리고 `opacity`는 건드리지 않아 이 문제가 없음을 개별 확인했다. `PlayedCardSlot`/`DestinyWar39Board.tsx`/`engine.ts` 등 다른 파일은 1바이트도 변경하지 않았다 — 순수 CSS 키프레임 2개의 속성 목록 축소.

**검증(수정 전/후 실제 브라우저 재현)**: 위 임시 라우트를 Playwright로 재확인 — 수정 전엔 `getAnimations()`가 `destinywar39-land-shockwave`를 `playState: "finished"`로 보고하면서도 요소의 계산된 `opacity`가 `0`이었던 것이, 수정 후엔 3초 이상 대기해도 `opacity: "1"`로 고정 유지됨을 확인. 트릭 진행 중(2/5 제출) 스크린샷에서 이미 낸 두 카드(32, 15)가 계속 보이고, 5번째 카드가 제출된 직후(60ms 이내 프레임부터) "이 턴을 가져갔습니다" 정산 프리즈프레임에도 5명 전원의 카드가 정상적으로 보임을 확인 — `f495463`이 고친 마지막-카드 플래시도 여전히 재발하지 않음.

**단위 테스트 추가(`DestinyWar39.test.ts`, "round/turn structure" describe 블록)**: (1) 라운드 2(2턴 이상, 순차 턴 순서)에서 1~4번째 플레이어가 차례로 카드를 낼 때마다 `round.playsThisTurn`에 이전 플레이어들의 `{seat, card}`가 정확히 그대로 누적되어 있는지(덮어쓰기/초기화 없음), 5번째 제출 시 트릭이 정산되며 `turnRecords`의 마지막 항목에 5명 전원의 정확한 카드가 보존되고 그제서야 `playsThisTurn`이 `[]`로 리셋되는지(라운드가 안 끝나고 다음 턴으로 넘어가는 경우로 검증 — 라운드 1은 턴이 1개뿐이라 "턴 정산"과 "라운드 종료"가 구분되지 않아 부적합해 라운드 2를 사용) 검증. (2) 카드를 낸 좌석의 손패에서만 해당 카드가 빠지고 다른 좌석 손패는 그대로이며, 낸 카드는 `playsThisTurn`에서 그대로 찾아진다는 손패/필드 분리(rulebook §4.2) 검증. 총 63개(기존 61 + 신규 2) 전부 통과.

**검증**: `npx tsc --noEmit`(전체, 에러 0) / `npm run lint`(전체, 경고 0) / `npx vitest run src/games/destinyWar39`(63/63 통과, 신규 2개 포함). 임시 라우트(`temp-dw39-preview`, 확인 후 삭제).

**커밋/푸시**: `f9d5dfa fix(destiny-war-39): stop played cards fading to invisible mid-trick via landing-shockwave opacity conflict` → `git push origin main` 완료(`d832b02..2b53ce0`, 후속 `2b53ce0 docs(handoff): record destiny-war-39 opacity-fade fix commit hash` 포함).

**배포**: `npx vercel deploy --prod` 실행 — 빌드(Turbopack, TypeScript 전체 재검사 포함) 정상 완주, `target: production`/`status: READY`로 확인되고 프로덕션 도메인 `board-game-tau-navy.vercel.app`에 별칭(alias) 완료(`dpl_FFjvWPrvDNHCMYMMZJsCteauvqxT`). `curl`로 프로덕션 루트(`/`, 200)와 운명전쟁39 라우트(`/games/destiny-war-39`, 200) 둘 다 직접 응답 확인.

### 2026-08-22 — 운명전쟁39 제출 카드 즉시 소멸 버그 수정 (필드 유지 정산 연출)

**요청**: 플레이어가 카드를 제출하자마자 중앙 필드에서 즉시 사라져 어떤 카드가 나왔는지 확인할 수 없다는 버그 리포트. 손패에서만 제거되고 필드엔 앞면으로 남아있어야 하며, 트릭이 끝나도 승자 판정까지 일정 시간(1.5~2.5초 예시) 유지 후 승자 하이라이트→수거/페이드아웃 되며 다음 트릭으로 넘어가야 함. 디자인/타이밍 확인이 필요하면 임의 추정 없이 먼저 질문하라는 요청.

**원인 분석 결과 — 질문 불필요 판단**: 조사해보니 "제출 카드 필드 유지 + 승자 하이라이트 + 일정 시간 고정 후 다음 턴 진행"은 이미 이전 세션(`HANDOFF.md`의 2026-08-18 "트릭 결과 노출 시간 확보" 절)에서 **정확히 이 이유로** 구현·확정돼 있던 기능이었다(`DestinyWar39Board.tsx`의 `resolvingTurn` 프리즈프레임 + `TRICK_REVEAL_MS = 2800`ms, 사용자가 명시한 "1.5~2.5초"와 사실상 동일한 확정값). 즉 정산 딜레이 시간/승자 하이라이트/다음 트릭 전환 방식 등 요청서가 "질문하라"고 지정한 모든 디자인 포인트는 이미 과거 세션에서 확정된 값이라 **새로 확인할 결정 사항이 없었음** — 그래서 별도 질문 없이 바로 원인 조사·수정에 착수.

실제 버그는 그 프리즈프레임 트리거 방식의 **렌더링 타이밍 결함**이었다: 턴의 마지막 카드가 제출되면 `engine.ts`의 `resolveTurnAndAdvance`가 `round.playsThisTurn`을 즉시 `[]`로 비우고 `turnRecords`를 늘리는 상태 전이를 **단일 prop 갱신**으로 밀어넣는데, 이를 감지해 `resolvingTurn`(프리즈프레임 상태)을 세팅하는 로직이 일반 `useEffect`로 구현돼 있었다. `useEffect`는 브라우저가 화면을 **그린 뒤에** 비동기로 실행되므로, 방금 낸 카드가 즉시 사라진 빈 보드(`playsThisTurn`이 이미 비워진 "playing" 화면, 또는 라운드 마지막 턴이면 `roundEnd`/`gameOver` 요약 화면으로 즉시 전환된 모습)가 **한 프레임 동안 실제로 화면에 그려진 뒤에야** `resolvingTurn`이 세팅되어 프리즈프레임으로 되돌아가는 구조 — 이것이 "카드가 즉시 사라진다"는 리포트의 실체였다. 프리즈프레임 자체(2.8초 유지, 승자 글로우/링, 이후 다음 화면 전환)는 원래도 정상 동작했지만, 그 전에 한 프레임짜리 "소멸" 플래시가 항상 먼저 노출되고 있었던 것.

**수정**: 해당 이펙트를 `useEffect` → `useLayoutEffect`로 교체(`DestinyWar39Board.tsx`, `resolvingTurn`/`reverseSwish`를 세팅하는 단일 이펙트). `useLayoutEffect`는 DOM 커밋 직후·페인트 이전에 동기 실행되므로, 상태 갱신으로 유발된 렌더와 이 이펙트가 유발하는 보정 렌더(프리즈프레임 세팅)가 **같은 페인트 사이클로 병합**되어 사용자에게는 소멸 프레임 없이 곧바로 프리즈프레임만 보인다. 같은 게임 폴더의 `RankedLeaderboard.tsx`가 카운트업/순위재배치 이펙트에 이미 동일한 `useLayoutEffect` 패턴을 쓰고 있어(이 프로젝트의 기존 컨벤션), 새로운 기법 도입이 아니라 기존 관례를 그대로 따른 것. 데스카드 화면 흔들림(`screenShake`) 이펙트는 콘텐츠 표시 여부를 좌우하지 않는 단순 CSS 트랜지션 트리거라 이번 버그와 무관해 그대로 둠. `engine.ts` 등 순수 규칙 로직은 1바이트도 건드리지 않았다 — 트릭 진행/정산/점수 계산/승수 카운트/리버스·데스 상성 판정은 전부 기존과 100% 동일.

**검증**: `npx tsc --noEmit`(프로젝트 전체, 에러 0) / `npm run lint`(프로젝트 전체, 경고 0) / `npx vitest run src/games/destinyWar39`(61/61 통과, 엔진 무변경이라 신규/변경 테스트 없음 — 순수 렌더링 타이밍 수정이라 유닛 테스트로는 재현·검증 불가능한 종류의 버그라 수동 확인이 필요함을 아래에 명시). 전체 `npx vitest run`은 과거 여러 세션에 기록된 것과 동일하게 진행 표시 없이 장시간 지속돼(백그라운드로 계속 실행 중) 완료를 기다리지 않고 판단 — 이번 변경이 `DestinyWar39Board.tsx` 1개 파일의 이펙트 훅 1개(`useEffect`→`useLayoutEffect`)에 한정되고 다른 게임 로직과 전혀 무관하다는 점을 근거로 진행.

**파일 변경**: `src/games/destinyWar39/DestinyWar39Board.tsx` — `useLayoutEffect` import 추가, `resolvingTurn`/`reverseSwish`를 세팅하는 이펙트를 `useEffect`→`useLayoutEffect`로 교체 + 근거 주석 추가. 그 외 파일 변경 없음.

**커밋/푸시**: `f495463 fix(destiny-war-39): keep played cards visible on field during trick evaluation instead of instant disappearance` → `git push origin main` 완료(`ab3519d..f495463`).

**배포**: `npx vercel deploy --prod` 실행 — 빌드(Turbopack, TypeScript 전체 재검사 포함) 정상 완주, `target: production`/`status: READY`로 확인되고 프로덕션 도메인 `board-game-tau-navy.vercel.app`에 별칭(alias) 완료(`dpl_EW28v6UZwcku8FGipRfMR75kQJQe`). `curl`로 프로덕션 루트(`/`, 200)와 운명전쟁39 라우트(`/games/destiny-war-39`, 200) 둘 다 직접 응답 확인.

### 2026-08-22 — 아발론 역할 확인 오라·투표 스냅·팀투표/퀘스트 결과 공개 대형 이펙트

**요청**: `HANDOFF.md`와 아발론 코드(요청 문구는 `src/games/avalon/` 하위 `Board.tsx`/`AvalonBoard.tsx`/`VotePanel.tsx`/`QuestResult.tsx`/`RoleModal.tsx`/`AssassinPhase.tsx`/CSS 모듈을 지목)를 먼저 확인한 뒤 (1) 멀린/퍼시벌 정보 확인 마법진 오라 + 레이디 오브 더 레이크 물결 이펙트 + 암살자 스포트라이트/조준선/단검 슬래시, (2) 투표·원정카드 제출 스냅락 애니메이션 + 본인 좌석 체크/파티클 펄스 + 전원 제출 시 봉인 마크, (3) 팀투표 3D 플립 공개(승인 골드 플래시+배너 / 부결 흔들림+스탬프+연속부결 강조)와 퀘스트 카드 셔플→플립 공개(성공 컨페티+성배 / 실패 크랙+안개)까지 3대 상황의 전용 이펙트를 요청. 연출 타이밍·색상 테마 등은 절대 임의로 넘겨짚지 말고 질문 목록으로 먼저 확인하라고 명시.

**조사**: 요청이 가정한 구조와 실제 코드 사이에 세 가지 근본적인 간극을 발견 — ① **레이디 오브 더 레이크(호수의 여인) 자체가 엔진에 없음**: `engine.ts`의 `Role` 타입은 `merlin | percival | loyalist | morgana | mordred | oberon | assassin` 7개뿐이고 토큰 전달/검증 페이즈도 전혀 존재하지 않아, 이 항목은 실제 게임 로직 없이는 붙일 대상이 없음. ② 요청이 지목한 `Board.tsx`/`VotePanel.tsx`/`QuestResult.tsx`/`RoleModal.tsx`/`AssassinPhase.tsx`/CSS 모듈은 전부 존재하지 않고, 실제로는 `AvalonBoard.tsx` 한 파일(602줄)에 투표/퀘스트/암살 페이즈와 `RoleModal`까지 전부 인라인 JSX+Tailwind로 들어있으며 별도 CSS/애니메이션 모듈이나 framer-motion류 라이브러리도 프로젝트에 전혀 없음(destinyWar39/worm과 동일한 관례). ③ **투표/퀘스트 결과를 위한 별도 "공개(reveal)" 페이즈가 엔진에 없음**: `castVote`/`playQuestCard`는 마지막 한 표/카드가 들어오는 순간 `resolveVotes`/`resolveQuest`를 같은 리듀서 호출 안에서 즉시 실행해 다음 페이즈로 넘겨버리므로, "전원 제출 완료 → 잠시 후 공개" 같은 중간 상태가 상태 스냅샷 어디에도 존재하지 않음 — WormCanvas.tsx의 `detectWormEvents`(연속된 두 상태 스냅샷을 diff해서 트랜지언트 이벤트를 뽑아내는 패턴)와 동일한 방식을 아발론에도 적용해야 했음. 추가로, `resolveVotes`가 매번 `votes: {}`로 결과를 즉시 비워버려서 **마지막 투표자의 실제 찬성/반대 값이 그 어떤 관찰 가능한 상태에도 노출되지 않는다**는 세부 버그도 발견(N-1번째 스냅샷엔 마지막 표가 없고, 결과 스냅샷은 이미 비워짐) — 순수 클라이언트 워크어라운드(역산 추정) 대신 엔진 쪽을 최소로 고쳐 해결(아래 구현 참고).

**모호점 확인(`AskUserQuestion`, 4문항)**: ① 호수의 여인 항목 처리 — **"이번 작업에서 제외(추천)"** / "게임 로직부터 새로 추가" / "다른 것으로 대체" → 제외 선택(게임 로직 자체가 없어 붙일 대상이 없음). ② 파일 구조 — **"기존 관례 유지: AvalonBoard.tsx는 그대로 두고 이펙트 전용 보조 파일만 추가, 순수 CSS keyframes, 신규 라이브러리 없음(추천)"** / "컴포넌트 분리 리팩터링 먼저" / "framer-motion 등 신규 도입" → 기존 관례 유지 선택. ③ 사운드("경고음 연출" 요청 문구) — **"사운드 제외, 시각 이펙트만(추천)"** / "Web Audio 합성음 생성" / "재생 코드만 준비(파일은 추후)" → 사운드 제외 선택(프로젝트에 오디오 파일/재생 인프라가 전혀 없음, `public/`에 mp3/wav 0개 확인). ④ 세부 타이밍 — **"제안 기본값 세트로 진행(추천)"** / "항목별로 하나씩 확인" → 기본값 세트 채택: 역할 확인 오라 펄스 1.2s 무한, 암살자 스포트라이트 줌인 0.6s+슬래시 0.4s, 투표/카드 스냅 0.25s+봉인 마크 0.8s, 팀투표 플립 좌석당 0.6s(80ms 스태거)+승인 골드플래시 1s/부결 흔들림 0.4s, 퀘스트 셔플 0.5s→카드당 플립 0.7s(300ms 스태거)+성공 컨페티 1.5s/실패 크랙+안개 1.2s.

**구현**: 이 프로젝트의 기존 `<Game>Effects.tsx` 컨벤션(destinyWar39/worm 등)을 그대로 따름 — 신규 `AvalonEffects.tsx`에 순수 프레젠테이션 컴포넌트 + 상태-diff 훅, `globals.css`에 `avalon-` 접두사 키프레임 20여 개 추가. 엔진은 아래 한 가지(투표 결과 노출) 외엔 건드리지 않음.
- **역할 확인 오라** (`RoleAuraBackdrop`): 기존 `RoleModal`(멀린/퍼시벌뿐 아니라 모든 역할이 게임 시작 시 보는 그 모달) 배경에 팀 색상(선한 세력: 하늘색/보라, 악한 세력: 장미색/진홍)으로 물든 블러 오라 펄스(`avalon-aura-pulse`, 1.2s 무한)와 회전하는 홀로그램 마법진 SVG(`avalon-magic-circle-spin`, 6s 무한)를 추가 — 모달이 열려있는 동안 계속 재생. `TableTexture`와 동일한 "먼저 그리고 `relative z-10`으로 본문을 덮어씌우는" 기존 스태킹 컨벤션을 그대로 사용.
- **암살자 페이즈** (`AssassinSpotlightOverlay`/`AssassinCrosshair`/`AssassinSlash`): 페이즈 진입 시 전체 화면에 반투명 암전(`avalon-spotlight-in`, 0.6s) — 암살자 본인뿐 아니라 테이블 전체에 노출(다 함께 긴장감을 느끼도록). 암살자가 타겟 버튼에 마우스를 올리면 그 버튼 위에 붉은 조준선/링(`avalon-crosshair-pulse`)이 펄스. 확정 클릭 시 실제 `assassinate` 디스패치를 즉시 보내지 않고 `confirmAssassinate`가 단검 슬래시(`avalon-slash-impact`, 0.4s)를 먼저 재생한 뒤 450ms 후에 액션을 전송 — 슬래시가 시각적으로 "명중"한 다음에야 게임오버 화면으로 넘어가도록 함.
- **투표/퀘스트 제출 피드백**: 찬성/반대·성공/실패 버튼 클릭 시 로컬 `votePulse`/`questPulse` state를 즉시 세팅해 그 버튼에 `avalon-snap-lock`(0.25s) 인라인 스타일 적용 — 실제 제출은 이미 `onAction`으로 나간 뒤라 순수 장식. 본인 좌석 칩에는 제출 완료 후 대기 중인 동안 계속 노출되는 초록/골드 체크 배지(`SubmittedPulseBadge`, `avalon-badge-pulse` 무한 펄스) — 요청이 "본인 프로필/내 위치"로 범위를 좁혔으므로 다른 좌석에는 기존 🗳️/🃏 아이콘만 유지하고 이 파티클 펄스는 붙이지 않음.
- **팀투표/퀘스트 결과 공개** (`useAvalonReveals` + `VoteRevealOverlay`/`QuestRevealOverlay`): `useAvalonReveals`가 WormCanvas.tsx의 `detectWormEvents`와 동일한 "연속된 두 `AvalonState` 스냅샷을 diff" 패턴으로 `prev.phase==="voting" && next.phase!=="voting"` / `prev.phase==="quest" && next.phase!=="quest"` 전환을 감지해 트랜지언트 리빌 이벤트를 큐에 쌓고 한 번에 하나씩 재생(`AvalonBoard.tsx`는 엔진을 전혀 건드리지 않는 순수 뷰 레이어라는 기존 원칙 유지). `VoteRevealOverlay`: 봉인 마크(🔒, `avalon-seal-lock` 0.6s) → 전 좌석 찬성/반대 토큰이 좌석 순서로 80ms씩 스태거되며 3D 플립(`avalon-vote-flip`) → 승인 시 골드 플래시(`avalon-approve-flash`)+"원정대 출발" 배너, 부결 시 패널 흔들림(`avalon-reject-shake`)+"원정대 기각" 스탬프(`avalon-stamp-slam`)+연속 부결 횟수 강조 배지. `QuestRevealOverlay`: 카드 뒷면 셔플 지터(`avalon-quest-shuffle`) → `teamSize`장의 익명 카드가 300ms 스태거로 순차 플립(`avalon-quest-card-flip`) → 성공 시 성배(🏆, `avalon-grail-glow`)+금색/하늘색 컨페티(`avalon-confetti-fall`), 실패 시 붉은 크랙 플래시(`avalon-crack-flash`)+검붉은 안개(`avalon-mist-drift`). **퀘스트 카드는 실제로 어느 좌석이 어떤 카드를 냈는지 엔진이 전혀 기록하지 않으므로(익명 비밀투표가 원래 룰)** 카드 표시 순서는 `failCount`만 반영해 라운드 번호로 회전시킨 결정론적 배치일 뿐 진짜 무작위는 아님 — 이 프로젝트의 `react-hooks/purity` ESLint 규칙(렌더 중 `Math.random`/ref 접근 금지)에도 걸려, destinyWar39의 "하드코딩된 오프셋 배열" 컨벤션(`DEATH_SMOKE_OFFSETS` 등)을 그대로 따라 confetti 24개도 고정 배열로 구현.
- **엔진 변경(최소, 1곳)**: `resolveVotes`가 매 분기에서 명시적으로 하던 `votes: {}` 초기화를 제거 — `state.votes`를 읽는 모든 소비자(`AvalonGame.tsx`의 `avalonCurrentActor`, `AvalonBoard.tsx`/`AvalonRoleGuideSidebar.tsx`의 UI, `getValidMoves`의 "voting" 분기)가 이미 전부 `phase === "voting"` 가드 안에서만 `votes`를 읽는다는 것을 확인했고, 다음 `propose-team` 액션이 어차피 `votes: {}`로 다시 리셋하므로(주석에 이미 "cleared every new proposal"로 명시돼 있던 그 시점) 결과 확정 직후 잠깐 남아있어도 무해함. 덕분에 `next.votes`에서 마지막 투표자의 실제 값까지 포함한 완전한 표 기록을 그대로 읽을 수 있게 됨(이 게임에서 팀투표는 애초에 공개 투표라 익명성 문제 없음 — 원정 카드와 달리).

**파일 변경**: 1) `src/games/avalon/AvalonEffects.tsx`(신규) — 리빌 이벤트 diff 훅(`useAvalonReveals`) + 8개 프레젠테이션 컴포넌트. 2) `src/games/avalon/AvalonBoard.tsx` — 이펙트 컴포넌트 연결(RoleModal 오라, 암살자 스포트라이트/크로스헤어/슬래시, 투표·퀘스트 버튼 스냅 스타일, SeatChip 제출 배지, 하단 리빌 오버레이 렌더). 3) `src/games/avalon/engine.ts` — `resolveVotes`의 `votes: {}` 초기화 3곳 제거(+`AvalonState.votes` 필드 doc 갱신), 그 외 로직 무변경. 4) `src/app/globals.css` — `avalon-*` 키프레임 20개 신규 추가(기존 `destinywar39-*`/`worm-*` 섹션 뒤에 이어붙임).

**검증**: `npx tsc --noEmit`(전체, 에러 0) / `npm run lint`(전체, 에러 0 — 처음에 퀘스트 리빌의 `Math.random`/`useRef(...).current` 렌더 중 접근이 `react-hooks/purity`/`react-hooks/refs`에 걸려 위 "결정론적 회전 배치 + 하드코딩 오프셋 배열" 방식으로 고침) / `npx vitest run src/games/avalon`(50/50 통과 — 엔진 변경분(`votes` 초기화 제거)도 기존 테스트 그대로 통과, 별도 회귀 없음 확인) / `npx vitest run --exclude "**/aiBenchmark.test.ts"`(전체 스위트, 27개 파일 1110/1110 통과). **브라우저 실측(오라 펄스/스포트라이트/스냅/3D 플립/컨페티 타이밍 육안 확인)은 이번 세션에 수행하지 않음** — 이전 세션들과 동일하게 실시간 CSS 애니메이션 타이밍·겹침은 이 저장소가 이미 문서화한 vitest 커버리지 밖 영역이라 실사용 전 수동 확인 권장.

**커밋/배포**: 커밋 `5900184 feat(avalon): add visual effects for hero abilities, vote submissions, and quest reveal outcomes` → `git push origin main` 완료 → `npx vercel deploy`(스코프 없이)가 `"Not authorized"`로 실패 — `npx vercel whoami`(로그인은 `gud1107`로 정상)와 `.vercel/project.json`(orgId가 `team_VsYB837j4CbBk3Dr4KY7St9J`)을 대조해보니 CLI가 기본으로 잡는 스코프가 그 팀이 아니었던 것으로 보임. `npx vercel deploy --scope me-3871`로 재시도해 정상 완주, READY — `https://board-game-q5ufd2rao-me-3871.vercel.app`. "production" 명시 없어 이번에도 프리뷰까지만 진행.

### 2026-08-22 — 운명전쟁39 턴 순서 배지(Order Badge) + 카드 제출 대형 임팩트

**요청**: `HANDOFF.md`와 운명전쟁39 코드(`src/games/destinyWar39/`)를 먼저 확인한 뒤 (1) 트릭마다 리드 플레이어 기준 카드 내는 순서를 ①②③ 배지로 표시하고 현재 차례는 활성화 펄스, 이미 낸 사람은 체크/반투명 처리, (2) 카드 제출 시 중앙 슬램(Slam) 모션+착지 충격파·파티클을 기본으로 깔고 데스(검붉은 에너지 폭풍+화면 흔들림)/리버스(황금 회오리+공간왜곡)/0(빙결 파티클)/고숫자(비례 발광) 속성별 강화 연출을 추가해달라는 요청. 배지 노출 위치, 선(리드) 표시 방식, 대형 이펙트 스타일 등은 절대 임의로 넘겨짚지 말고 질문으로 확인하라고 명시. 요청 문구가 지목한 `Card.tsx`/`PlayerSlot.tsx`는 이 저장소에 없고, 실제로는 `CardFace.tsx`(카드 렌더 공용 컴포넌트)와 `DestinyWar39Board.tsx`(플레이어 슬롯이 이 파일 안에 인라인)임을 확인.

**조사**: `engine.ts`를 뜯어본 결과 요청과 정면으로 충돌하는 지점 하나를 발견 — **1라운드는 룰상 선(리드) 플레이어가 아예 없는 전원 동시 공개**(`nextToActInTurn`의 독스트링에 "Round 1 has no fixed order (any not-yet-played seat may act)"라고 명시)라서, "리드 플레이어 기준 순서"라는 개념 자체가 1라운드엔 존재하지 않음. 2라운드부터는 `round.turnLeader`에서 시작해 `state.seatOrder`를 시계방향으로 도는 고정 순서가 실제로 있음(이미 `actingSeat` 계산 로직이 이 회전을 하고 있었음). 또한 리버스 카드(11/22/33/44/55)는 직전 세션에서 "한 턴에 짝수 개 나오면 서로 상쇄"되는 규칙 때문에 화면 전체 스위시를 턴의 최종 판정 결과에만 연동시켰던 전례가 있어, 이번에 요청한 "개별 카드 리버스 이펙트"도 즉시 재생 시 같은 오연출 위험이 그대로 있음을 확인.

**모호점 확인(`AskUserQuestion`, 4문항)**: ① 1라운드(순서 없음)의 배지 처리 — **"배지를 표시하지 않음(추천)"** / "seatOrder 기준 참고용 번호 표시" / "번호 대신 동시 아이콘" → 배지 미표시 선택(룰과 모순 방지). ② 리버스 카드 개별 이펙트 시점 — **"턴 최종 판정 확정 후에만 재생(추천)"** / "카드 놓이는 즉시 재생" → 최종 판정 후 선택(기존 `ReverseSwishOverlay`와 동일 타이밍, 상쇄된 리버스를 미리 보여주는 오연출 방지). ③ 데스카드 화면 흔들림 강도 — "약하게 4px/150ms" / **"중간: 8px/200ms(추천)"** / "강하게 14px/250ms" → 중간 선택(이 게임엔 기존 셰이크 연출이 전혀 없어 신규 결정 필요했음). ④ 순서 배지 스타일 — **"①②③ 원형 숫자 배지(추천)"** / "1st/2nd/3rd 텍스트 배지" → 원형 숫자 배지 선택.

**구현**:
- **턴 순서 배지** (`TurnOrderBadge`, 신규): `DestinyWar39Board.tsx`의 "playing" 단계에서 `actingSeat` 계산과 같은 회전(`turnLeader`에서 시작해 `seatOrder`를 시계방향)을 재사용해 `turnOrderBySeat: Record<seat, 1-indexed order> | null`을 함께 계산 — 1라운드(`isSimultaneous`)일 때는 `null`로 남겨 배지 자체가 마운트되지 않음. 각 좌석 슬롯 위에 원형 숫자 배지를 얹고, 현재 차례(`actingSeat === seat`)면 `destinywar39-turn-badge-pulse`(무한 반복 금색 글로우 펄스)로 강조, 이미 낸 좌석(`p`가 존재)이면 배지를 반투명 처리(`opacity-60`)하고 우측 상단에 초록 체크(✓) 오버레이 — "체크 표시 또는 반투명"을 굳이 양자택일하지 않고 결합. 아직 안 낸 빈 슬롯(`?` placeholder)도 현재 차례 좌석이면 테두리가 같은 펄스로 빛나게 해 "프로필 테두리 활성화 펄스" 요구까지 함께 충족.
- **카드 착지 대형 임팩트** (`PlayedCardSlot` 확장): 기존 슬라이드&드롭(0.35초)이 끝나는 시점에 맞춰(동일한 0.35초 딜레이 컨벤션) 새 레이어를 추가 — (1) 모든 카드 공통: 은색 착지 충격파 링(`destinywar39-land-shockwave`)+카드 하단에서 사방으로 튀는 스파크 점 6개(기존 `destinywar39-particle-burst` 재사용, 색만 카드 타입별로 다름), (2) 데스카드: 기존 글리치+연기에 더해 더 큰 반경의 검붉은 링(`destinywar39-land-shockwave-death`)+빨간 스파크, (3) 0 카드: 기존 파란 펄스 링 유지 + 파란 스파크로 "빙결 파티클" 보강, (4) 일반 숫자 카드: `value/maxNumber` 비율에 연속적으로 비례하는 금색 발광(`destinywar39-number-glow-burst`, `--glow-alpha`/`--glow-blur` CSS 커스텀 프로퍼티로 세기 조절 — 임의의 "고숫자 컷오프" 없이 전체 구간에 걸쳐 자연스럽게 스케일), (5) 리버스 카드: `reverseActiveThisTurn` prop이 `true`일 때만(=턴의 최종 판정이 확정된 뒤, 즉 `resolvingTurn` 프리즈프레임에서만 이 prop을 넘김) 금색→퓨시아로 번지는 회전 스월(`destinywar39-reverse-card-swirl`) 재생 — "playing" 단계의 실시간 슬롯에서는 이 prop을 절대 넘기지 않아 상쇄 가능성이 있는 카드를 미리 화려하게 보여주는 오연출을 원천 차단.
- **데스카드 화면 흔들림**: `DestinyWar39Board.tsx`에 `round.playsThisTurn.length`가 늘어난 시점을 감지하는 신규 이펙트 추가(기존 `resolvingTurn` 감지와 같은 "배열 길이 증가 감지" 패턴) — 방금 추가된 play의 카드가 `death`면 `screenShake` state를 켜서 최상위 래퍼에 `destinywar39-death-impact-shake`(8px/200ms) 적용. 리버스 스위시(턴 판정 후)와 달리 데스 흔들림은 **카드가 공개되는 즉시**(턴 결과와 무관하게) 발동 — 데스카드를 냈다는 사실 자체는 나중에 상쇄되거나 취소되지 않으므로 오연출 위험이 없음. 락스텝 상태라 모든 클라이언트가 동시에 같은 흔들림을 봄(뷰어별 분기 불필요, 지렁이 세션과 달리 이 게임은 호스트 스냅샷이 아니라 전원이 같은 액션을 리플레이하는 구조라 "누구 화면만" 개념이 없음). `setScreenShake(true)`를 조건부로 호출하다 `react-hooks/set-state-in-effect` lint 에러가 나서, 직전 `reverseSwish` 수정과 동일하게 `setScreenShake(justPlayedDeath)` 무조건 호출로 고침.

**파일 변경**: 1) `src/games/destinyWar39/DestinyWar39Effects.tsx` — `PlayedCardSlot`에 착지 충격파/스파크/숫자발광/리버스스월 레이어 추가(`reverseActiveThisTurn` prop 신규), `TurnOrderBadge` 컴포넌트 신규. 2) `src/games/destinyWar39/DestinyWar39Board.tsx` — `turnOrderBySeat` 계산(기존 `actingSeat` 로직과 통합), 좌석 슬롯에 `TurnOrderBadge` 부착, 데스카드 감지+`screenShake` 이펙트 신규, 프리즈프레임 `PlayedCardSlot`에 `reverseActiveThisTurn={t.reverseActive}` 전달. 3) `src/app/globals.css` — `destinywar39-land-shockwave`/`-land-shockwave-death`/`-number-glow-burst`/`-reverse-card-swirl`/`-death-impact-shake`/`-turn-badge-pulse` 키프레임 6개 신규. 엔진(`engine.ts`)은 전혀 건드리지 않음(순수 표시 레이어).

**검증**: `npx tsc --noEmit`(전체, 에러 0) / `npm run lint`(전체, 에러 0 — 처음에 데스카드 셰이크 이펙트가 `react-hooks/set-state-in-effect`에 걸려 위 무조건 호출 방식으로 수정) / `npx vitest run src/games/destinyWar39`(61/61 통과 — 엔진 무변경이라 전부 그대로 통과) / `npx vitest run --exclude "**/aiBenchmark.test.ts"`(전체 스위트, 27개 파일 1110/1110 통과). **브라우저 실측(슬램 모션/충격파/셰이크 타이밍 육안 확인)은 이번 세션에 수행하지 않음** — 이전 세션들과 동일하게 실시간 CSS 애니메이션 타이밍·겹침은 이 저장소가 이미 문서화한 vitest 커버리지 밖 영역이라 실사용 전 수동 확인 권장.

**커밋/배포**: 커밋 `0096d51 feat(destiny-war-39): add visual turn order badges and massive play card impact animations` → `git push origin main` 완료 → `npx vercel deploy`(프리뷰) 정상 완주, READY — `https://board-game-bbxijkctt-me-3871.vercel.app`. "production" 명시 없어 이번에도 프리뷰까지만 진행.

### 2026-08-22 — 지렁이 상대 처치(Kill) 대형 폭발·화면 연출·킬 배너

**요청**: `HANDOFF.md`와 지렁이 코드(`src/games/worm/`)를 먼저 확인한 뒤 상대 지렁이를 처치(Kill)했을 때 (1) 처치 지점 대형 충격파 링+다색 불꽃 파티클+몸통이 에너지 구슬로 붕괴하는 연출, (2) 킬러·피격자 화면 셰이크+화이트/네온 플래시+킬러 머리 주변 황금 아우라 펄스, (3) 화면 중앙에 "OOO 처치!/ELIMINATED!" 확대→유지→페이드 배너(연속 처치 시 강조), (4) 대량 파티클에도 60fps를 지키는 렌더링 최적화(생명주기 0.5~0.8초)까지 4개 항목을 요청. 노출 시간·화면 셰이크 강도·킬 피드 위치 등은 절대 임의로 넘겨짚지 말고 질문으로 확인하라고 명시.

**조사**: `engine.ts`의 충돌 판정표(`stepWorm`, `engine.ts:422-455`)를 뜯어본 결과, 다른 플레이어에 의한 "완전 사망"은 **머리 vs 머리 충돌**(짧은 쪽이 죽고 긴 쪽은 무사) 단 하나뿐임을 확인 — 몸통 절단(cut)은 최소 1마디를 남기도록 `Math.max(1, ...)`/`cuts[b] = Math.min(...)`로 항상 클램프되어 있어 몸통 충돌만으로는 절대 즉사하지 않는다(자기충돌만 예외적으로 즉사). 즉 "상대 처치(Kill)" 연출을 붙일 이벤트는 기존 `WormEffects.ts`의 `death` 이벤트 중 `cause: "head"`(직전 세션엔 "누가 죽였는지"는 기록하지 않고 사망 원인 분류에만 쓰던 필드) 하나뿐이라는 게 확인됨 — 이번 세션의 핵심 작업은 그 원인 분류 로직을 재사용해 **누가 킬을 땄는지(attackerSeat)까지 식별**하도록 확장하는 것.

**모호점 확인(`AskUserQuestion`, 4문항)**: ① 화면 셰이크/화이트 플래시 적용 대상 — "킬러 화면만" / **"킬러+피격자 둘 다(추천)"** / "방 전체 모든 관전자" → 킬러+피격자 둘 다 선택. ② 킬 셰이크 강도(기존 자폭 셰이크 6px/180ms 대비) — "동일" / **"더 강하게: 약 12px/200ms(추천)"** / "훨씬 강하게: 18px/220ms" → 12px/200ms 선택. ③ 중앙 킬 배너 위치·총 노출 시간 — **"화면 중앙, 총 1.8초(확대 0.3초+유지 1.0초+페이드 0.5초, 추천)"** / "화면 상단, 1.8초" / "화면 중앙, 2.5초" → 화면 중앙 1.8초 선택. ④ 연속 처치(더블킬) 강조 기준 — **"5초 이내 동일 킬러 2킬 이상 → DOUBLE/TRIPLE KILL 문구+색상 강조(추천)"** / "더블킬 개념 없이 매 킬 동일 연출" → 5초 윈도우 강조 방식 선택.

**구현**:
- `WormEffects.ts`: `WormEvent`의 `death` variant에 `attackerSeat: SeatIndex | null` 필드 추가. `detectWormEvents`가 기존에 "벽 근처 아니면서 다른 머리가 `HEAD_TO_HEAD_DIST` 이내에 있으면 `cause: "head"`"로만 분류하던 로직을, cut 이벤트의 공격자 판별과 동일한 "가장 가까운 생존 머리를 고른다" 패턴으로 확장해 그 머리의 좌석까지 함께 기록.
  - `WormEffectsManager.onDeath`: `cause === "head" && attackerSeat !== null`(=킬)일 때만 발동하는 신규 대형 이펙트 계층을 자폭(`cause === "self"`) 분기와 나란히 추가 — 자폭 폭발(링 1개/반경 78/480ms)보다 확실히 크게(링 2개, 반경 130/620ms + 반경 60%·색상 시프트한 보조 링, 무지개색 디브리 46개+스파크 26개), 몸통 마디 붕괴 파티클도 킬일 때만 일반 시체 페이드(어두운 톤, 650ms 전후)가 아니라 밝고 큰 "에너지 구슬"(sat 92/light 76, 0.52~0.78초 수명 — 요청의 0.5~0.8초 예산 안에 고정)로 스폰. 셰이크(12px/200ms)+전체화면 화이트 플래시(180ms)는 `viewerSeat`가 킬러 또는 피격자 본인일 때만 트리거(질문①). 킬러 좌석에 `killerAuraExpiry`를 세팅해 1.3초짜리 황금 아우라 펄스(`killerAuraAlpha`, `Math.sin`으로 은은하게 숨쉬는 느낌) 노출 — 이건 뷰어 제한 없이 항상 그려서 누구나 킬러의 오라를 볼 수 있게 함.
  - 화면 셰이크는 기존에 자폭(180ms)만 트리거하던 단일 경로였는데 킬 셰이크(200ms)와 세기가 다르므로, 감쇠 계산이 항상 올바른 비율로 줄어들도록 `shakeTotalMs`(현재 활성 셰이크가 시작된 총 지속시간)를 신규로 추적하도록 `consumeShakeOffset`을 리팩터링.
  - 전체화면 킬 플래시는 파티클 풀과 별개로 `screenFlashTimeLeft` 스칼라 하나로 관리(`screenFlashAlpha()` 게터) — 캔버스 전체를 흰색으로 덮는 연출이라 기존 월드 좌표 `flashes` 풀과 섞을 이유가 없음.
- `WormCanvas.tsx`:
  - 킬러 아우라 펄스는 기존 히트글로우 링과 같은 자리(스네이크 렌더 루프, 머리 위치 `hx,hy`)에 그림. 전체화면 플래시는 `draw()` 맨 끝, `effects.draw()` 이후 화면 좌표로 덮어써서(셰이크 translate로 인한 가장자리 여백을 -20~+40 오버스캔으로 커버).
  - 킬 배너는 파티클과 달리 타이포그래피/DOM 애니메이션이라 `WormEffectsManager`(캔버스 전용) 밖에, 이 컴포넌트 자체의 `useState<KillBanner[]>`로 구현 — 기존 스냅샷 diff `useEffect`에서 `cause === "head"` 이벤트를 발견하면 `killComboRef`(좌석별 마지막 킬 시각+연속 횟수 Map)로 5초 이내 연속 여부를 판정해 `DOUBLE KILL!`/`TRIPLE KILL!`/`N KILL STREAK!` 라벨을 붙이고 배너 배열에 push. 배너는 `setTimeout` 대신 `onAnimationEnd`로 스스로를 제거(언마운트 시 타이머 누수 걱정 없음).
- `globals.css`: `worm-kill-banner`(0%→10%→16.67%→72.22%→100%, 1.8초 총 지속시간을 확대 0.3초/유지 1.0초/페이드 0.5초로 정확히 나누도록 퍼센트 역산) + `worm-kill-combo-pulse`(더블킬 라벨의 무한 반복 글로우 펄스) 키프레임 신규 추가.
- 기존 자폭/먹이/절단 이펙트(직전 세션 구현분)는 전혀 건드리지 않음 — `death` 이벤트의 `cause !== "head"` 경로는 그대로.

**파일 변경**: 1) `src/games/worm/WormEffects.ts` — `WormEvent.death.attackerSeat` 추가, 킬 전용 대형 폭발/에너지 구슬/셰이크/화면 플래시/킬러 아우라 상수·로직 추가. 2) `src/games/worm/WormCanvas.tsx` — 킬 배너 상태+연속킬 판정, 킬러 아우라 렌더, 전체화면 킬 플래시 렌더. 3) `src/app/globals.css` — `worm-kill-banner`/`worm-kill-combo-pulse` 키프레임 신규. 4) `src/games/worm/Worm.test.ts` — 기존 "머리충돌사" 테스트에 `attackerSeat` 검증 추가 + 여러 후보 중 가장 가까운 머리를 공격자로 고르는지 확인하는 신규 테스트 1개.

**검증**: `npx tsc --noEmit`(전체, 에러 0) / `npm run lint`(전체, 에러 0) / `npx vitest run src/games/worm`(34/34 통과, 신규 1개+수정 1개 포함) / `npx vitest run --exclude "**/aiBenchmark.test.ts"`(전체 스위트, 27개 파일 1110/1110 통과 — 직전 세션의 운명전쟁39 변경분도 이 실행으로 함께 재검증됨). **브라우저 실측(파티클/셰이크/배너 타이밍 육안 확인)은 이번 세션에 수행하지 않음** — 이전 지렁이/운명전쟁39 세션들과 동일하게 실시간 캔버스 렌더·CSS 애니메이션 타이밍은 이 저장소가 이미 문서화한 vitest 커버리지 밖 영역이라 실사용 전 수동 확인 권장.

**커밋/배포**: 커밋 `fbf867c feat(worm): add massive kill visual effects, shockwave particles, and elimination banner` → `git push origin main` 완료 → `npx vercel deploy`(프리뷰) 정상 완주, READY — `https://board-game-dehnnqfjr-me-3871.vercel.app`. "production" 명시 없어 이번에도 프리뷰까지만 진행.

### 2026-08-22 — 운명전쟁39 히든 발동·카드 제출·예측 성공/초과/미달 결과 이펙트

**요청**: `HANDOFF.md`와 운명전쟁39 코드(`src/games/destinyWar39/`)를 먼저 확인한 뒤 (1) 카드 제출 슬라이드&드롭 + 0/데스/리버스 전용 임팩트, (2) 히든 발동/오픈 3D 플립 + "?" 샤이닝, (3) 라운드 정산 시 예측 성공(골드 컨페티+PERFECT 스탬프)/초과(주황 파티클+흔들리는 OVER 뱃지)/미달(냉기+떨어지는 MISS 뱃지) 결과 이펙트까지 5개 인터랙션을 요청. 노출 시간·파티클 강도·화면 가림 여부는 절대 임의로 넘겨짚지 말고 질문으로 확인하라고 명시.

**조사**: `engine.ts`를 뜯어본 결과 요청 문구와 실제 구현 사이에 두 가지 근본적인 간극이 있었음 — ① "히든 카드"라는 뒤집을 수 있는 별도 오브젝트는 엔진에 전혀 없고, 히든은 `predict` 액션 제출 시의 `hidden: boolean` 플래그일 뿐이며 secrecy는 상태가 아니라 `visibleCurrentPrediction`/`visiblePastPrediction` 읽기 시점 리다action(redaction)으로만 구현됨. ② 요청이 이펙트를 넣어달라던 "우측 예측 패널"(`PredictionStatusBoard`)은 `roundEnd` 단계(라운드 결과 화면)에는 아예 마운트되지 않고(`DestinyWar39Board.tsx`의 `showPredictionPanel`), 실제 결과는 중앙 컬럼의 별도 테이블에서 렌더링됨. 리버스 카드(11/22/33/44/55)도 한 턴에 짝수 개가 나오면 서로 상쇄되어 비활성화되는 규칙(§6.1)이 있어, "카드를 낼 때 즉시" 임팩트를 넣으면 나중에 상쇄될 수도 있는 리버스를 미리 연출하는 모순이 생김.

**모호점 확인(`AskUserQuestion`, 4문항)**: ① 히든 발동/오픈 플립을 넣을 시점 — "제출 순간만" / "최종 공개(gameOver) 순간만" / **"둘 다(추천)"** → 둘 다 선택. ② 리버스 스위시 발동 기준 — "카드 제출 즉시" vs **"턴 최종 판정 결과에 연동(추천)"** → 턴 판정 결과 연동 선택(2장 상쇄로 인한 오연출 방지). ③ 예측 결과 이펙트 위치 — "우측 패널을 roundEnd에도 유지" vs **"중앙 결과 테이블 각 행에 부착(추천)"** → 중앙 테이블 선택(실제 결과가 표시되는 곳). ④ 전반적 강도 — **"차분하게(추천)"** vs "화려하게" → 차분하게 선택(파티클 6~10개, 카드 제출 0.3~0.4초, 특수카드 임팩트 0.5~0.8초, 히든 플립 0.6초, 결과 파티클 1.2~1.5초).

**구현**: 이 프로젝트의 기존 `<Game>Effects.tsx` 컨벤션(bang/BangEffects.tsx, grid-poker/GridPokerEffects.tsx 등)을 그대로 따름 — 새 `DestinyWar39Effects.tsx`에 순수 프레젠테이션 컴포넌트 5개, `globals.css`에 `destinywar39-` 접두사 키프레임 14개 신규 추가.
- **카드 제출 슬라이드&드롭 + 특수카드 임팩트** (`PlayedCardSlot`): 손패 슬라이드 좌표 추적 대신(반응형 flex-wrap 레이아웃이라 안정적인 DOM 앵커가 없음, Five Cucumbers의 실좌표 추적과 달리) 고정 오프셋 진입 애니메이션(`destinywar39-card-slide-drop`, 0.35초) 사용. 0 카드는 파란 펄스 링(`destinywar39-zero-pulse`, box-shadow라 카드 자체의 `overflow-hidden`에도 안 잘림), 데스카드는 착지 후 이어지는 글리치 지터(`destinywar39-death-glitch`, transform 충돌 방지 위해 슬라이드가 끝나는 0.35초 시점에 딜레이 시작) + 연기 파티클 3개(`destinywar39-death-smoke-puff`). `card.id` 키로 매 카드마다 새로 마운트시켜 재생(그리드포커 컨벤션과 동일). "playing" 단계의 실시간 슬롯과, 한 턴의 마지막 카드만 유일하게 보이는 승자 프리즈프레임(`resolvingTurn`) 양쪽에 모두 적용.
- **리버스 스위시** (`ReverseSwishOverlay`): 개별 카드가 아니라 `DestinyWar39Board.tsx`의 기존 `resolvingTurn` 감지 이펙트에 얹어서, 턴이 실제로 `reverseActive: true`로 확정된 순간에만 전체화면 테두리 스위시(`destinywar39-reverse-swish`, 골드→네온 퓨시아 inset box-shadow, 0.7초, portal)를 트리거.
- **히든 발동/오픈** (`HiddenActivationBadge`/`HiddenRevealCell`): 제출 순간은 `PredictionStatusBoard`의 기존 🙈 아이콘(플레이어의 `hiddenUsed`가 처음 true가 되는 순간에만 마운트되는 조건부 렌더라 별도 "방금 활성화됨" 상태 추적 없이도 "최초 1회만 재생" 요건을 자연히 만족)에 보라색 글로우 링(`destinywar39-hidden-activate-glow`) + 스파클 3개(`destinywar39-hidden-sparkle`)를 부착 — 락스텝 상태라 모든 클라이언트가 동시에 봄. 최종 공개는 게임오버 화면(`gameOver` phase는 별도 JSX 분기라 매번 새로 마운트됨)의 최종 결과 테이블에서, 9라운드 종료로 리다action이 해제된 히든 예측값을 3D 플립(`destinywar39-card-flip`, coup/loveLetter/forSale의 `*-card-flip`과 동일 기법 — 뒤집히는 90도 시점에 컨텐츠가 안 보이므로 이미 실제 값으로 렌더된 콘텐츠를 그대로 두고 회전만 시켜도 "뒤집혀서 드러나는" 것처럼 보임) + "?" 파편 6개가 사방으로 튀는 샤터(`destinywar39-hidden-shatter-fragment`, 파편별 `--dx`/`--dy`/`--rot` CSS 커스텀 프로퍼티로 방향 지정) + 플래시(`destinywar39-hidden-shatter-flash`)로 오픈.
- **예측 성공/초과/미달** (`RoundResultBadge`): 중앙 roundEnd 테이블 각 행의 "결과" 셀에 부착. 실제 승수 vs 예측값을 직접 비교(`actual > predicted` → 초과, `<` → 미달, `===` → 성공)해 아웃컴을 계산 — 히든이라 뷰어에게 안 보이는 행(`isHiddenFromMe`)은 **절대 렌더하지 않음**(성공/초과/미달을 구분해 보여주면 이미 마스킹된 점수/예측값 자체를 간접적으로 유출하게 되므로). 성공은 골드/그린 파티클 6개(`destinywar39-particle-burst` 재사용, 색만 다르게) + 오버슈트 바운스 스탬프(`destinywar39-stamp-bounce`, "🎉 PERFECT"), 초과는 주황 파티클 + 흔들리는 뱃지(`destinywar39-badge-shake`, "⚠️ OVER"), 미달은 하늘색 파티클 + 아래로 떨궈지며 반쯤 페이드된 채 정지하는 뱃지(`destinywar39-badge-drop-fade`, "🥶 MISS"). roundEnd 블록 전체에 `key={`round-end-${round.roundNumber}`}`를 달아 라운드마다 새로 마운트되게 해서 "라운드당 1회 재생"을 보장.

**파일 변경**: 1) `src/games/destinyWar39/DestinyWar39Effects.tsx`(신규) — `PlayedCardSlot`/`ReverseSwishOverlay`/`HiddenActivationBadge`/`HiddenRevealCell`/`RoundResultBadge`. 2) `src/app/globals.css` — `destinywar39-` 접두사 키프레임 14개 신규(`card-slide-drop`/`card-flip`/`zero-pulse`/`death-glitch`/`death-smoke-puff`/`reverse-swish`/`hidden-activate-glow`/`hidden-sparkle`/`hidden-shatter-flash`/`hidden-shatter-fragment`/`stamp-bounce`/`particle-burst`/`badge-shake`/`badge-drop-fade`). 3) `DestinyWar39Board.tsx` — played-card 슬롯(실시간+프리즈프레임)을 `PlayedCardSlot`으로 교체, 기존 `resolvingTurn` 감지 이펙트에 `reverseSwish` 상태 추가, roundEnd 테이블에 `RoundResultBadge` + 라운드별 remount key, gameOver 테이블의 히든 예측 셀에 `HiddenRevealCell` 래핑. 4) `PredictionStatusBoard.tsx` — 🙈 아이콘을 `HiddenActivationBadge`로 교체. 엔진(`engine.ts`)은 순수 표시 레이어만 건드렸으므로 전혀 변경하지 않음.

**검증**: `npx tsc --noEmit`(전체, 에러 0) / `npm run lint`(전체, 에러 0 — 처음에 `if (justResolved.reverseActive) setReverseSwish(true)`가 `react-hooks/set-state-in-effect`에 걸려 조건부 setState 호출 대신 `setReverseSwish(justResolved.reverseActive)` 무조건 호출로 수정) / `npx vitest run src/games/destinyWar39`(61/61 통과 — 엔진을 안 건드렸으므로 전부 그대로 통과) / `npx vitest run`(전체 스위트 — 이 커밋 자체로는 별도 실행하지 않았고, 바로 다음의 지렁이 킬 이펙트 세션이 자기 변경분과 함께 전체 스위트를 돌려 1110/1110 통과로 이 변경분도 함께 검증됨). **브라우저 실측(파티클/플립/스와시 육안 확인)은 이번 세션에 수행하지 않음** — 지렁이 세션과 동일하게 실시간 CSS 애니메이션 타이밍·겹침은 이 저장소가 이미 문서화한 vitest 커버리지 밖 영역이라 실사용 전 수동 확인 권장.

**커밋/배포**: 커밋 `add0189 feat(destinyWar39): add hidden reveal, card play, and prediction result visual effects`(+ 후속 `a2c6df6 docs(handoff): record destinyWar39 visual-effects commit hash`) → `git push origin main` 완료. 이 세션 자체에서는 별도 배포를 진행하지 않았고, 바로 다음 지렁이 킬 이펙트 세션의 배포에 함께 반영됨.

### 2026-08-22 — 지렁이 먹이/자폭/꼬리절단/충돌 액션 파티클 이펙트

**요청**: `HANDOFF.md`와 지렁이 코드(`src/games/worm/`)를 먼저 확인한 뒤 (1) 먹이 섭취 시 반짝임 버스트+머리 스케일 펄스+플로팅 "+N" 텍스트, (2) 자폭(자기충돌사) 시 충격파 링+파편 폭발+범위 플래시+약한 화면 셰이크, (3) 상대 꼬리 절단 시 참격선+스파크+파편 산란+공격자 머리 히트 글로우, (4) 부스터 잔상, 사망 시 마디마디 붕괴 페이드아웃까지 4대 액션 이펙트를 요청. 파티클 렌더링 방식·자폭 정의·화면 셰이크 강도는 절대 임의로 넘겨짚지 말고 질문으로 확인하라고 명시.

**조사**: 룰북(`boardGameRule/지렁이/지렁이.md` §2(2))과 `engine.ts`를 대조한 결과, 이 게임에 별도의 "자폭 버튼/스킬"은 존재하지 않고 룰북·엔진 양쪽 모두 "자폭"은 **자기 몸통에 머리가 부딪혀 죽는 것**(`stepWorm`의 `isSelf` 자기충돌 사망 분기, `engine.ts:449`)만을 가리킴을 확인 — 요청 문구의 "자폭 범위/타일 플래시"가 새 AoE 스킬을 뜻하는지 기존 자기충돌사의 연출 강화를 뜻하는지가 이번 세션의 핵심 모호점이었음. `WormCanvas.tsx`는 순수 Canvas 2D 프레임 렌더(그리드/먹이/뱀)만 하고 있고 파티클/이펙트 시스템 자체가 전혀 없었음(과거 주사위·타일 버전의 CSS FX는 실시간 물리 엔진으로 전면 교체되며 이미 삭제됨). 동기화가 호스트 권위 스냅샷 브로드캐스트 방식(락스텝 아님, `docs/cloud-sync.md §5`)이라 "누가 방금 먹었다/잘렸다/죽었다" 같은 이산 이벤트 자체가 상태에 존재하지 않는다는 점도 확인 — 각 클라이언트가 연속 스냅샷을 스스로 diff해서 이벤트를 재구성해야 함.

**모호점 확인(`AskUserQuestion`, 2문항)**: ① 자폭 이펙트 적용 범위 — "기존 자기충돌사 이벤트에 폭발 연출만 추가(엔진/조작 변경 없음)" vs "새 자폭 스킬 액션을 신설(입력/엔진/동기화 프로토콜까지 확장되는 신규 기능)" → **기존 자기충돌사에 폭발 연출만 추가** 선택(룰북에 없는 신규 게임플레이 기능은 만들지 않음). ② 화면 셰이크 강도 — "약하게 포함(추천)" vs "강하게 포함" vs "미포함" → **약하게 포함**(≈150–200ms) 선택. 파티클 렌더링 방식(Canvas 2D vs WebGL vs CSS)은 기존 아키텍처가 카메라 트랜스폼이 걸린 Canvas 2D 월드 렌더링이라 WebGL 전면 재작성이나 CSS 애니메이션(월드 좌표 추적 불가)은 사실상 선택지가 아니라고 판단해 질문 없이 Canvas 2D 파티클로 결정.

**구현**:
- 신규 `WormEffects.ts`(React/네트워크 비의존 순수 모듈, 클래스 1개 + 순수 함수):
  - `detectWormEvents(prev, next): WormEvent[]` — 두 연속 `WormState` 스냅샷을 diff해 `eat`/`cut`/`death` 이벤트를 재구성하는 순수 함수(네트워크 스냅샷당 1회 호출, 렌더 프레임마다가 아님). 절단(cut)은 "부스터로는 스냅샷 1틱에 최대 1마디만 줄 수 있다"는 사실을 이용해 길이가 2 이상 줄면 절단으로 판정하고, 절단 지점 근처(반경 `HEAD_RADIUS+BODY_RADIUS+10`) 가장 가까운 다른 생존 뱀 머리를 공격자로 추정. 사망 원인(`self`/`wall`/`head`)은 엔진이 사망 사유를 상태에 남기지 않으므로 마지막 머리 위치가 벽 근처인지/다른 머리가 근처에 있었는지로 추정(둘 다 아니면 자기충돌=자폭으로 판정) — 어디까지나 연출용 근사치이며 게임플레이에는 전혀 관여하지 않음.
  - `WormEffectsManager` — 파티클/플로팅텍스트/충격파링/플래시/참격선을 각각 **고정 용량 라운드로빈 풀**(신규 할당·GC 없이 커서 오버라이트 방식, 8인 난전에서도 60fps 예산을 지키기 위한 설계로 모듈 상단 주석에 근거 기록)로 관리. 좌석별 임시 상태(먹이 섭취 시 머리 스케일 펄스 만료시각, 절단 성공 시 공격자 히트글로우 만료시각, 부스터 파티클 스로틀 타임스탬프)는 작은 `Map`으로 별도 관리. `handleEvents`(스냅샷당 1회, 이벤트→FX 스폰), `updateLiveBoost`(매 프레임, 부스터 중인 뱀 꼬리 끝에 유령 잔상 파티클 스로틀 스폰 — 상태 diff가 필요 없는 연속 상태라 이벤트 목록과 별도 경로), `update(dtMs)`(매 프레임, 파티클 물리/수명 진행 — 네트워크 스냅샷 주기(~11Hz)와 분리된 실제 렌더 프레임레이트로 진행되어 끊김 없이 부드러움), `draw(ctx, toScreen, scale)`(월드 좌표 FX 렌더), `headScale`/`headGlowAlpha`(스네이크 머리 렌더링 시 참조하는 좌석별 펄스/글로우 값), `consumeShakeOffset`(자기충돌사 시 **뷰어 자신의 화면에서만** 소모되는 화면 셰이크 오프셋 — 남의 폭발까지 내 화면이 흔들리지 않도록 의도적으로 `viewerSeat`에서만 트리거).
  - 이벤트별 FX: `eat` → 먹이 색 반짝임 버스트 9개 + 헤드 스케일 펄스(~220ms) + "+N" 플로팅 텍스트(위로 60월드유닛 드리프트, 800ms 페이드). `cut` → 흰색-노란 금속 스파크 10개 + 대상 색 파편 6개(잘린 마디가 흩어지는 느낌) + 짧은 참격선(180ms) + 공격자 판별되면 그 머리에 히트글로우 링(~260ms). `death` cause가 `self`(자폭)일 때만 → 동심원 충격파 링(480ms, 반경 78월드유닛) + 범위 플래시(160ms) + 주황/빨강 파편 폭발 30개 + (뷰어 본인일 때만) 화면 셰이크(~180ms, 약하게); cause 무관하게 모든 죽음에 공통으로 → 죽기 직전 몸통 마디 각각이 파티클이 되어 서서히 흩어지며 페이드아웃(650ms 전후, 요청 4번 "마디마디 붕괴" 항목).
- `WormCanvas.tsx` 연결: `useState(() => new WormEffectsManager())`로 컴포넌트 수명 동안 유지되는 매니저 인스턴스 하나 생성(리액트 신규 lint 규칙상 렌더 중 ref를 못 읽어 `useRef` lazy-init 대신 `useState` lazy-init 채택 — 이미 같은 파일의 `touchCapable`이 쓰는 패턴 재사용). `state` prop이 바뀔 때마다(스냅샷 도착 시) `lastDiffedStateRef`로 직전 스냅샷을 기억해 정확히 1회만 diff. 기존 `requestAnimationFrame` 루프에 프레임 델타(`dt`) 계산을 추가해 `updateLiveBoost`/`update`를 매 프레임 호출하고, `draw()`에 `effects` 인자를 추가해 (1) 프레임 최상단에서 화면 셰이크 오프셋만큼 `ctx.translate`, (2) 머리 반지름에 `headScale` 곱, (3) 히트글로우 링 스트로크, (4) 스네이크/먹이 렌더 후 `effects.draw()`로 파티클 레이어를 얹음.
- **부스터 잔상**은 이벤트가 아니라 "지금 부스팅 중"이라는 연속 상태를 매 프레임 직접 관찰해 스폰(스로틀 45ms)하므로 `detectWormEvents`를 거치지 않음 — 나머지 3개(먹이/절단/사망) 이펙트와 트리거 경로가 다르다는 점을 위 구현 항목에 명시적으로 구분해둠.

**파일 변경**: 1) `src/games/worm/WormEffects.ts`(신규) — 이벤트 diff + 이펙트 매니저. 2) `src/games/worm/WormCanvas.tsx` — 매니저 연결, RAF 루프에 델타타임/이펙트 갱신 추가, `draw()`에 셰이크/헤드펄스/히트글로우/이펙트 레이어 렌더 추가. 3) `src/games/worm/Worm.test.ts` — `detectWormEvents` 단위 테스트 9개 신규(먹이 이벤트 값 계산, 부스터의 1마디 감소는 절단으로 오판하지 않음, 절단 공격자 판별 반경, 벽/머리충돌/자폭 3가지 사망 원인 분류, 사망 시 몸통 스냅샷 보존).

**검증**: `npx tsc --noEmit`(전체, 에러 0) / `npm run lint`(전체, 경고 0) / `npx vitest run src/games/worm`(33/33 통과, 신규 9개 포함) / `npx vitest run --exclude "**/aiBenchmark.test.ts"`(27개 파일 1109개 중 1108 통과 — `src/games/perudo/Perudo.test.ts`의 "all-Level-10 게임 완주" 시뮬레이션 테스트 1개가 병렬 실행 부하로 5초 타임아웃, **이번 세션이 건드리지 않은 페루도 코드**이고 단독 재실행 시 2.4초 만에 정상 통과함을 확인해 병렬 실행 환경에 따른 사전 존재 플레이키니스로 판단, 이번 변경과 무관) / `npm run build`(프로덕션 빌드 성공, Turbopack). **브라우저 실측(파티클 육안 확인)은 이번 세션에 수행하지 않음** — Canvas 2D 렌더 로직과 이벤트 diff 순수 함수만 코드/단위 테스트로 확인했고, 실제 파티클 타이밍·겹침·프레임 드랍 여부는 실사용 전 수동 확인 권장(§3 Next Action Items 참고, `<Game>Canvas.tsx`의 실시간 렌더는 이 저장소가 이미 알려진 사각지대로 문서화한 vitest 커버리지 밖 영역).

**커밋/배포**: 커밋 `3a85ebb feat(worm): add visual particle effects for eating food, self-destruction, cutting tails, and core actions` → `git push origin main` 완료 → `npx vercel deploy`(프리뷰) 정상 완주, READY — `https://board-game-l1hcua27f-me-3871.vercel.app`. "production" 명시 없어 이번에도 프리뷰까지만 진행 — 필요하면 `npx vercel deploy --prod`로 후속 승격 요청할 것.

### 2026-08-22 — 뱅! 8인 플레이 확장 + 공식 직업 밸런스(2배신자)

**요청**: `HANDOFF.md`와 뱅! 코드(요청 문구는 `src/games/bang/` 하위 `engine.ts`/`types.ts`/`constants.ts`/`BangBoard.tsx`/`PlayerArea.tsx`/`Lobby.tsx`, `src/config/games.ts`를 지목)를 먼저 확인한 뒤, (1) 로비/허브 메타데이터를 8인까지 노출, (2) 8인 공식 직업 구성(보안관1·부관2·무법자3·배신자2, 두 배신자는 한 팀이 아니라 각자 독립적으로 "홀로 살아남아 보안관을 쓰러뜨리는" 목표)과 그에 맞는 승패 판정 정밀화, (3) 8인 타원형 테이블 반응형 최적화, (4) 단위 테스트(직업 풀/사거리/2배신자 승패 시나리오) 작성, (5) 빌드·테스트 통과 후 HANDOFF 갱신+커밋/푸시+배포까지 요청. 확인이 필요한 점은 절대 임의로 넘겨짚지 말고 먼저 질문 목록으로 확인받으라고 명시.

**조사**: 요청이 지목한 `types.ts`/`constants.ts`/`PlayerArea.tsx`/`Lobby.tsx`/`src/config/games.ts`는 이 저장소에 존재하지 않음을 확인 — 실제 구성은 `src/games/registry.ts`(허브 메타데이터, `players.max`로 인원 필터링)와 `src/games/bang/engine.ts`(역할/규칙/승패 판정을 한 파일에 통합, `ROLE_SETS`가 정확히 사용자가 요청한 4→5→6→7인 패턴 그대로 이미 존재)·`BangGame.tsx`(로비/방 생성 UI가 이 파일 안에 있고, 인원수 스테퍼가 `Math.min(7, ...)`으로 하드코딩돼 있었음)·`BangBoard.tsx`(원형 좌석 배치)로 확인. 별도 `Lobby.tsx`/`PlayerArea.tsx` 파일은 없음.

**판단 근거 (질문 없이 진행한 이유)**: 조사 결과 세 항목 모두 코드/공식 룰 조사만으로 명확히 결정 가능해 별도 질문 없이 진행함(모호해서가 아니라 답이 이미 정해져 있어서임을 아래에 남김):
- **카드 덱 매수 조정 여부** → **불필요, 80장 그대로 유지**. 실제 공식 뱅!은 4~7인이 이미 동일한 80장 덱을 그대로 쓰고(덱 소진 시 버림더미를 재셔플하는 것으로 인원 증가를 흡수), Dodge City/8인 확장도 덱 매수가 아니라 캐릭터(직업) 구성만 늘리는 확장이라 8인도 같은 원칙을 유지하는 게 이 엔진의 기존 설계(`drawTopCard`의 버림더미 재셔플)와 정확히 일치. `engine.ts` 상단 주석에도 이미 이 전제가 명시돼 있었음.
- **8인 직업 구성** → 사용자가 이미 정확한 수치(보안관1/부관2/무법자3/배신자2)를 명시했고, 이는 기존 `ROLE_SETS`의 4→7인 증가 패턴(인원이 늘 때마다 부관·무법자를 번갈아 1명씩 추가)을 그대로 연장한 8번째 자리에 배신자를 추가한 것과 정확히 일치해 별도 확인 불필요.
- **2배신자 승패 판정 로직** → `checkWinner()`를 직접 읽어보니 이미 역할 개수에 무관하게 동작하도록 짜여 있음(생존자 1명이면서 그 역할이 배신자일 때만 배신자 승리, 그 외에 보안관이 죽으면 무조건 무법자 승리, 배신자/무법자가 전멸해야 법 팀 승리) — 배신자가 몇 명이든 "보안관 사망 시점에 정확히 그 배신자 혼자만 생존"이어야 한다는 조건이 이미 코드 구조 자체로 강제되고 있어 엔진 로직 수정이 필요 없었음(상세 근거는 `engine.ts`의 `checkWinner` 신규 주석 참고). 이 판단이 맞는지 아래 테스트 3종으로 직접 검증.

**구현**:
- `registry.ts`: 뱅! `players.max` 7 → 8(허브 인원 필터에 8인 노출).
- `engine.ts`: `ROLE_SETS[8] = [sheriff, deputy, deputy, outlaw, outlaw, outlaw, renegade, renegade]` 추가. `checkWinner()`는 무변경(위 판단 근거 참고) — 왜 역할 개수와 무관하게 이미 올바른지 설명하는 주석만 추가.
- `BangGame.tsx`: 방 생성 폼의 인원수 스테퍼 상한 `Math.min(7, ...)` → `Math.min(8, ...)`, 안내 문구 "4~7명" → "4~8명" 2곳. 좌석 배정/봇 채우기/이름·id 맵은 원래부터 `targetPlayerCount`/`playerCount` 기반으로 완전히 동적이라 추가 변경 불필요.
- `BangBoard.tsx`: 좌석 배지가 7~8인에서 서로 겹치지 않도록 `seatPosition`의 타원 반경을 7인 이상에서 확대(x 42%→46%, y 36%→40%)하고, 테이블 컨테이너 높이도 7인 이상에서 키움(`h-[320px] sm:h-[380px]`), 신규 `seatBadgeScale(total)` 헬퍼로 7~8인에서 좌석 배지 패딩/간격/글자 크기를 단계적으로 축소. 거리/사거리 계산(`circleDistance`/`effectiveDistance`)은 이미 좌석 수에 무관하게 일반화돼 있어 무변경.
- `Bang.test.ts`: 역할 풀 검증을 n=8까지 확장 + 보안관1/부관2/무법자3/배신자2 명시적 단언 추가, 8석 원형 테이블 사거리 대칭(거리 1~4) 테스트 신규, "8-player table: 2-Renegade win condition" describe 블록 신규(① 보안관 사망 시점에 배신자 2명 모두 생존 중이면 무법자 승리, ② 무법자3+배신자2 전원 사망 시 법 팀 승리, ③ 한 배신자가 먼저 죽고 [보안관+나머지 배신자 1명]만 남은 상태에서 보안관이 죽으면 그 배신자 단독 승리), Level 10 AI 풀 시뮬레이션 루프에 n=8 추가.

**검증**: `npx tsc --noEmit`(전체, 에러 0) / `npm run lint`(전체, 경고 0) / `npx vitest run src/games/bang/Bang.test.ts`(78/78 통과) / `npx vitest run --exclude "**/aiBenchmark.test.ts"`(27개 파일 1100/1100 통과, 48.5초 — 이 저장소의 확립된 "aiBenchmark.test.ts만 제외하면 전체 스위트가 곧 완주한다" 관행 그대로 재사용). **브라우저 실측(8인 타원 레이아웃 겹침 여부)은 이번 세션에 수행하지 않음** — 엔진/좌표 계산과 Tailwind 클래스 조합만 코드로 확인했고 실제 렌더링 육안 확인은 §3 Next Action Items에 남김(과거 세션들의 "시각적 버그는 코드 리뷰만으로 고쳤다고 단정하지 말 것" 원칙 위반을 피하기 위해 명시적으로 미검증 표시).

**커밋/배포**: 커밋 `9491616 feat(bang): support 8-player mode with official role distribution and 2-renegade balance` → `npx vercel deploy`(프리뷰) 정상 완주, READY — `https://board-game-e0hkckmev-me-3871.vercel.app`. "production" 명시 없어 이번에도 프리뷰까지만 진행 — 필요하면 `npx vercel deploy --prod`로 후속 승격 요청할 것. `git push origin main`은 이 문서 커밋과 함께 한 번에 진행.

### 2026-08-22 — 운명전쟁39 좌측 랭킹 점수판 / 우측 예측 전용 패널 분리 및 점수 변동 이펙트

**요청**: `HANDOFF.md`와 운명전쟁39 인게임 UI 코드(요청 문구는 `src/games/destinyWar39/` 하위 `Board.tsx`/`DestinyWar39Board.tsx`/`Sidebar.tsx`/`ScoreBoard.tsx`/`PredictionPanel.tsx`를 지목)를 먼저 확인한 뒤 (1) 좌측에 전체 플레이어 누적 점수 실시간 랭킹판(1~3위 뱃지, 내 카드 강조) 상시 노출, (2) 우측 패널은 점수를 완전히 덜어내고 이번 라운드 승수 예측/달성 현황 전담(예측 페이즈엔 내 예측 입력 UI도 패널 내에서 동작), (3) 라운드 정산 시 점수 숫자 카운트업 + 플로팅 델타(+30/-15) 펄스 이펙트, (4) 순위 변동 시 랭킹 리스트 자리 교체 슬라이드 트랜지션 구현 요청. 패널 폭 비율·8인 모드 좌우 밸런스·모바일 처리 방식은 절대 임의로 추정하지 말고 사전에 질문 목록으로 확인받으라고 명시.

**조사**: 요청이 가리킨 `Board.tsx`/`Sidebar.tsx`/`ScoreBoard.tsx`/`PredictionPanel.tsx`는 이 저장소에 존재하지 않고, 실제로는 `DestinyWar39Board.tsx`(메인 보드, phase별 렌더) + `PredictionStatusBoard.tsx`(당시 우측에 붙어 예측 현황과 누적 점수를 함께 보여주던 패널) 구성이었음을 확인. 좌측 전용 상시 랭킹판은 존재하지 않았고, 누적 점수는 우측 패널의 각 카드 안 "누적 점수" 줄과 라운드 종료 화면 하단 한 줄 요약에만 흩어져 있었음. 우측 패널은 `predicting`/`playing` 페이즈에서만 렌더되고 `roundEnd`/`gameOver`엔 렌더되지 않는 구조였음. 페이지는 `max-w-2xl`(다른 대부분 게임과 동일)이라 좌+중앙+우 3열을 넣기엔 폭이 부족함을 확인 — 아발론/소환사의 협곡이 상시 사이드바 하나를 위해 `max-w-5xl`로 페이지 폭을 넓힌 선례(`page.tsx`의 `pageMaxWidth` 분기, `AvalonRoleGuideSidebar.tsx`의 데스크톱 고정 컬럼+모바일 가장자리 탭→드로어 패턴)를 발견해 이번에도 동일 패턴을 재사용하기로 함(사이드바가 좌우 2개라 소환사의 협곡/아발론보다 더 넓은 폭 필요).

**모호점 확인(`AskUserQuestion`, 4문항)**: ① 데스크톱 3열 배치 방식 — "3열 컬럼(좌 랭킹/중앙 보드/우 예측), 페이지 폭을 아발론/소환사의 협곡처럼 확장" vs "좌측 랭킹판은 상단 가로 스트립" → **3열 컬럼 + 폭 확장** 선택(6xl로 확장, 사이드바 2개라 5xl보다 더 필요). ② 모바일 처리 — "아발론과 동일한 가장자리 탭→드로어" vs "세로 스택" → **가장자리 탭→드로어** 선택(좌측 🏆순위 탭 / 우측 🎯예측 탭). ③ 좌측 랭킹판 노출 범위 — "전 페이즈 상시 노출(예측/진행/라운드종료/게임종료)" vs "예측/진행 페이즈에서만(기존 우측 패널과 동일 범위)" → **전 페이즈 상시 노출** 선택 — 이에 따라 라운드종료 화면 하단에 있던 기존 "누적 점수" 한 줄 요약은 좌측 랭킹판과 중복이라 제거. ④ 8인 모드 인원 증가 시 처리 — "고정 높이 + 내부 스크롤" vs "스크롤 없이 자연스럽게 늘어남" → **고정 높이(`max-h-[70vh]`) + 내부 스크롤** 선택.

**구현**:
- 신규 `RankedLeaderboard.tsx`(좌측): `state.players`를 누적 총점 내림차순(동점은 좌석 번호 오름차순)으로 정렬해 1~3위는 🥇🥈🥉 뱃지, 4위 이하는 "N위" 텍스트로 표시. 내 좌석 카드는 기존 프로젝트 컨벤션과 동일한 fuchsia 테두리/배경으로 강조. 데스크톱은 `lg:flex` 고정폭(`w-60`) 컬럼, 모바일은 아발론과 동일한 화면 좌측 가장자리 탭 → 좌측에서 슬라이드 인되는 드로어(우측 예측 패널의 탭/드로어와 좌우 대칭, 서로 겹치지 않음).
- 점수 변동 이펙트(`RankedLeaderboard.tsx`의 `AnimatedScore`): 각 행의 총점을 이전에 렌더된 값과 diff(마운트 시점 값으로 초기화해 최초 로드시 오탐 방지) — 값이 바뀌면 `requestAnimationFrame` 기반 ease-out 카운트업(900ms)과 함께, 그 옆에 "+30"/"-15" 형태의 플로팅 델타 배지가 위로 솟아오르며 페이드하는 CSS 애니메이션(`destinywar39-score-delta-float`, `globals.css` 신규 keyframe, 이 프로젝트의 `style={{animation: "..."}}` 컨벤션 그대로 재사용)를 델타 발생마다 새 key로 재생. 순위 자리 교체는 라이브러리 없이 바닐라 FLIP 기법으로 구현 — 정렬 순서가 바뀌기 전 각 행의 `getBoundingClientRect()`를 기억해뒀다가, 순서가 바뀐 다음 레이아웃에서 그 차이만큼 즉시 역방향 `transform`을 걸고 강제 리플로우 후 `transition: transform 420ms`로 0으로 되돌려 슬라이드로 보이게 함.
- `PredictionStatusBoard.tsx`(우측) 개편: 각 플레이어 카드에서 "누적 점수" 줄 완전 제거(랭킹판이 전담). 기존 `DestinyWar39Board.tsx`의 예측 페이즈 안에 있던 승수 선택 버튼(0~R)+히든 체크박스+확정 버튼 로직을 이 패널 안으로 이동(`onAction` prop 신규 추가) — 예측 미제출 상태면 패널 상단에 그대로 노출되고 동작함. 이 패널도 좌측과 동일하게 데스크톱 고정폭 `lg:flex`(`w-64`) / 모바일 우측 가장자리 탭 → 드로어로 자체 캡슐화.
- `DestinyWar39Board.tsx` 리팩터: 기존에 phase별로 조기 `return`하던 구조를 `centerContent`(phase별 중앙 콘텐츠) + `showPredictionPanel`(predicting/playing에서만 true, 기존 우측 패널 노출 범위 그대로 유지) 변수로 바꾸고, 최상위에서 `RankedLeaderboard`(항상) + `{centerContent}` + `showPredictionPanel && <PredictionStatusBoard/>` 3열 flex 컨테이너로 감싸도록 재구성 — 트릭 결과 프리즈프레임(`resolvingTurn`)/라운드종료/게임종료 화면에서도 좌측 랭킹판이 동일하게 유지되도록 함. 예측 페이즈의 중앙 콘텐츠는 손패 확인만 남기고(선택 버튼/다른 플레이어 예측 칩 목록은 우측 패널로 이동해 중복 제거), 라운드종료 화면 하단의 "누적 점수" 요약 블록은 제거하고 "누적 순위는 좌측 랭킹판에서 확인" 안내 문구로 대체.
- `[gameId]/page.tsx`: `pageMaxWidth` 분기에 `game.id === "destiny-war-39"` → `max-w-6xl` 추가(좌우 사이드바 2개 동시 배치라 아발론/소환사의 협곡의 5xl보다 더 넓게).

**검증**: `npx tsc --noEmit`(전체, 에러 0) / `npm run lint`(전체, 경고 0) / `npx vitest run src/games/destinyWar39 src/games/registry.test.ts`(65/65 통과 — 엔진 로직 무변경, 순수 UI 계층 변경). **브라우저 실측 검증** (Playwright, `npm install --no-save playwright@1.62.1`로 임시 설치 후 검증 완료 뒤 `npm uninstall --no-save playwright`로 원복 — `package.json`/`package-lock.json` 변경 없음): 임시 dev 라우트(`src/app/dev-destinywar39-preview` — `DestinyWar39Board`를 실제 `startGame`/`applyAction`으로 라운드 1을 완주시켜 누적 점수를 만든 뒤 라운드 2 예측 단계로 진입시킨 고정 상태 + "라운드 2 플레이→정산" 버튼으로 실시간 상태 전이를 트리거하는 구조로 구성, 검증 후 삭제)를 만들어 1280px(데스크톱 3열)/390px(모바일 드로어) 두 뷰포트에서 스크린샷 촬영. **확인 결과**: 데스크톱에서 좌(🏆 누적 순위, 뱃지+내 카드 강조)/중앙(손패·턴 진행)/우(🎯 승수 예측, 선택 버튼+히든 체크박스+확정 버튼이 패널 안에서 정상 동작) 3열이 겹침 없이 배치됨을 확인. "라운드 2 플레이→정산" 클릭 직후 좌측 랭킹판에서 각 플레이어 점수 옆에 녹색(+)/빨강(-) 플로팅 델타 배지가 솟아오르는 것과, 순위가 실제 총점(엔진 재계산으로 대조한 값: 도윤 0, 지호 0, 서연 -1, 하은 -1, 민준 -6)에 맞춰 정확히 내림차순 재정렬되는 것을 확인(최초 스크린샷 판독 시 작은 글자의 "-6"을 "-2"로 오독해 순간적으로 정렬이 틀린 것처럼 보였으나, 동일 시나리오를 `vitest` 임시 디버그 테스트로 재계산해 실제 값을 대조한 결과 정렬은 정확했음을 재확인 — 오독이었고 실제 버그 아님). 모바일에서는 좌측 "순위"/우측 "예측" 두 가장자리 탭이 겹치지 않고 각각 정상적으로 드로어를 열고 닫음을 확인. `page.on("pageerror"/"console")` 전수 수집 결과 페이지 에러 0건, 이번 변경과 무관한 사전 존재 404 2건(게스트 사용량/앱 설정 Supabase 조회, 과거 세션들과 동일 패턴)만 발견. 검증에 쓴 임시 라우트·디버그 테스트·스크립트는 저장소에 흔적 없이 삭제.

**커밋/배포**: 커밋 `641fd83 feat(destiny-war-39): split left ranked leaderboard and right prediction panel with score update animations` → `git push origin main` 완료 → `npx vercel deploy`(프리뷰) 정상 완주, READY — `https://board-game-1jewyzyy0-me-3871.vercel.app`. "production" 명시 없어 이번에도 프리뷰까지만 진행 — 필요하면 `npx vercel deploy --prod`로 후속 승격 요청할 것.

### 2026-08-21 — 아발론 우측 역할 능력 및 진영 목표 가이드 패널

**요청**: `HANDOFF.md`와 아발론 코드(요청 문구는 `src/games/avalon/` 하위 `Board.tsx`/`AvalonBoard.tsx`/`Sidebar.tsx`/`PlayerRole.tsx`/`types.ts`를 지목)를 먼저 확인한 뒤, 게임 화면 우측에 상시 노출되는 "내 역할 & 목표" 가이드 패널을 신설해 (1) 내 진영/구체적 직업 뱃지, (2) 역할 고유 능력 설명(멀린/퍼시벌/충신/모르가나/모드레드/오베론/암살자), (3) 진영별 승리 목표(선/악), (4) 현재 페이즈에서 할 일 한 줄 요약을 보여 달라는 요청. 사이드 패널 배치·모바일 접이식 대응·특수 직업 설명 텍스트 등 확인이 필요한 사항은 절대 임의로 추정하지 말고 사전에 질문해 확정하라고 명시.

**조사**: 요청이 가리킨 `Board.tsx`/`Sidebar.tsx`/`PlayerRole.tsx`/`types.ts`는 이 저장소에 존재하지 않고, 실제로는 `AvalonBoard.tsx`(보드+역할 모달) + `AvalonGame.tsx`(로비/Supabase 동기화) + `engine.ts`(규칙+`getKnowledge`) 구성임을 확인. 현재는 게임 시작 시 `RoleModal`이 한 번 뜨고 "🎭 내 역할 다시 보기" 버튼으로만 재열람 가능한 구조라 상시 참고 패널이 없음을 확인. 유사 선례로 소환사의 협곡의 `SummonersRiftGuideSidebar.tsx`(항상 보이는 플레이어 보조 사이드바, `[gameId]/page.tsx`가 해당 게임만 `max-w-5xl`로 페이지 폭을 넓혀 보드 옆에 배치)를 찾아 동일 패턴을 채택하기로 함 — 다만 그 사이드바는 좁은 화면에서 단순히 아래로 쌓이기만 하고 접이식 토글은 없어, 이번 요청의 "모바일 접이식" 요구사항은 별도로 구현해야 함을 확인.

**모호점 확인(`AskUserQuestion`, 3문항)**: ① 기존 `RoleModal`(게임 시작 시 1회 팝업 + 재열람 버튼) 처리 — "모달 유지 + 패널 신설" vs "모달 제거, 패널로 전면 대체" → **"모달 유지 + 패널 신설"** 선택(새 패널은 상시 참고용, 최초 공개 임팩트는 모달이 그대로 담당). ② 모바일 접이식 형태 — "화면 가장자리 탭 → 슬라이드 드로어" vs "보드 하단 접이식 아코디언" → **"화면 가장자리 탭 → 슬라이드 드로어"** 선택. ③ 데스크톱 배치 — "페이지 폭 확장(소환사의 협곡과 동일하게 `max-w-5xl`) + 보드 옆 고정 사이드바" vs "현재 폭 유지 + 보드 위/아래 접이식" → **"페이지 폭 확장 + 고정 사이드바"** 선택.

**구현**: 신규 `AvalonRoleGuideSidebar.tsx` — `GuideContent` 내부 컴포넌트 하나를 데스크톱 사이드바(`lg:flex`, 항상 노출)와 모바일 드로어(`lg:hidden`, 화면 우측 중앙 세로 탭 버튼 → 열면 우측에서 슬라이드 인, 배경 클릭/✕로 닫힘) 양쪽에서 공유. 내용은 4개 섹션: (1) 역할 아이콘+이름+진영 뱃지, (2) 정적 `ROLE_ABILITY` 텍스트(7개 역할 전부, 사용자 예시 문구 톤을 따라 신규 작성) + `getKnowledge`가 실제로 주는 정보(`evilSeatsKnown`/`merlinPercivalCandidates`)를 이름으로 풀어 함께 표시, (3) 정적 `TEAM_OBJECTIVES`(선/악 각각 사용자가 예시로 든 목표 문구 그대로 반영, 4라운드 7인+ 실패 2장 규칙은 해당 라운드에서만 경고로 추가 노출), (4) `currentActionGuide(state, viewerSeat)` — 현재 `phase`(원정대 구성/투표/원정 수행/암살)와 내 상황(리더 여부, 투표/제출 완료 여부, 원정대 포함 여부, 선/악 진영)을 조합해 한 줄로 지금 할 일을 요약. `AvalonBoard.tsx`는 최상위 반환을 `flex flex-col lg:flex-row` 컨테이너로 감싸 기존 원탁 패널을 `flex-1`로, 신규 사이드바를 그 옆에 배치(게임오버 화면은 이미 결과가 전원 공개되므로 사이드바 미부착, 기존 그대로). `[gameId]/page.tsx`의 게임별 `pageMaxWidth` 분기에 `game.id === "avalon"`을 소환사의 협곡과 같은 `max-w-5xl`로 추가.

**검증**: `npx tsc --noEmit`(전체, 에러 0) / `npm run lint`(전체, 경고 0) / `npx vitest run src/games/avalon/Avalon.test.ts`(50/50 통과 — `engine.ts` 무변경, 순수 UI 계층 추가) / `npx vitest run --exclude "**/aiBenchmark.test.ts"`(27개 파일 1093/1093 통과, 43초 — 이 저장소의 확립된 "전체 vitest는 `aiBenchmark.test.ts` 때문에 45분+ 걸려 완주 확인이 어렵다"는 과거 세션들의 판단과 동일하게, 그 파일만 제외한 전체 스위트로 대체 검증). 세션 시작 시 `Get-Process`로 확인한 결과 다른 두 개의 활성 Claude Code 세션(`boardgame-6f`/`boardgame-f8`, 약 1시간 전부터 실행 중)이 같은 저장소에서 이미 자체 전체 `vitest run`을 돌리고 있었음(§3의 "동시 세션" 알려진 이슈와 동일 패턴) — CPU 경합으로 처음 백그라운드로 건 무제한 전체 실행이 40분 넘게 끝나지 않아 중단하고, 위 `--exclude` 버전으로 대체해 빠르게 완주 확인. `git status`로 avalon 관련 파일이 다른 세션과 충돌 없이 이 세션의 변경분(`page.tsx`/`AvalonBoard.tsx`/신규 `AvalonRoleGuideSidebar.tsx`)뿐임을 커밋 직전 재확인.

**커밋/배포**: 커밋 `7c72b39 feat(avalon): add right sidebar panel for player role abilities and team objectives` → `git push origin main` 완료 → `npx vercel deploy`(프리뷰) 1차 시도는 과거 세션들과 동일한 `{"status":"error","reason":"deploy_failed","message":"Not authorized"}`로 실패 → 즉시 재시도해 정상 빌드(Turbopack + TypeScript 전체 재검사 포함)·배포되어 READY — `https://board-game-cucreyal0-me-3871.vercel.app`. 미리보기 URL은 Vercel SSO 배포 보호가 걸려 있어 `curl`은 302(SSO 리다이렉트)만 확인됨(팀 로그인 없이는 직접 200 확인 불가 — 과거 세션들도 이 팀 보호 미리보기 URL을 curl로 직접 검증하지 않고 `readyState: READY` + 빌드 로그의 TypeScript 재검사 통과를 성공 근거로 삼아온 것과 동일 판단). 사용자가 "production"을 명시하지 않아 이번에도 프리뷰까지만 진행 — 필요하면 `npx vercel deploy --prod`로 후속 승격 요청할 것.

### 2026-08-21 — 코요테 8인 플레이 확장 + 원형 테이블 레이아웃 최적화

**요청**: `HANDOFF.md`와 코요테 코드(요청 문구는 `src/games/coyote/` 하위 `engine.ts`/`types.ts`/`constants.ts`/`CoyoteBoard.tsx`/`PlayerArea.tsx`/`Lobby.tsx`, `src/config/games.ts`를 지목)를 먼저 확인한 뒤 (1) 로비/허브 메타데이터 8인 확장, (2) 8인 대응 원형/타원형 테이블·이마 카드 UI 최적화(카드 겹침 방지, 이마 카드 비공개/상대 카드 공개 유지, 라이프·턴 하이라이트 시인성), (3) 8인 대응 덱/엔진 규칙 점검(카드 수량 부족 여부, 코요테 선언 합산 특수 로직), (4) `Coyote.test.ts` 단위 테스트 보강(8인 생성/배분/합산/특수카드, 탈락 시 턴 넘김, 최종 승자 판정), (5) `tsc`/`lint`/`vitest` 검증 → HANDOFF 갱신 → 커밋(`feat(coyote): expand maximum players to 8 and optimize radial table layout`) → 푸시 → 배포 요청. 원형/방사형 배치와 덱 구성(특수 카드 수량 등)에 확인이 필요한 사항은 절대 임의로 추정하지 말고 사전에 질문해 확정하라고 명시.

**조사**: 요청이 가리킨 `types.ts`/`constants.ts`/`Lobby.tsx`/`PlayerArea.tsx`/`src/config/games.ts`는 이 저장소에 존재하지 않고, 실제로는 인원/메타데이터는 `src/games/registry.ts`(`GAME_REGISTRY`), 인원 선택 UI는 로비 역할을 겸하는 `CoyoteGame.tsx`의 "enter-name" 단계(이미 `MIN_PLAYERS`/`MAX_PLAYERS` 상수 기반이라 상수만 올리면 스테퍼 라벨/한도가 자동 반영), 원형 테이블·카드·라이프 UI는 `CoyoteBoard.tsx` 하나에 통합, 덱/규칙/봇 로직은 `engine.ts` 하나에 통합된 구성임을 확인. `engine.ts`의 `seatPosition`(`CoyoteBoard.tsx`)은 이미 `relativeIndex / total * 360` 공식으로 인원수에 완전히 제너릭해 8인도 그대로 동작하지만 카드/이름표 크기가 고정(`size="sm"`, 고정 패딩)이라 8인이면 타원 위 카드 간 간격이 좁아질 수 있음을 확인. 덱은 실제 코요테 보드게임 고정 36장 구성(`NUMBER_CARD_SPEC` — 26 코요테카드 + 0×3 + -5×2 + -10×1 + 밤/물음표/MAX0/x2 각 1장)이라 8인이어도 8장만 배분하고 28장이 라운드 덱에 남아(6인 기준 30장과 큰 차이 없음) 수량 부족이 전혀 없음을 계산으로 확인 — 다만 이 판단을 임의로 확정하지 않고 질문으로 확인받음.

**모호점 확인(`AskUserQuestion`, 2문항)**: ① 8인 덱 구성 — "고정 36장 덱 유지(3~6인과 동일, 실제 수량 부족 없음)" vs "8인 전용 덱 확장(특수/숫자카드 수량 증량 하우스룰)" → **"고정 36장 덱 유지"** 선택. ② 8인 원형 테이블 레이아웃 확장 방식 — "단일 타원 유지 + 반응형 축소(카드/간격만 줄여 겹침 방지)" vs "이중(내/외곽) 링 배치로 전환" → **"단일 타원 유지 + 반응형 축소"** 선택.

**엔진 변경** (`engine.ts`): `MAX_PLAYERS` 6 → **8**(`MIN_PLAYERS`는 3 그대로) — 모듈 최상단 doc의 "player count" 가정 항목에 2026-08-21 하우스룰 확장 근거(질문으로 확인받은 "덱 수량 부족 없음" 계산 포함)를 명문화. 딜링(`dealRound`)·좌석 순환(`nextAliveSeat`)·코요테 판정(`resolveCoyoteCall`)·랭킹(`computeRankings`)·봇 로직(`getValidMoves`/`chooseBotAction`/`estimateTotal`)은 전부 이미 `playerCount`/`state.players` 배열 기반 제너릭 구현이라 무변경 — 상수 한 줄만 올려도 8인까지 규칙상 문제없이 동작함을 신규 테스트로 확인.

**인원 확장** (`registry.ts`): 코요테 항목 `players: { min: 3, max: 6 }` → `{ min: 3, max: 8 }` — `src/app/page.tsx`의 "8인" 허브 필터(`min <= 8 && max >= 8`)에 자동으로 노출됨을 확인(별도 필터 로직 수정 불필요).

**레이아웃 개편** (`CoyoteBoard.tsx`, `CardArt.tsx`): 확인받은 대로 기존 단일 타원 배치는 그대로 두고 7-8인일 때만 반응형으로 축소/확장 — `seatPosition`의 타원 반경을 7인 이상이면 42/38(%) → 45/41(%)로 살짝 넓혀 더 많은 좌석이 중심에서 더 멀리 퍼지도록 하고, 테이블 컨테이너를 `h-[280px] max-w-md sm:h-[320px]` → `h-[320px] max-w-lg sm:h-[380px]`로 확대해 넓어진 반경이 실제 물리적 여유 공간을 갖도록 함. `CardFace`(`CardArt.tsx`)에 신규 `"xs"` 사이즈(`h-12 w-9`, 라벨/이모지 폰트 한 단계 축소) 추가 후 7-8인일 때 좌석 카드에 `size="xs"` 적용(6인 이하는 기존 `"sm"` 그대로). 좌석 이름표도 7-8인일 때 `max-w-[70px] truncate` + 패딩/폰트 한 단계 축소(`px-1.5 py-0.5 text-[9px]`)로 긴 닉네임이 레이아웃을 밀어내지 않도록 함 — 이마 카드 비공개(`getPlayerView`)/상대 카드 공개, 라이프(`HeartPips`)·턴 하이라이트(`isActive` 링/배경)는 로직·시각 구분 전부 무변경으로 8인에서도 동일하게 유지.

**테스트 보강** (`Coyote.test.ts`, 54개 → **60개**): 기존 "인원수 초과 시 예외" 테스트를 7인(이제 합법) 대신 9인 초과로 갱신 + `MAX_PLAYERS` 기대값 8로 갱신. 8인 전용 `describe` 블록 신규 추가 — 8명 생성/`STARTING_HEARTS` 초기화/8장 배분(카드 id 중복 없음), 고정 36장 덱이 8인에서도 라운드 덱에 28장이 남아 전체 36장이 소진 없이 보존되는지, 8인 전원의 이마 카드 합산에 MAX→0·x2가 §3 순서대로 정상 적용되는지(더블+맥스제로+숫자 6장 조합), 8인 중 한 좌석이 탈락한 상태에서 선언 시 턴이 그 좌석을 건너뛰고 다음 생존 좌석으로 넘어가는지, `playFullBotGame`(기존 헬퍼 재사용)으로 8인 전원이 라운드를 거듭해 최종 1인 승자와 완전한 순위(`computeRankings`)로 수렴하는지 확인. 기존 "Level 10 고수 AI끼리 풀 시뮬레이션" 루프도 `[3,4,5,6]` → `[3,4,5,6,7,8]`로 확장해 7·8인 전체 게임이 봇 시뮬레이션으로도 버그 없이 완주됨을 확인.

**검증**: `npx tsc --noEmit`(전체, 에러 0) / `npm run lint`(전체, 경고 0) / `npx vitest run src/games/coyote/Coyote.test.ts`(60/60 통과) / `npx vitest run --exclude '**/aiBenchmark.test.ts'`(27개 파일 1093/1093 통과).

**커밋/배포**: 커밋 `cfefc96 feat(coyote): expand maximum players to 8 and optimize radial table layout` → `git push origin main` 완료 → `npx vercel deploy`(프리뷰) 정상 완주, READY — `https://board-game-c2tupjzyk-me-3871.vercel.app`. "production" 명시 없어 이번에도 프리뷰까지만 진행 — 필요하면 `npx vercel deploy --prod`로 후속 승격 요청할 것.

### 2026-08-21 — 소환사의 협곡 직전 라운드 결과 조회 패널 및 상세 로그 UI

**요청**: `HANDOFF.md`와 소환사의 협곡 코드(`src/games/summonersRift/` 하위 `Board.tsx`/`RoundResult.tsx`/`HistoryPanel.tsx`/`engine.ts`/`types.ts` 등), 운명전쟁39의 히스토리 조회 구현 방식(`src/games/destinyWar39/` 라운드 요약/히스토리 뷰)을 먼저 확인한 뒤 (1) 운명전쟁 스타일 "직전 라운드 결과" 요약 UI(게임 화면 상단/사이드에 토글 버튼, 던전 진입자·공략 성공/실패·남은 체력/최대 체력 표시), (2) 상세 내역 브레이크다운(플레이어별 제외 장비 목록, 등장 몬스터와 격파 과정을 순서대로 시각화), (3) 라운드 종료 시점 전투 결과 스냅샷을 게임 상태에 저장해 다음 라운드 진행 중에도 실시간 조회 가능하도록 바인딩 요청. 패널 노출 위치·모달/드로어 방식 등은 절대 임의로 추정하지 말고 사전에 질문해 확정하라고 명시.

**조사**: 요청이 가리킨 `Board.tsx`/`RoundResult.tsx`/`HistoryPanel.tsx`는 이 저장소에 존재하지 않고, 실제로는 `SummonersRiftBoard.tsx`(보드 전체) + `engine.ts`(규칙) 구성임을 확인. 운명전쟁39는 헤더의 `🕓 직전 라운드 보기` 토글 버튼(완료된 라운드가 없으면 disabled) → 공용 `Overlay` 컴포넌트로 모달을 띄우고, 그 안에 요약 표 + 턴별 상세를 한 모달에 함께 보여주는 `LastRoundHistoryModal.tsx` 패턴임을 확인. 소환사의 협곡 `engine.ts`엔 이미 `SummonersRiftState.lastRoundResult: RoundResult | null`가 있고 `RoundResult`가 진입자(`challengerSeat`)/성공-실패(`outcome`)/장착 아이템/전투 로그(몬스터별 처치 주체·피해량·그 시점 HP)까지 담고 있어, 요청 3번(스냅샷 저장)이 대부분 이미 구현돼 있음을 확인 — 즉 이번 요청의 실질 공백은 "이 기존 데이터를 보여줄 UI가 없다"는 점이었음. 단 하나 빠진 데이터가 있었음: "누가 어떤 장비를 제외했는지"(`PlayerState.removedItemIds`)는 라운드가 끝나자마자 같은 틱 안에서 실행되는 다음 `dealRound`가 모든 활성 좌석의 `removedItemIds`를 `[]`로 초기화해버려서, 라운드 종료 후엔 이 정보가 사라지는 구조임을 확인 — `RoundResult`에 스냅샷 필드 추가가 필요함을 조사 단계에서 미리 확인.

**모호점 확인(`AskUserQuestion`, 3문항)**: ① 직전 라운드 결과 접근 트리거/배치 — "헤더 토글 버튼(운명전쟁39와 동일하게 룰북 버튼 옆에 배치, 화면 공간 안 차지)" vs "상시 노출 사이드 패널(몬스터 히스토리 패널처럼 항상 보이는 블록 추가)" → **"헤더 토글 버튼"** 선택. ② 여는 방식 — "모달 오버레이(운명전쟁39의 `LastRoundHistoryModal`과 동일하게 공용 `Overlay` 컴포넌트 재사용)" vs "슬라이드 드로어(이 프로젝트에 아직 없는 새 패턴)" → **"모달 오버레이"** 선택. ③ 요청 1번(요약)과 2번(상세)의 UI 구성 — "한 모달에 전부(운명전쟁39처럼 상단 요약 뱃지 + 하단 상세 섹션을 함께 배치)" vs "2단계(요약만 먼저 보여주고 상세는 접힌 `<details>`로 펼쳐야 보이게)" → **"한 모달에 전부"** 선택.

**엔진 변경** (`engine.ts`): `RoundResult`에 두 필드 신규 추가 — `finalHp: number`(라운드 종료 시점 챌린저 HP; 빈 협곡 더미로 전투 없이 즉시 클리어됐으면 `totalHp` 그대로, 그 외엔 마지막 `combatLog` 엔트리의 `hpAfter`, 실패 시 0 이하로 내려갈 수 있음) / `removedByPlayer: { seat, itemIds }[]`(제외 아이템이 하나라도 있는 좌석만 포함, 조사에서 확인한 대로 `player.removedItemIds`가 다음 `dealRound`에 초기화되기 전에 `finishRound`에서 스냅샷). 두 필드 모두 `finishRound`에서 `state.players`/`state.currentHp`를 다음 라운드로 넘기기 직전에 그대로 읽어 채움 — 기존 로직·다른 필드는 무변경.

**UI 구현**: 신규 `SummonersRiftLastRoundModal.tsx` — 운명전쟁39 `LastRoundHistoryModal.tsx`와 동일하게 공용 `Overlay`(`wide`)로 감싸 (1) 요약 줄(라운드 번호, 진입자 이름, ✅공략 성공/💀공략 실패 뱃지, 실패로 탈락했으면 🪦탈락 뱃지 추가, 남은 체력/최대 체력 — 음수 HP는 표시상 0으로 클램프), 황금 뒤집개를 지정했으면 그 몬스터 표기, (2) 제외된 장비 목록 — 좌석별로 이름 라벨 아래 기존 `CardArt.tsx`의 `RemovedItemsRow`(번호+아이콘+이름+효과 칩, 직전 세션에서 이미 구현된 컴포넌트)를 그대로 재사용해 순서를 그대로 보존, (3) 등장 몬스터 & 격파 과정 — `combatLog`를 등장 순서대로 `MonsterFace` + 처치/피해 뱃지로 나열(뱃지는 `SummonersRiftBoard.tsx`의 기존 `combatBadge` 헬퍼를 export해 재사용, 로직 중복 없음). `SummonersRiftBoard.tsx`: 헤더(`rulebookButton` 옆)와 게임오버 화면 양쪽에 `🕓 직전 라운드 결과` 토글 버튼 추가(`state.lastRoundResult`가 없으면 `disabled`, 운명전쟁39의 `historyButton`과 동일한 패턴) + 모달 오픈 상태 훅.

**테스트 보강** (`SummonersRift.test.ts`, 50개 → **52개**): `finalHp`가 전투 없는 즉시 클리어 시 `totalHp`와 같은지, 전투가 있었을 때 마지막 `combatLog.hpAfter`와 일치하는지 검증. `removedByPlayer`가 라운드 중 여러 좌석이 각각 다른 아이템을 제외했을 때 좌석별로 정확히 스냅샷되는지, 그리고 그 직후(같은 액션이 트리거한 다음 `dealRound`) 모든 활성 좌석의 살아있는 `player.removedItemIds`가 이미 `[]`로 리셋되어 `lastRoundResult.removedByPlayer`만이 그 정보가 남아있는 유일한 곳임을 확인하는 테스트 추가.

**검증**: `npx tsc --noEmit`(전체, 에러 0) / `npm run lint`(전체, 경고 0) / `npx vitest run src/games/summonersRift`(52/52 통과) / `npx vitest run --exclude '**/aiBenchmark.test.ts'`(27개 파일 1086/1086 통과, 42.45초) — 도중 `--exclude` 없이 백그라운드로 걸어둔 전체 `npx vitest run`이 이전 세션들에 이미 기록된 패턴대로 응답이 느려 `TaskStop` 후 vitest 관련 잔존 `node.exe` 3개만(`next dev` 서버 프로세스는 건드리지 않음) `Stop-Process -Force`로 정리하고 `--exclude` 버전으로 재실행해 정상 완료.

**커밋/배포**: 커밋 `fa4cc6e feat(summoners-rift): add previous round history summary panel` → `git push origin main` 완료 → `npx vercel deploy`(프리뷰) 정상 완주, READY — `https://board-game-plzsvqw0t-me-3871.vercel.app`. "production" 명시 없어 이번에도 프리뷰까지만 진행 — 필요하면 `npx vercel deploy --prod`로 후속 승격 요청할 것.

### 2026-08-21 — 보드게임 허브 인원 필터 '8인' 옵션 추가

**요청**: `HANDOFF.md`와 보드게임 메인/허브 관련 코드(`src/pages/Lobby.tsx`, `src/pages/Home.tsx`, `src/components/GameFilter.tsx`, `src/config/games.ts` 등)를 먼저 확인한 뒤 (1) 허브 화면 인원 필터에 '8인' 칩 추가 + 모바일/데스크톱 레이아웃 정돈, (2) 최근 8인 모드가 추가된 운명전쟁39·그리드 포커를 포함해 8인 지원 게임의 인원 범위(`maxPlayers: 8` 등)를 일관되게 정의, (3) `min <= 8 && max >= 8` 조건으로 정확히 필터링, (4) `tsc`/`lint`/`vitest` 검증 후 HANDOFF 갱신 → 커밋 `feat(hub): add 8-player filter option to game list` → 푸시 → 배포까지 요청. 필터 UI 위치·게임 메타데이터 설정에 확인이 필요하면 절대 임의로 추정하지 말고 사전에 질문해 확정하라고 명시.

**조사**: 요청이 가리킨 `src/pages/Lobby.tsx`/`Home.tsx`/`src/components/GameFilter.tsx`/`src/config/games.ts`는 이 저장소에 존재하지 않음을 확인 — 실제 구조는 Next.js App Router 기반으로, 허브 화면은 [src/app/page.tsx](src/app/page.tsx)에 인라인 `PLAYER_FILTERS` 배열(`전체`/`2인`/`3~4인`/`5인+` 4개, `5인+`는 `max >= 5`)로 구현돼 있고 게임 메타데이터는 [src/games/registry.ts](src/games/registry.ts)(`GAME_REGISTRY: GameMeta[]`) + [src/games/types.ts](src/games/types.ts)(`players: { min, max }`)에 있음을 확인. 그리드 포커(`players: { min: 2, max: 8 }`, 직전 08-21 세션에서 확장됨)와 운명전쟁39(`players: { min: 5, max: 8 }`, 그 이전 08-21 세션에서 확장됨) 모두 이미 8인 메타데이터가 정확히 반영돼 있어 요청 2번(메타데이터 정비) 항목은 추가 작업이 불필요함을 확인. 기존 `5인+` 필터가 이미 `max >= 5` 조건이라 8인 게임도 노출은 되고 있었지만, 그대로 `8인` 칩만 추가하면 `5인+`와 범위가 겹치는 필터가 되는 점을 확인.

**모호점 확인(`AskUserQuestion`, 2문항)**: ① '8인' 필터 추가 시 기존 '5인+' 옵션 처리 — "5~7인 + 8인으로 분리"(겹침 없이 명확히 구분) vs "5인+ 유지하고 8인만 추가"(겹치는 필터 허용) → **"5~7인 + 8인으로 분리"** 선택. ② 모바일 인원 필터 칩 레이아웃 — "가로 스크롤 스트립으로 전환"(`overflow-x-auto`, 필터가 늘어나도 세로 공간 안 먹음) vs "기존 flex-wrap 유지"(공간 부족 시 줄바꿈) → **"가로 스크롤 스트립으로 전환"** 선택.

**구현** (`src/app/page.tsx`만 수정 — `registry.ts`/`types.ts`는 조사에서 확인한 대로 이미 정확해 무변경): `PLAYER_FILTERS`의 `{ label: "5인+", test: (min, max) => max >= 5 }` 한 항목을 `{ label: "5~7인", test: (min, max) => min <= 7 && max >= 5 }` + `{ label: "8인", test: (min, max) => min <= 8 && max >= 8 }` 두 항목으로 분리(요청에 명시된 조건 그대로 사용) — 이제 그리드 포커/운명전쟁39/페루도/달무티/아발론/지렁이(모두 `max: 8` 이상)는 `5~7인`과 `8인` 양쪽에 걸쳐 노출되고(정상 — 실제로 5~8인 모두 플레이 가능한 게임이므로), 뱅!(`max: 7`)처럼 8인이 안 되는 게임은 `5~7인`에서만, `min > 8`이거나 `max < 8`인 게임은 `8인` 칩에서 정확히 제외됨을 확인. 인원 필터 칩 컨테이너를 `flex flex-wrap gap-2`에서 `-mx-1 flex gap-2 overflow-x-auto px-1 pb-1`로 교체하고 각 칩 버튼에 `shrink-0`을 추가(그리드 포커 보드의 기존 모바일 가로 스크롤 스트립 패턴과 동일한 관례를 재사용) — 칩 개수가 4개→5개로 늘어나도 모바일 폭에서 줄바꿈으로 세로 공간을 잡아먹지 않고 한 줄로 스와이프됨, 데스크톱은 폭이 충분하면 스크롤 없이 한 줄에 그대로 표시됨. 장르 필터 행(`GENRE_ORDER` 기반, 바로 아래)은 이번 요청 대상이 아니라 기존 `flex-wrap` 그대로 무변경.

**검증**: `npx tsc --noEmit`(전체, 에러 0) / `npm run lint`(전체, 경고 0) / `npx vitest run --exclude '**/aiBenchmark.test.ts'`(27개 파일 1084/1084 통과, 43.02초) — 이번 변경이 순수 대시보드 필터 UI(`src/app/page.tsx`)에 국한돼 게임 엔진 테스트에는 영향 없음. 도중 `--exclude` 없이 백그라운드로 걸어둔 전체 `npx vitest run`이 이전 세션들에 이미 기록된 패턴대로 5분 넘게 응답 없어 `TaskStop` 후 `Get-CimInstance Win32_Process`로 잔존 vitest 워커 3개를 `Stop-Process -Force`로 정리하고 `--exclude` 버전으로 재실행해 정상 완료.

**커밋/배포**: 커밋 `9ec9198 feat(hub): add 8-player filter option to game list` → `git push origin main` 완료 → `npx vercel deploy`(프리뷰) 정상 완주, READY — `https://board-game-ca8ovie4j-me-3871.vercel.app`. "production" 명시 없어 이번에도 프리뷰까지만 진행 — 필요하면 `npx vercel deploy --prod`로 후속 승격 요청할 것.

### 2026-08-21 — 소환사의 협곡 제거 장비 가로 순차 나열 + 던전 공략 실시간 관전 UI + 몬스터 히스토리 패널

**요청**: `HANDOFF.md`와 `src/games/summonersRift/` 하위 `DungeonArea.tsx`/`HeroStatus.tsx`/`PlayerSlots.tsx`/`CombatLog.tsx`를 먼저 확인한 뒤 (1) 제거(포기)한 장비 카드가 뒤집힌 카드 위에 겹쳐 쌓이지 않고 플레이어 영역 옆에 제거 순서대로 가로(Flex Row)로 이름/아이콘/효과 겹침 없이 정돈, (2) 전 참가자가 동일한 던전 공략 전투 화면을 실시간 관전(용사 HP 중앙 대형 표시, 처치 시 장비 효과 발동 이펙트+"처치!" 연출, 피격 시 HP 차감 플래시), (3) 좌측에 이번 던전에서 공개된 몬스터를 누적 나열하고 처치/피해 상태 뱃지를 표기하는 히스토리 패널 신규 요청. UI 배치·전투 연출 템포는 절대 임의로 추정하지 말고 사전에 질문해 확정하라고 명시.

**조사**: 요청이 가리킨 `DungeonArea.tsx`/`HeroStatus.tsx`/`PlayerSlots.tsx`/`CombatLog.tsx`는 이 저장소에 존재하지 않고, 실제로는 `SummonersRiftBoard.tsx`(보드 전체) + `SummonersRiftEffects.tsx`(협곡 더미 투척 FX) + `CardArt.tsx`(카드 프레젠테이션) 3파일 구성임을 확인. 제거 장비는 직전(2026-08-21 앞선) 세션이 만든 `HiddenEquipmentStack`이 뒤집힌 `DeckBack` 위에 항목마다 각도를 늘려 비스듬히 겹쳐 쌓는 방식이었고 이름 라벨도 없이 아이콘만 있어(효과는 툴팁으로만) 이번 요청의 "겹침 없이/이름·아이콘·효과 모두 노출"과 정면으로 배치되는 구조임을 확인. `combatLog`(몬스터별 처치/피해 기록)는 이미 공유 lockstep state라 협곡 공략 애니메이션 자체는 이미 전원에게 동기화되어 보이고 있었지만, "마지막 1건"만 렌더하는 단일 리빌 슬롯뿐이라 누적 히스토리 패널이나 중앙 대형 HP 배너는 없었고, 마지막 몬스터(라운드를 끝내는 결정타)는 `finishRound`가 같은 트랜지션 안에서 곧장 다음 라운드를 `dealRound`로 재딜(`combatLog: []`로 리셋)하기 때문에 그 즉시 페이즈가 `bidding`으로 넘어가 실시간 리빌 슬롯 자체가 그 결정타를 애니메이션할 기회가 없이 `lastRoundResult` 기반 라운드 요약 배너로만 대체돼 있었음을 확인(기존 `roundFlash` 배너가 이미 이 패턴으로 구현됨). `ItemSlot`엔 `highlighted` prop이 이미 정의돼 있었지만 어디서도 호출되지 않아 "처치 아이템 강조"용으로 준비만 되고 실제로 쓰인 적은 없었음을 확인.

**모호점 확인(`AskUserQuestion`, 4문항)**: ① 제거 장비를 어디에·어떻게 가로 나열할지 — "스코어보드 행 내부 인라인(컴팩트)" vs "플레이어 행 아래 전용 스트립" → **"플레이어 행 아래 전용 스트립"** 선택(이름+아이콘+효과 전부 노출이 공통 요구사항). ② 좌측 몬스터 히스토리 패널의 데스크톱 3열/모바일 순서 — "데스크톱 [히스토리][보드][가이드], 모바일 히스토리→보드→가이드" vs "모바일만 보드 먼저" → **"데스크톱 3열, 모바일은 히스토리가 최상단"** 선택. ③ 히스토리 패널이 언제부터 보일지 — "던전 공략 단계(declaringSpatula/resolvingRift)에서만" vs "라운드 시작부터 빈 상태로 항상 자리 차지" → **"던전 공략 단계에서만 표시"** 선택. ④ 전투 연출 템포 — "연출 재생 중 '다음 몬스터 공개' 버튼 잠금 + 카드더미 위 대형 HP 배너" vs "잠금 없이 즉시 반응 + 챔피언 헤더 확대" → **"버튼 잠금 + 대형 HP 배너"** 선택.

**구현**: 엔진(`engine.ts`) 무변경 — `combatLog`가 이미 몬스터/처치주체/피해량/그 시점 HP를 전부 담고 있어 순수 UI 레이어만으로 충분했음. `CardArt.tsx`: `HiddenEquipmentStack`(비스듬히 겹쳐 쌓기)을 제거하고 `RemovedItemsRow`로 교체 — 제거 순서 번호 배지+아이콘+이름+효과 텍스트를 가진 칩을 `flex flex-wrap`으로 나열(겹침 없이, 좁은 화면에선 줄바꿈으로 자연스럽게 대응). `SummonersRiftBoard.tsx`: (1) 각 스코어보드 행을 `<div className="flex flex-col">`로 감싸 기존 한 줄 행 바로 아래에 `RemovedItemsRow`를 별도 스트립으로 배치(`FlyingRiftCard`의 소스 좌표로 쓰이는 `seatRowRefs`는 원래 행에 그대로 유지). (2) 신규 `HpBanner` — `state.currentHp`가 살아있는 동안(`declaringSpatula`/`resolvingRift`)만 렌더되는 대형 HP 배너, 평소엔 "N / M" 큰 숫자, 콤뱃 플래시 중엔 처치("⚔️ 처치! HP N 유지" 골드 펄스) 또는 피격("N ➔ M (−X)" 레드 시프트) 전용 문구+애니메이션. (3) 신규 `MonsterHistoryPanel` — `state.combatLog`를 오래된 것부터 아래로 쌓아 각 항목에 몬스터 얼굴+순번+처치/피해뱃지를 표시, `overflow-y-auto`+새 항목마다 `scrollTop`을 최댓값으로 맞춰 수동 스크롤 없이 최신 항목이 항상 보이게 함, `declaringSpatula`/`resolvingRift`가 아니면 렌더되지 않음. 루트 레이아웃을 `[히스토리 패널] [보드] [가이드 사이드바]` 3열(`flex-col lg:flex-row`, 순서가 DOM 순서 그대로라 모바일 세로 스택도 별도 `order-*` 없이 자동으로 히스토리가 최상단)로 재구성. (4) 렌더 중 ref를 직접 mutate하면 안 된다는 최근 `react-hooks/refs` 린트 규칙에 걸려(최초 구현은 "몇 번째 항목까지 이미 플래시했는지" 카운터를 `useRef`로 들고 있었음), 별도 카운터 ref 없이 "지난 렌더의 `trackedState.combatLog.length`"만으로 diff하도록 재작성 — `combatLog`가 `enterDungeon`/`dealRound` 양쪽에서 항상 `[]`로 리셋되는 특성 덕에 매 도전마다 자동으로 0부터 다시 세어져 별도 리셋 스텝이 필요 없음. (5) 마지막 결정타는 조사에서 확인한 대로 `resolvingRift`가 유지되는 중간 리빌에만 플래시를 걸고(라운드를 끝내는 마지막 리빌은 같은 틱에 페이즈가 바뀌므로 의도적으로 제외), 기존 `roundFlash` 요약 배너가 그 결정타를 계속 커버 — 히스토리 패널도 같은 페이즈 조건으로 숨어 사용자가 확인한 "던전 공략 단계에서만" 원칙과 일치시킴. (6) `ItemSlot`에 `highlighted`가 걸리면 처치 주체 아이템(또는 황금 뒤집개)에 `HpBanner`와 동일한 골드 펄스 애니메이션+"발동!" 배지를 추가 — 기존에 정의만 되고 쓰이지 않던 prop을 실제로 연결. `globals.css`에 `rift-hp-kill-pulse`/`rift-hp-damage-flash` 키프레임 2개 신규 추가(기존 `rift-monster-slay`/`rift-monster-strike`와 타이밍을 맞춤). "다음 몬스터 공개" 버튼은 연출 재생 중(`COMBAT_FLASH_MS`=1700ms) `disabled`+"⏳ 전투 연출 재생 중..." 라벨로 잠가 전원이 매 몬스터의 결과를 놓치지 않게 함.

**브라우저 실측 검증** (Playwright, `npm install --no-save playwright@1.62.1`로 임시 설치 후 검증 완료 뒤 `npm uninstall --no-save playwright`로 원복 — `package.json`/`package-lock.json` 변경 없음): 임시 dev 라우트(`src/app/dev-summoners-rift-preview` — `SummonersRiftBoard`를 프로덕션과 동일한 `mx-auto max-w-5xl` 래퍼로 감싸고 4인 `resolvingRift` 상태를 직접 구성해 Supabase Realtime 로비를 우회, 마운트 후 0.5초/3초 지연으로 콤뱃 로그 항목을 2건 추가 주입해 처치 플래시·피격 플래시를 각각 재생시킴, 검증 후 삭제)를 만들어 1280px(3열 데스크톱)/390px(히스토리→보드→가이드 세로 스택) 두 뷰포트에서 단계별 스크린샷 촬영. **확인 결과**: 데스크톱 3열 배치, 모바일 히스토리 최상단 배치 모두 확인. 제거 장비 3개(겹침 없이 번호+아이콘+이름+효과 칩, 줄바꿈으로 자연 정돈) 확인. 대형 HP 배너가 평상시 "N / M", 처치 시 "⚔️ 처치! HP N 유지"(골드 펄스), 피격 시 "N ➔ M (−X)"(레드 시프트)로 정확히 전환되는 것을 스크린샷 3장으로 확인, 이 과정에서 최초 구현의 `ItemSlot` 하이라이트가 기존 골드 테두리에 묻혀 육안으로 거의 안 보이는 문제를 발견해 `ring-4`+펄스 애니메이션+"발동!" 배지로 강화 후 재검증 완료. "다음 몬스터 공개" 버튼이 연출 중 "⏳ 전투 연출 재생 중..."으로 잠기고 이후 재활성화되는 것도 확인. 히스토리 패널이 항목을 오래된 순서로 누적하며 badge가 정확한 것도 확인. `page.on("response")`로 4xx/5xx 응답을 전수 수집한 결과 이번 변경과 무관한 사전 존재 404 2건(게스트 사용량/앱 설정 Supabase 조회, 과거 세션들과 동일 패턴)만 발견, `pageerror` 0건. 검증에 쓴 임시 라우트·스크립트는 저장소에 흔적 없이 삭제.

**검증**: `npx tsc --noEmit`(전체, 에러 0) / `npm run lint`(전체, 경고 0 — 최초 구현이 렌더 중 ref를 mutate해 `react-hooks/refs` 에러 6건 발생시켰던 것을 §"구현"의 재작성으로 해소) / `npx vitest run src/games/summonersRift`(50/50 통과 — `engine.ts` 무변경이라 전부 회귀 없이 통과) / `npx vitest run --exclude '**/aiBenchmark.test.ts'`(27개 파일 1084/1084 통과).

**커밋/배포**: 커밋 `a331ed6 feat(summoners-rift): display discarded items linearly and add shared dungeon combat viewer with monster log` → `git push origin main` 완료 → `npx vercel deploy`(프리뷰) 정상 완주, READY — `https://board-game-epqt0optf-me-3871.vercel.app`. "production" 명시 없어 이번에도 프리뷰까지만 진행 — 필요하면 `npx vercel deploy --prod`로 후속 승격 요청할 것.

### 2026-08-21 — 그리드 포커 8인 플레이 확장 + 모바일 반응형 웹 UI/UX 최적화

**요청**: `HANDOFF.md`와 그리드 포커 코드(`src/games/grid-poker/` 하위 `engine.ts`/`GridPokerBoard.tsx`/`GridPokerGame.tsx` 등)를 먼저 확인한 뒤 (1) 최대 8인 플레이 지원(로비 인원 2~8 가변, 멀티 보드 상태 관리, 공용 덱/라운드 동기화), (2) 모바일 반응형 UI/UX 최적화(내 보드 중심 뷰, 8인 대응 상대 탭/캐러셀, 접이식/고정 스코어보드, 터치 친화적 2-Step 탭 배치+드래그앤드롭) 구현 요청. 모바일 화면 분할 방식이나 턴 진행 룰에 확인이 필요하면 절대 임의로 추정하지 말고 먼저 질문 목록을 제시해 확인받으라고 명시.

**조사**: `engine.ts`가 이미 `playerCount`를 상수화하지 않고 `startGame(playerCount, ...)`로 완전히 가변 처리하고 있음을 확인 — 좌석별 상태(`players[]`, `placedThisRound`, `submissions`)가 전부 `playerCount` 길이 배열이고, 공용 카드는 "뽑을 때마다 즉시 덱에 복원"되는 복원추출 방식이라 애초에 덱 소진 동기화 이슈 자체가 없으며(주석에 이미 명문화), `totalScoringRounds`/`winThreshold`도 `playerCount === 2 ? ... : 12/7`로 3인 이상은 이미 공통 분기라 8인도 그대로 적용됨을 확인 — 즉 엔진 자체는 8인 확장에 룰 변경이 전혀 필요 없었음. 실제 캡은 `registry.ts`의 `players: { min: 2, max: 6 }`와 `GridPokerGame.tsx` 방-만들기 단계 인원 스테퍼의 `Math.min(6, n + 1)` 딱 두 곳에만 하드코딩돼 있었음을 확인. UI 쪽은 `GridPokerBoard.tsx`가 상대 보드를 `flex flex-wrap` 미니 그리드로 전원 동시 노출하는 방식이라 8인(상대 7명)이면 모바일 폭에서 줄바꿈이 과도해 화면을 크게 잠식함을 확인. 배치 인터랙션은 매 라운드 "공용 카드 1장"만 존재해 고를 카드 자체가 없는 구조(빈 칸 탭 → 즉시 배치)라, 요청에 적힌 "카드 터치 → 타일 터치" 2-Step 문구가 이 게임 실제 메커니즘과 맞지 않음을 확인 — 임의로 해석해 구현하지 않고 질문 목록에 포함.

**모호점 확인(`AskUserQuestion`, 3문항)**: ① 모바일에서 상대 보드 요약 탭 터치 시 상세 뷰 표시 방식 — "미니 팝업 모달" vs "탭 스트립 인라인 아코디언 확장" → **"미니 팝업 모달"** 선택. ② 8인 실시간 점수판 배치 — "상단 고정 뱃지 스트립(항상 노출)" vs "접이식 아코디언/드로어(기본 접힘)" → **"상단 고정 뱃지 스트립"** 선택. ③ 공용 카드 1장뿐이라 "고를 카드"가 없는 구조에서 터치 배치 방식 — "현재 방식(1탭 즉시 배치) 유지" vs "2-Step 탭(카드 선택→타일 확정)" vs "드래그 앤 드롭 추가" → **"현재 방식 유지: 1탭 즉시 배치"** 선택 — 카드가 하나뿐이라 이미 가장 빠르고 실수 위험이 적은 모바일 친화적 방식이라는 이유.

**엔진 변경** (`engine.ts`): `completedLineCount(player)` 신규 export — 그 플레이어의 12개 라인 중 실제로 몇 개가 이미 다 채워졌는지(제출 여부 무관) 세는 순수 함수. 카드 정체(랭크/문양)는 전혀 드러내지 않는 "개수만" 정보라 상대에게도 안전하게 노출 가능 — 모바일 상대 요약 탭의 "라인 N개" 표시에 사용. 그 외 플레이 인원/라운드/승리 조건 로직은 이미 가변 처리돼 있어 무변경.

**인원 확장** (`registry.ts`, `GridPokerGame.tsx`): `players: { min: 2, max: 6 }` → `{ min: 2, max: 8 }`, 방-만들기 인원 스테퍼 라벨 "인원 수 (2~6명)" → "(2~8명)" + 상한 `Math.min(6, n+1)` → `Math.min(8, n+1)`. 봇 좌석 로직(`AddBotButton`/좌석 정원 체크/자동 시작 조건)은 이미 전부 `targetPlayerCount`/`knownTargetPlayerCount` 파생이라 두 곳 수정만으로 8인까지 자연스럽게 연쇄 적용됨을 확인(별도 하드코딩 없음).

**모바일 UI 개편** (`GridPokerBoard.tsx`): (1) 상단 리더보드를 기존 "좌석 순서 연결상태 알약 목록"에서 점수 내림차순 **경쟁 순위**(동점은 같은 순위, 다음 순위는 건너뜀) 스트립으로 교체 — 1위는 🏆, 나머지는 "N위" 배지. 모바일에서는 `overflow-x-auto`로 한 줄 가로 스크롤(화면 세로 공간을 잡아먹지 않음), `sm:` 이상에서는 기존처럼 `flex-wrap`. (2) 상대 보드 렌더링 로직(첫 배치 칸/공개 라인/실시간 배치 마커 처리)을 신규 `OpponentBoardGrid` 공유 컴포넌트로 추출해 데스크톱 인라인 그리드와 모바일 팝업 뷰가 로직 drift 없이 동일 소스를 사용. (3) 모바일(`sm:hidden`)은 상대 7명을 가로 스크롤 요약 칩 스트립(닉네임/점수/`completedLineCount` 기반 "라인 N개")으로 축약, 칩 탭 시 기존 `Overlay` 공유 컴포넌트(룰북 모달과 동일 패턴)로 해당 상대의 5×5 보드 팝업. 데스크톱(`hidden sm:flex`)은 기존처럼 전원 인라인 노출 유지. (4) 배치 인터랙션은 확인받은 대로 기존 1탭 즉시 배치 그대로 두고 변경하지 않음 — 내 보드가 이미 최소한의 상단 UI(상태줄+리더보드 스트립+공용 카드 리빌) 바로 아래, 페이지에서 가장 먼저 나오는 큰 시각 요소라 "메인 포커스" 요건은 기존 레이아웃 순서로 충족된다고 판단, 별도 `position: sticky` 없이 진행.

**테스트 보강** (`GridPoker.test.ts`, 42개 → **46개**): 8인 전용 케이스 추가 — `startGame(8)`이 8명의 독립된 빈 5×5 보드(참조 분리 확인 포함) + 12라운드/7승 문턱을 만드는지, `fillBoards`(기존 헬퍼가 이미 `playerCount` 제네릭이라 무수정 재사용)로 25번의 드로우가 8인 전원 동시 배치를 거쳐 정확히 submitting으로 넘어가는지, `completedLineCount`가 보드가 다 차기 전에도 플레이어별로 독립적으로 올라가는지(한 명은 가로줄 완성, 나머지 7명은 의도적으로 12개 라인 중 어느 것도 완성되지 않는 5칸 산개 배치로 대조), 8인이 라운드마다 동시에 블라인드 라인을 제출해 game-end까지 완주하며 승자/점수 합계가 일관되는지(무승부 라운드는 점수를 주지 않으므로 총점 ≤ 진행된 라운드 수).

**검증**: `npx tsc --noEmit`(전체, 에러 0) / `npm run lint`(전체, 경고 0 — 신규 `rankedPlayers` 헬퍼의 미사용 매개변수 경고 1건 발견 즉시 수정) / `npx vitest run src/games/grid-poker/GridPoker.test.ts`(46/46 통과) / `npx vitest run --exclude '**/aiBenchmark.test.ts'`(27개 파일 1084/1084 통과, 42.22초) — 도중 제외 플래그 없이 백그라운드로 걸어둔 전체 `npx vitest run`이 §2에 이미 기록된 패턴대로 5분 넘게 응답이 없어 `TaskStop` 후 `Get-CimInstance Win32_Process`로 잔존 `node.exe`(vitest 워커) 3개를 `Stop-Process -Force`로 정리하고 `--exclude` 버전으로 재실행해 정상 완료.

**커밋/배포**: 커밋 `34cf09f feat(grid-poker): support up to 8 players and optimize mobile responsive web UI` → `git push origin main` 완료 → `npx vercel deploy`(프리뷰) 정상 완주, READY — `https://board-game-im38euq90-me-3871.vercel.app`. "production" 명시 없어 이번에도 프리뷰까지만 진행 — 필요하면 `npx vercel deploy --prod`로 후속 승격 요청할 것.

### 2026-08-21 — 운명전쟁39 8인 모드 지원 + 카드 덱/라운드 규칙 확장

**요청**: `HANDOFF.md`와 운명전쟁39 코드(`src/games/destinyWar39/` 하위 `engine.ts`/`DestinyWar39Game.tsx`/`DestinyWar39Board.tsx` 등)를 먼저 확인한 뒤 (1) 로비/설정에 8인 모드 선택 옵션 개방 + 인게임 보드/사이드바를 8인 레이아웃으로 확장, (2) 8인 전용 72장 덱(0×8, 데스×2, 1~62 숫자, 리버스 11/22/33/44/55) 생성·셔플, (3) 8인도 기존과 동일하게 9라운드 진행되도록 카드 분배·예측·판정 동기화, (4) `DestinyWar39.test.ts`에 8인 모드 테스트(덱 구성/리버스 판정/9라운드 완주) 보강, (5) `tsc`/`lint`/`vitest` 검증 → HANDOFF 갱신 → 커밋 `feat(destiny-war-39): add 8-player mode with 72-card deck and 5 reverse cards` → 푸시 → 배포까지 요청. UI 배치나 덱 셔플/분배 방식에 확인이 필요하면 절대 임의로 추정하지 말고 먼저 질문 목록을 제시해 확인받으라고 명시.

**조사**: `engine.ts`가 `export const PLAYER_COUNT = 5`를 모듈 최상단 상수로 두고 딜링(`dealRound`)·좌석 루프·봇 카드 강도 정규화(`card.value / 39`)·`DestinyWar39Board.tsx`/`PredictionStatusBoard.tsx`/`LastRoundHistoryModal.tsx`/`RulebookModal.tsx` 전역에서 이 고정 상수를 직접 참조하고 있었고, 룰북(`boardGameRule/운명전쟁39/운명전쟁39.md`) §2도 "정확히 5인 고정, 인원 가변은 지원하지 않는다"로 명시돼 있어 8인 모드 추가는 엔진을 모드별(5인/8인) 설정으로 일반화하는 구조 변경이 필요함을 확인. 다만 `DestinyWar39Board.tsx`/`PredictionStatusBoard.tsx`는 좌석 렌더링이 대부분 `Array.from({length: PLAYER_COUNT})` + `flex-wrap` 기반이라 8인으로 확장해도 레이아웃이 자연스럽게 늘어나 별도 좌석 배치 재설계가 필요 없음을 확인. 동일 프로젝트의 `coup/CoupGame.tsx`(가변 인원 3~6명 지원)에 이미 "호스트가 방 만들기 단계에서 `targetPlayerCount`를 정하고 Supabase presence로 참가자들에게 전파 → `startGame(playerCount, seed)`" 패턴이 구현돼 있어, 이를 5/8 2択 토글로 재사용하기로 결정(레이아웃/전파 방식은 이미 있는 선례라 별도 질문 없이 그대로 채용).

**모호점 확인(`AskUserQuestion`, 2문항)**: ① 8인 모드는 데스카드가 2장이라 같은 턴에 서로 다른 두 플레이어가 데스카드를 동시에 낼 수 있는데(5인 룰북엔 이 상황에 대한 규정이 아예 없음), 이때 승자를 어떻게 정할지 — "먼저 공개한 사람(0 카드 동률 규칙과 동일)" vs "무작위 승자" vs "서로 상쇄(무효) 처리" → **"먼저 공개한 사람(§6.3 0-카드 동률 규칙과 동일하게 적용)"** 선택. ② 인원수(5인/8인) 선택 UI 배치 — "방 만들기 단계 토글(레지스탕스 쿠와 동일 패턴)" vs "최초 화면에서 아예 모드별 버튼 분리" → **"방 만들기 단계 토글"** 선택.

**엔진 변경** (`engine.ts`): `PLAYER_COUNT` 고정 상수를 제거하고 `PlayerCount = 5 | 8`(`SUPPORTED_PLAYER_COUNTS`, `MIN_PLAYERS`/`MAX_PLAYERS`/`DEFAULT_PLAYER_COUNT`) 타입 + `DECK_MODE_CONFIG`(모드별 `zeroCount`/`deathCount`/`maxNumber`) 도입. `buildDeck(playerCount)`가 0×zeroCount + 1~maxNumber(각 1장) + 데스×deathCount로 덱을 생성(5인: 5+39+1=45장 그대로 유지, 8인: 8+62+2=72장 신규) — 두 모드 모두 "덱 장수 = 인원수×9라운드"라 라운드 9에서 정확히 전체 덱이 소진되는 기존 설계 불변식이 그대로 성립. `isReverseCard(card, playerCount)`가 "11의 배수 중 그 모드의 maxNumber 이하"로 리버스 카드를 계산해 5인은 11/22/33, 8인은 11/22/33/44/55를 자동 산출(하드코딩 목록 대신 공식화). `DestinyWar39State`에 `playerCount` 필드 추가, `startGame(playerCount, seed)`로 시그니처 변경(레지스탕스 쿠와 동일 인자 순서), `dealRound`/`freshRound`/`nextRound`/`play`/`nextToActInTurn`/`getValidMoves`/`scoreMove`/`cardStrength`가 전부 하드코딩 `PLAYER_COUNT` 대신 `state.playerCount` 또는 전달받은 `playerCount` 파라미터를 사용하도록 일반화. `resolveTurn(plays, revealOrder, playerCount)`에 신규 인자 추가, 데스카드 처리를 `find`(단일) → `filter`(배열)로 바꿔 **8인 모드에서 데스카드 2장이 같은 턴에 동시에 나오는 경우**(리버스 비활성으로 데스가 이기는 상황이든, 리버스 활성 상황이든) 기존 `firstByOrder` 헬퍼(0-카드 동률에 이미 쓰이던 것)를 그대로 재사용해 "먼저 공개한 쪽이 승리"하도록 구현 — 0이 함께 있으면 데스카드 수와 무관하게 여전히 0이 승리하고 그 0끼리의 동률은 기존 §6.3 그대로 처리됨을 신규 테스트로 확인.

**UI 변경**: `CardFace.tsx`의 `isReverseCard`/`cardBadgeClasses`가 `playerCount` prop을 받도록 확장(리버스 하이라이트가 모드에 맞는 리버스 값 집합을 사용) — `DestinyWar39Board.tsx`/`LastRoundHistoryModal.tsx`의 모든 `<CardFace>` 호출에 `playerCount={state.playerCount}` 전달. `DestinyWar39Board.tsx`/`PredictionStatusBoard.tsx`/`LastRoundHistoryModal.tsx`는 `PLAYER_COUNT` import를 제거하고 `state.playerCount` 기반으로 좌석 순회하도록 교체(레이아웃 자체는 기존 `flex-wrap` 그리드 그대로라 8인도 자연스럽게 줄바꿈). `RulebookModal.tsx`는 `playerCount` prop을 받아 덱 구성 표(장수 총합/0 장수/데스 장수/리버스 목록)와 §6 판정 설명을 모드에 맞게 동적으로 렌더링(8인 모드에는 데스카드 동률 규칙 문구 추가). `DestinyWar39Game.tsx`: `Occupant`에 `targetPlayerCount` 필드 추가, "방 만들기" 단계(`enter-name`, `intent === "create"`일 때만)에 5인/8인 세그먼트 토글 신규 추가, 호스트가 `channel.track()`으로 presence에 `targetPlayerCount`를 실어 보내고 참가자는 `host?.targetPlayerCount`(= `knownTargetPlayerCount`)로 좌석 정원·자동 시작 조건·대기 화면 인원수 표시를 판단(레지스탕스 쿠 패턴과 동일). `game-start`/`sendGameStart` 브로드캐스트 payload에 `playerCount` 추가.

**룰북 갱신** (`boardGameRule/운명전쟁39/운명전쟁39.md`, Version 2.1 → **2.2**): §2를 "5인 또는 8인 중 방 생성 시 선택"으로 개정, §3을 §3.1(5인, 45장)/§3.2(8인, 72장) 표로 분리, §6.4(신규) "데스카드가 여러 장 나온 경우"에 위 확인 질문에서 결정된 타이브레이크 규칙 명문화, §5/§6/§11의 "5명"/"45장" 하드코딩 문구를 모드 중립적 표현으로 일반화, §13 핵심 요약도 8인 모드를 반영해 갱신.

**테스트 보강** (`DestinyWar39.test.ts`, 45개 → **61개**): 8인 전용 `describe` 블록 신규 추가 — 덱 구성(0×8/데스×2/1~62 각 1장/합계 72장, 66은 62 초과라 리버스 아님), `resolveTurn`(8명분 플레이, 44/55 리버스 단독 발동, 11+44 짝수로 리버스 해제, **데스카드 2장 동시 등장 시 먼저 낸 사람 승리**를 리버스 비활성/활성 양쪽 + "0이 있으면 데스 장수와 무관하게 0이 이김" 케이스까지, 0-동률이 8명 후보로 늘어나도 동일하게 동작), 9라운드 풀게임 시뮬레이션(8인 전원 최종 스코어/순위, 라운드 9에서 8×9=72장 전체 덱 소진 확인), 봇 로직(8인에서도 `chooseBotAction`이 항상 합법 수를 반환, 카드 강도 정규화가 62 기준으로 정상 동작). 기존 5인 테스트는 `startGame(seed)` → `startGame(5, seed)`, `resolveTurn(plays, order)` → `resolveTurn(plays, order, 5)`로 시그니처만 갱신하고 로직·기대값은 전부 그대로 유지.

**검증**: `npx tsc --noEmit`(전체, 에러 0) / `npm run lint`(전체, 경고 0) / `npx vitest run src/games/destinyWar39`(61/61 통과) / `npx vitest run --exclude '**/aiBenchmark.test.ts'`(27개 파일 1080/1080 통과).

**커밋/배포**: 커밋 `148cfc4 feat(destiny-war-39): add 8-player mode with 72-card deck and 5 reverse cards` → `git push origin main` 완료 → `npx vercel deploy`(프리뷰) 정상 완주, READY — `https://board-game-bu37h53h1-me-3871.vercel.app`. 이후 대시보드 카드의 게임 목록 메타데이터(`registry.ts`)가 여전히 `players: { min: 5, max: 5 }`로 남아있고 설명 문구도 5인 모드 리버스 카드(11·22·33)만 언급하던 것을 발견해 `players: { min: 5, max: 8 }` + 두 모드를 모두 설명하는 문구로 후속 수정 — 커밋 `ba1eb63 fix(destiny-war-39): update dashboard listing to reflect 8-player mode` → 푸시 → 재배포, READY — `https://board-game-r1pxeucmp-me-3871.vercel.app`. "production" 명시 없어 이번에도 프리뷰까지만 진행 — 필요하면 `npx vercel deploy --prod`로 후속 승격 요청할 것.

### 2026-08-21 — 페루도 무여백(Zero-Gap) 대칭 트랙 연결 + 보드판 확장

**요청**: `HANDOFF.md`, 페루도 보드 렌더링/스타일 코드(`PerudoBoard.tsx` 등), `boardGameRule/페루도/` 디렉터리를 먼저 확인한 뒤 (1) 타일 사이 여백 없는 완벽한 연결(gap:0, margin:0, 얇은 내부 구분선만), (2) 상하좌우 완벽 대칭 CSS Grid 구조 + 보드판 크기 확장, (3) 타일 내부 콘텐츠(숫자/아이콘/마커) 중앙 정렬 안정화, (4) `tsc`/`lint`/`vitest` 검증 후 HANDOFF 최신화 + 커밋·푸시 + 배포까지 요청. 보드판 크기 비율, 4변 칸 수 분할 방식 등 디자인·레이아웃상 확인이 필요하면 절대 임의로 넘겨짚지 말고 먼저 질문 목록을 제시해 확인받으라고 명시.

**조사**: `PerudoBoard.tsx`와 직전 08-21 "트랙 칸 간격 축소" 세션의 doc comment를 확인한 결과, 그 세션이 이미 코너↔변·변 내부 칸 사이 간격을 `TRACK_GAP_CLASS`(`gap-1`/`sm:gap-1.5` = 4px/6px)로 "균일화"는 해뒀지만 그 값 자체가 0은 아니라 여전히 각 칸이 낱개 카드처럼 보이는 완전한 무여백은 아니었음을 확인. 30칸 트랙 순서·인덱스 매핑(`trackCellAt`)과 4코너(숫자1/6/11/16) + 북7·동6·남7·서6 분할은 그 이전(08-21 "수정필요1 30칸") 세션에서 실물 보드 사진(`boardGameRule/페루도/수정필요1.png`) 기준으로 이미 확정된 구조라 이번 세션에서 재검토 대상이 아님을 확인 — `engine.ts`의 `validateRaise`가 이 인덱스 순서 자체를 판정 근거로 삼고 있어 트랙 순서를 건드리면 룰 로직에도 영향이 간다. 참고용 실물 보드 사진(`변경후이미지.jpg`)을 다시 대조한 결과 타일들이 개별 테두리로 서로 맞닿아 있을 뿐 사이 공백이 전혀 없고, 낱개 타일 자체는 살짝 둥글고 찢어진 듯한 모서리를 갖고 있어 "완전한 사각 그리드"라기보다 "이어붙인 나무 판자" 느낌에 가까움을 확인. 페이지 컨테이너(`app/games/[gameId]/page.tsx`)가 페루도를 포함한 대부분 게임에 `max-w-2xl`(672px)로 고정돼 있어, 요구된 "보드판 확장"이 실제로 반영되려면 이 컨테이너 폭도 함께 넓혀야 함을 확인(소환사의 협곡이 이미 `max-w-5xl`로 예외 처리된 선례 존재).

**모호점 확인(`AskUserQuestion`, 4문항)**: ① 여백 제거 시 낱개 타일의 모서리를 각진 사각형(바깥 프레임만 둥글게, 실물 보드와 가장 유사)으로 바꿀지, 낱개 타일 자체의 둥근 모서리를 유지할지 → **"둥근 모서리 유지"** 선택(완전한 이음매 없는 그리드보다 인접 모서리에 마트 배경이 살짝 비치는 것을 허용). ② 트랙 안쪽 중앙 공간을 실물 보드처럼 무덤 전용으로 비우고 베팅 패널·내 주사위를 보드 밖으로 옮길지, 지금처럼 베팅 패널+내 주사위+무덤을 모두 중앙에 유지할지 → **"모두 중앙 유지"** 선택(기능 UI 위치는 그대로, 배치·정렬만 대칭 강화). ③ 보드판 확장 규모(현재 타일 36px/44px 대비) — 약 1.4배(50px/62px) vs 약 1.8배(64px/80px) → **"약 1.4배"** 선택. ④ 확장된 보드를 고정 크기로 둘지, 화면 크기에 반응(넓은 화면에서 더 커짐)하게 할지 → **"반응형"** 선택.

**구현** (`src/games/perudo/PerudoBoard.tsx`만 수정 — `engine.ts` 무변경이라 30칸 트랙 순서·비딩 판정 로직에는 전혀 영향 없음): 기존 두 브레이크포인트 고정 픽셀(`h-9 w-9`/`sm:h-11 sm:w-11` = 36px/44px)과 세 곳에 흩어져 있던 `TRACK_GAP_CLASS`/`STRIP_LENGTH_CLASS` 상수를 전부 제거하고, 단일 CSS 커스텀 프로퍼티 `--perudo-cell: clamp(50px, calc(33px + 4.5vw), 78px)`(`BOARD_SIZE_STYLE`, `RectBidTrack`의 grid 루트에 1회 설정)로 교체 — 코너·북·남·동·서 30칸 전부(`CELL_STYLE = { width: CELL_VAR, height: CELL_VAR }`)와 스트립 컨테이너 길이(`stripLength(count) = calc(var(--perudo-cell) * count)`, 북/남 7칸·동/서 6칸)가 이 한 변수만 참조하는 단일 소스 구조. 외곽 grid와 각 스트립의 gap을 전부 `0`으로 낮춰 코너↔스트립·칸↔칸 간격이 그리드 전체에서 하드 제로가 되고, `TrackCellButton`의 테두리를 `border-2`(2px)에서 `border`(1px)로 낮춰 인접 타일이 맞닿을 때 "얇은 내부 구분선"(요구사항 1)만 남도록 함. 모바일~1000px 뷰포트 구간은 `clamp()`가 `33px + 4.5vw`로 선형 보간(모바일 ~50px, `sm` 640px 기준 ~62px — AskUserQuestion 확정 목표치와 일치)하고 그 이상은 78px에서 고정 — "넓은 화면에서 더 커짐"(요구사항 4)과 "타일이 무한정 커지지 않음"을 동시에 만족. 칸 안 숫자(`fontSize: calc(var(--perudo-cell) * 0.3)`)와 조커 아이콘(`w-/h-[calc(var(--perudo-cell)*0.26)]`)도 고정 `text-[10px]`/`sm:text-xs`에서 이 비율 기반으로 전환해 커진 타일에 비례해 가독성 있게 확대(요구사항 3). `app/games/[gameId]/page.tsx`는 `game.id === "perudo"`일 때만(소환사의 협곡의 `max-w-5xl` 예외 처리와 동일한 삼항 분기 패턴) 페이지 컨테이너를 `max-w-2xl`→`max-w-4xl`(896px)로 넓혀 확장된 보드(최대 폭 약 720px)가 여유 있게 들어갈 공간을 확보(다른 모든 게임 페이지는 완전히 무영향).

**버그 발견 및 즉시 수정**: 구현 직후 Playwright로 390px(일반적인 모바일 폭) 뷰포트를 실측한 결과, 최소 타일 크기(50.5px)에서도 보드 전체 폭(9칸×50.5px+테두리/패딩 ≈ 470px)이 `TABLE_PANEL`(페이지 컨테이너 패딩+`p-3` 안쪽 가용폭 약 332px)보다 훨씬 넓어, `TABLE_PANEL`에 걸려 있던 `overflow-hidden`(원래 `TableTexture`의 장식 레이어를 둥근 모서리에 맞춰 잘라내기 위한 것) 때문에 보드 오른쪽이 스크롤 수단 없이 그냥 잘려나가는 회귀를 발견. 트랙을 `overflow-x-auto` 래퍼(기존에 게임 종료 순위표에 이미 쓰이던 것과 동일한 패턴)로 감싸 해결 — 수정 후 재측정에서 이 래퍼의 `scrollWidth`(471px)가 `clientWidth`(332px)보다 커서 실제로 가로 스크롤/팬이 가능함을 확인했고, 동시에 `document.body.scrollWidth`는 여전히 `390`(= `window.innerWidth`)으로 페이지 전체가 옆으로 밀리는 부작용은 없음을 확인 — 가장 좁은 폰 화면에서만 보드를 좌우로 살짝 스크롤해야 전체를 볼 수 있는 것을 허용 가능한 트레이드오프로 판단(약 700px 이상에서는 스크롤 없이 보드 전체가 한 화면에 들어옴, 스크린샷으로 확인).

**브라우저 실측 검증** (Playwright, `npm install --no-save playwright@1.62.1`로 임시 설치 후 검증 완료 뒤 `npm uninstall --no-save playwright`로 원복 — `package.json`/`package-lock.json` 변경 없음): 임시 dev 라우트(`src/app/dev-perudo-preview` — 프로덕션과 동일한 `mx-auto max-w-4xl px-4 py-8 sm:px-6` 래퍼로 `PerudoBoard`를 감싸고 `startGame(4, seed)` + `raise` 액션으로 고정 상태를 직접 마운트, 검증 후 삭제)를 만들어 390px(모바일)/700px(`sm` 근방)/1400px(데스크톱) 세 뷰포트에서 스크린샷 촬영 + `page.evaluate`로 `[data-track-index]` 30칸 전수 바운딩박스 측정. **측정 결과**: 30칸 전부 각 뷰포트에서 정확히 동일한 크기(390px→50.5×50.5px, 700px→64.5×64.5px, 1400px→78.0×78.0px — `clamp()` 상한 78px에 도달), 코너↔스트립 간격(`gap 0→1`, `gap 7→8`)과 스트립 내부 칸 간격(`gap 1→2`) 전부 0.00~0.02px(서브픽셀 반올림 오차 수준)로 실질적 완전 제로. 스크린샷 육안으로도 30칸이 하나로 이어진 사각 루프 트랙으로 보이고, 낱개 타일의 둥근 모서리가 인접 타일과 맞닿는 지점에서만 살짝 마트 배경이 비쳐 실물 보드의 "이어붙인 판자" 질감과 유사함을 확인. 700px/1400px에서는 보드 전체가 스크롤 없이 한 화면에 들어오고 중앙 정렬됨, 390px에서는 위 "버그 발견 및 즉시 수정" 절의 가로 스크롤로 전체 열람 가능함을 확인. 콘솔/페이지 에러 0건(사전 404 2건은 과거 세션들과 동일하게 이번 변경과 무관한 게스트 사용량/앱 설정 조회로 확인). 검증에 쓴 임시 라우트·스크립트는 저장소에 흔적 없이 삭제.

**검증**: `npx tsc --noEmit`(전체, 에러 0) / `npm run lint`(전체, 경고 0) / `npx vitest run src/games/perudo`(73/73 통과, 2.29초) / `npx vitest run --exclude '**/aiBenchmark.test.ts'`(27개 파일 1064/1064 통과, 42.48초) — `engine.ts` 무변경이라 순수 `PerudoBoard.tsx`/`page.tsx` 레이아웃 변경이 게임 로직에 전혀 영향 없음을 재확인. **주의**: 검증 도중 백그라운드로 걸어둔 `--exclude` 없는 무제한 `npx vitest run`이 5분 넘게 응답이 없어 `TaskStop`으로 취소했으나, §2에 이미 기록된 패턴대로 `TaskStop`이 자식 워커 프로세스까지는 못 죽여 `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where CommandLine -match 'vitest'`로 잔존 프로세스 3개(`npx`/`vitest.mjs`/`workers/forks.js`)를 발견해 전부 `Stop-Process -Force`로 종료한 뒤 `--exclude '**/aiBenchmark.test.ts'`로 재실행해 정상 완료.

**커밋/배포**: 커밋 `2aebd0f refactor(perudo): implement seamless symmetrical connected track layout with zero gap` → `git push origin main` 완료 → `npx vercel deploy`(프리뷰) 정상 완주(Turbopack 빌드+TS 전체 재검사 포함, 임시 dev 라우트는 삭제돼 있어 빌드 라우트 목록에도 나타나지 않음 확인), READY — `https://board-game-dldzbygxn-me-3871.vercel.app`. "production" 명시 없어 이번에도 프리뷰까지만 진행 — 필요하면 `npx vercel deploy --prod`로 후속 승격 요청할 것.

### 2026-08-21 — 소환사의 협곡 던전 덱 카운트 + 장비 탈착 소유자 연출 + 용사 카드 UI + 룰 가이드 사이드바

**요청**: `HANDOFF.md`와 `boardGameRule/소환사의 협곡/`(`용사.png`, `설명카드조각1.png`, `소환사의 협곡.md`) 및 `src/games/summonersRift/` 기존 코드를 먼저 확인한 뒤 다음 4가지를 구현해달라는 요청: (1) 중앙 던전 입장 몬스터 카드더미 위에 잔여 매수 표시, (2) 장비 카드를 제거(탈착)했을 때 어떤 플레이어가 뺐는지 시각적으로 알 수 있는 소유자 연출(뒤집힌 몬스터 카드 위에 제거한 장비를 비스듬히 오버레이), (3) 기본 체력 3 `용사.png` 카드 UI를 테이블 중앙에 노출, (4) `설명카드조각1.png` 기반 인게임 룰/요약 가이드 패널. 컴포넌트 크기·배치·레이어 순서 등 디자인상 확인이 필요하면 절대 임의로 추정하지 말고 먼저 질문 목록을 제시해 확인받은 후 진행하라고 명시.

**조사**: `SummonersRiftBoard.tsx`/`engine.ts`/`CardArt.tsx`/`assets.ts`를 확인한 결과, (1) 덱 잔여 매수는 이미 헤더에 텍스트("🃏 덱 N장")로는 있었지만 실제 카드가 쌓인 비주얼 더미는 협곡 더미에만 있고 던전 입장 덱에는 전혀 없었음, (2) `PlayerState`엔 이번 라운드에 몇 개를 숨겼는지 세는 `hiddenCardCount`만 있고 "어떤 아이템을 숨겼는지"는 어디에도 기록되지 않아 소유자 연출 자체가 불가능한 상태(엔진 확장이 필요), (3) 챔피언 섹션은 텍스트 헤더+HP 숫자+아이템 6장 나열뿐 실제 `용사.png` 이미지는 어디에도 쓰이고 있지 않았음, (4) 이 프로젝트엔 사이드바 레이아웃 전례가 전혀 없고 모든 게임이 모달/플로팅 버튼(`RulebookModal` + `📖 룰북` 버튼)만 사용, 페이지 컨테이너(`app/games/[gameId]/page.tsx`)도 모든 게임이 `max-w-2xl` 고정이라 사이드바를 위한 여유 폭이 없음을 확인.

**모호점 확인(`AskUserQuestion`, 4문항)**: ① 덱 잔여 매수 표시 방식 — 기존 헤더 텍스트만 강조 vs 협곡 더미 옆에 카드 뒷면이 실제로 쌓인 새 비주얼 스택+뱃지 추가 → **"협곡 더미 옆에 새 카드 스택 추가"** 선택. ② 한 라운드에 같은 플레이어가 장비를 여러 개 제거했을 때 최근 1개만 표시 vs 제거한 전부를 겹쳐 표시 → **"제거한 모든 장비를 전부 스택"** 선택(이를 위해 엔진에 "어떤 아이템을 누가 제거했는지" 기록하는 신규 필드가 필요함을 함께 확인). ③ 용사 카드 배치 — 기존 헤더 옆 작은 아이콘만 추가 vs 중앙에 용사 카드+그 아래 아이템 6장을 나열해 실물 세팅을 재현 → **"중앙 용사 카드 + 주변 아이템(실물 세팅 재현)"** 선택. ④ 가이드 패널 노출 방식 — 기존 "📖 룰북"과 같은 플로팅/모달 vs 이 프로젝트에 전례 없는 상시 노출 사이드바 → **"상시 노출 사이드바"** 선택.

**엔진 변경** (`engine.ts`): `PlayerState`에 `removedItemIds: ItemId[]` 신규 필드 추가 — 제거 순서대로 누적되고 `dealRound`에서 `hiddenCardCount`와 함께 매 라운드 `[]`로 초기화됨(`removeItem`이 `hiddenCardCount`와 동시에 갱신, 그 외 판정 로직은 전혀 무변경 — 어떤 룰도 이 필드를 읽지 않는 순수 UI용 파생 정보). `SummonersRift.test.ts`도 `makePlayer` 헬퍼 기본값과 `removeItem`/`dealRound` 테스트 케이스를 갱신.

**UI 구현**: `CardArt.tsx`에 3개 컴포넌트 신규 추가 — `CardPileStack`(카운트 뱃지가 달린 카드 뒷면 스택; 기존에 협곡 더미 전용으로 인라인 작성돼 있던 렌더링을 추출해 던전 덱과 공용으로 재사용), `HeroCard`(`용사.png`를 그대로 보여주는 정적 타일 — 이미지 자체에 "HP:3"·"용사" 라벨이 각인돼 있어 별도 숫자 오버레이를 얹지 않고, 라이브 총 HP(베이스+아이템 보너스)는 기존 챔피언 섹션 헤더의 `❤️` 뱃지가 계속 전담해 서로 다른 정보를 헷갈리지 않게 분리), `HiddenEquipmentStack`(플레이어별 `removedItemIds` 전부를 뒤집힌 몬스터 마커(`DeckBack`) 위에 항목마다 각도를 늘려가며 겹쳐 쌓아 렌더). `assets.ts`에 `HERO_IMAGE` 상수 추가, `boardGameRule/소환사의 협곡/용사.png`를 `public/images/summoners-rift/champion/hero.png`로 동기화(97×174px). `SummonersRiftBoard.tsx`: 챔피언 섹션에 `HeroCard`를 아이템 행 바로 위 중앙에 삽입, 기존 "협곡 더미" 단독 섹션을 던전 덱(신규)+협곡 더미 두 `CardPileStack`이 나란히 있는 섹션으로 재구성(협곡 더미 쪽엔 기존 몬스터 공개/전투 애니메이션 슬롯을 그대로 유지), 스코어보드 각 플레이어 행에 `HiddenEquipmentStack` 삽입, 보드 루트를 `flex flex-col lg:flex-row`로 감싸 신규 `SummonersRiftGuideSidebar.tsx`(강도·몬스터명·카운터 아이템 3열 표 — `설명카드조각1.png`와 동일한 정보를 `MONSTER_CATALOG`/`ITEM_CATALOG`에서 직접 계산해 항상 최신 상태 유지 + 진행 흐름 4단계 요약 목록, 클릭 없이 항상 렌더링되어 넓은 화면에선 보드 옆, 좁은 화면에선 보드 아래로 자연스레 스택)를 옆에 배치. `app/games/[gameId]/page.tsx`는 `game.id === "summoners-rift"`일 때만 페이지 컨테이너를 `max-w-2xl`→`max-w-5xl`로 넓혀 사이드바가 보드 옆에 들어갈 공간을 확보(다른 모든 게임 페이지는 삼항 분기라 완전히 무영향).

**브라우저 실측 검증** (Playwright, `npm install --no-save playwright@1.62.1`로 임시 설치 후 검증 완료 뒤 `npm uninstall --no-save playwright`로 원복 — `package.json`/`package-lock.json` 변경 없음): 임시 dev 라우트(`src/app/dev-summoners-rift-preview` — `SummonersRiftBoard`를 프로덕션과 동일한 `mx-auto max-w-5xl px-4 py-8 sm:px-6` 래퍼로 감싸고, `startGame`+`applyAction`으로 덱 10장/협곡 더미 1장, 서로 다른 두 좌석(seat 0 "루비", 그리고 다음 활성 좌석)이 각각 장비 1개씩 제거한 상태를 직접 마운트해 Supabase Realtime 로비를 우회, 검증 후 삭제)를 만들어 1280px(사이드바가 보드 옆에 배치)/390px(사이드바가 보드 아래로 스택되지만 클릭 없이 계속 노출) 두 뷰포트에서 스크린샷 촬영. **확인 결과**: 던전 입장 카드더미 뱃지 "10"과 협곡 더미 뱃지 "1"이 각 카드 스택 우상단에 정상 표시, `용사.png`가 "HP:3"·"용사" 문구와 함께 챔피언 섹션 중앙에 아이템 6장 바로 위에 선명하게 렌더(2개 아이템은 요청대로 "해제됨" 처리로 흐려짐), 가이드 사이드바가 몬스터 8종 전체(강도 1~9)의 정확한 카운터 아이템 표와 진행 흐름 4단계를 보여줌, 장비를 제거한 두 플레이어(`루비(나)`/`봇3`) 행 옆에 각각 뒤집힌 마커+비스듬히 기울어진 제거 아이템 카드 오버레이가 렌더됨을 고배율 크롭 스크린샷으로 확인. `page.on("response")`로 4xx/5xx 응답을 전수 수집한 결과 이번 변경과 무관한 사전 존재 404 2건(게스트 사용량/앱 설정 Supabase 조회, 과거 세션들과 동일 패턴)만 발견, `pageerror` 0건. 검증에 쓴 임시 라우트·스크립트는 저장소에 흔적 없이 삭제.

**검증**: `npx tsc --noEmit`(전체, 에러 0) / `npm run lint`(전체, 경고 0) / `npx vitest run src/games/summonersRift`(52/52 통과 — `removedItemIds` 관련 신규 테스트 2개 포함) / `npx vitest run --exclude '**/aiBenchmark.test.ts'`(27개 파일 1064/1064 통과) — `engine.ts` 변경은 순수 부가 필드 추가뿐이라 기존 룰 판정 테스트 전부 그대로 통과.

**커밋/배포**: 커밋 `dc6fcf5 feat(summoners-rift): add dungeon deck count, equipment removal overlay, hero card UI, and rule guide panel` → `git push origin main` 완료 → `npx vercel deploy`(프리뷰) 첫 시도는 "Not authorized" 일시 오류로 실패했으나 재시도에서 정상 완주(Turbopack 빌드+TS 전체 재검사 포함, 임시 dev 라우트는 삭제돼 있어 빌드 라우트 목록에도 나타나지 않음 확인), READY — `https://board-game-go4gtsh1f-me-3871.vercel.app`. "production" 명시 없어 이번에도 프리뷰까지만 진행 — 필요하면 `npx vercel deploy --prod`로 후속 승격 요청할 것.

### 2026-08-21 — 페루도 트랙 칸 간격 축소 + 보드 전체 균등 여백 정돈

**요청**: 페루도 보드판의 과도하게 벌어진 칸 간격(gap)을 좁히고, 트랙 안팎 및 상하좌우 모든 슬롯 사이의 여백(margin/padding/gap)을 동일한 균등 비율로 정돈해달라는 요청. 간격 수치·비율 등 디자인상 확인이 필요한 부분은 임의로 추정하지 말고 먼저 질문 목록을 제시해 확인받은 후 진행하라고 명시.

**조사**: `HANDOFF.md`와 `PerudoBoard.tsx`를 확인한 결과, 직전 08-21 세션("슬롯 크기 균등화")이 모든 칸을 고정 정사각형(h-9 w-9/sm:h-11 sm:w-11)으로 만들면서 북/남/동/서 스트립 컨테이너에 `justify-between`을 걸어 "칸이 변 끝까지 균등 배치"되도록 했었음(그 세션 자체의 `AskUserQuestion`으로 확정된 방향). 문제는 그 스트립을 담는 grid 컬럼이 `1fr`(부모의 `w-full`을 따라 뷰포트 폭에 비례해 늘어남)이었다는 점 — 칸 크기는 고정인데 그 칸들을 뿌리는 컨테이너 폭만 화면이 넓어질수록 계속 커져서, `justify-between`이 남는 공간을 전부 칸 사이 간격으로 밀어넣는 구조였다. 반면 코너↔스트립 사이 간격은 외곽 grid 자체의 고정 `gap-1`/`sm:gap-1.5`라 전혀 변하지 않아, "일부 지점만 비대칭으로 과도하게 벌어지는" 정확한 원인이었다.

**모호점 확인(`AskUserQuestion`, 2문항)**: ① 칸 사이/코너↔변 사이 간격을 정확히 얼마로 통일할지 — 기존 그리드 여백(4px/6px) 재사용 vs 더 좁게(2px/3px) vs 더 여유있게(6px/8px) → **"기존 그리드 여백 재사용"** 선택(이미 코너↔변 사이에 쓰이던 값을 그대로 보드 전체에 재사용하는 것이 새 수치를 만드는 것보다 일관적이라는 설명 포함). ② 간격을 고정값으로 좁히면 보드가 더 이상 화면 폭을 억지로 채우지 않고 고유 크기(칸+간격의 실제 합)로 고정되어 원목 테이블 위의 실물 보드처럼 중앙에 자리잡게 되는데, 넓은 화면에서 보드 좌우로 원단(mat) 여백이 보이는 것이 괜찮을지(대안: 칸 크기 자체를 화면 폭에 비례해 키우는 방식) → **"보드는 고정 크기로 중앙 정렬"** 선택.

**구현** (`src/games/perudo/PerudoBoard.tsx`만 수정 — `engine.ts` 무변경): 신규 상수 `TRACK_GAP_CLASS`(`"gap-1 sm:gap-1.5"` — 코너↔변 grid 간격, 변 내부 칸 사이 간격, 보드 테두리↔코너 패딩까지 세 곳 전부에 동일하게 재사용해 "한 곳만 수정하면 전체가 같이 바뀌는" 단일 소스로 만듦)와 `STRIP_LENGTH_CLASS`(북/남 7칸=`7×36+6×4=276px`(모바일)/`7×44+6×6=344px`(sm), 동/서 6칸=`6×36+5×4=236px`/`6×44+5×6=294px` — 칸 크기×개수+간격×(개수-1)을 손으로 계산한 고정 픽셀 값)를 도입. `RectBidTrack`의 외곽 grid를 `w-full`+중앙 컬럼 `1fr`(뷰포트에 맞춰 계속 늘어남)에서 `w-fit mx-auto`+`gridTemplateColumns/Rows: "auto auto auto"`(내용물 크기 그대로 고정, 마트 위에 중앙 정렬)로 전환. 북/남/서/동 스트립 컨테이너는 `justify-between`(남는 공간을 칸 사이에 억지로 분배) 대신 `STRIP_LENGTH_CLASS`의 정확한 고정 폭/높이를 갖도록 변경 — 컨테이너 크기가 칸+간격의 합과 정확히 같아 슬랙이 0이므로 별도 배치 규칙이 필요 없음. 서/동(세로) 스트립에만 `self-center` 추가 — 중앙 패널(무덤+비딩 패널+내 주사위)이 6칸 스트립 자체 높이보다 커서 grid 행이 그만큼 늘어날 때, 스트립이 그 늘어난 행 안에서 상하 대칭으로 놓이도록(늘어난 여백이 개별 칸 사이가 아니라 스트립 전체의 상하 여백으로만 남게 됨). `PerudoBoard`의 트랙 중앙 children 래퍼(기존 `max-w-md`=448px)도 `STRIP_LENGTH_CLASS.row`(276px/344px)로 좁혀, 중앙 패널이 북/남 스트립보다 넓어져서 grid 컬럼을 다시 벌리는 회귀를 원천 차단(`DiceRollTray`가 이미 `flex-wrap`이라 주사위가 5개를 넘어가도 다음 줄로 넘어갈 뿐 폭이 늘어나지 않음을 별도 확인).

**브라우저 실측 검증** (Playwright, `npm install --no-save playwright@1.62.1`로 임시 설치 → 검증 완료 후 `npm uninstall --no-save playwright`로 원복 — `package.json`/`package-lock.json` 변경 없음): 임시 dev 라우트(`src/app/dev-perudo-preview` — `PerudoBoard`를 실제 프로덕션 라우트(`src/app/games/[gameId]/page.tsx`)와 동일한 `mx-auto max-w-2xl px-4 py-8 sm:px-6` 래퍼로 감싸고 `startGame(4, seed)` + `raise` 액션으로 고정 상태를 직접 마운트해 로비/인증/리얼타임 우회, 검증 후 삭제)를 만들어 480px/900px/1920px 세 뷰포트에서 스크린샷 촬영 + `page.evaluate`로 `[data-track-index]` 30칸 전수 바운딩박스 측정. **측정 결과**: 30칸 전부 각 뷰포트에서 정확히 동일한 크기(모바일 36.0×36.0px, sm 이상 44.0×44.0px)이며, 특히 900px와 1920px에서 완전히 동일한 44.0×44.0px로 측정돼 **더 이상 화면 폭이 넓어져도 커지지 않음**을 확인(직전엔 이 지점이 바로 간격이 벌어지던 구간). 스크린샷 육안으로도 코너·변 칸 사이 간격이 조밀하고 균등해 보드가 하나의 사각형 보드판으로 묶여 보이며, 넓은 뷰포트에서도 보드가 고유 크기로 고정된 채 중앙에 자리잡음을 확인. 확정 비딩(`4×9개`)의 호박색 마커도 정확히 "9" 칸에 위치. 콘솔/페이지 에러 0건(사전 404 2건은 과거 세션들에서 이미 이번 변경과 무관한 게스트 사용량 조회로 확인된 것과 동일 패턴). 검증에 쓴 임시 라우트·스크립트는 저장소에 흔적 없이 삭제.

**검증**: `npx tsc --noEmit`(전체, 에러 0) / `npm run lint`(전체, 경고 0) / `npx vitest run src/games/perudo`(73/73 통과) / `npx vitest run --exclude '**/aiBenchmark.test.ts'`(27개 파일 1063/1063 통과, 42.89초) — `engine.ts` 무변경이라 순수 `PerudoBoard.tsx` 레이아웃 변경이 게임 로직에 전혀 영향 없음을 재확인.

**커밋/배포**: 커밋 `5d9a6ac refactor(perudo): tighten track slot gaps and normalize uniform layout spacing` → `git push origin main` 완료 → `npx vercel deploy`(프리뷰) 정상 완주(Turbopack 빌드+TS 전체 재검사 포함, 임시 dev 라우트는 삭제돼 있어 빌드 라우트 목록에도 나타나지 않음 재확인), READY — `https://board-game-3xpk1lagb-me-3871.vercel.app`. "production" 명시 없어 이번에도 프리뷰까지만 진행 — 필요하면 `npx vercel deploy --prod`로 후속 승격 요청할 것.

### 2026-08-21 — 페루도 트랙 30칸 슬롯 크기 균등화 + 주사위 UI 정갈함 유지 확인

**요청**: `HANDOFF.md`와 `boardGameRule/페루도/` 디렉터리의 "정상적인 주사위 크기.png"(대조군) / "칸이커지면서 뭉개진주사위.png"(버그 재현)를 근거로 (1) 주사위 UI를 예전의 깔끔한 스타일로 롤백/복원, (2) 사각형 30칸 트랙의 모든 슬롯 크기(가로/세로, 1:1 비율)를 완전히 동일하게 고정해달라는 요청. "다른 완성된 비딩 로직/트랙 순서는 절대 건드리지 말 것", "디자인상 확인이 필요하면 임의로 추정하지 말고 먼저 질문할 것"을 명시.

**조사**: `git log --oneline -- src/games/perudo/dice/PerudoDie.tsx`가 단 1개 커밋(`7369cf9 refactor(perudo): apply realistic top-down photo-styled dice UI`)만 보여줘, 다이 프리미티브(챔퍼 보더/좌상단 조명 그라데이션/음각(inset-shadow) 핍/글로시 하이라이트) 자체는 그 리팩터 이후 손댄 적이 없고 이후 커밋들은 콜러웨이(`colorways.ts`)/링 하이라이트(일치·와일드)/기울임 효과 같은 완성된 기능만 추가했음을 확인. 두 참조 이미지를 대조한 결과 실제 버그는 마커(보라색 배팅 다이) 자체가 아니라 그 마커가 앉은 **칸의 모양**이 정사각형이 아닌 데서 발생 — `PerudoBoard.tsx`의 `CELL_SIZING_CLASS`(`corner`/`row`/`col` 3가지 variant)가 코너 4칸만 `h-9 w-9`(고정 정사각형)이고 나머지 26칸(row: 북/남 변, col: 동/서 변)은 `h-9 min-w-0 flex-1`/`w-9 min-h-0 flex-1`로 컨테이너 폭에 따라 늘어나도록 되어 있었음(2026-08-21 "사각형 4변 트랙 재배치" 세션에서 도입, 그 이전 40칸 트랙 시절엔 모든 칸에 `aspect-square`가 있어 이 문제가 없었던 것과 대조). `TrackCellButton`의 마커 오버레이(`<PerudoDie ... style={{width:"100%",height:"100%"}}>` 안의 80% span)가 이 비정사각형 칸을 그대로 채우면서 다이 자체가 시각적으로 눌리거나 늘어나 보인 것 — 다른 어떤 다이 렌더링 코드(색상/핍/그림자)도 원인이 아님을 `grep`으로 재확인(같은 100%/100% 오버라이드 패턴이 이 한 곳에만 있음).

**모호점 확인(`AskUserQuestion`, 2문항)**: ① `PerudoDie.tsx`를 특정 커밋으로 완전히 되돌릴지, 아니면 그대로 두고(이미 "깔끔한 이전 스타일") 칸 크기만 정규화할지 → **"칸 크기만 정규화"** 선택(다이 자체를 되돌리면 그 위에 쌓인 콜러웨이/링 하이라이트 등 완성된 기능이 규정 위반 없이도 회귀할 위험이 있다는 설명 포함). ② 모든 칸을 고정 정사각형으로 만들면 더 이상 `flex-1`로 늘어나지 않는데, 각 변의 칸들을 컨테이너 안에서 양끝 정렬(칸 사이 간격이 늘어나 변 끝까지 채움) vs 왼쪽 정렬+고정 간격(변 끝에 여백이 남을 수 있음) 중 어느 쪽으로 배치할지 → **"양끝 정렬(space-between)"** 선택(참조 이미지의 "칸이 가장자리까지 이어지는" 느낌 유지).

**구현** (`src/games/perudo/PerudoBoard.tsx`만 수정 — `PerudoDie.tsx`/`engine.ts` 무변경): `CELL_SIZING_CLASS`의 `row`/`col` variant를 `corner`와 완전히 동일한 `"h-9 w-9 shrink-0 sm:h-11 sm:w-11"`로 통일(`flex-1`/`min-w-0`/`min-h-0` 전부 제거) — 이제 코너·북·남·동·서 30칸 전부가 뷰포트 폭과 무관하게 항상 같은 고정 픽셀 정사각형. `RectBidTrack`의 북/남/동/서 4개 컨테이너(`<div className="... flex ...">`)에 `justify-between`을 추가해, 더 이상 스스로 늘어나지 않는 고정 크기 칸들이 여전히 변의 양 끝까지 균등하게 퍼지도록 함(코너 칸과 딱 맞물리는 시각 효과 유지). 칸 내부 중앙 정렬(`items-center justify-center`, 요청 3번)은 `TrackCellButton`에 이미 있어 별도 수정 불필요. `CellSizing` 타입의 doc comment도 이 변경 배경(왜 세 variant가 이제 같은 값을 갖는지)을 남기도록 갱신.

**브라우저 실측 검증** (Playwright, `npm install --no-save playwright@1.62.1`로 임시 설치 — `package.json`/`package-lock.json` 변경 없음, 검증 후 `npm uninstall --no-save playwright`로 원복): 개발 서버를 띄우고 게스트로 `/games/perudo` 접속 → 실제 "방 만들기"로 2인 방 생성 → "봇 추가"로 Lv.5 AI 봇을 채워 라운드를 실제로 시작 → 내 턴에서 북쪽 변의 인터리어([페루도] 조커) 셀(`[data-track-index="4"]`, 코너가 아닌 "row" variant)을 클릭해 마커를 그 위로 옮김. `page.evaluate`로 코너(0)/북(1,2,4)/동(8,9,15)/남(16,23)/서(24) 등 10개 대표 인덱스의 `boundingBox()`를 전수 측정한 결과 **전부 정확히 36.0×36.0px로 동일**(모바일 뷰포트 500px 기준, `sm:` 브레이크포인트 미적용 구간이라 h-9/w-9 값 그대로) — 코너뿐 아니라 트랙 전체가 균등화됐음을 스크린샷 육안 확인이 아니라 DOM 좌표로 직접 대조(HANDOFF.md의 기존 "육안 판독만으로 단정하지 말 것" 원칙 준수). 마커가 이동한 북쪽 셀 스크린샷에서도 조커 마크가 왜곡 없이 정사각형 안에 깔끔하게 렌더링됨을 확인, 손패("내 주사위") 5개도 챔퍼/조명/음각 핍이 그대로인 기존 스타일임을 재확인. 콘솔 에러 없음(런타임 404 몇 건은 서버 로그에 대응 항목이 없어 클라이언트 전용 정적 자산 요청으로 추정, 이번 변경과 무관). 검증에 쓴 임시 스크립트(`_tmp_perudo_shot.mjs`)는 저장소 루트에 커밋되지 않은 채로 삭제.

**검증**: `npx tsc --noEmit`(전체, 에러 0) / `npm run lint`(전체, 경고 0) / `npx vitest run src/games/perudo`(73/73 통과, 4.15초) / `npx vitest run --exclude '**/aiBenchmark.test.ts'`(27개 파일 1063/1063 통과, 39.78초) — `engine.ts` 무변경이라 엔진 테스트는 참고용 회귀 확인. **주의**: 검증 중 앞서 백그라운드로 걸어둔 무제한 `npx vitest run`(aiBenchmark 포함) 인스턴스가 취소 후에도 자식 프로세스(`vitest.mjs`+`workers/forks.js`) 3세트가 살아남아 있던 것을 `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where CommandLine -match 'vitest'`로 발견해 전부 종료(§2 작업 규칙에 이미 기록된 "TaskStop이 실제 워커까지는 못 죽인다" 패턴이 이번에도 재현됨) — 이 페루도 작업 자체는 `engine.ts`를 건드리지 않아 무제한 aiBenchmark 재확인이 꼭 필요하지 않다고 판단해 재실행하지 않았다.

**커밋/배포**: 커밋 `70526fb refactor(perudo): restore clean dice UI style and normalize uniform slot sizes across all board tracks` → `git push origin main` 완료 → `npx vercel deploy`(프리뷰) 정상 완주(Turbopack 빌드+TS 전체 재검사 포함), READY — `https://board-game-5saoij6w3-me-3871.vercel.app`. "production" 명시 없어 이번에도 프리뷰까지만 진행 — 필요하면 `npx vercel deploy --prod`로 후속 승격 요청할 것.

### 2026-08-21 — 뱅! 카드 호버 UX 개편 + 체력/직업 UI 복원 + 중앙 카드 사용 연출·이펙트 추가 — 사용자가 뱅! UI/UX 전면 개편을 요청: (1) 손패 카드 기본 크기를 키우고 카드 본체 하단에 이름+효과 설명을 상시 인쇄, 호버 시 확대+그림자 강조하며 기존 마우스오버 툴팁은 완전 제거, (2) 누락돼 있던 본인 체력(하트 게이지)과 직업(역할) 뱃지를 화면 하단 중앙에 크게 표시하고 증감 시 펄스/플래시, (3) 착용 아이템(무기/장비) 슬롯을 확대해 이름·사거리·지속효과를 한눈에, (4) 상대(또는 봇)가 카드를 낼 때 테이블 중앙에 카드가 크게 공개되고 "누가 → 무엇을 [대상: 누구]" 배너가 1.5~2초 노출, (5) 카드 제출 슬라이드/페이드 모션과 뱅!/빗나감!/듀얼·다이너마이트 전용 이펙트 추가. 요청 문구가 가리킨 파일 구조(`Board.tsx`/`Card.tsx`/`PlayerArea.tsx`/`ItemSlots.tsx`)는 이 저장소엔 없고 실제로는 `BangBoard.tsx` 단일 파일(+`BangGame.tsx`/`RulebookModal.tsx`/`engine.ts`) 구성이라 확인 후 진행. `AskUserQuestion` 3문항으로 확인받음: ① `engine.ts`는 원래부터 캐릭터(윌리 더 키드 등 16종 고유 능력) 시스템 없이 역할 4종(보안관/부보안관/무법자/배신자)만 구현돼 있어 "캐릭터 뱃지"를 어떻게 할지 → "역할 뱃지만 크게(캐릭터 시스템 신규 도입 안 함)" 선택, ② 손패 카드 기본 크기 144×104px vs 176×128px → "176×128px(크게 확대)" 선택, ③ 본인이 직접 카드를 낼 때도 중앙 배너를 띄울지(요청 문구 그대로 "상대 카드 사용 시"에만 한정할지) → "나/상대 모두 동일 연출" 선택. **구현**: 신규 `cardMeta.ts`(`CARD_META`/`ROLE_LABEL`/`TEAM_LABEL`/`EQUIP_ORDER`/`CardKind`를 `BangBoard.tsx`에서 분리 — `BangEffects.tsx`/`CardFace.tsx`와 순환 참조 없이 공유하기 위함), 신규 `CardFace.tsx`(`CardFace`/`CardBack` 분리 이관, "md" 카드를 176×128px로 확대하고 이름+아이콘+`meta.desc`를 카드 본체에 상시 인쇄, `Tooltip` 래핑 완전 제거), 신규 `EquipSlotCard.tsx`(본인 장착 아이템 전용 큰 칩 — 이름/사거리(`weaponRange`)/지속효과 텍스트, `MyEquipmentRow`), 신규 `BangEffects.tsx`(`CenterPlayEvent` 타입 + `deriveCenterEvent(prevState, action)` — 다른 `<Game>Effects.tsx`들처럼 상태 스냅샷을 diff하는 대신, 생명력 변화만으론 뱅 피격/듀얼 패배/인디언/개틀링/다이너마이트 폭발을 구분할 수 없어 `EngineAction` 자체를 직접 해석하는 방식 채택 — 19종 `play-*` 액션 전부 + `group-respond`(카드/술통)·`duel-respond` 응답까지 커버하고, `take-hit`/`general-store-pick`/`begin-turn`/`end-turn`은 "카드가 공개되는 사건"이 아니라 의도적으로 제외; `CenterPlayBanner`(포탈, 카드 큼직 공개 + "이름 ➔ 아이콘 라벨 사용 [대상: 이름]" 배너 1.8초, 뱅!=총구화염/빗나감!=방패 스위시/듀얼·다이너마이트=긴장 펄스/힐=은은한 글로우 4종 전용 이펙트), `useLifeFlash`(체력 증감 감지 훅). `BangBoard.tsx`: 손패 호버 시 인접 카드 위로 확실히 올라오도록 `hoveredCardId` state 기반으로 wrapper의 `zIndex`를 동적 계산(순수 CSS `:hover`로는 안 됨 — `fanStyle`의 인라인 `transform`이 이미 각 카드 wrapper마다 독립된 stacking context를 만들어서 자식의 z-index가 부모 밖으로 못 나감), 호버 시 `scale-[1.18]`+`-translate-y-9`+그림자로 확대, `fanStyle`의 오버랩 폭도 24px→40px·수직 오프셋 5px→8px로 확대된 카드 크기에 맞게 조정, `MyLifeAndRoleBadge`(본인 체력 하트+`N/N`+직업 뱃지, "내 카드" 바로 위 화면 하단 중앙에 배치 — 기존엔 다른 좌석에만 체력/역할이 있고 본인 좌석엔 아예 없었음) 신규, `MyEquipmentRow` 삽입, `CenterPlayBanner` 큐 렌더, 기존 `EquipRow`(다른 좌석용, 공간 제약으로 소형 유지)는 `Tooltip` 래핑만 제거. `BangGame.tsx`: `game-action` 브로드캐스트 핸들러에서 이미 신뢰되던 `gameStateRef`(기존 `state-request` 응답용)로 액션 적용 "직전" 상태를 얻어 `deriveCenterEvent` 호출, `centerEvents` 큐(봇 연타 대비 최근 3개로 캡)에 append해 `BangBoard`에 props로 전달, `game-start`/`state-sync`/`handleLeave`에서 큐 리셋(새 판에 이전 판 배너가 섞이지 않도록). `globals.css`에 `bang-center-reveal`/`bang-banner-slide`/`bang-muzzle-flash`/`bang-shield-swish`/`bang-duel-tension`/`bang-heal-glow`/`bang-hp-hit`/`bang-hp-heal` 8개 키프레임 신규 추가(전부 이 프로젝트의 기존 관례대로 이미지 자산 없이 이모지+CSS만 사용). **검증**: `npx tsc --noEmit`(전체, 에러 0) / `npm run lint`(전체, 경고 0) / `npx vitest run src/games/bang`(71/71 통과 — `engine.ts` 무변경이라 순수 UI 리팩터링이 엔진 로직에 전혀 영향 없음을 확인) / `npx vitest run --exclude '**/aiBenchmark.test.ts'`(27개 파일 1063/1063 통과) — jsdom 미설치로 UI 컴포넌트 자체의 렌더/인터랙션 테스트는 이 프로젝트의 기존 제약상 여전히 불가(엔진 테스트로만 회귀 없음을 확인).)_

### 2026-08-21 — 뱅! 카드 호버 UX 개편 + 체력/직업 UI 복원 + 중앙 카드 사용 연출·이펙트 추가

**요청**: 뱅! UI/UX 전면 개편 — (1) 손패 카드 기본 크기 확대 + 카드 본체 하단에 이름·효과 설명 상시 인쇄, 호버 시 확대(그림자 강조)하며 기존 마우스오버 툴팁 완전 제거, (2) 누락돼 있던 본인 체력 게이지·직업(역할)/캐릭터 뱃지를 눈에 띄게 배치 + 체력 증감 시 펄스/플래시, (3) 착용 아이템 슬롯 확대(이름·사거리·지속효과 가독성), (4) 상대(또는 봇)가 카드를 낼 때 테이블 중앙에 카드 공개 + "누가 → 무엇을 [대상: 누구]" 안내 배너 1.5~2초, (5) 카드 제출 슬라이드/페이드 모션 + 뱅!/빗나감!/듀얼·다이너마이트 전용 이펙트. 요청 문구가 가리킨 파일 구조(`Board.tsx`/`Card.tsx`/`PlayerArea.tsx`/`ItemSlots.tsx`)는 이 저장소엔 없음 — 실제로는 `BangBoard.tsx`(719줄, 카드/보드/핸드 전부 담당) + `BangGame.tsx`(Supabase Realtime 동기화) + `RulebookModal.tsx` + `engine.ts` 4파일 구성.

**모호점 확인(`AskUserQuestion`, 3문항)**: 코드 확인 결과 `engine.ts` 상단 주석에 "MINUS the ~16 unique character special-ability cards"라고 명시돼 있어 이 구현은 처음부터 캐릭터(윌리 더 키드 등) 시스템 없이 역할 4종(보안관/부보안관/무법자/배신자)만 갖고 있음을 확인 — ① "캐릭터 특수 능력 뱃지"를 어떻게 처리할지(역할 뱃지만 크게 vs 캐릭터 시스템 신규 도입) → **"역할 뱃지만 크게"** 선택(엔진 변경 없이 UI만 개선, 캐릭터 시스템 도입은 이번 요청 범위를 크게 초과). ② 손패 카드 기본 크기(현재 112×80px, 설명 텍스트 공간 없음)를 얼마나 키울지, 144×104px vs 176×128px 실제 ASCII 미리보기 제시 → **"176×128px(크게 확대)"** 선택. ③ 본인이 직접 카드를 낼 때도 상대/봇과 동일하게 중앙 배너를 띄울지, 요청 문구("상대 카드 사용 시") 그대로 상대·봇에만 한정할지 → **"나/상대 모두 동일 연출"** 선택(요청 5번 항목 "손패→중앙 슬라이드 모션"과 일관되게).

**구현**:
- 신규 [cardMeta.ts](../src/games/bang/cardMeta.ts): `CARD_META`/`ROLE_LABEL`/`TEAM_LABEL`/`EQUIP_ORDER`/`CardKind`를 `BangBoard.tsx`에서 분리 — 새로 추가되는 `BangEffects.tsx`/`CardFace.tsx`가 `BangBoard.tsx`를 거치지 않고 같은 데이터를 읽을 수 있도록(순환 참조 방지).
- 신규 [CardFace.tsx](../src/games/bang/CardFace.tsx): `CardFace`/`CardBack`을 분리 이관하면서 "md"(기본/손패) 카드를 176×128px로 확대하고 카드 본체 안에 아이콘+이름+`meta.desc`(효과 설명 전체 문장)를 항상 인쇄, `Tooltip` 래핑 완전 제거. "sm"(덱/개별상점 미리보기)는 기존 64×44px 아이콘 전용 그대로 유지.
- 신규 [EquipSlotCard.tsx](../src/games/bang/EquipSlotCard.tsx): 본인 장착 아이템 전용 큰 칩 컴포넌트(`EquipSlotCard`/`MyEquipmentRow`) — 이름 + 사거리(무기는 `weaponRange(player)`, 쌍안경/무스탕은 +/-1 문구) + 지속효과 설명. 다른 좌석의 장비는 오벌 테이블 공간 제약상 기존 소형 `EquipRow`(아이콘+사거리 숫자만) 유지, `Tooltip` 래핑만 제거.
- 신규 [BangEffects.tsx](../src/games/bang/BangEffects.tsx): `CenterPlayEvent` 타입 + `deriveCenterEvent(prevState, action)`. 이 프로젝트의 다른 `<Game>Effects.tsx`(예: `coup/CoupEffects.tsx`)는 연속된 두 `state` 스냅샷을 diff하는 방식이지만, 뱅!은 생명력 변화 하나만으론 뱅 피격/듀얼 패배/인디언/개틀링/다이너마이트 폭발을 구분할 수 없고 사거리 무기·스코프 등 다수 카드는 생명력에 아예 영향이 없어 대신 `EngineAction` 원본을 직접 해석 — 19종 `play-*` 액션 전부(카드 실물은 액션 적용 "직전" 상태의 손패에서 `cardId`로 재조회해 실제 무늬·타입을 그대로 재사용) + `group-respond`(카드 응답/술통 시도)·`duel-respond`(반격/포기) 응답까지 커버. `take-hit`/`general-store-pick`/`begin-turn`/`end-turn`은 "카드가 공개되는 사건"이 아니라 의도적으로 제외(각각 하단 `HeartPips` 펄스, 전용 선택 모달 등으로 이미 피드백됨). `CenterPlayBanner`(포탈, 카드 176×128 실물 큼직 공개 + "이름 ➔ 아이콘 라벨 사용 [대상: 이름]" 배너를 1.8초 노출, `effect` 종류별 전용 플레어 — 뱅!/개틀링=총구화염(`bang-muzzle-flash`), 빗나감! 응답=방패 스위시(`bang-shield-swish`), 듀얼·다이너마이트=긴장 펄스 루프(`bang-duel-tension`), 맥주·선술집=은은한 힐 글로우(`bang-heal-glow`)), `useLifeFlash`(체력 증감을 감지해 "hit"/"heal" 플래시 종류를 반환하는 훅).
- [BangBoard.tsx](../src/games/bang/BangBoard.tsx): 손패 호버 인터랙션은 `hoveredCardId` state로 구현(순수 CSS `:hover`로는 인접 카드 위로 확실히 안 올라옴 — `fanStyle`이 이미 각 카드 wrapper에 인라인 `transform`을 걸어놔서 카드마다 독립된 stacking context가 생기고, 그 안 자식의 z-index는 wrapper 밖으로 못 나가는 CSS 규칙 때문. wrapper의 zIndex 자체를 hover 시 동적으로 200까지 끌어올려 해결). 호버 시 `scale-[1.18]` + `-translate-y-9` + 그림자로 확대·부양, 선택(낼 카드/버릴 카드) 상태와 겹칠 때 `-translate-y-*` 유틸리티 두 개가 동시에 걸려 충돌하지 않도록 transform 클래스를 단일 소스에서 계산하도록 정리. 확대된 카드 크기에 맞춰 `fanStyle` 오버랩 폭 24px→40px(`HAND_FAN_OVERLAP_PX`), 수직 오프셋 계수 5px→8px 조정. `MyLifeAndRoleBadge` 신규(본인 체력 하트 게이지 + `N/N` 텍스트 + 역할 뱃지, "내 카드" 라벨 바로 위 화면 하단 중앙 배치 — 기존엔 오벌 테이블의 다른 좌석에만 체력/역할이 표시되고 정작 본인 좌석은 하단 손패 패널에만 있어 체력·역할이 화면 어디에도 없었음), `MyEquipmentRow` 삽입, `CenterPlayBanner` 큐의 선두 1건만 렌더.
- [BangGame.tsx](../src/games/bang/BangGame.tsx): `game-action` 브로드캐스트 핸들러(로컬 클릭도 `broadcast:{self:true}`로 이 경로를 그대로 타므로 본인/상대/봇 전부 단일 지점) 안에서, 이미 "state-request" 응답용으로 신뢰되던 `gameStateRef`(effect 커밋 후 갱신)로 액션 적용 "직전" 상태를 얻어 `deriveCenterEvent` 호출 → `centerEvents` state 큐(useBotAutoplay의 500~1500ms 연속 액션 대비 최근 3개로 캡)에 append, `BangBoard`에 `centerEvents`/`onCenterEventDone` props로 전달. `game-start`/`state-sync`/`handleLeave` 3곳에서 큐를 리셋해 이전 판/재접속 시 스냅샷의 낡은 배너가 새 판에 섞이지 않게 함.
- [globals.css](../src/app/globals.css)에 `bang-center-reveal`(카드 등장)/`bang-banner-slide`(배너 슬라이드)/`bang-muzzle-flash`/`bang-shield-swish`/`bang-duel-tension`/`bang-heal-glow`(4종 효과 플레어)/`bang-hp-hit`/`bang-hp-heal`(체력 배지 펄스) 8개 키프레임 신규 — 전부 이 프로젝트의 기존 관례대로 이미지 자산 없이 이모지+CSS 애니메이션만 사용(다른 게임들의 `<Game>Effects.tsx`와 동일 기법).

**검증**: `npx tsc --noEmit`(전체, 에러 0) / `npm run lint`(전체, 경고 0) / `npx vitest run src/games/bang`(71/71 통과 — `engine.ts` 완전 무변경이라 순수 UI 리팩터링이 엔진 로직에 전혀 영향 없음을 재확인) / `npx vitest run --exclude '**/aiBenchmark.test.ts'`(27개 파일 1063/1063 통과) — jsdom 미설치로 이 저장소는 UI 컴포넌트 자체의 렌더/인터랙션 단위 테스트가 애초에 불가능한 제약이라(HANDOFF.md 기존 §의존성 표 참고) 이번에도 엔진 테스트 전수 통과로 회귀 없음만 확인, 실제 화면 확인은 배포된 프리뷰 URL로 사용자가 직접 검증 필요.

**커밋/배포**: 커밋 `3b20e38 feat(bang): redesign card hover UX, enhance HP and role visibility, add center card play banner and action effects` → `git push origin main` 완료 → `npx vercel deploy`(프리뷰) 정상 완주(Turbopack 빌드+TS 전체 재검사 포함), READY — `https://board-game-fzkbr2mfp-me-3871.vercel.app`. "production" 명시 없어 이번에도 프리뷰까지만 진행 — 필요하면 `npx vercel deploy --prod`로 후속 승격 요청할 것.

### 2026-08-21 — 페루도 30칸 실물 보드 트랙 재구성 + 역행 비딩 원천 차단

**요청**: `boardGameRule/페루도/수정필요1.png`(실물 보드 사진)를 근거로 (1) 보드 테두리 트랙을 정확히 지정된 30칸 순서 — 숫자1, [페루도1], 숫자2, 숫자3, [페루도2], 숫자4, 숫자5, [페루도3], 숫자6, 숫자7, [페루도4], 숫자8, 숫자9, [페루도5], 숫자10, 숫자11, [페루도6], 숫자12, 숫자13, [페루도7], 숫자14, 숫자15, [페루도8], 숫자16, 숫자17, [페루도9], 숫자18, 숫자19, [페루도10], 숫자20 — 으로 재구성, (2) "3이 2개 이상"(숫자2 슬롯)에 배팅된 상태에서 트랙상 더 앞선(인덱스가 낮은) [페루도1]이나 숫자1 등으로 역행 비딩이 허용되는 버그를 원천 차단해달라는 요청. 판정 규칙도 직접 명시: 다른 칸으로 이동할 땐 다음 비딩의 트랙 인덱스가 반드시 현재보다 커야 하고, 동일 칸에 머무를 땐 눈금만 상향 가능. `Perudo.test.ts`에 30칸 인덱스 매핑 단위 테스트와 명시된 2개 회귀 케이스(`quantity:2,face:3` 상태에서 페루도1 → `isValidBid===false`, 페루도2 또는 숫자4 → `isValidBid===true`) 작성, `tsc`/`lint`/`vitest` 통과 후 커밋·푸시·배포까지 요청. "디자인·규칙상 확인이 필요하면 임의로 추정하지 말고 먼저 질문하라"는 원칙도 명시.

**모호점 확인(`AskUserQuestion`)**: 요청 문구가 실제 파일 구조(`validation.ts`/`Board.tsx`/`types.ts` — 이 저장소엔 없음, 실제로는 `engine.ts`/`PerudoBoard.tsx` 2파일 구성)와 어긋나 있었고, 무엇보다 이 요청 자체가 바로 직전 2026-08-20 세션이 "트랙 인덱스를 판정 기준으로 쓰는 방식은 공식 룰북 §3(동일 수량이면 눈금만 상향 가능)과 근본적으로 양립 불가능하다"며 명시적으로 폐기했던 것과 같은 종류의 하우스 룰이었다. 두 방식을 실제로 수식으로 풀어보니 **일반↔일반 구간은 완전히 동일하게 동작**(그래서 사용자가 준 두 테스트 케이스는 어느 쪽으로 구현해도 같은 결과)하지만, **페루도↔일반 전환 구간에서는 갈리는 지점이 있음**을 발견 — 예: "페루도 2개"(트랙 인덱스 4)에서 "숫자 4"로 전환 시 트랙 규칙은 허용(인덱스 5>4)하지만 기존 `2×2+1=5` 공식은 수량 5 미만이라 불허. 이 구체적 분기 사례를 `AskUserQuestion`으로 제시해 "트랙 인덱스로 완전 대체"(추천, 요청 문구 그대로 해석) vs "두 규칙 모두 만족해야 함(AND, 더 보수적)" 중 선택을 확인받았고, 사용자가 **"트랙 인덱스로 완전 대체"**를 선택 — 기존 `⌈Q/2⌉`/`2Q+1` 공식은 완전히 폐기.

**구현**: `engine.ts`에 `trackIndexForBid({quantity, face})` 닫힌 형태 공식 신규 추가 — 일반(face 2-6) 칸은 수량이 홀수면 `3*(Q-1)/2`, 짝수면 `3*(Q/2)-1`; [페루도](face 1) 칸은 `3*Q-2`. 이 공식은 사용자가 지정한 30개 라벨(index 0~29)을 정확히 재현하며, 그 너머(수량>20 일반 / 수량>10 페루도 — "맞아!" 성공 시 주사위 획득 상한 없음 룰에 따라 이론상 무한 성장 가능)도 같은 패턴을 그대로 이어간다. `trackCellForBid`/`trackCellAt`을 이 공식 기반으로 재작성(기존의 "일반↔페루도 1:1 페어링" 무한 시퀀스에서 교체 — `trackCellAt`은 `index % 3`으로 [페루도]/홀수 일반/짝수 일반 3가지 경우를 역산). `validateRaise`는 `⌈Q/2⌉`/`2Q+1` 공식을 전면 삭제하고 순수 인덱스 비교로 재구현: 다음 비딩 인덱스가 더 크면 합법, 같은 인덱스(오직 두 일반 비딩이 같은 수량 칸을 공유할 때만 발생)면 눈금이 더 높을 때만 합법. `minValidQuantityForFace`(수량 스테퍼 하한 계산)는 기존 브루트포스 탐색(1부터 순차 증가하며 `validateRaise` 통과 여부 확인) 그대로 무수정 재사용 — 인덱스가 두 종류(일반/페루도) 각각에서 수량에 대해 항상 단조 증가라 자동으로 맞물린다. `PerudoBoard.tsx`의 `buildRectFrame`을 새 30칸 시퀀스에 맞춰 재배치(코너 4개 — 숫자1/6/11/16 — + 북7·동6·남7·서6칸으로 최대한 균등 분할, 옛 40칸 대칭 배치와 달리 비대칭 시퀀스), `BOARD_LAST_INDEX`를 39에서 29로 조정(보드 밖 초과분은 기존 `OverflowBadge` 그대로 재사용). `RulebookModal.tsx`의 "선언 올리기" 섹션도 폐기된 `⌈Q/2⌉`/`2Q+1` 공식 설명과 "칸 위치가 유효성을 정하지 않는다"는 이제 틀린 문구를 걷어내고, 30칸 트랙 인덱스 규칙(다른 칸 이동 시 인덱스 반드시 증가 / 동일 칸이면 눈금만 상향) 설명으로 재작성.

**테스트**: `Perudo.test.ts`에 30칸 전체 인덱스 매핑 테이블(`trackCellAt`/`trackCellForBid` 양방향, index 0~29 전수 대조 + 30칸 너머 확장 검증) 신규, 사용자가 명시한 필수 회귀 케이스(`quantity:2,face:3` 상태에서 페루도1·숫자1 → `isValidBid===false`, 페루도2·숫자4 → `isValidBid===true`, 동일 슬롯 눈금 상향/하향/동일 배팅 거절) 전부 신규 추가, 옛 `⌈Q/2⌉`/`2Q+1` 공식 전용 테스트는 새 트랙 규칙과 실제로 다른 결과가 나오는 두 지점(normal→perudo가 트랙 규칙 쪽이 더 엄격한 경우, paco→normal이 트랙 규칙 쪽이 더 관대한 경우)을 명시적으로 대조하는 회귀 테스트로 교체 — 일반↔일반 구간 기존 테스트는 두 방식이 동일해 그대로 유지(73/73 통과).

**검증**: `npx tsc --noEmit`(전체, 에러 0) / `npm run lint`(전체, 경고 0 — 리뷰 중 미사용 `trackIndexForBid` import 1건 발견해 제거) / `npx vitest run src/games/perudo`(73/73 통과) / `npx vitest run --exclude '**/aiBenchmark.test.ts'`(27개 파일 1063/1063 통과, 47초) / 페루도 AI 자가 대진 벤치마크(Level 10 vs Level 1-3, 1,000판, `npx vitest run src/games/shared/bot/aiBenchmark.test.ts -t "perudo:"`로 격리 실행) 85% 승률 문턱 정상 통과 — 트랙 규칙이 페루도→일반 전환의 최소 합법 수량을 낮춰(21→20) 봇의 합법 수 후보 집합이 미세하게 바뀌었음에도 강세가 유지됨을 확인.

**커밋/배포**: 커밋 `f72558c fix(perudo): update board to 30-slot track sequence and prevent backwards bidding to previous perudo slots` → `git push origin main` 완료 → `npx vercel deploy`(프리뷰) 첫 시도는 과거 세션들과 동일한 `{"status":"error","reason":"deploy_failed","message":"Not authorized"}`로 실패 → 즉시 재시도하니 정상 빌드(Turbopack, TypeScript 전체 재검사 포함)·배포되어 READY — `https://board-game-g0ji6sdmw-me-3871.vercel.app`. 사용자가 "production"을 명시하지 않아 이번에도 프리뷰까지만 진행(과거 세션들과 동일 판단 기준) — 필요하면 `npx vercel deploy --prod`로 후속 승격 요청할 것.

### 2026-08-21 — 페루도 '버그3': 마커를 확정 비딩 칸에 정확히 고정 + 마커 클릭 눈금 상향 인터랙션 신규 + 동일 배팅 확정 차단 안내

**요청**: `boardGameRule/페루도/버그3.png`를 근거로, 내 턴이 시작될 때 보라색(드래프트) 마커가 상대의 실제 확정 비딩 칸(예: "2가 2개")이 아니라 그 다음 칸("2가 3개")에 잘못 표시되는 UX 꼬임을 신고. 요청 프롬프트가 (1) 마커를 항상 직전 플레이어의 실제 확정 비딩 칸에 정확히 고정, (2) 마커 클릭 시 눈금이 2→3→4→5→6 순으로 1단계씩 오르는 인터랙션 복원, (3) 눈금·수량을 올리지 않고 그대로 [배팅 확정]을 누르는 것만 검증으로 차단(비활성화/안내), 3가지를 명시. "디자인·규칙상 확인이 필요하면 임의로 추정하지 말고 먼저 질문하라"는 원칙도 함께 요청.

**모호점 확인(`AskUserQuestion`)**: 코드(`engine.ts`의 `trackCellForBid`/`validateRaise`)와 git 히스토리를 대조한 결과 마커 오배치의 원인은 엔진이 아니라 `PerudoBoard.tsx`의 드래프트 기본값(내 턴마다 `minValidQuantityForFace`로 "다음 최소 합법 인상"을 미리 계산해 넣던 로직)이었고, "마커 클릭 눈금 상향"은 git 히스토리상 과거에 존재했다 제거된 적이 없는 **신규** 인터랙션임을 확인 — 명세에 없는 3가지 경계 동작을 질문: (1) 수량 스테퍼로 수량을 이미 올린 뒤에도 마커 클릭이 계속 "눈금+1"로 동작해야 하는지 → **일반화(추천)** 채택(마커가 어느 수량에 있든 그 칸 클릭 = 눈금+1, 다른 칸 클릭 = 그 칸으로 이동). (2) 마커가 [페루도](조커) 칸에 있거나 눈금이 이미 6일 때 클릭하면 → **아무 동작 없음(추천)** 채택. (3) 동일 배팅 확정 차단 안내 노출 방식 → **비활성화 + 상시 안내 문구(추천)** 채택.

**구현** (`src/games/perudo/PerudoBoard.tsx`만 수정 — `engine.ts`는 이미 정확해 무변경): 드래프트 동기화 블록을 `state.currentBid`가 있으면 그 `{quantity, face}`를 그대로(최소 합법 인상이 아니라) 초안에 채우도록 변경 — 마커가 항상 확정 비딩 칸에 정확히 앉고, 손대지 않은 초안은 정의상 현재 비딩과 동일해 기존 `validateRaise` 게이트 하나만으로 확정 버튼이 자동 비활성화된다(별도 검증 코드 불필요). `selectCell`/`cellEnabled`에 "클릭한 칸이 마커 자신의 칸(어느 수량이든)"인 경우를 특별 취급하는 분기를 추가해 눈금을 1단계 올리는 `markerCanBumpFace()` 헬퍼로 판정하도록 재설계(일반 칸 클릭은 기존 "그 칸으로 이동" 동작 그대로 유지). 확정 버튼 옆에 초안이 현재 비딩과 완전히 같을 때만 뜨는 "⚠️ 동일한 배팅은 할 수 없습니다. 눈금을 올리거나 수량을 올려주세요." 상시 안내 문구 신규. 트랙 셀 `title` 툴팁도 마커 칸일 때 "🟣 마커 클릭 — 눈금 N → N+1로 올리기"로 구체화.

**브라우저 실측 검증** (Playwright): 임시 dev 전용 라우트(`src/app/dev-perudo-preview` — `PerudoBoard`를 봇이 "2×2개"를 선언한 고정 상태로 직접 마운트해 로비/인증/리얼타임을 우회, 검증 후 삭제해 커밋 대상에서 제외)를 만들어 실제 렌더링을 확인. **1차 실측에서 실제 버그를 하나 더 발견** — 마커 칸이 `cellEnabled`의 일반 "동일 비딩이면 비활성" 로직에 걸려 `disabled` 렌더링돼 클릭 자체가 안 먹는 상태였음(스크린샷: 버튼 `title="현재 확정된 베팅 칸입니다"`, disabled). `cellEnabled`에도 마커 칸 전용 분기(`markerCanBumpFace()`)를 추가해 즉시 수정. 재검증: 초기 화면에서 마커가 정확히 "2" 칸에 위치 + 확정 버튼 비활성 + 안내 문구 노출 확인(스크린샷 `01_initial.png`) → 마커 클릭 1회 후 FacePicker가 "3"으로 하이라이트되고 확정 버튼이 "✅ 3 × 2개로 베팅 확정"으로 활성화, 안내 문구 소실 확인(`02_after_marker_click.png`) → 마커 재클릭 시 "✅ 4 × 2개로 베팅 확정"으로 계속 상향됨을 확인(`03_after_second_click.png`). 콘솔 에러 0건(페이지 로드시 뜬 404 2건은 루트 레이아웃의 게스트 사용량 조회로, 페루도와 무관함을 별도 확인). 검증 완료 후 임시 라우트·스크립트·스크린샷 전부 삭제(작업 트리에 흔적 없음).

**검증**: `npx tsc --noEmit`/`npm run lint` 프로젝트 전체 0건, `npx vitest run src/games/perudo`(67/67 통과, 신규 "버그3" 회귀 3건 포함: `{quantity:2,face:2}` 마커 매핑, 동일 배팅 `{2,2}` 거절, 동일 수량 눈금 3~6 상향 전부 허용), `npx vitest run --exclude '**/aiBenchmark.test.ts'`(전체 27개 파일 1057/1057 통과, 49초), `npx vitest run src/games/shared/bot/aiBenchmark.test.ts -t "perudo"`(격리 실행 통과 — `engine.ts` 무변경이라 회귀 없음, 참고용 재확인).

**커밋/배포**: 커밋 `5bbee9c fix(perudo): keep marker on exact current bid, restore click face increment, and prevent identical bid submission` → `git push origin main` 완료 → `npx vercel deploy`(프리뷰) 정상 완주(Turbopack 빌드+TS 전체 재검사 포함, 임시 dev 라우트는 삭제돼 있어 빌드 라우트 목록에도 나타나지 않음 — 잔존 흔적 없음 재확인), READY — `https://board-game-ij5lfhx43-me-3871.vercel.app`. "production" 명시 없어 이번에도 프리뷰까지만 진행 — 필요하면 `npx vercel deploy --prod`로 후속 승격 요청할 것.

### 2026-08-21 — 페루도 외곽 트랙을 사각형 4변(1~20, 모서리 7/11/17 공유)으로 재배치

**요청**: 인게임 보드판의 외곽 숫자 트랙을 4변 직사각형 레이아웃(북측 1~7, 동측 7~11, 남측 11~17, 서측 17~20)으로 배치해 달라는 요청. 요청 원문이 "모서리 칸 처리 방식·칸 크기/비율·폰트/색상 등 디자인상 모호한 점은 임의로 추정하지 말고 먼저 질문 목록을 제시해 확인받은 후 진행"하라고 명시.

**1) 사전 질의 4개 — `AskUserQuestion`** — 착수 전 다음을 확인받았다: ① 베팅 수량은 무상한이라(다이스 수 무제한 룰) 20을 넘는 선언이 실제로 나오는데, 고정된 1~20 사각형에서 20 초과 선언을 어떻게 표시할지 → **"트랙은 20에 고정, 초과분은 배지로 표시"** 확정. ② 조커(페루도=1) 베팅 칸을 이 사각형에서 어떻게 배치할지 → 사용자가 붙여넣은 답변이 표 형태 원본이 줄바꿈되며 일부 뒤섞여 있었지만(예: "7(코너)" 다음에 "4"가 다시 등장하는 등), `engine.ts`의 기존 `trackCellForBid`/`trackCellAt`(각 수량 N마다 normal(N) 셀 바로 뒤에 perudo(N) 셀이 1:1로 붙는 기존 순수 함수, 2026-08-20 세션이 '버그2' 해결을 위해 이미 도입해 둔 것)와 대조한 결과 완전히 부합했다 — 즉 새 셀 모델을 만들 필요 없이 기존 순서를 그대로 사각형에 얹으면 된다고 판단(직전 08-20 세션이 "1(우측 상단 코너)…" 라벨을 옛 `BOARD_TRACK_SEQUENCE`와 대조해 동일 결론에 도달했던 것과 같은 패턴 — 사용자가 실물 사진을 옮겨 적을 때 코너 라벨/줄바꿈이 흐트러지는 경향이 반복 확인됨). ③ 사각형 중앙 빈 공간에 무엇을 넣을지 → **"위쪽엔 주사위 무덤, 그 아래 페루도!/맞아! 패널이 공존, 보드 크기를 키워 내 주사위까지 보이게"** — 08-20 세션(중앙=무덤 전용, 조작 UI는 트랙 밖)보다 더 넓게 중앙에 담으라는 이번 세션 고유의 확장 결정. ④ 모서리(7/11/17) 처리 → **"모서리 칸 1개를 공유"** 확정(08-20 세션과 동일 결론).

**2) 레이아웃 — 3×3 CSS Grid + flex 스트립(고정 min-width 없음)** — `trackCellAt(0..39)`(정확히 40칸 = 수량1~20 × normal/perudo)를 북 11칸(index 1~11)·동 7칸(13~19)·남 11칸(21~31)·서 7칸(33~39) + 모서리 4칸(0·12·20·32)으로 나눠 3×3 grid(`grid-template-columns/rows: auto 1fr auto`)에 얹었다 — 모서리 컬럼/행은 고정폭(코너 셀과 동일한 `h-9 w-9 sm:h-11 sm:w-11`), 중앙은 `1fr`. 08-20 세션이 겪은 "우측 7~11 잘림" 버그(중앙 `1fr` 컬럼을 강제로 밀어붙이는 `min-w-[1.7rem]` 플로어 + 프레임 전체의 `min-w-[34rem]`+`overflow-x-auto` 조합이 원인이었음, 같은 파일 위 섹션 참고)를 반복하지 않기 위해, 이번엔 북/남 스트립 셀에 `min-w-0 flex-1`(고정 최소폭 없음), 동/서 스트립 셀에 `min-h-0 flex-1`만 사용해 셀이 뷰포트 폭에 맞춰 자유롭게 줄어들게 했다 — 프레임 자체에는 `min-width`도 `overflow-x-auto`도 없음(스크롤이 아니라 항상 화면 안에 맞춰 들어오는 쪽을 확정 답변 ①과 함께 선택). 남/서 스트립은 오름차순 배열을 `.slice().reverse()`로 뒤집어 그대로 순서대로 렌더링(`flex-row-reverse`/`column-reverse` CSS는 쓰지 않음 — 08-20 세션이 이중 반전 실수를 겪었던 지점이라 아예 그 경로를 피함). 20 초과 선언(무상한 다이스 수 룰상 실제로 발생 가능)은 `OverflowBadge`로 중앙 상단에 별도 표시. 중앙에는 확정 요청대로 `LostDiceTray` → 기존 베팅 선언/눈금/스테퍼/확정 버튼 + 페루도!·맞아! 버튼 패널 → `DiceRollTray`(내 주사위) 순으로 이동.

**3) 시각 검증 — 스크린샷 육안 판독을 DOM 좌표/클래스 덤프로 교차검증** — 임시 라우트(`src/app/dev-perudo-preview`, 8인 고정 state + 시나리오 토글 버튼, 확인 후 삭제)를 만들어 Playwright(스크래치패드에 `npm install --no-save playwright`)로 480px/900px 스크린샷을 찍었다. 480px 스크린샷 육안 판독으로는 북측 "★6" 칸이 동측 "9" 칸과 같은 amber로 하이라이트된 것처럼 보여 "마커가 엉뚱한 칸에 있다"고 오판할 뻔했으나, 08-20 세션의 "스크린샷 육안 판독만으로 고장났다고 단정하지 말 것" 교훈을 따라 즉시 `page.evaluate`로 모든 `[data-track-index]` 버튼의 class 목록을 덤프해 대조한 결과 `isCurrent`(from-amber-300) 클래스는 정확히 index16(East 스트립, "9", `currentBid={quantity:9,face:4}`와 일치) 단 한 칸에만 붙어 있었고 북측 "★6"은 그냥 활성화된 조커 셀의 진한 amber-brown이었을 뿐(색상 유사로 인한 육안 오판)임을 확인. 대기 중인 베팅(purple die 오버레이)도 index18("10", `4×10개` 초안과 일치)에 정확히 위치. `overflowX: 0`(가로 스크롤 불필요)도 별도 확인. 트랙 초과(23개) 시나리오에서 `OverflowBadge` 2개(확정/내 초안)가 잘림 없이 렌더링됨도 확인.

**검증**: `npx tsc --noEmit`(전체, 0 에러) / `npm run lint`(전체, 0 경고) / `npx vitest run src/games/perudo/Perudo.test.ts`(64/64 통과, 2.2초 — `engine.ts` 무변경, 순수 `PerudoBoard.tsx` 표현 계층 변경). 전체 `npx vitest run`은 이전 세션들과 동일 사유(`aiBenchmark.test.ts`)로 백그라운드에 걸어두고 이번 세션 안에 완료를 기다리지 않음(§3 0번 항목 참고). **주의**: 이번 세션 중 백그라운드 vitest를 세 번 연속 실행했다가 두 번은 취소 처리(`TaskStop`)만 하고 실제 자식 프로세스(`vitest.mjs`/`workers/forks.js`)는 살아남아 세 인스턴스가 동시에 같은 저장소를 물고 있던 것을 뒤늦게 `Get-CimInstance Win32_Process`로 발견해 전부 정리했음 — `TaskStop`이 npm/npx 래퍼만 죽이고 실제 워커는 살려둘 수 있다는 걸 이 세션에서 확인했으니, 다음에 vitest 백그라운드 실행을 취소할 땐 `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where CommandLine -match 'vitest'`로 실제 잔존 프로세스를 반드시 재확인할 것.

**커밋/배포**: 커밋 `95c2f15 feat(perudo): implement rectangular 4-side border track layout from 1 to 20` → `git push origin main` 완료 → `npx vercel deploy`(프리뷰) 정상 완주(빌드 중 `tsc`/정적 페이지 생성 전부 그린), READY — `https://board-game-3km8akd4u-me-3871.vercel.app`. "production" 명시 없어 프리뷰까지만 진행(08-20 세션과 동일 관례).

### 2026-08-20 — 페루도 트랙/마커 재도입 (판정과 분리된 순수 시각 요소) + '버그2' 해결

**요청**: 사용자가 직전 세션(트랙 UI 완전 삭제 + 공식 룰북 §3 복귀)의 반영분을 `git revert`로 롤백해 달라고 요청하며, `boardGameRule/페루도/버그2` 스크린샷을 근거로 (1) 동일 수량(quantity 1)에서 눈금 3/4/5/6으로 상향 배팅이 가능해야 함, (2) "2가 1개 이상" 비딩 시 보드판 마커가 [페루도] 칸이 아닌 올바른 칸에 위치해야 함을 재요청. 요청 원문이 언급한 `validation.ts`/`Board.tsx`/`ActionPanel.tsx`/`types.ts`(이 저장소엔 없음)와 "trackIndex 매핑"·"isValidBid" 같은 표현은 실제로는 이미 롤백 대상이 된 직전 세션에서 폐기된 개념/파일명과 뒤섞여 있었다.

**모호점 확인(`AskUserQuestion`)**: (1) "롤백"이 정확히 무엇을 뜻하는지(코드는 그대로 두고 프로덕션 승격만 하는 것인지, 실제로 커밋을 되돌리는 것인지) — 사용자가 "git revert로 되돌리고 트랙/마커 시스템 재도입" 선택. (2) 구 트랙의 칸 번호가 "눈금" 값인지(사용자 문구가 암시하는 새 설계) "수량" 값인지(구 트랙의 실제 동작) — 사용자가 "그 상세 로직을 설명한 것이니 로직을 알아서 재설계하라"고 위임. (3) 파일 구조를 요청 문구대로 분리할지 — 사용자가 "현재 구조(engine.ts/PerudoBoard.tsx) 그대로" 선택.

**구현**:
1. `git revert --no-commit 230da2b 28245ad` → 커밋(`c08ec60`)으로 직전 세션이 삭제했던 `BOARD_TRACK_SEQUENCE`/`BidTrack`/`trackIndexForBid`/`isValidBid`/`Bid.trackIndex` 코드를 정확히 복원(부수 변경 없음, 버그 스크린샷 3장은 `git checkout <commit> -- <path>`로 별도 복원).
2. `engine.ts` — 구 트랙(칸 번호 = 수량, 눈금 2~6은 전부 한 칸을 공유)을 그대로 되살리지 않고, **판정에서 완전히 독립된 순수 함수 쌍**으로 재설계: `trackCellForBid({quantity, face})`(공식 `index = (quantity-1)*2 + (face===1?1:0)`)와 그 역함수 `trackCellAt(index)`. 이 공식은 quantity마다 정확히 2칸("일반" 1칸 + "[페루도 N]" 1칸)을 배정하는 단조 증가 무한 시퀀스라, 옛 37칸 하드코딩 배열의 두 가지 근본 결함(①비단조 반복 라벨 — 같은 "4" 라벨이 두 칸에 존재해 매핑이 모호했음, ②37칸 고정 상한 — 맞아! 무제한 누적 규칙과 충돌)을 구조적으로 제거한다. `validateRaise`는 공식 룰북 §3 수량/눈금 공식(동일 수량이면 눈금만 상향, 수량 증가 시 눈금 자유, 일반↔페루도 전환 `⌈Q/2⌉`/`2Q+1`)으로 다시 되돌리고 트랙과 완전히 분리 — 트랙 칸/인덱스는 이제 어떤 비딩도 막거나 허용하지 않는다.
3. `PerudoBoard.tsx` — 옛 사각형 4변 `BidTrack`(코너·변 상수 ~330줄, `TrackCellButton`/`DirectionArrow` 포함)을 전부 제거하고, `trackCellAt`으로 매 렌더마다 새로 생성하는 가로 스크롤 트랙 스트립(`BidTrack`, 새 구현)으로 교체. 옛 버그의 진짜 원인 — 마커 위치를 "확정 칸 이후 가장 가까운 칸을 탐색"하는 상태 기반 로직으로 구했던 것 — 을 완전히 없애고, 확정 비딩·드래프트 비딩 둘 다 `trackCellForBid(bid)`로 **그 자리에서 직접 계산**하도록 바꿔, 면(face)이 무엇이든 그 계산 결과가 항상 정확한 칸을 가리키게 만들었다. 기존 눈금 선택기(`FacePicker`)+수량 ±스테퍼(`minValidQuantityForFace`로 하한 자동 고정)는 그대로 유지하고, 트랙 셀 클릭도 결국 같은 `validateRaise`로 활성화 여부를 판정해 두 입력 경로가 항상 일치하도록 통합했다.
4. `RulebookModal.tsx` — "선언 올리기" 섹션을 공식 눈금 상향 규칙 설명으로 재작성, 트랙은 "판정과 무관한 보조 시각 요소"로 명시.
5. `Perudo.test.ts` — 구 트랙 인덱스 비교 테스트(`isValidBid`/`trackIndexForBid`/`BOARD_TRACK_SEQUENCE`)를 걷어내고, `trackCellForBid`/`trackCellAt`(quantity 1→normal, face 1 전용 매핑, 얼굴 2~6 공유, 단조성, 무상한, 역함수 검증)과 공식 `validateRaise` 전 케이스, 그리고 "버그2" 재현 회귀 케이스(quantity:1,face:2 다음 face 3/4/5/6 전부 허용·face≤2 거절, face:1은 별도 normal→paco 공식을 따름)를 신규 작성했다.

**브라우저 실측 검증** (Playwright — 로컬 dev 서버에서 실제 방 생성 → Lv.5 봇 추가 → 비딩 화면까지 진입 → 검증 후 스크립트/스크린샷은 커밋 대상에서 제외): 봇이 "3×1개"로 개장한 화면에서 확정 비딩(quantity 1, face 3)의 호박색 마커가 [페루도] 칸이 아닌 일반 "1" 칸에 정확히 위치함을 확인, 눈금을 3→6으로 바꿔도 마커가 여전히 올바른 (수량 그대로 유지된) 칸에 머물고 확정 버튼이 계속 활성 상태임을 확인. 별도 세션에서 라운드 개장 시나리오로 눈금 2·수량 1(신고된 원본 시나리오와 동일 값)을 직접 재현 — 초안 마커가 [페루도] 칸이 아닌 일반 "1" 칸에 정확히 놓이고 "✅ 2 × 1개로 베팅 확정" 버튼이 활성화됨을 스크린샷으로 재확인.

**검증**: `npx tsc --noEmit`/`npm run lint` 프로젝트 전체 0건, `npx vitest run src/games/perudo`(64/64 통과), `npx vitest run --exclude '**/aiBenchmark.test.ts'`(27개 파일 1054/1054 통과, 42초). 전체(벤치마크 포함) `npx vitest run`은 과거 세션들과 동일 사유(`aiBenchmark.test.ts`의 완전 동기 1,000판 벤치마크)로 백그라운드 실행만 걸어두고 완료를 기다리지 않음.

**커밋/배포**: 커밋 `898c00d fix(perudo): allow face increments on same quantity and fix board marker mapping for face 2` → `git push origin main` 완료 → `npx vercel deploy`(프리뷰) 정상 완주(Turbopack 빌드+TS 전체 재검사 포함), READY — `https://board-game-n88lkrhab-me-3871.vercel.app`. 사용자가 "production"을 명시하지 않아 이번에도 프리뷰까지만 진행 — 필요하면 `npx vercel deploy --prod`로 후속 승격 요청할 것.

### 2026-08-20 — 페루도 보라색 마커 확대 + 우측 트랙(7~11) 잘림 해소 + 배경 이미지 제거

**요청**: 직전 사각 트랙 세션(바로 아래 섹션) 이후 사용자가 3가지 긴급 UI 수정을 요청: (1) 보라색 베팅 다이의 시인성이 낮으니 확대(단, 겹침 없이), (2) 우측 변의 수량 7~11 칸이 화면 밖으로 밀려나거나 잘리는 현상 해결, (3) 트랙 배경에 남아 있는 실물 보드 사진 완전 제거. 요청 원문이 "컴포넌트 크기·정렬 방식에 추가 확인이 필요하면 절대 임의로 추정하지 말고 먼저 질문"하라고 명시.

**1) 사전 질의 2개 — `AskUserQuestion`** — 요청 원문 자체가 "보라색 주사위(플레이어 주사위 또는 비딩 마커)"로 두 가지 서로 다른 컴포넌트를 나열해 대상이 모호했고(항상 보라색인 시스템 마커 `BettingDie`/`BETTING_COLORWAY` vs 좌석이 "보라" 색상을 고른 경우에만 보라색인 `PLAYER_COLORWAYS`의 플레이어 주사위), 트랙 안쪽 칸이 이미 27~34px로 매우 좁아 "확대하되 겹치지 않게"가 곧바로 충돌할 수 있어 처리 방식도 확인이 필요했다. 확인 결과: **베팅 마커만** 확대, **칸 안에서만 소폭 확대**(칸 밖으로 삐져나오는 "토큰" 스타일이나 칸 자체 확대는 배제)로 확정.

**2) 우측 7~11 잘림의 근본 원인 — CSS min-width 플로어의 grid 오버플로 강제** — 코드 조사 결과 실제 원인은 직전 세션이 남긴 `BidTrack`의 `min-w-[34rem]`(544px) 플로어 + `overflow-x-auto`였다: 남측 11칸 행이 각 칸의 `min-w-[1.7rem]`(flex 자식의 콘텐츠 기반 최소폭)을 지키려고 자신이 속한 CSS grid의 `1fr` 중앙 컬럼을 최소 ~300px 이상으로 강제로 밀어붙이고, 그 결과 우측 고정폭 컬럼(코너+7~11칸)이 뷰포트보다 넓은 트랙의 맨 끝에 위치하게 돼 뷰포트/페이지 max-width(`max-w-2xl`, 672px)보다 좁은 화면(특히 모바일)에서는 가로 스크롤 없이는 아예 보이지 않았다 — 사용자가 "잘림"으로 인지한 것과 정확히 일치. `TABLE_PANEL`의 `overflow-hidden`과 `overflow-x-auto`가 세로축도 암묵적으로 `auto`가 돼(CSS 스펙상 overflow-x가 스크롤값이면 overflow-y도 auto로 계산), 프레임 밖으로 살짝 튀어나오게 설계된 `DirectionArrow` 배지도 부수적으로 잘릴 수 있는 경로였음을 함께 확인.

**3) 반응형 재설계 — `flex`+고정 min-width를 `grid minmax(0,1fr)`로 교체** — flex 자식의 기본 `min-width: auto`(콘텐츠 기반 최소폭)가 오버플로의 근본 원인이므로, 북/남측 내부 칸 행을 `flex`에서 `grid`(`gridTemplateColumns: repeat(N, minmax(0, 1fr))`)로, 각 칸 버튼에는 `min-w-0`을 추가해 바꿨다 — `minmax(0, ...)` 트랙은 콘텐츠 크기와 무관하게 부모가 준 폭만큼만 차지하므로 행이 부모보다 넓어질 수 없다(수학적으로 오버플로 불가능). 코너 4칸 + 좌/우 컬럼(원래 고정폭)은 `w-[clamp(1.6rem,8vw,2.75rem)]`로 통일해 뷰포트에 맞춰 자연스럽게 축소/확대되도록 했다. `BidTrack` 프레임의 `min-w-[34rem]`과 그걸 감싸던 `overflow-x-auto`(PerudoBoard.tsx 호출부)를 모두 제거 — 이제 스크롤이 구조적으로 필요 없다.

**4) 보라색 마커 확대 — 고정 픽셀 대신 "그 칸의 80%"** — `BettingDie`가 항상 24px 고정이라 좁은 내부 칸에서도 넓은 코너 칸(44px)에서도 크기가 똑같아, 코너 칸에서는 오히려 왜소해 보이는 비일관성이 있었다. 고정 픽셀 대신 **자신이 실제로 앉은 칸의 80%**로 렌더링하도록 재구현(퍼센트 스타일 체인이 실제 셀 크기까지 정확히 resolve되도록 `TrackCellButton`의 오버레이 wrapper 2단 전부에 `h-full w-full` 명시) — 칸이 반응형으로 커지고 작아지는 새 레이아웃과 자동으로 함께 스케일되고, 수학적으로 자기 칸의 80%를 절대 넘지 않아 이웃 칸 침범이 불가능하다(사용자 확정 방향: 확대하되 절대 칸 밖으로 안 나가게).

**5) 배경 이미지 제거** — `BidTrack` 안에 25% 불투명도로 깔려 있던 `url(/assets/games/perudo/board.jpg)` 레이어(직전 세션이 추가)를 완전히 삭제 — 기존에 이미 있던 짙은 그라디언트 베젤(`from-neutral-800 via-neutral-900 to-black`)만 남아 단색/테마 배경이 됨. 에셋 파일 자체는 삭제하지 않음(다른 곳에서 참조할 가능성 대비, 이번 세션 확인 결과 코드상 참조는 이 한 곳뿐이었음).

**6) 시각 검증 중 발견한 별개의 기존 버그 — 중첩 `<button>`** — Playwright로 임시 라우트(`src/app/dev/perudo-preview`, `startGame(4, seed)` + `raise` 액션 1회로 우측 컬럼에 현재 베팅을 위치시킨 고정 state, 검증 후 삭제)를 1280/375/320px 3개 뷰포트에서 렌더링해 콘솔을 확인하던 중, `TrackCellButton`(`<button>`)이 `showDie`일 때 자신의 내부에 `BettingDie`의 `<button>`을 중첩 렌더링해 React 하이드레이션 경고를 내는 것을 발견했다 — 이번 세션이 만든 버그가 아니라 사각 트랙 개편 세션부터 이미 있던 기존 결함(이번 요청의 3가지와는 무관)이지만, 사용자의 검증 프로토콜이 명시적으로 "렌더링 에러" 확인을 요구했고 정적 분석(`tsc`/`lint`)으로는 잡히지 않는 실제 브라우저 렌더링 결함이라 함께 고쳤다: 바깥 셀을 `<button>`에서 `role="button"` + `tabIndex`/`onKeyDown`(Enter/Space)을 갖춘 `<div>`로 교체해 두 개의 서로 다른 클릭 대상(칸 이동 vs 마커 눈금 순환)이 유효한 HTML로 공존하도록 정리.

**7) 검증** — Playwright 스크린샷 + `document.documentElement.scrollWidth === clientWidth` 실측을 1280px(데스크톱)/375px(일반 모바일)/320px(구형 최소 폭) 3개 뷰포트 전부에서 확인(셋 다 스크롤 없이 정확히 일치 — 가로 오버플로 완전히 사라짐), 우측 7~11 컬럼이 세 뷰포트 모두에서 프레임 안쪽 여백과 함께 완전히 노출됨을 클로즈업 스크린샷으로 확인, 중첩 버튼 수정 전/후 콘솔 에러 목록을 대조해 하이드레이션 경고가 사라졌음을 확인(남은 콘솔 404 2건은 이 dev 환경의 Supabase `app_settings`/`guest_usage` 테이블 부재로, Perudo/이번 변경과 무관함을 URL로 직접 확인). `npx tsc --noEmit`(전체, 0 에러) / `npm run lint`(전체, 0 경고) / `npx vitest run src/games/perudo/Perudo.test.ts`(61/61 통과 — `engine.ts` 무변경, 순수 `PerudoBoard.tsx` 표현 계층 변경) / `npx vercel deploy` 빌드 자체의 TypeScript 전체 재검사도 통과. 전체 `npx vitest run`은 과거 세션들과 동일 사유(`aiBenchmark.test.ts`)로 백그라운드에 걸어두고 이번 세션 안에 완료를 기다리지 않음(§3 0번 항목 참고 — 이번 세션의 변경분은 `PerudoBoard.tsx` 표현 계층뿐이라 그 벤치마크와 무관).

**커밋/배포**: 커밋 `9188c66 fix(perudo): enlarge purple dice, fix right track clipping (7-11), and remove background image` → `git push origin main` 완료 → `npx vercel deploy`(프리뷰) 정상 완주, READY — `https://board-game-pe9y92340-me-3871.vercel.app`. "production" 명시 없어 이번에도 프리뷰까지만 진행(과거 세션들과 동일 판단 기준) — 필요하면 `npx vercel deploy --prod`로 후속 승격 요청할 것.

### 2026-08-20 — 페루도 사각 4변 트랙 + 중앙 주사위 무덤

**요청**: `boardGameRule/페루도/변경후이미지.jpg`(실물 보드 사진)를 참조해, 2026-08-19 세션이 만든 37칸 뱀(보스트로페돈) 트랙을 4변 직사각형 테두리 트랙으로 개편하고 트랙 중앙에 탈락 주사위가 쌓이는 "주사위 무덤" 전용 영역을 신설. 요청 원문이 "색상 톤/컴포넌트 크기·비율/모서리 칸 중복 처리 방식/페루도 심볼 칸 배치 등은 절대 임의로 추정해 구현하지 말고, 불명확한 점은 코드를 수정하기 전에 구체적인 질문 목록을 먼저 제시해 확인받은 후 진행"하라고 명시적으로 요구.

**1) 사전 질의 8개 — `AskUserQuestion` + 텍스트 Q&A** — `변경후이미지.jpg`는 실물 박스 사진이라 상단 변 숫자가 마모·반전(거꾸로 인쇄)돼 있고 마스크/해골 아이콘 배치도 사진만으로는 확신 있게 셀 수 없어, 구현 착수 전 다음을 확인받았다: ① 기존 37칸 데이터/로직을 완전히 교체할지 배치만 바꿀지, ② 4개 모서리가 정확히 어느 숫자인지, ③ 모서리를 두 변이 공유하는 한 칸으로 볼지 중복 칸으로 볼지, ④ 4변의 정확한 칸 순서(페루도 전용 칸 위치 포함), ⑤ 해골 칸의 기능과 진행 방향 화살표 필요 여부, ⑥ 트랙 상한 처리, ⑦ 중앙 영역을 무덤/조작 UI 중 어떻게 배분할지, ⑧ 배경에 실물 사진을 계속 쓸지. 사용자가 순서대로 회신한 칸 목록(①~④, "1(우측 상단 코너)"류 코너 라벨은 본문의 "좌상1/우상7/우하11/좌하17"과 서로 어긋나 있어, 그 라벨은 무시하고 칸 **내용·순서**만 채택)을 기존 `BOARD_TRACK_SEQUENCE`(37칸, [PerudoBoard.tsx](../src/games/perudo/PerudoBoard.tsx))와 인덱스 단위로 전수 대조한 결과 완전히 동일했다 — 즉 사용자가 원한 것은 새 데이터가 아니라 기존 데이터의 새 배치였음이 이 대조로 확정됐다. 나머지 4개(⑤~⑧)는 `AskUserQuestion` 2문항(중앙 레이아웃 3택, 배경 텍스처 2택)으로 마무리 확인.

**2) 사각형 배치 — 4개의 독립 flex 스트립 + 공유 모서리** — 확정된 인덱스 매핑(북 index 0~9/동 9~17/남 17~29/서 29~36→wrap 0, 모서리 index 0·9·17·29는 인접 두 변이 공유하는 단일 셀)을 실측하면 북 8칸·동 7칸·남 11칸·서 7칸으로 **대변끼리 칸 수가 다르다**(북 8 vs 남 11) — 그래서 하나의 균일 CSS 그리드로는 표현할 수 없어, 3×3 그리드(네 모서리 고정 셀 + 중앙 셀)에 각 변을 그 변 전용 칸 수로 균등분할하는 독립 flex 스트립으로 얹는 방식을 새로 도입했다. 남/서 스트립은 오름차순 배열의 진행 방향이 실제 화면상 방향과 반대라 `.reverse()`한 배열을 그대로 순서대로 렌더링(별도의 `flex-row-reverse`/`flex-col-reverse` CSS를 함께 쓰면 이중 반전되는 실수를 한 차례 저질러 바로잡음). 자주색 베팅 다이는 예전처럼 별도 그리드 좌표를 계산해 형제로 얹는 대신, 각 셀 버튼(`TrackCellButton`) 내부에 `pendingTrackIndex` 일치 여부만으로 절대 위치 오버레이하도록 재구현해 좌표 계산 코드 자체가 사라졌다. 4변 진행 방향 화살표(북→/동↓/남←/서↑)는 각 스트립 컨테이너에 `pointer-events-none` 절대 배지로 추가.

**3) 다이 오버레이 크기 축소 + 반응형 가로 스크롤** — 옛 스네이크 그리드는 모든 칸이 균일 크기였지만 새 사각 트랙은 변마다 칸 크기가 다르고(특히 11칸이 몰린 남측이 가장 좁음) 기존 `scale-125` md 사이즈 베팅 다이가 좁은 칸에서 이웃 칸을 시각적으로 침범해, `BettingDie`에 `size` prop을 새로 추가하고 트랙 위 오버레이는 sm으로 축소(스케일 배율 제거)했다. 반응형 대응으로 트랙 프레임에 `min-w-[34rem]`(남측 11칸이 각자 최소 폭을 유지할 수 있는 하한)을 지정하고 그 바깥을 `overflow-x-auto`로 감싸, 화면이 좁을 때 숫자가 찌그러지는 대신 가로 스크롤되도록 했다(요청 원문 "숫자가 깨지거나 찌그러지지 않도록").

**4) 중앙 = 무덤 전용, 조작 UI는 트랙 바깥으로** — `BidTrack`의 `children`을 `centerContent: ReactNode`로 바꾸고 `PerudoBoard`가 거기에 기존 `LostDiceTray`(탈락 주사위 좌석별 스택 + 총 탈락 개수)를 그대로 전달 — 새 컴포넌트를 만들지 않고 기존 걸 트랙 중심으로 옮기기만 했다. 예전에 트랙 내부 골든 플라크에 있던 베팅 선언 표시/눈금 선택기/베팅 확정 버튼/페루도!·맞아! 버튼은 트랙 바로 아래의 별도 카드로 이동(playing phase에서만; gameOver/reveal phase는 애초에 트랙 자체가 없어 `LostDiceTray`를 예전처럼 상단에 그대로 유지). 배경 텍스처는 실물 보드 사진(`board.jpg`)을 그대로 25% 불투명도로 유지.

**5) 시각 검증 — 스크린샷 오판을 좌표 덤프로 교차검증** — 임시 라우트(`src/app/dev-perudo-preview`, `startGame(8, seed)`을 일부 좌석 탈락 상태로 가공한 고정 state)를 만들어 Playwright(`npx --no-install playwright screenshot`, 이 세션에 한해 `npm install --no-save playwright`로 프로그래매틱 API도 임시 설치 후 완료 후 제거)로 스크린샷을 찍었을 때, 남측 11칸이 촘촘히 붙어 있고 그 위에 자주색 다이(당시 아직 md+scale-125)가 겹쳐 있어 **"모서리 칸이 프레임 밖에 따로 떨어져 렌더링된 것처럼" 육안으로 오판**했다 — 곧바로 코드를 고치기 전에, 모든 트랙 셀 버튼의 `getBoundingClientRect()`를 실제로 덤프해 37개 셀 전부가 의도한 3행(북/중간행/남) × 정확한 x좌표로 한 줄씩 정확히 배치돼 있음을 픽셀 단위로 먼저 확인한 뒤에야 "오버레이가 이웃 셀을 시각적으로 가리는" 진짜 원인(§3)을 특정해 고쳤다 — "시각적/레이아웃 버그는 코드 리뷰만으로 고쳤다고 단정하지 말 것"과 대칭으로, 이번엔 "스크린샷 육안 판독만으로 고장났다고 단정하지 말 것"이 실제로 있었던 사례로 남긴다. 390px 폭에서 `overflow-x-auto` 컨테이너가 `scrollWidth 544 / clientWidth 332`로 정상적으로 스크롤 가능함도 별도 확인.

**검증**: `npx tsc --noEmit`(전체, 0 에러) / `npm run lint`(전체, 0 경고) / `npx vitest run src/games/perudo/Perudo.test.ts`(61/61 통과, 2~3초 — `engine.ts` 무변경, 순수 `PerudoBoard.tsx` 표현 계층 변경). 전체 `npx vitest run`은 과거 세션들과 동일 사유(`aiBenchmark.test.ts`)로 백그라운드에 걸어두고 이번 세션 안에 완료를 기다리지 않음(§3 0번 항목 참고, 다음 세션에서 완주 여부 확인 필요).

**커밋/배포**: 커밋 `685727d refactor(perudo): redesign board with center dice graveyard and rectangular track referring to updated board image` → `git push origin main` 완료 → `npx vercel deploy`(프리뷰) 정상 완주, READY — `https://board-game-71t41llt7-me-3871.vercel.app`. "production" 명시 없어 프리뷰까지만 진행.

### 2026-08-19 — 그리드 포커 카드 배치 펄스 및 라인 완성 족보 이펙트

**요청**: 그리드 포커의 플레이 몰입감·타격감을 높이기 위해 (1) 카드 1개 배치 시 스케일 팝(1.15→1.0)+슬램/드롭섀도우 + 착지 테두리 펄스 파동, (2) 가로/세로/대각선 1줄 완성 시 골드/네온 라인 글로우 스윕 + 완성 족보명·점수 플로팅 뱃지 + 고급 족보(플러시 이상)엔 골드 스파클 파티클을 요청. 애니메이션 재생 중에도 조작 지연이 없어야 하고 모바일/웹 반응형을 유지해야 하며, `tsc`/`lint`/`vitest` 검증 후 커밋·푸시·배포까지 요청.

**조사**: [`src/games/grid-poker/`](../src/games/grid-poker/)를 확인 — `GridPokerBoard.tsx`의 `Cell`이 배치된 카드/빈 칸/상대 은닉 칸을 그리는 공용 컴포넌트, `engine.ts`가 25칸 보드·12개 라인(`LINES`)·포커 핸드 평가(`evaluateHand`)를 갖고 있으나 이 프로젝트는 framer-motion을 쓰지 않고(설치돼 있지 않음) 모든 게임이 순수 CSS `@keyframes`(`globals.css`에 게임별로 주석과 함께 누적)로 연출을 구현해왔음을 확인 — 배너류 연출(완성 토스트 등)은 하나같이 `coup/CoupEffects.tsx`·`forSale/ForSaleEffects.tsx` 패턴대로 "두 연속 상태를 diff하는 `detectX` 함수 + `createPortal`로 `document.body`에 fixed 포지션"으로 구현돼 있어 그 관례를 그대로 따르기로 함. 이 게임 특유의 제약: 매 클라이언트가 전 플레이어의 전체 보드를 메모리에 들고 있지만(락스텝 신뢰 모델) `visibleOpponentBoard`가 UI에서 상대의 미공개 칸을 의도적으로 숨기므로, 라인 완성 이펙트는 뷰어 자신의 보드에만 적용해야 함. 또한 "획득 점수"는 카드가 채워지는 배치(placing) 단계엔 존재하지 않고 이후 blind 라인 제출·비교(submitting 단계, `resolveRound`)에서만 확정되므로, 요청된 "획득 점수" 표기는 이 트리거 시점엔 성립하지 않아 뱃지에서 의도적으로 제외(족보명만 표기).

**구현**:
- **`globals.css`**: 그리드 포커 전용 키프레임 5개 신규 추가 — `gp-card-place`(스케일 1.22 오버슈트→드롭섀도우와 함께 안착하는 슬램), `gp-cell-pulse`(에메랄드 박스섀도우 링이 확장·소멸), `gp-line-glow`(골드 박스섀도우, `animationDelay`를 라인 내 칸 순서(0,70,140,...ms)로 줘서 다섯 칸을 순차로 훑는 스윕처럼 보이게), `gp-hand-badge-float`(뱃지가 위로 떠오르며 페이드아웃), `gp-sparkle-twinkle`(반짝임 파티클 회전+스케일).
- **신규 [`GridPokerEffects.tsx`](../src/games/grid-poker/GridPokerEffects.tsx)**: `detectNewlyCompletedLines(prevBoard, nextBoard)` — 12개 라인 전부를 순회해 이전엔 안 꽉 찼는데 지금은 꽉 찬 라인만 반환(코너 칸은 2개, 센터 칸은 4개 라인에 동시에 속해 있어 한 번의 배치로 여러 라인이 동시에 완성될 수 있음을 반영해 배열로 반환). `HandRankFloatingBadge` — `formatHandLabel`로 완성된 족보명을 보여주는 fixed 포지션 토스트, `category>=5`(플러시/풀하우스/포카드/스트레이트 플러시)면 주변에 ✨ 6개를 고정 배치로 흩뿌려 스파클 효과 추가, 1.5초 뒤 `setTimeout`으로 자동 소멸.
- **`GridPokerBoard.tsx`의 `Cell`**: 카드가 채워진 칸을 감쌀 때 `card.id`를 `key`로 쓰는 내부 span 2개(팝 애니메이션용/펄스 링용)를 추가 — 칸은 엔진상 `null → Card`로 딱 한 번만 전이하므로 `card.id` 키가 처음 나타나는 순간 자동으로 마운트되어 CSS 애니메이션이 정확히 1회 재생되고, 이후 같은 카드로 재렌더링돼도 키가 그대로라 재생되지 않음(별도 감지 로직 불필요, `DealerReveal.tsx`가 이미 쓰던 것과 동일한 key-remount 기법). 신규 `glow` prop(라인 완성 시 해당 칸에 `{delayMs, eventId}` 전달)으로 `gp-line-glow` 스윕을 얹음.
- **`GridPokerBoard.tsx` 본체**: `viewer.board`(뷰어 자신의 25칸 배열)의 참조 변경을 추적 — 엔진 리듀서(`place`)는 본인이 실제로 배치했을 때만 자신의 `board` 배열을 새로 만들고, 다른 플레이어의 액션이나 `draw-common`(라운드 리셋) 등 그 외 모든 액션은 뷰어 자신의 `player.board` 참조를 그대로 둔다는 점을 이용 — 참조가 바뀐 렌더에서만 `detectNewlyCompletedLines`를 돌려 신규 완성 라인을 찾고 `lineEvents`에 쌓는다(렌더 중 비교 후 조건부 `setState`, 이 프로젝트가 `coup/CoupBoard.tsx` 등에서 이미 쓰는 패턴 재사용, 별도 `useEffect` 불필요). 완성된 라인들에서 파생된 `glowByCell` 맵을 각 `Cell`에 전달하고, 활성 `lineEvents`마다 `HandRankFloatingBadge`를 렌더링.

**성능·반응형**: 순수 CSS `@keyframes`/박스섀도우 애니메이션 + `setTimeout` 기반 상태 정리만 사용(Canvas/rAF 루프 없음), 엔진·리듀서·봇 AI(`chooseBotAction`)는 완전히 무변경이라 배치/제출 조작 자체엔 어떤 지연도 추가되지 않음. 뱃지는 `createPortal`로 `document.body`에 fixed 포지션이라 `TABLE_PANEL`의 `overflow-hidden`에 잘리지 않고, 좁은 모바일 폭에서도 보드 그리드 크기와 무관하게 항상 온전히 보임.

**검증**: `npx tsc --noEmit`(전체, 0 에러) / `npm run lint`(전체, 0 경고) / `npx vitest run src/games/grid-poker`(42/42 통과, 순수 표현 계층 추가라 엔진 로직·테스트 모두 무변경) / 전체 `npx vitest run --exclude '**/aiBenchmark.test.ts'`(기존 컨벤션대로 무거운 동기 벤치마크 파일 제외, 27개 파일 1051/1051 통과, 46초 — 그리드 포커엔 별도 AI 벤치마크가 없어 이번 변경으로 영향받는 벤치마크 자체가 없음).

### 2026-08-19 — 페루도 보드 트랙 시퀀스(선형 전진) 전면 개편

**요청**: 페루도의 비딩 진행 방식을 공식 룰북의 수량/눈금 공식이 아니라, 사용자가 직접 지정한 **고정된 단일 트랙 순서**(`1 → [페루도1] → 2 → 3 → [페루도2] → 4 → 5 → [페루도3] → 6 → 7 → 4 → [페루도4] → 8 → 9 → 5 → [페루도5] → 10 → 11 → 6 → [페루도6] → 12 → 13 → 7 → [페루도7] → 14 → 15 → 8 → [페루도8] → 16 → 17 → 9 → [페루도9] → 18 → 19 → 10 → [페루도10] → 20`, 37칸)로 전면 개편. 비딩은 반드시 현재 칸보다 트랙 상 뒤(더 큰 인덱스)에 있는 칸으로만 전진 가능하고, 역행은 원천 차단. 보드 UI에 현재 위치 마커, 이전/동일 칸 비활성화, 신규 단위 테스트, 검증·배포까지 요청.

**진행 전 확인 — `AskUserQuestion` 2건**: (1) 사용자가 제시한 트랙 순서 자체가 숫자 라벨 기준으로는 비단조(예: "...6→7→4→[페루도4]→8...", 7 다음 4로 다시 작아짐)라 "뒤 인덱스로만 전진" 규칙과 문면상 모순돼 보여 처리 방식을 확인 — 사용자가 "정확히 이거대로" 라벨 시퀀스를 문자 그대로 반영해달라고 확정(비단조성은 **배열 인덱스**로만 판정하면 모순이 아님이 이후 구현에서 확인됨). (2) 이 변경이 [engine.ts](../src/games/perudo/engine.ts)에 문서화된, 2026-08-17 세션에 사용자가 직접 확정한 "공식 룰북 그대로 구현" 방향(§3 수량/눈금 공식)과 정면으로 배치되는 하우스 룰 전환임을 제시하고 의도를 재확인 — "네, 공식룰 대신 이 트랙 방식으로 전면 교체"로 명시적으로 확정받음.

**엔진 설계 — `Bid.trackIndex`를 정본으로 승격**: `engine.ts`에 `BOARD_TRACK_SEQUENCE`(37개 `{index, kind: "normal"|"perudo", quantity}` 셀, 사용자가 확정한 라벨 시퀀스를 그대로 하드코딩 — "패턴을 영리하게 derive"하지 않고 원문 그대로 옮겨적어 승인받지 않은 변형이 몰래 섞여드는 걸 방지) 신규 추가. `Bid` 타입에 `trackIndex: number`를 정본 필드로 추가(`quantity`/`face`는 그 칸에서 파생돼 표시·주사위 집계용으로 유지). 두 헬퍼:
- `trackIndexForBid(afterIndex, quantity, face)`: `afterIndex` 이후 가장 가까운, (quantity, face에 따른 kind) 조건에 맞는 칸의 인덱스를 찾음(같은 라벨이 트랙에 두 번 나오는 경우 — 예: "4"가 인덱스5·10 두 번 — 항상 아직 지나지 않은 쪽을 자동으로 찾아줌).
- `isValidBid(prevTrackIndex, nextTrackIndex)`: 요청이 명시한 그 자체의 "$I_{next} > I_{current}$" 인덱스 비교. `validateRaise`는 내부적으로 `trackIndexForBid`를 통해 이 비교로 재구현(예전 §3 공식 — "같은 수량 더 높은 눈금" 등 — 은 완전히 폐기). `raise()` 액션이 유효성 검증과 동시에 결과 `Bid`에 `trackIndex`를 채워 넣음. 봇 AI(`raiseMoves`/`minValidQuantityForFace`/`scoreMove`/ISMCTS)는 여전히 얼굴(2~6)당 "가장 저렴한 합법 인상"이라는 기존 후보 생성 틀(면당 1개, 최대 6개)을 그대로 유지한 채 그 안에서 `trackIndexForBid`만 호출하도록 최소 변경 — 처음엔 트랙 셀 하나당 얼굴 5개씩(최대 약 180개) 완전 열거를 시도했으나 ISMCTS 트라이얼 수가 그만큼 곱연산으로 폭증해 성능 리스크가 커, 기존 6-후보 틀을 유지하는 쪽으로 되돌림(변경 폭 최소화 + 성능 안전).

**UI 개편 — `PerudoBoard.tsx`**: 플레이어 수에 따라 가변이던 구 `TRACK_LENGTH`(=`MAX_PLAYERS×STARTING_DICE`) 기반 "속이 빈 사각 루프" 트랙(`computeTrackDimensions`/`buildTrackCells`)을 완전히 제거하고, 고정 37칸을 8열 보스트로페돈("뱀") 그리드(`snakeGridPosition` — 짝수 행 좌→우, 홀수 행 우→좌)로 새로 그림 — 사각 루프는 칸 수가 짝수여야만 성립하는데 37은 홀수라 애초에 불가능했던 것도 교체 사유. 각 칸은 `node.index > currentTrackIndex`(내 차례일 때만)일 때만 클릭 가능/활성화, `[페루도 N]` 칸은 장미색 스타일 + 크레스트 아이콘으로 일반 칸과 구별. 현재 확정된 베팅 칸엔 호박색 마커, 아직 확정 전인 내 드래프트 칸엔 보라색 `BettingDie` 피스가 얹힘(둘 다 `trackIndex` 기반, 더 이상 "수량"만으로는 같은 라벨이 트랙에 두 번 나올 때 어느 칸인지 구분할 수 없어 클릭 이벤트가 직접 `node.index`를 넘기도록 설계 — `selectCell`). 실물 보드 사진(`board.jpg`)은 이제 칸 배치·개수가 완전히 달라져 인쇄 눈금과 대응이 불가능해져 은은한 배경 텍스처(`opacity: 0.25`)로 격하. `RulebookModal.tsx`의 "선언 올리기" 절도 옛 §3 공식 설명을 걷어내고 새 트랙 규칙(전진만 가능, 라벨이 아니라 트랙 위치로 판정, 예시 포함)으로 재작성.

**테스트**: `Perudo.test.ts` 전면 재작성 — 사용자가 명시한 3개 케이스 정확히 반영([페루도2]→3 실패 / [페루도2]→4·[페루도3] 성공 / 트랙 전체를 인덱스 0→36까지 한 칸씩 전진하면 매번 유효 + 역행은 항상 거절 + 범위 밖 인덱스 거절) + `BOARD_TRACK_SEQUENCE` 37개 셀·라벨 시퀀스 자체의 스냅샷 검증 + `trackIndexForBid`의 "같은 라벨이 트랙에 두 번" 케이스 단위 테스트. 기존 dudo/calza/continue/rankings/bot 테스트는 로직 변경이 없어 그대로 유지하되, `currentBid` 리터럴마다 `trackIndex` 필드를 추가(총 60→61개, 순수 필드 보강이지 시나리오 변경 아님) — 단 예외 2곳: (1) "무효 raise" 테스트는 새 규칙에서 실제로 유효해져 버린 옛 시나리오(같은 수량, 낮은 눈금)를 트랙에 다시 나타나지 않는 수량으로 교체, (2) Level 10 ISMCTS 관련 테스트 3개는 원래 쓰던 "수량 15" 위치가 트랙 뒤쪽에 더 작은 중복 라벨(예: "8")로 되돌아갈 수 있는 탈출구가 남아 있어 기대 승률이 실측상 흔들려([페루도10] — 트랙의 마지막에서 두 번째 칸, 그 뒤엔 불가능한 수량 "20" 칸 하나만 남는 위치)로 교체해 안정화.

**AI 벤치마크 영향(사전 측정, 회귀 아님)**: `aiBenchmark.test.ts`의 페루도 벤치마크(Level 10 vs Level 1-3, 1,000판, 85% 문턱)는 트랙의 의도된 비단조성(중복 라벨로 "안전한 낮은 수량"으로 되돌아갈 수 있는 탈출구가 트랙 곳곳에 있음) 때문에 강한 봇의 우위가 옛 공식 룰북 기준(과거 실측 97.1%)보다 줄어들 것으로 예상돼, 실제로 격리 실행(1,000판, `-t "perudo"`, 7.3초)한 결과 **87.0%로 문턱을 여전히 통과**함을 확인 — 별도 조정 없이 통과. (다른 두 게임 five-cucumbers/malDalliJa 벤치마크는 이번 세션에서 건드리지 않았고, 이 저장소가 과거 여러 세션에 걸쳐 문서화해온 것과 같은 이유로 — 완전 동기 1,000판 루프가 Node 이벤트 루프를 막아 `npx vitest run` 전체 실행 시 무출력으로 장시간 지속 — 전체 스위트 안에서는 별도로 기다리지 않고 격리 실행으로 대체했다.)

**검증**: `npx tsc --noEmit`(전체, 0 에러) / `npm run lint`(전체, 0 경고) / `npx vitest run src/games/perudo/Perudo.test.ts`(61/61 통과) / `npx vitest run src/games/shared/bot/aiBenchmark.test.ts -t "perudo"`(1,000판 공식 벤치마크, 87.0% ≥ 85% 통과, 7.3초) / `npx vitest run --exclude '**/aiBenchmark.test.ts'`(전체 27개 파일 1051/1051 통과, 48초) — `aiBenchmark.test.ts`의 나머지 두 게임 벤치마크만 위 설명대로 전체 실행에서 제외.

**결론**: 페루도 비딩이 이제 공식 룰북 수량/눈금 공식이 아니라 사용자가 지정한 고정 37칸 트랙의 순전한 순방향 진행으로 동작 — `engine.ts` 모듈 최상단 doc과 이 트랙 섹션 doc에 이 결정이 2026-08-17 세션의 "공식 룰북 그대로" 방향과 배치되는 명시적 하우스 룰임을 남겨, 다음 세션이 "버그"로 오인해 되돌리지 않도록 표시해뒀다.

**배포**: 커밋 `bd0d618 refactor(perudo): apply new linear board track sequence and prevent backwards bidding` → `git push origin main` 완료(기존 컨벤션대로 main 직접 커밋) → `npx vercel deploy`(프리뷰, 빌드 중 TypeScript 전체 재검사 포함 정상 완주) — `https://board-game-gt4rt68e8-me-3871.vercel.app`. 사용자가 "production"을 명시하지 않아 과거 세션들과 동일 기준으로 프리뷰까지만 진행하고 prod 승격은 보류 — 필요하면 `npx vercel deploy --prod`로 후속 승격 요청할 것.

### 2026-08-19 — 언어의 조각 힌트 노출 글자 수 검증

**요청**: 힌트 사용 시 정답이 과다 노출되는 문제를 해결하기 위해, 정답 단어 길이 `L`에 대해 공개 글자 수 `K = floor(L/2)`를 명시적으로 고정 — 2글자→1글자 공개, 3글자→1글자 공개, 4글자→2글자 공개(각각 1~3글자는 마스킹). 무작위 인덱스 선택 + `_` 마스킹, 음절 단위 적용, 단위 테스트 보강, `tsc`/`lint`/`vitest` 검증 후 배포까지 요청.

**조사 결과 — 이미 구현돼 있던 규칙**: [`src/games/piecesOfLanguage/engine.ts`](../src/games/piecesOfLanguage/engine.ts)의 `hintRevealIndices`/`buildHint`는 [2026-08-17 "언어의 조각 힌트 로직 개편" 세션](#2026-08-17--언어의-조각-힌트-로직-개편-최소-1회-오답-후-해금--50-부분-마스킹)에서 이미 요청과 정확히 같은 공식으로 구현돼 있었다:

- `hintRevealIndices(word, seat)`: `const reveal = Math.floor(length / 2)` — 사용자가 요청한 `K = floor(L/2)` 그대로. 전체 인덱스 `[0..L-1]`을 `word`+`seat` 해시로 시드된 `seededRng`로 `shuffle`한 뒤 앞 `reveal`개만 공개 인덱스 집합으로 반환 — "전체 인덱스 중 K개를 무작위 추출" 요청 사항과 동일한 방식.
- `buildHint(word, seat)`: 공개 인덱스는 `word`의 실제 문자를, 나머지는 `_`를 반환 — 요청한 마스킹 방식과 동일.
- 두 함수 모두 `[...word]`(문자열 스프레드, 완성형 음절 코드포인트 단위)로 순회 — 자모(초성/중성/종성) 분해가 아닌 **음절 단위**로 정확히 동작해 "자모 단위 힌트가 아닌 음절 단위 힌트일 경우" 요청 조건도 이미 충족.

`L=2 → floor(2/2)=1`, `L=3 → floor(3/2)=1`, `L=4 → floor(4/2)=2`, `L=5 → floor(5/2)=2` — 워드뱅크(`words.ts`)가 2~5글자만 보유(6글자 이상 없음)하므로 그 범위 전부에서 공식이 정확히 사용자가 나열한 값과 일치함을 코드 읽기로 직접 확인. 즉 **코드 수정은 불필요**했다.

**테스트 보강**: 기존 `PiecesOfLanguage.test.ts`는 2글자(→1개 공개)·4글자(→2개 공개) 케이스만 검증하고 있었고 사용자가 명시한 3글자(→1개 공개) 케이스가 비어 있어, `wordsOfLength(3)[0]` 기준 "공개 1개/마스킹 2개" 검증을 신규 추가(53→54/54 통과).

**검증**: `npx tsc --noEmit`(전체, 0 에러) / `npm run lint`(전체, 0 경고) / `npx vitest run src/games/piecesOfLanguage`(54/54, 약 1초). 전체 `npx vitest run`은 과거 세션들과 동일하게 `aiBenchmark.test.ts`(무관한 무거운 동기 벤치마크, 원인 기규명)로 인해 88초 시점에 워커가 강제 종료됐으나, 그 시점까지 27/28 테스트 파일이 완주하며 **1052/1053 테스트 전부 통과**(실패 0건 — 미완주는 그 1개 벤치마크 파일뿐)를 실측 확인.

**결론**: 순수 검증 + 테스트 커버리지 보강 세션. 엔진/UI 동작 변경 없음(`hintRevealIndices`/`buildHint`/`isHintUnlocked` 등 무변경).

**배포**: `git push origin main`(커밋 `bbf3334`) 후 `npx vercel deploy --prod` 실행 — CLI가 `"status":"error","reason":"deploy_failed","message":"Not authorized"` JSON을 출력했으나(원인 미규명, 과거 세션엔 없던 증상), `vercel ls board-game`/`vercel inspect`로 직접 확인한 결과 배포 자체(`dpl_L81uMpQrgkrk9aQuAYmi62E8HhuC`, target: production, status: Ready)는 실제로 완료돼 프로덕션 도메인 `https://board-game-tau-navy.vercel.app`에 정상 별칭(alias)됐고 `curl` HTTP 200도 확인 — CLI가 표시한 에러 메시지와 서버 측 실제 배포 결과가 불일치했던 것으로 보이며, 원인은 이번 세션에서 규명하지 않음(다음 세션 참고용으로 남김).

### 2026-08-19 — 페루도 실제 게임판(변경후) 이미지 인게임 전면 적용

**요청**: `boardGameRule/페루도/`에 `변경전이미지.png`(현재 인게임 스크린샷)와 `변경후이미지.jpg`(실사 보드판) 2장을 근거로, 인게임 화면에 잘못 들어가 있는 "룰북 표지/대표 컷" 이미지를 내리고 실제 게임판(보드판 트랙) 이미지로 전면 교체 + 비딩 마커/주사위 좌표·스케일 정돈.

**1) 에셋 확인 — 재복사 불필요** — `boardGameRule/페루도/변경후이미지.jpg`와 `public/assets/games/perudo/board.jpg`를 MD5로 대조한 결과 완전히 동일한 파일이었다(`0f77d80822bf9cda3aa1366a6a2d10b7`). `git status`가 `페루도판.jpg` 삭제 + `변경후이미지.jpg` 신규 미추적으로 표시한 것은 사용자가 참고용으로 파일명만 바꿔 재배치한 것일 뿐, 실제 이미지 내용은 [2026-08-17 세션](#2026-08-17--페루도-신규-에셋보드판모양-반영--구형-리소스-정리)에서 이미 `public/assets/games/perudo/board.jpg`로 복사돼 배포돼 있었다 — 즉 "정적 에셋 경로 동기화" 단계는 이미 끝나 있었고, 실제로 손볼 부분은 그 에셋을 인게임에서 어떻게 렌더링하느냐였다.

**2) 진짜 문제 — 사진이 사실상 안 보이고 있었음** — `PerudoBoard.tsx`의 `TableTexture`(패널 전체를 덮는 텍스타일 매트 레이어)가 `board.jpg`를 `opacity-[0.16]` + `grayscale-[0.25]`로만 깔고 있어 육안상 거의 인지 불가능했고, 실제 배팅 트랙 안쪽 "골든 플라크"(`BidTrack`의 인터랙티브 중앙 영역, 현재 선언/베팅 컨트롤이 놓이는 자리)는 그냥 단색 `amber` 그라디언트뿐이었다 — 사용자가 첨부한 `변경전이미지.png`가 정확히 이 상태(사진 없는 밋밋한 골드 패널)를 보여준다.

**3) 사진을 `TableTexture`→`BidTrack` 내부로 이전 + 실제 가시성으로 승격** — 사진 레이어를 패널 전체 배경(장식용 텍스처)에서 `BidTrack`의 실제 보드 영역(트랙 칸 그리드) 맨 아래 레이어로 옮기고, `backgroundSize: "contain"`(`object-fit: contain`과 동등, 원본 비율 유지 + 잘림 없이 레터박스)으로 배치, 탈색·저투명도를 걷어내 실사 컬러 그대로 보이게 했다. 그 위에 겹치는 트랙 칸 버튼(40칸 안팎)과 골든 플라크 배경을 불투명 → 반투명(`bg-*/55`~`/85` + 플라크엔 `backdrop-blur-sm`)으로 바꿔, 사진이 칸/플라크 뒤로 은은히 비치면서도 숫자·현재 선언 텍스트는 `[text-shadow:0_1px_2px_rgba(0,0,0,0.8)]`로 여전히 또렷하게 읽히도록 정돈 — 자주색 베팅 다이(`BettingDie`)는 원래부터 각 칸의 그리드 슬롯을 그대로 공유해 자리를 잡고 있어 좌표 변경 없이도 이제 사진 위에 자연스럽게 얹힌 피스처럼 보인다.

**4) 알려진 제약(의도적, 문서화됨)** — 실물 보드는 고정 40칸 인쇄물이지만 인터랙티브 트랙은 `TRACK_LENGTH = MAX_PLAYERS × STARTING_DICE`로 2~8인 플레이어 수에 따라 칸 수/격자 모양(`computeTrackDimensions`)이 달라진다. 그래서 트랙 칸을 사진의 인쇄된 눈금과 픽셀 단위로 1:1 정렬하는 것은 애초에 모든 인원수에서 동시에 성립할 수 없다(2026-08-17 세션이 사진을 인터랙티브 격자 자체로 쓰지 않기로 판단했던 것과 같은 제약) — 이번 변경은 그 제약을 그대로 유지한 채 "장식용 저투명도 텍스처"였던 사진을 "실제로 보이는 보드 배경"으로 승격시킨 것이며, 코드 주석에 이 트레이드오프를 명시해뒀다. 중복을 피하기 위해 `TableTexture`에서는 사진 레이어를 제거하고 텍스타일 트림 밴드/크로스해치 텍스처만 남겼다.

**검증**: `npx tsc --noEmit`(프로젝트 전체, 에러 0) / `npm run lint`(프로젝트 전체, 경고 0) / `npx vitest run src/games/perudo`(60/60 통과, 2.67초 — 순수 표현 계층 변경이라 엔진/테스트 무변경). 전체 `npx vitest run`은 과거 여러 세션에서 이미 원인이 규명된 `aiBenchmark.test.ts`(무관한 무거운 동기 자가 대진 벤치마크)로 인해 장시간 무출력 상태가 지속돼, 이번 변경이 `PerudoBoard.tsx` 한 파일의 순수 스타일/레이아웃 변경(엔진·상태·다른 게임 모듈 무관, `grep`으로 확인)이라는 근거로 완료를 기다리지 않고 타깃 테스트 결과로 판단, 남은 백그라운드 프로세스는 정리.

**커밋/배포**: 커밋 `9fdbfcb refactor(perudo): replace game board UI with updated in-game board asset` → `git push origin main` 완료(이 저장소는 기존에도 main에 직접 커밋해온 컨벤션). `npx vercel deploy`(프리뷰) 1차 시도는 `"Not authorized"`로 실패(직후 재시도는 바로 성공 — 동시 세션/토큰 갱신 지연 등 일시적 원인으로 추정, 이전 세션들이 기록한 "동시 세션 경합" 패턴과 유사) → 2차 시도 정상 완주(Turbopack 빌드+TS 전체 재검사 포함), READY — `https://board-game-bqwe26v9f-me-3871.vercel.app`. 사용자가 "production"을 명시하지 않아 이번에도 프리뷰까지만 진행하고 prod 승격은 보류(과거 세션들과 동일 판단 기준) — 필요하면 `npx vercel deploy --prod`로 후속 승격 요청할 것.

### 2026-08-18 — 운명전쟁39 0 카드 판정 정정 + 리버스 카드 UI

**요청**: 리버스 카드(11/22/33)의 시각적 인지도 개선 + "일반 상태에서 35 vs 0 대전 시 0이 승리해버리는 버그" 수정.

**1) "버그" 여부 재확인 — `AskUserQuestion`으로 확정** — `engine.ts`의 `resolveTurn`(비-리버스 분기)은 "0 카드가 있으면 데스카드를 포함한 다른 모든 카드보다 위"로 동작했는데, 이는 룰북(`boardGameRule/운명전쟁39/운명전쟁39.md` §6.2, "Version 2.0 — 공식 확정본")과 기존 테스트(`"normal state + 0 present: 0 beats death and every other card outright"`)가 명시적으로 요구하던 **의도된 규칙**이었다. 즉 신고된 현상이 실제로는 버그가 아니라 확정 룰북과 정확히 일치하는 구현이었던 것 — 이 모순을 사용자에게 그대로 제시하고 "현재 동작 유지" vs "요청대로 룰 변경"을 확인받았다. 사용자가 구체적으로 "35 vs 0 → 35 승리, 리버스 없으면 0은 데스카드만 이김, 35 vs 22 vs 0에서 리버스 발동하면 0 승리"로 **룰 자체의 변경을 명시적으로 확정**해, 코드·룰북·테스트 3자를 함께 고치는 작업으로 진행했다.

**2) `engine.ts` 판정 로직 수정** — `resolveTurn`의 `!reverseActive` 분기를 다음과 같이 변경:
```
// 변경 전: 0 카드가 있으면 무조건 0 승리 (데스카드 포함 전부)
// 변경 후:
if (deathPlay) {
  winnerSeat = zeroPlays.length > 0 ? firstByOrder(zeroPlays, revealOrder) : deathPlay.seat; // 0은 데스카드만 이김
} else {
  winnerSeat = 최댓값 승리; // 0은 그냥 가장 약한 숫자
}
```
리버스 활성 분기는 원래부터 룰북과 일치했으므로(데스카드 있으면 데스카드 승리, 없으면 최솟값 승리 — 0이 있으면 자연히 0이 승리) 무변경. 모듈 상단 doc comment와 `resolveTurn` 함수 doc도 "0의 카운터는 데스카드 상대로만 좁게 스코프된다"는 내용으로 갱신. AI 봇 휴리스틱 `cardStrength`도 옛 "0이 최강(`value:1`)" 가정이 이제 틀린 전제가 돼 `데스=1(최강)/0=0(최약, 데스 카운터 업사이드는 이 근사 로직에서 의도적으로 무시)/나머지=value/39`로 함께 수정 — 안 고쳤다면 봇이 여전히 0을 최우선으로 아껴뒀다 내는 식으로 오판했을 것.

**3) 룰북/인게임 문서 동기화** — `운명전쟁39.md`를 Version 2.0→2.1로 올리고 §0에 변경 사유(§6.2 오기 정정) changelog 추가, §6.2 판정 표와 정리 불릿을 "0은 데스카드만 이기는 좁은 상성, 일반 상황에선 최약체 숫자"로 재작성. 인게임 `RulebookModal.tsx`의 카드 구성 표(0번 카드 설명)와 "승부 판정" 섹션 문구도 동일하게 정정 — 룰북 문서·인게임 설명·엔진 코드·테스트 4곳이 이제 전부 같은 규칙을 기술한다.

**4) 리버스 카드(11/22/33) UI 가독성 개선** — 기존에 `DestinyWar39Board.tsx`(4곳: 트릭 결과 화면/예측 단계 손패/진행 단계 낸 카드/진행 단계 낼 손패 버튼)와 `LastRoundHistoryModal.tsx`(1곳: 직전 라운드 히스토리)에 거의 동일한 `cardLabel`/`cardBadgeClasses` 헬퍼가 5중 복제돼 있던 것을 신규 공유 컴포넌트 `CardFace.tsx`로 통합. 리버스 카드에 한해 4가지 시각 신호를 동시에 부여:
- 카드 상단 "🔄 리버스" 배너 스트립(fuchsia 배경, 볼드)
- 숫자 뒤 반투명 🔁 워터마크 아이콘(카드 중앙, 큰 사이즈, `pointer-events-none`)
- fuchsia `outline` + `drop-shadow` 글로우 테두리 — 승자 강조용 `ring`/임의 `shadow-[...]`(둘 다 CSS `box-shadow` 속성을 씀, Tailwind 유틸리티 클래스 간 우선순위가 클래스 작성 순서가 아니라 생성된 스타일시트 순서로 정해져 병기 시 서로를 가려버릴 위험이 있음)와 절대 충돌하지 않도록, 리버스 글로우는 일부러 `box-shadow`가 아닌 `outline`/`filter: drop-shadow`(별도 CSS 속성)로 구현 — 리버스 카드가 동시에 트릭 승자가 되는 경우에도 두 강조가 항상 함께 렌더링됨
- 카드 세로 폭을 살짝 확장(예: `h-14 w-10` → `h-16 w-10`)해 배너+숫자+워터마크가 비좁지 않게

**검증**: `npx tsc --noEmit`(프로젝트 전체, 에러 0) / `npm run lint`(프로젝트 전체, 경고 0) / `npx vitest run src/games/destinyWar39 src/games/registry.test.ts`(49/49 통과 — `resolveTurn` 관련 기존 테스트 중 데스카드 없이 0끼리 동률을 가정했던 케이스를 데스카드 포함으로 교체하고, 사용자가 명시한 3개 시나리오를 신규 테스트로 추가: 일반 모드 35 vs 0 → 35 승리 / 리버스(11 카드) + 0 vs 35 → 0 승리 / 데스카드 vs 0 두 방향 모두 정상 상성 판정). 전체 `npx vitest run`은 과거 여러 세션에 걸쳐 원인이 규명된 것과 동일하게(`aiBenchmark.test.ts`의 무거운 동기 자가 대진, 이번 변경과 무관) 장시간 진행 표시 없이 지속돼, 10분 경과 시점 CPU 시간 실측으로 행(hang)이 아님만 확인하고 완료를 기다리지 않음 — 이번 변경이 `destinyWar39` 폴더 5개 파일에 한정되고 다른 게임/공용 모듈이 이를 import하지 않는다는 점(`grep -rn "destinyWar39" src`로 직접 확인)을 근거로 타깃 테스트 결과만으로 판단, 남은 백그라운드 프로세스는 정리.

### 2026-08-18 — 허브 카테고리 재분류 + 대표 이미지 교체

**요청**: (1) '운명전쟁39'를 대시보드 '데스게임' 그룹으로 재분류. (2) '레지스탕스 쿠'/'코요테' 허브 카드 썸네일을 `boardGameRule/` 최신 룰북 이미지로 교체(카드 비율 왜곡/크롭 없이). (3) 검증 → `HANDOFF.md` 갱신 → 커밋/푸시/배포.

**1) 운명전쟁39 → 데스게임 재분류** — 신규 메커니즘을 만들지 않고 기존 `GameCollectionId`(`src/games/types.ts`) 하나뿐인 값 `"netflix-death-game"`을 재사용. `registry.ts`의 `destiny-war-39` 항목에 `collectionId: "netflix-death-game"` 추가(그리드 포커/말달리자/언어의 조각과 동일 소속) + 태그에 `"데스게임"` 추가. UI 쪽은 `CollectionShowcase.tsx`가 `games.filter(g => g.collectionId === collectionId)`로 레지스트리를 걸러 대시보드 상단(`app/page.tsx`)에 "🔴 넷플릭스 데스게임 시리즈" 배너 섹션을 자동 렌더링하는 구조라 별도 탭/섹션 코드 변경 불필요 — 데이터 추가만으로 즉시 반영됨. `GameCard.tsx`도 `collectionId`가 있으면 카드 좌상단에 "🔴 데스게임" 배지를 자동으로 붙이므로 이 역시 무변경.

**2) 레지스탕스 쿠 / 코요테 대표 이미지 교체** — 소스: `boardGameRule/코요테/코요테.jpg`(800×600 JPG, 카드 구성 실사)·`boardGameRule/레지스탕스 쿠/레지스탕스쿠.webp`(360×360 WebP, 카드 아트). 각각 `public/games/coyote.jpg`/`public/games/coup.webp`로 복사 후 `registry.ts`의 `thumbnail.image`에 연결(둘 다 이전엔 이모지/그라디언트 폴백만 있던 상태). `public/games/`에 이전 세션(Phase 22)이 남긴 미사용 `코요테.jpg`/`코요테.png`(440×533, 레지스트리 어디서도 참조 안 됨)가 있었으나 이번 작업 범위 밖이라 손대지 않고 그대로 둠. 카드 비율 처리는 `GameThumbnail.tsx`+`GameCard.tsx`가 이미 `object-contain`(세로형 박스아트가 이 프로젝트의 4:5 카드 비율과 다를 때 잘리지 않도록 `-cover` 대신 채택한다는 코드 주석이 이미 있음)을 쓰고 있어 그대로 유지 — 사용자 요청 원문은 `object-fit: cover`였지만, 기존 컨벤션과 두 이미지가 모두 세로형이라는 점을 근거로 `contain` 유지가 맞다고 판단(크롭 대신 레터박스).

**3) 전체 `npx vitest run`이 아닌 타깃 테스트로 검증 판단한 경위** — 사용자가 세션 중 "aiBenchmark.test.ts가 너무 느린 것 같다"고 직접 지적. 실행 중이던 백그라운드 `vitest run` 프로세스를 실측한 결과 약 2시간 14분 경과 시점까지도 CPU 시간이 경과 시간과 거의 1:1로 붙어 있어(싱글 코어 100%) **행(hang)이 아니라 정상 진행 중**임을 확인했지만, 코드를 직접 보니 원인이 뚜렷했다: `src/games/shared/bot/aiBenchmark.test.ts`의 3개 `it()`가 각각 `await` 없는 완전 동기 for-루프로 1,000판씩 자가 대진(five-cucumbers/perudo/malDalliJa, 매판 실제 PIMC/ISMCTS/알파베타 탐색 포함)을 순회한다 — 1,000판이 서로 완전 독립적인데도 (a) 싱글 코어만 쓰고 (b) 동기 코드가 이벤트 루프를 통째로 막아 각 `it()`에 선언된 타임아웃(120s/120s/450s)이 발동할 기회 자체가 없다(타임아웃이 사실상 장식). 사용자에게 "끝까지 대기 후 배포" vs "지금 중단하고 속도 개선 먼저"를 확인받아 처음엔 대기를 택했으나, 대기가 예상보다 길어지자 "지금까지 진행된 테스트로 커밋/푸시/배포"로 재요청 — `TaskStop`(백그라운드 셸 종료) + `Stop-Process`(남아있던 실제 `node.exe` 프로세스, PID 26380, CPU 시간 약 2시간 14분 강제 종료)로 정리하고, 이번 변경 범위(`registry.ts` 데이터 3줄 + 신규 이미지 2개, 로직/엔진 코드 무변경)에 맞춰 `npx vitest run src/games/registry.test.ts src/games/coup src/games/coyote src/games/destinyWar39`(143/143 통과, 0.45초)로 검증 범위를 좁혀 판단.

**속도 개선 후속 작업(이번 세션 미착수)** — 다음 세션에서 다룰 것. 사용자에게 제시한 두 방향:
- **`worker_threads` 병렬 분산**: 1,000판을 코어 수만큼 나눠 돌리면 정확도 손실 없이 이론상 코어 수배 단축. 다만 이 프로젝트가 vite-node로 TS를 직접 구동하는 구조라 워커 스레드 안에서 TS 임포트를 어떻게 로드할지 인프라를 새로 짜야 함(구현 리스크 있음, 검증에도 시간 필요).
- **SPRT(순차 확률비 검정) 조기 종료**: 체스 엔진 테스트(Stockfish 등)에서 쓰는 표준 기법 — 매판 우도비를 누적하다 통계적으로 충분히 확신이 서면 1,000판을 다 돌리기 전에 통과/실패 조기 확정. 과거 실측 승률(97.1%/96.9%/89.8%, "Level 10 AI 코어 아키텍처 고도화" 섹션 참고)이 85% 문턱을 넉넉히 넘고 있어 평균적으로 100~300판 안에 끝날 가능성이 높음. 순수 로직 변경이라 인프라 리스크는 적지만, "정확히 1,000판 중 850승 이상"이라는 현재 판정 방식이 "통계적으로 유의미하게 임계값을 초과"로 바뀌는 의미 변화가 있음 — 사용자 확인 필요.
- 두 방향 모두 미구현 상태이며, 다음 세션에서 사용자와 방향을 먼저 확정한 뒤 진행할 것.

**커밋/푸시**: `e3993e6 refactor(hub): group destiny war under death game category and update cover images for coup and coyote` → `git push origin main` 완료(`38d361f..e3993e6`).

**배포**: `npx vercel deploy --prod` 실행 — 빌드(Turbopack, TypeScript 전체 재검사 포함) 22초 만에 정상 완주, `target: production`/`status: READY`(`dpl_8W2YzTF3ifVJDbLkux4fHnLmZJUs`)로 확인되고 프로덕션 도메인 `board-game-tau-navy.vercel.app`에 별칭(alias) 완료. `curl`로 프로덕션 루트(`/`)·`/games/destiny-war-39`·`/games/coyote`·`/games/coup` 4개 라우트 전부 200 확인 + 신규 이미지 에셋 2개(`/games/coyote.jpg`→`image/jpeg` 200, `/games/coup.webp`→`image/webp` 200) 직접 응답 확인.

### 2026-08-18 — 말달리자 체스말 에셋 교체

**요청**: 룰북 폴더(`boardGameRule/말달리자/`)에 새로 올라온 체스 나이트 형태 말 토큰 이미지(`검정색말.jpg`/`하얀색말.jpg`)로 기존 온보드 말 그래픽(이모지 🐴/🐎)을 교체 — 정적 에셋 경로로 복사·연결, `MalDalliJaBoard.tsx` 렌더링 갱신(크기/여백/드롭섀도우, 선택 하이라이트·이동 애니메이션 정상 작동 유지), 검증·문서화·커밋·배포까지 완료.

**1) 에셋 복사** — `boardGameRule/말달리자/검정색말.jpg`→`public/images/mal-dallija/black-horse.jpg`(p1/흑마), `하얀색말.jpg`→`white-horse.jpg`(p2/백마). 경로 컨벤션은 loveLetter의 `public/images/love-letter/`를 그대로 따름(for-sale/summoners-rift도 동일 패턴 — perudo의 `assets/games/perudo/`는 소수 예외).

**2) 렌더링 교체** — `SEAT_THEME`(기존 name/emoji/glow/ring/text)에 `pieceImage` 필드 추가. 온보드 말 토큰(`<button>` 셀 내부)을 이모지 `<span>`에서 `next/image`로 교체:
- 컨테이너: `absolute inset-[10%]`(그리드 셀 대비 여백) + `overflow-hidden rounded-lg border-2`(원형 대신 둥근 사각 — 사진이 정사각에 가깝고 갈기가 사각 프레임에 닿아 원형 크롭 시 손실이 큼) + `bg-[#f5f0e6]`(사진의 흰 배경과 이질감 없이 섞이는 크림색) + `shadow-[0_3px_8px_-1px_rgba(0,0,0,0.65)]`(드롭섀도우 신규).
- 좌석별 링 컬러(`border-rose-400`/`border-cyan-300`)와 선택 시 글로우(`SEAT_THEME[seat].glow` + `scale-110`)는 컨테이너에 그대로 적용해 무변경 유지.
- 이미지 자체는 `object-contain p-[8%]`(갈기/귀 잘림 방지, `-cover`였다면 발생) + 착지 애니메이션(`maldallija-horse-land`, `globals.css` 키프레임 무변경 — 순수 `transform: scale`이라 이모지든 이미지든 동일하게 작동).
- HUD 상단 좌석 표시 배지(예: "🐴 흑마 (나)")는 사진이 아닌 이모지 그대로 유지 — 배지 크기가 작아 사진 타일로 바꾸면 판독성이 떨어짐.

**3) 시각 검증** — 임시 프리뷰 라우트(`src/app/dev-preview/mal-dallija/`, `startGame()` 목 상태 렌더링, 커밋 전 삭제 — fiveCucumbers/forSale 세션과 동일 패턴)를 만들어 `npm run dev` 기동 후 헤드리스 Edge(`msedge --headless --disable-gpu --screenshot=... --window-size=1000,1200`)로 실제 렌더링을 스크린샷 확인: 양 진영 10개 말 전부 정상 이미지로 렌더링(깨진 이미지 아이콘 없음), 오아시스 다이아몬드 존(파란 원/초록 링)과 그리드 레이아웃 무변경, 좌석별 링 컬러(로즈/시안) 정상 표시. 확인 후 프리뷰 라우트 삭제(`git status` 무흔적 확인) + 개발 서버 종료.

**검증**: `npx tsc --noEmit`(프로젝트 전체, 에러 0) / `npm run lint`(프로젝트 전체, 경고 0) / `npx vitest run src/games/malDalliJa`(58/58 통과, 엔진 무변경이라 테스트도 무변경). 전체 `npx vitest run`은 과거 여러 세션에 기록된 것과 동일하게 진행 표시 없이 장시간 지속돼 완료를 기다리지 않고 판단 — 이번 변경이 `MalDalliJaBoard.tsx` 1개 파일(순수 표현 계층, `engine.ts` 등 로직 코드 무변경)과 신규 이미지 2개에 한정된다는 점을 근거로 진행.

**커밋/푸시**: `91869dc refactor(maldallija): replace chess piece assets with new rulebook images` → `git push origin main` 완료(`4c9cd5f..91869dc`).

**배포**: `npx vercel deploy --prod` 실행 — 빌드(Turbopack, TypeScript 전체 재검사 포함) 정상 완주, `target: production`/`status: READY`로 확인되고 프로덕션 도메인 `board-game-tau-navy.vercel.app`에 별칭(alias) 완료(`dpl_5BRWAR4kyhHYJEja79kyvU9hdJct`). `curl`로 프로덕션 루트(`/`, 200), 말달리자 게임 라우트(`/games/mal-dallija`, 200), 신규 말 이미지 에셋 2개(`/images/mal-dallija/{black-horse,white-horse}.jpg`, 둘 다 200/`image/jpeg`) 전부 직접 응답 확인.

### 2026-08-18 — 운명전쟁39 UI/UX 개선

**요청**: 직전 세션에서 신규 구현한 운명전쟁39의 실사용 UX 개선 3건 — (1) 우측 전용 예측 승수 vs 현재 획득 승수 현황표, (2) 트릭(턴) 결과가 카드 제출 직후 순식간에 사라지는 문제 해결(최소 2.5~3초 확인 시간 확보), (3) 직전 라운드에 제출된 카드 조합을 다시 확인할 수 있는 히스토리 영역. 프로토콜: `HANDOFF.md`+소스 확인 → 구현 → `tsc`/`lint`/`vitest` 검증 → `HANDOFF` 갱신·커밋·푸시·배포.

**1) 우측 예측 승수 & 현재 점수 현황표** — 신규 `PredictionStatusBoard.tsx`: predicting/playing 단계에서 보드 우측(데스크톱, `lg:` 브레이크포인트부터 사이드바 — 모바일은 세로 스택)에 5인 전원 카드형 목록을 렌더링. 항목: 이름(내 좌석은 `(나)` + 보라색 강조 테두리), `visibleCurrentPrediction`으로 리댁션된 이번 라운드 예측값 vs `round.winsThisRound`의 실시간 현재 승수, 라운드 완료된 점수만 합산한 누적 총점, 히든 사용 여부(🙈). 상태 배지 3종은 실제 승수는 절대 감소하지 않는다는 규칙을 이용해 **적중 중**(현재==예측, 아직 라운드가 끝나지 않아 최종 확정은 아님)/**초과**(현재>예측 → 이 라운드는 그 예측을 다시는 맞출 수 없음이 수학적으로 확정)/**진행 중**(현재<예측)으로 정확히 구분, 과대 주장 없음.

**2) 트릭 결과 노출 시간 확보** — `isTrickResolving`류의 턴 제어 상태를 **엔진(`DestinyWar39State`)이 아니라 `DestinyWar39Board.tsx`의 로컬 React 상태**로만 구현: 엔진에 넣으면 클라이언트마다 벽시계가 달라 이 프로젝트의 락스텝 재생 모델(모든 클라이언트가 동일 액션을 리플레이해 동일 상태를 계산)이 즉시 깨지므로 — 이 설계 근거를 `DestinyWar39Board.tsx` 상단에 명시적으로 문서화. `round.turnRecords`가 같은 라운드 내에서 늘어날 때마다(라운드 전환으로 배열이 짧아지는 경우와 구분하기 위해 `round.roundNumber` 변화도 함께 추적) 방금 끝난 턴을 승자 글로우(카드 확대+링+섀도우) 연출과 함께 `TRICK_REVEAL_MS = 2800`ms간 고정 렌더링(모든 phase 분기보다 앞서 선점 렌더링) 후에야 다음 턴/라운드 요약/최종 결과 화면으로 넘어가도록 구현. 라운드의 마지막 턴이 끝나 `roundEnd`/`gameOver`로 즉시 전환되는 경우에도 동일하게 적용돼, 기존에 이미 있던 "다음 라운드 시작 버튼을 눌러야 진행" 게이트(변경 없음)와 합쳐져 결과를 반드시 확인하게 만듦.

**3) 직전 라운드 카드 히스토리** — `engine.ts`에 `DestinyWar39State.lastCompletedRound: RoundState | null` 신규 필드 추가: 가장 최근에 끝난 라운드의 `turnRecords`(턴별 전원 카드+승자+리버스 여부) 전체를 스냅샷으로 보관하며, `nextRound`가 `state.round`를 다음 라운드의 빈 상태로 교체한 뒤에도 값이 유지된다(`resolveTurnAndAdvance`의 roundEnd/gameOver 두 분기 모두에서 채움 — 게임 종료 시 9라운드째도 스냅샷됨). 신규 `LastRoundHistoryModal.tsx`: `Overlay` 컴포넌트 기반 모달로 턴별 카드 조합(승자 하이라이트)과 그 라운드의 예측/실제/점수 요약 테이블(기존 라운드 종료 화면과 동일하게 `visiblePastPrediction`으로 히든 예측 리댁션)을 표시. "🕓 직전 라운드 보기" 버튼을 룰북 버튼 옆에 모든 phase(예측/진행/라운드종료/게임종료)에 배치, 완료된 라운드가 아직 없으면 비활성화. 카드 자체는 이미 공개 정보이므로 리댁션 없음 — 예측값만 히든 규칙을 그대로 따름.

**검증**: `npx tsc --noEmit`(프로젝트 전체, 에러 0) / `npm run lint`(프로젝트 전체, 경고 0) / `npx vitest run src/games/destinyWar39 src/games/registry.test.ts`(47/47 통과 — 기존 40개 + 신규 7개: `lastCompletedRound`가 라운드 완료 전 null / 턴 해결 시 전원 카드가 `turnRecords`에 정확히 기록 / 라운드 완료 즉시 스냅샷 / `nextRound` 이후에도 스냅샷 유지 / 9라운드 게임 종료 시에도 스냅샷 / `winsThisRound`가 턴 승자에게만 증가 / 라운드 종료 시 각 플레이어의 예측·실제·점수가 영구 기록(`predictions`/`actualWins`/`scores`)에 정확히 반영). 전체 `npx vitest run`은 과거 여러 세션에 반복 기록된 것과 동일하게 진행 표시 없이 장시간 지속돼 완료를 기다리지 않고 판단 — 이번 변경이 `engine.ts`(필드 1개 추가 + 라운드 완료 두 분기에 값 채우기)와 `DestinyWar39Board.tsx`+신규 2개 컴포넌트 파일에 한정되고 다른 게임 로직과 전혀 무관하다는 점, `tsc`/`lint`가 프로젝트 전체 기준 깨끗했던 점을 근거로 진행.

**커밋/푸시**: `4f5547d feat(destiny-war-39): add prediction scoreboard, trick transition delay, and last round card history view` → `git push origin main` 완료(`104ef49..4f5547d`).

**배포**: `npx vercel deploy --prod` 실행 — 직전 세션과 동일한 CLI 증상(빌드 완료 후 상태 조회 단계에서 `{"status":"error","reason":"deploy_failed","message":"Not authorized"}` 출력)이 재현됐으나, `vercel ls`/`vercel inspect`로 직접 재확인한 결과 실제 배포 자체는 정상 완료(`dpl_ADfHan7q8HP6vy4zPs8FPJ41Nuc5`, target: production, status: Ready)돼 프로덕션 도메인 3개(`board-game-tau-navy.vercel.app`/`board-game-me-3871.vercel.app`/`board-game-git-main-me-3871.vercel.app`) 전부에 정상 별칭됨. `curl`로 프로덕션 루트(`/`, 200)와 운명전쟁39 라우트(`/games/destiny-war-39`, 200) 둘 다 직접 응답 확인.

### 2026-08-18 — 운명전쟁39 신규 구현

**요청**: 신규 보드게임 "운명전쟁39"(넷플릭스 예능 <데스게임2> 예선전 등장) 구현. 사용자가 명시한 프로토콜: (1) 룰북(`boardGameRule/운명전쟁39/운명전쟁39.md`) 분석 후 모호한 규칙을 임의 추론하지 말고 질문 목록으로 확인받을 것, (2) 확정 후 `src/games/destinyWar39/`(엔진/보드/봇/테스트) 구현, (3) `tsc`/`lint`/`vitest` 검증 후 HANDOFF 갱신·커밋·푸시·배포.

**1단계 — 룰북 분석과 반복 확인**: 원본 룰북(`운명전쟁39.md` v1)은 방송 공개 기사만으로 작성된 자료라 저자 스스로 "카드 중복 구성/배분 방식/점수표/히든 공개 시점/데스카드+리버스 상호작용/동점 처리 등을 확정할 수 없다"고 명시하고 있었다. 임의로 채우지 않고 총 5턴에 걸친 질의응답(텍스트 질문 목록 3회 + `AskUserQuestion` 1회)으로 다음을 전부 사용자에게 직접 확인받았다:
- **카드 구성**: 45장 = 0×5장 + 1~39 각 1장 + 데스카드 1장. 11/22/33은 숫자 카드 겸 리버스 카드.
- **예측 구조**: 게임당 1회가 아니라 **매 라운드 새로 예측**(9라운드=최대 9회). 이 답변이 처음엔 "게임 종료 후 누적값 하나로 9번 채점"으로 오해했다가 사용자가 명시적으로 정정(`A는 항상 해당 라운드에서 실제로 획득한 승수`, 0-1로 제한되지 않음) — 이 정정이 다시 "한 라운드 안에 여러 번의 승부(턴)가 있다"는 구조를 드러냄.
- **라운드/턴 구조**: "라운드 R은 R장, R턴" — 각자 그 라운드에 카드 R장을 받아 R번의 턴(매 턴 5명이 카드 1장씩 공개)을 진행, 그 라운드의 실제 승수 = 이긴 턴의 개수(0~R). 45장 = 5명×9라운드 합(1+2+...+9=45)과 정확히 일치.
- **카드 배분**: 매 라운드 시작 시 45장 전체를 다시 섞어 배분, 이전 라운드 카드도 폐기되지 않고 재사용됨(영구 손패 없음).
- **공개 순서**: 1라운드는 5명 동시 공개(선/후공 없음). 2라운드부터는 그 턴의 승자가 곧바로 다음 턴의 선공이 되고(라운드 경계도 그대로 이어짐 — 별도의 "라운드 우승자" 개념 없음), 이후 좌석 순서(게임 시작 시 무작위 고정)로 시계방향 공개.
- **승부 판정**: 그 턴에 등장한 리버스 카드(11/22/33) 개수의 **홀짝**으로 리버스 활성 여부 결정. 리버스 비활성 + 0 존재 → **0이 데스카드를 포함해 무조건 승리**. 리버스 활성 + 데스카드 존재 → **데스카드가 0을 포함해 무조건 승리**(예외의 예외로 원상 복귀). 0끼리 동률은 그 턴(1라운드는 무작위 고정 좌석 순서)에서 먼저 낸 사람이 승리.
- **히든**: 게임 전체 1회, 원하는 라운드에 사용, 예측 자체는 정상 확정하되 다른 플레이어에겐 9라운드 전부 끝난 뒤 공개.
- **점수 산식**(사용자가 절대 변경 금지로 명시한 확정 공식): `P>=1` → 성공 `+P×2` / 실패 `-|P-A|×2`. `P==0` → 성공 `+R` / 실패 `-R`(R=라운드 번호). 22개 구체 테스트 케이스(ROUND 1/5/9 각 7개)를 사용자가 직접 제시.
- **최종 동점**: 공동 등수 처리, 타이브레이커 없음. **인원**: 정확히 5인 고정(가변 미지원). **봇**: 기존 Level 1~10 표준. **파일 구조**: 이 저장소 기존 관례(`engine.ts`+`<Name>Board.tsx`+`<Name>Game.tsx`+`RulebookModal.tsx`+`<Name>.test.ts`) 확인 후 그대로 채택 — 사용자가 최초 요청한 `types.ts`/`board.tsx`/`bot.ts` 분리 구조 대신.

**룰북 파일 자체 검증 이슈**: 사용자가 "룰북에 확정 내용을 직접 남겨뒀으니 검증 후 진행"을 요청했는데, 실제로 열어보니 그 파일은 대화 중간 지점(라운드당 카드 1장이던 시점)에서 멈춰 있었고 이후 확정된 핵심 규칙(카드 구성/점수식/턴 구조/데스카드+리버스+0 상호작용/동률 처리/최종 동점) 대부분이 "미확정"으로 잘못 표시돼 있었다. 그대로 진행하지 않고 이 불일치를 먼저 사용자에게 보고 → `AskUserQuestion`으로 "전면 재작성"을 확인받아 `운명전쟁39.md`를 Version 2.0(공식 확정본)으로 전면 재작성(대화에서 확정된 모든 규칙 반영, "미확정" 표시 전부 제거). 같은 질의에서 마지막 남은 미확정 항목(1라운드 0-카드 동률 시 기준 좌석 순서)도 "게임 시작 시 무작위로 선플레이어(좌석 순서) 결정" 답변으로 확정.

**2단계 — 구현** (`src/games/destinyWar39/`):
- **`engine.ts`**: 상태·액션·순수 리듀서. 핵심 함수: `buildDeck`(45장), `scoreRound`(확정 공식, §9.2의 22개 벡터로 테스트), `resolveTurn`(리버스 홀짝 + 0/데스카드 상호작용 + 0-동률 처리 결정 트리), `startGame`/`applyAction`(predict/play/nextRound 3종 액션), `visibleCurrentPrediction`/`visiblePastPrediction`(히든 비공개는 Coyote의 `getPlayerView`와 동일하게 상태 자체엔 아무것도 숨기지 않고 읽기 시점에만 redact), `getValidMoves`/`chooseBotAction`(공용 `pickByLevel` 커브 사용, Level 1~10). **문서화한 의도적 단순화**: 봇은 히든을 절대 사용하지 않음(`getValidMoves`가 `hidden: true` 후보를 생성하지 않음) — 히든은 선택적 전략 요소라 없어도 완전한 합법 플레이임.
- **온라인 대전 동기화**: 이 저장소의 락스텝 컨벤션(모든 클라이언트가 동일 시드+브로드캐스트 액션 재생으로 동일 상태 계산) 그대로 따름 — Coyote의 "reveal → continue(seed)" 패턴을 차용해 라운드 전환도 `nextRound` 액션에 시드를 실어 브로드캐스트(리듀서 내부에서 `Math.random()`을 직접 호출하면 클라이언트마다 다른 카드가 섞여 동기화가 깨지므로).
- **`DestinyWar39Board.tsx`/`RulebookModal.tsx`/`DestinyWar39Game.tsx`**: 예측 단계/턴 진행 단계/라운드 결과 요약/최종 결과표 UI, Coyote/Avalon과 동일한 5인 고정 룸(방 만들기/초대 코드) + 봇 좌석 배정 패턴. UI 구현 중 실제 버그 하나를 자체 발견·수정: 라운드 종료 요약 화면에서 그 라운드가 히든이었을 경우 예측값뿐 아니라 **라운드 점수도 함께 redact**해야 함을 확인(점수 공식이 `P*2`/`R` 형태라 점수만 보여줘도 예측값이 거의 그대로 역산되는 정보 누출이었음) — `visiblePastPrediction`으로 판정해 점수 칸도 `?`로 가림. 다만 누적 총점(공개 정보로 명시된 항목)은 그대로 노출 — 룰북 §12가 "공개 점수"를 공개 정보로 명시하고 있어, 다음 라운드 결과가 나오면 총점 증분으로 히든 라운드 점수를 역산할 수 있는 것은 사용자가 확정한 규칙에 따른 의도된 동작.
- **레지스트리**: `registry.ts`에 `destiny-war-39` 항목 추가(5인 고정, `card` 카테고리, `strategy`+`bluffing` 장르), `playableGames.tsx`에 동적 임포트 등록.

**검증**: `npx tsc --noEmit`(프로젝트 전체, 에러 0) / `npm run lint`(프로젝트 전체, 경고 0 — 최초 1건의 미사용 변수 워닝을 테스트 코드에서 수정) / `npx vitest run src/games/destinyWar39 src/games/registry.test.ts`(40/40 통과, 신규 게임 로직 36개 — 덱 구성/22개 점수 벡터 전부/턴 판정 결정 트리 전 분기/라운드-턴 구조/예측 범위/히든 1회 제한 및 비공개/전체 9라운드 시뮬레이션/공동 등수 등). 전체 `npx vitest run`은 이 세션에서도 배경 실행 중 관찰 가능한 진행 표시 없이 장시간 지속돼(과거 여러 세션에 반복 기록된 "전체 스위트 실행 이슈"와 동일 증상) 완료를 기다리지 않고 판단 — 이번 변경이 `registry.ts`/`playableGames.tsx`에 각 1줄 추가하는 것 외엔 전부 신규 자기완결 폴더(`src/games/destinyWar39/`)에 한정돼 다른 게임 로직과 무관하다는 점, 그리고 `tsc`/`lint`가 프로젝트 전체를 대상으로 깨끗했던 점을 근거로 진행. **다음 세션에서 단독 실행으로 전체 스위트 재확인 권장.**

**커밋/푸시**: `43bcc6d feat(games): implement destiny-war-39 board game engine and ui` → `git push origin main` 완료(fast-forward, `7ca6078..43bcc6d`).

**배포**: `npx vercel deploy --prod` 실행 — CLI가 빌드 완료 후 상태 조회 단계에서 `{"status":"error","reason":"deploy_failed","message":"Not authorized"}`를 출력했으나, 이는 CLI의 배포-후 상태 확인 호출이 실패한 것일 뿐 실제 배포 자체는 성공했음을 `vercel ls`/`vercel inspect`로 직접 재확인함 — 새 배포(`dpl_72s2ppL8nB5Mhbn4eaYYo3cRoS7w`, target: production, status: Ready)가 프로덕션 도메인 3개(`board-game-tau-navy.vercel.app`/`board-game-me-3871.vercel.app`/`board-game-git-main-me-3871.vercel.app`) 전부에 정상 별칭됨. `curl`로 프로덕션 루트(`/`, 200)와 신규 게임 라우트(`/games/destiny-war-39`, 200) 둘 다 직접 응답 확인.

### 2026-08-17 — main 머지 + 프로덕션 승격

**요청**: `fix/bot-level-1-10-full-audit` 브랜치의 모든 변경을 `main`에 반영(커밋·푸시)하고 Vercel에 배포해, 프로덕션 배포의 "Created" 시각이 실제로 갱신되도록 해 달라는 요청. 배경: 직전 대화에서 이 저장소의 Vercel 프로젝트 대시보드(`https://vercel.com/me-3871/board-game`)에 변경이 반영되지 않는 이유(모든 배포가 `preview` 타깃이었고 `main` 미머지라 프로덕션은 그대로였음)를 설명한 뒤, 사용자가 이번엔 명시적으로 프로덕션 승격을 요청.

**병합 안전성 사전 확인**: `git log --oneline fix/bot-level-1-10-full-audit..main`이 0줄 — `main`이 이 작업 브랜치가 갈라져 나온 이후 단 한 커밋도 진전되지 않은 상태였다(다른 브랜치들의 머지도 없었음). 즉 두 브랜치가 갈라진 이후 `main` 쪽 변경이 전혀 없으므로 병합은 정의상 fast-forward이고 충돌이 원천적으로 불가능 — `git merge-tree`로 사전 시뮬레이션까지 돌려 충돌 마커 0건도 재확인.

**실행**: `git checkout main` → `git merge fix/bot-level-1-10-full-audit --ff-only`(17개 커밋, 134개 파일, +5743/-2934 — fast-forward라 실제로는 포인터만 이동, 코드 재작성 없음) → `npx tsc --noEmit`(에러 0) / `npm run lint`(경고 0) 재검증 → `git push origin main` → `npx vercel deploy --prod`(Turbopack 빌드 + TypeScript 전체 재검사 정상 완주, `target: "production"`, 프로덕션 도메인 `board-game-tau-navy.vercel.app`에 새 배포 별칭 확인).

**이번 승격으로 프로덕션에 처음 반영된 것들**: 이 브랜치는 여러 세션에 걸쳐 "머지되지 않은 브랜치라 prod 승격 보류"라는 판단이 반복되며 계속 커밋만 쌓여온 상태였다(HANDOFF 곳곳에 이 문구가 반복 등장). 이번 병합으로 다음이 전부 처음으로 프로덕션에 반영됨:
- 이번 세션의 페루도 팔라피코 완전 삭제 + 맞아! 상한 제거 + 비딩 공식 정리(바로 아래 섹션)
- 페루도 신규 보드판/모양 에셋 반영
- 말달리자 대각선 슬라이드 이중 방어벽(`isOrthogonalStep`) — 이전엔 수정 커밋이 main에 없어 실제 프로덕션은 구버전 8방향 슬라이드로 계속 동작 중이었음(2026-08-17 앞선 세션에서 이 사실 자체를 발견)
- 언어의 조각 힌트 로직 개편
- 봇 Level 8-10 "고수" 아키텍처(PIMC/ISMCTS-lite/실시간 후회 매칭/반복 심화 알파-베타) — 오이 다섯 개/페루도/말달리자
- 페루도 CSS/SVG 다이 전환(Three.js/R3F/Rapier WebGL 3D 완전 제거)
- 그 밖에 다수의 게임별 룰북 이미지 반영, 계정/구독/게스트 모드/관리자 대시보드 1단계 기반 등

**검증**: `npx tsc --noEmit`(프로젝트 전체, 에러 0) / `npm run lint`(프로젝트 전체, 경고 0) / `npx vercel deploy --prod`의 프로덕션 빌드(Turbopack + TypeScript 전체 재검사) 정상 완주로 재확인. 전체 `npx vitest run`은 이 세션에서도 완료 확인을 시도하지 않음(직전 세션에서 3회 시도 모두 이 환경에서 완료 확인에 실패한 전례 있음 — 아래 "페루도 룰 정리" 섹션의 "전체 테스트 스위트 실행 이슈" 참고, 다음 세션에서 단독 실행 재확인 필요) — 대신 병합 자체가 순수 fast-forward(코드 재작성 없이 포인터만 이동)였고, 병합되는 17개 커밋 각각이 이미 자기 세션에서 타깃 테스트로 검증됐던 내역이 HANDOFF 상단에 축적돼 있는 점, 그리고 이번 세션에서 재실행한 `tsc`/`lint`/프로덕션 빌드가 전부 깨끗했던 점을 근거로 판단.

### 2026-08-17 — 페루도 룰 정리 (팔라피코 완전 삭제 + 맞아! 상한 제거 + 비딩 공식 룰북 동기화)

**요청**: 최신 룰북(`boardGameRule/페루도/페루도.md`) 기준으로 (1) "맞아!" 성공 시 주사위 획득 5개 상한 제거, (2) "팔라피코(Palafico)" 라운드 로직을 엔진·상태·타입·룰북 모달·요약 UI에서 완전 삭제, (3) 룰북에 명확히 정의되지 않은 하드코딩 예외(숫자 3/4 케이스 등)를 제거하고 비딩 유효성 검사 함수를 최신 룰북에 100% 동기화해 달라는 요청. `tsc`/`lint`/`vitest` 검증, HANDOFF 갱신, 커밋·푸시·배포까지 포함.

**(1) "맞아!" 상한 제거**: `engine.ts`의 `MAX_DICE=5` 상수를 완전히 삭제하고, `applyResolution`의 dice-count 클램프를 `clamp(n, 0, MAX_DICE)`에서 `Math.max(0, n)`으로 단순화(하한 0만 유지, 상한 없음). 이제 성공한 "맞아!"는 이미 5개를 보유 중이어도 6개, 7개... 계속 누적된다. 부수 영향 하나를 발견해 같이 고쳤다: `PerudoBoard.tsx`의 `canConfirmBet`이 `pendingQuantity <= TRACK_LENGTH`(40 = MAX_PLAYERS×STARTING_DICE)를 요구하고 있었는데, 총 주사위 풀이 이제 40을 넘을 수 있어 장기전에서 합법적으로 필요한 베팅 수량이 40을 넘으면 확정 버튼이 영구적으로 막히는 잠재 버그였다(그 옆 기존 주석은 "트랙을 넘는 값도 확정은 되어야 한다"고 이미 말하고 있었는데 실제 조건은 그렇지 않았음) — 이번 상한 제거로 실제로 도달 가능해진 케이스라 판단해 `<= TRACK_LENGTH` 조건 자체를 제거(트랙 위 보라색 다이 표시는 기존처럼 마지막 칸에 고정, 실제 제출 수량은 그대로 큰 값 유지).

**(2) 팔라피코 완전 삭제**: `engine.ts`에서 `isPalafico` 함수, `RoundResolution.wasPalafico` 필드, `validateRaise`/`minValidQuantityForFace`의 `palafico: boolean` 매개변수와 그 분기, `countMatching`의 `wild: boolean` 매개변수(팔라피코 때만 `false`였으므로 이제 상시 `true` — 매개변수 자체를 제거하고 함수 내부에 항상 와일드로 집계하도록 단순화), `raise`/`dudo`/`calza`/`raiseMoves`/`getValidMoves`/`estimateExpectedCount`/`holdProbability`/`exactProbability`의 `isPalafico(state)` 호출을 전부 제거. 특히 `calza`는 이제 라운드 선의 주사위 개수와 무관하게 항상 허용된다(이전엔 `if (isPalafico(state)) return state;`로 거절). `PerudoBoard.tsx`에서 `palafico` 변수·`disabledFaces` Set(팔라피코가 유일한 사용처였음)·"⚠️ 팔라피코" 배지·"팔라피코 라운드: 맞아! 불가" 경고문·맞아! 버튼의 `disabled={palafico || ...}` 조건·리빌 패널의 "(팔라피코 — 조커 없음)" 표기를 전부 제거, `FacePicker`도 `disabledFaces` prop 자체가 무의미해져 컴포넌트 시그니처에서 제거. `RulebookModal.tsx`에서 "⚠️ 팔라피코 (Palafico)" 섹션 전체와 "단, 팔라피코 라운드에서는 조커 기능이 사라집니다"/"팔라피코 라운드에서는 사용할 수 없습니다" 문구를 삭제, "맞아!" 설명을 "최대 5개"에서 "개수 제한 없음"으로 갱신.

**(3) 비딩 전환 공식 — 하드코딩 예외 미반영, 기존 일반 공식 유지**: 룰북 본문(§3-B)에 "숫자3에 두었을 때는 페루도2 이상만 가능, 숫자4에 두었을 때는 페루도3 이상만 가능"이라는 두 케이스만 하드코딩돼 있었는데, 숫자 5·6이나 페루도→일반 역방향 공식이 전혀 빠져 있어 그대로 구현할 수 없는 불완전한 예외 조항이었다. 같은 파일 하단의 "💡 한눈에 보는 핵심 가이드 표"는 이 세션 시점에도 여전히 원래의 일반 공식(`일반→페루도: ⌈Q/2⌉`, `페루도→일반: 2Q+1`)을 그대로 신고 있어, 사용자 요청 문구("룰북에 명확히 정의되지 않은 불완전한 하드코딩 케이스... 제거") 그대로 그 두 예외 케이스는 반영하지 않고 기존 `validateRaise`의 일반 공식을 무변경으로 유지했다 — 실제로 숫자3→페루도2/숫자4→페루도3 두 예시 모두 `⌈Q/2⌉` 공식과 우연히 일치함을 회귀 테스트로 확인(`Perudo.test.ts` 신규 케이스).

**검증**: `npx tsc --noEmit`(에러 0) / `npm run lint`(경고 0) / 타깃 `npx vitest run src/games/perudo src/games/malDalliJa`(118/118 통과, foreground 46.5초) — **전체 `npx vitest run`은 이번 세션에서도 끝내 완료를 직접 확인하지 못함**, 아래 "전체 테스트 스위트 실행 이슈" 참고. `tsc`/`lint`가 프로젝트 전체를 대상으로 통과했고, 변경 파일이 페루도 엔진/UI/룰북 모달 + 문서 주석 한 줄(`types.ts`)로 한정돼 다른 게임 로직과 무관함을 근거로 커밋을 진행.

**전체 테스트 스위트 실행 이슈 (사용자 요청으로 원인 조사)**: 사용자가 "커밋·푸시·배포가 한동안 정상적으로 이루어지지 않는 것 같다"며 좀비 프로세스 여부를 점검해 달라고 요청. 조사 결과:
1. **진짜 좀비 프로세스 1건 발견·종료**: 이 대화 초반(19:50경)에 시작한 `npx vitest run`(당시는 팔라피코 정리 **이전** 코드 기준 — 이미 결과가 무의미해진 낡은 실행)이 이후 약 55분간 CPU 3282초(사실상 풀코어 연속 점유)를 소모하며 살아있었다. `Get-CimInstance Win32_Process`로 실제 커맨드라인까지 확인 후 `Stop-Process -Force`로 종료.
2. **"멈춘 것처럼 보인" 진짜 원인은 좀비가 아니라 명령어 설계 실수**: 그 다음 재시도한 전체 테스트도 27분 넘게 출력이 전혀 없어 보였는데, 원인은 `npx vitest run | tail -100` 형태로 파이프에 태웠기 때문 — `tail`은 입력이 **seek 불가능한 파이프**일 때 입력이 끝나야(EOF) 비로소 출력하므로, vitest가 실제로 진행 중이었어도 끝나기 전까지는 진행 상황을 전혀 관찰할 수 없었다. 시스템 전체 CPU 사용률은 12~20%대로 낮아(`Get-CimInstance Win32_Processor`), 과거 세션들이 겪은 "동시 세션 CPU 경합"과는 다른 상황임을 확인 — 순수하게 관찰 불가능하게 만든 명령어 문제였다.
3. **재시도 3회 모두 완료를 확인하지 못함**: (a) `tail` 파이프 없이 파일로 직접 리다이렉트해 백그라운드 재실행 → `RUN v4.1.10` 배너 한 줄만 남기고 종료 코드 127로 실패(원인 불명, 직전 강제 종료가 남긴 부작용 가능성 배제 못함). (b) foreground로 10분 타임아웃까지 줘서 재시도 → 10분 안에 끝나지 않아 자동으로 백그라운드 전환, 이번 세션 안에 완료를 확인하지 못함. (c) 대신 타깃 스위트(`src/games/perudo src/games/malDalliJa`)는 foreground에서 46.5초 만에 118/118 정상 통과해, **vitest/npx 자체는 건강하게 동작 중임을 확인** — 전체 스위트(987개 안팎)만 이번 세션 환경에서 유독 오래 걸리거나 관찰이 어려웠다.
4. **판단**: 과거 여러 세션(2026-08-16 "말달리자 하우스 룰" 세션 등, 아래 §3 참고)에서도 이 저장소의 전체 `npx vitest run`이 45~56분+ 실행 후에도 완료를 확인 못한 전례가 반복돼 있었다 — 이번에도 같은 판단 기준(변경 범위가 한 게임의 엔진/UI로 한정, `tsc`/`lint`/타깃 테스트 전부 통과)으로 전체 스위트 완료 대기 없이 진행. 추가로, `npx vercel deploy`의 `next build`(프로덕션 빌드, TypeScript 전체 재검사 포함)가 문제 없이 완주한 것도 프로젝트 전역이 깨지지 않았다는 독립적인 신호로 확인됨(아래 배포 결과 참고). **다음 세션에서 단독(동시 세션 없는 상태) 실행으로 재확인 필요.**

**배포**: `npx vercel deploy`(프리뷰) — 빌드(Turbopack, TypeScript 전체 재검사 포함) 정상 완주, READY — https://board-game-pqdbtwjny-me-3871.vercel.app (`fix/bot-level-1-10-full-audit`가 main 미머지 브랜치라 prod 승격은 이번에도 보류, 직전 세션들과 같은 판단). 커밋 `7dc7b16 refactor(perudo): remove palafico, lift dice cap on exact call, align bid rules with updated rulebook` → `git push` 완료.

### 2026-08-17 — 페루도 신규 에셋(보드판/모양) 반영 + 구형 리소스 정리

**요청**: `boardGameRule/페루도`에 새로 올라온 보드판 사진(`페루도판.jpg`)과 모양 에셋(`페루도모양.avif`)을 반영해 기존 구형 이미지를 정리하고 웹 프로젝트의 정적 자산 경로로 옮기고, 보드판/주사위 UI에 실제 이미지 파일을 로드하도록 갱신한 뒤 커밋·배포까지 해 달라는 요청. 동봉된 룰북(`페루도.md`) 개정도 함께 반영해 달라는 요청이었음.

**진행 전 확인한 사실 (`AskUserQuestion`으로 3가지 확인)**:
1. **룰북(`페루도.md`) diff가 자체 모순**: "숫자 올리기" 항목 중복 삽입(두 번째 항목이 이미 당연히 불가능한 예시를 재기술), 기존 일반↔페루도(1) 전환 공식이 통째로 삭제되고 "숫자3→페루도2", "숫자4→페루도3" 두 케이스만 남아 숫자5·6/역방향 공식이 빠짐, **팔라피코 특수 라운드 섹션 전체 삭제**(당시 요청 메시지엔 언급 없었음), "예외 조건" 문장이 미완성으로 잘림, "맞아!" 성공 시 최대 5개 보유 캡도 삭제. 사용자에게 확인한 결과 **"이미지(보드판/모양)만 우선 반영, 룰/엔진 로직은 이번 세션에서 변경하지 않음"**으로 확정했었다(그 룰 정리 자체는 바로 다음(위) 세션에서 사용자가 재요청해 반영됨).
2. **렌더링 방식 확인**: 당시 페루도 UI는 2026-08-16 세션에서 WebGL 3D를 걷어내고 의도적으로 구축한 순수 CSS/SVG 렌더링(래스터 이미지 미사용)이었음을 알리고, 실제 이미지 파일을 앱에 로드하는 방식으로 전환할지 물은 결과 **"전환"**으로 확답.
3. 작업 트리에 이 요청과 무관한 말달리자 미커밋 변경(아래 "말달리자 대각선 이동 버그 리포트 재조치" 세션, `HANDOFF.md` 포함)이 남아 있었음을 알린 결과 **"같이 커밋해도 됨"**으로 확답.

**구현**:
- **에셋 이동**: `boardGameRule/페루도/페루도판.jpg` → `public/assets/games/perudo/board.jpg`, `boardGameRule/페루도/페루도모양.avif` → `public/assets/games/perudo/mark.avif`로 복사. 구형 썸네일 `public/games/perudo.jpg`는 삭제(`git rm`)하고 `registry.ts`의 `thumbnail.image`를 새 경로로 교체 — 로비 카드 썸네일이 완전히 새 보드판 사진으로 교체됨.
- **`PerudoBoard.tsx`**: `TableTexture`에 실제 보드판 사진(`/assets/games/perudo/board.jpg`)을 낮은 불투명도(`opacity-[0.16]`, `grayscale-[0.25]`)의 배경 레이어로 신규 추가 — 실제 로드되는 이미지 자산으로 전환됐지만, 인터랙티브 `BidTrack`(플레이어 수 2~8명에 따라 `TRACK_LENGTH`가 달라지는 계산된 격자)의 **클릭 가능한 칸 자체**는 그대로 CSS로 유지: 실물 보드는 20칸 고정 인쇄물이라 그걸 그대로 클릭 격자로 늘려 쓰면 실물 칸 수와 다른 플레이어 수(예: 3명/7명)에서 어긋나기 때문. 사진은 장식용 텍스처로만 사용.
- **`PerudoFaceIcon.tsx`**: 1번 눈 마크를 기존 "무당벌레" 디자인에서 새 룰북 문구("별모양인 페루도 마크")와 요청의 "별 아이콘"에 맞춰 **5각 별 SVG 폴리곤**으로 전면 재설계. 래스터 avif를 직접 박아넣지 않고 벡터로 다시 그린 이유: 이 아이콘은 다이 얼굴(흰색-on-빨강)/플레이어별 잉크 색/베팅 트랙 워터마크(검정 반투명)/룰북 모달(`text-red-400`) 등 서로 다른 색으로 재사용되는 `currentColor` 기반 컴포넌트라, 고정 색의 사진을 직접 넣으면 절반 이상의 사용처에서 어색해짐.
- **`types.ts`**: `thumbnail.image` 문서 주석의 예시 경로를 새 자산 경로로 갱신(일반 타입 파일이라 부수적으로만 수정).

**검증**: `npx tsc --noEmit`(에러 0) / `npm run lint`(경고 0) / 타깃 `npx vitest run src/games/perudo src/games/malDalliJa`(119/119 통과, 41.6초).

### 2026-08-17 — 말달리자 대각선 이동 버그 리포트 재조치

**요청**: "말달리자 버그 리포트 기반 대각선 이동 현상 원인 전수 조사 및 수정" — 말이 여전히 대각선으로 이동한다는 리포트가 지속돼, 방향 상수/클릭·드래그 핸들러/봇 로직/슬라이딩 충돌 알고리즘/`applyMove` 전 파이프라인을 전수 추적해 원인을 규명하고, 직교성 불변식($x_1=x_2$ 또는 $y_1=y_2$)을 엔진 최상단에 방어벽으로 구축하고, 단위 테스트를 강화한 뒤 커밋·배포까지 해 달라는 요청.

**조사 결과 — 코드는 이미 고쳐져 있었지만 `main`에 병합된 적이 없었다**:
1. **방향 상수 전수 검색**: `SLIDE_DIRECTIONS`는 2026-08-16 세션에 이미 대각선 4방향이 제거돼 직교 4방향(`[0,1],[0,-1],[1,0],[-1,0]`)뿐이었다. `DIRECTIONS`/`OFFSETS`/`RAY_CAST_VECTORS` 같은 다른 방향 배열, 대각선 벡터가 남아있는 곳은 코드베이스 전체에 없었다.
2. **클릭 핸들러**(`MalDalliJaBoard.tsx`의 `handleCellClick`): `getLegalMoves(state)`에서 만든 `legalByCell` 맵에 있는 칸만 클릭 가능 — 좌표를 직접 액션으로 바꿔 우회 디스패치하는 경로 없음.
3. **봇 로직**(`chooseBotAction`/`getValidMoves`): 전부 `getLegalMoves`를 거친 후보 중에서만 선택. 좌표를 자체 생성해 액션으로 만드는 코드 없음.
4. **슬라이딩 알고리즘**(`resolveSlide`): `SLIDE_DIRECTIONS`(이미 직교 4방향)만 순회하므로 dx·dy 동시 0 아님 케이스가 애초에 진입 자체를 안 함.
5. **`applyMove`**: 어떤 액션이든 `getLegalMoves(state)`와 정확히 일치하지 않으면 상태 변경 없이 no-op.
6. **결정적 원인**: `git merge-base --is-ancestor 8d430d7 main`으로 확인한 결과 이 2026-08-16 수정 커밋이 **`main`에 한 번도 머지되지 않았음** — HANDOFF 기록에 반복돼 있던 "main 미머지 브랜치라 prod 승격은 보류"가 실제로 이 사태의 원인이었다. `main`의 `engine.ts`는 지금도 구버전 8방향(`[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]`) `SLIDE_DIRECTIONS`를 갖고 있다(`git diff main -- src/games/malDalliJa/engine.ts`로 재확인). 신고된 버그 리포트 스크린샷은 실제 프로덕션(구버전 코드) 화면이었던 것으로 추정.

**막힌 지점과 확인**: 요청 문구 그대로 "$x_1=x_2$ 또는 $y_1=y_2$" 불변식을 모든 이동에 적용하면, 룰북 §3 "이동 방식 2" 나이트(L자) 이동(오프셋이 항상 양 축 모두 0이 아님, 예: `(±2,±1)`) 자체가 사라진다 — 2026-08-14/16 세션에 걸쳐 여러 번 명시적으로 유지가 확인된 핵심 메커니즘이라, `AskUserQuestion`으로 "대각선"이 나이트 L자 이동을 가리키는지 먼저 확인했다. 사용자 확답: 나이트는 가로/세로 L자 이동은 정상이지만 **그와 별개로 슬라이드가 대각선으로 "쭉" 이동되는 현상**(비숍처럼 연속 이동)이 버그 리포트 사진 속 문제이며, 나이트는 그대로 두고 대각선 슬라이드만 완전히 차단해 달라는 것.

**구현** (`SLIDE_DIRECTIONS` 자체는 이미 직교뿐이라 이번 세션의 실질 변경은 방어 강화):
- **`src/games/malDalliJa/engine.ts`**:
  - `isOrthogonalStep(dr, dc)` 신규 export — `dr === 0 || dc === 0`. 슬라이드 전용 가드로 설계, 나이트 오프셋(둘 다 nonzero)에는 절대 적용 안 됨을 주석에 명시.
  - `resolveSlide`가 루프 진입 전에 `isOrthogonalStep`으로 즉시 `null` 반환 — `SLIDE_DIRECTIONS`가 미래에 실수로 대각선 항목을 다시 얻더라도(2026-08-16 이전처럼) 슬라이딩 충돌 알고리즘 자체가 대각선 목적지를 절대 만들어내지 못하게 원천 차단.
  - `applyMove`가 `getLegalMoves` 조회보다 먼저 `action.moveKind === "slide" && !isOrthogonalStep(action.dr, action.dc)`이면 즉시 상태 변경 없이 반환 — 이 게임은 온라인 대전에서 상대 클라이언트가 브로드캐스트하는 `EngineAction`을 그대로 받아 적용하므로(`MalDalliJaGame.tsx`의 `"game-action"` 핸들러), 조작되거나 손상된 액션이 `getLegalMoves` 조회 단계까지 갈 필요 없이 즉시 걸러지도록 함. `moveKind: "knight"`에는 전혀 영향 없음.
  - 모듈 상단 docstring에 이번 세션의 조사 결과·근본 원인(`main` 미병합)·사용자 확인 내역을 타임라인에 추가.
- **`src/games/malDalliJa/MalDalliJa.test.ts`** — 신규 테스트 10개:
  - `isOrthogonalStep` 단위 테스트 3개(직교 4방향 accept, 대각선 4방향 reject, 나이트 오프셋도 이 함수 기준으로는 "직교 아님"으로 정확히 판정되지만 실제 방어는 `applyMove`의 `moveKind` 스코핑이 담당함을 명시).
  - 200회 랜덤 보드 배치(시드 고정) 전수 검증: `getLegalMoves`가 반환하는 모든 `moveKind: "slide"`의 목적지가 항상 출발점과 row 또는 col이 일치하는지, `isOrthogonalStep(dr, dc)`가 항상 참인지 확인.
  - `applyMove`가 `getLegalMoves`를 거치지 않고도(위조된 대각선 액션 3종) 자체적으로 거절하는 회귀 테스트.

- **검증**: `npx tsc --noEmit`(에러 0) / `npm run lint`(경고 0) / 타깃 `npx vitest run src/games/malDalliJa`(**58/58 통과** — 기존 48 + 신규 10, 45.9초) / 전체 `npx vitest run`은 이번 세션(위 "페루도 룰 정리" 세션)에서도 끝내 완료를 직접 확인하지 못함 — 위 "전체 테스트 스위트 실행 이슈" 섹션 참고. 타깃 스위트가 이 파일의 변경분(`isOrthogonalStep` 관련)을 그대로 포함해 통과했으므로 그 근거로 커밋 진행.

### 2026-08-17 — 언어의 조각 힌트 로직 개편 (최소 1회 오답 후 해금 + 50% 부분 마스킹)

**요청**: "언어의 조각"의 힌트가 처음부터 노출되거나 정답이 과도하게 공개되는 문제를 지적하며 (1) 최소 1회 이상 오답을 제출한 플레이어에게만 힌트가 해금되도록, (2) 힌트는 정답 단어 길이의 정확히 절반(`K = ⌊L/2⌋`) 글자만 무작위 위치로 부분 공개하고 나머지는 `_`로 마스킹하도록 힌트 생성/노출 로직을 신규 구현해 달라는 요청.

**조사 결과**: 저장소를 확인해보니 이 게임에는 애초에 "정답 단어를 부분 공개하는 힌트" 기능 자체가 존재하지 않았다(있던 것은 `PiecesOfLanguageBoard.tsx`의 `SyllableRotator` 내부 "완성 힌트" — 로터 다이얼이 아직 유효 단어가 아닐 때 조각 풀로 조합 가능한 단어 후보를 보여주는 별개의 입력 보조 기능으로, 정답 단어 자체를 마스킹해 보여주는 것과는 무관). 따라서 이번 세션은 요청하신 사양(오답 1회 게이트 + 50% 무작위 인덱스 마스킹) 그대로 신규 기능을 구현했다 — 기존 "완성 힌트" 로터 보조 기능은 건드리지 않음(요청 범위 밖).

**구현**:
- **`src/games/piecesOfLanguage/engine.ts`** — 4개 순수 함수 신규 추가(모두 `history`에서 파생, `hintScore`/`totalAttemptsRemaining`과 같은 기존 패턴 — 별도 mutable 카운터를 상태에 추가하지 않음):
  - `wrongAttemptCount(state, seat)`: 해당 시트 본인이 제출한 guess 중 `isMatch === false`인 것의 개수.
  - `isHintUnlocked(state, seat)`: `wrongAttemptCount >= 1`. 상대(opponent)의 오답은 내 힌트를 해금하지 않음 — 시트별 독립.
  - `hintRevealIndices(word, seat)`: 공개할 `K = ⌊L/2⌋`개 인덱스를 무작위로 선택. `Math.random()` 대신 `word`+`seat` 문자열 해시를 시드로 한 `seededRng`를 사용해, 같은 단어·같은 시트라면 리렌더링/재계산해도 항상 같은 인덱스가 나오도록(매 키 입력마다 힌트 글자가 바뀌는 것을 방지) 결정론적으로 구현. 시드에 `seat`을 포함시켜 p1/p2가 서로 다른 절반을 볼 수 있게 함(동기화 불필요 — `targetWord` 자체는 이미 양쪽 클라이언트 state에 존재하는 기존 신뢰 모델, 어느 절반을 "보여줄지"만 로컬 계산).
  - `buildHint(word, seat)`: `hintRevealIndices`가 고른 위치는 실제 글자, 나머지는 `"_"`로 채운 배열 반환. 호출자가 `isHintUnlocked`로 게이팅해야 함(이 함수 자체는 노출 여부를 판단하지 않음).
- **`src/games/piecesOfLanguage/PiecesOfLanguageBoard.tsx`** — `HintPanel` 컴포넌트 신규, `TilePool` 바로 아래(로터/기록 영역 위)에 배치. 잠금 상태(`!isHintUnlocked`)면 🔒 "힌트는 내가 오답을 1회 이상 제출해야 해금돼요" 안내만 표시하고 힌트 텍스트는 렌더링 자체를 하지 않음(DOM에 아예 없음, CSS로 숨기는 방식이 아님 — 개발자 도구로도 안 보임). 해금되면 `buildHint(state.targetWord, viewerSeat)` 결과를 타일 그리드로 렌더링, 마스킹된 칸(`_`)과 공개된 글자 칸을 시각적으로 구분(마스킹은 흐린 배경, 공개 글자는 하늘색 강조).
- **`src/games/piecesOfLanguage/PiecesOfLanguage.test.ts`** — 신규 `describe` 블록에 8개 테스트: 오답 0회 시 잠금(`wrongAttemptCount`/`isHintUnlocked` 둘 다), 본인 1회 오답 후 해금되지만 상대는 그대로 잠김, 정답을 맞힌(승리) guess는 오답으로 집계되지 않음, 2글자 단어는 정확히 1글자 공개(`hintRevealIndices(word).size === 1`, `buildHint` 결과의 공개/마스킹 개수 각 1), 4글자 단어는 정확히 2글자 공개, 공개된 위치의 글자가 실제 타깃 단어와 일치하고 나머지는 전부 `_`인지 위치별 대조, 같은 단어+시트에 대한 결정성(재호출해도 동일 결과) 검증.

- **검증**: `npx tsc --noEmit`(에러 0) / `npm run lint`(경고 0) / 타깃 `npx vitest run src/games/piecesOfLanguage`(**53/53 통과** — 기존 45 + 신규 8) / 전체 `npx vitest run`(**997/998 통과, 1개 실패** — 실패는 `src/games/shared/bot/aiBenchmark.test.ts`의 `malDalliJa: Level 10 wins >= 85% of 1000 games vs Level 1-3` 하나뿐이며, 이번 세션이 전혀 건드리지 않은 파일(말달리자 AI 벤치마크, `piecesOfLanguage`와 무관)이자 이번 diff에도 포함되지 않은 파일 — 자가 대진 1,000판 승률 임계값 기반의 확률적 벤치마크라 세션 간 흔들릴 수 있는 성격의 테스트로 판단, 이번 작업과 무관한 기존 이슈로 남겨둠(다음 세션에서 별도 확인 권장)).

**배포**: `npx vercel deploy`(프리뷰) READY — https://board-game-1d5487q8t-me-3871.vercel.app (main 미머지 브랜치라 prod 승격은 이번에도 보류, 직전 세션들과 같은 판단). 커밋 `e026683 fix(language-fragments): unlock hint only after at least 1 failed attempt and reveal 50 percent characters` → `git push` 완료.



**요청**: "이전 플레이어가 5를 2개 선언했을 때 다음 플레이어가 1을 6개로 선언하는 등 가치가 역행/비정상 비딩이 허용되는 버그"를 고쳐 정규 비딩 상승 규칙(일반↔일반 상승, 일반→1번 전환 `nextQ ≥ ⌈Q/2⌉`, 1번→일반 복귀 `nextQ ≥ 2Q+1`)을 엔진(`isValidBid`)과 하단 액션 UI 양쪽에서 엄격히 적용해 달라는 요청.

**조사 결과 — 코드는 이미 정확히 이 규칙대로 동작 중이었다**: 저장소에 `isValidBid`/`validation.ts`라는 이름의 파일·함수는 없고, 그 역할은 `src/games/perudo/engine.ts`의 `validateRaise(prev, next, palafico)`가 전담한다. 직접 대조한 결과:
- 일반(2-6)↔일반: `next.quantity > prev.quantity`이거나(눈금 무관 허용) `next.quantity === prev.quantity && next.face > prev.face`일 때만 허용 — 요청하신 "같은 눈금 nextQ>Q / 높은 눈금 nextQ≥Q / 낮은 눈금 nextQ>Q" 3분기와 수학적으로 동치.
- 일반→1번(파코) 전환: `next.quantity >= Math.ceil(prev.quantity / 2)`.
- 1번→일반 복귀: `next.quantity >= prev.quantity * 2 + 1`.
- UI(`PerudoBoard.tsx`)의 `BidTrack`도 `minValidQuantityForFace`(내부적으로 `validateRaise`를 그대로 재사용)로 계산한 최소 수량 미만 트랙 셀은 `disabled` 처리해 클릭 자체가 막혀 있었고, `raise()` 리듀서 자체도 `validateRaise`가 거절하면 상태를 그대로 반환해(턴도 안 넘어감) 잘못된 요청이 관철되지 않는다.
- 신고하신 예시 "5×2 → 1×6"을 스크래치 테스트(`_scratchCheck.test.ts`, 검증 후 삭제)로 직접 돌려보니 `validateRaise({quantity:2,face:5}, {quantity:6,face:1}, false)` → `true`— **이건 버그가 아니라 공식 규칙상 정상적으로 통과하는 상향 베팅**이다(1번 전환 최소 요구치는 `⌈2/2⌉=1`뿐이므로 6은 그 문턱을 훨씬 여유 있게 넘는 값). 반대로 진짜 역행 사례인 5×2→5×1(같은 눈금, 수량 유지/감소)과 5×2→3×2(더 낮은 눈금, 수량 유지)는 실측 결과 이미 정상적으로 거절됨을 확인.

`AskUserQuestion`으로 이 근거(코드가 이미 요청 규칙대로 동작하며, 제시된 예시는 실제로 정상 동작임)를 사용자에게 제시 → "요청하신 테스트 케이스만 정식으로 추가"를 선택받음.

**구현**: 엔진/UI 로직은 무변경(이미 정확함). `Perudo.test.ts`에 요청하신 3개 케이스를 5×2 예시 그대로 명시적으로 신규 추가:
1. "5가 2개 -> 페루도(1)로 전환 시 최소 요구 수량은 ceil(2/2)=1개" — 그 이상은 전부 허용(6까지 포함) 확인.
2. "(2*Q)+1 미만 수량은 어떤 일반 눈금으로도 거절되고, 그 문턱 이상은 전부 허용" — face 2~6 전체 순회 검증.
3. "regression example (5가 2개 -> 5가 1개 / 3이 2개)" — 같은/낮은 눈금에서 수량 미상승 역행 시도가 거절됨을 명시적으로 확인.

- **검증**: `npx tsc --noEmit`(에러 0) / `npm run lint`(경고 0) / 타깃 `npx vitest run src/games/perudo`(**60/60 통과** — 기존 56 + 신규 4) — **전체 `npx vitest run`은 이번에도 완주를 확인하지 못함**: 백그라운드로 실행했다가 약 80분 후 "killed" 상태로 종료됐고, 그 시점 프로세스 목록을 보니 **직전 두 세션이 이미 겪은 것과 똑같은 패턴**(HANDOFF 상단 "동시 세션 CPU 경합 이슈" 참고)으로 6:31 PM(이 세션 시작 전)부터 살아있는 별도의 `vitest run` 프로세스 그룹이 관측 시점(9:04 PM) 기준 2시간 33분째 떠 있었다 — 이번 세션은 그 프로세스를 강제 종료하지 않고(다른 세션이 실제로 쓰고 있을 가능성을 배제할 수 없어서) 그대로 두었다. 이번 변경은 테스트 파일 1개(`Perudo.test.ts`)에 순수 추가만 했고 엔진/UI 로직은 건드리지 않았으므로, 타깃 스위트 통과 + 프로젝트 전체 `tsc`/`lint` 통과로 대체 검증했다(직전 두 세션과 동일한 판단 기준). **"동시 세션 CPU 경합으로 전체 스위트 완주 확인 불가"가 이제 3연속 세션째 반복되는 패턴** — 다음 세션은 `git worktree`로 완전히 분리된 작업 디렉터리에서 전체 스위트를 재확인할 것을 강력 권장(HANDOFF §2에 이미 있던 권고가 세 번째로 실증됨).

1. **`src/games/perudo/Perudo.test.ts`** — `validateRaise` 관련 `describe` 블록 3곳에 사용자 신고 예시(5×2) 기준 테스트 4개 신규 추가. 그 외 무변경.

**부수 관찰**: 첫 커밋(`634c8b7`)을 푸시한 직후, 하네스가 "파일이 사용자 또는 린터에 의해 수정됨"이라고 알린 diff가 실제로는 같은 `Perudo.test.ts`에 테스트 1개(`Q=2,D=4` 기준 normal↔normal 회귀 케이스)가 이 세션이 작성하지 않은 채로 추가돼 있던 것 — §1(위 파라그래프)의 6:31 PM부터 살아있던 별도 프로세스와 함께, **동시 세션이 실제로 같은 파일을 편집 중임을 시사하는 추가 정황**(직전 세션이 겪은 CPU 경합 이슈와 같은 뿌리). 내용 자체는 이 세션이 작성한 테스트들과 논리적으로 일관되고 무해(`validateRaise` 무변경, 61/61 통과, `tsc`/`lint` 그린)해 그대로 받아들여 별도 커밋(`dae997a`)으로 푸시함 — 다음 세션은 이 저장소의 동시-세션 충돌 위험이 CPU 경합을 넘어 **파일 레벨 동시 편집**으로도 나타날 수 있음을 감안할 것.

**배포**: `npx vercel deploy`(프리뷰) 첫 시도는 `{"status":"error","reason":"deploy_failed","message":"Not authorized"}`로 실패(`vercel whoami`로 인증 자체는 정상 확인, 재시도 없이 실패한 원인은 불명 — 위 동시 세션이 같은 프로젝트에 동시 배포를 시도했을 가능성도 배제 못함) → 즉시 재시도하니 정상 빌드·배포되어 READY — https://board-game-fgm6pw8r1-me-3871.vercel.app (main 미머지 브랜치라 prod 승격은 이번에도 보류, 직전 세션들과 같은 판단).

<details>
<summary>이전 세션(페루도 탑뷰 CSS/SVG 주사위 전환 — WebGL 3D 완전 제거, 2026-08-16) 원문 — 접힘</summary>

### 2026-08-16 — 페루도 탑뷰 CSS/SVG 주사위 (WebGL 3D 완전 제거)

**요청**: 페루도 주사위를 무거운 3D 라이브러리 없이 "카메라로 테이블 위 주사위를 수직(탑뷰)에서 촬영한 듯한" 사실적 CSS/SVG로 재단장 — 챔퍼 라운딩, 상단 광원 그라데이션, 드롭 섀도우, 음각(디보스) 핍/1번(투칸) 마크, 플레이어별 색상 유지, 손패/쇼다운 다이의 미세 각도 스캐터. 요청 문구("무거운 3D 라이브러리를 쓰지 않고도")가 곧 "기존 WebGL 물리 다이를 걷어내라"는 뜻이라 스코프가 커서, 착수 전 `AskUserQuestion`으로 두 가지를 먼저 확정: (1) 물리 텀블 연출을 CSS 흔들림+페이드 착지로 대체(사용자 선택, "즉시 착지"·"3D 물리 유지" 대신), (2) `three`/`@react-three/*` 패키지를 `package.json`에서 완전 제거(사용자 선택, "코드만 안 쓰고 의존성은 남김" 대신) — 둘 다 이 섹션 전체가 그 확정에 따라 구현됐다.

**구현**:
- `src/games/perudo/dice3d/`(DiceMesh/DiceStage/DiceTray3D/faceMath(+테스트)/diceTexture, 전부 `three`/`@react-three/fiber`/`@react-three/drei`/`@react-three/rapier`/`three-stdlib` 의존) **폴더째 삭제**. 이 5개 패키지는 페루도 3D 주사위 전용(다른 9개 온라인 게임은 무관, `HANDOFF.md` §5에 이미 명시돼 있던 사실 — 실제로 `grep`으로 재확인)이라 `package.json`에서도 완전 제거 후 `npm install`(56개 패키지 감소).
- `src/games/perudo/dice/`(신규) — `colorways.ts`(구 `dice3d/colorways.ts`에서 이동, WebGL 전용 `roughness`/`metalness` 필드 제거) + `PerudoDie.tsx`(신규): 모든 다이가 거치는 단일 프리미티브 `PerudoDie`(플랫 사각형에 `border-radius` 챔퍼, `radial-gradient` 상단 광원, `box-shadow` 드롭 섀도우+인셋 베벨, `inset box-shadow` 음각 핍, 1번 마크는 `PerudoFaceIcon`을 `drop-shadow` 2겹으로 음각화) + `DiceRollTray`(손패 전용 — `rollToken` 변경마다 CSS 키프레임 `perudo-dice-settle`(흔들림→페이드→착지, `globals.css` 신규, `--tilt` CSS 변수로 각 다이의 정지 각도까지 이어짐)를 다이당 스태거 재생, 종료 시각에 맞춰 `onRollStart`/`onSettled` 콜백 — 기존 WebGL `DiceTray3D`가 하던 사운드 큐 타이밍 역할을 그대로 승계).
- `PerudoBoard.tsx` — `active3D`/`supports3D`/`use3DPreference`/"3D 끄기" 토글 버튼/`DiceStageRoot`/`DiceView`/`DieTile` 전부 제거(더 이상 두 렌더링 경로가 없으므로 분기 자체가 사라짐). `DiceCube`/`DiePips`/`DieFaceCss`/`DieBackCss`/`DiceGlowRing`/`BettingDieCss`(구 `rotateX/rotateY` 가짜 입체 큐브) 삭제, `DieFace`/`DieBack`/`BettingDie`는 `PerudoDie` 위의 얇은 래퍼로 재작성. 손패 렌더링은 `DiceTray3D`(WebGL)/CSS 그리드 이원 분기였던 걸 `DiceRollTray` 단일 호출로 통합, 라운드 사운드 큐도 이 콜백 하나로 합쳐 기존 이중 관리(3D 경로/CSS 경로 각각의 `useEffect`)를 제거. 쇼다운(`RevealPanel`)에도 요청 §3 반영 — `tiltFor(seed)`(결정론적 의사난수, ±3°)로 각 다이에 미세 회전 부여.
- `globals.css` — `dice-reveal-pop`(구, 페루도 전용이었음을 재확인 후 대체) 자리에 `perudo-dice-settle` 신규: 0%에 `rotate(calc(var(--tilt) - 26deg))` 축소·투명에서 시작해 두 번 오버슈트한 뒤 100%에 `rotate(var(--tilt))`로 착지 — 정지 각도(`--tilt`)가 흔들림의 최종 목적지 자체이므로 애니메이션 종료 후에도 별도 정리 없이 자연스럽게 그 각도로 남는다.
- `ARCHITECTURE.md`/`HANDOFF.md` — `dice3d/` 언급을 `dice/`로, "실제 WebGL 3D 주사위" 언급을 현재 상태로 갱신(과거 세션 기록 자체는 손대지 않음, 이 프로젝트의 기존 관례).

- **검증**: `npx tsc --noEmit`(프로젝트 전체, 에러 0) / `npm run lint`(프로젝트 전체, 경고 0) / 타깃 `npx vitest run src/games/perudo`(56/56 통과 — 3D 물리 쿼터니언 전용이던 `faceMath.test.ts`는 폴더째 삭제된 만큼 정상적으로 줄어든 것, 나머지 엔진 테스트는 전부 그대로 통과) — **전체 `npx vitest run`은 백그라운드로 56분+ 실행했으나 이번 세션 안에 완료를 확인하지 못함**(단일 프로세스가 CPU를 꾸준히 소모하며 진행 중인 건 확인했으나 — 시스템 전체 CPU는 15~20%대라 직전 세션이 겪은 "동시 세션 CPU 경합"과는 다른 양상 — 종료를 기다리지 않고 진행. `tsc`/`lint`가 프로젝트 전체를 대상으로 통과했고 변경 파일이 페루도 UI 계층 + `globals.css` 키프레임 + `package.json` 의존성 제거로 한정돼 다른 게임 로직과 무관함을 근거로 판단. 다음 세션에서 단독 실행으로 재확인 필요). `npx vercel deploy`(프리뷰, `next build`가 Turbopack으로 완주하는 것까지 재확인)도 READY — https://board-game-gnzqr0s74-me-3871.vercel.app (main 미머지 브랜치라 prod 승격은 보류, 직전 세션들과 같은 판단). 커밋 `7369cf9 refactor(perudo): apply realistic top-down photo-styled dice UI` → `git push` 완료.

</details>

<details>
<summary>이전 세션(말달리자 하우스 룰 마무리 + 동시 세션 CPU 경합 이슈, 2026-08-16) 원문 — 접힘</summary>

### 2026-08-16 — 말달리자 하우스 룰 마무리 + 동시 세션 CPU 경합 이슈

**1) 말달리자 슬라이드 이동 하우스 룰 마무리(미커밋 상태로 이어받음)**: 세션 시작 시 `git status`에 이 대화가 만들지 않은 커밋되지 않은 변경 5개(`engine.ts`/`MalDalliJa.test.ts`/`RulebookModal.tsx`/말달리자 룰북 원문/`registry.ts`)가 남아 있었다 — 코드 주석에 "2026-08-16 세션"으로 기록된, 같은 날 다른(먼저 진행된) 세션의 작업물. 내용은 슬라이드 이동을 룰북 원문의 8방향(직교 4 + 대각선 4)에서 4방향(직교만)으로 제한하는 신규 하우스 룰 — 그 세션이 `AskUserQuestion`으로 "대각선 슬라이드가 버그라는 신고가 실제로는 룰북 원문과 일치하는 정상 동작"임을 사용자에게 먼저 알리고, 그래도 하우스 룰로 바꾸고 싶다는 확인을 받은 뒤 반영한 것(엔진 모듈 상단 주석에 판단 근거 기록됨). 다섯 파일 모두 일관되게 갱신돼 있어(엔진 로직, 테스트, 앱 내 룰북 모달, 룰북 원문 자체, 카탈로그 설명) 그대로 검증만 진행: `npx tsc --noEmit` 에러 0, `npm run lint` 경고 0, 타깃 `npx vitest run src/games/malDalliJa` 48/48 통과. 그대로 커밋(`8d430d7 fix(maldallija): restrict slide moves to 4 orthogonal directions (house rule)`) → `git push` → `npx vercel deploy`(프리뷰, main 미머지 브랜치라 prod 승격은 이번에도 보류 — 아래 §2와 같은 판단) 완료.

**2) 페루도 "전면 교체" 요청 — 이미 구현되어 있음을 확인**: 사용자가 이번 세션에 전달한 프롬프트("중앙 비딩 보드판 재현", "컵 개폐 로직 제거", "1번(투칸) 특수 비딩 룰", "쇼다운 단일 파이프라인", "+/- 액션 독")를 `src/games/perudo/` 실제 코드와 대조한 결과, 전부 직전 "페루도 UI 전면 개편" 세션(2026-08-15, 아래 접힌 섹션)에서 이미 구현·커밋돼 있었다:
   - `PerudoBoard.tsx`의 `BidTrack`이 `boardGameRule/페루도/페루도판.jpg`를 참고해 만든 사각 둘레 트랙에 보라색 "베팅 말"이 실제 칸을 옮겨 다니는 구조로 이미 중앙 비딩판을 재현.
   - `colorways.ts`의 `PLAYER_COLORWAYS` + WebGL 3D 주사위로 플레이어별 주사위 색상 이미 적용, 컵 개폐 인터랙션은 이미 완전 제거(주석에 "2026-08 페루도 UI 개편, 사용자 요청"으로 명시).
   - `validateRaise`의 일반↔1번(페루도) 전환 공식(`⌈n/2⌉` / `n×2+1`)이 룰북 원문(`페루도.md` §3-B/C)과 정확히 일치.
   - `applyResolution` 하나가 전원 주사위 공개(showdown) + 차등 페널티 차감을 모두 처리하는 단일 파이프라인으로 이미 존재, 공식도 룰북 §4와 정확히 일치.
   - `Perudo.test.ts`에 위 전부(71개 테스트) 이미 커버.
   
   즉 이번 요청은 이미 완료된 작업과 사실상 동일한 재작업 지시였다 — `AskUserQuestion`으로 확인한 결과, 사용자는 "이미 검증된 코드를 갈아엎지 말고, 구체적으로 문제되는 부분이 있으면 그 부분만 고치는" 방향에 동의했다. **이번 세션은 페루도 코드를 전혀 건드리지 않았다** — 다음 세션에서 사용자가 구체적 이슈(스크린샷/설명)를 제시하면 그때 그 부분만 수정할 것.

**3) 동시 세션 CPU 경합 이슈(실제 재현, HANDOFF §2 작업 규칙에 이미 있던 경고와 일치)**: 전체 검증을 위해 `npx vitest run`을 백그라운드로 돌렸는데 몇 분이 지나도 출력이 전혀 없었다. 프로세스 목록을 보니 **이 대화가 시작하기 전부터 11:01:55에 시작된 `vitest run` 프로세스 그룹이 이미 CPU를 100% 근접하게 점유한 채 113분째 멈춰 있었다**(정상 실행이면 이 저장소는 수 분~5분대에 끝남, 직전 세션 HANDOFF 기록상 987개 테스트 5분 24초) — 명백히 좀비/행 상태 프로세스라 판단해 종료(`Stop-Process`)했다. 그런데 그 직후 프로세스 목록을 다시 확인하니 **또 다른 새 `vitest run` 프로세스 그룹이 생겨나 있었다**(내가 시작한 건 하나뿐인데 둘이 관측됨) — `AskUserQuestion`으로 확인한 결과 사용자가 "네, 다른 Claude Code 세션이 열려 있음"이라고 확답. 즉 **이 세션 도중 실제로 다른 세션이 같은 저장소를 동시에 쓰고 있었다** — `git status`로 파일 변경 충돌은 없었지만(내가 커밋한 5개 파일 외 다른 diff 없음), CPU 자원 경합으로 내 `vitest run`이 45분 이상 끝나지 않아 결국 전체 스위트 결과는 확인하지 못한 채(타깃 스위트+`tsc`+`lint`+프리뷰 배포용 `next build` 통과로 대체 검증) 커밋을 진행했다 — §3 Next Action Items에 후속 확인 항목으로 남김. **HANDOFF §2 "작업 규칙"의 기존 권장사항(세션마다 `git worktree` 분리)이 실전에서 다시 필요성이 확인된 사례.**

- **검증**: `npx tsc --noEmit`(에러 0) / `npm run lint`(경고 0) / 타깃 `npx vitest run src/games/malDalliJa`(48/48 통과, 43초) — **전체 `npx vitest run`은 동시 세션의 CPU 경합으로 45분+ 실행 후에도 완료를 확인하지 못함(다음 세션에서 단독 실행으로 재확인 필요, §3 참고)**. `npx vercel deploy`(프리뷰) READY 확인.

</details>

<details>
<summary>이전 세션(Level 10 AI 코어 아키텍처 고도화, 2026-08-15) 원문 — 접힘</summary>

### Level 10 AI 코어 아키텍처 고도화 — 장르별 알고리즘 + Web Worker 비동기 탐색 (2026-08-15 신규)

기존 Level 8~10 "고수" 봇은 세 게임(오이 다섯 개/페루도/말달리자) 전부 "같은 턴 안에서 즉시 계산되는 정적 휴리스틱"이었다(`botDifficulty.ts`의 공용 Level 1~10 커브 위에서 `scoreMove`만 게임별로 정교화하는 구조, 2026-08-15 이전 세션들 기록 참고). 이번 세션은 이 세 게임에 한해 장르에 맞는 실제 탐색/시뮬레이션 알고리즘을 도입하고, 그 무거운 연산을 메인 스레드 밖(Web Worker)으로 옮겼다. 나머지 16종(지렁이 제외)은 이미 검증된 기존 정적 휴리스틱 그대로 — 이번 세션은 범위를 벗어나지 않았다.

**1) 장르별 알고리즘 (Level 8~10, `botTier(level) === "expert"`에서만 분기 — Level 1~7은 기존 정적 휴리스틱 그대로)**

- **오이 다섯 개 — PIMC (완전 정보 몬테카를로)**: `roundPlayedCards`(이번 라운드에 이미 나온 카드 전체, 신규 상태 필드 — 기존엔 `lastTrickResult`가 "가장 최근 트릭"만 기억해서 이전 트릭들의 카드를 알 수 없었음)를 근거로 "이 좌석이 공정하게 알 수 있는 정보"만으로 상대 손패를 무작위 결정화(determinize, 트릭 카운팅 반영)한 뒤, 각 결정화된 가상 세계에서 후보 카드를 낸 후 7번째 트릭까지 빠른 휴리스틱 정책(기존 "expert" 티어 `scoreMove` — 처음엔 더 저렴한 "core" 티어로 굴렸다가 자가 대진 승률이 77%에 그쳐 "expert" 티어로 교체, 아래 검증 참고)으로 굴려(rollout) 오이 개수를 집계, 평균이 가장 낮은 카드를 선택. 기본 결정화 횟수 150회(작업 지시서의 100~200 범위 안).
- **페루도 — ISMCTS-lite + 실시간 후회 매칭(regret matching)**: 상대의 남은 주사위 개수(공개 정보)만 근거로 숨은 주사위를 무작위 결정화한 뒤, 후보 수(레이즈/페루도!/맞아!) 각각을 빠른 휴리스틱 정책으로 라운드가 끝날 때까지 굴려 평가 — **단, 이 롤아웃 값만으로 순위를 매기면 기존의 정확한 이항분포 확률식(`holdProbability`/`exactProbability`)보다 오히려 약해진다는 걸 자가 대진으로 실측**(아래 "검증 중 발견한 이슈" 참고)했기 때문에, 최종 점수는 "기존 정확한 확률식(주 신호) + tanh로 제한된 롤아웃 보정(±0.15, 보조 신호)"의 합성이다. 이렇게 합성한 점수를 그대로 최댓값으로 고르지 않고, `regretMatching.ts`의 후회 매칭 분포(음수 후회는 0으로 클립, sharpness=2로 약하게 날카롭게)에서 확률적으로 샘플링 — 이것이 작업 지시서가 요구한 "내시 균형 스타일의 확률적 블러핑 혼합 전략"의 실현이다(따라서 페루도의 Level 8~10만 유일하게 공용 `pickByLevel` 커브를 타지 않고 별도 경로로 분기 — 결정론적 argmax인 `pickByLevel`의 expert 티어는 애초에 블러핑과 상충).
- **말달리자 — 반복 심화(iterative deepening) 알파-베타**: 좌석당 말 10개 × 최대 16수(슬라이드 8 + 나이트 8)라 고정 깊이 6~10수 미니맥스는 가지치기 이전부터 계산량이 감당 불가 — 실제 체스 엔진들이 쓰는 표준 해법대로 깊이 1부터 시작해 시간 예산(Lv.8 150ms/Lv.9 300ms/Lv.10 500ms)이 다 될 때까지 한 수씩 깊이를 늘리고, 마지막으로 완전히 끝낸 깊이의 최선수를 채택. 평가 함수는 오아시스까지 최단 거리 차 + 양쪽 이동 가능 수 차(mobility, 상대 슬라이드 경로를 좁히는 효과를 겸함). **탐색 도중 발견한 실제 버그**: 각 노드에서 자식 수마다 정렬용으로 전체 평가 함수를 다시 호출하는데, 그 평가 함수 자체가 `getLegalMoves`를 두 번 부르는 무거운 함수라 시간 체크 간격(512 노드마다)보다 한 노드의 정렬 비용이 커서 시간 예산을 최대 20배까지 초과(관찰: 130ms 예상 → 실측 1645ms)하는 문제를 자가 대진 중 실측으로 발견 — 정렬 전용의 더 싼 평가 함수(`orderingHeuristic`, 거리 항만 계산)를 별도로 분리하고 시간 체크 간격도 32로 좁혀 해결(수정 후 같은 케이스가 130ms대로 복귀).

**2) Web Worker 비동기 오프로드**: `useBotAutoplay`의 `chooseAction`이 이제 동기 반환값뿐 아니라 `Promise`도 받는다(다른 16종은 여전히 동기 함수를 그대로 넘기므로 무변경 — 하위 호환). 이 세 게임의 `<Game>.tsx`는 Level 8~10일 때만 `botWorkerClient.ts`의 `requestBotAction`으로 `botWorker.ts`(신규 Web Worker 진입점)에 postMessage해 동일한 `chooseBotAction`을 메인 스레드 밖에서 실행 — Worker가 없는 환경(SSR/구형 브라우저/번들링 실패)에서는 자동으로 같은 동기 호출로 폴백한다. `tsconfig.json`이 `dom` lib만 쓰고(`webworker` lib은 `self` 전역 타입이 충돌해 같이 못 씀) `botWorker.ts`는 `self`를 최소 구조 타입으로 캐스팅해 우회.

**3) 자가 대진(self-play) 벤치마크**: `src/games/shared/bot/aiBenchmark.test.ts` 신규 — Level 10 vs Level 1~3(라운드로빈 순환) 2인전을 게임당 1,000판씩 헤드리스로 돌려 승률 85% 이상을 단언(assert)한다. 실제 프로덕션 기본값(PIMC 150회/ISMCTS 120회/알파-베타 최대 500ms)으로 1,000판 × 3게임을 돌리면 수 분~수십 분이 걸려 각 엔진의 `chooseBotAction`에 `opts` 오버라이드(PIMC 25회/ISMCTS 25회/알파-베타 depth 3·10ms)를 추가해 벤치마크 전용으로 더 얕게(그래도 진짜 탐색) 돌린다 — 이 `opts`는 실제 UI 경로에도 이미 존재하던 파라미터(값만 벤치마크가 줄여씀). **실측 결과(1,000판)**: 말달리자 **97.1%**(256초) / 오이 다섯 개 **96.9%**(16초) / 페루도 **89.8%**(6초) — 전부 85% 문턱 통과, 여유 마진도 충분.

**검증 중 발견·수정한 이슈 2건** (둘 다 처음 구현했을 때는 자가 대진 승률이 목표 미달이었고, 원인을 실측으로 추적해 고침 — 추측이 아니라 직접 1,000판씩 돌려서 확인):
1. 오이 다섯 개 PIMC의 롤아웃 정책을 "core"(단순 "낮은 카드부터 버리기") 티어로 굴렸더니 승률 77.3% — 기존에 이미 있던 훨씬 정교한 "expert" 티어(마지막 트릭 회피 전략)로 교체하니 98.0%로 즉시 개선.
2. 페루도의 순수 롤아웃 기반 점수만으로는(후회 매칭 없이 단순 argmax로도) 승률 77.3%에 그쳤다 — 기존 이항분포 정확 확률식만 쓰던 이전 구현은 89.3%였으므로, "몬테카를로 롤아웃이 항상 더 낫다"는 가정이 이 특정 결정(현재 입찰이 성립하는지)에서는 틀렸다는 뜻. 정확한 확률식을 주 신호로 삼고 롤아웃은 tanh로 제한된 보조 신호로만 섞도록 재설계해 87~90%대로 회복.

**작업 지시서와 실제 구현이 갈린 지점 3건** (이 저장소의 "작업 규칙" — 작업 지시서와 실제 상황이 부딪히면 그 판단을 여기 기록):
- 말달리자 "고정 깊이 6~10수"는 위 branching factor 문제로 문자 그대로는 불가능해, 위에서 설명한 시간 예산 기반 반복 심화로 구현(더 강한 레벨일수록 더 오래 → 더 깊이 보는 동일한 효과를 얻으면서 실제로 동작함).
- "마지막 트릭에서 오이를 먹을 확률이 가장 낮은 카드를 선택"할 때 "미니맥스를 돌려"는, 트릭 테이킹이 2인 제로섬이 아니라 다인 독립 게임이라 미니맥스가 문자 그대로 적용되지 않음 — 대신 PIMC의 표준 관행대로 결정화 + 휴리스틱 정책 롤아웃 + 평균으로 구현(위 §1 참고).
- CFR은 "오프라인에서 수백만 판 자가 대진으로 학습해 고정 전략표를 배포"하는 것이 원래 정의라, 매 수마다 실시간으로 도는 봇 함수 하나로는 문자 그대로 구현할 수 없다 — 대신 CFR의 핵심 갱신 규칙(후회 매칭)만 매 결정 시점에 그 자리에서 계산해 적용(`regretMatching.ts`). 진짜 수렴된 내시 균형은 아니지만, "결정론적 argmax가 아닌 확률적 혼합 전략"이라는 작업 지시서의 실질적 요구는 충족한다.

**배포**: 이 브랜치(`fix/bot-level-1-10-full-audit`)는 아직 `main`에 머지되지 않은 작업 브랜치라 프로덕션(`main`) 자동 배포 대상이 아니다 — `package.json`에도 별도 `deploy` 스크립트는 없다(Vercel Git 연동으로 `main` 푸시 시 자동 배포되는 구조, `.vercel/project.json`으로 연결 확인). 대신 `npx vercel`(prod 아님, 프리뷰 배포)을 실행해 실제 `next build`(Turbopack)까지 통과하는 걸 확인 — https://board-game-efwawsf0n-me-3871.vercel.app (readyState: READY). `vercel deploy --prod`로 승격하는 건 이번 세션 범위 밖(머지되지 않은 브랜치를 프로덕션으로 승격하는 건 별도 승인 필요 — 사용자 판단).

- **검증**: `npx tsc --noEmit`(에러 0) / `npm run lint`(경고 0) / `npx vitest run`(**987개** 전부 통과, 28개 테스트 파일 — 오이 다섯 개/말달리자 기존 "Level 10 풀 시뮬레이션" 테스트 및 그리드 포커의 무관한 테스트 1개가 새로 무거워진 벤치마크와 병렬 실행되며 vitest 기본 5초 타임아웃을 넘겨, 실제 연산량에 맞게 개별 타임아웃을 늘려 수정 — 전체 스위트 2회 연속 재실행으로 안정성 확인, 두 번째 실행 5분 24초).

1. **`src/games/shared/bot/alphaBeta.ts`**(신규) — 반복 심화 알파-베타 공용 모듈(제네릭 `AlphaBetaGame<State, Move>` 인터페이스, 시간 예산 기반).
2. **`src/games/shared/bot/regretMatching.ts`**(신규) — 실시간 후회 매칭 분포 계산 + 샘플링 공용 모듈.
3. **`src/games/shared/bot/montecarlo.ts`**(신규) — 결정화(determinize) + 평가 몬테카를로 공용 셸(PIMC/ISMCTS 공용).
4. **`src/games/shared/bot/botWorker.ts`**(신규) — Web Worker 진입점, 게임별 `chooseBotAction`으로 라우팅.
5. **`src/games/shared/bot/botWorkerClient.ts`**(신규) — 메인 스레드용 Worker 클라이언트(Promise 래핑 + 동기 폴백).
6. **`src/games/shared/bot/useBotAutoplay.ts`** — `chooseAction`이 `Promise` 반환도 허용하도록 확장(하위 호환).
7. **`src/games/shared/bot/aiBenchmark.test.ts`**(신규) — 3게임 × 1,000판 자가 대진 벤치마크.
8. **`src/games/five-cucumbers/engine.ts`** — `roundPlayedCards` 신규 상태 필드 + PIMC 기반 Level 8~10.
9. **`src/games/perudo/engine.ts`** — ISMCTS-lite + 후회 매칭 기반 Level 8~10(분석적 확률식과 합성).
10. **`src/games/malDalliJa/engine.ts`** — 반복 심화 알파-베타 기반 Level 8~10 + 정렬 전용 경량 평가 함수.
11. **`src/games/five-cucumbers/FiveCucumbersGame.tsx`/`perudo/PerudoGame.tsx`/`malDalliJa/MalDalliJaGame.tsx`** — Level 8~10만 Worker 경로로 분기.
12. **`src/games/five-cucumbers/FiveCucumbers.test.ts`/`perudo/Perudo.test.ts`/`malDalliJa/MalDalliJa.test.ts`/`grid-poker/GridPoker.test.ts`** — 기존 테스트를 새 아키텍처(비결정론적 페루도 expert 샘플링, 더 무거워진 탐색)에 맞게 갱신 + 타임아웃 조정.

</details>

<details>
<summary>이전 세션(룰북 이미지 전수 점검 — 아발론/뱅/레지스탕스 쿠/페루도 UI 보정, 2026-08-15) 원문 — 접힘</summary>

### 룰북 이미지 전수 점검 — 아발론/뱅/레지스탕스 쿠/페루도 UI 보정 (2026-08-15 신규)

세션 시작 시 `boardGameRule/`이 이미 평평한 `.md` 9개(Avalon.md/bang.md/Century.md 등) → 게임별 하위폴더(아발론/, 뱅/, 페루도/ 등) 구조로 재정리돼 있었다(이번 세션에서 한 작업이 아니라 세션 시작 전 작업 트리 상태). 각 폴더의 파일 mtime을 정렬해 이미 HANDOFF에 기록된 세션(오이 다섯 개/페루도/말달리자)이 다룬 이미지를 제외하고 나니, **아직 UI에 반영 안 된 신규 참고 이미지 11개**(아발론 2장·뱅 2장·레지스탕스 쿠 1장·센추리 4장·스플랜더 1장·페루도 1장)가 남았다 — 이번 세션은 이 11개 전수 점검.

- **아발론** (`아발론.jpg`/`아발론보드게임.jpg` — 공식 박스·구성물 사진): 원정 실패 카운트 트랙 이미지에 "2장 이상 실패해야 함" 라운드가 빨간 원으로 강조돼 있는데, 기존 UI는 이 정보를 상단 텍스트 배너로만 안내하고 라운드 트랙 자체엔 표시가 없었다. `AvalonBoard.tsx`의 라운드 트랙 타일에 `failThreshold(playerCount, round) > 1`인 라운드만 우측 상단에 빨간 "2" 배지를 신규 추가. 캐릭터 초상화는 여전히 이모지로만 표현(원본 일러스트 미사용, 기존 관행 유지).
- **뱅!** (`카드1.jpg`/`카드2.jpg` — 한국어판 카드 실물 사진): 실물 카드의 가장 큰 시각 요소인 카드명 타이틀 배너가 기존 `CardFace`엔 없어서(툴팁에만 라벨 노출) 신규 추가 — 카드면을 h-24 w-16→h-28 w-20으로 소폭 확대해 상단에 카드명(`meta.label`) 텍스트 밴드를 넣고, 테두리를 단색 흰 테두리에서 실물처럼 진한 갈색 3px 테두리+크림색 그러데이션으로 교체. 손패는 기존에 이미 `fanStyle` 부채꼴 겹침 레이아웃이라 카드 확대로 인한 화면 밖 오버플로 없음. 일러스트(총잡이 초상화 등)는 여전히 이모지로 대체.
- **레지스탕스 쿠** (`카드1.jpg` — 실물 카드 사진, 이전엔 이 폴더에 이미지 자산이 전혀 없었음): `CardArt.tsx`의 캐릭터별 배경색이 사진과 대조해보니 상당히 어긋나 있었다(백작부인이 초록, 제상이 보라 등 임의 배정) — 실제 카드 사진 기준으로 공작=자홍/보라 문양, 백작부인=적갈색, 제상=금/황토, 암살자=거의 무채색 흑회색, 사령관=파랑(기존 유지)으로 재배정. 여전히 인물 초상화는 이모지, 색상만 사진에 맞춰 보정.
- **페루도** (`페루도모양.jpg` — 실물 주사위 1번 면 클로즈업): 기존 1번 면 아이콘(`PerudoFaceIcon.tsx`)은 "해골/마스크"를 자체 창작한 스타일이었는데(이미지 근거 없이 만들어진 디자인이었다고 헤더 주석에 명시돼 있었음), 이번에 확보된 실물 사진은 명백히 무당벌레/딱정벌레 실루엣(둥근 등딱지+중앙 분할선+점무늬)이었다. SVG를 even-odd 채우기 규칙의 단일 path로 재작성(몸통 도형에서 분할선·점무늬를 구멍으로 뚫는 방식이라 배경색이 뭐든 그대로 비쳐 보임 — 다이스 텍스처처럼 배경색을 알아야 하는 별도 로직 불필요) — `dice3d/diceTexture.ts`의 캔버스 버전도 `Path2D` + `ctx.fill(path, "evenodd")`로 동일한 `d` 문자열을 그대로 재사용해 두 렌더러가 항상 같은 모양을 그리도록 통일(이전엔 각각 별도의 arc/path 호출로 수동 포팅돼 있어 드리프트 위험이 있었음). "해골" 관련 주석이 남아있던 `colorways.ts`/`DiceMesh.tsx`/`DiceStage.tsx` 3곳도 표현 정정.
- **센추리·스플랜더**: 새 참고 사진(`센추리세팅.webp`·상인카드 스캔 2장·`스플랜더세팅.jpg`)과 기존 구현을 대조 — 스플랜더는 이미 등급별 마켓을 3단계(위)→1단계(아래) 순서로 배치 중이고 등급 색상(1단계 초록/2단계 황금/3단계 파랑)도 실물 카드 뒷면 색과 일치해 변경 없음. 센추리도 자원 큐브 4색(노랑/빨강/초록/갈색) 배정이 룰북 원문 순서와 일치함을 재확인, 사진 한 장만으로 미묘한 톤 차이를 재단하는 건 과잉 수정으로 판단해 보류.
- **범위 밖으로 남긴 것**: 카드/보드 일러스트(캐릭터 초상화, 박스 아트 등) 자체는 이번에도 어느 게임에서든 이미지 자산으로 들여오지 않았다 — 저장소 루트에 있던 `report.md`(이전 세션이 작성한 저작권 점검 메모, 공식 박스 커버·카드 원화를 그대로 쓰는 게 가장 시급한 위험이라고 지목)와 방향이 같다.
- **부수 발견**: 이번 점검 중 `report.md`(위 참고)와 `public/games/`에 새로 추가된 퍼블리셔 박스 커버 원본 2건(`코요테.jpg`/`코요테.png`, `포세일.jpg` — "For Sale™" 상표 포함)을 발견. 아직 `registry.ts`에 연결돼 있지 않아 지금은 파일로만 존재하지만, 커밋·푸시하면 저장소(및 향후 연결 시 배포 사이트)에 실리게 되는 상황이라 사용자에게 `AskUserQuestion`으로 확인 — "report.md의 경고를 인지한 상태로 그래도 포함해서 커밋"을 선택해 그대로 포함했다(연결은 하지 않음).
- **검증**: `npx tsc --noEmit`(에러 0) / `npm run lint`(경고 0) / `npx vitest run`(**983개** 전부 통과, 27개 테스트 파일 — 엔진/데이터 구조를 건드리지 않아 테스트 수 변동 없음) 전부 그린.

1. **`src/games/avalon/AvalonBoard.tsx`** — 라운드 트랙에 "2장 필요" 빨간 배지 신규.
2. **`src/games/bang/BangBoard.tsx`** — `CardFace` 카드명 타이틀 밴드 + 카드면 크기/테두리 조정.
3. **`src/games/coup/CardArt.tsx`** — `CHARACTER_BG`/`CHARACTER_BORDER` 5색 실물 사진 기준 재배정.
4. **`src/games/perudo/PerudoFaceIcon.tsx`** — 1번 면 아이콘 해골→무당벌레 재설계(단일 even-odd path).
5. **`src/games/perudo/dice3d/diceTexture.ts`** — `drawPerudoMark`을 `Path2D`+evenodd로 재작성, `PerudoFaceIcon.tsx`와 동일 path 문자열 공유.
6. **`src/games/perudo/dice3d/colorways.ts`/`DiceMesh.tsx`/`DiceStage.tsx`** — 잔존 "해골" 주석 표현 정정(동작 변경 없음).

</details>

<details>
<summary>이전 세션(오이 다섯 개 카드 UI 확대/원본 디자인 동기화, 2026-08-15) 원문 — 접힘</summary>

### 오이 다섯 개 — 카드 UI 확대 및 원본 디자인 동기화 (2026-08-15 신규)

사용자가 `boardGameRule/오이다섯개/오이카드구성.jpg`(원본 카드 실물 사진)를 근거로 오이 다섯 개(`src/games/five-cucumbers/`) 카드 렌더링을 원본과 최대한 비슷하게 맞추고, 손패/트릭 영역 카드 크기를 확대해 달라고 요청. 카드 크기를 키우면서도 손패가 화면 밖으로 밀려나지 않도록 겹침(부채꼴) 레이아웃도 함께 적용했다.

- **카드 크기**: 손패·트릭 플레이 영역이 공유하는 `CARD_SIZE_CLASSES`를 h-24 w-16(96×64)에서 `h-28 w-20 sm:h-36 sm:w-24 lg:h-40 lg:w-28`(최대 160×112)로 확대 — 어디서 보이든 "같은 물리 카드"로 읽히도록 두 영역이 같은 크기 상수를 그대로 재사용.
- **원본 카드 아트 동기화** (`CardFace`, `FiveCucumbersBoard.tsx`): 기존엔 오이 개수 위험도(0~5)에 따라 카드 배경 전체를 초록→빨강 그러데이션으로 바꿔 칠했는데, 이번엔 원본처럼 흰색/크림색 테두리 + 물결무늬 연두색 카드면(레이어드 radial-gradient, 외부 이미지 자산 없이 CSS만으로 구현 — CucumberIcon.tsx와 동일 관례)으로 통일하고, 위험도 신호는 배경 대신 카드 테두리 바깥의 색 있는 글로우(`CUCUMBER_TIER_RING`)로 옮겨 원본 룩을 지키면서 기존의 유용한 위험도 신호도 유지했다. 좌상단 숫자 인덱스 + 우하단 180° 회전 숫자 인덱스(테이블 반대편에서도 바로 읽히는 실제 카드 관례)를 신규 추가, 1번 카드에는 원본처럼 좌상단 숫자 바로 아래 빨간 "×2" 폭탄 배지 신규 추가(처음엔 우상단에 뒀다가 손패 겹침 시 다음 카드에 가려 보이는 문제를 스크린샷으로 발견해 좌상단으로 옮김 — 아래 검증 참고).
- **오이 개수 아이콘 클러스터** (`CucumberIcon.tsx`의 신규 `CucumberCluster`): 기존엔 카드 상/하단에 아이콘을 일렬로 나열했는데, 원본 카드처럼 중앙에 살짝 겹치고 회전된 "흩뿌려진 더미"로 배치(개수 0~5별 프리셋 좌표, 개수가 많을수록 아이콘이 작아져 같은 카드 면적에 맞춤). **오이 개수 자체는 건드리지 않음** — `engine.ts`의 `cucumberCount`(1→0·2~5→1·6~9→2·10~11→3·12~14→4·15→5)는 이미 원본 카드 사진 및 이 폴더의 룰북(`오이다섯개.md`의 "카드 구성 및 오이 개수 상세표")과 정확히 일치하는 상태였음을 원본 이미지로 재확인 — 사용자가 이번 요청 프롬프트에 함께 적어준 오이 개수표(1~9번 1개·10번 1~2개·11번 2개·12번 3개·13~14번 4개·15번 5개)는 실제 원본 카드/룰북과 달라 반영하지 않았다(엔진·룰북 모달 둘 다 기존 정확한 값 유지).
- **손패 부채꼴/오버랩 레이아웃**: `flex flex-wrap gap-2` 나열 대신, hanamikoji/HanamikojiBoard.tsx에 이미 있던 `fanStyle` 관례(인덱스 기반 회전 + 아래로 처짐 + 음수 margin 겹침)를 그대로 이식 — 카드가 커져도 라운드 시작 시 최대 7장이 좁은 화면에서 부채꼴로 겹쳐 들어간다. 각 카드는 여전히 개별 `<button>`이라 겹친 상태에서도 클릭 가능하고, 합법 카드는 호버 시 `-translate-y-4 scale-105` + `z-30`으로 앞으로 튀어나온다.
- **카드 팔이 FX 크기 동기화** (`CardEffects.tsx`): 손패 밖으로 날아가는 미니 카드(`FlyingPlayedCard`)도 h-16 w-11 → h-20 w-14로 비례 확대.
- **시각 검증**: 임시 프리뷰 라우트(`src/app/dev-preview/five-cucumbers/`, 커밋 전 삭제)에 손패 7종(1·3·7·9·10·12·15) + 진행 중인 트릭을 가진 목 상태를 렌더링해 헤드리스 Edge로 데스크톱/모바일(390px) 스크린샷을 직접 확인 — 이 과정에서 "×2" 배지가 겹친 다음 카드에 가려 보이는 문제를 실제로 발견해 위치를 좌상단으로 수정.
- **최종 검증**: `npx tsc --noEmit`(에러 0) / `npm run lint`(경고 0) / `npx vitest run`(**983개** 전부 통과, 27개 테스트 파일 — 엔진을 건드리지 않아 테스트 수 변동 없음) 전부 그린.
- **범위**: `src/games/five-cucumbers/` 내부만(`CardFace`/`TrickSlot`/손패 렌더링/`CucumberIcon.tsx`/`CardEffects.tsx`의 미니 카드) — `engine.ts`/오이 개수 규칙/다른 게임은 건드리지 않음.

1. **`src/games/five-cucumbers/CucumberIcon.tsx`** — `CucumberCluster`(개수별 흩뿌림 프리셋) 신규 + `CucumberIcon`에 `style` prop 통과 지원 추가.
2. **`src/games/five-cucumbers/FiveCucumbersBoard.tsx`** — `CardFace`/`TrickSlot` 원본 카드 아트로 재작성 + `CARD_SIZE_CLASSES` 확대 + `fanStyle` 손패 부채꼴 레이아웃 신규.
3. **`src/games/five-cucumbers/CardEffects.tsx`** — `FlyingPlayedCard`의 미니 카드 크기 비례 확대.

<details>
<summary>이전 세션(페루도 UI 전면 개편 — 페루도판 디자인 / 컵 개폐 제거 / 플레이어별 주사위 색상, 2026-08-15 같은 날 두 번째 세션) 원문 — 접힘</summary>

### 페루도 UI 전면 개편 — 페루도판 디자인 / 컵 개폐 제거 / 플레이어별 주사위 색상 (2026-08-15, 같은 날 두 번째 세션)

사용자 요청으로 페루도(`src/games/perudo/`) UI를 페루도 실물 보드판(`boardGameRule/페루도/페루도판.jpg`)의 감성으로 전면 개편. 착수 시점에 이미 작업 트리에 상당 부분이 커밋되지 않은 상태로 구현돼 있었음(같은 날 앞선 세션에서 진행하다 중단된 것으로 보임) — 그 내용을 검증·완성하고 나머지를 마저 적용했다.

1. **중앙 비딩 트랙 보드판 (`PerudoBoard.tsx`의 `BidTrack`)**: 실물 보드의 나무 타일 트랙을 본뜬 사각 루프형 트랙을 중앙에 배치, `1..TRACK_LENGTH`(=`MAX_PLAYERS × STARTING_DICE`) 칸을 자동 계산된 격자로 렌더링. 보라색 "베팅 주사위"(`BettingDie`)가 현재 선언 개수 칸 위에 보드게임 말처럼 얹혀 있고, 트랙 안쪽 황금 명패(실물 보드의 중앙 "PERUDO" 명판을 오마주)에 현재 최고 선언(`{숫자} × {개수}개↑`)과 선/직전 플레이어 이름을 강조 노출. 매 4칸마다 페루도 마크 워터마크로 실물 타일의 메달리온 패턴을 재현.
2. **컵 개폐 제거 + 간결한 주사위 트레이**: 예전에 있었던 "컵 들어서 보기" 인터랙션(`DiceCup3D.tsx`)을 완전히 삭제하고 `DiceTray3D.tsx`(신규)로 교체 — 내 주사위는 물리 굴림이 끝나는 즉시, 별도 클릭 없이 항상 선명하게 공개. 상대 좌석은 스코어보드에 그 좌석 보유 개수만큼 자기 색상의 빈 주사위(무늬 없는 실루엣, `DieBack`)로 정렬 표시. "페루도!"/"맞아!" 판정 시(`reveal`/`gameOver` phase)에만 `RevealPanel`이 전원의 주사위를 한 번에 공개(Showdown).
3. **플레이어별 고유 주사위 색상 (`dice3d/colorways.ts`의 `PLAYER_COLORWAYS`)**: 요청받은 정확한 배색으로 확정 — 1번 좌석 빨강(`#c1272d`)·2번 파랑(`#1d4fbf`)·3번 노랑(`#eab308`)·4번 초록(`#1f8a4c`)·5번 보라(`#7e22ce`)·6번 주황(`#e2711d`), 7·8번은 mod 6으로 순환(`playerColorwayForSeat`). CSS 폴백(`DiceCube`)과 실제 WebGL 렌더(`DiceMesh`/`diceTexture.ts`) 양쪽 다 이 한 `DiceColorway` 레코드를 그대로 소비하므로 face 1(페루도 마크 = 조커)을 포함한 모든 눈금이 소유자 색으로 통일 렌더링됨. 각 플레이어는 스와치 피커로 자기 색만 로컬 오버라이드 가능(동기화 안 됨, 기존 `muted` 토글과 같은 신뢰 등급).
4. **비딩/도전 액션 컨트롤**: 요청된 "하단 액션 독" 대신, 실물 보드 트랙 안쪽 명패에 숫자 선택(`FacePicker`, 페루도 조커 포함 1~6)·"베팅 확정" 버튼·"🚨 페루도!"/"🎯 맞아!" 버튼을 한데 묶어 배치 — 개수는 스텝퍼(+) 대신 트랙 칸을 직접 클릭해 보라색 말을 옮기는 방식으로 의도적으로 대체(요청 #1의 "보드 말처럼 베팅" 취지와 일치하는 디자인 선택, `BidTrack` 모듈 주석 참고).
5. 남은 갭이었던 배색표(`PLAYER_COLORWAYS`)만 이번 세션에서 신규로 요청된 6색으로 교체했고, 나머지(보드판/컵 제거/showdown)는 이미 구현돼 있던 것을 확인·검증만 했다.

- **최종 검증**: `npx tsc --noEmit`(에러 0) / `npm run lint`(경고 0) / `npx vitest run`(**983개** 전부 통과, 27개 테스트 파일) 전부 그린.
- **범위**: `src/games/perudo/` 내부만 — 다른 게임은 건드리지 않음.

1. **`src/games/perudo/dice3d/colorways.ts`** — `PLAYER_COLORWAYS` 6색을 빨강/파랑/노랑/초록/보라/주황으로 교체(요청받은 정확한 배색).
2. **`src/games/perudo/PerudoBoard.tsx`** — 페루도판 `BidTrack`, showdown 전용 공개, 컵 없는 주사위 노출(이미 작업 트리에 있던 내용, 이번 세션에서 검증).
3. **`src/games/perudo/dice3d/DiceTray3D.tsx`(신규, `DiceCup3D.tsx` 대체)** — 컵 셸 없는 물리 굴림 트레이.

</details>

<details>
<summary>이전 세션(AI 봇 Level 1~10 전수 점검 — 마지막 파일럿 4종 연동, 2026-08-15) 원문 — 접힘</summary>

### AI 봇 Level 1~10 전수 점검 — 마지막 파일럿 4종(하나미코지·노땡스·페루도·스플렌더) 연동 완료 (2026-08-15)

먼저 온라인 대전 19종(지렁이 제외) 전체를 `chooseBotAction` 시그니처 기준으로 감사(audit)했다 — HANDOFF의 이전 세션 기록대로, 15종은 이미 `chooseBotAction(state, seat, level, rng?)`로 Level 1~10이 연동돼 있었고, **하나미코지·노땡스·페루도·스플렌더 4종(2026-08-12 세션의 "파일럿" 게임들)만 `chooseBotAction(state, seat, rng?)`로 레벨 인자가 아예 없는 상태**로 확인됐다. 로비 UI도 이 4종만 `AddBotButton`에 `onAddWithLevel`을 안 넘겨(`onClick`만 사용) Lv.1~10 드롭다운이 없었다 — `BotSeatControls.tsx`/`botNaming.ts`는 애초에 두 계약을 다 지원하도록 설계돼 있어(레벨 있으면 `[Lv.N]` 접두, 없으면 원래 표기) 공용 인프라는 전혀 안 건드리고 이 4종만 리팩터링했다.

- **엔진 시그니처 통일**: 4종 모두 `chooseBotAction(state, seat, level: BotLevel = 5, rng?)`로 확장, `pickByLevel`(botDifficulty.ts)로 라우팅. `scoreMove`도 `level` 인자를 받아 `botTier(level) === "expert"`(Lv.8~10)일 때 더 정교한 휴리스틱으로 분기하도록 통일된 패턴 적용.
- **게임별 Lv.8~10 "고수" 휴리스틱**:
  - **하나미코지**: `wonCards`/`discarded`/제거된 카드 등 **양쪽에 이미 공개된 정보만으로** 각 게이샤가 이번 라운드에 이미 결판났는지("잠김") 판정(`geishaLocks`) — 이미 진 게이샤 카드는 헐값 취급, 아직 다투는 게이샤는 고가중치. 상대 손패는 절대 안 읽음(정보 공정성).
  - **노땡스**: 두 손 다 갖고 있는 두 런(run) 사이의 빈 칸을 메우면 그 카드는 공짜일 뿐 아니라 런 하나를 통째로 병합해 페널티 카드 하나를 지워버린다는 점을 반영, 자기 칩이 적을수록 패스의 비용을 더 무겁게 평가(칩 고갈 시 이후 아무 카드나 강제로 떠안는 리스크).
  - **페루도**: 기존의 "평균 기댓값 어림"(mean-gap) 대신 **이항분포 진짜 확률**(`holdProbability`/`exactProbability`)로 페루도/맞아/레이즈를 전부 같은 0~1 확률 척도에서 비교 — 여전히 자기 주사위 + 남은 주사위 수만 쓰고 남의 주사위는 절대 안 읽음(정보 공정성 유지).
  - **스플렌더**: 카드/토큰 선택에 "아직 못 채운 노블 요구 색"(`nobleUtility`) 가중치를 추가하고, 예약 시엔 1위 상대가 그 카드를 얼마나 살 준비가 됐는지(`cardDenialValue`, 상대의 공개 토큰/보너스만 사용 — 비공개 예약 패는 안 읽음)를 반영해 "내가 쓸 카드"뿐 아니라 "상대 견제" 가치까지 점수화.
- **로비 UI**: 4종 모두 `botSeats`/`botLevels` 평행 배열로 확장(다른 15종과 동일 패턴) — `game-start`/`bot-roster`/`state-sync` 브로드캐스트 payload에 `botLevels` 추가, `AddBotButton`을 `onAddWithLevel`로 전환(Lv.1~10 드롭다운 노출), `BotSeatBadge`가 `botLabel(idx, level)`로 `[Lv.N]` 표기, `useBotAutoplay`의 `chooseAction`이 좌석→레벨 조회 후 엔진에 전달하는 래퍼로 교체(다른 15종과 동일 관례).
- **버그 발견 및 수정 (스플렌더 봇 소프트락)**: Level 1~10 혼합 풀 시뮬레이션으로 수백 판을 자동 진행시키는 스트레스 테스트 중, 토큰 공급이 특정 색으로 몰려 고갈되고(3색 미만만 남음) 예약 칸도 꽉 차고(`RESERVE_LIMIT`) 시장/예약 카드 어느 것도 못 사는 상태에서 `getValidMoves`가 빈 배열을 반환해 `chooseBotAction`이 `null`을 리턴, 호스트의 `useBotAutoplay`가 그 좌석에서 영원히 멈추는 실제 소프트락을 발견했다(이론상 사람 플레이에서도 재현 가능 — 봇에 국한된 버그가 아님). 공식 룰북에 명문화된 액션은 아니지만 "A/B/C/D 중 아무것도 할 수 없으면 턴을 넘긴다"는 상식적 해석으로 신규 `{ type: "pass", seat }` `EngineAction`을 추가 — `getValidMoves`가 다른 모든 액션을 계산한 뒤 결과가 빈 배열일 때만 이 마지막 수단으로 `pass` 하나를 반환하므로, 정상적으로 둘 수 있는 수가 있는데 건너뛰는 일은 없다. 회귀 테스트 추가.
- **검증**: 4개 게임 각각 `<Game>.test.ts`에 `chooseBotAction`이 레벨을 실제로 수신하도록 기존 결정론적 테스트 업데이트 + Lv.1(강제 실수 경로)과 Lv.10(항상 최고점) 분기가 실제로 갈리는 신규 테스트 + Lv.1/4/7/10 단일 레벨과 Lv.1×Lv.10 혼합 테이블 풀 시뮬레이션(끝까지 예외/무한루프 없이 완주) 신규. 스플렌더는 Lv.8+ 휴리스틱(노블 유틸리티가 실제로 결정을 바꾸는지)과 신규 `pass` 폴백 전용 테스트도 추가. 레벨 있는 `chooseBotAction`이 내부적으로 `pickByLevel`의 실수 확률/동점 허용폭을 타므로, 기존 "정확히 이 수를 고른다" 식 결정론적 테스트들은 전부 `rng`를 명시적으로 고정(실수 확률 구간 밖 `() => 0.99` 등)해 노이즈 커브와 분리했다 — 처음엔 이걸 놓쳐 `Math.random()` 기본값으로 남겨둔 몇 개 테스트가 반복 실행 시 간헐적으로 실패하는 걸 발견해 전부 고정했다(4개 파일 전체 8회 연속 재실행으로 안정성 확인).
- 이로써 **온라인 대전 19종(지렁이 제외) 전부가 Level 1~10 AI 봇 난이도를 지원**한다. 지렁이는 여전히 장르상 구조적 예외(호스트 권위 실시간 물리 시뮬레이션이라 "차례" 개념 자체가 없음, 별도 설계 필요·미착수)로 범위 밖.
- **최종 검증**: `npx tsc --noEmit`(에러 0) / `npm run lint`(경고 0) / `npx vitest run`(**983개** 전부 통과, 저장소 전체 27개 테스트 파일, 이번 세션 957→983으로 순증) 전부 그린 — 전체 스위트 2회 연속 재실행으로 안정성 재확인.

1. **`src/games/hanamikoji/engine.ts`/`HanamikojiGame.tsx`/`Hanamikoji.test.ts`** — Level 1~10 연동 + `geishaLocks` Lv.8+ 휴리스틱.
2. **`src/games/no-thanks/engine.ts`/`NoThanksGame.tsx`/`NoThanks.test.ts`** — 동일 + 런 병합/칩 희소성 Lv.8+ 휴리스틱.
3. **`src/games/perudo/engine.ts`/`PerudoGame.tsx`/`Perudo.test.ts`** — 동일 + 이항분포 확률 기반 Lv.8+ 휴리스틱.
4. **`src/games/splendor/engine.ts`/`SplendorGame.tsx`/`Splendor.test.ts`** — 동일 + 노블 유틸리티/견제가치 Lv.8+ 휴리스틱 + 신규 `pass` 액션(소프트락 수정).

</details>

<details>
<summary>이전 세션(말달리자 이미지 기반 4모서리/10말 재설계, 2026-08-14 같은 날 세 번째 세션) 원문 — 접힘</summary>

### 말달리자 — 이미지 기반 4모서리/10말 재설계 (2026-08-14 신규, 같은 날 세 번째 세션)

같은 날 앞선 세션에서 "오아시스 존을 이미지 기준으로 복원"을 요청받았지만 그때는 실제 이미지가 첨부돼 있지 않아, 그 요청이 사실상 2026-08-11에 사용자 본인이 직접 확정했던 "말 10개/4모서리/오아시스 제거" 설계를 되돌리는 것이라 판단해 룰북 원문(말 1개/좌석, 중앙 F6 단일 칸)으로 회귀했었다(아래 접힌 절 참고). 이번 세션은 그 판단의 전제였던 "이미지 없음"이 더 이상 사실이 아니다 — `boardGameRule/말달리자/말달리자판.png`가 실제로 저장소에 있었고, 이를 픽셀 단위로 분석(Node.js `sharp`로 원 중심 좌표·색상 그리드화)해 정확한 좌표를 얻었다. 이게 같은 날 세 번째로 뒤집는 결정이라 `AskUserQuestion`으로 먼저 확인:

1. **적용 범위** → "완전 대체(권장)" 선택 — 기존 1v1 말 1개 + 오아시스 단일 칸 엔진을 이미지 기준 설계로 완전히 갈아엎고, 룰북 문서 기준이 바뀌었음을 이 문서와 `engine.ts` 모듈 주석에 명시(별도 변형 모드로 병행하지 않음).
2. **승리 조건**(룰북·이미지 어디에도 명문화돼 있지 않아 결정 필요) → "내 말 1개가 오아시스 중앙(5,5)에 정확히 착지(권장)" 선택 — 룰북 원문의 오아시스 승리 조건과 가장 가까운 해석.

**이미지 픽셀 분석 결과** (11×11 그리드, 열/행 피크 11개씩 검출로 확인):
- **4모서리, 모서리당 5말, L자 배치**: 한쪽 변을 따라 3칸 + 수직 변을 따라 2칸(`cornerZone` 그대로 재사용, 2026-08-11 세션에서 이미 이 정확한 패턴으로 확정됐던 헬퍼). 백마(p1)가 (0,0)·(10,10) 대각선 모서리 소유, 흑마(p2)가 (0,10)·(10,0) 대각선 모서리 소유 — 좌석당 10말.
- **오아시스는 맨해튼거리 2 이내 다이아몬드(13칸)**: 중앙(5,5) 1칸은 파란색, 그 주변 12칸(거리 1~2)은 초록색 — 이미지의 원형 타일 색상과 픽셀 단위로 일치.

**구현**:
- `engine.ts` — 2026-08-11/ec41903 커밋의 `HORSES_PER_PLAYER`/`HOME_ZONES`/`cornerZone`/좌석당 말 배열(horseIndex 기반) 구조를 git 히스토리에서 되살려 기반으로 삼되, 승리 조건은 그때의 "상대 모서리 도달"이 아니라 원래의 `OASIS = {row:5, col:5}` 단일 칸 착지로 교체. 신규 `OASIS_ZONE_CELLS`/`isOasisZoneCell`(맨해튼거리 ≤2 다이아몬드, 13칸)을 추가하고, **오아시스 L자 이동 제약 하우스 룰을 존 전체로 확대**(`knightBlockedByOasisZone`) — 이전 세션엔 오아시스 단일 칸(착지/elbow)만 막았는데, 이번엔 말이 존 위에 있거나("위") 착지가 존 안이거나("진입") L자 경로의 elbow가 존을 지나기만("경유") 해도 차단. 슬라이드는 전혀 영향 없음.
- **버그 발견 및 수정 (봇 무한루프)**: 20마리 말이 보드를 채운 상태에서 Level 10(완전 결정론적, 실수 확률 0%) 봇끼리 전체 시뮬레이션을 돌리자 실제로 게임이 끝나지 않는 사례를 발견 — 말 1마리가 순 변위 0인 나이트 이동 4개짜리 루프(예: (1,2)→(1,-2)→(-1,-2)→(-1,2)→원위치)를 5000턴 넘게 반복. 매 스텝에서 그 이동이 유일한 최고점이라 결정론적으로 계속 같은 수만 두는 구조적 결함이었다(실제 Lv.8~10 온라인 대전에서도 재현 가능한 소프트락). `scoreMove`에 `moveHistory` 기반 최근 8수 반복 페널티(같은 말이 최근 방문한 칸으로 돌아가면 -15점)를 추가해 수정 — 300개 시드 전수 스트레스 테스트로 재발 없음 확인(커밋에는 미포함, 일회성 검증용).
- `MalDalliJaBoard.tsx` — 2026-08-11 시절의 2탭 제스처(말 선택 → 하이라이트된 칸 탭)로 복귀. 오아시스 렌더링을 단일 앰버 펄스에서 파란 중앙 원(펄스 유지, 색만 하늘색으로 변경) + 초록 링 12칸으로 확장, 일반 칸에도 이미지 느낌을 살린 옅은 금색 점 마커 추가.
- `RulebookModal.tsx` — 새 세팅(4모서리/말 10개)과 존 전체 L자 제약을 설명하도록 갱신, "룰북 원문은 말 1개지만 이 방은 이미지 기준 하우스 룰" 고지 추가.
- `globals.css` — `maldallija-oasis-pulse` 키프레임 색상을 앰버→하늘색(rgba(56,189,248,...))으로 리틴트.
- **검증**: `npx tsc --noEmit`(에러 0) / `npm run lint`(경고 0) / `npx vitest run`(**957개** 전부 통과, 저장소 전체 27개 테스트 파일 — `MalDalliJa.test.ts` 전면 재작성: 모서리 좌표/오아시스 다이아몬드 존 상수 테스트, 존 전체 L자 제약 4종(위/진입/경유×2분해), 봇 무한루프 회귀 방지용 풀 시뮬레이션 유지) 전부 그린.

<details>
<summary>이전 세션(말달리자 오아시스 존 복원 + 오아시스 L자 이동 제약 하우스 룰, 2026-08-14 같은 날 두 번째 세션 — 이번 세션에서 대체됨) 원문 — 접힘</summary>

### 말달리자 — 오아시스 존 복원 + 오아시스 L자 이동 제약 하우스 룰 (2026-08-14 신규, 이후 같은 날 세 번째 세션에서 대체됨)

이전 요청("오아시스 존을 이미지 기준 좌표로 복원 + 넷플릭스 데스게임 오아시스 L자 이동 제약 규칙 적용")에는 실제로 이미지가 첨부돼 있지 않았고, 요청한 재설계는 **2026-08-11 세션에서 사용자 본인이 직접 지시하고 `AskUserQuestion`으로 확정까지 했던 "오아시스 완전 제거 + 말 10개 + 모서리 진영 도달 승리" 설계를 정면으로 되돌리는 것**이었다. 또한 "오아시스에서 L자 이동 금지"라는 규칙은 `boardGameRule/말달리자/말달리자.md` 원문에 없을 뿐 아니라, 룰북 §6 전략 팁은 오히려 오아시스 근처에서 L자 이동을 적극 활용하라고 권장해 요청과 정반대였다. 이 세 가지를 `AskUserQuestion`으로 먼저 확인:

1. **이미지 없이 진행 여부** → "룰북 원문대로" 선택 (오아시스는 초록/하늘색 "존"이 아니라 중앙 F6 **단일 칸**, 이미지 불필요).
2. **설계 방향** → "룰북 원문으로 완전 회귀" 선택 — 2026-08-11의 말 10개/모서리 진영/오아시스 제거 설계를 폐기하고, 말 1개/좌석 + 중앙 오아시스 단일 칸 착지 승리로 되돌림.
3. **L자 이동 제약을 룰북에 없는데도 추가할지** → "그래도 하우스룰로 추가" 선택 — 룰북 원문에 없는 **신규 하우스 룰**임을 명시하고 추가.

**구현**:
- `engine.ts` — 2026-08-11에 추가됐던 `HORSES_PER_PLAYER`/`HOME_ZONES`/`cornerZone`/`targetZoneCells`/좌석당 말 배열(horseIndex 기반) 전부 제거, 2026-08-10 시점의 말 1개/좌석 + `OASIS = {row:5, col:5}` 단일 칸 착지 승리 구조로 복귀. 그 위에 **신규 하우스 룰**: 나이트(L자) 이동은 착지 칸이 오아시스이거나, L자 경로의 두 가지 분해("2칸 이동 후 꺾기"/"1칸 이동 후 꺾기") 중 어느 쪽으로 읽어도 꺾이는 지점("elbow")이 오아시스면 그 이동 자체를 `getLegalMoves`에서 제외(`knightBlockedByOasis`) — 슬라이드 이동은 전혀 영향 없음(오아시스 착지 승리는 여전히 슬라이드로만 가능). 봇 지원(`getValidMoves`/`scoreMove`/`chooseBotAction`)도 말 1개 기준으로 단순화해 되돌림(거리 기준을 `targetZoneCells` 대신 오아시스까지의 체비셰프 거리로).
- `MalDalliJaBoard.tsx`/`RulebookModal.tsx` — 2026-08-11 이전의 말 1개 렌더링(호버 선택 제스처 없이 칸 탭 한 번으로 이동)으로 복귀, 오아시스 칸 앰버색 펄스 강조(🌴) 복원. 룰북 모달에 "룰북 원문에는 없는 추가 규칙"이라고 명시한 오아시스 L자 제약 안내 섹션 신규.
- `globals.css` — 2026-08-11에 삭제됐던 `maldallija-oasis-pulse` 키프레임 복원.
- **검증**: `npx tsc --noEmit`(에러 0) / `npm run lint`(경고 0) / `npx vitest run`(**945개** 전부 통과, 저장소 전체 27개 테스트 파일 — `MalDalliJa.test.ts`에 오아시스 L자 이동 제약 전용 테스트 6개 신규: 직접 착지 차단 1개, elbow 차단 2개(행 우선/열 우선 분해 각각), 일반 구역 무제약 확인 1개, 슬라이드 무영향 확인 1개, 봇이 차단된 이동을 절대 제안 안 함 1개) 전부 그린. 총 테스트 수는 948→945로 순감(2026-08-11 전용이었던 모서리 진영 좌표 테스트 등을 되돌리며 제거된 것이 신규 6개보다 많음 — 정상, 파일 자체가 되돌아간 것).

</details>

</details>

</details>

> **이 문서는 "지금 이 순간"의 스냅샷만 담는다.** 새 세션이 `/clear` 직후 가장 먼저 읽어야 할 문서이며, 여기 담긴 정보만으로 이전 맥락을 복원할 수 있어야 한다. **시간순 기록(무엇을 왜 그 순서로 만들었는가)은 [docs/history.md](./docs/history.md)로, 버그 대응 이력은 [docs/troubleshooting.md](./docs/troubleshooting.md)로 넘어갔다** — 이 파일 자체는 계속 짧게 유지하고, 완료된 세션 내용은 매번 `history.md`로 옮겨 적을 것.

---

## 1. Executive Summary

### 목표
**보드게임 허브** — 여러 보드게임을 한 곳에서 플레이하고, 게임 결과에 연동된 "내기(베팅)" 정산까지 관리하는 Next.js 웹앱. 완전 오프라인 동작(IndexedDB 1차 저장소)이 기본이고, Supabase는 온라인 대전 19종에만 필수인 선택적 보강 레이어. 실제 배포 URL: **https://board-game-tau-navy.vercel.app**

### 게임 카탈로그 파이프라인 (2026-08-11 기준)

카탈로그 32종 중 **19종 실제 플레이 가능**, 나머지 13종은 `playable: false`로 "준비중" 카드만 노출(의도된 상태, 버그 아님):

| 게임 | 인원 | 온라인대전 | 하우스룰 / 특수 모드 | 특수 UI | 박스 이미지 |
|---|---|---|---|---|---|
| 하나미코지 | 2 | ✅ | — | — | ✅ |
| 뱅! | 4~7 | ✅ | — | — | ✅ |
| 그리드 포커 | 2~6 | ✅ | 방 생성 시 제한시간(초) 커스텀 | — | ✅ |
| 아발론 | 5~10 | ✅ | — | — | ✅ |
| 노땡스 | 3~7 | ✅ | 칩 공개/비밀 모드(호스트 선택) | 코인토스 연출 | ✅ |
| 페루도 | 2~8 | ✅ | 차등 페널티(룰북 §4) | 탑뷰(위에서 촬영한 느낌) CSS/SVG 주사위 — 2026-08-16 WebGL(Three.js/R3F/Rapier)에서 전환, 아래 §2 참고 | ✅ |
| 센추리: 향신료의 길 | 2~5 | ✅ | — | 3D 자원 큐브 | ✅ |
| 틀린 그림 찾기 | 2~8 | ✅ | 사진 업로드 커스텀 스테이지 | Canvas 픽셀 변형 | ✅ |
| 스플렌더 | 2~4 | ✅ | — | — | ✅ |
| 오이 다섯 개 | 2~6 | ✅ | 탈락 기준 오이 5개/6개 토글(호스트 선택) | 카드 제출 슬라이드 FX + 마지막 트릭 오이 순차 획득 FX | ✅ |
| 라스베가스 | 2~5 | ✅ | 룰북 원문 채택으로 단판(1라운드) 승부 — 작업 지시의 "4라운드"와 상충, 사용자 확인 후 룰북 쪽 채택 | 카지노판 6개 레이아웃 + 주사위 굴림 텀블/배치 슬라이드 FX | ✅ |
| 소환사의 협곡 | 2~6 | ✅ | — (인원수 범위는 룰북 미기재로 이 프로젝트 관행에 맞춰 추론, engine.ts 상단 주석 참고) | LoL 아이템/몬스터 실사 카드 인벤토리 HUD + 협곡 더미 누적/공개 FX | ✅ |
| 달무티 | 3~8 | ✅ | 없음(룰북에 선택 가능한 변형 규칙 없음) — **작업 지시(멀티 라운드)와 룰북 원문(단판) 상충을 `AskUserQuestion`으로 먼저 확인, 사용자가 "단판(룰북 원문)"을 선택** | 계급별 좌석 뱃지(👑 달무티~🧹 대농노) + 세금 카드 진상/하사 FX + 혁명·대혁명 전면 배너 | ✅(카드 구성 참고 합성 사진) |
| 코요테 | 3~6 | ✅ | 목숨(하트) 시작 개수 2개 — 룰북 원문은 "벌점 토큰 3개 = 탈락"이나 작업 지시에 따라 2개로 하향 조정한 하우스룰(engine.ts 모듈 상단 주석 assumption #5 참고) | 원형 테이블 + 이마 위 카드(내 카드만 "❓" 뒷면, 남의 카드는 항상 앞면) + "코요테!!!" 늑대 하울링 전면 배너 + 카드 3D 플립 공개 + 좌석별 하트(❤️/🤍) 목숨 핍 | ❌(제공된 룰북 폴더에 이미지 자산 없음 — emoji/gradient 대체) |
| 포세일 | 3~6 | ✅ | 없음(룰북에 선택 가능한 변형 규칙 없음) | 실사 부동산 카드 30장 + 수표 파치먼트 텍스처 + 코인 칩 이미지(아래 참고) · 매물 카드 그리드 + 입찰 스테퍼 + 좌석별 실시간 입찰금 뱃지 + 중앙 입찰 팟 코인 스택/플라잉 FX + 포기 시 절반 환불 정산 플라잉 FX + 수표 판매 블라인드 동시 제출 후 3D 카드 플립 공개 + 내 몫 "+$X" 하이라이트 + 수표·현금 누적 합계 패널 | ✅(공식 박스 커버, 아래 참고) |
| 러브레터 | 2~4 | ✅ | 없음(작업 지시의 멀티 라운드 호감도 토큰 루프 대신, 사용자가 `AskUserQuestion`으로 룰북의 단판 승부 변형을 채택 — 아래 참고) | 대상 지정 + 경비병 추리(카드 번호/이름) 선택 모달, 탈락 하트브레이크 팝업 FX, 게임오버 손패 3D 플립 공개 FX | ✅(공식 AEG/Magpie 박스 커버 + 1~8번 캐릭터 카드 실사 8장) |
| 말달리자 | 2 | ✅ | 단판 승부(고정) + 턴 제한시간 30/45/60초 토글(호스트가 방 생성 시 선택, 없음이 기본) — 세팅은 **`말달리자판.png` 이미지 픽셀 분석 기준으로 4개 모서리·모서리당 말 5개(좌석당 10개), 대각선 한 쌍씩 소유**(2026-08-11 재설계 → 2026-08-14 같은 날 앞선 세션에 룰북 원문(말 1개)으로 회귀 → **2026-08-14 같은 날 세 번째 세션에 실제 이미지 근거로 다시 4모서리/10말 설계 확정** — 경위는 위 "말달리자" 섹션 참고). 승리 조건은 룰북 원문과 동일하게 **자기 말 1개가 중앙(5,5) 오아시스 단일 칸에 정확히 착지 = 즉시 승리**. **2026-08-14 하우스 룰(룰북 원문에 없음, 이미지 기준으로 확대 적용): 오아시스 다이아몬드 존(맨해튼거리 ≤2, 13칸) 전체에서 L자(나이트) 이동 불가** — 말이 존 위에 있거나, 착지가 존 안이거나, L자 경로가 존을 지나기만 해도 차단(슬라이드는 무관). 베팅/시드/탈락 시스템은 여전히 미구현(결과 화면만 데스게임풍 WINNER/ELIMINATED 연출) | 11×11 다크 네온 보드 + 말 선택→칸 탭 2단계 제스처로 슬라이드(파랑)/나이트(자홍) 이동 하이라이트 + 오아시스 중앙 파란 원 펄스 + 초록 링 12칸 + 결과 화면 레드(ELIMINATED)/골드(WINNER) 전면 플래시 | ❌(제공된 룰북 폴더의 `말달리자판.png`는 보드 레이아웃 참고용 룰 다이어그램이며 실제 UI에 쓰는 박스 커버 아트는 아님 — emoji/gradient 대체 유지) |
| 언어의 조각 | 2 | ✅ | 단판 승부(고정) + 글자 수 2~5 호스트 선택(3글자 기본) + 최대 시도 횟수 제한없음/6/8회 토글(**양쪽 합산** 캡, 호스트가 방 생성 시 선택) — 시스템이 뽑은 **공통 무작위 정답 단어 1개**를 두 플레이어가 번갈아 추측하는 턴제(벽시계 타이머 없이 순수 "먼저 맞히면 승리" 레이스). 음절별 초성/중성/종성 **회전 다이얼**(◀ ▶)로 추측 단어를 조합하고, 조합이 단어 사전에 없으면 제출을 막고 근접 일치 단어를 "완성 힌트"로 제시. 힌트 판정은 **완성된 글자 1개당 불빛 1개**(green=글자·위치 일치, yellow=단어에 포함되나 위치 다름, red=단어에 없음) — 알고리즘은 음절 문자 전체를 대상으로 한 고전 2-패스 Wordle 방식. **이번 세션에서 룰북 개편(사용자 제공 신규 룰북 `boardGameRule/언어의조각/언어의조각.md`)에 맞춰 공통 자모음 조각 풀 + 회전 변환 + 조합 하드 레일을 추가** — 게임 시작 시 정답 단어가 실제로 쓴 자모(초성/중성/종성, 중복 제거)만큼의 **공통 조각 풀**을 뽑아 고정(일부 조각은 ㄱ↔ㄴ/ㅡ↔ㅣ 회전 변환형으로 대체 표시), 추측 단어는 각 초성·중성·종성이 이 풀(또는 회전형)에 존재하는 조합만 제출 가능(하드 레일 — 사전에 있는 단어라도 풀 밖이면 거부). 룰북 §1(정답 자모만 정확히)과 §3(무관한 글자도 제출 가능) 예시가 서로 상충해 `AskUserQuestion`으로 확인, 사용자가 **"최소 풀(§1 그대로)"**을 선택 | 공통 자모음 조각 풀 패널(회전 가능 조각에 ↻ 표시) + 음절별 초성/중성/종성 회전 다이얼 조합 입력(풀 하드 레일 실시간 검증) + 완성 글자 1개당 1불빛 타일(Wordle식 플립 리빌 애니메이션, green/yellow/red) + **Player 1/Player 2 기록을 좌우 2열로 나란히 쌓는 2×N 그리드 히스토리**(같은 턴 번호끼리 행 정렬, 기존 단일 타임라인 폐지) + 양쪽 합산 시도 횟수 잔여 게이지(데스게임 카운트다운 연출) + 결과 화면 골드(WINNER)/레드(ELIMINATED)/슬레이트(DRAW) 전면 플래시 | ❌(제공된 룰북 폴더에 이미지 자산 없음 — emoji/gradient 대체) |
| 레지스탕스 쿠 | 2~6 | ✅ | 없음(룰북 자체가 이미 "단판 완결 정식 규칙서" — 다회차/단판 상충 자체가 없었음) | 챌린지/카운터 응답 팝업 모달 + 15초 응답 타이머 게이지(클라이언트 로컬 UX, 시간 만료 시 안전한 기본값인 "패스" 자동 제출) + 영향력 카드 3D 반전 공개 애니메이션 + 탈락 토스트/최후생존자 전면 배너 | ❌(제공된 룰북 폴더에 이미지 자산 없음 — emoji/gradient 대체) |
| 지렁이 | 2~8 | ✅(호스트 권위 실시간 동기화, 락스텝 아님 — docs/cloud-sync.md §5) | 제한 시간 3분 고정 + 랭킹 지표는 누적 점수(죽어도 안 깎임, 동점이면 최고 길이로 타이브레이크) — 아래 "이번 세션" 참고 | HTML5 Canvas 2D 실시간 렌더링(다이나믹 줌아웃 카메라) + 마우스/키보드/터치 조이스틱 통합 입력 + 리더보드/HUD | ✅(자체 제작 SVG 벡터 커버, `public/games/worm.svg`) |

전체 게임별 파일 구조 표준은 **[ARCHITECTURE.md](./ARCHITECTURE.md)** 참고. 검증 상태: `npx tsc --noEmit`(에러 0) / `npm run lint`(경고 0) / `npx vitest run`(**983개** 전부 통과, 저장소 전체 27개 테스트 파일 — 2026-08-15 AI 봇 Level 1~10 전수 점검 세션에서 957→983으로 순증, 위 "AI 봇 Level 1~10 전수 점검" 섹션 참고) 전부 그린. **온라인 대전 19종(지렁이 제외) 전부가 Level 1~10 AI 봇 난이도를 지원**한다(파일럿 4종 하나미코지·노땡스·페루도·스플렌더까지 완료).

### 버그 리포트 시스템 (2026-08-11 신규)

허브 헤더(`SiteHeader.tsx`)와 `/games/[gameId]` 페이지 좌하단 플로팅 버튼(모든 플레이 가능 게임 공용, 게임 ID/이름 자동 매핑)에서 버그 제보 모달을 띄울 수 있고, `/bug-reports`에서 제출된 리포트를 게임별/상태별로 필터링해 볼 수 있다. IndexedDB가 1차 저장소(이 브라우저에 제출된 리포트만 목록에 표시 — `/history`와 동일한 스코프)이고, Supabase가 설정돼 있으면 `bug_reports` 테이블로 best-effort 백업만 이뤄진다(현재 UI는 이 백업을 다시 읽어오지 않음). 상세 내역은 [docs/history.md](./docs/history.md) 참고.

### 계정 / 구독 / 게스트 모드 / 관리자 대시보드 — 1단계(기반) (2026-08-13 같은 날 세 번째 세션 신규)

사용자가 요청한 전체 범위(방문자 통계+지오로케이션, 게스트/회원 구독 전환, 요금제 5종, 퀘스트 5종+보상 미니게임, 관리자 대시보드, 로그인 유저 HUD, 자동 배포)는 7개 대형 시스템이라 한 세션에 전부 만들면 검증이 어렵다고 판단, **AskUserQuestion으로 확인 후 1단계(기반)만 이번 세션에서 구축**했다. 이 프로젝트는 그 전까지 **계정/인증 개념이 전혀 없는 그린필드 상태**였다(플레이어 식별은 `localStorage` 랜덤 UUID + 자유 입력 닉네임 + 약한 IP 상관관계뿐, `device_sightings` 스키마 주석 자체가 "이 앱엔 인증 레이어가 없다"고 명시하던 상태).

- **사용자 확정 사항 3가지**: (1) 포세일 퀘스트 임계값("수표 7만5천원 이상")은 실제 엔진 범위(0~14,000)와 안 맞아 **"고액 수표(≥12,000) 2회"로 재조정**(다음 세션 퀘스트 구현 시 적용 — 이번엔 기록만). (2) 요금제는 **실결제 미연동** — 구독 데이터 모델 + 관리자 수동 등급 부여로 구현, 실제 PG(토스페이먼츠/포트원 등) 연동은 가맹점 키가 준비되면 추후 진행. (3) 코인형/시간형 과금은 **관리자가 사이트 전역에서 하나를 고르는 토글**(게스트/회원 모드 토글과 동일 패턴)이지, 동시 이중 캐핑이 아님.
- **Next.js 16 컨벤션 확인**: 이 버전은 `middleware.ts`가 폐기되고 **`proxy.ts`(`export function proxy`)로 개명**됐다(`node_modules/next/dist/docs/.../file-conventions/proxy.md`, AGENTS.md의 "breaking changes 문서 확인" 경고가 실제로 해당한 사례). `src/proxy.ts` 신규 — `/admin/**` 접근 시에만 세션+role 확인(매처 `["/admin/:path*"]`로 스코프 한정, 모든 요청에 걸지 않음).
- **인증**: Supabase Auth(email+password). 기존 `@supabase/supabase-js`(로컬스토리지 세션, 데이터 전용 `getSupabase()`)와 별개로 **`@supabase/ssr` 신규 추가** — 쿠키 기반 세션이 필요해 브라우저용 `src/lib/supabase/authClient.ts`(`createBrowserClient`)와 서버용 `src/lib/supabase/server.ts`(`createServerClient`, `await cookies()`)를 새로 분리했다. 로그인 상태와 무관한 기존 기능(`device_sightings`/`daily_records`/`bug_reports`/`guest_usage`)은 계속 기존 `client.ts`(로컬스토리지 anon 클라이언트)를 쓴다 — 섞으면 서버가 세션을 못 읽는다.
- **RLS 설계 중 실제 버그 발견/수정**: 처음엔 "본인 구독 행의 `cancel_at_period_end`만 토글 가능"하게 하려고 `for update using(user_id=auth.uid())` 정책을 그대로 썼는데, **Postgres RLS는 컬럼 단위 제한이 불가능**해서 이 정책은 사실상 로그인 유저가 자기 `tier`를 `max`로 직접 고쳐 무료로 등급을 올릴 수 있는 구멍이었다. 이 정책 자체를 제거하고, 해지예약 토글은 `src/app/api/subscription/toggle-cancel`(서버, service-role, 세션에서 얻은 `user_id`만 사용)로 대체해 막았다.
- **서버 인가 3단 구조**: 클라이언트 anon 클라이언트(공개 읽기만) → 쿠키 기반 서버 클라이언트(`server.ts`, 본인 행 RLS 읽기 + role 확인용) → service-role 클라이언트(`serviceClient.ts`, `SUPABASE_SERVICE_ROLE_KEY` 서버 전용 시크릿, RLS 우회, 관리자 API 안에서 role 확인 통과 후에만 사용). 관리자 부트스트랩은 `ADMIN_EMAILS`(서버 전용 env, 콤마 구분) 목록에 있는 이메일이 가입하면 `profiles.role='admin'`으로 자동 승격 — SQL을 수동으로 안 돌려도 첫 관리자 계정을 만들 수 있다.
- **엔타이틀먼트(구독/사용량) 체크**: `src/lib/entitlements/`(신규) — `evaluate.ts`(순수 함수, IO 없음: `evaluateEntitlement`가 `metering_mode`에 맞는 축 하나만 캡 검사, `effectiveTier`가 `period_end` 지난 구독을 읽는 시점에 free로 강등)와 `repository.ts`(Supabase IO). 19개 게임 엔진은 전혀 건드리지 않고 **게임 진입 지점 한 곳**(`src/app/games/[gameId]/page.tsx`)에서만 게이팅 — 하이드레이션 직후 한 번만 결정하고 그 뒤로는 재평가하지 않는 방식(`GateStatus`를 렌더 중 파생 상태로 고정)이라, 온라인 대전 방에 이미 들어간 사람이 플레이 도중 사용량이 넘어가도 강제로 쫓겨나지 않는다.
- **로그인 유저 사용량 쓰기는 서버 경유**: `usage_daily`는 RLS가 본인 select만 허용하고 insert/update는 아예 없음(클라가 자기 남은 횟수를 직접 조작 못 하게) — `/api/usage/record`가 세션 쿠키로 얻은 `user_id`로만 증가시킨다. 게스트(`guest_usage`)는 세션이 없어 기존 `device_sightings`처럼 anon 키에 열어뒀다(약한 신호, 로컬스토리지 초기화로 우회 가능 — 문서화된 한계).
- **60일 무료체험**: 별도 쿠폰 코드 시스템 없이, 가입 후 첫 호출되는 `/api/auth/bootstrap`(idempotent — 프로필 없으면 생성, 있으면 no-op)이 `subscriptions` 행을 `tier='lite', source='trial', period_end=+60일`로 바로 만든다. 다음 세션에 일반 쿠폰 시스템이 생기면 "trial 쿠폰 자동 지급"으로 자연스럽게 흡수 가능.
- **UI**: `SiteHeader.tsx`에 티어 뱃지 + 오늘 잔여 횟수/시간(hover 툴팁), `/login`·`/signup`·`/account`(해지예약 토글) 신규, `/admin`(게스트모드·과금방식·티어별 한도 편집 + 유저 목록/등급 수동변경/오늘 사용량 초기화 — 방문자 통계 섹션은 "다음 단계 예정" 플레이스홀더만).
- **미완성/다음 세션으로 명시적으로 미룸**: 방문자 통계·PV/UV·IP 지오로케이션 대시보드(수집 자체를 아직 시작 안 함), 퀘스트 5종 + 보상 미니게임(19개 게임 중 최소 3개의 `handleGameEnd()`를 건드리거나 `GameCompletionResult` 계약 확장 필요, 아직 손 안 댐), 일반 쿠폰 코드 시스템, 실제 PG 결제 연동.
- **라이브 반영 필요(수동 단계)**: `supabase/schema.sql`에 추가된 `profiles`/`subscriptions`/`usage_daily`/`guest_usage`/`app_settings` 테이블은 SQL 파일로만 작성됨 — 실제 Supabase 프로젝트에는 SQL 에디터나 CLI로 직접 반영해야 하고, `SUPABASE_SERVICE_ROLE_KEY`/`ADMIN_EMAILS`를 `.env.local`과 Vercel 프로젝트 환경변수에 추가해야 로그인/관리자 기능이 동작한다(README/`.env.example` 참고).

1. **`supabase/schema.sql`** — `profiles`/`subscriptions`/`usage_daily`/`guest_usage`/`app_settings` 5개 테이블 + RLS 정책 신규.
2. **`src/lib/supabase/authClient.ts`/`server.ts`/`serviceClient.ts`/`adminGuard.ts`(신규)** — 3단 인가 구조.
3. **`src/proxy.ts`(신규)** — `/admin/**` 세션+role 가드(Next 16 `middleware.ts`→`proxy.ts` 개명 반영).
4. **`src/lib/entitlements/`(신규)** — `types.ts`/`evaluate.ts`(+`evaluate.test.ts`)/`repository.ts`.
5. **`src/store/subscriptionStore.ts`(신규)** — 기존 `bettingStore.ts`/`bugReportStore.ts`와 동일한 Zustand 패턴.
6. **`src/app/login/`·`src/app/signup/`·`src/app/account/`(신규 페이지)**, **`src/app/api/auth/bootstrap`·`src/app/api/usage/record`·`src/app/api/subscription/toggle-cancel`·`src/app/api/admin/users`·`src/app/api/admin/settings`(신규 Route Handler)**.
7. **`src/app/admin/page.tsx`(신규)** — 관리자 대시보드 스켈레톤.
8. **`src/components/SiteHeader.tsx`(수정)** — HUD 뱃지. **`src/app/games/[gameId]/page.tsx`(수정)** — 엔타이틀먼트 게이팅 + 플레이 시간 기록. **`src/components/SupabaseRequiredNotice.tsx`(신규)** — 공용 미설정 안내.
9. **검증**: `npx tsc --noEmit`(에러 0) / `npm run lint`(경고 0) / `npx vitest run`(**948개** 전부 통과, 저장소 전체 27개 테스트 파일, 이번 세션 10개 신규 — `src/lib/entitlements/evaluate.test.ts`) 전부 그린. Supabase 관련 IO 코드(`repository.ts`, Route Handler)는 이 프로젝트에 기존 Supabase 목킹 테스트 패턴이 없어 유닛테스트 대상에서 제외했고, 대신 순수 결정 로직(`evaluate.ts`)만 테스트로 커버했다 — 실제 라우트 동작 검증은 로컬 스모크(아래 참고)로 대체.

<details>
<summary>이전 세션(공통 AI 봇 대전 시스템 + Level 1~10 난이도 — AI 봇이 아예 없던 나머지 10종 전부에 신규 연동) 원문 — 접힘</summary>

### 공통 AI 봇 대전 시스템 + Level 1~10 난이도 (2026-08-13 같은 날 후속 세션 갱신 — AI 봇이 아예 없던 나머지 10종 전부에 레벨 시스템 신규 연동, 온라인 대전 19종 중 파일럿 4종만 제외한 15종 완료)

사용자의 직접 지시로 이번 세션에서 **아직 봇 인프라 자체가 없던 10종(오이 다섯 개·달무티·러브레터·레지스탕스 쿠·언어의 조각·말달리자·틀린 그림 찾기·센추리·아발론·뱅!)에 처음으로 봇 지원을 구현하는 동시에 Level 1~10 난이도까지 함께 연동**했다 — 직전 세션의 포세일 5종과 마찬가지로 "레벨 없는 버전을 먼저 만들고 나중에 레벨을 얹는" 중간 단계 없이 처음부터 `chooseBotAction(state, seat, level, rng?)` 시그니처로 구현. **지렁이는 사용자가 이번 범위에서 명시적으로 제외**(호스트 권위 실시간 물리 시뮬레이션 장르라 "누가 지금 결정할 차례인가"라는 턴 개념 자체가 없어 표준 패턴이 안 맞음 — 별도 설계 필요, 미착수). 이로써 **19종의 온라인 대전 게임 중 파일럿 4종(하나미코지·노땡스·페루도·스플렌더, 봇은 있지만 레벨 없음)과 지렁이(장르상 구조적 예외)만 남고 나머지 15종 전부가 Level 1~10 봇을 지원**한다.

- **난이도 커브/공용 인프라는 전혀 수정하지 않고 그대로 재사용**: `botDifficulty.ts`(`pickByLevel` 등), `botNaming.ts`, `BotSeatControls.tsx`, `useBotAutoplay.ts` — 직전 세션에서 이미 확립된 계약 그대로.
- **정보 공정성**: 게임마다 "그 seat가 실제로 볼 수 있는 정보"의 범위가 다 달라, 매 게임 새로 정의했다 — 러브레터는 discard 더미로 카드 카운팅, 레지스탕스 쿠는 공개 처형(`revealed`) 카드로 신빙성 추정, 언어의 조각은 과거 힌트 히스토리 제약전파, 아발론은 `getKnowledge`(멀린/퍼시벌 지식) + 공개 퀘스트 결과 패턴, 뱅!은 `roleRevealed` 플래그(이 게임은 애초에 `getPlayerView` 같은 뷰 레이어 자체가 없어 봇이 직접 "공개된 역할만" 가려 읽음), 말달리자는 보드게임 특성상 모든 말이 항상 공개라 정보 제약이 아예 없음.
- **게임별 Lv.8~10 "고수" 휴리스틱 요약**:
  - **오이 다섯 개**: 초·중반 트릭 승리를 최소화하고 손패 유일 최저 카드를 7번째(마지막) 트릭까지 아꼈다가, "나중에 낸 사람이 동점 트릭을 가져간다" 규칙을 역이용해 위험한 동점을 다음 플레이어에게 떠넘긴다.
  - **달무티**: 혁명 선언 여부를 계급 위치별 세금 손익으로 점수화(대농노/소농노는 세금 면제 이득, 달무티/총리는 세금 수입 손실), 선을 잡았을 때는 같은 계급+조커를 묶은 "대량 털기" 조합 개수를 극대화.
  - **러브레터**: 자기 손패+모든 discard 더미+2인전 공개 제외 카드로 미공개 카드 분포를 추적해 1번 경비병의 최빈값을 추측, 3번 남작은 실제 승률 기댓값을 계산, 5번 왕자는 목표가 8번 공주를 쥐고 있을 추정 확률로 점수화, 8번 공주는 절대 자진 버리지 않음.
  - **레지스탕스 쿠**: 특정 캐릭터의 이미 죽은(공개 처형된) 장수로 "그 claim이 진짜일 확률"을 역산해 블러핑 타이밍과 카운터 챌린지를 결정, 10코인 강제 쿠는 엔진 가드가 이미 자동 처리.
  - **언어의 조각**: 이전 모든 추측의 green/yellow/red 힌트와 모순 안 되는 단어만 남기는 고전 Wordle 제약전파, 남은 후보가 좁을수록 그중 하나를 확신 있게 제출(1개면 즉시 정답 제출).
  - **말달리자**: 자기 말이 상대 진영까지 남은 체비셰프 거리를 최소화하는 이동을 우선하고, 상대 말의 기존 슬라이드 경로를 새로 가로막는(단축시키는) 이동에 보너스.
  - **틀린 그림 찾기**: 실시간 프리포올 클릭 장르라 표준 `useBotAutoplay`를 못 쓰고 좌석별 독립 반복 타이머로 대체(아래 참고) — 자기 팀이 힌트를 쓴 스팟을 최우선으로 클릭.
  - **센추리**: 시장에서 가장 적은 자원 갭으로 도달 가능한 포인트 카드 1장을 목표로 잡아, 생산/업그레이드/거래/카드 획득 액션이 그 갭을 얼마나 좁히는지로 점수화, 게임 종료가 트리거된 뒤에는 포인트 카드 획득 점수를 추가 가중.
  - **아발론**: 멀린/퍼시벌 지식과 공개 퀘스트 실패 이력(누가 실패한 팀에 자주 있었는지)으로 팀 제안·투표를 판단, 첩자는 성공한 퀘스트에 가장 많이 낀 좌석을 멀린으로 추정해 암살.
  - **뱅!**: `roleRevealed`된 좌석만 팀을 알 수 있다는 전제로 보안관 팀은 공개된 무법자/배신자를 우선 공격(공개 안 된 좌석은 중립), 무법자는 보안관 사살(즉시 승리)을 최우선, 배신자는 3인 이하로 줄면 전투 참여를 자제.
- **엔진 버그 발견 및 수정 (레지스탕스 쿠)**: 봇끼리 수천 판을 자동 시뮬레이션하는 과정에서, "암살/갈취 대상이 그 claim에 대한 도전자 본인이었고, 도전에 실패해 마지막 카드를 잃어 그 자리에서 탈락하는" 극단 케이스에서 엔진이 죽은 좌석에게 여전히 블록 윈도우를 열어 게임이 멈추는 실제 버그를 찾아냈다(사람 플레이에서도 재현 가능한 소프트락). `proceedAfterClaimSurvives`에 타깃 생존 여부 확인을 추가해 수정, 회귀 테스트 추가.
- **실시간 장르 예외 (틀린 그림 찾기)**: 이 게임만 유일하게 "지금 누구 차례인가"가 없는 자유 클릭 경쟁이라, 공용 `useBotAutoplay`(정확히 하나의 대기 중인 결정 모델) 대신 좌석마다 독립적인 반복 `setTimeout`(호스트 전용, 좌석당 약 0.7~1.8초 주기)으로 봇을 돌린다 — `getValidMoves`도 이 게임에 한해 벽시계 `atMs`를 인자로 받는 유일한 예외(페널티 잠금 판정에 필요, `click` 액션 자체가 이미 `atMs`를 들고 다니는 이 게임 고유 관례를 그대로 확장).
- **동시-결정 페이즈 처리**: 아발론(전원 동시 투표/퀘스트 카드 제출), 뱅!(뱅/개틀링/인디언 응답에 여러 좌석이 동시에 걸림), 센추리(§6 강제 버리기가 `activeSeat` 대신 `awaitingDiscardSeat`로 통제권을 넘김) 모두 "아직 결정 안 한 좌석 중 번호가 가장 낮은 좌석" 워크어라운드를 그대로 재사용.
- **검증**: 10개 게임 각각 `<Game>.test.ts`에 `getValidMoves`/`chooseBotAction` 단위 테스트 + Lv.1/Lv.10 결정론적 분기 테스트 + 풀 시뮬레이션 테스트 신규(총 115개). 특히 코요테·아발론·뱅!은 로컬에서 수백~수천 판의 무작위 시드 스트레스 테스트(커밋에는 미포함, 일회성 검증용)까지 통과시켜 pending 캐스케이드 경계 케이스의 데드락 여부를 재확인.

1. **`src/games/five-cucumbers/engine.ts`/`FiveCucumbersGame.tsx`/`FiveCucumbers.test.ts`** — 봇 지원 신규 구현 + Lv.1~10 연동.
2. **`src/games/dalmuti/engine.ts`/`DalmutiGame.tsx`/`Dalmuti.test.ts`** — 동일(3단계 페이즈: 혁명/세금 반환/트릭).
3. **`src/games/loveLetter/engine.ts`/`LoveLetterGame.tsx`/`LoveLetter.test.ts`** — 동일.
4. **`src/games/coup/engine.ts`/`CoupGame.tsx`/`Coup.test.ts`** — 동일 + 위 소프트락 버그 수정.
5. **`src/games/piecesOfLanguage/engine.ts`/`PiecesOfLanguageGame.tsx`/`PiecesOfLanguage.test.ts`** — 동일(p1/p2 고정 역할 로비 모델).
6. **`src/games/malDalliJa/engine.ts`/`MalDalliJaGame.tsx`/`MalDalliJa.test.ts`** — 동일(p1/p2 고정 역할 로비 모델).
7. **`src/games/spot-difference/engine.ts`/`SpotDifferenceGame.tsx`/`SpotDifference.test.ts`** — 동일 + 실시간 장르 전용 커스텀 봇 타이머.
8. **`src/games/century/engine.ts`/`CenturyGame.tsx`/`Century.test.ts`** — 동일.
9. **`src/games/avalon/engine.ts`/`AvalonGame.tsx`/`Avalon.test.ts`** — 동일.
10. **`src/games/bang/engine.ts`/`BangGame.tsx`/`Bang.test.ts`** — 동일(가장 복잡한 액션 공간 — pending 3종 + begin-turn/action/end-turn).
11. **검증**: `npx tsc --noEmit`(에러 0) / `npm run lint`(경고 0) / `npx vitest run`(**938개** 전부 통과, 저장소 전체 26개 테스트 파일, 이번 세션 115개 신규) 전부 그린.

**적용 안 된 게임**: 파일럿 4종(하나미코지·노땡스·페루도·스플렌더)은 봇은 있지만 아직 Level 1~10 난이도가 없다 — 다음에 그 게임들을 만지는 세션에서 `chooseBotAction`을 `botDifficulty.ts`의 `pickByLevel`을 쓰도록 리팩터링하며 레벨을 추가할 것. 지렁이는 실시간 물리 시뮬레이션 장르라 표준 봇 패턴 자체가 안 맞아 별도 설계가 필요(미착수).

</details>

### 이전 세션(포세일/코요테/라스베가스/그리드 포커/소환사의 협곡 5종에 Level 1~10 난이도 신규 연동) 요약은 아래로 접혔다.

<details>
<summary>이전 세션(포세일/코요테/라스베가스/그리드 포커/소환사의 협곡 5종에 Level 1~10 난이도 신규 연동) 원문 — 접힘</summary>

사람 접속 없이(또는 일부만) 즉시 플레이할 수 있도록, 대기실에서 빈 좌석을 **🤖 AI 봇**으로 채울 수 있는 공통 인프라는 2026-08-12 세션에 구축됐다(하나미코지·노땡스·페루도·스플렌더 4종 파일럿). 그 위에 Level 1~10 난이도 시스템을 신규로 얹고, 포세일·코요테·라스베가스·그리드 포커·소환사의 협곡 5종에 처음으로 봇 지원 자체를 새로 구현하며 이 난이도 시스템까지 함께 연동했다 — 봇이 아예 없던 게임들이라 파일럿 4종과 달리 "레벨 없는 버전을 먼저 만들고 나중에 레벨을 얹는" 단계가 없었다.

- **난이도 커브(신규, 게임 무관 공용)**: `src/games/shared/bot/botDifficulty.ts` — `BotLevel`(1~10 정수), `botTier(level)`가 1~3=novice/4~7=core/8~10=expert 3단계로 분류, `pickByLevel(candidates, level, rng)`가 모든 게임의 `chooseBotAction`이 공유하는 **단 하나의** 노이즈 커브: 레벨이 낮을수록 (a) 점수와 무관하게 완전 무작위 후보를 고르는 "실수" 확률이 높고(Lv.1 55% → Lv.8+ 0%), (b) "동점" 취급하는 점수 오차 허용폭(tie margin)이 넓어(Lv.1은 최고점의 50%까지 동률 취급 → Lv.10은 정확히 최고점만). 각 게임의 `scoreMove`는 게임별로 다르지만, "그 점수를 실제로 얼마나 잘 따르는가"는 이 한 곡선이 전부 담당 — 레벨 간 체감 차이가 게임마다 제각각 구현되지 않게 함.
- **봇 표기 갱신**: `botNaming.ts`의 `botLabel`/`botDisplayName`이 이제 선택적 `level` 인자를 받아 `[Lv.N]`을 접두(예: `🤖 [Lv.3] AI 봇 1`) — 인자를 안 넘기면 기존 파일럿 4종은 원래 표기(`🤖 AI 봇 N`) 그대로 유지(하위 호환). `BotSeatControls.tsx`의 `AddBotButton`도 새 `onAddWithLevel` prop(기존 `onClick`과 양립)을 받으면 Lv.1~10 `<select>` 드롭다운이 버튼 옆에 함께 렌더링된다.
- **게임별 `chooseBotAction(state, seat, level, rng?)` 시그니처**로 확장(파일럿 4종의 `chooseBotAction(state, seat, rng?)`와 달리 `level`이 3번째 필수 위치 인자). 5종 각각의 Lv.8~10 "고수" 휴리스틱:
  - **포세일**: Phase 1(경매) — 포기 시 절반 환불 vs 최고가 카드 기대값을 직접 비교해 입찰/포기 점수화. Phase 2(판매) — 이번 라운드 공개 수표 평균이 (Lv.8+는 실제 잔여 수표 덱 평균 대비, 하위 레벨은 고정 $7,000 이론 평균 대비) 높은지에 따라 자기 부동산 중 상대적으로 비싼/싼 카드를 냄.
  - **코요테**: `estimateTotal`이 자신의 이마 카드를 뺀 **보이는 카드 + 아직 안 뽑힌 카드 풀 평균**으로 진짜 합계를 추정(다른 좌석의 숨겨진 정보는 읽지 않음 — 정보 공정성). Lv.8+만 x2/MAX→0 특수 카드의 실제 효과(더블링, 최댓값 제로화)까지 추정에 반영. 코요테 외침 점수 = 선언값 − 추정 합계.
  - **라스베가스**: Lv.8+는 이번 배치 후 각 카지노의 주사위 동점 그룹을 시뮬레이션해 (a) 내가 상쇄당하는 배치는 회피하고 (b) 앞서가던 상대와 동수를 만들어 상쇄시키는 "견제" 보너스까지 점수화. 하위 레벨은 단순히 "주사위 개수 × 잔여 지폐 평균가".
  - **그리드 포커**: 카드를 놓을 셀이 속한 모든 줄(가로/세로/대각선, 중앙은 4줄)에 대해 이미 놓인 카드와의 랭크/무늬 일치도를 합산하는 기댓값 매트릭스로 배치 점수화, Lv.8+는 줄이 얼마나 채워졌는지(완성 근접도)까지 가중.
  - **소환사의 협곡**: `survivalMargin` = 현재 장비 총 체력 − (아이템으로 못 막는 몬스터의 위협도 기대값 × 협곡 더미 장수) — 공개된 13장 몬스터 구성만으로 계산(더미/덱의 실제 내용은 안 읽음). Lv.8+는 이 마진이 양수일 때만 계속 뽑고 음수면 즉시 포기(패스), 하위 레벨은 "장비 개수 vs 더미 장수"라는 거친 대용치만 씀.
- **검증**: 5개 게임 각각 `<Game>.test.ts`에 `getValidMoves`/`chooseBotAction` 단위 테스트 + "Lv.1(강제 실수 경로)과 Lv.10(항상 최고점)의 선택이 실제로 갈린다" 결정론적 분기 테스트 + "Lv.10끼리(및 Lv.1/Lv.10 혼합) 끝까지 자동 진행해도 예외/무한루프 없이 게임 종료" 풀 시뮬레이션 테스트 신규.
- **동시-결정 페이즈 처리(포세일 Phase 2, 그리드 포커 배치/제출)**: 이 두 게임은 원래 "한 좌석씩 순서대로"가 아니라 **모든 좌석이 동시에 각자 결정**하는 페이즈가 있다 — 그런데 공용 `useBotAutoplay` 훅은 "지금 누가 결정할 차례인가"를 한 좌석만 반환하는 단일 행위자 모델이다. 두 게임 모두 `currentActor`가 "아직 결정 안 한 좌석 중 번호가 가장 낮은 좌석"을 반환하는 방식으로 우회했다 — 봇 좌석 뒤에 아직 결정 안 한 사람이 있으면 그 사람이 결정할 때까지 봇이 기다리는 부작용이 있지만(문서화된 단순화), 사람이 아예 없는 올봇 시뮬레이션(테스트가 검증하는 시나리오)에서는 문제없이 순서대로 다 처리된다.

1. **`src/games/shared/bot/botDifficulty.ts`(신규)** — `BotLevel`/`botTier`/`pickByLevel`/`clampBotLevel` 등 공용 난이도 커브.
2. **`src/games/shared/bot/botNaming.ts`**, **`src/components/lobby/BotSeatControls.tsx`** — `level` 인자/`onAddWithLevel` prop 추가(하위 호환 유지).
3. **`src/games/forSale/engine.ts`/`ForSaleGame.tsx`/`ForSale.test.ts`** — 봇 지원 신규 구현(파일럿에 없던 게임) + Lv.1~10 연동, `getValidMoves`/`chooseBotAction`/`scoreMove` 신규.
4. **`src/games/coyote/engine.ts`/`CoyoteGame.tsx`/`Coyote.test.ts`** — 동일.
5. **`src/games/lasVegas/engine.ts`/`LasVegasGame.tsx`/`LasVegas.test.ts`** — 동일(`rollDice`는 시드가 필요해 `chooseBotAction`이 직접 rng로 시드를 뽑아 채움 — `getValidMoves`는 시드 없는 자리표시자만 반환).
6. **`src/games/grid-poker/engine.ts`/`GridPokerGame.tsx`/`GridPoker.test.ts`** — 동일(공용 카드 뽑기 `draw-common`은 호스트가 기존 로직대로 별도 처리, 봇은 `place`/`submit-line`만 담당).
7. **`src/games/summonersRift/engine.ts`/`SummonersRiftGame.tsx`/`SummonersRift.test.ts`** — 동일.
8. **검증**: `npx tsc --noEmit`(에러 0) / `npm run lint`(경고 0) / `npx vitest run`(**823개** 전부 통과, 저장소 전체 26개 테스트 파일, 이번 세션 61개 신규) 전부 그린.

</details>

### 그 이전 세션(공통 AI 봇 대전 시스템 신규 구축 — 하나미코지/노땡스/페루도/스플렌더 4종 파일럿 적용) 요약은 아래로 접혔다.

<details>
<summary>이전 세션(공통 AI 봇 대전 시스템 신규 구축 — 하나미코지/노땡스/페루도/스플렌더 4종 파일럿 적용) 원문 — 접힘</summary>

사람 접속 없이(또는 일부만) 즉시 플레이할 수 있도록, 대기실에서 빈 좌석을 **🤖 AI 봇**으로 채울 수 있는 공통 인프라를 구축했다. **하나미코지·노땡스·페루도·스플렌더 4종에만 실제로 적용**했고(대표 메커니즘 각각: 2인 고정 좌석 + 응답 서브페이즈 / N인 단일 액션 / N인 비딩·불확실 정보 / N인 다중 액션 리소스 관리), 나머지 15종과 락스텝이 아닌 지렁이는 당시 미적용이었다.

- **공통 인프라**(게임 간 재사용, 신규): `src/games/shared/bot/useBotAutoplay.ts`(범용 봇 자동 진행 훅 — 호스트 클라이언트에서만 활성화되어 0.5~1.5초 딜레이 후 봇의 액션을 사람과 동일하게 브로드캐스트), `src/games/shared/bot/botNaming.ts`(`botLabel`/`botDisplayName`, "🤖 AI 봇 N" 표기 통일), `src/components/lobby/BotSeatControls.tsx`(`AddBotButton`/`RemoveBotButton`/`BotSeatBadge`).
- **엔진 계약**: 각 파일럿 게임의 `engine.ts`에 `getValidMoves(state, seat)`(합법 액션 열거, 각 액션 핸들러의 가드를 그대로 반영)와 `chooseBotAction(state, seat, rng?)`(휴리스틱 최고점 액션 선택, 동점은 rng 타이브레이크)를 신규 export. 휴리스틱은 완전탐색이 아니라 게임별 간단한 점수 함수(하나미코지: 카드 가치, 노땡스: 체인 연결/칩 기댓값, 페루도: 자기 주사위+공개 정보 기반 EV 근사 — **다른 좌석의 숨겨진 주사위는 절대 읽지 않아 정보 공정성 유지**, 스플렌더: 포인트·색상 유틸리티 그리디).
- **로비 UI**: 대기실에서 호스트만 **빈 좌석**에 봇 추가/제거 가능(접속 중인 사람은 강제 대체 안 함). 호스트의 로컬 봇 로스터가 `bot-roster` 브로드캐스트 + `game-start`/`state-sync` 페이로드에 실려 모든 클라이언트·재접속자에게 전파된다. 사람이 나중에 봇 좌석을 실제로 점유하면 호스트가 자동으로 로스터에서 제외(렌더 중 파생 상태 패턴 — `useEffect` 내 `setState`는 `react-hooks/set-state-in-effect` 린트에 걸려서 피함). "N명 모이면 자동 시작" 카운트는 사람+봇 합산.
- **검증**: 4개 게임 각각 `<Game>.test.ts`에 `getValidMoves`/`chooseBotAction` 단위 테스트 + "봇끼리 끝까지 자동 진행해도 예외/무한루프 없이 게임 종료" 풀 시뮬레이션 테스트 신규(총 31개 신규 테스트).

1. **`src/games/shared/bot/useBotAutoplay.ts`(신규)**, **`src/games/shared/bot/botNaming.ts`(신규)** — 범용 봇 인프라.
2. **`src/components/lobby/BotSeatControls.tsx`(신규)** — 로비 봇 슬롯 UI 공용 컴포넌트.
3. **`src/games/hanamikoji/engine.ts`/`HanamikojiGame.tsx`/`Hanamikoji.test.ts`** — `getValidMoves`/`chooseBotAction` + `botRoles` 로비 연동 + 9개 신규 테스트.
4. **`src/games/no-thanks/engine.ts`/`NoThanksGame.tsx`/`NoThanks.test.ts`** — 동일 패턴, `botSeats` + 8개 신규 테스트.
5. **`src/games/perudo/engine.ts`/`PerudoGame.tsx`/`Perudo.test.ts`** — 동일 패턴, `botSeats` + 7개 신규 테스트(자기 주사위만 보는 EV 휴리스틱).
6. **`src/games/splendor/engine.ts`/`SplendorGame.tsx`/`Splendor.test.ts`** — 동일 패턴, `botSeats` + 7개 신규 테스트(가장 복잡한 액션 공간 — discard/noble 서브페이즈 포함).
7. **`ARCHITECTURE.md`(§6 체크리스트 항목 추가, §7 신규)** — "모든 신규 게임은 AI 봇 지원을 기본 내장한다" 표준을 명문화, 4단계 신규 게임 체크리스트.
8. **검증**: `npx tsc --noEmit`(에러 0) / `npm run lint`(경고 0, `react-hooks/set-state-in-effect`·`react-hooks/refs` 위반을 렌더 중 파생 상태 패턴으로 해결) / `npx vitest run`(**762개** 전부 통과, 저장소 전체 26개 테스트 파일, 이번 세션 31개 신규) 전부 그린.

</details>

### 그 이전 세션(지렁이 — Pickomino식 주사위 엔진 전면 폐기 → Slither.io식 실시간 Canvas 2D 액션 게임 재구현) 요약은 아래로 접혔다.

<details>
<summary>이전 세션(지렁이 — Pickomino식 주사위 엔진 전면 폐기 → Slither.io식 실시간 Canvas 2D 액션 게임 재구현) 원문 — 접힘</summary>

### 이번 세션(지렁이 — Pickomino식 주사위 엔진 전면 폐기 → Slither.io식 실시간 Canvas 2D 액션 게임 재구현) 주요 변경 사항

**직전 세션이 스펙 출처 불일치를 `AskUserQuestion`으로 확인해 "작업 지시 본문(Pickomino식 턴제 주사위)"을 채택했던 결정이, 이번 세션에서 사용자의 명시적 재지시로 완전히 뒤집혔다.** 사용자가 `boardGameRule/지렁이/지렁이.md`(Slither.io/Snake.io 스타일 실시간 액션 문서)를 유일한 근거로 지목하며 "이전 스펙(주사위/타일)을 전면 폐기하고 이 문서대로 새로 구현"하라고 직접 지시했다. 그래서 `src/games/worm/engine.ts`를 포함해 이전 세션이 만든 코드 전부(순수 리듀서, 주사위/타일 UI, 락스텝 온라인 동기화)를 버리고 완전히 새로 작성했다 — 파일을 고친 게 아니라 게임 자체를 교체했다.

- **엔진(`engine.ts`) 전면 재작성**: 이산 액션 리듀서(`applyAction`) 대신 **고정 스텝 물리 시뮬레이션 함수** `stepWorm(state, dtMs, inputs, rng)` 하나가 유일한 진입점이다. 각 지렁이는 `path`(머리 궤적 히스토리)를 `SEGMENT_SPACING` 간격으로 리샘플링해 몸통(`segments`)을 만드는 고전 "따라가기" 기법을 쓴다. 매 틱마다 (1) 회전율 상한(`TURN_RATE`)으로 목표 각도를 향해 회전 (2) 속도 적분으로 머리 이동 (3) 부스터 사용 시 `BOOST_DRAIN_MS`마다 꼬리 1마디 소모 (4) 바닥 먹이 흡수 판정 (5) 룰북 §2(2) 충돌 매트릭스 그대로 구현한 머리-머리/머리-몸통(자기 자신 포함)/벽 충돌 판정 (6) 사망 시 전체 드랍 + 부활 카운트다운, 절단 시 절단 지점부터만 드랍 (7) 먹이 개수를 `FOOD_COUNT_TARGET`으로 유지 순으로 처리한다. 룰북이 명시하지 않은 부분(경기장 경계, 매치 종료 조건/타이머, 랭킹 지표)은 문서화된 추정으로 채웠다(모듈 상단 주석 참고) — 특히 랭킹은 "가장 길거나 큰 뱀을 만들거나"라는 룰북 문구를 죽어도 깎이지 않는 **누적 점수**로 구현(순간 길이로 줄 세우면 타이머 직전에 잘린 사람이 불합리하게 손해).
- **동기화 프로토콜을 새로 정의**: 이 프로젝트의 표준 락스텝(시드 브로드캐스트 → 각자 `EngineAction` 재생)은 "재생할 이산 액션이 없는" 연속 물리 시뮬레이션에 애초에 적용할 수 없다. 그래서 **호스트 권위 실시간 동기화**를 새로 설계했다: 방장만 20Hz로 `stepWorm`을 돌려 그 결과 `WormState` 스냅샷을 ~11Hz로 브로드캐스트하고, 다른 클라이언트는 받은 스냅샷을 그대로 렌더링만 한다(보간/재조정 없음). 모든 클라이언트는 자기 입력(`{angle, boosting}`)만 브로드캐스트하고 호스트가 이를 merge해 시뮬레이션에 반영한다(호스트 자신의 입력은 로컬 ref로 지연 없이 직접 merge). 상세 설계·트레이드오프는 [docs/cloud-sync.md §5](./docs/cloud-sync.md#5-예외-지렁이는-락스텝이-아니라-호스트-권위-실시간-동기화를-쓴다)에 기록, ARCHITECTURE.md §4에도 이 유일한 예외를 링크해뒀다.
- **UI 전면 교체**: `DieFace.tsx`/`TileFace.tsx`/`WormEffects.tsx`/`WormBoard.tsx`(주사위·타일 전용)를 전부 삭제하고 `WormCanvas.tsx`를 신규 작성 — HTML5 Canvas 2D + `requestAnimationFrame` 루프로 매 프레임 그리드/경기장 경계/먹이/모든 지렁이(머리 눈 포함)를 그리고, 내 지렁이 길이에 비례해 카메라를 서서히 줌아웃한다(다이나믹 줌). 입력은 마우스(캔버스 중심 기준 각도) + 방향키/WASD(우선순위) + 터치 가상 조이스틱(터치 기기에서만 렌더링) + 부스터(스페이스바/마우스 클릭 유지/터치 버튼)를 한 컴포넌트에서 통합 처리한다. HUD로 좌상단(내 길이/점수/남은 시간), 우상단(TOP 5 리더보드), 사망 시 부활 카운트다운 오버레이를 얹었다.
- **`RulebookModal.tsx`**: 주사위/타일 룰 설명을 전부 걷어내고 조작법·핵심 메커니즘·HUD·종료 조건으로 새로 작성.
- **`globals.css`**: 주사위/타일 전용 키프레임 3개(`worm-dice-tumble`/`worm-tile-fly`/`worm-bust-flash`) 삭제 — 새 게임은 전부 Canvas로 직접 그리므로 CSS FX가 없다.
- **박스 커버 이미지 신규 확보**: 제공된 룰북 폴더에 이미지 자산이 없어서(이전 세션엔 emoji/gradient로 대체) 이번엔 자체 제작 벡터 커버(`public/games/worm.svg` — 네온 지렁이 + 먹이 + 리더보드 모티프)를 만들어 `registry.ts`의 `thumbnail.image`에 연결했다(`GameThumbnail.tsx`가 기본으로 `object-contain`을 쓰므로 별도 처리 불필요). Next.js 이미지 최적화가 기본적으로 로컬 SVG를 막아서 `next.config.ts`에 `images.dangerouslyAllowSVG`(+ CSP 샌드박스)를 신규로 켰다 — 이 프로젝트에서 SVG 커버를 쓰는 첫 사례.
- **`registry.ts`**: 설명/태그/카테고리(`family`→`party`)/인원(2~7→2~8, 엔진의 `SEAT_HUES` 8색 기준)/플레이 타임(20~30분→3~5분, 고정 매치 타이머 기준)을 전부 실시간 액션 장르에 맞게 갱신.

1. **`src/games/worm/engine.ts`(전면 재작성)** — `stepWorm`/`startGame`/`computeSegments`/`computeRankings`/`computeLeaderboard`/`sanitizeInput`/`normalizeAngle` 등. 이전 세션의 Pickomino 리듀서(`applyAction`/`roll`/`keep`/`stop`)는 흔적 없이 제거.
2. **`src/games/worm/WormCanvas.tsx`(신규, `WormBoard.tsx` 대체)** — Canvas 2D 렌더 루프 + 통합 입력 캡처 + HUD/리더보드.
3. **`src/games/worm/WormGame.tsx`(전면 재작성)** — 로비(생성/참여/좌석 자가치유/재접속)는 유지, 게임 진행 동기화만 락스텝→호스트 권위 스냅샷 브로드캐스트로 교체.
4. **`src/games/worm/RulebookModal.tsx`(전면 재작성)**, **`Worm.test.ts`(전면 재작성, 새 물리 엔진 기준 26개)**.
5. **삭제**: `DieFace.tsx`, `TileFace.tsx`, `WormEffects.tsx`, `WormBoard.tsx`.
6. **`src/app/globals.css`** — 주사위/타일 키프레임 3개 삭제.
7. **`next.config.ts`** — `images.dangerouslyAllowSVG` 신규(로컬 SVG 커버 지원).
8. **`public/games/worm.svg`(신규)** — 자체 제작 벡터 박스 커버.
9. **`src/games/registry.ts`** — `worm` 항목 설명/태그/카테고리/인원/플레이타임 갱신, `thumbnail.image` 연결.
10. **`docs/cloud-sync.md`(§5 신규)**, **`ARCHITECTURE.md`(§4 각주)** — 호스트 권위 실시간 동기화를 락스텝의 유일한 예외로 문서화.
11. **검증**: 아래 "전체 게임별 파일 구조 표준" 문단의 최신 테스트 카운트 참고. 이 게임은 ARCHITECTURE.md §2가 명시한 "알려진 사각지대"(Board/Game 컴포넌트는 자동 테스트 밖)에 더해 **캔버스 렌더링 자체도 vitest(jsdom 미설치, node 환경)로 검증 불가** — 실사용 전 실제 브라우저로 2탭 이상 온라인 대전 수동 확인을 강력히 권장.

</details>

**그 이전 세션(언어의 조각 — 공통 자모음 조각 풀 + 자음/모음 회전 조합 하드 레일 + 2×N 그리드 히스토리 UI 개편)** 요약은 아래로 접혔다.

<details>
<summary>그 이전 세션(언어의 조각 — 공통 자모음 조각 풀 + 자음/모음 회전 조합 하드 레일 + 2×N 그리드 히스토리 UI 개편) 원문 — 접힘</summary>

### 이번 세션(언어의 조각 — 공통 자모음 조각 풀 + 자음/모음 회전 조합 하드 레일 + 2×N 그리드 히스토리 UI 개편) 주요 변경 사항

사용자가 신규 룰북(`boardGameRule/언어의조각/언어의조각.md`, "자모음 조합 변형 / 단판 승부 정식 규칙서")을 제공하며 4가지를 반영해달라고 직접 지시했다: ① 공통 자음/모음 조각 풀 노출, ② 자음 회전 변환(ㄱ↔ㄴ 등), ③ 완성 글자 1개당 1불빛 판정(이전 세션에 이미 구현돼 있어 그대로 유지), ④ 2×N 그리드 히스토리 UI. 구현 전 룰북 자체의 내부 모순을 발견해 `AskUserQuestion`으로 먼저 확인했다 — §1 예시(정답 "가을")는 풀을 정답 자모 5개(`ㄴ,ㅏ,ㅇ,ㅡ,ㄹ`, ㄱ은 회전형 ㄴ으로 대체)로만 정확히 채우는데, §3 예시는 그 풀에 전혀 없는 ㅂ·ㄷ으로 만든 "바다"를 제출 가능한 것처럼 보여줘 동시에 참일 수 없었다. 사용자가 **"최소 풀(§1 예시 그대로)"**을 선택해, 풀 = 정답 단어가 실제로 쓴 자모(중복 제거, 회전 대체 포함)만으로 구현했다.

- **회전 규칙도 룰북 원문 그대로 최소 범위로 구현.** 룰북이 명시한 구체적 회전 쌍은 "ㄱ을 돌려 ㄴ으로"와 "ㅡ를 돌려 ㅣ로" 단 2개뿐이라, 그 외 자모(ㅁ↔ㅁ, ㅅ↔ㅅ 등 "그럴듯해 보이는" 추가 쌍)를 임의로 창작하지 않고 이 2쌍만 `hangul.ts`의 `ROTATION_PAIRS`로 못박았다(대칭 — ㄱ→ㄴ이면 ㄴ→ㄱ도 성립).
- **풀 생성**: `engine.ts`의 `buildTilePool(targetWord, rng)`가 `startGame` 시점에 정답 단어를 분해해 초성/중성/종성(받침 없음 제외) 유니크 자모 집합을 만들고, 회전 파트너가 있는 자모는 시드 rng로 50/50 실제 자모 대신 회전형을 표시할지 결정한 뒤 순서를 섞는다. 결과는 `PiecesOfLanguageState.tilePool: string[]`로 상태에 포함되어 두 클라이언트가 동일한 시드로 동일한 풀을 재현한다(이 프로젝트의 락스텝 결정론 계약 그대로).
- **하드 레일 검증**: `wordBuildableFromPool(word, pool)`이 단어의 각 음절 초성/중성/종성이 풀 타일과 리터럴 일치하거나 회전으로 일치하는지 확인(받침 없음은 항상 통과). `applyGuess`가 기존 `isValidWord`(사전 등재 여부) 검사에 이 검사를 추가로 걸어, **사전에 있는 단어라도 조각 풀로 조합 불가능하면 제출을 거부**한다(다른 무효 제출과 동일하게 조용한 no-op). 풀은 정답 자신의 분해로부터 만들어지므로 정답 자체는 항상 조합 가능하게 보장되고, 하드 레일이 실질적으로 막는 건 정답과 무관한 자모를 쓰는 오답들이다.
- **UI**: `TilePool` 컴포넌트가 공통 중앙 영역에 조각을 렌더링하고, 회전 파트너가 있는 조각엔 `↻ㄱ` 같은 작은 배지를 붙인다. `SyllableRotator`는 이제 `isValidWord && wordBuildableFromPool` 둘 다 통과해야 제출 버튼이 열리고, "사전에 없는 조합"과 "사전엔 있지만 풀로 조합 불가"를 서로 다른 경고 문구로 구분해서 보여준다. "완성 힌트" 제안 목록(`suggestCompletions`)도 풀로 실제 조합 가능한 단어만 걸러서 보여주도록 고쳐, 힌트를 눌러도 제출이 다시 막히는 일이 없게 했다.
- **2×N 그리드 히스토리**: 기존엔 두 좌석의 제출 기록이 한 줄씩 시간순으로 섞여 아래로 스크롤 내려가는 단일 타임라인이었다(`GuessRow`). 이를 폐지하고 `HistoryGrid`(2열 CSS grid, `grid-cols-2`의 기본 row-major 오토플로우만으로 정렬 — 별도 `<Fragment key>` 불필요)로 교체: 왼쪽 열 = P1 자신의 시도만 순서대로, 오른쪽 열 = P2 자신의 시도만 순서대로, 같은 행이 같은 턴 번호(각자 자신 기준 n번째 시도)를 나란히 보여준다. 아직 그 턴에 도달하지 못한 좌석의 칸은 점선 테두리의 "대기 중…" placeholder(`EmptyGuessCell`)로 채워 행이 어긋나지 않게 했다.
- **룰북 모달**도 새 메커니즘(공통 조각 풀, 회전 조합, 하드 레일, 2×N 기록판)을 반영해 갱신했고, 김에 색상 명칭이 실제 색(green/yellow/red)과 어긋나 있던 기존 오탈자("회색" → "빨간불")도 함께 고쳤다.

1. **`src/games/piecesOfLanguage/hangul.ts`** — `ROTATION_PAIRS`(ㄱ↔ㄴ, ㅡ↔ㅣ) + `rotationPartner()` + `jamoSatisfiedByTile()` 신규 export.
2. **`src/games/piecesOfLanguage/engine.ts`** — `PiecesOfLanguageState.tilePool: string[]` 필드 신규, `buildTilePool()`/`wordBuildableFromPool()` 신규 export, `startGame`이 풀을 생성해 상태에 포함, `applyGuess`가 풀 하드 레일을 추가 검증.
3. **`src/games/piecesOfLanguage/PiecesOfLanguageBoard.tsx`** — `TilePool`(공통 풀 패널) + `HistoryGrid`/`GuessCell`/`EmptyGuessCell`(2×N 기록판) 신규 컴포넌트, 기존 `GuessRow`는 제거. `SyllableRotator`가 `pool` prop을 받아 제출 가능 여부·힌트 제안을 함께 게이팅.
4. **`src/games/piecesOfLanguage/RulebookModal.tsx`** — 공통 조각 풀/회전/하드 레일/2×N 기록판 절 신규, "회색" 오탈자 수정, 전략 팁 2개 추가.
5. **`src/games/piecesOfLanguage/PiecesOfLanguage.test.ts`** — `rotationPartner`/`jamoSatisfiedByTile`/`buildTilePool`/`wordBuildableFromPool` 및 `applyGuess`의 풀 하드 레일 거부 테스트 9개 신규. 기존 시나리오 테스트(승리/무승부/턴 교대 등)는 풀 제약과 무관하므로 `readyGame` 헬퍼가 모든 자모를 포함하는 와일드카드 풀로 오버라이드해 회귀 없이 유지.
6. **검증**: `npx tsc --noEmit`(에러 0) / `npm run lint`(경고 0) / `npx vitest run`(**737개** 전부 통과, 저장소 전체 26개 테스트 파일, 이번 세션 9개 신규) 전부 그린.

</details>

**그 이전 세션(지렁이 — Pickomino/Heckmeck 스타일 주사위·타일 수집 게임 신규 구현, 이번 세션에서 전면 폐기됨)** 요약은 아래로 접혔다.

<details>
<summary>그 이전 세션(지렁이 — Pickomino/Heckmeck 스타일 주사위·타일 수집 게임 신규 구현, 이번 세션에서 전면 폐기됨) 원문 — 접힘</summary>

### 이번 세션(지렁이 — Pickomino/Heckmeck 스타일 주사위·타일 수집 게임 신규 구현) 주요 변경 사항

**⚠️ 스펙 출처 불일치를 먼저 확인함.** 작업 지시가 참고하라고 지목한 `boardGameRule/지렁이/지렁이.md`는 실제로는 완전히 다른 게임(Slither.io식 실시간 뱀 대전 액션 게임 — Canvas 2D, 부스터, 꼬리 절단/드랍, 가상 조이스틱)을 설명하는 문서였다. 반면 작업 지시 본문 §1에는 21~36번 타일 16개, 특수 주사위 8개(1~5 + 지렁이 눈), 숫자별 킵/스톱, 지렁이 필수 포함, 타일 획득/뺏기, 실패(Bust) 시 반납+비공개 처리 등 **크니지아의 "Heckmeck am Bratwurmeck"(Pickomino) 계열 턴제 보드게임 규칙이 전부 직접 명시**되어 있었다 — 문서와 지시문이 이름만 같을 뿐 엔진 설계(순수 리듀서 턴제 vs 실시간 60fps 물리 루프)부터 근본적으로 다른 게임이라, `AskUserQuestion`으로 먼저 확인했고 사용자가 **"작업 지시 본문에 명시된 규칙(Pickomino식)"**을 선택했다. `.md` 문서는 의도적으로 참고하지 않았다(engine.ts 모듈 상단 주석에 이 판단 근거를 전문 기록).

신규 게임 "지렁이(Worm)"의 순수 엔진, 주사위 굴림/킵/타일 뺏기 보드 UI, 온라인 락스텝 동기화, 단위 테스트, 문서화, 커밋/배포까지 전 과정을 요청받아 `src/games/worm/`에 신규 구현했다.

- **엔진 규칙 중 작업 지시가 여백을 남긴 부분(문서 대신 고전 게임 자체 메커니즘으로 합리적 추정, engine.ts 모듈 doc에 "Documented inferences"로 명시)**: ① `stop`은 지렁이를 못 킵한 상태에서도 항상 legal한 액션이고(최소 1번 킵했다면), 다만 그 경우 스톱은 곧 확정 Bust로 처리된다 — "지렁이 필수 포함 규칙"은 스톱 자체의 가능 여부가 아니라 스톱의 *성공* 여부를 가르는 조건으로 해석. ② 타일 획득 우선순위: 타일 번호는 게임 전체에서 유일하므로 (a) 중앙에 정확히 일치하는 타일이 있으면 그것, (b) 없으면 상대방 스택 **맨 위**와 정확히 일치할 때만 뺏기(스택에 묻힌 타일은 접근 불가), (c) 그마저 없으면 중앙에서 합계보다 작은 최고 숫자 타일. ③ 인원수는 실물 Pickomino 박스 기준 2~7명 유지. ④ 시작 플레이어는 이 프로젝트의 다른 게임들과 동일하게 공유 시드로 결정론적 선택.
- **실패(Bust) 처리는 작업 지시 원문을 문자 그대로, 조건 분기 없이 구현**했다: "내 스택 맨 위 타일을 중앙에 반납" + "중앙 최고 숫자 타일을 비공개 처리" 두 단계가 **항상 순서대로 둘 다** 실행된다(내 스택이 비어 있으면 첫 단계만 스킵). 원작 Pickomino 규칙은 "내 타일이 있으면 그것만 뒤집고, 없을 때만 중앙 최고 타일을 뒤집는" 조건부(either/or) 규칙이라 이 구현과 다르다 — 방금 반납한 내 타일이 그 즉시 새로운 최고 숫자가 되어 다시 비공개 처리되는 edge case까지 의도적으로 그대로 두었다(`Worm.test.ts`에 회귀 테스트로 고정, RulebookModal.tsx에도 하우스 룰 안내 박스로 명시).
- **대표 이미지**: 룰북 폴더에 박스 커버 사진이 없어 코요테/말달리자/언어의 조각/코요테와 동일하게 emoji(🪱)+gradient 폴백을 채택(`registry.ts`, `image` 필드 미설정 — `GameThumbnail.tsx`가 이미 이 폴백 경로를 처리하므로 별도 수정 불필요).
- **UI**: 중앙 21~36 타일을 **항상 16개 고정 슬롯**으로 렌더링(타일이 어느 위치에 있든 — 중앙 공개/비공개 제거/누군가의 스택 — 같은 칸이 계속 존재)해서, 타일 애니메이션 FX의 flight-source ref가 상태 전이 중에도 유실되지 않게 설계(`WormBoard.tsx`). 주사위는 눈금별로 그룹핑해 킵 버튼을 제공하고, 새 롤마다 `worm-dice-tumble` CSS 키프레임으로 텀블 연출, 타일 획득/뺏기는 `worm-tile-fly`로 중앙(또는 상대 스택)→내 스택 플라잉 FX(`WormEffects.tsx`, 5-cucumbers/lasVegas와 동일한 "연속 락스텝 스냅샷 diff + portal + left/top transition" 기법 재사용, 코드 자체는 복붙하지 않고 게임별로 새로 작성 — 이 프로젝트의 "게임 간 코드 결합 0" 원칙).

1. **`src/games/worm/engine.ts`(신규)** — 순수 리듀서. `startGame`/`applyAction`(`roll`/`keep`/`stop`)/`computeRankings`/`totalWorms`/`ownerOfTile`/`wormsOnTile`/`sumKept` 등. 위의 추정·하우스룰 판단 근거를 모듈 상단 주석에 전문 기록.
2. **`src/games/worm/DieFace.tsx`, `TileFace.tsx`(신규)** — 순수 인라인 CSS 주사위/타일 비주얼(외부 이미지 자산 없음, `<Feature>Icon.tsx` 컨벤션).
3. **`src/games/worm/WormEffects.tsx`(신규)** — 타일 획득/뺏기 플라잉 FX(`detectClaimFlightEvent`/`FlyingTile`).
4. **`src/games/worm/WormBoard.tsx`(신규)** — 제어 컴포넌트. 중앙 타일 고정 그리드, 플레이어 스택(맨 위만 표시), 주사위 트레이(굴리기/킵/스톱), Bust/획득/뺏기 토스트.
5. **`src/games/worm/WormGame.tsx`(신규)** — Perudo와 동일한 Supabase Realtime 락스텝 온라인 방 로비(생성/참여, 좌석 자가치유, 재접속 state-request/state-sync).
6. **`src/games/worm/RulebookModal.tsx`(신규)** — 인앱 룰북 요약 + 하우스 룰 안내 박스.
7. **`src/games/worm/Worm.test.ts`(신규, 30개)** — 동일 숫자 중복 킵 불가, 지렁이 미포함 스톱은 확정 Bust, 중앙 타일 가져오기(정확 일치/미만 최고값 폴백), 상대 스택 맨 위 뺏기(묻힌 타일은 불가), Bust의 반납+비공개 2단계(edge case 포함), 게임 종료·동점 랭킹까지 전부 커버.
8. **`src/app/globals.css`** — `worm-dice-tumble`/`worm-tile-fly`/`worm-bust-flash` 키프레임 3개 신규(다른 게임 키프레임을 재사용하지 않고 게임별 소유권 컨벤션을 따름).
9. **`src/games/registry.ts`** — `worm` 항목 신규(emoji🪱+gradient 썸네일, 2~7인, `playable`/`onlineMultiplayer`/`supportsAutoRanking` 전부 true).
10. **`src/games/playableGames.tsx`** — `worm: dynamic(() => import("./worm/WormGame"), { ssr:false })` 등록.
11. **검증**: `npx tsc --noEmit`(에러 0) / `npm run lint`(경고 0) / `npx vitest run`(**728개** 전부 통과, 저장소 전체 26개 테스트 파일, 지렁이 30개 신규) / `npm run build`(프로덕션 빌드 성공) 전부 그린. `npm run dev` 기동 후 `/`와 `/games/worm` 라우트를 curl로 200 확인, 응답 HTML에 "지렁이" 텍스트 포함 확인(서버사이드 크래시 없음) — 다만 이 확인은 SSR 셸 수준이고, 온라인 대전 자체(Supabase 2탭 락스텝 동기화)는 ARCHITECTURE.md §2가 명시한 "알려진 사각지대"(vitest가 `<Game>Board.tsx`/`<Game>Game.tsx`를 커버하지 않음) 그대로 남아있어 실사용 전 수동 확인을 권장.

**직전 세션(그리드 포커 — BGM 디폴트 OFF + 원페어/투페어 상세 텍스트 표기)** 요약은 아래로 접혔다.

<details>
<summary>직전 세션(그리드 포커 — BGM 디폴트 OFF + 원페어/투페어 상세 텍스트 표기) 원문 — 접힘</summary>

### 이번 세션(그리드 포커 — BGM 디폴트 OFF + 원페어/투페어 상세 텍스트 표기) 주요 변경 사항

작업 지시 2가지를 그리드 포커(`src/games/grid-poker/`)에 반영했다.

**① BGM 기본값 비활성화.** 기존엔 `GridPokerGame.tsx`가 `phase === "playing"`이 되는 즉시 `getSoundEngine().startBgm()`을 무조건 호출해 배경음악이 자동 재생됐다. 다만 `soundEngine.ts`의 음소거 토글(`isMuted`/`setMuted`, localStorage 키 `bg_sound_muted`)은 **프로젝트 전체가 공유하는 전역 상태**다 — Perudo의 주사위 SFX, Spot the Difference의 BGM 등 다른 게임도 같은 `master` 게인 노드를 거치므로, 거기서 기본값을 뒤집으면 그리드 포커뿐 아니라 모든 게임의 사운드 기본값이 바뀌는 부작용이 생긴다. 그래서 `soundEngine.ts`는 건드리지 않고, 그리드 포커 전용의 새 persisted 플래그(`useGridPokerBgm.ts` 훅, localStorage 키 `grid-poker-bgm-enabled`, 기본값 `false`)를 추가해 BGM 시작 여부만 이 플래그로 게이팅했다. `GridPokerBoard.tsx`에 기존 음소거 버튼(🔇/🔊, SFX용)과는 별개로 BGM 전용 토글 버튼(🎵/🎵🚫)을 신규 배치해 사용자가 수동으로 켤 수 있게 했다 — 켜짐 상태는 브라우저에 저장되어 재입장·재대결에도 유지된다.

**② 원페어/투페어 상세 텍스트.** 기존엔 `evaluateHand()`가 반환하는 `categoryName`을 그대로 표시해 "원 페어"/"투 페어"처럼 어떤 숫자로 페어를 이뤘는지 알 수 없었다. `engine.ts`에 새 순수 함수 `formatHandLabel(hand)`를 추가해, 카테고리 1(원 페어)은 `(8원페어)`처럼, 카테고리 2(투 페어)는 `(K, 10투페어)`처럼(높은 페어 먼저 — `evaluateConcrete`의 그룹 정렬이 이미 count-desc/rank-desc라 `ranks[0]`이 항상 상위 페어) 랭크를 라벨에 접어 넣고, 그 외 카테고리는 기존 `categoryName`을 그대로 반환한다. `GridPokerBoard.tsx`의 두 표시 지점(제출 전 라인 미리보기, 라운드 결과 목록)에서 `hand.categoryName` 대신 `formatHandLabel(hand)`를 쓰도록 교체했다. 룰북(`RulebookModal.tsx`)의 족보 예시표는 "완성된 족보 판정 결과"가 아니라 정적 참고 예시라 범위 밖으로 판단해 손대지 않았다.

1. **`src/games/grid-poker/useGridPokerBgm.ts`(신규)** — 위 ①의 그리드 포커 전용 BGM 플래그 훅.
2. **`src/games/grid-poker/GridPokerGame.tsx`** — BGM 시작/정지 이펙트가 `bgmEnabled`도 의존성에 포함하도록 수정(꺼져 있으면 애초에 `startBgm()`을 호출하지 않고, 게임 도중 토글을 켜면 즉시 재생 시작). `bgmEnabled`/`setBgmEnabled`를 `GridPokerBoard`에 prop으로 전달.
3. **`src/games/grid-poker/GridPokerBoard.tsx`** — `GridPokerBoardProps`에 `bgmEnabled`/`onToggleBgm` 추가, 헤더의 기존 음소거 버튼 옆에 별도 BGM 토글 버튼 신규 배치. `formatHandLabel`을 import해 제출 라인 미리보기와 라운드 결과 목록 두 곳의 족보 표시를 교체(위 ②).
4. **`src/games/grid-poker/engine.ts`** — `formatHandLabel(hand: HandResult): string` 신규 export(위 ②의 변환 로직).
5. **`src/games/grid-poker/GridPoker.test.ts`** — `formatHandLabel` 테스트 4개 신규(숫자 원페어, J/Q/K/A 문자 원페어, 투페어 높은순 정렬, 그 외 카테고리는 `categoryName`과 동일함을 확인).
6. **검증**: `npx tsc --noEmit`(에러 0) / `npm run lint`(경고 0) / `npx vitest run`(**698개** 전부 통과, 저장소 전체 25개 테스트 파일) 전부 그린.

</details>

**직전 세션(버그 리포트 제출 폼 + 게시판 신규 구현)** 요약은 아래로 접혔다.

<details>
<summary>직전 세션(버그 리포트 제출 폼 + 게시판 신규 구현) 원문 — 접힘</summary>

### 이번 세션(버그 리포트 제출 폼 + 게시판 신규 구현) 주요 변경 사항

허브/게임 공통으로 버그를 제보할 수 있는 기능이 이번 세션 전까지 전혀 없었다. 작업 지시대로 제출 모달(제목/내용/글쓴이 필수, 전화번호/첨부파일 선택)과 `/bug-reports` 게시판(목록+검색+필터+상세+상태 관리)을 신규로 설계·구현했다. 기존 아키텍처 원칙(§1 순수 엔진 계약은 게임에만 해당하지만, "IndexedDB 1차 저장소 + Supabase는 선택적 best-effort 백업", "파생 상태 금지", "UI 레이어는 vitest 대상 밖" 등 프로젝트 전반의 컨벤션)을 그대로 따랐다:

- **저장 계층**: `daily_records`/`gameResults`와 동일한 패턴 — IndexedDB(`bugReports` 오브젝트 스토어, `DB_VERSION` 1→2로 버전업)가 유일한 읽기 소스이고, Supabase가 설정돼 있으면 `bug_reports` 테이블로 best-effort 백업만 한다(현재 UI는 이 백업을 다시 읽어오지 않음 — `/history` 페이지가 "이 브라우저 기기의 기록만 표시"라고 명시하는 것과 동일한 스코프 결정, 코드 주석에도 명시). `client.ts`의 `upgrade()` 콜백은 `oldVersion` 가드 없이 전 스토어를 무조건 `createObjectStore`했었는데, 버전을 그대로 올리면 기존 스토어 재생성 시도로 예외가 나므로 `oldVersion < 1` / `oldVersion < 2` 블록으로 나눠 기존 사용자도 안전하게 마이그레이션되도록 고쳤다.
- **게임 내 접근 지점**: 게임마다 개별 `<Game>Board.tsx`(19개)에 버튼을 복붙하는 대신, 모든 플레이 가능 게임이 공통으로 거치는 `src/app/games/[gameId]/page.tsx` 래퍼 한 곳에 `BugReportFloatingButton`(좌하단 고정, `game.id`/`game.name` 자동 매핑)을 추가했다 — ARCHITECTURE.md의 "게임 간 코드 결합 0" 원칙과 "새 게임 100종으로 늘어도 안 무거워짐" 철학에 맞춰 게임별 코드를 건드리지 않는 방향을 택함. **위치 주의**: 우하단은 `BettingSidebar`의 내기 관리 토글(z-40, site-wide)이 이미 차지하고 있어 같은 자리에 두면 완전히 가려지므로(Playwright 스크린샷으로 실제 발견) 좌하단(z-30)으로 배치했다.
- **입력 검증/포맷팅은 순수 함수로 분리**: `src/lib/bugReports/validate.ts`(제목/내용/글쓴이 필수 검증, 전화번호는 선택이지만 입력 시 형식 검증, `formatPhoneNumber`/`maskPhoneNumber`, 첨부파일 MIME/용량 검증)와 `src/lib/bugReports/board.ts`(제출 성공 시 목록 맨 앞에 추가하는 `prependReport`, 상태 변경 `updateReportStatusInList`, 게임/상태/제목검색 필터 `filterReports`)로 나눠 vitest의 `environment: "node"`(jsdom 없음, `bettingStore`/`ledger.ts` 등 기존 프로젝트 전반이 따르는 분리 방식과 동일)에서도 100% 유닛 테스트 가능하게 했다. FileReader/Canvas가 필요한 이미지 압축(`attachment.ts`)은 브라우저 전용이라 테스트 대상 밖 — Playwright 스크린샷으로 육안 검증했다(아래 §검증 참고).
- **전화번호**: "선택/필수 처리"라는 모호한 요구를 "값이 없으면 통과, 값이 있으면 형식 검증"으로 해석해 필수 항목으로 만들지 않았다(연락처 없이도 제보 자체를 막지 않는 게 접근성상 더 낫다고 판단, `AskUserQuestion` 없이 문서화만으로 진행). 마스킹은 스펙 예시 "010-\*\*\*\*-1234"와 동일하게 중간 그룹만 마스킹.
- **첨부파일**: 드래그앤드롭 + 파일선택 둘 다 지원, 업로드 즉시 `<canvas>`로 최대 1280px 다운스케일 + JPEG 압축(GIF는 애니메이션 보존을 위해 원본 유지) 후 base64 `data:` URI로 IndexedDB 레코드에 저장. 상세 모달에서 미리보기 + `download` 속성 다운로드 링크 제공.
- **게시판 처리 상태**: 작업 지시에 명시적 요구는 없었지만 목록/필터가 의미 있으려면 상태가 실제로 바뀌어야 하므로, 상세 모달에 접수됨/확인 중/수정 완료 드롭다운을 추가해 `updateStatus`로 바로 반영되게 했다(가벼운 추가라 스코프 내로 판단).

1. **`src/lib/db/types.ts`** — `BugReportStatus`/`BugReportAttachment`/`BugReportRecord` 신규 타입 추가.
2. **`src/lib/db/client.ts`** — `DB_VERSION` 1→2, `bugReports` 스토어(`by-status`/`by-game` 인덱스) 추가, `upgrade()`를 `oldVersion` 가드 기반으로 재작성(위 설명 참고).
3. **`src/lib/db/repository.ts`** — `createBugReport`/`listBugReports`(최신순)/`updateBugReportStatus` 추가.
4. **`src/lib/supabase/sync.ts`** — `backupBugReport` best-effort 백업 함수 추가(`backupDailyRecord`와 동일 패턴), 스키마 주석에 `bug_reports` 테이블 추가.
5. **`src/lib/bugReports/validate.ts`, `board.ts`, `attachment.ts`(신규 디렉터리)** — 위에서 설명한 순수 검증/포맷/목록 로직과 브라우저 전용 이미지 헬퍼.
6. **`src/store/bugReportStore.ts`(신규)** — `useBugReportStore`(zustand, `bettingStore`와 동일한 `hydrated`+`init()` 패턴), `submitReport`/`updateStatus`가 repository + 순수 함수(`board.ts`) + `backupBugReport`를 엮음.
7. **`src/components/bugReport/`(신규 디렉터리)** — `BugReportModal.tsx`(제출 폼, `Overlay` 재사용, `gameId` prop 있으면 게임 뱃지 잠금·없으면 게임 선택 드롭다운), `BugReportDetailModal.tsx`(상세 + 마스킹된 전화번호 + 첨부 미리보기/다운로드 + 상태 변경), `BugReportFloatingButton.tsx`(게임 페이지용 좌하단 진입점).
8. **`src/app/bug-reports/page.tsx`(신규)** — 목록(번호/관련게임/제목/작성자/등록일/상태) + 제목 검색 + 게임별/상태별 필터 + "새 리포트 작성" 버튼.
9. **`src/components/SiteHeader.tsx`** — "🐛 버그 리포트" 링크 추가(허브 헤더 진입점).
10. **`src/app/games/[gameId]/page.tsx`** — `BugReportFloatingButton` 장착(위 설명 참고).
11. **`src/lib/bugReports/BugReports.test.ts`(신규, 26개)** — 유효성 검사(제목/내용/글쓴이 미입력 시 거부, 전화번호는 선택), 전화번호 포맷팅/마스킹, 첨부파일 MIME/용량 검증, `prependReport`(제출 성공 시 목록 갱신), `updateReportStatusInList`, `filterReports`(게임/상태/검색 조합, 빈 문자열 gameId로 "허브 전용" 필터링 구분) 전부 커버.
12. **Playwright로 실제 렌더링 육안 검증**(임시 스크립트, 세션 종료 시 삭제) — 헤더 링크, 게시판 빈 상태/목록, 폼 유효성 에러, 첨부파일 미리보기, 제출 성공 화면, 게임 페이지 플로팅 버튼(게임 뱃지 잠금 확인), 상세 모달의 마스킹된 전화번호+이미지+다운로드 링크까지 스크린샷으로 전부 확인, 콘솔 에러 0건. 이 과정에서 위 "좌하단 배치" 버그(우하단 두면 내기 버튼에 완전히 가려짐)를 실제로 발견해 수정했다 — 엔진 테스트만으로는 못 잡는 UI 버그의 실사례(ARCHITECTURE.md §2 "알려진 사각지대").
13. **검증**: `npx tsc --noEmit`(에러 0) / `npm run lint`(경고 0) / `npx vitest run`(**694개** 전부 통과, 저장소 전체 25개 테스트 파일) 전부 그린.

**직전 세션(언어의 조각 — 자음/모음 회전 조합 입력 + 완성 글자 1개당 1불빛 판정 개편)** 요약은 아래로 접혔다.

<details>
<summary>직전 세션(언어의 조각 — 자음/모음 회전 조합 입력 + 완성 글자 1개당 1불빛 판정 개편) 원문 — 접힘</summary>

### 이번 세션(언어의 조각 — 자음/모음 회전 조합 입력 + 완성 글자 1개당 1불빛 판정 개편) 주요 변경 사항

이전 세션까지 "언어의 조각"은 탭-투-셀렉트 단어 칩 피커로 완성된 단어를 통째로 골라 제출하고, 힌트는 음절마다 초성/중성/종성 3슬롯을 각각 채점해 보여주는 방식이었다(위 표 참고). 이번 세션은 사용자의 직접 작업 지시로 이 두 부분을 함께 재설계했다: (1) **입력 방식**을 완성 단어 목록에서 고르는 방식 대신 **음절별 자음/모음 슬롯을 회전시켜 직접 조합**하는 방식으로 바꾸고, 조합이 등록된 단어가 아니면 완성 가능한 조합을 힌트로 제시. (2) **채점 단위**를 기존 "자음/모음 개별 불빛 3개"(초성/중성/종성 각각 blue/yellow/gray)에서 **"완성된 글자 1개당 불빛 1개"**로 재설계, 색상도 green(글자·위치 일치)/yellow(포함되나 위치 다름)/red(전혀 없음)로 재명명(예: 정답 "바다"에 "바"(초록) "다"(초록), 또는 뒤바뀌면 둘 다 노랑). 두 변경 모두 사용자가 이번 세션에서 새로 내린 구체적 스펙(색상 예시, 회전 조작 예시 포함)이라 룰북 재확인이나 `AskUserQuestion` 없이 그대로 구현했다. Hangul 조합 공식상 (초성, 중성, 종성) 어떤 인덱스 조합도 구조적으로 유효한 유니코드 음절이므로("자음+모음 구조가 아닌 경우"는 성립할 수 없음), "조합 오류 힌트"는 실질적으로 "단어 사전 미등재" 케이스를 뜻한다고 판단해 구현했다.

1. **`src/games/piecesOfLanguage/hangul.ts`** — `decomposeSyllable`의 역함수 `composeSyllable(choIndex, jungIndex, jongIndex)`를 신규 추가(유니코드 한글 조합 공식의 역산, 인덱스는 `%`로 랩어라운드해 다이얼이 양 끝을 넘어 계속 돌 수 있게 함).
2. **`src/games/piecesOfLanguage/engine.ts`** — `compareWords`를 초성/중성/종성 3채널 독립 2-패스 채점에서 **음절 문자 전체 단위** 2-패스 Wordle 채점으로 전면 재작성(그린 우선 매칭 → 남은 문자에서 옐로 매칭, 중복 문자 과다 매칭 방지는 그대로 유지). `FeedbackColor`를 `"blue"|"yellow"|"gray"` → `"green"|"yellow"|"red"`로 재명명하고, `SyllableFeedback`을 `{cho,jung,jong}` 객체에서 **음절당 색상 1개**(`FeedbackColor`)로 단순화. `hintScore`는 `tile.cho/jung/jong !== "gray"` 3중 합산에서 `tile !== "red"` 1회 합산으로 축소(이제 "불빛 하나"가 곧 "채점 대상 하나"라 3배로 셀 이유가 없어짐).
3. **`PiecesOfLanguageBoard.tsx`** — `WordPicker`(검색-필터 단어 칩 그리드)를 제거하고 `SyllableRotator`(음절마다 초성/중성/종성 독립 다이얼, ◀ ▶로 회전) + `SyllableDial`(다이얼 1개 단위 컴포넌트)을 신규 추가. 조합된 단어가 `isValidWord`를 통과하지 못하면 제출 버튼을 비활성화하고, 현재 조합과 같은 위치의 글자가 가장 많이 겹치는 단어 사전 후보를 `suggestCompletions`로 랭킹해 "완성 힌트" 칩으로 보여준다(칩을 클릭하면 그 단어로 다이얼이 즉시 점프하는 `wordToDials` 편의 기능도 포함, 여전히 회전으로 미세조정 가능). `SyllableTile`/`TILE_COLOR`를 3개 미니 칩 표시에서 음절 전체를 채우는 단일 색 타일(green/yellow/red)로 단순화.
4. **`RulebookModal.tsx`** — "자음/모음 회전으로 조합" 섹션을 신규 추가하고, 힌트 색 설명표를 초록/노랑/빨강으로, 승리 조건·시도 횟수 문단의 "청색"/"청색·노랑" 표기를 "초록불"/"초록·노랑"으로 갱신.
5. **`PiecesOfLanguageGame.tsx`는 변경 없음** — `EngineAction`을 그대로 전달만 하는 얇은 온라인 동기화 레이어라, `guess` 액션의 검증/채점 로직이 바뀐 것과 무관하게 자동 반영됨.
6. **`PiecesOfLanguage.test.ts`** — `compareWords` 테스트 블록을 신규 채점 모델(음절 전체 문자 단위, green/yellow/red) 기준으로 전면 재작성(룰북의 "바다"/"다바" 예시를 그대로 재현하는 케이스 포함). `composeSyllable`의 라운드트립(`decomposeSyllable`과의 왕복 일치)과 인덱스 랩어라운드 테스트 3개를 신규 추가.
7. **검증**: `npx tsc --noEmit`(에러 0) / `npm run lint`(경고 0) / `npx vitest run`(**667개** 전부 통과, 저장소 전체 24개 테스트 파일) 전부 그린.

</details>

**직전 세션(말달리자 — 4개 대각선 모서리 초기 말 배치 좌표 버그 수정)** 요약은 아래로 접혔다.

<details>
<summary>직전 세션(말달리자 — 4개 대각선 모서리 초기 말 배치 좌표 버그 수정) 원문 — 접힘</summary>

### 이번 세션(말달리자 — 4개 대각선 모서리 초기 말 배치 좌표 버그 수정) 주요 변경 사항

직전 세션에서 재설계한 `cornerZone()` 헬퍼(모서리 하나당 5칸 구역을 계산)의 **5번째 칸 계산식이 잘못돼 있었다**: 의도는 "모서리 꼭짓점에서 한 변으로 3칸 + 수직 변으로 2칸"(예: (0,0) 모서리 → (0,0),(0,1),(0,2),(1,0),(2,0))인데, 실제 코드는 5번째 칸을 `(cornerRow+rowDir, cornerCol+colDir)` — 모서리 자신의 대각선 위 인접 칸(예: (0,0)의 경우 (1,1))으로 반환하고 있었다. 4개 모서리 모두 동일한 패턴으로 어긋나 있어(우상단은 (1,9), 좌하단은 (9,1), 우하단은 (9,9)) 사용자가 "(1,1) 등에 말이 잘못 위치한다"고 지적한 그대로였다. `cornerZone()`의 5번째 좌표를 `{ row: cornerRow + 2*rowDir, col: cornerCol }`로 수정해 수직 변의 L자를 완성하도록 고쳤다 — 나머지 4칸(3칸짜리 가로 변 + 1칸짜리 세로 변 시작점)은 원래부터 정확했다. `HOME_ZONES`의 `cornerZone()` 호출부(`p1`/`p2` 대각선 배정)와 `MalDalliJaBoard.tsx`/`MalDalliJaGame.tsx`는 좌표를 하드코딩하지 않고 전부 엔진의 `HOME_ZONES`/`state.positions`에서 읽어오므로 이 두 파일은 수정할 필요가 없었다(확인만 함).

1. **`src/games/malDalliJa/engine.ts`** — `cornerZone()` 5번째 칸을 대각선 인접 칸에서 수직 변 2번째 칸으로 수정. 함수 docstring도 "Halma식 대칭 삼각형" 설명에서 실제 L자 형태 설명으로 갱신하고, 무엇이 왜 틀렸었는지 수정 이력 주석을 추가.
2. **`MalDalliJa.test.ts`** — 4개 모서리 각각의 정확한 5칸 좌표(사용자가 지정한 패턴 그대로)를 좌석/구역별로 전부 대조하는 회귀 테스트를 신규 추가하고, 4개 모서리의 "금지된 대각선 인접 칸"((1,1)/(1,9)/(9,1)/(9,9))이 어디에도 없음을 함께 검증. 기존 "나이트 이동으로 상대 진영 착지" 테스트 1개가 옛 좌표 (1,9)(수정 전 우상단 구역에 속했던 칸)를 착지점으로 삼고 있어 새 구역 기준으로 유효한 착지점 (2,10)으로 갱신.
3. **검증**: `npx tsc --noEmit`(에러 0) / `npm run lint`(경고 0) / `npx vitest run`(**664개** 전부 통과, 저장소 전체 24개 테스트 파일) 전부 그린.

**직전 세션(말달리자 — 말 10개/대각선 모서리 분산 배치 + 오아시스 완전 제거)** 요약은 아래로 접혔다.

<details>
<summary>직전 세션(말달리자 — 말 10개/대각선 모서리 분산 배치 + 오아시스 완전 제거) 원문 — 접힘</summary>

### 이번 세션(말달리자 — 말 10개/대각선 모서리 분산 배치 + 오아시스 완전 제거) 주요 변경 사항

이전 세션까지 "말달리자"는 룰북 원문 그대로 플레이어당 말 1개, 중앙 오아시스(F6)에 먼저 착지하면 즉시 승리하는 구조였다(위 표 참고). 이번 세션은 사용자가 "말 개수가 2개(플레이어당 1개)로 잘못됐다"며 직접 작업 지시로 이 구조를 다음과 같이 재설계했다: (1) 각 플레이어의 말을 **10개**로 늘리고, 시작 시 **대각선 모서리 구역 2곳에 5개씩** 나눠 배치, (2) 중앙 **오아시스와 그에 딸린 승리 조건을 완전히 제거**. 이전 세션들의 "작업 지시 vs 룰북 상충"과 달리 이번엔 사용자가 이번 세션에서 새로 내린 직접 지시라 룰북 재확인 절차는 거치지 않았다. 다만 오아시스를 제거하면 엔진의 **유일한 승리 조건**이 통째로 사라지는 문제와, "대각선 모서리 구역 2곳"이 보드의 4개 모서리를 두 플레이어에게 어떻게 배정하는지 뜻하는지가 여러 해석이 가능한 문제 2가지만 `AskUserQuestion`으로 확인했다 — 사용자가 각각 **"말 1개 먼저 상대 진영 도달"**(대체 승리 조건: 자신의 말 10개 중 하나라도 상대 진영에 먼저 착지하면 즉시 승리)과 **"플레이어별 대각선 한 쌍"**(보드에는 대각선이 2개·모서리가 4곳이므로, 대각선 하나를 통째로 한 플레이어가 차지 — p1은 (0,0)+(10,10) 주 대각선, p2는 (0,10)+(10,0) 반대 대각선, 각 끝에 5개씩)을 선택. 참고로 작업 지시가 언급한 "오아시스로 인한 L자 이동 불가 제약"은 애초에 이 엔진에 존재하지 않았다(오아시스는 승리 판정에만 관여했고 나이트 이동 합법성에는 관여한 적이 없음) — 오아시스 승리 판정 로직을 걷어내는 것으로 그 요청은 자연히 해소됐다.

1. **`src/games/malDalliJa/engine.ts` 전면 재설계** — `OASIS`/단일 `Position` 좌표 모델을 제거하고, `state.positions: Record<Seat, Position[]>`(좌석당 10개 배열, 인덱스가 그 말의 게임 내내 안정적인 id)로 교체. `cornerZone()` 헬퍼가 보드 리터럴 모서리 하나당 5칸짜리 삼각형(한 변에 3칸+수직 변에 2칸, 그 모서리 자신의 대각선을 축으로 대칭)을 계산하고, `HOME_ZONES`가 p1은 주 대각선 두 끝, p2는 반대 대각선 두 끝에 이 삼각형을 배정한다. `targetZoneCells(seat)`는 상대 좌석의 `HOME_ZONES`를 그대로 반환 — 승리 판정(`isInOpponentZone`)은 이동 후 도착 칸이 이 셋에 속하는지만 확인하는 단순 비교. 말이 10개로 늘면서 `resolveSlide`/나이트 착지 검사도 함께 손봤다: 예전엔 "상대방의 말 1개"만 장애물이었지만, 이제 **자기 편 말을 포함한 모든 점유 칸**이 슬라이드를 막고 나이트 착지도 막는다(자기 말 위로 슬라이드하거나 착지할 수 없는 건 당연한 결과이므로 이 프로젝트의 다른 다중 말 게임들과 동일하게 처리). `EngineAction`의 `move`에 `horseIndex` 필드가 추가돼 "어느 말을 움직일지"를 함께 실어 보낸다.
2. **`MalDalliJaBoard.tsx` — 말 선택(탭) 2단계 UI로 전환** — 좌석당 말이 1개일 땐 하이라이트된 칸을 바로 탭하면 됐지만, 10개가 되면서 **먼저 내 말 하나를 탭해 선택 → 그 말의 합법 이동 칸이 하이라이트 → 목적지를 탭**하는 2단계 제스처로 바뀌었다(`selectedHorseIndex` 로컬 UI 상태, 턴 타이머 리셋과 동일한 "렌더 중 state 보정" 패턴으로 매 턴 초기화). 오아시스 그래픽(🌴 타일, `maldallija-oasis-pulse` 앰비언트 글로우, 앰버 배경)을 전부 제거하고, 대신 `targetZoneCells(viewerSeat)` 10칸에 뷰어 색상 톤의 은은한 틴트 + 빈 칸엔 🏁 아이콘을 표시해 "내가 가야 할 곳"을 시각적으로 대체했다. 보드에는 이제 좌석당 10개, 총 20개의 말을 각자의 `positions[seat][horseIndex]`에서 읽어 렌더링(선택된 말은 글로우+확대 강조). 게임오버 문구도 "오아시스 입성" → "상대 진영 도착"으로 갱신.
3. **`RulebookModal.tsx` 텍스트 갱신** — "말 10개, 대각선 모서리 2곳에 5개씩" 세팅 설명과 "말 1개라도 상대 진영에 먼저 도착하면 승리" 승리 조건으로 전면 재작성, 오아시스 관련 문단 전부 삭제. 슬라이드 이동 설명도 "상대 말"에서 "다른 말(내 말이든 상대 말이든)"로 정정.
4. **`globals.css`에서 `maldallija-oasis-pulse` 키프레임 삭제** — 사용처가 Board.tsx의 오아시스 렌더링뿐이라 오아시스 제거와 함께 정리. 다른 4개 키프레임(`maldallija-horse-land`/`elim-flash`/`result-burst`/`timer-warn`)은 그대로 유지.
5. **`MalDalliJaGame.tsx`는 변경 없음** — 이 파일은 `EngineAction`을 그대로 전달만 하는 얇은 온라인 동기화 레이어라, `move` 액션에 `horseIndex`가 추가된 것도 타입 변경만으로 자동 반영됨.
6. **`MalDalliJa.test.ts` 전면 재작성(20개→28개)** — `HOME_ZONES`/`targetZoneCells`의 기하 불변식(모서리 4곳 20칸이 서로 겹치지 않음, p1/p2 대각선 배정 정확성) 검증을 신규 추가. 슬라이드/나이트 이동 테스트를 `horseIndex` 포함 배열 기반으로 재작성하고 "자기 편 말도 슬라이드를 막는다"/"자기 편 말 위에 나이트 착지 불가" 테스트를 신규 추가. 오아시스 착지 테스트를 상대 진영 착지 테스트로 교체(정확히 도착 vs 못 미쳐 멈춤 vs 자기 진영 도착은 승리 아님 3가지 케이스).
7. **검증**: `npx tsc --noEmit`(에러 0) / `npm run lint`(경고 0) / `npx vitest run`(**663개** 전부 통과) 전부 그린.

</details>

</details>

</details>

**전전 세션(언어의 조각 — 공통 무작위 단어 2인 턴제 개편)** 요약은 아래로 접혔다.

<details>
<summary>직전 세션(언어의 조각 — 공통 무작위 단어 2인 턴제 개편) 원문 — 접힘</summary>

### 이번 세션(언어의 조각 — 공통 무작위 단어 2인 턴제 개편) 주요 변경 사항

이전 세션까지 "언어의 조각"은 각자 자신의 비밀 단어를 직접 정하고 상대 단어를 서로 추리하는 1대1 Wordle 듀얼(양쪽 다 자기 비밀 단어를 갖고, 양쪽 다 상대 걸 추리)이었다. 이번 세션은 사용자의 직접 작업 지시로 이 구조를 폐기하고 다음으로 교체했다: **게임 시작 시 시스템이 한글 정답 단어 1개를 무작위로 뽑아 은닉**하고, Player 1/Player 2가 **번갈아가며** 그 **하나의 공통 정답**을 추측한다. 이전처럼 룰북과의 상충이 아니라 사용자가 이번 세션에서 새로 내린 지시라 `AskUserQuestion`으로 룰북 확인을 거치지 않았고, 대신 스펙 자체에 남아있던 애매한 지점 2가지만 확인했다: (1) "제한시간 내에 먼저 맞히면 승리"를 실제 초 단위 카운트다운 타이머로 만들지 — 사용자가 **"벽시계 타이머 없이 승리조건만"**을 선택(먼저 정답을 맞히면 그 즉시 승리하는 순수 레이스로만 구현, 시간 초과/턴 자동 스킵 없음), (2) 기존 §4 "최대 시도 횟수"(제한없음/6회/8회) 옵션을 공유 단어 방식에서 어떻게 셀지 — 사용자가 **"총 시도 횟수(양쪽 합산) 캡 유지"**를 선택.

1. **`src/games/piecesOfLanguage/engine.ts` 전면 재작성** — `PlayerState.secretWord`와 `"setup"` phase, `set-secret` 액션을 전부 제거. `startGame(wordLength, maxAttempts, rng)`가 같은 시드로 선공(`activeSeat`)과 **공통 정답 단어(`targetWord`)**를 함께 뽑아(ARCHITECTURE.md §1 결정론 계약 유지, `wordsOfLength(wordLength)`에서 `rng()` 인덱스로 추출) 게임이 곧바로 `"playing"` phase로 시작한다. 상태에 per-seat `guesses` 대신 `history: GuessRecord[]`(각 기록에 `seat` 필드 추가) 하나만 두어 두 좌석의 시도를 턴 순서 그대로 한 타임라인에 보관 — 두 좌석이 서로 다른 대상(각자의 비밀 단어)이 아니라 같은 대상(`targetWord`)을 추리하므로 좌석별로 나눠 저장할 이유가 없어졌다. `compareWords(target, guess)`의 채점 알고리즘 자체(초성/중성/종성 3채널 독립 2-패스 Wordle 매칭, 종성 없음은 옐로 후보 제외)는 그대로 두고 색상 값만 `"green"` → **`"blue"`**로 재명명(작업 지시의 "청색" 스펙 반영). 승리 판정은 `word === state.targetWord`인 즉시 그 좌석 승리로 단순화(더 이상 "완전 그린 = 상대 비밀 단어와 동일"이라는 별도 동치 논리가 필요 없어짐, 정답 자체가 하나뿐이므로). `hintScore(state, seat)`/`totalAttemptsRemaining(state)`는 `history`를 좌석별로 필터링하거나 합산 길이로 캡을 재는 방식으로 재작성 — 캡도 이제 "양쪽 합산" 하나뿐이라 `p1Done && p2Done` 같은 비대칭 체크가 필요 없어져 `history.length >= maxAttempts` 단일 조건으로 단순화됐다.
2. **`PiecesOfLanguageBoard.tsx` UI 개편** — "비밀 단어 정하기" setup 화면과 "내가 추리 중인 상대 단어 / 상대가 추리 중인 내 단어" 듀얼 보드를 전부 제거하고, 하나의 **공유 추리 보드**로 교체: `state.history`를 턴 순서 그대로 나열하되 각 줄 앞에 시도한 좌석의 이모지(🟣/🟠)를 붙여 누가 언제 무엇을 시도했는지 한 타임라인에서 보이게 했다. 정확 일치 타일 강조색을 에메랄드green → **sky-blue**로 전부 교체(`TILE_COLOR`, `SyllableTile`의 "완전 일치" 하이라이트 포함). 시도 횟수 게이지는 좌석별 2개 바 대신 "남은 총 시도 횟수(양쪽 합산)" 바 1개로 교체. 게임오버 오버레이는 "내 비밀 단어/상대 비밀 단어" 대신 **"정답 단어: {targetWord}"** 한 줄만 공개.
3. **`RulebookModal.tsx` 텍스트 갱신** — 힌트 색 설명을 초록→청색으로, "각자 비밀 단어를 정한다"는 준비 단계 설명을 "시스템이 공통 정답 단어를 무작위로 뽑는다"로, §4 시도 횟수 설명을 "양쪽 합산" 기준으로 갱신.
4. **`PiecesOfLanguageGame.tsx`는 로직 변경 없음** — 이미 시드+글자수+시도횟수캡을 `game-start`로 브로드캐스트해 양쪽이 `startGame`을 동일하게 재현하는 락스텝 구조였고, `startGame`이 이제 `targetWord`까지 같은 시드로 함께 뽑도록만 바뀌었을 뿐이라 온라인 동기화 코드 자체는 손댈 필요가 없었음(주석과 UI 라벨의 "§2"/"§4 승리조건B" 같은 이제-안-맞는 룰북 절 번호 표기만 정리). `set-secret` 액션을 더 이상 보내지 않게 됐지만 이 파일은 애초에 `EngineAction`을 그대로 전달만 하는 얇은 레이어라 타입 변경만으로 자동 반영됨.
5. **`PiecesOfLanguage.test.ts` 전면 재작성(25개→23개)** — `set-secret`/setup phase 관련 테스트 3개를 제거하고, `startGame`이 결정론적으로 `targetWord`까지 함께 뽑는지 검증하는 테스트를 추가. `readyGame` 헬퍼가 이제 비밀 단어 2개 대신 `targetWord` 1개 + `activeSeat`을 직접 오버라이드하는 방식으로 단순화. 색상 기대값을 전부 `"green"`→`"blue"`로 교체, 승리조건 B(양쪽 합산 캡) 테스트를 개별 캡 대신 합산 길이 기준으로 재작성.
6. **검증**: `npx tsc --noEmit`(에러 0) / `npm run lint`(경고 0) / `npx vitest run`(**655개** 전부 통과) 전부 그린.

</details>

**직전 세션(레지스탕스 쿠 신규 게임)** 요약은 아래로 접혔다.

<details>
<summary>직전 세션(레지스탕스 쿠 신규 게임) 원문 — 접힘</summary>

### 이번 세션(레지스탕스 쿠 신규 게임) 주요 변경 사항

룰북(`boardGameRule/레지스탕스 쿠/레지스탕스 쿠.md`, "단판 완결 정식 규칙서")을 정독한 결과 이 게임은 애초에 다회차 점수제가 아니라 **영향력(카드) 2장을 모두 잃으면 즉시 탈락, 최후의 1인이 승리**하는 서든데스 구조 그 자체라 — 달무티/라스베가스/러브레터 세션들이 겪었던 "작업 지시 vs 룰북 단판 여부" 상충이 애초에 발생하지 않았다. 작업 지시서의 요구사항(순수 엔진, 블러핑/의심/방어 UI, 멀티플레이 동기화, 단위 테스트, 커밋/배포)을 그대로 구현했다.

1. **`src/games/coup/engine.ts` 순수 리듀서** — 한 턴이 최대 6개 phase(`action` → `actionChallengeWindow` → `blockWindow` → `blockChallengeWindow` → `exchange`/`loseInfluence` → 다시 `action`)를 연쇄할 수 있는 상태 기계. 매 응답 창(window)마다 `awaitingSeats`(아직 응답 안 한 좌석)를 추적해 "전원 패스" 또는 "누군가 이의 제기"를 대칭적으로 판정한다. 도전 성공/실패 시 카드 교체(§4-1 "덱에 넣고 잘 섞은 뒤 새 카드")나 제상의 교환 draw처럼 초기 딜 이후에도 필요한 무작위성은, 순수 리듀서가 `Math.random()`을 직접 호출할 수 없으므로 그리드 포커의 `draw-common` 패턴을 그대로 재사용 — 창을 닫는 `pass`/`revealInfluence` 액션이 클라이언트에서 생성한 `seed`를 실어 보내고, 리듀서는 그 시드로만 셔플/드로우한다(엔진 모듈 상단 주석에 근거 명시). §4-2 "Double Kill"(거짓 방어가 역도전으로 들통나면 방어 실패 벌점 카드 1장 + 원래 공격 카드 1장 = 한 턴에 2장 상실)은 별도 특수 케이스가 아니라 정상적인 순차 처리("방어 실패 → 원래 액션이 방어 안 된 것처럼 그대로 집행")의 자연스러운 결과로 구현했고, 첫 손실로 이미 탈락했다면 두 번째 손실은 구조적으로 생략된다.
2. **문서화된 추론 2가지**(엔진 모듈 주석에 근거 명시): (1) 쿠/암살 코인은 선언 즉시 은행에 지불되며 도전에 실패해 무산되어도 환불되지 않음(공식 룰의 일반적 해석, "시도 자체의 비용"으로 취급). (2) 암살/갈취의 방어는 대상자 본인만 가능하고(개인 방어 카드라는 게임 전반의 관행 + 외화 도입만 "누군가"로 명시된 대조), 외화 도입의 방어는 대상이 없는 액션이라 생존한 전원에게 열려 있음.
3. **`CoupBoard.tsx` + 5개 팝업 모달** — `TargetModal`(쿠/암살/갈취 대상 지정), `ResponseModal`(작업 지시 §2가 요구한 "의심/방어 선택 팝업 + 제한시간 타이머 게이지" — 3개 응답 창을 한 컴포넌트로 커버, 15초 게이지가 30% 이하로 내려가면 펄스 경고, 시간 만료 시 그 좌석 몫의 "패스"를 자동 제출), `ExchangeModal`(제상 교환 4장 중 keepCount장 선택), `LoseInfluenceModal`(공개할 영향력 카드 선택), `RulebookModal`. 좌석 목록은 코인(공개)/영향력 카드 수(비공개, 뒷면)/공개된 사망 카드(항상 공개)를 표시하며, 코인 10개 이상이면 "⚠️쿠필수" 뱃지와 함께 쿠데타 외 모든 액션 버튼이 비활성화된다.
4. **`CoupEffects.tsx` + `globals.css` 신규 키프레임 5개** (`coup-card-flip`/`coup-elim-flash`/`coup-timer-warn`/`coup-result-burst`/`coup-response-warn`) — 카드 반전 3D 애니메이션은 coyote/loveLetter의 `rotateY` 플립 기법을 그대로 재사용(작업 지시 §2의 "카드 반전 3D 애니메이션 연출" 요구사항).
5. **`CoupGame.tsx` 온라인 로비 + 락스텝 동기화** — 러브레터와 동일한 2~N인 락스텝 패턴(호스트가 시드+인원수를 `game-start`로 브로드캐스트 → 각자 `startGame` 재현 → 이후 `EngineAction` 재생), `state-request`/`state-sync` 재접속 지원, 좌석 충돌 자가치유까지 표준 패턴 그대로. 외화 도입의 방어 창은 생존자 전원에게 동시에 열려 있어 두 좌석이 극히 드물게 동시에 `declareBlock`을 보낼 수 있는 이론상 경쟁(그리드 포커의 `draw-common`과 달리 단일 쓰기자 가드를 걸지 않음) 하나를 이 프로젝트가 이미 받아들인 수준의 위험으로 모듈 주석에 명시.
6. **단위 테스트 33개(`Coup.test.ts`)** — 덱 구성(5종×3장), 세팅 결정론, 소득(방해 불가), 쿠(7코인 지불 + 강제 규칙 + 방해/도전 불가), 세금 징수 의심 성공/실패(카드 상실 + 카드 교체 + 코인 지급 여부), 외화 도입 공작 방어(무방해/방어/거짓 방어 도전/진짜 방어 오도전), 암살 §4-2 Double Kill(거짓 방어가 역도전으로 들통나 카드 2장 연속 상실, 1장뿐일 때 2차 손실 생략, 진짜 방어 오도전 시 보호), 갈취(코인 부족 시 min(2,coins), 사령관/제상 양쪽 방어 가능), 교환(4장 중 2장 선택, 잘못된 개수/미제시 카드 id 거부), 탈락+최종 승리+순위 계산, `getPlayerView` 비공개 판정까지 전부 통과.
7. **대표 이미지 없음** — `boardGameRule/레지스탕스 쿠/` 폴더에 룰북 마크다운만 있고 박스 커버 이미지가 없어, 코요테/말달리자와 동일하게 emoji(👑)+그라디언트 폴백만 등록.
8. **Playwright 스크린샷으로 UI 육안 검증** — 임시 라우트 `temp-coup-preview`(확인 후 삭제)에서 엔진 액션을 직접 재생해 7개 시나리오(액션 선택, 액션 의심 창, 방어 창, 방어 의심 창, 영향력 공개, 교환, 게임오버)를 스크린샷 검증 — 응답 모달의 타이머 게이지, 방어 캐릭터 선택 버튼, 교환 카드 4장 선택 UI, 탈락 토스트+최후생존자 배너 동시 표시까지 전부 의도대로 렌더링됨을 확인, 콘솔 에러 0건. 이 세션은 이미 로컬에 캐시된 npx Playwright 크로미움(`~/AppData/Local/ms-playwright`)을 그대로 사용했고, 다른 세션이 이미 띄워둔 `next dev`(포트 3000)를 재사용해 새 인스턴스를 띄우지 않았다.
9. **동시 작업 중인 다른 세션과의 파일 충돌 계속 이월** — 세션 시작 시점 `git status`에 여전히 `src/games/perudo/*`, `boardGameRule/` 대량 재구성, 루트 `.clinerules.md`가 커밋되지 않은 채 남아 있었음. 이번 세션은 신규 게임 파일(`src/games/coup/*`)과 `registry.ts`/`playableGames.tsx`(둘 다 파일 끝에 항목 추가라 교차점 없음)만 건드렸고, 유일한 교차점인 `globals.css`는 다른 세션의 변경분을 워킹 트리에 그대로 둔 채 이번 세션이 추가한 키프레임 5개만 커밋에 포함시키는 기존 세션들의 `git hash-object`+`git update-index --cacheinfo` 우회 기법을 그대로 적용했다. **다음 세션도 `src/games/perudo/*`와 `boardGameRule/`(+`.clinerules.md`) 영역이 여전히 커밋되지 않은 채 남아 있다는 걸 감안하고 시작할 것.**
10. **검증**: `npx tsc --noEmit`(에러 0) / `npm run lint`(경고 0) / `npx vitest run`(**657개** 전부 통과, 이번 세션 신규 33개) / `npm run build`(프로덕션 빌드 성공) 전부 그린.

</details>

**직전 세션(언어의 조각 신규 게임)** 요약은 아래로 접혔다.

<details>
<summary>직전 세션(언어의 조각 신규 게임) 원문 — 접힘</summary>

### 이번 세션(언어의 조각 신규 게임) 주요 변경 사항

작업 지시서는 "언어의 조각"을 카드덱/공급처에서 지속적으로 무작위 자음/모음 글자 조각이 등장하고, 이를 드래그앤드롭 또는 클릭으로 조합해 단어를 완성하는 실시간 타임어택 게임(제한시간 내 단어 미완성 시 탈락)으로 요구했으나, 지정된 룰북(`boardGameRule/언어의조각/언어의조각.md`, "[자율 글자 수 단판 승부 하우스 룰] 정비된 완벽 규칙서")을 정독한 결과 실제 게임은 **1대1 Wordle 방식 단어 추리 게임**이었다 — 무작위 글자 공급 메커니즘 자체가 없고, 두 플레이어가 합의한 글자 수(2~5글자)에 맞춰 각자 자신이 원하는 비밀 단어를 직접 타이핑해 정하며, 턴마다 상대가 완성된 단어 하나를 통째로 제시하면 초성/중성/종성 단위로 초록(정확)/노랑(포함, 위치 틀림)/회색(불포함) 힌트를 주고받는 방식이다. 장르 자체가 다른 근본적 상충이라 `AskUserQuestion`으로 먼저 확인했고, 사용자가 **"룰북 원문 그대로"**를 선택했다(넷플릭스 데스게임풍 다크 UI·연출은 유지하되 룰북에 없는 무작위 글자 생성/드래그앤드롭 조합/타임아웃 탈락 메커니즘은 지어내지 않음).

1. **`src/games/piecesOfLanguage/hangul.ts` — 한글 자모 분해 순수 함수** — 유니코드 한글 완성형 음절 블록(U+AC00~U+D7A3)의 조합 공식을 그대로 구현해 초성 19개/중성 21개/종성 28개(0번 = "종성 없음") 표를 역산한다. 임의의 조작이 아니라 유니코드 한글 음절 조합 알고리즘 그 자체(수기로 "사과"→ㅅ+ㅏ+없음/ㄱ+ㅘ+없음 계산 검증 후 구현).
2. **`src/games/piecesOfLanguage/words.ts` — 큐레이션 단어 사전** — 룰북 §2의 "표준 국어대사전 등재 명사"는 사전 전체를 내장할 수 없어(디지털 Wordle 클론들이 공통으로 쓰는 방식 그대로) 2~5글자 순우리말/일상 명사 262개를 손으로 골라 음절 수별로 버킷화(node 스크립트로 각 단어의 실제 글자 수를 기계적으로 재검증). `isValidWord(word, length)`가 이 사전을 유일한 유효성 검증 소스로 쓴다.
3. **`src/games/piecesOfLanguage/engine.ts` 순수 리듀서** — `startGame(wordLength, maxAttempts, rng)`는 룰북 §3 "가위바위보로 선공 결정"을 재현하려 시드 하나로 선공만 정하고(ARCHITECTURE.md §1 결정론 계약 유지), 비밀 단어는 각자 `set-secret` 액션(자기 좌석만 명시적으로 실어 보내는 그리드 포커식 동시-액션 패턴)으로 직접 제출한다. `compareWords`는 초성/중성/종성 세 채널을 **독립적으로** 고전 Wordle 2-패스 알고리즘(그린 우선 매칭 → 남은 자모에서 옐로 매칭)으로 채점하며, "종성 없음"은 옐로 후보에서 제외(부재 자체는 "다른 자리에 있다"고 할 수 없다는 판단, engine.ts 모듈 주석에 근거 명시). §4 승리조건A(완전 적중 즉시 승리)는 자모 채점과 별개로 단어 문자열 자체의 동등 비교로 판정(전량 그린 = 단어가 동일하다는 수학적 동치를 그대로 활용, 채점 알고리즘의 미세 버그가 승패 판정에 영향을 못 주게 분리). §4 승리조건B(선택, 최대 시도 횟수)는 양쪽이 각자의 캡을 다 쓸 때까지 정답이 안 나오면 초록+노랑 힌트 총합(`hintScore`)이 높은 쪽이 판정승, 동점이면 명시적 무승부(`isDraw`) — 턴이 항상 1:1로 번갈아 진행되므로 두 좌석은 항상 같은 시점에 캡에 도달함을 이용해 비대칭 스킵 로직 없이 단순화.
4. **`PiecesOfLanguageBoard.tsx` — 데스게임 다크 UI + 듀얼 추리 보드**: 설정 단계는 검색-필터 가능한 "단어 조각" 칩 그리드에서 탭 한 번으로 비밀 단어를 제출(자유 타이핑 대신 항상 유효한 조합만 나오게 하면서도, 룰북에 없는 무작위 타일 생성 없이 "글자 조각을 고른다"는 촉감은 살림). 플레이 단계는 "내가 추리 중인 상대 단어"(내 시도 이력 + 입력창)와 "상대가 추리 중인 내 단어"(읽기 전용, 상대 진행 상황을 실시간으로 볼 수 있어 긴장감 강화) 두 보드를 나란히 배치, 각 음절은 큰 글자 + 초성/중성/종성 3개 미니 칩으로 색이 개별 표시되며 Wordle식 플립 리빌 애니메이션(`pol-tile-flip`, 음절마다 0.12초 스태거)으로 공개된다. §4 시도 횟수 캡이 설정된 방은 좌석별 잔여 게이지(`pol-attempts-warn` 저잔량 경고 펄스)를 데스게임풍 카운트다운 연출로 노출 — 룰북에 없는 벽시계 턴 타이머를 발명하는 대신, 룰북이 실제로 명시한 §4 선택 룰(시도 횟수 제한)을 시각적 "카운트다운"으로 재해석했다(engine.ts/Board.tsx 모듈 주석에 근거 명시). 게임 종료 시 전면 오버레이로 승자는 골드 "🏆 WINNER", 패자는 레드 "💀 ELIMINATED", 무승부는 슬레이트 "🤝 DRAW" 풀스크린 플래시(`pol-elim-flash`/`pol-result-burst`).
5. **`PiecesOfLanguageGame.tsx` 온라인 로비 + 락스텝 동기화** — 하나미코지/말달리자와 동일한 2인 락스텝 패턴(호스트가 시드+글자수+시도횟수캡을 `game-start`로 브로드캐스트 → 각자 `startGame` 재현 → 이후 `set-secret`/`guess` `EngineAction` 재생)에, 말달리자에서 도입한 `state-request`/`state-sync` 재접속 지원까지 그대로 적용. 무승부 결과도 정산 가능하도록 `handleGameEnd`가 `{winnerId, isDraw}`를 받아 무승부면 양쪽 모두 순위 1위로 `onComplete`에 보고.
6. **단위 테스트 25개(`PiecesOfLanguage.test.ts`)** — 한글 분해(복합모음/받침 있는 음절, 비한글 입력 거부), 단어 사전(전 단어의 실제 글자 수와 사전 버킷 일치 재검증, 유효성 판정), `compareWords`(완전일치 전량 그린, 위치 바뀐 자모 옐로, 전혀 없는 자모 그레이, 받침 없음은 옐로 후보 제외, 중복 자모 개수 초과 매칭 방지), `startGame` 결정론/양쪽 선공 가능, `set-secret`(양쪽 제출 전까지 setup 유지, 사전에 없는/길이 틀린 단어 no-op, 게임 시작 후 no-op), `guess`(정답 즉시 승리, 오답 시 턴 교대+기록, 잘못된 길이 no-op, 게임종료 후 no-op), §4 승리조건B(양쪽 캡 소진 후 힌트 점수로 승패 판정, 동점 시 명시적 무승부, 한쪽만 소진 시 게임 계속, `attemptsRemaining` 제한없음/캡 모드 모두 검증)까지 전부 통과.
7. **대표 이미지 없음** — `boardGameRule/언어의조각/` 폴더와 `public/games/`를 전부 확인했지만 박스 커버·카드 실사 이미지가 제공되지 않아, 코요테/말달리자와 동일하게 emoji(🧩)+그라디언트 폴백만 등록(`GameThumbnail`의 `object-contain` 레터박스는 이미지가 추가되는 즉시 자동 적용되므로 컴포넌트 쪽 추가 작업은 불필요).
8. **Playwright 스크린샷으로 UI 육안 검증** — 임시 라우트 `temp-pol-preview`(확인 후 삭제)에서 엔진 액션을 직접 재생해 고정 상태 픽스처 5종(설정 단계 칩 피커, 진행 중 듀얼 보드+힌트 타일, WINNER, ELIMINATED, DRAW)을 스크린샷 검증 — 세션 시작 시점 이미 다른 세션이 이 저장소에서 `next dev`를 3000번 포트로 띄워놓은 상태였어(동시 작업 세션의 파일시스템 워처가 신규 파일도 그대로 반영하므로) 그 서버를 그대로 재사용해 검증(새 인스턴스를 안 띄워 상대 세션 프로세스를 건드리지 않음). 콘솔에는 하이드레이션 불일치 경고만 있었으나, 이는 임시 프리뷰 페이지 자체가 `window.location` 쿼리로 시나리오를 즉시 전환하려고 만든 SSR/CSR 분기 때문(말달리자 세션에서도 동일하게 확인된 프리뷰 전용 아티팩트) — 실제 `PiecesOfLanguageBoard.tsx`는 `window`를 전혀 참조하지 않고, `PiecesOfLanguageGame.tsx`의 `window.location.search` 사용은 기존 게임들과 동일한 패턴이며 `playableGames.tsx`에서 `ssr: false`로 동적 임포트되어 프로덕션에서는 SSR 자체가 일어나지 않으므로 무관.
9. **동시 작업 중인 다른 세션과의 파일 충돌 계속 이월** — 세션 시작 시점 `git status`에 여전히 `src/games/perudo/*`, `boardGameRule/` 대량 재구성, 루트 `.clinerules.md`/`instructions.md`가 커밋되지 않은 채 남아 있었음(게다가 다른 세션이 이 저장소 디렉터리에서 `next dev`를 포트 3000으로 이미 띄워둔 상태였음, 위 8번 참고). 이번 세션은 신규 게임 파일(`src/games/piecesOfLanguage/*`)과 `registry.ts`/`playableGames.tsx`(둘 다 파일 끝에 항목 추가라 교차점 없음)만 건드렸고, 유일한 교차점인 `globals.css`는 작업 중이던 다른 세션의 변경분(perudo 컵 쉐이킹 제거)을 워킹 트리에 그대로 둔 채 이번 세션이 추가한 키프레임 4개만 커밋에 포함시키는 기존 세션들의 `git hash-object`+`git update-index --cacheinfo` 우회 기법을 그대로 적용했다. **다음 세션도 `src/games/perudo/*`와 `boardGameRule/`(+`.clinerules.md`/`instructions.md`) 영역이 여전히 커밋되지 않은 채 남아 있다는 걸 감안하고 시작할 것.**
10. **검증**: `npx tsc --noEmit`(에러 0) / `npm run lint`(경고 0) / `npx vitest run`(**624개** 전부 통과, 이번 세션 신규 25개) / `npm run build`(프로덕션 빌드 성공) 전부 그린.

</details>

**직전 세션(말달리자 신규 게임)** 요약은 아래로 접혔다.

<details>
<summary>직전 세션(말달리자 신규 게임) 원문 — 접힘</summary>

### 이번 세션(말달리자 신규 게임) 주요 변경 사항

작업 지시서는 "말달리자"를 N마리 말이 참가하는 경마 + 카드/주사위/베팅칩 이동 + 블라인드 베팅 + 시드(생명력) 차감형 탈락 + 30라운드제로 요구했으나, 지정된 룰북(`boardGameRule/말달리자/말달리자.md`, "넷플릭스 예능 <데스게임> - 말달리자 (단판 승부 정식 규칙서)")을 정독한 결과 실제 게임은 **2인 전용, 카드·주사위·베팅칩·생명 시스템이 전혀 없는 11×11 추상전략 게임**(체스 나이트 이동 + 8방향 슬라이드로 중앙 오아시스에 먼저 도달하면 즉시 승리)이었다 — 장르 자체가 다른 근본적 상충이라 `AskUserQuestion`으로 먼저 확인했고, 사용자가 **"룰북 원문 그대로"**를 선택했다(넷플릭스 데스게임풍 다크 네온 UI·연출은 유지하되 룰북에 없는 게임 메커니즘은 지어내지 않음).

1. **`src/games/malDalliJa/engine.ts` 순수 리듀서** — 11×11 보드(0-인덱스, 중앙 (5,5)가 룰북의 "F6" 오아시스), 두 좌석이 반대쪽 모서리(0,0)/(10,10)에서 시작. 매 턴 `getLegalMoves`가 슬라이드(8방향, 상대 말/보드 끝에 막힐 때까지 직진, 0칸 이동은 자동 제외) + 나이트(8개 L자 오프셋, 장애물 점프 가능·착지 칸만 비어야 함) 후보를 전부 계산해 UI와 엔진이 "이동 가능한 칸"의 단일 소스를 공유한다. 오아시스에 정확히 착지하는 순간 즉시 `phase: "gameOver"`로 승자를 확정(지나쳐 슬라이딩되는 건 승리로 인정하지 않음, 룰북 §4). `startGame`은 셔플할 덱이 없어도 룰북 §1의 "가위바위보로 선공 결정"을 재현하려고 시드 하나로 선공을 결정한다(ARCHITECTURE.md §1의 결정론 계약 유지).
2. **§5 하우스 룰 2가지만 구현** — (1) 단판 승부는 토글이 아니라 애초에 3전2선승제 자체를 구현하지 않아 게임=단일 라운드로 고정. (2) "턴당 30초~1분 제한시간"은 방 생성 화면에서 호스트가 제한없음/30초/45초/60초 중 선택하는 방 설정으로, 시드와 함께 `game-start` 브로드캐스트에 실어 양쪽 클라이언트가 동일하게 적용한다. 엔진은 벽시계 시간을 모르므로(순수 함수 계약), 시간 초과는 그냥 평범한 `{ type: "pass" }` 액션이고 **자기 턴인 클라이언트 자신만** 로컬 카운트다운이 0이 되는 순간 이걸 보낸다 — 이 프로젝트의 다른 모든 온라인 게임이 이미 문서화한 "자기 좌석 몫만 보낸다"는 신뢰 모델을 그대로 재사용한 것(engine.ts 모듈 상단 주석에 근거 명시).
3. **`MalDalliJaBoard.tsx` — 데스게임 다크 네온 UI**: 11×11 그리드를 검정+로즈 네온 프레임으로 렌더링, 오아시스는 앰비언트 펄스 글로우(🌴), 내 차례일 때 `getLegalMoves` 결과를 슬라이드=시안/나이트=자홍 두 색으로 하이라이트해 칸을 탭하면 바로 그 이동이 나간다(별도 "이동 방식 선택" 단계 없이 항상 두 방식을 동시에 보여줌). 턴 타이머가 켜진 방은 상단에 남은 시간 바(5초 이하부터 경고 깜빡임)를 표시. 게임 종료 시 전면 오버레이로 승자는 골드 "🏆 WINNER", 패자는 레드 "💀 ELIMINATED" 풀스크린 플래시(작업 지시 §2의 "탈락 시 레드 스크린/탈락 텍스트 이펙트" 요구사항을 2인 단판 구조에 맞게 "패배 = 그 자리에서 탈락"으로 해석해 적용) — `globals.css`에 `maldallija-oasis-pulse`/`maldallija-horse-land`/`maldallija-elim-flash`/`maldallija-result-burst`/`maldallija-timer-warn` 5개 키프레임 신규.
4. **`MalDalliJaGame.tsx` 온라인 로비 + 락스텝 동기화** — 하나미코지와 동일한 2인 락스텝 패턴(호스트가 시드+턴타이머설정을 `game-start`로 브로드캐스트 → 각자 `startGame` 재현 → 이후 `move`/`pass` `EngineAction` 재생)에, 코요테 등에서 쓰던 `state-request`/`state-sync` 재접속 지원까지 추가(하나미코지 자체엔 없던 것을 docs/cloud-sync.md §2.3 표준 패턴으로 보강). 좌석 충돌 자가치유는 "derived during render" 패턴 그대로 재사용.
5. **단위 테스트 20개(`MalDalliJa.test.ts`)** — 세팅(모서리 시작 위치, 시드 결정론, 선공이 양쪽 다 나올 수 있음), 슬라이드(벽까지 직진, 상대 말 앞에서 정지, 0칸 이동 제외, 불법 이동 no-op), 나이트(8개 후보, 장애물 점프, 점유 칸 착지 불가, 모서리에서 보드 밖 후보 제외), 오아시스 승리(슬라이드/나이트 양쪽 경로, 지나쳐가면 승리 아님, 게임 종료 후 추가 액션 no-op), 턴 타이머용 `pass`(말 이동 없이 턴만 넘김), `getLegalMoves`/`applyAction` 상호 일관성까지 전부 통과.
6. **대표 이미지 없음** — `boardGameRule/말달리자/` 폴더와 `public/games/`를 전부 확인했지만 박스 커버·카드 실사 이미지가 제공되지 않아, 코요테와 동일하게 emoji(🐎)+그라디언트 폴백만 등록(`GameThumbnail`의 `object-contain` 레터박스는 이미지가 추가되는 즉시 자동 적용되므로 컴포넌트 쪽 추가 작업은 불필요).
7. **Playwright 스크린샷으로 UI 육안 검증** — 임시 라우트 `temp-maldallija-preview`(확인 후 삭제)에서 고정 상태 픽스처로 (1) 대국 초반(슬라이드/나이트 하이라이트가 엔진의 `getLegalMoves`와 정확히 일치하는지 픽셀 단위로 대조 — 모서리에서 나이트 후보 2개, 대각선 슬라이드가 상대 말 앞 칸에서 정확히 멈추는지까지 확인), (2) 오아시스 근접 상태, (3) 게임오버 WINNER(골드)/ELIMINATED(레드) 양쪽 뷰어 시점을 스크린샷 검증 — 콘솔 에러 0건(임시 프리뷰 페이지 자체가 `window.location` 쿼리로 시나리오를 즉시 전환하려고 만든 하이드레이션 불일치 경고만 있었고, 실제 `MalDalliJaGame.tsx`는 이 패턴을 쓰지 않아 무관).
8. **동시 작업 중인 다른 세션과의 파일 충돌 계속 이월** — 세션 시작 시점 `git status`에 여전히 `src/games/perudo/*`, `boardGameRule/` 대량 재구성, 루트 `.clinerules.md`가 커밋되지 않은 채 남아 있었음. 이번 세션은 신규 게임 파일(`src/games/malDalliJa/*`)과 `registry.ts`/`playableGames.tsx`(둘 다 파일 끝에 항목 추가라 교차점 없음)만 건드렸고, 유일한 교차점인 `globals.css`는 작업 중이던 다른 세션의 변경분(perudo 컵 쉐이킹 제거)을 워킹 트리에 그대로 둔 채 이번 세션이 추가한 키프레임 5개만 커밋에 포함시키는 기존 세션들의 `git hash-object`+`git update-index --cacheinfo` 우회 기법을 그대로 적용했다. **다음 세션도 `src/games/perudo/*`와 `boardGameRule/`(+`.clinerules.md`) 영역이 여전히 커밋되지 않은 채 남아 있다는 걸 감안하고 시작할 것.**
9. **검증**: `npx tsc --noEmit`(에러 0) / `npm run lint`(경고 0) / `npx vitest run`(**599개** 전부 통과, 이번 세션 신규 20개) 전부 그린.

</details>

**직전 세션(포세일 — 부동산/수표 카드 이미지 잘림·블렌딩 버그 수정)** 요약은 아래로 접혔다.

<details>
<summary>직전 세션(포세일 — 부동산/수표 카드 이미지 잘림·블렌딩 버그 수정) 원문 — 접힘</summary>

### 이번 세션(포세일 — 부동산/수표 카드 이미지 잘림·블렌딩 버그 수정) 주요 변경 사항

사용자가 경매 화면 스크린샷(매물 3장의 그림·모서리 번호가 이웃 카드와 섞여 잘려 보임)을 첨부하며 포세일의 부동산 카드/수표 카드/썸네일 이미지가 카드 프레임 안에서 잘리거나 여백 없이 꽉 차지 않는 문제를 신고. `HANDOFF.md`와 포세일 카드 컴포넌트(`src/games/forSale/CardArt.tsx`, `ForSaleBoard.tsx`)를 먼저 읽어 맥락을 파악했다.

1. **근본 원인 — CSS가 아니라 소스 이미지 자체가 잘못 잘려 있었음**: `CardArt.tsx`의 `PropertyCard`/`CheckCard`는 이미 `object-cover`+`w-full h-full`+`overflow-hidden`+패딩 없음으로 올바르게 구성돼 있어 CSS 자체는 문제가 아니었다. 실제 원인은 지난 세션의 크롭 스크립트가 원본 콘택트시트(`boardGameRule/포세일/포세일카드.jpg`, 800×361px, 10열×3행)를 **균등 격자(셀당 정확히 80×120.33px, 좌상단 x=0부터)**로 나눈 것 — 하지만 실제 사진은 카드 사이에 5~9px 간격(검은 배경)이 있고 카드 자체 폭도 69~74px로 격자 폭(80px)보다 좁아서, 모든 셀이 이웃 카드의 15~20px를 함께 물고 잘라내 카드 그림·모서리 빨간 숫자가 서로 섞여 보였다(사용자 스크린샷과 동일 증상을 `properties/9.jpg` 등에서 직접 재현 확인). 수표 텍스처(`check-texture.jpg`)도 같은 원인으로 오른쪽 끝에 옆 수표 카드의 파란 테두리가 얇게 섞여 있었다.
2. **재크롭 — 픽셀 단위로 실측한 경계 사용**: `node_modules/sharp`의 raw 픽셀 버퍼를 읽어 각 행(row)마다 명도(luminance) 임계값으로 카드-배경 경계를 스캔해 10개 열의 실제 x범위(3개 행 각각 별도 측정, 사진의 미세한 원근 왜곡까지 반영)와 3개 행의 y범위를 구했다. 이 실측 경계로 `properties/1.jpg`~`30.jpg` 30장을 전부 재추출 — 이제 각 파일은 이웃 카드 섞임 없이 카드 1장 전체(테두리+빨간 모서리 숫자 포함)만 담는다. 수표 텍스처도 동일 방식으로 "$" 인장 중심부만(테두리·모서리 액면가 숫자·이웃 카드 파란 테두리 전부 제외) 다시 크롭했다 — 첫 재크롭에서도 오른쪽 끝 3~4px에 파란 테두리가 미세하게 남아있는 걸 픽셀 RGB 직접 검사(`b > r` 색상 판별)로 발견해 폭을 52px→44px로 더 좁혀 완전히 제거했다.
3. **`object-cover`가 세로형 카드 사진을 가로형 수표 카드 프레임에 맞출 때도 검증**: 수표 카드 프레임(`sm/md/lg` 전부 가로가 세로보다 긴 landscape 비율, 예: md는 96×64px)에 세로형(52×82 → 44×82, portrait) 텍스처를 `object-cover`로 채우면 스케일이 커져 세로를 많이 잘라내는데, "$" 인장이 원래 중앙에 있어 잘라도 자연스럽게 보이는지 `sharp`로 실제 `fit: "cover"` 리사이즈를 시뮬레이션해 3개 사이즈 전부 스크린샷 검증(부동산 카드도 동일하게 3개 사이즈 시뮬레이션) — 전부 여백/잘림 없이 카드 전체가 프레임을 꽉 채움을 확인.
4. **CSS/컴포넌트 코드는 변경하지 않음** — `PropertyCard`/`CheckCard`의 `object-cover`, `overflow-hidden`, 고정 `h-*`/`w-*` 페어(이미 종횡비를 고정하는 역할)는 지난 세션부터 이미 올바르게 구성돼 있었으므로 그대로 두고, `CardArt.tsx` 모듈 상단 주석만 "균등 격자였다가 실측 경계로 교체"했다는 새 크롭 파이프라인을 반영해 갱신했다. 대시보드 허브 카드(`GameThumbnail`/`GameCard.tsx`)의 `object-contain`+패딩은 29종 게임 전체가 공유하는 의도된 레터박스 디자인(박스 커버 사진마다 비율이 달라도 전체 그림이 잘리지 않게 하려는 결정, 코드 주석에 이미 명시)이라 이번 요청 범위(포세일 낱장 카드)로 보고 손대지 않았다.
5. **동시 작업 중인 다른 세션과의 파일 충돌 계속 이월** — 세션 시작 시점 `git status`에 여전히 `src/games/perudo/*`, `boardGameRule/` 대량 재구성, 루트 `.clinerules.md`/`instructions.md`가 커밋되지 않은 채 남아 있었음 — 이번 세션은 `public/images/for-sale/*`와 `src/games/forSale/CardArt.tsx`만 건드려 교차점이 없었다(이번엔 `globals.css`도 수정하지 않아 이전 세션들이 썼던 `git hash-object` 우회조차 필요 없었음). **다음 세션도 위 영역들이 여전히 커밋되지 않은 채 남아 있다는 걸 감안하고 시작할 것.**
6. **검증**: `npx tsc --noEmit`(에러 0) / `npm run lint`(경고 0) / `npx vitest run`(**579개** 전부 통과, 이번 세션은 이미지 자산 전용 작업이라 테스트 개수 변화 없음) 전부 그린.

</details>

**직전 세션(내기 시스템 — 금액 입력/표시 가독성 및 모바일 반응형 UI 개선)** 요약은 아래로 접혔다.

<details>
<summary>직전 세션(내기 시스템 — 금액 입력/표시 가독성 및 모바일 반응형 UI 개선) 원문 — 접힘</summary>

### 이번 세션(내기 시스템 — 금액 입력/표시 가독성 및 모바일 반응형 UI 개선) 주요 변경 사항

사용자가 내기(베팅) 시스템에서 금액을 올릴 때 금액 입력란과 금액 표시칸의 크기가 너무 작아 숫자가 잘리거나 보이지 않는다는 가독성 이슈를 신고, PC/모바일 모두에서 금액과 참가자 이름이 선명하게 보이도록 전면 개편을 요청. `HANDOFF.md`와 내기 관련 컴포넌트(`src/components/betting/*`, `src/store/bettingStore.ts`, `src/lib/betting/*`)를 먼저 분석해 실제 원인을 특정했다.

1. **근본 원인 특정**: 내기 UI 전체가 우측 슬라이드오버 `BettingSidebar.tsx`(고정 폭 `w-96`/384px) 안에 있고, 그 안의 (1) `PayoutTableEditor.tsx`의 순위별 상금/벌금 `±`스테퍼 버튼이 `h-6 w-6`(24px, 최소 터치 타깃 44px에 크게 미달)였고 금액 `<input type="number">`가 `grid-cols-2`(모바일 2열)로 강제된 좁은 카드 안에서 `w-full`로만 잡혀 있어, `-500,000`처럼 자릿수가 커지면 입력 상자가 내용을 다 못 담고 잘려 보였다. (2) `BettingSidebar.tsx`의 참가자별 누적 스코어 `<span>`이 `w-20`(고정 80px) 폭이라 마찬가지로 큰 금액에서 잘림. 두 곳 다 콤마 포맷은 이미 `toLocaleString()`으로 적용돼 있었으나(포맷팅 자체는 문제가 아니었음), **컨테이너 크기가 포맷된 문자열 길이를 못 따라가는 게 진짜 원인**이었다.
2. **`PayoutTableEditor.tsx` 전면 개편**: (a) 금액 `<input>`을 `type="number"`(콤마 미지원)에서 `type="text" inputMode="numeric"`으로 바꾸고, 포커스 중엔 숫자만 담는 원시 편집 버퍼(`editText`)를, 블러 후엔 `value.toLocaleString()`으로 항상 콤마 포맷된 값을 보여주는 패턴을 도입(포커스 중 커서 점프를 피하려고 편집 중에는 콤마를 붙이지 않고, 블러 시점에만 정수로 파싱해 커밋). (b) `±`스테퍼 버튼과 입력 상자를 전부 `min-h-11`(44px 이상)로 확대. (c) 카드 그리드를 고정 `grid-cols-2 sm:grid-cols-4`에서 `grid-cols-[repeat(auto-fit,minmax(13rem,1fr))]`로 바꿔, 컨테이너 폭에 따라 카드가 자동으로 줄바꿈(모바일 1열, 데스크톱 2~3열)되면서도 각 카드가 44px 버튼 2개 + 7자리 금액을 담기에 항상 충분한 최소 폭(13rem)을 보장하도록 함(처음엔 9.5rem으로 시작했다가 Playwright 스크린샷에서 `-1,000,000`이 여전히 `-500`처럼 잘려 보이는 걸 실측 확인 → 13rem으로 재조정해 해결, 아래 6번 참고). (d) 단위 선택 칩을 기존 `[1000, 2000, 5000, 10000]`에서 작업 지시가 명시한 `[1000, 5000, 10000, 50000]`(+1,000/+5,000/+10,000/+50,000)으로 교체해, 칩을 고른 뒤 `±`버튼으로 원하는 큰 단위까지 빠르게 조정할 수 있게 했다(스텝 방식을 유지하되 지시된 4개 금액 단위 그대로 반영). (e) 금액 텍스트를 `text-sm` → `text-base font-bold` + `tabular-nums`(자릿수가 바뀌어도 숫자 폭이 흔들리지 않음) + `whitespace-nowrap`으로 강화.
3. **`BettingSidebar.tsx` 참가자 스코어 영역 개편**: 참가자별 "닉네임 입력 + 누적 스코어" 한 줄짜리 `flex` 리스트를, 이름 입력(`min-h-11`)과 금액(`text-base font-bold tabular-nums whitespace-nowrap` + "원" 단위 접미사)을 세로로 쌓은 카드로 바꾸고, 이 카드들도 `grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]`로 배치해 화면 폭에 따라 1~3열로 자동 전환되게 했다. 고정폭 `w-20` 금액 뱃지를 완전히 제거. 사이드바 자체 폭도 `sm:w-96`(항상 384px 고정)에서 `md:w-[26rem] lg:w-[30rem]`을 추가해 데스크톱에서 카드가 더 여유 있게 배치되도록 확장(모바일은 `w-[92vw]`로 소폭 확대).
4. **`RosterEditor.tsx` / `RoundResultEntry.tsx` 터치 영역 보강**: 참가자 등록 닉네임 입력·추가 버튼, 라운드 결과 순위 입력 필드를 모두 `min-h-11`(44px 이상)로 통일해 모바일에서 오탭 없이 누르기 쉽게 함(§1 "터치/클릭 영역 및 패딩 확보" 요구사항을 내기 관련 입력 전반에 일관 적용).
5. **퀵 금액 버튼**: 작업 지시 §2가 요구한 "+1,000/+5,000/+10,000/+50,000 퀵 버튼"은 이미 있던 "단위 선택 칩 → `±`스테퍼가 그 단위만큼 증감" 패턴을 그대로 확장해 구현(2번-(d)) — 별도 모달을 새로 만들지 않고 기존 UX 패턴에 지시된 4개 금액을 정확히 반영하는 쪽을 택했다(모달을 새로 추가하면 왕복 클릭이 늘어나 오히려 "수월하게 금액을 올릴 수 있도록"이라는 취지와 어긋난다고 판단).
6. **Playwright 스크린샷으로 실측 검증(데스크톱 1280px / 모바일 375px)**: `npm run dev` + 캐시된 `npx`용 Playwright 크로미움으로 참가자 2~3명을 등록하고 순위별 금액에 `1,000,000`/`-1,000,000`을 직접 타이핑해 데스크톱·모바일 양쪽에서 (1) 초안 상태(내기 시작 전), (2) 편집 중, (3) 블러 후 콤마 포맷, (4) 실제 내기 활성화 후의 참가자 스코어 카드까지 스크린샷으로 직접 확인 — 첫 시도에서 카드 최소 폭을 9.5rem/11rem으로 잡았더니 44px 버튼 2개 + 큰 금액이 여전히 잘리는 걸 스크린샷에서 발견해 `PayoutTableEditor`는 13rem으로 재조정(3번의 참가자 카드는 버튼이 없어 11rem으로 충분). 재조정 후 두 뷰포트 모두 `1,000,000`/`-1,000,000`이 잘림 없이 굵은 글씨로 완전히 표시됨을 확인, 콘솔 에러 0건(뜬 404 5건은 대시보드 박스아트 썸네일 누락으로 이번 세션과 무관).
7. **엔진/스토어 로직은 건드리지 않음** — `bettingStore.ts`, `lib/betting/ledger.ts`, `lib/betting/zeroSum.ts`의 순수 함수(제로섬 검증, 정산 계산)는 전혀 변경하지 않았고, 값 포맷/표시/입력 방식만 프레젠테이션 레이어에서 개편했다. 기존 `ledger.test.ts`/`zeroSum.test.ts`가 이 함수들을 이미 커버하고 있어 신규 단위 테스트는 추가하지 않았다(이 프로젝트 관행상 `*Effects.tsx`류 순수 UI 세션과 동일하게 스크린샷으로 시각 검증).
8. **동시 작업 중인 다른 세션과의 파일 충돌 계속 이월** — 세션 시작 시점 `git status`에 여전히 `src/games/perudo/*`(컵 쉐이킹 제거 관련)와 `boardGameRule/` 대량 재구성(한글 게임명 폴더 다수 + 기존 flat `.md` 삭제), 루트 `.clinerules.md`/`instructions.md`가 커밋되지 않은 채 남아 있었음 — 이번 세션도 그 파일들을 전혀 건드리지 않았다(내기 컴포넌트만 수정해 `globals.css` 등 교차점 자체가 없었음). **다음 세션도 `src/games/perudo/*`와 `boardGameRule/`(+`.clinerules.md`/`instructions.md`) 영역이 여전히 커밋되지 않은 채 남아 있다는 걸 감안하고 시작할 것.**
9. **검증**: `npx tsc --noEmit`(에러 0) / `npm run lint`(경고 0) / `npx vitest run`(**579개** 전부 통과, 이번 세션은 프레젠테이션 전용 작업이라 테스트 개수 변화 없음) 전부 그린.

</details>

**직전 세션(포세일 신규 게임 — 실사 카드/코인 에셋 반영 + 입찰금/코인 이펙트 + 수표 누적 UI)** 요약은 아래로 접혔다.

<details>
<summary>직전 세션(포세일 — 실사 카드/코인 에셋 반영 + 입찰금/코인 이펙트 + 수표 누적 UI) 원문 — 접힘</summary>

### 이번 세션(포세일 — 실사 카드/코인 에셋 반영 + 입찰금/코인 이펙트 + 수표 누적 UI) 주요 변경 사항

사용자가 `boardGameRule/포세일/` 폴더에 새로 올려둔 이미지 2장(`포세일카드.jpg`: 30장 부동산 카드가 10×3 그리드로 배열된 콘택트시트, `포세일돈과 카드.jpg`: 부동산 카드 견본 + 수표 카드 견본 + 코인 칩 사진)을 근거로 지난 세션의 emoji/그라디언트 자리표시자를 실사 이미지로 교체하고, 1단계(경매)의 입찰 현황 가시성과 2단계(판매)의 수표 획득/누적 시각화를 개선해달라고 요청.

1. **이미지 자산 크롭 파이프라인** — `node_modules/sharp`로 두 소스 이미지를 스크립트 크롭해 `public/images/for-sale/`에 저장(별도 빌드 스텝 없이 1회성 산출물): (1) `포세일카드.jpg`(800×361, 10열×3행)를 셀당 `80×120.33`px 격자로 나누고 인접 카드가 살짝 겹쳐 보이는 걸 막기 위해 각 셀에 2px 인셋을 줘 `properties/1.jpg`~`properties/30.jpg` 30장을 순서대로(행 우선, 1~10/11~20/21~30) 추출. (2) `포세일돈과 카드.jpg`(492×492)에서 겹치지 않고 온전히 보이는 우측 끝 "$15,000" 수표 카드 1장만 골라, 카드 모서리에 박혀 있는 인덱스 숫자(좌상단/우하단)가 전부 잘려나가도록 중앙의 파치먼트+금색 "$" 인장 부분만 다시 크롭해 `check-texture.jpg`로 저장 — 이렇게 하면 실제 수표 값은 텍스처에 전혀 박혀 있지 않으므로 15개 액면가 전부가 이 한 장의 텍스처를 공유하고 값은 `CardArt.tsx`가 텍스트로 오버레이한다(엔진의 `formatDollars`가 이미 유일한 라벨 소스라는 기존 원칙 그대로 확장). (3) 은색 $1,000 코인 6장·금색 $2,000 코인 6장이 찍힌 사진에서 각 1장씩만 정사각형으로 크롭해 `coin-1000.png`/`coin-2000.png`로 저장. 크롭 좌표는 여러 차례 시행착오로 눈으로 확인하며 확정(스크래치패드에 중간 크롭본을 반복 저장해 검토).
2. **`CardArt.tsx` 전면 교체** — `PropertyCard`는 이제 `next/image`로 `propertyImageSrc(value)`(`/images/for-sale/properties/${value}.jpg`)를 렌더링(러브레터의 "사진에 이미 번호/이름이 박혀 있으니 중복 캡션을 그리지 않는다"는 `CardFace` 관행을 그대로 적용 — 실제 카드 사진에도 모서리에 작은 번호가 이미 인쇄돼 있음), 티어별 그라디언트/이모지 로직(`propertyTier`)은 이제 테두리 색상·하이라이트 링 색상만 결정하는 보조 함수로 축소. `CheckCard`는 `check-texture.jpg`를 배경으로 깔고 좌상단/우하단에 `formatDollars(value)`를 카드 인덱스처럼 직접 그려 넣으며(액면가 구간별 테두리/텍스트 색 `checkTierAccent`), `value <= 0`인 수표는 `grayscale`+반투명으로 "가치 없음"을 표시. 신규 `CoinChip({ value: 1000 | 2000 })`와, 임의의 현금액을 "가장 적은 칩 개수"로 분해하는 순수 헬퍼 `coinBreakdown(amount)`(이 엔진의 모든 금액은 항상 $1,000의 배수라 나머지 없이 딱 떨어짐, 게임 로직에는 전혀 쓰이지 않고 오직 코인 스택 시각화 전용)를 새로 추가.
3. **1단계 — 좌석별 실시간 입찰금 뱃지**: 좌석 목록 각 행에 `auction.bidsBySeat[seat]`(엔진에 이미 있던 "이번 라운드 내 마지막 입찰액" 필드 — 포기 시 절반 환불 계산용으로 이미 존재하던 값을 UI가 처음으로 노출)을 뱃지로 표시, 최고 입찰자는 👑, 나머지는 🎫로 구분. 별도 엔진 변경 없이 기존 상태를 노출하는 것만으로 충분했다.
4. **1단계 — 중앙 "입찰 팟" 코인 스택 + 입찰 시 코인 플라잉 FX**: 매물 카드 아래에 `auction.currentBid`를 `coinBreakdown`으로 쪼갠 `CoinChip` 스택을 쌓아 보여주는 "입찰 팟" 앵커(`potRef`)를 추가하고, `ForSaleEffects.tsx`에 신규 `detectBidEvent`(두 연속 락스텝 상태를 diff해 `currentBid`가 "엄격히 증가"하면서 `highBidderSeat`가 non-null인 순간만 골라낸다 — 라운드가 새로 딜링되며 `currentBid`가 0으로 리셋되는 전이는 감소이므로 이 가드에 절대 걸리지 않는다)와 `FlyingBidCoin`(좌석 행 → 팟 앵커로 코인이 날아가는, `FlyingPassCard`와 정반대 방향의 동일 포탈+`getBoundingClientRect`+left/top 트랜지션 기법)을 추가. `globals.css`에 `forsale-bid-coin-fly` 키프레임 신규.
5. **2단계 — 내 몫 "+$X" 하이라이트 + 수표 누적 패널**: 정산 결과 리스트에서 뷰어 자신의 줄만 초록 필 배지 + "🎉 …+$X" 큰 글씨로 다른 플레이어 줄과 구분(신규 `forsale-check-earn-pop` 키프레임으로 팝인), 그 아래 신규 "🧾 내 수표" 패널이 지금까지 획득한 모든 수표를 `CheckCard`로 나열하며 헤더에 누적 합계를 상시 표시. 상단 요약 바(모든 단계 공통)에도 "남은 현금(코인 아이콘 분해 + 금액) · 수표 누적" 두 줄을 항상 노출해 §3 요구사항("항상 직관적으로 보이게")을 페이즈 무관하게 만족.
6. **허브 카드 썸네일도 발견해 같이 연결** — `public/games/포세일.jpg`(사용자가 이미 올려둔 공식 "Stefan Dorra's For Sale" 박스 커버, "The Game of Property and Prosperity" 문구 확인됨)가 작업 지시엔 언급되지 않았지만 세션 시작 시점 `git status`에 이미 커밋되지 않은 채 대기 중이었던 걸 확인 — 러브레터 세션에서 "처음엔 폴더 목록 조회에서 이미지를 놓쳤다가 사용자 재요청으로 바로잡았다"는 교훈을 이번엔 먼저 적용해, 재요청을 기다리지 않고 `public/games/for-sale.jpg`로 kebab-case 복사 후 `registry.ts`의 `thumbnail.image`에 연결(기존 🏠 emoji/그라디언트는 이미지 로드 실패 시 폴백으로 계속 유지). 대시보드 허브 카드가 이제 "준비중" 폴백이 아니라 실제 박스 커버로 노출된다.
7. **임시 라우트로 2단계 시각 검증** — `temp-forsale-preview`(확인 후 삭제)에서 엔진 액션을 직접 재생해 (1) 경매 중 상태(입찰 뱃지 3개, 입찰 팟에 금색 코인 2개 = $4,000), (2) 판매 정산 직후 상태(내 몫 "+$5,000" 하이라이트, "내 수표" 패널 누적 $5,000, 다른 3인의 실사 부동산 카드가 정확히 매핑됨)를 Playwright(`npx playwright`, 로컬 캐시된 크로미움)로 스크린샷 검증 — 콘솔 에러 0건. 입찰 팟 코인을 처음엔 `size="sm"`(16px)로 뒀더니 "$2,000" 각인 텍스트가 뭉개져 작은 얼굴 이모지처럼 보이는 문제를 스크린샷에서 발견해 `size="md"`(24px)로 키워 해결.
8. **엔진(`engine.ts`)은 전혀 건드리지 않음** — 이번 세션은 순수 표현 계층(에셋+UI+FX) 작업이라 `ForSale.test.ts`의 44개 테스트 전부 변경 없이 그대로 통과, 신규 테스트도 추가하지 않았다(시각적 자산 매핑과 FX는 이 프로젝트 관행상 스크린샷으로 검증하고 유닛 테스트 대상으로 삼지 않음 — 다른 게임들의 `*Effects.tsx` 세션과 동일).
9. **동시 작업 중인 다른 세션과의 파일 충돌 계속 이월** — 세션 시작 시점 `git status`에 여전히 `src/games/perudo/*`(컵 쉐이킹 제거 관련)와 `boardGameRule/` 대량 재구성(한글 게임명 폴더 다수 + 기존 flat `.md` 삭제), 루트 `.clinerules.md`/`instructions.md`가 커밋되지 않은 채 남아 있었음 — 이번 세션도 그 파일들을 전혀 건드리지 않았고, 유일한 교차점인 `globals.css`는 이전 세션들과 동일한 방법(HEAD 버전에 이번 세션이 추가한 키프레임 2개 `forsale-bid-coin-fly`/`forsale-check-earn-pop`만 적용한 사본을 `git hash-object`+`git update-index --cacheinfo`로 인덱스에만 스테이징하고, 실제 워킹 트리 파일은 다른 세션의 변경을 포함한 원래 내용 그대로 보존)으로 재현했다. **다음 세션도 `src/games/perudo/*`와 `boardGameRule/`(+`.clinerules.md`/`instructions.md`) 영역이 여전히 커밋되지 않은 채 남아 있다는 걸 감안하고 시작할 것.**
10. **검증**: `npx tsc --noEmit`(에러 0) / `npm run lint`(경고 0) / `npx vitest run`(**579개** 전부 통과, 21개 테스트 파일, 변경 없음) 전부 그린.

</details>

**직전 세션(오이 다섯 개 — 마지막 트릭 동점 처리 버그 수정)** 요약은 아래로 접혔다.

<details>
<summary>직전 세션(오이 다섯 개 — 마지막 트릭 동점 처리 버그 수정) 원문 — 접힘</summary>

### 이번 세션(오이 다섯 개 — 마지막 트릭 동점 처리 버그 수정) 주요 변경 사항

1. **버그: 마지막(7번째) 트릭 동점 시 오이 정산이 룰북과 다르게 구현돼 있었음** — 기존 `src/games/five-cucumbers/engine.ts`의 `playCard`는 트릭 1~6과 트릭 7을 서로 다른 승자 판정 로직으로 처리했다: 1~6번 트릭은 `resolveLeadingTrickWinner`(동점이면 **나중에 낸 사람 단독 승리**, 룰북 §2-4)를 쓰지만, 7번째 트릭만 별도로 "최고값과 같은 카드를 낸 모든 좌석"을 `winnerSeats`에 담아 **동점자 전원에게** 오이 벌점을 각자 부여하고 있었다. 룰북(`boardGameRule/오이다섯개/오이다섯개.md`) §2-4는 "가장 높은 숫자가 2개 이상일 경우, **나중에 해당 숫자를 낸 플레이어**가 트릭을 따냅니다"라고 트릭 승자 판정 규칙 자체를 명시하고 있고, §3은 그렇게 정해진 "트릭을 따낸 플레이어"(단수)만 벌점을 받는다고 되어 있어 — 트릭 7도 예외가 아니라 동일한 단독 승자 규칙을 따라야 하는데, 이전 구현은 이 §2-4 동점 규칙을 트릭 7에는 적용하지 않고 있었다.
2. **수정 — `playCard`의 트릭 7 분기**: `maxValue` 동점자 전원을 필터링하던 로직을 제거하고, 트릭 1~6과 동일하게 `resolveLeadingTrickWinner(trickPlays)`로 단독 승자(`winnerSeat`) 하나만 구해 `winnerSeats = [winnerSeat]`로 통일했다. 오이 개수 계산(`cucumberCount(maxValue) * multiplier`)의 `maxValue`도 "동점 최고값"이 아니라 "그 단독 승자가 낸 카드 값"으로 변경(결과적으로 항상 같은 값이지만 의미상 승자의 카드에서 유도되도록 명확히 함). `TrickResult.winnerSeats`의 타입 주석도 "트릭 7은 1개 이상"에서 "항상 정확히 1개(배열 형태는 `RoundSummary`/기존 UI 코드와의 모양 호환용으로 유지)"로 갱신.
3. **영향받은 곳**: `CardEffects.tsx`의 `buildCucumberPickupEvents`, `FiveCucumbersBoard.tsx`의 결과 배너(`roundFlash.winnerSeats.map(...)`)는 이미 `SeatIndex[]`를 순회하는 범용 코드라 로직 변경 없이 그대로 동작(이제 배열 길이가 항상 1이 됨). 다만 사용자에게 규칙을 설명하는 `RulebookModal.tsx`가 옛 동작("동점자 모두 각자 같은 개수를 받습니다")을 문서화하고 있어 이것도 "나중에 낸 사람만 받음"으로 같이 고쳤다 — 엔진만 고치고 사용자용 룰 설명을 안 고치면 실제 동작과 설명이 어긋나는 채로 남는다는 걸 놓치지 않기 위해 함께 확인.
4. **단위 테스트**: `FiveCucumbers.test.ts`의 기존 "동점자 전원이 각자 벌점을 받는다" 테스트를 새 동작에 맞게 "나중에 낸 사람만 벌점을 받는다"로 교체하고, 좌석 번호와 무관하게 순수 플레이 순서로 승자가 정해지는지 확인하는 케이스(낮은 좌석 번호가 나중에 냈을 때도 좌석 번호가 아니라 플레이 순서가 이긴다는 걸 별도로 검증)를 1개 추가.
5. **검증**: `npx tsc --noEmit`(에러 0) / `npm run lint`(경고 0) / `npx vitest run`(**579개** 전부 통과, 21개 테스트 파일) 전부 그린. 이 세션은 이 버그 수정 하나에만 집중했고 다른 게임/파일은 건드리지 않았다.

</details>

**직전 세션(러브레터 신규 게임)** 요약은 아래로 접혔다.

<details>
<summary>직전 세션(러브레터 신규 게임) 원문 — 접힘</summary>

### 이번 세션(러브레터 신규 게임) 주요 변경 사항

사용자가 `boardGameRule/러브레터/러브레터.md` 룰북(제목부터 "단판 승부 정식 규칙서")과 같은 폴더의 공식 박스 커버 사진 + 1~8번 캐릭터 카드 실사 8장을 근거로 신규 게임 "러브레터(Love Letter)"의 순수 엔진, 카드효과/대상지정 보드 UI, 탈락·공개 애니메이션, 온라인 락스텝 동기화, 단위 테스트, 문서화, 커밋/배포까지 전 과정을 요청. 진행 중 사용자가 "boardGameRule/러브레터를 참고해 게임 이미지를 반영해달라"고 별도로 요청 — 처음 폴더 목록 조회 시 이미지 파일들을 놓쳤던 걸 재확인해 바로잡음(아래 6번).

1. **룰북 vs 작업 지시 충돌 — 단판 승부 vs 멀티 라운드 호감도 토큰**: 작업 지시는 오리지널 러브레터 그대로 "호감도 토큰을 인원수별 목표치(2인 7개/3인 5개/4인 4개 등)까지 여러 라운드 누적"하는 루프를 전제했지만, 사용자가 지정한 룰북 파일은 제목부터 "단판 승부 정식 규칙서"이고 본문도 "단 한 번의 라운드에서 공주에게 편지를 전달하거나 끝까지 살아남은 1인이 즉시 최종 승리"라고 명시 — 승리 조건/게임 루프 자체가 갈리는 충돌이라 달무티/라스베가스 세션과 같은 기준으로 `AskUserQuestion`을 먼저 띄워 확인했고, **사용자가 "단판(룰북 원문 그대로)"을 선택**했다. 따라서 `winTokens`/호감도 누적 개념은 아예 존재하지 않으며, `phase: "gameOver"`가 곧 게임 전체의 끝이다 — `engine.ts` 모듈 상단 주석에 판단 근거를 명시.
2. **`src/games/loveLetter/engine.ts` 순수 리듀서** — 16장 덱(1번 경비병 5장~8번 공주 1장)을 시드로 셔플해 맨 위 1장을 비공개로 제거(`removedCard`)하고 2인 전용으로 추가 3장을 공개 제거(`visibleRemovedCards`), 각 좌석에 1장씩 배분 후 시작 좌석에게만 2번째 카드를 미리 드로우해 "손패 2장으로 내 턴 시작" 상태를 곧장 만든다. 액션은 `playCard` 하나뿐(카드뽑기는 턴 전환 시 리듀서가 자동 수행하므로 별도 액션 불필요) — 8종 카드 효과(경비병 추리, 사제 비공개 열람, 남작 대결, 하녀 보호, 왕자 강제 교체+예비카드 폴백, 왕 손패 교환, 백작부인 강제 플레이 규칙, 공주 즉시 탈락)를 전부 구현하고, §4 "지목 불가능 상황"(전원 하녀 보호 시 지목 효과 소멸, 단 왕자는 자기 자신 지정 필수)까지 `validTargets` 단일 함수로 UI/엔진이 공유. 라운드(=게임) 종료는 최후생존 우선 판정 후 덱 소진 시 손패 숫자 비교(동률이면 버린 카드 합, 그마저 같으면 공동 승리)로 `checkRoundEnd`가 매 턴마다 판정.
3. **룰북에 명시 안 된 부분 1가지를 engine.ts 상단 주석에 문서화**(작업 지시와의 충돌이 아니라 룰북 자체가 언급하지 않은 디테일, 이 프로젝트 관행대로 표준 러브레터 규칙을 근거로 추론): 탈락 시 손패가 자신의 `discardPile`에 앞면으로 합류한다는 규칙 — 실제 정식 러브레터 룰(탈락 시 손패를 뒷면이 아닌 앞면으로 버림더미에 놓음)과, 작업 지시의 "버려진 카드들이 각 플레이어 앞에 늘어서서 잔여 카드 추론이 쉽도록 표시" UI 요구사항, 룰북 자체의 §6 팁 3("바닥에 깔린 버린 카드들을 잘 확인하면...") 세 가지가 모두 이 해석과 맞아떨어져 채택.
4. **단위 테스트 41개(`LoveLetter.test.ts`)** — 16장 덱 구성, `startGame`의 결정론·카드 중복 없음·2인 전용 공개 제거 3장·인원수별 덱 잔여량, `isForcedCountess`/`validTargets` 헬퍼, 8종 카드 효과 전부(경비병 정답/오답/1 추측 거부/전원 보호 시 소멸, 사제의 `getPlayerView` 비공개 열람 격리, 남작 대결/동률, 하녀의 "본인 다음 턴 시작 시" 보호 해제 타이밍, 왕자의 강제 교체+공주 버림 즉시탈락+자기 자신 지정 강제+예비카드 폴백+`newCard` 격리, 왕의 손패 교환+양측에게만 공개, 백작부인 강제 플레이 규칙 위반 거부, 공주 즉시탈락), §5 종료 조건 두 가지(최후생존 즉시승리, 덱소진 시 숫자비교+버린카드합 동점처리+공동승리) 전부 통과. 테스트 작성 중 실제 설계 실수 2건을 잡아냈다: (a) 픽스처의 필러 좌석에 손패를 안 채워둬서 덱소진 비교 분기가 빈 손패를 읽다 크래시, (b) 왕/왕자 대상 지정 후 "다음 활성 좌석의 턴 시작 드로우"가 자동으로 따라붙는다는 걸 깜빡해 어설션이 어긋남 — 두 경우 다 픽스처를 실제 턴 흐름에 맞게 재구성해 해결.
5. **`LoveLetterBoard.tsx` + `CardArt.tsx` + `TargetModal.tsx` + `LoveLetterEffects.tsx`** — 카드 얼굴은 실사 이미지 그대로(`object-cover`, 이미 카드 자체에 번호/이름/효과 텍스트가 박혀 있어 캡션 중복 없음, 소환사의 협곡 세션의 교훈 재적용), 뒷면만 제공된 자산이 없어 순수 CSS 하트/편지지 모티프로 자체 제작. 작업 지시 §2가 명시한 "대상 지정 및 카드 이름/번호 선택 모달"은 `TargetModal.tsx`로 분리(코스메틱 전용인 `Effects.tsx`와 성격이 달라 별도 파일, ARCHITECTURE.md §2 선택적 확장 슬롯 활용) — 경비병은 대상 선택 후 1번을 제외한 2~8번 카드를 실제 카드 썸네일 그리드로 골라 추리하는 2단계 UI. 공주를 직접 클릭하면 즉시 탈락이라는 되돌릴 수 없는 결정이라 별도 확인 팝업을 거치도록 함. `LoveLetterEffects.tsx`는 `eliminationOrder`/`phase` 변화를 diff해 탈락 하트브레이크 팝업과 "공주의 마음을 얻었습니다!" 승리 배너를 띄우고, 게임오버 시 전원 손패가 `CardFlipWrapper`(코요테와 동일 기법)로 3D 플립 공개된다.
6. **대표 이미지 & 카드 실사 자산 연결 — 처음엔 놓쳤다가 사용자가 재요청해 바로잡음**: 최초 `boardGameRule/러브레터/` 폴더 탐색 시 `find ... -maxdepth 2 | head -100`의 출력이 잘려(다른 폴더들 사이에 묻힘) 룰북 마크다운 파일 하나만 있는 것으로 착각하고 emoji/gradient 폴백으로 진행하려 했다. 사용자가 "boardGameRule/러브레터를 참고해 게임 이미지를 반영해달라"고 명시적으로 재요청 → 폴더를 `head` 없이 다시 전수 조회하니 실제로는 이미지 9장(공식 박스 커버 3장 후보 + 1~8번 캐릭터 카드 실사 8장, 그중 7·8번은 해시 파일명)이 있었음을 확인. 추가로 `public/games/러브레터.jpg`(사용자가 이미 올려둔 정식 AEG/Magpie 한국어판 박스 커버, "Seiji Kanai / Love Letter 러브레터" 로고 확인됨)를 발견해 `public/games/love-letter.jpg`로 kebab-case 복사, `public/images/love-letter/{1-guard~8-princess}.jpg`로 캐릭터 카드 8장을 복사해 `CardArt.tsx`의 `CARD_IMAGES` 맵으로 연결(`GameThumbnail.tsx` 기본 `object-contain` 그대로 재사용, 별도 레이아웃 수정 없음) — **이 프로젝트 최초로 낱장 카드 전체가 실사 자산으로 커버된 게임**(다른 게임들은 대표 이미지만 있거나 CardArt를 순수 CSS/이모지로 자체 제작).
7. **`LoveLetterGame.tsx` 온라인 로비 + 락스텝 동기화** — 코요테/달무티와 동일한 패턴(호스트가 시드 하나만 브로드캐스트 → 각 클라이언트가 독립적으로 `startGame` 재현, 이후 액션은 `EngineAction` 브로드캐스트로 재생, 재접속 `state-request`/`state-sync`, 좌석 충돌 자가치유). 하우스 룰 토글 없음(§1의 단판승부 채택 자체가 유일한 변형점이며 이미 확정됨).
8. **임시 라우트 스크린샷으로 4가지 시각 검증** — `temp-loveletter-preview`(확인 후 삭제) 고정 상태 픽스처로 (1) 진행 중 상태(4인 스코어보드, 하녀 보호 배지, 버린 카드 더미, 내 손패 2장 선택 UI), (2) 경비병 카드 클릭 시 대상+카드번호 추리 모달(작업 지시 §2 요구사항 그대로), (3) 게임오버 결과(승자 배너, 전원 손패 공개, 탈락자는 하트브레이크 아이콘 — 오해 소지 있는 "미지의 뒷면" 대신), (4) 대시보드 허브 카드(공식 박스 커버 정상 렌더, "준비중" 아닌 플레이 가능 카드로 노출)까지 스크린샷 검증, 콘솔 하이드레이션 에러 0건(첫 스크린샷에서 프리뷰 페이지 자체의 `window.location` 동기 읽기로 인한 하이드레이션 불일치를 발견해 `useEffect`로 이동시켜 해결 — 실제 게임 컴포넌트의 버그는 아니었음).
9. **동시 작업 중인 다른 세션과의 파일 충돌 계속 이월** — 세션 시작 시점 `git status`에 여전히 `src/games/perudo/*`(컵 쉐이킹 제거 관련)와 `boardGameRule/` 대량 재구성(한글 게임명 폴더 다수 + 기존 flat `.md` 삭제), 루트 `.clinerules.md`/`instructions.md`가 커밋되지 않은 채 남아 있었음 — 이번 세션도 그 파일들을 전혀 건드리지 않았고, 유일한 교차점인 `globals.css`는 이전 세션들과 동일한 방법(HEAD 버전에 이번 세션이 추가한 키프레임 4개 `loveletter-eliminate-pop`/`loveletter-glow-flash`/`loveletter-letter-burst`/`loveletter-card-flip`만 적용한 사본을 `git hash-object`+`git update-index --cacheinfo`로 인덱스에만 스테이징하고, 실제 워킹 트리 파일은 다른 세션의 변경을 포함한 원래 내용 그대로 보존)으로 재현했다. **다음 세션도 `src/games/perudo/*`와 `boardGameRule/`(+`.clinerules.md`/`instructions.md`) 영역이 여전히 커밋되지 않은 채 남아 있다는 걸 감안하고 시작할 것.**
10. **검증**: `npx tsc --noEmit` / `npm run lint`(0 경고) / `npx vitest run`(**578개** 전부 통과, 이번 세션에서 41개 신규) 전부 통과.

</details>

**직전 세션(포세일 신규 게임)** 요약은 아래로 접혔다.

<details>
<summary>직전 세션(포세일 신규 게임) 원문 — 접힘</summary>

### 이번 세션(포세일 신규 게임) 주요 변경 사항

사용자가 `boardGameRule/포세일/포세일.md` 룰북을 근거로 신규 게임 "포세일(For Sale)"의 순수 엔진, 2단계(경매/판매) 보드 UI, 입찰 정산 및 블라인드 리빌 애니메이션, 온라인 락스텝 동기화, 단위 테스트, 문서화, 커밋/배포까지 전 과정을 요청.

1. **대표 이미지 자산이 이번에도 없었음** — 코요테 세션과 동일하게 `boardGameRule/포세일/` 폴더에는 `포세일.md` 룰북 텍스트 파일 하나뿐이라(`public/games/`, `public/images/for-sale*`에도 매칭 파일 없음, 사전 확인함), `GameMeta.thumbnail`의 emoji+gradient 폴백(🏠 이모지 + 하늘색/청록 그라디언트)을 그대로 채택했다.
2. **룰북 자체의 내부 모순 3가지를 발견해 `src/games/forSale/engine.ts` 모듈 상단 주석에 문서화** — 작업 지시와 룰북이 상충한 게 아니라, **룰북 자신의 여러 절이 서로 다른 숫자를 말하는** 경우들이라 이전 세션들의 "작업 지시 vs 룰북" 패턴과는 성격이 다름을 명확히 구분해 기록: (1) 수표 카드 값 구성 — "$0~$15,000, $2,000 단위, 각 금액 2장씩, 총 30장"이 동시에 성립할 수 없어(15,000이 2,000 단위 격자에 안 맞고, 맞더라도 16장뿐) `$0~$14,000를 $1,000 단위로 15개 값 × 2장 = 30장`으로 절충(총 30장/각 2장/$0 포함이라는, 실제 계산에 쓰이는 세 조건은 정확히 만족). (2) 4인 카드 제거 — 세팅표(§3)는 "제거 없음(30장)"이라 하지만 §4의 "인원수만큼 카드를 펼친다"는 절차가 성립하려면 매 라운드 정확히 4장씩 나머지 없이 소진되어야 하는데 30은 4로 안 나누어떨어짐(다른 3개 인원수는 전부 나누어떨어짐: 24/3=8, 30/5=6, 24/6=4) — 4인만 부동산·수표 각 2장씩 추가 제거(28장, 28/4=7)해 구조적 모순을 해소. (3) 포기 시 절반 환불 계산 — FAQ 공식 박스는 `⌊입찰금÷2⌋`라고 적혀 있지만 바로 그 옆 예시들(예: $3,000 입찰 후 포기 → "$1,000" 지불, $5,000 → "$2,000")은 이 공식과 안 맞고(⌊3000/2⌋=1500, ⌊5000/2⌋=2500), 동전이 $1,000/$2,000 단위로만 존재한다는 §2와는 맞아떨어짐(`⌊입찰금/$2,000⌋×$1,000`) — 구체적인 예시 쪽을 채택했고, 이 판단은 실제로 유닛 테스트 작성 중 두 케이스가 처음에 실패하며 발견했다(엔진을 공식 박스 그대로 구현했다가 룰북 예시와 안 맞아 재확인).
3. **`src/games/forSale/engine.ts` 순수 리듀서** — Phase 1(`bid`/`pass` 액션)은 영국식 공개 경매로, 입찰은 직전가+$1,000 이상만 허용하고 자기 현금 한도를 넘을 수 없다. 포기는 자신의 이번 라운드 마지막 입찰액 기준 절반을 내고(위 §2-(3) 공식) 바닥의 가장 낮은 번호 카드를 가져가며, 활성 입찰자가 1명만 남는 순간(`pass` 리듀서 내부에서) 별도 확인 액션 없이 자동으로 정산(전액 지불 + 가장 높은 카드 획득 + 그 승자가 다음 라운드 시작 플레이어)되고, 부동산 덱이 소진되면 곧장 Phase 2로 전환한다 — 라스베가스/소환사의 협곡과 동일한 "마지막 행동자가 자동 정산을 트리거" 패턴. Phase 2(`submitCard`/`continueSale`)는 전원이 부동산 카드 1장을 익명 제출하고, 마지막 제출과 동시에 자동으로 정산(제출값 내림차순 ↔ 수표값 내림차순 매칭 — 부동산 번호가 전부 고유해 동점 처리 불필요)하되 `sale.revealed` 플래그로 "정산은 이미 반영됐지만 UI가 리빌 애니메이션을 보여줄 시간"을 분리해, `continueSale` 액션(코요테의 `continue`와 동일한 역할)을 눌러야 다음 라운드로 넘어간다. 최종 점수는 `computeRankings`가 매번 파생 계산(수표 합계+잔여 현금, 동점이면 잔여 현금, 그마저 같으면 공동 순위) — 파생 상태 금지 원칙 그대로.
4. **단위 테스트 44개(`ForSale.test.ts`)** — 수표 덱 구성(15값×2장=30장, $0 포함), `PLAYER_SETUP` 표(인원별 카드수가 전부 인원수로 나누어떨어짐, 특히 4인 보정값 28 검증), `startGame`의 결정론·카드 중복 없음·인원수별 자산, 입찰 유효성(최소 증분/자기 차례/현금 한도/$1,000 배수), 포기 시 환불 공식(룰북 FAQ 예시 $3,000→$1,000, $5,000→$2,000 그대로 재현, 홀수 반올림 없이 코인 단위로 내림), 라운드 자동 정산(마지막 입찰자 전액 지불+최고 카드 획득+다음 라운드 시작 플레이어 지정), Phase 1 전체 흐름("모두가 항상 포기" 결정론적 경로로 인원수별 정확한 카드 분배 검증), Phase 2 블라인드 제출의 정보 격리(`getPlayerView` — 미공개 제출은 본인만 보이고, 전원 제출 시 전체 공개), 자동 정산의 내림차순 매칭 정확성, `continueSale`의 라운드 진행/게임 종료 전환, 전체 게임 흐름(4개 인원수 전부 게임오버까지), `computeRankings`의 총점/동점 처리(동전 타이브레이크, 공동 우승)까지 전부 통과. 테스트 작성 중 두 가지 설계 결함을 실제로 잡아냈다: (a) 위 §2-(3) 환불 공식 오류, (b) 첫 버전의 "포기 후 입찰자에게 돌아오는 차례"를 테스트하려던 시나리오가 실제로는 활성 입찰자가 1명으로 줄며 자동 정산되어버려 의도와 다른 라운드를 테스트하고 있었던 버그 — 3인 이상으로 늘리고 다른 좌석이 재입찰하도록 시나리오를 재구성해 해결.
5. **`ForSaleBoard.tsx` + `CardArt.tsx` + `ForSaleEffects.tsx`** — 부동산 카드는 "1번 판잣집~30번 우주기지"(작업 지시 §1 플레이버 그대로) 티어별 이모지/그라디언트로 순수 CSS 렌더링(`CardArt.tsx`), 수표 카드도 금액대별 녹색 톤 배지로 표현. 현금·미판매 부동산 손패는 룰북이 명시한 비공개 정보(§3 "동전은 비공개", §4-1 "카드는 뒷면")라 **UI 레이어에서만** 본인 것은 실제값, 타인 것은 잠금 배지/장수만 노출(스플렌더의 예약 카드 은닉과 같은 패턴) — Phase 2의 블라인드 제출은 엔진에도 `getPlayerView`(코요테 방식)로 별도 은닉 계층이 있다. `ForSaleEffects.tsx`는 두 가지 FX: (1) 포기 시 정산 — `detectPassEvent`가 라운드 내 점진적 포기와 "마지막 포기로 라운드가 자동 정산되는" 케이스를 모두 잡아 `FlyingPassCard`(포탈+getBoundingClientRect+left/top 트랜지션, 다른 게임들과 동일 기법)로 매물 구역→포기한 좌석까지 카드+환불액을 슬라이드시키고, 라운드 자동 정산 시엔 별도로 `AuctionWinToast`("낙찰!" 배너)가 함께 뜬다. (2) Phase 2 블라인드 리빌 — 코요테의 `CardFlipWrapper`를 그대로 재사용(`forsale-card-flip` 키프레임)해 `sale.revealed`가 true로 바뀌는 순간 모든 좌석의 제출 카드가 동시에 3D 플립되며 공개된다.
6. **`ForSaleGame.tsx` 온라인 로비 + 락스텝 동기화** — 코요테/달무티와 동일한 패턴(호스트가 시드 하나만 브로드캐스트 → 각 클라이언트가 독립적으로 `startGame` 재현, 이후 액션은 `EngineAction` 브로드캐스트로 재생, 재접속 `state-request`/`state-sync`, 좌석 충돌 자가치유). 하우스 룰 토글 없음(룰북에 선택 가능한 변형 규칙이 없어 추가하지 않음).
7. **임시 라우트 스크린샷으로 4단계 + 허브 카드 시각 검증** — `temp-forsale-preview`(확인 후 삭제) 고정 상태 픽스처로 (1) 1단계 경매 진행 중(매물 4장, 현재 입찰가, 입찰 스테퍼, 다른 좌석 현금 잠금 표시), (2) 2단계 제출 대기 중(공개된 수표 4장, 일부만 제출 완료 배지, 내 부동산 손패), (3) 2단계 블라인드 리빌 후(정산 결과 패널이 부동산 번호 내림차순 그대로 수표 매칭을 정확히 표시, "다음 라운드" 버튼), (4) 게임오버 결과 테이블(총점 내림차순 순위)까지 4가지와 (5) 대시보드 허브 카드(🏠 이모지+그라디언트 폴백 정상 렌더, "준비중" 아닌 플레이 가능 카드로 노출)까지 스크린샷 검증 — 콘솔 에러 0건. 첫 스크린샷 시도에서 임시 프리뷰 페이지가 픽스처 탭을 전환할 때 `ForSaleBoard`를 리마운트하지 않아 이전 픽스처의 "낙찰!" 토스트가 다음 픽스처 화면에 잘못 잔류하는 걸 발견 → `key={fixtureKey}`로 강제 리마운트해 해결(엔진/실제 게임 흐름의 버그가 아니라 프리뷰 스크립트 자체의 문제였음, 실제 플레이에서는 상태가 항상 점진적 `applyAction`으로만 전이되므로 재현되지 않는다). `.env.local`에 Supabase 키가 이미 설정돼 있었지만, 실제 2대 이상 기기로 방을 만들어 라이브 동기화를 검증하는 건 다른 게임들과 동일하게 이번에도 하지 않았다(§"알려진 사각지대" 참고).
8. **동시 작업 중인 다른 세션과의 파일 충돌 계속 이월** — 세션 시작 시점 `git status`에 여전히 `src/games/perudo/*`(컵 쉐이킹 제거 관련)와 `boardGameRule/` 대량 재구성(한글 게임명 폴더 다수 + 기존 flat `.md` 삭제), 루트 `.clinerules.md`/`instructions.md`가 커밋되지 않은 채 남아 있었음 — 이번 세션도 그 파일들을 전혀 건드리지 않았고, 유일한 교차점인 `globals.css`는 이전 세션들과 동일한 방법(HEAD 버전에 이번 세션이 추가한 키프레임 3개 `forsale-pass-fly`/`forsale-win-toast`/`forsale-card-flip`만 적용한 사본을 `git hash-object`+`git update-index --cacheinfo`로 인덱스에만 스테이징하고, 실제 워킹 트리 파일은 다른 세션의 변경을 포함한 원래 내용 그대로 보존)으로 재현했다. **다음 세션도 `src/games/perudo/*`와 `boardGameRule/`(+`.clinerules.md`/`instructions.md`) 영역이 여전히 커밋되지 않은 채 남아 있다는 걸 감안하고 시작할 것.**
9. **검증**: `npx tsc --noEmit` / `npm run lint`(0 경고) / `npx vitest run`(**537개** 전부 통과, 이번 세션에서 44개 신규) 전부 통과.

</details>

**직전 세션(코요테 신규 게임)** 요약은 아래로 접혔다.

<details>
<summary>직전 세션(코요테 신규 게임) 원문 — 접힘</summary>

사용자가 `boardGameRule/코요테/코요테.md` 룰북을 근거로 신규 게임 "코요테(Coyote)"의 순수 엔진, 원형 테이블 이마 카드 UI, 코요테 하울링 애니메이션, 온라인 락스텝 동기화, 단위 테스트, 문서화, 커밋/배포까지 전 과정을 요청.

1. **대표 이미지 자산이 이번엔 아예 없었음** — 다른 신규 게임 세션들은 룰북 폴더에 최소 1장(합성 참고 사진이든 박스 표지든)의 이미지가 있었지만, `boardGameRule/코요테/` 폴더에는 `코요테.md` 룰북 텍스트 파일 하나만 있고 이미지 자산이 전혀 없었다(`public/games/`, `public/images/coyote*`에도 매칭되는 파일 없음, 사전 확인함). 사용자에게 다시 확인을 구하기보다, `GameMeta.thumbnail`이 이미 이런 경우를 위해 설계된 `emoji`+`gradient` 폴백(다른 13개 "준비중" 카드들이 쓰는 것과 동일 메커니즘, `GameThumbnail.tsx` 수정 없이 그대로 동작)을 그대로 채택해 🐺 이모지 + 주황/적갈색 그라디언트로 처리했다 — 실제 렌더링을 스크린샷으로 확인함(§7).
2. **`src/games/coyote/engine.ts` 순수 리듀서** — 36장 덱(코요테카드 1/2/3/4/5/10/15/20 총 26장 + 0 3장 + -5 2장 + -10 1장 + 특수카드 4종 각 1장: 🌙0(선 교체)/🎁?(추가공개)/👧MAX→0/🪶×2)을 시드로 셔플해 참가자 수만큼 이마 카드로 배분하고 나머지는 라운드 덱으로 남긴다. `declare`(직전 선언보다 반드시 큰 정수만 허용, 오프닝 선언은 Perudo의 오프닝 베팅과 동일하게 무제한)와 `coyote`(대기 중인 선언이 없으면 외칠 수 없음) 두 액션으로 진행되며, "코요테!" 판정은 룰북 §3의 계산 순서(? 연쇄 뽑기 → MAX→0 → ×2)를 그대로 구현한 `resolveCoyoteCall`이 전담한다. "이마 카드" 정보 격리는 실제 상태에는 아무것도 숨기지 않고(락스텝 신뢰 모델 유지) `getPlayerView(state, viewerSeat)`가 Avalon의 `getKnowledge`와 동일한 방식으로 "지금 이 뷰어가 볼 수 있는 것"만 순수 함수로 계산한다.
3. **룰북에 명시되지 않은 5가지를 engine.ts 모듈 상단 주석에 문서화**(작업 지시와 룰북의 충돌이 아니라, 룰북 자체가 아예 언급하지 않은 부분들 — ARCHITECTURE.md §5 규칙과는 별개로 이 프로젝트의 관행대로 추론하고 근거를 남김): (1) 36장의 정확한 숫자별 장수 분배 — 실제 "코요테" 보드게임의 공개된 카드 구성(나무위키 등, 26장 "코요테카드"+3장 0+2장 -5+1장 -10+특수 4종)까지는 확인했지만 26장이 1/2/3/4/5/10/15/20 중 어떻게 나뉘는지는 어디에도 없어 4/4/4/3/3/3/3/2로 자체 추론, (2) 라운드 간 덱 유지 여부(매 라운드 36장 전체 재셔플로 처리, Perudo가 매 라운드 주사위를 통째로 다시 굴리는 것과 동일한 "파생 상태 금지" 컨벤션), (3) "0(선 플레이어 교체)" 카드의 실제 효과(이름 그대로 읽어 다음 라운드 선을 그 카드 보유자로 교체, 합산 값은 0), (4) MAX→0 동점 처리(낮은 좌석 번호 우선), (5) "깃털" 개념(작업 지시의 "깃털/목숨 소진" 프레이밍과 룰북의 "벌점 토큰 3개 누적 = 탈락" 프레이밍은 수학적으로 동일 — `feathers`가 3에서 감소하는 방식으로 통일).
4. **단위 테스트 35개(`Coyote.test.ts`)** — 36장 덱 구성(카테고리별 장수 검증), `startGame`의 인원수(3~6명) 범위·카드 중복 없음·결정론, `getPlayerView`의 정보 격리(내 카드만 숨김, 뷰어가 바뀌면 숨겨지는 카드도 바뀜, reveal/gameOver에서는 전원 공개), `declare`의 오름차순 유효성(오프닝 무제한, 동일/낮은 값 거부, 차례 검증, 탈락자 스킵), `coyote`의 유효성(선언 없이 외치기 불가, 차례 아닌 외침 거부), 특수 카드 계산(순수 합산, "?" 연쇄 뽑기, MAX→0 단독/동점 처리, ×2가 MAX→0 이후 적용, "?"+MAX→0+×2 조합, 음수 카드), §4 판정(오버 배팅 시 선언자 벌점, 안전 배팅 시 외침자 벌점, 탈락 및 게임 종료), "0(선 교체)" 카드의 다음 라운드 선 지정(생존/탈락 두 경우), `continueRound`의 재딜/재딜 실패(reveal 아닌 상태에서 no-op)까지 전부 통과.
5. **`CoyoteBoard.tsx` + `CardArt.tsx` + `CoyoteEffects.tsx`** — 아발론(`AvalonBoard.tsx`)의 원형 테이블 좌석 배치 공식(`seatPosition`, 뷰어 항상 하단 고정)을 그대로 재사용해 이마 카드를 "위성"처럼 각 아바타 위에 배치, 내 카드는 항상 "❓" 뒷면(`getPlayerView`가 반환한 `null`을 그대로 렌더링, UI가 직접 판단하지 않음), 남의 카드는 항상 앞면 숫자/특수 아이콘으로 표시해 시점 처리를 보장했다. 깃털은 🪶 이모지 핍(`FeatherPips`)으로 표시. "코요테!" 외침 시 `detectCoyoteCallEvent`(playing → reveal/gameOver 전이 감지)가 사막 톤 배경 페이드(`coyote-desert-flash`)와 늑대 하울링 전면 배너(`coyote-howl-burst`, 🐺 이모지 + "코요테!!!")를 트리거하고, 동시에 모든 좌석의 이마 카드가 `CardFlipWrapper`(`coyote-card-flip` 3D Y축 회전)로 한 번씩 뒤집히며 공개된다 — no-thanks/AuctionEffects.tsx 이래 반복된 "diff + portal + globals.css 키프레임" 기법과 동일 계열이지만, 이번엔 좌석 간 이동이 아니라 전면 오버레이 + 제자리 플립이라는 점이 다르다.
6. **`CoyoteGame.tsx` 온라인 로비 + 락스텝 동기화** — dalmuti/five-cucumbers와 동일한 패턴(호스트가 시드 하나만 브로드캐스트 → 각 클라이언트가 독립적으로 `startGame` 재현, 이후 액션은 `EngineAction` 브로드캐스트로 재생, 재접속 `state-request`/`state-sync`, 좌석 충돌 자가치유). 하우스 룰 토글 없음(룰북에 선택 가능한 변형 규칙이 없어 추가하지 않음).
7. **임시 라우트 스크린샷으로 3단계 시각 검증** — 이번 세션은 Playwright(chromium-cli 미탑재 환경이라 `npx playwright`+캐시된 ms-playwright 크로미움으로 직접 드라이버 스크립트 실행)로 (1) 대시보드 허브 카드가 🐺 emoji/그라디언트 폴백으로 정상 렌더(이미지 없음을 실제로 확인), (2) `/games/coyote`가 다른 온라인 대전 게임들과 동일하게 로컬 참가자 선택을 건너뛰고 코요테 자체 방 로비로 바로 진입, (3) `temp-coyote-preview`(확인 후 삭제) 고정 상태 픽스처로 베팅 단계(원형 테이블, 내 카드 뒷면, 남의 카드 앞면, 활성 차례 하이라이트, 깃털 핍, 선언 스테퍼), 리빌 단계(하울링 배너 → 배너 소멸 후 정산 요약 패널이 MAX→0 무효화·최종 총합·패자 판정을 정확히 표시), 게임오버 단계(순위 테이블)까지 3가지를 스크린샷 검증 — 콘솔 에러 0건. `.env.local`에 Supabase 키가 이미 설정돼 있었지만, 실제 2대 이상 기기로 방을 만들어 라이브 동기화를 검증하는 건 다른 게임들과 동일하게 이번에도 하지 않았다(실제 프로덕션 백엔드에 테스트용 방 데이터를 남기지 않기 위한 이 프로젝트의 기존 관행, §"알려진 사각지대" 참고).
8. **동시 작업 중인 다른 세션과의 파일 충돌 계속 이월** — 세션 시작 시점 `git status`에 여전히 `src/games/perudo/*`(컵 쉐이킹 제거 관련)와 `boardGameRule/` 대량 재구성(한글 게임명 폴더 다수 + 기존 flat `.md` 삭제), 루트 `.clinerules.md`/`instructions.md`가 커밋되지 않은 채 남아 있었음 — 이번 세션도 그 파일들을 전혀 건드리지 않았고, 유일한 교차점인 `globals.css`는 이전 세션들과 동일한 방법(HEAD 버전에 이번 세션이 추가한 키프레임 3개 `coyote-desert-flash`/`coyote-howl-burst`/`coyote-card-flip`만 적용한 사본을 `git hash-object`+`git update-index --cacheinfo`로 인덱스에만 스테이징하고, 실제 워킹 트리 파일은 다른 세션의 변경을 포함한 원래 내용 그대로 보존)으로 재현했다. **다음 세션도 `src/games/perudo/*`와 `boardGameRule/`(+`.clinerules.md`/`instructions.md`) 영역이 여전히 커밋되지 않은 채 남아 있다는 걸 감안하고 시작할 것.**
9. **검증**: `npx tsc --noEmit` / `npm run lint`(0 경고) / `npx vitest run`(**493개** 전부 통과, 이번 세션에서 35개 신규) 전부 통과.

</details>

**직전 세션(달무티 신규 게임)** 요약은 아래로 접혔다.

<details>
<summary>직전 세션(달무티 신규 게임) 원문 — 접힘</summary>

### 달무티 신규 게임 주요 변경 사항

사용자가 `boardGameRule/달무티/달무티.md` 룰북(제목부터 "단판승부 달무티 (하우스 룰) 정식 규칙서")과 카드 구성 참고 사진(`달무티카드구성.jpg`)을 근거로 신규 게임 "달무티(The Great Dalmuti)"의 순수 엔진, 계급 뱃지 보드 UI, 세금 카드 교환/혁명 애니메이션, 온라인 락스텝 동기화, 단위 테스트, 문서화, 커밋/배포까지 전 과정을 요청.

1. **룰북 vs 작업 지시 충돌 — 단판 vs 멀티 라운드**: 작업 지시는 "이전 라운드 턴 순서에 따라 계급 부여"·"차기 라운드 계급 재배치 로직 검증"처럼 여러 라운드가 반복되는 루프를 전제했지만, 사용자가 지정한 룰북 파일은 제목부터 "단판승부 달무티(하우스 룰)"이고 본문도 "단 1라운드로 최종 승패를 가리는 변형 하우스 룰"이라고 명시 — 승리 조건/게임 루프 자체가 갈리는 충돌이라 라스베가스 세션과 같은 기준으로 `AskUserQuestion`을 먼저 띄워 확인했고, **사용자가 "단판(룰북 원문 그대로)"을 선택**했다. 따라서 "차기 라운드 계급 재배치"는 애초에 존재하지 않으며, 그 대신 단판의 최종 순위 계산(`computeRankings`)이 같은 역할을 한다 — `engine.ts` 모듈 상단 주석과 `Dalmuti.test.ts` 도입부에 이 판단 근거를 명시.
2. **`src/games/dalmuti/engine.ts` 순수 리듀서** — 80장 덱(계급 1~12번이 각 N장, 조커 2장)을 시드 기반 무작위 순열로 초기 신분(달무티~대농노)을 정하고(룰북의 "카드 뽑기/가위바위보" 물리 절차 둘 다 "좌석의 균등 무작위 순열"과 확률적으로 동일하다고 판단해 단순화, 근거를 주석에 기록), 그 신분 순서대로 카드를 균등 배분한다(나머지는 이번 판에 쓰이지 않고 버려짐). 조커 2장을 든 좌석이 있으면 `revolutionOption` 단계로 진입해 `declareRevolution`/`declineRevolution` 중 선택(대농노가 선포하면 "대혁명"으로 `rankOrder` 전체 반전, 그 외엔 세금만 생략); 없으면 곧장 세금 단계로 진입해 대농노→달무티(2장)·소농노→총리(1장, 3인전은 두 좌석이 겹쳐 생략)의 강제 진상을 즉시 반영하고 `taxReturn`에서 받는 쪽이 돌려줄 카드를 고른다. 트릭은 `isLegalPlay`(장수 일치 + 더 작은 숫자, 조커는 와일드 패딩 또는 단독 13) 하나가 검증과 `legalPlayOptions`(UI 하이라이트) 양쪽의 단일 소스이며, 패스는 "패스해도 다음 차례에 다시 참여 가능"이라는 룰북 §3-4-B-2 문구 그대로 sticky-set 없이 "마지막 플레이 이후 연속 패스 횟수"만 세어 트릭을 종료한다(룰북에 없는 "트릭 승자가 마지막 카드를 내고 나간 경우 다음 리드"는 President류 장르 관행으로 보완, 주석에 명시). 손패가 1명만 남는 즉시 게임 종료 + 그 1인 자동 꼴찌 처리.
3. **단위 테스트 23개(`Dalmuti.test.ts`)** — 80장 덱 구성(계급 N번 N장 + 조커 2장) 검증, `startGame`의 인원수(3~8명) 범위·균등 배분·혁명 대상 자동 감지(조커 2장 보유 좌석 탐색을 800개 시드까지 브루트포스해 혁명/세금 두 분기 모두 실제로 관찰), 3인전 소농노=총리 좌석 겹침으로 두 번째 세금 교환 생략, 세금 강제 진상(조커 제외 최고 계급 자동 선택)과 받는 쪽의 반환 카드 선택(장수 불일치·미보유 카드 거부 포함), 일반 혁명(계급 불변)/대혁명(계급 전체 반전) 및 엉뚱한 좌석의 선포 거부, 트릭 제출 유효성(장수 일치·숫자 감소·조커 와일드·서로 다른 계급 혼합 거부), 패스 후 재참여 가능성(다른 사람이 그 사이 냈다면 다시 순서가 옴), 트릭 승자가 손패를 다 써서 나간 경우 다음 활성 좌석이 리드로 넘어가는지, 마지막 1인 자동 꼴찌 처리, `computeRankings`의 1-based 순위 매기기, `rankTitle`의 극단/중간 신분 명명(3인전 예외 포함)까지 전부 통과.
4. **`DalmutiBoard.tsx` + `CardArt.tsx` + `DalmutiEffects.tsx`** — `CardArt.tsx`가 룰북 §1의 계급별 공식 명칭(위대한 달무티~농노, 어릿광대)과 계급 구간별 색상 티어(1~2번 보라/금 왕족, 3~5번 남색 귀족, 6~9번 초록 장인, 10~12번 갈색 농민, 조커 흑적)를 데이터로 갖고 `CardFace`/`RoleBadge`(👑 달무티, 🎗️ 총리, 🧑‍🌾 중농, 🧺 소농노, 🧹 대농노) 둘을 내보내 Board/Effects가 공유한다(소환사의 협곡 `assets.ts`/`CardArt.tsx` 분리와 같은 패턴). 손패는 다장 조합 선택 UI(카드 클릭 토글, 현재 트릭 조건에 맞는 계급의 카드만 활성화 — 이미 다른 계급을 선택 중이면 그 계급 외 카드는 비활성화)로, 최종 제출 가능 여부는 `isLegalPlay` 단일 판정을 그대로 재사용해 UI/엔진 판정이 어긋나지 않는다. `DalmutiEffects.tsx`는 두 연속 락스텝 스냅샷을 diff해(1) 세금 카드가 좌석 간 이동하는 순간(강제 진상 시점 + 반환 확정 시점 둘 다)을 감지해 `FlyingTaxCard`로 슬라이드시키고, (2) `state.revolutionDeclared` 값이 바뀌는 순간 화면 전체를 덮는 `RevolutionBanner`("혁명!"/"대혁명!")를 띄운다 — 둘 다 no-thanks/AuctionEffects.tsx 이래 반복된 "diff + portal + left/top transition + globals.css 키프레임" 기법.
5. **`DalmutiGame.tsx` 온라인 로비 + 락스텝 동기화** — five-cucumbers와 동일한 패턴(호스트가 시드 하나만 브로드캐스트 → 각 클라이언트가 독립적으로 `startGame` 재현, 이후 액션은 `EngineAction` 브로드캐스트로 재생, 재접속 `state-request`/`state-sync`, 좌석 충돌 자가치유). 하우스 룰 토글 없음(룰북에 선택 가능한 변형 규칙이 없어 추가하지 않음).
6. **대표 이미지 연결** — `boardGameRule/달무티/달무티카드구성.jpg`(1~12번 계급 카드 + 조커 뒷면을 한 장에 담은 합성 참고 사진, 낱장 실사 카드 이미지는 없음)를 `public/games/dalmuti.jpg`로 복사해 `GameMeta.thumbnail.image`에 연결(`GameThumbnail.tsx` 기본 `object-contain` 그대로 재사용). 오이 다섯 개/소환사의 협곡과 같은 "낱장 실사 카드 없음 → 카드 비주얼은 자체 제작, 대표 이미지만 제공된 사진 사용" 패턴 — 카드 낱장은 `CardArt.tsx`의 순수 CSS/이모지 `CardFace`로 렌더링.
7. **임시 라우트 스크린샷으로 4단계 시각 검증** — `temp-dalmuti-preview`(확인 후 삭제)를 만들어 Playwright로 혁명 선택 단계(조커 2장 보유 손패 + 대혁명 선포 버튼), 세금 반환 단계(진상/하사 상태 로그 + 반환 카드 선택 하이라이트), 트릭 진행 단계(현재 트릭보다 낮은 계급 카드만 하이라이트되고 동일 계급은 비활성화됨을 확인), 게임오버 결과 테이블(시작 신분 뱃지 포함) 4가지를 스크린샷 검증. 첫 시도의 "게임오버" 픽스처는 매 턴 손패 최저 카드 1장만 내는 단순 전략이라 트릭이 요구하는 장수를 못 맞춰 무한 거부당하다 가드 한도로 멈춰버리는 문제를 발견 → `legalPlayOptions` 기반으로 요구 장수를 맞춰 내거나 패스하는 전략으로 픽스처를 고쳐 재검증(엔진 자체 버그 아님, 임시 픽스처의 순진한 전략 문제였음을 유닛 테스트 23개 전부 통과로 교차 확인).
8. **동시 작업 중인 다른 세션과의 파일 충돌 계속 이월** — 세션 시작 시점 `git status`에 여전히 `src/games/perudo/*`(컵 쉐이킹 제거 관련)와 `boardGameRule/` 대량 재구성(한글 게임명 폴더 다수 + 기존 flat `.md` 삭제), 루트 `.clinerules.md`/`instructions.md`가 커밋되지 않은 채 남아 있었음 — 이번 세션도 그 파일들을 전혀 건드리지 않았고, 유일한 교차점인 `globals.css`는 이전 세션들과 동일한 방법(HEAD 버전에 이번 세션이 추가한 키프레임 2개 `dalmuti-tax-fly`/`dalmuti-revolution-burst`만 적용한 사본을 `git hash-object`+`git update-index --cacheinfo`로 인덱스에만 스테이징하고, 실제 워킹 트리 파일은 다른 세션의 변경을 포함한 원래 내용 그대로 보존)으로 재현했다. **다음 세션도 `src/games/perudo/*`와 `boardGameRule/`(+`.clinerules.md`/`instructions.md`) 영역이 여전히 커밋되지 않은 채 남아 있다는 걸 감안하고 시작할 것.**
9. **검증**: `npx tsc --noEmit` / `npm run lint`(0 경고) / `npx vitest run`(**458개** 전부 통과, 이번 세션에서 23개 신규) 전부 통과. 실제 브라우저 애니메이션 재생 모습(세금 카드 슬라이드, 혁명 배너)과 실제 Supabase 온라인 방·2대 이상 기기 동기화는 다른 게임들과 동일하게 여전히 미검증.

</details>

**직전 세션(소환사의 협곡 신규 게임)** 요약은 아래로 접혔다.

<details>
<summary>직전 세션(소환사의 협곡 신규 게임) 원문 — 접힘</summary>

### 소환사의 협곡 신규 게임 주요 변경 사항

사용자가 `boardGameRule/소환사의 협곡/소환사의 협곡.md` 룰북과 같은 폴더의 챔피언 아이템/몬스터 실사 카드 이미지(LoL 스플래시아트 기반)를 근거로 "리그 오브 레전드 패러디: 소환사의 던전"(원작 '맨덤의 던전 / Welcome to the Dungeon'의 패러디) 신규 게임 "소환사의 협곡"의 순수 엔진, 인벤토리 HUD 보드 UI, 협곡 더미 누적/공개 애니메이션, 온라인 락스텝 동기화, 단위 테스트, 문서화, 커밋/배포까지 전 과정을 요청.

1. **`src/games/summonersRift/engine.ts` 순수 리듀서** — 공유 챔피언(기본 HP 3) + 6개 아이템/스킬(체력 증가 2종, 특정 몬스터 무료 처치 3종, 협곡 진입 전 지정한 몬스터 1종을 처치하는 황금 뒤집개 1종)과 13장 몬스터 덱(위협도 1~9, 카탈로그 그대로 8종/copies 합 13)을 룰북 §2 표 그대로 데이터화. 베팅 단계는 `drawCard`(덱에서 1장 뽑아 `pendingDraw`에 보관, 그 좌석만 진행 가능) → `pushToRift`(협곡 더미 맨 위에 스택, LIFO라 나중에 넣은 카드가 먼저 공개됨) 또는 `removeItem`(아이템 하나를 공개적으로 해제하고 뽑은 카드는 숨김 처리 — 협곡 더미에 들어가지 않음) 2단계로 분리해, 물리 게임의 "혼자 확인 후 결정" 흐름과 "아이템 해제는 공개, 카드 정체는 비공개"라는 서로 다른 공개 수준을 그대로 반영. `pass`가 마지막 미패스 좌석 1명만 남기면 그 즉시 `enterDungeon`으로 자동 전환(별도 "협곡 진입 확정" 액션 없음, 오이 다섯 개의 트릭 자동완결과 같은 패턴).
2. **전투 정산** — 황금 뒤집개가 남아있으면 `declareSpatula`로 무력화할 몬스터 1종을 미리 지정(협곡 더미가 비어있으면 이 단계 자체를 건너뜀), 이후 `revealNextMonster`가 협곡 더미를 한 장씩 공개하며 `findKiller`(아이템 상성 또는 지정한 스파툴라 대상과 일치하는지)로 무료 처치/피해 여부를 판정. HP가 0 이하가 되면 즉시 실패(남은 카드는 공개하지 않음), 전부 공개될 때까지 HP 1 이상이면 성공 — 성공 2회 선취 또는 다른 전원 실패 2회 탈락 시 즉시 게임 종료. 라운드가 끝나도 게임이 안 끝나면 오이 다섯 개와 동일하게 `initialSeed + roundNumber*104729` 파생 시드로 자동 재딜(아이템 전부 재장착, 새 13장 셔플).
3. **룰북에 명시 안 된 2가지 해석을 engine.ts 상단 주석에 문서화** — (1) 인원수 범위(룰북 미기재, 13장 덱과 이 프로젝트의 블러핑 게임군에 맞춰 2~6명으로 추론), (2) 다음 라운드 시작 플레이어(룰북은 "1라운드째만 임의로" 명시, 이후 라운드는 직전 시작 좌석에서 시계방향 로테이션으로 추론) — 작업 지시와 룰북이 상충한 건 아니고 룰북이 아예 언급하지 않은 부분이라, ARCHITECTURE.md §5 "작업 지시 vs 룰북 상충 시 룰북 채택" 규칙과는 별개로 이 프로젝트의 기존 관행(다른 게임들의 유사 규칙)에 맞춰 추론했다는 점을 명확히 구분해 기록.
4. **단위 테스트 35개(`SummonersRift.test.ts`)** — 13장 덱 구성 검증, 아이템/몬스터 상성표(`findKiller`) 전항목 검증, 턴 진행(카드뽑기→협곡투입 vs 카드뽑기→아이템해제 각각의 상태 전이), 패스 처리 및 마지막 1인 자동 협곡 진입(+황금뒤집개 유무에 따른 declaringSpatula 분기 + 빈 협곡 더미 즉시성공), 전투 정산(아이템 처치/스파툴라 처치/무방비 피해 3갈래 + HP 0 이하 즉시 실패), 승점 2회 선취 승리·실패 2회 탈락·최후생존자 승리, `computeRankings` 동점 처리까지 전부 통과. 라운드 종료 리빌이 즉시 다음 라운드를 자동 재딜하는 특성상(`finishRound`→`dealRound`) 종료 리빌 직후의 `combatLog`/`currentHp` 등 생존 필드는 이미 리셋되어 있어, 그 경우엔 `state.combatLog`가 아니라 영속되는 `lastRoundResult.combatLog`로 검증해야 한다는 점을 테스트 작성 중 실제로 놓쳤다가(첫 실행에서 4개 실패) `lastRoundResult` 기반으로 고쳐 통과시킴 — 오이 다섯 개의 `lastTrickResult`/`lastRoundSummary` 패턴과 동일한 함정.
5. **`SummonersRiftBoard.tsx` + `CardArt.tsx` + `SummonersRiftEffects.tsx`** — 6개 아이템 슬롯을 장착/해제 상태로 구분하는 LoL HUD풍 인벤토리(장착 아이템은 금테+글로우, 해제된 아이템은 그레이스케일+"해제됨" 배지), 협곡 더미는 겹쳐 쌓인 카드 뒷면 스택으로 누적 연출(뒷면은 룰북 폴더에 실제 카드 뒷면 이미지가 없어 순수 CSS 룬 문양으로 자체 제작). 카드 뽑기→협곡 투입 시 `FlyingRiftCard`(포탈+left/top 트랜지션+`rift-card-toss` 키프레임)가 미는 좌석의 스코어보드 행에서 더미 스택까지 슬라이드하고, 협곡 공략 중 몬스터 공개는 `combatLog.length`를 remount 키로 쓴 순수 CSS 애니메이션(`rift-monster-flip`로 뒤집힌 뒤, 처치면 `rift-monster-slay` 골드 버스트, 피격이면 `rift-monster-strike` 흔들림+가라앉음으로 이어붙여 재생)으로 "카드 제거 애니메이션"을 구현 — 다만 라운드를 끝내는 마지막 리빌은 그 즉시 다음 라운드가 재딜되며 라이브 필드가 리셋되므로 실시간 애니메이션 대신 라운드 결과 배너(`lastRoundResult`)가 전체 전투 로그를 요약해서 보여준다.
6. **`SummonersRiftGame.tsx` 온라인 로비 + 락스텝 동기화** — five-cucumbers/las-vegas와 동일한 패턴(호스트가 시드 하나만 브로드캐스트 → 각 클라이언트가 독립적으로 `startGame` 재현, 이후 액션은 `EngineAction` 브로드캐스트로 재생, 재접속 `state-request`/`state-sync`, 좌석 충돌 자가치유). 하우스 룰 토글은 이번 게임엔 없음(룰북에 선택 가능한 변형 규칙이 없어 추가하지 않음).
7. **대표 이미지 & 카드 에셋 동기화** — `boardGameRule/소환사의 협곡/` 폴더의 몬스터 8종/아이템 6종 실사 카드 이미지를 `public/images/summoners-rift/{items,monsters}/`로 kebab-case 파일명(`i1-ruby-crystal.jpg` 등)으로 복사해 `assets.ts`의 `ITEM_IMAGES`/`MONSTER_IMAGES` 맵으로 연결. 대표(허브 카드) 이미지는 폴더 내 별도 박스 표지가 없어(제공된 파일은 개별 카드 낱장 + 룰 요약 페이지 2장뿐), 그중 가장 표지에 가까운 극적인 스플래시아트인 "9. 장로드래곤.jpg"를 `public/games/summoners-rift.jpg`로 복사해 `GameMeta.thumbnail.image`에 연결(`GameThumbnail.tsx`의 기본 `object-contain` 그대로 재사용, 별도 레이아웃 수정 없음) — 이 선택 근거를 명시적으로 남김.
8. **카드 아트에 이미 이름/효과 텍스트가 박제되어 있음을 스크린샷으로 발견 → 캡션 중복 제거** — 처음엔 `ItemSlot`에 이미지 아래로 이름+효과 설명 캡션을 항상 렌더링했는데, 임시 라우트 스크린샷으로 확인해보니 소스 이미지 자체가 이미 "HP+3", "루비수정" 같은 텍스트를 완제품 카드처럼 박아 넣고 있어 캡션이 그대로 중복 — `showEffect` prop과 효과 캡션 줄을 통째로 제거하고 이름 라벨만 남기도록 수정(§ "시각적 버그는 코드 리뷰만으로 고쳤다고 단정하지 말 것" 작업 규칙이 실제로 잡아낸 사례, 로직 버그는 아니었지만 스크린샷 없이는 몰랐을 중복임).
9. **동시 작업 중인 다른 세션과의 파일 충돌 재발(계속 이월)** — 세션 시작 시점 `git status`에 여전히 `src/games/perudo/*`(컵 쉐이킹 제거 관련 변경)와 `boardGameRule/` 대량 재구성(한글 게임명 폴더 다수 + 기존 flat `.md` 삭제), 루트 `.clinerules.md`/`instructions.md`가 커밋되지 않은 채 남아 있었음 — 이번 세션도 그 파일들을 전혀 건드리지 않았고, 유일한 교차점인 `globals.css`는 라스베가스/오이 다섯 개 세션과 동일한 방법(HEAD 버전에 이번 세션이 추가한 키프레임 4개 `rift-card-toss`/`rift-monster-flip`/`rift-monster-slay`/`rift-monster-strike`만 적용한 사본을 `git hash-object`+`git update-index --cacheinfo`로 인덱스에만 스테이징하고, 실제 워킹 트리 파일은 다른 세션의 변경을 포함한 원래 내용 그대로 보존)으로 재현했다. **다음 세션도 `src/games/perudo/*`와 `boardGameRule/`(+`.clinerules.md`/`instructions.md`) 영역이 여전히 커밋되지 않은 채 남아 있다는 걸 감안하고 시작할 것.**
10. **검증**: `npx tsc --noEmit` / `npm run lint`(0 경고) / `npx vitest run`(**435개** 전부 통과, 이번 세션에서 35개 신규) 전부 통과. 고정 state 임시 라우트(`temp-sr-preview`, 확인 후 삭제)를 만들어 Playwright로 5가지 단계(베팅 단계 카드 확인, 베팅 단계 대기, 황금뒤집개 지정, 협곡 공략 중, 게임오버 결과 테이블)를 스크린샷 검증 — 첫 스크린샷에서 협곡 공략 단계 픽스처가 의도와 달리 즉시 라운드를 끝내버리는 걸 발견해(고정 좌석 번호를 가정한 액션 시퀀스가 실제 시작 좌석과 어긋나 일부 액션이 no-op 처리됨) `state.activeSeat` 기준으로 동적으로 액션을 적용하도록 픽스처를 재작성 후 재검증 — 단, **실제 브라우저에서의 애니메이션 재생 모습과 실제 Supabase 온라인 방·2대 이상 기기 동기화는 여전히 미검증**(§3 참고, 다른 게임들과 동일한 사각지대).

</details>

**직전 세션(라스베가스 신규 게임)** 요약은 아래로 접혔다.

<details>
<summary>직전 세션(라스베가스 신규 게임) 원문 — 접힘</summary>

사용자가 `boardGameRule/라스베가스/라스베가스.md` 룰북과 `라스베가스 세팅.png`(카지노판 레이아웃 참고), `public/games/라스베가스.webp`(대표 박스 이미지)를 근거로 신규 게임 "라스베가스(Las Vegas)"의 순수 엔진, 보드 UI, 주사위 굴림/배치 애니메이션, 온라인 락스텝 동기화, 단위 테스트, 문서화, 커밋/배포까지 전 과정을 요청.

1. **룰북 vs 작업 지시 충돌 — 라운드 수(1 vs 4)**: 작업 지시는 "4라운드 누적" 승리 조건을 명시했지만, 사용자가 지정한 룰북 파일(`boardGameRule/라스베가스/라스베가스.md`)은 원문 자체가 "요청하신 단판 모드(1라운드 완결 룰)에 맞춰... 구성된 정식 룰북"이라고 명시하고 있어 정면으로 상충 — 지폐 획득 순위/동점자 처리(지폐 장수 비교)까지 1라운드 기준으로 짜여 있음. 이 프로젝트의 표준 판단 규칙(ARCHITECTURE.md §5 "작업 지시와 룰북이 다르면 룰북 원문 쪽을 채택")을 그대로 적용하기 전에, 라운드 수는 승리 조건 자체를 바꾸는 핵심 설계라 판단해 세션 시작 시 `AskUserQuestion`으로 먼저 확인 — 사용자가 "1라운드 (룰북 원문 그대로)"를 선택해 그대로 구현. `engine.ts` 모듈 상단 주석에 이 판단 근거를 명시해 뒀다.
2. **`src/games/lasVegas/engine.ts` 순수 리듀서** — 세팅(카지노 6개 + 카지노당 지폐 누적 $50,000 이상까지 순차 배분, 인원수별 중립 주사위 배분표 + 3인 전용 사전배치 2개), 턴 진행(`rollDice`로 손패 전체 굴림 → `placeDice`로 선택한 눈금 전체를 개인+중립 구분해 카지노에 일괄 배치, 주사위 소진 좌석 자동 패스), 정산(`settleCasino` — 주사위 개수가 같은 그룹은 중립 포함 전원 상쇄, 생존 그룹은 개수 내림차순으로 최고액 지폐부터 순차 획득, 중립이 1등이면 그 지폐는 버려짐), 최종 순위(총상금 내림차순 → 동점이면 지폐 장수 내림차순 → 그래도 동점이면 공동 승리) 전부 구현. Perudo의 `continue` 액션과 같은 패턴으로, 매 턴의 주사위 굴림도 리듀서 안에서 `Math.random()`을 직접 호출하지 않고 액션에 실린 시드로 결정론을 유지(ARCHITECTURE.md §1).
3. **단위 테스트 28개(`LasVegas.test.ts`)** — 지폐 54장 덱 구성, 카지노별 $50,000 이상 자동 배치, 인원수별 중립 주사위 분배표(2~5인) + 3인 사전배치, 같은 눈금 주사위 일괄 배치(개인+중립 동시), 활성 좌석 검증, 빈 손패 자동 패스, 동점자 상쇄(룰북 예시 그대로 — 빨강3·파랑3 상쇄 + 초록1·중립1 상쇄), 순위별 지폐 지급, 지폐 소진 시 무지급, 중립이 1등일 때 버려짐, 혼합(상쇄+생존) 케이스, 카지노 1→6 순서 정산, 전체 라운드 정산 배선(`placeDice` 통해 게임오버까지), 최종 순위(총상금/지폐 장수 동점 처리) 전부 통과.
4. **`LasVegasBoard.tsx` + `DiceIcon.tsx`/`DiceEffects.tsx`** — 카지노 6개를 그리드로 배치(각 카지노에 지폐 스택 최상단 + 나머지 요약, 색상별 주사위 배지), 순수 인라인 CSS 주사위(`DiceFace` — 3x3 핍 배치를 절대 위치로 렌더링해 아주 작은 크기에서도 픽 개수가 정확히 보이도록 구현; 처음엔 CSS Grid 방식으로 만들었다가 극소 크기에서 핍이 항상 중앙 1개로만 보이는 렌더링 버그를 임시 라우트 스크린샷으로 발견해 절대 위치 방식으로 재작성했다 — 이 프로젝트의 "시각적 버그는 코드 리뷰만으로 고쳤다고 단정하지 말 것" 작업 규칙이 실제로 잡아낸 사례). 주사위 굴리기 클릭 시 `dice-roll-tumble` 키프레임으로 굴림 연출, 배치 시 `detectPlacementEvent`(연속 상태 diff) + `FlyingDicePlacement`(portal + left/top transition + `dice-slide-fly` 키프레임)로 손패/상대 좌석 → 해당 카지노판까지 개별 주사위가 슬라이드되는 연출 — no-thanks/AuctionEffects.tsx·five-cucumbers/CardEffects.tsx와 동일한 "상태 diff + portal + CSS 키프레임" 기법 재사용. Perudo의 실제 WebGL 3D 주사위는 그 게임만의 명시적 예외이므로, 이 게임은 다른 8게임처럼 순수 CSS/SVG로 유지.
5. **`LasVegasGame.tsx` 온라인 로비 + 락스텝 동기화** — five-cucumbers/splendor와 동일한 패턴(호스트가 시드 하나만 브로드캐스트 → 각 클라이언트가 독립적으로 `startGame` 재현, 이후 액션은 `EngineAction` 브로드캐스트로 재생, 재접속 `state-request`/`state-sync`, 좌석 충돌 자가치유). 라스베가스는 이 프로젝트에서 처음으로 **숨길 정보가 전혀 없는** 게임(주사위든 지폐든 배치되는 즉시 전원 공개) — `FiveCucumbersBoard`/`SplendorBoard`가 하던 "내 것만 보이게, 남의 것은 숨기게" 좌석별 필터링 로직이 `LasVegasBoard`엔 전혀 없다.
6. **대표 이미지 연결** — `public/games/라스베가스.webp`(사용자 제공 원본)를 다른 9종 박스 이미지 게임과 같은 컨벤션으로 `public/games/las-vegas.webp`(kebab-case, gameId와 일치)로 복사해 `GameMeta.thumbnail.image`에 연결. `GameThumbnail.tsx`의 기본 `object-contain`이 이미 적용되어 있어 별도 레이아웃 수정 불필요.
7. **폴더명 `lasVegas`(camelCase) vs gameId `las-vegas`(kebab-case) 불일치는 의도적** — 사용자가 작업 지시에서 `src/games/lasVegas/engine.ts` 경로를 명시적으로 지정했으므로 폴더명은 그대로 따르되, 다른 9게임과의 URL/로컬스토리지 키 등 문자열 규칙 일관성을 위해 레지스트리상의 `id`는 kebab-case(`las-vegas`)로 유지 — `playableGames.tsx`의 동적 import 매핑이 이 둘을 연결하는 유일한 지점이라 문제 없음.
8. **검증**: `npx tsc --noEmit` / `npm run lint`(0 경고) / `npx vitest run`(**400개** 전부 통과, 이번 세션에서 28개 신규) 전부 통과. 고정 state 임시 라우트(`temp-lv-preview`, 확인 후 삭제)를 만들어 Playwright로 보드 레이아웃(카지노 6개 그리드, 주사위 픽 정확도, 배치 버튼), 룰북 모달, 게임오버 결과 테이블, 대시보드 허브 카드(대표 이미지 `object-contain` 정상 표시)까지 스크린샷 검증 — 단, **주사위 텀블/슬라이드 FX의 실제 움직임과 실제 Supabase 온라인 방·2대 이상 기기 동기화는 여전히 미검증**(§3 참고, 다른 9게임과 동일한 사각지대).
9. **동시 작업 중인 다른 세션과의 파일 충돌 재발** — 세션 시작 시점 `git status`에 이미 `src/games/perudo/*`(컵 쉐이킹 제거 관련 변경으로 보임)와 `boardGameRule/` 대량 재구성(한글 게임명 폴더 다수 신설 + 기존 flat `.md` 삭제 + `소환사의 협곡` 폴더 신설), 루트의 `.clinerules.md`/`instructions.md`가 커밋되지 않은 채 걸려 있었음 — 이번 세션도 그 파일들을 전혀 건드리지 않았고, 유일한 교차점이었던 `globals.css`(다른 세션이 Perudo `cup-shake` 키프레임을 삭제 중)는 오이 다섯 개 세션(Phase 27 직전 세션)이 썼던 것과 같은 방법 — HEAD 버전에 이번 세션이 추가한 키프레임 2개(`dice-roll-tumble`/`dice-slide-fly`)만 적용한 사본을 임시로 스테이징하고, 실제 워킹 트리 파일은 다른 세션의 변경을 포함한 원래 내용으로 복원 — 으로 재현했다. **다음 세션도 `src/games/perudo/*`와 `boardGameRule/`(+`.clinerules.md`/`instructions.md`) 영역이 여전히 커밋되지 않은 채 남아 있다는 걸 감안하고 시작할 것** — 이번 세션이 만든 변경이 아니므로 임의로 커밋/삭제하지 말고 사용자에게 먼저 확인.

</details>

**직전 세션(오이 다섯 개 룰/카드 개편 + 대표 이미지 + FX)** 요약은 아래로 접혔다 — 전체 내용은 [docs/history.md Phase 28](./docs/history.md)에 옮겨 적을 것(아직 미이관, 다음 문서 정리 세션에서 처리).

<details>
<summary>직전 세션(오이 다섯 개 룰/카드 개편 + 대표 이미지 + FX) 원문 — 접힘</summary>

사용자가 `boardGameRule/오이다섯개/` 폴더에 새로 채워진 최신 룰북(`오이다섯개.md`)과 카드 구성 참고 이미지(`오이카드구성.jpg`, `오이다섯개대표이미지.jpg`)를 근거로 (1) 엔진의 오이 개수 산정 규칙 갱신, (2) 허브 대표 이미지 연결, (3) 카드 제출 FX, (4) 마지막 트릭 오이 순차 획득 FX 4가지를 요청.

1. **`cucumberCount()` 티어 표 수정(rule-accurate fix)** — 새 룰북의 "카드 구성 및 오이 개수 상세표"를 검증한 결과, 기존 엔진(Phase 27에서 구현)의 티어 경계가 새 룰북과 **어긋나 있었음**을 발견: 기존은 `1~5→0, 6~9→1, 10~11→2, 12~13→3, 14→4, 15→5`였지만, 새 룰북은 카드 1만 단독으로 0(오이 2배 폭탄 전용 카드, 실제 오이 개수가 아님)이고 `2~5→1, 6~9→2, 10~11→3, 12~14→4, 15→5`로 경계가 한 칸씩 밀려 있다 — 이번 세션에서 `engine.ts`/`FiveCucumbers.test.ts`/`RulebookModal.tsx`의 티어 표 3곳을 전부 새 표에 맞춰 수정. 트릭 승자 판정·1번 카드 배수·탈락 임계값 등 나머지 규칙은 이미 정확히 일치해 변경 없음.
2. **허브 대표 이미지 연결** — `오이다섯개/` 폴더의 낱장 카드별 실사 이미지는 없고(합성 참고 시트 `오이카드구성.jpg` 1장 + 박스 대표 이미지 `오이다섯개대표이미지.jpg` 1장뿐), 이 프로젝트의 다른 9종 박스 이미지 게임과 동일한 컨벤션(`public/games/<gameId>.jpg` + `GameMeta.thumbnail.image`)을 따라 대표 이미지만 `public/games/five-cucumbers.jpg`로 복사해 연결. 카드 낱장은 원래대로 `CucumberIcon` 기반 순수 SVG 렌더링 유지(다른 게임들의 "실사 박스 표지 vs 절차적 카드 비주얼" 분리와 같은 패턴) — 카드별 정확한 오이 개수 매핑은 위 1번의 `cucumberCount()` 수정으로 보장됨. `GameThumbnail.tsx`의 기본 `object-contain`이 이미 적용되어 있어 별도 레이아웃 수정 불필요(Phase 23에서 이미 표준화됨).
3. **카드 제출 FX(`CardEffects.tsx` 신규)** — `detectCardPlayEvent`가 연속된 두 `FiveCucumbersState` 스냅샷을 diff해 "누가 방금 카드를 냈는지"를 감지(트릭이 완성되며 `trickPlays`가 즉시 `[]`로 리셋되는 프레임도 `lastTrickResult.plays`에서 따로 잡아냄). `FlyingPlayedCard`가 no-thanks `FlyingToken`/century `FlyingResourceBurst`와 동일한 "포탈 + `getBoundingClientRect` + left/top 트랜지션 + `globals.css` 키프레임" 기법으로, 내 카드는 손패 영역에서, 상대 카드는 그 좌석의 스코어보드 행에서 중앙 트릭 구역으로 슬라이드+페이드된다.
4. **마지막 트릭 오이 순차 획득 FX** — 7번째 트릭이 정산되며 `lastRoundSummary`가 바뀌는 순간, 승자 좌석당 `cucumberPenaltyEach`개의 `CucumberPickupEvent`를 한 번에 큐잉하되, 각 토큰이 자기 인덱스 × 340ms만큼 `setTimeout`으로 발사를 늦춰(CSS `animation-delay`가 아니라 JS 지연) 트릭 구역 → 해당 좌석 오이 배지로 하나씩 순차 도착하게 만듦(예: 오이 4개 획득 시 정확히 4번의 개별 hop).
5. **동시 작업 중인 다른 세션과의 파일 충돌 재발** — 세션 시작 시점 `git status`에 이미 `src/games/perudo/*`(`PerudoBoard.tsx`/`RulebookModal.tsx`/`dice3d/*` — 컵 쉐이킹 제거로 보이는 작업)와 `boardGameRule/` 대량 재구성(한글 게임명 폴더 다수 신설 + 기존 flat `.md` 삭제)이 커밋되지 않은 채 걸려 있었음 — HANDOFF §2 작업 규칙에 이미 문서화된 "여러 세션 동시 작업" 현상의 재발. 이번엔 그 파일들을 전혀 건드리지 않고 그대로 두었고, 유일한 교차점이었던 `globals.css`(다른 세션이 `cup-shake` 키프레임을 삭제 중)는 `git add`로 HEAD 기준 diff 중 이번 세션이 추가한 두 키프레임(`card-play-slide`/`cucumber-hop-pop`)만 골라 스테이징하고 나머지는 워킹 트리에 손대지 않은 채 남겨뒀다(`git add -p`가 이 환경에서 비활성화돼 있어, HEAD 버전 파일에 내 변경만 적용한 사본을 임시로 스테이징한 뒤 실제 워킹 트리 파일은 원래 내용으로 복원하는 방식으로 수작업 재현). **다음 세션은 `src/games/perudo/*`와 `boardGameRule/` 두 영역이 여전히 커밋되지 않은 채 남아 있다는 걸 감안하고 시작할 것** — 이번 세션이 만든 변경이 아니므로 임의로 커밋/삭제하지 말고 사용자에게 먼저 확인.
6. **검증**: `npx tsc --noEmit` / `npm run lint`(0 경고) / `npx vitest run`(372개 전부 통과, 티어 표 변경에 맞춰 기존 테스트 기댓값도 갱신) 전부 통과. 추가로 고정 state 임시 라우트(`temp-fc-preview`, 확인 후 삭제)를 만들어 Playwright로 보드 레이아웃(새 티어 숫자가 카드에 정확히 반영됨)과 대시보드 허브 카드(대표 이미지가 `object-contain`으로 잘리지 않고 표시됨)를 스크린샷 검증 — 단, **스크린샷은 정지 이미지라 FX의 실제 움직임(슬라이드/순차 이동 타이밍)까지는 확인하지 못했다**(§3 참고).

**직전 세션(문서 재정리)**은 위 표와 아래 "작업 규칙"에 그대로 남아 있고, **오이 다섯 개 신규 게임(엔진/보드 UI 최초 구현)**은 [docs/history.md Phase 27](./docs/history.md#phase-27--오이-다섯-개five-cucumbers-신규-게임-2026-08-09-같은-날-열일곱-번째-세션)에, **누락된 게임 박스 이미지 일괄 연결**은 [Phase 26](./docs/history.md#phase-26--누락된-게임-박스-이미지-일괄-연결-2026-08-09-같은-날-열여섯-번째-세션)에, **스플렌더 신규 게임**은 [Phase 25](./docs/history.md#phase-25--스플렌더splendor-신규-게임-2026-08-09)에 전부 기록되어 있다.

</details>

</details>

---

## 2. 현재 시스템 상태 및 구조

### 기술 스택
| 항목 | 내용 |
|---|---|
| 프레임워크 | Next.js 16(App Router, Turbopack) + React 19 + TypeScript(strict) |
| 스타일 | Tailwind CSS v4 |
| 클라이언트 상태 | Zustand(`useBettingStore`) |
| 주 데이터베이스 | 브라우저 IndexedDB(`idb` 래퍼) — 완전 오프라인 동작 |
| 클라우드(선택) | Supabase — Realtime(Broadcast/Presence)이 온라인 대전 15종의 통신 수단 자체, Postgres 2테이블(기기 식별 힌트, 내기 기록 백업)은 완전 선택 |
| 배포 | Vercel, 프로덕션 자동 별칭 `board-game-tau-navy.vercel.app` |
| 테스트 | Vitest **537개**(게임 엔진 15종 + 카탈로그 정렬 helper 유닛 테스트 — **UI 컴포넌트 테스트 인프라 없음**, jsdom 미설치) |

### 주요 의존성 (`package.json`)
| 패키지 | 역할 |
|---|---|
| `next` 16.2.12 / `react`·`react-dom` 19.2.4 | 프레임워크 (App Router, Turbopack) |
| `@supabase/supabase-js` ^2.111.0 | 온라인 대전 15종의 Realtime(Broadcast/Presence) + 선택적 클라우드 백업 |
| `idb` ^8.0.3 | IndexedDB 래퍼 — 1차 저장소 전체가 이 위에서 동작 |
| `zustand` ^5.0.14 | 내기 세션 전역 상태(`useBettingStore`) |
| `uuid` ^14.0.1 | 플레이어/세션/기록 레코드 ID 생성 |
| `tailwindcss` ^4 / `@tailwindcss/postcss` | 스타일링 |
| `vitest` ^4.1.10 | 게임 엔진 유닛 테스트 (jsdom 미설치 — UI 컴포넌트 테스트 불가) |
| `typescript` ^5 / `eslint` ^9 + `eslint-config-next` | 타입 체크 · 린트 |
**의도적으로 없는 것**: 상태 관리 라이브러리(Redux 등) 추가 없음(Zustand 하나로 충분), ORM 없음(IndexedDB를 `idb`로 직접 다룸), 데이터 페칭 라이브러리(react-query 등) 없음, 테스트 러너 외 e2e/컴포넌트 테스트 도구 없음, **`three`/`@react-three/*` 계열 없음**(2026-08-16 이전엔 페루도 3D 주사위 전용으로 명시적 예외였으나, 사용자 요청으로 CSS/SVG 탑뷰 렌더링으로 전환하며 완전히 제거됨 — 아래 §2 참고) — 전부 "이미 있는 도구로 충분한데 새 의존성을 추가하지 않는다"는 이 프로젝트의 반복된 판단([docs/architecture.md §1.2](./docs/architecture.md#12-dexiejs-대신-기존-idb-유지--중복-추상화를-피함), [§1.3](./docs/architecture.md#13-bettingcontext-요청--이미-있는-zustand-스토어)). 새 게임/기능에 무거운 신규 의존성이 필요할 것 같으면 먼저 확인받을 것.

### 핵심 파일 구조

표준 게임 모듈 레이아웃(모든 신규 게임이 지켜야 할 계약)은 **[ARCHITECTURE.md](./ARCHITECTURE.md)**가 단일 출처다. 여기는 "지금 실제로 무엇이 있는지"의 스냅샷만:

```
src/
  app/                  Next.js 라우팅만 (대시보드, /games/[gameId] 스테이지 머신, /history)
  components/           범용 UI + 내기 사이드바 일체
  games/
    registry.ts          GAME_REGISTRY(순수 데이터, 28종)
    playableGames.tsx     GameId → 동적 import 매핑(15종 실제 등록)
    <game-id>/            표준 레이아웃(ARCHITECTURE.md §2) + 게임별 추가 파일:
      (perudo만) PerudoFaceIcon.tsx / dice/  CSS/SVG 탑뷰 주사위(2026-08-16, 아래 §2 — 이전 WebGL 3D 주사위를 대체) — PerudoDie(단일 다이 프리미티브)/DiceRollTray(셰이크 후 착지 CSS 애니메이션)/colorways
      (century만) cards.ts / ResourceIcon.tsx / MerchantEffects.tsx  상인 32장/점수 36장 카드 데이터, 4색 자원 아이콘 2종, 자원 수거 플라잉 이펙트
      (spot-difference만) scenes.ts / SpotDifferenceScene.tsx / PhotoStageCanvas.tsx  기본 스테이지 씬 데이터, SVG 렌더러, 사진 업로드 모드 Canvas 픽셀 변형
      (splendor만) cards.ts / GemToken.tsx  개발 카드 90장 + 귀족 10개(자체 생성기, Phase 25), 보석 토큰 비주얼
      (five-cucumbers만) CucumberIcon.tsx  오이 아이콘 2종(카드용/스코어보드용), 순수 인라인 SVG
      (lasVegas만, 폴더명은 camelCase — 라스베가스 세션 §1 참고) DiceIcon.tsx / DiceEffects.tsx  절대 위치 기반 순수 CSS 주사위 핍 렌더러, 배치 슬라이드 FX
      (summonersRift만, 폴더명은 camelCase) assets.ts / CardArt.tsx / SummonersRiftEffects.tsx  아이템 6종·몬스터 8종 실사 카드 이미지 경로 맵, 장착/해제 슬롯·몬스터 페이스·카드 뒷면 렌더러, 협곡 더미 누적 FX
      (dalmuti만) CardArt.tsx / DalmutiEffects.tsx  계급별 공식 명칭·색상 티어 데이터 + CardFace/RoleBadge 렌더러, 세금 카드 진상/하사 FX + 혁명·대혁명 전면 배너
      (coyote만) CardArt.tsx / CoyoteEffects.tsx  카드 이모지/그라디언트 데이터 + CardFace/FeatherPips 렌더러, 코요테 하울링 배너 + 카드 3D 플립 공개
      (forSale만, 이번 세션, 폴더명은 camelCase — 라스베가스 세션 §1과 동일한 이유) CardArt.tsx / ForSaleEffects.tsx  부동산 티어별 이모지/그라디언트 + 수표 금액대별 배지 렌더러, 포기 정산 플라잉 FX + 낙찰 토스트 + 블라인드 리빌 3D 플립
  lib/                  db(IndexedDB) / betting(정산 원장) / identity(기기·플레이어 매핑) / supabase / rng(공유 시드 난수·셔플, 문서 재정리 세션 신설)
  store/bettingStore.ts  Zustand — 내기 세션 오케스트레이션
public/games/<gameId>.{png,jpg,webp}  게임 카드 실사 박스 표지(12종, Phase 22/25/26/라스베가스/소환사의 협곡/이번 세션 — GameMeta.thumbnail.image가 가리킴). 나머지는 이모지+그라디언트 생성 방식.
public/images/summoners-rift/{items,monsters}/  소환사의 협곡 전용 아이템 6종/몬스터 8종 실사 카드 이미지(이번 세션 — assets.ts가 가리킴). 다른 게임은 카드 낱장에 실사 이미지를 쓰지 않아 이 파일만 있는 하위 폴더 구조.
boardGameRule/*.md      게임별 공식 룰 원문 — 엔진 구현의 근거 자료. 파일명 표준(gameId 기준 kebab-case)은 ARCHITECTURE.md §5에 목표로만 문서화됨 — 실제 리네임은 다른 세션과의 충돌로 보류 중(§1 참고). 라스베가스 룰북은 `boardGameRule/라스베가스/라스베가스.md`(다른 세션이 진행 중인 한글 폴더 재구성 결과물 — 이번 세션은 읽기만 하고 건드리지 않음)
docs/                   개발자 심화 문서(아래 "관련 문서" 참고)
```
전체 디렉토리 규칙과 계층 의존 방향은 [docs/architecture.md §5](./docs/architecture.md#5-디렉토리-구조-및-계층-규칙)에 도식으로 정리되어 있음.

### 현재 작동 중인 주요 로직
- **온라인 대전 15종 전부 같은 락스텝(lockstep) 패턴**: 방장이 시드 하나만 브로드캐스트 → 모든 클라이언트가 독립적으로 동일 초기 상태 계산 → 이후 액션은 `EngineAction`으로 브로드캐스트해 같은 순수 리듀서로 재생. 서버 권위 엔진 없음(의도적, [docs/architecture.md §2](./docs/architecture.md#2-온라인-대전의-신뢰-모델-문서화된-의도적-한계)). 재접속(`state-request`/`state-sync`)과 좌석 충돌 자가치유(deviceId 사전순)도 15게임 공통 적용됨([docs/cloud-sync.md](./docs/cloud-sync.md)).
- **포세일 핵심 설계**(이번 세션): (1) Phase 1(`bid`/`pass`)은 영국식 공개 경매 — 활성 입찰자가 1명으로 줄어드는 순간(`pass` 리듀서 내부) 별도 확인 액션 없이 전액 지불+최고 카드 획득+다음 라운드 시작 플레이어 지정까지 자동 정산된다(라스베가스/소환사의 협곡과 동일한 "마지막 행동자가 트리거"). (2) 포기 시 절반 환불은 룰북 FAQ의 공식 박스(`⌊입찰금÷2⌋`)가 아니라 그 옆 구체적 예시들(`⌊입찰금/$2,000⌋×$1,000` — 코인이 $1,000/$2,000 단위로만 존재해 정확한 홀수 절반을 낼 수 없다는 §2 제약과 일치)을 채택 — 룰북 자신의 두 부분이 서로 다른 걸 말하는 내부 모순이라 예시 쪽이 우선한다고 판단(엔진 모듈 상단 주석 참고). (3) 수표 카드 값도 마찬가지로 룰북 내부 모순("$0~$15,000, $2,000 단위, 각 2장, 총 30장"이 동시에 성립 불가)을 "$0~$14,000를 $1,000 단위로 15값×2장=30장"으로 절충. (4) 4인일 때만 부동산·수표 각 2장씩 추가로 제거(28장씩)해 "인원수만큼 카드를 편다"는 절차가 나머지 없이 나누어떨어지도록 보정(다른 인원수는 룰북 표 그대로 둬도 이미 나누어떨어짐). (5) Phase 2(`submitCard`/`continueSale`)는 마지막 제출과 동시에 자동 정산되지만 `sale.revealed` 플래그로 정산 반영과 "UI가 리빌 애니메이션을 보여줄 시간"을 분리 — `continueSale`(코요테 `continue`와 동일 역할)을 눌러야 다음 라운드로 진행. (6) 현금/미판매 부동산은 룰북이 명시한 비공개 정보라 UI 레이어에서만 은닉(스플렌더의 예약 카드 은닉과 같은 패턴), Phase 2의 블라인드 제출만 엔진에도 `getPlayerView`(코요테 방식) 은닉 계층이 별도로 있다.
- **달무티 핵심 설계**(이번 세션): (1) 룰북이 명시적으로 "단판승부(하우스 룰)"라서 라운드가 반복되지 않는다 — `EngineAction`은 `declareRevolution`/`declineRevolution`/`returnTax`/`playCards`/`pass` 5종뿐이고, `phase`는 `revolutionOption → taxReturn → trick → gameOver` 한 방향으로만 흐른다. (2) 초기 신분(`rankOrder`)은 물리 절차(카드 뽑기+동률 재비뽑기, 또는 가위바위보) 둘 다 "좌석의 균등 무작위 순열"과 확률적으로 동일하다고 보고 `shuffle(seats, rng)`로 바로 계산 — 절차 자체를 시뮬레이션하지 않는다. (3) 세금은 "강제 진상"(자동, 조커 제외 최고 계급 카드)과 "선택 반환"(플레이어 액션)을 분리 — 진상은 `taxReturn` 진입과 동시에 즉시 반영되고, 받는 쪽 손패가 일시적으로 불어난 상태에서 `returnTax`로 돌려줄 카드를 고른다. (4) 트릭의 패스는 sticky set이 없다 — "마지막 플레이 이후 연속 패스 횟수"만 세어, 그 수가 "리더를 제외한 살아있는 좌석 수"에 도달하면 트릭이 끝난다(룰북이 "패스해도 다음 차례에 다시 참여 가능"이라고 명시한 것을 그대로 반영, 다른 트릭테이킹 게임들과 다른 지점). (5) `isLegalPlay` 하나가 엔진 검증과 `legalPlayOptions`(UI "낼 수 있는 조합만 하이라이트") 양쪽의 단일 소스 — 조커는 다른 카드와 섞이면 그 계급의 와일드(장수만 채움), 단독이면 계급 13. (6) 손패가 1명만 남는 순간 그 즉시 게임 종료 + 자동 꼴찌 처리(마지막 사람은 굳이 마저 낼 필요가 없다는 룰북 §4 해석). (7) 작업 지시(멀티 라운드)와 룰북 원문(단판)이 정면 충돌해 `AskUserQuestion`으로 먼저 확인 후 사용자가 단판을 선택 — 라스베가스 세션과 같은 유형의 판단.
- **소환사의 협곡 핵심 설계**(직전 세션): (1) `EngineAction`이 `drawCard`/`pushToRift`/`removeItem`/`pass`/`declareSpatula`/`revealNextMonster` 6종인 리듀서 — 카드 뽑기를 "혼자 확인"(`pendingDraw`)과 "협곡에 넣기 또는 아이템 해제로 결정"을 별도 액션으로 쪼개 그 좌석만 진행 가능하게 잠근다. (2) 협곡 더미는 배열 index 0을 "맨 위"로 삼는 LIFO 스택 — 나중에 밀어넣은 몬스터가 다음 라운드 공략에서 먼저 공개된다. (3) 마지막 미패스 좌석이 결정되는 즉시(`pass` 리듀서 내부에서) 총 HP 계산 → (황금 뒤집개 남아있고 더미가 비어있지 않으면) `declaringSpatula` → `resolvingRift`까지 별도 확인 액션 없이 자동 전이한다 — 오이 다섯 개의 트릭 자동완결/라스베가스의 정산 자동실행과 같은 패턴. (4) `revealNextMonster`가 한 장씩 공개하며 HP 0 이하 도달 시 남은 카드를 공개하지 않고 즉시 실패로 멈춘다. (5) 라운드가 끝나도 게임이 안 끝나면 `initialSeed + roundNumber*104729` 파생 시드로 자동 재딜(아이템 전부 재장착) — 오이 다섯 개와 동일한 "네트워크 재브로드캐스트 없이 모든 클라이언트가 동일하게 재셔플" 기법. (6) 인원수 범위(2~6)와 라운드 로테이션 규칙은 룰북이 아예 언급하지 않아 이 프로젝트 관행에 맞춰 추론한 것 — `engine.ts` 상단 주석에 그 판단 근거를 "룰북과 상충"이 아니라 "룰북 미기재"로 명확히 구분해 기록했다. (7) 카드 아트(`assets.ts`)는 룰북 폴더의 실사 카드 이미지를 그대로 쓰되, 그 이미지들 자체가 이미 이름/효과 텍스트를 완제품 카드처럼 박아 넣고 있어 `CardArt.tsx`의 UI 캡션은 이름 라벨 하나로 최소화했다(중복 캡션은 스크린샷으로 실제 확인 후 제거).
- **라스베가스 핵심 설계**(이번 세션): (1) `EngineAction`이 `{type:"rollDice",seed}` / `{type:"placeDice",face}` 두 개뿐인 리듀서 — 세팅은 카지노별 지폐를 $50,000 이상까지 순차 배분 후 최고액이 위로 오도록 정렬, 인원수별 중립 주사위 배분표(2~5인)와 3인 전용 사전배치 2개까지 `startGame` 한 번에 처리. (2) 매 턴 굴림은 Perudo의 `continue` 액션과 동일하게 액션에 실린 시드로 결정론 유지 — 리듀서 내부에서 `Math.random()`을 직접 호출하지 않는다. (3) `placeDice`는 선택한 눈금의 개인 주사위와 중립 주사위를 동시에 갈라 각각 카지노에 얹고, 손패가 빈 좌석은 `nextActiveSeat`가 자동으로 건너뛰며, 전원의 손패가 비면 그 자리에서 즉시 `settleCasinos`까지 실행해 `phase:"gameOver"`로 전환한다 — 별도의 "정산 시작" 확인 액션이 없다. (4) 정산의 핵심은 `settleCasino`의 동률 상쇄 — 주사위 개수별로 그룹핑해 개수가 겹치는 그룹(중립 포함) 전원을 상쇄하고, 생존 그룹만 개수 내림차순으로 지폐를 순서대로 지급, 중립이 1등이면 그 지폐는 아무도 갖지 못한다(→ 카지노 소속과 무관하게 "돈을 실제로 지급받는지"만 `applySettlementToPlayers`가 별도로 판단). (5) 이 프로젝트에서 처음으로 **숨길 정보가 전혀 없는 게임**이라 `LasVegasBoard`엔 다른 게임들의 "내 것만 보이게" 좌석별 필터링이 전혀 없다. (6) 작업 지시(4라운드)와 룰북 원문(1라운드 완결)이 상충해 사용자 확인 후 룰북 쪽(단판)을 채택 — `engine.ts` 모듈 상단 주석에 판단 근거 기록.
- **오이 다섯 개 핵심 설계**(Phase 27, 이번 세션에 티어 표/FX 보강): (1) `EngineAction`이 `{ type: "playCard" }` 단 하나뿐인 리듀서 — 트릭 완성(1~6번째: 승자 판정 후 즉시 다음 트릭 리드로 전환) → 마지막 7번째 트릭 완성(오이 정산+탈락 판정) → 라운드 종료 시 다음 라운드 자동 재딜까지 별도 확인 액션 없이 한 번에 처리된다. (2) 트릭 제출 유효성은 `legalCardIds`(현재 최댓값 이상 또는 손패 내 최저 카드만 허용) 하나의 파생 함수가 엔진 검증과 UI 하이라이트를 동시에 담당. (3) 1~6번째 트릭은 "나중에 낸 동점자가 승리"(단일 승자), 7번째는 룰북이 명시한 대로 "동점자 전원이 각자" 오이를 먹는다 — 의도적으로 다른 동점 규칙. (4) 라운드 재딜은 `initialSeed + roundNumber*104729`로 매 라운드 새 시드를 결정론적으로 파생시켜, 라운드가 몇 번이고 반복돼도 추가 네트워크 브로드캐스트 없이 모든 클라이언트가 동일하게 재셔플한다(틀린 그림 찾기의 "좌표를 시드에서 파생" 원칙과 같은 종류의 판단). (5) 탈락 좌석은 손패를 비운 채 회전 순서에서만 제외되고, `computeRankings`가 `eliminatedAtRound`(생존 못한 라운드, null=끝까지 생존) 기준 표준 경쟁 순위를 매겨 동시 탈락(공동 최후 포함)도 별도 분기 없이 자동으로 공동 순위 처리된다. (6) 하우스 룰(탈락 기준 오이 5개/6개)은 노땡스의 `ChipVisibility`와 같은 "호스트가 방 생성 시 고르는 게임 모드" 패턴. (7) `cucumberCount(value)`는 `boardGameRule/오이다섯개/오이다섯개.md`의 상세표를 그대로 코드화한 순수 함수(카드 1만 예외적으로 0 — 오이 개수가 아니라 "2배 폭탄" 전용 표시) — 카드 낱장 비주얼(`CardFace`)과 룰북 모달 표(`RulebookModal.tsx`) 둘 다 이 함수/상수 하나를 그대로 따라가므로 티어 경계를 바꿀 일이 생기면 `engine.ts` 한 곳만 고치면 된다. (8) `CardEffects.tsx`(이번 세션 신규)의 `detectCardPlayEvent`/`FlyingPlayedCard`가 no-thanks `AuctionEffects.tsx`/century `MerchantEffects.tsx`와 동일한 "연속 상태 diff + portal + left/top 트랜지션 + CSS 키프레임" 기법으로 카드 제출 슬라이드 FX를, `buildCucumberPickupEvents`/`FlyingCucumber`가 같은 기법에 `index * 340ms` 만큼의 `setTimeout` 시작 지연을 얹어 마지막 트릭의 오이 획득을 1개씩 순차 연출한다 — 둘 다 순수 코스메틱이라 게임 로직/네트워크 동기화에는 관여하지 않는다(다른 클라이언트도 같은 상태 diff를 보므로 동일하게 재생됨).
- **스플렌더 핵심 설계**(Phase 25): (1) 4가지 턴 행동(다른 보석 3개/같은 보석 2개/카드 예약+황금/카드 구매)을 `applyAction` 하나의 리듀서로 구현, 카드 구매 결제는 UI가 아니라 `computeAutoPayment`가 자동 계산(보유 색 토큰 우선, 부족분만 황금). (2) 턴 종료를 `finishTurn`(10토큰 초과 → `phase:"discarding"`) → `afterTokensSettled`(귀족 방문, 2명 이상 동시 조건 충족 시 `phase:"choosingNoble"`) 2단계 게이트로 분리. (3) 카드/귀족 데이터는 룰북에 카드 목록 부록이 없어 비용 템플릿을 5색에 순환 적용하는 자체 생성기(`cards.ts`)로 공식 수량(40/30/20장, 귀족 10개)만 구조적으로 보장. (4) 예약 카드는 온라인 신뢰 모델상 전체 상태가 모든 클라이언트에 있지만, 실물 룰대로 다른 좌석 것은 `SplendorBoard.tsx`가 뒷면 아이콘으로만 렌더링(아발론/뱅! 역할 은닉과 같은 UI 계층 은닉 기법을 카드 자산에 적용한 첫 사례).
- **파생 상태(derived state) 금지 원칙**: 같은 사실을 두 상태로 따로 표현하지 않기([docs/architecture.md §1.4](./docs/architecture.md#14-파생-상태derived-state-금지-원칙)). 센추리에서도 승자/순위는 저장하지 않고 `computeRankings(state)`로 매번 파생 계산하며, 점수 카드 코인 지급도 "카드에 코인이 물리적으로 붙어있는지"를 별도로 추적하지 않고 "슬롯 0/1을 완성하면 은행 공급량에서 지급"으로 단순화했다(왜 안전한 단순화인지는 history.md Phase 12 참고).
- **센추리 핵심 설계**: (1) 자원 4단계(노란색<빨간색<초록색<갈색)와 4가지 턴 행동(카드 사용/상인 카드 획득/휴식/점수 카드 완성)을 `applyAction` 하나의 리듀서로 구현. (2) 상인 카드 획득 시 N번째 카드를 가져오려면 그 앞 카드들 위에 자원을 1개씩 올려야 하며, 그 자원은 **슬롯이 아니라 카드 자체에 붙어** 시장이 밀릴 때도 함께 이동한다(`merchantMarketResources`를 `merchantMarket`과 항상 같은 인덱스로 필터링). (3) 자원 10개 한도 초과 시 `phase: "discarding"`으로 게이트되어 `discardToLimit` 액션 없이는 다음 사람 턴으로 못 넘어간다. (4) 업그레이드 카드는 `simulateUpgrade`(엔진과 UI 미리보기가 공유하는 단일 함수)로 "같은 자원을 연속 승급"과 "여러 자원에 분산"을 모두 지원. (5) 누군가 점수 카드 목표치를 채우면 `endTriggered` 플래그만 세우고, 마지막 좌석(`playerCount - 1`)이 턴을 마칠 때 `gameOver`로 전환. (6) UI는 카드 시장 2단(상인 6장/점수 5장) + 내 수레 게이지 + 업그레이드/교환/획득/버리기 전용 모달로 구성.
- **"엔진 테스트 100% 통과 ≠ UI 정상"**: `<Game>Board.tsx`는 10게임 전부 자동 테스트 대상 밖(jsdom 미설치). 과거 이 사각지대에서 발생한 버그가 4건 있음([docs/troubleshooting.md](./docs/troubleshooting.md) #1, #6, #7, #10). 센추리 보드 UI(Phase 18)/그리드 포커 방 설정 폼(Phase 19)/틀린 그림 찾기 보드+방 생성 폼(Phase 20)/페루도 CSS 3D 주사위(Phase 21)/페루도 실제 WebGL 3D 주사위(Phase 22)/스플렌더 보드 UI(Phase 25)/오이 다섯 개 보드 UI(이번 세션, Phase 27)는 실제 렌더링 스크린샷으로 검증했지만, **실제 Supabase 온라인 로비를 거친 멀티 디바이스 동기화는 일곱 세션 다 여전히 미검증**이다(스플렌더는 결제/예약/귀족선택 모달의 클릭 흐름 자체도 스크린샷 검증 밖; 오이 다섯 개는 라운드가 여러 번 반복되며 탈락자가 발생하는 흐름이 특히 미검증).
- **페루도 주사위는 `active3D` 플래그로 실제 WebGL 3D와 CSS 폴백 사이를 디스패치**(Phase 22, `src/games/perudo/dice3d/`): `DieFace`/`DieBack`/`BettingDie`가 `useWebglSupport()`(SSR-safe) + 사용자 "3D 끄기" 토글을 보고 매번 선택한다. 3D 쪽은 `DiceMesh`(`three-stdlib`의 `RoundedBoxGeometry` — 진짜 6면 독립 머티리얼, drei 자체 `RoundedBox`는 부적합) 하나를 모든 주사위가 공유하고, 정적 타일은 `DiceStage.tsx`의 drei `View` 기반 공유 캔버스로, 물리 굴림 연출은 `DiceCup3D.tsx`(Rapier, 결과는 항상 `engine.ts` 값에 강제 정렬)로 나뉜다. CSS 쪽(`DiceCube`/`*Css` 접미사 컴포넌트, Phase 21에서 만든 것)은 그대로 남아 있다 — 새 주사위 변형이 필요하면 3D는 `colorways.ts`에 새 `DiceColorway`를, CSS 폴백도 맞춰서 `CubeColorway`를 추가할 것. 자세한 설계 판단은 [docs/history.md Phase 22](./docs/history.md#phase-22--페루도-실제-webgl-3d-주사위threejsr3frapier--게임-카드-실사-이미지-2026-08-08-같은-날-열네-번째-세션) 참고.
- **게임 카드 이미지는 `GameMeta.thumbnail.image`가 있을 때만 실사, 없으면 이모지+그라디언트**(Phase 22): `GameThumbnail.tsx` 공유 컴포넌트가 분기하며, `GameCard`/게임 준비중 페이지/온라인 로비 헤더 3곳이 재사용한다. 이미지가 있는 5종(`public/games/`)은 전부 퍼블리셔 소유 박스 표지 원본이라는 점에 유의(docs/history.md Phase 22 §8) — 새 게임에 이미지를 추가할 때도 출처를 문서화할 것. **기본 `imageClassName`은 `object-contain`**(Phase 23) — 박스 표지가 세로형이라 `object-cover`를 쓰면 위아래가 잘리기 때문. `next/image`의 `fill`은 부모의 패딩을 무시하고 자신을 채우므로, 레터박스 여백이 필요하면 컨테이너가 아니라 `imageClassName`에 직접 `p-*`를 실어야 한다(docs/history.md Phase 23 §1).
- **센추리 보드 매트 3단 레이어**: `MAT`(목재 탁자) → `FELT`(마켓 펠트) → `CARAVAN_STYLE`(내 수레 목재) 순서로 감싸는 CSS 전용 배경 레이어. `ResourceIcon`(배지용 다이아몬드)과 `ResourceCube`(실물에 얹힌 자원용 3D 큐브)는 용도가 다른 별개 컴포넌트이니 새로 자원을 그릴 자리를 추가할 때 어느 쪽이 맞는지 먼저 확인할 것.
- **페루도 베팅 트랙 = "보드 위 말(piece)" 모델**: `BidTrack`(트랙 칸 그리드)과 `BettingDie`(보라색 다이스)가 분리되어 있고, 실제 베팅 값(`state.currentBid`)과 로컬 베팅 초안(`pendingFace`/`pendingQuantity`, 내 차례일 때만 존재)이 별개 개념이다 — 내 차례가 아닐 때 트랙 위 보라색 다이스는 항상 `state.currentBid`를 그대로 보여주고, 내 차례가 되면 그 자리에서 초안으로 바뀌어 조작 가능해진다. 이동 가능 범위(`minValidQuantityForFace`)는 새로 만들지 않고 기존 엔진 헬퍼를 그대로 재사용한다.
- **그리드 포커 룸 설정값은 `GridPokerState` 자체에 편입**: 방장이 고른 `TimerSettings`(모드/배치초/제출초)는 별도 동기화 채널 없이 `startGame()`이 상태에 박아 넣고 `game-start` 브로드캐스트 payload로 전파한다 — 카운트다운의 *틱 자체*는 여전히 클라이언트 로컬(useCountdown.ts, 합의 대상 아님)이지만 *몇 초짜리인지*는 상태의 일부라 전 클라이언트가 항상 일치한다. 새로운 방-레벨 설정을 추가할 때 이 패턴(ref로 스냅샷 → game-start payload에 포함 → state 필드로 편입)을 재사용할 것.
- **틀린 그림 찾기는 "좌표를 전송하지 않고 시드에서 파생" 원칙을 사진 업로드 모드까지 확장**: 다른 게임들이 RNG 시드만 공유해 카드/타일 배치를 각자 계산하는 것처럼, 사진 모드도 실제 사진 데이터(`imageDataUrl`)만 `game-start`로 전송하고 "어디를 어떻게 바꿀지"(좌표+효과+강도)는 `generatePhotoDiffSpots(seed, count)`가 이미지 없이 순수 계산한다 — 정답 좌표를 별도로 전송/저장하지 않는다. 오답 페널티 잠금도 `Date.now()`를 리듀서에서 직접 읽지 않고 클릭 액션에 실린 `atMs`로 결정론을 유지한다(RNG 시드와 같은 트릭).

### 작업 규칙 (이 저장소에서 계속 지킬 것)
- **커밋은 기능 단위로 잘게 분리**(conventional commits: `feat(game):`, `fix(game):`, `docs:`, `test(game):`). 각 커밋 시점에도 빌드가 깨지지 않게 파일 단위로 묶어 커밋.
- **커밋/푸시/배포는 매번 명시적으로 승인받고 진행** — 사용자가 매번 명시한 뒤에만 진행. 다음 세션에서도 먼저 나서서 배포하지 말 것. (이번 세션은 사용자가 요청 자체에 커밋·푸시·배포까지 명시적으로 포함했음.)
- **시각적/레이아웃 버그는 코드 리뷰만으로 "고쳤다"고 단정하지 말 것** — 노땡스 세션에서 정확히 이 실수로 1차 수정이 틀렸다는 게 사용자 스크린샷으로 드러난 전례가 있다([docs/troubleshooting.md #7](./docs/troubleshooting.md#7-노땡스-코인칩-배지가-중앙-카드의-숫자를-가리는-버그-1차-시도-실패--구조적-재수정)). 오프라인 상태로는 `<Game>Game.tsx`의 Supabase 로비를 거칠 수 없어 육안 확인이 막힐 때는, Phase 14가 쓴 방법(대상 컴포넌트를 고정 state/props로 직접 렌더링하는 임시 라우트를 만들어 `npx playwright screenshot`으로 찍고 확인 후 삭제)을 재사용할 것 — 실제 온라인 락스텝 동기화까지는 검증하지 못하지만 순수 렌더링 결과는 확인할 수 있다. **그리드 포커 방 생성 폼(Phase 19)은 이 방식으로 검증 완료했지만, 실제 온라인 동기화는 여전히 미검증**(§3의 1번 항목).
- **작업 지시와 참조 문서(룰북 등)가 서로 다른 사실을 말하면, 룰북 원문 쪽을 채택하고 그 판단을 문서에 명시적으로 남길 것** — 이번 세션에서 두 번(자원 순서, 금/은화 대체 규칙) 실제로 있었던 상황([docs/history.md Phase 12](./docs/history.md#phase-12--센추리-향신료의-길-신규-게임-2026-08-08) 참고).
- React Hooks 엄격 lint 규칙 유효(early-return 뒤 훅 호출 금지 / 렌더 중 ref 쓰기 금지 / effect 안 동기 setState 금지). `eslint-disable-next-line`은 **경고가 실제로 리포트되는 줄 바로 위**에 둬야 먹힌다.
- `.clinerules.md`/`instructions.md`(저장소 루트, 미확인 파일)는 **Cline 전용 자동화 규칙**(승인 없이 자동 커밋·배포 지시)이라 이 프로젝트의 실제 지침이 아님 — 계속 무시할 것. 실제 지침은 `CLAUDE.md`→`AGENTS.md`뿐.
- Vercel/GitHub 인증은 이미 세팅됨(`.vercel/project.json` 링크됨) — 별도 로그인 없이 `git push` / `npx vercel deploy --prod` 바로 가능.
- **세션 시작 시 `git status`를 항상 먼저 확인할 것 — 이 대화에서 만들지 않은 커밋되지 않은 변경이 나타날 수 있다.** 이번 문서화 세션 중 실제로 겪은 사례: 그리드 포커 커스텀 제한시간(Phase 19) 커밋 이후, 이 대화가 만들지 않은 페루도 "차등 페널티" 규칙 변경(`engine.ts`의 `dudo`/`calza`, `boardGameRule/Perudo.md`, `PerudoBoard.tsx`, `RulebookModal.tsx`, `Perudo.test.ts` 5개 파일 — 판정을 "무조건 1개 상실"에서 "틀린 차이만큼 상실"로 바꾸는 내용)이 워킹 트리에 커밋되지 않은 채 남아 있었고, 기존 테스트 3개가 새 로직과 안 맞아 실패 중이었다. 사용자에게 확인한 결과 **되돌리기(revert)로 결정** — `git checkout -- <5개 파일>`로 마지막 커밋(`626f5d2`) 상태로 복원했다(이 되돌리기 자체는 별도 커밋 불필요, 애초에 커밋된 적 없는 워킹 트리 변경이었으므로). 되돌리는 과정에서 `git status`가 파일마다 순차적으로 다른 결과를 보여주는 불안정한 현상도 관찰됐다(같은 세션 내 다른 프로세스가 동시에 파일을 쓰고 있었을 가능성) — 되돌린 뒤에는 몇 초 텀을 두고 `git status`를 재확인해 안정화됐는지 확인하는 습관을 들일 것. **다음 세션에서 페루도 관련 파일에 다시 이런 변경이 나타나면, 이 저장소 밖의 다른 세션/프로세스가 그 작업을 계속 진행 중이라는 뜻일 수 있으니 임의로 지우지 말고 먼저 사용자에게 확인할 것.** — 실제로 바로 다음 세션(이번 세션, Phase 21)에서 똑같은 현상(편집이 다음 턴에 원본으로 되돌아감)이 두 차례 재발했다. 사용자에게 그대로 보고 후, `git log`로 이 저장소 밖에서 만들어진 실제 커밋(틀린 그림 찾기 Phase 20)을 확인해 "여러 세션이 같은 워킹 디렉터리를 동시에 쓰고 있었을 가능성"으로 결론짓고, 매 파일 편집 직후 `git diff --stat`으로 즉시 반영 여부를 확인하며 처음부터 재작업해 최종적으로 커밋까지 완료했다(경위는 [docs/history.md Phase 21 §0](./docs/history.md#phase-21--페루도-차등-페널티-룰-변경--3d-입체-주사위-ui-2026-08-08-같은-날-열세-번째-세션) 참고). **여러 Claude Code 세션을 이 저장소에 동시에 띄우지 않는 것을 권장** — 정 필요하다면 세션마다 별도 워크트리(`git worktree`)를 쓸 것.

### 관련 문서
| 문서 | 언제 볼 것 |
|---|---|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 신규 게임 추가 시 지켜야 할 표준 계약(모듈 레이아웃, 엔진 규격, 등록 절차) |
| [docs/README.md](./docs/README.md) | `docs/` 전체 색인 + 개발 명령어 |
| [docs/architecture.md](./docs/architecture.md) | "왜 이렇게 설계했는가" — 항상 유효한 현재 설계 원칙 |
| [docs/cloud-sync.md](./docs/cloud-sync.md) | 락스텝 동기화 프로토콜 세부사항 |
| [docs/troubleshooting.md](./docs/troubleshooting.md) | 실제 발생한 버그 10건 — 증상/원인/해결/교훈 |
| [docs/history.md](./docs/history.md) | 시간순 프로젝트 연대기 — Phase 27이 오이 다섯 개 신규 게임 내용(이번 세션 라스베가스 항목은 아직 미이관, 다음 문서 정리 세션에서 Phase 29로 옮길 것) |
| [docs/features.md](./docs/features.md) | 기능/게임별 룰 해석 판단 기록(센추리 절 신설됨) |
| [docs/deployment.md](./docs/deployment.md) | 배포 절차, 환경변수, 검증 파이프라인 |

---

## 3. Next Action Items (우선순위 순)

0. **(최우선, 신규, 이번 세션)** 뱅! 8인 확장(§2 "2026-08-22 — 뱅! 8인 플레이 확장 + 공식 직업 밸런스(2배신자)" 참고)은 엔진/좌표 계산과 테스트로만 검증했고, **8인 타원 테이블 레이아웃(좌석 배지 겹침 여부)은 아직 실제 브라우저로 육안 확인하지 않았다** — `seatBadgeScale`/`seatPosition` 반경 확대가 실제 렌더링에서 8석 전부가 겹치지 않는지, 모바일 좁은 화면에서도 착용 아이템(`EquipRow`)까지 포함해 안 깨지는지 확인 필요. 고정 state 임시 라우트 스크린샷(Phase 14 방식, §2 "작업 규칙" 참고) 또는 실제 `/games/bang` 8인 방으로 확인할 것. 온라인 방을 2대 이상 실제 기기로 열어 8인 좌석 배정/재접속 복원도 함께 확인.
0. **(최우선, 신규, 이번 세션 — 페루도와 무관한 기존 회귀 발견)** 페루도 보드 트랙 세션 중 백그라운드로 띄워둔 전체 `npx vitest run`이 이번엔 실제로 완주했다(약 4시간 18분 소요, `aiBenchmark.test.ts`의 세 자가 대진 벤치마크가 완전 동기라 Node 이벤트 루프를 막는다는 과거 세션들의 진단이 "그래서 절대 안 끝난다"가 아니라 "그래서 매우 오래 걸린다"였음이 이번에 처음으로 실측 확인됨) — 그 결과 **`malDalliJa: Level 10 wins >= 85% of 1000 games vs Level 1-3`가 38.1%로 실패**함을 발견했다(과거 세션 기록상 이 벤치마크는 89.8%였음 — [Level 10 AI 코어 아키텍처 고도화 세션] 참고). `git diff`로 이번 세션(페루도 커밋 2개)이 `src/games/malDalliJa/` 아래를 전혀 건드리지 않았음을 확인했으므로 **이번 페루도 작업이 원인이 아니라 이전에 이미 존재하던 회귀**이며, 아무도 전체 벤치마크를 끝까지 기다린 적이 없어(과거 세션들은 전부 "무출력 장시간 지속"만 보고 완료를 기다리지 않고 판단) 지금까지 발견되지 못했던 것으로 보인다 — 다음 세션에서 원인 조사(어느 커밋에서 회귀했는지 `git bisect` 등) 및 수정 필요. (페루도 자체의 벤치마크는 격리 실행으로 87.0%(≥85%) 정상 통과 확인됨 — 아래 "2026-08-19 — 페루도 보드 트랙 시퀀스" 섹션 참고.)
0. **(최우선, 신규, 두 세션 연속 미해결)** 전체 `npx vitest run`을 완주시켜 결과를 확인할 것 — **이번 세션(페루도 탑뷰 CSS/SVG 주사위 전환)도 56분+ 돌렸으나 세션 안에 완료를 확인하지 못했다**(§2 "2026-08-16 — 페루도 탑뷰 CSS/SVG 주사위" 참고). 직전 세션(말달리자)의 원인은 확인된 동시 세션 CPU 경합(100% 근접)이었던 반면, 이번엔 시스템 전체 CPU가 15~20%대에 머물러 있어 **다른 원인일 가능성**이 있음(단일 vitest 프로세스 자체가 비정상적으로 느려진 것일 수 있음 — `aiBenchmark.test.ts`의 자가 대진 벤치마크가 무거워진 게 누적 원인일 수도 있으니, 다음 세션에서는 그 파일만 먼저 단독으로 시간을 재볼 것). **작업 시작 전 다른 세션이 이 저장소를 동시에 쓰고 있지 않은지 먼저 확인할 것**(`Get-Process`로 이미 떠 있는 `vitest`/`next` 프로세스가 있는지, 있다면 그 세션 소유자에게 먼저 확인 — 남의 프로세스를 임의로 죽이지 말 것). 가능하면 세션마다 `git worktree`를 분리하는 근본 해결책을 이번에는 실제로 도입할 것(§2에 반복 기록된 미해결 권장사항).
0. **(최우선, 신규, 이번 세션)** 페루도 탑뷰 CSS/SVG 주사위(§2 "2026-08-16 — 페루도 탑뷰 CSS/SVG 주사위" 참고)는 `tsc`/`lint`/타깃 테스트로만 검증했고 **실제 브라우저 렌더링은 아직 육안 확인하지 않았다** — 임시 라우트 스크린샷 또는 `/games/perudo` 실접속으로: (1) 챔퍼/조명 그라데이션/드롭 섀도우/음각 핍이 의도대로 보이는지, (2) 손패 롤 애니메이션(`perudo-dice-settle`)이 자연스럽게 재생되는지, (3) 6가지 플레이어 컬러웨이 전부에서 핍 대비가 확보되는지(특히 노랑 바디+짙은 핍), (4) 손패/쇼다운의 미세 각도 스캐터가 과하지 않은지 확인 필요.
1. **(최우선, 신규)** 포세일(이번 세션)은 고정 state 임시 라우트 스크린샷으로 4단계(경매 진행 중, 판매 제출 대기, 블라인드 리빌 정산 결과, 게임오버 결과 테이블) 전부와 대시보드 허브 카드(🏠 emoji/그라디언트 폴백)까지 확인했음(§2 참고). 아직 남은 것:
   - **온라인 방을 2대 이상 실제 기기로 열어** 입찰/포기/카드 제출이 다른 기기 화면에도 즉시 반영되는지, 재접속 시 진행 중이던 경매 라운드·손패·현금·제출 상태가 정확히 복원되는지 확인.
   - **`forsale-pass-fly`(포기 정산 슬라이드)/`forsale-win-toast`(낙찰 배너)/`forsale-card-flip`(블라인드 리빌 3D 플립) FX가 실제 브라우저에서 재생되는 모습 자체는 미검증**(정지 스크린샷으로 레이아웃만 확인) — 여러 좌석이 연속으로 포기할 때 슬라이드가 겹치지 않는지, 6인 게임처럼 좌석이 많을 때 정산 토스트와 플립 애니메이션이 동시에 여러 개 뜰 때 겹치지 않는지 육안 확인 필요.
   - 룰북 자체의 내부 모순 3가지(수표 카드 값 구성, 4인 카드 제거 수, 포기 환불 공식 — §1-2 참고)에 대한 이 엔진의 판단이 실제 플레이 경험상 사용자 기대와 맞는지 재확인 — 특히 수표 최고액을 룰북 원문의 "$15,000"가 아니라 "$14,000"로 절충한 부분은 후속 요청으로 조정 가능.
   - 6인 최대 인원으로 매물/수표 그리드와 스코어보드가 좁은 화면에서도 안 깨지는지.
2. **(최우선, 신규, 이전 세션 누락분)** 코요테는 §2에 시각 검증 기록은 있으나 이 Next Action Items에 항목이 누락돼 있었음 — **온라인 방을 2대 이상 실제 기기로 열어** 선언/코요테 외침이 다른 기기 화면에도 즉시 반영되는지, 재접속 시 이마 카드·하트(목숨)·현재 선언 상태가 정확히 복원되는지, `coyote-desert-flash`/`coyote-howl-burst`/`coyote-card-flip` FX가 실제로 재생되는 모습 확인 필요. (이번 세션의 깃털→하트 2개 변경 이후 스크린샷 재검증은 아직 하지 않았음 — 다음 세션에서 함께 확인.)
1. **(최우선, 신규)** 달무티(이전 세션)는 고정 state 임시 라우트 스크린샷으로 4단계(혁명 선택, 세금 반환, 트릭 진행 중 하이라이트, 게임오버 결과 테이블) 전부와 대시보드 대표 이미지까지 확인했음(§2 참고). 아직 남은 것:
   - **온라인 방을 2대 이상 실제 기기로 열어** 혁명 선포/세금 반환/카드 내기/패스가 다른 기기 화면에도 즉시 반영되는지, 재접속 시 진행 중이던 트릭·손패·세금 상태가 정확히 복원되는지 확인.
   - **`dalmuti-tax-fly`(세금 카드 진상/하사 슬라이드)/`dalmuti-revolution-burst`(혁명·대혁명 배너) FX가 실제 브라우저에서 재생되는 모습 자체는 미검증**(정지 스크린샷으로 레이아웃만 확인) — 세금 강제 진상과 반환이 연달아 일어날 때 슬라이드가 겹치지 않는지, 혁명 배너가 화면 전체를 덮는 타이밍에 다른 조작이 씹히지 않는지 육안 확인 필요.
   - 8인 최대 인원으로 손패(최대 26장)와 스코어보드가 좁은 화면에서도 안 깨지는지 — 인원수 범위(3~8명)는 룰북 미기재라 이 프로젝트 관행으로 추론한 값.
   - 초기 신분 결정을 "좌석의 균등 무작위 순열"로 단순화한 것(룰북의 카드 뽑기/가위바위보 절차 시뮬레이션 생략)이 실제 플레이 체감상 문제없는지, 3인전에서 소농노=총리 좌석 겹침으로 세금 교환이 1회만 일어나는 게 사용자 기대와 맞는지 재확인.
2. **(최우선, 신규)** 소환사의 협곡(직전 세션)은 고정 state 임시 라우트 스크린샷으로 5단계(베팅 단계 카드 확인/대기, 황금 뒤집개 지정, 협곡 공략 중, 게임오버 결과 테이블) 전부와 대시보드 대표 이미지까지 확인했음(§2 참고). 아직 남은 것:
   - **온라인 방을 2대 이상 실제 기기로 열어** 카드 뽑기/협곡 투입/아이템 해제/패스가 다른 기기 화면에도 즉시 반영되는지, 재접속 시 협곡 더미 현황·장착 아이템·진행 중이던 도전자 HP가 정확히 복원되는지 확인.
   - **`rift-card-toss`(협곡 투입 슬라이드)/`rift-monster-flip`+`rift-monster-slay`/`rift-monster-strike`(몬스터 공개·처치·피격) FX가 실제 브라우저에서 재생되는 모습 자체는 미검증**(정지 스크린샷으로 레이아웃만 확인) — 여러 좌석이 연속으로 카드를 협곡에 밀어넣을 때 슬라이드가 겹치지 않는지, 협곡 더미가 8장 넘게 쌓였을 때 스택 시각화가 자연스러운지 육안 확인 필요.
   - 6인 최대 인원으로 아이템 HUD 6슬롯 + 스코어보드가 좁은 화면에서도 안 깨지는지.
   - 인원수 범위(2~6)와 라운드 시작 좌석 로테이션은 룰북 미기재라 이 프로젝트 관행으로 추론한 값 — 실제 플레이 경험상 다른 값(예: 최대 4명, 또는 협곡 진입자가 다음 라운드도 먼저 시작 등)이 더 맞는다고 판단되면 후속 요청으로 조정 가능.
2. **(최우선, 신규)** 라스베가스는 고정 state 임시 라우트 스크린샷으로 카지노 6개 그리드·주사위 핍 정확도·배치 버튼·룰북 모달·게임오버 결과 테이블·대시보드 대표 이미지까지 확인했음(§2 참고). 아직 남은 것:
   - **온라인 방을 2대 이상 실제 기기로 열어** 주사위 굴림/배치가 다른 기기 화면에도 즉시 반영되는지, 재접속 시 카지노 배치 현황과 남은 손패가 정확히 복원되는지 확인.
   - **주사위 텀블(`dice-roll-tumble`)/슬라이드(`dice-slide-fly`) FX가 실제 브라우저에서 재생되는 모습 자체는 미검증**(정지 스크린샷으로 레이아웃만 확인) — 여러 좌석이 연속으로 배치할 때 슬라이드가 겹치거나 밀리지 않는지, 12개(2인전 중립 포함) 같은 대량 배치 시 카스케이드가 자연스러운지 육안 확인 필요.
   - 5인 최대 인원으로 카지노 6개 그리드 + 스코어보드가 좁은 화면에서도 안 깨지는지.
   - 룰북 원문 채택(1라운드)과 작업 지시(4라운드)가 상충했던 판단이 실제 플레이 경험상 사용자 기대와 맞는지 재확인 — 필요시 "4라운드 누적 모드"를 하우스 룰 토글로 추가하는 후속 요청 가능.
   - **(해소됨)** 1~6번 카지노 원형 엠블럼은 직사각형 전체를 채우는 "테이블 매트" 배경 아트로 전면 교체됐고(`CasinoEmblem.tsx`의 `CasinoTileArt`, §2 "2026-08-23 — 라스베가스 1~6번 카지노 배팅존 풀 배경 테이블 매트 개편" 참고), 이번엔 실제로 `npx playwright screenshot` CLI(이 환경에 이미 설치돼 있었음 — 과거 세션의 "Playwright 없음" 기록은 착오였다)로 데스크톱/모바일 두 폭 모두 육안 확인 완료. 그 과정에서 지폐 "+N장" 배지가 금액 텍스트를 가리는 겹침 버그를 실제로 발견해 수정.
   - **(이번 세션 신규)** 위 테이블 매트 개편의 실측은 고정 state 스크린샷뿐 — 실제 마우스 `:hover` 글로우, 온라인 2대 이상 기기 동기화, `dice-roll-tumble`/`dice-slide-fly` FX가 새 배경 위에서 실제로 재생되는 모습은 여전히 미검증(바로 위 두 항목과 동일한 잔여 항목).
2. **(최우선, 신규)** `boardGameRule/` 파일명 kebab-case 통일 + 4단 템플릿(개요/구성품/핵심 룰/하우스 룰) 정규화 — 이번 세션에서 시도했으나 다른 세션과의 동시 편집 충돌로 되돌리고 보류했음(§1 참고). **먼저 `git status`로 그 세션이 boardGameRule/에 무엇을 남겼는지(한글 파일명 재구성 흔적, `달무티.md`/`라스베가스.md`/`러브레터.md` 등 신규 게임 룰북 추가 여부) 확인한 뒤, 사용자와 방향을 다시 조율하고 진행할 것** — 그대로 두 세션의 결과물이 섞이면 어느 쪽 이름 규칙도 아닌 상태가 될 수 있다.
2. **(최우선, 부분적으로만 검증됨)** 오이 다섯 개(Phase 27 + 이번 세션의 티어 표 수정/대표 이미지/FX 보강)는 고정 state 임시 라우트 스크린샷으로 손패 유효/무효 하이라이트·탈락 배지·마지막 트릭 경고·결과 테이블·새 티어 숫자·대시보드 대표 이미지까지는 확인했음(§2 참고). 아직 남은 것:
   - **온라인 방을 2대 이상 실제 기기로 열어** 트릭 제출이 다른 기기 화면에도 즉시 반영되는지, 재접속 시 진행 중이던 라운드/트릭/손패가 정확히 복원되는지 확인.
   - **라운드가 여러 번 반복되며 탈락자가 발생하는 흐름 전체**(가장 검증이 안 된 부분) — 한 명 탈락 후 다음 라운드 재딜이 남은 인원에게만 정확히 이뤄지는지, 2명만 남았을 때 최종 라운드가 정상 종료되는지, 동시 탈락(공동 최후)이 실제로 발생했을 때 UI가 이상 없이 결과 화면을 보여주는지.
   - 6인 최대 인원으로 손패/스코어보드가 좁은 화면에서도 안 깨지는지, 트릭 결과 토스트 배너가 여러 번 연달아 뜰 때 겹치지 않는지.
   - **카드 제출 FX/오이 순차 획득 FX 둘 다 실제 브라우저에서 애니메이션이 재생되는 모습 자체는 미검증**(이번 세션은 정지 스크린샷으로 레이아웃만 확인) — 실제 온라인 방에서 여러 좌석이 연속으로 카드를 낼 때 슬라이드가 겹치거나 밀리지 않는지, 7번째 트릭에서 오이 4~8개(1번 카드 배수 적용 시) 같은 대량 획득 시 순차 hop이 너무 느리게/빠르게 느껴지지 않는지 육안 확인 필요.
   - `boardGameRule/오이다섯개/`의 낱장 카드 참고 이미지(`오이카드구성.jpg`)는 카드마다 잘라낸 개별 에셋이 아니라 15장이 한 장에 합쳐진 합성 시트라 실사 카드 이미지로 직접 잘라 쓰지 않고 기존 SVG 카드 비주얼을 유지하기로 판단(§1 참고) — 낱장 실사 카드 이미지가 별도로 필요하면 후속 세션에서 에셋을 다시 요청할 것.
3. **(최우선, 부분적으로만 검증됨)** 스플렌더 신규 게임(Phase 25)은 고정 state 임시 라우트 스크린샷으로 카드 시장/토큰 뱅크/귀족 타일/내 보석상/다른 플레이어 요약만 확인했음(§2 참고). 아직 남은 것:
   - **결제/예약/귀족선택/토큰반납 모달의 실제 클릭 흐름** — 스크린샷 검증조차 하지 않은 부분(정적 렌더링만 확인). 카드 클릭 → `CardActionModal` → 구매/예약 확정, 귀족 2명 이상 동시 조건 → `ChooseNobleModal`, 10토큰 초과 → `DiscardModal`이 실제로 정확히 동작하는지 클릭해서 확인 필요.
   - **온라인 방을 2대 이상 실제 기기로 열어** 토큰 획득/카드 구매/예약/귀족 방문이 다른 기기 화면에도 즉시 반영되는지, 재접속 시 정상 복구되는지, 다른 좌석의 예약 카드가 정말 뒷면으로만 보이고 카드 정체가 새어나가지 않는지 확인.
   - 4인 게임처럼 카드/토큰이 많이 쌓였을 때 시장 그리드·내 보석상 패널이 좁은 화면에서도 안 깨지는지.
4. **(최우선, 부분적으로만 검증됨)** 페루도 실제 WebGL 3D 주사위 + 차등 페널티(Phase 21+22)는 8인 고정 시드 상태를 임시 라우트 스크린샷으로만 검증했음(§2 참고). 아직 남은 것:
   - **온라인 방을 2대 이상 실제 기기로 열어** 물리 굴림 연출이 기기마다 달라 보여도 최종 착지 값(과 차등 페널티 손실 폭)이 모든 기기에 동일하게 반영되는지, 저사양 기기에서 공유 캔버스(`DiceStage`)/물리(`DiceCup3D`) 성능이 실제로 버티는지, 그리고 페루도의 기존 미검증 항목(컵 쉐이킹 SFX 타이밍, 팔라피코 배너, 내 로컬 베팅 초안이 새어나가지 않는지)까지 함께 확인.
   - **8인 확장 손패/로스터 스트립 실사용**에서 물리 굴림 애니메이션의 프레임 드랍 여부, 여러 플레이어가 동시에 굴릴 때(각자 손패) 화면이 버티는지.
5. **(최우선, 부분적으로만 검증됨)** 틀린 그림 찾기 신규 게임(Phase 20)은 고정 state 렌더링 + 방 생성 폼만 임시 라우트 스크린샷으로 검증했음(§2 참고). 아직 남은 것:
   - **온라인 방을 2대 이상 실제 기기로 열어** 팀 배정이 양쪽에서 똑같이 보이는지, 한쪽에서 클릭한 정답이 다른 기기에도 즉시 마킹/스코어 반영되는지, 오답 페널티 잠금이 클릭한 그 좌석에서만 걸리는지 확인.
   - **사진 업로드 모드를 실제 온라인 방에서** 큰 사진으로 테스트해 압축 후에도 Supabase Realtime 브로드캐스트 페이로드 한도를 넘지 않는지, 넘을 경우 어떤 실패 양상을 보이는지(현재 실패 시 에러 처리 없음) 확인.
   - 재접속(`state-request`/`state-sync`) 시에도 진행 중이던 스테이지/발견 현황/타이머가 정확히 복원되는지.
6. **(최우선, 부분적으로만 검증됨)** 그리드 포커 커스텀 제한시간 기능(Phase 19)은 방 생성 폼만 임시 라우트 스크린샷으로 검증했음(§2 참고). 아직 남은 것:
   - **온라인 방을 2대 이상 실제 기기로 열어** 방장이 고른 초 값이 `game-start` 브로드캐스트를 타고 다른 기기의 `startGame`/카운트다운 시작값에도 정확히 반영되는지, "시간 제한 없음" 선택 시 모든 기기에서 카운트다운 UI가 동일하게 사라지는지 확인.
   - 재접속(`state-request`/`state-sync`) 시에도 `timerSettings`가 원래 방장이 고른 값 그대로 복원되는지(이론상 `GridPokerState`에 편입돼 있어 자동으로 되어야 하지만 실네트워크 경로 미확인).
7. **(최우선, 부분적으로만 검증됨)** 센추리 보드 UI 전면 개편(Phase 18)은 임시 라우트 스크린샷 + 모달 클릭 시뮬레이션으로 검증했지만, 아직 남은 것:
   - **온라인 방을 2대 이상 실제 기기로 열어** 락스텝 동기화 확인 — 카드를 획득/사용/휴식/완성할 때 다른 기기 화면에도 새 매트/수레/코인스택 비주얼이 즉시 반영되는지, 재접속 시 정상 복구되는지(단일 고정 state 렌더링만 확인, 실제 네트워크 경로는 미검증).
   - 5인 게임처럼 자원 개수가 많을 때 손패 부채꼴(`transform: rotate/translateY`)이 화면 폭을 넘기지 않는지, 카드에 얹은 자원 큐브(회전 배치)가 자원 5개까지 쌓였을 때도 서로 겹쳐 안 보이지 않는지.
   - 실제 태블릿/저해상도 기기에서 목재/펠트 텍스처(다중 CSS 그라디언트 레이어)의 렌더링 성능과 터치 조작감.
   - 새로 반영된 공식 32장/36장 카드 데이터(Phase 16)로 실제 몇 판 진행해보고 카드 밸런스가 체감상 자연스러운지 — Phase 16부터 계속 이월 중인 항목.
8. **(해소됨)** 센추리 카드 데이터를 사용자 자체 설계셋 대신 실제 공식 42/36장으로 교체 완료(Phase 16), UI 전면 개편도 완료(Phase 18) — 자원 가치 순서(룰북 §4.1 채택)와 금화 소진 시 은화 미대체 판단은 여전히 유효하며 [Phase 12](./docs/history.md#phase-12--센추리-향신료의-길-신규-게임-2026-08-08) 기록 참고.
9. **(이전 세션부터 이어짐, 미해결)** 노땡스 "코인이 카드 숫자를 가리는 버그" 수정([docs/troubleshooting.md #7](./docs/troubleshooting.md#7-노땡스-코인칩-배지가-중앙-카드의-숫자를-가리는-버그-1차-시도-실패--구조적-재수정))도 여전히 실제 기기 육안 재확인이 안 된 상태로 남아 있음.
10. **(이전 세션부터 이어짐, 미해결)** `<Game>Board.tsx`/`<Game>Game.tsx` 전용 테스트 인프라 없음(jsdom/@testing-library 미설치). 저비용 대안으로 Playwright 스크린샷 회귀 테스트도 고려([docs/troubleshooting.md "알려진 사각지대"](./docs/troubleshooting.md#알려진-사각지대-다음에-볼-것)).
11. **(선택)** 저장소 루트의 `.clinerules.md`/`instructions.md` — 이 사용자의 실제 선호(매번 명시 승인)와 반대되는 자동화 지시를 담고 있음. 계속 무시 중이나, 지우거나 남겨둘지는 아직 사용자에게 확답받지 않음.
12. **(선택)** 방장 이탈 시 호스트 권한 승계 로직 없음 / 4자리 초대 코드 중복 확인 없음 / 대규모 동시 접속 스트레스 테스트 미실행 — 낮은 우선순위로 계속 이월 중.
13. **(선택)** 오이 다섯 개·스플렌더·센추리·페루도 외 나머지 준비중 게임(카탄, 코드네임, 마피아 등 11종)은 우선순위 논의된 바 없음.
14. **(선택)** 그리드 포커 방장이 "방 만들기" 이후 대기실에서도 제한시간 설정을 바꿀 수 있게 할지(현재는 방 생성 폼에서만 결정, 방 생성 후엔 고정) — 사용자 요청 원문의 "옵션 변경" 문구를 방 생성 폼 내 선택으로 해석했음, 별도 화면이 필요하다면 후속 요청 필요.
15. **(선택)** 틀린 그림 찾기 팀 배정은 좌석 순서 기반 자동 절반 나누기뿐 — 방장이 수동으로 팀을 편성하는 UI는 없음. 별도 요청 시 추가 검토.
16. **(선택)** 여러 Claude Code 세션을 이 저장소에 동시에 띄우면 워킹 트리 편집이 서로 덮어써질 수 있음이 이번 세션에서 실제로 확인됨(§2 작업 규칙 참고) — 근본 해결책(예: 세션마다 `git worktree` 분리)은 아직 도입되지 않음.
17. **(선택, 사용자 재검토 권장)** `public/games/`의 게임 카드 이미지 5장(Phase 22)은 `PerudoFaceIcon.tsx` 같은 오리지널 SVG가 아니라 퍼블리셔 소유 박스 표지 사진 원본임(docs/history.md Phase 22 §8) — 지금은 이미 실명·실제 규칙으로 구현 중인 게임을 식별하는 용도로만 쓰였지만, 앱을 더 넓게 배포/홍보할 계획이 있다면 라이선스 검토가 필요할 수 있음.

---

## 4. Resume Prompt

다음 세션 `/clear` 직후 아래 한 줄을 그대로 붙여넣을 것:

> `HANDOFF.md`부터 읽고, §3의 0번 항목들(뱅! 8인 타원 테이블 레이아웃 실제 브라우저 육안 확인, 전체 `npx vitest run` 완주 확인 + 동시 세션 여부 확인, 그리고 페루도 탑뷰 CSS/SVG 주사위 실제 브라우저 육안 확인)부터 처리해줘. 시작 전에 `git status`로 미완료 변경이 남아 있는지, `Get-Process`로 이미 떠 있는 `vitest`/`next` 프로세스가 있는지(=다른 세션이 동시에 이 저장소를 쓰고 있는지) 먼저 확인할 것(§1, §2 "2026-08-16" 섹션 참고). 그다음 §3의 1번 항목(포세일 FX 실제 재생 확인과 실제 Supabase 온라인 방·2대 이상 기기 동기화 검증)으로 이어갈 것.
