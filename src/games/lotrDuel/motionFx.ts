/**
 * Imperative motion FX for 반지의 제왕: 가운데땅에서의 대결 — flying coins,
 * tech runes and race seals that travel between two on-screen elements.
 *
 * These need real DOM positions (the taken card's ghost, the HUD slot), so
 * they run after React commits: the board's effect calls `flyTo`, which
 * appends a short-lived element to <body> and animates it with the Web
 * Animations API along a parabola, then removes it. Nothing here touches
 * React state, and it's skipped entirely under `prefers-reduced-motion`.
 */

type Point = { x: number; y: number };

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export function centerOf(el: Element | null | undefined): Point | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Finds the first element matching `selector` that is actually visible. */
export function visible(selector: string): Element | null {
  for (const el of Array.from(document.querySelectorAll(selector))) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

/**
 * Flies `html` (an emoji or small markup) from `from` to the centre of `to`,
 * arcing upwards first; `onLand` fires when it arrives.
 */
export function flyTo(html: string, from: Point, to: Element, opts: { delay?: number; duration?: number; size?: number; glow?: string; onLand?: () => void } = {}) {
  if (typeof document === "undefined" || reducedMotion()) {
    opts.onLand?.();
    return;
  }
  const end = centerOf(to);
  if (!end) return;
  const size = opts.size ?? 26;
  const el = document.createElement("div");
  el.innerHTML = html;
  Object.assign(el.style, {
    position: "fixed",
    left: `${from.x - size / 2}px`,
    top: `${from.y - size / 2}px`,
    width: `${size}px`,
    height: `${size}px`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: `${size * 0.8}px`,
    zIndex: "70",
    pointerEvents: "none",
    filter: `drop-shadow(0 0 8px ${opts.glow ?? "rgba(251,191,36,.95)"})`,
    opacity: "0",
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(el);
  const dx = end.x - from.x;
  const dy = end.y - from.y;
  const lift = Math.min(140, 50 + Math.abs(dx) * 0.15);
  const anim = el.animate(
    [
      { transform: "translate(0,0) scale(.6) rotate(0)", opacity: 0 },
      { transform: "translate(0,-14px) scale(1.35) rotate(-20deg)", opacity: 1, offset: 0.12 },
      { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - lift}px) scale(1.15) rotate(160deg)`, opacity: 1, offset: 0.5 },
      { transform: `translate(${dx}px, ${dy}px) scale(.55) rotate(360deg)`, opacity: 0.9 },
    ],
    { duration: opts.duration ?? 700, delay: opts.delay ?? 0, easing: "cubic-bezier(.35,.1,.3,1)", fill: "both" },
  );
  anim.onfinish = () => {
    el.remove();
    opts.onLand?.();
  };
  anim.oncancel = () => el.remove();
}

/** A quick "bump" on a HUD element when something lands in it. */
export function bump(el: Element | null, ring = "rgba(251,191,36,.9)") {
  if (!el || reducedMotion()) return;
  (el as HTMLElement).animate(
    [
      { transform: "scale(1)", boxShadow: "0 0 0 0 transparent" },
      { transform: "scale(1.28) translateY(-3px)", boxShadow: `0 0 18px 4px ${ring}` },
      { transform: "scale(.94)", boxShadow: `0 0 10px 2px ${ring}` },
      { transform: "scale(1)", boxShadow: "0 0 0 0 transparent" },
    ],
    { duration: 520, easing: "ease-out" },
  );
}

/** A golden embossed ring spinning 360° around a slot (tech imprint). */
export function imprint(el: Element | null) {
  if (!el || reducedMotion()) return;
  const c = centerOf(el);
  if (!c) return;
  const ring = document.createElement("div");
  const r = (el as HTMLElement).getBoundingClientRect();
  const d = Math.max(r.width, r.height) + 14;
  Object.assign(ring.style, {
    position: "fixed",
    left: `${c.x - d / 2}px`,
    top: `${c.y - d / 2}px`,
    width: `${d}px`,
    height: `${d}px`,
    borderRadius: "9999px",
    border: "3px dashed rgba(251,191,36,.95)",
    boxShadow: "0 0 16px rgba(251,191,36,.8), inset 0 0 10px rgba(251,191,36,.5)",
    zIndex: "70",
    pointerEvents: "none",
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(ring);
  const a = ring.animate(
    [
      { transform: "scale(1.6) rotate(0)", opacity: 0 },
      { transform: "scale(1) rotate(180deg)", opacity: 1, offset: 0.45 },
      { transform: "scale(1.1) rotate(360deg)", opacity: 0 },
    ],
    { duration: 800, easing: "ease-out" },
  );
  a.onfinish = () => ring.remove();
  a.oncancel = () => ring.remove();
  bump(el);
}
