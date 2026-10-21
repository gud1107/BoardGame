"use client";

import TableScene, { type TableSeat, type TableTheme } from "@/games/shared/three/TableScene";
import { DeckPile, FlatCard, PopIn, StandingCard, TableSign } from "@/games/shared/three/tablePieces";
import { IndoorRoom } from "@/games/shared/three/environments";
import { simpleBackTexture, simpleCardTexture, type BubbleStyle } from "@/games/shared/three/tableKit";
import type { PersonMood } from "@/games/shared/three/SeatedPerson";
import type { Card } from "../engine";

/**
 * 랫어탯캣 3D — 달빛 드는 다락방. 각자 앞에 엎은 카드 4장(내 카드도 뒷면 —
 * 엿보기는 아래 내 손패 영역에서), 가운데엔 덱과 버림 더미 맨 윗장. 차례인
 * 사람은 뽑은 카드를 들고 고민하는데, 덱에서 뽑았으면 뒷면, 버림 더미에서
 * 가져왔으면 앞면(이미 공개된 카드)이다. 랫어탯캣!을 외치면 그 사람 말풍선,
 * 라운드가 끝나면 모든 카드가 뒤집힌다.
 */

export interface RatSeat3D {
  seat: number;
  name: string;
  /** 슬롯 4개: 공개된 카드(라운드 종료)면 카드, 아니면 null. */
  slots: (Card | null)[];
  away?: boolean;
}

export interface RatTable3DProps {
  playerCount: number;
  viewerSeat: number;
  seats: RatSeat3D[];
  activeSeat: number | null;
  /** 차례인 사람이 들고 있는 카드 — 버림 더미에서 가져온 공개 카드만 값이 있다. */
  held: { visible: Card | null } | null;
  discardTop: Card | null;
  deckCount: number;
  callerSeat: number | null;
  turnsLeft: number | null;
  setup: boolean;
  overview: boolean;
  lowDetail: boolean;
}

const SEAT_COLORS = ["#fbbf24", "#38bdf8", "#f472b6", "#4ade80", "#a78bfa", "#fb923c"];
const back = () => simpleBackTexture("rat", "#3b2a4a", "#120a1c", "#fde68a", "🐱");

function face(c: Card) {
  if (c.kind === "number") {
    const cat = c.value <= 5;
    return simpleCardTexture(`rat:n${c.value}`, {
      icon: cat ? "🐱" : "🐭",
      big: String(c.value),
      caption: cat ? "고양이" : "쥐",
      corner: String(c.value),
      bg: cat ? ["#0f766e", "#042f2e"] : ["#9f1239", "#3f0718"],
      edge: cat ? "#99f6e4" : "#fecdd3",
    });
  }
  const meta = { peek: ["🔎", "엿보기"], swap: ["🔄", "바꾸기"], drawTwo: ["2️⃣", "두 번 뽑기"] }[c.kind];
  return simpleCardTexture(`rat:${c.kind}`, { icon: meta[0], caption: meta[1], bg: ["#6d28d9", "#1e0a3c"], edge: "#ddd6fe" });
}

const THEME: TableTheme = {
  background: "#0b0a14",
  fog: [9, 22],
  ambient: ["#c7d2fe", 0.26],
  hemi: ["#c7d2fe", "#140c0a", 0.38],
  fills: [["#93c5fd", 0.45, -6, 6, -6]],
  lamp: { color: "#ffd9a0", intensity: 20, height: 3.0 },
  table: { top: "#5a3a22", rim: "#3a2414", felt: "#4a2f1d", inlay: "#c9a13a", base: "#24160c" },
  chair: "stool",
  chairColor: "#5a3a22",
  seatColors: SEAT_COLORS,
  hats: ["beret", "none", "cap", "none", "fedora", "none"],
};

const CALL: BubbleStyle = { bg: "rgba(254,243,199,0.97)", fg: "#78350f", border: "#f59e0b", size: 52 };
const SIGN: BubbleStyle = { bg: "rgba(20,12,30,0.9)", fg: "#fde68a", border: "#a78bfa" };

export default function RatTable3D(props: RatTable3DProps) {
  const { viewerSeat, activeSeat } = props;
  const seats: TableSeat[] = props.seats.map((s) => {
    const revealed = s.slots.some((c) => c !== null);
    let mood: PersonMood = activeSeat === s.seat ? "think" : "rest";
    if (props.setup) mood = "nervous";
    if (props.callerSeat === s.seat) mood = revealed ? "smug" : "cheer";
    if (props.overview) mood = s.seat === props.callerSeat ? "laugh" : "clap";
    return {
      seat: s.seat,
      name: s.name,
      away: s.away,
      sub: props.callerSeat === s.seat ? "🐱 외침!" : null,
      mood,
      lookSeat: activeSeat !== null && activeSeat !== s.seat ? activeSeat : "center",
      active: activeSeat === s.seat,
      ring: props.callerSeat === s.seat ? "#fbbf24" : null,
      bubble: props.callerSeat === s.seat && !props.overview ? { text: "랫어탯캣!", style: CALL, key: `call${s.seat}`, width: 0.8 } : null,
      tag: s.seat === viewerSeat ? { text: "🔎 내 카드는 아래에서 엿보기", color: "#a78bfa" } : null,
      front: (
        <group>
          {s.slots.map((c, i) => (
            <group key={i} position={[(i - 1.5) * 0.19, 0, 0.02]}>
              {c ? (
                <PopIn delay={i * 0.12}>
                  <FlatCard face={face(c)} back={back()} w={0.16} h={0.23} glow={c.kind === "number" && c.value >= 6 ? "#f43f5e" : null} />
                </PopIn>
              ) : (
                <FlatCard face={null} back={back()} w={0.16} h={0.23} />
              )}
            </group>
          ))}
          {activeSeat === s.seat && props.held && s.seat !== viewerSeat && (
            <group position={[0, 0.05, 0.22]}>
              <StandingCard face={props.held.visible ? face(props.held.visible) : null} back={back()} w={0.18} h={0.26} tilt={-0.2} />
            </group>
          )}
        </group>
      ),
    };
  });

  const sign = props.setup
    ? "양 끝 카드 2장을 몰래 확인!"
    : props.callerSeat !== null && props.turnsLeft !== null
      ? `🐱 마지막 턴 · ${props.turnsLeft}턴 남음`
      : `덱 ${props.deckCount}장`;

  return (
    <TableScene
      seatCount={props.playerCount}
      viewerSeat={viewerSeat}
      seats={seats}
      theme={THEME}
      environment={
        <IndoorRoom
          lowDetail={props.lowDetail}
          wall="#2a2233"
          floor={{ kind: "planks", a: "#3a2616", b: "#6b4a2a" }}
          rug="#2a1a3a"
          trim="#8a6a3a"
          windows={{ color: "#c7d7ff", count: 2, arched: true }}
          frames={["#3b2a4a", "#1e3a5f"]}
        />
      }
      center={
        <group>
          <group position={[-0.2, 0, 0]} rotation-y={0.15}>
            <DeckPile count={props.deckCount} back={back()} w={0.22} h={0.31} />
          </group>
          {props.discardTop && (
            <group key={props.discardTop.id} position={[0.2, 0.004, 0]} rotation-y={-0.12}>
              <PopIn>
                <FlatCard face={face(props.discardTop)} back={back()} w={0.22} h={0.31} />
              </PopIn>
            </group>
          )}
          <TableSign text={sign} style={SIGN} y={0.9} />
        </group>
      }
      overview={props.overview}
      lowDetail={props.lowDetail}
    />
  );
}
