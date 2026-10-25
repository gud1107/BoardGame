"use client";

import * as THREE from "three";
import TableScene, { useTableGeo, type TableSeat, type TableTheme } from "@/games/shared/three/TableScene";
import { HeldFan, DeckPile, FlatCard, FlyIn, ImpactRing, PopIn, TableSign } from "@/games/shared/three/tablePieces";
import { OutdoorPlaza } from "@/games/shared/three/environments";
import { simpleBackTexture, simpleCardTexture, type BubbleStyle } from "@/games/shared/three/tableKit";
import type { PersonMood } from "@/games/shared/three/SeatedPerson";
import { CARD_META, ROLE_LABEL } from "../cardMeta";
import type { CardType, EquipSlot, Role } from "../engine";

/**
 * 뱅! 3D — 황야의 술집 앞 마당, 카우보이 모자를 쓴 사람들이 차례 순서대로
 * 둘러앉는다. 보안관은 배지를 달고(공개), 나머지 역할은 탈락해 공개되기
 * 전까지 모른다. 각자 앞엔 장착 카드(총·조준경·말·술통·다이너마이트·감옥),
 * 체력은 총알 탄으로, 손패는 뒷면. 방금 낸 카드는 그 사람 앞에서 가운데로
 * 날아오고, 뱅!이면 대상에게 붉은 충격파 + 쏘는 동작. 대상을 고를 때는
 * 사람을 눌러 지목한다.
 */

export interface BangSeat3D {
  seat: number;
  name: string;
  /** 공개된 역할(보안관이거나 탈락 후)만. */
  role: Role | null;
  alive: boolean;
  life: number;
  maxLife: number;
  handCount: number;
  equipment: Partial<Record<EquipSlot, CardType>>;
  targetable: boolean;
  away?: boolean;
}

export interface BangTable3DProps {
  /** 차례 순서(테이블 배치 순서). */
  order: number[];
  viewerSeat: number;
  seats: BangSeat3D[];
  turnSeat: number | null;
  /** 지금 응답해야 하는 좌석들. */
  responders: number[];
  lastPlay: { id: number; actor: number; target: number | null; card: CardType; note: string | null; effect: string } | null;
  deckCount: number;
  onTarget: ((seat: number) => void) | null;
  overview: boolean;
  lowDetail: boolean;
}

const back = () => simpleBackTexture("bang", "#7c2d12", "#2a0d04", "#fcd34d", "🤠");
const face = (t: CardType) =>
  simpleCardTexture(`bang:${t}`, {
    icon: CARD_META[t].icon,
    caption: CARD_META[t].label,
    bg: t === "bang" || t === "gatling" ? ["#b91c1c", "#3f0a0a"] : t === "missed" ? ["#1d4ed8", "#0b1a4a"] : CARD_META[t].kind.startsWith("equip") ? ["#3f6212", "#14200a"] : ["#a16207", "#2e1d04"],
    edge: "#fde68a",
  });

const SLOT_X: Record<EquipSlot, number> = { weapon: -0.36, scope: -0.18, mustang: 0, barrel: 0.18, dynamite: 0.36, jail: 0.54 };

function Bullets({ life, max }: { life: number; max: number }) {
  return (
    <group position={[0, 0, 0.2]}>
      {Array.from({ length: max }, (_, i) => (
        <mesh key={i} position={[(i - (max - 1) / 2) * 0.05, 0.035, 0]} castShadow>
          <capsuleGeometry args={[0.012, 0.04, 3, 8]} />
          <meshStandardMaterial color={i < life ? "#d4a52c" : "#3f3f46"} metalness={i < life ? 0.85 : 0.2} roughness={0.35} />
        </mesh>
      ))}
    </group>
  );
}

function Played({ lastPlay, pos }: { lastPlay: NonNullable<BangTable3DProps["lastPlay"]>; pos: (s: number) => number }) {
  const geo = useTableGeo();
  const from = geo.spotOf(pos(lastPlay.actor), 0.4).sub(new THREE.Vector3(0, geo.tableY, 0));
  return (
    <group key={lastPlay.id} position={[0.2, 0.01, 0]}>
      <FlyIn from={from} dur={0.45} arc={0.4}>
        <FlatCard face={face(lastPlay.card)} back={back()} w={0.26} h={0.37} glow={lastPlay.effect === "bang" ? "#ef4444" : null} />
      </FlyIn>
    </group>
  );
}

function HitFx({ seat, color }: { seat: number; color: string }) {
  const geo = useTableGeo();
  const p = geo.spotOf(seat, 0.15);
  return (
    <group position={[p.x, geo.tableY, p.z]}>
      <ImpactRing color={color} size={1.1} dur={0.8} />
    </group>
  );
}

const THEME: TableTheme = {
  background: "#3a2a24",
  fog: [12, 34],
  ambient: ["#ffe2bd", 0.38],
  hemi: ["#ffcf91", "#2a1a10", 0.55],
  fills: [
    ["#ff9a4a", 0.7, -10, 5, -12],
    ["#c7d2fe", 0.2, 6, 6, 8],
  ],
  lamp: { color: "#ffd9a0", intensity: 14, height: 3.3 },
  table: { top: "#5a3a1e", rim: "#3a2412", felt: "#3f6b3a", inlay: "#d4a52c", base: "#24160a" },
  chair: "wood",
  chairColor: "#5a3a1e",
  seatColors: ["#f59e0b", "#38bdf8", "#f472b6", "#4ade80", "#a78bfa", "#fb923c", "#22d3ee", "#f87171"],
  hats: ["cowboy"],
};

const SAY: BubbleStyle = { bg: "rgba(255,247,237,0.97)", fg: "#7c2d12", border: "#f59e0b" };
const HIT: BubbleStyle = { bg: "rgba(127,29,29,0.95)", fg: "#fff1f2", border: "#fecaca" };
const SIGN: BubbleStyle = { bg: "rgba(42,20,8,0.92)", fg: "#fde68a", border: "#d4a52c" };

export default function BangTable3D(props: BangTable3DProps) {
  const { order, viewerSeat, lastPlay, turnSeat } = props;
  const pos = (s: number) => Math.max(0, order.indexOf(s));
  const seats: TableSeat[] = props.seats.map((s) => {
    let mood: PersonMood = turnSeat === s.seat ? "think" : "rest";
    let bubble: TableSeat["bubble"] = null;
    let lookSeat: TableSeat["lookSeat"] = turnSeat !== null && turnSeat !== s.seat ? pos(turnSeat) : "center";
    if (props.responders.includes(s.seat)) mood = "nervous";
    if (lastPlay) {
      if (lastPlay.actor === s.seat) {
        mood = lastPlay.target !== null ? "point" : lastPlay.effect === "heal" ? "cheer" : "talk";
        lookSeat = lastPlay.target !== null ? pos(lastPlay.target) : "center";
        bubble = { text: `${CARD_META[lastPlay.card].icon} ${CARD_META[lastPlay.card].label}${lastPlay.note ? ` ${lastPlay.note}` : ""}`, style: SAY, key: `p${lastPlay.id}`, width: 0.9 };
      } else if (lastPlay.target === s.seat) {
        mood = lastPlay.effect === "bang" || lastPlay.effect === "duel" ? "shock" : "nervous";
        lookSeat = pos(lastPlay.actor);
        if (lastPlay.effect === "bang") bubble = { text: "윽! 💥", style: HIT, key: `h${lastPlay.id}`, width: 0.45 };
      }
    }
    const role = s.role ? ROLE_LABEL[s.role] : null;
    return {
      seat: pos(s.seat),
      name: s.name,
      away: s.away,
      sub: s.alive ? `${role ? `${role.icon} ${role.label}` : "❔"} · ❤️ ${s.life}/${s.maxLife}` : `💀 ${role ? role.label : ""}`,
      mood,
      out: !s.alive,
      lookSeat,
      active: turnSeat === s.seat,
      ring: s.targetable ? "#ef4444" : null,
      hat: "cowboy",
      look: s.role === "sheriff" ? { hatColor: "#1c1917", coat: "#7c2d12" } : undefined,
      bubble,
      tag: s.role === "sheriff" && s.alive ? { text: "⭐ 보안관", color: "#fbbf24" } : null,
      onSelect: s.targetable && props.onTarget ? () => props.onTarget!(s.seat) : null,
      held: s.alive && s.seat !== viewerSeat && s.handCount > 0 ? <HeldFan count={s.handCount} back={back()} max={8} /> : null,
      front: (
        <group>
          {(Object.keys(s.equipment) as EquipSlot[]).map((slot) => (
            <group key={slot} position={[SLOT_X[slot], 0, -0.1]}>
              <PopIn>
                <FlatCard face={face(s.equipment[slot]!)} back={back()} w={0.15} h={0.21} glow={slot === "jail" ? "#64748b" : slot === "dynamite" ? "#ef4444" : null} />
              </PopIn>
            </group>
          ))}
          {s.alive && <Bullets life={s.life} max={s.maxLife} />}
        </group>
      ),
    };
  });

  return (
    <TableScene
      seatCount={order.length}
      viewerSeat={pos(viewerSeat)}
      seats={seats}
      theme={THEME}
      environment={
        <OutdoorPlaza
          lowDetail={props.lowDetail}
          ground="#a0764a"
          plaza="#8a6a44"
          trim="#5a3a1e"
          skyline={{ kind: "mountains", color: "#7a4a32" }}
          sun={{ color: "#ffb35c", position: [-14, 4, -22], size: 2.6 }}
          wall="#6b4a2a"
          torches
        />
      }
      center={
        <group>
          <group position={[-0.25, 0, 0]} rotation-y={0.2}>
            <DeckPile count={props.deckCount} back={back()} w={0.22} h={0.31} max={20} />
          </group>
          {lastPlay && <Played lastPlay={lastPlay} pos={pos} />}
          <TableSign text={turnSeat !== null ? `${props.seats.find((s) => s.seat === turnSeat)?.name ?? ""}의 차례` : "결투 끝"} style={SIGN} y={0.95} />
        </group>
      }
      extras={lastPlay && lastPlay.target !== null && lastPlay.effect === "bang" ? <HitFx key={lastPlay.id} seat={pos(lastPlay.target)} color="#ef4444" /> : null}
      overview={props.overview}
      lowDetail={props.lowDetail}
      ringColor="#fbbf24"
    />
  );
}
