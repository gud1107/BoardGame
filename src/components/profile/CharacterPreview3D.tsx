"use client";

import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import SeatedPerson from "@/games/shared/three/SeatedPerson";
import type { PersonLook } from "@/lib/character/avatar";

/**
 * Live 3D bust of a character for the picker — the same cartoon rig most
 * 3D tables use. Loaded with next/dynamic so three.js stays out of the
 * profile/room-entry chunks until the picker actually opens.
 */
export default function CharacterPreview3D({ look }: { look: PersonLook }) {
  const pos = useMemo(() => new THREE.Vector3(0, 0, 0), []);
  const eye = useMemo(() => new THREE.Vector3(0.5, 1.62, 3), []);
  return (
    <Canvas dpr={[1, 1.75]} camera={{ fov: 24, position: [0.5, 1.62, 3] }} onCreated={({ camera }) => camera.lookAt(0, 1.58, 0)}>
      <ambientLight intensity={0.75} />
      <hemisphereLight args={["#fff4e6", "#2a2a3a", 0.5]} />
      <directionalLight position={[1.5, 3, 4]} intensity={1.5} />
      <SeatedPerson seed={7} look={look} color="#f43f5e" position={pos} facing={0.12} mood="rest" lookAt={eye} maxYaw={0.4} lowDetail={false} chair="none" />
    </Canvas>
  );
}
