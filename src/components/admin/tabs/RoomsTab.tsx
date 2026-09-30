"use client";

import { useMemo, useState } from "react";
import { getGameMeta } from "@/games/registry";
import { adminRpc, DATE_TIME, fmt, rate, type ExcludeMe } from "../adminApi";
import { Chip, Empty, ErrorNote, Loading, StatCard } from "../adminUi";
import { useAdminQuery } from "../useAdminQuery";

interface RoomRow {
  game_id: string;
  room_code: string;
  day: string;
  opened_at: string;
  host_nickname: string | null;
  players: number;
  joins: number;
  starts: number;
  ends: number;
  minutes: number | null;
  last_at: string;
}

type Status = "완료" | "시작 안 함" | "진행 중/중단";

export function roomStatus(r: Pick<RoomRow, "starts" | "ends">): Status {
  if (Number(r.starts) === 0) return "시작 안 함";
  if (Number(r.ends) >= Number(r.starts)) return "완료";
  return "진행 중/중단";
}

const STATUS_STYLE: Record<Status, string> = {
  완료: "text-emerald-300",
  "시작 안 함": "text-white/40",
  "진행 중/중단": "text-amber-300",
};

/**
 * 방 기록 tab: one row per room (game + 4-digit code + Korea day, since
 * codes get reused). Players = distinct devices that opened or joined it;
 * play time = host's first start → last end (rematches included).
 */
export default function RoomsTab({
  since,
  exclude,
  reloadKey,
}: {
  since: string | null;
  exclude: ExcludeMe | null;
  reloadKey: number;
}) {
  const [filter, setFilter] = useState<"all" | Status>("all");
  const [gameFilter, setGameFilter] = useState("");
  const { data, error } = useAdminQuery<RoomRow>(
    () => adminRpc("admin_rooms", { p_since: since }, exclude),
    JSON.stringify([since, exclude, reloadKey]),
  );

  const gameIds = useMemo(() => [...new Set((data ?? []).map((r) => r.game_id))], [data]);
  const rows = data ?? [];
  const visible = rows.filter(
    (r) => (filter === "all" || roomStatus(r) === filter) && (!gameFilter || r.game_id === gameFilter),
  );

  const started = rows.filter((r) => Number(r.starts) > 0);
  const finished = rows.filter((r) => roomStatus(r) === "완료");
  const timed = finished.filter((r) => r.minutes !== null);
  const avgMinutes = timed.length ? timed.reduce((a, r) => a + Number(r.minutes), 0) / timed.length : 0;
  const avgPlayers = rows.length ? rows.reduce((a, r) => a + Number(r.players), 0) / rows.length : 0;

  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading />;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="만들어진 방" value={fmt(rows.length)} />
        <StatCard label="게임까지 시작한 방" value={fmt(started.length)} sub={`전체의 ${rate(started.length, rows.length)}`} />
        <StatCard label="끝까지 한 방" value={fmt(finished.length)} sub={`시작한 방의 ${rate(finished.length, started.length)}`} />
        <StatCard
          label="평균 플레이 시간 · 인원"
          value={timed.length ? `${avgMinutes.toFixed(1)}분` : "—"}
          sub={`방당 평균 ${avgPlayers.toFixed(1)}명`}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(["all", "완료", "진행 중/중단", "시작 안 함"] as const).map((s) => (
          <Chip key={s} active={filter === s} onClick={() => setFilter(s)}>
            {s === "all" ? "전체" : s}
          </Chip>
        ))}
        <select
          value={gameFilter}
          onChange={(e) => setGameFilter(e.target.value)}
          className="ml-auto rounded-full border border-white/15 bg-transparent px-3 py-1 text-xs text-white/80 light:border-slate-300 light:text-slate-700"
        >
          <option value="">모든 게임</option>
          {gameIds.map((id) => (
            <option key={id} value={id}>
              {getGameMeta(id)?.name ?? id}
            </option>
          ))}
        </select>
      </div>

      {visible.length === 0 ? (
        <Empty>{rows.length === 0 ? "아직 기록된 방이 없습니다." : "조건에 맞는 방이 없습니다."}</Empty>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/10 light:border-slate-200">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="bg-white/[0.04] text-white/50 light:bg-slate-50 light:text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">게임 · 방</th>
                <th className="px-3 py-2 font-medium">열린 시각</th>
                <th className="px-3 py-2 font-medium">방장</th>
                <th className="px-3 py-2 text-right font-medium">인원</th>
                <th className="px-3 py-2 text-right font-medium">판 수</th>
                <th className="px-3 py-2 text-right font-medium">플레이 시간</th>
                <th className="px-3 py-2 font-medium">상태</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-white/80 light:divide-slate-100 light:text-slate-700">
              {visible.map((r) => {
                const status = roomStatus(r);
                return (
                  <tr key={`${r.game_id}-${r.room_code}-${r.day}`}>
                    <td className="px-3 py-2">
                      <span className="font-semibold text-white light:text-slate-900">{getGameMeta(r.game_id)?.name ?? r.game_id}</span>
                      <span className="ml-1.5 font-mono text-white/40">#{r.room_code}</span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums">{DATE_TIME.format(new Date(r.opened_at))}</td>
                    <td className="px-3 py-2">{r.host_nickname ?? <span className="text-white/40">—</span>}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(r.players)}명</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {fmt(r.starts)}
                      {Number(r.ends) > 0 && <span className="text-white/40"> (완료 {fmt(r.ends)})</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.minutes !== null ? `${Number(r.minutes).toFixed(1)}분` : "—"}</td>
                    <td className={`px-3 py-2 font-medium ${STATUS_STYLE[status]}`}>{status}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
