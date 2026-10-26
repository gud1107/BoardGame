"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { blinking } from "@/games/shared/three/SeatedPerson";
import VrmPerson from "@/games/shared/three/VrmPerson";
import { resolveLook, type AvatarProfile } from "@/lib/character/avatar";

/**
 * Portrait thumbnails (the preset list, and the player's own character for the
 * profile picture), rendered with the real table rig (so they can never drift
 * from what the games show) on ONE hidden canvas — a WebGL context per card
 * would hit the browser's context limit. Results are cached for the tab under
 * each item's `key`, so reopening the picker is instant.
 */
export interface ThumbItem {
  key: string;
  look: AvatarProfile;
}

const cache = new Map<string, string>();

export function cachedThumb(key: string): string | undefined {
  return cache.get(key);
}

function Shooter({ items, onShot }: { items: readonly ThumbItem[]; onShot: (key: string, url: string) => void }) {
  const { gl } = useThree();
  const todo = useMemo(() => items.filter((p) => !cache.has(p.key)), [items]);
  const [i, setI] = useState(0);
  const frames = useRef(0);
  // the VRM swaps in for the cartoon stand-in once loaded — never shoot the stand-in
  const [ready, setReady] = useState<string | null>(null);
  const p = todo[i];
  const look = useMemo(() => (p ? resolveLook(0, ["none"], p.look) : null), [p]);
  const pos = useMemo(() => new THREE.Vector3(0, 0, 0), []);
  const eye = useMemo(() => new THREE.Vector3(0, 1.62, 3), []);

  useFrame(({ clock }) => {
    if (!p || ready !== p.key) return;
    // let the pose/face springs settle, and never freeze a portrait mid-blink
    if (++frames.current < 8 || blinking(clock.elapsedTime, 3)) return;
    const url = gl.domElement.toDataURL("image/png");
    cache.set(p.key, url);
    onShot(p.key, url);
    frames.current = 0;
    setI((k) => k + 1);
  });
  if (!p || !look) return null;
  return <VrmPerson key={p.key} seed={3} look={look} color="#f43f5e" position={pos} facing={0} mood="rest" lookAt={eye} maxYaw={0.2} lowDetail={false} chair="none" onReady={() => setReady(p.key)} />;
}

/** "bust" = head and shoulders (the preset cards); "face" = a tight head shot that still reads in a 28px profile circle. */
const FRAMING = {
  bust: { fov: 13, y: 1.43 },
  face: { fov: 7, y: 1.52 },
} as const;

export default function CharacterThumbs3D({
  items,
  onShot,
  framing = "bust",
}: {
  items: readonly ThumbItem[];
  onShot: (key: string, url: string) => void;
  framing?: keyof typeof FRAMING;
}) {
  const f = FRAMING[framing];
  const done = items.every((p) => cache.has(p.key));
  useEffect(() => {
    items.forEach((p) => {
      const url = cache.get(p.key);
      if (url) onShot(p.key, url);
    });
  }, [items, onShot]);
  if (done) return null;
  return (
    <div aria-hidden style={{ position: "fixed", left: -9999, top: 0, width: 160, height: 160, pointerEvents: "none" }}>
      {/* a fresh shooter whenever the queue changes, so a new item (e.g. a re-styled own character) gets shot too */}
      <Canvas dpr={1} gl={{ preserveDrawingBuffer: true, alpha: true }} camera={{ fov: f.fov, position: [0, 1.62, 3] }} onCreated={({ camera }) => camera.lookAt(0, f.y, 0)}>
        <ambientLight intensity={0.8} />
        <hemisphereLight args={["#fff4e6", "#2a2a3a", 0.5]} />
        <directionalLight position={[1.5, 3, 4]} intensity={1.5} />
        <Shooter key={items.map((p) => p.key).join("|")} items={items} onShot={onShot} />
      </Canvas>
    </div>
  );
}
