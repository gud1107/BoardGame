"use client";

import { useMemo, useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { paintedTexture, FONTS } from "./tableKit";

/**
 * Parametric backdrops for the table games — one indoor room and one outdoor
 * plaza, each themed by colours + a few toggles, so a game gets a distinct
 * setting from a handful of props. Presentation only.
 */

function bannerTexture(color: string, emblem: string): THREE.CanvasTexture {
  return paintedTexture(`env:banner:${color}:${emblem}`, 128, 320, (ctx, W, H) => {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, color);
    g.addColorStop(1, "#000000");
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(W, 0);
    ctx.lineTo(W, H - 48);
    ctx.lineTo(W / 2, H);
    ctx.lineTo(0, H - 48);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = g;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#e9b949";
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.font = `64px ${FONTS.emoji}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(emblem, W / 2, 110);
  });
}

function floorTexture(kind: "planks" | "tiles" | "stone" | "carpet", a: string, b: string): THREE.Texture {
  const t = paintedTexture(`env:floor:${kind}:${a}:${b}`, 256, 256, (ctx, W) => {
    ctx.fillStyle = a;
    ctx.fillRect(0, 0, W, W);
    if (kind === "planks") {
      for (let x = 0; x < 8; x++) {
        ctx.globalAlpha = 0.12 + ((x * 37) % 5) * 0.03;
        ctx.fillStyle = b;
        ctx.fillRect(x * 32, 0, 32, W);
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = "#000";
        ctx.fillRect(x * 32, 0, 2, W);
      }
    } else if (kind === "tiles") {
      for (let y = 0; y < 4; y++)
        for (let x = 0; x < 4; x++) {
          ctx.fillStyle = (x + y) % 2 ? b : a;
          ctx.fillRect(x * 64, y * 64, 64, 64);
        }
    } else if (kind === "stone") {
      for (let y = 0, r = 0; y < W; y += 42, r++)
        for (let x = r % 2 ? -40 : 0; x < W; x += 80) {
          ctx.fillStyle = (x + r * 13) % 3 ? a : b;
          ctx.beginPath();
          ctx.roundRect(x + 3, y + 3, 74, 36, 8);
          ctx.fill();
        }
    } else {
      ctx.strokeStyle = b;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 3;
      for (let i = 0; i < W; i += 32) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + 16, 16);
        ctx.lineTo(i, 32);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(10, 10);
  return t;
}

function Flame({ position, light, color = "#ffae42" }: { position: [number, number, number]; light: boolean; color?: string }) {
  const flame = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const f = 1 + Math.sin(clock.elapsedTime * 15 + position[0] * 3) * 0.13 + Math.sin(clock.elapsedTime * 6.1) * 0.06;
    flame.current?.scale.set(1, f, 1);
  });
  return (
    <group position={position}>
      <mesh position={[0, -0.22, 0]}>
        <cylinderGeometry args={[0.04, 0.03, 0.4, 8]} />
        <meshStandardMaterial color="#3b2412" roughness={0.8} />
      </mesh>
      <mesh ref={flame} position={[0, 0.06, 0]}>
        <coneGeometry args={[0.08, 0.24, 10]} />
        <meshBasicMaterial color={color} />
      </mesh>
      {light && <pointLight position={[0, 0.2, 0]} color={color} intensity={5} distance={6} decay={2} />}
    </group>
  );
}

export interface IndoorRoomProps {
  lowDetail: boolean;
  wall: string;
  floor: { kind: "planks" | "tiles" | "stone" | "carpet"; a: string; b: string };
  rug: string;
  trim: string;
  /** Glowing windows (count around the wall). */
  windows?: { color: string; count: number; arched?: boolean };
  banners?: { colors: string[]; emblem: string };
  /** Framed pictures between the windows. */
  frames?: string[];
  torches?: boolean;
  pillars?: string;
  /** Extra props placed in the room. */
  children?: ReactNode;
}

export function IndoorRoom(p: IndoorRoomProps) {
  const seg = p.lowDetail ? 24 : 48;
  const floor = useMemo(() => floorTexture(p.floor.kind, p.floor.a, p.floor.b), [p.floor.kind, p.floor.a, p.floor.b]);
  const slots = 10;
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[12, seg]} />
        <meshStandardMaterial map={floor} roughness={0.75} />
      </mesh>
      <mesh position={[0, 0.006, 0]} rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[4.5, seg]} />
        <meshStandardMaterial color={p.rug} roughness={1} />
      </mesh>
      <mesh position={[0, 0.008, 0]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[4.2, 4.38, seg]} />
        <meshStandardMaterial color={p.trim} roughness={0.5} metalness={0.5} />
      </mesh>
      <mesh position={[0, 4.5, 0]}>
        <cylinderGeometry args={[10, 10, 9, seg, 1, true]} />
        <meshStandardMaterial color={p.wall} roughness={0.95} side={THREE.BackSide} />
      </mesh>
      <mesh position={[0, 0.5, 0]}>
        <cylinderGeometry args={[9.95, 9.95, 1.0, seg, 1, true]} />
        <meshStandardMaterial color={p.trim} roughness={0.7} metalness={0.15} side={THREE.BackSide} />
      </mesh>
      {Array.from({ length: slots }, (_, i) => {
        const a = (i / slots) * Math.PI * 2 + Math.PI / slots;
        const windowHere = p.windows && i % Math.max(1, Math.round(slots / p.windows.count)) === 0;
        const bannerHere = !windowHere && p.banners && i % 2 === 1;
        const frameHere = !windowHere && !bannerHere && p.frames;
        return (
          <group key={i} position={[Math.sin(a) * 9.85, 0, Math.cos(a) * 9.85]} rotation-y={a + Math.PI}>
            {windowHere && (
              <>
                <mesh position={[0, 3.6, 0]}>
                  <planeGeometry args={[1.5, 2.6]} />
                  <meshBasicMaterial color={p.windows!.color} fog={false} />
                </mesh>
                {p.windows!.arched && (
                  <mesh position={[0, 4.9, 0]}>
                    <circleGeometry args={[0.75, 20, 0, Math.PI]} />
                    <meshBasicMaterial color={p.windows!.color} fog={false} />
                  </mesh>
                )}
                <mesh position={[0, 3.6, 0.02]}>
                  <planeGeometry args={[0.06, 2.6]} />
                  <meshStandardMaterial color="#1c1410" />
                </mesh>
                <mesh position={[0, 3.6, 0.02]}>
                  <planeGeometry args={[1.5, 0.06]} />
                  <meshStandardMaterial color="#1c1410" />
                </mesh>
              </>
            )}
            {bannerHere && (
              <mesh position={[0, 4.0, 0]}>
                <planeGeometry args={[1.05, 2.6]} />
                <meshStandardMaterial map={bannerTexture(p.banners!.colors[i % p.banners!.colors.length], p.banners!.emblem)} transparent roughness={0.9} side={THREE.DoubleSide} />
              </mesh>
            )}
            {frameHere && (
              <group position={[0, 3.0, 0]}>
                <mesh>
                  <boxGeometry args={[1.2, 0.9, 0.06]} />
                  <meshStandardMaterial color={p.trim} metalness={0.6} roughness={0.35} />
                </mesh>
                <mesh position={[0, 0, 0.035]}>
                  <planeGeometry args={[1.02, 0.74]} />
                  <meshStandardMaterial color={p.frames![i % p.frames!.length]} roughness={0.9} />
                </mesh>
              </group>
            )}
            {p.torches && i % 3 === 0 && <Flame position={[0.95, 2.3, 0.2]} light={!p.lowDetail && i % 6 === 0} />}
            {p.pillars && (
              <mesh position={[-1.3, 4.5, 0.3]}>
                <cylinderGeometry args={[0.28, 0.32, 9, 14]} />
                <meshStandardMaterial color={p.pillars} roughness={0.6} />
              </mesh>
            )}
          </group>
        );
      })}
      {p.children}
    </group>
  );
}

export interface OutdoorPlazaProps {
  lowDetail: boolean;
  ground: string;
  plaza: string;
  trim: string;
  /** Distant silhouettes: mountains (cones), city (boxes) or dunes (spheres). */
  skyline: { kind: "mountains" | "city" | "dunes" | "trees"; color: string; cap?: string };
  sun?: { color: string; position: [number, number, number]; size?: number };
  torches?: boolean;
  /** Low ring wall around the plaza. */
  wall?: string;
  children?: ReactNode;
}

export function OutdoorPlaza(p: OutdoorPlazaProps) {
  const seg = p.lowDetail ? 24 : 48;
  const items = useMemo(
    () =>
      Array.from({ length: p.skyline.kind === "city" ? 26 : 13 }, (_, i) => {
        const a = (i / (p.skyline.kind === "city" ? 26 : 13)) * Math.PI * 2 + 0.2;
        return { a, h: 3 + ((i * 37) % 9), r: 2 + ((i * 13) % 3), d: 24 + ((i * 7) % 5) };
      }),
    [p.skyline.kind],
  );
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[34, seg]} />
        <meshStandardMaterial color={p.ground} roughness={1} />
      </mesh>
      <mesh position={[0, 0.005, 0]} rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[7, seg]} />
        <meshStandardMaterial color={p.plaza} roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.007, 0]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[4.2, 4.45, seg]} />
        <meshStandardMaterial color={p.trim} roughness={0.8} />
      </mesh>
      {p.wall && (
        <mesh position={[0, 0.6, 0]}>
          <cylinderGeometry args={[9.6, 9.8, 1.2, seg, 1, true]} />
          <meshStandardMaterial color={p.wall} roughness={0.95} side={THREE.DoubleSide} />
        </mesh>
      )}
      {p.torches &&
        Array.from({ length: 6 }, (_, i) => {
          const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
          return <Flame key={i} position={[Math.sin(a) * 7.2, 1.6, Math.cos(a) * 7.2]} light={!p.lowDetail && i % 2 === 0} />;
        })}
      {items.map((m, i) => {
        const x = Math.sin(m.a) * m.d;
        const z = Math.cos(m.a) * m.d;
        if (p.skyline.kind === "city")
          return (
            <mesh key={i} position={[x, m.h, z]}>
              <boxGeometry args={[m.r * 1.2, m.h * 2, m.r * 1.2]} />
              <meshStandardMaterial color={p.skyline.color} emissive={p.skyline.cap ?? "#000"} emissiveIntensity={0.18} roughness={1} />
            </mesh>
          );
        if (p.skyline.kind === "dunes")
          return (
            <mesh key={i} position={[x, 0, z]} scale={[2.2, 0.5, 1.4]}>
              <sphereGeometry args={[m.r + 1, 12, 8]} />
              <meshStandardMaterial color={p.skyline.color} roughness={1} />
            </mesh>
          );
        if (p.skyline.kind === "trees")
          return (
            <group key={i} position={[x * 0.6, 0, z * 0.6]}>
              <mesh position={[0, 0.8, 0]}>
                <cylinderGeometry args={[0.12, 0.16, 1.6, 6]} />
                <meshStandardMaterial color="#4a3020" roughness={1} />
              </mesh>
              <mesh position={[0, 2.2, 0]}>
                <coneGeometry args={[0.9 + (i % 3) * 0.2, 2.4, 7]} />
                <meshStandardMaterial color={p.skyline.color} roughness={1} flatShading />
              </mesh>
            </group>
          );
        return (
          <group key={i} position={[x, 0, z]}>
            <mesh position={[0, m.h / 2 + 2, 0]}>
              <coneGeometry args={[m.r + 1.5, m.h + 4, 6]} />
              <meshStandardMaterial color={p.skyline.color} roughness={1} flatShading />
            </mesh>
            {p.skyline.cap && (
              <mesh position={[0, m.h + 4 - (m.h + 4) * 0.12, 0]}>
                <coneGeometry args={[(m.r + 1.5) * 0.25, (m.h + 4) * 0.25, 6]} />
                <meshStandardMaterial color={p.skyline.cap} roughness={0.8} flatShading />
              </mesh>
            )}
          </group>
        );
      })}
      {p.sun && (
        <mesh position={p.sun.position} rotation-y={Math.atan2(-p.sun.position[0], -p.sun.position[2])}>
          <circleGeometry args={[p.sun.size ?? 2, 32]} />
          <meshBasicMaterial color={p.sun.color} fog={false} />
        </mesh>
      )}
      {p.children}
    </group>
  );
}
