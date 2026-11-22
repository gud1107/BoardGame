"use client";

import { BONUS_TEXT, cardDef, EL_COLOR, EL_EMOJI, EL_LETTER, EL_NAMES, orderDef, type CardKind } from "./cards";
import { PATIENCE } from "./engine";

/** Seat colours + shapes (shape so colour is never the only cue). */
export const SEAT_COLORS = ["#c084fc", "#f472b6", "#38bdf8", "#facc15"];
export const SEAT_SHAPES = ["●", "◆", "▲", "■"];

const KIND_STYLE: Record<CardKind, { frame: string; label: string }> = {
  starter: { frame: "from-slate-600 to-slate-800 border-slate-400/50", label: "기본" },
  supply: { frame: "from-amber-600 to-amber-900 border-amber-300/60", label: "계산대" },
  shop: { frame: "from-violet-600 to-indigo-900 border-violet-300/60", label: "진열대" },
  curse: { frame: "from-zinc-700 to-black border-zinc-500/50", label: "저주" },
};

/** One element amount: emoji + count, plus a letter for colour-blind players. */
export function ElChip({ e, n, dim, size = "sm" }: { e: number; n: number; dim?: boolean; size?: "sm" | "md" }) {
  return (
    <span
      title={`${EL_NAMES[e]} ${n}`}
      className={`inline-flex items-center gap-0.5 rounded-full border px-1.5 font-bold tabular-nums ${size === "md" ? "py-0.5 text-sm" : "text-[11px]"} ${dim ? "opacity-40" : ""}`}
      style={{ borderColor: `${EL_COLOR[e]}aa`, background: `${EL_COLOR[e]}26`, color: "white" }}
    >
      <span aria-hidden>{EL_EMOJI[e]}</span>
      {n}
      <span className="sr-only">{EL_LETTER[e]}</span>
    </span>
  );
}

export function GoldChip({ n, size = "sm" }: { n: number; size?: "sm" | "md" }) {
  return (
    <span title={`골드 ${n}`} className={`inline-flex items-center gap-0.5 rounded-full border border-yellow-300/70 bg-yellow-400/20 px-1.5 font-bold tabular-nums text-white ${size === "md" ? "py-0.5 text-sm" : "text-[11px]"}`}>
      🪙{n}
    </span>
  );
}

/** Effect line as chips (🪙/elements) + words for the rest. */
export function EffectLine({ id }: { id: number }) {
  const d = cardDef(id);
  const words: string[] = [];
  if (d.draw) words.push(`카드 +${d.draw}`);
  if (d.trash) words.push(`폐기 ≤${d.trash}`);
  if (d.fame) words.push(`명성 +${d.fame}`);
  if (d.curse) words.push("🕸️ 주기");
  if (d.mirror) words.push("앞 카드 한 번 더");
  if (d.kind === "curse") words.push("효과 없음 · −1");
  return (
    <span className="flex flex-wrap items-center justify-center gap-0.5">
      {d.gold > 0 && <GoldChip n={d.gold} />}
      {d.els.map((v, e) => (v > 0 ? <ElChip key={e} e={e} n={v} /> : null))}
      {words.map((w) => (
        <span key={w} className="rounded bg-black/35 px-1 text-[10px] font-semibold leading-4 text-white/90">
          {w}
        </span>
      ))}
    </span>
  );
}

/** A playing card. `compact` = the small hand / played size. */
export function MagicCard({ id, compact, selected, glow }: { id: number; compact?: boolean; selected?: boolean; glow?: boolean }) {
  const d = cardDef(id);
  const st = KIND_STYLE[d.kind];
  return (
    <div
      className={`relative flex flex-col items-center justify-between rounded-xl border bg-gradient-to-b ${st.frame} text-center text-white shadow-md transition ${
        compact ? "h-[104px] w-[72px] p-1" : "h-[124px] w-full p-1.5"
      } ${selected ? "ring-2 ring-rose-400 ring-offset-2 ring-offset-black/40" : ""} ${glow ? "ring-2 ring-amber-300/80" : ""}`}
      title={`${d.name} — ${d.text}${d.cost ? ` (비용 🪙${d.cost})` : ""}`}
    >
      {d.cost > 0 && <span className="absolute left-1 top-1 rounded-full bg-yellow-400 px-1.5 text-[11px] font-black leading-5 text-black">{d.cost}</span>}
      <span className={`${compact ? "mt-1 text-2xl" : "mt-2 text-3xl"} leading-none drop-shadow`} aria-hidden>
        {d.emoji}
      </span>
      <span className={`${compact ? "text-[10px]" : "text-[11px]"} font-bold leading-tight`}>{d.name}</span>
      <EffectLine id={id} />
    </div>
  );
}

/** A customer order (📜 손님 의뢰). */
export function OrderCard({ id, age, payable }: { id: number; age: number; payable?: boolean }) {
  const od = orderDef(id);
  const left = Math.max(0, PATIENCE - age);
  return (
    <div
      className={`flex h-full flex-col items-center gap-1 rounded-xl border bg-gradient-to-b from-[#3b2a1a] to-[#1c130b] p-2 text-center text-white shadow-md ${
        payable ? "border-emerald-300 shadow-[0_0_14px_rgba(52,211,153,0.45)]" : "border-amber-200/30"
      }`}
    >
      <div className="flex w-full items-start justify-between">
        <span className="rounded-full bg-amber-300 px-1.5 text-[11px] font-black leading-5 text-black" title="명성">
          ⭐{od.fame}
        </span>
        <span className="text-[10px] text-amber-100/70" title={`${left}라운드 더 기다려요`} aria-label={`인내심 ${left}`}>
          {"⏳".repeat(Math.min(left, PATIENCE))}
          {left === 0 && "곧 떠나요"}
        </span>
      </div>
      <span className="text-3xl leading-none" aria-hidden>
        {od.emoji}
      </span>
      <span className="text-[11px] font-bold leading-tight">{od.customer}</span>
      <span className="text-[10px] leading-tight text-amber-100/70">「{od.potion}」</span>
      <span className="mt-auto flex flex-wrap justify-center gap-0.5">{od.need.map((v, e) => (v > 0 ? <ElChip key={e} e={e} n={v} /> : null))}</span>
      {od.bonus !== "none" && <span className="text-[10px] font-semibold leading-tight text-emerald-200">🎁 {BONUS_TEXT[od.bonus]}</span>}
    </div>
  );
}
