"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { useProfilePhoto } from "@/components/profile/ProfilePhoto";
import { eligibleSeats, type GameState, type Seat } from "./engine";
import { slot, TOKEN_W, type Pos } from "./oxLayout";

/**
 * OX 서바이벌 광장 — 왼쪽 ⭕ 구역, 오른쪽 ❌ 구역. 내 말은 광장을 눌러/끌어
 * 어디로든 옮기고, 가운데 선을 넘는 순간 답이 바뀐다(시간이 끝날 때 서 있는
 * 쪽이 최종 답). 다른 사람 말도 지금 서 있는 쪽으로 달려가는 게 보여서
 * "사람 많은 쪽으로 따라가기" 같은 눈치 싸움이 된다. ←/→ 키로도 이동.
 */

const zoneOf = (x: number) => (x < 50 ? 0 : 1);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** 말 위 글자 — 봇("[Lv.5] AI 봇 1")은 🤖, 사람은 이름 첫 글자. */
const initial = (name: string) => (/봇|^🤖/.test(name) ? "🤖" : (Array.from(name.trim())[0] ?? "?"));
/** 이름표 — 봇은 "[Lv.5] AI " 머리를 떼고 "봇 1"만(좁은 칸에서 잘려도 누군지 보이게). */
const shortName = (name: string) => name.replace(/^🤖\s*/, "").replace(/^\[Lv\.\d+\]\s*/, "").replace(/^AI\s*/, "");
const SIDE = ["⭕", "❌"];

export default function OxArena({
  state,
  viewerSeat,
  names,
  colors,
  picked,
  reveal,
  onMove,
  locked = false,
  late = null,
}: {
  state: GameState;
  viewerSeat: Seat;
  names: Record<Seat, string>;
  colors: readonly string[];
  /** 내 현재 쪽(방장 왕복 전 로컬 선택 포함). */
  picked: number | null;
  reveal: boolean;
  onMove: ((choice: number) => void) | null;
  /** 마감 직전 — 막판 이동이 방장에게 닿을 시간을 남기려고 잠근다(engine OX_LOCK_MS). */
  locked?: boolean;
  /** 공개 때: 내 화면의 마지막 쪽과 판정된 쪽이 다르면(마지막 이동이 늦게 닿음). */
  late?: { shown: number; judged: number | null } | null;
}) {
  const photo = useProfilePhoto();
  const field = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  // 내 말의 자유 위치 — 문제가 바뀌면 가운데로
  const [mine, setMine] = useState<{ q: number; pos: Pos } | null>(null);
  const canMove = !!onMove && !locked;
  const myPos = mine && mine.q === state.qIndex && !reveal ? mine.pos : slot(viewerSeat, picked);
  const alive = new Set(eligibleSeats(state));
  const q = state.questions[state.qIndex];
  const answer = q?.answer ?? -1;

  function moveTo(pos: Pos) {
    if (!canMove) return;
    setMine({ q: state.qIndex, pos });
    const z = zoneOf(pos.x);
    if (z !== picked) onMove!(z);
  }

  function fromEvent(e: PointerEvent<HTMLDivElement>): Pos | null {
    const r = field.current?.getBoundingClientRect();
    if (!r) return null;
    return { x: clamp(((e.clientX - r.left) / r.width) * 100, TOKEN_W / 2, 100 - TOKEN_W / 2), y: clamp(((e.clientY - r.top) / r.height) * 100, 14, 86) };
  }

  useEffect(() => {
    if (!canMove) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const z = e.key === "ArrowLeft" || e.key === "a" || e.key === "A" ? 0 : e.key === "ArrowRight" || e.key === "d" || e.key === "D" ? 1 : null;
      if (z === null) return;
      e.preventDefault();
      setMine({ q: state.qIndex, pos: slot(viewerSeat, z) });
      if (z !== picked) onMove!(z);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canMove, onMove, picked, state.qIndex, viewerSeat]);

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
          if (!canMove) return;
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
        className={`relative h-72 overflow-hidden rounded-3xl border-2 border-white/15 select-none sm:h-80 light:border-slate-300 ${canMove ? "cursor-pointer touch-none" : ""}`}
      >
        {[0, 1].map((z) => (
          <div key={z} className={`absolute inset-y-0 w-1/2 bg-gradient-to-b ${zoneTone(z)} ${z === 0 ? "left-0" : "right-0"}`}>
            {/* 오답 구역은 색(회색)만이 아니라 빗금으로도 — 색각 이상이어도 어느 쪽이 틀렸는지 보이게 */}
            {reveal && z !== answer && <span className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(135deg,rgba(15,23,42,.35)_0_8px,transparent_8px_18px)]" />}
            <span className={`pointer-events-none absolute inset-0 flex items-center justify-center text-[7rem] leading-none sm:text-[9rem] ${reveal ? (z === answer ? "opacity-70" : "opacity-15") : "opacity-25"}`}>{SIDE[z]}</span>
            {reveal && (
              <span
                className={`absolute top-1 left-1/2 z-30 -translate-x-1/2 rounded-full px-2.5 py-0.5 text-xs font-black whitespace-nowrap shadow ${z === answer ? "bg-emerald-500 text-white" : "bg-slate-800 text-slate-200"}`}
              >
                {z === answer ? "✔ 정답" : "✘ 오답"}
              </span>
            )}
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
              data-ox-token={s}
              className={`pointer-events-none absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center ${me && dragging ? "transition-none" : "transition-[left,top] duration-500 ease-out"} ${me ? "z-20" : "z-10"}`}
              style={{ left: `${pos.x}%`, top: `${pos.y}%`, width: `${TOKEN_W}%` }}
            >
              <span
                className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-full font-black text-white shadow-lg ${me ? "h-10 w-10 text-base ring-2 ring-amber-300" : "h-9 w-9 text-sm ring-2 ring-black/30"} ${dead ? "opacity-50 grayscale" : ""}`}
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
              <span data-ox-label className={`mt-0.5 max-w-full truncate rounded-full px-1.5 text-[10px] font-bold ${me ? "bg-amber-300 text-slate-900" : "bg-black/55 text-white"}`}>
                {me ? "나" : shortName(names[s] ?? "?")}
              </span>
            </div>
          );
        })}

      </div>
      {late && (
        <p role="status" className="rounded-xl bg-amber-500/15 px-3 py-1.5 text-center text-xs font-bold text-amber-200 light:text-amber-800">
          ⚠️ 마지막 {SIDE[late.shown]} 이동이 시간 안에 닿지 못해 {late.judged === null ? "고르지 않은 것" : `${SIDE[late.judged]} 쪽`}으로 판정됐어요 (인터넷이 느리면 조금 일찍 옮겨 주세요)
        </p>
      )}
      {/* 안내는 광장 밖에 — 광장 안에 띄우면 가운데 선에 선 말을 가린다 */}
      {onMove && !reveal && (locked || picked === null) ? (
        <p role="status" className={`text-center text-xs font-black ${locked ? "text-amber-300 light:text-amber-700" : "animate-pulse text-sky-200 light:text-sky-700"}`}>
          {locked ? `🔒 마감! ${picked === null ? "아무 쪽도 안 골랐어요" : `${SIDE[picked]} 쪽으로 판정 중…`}` : "👆 ⭕ 또는 ❌ 쪽으로 이동하세요"}
        </p>
      ) : null}
      <p className="text-center text-[11px] text-white/50 light:text-slate-500">
        {onMove
          ? "광장을 눌러 이동 · 끌어서 왔다 갔다 · ←/→ 키 — 시간이 끝날 때 서 있는 쪽이 내 답! (마감 0.6초 전 잠김)"
          : reveal
            ? ""
            : "💀 탈락 — 남은 사람들이 움직이는 걸 구경해요"}
      </p>
    </div>
  );
}
