"use client";

import { useState } from "react";
import { drawingToPngDataUrl } from "./drawingRenderer";
import Flipbook from "./Flipbook";
import { MODES, icebreakerQuestion, themeApplies } from "./modes";
import { THEME_INFO } from "./themes";
import PageCard from "./PageCard";
import { REACTION_EMOJIS, albumDrawings, computeRankings, pageAt, pageKey, votesFor, type DoodlePhoneState, type Page, type SeatIndex } from "./engine";

const MEDALS = ["🥇", "🥈", "🥉"];

/** GAME_OVER — "웃음왕" leaderboard plus a browser over every finished album. */
export default function ResultsStage({
  state,
  viewerSeat,
  names,
  isHost,
  onRematch,
  onLeave,
}: {
  state: DoodlePhoneState;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  isHost: boolean;
  onRematch: () => void;
  onLeave: () => void;
}) {
  const [album, setAlbum] = useState(viewerSeat);
  const rankings = computeRankings(state);
  const { mode } = state.options;
  const scoring = mode === "SCORE";

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-2xl border border-amber-300/30 bg-gradient-to-br from-amber-400/15 via-fuchsia-500/10 to-transparent p-5 light:border-amber-200 light:from-amber-50 light:via-fuchsia-50">
        <h2 className="text-center text-lg font-extrabold text-white light:text-slate-900">
          {scoring ? "🏆 최다 득표 — 최고의 장면 투표 결과" : "🏆 웃음왕 — 리액션을 가장 많이 받은 사람"}
        </h2>
        <p className="mt-1 text-center text-xs text-white/50 light:text-slate-500">
          {MODES[mode].icon} {MODES[mode].title} 모드
          {themeApplies(state.options) && ` × ${THEME_INFO[state.options.theme].icon} ${THEME_INFO[state.options.theme].name} 테마`}
        </p>
        <ol className="mt-3 flex flex-col gap-1.5">
          {rankings.map(({ seat, rank, score }) => (
            <li
              key={seat}
              className={`flex items-center justify-between rounded-xl px-3 py-2 text-sm ${
                rank === 1 ? "bg-amber-400/20 font-bold text-amber-100 light:bg-amber-100 light:text-amber-800" : "bg-white/5 text-white/80 light:bg-white light:text-slate-700"
              }`}
            >
              <span>
                {MEDALS[rank - 1] ?? `${rank}위`} {names[seat]}
                {seat === viewerSeat && " (나)"}
              </span>
              <span className="tabular-nums">
                {score}
                {scoring ? "표" : "개"}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-bold text-white/80 light:text-slate-700">📚 앨범 다시 보기</h3>
        <div className="flex flex-wrap gap-1.5">
          {Array.from({ length: state.playerCount }, (_, a) => (
            <button
              key={a}
              type="button"
              aria-pressed={album === a}
              onClick={() => setAlbum(a)}
              className={`rounded-full border px-3 py-1 text-xs transition ${
                album === a ? "border-fuchsia-400 bg-fuchsia-500/20 font-semibold text-white light:text-fuchsia-800" : "border-white/15 text-white/60 hover:border-white/30 light:border-slate-300 light:text-slate-600"
              }`}
            >
              {names[a]}
            </button>
          ))}
        </div>
        {mode === "ICEBREAKER" && <p className="text-sm text-cyan-100 light:text-cyan-700">💡 질문: {icebreakerQuestion(state.seed, album)}</p>}
        {mode === "ANIMATION" && <Flipbook key={album} frames={albumDrawings(state, album)} title={`🎞️ ${names[album]}님의 앨범 애니메이션`} />}
        <div className="flex flex-col gap-3">
          {Array.from({ length: state.playerCount }, (_, i) => {
            const turn = i + 1;
            const page = pageAt(state, album, turn);
            return (
              <PageCard
                key={pageKey(album, turn)}
                page={page}
                turn={turn}
                authorName={page ? names[page.author] : "…"}
                footer={
                  <PageFooter
                    page={page}
                    tally={state.reactions[pageKey(album, turn)]}
                    votes={scoring ? votesFor(state, album, turn) : 0}
                    fileName={`낙서릴레이_${names[album]}_${turn}.png`}
                  />
                }
              />
            );
          })}
        </div>
      </section>

      <div className="flex flex-wrap justify-center gap-2">
        <button type="button" onClick={onLeave} className="rounded-xl border border-white/15 px-5 py-2.5 text-sm text-white/70 hover:border-white/30 light:border-slate-300 light:text-slate-600">
          나가기
        </button>
        {isHost ? (
          <button type="button" onClick={onRematch} className="rounded-xl bg-fuchsia-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-fuchsia-500">
            🔁 같은 멤버로 다시하기
          </button>
        ) : (
          <p className="self-center text-xs text-white/50 light:text-slate-500">방장이 다시하기를 누르면 새 게임이 시작돼요.</p>
        )}
      </div>
    </div>
  );
}

function PageFooter({ page, tally, votes, fileName }: { page: Page | null; tally: DoodlePhoneState["reactions"][string] | undefined; votes: number; fileName: string }) {
  const counts = REACTION_EMOJIS.filter((e) => (tally?.[e] ?? 0) > 0);
  if (counts.length === 0 && votes === 0 && page?.kind !== "drawing") return null;
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="flex flex-wrap gap-2 text-white/70 light:text-slate-600">
        {votes > 0 && <span className="font-bold text-amber-200 light:text-amber-700">🏆 {votes}표</span>}
        {counts.map((e) => (
          <span key={e}>
            {e} {tally?.[e]}
          </span>
        ))}
      </span>
      {page?.kind === "drawing" && (
        <button
          type="button"
          onClick={() => {
            const link = document.createElement("a");
            link.href = drawingToPngDataUrl(page.drawing);
            link.download = fileName;
            link.click();
          }}
          className="rounded-lg border border-white/15 px-2.5 py-1 text-xs text-white/70 hover:border-white/30 light:border-slate-300 light:text-slate-600"
        >
          💾 그림 저장
        </button>
      )}
    </div>
  );
}
