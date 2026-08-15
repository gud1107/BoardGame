"use client";

import { Suspense, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import { PerspectiveCamera, View } from "@react-three/drei";

/**
 * A page can only afford a handful of live WebGL contexts (most browsers cap
 * concurrent contexts around 8-16) — but an 8-player Perudo table can have
 * dozens of dice on screen at once (a 5-die hand, 8 roster rows of up to 5
 * hidden dice each, the bid track's betting die, reveal-panel tiles). One
 * `<canvas>` per die was the CSS version's whole trick (real DOM elements
 * are cheap); it does not work for WebGL.
 *
 * The fix is drei's `<View>`: a SINGLE shared `<Canvas>` is mounted once
 * (`DiceStageRoot`, near the top of `PerudoBoard`'s render tree), and every
 * individual die is a small tracked `<div>` (`DiceView`) that tunnels its 3D
 * content into that one canvas — the canvas scissor-renders each tracked
 * div's own screen rectangle every frame. From the outside a `DiceView`
 * behaves like any other inline block box (it sits inside the exact same
 * flex-wrap rows the CSS dice used to), so none of `PerudoBoard.tsx`'s
 * existing layout code needs to change shape, only what's rendered inside.
 *
 * `DiceStageRoot`'s canvas is `position: fixed`, covers the viewport, and is
 * `pointer-events: none` — it paints on top of the page but never intercepts
 * clicks; every real interaction in this game (raise/dudo/calza/face-pick)
 * stays a plain DOM `onClick` on the elements wrapping each `DiceView`,
 * completely unaware that a 3D canvas is involved.
 */

const DICE_STAGE_Z_INDEX = 45;

export function DiceStageRoot() {
  return (
    <Canvas
      dpr={[1, 1.5]}
      gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        pointerEvents: "none",
        zIndex: DICE_STAGE_Z_INDEX,
      }}
    >
      <Suspense fallback={null}>
        <View.Port />
      </Suspense>
    </Canvas>
  );
}

export interface DiceViewProps {
  /** CSS pixel box for this die's on-screen footprint — every `DiceMesh`/`DieTile` this project ships is a fixed 1-unit cube in scene space, so "size" is entirely a matter of how big a screen rectangle the shared camera gets scissored into (see the module header). */
  size: number;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

/**
 * One die's tracked placeholder + its own tiny camera/lighting rig,
 * tunneled into the shared canvas mounted by `DiceStageRoot`.
 *
 * The camera sits almost directly overhead on purpose: a true 3/4 corner
 * view (tried first, see this session's history.md) shows two full faces at
 * once on a real cube, and since every die physically has all six faces on
 * it, one of those two visible faces is the universal red 페루도 mark face
 * roughly a third of the time — a *correct* rendering, but a misleading one
 * for gameplay, since a passing glance could misread a mark sliver on some
 * OTHER value's die as an extra joker in play. Every use of `DiceView` here
 * is a gameplay-critical read (bid track, hand, reveal panel), so legibility
 * wins over cinematic angle — steep enough that the only face that reads
 * clearly is the one `quaternionForFaceUp` actually put on top.
 */
export function DiceView({ size, className, style, children }: DiceViewProps) {
  return (
    <View className={className} style={{ width: size, height: size, ...style }}>
      <PerspectiveCamera makeDefault position={[0.4, 2.5, 1.05]} fov={22} onUpdate={(camera) => camera.lookAt(0, 0, 0)} />
      <ambientLight intensity={0.95} />
      <directionalLight position={[1.5, 3, 2]} intensity={1.2} />
      <directionalLight position={[-2, 1, -1]} intensity={0.25} />
      {children}
    </View>
  );
}

/**
 * Client-only WebGL feature check, used to gate the whole 3D dice system.
 * Built on `useSyncExternalStore` rather than an effect+state pair on
 * purpose: "read some fact from the browser environment once" is exactly
 * what its `getServerSnapshot` param exists for, and it sidesteps this
 * project's stricter react-hooks lint rule against synchronous `setState`
 * calls inside an effect body (see HANDOFF.md). There's nothing to actually
 * subscribe to (WebGL support can't change mid-session), so `subscribe` is a
 * no-op. Server/first-paint snapshot is `false` — always answered instantly,
 * this is what makes SSR-safety free here rather than needing its own `null`
 * "still checking" tri-state the caller would have to remember to handle.
 */
function subscribeNever() {
  return () => {};
}
let cachedWebglSupport: boolean | null = null;
function getWebglSupportSnapshot(): boolean {
  if (cachedWebglSupport === null) {
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      cachedWebglSupport = !!gl;
    } catch {
      cachedWebglSupport = false;
    }
  }
  return cachedWebglSupport;
}
function getWebglSupportServerSnapshot(): boolean {
  return false;
}
export function useWebglSupport(): boolean {
  return useSyncExternalStore(subscribeNever, getWebglSupportSnapshot, getWebglSupportServerSnapshot);
}
