"use client";

import { useMemo, useRef, type ReactNode, type RefObject } from "react";
import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { AdaptiveResolution } from "@/games/shared/three/sceneFx";
import { emojiTexture, FONTS, paintedTexture } from "@/games/shared/three/tableKit";
import { CORRIDOR_H, CORRIDOR_LEN, CORRIDOR_W, type ShownProp } from "../engine";

/**
 * 이상한 복도 3D (rulebook §7). A long night corridor lit by four
 * fluorescent panels; the camera walks slowly down the hall while the round
 * runs and can be dragged to look around. Every prop is tappable — a missing
 * prop leaves an invisible hit box where it used to be. Lint: per-frame
 * camera / light mutation lives in plain functions outside components.
 *
 * World: x across (left wall −W/2), y up, z = −distance down the hall.
 */

export interface CorridorSceneProps {
  props: ShownProp[];
  selectedId: string | null;
  /** Revealed answer (prop id) to outline in red, or null. */
  revealId: string | null;
  /** Date.now() when this walk started. */
  walkStart: number;
  walkMs: number;
  /** 0..1 how deep into the game — the hall gets darker and flickers more. */
  dread: number;
  lowDetail: boolean;
  onPick: ((id: string) => void) | null;
}

const W2 = CORRIDOR_W / 2;
const WALK = 7.5;

/** Where a prop sits and which way it faces. */
function placement(p: ShownProp): { pos: [number, number, number]; rotY: number; rotX: number } {
  const z = -p.z;
  if (p.side === "L") return { pos: [-W2 + 0.04, p.y, z], rotY: Math.PI / 2, rotX: 0 };
  if (p.side === "R") return { pos: [W2 - 0.04, p.y, z], rotY: -Math.PI / 2, rotX: 0 };
  if (p.side === "E") return { pos: [p.kind === "figure" ? 0.4 : p.kind === "exitSign" ? 0 : 0, p.y, p.kind === "figure" ? z : -CORRIDOR_LEN + 0.04], rotY: 0, rotX: 0 };
  if (p.side === "C") return { pos: [0, p.y, z], rotY: 0, rotX: Math.PI / 2 };
  return { pos: [0.3, 0.006, z], rotY: 0, rotX: -Math.PI / 2 };
}

function Pic({ icon, w, h, z = 0.03 }: { icon: string; w: number; h: number; z?: number }) {
  if (!icon) return null;
  const s = Math.min(w, h);
  return (
    <mesh position={[0, 0, z]}>
      <planeGeometry args={[s, s]} />
      <meshBasicMaterial map={emojiTexture(icon)} transparent toneMapped={false} />
    </mesh>
  );
}

/** Plain painted text (door numbers, poster captions, the exit sign). */
function textTexture(text: string, fg: string) {
  return paintedTexture(`corridor-text:${text}:${fg}`, 256, 64, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = fg;
    ctx.font = `800 40px ${FONTS.text}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, w / 2, h / 2 + 2, w - 12);
  });
}

function Label({ text, color, w, y = 0, z = 0.04 }: { text: string; color: string; w: number; y?: number; z?: number }) {
  return (
    <mesh position={[0, y, z]}>
      <planeGeometry args={[w, w / 4]} />
      <meshBasicMaterial map={textTexture(text, color)} transparent toneMapped={false} />
    </mesh>
  );
}

/** The prop's body — simple shapes, coloured by `p.color`. */
function Body({ p }: { p: ShownProp }) {
  const c = p.color;
  switch (p.kind) {
    case "door":
      return (
        <group>
          <mesh position={[0, 0, 0.03]}>
            <boxGeometry args={[p.w, p.h, 0.06]} />
            <meshStandardMaterial color={c} roughness={0.7} />
          </mesh>
          <mesh position={[0.36, -0.05, 0.08]}>
            <sphereGeometry args={[0.045, 10, 8]} />
            <meshStandardMaterial color="#d6d3d1" metalness={0.8} roughness={0.3} />
          </mesh>
          <mesh position={[0, 0.7, 0.065]}>
            <planeGeometry args={[0.42, 0.16]} />
            <meshStandardMaterial color="#e7e5e4" />
          </mesh>
          {p.label && <Label text={p.label} color="#111" w={0.4} y={0.7} z={0.07} />}
        </group>
      );
    case "painting":
    case "poster":
      return (
        <group>
          <mesh position={[0, 0, 0.02]}>
            <boxGeometry args={[p.w, p.h, 0.04]} />
            <meshStandardMaterial color={c} roughness={0.6} />
          </mesh>
          <Pic icon={p.icon} w={p.w * 0.8} h={p.h * 0.7} z={0.045} />
          {p.label && <Label text={p.label} color="#111" w={p.w * 0.9} y={-p.h * 0.36} z={0.046} />}
        </group>
      );
    case "clock":
      return (
        <group>
          <mesh position={[0, 0, 0.02]} rotation-x={Math.PI / 2}>
            <cylinderGeometry args={[p.w / 2, p.w / 2, 0.05, 24]} />
            <meshStandardMaterial color={c} />
          </mesh>
          <Pic icon={p.icon} w={p.w * 0.9} h={p.h * 0.9} z={0.05} />
        </group>
      );
    case "extinguisher":
      return (
        <mesh position={[0, 0, 0.14]}>
          <cylinderGeometry args={[p.w / 2, p.w / 2, p.h, 14]} />
          <meshStandardMaterial color={c} roughness={0.4} />
        </mesh>
      );
    case "plant":
      return (
        <group position={[0, 0, 0.3]}>
          <mesh position={[0, -0.25, 0]}>
            <cylinderGeometry args={[0.18, 0.14, 0.4, 12]} />
            <meshStandardMaterial color="#7c2d12" />
          </mesh>
          <mesh position={[0, 0.15, 0]}>
            <sphereGeometry args={[0.3, 12, 10]} />
            <meshStandardMaterial color={c} roughness={0.9} />
          </mesh>
        </group>
      );
    case "vending":
      return (
        <group position={[0, 0, 0.35]}>
          <mesh>
            <boxGeometry args={[p.w, p.h, 0.7]} />
            <meshStandardMaterial color={c} roughness={0.5} />
          </mesh>
          <mesh position={[-0.1, 0.25, 0.36]}>
            <planeGeometry args={[0.55, 0.9]} />
            <meshStandardMaterial color="#e0f2fe" emissive="#7dd3fc" emissiveIntensity={0.9} />
          </mesh>
          <group position={[-0.1, 0.25, 0.37]}>
            <Pic icon={p.icon} w={0.3} h={0.3} z={0} />
          </group>
        </group>
      );
    case "bench":
      return (
        <mesh position={[0, 0, 0.3]}>
          <boxGeometry args={[p.w, 0.12, 0.45]} />
          <meshStandardMaterial color={c} roughness={0.8} />
        </mesh>
      );
    case "cctv":
      return (
        <group rotation-x={-Math.PI / 2}>
          <mesh position={[0, -0.12, 0]} rotation-x={0.4}>
            <boxGeometry args={[0.16, 0.12, 0.32]} />
            <meshStandardMaterial color={c} />
          </mesh>
          <mesh position={[0, -0.16, 0.17]}>
            <sphereGeometry args={[0.025, 8, 6]} />
            <meshBasicMaterial color="#ef4444" toneMapped={false} />
          </mesh>
        </group>
      );
    case "lamp":
      return (
        <mesh>
          <boxGeometry args={[p.w, p.h, 0.05]} />
          <meshStandardMaterial color={c} emissive={c} emissiveIntensity={1.6} toneMapped={false} />
        </mesh>
      );
    case "exitSign":
      return (
        <group>
          <mesh>
            <boxGeometry args={[p.w, p.h, 0.06]} />
            <meshStandardMaterial color={c} emissive={c} emissiveIntensity={1.4} toneMapped={false} />
          </mesh>
          {p.label && <Label text={`🏃 ${p.label}`} color="#ffffff" w={p.w * 0.95} z={0.035} />}
        </group>
      );
    case "window":
      return (
        <group>
          <mesh position={[0, 0, 0.01]}>
            <boxGeometry args={[p.w + 0.1, p.h + 0.1, 0.03]} />
            <meshStandardMaterial color="#d6d3d1" />
          </mesh>
          <mesh position={[0, 0, 0.03]}>
            <planeGeometry args={[p.w, p.h]} />
            <meshStandardMaterial color={c} emissive="#0f172a" emissiveIntensity={0.6} />
          </mesh>
          <Pic icon={p.icon} w={0.45} h={0.45} z={0.04} />
        </group>
      );
    case "figure":
      return (
        <group>
          <mesh>
            <capsuleGeometry args={[0.22, 1.25, 6, 12]} />
            <meshBasicMaterial color={c} />
          </mesh>
          <mesh position={[0, 0.98, 0]}>
            <sphereGeometry args={[0.2, 12, 10]} />
            <meshBasicMaterial color={c} />
          </mesh>
          {[-0.07, 0.07].map((x) => (
            <mesh key={x} position={[x, 1.0, 0.19]}>
              <sphereGeometry args={[0.025, 8, 6]} />
              <meshBasicMaterial color="#f87171" toneMapped={false} />
            </mesh>
          ))}
        </group>
      );
    default:
      // handprint / footprints: a decal
      return <Pic icon={p.icon} w={p.w} h={p.w} z={0.01} />;
  }
}

/** Generous invisible hit box (also stands in for a missing prop). */
function HitBox({ p }: { p: ShownProp }) {
  const d = p.kind === "vending" ? 0.8 : p.kind === "plant" || p.kind === "bench" ? 0.6 : 0.25;
  const pad = 0.12;
  return (
    <mesh position={[0, 0, d / 2]}>
      <boxGeometry args={[Math.max(0.4, p.w + pad), Math.max(0.4, p.h + pad), d]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

function Outline({ p, color, pulse }: { p: ShownProp; color: string; pulse: boolean }) {
  const ref = useRef<THREE.LineBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (ref.current && pulse) ref.current.opacity = 0.55 + Math.sin(clock.elapsedTime * 8) * 0.45;
  });
  const geo = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(p.w * p.scale + 0.16, p.h * p.scale + 0.16, 0.3)), [p.w, p.h, p.scale]);
  return (
    <lineSegments geometry={geo} position={[0, 0, 0.15]}>
      <lineBasicMaterial ref={ref} color={color} transparent toneMapped={false} />
    </lineSegments>
  );
}

function PropNode({ p, selected, revealed, onPick }: { p: ShownProp; selected: boolean; revealed: boolean; onPick: ((id: string) => void) | null }) {
  const { pos, rotY, rotX } = placement(p);
  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (!onPick || e.delta > 8) return; // a drag to look around, not a tap
    onPick(p.id);
  };
  return (
    <group position={pos} rotation={[rotX, rotY, 0]}>
      <group rotation-z={p.tilt} scale={p.scale}>
        {!p.hidden && <Body p={p} />}
        {revealed && p.hidden && (
          // the ghost of what's gone
          <mesh position={[0, 0, 0.05]}>
            <planeGeometry args={[p.w, p.h]} />
            <meshBasicMaterial color="#f43f5e" transparent opacity={0.18} depthWrite={false} />
          </mesh>
        )}
      </group>
      <group onClick={click}>
        <HitBox p={p} />
      </group>
      {selected && <Outline p={p} color="#38bdf8" pulse={false} />}
      {revealed && <Outline p={p} color="#f43f5e" pulse />}
    </group>
  );
}

function Shell() {
  const len = CORRIDOR_LEN + 2;
  return (
    <group>
      {/* floor, ceiling, walls */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, -len / 2 + 1]}>
        <planeGeometry args={[CORRIDOR_W, len]} />
        <meshStandardMaterial color="#3f3f37" roughness={0.35} metalness={0.05} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.003, -len / 2 + 1]}>
        <planeGeometry args={[1.1, len]} />
        <meshStandardMaterial color="#4a2a24" roughness={0.9} />
      </mesh>
      <mesh rotation-x={Math.PI / 2} position={[0, CORRIDOR_H, -len / 2 + 1]}>
        <planeGeometry args={[CORRIDOR_W, len]} />
        <meshStandardMaterial color="#cbd5c0" roughness={0.9} />
      </mesh>
      {[-1, 1].map((s) => (
        <group key={s}>
          <mesh rotation-y={(-s * Math.PI) / 2} position={[s * W2, CORRIDOR_H / 2, -len / 2 + 1]}>
            <planeGeometry args={[len, CORRIDOR_H]} />
            <meshStandardMaterial color="#9ca38f" roughness={0.85} />
          </mesh>
          <mesh rotation-y={(-s * Math.PI) / 2} position={[s * (W2 - 0.01), 0.06, -len / 2 + 1]}>
            <planeGeometry args={[len, 0.12]} />
            <meshStandardMaterial color="#3f3f46" />
          </mesh>
        </group>
      ))}
      <mesh position={[0, CORRIDOR_H / 2, -CORRIDOR_LEN]}>
        <planeGeometry args={[CORRIDOR_W, CORRIDOR_H]} />
        <meshStandardMaterial color="#8a917e" roughness={0.85} />
      </mesh>
      {/* behind the camera: a closed door, so looking back isn't a void */}
      <mesh position={[0, CORRIDOR_H / 2, 1.2]} rotation-y={Math.PI}>
        <planeGeometry args={[CORRIDOR_W, CORRIDOR_H]} />
        <meshStandardMaterial color="#57534e" roughness={0.9} />
      </mesh>
    </group>
  );
}

/** One point light under each ceiling panel; colour / presence follow the (possibly altered) lamp. */
function Lights({ lamps, dread }: { lamps: ShownProp[]; dread: number }) {
  const refs = useRef<(THREE.PointLight | null)[]>([]);
  const flickerIdx = lamps.length > 0 ? Math.floor(lamps.length / 2) : -1;
  useFrame(({ clock }) => flickerFrame(refs.current, flickerIdx, clock.elapsedTime, dread));
  return (
    <group>
      {lamps.map((l, i) =>
        l.hidden ? null : (
          <pointLight
            key={l.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            position={[0, CORRIDOR_H - 0.3, -l.z]}
            color={l.color}
            intensity={2.4}
            distance={7}
            decay={1.4}
          />
        ),
      )}
    </group>
  );
}

function flickerFrame(lights: (THREE.PointLight | null)[], idx: number, t: number, dread: number) {
  const base = 2.6 - dread * 1.1;
  lights.forEach((l, i) => {
    if (!l) return;
    let k = 1;
    if (i === idx && dread > 0.25) {
      const n = Math.sin(t * 31) * Math.sin(t * 7.7) + Math.sin(t * 2.1);
      k = n > 1.2 - dread * 0.8 ? 0.15 : 1;
    }
    l.intensity = base * k;
  });
}

/** Walk + drag-to-look. Yaw/pitch live in a ref the canvas wrapper writes to. */
function CameraRig({ walkStart, walkMs, look }: { walkStart: number; walkMs: number; look: RefObject<{ yaw: number; pitch: number }> }) {
  useFrame(({ camera }) => rigFrame(camera, walkStart, walkMs, look.current));
  return null;
}

function rigFrame(camera: THREE.Camera, walkStart: number, walkMs: number, look: { yaw: number; pitch: number }) {
  const t = Math.max(0, Math.min(1, (Date.now() - walkStart) / Math.max(1, walkMs)));
  const ease = 1 - Math.pow(1 - t, 1.6);
  const z = 0.6 - ease * WALK;
  const bob = Math.sin(t * walkMs * 0.0075) * 0.012 * (t < 1 ? 1 : 0);
  camera.position.set(0, 1.6 + bob, z);
  camera.rotation.set(look.pitch, look.yaw, 0, "YXZ");
}

export default function CorridorScene(p: CorridorSceneProps) {
  const look = useRef({ yaw: 0, pitch: -0.04 });
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null);
  const lamps = p.props.filter((x) => x.kind === "lamp");
  const nodes: ReactNode[] = p.props.map((x) => <PropNode key={x.id} p={x} selected={x.id === p.selectedId} revealed={x.id === p.revealId} onPick={p.onPick} />);
  const high = !p.lowDetail;
  return (
    <div
      className="h-full w-full"
      style={{ touchAction: "none", cursor: p.onPick ? "pointer" : "grab" }}
      onPointerDown={(e) => {
        drag.current = { x: e.clientX, y: e.clientY, yaw: look.current.yaw, pitch: look.current.pitch };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        look.current = { yaw: Math.max(-1.6, Math.min(1.6, d.yaw + (e.clientX - d.x) * 0.006)), pitch: Math.max(-0.7, Math.min(0.6, d.pitch + (e.clientY - d.y) * 0.004)) };
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerLeave={() => {
        drag.current = null;
      }}
    >
      <Canvas dpr={high ? [1, 1.75] : 1} gl={{ antialias: high, powerPreference: "high-performance" }} camera={{ fov: 62, position: [0, 1.6, 0.6], near: 0.05, far: 40 }}>
        <color attach="background" args={["#050605"]} />
        <fog attach="fog" args={["#050605", 6, 17 - p.dread * 4]} />
        <AdaptiveResolution max={1.75} />
        <CameraRig walkStart={p.walkStart} walkMs={p.walkMs} look={look} />
        <ambientLight intensity={0.22 - p.dread * 0.08} color="#d9f99d" />
        <hemisphereLight args={["#e2e8f0", "#1c1917", 0.18]} />
        <Lights lamps={lamps} dread={p.dread} />
        <Shell />
        {nodes}
      </Canvas>
    </div>
  );
}
