"use client";

import * as THREE from "three";
import TableScene, { useTableGeo, type TableSeat, type TableTheme } from "@/games/shared/three/TableScene";
import { CardRow, ChipPouch, CoinStack, DeckPile, FlatCard, FlyIn, ImpactRing, PopIn, TableSign } from "@/games/shared/three/tablePieces";
import { IndoorRoom } from "@/games/shared/three/environments";
import { simpleBackTexture, simpleCardTexture, type BubbleStyle } from "@/games/shared/three/tableKit";
import type { PersonMood } from "@/games/shared/three/SeatedPerson";

/**
 * 노 땡스 3D — 재즈 라운지의 녹색 펠트 테이블. 가운데 경매 카드 위에 칩이
 * 쌓이고, "노 땡스!"면 그 사람 앞에서 칩 하나가 카드로 날아가며, 가져가면
 * 카드와 칩이 그 사람 앞으로 날아간다. 각자 앞에는 가져온 카드가 연속 묶음별로
 * 펼쳐지고(벌점 카드만 밝게), 칩은 공개 모드/내 것만 금화 더미, 비밀 모드의
 * 남의 칩은 닫힌 주머니로만 보인다.
 */

export interface NoThanksSeat3D {
  seat: number;
  name: string;
  /** null = 비밀 모드라 안 보임. */
  chips: number | null;
  cards: number[];
  /** 연속 묶음의 벌점 카드(가장 작은 수)만. */
  penaltyCards: number[];
  score: number | null;
  away?: boolean;
}

export interface NoThanksTable3DProps {
  playerCount: number;
  viewerSeat: number;
  seats: NoThanksSeat3D[];
  activeSeat: number | null;
  currentCard: number | null;
  chipsOnCard: number;
  deckCount: number;
  lastEvent: { id: number; kind: "pass" | "take"; seat: number } | null;
  overview: boolean;
  lowDetail: boolean;
}

const SEAT_COLORS = ["#fbbf24", "#38bdf8", "#f472b6", "#4ade80", "#a78bfa", "#fb923c", "#22d3ee"];

function cardTex(n: number, dim = false) {
  const hot = n >= 25;
  return simpleCardTexture(`nothanks:${n}:${dim}`, {
    big: String(n),
    corner: String(n),
    bg: dim ? ["#3f3f46", "#18181b"] : hot ? ["#b91c1c", "#450a0a"] : n >= 14 ? ["#c2410c", "#431407"] : ["#0f766e", "#042f2e"],
    edge: dim ? "#71717a" : "#fde68a",
    caption: dim ? "" : "-" + n,
  });
}
const backTex = () => simpleBackTexture("nothanks", "#14532d", "#052e16", "#fde68a", "🙅");

const THEME: TableTheme = {
  background: "#0d0a14",
  fog: [9, 24],
  ambient: ["#ffd9b0", 0.3],
  hemi: ["#ffd6a8", "#140a14", 0.4],
  fills: [["#a78bfa", 0.3, -6, 5, -6]],
  lamp: { color: "#ffdca8", intensity: 24, height: 3.2 },
  table: { top: "#14532d", rim: "#3a1f12", felt: "#14532d", inlay: "#d4a52c", base: "#24140a" },
  chair: "wood",
  chairColor: "#5a1f2a",
  seatColors: SEAT_COLORS,
  hats: ["fedora", "none", "beret", "none", "bowler", "none", "cap"],
};

const PASS_STYLE: BubbleStyle = { bg: "rgba(255,247,237,0.97)", fg: "#7c2d12", border: "#fb923c" };
const TAKE_STYLE: BubbleStyle = { bg: "rgba(220,252,231,0.97)", fg: "#14532d", border: "#22c55e" };
const SIGN: BubbleStyle = { bg: "rgba(20,12,4,0.9)", fg: "#fde68a", border: "#d4a52c" };

function Auction({ card, chips, deck, lastEvent }: { card: number | null; chips: number; deck: number; lastEvent: NoThanksTable3DProps["lastEvent"] }) {
  const geo = useTableGeo();
  const from = lastEvent ? geo.spotOf(lastEvent.seat, 0.4).sub(new THREE.Vector3(0, geo.tableY, 0)) : null;
  return (
    <group>
      <group position={[-0.42, 0, 0.02]} rotation-y={0.15}>
        <DeckPile count={deck} back={backTex()} w={0.24} h={0.34} />
      </group>
      {card !== null && (
        <group key={card}>
          <PopIn>
            <FlatCard face={cardTex(card)} back={backTex()} w={0.38} h={0.54} lift={0.006} glow="#fde68a" />
          </PopIn>
        </group>
      )}
      <group position={[0.36, 0.01, 0.08]}>
        <CoinStack count={chips} />
      </group>
      {lastEvent?.kind === "pass" && from && (
        <group key={lastEvent.id} position={[0.36, 0.2, 0.08]}>
          <FlyIn from={from.clone().sub(new THREE.Vector3(0.36, 0.2, 0.08))} dur={0.45} arc={0.35}>
            <CoinStack count={1} />
          </FlyIn>
          <ImpactRing color="#fbbf24" size={0.5} />
        </group>
      )}
      <TableSign text={card !== null ? `${card}  ·  칩 ${chips}개` : "카드 소진"} style={SIGN} y={1.0} />
    </group>
  );
}

export default function NoThanksTable3D(props: NoThanksTable3DProps) {
  const { viewerSeat, activeSeat, lastEvent } = props;
  const seats: TableSeat[] = props.seats.map((s) => {
    let mood: PersonMood = "rest";
    let bubble: TableSeat["bubble"] = null;
    if (activeSeat === s.seat) mood = "think";
    if (lastEvent?.seat === s.seat) {
      mood = lastEvent.kind === "pass" ? "shrug" : props.currentCard !== null && (s.cards.at(-1) ?? 0) >= 25 ? "sad" : "smug";
      bubble =
        lastEvent.kind === "pass"
          ? { text: "노 땡스! 🙅", style: PASS_STYLE, key: `e${lastEvent.id}`, width: 0.72 }
          : { text: "가져갈게요 ✋", style: TAKE_STYLE, key: `e${lastEvent.id}`, width: 0.72 };
    }
    if (props.overview && s.score !== null) mood = "clap";
    const pen = new Set(s.penaltyCards);
    const faces = s.cards.map((c) => cardTex(c, !pen.has(c)));
    return {
      seat: s.seat,
      name: s.name,
      away: s.away,
      sub: `🪙 ${s.chips ?? "?"} · 🂠 ${s.cards.length}장`,
      mood,
      lookSeat: activeSeat !== null && activeSeat !== s.seat ? activeSeat : "center",
      active: activeSeat === s.seat,
      bubble,
      tag: s.seat === viewerSeat ? { text: `🪙 내 칩 ${s.chips ?? 0}개`, color: "#fbbf24" } : null,
      front: (
        <group>
          <group position={[-0.05, 0, 0.02]}>
            <CardRow faces={faces} back={backTex()} w={0.11} h={0.155} perRow={7} />
          </group>
          <group position={[0.42, 0, 0.06]}>{s.chips === null ? <ChipPouch /> : <CoinStack count={s.chips} />}</group>
        </group>
      ),
    };
  });

  return (
    <TableScene
      cameraKey="no-thanks-camera"
      seatCount={props.playerCount}
      viewerSeat={viewerSeat}
      seats={seats}
      theme={THEME}
      environment={
        <IndoorRoom
          lowDetail={props.lowDetail}
          wall="#2a1626"
          floor={{ kind: "planks", a: "#3b2418", b: "#8a5a3a" }}
          rug="#3b0d1e"
          trim="#c9a13a"
          windows={{ color: "#3b4b8f", count: 3 }}
          frames={["#7c2d12", "#1e3a8a", "#14532d"]}
        />
      }
      center={<Auction card={props.currentCard} chips={props.chipsOnCard} deck={props.deckCount} lastEvent={lastEvent} />}
      overview={props.overview}
      lowDetail={props.lowDetail}
    />
  );
}
