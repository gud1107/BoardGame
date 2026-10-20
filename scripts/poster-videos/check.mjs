// Catches broken hover clips and failed recordings with ffmpeg/ffprobe.
//
//   node scripts/poster-videos/check.mjs              → every clip listed in posterVideos.ts
//   node scripts/poster-videos/check.mjs --raw <dir>  → raw recordings (<id>.webm + <id>.json)
//
// Clip checks: both files exist, 480×600, 3–9 s, no audio, ≤ 700 KB each,
// standard-range yuv420p (full-range VP9 fails to decode in Chromium),
// first frame not black, enough motion (mean frame-to-frame luma change), and
// no frozen stretch over 4.5 s (a bot game stuck waiting on the host's turn —
// shorter pauses are just turn-based games between moves).
// Raw checks: the game started (record.cjs meta), the recording is long
// enough, and the board isn't frozen for most of it.
// Exits 1 if anything fails.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

function probe(file) {
  const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height,pix_fmt,color_range:format=duration", "-of", "json", file], { encoding: "utf8" });
  const j = JSON.parse(out);
  const video = j.streams.find((s) => s.codec_type === "video");
  return { duration: +j.format.duration, width: video?.width, height: video?.height, pixFmt: video?.pix_fmt, range: video?.color_range, audio: j.streams.some((s) => s.codec_type === "audio") };
}

/** Per-frame luma average and frame-to-frame change, plus frozen stretches. */
function motion(file, { from = 0, fps = 10, freezeSec = 4.5 } = {}) {
  const vf = `fps=${fps},signalstats,metadata=print:file=-,freezedetect=n=0.002:d=${freezeSec}`;
  const r = spawnSync("ffmpeg", ["-v", "info", "-ss", String(from), "-i", file, "-vf", vf, "-an", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1 << 28 });
  const num = (re, s) => [...s.matchAll(re)].map((m) => +m[1]);
  const ydif = num(/signalstats\.YDIF=([\d.]+)/g, r.stdout);
  const yavg = num(/signalstats\.YAVG=([\d.]+)/g, r.stdout);
  const freezes = num(/freeze_duration: ([\d.]+)/g, r.stderr);
  const mean = ydif.length > 1 ? ydif.slice(1).reduce((a, b) => a + b, 0) / (ydif.length - 1) : 0;
  return { meanYdif: mean, firstYavg: yavg[0] ?? 0, freezes, frames: ydif.length };
}

function listedClipIds() {
  const src = readFileSync(join(root, "src", "constants", "posterVideos.ts"), "utf8");
  const set = src.match(/POSTER_VIDEO_IDS[^=]*=\s*new Set<GameId>\(\[([\s\S]*?)\]\)/);
  return set ? [...set[1].matchAll(/"([\w-]+)"/g)].map((m) => m[1]) : [];
}

const failures = [];
const fail = (id, msg) => failures.push(`${id}: ${msg}`);
const args = process.argv.slice(2);
const rawIdx = args.indexOf("--raw");

if (rawIdx >= 0) {
  const dir = args[rawIdx + 1];
  const ids = args.filter((_, i) => i !== rawIdx && i !== rawIdx + 1);
  const all = ids.length ? ids : readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
  for (const id of all) {
    const meta = JSON.parse(readFileSync(join(dir, `${id}.json`), "utf8"));
    const file = join(dir, `${id}.webm`);
    if (!meta.ok) { fail(id, `game never started (${meta.error ?? meta.log?.join(" > ") ?? "?"})`); continue; }
    if (!existsSync(file)) { fail(id, "no video written"); continue; }
    const { duration } = probe(file);
    const played = duration - meta.recStart;
    if (played < 60) fail(id, `only ${played.toFixed(0)}s recorded after start`);
    const m = motion(file, { from: meta.recStart, fps: 4, freezeSec: 8 });
    const frozen = m.freezes.reduce((a, b) => a + b, 0);
    if (frozen > played * 0.6) fail(id, `board frozen ${frozen.toFixed(0)}s of ${played.toFixed(0)}s`);
    console.log(`${id.padEnd(18)} ${played.toFixed(0).padStart(4)}s played, motion ${m.meanYdif.toFixed(2)}, frozen ${frozen.toFixed(0)}s`);
  }
} else {
  const ids = listedClipIds();
  for (const id of ids) {
    const files = ["webm", "mp4"].map((ext) => join(root, "public", "posters", `${id}.${ext}`));
    const missing = files.filter((f) => !existsSync(f));
    if (missing.length) { fail(id, `missing ${missing.map((f) => f.split(/[\\/]/).pop()).join(", ")}`); continue; }
    for (const f of files) {
      const p = probe(f);
      const name = f.split(/[\\/]/).pop();
      if (p.width !== 480 || p.height !== 600) fail(id, `${name} is ${p.width}×${p.height}, want 480×600`);
      if (p.duration < 3 || p.duration > 9) fail(id, `${name} lasts ${p.duration.toFixed(1)}s, want 3–9s`);
      if (p.audio) fail(id, `${name} has an audio track`);
      // Full-range VP9 doesn't decode in Chromium (and the mp4 fallback never kicks in).
      if (p.pixFmt !== "yuv420p" || p.range !== "tv") fail(id, `${name} is ${p.pixFmt}/${p.range}, want yuv420p/tv`);
      const kb = statSync(f).size / 1024;
      if (kb > 700) fail(id, `${name} is ${kb.toFixed(0)}KB, want ≤ 700KB`);
    }
    const m = motion(files[0]);
    // Dark-themed games legitimately open around luma 9–20; a blank frame is ~0.
    if (m.firstYavg < 6) fail(id, `first frame is nearly black (luma ${m.firstYavg.toFixed(0)})`);
    if (m.meanYdif < 0.3) fail(id, `too little motion (mean frame change ${m.meanYdif.toFixed(2)})`);
    if (m.freezes.length) fail(id, `frozen for ${Math.max(...m.freezes).toFixed(1)}s`);
    console.log(`${id.padEnd(18)} motion ${m.meanYdif.toFixed(2)}, first luma ${m.firstYavg.toFixed(0)}`);
  }
  if (!ids.length) console.log("no clips listed in posterVideos.ts");
}

if (failures.length) {
  console.error(`\n✗ ${failures.length} problem(s):\n  ` + failures.join("\n  "));
  process.exit(1);
}
console.log("\n✓ all good");
