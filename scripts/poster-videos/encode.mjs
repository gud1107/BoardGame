// Cuts the hand-picked highlight of each raw bot-game recording into the
// lobby hover clips: public/posters/<id>.webm (VP9) + <id>.mp4 (H.264).
//
//   node scripts/poster-videos/encode.mjs [--raw <dir>] [id ...]
//
// Raw recordings (<dir>/<id>.webm, from record.cjs) are not committed — only
// the choices in highlights.json are: { from, to } seconds in the raw video,
// crop [x, y, w, h] in raw pixels (4:5), optional speed (>1 = faster), optional
// crfBoost (higher = smaller file, for busy real-time scenes over the size cap),
// optional stillAt (raw second) → also writes the card's still <id>.webp.
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const args = process.argv.slice(2);
const rawIdx = args.indexOf("--raw");
const rawDir = rawIdx >= 0 ? args.splice(rawIdx, 2)[1] : process.env.POSTER_RAW_DIR;
if (!rawDir) throw new Error("pass --raw <dir> (or POSTER_RAW_DIR) with the raw recordings");
const highlights = JSON.parse(readFileSync(join(here, "highlights.json"), "utf8"));
const ids = args.length ? args : Object.keys(highlights);

for (const id of ids) {
  const h = highlights[id];
  if (!h) throw new Error(`no highlight for ${id}`);
  const [x, y, w, cropH] = h.crop;
  const speed = h.speed ?? 1;
  const boost = h.crfBoost ?? 0;
  // Playwright records full-range ("pc") video; Chromium fails to decode a
  // full-range VP9 clip (PIPELINE_ERROR_DECODE) and won't fall back to the
  // mp4 <source>, so convert to standard-range yuv420p.
  const vf = [`crop=${w}:${cropH}:${x}:${y}`, "scale=480:600:flags=lanczos:out_range=tv", "format=yuv420p", `setpts=PTS/${speed}`, "fps=30"].join(",");
  const input = ["-y", "-loglevel", "error", "-ss", String(h.from), "-to", String(h.to), "-i", join(rawDir, `${id}.webm`), "-vf", vf, "-an", "-color_range", "tv"];
  const webm = join(root, "public", "posters", `${id}.webm`);
  const mp4 = join(root, "public", "posters", `${id}.mp4`);
  execFileSync("ffmpeg", [...input, "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", String(38 + boost), "-row-mt", "1", "-deadline", "good", "-cpu-used", "2", webm], { stdio: "inherit" });
  execFileSync("ffmpeg", [...input, "-c:v", "libx264", "-crf", String(27 + boost / 2), "-preset", "slow", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4], { stdio: "inherit" });
  const kb = (p) => Math.round(statSync(p).size / 1024);
  console.log(`${id}: webm ${kb(webm)}KB, mp4 ${kb(mp4)}KB`);
  // Games that had no still capture get one from the same recording, so the
  // card's still and its clip show the same scene (`stillAt` = raw second).
  if (h.stillAt !== undefined) {
    const webp = join(root, "public", "posters", `${id}.webp`);
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(h.stillAt), "-i", join(rawDir, `${id}.webm`), "-vf", `crop=${w}:${cropH}:${x}:${y},scale=480:600:flags=lanczos`, "-frames:v", "1", "-c:v", "libwebp", "-quality", "74", webp], { stdio: "inherit" });
    console.log(`${id}: still ${kb(webp)}KB`);
  }
}
