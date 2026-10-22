// Picks a highlight for each raw recording without a human looking at the
// contact sheet: the liveliest 8-second stretch of play, never a frozen or
// dark one, with the card still taken from its middle. Writes the choice into
// highlights.json (crop from record.cjs's board box), keeping `moment`.
//
//   node scripts/poster-videos/autopick.mjs [--raw <dir>] id ...
//
// Hand-picked entries are better for a showcase; this is what lets
// stale.mjs --refresh run unattended. Look at the stills before committing.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const rawIdx = args.indexOf("--raw");
const rawDir = rawIdx >= 0 ? args.splice(rawIdx, 2)[1] : process.env.POSTER_RAW_DIR;
if (!rawDir) throw new Error("pass --raw <dir> (or POSTER_RAW_DIR) with the raw recordings");
const VW = 960, VH = 1200, FPS = 4, WIN = 8;
const file = join(here, "highlights.json");
const highlights = JSON.parse(readFileSync(file, "utf8"));

for (const id of args) {
  const meta = JSON.parse(readFileSync(join(rawDir, `${id}.json`), "utf8"));
  if (!meta.ok) { console.log(`${id}: skipped, game never started`); continue; }
  // Motion is measured inside the card crop: a stalled board next to a
  // moving chat or banner must not look lively.
  const c = meta.clip;
  const w = Math.min(c.w, VW, Math.floor(VH * 0.8)), h = Math.round(w * 1.25);
  const x = Math.max(0, Math.min(c.x, VW - w)), y = Math.max(0, Math.min(c.y, VH - h));
  // Skip the first seconds after takeover: tours and deal animations.
  const from = Math.ceil(meta.recStart) + 6;
  const r = spawnSync("ffmpeg", ["-v", "error", "-ss", String(from), "-i", join(rawDir, `${id}.webm`), "-vf", `crop=${w}:${h}:${x}:${y},fps=${FPS},signalstats,metadata=print:file=-`, "-an", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1 << 28 });
  const num = (re) => [...r.stdout.matchAll(re)].map((m) => +m[1]);
  const ydif = num(/signalstats\.YDIF=([\d.]+)/g);
  const yavg = num(/signalstats\.YAVG=([\d.]+)/g);
  const n = WIN * FPS;
  if (ydif.length < n + 1) { console.log(`${id}: skipped, recording too short`); continue; }
  // Cap single-frame spikes (screen flashes, scene cuts) so steady play wins.
  const cap = [...ydif].sort((a, b) => a - b)[Math.floor(ydif.length * 0.9)];
  let best = -1, bestAt = 0;
  for (let i = 1; i + n <= ydif.length; i++) {
    const win = ydif.slice(i, i + n);
    if (yavg.slice(i, i + n).some((y) => y < 8)) continue; // fade/blank
    // frozen for half the window → a bot waiting, not a highlight
    if (win.filter((d) => d < 0.05).length > n / 2) continue;
    const score = win.reduce((a, d) => a + Math.min(d, cap), 0);
    if (score > best) { best = score; bestAt = i; }
  }
  const start = from + bestAt / FPS;
  if (best / n < 0.3) console.log(`${id}: warning, even the best stretch barely moves (check.mjs will flag it) — re-record`);
  highlights[id] = {
    ...highlights[id],
    from: +start.toFixed(1),
    to: +(start + WIN).toFixed(1),
    crop: [x, y, w, h],
    stillAt: +(start + WIN / 2).toFixed(1),
    auto: true,
  };
  delete highlights[id].speed;
  console.log(`${id}: ${start.toFixed(1)}s–${(start + WIN).toFixed(1)}s, crop ${[x, y, w, h].join(",")}`);
}
// keep crop arrays on one line, like the hand-written entries
const text = JSON.stringify(highlights, null, 2).replace(/\[\s+([\d,\s]+?)\s+\]/g, (_, xs) => `[${xs.split(/,\s*/).join(", ")}]`);
writeFileSync(file, text + "\n");
