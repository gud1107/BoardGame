"use client";

import { useEffect, useState } from "react";
import type { UnlockId } from "@/lib/skins/catalog";
import {
  TIERS,
  TIER_ORDER,
  TRACKS,
  UNLOCKS,
  UNLOCK_IDS,
  isUnlocked,
  nextGoals,
  rewardsFor,
  tierBg,
  tierBorder,
  tierText,
  tierVars,
  useSkinProgressState,
  type SkinProgress,
} from "@/lib/skins/unlocks";
import SkinButton from "./SkinPicker";

const OPEN_KEY = "bg_reward_tracker_open";
const SEEN_KEY = "bg_reward_seen_v1";

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

/** Unlocks already shown to this player; `null` = never stored (first visit — nothing counts as new). */
function readSeen(): Set<string> | null {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : null;
  } catch {
    return null;
  }
}

function GoalRow({ id, p, isNew }: { id: UnlockId; p: SkinProgress; isNew: boolean }) {
  const u = UNLOCKS[id];
  const tier = TIERS[u.tier];
  const value = Math.min(p[u.of], u.goal);
  const done = isUnlocked(id, p);
  return (
    <li
      className={`flex flex-col gap-1 rounded-lg border px-2.5 py-2 ${
        isNew ? "border-amber-300 bg-amber-300/15 light:bg-amber-50" : done ? "border-emerald-400/30 bg-emerald-400/5 light:border-emerald-200 light:bg-emerald-50/60" : "border-white/10 light:border-slate-200"
      }`}
    >
      <div className="flex items-center gap-1.5 text-xs">
        <span className={`shrink-0 rounded-full border px-1.5 text-[9px] leading-4 font-bold ${tierBorder} ${tierText}`} style={tierVars(u.tier)}>
          {tier.emoji} {tier.label}
        </span>
        <span className="min-w-0 flex-1 font-semibold break-keep text-white light:text-slate-900">
          {TRACKS[u.of].emoji} {u.label}
        </span>
        {isNew ? (
          <span className="shrink-0 rounded bg-amber-400 px-1 text-[9px] font-black text-slate-900">NEW</span>
        ) : done ? (
          <span className="shrink-0 text-[11px] font-bold text-emerald-300 light:text-emerald-600">✓ 해금</span>
        ) : (
          <span className="shrink-0 text-[11px] text-white/60 tabular-nums light:text-slate-500">
            {value}/{u.goal}
          </span>
        )}
      </div>
      {!done && (
        <span className="block h-1 w-full overflow-hidden rounded-full bg-white/10 light:bg-slate-200">
          <span className={`block h-full rounded-full ${tierBg}`} style={{ ...tierVars(u.tier), width: `${(value / u.goal) * 100}%` }} />
        </span>
      )}
      <span className="text-[10px] break-keep text-white/50 light:text-slate-500">
        🎁 {rewardsFor(id).map((r) => `${r.kindLabel} ${r.emoji} ${r.name}`).join(", ")}
      </span>
    </li>
  );
}

/**
 * 🎁 보상 도전 — a pill under the site header (left, mirroring the room pill on
 * the right) that folds open into every reward goal: the three closest first,
 * then all of them by tier, each with live progress and its prize. Lives on
 * the shared game page, so every game shows it. Open/closed is remembered.
 */
export default function RewardTracker() {
  const p = useSkinProgressState();
  const [open, setOpen] = useState(readOpen);
  const [seen, setSeen] = useState(readSeen);

  const unlocked = p ? UNLOCK_IDS.filter((id) => isUnlocked(id, p)) : [];
  // first visit: whatever is already earned isn't "new"
  if (p && seen === null) setSeen(new Set(unlocked));
  const fresh = seen ? unlocked.filter((id) => !seen.has(id)) : [];

  useEffect(() => {
    if (!seen) return;
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
    } catch {
      // private mode — "new" just lasts this tab
    }
  }, [seen]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(OPEN_KEY, next ? "1" : "0");
    } catch {
      // keep the in-memory state
    }
    // closing after a look clears the NEW marks
    if (!next && fresh.length) setSeen(new Set([...(seen ?? []), ...fresh]));
  };

  if (!p) return null;
  const next = nextGoals(p);
  const top = next[0];

  return (
    <div className="fixed left-3 z-40 flex flex-col items-start gap-2" style={{ top: "calc(var(--site-header-h, 96px) + 8px)" }}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className={`flex max-w-[44vw] items-center gap-1.5 rounded-full border border-amber-300/50 bg-stone-950/85 px-3 py-1.5 text-xs font-bold text-amber-100 shadow-lg backdrop-blur sm:max-w-sm light:border-amber-300 light:bg-amber-50/95 light:text-amber-900 ${
          fresh.length ? "animate-pulse" : ""
        }`}
      >
        <span className="shrink-0">🎁 보상 {unlocked.length}/{UNLOCK_IDS.length}</span>
        {fresh.length > 0 && <span className="shrink-0 rounded bg-amber-400 px-1 text-[9px] font-black text-slate-900">NEW {fresh.length}</span>}
        {top && !fresh.length && (
          <span className="hidden truncate font-medium opacity-75 sm:inline">
            · 다음: {UNLOCKS[top].label} {Math.min(p[UNLOCKS[top].of], UNLOCKS[top].goal)}/{UNLOCKS[top].goal}
          </span>
        )}
        <span className="shrink-0 opacity-60">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="flex max-h-[min(70vh,560px)] w-[min(92vw,360px)] flex-col gap-3 overflow-y-auto rounded-2xl border border-white/15 bg-stone-950/95 p-3 text-white shadow-2xl backdrop-blur light:border-slate-200 light:bg-white/95 light:text-slate-900">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-bold">🎁 보상 도전</h2>
            <span className="text-[11px] text-white/60 tabular-nums light:text-slate-500">
              해금 {unlocked.length}/{UNLOCK_IDS.length}
            </span>
          </div>
          <p className="text-[11px] break-keep text-white/60 light:text-slate-500">
            조건을 채우면 스킨이 열려요. 판이 끝나는 대로 숫자가 바로 올라가요. 로그인하면 계정을 따라가요.
          </p>

          {fresh.length > 0 && (
            <section className="flex flex-col gap-1.5">
              <h3 className="text-xs font-bold text-amber-300 light:text-amber-700">✨ 새로 열린 보상</h3>
              <ul className="flex flex-col gap-1.5">
                {fresh.map((id) => (
                  <GoalRow key={id} id={id} p={p} isNew />
                ))}
              </ul>
            </section>
          )}

          {next.length > 0 && (
            <section className="flex flex-col gap-1.5">
              <h3 className="text-xs font-bold text-white/80 light:text-slate-700">🎯 다음 목표</h3>
              <ul className="flex flex-col gap-1.5">
                {next.slice(0, 3).map((id) => (
                  <GoalRow key={id} id={id} p={p} isNew={false} />
                ))}
              </ul>
            </section>
          )}

          {TIER_ORDER.map((tier) => {
            const ids = UNLOCK_IDS.filter((id) => UNLOCKS[id].tier === tier).sort((a, b) => UNLOCKS[a].goal - UNLOCKS[b].goal);
            const done = ids.filter((id) => isUnlocked(id, p)).length;
            const t = TIERS[tier];
            return (
              <details key={tier} className="group rounded-lg border border-white/10 light:border-slate-200">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-2 text-xs font-bold">
                  <span className={tierText} style={tierVars(tier)}>
                    {t.emoji} {t.label}
                  </span>
                  <span className="text-white/50 tabular-nums light:text-slate-500">
                    {done}/{ids.length}
                  </span>
                  <span className="ml-auto text-white/40 group-open:rotate-180 light:text-slate-400">▼</span>
                </summary>
                <ul className="flex flex-col gap-1.5 px-2 pb-2">
                  {ids.map((id) => (
                    <GoalRow key={id} id={id} p={p} isNew={fresh.includes(id)} />
                  ))}
                </ul>
              </details>
            );
          })}

          <details className="rounded-lg border border-white/10 light:border-slate-200">
            <summary className="cursor-pointer list-none px-2.5 py-2 text-xs font-bold">ⓘ 어떻게 세나요?</summary>
            <dl className="flex flex-col gap-1.5 px-2.5 pb-2.5 text-[11px] break-keep">
              {Object.values(TRACKS).map((tr) => (
                <div key={tr.name}>
                  <dt className="font-semibold">
                    {tr.emoji} {tr.name}
                  </dt>
                  <dd className="text-white/55 light:text-slate-500">{tr.how}</dd>
                </div>
              ))}
            </dl>
          </details>

          <SkinButton />
        </div>
      )}
    </div>
  );
}
