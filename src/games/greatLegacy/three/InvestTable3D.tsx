"use client";

import TableScene, { type TableSeat, type TableTheme } from "@/games/shared/three/TableScene";
import { CardRow, ChipPouch, CoinStack, PopIn, StandingCard, TableSign } from "@/games/shared/three/tablePieces";
import { IndoorRoom } from "@/games/shared/three/environments";
import { imageCardTexture, simpleBackTexture, simpleCardTexture, type BubbleStyle } from "@/games/shared/three/tableKit";
import type { PersonMood } from "@/games/shared/three/SeatedPerson";
import { assetImageSrc } from "../lotPhotos";
import type { AuctionCardDef, Market } from "../types";

/**
 * 최고의 투자 3D — 시세 전광판이 번쩍이는 트레이딩 플로어의 경매 원탁. 가운데에
 * 이번 매물(실제 사진/일러스트)이 세워지고, 입찰한 코인은 각자 앞에 금화로
 * 쌓인다(공개). 손에 든 코인은 공개 모드거나 내 것일 때만 더미, 아니면 지갑.
 * 낙찰받은 자산은 각자 앞에 카드로 줄지어 눕는다. 역경매(악재·상장폐지)는
 * 붉은 팻말.
 */

export interface InvestSeat3D {
  seat: number;
  name: string;
  /** null = 비공개. */
  purse: number | null;
  committed: number;
  passed: boolean;
  assets: { id: string; market: Market; score: number; discarded: boolean }[];
  away?: boolean;
}

export interface InvestTable3DProps {
  playerCount: number;
  viewerSeat: number;
  seats: InvestSeat3D[];
  card: AuctionCardDef | null;
  reverse: boolean;
  activeSeat: number | null;
  highestBidder: number | null;
  highestBid: number;
  lotsLeft: number;
  overview: boolean;
  lowDetail: boolean;
}

const MARKET_BG: Record<Market, [string, string]> = { 미장: ["#1d4ed8", "#0b1a4a"], 국장: ["#be123c", "#3f0718"], 코인: ["#a16207", "#2e1d04"] };
const SPECIAL_ICON: Record<string, string> = { 초대형호재: "🚀", 악재어닝쇼크: "📉", 상장폐지: "⛔", 강제반대매매: "💥" };
const back = () => simpleBackTexture("invest", "#1f2937", "#030712", "#22c55e", "📈");

function lotTex(card: AuctionCardDef) {
  if (card.kind === "special")
    return simpleCardTexture(`invest:sp:${card.special}`, { icon: SPECIAL_ICON[card.special] ?? "⚡", caption: card.special, bg: card.special === "초대형호재" ? ["#15803d", "#052e16"] : ["#991b1b", "#2a0505"], edge: "#fde68a" });
  return imageCardTexture(`invest:${card.asset.id}`, assetImageSrc(card.asset.id), { text: String(card.asset.baseScore), bg: "rgba(0,0,0,0.75)", fg: "#fde68a" }, "#f2c94c");
}
const assetTex = (a: InvestSeat3D["assets"][number]) =>
  simpleCardTexture(`invest:own:${a.market}:${a.score}:${a.discarded}`, { big: a.discarded ? "✖" : String(a.score), caption: a.market, bg: a.discarded ? ["#3f3f46", "#18181b"] : MARKET_BG[a.market], edge: "#fde68a" });

const THEME: TableTheme = {
  background: "#05080c",
  fog: [9, 22],
  ambient: ["#d1fae5", 0.24],
  hemi: ["#bbf7d0", "#05080c", 0.36],
  fills: [
    ["#22c55e", 0.4, -6, 5, -5],
    ["#ef4444", 0.35, 6, 5, -5],
  ],
  lamp: { color: "#f0fdf4", intensity: 22, height: 3.2 },
  table: { top: "#0b1a12", rim: "#1f2937", felt: "#0c1f17", inlay: "#f2c94c", base: "#0b0f14" },
  chair: "wood",
  chairColor: "#1f2937",
  seatColors: ["#22c55e", "#f2c94c", "#38bdf8", "#f472b6", "#a78bfa", "#fb923c", "#22d3ee", "#f87171"],
  hats: ["none", "fedora", "none", "bowler", "none", "cap"],
};

const BID: BubbleStyle = { bg: "rgba(240,253,244,0.97)", fg: "#14532d", border: "#22c55e" };
const PASS: BubbleStyle = { bg: "rgba(241,245,249,0.96)", fg: "#334155", border: "#94a3b8" };
const SIGN: BubbleStyle = { bg: "rgba(5,20,12,0.92)", fg: "#bbf7d0", border: "#22c55e" };
const RSIGN: BubbleStyle = { bg: "rgba(60,6,6,0.92)", fg: "#fecaca", border: "#ef4444" };

export default function InvestTable3D(props: InvestTable3DProps) {
  const { viewerSeat, activeSeat } = props;
  const seats: TableSeat[] = props.seats.map((s) => {
    let mood: PersonMood = activeSeat === s.seat ? "think" : "rest";
    let bubble: TableSeat["bubble"] = null;
    if (props.highestBidder === s.seat) {
      mood = props.reverse ? "nervous" : "smug";
      bubble = { text: `${props.highestBid}코인!`, style: BID, key: `b${props.highestBid}`, width: 0.55 };
    } else if (s.passed) {
      mood = "shrug";
      bubble = { text: "패스", style: PASS, key: `p${props.lotsLeft}`, width: 0.4 };
    }
    if (props.overview) mood = "clap";
    return {
      seat: s.seat,
      name: s.name,
      away: s.away,
      sub: `💰 ${s.purse ?? "?"} · 📈 ${s.assets.filter((a) => !a.discarded).length}`,
      mood,
      lookSeat: activeSeat !== null && activeSeat !== s.seat ? activeSeat : "center",
      active: activeSeat === s.seat,
      bubble,
      tag: s.seat === viewerSeat ? { text: `💰 내 코인 ${s.purse ?? 0}`, color: "#f2c94c" } : null,
      front: (
        <group>
          <group position={[0.42, 0, 0.08]}>{s.purse === null ? <ChipPouch color="#14532d" /> : <CoinStack count={Math.min(30, Math.round(s.purse / 2))} />}</group>
          {s.committed > 0 && (
            <group position={[0, 0.002, -0.22]}>
              <PopIn>
                <CoinStack count={Math.min(30, Math.max(1, Math.round(s.committed / 2)))} color="#fbbf24" />
              </PopIn>
            </group>
          )}
          <group position={[-0.12, 0, 0.06]}>
            <CardRow faces={s.assets.map(assetTex)} back={back()} w={0.1} h={0.14} perRow={6} />
          </group>
        </group>
      ),
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
          wall="#0b1016"
          floor={{ kind: "tiles", a: "#0b1016", b: "#111827" }}
          rug="#0c1f17"
          trim="#f2c94c"
          windows={{ color: "#16a34a", count: 5 }}
          frames={["#7f1d1d", "#14532d", "#1e3a8a"]}
        />
      }
      center={
        <group>
          {props.card && (
            <group key={props.card.cardId} position={[0, 0, -0.05]}>
              <PopIn>
                <StandingCard face={lotTex(props.card)} back={back()} w={0.36} h={0.5} tilt={-0.35} />
              </PopIn>
            </group>
          )}
          <TableSign
            text={props.card ? `${props.reverse ? "🔻 역경매 — 먼저 포기하면 떠안음" : `최고 입찰 ${props.highestBid}코인`}\n남은 매물 ${props.lotsLeft}장` : "경매 종료"}
            style={props.reverse ? RSIGN : SIGN}
            y={1.15}
          />
        </group>
      }
      overview={props.overview}
      lowDetail={props.lowDetail}
      ringColor="#22c55e"
    />
  );
}
