"use client";

import { useEffect, useState } from "react";

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

/** 감정표현 고르기 버튼(누르면 8개 펼침). PC는 숫자 1~8 단축키 */
export function EmotePicker({ onEmote }: { onEmote: (k: EmoteKind) => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const n = Number(e.key);
      if (n >= 1 && n <= EMOTES.length && !e.ctrlKey && !e.metaKey && !e.altKey) onEmote(EMOTES[n - 1].kind);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onEmote]);
  return (
    <span className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`rounded-full border px-2.5 py-1 text-xs transition ${open ? "border-yellow-300 bg-yellow-300/15 text-yellow-100" : "border-white/15 text-white/80 light:border-amber-300 light:text-amber-800"}`}
        title="감정표현 (단축키 1~8)"
      >
        😀 감정표현
      </button>
      {open && (
        <span className="tb-pop absolute right-0 top-9 z-40 grid w-64 grid-cols-4 gap-1.5 rounded-2xl border border-amber-400/40 bg-stone-950/95 p-2 shadow-2xl">
          {EMOTES.map((e, i) => (
            <button
              key={e.kind}
              type="button"
              onClick={() => {
                onEmote(e.kind);
                setOpen(false);
              }}
              className="flex flex-col items-center rounded-xl py-1.5 text-white/85 transition hover:scale-110 hover:bg-white/10"
            >
              <span className="text-2xl leading-none">{e.emoji}</span>
              <span className="mt-0.5 text-[10px]">{e.text}</span>
              <span className="text-[9px] text-white/35">{i + 1}</span>
            </button>
          ))}
        </span>
      )}
    </span>
  );
}
