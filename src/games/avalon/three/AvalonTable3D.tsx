"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import TableScene, { useTableGeo, type TableSeat, type TableTheme } from "@/games/shared/three/TableScene";
import { FlatCard, FlyIn, GlowDisc, PopIn, TableSign } from "@/games/shared/three/tablePieces";
import { paintedTexture, FONTS, type BubbleStyle } from "@/games/shared/three/tableKit";
import type { PersonMood } from "@/games/shared/three/SeatedPerson";

/**
 * 아발론 3D — 카멜롯 성의 원탁. 가운데엔 바위에 꽂힌 엑스칼리버와 원정 트랙
 * (라운드마다 필요한 인원·성공/실패 표식), 거부 트랙. 리더 앞엔 왕관 토큰,
 * 원정대로 지목된 기사 앞엔 방패가 돌고, 리더는 사람(또는 내 명패)을 눌러
 * 원정대를 고른다. 투표는 진행 중엔 엎어진 토큰만, 결과가 나오면 찬성/반대가
 * 뒤집히고 손을 들거나 어깨를 으쓱한다. 원정 카드는 엎어진 채 가운데로
 * 모이고, 결과가 나오면 섞인 채 앞면으로 펼쳐진다.
 *
 * 보드가 공개 정보만 넘긴다: 투표는 전원 투표가 끝난 뒤에만, 원정 카드는
 * 누가 냈는지 없이 성공/실패 장수만. 역할은 이 장면에 오지 않는다.
 */

export interface AvalonSeat3D {
  seat: number;
  /** 연결 끊김(봇 대체 전). */
  away?: boolean;
  name: string;
  isLeader: boolean;
  onTeam: boolean;
  /** 리더가 지금 고르고 있는 좌석(로컬 선택). */
  selected: boolean;
  /** 진행 중 투표를 마쳤는지(내용은 비공개). */
  voted: boolean;
  /** 공개된 투표 결과(전원 투표 후에만). */
  vote: "approve" | "reject" | null;
  /** 원정 카드 제출 완료. */
  questSubmitted: boolean;
  onSelect: (() => void) | null;
}

export interface AvalonTable3DProps {
  playerCount: number;
  viewerSeat: number;
  seats: AvalonSeat3D[];
  phase: "team-proposal" | "voting" | "quest" | "assassination";
  round: number;
  teamSizes: number[];
  /** 라운드별 2장 실패 필요 여부. */
  twoFails: boolean[];
  results: { success: boolean; failCount: number; teamSize: number }[];
  consecutiveRejects: number;
  /** 원정 진행 중 엎어진 카드 수. */
  questCardsIn: number;
  /** 방금 끝난 원정의 공개 카드(성공/실패 장수만). */
  lastQuestReveal: { success: number; fail: number; round: number } | null;
  assassinSeat: number | null;
  overview: boolean;
  lowDetail: boolean;
}

const SEAT_COLORS = ["#60a5fa", "#f87171", "#4ade80", "#facc15", "#c084fc", "#22d3ee", "#fb923c", "#a3e635", "#f472b6", "#94a3b8"];

// ---------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------

function roundTableTexture(): THREE.Texture {
  return paintedTexture("avalon:table", 1024, 1024, (ctx, W) => {
    const c = W / 2;
    const wedges = 24;
    for (let i = 0; i < wedges; i++) {
      ctx.fillStyle = i % 2 === 0 ? "#1f4d2c" : "#e8dcc0";
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.arc(c, c, c, (i / wedges) * Math.PI * 2, ((i + 1) / wedges) * Math.PI * 2);
      ctx.closePath();
      ctx.fill();
    }
    // wood grain overlay
    ctx.globalAlpha = 0.14;
    for (let r = 20; r < c; r += 9) {
      ctx.strokeStyle = r % 2 ? "#3b2412" : "#000";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(c, c, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // inner rose
    const g = ctx.createRadialGradient(c, c, 10, c, c, 260);
    g.addColorStop(0, "#8b1d1d");
    g.addColorStop(1, "#4a0f12");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c, c, 250, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#d4a52c";
    ctx.lineWidth = 10;
    ctx.stroke();
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(c, c, 470, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
      ctx.fillStyle = "#f1d48a";
      ctx.beginPath();
      ctx.ellipse(c + Math.cos(a) * 120, c + Math.sin(a) * 120, 70, 34, a, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function trackTexture(round: number, size: number, two: boolean, current: boolean): THREE.CanvasTexture {
  return paintedTexture(`avalon:track:${round}:${size}:${two}:${current}`, 256, 256, (ctx, W) => {
    const c = W / 2;
    const g = ctx.createRadialGradient(c, c, 20, c, c, c);
    g.addColorStop(0, current ? "#fde68a" : "#e7d8b5");
    g.addColorStop(1, current ? "#b45309" : "#8a7350");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c, c, c - 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#3b2412";
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.fillStyle = "#2b1a0c";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `900 112px ${FONTS.text}`;
    ctx.fillText(String(size), c, c + 8);
    ctx.font = `700 34px ${FONTS.text}`;
    ctx.fillText(`${round}R`, c, 46);
    if (two) {
      ctx.fillStyle = "#b91c1c";
      ctx.font = `800 30px ${FONTS.text}`;
      ctx.fillText("실패 2", c, W - 40);
    }
  });
}

function tokenTexture(kind: "approve" | "reject" | "hidden"): THREE.CanvasTexture {
  return paintedTexture(`avalon:token:${kind}`, 128, 128, (ctx, W) => {
    const c = W / 2;
    ctx.fillStyle = kind === "approve" ? "#15803d" : kind === "reject" ? "#b91c1c" : "#1e293b";
    ctx.beginPath();
    ctx.arc(c, c, c - 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#d4a52c";
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = kind === "hidden" ? `60px ${FONTS.emoji}` : `900 76px ${FONTS.text}`;
    ctx.fillText(kind === "approve" ? "✓" : kind === "reject" ? "✗" : "🏰", c, c + 4);
  });
}

function questCardTexture(kind: "success" | "fail" | "back"): THREE.CanvasTexture {
  return paintedTexture(`avalon:quest:${kind}`, 256, 360, (ctx, W, H) => {
    ctx.beginPath();
    ctx.roundRect(4, 4, W - 8, H - 8, 20);
    ctx.save();
    ctx.clip();
    const g = ctx.createLinearGradient(0, 0, 0, H);
    if (kind === "success") {
      g.addColorStop(0, "#1d4ed8");
      g.addColorStop(1, "#0b1f5c");
    } else if (kind === "fail") {
      g.addColorStop(0, "#b91c1c");
      g.addColorStop(1, "#450a0a");
    } else {
      g.addColorStop(0, "#3a2a18");
      g.addColorStop(1, "#1a120a");
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    ctx.strokeStyle = "#d4a52c";
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.roundRect(10, 10, W - 20, H - 20, 16);
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `110px ${FONTS.emoji}`;
    ctx.fillText(kind === "success" ? "🏆" : kind === "fail" ? "🗡️" : "🛡️", W / 2, H / 2 - 20);
    ctx.fillStyle = "#fef3c7";
    ctx.font = `800 40px ${FONTS.text}`;
    ctx.fillText(kind === "success" ? "성공" : kind === "fail" ? "실패" : "원정", W / 2, H - 62);
  });
}

// ---------------------------------------------------------------------------
// Castle hall
// ---------------------------------------------------------------------------

function wallTexture(): THREE.Texture {
  const t = paintedTexture("avalon:wall", 512, 256, (ctx, W, H) => {
    ctx.fillStyle = "#4b4640";
    ctx.fillRect(0, 0, W, H);
    for (let y = 0, row = 0; y < H; y += 32, row++) {
      for (let x = row % 2 ? -32 : 0; x < W; x += 64) {
        const v = 78 + ((x * 3 + row * 17) % 30);
        ctx.fillStyle = `rgb(${v},${v - 4},${v - 10})`;
        ctx.fillRect(x + 2, y + 2, 60, 28);
      }
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(10, 3);
  return t;
}

function heraldry(color: string, sym: string): THREE.CanvasTexture {
  return paintedTexture(`avalon:banner:${color}:${sym}`, 128, 320, (ctx, W, H) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(W, 0);
    ctx.lineTo(W, H - 50);
    ctx.lineTo(W / 2, H);
    ctx.lineTo(0, H - 50);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#e9b949";
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.font = `64px ${FONTS.emoji}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(sym, W / 2, 120);
  });
}

function Fireplace({ light }: { light: boolean }) {
  const fire = useRef<THREE.Group>(null);
  const pl = useRef<THREE.PointLight>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    fire.current?.children.forEach((c, i) => c.scale.set(1, 1 + Math.sin(t * (9 + i * 2.3) + i) * 0.2, 1));
    if (pl.current) pl.current.intensity = 9 + Math.sin(t * 11) * 1.2;
  });
  return (
    <group position={[0, 0, -9.6]}>
      <mesh position={[0, 1.3, 0]}>
        <boxGeometry args={[3.2, 2.6, 0.8]} />
        <meshStandardMaterial color="#5a544c" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.8, 0.41]}>
        <planeGeometry args={[1.8, 1.4]} />
        <meshBasicMaterial color="#120806" />
      </mesh>
      <group ref={fire} position={[0, 0.45, 0.5]}>
        {[-0.4, 0, 0.4].map((x, i) => (
          <mesh key={i} position={[x, 0.25, 0]}>
            <coneGeometry args={[0.24, 0.7, 8]} />
            <meshBasicMaterial color={i === 1 ? "#ffd166" : "#ff7b2f"} />
          </mesh>
        ))}
      </group>
      {light && <pointLight ref={pl} position={[0, 1, 1.2]} color="#ff8a3d" intensity={9} distance={9} decay={2} />}
    </group>
  );
}

function CastleHall({ lowDetail }: { lowDetail: boolean }) {
  const seg = lowDetail ? 24 : 48;
  const wall = useMemo(() => wallTexture(), []);
  const banners = [
    ["#1e3a8a", "🐉"],
    ["#7f1d1d", "🦁"],
    ["#14532d", "🌳"],
    ["#581c87", "⚜️"],
  ] as const;
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[12, seg]} />
        <meshStandardMaterial color="#5c544a" roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.006, 0]} rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[4.6, seg]} />
        <meshStandardMaterial color="#1e2a4a" roughness={1} />
      </mesh>
      <mesh position={[0, 0.008, 0]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[4.3, 4.5, seg]} />
        <meshStandardMaterial color="#d4a52c" roughness={0.5} metalness={0.6} />
      </mesh>
      <mesh position={[0, 4.5, 0]}>
        <cylinderGeometry args={[10, 10, 9, seg, 1, true]} />
        <meshStandardMaterial map={wall} roughness={0.95} side={THREE.BackSide} />
      </mesh>
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
        const [color, sym] = banners[i % banners.length];
        return (
          <group key={i} position={[Math.sin(a) * 9.9, 0, Math.cos(a) * 9.9]} rotation-y={a + Math.PI}>
            {i % 2 === 0 ? (
              <>
                <mesh position={[0, 3.8, 0]}>
                  <planeGeometry args={[1.3, 3.0]} />
                  <meshBasicMaterial color="#f6c77a" />
                </mesh>
                <mesh position={[0, 5.3, 0]}>
                  <circleGeometry args={[0.65, 20, 0, Math.PI]} />
                  <meshBasicMaterial color="#f8d79a" />
                </mesh>
                <mesh position={[0, 3.8, 0.01]}>
                  <planeGeometry args={[0.05, 3.0]} />
                  <meshBasicMaterial color="#2b2118" />
                </mesh>
              </>
            ) : (
              <mesh position={[0, 4.0, 0]}>
                <planeGeometry args={[1.1, 2.75]} />
                <meshStandardMaterial map={heraldry(color, sym)} transparent roughness={0.9} side={THREE.DoubleSide} />
              </mesh>
            )}
          </group>
        );
      })}
      <Fireplace light={!lowDetail} />
      {/* evening sun through the windows */}
      <directionalLight position={[6, 7, 6]} intensity={0.55} color="#ffc98a" />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Centre: sword in the stone + mission / reject tracks
// ---------------------------------------------------------------------------

function SwordInStone() {
  const blade = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (blade.current) blade.current.emissiveIntensity = 0.25 + Math.sin(clock.elapsedTime * 1.8) * 0.15;
  });
  return (
    <group>
      <mesh position={[0, 0.07, 0]} castShadow scale={[1, 0.6, 0.9]}>
        <dodecahedronGeometry args={[0.16, 0]} />
        <meshStandardMaterial color="#77736b" roughness={0.95} flatShading />
      </mesh>
      <group position={[0, 0.12, 0]} rotation-z={0.06}>
        <mesh position={[0, 0.18, 0]} castShadow>
          <boxGeometry args={[0.03, 0.36, 0.008]} />
          <meshStandardMaterial ref={blade} color="#dfe7f2" metalness={0.95} roughness={0.18} emissive="#93c5fd" emissiveIntensity={0.3} />
        </mesh>
        <mesh position={[0, 0.37, 0]}>
          <boxGeometry args={[0.15, 0.022, 0.03]} />
          <meshStandardMaterial color="#d4a52c" metalness={0.9} roughness={0.25} />
        </mesh>
        <mesh position={[0, 0.43, 0]}>
          <cylinderGeometry args={[0.012, 0.012, 0.1, 8]} />
          <meshStandardMaterial color="#5b2a12" roughness={0.7} />
        </mesh>
        <mesh position={[0, 0.49, 0]}>
          <sphereGeometry args={[0.022, 10, 8]} />
          <meshStandardMaterial color="#d4a52c" metalness={0.9} roughness={0.25} />
        </mesh>
      </group>
    </group>
  );
}

function MissionTrack(props: Pick<AvalonTable3DProps, "teamSizes" | "twoFails" | "results" | "round" | "consecutiveRejects">) {
  return (
    <group>
      {props.teamSizes.map((size, i) => {
        // an arc on the far side of the centre, facing me
        const a = Math.PI - (i - 2) * 0.48;
        const x = Math.sin(a) * 0.44;
        const z = Math.cos(a) * 0.44;
        const r = props.results[i];
        const current = props.round === i + 1 && !r;
        return (
          <group key={i} position={[x, 0.008, z]}>
            {current && <GlowDisc color="#fbbf24" r={0.12} opacity={0.5} />}
            <mesh rotation-x={-Math.PI / 2}>
              <circleGeometry args={[0.095, 28]} />
              <meshStandardMaterial map={trackTexture(i + 1, size, props.twoFails[i], current)} roughness={0.6} />
            </mesh>
            {r && (
              <PopIn>
                <mesh position={[0, 0.02, 0]} castShadow>
                  <cylinderGeometry args={[0.07, 0.07, 0.03, 24]} />
                  <meshStandardMaterial color={r.success ? "#2563eb" : "#dc2626"} metalness={0.3} roughness={0.35} emissive={r.success ? "#1e3a8a" : "#7f1d1d"} emissiveIntensity={0.5} />
                </mesh>
              </PopIn>
            )}
          </group>
        );
      })}
      {/* reject track on the near side */}
      {Array.from({ length: 5 }, (_, i) => {
        const x = (i - 2) * 0.1;
        const filled = i < props.consecutiveRejects;
        return (
          <group key={`rj${i}`} position={[x, 0.008, 0.52]}>
            <mesh rotation-x={-Math.PI / 2}>
              <circleGeometry args={[0.036, 16]} />
              <meshStandardMaterial color={i === 4 ? "#7f1d1d" : "#3a2a18"} roughness={0.7} />
            </mesh>
            {filled && (
              <PopIn>
                <mesh position={[0, 0.012, 0]}>
                  <cylinderGeometry args={[0.03, 0.03, 0.018, 16]} />
                  <meshStandardMaterial color="#f97316" emissive="#9a3412" emissiveIntensity={0.6} />
                </mesh>
              </PopIn>
            )}
          </group>
        );
      })}
    </group>
  );
}

const SIGN_STYLE: BubbleStyle = { bg: "rgba(20,24,48,0.92)", fg: "#fde68a", border: "#d4a52c", size: 42 };

function CenterSign({ text }: { text: string }) {
  return <TableSign text={text} style={SIGN_STYLE} y={1.0} width={1.15} />;
}

/** Face-down quest cards gathering in the centre while the team plays them, then shuffled face up. */
function QuestPile({ count, reveal }: { count: number; reveal: AvalonTable3DProps["lastQuestReveal"] }) {
  const geo = useTableGeo();
  const back = questCardTexture("back");
  if (reveal) {
    // a fixed shuffle so successes and fails mix (no seat information)
    const cards = [...Array(reveal.success).fill("success"), ...Array(reveal.fail).fill("fail")] as ("success" | "fail")[];
    const order = cards.map((c, i) => ({ c, k: Math.sin((i + 1) * 77.7 + reveal.round) })).sort((a, b) => a.k - b.k);
    return (
      <group position={[0, 0, 0.26]}>
        {order.map(({ c }, i) => (
          <group key={`${reveal.round}-${i}`} position={[(i - (order.length - 1) / 2) * 0.2, 0.01, 0]}>
            <PopIn delay={i * 0.25}>
              <FlatCard face={questCardTexture(c)} back={back} w={0.17} h={0.24} glow={c === "fail" ? "#ef4444" : null} />
            </PopIn>
          </group>
        ))}
      </group>
    );
  }
  return (
    <group position={[0, 0, 0.26]}>
      {Array.from({ length: count }, (_, i) => (
        <group key={i} position={[Math.sin(i * 2.1) * 0.03, 0.01 + i * 0.008, Math.cos(i * 1.3) * 0.03]} rotation-y={Math.sin(i * 4.7) * 0.4}>
          <FlyIn from={new THREE.Vector3(0, 0.6, geo.seatR * 0.4)} dur={0.5} arc={0.3}>
            <FlatCard face={null} back={back} w={0.17} h={0.24} />
          </FlyIn>
        </group>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Seat props
// ---------------------------------------------------------------------------

function shieldShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-0.08, 0.1);
  s.lineTo(0.08, 0.1);
  s.lineTo(0.08, 0.0);
  s.quadraticCurveTo(0.075, -0.07, 0, -0.11);
  s.quadraticCurveTo(-0.075, -0.07, -0.08, 0.0);
  s.closePath();
  return s;
}
const shieldGeo = new THREE.ExtrudeGeometry(shieldShape(), { depth: 0.015, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.005, bevelSegments: 2 });
shieldGeo.center();

function TeamShield({ color }: { color: string }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.rotation.y = clock.elapsedTime * 1.4;
      ref.current.position.y = 0.2 + Math.sin(clock.elapsedTime * 2.2) * 0.02;
    }
  });
  return (
    <group ref={ref} position={[0, 0.2, 0]}>
      <PopIn>
        <mesh geometry={shieldGeo} castShadow>
          <meshStandardMaterial color={color} metalness={0.4} roughness={0.35} />
        </mesh>
        <mesh position={[0, 0.005, 0.013]}>
          <boxGeometry args={[0.022, 0.16, 0.006]} />
          <meshStandardMaterial color="#e9b949" metalness={0.8} roughness={0.3} />
        </mesh>
        <mesh position={[0, 0.03, 0.013]}>
          <boxGeometry args={[0.12, 0.022, 0.006]} />
          <meshStandardMaterial color="#e9b949" metalness={0.8} roughness={0.3} />
        </mesh>
      </PopIn>
    </group>
  );
}

function LeaderCrown() {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.rotation.y = clock.elapsedTime * 0.8;
  });
  const gold = <meshStandardMaterial color="#f5c542" metalness={0.9} roughness={0.22} emissive="#5a3a00" emissiveIntensity={0.3} />;
  return (
    <group ref={ref} position={[-0.2, 0.0, 0.02]}>
      <mesh position={[0, 0.04, 0]} castShadow>
        <cylinderGeometry args={[0.07, 0.075, 0.06, 20, 1, true]} />
        {gold}
      </mesh>
      {Array.from({ length: 6 }, (_, i) => {
        const a = (i / 6) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.sin(a) * 0.07, 0.09, Math.cos(a) * 0.07]}>
            <coneGeometry args={[0.016, 0.05, 4]} />
            {gold}
          </mesh>
        );
      })}
    </group>
  );
}

function VoteToken({ kind }: { kind: "approve" | "reject" | "hidden" }) {
  return (
    <group position={[0.18, 0, 0.02]}>
      <PopIn>
        <mesh position={[0, 0.012, 0]} castShadow>
          <cylinderGeometry args={[0.065, 0.065, 0.02, 28]} />
          <meshStandardMaterial color="#3a2a18" roughness={0.6} />
        </mesh>
        <mesh position={[0, 0.023, 0]} rotation-x={-Math.PI / 2}>
          <circleGeometry args={[0.062, 28]} />
          <meshStandardMaterial map={tokenTexture(kind)} roughness={0.5} />
        </mesh>
      </PopIn>
    </group>
  );
}

// ---------------------------------------------------------------------------

const THEME: TableTheme = {
  background: "#14121c",
  fog: [9, 24],
  ambient: ["#ffe6c7", 0.32],
  hemi: ["#ffe2b8", "#1a1420", 0.42],
  fills: [["#93c5fd", 0.25, -6, 6, -6]],
  lamp: { color: "#ffe0aa", intensity: 24, height: 3.4 },
  table: { top: "#4a2c17", rim: "#3d2312", felt: "#1f4d2c", inlay: "#d4a52c", base: "#2a170b", feltMap: roundTableTexture },
  chair: "wood",
  chairColor: "#4a2a17",
  seatColors: SEAT_COLORS,
  hats: ["helmet", "none", "circlet", "none", "helmet", "beret"],
};

const VOTE_STYLE: Record<"approve" | "reject", BubbleStyle> = {
  approve: { bg: "rgba(220,252,231,0.97)", fg: "#14532d", border: "#22c55e" },
  reject: { bg: "rgba(254,226,226,0.97)", fg: "#7f1d1d", border: "#ef4444" },
};

export default function AvalonTable3D(props: AvalonTable3DProps & { names: Record<number, string> }) {
  const { playerCount: n, viewerSeat, phase, names } = props;
  const leader = props.seats.find((s) => s.isLeader)?.seat ?? null;
  const teamSize = props.teamSizes[props.round - 1];

  const seats: TableSeat[] = props.seats.map((s) => {
    let mood: PersonMood = "rest";
    let lookSeat: TableSeat["lookSeat"] = leader !== null && leader !== s.seat ? leader : "center";
    let bubble: TableSeat["bubble"] = null;
    let tag: TableSeat["tag"] = null;
    if (phase === "team-proposal") {
      if (s.isLeader) mood = "think";
      if (s.vote) {
        // the vote that just failed stays readable until the next proposal
        mood = s.vote === "approve" ? "raise" : "shrug";
      }
    } else if (phase === "voting") {
      mood = s.voted ? "smug" : "think";
      lookSeat = "center";
      if (s.voted) tag = { text: "🗳️ 투표 완료", color: "#94a3b8" };
    } else if (phase === "quest") {
      if (s.onTeam) {
        mood = s.questSubmitted ? "rest" : "write";
        lookSeat = "center";
        if (s.questSubmitted) tag = { text: "🃏 제출", color: "#93c5fd" };
      } else mood = "nervous";
      if (s.vote && !s.onTeam) mood = s.vote === "approve" ? "rest" : "shrug";
    } else if (phase === "assassination") {
      if (props.assassinSeat === s.seat) {
        mood = "point";
        lookSeat = null;
        tag = { text: "🗡️ 암살자", color: "#ef4444", bg: "rgba(76,5,25,0.85)" };
      } else {
        mood = "nervous";
        lookSeat = props.assassinSeat ?? "center";
      }
    }
    if (s.vote && (phase === "team-proposal" || phase === "quest")) {
      bubble = { text: s.vote === "approve" ? "찬성 👍" : "반대 👎", style: VOTE_STYLE[s.vote], key: `v${props.round}-${props.consecutiveRejects}`, width: 0.62 };
    }
    if (s.isLeader && !tag) tag = { text: "👑 리더", color: "#f5c542" };
    const ring = s.selected ? "#fbbf24" : s.onTeam && phase !== "team-proposal" ? "#60a5fa" : null;
    const tokenKind: "approve" | "reject" | "hidden" | null = s.vote ?? (phase === "voting" && s.voted ? "hidden" : null);
    return {
      seat: s.seat,
      name: s.name,
      away: s.away,
      sub: s.onTeam && phase !== "team-proposal" ? "🛡️ 원정대" : s.selected ? "✋ 선택됨" : null,
      mood,
      lookSeat,
      ring,
      tag,
      bubble,
      onSelect: s.onSelect,
      front: (
        <group>
          {s.isLeader && <LeaderCrown />}
          {(s.selected || (s.onTeam && phase !== "team-proposal")) && <TeamShield color={s.selected ? "#b45309" : "#1d4ed8"} />}
          {tokenKind && <VoteToken key={tokenKind} kind={tokenKind} />}
        </group>
      ),
    };
  });

  const selectedCount = props.seats.filter((s) => s.selected).length;
  const sign =
    phase === "team-proposal"
      ? `${props.round}라운드 · 원정대 ${teamSize}명\n${leader !== null ? `${names[leader]}님이 고르는 중 (${selectedCount}/${teamSize})` : ""}`
      : phase === "voting"
        ? `원정대 찬반 투표\n${props.seats.filter((s) => s.voted).length}/${n}명 투표`
        : phase === "quest"
          ? `원정 진행 중\n카드 ${props.questCardsIn}/${teamSize}장`
          : "🗡️ 암살자가 메를린을 찾는 중…";

  return (
    <TableScene
      cameraKey="avalon-camera"
      seatCount={n}
      viewerSeat={viewerSeat}
      seats={seats}
      theme={THEME}
      environment={<CastleHall lowDetail={props.lowDetail} />}
      center={
        <group>
          <SwordInStone />
          <MissionTrack teamSizes={props.teamSizes} twoFails={props.twoFails} results={props.results} round={props.round} consecutiveRejects={props.consecutiveRejects} />
          {(phase === "quest" || props.lastQuestReveal) && <QuestPile count={props.questCardsIn} reveal={phase === "quest" ? null : props.lastQuestReveal} />}
          <CenterSign text={sign} />
        </group>
      }
      overview={props.overview}
      lowDetail={props.lowDetail}
      ringColor="#fde68a"
    />
  );
}
