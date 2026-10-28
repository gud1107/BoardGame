"use client";

import { useMemo } from "react";
import * as THREE from "three";
import TableScene, { type TableSeat, type TableTheme } from "@/games/shared/three/TableScene";
import { HeldFan, CardRow, DeckPile, FlatCard, StandingCard, TableSign } from "@/games/shared/three/tablePieces";
import { IndoorRoom } from "@/games/shared/three/environments";
import { imageCardTexture, simpleBackTexture, type BubbleStyle } from "@/games/shared/three/tableKit";
import type { PersonMood } from "@/games/shared/three/SeatedPerson";
import { CARD_IMAGES } from "../CardArt";
import { CARD_NAMES, type CardNumber, type LastEvent } from "../engine";

/**
 * 러브레터 3D — 장미가 핀 궁정 응접실. 각자 앞에 손패가 서 있고(내 카드만
 * 앞면), 낸 카드는 앞면으로 줄지어 눕는다(공개 정보). 하녀 보호 중이면
 * 방패 표시, 탈락하면 고개를 떨군다. 마지막 행동은 말풍선 + 동작으로:
 * 경비병 추측, 남작 대결, 왕자 버리게 하기 등. 사제가 본 카드는 사제 본인
 * 화면의 2D 안내에만 있고 이 장면엔 들어오지 않는다.
 */

export interface LoveLetterSeat3D {
  seat: number;
  name: string;
  handSize: number;
  /** 내 손패만(그 외엔 null). */
  hand: CardNumber[] | null;
  discards: CardNumber[];
  alive: boolean;
  protectedNow: boolean;
  away?: boolean;
}

export interface LoveLetterTable3DProps {
  playerCount: number;
  viewerSeat: number;
  seats: LoveLetterSeat3D[];
  activeSeat: number | null;
  lastEvent: LastEvent | null;
  eventKey: string;
  deckCount: number;
  visibleRemoved: CardNumber[];
  overview: boolean;
  lowDetail: boolean;
}

const SEAT_COLORS = ["#f472b6", "#60a5fa", "#fbbf24", "#4ade80"];
const back = () => simpleBackTexture("loveletter", "#7a1d3a", "#2a0614", "#fbcfe8", "💌");
const face = (n: CardNumber) => imageCardTexture(`loveletter:${n}`, CARD_IMAGES[n], { text: String(n), bg: "rgba(136,19,55,0.92)", fg: "#fff1f2" }, "#fbcfe8");

const THEME: TableTheme = {
  background: "#1a0a12",
  fog: [9, 24],
  ambient: ["#ffd9e6", 0.32],
  hemi: ["#ffe0ec", "#1a0a12", 0.42],
  fills: [["#f9a8d4", 0.3, -6, 5, -6]],
  lamp: { color: "#ffe2c6", intensity: 22, height: 3.2 },
  table: { top: "#5a1a32", rim: "#3a1a10", felt: "#6b1b3a", inlay: "#e9b949", base: "#2a1208" },
  chair: "wood",
  chairColor: "#6b1b3a",
  seatColors: SEAT_COLORS,
  hats: ["circlet", "none", "beret", "none"],
};

const SAY: BubbleStyle = { bg: "rgba(255,241,242,0.97)", fg: "#881337", border: "#fb7185" };
const BAD: BubbleStyle = { bg: "rgba(24,24,27,0.95)", fg: "#fafafa", border: "#71717a" };
const SIGN: BubbleStyle = { bg: "rgba(42,6,20,0.92)", fg: "#fde68a", border: "#e9b949" };

/** Who says what, and how everyone reacts, for the latest card played. */
function beat(e: LastEvent | null, names: Record<number, string>) {
  const say = new Map<number, { text: string; bad?: boolean }>();
  const mood = new Map<number, PersonMood>();
  const look = new Map<number, number>();
  if (!e) return { say, mood, look };
  const nm = (s: number | null) => (s === null ? "" : (names[s] ?? ""));
  const a = e.actorSeat;
  switch (e.type) {
    case "guard":
      if (e.fizzled || e.targetSeat === null) say.set(a, { text: "경비병… 지목할 사람이 없네" });
      else {
        say.set(a, { text: `${nm(e.targetSeat)}님, ${e.guess ? CARD_NAMES[e.guess] : "?"} 맞죠?` });
        mood.set(a, "point");
        look.set(a, e.targetSeat);
        mood.set(e.targetSeat, e.correct ? "shock" : "smug");
        if (e.correct) say.set(e.targetSeat, { text: "들켰다… 💔", bad: true });
        else say.set(e.targetSeat, { text: "땡! 😏" });
      }
      break;
    case "priest":
      say.set(a, { text: e.targetSeat !== null ? `사제: ${nm(e.targetSeat)}님 카드 좀 볼게요 👀` : "사제… 볼 사람이 없네" });
      if (e.targetSeat !== null) {
        mood.set(a, "smug");
        look.set(a, e.targetSeat);
        mood.set(e.targetSeat, "nervous");
      }
      break;
    case "baron":
      if (e.targetSeat !== null && e.outcome) {
        say.set(a, { text: `남작: ${nm(e.targetSeat)}님과 대결!` });
        look.set(a, e.targetSeat);
        look.set(e.targetSeat, a);
        if (e.outcome === "tie") {
          mood.set(a, "shrug");
          mood.set(e.targetSeat, "shrug");
        } else {
          const loser = e.outcome === "actorEliminated" ? a : e.targetSeat;
          const winner = loser === a ? e.targetSeat : a;
          mood.set(loser, "shock");
          mood.set(winner, "laugh");
          say.set(loser, { text: "졌다… 💔", bad: true });
        }
      } else say.set(a, { text: "남작… 대결할 사람이 없네" });
      break;
    case "handmaid":
      say.set(a, { text: "하녀 — 한 바퀴 동안 보호! 🛡️" });
      mood.set(a, "smug");
      break;
    case "prince":
      say.set(a, { text: `왕자: ${nm(e.targetSeat)}님, 카드 버려요!` });
      mood.set(a, "point");
      look.set(a, e.targetSeat);
      mood.set(e.targetSeat, e.eliminatedPrincess ? "shock" : "shrug");
      if (e.eliminatedPrincess) say.set(e.targetSeat, { text: "공주가… 💔", bad: true });
      break;
    case "king":
      say.set(a, { text: e.targetSeat !== null ? `왕: ${nm(e.targetSeat)}님과 카드 교환 👑` : "왕… 바꿀 사람이 없네" });
      if (e.targetSeat !== null) {
        look.set(a, e.targetSeat);
        look.set(e.targetSeat, a);
        mood.set(e.targetSeat, "nervous");
      }
      break;
    case "countess":
      say.set(a, { text: "백작부인을 내려놓죠 💃" });
      mood.set(a, "smug");
      break;
    case "princess":
      say.set(a, { text: "앗, 공주를 버렸다… 💔", bad: true });
      mood.set(a, "shock");
      break;
  }
  return { say, mood, look };
}

function Center({ deck, removed }: { deck: number; removed: CardNumber[] }) {
  return (
    <group>
      <group position={[-0.2, 0, 0]} rotation-y={0.2}>
        <DeckPile count={deck} back={back()} w={0.22} h={0.31} />
      </group>
      {/* the burned card */}
      <group position={[0.18, 0, 0.05]} rotation-y={-0.5}>
        <FlatCard face={null} back={back()} w={0.2} h={0.28} />
      </group>
      {removed.map((n, i) => (
        <group key={i} position={[(i - (removed.length - 1) / 2) * 0.2, 0, -0.38]}>
          <FlatCard face={face(n)} back={back()} w={0.17} h={0.24} />
        </group>
      ))}
      <TableSign text={`덱 ${deck}장`} style={SIGN} y={0.9} width={0.75} />
    </group>
  );
}

function Hand({ s, isViewer }: { s: LoveLetterSeat3D; isViewer: boolean }) {
  const cards = s.hand ?? Array.from({ length: s.handSize }, () => null);
  return (
    <group>
      {cards.map((c, i) => (
        <group key={i} position={[(i - (cards.length - 1) / 2) * 0.2 - 0.05, 0, 0.04]} rotation-y={(i - (cards.length - 1) / 2) * -0.15}>
          <StandingCard face={c ? face(c) : null} back={back()} w={isViewer ? 0.2 : 0.18} h={isViewer ? 0.28 : 0.25} tilt={isViewer ? -0.5 : -0.25} />
        </group>
      ))}
    </group>
  );
}

function Shield() {
  const geo = useMemo(() => new THREE.TorusGeometry(0.2, 0.012, 8, 40), []);
  return (
    <mesh geometry={geo} rotation-x={Math.PI / 2} position={[0, 0.03, 0]}>
      <meshBasicMaterial color="#7dd3fc" transparent opacity={0.8} />
    </mesh>
  );
}

export default function LoveLetterTable3D(props: LoveLetterTable3DProps & { names: Record<number, string> }) {
  const { viewerSeat, activeSeat, names } = props;
  const b = beat(props.lastEvent, names);
  const seats: TableSeat[] = props.seats.map((s) => {
    let mood: PersonMood = b.mood.get(s.seat) ?? (activeSeat === s.seat ? "think" : "rest");
    if (!s.alive && !b.mood.has(s.seat)) mood = "slump";
    const said = b.say.get(s.seat);
    const lookTo = b.look.get(s.seat);
    return {
      seat: s.seat,
      name: s.name,
      away: s.away,
      sub: s.alive ? (s.protectedNow ? "🛡️ 보호 중" : `🂠 ${s.handSize}장`) : "💔 탈락",
      mood,
      out: !s.alive && !b.mood.has(s.seat),
      lookSeat: lookTo ?? (activeSeat !== null && activeSeat !== s.seat ? activeSeat : "center"),
      active: activeSeat === s.seat,
      ring: s.protectedNow ? "#7dd3fc" : null,
      bubble: said ? { text: said.text, style: said.bad ? BAD : SAY, key: `${props.eventKey}-${s.seat}`, width: 0.95 } : null,
      tag: s.seat === viewerSeat ? { text: s.protectedNow ? "🛡️ 하녀 보호 중" : "💌 내 차례 대기", color: "#fb7185" } : null,
      held: s.alive && s.seat !== viewerSeat && !s.hand && s.handSize > 0 ? <HeldFan count={s.handSize} back={back()} /> : null,
      front: (
        <group>
          {/* my own hand, or one that's been revealed, lies face-up on the table; hidden hands are held */}
          {s.alive && (s.seat === viewerSeat || s.hand) && <Hand s={s} isViewer={s.seat === viewerSeat} />}
          {s.protectedNow && <Shield />}
          <group position={[0, 0, -0.26]}>
            <CardRow faces={s.discards.map(face)} back={back()} w={0.1} h={0.14} perRow={6} />
          </group>
        </group>
      ),
    };
  });

  return (
    <TableScene
      cameraKey="love-letter-camera"
      seatCount={props.playerCount}
      viewerSeat={viewerSeat}
      seats={seats}
      theme={THEME}
      environment={
        <IndoorRoom
          lowDetail={props.lowDetail}
          wall="#3a1424"
          floor={{ kind: "tiles", a: "#e8d9c8", b: "#5a2a3a" }}
          rug="#5b0f2a"
          trim="#e9b949"
          windows={{ color: "#ffd7a8", count: 3, arched: true }}
          frames={["#7a1d3a", "#1e3a8a", "#4a1d5c"]}
          torches
        />
      }
      center={<Center deck={props.deckCount} removed={props.visibleRemoved} />}
      overview={props.overview}
      lowDetail={props.lowDetail}
      ringColor="#fb7185"
    />
  );
}
