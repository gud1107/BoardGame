"use client";

import { useMemo, useState } from "react";
import { CATEGORIES, SEAT_COLORS, SEAT_GLYPHS, cardsOf } from "./data";
import type { GameState } from "./engine";
import { MARK_CYCLE, MARK_GLYPH, autoFacts, clueText, type Mark } from "./show";
import { cardTitle } from "./Cards";
import { getFogSound } from "./fogManorSound";

/**
 * 📒 수사 노트 (규칙서 §11). 21장 × (각 탐정 + ✉️ 봉투) 칸.
 * 확실한 것(내 손패·공개·보여 받은 카드·내 단서)은 자동으로 채우고 잠근다(밑줄). 나머지는 눌러서
 * 빈칸 → ✗ → ✓ → ? 순환. 직접 쓴 표시는 이 기기에만 저장된다(사건 번호별).
 */

const CAT_LABEL = { suspect: "🧑 용의자", weapon: "🔪 흉기", room: "🚪 장소" } as const;

function storageKey(view: GameState, me: number) {
  return `fog-manor-notes-${view.caseNo}-${view.seatCount}-${me}`;
}

function loadMarks(key: string): Record<string, Mark> {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Record<string, Mark>) : {};
  } catch {
    return {};
  }
}

export default function Notebook({ view, me, names }: { view: GameState; me: number; names: Record<number, string> }) {
  const key = storageKey(view, me);
  const [marks, setMarks] = useState<{ key: string; m: Record<string, Mark> }>(() => ({ key, m: typeof window === "undefined" ? {} : loadMarks(key) }));
  if (marks.key !== key) setMarks({ key, m: loadMarks(key) });
  const facts = useMemo(() => autoFacts(view, me), [view, me]);
  const n = view.seatCount;
  const cols = Array.from({ length: n + 1 }, (_, i) => i);

  function cycle(card: number, col: number) {
    const id = `${card}:${col}`;
    const cur = marks.m[id] ?? "";
    const next = MARK_CYCLE[(MARK_CYCLE.indexOf(cur) + 1) % MARK_CYCLE.length];
    const m = { ...marks.m, [id]: next };
    setMarks({ key, m });
    getFogSound().play("pencil");
    try {
      window.localStorage.setItem(key, JSON.stringify(m));
    } catch {
      // 저장 실패 — 이 화면에서만 기억
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto rounded-xl border border-white/10 bg-[#120f14] light:border-slate-300">
        <table className="w-full border-collapse text-[11px] text-white/80">
          <thead>
            <tr className="bg-white/5">
              <th className="sticky left-0 z-10 bg-[#1b161d] px-1.5 py-1 text-left font-semibold text-white/50">카드</th>
              {cols.map((c) => (
                <th key={c} className="px-0.5 py-1 text-center font-bold" title={c === n ? "봉투(정답)" : (names[c] ?? "")}>
                  {c === n ? (
                    "✉️"
                  ) : (
                    <span style={{ color: SEAT_COLORS[c % SEAT_COLORS.length] }}>
                      {SEAT_GLYPHS[c % SEAT_GLYPHS.length]}
                      {c === me && <span className="text-white/60">나</span>}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CATEGORIES.map((cat) => (
              <NotebookGroup key={cat} label={CAT_LABEL[cat]} cards={cardsOf(cat)} cols={cols} n={n} facts={facts} marks={marks.m} onCycle={cycle} publicCards={view.publicCards} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] break-keep text-white/40 light:text-slate-500">밑줄 칸은 확실한 사실(자동). 나머지 칸을 눌러 ✗ → ✓ → ? 로 직접 적으세요. 공개 심문 장수는 직접 추리!</p>
      <div className="flex flex-col gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-2 light:border-slate-300">
        <p className="text-[11px] font-semibold text-white/60 light:text-slate-600">🔎 내가 찾은 단서 {view.clues[me]?.length ?? 0}장</p>
        {(view.clues[me] ?? []).length === 0 && <p className="text-[11px] text-white/35">아직 없어요 — 방에서 🔍 수색해 보세요.</p>}
        {(view.clues[me] ?? []).map((c) => (
          <p key={c.id} className="text-[11px] break-keep text-white/75 light:text-slate-700">
            {c.bell ? "🔔" : c.kind === "trait" ? "🔎" : "🧾"} {clueText(c)}
          </p>
        ))}
      </div>
    </div>
  );
}

function NotebookGroup({
  label,
  cards,
  cols,
  n,
  facts,
  marks,
  onCycle,
  publicCards,
}: {
  label: string;
  cards: number[];
  cols: number[];
  n: number;
  facts: Map<string, { mark: Mark; why: string }>;
  marks: Record<string, Mark>;
  onCycle: (card: number, col: number) => void;
  publicCards: number[];
}) {
  return (
    <>
      <tr>
        <td colSpan={cols.length + 1} className="bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-semibold text-white/50">
          {label}
        </td>
      </tr>
      {cards.map((card) => {
        const t = cardTitle(card);
        const ruledOut = facts.get(`${card}:${n}`)?.mark === "x" || marks[`${card}:${n}`] === "x";
        return (
          <tr key={card} className="border-t border-white/5">
            <td className={`sticky left-0 z-10 bg-[#120f14] px-1.5 py-0.5 whitespace-nowrap ${ruledOut ? "text-white/35 line-through" : ""}`}>
              {t.icon} {t.name}
              {publicCards.includes(card) && <span className="ml-1 rounded bg-white/10 px-1 text-[9px] text-white/60">공개</span>}
            </td>
            {cols.map((col) => {
              const f = facts.get(`${card}:${col}`);
              const m = f?.mark ?? marks[`${card}:${col}`] ?? "";
              return (
                <td key={col} className="p-0 text-center">
                  <button
                    type="button"
                    disabled={!!f}
                    title={f?.why}
                    onClick={() => onCycle(card, col)}
                    className={`h-6 w-7 text-xs font-bold ${f ? "underline decoration-white/30" : "hover:bg-white/10"} ${m === "o" ? "text-emerald-300" : m === "x" ? "text-rose-300/80" : m === "q" ? "text-amber-300" : "text-white/20"} ${col === n ? "bg-amber-400/5" : ""}`}
                  >
                    {MARK_GLYPH[m] || "·"}
                  </button>
                </td>
              );
            })}
          </tr>
        );
      })}
    </>
  );
}
