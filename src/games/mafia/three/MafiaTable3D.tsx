"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import TableScene, { useTableGeo, type TableSeat, type TableTheme } from "@/games/shared/three/TableScene";
import { FlatCard, FloatIcon, PopIn, TableSign } from "@/games/shared/three/tablePieces";
import { paintedTexture, FONTS, type BubbleStyle } from "@/games/shared/three/tableKit";
import type { PersonMood } from "@/games/shared/three/SeatedPerson";

/**
 * 마피아 3D — 마을 회관. 창밖 하늘과 조명이 낮/밤에 따라 천천히 바뀐다.
 * 밤에는 살아 있는 사람 모두가 고개를 떨구고 잠들어 있어(💤) 누가 움직였는지
 * 화면으로 드러나지 않는다. 낮에는 공개 채팅이 말풍선으로, 지목/찬반 투표를
 * 마친 사람은 손을 들고, 최후 변론자에겐 스포트라이트가 떨어진다. 사망자는
 * 회색으로 쓰러지고 머리 위에 👻.
 *
 * 보드가 공개 정보만(+내가 직접 알게 된 정체 배지) 넘긴다: 누구를 지목했는지,
 * 밤에 누가 무엇을 했는지는 이 장면에 오지 않는다. 유령 채팅도 넘기지 않는다.
 */

export interface MafiaSeat3D {
  seat: number;
  name: string;
  alive: boolean;
  /** 내 화면에서만 보이는 배지(조사 결과·마피아 동료) 또는 공개된 사망자 직업. */
  tag: { text: string; color: string } | null;
  /** 앞면으로 공개된 직업 카드(사망 후 공개 설정 / 게임 종료 / 유령 시점). */
  roleCard: { icon: string; label: string; mafia: boolean } | null;
  /** 지목/찬반/스킵 등 "행동을 마쳤다"는 공개 표시. */
  acted: boolean;
  isSuspect: boolean;
  /** 공개 채팅 말풍선(최근). */
  chat: { text: string; key: string } | null;
  disconnected: boolean;
}

export interface MafiaTable3DProps {
  playerCount: number;
  viewerSeat: number;
  seats: MafiaSeat3D[];
  night: boolean;
  phase: string;
  sign: string;
  /** 방금 처형/사망한 좌석 — 모두가 그쪽을 본다. */
  focusSeat: number | null;
  overview: boolean;
  lowDetail: boolean;
}

const SEAT_COLORS = ["#f87171", "#60a5fa", "#4ade80", "#facc15", "#c084fc", "#22d3ee", "#fb923c", "#a3e635", "#f472b6", "#94a3b8", "#2dd4bf", "#e879f9"];

function roleTexture(card: { icon: string; label: string; mafia: boolean } | null): THREE.CanvasTexture {
  const key = card ? `${card.icon}:${card.label}:${card.mafia}` : "back";
  return paintedTexture(`mafia:role:${key}`, 256, 360, (ctx, W, H) => {
    ctx.beginPath();
    ctx.roundRect(4, 4, W - 8, H - 8, 20);
    ctx.save();
    ctx.clip();
    const g = ctx.createLinearGradient(0, 0, 0, H);
    if (!card) {
      g.addColorStop(0, "#2a1a1a");
      g.addColorStop(1, "#0c0808");
    } else if (card.mafia) {
      g.addColorStop(0, "#7f1d1d");
      g.addColorStop(1, "#1c0505");
    } else {
      g.addColorStop(0, "#1e3a5f");
      g.addColorStop(1, "#0a1424");
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    ctx.strokeStyle = card ? (card.mafia ? "#fca5a5" : "#93c5fd") : "#a8a29e";
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.roundRect(10, 10, W - 20, H - 20, 16);
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `110px ${FONTS.emoji}`;
    ctx.fillText(card ? card.icon : "🎭", W / 2, H / 2 - 24);
    ctx.fillStyle = "#fafaf9";
    ctx.font = `800 42px ${FONTS.text}`;
    ctx.fillText(card ? card.label : "MAFIA", W / 2, H - 70);
  });
}

// ---------------------------------------------------------------------------
// Village hall with a day/night sky
// ---------------------------------------------------------------------------

function plankTexture(): THREE.Texture {
  const t = paintedTexture("mafia:planks", 256, 256, (ctx, W) => {
    for (let x = 0; x < 8; x++) {
      const v = 60 + ((x * 37) % 26);
      ctx.fillStyle = `rgb(${v + 30},${v + 12},${v - 8})`;
      ctx.fillRect(x * 32, 0, 32, W);
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(x * 32, 0, 2, W);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(12, 2);
  return t;
}

const NIGHT_SKY = new THREE.Color("#0b1530");
const DAY_SKY = new THREE.Color("#8ec5ff");

function VillageHall({ night, lowDetail }: { night: boolean; lowDetail: boolean }) {
  const seg = lowDetail ? 24 : 48;
  const planks = useMemo(() => plankTexture(), []);
  const k = useRef(night ? 1 : 0);
  const sky = useRef<THREE.MeshBasicMaterial[]>([]);
  const sun = useRef<THREE.DirectionalLight>(null);
  const moon = useRef<THREE.DirectionalLight>(null);
  const amb = useRef<THREE.AmbientLight>(null);
  const orb = useRef<THREE.MeshBasicMaterial>(null);
  const tmp = useMemo(() => new THREE.Color(), []);
  useFrame((_, dt) => {
    k.current += ((night ? 1 : 0) - k.current) * (1 - Math.exp(-dt * 1.4));
    const n = k.current;
    tmp.copy(DAY_SKY).lerp(NIGHT_SKY, n);
    for (const m of sky.current) m?.color.copy(tmp);
    if (sun.current) sun.current.intensity = 1.1 * (1 - n);
    if (moon.current) moon.current.intensity = 0.45 * n;
    if (amb.current) amb.current.intensity = 0.15 + 0.35 * (1 - n);
    orb.current?.color.set(n > 0.5 ? "#e8eefc" : "#fff3c4");
  });
  return (
    <group>
      <ambientLight ref={amb} color="#fff1dc" intensity={0.3} />
      <directionalLight ref={sun} position={[7, 9, 4]} color="#fff1d0" intensity={1} />
      <directionalLight ref={moon} position={[-6, 8, -6]} color="#9db7ff" intensity={0} />
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[12, seg]} />
        <meshStandardMaterial map={planks} roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.006, 0]} rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[4.5, seg]} />
        <meshStandardMaterial color="#3f1d1d" roughness={1} />
      </mesh>
      <mesh position={[0, 4, 0]}>
        <cylinderGeometry args={[9.6, 9.6, 8, seg, 1, true]} />
        <meshStandardMaterial map={planks} color="#a0806a" roughness={0.9} side={THREE.BackSide} />
      </mesh>
      {/* windows showing the sky */}
      {Array.from({ length: 6 }, (_, i) => {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
        return (
          <group key={i} position={[Math.sin(a) * 9.5, 0, Math.cos(a) * 9.5]} rotation-y={a + Math.PI}>
            <mesh position={[0, 3.2, 0]}>
              <planeGeometry args={[2.2, 2.0]} />
              <meshBasicMaterial
                ref={(m) => {
                  if (m) sky.current[i] = m;
                }}
                color="#8ec5ff"
                fog={false}
              />
            </mesh>
            {/* mullions */}
            <mesh position={[0, 3.2, 0.02]}>
              <planeGeometry args={[0.08, 2.0]} />
              <meshStandardMaterial color="#3b2412" />
            </mesh>
            <mesh position={[0, 3.2, 0.02]}>
              <planeGeometry args={[2.2, 0.08]} />
              <meshStandardMaterial color="#3b2412" />
            </mesh>
            {i === 1 && (
              <mesh position={[0.4, 3.6, -0.05]}>
                <circleGeometry args={[0.28, 24]} />
                <meshBasicMaterial ref={orb} color="#fff3c4" fog={false} />
              </mesh>
            )}
          </group>
        );
      })}
      {/* notice board with wanted posters */}
      <group position={[0, 2.4, -9.4]}>
        <mesh>
          <boxGeometry args={[2.6, 1.6, 0.08]} />
          <meshStandardMaterial color="#5a3a1e" roughness={0.8} />
        </mesh>
        {[-0.8, 0, 0.8].map((x, i) => (
          <mesh key={i} position={[x, 0, 0.05]} rotation-z={(i - 1) * 0.06}>
            <planeGeometry args={[0.6, 0.8]} />
            <meshStandardMaterial color="#e7d8b5" roughness={0.9} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/** Spotlight cone + pool on the accused during the defence / vote. */
function Spotlight({ seat }: { seat: number }) {
  const geo = useTableGeo();
  const pos = seat === geo.viewerSeat ? geo.spotOf(seat, -0.1) : geo.spotOf(seat, -0.72);
  const pool = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (pool.current) pool.current.opacity = 0.35 + Math.sin(clock.elapsedTime * 3) * 0.1;
  });
  return (
    <group position={[pos.x, 0, pos.z]}>
      <mesh position={[0, 0.02, 0]} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[0.75, 32]} />
        <meshBasicMaterial ref={pool} color="#fde68a" transparent opacity={0.35} depthWrite={false} />
      </mesh>
      <mesh position={[0, 2.3, 0]}>
        <coneGeometry args={[0.8, 4.6, 24, 1, true]} />
        <meshBasicMaterial color="#fff7d6" transparent opacity={0.08} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <pointLight position={[0, 3, 0]} color="#fff1c2" intensity={10} distance={5} decay={1.5} />
    </group>
  );
}

const SIGN_STYLE: BubbleStyle = { bg: "rgba(28,10,10,0.92)", fg: "#fde68a", border: "#b91c1c", size: 42 };

function CenterSign({ text, night }: { text: string; night: boolean }) {
  return (
    <group>
      {/* a candle that's the only light at night */}
      <mesh position={[0, 0.09, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 0.18, 12]} />
        <meshStandardMaterial color="#f5f0e1" />
      </mesh>
      <mesh position={[0, 0.22, 0]}>
        <coneGeometry args={[0.025, 0.07, 8]} />
        <meshBasicMaterial color="#ffc46b" />
      </mesh>
      <pointLight position={[0, 0.35, 0]} color="#ffb35c" intensity={night ? 3 : 0.6} distance={4} decay={2} />
      <TableSign text={text} style={SIGN_STYLE} y={0.95} width={1.15} />
    </group>
  );
}

// ---------------------------------------------------------------------------

const THEME: TableTheme = {
  background: "#0e0b0b",
  fog: [10, 26],
  ambient: ["#ffe7d1", 0.12],
  hemi: ["#ffe2c2", "#120a0a", 0.3],
  fills: [],
  lamp: { color: "#ffd9a0", intensity: 18, height: 3.3 },
  table: { top: "#3b2412", rim: "#2a170b", felt: "#4a1515", inlay: "#b8892c", base: "#1f1208" },
  chair: "wood",
  chairColor: "#3f2a1d",
  seatColors: SEAT_COLORS,
  hats: ["fedora", "none", "cap", "bowler", "none", "beret", "fedora", "none"],
};

const CHAT: BubbleStyle = { bg: "rgba(255,255,255,0.96)", fg: "#1c1917", border: "#a8a29e" };
const SLEEP: BubbleStyle = { bg: "rgba(30,41,82,0.9)", fg: "#e0e7ff", border: "#6366f1" };

export default function MafiaTable3D(props: MafiaTable3DProps) {
  const { playerCount: n, viewerSeat, night, phase } = props;
  const suspect = props.seats.find((s) => s.isSuspect)?.seat ?? null;

  const seats: TableSeat[] = props.seats.map((s) => {
    let mood: PersonMood = "rest";
    let lookSeat: TableSeat["lookSeat"] = suspect !== null && suspect !== s.seat ? suspect : props.focusSeat !== null && props.focusSeat !== s.seat ? props.focusSeat : "center";
    let bubble: TableSeat["bubble"] = null;
    if (!s.alive) mood = "slump";
    else if (night) {
      mood = "slump";
      lookSeat = null;
      bubble = { text: "💤", style: SLEEP, key: `z${phase}`, width: 0.32 };
    } else {
      if (s.isSuspect) mood = phase === "defense" ? "talk" : "nervous";
      else if (s.acted) mood = "raise";
      else if (phase === "dayDiscuss" || phase === "nomination") mood = "think";
      if (props.focusSeat !== null && props.focusSeat !== s.seat && (phase === "execution" || phase === "dayAnnounce")) mood = "shock";
      if (s.chat) {
        bubble = { text: s.chat.text, style: CHAT, key: s.chat.key, width: 1.05 };
        if (!s.isSuspect && !s.acted) mood = "talk";
      }
    }
    return {
      seat: s.seat,
      name: s.name,
      away: s.disconnected,
      sub: s.alive ? null : "👻 유령",
      mood,
      lookSeat,
      out: !s.alive,
      tag: s.isSuspect ? { text: "🎤 최후 변론", color: "#f59e0b" } : s.tag,
      bubble,
      headSlot: null,
      front: (
        <group>
          <group position={[0, 0, -0.02]}>
            {s.roleCard ? (
              <PopIn>
                <FlatCard face={roleTexture(s.roleCard)} back={roleTexture(null)} w={0.2} h={0.28} glow={s.roleCard.mafia ? "#ef4444" : "#3b82f6"} />
              </PopIn>
            ) : (
              <FlatCard face={null} back={roleTexture(null)} w={0.2} h={0.28} />
            )}
          </group>
          {s.acted && !night && (
            <group position={[0.22, 0, 0]}>
              <FloatIcon icon="✋" y={0.12} size={0.16} bob={0.02} />
            </group>
          )}
        </group>
      ),
    };
  });

  return (
    <TableScene
      cameraKey="mafia-camera"
      seatCount={n}
      viewerSeat={viewerSeat}
      seats={seats}
      theme={THEME}
      environment={<VillageHall night={night} lowDetail={props.lowDetail} />}
      center={<CenterSign text={props.sign} night={night} />}
      extras={suspect !== null && !night ? <Spotlight seat={suspect} /> : null}
      overview={props.overview}
      lowDetail={props.lowDetail}
      ringColor="#ef4444"
      lampDim={night ? 0.3 : 1}
    />
  );
}
