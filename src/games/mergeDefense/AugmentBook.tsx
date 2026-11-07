"use client";

import Overlay from "@/components/Overlay";
import { AUG_ODDS, AUG_TIER_INFO, AUG_TIERS, AUG_WAVES, AUGMENTS, augTotals, describeTotals } from "./augments";
import { WAVE_TICKS, PREP_TICKS, type MergeDefenseState } from "./engine";
import { SEAT_COLORS } from "./render";

/**
 * ✨ 증강 비교: every seat's augments by name with what they add up to, plus
 * when the next pick round opens and its tier odds. Opened from the HUD ✨
 * button or by tapping any augment chip row.
 */
export default function AugmentBook({ state, mySeat, names, onClose }: { state: MergeDefenseState; mySeat: number; names: Record<number, string>; onClose: () => void }) {
  const order = [mySeat, ...state.boards.map((_, i) => i).filter((i) => i !== mySeat)];
  const nextRound = AUG_WAVES.findIndex((w) => w > state.wave);
  const nextWave = nextRound >= 0 ? AUG_WAVES[nextRound] : null;
  const secsTo = nextWave !== null ? Math.max(0, Math.ceil((PREP_TICKS + (nextWave - 1) * WAVE_TICKS - state.tick) / 20)) : 0;
  return (
    <Overlay title="✨ 증강 비교" onClose={onClose} wide>
      <div className="flex flex-col gap-3 text-sm text-white/85 light:text-slate-700">
        <p className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[12px] light:border-slate-200 light:bg-slate-50">
          {nextWave !== null ? (
            <>
              다음 증강 <b>W{nextWave}</b> ({secsTo}초 뒤) ·{" "}
              {AUG_TIERS.map((t) => (
                <span key={t} className="mr-1.5 whitespace-nowrap" style={{ color: AUG_TIER_INFO[t].color }}>
                  {AUG_TIER_INFO[t].mark} {AUG_TIER_INFO[t].name} {AUG_ODDS[nextRound][t]}%
                </span>
              ))}
            </>
          ) : (
            "이번 판의 증강 라운드(3·10·18웨이브)는 모두 끝났어요."
          )}
        </p>
        {order.map((seat) => {
          const b = state.boards[seat];
          if (!b) return null;
          const ids = b.augments ?? [];
          const totals = describeTotals(augTotals(ids));
          return (
            <section key={seat} className="rounded-xl border border-white/10 bg-black/20 p-2.5 light:border-slate-200 light:bg-white">
              <h3 className="mb-1.5 flex items-center gap-1.5 text-[13px] font-bold">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: SEAT_COLORS[seat] }} />
                <span className="truncate">{names[seat] ?? `${seat + 1}번`}</span>
                {seat === mySeat && <span className="text-[11px] text-amber-300 light:text-amber-600">(나)</span>}
                {!b.alive && <span className="text-[11px] text-rose-300">💀 탈락</span>}
                {b.augOffer && <span className="ml-auto text-[11px] font-semibold text-sky-300 light:text-sky-600">🕐 고르는 중</span>}
              </h3>
              {ids.length === 0 ? (
                <p className="text-[12px] text-white/50 light:text-slate-400">아직 증강이 없어요</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {ids.map((id) => {
                    const def = AUGMENTS[id];
                    if (!def) return null;
                    return (
                      <li key={id} className="flex items-start gap-1.5 rounded-lg border-l-4 bg-white/5 px-2 py-1 text-[12px] light:bg-slate-50" style={{ borderColor: AUG_TIER_INFO[def.tier].color }}>
                        <span aria-hidden>{def.emoji}</span>
                        <span className="break-keep">
                          <b>{def.name}</b>{" "}
                          <span className="text-[10px] opacity-70">
                            {AUG_TIER_INFO[def.tier].mark} {AUG_TIER_INFO[def.tier].name} · {def.tag}
                          </span>
                          <br />
                          <span className="text-white/65 light:text-slate-500">{def.desc}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              {totals.length > 0 && (
                <p className="mt-1.5 flex flex-wrap gap-1">
                  {totals.map((t) => (
                    <span key={t} className="rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-100 light:bg-amber-100 light:text-amber-800">
                      {t}
                    </span>
                  ))}
                </p>
              )}
            </section>
          );
        })}
      </div>
    </Overlay>
  );
}
