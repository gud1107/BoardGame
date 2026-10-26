"use client";

import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import FirstPersonCamera from "@/games/shared/three/FirstPersonCamera";
import { resolveLook, type PersonMood } from "@/games/shared/three/SeatedPerson";
import VrmPerson from "@/games/shared/three/VrmPerson";
import { roomCharacterOf, useRoomCharacters } from "@/lib/character/roomCharacters";
import ScreenSprite from "@/games/shared/three/ScreenSprite";
import SpeechBubble from "@/games/shared/three/SpeechBubble";
import { labelTexture, polar, seatAngle, type BubbleStyle } from "@/games/shared/three/tableKit";

/**
 * 라이어를 찾아라 3D 방 — 매달린 전등 아래 둥근 테이블에 둘러앉은 사람들.
 * 설명/채팅은 머리 위 말풍선으로, 쓰는 중이면 고개 숙여 적는 동작, 토론 중
 * 마지막에 말한 사람은 손짓하며 말하고, 투표를 마치면 팔짱. 공개 때는 라이어
 * 자리에 붉은 조명이 떨어지고, 각자 누구를 찍었는지 테이블 위 화살표로 보인다.
 *
 * 보드가 `visibleDescriptions`로 이미 걸러낸 말풍선만 받으므로(설명 단계에선
 * 남의 문장 대신 ✍️/✅ 상태만) 숨은 정보가 장면으로 새지 않는다. 라이어 좌석도
 * 공개 단계에서만 넘어온다.
 */

export type LiarBubbleKind = "desc" | "chat" | "status" | "mine";

export interface LiarSeat3D {
  seat: number;
  name: string;
  score: number;
  bubble: { text: string; kind: LiarBubbleKind; key: string } | null;
  mood: PersonMood;
  /** 고개를 돌릴 좌석(null = 테이블 가운데). */
  lookSeat: number | null;
  tag: string | null;
}

export interface LiarTable3DProps {
  seatCount: number;
  viewerSeat: number;
  seats: LiarSeat3D[];
  /** 공개 단계에서만: 라이어 좌석. */
  liarSeat: number | null;
  /** 공개 단계에서만: 1차 투표(좌석 → 지목 대상). */
  votes: Record<number, number | null> | null;
  overview: boolean;
  lowDetail: boolean;
}

const SEAT_COLORS = ["#e879f9", "#38bdf8", "#4ade80", "#fb923c", "#f43f5e", "#22d3ee", "#facc15", "#a78bfa", "#a3e635", "#f472b6"];
const TABLE_Y = 0.92;
const HEAD_Y = 1.52;

function dims(n: number) {
  const seatR = 2.3 + Math.max(0, n - 4) * 0.3;
  return { seatR, tableR: seatR - 0.72 };
}

const BUBBLES: Record<LiarBubbleKind, BubbleStyle> = {
  desc: { bg: "rgba(255,255,255,0.96)", fg: "#1e1b4b", border: "#c4b5fd" },
  mine: { bg: "rgba(250,232,255,0.97)", fg: "#701a75", border: "#e879f9" },
  chat: { bg: "rgba(224,242,254,0.97)", fg: "#0c4a6e", border: "#38bdf8" },
  status: { bg: "rgba(30,27,75,0.9)", fg: "#e0e7ff", border: "#818cf8" },
};

function Room({ lowDetail }: { lowDetail: boolean }) {
  const seg = lowDetail ? 20 : 40;
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[11, seg]} />
        <meshStandardMaterial color="#3b2a22" roughness={0.85} />
      </mesh>
      {/* rug */}
      <mesh position={[0, 0.005, 0]} rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[4.6, seg]} />
        <meshStandardMaterial color="#4c1d3d" roughness={1} />
      </mesh>
      <mesh position={[0, 0.006, 0]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[4.3, 4.45, seg]} />
        <meshStandardMaterial color="#d4a64a" roughness={0.7} />
      </mesh>
      <mesh position={[0, 4, 0]}>
        <cylinderGeometry args={[10, 10, 8, seg, 1, true]} />
        <meshStandardMaterial color="#1e1b2e" roughness={1} side={THREE.BackSide} />
      </mesh>
      {/* framed "wanted" posters on the wall */}
      {[-0.7, 0.35, 1.4, 2.6, -1.9].map((a, i) => (
        <group key={i} position={[Math.sin(a + Math.PI) * 9.8, 2.6, Math.cos(a + Math.PI) * 9.8]} rotation-y={a}>
          <mesh>
            <planeGeometry args={[1.2, 1.6]} />
            <meshStandardMaterial color="#e7d8b5" roughness={0.9} />
          </mesh>
          <mesh position={[0, 0.15, 0.01]}>
            <circleGeometry args={[0.32, 16]} />
            <meshStandardMaterial color="#292524" roughness={0.9} />
          </mesh>
          <mesh position={[0, -0.45, 0.01]}>
            <planeGeometry args={[0.8, 0.12]} />
            <meshStandardMaterial color="#7f1d1d" roughness={0.9} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Lamp({ lowDetail }: { lowDetail: boolean }) {
  const light = useRef<THREE.PointLight>(null);
  useFrame(({ clock }) => {
    if (light.current) light.current.intensity = 22 + Math.sin(clock.elapsedTime * 2.1) * 0.6;
  });
  return (
    <group position={[0, 3.3, 0]}>
      <mesh position={[0, 1.3, 0]}>
        <cylinderGeometry args={[0.012, 0.012, 2.6, 6]} />
        <meshStandardMaterial color="#111" />
      </mesh>
      <mesh>
        <coneGeometry args={[0.65, 0.42, lowDetail ? 16 : 32, 1, true]} />
        <meshStandardMaterial color="#312e81" roughness={0.5} metalness={0.3} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, -0.1, 0]}>
        <sphereGeometry args={[0.12, 16, 12]} />
        <meshStandardMaterial color="#fff7e0" emissive="#ffe0a0" emissiveIntensity={2.4} />
      </mesh>
      <pointLight ref={light} position={[0, -0.25, 0]} color="#ffe4b5" intensity={22} distance={13} decay={2} castShadow={!lowDetail} shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
    </group>
  );
}

function Table({ tableR, lowDetail }: { tableR: number; lowDetail: boolean }) {
  const seg = lowDetail ? 28 : 64;
  return (
    <group>
      <mesh position={[0, TABLE_Y - 0.06, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[tableR + 0.12, tableR + 0.08, 0.12, seg]} />
        <meshStandardMaterial color="#2d1b14" roughness={0.4} metalness={0.05} />
      </mesh>
      <mesh position={[0, TABLE_Y + 0.004, 0]} rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[tableR - 0.04, seg]} />
        <meshStandardMaterial color="#14532d" roughness={0.95} />
      </mesh>
      <mesh position={[0, TABLE_Y / 2 - 0.05, 0]} castShadow>
        <cylinderGeometry args={[0.22, 0.5, TABLE_Y - 0.1, 16]} />
        <meshStandardMaterial color="#1c120d" roughness={0.6} />
      </mesh>
    </group>
  );
}

/** A face-down word card in front of every seat. */
function SeatCard({ position, angle, color }: { position: THREE.Vector3; angle: number; color: string }) {
  return (
    <group position={[position.x, TABLE_Y + 0.012, position.z]} rotation={[-Math.PI / 2, 0, angle]}>
      <mesh>
        <planeGeometry args={[0.3, 0.42]} />
        <meshStandardMaterial color="#1e1b4b" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0, 0.002]}>
        <ringGeometry args={[0.07, 0.1, 20]} />
        <meshBasicMaterial color={color} />
      </mesh>
    </group>
  );
}

/** Red spotlight cone + pool of light on the revealed liar. */
function LiarSpot({ position }: { position: THREE.Vector3 }) {
  const pool = useRef<THREE.MeshBasicMaterial>(null);
  const cone = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    const p = 0.75 + Math.sin(clock.elapsedTime * 4) * 0.25;
    if (pool.current) pool.current.opacity = 0.45 * p;
    if (cone.current) cone.current.opacity = 0.12 * p;
  });
  return (
    <group position={[position.x, 0, position.z]}>
      <mesh position={[0, 0.02, 0]} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[0.75, 32]} />
        <meshBasicMaterial ref={pool} color="#f43f5e" transparent opacity={0.4} depthWrite={false} />
      </mesh>
      <mesh position={[0, 2.2, 0]}>
        <coneGeometry args={[0.8, 4.4, 24, 1, true]} />
        <meshBasicMaterial ref={cone} color="#fb7185" transparent opacity={0.12} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <pointLight position={[0, 3, 0]} color="#ff4d6d" intensity={8} distance={5} decay={1.5} />
    </group>
  );
}

/** A flat arrow on the table from a voter toward the seat they accused. */
function VoteArrow({ from, to, color }: { from: THREE.Vector3; to: THREE.Vector3; color: string }) {
  const { mid, len, yaw } = useMemo(() => {
    const a = from.clone();
    const b = to.clone();
    const dir = b.clone().sub(a);
    const l = dir.length();
    return { mid: a.clone().add(dir.multiplyScalar(0.5)), len: l, yaw: Math.atan2(b.x - a.x, b.z - a.z) };
  }, [from, to]);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (mat.current) mat.current.opacity = 0.65 + Math.sin(clock.elapsedTime * 3) * 0.2;
  });
  return (
    <group position={[mid.x, TABLE_Y + 0.02, mid.z]} rotation-y={yaw}>
      <mesh rotation-x={-Math.PI / 2}>
        <planeGeometry args={[0.05, Math.max(0.05, len - 0.25)]} />
        <meshBasicMaterial ref={mat} color={color} transparent opacity={0.75} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0, len / 2 - 0.12]} rotation-x={Math.PI / 2}>
        <coneGeometry args={[0.09, 0.22, 3]} />
        <meshBasicMaterial color={color} />
      </mesh>
    </group>
  );
}

function SceneContents(props: LiarTable3DProps) {
  const { seatCount: n, viewerSeat, seats, lowDetail } = props;
  const chars = useRoomCharacters((st) => st.byName);
  const { seatR, tableR } = dims(n);
  const viewerHead = new THREE.Vector3(0, 1.9, seatR + 0.6);
  const headOf = (seat: number) => (seat === viewerSeat ? viewerHead : polar(seatAngle(seat, viewerSeat, n), seatR - 0.05, HEAD_Y));
  const cardSpot = (seat: number) => polar(seatAngle(seat, viewerSeat, n), tableR - 0.35);

  return (
    <>
      <color attach="background" args={["#0f0c1d"]} />
      <fog attach="fog" args={["#0f0c1d", 7, 16]} />
      <ambientLight intensity={0.25} color="#c4b5fd" />
      <hemisphereLight args={["#e0d4ff", "#1a1020", 0.35]} />
      <directionalLight position={[0, 3.5, -6]} intensity={0.45} color="#93c5fd" />
      <Room lowDetail={lowDetail} />
      <Lamp lowDetail={lowDetail} />
      <Table tableR={tableR} lowDetail={lowDetail} />
      {props.liarSeat !== null && <LiarSpot position={polar(seatAngle(props.liarSeat, viewerSeat, n), props.liarSeat === viewerSeat ? seatR - 0.3 : seatR)} />}
      {props.votes &&
        Object.entries(props.votes).map(([voter, target]) =>
          target === null || target === undefined ? null : (
            <VoteArrow key={voter} from={cardSpot(Number(voter))} to={cardSpot(target)} color={SEAT_COLORS[Number(voter) % SEAT_COLORS.length]} />
          ),
        )}
      {seats.map((s) => {
        const angle = seatAngle(s.seat, viewerSeat, n);
        const isViewer = s.seat === viewerSeat;
        const color = SEAT_COLORS[s.seat % SEAT_COLORS.length];
        const lookAt = s.lookSeat === null ? new THREE.Vector3(0, TABLE_Y, 0) : headOf(s.lookSeat);
        const bubble = s.bubble ? <SpeechBubble text={s.bubble.text} style={{ ...BUBBLES[s.bubble.kind], who: s.name, whoColor: color }} y={2.42} popKey={s.bubble.key} width={s.bubble.kind === "status" ? 0.62 : 1.05} /> : null;
        return (
          <group key={s.seat}>
            <SeatCard position={cardSpot(s.seat)} angle={angle} color={color} />
            {isViewer ? (
              <group position={polar(0, tableR - 0.15, 0).toArray()}>
                {s.bubble && <SpeechBubble text={s.bubble.text} style={{ ...BUBBLES[s.bubble.kind], who: "나", whoColor: color }} y={TABLE_Y + 0.72} popKey={s.bubble.key} width={0.9} />}
                {s.tag && (
                  <ScreenSprite position={[0, TABLE_Y + 0.35, 0]} scale={[0.7, 0.175]} map={labelTexture(s.tag, "#f43f5e")} />
                )}
              </group>
            ) : (
              <VrmPerson
                seed={s.seat * 5 + 2}
                look={resolveLook(s.seat, ["none", "cap", "none", "fedora", "none", "beret"], roomCharacterOf(chars, s.name))}
                color={color}
                position={polar(angle, seatR)}
                facing={angle + Math.PI}
                mood={s.mood}
                lookAt={lookAt}
                lowDetail={lowDetail}
                chair="wood"
                chairColor="#3f2a1d"
              >
                <ScreenSprite position={[0, 1.95, 0]} scale={[0.86, 0.21]} map={labelTexture(`${s.name} · ${s.score}점`, color)} />
                {s.tag && (
                  <ScreenSprite position={[0, 1.75, 0]} scale={[0.66, 0.165]} map={labelTexture(s.tag, "#f43f5e", { bg: "rgba(76,5,25,0.85)" })} />
                )}
                {bubble}
              </VrmPerson>
            )}
          </group>
        );
      })}
      <FirstPersonCamera seatR={seatR} tableY={TABLE_Y} overview={props.overview} seats={n} />
    </>
  );
}

export default function LiarTable3D(props: LiarTable3DProps) {
  const high = !props.lowDetail;
  return (
    <Canvas
      shadows={high}
      dpr={high ? [1, 1.75] : [1, 1.25]}
      gl={{ antialias: high, powerPreference: "high-performance" }}
      camera={{ fov: 54, position: [0, 2.15, 4], near: 0.05, far: 60 }}
      style={{ touchAction: "pan-y" }}
    >
      <SceneContents {...props} />
    </Canvas>
  );
}
