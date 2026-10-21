"use client";

import TableScene, { type TableSeat, type TableTheme } from "@/games/shared/three/TableScene";
import { ChipPouch, CoinStack, DeckPile, FlatCard, PopIn, StandingCard, TableSign } from "@/games/shared/three/tablePieces";
import { OutdoorPlaza } from "@/games/shared/three/environments";
import { imageCardTexture, simpleBackTexture, simpleCardTexture, type BubbleStyle } from "@/games/shared/three/tableKit";
import type { PersonMood } from "@/games/shared/three/SeatedPerson";
import { propertyImageSrc } from "../CardArt";

/**
 * 포 세일 3D — 저녁 도시 옥상의 경매 테이블. 1단계엔 가운데에 이번 라운드
 * 매물(실제 부동산 그림)이 펼쳐지고 입찰 팟에 동전이 쌓인다. 포기한 사람은
 * 가장 싼 매물을 자기 앞으로 가져가며 어깨를 으쓱. 2단계엔 수표가 펼쳐지고
 * 각자 낸 부동산이 엎어져 있다가 모두 내면 한꺼번에 뒤집힌다.
 *
 * 비공개 정보는 넘기지 않는다: 남의 현금은 주머니, 남이 가진 부동산은 장수만,
 * 제출 카드는 공개 전까지 뒷면.
 */

export interface ForSaleSeat3D {
  seat: number;
  name: string;
  /** null = 남의 현금(비공개). */
  cash: number | null;
  propertyCount: number;
  checkCount: number;
  /** 이번 라운드 포기하고 가져간 매물. */
  claimed: number | null;
  stillBidding: boolean;
  /** 2단계: 제출 여부 + 보이는 값(공개 전엔 내 것만). */
  submitted: boolean;
  submittedValue: number | null;
  /** 2단계 결과: 받은 수표. */
  wonCheck: number | null;
  away?: boolean;
}

export interface ForSaleTable3DProps {
  playerCount: number;
  viewerSeat: number;
  seats: ForSaleSeat3D[];
  phase: "buying" | "selling";
  activeSeat: number | null;
  openCards: number[];
  currentBid: number;
  highBidder: number | null;
  openChecks: number[];
  revealed: boolean;
  deckCount: number;
  names: Record<number, string>;
  lowDetail: boolean;
}

const SEAT_COLORS = ["#38bdf8", "#fbbf24", "#f472b6", "#4ade80", "#a78bfa", "#fb923c"];

const propBack = () => simpleBackTexture("forsale-prop", "#0e3a52", "#04121b", "#7dd3fc", "🏠");
const propTex = (v: number) => imageCardTexture(`forsale:${v}`, propertyImageSrc(v), { text: String(v), bg: "rgba(12,74,110,0.92)", fg: "#ffffff" });
const checkTex = (v: number) =>
  simpleCardTexture(`forsale-check:${v}`, { icon: "🧾", big: v === 0 ? "$0" : `$${v / 1000}K`, caption: "CHECK", bg: ["#166534", "#052e16"], edge: "#bbf7d0" });

function money(v: number) {
  return `$${v.toLocaleString("en-US")}`;
}

const THEME: TableTheme = {
  background: "#1b1430",
  fog: [12, 36],
  ambient: ["#ffe0c2", 0.34],
  hemi: ["#ffcf9e", "#1a1426", 0.48],
  fills: [
    ["#ff9a6a", 0.6, -10, 6, -14],
    ["#93c5fd", 0.25, 6, 6, 8],
  ],
  lamp: { color: "#fff1d6", intensity: 18, height: 3.4 },
  table: { top: "#0e3a52", rim: "#2b1d12", felt: "#123f57", inlay: "#e9b949", base: "#1f140c" },
  chair: "wood",
  chairColor: "#2a3c4c",
  seatColors: SEAT_COLORS,
  hats: ["fedora", "none", "cap", "none", "bowler", "beret"],
};

const BID: BubbleStyle = { bg: "rgba(255,251,235,0.97)", fg: "#78350f", border: "#f59e0b" };
const PASS: BubbleStyle = { bg: "rgba(241,245,249,0.96)", fg: "#334155", border: "#94a3b8" };
const SIGN: BubbleStyle = { bg: "rgba(8,30,44,0.92)", fg: "#e0f2fe", border: "#38bdf8" };

function Center(p: ForSaleTable3DProps) {
  const cards = p.phase === "buying" ? p.openCards : p.openChecks;
  const n = cards.length;
  const sign =
    p.phase === "buying"
      ? p.currentBid > 0 && p.highBidder !== null
        ? `현재 입찰 ${money(p.currentBid)}\n${p.names[p.highBidder] ?? ""}`
        : "첫 입찰 대기"
      : p.revealed
        ? "공개! 높은 부동산 → 높은 수표"
        : "팔 부동산 1장을 비공개로 제출";
  return (
    <group>
      <group position={[-0.62, 0, -0.3]} rotation-y={0.25}>
        <DeckPile count={p.deckCount} back={p.phase === "buying" ? propBack() : simpleBackTexture("forsale-check", "#14532d", "#03140a", "#bbf7d0", "🧾")} w={0.2} h={0.28} max={16} />
      </group>
      {cards.map((c, i) => (
        <group key={`${p.phase}-${c}-${i}`} position={[(i - (n - 1) / 2) * 0.27, 0, -0.06]}>
          <PopIn delay={i * 0.08}>
            <group position={[0, 0, 0]} rotation-x={0}>
              <StandingCard face={p.phase === "buying" ? propTex(c) : checkTex(c)} back={propBack()} w={0.24} h={0.34} tilt={-0.55} />
            </group>
          </PopIn>
        </group>
      ))}
      {p.phase === "buying" && (
        <group position={[0, 0.01, 0.32]}>
          <CoinStack count={Math.round(p.currentBid / 1000)} />
        </group>
      )}
      <TableSign text={sign} style={SIGN} y={1.05} />
    </group>
  );
}

export default function ForSaleTable3D(props: ForSaleTable3DProps) {
  const { viewerSeat, phase, activeSeat } = props;
  const seats: TableSeat[] = props.seats.map((s) => {
    let mood: PersonMood = "rest";
    let bubble: TableSeat["bubble"] = null;
    if (phase === "buying") {
      if (activeSeat === s.seat) mood = "think";
      else if (props.highBidder === s.seat) {
        mood = "smug";
        bubble = { text: `${money(props.currentBid)}!`, style: BID, key: `b${props.currentBid}`, width: 0.7 };
      } else if (s.claimed !== null) {
        mood = "shrug";
        bubble = { text: `패스 → ${s.claimed}번`, style: PASS, key: `p${s.claimed}`, width: 0.72 };
      }
    } else {
      mood = props.revealed ? (s.wonCheck !== null && s.wonCheck >= 10000 ? "cheer" : "shrug") : s.submitted ? "smug" : "think";
      if (props.revealed && s.wonCheck !== null) bubble = { text: `+${money(s.wonCheck)}`, style: BID, key: `c${s.wonCheck}-${s.submittedValue}`, width: 0.66 };
    }
    return {
      seat: s.seat,
      name: s.name,
      away: s.away,
      sub: `🏠 ${s.propertyCount} · 🧾 ${s.checkCount}`,
      mood,
      lookSeat: activeSeat !== null && activeSeat !== s.seat ? activeSeat : "center",
      active: phase === "buying" && activeSeat === s.seat,
      bubble,
      tag: s.seat === viewerSeat && s.cash !== null ? { text: `💰 ${money(s.cash)}`, color: "#fbbf24" } : null,
      front: (
        <group>
          <group position={[0.4, 0, 0.06]}>{s.cash === null ? <ChipPouch color="#1e3a5f" /> : <CoinStack count={Math.round(s.cash / 1000)} />}</group>
          <group position={[-0.4, 0, 0.06]} rotation-y={0.2}>
            <DeckPile count={s.propertyCount} back={propBack()} w={0.13} h={0.18} max={14} />
          </group>
          {s.claimed !== null && phase === "buying" && (
            <group key={s.claimed} position={[0, 0, -0.06]}>
              <PopIn>
                <FlatCard face={propTex(s.claimed)} back={propBack()} w={0.2} h={0.28} />
              </PopIn>
            </group>
          )}
          {phase === "selling" && s.submitted && (
            <group position={[0, 0, -0.1]}>
              <PopIn>
                <FlatCard face={s.submittedValue !== null && (props.revealed || s.seat === viewerSeat) ? propTex(s.submittedValue) : null} back={propBack()} w={0.2} h={0.28} glow={props.revealed ? "#38bdf8" : null} />
              </PopIn>
            </group>
          )}
          {phase === "selling" && props.revealed && s.wonCheck !== null && (
            <group position={[0.18, 0.01, -0.12]} rotation-y={-0.3}>
              <PopIn delay={0.3}>
                <FlatCard face={checkTex(s.wonCheck)} back={propBack()} w={0.18} h={0.25} />
              </PopIn>
            </group>
          )}
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
        <OutdoorPlaza
          lowDetail={props.lowDetail}
          ground="#2b2a33"
          plaza="#4b4f5c"
          trim="#e9b949"
          skyline={{ kind: "city", color: "#1e2338", cap: "#ffcf7a" }}
          sun={{ color: "#ff9d5c", position: [-12, 3.5, -24], size: 2.6 }}
          wall="#3a3f4d"
        />
      }
      center={<Center {...props} />}
      overview={phase === "selling" && props.revealed}
      lowDetail={props.lowDetail}
    />
  );
}
