"use client";

/**
 * AI 감별 테스트 (/doodle-lab) — real people draw 10 words, the 그림 전화기
 * bot guesses each one, and the page tallies how often it is right, hedges,
 * or is confidently wrong (the number that matters: a wrong guess said
 * without hedging). Records stay in this browser; "결과 파일 저장" exports
 * them with the drawings so the recogniser can be re-tuned on real sketches.
 */

import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import DoodleCanvas, { type DoodleCanvasHandle } from "./DoodleCanvas";
import { explainGuess, type GuessExplained } from "./bot";
import { josa } from "./promptGen";
import type { Drawing } from "./drawing";

const WORDS = ["강아지", "고양이", "자동차", "집", "나무", "물고기", "비행기", "우산", "꽃", "로켓"] as const;
const STORAGE_KEY = "doodle-lab-v1";
/** Goal from the playtest note: confidently wrong at most this often. */
const WRONG_SURE_GOAL = 0.05;

type Verdict = "correct" | "wrongSure" | "hedgeRight" | "hedgeWrong" | "fallback";

interface LabRecord {
  tester: string;
  word: string;
  text: string;
  kind: GuessExplained["kind"];
  verdict: Verdict;
  at: string;
  drawing: Drawing;
}

const VERDICT_INFO: Record<Verdict, { label: string; tone: string }> = {
  correct: { label: "✅ 정답", tone: "bg-emerald-500/20 text-emerald-200 light:bg-emerald-100 light:text-emerald-800" },
  wrongSure: { label: "❌ 자신 있게 틀림", tone: "bg-rose-500/20 text-rose-200 light:bg-rose-100 light:text-rose-800" },
  hedgeRight: { label: "🤔 얼버무렸지만 맞음", tone: "bg-sky-500/20 text-sky-200 light:bg-sky-100 light:text-sky-800" },
  hedgeWrong: { label: "🤔 얼버무리고 틀림", tone: "bg-amber-500/20 text-amber-200 light:bg-amber-100 light:text-amber-800" },
  fallback: { label: "🎨 모름 (색깔로 찍음)", tone: "bg-white/10 text-white/70 light:bg-slate-100 light:text-slate-600" },
};

function verdictOf(word: string, guess: GuessExplained): Verdict {
  const hit = guess.names.includes(word);
  if (guess.kind === "sure") return hit ? "correct" : "wrongSure";
  if (guess.kind === "hunch") return hit ? "hedgeRight" : "hedgeWrong";
  return "fallback";
}

function shuffledWords(): string[] {
  const out: string[] = [...WORDS];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const NO_RECORDS: LabRecord[] = [];
let cached: { raw: string | null; records: LabRecord[] } = { raw: null, records: NO_RECORDS };

/** Saved records, read through useSyncExternalStore (empty on the server) — same array back while storage is unchanged. */
function readStored(): LabRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== cached.raw) cached = { raw, records: raw ? (JSON.parse(raw) as LabRecord[]) : NO_RECORDS };
    return cached.records;
  } catch {
    return NO_RECORDS;
  }
}

const noopSubscribe = () => () => {};

function saveRecords(records: LabRecord[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    // storage full or blocked — the session still works, it just isn't kept
  }
}

const pct = (n: number, total: number) => (total === 0 ? "–" : `${Math.round((n / total) * 100)}%`);

export default function DoodleLab() {
  const stored = useSyncExternalStore(noopSubscribe, readStored, () => NO_RECORDS);
  const [edited, setRecords] = useState<LabRecord[] | null>(null);
  const records = edited ?? stored;
  const [tester, setTester] = useState("");
  const [order, setOrder] = useState<string[] | null>(null);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState<LabRecord | null>(null);
  const [canvasKey, setCanvasKey] = useState(0);
  const canvasRef = useRef<DoodleCanvasHandle | null>(null);

  const word = order?.[index] ?? null;
  const done = order !== null && index >= order.length;

  const showAi = () => {
    if (!word || !canvasRef.current) return;
    const drawing = canvasRef.current.getDrawing();
    const guess = explainGuess(drawing, Math.random, Math.floor(Math.random() * 3));
    const record: LabRecord = { tester: tester.trim() || "익명", word, text: guess.text, kind: guess.kind, verdict: verdictOf(word, guess), at: new Date().toISOString(), drawing };
    const next = [...records, record];
    setRecords(next);
    saveRecords(next);
    setAnswer(record);
  };

  const nextWord = () => {
    setAnswer(null);
    setIndex((i) => i + 1);
    setCanvasKey((k) => k + 1);
  };

  const start = () => {
    setOrder(shuffledWords());
    setIndex(0);
    setAnswer(null);
    setCanvasKey((k) => k + 1);
  };

  const download = () => {
    const blob = new Blob([JSON.stringify(records)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `doodle-lab-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const reset = () => {
    if (!window.confirm("이 기기에 저장된 테스트 기록을 모두 지울까요?")) return;
    setRecords([]);
    saveRecords([]);
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-8 sm:px-6">
      <header>
        <h1 className="text-2xl font-bold text-white light:text-slate-900">🧪 AI 감별 테스트 · 그림 전화기</h1>
        <p className="mt-1 text-sm text-white/60 light:text-slate-600">
          단어 10개를 하나씩 그리면 게임 속 AI가 맞혀 봅니다. 평소 게임하듯 <b>검은 펜</b>으로 대충 그려 주세요. 기록은 이
          브라우저에만 저장되고, 아래 &lsquo;결과 파일 저장&rsquo;으로 내보낼 수 있어요.
        </p>
      </header>

      <Summary records={records} />

      {order === null || done ? (
        <section className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/5 p-4 light:border-slate-200 light:bg-white">
          {done && <p className="font-semibold text-white light:text-slate-900">🎉 10개 끝! 다른 사람도 이어서 해 볼 수 있어요.</p>}
          <label className="flex flex-col gap-1 text-sm text-white/70 light:text-slate-600">
            그리는 사람 이름 (선택)
            <input
              value={tester}
              onChange={(e) => setTester(e.target.value)}
              maxLength={20}
              placeholder="예: 민수"
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white placeholder:text-white/30 focus:border-fuchsia-400 focus:outline-none light:border-slate-300 light:bg-white light:text-slate-900"
            />
          </label>
          <button onClick={start} className="min-h-11 rounded-lg bg-fuchsia-500 px-4 py-2 font-semibold text-white hover:bg-fuchsia-400">
            {done ? "▶ 다음 사람 시작" : "▶ 테스트 시작"}
          </button>
        </section>
      ) : (
        <section className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <p className="text-lg text-white light:text-slate-900">
              <span className="text-white/50 light:text-slate-500">
                {index + 1}/{order.length} ·{" "}
              </span>
              <b className="text-2xl">{word}</b>
              {josa(word ?? "", "을", "를").slice((word ?? "").length)} 그려 주세요
            </p>
          </div>
          <DoodleCanvas key={canvasKey} ref={canvasRef} disabled={answer !== null} />
          {answer ? (
            <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/5 p-4 light:border-slate-200 light:bg-white">
              <p className="text-white light:text-slate-900">
                🤖 AI: <b className="text-lg">&ldquo;{answer.text}&rdquo;</b>
              </p>
              <span className={`w-fit rounded-full px-3 py-1 text-sm font-semibold ${VERDICT_INFO[answer.verdict].tone}`}>{VERDICT_INFO[answer.verdict].label}</span>
              <button onClick={nextWord} className="min-h-11 rounded-lg bg-fuchsia-500 px-4 py-2 font-semibold text-white hover:bg-fuchsia-400">
                {index + 1 < order.length ? "다음 단어 →" : "결과 보기"}
              </button>
            </div>
          ) : (
            <button onClick={showAi} className="min-h-11 rounded-lg bg-fuchsia-500 px-4 py-2 font-semibold text-white hover:bg-fuchsia-400">
              🤖 AI에게 보여주기
            </button>
          )}
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        <button onClick={download} disabled={records.length === 0} className="min-h-11 rounded-lg border border-white/15 px-4 py-2 text-sm text-white/80 hover:bg-white/10 disabled:opacity-40 light:border-slate-300 light:text-slate-700 light:hover:bg-slate-100">
          💾 결과 파일 저장 (그림 포함)
        </button>
        <button onClick={reset} disabled={records.length === 0} className="min-h-11 rounded-lg border border-white/15 px-4 py-2 text-sm text-white/60 hover:bg-white/10 disabled:opacity-40 light:border-slate-300 light:text-slate-500 light:hover:bg-slate-100">
          🗑️ 기록 지우기
        </button>
      </div>
    </div>
  );
}

function Summary({ records }: { records: readonly LabRecord[] }) {
  const counts = useMemo(() => {
    const c: Record<Verdict, number> = { correct: 0, wrongSure: 0, hedgeRight: 0, hedgeWrong: 0, fallback: 0 };
    for (const r of records) c[r.verdict]++;
    return c;
  }, [records]);
  const byWord = useMemo(
    () =>
      WORDS.map((w) => {
        const rs = records.filter((r) => r.word === w);
        return { word: w, total: rs.length, correct: rs.filter((r) => r.verdict === "correct").length, wrongSure: rs.filter((r) => r.verdict === "wrongSure").length };
      }),
    [records],
  );
  const total = records.length;
  const testers = new Set(records.map((r) => r.tester)).size;
  const wrongRate = total === 0 ? 0 : counts.wrongSure / total;

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/5 p-4 light:border-slate-200 light:bg-white">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold text-white light:text-slate-900">📊 지금까지 결과</h2>
        <span className="text-xs text-white/50 light:text-slate-500">
          그림 {total}장 · {testers}명
        </span>
      </div>
      <p className="text-sm text-white/80 light:text-slate-700">
        자신 있게 틀린 비율{" "}
        <b className={total > 0 && wrongRate > WRONG_SURE_GOAL ? "text-rose-300 light:text-rose-700" : "text-emerald-300 light:text-emerald-700"}>{pct(counts.wrongSure, total)}</b>{" "}
        <span className="text-white/50 light:text-slate-500">(목표 {WRONG_SURE_GOAL * 100}% 이하)</span>
      </p>
      <ul className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
        {(Object.keys(VERDICT_INFO) as Verdict[]).map((v) => (
          <li key={v} className="flex justify-between gap-2 text-white/70 light:text-slate-600">
            <span>{VERDICT_INFO[v].label}</span>
            <span className="tabular-nums">
              {counts[v]} ({pct(counts[v], total)})
            </span>
          </li>
        ))}
      </ul>
      {total > 0 && (
        <details className="text-sm text-white/70 light:text-slate-600">
          <summary className="cursor-pointer">단어별 보기</summary>
          <table className="mt-2 w-full text-left tabular-nums">
            <thead>
              <tr className="text-white/50 light:text-slate-500">
                <th className="font-normal">단어</th>
                <th className="font-normal">그림</th>
                <th className="font-normal">정답</th>
                <th className="font-normal">자신 있게 틀림</th>
              </tr>
            </thead>
            <tbody>
              {byWord.map((w) => (
                <tr key={w.word}>
                  <td>{w.word}</td>
                  <td>{w.total}</td>
                  <td>{w.correct}</td>
                  <td>{w.wrongSure}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}
