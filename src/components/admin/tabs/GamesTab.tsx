"use client";

import { Fragment, useMemo, useState } from "react";
import { GAME_REGISTRY, getGameMeta } from "@/games/registry";
import { computeDuplicateFlags, isSuspectedDuplicate } from "@/lib/analytics/duplicateFlags";
import { adminRpc, DATE_TIME, fmt, rate, type ExcludeMe, type IpLabelMap } from "../adminApi";
import { Chip, ErrorNote, Loading, StatCard } from "../adminUi";
import { useAdminQuery } from "../useAdminQuery";

export interface FunnelRow {
  game_id: string;
  hub_clicks: number;
  room_creates: number;
  invite_clicks: number;
  joins: number;
  game_starts: number;
  game_ends?: number;
  unique_devices: number;
  unique_ips: number;
}

interface ParticipantRow {
  device_id: string;
  nicknames: string[];
  ip_hashes: string[];
  /** hash → raw IP, only for events recorded after the raw IP started being stored. */
  ip_map: Record<string, string> | null;
  hub_clicks: number;
  room_creates: number;
  invite_clicks: number;
  joins: number;
  game_starts: number;
  first_at: string;
  last_at: string;
  device_type: string | null;
  os: string | null;
  browser: string | null;
}

const METRICS: { key: "hub_clicks" | "room_creates" | "invite_clicks" | "joins" | "game_starts"; label: string; hint: string }[] = [
  { key: "hub_clicks", label: "허브 클릭", hint: "보드게임 허브에서 게임 카드를 누른 횟수" },
  { key: "room_creates", label: "방 만들기", hint: "게임에 들어가 실제로 방을 연 횟수" },
  { key: "invite_clicks", label: "초대코드 클릭", hint: "'초대 코드로 참여' 버튼을 누른 횟수" },
  { key: "joins", label: "참여", hint: "다른 사람 방에 실제로 들어간 횟수" },
  { key: "game_starts", label: "게임 시작", hint: "방장이 실제로 게임을 시작한 횟수 (혼자 하는 게임은 매 판)" },
];

const gameName = (id: string) => getGameMeta(id)?.name ?? id;

/** Every playable game gets a row, even before its first event. */
export function withAllGames(rows: FunnelRow[] | null): FunnelRow[] {
  const byId = new Map((rows ?? []).map((r) => [r.game_id, r]));
  return GAME_REGISTRY.filter((g) => g.playable).map(
    (g) =>
      byId.get(g.id) ?? {
        game_id: g.id,
        hub_clicks: 0,
        room_creates: 0,
        invite_clicks: 0,
        joins: 0,
        game_starts: 0,
        unique_devices: 0,
        unique_ips: 0,
      },
  );
}

function NameTag({ name }: { name: string }) {
  return (
    <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-amber-200 light:bg-amber-100 light:text-amber-800">
      🏷️ {name}
    </span>
  );
}

/**
 * One device's IPs. The admin's own IP is shown outright (and marked);
 * anyone else's stays hidden until clicked — as the admin's name for it
 * (🏷️ IP 관리) when one is set, otherwise as its hash. Events from before
 * the raw IP was stored only have the hash, which can't be turned back
 * into an IP.
 */
function IpCell({
  hashes,
  ipMap,
  myIp,
  labels,
}: {
  hashes: string[];
  ipMap: Record<string, string>;
  myIp: string | null;
  labels: IpLabelMap;
}) {
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set());
  if (hashes.length === 0) return <span className="text-white/30">—</span>;
  return (
    <div className="flex flex-col items-start gap-1">
      {hashes.map((h) => {
        const raw = ipMap[h];
        const name = raw ? labels.get(raw)?.label : undefined;
        if (raw && raw === myIp) {
          return (
            <span key={h} className="font-mono text-[11px] text-emerald-300">
              {raw} <span className="font-sans font-bold">👤 나</span> {name && <NameTag name={name} />}
            </span>
          );
        }
        if (!raw) {
          return (
            <span key={h} className="font-mono text-[10px] text-white/40" title="이전 기록이라 암호화 값만 있고 IP 원문은 없습니다">
              {h} <span className="font-sans">(원문 없음)</span>
            </span>
          );
        }
        const open = revealed.has(h);
        return (
          <button
            key={h}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setRevealed((prev) => {
                const next = new Set(prev);
                if (next.has(h)) next.delete(h);
                else next.add(h);
                return next;
              });
            }}
            className="rounded border border-white/10 px-1.5 py-0.5 font-mono text-[11px] text-white/70 hover:border-amber-400"
            title={open ? "다시 숨기기" : "눌러서 IP 보기"}
          >
            {open ? (
              <>
                {raw} {name && <NameTag name={name} />}
              </>
            ) : name ? (
              <NameTag name={name} />
            ) : (
              `🔒 ${h}`
            )}
          </button>
        );
      })}
    </div>
  );
}

function Participants({
  gameId,
  since,
  exclude,
  myIp,
  ipLabels,
}: {
  gameId: string;
  since: string | null;
  exclude: ExcludeMe | null;
  myIp: string | null;
  ipLabels: IpLabelMap;
}) {
  const [onlySuspects, setOnlySuspects] = useState(false);
  const { data: rows, error } = useAdminQuery<ParticipantRow>(
    () => adminRpc("admin_game_participants", { p_game_id: gameId, p_since: since }, exclude),
    JSON.stringify([gameId, since, exclude]),
  );

  const flags = useMemo(() => computeDuplicateFlags(rows ?? []), [rows]);
  if (error) return <ErrorNote message={error} />;
  if (!rows) return <Loading />;

  const visible = rows.filter((r) => !onlySuspects || isSuspectedDuplicate(flags.get(r.device_id)));
  const suspects = rows.filter((r) => isSuspectedDuplicate(flags.get(r.device_id))).length;

  return (
    <div className="mt-2">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-white/50 light:text-slate-500">
        <span>
          기기 {fmt(rows.length)}대 · 중복 의심 {fmt(suspects)}대
        </span>
        <Chip active={!onlySuspects} onClick={() => setOnlySuspects(false)}>
          전체
        </Chip>
        <Chip active={onlySuspects} onClick={() => setOnlySuspects(true)}>
          ⚠️ 중복 의심만
        </Chip>
      </div>
      {visible.length === 0 ? (
        <p className="py-4 text-sm text-white/40">해당하는 기기가 없습니다.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/10 light:border-slate-200">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="bg-white/[0.04] text-white/50 light:bg-slate-50 light:text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">닉네임 / 기기 ID</th>
                <th className="px-3 py-2 font-medium">IP (눌러서 보기)</th>
                <th className="px-3 py-2 font-medium">중복 검토</th>
                <th className="px-3 py-2 text-right font-medium">클릭</th>
                <th className="px-3 py-2 text-right font-medium">방</th>
                <th className="px-3 py-2 text-right font-medium">초대</th>
                <th className="px-3 py-2 text-right font-medium">참여</th>
                <th className="px-3 py-2 text-right font-medium">시작</th>
                <th className="px-3 py-2 font-medium">기기</th>
                <th className="px-3 py-2 font-medium">최근</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 light:divide-slate-100">
              {visible.map((r) => {
                const f = flags.get(r.device_id);
                const ipMap = r.ip_map ?? {};
                const isMe = !!myIp && Object.values(ipMap).includes(myIp);
                return (
                  <tr key={r.device_id ?? "none"} className="align-top">
                    <td className="px-3 py-2">
                      <p className="font-semibold text-white light:text-slate-900">
                        {r.nicknames.length ? r.nicknames.join(", ") : <span className="font-normal text-white/40">익명</span>}
                        {isMe && (
                          <span className="ml-1.5 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">
                            👤 나
                          </span>
                        )}
                      </p>
                      <p className="font-mono text-[10px] text-white/30">{(r.device_id ?? "—").slice(0, 8)}</p>
                    </td>
                    <td className="px-3 py-2">
                      <IpCell hashes={r.ip_hashes} ipMap={ipMap} myIp={myIp} labels={ipLabels} />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-0.5">
                        {f && f.sameIpDevices > 0 && <span className="text-amber-300">같은 IP 기기 {f.sameIpDevices}대</span>}
                        {f && f.sameNicknameDevices > 0 && <span className="text-amber-300">같은 닉네임 기기 {f.sameNicknameDevices}대</span>}
                        {f?.multipleNicknames && <span className="text-sky-300">닉네임 여러 개</span>}
                        {!isSuspectedDuplicate(f) && !f?.multipleNicknames && <span className="text-white/30">—</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(r.hub_clicks)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(r.room_creates)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(r.invite_clicks)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(r.joins)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(r.game_starts)}</td>
                    <td className="px-3 py-2 text-white/60">{[r.device_type, r.os, r.browser].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-white/60 tabular-nums">{DATE_TIME.format(new Date(r.last_at))}</td>
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

/** 게임 통계 tab: per-game funnel counts; a row opens the per-device duplicate review. */
export default function GamesTab({
  since,
  exclude,
  myIp,
  ipLabels,
  reloadKey,
}: {
  since: string | null;
  exclude: ExcludeMe | null;
  myIp: string | null;
  ipLabels: IpLabelMap;
  reloadKey: number;
}) {
  const [openGame, setOpenGame] = useState<string | null>(null);
  const { data: rows, error } = useAdminQuery<FunnelRow>(
    () => adminRpc("admin_game_funnel", { p_since: since }, exclude),
    JSON.stringify([since, exclude, reloadKey]),
  );

  const table = useMemo(
    () =>
      withAllGames(rows).sort(
        (a, b) => Number(b.game_starts) - Number(a.game_starts) || Number(b.hub_clicks) - Number(a.hub_clicks),
      ),
    [rows],
  );
  const totals = useMemo(() => {
    const t = { hub_clicks: 0, room_creates: 0, invite_clicks: 0, joins: 0, game_starts: 0 };
    for (const r of table) for (const k of Object.keys(t) as (keyof typeof t)[]) t[k] += Number(r[k]);
    return t;
  }, [table]);

  return (
    <div className="flex flex-col gap-4">
      <ErrorNote message={error} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {METRICS.map((m) => (
          <StatCard key={m.key} label={m.label} value={rows ? fmt(totals[m.key]) : "—"} sub={m.hint} />
        ))}
      </div>

      <p className="text-xs text-white/40 light:text-slate-500">
        게임을 누르면 기기별 기록과 중복 사용자(같은 IP·같은 닉네임) 검토가 열립니다. 전환율 = 방 만들기 ÷ 허브 클릭, 참여 ÷ 초대코드 클릭.
      </p>

      <div className="overflow-x-auto rounded-xl border border-white/10 light:border-slate-200">
        <table className="w-full min-w-[760px] text-left text-xs">
          <thead className="bg-white/[0.04] text-white/50 light:bg-slate-50 light:text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">게임</th>
              <th className="px-3 py-2 text-right font-medium">허브 클릭</th>
              <th className="px-3 py-2 text-right font-medium">방 만들기</th>
              <th className="px-3 py-2 text-right font-medium">초대코드 클릭</th>
              <th className="px-3 py-2 text-right font-medium">참여</th>
              <th className="px-3 py-2 text-right font-medium">게임 시작</th>
              <th className="px-3 py-2 text-right font-medium">기기 / IP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 light:divide-slate-100">
            {table.map((r) => {
              const open = openGame === r.game_id;
              return (
                <Fragment key={r.game_id}>
                  <tr
                    onClick={() => setOpenGame(open ? null : r.game_id)}
                    className={`cursor-pointer transition hover:bg-white/[0.03] ${open ? "bg-amber-500/5" : ""}`}
                  >
                    <td className="px-3 py-2 font-semibold text-white light:text-slate-900">
                      {open ? "▾" : "▸"} {gameName(r.game_id)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-white/80">{fmt(r.hub_clicks)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-white/80">
                      {fmt(r.room_creates)} <span className="text-white/30">{rate(r.room_creates, r.hub_clicks)}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-white/80">{fmt(r.invite_clicks)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-white/80">
                      {fmt(r.joins)} <span className="text-white/30">{rate(r.joins, r.invite_clicks)}</span>
                    </td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums text-amber-300">{fmt(r.game_starts)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-white/60">
                      {fmt(r.unique_devices)} / {fmt(r.unique_ips)}
                    </td>
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={7} className="bg-black/20 px-3 pb-4 light:bg-slate-50">
                        <Participants gameId={r.game_id} since={since} exclude={exclude} myIp={myIp} ipLabels={ipLabels} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
