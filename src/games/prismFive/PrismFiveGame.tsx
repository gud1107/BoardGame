"use client";

import { useEffect, useRef, useState } from "react";
import type { PlayableGameProps } from "../types";
import { trackGameEvent } from "@/lib/analytics/gameEvents";
import { recordSoloRun } from "@/lib/stats/soloResult";
import { BOSSES, DIFFICULTIES, HERO_ORDER, HEROES, MECHA, STAGES, type AnimKind, type Difficulty, type HeroId } from "./data";
import type { StageSummary } from "./engine";
import PrismFiveCanvas from "./PrismFiveCanvas";
import RulebookModal from "./RulebookModal";
import KeyHelpTable from "./KeyHelpTable";
import { drawPreview } from "./render";
import { applySummary, bestKey, freshSave, loadSave, writeSave, type PrismSave } from "./save";

/**
 * Solo arcade loop: 메뉴(히어로·스테이지·난이도) → 스테이지(PrismFiveCanvas)
 * → 결과 → 다음 스테이지/메뉴. Each finished stage is saved to /stats right
 * away; the shared game page only hears about it on "기록 저장하고 나가기".
 */

type Screen = "menu" | "playing" | "results";

interface Result {
  s: StageSummary;
  newBest: boolean;
  unlockedStage: number | null;
}

function Preview({ who, anim, size = 96, active = true }: { who: HeroId | "mecha"; anim: AnimKind | "idle"; size?: number; active?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = size * dpr;
    c.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    let t = 0;
    let raf = 0;
    const loop = () => {
      drawPreview(ctx, who, t, size, size, active ? anim : "idle");
      t++;
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [who, anim, size, active]);
  return <canvas ref={ref} style={{ width: size, height: size }} aria-hidden />;
}

const DEMO_ANIM: Record<HeroId, AnimKind> = { red: "slashH", blue: "straight", yellow: "shoot", green: "slam", pink: "whip" };

export default function PrismFiveGame({ participants, onComplete }: PlayableGameProps) {
  const [save, setSave] = useState<PrismSave>(() => (typeof window === "undefined" ? freshSave() : loadSave()));
  const [screen, setScreen] = useState<Screen>("menu");
  const [stage, setStage] = useState(1);
  const [runKey, setRunKey] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [showRules, setShowRules] = useState(false);

  const update = (fn: (s: PrismSave) => PrismSave) => {
    setSave((prev) => {
      const next = fn(prev);
      writeSave(next);
      return next;
    });
  };

  const start = (st: number) => {
    trackGameEvent("prism-five", "game_start", { isHost: true });
    setStage(st);
    setRunKey((k) => k + 1);
    setScreen("playing");
  };

  const handleEnd = (s: StageSummary) => {
    const { next, newBest, unlockedStage } = applySummary(save, s);
    recordSoloRun("prism-five", {
      runs: 1,
      clears: s.cleared ? 1 : 0,
      finalClears: s.cleared && s.stage === STAGES.length ? 1 : 0,
      maxStage: s.cleared ? s.stage : 0,
      maxScore: s.score,
      maxCombo: s.maxCombo,
      kills: s.kills,
      bossKills: s.bossKills,
      sGrades: s.grade === "S" ? 1 : 0,
      perfectDodges: s.perfectDodges,
      noDeathClears: s.cleared && s.livesLost === 0 ? 1 : 0,
    });
    setSave(next);
    writeSave(next);
    setResult({ s, newBest, unlockedStage });
    setScreen("results");
  };

  const finish = () => {
    const pid = participants[0]?.id ?? "solo";
    onComplete({ rankings: [{ playerId: pid, rank: 1 }], finishedAt: new Date().toISOString() });
  };

  if (screen === "playing") {
    return (
      <PrismFiveCanvas
        key={runKey}
        stage={stage}
        hero={save.hero}
        diff={save.diff}
        seed={runKey * 7919 + stage}
        muted={save.muted}
        onToggleMute={() => update((s) => ({ ...s, muted: !s.muted }))}
        noShake={save.noShake}
        reduceFlash={save.reduceFlash}
        onEnd={handleEnd}
        onQuit={() => setScreen("menu")}
      />
    );
  }

  const hero = HEROES[save.hero];

  return (
    <div className="flex flex-col gap-4">
      {screen === "results" && result && (
        <ResultsPanel
          r={result}
          onNext={() => start(Math.min(STAGES.length, result.s.stage + 1))}
          onRetry={() => start(result.s.stage)}
          onMenu={() => setScreen("menu")}
          onFinish={finish}
        />
      )}

      {screen === "menu" && (
        <>
          <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-red-600 via-indigo-800 to-pink-600 p-5 text-white">
            <div className="pointer-events-none absolute inset-0 opacity-30" style={{ background: "repeating-linear-gradient(115deg, transparent 0 18px, rgba(255,255,255,0.12) 18px 22px)" }} />
            <div className="relative">
              <div className="text-xs font-bold tracking-[0.3em] text-yellow-200">FLASH SQUADRON</div>
              <h2 className="text-3xl font-black italic drop-shadow">섬광전대 프리즘파이브</h2>
              <p className="mt-1 max-w-xl text-sm text-white/85">
                화염 검사·번개 격투가·중화기 공병·대지의 거인·물결 무희 — 싸우는 방식이 전혀 다른 다섯 히어로 중 하나로 변신해 암흑제국 졸개를 쓸어버리고, 괴인 보스를 브레이크한 뒤 합체 로봇 <b>{MECHA.name}</b>로 필살 일도양단!
              </p>
              <div className="mt-3 flex -space-x-3">
                {HERO_ORDER.map((id) => (
                  <Preview key={id} who={id} anim="pose" size={72} />
                ))}
              </div>
            </div>
          </div>

          {!save.tipsDismissed && (
            <div className="rounded-xl border border-yellow-300/30 bg-yellow-400/10 p-3 text-sm light:border-yellow-300 light:bg-yellow-50">
              <div className="font-bold">💡 처음이라면</div>
              <ul className="mt-1 list-disc pl-5 text-xs text-white/75 light:text-slate-600">
                <li>J 연타 → 2타 뒤 K = 피니셔. K 단독 = 띄우기 → 바로 Space로 점프 추격 → 공중에서 J 연타!</li>
                <li>
                  적 머리 위 <b className="text-red-400">!</b>가 보이면 L(회피). 맞기 직전에 피하면 <b>섬광 회피</b> 슬로 모션.
                </li>
                <li>보스는 밀리지 않습니다 — 노란 브레이크 게이지를 채워 BREAK를 노리세요.</li>
              </ul>
              <button type="button" className="mt-1 text-xs text-white/50 underline light:text-slate-500" onClick={() => update((s) => ({ ...s, tipsDismissed: true }))}>
                닫기
              </button>
            </div>
          )}

          {/* Hero select */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 light:border-slate-200 light:bg-white light:shadow-sm">
            <div className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500">히어로 선택</div>
            <div className="grid grid-cols-5 gap-1.5">
              {HERO_ORDER.map((id) => {
                const h = HEROES[id];
                const on = save.hero === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => update((s) => ({ ...s, hero: id }))}
                    className={`flex flex-col items-center rounded-xl border-2 p-1 transition ${on ? "scale-[1.03]" : "opacity-70 hover:opacity-100"}`}
                    style={{ borderColor: on ? h.color : "transparent", background: on ? `${h.color}22` : undefined }}
                  >
                    <Preview who={id} anim={DEMO_ANIM[id]} size={64} active={on} />
                    <span className="text-[11px] font-black" style={{ color: h.color }}>
                      {h.short}
                    </span>
                    <span className="hidden text-[10px] text-white/50 sm:block light:text-slate-500">{h.role}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-3 rounded-lg p-3 text-sm" style={{ background: `${hero.color}18`, borderLeft: `4px solid ${hero.color}` }}>
              <div className="font-black" style={{ color: hero.color }}>
                {hero.name} <span className="text-xs font-semibold text-white/50 light:text-slate-500">({hero.person}) · {hero.role} · {hero.weapon}</span>
              </div>
              <p className="text-xs text-white/70 light:text-slate-600">{hero.blurb}</p>
              <p className="mt-1 text-xs">
                <b style={{ color: hero.trim }}>고유 능력 · {hero.traitName}</b> <span className="text-white/70 light:text-slate-600">{hero.traitDesc}</span>
              </p>
              <div className="mt-1 flex flex-wrap gap-1 text-[11px]">
                <span className="rounded bg-black/20 px-1.5 py-0.5">HP {hero.hp}</span>
                {hero.skills.map((s, i) => (
                  <span key={s.id} className="rounded bg-black/20 px-1.5 py-0.5">
                    {"UIO"[i]} {s.name} <span className="opacity-60">{((s.cd ?? 0) / 60).toFixed(1)}초</span>
                  </span>
                ))}
                <span className="rounded bg-emerald-400/20 px-1.5 py-0.5">H {hero.poke.name}</span>
                <span className="rounded bg-yellow-400/20 px-1.5 py-0.5">F {hero.ult.name}</span>
              </div>
            </div>
          </div>

          {/* Difficulty */}
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(DIFFICULTIES) as Difficulty[]).map((d) => {
              const def = DIFFICULTIES[d];
              const on = save.diff === d;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => update((s) => ({ ...s, diff: d }))}
                  className={`rounded-xl border p-2 text-left text-xs ${on ? "border-yellow-300 bg-yellow-400/15 light:bg-yellow-50" : "border-white/10 bg-white/[0.03] light:border-slate-200 light:bg-white"}`}
                >
                  <div className="text-sm font-black">{def.name}</div>
                  <div className="text-white/60 light:text-slate-500">{def.blurb}</div>
                </button>
              );
            })}
          </div>

          {/* Stages */}
          <div className="grid gap-2 sm:grid-cols-2">
            {STAGES.map((st) => {
              const locked = st.id > save.unlocked;
              const best = save.best[bestKey(st.id, save.diff)];
              const bossId = st.waves.find((w) => w.boss)?.boss;
              return (
                <button
                  key={st.id}
                  type="button"
                  disabled={locked}
                  onClick={() => start(st.id)}
                  className={`flex items-center gap-3 rounded-xl border p-3 text-left ${locked ? "cursor-not-allowed border-white/5 opacity-40" : "border-white/10 bg-white/[0.04] hover:border-yellow-300/60 light:border-slate-200 light:bg-white"}`}
                >
                  <div className="text-2xl">{locked ? "🔒" : ["⛰️", "🌃", "🏭", "🏰", "👑"][st.id - 1]}</div>
                  <div className="min-w-0 flex-1">
                    <div className="font-black">{st.name}</div>
                    <div className="truncate text-xs text-white/60 light:text-slate-500">{bossId ? `${BOSSES[bossId].title} ${BOSSES[bossId].name}` : st.sub}</div>
                  </div>
                  {best && (
                    <div className="text-right">
                      <div className={`text-xl font-black italic ${best.grade === "S" ? "text-yellow-300" : "text-white/80 light:text-slate-700"}`}>{best.grade}</div>
                      <div className="text-[10px] text-white/50 tabular-nums light:text-slate-500">{best.score.toLocaleString()}</div>
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => start(save.unlocked)} className="flex-1 rounded-xl bg-gradient-to-r from-red-500 via-yellow-400 to-pink-500 px-4 py-3 text-base font-black text-white shadow-lg">
              ▶ STAGE {save.unlocked} 출격!
            </button>
            <button type="button" onClick={() => setShowRules(true)} className="rounded-xl border border-white/15 px-4 py-3 text-sm font-bold light:border-slate-300">
              📖 룰북
            </button>
          </div>

          <div className="flex flex-wrap gap-3 text-xs text-white/60 light:text-slate-500">
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={save.noShake} onChange={(e) => update((s) => ({ ...s, noShake: e.target.checked }))} /> 화면 흔들림 끄기
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={save.reduceFlash} onChange={(e) => update((s) => ({ ...s, reduceFlash: e.target.checked }))} /> 번쩍임·잔상 줄이기
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={save.muted} onChange={(e) => update((s) => ({ ...s, muted: e.target.checked }))} /> 소리 끄기
            </label>
            <span>
              출격 {save.runs}회 · 클리어 {save.clears}회 · 최고 콤보 {save.maxCombo}
            </span>
          </div>

          <details className="rounded-xl border border-white/10 p-3 text-xs light:border-slate-200" open>
            <summary className="cursor-pointer text-sm font-bold">⌨️ 모든 단축키 · 조작 (게임 중 ? / F1)</summary>
            <div className="mt-2">
              <KeyHelpTable />
            </div>
          </details>

          <button type="button" onClick={finish} className="self-start text-xs text-white/40 underline light:text-slate-400">
            기록 저장하고 나가기
          </button>
        </>
      )}

      {showRules && <RulebookModal onClose={() => setShowRules(false)} />}
    </div>
  );
}

function ResultsPanel({ r, onNext, onRetry, onMenu, onFinish }: { r: Result; onNext: () => void; onRetry: () => void; onMenu: () => void; onFinish: () => void }) {
  const s = r.s;
  const h = HEROES[s.hero];
  const st = STAGES.find((x) => x.id === s.stage)!;
  const final = s.cleared && s.stage === STAGES.length;
  const rows: [string, string][] = [
    ["클리어 시간", `${Math.floor(s.timeSec / 60)}:${String(s.timeSec % 60).padStart(2, "0")} (기준 ${Math.floor(st.par / 60)}:${String(st.par % 60).padStart(2, "0")})`],
    ["최대 콤보", `${s.maxCombo} HITS`],
    ["처치", `${s.kills} · 보스 ${s.bossKills}`],
    ["받은 피해", s.dmgTaken.toLocaleString()],
    ["잃은 변신", `${s.livesLost}`],
    ["섬광 회피", `${s.perfectDodges}회`],
    ["최고 스타일", s.styleTop],
  ];
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 light:border-slate-200">
      <div className="p-5 text-white" style={{ background: s.cleared ? `linear-gradient(135deg, ${h.color}, #1e1b4b)` : "linear-gradient(135deg, #3f3f46, #18181b)" }}>
        <div className="text-xs font-bold tracking-[0.3em] text-yellow-200">{st.name}</div>
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="text-3xl font-black italic">{final ? "🎉 암흑제국 격멸!" : s.cleared ? "STAGE CLEAR!" : "GAME OVER"}</div>
            <div className="text-sm text-white/80">
              {h.name} · {DIFFICULTIES[s.diff].name}
              {r.newBest && <span className="ml-2 rounded bg-yellow-400 px-1.5 py-0.5 text-xs font-black text-slate-900">NEW BEST</span>}
            </div>
          </div>
          {s.cleared && <div className={`text-6xl font-black italic drop-shadow ${s.grade === "S" ? "text-yellow-300" : "text-white"}`}>{s.grade}</div>}
        </div>
        <div className="mt-2 text-2xl font-black tabular-nums">{s.score.toLocaleString()}점</div>
        {final && <p className="mt-2 text-sm">암흑황제 네메시스를 쓰러뜨리고 지구의 평화를 지켜냈다! 섬광전대 프리즘파이브 — 다음 출동까지 대기!</p>}
        {r.unlockedStage && !final && <div className="mt-1 text-sm font-bold text-yellow-200">🔓 STAGE {r.unlockedStage} 해금!</div>}
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-2">
        <table className="w-full text-sm">
          <tbody>
            {rows.map(([a, b]) => (
              <tr key={a}>
                <td className="py-0.5 text-white/60 light:text-slate-500">{a}</td>
                <td className="py-0.5 text-right font-bold tabular-nums">{b}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {s.cleared && (
          <table className="w-full text-sm">
            <tbody>
              {[
                ["클리어 보너스", s.bonus.clear],
                ["시간 보너스", s.bonus.time],
                ["노데스 보너스", s.bonus.noDeath],
                ["변신 스톡 보너스", s.bonus.lives],
              ].map(([a, b]) => (
                <tr key={a as string}>
                  <td className="py-0.5 text-white/60 light:text-slate-500">{a}</td>
                  <td className="py-0.5 text-right font-bold tabular-nums">+{(b as number).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="flex flex-wrap gap-2 border-t border-white/10 p-4 light:border-slate-200">
        {s.cleared && !final && (
          <button type="button" onClick={onNext} className="rounded-lg bg-yellow-400 px-4 py-2 text-sm font-black text-slate-900">
            ▶ 다음 스테이지
          </button>
        )}
        <button type="button" onClick={onRetry} className="rounded-lg bg-white/15 px-4 py-2 text-sm font-bold light:bg-slate-100">
          🔁 다시 도전
        </button>
        <button type="button" onClick={onMenu} className="rounded-lg bg-white/10 px-4 py-2 text-sm font-bold light:bg-slate-100">
          🏠 메뉴
        </button>
        <button type="button" onClick={onFinish} className="ml-auto rounded-lg px-3 py-2 text-xs text-white/50 underline light:text-slate-500">
          기록 저장하고 나가기
        </button>
      </div>
    </div>
  );
}
