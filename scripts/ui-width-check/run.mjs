#!/usr/bin/env node
/**
 * Phone-width check for the merge-defense screens (opt-in; not part of `npm test`).
 *
 *   npm run check:ui-width            # 320 / 360 / 375 / 414 px
 *   npm run check:ui-width -- 320     # custom widths
 *
 * Bundles the real components (entry.tsx) with rolldown, compiles the site's
 * own Tailwind CSS (src/app/globals.css), opens each screen in headless
 * Chromium and fails if any element sticks out past the viewport. Screenshots
 * land in the printed temp folder for a look.
 *
 * Needs a Chromium: set CHROMIUM_PATH, or have one in the Playwright cache
 * (`npx playwright install chromium`). playwright-core itself downloads none.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "rolldown";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const out = path.join(os.tmpdir(), "boardgame-ui-width");
mkdirSync(out, { recursive: true });

const widths = process.argv.slice(2).map(Number).filter((n) => n > 0);
const WIDTHS = widths.length > 0 ? widths : [320, 360, 375, 414];
const SCREENS = ["board-survival", "board-versus", "board-plaza", "board-figure8", "board-diamond", "board-intro", "lobby", "lobby-create", "lobby-shared", "waiting-host", "waiting-guest", "results-versus", "results-survival"];

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

console.log("bundling components…");
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
  output: { file: path.join(out, "screens.js"), format: "iife" },
});

console.log("compiling site CSS…");
const cssPath = path.join(root, "src/app/globals.css");
const css = await postcss([tailwind({ base: root })]).process(readFileSync(cssPath, "utf8"), { from: cssPath });
writeFileSync(path.join(out, "screens.css"), css.css);
writeFileSync(
  path.join(out, "screens.html"),
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="screens.css"></head><body style="margin:0;background:#0b0b12;color:#f4f4f5"><div id="root"></div><script src="screens.js"></script></body></html>`,
);

const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const failures = [];
try {
  for (const width of WIDTHS) {
    const page = await browser.newPage({ viewport: { width, height: 800 }, deviceScaleFactor: 2 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    for (const name of SCREENS) {
      const target = name === "lobby-create" || name === "lobby-shared" ? "lobby" : name;
      // lobby-shared: opened from a friend's 🤖 자동 preset link (합성 장인 · 합성·강화 · 💎3 · 골드 500+).
      const extra = name === "lobby-shared" ? "&autopreset=WzEsIu2VqeyEsSDsnqXsnbgiLDYsNTAwLDNd" : "";
      await page.goto(`${pathToFileURL(path.join(out, "screens.html")).href}?screen=${target}${extra}`);
      await page.waitForSelector("#root > *", { timeout: 30_000 });
      if (name.startsWith("results")) await page.waitForSelector("figure", { timeout: 60_000 });
      if (name === "lobby-create") await page.locator('button:has-text("방 만들기")').first().click();
      await page.waitForTimeout(300);
      const over = await page.evaluate(() => {
        const vw = window.innerWidth;
        const bad = [];
        for (const el of document.querySelectorAll("#root *")) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          // Children of a horizontal scroller (or clipped boxes) may extend past it on purpose.
          let clipped = false;
          for (let p = el.parentElement; p && p.id !== "root"; p = p.parentElement) {
            const ox = getComputedStyle(p).overflowX;
            if (ox === "auto" || ox === "scroll" || ox === "hidden") {
              clipped = true;
              break;
            }
          }
          if (!clipped && r.right > vw + 0.5) bad.push(`<${el.tagName.toLowerCase()}> right=${Math.round(r.right)} "${(el.textContent ?? "").trim().slice(0, 30)}"`);
        }
        const scroller = [...document.querySelectorAll("#root *")].filter((el) => {
          const ox = getComputedStyle(el).overflowX;
          return (ox === "auto" || ox === "scroll") && el.scrollWidth > el.clientWidth + 1;
        });
        return {
          pageScroll: document.documentElement.scrollWidth > vw,
          bad: bad.slice(0, 5),
          scrollers: scroller.map((el) => `<${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 50)}"> ${el.scrollWidth}/${el.clientWidth} "${(el.textContent ?? "").trim().slice(0, 24)}"`),
        };
      });
      await page.screenshot({ path: path.join(out, `${name}-${width}.png`), fullPage: true });
      const ok = !over.pageScroll && over.bad.length === 0 && over.scrollers.length === 0 && errors.length === 0;
      console.log(`${ok ? "PASS" : "FAIL"}  ${String(width).padStart(4)}px  ${name}`);
      if (!ok) failures.push({ width, name, ...over, errors: errors.splice(0) });
    }
    await page.close();
  }
} finally {
  await browser.close();
}

console.log(`\nscreenshots: ${out}`);
if (failures.length > 0) {
  for (const f of failures) {
    console.log(`\n✗ ${f.name} @ ${f.width}px`);
    if (f.pageScroll) console.log("  page scrolls sideways");
    for (const b of f.bad) console.log(`  past the edge: ${b}`);
    for (const s of f.scrollers) console.log(`  needs a sideways scroll: ${s}`);
    for (const e of f.errors) console.log(`  page error: ${e}`);
  }
  process.exit(1);
}
console.log("all screens fit.");
