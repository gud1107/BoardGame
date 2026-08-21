import Image from "next/image";
import { getItemDef, getMonsterDef, type ItemId } from "./engine";
import { HERO_IMAGE, ITEM_IMAGES, MONSTER_IMAGES } from "./assets";

/**
 * Presentational card-face building blocks shared by `SummonersRiftBoard.tsx`
 * — the equipped/unequipped item slot, a face-up monster card, the shared
 * champion tile, face-down card-back stacks (the draw deck / Rift pile), the
 * per-player "removed items" ownership overlay, and the pure-CSS face-down
 * back used everywhere a card's identity must stay hidden (the Rift pile,
 * in-progress draws by other seats). No game logic here.
 */

const RUNE_GOLD = "#c8aa6e";

/** Face-down card back — an antique summoner-rune motif, since no card-back photo exists in the source folder (see assets.ts). Reused for both the Rift pile stack and any other seat's in-progress draw. */
export function DeckBack({ className = "" }: { className?: string }) {
  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden rounded-lg border ${className}`}
      style={{
        borderColor: "rgba(200,170,110,0.45)",
        background: "linear-gradient(155deg,#1a2332 0%,#0c1119 55%,#050709 100%)",
      }}
    >
      <div
        className="absolute inset-1 rounded-md border border-dashed"
        style={{ borderColor: "rgba(200,170,110,0.25)" }}
      />
      <span className="text-[10px] font-black tracking-widest opacity-70" style={{ color: RUNE_GOLD }}>
        ⛨
      </span>
    </div>
  );
}

/**
 * A face-down pile of `count` cards fanned out left-to-right (`DeckBack`
 * repeated, capped at `maxVisible` so a 13-card deck doesn't sprawl offscreen)
 * with the remaining count badged on the topmost (rightmost/highest z-index)
 * card — task brief §1 "카드더미 위에 잔여 매수를 표시". Shared by the monster
 * draw deck and the Rift accumulation pile; both only ever show card *backs*
 * since a pile's contents are secret.
 */
export function CardPileStack({
  count,
  maxVisible = 8,
  size = "md",
  emptyHint,
}: {
  count: number;
  maxVisible?: number;
  size?: "sm" | "md";
  emptyHint?: string;
}) {
  const dims = size === "sm" ? "h-14 w-11" : "h-16 w-12";
  const offset = size === "sm" ? 7 : 8;
  const cardWidth = size === "sm" ? 44 : 48;
  const visible = Math.min(count, maxVisible);

  if (count === 0) {
    return (
      <div className={`flex items-center justify-center ${dims} rounded-lg border border-dashed border-white/15`}>
        {emptyHint && <span className="px-1 text-center text-[9px] leading-tight text-white/30">{emptyHint}</span>}
      </div>
    );
  }

  return (
    <div className="relative flex items-center" style={{ height: size === "sm" ? 56 : 64, width: cardWidth + (visible - 1) * offset }}>
      {Array.from({ length: visible }).map((_, i) => (
        <div key={i} className="absolute" style={{ left: `${i * offset}px`, zIndex: i }}>
          <DeckBack className={dims} />
        </div>
      ))}
      <span
        className="absolute -top-1.5 z-20 flex h-5 min-w-5 items-center justify-center rounded-full border px-1 text-[10px] font-black text-black"
        style={{ left: `${(visible - 1) * offset + cardWidth - 10}px`, borderColor: "rgba(0,0,0,0.3)", background: RUNE_GOLD }}
        title="남은 카드"
      >
        {count}
      </span>
    </div>
  );
}

/**
 * The shared champion tile (rulebook §2-A) — a static card (its "HP:3" base
 * label is baked into `HERO_IMAGE` itself, since the base never changes; the
 * *live* total HP with item bonuses is computed and shown separately by the
 * caller, never overlaid here — see assets.ts's doc on `HERO_IMAGE`).
 */
export function HeroCard({ size = "lg" }: { size?: "md" | "lg" }) {
  const dims = size === "lg" ? "h-32 w-20 sm:h-36 sm:w-24" : "h-24 w-16";
  const imgSize = size === "lg" ? 96 : 72;
  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-lg border-2 ${dims}`}
      style={{ borderColor: "rgba(200,170,110,0.7)", boxShadow: "0 0 16px -3px rgba(200,170,110,0.6)" }}
    >
      <Image src={HERO_IMAGE} alt="용사 (기본 체력 3)" width={imgSize} height={imgSize * 1.8} className="h-full w-full object-cover" />
    </div>
  );
}

export function ItemSlot({
  itemId,
  equipped,
  size = "md",
  highlighted = false,
}: {
  itemId: ItemId;
  equipped: boolean;
  size?: "sm" | "md" | "lg";
  highlighted?: boolean;
}) {
  const item = getItemDef(itemId);
  const dims = size === "lg" ? "h-24 w-20 sm:h-28 sm:w-24" : size === "sm" ? "h-14 w-12" : "h-20 w-16";
  const imgSize = size === "lg" ? 96 : size === "sm" ? 56 : 72;
  return (
    <div
      title={`${item.name} (${item.originName}) — ${item.effect}`}
      className={`flex flex-col items-center gap-1 ${equipped ? "" : "opacity-35 grayscale"}`}
    >
      <div
        className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-lg border-2 ${dims} ${
          highlighted ? "ring-2 ring-amber-300/80" : ""
        }`}
        style={{
          borderColor: equipped ? "rgba(200,170,110,0.65)" : "rgba(255,255,255,0.15)",
          boxShadow: equipped ? "0 0 12px -2px rgba(200,170,110,0.55)" : "none",
          background: "#05070b",
        }}
      >
        <Image src={ITEM_IMAGES[itemId]} alt={item.name} width={imgSize} height={imgSize} className="h-full w-full object-cover" />
        {!equipped && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/55">
            <span className="rounded-full border border-rose-300/60 px-1.5 py-0.5 text-[9px] font-bold text-rose-200">해제됨</span>
          </div>
        )}
      </div>
      {/* Name label only — the card art itself already carries the effect text (see assets.ts's doc), so no redundant caption here. */}
      <span className={`text-center text-[10px] leading-tight font-semibold ${equipped ? "text-amber-100/90" : "text-white/40"}`}>{item.name}</span>
    </div>
  );
}

export function MonsterFace({
  threat,
  size = "md",
  faded = false,
}: {
  threat: number;
  size?: "sm" | "md" | "lg";
  faded?: boolean;
}) {
  const def = getMonsterDef(threat);
  const dims = size === "lg" ? "h-28 w-24 sm:h-32 sm:w-28" : size === "sm" ? "h-16 w-14" : "h-24 w-20";
  const imgSize = size === "lg" ? 112 : size === "sm" ? 64 : 88;
  return (
    <div className={`flex flex-col items-center gap-1 ${faded ? "opacity-40" : ""}`}>
      <div
        className={`relative shrink-0 overflow-hidden rounded-lg border-2 ${dims}`}
        style={{ borderColor: "rgba(220,60,60,0.55)", boxShadow: "0 0 14px -4px rgba(220,60,60,0.5)" }}
      >
        <Image src={MONSTER_IMAGES[threat]} alt={def.name} width={imgSize} height={imgSize} className="h-full w-full object-cover" />
        <span
          className="absolute top-0.5 left-0.5 flex h-5 w-5 items-center justify-center rounded-full border border-rose-200/70 bg-black/70 text-[10px] font-black text-rose-100"
          title="위협도"
        >
          {threat}
        </span>
      </div>
      {size !== "sm" && <span className="text-center text-[10px] leading-tight font-semibold text-rose-100/90">{def.name}</span>}
    </div>
  );
}

/**
 * Per-player "which items did *this* seat strip off the champion this round"
 * ownership marker (task brief §2) — a face-down monster marker (the drawn
 * card they hid instead of rifting it) with every item they've since removed
 * fanned out on top of it at increasing tilt, so the whole table can tell at
 * a glance who's holding what without opening anyone's hand. Renders nothing
 * once `removedItemIds` is empty.
 */
export function HiddenEquipmentStack({ removedItemIds }: { removedItemIds: ItemId[] }) {
  if (removedItemIds.length === 0) return null;
  const title = `해제한 장비: ${removedItemIds.map((id) => getItemDef(id).name).join(", ")}`;
  return (
    <div
      className="relative flex h-9 shrink-0 items-center"
      style={{ width: `${30 + (removedItemIds.length - 1) * 7}px` }}
      title={title}
    >
      <div className="absolute top-0 left-0" style={{ zIndex: 0 }}>
        <DeckBack className="h-9 w-7" />
      </div>
      {removedItemIds.map((id, i) => (
        <div
          key={i}
          className="absolute h-8 w-6 overflow-hidden rounded border shadow-[0_2px_6px_-1px_rgba(0,0,0,0.6)]"
          style={{
            left: `${3 + i * 7}px`,
            top: `${-1 + (i % 2)}px`,
            zIndex: i + 1,
            transform: `rotate(${-16 + i * 9}deg)`,
            borderColor: "rgba(200,170,110,0.7)",
          }}
        >
          <Image src={ITEM_IMAGES[id]} alt={getItemDef(id).name} width={24} height={32} className="h-full w-full object-cover" />
        </div>
      ))}
    </div>
  );
}
