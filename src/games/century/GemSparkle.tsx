import { useEffect, useRef } from "react";
import { GEM } from "./ResourceIcon";
import type { Resource } from "./cards";

/**
 * One-shot "gem just landed" sparkle, mounted inside a caravan well
 * (CartInventory) on the slot a newly acquired spice fills. Four layers:
 * the cube itself pops (scale + brightness flash), a colored halo ring
 * expands out of the well, a four-point star glint twists across it, and a
 * few sparkle motes fly outward.
 *
 * Driven by the Web Animations API (`element.animate`) rather than CSS
 * keyframes so this stays self-contained in the century module — no
 * globals.css entry, and replaying is just remounting with a new `key`
 * (CartInventory keys each sparkle on a per-acquisition nonce + slot index,
 * so two sparkles never share a key). Skipped entirely under
 * prefers-reduced-motion. `compact` shrinks the halo/star/motes for the
 * small opponent-summary and mobile wells.
 */
export function GemSparkle({ resource, compact = false }: { resource: Resource; compact?: boolean }) {
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const g = GEM[resource];

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof root.animate !== "function") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const anims: Animation[] = [];
    const cube = root.parentElement?.querySelector<HTMLElement>("[role=img]");
    if (cube) {
      anims.push(
        cube.animate(
          [
            { transform: "scale(0.35)", filter: "brightness(2.2) saturate(1.4)" },
            { transform: "scale(1.28)", filter: "brightness(1.7) saturate(1.3)", offset: 0.35 },
            { transform: "scale(0.94)", filter: "brightness(1.15)", offset: 0.65 },
            { transform: "scale(1)", filter: "brightness(1)" },
          ],
          { duration: 700, easing: "cubic-bezier(.2,.8,.3,1)" },
        ),
      );
    }
    root.querySelectorAll<HTMLElement>("[data-part]").forEach((el) => {
      const part = el.dataset.part;
      if (part === "halo") {
        anims.push(
          el.animate(
            [
              { transform: "scale(0.5)", opacity: 0.95 },
              { transform: "scale(1.9)", opacity: 0 },
            ],
            { duration: 750, easing: "cubic-bezier(.1,.7,.3,1)", fill: "forwards" },
          ),
        );
      } else if (part === "star") {
        anims.push(
          el.animate(
            [
              { transform: "translate(-50%,-50%) scale(0) rotate(-40deg)", opacity: 0 },
              { transform: "translate(-50%,-50%) scale(1.15) rotate(20deg)", opacity: 1, offset: 0.35 },
              { transform: "translate(-50%,-50%) scale(0) rotate(70deg)", opacity: 0 },
            ],
            { duration: 850, delay: 80, easing: "ease-out", fill: "both" },
          ),
        );
      } else if (part === "mote") {
        const dx = Number(el.dataset.dx);
        const dy = Number(el.dataset.dy);
        anims.push(
          el.animate(
            [
              { transform: "translate(-50%,-50%) scale(0.4)", opacity: 0 },
              { transform: "translate(-50%,-50%) scale(1)", opacity: 1, offset: 0.2 },
              { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.2)`, opacity: 0 },
            ],
            { duration: 800, delay: 120, easing: "cubic-bezier(.2,.7,.4,1)", fill: "both" },
          ),
        );
      }
    });
    // Strict Mode mounts effects twice; cancel so the second run starts clean.
    return () => anims.forEach((a) => a.cancel());
  }, []);

  const reach = compact ? 9 : 22;
  const motes = [0, 60, 120, 180, 240, 300].map((deg, i) => {
    const rad = (deg * Math.PI) / 180;
    const d = reach * (i % 2 === 0 ? 1 : 0.7);
    return { dx: Math.round(Math.cos(rad) * d), dy: Math.round(Math.sin(rad) * d) };
  });
  const star = compact ? 12 : 26;
  const mote = compact ? 2 : 3.5;

  return (
    <span ref={rootRef} className="pointer-events-none absolute inset-0 z-10" aria-hidden="true">
      <span
        data-part="halo"
        className="absolute inset-0 rounded-full"
        style={{ opacity: 0, boxShadow: `0 0 0 2px ${g.glint}, 0 0 10px 3px ${g.mid}` }}
      />
      <svg data-part="star" viewBox="0 0 20 20" className="absolute top-1/2 left-1/2" style={{ width: star, height: star, opacity: 0 }}>
        <path d="M10 0 L11.6 8.4 L20 10 L11.6 11.6 L10 20 L8.4 11.6 L0 10 L8.4 8.4 Z" fill={g.glint} />
        <circle cx="10" cy="10" r="2.2" fill="#fff" />
      </svg>
      {motes.map((m, i) => (
        <span
          key={i}
          data-part="mote"
          data-dx={m.dx}
          data-dy={m.dy}
          className="absolute top-1/2 left-1/2 rounded-full"
          style={{ width: mote, height: mote, opacity: 0, background: i % 2 === 0 ? g.glint : g.hi, boxShadow: `0 0 4px ${g.mid}` }}
        />
      ))}
    </span>
  );
}
