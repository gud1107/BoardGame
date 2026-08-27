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
  /** ISO date the change actually shipped (matches the HANDOFF.md session date), e.g. "2026-08-27". */
  releaseDate: string;
  /** One-line headline for the release. */
  title: string;
  changes: PatchNoteChange[];
}

/**
 * Ordered **newest release first** — `PatchNoteModal` renders this array
 * as-is, so any new entry must be unshifted onto the front, not appended.
 *
 * Version bump rule (confirmed with the user 2026-08-27): FIX-only release
 * → patch (+0.0.1); release containing any FEAT → minor (+0.1.0); breaking
 * change → major. This project had no feature-version history before this
 * file existed (`package.json`'s `version` is an unrelated `0.1.0`), so
 * v1.0.0 here is a deliberate retroactive starting point, not a milestone
 * that happened in git history.
 */
export const PATCH_NOTES: PatchNoteEntry[] = [
  {
    version: "v1.4.0",
    releaseDate: "2026-08-27",
    title: "오디오 시스템 전역 기본 음소거 적용 및 그리드포커 SFX 쿨다운 튜닝",
    changes: [
      {
        game: "common",
        type: "FEAT",
        desc: "로비 + 5개 게임(운명전쟁39·라스베가스·그리드포커·말달리자·달무티) 테마 BGM 연동, 전체 게임 전역 기본 음소거(Default Mute) 적용",
      },
      {
        game: "grid-poker",
        type: "FIX",
        desc: "카드 배치 SFX 쿨다운 60ms→40ms, 그리드 스냅음 80ms→50ms로 낮춰 연속 배치 시 끊김·누락 방지",
      },
    ],
  },
  {
    version: "v1.3.0",
    releaseDate: "2026-08-25",
    title: "말달리자 이동 애니메이션 가속화 및 재접속 고스트 말 버그 수정",
    changes: [
      {
        game: "mal-dalli-ja",
        type: "IMPROVE",
        desc: "슬라이드 이동 애니메이션 가속화(250ms→130ms) 및 오아시스존 나이트 이동 제약 완화",
      },
      {
        game: "mal-dalli-ja",
        type: "FIX",
        desc: "재접속 시 state-sync 레이스로 이동 중이던 말이 사라지거나 출발지에 고스트 말이 남는 버그 수정",
      },
    ],
  },
  {
    version: "v1.2.0",
    releaseDate: "2026-08-25",
    title: "달무티 5대 신분 체계 개편 및 조공·평민 교환 페이즈 신설",
    changes: [
      {
        game: "dalmuti",
        type: "FEAT",
        desc: "왕·귀족·평민·거지·노예 5대 신분 체계로 개편, 라운드 시작 전 세금·조공 교환 페이즈 추가",
      },
      {
        game: "dalmuti",
        type: "FEAT",
        desc: "평민 상호 카드 자유 선택 교환 모달 및 화려한 교환 VFX/SFX 추가",
      },
    ],
  },
  {
    version: "v1.1.0",
    releaseDate: "2026-08-24",
    title: "그리드포커 라운드 승리 연출 강화",
    changes: [
      {
        game: "grid-poker",
        type: "FEAT",
        desc: "라운드 승리 시 골드 파티클·스탬프·화면 흔들림 연출 추가, 승자 정보를 결과창에 통합 표시",
      },
    ],
  },
  {
    version: "v1.0.0",
    releaseDate: "2026-08-24",
    title: "라스베가스 배팅존 지폐 카드 정렬 개편",
    changes: [
      {
        game: "las-vegas",
        type: "IMPROVE",
        desc: "배팅존 지폐 카드 겹침을 제거하고 나란히 정렬해 순위별 금액을 가림 없이 확인 가능하도록 개선",
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
