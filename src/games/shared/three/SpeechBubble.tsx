"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { clampIntoView, distanceBoost, screenBoost } from "./ScreenSprite";
import { bubbleTexture, clamp01, easeOutBack, type BubbleStyle } from "./tableKit";

const UP = new THREE.Vector3(0, 1, 0);
const tip = new THREE.Vector3();
const end = new THREE.Vector3();
const dir = new THREE.Vector3();

/**
 * A speech-bubble sprite that pops in (overshoot) whenever `popKey` changes
 * and bobs gently. Always drawn on top so it never hides behind a head.
 *
 * When the bubble has to be pulled in from the screen edge (clampIntoView), its tail no longer
 * sits over the speaker — on a 4+ seat table it would point at the neighbour. A leader line in
 * the speaker's colour then runs from the tail tip to just above the speaker's head (off screen:
 * toward them), ending in a dot.
 */
export default function SpeechBubble({ text, style, y, popKey, width = 0.95, anchorY }: { text: string; style: BubbleStyle; y: number; popKey: string; width?: number; anchorY?: number }) {
  const ref = useRef<THREE.Sprite>(null);
  const leader = useRef<THREE.Mesh>(null);
  const dot = useRef<THREE.Mesh>(null);
  const born = useRef<{ key: string; at: number }>({ key: "", at: 0 });
  const lineColor = style.whoColor ?? style.border;
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
    const moved = Math.hypot(s.position.x, s.position.z) > 0.15;
    const l = leader.current;
    const d = dot.current;
    if (l && d) {
      l.visible = d.visible = moved && pop > 0.5;
      if (moved) {
        // parent-local: from the tail tip (bottom of the sprite) to just above the speaker
        tip.set(s.position.x, s.position.y - (w * aspect) / 2, s.position.z);
        end.set(0, anchorY ?? y - 0.3, 0);
        dir.subVectors(end, tip);
        const len = dir.length();
        l.position.copy(tip).addScaledVector(dir, 0.5);
        l.quaternion.setFromUnitVectors(UP, dir.normalize());
        l.scale.set(k, len, k);
        d.position.copy(end);
        d.scale.setScalar(k);
      }
    }
  });
  return (
    <>
      <sprite ref={ref} position={[0, y, 0]} renderOrder={10}>
        <spriteMaterial map={tex} transparent depthWrite={false} depthTest={false} />
      </sprite>
      <mesh ref={leader} visible={false} renderOrder={9}>
        <cylinderGeometry args={[0.012, 0.012, 1, 6]} />
        <meshBasicMaterial color={lineColor} depthTest={false} depthWrite={false} transparent opacity={0.95} />
      </mesh>
      <mesh ref={dot} visible={false} renderOrder={9}>
        <sphereGeometry args={[0.04, 12, 8]} />
        <meshBasicMaterial color={lineColor} depthTest={false} depthWrite={false} transparent opacity={0.95} />
      </mesh>
    </>
  );
}
