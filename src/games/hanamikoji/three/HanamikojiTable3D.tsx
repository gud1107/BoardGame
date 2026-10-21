"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import TableScene, { type TableSeat, type TableTheme } from "@/games/shared/three/TableScene";
import { FlatCard, PopIn, StandingCard, TableSign } from "@/games/shared/three/tablePieces";
import { IndoorRoom } from "@/games/shared/three/environments";
import { simpleBackTexture, simpleCardTexture, type BubbleStyle } from "@/games/shared/three/tableKit";
import type { PersonMood } from "@/games/shared/three/SeatedPerson";

/**
 * 하나미코지 3D — 교토 찻집의 다다미방, 둘이 마주 앉는다. 가운데 줄에 게이샤
 * 7명(값·꽃), 각 게이샤 아래로 두 사람이 얻은 아이템 카드가 자기 쪽에 쌓이고,
 * 호감 마커는 지금 이긴 쪽으로 미끄러진다. 각자 앞엔 행동 타일 4개(쓴 건
 * 뒤집힘), 숨긴 카드(비밀)와 버린 카드는 뒷면, 상대 손패는 장수만.
 * 선물/경쟁 제안은 가운데에 앞면으로 펼쳐진다(공개 정보).
 */

export interface GeishaInfo {
  id: string;
  name: string;
  value: number;
  emoji: string;
  color: string;
}

export interface HanamikojiTable3DProps {
  viewerSeat: number;
  names: [string, string];
  away: [boolean, boolean];
  geishas: GeishaInfo[];
  /** 게이샤별 각 자리의 획득 카드 수. */
  won: Record<string, [number, number]>;
  ownership: Record<string, number | null>;
  handCounts: [number, number];
  actionsUsed: [string[], string[]];
  hasSecret: [boolean, boolean];
  discardCount: [number, number];
  activeSeat: number | null;
  /** 진행 중인 제안 카드(게이샤 id) — 선물 3장 또는 경쟁 2+2장. */
  offer: { kind: "gift" | "compete"; by: number; cards: string[][] } | null;
  round: number;
  overview: boolean;
  lowDetail: boolean;
}

const ACTIONS: [string, string][] = [
  ["secret", "🤫"],
  ["tradeoff", "❌"],
  ["gift", "🎁"],
  ["compete", "⚔️"],
];

const back = () => simpleBackTexture("hanamikoji", "#3b0764", "#12001f", "#f0abfc", "🌸");
const geishaTex = (g: GeishaInfo) => simpleCardTexture(`hana:g:${g.id}`, { icon: g.emoji, big: String(g.value), caption: g.name, bg: [g.color, "#1a0a1f"], edge: "#fde68a" });
const itemTex = (g: GeishaInfo) => simpleCardTexture(`hana:i:${g.id}`, { icon: g.emoji, caption: g.name, bg: [g.color, "#2a1030"], edge: "#fbcfe8" });
const actionTex = (icon: string, used: boolean) => simpleCardTexture(`hana:a:${icon}:${used}`, { icon, bg: used ? ["#27272a", "#09090b"] : ["#7c2d12", "#2a0d04"], edge: used ? "#52525b" : "#fde68a" });

function Marker({ z }: { z: number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    if (ref.current) ref.current.position.z += (z - ref.current.position.z) * 0.12;
  });
  return (
    <group ref={ref}>
      <mesh position={[0, 0.02, 0]} castShadow>
        <cylinderGeometry args={[0.045, 0.045, 0.03, 20]} />
        <meshStandardMaterial color="#fde68a" metalness={0.7} roughness={0.25} emissive="#a16207" emissiveIntensity={0.3} />
      </mesh>
    </group>
  );
}

function GeishaRow(p: HanamikojiTable3DProps) {
  const me = p.viewerSeat;
  return (
    <group>
      {p.geishas.map((g, i) => {
        const x = (i - 3) * 0.25;
        const [a, b] = p.won[g.id] ?? [0, 0];
        const mine = me === 0 ? a : b;
        const theirs = me === 0 ? b : a;
        const owner = p.ownership[g.id];
        const mz = owner === null || owner === undefined ? 0 : owner === me ? 0.2 : -0.2;
        return (
          <group key={g.id} position={[x, 0, 0]}>
            <StandingCard face={geishaTex(g)} back={back()} w={0.2} h={0.28} tilt={0} />
            <Marker z={mz} />
            {Array.from({ length: mine }, (_, k) => (
              <group key={`m${k}`} position={[0, 0.003 + k * 0.003, 0.34 + k * 0.05]}>
                <PopIn>
                  <FlatCard face={itemTex(g)} back={back()} w={0.14} h={0.2} lift={0} />
                </PopIn>
              </group>
            ))}
            {Array.from({ length: theirs }, (_, k) => (
              <group key={`t${k}`} position={[0, 0.003 + k * 0.003, -0.34 - k * 0.05]} rotation-y={Math.PI}>
                <PopIn>
                  <FlatCard face={itemTex(g)} back={back()} w={0.14} h={0.2} lift={0} />
                </PopIn>
              </group>
            ))}
          </group>
        );
      })}
    </group>
  );
}

function Offer({ offer, geishas }: { offer: NonNullable<HanamikojiTable3DProps["offer"]>; geishas: GeishaInfo[] }) {
  const byId = Object.fromEntries(geishas.map((g) => [g.id, g]));
  return (
    <group position={[0, 0.42, 0]}>
      {offer.cards.map((set, si) =>
        set.map((id, k) => (
          <group key={`${si}-${k}`} position={[(si - (offer.cards.length - 1) / 2) * 0.5 + (k - (set.length - 1) / 2) * 0.15, 0, 0.1]}>
            <PopIn delay={(si * 2 + k) * 0.08}>
              <StandingCard face={byId[id] ? itemTex(byId[id]) : back()} back={back()} w={0.13} h={0.18} tilt={0.1} />
            </PopIn>
          </group>
        )),
      )}
    </group>
  );
}

const THEME: TableTheme = {
  background: "#140a10",
  fog: [8, 20],
  ambient: ["#ffe4e6", 0.3],
  hemi: ["#ffd6e0", "#140a10", 0.42],
  fills: [["#fda4af", 0.35, -5, 5, -5]],
  lamp: { color: "#fff1e0", intensity: 22, height: 3.0 },
  table: { top: "#3a1f12", rim: "#2a140a", felt: "#4a2a18", inlay: "#f0abfc", base: "#1f0f06" },
  chair: "stool",
  chairColor: "#3a1f12",
  seatColors: ["#f472b6", "#a78bfa"],
  hats: ["none", "beret"],
};

const SIGN: BubbleStyle = { bg: "rgba(40,10,30,0.92)", fg: "#fde68a", border: "#f0abfc" };
const OFFER: BubbleStyle = { bg: "rgba(253,242,248,0.97)", fg: "#831843", border: "#f472b6" };

export default function HanamikojiTable3D(props: HanamikojiTable3DProps) {
  const { viewerSeat, activeSeat, offer } = props;
  const seats: TableSeat[] = [0, 1].map((seat) => {
    let mood: PersonMood = activeSeat === seat ? "think" : "rest";
    let bubble: TableSeat["bubble"] = null;
    if (offer) {
      if (offer.by === seat) {
        mood = "smug";
        bubble = { text: offer.kind === "gift" ? "🎁 이 중 1장 가져가세요" : "⚔️ 두 묶음 중 골라요", style: OFFER, key: `o${props.round}-${offer.kind}`, width: 0.85 };
      } else mood = "think";
    }
    if (props.overview) mood = "clap";
    const used = props.actionsUsed[seat];
    return {
      seat,
      name: props.names[seat],
      away: props.away[seat],
      sub: `🂠 ${props.handCounts[seat]}장`,
      mood,
      lookSeat: offer ? "center" : 1 - seat,
      active: activeSeat === seat,
      chair: "stool",
      bubble,
      front: (
        <group position={[0, 0, 0.12]}>
          {ACTIONS.map(([id, icon], i) => (
            <group key={id} position={[(i - 1.5) * 0.13 - 0.2, 0, 0]}>
              <FlatCard face={actionTex(icon, used.includes(id))} back={back()} w={0.11} h={0.11} lift={0} />
            </group>
          ))}
          {props.hasSecret[seat] && (
            <group position={[0.22, 0, 0]}>
              <FlatCard face={null} back={back()} w={0.12} h={0.17} glow="#f0abfc" />
            </group>
          )}
          {Array.from({ length: props.discardCount[seat] }, (_, k) => (
            <group key={k} position={[0.38, 0.003 * k, 0]} rotation-y={0.3}>
              <FlatCard face={null} back={back()} w={0.12} h={0.17} lift={0} />
            </group>
          ))}
          {seat !== viewerSeat && (
            <group position={[0, 0, 0.12]}>
              {Array.from({ length: props.handCounts[seat] }, (_, i) => (
                <group key={i} rotation-z={(i - (props.handCounts[seat] - 1) / 2) * 0.12}>
                  <group position={[0, 0.06, 0]}>
                    <StandingCard face={back()} back={back()} w={0.12} h={0.17} tilt={-0.4} />
                  </group>
                </group>
              ))}
            </group>
          )}
        </group>
      ),
    };
  });

  return (
    <TableScene
      seatCount={2}
      viewerSeat={viewerSeat}
      seats={seats}
      theme={THEME}
      environment={
        <IndoorRoom
          lowDetail={props.lowDetail}
          wall="#3a2418"
          floor={{ kind: "tiles", a: "#c9b37a", b: "#b39d64" }}
          rug="#7a5a32"
          trim="#2a140a"
          windows={{ color: "#ffd9b0", count: 4 }}
          frames={["#9d174d", "#14532d"]}
        />
      }
      center={
        <group>
          <GeishaRow {...props} />
          {offer && <Offer offer={offer} geishas={props.geishas} />}
          <TableSign text={`${props.round}라운드`} style={SIGN} y={offer ? 1.05 : 0.8} width={0.7} />
        </group>
      }
      overview={props.overview}
      lowDetail={props.lowDetail}
      ringColor="#f472b6"
    />
  );
}
