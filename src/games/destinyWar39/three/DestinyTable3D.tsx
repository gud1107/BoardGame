"use client";

import TableScene, { useTableGeo, type TableSeat, type TableTheme } from "@/games/shared/three/TableScene";
import { HeldFan, FlatCard, FlyIn, ImpactRing, StandingCard, TableSign } from "@/games/shared/three/tablePieces";
import { OutdoorPlaza } from "@/games/shared/three/environments";
import { simpleBackTexture, simpleCardTexture, type BubbleStyle } from "@/games/shared/three/tableKit";
import type { PersonMood } from "@/games/shared/three/SeatedPerson";
import { isReverseCard, type Card, type PlayerCount } from "../engine";

/**
 * 운명전쟁39 3D — 네온 도시 옥상의 원탁. 자리 순서대로 앉아, 각자 앞에는
 * 이번 라운드 손패(뒷면, 장수만)와 예측 팻말(예측 단계엔 "제출함"만, 히든은
 * 끝까지 ❓), 이번 턴에 낸 카드는 그 자리에서 앞으로 날아와 앞면으로 선다.
 * 턴을 가져간 사람은 승수가 오르며 환호, 데스 카드는 붉은 충격파.
 */

export interface DestinySeat3D {
  seat: number;
  name: string;
  handCount: number;
  /** 보이는 예측 (숫자 / "hidden" / "pending" / "submitted"). */
  prediction: number | "hidden" | "pending" | "submitted";
  wins: number;
  played: Card | null;
  away?: boolean;
}

export interface DestinyTable3DProps {
  order: number[];
  viewerSeat: number;
  playerCount: PlayerCount;
  seats: DestinySeat3D[];
  phase: string;
  round: number;
  turn: number;
  actingSeat: number | null;
  lastTurnWinner: number | null;
  lastTurnKey: string;
  overview: boolean;
  lowDetail: boolean;
}

const back = () => simpleBackTexture("dw39", "#4a044e", "#12001a", "#f0abfc", "🌃");
function face(c: Card, n: PlayerCount) {
  if (c.kind === "death") return simpleCardTexture("dw39:death", { icon: "☠️", big: "DEATH", bg: ["#450a0a", "#0a0000"], edge: "#f87171" });
  const rev = isReverseCard(c, n);
  return simpleCardTexture(`dw39:${c.value}:${rev}`, { big: String(c.value), corner: String(c.value), caption: rev ? "🔄 리버스" : "", bg: rev ? ["#a21caf", "#2e0333"] : ["#1e3a8a", "#050b24"], edge: rev ? "#f0abfc" : "#7dd3fc" });
}

function predictionTex(p: DestinySeat3D["prediction"]) {
  const label = typeof p === "number" ? String(p) : p === "hidden" ? "❓" : p === "submitted" ? "✓" : "…";
  return simpleCardTexture(`dw39:pred:${label}`, { big: label, caption: "예측", bg: p === "hidden" ? ["#581c87", "#1e0a3c"] : ["#0f172a", "#020617"], edge: "#f0abfc" });
}

function Played({ seat, card, n }: { seat: number; card: Card; n: PlayerCount }) {
  const geo = useTableGeo();
  const p = geo.spotOf(seat, 0.75);
  const from = geo.spotOf(seat, 0.4).sub(p);
  return (
    <group position={[p.x, geo.tableY, p.z]} rotation-y={geo.angleOf(seat)}>
      <FlyIn key={card.id} from={from} dur={0.4} arc={0.3}>
        <FlatCard face={face(card, n)} back={back()} w={0.2} h={0.28} glow={card.kind === "death" ? "#ef4444" : null} />
        {card.kind === "death" && <ImpactRing color="#ef4444" size={1} />}
      </FlyIn>
    </group>
  );
}

const THEME: TableTheme = {
  background: "#0a0618",
  fog: [12, 34],
  ambient: ["#e9d5ff", 0.26],
  hemi: ["#c4b5fd", "#0a0618", 0.4],
  fills: [
    ["#ec4899", 0.45, -6, 5, -6],
    ["#22d3ee", 0.4, 6, 5, -6],
  ],
  lamp: { color: "#f5e1ff", intensity: 18, height: 3.3 },
  table: { top: "#12081f", rim: "#1f1030", felt: "#170b29", inlay: "#e879f9", base: "#0c0614" },
  chair: "stool",
  chairColor: "#2a1640",
  seatColors: ["#e879f9", "#22d3ee", "#facc15", "#4ade80", "#fb923c", "#a78bfa", "#f87171", "#38bdf8"],
  hats: ["cap", "none", "fedora", "beret", "none"],
};

const SIGN: BubbleStyle = { bg: "rgba(18,6,32,0.92)", fg: "#f5d0fe", border: "#e879f9" };
const WIN: BubbleStyle = { bg: "rgba(250,232,255,0.97)", fg: "#701a75", border: "#e879f9" };

export default function DestinyTable3D(props: DestinyTable3DProps) {
  const { order, viewerSeat, phase, actingSeat } = props;
  const pos = (s: number) => Math.max(0, order.indexOf(s));
  const seats: TableSeat[] = props.seats.map((s) => {
    let mood: PersonMood = "rest";
    if (phase === "predicting") mood = s.prediction === "pending" ? "think" : "smug";
    else if (phase === "playing") mood = actingSeat === s.seat ? "think" : s.played ? "rest" : "nervous";
    if (props.lastTurnWinner === s.seat && phase === "playing") mood = "cheer";
    if (phase === "roundEnd" || phase === "gameOver") mood = typeof s.prediction === "number" && s.prediction === s.wins ? "cheer" : "shrug";
    const pred = s.prediction;
    return {
      seat: pos(s.seat),
      name: s.name,
      away: s.away,
      sub: `🎯 ${typeof pred === "number" ? pred : pred === "hidden" ? "❓" : pred === "submitted" ? "✓" : "…"} · 🏆 ${s.wins}`,
      mood,
      lookSeat: actingSeat !== null && actingSeat !== s.seat ? pos(actingSeat) : "center",
      active: actingSeat === s.seat,
      bubble: props.lastTurnWinner === s.seat && phase === "playing" ? { text: "이 턴은 내 것!", style: WIN, key: props.lastTurnKey, width: 0.7 } : null,
      tag: s.seat === viewerSeat ? { text: `🎯 내 예측 ${typeof pred === "number" ? pred : pred === "hidden" ? "히든" : "…"} · 🏆 ${s.wins}`, color: "#e879f9" } : null,
      held: s.seat !== viewerSeat && s.handCount > 0 ? <HeldFan count={s.handCount} back={back()} max={9} /> : null,
      front: (
        <group>
          <group position={[0.4, 0, 0.02]}>
            <StandingCard face={predictionTex(pred)} back={back()} w={0.12} h={0.17} tilt={-0.6} />
          </group>
        </group>
      ),
    };
  });

  const me = props.seats.find((x) => x.seat === viewerSeat);
  return (
    <TableScene
      cameraKey="destiny-war39-camera"
      // my own body holds my hand too (backs: the 2D hand panel shows the faces)
      selfView={{ held: me && me.handCount > 0 ? <HeldFan count={me.handCount} back={back()} max={9} /> : null }}
      seatCount={order.length}
      viewerSeat={pos(viewerSeat)}
      seats={seats}
      theme={THEME}
      environment={
        <OutdoorPlaza
          lowDetail={props.lowDetail}
          ground="#120a1f"
          plaza="#1c1030"
          trim="#e879f9"
          skyline={{ kind: "city", color: "#160c28", cap: "#e879f9" }}
          wall="#1f1030"
        />
      }
      center={<TableSign text={`ROUND ${props.round} / 9${phase === "playing" ? ` · 턴 ${props.turn}` : phase === "predicting" ? " · 승수 예측" : ""}`} style={SIGN} y={0.8} />}
      extras={props.seats.filter((s) => s.played).map((s) => <Played key={`${s.seat}-${s.played!.id}`} seat={pos(s.seat)} card={s.played!} n={props.playerCount} />)}
      overview={props.overview}
      lowDetail={props.lowDetail}
      ringColor="#e879f9"
    />
  );
}
