"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { VignetteShader } from "three/examples/jsm/shaders/VignetteShader.js";
import { FpsWindow, nextDpr } from "./frameBudget";

/**
 * Shared "make it look rendered, not drawn" layer for the 3D table scenes.
 * Presentation only — nothing here reads game state.
 *
 *  - StudioEnvironment: image-based lighting (PMREM of three's RoomEnvironment)
 *    so skin, wood, felt and metal pick up soft reflections and fill. Cheap
 *    enough for every device (one pre-filtered cube map, built once).
 *  - BlobShadow: a soft radial contact shadow decal — grounds chairs, people and
 *    the table base even where the shadow map is off (low detail / mobile).
 *  - PostFx: MSAA HDR composer → GTAO (contact occlusion) → gentle bloom →
 *    vignette → tone mapping. High detail only, and it steps itself down on a
 *    device that can't hold the frame rate (AO first, then the whole chain).
 */

export function StudioEnvironment({ intensity = 0.45 }: { intensity?: number }) {
  const get = useThree((s) => s.get);
  useEffect(() => {
    // scene-wide (not per-material like Chess3D): every theme's people, props and table pick it up.
    // Per-material envMapIntensity is ignored this way — tone a too-shiny surface down with metalness.
    const { gl, scene } = get();
    const pm = new THREE.PMREMGenerator(gl);
    const env = new RoomEnvironment();
    const tex = pm.fromScene(env, 0.04).texture;
    env.dispose();
    pm.dispose();
    const prev = scene.environment;
    const prevIntensity = scene.environmentIntensity;
    scene.environment = tex;
    scene.environmentIntensity = intensity;
    return () => {
      scene.environment = prev;
      scene.environmentIntensity = prevIntensity;
      tex.dispose();
    };
  }, [get, intensity]);
  return null;
}

let blobTex: THREE.Texture | null = null;
function blobTexture(): THREE.Texture {
  if (blobTex) return blobTex;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(0,0,0,0.62)");
  grad.addColorStop(0.45, "rgba(0,0,0,0.34)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  blobTex = new THREE.CanvasTexture(c);
  return blobTex;
}

/** Soft contact shadow lying on the floor (y is the floor height in the parent frame). */
export function BlobShadow({ radius, y = 0.012, opacity = 1, stretch = 1 }: { radius: number; y?: number; opacity?: number; stretch?: number }) {
  const map = useMemo(() => blobTexture(), []);
  return (
    <mesh position={[0, y, 0]} rotation-x={-Math.PI / 2} scale={[radius * 2, radius * 2 * stretch, 1]} renderOrder={-1}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial map={map} transparent opacity={opacity} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

/**
 * Starts at the device's real pixel ratio (capped at 2) so text and edges stay crisp on
 * phones; after a 1 s warm-up it reads the frame rate over 1.2 s and, if it's under ~45 fps,
 * jumps straight to the ratio that should fit (see nextDpr) — on a weak phone that's one
 * change ~2-3 s in, typically while the opening role/setup popup still covers the table.
 * A fixed low cap (the old 1.25 on mobile) rendered a 3× phone at ~40% resolution.
 */
export function AdaptiveResolution({ max = 2 }: { max?: number }) {
  const setDpr = useThree((s) => s.setDpr);
  const get = useThree((s) => s.get);
  const force = useMemo(() => forcedFx(), []);
  const dpr = useRef(1);
  const fps = useRef(new FpsWindow(1, 1.2));
  useEffect(() => {
    // the Canvas' own dpr range already starts there — only read it: every setDpr reallocates
    // the drawing buffer (a redundant one here cost ~0.8 s of frozen frames on a throttled phone)
    const want = Math.max(1, Math.min(max, window.devicePixelRatio || 1));
    dpr.current = get().viewport.dpr;
    if (dpr.current > want) {
      dpr.current = want;
      setDpr(want);
    }
  }, [max, get, setDpr]);
  useFrame((_, delta) => {
    if (force || dpr.current <= 1) return;
    const now = performance.now() / 1000;
    const reading = fps.current.tick(now, delta);
    if (reading === null) return;
    const next = nextDpr(dpr.current, reading);
    if (next === dpr.current) return;
    dpr.current = next;
    setDpr(next);
    fps.current.reset(now);
  });
  return null;
}

/** What the quality steppers last decided — read by PerfHud. */
const fxState = { tier: "-" as string };

/**
 * `?perf=1` on any 3D table: a small overlay with fps, pixel ratio, the longest stall since
 * load, draw calls, shader programs and the post-FX tier — for checking a real phone, where
 * the headless/software-GPU numbers are only a rough stand-in. Plain DOM (no extra deps).
 */
export function PerfHud() {
  const get = useThree((s) => s.get);
  const on = useMemo(() => {
    if (typeof window === "undefined") return false;
    try {
      return new URLSearchParams(window.location.search).get("perf") === "1";
    } catch {
      return false;
    }
  }, []);
  const stats = useRef({ frames: 0, since: 0, worst: 0, born: 0, first: 0 });
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!on) return;
    const parent = get().gl.domElement.parentElement;
    if (!parent) return;
    const el = document.createElement("div");
    el.style.cssText = "position:absolute;left:4px;top:4px;z-index:5;pointer-events:none;font:11px/1.35 ui-monospace,monospace;color:#d9f99d;background:rgba(0,0,0,.72);padding:4px 6px;border-radius:6px;white-space:pre";
    parent.appendChild(el);
    box.current = el;
    stats.current.born = performance.now();
    return () => {
      el.remove();
      box.current = null;
    };
  }, [on, get]);
  useFrame(({ gl, viewport }, delta) => {
    if (!on || !box.current) return;
    const s = stats.current;
    const now = performance.now();
    if (!s.first) s.first = now - s.born;
    s.frames++;
    s.worst = Math.max(s.worst, delta * 1000);
    if (!s.since) s.since = now;
    if (now - s.since < 500) return;
    const fps = (s.frames * 1000) / (now - s.since);
    s.frames = 0;
    s.since = now;
    box.current.textContent = [
      `fps ${fps.toFixed(0)}  dpr ${viewport.dpr.toFixed(2)}/${(window.devicePixelRatio || 1).toFixed(1)}`,
      `stall ${Math.round(s.worst)}ms  1st ${Math.round(s.first)}ms`,
      `calls ${gl.info.render.calls}  prog ${gl.info.programs?.length ?? "?"}  fx ${fxState.tier}`,
    ].join("\n");
  });
  return null;
}

/** QA override: `?fx=hi` keeps the full chain even on a slow (e.g. headless/software) GPU. */
function forcedFx(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get("fx") === "hi";
  } catch {
    return false;
  }
}

/**
 * Takes over rendering (useFrame priority 1). `bloom` is the strength — themes
 * with flames / neon can ask for more; 0 skips the pass.
 */
interface Chain {
  composer: EffectComposer;
  gtao: GTAOPass | null;
  target: THREE.WebGLRenderTarget;
}

export function PostFx({ bloom = 0.28, ao = true }: { bloom?: number; ao?: boolean }) {
  const get = useThree((s) => s.get);
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);
  const force = useMemo(() => forcedFx(), []);
  // 0 = full chain, 1 = AO dropped, 2 = composer off (plain render)
  const tier = useRef(0);
  const fps = useRef(new FpsWindow(1, 1.2));
  const chain = useRef<Chain | null>(null);

  useEffect(() => {
    const { gl, scene, camera, size: sz, viewport } = get();
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    const composer = new EffectComposer(gl, target);
    composer.addPass(new RenderPass(scene, camera));
    let gtao: GTAOPass | null = null;
    if (ao) {
      gtao = new GTAOPass(scene, camera, 1, 1);
      gtao.updateGtaoMaterial({ radius: 0.28, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, samples: 12 });
      gtao.updatePdMaterial({ radius: 6, rings: 2, samples: 12, lumaPhi: 10, depthPhi: 2, normalPhi: 3 });
      gtao.blendIntensity = 0.85;
      // name tags, bubbles and glow rings are flat sprites/decals — keep them out of the
      // depth/normal pre-pass or they cast dark halos onto the faces behind them
      const hide = gtao as unknown as { _overrideVisibility: () => void; _visibilityCache: THREE.Object3D[]; scene: THREE.Scene };
      const base = hide._overrideVisibility.bind(gtao);
      hide._overrideVisibility = () => {
        base();
        hide.scene.traverse((o) => {
          const mat = (o as THREE.Mesh).material as THREE.Material | undefined;
          if (o.visible && ((o as THREE.Sprite).isSprite || (mat && !Array.isArray(mat) && mat.transparent && !mat.depthWrite))) {
            o.visible = false;
            hide._visibilityCache.push(o);
          }
        });
      };
      composer.addPass(gtao);
    }
    let bloomPass: UnrealBloomPass | null = null;
    if (bloom > 0) {
      // threshold well above 1 in linear HDR: only real highlights (lamp glints, flames, emissive
      // gems) glow — at ~1.0 the lamp-lit name placards and label sprites smeared into white
      bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), bloom, 0.5, 1.6);
      composer.addPass(bloomPass);
    }
    const vignette = new ShaderPass(VignetteShader);
    // the shader mixes the edges toward grey (1 - darkness): keep darkness at exactly 1 (black)
    // and set the strength with offset — >1 goes negative (hue-shifted night skies), <1 fogs
    // the whole frame grey
    vignette.uniforms.offset.value = 0.7;
    vignette.uniforms.darkness.value = 1;
    composer.addPass(vignette);
    composer.addPass(new OutputPass());
    composer.setPixelRatio(viewport.dpr);
    composer.setSize(sz.width, sz.height);
    chain.current = { composer, gtao, target };
    fxState.tier = gtao ? "full" : "no-AO";
    return () => {
      chain.current = null;
      fxState.tier = "-";
      composer.dispose();
      gtao?.dispose();
      target.dispose();
    };
  }, [get, ao, bloom]);

  useEffect(() => {
    chain.current?.composer.setPixelRatio(dpr);
    chain.current?.composer.setSize(size.width, size.height);
  }, [size.width, size.height, dpr]);

  useFrame(({ gl, scene, camera }, delta) => {
    const c = chain.current;
    if (!force && tier.current < 2) {
      // wall-clock windows after a warm-up; below ~40fps drop AO, then the whole chain
      const now = performance.now() / 1000;
      const reading = fps.current.tick(now, delta);
      if (reading !== null && reading < 40) {
        // far below budget: AO alone won't rescue it, go straight to the plain render
        tier.current = reading < 20 || !c?.gtao ? 2 : tier.current + 1;
        if (tier.current === 1 && c?.gtao) c.gtao.enabled = false;
        fxState.tier = tier.current >= 2 ? "plain" : "no-AO";
        fps.current.reset(now);
      }
    }
    if (!c || tier.current >= 2) gl.render(scene, camera);
    else c.composer.render(delta);
  }, 1);

  return null;
}
