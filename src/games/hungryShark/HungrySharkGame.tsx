"use client";

import { useEffect, useRef, useState } from "react";
import type { PlayableGameProps } from "../types";
import { trackGameEvent } from "@/lib/analytics/gameEvents";
import {
  BRANCH_INFO,
  MAPS,
  mapById,
  mapCoinBonus,
  allMissionsBonusRate,
  MISSION_STREAK_CAP,
  effectiveStats,
  ENTITY_DEFS,
  MAX_UPGRADE_LEVEL,
  SHARKS,
  sharkById,
  UPGRADE_LABELS,
  upgradeCost,
  type EntityKind,
  type MapId,
  type SharkDef,
  type UpgradeKind,
} from "./data";
import type { RunSummary } from "./engine";
import HungrySharkCanvas from "./HungrySharkCanvas";
import RulebookModal from "./RulebookModal";
import BestiaryPanel from "./BestiaryPanel";
import RecordCelebration from "./RecordCelebration";
import { mapExclusives } from "./markers";
import MapProfile from "./MapProfile";
import Overlay from "@/components/Overlay";
import { drawSharkShape } from "./render";
import { freshSave, loadSave, upgradesFor, writeSave, type MapRecord, type PickerPrefs, type PickerSort, type SharkSave } from "./save";
import SharkEvolutionModal, { BranchBadge } from "./SharkEvolutionModal";

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
  const [summary, setSummary] = useState<DiveSummary | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [showBestiary, setShowBestiary] = useState(false);
  const [showEvolve, setShowEvolve] = useState(false);
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
  const parent = viewDef.parentId ? sharkById(viewDef.parentId) : null;
  const parentOwned = !parent || save.owned.includes(parent.id);
  const picker = save.picker;
  const sortKey = picker.sort;
  const setPicker = (p: Partial<PickerPrefs>) => update((s) => ({ ...s, picker: { ...s.picker, ...p } }));
  const listedSharks = listSharks(save, picker);

  const unlock = (def: SharkDef) =>
    update((s) =>
      s.owned.includes(def.id) || s.coins < def.cost || (def.parentId && !s.owned.includes(def.parentId))
        ? s
        : { ...s, coins: s.coins - def.cost, owned: [...s.owned, def.id], selected: def.id },
    );

  const startDive = () => {
    update((s) => ({ ...s, selected: viewId }));
    // Solo game: every dive is a real start (public play count + /admin/games).
    trackGameEvent("hungry-shark", "game_start", { isHost: true });
    setRunKey((k) => k + 1);
    setScreen("playing");
  };

  const handleEnd = (s: RunSummary) => {
    const prevBest = save.best[s.sharkId] ?? 0;
    const missionCoins = s.missions.filter((m) => m.done).reduce((a, m) => a + m.reward, 0) + s.missionBonus;
    const eaten = Object.values(s.run.eaten).reduce((a, n) => a + (n ?? 0), 0);
    const prevMapBest = save.mapBest[s.mapId] ?? null;
    const newMapBest = s.score > (prevMapBest?.score ?? 0);
    const causeCount = (save.deaths[s.mapId]?.[s.cause] ?? 0) + 1;
    const allClear = s.missions.length > 0 && s.missions.every((m) => m.done);
    const streak = allClear ? save.missionStreak + 1 : 0;
    update((sv) => ({
      ...sv,
      coins: sv.coins + s.coins,
      best: { ...sv.best, [s.sharkId]: Math.max(prevBest, s.score) },
      totalRuns: sv.totalRuns + 1,
      totalEaten: sv.totalEaten + eaten,
      mapBest: newMapBest ? { ...sv.mapBest, [s.mapId]: { score: s.score, sharkId: s.sharkId, seconds: s.seconds } } : sv.mapBest,
      mapSharkBest:
        s.score > (sv.mapSharkBest[s.mapId]?.[s.sharkId]?.score ?? 0)
          ? { ...sv.mapSharkBest, [s.mapId]: { ...sv.mapSharkBest[s.mapId], [s.sharkId]: { score: s.score, sharkId: s.sharkId, seconds: s.seconds } } }
          : sv.mapSharkBest,
      deaths: { ...sv.deaths, [s.mapId]: { ...sv.deaths[s.mapId], [s.cause]: causeCount } },
      missionStreak: streak,
      bestMissionStreak: Math.max(sv.bestMissionStreak, streak),
    }));
    setBestThisSession((b) => Math.max(b, s.score));
    setSummary({
      s, newBest: s.score > prevBest, missionCoins, prevMapBest, newMapBest, causeCount, streak,
      brokenStreak: allClear ? 0 : save.missionStreak,
      prevBestStreak: save.bestMissionStreak,
    });
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
        mapId={save.mapId}
        bankCoins={save.coins}
        owned={save.owned}
        onEvolve={(target, runCoins) => {
          // Owned already → free swap. Otherwise pay from the bank first, then this dive's coins.
          const have = save.owned.includes(target.id);
          if (!have && (target.parentId && !save.owned.includes(target.parentId))) return null;
          if (!have && save.coins + runCoins < target.cost) return null;
          const fromBank = have ? 0 : Math.min(save.coins, target.cost);
          const fromRun = have ? 0 : target.cost - fromBank;
          update((sv) => ({
            ...sv,
            coins: sv.coins - fromBank,
            owned: sv.owned.includes(target.id) ? sv.owned : [...sv.owned, target.id],
            selected: target.id,
          }));
          setViewId(target.id);
          return { fromRun, upgrades: upgradesFor(save, target.id) };
        }}
        muted={save.muted}
        onToggleMute={() => update((s) => ({ ...s, muted: !s.muted }))}
        deaths={save.deaths}
        missionStreak={save.missionStreak}
        markersOn={save.markers}
        onToggleMarkers={() => update((s) => ({ ...s, markers: !s.markers }))}
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
          save={save}
          onRetry={() => {
            trackGameEvent("hungry-shark", "game_start", { isHost: true });
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
                {save.missionStreak > 0 && (
                  <div className="text-[11px] font-bold text-amber-200">
                    🔥 미션 연속 올클리어 {save.missionStreak}회 · 다음 보너스 {Math.round(allMissionsBonusRate(save.missionStreak) * 100)}%
                  </div>
                )}
                {save.bestMissionStreak > 0 && (
                  <div className="text-[11px] text-sky-100/70">🏅 최고 연속 올클리어 {save.bestMissionStreak}회</div>
                )}
              </div>
            </div>
            <BubbleDecor />
          </div>

          {/* List controls: 진화 트리 or a stat sorted 높은/낮은 순 + filters — saved with the profile */}
          <SharkListControls picker={picker} onChange={setPicker} />

          {/* Evolution tree picker: T1 root, then 3 branch columns × T2..T4 — or a flat sorted grid */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-2 light:border-slate-200 light:bg-white">
            {listedSharks.length === 0 ? (
              <div className="py-6 text-center text-sm font-bold text-white/70 light:text-slate-600">
                {emptyPickerMessage(save)}
                <div className="mt-1 text-[11px] font-normal text-white/40 light:text-slate-400">
                  필터를 끄면 전체 목록을 볼 수 있어요.
                </div>
              </div>
            ) : sortKey === "tree" ? (
              <>
                {listedSharks.some((sh) => sh.tier === 1) && (
                  <div className="mb-2 flex justify-center">
                    {listedSharks
                      .filter((sh) => sh.tier === 1)
                      .map((sh) => (
                        <SharkCard key={sh.id} sh={sh} save={save} active={sh.id === viewId} onClick={() => setViewId(sh.id)} />
                      ))}
                  </div>
                )}
                <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
                  {(["BRUTE", "SPEED", "VOID"] as const).map((br) => (
                    <div key={br} className="flex flex-col gap-1.5">
                      <div className="text-center text-[10px] font-black text-white/60 light:text-slate-500">
                        {BRANCH_INFO[br].emoji} {BRANCH_INFO[br].name}
                        <div className="hidden text-[9px] font-semibold text-white/35 sm:block light:text-slate-400">{BRANCH_INFO[br].desc}</div>
                      </div>
                      {listedSharks
                        .filter((x) => x.branch === br)
                        .sort((a, b) => a.tier - b.tier)
                        .map((sh) => (
                          <SharkCard key={sh.id} sh={sh} save={save} active={sh.id === viewId} onClick={() => setViewId(sh.id)} />
                        ))}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5 sm:gap-2">
                {listedSharks.map((sh) => (
                  <SharkCard
                    key={sh.id}
                    sh={sh}
                    save={save}
                    active={sh.id === viewId}
                    onClick={() => setViewId(sh.id)}
                    metric={`${SORT_OPTIONS[sortKey].label} ${SORT_OPTIONS[sortKey].format(sh, save)}`}
                  />
                ))}
              </div>
            )}
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
                <div className="mt-1 flex justify-center">
                  <BranchBadge branch={viewDef.branch} />
                </div>
                <p className="mt-1 text-xs text-white/60 light:text-slate-600">{viewDef.blurb}</p>
              </div>
              <SkillBox def={viewDef} />
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
                  <p className="text-sm text-white/70 light:text-slate-600">
                    {parentOwned ? "이 상어는 아직 잠겨 있습니다." : `먼저 이전 진화 단계 "${parent?.name}"부터 해금하세요.`}
                  </p>
                  <button
                    disabled={!parentOwned || save.coins < viewDef.cost}
                    onClick={() => unlock(viewDef)}
                    className="rounded-xl bg-yellow-400 px-5 py-2 text-sm font-black text-slate-900 hover:bg-yellow-300 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30 light:disabled:bg-slate-200 light:disabled:text-slate-400"
                  >
                    🔓 {viewDef.cost.toLocaleString()}🪙에 잠금 해제
                  </button>
                  {parentOwned && save.coins < viewDef.cost && (
                    <p className="text-[11px] text-white/40 light:text-slate-400">{(viewDef.cost - save.coins).toLocaleString()}🪙 더 필요합니다</p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Dive site picker */}
          <div>
            <div className="mb-1.5 text-xs font-semibold text-white/50 light:text-slate-500">🗺️ 잠수 지역 선택</div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {MAPS.map((m) => {
                const active = save.mapId === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => update((s) => ({ ...s, mapId: m.id }))}
                    className={`relative overflow-hidden rounded-xl border p-3 text-left transition ${
                      active ? "border-cyan-300 ring-2 ring-cyan-300/50" : "border-white/10 hover:border-white/30 light:border-slate-200"
                    }`}
                    style={{ background: `linear-gradient(180deg, ${m.palette.water[0]} 0%, ${m.palette.water[2]} 60%, ${m.palette.water[4]} 100%)` }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-black text-white drop-shadow">
                        {m.emoji} {m.name}
                      </span>
                      <span className="shrink-0 rounded-full bg-black/40 px-2 py-0.5 text-[10px] font-bold text-white/85">
                        권장 T{m.recommendedTier}+
                      </span>
                    </div>
                    <MapProfile map={m} compact />
                    <p className="mt-1 text-[11px] leading-snug text-white/85 drop-shadow">{m.desc}</p>
                    <div className="mt-1.5 flex flex-wrap gap-x-2 text-[10px] font-semibold text-white/75">
                      <span>↔ {(m.width / 10).toLocaleString()}m</span>
                      <span>🎁 상자 {m.chestCount}개</span>
                      {m.coinBonus > 1 && <span className="text-yellow-200">🪙 ×{m.coinBonus}</span>}
                      {m.tierCoinBonus?.[4] && <span className="text-yellow-200/80">T4 ×{mapCoinBonus(m, 4).toFixed(2)}</span>}
                      {save.mapBest[m.id] && <span>🏆 {save.mapBest[m.id]!.score.toLocaleString()}</span>}
                    </div>
                    <div className={`mt-1 text-[10px] font-semibold text-white/80 ${active ? "pr-16" : ""}`}>
                      🐾 전용: {mapExclusives(m).map((k) => ENTITY_DEFS[k].name).join(" · ")}
                    </div>
                    {active && <span className="absolute right-2 bottom-2 text-xs font-black text-cyan-200">✔ 선택됨</span>}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              disabled={!owned}
              onClick={startDive}
              className="flex-1 rounded-xl bg-gradient-to-r from-sky-500 to-cyan-400 py-3.5 text-base font-black text-white shadow-lg shadow-sky-500/30 transition hover:brightness-110 disabled:cursor-not-allowed disabled:from-slate-600 disabled:to-slate-700 disabled:shadow-none"
            >
              🌊 {owned ? `${viewDef.name}(으)로 ${mapById(save.mapId).name} 잠수` : "잠금 해제 후 플레이 가능"}
            </button>
            {owned && viewDef.nextIds.length > 0 && (
              <button
                onClick={() => setShowEvolve(true)}
                className="rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-3 text-sm font-black text-slate-950 shadow-lg shadow-amber-500/20 hover:brightness-110"
              >
                🧬 진화 분기
              </button>
            )}
            <button
              onClick={() => setShowRules(true)}
              className="rounded-xl border border-white/15 px-4 py-3 text-sm font-semibold text-white/80 hover:border-white/40 light:border-slate-300 light:text-slate-700"
            >
              📖 룰북
            </button>
            <button
              onClick={() => setShowBestiary(true)}
              className="rounded-xl border border-emerald-400/30 px-4 py-3 text-sm font-semibold text-emerald-300 hover:border-emerald-300/60 light:border-emerald-300 light:text-emerald-700"
            >
              🐟 먹이 도감
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
            PC: 마우스로 방향 · 클릭/Shift 부스트 · <b>Space(E) 스킬</b> · V 잠수 중 진화 · WASD/방향키 · Esc 일시정지 &nbsp;|&nbsp; 모바일: 화면 드래그 조이스틱 + 🚀 부스트 · ⚡ 스킬
          </p>
        </>
      )}

      {showRules && <RulebookModal onClose={() => setShowRules(false)} />}
      {showEvolve && (
        <SharkEvolutionModal
          currentSharkId={viewId}
          playerGold={save.coins}
          owned={save.owned}
          onEvolve={(target) => {
            if (save.owned.includes(target.id)) update((s) => ({ ...s, selected: target.id }));
            else unlock(target);
            setViewId(target.id);
            setShowEvolve(false);
          }}
          onClose={() => setShowEvolve(false)}
        />
      )}
      {showBestiary && (
        <Overlay title="📖 해양 생태계 먹이 도감" onClose={() => setShowBestiary(false)} wide>
          <BestiaryPanel tier={viewDef.tier} sharkName={viewDef.name} biteLevel={ups.bite} deaths={save.deaths} />
        </Overlay>
      )}
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
      const L = Math.min(width * 0.8, height * 2.1) * (0.74 + (def.length - 70) * 0.0019);
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

type StatSort = Exclude<PickerSort, "tree">;

const SORT_OPTIONS: Record<
  StatSort,
  { label: string; value: (sh: SharkDef, save: SharkSave) => number; format: (sh: SharkDef, save: SharkSave) => string }
> = {
  cost: { label: "가격", value: (sh) => sh.cost, format: (sh) => `${sh.cost.toLocaleString()}🪙` },
  tier: { label: "티어", value: (sh) => sh.tier, format: (sh) => `T${sh.tier}` },
  health: {
    label: "체력",
    value: (sh, save) => effectiveStats(sh, upgradesFor(save, sh.id)).maxHealth,
    format: (sh, save) => `${effectiveStats(sh, upgradesFor(save, sh.id)).maxHealth}`,
  },
  speed: {
    label: "속도",
    value: (sh, save) => effectiveStats(sh, upgradesFor(save, sh.id)).swimSpeed,
    format: (sh, save) => `${Math.round(effectiveStats(sh, upgradesFor(save, sh.id)).swimSpeed)}`,
  },
  gold: { label: "골드", value: (sh) => sh.goldMultiplier, format: (sh) => `×${sh.goldMultiplier.toFixed(1)}` },
  boostEff: { label: "부스트 효율", value: (sh) => sh.boostEfficiency, format: (sh) => `×${sh.boostEfficiency.toFixed(1)}` },
  best: { label: "최고", value: (sh, save) => save.best[sh.id] ?? 0, format: (sh, save) => (save.best[sh.id] ?? 0).toLocaleString() },
};

const SORT_MENU_LABEL: Partial<Record<StatSort, string>> = { gold: "골드 배율", best: "최고 점수" };

/** Unlockable right now: not owned, parent owned, enough coins. */
function canBuyNow(sh: SharkDef, save: SharkSave): boolean {
  return !save.owned.includes(sh.id) && (!sh.parentId || save.owned.includes(sh.parentId)) && save.coins >= sh.cost;
}

function emptyPickerMessage(save: SharkSave): string {
  if (save.owned.length === SHARKS.length) return "🎉 모든 상어를 보유 중입니다!";
  if (save.picker.buyableOnly) {
    const next = SHARKS.filter((sh) => !save.owned.includes(sh.id) && (!sh.parentId || save.owned.includes(sh.parentId)))
      .sort((a, b) => a.cost - b.cost)[0];
    return next
      ? `🪙 지금 살 수 있는 상어가 없어요 — ${next.name}까지 ${(next.cost - save.coins).toLocaleString()}🪙 남았습니다.`
      : "지금 살 수 있는 상어가 없어요.";
  }
  return "조건에 맞는 상어가 없어요.";
}

/** Picker contents. "tree" keeps SHARKS order (the tree layout groups it); stat ties fall back to tree order. */
function listSharks(save: SharkSave, picker: PickerPrefs): SharkDef[] {
  const list = SHARKS.filter(
    (sh) => !(picker.hideOwned && save.owned.includes(sh.id)) && !(picker.buyableOnly && !canBuyNow(sh, save)),
  );
  if (picker.sort === "tree") return list;
  const { value } = SORT_OPTIONS[picker.sort];
  const sign = picker.dir === "desc" ? -1 : 1;
  return list.sort((a, b) => sign * (value(a, save) - value(b, save)) || SHARKS.indexOf(a) - SHARKS.indexOf(b));
}

function SharkListControls({ picker, onChange }: { picker: PickerPrefs; onChange: (p: Partial<PickerPrefs>) => void }) {
  const { sort: sortKey, dir: sortDir } = picker;
  const dirBtn = (d: PickerPrefs["dir"], label: string) => (
    <button
      type="button"
      onClick={() => onChange({ dir: d })}
      disabled={sortKey === "tree"}
      aria-pressed={sortKey !== "tree" && sortDir === d}
      className={`rounded-md px-2 py-1 font-bold transition disabled:opacity-40 ${
        sortKey !== "tree" && sortDir === d
          ? "bg-sky-500 text-white"
          : "text-white/60 hover:text-white light:text-slate-500 light:hover:text-slate-800"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="-mb-2 flex flex-wrap items-center justify-between gap-2 px-1 text-[11px]">
      <div className="flex items-center gap-1.5">
        <label className="flex items-center gap-1 text-white/60 light:text-slate-500">
          정렬
          <select
            value={sortKey}
            onChange={(e) => onChange({ sort: e.target.value as PickerSort })}
            className="rounded-md border border-white/15 bg-slate-900 px-1.5 py-1 font-bold text-white light:border-slate-300 light:bg-white light:text-slate-800"
          >
            <option value="tree">진화 트리</option>
            {(Object.keys(SORT_OPTIONS) as StatSort[]).map((k) => (
              <option key={k} value={k}>
                {SORT_MENU_LABEL[k] ?? SORT_OPTIONS[k].label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex rounded-lg border border-white/15 p-0.5 light:border-slate-300">
          {dirBtn("desc", "높은 순")}
          {dirBtn("asc", "낮은 순")}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <label className="flex cursor-pointer items-center gap-1.5 font-bold text-white/70 select-none light:text-slate-600">
          <input type="checkbox" checked={picker.buyableOnly} onChange={(e) => onChange({ buyableOnly: e.target.checked })} className="accent-amber-500" />
          지금 살 수 있는 상어만
        </label>
        <label className="flex cursor-pointer items-center gap-1.5 font-bold text-white/70 select-none light:text-slate-600">
          <input type="checkbox" checked={picker.hideOwned} onChange={(e) => onChange({ hideOwned: e.target.checked })} className="accent-sky-500" />
          보유 상어 숨기기
        </label>
      </div>
    </div>
  );
}

function SharkCard({
  sh,
  save,
  active,
  onClick,
  metric,
}: {
  sh: SharkDef;
  save: SharkSave;
  active: boolean;
  onClick: () => void;
  /** Sorted-grid mode: the value being sorted on, shown under the status line. */
  metric?: string;
}) {
  const own = save.owned.includes(sh.id);
  const reachable = !sh.parentId || save.owned.includes(sh.parentId);
  return (
    <button
      onClick={onClick}
      className={`group relative flex w-full min-w-0 flex-col items-center rounded-xl border p-1.5 transition sm:p-2 ${
        active
          ? "border-sky-400 bg-sky-500/15 ring-2 ring-sky-400/50"
          : "border-white/10 bg-white/[0.03] hover:border-white/30 light:border-slate-200 light:bg-white"
      } ${sh.tier === 1 && !metric ? "max-w-[11rem]" : ""}`}
    >
      <span className="absolute top-1 left-1.5 text-[9px] font-black text-white/50 light:text-slate-400">T{sh.tier}</span>
      <SharkPreview def={sh} width={88} height={40} dim={!own} />
      <span className="mt-0.5 w-full truncate text-center text-[11px] font-bold text-white sm:text-xs light:text-slate-800">{sh.name}</span>
      <span className="text-[10px] text-white/50 light:text-slate-500">
        {own ? `최고 ${(save.best[sh.id] ?? 0).toLocaleString()}` : reachable ? `🔒 ${sh.cost.toLocaleString()}🪙` : "🔒 이전 단계 필요"}
      </span>
      {metric && <span className="text-[10px] font-bold text-sky-300 light:text-sky-600">{metric}</span>}
    </button>
  );
}

function SkillBox({ def }: { def: SharkDef }) {
  return (
    <div className="w-full space-y-1 rounded-lg border border-violet-400/20 bg-violet-500/10 p-2 text-[11px] light:border-violet-200 light:bg-violet-50">
      <div className="font-bold text-violet-300 light:text-violet-700">
        ⚡ {def.skill.name} <span className="font-normal opacity-70">· 쿨타임 {def.skill.cooldown}초 · Space/⚡</span>
      </div>
      <div className="text-white/65 light:text-slate-600">{def.skill.desc}</div>
      {def.passive && (
        <div className="text-emerald-300 light:text-emerald-700">
          🧬 패시브 {def.passive.name}: {def.passive.desc}
        </div>
      )}
      <div className="flex flex-wrap gap-x-2 text-amber-300 light:text-amber-700">
        <span>🪙 골드 ×{def.goldMultiplier.toFixed(1)}</span>
        <span>🧲 자석 {def.magnetRadius}</span>
        <span>🚀 부스트 효율 ×{def.boostEfficiency.toFixed(1)}</span>
      </div>
    </div>
  );
}

function StatBars({ def, save }: { def: SharkDef; save: SharkSave }) {
  const st = effectiveStats(def, upgradesFor(save, def.id));
  const rows: [string, number, number, string][] = [
    ["최대 체력", st.maxHealth, 460, `${st.maxHealth}`],
    ["초당 허기", def.baseDrainRate, 7.2, `${def.baseDrainRate.toFixed(1)} HP/s`],
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
  "smallFish", "crab", "swimmer", "goldenTuna", "puffer", "pelican", "diver", "grouper", "ray", "tuna", "sailor", "angler",
  "fishingBoat", "passenger", "smallShark", "cageDiver", "submarine", "ghostShark", "yacht", "helicopter",
  "penguin", "seal", "narwhal", "orca", "treasureHunter", "barracuda", "moray", "giantSquid",
  "greenJelly", "redJelly", "mineS", "mineM", "mineL", "mineXL", "torpedo", "rock", "iceberg", "iceShard", "mastDebris", "chest",
];

interface DiveSummary {
  s: RunSummary;
  newBest: boolean;
  missionCoins: number;
  /** This map's record before this dive (null = first dive here). */
  prevMapBest: MapRecord | null;
  newMapBest: boolean;
  /** How many dives on this map have now ended this way (incl. this one). */
  causeCount: number;
  /** Consecutive all-clear dives including this one (0 = this dive didn't clear them all). */
  streak: number;
  /** Streak this dive ended (when it didn't clear every mission), for a "연속 기록 종료" note. */
  brokenStreak: number;
  /** Best all-clear streak before this dive. */
  prevBestStreak: number;
}

/** One-line advice for how a dive ended. */
function deathTip(cause: string): string {
  if (cause === "굶주림") return "허기는 시간이 지날수록 빨라집니다. 체력이 절반 아래면 물고기 떼·작은 먹이부터 챙기고, 골드 러시 중엔 허기가 멈춰요.";
  if (cause === "해파리 독") return "해파리는 메가 골드 러시 때만 먹을 수 있어요. 빨간 링 ☠가 보이면 크게 돌아가세요.";
  if (cause.includes("기뢰") || cause === "어뢰") return "폭발은 가까울수록 아픕니다. 기뢰는 반경 밖으로 돌아가고, 어뢰는 급선회로 빗나가게 하세요.";
  if (cause === "떨어지는 고드름" || cause === "무너지는 돛대 파편") return "흔들림과 빨간 점선이 보이면 낙하 지점에서 옆으로 비키세요.";
  if (cause === "화산 암석") return "해구에서는 위에서 암석이 떨어집니다. 머리 위를 자주 확인하세요.";
  const hunter = Object.values(ENTITY_DEFS).find((d) => d.name === cause && d.behavior === "hunter");
  if (hunter) return `${hunter.name}은(는) T${hunter.requiredTier}부터 사냥 가능해요. 빨간 화살표가 보이면 부스트로 벌리세요 — 5초 쫓고 나면 지쳐서 물러납니다.`;
  return "도감(📖)에서 위험한 생물의 정보를 확인해 보세요.";
}

function ResultsPanel({
  summary,
  save,
  onRetry,
  onMenu,
}: {
  summary: DiveSummary;
  save: SharkSave;
  onRetry: () => void;
  onMenu: () => void;
}) {
  const { s, newBest, missionCoins, prevMapBest, newMapBest, causeCount, streak, brokenStreak, prevBestStreak } = summary;
  const newBestStreak = streak > prevBestStreak && streak > 1;
  const bestStreak = Math.max(prevBestStreak, streak);
  const allMissions = s.missions.length > 0 && s.missions.every((m) => m.done);
  const record = s.score > 0 && (newMapBest || newBest);
  const celebrate = record || allMissions;
  const map = mapById(s.mapId);
  const topCauses = Object.entries(save.deaths[s.mapId] ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  const def = sharkById(s.sharkId);
  const eaten = EATEN_LABEL_ORDER.filter((k) => (s.run.eaten[k] ?? 0) > 0);
  return (
    <div className="relative flex flex-col gap-4 overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-slate-900 to-slate-950 p-5 light:border-slate-200 light:from-white light:to-slate-50">
      {celebrate && <RecordCelebration big={record && newMapBest} missions={allMissions} muted={save.muted} />}
      <div className="text-center">
        <div className="text-xs font-bold tracking-[0.3em] text-white/40 light:text-slate-400">DIVE RESULT</div>
        <div className="mt-1 text-4xl font-black text-white tabular-nums light:text-slate-900">{s.score.toLocaleString()}</div>
        <div className="flex flex-wrap justify-center gap-1.5">
          {record && (
            <div className="mt-1 inline-block animate-bounce rounded-full bg-yellow-400 px-3 py-0.5 text-xs font-black text-slate-900 shadow-[0_0_18px_rgba(250,204,21,0.6)]">
              {newMapBest ? `🏆 ${mapById(s.mapId).name} 신기록!` : `🏆 ${def.name} 개인 최고 기록!`}
            </div>
          )}
          {allMissions && (
            <div className="mt-1 inline-block animate-bounce rounded-full bg-emerald-400 px-3 py-0.5 text-xs font-black text-slate-900 shadow-[0_0_18px_rgba(52,211,153,0.6)] [animation-delay:150ms]">
              🎯 미션 {s.missions.length}개 모두 완료! 보너스 +{s.missionBonus.toLocaleString()}🪙{streak > 1 ? ` · 🔥${streak}연속` : ""}
            </div>
          )}
          {newBestStreak && (
            <div className="mt-1 inline-block animate-bounce rounded-full bg-orange-400 px-3 py-0.5 text-xs font-black text-slate-900 shadow-[0_0_18px_rgba(251,146,60,0.6)] [animation-delay:300ms]">
              🏅 최고 연속 기록 경신! {streak}회
            </div>
          )}
        </div>
        <div className="mt-1 text-[11px] text-white/50 light:text-slate-500">
          {streak > 0
            ? `다음 잠수 올클리어 보너스 ${Math.round(allMissionsBonusRate(streak) * 100)}%${streak >= MISSION_STREAK_CAP ? " (최대)" : ""}`
            : brokenStreak > 0
              ? `🔥 미션 연속 올클리어 ${brokenStreak}회에서 끊겼어요 — 다음 올클리어 보너스는 다시 50%부터`
              : null}
          {bestStreak > 0 && (streak > 0 || brokenStreak > 0) && <span className="ml-1">· 🏅 최고 {bestStreak}회</span>}
        </div>
        <p className="mt-2 text-xs text-white/50 light:text-slate-500">
          {mapById(s.mapId).emoji} {mapById(s.mapId).name} · {def.name} · {Math.floor(s.seconds / 60)}분 {s.seconds % 60}초 생존 · 사인: {s.cause}
        </p>
      </div>
      {/* Dive analysis: how it ended + this map's record */}
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl border border-red-400/20 bg-red-500/10 p-3 light:border-red-200 light:bg-red-50">
          <div className="text-[10px] font-bold tracking-widest text-red-300/80 light:text-red-600">이번 잠수 사망 원인</div>
          <div className="mt-0.5 text-lg font-black text-white light:text-slate-900">
            💀 {s.cause}
            <span className="ml-1.5 text-xs font-semibold text-white/50 light:text-slate-500">
              {map.name}에서 {causeCount}번째
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-snug text-white/65 light:text-slate-600">💡 {deathTip(s.cause)}</p>
          {topCauses.length > 1 && (
            <div className="mt-1.5 flex flex-wrap gap-1 text-[10px] text-white/55 light:text-slate-500">
              자주 당한 원인:
              {topCauses.map(([c, n]) => (
                <span key={c} className="rounded-full bg-black/25 px-1.5 light:bg-white">
                  {c} ×{n}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-xl border border-yellow-400/20 bg-yellow-500/10 p-3 light:border-yellow-200 light:bg-yellow-50">
          <div className="text-[10px] font-bold tracking-widest text-yellow-300/80 light:text-yellow-700">맵별 최고 기록</div>
          {newMapBest && (
            <div className="mt-0.5 text-xs font-black text-yellow-300 light:text-yellow-700">
              🏆 {map.emoji} {map.name} 새 기록!{prevMapBest ? ` (이전 ${prevMapBest.score.toLocaleString()})` : " (첫 기록)"}
            </div>
          )}
          <MapRecords save={save} currentMap={s.mapId} currentShark={s.sharkId} />
        </div>
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

const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

/** Per-map best records; each map row expands into that map's per-shark bests. */
function MapRecords({ save, currentMap, currentShark }: { save: SharkSave; currentMap: MapId; currentShark: string }) {
  const [open, setOpen] = useState<Set<MapId>>(() => new Set([currentMap]));
  const toggle = (id: MapId) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <div className="mt-1 flex flex-col gap-0.5">
      {MAPS.map((m) => {
        const r = save.mapBest[m.id];
        const per = Object.values(save.mapSharkBest[m.id] ?? {}).sort((a, b) => b.score - a.score);
        const isOpen = open.has(m.id);
        return (
          <div key={m.id}>
            <button
              type="button"
              onClick={() => toggle(m.id)}
              aria-expanded={isOpen}
              className={`flex w-full items-center justify-between rounded px-1.5 py-0.5 text-left text-[11px] ${m.id === currentMap ? "bg-black/25 font-bold text-white light:bg-white light:text-slate-900" : "text-white/60 hover:bg-black/15 light:text-slate-600 light:hover:bg-white/70"}`}
            >
              <span>
                <span className="inline-block w-3 text-white/40 light:text-slate-400">{isOpen ? "▾" : "▸"}</span>
                {m.emoji} {m.name}
              </span>
              <span className="tabular-nums">{r ? `${r.score.toLocaleString()} · ${sharkById(r.sharkId).name} · ${clock(r.seconds)}` : "기록 없음"}</span>
            </button>
            {isOpen && (
              <div className="mt-0.5 mb-1 ml-4 flex flex-col gap-0.5 border-l border-white/10 pl-2 light:border-slate-300">
                {per.length === 0 ? (
                  <div className="text-[10px] text-white/40 light:text-slate-400">아직 이 지역 기록이 없어요.</div>
                ) : (
                  per.map((rec, i) => {
                    const sh = sharkById(rec.sharkId);
                    return (
                      <div
                        key={rec.sharkId}
                        className={`flex justify-between text-[10px] tabular-nums ${rec.sharkId === currentShark && m.id === currentMap ? "font-bold text-yellow-200 light:text-yellow-700" : "text-white/60 light:text-slate-600"}`}
                      >
                        <span>
                          {i === 0 ? "👑" : `${i + 1}.`} T{sh.tier} {sh.name}
                        </span>
                        <span>
                          {rec.score.toLocaleString()} · {clock(rec.seconds)}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        );
      })}
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
