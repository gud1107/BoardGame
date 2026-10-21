"use client";

import { useMemo } from "react";
import * as THREE from "three";
import TableScene, { type TableSeat, type TableTheme } from "@/games/shared/three/TableScene";
import { Clickable, CoinStack, DeckPile, FlatCard, GlowDisc, HitBox, PopIn, TableSign } from "@/games/shared/three/tablePieces";
import { OutdoorPlaza } from "@/games/shared/three/environments";
import { paintedTexture, simpleBackTexture, FONTS, type BubbleStyle } from "@/games/shared/three/tableKit";
import type { PersonMood } from "@/games/shared/three/SeatedPerson";
import { RESOURCE_ORDER, type PointCard, type Resource, type ResourceBundle } from "../cards";

/**
 * 센추리: 향신료의 길 3D — 사막 오아시스 대상 숙영지의 낮은 원탁. 가운데에
 * 점수 카드 시장(필요한 향신료 큐브가 그려진 카드)과 금·은화, 각자 앞엔 나무
 * 수레에 향신료 큐브(강황·사프란·카다멈·시나몬)가 실제 큐브로 실려 있고,
 * 완성한 점수 카드와 동전이 쌓인다. 내 차례면 점수 카드를 눌러 완성 창을 연다.
 */

export const SPICE_HEX: Record<Resource, string> = { yellow: "#eab308", red: "#dc2626", green: "#16a34a", brown: "#7c3a12" };

export interface CenturySeat3D {
  seat: number;
  name: string;
  resources: ResourceBundle;
  pointCards: number;
  gold: number;
  silver: number;
  score: number;
  away?: boolean;
}

export interface CenturyTable3DProps {
  playerCount: number;
  viewerSeat: number;
  seats: CenturySeat3D[];
  pointMarket: (PointCard | null)[];
  pointDeck: number;
  gold: number;
  silver: number;
  activeSeat: number | null;
  affordable: boolean[];
  onPoint: ((index: number) => void) | null;
  goal: number;
  endTriggered: boolean;
  overview: boolean;
  lowDetail: boolean;
}

function pointTex(c: PointCard) {
  return paintedTexture(`century:p:${c.id}`, 256, 360, (ctx, W, H) => {
    ctx.beginPath();
    ctx.roundRect(4, 4, W - 8, H - 8, 20);
    ctx.save();
    ctx.clip();
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#f3dfb5");
    g.addColorStop(1, "#c79a5a");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    ctx.strokeStyle = "#7c3a12";
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.roundRect(8, 8, W - 16, H - 16, 16);
    ctx.stroke();
    ctx.fillStyle = "#3b1d0a";
    ctx.font = `900 92px ${FONTS.text}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(c.points), W / 2, 92);
    const cubes: Resource[] = [];
    for (const r of RESOURCE_ORDER) for (let i = 0; i < (c.cost[r] ?? 0); i++) cubes.push(r);
    const per = 3;
    cubes.forEach((r, i) => {
      const x = W / 2 + ((i % per) - (Math.min(per, cubes.length) - 1) / 2) * 62;
      const y = 200 + Math.floor(i / per) * 62;
      ctx.fillStyle = SPICE_HEX[r];
      ctx.beginPath();
      ctx.roundRect(x - 24, y - 24, 48, 48, 8);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.45)";
      ctx.lineWidth = 3;
      ctx.stroke();
    });
  });
}
const back = () => simpleBackTexture("century", "#7c3a12", "#2a1206", "#fcd34d", "🐪");

const cubeGeo = new THREE.BoxGeometry(0.045, 0.045, 0.045);

function Cart({ resources }: { resources: ResourceBundle }) {
  const cubes = useMemo(() => {
    const out: Resource[] = [];
    for (const r of RESOURCE_ORDER) for (let i = 0; i < (resources[r] ?? 0); i++) out.push(r);
    return out;
  }, [resources]);
  return (
    <group>
      {/* wooden cart */}
      <mesh position={[0, 0.03, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.5, 0.04, 0.2]} />
        <meshStandardMaterial color="#7a4a24" roughness={0.8} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0.24 * s, 0.06, 0]} rotation-z={Math.PI / 2}>
          <cylinderGeometry args={[0.055, 0.055, 0.02, 16]} />
          <meshStandardMaterial color="#4a2a14" roughness={0.8} />
        </mesh>
      ))}
      {cubes.map((r, i) => (
        <mesh key={i} geometry={cubeGeo} position={[-0.2 + (i % 9) * 0.05, 0.075 + Math.floor(i / 9) * 0.05, ((i * 7) % 3) * 0.04 - 0.04]} rotation-y={i * 0.6} castShadow>
          <meshStandardMaterial color={SPICE_HEX[r]} roughness={0.55} />
        </mesh>
      ))}
    </group>
  );
}

const THEME: TableTheme = {
  background: "#2a1d2e",
  fog: [12, 34],
  ambient: ["#ffe7c2", 0.38],
  hemi: ["#ffd28a", "#2a1810", 0.55],
  fills: [
    ["#ff9a4a", 0.7, -10, 5, -12],
    ["#c7d2fe", 0.2, 6, 6, 8],
  ],
  lamp: { color: "#ffe2b0", intensity: 14, height: 3.2 },
  table: { top: "#7a3a1a", rim: "#4a2410", felt: "#8a3a1e", inlay: "#fcd34d", base: "#3a1d0a" },
  chair: "stool",
  chairColor: "#5a3a1e",
  seatColors: ["#fcd34d", "#f87171", "#4ade80", "#38bdf8", "#c084fc"],
  hats: ["none", "fedora", "none", "beret", "none"],
};

const SIGN: BubbleStyle = { bg: "rgba(42,18,6,0.92)", fg: "#fde68a", border: "#fcd34d" };

export default function CenturyTable3D(props: CenturyTable3DProps) {
  const { viewerSeat, activeSeat } = props;
  const seats: TableSeat[] = props.seats.map((s) => {
    const mood: PersonMood = props.overview ? "clap" : activeSeat === s.seat ? "think" : "rest";
    return {
      seat: s.seat,
      name: s.name,
      away: s.away,
      sub: `🏆 ${s.score} · 🃏 ${s.pointCards}/${props.goal}`,
      mood,
      lookSeat: activeSeat !== null && activeSeat !== s.seat ? activeSeat : "center",
      active: activeSeat === s.seat,
      tag: s.seat === viewerSeat ? { text: `🃏 점수 카드 ${s.pointCards}/${props.goal}`, color: "#fcd34d" } : null,
      front: (
        <group>
          <group position={[-0.05, 0, 0.05]}>
            <Cart resources={s.resources} />
          </group>
          <group position={[0.42, 0, 0.0]}>
            <CoinStack count={s.gold} color="#f2c14e" />
          </group>
          <group position={[0.42, 0, 0.14]}>
            <CoinStack count={s.silver} color="#cbd5e1" />
          </group>
          <group position={[-0.42, 0, 0.05]} rotation-y={0.2}>
            <DeckPile count={s.pointCards} back={back()} w={0.12} h={0.17} max={8} />
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
          ground="#c2925a"
          plaza="#a87a48"
          trim="#7c3a12"
          skyline={{ kind: "dunes", color: "#d4a366" }}
          sun={{ color: "#ffb35c", position: [-14, 4, -22], size: 2.6 }}
          torches
        />
      }
      center={
        <group>
          {props.pointMarket.map((c, i) => (
            <group key={c?.id ?? `e${i}`} position={[(i - 2) * 0.24, 0, -0.1]}>
              {c && (
                <Clickable onClick={props.onPoint ? () => props.onPoint!(i) : null}>
                  <PopIn>
                    <FlatCard face={pointTex(c)} back={back()} w={0.2} h={0.28} glow={props.affordable[i] ? "#fde68a" : null} />
                  </PopIn>
                  {i === 0 && props.gold > 0 && (
                    <group position={[0, 0, 0.22]}>
                      <CoinStack count={Math.min(props.gold, 8)} color="#f2c14e" />
                    </group>
                  )}
                  {i === 1 && props.silver > 0 && (
                    <group position={[0, 0, 0.22]}>
                      <CoinStack count={Math.min(props.silver, 8)} color="#cbd5e1" />
                    </group>
                  )}
                  {props.onPoint && <HitBox size={[0.2, 0.1, 0.28]} />}
                </Clickable>
              )}
              {props.affordable[i] && <GlowDisc color="#fde68a" r={0.16} opacity={0.3} />}
            </group>
          ))}
          <group position={[0.7, 0, -0.1]} rotation-y={-0.2}>
            <DeckPile count={props.pointDeck} back={back()} w={0.2} h={0.28} />
          </group>
          <TableSign text={props.endTriggered ? "🏁 마지막 라운드!" : `점수 카드 ${props.goal}장 먼저 모으기`} style={SIGN} y={0.95} />
        </group>
      }
      overview={props.overview}
      lowDetail={props.lowDetail}
      ringColor="#fcd34d"
    />
  );
}
