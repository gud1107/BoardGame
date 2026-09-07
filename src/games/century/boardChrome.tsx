import { ResourceCube, RESOURCE_META } from "./ResourceIcon";
import { RESOURCE_ORDER, type Resource, type ResourceBundle } from "./cards";

/**
 * Physical-game-mat visual language shared across the whole board — an outer
 * "wood tabletop" frame (MAT) holding an inner "persian rug/felt" playing
 * surface (FELT) for the market and a "carved wood caravan board" surface
 * (CARAVAN) for the player's own cart, so the screen reads as a real board
 * game box lid rather than a flat UI panel. Built entirely from layered CSS
 * gradients + box-shadow (no image asset — same convention as CARD_FRAME_STYLE
 * / CoinStack below). Extracted out of CenturyBoard.tsx so both the desktop
 * mat layout and the mobile compact dashboard can share one visual language.
 */
export const MAT = "relative overflow-hidden rounded-[28px] border border-black/60 p-2.5 shadow-[0_25px_60px_-25px_rgba(0,0,0,0.95)] sm:p-4";
export const MAT_STYLE: React.CSSProperties = {
  background:
    "radial-gradient(ellipse 140% 60% at 50% -10%, rgba(255,205,130,0.10), transparent 55%)," +
    "repeating-linear-gradient(102deg, rgba(0,0,0,0.05) 0px, rgba(0,0,0,0.05) 1px, transparent 1px, transparent 4px)," +
    "linear-gradient(160deg, #4a2f16 0%, #2c1a0c 45%, #160d06 100%)",
  boxShadow: "inset 0 0 0 2px rgba(0,0,0,0.55), inset 0 0 50px rgba(0,0,0,0.55), inset 0 2px 0 rgba(255,255,255,0.06)",
};

export const FELT = "relative overflow-hidden rounded-2xl border p-2 sm:p-3";
export const FELT_STYLE: React.CSSProperties = {
  background:
    "radial-gradient(circle at 50% 0%, rgba(160,40,40,0.16), transparent 60%)," +
    "repeating-radial-gradient(circle at 50% 50%, rgba(200,160,90,0.045) 0px, rgba(200,160,90,0.045) 2px, transparent 2px, transparent 34px)," +
    "linear-gradient(135deg, #241015 0%, #180d10 55%, #110a0b 100%)",
  borderColor: "rgba(198,160,90,0.35)",
  boxShadow: "inset 0 0 0 1px rgba(198,160,90,0.2), inset 0 0 30px rgba(0,0,0,0.6)",
};

export const CARAVAN_STYLE: React.CSSProperties = {
  background: "linear-gradient(160deg, #5a3b1c 0%, #3c260f 55%, #2a1a0a 100%)",
  borderColor: "rgba(198,160,90,0.4)",
  boxShadow: "inset 0 0 0 1px rgba(198,160,90,0.25), inset 0 2px 8px rgba(0,0,0,0.5), 0 8px 20px -10px rgba(0,0,0,0.75)",
};

/**
 * Antique-card styling shared by merchant + point card faces — a layered
 * inset box-shadow standing in for an engraved parchment border (no image
 * asset, same "pure inline SVG/CSS, no external art" convention as
 * ResourceIcon.tsx) so both card types read as "real cardboard" rather than
 * a plain UI chip.
 */
export const CARD_FRAME_STYLE: React.CSSProperties = {
  background: "linear-gradient(160deg,#f6ecd2 0%,#e7d3a3 50%,#cdac71 100%)",
  boxShadow:
    "inset 0 0 0 1px rgba(120,90,40,0.55), inset 0 0 0 3px rgba(255,250,235,0.5), inset 0 2px 4px rgba(255,255,255,0.5), inset 0 -3px 6px rgba(90,60,20,0.3), 0 1px 2px rgba(0,0,0,0.4)",
};

export function ResourceChip({ resource, count, size = "h-4 w-4" }: { resource: Resource; count: number; size?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/30 px-1.5 py-0.5 text-[11px] font-semibold text-white/90">
      <ResourceCube resource={resource} className={size} />
      {count}
    </span>
  );
}

export function BundleRow({ bundle, size = "h-4 w-4" }: { bundle: ResourceBundle; size?: string }) {
  const entries = RESOURCE_ORDER.filter((r) => (bundle[r] ?? 0) > 0);
  if (entries.length === 0) return <span className="text-[11px] text-white/30">없음</span>;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {entries.map((r) => (
        <ResourceChip key={r} resource={r} count={bundle[r]!} size={size} />
      ))}
    </div>
  );
}

/**
 * Renders a player's caravan cart as `limit` (HAND_LIMIT, 10) fixed,
 * concave "well" slots carved into the board — filled slots show the glossy
 * resource cube sitting in the well, empty slots stay a plain dark hollow, so
 * "how full is my cart" is legible at a glance instead of requiring the
 * viewer to add up a row of count badges. Cubes fill slots in
 * `RESOURCE_ORDER` (ascending value) so color groups stay visually together
 * rather than shuffling around as counts change.
 *
 * `full` renders a real 5×2 caravan grid (the main board's own cart);
 * `compact` (used for the other-players' summary rows, where horizontal
 * space is tight) falls back to a wrapping row of tiny wells instead.
 *
 * The 10-slot limit is only ever exceeded transiently (between drawing past
 * it and resolving the forced `discardToLimit` gate) — any resource beyond
 * the 10th slot still renders, in a visually distinct rose-bordered
 * "overflow" well, so that moment isn't silently clipped.
 */
export function CartInventory({
  resources,
  limit,
  compact = false,
  slotClass,
  cubeClass,
}: {
  resources: ResourceBundle;
  limit: number;
  compact?: boolean;
  slotClass?: string;
  cubeClass?: string;
}) {
  const resolvedSlot = slotClass ?? (compact ? "h-3.5 w-3.5" : "h-8 w-8 sm:h-9 sm:w-9");
  const resolvedCube = cubeClass ?? (compact ? "h-2.5 w-2.5" : "h-5 w-5 sm:h-6 sm:w-6");
  const cubes: Resource[] = [];
  for (const r of RESOURCE_ORDER) {
    for (let i = 0; i < (resources[r] ?? 0); i++) cubes.push(r);
  }
  const slots = Array.from({ length: limit }, (_, i) => cubes[i] ?? null);
  const overflowCubes = cubes.slice(limit);
  const wellStyle = (filled: boolean): React.CSSProperties => ({
    background: "radial-gradient(circle at 50% 38%, #241708 0%, #100b04 72%)",
    boxShadow: filled
      ? "inset 0 2px 5px rgba(0,0,0,0.8), inset 0 -1px 1px rgba(255,255,255,0.06), 0 1px 0 rgba(255,255,255,0.05)"
      : "inset 0 2px 4px rgba(0,0,0,0.65)",
    border: "1px solid rgba(198,160,90,0.28)",
  });
  return (
    <div className={compact ? "flex flex-wrap gap-1" : "grid grid-cols-5 gap-1.5 sm:gap-2"}>
      {slots.map((r, i) => (
        <div key={i} className={`flex items-center justify-center rounded-full ${resolvedSlot}`} style={wellStyle(!!r)}>
          {r ? <ResourceCube resource={r} className={resolvedCube} /> : <span className="h-1 w-1 rounded-full bg-white/10" />}
        </div>
      ))}
      {overflowCubes.map((r, i) => (
        <div
          key={`overflow-${i}`}
          className={`flex items-center justify-center rounded-full border-2 border-rose-400/70 bg-rose-500/10 shadow-[0_0_10px_-1px_rgba(244,63,94,0.7)] ${resolvedSlot}`}
          title="10개 한도 초과 — 버려야 합니다"
        >
          <ResourceCube resource={r} className={resolvedCube} />
        </div>
      ))}
    </div>
  );
}

/** A small purple engraved arrow, matching the physical card's "production/conversion" glyph. */
export function ArrowGlyph({
  className = "h-4 w-4 text-violet-700",
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg viewBox="0 0 24 24" className={className} style={style} fill="currentColor" aria-hidden="true">
      <rect x="9" y="1" width="6" height="10" rx="1" />
      <polygon points="3,11 21,11 12,22" />
    </svg>
  );
}

/** "Any cube → next tier cube" glyph for upgrade cards, abstracted since no card art exists. */
export function UpgradeGlyph({ compact = false }: { compact?: boolean }) {
  const chip = compact ? "h-2.5 w-2.5" : "h-3.5 w-3.5";
  return (
    <div className="flex items-center gap-1">
      <span className={`rounded-sm border border-black/25 bg-white/80 shadow-inner ${chip}`} />
      <ArrowGlyph className={`-rotate-90 text-sky-700 ${compact ? "h-3 w-3" : "h-4 w-4"}`} />
      <span className={`rounded-sm border border-black/25 bg-gradient-to-br from-amber-300 to-amber-600 shadow-inner ${chip}`} />
    </div>
  );
}

/** Resource cubes stacked/wrapped together, mimicking the physical card's stacked-cube icon column. */
export function CubeStack({ bundle, size = "h-4 w-4" }: { bundle: ResourceBundle; size?: string }) {
  const entries: Resource[] = [];
  for (const r of RESOURCE_ORDER) {
    for (let i = 0; i < (bundle[r] ?? 0); i++) entries.push(r);
  }
  if (entries.length === 0) return <span className="text-[9px] text-black/30">—</span>;
  return (
    <div className="flex flex-wrap items-center justify-center gap-0.5">
      {entries.map((r, i) => (
        <ResourceCube key={i} resource={r} className={`${size} drop-shadow-[0_1px_1px_rgba(0,0,0,0.4)]`} />
      ))}
    </div>
  );
}

/**
 * Stacked, overlapping 3D coin visual for the gold(3점)/silver(1점) bonus
 * slots — every capped supply slot (`capacity`, i.e. `playerCount * 2`) is
 * always rendered so a coin being spent is a CSS *transition*
 * (opacity/transform) on that slot rather than a DOM add/remove, giving a
 * smooth "stack gets shorter" shrink instead of an abrupt count change.
 * Rendered slots are capped at 8 for physical stack height even when
 * `capacity` is higher (5p games start at 10).
 */
export function CoinStack({ kind, count, capacity }: { kind: "gold" | "silver"; count: number; capacity: number }) {
  const isGold = kind === "gold";
  const coinSize = 20;
  const gap = 3.5;
  const visualCapacity = Math.max(1, Math.min(capacity, 8));
  const visualCount = Math.min(count, visualCapacity);
  return (
    <div className="flex flex-col items-center" aria-label={`${isGold ? "금화" : "은화"} ${count}개 남음`} role="img">
      <div className="relative" style={{ width: coinSize + 4, height: coinSize + (visualCapacity - 1) * gap }}>
        {Array.from({ length: visualCapacity }, (_, i) => {
          const visible = i < visualCount;
          const isTop = i === visualCount - 1;
          return (
            <div
              key={i}
              className="absolute left-1/2 rounded-full transition-all duration-500 ease-out"
              style={{
                bottom: i * gap,
                width: coinSize,
                height: coinSize,
                background: isGold
                  ? "radial-gradient(circle at 32% 28%, #fff8d6 0%, #f7d264 35%, #d79b1e 68%, #8a5a0c 100%)"
                  : "radial-gradient(circle at 32% 28%, #ffffff 0%, #e4e8ec 35%, #aab2bb 68%, #6b727a 100%)",
                border: `1px solid ${isGold ? "#6b4306" : "#4b5157"}`,
                boxShadow: visible
                  ? "0 0 0 1px rgba(255,255,255,0.22), 0 2px 2px rgba(0,0,0,0.55), inset 0 1px 1px rgba(255,255,255,0.65), inset 0 -1px 1px rgba(0,0,0,0.25)"
                  : "none",
                opacity: visible ? 1 : 0,
                transform: `translateX(-50%) ${visible ? "translateY(0) scale(1)" : "translateY(6px) scale(0.5)"}`,
                zIndex: i,
              }}
            >
              {visible && isTop && (
                <span
                  className="flex h-full w-full select-none items-center justify-center text-[9px] font-black"
                  style={{ color: isGold ? "#5c3a08" : "#3a4046" }}
                >
                  {isGold ? "3" : "1"}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <span className="mt-0.5 text-[9px] font-bold text-white/70">{count}개</span>
    </div>
  );
}

/**
 * A remaining-card-count "deck" — a handful of overlapping parchment card
 * backs (same frame technique as `CARD_FRAME_STYLE`) stacked with a slight
 * vertical offset per visible layer, so the pile visibly gets shorter as the
 * deck depletes; a printed count badge on the top card keeps the exact
 * number legible at a glance even though the stack height itself is capped
 * for physical plausibility (never taller than 5 layers).
 */
export function DeckStack({ label, count, accent }: { label: string; count: number; accent: string }) {
  const visualLayers = Math.max(1, Math.min(count, 5));
  if (count === 0) {
    return (
      <div className="flex flex-col items-center gap-1">
        <div className="flex h-[58px] w-11 items-center justify-center rounded-md border border-dashed border-white/15 text-[8px] text-white/30 sm:h-[64px] sm:w-12">
          소진
        </div>
        <span className="text-[9px] font-semibold text-white/40">{label}</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: 46, height: 58 + (visualLayers - 1) * 2.5 }}>
        {Array.from({ length: visualLayers }, (_, i) => (
          <div
            key={i}
            className="absolute left-0 flex h-[58px] w-11 flex-col items-center justify-center gap-0.5 rounded-md border border-[#7a5a2e] sm:h-16 sm:w-12"
            style={{
              bottom: i * 2.5,
              background: "linear-gradient(160deg,#e7d3a3 0%,#cdac71 60%,#a9814a 100%)",
              boxShadow: "inset 0 0 0 2px rgba(255,250,235,0.35), 0 2px 3px rgba(0,0,0,0.5)",
            }}
          >
            {i === visualLayers - 1 && (
              <>
                <span className="text-[7px] font-bold uppercase tracking-widest" style={{ color: accent }}>
                  {label}
                </span>
                <span className="text-sm font-black" style={{ color: "#3f2408" }}>
                  {count}
                </span>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Decorative communal spice-supply bowl for one resource color. The
 * rulebook's shared 105-cube bowl is intentionally NOT modeled as a finite
 * bank (production/trade gains are never blocked by scarcity), so this
 * renders a fixed handful of cubes rather than a live count; it exists
 * purely to make the mat read as "a real spice board" the way the physical
 * game's four bowls sit at the head of the board, not as a functional
 * resource picker.
 */
export function SpiceBowl({ resource, compact = false }: { resource: Resource; compact?: boolean }) {
  const meta = RESOURCE_META[resource];
  const bowlClass = compact ? "h-7 w-9" : "h-9 w-12 sm:h-11 sm:w-14";
  const cubeClass = compact ? "h-2 w-2" : "h-2.5 w-2.5 sm:h-3 sm:w-3";
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={`relative flex items-end justify-center overflow-hidden rounded-b-[999px] rounded-t-md pb-1 ${bowlClass}`}
        style={{
          background: "linear-gradient(180deg, #d8c9a3 0%, #b89a68 55%, #7c5f38 100%)",
          boxShadow: "inset 0 4px 6px rgba(0,0,0,0.45), inset 0 -2px 2px rgba(255,255,255,0.25), 0 3px 4px rgba(0,0,0,0.5)",
          border: "1px solid #4a3617",
        }}
      >
        <div className="flex flex-wrap items-center justify-center gap-0.5 px-1">
          {Array.from({ length: 5 }, (_, i) => (
            <ResourceCube key={i} resource={resource} className={cubeClass} />
          ))}
        </div>
      </div>
      {!compact && <span className="text-[8px] font-semibold tracking-wide text-white/50 sm:text-[9px]">{meta.label.split(" ")[0]}</span>}
    </div>
  );
}
