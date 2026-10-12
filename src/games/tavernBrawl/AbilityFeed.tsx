"use client";

import type { ReactNode } from "react";
import type { AbilityNote } from "./combat";

/**
 * 능력 하이라이트 — ① 전투 재생 위에 뜨는 "방금 발동한 능력" 피드, ② 능력 문구 속 핵심어 강조.
 * 2D·3D 재생과 상점 정보창이 같이 쓴다.
 */

export interface FeedItem extends AbilityNote {
  id: number;
  mine: boolean;
}

const TERMS: [RegExp, string][] = [
  [/전투의 함성/g, "text-amber-300 light:text-amber-700"],
  [/죽음의 메아리/g, "text-violet-300 light:text-violet-700"],
  [/전투 시작/g, "text-orange-300 light:text-orange-700"],
  [/성장/g, "text-lime-300 light:text-lime-700"],
  [/공격할 때마다/g, "text-rose-300 light:text-rose-700"],
  [/아군이 죽을 때마다/g, "text-violet-300 light:text-violet-700"],
  [/판매 시/g, "text-yellow-300 light:text-yellow-700"],
  [/상점 단계가 (?:시작|끝날) 때/g, "text-lime-300 light:text-lime-700"],
  [/도발|보호막|독|부활|광역|연타/g, "text-sky-300 light:text-sky-700"],
  [/[+−-]\d+\/[+−-]?\d+|[+−-]\d+(?= ?(?:골드|추가))|공격력 [+−-]\d+|피해 \d+|\d+\/\d+/g, "text-lime-300 light:text-lime-700"],
];

/** 능력 문구에서 발동 조건·키워드·수치를 색으로 강조 */
export function AbilityText({ text }: { text: string }): ReactNode {
  if (!text) return null;
  type Seg = { s: string; cls?: string };
  let segs: Seg[] = [{ s: text }];
  for (const [re, cls] of TERMS) {
    const next: Seg[] = [];
    for (const seg of segs) {
      if (seg.cls) {
        next.push(seg);
        continue;
      }
      let last = 0;
      for (const m of seg.s.matchAll(re)) {
        const i = m.index ?? 0;
        if (i > last) next.push({ s: seg.s.slice(last, i) });
        next.push({ s: m[0], cls });
        last = i + m[0].length;
      }
      if (last < seg.s.length) next.push({ s: seg.s.slice(last) });
    }
    segs = next;
  }
  return (
    <>
      {segs.map((g, i) =>
        g.cls ? (
          <b key={i} className={`font-bold ${g.cls}`}>
            {g.s}
          </b>
        ) : (
          <span key={i}>{g.s}</span>
        ),
      )}
    </>
  );
}

export default function AbilityFeed({ items }: { items: FeedItem[] }) {
  if (!items.length) return null;
  return (
    <div className="pointer-events-none absolute left-2 top-8 z-30 flex max-w-[88%] flex-col gap-1">
      {items.map((it) => (
        <div
          key={it.id}
          className={`tb-feed flex items-start gap-1.5 rounded-lg border px-2 py-1 text-[11px] leading-snug shadow-lg backdrop-blur-sm ${
            it.mine ? "border-emerald-400/50 bg-emerald-950/80 text-emerald-50" : "border-rose-400/50 bg-rose-950/80 text-rose-50"
          }`}
        >
          <span className="shrink-0 font-black text-yellow-300">{it.label}</span>
          {it.text && (
            <span className="text-white/85">
              <AbilityText text={it.text} />
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
