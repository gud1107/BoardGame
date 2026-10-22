"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import TableScene, { useTableGeo, type TableSeat, type TableTheme } from "@/games/shared/three/TableScene";
import { CoinStack, FlatCard, FlyIn, ImpactRing, StandingCard } from "@/games/shared/three/tablePieces";
import { bubbleTexture, paintedTexture, FONTS, type BubbleStyle } from "@/games/shared/three/tableKit";
import type { PersonMood } from "@/games/shared/three/SeatedPerson";
import { PORTRAIT } from "../CardArt";
import { CHARACTER_EMOJI, CHARACTER_NAMES, type Character } from "../engine";

/**
 * 쿠 3D — 르네상스 궁정의 밀실. 각자 앞에 영향력 카드 2장이 세워져 있고
 * (남의 카드는 뒷면만, 내 카드는 나를 향해 앞면), 잃은 카드는 앞면으로
 * 테이블에 눕는다. 코인은 금화 더미로 쌓이고, 가운데엔 국고와 궁정 덱.
 * 선언/방어/의심은 말풍선과 동작으로, 공격 대상에겐 붉은 화살표가 뻗는다.
 *
 * 보드가 `getPlayerView`로 가린 카드만 넘긴다(내 영향력 + 모두의 공개 카드).
 * 남의 숨은 카드는 장수만 이 장면에 들어온다.
 */

export interface CoupSeat3D {
  seat: number;
  /** 연결 끊김(봇 대체 전). */
  away?: boolean;
  name: string;
  coins: number;
  /** 숨은 영향력 장수. */
  hiddenCount: number;
  /** 내가 볼 수 있는 숨은 카드(내 자리만). */
  myCards: Character[] | null;
  /** 앞면으로 잃은 카드(공개). */
  lost: Character[];
}

export type CoupBeat =
  | { kind: "declare"; seat: number; label: string; target: number | null; claim: Character | null }
  | { kind: "challenge"; challenger: number; accused: number; caught: boolean; character: Character }
  | { kind: "block"; seat: number; actor: number; character: Character }
  | { kind: "resolved"; seat: number; target: number | null; label: string; blocked: boolean; coins: number }
  | { kind: "lost"; seat: number; character: Character }
  | { kind: "other"; seat: number; label: string };

export interface CoupTable3DProps {
  playerCount: number;
  viewerSeat: number;
  seats: CoupSeat3D[];
  activeSeat: number;
  /** 지금 대답(의심/방어/패스)을 기다리는 좌석. */
  awaiting: number[];
  /** 진행 중인 공격 액션의 대상(화살표). */
  attack: { from: number; to: number; color: string } | null;
  beat: CoupBeat | null;
  /** 말풍선 재생 키(이벤트가 바뀔 때마다 새로 튀어나오게). */
  beatKey: string;
  deckCount: number;
  sign: string;
  overview: boolean;
  lowDetail: boolean;
}

const SEAT_COLORS = ["#f59e0b", "#60a5fa", "#4ade80", "#f472b6", "#a78bfa", "#22d3ee"];

const CHAR_COLORS: Record<Character, [string, string, string]> = {
  duke: ["#6b1a68", "#1a051a", "#f0abfc"],
  assassin: ["#2c323c", "#08090c", "#cbd5e1"],
  contessa: ["#7a2c14", "#180803", "#fdba74"],
  captain: ["#1a4366", "#06121c", "#7dd3fc"],
  ambassador: ["#6b4616", "#160f04", "#fcd34d"],
};

const portraitRequested = new Set<Character>();

/**
 * Repaints a cached card texture with the same oil portrait as the 2D hand
 * (`CardArt.tsx` PORTRAIT) once the image loads; until then, or if it fails,
 * the emoji face below stays on the card.
 */
function paintPortrait(t: THREE.CanvasTexture, c: Character) {
  const src = PORTRAIT[c];
  if (!src || portraitRequested.has(c)) return;
  portraitRequested.add(c);
  const img = new Image();
  img.onload = () => {
    const canvas = t.image as HTMLCanvasElement;
    const ctx = canvas.getContext("2d")!;
    const W = canvas.width;
    const H = canvas.height;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(4, 4, W - 8, H - 8, 20);
    ctx.clip();
    // object-fit: cover, focused on the face (same 18% as the 2D card)
    const scale = Math.max(W / img.width, H / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    ctx.drawImage(img, (W - dw) / 2, (H - dh) * 0.18, dw, dh);
    const shade = ctx.createLinearGradient(0, H * 0.6, 0, H);
    shade.addColorStop(0, "rgba(0,0,0,0)");
    shade.addColorStop(1, "rgba(0,0,0,0.85)");
    ctx.fillStyle = shade;
    ctx.fillRect(0, H * 0.6, W, H * 0.4);
    ctx.restore();
    ctx.strokeStyle = CHAR_COLORS[c][2];
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.roundRect(9, 9, W - 18, H - 18, 16);
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#fef3c7";
    ctx.font = `800 44px ${FONTS.text}`;
    ctx.shadowColor = "#000";
    ctx.shadowBlur = 6;
    ctx.fillText(CHARACTER_NAMES[c], W / 2, H - 50);
    ctx.shadowBlur = 0;
    t.needsUpdate = true;
  };
  img.src = src;
}

function characterTexture(c: Character): THREE.CanvasTexture {
  const t = emojiCharacterTexture(c);
  paintPortrait(t, c);
  return t;
}

function emojiCharacterTexture(c: Character): THREE.CanvasTexture {
  return paintedTexture(`coup:${c}`, 256, 360, (ctx, W, H) => {
    const [a, b, edge] = CHAR_COLORS[c];
    ctx.beginPath();
    ctx.roundRect(4, 4, W - 8, H - 8, 20);
    ctx.save();
    ctx.clip();
    const g = ctx.createLinearGradient(0, 0, W * 0.5, H);
    g.addColorStop(0, a);
    g.addColorStop(1, b);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // portrait arch
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    ctx.beginPath();
    ctx.moveTo(40, 250);
    ctx.lineTo(40, 110);
    ctx.arc(W / 2, 110, W / 2 - 40, Math.PI, 0);
    ctx.lineTo(W - 40, 250);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = edge;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.roundRect(9, 9, W - 18, H - 18, 16);
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `118px ${FONTS.emoji}`;
    ctx.fillText(CHARACTER_EMOJI[c], W / 2, 160);
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(16, H - 92, W - 32, 62);
    ctx.fillStyle = "#fef3c7";
    ctx.font = `800 44px ${FONTS.text}`;
    ctx.fillText(CHARACTER_NAMES[c], W / 2, H - 60);
  });
}

function backTexture(): THREE.CanvasTexture {
  return paintedTexture("coup:back", 256, 360, (ctx, W, H) => {
    ctx.beginPath();
    ctx.roundRect(4, 4, W - 8, H - 8, 20);
    ctx.save();
    ctx.clip();
    const g = ctx.createRadialGradient(W / 2, H / 2, 20, W / 2, H / 2, H * 0.7);
    g.addColorStop(0, "#5a1414");
    g.addColorStop(1, "#1a0505");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(233,185,73,0.3)";
    ctx.lineWidth = 2;
    for (let i = -H; i < W + H; i += 18) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + H, H);
      ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = "#e9b949";
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.roundRect(10, 10, W - 20, H - 20, 16);
    ctx.stroke();
    ctx.fillStyle = "#e9b949";
    ctx.font = `900 64px ${FONTS.text}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("COUP", W / 2, H / 2);
  });
}

// ---------------------------------------------------------------------------
// Palazzo
// ---------------------------------------------------------------------------

function damaskTexture(): THREE.Texture {
  const t = paintedTexture("coup:damask", 256, 256, (ctx, W) => {
    ctx.fillStyle = "#5a1018";
    ctx.fillRect(0, 0, W, W);
    ctx.fillStyle = "rgba(233,185,73,0.16)";
    for (const [x, y] of [
      [W / 2, W / 2],
      [0, 0],
      [W, 0],
      [0, W],
      [W, W],
    ]) {
      ctx.beginPath();
      ctx.ellipse(x, y, 34, 58, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x, y, 58, 24, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(14, 3);
  return t;
}

function Portrait({ hue }: { hue: string }) {
  return (
    <group>
      <mesh>
        <boxGeometry args={[1.25, 1.6, 0.08]} />
        <meshStandardMaterial color="#b8892c" metalness={0.8} roughness={0.35} />
      </mesh>
      <mesh position={[0, 0, 0.045]}>
        <planeGeometry args={[1.02, 1.36]} />
        <meshStandardMaterial color={hue} roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.12, 0.05]}>
        <circleGeometry args={[0.22, 20]} />
        <meshStandardMaterial color="#d9b08c" roughness={0.9} />
      </mesh>
      <mesh position={[0, -0.38, 0.05]}>
        <circleGeometry args={[0.42, 20, 0, Math.PI]} />
        <meshStandardMaterial color="#1c1917" roughness={0.9} />
      </mesh>
    </group>
  );
}

function Candelabra({ position, light }: { position: [number, number, number]; light: boolean }) {
  const flames = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    flames.current?.children.forEach((c, i) => c.scale.set(1, 1 + Math.sin(clock.elapsedTime * (13 + i) + i) * 0.15, 1));
  });
  const gold = <meshStandardMaterial color="#c9a13a" metalness={0.85} roughness={0.3} />;
  return (
    <group position={position}>
      <mesh position={[0, 0.7, 0]}>
        <cylinderGeometry args={[0.03, 0.12, 1.4, 10]} />
        {gold}
      </mesh>
      <mesh position={[0, 1.4, 0]}>
        <boxGeometry args={[0.6, 0.03, 0.03]} />
        {gold}
      </mesh>
      <group ref={flames}>
        {[-0.28, 0, 0.28].map((x, i) => (
          <mesh key={i} position={[x, 1.55, 0]}>
            <coneGeometry args={[0.03, 0.09, 8]} />
            <meshBasicMaterial color="#ffd27a" />
          </mesh>
        ))}
      </group>
      {[-0.28, 0, 0.28].map((x, i) => (
        <mesh key={i} position={[x, 1.46, 0]}>
          <cylinderGeometry args={[0.022, 0.022, 0.12, 8]} />
          <meshStandardMaterial color="#fef3c7" />
        </mesh>
      ))}
      {light && <pointLight position={[0, 1.7, 0]} color="#ffb85a" intensity={4} distance={6} decay={2} />}
    </group>
  );
}

function Palazzo({ lowDetail }: { lowDetail: boolean }) {
  const seg = lowDetail ? 24 : 48;
  const damask = useMemo(() => damaskTexture(), []);
  const parquet = useMemo(() => {
    const t = paintedTexture("coup:parquet", 256, 256, (ctx) => {
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++) {
          const v = 70 + ((x * 31 + y * 17) % 30);
          ctx.fillStyle = `rgb(${v + 40},${v + 14},${v - 18})`;
          ctx.fillRect(x * 32, y * 32, 32, 32);
          ctx.strokeStyle = "rgba(0,0,0,0.25)";
          ctx.strokeRect(x * 32, y * 32, 32, 32);
        }
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(8, 8);
    return t;
  }, []);
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[12, seg]} />
        <meshStandardMaterial map={parquet} roughness={0.55} />
      </mesh>
      <mesh position={[0, 0.006, 0]} rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[4.3, seg]} />
        <meshStandardMaterial color="#4a0d14" roughness={1} />
      </mesh>
      <mesh position={[0, 0.008, 0]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[4.0, 4.2, seg]} />
        <meshStandardMaterial color="#c9a13a" roughness={0.5} metalness={0.6} />
      </mesh>
      <mesh position={[0, 4, 0]}>
        <cylinderGeometry args={[9.5, 9.5, 8, seg, 1, true]} />
        <meshStandardMaterial map={damask} roughness={0.9} side={THREE.BackSide} />
      </mesh>
      {/* wainscot */}
      <mesh position={[0, 0.6, 0]}>
        <cylinderGeometry args={[9.45, 9.45, 1.2, seg, 1, true]} />
        <meshStandardMaterial color="#2b170c" roughness={0.6} side={THREE.BackSide} />
      </mesh>
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
        return (
          <group key={i} position={[Math.sin(a) * 9.35, 0, Math.cos(a) * 9.35]} rotation-y={a + Math.PI}>
            <group position={[0, 2.9, 0]}>
              <Portrait hue={["#1e3a2e", "#2a1e3a", "#3a2a1e", "#1e2a3a"][i % 4]} />
            </group>
            <Candelabra position={[1.6, 0, 0.3]} light={!lowDetail && i % 4 === 0} />
          </group>
        );
      })}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Table props
// ---------------------------------------------------------------------------

function InfluenceCards({ seat }: { seat: CoupSeat3D }) {
  const back = backTexture();
  const hidden = seat.myCards ? seat.myCards.map((c) => characterTexture(c)) : Array.from({ length: seat.hiddenCount }, () => null);
  return (
    <group>
      {hidden.map((tex, i) => (
        <group key={`h${i}`} position={[(i - (hidden.length - 1) / 2) * 0.22 - 0.06, 0, 0.02]} rotation-y={(i - (hidden.length - 1) / 2) * -0.12}>
          <StandingCard face={tex} back={back} w={0.2} h={0.28} tilt={seat.myCards ? -0.5 : -0.25} />
        </group>
      ))}
      {seat.lost.map((c, i) => (
        <group key={`l${i}`} position={[-0.42 - i * 0.05, 0, 0.12 - i * 0.03]} rotation-y={0.3 + i * 0.15}>
          <PopInCard face={characterTexture(c)} back={back} />
        </group>
      ))}
      <group position={[0.36, 0, 0.06]}>
        <CoinStack count={seat.coins} />
      </group>
    </group>
  );
}

/** A lost card flips down onto the table and is struck through. */
function PopInCard({ face, back }: { face: THREE.Texture; back: THREE.Texture }) {
  return (
    <FlyIn from={new THREE.Vector3(0.3, 0.35, 0)} dur={0.45} arc={0.15} spin={Math.PI}>
      <FlatCard face={face} back={back} w={0.17} h={0.24} />
      <mesh position={[0, 0.009, 0]} rotation={[-Math.PI / 2, 0, 0.6]}>
        <planeGeometry args={[0.28, 0.025]} />
        <meshBasicMaterial color="#dc2626" />
      </mesh>
    </FlyIn>
  );
}

function AttackArrow({ from, to, color }: { from: number; to: number; color: string }) {
  const geo = useTableGeo();
  const { mid, len, yaw } = useMemo(() => {
    const a = geo.spotOf(from, 0.55);
    const b = geo.spotOf(to, 0.55);
    const d = b.clone().sub(a);
    return { mid: a.clone().add(d.clone().multiplyScalar(0.5)), len: d.length(), yaw: Math.atan2(d.x, d.z) };
  }, [geo, from, to]);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  const head = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const p = (clock.elapsedTime * 0.8) % 1;
    if (mat.current) mat.current.opacity = 0.55 + Math.sin(clock.elapsedTime * 6) * 0.25;
    if (head.current) head.current.position.z = -len / 2 + 0.1 + p * (len - 0.2);
  });
  return (
    <group position={[mid.x, geo.tableY + 0.03, mid.z]} rotation-y={yaw}>
      <mesh rotation-x={-Math.PI / 2}>
        <planeGeometry args={[0.04, Math.max(0.05, len - 0.2)]} />
        <meshBasicMaterial ref={mat} color={color} transparent opacity={0.7} depthWrite={false} />
      </mesh>
      <mesh ref={head} rotation-x={Math.PI / 2}>
        <coneGeometry args={[0.07, 0.18, 3]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh position={[0, 0, len / 2 - 0.08]} rotation-x={Math.PI / 2}>
        <coneGeometry args={[0.09, 0.2, 3]} />
        <meshBasicMaterial color={color} />
      </mesh>
    </group>
  );
}

/** Treasury coins + the face-down court deck in the middle. */
function Treasury({ deckCount, sign, beatKey, flash }: { deckCount: number; sign: string; beatKey: string; flash: string | null }) {
  const back = backTexture();
  const { tex, aspect } = useMemo(() => bubbleTexture(sign, SIGN_STYLE), [sign]);
  const ref = useRef<THREE.Sprite>(null);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.position.y = 0.95 + Math.sin(clock.elapsedTime * 1.3) * 0.03;
  });
  return (
    <group>
      <group position={[-0.2, 0, 0]}>
        {Array.from({ length: Math.min(deckCount, 15) }, (_, i) => (
          <group key={i} position={[0, i * 0.007, 0]} rotation-y={Math.sin(i * 7.1) * 0.05}>
            <FlatCard face={null} back={back} w={0.2} h={0.28} lift={0} />
          </group>
        ))}
      </group>
      <group position={[0.24, 0, 0.02]}>
        <CoinStack count={30} />
      </group>
      <group position={[0.3, 0, -0.16]}>
        <CoinStack count={14} />
      </group>
      {flash && <ImpactRing key={beatKey} color={flash} size={1.2} />}
      <sprite ref={ref} position={[0, 0.95, 0]} scale={[1.2, 1.2 * aspect, 1]} renderOrder={9}>
        <spriteMaterial map={tex} transparent depthWrite={false} depthTest={false} />
      </sprite>
    </group>
  );
}

// ---------------------------------------------------------------------------

const SIGN_STYLE: BubbleStyle = { bg: "rgba(40,10,10,0.92)", fg: "#fde68a", border: "#c9a13a", size: 40 };
const SAY: BubbleStyle = { bg: "rgba(255,251,235,0.97)", fg: "#451a03", border: "#f59e0b" };
const DOUBT: BubbleStyle = { bg: "rgba(127,29,29,0.95)", fg: "#fff1f2", border: "#fecaca", size: 54 };
const BLOCK: BubbleStyle = { bg: "rgba(30,58,138,0.95)", fg: "#eff6ff", border: "#93c5fd" };
const LOSS: BubbleStyle = { bg: "rgba(24,24,27,0.95)", fg: "#fafafa", border: "#71717a" };

const THEME: TableTheme = {
  background: "#160a0a",
  fog: [9, 22],
  ambient: ["#ffd7b0", 0.28],
  hemi: ["#ffe1c4", "#200a0a", 0.4],
  fills: [["#ffb07a", 0.3, -5, 6, -5]],
  lamp: { color: "#ffd39a", intensity: 24, height: 3.2 },
  table: { top: "#123d2a", rim: "#3a1d0e", felt: "#0f3b28", inlay: "#c9a13a", base: "#241207" },
  chair: "wood",
  chairColor: "#5a1a1a",
  seatColors: SEAT_COLORS,
  hats: ["fedora", "none", "beret", "bowler", "none", "beret"],
};

export default function CoupTable3D(props: CoupTable3DProps) {
  const { playerCount: n, viewerSeat, beat, awaiting, activeSeat } = props;

  const seats: TableSeat[] = props.seats.map((s) => {
    const out = s.hiddenCount === 0;
    let mood: PersonMood = "rest";
    let lookSeat: TableSeat["lookSeat"] = activeSeat !== s.seat ? activeSeat : "center";
    let bubble: TableSeat["bubble"] = null;
    if (awaiting.includes(s.seat)) mood = "think";
    if (props.attack?.to === s.seat) {
      mood = "nervous";
      lookSeat = props.attack.from;
    }
    if (beat) {
      switch (beat.kind) {
        case "declare":
          if (beat.seat === s.seat) {
            mood = beat.target !== null ? "point" : "talk";
            lookSeat = beat.target ?? "center";
            bubble = { text: beat.label, style: SAY, key: props.beatKey, width: 0.95 };
          }
          break;
        case "challenge":
          if (beat.challenger === s.seat) {
            mood = beat.caught ? "laugh" : "shock";
            lookSeat = beat.accused;
            bubble = { text: "의심! 🤨", style: DOUBT, key: props.beatKey, width: 0.62 };
          } else if (beat.accused === s.seat) {
            mood = beat.caught ? "sad" : "smug";
            bubble = { text: beat.caught ? `(${CHARACTER_NAMES[beat.character]} 없음…)` : `진짜 ${CHARACTER_NAMES[beat.character]}! ${CHARACTER_EMOJI[beat.character]}`, style: beat.caught ? LOSS : SAY, key: `${props.beatKey}a`, width: 0.9 };
          }
          break;
        case "block":
          if (beat.seat === s.seat) {
            mood = "raise";
            lookSeat = beat.actor;
            bubble = { text: `${CHARACTER_EMOJI[beat.character]} ${CHARACTER_NAMES[beat.character]}(으)로 방어!`, style: BLOCK, key: props.beatKey, width: 0.95 };
          } else if (beat.actor === s.seat) mood = "shrug";
          break;
        case "resolved":
          if (beat.seat === s.seat) {
            mood = beat.blocked ? "sad" : "smug";
            if (!beat.blocked && beat.coins > 0) bubble = { text: `+${beat.coins} 🪙`, style: SAY, key: props.beatKey, width: 0.5 };
          } else if (beat.target === s.seat && !beat.blocked) mood = "sad";
          break;
        case "lost":
          if (beat.seat === s.seat) {
            mood = out ? "slump" : "shock";
            bubble = { text: `💀 ${CHARACTER_NAMES[beat.character]} 잃음`, style: LOSS, key: props.beatKey, width: 0.8 };
          }
          break;
        case "other":
          if (beat.seat === s.seat) bubble = { text: beat.label, style: SAY, key: props.beatKey, width: 0.8 };
          break;
      }
    }
    return {
      seat: s.seat,
      name: s.name,
      away: s.away,
      sub: out ? "💀 탈락" : `🪙 ${s.coins} · 🂠 ${s.hiddenCount}`,
      mood,
      lookSeat,
      out,
      active: activeSeat === s.seat && !out,
      ring: awaiting.includes(s.seat) ? "#f59e0b" : null,
      tag: s.seat === viewerSeat ? { text: `🪙 ${s.coins}코인 · 영향력 ${s.hiddenCount}`, color: "#c9a13a" } : s.coins >= 10 && !out ? { text: "⚠️ 쿠데타 필수", color: "#ef4444" } : null,
      bubble,
      front: <InfluenceCards seat={s} />,
    };
  });

  const flash = beat?.kind === "lost" ? "#ef4444" : beat?.kind === "challenge" ? "#f97316" : beat?.kind === "block" ? "#60a5fa" : null;

  return (
    <TableScene
      seatCount={n}
      viewerSeat={viewerSeat}
      seats={seats}
      theme={THEME}
      environment={<Palazzo lowDetail={props.lowDetail} />}
      center={<Treasury deckCount={props.deckCount} sign={props.sign} beatKey={props.beatKey} flash={flash} />}
      extras={props.attack ? <AttackArrow from={props.attack.from} to={props.attack.to} color={props.attack.color} /> : null}
      overview={props.overview}
      lowDetail={props.lowDetail}
    />
  );
}
