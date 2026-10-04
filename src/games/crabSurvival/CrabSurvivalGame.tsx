"use client";

import { useEffect, useRef, useState } from "react";
import type { PlayableGameProps } from "../types";
import { trackGameEvent } from "@/lib/analytics/gameEvents";
import { CRAB_COLORS, EVO_REVEAL, isUnlocked, MATCH_LENGTHS, roadmap, SHELL_BAND_LABEL, SHELL_PIECE_LABEL, SHELL_STYLE, SPECIES, SPECIES_LIST, type CrabColor, type ShieldKind, type SpeciesId, type WeaponKind } from "./data";
import type { MatchSummary } from "./engine";
import CrabSurvivalCanvas from "./CrabSurvivalCanvas";
import RulebookModal from "./RulebookModal";
import { drawCrabPreview } from "./render";
import { EMPTY_RECORD, freshSave, loadSave, nextSpeciesRecord, trophiesFor, writeSave, type CrabSave, type SpeciesRecord } from "./save";

/**
 * Solo arcade loop: 로비(닉네임·색·경기 시간) → 경기(CrabSurvivalCanvas, AI 게
 * 13마리) → 결과 → 로비... The shared game page only hears about it once the
 * player explicitly leaves ("기록 저장하고 나가기"), which reports a trivial
 * 1-player ranking so the play still lands in history/analytics.
 */

type Screen = "menu" | "playing" | "results";

interface MatchResult {
  s: MatchSummary;
  newBest: boolean;
  trophies: number;
  species: SpeciesId;
  record: SpeciesRecord;
  /** Beat this species' previous best (not counted on its first match). */
  speciesBest: boolean;
  /** New species records for bounty points / legendary carry time this match. */
  bountyRecord: boolean;
  epicRecord: boolean;
  unlocked: SpeciesId[];
}

export default function CrabSurvivalGame({ participants, onComplete }: PlayableGameProps) {
  // Client-only component (dynamic import with ssr:false), so localStorage is safe here.
  const [save, setSave] = useState<CrabSave>(() => {
    const s = typeof window === "undefined" ? freshSave() : loadSave();
    return s.name ? s : { ...s, name: participants[0]?.name?.slice(0, 10) ?? "" };
  });
  const [screen, setScreen] = useState<Screen>("menu");
  const [runKey, setRunKey] = useState(0);
  const [result, setResult] = useState<MatchResult | null>(null);
  const [showRules, setShowRules] = useState(false);

  const update = (fn: (s: CrabSave) => CrabSave) => {
    setSave((prev) => {
      const next = fn(prev);
      writeSave(next);
      return next;
    });
  };

  const color = CRAB_COLORS.find((c) => c.id === save.colorId) ?? CRAB_COLORS[0];
  // A species only counts once unlocked; anything else falls back to 꽃게.
  const species: SpeciesId = isUnlocked(save.species, save.trophies) ? save.species : "flower";

  const start = () => {
    // Solo game: every match is a real start (public play count + /admin/games).
    trackGameEvent("crab-survival", "game_start", { isHost: true });
    setRunKey((k) => k + 1);
    setScreen("playing");
  };

  const handleEnd = (s: MatchSummary) => {
    const trophies = trophiesFor(s.rank, s.total);
    const newBest = s.score > save.best;
    const prevRec = save.speciesStats[species] ?? EMPTY_RECORD;
    const { record, bountyRecord, epicRecord } = nextSpeciesRecord(prevRec, { score: s.score, rank: s.rank, ...s.stats });
    const unlocked = SPECIES_LIST.filter((sp) => !isUnlocked(sp.id, save.trophies) && isUnlocked(sp.id, save.trophies + trophies)).map((sp) => sp.id);
    update((sv) => ({
      ...sv,
      best: Math.max(sv.best, s.score),
      matches: sv.matches + 1,
      wins: sv.wins + (s.rank === 1 ? 1 : 0),
      trophies: sv.trophies + trophies,
      totalKills: sv.totalKills + s.stats.kills,
      kingSeconds: sv.kingSeconds + Math.round(s.stats.kingSeconds),
      maxLevel: Math.max(sv.maxLevel, s.stats.maxLevel),
      speciesStats: { ...sv.speciesStats, [species]: record },
    }));
    setResult({
      s,
      newBest,
      trophies,
      species,
      record,
      speciesBest: s.score > prevRec.best && prevRec.matches > 0,
      bountyRecord,
      epicRecord,
      unlocked,
    });
    setScreen("results");
  };

  const finish = () => {
    const pid = participants[0]?.id ?? "solo";
    onComplete({ rankings: [{ playerId: pid, rank: 1 }], finishedAt: new Date().toISOString() });
  };

  if (screen === "playing") {
    return (
      <CrabSurvivalCanvas
        key={runKey}
        playerName={save.name.trim() || "나"}
        colorId={save.colorId}
        species={species}
        duration={save.duration}
        muted={save.muted}
        onToggleMute={() => update((s) => ({ ...s, muted: !s.muted }))}
        followMouse={save.followMouse}
        onToggleFollow={() => update((s) => ({ ...s, followMouse: !s.followMouse }))}
        onEnd={handleEnd}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {screen === "results" && result && <ResultsPanel result={result} color={color} onRetry={start} onMenu={() => setScreen("menu")} />}

      {screen === "menu" && (
        <>
          {/* Header */}
          <div className="relative overflow-hidden rounded-2xl border border-orange-300/20 bg-gradient-to-b from-sky-400 via-cyan-600 to-amber-200 p-5 light:border-orange-200">
            <SandWaves />
            <div className="relative z-10 flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="text-xs font-bold tracking-[0.3em] text-white/85 drop-shadow">BEACH BATTLE ROYALE</div>
                <h2 className="text-2xl font-black text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.35)] sm:text-3xl">🦀 꽃게 서바이벌</h2>
                <p className="mt-1 max-w-md text-xs font-medium text-white/90 drop-shadow">
                  아기 꽃게로 시작해 먹고, 부수고, 뒤집으며 3.5배까지 거대해지세요. 섬에서 가장 큰 게만이 왕관을 씁니다.
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <div className="rounded-full bg-black/35 px-3 py-1 text-sm font-black text-yellow-200">🏆 {save.trophies.toLocaleString()}</div>
                <div className="text-[11px] font-semibold text-slate-800/80">
                  {save.matches}판 · 1위 {save.wins}회 · 최고 {save.best.toLocaleString()}점
                </div>
                <OverallRecords stats={save.speciesStats} />
              </div>
            </div>
          </div>

          <div className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:grid-cols-[1fr_1.25fr] light:border-slate-200 light:bg-white light:shadow-sm">
            {/* Preview */}
            <div className="flex flex-col items-center gap-2">
              <div className="w-full rounded-xl bg-gradient-to-b from-amber-100 to-amber-200 p-2 light:from-amber-50 light:to-amber-100">
                <CrabPreview color={color} species={species} width={260} height={170} animate weapon="bat" shield="potLid" />
              </div>
              <div className="text-center text-sm font-black text-white light:text-slate-900">
                {save.name.trim() || "이름 없는 게"} <span className="text-xs font-semibold text-white/50 light:text-slate-400">· {SPECIES[species].name}({SPECIES[species].role}) · {color.name}</span>
              </div>
              <div className="grid w-full grid-cols-3 gap-1 text-center text-[10px] text-white/60 light:text-slate-500">
                <Stat label="누적 처치" value={`✂️ ${save.totalKills}`} />
                <Stat label="왕좌 시간" value={`👑 ${Math.floor(save.kingSeconds / 60)}분`} />
                <Stat label="최대 성장" value={`Lv${save.maxLevel}`} />
              </div>
            </div>

            {/* Setup */}
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-white/60 light:text-slate-500">닉네임</span>
                <input
                  value={save.name}
                  maxLength={10}
                  placeholder="꽃게 이름 (최대 10자)"
                  onChange={(e) => update((s) => ({ ...s, name: e.target.value }))}
                  className="rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-orange-400 light:border-slate-300 light:bg-white light:text-slate-900"
                />
              </label>
              <div>
                <div className="mb-1 text-xs font-semibold text-white/60 light:text-slate-500">껍데기 색</div>
                <div className="grid grid-cols-4 gap-1.5">
                  {CRAB_COLORS.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => update((s) => ({ ...s, colorId: c.id }))}
                      className={`flex flex-col items-center rounded-lg border p-1 transition ${
                        c.id === color.id ? "border-orange-400 bg-orange-500/15 ring-2 ring-orange-400/50" : "border-white/10 bg-white/[0.03] hover:border-white/30 light:border-slate-200 light:bg-slate-50"
                      }`}
                      title={c.name}
                    >
                      <CrabPreview color={c} species={species} width={56} height={40} />
                      <span className="truncate text-[9px] text-white/70 light:text-slate-600">{c.name}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1 text-xs font-semibold text-white/60 light:text-slate-500">경기 시간</div>
                <div className="grid grid-cols-3 gap-1.5">
                  {MATCH_LENGTHS.map((m) => (
                    <button
                      key={m.seconds}
                      onClick={() => update((s) => ({ ...s, duration: m.seconds }))}
                      className={`rounded-lg border px-2 py-2 text-xs font-bold transition ${
                        save.duration === m.seconds ? "border-orange-400 bg-orange-500/20 text-orange-200 light:text-orange-700" : "border-white/10 text-white/70 hover:border-white/30 light:border-slate-200 light:text-slate-600"
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
              <RoadmapChips species={species} />
              <GrowthLooks color={color} species={species} />
            </div>
          </div>

          <SpeciesPicker value={species} color={color} trophies={save.trophies} records={save.speciesStats} onChange={(id) => update((s) => ({ ...s, species: id }))} />

          {!save.tipsDismissed && <TipCard onDismiss={() => update((s) => ({ ...s, tipsDismissed: true }))} onRules={() => setShowRules(true)} />}

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              onClick={start}
              className="flex-1 rounded-xl bg-gradient-to-r from-orange-500 to-red-500 py-3.5 text-base font-black text-white shadow-lg shadow-orange-500/30 transition hover:brightness-110"
            >
              🏝️ 섬으로 출발!
            </button>
            <button
              onClick={() => setShowRules(true)}
              className="rounded-xl border border-white/15 px-4 py-3 text-sm font-semibold text-white/80 hover:border-white/40 light:border-slate-300 light:text-slate-700"
            >
              📖 룰북
            </button>
            {save.tipsDismissed && (
              <button
                onClick={() => update((s) => ({ ...s, tipsDismissed: false }))}
                className="rounded-xl border border-white/15 px-4 py-3 text-sm font-semibold text-white/80 hover:border-white/40 light:border-slate-300 light:text-slate-700"
                title="처음 플레이 팁 카드를 다시 펼칩니다"
              >
                💡 팁 다시 보기
              </button>
            )}
            <button
              onClick={finish}
              className="rounded-xl border border-white/15 px-4 py-3 text-sm font-semibold text-white/60 hover:border-white/40 light:border-slate-300 light:text-slate-600"
            >
              🏁 기록 저장하고 나가기
            </button>
          </div>
          <p className="text-center text-[11px] text-white/35 light:text-slate-400">
            PC: 마우스 방향 이동 · 좌클릭/스페이스 공격 · 우클릭/Shift 부스트 · E 특수기 · WASD 이동 가능 · Esc 일시정지 &nbsp;|&nbsp; 모바일: 드래그 조이스틱 + 🦀 공격 · 💨 부스트 · 노란 버튼 특수기
          </p>
        </>
      )}

      {showRules && <RulebookModal onClose={() => setShowRules(false)} />}
    </div>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function CrabPreview({
  color,
  species,
  width,
  height,
  animate,
  weapon,
  shield,
  crown,
  level,
  revealLoop,
}: {
  color: CrabColor;
  species?: SpeciesId;
  width: number;
  height: number;
  animate?: boolean;
  weapon?: WeaponKind;
  shield?: ShieldKind;
  crown?: boolean;
  level?: number;
  /** Replay the level-up pattern reveal on a loop (seconds per cycle, phase offset). */
  revealLoop?: { period: number; offset: number };
}) {
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
      const sec = t / 1000;
      let reveal: number | undefined;
      if (revealLoop) {
        const ph = (sec + revealLoop.offset) % revealLoop.period;
        if (ph < EVO_REVEAL) reveal = ph / EVO_REVEAL;
      }
      drawCrabPreview(ctx, color, width, height, animate || revealLoop ? sec : 0.4, { weapon, shield, crown, species, level, reveal });
      if (animate || revealLoop) raf = requestAnimationFrame(draw);
    };
    draw(0);
    return () => cancelAnimationFrame(raf);
  }, [color, species, width, height, animate, weapon, shield, crown, level, revealLoop]);
  return <canvas ref={ref} style={{ width, height, maxWidth: "100%" }} className="mx-auto block" />;
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

function ResultsPanel({
  result,
  color,
  onRetry,
  onMenu,
}: {
  result: MatchResult;
  color: CrabColor;
  onRetry: () => void;
  onMenu: () => void;
}) {
  const { s, newBest, trophies, species, record, speciesBest, bountyRecord, epicRecord, unlocked } = result;
  const sp = SPECIES[species];
  const lv = roadmap(species)[Math.max(0, s.stats.maxLevel - 1)];
  const title = s.rank === 1 ? "👑 섬의 왕!" : s.rank <= 3 ? "🥈 포디움 입성!" : s.endedByDeath ? "뒤집혔지만 잘 싸웠다!" : "생존 완료!";
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-gradient-to-b from-slate-900 to-slate-950 p-5 light:border-slate-200 light:from-white light:to-slate-50">
      <div className="flex flex-col items-center text-center">
        <div className="text-xs font-bold tracking-[0.3em] text-white/40 light:text-slate-400">MATCH RESULT</div>
        <CrabPreview color={color} species={species} width={160} height={100} animate crown={s.rank === 1} level={s.stats.maxLevel} />
        <div className="text-lg font-black text-white light:text-slate-900">{title}</div>
        <div className="mt-1 text-4xl font-black text-white tabular-nums light:text-slate-900">
          {s.rank}
          <span className="text-lg text-white/50 light:text-slate-400"> / {s.total}위</span>
        </div>
        <div className="mt-1 text-xl font-black text-yellow-300 tabular-nums light:text-amber-600">{s.score.toLocaleString()}점</div>
        <div className="mt-1 flex gap-1.5">
          {newBest && <span className="animate-bounce rounded-full bg-yellow-400 px-3 py-0.5 text-xs font-black text-slate-900">🏆 최고 기록!</span>}
          {speciesBest && <span className="rounded-full bg-pink-400 px-3 py-0.5 text-xs font-black text-slate-900">🧬 {sp.name} 신기록!</span>}
          {bountyRecord && <span className="rounded-full bg-amber-400 px-3 py-0.5 text-xs font-black text-slate-900">💰 현상금 신기록!</span>}
          {epicRecord && <span className="rounded-full bg-yellow-200 px-3 py-0.5 text-xs font-black text-slate-900">🌟 전설 보유 신기록!</span>}
          <span className="rounded-full bg-orange-500/20 px-3 py-0.5 text-xs font-black text-orange-200 light:text-orange-700">트로피 +{trophies}</span>
        </div>
        <p className="mt-2 text-xs text-white/50 light:text-slate-500">
          {Math.floor(s.seconds / 60)}분 {s.seconds % 60}초 · {s.endedByDeath ? `${s.killedBy ?? "누군가"}에게 뒤집혀 종료` : "제한 시간 생존"}
        </p>
      </div>
      {unlocked.length > 0 && (
        <div className="rounded-xl border border-yellow-300/40 bg-yellow-400/10 p-3 text-center">
          <div className="text-sm font-black text-yellow-200 light:text-amber-700">🔓 새 성장 경로 해금!</div>
          <div className="mt-0.5 text-xs text-white/70 light:text-slate-600">
            {unlocked.map((id) => `${SPECIES[id].name}(${SPECIES[id].role})`).join(" · ")} — 로비에서 골라 보세요
          </div>
        </div>
      )}
      <div className="rounded-xl bg-white/5 p-3 light:bg-slate-100">
        <div className="mb-1.5 text-xs font-semibold text-white/50 light:text-slate-500">
          🧬 {sp.name}({sp.role}) 전적
        </div>
        <div className="grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
          <Stat label="최고 점수" value={fmtK(record.best)} />
          <Stat label="1위" value={`${record.wins}회`} />
          <Stat label="플레이" value={`${record.matches}판`} />
          <Stat label="최대 성장" value={`Lv${record.maxLevel}`} />
          <Stat label="💰 최다 현상금" value={record.bestBounty ? fmtK(record.bestBounty) : "—"} />
          <Stat label="🌟 최장 전설 보유" value={record.longestEpic ? `${record.longestEpic}초` : "—"} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
        <Stat label="처치" value={`✂️ ${s.stats.kills}`} />
        <Stat label="최대 성장" value={`Lv${s.stats.maxLevel}`} sub={lv.name} />
        <Stat label="최고 콤보" value={`${s.stats.bestCombo}`} />
        <Stat label="왕좌 시간" value={`${Math.round(s.stats.kingSeconds)}초`} />
        <Stat label="최고 점수" value={s.stats.peakScore.toLocaleString()} />
        <Stat label="부순 상자" value={`${s.stats.boxes}`} />
        <Stat label="먹은 것" value={`${s.stats.eaten}`} />
        <Stat label="가한 피해" value={s.stats.damageDealt.toLocaleString()} />
        <Stat label="💰 현상금 획득" value={`${s.stats.bounties ?? 0}회`} sub={s.stats.bountyPoints ? `+${s.stats.bountyPoints.toLocaleString()}점` : undefined} />
        <Stat label="최고 무기 ★" value={s.stats.bestStar ? "★".repeat(s.stats.bestStar) : "—"} />
        <Stat label="🌟 전설 보유" value={`${Math.round(s.stats.epicSeconds ?? 0)}초`} />
        <Stat label="🛡 생존 보상" value={s.stats.survivalBonus ? `+${s.stats.survivalBonus.toLocaleString()}` : "—"} />
      </div>
      <div>
        <div className="mb-1.5 text-xs font-semibold text-white/50 light:text-slate-500">최종 순위</div>
        <div className="flex flex-col gap-0.5">
          {s.top.map((r, i) => (
            <div
              key={`${r.name}-${i}`}
              className={`flex items-center gap-2 rounded-md px-2.5 py-1 text-xs ${r.isPlayer ? "bg-cyan-500/20 font-black text-cyan-200 light:text-cyan-800" : "bg-white/5 text-white/70 light:bg-slate-100 light:text-slate-600"}`}
            >
              <span className="w-5 text-right tabular-nums">{i + 1}</span>
              <span className="flex-1 truncate">
                {i === 0 ? "👑 " : ""}
                {r.name}
                {r.isPlayer ? " (나)" : ""}
              </span>
              <span className="text-[10px] opacity-70">Lv{r.level}</span>
              <span className="w-20 text-right tabular-nums">{r.score.toLocaleString()}</span>
            </div>
          ))}
          {s.rank > s.top.length && (
            <div className="flex items-center gap-2 rounded-md bg-cyan-500/20 px-2.5 py-1 text-xs font-black text-cyan-200 light:text-cyan-800">
              <span className="w-5 text-right tabular-nums">{s.rank}</span>
              <span className="flex-1">나</span>
              <span className="w-20 text-right tabular-nums">{s.score.toLocaleString()}</span>
            </div>
          )}
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={onRetry} className="flex-1 rounded-xl bg-gradient-to-r from-orange-500 to-red-500 py-3 font-black text-white hover:brightness-110">
          🔁 다시 도전
        </button>
        <button onClick={onMenu} className="flex-1 rounded-xl bg-white/10 py-3 font-black text-white hover:bg-white/20 light:bg-slate-200 light:text-slate-800">
          🏝️ 로비로
        </button>
      </div>
    </div>
  );
}

/** Staggered so the three evolving previews don't flash in unison (stable refs for the effect deps). */
const LOOKS_LOOP: Record<number, { period: number; offset: number }> = {
  4: { period: 2.6, offset: 0 },
  8: { period: 2.6, offset: 1.73 },
  11: { period: 2.6, offset: 0.87 },
};

/** 성장 외형: what the shell pattern looks like at each evolution tier. */
function GrowthLooks({ color, species }: { color: CrabColor; species: SpeciesId }) {
  const style = SHELL_STYLE[species];
  const steps: [number, string][] = [
    [1, "Lv1 기본"],
    [4, `Lv4 ${SHELL_BAND_LABEL[style.band]}`],
    [8, `Lv8 ${SHELL_PIECE_LABEL[style.piece]}`],
    [11, "Lv11 오색 광채"],
  ];
  return (
    <div className="rounded-lg bg-black/20 p-2 light:bg-slate-50">
      <div className="mb-1 text-[11px] font-bold text-white/80 light:text-slate-700">✨ 성장 외형 — 진화할수록 등딱지가 화려해져요</div>
      <div className="grid grid-cols-4 gap-1">
        {steps.map(([lv, label]) => (
          <div key={lv} className="flex flex-col items-center rounded bg-gradient-to-b from-amber-100 to-amber-200 py-0.5">
            <CrabPreview color={color} species={species} width={70} height={48} level={lv} animate={lv >= 11} revealLoop={lv > 1 ? LOOKS_LOOP[lv] : undefined} />
            <span className="text-[9px] font-semibold text-slate-700">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RoadmapChips({ species }: { species: SpeciesId }) {
  const road = roadmap(species);
  const sp = SPECIES[species];
  const k = (n: number) => (n >= 1000 ? `${+(n / 1000).toFixed(1)}k` : `${n}`);
  return (
    <div className="rounded-lg bg-black/20 p-2 text-[10px] text-white/65 light:bg-slate-50 light:text-slate-600">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[11px] font-bold text-white/80 light:text-slate-700">
          성장 로드맵 · {sp.name}({sp.role})
        </span>
        <span className="text-white/40 light:text-slate-400">12단계</span>
      </div>
      <div className="grid grid-cols-4 gap-0.5">
        {road.map((l) => (
          <div
            key={l.level}
            className={`rounded px-1 py-0.5 leading-tight ${l.level === road.length ? "bg-yellow-400/20 text-yellow-200 light:text-amber-700" : "bg-white/5 light:bg-white"}`}
          >
            <div className="truncate">
              Lv{l.level} {l.name}
            </div>
            <b className="tabular-nums">{k(l.points)}</b> <span className="opacity-60">×{l.scale}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SpeciesPicker({
  value,
  color,
  trophies,
  records,
  onChange,
}: {
  value: SpeciesId;
  color: CrabColor;
  trophies: number;
  records: CrabSave["speciesStats"];
  onChange: (id: SpeciesId) => void;
}) {
  const base = roadmap("flower");
  const bar = (v: number) => `${Math.max(8, Math.min(100, (v / 1.4) * 100))}%`;
  const tone = (v: number) => (v < 1 ? "text-emerald-300 light:text-emerald-600" : v > 1 ? "text-rose-300 light:text-rose-600" : "");
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 light:border-slate-200 light:bg-white light:shadow-sm">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-1">
        <div className="text-sm font-black text-white light:text-slate-900">🧬 성장 경로 선택</div>
        <div className="text-[10px] text-white/40 light:text-slate-400">트로피를 모아 새 경로를 해금하세요 · 보유 🏆 {trophies}</div>
      </div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {SPECIES_LIST.map((sp) => {
          const road = roadmap(sp.id);
          const active = sp.id === value;
          const open = isUnlocked(sp.id, trophies);
          const rec = records[sp.id];
          // Cost to reach Lv7 (성체) vs 꽃게, and cost of Lv7→Lv12 vs 꽃게.
          const early = road[6].points / base[6].points;
          const late = (road[11].points - road[6].points) / (base[11].points - base[6].points);
          const stats: [string, number][] = [
            ["공격", sp.atk],
            ["체력", sp.hp],
            ["속도", sp.speed],
          ];
          return (
            <button
              key={sp.id}
              disabled={!open}
              onClick={() => onChange(sp.id)}
              className={`relative flex flex-col gap-1 rounded-xl border p-2 text-left transition disabled:cursor-not-allowed ${
                active ? "border-orange-400 bg-orange-500/15 ring-2 ring-orange-400/50" : "border-white/10 bg-white/[0.03] hover:border-white/30 light:border-slate-200 light:bg-slate-50"
              }`}
            >
              <div className={`relative rounded-lg bg-gradient-to-b from-amber-100 to-amber-200 ${open ? "" : "opacity-40 grayscale"}`}>
                <CrabPreview color={color} species={sp.id} width={120} height={70} animate={active} />
              </div>
              {!open && (
                <div className="absolute inset-x-2 top-2 flex h-[70px] flex-col items-center justify-center gap-1 rounded-lg bg-slate-950/55 text-white">
                  <span className="text-lg">🔒</span>
                  <span className="text-[10px] font-black">🏆 {sp.unlock} 필요</span>
                  <div className="h-1 w-3/4 overflow-hidden rounded-full bg-white/20">
                    <div className="h-full rounded-full bg-yellow-300" style={{ width: `${Math.min(100, (trophies / sp.unlock) * 100)}%` }} />
                  </div>
                </div>
              )}
              <div className="flex items-baseline gap-1">
                <span className="text-sm font-black text-white light:text-slate-900">{sp.name}</span>
                <span className="text-[10px] font-bold text-orange-300 light:text-orange-600">{sp.role}</span>
              </div>
              <p className="text-[10px] leading-snug text-white/55 light:text-slate-500">{sp.blurb}</p>
              {stats.map(([label, v]) => (
                <div key={label} className="flex items-center gap-1 text-[9px]">
                  <span className="w-6 shrink-0 text-white/50 light:text-slate-500">{label}</span>
                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10 light:bg-slate-200">
                    <div className={`h-full rounded-full ${v > 1 ? "bg-emerald-400" : v < 1 ? "bg-rose-400" : "bg-sky-400"}`} style={{ width: bar(v) }} />
                  </div>
                  <span className="w-8 shrink-0 text-right tabular-nums text-white/70 light:text-slate-600">×{v}</span>
                </div>
              ))}
              <div className="text-[9px] text-white/50 light:text-slate-500">
                필요 점수 초반 <b className={tone(early)}>{Math.round(early * 100)}%</b> · 후반 <b className={tone(late)}>{Math.round(late * 100)}%</b>
              </div>
              <div className="rounded bg-black/20 px-1.5 py-1 text-[9px] leading-snug text-white/70 light:bg-white light:text-slate-600">
                <b style={{ color: sp.perk.color }}>
                  {sp.perk.icon} {sp.perk.name}
                </b>{" "}
                {sp.perk.desc}
              </div>
              <div className="text-[9px] text-white/60 light:text-slate-500">
                {rec && rec.matches > 0 ? (
                  <>
                    📊 최고 <b className="text-white/85 light:text-slate-800">{fmtK(rec.best)}</b> · 1위 {rec.wins}회 · {rec.matches}판
                    {(rec.bestBounty || rec.longestEpic) ? (
                      <div>
                        {rec.bestBounty ? <>💰 {fmtK(rec.bestBounty)}</> : null}
                        {rec.bestBounty && rec.longestEpic ? " · " : ""}
                        {rec.longestEpic ? <>🌟 {rec.longestEpic}초</> : null}
                      </div>
                    ) : null}
                  </>
                ) : (
                  "📊 아직 전적 없음"
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Best bounty haul / longest legendary carry across every species, with the species that set it. */
function OverallRecords({ stats }: { stats: CrabSave["speciesStats"] }) {
  const best = (key: "bestBounty" | "longestEpic") => {
    let top: { v: number; id: SpeciesId } | null = null;
    for (const sp of SPECIES_LIST) {
      const v = stats[sp.id]?.[key] ?? 0;
      if (v > 0 && (!top || v > top.v)) top = { v, id: sp.id };
    }
    return top;
  };
  const bounty = best("bestBounty"), epic = best("longestEpic");
  if (!bounty && !epic) return null;
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {bounty && (
        <span className="rounded-full bg-black/35 px-2 py-0.5 text-[10px] font-bold text-amber-200" title="한 판에 받은 현상금 합계 최고 기록 (모든 게 종류)">
          💰 최다 현상금 {fmtK(bounty.v)} · {SPECIES[bounty.id].name}
        </span>
      )}
      {epic && (
        <span className="rounded-full bg-black/35 px-2 py-0.5 text-[10px] font-bold text-yellow-100" title="한 판에 전설 무기를 들고 버틴 최장 시간 (모든 게 종류)">
          🌟 최장 전설 보유 {epic.v}초 · {SPECIES[epic.id].name}
        </span>
      )}
    </div>
  );
}

/** First-timer primer for the 하이퍼 성장 systems; hidden for good once dismissed. */
function TipCard({ onDismiss, onRules }: { onDismiss: () => void; onRules: () => void }) {
  const tips: [string, string, string][] = [
    ["🔱", "해저 무기", "반짝이는 무기를 밟으면 가장 가까운 적에게 자동 발사돼요. 최대 2개, 같은 무기를 또 주우면 ★강화. 등급은 일반 < 희귀 < 전설."],
    ["🧪", "변이 아이템", "초록 빛은 순수 강화, 빨간 빛은 리스크 — 벌칙은 처음 몇 초뿐이고 이점은 더 오래가요. 바닥의 검은 웅덩이는 미끄러운 기름 함정!"],
    ["⚡", "진화 특수기", "Lv4·8·11에서 진화할 때마다 E키(모바일 노란 버튼) 특수기가 바뀌어요: 대시 → 버블 기절 → 모래 잠복 → 수류 빔."],
    ["💰", "전설 현상금", "전설 무기를 들면 섬 전체의 표적! 버틸수록 생존 보상과 내 현상금이 쌓이고, 남의 전설 보유자를 쓰러뜨리면 현상금을 받아요."],
  ];
  return (
    <div className="rounded-2xl border border-cyan-300/30 bg-gradient-to-br from-cyan-500/10 to-amber-400/10 p-3 light:border-cyan-200 light:from-cyan-50 light:to-amber-50">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-sm font-black text-white light:text-slate-900">🆕 처음이라면 알아두세요</div>
        <div className="flex gap-1.5">
          <button onClick={onRules} className="rounded-lg border border-white/20 px-2 py-1 text-[11px] font-semibold text-white/80 hover:border-white/50 light:border-slate-300 light:text-slate-600">
            📖 자세히
          </button>
          <button onClick={onDismiss} className="rounded-lg bg-cyan-500/30 px-2 py-1 text-[11px] font-bold text-cyan-100 hover:bg-cyan-500/50 light:bg-cyan-100 light:text-cyan-800">
            알겠어요 ✕
          </button>
        </div>
      </div>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {tips.map(([icon, title, body]) => (
          <div key={title} className="flex gap-2 rounded-lg bg-black/20 p-2 light:bg-white">
            <span className="text-xl leading-none">{icon}</span>
            <div>
              <div className="text-xs font-black text-white light:text-slate-800">{title}</div>
              <p className="text-[11px] leading-snug text-white/65 light:text-slate-600">{body}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function fmtK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

function SandWaves() {
  return (
    <svg className="pointer-events-none absolute inset-x-0 bottom-0 h-16 w-full opacity-70" viewBox="0 0 400 60" preserveAspectRatio="none" aria-hidden>
      <path d="M0 30 Q 50 18 100 30 T 200 30 T 300 30 T 400 30 V60 H0Z" fill="#fde68a" />
      <path d="M0 30 Q 50 18 100 30 T 200 30 T 300 30 T 400 30" fill="none" stroke="#fff" strokeWidth="3" opacity="0.8" />
    </svg>
  );
}
