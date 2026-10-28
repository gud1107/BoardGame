"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import TableScene, { type TableSeat, type TableTheme } from "@/games/shared/three/TableScene";
import { ImpactRing, TableSign } from "@/games/shared/three/tablePieces";
import { IndoorRoom } from "@/games/shared/three/environments";
import type { BubbleStyle } from "@/games/shared/three/tableKit";
import type { PersonMood } from "@/games/shared/three/SeatedPerson";

/**
 * 진실의 고개 3D — 어두운 수사실의 원탁. 가운데엔 딜러의 신호등(초록/노랑/
 * 빨강)이 서 있고, 방금 나온 질문의 판정 색이 켜지며 충격파가 퍼진다.
 * 질문한 사람 머리 위엔 질문 말풍선(히든 질문은 🔒 표시만 — 내용 비공개),
 * 정답을 틀린 사람은 낙담 + 쿨타임 태그, 맞힌 사람은 환호.
 */

export type Verdict = "green" | "yellow" | "red";

export interface HillSeat3D {
  seat: number;
  name: string;
  /** 이 좌석의 최근 질문 (보이는 내용만). */
  question: { text: string; hidden: boolean; verdict: Verdict; key: string } | null;
  coolingDown: boolean;
  wrongRecently: boolean;
  away?: boolean;
}

export interface HillTable3DProps {
  order: number[];
  viewerSeat: number;
  seats: HillSeat3D[];
  activeSeat: number | null;
  verdict: Verdict | null;
  verdictKey: number;
  winnerSeat: number | null;
  title: string;
  overview: boolean;
  lowDetail: boolean;
}

const LAMP_COLORS: Record<Verdict, string> = { green: "#22c55e", yellow: "#facc15", red: "#ef4444" };

function Semaphore({ verdict }: { verdict: Verdict | null }) {
  const mats = useRef<Record<Verdict, THREE.MeshStandardMaterial | null>>({ green: null, yellow: null, red: null });
  useFrame(({ clock }) => {
    for (const v of ["green", "yellow", "red"] as Verdict[]) {
      const m = mats.current[v];
      if (m) m.emissiveIntensity = verdict === v ? 2.2 + Math.sin(clock.elapsedTime * 6) * 0.4 : 0.05;
    }
  });
  return (
    <group>
      <mesh position={[0, 0.3, 0]} castShadow>
        <cylinderGeometry args={[0.03, 0.05, 0.6, 10]} />
        <meshStandardMaterial color="#1f2937" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.78, 0]} castShadow>
        <boxGeometry args={[0.22, 0.56, 0.16]} />
        <meshStandardMaterial color="#111827" metalness={0.4} roughness={0.5} />
      </mesh>
      {(["red", "yellow", "green"] as Verdict[]).map((v, i) => (
        <group key={v}>
          {/* face both ways so the whole table sees it */}
          {[1, -1].map((side) => (
            <mesh key={side} position={[0, 0.96 - i * 0.18, 0.082 * side]} rotation-y={side < 0 ? Math.PI : 0}>
              <circleGeometry args={[0.065, 24]} />
              <meshStandardMaterial
                ref={(m) => {
                  if (side === 1) mats.current[v] = m;
                }}
                color={LAMP_COLORS[v]}
                emissive={LAMP_COLORS[v]}
                emissiveIntensity={0.05}
              />
            </mesh>
          ))}
        </group>
      ))}
      {verdict && <pointLight position={[0, 0.8, 0]} color={LAMP_COLORS[verdict]} intensity={4} distance={4} decay={2} />}
    </group>
  );
}

const THEME: TableTheme = {
  background: "#06080c",
  fog: [8, 20],
  ambient: ["#cbd5e1", 0.2],
  hemi: ["#94a3b8", "#05070a", 0.32],
  fills: [["#38bdf8", 0.3, -6, 5, -6]],
  lamp: { color: "#f1f5f9", intensity: 20, height: 3.1 },
  table: { top: "#1f2937", rim: "#111827", felt: "#172033", inlay: "#22d3ee", base: "#0b1018" },
  chair: "wood",
  chairColor: "#1f2937",
  seatColors: ["#22d3ee", "#f472b6", "#facc15", "#4ade80", "#a78bfa", "#fb923c", "#38bdf8", "#f87171"],
  hats: ["fedora", "none", "bowler", "none", "cap", "none"],
};

const QSTYLE: Record<Verdict, BubbleStyle> = {
  green: { bg: "rgba(220,252,231,0.97)", fg: "#14532d", border: "#22c55e" },
  yellow: { bg: "rgba(254,249,195,0.97)", fg: "#713f12", border: "#facc15" },
  red: { bg: "rgba(254,226,226,0.97)", fg: "#7f1d1d", border: "#ef4444" },
};
const SIGN: BubbleStyle = { bg: "rgba(8,12,20,0.92)", fg: "#e2e8f0", border: "#22d3ee" };

export default function HillTable3D(props: HillTable3DProps) {
  const { order, viewerSeat, activeSeat } = props;
  const pos = (s: number) => Math.max(0, order.indexOf(s));
  const seats: TableSeat[] = props.seats.map((s) => {
    let mood: PersonMood = activeSeat === s.seat ? "think" : "rest";
    if (s.question) mood = s.question.verdict === "green" ? "smug" : s.question.verdict === "red" ? "shrug" : "nervous";
    if (activeSeat === s.seat) mood = "write";
    if (s.wrongRecently) mood = "sad";
    if (props.winnerSeat !== null) mood = props.winnerSeat === s.seat ? "cheer" : "clap";
    return {
      seat: pos(s.seat),
      name: s.name,
      away: s.away,
      sub: s.coolingDown ? "⏳ 오답 쿨타임" : null,
      mood,
      lookSeat: "center",
      active: activeSeat === s.seat,
      ring: s.question ? LAMP_COLORS[s.question.verdict] : null,
      bubble: s.question ? { text: s.question.hidden ? "🔒 히든 질문" : s.question.text, style: QSTYLE[s.question.verdict], key: s.question.key, width: s.question.hidden ? 0.6 : 1.05 } : null,
      tag: props.winnerSeat === s.seat ? { text: "🏆 진실을 밝혀냄", color: "#facc15" } : null,
    };
  });

  return (
    <TableScene
      cameraKey="hill-of-truth-camera"
      seatCount={order.length}
      viewerSeat={pos(viewerSeat)}
      seats={seats}
      theme={THEME}
      environment={
        <IndoorRoom
          lowDetail={props.lowDetail}
          wall="#0d1117"
          floor={{ kind: "planks", a: "#161b22", b: "#30363d" }}
          rug="#0f172a"
          trim="#22d3ee"
          windows={{ color: "#1e3a5f", count: 2 }}
          frames={["#334155", "#1e293b", "#475569"]}
        />
      }
      center={
        <group>
          <Semaphore verdict={props.verdict} />
          {props.verdict && <ImpactRing key={props.verdictKey} color={LAMP_COLORS[props.verdict]} size={1.6} dur={0.9} />}
          <TableSign text={props.title} style={SIGN} y={1.4} width={1.3} />
        </group>
      }
      overview={props.overview}
      lowDetail={props.lowDetail}
      ringColor="#22d3ee"
    />
  );
}
