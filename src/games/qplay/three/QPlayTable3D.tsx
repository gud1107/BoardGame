"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import TableScene, { useTableGeo, type TableSeat, type TableTheme } from "@/games/shared/three/TableScene";
import { FloatIcon, FlyIn, GlowDisc, ImpactRing, TableSign } from "@/games/shared/three/tablePieces";
import { IndoorRoom } from "@/games/shared/three/environments";
import type { BubbleStyle } from "@/games/shared/three/tableKit";
import type { PersonMood } from "@/games/shared/three/SeatedPerson";
import { CLIMB_TOP, MINI_INFO, computeRankings, correctOrder, currentMini, currentQuestion, eligibleSeats, hasFinished, type GameState, type Seat } from "../engine";

/**
 * 큐플레이 3D — 퀴즈 쇼 스튜디오의 원탁. 모두 자기 캐릭터로 앉아 앞에 놓인
 * 버저가 답을 내면 켜지고, 정답 공개 때 각자 고른 답이 말풍선으로 뜨며
 * 맞힌 사람은 환호·틀린 사람은 낙담. 가운데 전광판엔 지금 게임·문제 번호,
 * 공개 땐 정답. 미사일은 쏜 사람 → 맞은 사람으로 날아가고, 조준 중인
 * 사수는 상대 자리를 눌러 바로 쏠 수 있다. 문제·보기 입력은 아래 2D 칸에서.
 */

export interface QPlayTable3DProps {
  state: GameState;
  viewerSeat: Seat;
  names: Record<Seat, string>;
  connectedSeats: Set<Seat>;
  /** 내가 사수일 때 상대 자리를 눌러 발사. */
  onFire: ((target: Seat) => void) | null;
  overview: boolean;
  lowDetail: boolean;
}

const NUMS = ["①", "②", "③", "④"];

const THEME: TableTheme = {
  background: "#0a0f2c",
  fog: [9, 22],
  ambient: ["#e0e7ff", 0.32],
  hemi: ["#a5b4fc", "#0b1026", 0.4],
  fills: [
    ["#38bdf8", 0.45, -6, 5, -5],
    ["#f472b6", 0.35, 6, 5, -4],
  ],
  lamp: { color: "#fefce8", intensity: 22, height: 3.2 },
  table: { top: "#1e1b4b", rim: "#312e81", felt: "#1e3a8a", inlay: "#facc15", base: "#0f0a2e" },
  chair: "stool",
  chairColor: "#4338ca",
  seatColors: ["#f43f5e", "#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#14b8a6", "#ec4899", "#84cc16"],
  hats: ["none", "none", "cap", "none", "none", "none", "cap", "none"],
};

const OK: BubbleStyle = { bg: "rgba(220,252,231,0.97)", fg: "#14532d", border: "#22c55e" };
const NG: BubbleStyle = { bg: "rgba(254,226,226,0.97)", fg: "#7f1d1d", border: "#ef4444" };
const signStyle = (color: string): BubbleStyle => ({ bg: "rgba(10,15,44,0.92)", fg: "#f8fafc", border: color });

/** 자리 앞 버저 — 답을 내면 자리 색으로 켜진다. */
function Buzzer({ lit, color }: { lit: boolean; color: string }) {
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (mat.current) mat.current.emissiveIntensity = lit ? 1.4 + Math.sin(clock.elapsedTime * 5) * 0.3 : 0.08;
  });
  return (
    <group>
      <mesh position={[0, 0.025, 0]} castShadow>
        <cylinderGeometry args={[0.085, 0.095, 0.05, 20]} />
        <meshStandardMaterial color="#111827" metalness={0.5} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.05, 0]}>
        <sphereGeometry args={[0.065, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial ref={mat} color={color} emissive={color} emissiveIntensity={0.08} roughness={0.3} />
      </mesh>
    </group>
  );
}

/** 쏜 사람 머리 위 → 맞은 사람으로 날아가는 미사일, 도착하면 충격파. */
function Missile({ from, to, kill }: { from: Seat; to: Seat; kill: boolean }) {
  const geo = useTableGeo();
  const { start, end } = useMemo(() => {
    const a = geo.spotOf(from, 0.1);
    const b = geo.spotOf(to, 0.1);
    a.y += 0.7;
    b.y += 0.55;
    return { start: a, end: b };
  }, [geo, from, to]);
  const offset = useMemo(() => start.clone().sub(end), [start, end]);
  return (
    <group position={end}>
      <FlyIn from={offset} dur={0.75} arc={0.6}>
        <FloatIcon icon="🚀" y={0} size={0.3} bob={0} />
      </FlyIn>
      <group position={[0, -0.5, 0]}>
        <ImpactRing color={kill ? "#ef4444" : "#fb923c"} size={1.1} dur={1.1} />
      </group>
    </group>
  );
}

export default function QPlayTable3D({ state, viewerSeat, names, connectedSeats, onFire, overview, lowDetail }: QPlayTable3DProps) {
  const mini = currentMini(state);
  const info = MINI_INFO[mini];
  const q = currentQuestion(state);
  const phase = state.phase;
  const survival = mini === "ox" || mini === "missile";
  const eligible = new Set(eligibleSeats(state));
  const order = correctOrder(state);
  const record = phase === "miniEnd" ? state.history[state.history.length - 1] : null;
  const champ = phase === "ended" ? computeRankings(state).filter((r) => r.rank === 1).map((r) => r.seat) : [];
  const shot = phase === "reveal" ? state.shot : null;

  const answerText = (s: Seat): string | null => {
    const a = state.answers[s];
    if (!a || !q) return null;
    if (q.kind === "chosung") return a.text ? `“${a.text}”` : a.wrongs?.length ? `“${a.wrongs[a.wrongs.length - 1]}”` : null;
    if (a.choice === null) return null;
    return q.kind === "ox" ? (q.choices[a.choice] === "O" ? "⭕" : "❌") : `${NUMS[a.choice]} ${q.choices[a.choice]}`;
  };

  const seats: TableSeat[] = Array.from({ length: state.seatCount }, (_, s) => {
    const total = state.scores[s] + (phase === "miniEnd" || phase === "ended" ? 0 : state.miniScores[s]);
    const out = survival && !state.alive[s] && phase !== "intro" && phase !== "miniEnd" && phase !== "ended";
    const finished = hasFinished(state, s);
    const a = state.answers[s];

    let mood: PersonMood = "rest";
    let tag: TableSeat["tag"] = null;
    let bubble: TableSeat["bubble"] = null;
    let ring: string | null = null;
    let lookSeat: TableSeat["lookSeat"] = "center";
    const parts: string[] = [];
    if (mini === "missile" && phase !== "intro" && phase !== "miniEnd" && phase !== "ended") parts.push("❤️".repeat(state.hp[s]) + "🖤".repeat(Math.max(0, 3 - state.hp[s])));
    if (phase === "climb" || (mini === "climb" && phase === "miniEnd")) parts.push(`🧗 ${state.floor[s]}층`);
    parts.push(`${total}점`);

    if (phase === "question" && eligible.has(s)) {
      if (a?.correct && q?.kind === "chosung") {
        mood = "smug";
        tag = { text: `✅ ${order.indexOf(s) + 1}등`, color: "#4ade80" };
      } else if (q?.kind === "ox" && a?.choice != null) {
        // OX는 광장에서 서 있는 쪽이 다 보이니 3D에서도 지금 쪽을 띄운다(시간 끝까지 바뀔 수 있음)
        mood = "nervous";
        tag = a.choice === 0 ? { text: "⭕ 쪽", color: "#7dd3fc" } : { text: "❌ 쪽", color: "#fda4af" };
      } else if (finished) {
        tag = { text: "✔️ 답변 완료", color: "#e2e8f0" };
      } else {
        mood = q?.kind === "chosung" ? "write" : "think";
      }
    } else if (phase === "aim") {
      if (state.shooter === s) {
        mood = "raise";
        ring = "#fb923c";
        tag = { text: "🚀 조준 중", color: "#fdba74" };
      } else if (state.alive[s]) {
        mood = "nervous";
        lookSeat = state.shooter;
      }
    } else if (phase === "reveal") {
      const text = answerText(s);
      if (text && a) bubble = { text, style: a.correct ? OK : NG, key: `${state.stage}-${s}`, width: text.length > 6 ? 0.95 : 0.5 };
      if (a?.correct) {
        mood = order[0] === s ? "cheer" : "clap";
        ring = "#22c55e";
      } else if (eligible.has(s) || state.eliminated.includes(s)) {
        mood = a ? "sad" : "shrug";
        if (a) ring = "#ef4444";
      }
      if (state.gained[s] > 0) tag = { text: `+${state.gained[s]}`, color: "#4ade80" };
      if (state.eliminated.includes(s)) {
        mood = "slump";
        tag = { text: "💀 탈락", color: "#fca5a5" };
      }
      if (shot?.from === s) {
        mood = "point";
        lookSeat = shot.to;
      }
      if (shot?.to === s) {
        mood = shot.kill ? "slump" : "shock";
        tag = { text: shot.kill ? "💥 격추!" : "💥 하트 −1", color: "#fca5a5" };
      }
      if (state.revived) mood = "laugh";
    } else if (phase === "climb") {
      const top = state.floor[s] >= CLIMB_TOP;
      const place = state.finishOrder.indexOf(s);
      mood = top ? "cheer" : state.lastClimb[s] === false ? "shrug" : "think";
      if (top) tag = { text: place === 0 ? "🥇 꼭대기!" : place === 1 ? "🥈 도착" : place === 2 ? "🥉 도착" : "🏁 도착", color: "#facc15" };
      else if (state.lastClimb[s] === true) tag = { text: "⬆️", color: "#4ade80" };
    } else if (record) {
      const win = record.winners.includes(s);
      mood = win ? "cheer" : "clap";
      tag = win ? { text: `👑 +${record.scores[s]}`, color: "#facc15" } : { text: `+${record.scores[s]}`, color: "#cbd5e1" };
    } else if (phase === "ended") {
      mood = champ.includes(s) ? "cheer" : "clap";
      if (champ.includes(s)) tag = { text: "🏆 우승", color: "#facc15" };
    }

    const fireable = onFire && phase === "aim" && state.shooter === viewerSeat && s !== viewerSeat && state.alive[s];
    const color = THEME.seatColors[s % THEME.seatColors.length];
    return {
      seat: s,
      name: names[s] ?? `플레이어 ${s + 1}`,
      sub: parts.join(" · "),
      mood,
      lookSeat,
      out,
      away: !connectedSeats.has(s),
      active: state.shooter === s && phase === "aim",
      ring: fireable ? "#fb923c" : ring,
      bubble,
      tag: fireable ? { text: `🎯 ${state.hp[s] === 1 ? "격추 가능!" : "눌러서 발사"}`, color: "#fdba74" } : tag,
      front: <Buzzer lit={(phase === "question" && finished) || (phase === "reveal" && !!a?.correct)} color={color} />,
      onSelect: fireable ? () => onFire(s) : null,
    };
  });

  let sign = `${info.emoji} ${info.name}`;
  if (phase === "question" || phase === "aim") sign += ` · Q${state.qIndex + 1}/${state.questions.length}`;
  if (phase === "reveal" && q) sign = `정답 ${q.kind === "chosung" ? q.word : q.kind === "ox" ? (q.choices[q.answer] === "O" ? "⭕" : "❌") : q.choices[q.answer]}`;
  if (phase === "miniEnd") sign = `${info.emoji} ${info.name} 결과`;
  if (phase === "ended") sign = "🏆 최종 결과";

  return (
    <TableScene
      cameraKey="qplay-camera"
      seatCount={state.seatCount}
      viewerSeat={viewerSeat}
      seats={seats}
      theme={THEME}
      environment={
        <IndoorRoom
          lowDetail={lowDetail}
          wall="#111843"
          floor={{ kind: "tiles", a: "#1e1b4b", b: "#312e81" }}
          rug="#172554"
          trim="#facc15"
          banners={{ colors: ["#f43f5e", "#3b82f6", "#22c55e", "#f59e0b"], emblem: "Q" }}
          frames={["#38bdf8", "#f472b6", "#facc15"]}
        />
      }
      center={
        <group>
          <GlowDisc color={info.color} r={0.55} opacity={0.4} />
          {phase === "reveal" && <ImpactRing key={state.stage} color={order.length ? "#22c55e" : "#ef4444"} size={1.4} dur={0.9} />}
          <TableSign text={sign} style={signStyle(info.color)} y={1.3} width={phase === "reveal" ? 1.2 : 1.35} />
        </group>
      }
      extras={shot && <Missile key={state.stage} from={shot.from} to={shot.to} kill={shot.kill} />}
      overview={overview}
      lowDetail={lowDetail}
      ringColor={info.color}
    />
  );
}
