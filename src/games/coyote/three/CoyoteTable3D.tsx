"use client";

import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Card } from "../engine";
import { coyoteCardTexture } from "./cardTexture";
import ScreenSprite, { distanceBoost } from "@/games/shared/three/ScreenSprite";
import SpeechBubble from "@/games/shared/three/SpeechBubble";
import FirstPersonCamera from "@/games/shared/three/FirstPersonCamera";
import SeatedPerson, { resolveLook, type PersonMood } from "@/games/shared/three/SeatedPerson";
import { roomCharacterOf, useRoomCharacters } from "@/lib/character/roomCharacters";
import { bubbleTexture, clamp01, easeInOut, easeOutBack, labelTexture, polar, seatAngle } from "@/games/shared/three/tableKit";

/**
 * 코요테 3D 테이블 — 사막의 밤, 둥근 나무 테이블에 사람들이 둘러앉아 이마 밴드에
 * 카드를 꽂고 있다. 남의 카드는 이마에서 보이고 내 카드는(1인칭이라) 안 보인다.
 * 선언은 말풍선(마지막 선언이 남아 있음)과 테이블 가운데 팻말로, "코요테!"는
 * 외친 사람이 선언한 사람을 손가락으로 가리키는 동작으로, 공개 단계에서는 모든
 * 카드가 이마에서 내려와 테이블 앞에 세워진다(내 카드는 엎어진 채 내려와 뒤집힘).
 *
 * 보드(`CoyoteBoard`)가 이미 `getPlayerView`로 가린 카드만 넘겨주므로 이
 * 장면은 볼 수 없는 정보를 받지 않는다. 판정 타이밍(verdict/roles)도 보드의
 * 기존 연출 단계를 그대로 따른다 — 장면은 표시만 한다.
 */

export interface CoyoteSeat3D {
  seat: number;
  name: string;
  hearts: number;
  /** 하트 0 — 고개를 떨군 회색 모습, 카드 없음. */
  out: boolean;
  /** 표시할 카드(null = 내 이마 카드처럼 볼 수 없는 카드). */
  card: Card | null;
  /** MAX→0으로 지워진 카드. */
  struck: boolean;
  role: "caller" | "bidder" | null;
  verdict: "lost" | "won" | null;
  /** 탈락 직전 붉게 번쩍이는 순간. */
  flashing: boolean;
}

export interface CoyoteTable3DProps {
  playerCount: number;
  viewerSeat: number;
  seats: CoyoteSeat3D[];
  activeSeat: number | null;
  revealed: boolean;
  /** 라운드 번호 — 공개 애니메이션을 라운드마다 다시 시작. */
  roundNumber: number;
  currentBid: { seat: number; number: number } | null;
  maxHearts: number;
  lowDetail: boolean;
}

const SEAT_COLORS = ["#f97316", "#38bdf8", "#4ade80", "#c084fc", "#f43f5e", "#22d3ee", "#facc15", "#a3e635"];
const TABLE_Y = 0.92;
const HEAD_Y = 1.52;

function dims(n: number) {
  const seatR = 2.35 + Math.max(0, n - 4) * 0.28;
  return { seatR, tableR: seatR - 0.72 };
}

const hash = (a: number, b: number) => {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

// ---------------------------------------------------------------------------
// Desert night
// ---------------------------------------------------------------------------

function Stars({ lowDetail }: { lowDetail: boolean }) {
  const geo = useMemo(() => {
    const count = lowDetail ? 260 : 600;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const th = hash(i, 1) * Math.PI * 2;
      const ph = 0.08 + hash(i, 2) * 1.35;
      const r = 40;
      pos[i * 3] = Math.cos(th) * Math.cos(ph) * r;
      pos[i * 3 + 1] = Math.sin(ph) * r;
      pos[i * 3 + 2] = Math.sin(th) * Math.cos(ph) * r;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return g;
  }, [lowDetail]);
  return (
    <points geometry={geo}>
      <pointsMaterial color="#fef9c3" size={0.16} sizeAttenuation fog={false} />
    </points>
  );
}

function Cactus({ position, s }: { position: [number, number, number]; s: number }) {
  const mat = <meshStandardMaterial color="#1f3b2a" roughness={0.9} />;
  return (
    <group position={position} scale={s}>
      <mesh position={[0, 0.9, 0]}>
        <capsuleGeometry args={[0.18, 1.5, 4, 8]} />
        {mat}
      </mesh>
      <mesh position={[0.32, 1.05, 0]} rotation-z={-0.2}>
        <capsuleGeometry args={[0.1, 0.5, 4, 8]} />
        {mat}
      </mesh>
      <mesh position={[-0.3, 1.25, 0]} rotation-z={0.15}>
        <capsuleGeometry args={[0.1, 0.45, 4, 8]} />
        {mat}
      </mesh>
    </group>
  );
}

function Campfire({ position, lowDetail }: { position: [number, number, number]; lowDetail: boolean }) {
  const light = useRef<THREE.PointLight>(null);
  const flames = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (light.current) light.current.intensity = 14 + Math.sin(t * 11) * 2 + Math.sin(t * 23) * 1.5;
    flames.current?.children.forEach((f, i) => {
      f.scale.y = 1 + Math.sin(t * (9 + i * 2.3) + i) * 0.22;
      f.rotation.y = t * (0.6 + i * 0.2);
    });
  });
  return (
    <group position={position}>
      {[0, 1, 2, 3, 4].map((i) => (
        <mesh key={i} position={[Math.cos(i * 1.3) * 0.2, 0.08, Math.sin(i * 1.3) * 0.2]} rotation={[Math.PI / 2, 0, i * 1.3]}>
          <cylinderGeometry args={[0.06, 0.07, 0.7, 8]} />
          <meshStandardMaterial color="#3b2412" roughness={0.9} />
        </mesh>
      ))}
      {Array.from({ length: 8 }, (_, i) => (
        <mesh key={`r${i}`} position={[Math.cos((i / 8) * Math.PI * 2) * 0.48, 0.07, Math.sin((i / 8) * Math.PI * 2) * 0.48]}>
          <sphereGeometry args={[0.11, 8, 6]} />
          <meshStandardMaterial color="#57534e" roughness={1} />
        </mesh>
      ))}
      <group ref={flames} position={[0, 0.15, 0]}>
        {[
          [0, 0.75, 0.24, "#f97316"],
          [0.06, 0.55, 0.18, "#fbbf24"],
          [-0.05, 0.45, 0.14, "#fde68a"],
        ].map(([x, h, r, c], i) => (
          <mesh key={i} position={[x as number, (h as number) / 2, 0]}>
            <coneGeometry args={[r as number, h as number, 10]} />
            <meshBasicMaterial color={c as string} transparent opacity={0.85} />
          </mesh>
        ))}
      </group>
      <pointLight ref={light} position={[0, 0.7, 0]} color="#ff9a3c" intensity={14} distance={12} decay={1.6} castShadow={!lowDetail} />
    </group>
  );
}

function Desert({ lowDetail }: { lowDetail: boolean }) {
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[60, lowDetail ? 24 : 48]} />
        <meshStandardMaterial color="#4a3423" roughness={1} />
      </mesh>
      <Stars lowDetail={lowDetail} />
      <mesh position={[-14, 16, -30]}>
        <sphereGeometry args={[2.2, 24, 16]} />
        <meshBasicMaterial color="#fef3c7" fog={false} />
      </mesh>
      {/* mesas on the horizon */}
      {[
        [-22, -26, 7, 5],
        [-8, -34, 10, 4],
        [14, -30, 8, 6],
        [28, -12, 6, 4],
        [-30, 4, 7, 3.5],
      ].map(([x, z, w, h], i) => (
        <mesh key={i} position={[x, h / 2, z]}>
          <cylinderGeometry args={[w * 0.8, w, h, 7]} />
          <meshStandardMaterial color="#2b1b2e" roughness={1} />
        </mesh>
      ))}
      <Cactus position={[-5.5, 0, -4]} s={1.2} />
      <Cactus position={[6, 0, -5.5]} s={1.5} />
      <Cactus position={[7.5, 0, 2.5]} s={1} />
      <Cactus position={[-7.5, 0, 3]} s={1.3} />
      <Campfire position={[-4.2, 0, -2.6]} lowDetail={lowDetail} />
    </group>
  );
}

function Table({ tableR, lowDetail }: { tableR: number; lowDetail: boolean }) {
  const seg = lowDetail ? 28 : 56;
  const lantern = useRef<THREE.PointLight>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (lantern.current) lantern.current.intensity = 9 + Math.sin(t * 7) * 0.4 + Math.sin(t * 17) * 0.3;
  });
  return (
    <group>
      <mesh position={[0, TABLE_Y - 0.05, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[tableR + 0.1, tableR + 0.05, 0.12, seg]} />
        <meshStandardMaterial color="#6b3d1e" roughness={0.6} />
      </mesh>
      {/* plank lines */}
      {Array.from({ length: 7 }, (_, i) => (
        <mesh key={i} position={[(i - 3) * ((tableR * 2) / 7), TABLE_Y + 0.012, 0]} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[0.012, Math.sqrt(Math.max(0, tableR * tableR - ((i - 3) * ((tableR * 2) / 7)) ** 2)) * 2]} />
          <meshBasicMaterial color="#3b1f0d" transparent opacity={0.5} />
        </mesh>
      ))}
      <mesh position={[0, TABLE_Y / 2 - 0.05, 0]} castShadow>
        <cylinderGeometry args={[0.22, 0.5, TABLE_Y - 0.1, 16]} />
        <meshStandardMaterial color="#3a1d0e" roughness={0.7} />
      </mesh>
      {/* lantern */}
      <group position={[0, TABLE_Y, 0]}>
        <mesh position={[0, 0.04, 0]}>
          <cylinderGeometry args={[0.12, 0.14, 0.06, 12]} />
          <meshStandardMaterial color="#292524" metalness={0.6} roughness={0.4} />
        </mesh>
        <mesh position={[0, 0.2, 0]}>
          <cylinderGeometry args={[0.09, 0.09, 0.26, 12]} />
          <meshStandardMaterial color="#fde68a" emissive="#f59e0b" emissiveIntensity={1.6} transparent opacity={0.9} />
        </mesh>
        <mesh position={[0, 0.36, 0]}>
          <coneGeometry args={[0.13, 0.08, 12]} />
          <meshStandardMaterial color="#292524" metalness={0.6} roughness={0.4} />
        </mesh>
        <pointLight ref={lantern} position={[0, 0.25, 0]} color="#ffc56b" intensity={9} distance={7} decay={1.7} />
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function CardMesh({ card, struck, scale = 1 }: { card: Card | null; struck: boolean; scale?: number }) {
  return (
    <group scale={scale}>
      <mesh>
        <planeGeometry args={[0.24, 0.34]} />
        <meshStandardMaterial map={coyoteCardTexture(card)} roughness={0.5} color={struck ? "#a3a3a3" : "#ffffff"} />
      </mesh>
      <mesh position={[0, 0, -0.002]} rotation-y={Math.PI}>
        <planeGeometry args={[0.24, 0.34]} />
        <meshStandardMaterial map={coyoteCardTexture(null)} roughness={0.5} />
      </mesh>
      {struck &&
        [1, -1].map((s) => (
          <mesh key={s} position={[0, 0, 0.004]} rotation-z={0.62 * s}>
            <planeGeometry args={[0.36, 0.035]} />
            <meshBasicMaterial color="#ef4444" />
          </mesh>
        ))}
    </group>
  );
}

const _q = new THREE.Quaternion();
const _qt = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, "YXZ");
const _p = new THREE.Vector3();

/**
 * The forehead card turns to face my camera (a real player would tilt it for
 * nobody, but on a screen a side seat's card would otherwise be edge-on and
 * unreadable) and slides a little further out of the headband as it turns.
 */
function FacingCard({ card, struck }: { card: Card | null; struck: boolean }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ camera }) => {
    const g = ref.current;
    const parent = g?.parent;
    if (!g || !parent) return;
    parent.getWorldPosition(_p);
    const yaw = Math.atan2(camera.position.x - _p.x, camera.position.z - _p.z);
    parent.getWorldQuaternion(_q);
    _e.set(-0.12, yaw, 0);
    _qt.setFromEuler(_e);
    g.quaternion.copy(_q.invert().multiply(_qt));
    // how far the card turned away from the face direction → push it out so it clears the head
    const turn = Math.abs(new THREE.Euler().setFromQuaternion(g.quaternion, "YXZ").y);
    const k = distanceBoost(g, camera, 3.6, 1.9);
    g.scale.setScalar(k);
    g.position.set(0, 0.17 + 0.1 * (k - 1), 0.225 + Math.min(0.16, Math.sin(Math.min(turn, Math.PI / 2)) * 0.16));
  });
  return (
    <group ref={ref} position={[0, 0.17, 0.225]}>
      <CardMesh card={card} struck={struck} scale={1.5} />
    </group>
  );
}

/** The forehead card in a leather headband with a feather — hidden once the round is revealed. */
function ForeheadCard({ card, struck, visible }: { card: Card | null; struck: boolean; visible: boolean }) {
  return (
    <group>
      <mesh position={[0, 0.06, 0]} rotation-x={Math.PI / 2} scale={[0.95, 1, 1.0]}>
        <torusGeometry args={[0.2, 0.018, 6, 24]} />
        <meshStandardMaterial color="#7c2d12" roughness={0.8} />
      </mesh>
      <group position={[-0.17, 0.12, -0.12]} rotation={[0.3, 0, 0.45]}>
        <mesh position={[0, 0.12, 0]} scale={[0.35, 1, 0.08]}>
          <sphereGeometry args={[0.1, 8, 8]} />
          <meshStandardMaterial color="#f8fafc" roughness={0.8} />
        </mesh>
        <mesh position={[0, 0.2, 0]} scale={[0.3, 0.35, 0.08]}>
          <sphereGeometry args={[0.1, 8, 8]} />
          <meshStandardMaterial color="#b91c1c" roughness={0.8} />
        </mesh>
      </group>
      {visible && <FacingCard card={card} struck={struck} />}
    </group>
  );
}

/** Card laid in front of a seat at reveal: drops from the forehead and stands facing the camera. */
function RevealCard({
  card,
  struck,
  from,
  to,
  delay,
  flip,
  camZ,
}: {
  card: Card | null;
  struck: boolean;
  from: THREE.Vector3;
  to: THREE.Vector3;
  delay: number;
  flip: boolean;
  camZ: number;
}) {
  const ref = useRef<THREE.Group>(null);
  const born = useRef<number | null>(null);
  const yaw = Math.atan2(0 - to.x, camZ - to.z);
  useFrame(({ clock, camera }) => {
    const g = ref.current;
    if (!g) return;
    if (born.current === null) born.current = clock.elapsedTime;
    const t = clock.elapsedTime - born.current - delay;
    const u = clamp01(t / 0.7);
    const e = easeInOut(u);
    g.visible = t >= 0;
    g.position.set(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e + Math.sin(u * Math.PI) * 0.35, from.z + (to.z - from.z) * e);
    const f = flip ? easeOutBack(clamp01((t - 0.75) / 0.5)) : 1;
    g.rotation.set(-0.28, yaw + Math.PI * (1 - f), 0);
    g.scale.setScalar((1 + Math.sin(clamp01((t - 0.75) / 0.5) * Math.PI) * (flip ? 0.12 : 0)) * distanceBoost(g, camera, 4.2, 1.7));
  });
  return (
    <group ref={ref} visible={false}>
      <CardMesh card={card} struck={struck} scale={1.55} />
    </group>
  );
}

const BUBBLE = {
  declare: { bg: "rgba(254,243,199,0.96)", fg: "#78350f", border: "#f59e0b" },
  coyote: { bg: "rgba(225,29,72,0.96)", fg: "#ffffff", border: "#fecdd3" },
  lost: { bg: "rgba(76,5,25,0.95)", fg: "#fecdd3", border: "#f43f5e" },
  won: { bg: "rgba(6,78,59,0.95)", fg: "#d1fae5", border: "#34d399" },
};

function seatBubble(s: CoyoteSeat3D, revealed: boolean, bid: CoyoteTable3DProps["currentBid"], round: number): { text: string; style: (typeof BUBBLE)[keyof typeof BUBBLE]; key: string } | null {
  if (revealed) {
    if (s.verdict === "lost") return { text: s.hearts <= 0 ? "💀 탈락…" : "💔 하트 −1", style: BUBBLE.lost, key: `l${round}` };
    if (s.verdict === "won") return { text: "✓ 판정 승리!", style: BUBBLE.won, key: `w${round}` };
    if (s.role === "caller") return { text: "🐺 코요테!", style: BUBBLE.coyote, key: `c${round}` };
    if (s.role === "bidder" && bid) return { text: `📢 ${bid.number}`, style: BUBBLE.declare, key: `b${round}` };
    return null;
  }
  if (bid && bid.seat === s.seat) return { text: `📢 ${bid.number}!`, style: BUBBLE.declare, key: `d${round}-${bid.number}` };
  return null;
}

function ActiveRing({ position }: { position: THREE.Vector3 }) {
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (mat.current) mat.current.opacity = 0.55 + Math.sin(clock.elapsedTime * 5) * 0.35;
  });
  return (
    <mesh position={[position.x, TABLE_Y + 0.015, position.z]} rotation-x={-Math.PI / 2}>
      <ringGeometry args={[0.2, 0.28, 32]} />
      <meshBasicMaterial ref={mat} color="#fbbf24" transparent opacity={0.8} />
    </mesh>
  );
}

function BidSign({ bid, name }: { bid: CoyoteTable3DProps["currentBid"]; name: string }) {
  const text = bid ? `현재 선언 ${bid.number}\n${name}` : "첫 선언 대기";
  const { tex, aspect } = useMemo(() => bubbleTexture(text, { bg: "rgba(41,24,10,0.92)", fg: "#fde68a", border: "#b45309", size: 46 }), [text]);
  const ref = useRef<THREE.Sprite>(null);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.position.y = TABLE_Y + 0.62 + Math.sin(clock.elapsedTime * 1.3) * 0.03;
  });
  return (
    <sprite ref={ref} position={[0, TABLE_Y + 0.62, 0.35]} scale={[0.95, 0.95 * aspect, 1]}>
      <spriteMaterial map={tex} transparent depthWrite={false} />
    </sprite>
  );
}

// ---------------------------------------------------------------------------

function SceneContents(props: CoyoteTable3DProps) {
  const { playerCount: n, viewerSeat, seats, revealed, lowDetail, currentBid } = props;
  const chars = useRoomCharacters((st) => st.byName);
  const { seatR, tableR } = dims(n);
  const camZ = seatR + 1.5;

  const headOf = (seat: number) => polar(seatAngle(seat, viewerSeat, n), seatR - 0.05, HEAD_Y);
  const viewerHead = new THREE.Vector3(0, 1.9, seatR + 0.6);
  const caller = seats.find((s) => s.role === "caller")?.seat ?? null;
  const bidder = seats.find((s) => s.role === "bidder")?.seat ?? null;
  const anyVerdict = seats.some((s) => s.verdict !== null);
  const bidderName = currentBid ? (seats.find((s) => s.seat === currentBid.seat)?.name ?? "") : "";

  return (
    <>
      <color attach="background" args={["#0b1028"]} />
      <fog attach="fog" args={["#0b1028", 9, 42]} />
      <ambientLight intensity={0.28} color="#a5b4fc" />
      <hemisphereLight args={["#6b7bd6", "#2a1a10", 0.45]} />
      <directionalLight position={[-8, 12, -10]} intensity={0.55} color="#c7d2fe" />
      <directionalLight position={[0, 4, 8]} intensity={0.25} color="#ffd9a8" />
      <Desert lowDetail={lowDetail} />
      <Table tableR={tableR} lowDetail={lowDetail} />
      {!revealed && <BidSign bid={currentBid} name={bidderName} />}
      {seats.map((s) => {
        const angle = seatAngle(s.seat, viewerSeat, n);
        const isViewer = s.seat === viewerSeat;
        const color = SEAT_COLORS[s.seat % SEAT_COLORS.length];
        const pos = polar(angle, seatR);
        let mood: PersonMood = "rest";
        let lookAt: THREE.Vector3 | null = props.activeSeat !== null ? (props.activeSeat === viewerSeat ? viewerHead : headOf(props.activeSeat)) : null;
        if (revealed) {
          lookAt = new THREE.Vector3(0, TABLE_Y, 0);
          if (s.verdict === "lost") mood = s.hearts <= 0 ? "shock" : "sad";
          else if (s.verdict === "won") mood = "cheer";
          else if (s.role === "caller") {
            mood = "point";
            if (bidder !== null) lookAt = bidder === viewerSeat ? viewerHead : headOf(bidder);
          } else if (s.role === "bidder") {
            mood = "nervous";
            if (caller !== null) lookAt = caller === viewerSeat ? viewerHead : headOf(caller);
          } else if (anyVerdict) {
            const r = hash(s.seat, props.roundNumber);
            mood = r < 0.4 ? "laugh" : r < 0.7 ? "clap" : "shrug";
          }
          if (s.flashing) mood = "shock";
        } else if (props.activeSeat === s.seat) {
          mood = "think";
          lookAt = currentBid ? (currentBid.seat === viewerSeat ? viewerHead : headOf(currentBid.seat)) : new THREE.Vector3(0, TABLE_Y, 0);
        } else if (currentBid?.seat === s.seat) {
          mood = "smug";
        }
        const bubble = seatBubble(s, revealed, currentBid, props.roundNumber);
        const revealTo = polar(angle, tableR - (isViewer ? 0.55 : 0.4), TABLE_Y + 0.29);
        return (
          <group key={s.seat}>
            {!isViewer && (
              <SeatedPerson
                seed={s.seat * 3 + 1}
                look={resolveLook(s.seat, ["none", "none", "beret", "none"], roomCharacterOf(chars, s.name))}
                color={color}
                position={pos}
                facing={angle + Math.PI}
                mood={mood}
                lookAt={lookAt}
                maxYaw={revealed ? 0.9 : 0.4}
                out={s.out}
                lowDetail={lowDetail}
                chair="stool"
                chairColor="#4a2c17"
                headSlot={!s.out && <ForeheadCard card={s.card} struck={s.struck} visible={!revealed} />}
              >
                <ScreenSprite position={[0, 2.18, 0]} scale={[0.82, 0.2]} map={labelTexture(s.name, color)} />
                <ScreenSprite position={[0, 1.99, 0]} scale={[0.62, 0.155]} map={labelTexture(s.out ? "💀 탈락" : `${"❤️".repeat(Math.max(0, s.hearts))}${"🤍".repeat(Math.max(0, props.maxHearts - s.hearts))}`, s.out ? "#7f1d1d" : "#f43f5e", { bg: "rgba(0,0,0,0.55)" })} />
                {bubble && <SpeechBubble text={bubble.text} style={{ ...bubble.style, who: s.name, whoColor: color }} y={2.55} popKey={bubble.key} />}
              </SeatedPerson>
            )}
            {isViewer && bubble && (
              <group position={polar(0, tableR - 0.1, 0).toArray()}>
                <SpeechBubble text={bubble.text} style={{ ...bubble.style, who: "나", whoColor: color }} y={TABLE_Y + 0.75} popKey={bubble.key} />
              </group>
            )}
            {props.activeSeat === s.seat && !revealed && <ActiveRing position={polar(angle, tableR - 0.22)} />}
            {revealed && !s.out && s.card && (
              <RevealCard
                key={`${props.roundNumber}-${s.seat}`}
                card={s.card}
                struck={s.struck}
                from={isViewer ? polar(0, seatR - 0.1, 1.2) : polar(angle, seatR - 0.05, HEAD_Y + 0.15)}
                to={revealTo}
                delay={0.1 + ((s.seat - viewerSeat + n) % n) * 0.07}
                flip={isViewer}
                camZ={camZ}
              />
            )}
          </group>
        );
      })}
      <FirstPersonCamera seatR={seatR} tableY={TABLE_Y} overview={revealed} seats={n} />
    </>
  );
}

export default function CoyoteTable3D(props: CoyoteTable3DProps) {
  const high = !props.lowDetail;
  return (
    <Canvas
      shadows={high}
      dpr={high ? [1, 1.75] : [1, 1.25]}
      gl={{ antialias: high, powerPreference: "high-performance" }}
      camera={{ fov: 54, position: [0, 2.15, 4], near: 0.05, far: 120 }}
      style={{ touchAction: "pan-y" }}
    >
      <SceneContents {...props} />
    </Canvas>
  );
}
