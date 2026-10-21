"use client";

import TableScene, { useTableGeo, type TableSeat, type TableTheme } from "@/games/shared/three/TableScene";
import { Clickable, CoinStack, DeckPile, FlatCard, GlowDisc, HitBox, PopIn } from "@/games/shared/three/tablePieces";
import { IndoorRoom } from "@/games/shared/three/environments";
import { paintedTexture, simpleBackTexture, FONTS } from "@/games/shared/three/tableKit";
import type { PersonMood } from "@/games/shared/three/SeatedPerson";
import { GEM_ORDER, type DevelopmentCard, type GemColor, type Noble, type Tier, type TokenColor } from "../cards";

/**
 * 스플렌더 3D — 르네상스 보석상의 원탁. 가운데에 개발 카드 시장 3줄(III가
 * 가장 멀리)과 덱, 그 너머에 귀족 타일, 내 쪽엔 보석 토큰 은행. 내 차례면
 * 시장 카드를 눌러 구매/예약 창을 열고, 은행 토큰을 눌러 고르고, 덱을 눌러
 * 비공개 예약한다. 각자 앞엔 산 카드가 색별로 쌓이고(보너스), 토큰 더미,
 * 귀족, 예약 카드(뒷면 — 남의 예약 카드는 내용 비공개).
 */

export const GEM_HEX: Record<TokenColor, string> = {
  white: "#f1f5f9",
  blue: "#2563eb",
  green: "#16a34a",
  red: "#dc2626",
  black: "#27272a",
  gold: "#eab308",
};
const GEM_INK: Record<TokenColor, string> = { white: "#1e293b", blue: "#fff", green: "#fff", red: "#fff", black: "#fff", gold: "#1c1917" };
const TIER_BG: Record<Tier, [string, string]> = { 1: ["#14532d", "#052e16"], 2: ["#854d0e", "#2e1d04"], 3: ["#1e3a8a", "#0b1a4a"] };

function gemDot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: GemColor | TokenColor, text?: string) {
  ctx.fillStyle = GEM_HEX[color];
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.lineWidth = 3;
  ctx.stroke();
  if (text) {
    ctx.fillStyle = GEM_INK[color];
    ctx.font = `900 ${r * 1.3}px ${FONTS.text}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, y + 2);
  }
}

function cardTex(c: DevelopmentCard) {
  return paintedTexture(`splendor:${c.id}`, 256, 360, (ctx, W, H) => {
    const [a, b] = TIER_BG[c.tier];
    ctx.beginPath();
    ctx.roundRect(4, 4, W - 8, H - 8, 20);
    ctx.save();
    ctx.clip();
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, a);
    g.addColorStop(1, b);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(255,255,255,0.88)";
    ctx.fillRect(0, 0, W, 84);
    ctx.restore();
    ctx.strokeStyle = "#e9d5a0";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.roundRect(7, 7, W - 14, H - 14, 18);
    ctx.stroke();
    if (c.points > 0) {
      ctx.fillStyle = "#1c1917";
      ctx.font = `900 70px ${FONTS.text}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(String(c.points), 24, 46);
    }
    gemDot(ctx, W - 50, 44, 30, c.bonus);
    const costs = GEM_ORDER.filter((k) => (c.cost[k] ?? 0) > 0);
    costs.forEach((k, i) => gemDot(ctx, 44, H - 44 - i * 62, 26, k, String(c.cost[k])));
  });
}

function nobleTex(n: Noble) {
  return paintedTexture(`splendor:noble:${n.id}`, 256, 256, (ctx, W) => {
    ctx.fillStyle = "#f5e6c8";
    ctx.beginPath();
    ctx.roundRect(4, 4, W - 8, W - 8, 18);
    ctx.fill();
    ctx.strokeStyle = "#a16207";
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.font = `90px ${FONTS.emoji}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("👑", W * 0.62, W * 0.44);
    ctx.fillStyle = "#1c1917";
    ctx.font = `900 64px ${FONTS.text}`;
    ctx.fillText(String(n.points), 46, 52);
    GEM_ORDER.filter((k) => (n.cost[k] ?? 0) > 0).forEach((k, i) => gemDot(ctx, 44, 120 + i * 50, 22, k, String(n.cost[k])));
  });
}

const backs: Record<Tier, () => ReturnType<typeof simpleBackTexture>> = {
  1: () => simpleBackTexture("splendor1", "#166534", "#03140a", "#bbf7d0", "💎"),
  2: () => simpleBackTexture("splendor2", "#a16207", "#2a1a04", "#fde68a", "💎"),
  3: () => simpleBackTexture("splendor3", "#1d4ed8", "#060f2e", "#bfdbfe", "💎"),
};

export interface SplendorSeat3D {
  seat: number;
  name: string;
  score: number;
  tokens: Partial<Record<TokenColor, number>>;
  bonuses: Partial<Record<GemColor, number>>;
  nobles: number;
  reserved: number;
  away?: boolean;
}

export interface SplendorTable3DProps {
  playerCount: number;
  viewerSeat: number;
  seats: SplendorSeat3D[];
  markets: Record<Tier, (DevelopmentCard | null)[]>;
  deckCounts: Record<Tier, number>;
  nobles: Noble[];
  bank: Partial<Record<TokenColor, number>>;
  activeSeat: number | null;
  affordable: Set<string>;
  picked: GemColor[];
  onCard: ((c: DevelopmentCard) => void) | null;
  onDeck: ((t: Tier) => void) | null;
  onToken: ((c: GemColor) => void) | null;
  overview: boolean;
  lowDetail: boolean;
}

const CW = 0.19;
const CH = 0.27;

function Market(p: SplendorTable3DProps) {
  // shrink the market a little on the small 2-player table so it clears both shelves
  const geo = useTableGeo();
  const k = Math.min(1, (geo.tableR - 0.3) / 1.1);
  return (
    <group scale={k}>
      {([3, 2, 1] as Tier[]).map((tier, row) => {
        const z = -0.5 + row * 0.31;
        return (
          <group key={tier} position={[0, 0, z]}>
            <group position={[-0.56, 0, 0]}>
              <Clickable onClick={p.onDeck && p.deckCounts[tier] > 0 ? () => p.onDeck!(tier) : null}>
                <DeckPile count={p.deckCounts[tier]} back={backs[tier]()} w={CW} h={CH} max={12} />
                {p.onDeck && <HitBox size={[CW, 0.12, CH]} />}
              </Clickable>
            </group>
            {p.markets[tier].map((c, i) => (
              <group key={c?.id ?? `empty-${i}`} position={[-0.31 + i * 0.22, 0, 0]}>
                {c && (
                  <Clickable onClick={p.onCard ? () => p.onCard!(c) : null}>
                    <PopIn>
                      <FlatCard face={cardTex(c)} back={backs[tier]()} w={CW} h={CH} glow={p.affordable.has(c.id) ? "#fde68a" : null} />
                    </PopIn>
                    {p.onCard && <HitBox size={[CW, 0.08, CH]} />}
                  </Clickable>
                )}
              </group>
            ))}
          </group>
        );
      })}
      {/* nobles beyond the market */}
      {p.nobles.map((n, i) => (
        <group key={n.id} position={[(i - (p.nobles.length - 1) / 2) * 0.2, 0, -0.84]}>
          <FlatCard face={nobleTex(n)} back={nobleTex(n)} w={0.17} h={0.17} />
        </group>
      ))}
      {/* gem bank on my side */}
      {(["white", "blue", "green", "red", "black", "gold"] as TokenColor[]).map((color, i) => {
        const count = p.bank[color] ?? 0;
        const pickable = color !== "gold" && !!p.onToken && count > 0;
        const pickedN = color === "gold" ? 0 : p.picked.filter((x) => x === color).length;
        return (
          <group key={color} position={[-0.45 + i * 0.18, 0, 0.5]}>
            <Clickable onClick={pickable ? () => p.onToken!(color as GemColor) : null}>
              {pickedN > 0 && <GlowDisc color="#fde68a" r={0.09} opacity={0.6} />}
              <CoinStack count={count} color={GEM_HEX[color]} max={7} />
              {pickable && <HitBox size={[0.16, 0.2, 0.16]} />}
            </Clickable>
          </group>
        );
      })}
    </group>
  );
}

function Shelf({ s }: { s: SplendorSeat3D }) {
  return (
    <group>
      {GEM_ORDER.map((color, i) => {
        const n = s.bonuses[color] ?? 0;
        return (
          <group key={color} position={[(i - 2) * 0.13, 0, -0.1]}>
            {Array.from({ length: Math.min(n, 8) }, (_, k) => (
              <group key={k} position={[0, 0.002 + k * 0.003, k * 0.025]}>
                <mesh rotation-x={-Math.PI / 2}>
                  <planeGeometry args={[0.1, 0.14]} />
                  <meshStandardMaterial color={GEM_HEX[color]} roughness={0.5} />
                </mesh>
              </group>
            ))}
          </group>
        );
      })}
      {(["white", "blue", "green", "red", "black", "gold"] as TokenColor[]).map((color, i) => (
        <group key={color} position={[(i - 2.5) * 0.11, 0, 0.18]}>
          <CoinStack count={s.tokens[color] ?? 0} color={GEM_HEX[color]} max={7} />
        </group>
      ))}
      {Array.from({ length: s.reserved }, (_, k) => (
        <group key={k} position={[0.45, 0.002 + k * 0.004, -0.05 - k * 0.03]} rotation-y={0.3}>
          <FlatCard face={null} back={backs[2]()} w={0.11} h={0.15} lift={0} />
        </group>
      ))}
    </group>
  );
}

const THEME: TableTheme = {
  background: "#120c1a",
  fog: [9, 24],
  ambient: ["#f5e1ff", 0.3],
  hemi: ["#ede9fe", "#120c1a", 0.42],
  fills: [["#a78bfa", 0.35, -6, 5, -6]],
  lamp: { color: "#fff4e0", intensity: 26, height: 3.3 },
  table: { top: "#2a1f42", rim: "#3a2412", felt: "#2a1f42", inlay: "#e9d5a0", base: "#1a1020" },
  chair: "wood",
  chairColor: "#4a1d5c",
  seatColors: ["#a78bfa", "#f472b6", "#38bdf8", "#facc15"],
  hats: ["beret", "none", "fedora", "none"],
};

export default function SplendorTable3D(props: SplendorTable3DProps) {
  const { viewerSeat, activeSeat } = props;
  const seats: TableSeat[] = props.seats.map((s) => {
    const mood: PersonMood = props.overview ? (s.score >= 15 ? "cheer" : "clap") : activeSeat === s.seat ? "think" : "rest";
    return {
      seat: s.seat,
      name: s.name,
      away: s.away,
      sub: `🏆 ${s.score} · 👑 ${s.nobles} · 💎 ${Object.values(s.tokens).reduce((a, b) => a + (b ?? 0), 0)}`,
      mood,
      lookSeat: activeSeat !== null && activeSeat !== s.seat ? activeSeat : "center",
      active: activeSeat === s.seat,
      tag: s.seat === viewerSeat ? { text: `🏆 내 점수 ${s.score}`, color: "#e9d5a0" } : null,
      front: <Shelf s={s} />,
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
          wall="#2a1a33"
          floor={{ kind: "tiles", a: "#e7dcc8", b: "#3a2a44" }}
          rug="#3b0d3a"
          trim="#e9d5a0"
          windows={{ color: "#ffd9a8", count: 3, arched: true }}
          frames={["#4a1d5c", "#1e3a8a", "#7c2d12"]}
          pillars="#cfc6b8"
        />
      }
      center={<Market {...props} />}
      overview={props.overview}
      lowDetail={props.lowDetail}
      ringColor="#e9d5a0"
    />
  );
}
