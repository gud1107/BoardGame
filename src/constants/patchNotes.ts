import { GAME_REGISTRY } from "@/games/registry";
import type { GameId } from "@/games/types";

/**
 * A change belongs either to one specific game (its `GameId`, e.g.
 * "grid-poker") or to `"common"` for cross-cutting changes (site-wide audio,
 * hub/lobby UI, etc.) that don't map to a single game.
 */
export type PatchNoteGameTag = GameId | "common";

export type PatchNoteChangeType = "FEAT" | "FIX" | "IMPROVE";

export interface PatchNoteChange {
  game: PatchNoteGameTag;
  type: PatchNoteChangeType;
  desc: string;
}

export interface PatchNoteEntry {
  /** SemVer string, e.g. "v1.4.0". */
  version: string;
  /** ISO date the change actually shipped (matches the HANDOFF.md session date / git commit date), e.g. "2026-08-27". */
  releaseDate: string;
  /** One-line headline for the release. */
  title: string;
  changes: PatchNoteChange[];
}

/**
 * Ordered **newest release first** — the `/patch-notes` page renders this
 * array as-is, so any new entry must be unshifted onto the front, not
 * appended.
 *
 * Coverage (confirmed with the user 2026-09-01 via AskUserQuestion): backfilled
 * from the very first commit (2026-08-01) through today, one entry per
 * calendar date that shipped a user-facing change — derived from `git log`
 * (excluding `docs(handoff)`/internal-doc-only commits) and cross-checked
 * against HANDOFF.md for the more recent, more detailed sessions. A single
 * date with zero user-facing commits (2026-08-06, internal docs only) has no
 * entry — the array is not guaranteed to have one row per calendar day.
 *
 * Version bump rule (confirmed with the user 2026-08-27, applied
 * retroactively): a date containing any FEAT → minor (+0.1.0), reset patch to
 * 0; a date with only FIX/IMPROVE → patch (+0.0.1). v1.0.0 is the actual
 * first shipped commit (2026-08-01), not an arbitrary retroactive line —
 * this supersedes the earlier "2026-08-24 as v1.0.0 baseline" decision now
 * that full history is in scope.
 */
export const PATCH_NOTES: PatchNoteEntry[] = [
  {
    version: "v1.33.0",
    releaseDate: "2026-09-09",
    title: "페루도 모바일 보드 재구축, 인게임 패치노트 열람 시 접속 끊김 방지",
    changes: [
      {
        game: "common",
        type: "FEAT",
        desc: "게임 진행 중 패치노트를 열어도 페이지 이동 없이 오버레이 창으로만 표시해 소켓 접속 끊김·강제 퇴장 없이 확인 가능",
      },
      {
        game: "perudo",
        type: "FEAT",
        desc: "모바일 보드를 데스크톱과 동등한 단일 무스크롤 화면으로 전면 재구축",
      },
      {
        game: "perudo",
        type: "FEAT",
        desc: "좌석별 색상 코드 주사위 카운터 추가, 색상 변경 팔레트를 주사위 트레이 바로 아래로 재배치",
      },
      {
        game: "perudo",
        type: "FIX",
        desc: "보드와 주사위 트레이 사이 여백을 압축해 모바일 화면 밀도 개선",
      },
      {
        game: "mal-dalli-ja",
        type: "FIX",
        desc: "애니메이션 멈춤 복구 로직을 모든 이동 동작에 일반화 적용, 고정 좌석 태그 복원",
      },
      {
        game: "common",
        type: "FIX",
        desc: "방장이 이탈 후 재접속해도 AI 봇 턴이 영구 정지되지 않도록 봇 진행 권한을 접속 좌석 기준으로 자동 이양",
      },
    ],
  },
  {
    version: "v1.32.0",
    releaseDate: "2026-09-08",
    title: "코요테 인상 룰 개정, 봇 대타 전 게임 확장, 페루도 모바일 레이아웃 재정비",
    changes: [
      {
        game: "coyote",
        type: "FEAT",
        desc: "첫 선언 음수/0 금지, 라운드당 1인 1회 '+1 인상' 찬스 룰 개정 및 집중 연출 FX 추가",
      },
      {
        game: "coyote",
        type: "FIX",
        desc: "'+1 인상' 찬스가 방 전체가 아닌 좌석별로 개별 적용되도록 수정",
      },
      {
        game: "common",
        type: "FEAT",
        desc: "투표 기반 봇 대타 시스템을 남은 14개 온라인 게임에 확장해 전 28개 게임에 적용",
      },
      {
        game: "worm",
        type: "FEAT",
        desc: "조이스틱을 좌측으로 복귀시키고 부스트 버튼을 우측에 미러 배치, 모바일 GPU 블러 효과 제거",
      },
      {
        game: "worm",
        type: "IMPROVE",
        desc: "스냅샷 간 렌더 보간과 핫루프 좌표 반올림으로 이동 애니메이션 성능 개선",
      },
      {
        game: "perudo",
        type: "FEAT",
        desc: "우측 주사위/색상 레일 배치의 무스크롤 모바일 레이아웃 적용",
      },
      {
        game: "perudo",
        type: "FIX",
        desc: "모바일 물리 배팅 트랙을 복원하고 사이드바를 토글형 드로어로 교체",
      },
      {
        game: "perudo",
        type: "FIX",
        desc: "사각 트랙 중앙 행 높이를 고정해 4면 정렬이 흐트러지지 않도록 수정",
      },
    ],
  },
  {
    version: "v1.31.0",
    releaseDate: "2026-09-07",
    title: "라스베가스 모바일 대시보드 개편, 망각의 지뢰2 즉시 격발 추가",
    changes: [
      {
        game: "las-vegas",
        type: "FEAT",
        desc: "모바일에서 6개 카지노를 한 화면에 담는 무스크롤 컴팩트 대시보드와 원터치 주사위 배정 트레이 도입",
      },
      {
        game: "mine-of-oblivion-2",
        type: "FEAT",
        desc: "시한폭탄을 예약 대기 없이 즉시 터뜨리는 원격 격발 기능과 규칙 안내 UI 추가",
      },
      {
        game: "mine-of-oblivion-2",
        type: "FEAT",
        desc: "모바일 화면을 3단 구성의 무스크롤 레이아웃으로 재구성",
      },
      {
        game: "century",
        type: "IMPROVE",
        desc: "카드/향신료 아트를 인라인 SVG로 전면 개편하고 모바일 전용 컴팩트 대시보드, 카드 탭 미리보기 추가",
      },
      {
        game: "perudo",
        type: "FIX",
        desc: "모바일 사각 배팅 트랙에서 발생하던 가로 스크롤 밀림 현상 제거",
      },
    ],
  },
  {
    version: "v1.30.0",
    releaseDate: "2026-09-06",
    title: "전 게임 MY TURN 알림 배너 및 방 만들기 룰북 열람 연동",
    changes: [
      {
        game: "common",
        type: "FEAT",
        desc: "본인 차례 도래 시 화면 중앙 'MY TURN' 네온 팝업과 Web Audio 차임 사운드를 턴제 게임 전반에 공통 적용",
      },
      {
        game: "common",
        type: "FEAT",
        desc: "전 온라인 게임의 방 만들기 화면에 📖 룰북/게임 규칙 열람 탭+아코디언 추가",
      },
      {
        game: "dalmuti",
        type: "FEAT",
        desc: "패스 시 음성/말풍선을 방 전체 좌석에 브로드캐스트하고 TTS 음소거 버그 수정",
      },
      {
        game: "common",
        type: "IMPROVE",
        desc: "모바일에서 검색어 입력 시 가로 스크롤 캐러셀/쇼케이스를 숨기고 검색 결과를 최상단에 바로 노출",
      },
    ],
  },
  {
    version: "v1.29.0",
    releaseDate: "2026-09-05",
    title: "달무티 카드 이펙트·보이스 자동패스, 지렁이 조작성 개선",
    changes: [
      {
        game: "dalmuti",
        type: "FEAT",
        desc: "카드 출도 시 충격파 이펙트와 화면 흔들림 연출, 브라우저 TTS 기반 '패스!' 음성, 4가지 조건의 스마트 자동 패스 모드 추가",
      },
      {
        game: "worm",
        type: "IMPROVE",
        desc: "가상 조이스틱을 우측 중앙으로 재배치, 마디 길이별 성장 진화 비주얼 및 킬 성공 시 승리 표정 애니메이션 추가",
      },
      {
        game: "lost-cities",
        type: "FEAT",
        desc: "현재 턴 플레이어에게 네온 글로우 테두리와 프로필 강조 효과 추가",
      },
      {
        game: "rat-a-tat-cat",
        type: "IMPROVE",
        desc: "교체된 카드의 본인 손패 공개 시간을 최대 5초로 제한하고 반짝임(shimmer) 효과 적용",
      },
    ],
  },
  {
    version: "v1.28.0",
    releaseDate: "2026-09-04",
    title: "랫어탯캣 확인 시작 시스템 및 페루도 UI 다수 개선",
    changes: [
      {
        game: "rat-a-tat-cat",
        type: "FEAT",
        desc: "게임 시작 시 플레이어가 준비 확인 버튼을 눌러야 초기 카드가 공개·시작되도록 변경, 최초 확인 보장 시간을 5초로 연장",
      },
      {
        game: "rat-a-tat-cat",
        type: "FEAT",
        desc: "실제 플레이 시작 순간 마지막 카드를 3초간 자동 공개, 확인해둔 카드가 대기 중에도 계속 보이도록 유지",
      },
      {
        game: "rat-a-tat-cat",
        type: "FEAT",
        desc: "게임 종료 시 순위별(1등~꼴찌) 카드 공개 정렬 및 순위 뱃지·승리/꼴찌 연출 추가",
      },
      {
        game: "perudo",
        type: "FEAT",
        desc: "내 턴 알림 배너 펄스 연출과 차임 사운드 추가, 수량 20을 넘는 바퀴에서도 기존 30칸 트랙 재사용",
      },
      {
        game: "perudo",
        type: "FIX",
        desc: "상대방 턴 중에도 현재 입찰 마커가 트랙에서 계속 보이도록 수정, 이미 선택된 색상 스와치의 잠금 아이콘 오표시 제거",
      },
      {
        game: "dalmuti",
        type: "IMPROVE",
        desc: "버튼 클릭 반응성 개선 및 동적 리플 클릭 이펙트 추가",
      },
    ],
  },
  {
    version: "v1.27.0",
    releaseDate: "2026-09-03",
    title: "진실의 고개 난이도·히스토리 시스템, 코요테 연출 강화, 대기실 AI 봇 일괄 생성",
    changes: [
      {
        game: "hill-of-truth",
        type: "FEAT",
        desc: "3단계 난이도 시스템, 사진 증거 뷰어, 모순 추론 도구 도입 및 룰북 갱신",
      },
      {
        game: "hill-of-truth",
        type: "FEAT",
        desc: "정답 선언 히스토리 및 오답 사유 자동 분석 복기 탭을 게임 종료 모달에 추가",
      },
      {
        game: "common",
        type: "FEAT",
        desc: "방 만들기·대기실에서 원하는 레벨(1~10Lv)의 AI 봇으로 빈자리를 한 번에 채우는 일괄 생성 기능 추가",
      },
      {
        game: "coyote",
        type: "FEAT",
        desc: "'?' 카드 등장 시 전체화면 팝업 리빌, MAX→0 슬래시 연출, 총합 비교 포뮬러 바 추가",
      },
      {
        game: "coyote",
        type: "IMPROVE",
        desc: "'?' 카드 덱 교체 애니메이션을 3초 통합 유지+스킵 방식으로 정비, 탈락자 아이콘을 해골로 교체하고 사망 연출 추가",
      },
      {
        game: "destiny-war-39",
        type: "FEAT",
        desc: "히든 예측 카드 공개 시점을 게임 종료에서 라운드 종료 시점으로 변경",
      },
      {
        game: "common",
        type: "FEAT",
        desc: "외부 서비스 없이 파일 기반 일간/월간 방문자·게임 플레이 통계 시스템 구축",
      },
      {
        game: "common",
        type: "FIX",
        desc: "관련 없는 이벤트로 연결 끊김 봇 대체 타이머가 리셋되던 문제 수정 및 워치독 추가",
      },
      {
        game: "common",
        type: "IMPROVE",
        desc: "모바일 게임 검색창을 화면 상단에 고정(sticky)",
      },
    ],
  },
  {
    version: "v1.26.0",
    releaseDate: "2026-09-02",
    title: "진실의 고개 신규 추가, 지렁이 맵 확장, 로비 모바일 검색 개편",
    changes: [
      {
        game: "hill-of-truth",
        type: "FEAT",
        desc: "진실의 고개 신규 추가 — 2~8인 멀티플레이 엔진, 10개 확정 시나리오 DB, 라운드로빈+패스 진행 방식, 20초 쿨다운 룰 구현",
      },
      {
        game: "worm",
        type: "FEAT",
        desc: "맵을 1.75배로 확장하고 미니맵/성장 단계 비주얼·1등 왕관 추가, 연결 끊김 봇 대체 시스템을 확장 적용",
      },
      {
        game: "common",
        type: "FEAT",
        desc: "모바일에서 전체 게임 목록이 노출되지 않던 문제 해결 및 태그/설명 기반 실시간 검색 필터 추가",
      },
      {
        game: "dalmuti",
        type: "FIX",
        desc: "5인 귀족↔거지 세금 교환 트랜잭션 버그 조사 및 대형 카드 교환 하이라이트 팝업 추가",
      },
      {
        game: "dalmuti",
        type: "FEAT",
        desc: "개인별 비공개 세금 교환 히스토리 패널(우측) 추가",
      },
      {
        game: "rat-a-tat-cat",
        type: "FIX",
        desc: "스킵 버튼을 눌러도 본인 카드 3초 확인이 보장되도록 수정",
      },
    ],
  },
  {
    version: "v1.25.0",
    releaseDate: "2026-09-01",
    title: "쇼미더코인 동전 공개 규칙 개편, 망각의 지뢰 룰 반전, 러브 윈즈 올 버그 수정",
    changes: [
      {
        game: "show-me-the-coin",
        type: "FEAT",
        desc: "제출된 정확한 동전 개수를 양측에 공개하고, 후공은 선공이 낸 개수의 ±1 범위 안에서만 제출하도록 규칙 변경(동시 제출 → 순차 제출로 전환)",
      },
      {
        game: "mine-of-oblivion",
        type: "FEAT",
        desc: "지뢰 설치를 양측 시작 칸 모두에서 금지하도록 룰 반전, 플레이어 말을 색상별 체스 폰 디자인으로 교체",
      },
      {
        game: "love-wins-all",
        type: "FIX",
        desc: "매우 드문 경로에서 종료 결과창이 영원히 뜨지 않던 버그 수정, 매칭 팟(사이드팟) 정산 룰 구현, 베팅 퀵버튼과 체크·레이즈·선언 액션 연출 추가",
      },
      {
        game: "love-wins-all",
        type: "FIX",
        desc: "기본 모드에서 카드 선택 영역을 클릭할 때마다 카드가 아래로 계속 쌓이던 렌더링 버그 수정",
      },
    ],
  },
  {
    version: "v1.24.0",
    releaseDate: "2026-08-31",
    title: "망각의 지뢰 신규 추가 및 다수 게임 비주얼 전면 개편",
    changes: [
      {
        game: "mine-of-oblivion",
        type: "FEAT",
        desc: "망각의 지뢰 신규 추가 후 즉시 11×11 마인스위퍼 스타일 보물 경쟁전으로 전면 개편",
      },
      {
        game: "show-me-the-coin",
        type: "FEAT",
        desc: "엔진 전면 재작성 및 전 액션 시각효과 구현, 실시간 배팅 뱃지·비공개 칩 환전 HUD·무제한 레이즈 퀵버튼·코인 슬램 FX 추가, 동전과 칩을 분리 표시",
      },
      {
        game: "lost-cities",
        type: "FEAT",
        desc: "비주얼 테마 리뉴얼, 액션 이펙트 및 실시간 원정 점수 HUD 구현",
      },
      {
        game: "love-wins-all",
        type: "FEAT",
        desc: "실시간 족보 조합 표시 및 액션 시각효과 전반 추가",
      },
      {
        game: "rat-a-tat-cat",
        type: "FIX",
        desc: "카드 플립 버그 수정, 획득 연출과 콜(call) 선언 연출 추가, 턴 액션 완료 후 콜 허용하도록 규칙 수정",
      },
      {
        game: "for-sale",
        type: "FIX",
        desc: "저해상도 이미지가 늘어나 깨져 보이던 수표·코인을 선명한 벡터(SVG) 화폐 컴포넌트로 교체",
      },
      {
        game: "show-me-the-coin",
        type: "FIX",
        desc: "상대 배팅 금액이 실시간으로 표시되지 않던 문제 수정",
      },
      {
        game: "lost-cities",
        type: "FIX",
        desc: "AI 봇이 원정을 적극적으로 진행하고 카드 배치를 최적화하도록 의사결정 엔진 개편",
      },
    ],
  },
  {
    version: "v1.23.0",
    releaseDate: "2026-08-30",
    title: "로스트 시티즈·쇼미더코인·랫어탯캣·러브 윈즈 올 신규 추가",
    changes: [
      { game: "lost-cities", type: "FEAT", desc: "로스트 시티즈(Lost Cities) 신규 추가" },
      { game: "show-me-the-coin", type: "FEAT", desc: "쇼미더코인 신규 추가" },
      { game: "rat-a-tat-cat", type: "FEAT", desc: "랫어탯캣 신규 추가" },
      {
        game: "love-wins-all",
        type: "FEAT",
        desc: "러브 윈즈 올 신규 추가(갱신된 룰북 기준 전면 재작성)",
      },
      {
        game: "summoners-rift",
        type: "FEAT",
        desc: "던전 몬스터/카드 리빌을 3~5초 유지 후 스킵 버튼으로 넘기는 방식 도입, HP바 히트 연출·패스 슬램 이펙트 및 상태 표시 추가",
      },
      {
        game: "common",
        type: "FEAT",
        desc: "로비에서 엔터키로 방 즉시 생성/입장 가능, 프로필 기본 아바타를 전 게임 공통 적용",
      },
      {
        game: "five-cucumbers",
        type: "FEAT",
        desc: "트릭 결과를 3초간 유지하고 스킵 버튼 제공",
      },
    ],
  },
  {
    version: "v1.22.0",
    releaseDate: "2026-08-29",
    title: "연결 끊김 봇 대체 시스템 및 내기 정산 장부 개편",
    changes: [
      {
        game: "common",
        type: "FEAT",
        desc: "플레이어 연결 끊김 시 투표 기반으로 봇이 대신 플레이하는 시스템 도입(방 붕괴 방지)",
      },
      {
        game: "common",
        type: "FEAT",
        desc: "슬롯 기반 내기 정산 장부 및 엑셀 스타일 사후 별칭 병합 UI 신규 구현",
      },
      {
        game: "common",
        type: "FEAT",
        desc: "모바일 아래로 스와이프 닫기 제스처, 채팅/배팅 패널 터치 영역 확대, 넷플릭스 스타일 카테고리 가로 스크롤 로비 UI 추가",
      },
      {
        game: "pieces-of-language",
        type: "FEAT",
        desc: "한글 자모 실시간 트래커를 갖춘 직접 텍스트 입력 방식 추가",
      },
      {
        game: "grid-poker",
        type: "FEAT",
        desc: "라운드 채점/결과 연출에 빨리감기 스킵 버튼 추가 및 이펙트 배치 재설계",
      },
      {
        game: "common",
        type: "FEAT",
        desc: "게스트도 비밀번호를 걸어 버그 리포트를 제출할 수 있도록 허용",
      },
      {
        game: "common",
        type: "FIX",
        desc: "로비의 세로로 쪼개져 보이던 텍스트 줄바꿈 및 모바일 타이포그래피 수정",
      },
    ],
  },
  {
    version: "v1.21.0",
    releaseDate: "2026-08-28",
    title: "SFX 공백 보완 및 모바일 이탈 가드 강화",
    changes: [
      { game: "common", type: "FEAT", desc: "6개 게임에 남아있던 액션 SFX 공백을 전부 보완" },
      {
        game: "common",
        type: "FEAT",
        desc: "전 게임 공통 이탈 가드(leave guard) 및 백그라운드 소켓 재연결 안정성 강화",
      },
      {
        game: "common",
        type: "FEAT",
        desc: "버그 리포트에 작성자/관리자 권한 기반 수정·삭제 기능 추가",
      },
      {
        game: "no-thanks",
        type: "FIX",
        desc: "카드/칩 획득 로그가 게임 채팅에 그대로 노출되던 문제 수정",
      },
    ],
  },
  {
    version: "v1.20.0",
    releaseDate: "2026-08-27",
    title: "게임별 BGM/SFX 시스템 및 패치노트 모달 도입",
    changes: [
      {
        game: "common",
        type: "FEAT",
        desc: "게임별 전용 BGM과 액션 SFX 시스템 도입(기본 음소거 모드)",
      },
      {
        game: "common",
        type: "FEAT",
        desc: "헤더에 최신순 패치노트 모달 및 신규 알림 뱃지 추가",
      },
      {
        game: "common",
        type: "FEAT",
        desc: "최상위 관리자 전용 이용권 킬스위치 추가(기본값 OFF로 설정)",
      },
      {
        game: "common",
        type: "FIX",
        desc: "Web Audio 버퍼 풀링으로 SFX 끊김/누락 현상 해결, 허브 박스아트·라스베가스 카지노 사진을 원래대로 롤백",
      },
      {
        game: "mal-dalli-ja",
        type: "FIX",
        desc: "말 이동 로그가 게임 채팅에 노출되던 문제 수정",
      },
    ],
  },
  {
    version: "v1.19.0",
    releaseDate: "2026-08-26",
    title: "실시간 채팅 18개 게임 확장 및 관리자 통계 대시보드 구축",
    changes: [
      {
        game: "common",
        type: "FEAT",
        desc: "방문자 추적·게임 플레이 지표·관리자 통계 대시보드 신규 구축",
      },
      {
        game: "common",
        type: "FEAT",
        desc: "실시간 글로벌 로비 채팅 및 게임 내 플로팅 채팅(액션 로그 포함)을 18개 온라인 게임 전체로 확장",
      },
    ],
  },
  {
    version: "v1.18.0",
    releaseDate: "2026-08-25",
    title: "말달리자 질주 연출 및 달무티 5대 신분 체계 개편",
    changes: [
      {
        game: "mal-dalli-ja",
        type: "FEAT",
        desc: "역동적인 질주 애니메이션, 흙먼지 트레일, 착지 임팩트 연출 추가",
      },
      {
        game: "dalmuti",
        type: "FEAT",
        desc: "왕·귀족·평민·거지·노예 5대 신분 체계로 개편, 세금·조공 및 평민 상호 카드 교환 페이즈 신설",
      },
      {
        game: "dalmuti",
        type: "FEAT",
        desc: "평민 카드 선택 모달, 상대에게 교환 카드 비공개 처리, 카드 이동 글로우 VFX 추가",
      },
      {
        game: "mal-dalli-ja",
        type: "FIX",
        desc: "재접속 시 상태 동기화 경쟁 조건(스테일 스냅샷)으로 말이 사라지거나 남는 버그 및 슬라이드 전환 속도 문제 수정",
      },
    ],
  },
  {
    version: "v1.17.0",
    releaseDate: "2026-08-24",
    title: "라스베가스 배팅존 정렬 및 그리드포커 승리 연출 개선",
    changes: [
      {
        game: "las-vegas",
        type: "FEAT",
        desc: "배팅존 지폐 카드 겹침을 제거하고 나란히 정렬해 순위별 금액을 가림 없이 확인 가능하도록 개선",
      },
      {
        game: "grid-poker",
        type: "FEAT",
        desc: "라운드 승리 시 골드 파티클·화면 흔들림 연출과 승자 프로필 표시, 라운드 승수 카운터 추가",
      },
    ],
  },
  {
    version: "v1.16.0",
    releaseDate: "2026-08-23",
    title: "라스베가스 카지노 테마 전면 개편",
    changes: [
      {
        game: "las-vegas",
        type: "FEAT",
        desc: "카지노 테마 아트워크로 배팅존 전면 개편, 실사 이미지·개별 주사위 행 렌더링, 동점 무효 처리, 상대 굴림 뷰어 및 실시간 배당 표시 추가",
      },
      {
        game: "destiny-war-39",
        type: "FIX",
        desc: "모바일 화면 가독성 강화(역방향 카드/폰트 확대), 상대 예측·히든 카드 정보 차단 및 뒤로가기 방지",
      },
    ],
  },
  {
    version: "v1.15.0",
    releaseDate: "2026-08-22",
    title: "운명전쟁39·뱅 8인 모드 및 다수 게임 시각효과 강화",
    changes: [
      {
        game: "destiny-war-39",
        type: "FEAT",
        desc: "좌측 랭킹 리더보드/우측 예측 패널 분리, 턴 순서 뱃지 및 카드플레이 임팩트 연출, 히든 공개 연출 추가, 6인·7인 모드 지원",
      },
      {
        game: "bang",
        type: "FEAT",
        desc: "8인 모드 공식 역할 분배 및 무법자 2인 밸런스 지원",
      },
      {
        game: "worm",
        type: "FEAT",
        desc: "먹이 섭취·자폭·꼬리 절단 파티클 연출과 대형 처치 이펙트·전멸 배너 추가",
      },
      {
        game: "avalon",
        type: "FEAT",
        desc: "영웅 능력·투표 제출·퀘스트 결과 시각효과 추가",
      },
      {
        game: "destiny-war-39",
        type: "FIX",
        desc: "트릭 판정 중 플레이된 카드가 순간적으로 사라지거나 그림자 겹침으로 투명해지던 버그 수정",
      },
    ],
  },
  {
    version: "v1.14.0",
    releaseDate: "2026-08-21",
    title: "8인 모드 확장 및 페루도·뱅·소환사의 협곡 대규모 개편",
    changes: [
      {
        game: "perudo",
        type: "FEAT",
        desc: "사각 4변 테두리 트랙(1~20)으로 전면 개편, 30칸 트랙 순서 및 역행 입찰 방지 적용",
      },
      {
        game: "bang",
        type: "FEAT",
        desc: "카드 호버 UX 재설계, 체력/역할 가시성 강화, 중앙 카드플레이 배너 및 액션 연출 추가",
      },
      {
        game: "summoners-rift",
        type: "FEAT",
        desc: "던전 덱 카운트, 장비 해제 오버레이, 히어로 카드 UI, 룰 가이드 패널, 이전 라운드 히스토리 및 공용 던전 전투 뷰어 추가",
      },
      {
        game: "common",
        type: "FEAT",
        desc: "운명전쟁39·그리드포커·코요테를 8인 모드로 확장하고 허브에 8인 필터 옵션 추가",
      },
      {
        game: "avalon",
        type: "FEAT",
        desc: "역할 능력과 팀 목표를 보여주는 우측 사이드바 패널 추가",
      },
    ],
  },
  {
    version: "v1.13.1",
    releaseDate: "2026-08-20",
    title: "페루도 보드 재설계 및 버그 수정",
    changes: [
      {
        game: "perudo",
        type: "IMPROVE",
        desc: "중앙 다이스 무덤 + 사각 트랙으로 보드 재설계, 보라색 주사위 확대 및 우측 트랙 잘림 현상 수정",
      },
      {
        game: "perudo",
        type: "FIX",
        desc: "동일 수량에서 눈 증가 입찰 허용 및 2눈 보드 마커 매핑 버그 수정",
      },
    ],
  },
  {
    version: "v1.13.0",
    releaseDate: "2026-08-19",
    title: "그리드포커 시각효과 및 페루도 보드 개편",
    changes: [
      {
        game: "grid-poker",
        type: "FEAT",
        desc: "카드 배치 펄스 및 라인 완성 시 족보 시각효과 추가",
      },
      {
        game: "perudo",
        type: "IMPROVE",
        desc: "보드 UI를 신규 트랙 이미지로 교체하고 선형 트랙 순서 적용, 역행 입찰 방지",
      },
      {
        game: "pieces-of-language",
        type: "FIX",
        desc: "힌트 공개 글자 수를 정확히 절반으로 내림 계산하도록 수정",
      },
    ],
  },
  {
    version: "v1.12.0",
    releaseDate: "2026-08-18",
    title: "운명전쟁39 신규 추가",
    changes: [
      {
        game: "destiny-war-39",
        type: "FEAT",
        desc: "운명전쟁39 신규 추가 — 예측 스코어보드, 트릭 전환 딜레이, 라운드 카드 히스토리 뷰",
      },
      {
        game: "destiny-war-39",
        type: "FIX",
        desc: "0카드 트릭 판정 로직 오류 및 역방향 카드 시각 표시 개선",
      },
    ],
  },
  {
    version: "v1.11.2",
    releaseDate: "2026-08-17",
    title: "언어의 조각 힌트 규칙 및 페루도 룰 정비",
    changes: [
      {
        game: "pieces-of-language",
        type: "FIX",
        desc: "힌트는 1회 이상 실패한 뒤에만 열리도록 하고 글자 50% 공개로 조정",
      },
      {
        game: "perudo",
        type: "IMPROVE",
        desc: "팔라피코 규칙 제거, 정확히 부르기(exact call) 시 주사위 제한 해제 등 최신 룰북에 맞춰 정비",
      },
    ],
  },
  {
    version: "v1.11.1",
    releaseDate: "2026-08-16",
    title: "말달리자 이동 제한 및 페루도 주사위 UI 정비",
    changes: [
      {
        game: "mal-dalli-ja",
        type: "FIX",
        desc: "슬라이드 이동을 상하좌우 4방향으로 제한(하우스룰)",
      },
      {
        game: "perudo",
        type: "IMPROVE",
        desc: "실사 사진 스타일의 탑다운 주사위 UI 적용, 입찰 진행 회귀 테스트 보강",
      },
    ],
  },
  {
    version: "v1.11.0",
    releaseDate: "2026-08-15",
    title: "장르 필터 도입 및 AI 봇 알고리즘 고도화",
    changes: [
      {
        game: "common",
        type: "FEAT",
        desc: "대시보드에 넷플릭스 데스게임 시리즈 그룹핑 및 장르 필터 카테고리 추가",
      },
      {
        game: "common",
        type: "FEAT",
        desc: "PIMC·ISMCTS·알파-베타 가지치기 알고리즘을 도입하고 Web Worker로 오프로드해 AI 봇을 강화",
      },
      {
        game: "common",
        type: "FIX",
        desc: "전 게임 공통 난이도 1~10단계 선택/로직이 정상 반영되지 않던 문제 수정",
      },
      {
        game: "perudo",
        type: "IMPROVE",
        desc: "실제 페루도 보드 디자인 및 플레이어별 주사위 색상 반영",
      },
      {
        game: "five-cucumbers",
        type: "IMPROVE",
        desc: "카드 크기를 키우고 원작 카드 비주얼에 맞춰 디자인 조정",
      },
    ],
  },
  {
    version: "v1.10.0",
    releaseDate: "2026-08-14",
    title: "말달리자 오아시스 존 하우스룰 복원",
    changes: [
      {
        game: "mal-dalli-ja",
        type: "FEAT",
        desc: "오아시스 존을 복원하고 넷플릭스 데스게임 L자 이동 제한 하우스룰 적용, 참조 이미지 기준으로 보드 레이아웃 정정",
      },
    ],
  },
  {
    version: "v1.9.0",
    releaseDate: "2026-08-13",
    title: "AI 봇 난이도 시스템 11개 게임 전면 적용 및 계정 시스템 구축",
    changes: [
      {
        game: "common",
        type: "FEAT",
        desc: "AI 봇 난이도 1~10단계 시스템을 포세일·코요테·라스베가스·그리드포커·소환사의 협곡·5개의 오이·달무티·러브레터·쿠데타·언어의 조각·말달리자 11개 게임에 전면 적용",
      },
      {
        game: "common",
        type: "FEAT",
        desc: "계정·구독 이용권(entitlement)·게스트 모드·관리자 대시보드 1단계를 신규 구축",
      },
    ],
  },
  {
    version: "v1.8.0",
    releaseDate: "2026-08-12",
    title: "웜 신규 추가 및 범용 AI 봇 시스템 도입",
    changes: [
      {
        game: "worm",
        type: "FEAT",
        desc: "웜(Worm) 신규 추가 후 주사위 방식에서 실시간 캔버스 슬리더 방식으로 전면 리팩터",
      },
      {
        game: "common",
        type: "FEAT",
        desc: "전 게임 공통 범용 AI 봇 시스템 도입 — 인간·봇 혼합 로비 구성 지원",
      },
      {
        game: "pieces-of-language",
        type: "FEAT",
        desc: "공유 자원 풀, 캐릭터별 라이트 인디케이터, 2×N 그리드 히스토리 UI로 개편",
      },
    ],
  },
  {
    version: "v1.7.0",
    releaseDate: "2026-08-11",
    title: "언어의 조각·쿠데타 신규 추가 및 버그 리포트 기능 도입",
    changes: [
      {
        game: "pieces-of-language",
        type: "FEAT",
        desc: "언어의 조각 신규 추가 후 공유 정답 단어·턴제 색상 힌트 방식으로 개편",
      },
      { game: "coup", type: "FEAT", desc: "쿠데타(레지스탕스: 쿠) 신규 추가" },
      {
        game: "common",
        type: "FEAT",
        desc: "파일 첨부가 가능한 버그 리포트 제출 폼 및 게시판 페이지 신규 추가",
      },
      {
        game: "mal-dalli-ja",
        type: "FIX",
        desc: "말 초기 배치를 대각선 4코너 기준으로 정정",
      },
    ],
  },
  {
    version: "v1.6.0",
    releaseDate: "2026-08-10",
    title: "달무티·코요테·포세일·러브레터·말달리자 신규 추가",
    changes: [
      { game: "dalmuti", type: "FEAT", desc: "달무티 신규 추가" },
      {
        game: "coyote",
        type: "FEAT",
        desc: "코요테 신규 추가(인디언 포커, 목숨을 3깃털에서 2하트로 조정)",
      },
      {
        game: "for-sale",
        type: "FEAT",
        desc: "포세일 신규 추가 — 입찰 코인 애니메이션, 실시간 입찰가·수표 합계 표시",
      },
      { game: "love-letter", type: "FEAT", desc: "러브레터 신규 추가" },
      {
        game: "mal-dalli-ja",
        type: "FEAT",
        desc: "말달리자 신규 추가 — 넷플릭스 데스게임 하우스룰 기반",
      },
      {
        game: "five-cucumbers",
        type: "FIX",
        desc: "마지막 트릭 동점 시 후공에게 오이를 배정하는 타이브레이커 규칙 적용",
      },
    ],
  },
  {
    version: "v1.5.0",
    releaseDate: "2026-08-09",
    title: "스플렌더·5개의 오이·라스베가스·소환사의 협곡 신규 추가",
    changes: [
      { game: "splendor", type: "FEAT", desc: "스플렌더 신규 추가" },
      {
        game: "five-cucumbers",
        type: "FEAT",
        desc: "5개의 오이 신규 추가 — 카드플레이·오이 획득 연출 포함",
      },
      { game: "las-vegas", type: "FEAT", desc: "라스베가스 신규 추가" },
      {
        game: "summoners-rift",
        type: "FEAT",
        desc: "소환사의 협곡(던전오브맨덤 패러디) 신규 추가",
      },
      {
        game: "common",
        type: "IMPROVE",
        desc: "준비중 게임을 목록 뒤로 정렬, 누락돼 있던 게임 이미지 보완",
      },
    ],
  },
  {
    version: "v1.4.0",
    releaseDate: "2026-08-08",
    title: "페루도·센추리·스팟 더 디퍼런스 신규 추가",
    changes: [
      {
        game: "perudo",
        type: "FEAT",
        desc: "페루도 신규 추가 — 원형 배팅 트랙, 실물 보드 리스킨, 3D WebGL 주사위, 차등 다이스 페널티 룰까지 당일 대규모 반복 개선",
      },
      {
        game: "century",
        type: "FEAT",
        desc: "센추리: 스파이스 로드 신규 추가 — 카드 마켓 UI, 카트 인벤토리, 현실적 카드 디자인",
      },
      {
        game: "spot-difference",
        type: "FEAT",
        desc: "스팟 더 디퍼런스 신규 추가 — 사진 업로드 모드, 팀 합산 점수",
      },
      {
        game: "grid-poker",
        type: "FEAT",
        desc: "방 설정에 타이머 시간 커스터마이징 옵션 추가",
      },
      {
        game: "common",
        type: "IMPROVE",
        desc: "5개 게임에 박스아트 실사진 썸네일 적용, 이미지 크롭 방식 개선",
      },
    ],
  },
  {
    version: "v1.3.0",
    releaseDate: "2026-08-07",
    title: "노 땡스 신규 추가 및 사운드 엔진 도입",
    changes: [
      {
        game: "no-thanks",
        type: "FEAT",
        desc: "노 땡스! 신규 추가 — 룰 엔진·보드 UI·온라인 방, 코인토스 연출, 칩 공개 범위(chipVisibility) 선택 모드, 카드 카운트 시각화까지 당일 완주",
      },
      {
        game: "common",
        type: "FEAT",
        desc: "합성 사운드 엔진(BGM/SFX) 신규 도입",
      },
      {
        game: "grid-poker",
        type: "FEAT",
        desc: "보드/카드 확대, 딜러 리빌 연출, 타이머 추가",
      },
      {
        game: "common",
        type: "FEAT",
        desc: "뱅·아발론·하나미코지 방 닉네임을 내기 명단에 매핑, 내기 빠른 정산 버튼·스테퍼 추가",
      },
    ],
  },
  {
    version: "v1.2.0",
    releaseDate: "2026-08-05",
    title: "그리드포커 실시간 공용카드 표시 및 뱅 버그 수정",
    changes: [
      {
        game: "grid-poker",
        type: "FEAT",
        desc: "상대방의 실시간 공용 카드 배치를 표시하고 제출 시 완성된 포커 족보를 함께 표기",
      },
      {
        game: "bang",
        type: "FIX",
        desc: "부관 처치 시 장비 손실 처리 및 마지막 총알 맥주 생존 룰 수정",
      },
      {
        game: "bang",
        type: "FIX",
        desc: "손패가 생명력을 초과할 때 중간에 카드 플레이가 막히던 버그 수정",
      },
    ],
  },
  {
    version: "v1.1.0",
    releaseDate: "2026-08-04",
    title: "뱅·그리드포커·아발론 신규 추가",
    changes: [
      { game: "bang", type: "FEAT", desc: "뱅! 신규 추가" },
      { game: "grid-poker", type: "FEAT", desc: "그리드포커 신규 추가" },
      { game: "avalon", type: "FEAT", desc: "아발론 엔진·UI·테스트 신규 추가" },
      {
        game: "common",
        type: "FEAT",
        desc: "재접속 상태 동기화 및 방 정원 초과 체크 기능 추가",
      },
    ],
  },
  {
    version: "v1.0.1",
    releaseDate: "2026-08-02",
    title: "하나미코지 제안 액션 버그 수정",
    changes: [
      {
        game: "hanamikoji",
        type: "FIX",
        desc: "경합(제안) 액션이 제출되지 않던 버그 수정 및 보드 비주얼 리디자인",
      },
    ],
  },
  {
    version: "v1.0.0",
    releaseDate: "2026-08-01",
    title: "보드게임 허브 최초 오픈",
    changes: [
      {
        game: "common",
        type: "FEAT",
        desc: "보드게임 허브 최초 오픈, 내기 정산 사이드바 시스템 도입",
      },
      {
        game: "hanamikoji",
        type: "FEAT",
        desc: "하나미코지를 Supabase Realtime 기반 실시간 온라인 대전으로 전환, 룰북·툴팁 추가",
      },
    ],
  },
];

/** Newest version — drives both the header button label and the "New" badge check. */
export const LATEST_PATCH_VERSION = PATCH_NOTES[0].version;

/**
 * Resolves a change's game tag to display metadata. `"common"` gets a fixed
 * 🎮 badge; any real `GameId` is looked up in the single source of truth
 * (`GAME_REGISTRY`) so labels/emoji never drift out of sync with the game
 * catalog. Falls back to the raw tag if a game is ever removed from the
 * registry without its old patch-note entries being pruned.
 */
export function getPatchNoteGameMeta(tag: PatchNoteGameTag): { emoji: string; label: string } {
  if (tag === "common") return { emoji: "🎮", label: "공통" };
  const meta = GAME_REGISTRY.find((g) => g.id === tag);
  return meta ? { emoji: meta.thumbnail.emoji, label: meta.name } : { emoji: "🎲", label: tag };
}
