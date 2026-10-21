"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import SeatedPerson, { blinking } from "@/games/shared/three/SeatedPerson";
import { resolveLook, type CharacterPreset } from "@/lib/character/avatar";

/**
 * Portrait thumbnails for the preset list, rendered with the real table rig
 * (so they can never drift from what the games show) on ONE hidden canvas —
 * a WebGL context per card would hit the browser's context limit. Results
 * are cached for the tab, so reopening the picker is instant.
 */
const cache = new Map<string, string>();

export function cachedThumb(id: string): string | undefined {
  return cache.get(id);
}

function Shooter({ presets, onShot }: { presets: readonly CharacterPreset[]; onShot: (id: string, url: string) => void }) {
  const { gl } = useThree();
  const todo = useMemo(() => presets.filter((p) => !cache.has(p.id)), [presets]);
  const [i, setI] = useState(0);
  const frames = useRef(0);
  const p = todo[i];
  const look = useMemo(() => (p ? resolveLook(0, ["none"], p.look) : null), [p]);
  const pos = useMemo(() => new THREE.Vector3(0, 0, 0), []);
  const eye = useMemo(() => new THREE.Vector3(0, 1.62, 3), []);

  useFrame(({ clock }) => {
    if (!p) return;
    // let the pose/face springs settle, and never freeze a portrait mid-blink
    if (++frames.current < 8 || blinking(clock.elapsedTime, 3)) return;
    const url = gl.domElement.toDataURL("image/png");
    cache.set(p.id, url);
    onShot(p.id, url);
    frames.current = 0;
    setI((k) => k + 1);
  });
  if (!p || !look) return null;
  return <SeatedPerson key={p.id} seed={3} look={look} color="#f43f5e" position={pos} facing={0} mood="rest" lookAt={eye} maxYaw={0.2} lowDetail={false} chair="none" />;
}

export default function CharacterThumbs3D({ presets, onShot }: { presets: readonly CharacterPreset[]; onShot: (id: string, url: string) => void }) {
  const done = presets.every((p) => cache.has(p.id));
  useEffect(() => {
    presets.forEach((p) => {
      const url = cache.get(p.id);
      if (url) onShot(p.id, url);
    });
  }, [presets, onShot]);
  if (done) return null;
  return (
    <div aria-hidden style={{ position: "fixed", left: -9999, top: 0, width: 160, height: 160, pointerEvents: "none" }}>
      <Canvas dpr={1} gl={{ preserveDrawingBuffer: true, alpha: true }} camera={{ fov: 20, position: [0, 1.62, 3] }} onCreated={({ camera }) => camera.lookAt(0, 1.55, 0)}>
        <ambientLight intensity={0.8} />
        <hemisphereLight args={["#fff4e6", "#2a2a3a", 0.5]} />
        <directionalLight position={[1.5, 3, 4]} intensity={1.5} />
        <Shooter presets={presets} onShot={onShot} />
      </Canvas>
    </div>
  );
}
