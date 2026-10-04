#!/usr/bin/env node
// Checks whether supabase/player_stats.sql has been applied to the Supabase
// project in .env.local and whether matches are actually being saved.
//
//   node scripts/check-player-stats.mjs
//
// Read-only: probes the RPCs with the anon key (deliberately invalid args, so
// nothing is written) and counts rows with the service-role key.
import fs from "node:fs";

function loadEnv(file) {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(file, "utf8")
      .split(/\r?\n/)
      .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/))
      .filter(Boolean)
      .map((m) => [m[1], m[2]]),
  );
}

const env = { ...loadEnv(".env"), ...loadEnv(".env.local"), ...process.env };
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anon) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY missing");
  process.exit(1);
}

async function rpc(name, body, key = anon) {
  const res = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json };
}

async function count(table, query = "") {
  const res = await fetch(`${url}/rest/v1/${table}?select=*${query}`, {
    method: "HEAD",
    headers: { apikey: service, Authorization: `Bearer ${service}`, Prefer: "count=exact", Range: "0-0" },
  });
  if (!res.ok) return `ERR ${res.status}`;
  return res.headers.get("content-range")?.split("/")[1] ?? "?";
}

const missing = (r) => r.json?.code === "PGRST202" || r.json?.code === "42883";
let ok = true;
const line = (good, label, detail = "") => {
  if (!good) ok = false;
  console.log(`${good ? "✔" : "✘"} ${label}${detail ? ` — ${detail}` : ""}`);
};

console.log(`Supabase: ${url}\n`);

const lb = await rpc("public_leaderboard", { p_game_id: null, p_sort: "wins", p_min_played: 10, p_limit: 5, p_include_bots: true, p_bot_level: 10 });
line(!missing(lb) && lb.status === 200, "public_leaderboard", missing(lb) ? "없음/구버전 — 최신 player_stats.sql 미적용" : `${Array.isArray(lb.json) ? lb.json.length : "?"}행`);

const mlb = await rpc("public_metric_leaderboard", { p_game_id: "perudo", p_num: "dudoCorrect", p_den: "dudoCalls", p_asc: false, p_min_den: 1, p_limit: 5, p_include_bots: true, p_bot_level: 10 });
line(!missing(mlb) && mlb.status === 200, "public_metric_leaderboard", missing(mlb) ? "없음 — 최신 player_stats.sql 미적용" : "");

// anon may not execute these; "permission denied" (42501) proves they exist.
const rec = await rpc("record_match_stats", { p_match_id: "x", p_game_id: "x", p_won: true, p_rank: 1, p_player_count: 1, p_played_at: new Date().toISOString(), p_details: {}, p_with_bots: true, p_bot_level: 5 });
line(!missing(rec), "record_match_stats (9인자, 봇 필터·레벨)", missing(rec) ? "없음/구버전 — player_stats.sql 재실행 필요" : "존재");

const mine = await rpc("my_bot_level_stats", {});
line(!missing(mine), "my_bot_level_stats", missing(mine) ? "없음 — 최신 player_stats.sql 미적용" : "존재");

const cls = await rpc("my_classified_counts", {});
line(!missing(cls), "my_classified_counts", missing(cls) ? "없음 — 최신 player_stats.sql 미적용" : "존재");

const blb = await rpc("public_bot_level_board", { p_game_id: null, p_min_played: 5 });
line(!missing(blb) && blb.status === 200, "public_bot_level_board", missing(blb) ? "없음 — 최신 player_stats.sql 미적용" : "");

const name = await rpc("set_my_public_name", { p_name: null });
line(!missing(name), "set_my_public_name", missing(name) ? "없음 — 최신 player_stats.sql 미적용" : "존재");

if (service) {
  console.log("");
  const stats = await count("player_game_stats");
  const log = await count("player_match_log");
  const named = await count("user_profiles", "&public_name=not.is.null");
  line(!String(stats).startsWith("ERR"), "player_game_stats", `${stats}행 (회원×게임)`);
  line(!String(log).startsWith("ERR"), "player_match_log", `${log}판 기록됨`);
  console.log(`  랭킹 닉네임 정한 회원: ${named}`);
  if (!String(log).startsWith("ERR")) {
    const res = await fetch(`${url}/rest/v1/player_match_log?select=game_id,won,rank,player_count,recorded_at,details&order=recorded_at.desc&limit=5`, {
      headers: { apikey: service, Authorization: `Bearer ${service}` },
    });
    const recent = await res.json();
    if (Array.isArray(recent) && recent.length) {
      console.log("  최근 기록:");
      for (const r of recent) {
        const keys = Object.keys(r.details ?? {}).length;
        console.log(`   - ${r.recorded_at} ${r.game_id} ${r.rank}/${r.player_count}위 ${r.won ? "승" : "패"} (세부 지표 ${keys}개)`);
      }
    }
  }
} else {
  console.log("\n(SUPABASE_SERVICE_ROLE_KEY 없음 — 저장된 행 수는 건너뜀)");
}

console.log(ok ? "\n모두 정상." : "\n위 ✘ 항목: Supabase SQL Editor에서 supabase/player_stats.sql 전체를 실행하세요.");
process.exit(ok ? 0 : 1);
