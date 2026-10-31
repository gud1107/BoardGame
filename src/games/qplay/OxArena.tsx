"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { useProfilePhoto } from "@/components/profile/ProfilePhoto";
import { eligibleSeats, type GameState, type Seat } from "./engine";

/**
 * OX 서바이벌 광장 — 왼쪽 ⭕ 구역, 오른쪽 ❌ 구역. 내 말은 광장을 눌러/끌어
 * 어디로든 옮기고, 가운데 선을 넘는 순간 답이 바뀐다(시간이 끝날 때 서 있는
 * 쪽이 최종 답). 다른 사람 말도 지금 서 있는 쪽으로 달려가는 게 보여서
 * "사람 많은 쪽으로 따라가기" 같은 눈치 싸움이 된다. ←/→ 키로도 이동.
 */

type Pos = { x: number; y: number };

/** 좌석별 고정 자리(구역 안 3×3) — 다른 사람이 움직여도 내 자리가 밀리지 않게. */
function slot(seat: Seat, zone: number | null): Pos {
  const col = seat % 3;
  const row = Math.floor(seat / 3);
  const jitter = ((seat * 37) % 7) - 3;
  if (zone === null) return { x: 50, y: 24 + seat * 9 };
  return { x: zone * 50 + 9 + col * 16 + jitter * 0.6, y: 26 + row * 25 + jitter };
}

const zoneOf = (x: number) => (x < 50 ? 0 : 1);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const initial = (name: string) => Array.from(name.replace(/^🤖\s*(AI\s*)?/, ""))[0] ?? "?";

export default function OxArena({
  state,
  viewerSeat,
  names,
  colors,
  picked,
  reveal,
  onMove,
}: {
  state: GameState;
  viewerSeat: Seat;
  names: Record<Seat, string>;
  colors: readonly string[];
  /** 내 현재 쪽(방장 왕복 전 로컬 선택 포함). */
  picked: number | null;
  reveal: boolean;
  onMove: ((choice: number) => void) | null;
}) {
  const photo = useProfilePhoto();
  const field = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  // 내 말의 자유 위치 — 문제가 바뀌면 가운데로
  const [mine, setMine] = useState<{ q: number; pos: Pos } | null>(null);
  const myPos = mine && mine.q === state.qIndex ? mine.pos : slot(viewerSeat, picked);
  const alive = new Set(eligibleSeats(state));
  const q = state.questions[state.qIndex];
  const answer = q?.answer ?? -1;

  function moveTo(pos: Pos) {
    if (!onMove) return;
    setMine({ q: state.qIndex, pos });
    const z = zoneOf(pos.x);
    if (z !== picked) onMove(z);
  }

  function fromEvent(e: PointerEvent<HTMLDivElement>): Pos | null {
    const r = field.current?.getBoundingClientRect();
    if (!r) return null;
    return { x: clamp(((e.clientX - r.left) / r.width) * 100, 4, 96), y: clamp(((e.clientY - r.top) / r.height) * 100, 14, 90) };
  }

  useEffect(() => {
    if (!onMove) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const z = e.key === "ArrowLeft" || e.key === "a" || e.key === "A" ? 0 : e.key === "ArrowRight" || e.key === "d" || e.key === "D" ? 1 : null;
      if (z === null) return;
      e.preventDefault();
      setMine({ q: state.qIndex, pos: slot(viewerSeat, z) });
      if (z !== picked) onMove(z);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onMove, picked, state.qIndex, viewerSeat]);

  const seats = Array.from({ length: state.seatCount }, (_, s) => s).filter((s) => alive.has(s) || state.eliminated.includes(s));
  const zoneTone = (z: number) => {
    const base = z === 0 ? "from-sky-500/35 to-sky-700/10" : "from-rose-500/35 to-rose-700/10";
    if (!reveal) return base;
    return z === answer ? "from-emerald-400/50 to-emerald-700/15" : "from-slate-700/40 to-slate-900/30 grayscale";
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div
        ref={field}
        role="group"
        aria-label="OX 광장 — 눌러서 이동, ←/→ 키로도 이동"
        onPointerDown={(e) => {
          if (!onMove) return;
          setDragging(true);
          e.currentTarget.setPointerCapture(e.pointerId);
          const p = fromEvent(e);
          if (p) moveTo(p);
        }}
        onPointerMove={(e) => {
          if (!dragging) return;
          const p = fromEvent(e);
          if (p) moveTo(p);
        }}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
        className={`relative h-64 overflow-hidden rounded-3xl border-2 border-white/15 select-none sm:h-72 light:border-slate-300 ${onMove ? "cursor-pointer touch-none" : ""}`}
      >
        {[0, 1].map((z) => (
          <div key={z} className={`absolute inset-y-0 w-1/2 bg-gradient-to-b ${zoneTone(z)} ${z === 0 ? "left-0" : "right-0"}`}>
            <span className={`pointer-events-none absolute inset-0 flex items-center justify-center text-[7rem] leading-none opacity-25 sm:text-[9rem] ${reveal && z === answer ? "opacity-60" : ""}`}>{z === 0 ? "⭕" : "❌"}</span>
            {reveal && z === answer && <span className="absolute top-2 left-1/2 -translate-x-1/2 rounded-full bg-emerald-500 px-3 py-0.5 text-sm font-black text-white shadow">✔ 정답</span>}
          </div>
        ))}
        <div className="pointer-events-none absolute inset-y-0 left-1/2 w-1 -translate-x-1/2 bg-[repeating-linear-gradient(to_bottom,rgba(255,255,255,.7)_0_10px,transparent_10px_18px)]" />

        {seats.map((s) => {
          const me = s === viewerSeat;
          const a = state.answers[s];
          const zone = me ? picked : (a?.choice ?? null);
          const pos = me && onMove ? myPos : slot(s, zone);
          const dead = reveal && state.eliminated.includes(s);
          const color = colors[s % colors.length];
          return (
            <div
              key={s}
              className={`pointer-events-none absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center ${me && dragging ? "transition-none" : "transition-[left,top] duration-500 ease-out"} ${me ? "z-20" : "z-10"}`}
              style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
            >
              <span
                className={`relative flex items-center justify-center overflow-hidden rounded-full font-black text-white shadow-lg ${me ? "h-12 w-12 text-lg ring-4 ring-amber-300" : "h-9 w-9 text-sm ring-2 ring-black/30"} ${dead ? "opacity-50 grayscale" : ""}`}
                style={{ background: color }}
              >
                {me && photo ? (
                  // eslint-disable-next-line @next/next/no-img-element -- own portrait data URL
                  <img src={photo} alt="" className="h-full w-full object-cover" draggable={false} />
                ) : (
                  initial(names[s] ?? "?")
                )}
                {dead && <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-lg">💀</span>}
              </span>
              <span className={`mt-0.5 max-w-16 truncate rounded-full px-1.5 text-[10px] font-bold ${me ? "bg-amber-300 text-slate-900" : "bg-black/55 text-white"}`}>{me ? "나" : names[s]}</span>
            </div>
          );
        })}

        {onMove && picked === null && (
          <span className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 animate-pulse rounded-full bg-black/60 px-3 py-1 text-xs font-bold whitespace-nowrap text-white">👆 ⭕ 또는 ❌ 쪽으로 이동하세요</span>
        )}
      </div>
      <p className="text-center text-[11px] text-white/50 light:text-slate-500">
        {onMove ? "광장을 눌러 이동 · 끌어서 왔다 갔다 · ←/→ 키 — 시간이 끝날 때 서 있는 쪽이 내 답!" : reveal ? "" : "💀 탈락 — 남은 사람들이 움직이는 걸 구경해요"}
      </p>
    </div>
  );
}
