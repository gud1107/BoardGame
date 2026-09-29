"use client";

import { useState } from "react";
import PhotoStageCanvas from "./PhotoStageCanvas";
import ThemeSceneArt from "./ThemeSceneArt";
import { activeThemeMutationIds, findThemeScene, themeMutationForSpotId } from "./themeScenes";
import type { EffectKind, PhotoDiffSpot, Spot, SpotDifferenceState, TeamId } from "./engine";

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
          {state.stages.map((_, i) => (
            <button key={i} type="button" className={tab(i === stageIndex)} onClick={() => setStageIndex(i)}>
              스테이지 {i + 1}
            </button>
          ))}
        </div>
      )}

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
    </section>
  );
}
