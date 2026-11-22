"use client";

import { useEffect, useState } from "react";
import type { PlayableGameProps } from "../types";
import { trackGameEvent } from "@/lib/analytics/gameEvents";
import { recordSoloRun } from "@/lib/stats/soloResult";
import AimScreen from "./aim/AimScreen";
import { BOOKS, bookOf, type BookId } from "./books";
import ChessPuzzleScreen from "./chess/ChessPuzzleScreen";
import { CHESS_PUZZLES } from "./chess/puzzles";
import { cueAdapter } from "./cue/cue";
import { CUE_STAGES } from "./cue/stages";
import DominoScreen from "./domino/DominoScreen";
import { DOMINO_STAGES } from "./domino/stages";
import { curlAdapter } from "./flick/curl";
import { flickAdapter } from "./flick/flick";
import { CURL_STAGES, FLICK_STAGES } from "./flick/stages";
import RulebookModal from "./RulebookModal";
import { applyRun, freshSave, isUnlocked, loadSave, totals, writeSave, type DojoSave } from "./save";
import { dojoAudio } from "./sound";

/**
 * 묘수 도장 — four solo puzzle books on top of existing games' engines:
 * ♟️ 체스 N수 메이트, 🎱 당구 한 큐, 🥏 알까기 · 🥌 컬링 한 수, 🁢 도미노 설계.
 * Each attempt is saved locally and to /stats right away.
 */
export default function MyosuDojoGame({ participants, onComplete }: PlayableGameProps) {
  const [save, setSave] = useState<DojoSave>(() => (typeof window === "undefined" ? freshSave() : loadSave()));
  const [stageId, setStageId] = useState<string | null>(null);
  const [runKey, setRunKey] = useState(0);
  const [rules, setRules] = useState(false);

  useEffect(() => {
    dojoAudio.setMuted(save.muted);
  }, [save.muted]);

  const update = (fn: (s: DojoSave) => DojoSave) => {
    setSave((prev) => {
      const next = fn(prev);
      writeSave(next);
      return next;
    });
  };

  const open = (id: string) => {
    trackGameEvent("myosu-dojo", "game_start", { isHost: true });
    setStageId(id);
    setRunKey((k) => k + 1);
  };

  const onFinish = (id: string, stars: number, peeked: boolean) => {
    const book = bookOf(id);
    const next = applyRun(save, id, stars, peeked);
    const all = totals(next);
    const bt = (b: BookId) => totals(next, b).stars;
    recordSoloRun("myosu-dojo", {
      attempts: 1,
      clears: stars > 0 ? 1 : 0,
      threeStars: stars === 3 && !peeked ? 1 : 0,
      [`${book}Clears`]: stars > 0 ? 1 : 0,
      maxStars: all.stars,
      maxCleared: all.cleared,
      maxPerfect: all.perfect,
      maxChessStars: bt("chess"),
      maxCueStars: bt("cue"),
      maxFlickStars: bt("flick"),
      maxDominoStars: bt("domino"),
    });
    setSave(next);
    writeSave(next);
  };

  const finish = () => {
    const pid = participants[0]?.id ?? "solo";
    onComplete({ rankings: [{ playerId: pid, rank: 1 }], finishedAt: new Date().toISOString() });
  };

  const nextOf = (id: string) => {
    for (const b of BOOKS)
      for (const c of b.chapters) {
        const i = c.ids.findIndex((x) => x.id === id);
        if (i >= 0) return c.ids[i + 1]?.id ?? null;
      }
    return null;
  };

  if (stageId) {
    const nxt = nextOf(stageId);
    const common = {
      bestStars: save.records[stageId]?.stars ?? 0,
      onFinish: (s: number, p: boolean) => onFinish(stageId, s, p),
      onNext: () => nxt && open(nxt),
      hasNext: !!nxt,
      onExit: () => setStageId(null),
    };
    const key = `${stageId}-${runKey}`;
    let screen: React.ReactNode = null;
    const chess = CHESS_PUZZLES.find((x) => x.id === stageId);
    const cue = CUE_STAGES.find((x) => x.id === stageId);
    const flick = FLICK_STAGES.find((x) => x.id === stageId);
    const curl = CURL_STAGES.find((x) => x.id === stageId);
    const dom = DOMINO_STAGES.find((x) => x.id === stageId);
    if (chess) screen = <ChessPuzzleScreen key={key} puzzle={chess} {...common} />;
    else if (cue) screen = <AimScreen key={key} adapter={cueAdapter} stage={cue} {...common} />;
    else if (flick) screen = <AimScreen key={key} adapter={flickAdapter} stage={flick} {...common} />;
    else if (curl) screen = <AimScreen key={key} adapter={curlAdapter} stage={curl} {...common} />;
    else if (dom) screen = <DominoScreen key={key} stage={dom} {...common} />;
    return (
      <>
        {screen}
        <div className="mt-3 flex justify-end gap-2">
          <MuteBtn muted={save.muted} onToggle={() => update((s) => ({ ...s, muted: !s.muted }))} />
          <button onClick={() => setRules(true)} className="rounded-lg bg-stone-800 px-3 py-1.5 text-sm text-stone-200">📖 규칙</button>
        </div>
        {rules && <RulebookModal onClose={() => setRules(false)} />}
      </>
    );
  }

  const book = BOOKS.find((b) => b.id === save.book) ?? BOOKS[0];
  const bookIds = book.chapters.flatMap((c) => c.ids.map((x) => x.id));
  const resume = bookIds.find((id) => isUnlocked(save, id) && !(save.records[id]?.stars ?? 0)) ?? bookIds[0];
  const resumeTitle = book.chapters.flatMap((c) => c.ids).find((x) => x.id === resume)?.title ?? "";
  const tot = totals(save);

  return (
    <div className="flex flex-col gap-4 text-stone-100">
      <div className="relative overflow-hidden rounded-2xl border border-emerald-800/50 bg-gradient-to-br from-stone-950 via-emerald-950 to-teal-700 p-5">
        <div className="pointer-events-none absolute -right-8 -top-8 h-44 w-44 rounded-full bg-emerald-300/20 blur-2xl" />
        <div className="relative">
          <div className="text-xs font-bold tracking-widest text-emerald-200">혼자 푸는 묘수풀이 모음</div>
          <h1 className="text-3xl font-black text-white drop-shadow">🥋 묘수 도장</h1>
          <p className="mt-1 max-w-xl text-sm text-emerald-50/90">체스·당구·알까기·컬링·도미노 — 익숙한 게임 속 정답이 하나뿐인 한 수를 찾으세요. 모든 문제는 솔버가 정답을 증명했어요.</p>
          <div className="mt-3 flex flex-wrap gap-2 text-sm font-bold">
            <span className="rounded-lg bg-black/35 px-2 py-1">⭐ {tot.stars} / {tot.maxStars}</span>
            <span className="rounded-lg bg-black/35 px-2 py-1">클리어 {tot.cleared} / {tot.count}</span>
            <span className="rounded-lg bg-black/35 px-2 py-1">⭐⭐⭐ {tot.perfect}</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={() => open(resume)} className="rounded-xl bg-emerald-400 px-5 py-2 font-black text-stone-900 shadow hover:bg-emerald-300">
              ▶ {book.emoji} {resume.toUpperCase()} {resumeTitle}
            </button>
            <button onClick={() => setRules(true)} className="rounded-xl bg-black/40 px-4 py-2 font-bold text-white hover:bg-black/55">📖 규칙</button>
            <MuteBtn muted={save.muted} onToggle={() => update((s) => ({ ...s, muted: !s.muted }))} />
            <button onClick={finish} className="rounded-xl bg-black/25 px-4 py-2 text-sm text-white hover:bg-black/40">기록 저장하고 나가기</button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="tablist" aria-label="문제집">
        {BOOKS.map((b) => {
          const t = totals(save, b.id);
          const on = b.id === book.id;
          return (
            <button
              key={b.id}
              role="tab"
              aria-selected={on}
              onClick={() => update((s) => ({ ...s, book: b.id }))}
              className={`rounded-xl border p-3 text-left transition ${on ? "border-emerald-400 bg-emerald-900/60" : "border-stone-800 bg-stone-900 hover:bg-stone-800"}`}
            >
              <div className="text-2xl">{b.emoji}</div>
              <div className="font-black leading-tight">{b.name}</div>
              <div className="text-xs text-stone-400">{b.engine} 엔진</div>
              <div className="mt-1 text-xs font-bold text-amber-200">
                ⭐ {t.stars}/{t.maxStars}
              </div>
            </button>
          );
        })}
      </div>

      <p className="rounded-xl bg-stone-900 p-3 text-sm text-stone-300">{book.blurb}</p>

      {book.chapters.map((c) => (
        <section key={c.title} className="rounded-2xl bg-stone-900 p-4">
          <div className="mb-2">
            <div className="text-lg font-black">
              {c.emoji} {c.title}
            </div>
            <div className="text-xs text-stone-400">{c.desc}</div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {c.ids.map((x) => {
              const rec = save.records[x.id];
              const open_ = isUnlocked(save, x.id);
              return (
                <button
                  key={x.id}
                  disabled={!open_}
                  onClick={() => open(x.id)}
                  className={`min-h-20 rounded-xl border p-2 text-left transition ${open_ ? "border-emerald-800/60 bg-stone-800 hover:-translate-y-0.5 hover:bg-stone-700" : "border-stone-800 bg-stone-950 opacity-50"}`}
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="rounded bg-emerald-500 px-1.5 font-black text-stone-900">{x.id.toUpperCase()}</span>
                    {rec?.peeked && <span title="정답을 본 문제">🔑</span>}
                  </div>
                  <div className="mt-1 text-sm font-bold">{open_ ? x.title : "🔒 잠김"}</div>
                  <div className="mt-0.5 text-xs" aria-label={`별 ${rec?.stars ?? 0}개`}>
                    {"⭐".repeat(rec?.stars ?? 0)}
                    <span className="opacity-20">{"⭐".repeat(3 - (rec?.stars ?? 0))}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      ))}
      {rules && <RulebookModal onClose={() => setRules(false)} />}
    </div>
  );
}

function MuteBtn({ muted, onToggle }: { muted: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} className="rounded-xl bg-black/40 px-3 py-1.5 text-sm text-white" aria-label={muted ? "소리 켜기" : "소리 끄기"}>
      {muted ? "🔇" : "🔊"}
    </button>
  );
}
