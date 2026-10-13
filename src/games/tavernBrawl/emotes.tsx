"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * 감정표현 — 게임 상태(엔진)와 별개로 채널 `emote` 브로드캐스트로만 오간다(결과·동기화 무관).
 * 3D 아바타 머리 위 말풍선 + 동작, 손님 목록·2D 배지 옆 말풍선으로 보인다.
 */

export type EmoteKind = "wave" | "laugh" | "gg" | "taunt" | "party" | "think" | "angry" | "cry";

export const EMOTES: { kind: EmoteKind; emoji: string; text: string }[] = [
  { kind: "wave", emoji: "👋", text: "안녕!" },
  { kind: "laugh", emoji: "😂", text: "ㅋㅋㅋ" },
  { kind: "gg", emoji: "👍", text: "잘했어!" },
  { kind: "taunt", emoji: "😏", text: "덤벼!" },
  { kind: "party", emoji: "🎉", text: "와아!" },
  { kind: "think", emoji: "🤔", text: "흠…" },
  { kind: "angry", emoji: "😡", text: "으악!" },
  { kind: "cry", emoji: "😭", text: "흑흑" },
];

export const EMOTE_BY_KIND: Record<EmoteKind, { emoji: string; text: string }> = Object.fromEntries(EMOTES.map((e) => [e.kind, e])) as unknown as Record<EmoteKind, { emoji: string; text: string }>;

/** 받은 시각(ms, 이 기기 시계) */
export interface EmoteSlot {
  kind: EmoteKind;
  at: number;
}

export const EMOTE_MS = 2800;

export function isEmoteKind(k: unknown): k is EmoteKind {
  return typeof k === "string" && k in EMOTE_BY_KIND;
}

/** 말풍선 표시 여부 — 받은 뒤 EMOTE_MS 동안만(시계는 이펙트에서만 읽는다) */
export function useEmoteVisible(slot: EmoteSlot | undefined): boolean {
  const [shownAt, setShownAt] = useState<number | null>(null);
  useEffect(() => {
    if (!slot) return;
    const left = EMOTE_MS - (Date.now() - slot.at);
    if (left <= 0) return;
    const t0 = window.setTimeout(() => setShownAt(slot.at), 0);
    const t1 = window.setTimeout(() => setShownAt((v) => (v === slot.at ? null : v)), left);
    return () => {
      window.clearTimeout(t0);
      window.clearTimeout(t1);
    };
  }, [slot]);
  return !!slot && shownAt === slot.at;
}

/** 이름 옆 작은 말풍선 */
export function EmoteBubble({ slot, className = "" }: { slot: EmoteSlot | undefined; className?: string }) {
  const visible = useEmoteVisible(slot);
  if (!slot || !visible) return null;
  const e = EMOTE_BY_KIND[slot.kind];
  return (
    <span key={slot.at} className={`tb-emote pointer-events-none inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-white/30 bg-white px-2 py-0.5 text-xs font-bold text-slate-900 shadow-lg ${className}`}>
      <span className="text-base leading-none">{e.emoji}</span>
      {e.text}
    </span>
  );
}

const WHEEL_CSS = `
@keyframes tb-ew-in { 0% { opacity:0; transform: translate(var(--fx), var(--fy)) scale(.3) } 70% { opacity:1; transform: translate(0,0) scale(1.12) } 100% { transform: none } }
@keyframes tb-ew-idle { 0%,100% { transform: translateY(0) rotate(0) } 50% { transform: translateY(-2px) rotate(-6deg) } }
@keyframes tb-ew-cd { from { stroke-dashoffset: 0 } to { stroke-dashoffset: 163 } }
.tb-ew-item { animation: tb-ew-in .32s cubic-bezier(.2,1.3,.4,1) both; }
.tb-ew-idle { animation: tb-ew-idle 2.4s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .tb-ew-item, .tb-ew-idle { animation: none; } }
`;

/** 보내기 사이 최소 간격(TavernBrawlGame.sendEmote의 제한과 같게) */
export const EMOTE_COOLDOWN_MS = 1200;

/**
 * 화면 오른쪽 아래에 떠 있는 큰 감정표현 버튼. 누르면 8개가 버튼에서 튀어나오듯 펼쳐지고,
 * 보낸 뒤엔 버튼 둘레에 재사용 대기 링이 돈다. PC는 숫자 1~8 단축키, Esc·바깥 클릭으로 닫힘.
 */
export function EmoteWheel({ onEmote, mine }: { onEmote: (k: EmoteKind) => void; mine?: EmoteSlot }) {
  const [open, setOpen] = useState(false);
  const [cool, setCool] = useState(0);
  const send = useCallback(
    (k: EmoteKind) => {
      onEmote(k);
      setOpen(false);
      setCool((c) => c + 1);
    },
    [onEmote],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "Escape") return setOpen(false);
      const n = Number(e.key);
      if (n >= 1 && n <= EMOTES.length && !e.ctrlKey && !e.metaKey && !e.altKey) send(EMOTES[n - 1].kind);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [send]);
  return (
    <div className="fixed bottom-4 right-4 z-[65] flex flex-col items-end gap-2 sm:bottom-6 sm:right-6">
      <style>{WHEEL_CSS}</style>
      {open && <div className="fixed inset-0" onClick={() => setOpen(false)} aria-hidden />}
      {open && (
        <div className="relative grid grid-cols-4 gap-1.5 rounded-3xl border border-amber-400/50 bg-stone-950/95 p-2 shadow-[0_10px_40px_rgba(0,0,0,.6)] backdrop-blur">
          {EMOTES.map((e, i) => (
            <button
              key={e.kind}
              type="button"
              onClick={() => send(e.kind)}
              className="tb-ew-item flex w-16 flex-col items-center rounded-2xl py-2 text-white/90 transition hover:scale-110 hover:bg-amber-400/15 active:scale-95"
              style={{ animationDelay: `${i * 25}ms`, "--fx": `${(3 - (i % 4)) * 30}px`, "--fy": `${(1 - Math.floor(i / 4)) * 40 + 30}px` } as React.CSSProperties}
            >
              <span className="text-3xl leading-none">{e.emoji}</span>
              <span className="mt-1 text-[11px] font-bold">{e.text}</span>
              <span className="hidden text-[9px] text-white/35 sm:block">{i + 1}</span>
            </button>
          ))}
        </div>
      )}
      <span className="relative flex items-center gap-2">
        {mine && !open && <EmoteBubble slot={mine} className="!text-sm" />}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={`relative flex h-14 w-14 items-center justify-center rounded-full border-2 text-3xl shadow-[0_6px_20px_rgba(0,0,0,.5)] transition hover:scale-110 active:scale-95 ${
            open ? "border-yellow-200 bg-gradient-to-b from-yellow-300 to-amber-500" : "border-amber-300/80 bg-gradient-to-b from-amber-400 to-orange-600"
          }`}
          title="감정표현 (단축키 1~8)"
          aria-label="감정표현"
          aria-expanded={open}
        >
          <span className={open ? "text-2xl font-black text-amber-950" : "tb-ew-idle"}>{open ? "✕" : "😀"}</span>
          {cool > 0 && (
            <svg key={cool} className="pointer-events-none absolute -inset-1 h-[calc(100%+8px)] w-[calc(100%+8px)] -rotate-90" viewBox="0 0 60 60">
              <circle cx="30" cy="30" r="26" fill="none" stroke="#fde047" strokeWidth="3" strokeDasharray="163" style={{ animation: `tb-ew-cd ${EMOTE_COOLDOWN_MS}ms linear forwards` }} />
            </svg>
          )}
        </button>
      </span>
    </div>
  );
}
