"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { distanceBoost } from "./ScreenSprite";
import { bubbleTexture, clamp01, easeOutBack, type BubbleStyle } from "./tableKit";

/**
 * A speech-bubble sprite that pops in (overshoot) whenever `popKey` changes
 * and bobs gently. Always drawn on top so it never hides behind a head.
 */
export default function SpeechBubble({ text, style, y, popKey, width = 0.95 }: { text: string; style: BubbleStyle; y: number; popKey: string; width?: number }) {
  const ref = useRef<THREE.Sprite>(null);
  const born = useRef<{ key: string; at: number }>({ key: "", at: 0 });
  const { tex, aspect } = useMemo(() => bubbleTexture(text, { size: 52, ...style }), [text, style]);
  useFrame(({ clock, camera }) => {
    const s = ref.current;
    if (!s) return;
    if (born.current.key !== popKey) born.current = { key: popKey, at: clock.elapsedTime };
    const pop = easeOutBack(clamp01((clock.elapsedTime - born.current.at) / 0.35));
    const k = distanceBoost(s, camera, 3.4, 2.2);
    const w = width * pop * k;
    s.scale.set(w, w * aspect, 1);
    s.position.y = y + (width * aspect * (k - 1)) / 2 + Math.sin(clock.elapsedTime * 2 + y) * 0.02;
  });
  return (
    <sprite ref={ref} position={[0, y, 0]} renderOrder={10}>
      <spriteMaterial map={tex} transparent depthWrite={false} depthTest={false} />
    </sprite>
  );
}
