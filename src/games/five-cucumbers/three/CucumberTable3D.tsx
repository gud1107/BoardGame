"use client";

import * as THREE from "three";
import TableScene, { useTableGeo, type TableSeat, type TableTheme } from "@/games/shared/three/TableScene";
import { HeldFan, FlatCard, FlyIn, ImpactRing, PopIn, TableSign } from "@/games/shared/three/tablePieces";
import { OutdoorPlaza } from "@/games/shared/three/environments";
import { simpleBackTexture, simpleCardTexture, type BubbleStyle } from "@/games/shared/three/tableKit";
import type { PersonMood } from "@/games/shared/three/SeatedPerson";

/**
 * 5 오이 3D — 해 질 녘 텃밭 옆 나무 테이블. 각자 손패는 뒷면 부채꼴(장수만),
 * 낸 카드는 그 자리에서 가운데로 날아와 앞면으로 눕고, 트릭을 가져간 사람의
 * 카드가 빛난다. 각자 앞에는 먹은 오이가 실제 오이 모양으로 쌓이고(탈락 기준이
 * 가까우면 땀), 마지막 7번째 트릭은 붉은 경고 팻말.
 */

export interface CucumberSeat3D {
  seat: number;
  name: string;
  handCount: number;
  cucumbers: number;
  eliminated: boolean;
  away?: boolean;
}

export interface CucumberTable3DProps {
  playerCount: number;
  viewerSeat: number;
  seats: CucumberSeat3D[];
  activeSeat: number | null;
  plays: { seat: number; value: number; id: string }[];
  winnerSeat: number | null;
  finalTrick: boolean;
  trickNumber: number;
  roundNumber: number;
  threshold: number;
  overview: boolean;
  lowDetail: boolean;
}

const SEAT_COLORS = ["#4ade80", "#fbbf24", "#38bdf8", "#f472b6", "#a78bfa", "#fb923c"];
const back = () => simpleBackTexture("cucumber", "#166534", "#052e16", "#bbf7d0", "🥒");
const face = (v: number) =>
  simpleCardTexture(`cucumber:${v}`, {
    big: String(v),
    corner: String(v),
    caption: v === 1 ? "×2 배수!" : "🥒".repeat(Math.min(5, Math.ceil(v / 3))),
    bg: v === 1 ? ["#b91c1c", "#450a0a"] : v >= 12 ? ["#a16207", "#3f2a04"] : ["#15803d", "#052e16"],
    edge: "#dcfce7",
  });

const cucumberGeo = new THREE.CapsuleGeometry(0.03, 0.12, 4, 8);

function Cucumbers({ count, threshold }: { count: number; threshold: number }) {
  return (
    <group>
      {Array.from({ length: Math.min(count, 12) }, (_, i) => (
        <mesh key={i} geometry={cucumberGeo} position={[(i % 4) * 0.07 - 0.1, 0.03 + Math.floor(i / 4) * 0.055, Math.sin(i * 3.1) * 0.02]} rotation={[0, Math.sin(i * 5.3) * 0.4, Math.PI / 2]} castShadow>
          <meshStandardMaterial color={count >= threshold - 1 ? "#4d7c0f" : "#16a34a"} roughness={0.55} />
        </mesh>
      ))}
    </group>
  );
}

// big enough to read the number from my seat; a full 6-card trick overlaps a little
const TRICK_CARD_W = 0.66;
const TRICK_CARD_H = 0.92;

/**
 * The trick, laid out for the viewer: one left-to-right row in play order,
 * every card upright from my seat (not turned toward whoever played it),
 * pushed past the centre so my own 🥒 tag (floating over my edge) doesn't cover it.
 */
function Trick({ plays, winnerSeat }: { plays: CucumberTable3DProps["plays"]; winnerSeat: number | null }) {
  const geo = useTableGeo();
  const facing = geo.angleOf(geo.viewerSeat);
  const right = new THREE.Vector3(Math.cos(facing), 0, -Math.sin(facing));
  const toward = new THREE.Vector3(Math.sin(facing), 0, Math.cos(facing));
  const gap = Math.min(TRICK_CARD_W + 0.04, (geo.tableR * 1.4) / Math.max(1, plays.length - 1));
  return (
    <group>
      {plays.map((p, i) => {
        const slot = right
          .clone()
          .multiplyScalar((i - (plays.length - 1) / 2) * gap)
          .addScaledVector(toward, -0.2)
          .setY(0.004 + i * 0.004);
        const from = geo.spotOf(p.seat, 0.4).sub(new THREE.Vector3(slot.x, geo.tableY, slot.z));
        const win = p.seat === winnerSeat;
        return (
          <group key={p.id} position={slot.toArray()}>
            <FlyIn from={from} dur={0.45} arc={0.45}>
              <group rotation-y={facing}>
                <FlatCard face={face(p.value)} back={back()} w={TRICK_CARD_W} h={TRICK_CARD_H} glow={win ? "#fde68a" : null} />
              </group>
            </FlyIn>
            {i === plays.length - 1 && <ImpactRing color="#86efac" size={1.1} />}
          </group>
        );
      })}
    </group>
  );
}

const THEME: TableTheme = {
  background: "#2a2a3a",
  fog: [12, 34],
  ambient: ["#fff0d6", 0.38],
  hemi: ["#ffe2b0", "#1a2414", 0.55],
  fills: [
    ["#ffb070", 0.7, -10, 5, -12],
    ["#c7d2fe", 0.2, 6, 6, 8],
  ],
  lamp: { color: "#fff1d0", intensity: 14, height: 3.4 },
  table: { top: "#7a5230", rim: "#5a3a1e", felt: "#6b4a2a", inlay: "#a3e635", base: "#3a2412" },
  chair: "wood",
  chairColor: "#6b4a2a",
  seatColors: SEAT_COLORS,
  hats: ["none", "cap", "none", "beret", "none", "none"],
};

const SIGN: BubbleStyle = { bg: "rgba(20,40,20,0.9)", fg: "#ecfccb", border: "#84cc16" };
const WARN: BubbleStyle = { bg: "rgba(127,29,29,0.94)", fg: "#fff1f2", border: "#fca5a5" };
const WIN: BubbleStyle = { bg: "rgba(254,249,195,0.97)", fg: "#3f6212", border: "#a3e635" };

export default function CucumberTable3D(props: CucumberTable3DProps) {
  const { viewerSeat, activeSeat, winnerSeat } = props;
  const seats: TableSeat[] = props.seats.map((s) => {
    let mood: PersonMood = activeSeat === s.seat ? "think" : "rest";
    if (s.cucumbers >= props.threshold - 1 && !s.eliminated) mood = activeSeat === s.seat ? "nervous" : mood;
    if (winnerSeat === s.seat) mood = props.finalTrick ? "shock" : "smug";
    return {
      seat: s.seat,
      name: s.name,
      away: s.away,
      sub: s.eliminated ? "💀 탈락" : `🥒 ${s.cucumbers}/${props.threshold}`,
      mood,
      out: s.eliminated,
      lookSeat: activeSeat !== null && activeSeat !== s.seat ? activeSeat : "center",
      active: activeSeat === s.seat && !s.eliminated,
      bubble: winnerSeat === s.seat ? { text: props.finalTrick ? "오이 먹었다… 🥒" : "이 트릭은 내 거!", style: props.finalTrick ? WARN : WIN, key: `w${props.roundNumber}-${props.trickNumber}`, width: 0.78 } : null,
      tag: s.seat === viewerSeat ? { text: `🥒 내 오이 ${s.cucumbers}/${props.threshold}`, color: "#84cc16" } : null,
      held: s.seat !== viewerSeat && !s.eliminated && s.handCount > 0 ? <HeldFan count={s.handCount} back={back()} /> : null,
      front: (
        <group>
          <group position={[0.38, 0, 0.05]}>
            <Cucumbers count={s.cucumbers} threshold={props.threshold} />
          </group>
        </group>
      ),
    };
  });

  return (
    <TableScene
      seatCount={props.playerCount}
      viewerSeat={viewerSeat}
      seats={seats}
      theme={THEME}
      environment={
        <OutdoorPlaza
          lowDetail={props.lowDetail}
          ground="#3f5a2a"
          plaza="#6b5a3a"
          trim="#a3e635"
          skyline={{ kind: "trees", color: "#2f5a2a" }}
          sun={{ color: "#ffb36b", position: [-12, 4, -22], size: 2.2 }}
        />
      }
      center={
        <group>
          <Trick plays={props.plays} winnerSeat={winnerSeat} />
          <PopIn key={props.trickNumber}>
            <TableSign text={props.finalTrick ? "⚠️ 마지막 7번째 트릭 — 이기면 오이!" : `라운드 ${props.roundNumber} · 트릭 ${props.trickNumber}/7`} style={props.finalTrick ? WARN : SIGN} y={0.42} width={0.62} />
          </PopIn>
        </group>
      }
      overview={props.overview}
      lowDetail={props.lowDetail}
    />
  );
}
