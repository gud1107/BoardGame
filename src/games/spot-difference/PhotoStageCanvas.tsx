"use client";

import { useEffect, useRef } from "react";
import type { PhotoDiffSpot } from "./engine";

/**
 * Renders one side (original or modified) of a user-uploaded photo stage.
 * The "modified" side is produced by applying each spot's seeded `effect`
 * to a small circular region of the *same* source image via the Canvas 2D
 * API — no server round-trip, no image library. Every client renders this
 * from the same `imageDataUrl` (broadcast once at game-start) and the same
 * deterministic `spots` (derived purely from the shared seed in engine.ts),
 * so every device ends up pixel-identical without transmitting the result.
 */
export default function PhotoStageCanvas({
  imageDataUrl,
  spots,
  variant,
  className,
}: {
  imageDataUrl: string;
  spots: PhotoDiffSpot[];
  variant: "original" | "modified";
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    const img = new window.Image();
    img.onload = () => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);
      if (variant === "modified") {
        for (const spot of spots) applyDiffEffect(ctx, img, spot, canvas.width, canvas.height);
      }
    };
    img.src = imageDataUrl;
    return () => {
      cancelled = true;
    };
  }, [imageDataUrl, spots, variant]);

  return <canvas ref={canvasRef} className={className} />;
}

function applyDiffEffect(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  spot: PhotoDiffSpot,
  width: number,
  height: number,
) {
  const cx = (spot.xPct / 100) * width;
  const cy = (spot.yPct / 100) * height;
  const r = (spot.rPct / 100) * Math.min(width, height);
  const sx = cx - r;
  const sy = cy - r;
  const size = r * 2;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();

  switch (spot.effect) {
    case "hue":
      ctx.filter = `hue-rotate(${Math.round(110 + spot.intensity * 150)}deg) saturate(1.7)`;
      ctx.drawImage(img, sx, sy, size, size, sx, sy, size, size);
      break;
    case "invert":
      ctx.filter = "invert(1)";
      ctx.drawImage(img, sx, sy, size, size, sx, sy, size, size);
      break;
    case "grayscale":
      ctx.filter = "grayscale(1) brightness(1.15)";
      ctx.drawImage(img, sx, sy, size, size, sx, sy, size, size);
      break;
    case "blur":
      ctx.filter = `blur(${(3 + spot.intensity * 5).toFixed(1)}px)`;
      ctx.drawImage(img, sx - r, sy - r, size + r * 2, size + r * 2, sx - r, sy - r, size + r * 2, size + r * 2);
      break;
    case "tint":
      ctx.drawImage(img, sx, sy, size, size, sx, sy, size, size);
      ctx.fillStyle = `hsla(${Math.round(spot.intensity * 360)}, 90%, 55%, 0.45)`;
      ctx.fillRect(sx, sy, size, size);
      break;
    case "mirror":
      // Mirrors this patch horizontally around its own center (cx) — the
      // scale/translate pair maps x -> 2*cx - x, which stays inside the
      // already-clipped circle since the patch is symmetric about cx.
      ctx.translate(cx * 2, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(img, sx, sy, size, size, sx, sy, size, size);
      break;
    case "mosaic": {
      const resolution = Math.max(3, Math.round(7 - spot.intensity * 4));
      const tiny = document.createElement("canvas");
      tiny.width = resolution;
      tiny.height = resolution;
      const tinyCtx = tiny.getContext("2d");
      if (tinyCtx) {
        tinyCtx.drawImage(img, sx, sy, size, size, 0, 0, resolution, resolution);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(tiny, 0, 0, resolution, resolution, sx, sy, size, size);
      }
      break;
    }
  }

  ctx.restore();
}
