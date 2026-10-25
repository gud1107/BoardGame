"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { clampIntoView, distanceBoost, screenBoost } from "./ScreenSprite";
import { bubbleTexture, clamp01, easeOutBack, type BubbleStyle } from "./tableKit";

/**
 * A speech-bubble sprite that pops in (overshoot) whenever `popKey` changes
 * and bobs gently. Always drawn on top so it never hides behind a head.
 */
export default function SpeechBubble({ text, style, y, popKey, width = 0.95, anchorY }: { text: string; style: BubbleStyle; y: number; popKey: string; width?: number; anchorY?: number }) {
  const ref = useRef<THREE.Sprite>(null);
  const born = useRef<{ key: string; at: number }>({ key: "", at: 0 });
  const { tex, aspect } = useMemo(() => bubbleTexture(text, { size: 52, ...style }), [text, style]);
  useFrame(({ clock, camera, size }) => {
    const s = ref.current;
    if (!s) return;
    if (born.current.key !== popKey) born.current = { key: popKey, at: clock.elapsedTime };
    const pop = easeOutBack(clamp01((clock.elapsedTime - born.current.at) / 0.35));
    // reset to the authored spot before measuring, then keep it on screen
    s.position.x = 0;
    s.position.z = 0;
    const k = distanceBoost(s, camera, 3.4, 2.2) * screenBoost(size.width);
    const w = width * pop * k;
    s.scale.set(w, w * aspect, 1);
    const bob = Math.sin(clock.elapsedTime * 2 + y) * 0.02;
    s.position.y = (anchorY === undefined ? y + (width * aspect * (k - 1)) / 2 : anchorY + (y + (width * aspect) / 2 - anchorY) * k) + bob;
    clampIntoView(s, camera, w / 2);
  });
  return (
    <sprite ref={ref} position={[0, y, 0]} renderOrder={10}>
      <spriteMaterial map={tex} transparent depthWrite={false} depthTest={false} />
    </sprite>
  );
}
