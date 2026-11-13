"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import TableScene, { useTableGeo, type TableSeat, type TableTheme } from "@/games/shared/three/TableScene";
import { CardRow, DeckPile, FlatCard, FloatIcon, ImpactRing, TableSign } from "@/games/shared/three/tablePieces";
import { IndoorRoom } from "@/games/shared/three/environments";
import { simpleBackTexture, simpleCardTexture, type BubbleStyle } from "@/games/shared/three/tableKit";
import type { PersonMood } from "@/games/shared/three/SeatedPerson";
import { GHOST_EMOJI, GHOST_LABEL, type TaleCard, type TaleEvent } from "../engine";

/**
 * 백 개의 괴담 3D — a dark tatami room lit only by the candle ring on the
 * table. Every candle is one instance; snuffed ones go dark and the room's
 * only light (a flickering point light over the ring + a barely-there lamp)
 * dims with what's left. The teller's unbanked story lies face up in front
 * of them, the last card told sits in the middle, and a possession throws
 * the ghost up over the table.
 */

export interface TalesSeat3D {
  seat: number;
  name: string;
  color: string;
  away: boolean;
  score: number;
  salts: number;
}

export interface TalesTable3DProps {
  playerCount: number;
  viewerSeat: number;
  seats: TalesSeat3D[];
  activeSeat: number | null;
  story: TaleCard[];
  candles: number;
  candlesMax: number;
  lastEvent: TaleEvent | null;
  peekCard: TaleCard | null;
  deckCount: number;
  ended: boolean;
  winnerSeat: number | null;
  cursedSeat: number | null;
  lowDetail: boolean;
}

const back = () => simpleBackTexture("tales", "#3b0d0d", "#0c0606", "#a8a29e", "🕯️");
const face = (c: TaleCard) =>
  simpleCardTexture(`tales:${c.kind}:${c.fear}`, {
    icon: GHOST_EMOJI[c.kind],
    big: c.fear > 0 ? `${c.fear}` : "",
    caption: GHOST_LABEL[c.kind],
    corner: c.fear > 0 ? `${c.fear}` : "",
    bg: c.fear > 0 ? ["#2a1717", "#0b0707"] : ["#1f2937", "#0b0f16"],
    edge: c.fear >= 3 ? "#fca5a5" : "#d6d3d1",
    fg: "#f5f5f4",
  });

const SIGN: BubbleStyle = { bg: "rgba(12,6,6,0.9)", fg: "#fde68a", border: "#7f1d1d" };
const DREAD: BubbleStyle = { bg: "rgba(76,5,25,0.94)", fg: "#ffe4e6", border: "#fb7185" };
const CALM: BubbleStyle = { bg: "rgba(28,25,23,0.9)", fg: "#f5f5f4", border: "#a8a29e" };

const THEME: TableTheme = {
  background: "#030202",
  fog: [5, 15],
  ambient: ["#fde68a", 0.04],
  hemi: ["#475569", "#050303", 0.06],
  fills: [["#60a5fa", 0.08, -6, 5, -4]],
  lamp: { color: "#fbbf24", intensity: 6, height: 3 },
  table: { top: "#2b1a12", rim: "#1c110b", felt: "#2b1a12", inlay: "#7f1d1d", base: "#120a06" },
  chair: "wood",
  chairColor: "#3f2a1d",
  seatColors: ["#f87171", "#60a5fa", "#a3e635", "#fbbf24", "#c084fc", "#f472b6"],
  hats: ["none"],
  // the candles are the light: almost no studio reflections, strong bloom on the flames
  fx: { env: 0.06, bloom: 0.9 },
};

/** The ring of candles: wax bodies (instanced) + flames for the lit ones + one flickering light. */
function CandleRing({ lit, total }: { lit: number; total: number }) {
  const geo = useTableGeo();
  const bodies = useRef<THREE.InstancedMesh>(null);
  const flames = useRef<THREE.InstancedMesh>(null);
  const light = useRef<THREE.PointLight>(null);
  const flameGroup = useRef<THREE.Group>(null);

  const spots = useMemo(() => {
    const out: THREE.Vector3[] = [];
    const rOuter = geo.tableR * 0.62;
    const rInner = geo.tableR * 0.47;
    const outer = Math.ceil(total * 0.56);
    for (let i = 0; i < total; i++) {
      const ring = i < outer ? 0 : 1;
      const k = ring === 0 ? i : i - outer;
      const count = ring === 0 ? outer : total - outer;
      const a = (k / count) * Math.PI * 2 + ring * 0.05;
      const r = ring === 0 ? rOuter : rInner;
      out.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
    }
    return out;
  }, [geo.tableR, total]);

  // per-candle height jitter so the ring doesn't look stamped
  const heights = useMemo(() => spots.map((_, i) => 0.06 + ((i * 37) % 11) * 0.004), [spots]);

  useEffect(() => {
    const m = new THREE.Matrix4();
    const lit_ = new THREE.Color("#f5f0e1");
    const out = new THREE.Color("#3f3a34");
    const b = bodies.current;
    const f = flames.current;
    if (!b || !f) return;
    let fi = 0;
    spots.forEach((p, i) => {
      const h = heights[i];
      m.compose(new THREE.Vector3(p.x, h / 2, p.z), new THREE.Quaternion(), new THREE.Vector3(1, h / 0.08, 1));
      b.setMatrixAt(i, m);
      b.setColorAt(i, i < lit ? lit_ : out);
      if (i < lit) {
        m.compose(new THREE.Vector3(p.x, h + 0.02, p.z), new THREE.Quaternion(), new THREE.Vector3(1, 1.9, 1));
        f.setMatrixAt(fi++, m);
      }
    });
    f.count = fi;
    b.instanceMatrix.needsUpdate = true;
    if (b.instanceColor) b.instanceColor.needsUpdate = true;
    f.instanceMatrix.needsUpdate = true;
  }, [spots, heights, lit]);

  const frac = total > 0 ? lit / total : 0;
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const flick = 0.85 + Math.sin(t * 13.1) * 0.06 + Math.sin(t * 7.3 + 1) * 0.05 + Math.sin(t * 23.7) * 0.04;
    if (light.current) light.current.intensity = (0.3 + frac * 7) * flick;
    if (flameGroup.current) flameGroup.current.scale.set(1, 0.9 + (flick - 0.85) * 2.2, 1);
  });

  return (
    <group>
      <instancedMesh ref={bodies} args={[undefined, undefined, total]} castShadow={false}>
        <cylinderGeometry args={[0.014, 0.016, 0.08, 8]} />
        <meshStandardMaterial roughness={0.6} />
      </instancedMesh>
      <group ref={flameGroup}>
        <instancedMesh ref={flames} args={[undefined, undefined, total]}>
          <sphereGeometry args={[0.013, 8, 6]} />
          <meshBasicMaterial color={[4, 2.1, 0.7]} toneMapped={false} />
        </instancedMesh>
      </group>
      <pointLight ref={light} position={[0, 0.5, 0]} color="#ffad5c" distance={6} decay={1.6} />
    </group>
  );
}

function mood(s: TalesSeat3D, p: TalesTable3DProps): PersonMood {
  const ev = p.lastEvent;
  if (p.ended) return s.seat === p.cursedSeat ? "shock" : s.seat === p.winnerSeat ? "cheer" : "sad";
  if (ev && ev.seat === s.seat && ev.act === "bust") return "shock";
  if (s.seat === p.activeSeat) return p.story.length >= 3 ? "nervous" : "talk";
  if (ev && ev.act === "bust") return "laugh";
  if (p.candles <= p.candlesMax * 0.15) return "nervous";
  return "rest";
}

function bubbleFor(s: TalesSeat3D, p: TalesTable3DProps): TableSeat["bubble"] {
  const ev = p.lastEvent;
  if (!ev || ev.seat !== s.seat) return null;
  const key = `${ev.act}-${ev.turn}`;
  if (ev.act === "bust") return { text: `${GHOST_EMOJI[ev.card.kind]} 씌었다!`, style: DREAD, key };
  if (ev.act === "curse") return { text: "💀 백 번째 이야기…", style: DREAD, key };
  if (ev.act === "perfect") return { text: "👻 다섯 귀신이 다 모였다", style: SIGN, key };
  if (ev.act === "stop") return { text: ev.gained > 0 ? `여기까지… (+${ev.gained})` : "여기까지…", style: CALM, key };
  return null;
}

export default function TalesTable3D(props: TalesTable3DProps) {
  const { viewerSeat, ended } = props;
  const frac = props.candlesMax > 0 ? props.candles / props.candlesMax : 0;
  const ev = props.lastEvent;
  const storyFaces = props.story.map(face);
  const seats: TableSeat[] = props.seats.map((s) => {
    const active = s.seat === props.activeSeat;
    return {
      seat: s.seat,
      name: s.name,
      color: s.color,
      away: s.away,
      sub: s.away ? "📡 연결 대기" : `${s.score}점${s.salts > 0 ? ` · 🧂${s.salts}` : ""}`,
      mood: mood(s, props),
      active,
      lookSeat: active ? "center" : props.activeSeat,
      ring: active ? "#f59e0b" : null,
      bubble: bubbleFor(s, props),
      tag: null,
      front: active && storyFaces.length > 0 ? <CardRow faces={storyFaces} back={back()} w={0.14} h={0.2} perRow={5} /> : null,
    };
  });

  const shownCard = ev && "card" in ev ? ev.card : null;
  const status = ended ? (props.cursedSeat !== null ? "💀 마지막 촛불이 꺼졌다" : "끝") : `🕯️ ${props.candles} / ${props.candlesMax}`;
  const ghostUp = ev && (ev.act === "bust" || ev.act === "curse") ? GHOST_EMOJI[ev.card.kind] : null;

  return (
    <TableScene
      cameraKey="hundred-tales-camera"
      seatCount={props.playerCount}
      viewerSeat={viewerSeat}
      seats={seats}
      theme={THEME}
      lampDim={0.15 + frac * 0.5}
      environment={
        <IndoorRoom
          lowDetail={props.lowDetail}
          wall="#140d09"
          floor={{ kind: "planks", a: "#1a110b", b: "#2a1c12" }}
          rug="#1f1611"
          trim="#3f2a1d"
          windows={{ color: "#2b3a5c", count: 3 }}
        />
      }
      center={
        <group>
          <CandleRing lit={props.candles} total={props.candlesMax} />
          <group position={[-0.32, 0, 0]}>
            <DeckPile count={Math.min(24, props.deckCount)} back={back()} w={0.22} h={0.31} />
          </group>
          {shownCard && (
            <group key={`${ev?.turn}`} position={[0.08, 0.01, 0]} rotation-y={0.1}>
              <FlatCard face={face(shownCard)} back={back()} w={0.3} h={0.42} glow={ev?.act === "bust" || ev?.act === "curse" ? "#e11d48" : null} />
            </group>
          )}
          {props.peekCard && (
            <group position={[0.42, 0.01, 0.06]} rotation-y={-0.12}>
              <FlatCard face={face(props.peekCard)} back={back()} w={0.22} h={0.31} glow="#93c5fd" />
              <FloatIcon icon="🪞" y={0.28} size={0.16} />
            </group>
          )}
          {ghostUp && (
            <group key={`g${ev?.turn}`}>
              <ImpactRing color="#be123c" size={2.4} dur={1.2} />
              <FloatIcon icon={ghostUp} y={0.75} size={0.6} bob={0.08} />
            </group>
          )}
          <TableSign text={status} style={frac < 0.15 || ended ? DREAD : SIGN} y={1.0} />
        </group>
      }
      overview={ended}
      lowDetail={props.lowDetail}
      ringColor="#f59e0b"
    />
  );
}
