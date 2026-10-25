#!/usr/bin/env node
/**
 * Opening-seconds smoothness of a 3D table on a phone-like profile (opt-in; not part of `npm test`).
 *
 *   npm run check:3d-perf              # 15 s, 4× CPU throttle
 *   npm run check:3d-perf -- 25 6      # seconds, CPU throttle rate
 *
 * Bundles entry.tsx (8-player Avalon, lowDetail) with rolldown, opens it in headless Chromium
 * at 390×844 / devicePixelRatio 3 on the software GPU, and prints one row per second: frames,
 * the longest frame (a stall) and the pixel ratio the canvas is drawn at — so you can see when
 * AdaptiveResolution steps down and how long the opening freezes last.
 *
 * Software rendering exaggerates GPU cost; read it as a regression check (before/after a
 * change), and confirm on a real phone with `?perf=1` on any 3D table.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "rolldown";
import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const out = path.join(os.tmpdir(), "boardgame-3d-perf");
mkdirSync(out, { recursive: true });

const SECONDS = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 15;
const THROTTLE = Number(process.argv[3]) > 0 ? Number(process.argv[3]) : 4;

function findChromium() {
  if (process.env.CHROMIUM_PATH && existsSync(process.env.CHROMIUM_PATH)) return process.env.CHROMIUM_PATH;
  try {
    const p = chromium.executablePath();
    if (p && existsSync(p)) return p;
  } catch {
    /* fall through to the cache scan */
  }
  const caches = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "ms-playwright"),
    path.join(os.homedir(), ".cache", "ms-playwright"),
    path.join(os.homedir(), "Library", "Caches", "ms-playwright"),
  ].filter(Boolean);
  for (const dir of caches) {
    if (!existsSync(dir)) continue;
    const builds = readdirSync(dir).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
    for (const b of builds) {
      for (const rel of ["chrome-win64/chrome.exe", "chrome-win/chrome.exe", "chrome-linux/chrome", "chrome-linux64/chrome", "chrome-mac/Chromium.app/Contents/MacOS/Chromium"]) {
        const p = path.join(dir, b, rel);
        if (existsSync(p)) return p;
      }
    }
  }
  return null;
}

const exe = findChromium();
if (!exe) {
  console.error("No Chromium found. Set CHROMIUM_PATH or run `npx playwright install chromium`.");
  process.exit(2);
}

console.log("bundling the table…");
await build({
  input: path.join(here, "entry.tsx"),
  cwd: root,
  logLevel: "silent",
  resolve: { alias: { "@": path.join(root, "src") } },
  transform: {
    jsx: "react-jsx",
    define: {
      "process.env.NODE_ENV": '"production"',
      "process.env.NEXT_PUBLIC_SUPABASE_URL": '""',
      "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": '""',
    },
  },
  output: { file: path.join(out, "table.js"), format: "iife" },
});
// a rAF probe outside React: [ms since start, frame ms, canvas pixel ratio]
writeFileSync(
  path.join(out, "table.html"),
  `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#000"><div id="root"></div><script>
window.__log=[];(function(){let last=performance.now(),t0=last;function f(n){const c=document.querySelector("canvas");window.__log.push([n-t0,n-last,c&&c.clientWidth?c.width/c.clientWidth:0]);last=n;requestAnimationFrame(f)}requestAnimationFrame(f)})();
</script><script src="table.js"></script>`,
);

const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
  console.log(`running ${SECONDS}s at ${THROTTLE}× CPU throttle, 390×844 @3x…\n`);
  await page.goto(pathToFileURL(path.join(out, "table.html")).href);
  await page.waitForTimeout(SECONDS * 1000);
  const log = await page.evaluate(() => window.__log);
  let lastDpr = 0;
  let settledAt = null;
  for (let s = 0; s < SECONDS; s++) {
    const f = log.filter(([t]) => t >= s * 1000 && t < (s + 1) * 1000);
    const worst = Math.round(Math.max(0, ...f.map((r) => r[1])));
    const dpr = f.length ? f[f.length - 1][2] : lastDpr;
    if (lastDpr && dpr && Math.abs(dpr - lastDpr) > 0.01 && s > 1) settledAt = s;
    if (dpr) lastDpr = dpr;
    console.log(`${String(s).padStart(3)}s  frames ${String(f.length).padStart(3)}  longest ${String(worst).padStart(5)}ms  dpr ${dpr ? dpr.toFixed(2) : "-"}`);
  }
  const stalls = log.filter((r) => r[1] > 500).length;
  console.log(`\nframes >500ms: ${stalls} · last pixel-ratio change: ${settledAt === null ? "none" : `${settledAt}s`} · final dpr ${lastDpr.toFixed(2)}`);
  if (errors.length) {
    console.error("page errors:\n  " + errors.slice(0, 5).join("\n  "));
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
