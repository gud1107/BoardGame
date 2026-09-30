"use client";

import { useEffect, useState } from "react";
import { GAME_REGISTRY } from "@/games/registry";
import { fetchGameOverrides, type GameOverride } from "@/lib/siteConfig/siteConfig";
import { adminWrite } from "../adminApi";
import { ErrorNote, Loading } from "../adminUi";

type Flag = "hidden" | "coming_soon" | "featured";

const FLAGS: { key: Flag; label: string; hint: string }[] = [
  { key: "featured", label: "⭐ 추천", hint: "허브 맨 앞 + 추천 표시" },
  { key: "coming_soon", label: "🚧 준비중", hint: "목록에는 보이지만 입장 불가" },
  { key: "hidden", label: "🙈 숨기기", hint: "허브에서 완전히 숨김 (주소로 들어와도 입장 불가)" },
];

const EMPTY = (game_id: string): GameOverride => ({ game_id, hidden: false, coming_soon: false, featured: false });

/**
 * 게임 관리 tab: per-game switches stored in Supabase `game_overrides` and
 * applied by the lobby (`applyGameOverrides`) and the game page. Only
 * games that are playable in the code can be switched; the rest are 준비중
 * regardless.
 */
export default function GameVisibilityTab() {
  const [overrides, setOverrides] = useState<Map<string, GameOverride> | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchGameOverrides().then((m) => {
      if (!cancelled) setOverrides(m);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle(gameId: string, flag: Flag) {
    const current = overrides?.get(gameId) ?? EMPTY(gameId);
    const next = { ...current, [flag]: !current[flag] };
    setSavingId(gameId);
    const err = await adminWrite("admin_set_game_override", {
      p_game_id: gameId,
      p_hidden: next.hidden,
      p_coming_soon: next.coming_soon,
      p_featured: next.featured,
    });
    setSavingId(null);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setOverrides((prev) => new Map(prev ?? []).set(gameId, next));
  }

  if (!overrides) return <Loading />;
  const games = GAME_REGISTRY.filter((g) => g.playable);
  const changed = games.filter((g) => {
    const o = overrides.get(g.id);
    return o && (o.hidden || o.coming_soon || o.featured);
  }).length;

  return (
    <div className="flex flex-col gap-3">
      <ErrorNote message={error} />
      <p className="text-xs text-white/50 light:text-slate-500">
        {FLAGS.map((f) => `${f.label}: ${f.hint}`).join(" · ")} — 바꾼 게임 {changed}개 · 방문자가 새로고침하면 반영됩니다.
      </p>
      <div className="overflow-x-auto rounded-xl border border-white/10 light:border-slate-200">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead className="bg-white/[0.04] text-xs text-white/50 light:bg-slate-50 light:text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">게임</th>
              {FLAGS.map((f) => (
                <th key={f.key} className="px-3 py-2 text-center font-medium">
                  {f.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 light:divide-slate-100">
            {games.map((g) => {
              const o = overrides.get(g.id) ?? EMPTY(g.id);
              return (
                <tr key={g.id} className={o.hidden ? "opacity-50" : ""}>
                  <td className="px-3 py-2 text-white light:text-slate-900">{g.name}</td>
                  {FLAGS.map((f) => (
                    <td key={f.key} className="px-3 py-2 text-center">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={o[f.key]}
                        aria-label={`${g.name} ${f.label}`}
                        disabled={savingId === g.id}
                        onClick={() => void toggle(g.id, f.key)}
                        className={`relative h-5 w-9 rounded-full transition disabled:opacity-40 ${
                          o[f.key] ? "bg-amber-500" : "bg-white/15 light:bg-slate-300"
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${o[f.key] ? "left-[18px]" : "left-0.5"}`}
                        />
                      </button>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
