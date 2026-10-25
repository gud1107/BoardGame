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
 * phones, then steps down by 0.25 (to 1) whenever a ~1.5s window averages under ~45fps.
 * A fixed low cap (the old 1.25 on mobile) rendered a 3× phone at ~40% resolution.
 */
export function AdaptiveResolution({ max = 2 }: { max?: number }) {
  const setDpr = useThree((s) => s.setDpr);
  const force = useMemo(() => forcedFx(), []);
  const dpr = useRef(1);
  const perf = useRef({ frames: 0, acc: 0 });
  useEffect(() => {
    dpr.current = Math.max(1, Math.min(max, window.devicePixelRatio || 1));
    setDpr(dpr.current);
  }, [max, setDpr]);
  useFrame((_, delta) => {
    if (force || dpr.current <= 1) return;
    const p = perf.current;
    p.frames++;
    if (p.frames > 60) p.acc += Math.min(delta, 0.25);
    if (p.frames < 150) return;
    if (p.acc / 90 > 1 / 45) {
      dpr.current = Math.max(1, dpr.current - 0.25);
      setDpr(dpr.current);
    }
    p.frames = 0;
    p.acc = 0;
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
  const perf = useRef({ frames: 0, acc: 0 });
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
    return () => {
      chain.current = null;
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
      // average over ~1.5s windows after a warm-up; step down when below ~40fps
      const p = perf.current;
      p.frames++;
      if (p.frames > 60) p.acc += Math.min(delta, 0.25);
      if (p.frames >= 150) {
        const avg = p.acc / 90;
        if (avg > 1 / 40) {
          tier.current++;
          if (tier.current === 1 && c?.gtao) c.gtao.enabled = false;
          else if (tier.current === 1) tier.current = 2;
        }
        p.frames = 0;
        p.acc = 0;
      }
    }
    if (!c || tier.current >= 2) gl.render(scene, camera);
    else c.composer.render(delta);
  }, 1);

  return null;
}
