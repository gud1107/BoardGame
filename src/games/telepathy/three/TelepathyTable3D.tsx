"use client";

import * as THREE from "three";
import TableScene, { useTableGeo, type TableSeat, type TableTheme } from "@/games/shared/three/TableScene";
import { FlatCard, FlyIn, GlowDisc, ImpactRing, StandingCard, TableSign } from "@/games/shared/three/tablePieces";
import { IndoorRoom } from "@/games/shared/three/environments";
import { simpleBackTexture, simpleCardTexture, type BubbleStyle } from "@/games/shared/three/tableKit";
import type { PersonMood } from "@/games/shared/three/SeatedPerson";

/**
 * 텔레파시 3D — 별빛이 스미는 고요한 명상실. 말 없이 둘러앉아, 준비 단계엔
 * 모두 테이블에 손을 얹고(🖐), 누군가 내려고 손을 뻗으면 그 사람이 손을 든다.
 * 낸 카드는 그 자리에서 가운데 더미로 날아와 맨 위 숫자가 크게 보이고,
 * 실수하면 붉은 충격파와 함께 모두 놀란다. 손패는 장수만(뒷면).
 */

export interface TelepathySeat3D {
  seat: number;
  name: string;
  handCount: number;
  holding: boolean;
  reaching: boolean;
  ready: boolean;
  away: boolean;
  color: string;
}

export interface TelepathyTable3DProps {
  playerCount: number;
  viewerSeat: number;
  seats: TelepathySeat3D[];
  phase: string;
  /** 더미 위 최근 카드(최대 몇 장). */
  pile: { card: number; seat: number }[];
  mistakeId: number | null;
  lastPlaySeat: number | null;
  level: number;
  maxLevel: number;
  lives: number | null;
  stars: number | null;
  overview: boolean;
  lowDetail: boolean;
}

const back = () => simpleBackTexture("telepathy", "#4338ca", "#1e1b4b", "#c7d2fe", "📡");
// keyed by number only (≤100 textures); the seat colour shows as the glow under the card
const face = (n: number) => simpleCardTexture(`telepathy:${n}`, { big: String(n), corner: String(n), bg: ["#312e81", "#0b0a2a"], edge: "#c7d2fe" });

function Pile({ pile, colors }: { pile: TelepathyTable3DProps["pile"]; colors: Record<number, string> }) {
  const geo = useTableGeo();
  const shown = pile.slice(-5);
  const offset = pile.length - shown.length;
  return (
    <group>
      {shown.map((p, k) => {
        const i = k + offset;
        const from = geo.spotOf(p.seat, 0.4).sub(new THREE.Vector3(0, geo.tableY, 0));
        return (
          <group key={`${i}-${p.card}`} position={[0, 0.004 + k * 0.006, 0]} rotation-y={Math.sin(i * 2.7) * 0.25}>
            <FlyIn from={from} dur={0.42} arc={0.4}>
              <FlatCard face={face(p.card)} back={back()} w={0.34} h={0.48} glow={k === shown.length - 1 ? (colors[p.seat] ?? null) : null} />
            </FlyIn>
          </group>
        );
      })}
    </group>
  );
}

const THEME: TableTheme = {
  background: "#070816",
  fog: [9, 22],
  ambient: ["#c7d2fe", 0.26],
  hemi: ["#a5b4fc", "#0a0a1a", 0.4],
  fills: [["#818cf8", 0.35, -6, 6, -6]],
  lamp: { color: "#e0e7ff", intensity: 18, height: 3.2 },
  table: { top: "#1e1b4b", rim: "#2a2140", felt: "#1e1b4b", inlay: "#a5b4fc", base: "#14102a" },
  chair: "stool",
  chairColor: "#3b3366",
  seatColors: ["#f472b6", "#38bdf8", "#fbbf24", "#4ade80", "#a78bfa", "#fb923c"],
  hats: ["none"],
};

const SIGN: BubbleStyle = { bg: "rgba(12,10,40,0.9)", fg: "#e0e7ff", border: "#818cf8" };
const OOPS: BubbleStyle = { bg: "rgba(127,29,29,0.94)", fg: "#fff1f2", border: "#fca5a5" };

export default function TelepathyTable3D(props: TelepathyTable3DProps) {
  const { viewerSeat, phase } = props;
  const colors = Object.fromEntries(props.seats.map((s) => [s.seat, s.color]));
  const mistake = phase === "mistake";
  const seats: TableSeat[] = props.seats.map((s) => {
    let mood: PersonMood = "think";
    if (phase === "sync") mood = s.holding ? "clap" : "rest";
    else if (phase === "break") mood = s.ready ? "raise" : "rest";
    else if (mistake) mood = "shock";
    else if (phase === "won") mood = "cheer";
    else if (phase === "lost") mood = "sad";
    else if (s.reaching) mood = "raise";
    else if (props.lastPlaySeat === s.seat) mood = "smug";
    return {
      seat: s.seat,
      name: s.name,
      color: s.color,
      away: s.away,
      sub: s.away ? "📡 연결 대기" : phase === "sync" ? (s.holding ? "🖐 준비" : "…") : `🂠 ${s.handCount}장`,
      mood,
      out: s.handCount === 0 && phase === "playing",
      lookSeat: "center",
      ring: s.reaching ? "#facc15" : null,
      bubble: s.reaching ? { text: "✋", style: SIGN, key: `r${props.pile.length}`, width: 0.3 } : null,
      tag: s.seat === viewerSeat ? { text: `🂠 내 카드 ${s.handCount}장`, color: s.color } : null,
      front: (
        <group>
          {s.seat !== viewerSeat &&
            Array.from({ length: s.handCount }, (_, i) => (
              <group key={i} position={[(i - (s.handCount - 1) / 2) * 0.13, 0, 0.06]}>
                <StandingCard face={back()} back={back()} w={0.13} h={0.18} tilt={-0.3} />
              </group>
            ))}
          {phase === "sync" && s.holding && <GlowDisc color={s.color} r={0.16} opacity={0.5} />}
        </group>
      ),
    };
  });

  const status = `레벨 ${props.level}/${props.maxLevel}${props.lives !== null ? ` · ❤️ ${props.lives}` : ""}${props.stars !== null ? ` · ⚡ ${props.stars}` : ""}`;
  return (
    <TableScene
      seatCount={props.playerCount}
      viewerSeat={viewerSeat}
      seats={seats}
      theme={THEME}
      environment={
        <IndoorRoom
          lowDetail={props.lowDetail}
          wall="#12123a"
          floor={{ kind: "carpet", a: "#1a1840", b: "#4338ca" }}
          rug="#1e1b4b"
          trim="#a5b4fc"
          windows={{ color: "#6d7fd8", count: 4, arched: true }}
        />
      }
      center={
        <group>
          <Pile pile={props.pile} colors={colors} />
          {mistake && props.mistakeId !== null && <ImpactRing key={props.mistakeId} color="#ef4444" size={2.2} dur={1} />}
          <TableSign text={mistake ? "💔 실수! 더 낮은 카드가 있었어요" : status} style={mistake ? OOPS : SIGN} y={1.0} />
        </group>
      }
      overview={props.overview}
      lowDetail={props.lowDetail}
      ringColor="#facc15"
    />
  );
}
