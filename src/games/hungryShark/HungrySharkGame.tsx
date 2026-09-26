"use client";

import { useEffect, useRef, useState } from "react";
import type { PlayableGameProps } from "../types";
import {
  effectiveStats,
  ENTITY_DEFS,
  MAX_UPGRADE_LEVEL,
  SHARKS,
  sharkById,
  UPGRADE_LABELS,
  upgradeCost,
  type EntityKind,
  type SharkDef,
  type UpgradeKind,
} from "./data";
import type { RunSummary } from "./engine";
import HungrySharkCanvas from "./HungrySharkCanvas";
import RulebookModal from "./RulebookModal";
import { drawSharkShape } from "./render";
import { freshSave, loadSave, upgradesFor, writeSave, type SharkSave } from "./save";

/**
 * Solo arcade loop: 상점(상어 선택/업그레이드) → 잠수(HungrySharkCanvas) →
 * 결과 → 상점... The shared game page only hears about it once the player
 * explicitly leaves ("기록 저장하고 나가기"), which reports a trivial 1-player
 * ranking so the play still lands in history/analytics.
 */

type Screen = "menu" | "playing" | "results";

export default function HungrySharkGame({ participants, onComplete }: PlayableGameProps) {
  // Client-only component (dynamic import with ssr:false), so localStorage
  // is safe to read in the lazy initializer.
  const [save, setSave] = useState<SharkSave>(() => (typeof window === "undefined" ? freshSave() : loadSave()));
  const [screen, setScreen] = useState<Screen>("menu");
  const [viewId, setViewId] = useState(() => save.selected);
  const [runKey, setRunKey] = useState(0);
  const [summary, setSummary] = useState<{ s: RunSummary; newBest: boolean; missionCoins: number } | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [bestThisSession, setBestThisSession] = useState(0);

  const update = (fn: (s: SharkSave) => SharkSave) => {
    setSave((prev) => {
      const next = fn(prev);
      writeSave(next);
      return next;
    });
  };

  const viewDef = sharkById(viewId);
  const owned = save.owned.includes(viewId);
  const ups = upgradesFor(save, viewId);

  const startDive = () => {
    update((s) => ({ ...s, selected: viewId }));
    setRunKey((k) => k + 1);
    setScreen("playing");
  };

  const handleEnd = (s: RunSummary) => {
    const prevBest = save.best[s.sharkId] ?? 0;
    const missionCoins = s.missions.filter((m) => m.done).reduce((a, m) => a + m.reward, 0);
    const eaten = Object.values(s.run.eaten).reduce((a, n) => a + (n ?? 0), 0);
    update((sv) => ({
      ...sv,
      coins: sv.coins + s.coins,
      best: { ...sv.best, [s.sharkId]: Math.max(prevBest, s.score) },
      totalRuns: sv.totalRuns + 1,
      totalEaten: sv.totalEaten + eaten,
    }));
    setBestThisSession((b) => Math.max(b, s.score));
    setSummary({ s, newBest: s.score > prevBest, missionCoins });
    setScreen("results");
  };

  const finish = () => {
    const pid = participants[0]?.id ?? "solo";
    onComplete({ rankings: [{ playerId: pid, rank: 1 }], finishedAt: new Date().toISOString() });
  };

  if (screen === "playing") {
    const def = sharkById(save.selected);
    return (
      <HungrySharkCanvas
        key={runKey}
        def={def}
        upgrades={upgradesFor(save, def.id)}
        muted={save.muted}
        onToggleMute={() => update((s) => ({ ...s, muted: !s.muted }))}
        onEnd={handleEnd}
        onQuit={() => setScreen("menu")}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {screen === "results" && summary && (
        <ResultsPanel
          summary={summary}
          onRetry={() => {
            setRunKey((k) => k + 1);
            setScreen("playing");
          }}
          onMenu={() => setScreen("menu")}
        />
      )}

      {screen === "menu" && (
        <>
          {/* Header */}
          <div className="relative overflow-hidden rounded-2xl border border-sky-400/20 bg-gradient-to-b from-sky-600 via-sky-900 to-slate-950 p-5 light:border-sky-300">
            <div className="relative z-10 flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="text-xs font-bold tracking-[0.3em] text-sky-200/80">DEEP EVOLUTION</div>
                <h2 className="text-2xl font-black text-white sm:text-3xl">🦈 배고픈 상어</h2>
                <p className="mt-1 max-w-md text-xs text-sky-100/80">
                  먹지 않으면 점점 빠르게 굶주립니다. 쉬지 말고 사냥하고, 골드 러시를 터뜨리고, 더 큰 상어로 진화하세요!
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <div className="rounded-full bg-black/40 px-3 py-1 text-sm font-black text-yellow-300">🪙 {save.coins.toLocaleString()}</div>
                <div className="text-[11px] text-sky-100/70">
                  누적 {save.totalRuns}회 잠수 · {save.totalEaten.toLocaleString()}마리 포식
                </div>
              </div>
            </div>
            <BubbleDecor />
          </div>

          {/* Shark picker */}
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {SHARKS.map((sh) => {
              const own = save.owned.includes(sh.id);
              const active = sh.id === viewId;
              return (
                <button
                  key={sh.id}
                  onClick={() => setViewId(sh.id)}
                  className={`group relative flex flex-col items-center rounded-xl border p-2 transition ${
                    active
                      ? "border-sky-400 bg-sky-500/15 ring-2 ring-sky-400/50"
                      : "border-white/10 bg-white/[0.03] hover:border-white/30 light:border-slate-200 light:bg-white"
                  }`}
                >
                  <span className="absolute top-1 left-1.5 text-[9px] font-black text-white/50 light:text-slate-400">T{sh.tier}</span>
                  <SharkPreview def={sh} width={96} height={44} dim={!own} />
                  <span className="mt-0.5 text-xs font-bold text-white light:text-slate-800">{sh.name}</span>
                  <span className="text-[10px] text-white/50 light:text-slate-500">
                    {own ? `최고 ${(save.best[sh.id] ?? 0).toLocaleString()}` : `🔒 ${sh.cost.toLocaleString()}🪙`}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Detail + upgrades */}
          <div className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:grid-cols-[1fr_1.2fr] light:border-slate-200 light:bg-white light:shadow-sm">
            <div className="flex flex-col items-center justify-center gap-2">
              <div className="w-full rounded-xl bg-gradient-to-b from-sky-800/60 to-slate-900/80 p-2">
                <SharkPreview def={viewDef} width={280} height={120} animate />
              </div>
              <div className="text-center">
                <div className="text-lg font-black text-white light:text-slate-900">
                  {viewDef.name} <span className="text-xs font-semibold text-white/40 light:text-slate-400">{viewDef.nameEn} · 티어 {viewDef.tier}</span>
                </div>
                <p className="mt-1 text-xs text-white/60 light:text-slate-600">{viewDef.blurb}</p>
              </div>
              <EdibleList def={viewDef} />
            </div>

            <div className="flex flex-col gap-2">
              <StatBars def={viewDef} save={save} />
              {owned ? (
                (Object.keys(UPGRADE_LABELS) as UpgradeKind[]).map((k) => {
                  const lvl = ups[k];
                  const maxed = lvl >= MAX_UPGRADE_LEVEL;
                  const cost = upgradeCost(viewDef, k, lvl);
                  const afford = save.coins >= cost;
                  return (
                    <div key={k} className="flex items-center gap-2 rounded-lg bg-black/20 px-2.5 py-2 light:bg-slate-50">
                      <span className="text-xl">{UPGRADE_LABELS[k].emoji}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-sm font-bold text-white light:text-slate-800">
                          {UPGRADE_LABELS[k].name}
                          <span className="text-[10px] font-semibold text-sky-300 light:text-sky-600">Lv.{lvl}/{MAX_UPGRADE_LEVEL}</span>
                        </div>
                        <div className="mt-1 flex gap-0.5">
                          {Array.from({ length: MAX_UPGRADE_LEVEL }, (_, i) => (
                            <div key={i} className={`h-1.5 flex-1 rounded-full ${i < lvl ? "bg-sky-400" : "bg-white/10 light:bg-slate-200"}`} />
                          ))}
                        </div>
                        <div className="mt-0.5 text-[10px] text-white/45 light:text-slate-500">{UPGRADE_LABELS[k].desc}</div>
                      </div>
                      <button
                        disabled={maxed || !afford}
                        onClick={() =>
                          update((s) => ({
                            ...s,
                            coins: s.coins - cost,
                            upgrades: { ...s.upgrades, [viewId]: { ...upgradesFor(s, viewId), [k]: lvl + 1 } },
                          }))
                        }
                        className="shrink-0 rounded-lg bg-yellow-400 px-2.5 py-1.5 text-xs font-black text-slate-900 transition hover:bg-yellow-300 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30 light:disabled:bg-slate-200 light:disabled:text-slate-400"
                      >
                        {maxed ? "MAX" : `🪙${cost.toLocaleString()}`}
                      </button>
                    </div>
                  );
                })
              ) : (
                <div className="flex flex-col items-center gap-2 rounded-lg bg-black/20 p-4 light:bg-slate-50">
                  <p className="text-sm text-white/70 light:text-slate-600">이 상어는 아직 잠겨 있습니다.</p>
                  <button
                    disabled={save.coins < viewDef.cost}
                    onClick={() => update((s) => ({ ...s, coins: s.coins - viewDef.cost, owned: [...s.owned, viewDef.id], selected: viewDef.id }))}
                    className="rounded-xl bg-yellow-400 px-5 py-2 text-sm font-black text-slate-900 hover:bg-yellow-300 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30 light:disabled:bg-slate-200 light:disabled:text-slate-400"
                  >
                    🔓 {viewDef.cost.toLocaleString()}🪙에 잠금 해제
                  </button>
                  {save.coins < viewDef.cost && (
                    <p className="text-[11px] text-white/40 light:text-slate-400">{(viewDef.cost - save.coins).toLocaleString()}🪙 더 필요합니다</p>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              disabled={!owned}
              onClick={startDive}
              className="flex-1 rounded-xl bg-gradient-to-r from-sky-500 to-cyan-400 py-3.5 text-base font-black text-white shadow-lg shadow-sky-500/30 transition hover:brightness-110 disabled:cursor-not-allowed disabled:from-slate-600 disabled:to-slate-700 disabled:shadow-none"
            >
              🌊 {owned ? `${viewDef.name}(으)로 잠수 시작` : "잠금 해제 후 플레이 가능"}
            </button>
            <button
              onClick={() => setShowRules(true)}
              className="rounded-xl border border-white/15 px-4 py-3 text-sm font-semibold text-white/80 hover:border-white/40 light:border-slate-300 light:text-slate-700"
            >
              📖 룰북
            </button>
            <button
              onClick={finish}
              className="rounded-xl border border-white/15 px-4 py-3 text-sm font-semibold text-white/60 hover:border-white/40 light:border-slate-300 light:text-slate-600"
              title={bestThisSession > 0 ? `이번 세션 최고 ${bestThisSession.toLocaleString()}점` : undefined}
            >
              🏁 기록 저장하고 나가기
            </button>
          </div>
          <p className="text-center text-[11px] text-white/35 light:text-slate-400">
            PC: 마우스로 방향 · 클릭/스페이스 부스트 · WASD/방향키 · Esc 일시정지 &nbsp;|&nbsp; 모바일: 화면 드래그 조이스틱 + 🚀 버튼
          </p>
        </>
      )}

      {showRules && <RulebookModal onClose={() => setShowRules(false)} />}
    </div>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function SharkPreview({ def, width, height, dim, animate }: { def: SharkDef; width: number; height: number; dim?: boolean; animate?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = width * dpr;
    c.height = height * dpr;
    let raf = 0;
    const draw = (t: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.translate(width / 2, height / 2 + height * 0.05);
      const L = Math.min(width * 0.8, height * 2.1) * (0.72 + def.tier * 0.045);
      ctx.globalAlpha = dim ? 0.35 : 1;
      drawSharkShape(ctx, def, L, animate ? 0.25 + 0.25 * Math.sin(t / 500) : 0.1, t / 180, false, false);
      if (animate) raf = requestAnimationFrame(draw);
    };
    draw(0);
    if (animate) raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [def, width, height, dim, animate]);
  return <canvas ref={ref} style={{ width, height, maxWidth: "100%" }} className="mx-auto block" />;
}

function StatBars({ def, save }: { def: SharkDef; save: SharkSave }) {
  const st = effectiveStats(def, upgradesFor(save, def.id));
  const rows: [string, number, number, string][] = [
    ["최대 체력", st.maxHealth, 420, `${st.maxHealth}`],
    ["초당 허기", def.baseDrainRate, 6.2, `${def.baseDrainRate.toFixed(1)} HP/s`],
    ["속도", st.swimSpeed, 440, `${Math.round(st.swimSpeed)}`],
    ["부스트", st.boostDuration, 6, `${st.boostDuration.toFixed(1)}s`],
    ["물기 피해", st.biteForce, 100, `${Math.round(st.biteForce)}`],
  ];
  return (
    <div className="grid grid-cols-1 gap-1 rounded-lg bg-black/20 p-2.5 light:bg-slate-50">
      {rows.map(([label, v, max, text]) => (
        <div key={label} className="flex items-center gap-2 text-[11px]">
          <span className="w-16 shrink-0 text-white/55 light:text-slate-500">{label}</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10 light:bg-slate-200">
            <div className="h-full rounded-full bg-gradient-to-r from-sky-400 to-cyan-300" style={{ width: `${Math.min(100, (v / max) * 100)}%` }} />
          </div>
          <span className="w-16 shrink-0 text-right font-semibold text-white/80 tabular-nums light:text-slate-700">{text}</span>
        </div>
      ))}
    </div>
  );
}

function EdibleList({ def }: { def: SharkDef }) {
  const newlyEdible = (Object.values(ENTITY_DEFS) as (typeof ENTITY_DEFS)[EntityKind][])
    .filter((d) => d.requiredTier === def.tier && d.kind !== "chest")
    .map((d) => d.name);
  const danger = (Object.values(ENTITY_DEFS) as (typeof ENTITY_DEFS)[EntityKind][])
    .filter((d) => d.requiredTier > def.tier && d.damage > 0 && d.requiredTier <= def.tier + 1)
    .map((d) => d.name);
  return (
    <div className="w-full space-y-1 text-[11px]">
      {newlyEdible.length > 0 && (
        <div className="rounded-md bg-emerald-500/10 px-2 py-1 text-emerald-300 light:text-emerald-700">🍖 새로 먹을 수 있음: {newlyEdible.join(", ")}</div>
      )}
      {danger.length > 0 && (
        <div className="rounded-md bg-red-500/10 px-2 py-1 text-red-300 light:text-red-700">⚠️ 주의: {danger.join(", ")}</div>
      )}
    </div>
  );
}

const EATEN_LABEL_ORDER: EntityKind[] = [
  "smallFish", "crab", "swimmer", "puffer", "pelican", "diver", "grouper", "ray", "tuna", "sailor", "angler",
  "fishingBoat", "passenger", "smallShark", "cageDiver", "submarine", "ghostShark", "yacht", "helicopter",
  "greenJelly", "redJelly", "mineS", "mineM", "mineL", "mineXL", "torpedo", "rock", "chest",
];

function ResultsPanel({
  summary,
  onRetry,
  onMenu,
}: {
  summary: { s: RunSummary; newBest: boolean; missionCoins: number };
  onRetry: () => void;
  onMenu: () => void;
}) {
  const { s, newBest, missionCoins } = summary;
  const def = sharkById(s.sharkId);
  const eaten = EATEN_LABEL_ORDER.filter((k) => (s.run.eaten[k] ?? 0) > 0);
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-gradient-to-b from-slate-900 to-slate-950 p-5 light:border-slate-200 light:from-white light:to-slate-50">
      <div className="text-center">
        <div className="text-xs font-bold tracking-[0.3em] text-white/40 light:text-slate-400">DIVE RESULT</div>
        <div className="mt-1 text-4xl font-black text-white tabular-nums light:text-slate-900">{s.score.toLocaleString()}</div>
        {newBest && <div className="mt-1 inline-block animate-bounce rounded-full bg-yellow-400 px-3 py-0.5 text-xs font-black text-slate-900">🏆 신기록!</div>}
        <p className="mt-2 text-xs text-white/50 light:text-slate-500">
          {def.name} · {Math.floor(s.seconds / 60)}분 {s.seconds % 60}초 생존 · 사인: {s.cause}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
        <Stat label="획득 코인" value={`🪙 ${s.coins.toLocaleString()}`} sub={missionCoins > 0 ? `미션 보상 ${missionCoins} 포함` : undefined} />
        <Stat label="최대 수심" value={`${s.run.maxDepth}m`} />
        <Stat label="골드 러시" value={`${s.run.rushes}회`} sub={s.run.megaRushes > 0 ? `메가 ${s.run.megaRushes}회` : undefined} />
        <Stat label="최고 콤보" value={`${s.run.bestCombo}`} />
      </div>
      <div>
        <div className="mb-1.5 text-xs font-semibold text-white/50 light:text-slate-500">미션</div>
        <div className="flex flex-col gap-1">
          {s.missions.map((m) => (
            <div key={m.id} className={`flex justify-between rounded-md px-2.5 py-1.5 text-xs ${m.done ? "bg-emerald-500/15 text-emerald-300 light:text-emerald-700" : "bg-white/5 text-white/60 light:bg-slate-100 light:text-slate-600"}`}>
              <span>{m.done ? "✅" : "⬜"} {m.label}</span>
              <span className="tabular-nums">{m.done ? `+${m.reward}🪙` : `${m.progress.toLocaleString()}/${m.goal.toLocaleString()}`}</span>
            </div>
          ))}
        </div>
      </div>
      {eaten.length > 0 && (
        <div>
          <div className="mb-1.5 text-xs font-semibold text-white/50 light:text-slate-500">먹은 것들</div>
          <div className="flex flex-wrap gap-1.5">
            {eaten.map((k) => (
              <span key={k} className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-white/75 light:bg-slate-100 light:text-slate-700">
                {ENTITY_DEFS[k].name} ×{s.run.eaten[k]}
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <button onClick={onRetry} className="flex-1 rounded-xl bg-gradient-to-r from-sky-500 to-cyan-400 py-3 font-black text-white hover:brightness-110">
          🔁 다시 잠수
        </button>
        <button onClick={onMenu} className="flex-1 rounded-xl bg-yellow-400 py-3 font-black text-slate-900 hover:bg-yellow-300">
          🛒 상점 · 업그레이드
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-white/5 px-2 py-2 light:bg-slate-100">
      <div className="text-[10px] text-white/45 light:text-slate-500">{label}</div>
      <div className="text-base font-black text-white light:text-slate-900">{value}</div>
      {sub && <div className="text-[10px] text-white/40 light:text-slate-400">{sub}</div>}
    </div>
  );
}

function BubbleDecor() {
  return (
    <div className="pointer-events-none absolute inset-0 opacity-40">
      {Array.from({ length: 10 }, (_, i) => (
        <span
          key={i}
          className="absolute rounded-full border border-white/50"
          style={{ left: `${(i * 37) % 100}%`, bottom: `${(i * 23) % 80}%`, width: 6 + (i % 4) * 4, height: 6 + (i % 4) * 4 }}
        />
      ))}
    </div>
  );
}
