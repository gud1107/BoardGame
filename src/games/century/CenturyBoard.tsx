"use client";

import { useCallback, useRef, useState } from "react";
import RulebookModal from "./RulebookModal";
import ResourceIcon, { ResourceCube, RESOURCE_META } from "./ResourceIcon";
import { detectAcquireEvent, FlyingResourceBurst, type AcquireAnimEvent } from "./MerchantEffects";
import {
  RESOURCE_ORDER,
  bundleTotal,
  subtractBundle,
  type MerchantCard,
  type PointCard,
  type Resource,
  type ResourceBundle,
} from "./cards";
import {
  canAcquireMerchant,
  canClaimPoint,
  computeRankings,
  HAND_LIMIT,
  MERCHANT_MARKET_SIZE,
  maxTradeRepeats,
  POINT_MARKET_SIZE,
  simulateUpgrade,
  type CenturyState,
  type EngineAction,
  type PlayerState,
  type SeatIndex,
} from "./engine";

/**
 * Pure game UI + rules driver — same controlled-component contract as every
 * other `<Game>Board.tsx` in this project (state via props only, intent out
 * via `onAction`). Every client holds the FULL state (every seat's hand and
 * resources) in memory per this project's lockstep trust model; hands here
 * are visible market cards rather than secret roles, so this component never
 * hides another seat's hand/resources the way NoThanks hides chips or Bang
 * hides roles — see docs/architecture.md §2.
 */
export interface CenturyBoardProps {
  state: CenturyState;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  connectedSeats: Set<SeatIndex>;
  onAction: (action: EngineAction) => void;
  onGameEnd: () => void;
}

// ---------------------------------------------------------------------------
// Physical-game-mat visual language shared across the whole board — an outer
// "wood tabletop" frame (MAT) holding an inner "persian rug/felt" playing
// surface (FELT) for the market and a "carved wood caravan board" surface
// (CARAVAN) for the player's own cart, so the screen reads as a real board
// game box lid rather than a flat UI panel. Built entirely from layered CSS
// gradients + box-shadow (no image asset — same convention as CARD_FRAME_STYLE
// / CoinStack below, which predate this pass).
// ---------------------------------------------------------------------------
const MAT = "relative overflow-hidden rounded-[28px] border border-black/60 p-2.5 shadow-[0_25px_60px_-25px_rgba(0,0,0,0.95)] sm:p-4";
const MAT_STYLE: React.CSSProperties = {
  background:
    "radial-gradient(ellipse 140% 60% at 50% -10%, rgba(255,205,130,0.10), transparent 55%)," +
    "repeating-linear-gradient(102deg, rgba(0,0,0,0.05) 0px, rgba(0,0,0,0.05) 1px, transparent 1px, transparent 4px)," +
    "linear-gradient(160deg, #4a2f16 0%, #2c1a0c 45%, #160d06 100%)",
  boxShadow: "inset 0 0 0 2px rgba(0,0,0,0.55), inset 0 0 50px rgba(0,0,0,0.55), inset 0 2px 0 rgba(255,255,255,0.06)",
};

const FELT = "relative overflow-hidden rounded-2xl border p-2 sm:p-3";
const FELT_STYLE: React.CSSProperties = {
  background:
    "radial-gradient(circle at 50% 0%, rgba(160,40,40,0.16), transparent 60%)," +
    "repeating-radial-gradient(circle at 50% 50%, rgba(200,160,90,0.045) 0px, rgba(200,160,90,0.045) 2px, transparent 2px, transparent 34px)," +
    "linear-gradient(135deg, #241015 0%, #180d10 55%, #110a0b 100%)",
  borderColor: "rgba(198,160,90,0.35)",
  boxShadow: "inset 0 0 0 1px rgba(198,160,90,0.2), inset 0 0 30px rgba(0,0,0,0.6)",
};

const CARAVAN_STYLE: React.CSSProperties = {
  background: "linear-gradient(160deg, #5a3b1c 0%, #3c260f 55%, #2a1a0a 100%)",
  borderColor: "rgba(198,160,90,0.4)",
  boxShadow: "inset 0 0 0 1px rgba(198,160,90,0.25), inset 0 2px 8px rgba(0,0,0,0.5), 0 8px 20px -10px rgba(0,0,0,0.75)",
};

function ResourceChip({ resource, count, size = "h-4 w-4" }: { resource: Resource; count: number; size?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/30 px-1.5 py-0.5 text-[11px] font-semibold text-white/90">
      <ResourceCube resource={resource} className={size} />
      {count}
    </span>
  );
}

function BundleRow({ bundle, size = "h-4 w-4" }: { bundle: ResourceBundle; size?: string }) {
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
 * it and resolving the forced `discardToLimit` gate, see `mustDiscard` in
 * the main component) — any resource beyond the 10th slot still renders, in
 * a visually distinct rose-bordered "overflow" well, so that moment isn't
 * silently clipped.
 */
function CartInventory({
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

// ---------------------------------------------------------------------------
// Antique-card styling shared by merchant + point card faces — a layered
// inset box-shadow standing in for an engraved parchment border (no image
// asset, same "pure inline SVG/CSS, no external art" convention as
// ResourceIcon.tsx) so both card types read as "real cardboard" rather than
// a plain UI chip.
// ---------------------------------------------------------------------------
const CARD_FRAME_STYLE: React.CSSProperties = {
  background: "linear-gradient(160deg,#f6ecd2 0%,#e7d3a3 50%,#cdac71 100%)",
  boxShadow:
    "inset 0 0 0 1px rgba(120,90,40,0.55), inset 0 0 0 3px rgba(255,250,235,0.5), inset 0 2px 4px rgba(255,255,255,0.5), inset 0 -3px 6px rgba(90,60,20,0.3), 0 1px 2px rgba(0,0,0,0.4)",
};

/** A small purple engraved arrow, matching the physical card's "production/conversion" glyph. */
function ArrowGlyph({ className = "h-4 w-4 text-violet-700" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <rect x="9" y="1" width="6" height="10" rx="1" />
      <polygon points="3,11 21,11 12,22" />
    </svg>
  );
}

/** "Any cube → next tier cube" glyph for upgrade cards, abstracted since no card art exists. */
function UpgradeGlyph() {
  return (
    <div className="flex items-center gap-1">
      <span className="h-3.5 w-3.5 rounded-sm border border-black/25 bg-white/80 shadow-inner" />
      <ArrowGlyph className="h-4 w-4 -rotate-90 text-sky-700" />
      <span className="h-3.5 w-3.5 rounded-sm border border-black/25 bg-gradient-to-br from-amber-300 to-amber-600 shadow-inner" />
    </div>
  );
}

/** Resource cubes stacked/wrapped together, mimicking the physical card's stacked-cube icon column. */
function CubeStack({ bundle }: { bundle: ResourceBundle }) {
  const entries: Resource[] = [];
  for (const r of RESOURCE_ORDER) {
    for (let i = 0; i < (bundle[r] ?? 0); i++) entries.push(r);
  }
  if (entries.length === 0) return <span className="text-[9px] text-black/30">—</span>;
  return (
    <div className="flex flex-wrap items-center justify-center gap-0.5">
      {entries.map((r, i) => (
        <ResourceIcon key={i} resource={r} className="h-4 w-4 drop-shadow-[0_1px_1px_rgba(0,0,0,0.4)]" />
      ))}
    </div>
  );
}

function MerchantCardFace({ card }: { card: MerchantCard }) {
  const frameClass = "relative flex w-full flex-col items-center gap-1 rounded-md border border-[#7a5a2e] px-1.5 py-2";
  if (card.effect.kind === "production") {
    return (
      <div className={frameClass} style={CARD_FRAME_STYLE}>
        <span className="text-[8px] font-bold uppercase tracking-widest text-emerald-800">생산</span>
        <ArrowGlyph className="h-3.5 w-3.5 text-emerald-700" />
        <CubeStack bundle={card.effect.gain} />
      </div>
    );
  }
  if (card.effect.kind === "upgrade") {
    return (
      <div className={frameClass} style={CARD_FRAME_STYLE}>
        <span className="text-[8px] font-bold uppercase tracking-widest text-sky-800">업그레이드</span>
        <UpgradeGlyph />
        <span className="text-sm font-black text-sky-900">×{card.effect.upgrades}</span>
      </div>
    );
  }
  return (
    <div className={frameClass} style={CARD_FRAME_STYLE}>
      <span className="text-[8px] font-bold uppercase tracking-widest text-amber-900">교환</span>
      <CubeStack bundle={card.effect.cost} />
      <ArrowGlyph className="h-4 w-4 text-violet-700" />
      <CubeStack bundle={card.effect.gain} />
    </div>
  );
}

/**
 * Stacked, overlapping 3D coin visual for the gold(3점)/silver(1점) bonus
 * slots — every capped supply slot (`capacity`, i.e. `playerCount * 2`, see
 * engine.ts's `goldSupply`/`silverSupply` init) is always rendered so a coin
 * being spent is a CSS *transition* (opacity/transform) on that slot rather
 * than a DOM add/remove, giving a smooth "stack gets shorter" shrink instead
 * of an abrupt count change. Rendered slots are capped at 8 for physical
 * stack height even when `capacity` is higher (5p games start at 10).
 */
function CoinStack({ kind, count, capacity }: { kind: "gold" | "silver"; count: number; capacity: number }) {
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
                // A faint light ring on every visible coin, independent of
                // its own color — without it, a dark-gold coin's edge blends
                // almost invisibly into this board's dark felt background
                // (silver's pale edge has enough natural contrast on its
                // own), which made a full gold stack look like a single
                // coin next to a clearly-tall silver stack at equal counts.
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

function PointCardFace({
  card,
  affordable,
  slotBonus,
  goldSupply,
  silverSupply,
  coinCapacity,
}: {
  card: PointCard;
  affordable: boolean;
  slotBonus: "gold" | "silver" | null;
  goldSupply: number;
  silverSupply: number;
  coinCapacity: number;
}) {
  return (
    <div
      className={`relative flex w-full flex-col items-center gap-1 rounded-lg border px-1.5 pb-1.5 pt-2 transition ${
        affordable ? "border-amber-300 shadow-[0_0_16px_-2px_rgba(251,191,36,0.75)]" : "border-[#8a6d3b]"
      }`}
      style={CARD_FRAME_STYLE}
    >
      {slotBonus && (
        // z-20 (plus pointer-events-none, since this is decorative) forces
        // this coin stack to always paint above the card's own content —
        // without it, whether this ends up above or partly clipped behind
        // the card depended on the card's own conditional classes (its
        // `affordable` glow/opacity), which was never a property this stack
        // should have had to care about.
        <div className="pointer-events-none absolute -top-9 left-1/2 z-20 -translate-x-1/2">
          <CoinStack kind={slotBonus} count={slotBonus === "gold" ? goldSupply : silverSupply} capacity={coinCapacity} />
        </div>
      )}
      <span
        className="text-2xl leading-none font-black"
        style={{ color: "#5c3a12", fontFamily: "Georgia, 'Times New Roman', serif", textShadow: "0 1px 0 rgba(255,255,255,0.5)" }}
      >
        {card.points}
      </span>
      <div className="mt-1 flex flex-wrap items-center justify-center gap-1 rounded-md border border-black/10 bg-black/5 px-1.5 py-1">
        {RESOURCE_ORDER.filter((r) => (card.cost[r] ?? 0) > 0).map((r) => (
          <span key={r} className="flex items-center gap-0.5">
            <ResourceIcon resource={r} className="h-4 w-4" />
            <span className="text-[10px] font-bold" style={{ color: "#3f2408" }}>
              ×{card.cost[r]}
            </span>
          </span>
        ))}
      </div>
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
function DeckStack({ label, count, accent }: { label: string; count: number; accent: string }) {
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
 * bank (see engine.ts's module doc — production/trade gains are never
 * blocked by scarcity), so this renders a fixed handful of cubes rather than
 * a live count; it exists purely to make the mat read as "a real spice
 * board" the way the physical game's four bowls sit at the head of the
 * board, not as a functional resource picker.
 */
function SpiceBowl({ resource }: { resource: Resource }) {
  const meta = RESOURCE_META[resource];
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className="relative flex h-9 w-12 items-end justify-center overflow-hidden rounded-b-[999px] rounded-t-md pb-1 sm:h-11 sm:w-14"
        style={{
          background: "linear-gradient(180deg, #d8c9a3 0%, #b89a68 55%, #7c5f38 100%)",
          boxShadow: "inset 0 4px 6px rgba(0,0,0,0.45), inset 0 -2px 2px rgba(255,255,255,0.25), 0 3px 4px rgba(0,0,0,0.5)",
          border: "1px solid #4a3617",
        }}
      >
        <div className="flex flex-wrap items-center justify-center gap-0.5 px-1">
          {Array.from({ length: 5 }, (_, i) => (
            <ResourceCube key={i} resource={resource} className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
          ))}
        </div>
      </div>
      <span className="text-[8px] font-semibold tracking-wide text-white/50 sm:text-[9px]">{meta.label.split(" ")[0]}</span>
    </div>
  );
}

export default function CenturyBoard({ state, viewerSeat, names, connectedSeats, onAction, onGameEnd }: CenturyBoardProps) {
  const [rulebookOpen, setRulebookOpen] = useState(false);
  const [acquiring, setAcquiring] = useState<{ index: number; payment: Resource[] } | null>(null);
  const [upgrading, setUpgrading] = useState<{ cardId: string; steps: Resource[] } | null>(null);
  const [trading, setTrading] = useState<{ cardId: string; repeats: number } | null>(null);
  const [discardPick, setDiscardPick] = useState<ResourceBundle>({});
  // Production-card plays and point-card claims used to dispatch straight
  // off a single click with no way to back out of a misclick — unlike
  // upgrade/trade/acquire, which already stage their choice in local state
  // behind a modal's "취소"/"확정" pair. These two mirror that same
  // stage-then-confirm shape (see ConfirmActionModal below) purely so a
  // misclick can be cancelled before anything reaches `onAction` — nothing
  // is ever sent to the engine (and thus the network) until "확정".
  const [confirmingProduction, setConfirmingProduction] = useState<MerchantCard | null>(null);
  const [confirmingClaim, setConfirmingClaim] = useState<number | null>(null);

  // Whenever the state prop changes (my own action resolved, or an
  // opponent's action arrived over the network), any in-progress local
  // selection is now stale — clear it. Adjusting state during render off a
  // prop-identity diff (not inside a useEffect) mirrors the pattern already
  // used by NoThanksBoard/AvalonBoard in this project. This is also where we
  // notice "a merchant card was just acquired" (see MerchantEffects.tsx) —
  // the same diff-two-snapshots technique NoThanksBoard uses for its
  // coin-toss/card-collect flourishes, so every connected client (not just
  // whoever clicked "확정") renders the same collection effect.
  const [trackedState, setTrackedState] = useState(state);
  const [effects, setEffects] = useState<AcquireAnimEvent[]>([]);
  if (trackedState !== state) {
    const detected = detectAcquireEvent(trackedState, state);
    setTrackedState(state);
    setAcquiring(null);
    setUpgrading(null);
    setTrading(null);
    setDiscardPick({});
    setConfirmingProduction(null);
    setConfirmingClaim(null);
    if (detected) {
      setEffects((prev) => [...prev, { ...detected, id: (prev.at(-1)?.id ?? 0) + 1 }]);
    }
  }
  const handleEffectDone = useCallback((id: number) => {
    setEffects((prev) => prev.filter((e) => e.id !== id));
  }, []);

  // Slot-index-keyed (not card-id-keyed — see MerchantEffects.tsx's doc
  // comment) refs so a flying-resource animation can read "where the
  // acquired card used to sit" even after the market has already shifted.
  const merchantSlotRefs = useRef(new Map<number, HTMLElement>());
  function setMerchantSlotRef(index: number) {
    return (el: HTMLDivElement | null) => {
      if (el) merchantSlotRefs.current.set(index, el);
      else merchantSlotRefs.current.delete(index);
    };
  }
  const cartRef = useRef<HTMLDivElement | null>(null);
  const playerSummaryRefs = useRef(new Map<SeatIndex, HTMLElement>());
  function setPlayerSummaryRef(seat: SeatIndex) {
    return (el: HTMLDivElement | null) => {
      if (el) playerSummaryRefs.current.set(seat, el);
      else playerSummaryRefs.current.delete(seat);
    };
  }
  // The card that just landed in a hand via an in-flight collection effect —
  // used to give it a brief highlight ring so "the resources you saw fly in
  // became this card" reads clearly.
  const highlightedCardId = effects.find((e) => e.seat === viewerSeat)?.cardId ?? null;

  const me = state.players.find((p) => p.seat === viewerSeat)!;
  const isMyTurn = state.phase === "playing" && state.activeSeat === viewerSeat;
  const mustDiscard = state.phase === "discarding" && state.awaitingDiscardSeat === viewerSeat;

  const rulebookButton = (
    <button
      onClick={() => setRulebookOpen(true)}
      className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/60 transition hover:border-white/30 hover:text-white"
    >
      📖 센추리 룰북
    </button>
  );

  // ---------------------------------------------------------------------
  // Game over
  // ---------------------------------------------------------------------
  if (state.phase === "gameOver") {
    const rankings = computeRankings(state);
    return (
      <div className={`${MAT} flex flex-col items-center gap-5 text-center sm:p-8`} style={MAT_STYLE}>
        <span className="text-5xl">🏆</span>
        <h2 className="text-2xl font-bold text-amber-100">{names[rankings[0].seat]}님 승리!</h2>
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse text-xs">
            <thead>
              <tr className="text-white/50">
                <th className="border-b border-white/10 px-2 py-2 text-left">순위</th>
                <th className="border-b border-white/10 px-2 py-2 text-left">플레이어</th>
                <th className="border-b border-white/10 px-2 py-2 text-right">점수 카드</th>
                <th className="border-b border-white/10 px-2 py-2 text-right">금화</th>
                <th className="border-b border-white/10 px-2 py-2 text-right">은화</th>
                <th className="border-b border-white/10 px-2 py-2 text-right">잔여 자원</th>
                <th className="border-b border-white/10 px-2 py-2 text-right">총점</th>
              </tr>
            </thead>
            <tbody>
              {rankings.map(({ seat, rank, score }) => (
                <tr key={seat} className={rank === 1 ? "bg-amber-400/10" : ""}>
                  <td className="border-b border-white/5 px-2 py-2 text-left font-bold text-amber-200">{rank === 1 ? "🏆 1" : rank}</td>
                  <td className="border-b border-white/5 px-2 py-2 text-left text-white">
                    {names[seat]}
                    {seat === viewerSeat && <span className="ml-1 text-amber-200">(나)</span>}
                  </td>
                  <td className="border-b border-white/5 px-2 py-2 text-right">{score.pointCardScore}</td>
                  <td className="border-b border-white/5 px-2 py-2 text-right">{score.goldScore}</td>
                  <td className="border-b border-white/5 px-2 py-2 text-right">{score.silverScore}</td>
                  <td className="border-b border-white/5 px-2 py-2 text-right">{score.resourceScore}</td>
                  <td className="border-b border-white/5 px-2 py-2 text-right font-bold text-white">{score.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button onClick={onGameEnd} className="rounded-full bg-emerald-500 px-8 py-3 font-medium text-white transition hover:bg-emerald-400">
          결과 확정하고 계속하기
        </button>
      </div>
    );
  }

  // ---------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------
  function playCard(card: MerchantCard) {
    if (!isMyTurn) return;
    if (card.effect.kind === "production") {
      // No resources to choose here, but still staged behind a confirm step
      // (rather than dispatched immediately) so a misclick on the wrong
      // hand card can be cancelled — see the state doc comment above.
      setConfirmingProduction(card);
    } else if (card.effect.kind === "upgrade") {
      setUpgrading({ cardId: card.id, steps: [] });
    } else {
      setTrading({ cardId: card.id, repeats: 1 });
    }
  }

  function startAcquire(index: number) {
    if (!isMyTurn || !state.merchantMarket[index]) return;
    if (index > 0 && !canAcquireMerchant(me, index)) return;
    // Slot 0 is always free (no resources to stake), but still routes
    // through AcquireModal rather than dispatching immediately — see
    // AcquireModal's `index === 0` branch — so a misclick can be cancelled.
    setAcquiring({ index, payment: [] });
  }

  function claimPoint(index: number) {
    if (!isMyTurn) return;
    const card = state.pointMarket[index];
    if (!card || !canClaimPoint(me, card)) return;
    setConfirmingClaim(index);
  }

  function toggleDiscard(resource: Resource) {
    setDiscardPick((prev) => {
      const have = me.resources[resource] ?? 0;
      const picked = prev[resource] ?? 0;
      if (picked >= have) return prev;
      return { ...prev, [resource]: picked + 1 };
    });
  }
  function undoDiscard(resource: Resource) {
    setDiscardPick((prev) => {
      const picked = prev[resource] ?? 0;
      if (picked <= 0) return prev;
      const next = { ...prev, [resource]: picked - 1 };
      if (next[resource] === 0) delete next[resource];
      return next;
    });
  }
  const discardRemaining = bundleTotal(me.resources) - bundleTotal(discardPick) - HAND_LIMIT;

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------
  return (
    <div className={`${MAT} flex flex-col gap-3`} style={MAT_STYLE}>
      <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs text-amber-100/70">
        <span>
          {state.playerCount}인 · {state.pointCardGoal}장 달성 시 게임 종료
          {state.endTriggered && <span className="ml-1 text-rose-300">· 마지막 라운드 진행 중</span>}
        </span>
        <div className="flex gap-1.5">{rulebookButton}</div>
      </div>

      <p className={`text-center text-xs font-medium ${isMyTurn ? "text-amber-200" : "text-white/50"}`}>
        {mustDiscard
          ? "⚠️ 자원이 10개를 초과했습니다 — 버릴 자원을 선택하세요."
          : isMyTurn
            ? "🫵 당신 차례입니다! 카드 사용 / 카드 획득 / 휴식 / 점수 카드 완성 중 하나를 고르세요."
            : `${names[state.activeSeat]}님 차례를 기다리는 중...`}
      </p>

      {/* Central market board — a felt/carpet surface holding the spice
          bowls, the point-card market (with its gold/silver coin stacks and
          deck), and the merchant-card market (with its own deck). */}
      <section className={FELT} style={FELT_STYLE}>
        <div className="mb-2.5 flex items-center justify-center gap-2.5 sm:gap-5">
          {RESOURCE_ORDER.map((r) => (
            <SpiceBowl key={r} resource={r} />
          ))}
        </div>

        {/* Point card market + its deck */}
        <div className="mb-3 flex items-start gap-1.5 sm:gap-2.5">
          <div className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/25 p-2 sm:p-2.5">
            <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-orange-200/70 uppercase">점수 카드</h3>
            <div className="grid grid-cols-5 gap-1.5 pt-9">
              {Array.from({ length: POINT_MARKET_SIZE }, (_, i) => {
                const card = state.pointMarket[i];
                const bonus: "gold" | "silver" | null = i === 0 ? "gold" : i === 1 ? "silver" : null;
                if (!card) return <div key={i} className="rounded-xl border border-dashed border-white/10" />;
                const affordable = isMyTurn && canClaimPoint(me, card);
                return (
                  <button
                    key={card.id}
                    disabled={!affordable}
                    onClick={() => claimPoint(i)}
                    className={`text-left transition ${affordable ? "cursor-pointer hover:scale-[1.03]" : "cursor-not-allowed opacity-90"}`}
                  >
                    <PointCardFace
                      card={card}
                      affordable={affordable}
                      slotBonus={bonus}
                      goldSupply={state.goldSupply}
                      silverSupply={state.silverSupply}
                      coinCapacity={state.playerCount * 2}
                    />
                  </button>
                );
              })}
            </div>
          </div>
          <DeckStack label="점수 덱" count={state.pointDeck.length} accent="#92400e" />
        </div>

        {/* Merchant card market + its deck */}
        <div className="flex items-start gap-1.5 sm:gap-2.5">
          <div className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/25 p-2 sm:p-2.5">
            <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-emerald-200/70 uppercase">상인 카드</h3>
            <div className="grid grid-cols-3 gap-2 pt-2.5 sm:grid-cols-6">
              {Array.from({ length: MERCHANT_MARKET_SIZE }, (_, i) => {
                const card = state.merchantMarket[i];
                const staked = state.merchantMarketResources[i] ?? {};
                const stakedEntries: Resource[] = [];
                for (const r of RESOURCE_ORDER) for (let k = 0; k < (staked[r] ?? 0); k++) stakedEntries.push(r);
                if (!card) return <div key={i} ref={setMerchantSlotRef(i)} className="rounded-xl border border-dashed border-white/10" />;
                const affordable = isMyTurn && canAcquireMerchant(me, i);
                return (
                  <div key={card.id} ref={setMerchantSlotRef(i)} className="relative">
                    {/* Resources staked onto this card sit visually on top of
                        it — see MerchantEffects.tsx for the "collected
                        together" flourish that plays when the card (and
                        these cubes) are taken into a hand. */}
                    {stakedEntries.length > 0 && (
                      <div className="pointer-events-none absolute -top-2.5 right-0 left-0 z-10 flex flex-wrap items-end justify-center gap-0.5">
                        {stakedEntries.map((r, idx) => (
                          <span
                            key={idx}
                            className="inline-block drop-shadow-[0_2px_2px_rgba(0,0,0,0.6)]"
                            style={{ transform: `rotate(${(idx % 2 === 0 ? -1 : 1) * (8 + idx * 3)}deg) translateY(${idx % 2}px)` }}
                          >
                            <ResourceCube resource={r} className="h-4 w-4" />
                          </span>
                        ))}
                      </div>
                    )}
                    <button
                      disabled={!affordable}
                      onClick={() => startAcquire(i)}
                      className={`flex w-full flex-col items-center gap-1 rounded-xl border p-1.5 transition ${
                        affordable
                          ? "cursor-pointer border-emerald-300/50 bg-emerald-400/10 hover:scale-[1.03]"
                          : "cursor-not-allowed border-white/10 bg-black/20 opacity-80"
                      }`}
                    >
                      <span className="text-[9px] text-white/40">{i === 0 ? "무료" : `자원 ${i}개`}</span>
                      <MerchantCardFace card={card} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
          <DeckStack label="상인 덱" count={state.merchantDeck.length} accent="#065f46" />
        </div>
      </section>

      {/* My caravan board — a carved wooden cart holding my 10 resource
          wells, gold/silver/point totals, my fanned-out hand, and my
          discard pile (recovered by "휴식"). */}
      <section ref={cartRef} className="rounded-2xl border p-2.5 sm:p-3" style={CARAVAN_STYLE}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-1.5">
          <h3 className="text-[11px] font-semibold tracking-wide text-amber-200/90 uppercase">🐫 내 수레 (Caravan)</h3>
          <span
            className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${
              bundleTotal(me.resources) > HAND_LIMIT ? "border-rose-400/60 text-rose-300" : "border-amber-200/30 text-amber-100/80"
            }`}
          >
            {bundleTotal(me.resources)} / {HAND_LIMIT}
          </span>
        </div>
        <CartInventory resources={me.resources} limit={HAND_LIMIT} />
        <div className="mt-2.5 flex flex-wrap gap-3 text-xs text-amber-50/80">
          <span>🪙 금화 {me.gold}</span>
          <span>🥈 은화 {me.silver}</span>
          <span>🏆 점수 카드 {me.pointCards.length}장</span>
        </div>

        <div className="mt-3 rounded-xl border border-black/30 bg-black/20 p-2 sm:p-2.5">
          <h4 className="mb-1 text-[11px] font-semibold tracking-wide text-sky-200/80 uppercase">내 손패 (Hand)</h4>
          <div className="flex flex-wrap items-end justify-center gap-y-2 py-1.5">
            {me.hand.length === 0 && <span className="text-[11px] text-white/30">손패 없음</span>}
            {me.hand.map((card, i) => {
              const mid = (me.hand.length - 1) / 2;
              const offset = i - mid;
              return (
                <button
                  key={card.id}
                  disabled={!isMyTurn}
                  onClick={() => playCard(card)}
                  style={{
                    transform: `rotate(${offset * 4}deg) translateY(${Math.abs(offset) * 5}px)`,
                    marginLeft: i === 0 ? 0 : -14,
                    zIndex: i,
                  }}
                  className={`relative rounded-xl border p-2 transition ${
                    isMyTurn
                      ? "cursor-pointer border-sky-300/40 bg-sky-400/10 hover:z-20 hover:brightness-110"
                      : "cursor-not-allowed border-white/10 bg-black/20 opacity-70"
                  } ${card.id === highlightedCardId ? "ring-2 ring-amber-300 ring-offset-2 ring-offset-[#1c1208]" : ""}`}
                >
                  <MerchantCardFace card={card} />
                </button>
              );
            })}
          </div>

          {me.playedCards.length > 0 && (
            <>
              <h4 className="mt-2 mb-1 text-[10px] font-semibold tracking-wide text-white/40 uppercase">
                버린 카드 더미 (Discarded — 휴식 시 회수)
              </h4>
              <div className="flex flex-wrap items-center py-1 pl-3">
                {me.playedCards.map((card, i) => (
                  <div
                    key={card.id}
                    style={{ marginLeft: i === 0 ? 0 : -26, transform: `rotate(${(i % 2 === 0 ? -1 : 1) * (3 + (i % 4))}deg)`, zIndex: i }}
                    className="rounded-xl border border-white/10 bg-black/30 p-2 opacity-60 grayscale"
                  >
                    <MerchantCardFace card={card} />
                  </div>
                ))}
              </div>
            </>
          )}

          <button
            disabled={!isMyTurn || me.playedCards.length === 0}
            onClick={() => onAction({ type: "rest", seat: viewerSeat })}
            className="mt-2.5 w-full rounded-xl bg-indigo-600 py-2 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
          >
            😴 휴식 (사용한 카드 전부 회수)
          </button>
        </div>
      </section>

      {/* Other players */}
      <section className="flex flex-col gap-1.5">
        {state.players
          .filter((p) => p.seat !== viewerSeat)
          .map((p) => (
            <PlayerSummaryRow
              key={p.seat}
              player={p}
              name={names[p.seat]}
              isActive={state.activeSeat === p.seat}
              connected={connectedSeats.has(p.seat)}
              setRef={setPlayerSummaryRef(p.seat)}
            />
          ))}
      </section>

      {/* Merchant-card resource collection flourishes — see MerchantEffects.tsx. */}
      {effects.map((e) => (
        <FlyingResourceBurst
          key={e.id}
          event={e}
          getSourceEl={() => merchantSlotRefs.current.get(e.fromIndex) ?? null}
          getTargetEl={() => (e.seat === viewerSeat ? cartRef.current : (playerSummaryRefs.current.get(e.seat) ?? null))}
          onDone={handleEffectDone}
        />
      ))}

      {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}

      {upgrading && (
        <UpgradeModal
          me={me}
          cardId={upgrading.cardId}
          steps={upgrading.steps}
          onChangeSteps={(steps) => setUpgrading({ cardId: upgrading.cardId, steps })}
          onCancel={() => setUpgrading(null)}
          onConfirm={() => {
            onAction({ type: "playUpgrade", seat: viewerSeat, cardId: upgrading.cardId, upgrades: upgrading.steps });
            setUpgrading(null);
          }}
        />
      )}

      {trading && (
        <TradeModal
          me={me}
          cardId={trading.cardId}
          repeats={trading.repeats}
          onChangeRepeats={(repeats) => setTrading({ cardId: trading.cardId, repeats })}
          onCancel={() => setTrading(null)}
          onConfirm={() => {
            onAction({ type: "playTrade", seat: viewerSeat, cardId: trading.cardId, repeats: trading.repeats });
            setTrading(null);
          }}
        />
      )}

      {acquiring && (
        <AcquireModal
          me={me}
          index={acquiring.index}
          payment={acquiring.payment}
          onChangePayment={(payment) => setAcquiring({ index: acquiring.index, payment })}
          onCancel={() => setAcquiring(null)}
          onConfirm={() => {
            onAction({ type: "acquireMerchant", seat: viewerSeat, index: acquiring.index, payment: acquiring.payment });
            setAcquiring(null);
          }}
        />
      )}

      {mustDiscard && (
        <DiscardModal
          me={me}
          discardPick={discardPick}
          remaining={discardRemaining}
          onPick={toggleDiscard}
          onUndo={undoDiscard}
          onReset={() => setDiscardPick({})}
          onConfirm={() => onAction({ type: "discardToLimit", seat: viewerSeat, discard: discardPick })}
        />
      )}

      {confirmingProduction && (
        <ConfirmActionModal
          title="생산 카드 사용"
          description="이 카드를 사용해 아래 자원을 수레에 획득합니다. 잘못 눌렀다면 취소할 수 있습니다."
          preview={<BundleRow bundle={confirmingProduction.effect.kind === "production" ? confirmingProduction.effect.gain : {}} size="h-5 w-5" />}
          confirmColorClass="bg-sky-600"
          onCancel={() => setConfirmingProduction(null)}
          onConfirm={() => {
            onAction({ type: "playProduction", seat: viewerSeat, cardId: confirmingProduction.id });
            setConfirmingProduction(null);
          }}
        />
      )}

      {confirmingClaim !== null && state.pointMarket[confirmingClaim] && (
        <ConfirmActionModal
          title="점수 카드 완성"
          description={`이 점수 카드를 아래 자원으로 지불하고 획득합니다 (+${state.pointMarket[confirmingClaim]!.points}점). 잘못 눌렀다면 취소할 수 있습니다.`}
          preview={<BundleRow bundle={state.pointMarket[confirmingClaim]!.cost} size="h-5 w-5" />}
          confirmColorClass="bg-orange-600"
          onCancel={() => setConfirmingClaim(null)}
          onConfirm={() => {
            onAction({ type: "claimPoint", seat: viewerSeat, index: confirmingClaim });
            setConfirmingClaim(null);
          }}
        />
      )}
    </div>
  );
}

function PlayerSummaryRow({
  player,
  name,
  isActive,
  connected,
  setRef,
}: {
  player: PlayerState;
  name: string;
  isActive: boolean;
  connected: boolean;
  setRef: (el: HTMLDivElement | null) => void;
}) {
  return (
    <div
      ref={setRef}
      className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border p-2 text-xs ${
        isActive ? "border-amber-300/60 bg-amber-400/10" : "border-white/10 bg-black/20"
      }`}
    >
      <span className="flex items-center gap-1.5 font-semibold text-white/90">
        <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-400" : "bg-white/20"}`} />
        {isActive && <span title="차례">👉</span>}
        {name}
      </span>
      <div className="flex flex-wrap items-center gap-2 text-white/70">
        <CartInventory resources={player.resources} limit={HAND_LIMIT} compact />
        <span>🪙{player.gold}</span>
        <span>🥈{player.silver}</span>
        <span>🏆{player.pointCards.length}</span>
        <span title="손패">✋{player.hand.length}</span>
        <span title="사용한 카드">🗂️{player.playedCards.length}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------

function ModalShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl border p-5 shadow-2xl sm:rounded-2xl"
        style={{
          background: "linear-gradient(165deg, #2c1c0e 0%, #1c1208 55%, #120b05 100%)",
          borderColor: "rgba(198,160,90,0.3)",
        }}
      >
        <h3 className="mb-3 text-sm font-bold text-amber-50">{title}</h3>
        {children}
      </div>
    </div>
  );
}

/**
 * Shared "review then confirm or cancel" step for actions that have nothing
 * to choose (production cards, point-card claims) but previously dispatched
 * straight off a single click — see `confirmingProduction`/`confirmingClaim`
 * above. Nothing reaches `onAction` until "확정" is pressed, so "취소" always
 * leaves the hand/cart exactly as it was.
 */
function ConfirmActionModal({
  title,
  description,
  preview,
  confirmLabel = "확정",
  confirmColorClass = "bg-emerald-600",
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  preview?: React.ReactNode;
  confirmLabel?: string;
  confirmColorClass?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ModalShell title={title}>
      <p className="mb-3 text-xs text-white/60">{description}</p>
      {preview && <div className="mb-3 rounded-lg border border-white/10 bg-black/25 p-2">{preview}</div>}
      <div className="flex gap-2">
        <button onClick={onCancel} className="flex-1 rounded-xl border border-white/15 py-2 text-sm text-white/70 hover:border-white/30">
          취소
        </button>
        <button onClick={onConfirm} className={`flex-1 rounded-xl py-2 text-sm font-semibold text-white ${confirmColorClass}`}>
          {confirmLabel}
        </button>
      </div>
    </ModalShell>
  );
}

function UpgradeModal({
  me,
  cardId,
  steps,
  onChangeSteps,
  onCancel,
  onConfirm,
}: {
  me: PlayerState;
  cardId: string;
  steps: Resource[];
  onChangeSteps: (steps: Resource[]) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const card = me.hand.find((c) => c.id === cardId);
  if (!card || card.effect.kind !== "upgrade") return null;
  const maxSteps = card.effect.upgrades;
  const working = simulateUpgrade(me.resources, steps) ?? me.resources;
  const upgradable = RESOURCE_ORDER.filter((r) => r !== "brown" && (working[r] ?? 0) > 0);

  return (
    <ModalShell title={`업그레이드 카드 (최대 ${maxSteps}회)`}>
      <p className="mb-2 text-xs text-white/60">
        {steps.length} / {maxSteps}회 사용 — 업그레이드할 자원을 순서대로 눌러주세요. 같은 자원을 연속으로 누르면 두 단계 위로도 올릴 수 있어요.
      </p>
      <div className="mb-3 rounded-lg border border-white/10 bg-black/25 p-2">
        <p className="mb-1 text-[10px] text-white/40 uppercase">결과 미리보기</p>
        <BundleRow bundle={working} size="h-5 w-5" />
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {upgradable.length === 0 && <span className="text-xs text-white/40">업그레이드할 자원이 없습니다.</span>}
        {upgradable.map((r) => (
          <button
            key={r}
            disabled={steps.length >= maxSteps}
            onClick={() => onChangeSteps([...steps, r])}
            className="flex items-center gap-1.5 rounded-full border border-sky-300/40 bg-sky-400/10 px-2.5 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ResourceCube resource={r} className="h-4 w-4" /> 업그레이드
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <button onClick={onCancel} className="flex-1 rounded-xl border border-white/15 py-2 text-sm text-white/70 hover:border-white/30">
          취소
        </button>
        {steps.length > 0 && (
          <button onClick={() => onChangeSteps(steps.slice(0, -1))} className="flex-1 rounded-xl border border-white/15 py-2 text-sm text-white/70 hover:border-white/30">
            되돌리기
          </button>
        )}
        <button onClick={onConfirm} disabled={steps.length === 0} className="flex-1 rounded-xl bg-sky-600 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30">
          확정
        </button>
      </div>
    </ModalShell>
  );
}

function TradeModal({
  me,
  cardId,
  repeats,
  onChangeRepeats,
  onCancel,
  onConfirm,
}: {
  me: PlayerState;
  cardId: string;
  repeats: number;
  onChangeRepeats: (n: number) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const card = me.hand.find((c) => c.id === cardId);
  if (!card || card.effect.kind !== "trade") return null;
  const max = Math.max(1, maxTradeRepeats(me, card.effect.cost));
  const totalCost: ResourceBundle = {};
  const totalGain: ResourceBundle = {};
  for (const r of RESOURCE_ORDER) {
    if (card.effect.cost[r]) totalCost[r] = card.effect.cost[r]! * repeats;
    if (card.effect.gain[r]) totalGain[r] = card.effect.gain[r]! * repeats;
  }

  return (
    <ModalShell title="교환 카드 — 반복 횟수 선택">
      <div className="mb-3 flex items-center justify-center gap-3">
        <button
          onClick={() => onChangeRepeats(Math.max(1, repeats - 1))}
          className="h-8 w-8 rounded-full border border-white/15 text-white/80 hover:border-white/30"
        >
          −
        </button>
        <span className="w-10 text-center text-lg font-bold text-white">{repeats}회</span>
        <button
          onClick={() => onChangeRepeats(Math.min(max, repeats + 1))}
          className="h-8 w-8 rounded-full border border-white/15 text-white/80 hover:border-white/30"
        >
          +
        </button>
      </div>
      <div className="mb-3 flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-black/25 p-3">
        <BundleRow bundle={totalCost} size="h-5 w-5" />
        <span className="text-white/50">→</span>
        <BundleRow bundle={totalGain} size="h-5 w-5" />
      </div>
      <div className="flex gap-2">
        <button onClick={onCancel} className="flex-1 rounded-xl border border-white/15 py-2 text-sm text-white/70 hover:border-white/30">
          취소
        </button>
        <button onClick={onConfirm} disabled={max === 0} className="flex-1 rounded-xl bg-amber-600 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30">
          확정
        </button>
      </div>
    </ModalShell>
  );
}

function AcquireModal({
  me,
  index,
  payment,
  onChangePayment,
  onCancel,
  onConfirm,
}: {
  me: PlayerState;
  index: number;
  payment: Resource[];
  onChangePayment: (payment: Resource[]) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const remaining = subtractBundle(me.resources, payment.reduce<ResourceBundle>((acc, r) => ({ ...acc, [r]: (acc[r] ?? 0) + 1 }), {}));
  const done = payment.length === index;
  const isFree = index === 0;
  return (
    <ModalShell title={isFree ? "상인 카드 획득 — 무료" : `상인 카드 획득 — 자원 ${index}개 배치`}>
      <p className="mb-2 text-xs text-white/60">
        {isFree
          ? "가장 왼쪽 카드는 대가 없이 무료로 가져옵니다. 잘못 눌렀다면 취소할 수 있습니다."
          : `앞에 놓인 ${index}장의 카드 위에 자원을 1개씩 올려야 합니다 (${payment.length}/${index}).`}
      </p>
      {!isFree && (
        <>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {RESOURCE_ORDER.map((r) => (
              <button
                key={r}
                disabled={done || (remaining[r] ?? 0) <= 0}
                onClick={() => onChangePayment([...payment, r])}
                className="flex items-center gap-1.5 rounded-full border border-emerald-300/40 bg-emerald-400/10 px-2.5 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ResourceCube resource={r} className="h-4 w-4" /> {remaining[r] ?? 0}
              </button>
            ))}
          </div>
          <div className="mb-3 rounded-lg border border-white/10 bg-black/25 p-2">
            <p className="mb-1 text-[10px] text-white/40 uppercase">배치할 자원</p>
            <BundleRow bundle={payment.reduce<ResourceBundle>((acc, r) => ({ ...acc, [r]: (acc[r] ?? 0) + 1 }), {})} size="h-5 w-5" />
          </div>
        </>
      )}
      <div className="flex gap-2">
        <button onClick={onCancel} className="flex-1 rounded-xl border border-white/15 py-2 text-sm text-white/70 hover:border-white/30">
          취소
        </button>
        {payment.length > 0 && (
          <button onClick={() => onChangePayment(payment.slice(0, -1))} className="flex-1 rounded-xl border border-white/15 py-2 text-sm text-white/70 hover:border-white/30">
            되돌리기
          </button>
        )}
        <button onClick={onConfirm} disabled={!done} className="flex-1 rounded-xl bg-emerald-600 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30">
          확정
        </button>
      </div>
    </ModalShell>
  );
}

function DiscardModal({
  me,
  discardPick,
  remaining,
  onPick,
  onUndo,
  onReset,
  onConfirm,
}: {
  me: PlayerState;
  discardPick: ResourceBundle;
  remaining: number;
  onPick: (r: Resource) => void;
  onUndo: (r: Resource) => void;
  onReset: () => void;
  onConfirm: () => void;
}) {
  const hasPicks = bundleTotal(discardPick) > 0;
  return (
    <ModalShell title="자원 10개 초과 — 버릴 자원 선택">
      <p className="mb-2 text-xs text-white/60">{remaining > 0 ? `${remaining}개 더 버려야 합니다.` : "정확히 10개가 되었습니다."}</p>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {RESOURCE_ORDER.filter((r) => (me.resources[r] ?? 0) > 0).map((r) => (
          <div key={r} className="flex items-center gap-1 rounded-full border border-rose-300/40 bg-rose-400/10 px-2 py-1">
            <ResourceCube resource={r} className="h-4 w-4" />
            <button onClick={() => onUndo(r)} className="px-1 text-white/70 hover:text-white">
              −
            </button>
            <span className="w-4 text-center text-xs text-white">{discardPick[r] ?? 0}</span>
            <button onClick={() => onPick(r)} disabled={(discardPick[r] ?? 0) >= (me.resources[r] ?? 0)} className="px-1 text-white/70 hover:text-white disabled:opacity-30">
              +
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        {hasPicks && (
          <button onClick={onReset} className="flex-1 rounded-xl border border-white/15 py-2 text-sm text-white/70 hover:border-white/30">
            선택 해제
          </button>
        )}
        <button
          onClick={onConfirm}
          disabled={remaining !== 0}
          className="flex-1 rounded-xl bg-rose-600 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
        >
          버리기 확정
        </button>
      </div>
    </ModalShell>
  );
}
