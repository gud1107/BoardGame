"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import TableScene, { useTableGeo, type TableSeat, type TableTheme } from "@/games/shared/three/TableScene";
import { FlatCard, FlyIn, HeldFan, ImpactRing, FloatIcon, TableSign } from "@/games/shared/three/tablePieces";
import { paintedTexture, FONTS, type BubbleStyle } from "@/games/shared/three/tableKit";
import type { HatKind, PersonMood } from "@/games/shared/three/SeatedPerson";
import { CARD_RANK_INFO } from "../CardArt";
import { JOKER_RANK, type Card } from "../engine";

/**
 * 달무티 3D 왕궁 — 신분 순서대로 둘러앉은 사람들. 왕은 왕좌에 왕관, 귀족은
 * 서클릿, 노예는 두건. 각자 앞에는 남은 손패가 뒷면 부채꼴로 서 있고(장수만
 * 보임), 낸 카드는 그 자리에서 테이블 가운데로 날아와 앞면으로 쌓인다.
 * 패스는 "패스!" 말풍선과 어깨 으쓱, 차례인 사람은 고민하는 동작 + 금색 고리.
 *
 * 보드가 공개 정보(손패 장수·낸 카드·순위·패스)만 넘기므로 남의 손패는 이
 * 장면에 들어오지 않는다. 내 손패는 아래 2D 손패 영역에서 그대로 고른다.
 */

export interface DalmutiSeat3D {
  seat: number;
  /** 연결 끊김(봇 대체 전). */
  away?: boolean;
  name: string;
  /** 왕 / 귀족 / 평민 / 거지 / 노예 */
  title: string;
  /** 0 = 왕 … n-1 = 노예 */
  rankPos: number;
  handCount: number;
  finishedOrder: number | null;
  /** "패스!" 말풍선이 떠 있는 동안 true. */
  passing: boolean;
}

export interface DalmutiTable3DProps {
  playerCount: number;
  viewerSeat: number;
  seats: DalmutiSeat3D[];
  /** 이번 트릭에 나온 카드(공개). */
  plays: { seat: number; cards: Card[] }[];
  activeSeat: number | null;
  /** 가운데 팻말 문구. */
  sign: string;
  /** 혁명 선포 연출 중인 좌석(+대혁명 여부). */
  revolution: { seat: number; isGrand: boolean } | null;
  /** 혁명 고민 중 / 세금 하사 중 등 "생각 중"인 좌석. */
  deciding: number[];
  overview: boolean;
  lowDetail: boolean;
}

const SEAT_COLORS = ["#c084fc", "#38bdf8", "#4ade80", "#fb923c", "#f43f5e", "#22d3ee", "#facc15", "#a3e635"];
const TITLE_ICON: Record<string, string> = { 왕: "👑", 귀족: "🎩", 평민: "🧺", 거지: "🥣", 노예: "⛓️" };

// ---------------------------------------------------------------------------
// Card textures
// ---------------------------------------------------------------------------

function tierColors(rank: number): [string, string, string] {
  if (rank === JOKER_RANK) return ["#5a0f1c", "#14030a", "#fb7185"];
  if (rank <= 2) return ["#6b3fa8", "#1d0e3a", "#f0abfc"];
  if (rank <= 5) return ["#2a5196", "#0c1832", "#7dd3fc"];
  if (rank <= 9) return ["#3f7a45", "#0f2412", "#86efac"];
  return ["#7a5c34", "#21180c", "#fde68a"];
}

function cardFace(card: Card): THREE.CanvasTexture {
  return paintedTexture(`dalmuti:${card.rank}`, 256, 360, (ctx, W, H) => {
    const [a, b, edge] = tierColors(card.rank);
    const info = CARD_RANK_INFO[card.rank];
    ctx.beginPath();
    ctx.roundRect(4, 4, W - 8, H - 8, 22);
    ctx.save();
    ctx.clip();
    const g = ctx.createLinearGradient(0, 0, W * 0.6, H);
    g.addColorStop(0, a);
    g.addColorStop(1, b);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // engraved diamond pattern
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 2;
    for (let i = -H; i < W + H; i += 22) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + H, H);
      ctx.moveTo(i + H, 0);
      ctx.lineTo(i, H);
      ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = edge;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.roundRect(8, 8, W - 16, H - 16, 18);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(20, 20, W - 40, H - 40, 12);
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `86px ${FONTS.emoji}`;
    ctx.fillText(info.emoji, W / 2, 92);
    ctx.fillStyle = "#fff";
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 10;
    ctx.font = `900 120px ${FONTS.text}`;
    ctx.fillText(card.isJoker ? "★" : String(card.rank), W / 2, 210);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = `700 30px ${FONTS.text}`;
    ctx.fillText(info.short, W / 2, 300);
    // corner index — white on a dark chip so it reads when the next card covers the rest
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.beginPath();
    ctx.roundRect(14, 14, 64, 60, 12);
    ctx.fill();
    ctx.font = `900 50px ${FONTS.text}`;
    ctx.fillStyle = "#fff";
    ctx.fillText(card.isJoker ? "★" : String(card.rank), 46, 46);
  });
}

function cardBack(): THREE.CanvasTexture {
  return paintedTexture("dalmuti:back", 256, 360, (ctx, W, H) => {
    ctx.beginPath();
    ctx.roundRect(4, 4, W - 8, H - 8, 22);
    ctx.save();
    ctx.clip();
    const g = ctx.createRadialGradient(W / 2, H / 2, 20, W / 2, H / 2, H * 0.7);
    g.addColorStop(0, "#5b2a86");
    g.addColorStop(1, "#1a0b2e");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(250,204,21,0.28)";
    ctx.lineWidth = 3;
    for (let r = 30; r < 220; r += 26) {
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = "#facc15";
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.roundRect(10, 10, W - 20, H - 20, 18);
    ctx.stroke();
    ctx.font = `96px ${FONTS.emoji}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("👑", W / 2, H / 2 + 6);
  });
}

// ---------------------------------------------------------------------------
// Throne hall
// ---------------------------------------------------------------------------

function marbleTexture(): THREE.CanvasTexture {
  const t = paintedTexture("dalmuti:marble", 512, 512, (ctx, W) => {
    const n = 8;
    const s = W / n;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        ctx.fillStyle = (x + y) % 2 === 0 ? "#e7e0d2" : "#2b2433";
        ctx.fillRect(x * s, y * s, s, s);
        ctx.strokeStyle = (x + y) % 2 === 0 ? "rgba(120,110,100,0.25)" : "rgba(200,190,230,0.08)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x * s + s * 0.1, y * s + s * 0.8);
        ctx.bezierCurveTo(x * s + s * 0.4, y * s + s * 0.5, x * s + s * 0.6, y * s + s * 0.9, x * s + s * 0.95, y * s + s * 0.3);
        ctx.stroke();
      }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(5, 5);
  return t;
}

function bannerTexture(): THREE.CanvasTexture {
  return paintedTexture("dalmuti:banner", 128, 320, (ctx, W, H) => {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#8b1028");
    g.addColorStop(1, "#4c0614");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(W, 0);
    ctx.lineTo(W, H);
    ctx.lineTo(W / 2, H - 40);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#e9b949";
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.font = `64px ${FONTS.emoji}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("👑", W / 2, 110);
  });
}

function Torch({ position, light }: { position: [number, number, number]; light: boolean }) {
  const flame = useRef<THREE.Mesh>(null);
  const pl = useRef<THREE.PointLight>(null);
  useFrame(({ clock }) => {
    const f = 1 + Math.sin(clock.elapsedTime * 17 + position[0]) * 0.12 + Math.sin(clock.elapsedTime * 7.3) * 0.08;
    flame.current?.scale.set(1, f, 1);
    if (pl.current) pl.current.intensity = 5 * f;
  });
  return (
    <group position={position}>
      <mesh position={[0, -0.2, 0]}>
        <cylinderGeometry args={[0.05, 0.03, 0.4, 8]} />
        <meshStandardMaterial color="#3b2412" roughness={0.8} />
      </mesh>
      <mesh ref={flame} position={[0, 0.08, 0]}>
        <coneGeometry args={[0.08, 0.26, 10]} />
        <meshBasicMaterial color="#ffb347" />
      </mesh>
      {light && <pointLight ref={pl} color="#ff9a3c" intensity={5} distance={6} decay={2} />}
    </group>
  );
}

function ThroneHall({ lowDetail }: { lowDetail: boolean }) {
  const seg = lowDetail ? 24 : 48;
  const marble = useMemo(() => marbleTexture(), []);
  const banner = useMemo(() => bannerTexture(), []);
  const pillars = 10;
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[12, seg]} />
        <meshStandardMaterial map={marble} roughness={0.35} metalness={0.05} />
      </mesh>
      {/* royal rug */}
      <mesh position={[0, 0.006, 0]} rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[4.4, seg]} />
        <meshStandardMaterial color="#5b0f1f" roughness={1} />
      </mesh>
      <mesh position={[0, 0.008, 0]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[4.1, 4.3, seg]} />
        <meshStandardMaterial color="#d4a52c" roughness={0.5} metalness={0.6} />
      </mesh>
      {/* walls */}
      <mesh position={[0, 5, 0]}>
        <cylinderGeometry args={[10.5, 10.5, 10, seg, 1, true]} />
        <meshStandardMaterial color="#2a2233" roughness={0.95} side={THREE.BackSide} />
      </mesh>
      {Array.from({ length: pillars }, (_, i) => {
        const a = (i / pillars) * Math.PI * 2 + Math.PI / pillars;
        const x = Math.sin(a) * 8.6;
        const z = Math.cos(a) * 8.6;
        return (
          <group key={i} position={[x, 0, z]}>
            <mesh position={[0, 3.5, 0]} castShadow={!lowDetail}>
              <cylinderGeometry args={[0.32, 0.38, 7, 16]} />
              <meshStandardMaterial color="#cfc6b8" roughness={0.55} />
            </mesh>
            <mesh position={[0, 0.15, 0]}>
              <boxGeometry args={[0.95, 0.3, 0.95]} />
              <meshStandardMaterial color="#b8ae9f" roughness={0.6} />
            </mesh>
            <mesh position={[0, 7.05, 0]}>
              <boxGeometry args={[0.95, 0.25, 0.95]} />
              <meshStandardMaterial color="#b8ae9f" roughness={0.6} />
            </mesh>
            <group position={[-x * 0.045, 2.4, -z * 0.045]}>
              <Torch position={[0, 0, 0]} light={!lowDetail && i % 3 === 0} />
            </group>
          </group>
        );
      })}
      {/* tall moonlit windows + banners between them */}
      {Array.from({ length: pillars }, (_, i) => {
        const a = (i / pillars) * Math.PI * 2;
        return (
          <group key={i} position={[Math.sin(a) * 10.4, 0, Math.cos(a) * 10.4]} rotation-y={a + Math.PI}>
            {i % 2 === 0 ? (
              <>
                <mesh position={[0, 4.2, 0]}>
                  <planeGeometry args={[1.5, 3.6]} />
                  <meshBasicMaterial color="#3b5b9a" />
                </mesh>
                <mesh position={[0, 6, 0]}>
                  <circleGeometry args={[0.75, 20, 0, Math.PI]} />
                  <meshBasicMaterial color="#4a6bb0" />
                </mesh>
                <mesh position={[0, 4.2, 0.01]}>
                  <planeGeometry args={[0.06, 3.6]} />
                  <meshBasicMaterial color="#1a1424" />
                </mesh>
              </>
            ) : (
              <mesh position={[0, 4.3, 0]}>
                <planeGeometry args={[1.1, 2.75]} />
                <meshStandardMaterial map={banner} transparent roughness={0.9} side={THREE.DoubleSide} />
              </mesh>
            )}
          </group>
        );
      })}
      {/* chandelier */}
      <group position={[0, 3.6, 0]}>
        <mesh position={[0, 1.2, 0]}>
          <cylinderGeometry args={[0.015, 0.015, 2.4, 6]} />
          <meshStandardMaterial color="#222" />
        </mesh>
        <mesh rotation-x={Math.PI / 2}>
          <torusGeometry args={[0.7, 0.035, 8, 40]} />
          <meshStandardMaterial color="#d4a52c" metalness={0.9} roughness={0.25} />
        </mesh>
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i / 8) * Math.PI * 2;
          return (
            <group key={i} position={[Math.sin(a) * 0.7, 0.08, Math.cos(a) * 0.7]}>
              <mesh>
                <cylinderGeometry args={[0.025, 0.025, 0.14, 8]} />
                <meshStandardMaterial color="#fef3c7" />
              </mesh>
              <mesh position={[0, 0.11, 0]}>
                <sphereGeometry args={[0.03, 8, 6]} />
                <meshBasicMaterial color="#ffd27a" />
              </mesh>
            </group>
          );
        })}
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Table props
// ---------------------------------------------------------------------------

/**
 * One play laid face up in a straight overlapping row, upright for me (+z is my side).
 * The step shrinks for big sets so 12 cards still fit the felt; each card's top-left
 * corner index stays uncovered.
 */
function PlayFan({ cards, w, h, maxWidth }: { cards: Card[]; w: number; h: number; maxWidth: number }) {
  const back = cardBack();
  const step = cards.length > 1 ? Math.min(w * 0.55, (maxWidth - w) / (cards.length - 1)) : 0;
  return (
    <group>
      {cards.map((c, i) => (
        <group key={c.id} position={[(i - (cards.length - 1) / 2) * step, i * 0.003, 0]}>
          <FlatCard face={cardFace(c)} back={back} w={w} h={h} />
        </group>
      ))}
    </group>
  );
}

const SIGN_STYLE: BubbleStyle = { bg: "rgba(30,14,48,0.92)", fg: "#fde68a", border: "#d4a52c", size: 42 };

function CenterSign({ text }: { text: string }) {
  return <TableSign text={text} style={SIGN_STYLE} y={0.95} width={1.15} />;
}

const TOP_W = 0.6;
const TOP_H = 0.84;
const OLD_W = 0.28;
const OLD_H = 0.4;
/** The centre sign already names who played the top set — it floats over the back of the felt so it never covers the cards. */
const SIGN_Z = -0.95;

/**
 * The play on top — the one to beat — lies big and square on my side of the centre,
 * facing me. The earlier plays of this trick (up to 3)
 * line up small and dimmed-by-size in one tidy row behind it, oldest on the left.
 */
function TrickPile({ plays }: { plays: DalmutiTable3DProps["plays"] }) {
  const geo = useTableGeo();
  const top = plays[plays.length - 1];
  const older = plays.slice(-4, -1);
  const topWidth = Math.min(2.1, geo.tableR * 1.4);
  const oldWidth = Math.min(0.7, (geo.tableR * 1.5) / Math.max(1, older.length) - 0.08);
  return (
    <group>
      {older.map((p, k) => (
        <group
          key={`${p.seat}-${p.cards.map((c) => c.id).join(",")}`}
          position={[(k - (older.length - 1) / 2) * (oldWidth + 0.08), 0.002, -0.5]}
        >
          <PlayFan cards={p.cards} w={OLD_W} h={OLD_H} maxWidth={oldWidth} />
        </group>
      ))}
      {top && (
        <group key={`${top.seat}-${top.cards.map((c) => c.id).join(",")}`} position={[0, 0.006, 0.3]}>
          <FlyIn from={geo.spotOf(top.seat, 0.4).sub(new THREE.Vector3(0, geo.tableY, 0))} dur={0.5} arc={0.55}>
            <PlayFan cards={top.cards} w={TOP_W} h={TOP_H} maxWidth={topWidth} />
          </FlyIn>
          <ImpactRing key={plays.length} color={top.cards.some((c) => c.isJoker) ? "#fb7185" : "#fde68a"} size={1.5} />
        </group>
      )}
    </group>
  );
}

// ---------------------------------------------------------------------------

const THEME: TableTheme = {
  background: "#120c1c",
  fog: [9, 24],
  ambient: ["#c4b5fd", 0.3],
  hemi: ["#e9d5ff", "#1a1020", 0.4],
  fills: [
    ["#93c5fd", 0.35, -6, 6, -6],
    ["#ffd9a8", 0.3, 0, 4, 8],
  ],
  lamp: { color: "#ffe2b0", intensity: 26, height: 3.3 },
  table: { top: "#4a1d5c", rim: "#3a1f12", felt: "#3b1350", inlay: "#d4a52c", base: "#2a160c" },
  chair: "wood",
  chairColor: "#4a2a17",
  seatColors: SEAT_COLORS,
  hats: ["none"],
};

const PASS_STYLE: BubbleStyle = { bg: "rgba(241,245,249,0.96)", fg: "#334155", border: "#94a3b8" };
const FINISH_STYLE: BubbleStyle = { bg: "rgba(254,243,199,0.97)", fg: "#78350f", border: "#f59e0b" };

function hatFor(rankPos: number, n: number): HatKind {
  if (rankPos === 0) return "crown";
  if (rankPos === 1) return "circlet";
  if (rankPos === n - 1) return "hood";
  if (rankPos === n - 2) return "cap";
  return rankPos % 2 === 0 ? "beret" : "none";
}

function coatFor(rankPos: number, n: number): { coat: string; hatColor: string } {
  if (rankPos === 0) return { coat: "#6d28d9", hatColor: "#7f1d1d" };
  if (rankPos === 1) return { coat: "#1e3a8a", hatColor: "#1e1b4b" };
  if (rankPos === n - 1) return { coat: "#57432c", hatColor: "#4a3b2a" };
  if (rankPos === n - 2) return { coat: "#6b5b3e", hatColor: "#5a4a30" };
  return { coat: ["#14532d", "#7c2d12", "#155e75", "#854d0e"][rankPos % 4], hatColor: "#3f2a1d" };
}

export default function DalmutiTable3D(props: DalmutiTable3DProps) {
  const { playerCount: n, viewerSeat, plays, activeSeat, revolution } = props;
  const lastPlay = plays[plays.length - 1] ?? null;

  const seats: TableSeat[] = props.seats.map((s) => {
    let mood: PersonMood = "rest";
    let lookSeat: TableSeat["lookSeat"] = activeSeat !== null && activeSeat !== s.seat ? activeSeat : "center";
    if (s.finishedOrder !== null) mood = s.finishedOrder === 1 ? "cheer" : "clap";
    else if (revolution) {
      mood = revolution.seat === s.seat ? "cheer" : revolution.isGrand ? "shock" : "nervous";
      lookSeat = revolution.seat === s.seat ? "center" : revolution.seat;
    } else if (s.passing) mood = "shrug";
    else if (activeSeat === s.seat || props.deciding.includes(s.seat)) {
      mood = "think";
      lookSeat = "center";
    } else if (lastPlay?.seat === s.seat) mood = "smug";
    const hat = hatFor(s.rankPos, n);
    const icon = TITLE_ICON[s.title] ?? "";
    return {
      seat: s.seat,
      name: s.name,
      away: s.away,
      sub: s.finishedOrder !== null ? `🏁 ${s.finishedOrder}등` : `${icon}${s.title} · ${s.handCount}장`,
      mood,
      lookSeat,
      active: activeSeat === s.seat,
      hat,
      look: coatFor(s.rankPos, n),
      chair: s.rankPos === 0 ? "throne" : s.rankPos === n - 1 ? "stool" : "wood",
      tag: s.seat === viewerSeat ? { text: `${icon}${s.title} · 손패 ${s.handCount}장`, color: "#d4a52c" } : null,
      bubble: s.passing
        ? { text: "패스!", style: PASS_STYLE, key: `p${plays.length}`, width: 0.62 }
        : s.finishedOrder !== null && s.handCount === 0 && lastPlay?.seat === s.seat
          ? { text: `${s.finishedOrder}등 탈출! 🎉`, style: FINISH_STYLE, key: `f${s.finishedOrder}`, width: 0.8 }
          : null,
      held: s.seat !== viewerSeat && s.handCount > 0 ? <HeldFan count={s.handCount} back={cardBack()} max={13} /> : null,
    };
  });

  const me = props.seats.find((x) => x.seat === viewerSeat);
  return (
    <TableScene
      cameraKey="dalmuti-camera"
      // my own body holds my hand too (backs: the 2D hand panel shows the faces)
      selfView={{ held: me && me.handCount > 0 ? <HeldFan count={me.handCount} back={cardBack()} max={13} /> : null }}
      seatCount={n}
      viewerSeat={viewerSeat}
      seats={seats}
      theme={THEME}
      environment={<ThroneHall lowDetail={props.lowDetail} />}
      center={
        <group>
          <TrickPile plays={plays} />
          <group position-z={SIGN_Z}>
            <CenterSign text={props.sign} />
          </group>
          {revolution && (
            <group position={[0, 0.2, 0]}>
              <FloatIcon icon={revolution.isGrand ? "🔥" : "⚡"} y={0.5} size={0.45} />
            </group>
          )}
        </group>
      }
      overview={props.overview}
      lowDetail={props.lowDetail}
    />
  );
}
