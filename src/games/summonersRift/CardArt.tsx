import Image from "next/image";
import { getItemDef, getMonsterDef, type ItemId } from "./engine";
import { ITEM_IMAGES, MONSTER_IMAGES } from "./assets";

/**
 * Presentational card-face building blocks shared by `SummonersRiftBoard.tsx`
 * — the equipped/unequipped item slot, a face-up monster card, and the
 * pure-CSS face-down back used everywhere a card's identity must stay hidden
 * (the Rift pile, in-progress draws by other seats). No game logic here.
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
