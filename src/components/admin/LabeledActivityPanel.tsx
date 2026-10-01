"use client";

import { useEffect, useState } from "react";
import { getGameMeta } from "@/games/registry";
import { adminRpc, DATE_TIME, type IpLabelMap } from "./adminApi";

interface ActivityRow {
  ip: string;
  label: string;
  memo: string | null;
  last_at: string | null;
  visits_since: number;
  starts_since: number;
  // Postgres returns NULL (not an empty array) when nothing matched the
  // FILTER — e.g. a named person who visited but didn't start a game.
  games_since: string[] | null;
  nicknames_since: string[] | null;
}

const CHECKED_KEY = "bg_admin_labels_checked_at";
const POLL_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

function readChecked(): string {
  try {
    const saved = window.localStorage.getItem(CHECKED_KEY);
    if (saved) return saved;
  } catch {}
  // First visit: treat the last day as "new".
  return new Date(Date.now() - DAY_MS).toISOString();
}

/** "방금", "12분 전", "3시간 전", else a date. */
export function timeAgo(iso: string, now: number): string {
  const diff = Math.max(0, now - Date.parse(iso));
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}시간 전`;
  return DATE_TIME.format(new Date(iso));
}

/**
 * 🔔 "a named person came back" — the IPs named in 🏷️ IP 관리 that have
 * visited or played since the admin last pressed 확인했어요 (remembered in
 * this browser). Refreshes every minute while the hub is open. Renders
 * nothing until at least one IP has a name.
 */
export default function LabeledActivityPanel({ reloadKey, labels }: { reloadKey: number; labels: IpLabelMap }) {
  const [checkedAt, setCheckedAt] = useState<string>(readChecked);
  const [rows, setRows] = useState<ActivityRow[] | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      void adminRpc<ActivityRow>("admin_labeled_activity", { p_since: checkedAt }).then((result) => {
        if (cancelled) return;
        setRows("error" in result ? [] : result.data);
        setNow(Date.now());
      });
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [checkedAt, reloadKey]);

  if (!rows || rows.length === 0) return null;

  // When some names have 🔔 on, only those count as "new" — the rest are
  // people the admin chose not to be alerted about.
  const alertIps = new Set([...labels.values()].filter((l) => l.alert).map((l) => l.ip));
  const watched = alertIps.size > 0 ? rows.filter((r) => alertIps.has(r.ip)) : rows;
  const fresh = watched.filter((r) => r.last_at && Date.parse(r.last_at) > Date.parse(checkedAt));
  const latest = watched.find((r) => r.last_at);

  return (
    <div
      className={`mb-4 rounded-xl border p-3 text-sm ${
        fresh.length
          ? "border-sky-400/40 bg-sky-500/10 text-sky-50 light:text-sky-900"
          : "border-white/10 bg-white/[0.03] text-white/60 light:border-slate-200 light:bg-white light:text-slate-600"
      }`}
    >
      {fresh.length > 0 ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">
              🔔 {alertIps.size > 0 ? "알림 켠 사람" : "이름 붙인 사람"} {fresh.length}명이 새로 접속했어요
            </p>
            <button
              type="button"
              onClick={() => {
                const iso = new Date().toISOString();
                try {
                  window.localStorage.setItem(CHECKED_KEY, iso);
                } catch {}
                setCheckedAt(iso);
              }}
              className="rounded-lg bg-sky-500/80 px-2.5 py-1 text-xs font-semibold text-white hover:bg-sky-500"
            >
              확인했어요
            </button>
          </div>
          <ul className="mt-2 flex flex-col gap-1.5">
            {fresh.map((r) => {
              const games = (r.games_since ?? []).map((g) => getGameMeta(g)?.name ?? g);
              return (
                <li key={r.ip} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                  <span className="rounded-full bg-amber-500/20 px-2 py-0.5 font-semibold text-amber-200 light:text-amber-800">🏷️ {r.label}</span>
                  <span className="text-white/70 light:text-slate-600">{timeAgo(r.last_at!, now)}</span>
                  {Number(r.visits_since) > 0 && <span className="text-white/60 light:text-slate-500">방문 {Number(r.visits_since)}회</span>}
                  {games.length > 0 && (
                    <span className="text-white/60 light:text-slate-500">
                      🎲 {games.join(", ")} ({Number(r.starts_since)}판 시작)
                    </span>
                  )}
                  {(r.nicknames_since ?? []).length > 0 && (
                    <span className="text-white/40">닉네임: {(r.nicknames_since ?? []).join(", ")}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <p className="text-xs">
          🔔 마지막 확인({timeAgo(checkedAt, now)}) 이후 새로 접속한 {alertIps.size > 0 ? "알림 켠 사람" : "이름 붙인 사람"}이 없어요
          {latest?.last_at && (
            <>
              {" "}
              · 가장 최근: <b>🏷️ {latest.label}</b> {timeAgo(latest.last_at, now)}
            </>
          )}
        </p>
      )}
    </div>
  );
}
