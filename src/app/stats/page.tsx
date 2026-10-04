"use client";

import { Fragment, useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { getGameMeta, GAME_REGISTRY } from "@/games/registry";
import type { StatTotalsRecord } from "@/lib/db/types";
import { STAT_DETAIL_ROWS } from "@/lib/stats/details";
import {
  fetchBotLevelBoard,
  fetchLeaderboard,
  fetchMetricLeaderboard,
  LEVEL_BOARD_MIN_PLAYED,
  type BotLevelBoardRow,
  type LeaderboardResult,
  type LeaderboardSort,
} from "@/lib/stats/leaderboard";
import { formatRankMetric, STAT_RANK_METRICS } from "@/lib/stats/presentation";
import {
  BOT_FILTER_SINCE,
  botLevelRows,
  isDefaultBotFilter,
  pickSlice,
  unclassifiedCount,
  useStatsBotFilter,
  type StatsBotFilter,
} from "@/lib/stats/botFilter";
import { countPendingStats, listPlayerStats, STATS_CHANGED_EVENT, syncPlayerStats } from "@/lib/stats/playerStats";
import { useSubscriptionStore } from "@/store/subscriptionStore";
import { useProfileStore } from "@/store/profileStore";
import ProfileModal from "@/components/profile/ProfileModal";

type Tab = "mine" | "ranking";

export default function StatsPage() {
  const userId = useSubscriptionStore((s) => s.userId);
  const hydrated = useSubscriptionStore((s) => s.hydrated);
  const [tab, setTab] = useState<Tab>("mine");
  const [botFilter, setBotFilter] = useStatsBotFilter();

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <h1 className="mb-4 text-2xl font-bold text-white light:text-slate-900">전적</h1>

      {hydrated && !userId && <GuestWarning />}

      <div className="mb-5 flex gap-1 rounded-xl border border-white/10 bg-white/5 p-1 light:border-slate-200 light:bg-slate-100">
        {(
          [
            ["mine", "내 전적"],
            ["ranking", "공개 랭킹"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${
              tab === id
                ? "bg-rose-500 text-white"
                : "text-white/60 hover:text-white light:text-slate-500 light:hover:text-slate-900"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <BotFilterBar filter={botFilter} onChange={setBotFilter} />

      {tab === "mine" ? <MyStats loggedIn={!!userId} filter={botFilter} /> : <Ranking loggedIn={!!userId} filter={botFilter} onFilterChange={setBotFilter} />}
    </div>
  );
}

function GuestWarning() {
  return (
    <div
      role="alert"
      className="mb-5 rounded-2xl border-2 border-amber-400/70 bg-amber-400/15 p-4 shadow-[0_0_24px_rgba(251,191,36,0.15)] light:border-amber-500 light:bg-amber-50"
    >
      <p className="flex items-center gap-2 text-base font-bold text-amber-200 light:text-amber-800">
        <span aria-hidden>⚠️</span> 로그인하지 않은 기록은 언제든 사라질 수 있어요
      </p>
      <p className="mt-1.5 text-sm leading-relaxed text-amber-100/90 light:text-amber-900">
        지금 전적은 <b>이 브라우저에만</b> 저장돼 있어요. 브라우저 기록·사이트 데이터 삭제, 시크릿 모드, 저장공간 자동 정리,
        다른 기기나 브라우저로 바꾸는 순간 <b>복구할 수 없이 사라집니다.</b> 공개 랭킹에도 오르지 않아요.
      </p>
      <p className="mt-1.5 text-sm text-amber-100/90 light:text-amber-900">
        로그인하면 지금까지 쌓은 기록이 그대로 계정에 합쳐져 안전하게 보관됩니다.
      </p>
      <Link
        href="/login?next=/stats"
        className="mt-3 inline-block rounded-xl bg-amber-400 px-4 py-2 text-sm font-bold text-zinc-900 hover:bg-amber-300"
      >
        로그인하고 기록 지키기
      </Link>
    </div>
  );
}

function MyStats({ loggedIn, filter }: { loggedIn: boolean; filter: StatsBotFilter }) {
  const [stats, setStats] = useState<StatTotalsRecord[] | null>(null);
  const [pending, setPending] = useState(0);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(() => {
    void Promise.all([listPlayerStats(), countPendingStats()]).then(([rows, n]) => {
      setStats(rows.sort((a, b) => b.played - a.played || a.gameId.localeCompare(b.gameId)));
      setPending(n);
    });
  }, []);

  useEffect(() => {
    load();
    void syncPlayerStats();
    window.addEventListener(STATS_CHANGED_EVENT, load);
    return () => window.removeEventListener(STATS_CHANGED_EVENT, load);
  }, [load]);

  const shown = (stats ?? [])
    .map((t) => ({ gameId: t.gameId, s: pickSlice(t, filter) }))
    .filter((x): x is { gameId: string; s: NonNullable<typeof x.s> } => x.s !== null);
  // Solo games always finish 1st of 1 — keep them out of the win totals (their rows show details instead).
  const total = shown
    .filter(({ gameId }) => !SOLO_GAME_IDS.has(gameId))
    .reduce((acc, { s }) => ({ played: acc.played + s.played, wins: acc.wins + s.wins }), { played: 0, wins: 0 });

  return (
    <>
      <p className="mb-4 text-sm text-white/50 light:text-slate-500">
        {loggedIn ? "계정에 저장된 전적이에요. 다른 기기에서 로그인해도 같은 기록이 보여요." : "이 브라우저에 저장된 전적이에요."}{" "}
        1등은 승, 그 외 순위는 패로 집계하고, 봇이 대신 둔 판은 빠집니다.
      </p>

      {loggedIn && pending > 0 && (
        <p className="mb-4 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-2 text-xs text-amber-200 light:text-amber-700">
          아직 계정에 올라가지 않은 기록 {pending}판이 있어요. 연결되면 자동으로 올라갑니다.
        </p>
      )}

      {stats !== null && unclassifiedCount(stats) > 0 && (
        <p className="mb-4 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-xs text-white/55 light:border-slate-200 light:bg-slate-50 light:text-slate-500">
          🕒 봇이 있었는지 구분되지 않은 이전 기록 <b className="text-white/80 light:text-slate-700">{unclassifiedCount(stats)}판</b>
          {isDefaultBotFilter(filter) ? "도 위 집계에 포함돼 있어요." : "은 지금 필터에서 빠져 있어요."} 봇 구분은{" "}
          {BOT_FILTER_SINCE} 이후 판부터 기록돼요.
        </p>
      )}

      {stats === null ? (
        <p className="text-sm text-white/40 light:text-slate-400">불러오는 중...</p>
      ) : shown.length === 0 ? (
        <p className="rounded-xl border border-white/10 bg-white/5 p-6 text-center text-sm text-white/40 light:border-slate-200 light:bg-slate-50 light:text-slate-400">
          {stats.length === 0
            ? "아직 기록된 게임이 없어요. 온라인 방에서 한 판 끝내면 여기에 쌓입니다."
            : `이 조건에 맞는 기록이 아직 없어요. (봇 필터는 ${BOT_FILTER_SINCE} 이후 판부터 집계돼요)`}
        </p>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-3 gap-3">
            <Stat label="전체 판수" value={`${total.played}`} />
            <Stat label="승리" value={`${total.wins}`} />
            <Stat label="승률" value={pct(total.wins, total.played)} />
          </div>
          <div className="overflow-hidden rounded-2xl border border-white/10 light:border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-white/5 text-xs text-white/50 light:bg-slate-50 light:text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">게임</th>
                  <th className="px-2 py-2 text-right font-medium">판</th>
                  <th className="px-2 py-2 text-right font-medium">승</th>
                  <th className="px-2 py-2 text-right font-medium">패</th>
                  <th className="px-2 py-2 text-right font-medium">승률</th>
                  <th className="px-3 py-2 text-right font-medium">최고</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(({ gameId, s }) => {
                  const meta = getGameMeta(gameId);
                  const rows = STAT_DETAIL_ROWS[gameId];
                  const expandable = !!rows && !!s.details && Object.keys(s.details).length > 0;
                  const isOpen = open === gameId;
                  return (
                    <Fragment key={gameId}>
                      <tr
                        className={`border-t border-white/5 light:border-slate-100 ${expandable ? "cursor-pointer hover:bg-white/[0.04] light:hover:bg-slate-50" : ""}`}
                        onClick={expandable ? () => setOpen(isOpen ? null : gameId) : undefined}
                      >
                        <td className="px-3 py-2 text-white/85 light:text-slate-800">
                          <span className="mr-1.5">{meta?.thumbnail.emoji ?? "🎲"}</span>
                          {meta?.name ?? gameId}
                          {expandable && <span className="ml-1.5 text-xs text-rose-300">{isOpen ? "▲" : "세부 ▼"}</span>}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums text-white/70 light:text-slate-600">{s.played}</td>
                        {SOLO_GAME_IDS.has(gameId) ? (
                          <td colSpan={4} className="px-3 py-2 text-right text-xs text-white/40 light:text-slate-400">
                            1인 게임 · 승패 집계 제외
                          </td>
                        ) : (
                          <>
                            <td className="px-2 py-2 text-right tabular-nums text-white/70 light:text-slate-600">{s.wins}</td>
                            <td className="px-2 py-2 text-right tabular-nums text-white/70 light:text-slate-600">{s.losses}</td>
                            <td className="px-2 py-2 text-right tabular-nums text-white/85 light:text-slate-800">{pct(s.wins, s.played)}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-white/70 light:text-slate-600">
                              {s.bestRank === null ? "-" : `${s.bestRank}위`}
                            </td>
                          </>
                        )}
                      </tr>
                      {expandable && isOpen && (
                        <tr className="bg-white/[0.03] light:bg-slate-50">
                          <td colSpan={6} className="px-3 py-3">
                            <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
                              {rows.map((r) => {
                                const v = r.value(s.details!, s.played);
                                if (v === null) return null;
                                return (
                                  <div key={r.label} className="flex justify-between gap-3 text-xs">
                                    <dt className="text-white/50 light:text-slate-500">{r.label}</dt>
                                    <dd className="tabular-nums text-white/85 light:text-slate-800">{v}</dd>
                                  </div>
                                );
                              })}
                            </dl>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {stats !== null && stats.length > 0 && <BotLevelTable stats={stats} />}
    </>
  );
}

function levelLabel(level: number | null): string {
  return level === null || level < 0 ? "👥 사람끼리" : level === 0 ? "🔄 도중 교체 봇" : `Lv.${level}`;
}

function BotLevelTable({ stats }: { stats: StatTotalsRecord[] }) {
  const [gameId, setGameId] = useState("");
  const games = stats.filter((t) => (t.noBot?.played ?? 0) > 0 || Object.keys(t.byBotLevel ?? {}).length > 0);
  // A game picked earlier may have no rows any more (e.g. after logout).
  const selected = games.some((t) => t.gameId === gameId) ? gameId : "";
  const rows = botLevelRows(stats, selected || null);
  const maxPlayed = Math.max(1, ...rows.map((r) => r.played));

  return (
    <section className="mt-6">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-white/85 light:text-slate-800">🤖 봇 레벨별 승률</h2>
        {games.length > 0 && (
          <select
            aria-label="게임 선택"
            value={selected}
            onChange={(e) => setGameId(e.target.value)}
            className="rounded-lg border border-white/15 bg-zinc-900 px-2 py-1 text-xs text-white light:border-slate-300 light:bg-white light:text-slate-900"
          >
            <option value="">전체 게임</option>
            {games.map((t) => (
              <option key={t.gameId} value={t.gameId}>
                {getGameMeta(t.gameId)?.name ?? t.gameId}
              </option>
            ))}
          </select>
        )}
      </div>
      <p className="mb-2 text-[11px] text-white/40 light:text-slate-400">
        판마다 테이블에 있던 가장 강한 봇의 레벨로 묶어요. 레벨 없는 교체 봇만 있던 판은 &lsquo;도중 교체 봇&rsquo;으로 따로 모아요. ({BOT_FILTER_SINCE} 이후 기록)
      </p>
      <div className="overflow-hidden rounded-2xl border border-white/10 light:border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-white/5 text-xs text-white/50 light:bg-slate-50 light:text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium">상대</th>
              <th className="px-2 py-2 text-right font-medium">판</th>
              <th className="px-2 py-2 text-right font-medium">승</th>
              <th className="px-2 py-2 text-right font-medium">패</th>
              <th className="w-[38%] px-3 py-2 text-left font-medium">승률</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const empty = r.played === 0;
              const rate = empty ? 0 : Math.round((r.wins / r.played) * 100);
              return (
                <tr
                  key={r.level ?? "human"}
                  className={`border-t border-white/5 light:border-slate-100 ${empty ? "text-white/25 light:text-slate-300" : "text-white/75 light:text-slate-700"}`}
                >
                  <td className="px-3 py-1.5">{levelLabel(r.level)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{empty ? "-" : r.played}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{empty ? "-" : r.wins}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{empty ? "-" : r.losses}</td>
                  <td className="px-3 py-1.5">
                    {empty ? (
                      "-"
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10 light:bg-slate-200">
                          <div
                            className="h-full rounded-full bg-rose-400"
                            style={{ width: `${rate}%`, opacity: 0.45 + 0.55 * (r.played / maxPlayed) }}
                          />
                        </div>
                        <span className="w-9 text-right text-xs tabular-nums text-white/85 light:text-slate-800">{rate}%</span>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const RANKED_GAMES = GAME_REGISTRY.filter((g) => g.playable && g.id !== "hungry-shark" && g.id !== "crab-survival");
/** 1-player games: always rank 1 of 1, so they never count toward wins / win rate. */
const SOLO_GAME_IDS = new Set(GAME_REGISTRY.filter((g) => g.players.max === 1).map((g) => g.id));

interface BoardRow {
  rank: number;
  nickname: string;
  avatarUrl: string | null;
  isMe: boolean;
  right: ReactNode;
}

function Ranking({
  loggedIn,
  filter,
  onFilterChange,
}: {
  loggedIn: boolean;
  filter: StatsBotFilter;
  onFilterChange: (next: StatsBotFilter) => void;
}) {
  const [gameId, setGameId] = useState<string>("");
  // "wins" | "rate" | "levels" (봇 레벨별 비교) | a STAT_RANK_METRICS id for the selected game.
  const [sort, setSort] = useState<string>("wins");
  const metrics = gameId ? (STAT_RANK_METRICS[gameId] ?? []) : [];
  const metric = metrics.find((m) => m.id === sort) ?? null;
  const effectiveSort = metric ? metric.id : sort === "rate" || sort === "levels" ? sort : "wins";
  const comparing = effectiveSort === "levels";
  const key = `${gameId}|${effectiveSort}|${filter.includeBots ? "bots" : "nobots"}|${filter.botLevel ?? "all"}`;
  // Result tagged with the query it answers, so switching game/sort shows
  // "loading" without resetting state inside the effect.
  const [result, setResult] = useState<{ key: string; rows: BoardRow[] | "not-installed" | null } | null>(null);
  const rows = result?.key === key ? result.rows : undefined;

  useEffect(() => {
    if (comparing) return;
    let cancelled = false;
    const load = async (): Promise<BoardRow[] | "not-installed" | null> => {
      if (metric) {
        const r = await fetchMetricLeaderboard(gameId, metric, filter);
        if (!Array.isArray(r)) return r;
        return r.map((x) => ({
          ...x,
          right: <b className="text-sm text-white light:text-slate-900">{formatRankMetric(metric, x.value, x.num, x.den)}</b>,
        }));
      }
      const r = await fetchLeaderboard(gameId || null, effectiveSort as LeaderboardSort, filter);
      if (!Array.isArray(r)) return r;
      return r.map((x) => ({
        ...x,
        right: (
          <>
            <b className="text-sm text-white light:text-slate-900">{x.wins}</b>승 {x.losses}패
            <span className="ml-2">{x.winRate === null ? "-" : `${x.winRate}%`}</span>
          </>
        ),
      }));
    };
    void load().then((r) => {
      if (!cancelled) setResult({ key, rows: r });
    });
    return () => {
      cancelled = true;
    };
    // `metric` / `filter` are derived from or part of `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const chip = (id: string, label: string) => (
    <button
      key={id}
      onClick={() => setSort(id)}
      className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
        effectiveSort === id ? "bg-white/15 text-white light:bg-slate-200 light:text-slate-900" : "text-white/50 light:text-slate-500"
      }`}
    >
      {label}
    </button>
  );

  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <select
          value={gameId}
          onChange={(e) => setGameId(e.target.value)}
          className="min-w-0 flex-1 rounded-xl border border-white/15 bg-zinc-900 px-3 py-2 text-sm text-white light:border-slate-300 light:bg-white light:text-slate-900"
        >
          <option value="">전체 게임 합산</option>
          {RANKED_GAMES.map((g) => (
            <option key={g.id} value={g.id}>
              {g.thumbnail.emoji} {g.name}
            </option>
          ))}
        </select>
        <div className="flex gap-1 rounded-xl border border-white/10 p-1 light:border-slate-200">
          {chip("wins", "승수")}
          {chip("rate", "승률 (10판↑)")}
          {chip("levels", "🤖 레벨별 비교")}
        </div>
      </div>
      {metrics.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1 rounded-xl border border-white/10 p-1 light:border-slate-200">
          <span className="px-1.5 text-[11px] text-white/40 light:text-slate-400">세부 기록</span>
          {metrics.map((m) => chip(m.id, m.label))}
        </div>
      )}

      {loggedIn && <MyRankingName />}

      {comparing ? (
        <LevelCompareBoard
          gameId={gameId || null}
          loggedIn={loggedIn}
          onPick={(level) => {
            onFilterChange(level < 0 ? { includeBots: false, botLevel: null } : { includeBots: true, botLevel: level });
            setSort("wins");
          }}
        />
      ) : (
        <>
          <p className="mb-3 text-xs text-white/40 light:text-slate-400">
            로그인한 회원의 기록만 올라가요. 결과는 각 플레이어 기기에서 계산되므로 참고용 랭킹입니다.
            {metric?.minDen && metric.minDen > 1 && ` 이 순위는 ${metric.den === "played" ? `${metric.minDen}판` : `${metric.minDen}번`} 이상 기록한 회원만 들어가요.`}
            {!isDefaultBotFilter(filter) && ` 봇 필터는 ${BOT_FILTER_SINCE} 이후 판부터 집계돼요.`}
            {!loggedIn && " 내 기록을 올리려면 로그인하세요."}
          </p>

          {rows === "not-installed" ? (
            <p className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-6 text-center text-sm text-amber-200 light:text-amber-700">
              랭킹 서버 설정이 아직 끝나지 않았어요. 곧 열릴 예정이에요! (기록은 지금도 계속 쌓이고 있어요)
            </p>
          ) : rows === null ? (
            <p className="rounded-xl border border-white/10 bg-white/5 p-6 text-center text-sm text-white/40 light:border-slate-200 light:bg-slate-50 light:text-slate-400">
              랭킹을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.
            </p>
          ) : rows === undefined ? (
            <p className="text-sm text-white/40 light:text-slate-400">불러오는 중...</p>
          ) : rows.length === 0 ? (
            <p className="rounded-xl border border-white/10 bg-white/5 p-6 text-center text-sm text-white/40 light:border-slate-200 light:bg-slate-50 light:text-slate-400">
              {effectiveSort === "rate"
                ? "아직 10판 이상 플레이한 회원이 없어요."
                : metric
                  ? "아직 이 기록으로 순위에 오른 회원이 없어요."
                  : "아직 랭킹에 오른 회원이 없어요. 첫 번째 주인공이 되어보세요!"}
            </p>
          ) : (
            <ol className="flex flex-col gap-1.5">
              {rows.map((r, i) => {
                const gap = i > 0 && r.isMe && r.rank > rows[i - 1].rank + 1;
                return (
                  <Fragment key={`${r.rank}-${r.nickname}-${i}`}>
                    {gap && <li className="py-1 text-center text-xs text-white/30 light:text-slate-400">⋯</li>}
                    <li
                      className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${
                        r.isMe
                          ? "border-rose-400/60 bg-rose-500/10 light:border-rose-400 light:bg-rose-50"
                          : "border-white/10 bg-white/[0.03] light:border-slate-200 light:bg-white"
                      }`}
                    >
                      <span className="w-8 shrink-0 text-center text-sm font-bold tabular-nums text-white/80 light:text-slate-700">
                        {r.rank <= 3 ? ["🥇", "🥈", "🥉"][r.rank - 1] : r.rank}
                      </span>
                      {r.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={r.avatarUrl} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
                      ) : (
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs light:bg-slate-200">
                          👤
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate text-sm text-white light:text-slate-900">
                        {r.nickname}
                        {r.isMe && <span className="ml-1.5 text-xs font-semibold text-rose-300 light:text-rose-600">나</span>}
                      </span>
                      <span className="shrink-0 text-right text-xs tabular-nums text-white/60 light:text-slate-500">{r.right}</span>
                    </li>
                  </Fragment>
                );
              })}
            </ol>
          )}
        </>
      )}
    </>
  );
}

const BOT_LEVEL_OPTIONS = Array.from({ length: 10 }, (_, i) => i + 1);

function BotFilterBar({ filter, onChange }: { filter: StatsBotFilter; onChange: (next: StatsBotFilter) => void }) {
  const { includeBots, botLevel } = filter;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 light:border-slate-200 light:bg-white">
      <button
        type="button"
        role="switch"
        aria-checked={includeBots}
        onClick={() => onChange({ includeBots: !includeBots, botLevel })}
        className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left"
      >
        <span className="min-w-0 text-sm text-white/80 light:text-slate-700">
          🤖 봇과 한 판 포함
          <span className="ml-1.5 text-xs text-white/40 light:text-slate-400">
            {!includeBots
              ? "사람끼리만 한 판"
              : botLevel === null
                ? "봇 있던 판까지 모두"
                : botLevel === 0
                  ? "도중에 봇이 대신 들어온 판만"
                  : `가장 강한 봇이 Lv.${botLevel}였던 판만`}
          </span>
        </span>
        <span
          aria-hidden
          className={`relative h-5 w-9 shrink-0 rounded-full transition ${includeBots ? "bg-rose-500" : "bg-white/20 light:bg-slate-300"}`}
        >
          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${includeBots ? "left-[18px]" : "left-0.5"}`} />
        </span>
      </button>
      <select
        aria-label="봇 레벨"
        value={botLevel ?? ""}
        disabled={!includeBots}
        onChange={(e) => onChange({ includeBots, botLevel: e.target.value ? Number(e.target.value) : null })}
        className="rounded-lg border border-white/15 bg-zinc-900 px-2 py-1 text-xs text-white disabled:opacity-40 light:border-slate-300 light:bg-white light:text-slate-900"
      >
        <option value="">봇 레벨 전체</option>
        <option value="0">도중 교체 봇</option>
        {BOT_LEVEL_OPTIONS.map((lv) => (
          <option key={lv} value={lv}>
            Lv.{lv} 봇
          </option>
        ))}
      </select>
    </div>
  );
}

function LevelCompareBoard({
  gameId,
  loggedIn,
  onPick,
}: {
  gameId: string | null;
  loggedIn: boolean;
  onPick: (level: number) => void;
}) {
  const key = gameId ?? "";
  const [result, setResult] = useState<{ key: string; rows: LeaderboardResult<BotLevelBoardRow> } | null>(null);
  const rows = result?.key === key ? result.rows : undefined;

  useEffect(() => {
    let cancelled = false;
    void fetchBotLevelBoard(gameId).then((r) => {
      if (!cancelled) setResult({ key, rows: r });
    });
    return () => {
      cancelled = true;
    };
  }, [key, gameId]);

  const box = "rounded-xl border p-6 text-center text-sm";
  if (rows === "not-installed")
    return (
      <p className={`${box} border-amber-400/30 bg-amber-400/10 text-amber-200 light:text-amber-700`}>
        레벨별 비교는 서버 설정을 마친 뒤 열려요. (기록은 지금도 계속 쌓이고 있어요)
      </p>
    );
  if (rows === null)
    return (
      <p className={`${box} border-white/10 bg-white/5 text-white/40 light:border-slate-200 light:bg-slate-50 light:text-slate-400`}>
        불러오지 못했어요. 잠시 후 다시 시도해 주세요.
      </p>
    );
  if (rows === undefined) return <p className="text-sm text-white/40 light:text-slate-400">불러오는 중...</p>;

  const rate = (wins: number, played: number) => (played > 0 ? Math.round((wins / played) * 100) : null);

  return (
    <>
      <p className="mb-3 text-xs text-white/40 light:text-slate-400">
        상대한 봇 레벨마다 모든 회원의 평균 승률, 1위, 내 기록을 나란히 비교해요. 1위와 내 순위는 그 레벨에서 {LEVEL_BOARD_MIN_PLAYED}판
        이상 한 회원끼리 매겨요. 줄을 누르면 그 레벨의 전체 순위표로 넘어가요. ({BOT_FILTER_SINCE} 이후 기록, 위 봇 필터와는 별개)
        {!loggedIn && " 내 기록을 비교하려면 로그인하세요."}
      </p>
      <div className="overflow-x-auto rounded-2xl border border-white/10 light:border-slate-200">
        <table className="w-full min-w-[480px] text-sm">
          <thead className="bg-white/5 text-xs text-white/50 light:bg-slate-50 light:text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium">상대</th>
              <th className="px-2 py-2 text-right font-medium">평균 승률</th>
              <th className="px-2 py-2 text-left font-medium">1위</th>
              <th className="px-2 py-2 text-right font-medium">내 승률</th>
              <th className="px-3 py-2 text-right font-medium">내 순위</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const empty = r.players === 0;
              const avg = rate(r.wins, r.played);
              const mine = r.me ? rate(r.me.wins, r.me.played) : null;
              const ahead = mine !== null && avg !== null && mine > avg;
              return (
                <tr
                  key={r.level}
                  onClick={empty ? undefined : () => onPick(r.level)}
                  className={`border-t border-white/5 light:border-slate-100 ${
                    empty
                      ? "text-white/25 light:text-slate-300"
                      : "cursor-pointer text-white/75 hover:bg-white/[0.04] light:text-slate-700 light:hover:bg-slate-50"
                  } ${r.me ? "bg-rose-500/[0.06] light:bg-rose-50/60" : ""}`}
                >
                  <td className="px-3 py-1.5 whitespace-nowrap">{levelLabel(r.level)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {avg === null ? "-" : `${avg}%`}
                    {!empty && <span className="ml-1 text-[10px] text-white/35 light:text-slate-400">{r.players}명</span>}
                  </td>
                  <td className="max-w-[9rem] truncate px-2 py-1.5">
                    {r.top ? (
                      <>
                        {r.top.nickname} <span className="tabular-nums text-white/50 light:text-slate-500">{Math.round(r.top.winRate)}%</span>
                      </>
                    ) : empty ? (
                      "-"
                    ) : (
                      <span className="text-xs text-white/35 light:text-slate-400">{LEVEL_BOARD_MIN_PLAYED}판↑ 없음</span>
                    )}
                  </td>
                  <td
                    className={`px-2 py-1.5 text-right tabular-nums ${
                      ahead ? "font-semibold text-emerald-300 light:text-emerald-600" : ""
                    }`}
                  >
                    {mine === null ? "-" : `${mine}%`}
                    {r.me && <span className="ml-1 text-[10px] text-white/35 light:text-slate-400">{r.me.played}판</span>}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {r.me?.rank ? `${r.me.rank} / ${r.rankedPlayers}` : r.me ? `${LEVEL_BOARD_MIN_PLAYED}판↑부터` : "-"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function MyRankingName() {
  const publicName = useProfileStore((s) => s.publicName);
  const hydrated = useProfileStore((s) => s.hydrated);
  const init = useProfileStore((s) => s.init);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    void init();
  }, [init]);

  if (!hydrated) return null;
  return (
    <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 light:border-slate-200 light:bg-white">
      <p className="min-w-0 truncate text-sm text-white/70 light:text-slate-600">
        내 랭킹 닉네임:{" "}
        {publicName ? (
          <b className="text-white light:text-slate-900">{publicName}</b>
        ) : (
          <span className="text-white/40 light:text-slate-400">아직 없음 (게이머_xxxxxx로 표시)</span>
        )}
      </p>
      <button
        onClick={() => setOpen(true)}
        className="shrink-0 rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-400"
      >
        {publicName ? "변경" : "정하기"}
      </button>
      {open && <ProfileModal onClose={() => setOpen(false)} />}
    </div>
  );
}

function pct(wins: number, played: number): string {
  return played === 0 ? "-" : `${Math.round((wins / played) * 100)}%`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-center light:border-slate-200 light:bg-white light:shadow-sm">
      <p className="text-xs text-white/40 light:text-slate-400">{label}</p>
      <p className="mt-0.5 text-lg font-bold tabular-nums text-white light:text-slate-900">{value}</p>
    </div>
  );
}
