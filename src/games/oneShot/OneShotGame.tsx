"use client";

import { useState } from "react";
import type { PlayableGameProps } from "../types";
import { trackGameEvent } from "@/lib/analytics/gameEvents";
import { recordSoloRun } from "@/lib/stats/soloResult";
import { CHAPTERS, STAGES } from "./stages";
import StageScreen, { type StageResult } from "./StageScreen";
import RulebookModal from "./RulebookModal";
import { applyRun, freshSave, isUnlocked, loadSave, totals, writeSave, type OneShotSave } from "./save";

/**
 * 한 발의 묘수 — solo timing puzzle book. 메뉴(챕터·스테이지) → StageScreen.
 * Every finished attempt is saved locally and to /stats right away; the
 * shared game page only hears about it on "기록 저장하고 나가기".
 */
export default function OneShotGame({ participants, onComplete }: PlayableGameProps) {
  const [save, setSave] = useState<OneShotSave>(() => (typeof window === "undefined" ? freshSave() : loadSave()));
  const [stageId, setStageId] = useState<string | null>(null);
  const [runKey, setRunKey] = useState(0);
  const [rules, setRules] = useState(false);

  const update = (fn: (s: OneShotSave) => OneShotSave) => {
    setSave((prev) => {
      const next = fn(prev);
      writeSave(next);
      return next;
    });
  };

  const open = (id: string) => {
    trackGameEvent("one-shot", "game_start", { isHost: true });
    setStageId(id);
    setRunKey((k) => k + 1);
    update((s) => ({ ...s, lastStage: id }));
  };

  const onFinish = (id: string, r: StageResult) => {
    const next = applyRun(save, id, r.stars, r.bullets, r.myosu, r.ghost);
    const tot = totals(next);
    recordSoloRun("one-shot", {
      attempts: 1,
      clears: r.won ? 1 : 0,
      liveClears: r.won && r.live ? 1 : 0,
      threeStars: r.stars === 3 ? 1 : 0,
      hostageFails: r.outcome === "fail-hostage" ? 1 : 0,
      maxStars: tot.stars,
      maxCleared: tot.cleared,
      maxMyosu: tot.myosu,
    });
    setSave(next);
    writeSave(next);
  };

  const finish = () => {
    const pid = participants[0]?.id ?? "solo";
    onComplete({ rankings: [{ playerId: pid, rank: 1 }], finishedAt: new Date().toISOString() });
  };

  const tot = totals(save);
  const stage = stageId ? STAGES.find((x) => x.id === stageId) : undefined;

  if (stage) {
    const i = STAGES.indexOf(stage);
    const next = STAGES[i + 1];
    return (
      <>
        <StageScreen
          key={`${stage.id}-${runKey}`}
          stage={stage}
          record={save.records[stage.id]}
          live={save.live}
          muted={save.muted}
          hasNext={!!next}
          onLiveChange={(live) => update((s) => ({ ...s, live }))}
          onToggleMute={() => update((s) => ({ ...s, muted: !s.muted }))}
          onFinish={(r) => onFinish(stage.id, r)}
          onNext={() => next && open(next.id)}
          onExit={() => setStageId(null)}
        />
        <div className="mt-3 flex justify-end">
          <button onClick={() => setRules(true)} className="rounded-lg bg-stone-800 px-3 py-1.5 text-sm text-stone-200">📖 규칙</button>
        </div>
        {rules && <RulebookModal onClose={() => setRules(false)} />}
      </>
    );
  }

  const resume = STAGES.find((x) => isUnlocked(save, x.id) && !(save.records[x.id]?.stars ?? 0)) ?? STAGES.find((x) => x.id === save.lastStage) ?? STAGES[0];

  return (
    <div className="flex flex-col gap-4 text-stone-100">
      <div className="relative overflow-hidden rounded-2xl border border-amber-800/50 bg-gradient-to-br from-purple-950 via-orange-800 to-amber-500 p-5">
        <div className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-yellow-200/30 blur-2xl" />
        <div className="relative">
          <div className="text-xs font-bold tracking-widest text-amber-200">혼자 푸는 타이밍 사격 퍼즐</div>
          <h1 className="text-3xl font-black drop-shadow">🎯 한 발의 묘수</h1>
          <p className="mt-1 max-w-xl text-sm text-amber-50/90">장면은 매번 똑같이 움직여요. 시간을 멈추고 읽은 다음, 바로 그 순간에 쏘세요. 철판 도탄, 밧줄과 샹들리에, 화약통 연쇄까지.</p>
          <div className="mt-3 flex flex-wrap gap-2 text-sm font-bold">
            <span className="rounded-lg bg-black/35 px-2 py-1">⭐ {tot.stars} / {tot.maxStars}</span>
            <span className="rounded-lg bg-black/35 px-2 py-1">클리어 {tot.cleared} / {STAGES.length}</span>
            <span className="rounded-lg bg-black/35 px-2 py-1">💎 묘수 {tot.myosu} / {tot.myosuStages}</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={() => open(resume.id)} className="rounded-xl bg-amber-400 px-5 py-2 font-black text-stone-900 shadow hover:bg-amber-300">▶ {resume.id} {resume.title}</button>
            <button onClick={() => setRules(true)} className="rounded-xl bg-black/40 px-4 py-2 font-bold hover:bg-black/55">📖 규칙</button>
            <button onClick={finish} className="rounded-xl bg-black/25 px-4 py-2 text-sm hover:bg-black/40">기록 저장하고 나가기</button>
          </div>
        </div>
      </div>

      {CHAPTERS.map((c) => (
        <section key={c.n} className="rounded-2xl bg-stone-900 p-4">
          <div className="mb-2">
            <div className="text-lg font-black">
              {c.emoji} {c.n}장 · {c.title}
            </div>
            <div className="text-xs text-stone-400">{c.desc}</div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {STAGES.filter((x) => x.chapter === c.n).map((x) => {
              const rec = save.records[x.id];
              const open_ = isUnlocked(save, x.id);
              return (
                <button
                  key={x.id}
                  disabled={!open_}
                  onClick={() => open(x.id)}
                  className={`min-h-20 rounded-xl border p-2 text-left transition ${open_ ? "border-amber-800/60 bg-stone-800 hover:-translate-y-0.5 hover:bg-stone-700" : "border-stone-800 bg-stone-950 opacity-50"}`}
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="rounded bg-amber-500 px-1.5 font-black text-stone-900">{x.id}</span>
                    {x.myosu !== undefined && <span title={rec?.myosu ? "묘수 발견" : "숨은 묘수가 있어요"} className={rec?.myosu ? "" : "opacity-40 grayscale"}>💎</span>}
                  </div>
                  <div className="mt-1 text-sm font-bold">{open_ ? x.title : "🔒 잠김"}</div>
                  <div className="mt-0.5 text-xs" aria-label={`별 ${rec?.stars ?? 0}개`}>
                    {"⭐".repeat(rec?.stars ?? 0)}
                    <span className="opacity-20">{"⭐".repeat(3 - (rec?.stars ?? 0))}</span>
                    {rec && rec.stars > 0 && <span className="ml-1 text-stone-400">{rec.bullets}발</span>}
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
