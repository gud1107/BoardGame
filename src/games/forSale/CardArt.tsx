/**
 * Pure presentation data + inline visuals for 포세일 — no game logic. Shared
 * between `ForSaleBoard.tsx` and `ForSaleEffects.tsx` so both render the same
 * card identity (same split as coyote/dalmuti's `CardArt.tsx`). No card
 * photography was provided for this game (see HANDOFF.md), so every card
 * face here is drawn purely with CSS/emoji — property cards read "1번
 * 판잣집 ~ 30번 우주기지" per the task brief's flavor framing, checks are
 * plain green banknotes scaled by value.
 */

/** Flavor tier by property number, from "1번 판잣집" to "30번 우주기지" (task brief §1). */
function propertyTier(value: number): { emoji: string; label: string; from: string; to: string; border: string } {
  if (value >= 30) return { emoji: "🚀", label: "우주기지", from: "#312e81", to: "#0b0a1f", border: "border-indigo-300/60" };
  if (value >= 26) return { emoji: "🏙️", label: "고층 타워", from: "#4c1d95", to: "#150a2e", border: "border-purple-300/50" };
  if (value >= 21) return { emoji: "🏰", label: "대저택", from: "#78350f", to: "#241206", border: "border-amber-300/50" };
  if (value >= 16) return { emoji: "🏢", label: "빌딩", from: "#1e3a5f", to: "#0a141f", border: "border-sky-300/50" };
  if (value >= 11) return { emoji: "🏡", label: "전원주택", from: "#14532d", to: "#061a10", border: "border-emerald-300/50" };
  if (value >= 6) return { emoji: "🏠", label: "주택", from: "#3f3a12", to: "#141205", border: "border-lime-300/40" };
  return { emoji: "🏚️", label: "판잣집", from: "#3a2410", to: "#140d05", border: "border-orange-200/30" };
}

export function propertyGradient(value: number): string {
  const t = propertyTier(value);
  return `linear-gradient(160deg,${t.from} 0%,${t.to} 100%)`;
}

/**
 * A property card face. `value === null` renders the face-down back (used
 * while a Phase-2 submission is still hidden from other seats — see
 * engine.ts's `getPlayerView`).
 */
export function PropertyCard({
  value,
  className = "",
  highlight = false,
  size = "md",
}: {
  value: number | null;
  className?: string;
  highlight?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const dims = size === "sm" ? "h-16 w-11" : size === "lg" ? "h-28 w-20" : "h-20 w-14";
  if (value === null) {
    return (
      <div
        className={`relative flex ${dims} shrink-0 flex-col items-center justify-center rounded-lg border border-dashed border-white/25 bg-gradient-to-br from-sky-950 to-black ${className}`}
      >
        <span className="text-lg opacity-60">🏠</span>
      </div>
    );
  }
  const t = propertyTier(value);
  return (
    <div
      className={`relative flex ${dims} shrink-0 flex-col items-center justify-between rounded-lg border p-1 transition ${t.border} ${
        highlight ? "shadow-[0_0_14px_-2px_rgba(56,189,248,0.85)] ring-2 ring-sky-300/70" : ""
      } ${className}`}
      style={{ background: propertyGradient(value) }}
    >
      <span className="text-sm leading-none">{t.emoji}</span>
      <span className={`leading-none font-black text-white ${size === "lg" ? "text-2xl" : size === "sm" ? "text-base" : "text-lg"}`}>{value}</span>
      <span className="max-w-full truncate text-center text-[7px] leading-tight text-white/60">{t.label}</span>
    </div>
  );
}

export function formatDollars(amount: number): string {
  return `$${amount.toLocaleString("en-US")}`;
}

function checkTierBg(value: number): string {
  if (value >= 12000) return "linear-gradient(160deg,#14532d 0%,#052e14 55%,#021208 100%)";
  if (value >= 6000) return "linear-gradient(160deg,#166534 0%,#062e17 55%,#02150a 100%)";
  if (value <= 0) return "linear-gradient(160deg,#3f3f46 0%,#18181b 55%,#09090b 100%)";
  return "linear-gradient(160deg,#1d4d3a 0%,#0a2419 55%,#04120c 100%)";
}

/** A check card face. `value === null` renders a face-down back (bank deck placeholder). */
export function CheckCard({
  value,
  className = "",
  size = "md",
}: {
  value: number | null;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const dims = size === "sm" ? "h-14 w-20" : size === "lg" ? "h-20 w-32" : "h-16 w-24";
  if (value === null) {
    return (
      <div className={`relative flex ${dims} shrink-0 flex-col items-center justify-center rounded-lg border border-dashed border-white/25 bg-gradient-to-br from-emerald-950 to-black ${className}`}>
        <span className="text-lg opacity-60">🧾</span>
      </div>
    );
  }
  return (
    <div
      className={`relative flex ${dims} shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg border border-emerald-300/40 p-1 ${className}`}
      style={{ background: checkTierBg(value) }}
    >
      <span className="text-[9px] leading-none text-emerald-200/70">CHECK</span>
      <span className={`leading-none font-black text-white ${size === "lg" ? "text-xl" : size === "sm" ? "text-sm" : "text-base"}`}>{formatDollars(value)}</span>
    </div>
  );
}
