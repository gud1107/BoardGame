// Lists lobby previews (still + hover clip) that are older than their game's
// screen code, i.e. the card may show a screen the game no longer has.
//
//   node scripts/poster-videos/stale.mjs            → report only
//   node scripts/poster-videos/stale.mjs --refresh  → also re-record, auto-pick,
//                                                    encode and check the stale ones
//
// "Screen code" = .tsx/.css files and three/ scenes in src/games/<dir>/, plus
// the shared 3D kit for games that render a 3D board. Logic-only commits
// (engine, bots, tests) don't make a preview stale. Times are git commit times,
// so commit the game change first; --refresh needs POSTER_RAW_DIR and PWCORE
// like record.cjs, and records the production site (deploy first).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

const camel = (id) => id.replace(/-(\w)/g, (_, c) => c.toUpperCase());
const gameDir = (id) => [id, camel(id)].map((d) => join("src", "games", d)).find((d) => existsSync(join(root, d)));

const files = (dir) =>
  readdirSync(join(root, dir), { recursive: true })
    .map((f) => join(dir, String(f)).replace(/\\/g, "/"))
    .filter((f) => /\.(tsx|css)$/.test(f) || /\/three\//.test(f))
    .filter((f) => !/\.test\.tsx?$/.test(f));

const lastCommit = (paths) => (paths.length ? +git("log", "-1", "--format=%ct", "--", ...paths) || 0 : 0);

const ids = Object.keys(JSON.parse(readFileSync(join(here, "highlights.json"), "utf8")));
const sharedKit = lastCommit(["src/games/shared/three"]);
const stale = [];
for (const id of ids) {
  const dir = gameDir(id);
  if (!dir) continue;
  const screen = files(dir);
  const uses3d = screen.some((f) => /useBoardView/.test(readFileSync(join(root, f), "utf8")));
  const changed = Math.max(lastCommit(screen), uses3d ? sharedKit : 0);
  const shot = lastCommit([`public/posters/${id}.webp`, `public/posters/${id}.webm`]);
  if (changed > shot) stale.push({ id, days: ((changed - shot) / 86400).toFixed(1), uses3d });
}

if (!stale.length) {
  console.log("✓ every preview is newer than its game's screen code");
  process.exit(0);
}
console.log(`${stale.length} preview(s) older than the game screen:`);
for (const s of stale) console.log(`  ${s.id.padEnd(20)} screen changed ${s.days} day(s) after the capture${s.uses3d ? " (3D)" : ""}`);

if (!process.argv.includes("--refresh")) {
  console.log(`\nrefresh: node scripts/poster-videos/stale.mjs --refresh`);
  process.exit(0);
}
const list = stale.map((s) => s.id);
const run = (script, args) => {
  const r = spawnSync(process.execPath, [join(here, script), ...args], { stdio: "inherit", env: process.env });
  if (r.status) process.exit(r.status);
};
run("record-all.cjs", ["150", "3", ...list]);
run("autopick.mjs", list);
run("encode.mjs", list);
run("check.mjs", []);
console.log(`\nreview public/posters/ (git diff --stat), then commit.`);
