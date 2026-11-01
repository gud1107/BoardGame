"use client";

import { useEffect, useRef, useState } from "react";
import { ITEM_IDS, ITEMS, loadoutCost, PLAN_COMBOS, PLAN_IDS, PLANS, sanitizeLoadout, SHOP_BUDGET, type ItemId, type Loadout, type PlanId } from "./data";
import { playCue, unlockAudio } from "./eraMarchAudio";

/**
 * 🛒 전략 상점 — before every match: pick one command plan and spend ★5 on
 * prep items. Remembers the last pick on this device. With `seconds`, a
 * countdown locks in whatever is selected when it hits zero (online rooms).
 */

const KEY = "era-march-loadout";

function loadLast(): Loadout {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) return sanitizeLoadout(JSON.parse(raw));
  } catch {}
  return { plan: "fortress", items: [...PLAN_COMBOS.fortress] };
}

export default function ShopPhase({ opponent, seconds, waiting, onConfirm, onBack }: { opponent: string; seconds?: number; waiting?: boolean; onConfirm: (l: Loadout) => void; onBack?: () => void }) {
  const [pick, setPick] = useState<Loadout>(loadLast);
  const [left, setLeft] = useState(seconds ?? 0);
  const pickRef = useRef(pick);
  const doneRef = useRef(false);
  useEffect(() => {
    pickRef.current = pick;
  }, [pick]);

  const confirm = (l: Loadout) => {
    if (doneRef.current) return;
    doneRef.current = true;
    unlockAudio();
    playCue("doctrine");
    try {
      window.localStorage.setItem(KEY, JSON.stringify(l));
    } catch {}
    onConfirm(l);
  };

  useEffect(() => {
    if (!seconds) return;
    const id = window.setInterval(() => {
      setLeft((v) => {
        if (v <= 1) {
          window.clearInterval(id);
          confirm(pickRef.current);
          return 0;
        }
        if (v <= 6) playCue("click", 0.6);
        return v - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seconds]);

  const spent = loadoutCost(pick.items);
  const setPlan = (plan: PlanId) => {
    playCue("click");
    setPick((p) => ({ ...p, plan }));
  };
  const toggle = (id: ItemId) => {
    unlockAudio();
    setPick((p) => {
      if (p.items.includes(id)) {
        playCue("cancel");
        return { ...p, items: p.items.filter((x) => x !== id) };
      }
      if (loadoutCost([...p.items, id]) > SHOP_BUDGET) {
        playCue("reject");
        return p;
      }
      playCue("buy");
      return { ...p, items: [...p.items, id] };
    });
  };
  const combo = () => {
    playCue("buy");
    setPick((p) => ({ ...p, items: [...PLAN_COMBOS[p.plan]] }));
  };

  if (waiting) {
    const plan = PLANS[pick.plan];
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/10 bg-gradient-to-b from-stone-800 to-stone-950 p-8 text-center text-white shadow-xl">
        <div className="text-4xl">{plan.emoji}</div>
        <div className="text-lg font-black">{plan.name} 출전 준비 완료</div>
        <div className="text-sm text-white/70">{pick.items.map((i) => `${ITEMS[i].emoji} ${ITEMS[i].name}`).join(" · ") || "아이템 없음"}</div>
        <div className="animate-pulse text-sm text-amber-200">{opponent}의 전략 선택을 기다리는 중…</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-gradient-to-b from-stone-800 to-stone-950 p-4 text-white shadow-xl sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs font-bold tracking-widest text-amber-300">🛒 전략 상점</div>
          <div className="text-xl font-black">출전 전 준비 — vs {opponent}</div>
          <div className="text-xs text-white/60">지휘 노선 1개를 고르고, ★{SHOP_BUDGET} 안에서 준비물을 사세요. 상대의 선택은 전투 직전에 공개됩니다.</div>
        </div>
        {seconds ? <div className={`shrink-0 rounded-lg px-3 py-1 font-mono text-lg font-black ${left <= 10 ? "animate-pulse bg-red-600" : "bg-black/50"}`}>⏱ {left}</div> : null}
      </div>

      <div className="text-xs font-bold text-white/60">① 지휘 노선</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {PLAN_IDS.map((id) => {
          const pl = PLANS[id];
          const on = pick.plan === id;
          return (
            <button key={id} onClick={() => setPlan(id)} className={`flex flex-col items-start gap-1 rounded-xl border p-2.5 text-left transition active:scale-[0.98] ${on ? "border-amber-300 bg-amber-400/15 ring-2 ring-amber-300/60" : "border-white/10 bg-white/5 hover:bg-white/10"}`}>
              <div className="flex w-full items-center gap-1.5">
                <span className="text-2xl">{pl.emoji}</span>
                <span className="font-black">{pl.name}</span>
                {on && <span className="ml-auto text-amber-300">✔</span>}
              </div>
              {pl.pros.map((x) => (
                <span key={x} className="text-[11px] font-semibold text-emerald-300">▲ {x}</span>
              ))}
              <span className="text-[11px] font-semibold text-rose-300">▼ {pl.cons}</span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2 text-xs font-bold text-white/60">
        ② 준비물
        <span className="ml-1 tracking-widest text-amber-300">{"★".repeat(spent)}<span className="text-white/20">{"★".repeat(Math.max(0, SHOP_BUDGET - spent))}</span></span>
        <span className="text-white/50">({SHOP_BUDGET - spent} 남음)</span>
        <button onClick={combo} className="ml-auto rounded-lg bg-white/10 px-2 py-1 text-[11px] font-bold hover:bg-white/20">{PLANS[pick.plan].emoji} 추천 조합 담기</button>
      </div>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {ITEM_IDS.map((id) => {
          const it = ITEMS[id];
          const on = pick.items.includes(id);
          const can = on || spent + it.cost <= SHOP_BUDGET;
          return (
            <button key={id} onClick={() => toggle(id)} className={`flex items-start gap-2 rounded-xl border p-2 text-left transition active:scale-[0.98] ${on ? "border-sky-300 bg-sky-500/20" : can ? "border-white/10 bg-white/5 hover:bg-white/10" : "border-white/5 bg-white/[0.02] opacity-45"}`}>
              <span className="text-xl">{it.emoji}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1 text-sm font-bold">
                  {it.name}
                  <span className="ml-auto text-[11px] text-amber-300">{"★".repeat(it.cost)}</span>
                </span>
                <span className="block text-[11px] text-white/65">{it.desc}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex gap-2">
        {onBack && (
          <button onClick={onBack} className="rounded-xl bg-white/10 px-4 py-3 text-sm font-bold">뒤로</button>
        )}
        <button onClick={() => confirm(pick)} className="flex-1 rounded-xl bg-gradient-to-b from-amber-300 to-amber-500 py-3 text-base font-black text-black shadow-lg active:scale-[0.99]">
          {PLANS[pick.plan].emoji} {PLANS[pick.plan].name}(으)로 출전!
        </button>
      </div>
    </div>
  );
}
