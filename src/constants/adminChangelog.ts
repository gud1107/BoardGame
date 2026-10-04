/**
 * Admin-only changes (관리자 허브, 방문자 페이지, 통계, 알림 등) that site
 * visitors never see. They live here instead of `PATCH_NOTES` so the public
 * `/patch-notes` page stays about games and player-facing features — split
 * out on 2026-10-04 at the user's request. Rendered by the 🗒 변경 기록 tab
 * of `/admin/games`. Newest first; dates match the git commit date.
 *
 * Hand-written rows (Korean, curated) live in `ADMIN_CHANGELOG` below.
 * Commits with an admin scope — feat(admin), fix(visitors), tune(analytics) —
 * are picked up automatically into `adminChangelog.generated.ts` by
 * `scripts/gen-admin-changelog.mjs` (runs on every build), so nobody has to
 * remember to add a row; curate one here only when a summary helps.
 *
 * `patchNotes.test.ts` fails when a public patch note mentions 관리자, so
 * anything admin-only goes here.
 */
export interface AdminChangelogEntry {
  /** ISO date the change shipped, e.g. "2026-10-02". */
  date: string;
  type: "FEAT" | "FIX" | "IMPROVE";
  desc: string;
}

/** One auto-collected commit (subject text, English). */
export interface AdminCommitEntry {
  hash: string;
  date: string;
  type: AdminChangelogEntry["type"];
  scope: string;
  desc: string;
}

export const ADMIN_CHANGELOG: AdminChangelogEntry[] = [
  {
    date: "2026-10-02",
    type: "FEAT",
    desc: "월별 통계 탭, 자주 오는 IP 이름 붙이기(IP 관리 탭), 이름 붙인 사람 재방문·게임 시작 휴대폰 알림(ntfy), '보기 대상' 필터(이름 붙인 IP만 / 한 사람만)와 '이름 붙인 IP 제외'",
  },
  {
    date: "2026-10-02",
    type: "FEAT",
    desc: "클로드 테스트 방문을 버리지 않고 고정 기기 '🤖 클로드'로 기록(기본은 통계에서 제외, 체크박스로 포함), 관리자 로그인 시 /visitors 비밀번호 생략",
  },
  {
    date: "2026-10-02",
    type: "FIX",
    desc: "이름 붙인 사람이 접속만 하고 게임을 안 했을 때 관리자 페이지 전체가 'This page couldn't load'로 죽던 문제 수정, 탭·패널별 에러 경계 추가",
  },
  {
    date: "2026-10-01",
    type: "FEAT",
    desc: "방문자 페이지(/visitors: 누가 왔는지·재방문자), /admin/games 허브(게임별 퍼널·일별 추이·요일×시간 히트맵·이탈 단계·방 기록·유입 경로·버그 게시판·사이트 공지·게임 숨김/준비중/추천 설정·내 기록 제외), 헤더 🛠 관리자 메뉴, 기기 IP 원문 보기, SQL 미적용 경고",
  },
  {
    date: "2026-09-03",
    type: "FEAT",
    desc: "외부 서비스 없이 파일 기반 일간/월간 방문자·게임 플레이 통계 시스템 구축",
  },
  {
    date: "2026-08-27",
    type: "FEAT",
    desc: "최상위 관리자 전용 이용권 킬스위치 추가(기본값 OFF)",
  },
  {
    date: "2026-08-26",
    type: "FEAT",
    desc: "방문자 추적·게임 플레이 지표·관리자 통계 대시보드(/admin/stats) 신규 구축",
  },
  {
    date: "2026-08-13",
    type: "FEAT",
    desc: "관리자 대시보드 1단계 신규 구축",
  },
];
