"use client";

import { useState } from "react";
import PhotoStageCanvas from "./PhotoStageCanvas";
import ThemeSceneArt from "./ThemeSceneArt";
import { activeThemeMutationIds, findThemeScene, themeMutationForSpotId } from "./themeScenes";
import { sameAnswerIndex, stageKind, type EffectKind, type PhotoDiffSpot, type Spot, type SpotDifferenceState, type TeamId } from "./engine";
import { STAGE_KIND_META } from "./bonusRounds";

const EFFECT_LABEL: Record<EffectKind, string> = {
  hue: "색조 변경",
  invert: "색상 반전",
  blur: "흐림",
  mosaic: "모자이크",
  mirror: "좌우 반전",
  tint: "색 덧칠",
  grayscale: "흑백",
};

const TEAM_MARK: Record<TeamId, { label: string; ring: string; chip: string }> = {
  A: { label: "팀 A", ring: "border-sky-400", chip: "bg-sky-500/20 text-sky-200 light:bg-sky-100 light:text-sky-700" },
  B: { label: "팀 B", ring: "border-rose-400", chip: "bg-rose-500/20 text-rose-200 light:bg-rose-100 light:text-rose-700" },
};

function spotName(state: SpotDifferenceState, spot: Spot): string {
  if (state.source.kind === "photo") return EFFECT_LABEL[(spot as PhotoDiffSpot).effect] ?? "변형";
  return themeMutationForSpotId(spot.id)?.name ?? "바뀐 곳";
}

/**
 * End-of-match answer sheet ("이번에 바뀐 곳"): per stage, the picture with
 * every difference numbered — solid team-colored ring if found, dashed amber
 * if nobody found it — plus a numbered list of what changed and who found
 * it. An 원본/바뀐 그림 toggle flips the picture to compare.
 */
export default function DiffRevealPanel({ state }: { state: SpotDifferenceState }) {
  // Open on the stage the match ended on — where any unfound spots are.
  const [stageIndex, setStageIndex] = useState(() => state.currentStageIndex);
  const [variant, setVariant] = useState<"original" | "modified">("modified");
  const stage = state.stages[stageIndex];
  if (!stage) return null;
  const sceneId = state.builtinSceneIds[stageIndex];
  const theme = sceneId ? findThemeScene(sceneId) : undefined;
  const spotIds = stage.spots.map((s) => s.id);
  const kind = stageKind(stage);

  const tab = (on: boolean) =>
    `rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
      on
        ? "border-amber-400/80 bg-amber-400/15 text-amber-200 light:border-amber-500 light:bg-amber-50 light:text-amber-700"
        : "border-white/15 text-white/50 hover:border-white/30 light:border-slate-300 light:text-slate-500"
    }`;

  return (
    <section className="w-full max-w-xl text-left">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-white light:text-slate-900">
          🔎 이번에 바뀐 곳{theme ? <span className="ml-1.5 text-xs font-medium text-white/50 light:text-slate-500">· {theme.name}</span> : null}
        </h3>
        <div className="flex gap-1">
          <button type="button" className={tab(variant === "original")} onClick={() => setVariant("original")}>
            원본
          </button>
          <button type="button" className={tab(variant === "modified")} onClick={() => setVariant("modified")}>
            바뀐 그림
          </button>
        </div>
      </div>

      {state.stages.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {state.stages.map((st, i) => {
            const k = stageKind(st);
            return (
              <button key={i} type="button" className={tab(i === stageIndex)} onClick={() => setStageIndex(i)}>
                {k === "classic" ? `스테이지 ${i + 1}` : `${i + 1}. ${STAGE_KIND_META[k].emoji} ${STAGE_KIND_META[k].label}`}
              </button>
            );
          })}
        </div>
      )}

      {kind === "same" && theme ? (
        <SameReveal state={state} stageIndex={stageIndex} themeId={theme.id} />
      ) : (
      <>
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-white/10 light:border-slate-300">
        {state.source.kind === "photo" ? (
          <PhotoStageCanvas imageDataUrl={state.source.imageDataUrl} spots={stage.spots as PhotoDiffSpot[]} variant={variant} className="h-full w-full object-contain" />
        ) : theme ? (
          <ThemeSceneArt themeId={theme.id} active={variant === "modified" ? activeThemeMutationIds(theme.id, spotIds) : new Set()} className="h-full w-full" />
        ) : null}
        {stage.spots.map((s, i) => {
          const team = stage.foundBy[s.id];
          return (
            <div
              key={s.id}
              className={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] ${team ? TEAM_MARK[team].ring : "animate-pulse border-dashed border-amber-300"}`}
              style={{ left: `${s.xPct}%`, top: `${s.yPct}%`, width: `${s.rPct * 2}%`, height: `${s.rPct * 2}%` }}
            >
              <span className="absolute -top-2 -right-2 flex h-4 w-4 items-center justify-center rounded-full bg-black/80 text-[10px] font-bold text-white">{i + 1}</span>
            </div>
          );
        })}
      </div>

      <ol className="mt-2 grid gap-1 sm:grid-cols-2">
        {stage.spots.map((s, i) => {
          const team = stage.foundBy[s.id];
          return (
            <li key={s.id} className="flex items-center gap-2 rounded-lg bg-white/[0.04] px-2 py-1 text-xs light:bg-slate-50">
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-black/70 text-[10px] font-bold text-white">{i + 1}</span>
              <span className="flex-1 text-white/80 light:text-slate-700">{spotName(state, s)}</span>
              {team ? (
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${TEAM_MARK[team].chip}`}>{TEAM_MARK[team].label} 발견</span>
              ) : (
                <span className="rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200 light:bg-amber-50 light:text-amber-700">못 찾음</span>
              )}
            </li>
          );
        })}
      </ol>
      </>
      )}
    </section>
  );
}

/** 🔍 round answer: every candidate with the identical one starred and each decoy's changes named. */
function SameReveal({ state, stageIndex, themeId }: { state: SpotDifferenceState; stageIndex: number; themeId: string }) {
  const stage = state.stages[stageIndex];
  const answer = sameAnswerIndex(stage);
  const winner = stage.foundBy[stage.spots[0]?.id ?? ""];
  const theme = findThemeScene(themeId);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-white/60 light:text-slate-600">
        정답은 {answer + 1}번 —{" "}
        {winner ? <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${TEAM_MARK[winner].chip}`}>{TEAM_MARK[winner].label} 정답</span> : "아무도 못 맞혔어요"}
      </p>
      <div className="grid grid-cols-2 gap-2">
        {(stage.candidates ?? []).map((mutations, i) => (
          <div key={i} className={`overflow-hidden rounded-xl border-2 ${i === answer ? "border-emerald-400" : "border-white/10 light:border-slate-300"}`}>
            <div className="relative aspect-[4/3]">
              <ThemeSceneArt themeId={themeId} active={new Set(mutations)} className="h-full w-full" />
              <span className="absolute left-1 top-1 rounded-full bg-black/75 px-1.5 text-[11px] font-bold text-white">
                {i + 1}
                {i === answer ? " ⭐ 똑같음" : ""}
              </span>
            </div>
            {i !== answer && (
              <p className="bg-white/[0.04] px-2 py-1 text-[10px] text-white/60 light:bg-slate-50 light:text-slate-600">
                {mutations.map((id) => theme?.mutations.find((m) => m.id === id)?.name ?? id).join(" · ")}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
