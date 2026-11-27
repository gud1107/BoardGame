"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { PersonLook } from "@/games/shared/three/SeatedPerson";
import { resolveLook } from "@/lib/character/avatar";
import VrmBody, { setBone, BODY, BODY_DROP, type BodyFace } from "@/games/shared/three/VrmBody";
import { AdaptiveResolution } from "@/games/shared/three/sceneFx";
import { paintedTexture } from "@/games/shared/three/tableKit";
import type { Costume, SetId } from "../data";

/**
 * 인생 상황극 무대 (규칙서 §11) — 공개 방송 콩트 세트처럼 붉은 막 사이에 그림 배경(세트 9종)과
 * 소품이 서고, 내 캐릭터(VRM, 배역 머리 장식)와 상대역이 마주 선다. 장면이 바뀌면 막이 닫혔다
 * 열리며 세트를 갈아 끼운다. 대사·자막은 보드가 DOM으로 얹는다(글씨가 또렷하도록).
 */

export type StageMood = "think" | "wait" | "good" | "bad" | "plain" | "cheer";

export interface SkitStage3DProps {
  set: SetId;
  /** 바뀌면 막을 닫았다 연다 (장면 번호·보고 있는 좌석) */
  sceneKey: string;
  hero: { look: PersonLook; seed: number; costume: Costume };
  npc: { g: "f" | "m"; seed: number; joseon: boolean };
  mood: StageMood;
  lowDetail: boolean;
}

const HEAD_Y = 1.42;
const STAGE_W = 9;
const BACK_Z = -2.2;

/* ───────────── 그림 배경 ───────────── */

type Painter = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

function sky(ctx: CanvasRenderingContext2D, w: number, h: number, top: string, bottom: string) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function tiledRoof(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x - w * 0.06, y + h);
  ctx.quadraticCurveTo(x + w * 0.08, y + h * 0.55, x + w * 0.2, y);
  ctx.lineTo(x + w * 0.8, y);
  ctx.quadraticCurveTo(x + w * 0.92, y + h * 0.55, x + w * 1.06, y + h);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.12)";
  ctx.lineWidth = 3;
  for (let i = 1; i < 26; i++) {
    const px = x + (w * i) / 26;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.2 + ((px - x) / w) * w * 0.6, y);
    ctx.lineTo(px, y + h);
    ctx.stroke();
  }
}

const PAINT: Record<SetId, Painter> = {
  hut: (ctx, w, h) => {
    sky(ctx, w, h, "#1b2a55", "#5b5f8f");
    ctx.fillStyle = "#fff6c9";
    ctx.beginPath();
    ctx.arc(w * 0.82, h * 0.2, h * 0.09, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.8)";
    for (let i = 0; i < 40; i++) ctx.fillRect((i * 263) % w, (i * 97) % (h * 0.45), 3, 3);
    ctx.fillStyle = "#3d4a3c";
    ctx.beginPath();
    ctx.moveTo(0, h * 0.62);
    ctx.quadraticCurveTo(w * 0.3, h * 0.42, w * 0.6, h * 0.6);
    ctx.quadraticCurveTo(w * 0.8, h * 0.5, w, h * 0.62);
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.fill();
    // 초가집
    ctx.fillStyle = "#e9dcc0";
    ctx.fillRect(w * 0.2, h * 0.52, w * 0.42, h * 0.48);
    ctx.fillStyle = "#6b4a2b";
    ctx.fillRect(w * 0.36, h * 0.62, w * 0.1, h * 0.38);
    ctx.fillStyle = "#c9a04a";
    ctx.beginPath();
    ctx.moveTo(w * 0.14, h * 0.56);
    ctx.quadraticCurveTo(w * 0.41, h * 0.2, w * 0.68, h * 0.56);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#a07a2c";
    ctx.lineWidth = 4;
    for (let i = 0; i < 9; i++) {
      ctx.beginPath();
      ctx.moveTo(w * (0.2 + i * 0.055), h * 0.56);
      ctx.lineTo(w * (0.3 + i * 0.028), h * 0.36);
      ctx.stroke();
    }
    // 싸리 울타리
    ctx.strokeStyle = "#7a5a34";
    ctx.lineWidth = 6;
    for (let x = w * 0.7; x < w; x += 22) {
      ctx.beginPath();
      ctx.moveTo(x, h);
      ctx.lineTo(x + 6, h * 0.72);
      ctx.stroke();
    }
  },
  hanok: (ctx, w, h) => {
    sky(ctx, w, h, "#8ec5ee", "#e8f3fb");
    tiledRoof(ctx, w * 0.04, h * 0.1, w * 0.92, h * 0.26, "#3b4250");
    ctx.fillStyle = "#f3ead8";
    ctx.fillRect(w * 0.08, h * 0.36, w * 0.84, h * 0.64);
    ctx.fillStyle = "#7a4f2c";
    for (const x of [0.08, 0.3, 0.52, 0.74, 0.9]) ctx.fillRect(w * x, h * 0.36, w * 0.022, h * 0.64);
    ctx.fillRect(w * 0.08, h * 0.36, w * 0.84, h * 0.03);
    // 창호문
    for (const x of [0.115, 0.335, 0.555]) {
      ctx.fillStyle = "#fbf6ea";
      ctx.fillRect(w * x, h * 0.44, w * 0.17, h * 0.5);
      ctx.strokeStyle = "#8a5a32";
      ctx.lineWidth = 4;
      for (let i = 0; i <= 4; i++) {
        ctx.beginPath();
        ctx.moveTo(w * (x + (0.17 * i) / 4), h * 0.44);
        ctx.lineTo(w * (x + (0.17 * i) / 4), h * 0.94);
        ctx.stroke();
      }
      for (let i = 0; i <= 5; i++) {
        ctx.beginPath();
        ctx.moveTo(w * x, h * (0.44 + (0.5 * i) / 5));
        ctx.lineTo(w * (x + 0.17), h * (0.44 + (0.5 * i) / 5));
        ctx.stroke();
      }
    }
  },
  palace: (ctx, w, h) => {
    sky(ctx, w, h, "#7a1a1a", "#4d0f12");
    // 단청
    const band = ["#1f7a5a", "#e2b33c", "#2b5fb0", "#d9463a", "#1f7a5a"];
    band.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.fillRect(0, h * (0.02 + i * 0.035), w, h * 0.035);
    });
    // 오봉 병풍
    ctx.fillStyle = "#1c3f73";
    ctx.fillRect(w * 0.26, h * 0.24, w * 0.48, h * 0.6);
    ctx.fillStyle = "#e8483c";
    ctx.beginPath();
    ctx.arc(w * 0.36, h * 0.34, h * 0.05, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f6f1df";
    ctx.beginPath();
    ctx.arc(w * 0.64, h * 0.34, h * 0.05, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#2f8f63";
    for (let i = 0; i < 5; i++) {
      const cx = w * (0.31 + i * 0.095);
      const top = h * (i === 2 ? 0.4 : i % 2 ? 0.48 : 0.54);
      ctx.beginPath();
      ctx.moveTo(cx - w * 0.06, h * 0.84);
      ctx.quadraticCurveTo(cx, top - h * 0.1, cx + w * 0.06, h * 0.84);
      ctx.fill();
    }
    ctx.strokeStyle = "#e2b33c";
    ctx.lineWidth = 10;
    ctx.strokeRect(w * 0.26, h * 0.24, w * 0.48, h * 0.6);
    // 붉은 기둥
    ctx.fillStyle = "#a3231f";
    for (const x of [0.06, 0.17, 0.79, 0.9]) ctx.fillRect(w * x, h * 0.2, w * 0.04, h * 0.8);
  },
  market: (ctx, w, h) => {
    sky(ctx, w, h, "#f6c98a", "#fbe9cf");
    ctx.fillStyle = "#b9a37e";
    ctx.fillRect(0, h * 0.8, w, h * 0.2);
    const stalls = ["#d9463a", "#2b7fb0", "#e2a53c", "#3a9a68"];
    stalls.forEach((c, i) => {
      const x = w * (0.03 + i * 0.245);
      ctx.fillStyle = "#6b4a2b";
      ctx.fillRect(x + w * 0.01, h * 0.42, w * 0.012, h * 0.5);
      ctx.fillRect(x + w * 0.19, h * 0.42, w * 0.012, h * 0.5);
      ctx.fillStyle = "#8a6238";
      ctx.fillRect(x, h * 0.68, w * 0.21, h * 0.24);
      for (let s = 0; s < 6; s++) {
        ctx.fillStyle = s % 2 ? "#fff7e6" : c;
        ctx.beginPath();
        ctx.moveTo(x + (w * 0.21 * s) / 6, h * 0.3);
        ctx.lineTo(x + (w * 0.21 * (s + 1)) / 6, h * 0.3);
        ctx.lineTo(x + (w * 0.21 * (s + 1)) / 6 + 8, h * 0.44);
        ctx.lineTo(x + (w * 0.21 * s) / 6 - 8, h * 0.44);
        ctx.fill();
      }
      for (let k = 0; k < 5; k++) {
        ctx.fillStyle = ["#e8483c", "#f2b33d", "#7ab648"][(k + i) % 3];
        ctx.beginPath();
        ctx.arc(x + w * (0.03 + k * 0.038), h * 0.66, h * 0.03, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  },
  office: (ctx, w, h) => {
    ctx.fillStyle = "#dfe6ee";
    ctx.fillRect(0, 0, w, h);
    // 통창과 도시
    sky(ctx, w, h * 0.72, "#7fb7ea", "#d7ecfb");
    ctx.fillStyle = "#8fa3b8";
    const hs = [0.5, 0.32, 0.44, 0.24, 0.4, 0.3, 0.52, 0.36, 0.28, 0.46, 0.34, 0.5];
    hs.forEach((v, i) => {
      ctx.fillStyle = i % 2 ? "#9db1c6" : "#7f95ad";
      ctx.fillRect((w * i) / hs.length, h * (0.72 - v * 0.6), w / hs.length - 6, h * v * 0.6);
      ctx.fillStyle = "rgba(255,255,255,.55)";
      for (let r = 0; r < 5; r++) ctx.fillRect((w * i) / hs.length + 10, h * (0.72 - v * 0.6) + 12 + r * 22, w / hs.length - 28, 6);
    });
    ctx.fillStyle = "#c4ced9";
    for (let i = 0; i <= 4; i++) ctx.fillRect((w * i) / 4 - 8, 0, 16, h * 0.72);
    ctx.fillRect(0, h * 0.7, w, h * 0.04);
    ctx.fillStyle = "#b8c2ce";
    ctx.fillRect(0, h * 0.74, w, h * 0.26);
  },
  home: (ctx, w, h) => {
    ctx.fillStyle = "#f3e2c6";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(210,160,110,.25)";
    for (let x = 0; x < w; x += 46) ctx.fillRect(x, 0, 18, h);
    // 창문
    ctx.fillStyle = "#bfe3f7";
    ctx.fillRect(w * 0.1, h * 0.16, w * 0.26, h * 0.42);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 12;
    ctx.strokeRect(w * 0.1, h * 0.16, w * 0.26, h * 0.42);
    ctx.beginPath();
    ctx.moveTo(w * 0.23, h * 0.16);
    ctx.lineTo(w * 0.23, h * 0.58);
    ctx.stroke();
    ctx.fillStyle = "#e58b7a";
    ctx.fillRect(w * 0.07, h * 0.12, w * 0.07, h * 0.52);
    ctx.fillRect(w * 0.32, h * 0.12, w * 0.07, h * 0.52);
    // 액자
    [["#7ab6d9", 0.5], ["#e7b24c", 0.64], ["#9ccf8a", 0.78]].forEach(([c, x], i) => {
      ctx.fillStyle = "#6b4a2b";
      ctx.fillRect(w * (x as number), h * (0.2 + (i % 2) * 0.08), w * 0.1, h * 0.2);
      ctx.fillStyle = c as string;
      ctx.fillRect(w * (x as number) + 8, h * (0.2 + (i % 2) * 0.08) + 8, w * 0.1 - 16, h * 0.2 - 16);
    });
    ctx.fillStyle = "#b98a5e";
    ctx.fillRect(0, h * 0.86, w, h * 0.14);
  },
  school: (ctx, w, h) => {
    ctx.fillStyle = "#f1ead9";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#8a6238";
    ctx.fillRect(w * 0.1, h * 0.16, w * 0.8, h * 0.56);
    ctx.fillStyle = "#2f6b4f";
    ctx.fillRect(w * 0.115, h * 0.185, w * 0.77, h * 0.51);
    ctx.strokeStyle = "rgba(255,255,255,.75)";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    // 낙서: 삼각형, 물결, 별
    ctx.beginPath();
    ctx.moveTo(w * 0.2, h * 0.56);
    ctx.lineTo(w * 0.3, h * 0.56);
    ctx.lineTo(w * 0.25, h * 0.34);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i <= 30; i++) {
      const x = w * (0.4 + i * 0.008);
      const y = h * 0.4 + Math.sin(i * 0.7) * h * 0.03;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    for (let r = 0; r < 3; r++) {
      ctx.beginPath();
      ctx.moveTo(w * 0.4, h * (0.5 + r * 0.05));
      ctx.lineTo(w * (0.62 - r * 0.04), h * (0.5 + r * 0.05));
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(w * 0.76, h * 0.42, h * 0.08, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(w * 0.5, h * 0.09, h * 0.055, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(w * 0.5, h * 0.09);
    ctx.lineTo(w * 0.5, h * 0.05);
    ctx.moveTo(w * 0.5, h * 0.09);
    ctx.lineTo(w * 0.52, h * 0.1);
    ctx.stroke();
    ctx.fillStyle = "#c9b28a";
    ctx.fillRect(0, h * 0.84, w, h * 0.16);
  },
  street: (ctx, w, h) => {
    sky(ctx, w, h, "#141a3a", "#3a2f5e");
    const hs = [0.7, 0.52, 0.8, 0.6, 0.74, 0.5, 0.66];
    hs.forEach((v, i) => {
      const x = (w * i) / hs.length;
      ctx.fillStyle = i % 2 ? "#232a4d" : "#1a2040";
      ctx.fillRect(x, h * (1 - v), w / hs.length - 4, h * v);
      for (let r = 0; r < 7; r++)
        for (let c = 0; c < 4; c++) {
          ctx.fillStyle = (r * 3 + c * 5 + i) % 4 === 0 ? "#ffd977" : "rgba(255,255,255,.08)";
          ctx.fillRect(x + 14 + c * 30, h * (1 - v) + 16 + r * 30, 16, 14);
        }
    });
    // 네온 간판 (글자 없이 모양만)
    const neon = ["#ff5fa2", "#4de1ff", "#ffe14d", "#7dff8a"];
    neon.forEach((c, i) => {
      ctx.strokeStyle = c;
      ctx.shadowColor = c;
      ctx.shadowBlur = 18;
      ctx.lineWidth = 7;
      ctx.strokeRect(w * (0.07 + i * 0.24), h * (0.62 + (i % 2) * 0.06), w * 0.12, h * 0.07);
    });
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#2a2a36";
    ctx.fillRect(0, h * 0.88, w, h * 0.12);
  },
  stage: (ctx, w, h) => {
    sky(ctx, w, h, "#12061f", "#2a0f45");
    // LED 벽
    for (let r = 0; r < 9; r++)
      for (let c = 0; c < 22; c++) {
        const on = (r * 7 + c * 3) % 5;
        ctx.fillStyle = ["#ff5fa2", "#7a5cff", "#4de1ff", "#2a0f45", "#2a0f45"][on];
        ctx.globalAlpha = 0.55;
        ctx.fillRect(w * 0.08 + c * (w * 0.84) / 22, h * 0.22 + r * (h * 0.5) / 9, (w * 0.84) / 22 - 6, (h * 0.5) / 9 - 6);
      }
    ctx.globalAlpha = 1;
    // 조명 빔
    for (const [x, c] of [[0.2, "rgba(255,95,162,.22)"], [0.5, "rgba(255,255,255,.2)"], [0.8, "rgba(77,225,255,.22)"]] as const) {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(w * x, 0);
      ctx.lineTo(w * (x - 0.14), h);
      ctx.lineTo(w * (x + 0.14), h);
      ctx.fill();
    }
    ctx.fillStyle = "#ffe9a8";
    for (let i = 0; i < 14; i++) {
      ctx.beginPath();
      ctx.arc(w * (0.06 + i * 0.068), h * 0.1, 9, 0, Math.PI * 2);
      ctx.fill();
    }
  },
};

const FLOOR: Record<SetId, string> = {
  hut: "#8a7350",
  hanok: "#a9814f",
  palace: "#7d2b25",
  market: "#b7a07a",
  office: "#9aa6b4",
  home: "#b88a5c",
  school: "#c2a878",
  street: "#3a3a48",
  stage: "#2a1a3d",
};

/* ───────────── 소품 ───────────── */

function Box({ p, s, c, r = 0.8 }: { p: [number, number, number]; s: [number, number, number]; c: string; r?: number }) {
  return (
    <mesh position={p} castShadow receiveShadow>
      <boxGeometry args={s} />
      <meshStandardMaterial color={c} roughness={r} />
    </mesh>
  );
}

function SetProps({ set }: { set: SetId }): ReactNode {
  switch (set) {
    case "hut":
      return (
        <group position={[2.9, 0, -1.2]}>
          {[
            [0, 0.42, 0, 0.42],
            [0.75, 0.3, 0.3, 0.3],
            [-0.6, 0.26, 0.4, 0.26],
          ].map(([x, y, z, r], i) => (
            <group key={i} position={[x, 0, z]}>
              <mesh position={[0, y, 0]} scale={[1, 1.15, 1]} castShadow>
                <sphereGeometry args={[r, 20, 14]} />
                <meshStandardMaterial color="#5a3a26" roughness={0.5} />
              </mesh>
              <mesh position={[0, y * 2.2, 0]}>
                <cylinderGeometry args={[r * 0.62, r * 0.5, 0.06, 20]} />
                <meshStandardMaterial color="#3e2718" roughness={0.6} />
              </mesh>
            </group>
          ))}
        </group>
      );
    case "hanok":
      return (
        <group>
          <Box p={[0, 0.12, -1.55]} s={[7.6, 0.24, 1.1]} c="#8a5a32" />
          <Box p={[0, 0.03, -0.9]} s={[2.2, 0.06, 0.5]} c="#b9b2a4" r={1} />
        </group>
      );
    case "palace":
      return (
        <group position={[0, 0, -1.5]}>
          <Box p={[0, 0.15, 0]} s={[2.4, 0.3, 1.2]} c="#8a1f1b" />
          <Box p={[0, 0.55, -0.1]} s={[1.3, 0.5, 0.9]} c="#b3261f" />
          <Box p={[0, 1.2, -0.5]} s={[1.5, 1.4, 0.12]} c="#b3261f" />
          <Box p={[0, 1.93, -0.5]} s={[1.7, 0.1, 0.16]} c="#e2b33c" r={0.3} />
          <Box p={[-0.72, 0.9, -0.1]} s={[0.1, 0.3, 0.9]} c="#e2b33c" r={0.3} />
          <Box p={[0.72, 0.9, -0.1]} s={[0.1, 0.3, 0.9]} c="#e2b33c" r={0.3} />
        </group>
      );
    case "market":
      return (
        <group position={[-3, 0, -1.1]}>
          <Box p={[0, 0.25, 0]} s={[1.1, 0.5, 0.8]} c="#9a6f3c" />
          <Box p={[0.9, 0.18, 0.35]} s={[0.7, 0.36, 0.6]} c="#a97c46" />
          {[
            [-0.3, 0.6, 0.1, "#e8483c"],
            [0, 0.6, -0.1, "#f2b33d"],
            [0.3, 0.6, 0.12, "#7ab648"],
            [0.05, 0.6, 0.25, "#e8483c"],
            [0.85, 0.46, 0.35, "#f2b33d"],
          ].map(([x, y, z, c], i) => (
            <mesh key={i} position={[x as number, y as number, z as number]} castShadow>
              <sphereGeometry args={[0.13, 14, 10]} />
              <meshStandardMaterial color={c as string} roughness={0.5} />
            </mesh>
          ))}
        </group>
      );
    case "office":
      return (
        <group position={[0, 0, -1.35]}>
          <Box p={[0, 0.72, 0]} s={[2.6, 0.07, 0.9]} c="#e8e2d6" r={0.5} />
          <Box p={[-1.15, 0.36, 0]} s={[0.08, 0.72, 0.8]} c="#5c6470" />
          <Box p={[1.15, 0.36, 0]} s={[0.08, 0.72, 0.8]} c="#5c6470" />
          <Box p={[0.3, 1.1, -0.15]} s={[0.8, 0.5, 0.05]} c="#1c2430" r={0.3} />
          <Box p={[0.3, 0.8, -0.15]} s={[0.1, 0.12, 0.08]} c="#3a424e" />
          <Box p={[-0.6, 0.83, 0.1]} s={[0.36, 0.14, 0.28]} c="#f2b33d" />
          <mesh position={[-3.1, 0.55, 0.2]} castShadow>
            <coneGeometry args={[0.42, 1.1, 14]} />
            <meshStandardMaterial color="#3a9a68" roughness={0.9} />
          </mesh>
          <Box p={[-3.1, 0.15, 0.2]} s={[0.4, 0.3, 0.4]} c="#d9d2c4" />
        </group>
      );
    case "home":
      return (
        <group position={[0, 0, -1.4]}>
          <Box p={[0, 0.28, 0]} s={[2.6, 0.36, 0.95]} c="#5f8fb5" r={0.95} />
          <Box p={[0, 0.72, -0.38]} s={[2.6, 0.7, 0.2]} c="#5f8fb5" r={0.95} />
          <Box p={[-1.38, 0.45, 0]} s={[0.2, 0.6, 0.95]} c="#527fa3" r={0.95} />
          <Box p={[1.38, 0.45, 0]} s={[0.2, 0.6, 0.95]} c="#527fa3" r={0.95} />
          <Box p={[-0.7, 0.58, 0.05]} s={[0.5, 0.3, 0.2]} c="#f2c14e" r={1} />
          <group position={[3, 0, 0.1]}>
            <Box p={[0, 0.85, 0]} s={[0.06, 1.7, 0.06]} c="#6b4a2b" />
            <mesh position={[0, 1.75, 0]}>
              <coneGeometry args={[0.34, 0.4, 18, 1, true]} />
              <meshStandardMaterial color="#ffe1a3" emissive="#ffb84d" emissiveIntensity={0.7} side={THREE.DoubleSide} />
            </mesh>
          </group>
        </group>
      );
    case "school":
      return (
        <group position={[0, 0, -1.3]}>
          <Box p={[0, 0.74, 0]} s={[1.5, 0.08, 0.7]} c="#b98a4e" />
          <Box p={[0, 0.37, -0.2]} s={[1.4, 0.74, 0.06]} c="#a57a42" />
          <Box p={[-0.68, 0.37, 0.1]} s={[0.06, 0.74, 0.5]} c="#8a6238" />
          <Box p={[0.68, 0.37, 0.1]} s={[0.06, 0.74, 0.5]} c="#8a6238" />
          <Box p={[0.35, 0.83, 0.05]} s={[0.4, 0.08, 0.3]} c="#d9463a" />
          <mesh position={[-0.4, 0.92, 0]} castShadow>
            <sphereGeometry args={[0.14, 16, 12]} />
            <meshStandardMaterial color="#3a8fd9" roughness={0.4} />
          </mesh>
        </group>
      );
    case "street":
      return (
        <group>
          <group position={[-3.1, 0, -1.2]}>
            <Box p={[0, 1.4, 0]} s={[0.1, 2.8, 0.1]} c="#2c2f3a" r={0.4} />
            <Box p={[0.3, 2.75, 0]} s={[0.7, 0.08, 0.1]} c="#2c2f3a" r={0.4} />
            <mesh position={[0.6, 2.62, 0]}>
              <sphereGeometry args={[0.16, 14, 10]} />
              <meshStandardMaterial color="#fff2c2" emissive="#ffd977" emissiveIntensity={1.6} />
            </mesh>
          </group>
          <group position={[2.9, 0, -1.3]}>
            <Box p={[0, 0.42, 0]} s={[1.5, 0.08, 0.45]} c="#8a6238" />
            <Box p={[0, 0.72, -0.2]} s={[1.5, 0.3, 0.06]} c="#8a6238" />
            <Box p={[-0.65, 0.21, 0]} s={[0.08, 0.42, 0.4]} c="#2c2f3a" />
            <Box p={[0.65, 0.21, 0]} s={[0.08, 0.42, 0.4]} c="#2c2f3a" />
          </group>
        </group>
      );
    case "stage":
      return (
        <group>
          <group position={[0, 0, -0.9]}>
            <Box p={[0, 0.72, 0]} s={[0.04, 1.44, 0.04]} c="#c9ccd4" r={0.3} />
            <mesh position={[0, 0.02, 0]}>
              <cylinderGeometry args={[0.22, 0.24, 0.04, 20]} />
              <meshStandardMaterial color="#2c2f3a" roughness={0.4} />
            </mesh>
            <mesh position={[0, 1.5, 0.03]} rotation-x={0.5}>
              <capsuleGeometry args={[0.045, 0.1, 6, 12]} />
              <meshStandardMaterial color="#1b1d24" roughness={0.5} />
            </mesh>
          </group>
          {[-3.3, 3.3].map((x) => (
            <group key={x} position={[x, 0, -1.4]}>
              <Box p={[0, 0.5, 0]} s={[0.8, 1, 0.6]} c="#17181f" r={0.6} />
              <mesh position={[0, 0.55, 0.31]}>
                <circleGeometry args={[0.26, 20]} />
                <meshStandardMaterial color="#3a3d49" roughness={0.3} />
              </mesh>
            </group>
          ))}
        </group>
      );
  }
}

/* ───────────── 머리 장식 ───────────── */

function Gat() {
  return (
    <group position={[0, 0.02, 0]}>
      <mesh>
        <cylinderGeometry args={[0.29, 0.29, 0.012, 28]} />
        <meshStandardMaterial color="#14141a" roughness={0.6} transparent opacity={0.92} />
      </mesh>
      <mesh position={[0, 0.09, 0]}>
        <cylinderGeometry args={[0.085, 0.105, 0.17, 20]} />
        <meshStandardMaterial color="#111116" roughness={0.6} />
      </mesh>
    </group>
  );
}

function Headgear({ kind }: { kind: Costume | "gat-npc" | "jokduri" }): ReactNode {
  switch (kind) {
    case "gat":
    case "gat-npc":
      return <Gat />;
    case "nobi":
      // 머릿수건
      return (
        <group position={[0, -0.03, 0]}>
          <mesh rotation-x={Math.PI / 2 - 0.25}>
            <torusGeometry args={[0.105, 0.022, 8, 24]} />
            <meshStandardMaterial color="#efe8d8" roughness={1} />
          </mesh>
          <mesh position={[0.1, -0.03, -0.06]} rotation-z={0.6}>
            <boxGeometry args={[0.03, 0.1, 0.02]} />
            <meshStandardMaterial color="#efe8d8" roughness={1} />
          </mesh>
        </group>
      );
    case "crown":
      // 익선관
      return (
        <group position={[0, 0, -0.01]}>
          <mesh position={[0, 0.01, 0]} scale={[1, 0.75, 1]}>
            <sphereGeometry args={[0.118, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color="#17131f" roughness={0.5} />
          </mesh>
          <mesh position={[0, 0.1, -0.06]}>
            <boxGeometry args={[0.15, 0.13, 0.07]} />
            <meshStandardMaterial color="#17131f" roughness={0.5} />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.05, 0.2, -0.085]} rotation-z={s * -0.25} scale={[0.5, 1, 0.12]}>
              <sphereGeometry args={[0.06, 12, 10]} />
              <meshStandardMaterial color="#17131f" roughness={0.5} />
            </mesh>
          ))}
          <mesh position={[0, 0.03, 0.112]}>
            <sphereGeometry args={[0.014, 10, 8]} />
            <meshStandardMaterial color="#e2b33c" metalness={0.8} roughness={0.25} />
          </mesh>
        </group>
      );
    case "idol":
      // 헤드셋 마이크
      return (
        <group position={[0, -0.09, 0]}>
          <mesh rotation-y={Math.PI / 2}>
            <torusGeometry args={[0.108, 0.008, 6, 20, Math.PI]} />
            <meshStandardMaterial color="#e9e9ee" roughness={0.4} />
          </mesh>
          <mesh position={[0.1, -0.06, 0.06]} rotation-x={1.1}>
            <cylinderGeometry args={[0.005, 0.005, 0.12, 6]} />
            <meshStandardMaterial color="#e9e9ee" roughness={0.4} />
          </mesh>
          <mesh position={[0.1, -0.1, 0.115]}>
            <sphereGeometry args={[0.016, 10, 8]} />
            <meshStandardMaterial color="#ff5fa2" roughness={0.5} />
          </mesh>
        </group>
      );
    case "jokduri":
      return (
        <group position={[0, 0.02, 0.02]}>
          <mesh>
            <cylinderGeometry args={[0.035, 0.05, 0.05, 6]} />
            <meshStandardMaterial color="#17131f" roughness={0.5} />
          </mesh>
          <mesh position={[0, 0.035, 0]}>
            <sphereGeometry args={[0.014, 8, 8]} />
            <meshStandardMaterial color="#d9463a" roughness={0.3} />
          </mesh>
        </group>
      );
    default:
      return null;
  }
}

/* ───────────── 배우 ───────────── */

const smooth = (k: number) => {
  const x = Math.max(0, Math.min(1, k));
  return x * x * (3 - 2 * x);
};

function heroPose(o: Float32Array, t: number, mood: StageMood, since: number, seed: number) {
  const sway = Math.sin(t * 1.6 + seed) * 0.03;
  o[BODY.spine] += Math.sin(t * 2 + seed) * 0.015;
  o[BODY.rightUpperArm + 2] -= sway;
  o[BODY.leftUpperArm + 2] += sway;
  const k = smooth(since / 0.35);
  switch (mood) {
    case "think":
      // 턱을 괴고 고민
      setBone(o, "rightUpperArm", -0.75 * k, 0, 0.25 * k);
      setBone(o, "rightLowerArm", -2.1 * k);
      setBone(o, "leftUpperArm", -0.35 * k, 0, 0.5 * k);
      setBone(o, "leftLowerArm", -1.3 * k);
      setBone(o, "head", 0.1 * k, Math.sin(t * 0.8) * 0.18 * k, 0.08 * k);
      break;
    case "wait":
      setBone(o, "head", 0, Math.sin(t * 0.6 + seed) * 0.25, 0);
      break;
    case "good":
    case "cheer": {
      const hop = Math.abs(Math.sin(t * 6.5));
      setBone(o, "rightUpperArm", -2.7 * k, 0, -0.35 * k - hop * 0.08);
      setBone(o, "leftUpperArm", -2.7 * k, 0, 0.35 * k + hop * 0.08);
      setBone(o, "rightLowerArm", -0.3 * k);
      setBone(o, "leftLowerArm", -0.3 * k);
      setBone(o, "spine", -0.1 * k);
      o[BODY_DROP] -= hop * 0.035 * k * (mood === "cheer" ? 1.4 : 1);
      break;
    }
    case "bad":
      // 어깨가 축 처지고 고개를 떨군다
      setBone(o, "spine", 0.32 * k);
      setBone(o, "chest", 0.18 * k);
      setBone(o, "head", 0.45 * k, Math.sin(t * 1.2) * 0.12 * k, 0);
      setBone(o, "rightUpperArm", -0.15 * k, 0, 0.05);
      setBone(o, "leftUpperArm", -0.15 * k, 0, -0.05);
      o[BODY_DROP] += 0.02 * k;
      break;
    case "plain":
      // 어깨를 으쓱
      setBone(o, "rightUpperArm", -0.3 * k, 0, -0.45 * k);
      setBone(o, "leftUpperArm", -0.3 * k, 0, 0.45 * k);
      setBone(o, "rightLowerArm", -1.2 * k, 0, -0.4 * k);
      setBone(o, "leftLowerArm", -1.2 * k, 0, 0.4 * k);
      setBone(o, "head", 0, 0, Math.sin(t * 2.2) * 0.08 * k);
      break;
  }
}

function npcPose(o: Float32Array, t: number, mood: StageMood, since: number, seed: number) {
  const k = smooth(since / 0.35);
  o[BODY.spine] += Math.sin(t * 1.8 + seed) * 0.015;
  switch (mood) {
    case "think": {
      // 말을 건네며 손짓
      const g = Math.sin(t * 3.4);
      setBone(o, "rightUpperArm", -0.7, 0, -0.2);
      setBone(o, "rightLowerArm", -1.25 + g * 0.3, 0, -0.3);
      setBone(o, "head", 0.04 + g * 0.03, 0, Math.sin(t * 1.7) * 0.05);
      break;
    }
    case "wait":
      // 팔짱 끼고 기다린다
      setBone(o, "rightUpperArm", -0.55, 0, 0.35);
      setBone(o, "leftUpperArm", -0.55, 0, -0.35);
      setBone(o, "rightLowerArm", -1.7, 0, 0.9);
      setBone(o, "leftLowerArm", -1.7, 0, -0.9);
      setBone(o, "head", 0, 0, Math.sin(t * 1.1) * 0.06);
      break;
    case "good":
    case "cheer": {
      // 손뼉
      const c = Math.sin(t * 13) * 0.14 * k;
      setBone(o, "rightUpperArm", -1.05 * k, 0, 0.3 * k + c);
      setBone(o, "leftUpperArm", -1.05 * k, 0, -0.3 * k - c);
      setBone(o, "rightLowerArm", -1.0 * k, 0, 0.5 * k);
      setBone(o, "leftLowerArm", -1.0 * k, 0, -0.5 * k);
      setBone(o, "head", Math.sin(t * 5) * 0.06 * k);
      break;
    }
    case "bad":
      // 이마를 짚고 고개를 젓는다
      setBone(o, "rightUpperArm", -1.3 * k, 0, 0.55 * k);
      setBone(o, "rightLowerArm", -2.2 * k);
      setBone(o, "head", 0.22 * k, Math.sin(t * 4.2) * 0.2 * k, 0);
      break;
    case "plain":
      setBone(o, "head", Math.sin(t * 3) * 0.08 * k, 0, 0);
      break;
  }
}

function heroFace(mood: StageMood): BodyFace {
  if (mood === "good" || mood === "cheer") return { happy: 1 };
  if (mood === "bad") return { sad: 0.9 };
  if (mood === "think") return { surprised: 0.2 };
  return {};
}
function npcFace(mood: StageMood): BodyFace {
  if (mood === "good" || mood === "cheer") return { happy: 0.9 };
  if (mood === "bad") return { angry: 0.5 };
  return {};
}

function Silhouette({ color }: { color: string }) {
  return (
    <mesh position={[0, 0.8, 0]}>
      <capsuleGeometry args={[0.22, 0.95, 6, 14]} />
      <meshStandardMaterial color={color} roughness={0.9} transparent opacity={0.55} />
    </mesh>
  );
}

function Actor({ look, seed, at, turn, headgear, pose, face, lowDetail, tint }: { look: PersonLook; seed: number; at: number; turn: number; headgear: ReactNode; pose: (o: Float32Array, t: number) => void; face: () => BodyFace; lowDetail: boolean; tint: string }) {
  return (
    <group position={[at, 0, -0.15]} rotation-y={turn}>
      <VrmBody look={look} seed={seed} headY={HEAD_Y} lowDetail={lowDetail} follow={9} pose={pose} face={face} head={headgear} fallback={<Silhouette color={tint} />} />
      <mesh position={[0, 0.012, 0]} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[0.42, 24]} />
        <meshBasicMaterial color="#000" transparent opacity={0.28} depthWrite={false} />
      </mesh>
    </group>
  );
}

/* ───────────── 막 ───────────── */

function CurtainSide({ side, openRef }: { side: -1 | 1; openRef: { current: number } }) {
  const g = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!g.current) return;
    // open 1 = 양옆으로 걷힘, 0 = 가운데까지 닫힘
    const k = openRef.current;
    g.current.position.x = side * (2.35 + k * 2.75);
    g.current.scale.x = 1.9 - k * 0.9;
  });
  return (
    <group ref={g} position={[side * 5.1, 0, 0.9]}>
      {Array.from({ length: 9 }, (_, i) => (
        <mesh key={i} position={[(i - 4) * 0.3, 2.2, (i % 2) * 0.1]}>
          <cylinderGeometry args={[0.19, 0.22, 4.4, 10]} />
          <meshStandardMaterial color={i % 2 ? "#8f1420" : "#b01c2a"} roughness={0.85} />
        </mesh>
      ))}
    </group>
  );
}

function Rig({ openRef }: { openRef: { current: number } }) {
  const { camera, size } = useThree();
  useFrame(({ clock }) => {
    // 좁은 화면(세로 폰)에서는 두 배우가 다 들어오게 조금 물러선다
    const aspect = size.width / Math.max(1, size.height);
    const back = aspect < 1.25 ? 6.3 + (1.25 - aspect) * 4.2 : 6.3;
    const t = clock.elapsedTime;
    camera.position.set(Math.sin(t * 0.25) * 0.12, 1.5 + Math.sin(t * 0.31) * 0.03, back - (1 - openRef.current) * 0.25);
    camera.lookAt(0, 1.08, -0.4);
  });
  return null;
}

function Stage({ set, sceneKey, hero, npc, mood, lowDetail }: SkitStage3DProps) {
  // 화면에 실제로 서 있는 장면 — 막이 닫힌 순간에 갈아 끼운다
  const [shown, setShown] = useState({ set, sceneKey, hero, npc });
  const openRef = useRef(1);
  const want = useRef({ set, sceneKey, hero, npc });
  const moodRef = useRef({ mood, at: 0, now: 0 });
  const tr = useRef<{ phase: "open" | "closing" | "opening"; t: number }>({ phase: "open", t: 0 });

  useFrame(({ clock }, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const m = moodRef.current;
    m.now = clock.elapsedTime;
    const w = want.current;
    const s = tr.current;
    if (s.phase === "open" && w.sceneKey !== shown.sceneKey) {
      s.phase = "closing";
      s.t = 0;
    }
    if (s.phase === "closing") {
      s.t += dt / 0.32;
      openRef.current = 1 - smooth(s.t);
      if (s.t >= 1) {
        s.phase = "opening";
        s.t = 0;
        setShown({ ...w });
      }
    } else if (s.phase === "opening") {
      s.t += dt / 0.5;
      openRef.current = smooth(s.t);
      if (s.t >= 1) s.phase = "open";
    }
  });

  // 최신 props를 프레임 루프에 전달 (렌더 중 ref 쓰기 금지 → 레이아웃 이펙트 없이 이벤트성 대입은 useFrame에서)
  useFrame(() => {
    want.current = { set, sceneKey, hero, npc };
    const m = moodRef.current;
    if (m.mood !== mood) {
      m.mood = mood;
      m.at = m.now;
    }
  }, -1);

  const backdrop = useMemo(() => paintedTexture(`life-skit-set:${shown.set}`, 1536, 768, PAINT[shown.set]), [shown.set]);
  const planks = useMemo(
    () =>
      paintedTexture("life-skit-planks", 512, 512, (ctx, w, h) => {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = "rgba(0,0,0,.16)";
        ctx.lineWidth = 3;
        for (let i = 0; i <= 8; i++) {
          ctx.beginPath();
          ctx.moveTo(0, (h * i) / 8);
          ctx.lineTo(w, (h * i) / 8);
          ctx.stroke();
        }
        for (let i = 0; i < 24; i++) {
          const y = Math.floor(i / 3);
          ctx.beginPath();
          ctx.moveTo(((i * 173) % w), (h * y) / 8);
          ctx.lineTo(((i * 173) % w), (h * (y + 1)) / 8);
          ctx.stroke();
        }
      }),
    [],
  );

  const npcLook = useMemo(() => resolveLook(shown.npc.seed, undefined, { gender: shown.npc.g }), [shown.npc.seed, shown.npc.g]);
  const heroSeed = shown.hero.seed;
  const npcSeed = shown.npc.seed + 31;
  const heroPoseFn = (o: Float32Array, t: number) => heroPose(o, t, moodRef.current.mood, t - moodRef.current.at, heroSeed);
  const npcPoseFn = (o: Float32Array, t: number) => npcPose(o, t, moodRef.current.mood, t - moodRef.current.at, npcSeed);
  const npcGear = shown.npc.joseon ? <Headgear kind={shown.npc.g === "m" ? "gat-npc" : "jokduri"} /> : null;

  return (
    <>
      <Rig openRef={openRef} />
      <hemisphereLight args={["#fff8ec", "#6b5a4a", 1.25]} />
      <directionalLight position={[2.5, 6, 6]} intensity={1.5} castShadow={!lowDetail} shadow-mapSize={[1024, 1024]} shadow-camera-left={-5} shadow-camera-right={5} shadow-camera-top={5} shadow-camera-bottom={-2} />
      <pointLight position={[-3, 3.4, 2.5]} intensity={14} color="#ffd9a8" distance={12} />
      <pointLight position={[3, 3.4, 2.5]} intensity={14} color="#cfe2ff" distance={12} />

      {/* 그림 배경 */}
      <mesh position={[0, 2.2, BACK_Z]}>
        <planeGeometry args={[STAGE_W, 4.5]} />
        <meshBasicMaterial map={backdrop} toneMapped={false} />
      </mesh>
      {/* 무대 바닥 */}
      <mesh position={[0, 0, 0.2]} rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[16, 6]} />
        <meshStandardMaterial color={FLOOR[shown.set]} map={planks} roughness={0.85} />
      </mesh>
      {/* 무대 앞턱과 풋라이트 */}
      <mesh position={[0, -0.35, 3.25]}>
        <boxGeometry args={[16, 0.7, 0.1]} />
        <meshStandardMaterial color="#2a1a14" roughness={0.9} />
      </mesh>
      {Array.from({ length: 11 }, (_, i) => (
        <mesh key={i} position={[(i - 5) * 0.8, 0.05, 2.9]}>
          <sphereGeometry args={[0.06, 10, 8]} />
          <meshStandardMaterial color="#fff2c2" emissive="#ffd977" emissiveIntensity={1.8} />
        </mesh>
      ))}
      <SetProps set={shown.set} />

      <Actor look={shown.hero.look} seed={heroSeed} at={-1.12} turn={0.62} headgear={<Headgear kind={shown.hero.costume} />} pose={heroPoseFn} face={() => heroFace(moodRef.current.mood)} lowDetail={lowDetail} tint="#f2b33d" />
      <Actor look={npcLook} seed={npcSeed} at={1.12} turn={-0.62} headgear={npcGear} pose={npcPoseFn} face={() => npcFace(moodRef.current.mood)} lowDetail={lowDetail} tint="#7aa7d9" />

      {/* 막 */}
      <CurtainSide side={-1} openRef={openRef} />
      <CurtainSide side={1} openRef={openRef} />
      <mesh position={[0, 4.15, 1]}>
        <boxGeometry args={[16, 1.1, 0.5]} />
        <meshStandardMaterial color="#8f1420" roughness={0.85} />
      </mesh>
      {Array.from({ length: 14 }, (_, i) => (
        <mesh key={i} position={[(i - 6.5) * 1.1, 3.6, 1.05]} rotation-x={Math.PI / 2} scale={[1, 1, 0.55]}>
          <cylinderGeometry args={[0.56, 0.56, 0.4, 16, 1, false, 0, Math.PI]} />
          <meshStandardMaterial color="#b01c2a" roughness={0.85} />
        </mesh>
      ))}
    </>
  );
}

export default function SkitStage3D(props: SkitStage3DProps) {
  return (
    <Canvas shadows={!props.lowDetail} dpr={props.lowDetail ? [1, 1.5] : [1, 2]} gl={{ antialias: !props.lowDetail, powerPreference: "high-performance" }} camera={{ fov: 34, position: [0, 1.5, 6.3], near: 0.1, far: 60 }} style={{ touchAction: "pan-y" }}>
      <color attach="background" args={["#120a10"]} />
      <Stage {...props} />
      <AdaptiveResolution max={props.lowDetail ? 1.5 : 2} />
    </Canvas>
  );
}
