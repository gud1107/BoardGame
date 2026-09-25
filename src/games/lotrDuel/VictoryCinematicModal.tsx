"use client";

import type { CSSProperties, ReactNode } from "react";
import { SealStamp } from "./CardArt";
import { ADJACENCY, FACTION_EMOJI, FACTION_LABEL, RACES, REGIONS, REGION_INFO } from "./data";
import { controlledCount, fortressOf, isPresent, otherFaction, raceSymbols, unitsOf, type Faction, type LotrDuelState, type RaceSymbol, type WinType } from "./engine";

/**
 * Endgame showdown — says, in big type, WHO won, by WHICH of the four victory
 * conditions, and HOW, with a themed hero visual per condition:
 *  - RING_QUEST: the ring shattering in white-gold light (Fellowship) or the
 *    red Eye with black lightning (Sauron's Nazgûl catching Frodo);
 *  - RACE_ALLIANCE: the winner's six race seals orbiting into a gold aura;
 *  - CONQUEST: a 7-region mini map with the winner's flags popping up;
 *  - TERRITORY_MAJORITY: the final region count as opposing bars.
 * Below that, achievement cards for the win and a both-sides stats panel so
 * the loser also gets a clear picture of the game.
 */

const KEYFRAMES = `
@keyframes lotrv-in { 0% { opacity: 0; transform: scale(1.12); filter: blur(8px) } 100% { opacity: 1; transform: none; filter: none } }
@keyframes lotrv-type { 0% { opacity: 0; letter-spacing: .5em; transform: scale(1.4) } 60% { opacity: 1 } 100% { opacity: 1; letter-spacing: .06em; transform: none } }
@keyframes lotrv-up { 0% { opacity: 0; transform: translateY(12px) } 100% { opacity: 1; transform: none } }
@keyframes lotrv-shard { 0% { transform: rotate(var(--a)) translateY(0) scale(1); opacity: 1 } 100% { transform: rotate(var(--a)) translateY(-120px) scale(.3) rotate(160deg); opacity: 0 } }
@keyframes lotrv-burst { 0% { transform: scale(.2); opacity: 0 } 25% { opacity: 1 } 100% { transform: scale(2.6); opacity: 0 } }
@keyframes lotrv-ring { 0% { transform: scale(1); filter: drop-shadow(0 0 10px #f59e0b) } 35% { transform: scale(1.15); filter: drop-shadow(0 0 30px #fff) } 45%,100% { transform: scale(1.3); opacity: 0 } }
@keyframes lotrv-eye { 0% { transform: scaleY(.05); opacity: 0 } 40% { transform: scaleY(1); opacity: 1 } 100% { transform: scaleY(1); opacity: 1 } }
@keyframes lotrv-pupil { 0%,100% { transform: scaleX(1) } 50% { transform: scaleX(.6) } }
@keyframes lotrv-bolt { 0%,100% { opacity: 0 } 8%,14% { opacity: 1 } 10% { opacity: .2 } }
@keyframes lotrv-orbit { 0% { transform: rotate(var(--a)) translateY(-78px) rotate(calc(-1 * var(--a))) scale(.3); opacity: 0 } 60% { opacity: 1 } 100% { transform: rotate(calc(var(--a) + 360deg)) translateY(-58px) rotate(calc(-1 * var(--a) - 360deg)) scale(1); opacity: 1 } }
@keyframes lotrv-aura { 0%,100% { box-shadow: 0 0 30px 8px rgba(251,191,36,.35) } 50% { box-shadow: 0 0 60px 20px rgba(251,191,36,.6) } }
@keyframes lotrv-flag { 0% { transform: translateY(10px) scale(0); opacity: 0 } 70% { transform: translateY(-3px) scale(1.25); opacity: 1 } 100% { transform: none; opacity: 1 } }
@keyframes lotrv-wave { 0% { transform: scale(.2); opacity: .9 } 100% { transform: scale(2.4); opacity: 0 } }
@keyframes lotrv-bar { 0% { transform: scaleX(0) } 100% { transform: scaleX(1) } }
@media (prefers-reduced-motion: reduce) { [style*="lotrv-"] { animation-duration: .01ms !important; animation-iteration-count: 1 !important } }
`;

interface WinCopy {
  kicker: string;
  title: string;
  banner: string;
  tone: string; // tailwind gradient for backdrop + title
  titleGrad: string;
}

function copyFor(state: LotrDuelState, winner: Faction, type: WinType): WinCopy {
  const f = controlledCount(state, "FELLOWSHIP");
  const s = controlledCount(state, "SAURON");
  switch (type) {
    case "RING_QUEST":
      return winner === "FELLOWSHIP"
        ? {
            kicker: "RING DESTROYED · FELLOWSHIP VICTORY",
            title: "운명의 산, 반지 파괴",
            banner: `프로도와 샘이 운명의 산(${state.ringTrack.trackLength}번 칸)에 도달하여 절대반지를 영원히 파괴했습니다!`,
            tone: "from-amber-300/30 via-yellow-100/10 to-transparent",
            titleGrad: "from-white via-amber-200 to-yellow-500",
          }
        : {
            kicker: "RING RETRIEVED · SAURON VICTORY",
            title: "나즈굴의 추격 성공",
            banner: `나즈굴이 ${state.ringTrack.nazgulPosition}번 칸에서 프로도와 샘을 덮쳐 절대반지를 사우론의 손에 되찾아 바쳤습니다!`,
            tone: "from-red-700/40 via-rose-950/30 to-black",
            titleGrad: "from-rose-200 via-red-400 to-red-700",
          };
    case "RACE_ALLIANCE":
      return {
        kicker: "SUPPORT OF THE RACES VICTORY",
        title: "6대 종족 동맹 완성",
        banner: `${FACTION_LABEL[winner]}이(가) 서로 다른 6개 종족의 지지를 규합해 가운데땅의 대의를 확립했습니다!`,
        tone: "from-emerald-500/25 via-amber-300/10 to-transparent",
        titleGrad: "from-emerald-200 via-amber-200 to-amber-500",
      };
    case "CONQUEST":
      return {
        kicker: "CONQUEST OF MIDDLE-EARTH VICTORY",
        title: "가운데땅 완전 정복",
        banner: `${FACTION_LABEL[winner]}이(가) 아르노르에서 모르도르까지 7개 모든 지역에 세력을 확립해 전역을 장악했습니다!`,
        tone: "from-rose-600/30 via-amber-400/10 to-transparent",
        titleGrad: "from-rose-200 via-amber-300 to-rose-500",
      };
    case "TERRITORY_MAJORITY":
      return {
        kicker: "CHAPTER 3 FINAL VERDICT VICTORY",
        title: "3챕터 최종 판정승",
        banner:
          f === s
            ? `3챕터 대전쟁 종료! 지배 지역이 ${f} : ${s} 동률이라 종족 기호 → 주화 → 원정대 순의 동률 판정으로 ${FACTION_LABEL[winner]}이(가) 승리했습니다.`
            : `3챕터 대전쟁 종료! 7개 지역 중 더 많은 영토(${Math.max(f, s)} vs ${Math.min(f, s)})를 지배하여 ${FACTION_LABEL[winner]}이(가) 최종 판정승을 거두었습니다!`,
        tone: "from-amber-400/25 via-orange-700/10 to-transparent",
        titleGrad: "from-amber-100 via-amber-300 to-orange-500",
      };
  }
}

// ---------------------------------------------------------------------------
// Hero visuals
// ---------------------------------------------------------------------------

function RingShatter() {
  return (
    <div className="relative flex h-40 w-40 items-center justify-center">
      <div className="absolute h-32 w-32 rounded-full bg-[radial-gradient(circle,rgba(254,243,199,.55),rgba(245,158,11,.25)_45%,transparent_70%)]" style={{ animation: "lotrv-aura 2.4s ease-in-out 1.4s infinite, lotrv-up .6s ease-out 1.3s both" }} />
      <div className="absolute h-28 w-28 rounded-full bg-white" style={{ animation: "lotrv-burst 1.6s ease-out .45s both" }} />
      <div className="absolute h-28 w-28 rounded-full bg-amber-300" style={{ animation: "lotrv-burst 1.8s ease-out .6s both" }} />
      <svg viewBox="0 0 64 64" className="absolute h-24 w-24" style={{ animation: "lotrv-ring .9s ease-in both" }} aria-hidden>
        <defs>
          <linearGradient id="lotrv-gold" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#fef3c7" />
            <stop offset="50%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#92400e" />
          </linearGradient>
        </defs>
        <ellipse cx="32" cy="32" rx="22" ry="15" fill="none" stroke="url(#lotrv-gold)" strokeWidth="7" />
        <ellipse cx="32" cy="32" rx="22" ry="15" fill="none" stroke="#fb923c" strokeWidth="1.2" strokeDasharray="1.4 .9 3 1" />
      </svg>
      {Array.from({ length: 14 }, (_, i) => (
        <span
          key={i}
          className="absolute h-2 w-3 rounded-sm bg-gradient-to-r from-yellow-100 to-amber-500 shadow-[0_0_8px_#fde68a]"
          style={{ ["--a" as string]: `${i * (360 / 14)}deg`, animation: `lotrv-shard 1.3s cubic-bezier(.1,.8,.3,1) ${0.8 + (i % 3) * 0.05}s both` } as CSSProperties}
        />
      ))}
      <span className="absolute text-5xl" style={{ animation: "lotrv-up .6s ease-out 1.4s both" }}>
        🌋
      </span>
    </div>
  );
}

function EyeOfSauron() {
  return (
    <div className="relative flex h-40 w-56 items-center justify-center">
      {[
        "M40 0 L32 30 L44 30 L28 70",
        "M188 4 L198 34 L186 34 L204 76",
      ].map((d, i) => (
        <svg key={i} viewBox="0 0 224 160" className="absolute inset-0 h-full w-full" aria-hidden style={{ animation: `lotrv-bolt ${2.4 + i * 0.7}s linear ${0.3 + i * 0.5}s infinite` }}>
          <path d={d} fill="none" stroke="#e9d5ff" strokeWidth="2" />
          <path d={d} fill="none" stroke="#7e22ce" strokeWidth="6" strokeOpacity=".4" />
        </svg>
      ))}
      <div
        className="relative flex h-24 w-52 items-center justify-center rounded-[50%] bg-[radial-gradient(ellipse_at_center,#fde68a_0%,#f97316_28%,#b91c1c_55%,#1c0303_80%)] shadow-[0_0_60px_20px_rgba(220,38,38,.55)]"
        style={{ animation: "lotrv-eye 1.1s cubic-bezier(.2,.9,.2,1) both" }}
      >
        <div className="h-20 w-3 rounded-full bg-black" style={{ animation: "lotrv-pupil 2.2s ease-in-out 1.1s infinite" }} />
      </div>
      <span className="absolute -bottom-2 text-4xl" style={{ animation: "lotrv-up .6s ease-out 1s both" }}>
        💀
      </span>
    </div>
  );
}

function RaceOrbit({ races }: { races: RaceSymbol[] }) {
  return (
    <div className="relative flex h-44 w-44 items-center justify-center">
      <div className="absolute h-16 w-16 rounded-full bg-amber-300/20" style={{ animation: "lotrv-aura 2s ease-in-out infinite" }} />
      <span className="absolute text-3xl">👑</span>
      {races.map((r, i) => (
        <span
          key={r}
          className="absolute h-12 w-12"
          style={{ ["--a" as string]: `${i * (360 / races.length)}deg`, animation: `lotrv-orbit 1.6s cubic-bezier(.2,.8,.2,1) ${i * 0.08}s both` } as CSSProperties}
        >
          <SealStamp race={r} />
        </span>
      ))}
    </div>
  );
}

function ConquestMap({ state, winner }: { state: LotrDuelState; winner: Faction }) {
  const edges: [string, string][] = [];
  for (const a of REGIONS) for (const b of ADJACENCY[a]) if (a < b) edges.push([a, b]);
  return (
    <div className="relative h-40 w-64 rounded-2xl border border-amber-700/40 bg-[radial-gradient(ellipse_at_30%_20%,#2a2213,#0e0b08_70%)]">
      <div className="absolute top-1/2 left-1/2 -mt-10 -ml-10 h-20 w-20 rounded-full border-4 border-rose-400/70" style={{ animation: "lotrv-wave 1.4s ease-out 1.2s both" }} />
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
        {edges.map(([a, b]) => (
          <line
            key={a + b}
            x1={REGION_INFO[a as keyof typeof REGION_INFO].x}
            y1={REGION_INFO[a as keyof typeof REGION_INFO].y}
            x2={REGION_INFO[b as keyof typeof REGION_INFO].x}
            y2={REGION_INFO[b as keyof typeof REGION_INFO].y}
            stroke="#b8893b"
            strokeOpacity=".35"
            strokeDasharray="1.5 1"
          />
        ))}
      </svg>
      {REGIONS.map((r, i) => (
        <span
          key={r}
          className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
          style={{ left: `${REGION_INFO[r].x}%`, top: `${REGION_INFO[r].y}%` }}
        >
          <span className="text-lg drop-shadow-[0_0_6px_rgba(251,191,36,.8)]" style={{ animation: `lotrv-flag .5s cubic-bezier(.2,.9,.2,1) ${0.2 + i * 0.12}s both` }}>
            {isPresent(state.boardRegions[r], winner) ? (winner === "FELLOWSHIP" ? "🚩" : "🏴") : "·"}
          </span>
          <span className="text-[8px] whitespace-nowrap text-white/60">{REGION_INFO[r].name}</span>
        </span>
      ))}
    </div>
  );
}

function VerdictBars({ state, winner }: { state: LotrDuelState; winner: Faction }) {
  const row = (f: Faction) => {
    const n = controlledCount(state, f);
    return (
      <div className="flex items-center gap-2">
        <span className="w-16 shrink-0 text-right text-xs font-bold">
          {FACTION_EMOJI[f]} {f === "FELLOWSHIP" ? "원정대" : "사우론"}
        </span>
        <div className="h-5 flex-1 overflow-hidden rounded-full bg-white/10">
          <div
            className={`h-full origin-left rounded-full ${f === "FELLOWSHIP" ? "bg-gradient-to-r from-amber-300 to-yellow-500" : "bg-gradient-to-r from-zinc-500 to-rose-700"} ${f === winner ? "shadow-[0_0_14px_rgba(251,191,36,.7)]" : "opacity-70"}`}
            style={{ width: `${(n / 7) * 100}%`, animation: `lotrv-bar 1.1s cubic-bezier(.2,.9,.2,1) ${f === "FELLOWSHIP" ? 0.3 : 0.5}s both` }}
          />
        </div>
        <span className="w-10 shrink-0 font-mono text-lg font-black">{n}/7</span>
      </div>
    );
  };
  return (
    <div className="flex w-64 flex-col gap-2">
      <span className="text-center text-5xl">⚖️</span>
      {row("FELLOWSHIP")}
      {row("SAURON")}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Stat({ label, value, strong }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1 ${strong ? "bg-amber-400/10" : "bg-white/[0.03]"}`}>
      <span className="text-[11px] text-neutral-400">{label}</span>
      <span className="font-mono text-xs font-bold text-neutral-100">{value}</span>
    </div>
  );
}

function sideStats(state: LotrDuelState, f: Faction) {
  const p = state.players[f];
  return {
    regions: controlledCount(state, f),
    units: REGIONS.reduce((n, r) => n + unitsOf(state.boardRegions[r], f), 0),
    fortresses: REGIONS.filter((r) => fortressOf(state.boardRegions[r], f)).length,
    races: raceSymbols(p).size,
    coins: p.coins,
    tokens: p.allianceTokens.length,
    cards: p.tableauCards.length,
  };
}

export default function VictoryCinematicModal({
  state,
  myFaction,
  onRematch,
  onLeave,
  onClose,
}: {
  state: LotrDuelState;
  myFaction: Faction;
  onRematch: () => void;
  onLeave: () => void;
  onClose: () => void;
}) {
  if (!state.winner || !state.winType) return null;
  const winner = state.winner;
  const type = state.winType;
  const loser = otherFaction(winner);
  const iWon = winner === myFaction;
  const copy = copyFor(state, winner, type);
  const { frodoPosition: fr, nazgulPosition: nz, trackLength: L } = state.ringTrack;
  const w = sideStats(state, winner);
  const races = [...raceSymbols(state.players[winner])];
  const orbitRaces: RaceSymbol[] = races.length >= 6 ? races.slice(0, 7) : [...RACES];

  const achievements: { icon: string; label: string; value: string }[] =
    type === "RING_QUEST"
      ? winner === "FELLOWSHIP"
        ? [
            { icon: "🧝", label: "프로도 & 샘", value: `${fr}/${L}칸 도달` },
            { icon: "🐉", label: "따돌린 나즈굴", value: `${fr - nz}칸 뒤` },
          ]
        : [
            { icon: "🐉", label: "나즈굴 위치", value: `${nz}번 칸` },
            { icon: "🧝", label: "붙잡힌 프로도", value: `${fr}번 칸 · 운명의 산까지 ${L - fr}칸` },
          ]
      : type === "RACE_ALLIANCE"
        ? [
            { icon: "📜", label: "모은 종족 기호", value: `${races.length}종` },
            { icon: "🤝", label: "동맹 토큰", value: `${w.tokens}개` },
          ]
        : type === "CONQUEST"
          ? [
              { icon: "🗺️", label: "장악 지역", value: "7/7" },
              { icon: "🪖", label: "보드 위 유닛 · 요새", value: `${w.units} · ${w.fortresses}` },
            ]
          : [
              { icon: "🏁", label: "최종 지배 지역", value: `${controlledCount(state, winner)} vs ${controlledCount(state, loser)}` },
              { icon: "📖", label: "종료 시점", value: "3챕터 카드 소진" },
            ];

  const col = (f: Faction) => {
    const st = sideStats(state, f);
    return (
      <div className={`flex flex-col gap-1 rounded-xl border p-2 ${f === winner ? "border-amber-400/50 bg-amber-500/5" : "border-white/10 bg-white/[0.02]"}`}>
        <p className="mb-0.5 text-xs font-bold">
          {FACTION_EMOJI[f]} {FACTION_LABEL[f]} {f === myFaction && <span className="text-[10px] font-normal text-neutral-400">(나)</span>}
          {f === winner && <span className="ml-1 text-[10px] text-amber-300">승리</span>}
        </p>
        <Stat label="장악 지역" value={`${st.regions}/7`} strong={type === "CONQUEST" || type === "TERRITORY_MAJORITY"} />
        <Stat label="원정 트랙" value={f === "FELLOWSHIP" ? `${fr}/${L}` : `${nz}`} strong={type === "RING_QUEST"} />
        <Stat label="종족 기호" value={`${st.races}/6`} strong={type === "RACE_ALLIANCE"} />
        <Stat label="남은 주화" value={`🪙${st.coins}`} />
        <Stat label="유닛 · 요새" value={`${st.units} · ${st.fortresses}`} />
        <Stat label="동맹 토큰 · 카드" value={`${st.tokens} · ${st.cards}`} />
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur-md select-none" role="dialog" aria-modal="true" aria-label={copy.title}>
      <style>{KEYFRAMES}</style>
      <div className={`pointer-events-none absolute inset-0 bg-gradient-to-b ${copy.tone}`} />
      <div
        className="relative flex max-h-[92dvh] w-full max-w-xl flex-col overflow-y-auto rounded-3xl border-2 border-amber-500/60 bg-neutral-950/95 p-5 text-center text-white shadow-[0_0_80px_rgba(245,158,11,.3)]"
        style={{ animation: "lotrv-in .7s cubic-bezier(.2,.9,.2,1) both" }}
      >
        <button
          type="button"
          onClick={onClose}
          title="결과창을 닫고 최종 보드판 둘러보기 — 헤더의 🏆 버튼으로 다시 열 수 있어요"
          className="absolute top-3 right-3 z-10 rounded-xl border border-neutral-700 bg-neutral-900 px-2.5 py-1 text-xs text-neutral-300 hover:text-white"
        >
          ✕ 보드 보기
        </button>
        <div className="flex justify-center">
          <span
            className={`rounded-full border px-4 py-1 text-xs font-black tracking-widest ${iWon ? "border-amber-400 bg-amber-500/20 text-amber-300" : "border-rose-500 bg-rose-500/20 text-rose-300"}`}
          >
            {iWon ? "🎉 VICTORY · 당신의 승리" : "💀 DEFEAT · 당신의 패배"}
          </span>
        </div>

        <div className="my-3 flex justify-center">
          {type === "RING_QUEST" ? (
            winner === "FELLOWSHIP" ? (
              <RingShatter />
            ) : (
              <EyeOfSauron />
            )
          ) : type === "RACE_ALLIANCE" ? (
            <RaceOrbit races={orbitRaces} />
          ) : type === "CONQUEST" ? (
            <ConquestMap state={state} winner={winner} />
          ) : (
            <VerdictBars state={state} winner={winner} />
          )}
        </div>

        <p className="font-mono text-[11px] font-bold tracking-widest text-amber-400" style={{ animation: "lotrv-up .5s ease-out .5s both" }}>
          {copy.kicker}
        </p>
        <p className="mt-1 text-sm text-neutral-300" style={{ animation: "lotrv-up .5s ease-out .6s both" }}>
          {FACTION_EMOJI[winner]} <b className="text-white">{FACTION_LABEL[winner]}</b>의 승리
        </p>
        <h2
          className={`mt-1 bg-gradient-to-r ${copy.titleGrad} bg-clip-text font-serif text-3xl font-black text-transparent drop-shadow-md sm:text-4xl`}
          style={{ animation: "lotrv-type .9s cubic-bezier(.2,.9,.2,1) .7s both" }}
        >
          {copy.title}
        </h2>
        <div className="mx-auto mt-3 w-full rounded-2xl border border-neutral-700 bg-neutral-900/90 p-3" style={{ animation: "lotrv-up .5s ease-out 1s both" }}>
          <p className="text-sm leading-relaxed font-semibold break-keep text-neutral-100">{copy.banner}</p>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2" style={{ animation: "lotrv-up .5s ease-out 1.15s both" }}>
          {achievements.map((a) => (
            <div key={a.label} className="rounded-xl border border-amber-500/30 bg-gradient-to-b from-amber-500/10 to-transparent p-2">
              <p className="text-2xl">{a.icon}</p>
              <p className="text-[10px] text-neutral-400">{a.label}</p>
              <p className="text-sm font-black text-amber-200">{a.value}</p>
            </div>
          ))}
        </div>

        <p className="mt-4 mb-1 text-[11px] font-semibold tracking-wider text-neutral-400">⚔️ 격돌 요약</p>
        <div className="grid grid-cols-2 gap-2 text-left" style={{ animation: "lotrv-up .5s ease-out 1.3s both" }}>
          {col("FELLOWSHIP")}
          {col("SAURON")}
        </div>
        <p className="mt-2 text-[10px] text-neutral-500">
          {state.chapter}챕터 · {state.turnNumber - 1}턴 · 원정 트랙 최종 간격 {fr - nz}칸
        </p>

        <div className="mt-4 flex gap-2">
          <button onClick={onRematch} className="flex-1 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 py-3 text-sm font-black text-neutral-950 shadow-lg hover:from-amber-400 hover:to-yellow-400">
            🔄 재대결 (진영 교대)
          </button>
          <button onClick={onClose} className="rounded-xl border border-amber-500/40 bg-neutral-800 px-4 py-3 text-sm font-bold text-amber-300 hover:bg-neutral-700">
            🗺️ 보드판 둘러보기
          </button>
          <button onClick={onLeave} className="rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-sm font-bold text-neutral-400 hover:text-white">
            나가기
          </button>
        </div>
        <p className="mt-2 text-[10px] text-neutral-500">창을 닫아도 상단의 🏆 버튼으로 언제든 다시 볼 수 있어요</p>
      </div>
    </div>
  );
}
