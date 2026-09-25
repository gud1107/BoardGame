"use client";

import { OFFICIAL_RING_TRACK, type RingTrackReward } from "./data";
import type { Faction } from "./types";

/**
 * 반지 원정 트랙 — cinematic chase panorama. One row of 15 stone rune slots
 * (0 … 14) laid on a path across a left-to-right landscape: the Shire's green
 * hills, misty mountains and silver woods, then the Black Gate's crags and an
 * erupting Mount Doom. Frodo & Sam ride above the path (gold star-glass
 * glow), the Nazgûl gallop below it trailing red shadow.
 *
 * The Nazgûl only win by catching Frodo from behind (engine `advanceRing`),
 * so "danger" = the Nazgûl 1–2 spaces behind him: the panel border turns red
 * and the board shows a red vignette (`danger` is exported for that).
 *
 * `shownFr`/`shownNz` are the hop-animated display positions; `trail`,
 * `preview` and the reward pop-ups are the board's existing motion FX.
 */

const ICON: Record<RingTrackReward, string> = { NONE: "", COIN_1: "🪙", PLACE_UNIT: "⚔️", ALLIANCE_TOKEN: "📜", EXTRA_TURN: "⏩", DESTROY_FORTRESS: "💥", MOUNT_DOOM_VICTORY: "🌋" };
const FLOAT: Record<RingTrackReward, string> = { NONE: "", COIN_1: "+1🪙", PLACE_UNIT: "⚔️배치!", ALLIANCE_TOKEN: "📜선택!", EXTRA_TURN: "⏩한 턴 더!", DESTROY_FORTRESS: "💥파괴!", MOUNT_DOOM_VICTORY: "" };
const TEXT: Record<RingTrackReward, string> = {
  NONE: "보상 없음",
  COIN_1: "주화 1개",
  PLACE_UNIT: "원하는 지역에 내 유닛 1개 배치",
  ALLIANCE_TOKEN: "원하는 종족 더미 위 2개 중 동맹 토큰 1개",
  EXTRA_TURN: "이번 차례 후 추가 턴 1회",
  DESTROY_FORTRESS: "적 요새 1개 파괴",
  MOUNT_DOOM_VICTORY: "운명의 산 — 프로도 & 샘 도착 시 원정대 승리",
};
const GLOW: Partial<Record<RingTrackReward, string>> = {
  COIN_1: "rgba(251,191,36,.8)",
  PLACE_UNIT: "rgba(244,63,94,.8)",
  ALLIANCE_TOKEN: "rgba(254,240,138,.8)",
  EXTRA_TURN: "rgba(103,232,249,.8)",
  DESTROY_FORTRESS: "rgba(239,68,68,.9)",
};

export const TRACK_KEYFRAMES = `
@keyframes lotrt-lava { 0%,100% { opacity: .55 } 50% { opacity: 1 } }
@keyframes lotrt-ash { 0% { transform: translate(0,0); opacity: 0 } 15% { opacity: .7 } 100% { transform: translate(-14px,-26px); opacity: 0 } }
@keyframes lotrt-smoke { 0%,100% { opacity: .55; transform: translateX(0) scaleX(1) } 50% { opacity: .85; transform: translateX(-3px) scaleX(1.15) } }
@keyframes lotrt-star { 0%,100% { box-shadow: 0 0 10px 2px rgba(250,204,21,.75) } 50% { box-shadow: 0 0 20px 5px rgba(250,204,21,1) } }
@keyframes lotrt-eye { 0%,100% { box-shadow: 0 0 10px 2px rgba(225,29,72,.7) } 50% { box-shadow: 0 0 20px 6px rgba(225,29,72,1) } }
@keyframes lotrt-danger { 0%,100% { box-shadow: 0 0 14px rgba(225,29,72,.45) } 50% { box-shadow: 0 0 32px rgba(225,29,72,.95) } }
@keyframes lotrt-vignette { 0%,100% { opacity: .35 } 50% { opacity: .85 } }
.lotrt-vignette { animation: lotrt-vignette 1.4s ease-in-out infinite }
@media (prefers-reduced-motion: reduce) { .lotrt-anim { animation: none !important } }
`;

/** 1–2 spaces behind Frodo = the Nazgûl can catch him with one more ring symbol. */
export function chaseDanger(fr: number, nz: number): boolean {
  return fr - nz > 0 && fr - nz <= 2;
}

function Landscape() {
  return (
    <svg viewBox="0 0 300 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
      <defs>
        <linearGradient id="lotrt-sky" x1="0" x2="1">
          <stop offset="0%" stopColor="#1a3311" />
          <stop offset="22%" stopColor="#162a1c" />
          <stop offset="45%" stopColor="#15232d" />
          <stop offset="62%" stopColor="#1a1c2b" />
          <stop offset="82%" stopColor="#2a0f10" />
          <stop offset="100%" stopColor="#380b0b" />
        </linearGradient>
        <radialGradient id="lotrt-sun" cx="12%" cy="18%" r="30%">
          <stop offset="0%" stopColor="#fde68a" stopOpacity=".45" />
          <stop offset="100%" stopColor="#fde68a" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="lotrt-lava" cx="50%" cy="100%" r="60%">
          <stop offset="0%" stopColor="#f97316" stopOpacity=".9" />
          <stop offset="100%" stopColor="#7f1d1d" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="300" height="100" fill="url(#lotrt-sky)" />
      {/* Shire morning light + rolling hills with round doors */}
      <rect x="0" y="0" width="300" height="100" fill="url(#lotrt-sun)" />
      <path d="M0 78 C18 62 34 66 46 74 C58 66 72 64 88 76 L88 100 L0 100 Z" fill="#244a1a" />
      <path d="M0 86 C20 76 40 80 60 86 C72 80 84 82 96 88 L96 100 L0 100 Z" fill="#1d3b16" />
      <circle cx="22" cy="80" r="3" fill="#2f5d1f" stroke="#d9b36b" strokeWidth=".6" />
      <circle cx="56" cy="83" r="2.4" fill="#2f5d1f" stroke="#d9b36b" strokeWidth=".6" />
      {/* misty mountains + silver woods */}
      <path d="M92 90 L112 48 L126 70 L140 38 L156 72 L170 50 L186 90 Z" fill="#2c3a4a" />
      <path d="M136 44 L140 38 L144 44 Z M108 54 L112 48 L116 54 Z" fill="#e2e8f0" opacity=".7" />
      {Array.from({ length: 8 }, (_, i) => (
        <path key={i} d={`M${150 + i * 6} 92 L${153 + i * 6} ${82 - (i % 3) * 2} L${156 + i * 6} 92 Z`} fill="#3f5f58" opacity=".85" />
      ))}
      <ellipse cx="140" cy="70" rx="46" ry="7" fill="#cbd5e1" opacity=".1" />
      {/* Black Gate crags */}
      <path d="M196 92 L204 58 L210 92 Z M212 92 L220 52 L228 92 Z" fill="#171012" />
      <rect x="208" y="70" width="8" height="22" fill="#0c0708" />
      {/* Mount Doom + lava */}
      <path d="M232 94 L262 36 L270 40 L300 94 Z" fill="#1b0a0a" />
      <circle cx="266" cy="38" r="18" fill="url(#lotrt-lava)" className="lotrt-anim" style={{ animation: "lotrt-lava 2.4s ease-in-out infinite" }} />
      <path d="M262 40 C264 52 258 62 262 76 M268 40 C270 54 276 62 272 78" stroke="#f97316" strokeWidth="1.2" fill="none" opacity=".85" />
      {/* ash */}
      {Array.from({ length: 6 }, (_, i) => (
        <circle
          key={i}
          cx={250 + i * 8}
          cy={30 + (i % 3) * 8}
          r=".9"
          fill="#fca5a5"
          className="lotrt-anim"
          style={{ animation: `lotrt-ash ${3 + (i % 3)}s linear ${i * 0.5}s infinite` }}
        />
      ))}
    </svg>
  );
}

export default function RingTrackBoard({
  fr,
  nz,
  L,
  shownFr,
  shownNz,
  trail,
  preview,
}: {
  fr: number;
  nz: number;
  L: number;
  shownFr: number;
  shownNz: number;
  trail: { key: number; faction: Faction; from: number; to: number } | null;
  preview: { from: number; to: number } | null;
}) {
  const danger = chaseDanger(fr, nz);
  const gap = fr - nz;
  return (
    <div className={`relative overflow-hidden rounded-2xl border-2 bg-[#08090e] p-2 transition ${danger ? "border-rose-600" : "border-amber-600/40"}`} style={danger ? { animation: "lotrt-danger 1.2s ease-in-out infinite" } : undefined}>
      <style>{TRACK_KEYFRAMES}</style>
      {/* header */}
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1 border-b border-white/10 pb-1.5">
        <span className="font-serif text-[11px] font-black tracking-wide text-amber-200">💍 운명의 산 추격 트랙</span>
        <span className="flex items-center gap-1 font-mono text-[10px] font-bold">
          <span className="rounded-md border border-yellow-400/50 bg-yellow-950/70 px-1.5 text-yellow-200">🧝 {fr}/{L}</span>
          <span className={`rounded-md border px-1.5 ${danger ? "border-red-500 bg-red-950 text-rose-200" : "border-neutral-700 bg-neutral-900 text-neutral-300"}`}>🐎 {nz}/{L}</span>
          <span className={`rounded-md px-1.5 ${danger ? "bg-red-600 text-white" : "text-neutral-400"}`}>
            {danger ? `⚠️ 위험! ${gap}칸` : gap > 0 ? `격차 ${gap}칸` : gap === 0 ? "같은 칸" : `나즈굴 ${-gap}칸 앞`}
          </span>
        </span>
      </div>

      {/* panorama */}
      <div key={trail?.key ?? 0} className="relative h-36 overflow-hidden rounded-xl border border-white/10">
        <Landscape />
        {/* glowing path */}
        <div className="absolute top-1/2 right-[6%] left-[6%] h-1.5 -translate-y-1/2 rounded-full bg-gradient-to-r from-emerald-500/50 via-cyan-500/40 to-rose-600/70 shadow-[0_0_8px_rgba(255,255,255,.25)]" />
        <div className="absolute inset-x-[6%] top-0 bottom-0 flex items-center justify-between">
          {OFFICIAL_RING_TRACK.map((pt) => {
            const pos = pt.index;
            const reward = pt.reward;
            const passed = trail && pos > trail.from && pos <= trail.to && pos <= (trail.faction === "FELLOWSHIP" ? shownFr : shownNz);
            const inPreview = preview && pos > preview.from && pos <= preview.to;
            return (
              <div key={pos} className="relative flex w-0 flex-col items-center" title={`${pos}번 — ${pos === 0 ? "출발점 (원정대·나즈굴 함께 출발)" : TEXT[reward]}`}>
                {/* Frodo & Sam — above the path */}
                {pos === shownFr && (
                  <span key={`f${pos}`} className="lotrm-hop absolute bottom-[calc(50%+14px)] z-30 flex flex-col items-center">
                    <span className="lotrt-anim flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-gradient-to-tr from-amber-500 via-yellow-300 to-amber-100 text-sm" style={{ animation: "lotrt-star 1.6s ease-in-out infinite" }}>
                      🧝
                    </span>
                    <span className="-mt-0.5 rounded border border-amber-400/50 bg-black/80 px-1 text-[7px] font-black whitespace-nowrap text-amber-300">프로도</span>
                  </span>
                )}
                {/* the Nazgûl — below the path, trailing red shadow */}
                {pos === shownNz && (
                  <span key={`n${pos}`} className="lotrm-hop absolute top-[calc(50%+14px)] z-30 flex flex-col items-center">
                    <span className="lotrt-anim absolute top-1 right-3 h-5 w-10 rounded-full bg-gradient-to-l from-rose-700/80 to-transparent blur-[3px]" style={{ animation: "lotrt-smoke 1.3s ease-in-out infinite" }} />
                    <span className="lotrt-anim relative flex h-7 w-7 items-center justify-center rounded-full border-2 border-rose-500 bg-gradient-to-tr from-neutral-950 via-red-950 to-neutral-900 text-sm" style={{ animation: "lotrt-eye 1.2s ease-in-out infinite" }}>
                      🐎
                    </span>
                    <span className="-mt-0.5 rounded border border-rose-500/50 bg-black/80 px-1 text-[7px] font-black whitespace-nowrap text-rose-300">나즈굴</span>
                  </span>
                )}
                {/* reward pop-up as a marker passes */}
                {trail && pos > trail.from && pos <= trail.to && pos === (trail.faction === "FELLOWSHIP" ? shownFr : shownNz) && FLOAT[reward] && (
                  <span key={`rw${trail.key}-${pos}`} className="lotrm-reward pointer-events-none absolute bottom-[calc(50%+44px)] left-1/2 z-40 font-mono text-[10px] font-black whitespace-nowrap text-amber-200">
                    {FLOAT[reward]}
                  </span>
                )}
                {/* stone rune slot */}
                <span
                  className={`relative flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 text-[9px] backdrop-blur-sm sm:h-5 sm:w-5 ${
                    pos === L
                      ? "border-red-500 bg-red-950/90 shadow-[0_0_14px_rgba(239,68,68,.9)]"
                      : pos === 0
                        ? "border-neutral-400 bg-neutral-900/90"
                        : reward !== "NONE"
                          ? "border-amber-400 bg-neutral-900/90"
                          : "border-white/25 bg-neutral-950/75"
                  } ${passed ? (trail!.faction === "FELLOWSHIP" ? "lotrfx-trail-blue" : "lotrfx-trail-red") : ""} ${inPreview ? `lotrp-cyan ${pos === preview!.to ? "ring-2 ring-cyan-300" : ""}` : ""}`}
                  style={GLOW[reward] ? { boxShadow: `0 0 8px ${GLOW[reward]}` } : undefined}
                >
                  {ICON[reward] || <span className="font-mono text-[7px] font-bold text-neutral-400">{pos}</span>}
                </span>
                {ICON[reward] && <span className={`absolute top-[calc(50%+11px)] font-mono text-[7px] font-bold ${pos === L ? "text-rose-400" : "text-amber-300"}`}>{pos}</span>}
              </div>
            );
          })}
        </div>
      </div>

      {/* caption */}
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-2 text-[9.5px] text-neutral-400">
        <span>
          <span className="text-emerald-400">🌿 샤이어</span> ➔ <span className="text-sky-300">🏔️ 리븐델</span> ➔ <span className="text-amber-300">🌲 로스로리엔</span> ➔{" "}
          <span className="font-bold text-rose-400">🌋 운명의 산</span>
        </span>
        <span>2칸마다: 🪙→⚔️→📜→⏩→💥</span>
      </div>
      <p className="mt-1 text-[10.5px] text-white/55">
        🧝 프로도 & 샘이 {L}번에 닿으면 원정대 승리 · 🐎 나즈굴이 <b>뒤에서</b> 프로도 칸에 닿거나 추월하면 사우론 승리. 💍 반지 기호는 내 말을 전진시키고 지나간 칸의 보상을 받습니다.
      </p>
    </div>
  );
}
