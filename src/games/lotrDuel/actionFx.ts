/**
 * All-action cinematic FX for 반지의 제왕: 가운데땅에서의 대결 — the
 * one-shot particle bursts that fire on top of `motionFx.ts`'s flights:
 *
 * - `claimBurst`   card taken from the pyramid: golden shockwave ring +
 *                  parchment shards scattering out (disintegration burst)
 * - `drainBeam`    DRAIN_COINS / Ent "drain": a dark tendril reaches into the
 *                  victim's treasury and tears coins out, which crumble to ash
 *                  (the rules send drained coins to the bank, not the actor)
 * - `groundSlam`   units placed on a region: a blade drops from the sky onto
 *                  the region, red/gold shockwave ring + dust cloud
 * - `runeSteps`    ring-track advance: glowing rune footprints on every space
 *                  passed, in step with the markers' 0.2s hops
 * - `sealFanfare`  a race symbol gained: the wax seal spins 360° in mid-air
 *                  and throws out a ring of sparks
 * - `shatter`      enemy fortress / unit / gray card destroyed: 💥 + stone
 *                  fragments flying apart
 *
 * Same contract as `motionFx.ts`: called from the board's post-commit effect
 * with real DOM positions, short-lived elements appended to <body>, animated
 * with the Web Animations API, removed on finish, skipped entirely under
 * `prefers-reduced-motion`. Nothing here touches React state. Particle
 * layouts are deterministic (index-based), never Math.random.
 */

import { centerOf } from "./motionFx";

type Point = { x: number; y: number };

/** Frame colour per card colour (claim burst inner ring / sparks). */
export const CARD_TINT: Record<string, string> = { GRAY: "#94a3b8", GREEN: "#34d399", RED: "#f43f5e", YELLOW: "#fbbf24", BLUE: "#38bdf8", PURPLE: "#a78bfa" };

function reducedMotion(): boolean {
  return typeof window === "undefined" || !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** Appends a fixed, click-through element centred on `at`. */
function spawn(at: Point, w: number, h: number, style: Partial<CSSStyleDeclaration> = {}, html = ""): HTMLDivElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  Object.assign(el.style, {
    position: "fixed",
    left: `${at.x - w / 2}px`,
    top: `${at.y - h / 2}px`,
    width: `${w}px`,
    height: `${h}px`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "none",
    zIndex: "72",
    ...style,
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(el);
  return el;
}

function play(el: HTMLElement, frames: Keyframe[], opts: KeyframeAnimationOptions) {
  const a = el.animate(frames, { fill: "both", ...opts });
  a.onfinish = () => el.remove();
  a.oncancel = () => el.remove();
  return a;
}

/** Expanding ring. */
function ring(at: Point, size: number, color: string, opts: { delay?: number; duration?: number; width?: number; fill?: string } = {}) {
  const el = spawn(at, size, size, {
    borderRadius: "9999px",
    border: `${opts.width ?? 3}px solid ${color}`,
    background: opts.fill ?? "transparent",
    boxShadow: `0 0 18px ${color}, inset 0 0 12px ${color}`,
    opacity: "0",
  });
  play(el, [{ transform: "scale(.25)", opacity: 1 }, { transform: "scale(2.1)", opacity: 0 }], { duration: opts.duration ?? 600, delay: opts.delay ?? 0, easing: "cubic-bezier(.2,.8,.3,1)" });
}

/** Particles flying out radially from `at`. */
function scatter(
  at: Point,
  n: number,
  opts: { dist?: number; delay?: number; duration?: number; size?: number; color?: string; shape?: "dot" | "shard" | "stone"; spin?: boolean; gravity?: number },
) {
  const size = opts.size ?? 6;
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2 + (i % 2 ? 0.25 : 0);
    const dist = (opts.dist ?? 60) * (0.7 + ((i * 7) % 5) * 0.12);
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist + (opts.gravity ?? 0);
    const shape = opts.shape ?? "dot";
    const el = spawn(at, shape === "shard" ? size * 1.6 : size, size, {
      borderRadius: shape === "dot" ? "9999px" : shape === "shard" ? "1px" : "2px",
      background: opts.color ?? "#fcd34d",
      boxShadow: shape === "stone" ? "inset 0 0 2px rgba(0,0,0,.6)" : `0 0 6px ${opts.color ?? "#fcd34d"}`,
      border: shape === "stone" ? "1px solid #a3a3a3" : "none",
      opacity: "0",
    });
    const rot = opts.spin ? 360 + i * 40 : 0;
    play(
      el,
      [
        { transform: "translate(0,0) rotate(0) scale(1)", opacity: 1 },
        { transform: `translate(${dx * 0.6}px, ${dy * 0.6 - 8}px) rotate(${rot * 0.6}deg) scale(1)`, opacity: 1, offset: 0.55 },
        { transform: `translate(${dx}px, ${dy}px) rotate(${rot}deg) scale(.2)`, opacity: 0 },
      ],
      { duration: opts.duration ?? 650, delay: (opts.delay ?? 0) + (i % 3) * 25, easing: "cubic-bezier(.15,.7,.35,1)" },
    );
  }
}

/** Floating caption that rises and fades. */
function caption(at: Point, text: string, color: string, delay = 0) {
  const el = spawn(at, 220, 24, { opacity: "0", zIndex: "73" }, "");
  const chip = document.createElement("span");
  chip.textContent = text;
  Object.assign(chip.style, {
    padding: "2px 10px",
    borderRadius: "9999px",
    border: `1px solid ${color}`,
    background: "rgba(0,0,0,.85)",
    color,
    font: "900 11px ui-serif, Georgia, serif",
    whiteSpace: "nowrap",
    boxShadow: `0 0 10px ${color}`,
  } satisfies Partial<CSSStyleDeclaration>);
  el.appendChild(chip);
  play(
    el,
    [
      { transform: "translateY(6px)", opacity: 0 },
      { transform: "translateY(0)", opacity: 1, offset: 0.2 },
      { transform: "translateY(-6px)", opacity: 1, offset: 0.75 },
      { transform: "translateY(-26px)", opacity: 0 },
    ],
    { duration: 1300, delay, easing: "ease-out" },
  );
}

/** 1. 🃏 Card claimed: golden shockwave + parchment shards disintegrating outwards. */
export function claimBurst(at: Point | null, mode: "PLAY" | "DISCARD", tint: string, label?: string) {
  if (!at || reducedMotion()) return;
  const gold = mode === "PLAY" ? "rgba(251,191,36,.95)" : "rgba(203,213,225,.85)";
  ring(at, 70, gold, { fill: mode === "PLAY" ? "rgba(251,191,36,.15)" : "transparent" });
  ring(at, 50, tint, { delay: 90, width: 2 });
  scatter(at, 12, { dist: 70, color: mode === "PLAY" ? "#fde68a" : "#e2e8f0", shape: "shard", spin: true, size: 6 });
  scatter(at, 10, { dist: 42, color: tint, size: 4, delay: 60 });
  if (label) caption({ x: at.x, y: at.y - 30 }, `${mode === "PLAY" ? "✨" : "🗑️"} ${label}`, mode === "PLAY" ? "#fde68a" : "#cbd5e1", 80);
}

/** 3. 🖐️ Drain: a dark tendril from the actor reaches the victim's treasury and tears `n` coins out, which crumble. */
export function drainBeam(fromEl: Element | null, victimEl: Element | null, n: number, victimIsMe: boolean) {
  if (reducedMotion()) return;
  const from = centerOf(fromEl);
  const to = centerOf(victimEl);
  if (!from || !to) return;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  // the tendril: a thick crimson bar growing from the actor to the victim, then retracting
  const beam = document.createElement("div");
  Object.assign(beam.style, {
    position: "fixed",
    left: `${from.x}px`,
    top: `${from.y - 3}px`,
    width: `${len}px`,
    height: "6px",
    transformOrigin: "0 50%",
    borderRadius: "9999px",
    background: "repeating-linear-gradient(90deg, rgba(225,29,72,.95) 0 10px, rgba(76,5,25,.9) 10px 16px)",
    boxShadow: "0 0 14px rgba(225,29,72,.95), 0 0 30px rgba(127,29,29,.8)",
    pointerEvents: "none",
    zIndex: "71",
    opacity: "0",
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(beam);
  play(
    beam,
    [
      { transform: `rotate(${angle}deg) scaleX(0)`, opacity: 0.9, backgroundPositionX: "0px" },
      { transform: `rotate(${angle}deg) scaleX(1)`, opacity: 1, offset: 0.35, backgroundPositionX: "-32px" },
      { transform: `rotate(${angle}deg) scaleX(1)`, opacity: 1, offset: 0.7, backgroundPositionX: "-64px" },
      { transform: `rotate(${angle}deg) scaleX(0)`, opacity: 0.4, backgroundPositionX: "-96px" },
    ],
    { duration: 1300, easing: "ease-in-out" },
  );
  ring(to, 46, "rgba(225,29,72,.95)", { delay: 420, fill: "rgba(76,5,25,.35)" });
  // torn-out coins: pulled a short way back along the tendril, then crumble to ash
  const pull = Math.min(90, len * 0.35);
  for (let i = 0; i < Math.min(n, 4); i++) {
    const coin = spawn(to, 26, 26, { fontSize: "20px", filter: "drop-shadow(0 0 8px rgba(225,29,72,.95))", opacity: "0" }, "🪙");
    const ox = (-dx / len) * pull + (i - 1) * 10;
    const oy = (-dy / len) * pull - 10;
    play(
      coin,
      [
        { transform: "translate(0,0) scale(.8)", opacity: 0 },
        { transform: "translate(0,-6px) scale(1.2)", opacity: 1, offset: 0.2 },
        { transform: `translate(${ox * 0.7}px, ${oy * 0.7}px) scale(1) rotate(-30deg)`, opacity: 1, offset: 0.6 },
        { transform: `translate(${ox}px, ${oy}px) scale(.3) rotate(-90deg)`, opacity: 0, filter: "grayscale(1) blur(2px)" },
      ],
      { duration: 1000, delay: 450 + i * 130, easing: "cubic-bezier(.4,0,.3,1)" },
    );
    scatter({ x: to.x + ox, y: to.y + oy }, 6, { dist: 18, color: "#57534e", size: 3, delay: 1250 + i * 130, gravity: 16, duration: 700 });
  }
  caption({ x: to.x, y: to.y - 34 }, victimIsMe ? `💸 내 주화 ${n}개 흡수당함!` : `🖐️ 상대 주화 ${n}개 흡수!`, "#fda4af", 350);
}

/** 4. ⚔️ Units placed: a blade drops from the sky onto the region, shockwave ring + dust. */
export function groundSlam(regionEl: Element | null, faction: "FELLOWSHIP" | "SAURON", count: number, delay = 0) {
  if (reducedMotion()) return;
  const at = centerOf(regionEl);
  if (!at) return;
  const color = faction === "FELLOWSHIP" ? "rgba(251,191,36,.95)" : "rgba(244,63,94,.95)";
  const blade = spawn(at, 40, 40, { fontSize: "30px", filter: `drop-shadow(0 0 12px ${color})`, opacity: "0", zIndex: "73" }, "🗡️");
  play(
    blade,
    [
      { transform: "translateY(-130px) rotate(135deg) scale(1.6)", opacity: 0 },
      { transform: "translateY(-60px) rotate(135deg) scale(1.4)", opacity: 1, offset: 0.4 },
      { transform: "translateY(0) rotate(135deg) scale(1.1)", opacity: 1, offset: 0.62 },
      { transform: "translateY(-6px) rotate(135deg) scale(1)", opacity: 1, offset: 0.8 },
      { transform: "translateY(-4px) rotate(135deg) scale(.9)", opacity: 0 },
    ],
    { duration: 1000, delay, easing: "cubic-bezier(.55,0,.75,.4)" },
  );
  const impact = delay + 600;
  ring(at, 80, color, { delay: impact, fill: faction === "FELLOWSHIP" ? "rgba(251,191,36,.12)" : "rgba(244,63,94,.15)" });
  ring(at, 50, "rgba(254,243,199,.7)", { delay: impact + 80, width: 2, duration: 500 });
  // dust cloud hugging the ground
  for (let i = 0; i < 8; i++) {
    const side = i % 2 ? 1 : -1;
    const puff = spawn({ x: at.x, y: at.y + 10 }, 16, 10, { borderRadius: "50%", background: "rgba(214,211,209,.55)", filter: "blur(3px)", opacity: "0" });
    const dx = side * (18 + (i >> 1) * 14);
    play(
      puff,
      [
        { transform: "translate(0,0) scale(.5)", opacity: 0.9 },
        { transform: `translate(${dx}px, ${-4 - (i % 3) * 3}px) scale(1.8)`, opacity: 0 },
      ],
      { duration: 700, delay: impact + (i >> 1) * 30, easing: "ease-out" },
    );
  }
  caption({ x: at.x, y: at.y - 40 }, `⚔️ ${faction === "FELLOWSHIP" ? "원정대" : "사우론"} 군세 +${count}`, faction === "FELLOWSHIP" ? "#fde68a" : "#fda4af", impact);
}

/** 5. 💍 Ring advance: glowing rune footprints on every space passed (one per 0.2s hop). */
export function runeSteps(slots: (Element | null)[], faction: "FELLOWSHIP" | "SAURON") {
  if (reducedMotion()) return;
  const color = faction === "FELLOWSHIP" ? "#fde68a" : "#fb7185";
  const runes = ["ᚠ", "ᚱ", "ᛁ", "ᛜ", "ᛟ", "ᚨ", "ᛖ", "ᛗ"];
  slots.forEach((slot, i) => {
    const at = centerOf(slot);
    if (!at) return;
    const y = at.y + (faction === "FELLOWSHIP" ? -16 : 16);
    const delay = 200 * (i + 1);
    const rune = spawn({ x: at.x, y }, 18, 18, { color, font: "900 14px ui-serif, Georgia, serif", textShadow: `0 0 8px ${color}, 0 0 14px ${color}`, opacity: "0", zIndex: "73" }, runes[i % runes.length]);
    play(
      rune,
      [
        { transform: "translateY(4px) scale(.4)", opacity: 0 },
        { transform: "translateY(0) scale(1.3)", opacity: 1, offset: 0.25 },
        { transform: "translateY(-4px) scale(1)", opacity: 0.9, offset: 0.6 },
        { transform: "translateY(-14px) scale(.8)", opacity: 0 },
      ],
      { duration: 900, delay, easing: "ease-out" },
    );
    scatter({ x: at.x, y }, 5, { dist: 14, color, size: 3, delay: delay + 60, duration: 500 });
  });
}

/** 7. 🌿 Race support: the seal spins 360° in mid-air above `at` with a ring of sparks (fanfare). */
export function sealFanfare(at: Point | null, emoji: string, glow = "rgba(52,211,153,.95)") {
  if (!at || reducedMotion()) return;
  const top = { x: at.x, y: at.y - 46 };
  const seal = spawn(top, 44, 44, { fontSize: "32px", filter: `drop-shadow(0 0 14px ${glow})`, opacity: "0", zIndex: "73" }, emoji);
  play(
    seal,
    [
      { transform: "scale(.3) rotateY(0deg)", opacity: 0 },
      { transform: "scale(1.5) rotateY(180deg)", opacity: 1, offset: 0.45 },
      { transform: "scale(1.2) rotateY(360deg)", opacity: 1, offset: 0.8 },
      { transform: "scale(.9) rotateY(360deg)", opacity: 0 },
    ],
    { duration: 950, easing: "cubic-bezier(.2,.8,.3,1)" },
  );
  ring(top, 56, glow, { delay: 380 });
  scatter(top, 14, { dist: 58, color: "#fef08a", size: 4, delay: 400, spin: true, shape: "shard" });
}

/** 8. 💥 Enemy fortress / unit / card destroyed: blast + stone fragments. */
export function shatter(target: Element | null, what: "FORTRESS" | "UNIT" | "CARD", delay = 0) {
  if (reducedMotion()) return;
  const at = centerOf(target);
  if (!at) return;
  const big = what === "FORTRESS";
  const blast = spawn(at, 48, 48, { fontSize: big ? "36px" : "26px", filter: "drop-shadow(0 0 16px rgba(239,68,68,1))", opacity: "0", zIndex: "73" }, "💥");
  play(
    blast,
    [
      { transform: "scale(.4)", opacity: 0 },
      { transform: "scale(1.5)", opacity: 1, offset: 0.35 },
      { transform: "scale(1.9)", opacity: 0 },
    ],
    { duration: 700, delay, easing: "ease-out" },
  );
  ring(at, big ? 70 : 50, "rgba(239,68,68,.9)", { delay: delay + 60 });
  scatter(at, big ? 10 : 7, { dist: big ? 75 : 50, shape: "stone", color: what === "CARD" ? "#78716c" : "#525252", size: big ? 9 : 6, spin: true, gravity: 22, delay: delay + 40, duration: 800 });
  scatter(at, 8, { dist: big ? 45 : 30, color: "#fb923c", size: 3, delay: delay + 20 });
  caption({ x: at.x, y: at.y - 38 }, what === "FORTRESS" ? "🏰 요새 분쇄!" : what === "UNIT" ? "🎯 적 유닛 제거!" : "🔨 기술 카드 파괴!", "#fca5a5", delay + 150);
}
