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
 * remember to add a row; curate one here only when a summary helps. For
 * Korean text on an auto row, end the commit message with an
 * `Admin-Ko: <한국어 요약>` trailer.
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

/** One auto-collected commit. */
export interface AdminCommitEntry {
  hash: string;
  date: string;
  type: AdminChangelogEntry["type"];
  scope: string;
  /** Commit subject after the scope (usually English). */
  desc: string;
  /** Korean summary from the commit's `Admin-Ko:` trailer, when present. */
  ko?: string;
}

/**
 * Korean text for admin commits made before the `Admin-Ko:` trailer
 * convention (2026-10-04). New commits should carry the trailer instead of
 * growing this map.
 */
export const ADMIN_COMMIT_KO: Record<string, string> = {
  "9db267c": "변경 기록 탭에 관리자 커밋 자동 수집, 종류·월·출처 필터 추가, 패치노트 글자 수 제한을 상수로 분리",
  d7105f4: "클로드 테스트 방문을 버리지 않고 '🤖 클로드'로 기록",
  f440881: "모든 통계를 이름 붙인 IP 또는 한 사람만 보도록 하는 '보기 대상' 필터",
  "346276d": "관리자 로그인 상태면 /visitors 페이지 비밀번호 생략",
  a73d738: "이름 붙인 사람이 접속만 하고 게임을 안 했을 때 관리자 페이지가 죽던 문제 수정",
  "23d70a7": "선택한 이름 붙인 IP가 접속·게임 시작하면 휴대폰 알림(ntfy)",
  "67182bd": "이름 붙인 IP 재방문 알림, 통계에서 이름 붙인 IP 제외",
  "840e67e": "자주 오는 IP에 이름 붙이기(IP 관리 탭)",
  fd0f640: "월별 통계 탭",
  a09468b: "admin_suite.sql 미적용 시 경고 표시",
  "4deba2c": "추이·시간대·이탈·방 기록·유입 경로·내 기록 제외·버그·공지·게임 관리 탭",
  "1f01d6a": "기기 IP를 클릭하면 원문 표시, 관리자 본인 IP 기본 표시",
  "7205821": "헤더에 🛠 관리자 메뉴 추가, 로그인 직후 인증 상태 갱신",
  "939787d": "게임별 퍼널 이벤트와 관리자 대시보드, 실제 게임 시작만 플레이 횟수로 집계",
  cf737ac: "/visitors 페이지 — 누가 왔고 누가 다시 왔는지",
  c6fed0c: "자동화 브라우저 플레이를 공개 플레이 횟수에서 제외",
  "151e7b6": "운영 서버 플레이만 집계, 플레이 횟수 SQL 단독 파일 분리",
  "2e6c972": "외부 서비스 없이 파일 기반 일간/월간 방문·플레이 통계",
  "6effc6b": "이용권 킬스위치 기본값을 OFF로 변경",
  "0acb64f": "최상위 관리자 전용 이용권 킬스위치 추가",
  "123e054": "방문자 추적·게임 플레이 지표·관리자 통계 대시보드 구축",
};

export const ADMIN_CHANGELOG: AdminChangelogEntry[] = [
  {
    date: "2026-10-04",
    type: "FEAT",
    desc: "🗒 변경 기록 탭 신설 — 공개 패치노트에서 뺀 관리자 기록 모음, admin·visitors·analytics 커밋을 배포 때마다 자동 수집(커밋 본문의 Admin-Ko 줄로 한국어 표시), 종류·월·출처 필터와 겹치는 기록을 숨기는 기본 보기",
  },
  {
    date: "2026-10-04",
    type: "IMPROVE",
    desc: "공개 패치노트 규칙을 테스트로 고정 — 관리자 항목 금지, 한 줄 120자 제한(PATCH_NOTE_DESC_MAX), 한국어 요약이 없는 관리자 커밋 검출",
  },
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
