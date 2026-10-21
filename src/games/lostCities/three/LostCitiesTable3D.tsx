"use client";

import TableScene, { type TableSeat, type TableTheme } from "@/games/shared/three/TableScene";
import { Clickable, DeckPile, FlatCard, GlowDisc, HitBox, PopIn, StandingCard, TableSign } from "@/games/shared/three/tablePieces";
import { OutdoorPlaza } from "@/games/shared/three/environments";
import { simpleBackTexture, simpleCardTexture, type BubbleStyle } from "@/games/shared/three/tableKit";
import type { PersonMood } from "@/games/shared/three/SeatedPerson";
import { COLORS, EXPEDITION_THEME, type Card, type Color } from "../engine";

/**
 * 로스트 시티 3D — 해 질 녘 산악 베이스캠프의 탐험가 테이블. 두 사람이 마주
 * 앉아 각자 앞에 원정 5줄(색별)을 내 쪽으로 쌓아 가고, 테이블 가운데엔 색별
 * 버림 더미 5개와 덱. 내 차례면 원정 줄·버림 더미·덱을 테이블에서 바로
 * 눌러 진행한다(손패 카드는 아래 2D 손패에서 고른다). 상대 손패는 뒷면.
 */

export interface LostCitiesTable3DProps {
  viewerSeat: number;
  names: [string, string];
  away: [boolean, boolean];
  expeditions: [Record<Color, Card[]>, Record<Color, Card[]>];
  discards: Record<Color, Card[]>;
  handCounts: [number, number];
  deckCount: number;
  activeSeat: number | null;
  /** 내 카드 선택 후: 놓을 수 있는 내 원정 색 / 버릴 수 있는 색. */
  laneTarget: Color | null;
  discardTarget: Color | null;
  /** 내 보충 단계: 가져올 수 있는 버림 더미(직전에 버린 색 제외). */
  drawableDiscards: Color[];
  canDrawDeck: boolean;
  onLane: (c: Color) => void;
  onDiscard: (c: Color) => void;
  onDeck: () => void;
  status: string;
  overview: boolean;
  lowDetail: boolean;
}

const COLOR_BG: Record<Color, [string, string, string]> = {
  white: ["#e2e8f0", "#64748b", "#0f172a"],
  green: ["#16a34a", "#052e16", "#ffffff"],
  yellow: ["#eab308", "#422006", "#1c1917"],
  red: ["#dc2626", "#450a0a", "#ffffff"],
  blue: ["#2563eb", "#0b1a4a", "#ffffff"],
};

const back = () => simpleBackTexture("lostcities", "#3a2a18", "#120a04", "#e9b949", "🧭");
function face(c: Card) {
  const [a, b, fg] = COLOR_BG[c.color];
  const t = EXPEDITION_THEME[c.color];
  return simpleCardTexture(`lc:${c.color}:${c.kind}:${c.value ?? 0}`, {
    icon: c.kind === "investment" ? "🤝" : t.emoji,
    big: c.kind === "investment" ? "×2" : String(c.value),
    caption: t.name,
    corner: c.kind === "investment" ? "🤝" : String(c.value),
    bg: [a, b],
    edge: fg === "#ffffff" ? "#fde68a" : "#1c1917",
    fg,
  });
}

const LANE_GAP = 0.2;
const CARD_W = 0.16;
const CARD_H = 0.23;

/** One seat's five expedition columns, stacked toward the owner. */
function Lanes({ lanes, target, onLane }: { lanes: Record<Color, Card[]>; target: Color | null; onLane: ((c: Color) => void) | null }) {
  return (
    <group position={[0, 0, -0.42]}>
      {COLORS.map((color, i) => {
        const cards = lanes[color];
        const x = (i - 2) * LANE_GAP;
        const can = target === color && !!onLane;
        return (
          <group key={color} position={[x, 0, 0]}>
            <Clickable onClick={can ? () => onLane!(color) : null}>
              {/* lane slot */}
              <mesh rotation-x={-Math.PI / 2} position={[0, 0.002, 0.12]}>
                <planeGeometry args={[CARD_W + 0.02, 0.5]} />
                <meshBasicMaterial color={COLOR_BG[color][0]} transparent opacity={can ? 0.45 : 0.12} depthWrite={false} />
              </mesh>
              {can && <GlowDisc color="#fde68a" r={0.11} opacity={0.5} />}
              {cards.map((c, k) => (
                <group key={c.id} position={[0, 0.003 + k * 0.002, k * 0.04]}>
                  <PopIn>
                    <FlatCard face={face(c)} back={back()} w={CARD_W} h={CARD_H} lift={0} />
                  </PopIn>
                </group>
              ))}
              {can && <HitBox size={[CARD_W + 0.04, 0.2, 0.6]} />}
            </Clickable>
          </group>
        );
      })}
    </group>
  );
}

function Hand({ count }: { count: number }) {
  const b = back();
  return (
    <group position={[0, 0, 0.2]}>
      {Array.from({ length: count }, (_, i) => (
        <group key={i} rotation-z={(i - (count - 1) / 2) * 0.1} position={[0, 0.02, i * -0.003]}>
          <group position={[0, 0.06, 0]}>
            <StandingCard face={b} back={b} w={0.13} h={0.19} tilt={-0.4} />
          </group>
        </group>
      ))}
    </group>
  );
}

function Center(p: LostCitiesTable3DProps) {
  return (
    <group>
      {COLORS.map((color, i) => {
        const pile = p.discards[color];
        const top = pile[pile.length - 1];
        const canDiscard = p.discardTarget === color;
        const canDraw = p.drawableDiscards.includes(color) && pile.length > 0;
        const click = canDiscard ? () => p.onDiscard(color) : canDraw ? () => p.onDiscard(color) : null;
        return (
          <group key={color} position={[(i - 2) * 0.24, 0, 0]}>
            <Clickable onClick={click}>
              <mesh rotation-x={-Math.PI / 2} position={[0, 0.002, 0]}>
                <planeGeometry args={[CARD_W + 0.03, CARD_H + 0.03]} />
                <meshBasicMaterial color={COLOR_BG[color][0]} transparent opacity={click ? 0.5 : 0.18} depthWrite={false} />
              </mesh>
              {pile.slice(-3).map((c, k) => (
                <group key={c.id} position={[0, 0.003 + k * 0.004, 0]} rotation-y={Math.sin(k * 3.3) * 0.08}>
                  <FlatCard face={face(c)} back={back()} w={CARD_W} h={CARD_H} lift={0} glow={k === Math.min(2, pile.length - 1) && click ? "#fde68a" : null} />
                </group>
              ))}
              {!top && <FlatCard face={simpleCardTexture(`lc:empty:${color}`, { icon: EXPEDITION_THEME[color].emoji, caption: "버림", bg: ["#1c1917", "#0c0a09"], edge: COLOR_BG[color][0] })} back={back()} w={CARD_W} h={CARD_H} lift={0} />}
              {click && <HitBox size={[CARD_W + 0.05, 0.2, CARD_H + 0.05]} />}
            </Clickable>
          </group>
        );
      })}
      <group position={[0.78, 0, 0]} rotation-y={-0.2}>
        <Clickable onClick={p.canDrawDeck ? p.onDeck : null}>
          {p.canDrawDeck && <GlowDisc color="#fde68a" r={0.2} opacity={0.5} />}
          <DeckPile count={p.deckCount} back={back()} w={CARD_W + 0.02} h={CARD_H + 0.02} max={30} />
          {p.canDrawDeck && <HitBox size={[0.24, 0.3, 0.3]} />}
        </Clickable>
      </group>
      <TableSign text={`${p.status}\n덱 ${p.deckCount}장`} style={SIGN} y={0.9} />
    </group>
  );
}

const THEME: TableTheme = {
  background: "#2b2238",
  fog: [12, 36],
  ambient: ["#ffe2c4", 0.34],
  hemi: ["#ffc89a", "#1a1420", 0.5],
  fills: [
    ["#ff9a5a", 0.65, -10, 5, -14],
    ["#a5b4fc", 0.25, 6, 6, 8],
  ],
  lamp: { color: "#ffe6bd", intensity: 16, height: 3.2 },
  table: { top: "#5a3a22", rim: "#3a2414", felt: "#4a3420", inlay: "#e9b949", base: "#24160c" },
  chair: "stool",
  chairColor: "#5a3a22",
  seatColors: ["#f59e0b", "#38bdf8"],
  hats: ["fedora", "cowboy"],
};

const SIGN: BubbleStyle = { bg: "rgba(36,24,12,0.92)", fg: "#fde68a", border: "#e9b949" };

export default function LostCitiesTable3D(props: LostCitiesTable3DProps) {
  const { viewerSeat, activeSeat } = props;
  const seats: TableSeat[] = [0, 1].map((seat) => {
    const mood: PersonMood = props.overview ? "clap" : activeSeat === seat ? "think" : "rest";
    const isViewer = seat === viewerSeat;
    return {
      seat,
      name: props.names[seat],
      away: props.away[seat],
      sub: `🂠 ${props.handCounts[seat]}장`,
      mood,
      lookSeat: "center",
      active: activeSeat === seat,
      tag: isViewer ? { text: "🧭 아래 손패에서 카드 선택", color: "#e9b949" } : null,
      front: (
        <group>
          <Lanes lanes={props.expeditions[seat]} target={isViewer ? props.laneTarget : null} onLane={isViewer ? props.onLane : null} />
          {!isViewer && <Hand count={props.handCounts[seat]} />}
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
        <OutdoorPlaza
          lowDetail={props.lowDetail}
          ground="#4a3d2e"
          plaza="#6b5a44"
          trim="#e9b949"
          skyline={{ kind: "mountains", color: "#3b2f45", cap: "#f5e6e0" }}
          sun={{ color: "#ffb35c", position: [-14, 4, -22], size: 2.4 }}
          torches
        />
      }
      center={<Center {...props} />}
      overview={props.overview}
      lowDetail={props.lowDetail}
    />
  );
}
