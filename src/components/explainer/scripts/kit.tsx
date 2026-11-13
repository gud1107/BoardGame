"use client";

import type { ReactNode } from "react";
import { At, Heading } from "../stage";
import { fade, lerp, pop, prog } from "../anim";

/** Demo cast used across hand-made explainers (fictional, not real players). */
export const CAST = [
  { name: "여우", emoji: "🦊", color: "#f97316" },
  { name: "곰돌이", emoji: "🐻", color: "#a16207" },
  { name: "토끼", emoji: "🐰", color: "#ec4899" },
  { name: "호랑이", emoji: "🐯", color: "#eab308" },
  { name: "펭귄", emoji: "🐧", color: "#0ea5e9" },
] as const;

/** Chapter title card used at the start of each chapter. */
export function ChapterCard({ t, n, title, sub, icon }: { t: number; n: number; title: string; sub?: string; icon: string }) {
  const p = prog(t, 0, 0.7);
  return (
    <>
      <At x={800} y={330} scale={pop(t, 0.05)}>
        <div className="text-[150px] leading-none">{icon}</div>
      </At>
      <At x={800} y={480} opacity={fade(t, 0.2)}>
        <div className="rounded-full bg-black/50 px-6 py-1 text-[28px] font-black tracking-widest text-amber-200">CHAPTER {n}</div>
      </At>
      <At x={lerp(760, 800, p)} y={590} opacity={fade(t, 0.3)}>
        <Heading sub={sub}>{title}</Heading>
      </At>
    </>
  );
}

/** Corner caption ("예시", "실제 앱 기준" 같은 작은 라벨). */
export function CornerTag({ children }: { children: ReactNode }) {
  return <div className="absolute top-6 right-8 rounded-full bg-black/60 px-5 py-1.5 text-[22px] font-bold text-white/85">{children}</div>;
}
