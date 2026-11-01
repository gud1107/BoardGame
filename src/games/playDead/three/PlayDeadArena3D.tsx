"use client";

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { resolveLook } from "@/games/shared/three/SeatedPerson";
import ScreenSprite from "@/games/shared/three/ScreenSprite";
import { AdaptiveResolution } from "@/games/shared/three/sceneFx";
import { labelTexture } from "@/games/shared/three/tableKit";
import Battlefield, { fieldPos } from "./Battlefield";
import { roomCharacterOf, useRoomCharacters } from "@/lib/character/roomCharacters";
import VrmFighter, { fallSide, type FighterPose } from "./VrmFighter";

/**
 * 죽은척 대작전 전장 — 포연 속 진흙 들판에 엎드린 VRM 병사들. 보드(2D UI)가 시각마다 각 자리의
 * 자세와 효과(`fx`)를 정해 넘기고, 이 장면은 그대로 그리기만 한다 — 숨은 정보(진짜 사망 여부,
 * 남의 실제 피해량)는 보드가 걸러서 넘기므로 장면으로 새지 않는다.
 *
 * 부드러움: 캔버스 하나, 그림자 맵 없음(발밑 원판 그림자), 저사양이면 불빛·섬광·외곽선·
 * 머리카락 흔들림 끔, 프레임 측정으로 해상도 자동 조절(AdaptiveResolution).
 */

export interface ArenaFighter {
  seat: number;
  name: string;
  pose: FighterPose;
  poseKey: string;
  /** walk up to this seat's body */
  moveToSeat: number | null;
  /** face this seat */
  aimSeat: number | null;
  out: boolean;
  ammo: number;
  status: string | null;
}

export type ArenaFx =
  | { key: string; kind: "orb"; from: number; to: number; tier: number; at: number; dur: number; stop: "hit" | "cover" | "clash" }
  | { key: string; kind: "text"; seat: number; text: string; color: string; at: number }
  | { key: string; kind: "burst"; seat: number; color: string; at: number; big?: boolean }
  | { key: string; kind: "midBurst"; a: number; b: number; at: number }
  | { key: string; kind: "ammoFlow"; from: number; to: number; at: number };

export interface PlayDeadArena3DProps {
  seatCount: number;
  viewerSeat: number;
  fighters: ArenaFighter[];
  fx: ArenaFx[];
  /** performance.now() (ms) the current fx timeline started */
  fxStart: number;
  pickable: number[];
  picked: number | null;
  onPick: (seat: number) => void;
  lowDetail: boolean;
}

export const SEAT_COLORS = ["#38bdf8", "#f472b6", "#a3e635", "#fb923c", "#c084fc", "#facc15"];

function seatPos(seat: number, viewer: number, n: number): THREE.Vector3 {
  return fieldPos(seat, viewer, n);
}

// ---------------------------------------------------------------------------
// 효과

const chestY = 1.15;
const tA = new THREE.Vector3();
const tB = new THREE.Vector3();

function useFxClock(fxStart: number) {
  return () => (performance.now() - fxStart) / 1000;
}

const TRACER_LEN = 0.45;
/** 사격(1발)·연사(3발)는 예광탄, 수류탄은 포물선. 엄폐면 몸 앞에서, 맞사격이면 가운데서 멈춘다 */
function Shot({ from, to, tier, at, dur, stop, fxStart }: { from: THREE.Vector3; to: THREE.Vector3; tier: number; at: number; dur: number; stop: "hit" | "cover" | "clash"; fxStart: number }) {
  const tracers = useRef<(THREE.Mesh | null)[]>([]);
  const nade = useRef<THREE.Mesh>(null);
  const clock = useFxClock(fxStart);
  const rounds = tier === 2 ? 3 : 1;
  useFrame(() => {
    const e0 = clock() - at;
    const endT = stop === "clash" ? 0.5 : stop === "cover" ? 0.82 : 1;
    tA.set(from.x, chestY, from.z);
    tB.set(to.x, chestY, to.z);
    if (tier >= 3) {
      // 수류탄: 높게 던져 떨어진다
      const g = nade.current;
      if (!g) return;
      const p = Math.min(endT, e0 / dur);
      g.visible = e0 >= 0 && p < endT;
      g.position.lerpVectors(tA, tB, p);
      g.position.y = chestY + Math.sin(p * Math.PI) * 1.8 - p * 0.6;
      g.rotation.set(e0 * 9, e0 * 7, 0);
      return;
    }
    tracers.current.forEach((m, k) => {
      if (!m) return;
      const e = e0 - k * 0.09;
      const p = Math.min(endT, e / (dur * 0.55));
      m.visible = e >= 0 && p < endT;
      m.position.lerpVectors(tA, tB, p);
      m.lookAt(tB);
    });
  });
  if (tier >= 3)
    return (
      <mesh ref={nade} visible={false}>
        <sphereGeometry args={[0.11, 10, 8]} />
        <meshStandardMaterial color="#3d4a2e" roughness={0.6} />
      </mesh>
    );
  return (
    <>
      {Array.from({ length: rounds }, (_, k) => (
        <mesh key={k} ref={(m) => void (tracers.current[k] = m)} visible={false}>
          <boxGeometry args={[0.035, 0.035, TRACER_LEN]} />
          <meshBasicMaterial color="#ffe08a" toneMapped={false} />
        </mesh>
      ))}
    </>
  );
}

/** 피격 섬광 / 수류탄 폭발 / 맞사격 불꽃 */
function Burst({ position, color, at, big, fxStart }: { position: THREE.Vector3; color: string; at: number; big?: boolean; fxStart: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  const clock = useFxClock(fxStart);
  useFrame(() => {
    const m = ref.current;
    if (!m || !mat.current) return;
    const e = clock() - at;
    m.visible = e >= 0 && e < 0.6;
    const p = Math.max(0, e) / 0.6;
    m.scale.setScalar((big ? 1.6 : 1) * (0.3 + p * 1.3));
    mat.current.opacity = 0.9 * (1 - p);
  });
  return (
    <mesh ref={ref} position={[position.x, chestY, position.z]} visible={false}>
      <sphereGeometry args={[0.5, 16, 12]} />
      <meshBasicMaterial ref={mat} color={color} transparent blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

/** 떠오르는 판정 글자 (−1~2, 엄폐로 피함!, 맞사격! …) */
function FloatText({ position, text, color, at, fxStart }: { position: THREE.Vector3; text: string; color: string; at: number; fxStart: number }) {
  const ref = useRef<THREE.Sprite>(null);
  const clock = useFxClock(fxStart);
  const map = useMemo(() => labelTexture(text, color, { bg: "rgba(15,10,25,0.85)", fg: color }), [text, color]);
  useFrame(() => {
    const s = ref.current;
    if (!s) return;
    const e = clock() - at;
    s.visible = e >= 0 && e < 1.8;
    s.position.set(position.x, 2.3 + Math.min(1, Math.max(0, e)) * 0.5, position.z);
    const k = e < 0.15 ? 0.6 + e * 3 : 1;
    s.scale.set(1.1 * k, 0.275 * k, 1);
    s.material.opacity = e > 1.4 ? Math.max(0, 1 - (e - 1.4) / 0.4) : 1;
  });
  return (
    <sprite ref={ref} visible={false} renderOrder={10}>
      <spriteMaterial map={map} transparent depthWrite={false} depthTest={false} />
    </sprite>
  );
}

/** 탄약 뺏기: 쓰러진 몸에서 챙긴 탄창이 약탈자에게 */
function AmmoFlow({ from, to, at, fxStart }: { from: THREE.Vector3; to: THREE.Vector3; at: number; fxStart: number }) {
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  const clock = useFxClock(fxStart);
  useFrame(() => {
    const e = clock() - at;
    refs.current.forEach((m, i) => {
      if (!m) return;
      const p = Math.min(1, Math.max(0, (e - i * 0.12) / 0.5));
      m.visible = e - i * 0.12 >= 0 && p < 1;
      m.position.set(from.x + (to.x - from.x) * p, 0.4 + Math.sin(p * Math.PI) * 1.2 + p * 0.8, from.z + (to.z - from.z) * p);
    });
  });
  return (
    <>
      {[0, 1].map((i) => (
        <mesh key={i} ref={(m) => void (refs.current[i] = m)} visible={false}>
          <boxGeometry args={[0.08, 0.16, 0.05]} />
          <meshStandardMaterial color="#c9a14a" metalness={0.7} roughness={0.35} />
        </mesh>
      ))}
    </>
  );
}

/** 머리 위 탄약 표시 = 지금 가진 탄약 (공개 정보) — 탄피 모양 작은 막대가 한 줄로 */
function AmmoPips({ ammo, lying }: { ammo: number; lying: boolean }) {
  return (
    <group position-y={lying ? 0.7 : 2.0}>
      {Array.from({ length: ammo }, (_, i) => (
        <mesh key={i} position={[(i - (ammo - 1) / 2) * 0.09, 0, 0]}>
          <cylinderGeometry args={[0.025, 0.025, 0.13, 8]} />
          <meshStandardMaterial color="#d4a63a" metalness={0.8} roughness={0.3} emissive="#5a3d00" />
        </mesh>
      ))}
    </group>
  );
}

function CameraRig({ n }: { n: number }) {
  const { camera, size } = useThree();
  useEffect(() => {
    // behind and above my own foxhole, looking across the field
    const aspect = size.width / Math.max(1, size.height);
    const k = Math.max(1, 1.45 / aspect) * (1 + Math.max(0, n - 4) * 0.08);
    camera.position.set(0, 3.6 * k, 6.6 * k);
    camera.lookAt(0, 0.3, -1.2);
    camera.updateProjectionMatrix();
  }, [camera, size, n]);
  return null;
}

// ---------------------------------------------------------------------------

function SceneContents(props: PlayDeadArena3DProps) {
  const { seatCount: n, viewerSeat, fighters, fx, fxStart, lowDetail } = props;
  const chars = useRoomCharacters((st) => st.byName);
  const pos = useMemo(() => Array.from({ length: n }, (_, s) => seatPos(s, viewerSeat, n)), [n, viewerSeat]);
  const near = useMemo(
    () =>
      pos.map((p) => {
        // a spot just in front of a body, toward the arena centre
        const d = p.clone().multiplyScalar(-1).normalize();
        return p.clone().addScaledVector(d, 0.85);
      }),
    [pos],
  );
  const pickable = new Set(props.pickable);
  // one look object per seat until the player's character changes (a fresh object re-tints the model)
  const namesKey = fighters.map((f) => `${f.seat}:${f.name}`).join("|");
  const looks = useMemo(
    () => Object.fromEntries(namesKey.split("|").map((e) => {
      const i = e.indexOf(":");
      const seat = Number(e.slice(0, i));
      return [seat, resolveLook(seat, ["none"], roomCharacterOf(chars, e.slice(i + 1)))];
    })),
    [namesKey, chars],
  );
  return (
    <>
      <color attach="background" args={["#2b211d"]} />
      <fog attach="fog" args={["#2b211d", 8, 28]} />
      <hemisphereLight args={["#c9a58a", "#1a1714", 0.75]} />
      <ambientLight intensity={0.3} color="#d8cfc6" />
      <directionalLight position={[-8, 6, -10]} intensity={1.3} color="#ffab6e" />
      <directionalLight position={[4, 8, 6]} intensity={0.7} color="#aab8d8" />
      <Battlefield n={n} lowDetail={lowDetail} avoid={pos} />
      {fighters.map((f) => {
        const home = pos[f.seat];
        const color = SEAT_COLORS[f.seat % SEAT_COLORS.length];
        const lying = f.pose === "down";
        const picked = props.picked === f.seat;
        const seed = f.seat * 5 + 3;
        // a lying body stretches sideways from the feet: keep its tags over the torso
        const lx = lying ? -fallSide(seed) * 0.75 : 0;
        return (
          <group key={f.seat}>
            <VrmFighter
              look={looks[f.seat]}
              seed={seed}
              home={home}
              facing={Math.atan2(-home.x, -home.z)}
              pose={f.pose}
              poseKey={f.poseKey}
              moveTo={f.moveToSeat !== null ? near[f.moveToSeat] : null}
              aimAt={f.aimSeat !== null ? pos[f.aimSeat] : null}
              out={f.out}
              lowDetail={lowDetail}
              onPick={pickable.has(f.seat) ? () => props.onPick(f.seat) : undefined}
            >
              {f.ammo > 0 && !f.out && (
                <group position-x={lx}>
                  <AmmoPips ammo={f.ammo} lying={lying} />
                </group>
              )}
              <ScreenSprite position={[lx, lying ? 0.95 : 2.2, 0]} anchorY={lying ? 0.6 : 1.9} scale={[0.6, 0.15]} map={labelTexture(f.seat === viewerSeat ? `${f.name} (나)` : f.name, color)} />
              {f.status && <ScreenSprite position={[lx, lying ? 1.13 : 2.38, 0]} anchorY={lying ? 0.6 : 1.9} scale={[0.6, 0.15]} map={labelTexture(f.status, f.out ? "#f87171" : "#e2e8f0", { bg: "rgba(15,10,25,0.8)", fg: f.out ? "#fca5a5" : "#f1f5f9" })} />}
              {(pickable.has(f.seat) || picked) && <PickRing picked={picked} />}
            </VrmFighter>
          </group>
        );
      })}
      {fx.map((e) => {
        switch (e.kind) {
          case "orb":
            return <Shot key={e.key} from={pos[e.from]} to={pos[e.to]} tier={e.tier} at={e.at} dur={e.dur} stop={e.stop} fxStart={fxStart} />;
          case "burst":
            return <Burst key={e.key} position={pos[e.seat]} color={e.color} at={e.at} big={e.big} fxStart={fxStart} />;
          case "midBurst":
            return <Burst key={e.key} position={pos[e.a].clone().lerp(pos[e.b], 0.5)} color="#ffffff" at={e.at} big fxStart={fxStart} />;
          case "text":
            return <FloatText key={e.key} position={pos[e.seat]} text={e.text} color={e.color} at={e.at} fxStart={fxStart} />;
          case "ammoFlow":
            return <AmmoFlow key={e.key} from={pos[e.from]} to={pos[e.to]} at={e.at} fxStart={fxStart} />;
        }
      })}
      <CameraRig n={n} />
      <AdaptiveResolution max={lowDetail ? 1.5 : 2} />
    </>
  );
}

function PickRing({ picked }: { picked: boolean }) {
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (mat.current) mat.current.opacity = picked ? 0.95 : 0.4 + Math.sin(clock.elapsedTime * 5) * 0.3;
  });
  return (
    <mesh rotation-x={-Math.PI / 2} position-y={0.14}>
      <ringGeometry args={[0.55, 0.72, 32]} />
      <meshBasicMaterial ref={mat} color="#f2b544" transparent opacity={0.7} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

export default function PlayDeadArena3D(props: PlayDeadArena3DProps) {
  return (
    <Canvas
      dpr={props.lowDetail ? [1, 1.5] : [1, 2]}
      gl={{ antialias: !props.lowDetail, powerPreference: "high-performance" }}
      camera={{ fov: 42, position: [0, 4, 7], near: 0.1, far: 90 }}
      style={{ touchAction: "pan-y" }}
    >
      <SceneContents {...props} />
    </Canvas>
  );
}
