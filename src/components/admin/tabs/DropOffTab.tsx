"use client";

import { useMemo } from "react";
import { getGameMeta } from "@/games/registry";
import { adminRpc, fmt, rate, type ExcludeMe } from "../adminApi";
import { ErrorNote, Loading, Panel } from "../adminUi";
import { useAdminQuery } from "../useAdminQuery";
import { withAllGames, type FunnelRow } from "./GamesTab";

// Ordinal blue steps (dataviz palette) — the later the stage, the deeper the blue.
const STAGE_COLORS = ["#86b6ef", "#3987e5", "#1c5cab"];

const STAGES = [
  { key: "hub_clicks", label: "허브 클릭" },
  { key: "room_creates", label: "방 만들기" },
  { key: "game_starts", label: "게임 시작" },
] as const;

interface GameDrop {
  gameId: string;
  values: number[];
  /** Index of the step (1 = click→room, 2 = room→start) that loses the most, or -1. */
  worstStep: number;
  worstLossPct: number;
}

/** Which step loses the largest share of the people who reached it. */
export function analyzeDrop(values: number[]): { worstStep: number; worstLossPct: number } {
  let worstStep = -1;
  let worstLossPct = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i - 1] <= 0) continue;
    const loss = Math.max(0, 1 - values[i] / values[i - 1]);
    if (loss > worstLossPct) {
      worstLossPct = loss;
      worstStep = i;
    }
  }
  return { worstStep, worstLossPct };
}

/**
 * 이탈 분석 tab: for each game, how many of the people who clicked its card
 * went on to open a room and then actually start. Bars are scaled to the
 * game's own click count; the step losing the most people is called out.
 */
export default function DropOffTab({
  since,
  exclude,
  reloadKey,
}: {
  since: string | null;
  exclude: ExcludeMe | null;
  reloadKey: number;
}) {
  const { data, error } = useAdminQuery<FunnelRow>(
    () => adminRpc("admin_game_funnel", { p_since: since }, exclude),
    JSON.stringify([since, exclude, reloadKey]),
  );

  const games: GameDrop[] = useMemo(
    () =>
      withAllGames(data)
        .filter((r) => Number(r.hub_clicks) > 0 || Number(r.room_creates) > 0 || Number(r.game_starts) > 0)
        .map((r) => {
          const values = STAGES.map((s) => Number(r[s.key]));
          return { gameId: r.game_id, values, ...analyzeDrop(values) };
        })
        .sort((a, b) => b.values[0] - a.values[0]),
    [data],
  );

  const total = STAGES.map((s) => (data ?? []).reduce((a, r) => a + Number(r[s.key]), 0));
  const totalDrop = analyzeDrop(total);

  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading />;

  return (
    <div className="flex flex-col gap-4">
      <Panel title="전체 흐름" note="허브에서 게임을 누른 뒤 방을 만들고, 실제로 시작하기까지">
        <FunnelBars values={total} />
        {totalDrop.worstStep > 0 && (
          <p className="mt-3 text-sm text-white/80 light:text-slate-700">
            가장 많이 빠지는 구간:{" "}
            <span className="font-semibold text-amber-300 light:text-amber-700">
              {STAGES[totalDrop.worstStep - 1].label} → {STAGES[totalDrop.worstStep].label} ({Math.round(totalDrop.worstLossPct * 100)}% 이탈)
            </span>
          </p>
        )}
      </Panel>

      <div className="flex flex-wrap items-center gap-3 text-xs text-white/50 light:text-slate-500">
        {STAGES.map((s, i) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: STAGE_COLORS[i] }} />
            {s.label}
          </span>
        ))}
      </div>

      {games.length === 0 ? (
        <p className="py-8 text-center text-sm text-white/40">아직 기록이 없습니다.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {games.map((g) => (
            <Panel key={g.gameId} title={getGameMeta(g.gameId)?.name ?? g.gameId}>
              <FunnelBars values={g.values} />
              {g.worstStep > 0 && (
                <p className="mt-2 text-xs text-white/60 light:text-slate-600">
                  ⚠️ {STAGES[g.worstStep - 1].label} → {STAGES[g.worstStep].label}에서 {Math.round(g.worstLossPct * 100)}% 이탈
                </p>
              )}
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}

function FunnelBars({ values }: { values: number[] }) {
  const top = Math.max(values[0], ...values, 1);
  return (
    <div className="flex flex-col gap-1.5">
      {STAGES.map((s, i) => (
        <div key={s.key} className="grid grid-cols-[64px_1fr_92px] items-center gap-2 text-xs">
          <span className="text-white/60 light:text-slate-600">{s.label}</span>
          <div className="h-3 rounded-r-[4px] bg-white/5 light:bg-slate-100">
            <div
              className="h-3 rounded-r-[4px]"
              style={{ width: `${(values[i] / top) * 100}%`, backgroundColor: STAGE_COLORS[i], minWidth: values[i] ? 2 : 0 }}
              title={`${s.label}: ${fmt(values[i])}`}
            />
          </div>
          <span className="text-right tabular-nums text-white/80 light:text-slate-700">
            {fmt(values[i])}
            {i > 0 && <span className="ml-1 text-white/40">{rate(values[i], values[i - 1])}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}
