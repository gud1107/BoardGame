"use client";

import TableScene, { type TableSeat, type TableTheme } from "@/games/shared/three/TableScene";
import { CoinStack, FlatCard, PopIn, StandingCard, TableSign } from "@/games/shared/three/tablePieces";
import { IndoorRoom } from "@/games/shared/three/environments";
import { simpleBackTexture, simpleCardTexture, type BubbleStyle } from "@/games/shared/three/tableKit";
import type { PersonMood } from "@/games/shared/three/SeatedPerson";
import { SUIT_EMOJI, SUIT_LABEL, type Suit } from "../cards";

/**
 * 러브 윈즈 올 3D — 장밋빛 조명의 1:1 카드 살롱. 마주 앉은 두 사람 앞에 카드
 * 3장. 내 카드는 나를 향해 앞면, 상대 카드는 뒷면이다가 선언 때 한 장만
 * 뒤집히고, 쇼다운에 전부 공개. 선언한 족보는 말풍선(허세일 수 있음), 칩은
 * 하트 칩 더미, 가운데는 팟(+러브 윈즈 올 2의 공용 카드).
 */

export interface LoveWinsSeat3D {
  seat: number;
  name: string;
  chips: number;
  /** 보이는 카드(null = 뒷면). */
  cards: (Suit | null)[];
  declared: string | null;
  bet: number;
  away?: boolean;
}

export interface LoveWinsTable3DProps {
  viewerSeat: number;
  seats: LoveWinsSeat3D[];
  phase: string;
  acting: number | null;
  pot: number;
  community: Suit | null;
  winner: number | null;
  folder: number | null;
  round: number;
  overview: boolean;
  lowDetail: boolean;
}

const back = () => simpleBackTexture("lwa", "#9d174d", "#3b0718", "#fecdd3", "💘");
const SUIT_BG: Record<Suit, [string, string]> = {
  scissors: ["#0e7490", "#06222b"],
  rock: ["#57534e", "#1c1917"],
  paper: ["#a16207", "#2e1d04"],
  love: ["#be123c", "#3f0718"],
  liar: ["#6d28d9", "#1e0a3c"],
};
const face = (s: Suit) => simpleCardTexture(`lwa:${s}`, { icon: SUIT_EMOJI[s], caption: SUIT_LABEL[s], bg: SUIT_BG[s], edge: "#fecdd3" });

const THEME: TableTheme = {
  background: "#14060c",
  fog: [7, 18],
  ambient: ["#ffd6e0", 0.28],
  hemi: ["#ffc2d4", "#14060c", 0.4],
  fills: [["#fb7185", 0.45, -5, 4, -4]],
  lamp: { color: "#ffe0e8", intensity: 22, height: 3.0 },
  table: { top: "#4c0519", rim: "#2a0a10", felt: "#5b0a22", inlay: "#fda4af", base: "#1c0609" },
  chair: "wood",
  chairColor: "#7f1d3a",
  seatColors: ["#fb7185", "#fbbf24"],
  hats: ["fedora", "none"],
};

const SAY: BubbleStyle = { bg: "rgba(255,241,242,0.97)", fg: "#881337", border: "#fb7185" };
const SIGN: BubbleStyle = { bg: "rgba(40,6,18,0.92)", fg: "#fde68a", border: "#fb7185" };

export default function LoveWinsTable3D(props: LoveWinsTable3DProps) {
  const { viewerSeat, phase, acting } = props;
  const showdown = phase === "showdown" || phase === "gameOver";
  const seats: TableSeat[] = props.seats.map((s) => {
    let mood: PersonMood = acting === s.seat ? "think" : "rest";
    let bubble: TableSeat["bubble"] = null;
    if (s.declared) bubble = { text: `${s.declared}!`, style: SAY, key: `d${props.round}-${s.declared}`, width: 0.7 };
    if (phase === "declare" && !s.declared) mood = "think";
    if (!showdown && acting !== s.seat && s.bet > 0 && !s.declared) bubble = { text: `레이즈 ${s.bet}!`, style: SAY, key: `b${props.round}-${s.bet}`, width: 0.6 };
    if (showdown) {
      mood = props.winner === s.seat ? "cheer" : props.winner === null ? "shrug" : "sad";
      if (props.folder === s.seat) {
        mood = "shrug";
        bubble = { text: "폴드…", style: SAY, key: `f${props.round}`, width: 0.45 };
      }
    }
    const isViewer = s.seat === viewerSeat;
    return {
      seat: s.seat,
      name: s.name,
      away: s.away,
      sub: `❤️ ${s.chips}칩`,
      mood,
      lookSeat: 1 - s.seat,
      active: !showdown && acting === s.seat,
      bubble,
      tag: isViewer ? { text: `❤️ 내 칩 ${s.chips}`, color: "#fb7185" } : null,
      front: (
        <group>
          {s.cards.map((c, i) => (
            <group key={`${props.round}-${i}-${c ?? "x"}`} position={[(i - (s.cards.length - 1) / 2) * 0.22 - 0.06, 0, 0.04]} rotation-y={(i - 1) * -0.12}>
              <PopIn delay={i * 0.06}>
                <StandingCard face={c ? face(c) : null} back={back()} w={0.19} h={0.27} tilt={isViewer ? -0.5 : -0.3} />
              </PopIn>
            </group>
          ))}
          <group position={[0.45, 0, 0.1]}>
            <CoinStack count={s.chips} color="#e11d48" max={30} />
          </group>
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
          wall="#2a0a14"
          floor={{ kind: "carpet", a: "#2a0a14", b: "#9d174d" }}
          rug="#4c0519"
          trim="#fda4af"
          windows={{ color: "#fb7185", count: 4, arched: true }}
          frames={["#9d174d", "#4c0519"]}
        />
      }
      center={
        <group>
          <group position={[0.25, 0.01, 0]}>
            <CoinStack count={props.pot} color="#e11d48" max={40} />
          </group>
          {props.community && (
            <group position={[-0.2, 0, 0]}>
              <FlatCard face={face(props.community)} back={back()} w={0.24} h={0.34} glow="#fda4af" />
            </group>
          )}
          <TableSign text={`POT ${props.pot} · ROUND ${props.round}`} style={SIGN} y={0.85} />
        </group>
      }
      overview={props.overview}
      lowDetail={props.lowDetail}
      ringColor="#fb7185"
    />
  );
}
