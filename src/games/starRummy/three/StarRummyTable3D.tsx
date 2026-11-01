"use client";

import { useMemo } from "react";
import * as THREE from "three";
import TableScene, { useTableGeo, type TableSeat, type TableTheme } from "@/games/shared/three/TableScene";
import { PopIn, TableSign } from "@/games/shared/three/tablePieces";
import { IndoorRoom } from "@/games/shared/three/environments";
import { FONTS, paintedTexture, type BubbleStyle } from "@/games/shared/three/tableKit";
import type { PersonMood } from "@/games/shared/three/SeatedPerson";
import { COLOR_SHAPES, isWild, tileOf, type LastEvent, type TileId } from "../engine";

/**
 * 별빛 러미 3D — an observatory study at night. The committed melds lie on the
 * navy felt packed into rows (shrinking as the table fills), the 관측소 tiles
 * and the face-down pool sit on the far side, and each seat has a wooden rack
 * of standing tile backs. Presentation only: the tiles are moved on the 2D
 * board below.
 */

export interface StarRummySeat3D {
  seat: number;
  name: string;
  tiles: number;
  score: number;
  opened: boolean;
  away?: boolean;
}

export interface StarRummyTable3DProps {
  playerCount: number;
  viewerSeat: number;
  seats: StarRummySeat3D[];
  activeSeat: number | null;
  table: TileId[][];
  observatory: TileId[];
  poolCount: number;
  lastEvent: LastEvent | null;
  round: number;
  totalRounds: number;
  overview: boolean;
  lowDetail: boolean;
}

const INK = ["#e11d48", "#2563eb", "#c47a06", "#059669"];
const TW = 0.075;
const TH = 0.1;
const TD = 0.022;

const tileGeo = new THREE.BoxGeometry(TW, TD, TH);
const faceGeo = new THREE.PlaneGeometry(TW * 0.92, TH * 0.92);
const bodyMat = new THREE.MeshStandardMaterial({ color: "#f3e7cc", roughness: 0.45 });
const backMat = new THREE.MeshStandardMaterial({ color: "#3730a3", roughness: 0.5 });
const glowMat = new THREE.MeshBasicMaterial({ color: "#fbbf24", transparent: true, opacity: 0.55, depthWrite: false });
const faceMats = new Map<TileId, THREE.MeshStandardMaterial>();

function faceMat(id: TileId): THREE.MeshStandardMaterial {
  const t = tileOf(id);
  const k = isWild(id) ? 96 : id % 48; // the two copies look the same
  let m = faceMats.get(k);
  if (m) return m;
  const tex = paintedTexture(`star-rummy:${k}`, 96, 128, (ctx, W, H) => {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, isWild(id) ? "#ddd6fe" : "#fffaf0");
    g.addColorStop(1, isWild(id) ? "#f0abfc" : "#efe2c4");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (isWild(id)) {
      ctx.font = `64px ${FONTS.emoji}`;
      ctx.fillText("☄️", W / 2, H / 2);
      return;
    }
    ctx.fillStyle = INK[t.color!];
    ctx.font = `900 ${t.num >= 10 ? 52 : 62}px ${FONTS.text}`;
    ctx.fillText(String(t.num), W / 2, H * 0.42);
    ctx.font = `700 26px ${FONTS.text}`;
    ctx.fillText(COLOR_SHAPES[t.color!], W / 2, H * 0.8);
  });
  m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 });
  faceMats.set(k, m);
  return m;
}

/** A tile lying face up (top of the face toward −z). */
function FlatTile({ id, glow }: { id: TileId; glow?: boolean }) {
  return (
    <group position={[0, TD / 2, 0]}>
      <mesh geometry={tileGeo} material={bodyMat} castShadow receiveShadow />
      <mesh geometry={faceGeo} material={faceMat(id)} rotation-x={-Math.PI / 2} position={[0, TD / 2 + 0.0008, 0]} />
      {glow && <mesh geometry={faceGeo} material={glowMat} rotation-x={-Math.PI / 2} position={[0, -TD / 2 - 0.001, 0]} scale={1.5} />}
    </group>
  );
}

/** A seat's rack: a wooden bar with tile backs standing on it (the owner's side is +z). */
function Rack({ count }: { count: number }) {
  const shown = Math.min(count, 16);
  const step = TW * 0.92;
  const width = Math.max(0.3, shown * step + 0.04);
  return (
    <group>
      <mesh position={[0, 0.015, 0.035]} castShadow>
        <boxGeometry args={[width, 0.03, 0.06]} />
        <meshStandardMaterial color="#6b3f1d" roughness={0.6} />
      </mesh>
      {Array.from({ length: shown }, (_, i) => (
        <group key={i} position={[(i - (shown - 1) / 2) * step, 0.03 + TH / 2, 0.03]} rotation-x={-0.22}>
          <mesh geometry={tileGeo} material={bodyMat} rotation-x={Math.PI / 2} castShadow />
          <mesh position={[0, 0, -TD / 2 - 0.0008]} rotation-y={Math.PI}>
            <planeGeometry args={[TW * 0.9, TH * 0.9]} />
            <primitive object={backMat} attach="material" />
          </mesh>
        </group>
      ))}
    </group>
  );
}

interface Placed {
  id: TileId;
  x: number;
  z: number;
}

/** Pack melds into rows inside the felt; shrink until everything fits. */
function layout(table: TileId[][], maxW: number, maxH: number): { tiles: Placed[]; scale: number; height: number } {
  for (let scale = 1; scale > 0.35; scale *= 0.9) {
    const w = TW * scale * 1.06;
    const gap = 0.045 * scale;
    const rowH = TH * scale * 1.22;
    const rows: TileId[][][] = [[]];
    let x = 0;
    for (const meld of table) {
      const mw = meld.length * w;
      if (x > 0 && x + mw > maxW) {
        rows.push([]);
        x = 0;
      }
      rows[rows.length - 1].push(meld);
      x += mw + gap;
    }
    const height = rows.length * rowH;
    if (height > maxH && scale > 0.4) continue;
    const tiles: Placed[] = [];
    rows.forEach((row, r) => {
      const rowW = row.reduce((s, m) => s + m.length * w, 0) + gap * (row.length - 1);
      let cx = -rowW / 2;
      const z = -height / 2 + rowH * (r + 0.5);
      for (const meld of row) {
        meld.forEach((id, i) => tiles.push({ id, x: cx + w * (i + 0.5), z }));
        cx += meld.length * w + gap;
      }
    });
    return { tiles, scale, height };
  }
  return { tiles: [], scale: 0.4, height: 0 };
}

function Center({ table, observatory, poolCount, lastEvent, sign }: { table: TileId[][]; observatory: TileId[]; poolCount: number; lastEvent: LastEvent | null; sign: string }) {
  const geo = useTableGeo();
  const inner = geo.tableR - 0.5;
  const maxW = inner * 1.55;
  const { tiles, scale, height } = useMemo(() => layout(table, maxW, inner * 1.05), [table, maxW, inner]);
  const fresh = new Set(lastEvent && (lastEvent.kind === "meld" || lastEvent.kind === "out") ? lastEvent.played : []);
  const farZ = -Math.max(height / 2 + 0.12, 0.3);
  return (
    <group position={[0, 0.002, 0.08]}>
      {tiles.map((t) => (
        <group key={t.id} position={[t.x, 0, t.z]} scale={scale}>
          {fresh.has(t.id) ? (
            <PopIn key={lastEvent?.seq}>
              <FlatTile id={t.id} glow />
            </PopIn>
          ) : (
            <FlatTile id={t.id} />
          )}
        </group>
      ))}
      {/* observatory + pool on the far side */}
      <group position={[0, 0, farZ]}>
        {observatory.map((id, i) => (
          <group key={id} position={[(i - 1) * TW * 1.25 - 0.1, 0, 0]}>
            <FlatTile id={id} />
          </group>
        ))}
        <group position={[0.22, 0, 0]}>
          {Array.from({ length: Math.min(8, Math.ceil(poolCount / 8)) }, (_, i) => (
            <mesh key={i} geometry={tileGeo} material={backMat} position={[0, TD / 2 + i * TD, 0]} castShadow />
          ))}
        </group>
      </group>
      <TableSign text={sign} style={SIGN} y={1.0} width={1.3} />
    </group>
  );
}

const THEME: TableTheme = {
  background: "#070818",
  fog: [9, 24],
  ambient: ["#c7d2fe", 0.32],
  hemi: ["#c4b5fd", "#0b0b1e", 0.42],
  fills: [["#60a5fa", 0.35, -6, 5, -6]],
  lamp: { color: "#fff1cc", intensity: 24, height: 3.2 },
  table: { top: "#1e1b4b", rim: "#3a2412", felt: "#1e2a5a", inlay: "#e0b84a", base: "#24140a" },
  chair: "wood",
  chairColor: "#312e81",
  seatColors: ["#f43f5e", "#3b82f6", "#f59e0b", "#10b981"],
  hats: ["none", "beret", "none", "cap"],
};

const SIGN: BubbleStyle = { bg: "rgba(10,10,35,0.9)", fg: "#fde68a", border: "#e0b84a" };
const PLAY_STYLE: BubbleStyle = { bg: "rgba(224,231,255,0.97)", fg: "#1e1b4b", border: "#818cf8" };
const DRAW_STYLE: BubbleStyle = { bg: "rgba(255,247,237,0.97)", fg: "#7c2d12", border: "#fb923c" };
const OUT_STYLE: BubbleStyle = { bg: "rgba(254,243,199,0.98)", fg: "#78350f", border: "#f59e0b" };

export default function StarRummyTable3D(props: StarRummyTable3DProps) {
  const { viewerSeat, activeSeat, lastEvent } = props;
  const seats: TableSeat[] = props.seats.map((s) => {
    let mood: PersonMood = activeSeat === s.seat ? "think" : "rest";
    let bubble: TableSeat["bubble"] = null;
    if (lastEvent?.seat === s.seat) {
      if (lastEvent.kind === "out") {
        mood = "cheer";
        bubble = { text: "러미! 🎉", style: OUT_STYLE, key: `e${lastEvent.seq}`, width: 0.6 };
      } else if (lastEvent.kind === "meld") {
        mood = lastEvent.played.length >= 4 ? "smug" : "point";
        bubble = { text: `${lastEvent.opened ? "첫 관측! " : ""}${lastEvent.played.length}장 ✨`, style: PLAY_STYLE, key: `e${lastEvent.seq}`, width: 0.72 };
      } else if (lastEvent.kind === "draw") {
        mood = "shrug";
        bubble = { text: lastEvent.from === "observatory" ? "이걸로! 🔭" : "한 장… 🎴", style: DRAW_STYLE, key: `e${lastEvent.seq}`, width: 0.62 };
      } else {
        mood = "wave";
        bubble = { text: "패스", style: DRAW_STYLE, key: `e${lastEvent.seq}`, width: 0.5 };
      }
    }
    if (props.overview) mood = "clap";
    return {
      seat: s.seat,
      name: s.name,
      away: s.away,
      sub: `🀫 ${s.tiles}장 · ⭐ ${s.score}${s.opened ? " · ✨" : ""}`,
      mood,
      lookSeat: activeSeat !== null && activeSeat !== s.seat ? activeSeat : "center",
      active: activeSeat === s.seat,
      bubble,
      tag: s.tiles <= 2 && s.tiles > 0 ? { text: `⚠️ ${s.tiles}장 남음`, color: "#fbbf24" } : null,
      front: <Rack count={s.tiles} />,
    };
  });

  return (
    <TableScene
      cameraKey="star-rummy-camera"
      seatCount={props.playerCount}
      viewerSeat={viewerSeat}
      seats={seats}
      theme={THEME}
      environment={
        <IndoorRoom
          lowDetail={props.lowDetail}
          wall="#151436"
          floor={{ kind: "planks", a: "#2a1a10", b: "#5a3a22" }}
          rug="#1e1b4b"
          trim="#e0b84a"
          windows={{ color: "#4c5fd7", count: 3, arched: true }}
          frames={["#1e3a8a", "#7c2d12", "#4c1d95"]}
        />
      }
      center={<Center table={props.table} observatory={props.observatory} poolCount={props.poolCount} lastEvent={lastEvent} sign={`라운드 ${props.round}/${props.totalRounds} · 🎴 ${props.poolCount}`} />}
      overview={props.overview}
      lowDetail={props.lowDetail}
    />
  );
}
