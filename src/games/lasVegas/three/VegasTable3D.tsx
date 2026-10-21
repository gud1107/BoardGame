"use client";

import * as THREE from "three";
import TableScene, { useTableGeo, type TableSeat, type TableTheme } from "@/games/shared/three/TableScene";
import { Clickable, FlyIn, GlowDisc, HitBox, ImpactRing, PipDie, TableSign } from "@/games/shared/three/tablePieces";
import { OutdoorPlaza } from "@/games/shared/three/environments";
import { imageCardTexture, paintedTexture, simpleCardTexture, FONTS, type BubbleStyle } from "@/games/shared/three/tableKit";
import type { PersonMood } from "@/games/shared/three/SeatedPerson";

/**
 * 라스베가스 3D — 네온 스트립 옥상의 크랩스 테이블. 가운데 원을 따라 카지노
 * 6곳(실제 야경 사진 매트 + 번호 주사위), 각 카지노 위엔 맨 위 지폐와 놓인
 * 주사위가 주인 색으로 쌓인다. 차례인 사람이 굴린 주사위는 그 사람 앞에
 * 흩어져 보이고(공개), 내 차례면 빛나는 카지노를 눌러 그 눈의 주사위를
 * 전부 놓는다.
 */

export interface VegasCasino3D {
  number: number;
  photo: string | null;
  name: string;
  topBill: number | null;
  billCount: number;
  /** [color, count] per owner, biggest first. */
  stacks: { color: string; count: number }[];
  canPlace: boolean;
}

export interface VegasSeat3D {
  seat: number;
  name: string;
  color: string;
  diceLeft: number;
  neutralLeft: number;
  total: number;
  away?: boolean;
}

export interface VegasTable3DProps {
  playerCount: number;
  viewerSeat: number;
  seats: VegasSeat3D[];
  casinos: VegasCasino3D[];
  activeSeat: number | null;
  roll: { face: number; color: string }[] | null;
  rollKey: string;
  lastPlacement: { seat: number; casino: number; key: string } | null;
  onPlace: ((face: number) => void) | null;
  overview: boolean;
  lowDetail: boolean;
}

const RING = 0.62;
const casinoPos = (i: number) => {
  const a = Math.PI + ((i - 2.5) / 6) * Math.PI * 2;
  return new THREE.Vector3(Math.sin(a) * RING, 0, Math.cos(a) * RING);
};

function billTex(v: number) {
  return paintedTexture(`vegas:bill:${v}`, 256, 128, (ctx, W, H) => {
    ctx.fillStyle = "#3f7d4a";
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "#d9f99d";
    ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, W - 16, H - 16);
    ctx.fillStyle = "#ecfccb";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `900 54px ${FONTS.text}`;
    ctx.fillText(`$${v / 1000}K`, W / 2, H / 2 + 2);
  });
}

function Casino({ c, i }: { c: VegasCasino3D; i: number }) {
  const p = casinoPos(i);
  const mat = c.photo
    ? imageCardTexture(`vegas:${c.number}`, c.photo, { text: String(c.number), bg: "rgba(0,0,0,0.75)", fg: "#fde68a" }, "#fbbf24")
    : simpleCardTexture(`vegas:mat:${c.number}`, { big: String(c.number), caption: c.name, bg: ["#7c2d12", "#1c0a04"], edge: "#fbbf24" });
  return (
    <group position={p} rotation-y={Math.atan2(p.x, p.z) + Math.PI}>
      <Clickable onClick={null}>
        {c.canPlace && <GlowDisc color="#fde68a" r={0.2} opacity={0.55} />}
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.006, 0]} receiveShadow>
          <planeGeometry args={[0.3, 0.42]} />
          <meshStandardMaterial map={mat} roughness={0.55} />
        </mesh>
        <group position={[0, 0.006, -0.17]}>
          <PipDie value={c.number} body="#f8fafc" size={0.07} />
        </group>
        {c.topBill !== null && (
          <group position={[0, 0.01, 0.12]}>
            {Array.from({ length: Math.min(4, c.billCount) }, (_, k) => (
              <mesh key={k} rotation-x={-Math.PI / 2} position={[k * 0.006, 0.002 + k * 0.003, -k * 0.004]}>
                <planeGeometry args={[0.24, 0.12]} />
                <meshStandardMaterial map={billTex(c.topBill!)} roughness={0.8} />
              </mesh>
            ))}
          </group>
        )}
        {c.stacks.map((st, k) => (
          <group key={st.color} position={[(k - (c.stacks.length - 1) / 2) * 0.075, 0.012, 0.0]}>
            {Array.from({ length: Math.min(8, st.count) }, (_, h) => (
              <group key={h} position={[0, h * 0.05, 0]} rotation-y={h * 0.4}>
                <PipDie value={c.number} body={st.color} ink={st.color === "#9ca3af" ? "#111" : "#fff"} size={0.05} />
              </group>
            ))}
          </group>
        ))}
      </Clickable>
    </group>
  );
}

function Roll({ roll, seat, rollKey }: { roll: NonNullable<VegasTable3DProps["roll"]>; seat: number; rollKey: string }) {
  const geo = useTableGeo();
  const base = geo.spotOf(seat, 0.75);
  return (
    <group position={[base.x, geo.tableY, base.z]} rotation-y={geo.angleOf(seat)}>
      {roll.map((d, i) => {
        const x = (i % 4) * 0.09 - 0.14 + Math.sin(i * 7.7) * 0.015;
        const z = Math.floor(i / 4) * 0.09 - 0.05 + Math.cos(i * 3.1) * 0.015;
        return (
          <group key={`${rollKey}-${i}`} position={[x, 0, z]} rotation-y={Math.sin(i * 5.3) * 0.8}>
            <FlyIn from={new THREE.Vector3(0, 0.4, 0.3)} dur={0.35 + i * 0.03} arc={0.25} spin={Math.PI * 2}>
              <PipDie value={d.face} body={d.color} ink={d.color === "#9ca3af" ? "#111" : "#fff"} size={0.065} />
            </FlyIn>
          </group>
        );
      })}
    </group>
  );
}

function Casinos({ casinos, onPlace, lastPlacement }: { casinos: VegasCasino3D[]; onPlace: VegasTable3DProps["onPlace"]; lastPlacement: VegasTable3DProps["lastPlacement"] }) {
  return (
    <group>
      {casinos.map((c, i) => (
        <group key={c.number}>
          <Casino c={c} i={i} />
          {c.canPlace && onPlace && (
            <group position={casinoPos(i)}>
              <Clickable onClick={() => onPlace(c.number)}>
                <HitBox size={[0.34, 0.3, 0.46]} />
              </Clickable>
            </group>
          )}
          {lastPlacement?.casino === c.number && (
            <group key={lastPlacement.key} position={casinoPos(i)}>
              <ImpactRing color="#fde68a" size={0.5} />
            </group>
          )}
        </group>
      ))}
    </group>
  );
}

const THEME: TableTheme = {
  background: "#0b0614",
  fog: [12, 34],
  ambient: ["#ffd7f0", 0.3],
  hemi: ["#f0abfc", "#0b0614", 0.42],
  fills: [
    ["#f472b6", 0.45, -6, 5, -6],
    ["#facc15", 0.35, 6, 5, -6],
  ],
  lamp: { color: "#fff1d6", intensity: 22, height: 3.3 },
  table: { top: "#0f3b28", rim: "#4a1d0e", felt: "#0f4a32", inlay: "#fbbf24", base: "#1f0c06" },
  chair: "stool",
  chairColor: "#5a1a1a",
  seatColors: ["#ef4444", "#3b82f6", "#eab308", "#22c55e", "#a855f7"],
  hats: ["fedora", "none", "cowboy", "beret", "none"],
};

const SIGN: BubbleStyle = { bg: "rgba(20,6,30,0.9)", fg: "#fde68a", border: "#f472b6" };
const SAY: BubbleStyle = { bg: "rgba(255,251,235,0.97)", fg: "#78350f", border: "#fbbf24" };

export default function VegasTable3D(props: VegasTable3DProps) {
  const { viewerSeat, activeSeat, lastPlacement } = props;
  const seats: TableSeat[] = props.seats.map((s) => {
    let mood: PersonMood = activeSeat === s.seat ? (props.roll ? "think" : "talk") : "rest";
    if (lastPlacement?.seat === s.seat && activeSeat !== s.seat) mood = "smug";
    if (props.overview) mood = "clap";
    return {
      seat: s.seat,
      name: s.name,
      color: s.color,
      away: s.away,
      sub: `🎲 ${s.diceLeft}${s.neutralLeft ? `+${s.neutralLeft}` : ""} · 💵 $${Math.round(s.total / 1000)}K`,
      mood,
      lookSeat: activeSeat !== null && activeSeat !== s.seat ? activeSeat : "center",
      active: activeSeat === s.seat,
      bubble: lastPlacement?.seat === s.seat ? { text: `🎰 ${lastPlacement.casino}번에 배치!`, style: SAY, key: lastPlacement.key, width: 0.7 } : null,
      tag: s.seat === viewerSeat ? { text: `🎲 내 주사위 ${s.diceLeft}개`, color: s.color } : null,
      front: (
        <group position={[0.4, 0, 0.12]}>
          {Array.from({ length: Math.min(8, s.diceLeft) }, (_, i) => (
            <group key={i} position={[(i % 4) * 0.06 - 0.09, Math.floor(i / 4) * 0.05, 0]}>
              <PipDie value={1 + (i % 6)} body={s.color} ink="#fff" size={0.045} />
            </group>
          ))}
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
          ground="#120a1a"
          plaza="#1f1028"
          trim="#fbbf24"
          skyline={{ kind: "city", color: "#1a1030", cap: "#f472b6" }}
          wall="#2a1036"
        />
      }
      center={
        <group>
          <Casinos casinos={props.casinos} onPlace={props.onPlace} lastPlacement={lastPlacement} />
          <TableSign text={activeSeat !== null ? `${props.seats.find((s) => s.seat === activeSeat)?.name ?? ""} ${props.roll ? "— 놓을 눈 선택 중" : "— 굴릴 차례"}` : "정산!"} style={SIGN} y={1.0} />
        </group>
      }
      extras={props.roll && activeSeat !== null ? <Roll roll={props.roll} seat={activeSeat} rollKey={props.rollKey} /> : null}
      overview={props.overview}
      lowDetail={props.lowDetail}
      ringColor="#fbbf24"
    />
  );
}
