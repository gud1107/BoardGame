"use client";

import { useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import type * as THREE from "three";
import { disguise } from "../data";
import { Cat, Dog, Humanoid, Vacuum } from "./Figures";
import Thing from "./Things";

/**
 * 변신 카드 3장의 움직임 미리보기 — 캔버스 하나에 세 모델을 나란히.
 * 걷는 사람 · 뛰어다니는 강아지 · 들썩이며 미끄러지는 책상처럼 "움직이면 이렇게 보인다"를 보여 준다.
 */

function Mover({ id, x }: { id: string; x: number }) {
  const ref = useRef<THREE.Group>(null);
  const inner = useRef<THREE.Group>(null);
  const def = disguise(id);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime + x;
    const g = ref.current;
    if (!g || !def) return;
    if (def.form === "prop") {
      // 미끄러지다 멈칫 — 움직이는 물건
      const k = Math.sin(t * 1.3);
      g.position.z = k * 0.55;
      if (inner.current) {
        const moving = Math.abs(Math.cos(t * 1.3)) > 0.3;
        inner.current.position.y = moving ? Math.abs(Math.sin(t * 16)) * 0.06 : 0;
        inner.current.rotation.z = moving ? Math.sin(t * 16) * 0.05 : 0;
      }
      g.rotation.y = 0.5;
    } else if (def.form === "vacuum") {
      g.rotation.y = t * 1.5;
      g.position.z = Math.sin(t) * 0.4;
    } else {
      // 왔다 갔다
      const k = Math.sin(t * 0.9);
      g.position.z = k * 0.6;
      g.rotation.y = Math.cos(t * 0.9) > 0 ? 0 : Math.PI;
    }
  });
  if (!def) return null;
  const scale = def.form === "prop" ? Math.min(1.25, 1.5 / Math.max(def.h, def.r * 2.2)) : def.form === "dog" || def.form === "cat" ? 1.7 : def.form === "vacuum" ? 2 : 0.9;
  return (
    <group position={[x, 0, 0]} scale={scale}>
      <group ref={ref}>
        <group ref={inner}>
          {def.form === "person" && <Humanoid anim="walk" look={2} />}
          {def.form === "guard" && <Humanoid anim="inspect" look={1} uniform held="flashlight" />}
          {def.form === "dog" && <Dog anim="run" look={0} />}
          {def.form === "cat" && <Cat anim="walk" look={0} />}
          {def.form === "vacuum" && <Vacuum anim="walk" />}
          {def.form === "prop" && <Thing kind={def.thing!} />}
        </group>
      </group>
      <mesh rotation-x={-Math.PI / 2} position-y={0.001}>
        <circleGeometry args={[0.9 / scale, 24]} />
        <meshBasicMaterial color="#000" transparent opacity={0.25} />
      </mesh>
    </group>
  );
}

export default function PickPreview({ ids }: { ids: string[] }) {
  const xs = ids.length === 3 ? [-2.3, 0, 2.3] : ids.map((_, i) => (i - (ids.length - 1) / 2) * 2.3);
  return (
    <Canvas dpr={[1, 1.5]} camera={{ fov: 32, position: [0, 2.4, 7.4] }} style={{ pointerEvents: "none" }} onCreated={({ camera }) => camera.lookAt(0, 0.2, 0)}>
      <hemisphereLight args={["#dbe4ff", "#3a2a1a", 1.3]} />
      <directionalLight position={[3, 6, 5]} intensity={1.1} />
      <group position={[0, -0.6, 0]} rotation-x={0.05}>
        {ids.map((id, i) => (
          <Mover key={`${id}${i}`} id={id} x={xs[i]} />
        ))}
      </group>
    </Canvas>
  );
}
