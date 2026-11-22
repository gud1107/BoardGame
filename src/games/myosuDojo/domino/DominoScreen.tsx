"use client";

import { useEffect, useMemo, useState } from "react";
import { TICK_MS, type ToppleEvent } from "@/games/dominoChain/engine";
import { dojoAudio } from "../sound";
import { baseCells, canPlace, reach, runDomino, withPlaced, type DominoOutcome, type DominoStage, type Placed } from "./puzzle";

type Tool = "domino" | "split" | "erase";

/**
 * 도미노 설계 stage: stand pieces, then ▶ 와르르 runs 도미노 연쇄's own
 * topple and plays its events back tick by tick.
 */
export default function DominoScreen({
  stage,
  bestStars,
  onFinish,
  onNext,
  hasNext,
  onExit,
}: {
  stage: DominoStage;
  bestStars: number;
  onFinish: (stars: number, peeked: boolean) => void;
  onNext: () => void;
  hasNext: boolean;
  onExit: () => void;
}) {
  const [placed, setPlaced] = useState<Placed[]>([]);
  const [tool, setTool] = useState<Tool>("domino");
  const [dir, setDir] = useState(stage.pusherDir);
  const [out, setOut] = useState<DominoOutcome | null>(null);
  const [tick, setTick] = useState(-1);
  const [hint, setHint] = useState(false);
  const [peeked, setPeeked] = useState(false);
  const [tries, setTries] = useState(0);

  const base = useMemo(() => baseCells(stage), [stage]);
  const cells = useMemo(() => withPlaced(base, placed), [base, placed]);
  const live = useMemo(() => reach(stage.size, cells), [stage.size, cells]);
  const usedDom = placed.filter((p) => p.kind === "domino").length;
  const usedSplit = placed.length - usedDom;
  const animating = out !== null && tick < out.result.ticks;

  // playback
  useEffect(() => {
    if (!out || tick >= out.result.ticks) return;
    const id = setTimeout(() => {
      const t = tick + 1;
      for (const e of out.result.events) {
        if (e.t !== t) continue;
        if (e.kind === "fall") dojoAudio.tick();
        else if (e.kind === "ring") dojoAudio.bell(base[e.cell].feature?.value ?? 1);
        else dojoAudio.boom();
      }
      setTick(t);
      if (t >= out.result.ticks) {
        if (out.stars > 0) dojoAudio.clear(out.stars);
        else dojoAudio.fail();
      }
    }, TICK_MS * 0.8);
    return () => clearTimeout(id);
  }, [out, tick, base]);

  const done = useMemo(() => {
    const m = new Map<number, ToppleEvent>();
    if (!out) return m;
    for (const e of out.result.events) if (e.t <= tick && !m.has(e.cell)) m.set(e.cell, e);
    return m;
  }, [out, tick]);

  const tap = (i: number) => {
    if (out) return;
    dojoAudio.unlock();
    const at = placed.findIndex((p) => p.cell === i);
    if (at >= 0) {
      if (tool === "erase") setPlaced(placed.filter((_, k) => k !== at));
      else setPlaced(placed.map((p, k) => (k === at ? { ...p, dir: (p.dir + 1) % 8 } : p)));
      dojoAudio.place();
      return;
    }
    if (tool === "erase" || !canPlace(cells, i)) return;
    if (tool === "domino" && usedDom >= stage.dominoes) return;
    if (tool === "split" && usedSplit >= stage.splits) return;
    setPlaced([...placed, { cell: i, kind: tool, dir }]);
    dojoAudio.place();
  };

  const go = () => {
    dojoAudio.unlock();
    const o = runDomino(stage, placed);
    setOut(o);
    setTick(-1);
    setTries((n) => n + 1);
    onFinish(o.stars, peeked);
  };

  const redesign = () => {
    setOut(null);
    setTick(-1);
  };

  const showAnswer = () => {
    setPeeked(true);
    setOut(null);
    setPlaced(stage.solution.map((p) => ({ ...p })));
  };

  const finished = out && !animating;

  return (
    <div className="flex flex-col gap-3 text-stone-100">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={onExit} className="rounded-lg bg-stone-800 px-3 py-1.5 text-sm hover:bg-stone-700">← 목록</button>
        <div className="min-w-0 flex-1">
          <div className="text-lg font-black leading-tight">
            {stage.id.toUpperCase()} · {stage.title}
          </div>
          <div className="text-sm text-amber-200">{stage.goal}</div>
        </div>
        <div className="text-sm" aria-label={`최고 별 ${bestStars}개`}>
          {"⭐".repeat(bestStars)}
          <span className="opacity-25">{"⭐".repeat(3 - bestStars)}</span>
        </div>
      </div>

      <ol className="grid gap-1 rounded-xl bg-stone-900 p-2 text-xs sm:grid-cols-3">
        {[
          "종 모두 울리기",
          `조각 ${stage.par + 2}개 이하로`,
          `조각 ${stage.par}개 이하로 (최소)${stage.noBomb ? " · 폭탄 안 터뜨리기" : ""}`,
        ].map((t, i) => (
          <li key={t} className={`rounded-lg px-2 py-1 ${finished ? (out.stars > i ? "bg-emerald-800/70" : "bg-rose-900/50") : "bg-stone-800"}`}>
            {"⭐".repeat(i + 1)} {t}
          </li>
        ))}
      </ol>

      <div className="mx-auto w-full max-w-[min(94vw,32rem)]">
        <div className="grid gap-[3px] rounded-xl bg-amber-950 p-[3px]" style={{ gridTemplateColumns: `repeat(${stage.size}, minmax(0, 1fr))` }}>
          {cells.map((c, i) => {
            const ev = done.get(i);
            const land = !out && live.landings.has(i);
            const p = c.piece;
            const f = c.feature;
            const fell = ev?.kind === "fall" || (p?.kind === "pusher" && out && tick >= 0);
            const rang = ev?.kind === "ring";
            const boom = ev?.kind === "boom";
            const mine = placed.some((x) => x.cell === i);
            return (
              <button
                key={i}
                onClick={() => tap(i)}
                aria-label={`${(i % stage.size) + 1}열 ${Math.floor(i / stage.size) + 1}행${p ? ` ${p.kind}` : f ? ` ${f.kind}` : ""}`}
                className={`relative aspect-square overflow-hidden rounded-[4px] ${boom ? "bg-orange-500" : rang ? "bg-yellow-300" : land ? "bg-sky-700/70" : "bg-amber-100/90"} ${land ? "ring-2 ring-inset ring-sky-300" : ""}`}
              >
                {f?.kind === "bell" && (
                  <span className={`absolute inset-0 grid place-items-center text-[clamp(12px,4.2vw,24px)] ${rang ? "animate-pulse" : ""}`}>
                    🔔<span className="absolute bottom-0 right-0.5 text-[10px] font-black text-amber-900">{f.value}</span>
                  </span>
                )}
                {f?.kind === "bomb" && <span className="absolute inset-0 grid place-items-center text-[clamp(12px,4.2vw,24px)]">{boom ? "💥" : "💣"}</span>}
                {f?.kind === "rock" && <span className="absolute inset-0 grid place-items-center bg-stone-500 text-[clamp(12px,4.2vw,24px)]">🪨</span>}
                {p?.kind === "wall" && <span className="absolute inset-1 rounded bg-stone-600" />}
                {p && p.kind !== "wall" && (
                  <span className="absolute inset-0 grid place-items-center" style={{ transform: `rotate(${p.dir * 45}deg)` }}>
                    <span
                      className={`grid place-items-center rounded-sm text-[clamp(9px,2.6vw,14px)] font-black transition-all duration-150 ${
                        p.kind === "pusher" ? "bg-rose-600 text-white" : p.kind === "split" ? "bg-violet-600 text-white" : mine ? "bg-stone-900 text-amber-200" : "bg-stone-500 text-white"
                      }`}
                      style={fell ? { width: "86%", height: "34%", transform: "translateX(18%)", opacity: 0.75 } : { width: "34%", height: "78%" }}
                    >
                      {p.kind === "split" ? "⑂" : "→"}
                    </span>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {!out ? (
        <div className="flex flex-col gap-2 rounded-xl bg-stone-900 p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-bold text-stone-400">도구</span>
            <ToolBtn on={tool === "domino"} onClick={() => setTool("domino")}>
              ▮ 도미노 {stage.dominoes - usedDom}
            </ToolBtn>
            {stage.splits > 0 && (
              <ToolBtn on={tool === "split"} onClick={() => setTool("split")}>
                ⑂ 갈림 {stage.splits - usedSplit}
              </ToolBtn>
            )}
            <ToolBtn on={tool === "erase"} onClick={() => setTool("erase")}>
              🧽 지우기
            </ToolBtn>
            <span className="ml-auto font-bold">
              사용 {placed.length}개 · 종 {bellsRung(live, base)}/{bellTotal(base)}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1 text-sm">
            <span className="mr-1 font-bold text-stone-400">세울 방향</span>
            {["→", "↘", "↓", "↙", "←", "↖", "↑", "↗"].map((a, d) => (
              <button key={a} onClick={() => setDir(d)} aria-pressed={dir === d} className={`h-10 w-10 rounded-lg text-lg font-black ${dir === d ? "bg-sky-500 text-stone-900" : "bg-stone-800"}`}>
                {a}
              </button>
            ))}
          </div>
          <p className="text-xs text-stone-400">빈칸을 누르면 세우고, 세운 조각을 누르면 45° 돌아가요. 하늘색 칸 = 지금 연쇄가 닿는 곳 (종 개수는 지금 설계로 울릴 수 있는 수).</p>
          <div className="flex flex-wrap gap-2">
            <button onClick={go} className="min-h-11 flex-1 rounded-xl bg-amber-400 px-5 py-2 text-lg font-black text-stone-900 shadow hover:bg-amber-300">▶ 와르르!</button>
            <button onClick={() => setPlaced([])} className="min-h-11 rounded-xl bg-stone-800 px-3 py-2 text-sm">🗑 모두 치우기</button>
            <button onClick={() => setHint((h) => !h)} className="min-h-11 rounded-xl bg-stone-800 px-3 py-2 text-sm">💡 힌트</button>
            {tries >= 3 && <button onClick={showAnswer} className="min-h-11 rounded-xl bg-stone-800 px-3 py-2 text-sm">🔑 정답 보기</button>}
          </div>
          {hint && <p className="rounded-lg bg-stone-800 p-2 text-sm text-amber-100">💡 {stage.hint}</p>}
          {peeked && <p className="text-xs text-stone-400">🔑 정답 설계를 깔았어요 — 이 스테이지 기록은 ⭐ 1개까지만 남아요.</p>}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {finished && (
            <div className={`rounded-xl p-3 text-center text-lg font-black ${out.stars > 0 ? "bg-amber-400 text-stone-900" : "bg-rose-800"}`}>
              {out.stars > 0 ? `⭐ ${out.stars}개!` : "실패"} · 종 {out.rung}/{out.bells} · 조각 {out.used}개 (최소 {stage.par}개){out.bombs ? ` · 💣 ${out.bombs}` : ""}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button onClick={redesign} disabled={animating} className="min-h-11 flex-1 rounded-xl bg-amber-400 px-4 py-2 font-black text-stone-900 disabled:opacity-50">✏️ 다시 설계</button>
            {finished && hasNext && (out.stars > 0 || bestStars > 0) && <button onClick={onNext} className="min-h-11 rounded-xl bg-emerald-600 px-4 py-2 font-bold">다음 ▶</button>}
          </div>
        </div>
      )}
    </div>
  );
}

function bellTotal(base: ReturnType<typeof baseCells>) {
  return base.filter((c) => c.feature?.kind === "bell").length;
}
function bellsRung(r: ReturnType<typeof reach>, base: ReturnType<typeof baseCells>) {
  return base.filter((c, i) => c.feature?.kind === "bell" && r.rung[i]).length;
}

function ToolBtn({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-pressed={on} className={`min-h-10 rounded-lg px-3 font-bold ${on ? "bg-sky-500 text-stone-900" : "bg-stone-800"}`}>
      {children}
    </button>
  );
}
