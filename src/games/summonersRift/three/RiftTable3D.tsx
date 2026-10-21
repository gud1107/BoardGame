"use client";

import TableScene, { type TableSeat, type TableTheme } from "@/games/shared/three/TableScene";
import { DeckPile, FlatCard, GlowDisc, ImpactRing, PopIn, StandingCard, TableSign } from "@/games/shared/three/tablePieces";
import { OutdoorPlaza } from "@/games/shared/three/environments";
import { imageCardTexture, simpleBackTexture, type BubbleStyle } from "@/games/shared/three/tableKit";
import type { PersonMood } from "@/games/shared/three/SeatedPerson";
import { HERO_IMAGE, ITEM_IMAGES, MONSTER_IMAGES } from "../assets";

/**
 * 소환사의 협곡 3D — 안개 낀 정글 협곡 입구의 돌 제단. 가운데엔 공유 챔피언이
 * 서 있고 장착된 아이템이 그 둘레에 세워진다. 누가 아이템을 빼면 그 사람 앞에
 * 놓이고, 뽑은 몬스터는 협곡 더미(뒷면)에 쌓인다. 던전 공개 단계엔 몬스터가
 * 하나씩 앞면으로 줄지어 나오고 처치/피격마다 충격파. 승리 토큰(🏆)·실패
 * 토큰(💀)은 각자 앞에. 누가 무엇을 뽑았는지는 뒷면으로만 보인다.
 */

export interface RiftSeat3D {
  seat: number;
  name: string;
  success: number;
  failure: number;
  eliminated: boolean;
  passed: boolean;
  removedItems: number[];
  holding: boolean;
  away?: boolean;
}

export interface RiftTable3DProps {
  playerCount: number;
  viewerSeat: number;
  seats: RiftSeat3D[];
  phase: string;
  activeSeat: number | null;
  challenger: number | null;
  equipped: number[];
  deckCount: number;
  riftCount: number;
  revealed: { threat: number; killed: boolean; key: string }[];
  hp: { current: number; total: number } | null;
  round: number;
  overview: boolean;
  lowDetail: boolean;
}

const back = () => simpleBackTexture("rift", "#1c2434", "#060a12", "#c8aa6e", "⚔️");
const heroTex = () => imageCardTexture("rift:hero", HERO_IMAGE, { text: "HP3", bg: "rgba(10,14,21,0.85)", fg: "#c8aa6e" }, "#c8aa6e");
const itemTex = (id: number) => imageCardTexture(`rift:item:${id}`, ITEM_IMAGES[id as keyof typeof ITEM_IMAGES], { text: String(id), bg: "rgba(10,14,21,0.85)", fg: "#c8aa6e" }, "#c8aa6e");
const monsterTex = (t: number) => imageCardTexture(`rift:m:${t}`, MONSTER_IMAGES[t] ?? HERO_IMAGE, { text: String(t), bg: "rgba(127,29,29,0.9)", fg: "#fff" }, "#ef4444");

function Altar({ equipped }: { equipped: number[] }) {
  return (
    <group>
      <mesh position={[0, 0.04, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.36, 0.42, 0.08, 6]} />
        <meshStandardMaterial color="#4b5563" roughness={0.9} flatShading />
      </mesh>
      <group position={[0, 0.08, 0]}>
        <StandingCard face={heroTex()} back={back()} w={0.26} h={0.36} tilt={0} />
      </group>
      {equipped.map((id, i) => {
        const a = Math.PI + ((i - (equipped.length - 1) / 2) / 6) * Math.PI * 1.6;
        return (
          <group key={id} position={[Math.sin(a) * 0.5, 0, Math.cos(a) * 0.5]} rotation-y={a + Math.PI}>
            <PopIn>
              <StandingCard face={itemTex(id)} back={back()} w={0.16} h={0.22} tilt={-0.15} />
            </PopIn>
          </group>
        );
      })}
    </group>
  );
}

function Tokens({ n, color }: { n: number; color: string }) {
  return (
    <group>
      {Array.from({ length: n }, (_, i) => (
        <mesh key={i} position={[i * 0.07, 0.012, 0]} castShadow>
          <cylinderGeometry args={[0.03, 0.03, 0.024, 16]} />
          <meshStandardMaterial color={color} metalness={0.5} roughness={0.35} emissive={color} emissiveIntensity={0.25} />
        </mesh>
      ))}
    </group>
  );
}

const THEME: TableTheme = {
  background: "#0b1410",
  fog: [8, 26],
  ambient: ["#c7f0d8", 0.26],
  hemi: ["#a7f3d0", "#0b1410", 0.38],
  fills: [["#38bdf8", 0.3, -6, 6, -6]],
  lamp: { color: "#e6f7ee", intensity: 18, height: 3.4 },
  table: { top: "#374151", rim: "#1f2937", felt: "#2b3a33", inlay: "#c8aa6e", base: "#111827" },
  chair: "stool",
  chairColor: "#374151",
  seatColors: ["#c8aa6e", "#38bdf8", "#f472b6", "#4ade80", "#a78bfa", "#fb923c"],
  hats: ["helmet", "hood", "none", "helmet", "hood", "none"],
};

const SIGN: BubbleStyle = { bg: "rgba(10,14,21,0.92)", fg: "#f0e6d2", border: "#c8aa6e" };
const PASS: BubbleStyle = { bg: "rgba(241,245,249,0.96)", fg: "#334155", border: "#94a3b8" };

export default function RiftTable3D(props: RiftTable3DProps) {
  const { viewerSeat, activeSeat, phase, challenger } = props;
  const combat = phase === "resolvingRift" || phase === "declaringSpatula";
  const seats: TableSeat[] = props.seats.map((s) => {
    let mood: PersonMood = activeSeat === s.seat ? "think" : "rest";
    if (s.passed && !combat) mood = "shrug";
    if (combat) mood = challenger === s.seat ? "nervous" : "point";
    if (s.holding) mood = "think";
    return {
      seat: s.seat,
      name: s.name,
      away: s.away,
      sub: s.eliminated ? "💀 탈락" : `🏆 ${s.success} · 💀 ${s.failure}`,
      mood,
      out: s.eliminated,
      lookSeat: combat ? "center" : activeSeat !== null && activeSeat !== s.seat ? activeSeat : "center",
      active: activeSeat === s.seat && !combat,
      ring: challenger === s.seat ? "#ef4444" : null,
      tag: challenger === s.seat ? { text: "⚔️ 도전자", color: "#ef4444" } : null,
      bubble: s.passed && !combat ? { text: "패스", style: PASS, key: `p${props.round}`, width: 0.4 } : null,
      front: (
        <group>
          <group position={[-0.35, 0, 0.1]}>
            <Tokens n={s.success} color="#facc15" />
          </group>
          <group position={[0.2, 0, 0.1]}>
            <Tokens n={s.failure} color="#7f1d1d" />
          </group>
          {s.removedItems.map((id, i) => (
            <group key={id} position={[(i - (s.removedItems.length - 1) / 2) * 0.14, 0, -0.12]}>
              <PopIn>
                <FlatCard face={itemTex(id)} back={back()} w={0.12} h={0.17} />
              </PopIn>
            </group>
          ))}
          {s.holding && s.seat !== viewerSeat && (
            <group position={[0, 0.04, 0.2]}>
              <StandingCard face={back()} back={back()} w={0.15} h={0.21} tilt={-0.2} />
            </group>
          )}
        </group>
      ),
    };
  });

  const last = props.revealed[props.revealed.length - 1];
  return (
    <TableScene
      seatCount={props.playerCount}
      viewerSeat={viewerSeat}
      seats={seats}
      theme={THEME}
      environment={
        <OutdoorPlaza
          lowDetail={props.lowDetail}
          ground="#14261b"
          plaza="#2b3a33"
          trim="#c8aa6e"
          skyline={{ kind: "trees", color: "#173a26" }}
          torches
          wall="#334139"
        />
      }
      center={
        <group>
          <Altar equipped={props.equipped} />
          <group position={[-0.62, 0, 0.35]} rotation-y={0.3}>
            <DeckPile count={props.deckCount} back={back()} w={0.16} h={0.22} max={13} />
          </group>
          <group position={[0.62, 0, 0.35]} rotation-y={-0.3}>
            {props.riftCount > 0 && <GlowDisc color="#ef4444" r={0.16} opacity={0.3} />}
            <DeckPile count={props.riftCount} back={back()} w={0.16} h={0.22} max={13} />
          </group>
          {props.revealed.map((m, i) => (
            <group key={m.key} position={[(i - (props.revealed.length - 1) / 2) * 0.17, 0.01, 0.58]}>
              <PopIn>
                <FlatCard face={monsterTex(m.threat)} back={back()} w={0.14} h={0.2} glow={m.killed ? "#22c55e" : "#ef4444"} />
              </PopIn>
            </group>
          ))}
          {last && (
            <group key={last.key} position={[0, 0, 0.58]}>
              <ImpactRing color={last.killed ? "#22c55e" : "#ef4444"} size={0.9} />
            </group>
          )}
          <TableSign
            text={props.hp ? `❤️ HP ${props.hp.current} / ${props.hp.total}` : `${props.round}라운드 · 협곡 더미 ${props.riftCount}장`}
            style={SIGN}
            y={1.05}
          />
        </group>
      }
      overview={props.overview}
      lowDetail={props.lowDetail}
      ringColor="#c8aa6e"
    />
  );
}
