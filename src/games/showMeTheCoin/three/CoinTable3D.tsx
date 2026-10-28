"use client";

import TableScene, { type TableSeat, type TableTheme } from "@/games/shared/three/TableScene";
import { CoinStack, PopIn, TableSign } from "@/games/shared/three/tablePieces";
import { IndoorRoom } from "@/games/shared/three/environments";
import { paintedTexture, FONTS, type BubbleStyle } from "@/games/shared/three/tableKit";
import type { PersonMood } from "@/games/shared/three/SeatedPerson";

/**
 * 쇼미더코인 3D — 네온이 번지는 지하 금고 스튜디오, 둘이 마주 앉는다. 각자
 * 앞엔 보라색 베팅칩 더미와 가림판. 가림판 뒤에 숫자 코인을 밀어 넣으면
 * 개수 공개 단계에 그 개수만큼 엎은 금화가 앞으로 나오고, 쇼다운에야 앞면
 * (500/100/50/10)이 드러난다. 가운데는 팟.
 *
 * 숫자 코인의 값은 쇼다운 전까지 이 장면에 들어오지 않는다(개수만).
 */

export interface CoinSeat3D {
  seat: number;
  name: string;
  chips: number;
  coinsLeft: number;
  /** 이번 라운드 제출 개수(공개 단계부터) — null = 아직/비공개. */
  committedCount: number | null;
  /** 쇼다운 때만 값. */
  committedValues: number[] | null;
  bet: number;
  dealer: boolean;
  away?: boolean;
}

export interface CoinTable3DProps {
  viewerSeat: number;
  seats: CoinSeat3D[];
  phase: string;
  acting: number | null;
  pot: number;
  winner: number | null;
  folder: number | null;
  round: number;
  overview: boolean;
  lowDetail: boolean;
}

function coinFace(v: number | null) {
  return paintedTexture(`smtc:coin:${v}`, 128, 128, (ctx, W) => {
    const c = W / 2;
    const g = ctx.createRadialGradient(c - 20, c - 20, 10, c, c, c);
    g.addColorStop(0, "#fde68a");
    g.addColorStop(1, "#b45309");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c, c, c - 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#78350f";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(c, c, c - 12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#451a03";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `900 ${v === null ? 62 : v >= 100 ? 44 : 52}px ${FONTS.text}`;
    ctx.fillText(v === null ? "?" : String(v), c, c + 3);
  });
}

function Coin({ value }: { value: number | null }) {
  return (
    <group>
      <mesh position={[0, 0.012, 0]} castShadow>
        <cylinderGeometry args={[0.06, 0.06, 0.022, 24]} />
        <meshStandardMaterial color="#d4a52c" metalness={0.85} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.0235, 0]} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[0.058, 24]} />
        <meshStandardMaterial map={coinFace(value)} metalness={0.4} roughness={0.4} />
      </mesh>
    </group>
  );
}

function Screen() {
  return (
    <group position={[0, 0, 0.16]}>
      <mesh position={[0, 0.11, 0]} rotation-x={-0.12} castShadow>
        <boxGeometry args={[0.62, 0.22, 0.015]} />
        <meshStandardMaterial color="#1f1029" roughness={0.5} metalness={0.3} />
      </mesh>
      <mesh position={[0, 0.2, 0.01]} rotation-x={-0.12}>
        <boxGeometry args={[0.62, 0.012, 0.02]} />
        <meshStandardMaterial color="#ec4899" emissive="#ec4899" emissiveIntensity={1.2} />
      </mesh>
    </group>
  );
}

const THEME: TableTheme = {
  background: "#06030a",
  fog: [7, 18],
  ambient: ["#f5d0fe", 0.22],
  hemi: ["#f0abfc", "#05030a", 0.35],
  fills: [
    ["#ec4899", 0.6, -5, 4, -3],
    ["#a855f7", 0.5, 5, 4, -3],
  ],
  lamp: { color: "#ffe4f2", intensity: 20, height: 3.0 },
  table: { top: "#12081a", rim: "#1f1029", felt: "#160a20", inlay: "#ec4899", base: "#0c0612" },
  chair: "stool",
  chairColor: "#2a1638",
  seatColors: ["#ec4899", "#facc15"],
  hats: ["cap", "beret"],
};

const SAY: BubbleStyle = { bg: "rgba(253,242,248,0.97)", fg: "#831843", border: "#ec4899" };
const SIGN: BubbleStyle = { bg: "rgba(20,8,26,0.92)", fg: "#fde68a", border: "#a855f7" };

export default function CoinTable3D(props: CoinTable3DProps) {
  const { viewerSeat, phase, acting } = props;
  const seats: TableSeat[] = props.seats.map((s) => {
    let mood: PersonMood = "rest";
    let bubble: TableSeat["bubble"] = null;
    if (phase === "commit") mood = s.committedCount === null ? "think" : "smug";
    else if (phase === "countReveal") mood = "nervous";
    else if (phase === "betting") {
      mood = acting === s.seat ? "think" : "smug";
      if (acting !== s.seat && s.bet > 0) bubble = { text: `베팅 ${s.bet}칩!`, style: SAY, key: `b${props.round}-${s.bet}`, width: 0.6 };
    } else if (phase === "showdown" || phase === "gameOver") {
      mood = props.winner === s.seat ? "cheer" : props.winner === null ? "shrug" : "sad";
      if (props.folder === s.seat) {
        mood = "shrug";
        bubble = { text: "폴드…", style: SAY, key: `f${props.round}`, width: 0.45 };
      }
    }
    const coins = s.committedValues ?? (s.committedCount !== null ? Array.from({ length: s.committedCount }, () => null) : []);
    return {
      seat: s.seat,
      name: s.name,
      away: s.away,
      sub: `💜 ${s.chips}칩 · 🪙 ${s.coinsLeft}개${s.dealer ? " · 선" : ""}`,
      mood,
      lookSeat: 1 - s.seat,
      active: phase === "betting" && acting === s.seat,
      bubble,
      tag: s.seat === viewerSeat ? { text: `💜 ${s.chips}칩 · 숫자코인 ${s.coinsLeft}개`, color: "#ec4899" } : null,
      front: (
        <group>
          <group position={[0.42, 0, 0.1]}>
            <CoinStack count={s.chips} color="#a855f7" max={30} />
          </group>
          {s.seat !== viewerSeat && <Screen />}
          {coins.map((v, i) => (
            <group key={`${props.round}-${i}-${v}`} position={[(i - (coins.length - 1) / 2) * 0.13 - 0.05, 0, -0.08]}>
              <PopIn delay={i * 0.1}>
                <Coin value={v} />
              </PopIn>
            </group>
          ))}
        </group>
      ),
    };
  });

  return (
    <TableScene
      cameraKey="show-me-the-coin-camera"
      seatCount={2}
      viewerSeat={viewerSeat}
      seats={seats}
      theme={THEME}
      environment={
        <IndoorRoom
          lowDetail={props.lowDetail}
          wall="#0e0614"
          floor={{ kind: "tiles", a: "#120a18", b: "#1f1029" }}
          rug="#1a0a1f"
          trim="#ec4899"
          windows={{ color: "#a855f7", count: 5 }}
        />
      }
      center={
        <group>
          <CoinStack count={props.pot} color="#a855f7" max={40} />
          <TableSign text={`POT ${props.pot}칩 · ROUND ${props.round}`} style={SIGN} y={0.85} />
        </group>
      }
      overview={props.overview}
      lowDetail={props.lowDetail}
      ringColor="#ec4899"
    />
  );
}
