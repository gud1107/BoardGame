"use client";

/**
 * Small presentational pieces shared between `PerudoBoard.tsx` (desktop/
 * tablet layout) and `PerudoMobileBoard.tsx` (2026-09-08 모바일 화이트
 * 오버스크롤 차단 + 우측 사이드 패널 개편 세션) — pulled out of `PerudoBoard.tsx`,
 * where they used to live as unexported local functions, specifically so
 * both board variants can render the exact same graveyard/face-picker
 * markup instead of drifting into two slightly different copies. Living in
 * their own file (rather than just exporting them from `PerudoBoard.tsx`)
 * also avoids a circular import between the two board components.
 */

import PerudoFaceIcon from "./PerudoFaceIcon";
import { PerudoDie, type DieSize } from "./dice/PerudoDie";
import type { DiceColorway } from "./dice/colorways";
import { STARTING_DICE, type Face, type PerudoState, type SeatIndex } from "./engine";

export function faceLabel(face: Face): string {
  return face === 1 ? "페루도" : `${face}`;
}

/** One face-up die — thin wrapper over the shared `PerudoDie` primitive with this game's own title tooltip convention. Always renders in the passed-in `colorway` — including the face-1 페루도 mark, which is engraved in that same die's own ink color rather than a fixed universal red (see `dice/colorways.ts`'s file header). */
export function DieFace({ value, size = "md", ring, colorway, tilt }: { value: number; size?: DieSize; ring?: "match" | "wild"; colorway: DiceColorway; tilt?: number }) {
  return (
    <PerudoDie value={value} size={size} ring={ring} colorway={colorway} tilt={tilt} title={value === 1 ? "페루도 (조커)" : `${value}`} />
  );
}

/** A hidden die — a blank, pip-free die in its owner's own colorway (no icon at all, so it reads as a true silhouette rather than a generic dice emoji). Tinted with the owning seat's own player colorway so whose stash is whose reads at a glance even before anyone's dice count is checked. */
export function DieBack({ size = "sm", colorway }: { size?: DieSize; colorway: DiceColorway }) {
  return <PerudoDie size={size} colorway={colorway} blank glossy={false} title="비공개 주사위" />;
}

/**
 * 2026-09-07 모바일 가로 스크롤 제거 세션: shrunk from fixed `h-9 w-9`/`gap-1.5`
 * (6×36px + 5×6px gap ≈ 246px) to `h-6 w-6`/`gap-1` (6×24px + 5×4px gap =
 * 164px) — this row's 6 buttons don't scale with `--perudo-cell` at all, so
 * at the board's smaller floor the old fixed size no longer fit inside the
 * composer panel nested in `PerudoBoard`'s desktop board. Reused as-is by
 * `PerudoMobileBoard`'s action dock (2026-09-08 세션) — the same compact
 * size already fits a thumb-friendly dock without a further resize.
 */
export function FacePicker({ selected, onSelect }: { selected: Face; onSelect: (face: Face) => void }) {
  const faces: Face[] = [1, 2, 3, 4, 5, 6];
  return (
    <div className="flex gap-1">
      {faces.map((face) => (
        <button
          key={face}
          type="button"
          onClick={() => onSelect(face)}
          className={`flex h-6 w-6 items-center justify-center rounded-lg border-2 text-xs font-bold transition ${
            selected === face
              ? "border-amber-200 bg-gradient-to-b from-amber-300 to-amber-500 text-neutral-900 shadow-[0_0_0_2px_rgba(251,191,36,0.35)]"
              : "border-white/15 bg-black/20 text-white/60 hover:border-white/30"
          }`}
          title={face === 1 ? "페루도 (조커)" : `숫자 ${face}`}
        >
          {face === 1 ? <PerudoFaceIcon className="mx-auto h-3.5 w-3.5" /> : face}
        </button>
      ))}
    </div>
  );
}

/**
 * The center "잃은 주사위 무덤" tray: every die any player has ever lost this
 * game collects here instead of just vanishing from the roster count, so the
 * whole table can see at a glance how depleted the overall dice pool is.
 * Purely derived from `state.players` (`STARTING_DICE - diceCount` per seat)
 * — nothing new is tracked. Since a successful "맞아!" no longer caps a
 * seat's `diceCount` at `STARTING_DICE`, that subtraction can go negative
 * for a seat sitting on more dice than it started with; the
 * `.filter((x) => x.lost > 0)` below simply excludes such seats rather than
 * showing a negative loss. Grouped per seat so the pile also reads as "who's
 * been bleeding dice": each seat's losses render as an overlapping stack of
 * THAT seat's own dice colorway, dimmed/desaturated so a graveyard die reads
 * as spent and out of play. Rendered on the desktop board directly under
 * `TotalDiceBanner`, and as the mobile board's own "tier 2" (2026-09-08
 * 세션) right under the turn banner.
 */
export function LostDiceTray({
  state,
  colorways,
}: {
  state: PerudoState;
  colorways: Record<SeatIndex, DiceColorway>;
}) {
  const bySeat = state.players.map((p) => ({ seat: p.seat, lost: STARTING_DICE - p.diceCount })).filter((x) => x.lost > 0);
  const totalLost = bySeat.reduce((sum, x) => sum + x.lost, 0);
  return (
    <div className="relative z-10 flex flex-col items-center gap-1.5 rounded-xl border border-dashed border-amber-800/40 bg-black/15 px-3 py-2">
      <p className="text-[10px] font-semibold tracking-wide text-amber-200/60">
        💀 잃은 주사위 무덤{totalLost > 0 ? ` · 총 ${totalLost}개` : ""}
      </p>
      {totalLost === 0 ? (
        <p className="text-[10px] text-amber-100/30">아직 잃은 주사위가 없습니다</p>
      ) : (
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5">
          {bySeat.map(({ seat, lost }) => (
            <div key={seat} className="flex items-center opacity-60 grayscale-[0.4]" title={`${lost}개 상실`}>
              {Array.from({ length: lost }, (_, i) => (
                <div key={i} style={i === 0 ? undefined : { marginLeft: -10 }}>
                  <DieBack size="sm" colorway={colorways[seat]} />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Always-visible face-expectation summary (rulebook UX request, 2026-09-08
 * 모바일 개편 세션 요구사항 #2 3단): the classic Perudo doubt/call math — a
 * specific non-조커 face's expected count across every die still in play is
 * `total / 3` (its own `total/6` share plus the wild 조커's own `total/6`
 * share), while 조커(face 1) itself has no wild backing it up, so its own
 * expectation is just `total / 6`. Desktop already surfaces the general
 * figure inline (`MyDiceStatsPanel` in `PerudoBoard.tsx`, scoped to the
 * viewer's own hand); this bar is the mobile board's compact top-level
 * equivalent, scoped to the whole table's remaining dice instead.
 */
export function ExpectationBar({ totalActiveDice }: { totalActiveDice: number }) {
  const general = totalActiveDice / 3;
  const jokerOnly = totalActiveDice / 6;
  return (
    <div className="relative z-10 flex items-center justify-center gap-1.5 rounded-xl border border-amber-300/25 bg-amber-400/10 px-2.5 py-1 text-center text-[11px] font-semibold text-amber-100">
      <span>📊</span>
      <span className="break-keep">
        전체 {totalActiveDice}개 · 일반 기대값 {general.toFixed(1)}개 (1 눈금은 {jokerOnly.toFixed(1)}개)
      </span>
    </div>
  );
}
