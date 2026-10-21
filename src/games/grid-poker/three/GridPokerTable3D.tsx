"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import TableScene, { type TableSeat, type TableTheme } from "@/games/shared/three/TableScene";
import { FlatCard, PopIn, TableSign, DeckPile } from "@/games/shared/three/tablePieces";
import { IndoorRoom } from "@/games/shared/three/environments";
import { simpleBackTexture, simpleCardTexture, FONTS, type BubbleStyle } from "@/games/shared/three/tableKit";
import type { PersonMood } from "@/games/shared/three/SeatedPerson";
import { rankLabel, SUIT_SYMBOL } from "../cardDisplay";
import type { Card } from "../engine";

/**
 * 그리드 포커 3D — 딥하우스 조명의 카드 라운지. 각자 앞에 5×5 판이 누워 있고
 * (공개 정보 — 모두가 서로의 판을 본다), 이번에 놓은 칸이 빛난다. 가운데엔
 * 이번 라운드 공통 카드. 제출 단계엔 누가 냈는지만, 결과 땐 승자가 환호.
 * 각 판은 상태가 바뀔 때만 한 장의 텍스처로 다시 그려 8인도 가볍다.
 */

export interface GridSeat3D {
  seat: number;
  name: string;
  board: (Card | null)[];
  lastPlaced: number | null;
  placed: boolean;
  submitted: boolean;
  score: number;
  away?: boolean;
}

export interface GridPokerTable3DProps {
  playerCount: number;
  viewerSeat: number;
  seats: GridSeat3D[];
  phase: string;
  currentCard: Card | null;
  winnerSeat: number | null;
  sign: string;
  threshold: number;
  overview: boolean;
  lowDetail: boolean;
}

const RED = new Set(["D", "H"]);
function cardText(c: Card) {
  return c.kind === "joker" ? { t: "★", s: "J", red: true } : { t: rankLabel(c.rank), s: SUIT_SYMBOL[c.suit], red: RED.has(c.suit) };
}

/** Paints one board; not cached globally (it changes every placement) — `Board` owns and disposes it. */
function paintBoard(board: (Card | null)[], hi: number | null): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 320;
  const ctx = c.getContext("2d")!;
  const W = 320;
  {
    ctx.fillStyle = "#0b1220";
    ctx.beginPath();
    ctx.roundRect(0, 0, W, W, 18);
    ctx.fill();
    const cell = (W - 20) / 5;
    for (let i = 0; i < 25; i++) {
      const x = 10 + (i % 5) * cell;
      const y = 10 + Math.floor(i / 5) * cell;
      const c = board[i];
      ctx.fillStyle = c ? "#f8fafc" : "rgba(148,163,184,0.12)";
      ctx.beginPath();
      ctx.roundRect(x + 3, y + 3, cell - 6, cell - 6, 8);
      ctx.fill();
      if (i === hi) {
        ctx.strokeStyle = "#facc15";
        ctx.lineWidth = 6;
        ctx.stroke();
      }
      if (c) {
        const t = cardText(c);
        ctx.fillStyle = t.red ? "#dc2626" : "#0f172a";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = `900 26px ${FONTS.text}`;
        ctx.fillText(t.t, x + cell / 2, y + cell * 0.38);
        ctx.font = `24px ${FONTS.text}`;
        ctx.fillText(t.s, x + cell / 2, y + cell * 0.72);
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const back = () => simpleBackTexture("gridpoker", "#1e3a8a", "#0b1220", "#93c5fd", "🃏");
function bigCard(c: Card) {
  const t = cardText(c);
  return simpleCardTexture(`gridpoker:${c.id}`, { big: t.t, icon: c.kind === "joker" ? "🃏" : undefined, caption: t.s, corner: t.s, bg: ["#f8fafc", "#cbd5e1"], edge: t.red ? "#dc2626" : "#0f172a", fg: t.red ? "#dc2626" : "#0f172a" });
}

function Board({ board, hi }: { board: (Card | null)[]; hi: number | null }) {
  const key = board.map((c) => c?.id ?? "-").join(",") + `|${hi}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` captures board + highlight
  const tex = useMemo(() => paintBoard(board, hi), [key]);
  useEffect(() => () => tex.dispose(), [tex]);
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, 0.006, -0.12]} receiveShadow>
      <planeGeometry args={[0.62, 0.62]} />
      <meshStandardMaterial map={tex} roughness={0.6} />
    </mesh>
  );
}

const THEME: TableTheme = {
  background: "#060812",
  fog: [9, 22],
  ambient: ["#c7d2fe", 0.26],
  hemi: ["#a5b4fc", "#060812", 0.38],
  fills: [
    ["#22d3ee", 0.45, -5, 4, -4],
    ["#a855f7", 0.4, 5, 4, -4],
  ],
  lamp: { color: "#e0f2fe", intensity: 22, height: 3.2 },
  table: { top: "#0b1220", rim: "#1e293b", felt: "#0f1a33", inlay: "#22d3ee", base: "#0b1220" },
  chair: "stool",
  chairColor: "#1e293b",
  seatColors: ["#22d3ee", "#f472b6", "#facc15", "#4ade80", "#a78bfa", "#fb923c", "#38bdf8", "#f87171"],
  hats: ["cap", "none", "beret", "none", "fedora", "none"],
};

const SIGN: BubbleStyle = { bg: "rgba(8,12,30,0.92)", fg: "#e0f2fe", border: "#22d3ee" };
const WIN: BubbleStyle = { bg: "rgba(254,249,195,0.97)", fg: "#713f12", border: "#facc15" };

export default function GridPokerTable3D(props: GridPokerTable3DProps) {
  const { viewerSeat, phase } = props;
  const seats: TableSeat[] = props.seats.map((s) => {
    let mood: PersonMood = "rest";
    if (phase === "placing") mood = s.placed ? "smug" : "think";
    else if (phase === "submitting") mood = s.submitted ? "smug" : "write";
    else if (phase === "round-result") mood = props.winnerSeat === s.seat ? "cheer" : "clap";
    return {
      seat: s.seat,
      name: s.name,
      away: s.away,
      sub: `🏆 ${s.score}/${props.threshold}승${phase === "submitting" ? (s.submitted ? " · ✅" : " · …") : phase === "placing" ? (s.placed ? " · ✅" : "") : ""}`,
      mood,
      lookSeat: "center",
      ring: props.winnerSeat === s.seat && phase === "round-result" ? "#facc15" : null,
      bubble: props.winnerSeat === s.seat && phase === "round-result" ? { text: "이번 라운드 승! 🏆", style: WIN, key: `w${s.score}`, width: 0.75 } : null,
      tag: s.seat === viewerSeat ? { text: `🏆 내 승수 ${s.score}/${props.threshold}`, color: "#22d3ee" } : null,
      front: <Board board={s.board} hi={s.lastPlaced} />,
    };
  });

  return (
    <TableScene
      seatCount={props.playerCount}
      viewerSeat={viewerSeat}
      seats={seats}
      theme={THEME}
      environment={
        <IndoorRoom
          lowDetail={props.lowDetail}
          wall="#0a0f1e"
          floor={{ kind: "tiles", a: "#0b1220", b: "#111b33" }}
          rug="#0f1a33"
          trim="#22d3ee"
          windows={{ color: "#a855f7", count: 5 }}
        />
      }
      center={
        <group>
          <group position={[-0.34, 0, 0]} rotation-y={0.2}>
            <DeckPile count={12} back={back()} w={0.2} h={0.28} />
          </group>
          {props.currentCard && (
            <group key={props.currentCard.id}>
              <PopIn>
                <FlatCard face={bigCard(props.currentCard)} back={back()} w={0.3} h={0.42} glow="#22d3ee" />
              </PopIn>
            </group>
          )}
          <TableSign text={props.sign} style={SIGN} y={0.95} />
        </group>
      }
      overview={props.overview}
      lowDetail={props.lowDetail}
      ringColor="#22d3ee"
    />
  );
}
