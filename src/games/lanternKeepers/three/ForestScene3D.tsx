"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import ScreenSprite from "@/games/shared/three/ScreenSprite";
import SpeechBubble from "@/games/shared/three/SpeechBubble";
import { AdaptiveResolution } from "@/games/shared/three/sceneFx";
import { labelTexture } from "@/games/shared/three/tableKit";
import { T_RAVINE, T_TREE, T_UNKNOWN, allChecked, monsterCell, type GameState } from "../engine";
import { lantern, pingMark, WORDS } from "../show";

/**
 * 등불 지기 3D — 캄캄한 숲을 비스듬히 내려다본다. 한 칸 = 1 유닛.
 * 빛은 진짜 빛: 등불마다 그 색 점광원이 하나씩, 달빛은 아주 약하게. 팀이 본 적 없는 칸은
 * 아예 그리지 않고(새까맣게), 본 적은 있지만 지금 아무 빛도 안 닿는 칸은 푸르스름하게 어둡다.
 * 색 있는 물건(다리·함정·괴물)은 보기(view)에 있는 것만 — 즉 내 등불 색이거나 드러난 것만.
 * 색마다 문양 라벨을 같이 띄워 색만으로 구분하지 않게 한다.
 *
 * 가벼움: 바닥·나무는 instancedMesh, 그림자 맵 없음, 점광원 최대 5개.
 */

export interface SceneFx {
  key: string;
  cell: number;
  icon: string;
}

export interface ForestScene3DProps {
  view: GameState;
  viewerSeat: number;
  /** 좌석별로 지금 그릴 칸 (걸음 애니메이션 중이면 중간 칸) */
  displayPos: number[];
  /** 지금 내 빛·누구 빛이든 닿는 칸 */
  myLit: Set<number>;
  anyLit: Set<number>;
  /** 내 계획 초안 (칸 목록) */
  draft: number[];
  names: Record<number, string>;
  fx: SceneFx[];
  showChecked: boolean;
  lowDetail: boolean;
  /** 확대 모드에서 따라갈 칸 (없으면 전체 보기) */
  focus: number | null;
  onCellTap: (cell: number) => void;
}

const TREE_H = 1.1;

function useGrid(view: GameState) {
  const ox = -view.w / 2 + 0.5;
  const oz = -view.h / 2 + 0.5;
  return useMemo(() => ({ at: (c: number): [number, number, number] => [(c % view.w) + ox, 0, Math.floor(c / view.w) + oz] }), [view.w, ox, oz]);
}

function damp(cur: number, target: number, k: number, dt: number) {
  return cur + (target - cur) * (1 - Math.exp(-k * dt));
}

function Ground({ view, myLit, anyLit, showChecked, onCellTap }: Pick<ForestScene3DProps, "view" | "myLit" | "anyLit" | "showChecked" | "onCellTap">) {
  const { at } = useGrid(view);
  const floorRef = useRef<THREE.InstancedMesh>(null);
  const trunkRef = useRef<THREE.InstancedMesh>(null);
  const crownRef = useRef<THREE.InstancedMesh>(null);
  const { floors, trees } = useMemo(() => {
    const f: number[] = [];
    const t: number[] = [];
    for (let c = 0; c < view.w * view.h; c++) {
      const tile = view.tiles[c];
      if (tile === T_UNKNOWN) continue;
      if (tile === T_TREE) t.push(c);
      else f.push(c);
    }
    return { floors: f, trees: t };
  }, [view.tiles, view.w, view.h]);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    floors.forEach((c, i) => {
      const p = at(c);
      const ravine = view.tiles[c] === T_RAVINE;
      m.makeTranslation(p[0], ravine ? -0.35 : -0.03, p[2]);
      floorRef.current?.setMatrixAt(i, m);
      const lit = anyLit.has(c);
      let hex = ravine ? (lit ? "#13233f" : "#0a1222") : myLit.has(c) ? "#5b4a33" : lit ? "#3c3426" : "#1d2230";
      if (showChecked && !ravine) hex = allChecked(view, c) ? (lit ? "#3f5a3a" : "#22362a") : hex;
      floorRef.current?.setColorAt(i, col.set(hex));
    });
    if (floorRef.current) {
      floorRef.current.count = floors.length;
      floorRef.current.instanceMatrix.needsUpdate = true;
      if (floorRef.current.instanceColor) floorRef.current.instanceColor.needsUpdate = true;
    }
    trees.forEach((c, i) => {
      const p = at(c);
      // 칸마다 조금씩 다른 크기 (시드 없이 칸 번호로)
      const k = 0.85 + ((c * 37) % 11) / 40;
      m.compose(new THREE.Vector3(p[0], 0.25 * k, p[2]), new THREE.Quaternion(), new THREE.Vector3(k, k, k));
      trunkRef.current?.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(p[0], (0.5 + TREE_H / 2) * k, p[2]), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), c), new THREE.Vector3(k, k, k));
      crownRef.current?.setMatrixAt(i, m);
      crownRef.current?.setColorAt(i, col.set(anyLit.has(c) ? "#1f5a33" : "#10261b"));
    });
    for (const r of [trunkRef, crownRef]) {
      if (!r.current) continue;
      r.current.count = trees.length;
      r.current.instanceMatrix.needsUpdate = true;
      if (r.current.instanceColor) r.current.instanceColor.needsUpdate = true;
    }
  }, [floors, trees, at, view, myLit, anyLit, showChecked]);
  const max = view.w * view.h;
  const tap = (list: number[]) => (e: ThreeEvent<PointerEvent>) => {
    if (e.instanceId === undefined) return;
    e.stopPropagation();
    const c = list[e.instanceId];
    if (c !== undefined) onCellTap(c);
  };
  return (
    <>
      <instancedMesh ref={floorRef} args={[undefined, undefined, max]} onPointerDown={tap(floors)}>
        <boxGeometry args={[0.98, 0.06, 0.98]} />
        <meshStandardMaterial roughness={0.95} />
      </instancedMesh>
      <instancedMesh ref={trunkRef} args={[undefined, undefined, max]}>
        <cylinderGeometry args={[0.07, 0.1, 0.5, 6]} />
        <meshStandardMaterial color="#3b2a1d" roughness={1} />
      </instancedMesh>
      <instancedMesh ref={crownRef} args={[undefined, undefined, max]} onPointerDown={tap(trees)}>
        <coneGeometry args={[0.46, TREE_H, 7]} />
        <meshStandardMaterial roughness={0.9} />
      </instancedMesh>
    </>
  );
}

function Lantern({ seat, at, mine, name, word, wordKey, stunned, flaring, k }: { seat: number; at: [number, number, number]; mine: boolean; name: string; word: string | null; wordKey: string; stunned: boolean; flaring: boolean; k: number }) {
  const ref = useRef<THREE.Group>(null);
  const flame = useRef<THREE.MeshStandardMaterial>(null);
  const light = useRef<THREE.PointLight>(null);
  const l = lantern(seat);
  useFrame(({ clock }, dt) => {
    const g = ref.current;
    if (!g) return;
    g.position.x = damp(g.position.x, at[0], k, dt);
    g.position.z = damp(g.position.z, at[2], k, dt);
    const flick = 0.9 + Math.sin(clock.elapsedTime * 11 + seat) * 0.06 + Math.sin(clock.elapsedTime * 23 + seat * 2) * 0.04;
    if (flame.current) flame.current.emissiveIntensity = (flaring ? 3.2 : 2.2) * flick;
    if (light.current) light.current.intensity = (mine ? 5.5 : 4) * (flaring ? 1.6 : 1) * flick;
    g.rotation.z = stunned ? Math.sin(clock.elapsedTime * 6) * 0.15 : 0;
  });
  return (
    <group ref={ref} position={[at[0], 0, at[2]]}>
      <pointLight ref={light} color={l.hex} distance={flaring ? 9 : 5.5} decay={1.6} position={[0, 0.95, 0]} />
      {mine && (
        <mesh position={[0, 0.03, 0]} rotation-x={-Math.PI / 2}>
          <ringGeometry args={[0.3, 0.42, 28]} />
          <meshBasicMaterial color="#fde047" />
        </mesh>
      )}
      {/* 망토 두른 탐험가 */}
      <mesh position={[0, 0.3, 0]}>
        <coneGeometry args={[0.22, 0.6, 10]} />
        <meshStandardMaterial color={l.hex} roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.66, 0]}>
        <sphereGeometry args={[0.13, 14, 12]} />
        <meshStandardMaterial color="#f1d4b3" />
      </mesh>
      <mesh position={[0, 0.72, -0.03]}>
        <sphereGeometry args={[0.15, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={l.hex} roughness={0.8} />
      </mesh>
      {/* 등불 */}
      <mesh position={[0.22, 0.62, 0.08]}>
        <cylinderGeometry args={[0.005, 0.005, 0.18, 4]} />
        <meshStandardMaterial color="#cbd5e1" />
      </mesh>
      <mesh position={[0.22, 0.5, 0.08]}>
        <sphereGeometry args={[0.08, 12, 10]} />
        <meshStandardMaterial ref={flame} color={l.glow} emissive={l.hex} emissiveIntensity={2.2} />
      </mesh>
      <ScreenSprite position={[0, 1.15, 0]} scale={mine ? [0.95, 0.24] : [0.8, 0.2]} map={labelTexture(`${l.glyph} ${mine ? "나" : name}${stunned ? " 💫" : ""}`, l.hex)} />
      {word && <SpeechBubble text={word} style={{ bg: "#0f172a", fg: "#f8fafc", border: l.hex, who: `${l.glyph} ${name}`, whoColor: l.hex }} y={1.75} popKey={wordKey} width={0.9} />}
    </group>
  );
}

function Bridge({ p, color, vertical }: { p: [number, number, number]; color: number; vertical: boolean }) {
  const l = lantern(color);
  return (
    <group position={p} rotation-y={vertical ? 0 : Math.PI / 2}>
      {[-0.3, -0.1, 0.1, 0.3].map((z) => (
        <mesh key={z} position={[0, 0.02, z]}>
          <boxGeometry args={[0.8, 0.05, 0.16]} />
          <meshStandardMaterial color="#8b5e34" emissive={l.hex} emissiveIntensity={0.35} />
        </mesh>
      ))}
      {[-0.42, 0.42].map((x) => (
        <mesh key={x} position={[x, 0.08, 0]}>
          <boxGeometry args={[0.04, 0.04, 1]} />
          <meshStandardMaterial color={l.hex} emissive={l.hex} emissiveIntensity={0.6} />
        </mesh>
      ))}
      <ScreenSprite position={[0, 0.5, 0]} scale={[0.6, 0.15]} map={labelTexture(`${l.glyph} 다리`, l.hex)} />
    </group>
  );
}

function Trap({ p, color, state }: { p: [number, number, number]; color: number; state: "armed" | "sprung" | "disarmed" }) {
  const l = lantern(color);
  const ref = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (ref.current && state === "armed") ref.current.emissiveIntensity = 0.6 + Math.sin(clock.elapsedTime * 4) * 0.3;
  });
  const dead = state !== "armed";
  return (
    <group position={p}>
      <mesh position={[0, 0.04, 0]} rotation-x={-Math.PI / 2}>
        <torusGeometry args={[0.28, 0.04, 6, 18]} />
        <meshStandardMaterial ref={ref} color={dead ? "#475569" : l.hex} emissive={dead ? "#000000" : l.hex} emissiveIntensity={0.6} metalness={0.6} />
      </mesh>
      {!dead &&
        Array.from({ length: 6 }, (_, i) => {
          const a = (i / 6) * Math.PI * 2;
          return (
            <mesh key={i} position={[Math.cos(a) * 0.2, 0.1, Math.sin(a) * 0.2]}>
              <coneGeometry args={[0.04, 0.14, 5]} />
              <meshStandardMaterial color="#cbd5e1" metalness={0.8} roughness={0.3} />
            </mesh>
          );
        })}
      <ScreenSprite position={[0, 0.45, 0]} scale={[0.62, 0.155]} map={labelTexture(state === "armed" ? `${l.glyph} 함정` : state === "sprung" ? "💥 터진 함정" : "✓ 해제됨", dead ? "#94a3b8" : l.hex)} />
    </group>
  );
}

function Monster({ p, color, sated, k }: { p: [number, number, number]; color: number; sated: boolean; k: number }) {
  const ref = useRef<THREE.Group>(null);
  const l = lantern(color);
  useFrame(({ clock }, dt) => {
    const g = ref.current;
    if (!g) return;
    g.position.x = damp(g.position.x, p[0], k, dt);
    g.position.z = damp(g.position.z, p[2], k, dt);
    g.position.y = sated ? 0 : Math.abs(Math.sin(clock.elapsedTime * 3)) * 0.06;
    g.scale.y = 1 + Math.sin(clock.elapsedTime * 2.2) * 0.06;
  });
  return (
    <group ref={ref} position={[p[0], 0, p[2]]}>
      <mesh position={[0, 0.32, 0]}>
        <sphereGeometry args={[0.32, 16, 12]} />
        <meshStandardMaterial color="#0b0b14" emissive={l.hex} emissiveIntensity={0.25} roughness={0.6} />
      </mesh>
      {[-0.11, 0.11].map((x) => (
        <mesh key={x} position={[x, 0.42, 0.27]}>
          <sphereGeometry args={[0.055, 8, 6]} />
          <meshBasicMaterial color={sated ? "#334155" : l.glow} />
        </mesh>
      ))}
      <ScreenSprite position={[0, 0.95, 0]} scale={[0.7, 0.175]} map={labelTexture(`${l.glyph} 괴물${sated ? " 💤" : ""}`, l.hex)} />
    </group>
  );
}

function Shard({ p }: { p: [number, number, number] }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    ref.current.rotation.y = clock.elapsedTime * 1.4;
    ref.current.position.y = 0.45 + Math.sin(clock.elapsedTime * 2.2) * 0.06;
  });
  return (
    <group position={p}>
      <mesh ref={ref}>
        <octahedronGeometry args={[0.18, 0]} />
        <meshStandardMaterial color="#e0f2fe" emissive="#7dd3fc" emissiveIntensity={1.4} />
      </mesh>
      <pointLight color="#7dd3fc" intensity={1.2} distance={2} position={[0, 0.5, 0]} />
    </group>
  );
}

function Jar({ p }: { p: [number, number, number] }) {
  const ref = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.emissiveIntensity = 0.8 + Math.sin(clock.elapsedTime * 7) * 0.4;
  });
  return (
    <group position={p}>
      <mesh position={[0, 0.2, 0]}>
        <cylinderGeometry args={[0.12, 0.14, 0.3, 12]} />
        <meshStandardMaterial ref={ref} color="#fef9c3" emissive="#facc15" transparent opacity={0.8} />
      </mesh>
      <mesh position={[0, 0.38, 0]}>
        <cylinderGeometry args={[0.08, 0.08, 0.05, 10]} />
        <meshStandardMaterial color="#78350f" />
      </mesh>
    </group>
  );
}

function Altar({ p, open }: { p: [number, number, number]; open: boolean }) {
  const ref = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.emissiveIntensity = open ? 1.2 + Math.sin(clock.elapsedTime * 2) * 0.4 : 0.15;
  });
  return (
    <group position={p}>
      <mesh position={[0, 0.03, 0]}>
        <cylinderGeometry args={[0.46, 0.5, 0.08, 20]} />
        <meshStandardMaterial color="#64748b" roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.4, 0]}>
        <cylinderGeometry args={[0.1, 0.14, 0.7, 8]} />
        <meshStandardMaterial ref={ref} color="#fde68a" emissive="#f59e0b" />
      </mesh>
      {open && <pointLight color="#fbbf24" intensity={3} distance={4} position={[0, 0.9, 0]} />}
      <ScreenSprite position={[0, 1.05, 0]} scale={[0.8, 0.2]} map={labelTexture(open ? "🌅 제단 열림" : "🌅 새벽 제단", "#fbbf24")} />
    </group>
  );
}

function Ping({ p, seat, mark }: { p: [number, number, number]; seat: number; mark: string }) {
  const l = lantern(seat);
  const m = pingMark(mark as never);
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current) (ref.current.material as THREE.MeshBasicMaterial).opacity = 0.35 + Math.sin(clock.elapsedTime * 3) * 0.15;
  });
  return (
    <group position={p}>
      <mesh ref={ref} position={[0, 0.8, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 1.6, 6]} />
        <meshBasicMaterial color={l.hex} transparent opacity={0.4} depthWrite={false} />
      </mesh>
      <ScreenSprite position={[0, 1.7, 0]} scale={[0.75, 0.19]} map={labelTexture(`${m.icon} ${m.label} ${l.glyph}`, l.hex)} renderOrder={5} />
    </group>
  );
}

function PathDots({ cells, at, color, mine }: { cells: number[]; at: (c: number) => [number, number, number]; color: string; mine: boolean }) {
  return (
    <>
      {cells.map((c, i) => {
        const p = at(c);
        return (
          <mesh key={`${c}-${i}`} position={[p[0], 0.06 + i * 0.01, p[2]]} rotation-x={-Math.PI / 2}>
            {i === cells.length - 1 ? <ringGeometry args={[0.16, mine ? 0.3 : 0.24, 20]} /> : <circleGeometry args={[mine ? 0.1 : 0.07, 12]} />}
            <meshBasicMaterial color={color} transparent opacity={mine ? 0.95 : 0.7} depthWrite={false} />
          </mesh>
        );
      })}
    </>
  );
}

function FxPop({ p, icon }: { p: [number, number, number]; icon: string }) {
  const ref = useRef<THREE.Group>(null);
  const born = useRef<number | null>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    born.current ??= clock.elapsedTime;
    const t = clock.elapsedTime - born.current;
    ref.current.position.y = 0.6 + t * 0.8;
    ref.current.visible = t < 1.6;
  });
  return (
    <group ref={ref} position={[p[0], 0.6, p[2]]}>
      <ScreenSprite position={[0, 0, 0]} scale={[0.9, 0.225]} map={labelTexture(icon, "#fde047")} renderOrder={6} />
    </group>
  );
}

export const CAMERA_TILT_DEG = 62;
/** 확대 모드에서 화면 가로에 들어오는 칸 수 */
const ZOOM_TILES = 8;

function CameraRig({ w, h, focus }: { w: number; h: number; focus: [number, number, number] | null }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const look = useRef(new THREE.Vector3(0, 0, 0.4));
  const want = useRef(new THREE.Vector3());
  const wantLook = useRef(new THREE.Vector3());
  const first = useRef(true);
  const fit = useMemo(() => {
    const aspect = size.width / Math.max(1, size.height);
    const vf = THREE.MathUtils.degToRad(40 / 2);
    const hf = Math.atan(Math.tan(vf) * aspect);
    const tilt = THREE.MathUtils.degToRad(CAMERA_TILT_DEG);
    const needW = (w / 2 + 0.3) / Math.tan(hf);
    const needH = ((h * Math.sin(tilt)) / 2 + 0.9) / Math.tan(vf);
    const full = Math.max(needW, needH);
    const zoom = Math.min(full, ZOOM_TILES / 2 / Math.tan(hf));
    return { vf, hf, tilt, full, zoom };
  }, [size, w, h]);
  const fx = focus?.[0];
  const fz = focus?.[2];
  useFrame((_, dt) => {
    const { vf, hf, tilt, full, zoom } = fit;
    const zoomed = fx !== undefined && fz !== undefined;
    const d = zoomed ? zoom : full;
    let tx = 0;
    let tz = 0.4;
    if (zoomed) {
      const halfW = d * Math.tan(hf);
      const halfD = (d * Math.tan(vf)) / Math.sin(tilt);
      const mx = Math.max(0, w / 2 - halfW + 0.4);
      const mz = Math.max(0, h / 2 - halfD + 0.6);
      tx = THREE.MathUtils.clamp(fx, -mx, mx);
      tz = THREE.MathUtils.clamp(fz, -mz, mz) + 0.4;
    }
    want.current.set(tx, d * Math.sin(tilt), tz + d * Math.cos(tilt));
    wantLook.current.set(tx, 0, tz);
    const k = first.current ? 1 : 1 - Math.exp(-5 * dt);
    first.current = false;
    camera.position.lerp(want.current, k);
    look.current.lerp(wantLook.current, k);
    camera.lookAt(look.current);
  });
  return null;
}

function Scene(props: ForestScene3DProps) {
  const { view, viewerSeat, displayPos, draft, names, fx, focus } = props;
  const { at } = useGrid(view);
  const shardsDone = view.shards.length > 0 && view.shards.filter((s) => s.taken).length >= view.need;
  const latestWord = (seat: number) => {
    const w = [...view.words].reverse().find((x) => x.seat === seat && x.round === view.round);
    return w ? { text: WORDS[w.word] ?? "", key: `${w.round}:${w.word}` } : null;
  };
  return (
    <>
      <color attach="background" args={["#03050a"]} />
      <fog attach="fog" args={["#03050a", 10, 26]} />
      <hemisphereLight args={["#5b6b9a", "#0b0d14", 0.32]} />
      <directionalLight position={[-4, 9, 3]} intensity={0.12} color="#a5b4fc" />
      <Ground view={view} myLit={props.myLit} anyLit={props.anyLit} showChecked={props.showChecked} onCellTap={props.onCellTap} />
      <Altar p={at(view.altar)} open={shardsDone} />
      {view.bridges.map((b) => {
        const vertical = view.tiles[b.cell - view.w] !== T_TREE && view.tiles[b.cell + view.w] !== T_TREE;
        return <Bridge key={`b${b.cell}`} p={at(b.cell)} color={b.color} vertical={vertical} />;
      })}
      {view.traps.map((t) => (
        <Trap key={`t${t.cell}`} p={at(t.cell)} color={t.color} state={t.state} />
      ))}
      {view.monsters.map((m) => {
        if (m.gone) return null;
        const route = m.path.length > 1 ? <PathDots key={`mp${m.id}`} cells={m.path} at={at} color={lantern(m.color).hex} mine={false} /> : null;
        const cell = monsterCell(m);
        return (
          <group key={`m${m.id}`}>
            {route}
            {cell >= 0 && <Monster p={at(cell)} color={m.color} sated={m.sated > 0} k={6} />}
          </group>
        );
      })}
      {view.shards.filter((s) => !s.taken).map((s) => (
        <Shard key={`s${s.cell}`} p={at(s.cell)} />
      ))}
      {view.jars.filter((j) => !j.taken).map((j) => (
        <Jar key={`j${j.cell}`} p={at(j.cell)} />
      ))}
      {view.pings.map((p) => (
        <Ping key={`p${p.id}`} p={at(p.cell)} seat={p.seat} mark={p.mark} />
      ))}
      {view.plans.map((plan, seat) => {
        if (seat === viewerSeat || view.phase !== "plan") return null;
        const cells: number[] = [];
        let c = view.players[seat].pos;
        for (const d of plan.steps) {
          const n = d === "N" ? c - view.w : d === "S" ? c + view.w : d === "E" ? c + 1 : c - 1;
          if (view.tiles[n] === T_TREE || view.tiles[n] === undefined) break;
          cells.push(n);
          c = n;
        }
        return <PathDots key={`plan${seat}`} cells={cells} at={at} color={lantern(seat).hex} mine={false} />;
      })}
      {view.phase === "plan" && <PathDots cells={draft} at={at} color="#fde047" mine />}
      {view.players.map((p, seat) => {
        const word = latestWord(seat);
        return (
          <Lantern
            key={`l${seat}`}
            seat={seat}
            at={at(displayPos[seat] ?? p.pos)}
            mine={seat === viewerSeat}
            name={names[seat] ?? `${seat + 1}번`}
            word={word?.text ?? null}
            wordKey={word?.key ?? ""}
            stunned={p.stunned > 0}
            flaring={p.flaring}
            k={10}
          />
        );
      })}
      {fx.map((f) => (
        <FxPop key={f.key} p={at(f.cell)} icon={f.icon} />
      ))}
      <CameraRig w={view.w} h={view.h} focus={focus !== null ? at(focus) : null} />
      <AdaptiveResolution max={props.lowDetail ? 1.5 : 2} />
    </>
  );
}

export default function ForestScene3D(props: ForestScene3DProps) {
  return (
    <Canvas
      dpr={props.lowDetail ? [1, 1.5] : [1, 2]}
      gl={{ antialias: !props.lowDetail, powerPreference: "high-performance" }}
      camera={{ fov: 40, position: [0, 14, 10], near: 0.1, far: 120 }}
      style={{ touchAction: "pan-y" }}
    >
      <Scene {...props} />
    </Canvas>
  );
}
