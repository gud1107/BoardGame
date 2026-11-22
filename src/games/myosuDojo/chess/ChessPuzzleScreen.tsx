"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ChessPiece, { ChessPieceDefs, pieceProps } from "@/games/chess/ChessPieces";
import { clonePos, hasLegalMove, inCheck, legalMoves, makeMove, mFrom, mTo, moveToSan, parseFen, pieceChar, sqName, type Pos } from "@/games/chess/core";
import { dojoAudio } from "../sound";
import type { ChessPuzzle } from "./puzzles";
import { bestDefence, isMate, winningMoves } from "./solver";

type Phase = "think" | "move" | "reply" | "wrong" | "solved" | "stalemate";

interface Ply {
  san: string;
  white: boolean;
  wrong?: boolean;
}

/**
 * Mate-in-N stage. White (you) moves; the solver checks whether the move
 * still forces mate in the remaining moves. A good move gets the most
 * stubborn reply; a bad one gets the refutation and you may take it back.
 */
export default function ChessPuzzleScreen({
  puzzle,
  bestStars,
  onFinish,
  onNext,
  hasNext,
  onExit,
}: {
  puzzle: ChessPuzzle;
  bestStars: number;
  onFinish: (stars: number, peeked: boolean) => void;
  onNext: () => void;
  hasNext: boolean;
  onExit: () => void;
}) {
  const start = useMemo(() => parseFen(puzzle.fen), [puzzle.fen]);
  const [pos, setPos] = useState<Pos>(() => clonePos(start));
  const [left, setLeft] = useState(puzzle.n);
  const [phase, setPhase] = useState<Phase>("think");
  const [wins, setWins] = useState<number[]>([]);
  const [sel, setSel] = useState<number | null>(null);
  const [last, setLast] = useState<[number, number] | null>(null);
  const [plies, setPlies] = useState<Ply[]>([]);
  const [mistakes, setMistakes] = useState(0);
  const [hinted, setHinted] = useState(false);
  const [peeked, setPeeked] = useState(false);
  const [stars, setStars] = useState(0);
  const undo = useRef<{ pos: Pos; plies: Ply[]; last: [number, number] | null } | null>(null);

  // solve the current position off the click handler (3-movers take ~0.5 s)
  useEffect(() => {
    if (phase !== "think") return;
    const id = setTimeout(() => {
      setWins(winningMoves(clonePos(pos), left));
      setPhase("move");
    }, 30);
    return () => clearTimeout(id);
  }, [phase, pos, left]);

  const legal = useMemo(() => (phase === "move" ? legalMoves(clonePos(pos)) : []), [phase, pos]);
  const targets = sel === null ? [] : legal.filter((m) => mFrom(m) === sel);

  const finish = (s: number) => {
    setStars(s);
    onFinish(s, peeked);
    if (s > 0) dojoAudio.clear(s);
  };

  const play = (m: number) => {
    dojoAudio.unlock();
    const before = clonePos(pos);
    const next = clonePos(pos);
    const san = moveToSan(next, m, legalMoves(next));
    makeMove(next, m);
    dojoAudio.piece();
    const nextPlies = [...plies, { san, white: true }];
    setSel(null);
    setLast([mFrom(m), mTo(m)]);
    setPos(next);
    if (isMate(next)) {
      setPlies(nextPlies);
      setPhase("solved");
      const s = mistakes === 0 && !hinted ? 3 : mistakes <= 1 ? 2 : 1;
      finish(s);
      return;
    }
    if (!hasLegalMove(next)) {
      setPlies(nextPlies);
      undo.current = { pos: before, plies, last };
      setPhase("stalemate");
      setMistakes((x) => x + 1);
      dojoAudio.fail();
      return;
    }
    const good = wins.includes(m);
    setPlies(nextPlies);
    setPhase("reply");
    if (!good) undo.current = { pos: before, plies, last };
    setTimeout(() => {
      const work = clonePos(next);
      const d = bestDefence(work, left - 1)!;
      const rsan = moveToSan(work, d.move, legalMoves(work));
      makeMove(work, d.move);
      dojoAudio.piece();
      setPos(work);
      setLast([mFrom(d.move), mTo(d.move)]);
      setPlies([...nextPlies, { san: rsan, white: false, wrong: !good }]);
      if (good) {
        setLeft(left - 1);
        setPhase("think");
      } else {
        setMistakes((x) => x + 1);
        setPhase("wrong");
        dojoAudio.fail();
      }
    }, 550);
  };

  const takeBack = () => {
    const u = undo.current;
    if (!u) return;
    setPos(u.pos);
    setPlies(u.plies);
    setLast(u.last);
    undo.current = null;
    setPhase("think");
  };

  const restart = () => {
    setPos(clonePos(start));
    setLeft(puzzle.n);
    setPlies([]);
    setLast(null);
    setSel(null);
    setMistakes(0);
    setHinted(false);
    setStars(0);
    undo.current = null;
    setPhase("think");
  };

  const click = (sq: number) => {
    if (phase !== "move") return;
    if (sel !== null) {
      const m = targets.find((x) => mTo(x) === sq);
      if (m !== undefined) {
        // promotions: always the queen (no puzzle here needs an under-promotion)
        const promo = targets.filter((x) => mTo(x) === sq);
        play(promo.length > 1 ? promo.reduce((a, b) => (((b >> 12) & 7) > ((a >> 12) & 7) ? b : a)) : m);
        return;
      }
    }
    const p = pos.b[sq];
    setSel(p && p >> 3 === 0 ? (sel === sq ? null : sq) : null);
  };

  const hintSq = hinted && phase === "move" && wins.length ? mFrom(wins[0]) : -1;
  const check = inCheck(pos) && phase !== "solved" ? pos.k[pos.turn] : -1;
  const status =
    phase === "think" || phase === "reply"
      ? "흑이 생각 중…"
      : phase === "solved"
        ? "체크메이트! 🎉"
        : phase === "stalemate"
          ? "스테일메이트 — 흑이 둘 수가 없어 무승부예요"
          : phase === "wrong"
            ? left - 1 <= 0
              ? "메이트가 아니에요"
              : `흑이 빠져나갔어요 — 이제 ${left - 1}수 안에 메이트할 수 없어요`
            : `백 차례 · ${left}수 안에 메이트`;

  return (
    <div className="flex flex-col gap-3 text-stone-100">
      <ChessPieceDefs />
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={onExit} className="rounded-lg bg-stone-800 px-3 py-1.5 text-sm hover:bg-stone-700">← 목록</button>
        <div className="min-w-0 flex-1">
          <div className="text-lg font-black leading-tight">
            {puzzle.id.toUpperCase()} · {puzzle.title}
          </div>
          <div className="text-sm text-amber-200">백 차례 — {puzzle.n}수 안에 체크메이트</div>
        </div>
        <div className="text-sm" aria-label={`최고 별 ${bestStars}개`}>
          {"⭐".repeat(bestStars)}
          <span className="opacity-25">{"⭐".repeat(3 - bestStars)}</span>
        </div>
      </div>

      <ol className="grid gap-1 rounded-xl bg-stone-900 p-2 text-xs sm:grid-cols-3">
        {["메이트 성공", "실수 1번 이하", "실수 없이 · 힌트 없이"].map((t, i) => (
          <li key={t} className={`rounded-lg px-2 py-1 ${phase === "solved" ? (stars > i ? "bg-emerald-800/70" : "bg-rose-900/50") : "bg-stone-800"}`}>
            {"⭐".repeat(i + 1)} {t}
          </li>
        ))}
      </ol>

      <div className="flex flex-col gap-3 md:flex-row">
        <div className="mx-auto w-full max-w-[min(92vw,30rem)]">
          <div className="grid aspect-square grid-cols-8 grid-rows-8 overflow-hidden rounded-xl border-4 border-amber-900 shadow-lg">
            {Array.from({ length: 64 }, (_, i) => {
              const rank = 7 - Math.floor(i / 8);
              const file = i % 8;
              const sq = rank * 8 + file;
              const p = pos.b[sq];
              const dark = (rank + file) % 2 === 0;
              const isTarget = targets.some((m) => mTo(m) === sq);
              const isLast = last && (last[0] === sq || last[1] === sq);
              return (
                <button
                  key={sq}
                  onClick={() => click(sq)}
                  aria-label={`${sqName(sq)}${p ? ` ${pieceChar(p)}` : ""}`}
                  className={`relative ${dark ? "bg-[#b58863]" : "bg-[#f0d9b5]"} ${sel === sq ? "ring-4 ring-inset ring-sky-400" : ""} ${hintSq === sq ? "ring-4 ring-inset ring-amber-400" : ""}`}
                >
                  {isLast && <span className="absolute inset-0 bg-yellow-300/40" />}
                  {check === sq && <span className="absolute inset-0 bg-[radial-gradient(circle,rgba(239,68,68,0.85),transparent_70%)]" />}
                  {p ? <ChessPiece {...pieceProps(pieceChar(p))} className="relative h-full w-full p-[6%]" /> : null}
                  {isTarget && <span className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ${p ? "h-[90%] w-[90%] border-4 border-sky-500/70" : "h-1/3 w-1/3 bg-sky-500/60"}`} />}
                  {file === 0 && <span className={`absolute left-0.5 top-0 text-[9px] font-bold ${dark ? "text-[#f0d9b5]" : "text-[#b58863]"}`}>{rank + 1}</span>}
                  {rank === 0 && <span className={`absolute bottom-0 right-0.5 text-[9px] font-bold ${dark ? "text-[#f0d9b5]" : "text-[#b58863]"}`}>{"abcdefgh"[file]}</span>}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-2">
          <div className={`rounded-xl p-3 text-center font-black ${phase === "solved" ? "bg-amber-400 text-stone-900" : phase === "wrong" || phase === "stalemate" ? "bg-rose-800" : "bg-stone-900"}`}>{status}</div>
          <div className="min-h-16 rounded-xl bg-stone-900 p-2 font-mono text-sm">
            {plies.length === 0 ? (
              <span className="text-stone-500">기물을 눌러 고른 뒤 갈 칸을 누르세요.</span>
            ) : (
              plies.map((p, i) => (
                <span key={i} className={`mr-2 inline-block ${p.wrong ? "text-rose-300" : p.white ? "text-stone-100" : "text-stone-400"}`}>
                  {p.white ? `${Math.floor(i / 2) + 1}. ` : ""}
                  {p.san}
                </span>
              ))
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {(phase === "wrong" || phase === "stalemate") && <button onClick={takeBack} className="min-h-11 flex-1 rounded-xl bg-amber-400 px-4 py-2 font-black text-stone-900">↶ 그 수 무르기</button>}
            {phase === "solved" && hasNext && <button onClick={onNext} className="min-h-11 flex-1 rounded-xl bg-emerald-600 px-4 py-2 font-bold">다음 ▶</button>}
            <button onClick={restart} className="min-h-11 rounded-xl bg-stone-800 px-3 py-2 text-sm">↺ 처음부터</button>
            {phase === "move" && !hinted && (
              <button onClick={() => setHinted(true)} className="min-h-11 rounded-xl bg-stone-800 px-3 py-2 text-sm" title="움직일 기물을 표시해요 (⭐⭐까지)">
                💡 힌트
              </button>
            )}
            {mistakes >= 2 && !peeked && (
              <button onClick={() => setPeeked(true)} className="min-h-11 rounded-xl bg-stone-800 px-3 py-2 text-sm">🔑 첫 수 보기</button>
            )}
          </div>
          {hinted && <p className="rounded-lg bg-stone-800 p-2 text-sm text-amber-100">💡 {puzzle.hint}</p>}
          {peeked && <p className="rounded-lg bg-stone-800 p-2 text-sm">🔑 첫 수는 <b className="font-mono text-amber-300">{puzzle.key}</b> — 이 문제 기록은 ⭐ 1개까지만 남아요.</p>}
          <p className="text-xs text-stone-500">흑은 가장 오래 버티는 수로 응수해요. 다른 길로도 정해진 수 안에 메이트하면 정답이에요.</p>
        </div>
      </div>
    </div>
  );
}
