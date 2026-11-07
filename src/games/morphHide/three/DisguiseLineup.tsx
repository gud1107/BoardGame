"use client";

import { useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import type * as THREE from "three";
import { disguise } from "../data";
import { FigCtx, FormModel, castKeyFor } from "./World3D";

/**
 * 라운드·게임이 끝났을 때 숨는 사람들이 "무엇으로 어떤 자세로" 숨어 있었는지 작게 보여 주는 진열대.
 * 캔버스 하나에 N칸 — 칸 너비를 픽셀로 맞춰 두어서 아래 HTML 이름표(같은 N칸 grid)와 줄이 맞는다.
 * 사람 변신은 게임 화면과 같은 출연진 얼굴(시드·라운드·자리)로 그린다.
 */

export interface LineupItem {
  seat: number;
  dg: string | null;
  pose: number;
  caught: boolean;
}

/** 칸 하나에 들어갈 크기로 줄이기 (사람 ≈ 1.6, 큰 물건도 1.5 안쪽) */
function fitScale(dg: string | null): number {
  const def = disguise(dg);
  if (!def) return 0.9;
  if (def.form === "prop") return Math.min(1.25, 1.5 / Math.max(def.h, def.r * 2.2));
  if (def.form === "dog" || def.form === "cat") return 1.6;
  if (def.form === "vacuum") return 1.8;
  return 0.9;
}

/** 직교 카메라: 칸 N개가 캔버스 너비를 꽉 채우고, 높이 2.2(월드)는 반드시 보이게 */
function Fit({ n, colRef }: { n: number; colRef: React.RefObject<number> }) {
  const last = useRef("");
  useFrame(({ camera, size }) => {
    const key = `${size.width}x${size.height}:${n}`;
    if (key === last.current) return;
    last.current = key;
    const zoom = Math.min(size.width / (n * 2), size.height / 2.2);
    camera.zoom = zoom;
    camera.updateProjectionMatrix();
    colRef.current = size.width / (n * zoom);
  });
  return null;
}

function Slot({ item, i, n, colRef, seed, round }: { item: LineupItem; i: number; n: number; colRef: React.RefObject<number>; seed: number; round: number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    g.position.x = (i - (n - 1) / 2) * colRef.current;
    // 천천히 돌려서 앞·옆 모습을 다 보여 준다
    g.rotation.y = 0.5 + Math.sin(clock.elapsedTime * 0.6 + i) * 0.7;
  });
  return (
    <group ref={ref} scale={fitScale(item.dg)}>
      <FormModel dg={item.dg} anim="idle" pose={item.pose} look={(item.seat * 3 + 1) % 8} castKey={castKeyFor(seed, round, item.seat)} />
    </group>
  );
}

export default function DisguiseLineup({ items, seed, round }: { items: LineupItem[]; seed: number; round: number }) {
  const colRef = useRef(2);
  const n = Math.max(1, items.length);
  return (
    <Canvas orthographic dpr={[1, 1.5]} camera={{ position: [0, 2.2, 8], zoom: 40 }} style={{ pointerEvents: "none" }} onCreated={({ camera }) => camera.lookAt(0, 0.9, 0)}>
      <FigCtx.Provider value={{ seed, round, low: true }}>
        <hemisphereLight args={["#dbe4ff", "#3a2a1a", 1.4]} />
        <directionalLight position={[3, 6, 5]} intensity={1.1} />
        <Fit n={n} colRef={colRef} />
        <group position={[0, 0, 0]}>
          {items.map((it, i) => (
            <Slot key={it.seat} item={it} i={i} n={n} colRef={colRef} seed={seed} round={round} />
          ))}
        </group>
      </FigCtx.Provider>
    </Canvas>
  );
}
