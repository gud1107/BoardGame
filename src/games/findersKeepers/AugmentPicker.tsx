"use client";

import { useEffect, useMemo, useState } from "react";
import { AUG_AT, AUG_BY_ID, AUG_REROLLS, AUG_TIER_NAME, type AugId, type AugTier } from "./augments";
import { SEAT_COLORS, SEAT_SYMBOLS } from "./data";
import type { Snap } from "./net";
import type { PlayerState } from "./sim";

/**
 * 🧬 증강 고르기 화면 (무대 위 덮개) — 판이 멈춘 동안 같은 등급 3장 중 1장, 다시 뽑기 1번.
 * PC는 1·2·3 키로 고르고 R로 다시 뽑는다. 고른 증강은 공개(남이 고른 것도 바로 보인다).
 */

export const TIER_STYLE: Record<AugTier, { ring: string; chip: string; head: string }> = {
  1: { ring: "border-slate-300/50", chip: "bg-slate-200/15 text-slate-100", head: "from-slate-300 to-slate-500 text-slate-950" },
  2: { ring: "border-amber-300/70", chip: "bg-amber-300/20 text-amber-100", head: "from-amber-200 to-amber-500 text-slate-950" },
  3: { ring: "border-fuchsia-300/80", chip: "bg-fuchsia-400/25 text-fuchsia-100", head: "from-fuchsia-300 via-sky-300 to-emerald-300 text-slate-950" },
};

const PICK_KEYS = ["Digit1", "Digit2", "Digit3", "Numpad1", "Numpad2", "Numpad3"];

/** 고른 증강 칩 (점수판·내 상태 줄) */
export function AugChips({ p, small, iconOnly }: { p: PlayerState | undefined; small?: boolean; iconOnly?: boolean }) {
  const augs = p?.augs ?? [];
  if (!augs.length) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-0.5">
      {augs.map((id) => {
        const a = AUG_BY_ID[id];
        if (!a) return null;
        return (
          <span
            key={id}
            title={`${a.name} — ${a.desc}`}
            aria-label={`증강 ${a.name}`}
            className={`inline-flex items-center gap-0.5 rounded-full ${iconOnly ? "px-1" : "px-1.5"} py-px ${small ? "text-[10px]" : "text-[11px]"} font-semibold ${TIER_STYLE[a.tier].chip}`}
          >
            {a.icon}
            {!iconOnly && <span>{a.name}</span>}
          </span>
        );
      })}
    </span>
  );
}

export default function AugmentPicker({
  snap,
  mySeat,
  names,
  onPick,
  onReroll,
}: {
  snap: Snap;
  mySeat: number;
  names: Record<number, string>;
  onPick: (round: number, choice: number) => void;
  onReroll: (round: number) => void;
}) {
  const aug = snap.aug;
  const me = snap.players[mySeat];
  // 보낸 뒤 방장 확인 전까지 두 번 누르지 않게
  const [sent, setSent] = useState<{ round: number; choice: number } | null>(null);
  const round = aug?.round ?? -1;
  const done = !!aug?.done[mySeat];
  const offerRaw = aug?.offers[mySeat];
  const offer: AugId[] = useMemo(() => offerRaw ?? [], [offerRaw]);
  const rerollsLeft = AUG_REROLLS - (me?.rerolls ?? 0);
  const waitingPick = !done && sent?.round === round && sent.choice >= 0;

  useEffect(() => {
    if (!aug || done || waitingPick) return;
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      const j = PICK_KEYS.indexOf(e.code);
      const i = j >= 0 ? j % 3 : -1;
      if (i >= 0 && offer[i]) {
        e.preventDefault();
        setSent({ round, choice: i });
        onPick(round, i);
      } else if (e.code === "KeyR" && rerollsLeft > 0) {
        e.preventDefault();
        setSent({ round, choice: -1 });
        onReroll(round);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [aug, done, waitingPick, offer, round, rerollsLeft, onPick, onReroll]);

  if (!aug || !me) return null;
  const style = TIER_STYLE[aug.tier];
  const secs = Math.max(0, Math.ceil((aug.limit - aug.el) / 1000));
  const allDone = aug.doneAt >= 0;
  const left = aug.done.filter((d) => !d).length;
  const picks = snap.players.filter((p) => aug.picks[p.seat]);

  return (
    <div className="absolute inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-950/80 p-2 sm:items-center sm:p-4">
      <div className={`flex w-full max-w-2xl flex-col gap-2.5 rounded-2xl border-2 bg-slate-900/95 p-3 shadow-2xl sm:p-4 ${style.ring}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-black text-white sm:text-base">
            🧬 증강 {round + 1}/{AUG_AT.length}{" "}
            <span className={`ml-1 rounded-full bg-gradient-to-r px-2.5 py-0.5 text-xs ${style.head}`}>{AUG_TIER_NAME[aug.tier]}</span>
          </p>
          <span className="text-xs text-white/60">
            {aug.resume === "fight" ? "⏸ 잠깐 멈춤 · " : ""}모두 같은 등급
            {!allDone && <b className={`ml-2 font-mono text-sm ${secs <= 3 ? "text-rose-400" : "text-white"}`}>{secs}s</b>}
          </span>
        </div>

        {done || allDone ? (
          <p className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-100">
            ✅ {aug.picks[mySeat] ? `${AUG_BY_ID[aug.picks[mySeat]!].icon} ${AUG_BY_ID[aug.picks[mySeat]!].name}` : "선택"} —{" "}
            {allDone ? "곧 다시 시작해요!" : `다른 사람을 기다리는 중… (${left}명 남음)`}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {offer.map((id, i) => {
                const a = AUG_BY_ID[id];
                const chosen = waitingPick && sent?.choice === i;
                return (
                  <button
                    key={`${id}-${i}`}
                    type="button"
                    disabled={waitingPick}
                    onClick={() => {
                      setSent({ round, choice: i });
                      onPick(round, i);
                    }}
                    className={`flex min-h-[52px] items-start gap-2 rounded-xl border-2 bg-white/[0.05] px-3 py-2 text-left transition hover:-translate-y-0.5 hover:bg-white/[0.1] disabled:opacity-60 sm:flex-col sm:items-center sm:py-3 sm:text-center ${style.ring} ${chosen ? "ring-2 ring-emerald-300" : ""}`}
                  >
                    <span className="text-2xl leading-none sm:text-4xl">{a.icon}</span>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-sm font-bold text-white">
                        <span className="mr-1 hidden font-mono text-[10px] text-white/40 sm:inline">{i + 1}</span>
                        {a.name}
                      </span>
                      <span className="text-[12px] leading-snug break-keep text-white/70">{a.desc}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] text-white/45">
                {waitingPick ? "보내는 중…" : "시간이 지나면 첫 번째 카드가 골라져요"}
                <span className="hidden sm:inline"> · 키보드 1·2·3 / R</span>
              </span>
              <button
                type="button"
                disabled={rerollsLeft <= 0 || waitingPick}
                onClick={() => {
                  setSent({ round, choice: -1 });
                  onReroll(round);
                }}
                className="min-h-9 rounded-full border border-white/25 px-3 py-1.5 text-xs font-semibold text-white/85 disabled:opacity-40"
              >
                🎲 다시 뽑기 ({rerollsLeft}/{AUG_REROLLS})
              </button>
            </div>
          </>
        )}

        {picks.length > 0 && (
          <div className="flex flex-wrap gap-1.5 border-t border-white/10 pt-2 text-[11px] text-white/75">
            {picks.map((p) => {
              const a = AUG_BY_ID[aug.picks[p.seat]!];
              return (
                <span key={p.seat} className="inline-flex items-center gap-1 rounded-full bg-black/40 px-2 py-0.5" title={a.desc}>
                  <span style={{ color: SEAT_COLORS[p.seat % 8] }} aria-hidden>
                    {SEAT_SYMBOLS[p.seat % 8]}
                  </span>
                  <span className="max-w-[5rem] truncate">{p.seat === mySeat ? "나" : (names[p.seat] ?? `${p.seat + 1}번`)}</span>
                  {a.icon} {a.name}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
