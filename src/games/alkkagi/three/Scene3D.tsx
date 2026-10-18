"use client";

import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { setupStones, toSim, type AlkkagiState, type Seat } from "../engine";
import { EDGE, firstContact, slideDistance, speedForPower } from "../physics";
import { FLOOR_DROP, stoneHalfHeight, type ReplayEvent, type ReplayPlayer } from "../replay";
import { floorTexture, gobanSideTexture, gobanTopTexture, goldMaterial, stoneMaterial } from "./materials";

/**
 * 알까기 대전 3D 무대 (rulebook §13). Display + input only — the replay
 * player (replay.ts) says where every stone is each frame.
 *
 * Board coords (x, y) map to three.js (x, −y) on the board top (y = 0).
 * Aiming (§4): press one of your stones and pull back like a slingshot;
 * the arrow points where it will go, release to flick.
 *
 * Lint rules this file follows (React Compiler, see bluffRoulette/Scene3D):
 * no ref reads during render, camera only touched inside useFrame.
 */

/** Drag distance (board units) that means full power. */
export const AIM_FULL = 4.6;
const BOARD_T = 1.5;
const LEG_H = FLOOR_DROP - BOARD_T;

export interface LiveAim {
  turn: number;
  stoneId: number;
  /** Unit direction of the shot (board coords). */
  dx: number;
  dy: number;
  power: number;
  /** performance.now() of the last update. */
  at: number;
  remote?: boolean;
}

export interface SceneProps {
  state: AlkkagiState;
  player: ReplayPlayer;
  /** Side the camera starts behind (engine `sideOf`). */
  side: number;
  /** The viewer may aim right now (their turn and the replay is idle). */
  canAim: boolean;
  viewerSeat: Seat;
  aim: MutableRefObject<LiveAim | null>;
  onAim: (aim: LiveAim | null) => void;
  onShoot: (stoneId: number, dx: number, dy: number, power: number) => void;
  onEvent: (e: ReplayEvent) => void;
  onBusy: (busy: boolean) => void;
  topView: boolean;
  quality: "high" | "low";
  onFps?: (fps: number) => void;
}

const nowMs = () => performance.now();
const stoneGeo = new THREE.SphereGeometry(1, 40, 18);
const ringGeo = new THREE.TorusGeometry(1, 0.06, 8, 40);
const dotGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.06, 20);
const coneGeo = new THREE.ConeGeometry(0.16, 0.34, 10);
const sparkGeo = new THREE.SphereGeometry(1, 8, 6);
const SIDE_AZ = [Math.PI / 2, Math.PI, -Math.PI / 2, 0];

/** Shared between the scene (writer) and the camera rig (reader). */
const dragLock = { v: false };
const camShake = { v: 0 };
function setDragLock(v: boolean) {
  dragLock.v = v;
}

function aimColor(p: number): THREE.Color {
  const c = new THREE.Color();
  if (p < 0.5) c.setRGB(0.3 + p * 1.3, 0.85, 0.35);
  else c.setRGB(0.95, 0.85 - (p - 0.5) * 1.4, 0.25);
  return c;
}

interface Spark {
  mesh: THREE.Mesh;
  born: number;
  vx: number;
  vy: number;
  vz: number;
  x: number;
  y: number;
  z: number;
}

function Stones(props: SceneProps) {
  const { state, player, canAim, viewerSeat } = props;
  const gl = useThree((s) => s.gl);
  // every stone of the round, so meshes never remount mid-replay
  const roster = useMemo(() => setupStones(state.playerCount, state.options), [state.playerCount, state.options]);
  const meshes = useRef(new Map<number, THREE.Group>());
  const rings = useRef(new Map<number, THREE.Mesh>());
  const arrow = useRef<THREE.Group>(null);
  const shaft = useRef<THREE.Mesh>(null);
  const head = useRef<THREE.Mesh>(null);
  const finger = useRef<THREE.Group>(null);
  const ghost = useRef<THREE.Mesh>(null);
  const sparkRoot = useRef<THREE.Group>(null);
  const sparks = useRef<Spark[]>([]);
  const busyRef = useRef<boolean | null>(null);
  const hover = useRef<number | null>(null);
  const positions = useRef(new Map<number, { x: number; y: number }>());
  const guideRoot = useRef<THREE.Group>(null);
  const guideRef = useRef<THREE.Line | null>(null);
  useEffect(() => {
    const root = guideRoot.current;
    if (!root) return;
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, 1)]);
    const mat = new THREE.LineDashedMaterial({ color: "#fff6d8", dashSize: 0.28, gapSize: 0.2, transparent: true, opacity: 0.8 });
    const line = new THREE.Line(geo, mat);
    line.visible = false;
    root.add(line);
    guideRef.current = line;
    return () => {
      root.remove(line);
      geo.dispose();
      mat.dispose();
      guideRef.current = null;
    };
  }, []);

  const spawnSparks = (x: number, y: number, k: number) => {
    const root = sparkRoot.current;
    if (!root || props.quality === "low") return;
    const n = 3 + Math.round(k * 6);
    for (let i = 0; i < n; i++) {
      const mesh = new THREE.Mesh(sparkGeo, sparkMat);
      const ang = Math.random() * Math.PI * 2;
      const sp = 1.5 + Math.random() * 3 * (0.5 + k);
      const s: Spark = { mesh, born: nowMs(), vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, vz: 1 + Math.random() * 2.5, x, y, z: 0.2 };
      root.add(mesh);
      sparks.current.push(s);
    }
  };

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const t = nowMs();
    const view = player.sample(state, t, (e) => {
      if (e.kind === "clack") {
        spawnSparks(e.x, e.y, Math.min(1, e.impulse / 9));
        camShake.v = Math.min(0.5, camShake.v + Math.min(1, e.impulse / 9) * 0.18);
      }
      if (e.kind === "floor") camShake.v = Math.min(0.5, camShake.v + 0.06 * e.strength);
      props.onEvent(e);
    });
    if (busyRef.current !== view.busy) {
      busyRef.current = view.busy;
      props.onBusy(view.busy);
    }

    // ---- stones on the board
    const seen = new Set<number>();
    positions.current.clear();
    for (const s of view.stones) {
      const g = meshes.current.get(s.id);
      if (!g) continue;
      seen.add(s.id);
      positions.current.set(s.id, { x: s.x, y: s.y });
      const hh = stoneHalfHeight(s.king);
      const lift = s.fade > 0 ? s.fade * 1.4 : 0;
      g.visible = true;
      g.position.set(s.x, hh + lift, -s.y);
      g.rotation.set(0, g.rotation.y, 0);
      const k = s.fade > 0 ? 1 - s.fade : 1;
      g.scale.setScalar(Math.max(0.001, k));
    }
    // ---- stones tumbling off / lying on the floor
    for (const f of view.fallen) {
      const g = meshes.current.get(f.id);
      if (!g) continue;
      seen.add(f.id);
      const hh = stoneHalfHeight(f.king);
      g.visible = true;
      g.scale.setScalar(1);
      g.position.set(f.x, hh + f.z, -f.y);
      // tip over the edge about the axis perpendicular to the travel direction
      const ax = new THREE.Vector3(-f.dirY, 0, -f.dirX).normalize();
      g.quaternion.setFromAxisAngle(ax, f.tilt);
    }
    for (const [id, g] of meshes.current) if (!seen.has(id)) g.visible = false;

    // ---- my stones glow and get a ring when I may aim
    const pulse = 0.55 + Math.sin(t / 220) * 0.25;
    for (const [id, ring] of rings.current) {
      const p = positions.current.get(id);
      const show = canAim && !!p;
      ring.visible = show;
      if (show && p) {
        const st = roster.find((s) => s.id === id)!;
        const r = (st.king ? 0.62 : 0.46) * (hover.current === id ? 1.45 : 1.25);
        ring.position.set(p.x, 0.02, -p.y);
        ring.scale.set(r, r, r * 1.6);
        (ring.material as THREE.MeshBasicMaterial).opacity = pulse;
      }
    }

    // ---- aim arrow (mine or someone else's), guide line, finger
    const a = props.aim.current;
    const shot = view.shot;
    const aimLive = !!a && a.turn === state.turn && t - a.at < 1800 && !view.busy && positions.current.has(a.stoneId) && a.power > 0.01;
    const arr = arrow.current;
    const fg = finger.current;
    if (arr && shaft.current && head.current) {
      arr.visible = aimLive;
      if (aimLive && a) {
        const p = positions.current.get(a.stoneId)!;
        const st = roster.find((s) => s.id === a.stoneId)!;
        const r = st.king ? 0.62 : 0.46;
        const len = 0.6 + a.power * 3.4;
        arr.position.set(p.x + a.dx * r, 0.06, -(p.y + a.dy * r));
        arr.rotation.set(0, Math.atan2(a.dx, -a.dy), 0);
        shaft.current.scale.set(1, 1, len);
        shaft.current.position.set(0, 0, len / 2);
        head.current.position.set(0, 0, len + 0.16);
        const col = aimColor(a.power);
        (shaft.current.material as THREE.MeshBasicMaterial).color.copy(col);
        (head.current.material as THREE.MeshBasicMaterial).color.copy(col);
      }
    }
    // dashed guide to the first stone in the way (§4 — no bounce prediction)
    const guide = guideRef.current;
    if (aimLive && a && guide) {
      const sims = toSim(view.stones.map((s) => ({ id: s.id, owner: s.owner, x: s.x, y: s.y, king: s.king })));
      const me = sims.find((s) => s.id === a.stoneId)!;
      const hit = firstContact(sims, a.stoneId, a.dx, a.dy);
      const reach = Math.min(slideDistance(speedForPower(a.power)), 30);
      let len = hit ? Math.min(hit.t, reach) : reach;
      // stop the line at the board edge
      for (const [c, d] of [
        [me.x, a.dx],
        [me.y, a.dy],
      ] as const) {
        if (d > 1e-6) len = Math.min(len, (EDGE - c) / d);
        if (d < -1e-6) len = Math.min(len, (-EDGE - c) / d);
      }
      len = Math.max(0, len);
      const pos = guide.geometry.attributes.position as THREE.BufferAttribute;
      pos.setXYZ(0, me.x, 0.05, -me.y);
      pos.setXYZ(1, me.x + a.dx * len, 0.05, -(me.y + a.dy * len));
      pos.needsUpdate = true;
      guide.computeLineDistances();
      guide.visible = true;
      const gh = ghost.current;
      if (gh) {
        gh.visible = !!hit && hit.t <= reach;
        if (hit) {
          gh.position.set(hit.cx, 0.04, -hit.cy);
          gh.scale.setScalar(me.r);
        }
      }
    } else {
      if (guide) guide.visible = false;
      if (ghost.current) ghost.current.visible = false;
    }
    if (fg) {
      // finger: pulled back while aiming, then the snap during a replay's wind-up
      let show = false;
      if (shot && shot.rolling < 0.2) {
        const r = roster.find((s) => s.id === shot.stoneId)?.king ? 0.62 : 0.46;
        const w = shot.windup;
        const back = w < 0.75 ? 0.25 + (w / 0.75) * 0.75 : 1 - ((w - 0.75) / 0.25) * 1;
        const d = r + 0.12 + Math.max(0, back) * 0.9;
        fg.position.set(shot.x - shot.dirX * d, 0.18, -(shot.y - shot.dirY * d));
        fg.rotation.set(0, Math.atan2(shot.dirX, -shot.dirY), 0);
        show = shot.rolling < 0.12;
      } else if (aimLive && a) {
        const p = positions.current.get(a.stoneId)!;
        const r = roster.find((s) => s.id === a.stoneId)?.king ? 0.62 : 0.46;
        const d = r + 0.12 + a.power * 0.9;
        fg.position.set(p.x - a.dx * d, 0.18, -(p.y - a.dy * d));
        fg.rotation.set(0, Math.atan2(a.dx, -a.dy), 0);
        show = true;
      }
      fg.visible = show;
    }

    // ---- sparks
    const root = sparkRoot.current;
    if (root) {
      sparks.current = sparks.current.filter((s) => {
        const age = (t - s.born) / 1000;
        if (age > 0.32) {
          root.remove(s.mesh);
          return false;
        }
        s.vz -= 9 * dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.z = Math.max(0.02, s.z + s.vz * dt);
        s.mesh.position.set(s.x, s.z, -s.y);
        s.mesh.scale.setScalar(0.05 * (1 - age / 0.32));
        return true;
      });
    }
    camShake.v = Math.max(0, camShake.v - dt * 1.6);
  });

  /** §4 — press my stone, pull back, release. */
  const startAim = (e: ThreeEvent<PointerEvent>, id: number) => {
    const st = state.stones.find((s) => s.id === id);
    if (!canAim || !st || st.owner !== viewerSeat) return;
    e.stopPropagation();
    setDragLock(true);
    const cam = e.camera;
    const el = gl.domElement;
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.1);
    const ray = new THREE.Raycaster();
    const hitPoint = new THREE.Vector3();
    const toBoard = (cx: number, cy: number): { x: number; y: number } | null => {
      const r = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, cam);
      return ray.ray.intersectPlane(plane, hitPoint) ? { x: hitPoint.x, y: -hitPoint.z } : null;
    };
    const turn = state.turn;
    let last: LiveAim | null = null;
    const update = (cx: number, cy: number) => {
      const p = toBoard(cx, cy);
      if (!p) return;
      const px = st.x - p.x;
      const py = st.y - p.y;
      const d = Math.hypot(px, py);
      if (d < 0.05) return;
      last = { turn, stoneId: id, dx: px / d, dy: py / d, power: Math.min(1, d / AIM_FULL), at: nowMs() };
      props.onAim(last);
    };
    const move = (ev: PointerEvent) => update(ev.clientX, ev.clientY);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      setDragLock(false);
      const l = last as LiveAim | null;
      if (l && l.power >= 0.05) props.onShoot(id, l.dx, l.dy, l.power);
      else props.onAim(null);
    };
    const cancel = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      setDragLock(false);
      props.onAim(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  };

  return (
    <group>
      {roster.map((s) => {
        const r = s.king ? 0.62 : 0.46;
        const hh = stoneHalfHeight(s.king);
        return (
          <group
            key={s.id}
            ref={(g) => {
              if (g) meshes.current.set(s.id, g);
              else meshes.current.delete(s.id);
            }}
            visible={false}
          >
            <mesh
              geometry={stoneGeo}
              material={stoneMaterial(s.owner)}
              scale={[r, hh, r]}
              castShadow
              receiveShadow
              onPointerDown={(e) => startAim(e, s.id)}
              onPointerOver={() => {
                if (s.owner === viewerSeat) hover.current = s.id;
              }}
              onPointerOut={() => {
                if (hover.current === s.id) hover.current = null;
              }}
            />
            {/* §1 colour-blind marks: 홍 = gold ring, 청 = gold dot */}
            {s.owner === 2 && <mesh geometry={ringGeo} material={goldMaterial} position={[0, hh * 0.92, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[r * 0.5, r * 0.5, 0.6]} />}
            {s.owner === 3 && <mesh geometry={dotGeo} material={goldMaterial} position={[0, hh * 0.95, 0]} scale={[r * 1.2, 1, r * 1.2]} />}
            {s.king && (
              <group position={[0, hh * 0.9, 0]}>
                <mesh geometry={ringGeo} material={goldMaterial} rotation={[Math.PI / 2, 0, 0]} scale={[0.34, 0.34, 1.4]} />
                {[0, 1, 2, 3, 4].map((k) => (
                  <mesh key={k} geometry={coneGeo} material={goldMaterial} position={[Math.cos((k / 5) * Math.PI * 2) * 0.34, 0.16, Math.sin((k / 5) * Math.PI * 2) * 0.34]} />
                ))}
              </group>
            )}
          </group>
        );
      })}
      {roster
        .filter((s) => s.owner === viewerSeat)
        .map((s) => (
          <mesh
            key={`ring-${s.id}`}
            ref={(m) => {
              if (m) rings.current.set(s.id, m);
              else rings.current.delete(s.id);
            }}
            geometry={ringGeo}
            rotation={[Math.PI / 2, 0, 0]}
            visible={false}
          >
            <meshBasicMaterial color="#ffd36b" transparent opacity={0.6} depthWrite={false} />
          </mesh>
        ))}
      <group ref={arrow} visible={false}>
        <mesh ref={shaft}>
          <boxGeometry args={[0.14, 0.04, 1]} />
          <meshBasicMaterial color="#7be38f" transparent opacity={0.92} />
        </mesh>
        <mesh ref={head} rotation={[Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.28, 0.42, 3]} />
          <meshBasicMaterial color="#7be38f" transparent opacity={0.92} />
        </mesh>
      </group>
      <group ref={guideRoot} />
      <mesh ref={ghost} rotation={[Math.PI / 2, 0, 0]} visible={false} geometry={ringGeo}>
        <meshBasicMaterial color="#fff6d8" transparent opacity={0.7} depthWrite={false} />
      </mesh>
      <group ref={finger} visible={false}>
        {/* index finger lying on the board, nail toward the stone */}
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -0.55]}>
          <capsuleGeometry args={[0.16, 0.9, 6, 12]} />
          <meshStandardMaterial color="#efbd96" roughness={0.6} />
        </mesh>
        <mesh position={[0, 0.06, -0.08]} scale={[0.12, 0.04, 0.12]}>
          <sphereGeometry args={[1, 12, 8]} />
          <meshStandardMaterial color="#f8dccb" roughness={0.3} />
        </mesh>
      </group>
      <group ref={sparkRoot} />
    </group>
  );
}

const sparkMat = new THREE.MeshBasicMaterial({ color: "#fff2c4", transparent: true, opacity: 0.95 });

function Goban({ quality }: { quality: "high" | "low" }) {
  const top = useMemo(() => gobanTopTexture(), []);
  const side = useMemo(() => gobanSideTexture(), []);
  const floor = useMemo(() => floorTexture(), []);
  const sideMat = useMemo(() => new THREE.MeshStandardMaterial({ map: side, roughness: 0.6 }), [side]);
  const topMat = useMemo(() => new THREE.MeshStandardMaterial({ map: top, roughness: 0.45, metalness: 0.02 }), [top]);
  const mats = useMemo(() => [sideMat, sideMat, topMat, sideMat, sideMat, sideMat], [sideMat, topMat]);
  const w = EDGE * 2;
  const seg = quality === "high" ? 24 : 12;
  return (
    <group>
      <mesh position={[0, -BOARD_T / 2, 0]} material={mats} castShadow receiveShadow>
        <boxGeometry args={[w, BOARD_T, w]} />
      </mesh>
      {[
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ].map(([sx, sz]) => (
        <mesh key={`${sx}${sz}`} position={[sx * (EDGE - 2.2), -BOARD_T - LEG_H / 2, sz * (EDGE - 2.2)]} castShadow>
          <cylinderGeometry args={[1.05, 0.7, LEG_H, seg]} />
          <meshStandardMaterial color="#8a5626" roughness={0.6} />
        </mesh>
      ))}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -FLOOR_DROP, 0]} receiveShadow>
        <planeGeometry args={[90, 90]} />
        <meshStandardMaterial map={floor} roughness={0.5} metalness={0.05} />
      </mesh>
    </group>
  );
}

/** Orbit camera: drag to circle the board, wheel / pinch to zoom; eases to top-down on request. */
function CameraRig({ side, topView }: { side: number; topView: boolean }) {
  const gl = useThree((s) => s.gl);
  const orbit = useRef({ az: SIDE_AZ[side] ?? Math.PI / 2, el: 0.95, zoom: 1, userEl: 0.95 });
  const lastSide = useRef(side);
  useEffect(() => {
    const el = gl.domElement;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch: number | null = null;
    const down = (e: PointerEvent) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
    };
    const move = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY };
      pointers.set(e.pointerId, cur);
      if (dragLock.v) return;
      const o = orbit.current;
      if (pointers.size >= 2 && pinch) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        o.zoom = Math.max(0.5, Math.min(1.5, o.zoom * (pinch / Math.max(1, d))));
        pinch = d;
        return;
      }
      const w = el.clientWidth || 1;
      o.az -= ((cur.x - prev.x) / w) * 3.6;
      o.userEl = Math.max(0.35, Math.min(1.52, o.userEl + ((cur.y - prev.y) / w) * 2.2));
    };
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const o = orbit.current;
      o.zoom = Math.max(0.5, Math.min(1.5, o.zoom * (1 + Math.sign(e.deltaY) * 0.08)));
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("wheel", wheel, { passive: false });
    for (const ev of ["pointerup", "pointerleave", "pointercancel"] as const) el.addEventListener(ev, up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("wheel", wheel);
      for (const ev of ["pointerup", "pointerleave", "pointercancel"] as const) el.removeEventListener(ev, up);
    };
  }, [gl]);
  useFrame((frame) => {
    const cam = frame.camera as THREE.PerspectiveCamera;
    const o = orbit.current;
    if (lastSide.current !== side) {
      lastSide.current = side;
      o.az = SIDE_AZ[side] ?? o.az;
    }
    const wantEl = topView ? 1.5 : o.userEl;
    o.el += (wantEl - o.el) * 0.08;
    const portrait = frame.size.width / frame.size.height < 0.9;
    const dist = (portrait ? 36 : 25) * o.zoom * (topView ? 1.02 : 1);
    const s = camShake.v;
    const jx = s > 0.01 ? (Math.random() - 0.5) * s * 0.25 : 0;
    const jy = s > 0.01 ? (Math.random() - 0.5) * s * 0.25 : 0;
    // look a bit toward my side when tilted so the near half isn't cut off
    cam.position.set(Math.cos(o.az) * Math.cos(o.el) * dist + jx, Math.sin(o.el) * dist + jy, Math.sin(o.az) * Math.cos(o.el) * dist);
    cam.lookAt(0, -0.6, 0);
    const fov = portrait ? 46 : 40;
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  });
  return null;
}

function FpsProbe({ onFps }: { onFps?: (fps: number) => void }) {
  const acc = useRef({ frames: 0, time: 0 });
  useFrame((_, dt) => {
    const a = acc.current;
    a.frames += 1;
    a.time += Math.min(dt, 0.5);
    if (a.time >= 2) {
      onFps?.(a.frames / a.time);
      a.frames = 0;
      a.time = 0;
    }
  });
  return null;
}

export default function Scene3D(props: SceneProps) {
  const high = props.quality === "high";
  return (
    <Canvas shadows={high} dpr={high ? [1, 1.75] : 1} gl={{ antialias: high, powerPreference: "high-performance" }} camera={{ fov: 40, position: [0, 20, 16], near: 0.1, far: 160 }} style={{ touchAction: "none" }}>
      <color attach="background" args={["#1a120b"]} />
      <fog attach="fog" args={["#1a120b", 40, 95]} />
      <hemisphereLight args={["#fff0d8", "#2a1a0e", 0.6]} />
      <ambientLight intensity={0.15} />
      <directionalLight
        position={[8, 22, 10]}
        intensity={2}
        color="#fff3e0"
        castShadow={high}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-16}
        shadow-camera-right={16}
        shadow-camera-top={16}
        shadow-camera-bottom={-16}
        shadow-camera-near={1}
        shadow-camera-far={60}
        shadow-bias={-0.0004}
      />
      <directionalLight position={[-10, 8, -8]} intensity={0.4} color="#a9c1ff" />
      <pointLight position={[0, 9, 0]} intensity={0.5} distance={30} color="#ffcf8a" />
      <Goban quality={props.quality} />
      <Stones {...props} />
      <CameraRig side={props.side} topView={props.topView} />
      <FpsProbe onFps={props.onFps} />
    </Canvas>
  );
}

