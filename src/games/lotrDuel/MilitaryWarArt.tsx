"use client";

import { useId, type ReactNode } from "react";

/**
 * 반지의 제왕: 가운데땅에서의 대결 — red (military) card battle scenes.
 * Replaces the single shared shield-and-blades picture with six dark-crimson
 * war scenes, picked per card name (`WAR_SCENE_BY_NAME`, all 16 red cards
 * listed explicitly; `warSceneFor` falls back to keywords / unit count for
 * any future card):
 *
 * - ROHAN_CAVALRY     rider + lance charging at dawn, banner, hoof dust
 * - SHIELD_WALL       fortress wall, locked shields and spears, fire-arrow rain
 * - SIEGE_CATAPULT    white city tiers, trebuchet, flaming boulder, siege tower
 * - ORC_HORDE         blood moon, spiked helms, bloodied cleaver, torches
 * - ARCHER_VOLLEY     dark forest, drawn longbow, arrow volley across the sky
 * - MORDOR_ONSLAUGHT  ash sky, erupting peak, troll war-hammer, lava front
 *
 * Same contract as `CardArt.tsx`: inline vector on a 64×64 box (nothing to
 * 404), `useId` gradient ids, generic fantasy silhouettes only (no film
 * stills or logos), deterministic ember/arrow layouts.
 */

export type WarScene = "ROHAN_CAVALRY" | "SHIELD_WALL" | "SIEGE_CATAPULT" | "ORC_HORDE" | "ARCHER_VOLLEY" | "MORDOR_ONSLAUGHT";

export const WAR_SCENE_LABEL: Record<WarScene, string> = {
  ROHAN_CAVALRY: "기마 돌격",
  SHIELD_WALL: "방패벽 방어선",
  SIEGE_CATAPULT: "공성 투석 화염탄",
  ORC_HORDE: "오크 군단 행진",
  ARCHER_VOLLEY: "숲 궁병 일제사격",
  MORDOR_ONSLAUGHT: "모르도르 총력전",
};

/** Every red card in data.ts, mapped by theme (Rohan 2 · shields 3 · siege 2 · orcs 3 · archers 4 · Mordor 2). */
export const WAR_SCENE_BY_NAME: Record<string, WarScene> = {
  "로히림 돌격": "ROHAN_CAVALRY",
  "아이센 여울 전초": "ROHAN_CAVALRY",
  "헬름 협곡 수비대": "SHIELD_WALL",
  "오스길리아스 수비대": "SHIELD_WALL",
  "린돈 수비대": "SHIELD_WALL",
  "곤도르 탑 경비대": "SIEGE_CATAPULT",
  "펠렌노르 대군": "SIEGE_CATAPULT",
  "우루크하이 선봉": "ORC_HORDE",
  "안개산맥 오크떼": "ORC_HORDE",
  "던랜드 부족": "ORC_HORDE",
  "국경 순찰대": "ARCHER_VOLLEY",
  "동부 정찰병": "ARCHER_VOLLEY",
  "북방 연합군": "ARCHER_VOLLEY",
  "어둠숲 거미떼": "ARCHER_VOLLEY",
  "검은 문 군단": "MORDOR_ONSLAUGHT",
  "하라드림 원군": "MORDOR_ONSLAUGHT",
};

export function warSceneFor(name: string, units = 1): WarScene {
  const exact = WAR_SCENE_BY_NAME[name];
  if (exact) return exact;
  if (/기마|로한|로히림|돌격/.test(name)) return "ROHAN_CAVALRY";
  if (/투석|공성|펠렌노르|탑/.test(name)) return "SIEGE_CATAPULT";
  if (/방패|수비|협곡/.test(name)) return "SHIELD_WALL";
  if (/궁병|순찰|정찰|사격|숲/.test(name)) return "ARCHER_VOLLEY";
  if (/모르도르|총력|검은/.test(name) || units >= 3) return "MORDOR_ONSLAUGHT";
  return "ORC_HORDE";
}

type Def = { id: (k: string) => string; url: (k: string) => string };
function useDefs(): Def {
  const base = useId().replace(/:/g, "");
  return { id: (k) => `${base}-${k}`, url: (k) => `url(#${base}-${k})` };
}

const Frame = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 64 64" className="h-full w-full" aria-hidden>
    {children}
  </svg>
);

/** Shared crimson sky + ember glow + vignette, so all six read as one suite. */
function Sky({ d, top, mid, glowAt = "50% 85%", glow = "#f97316" }: { d: Def; top: string; mid: string; glowAt?: string; glow?: string }) {
  const [gx, gy] = glowAt.split(" ");
  return (
    <>
      <defs>
        <linearGradient id={d.id("sky")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={top} />
          <stop offset="60%" stopColor={mid} />
          <stop offset="100%" stopColor="#0c0204" />
        </linearGradient>
        <radialGradient id={d.id("glow")} cx={gx} cy={gy} r="60%">
          <stop offset="0%" stopColor={glow} stopOpacity=".75" />
          <stop offset="100%" stopColor={glow} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={d.id("vig")} cx="50%" cy="50%" r="72%">
          <stop offset="60%" stopColor="#000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000" stopOpacity=".7" />
        </radialGradient>
        <linearGradient id={d.id("steel")} x1="0" x2="1">
          <stop offset="0%" stopColor="#f8fafc" />
          <stop offset="100%" stopColor="#64748b" />
        </linearGradient>
        <radialGradient id={d.id("fire")} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fef9c3" />
          <stop offset="45%" stopColor="#fb923c" />
          <stop offset="100%" stopColor="#dc2626" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="64" height="64" fill={d.url("sky")} />
      <rect width="64" height="64" fill={d.url("glow")} />
    </>
  );
}

const Vignette = ({ d }: { d: Def }) => <rect width="64" height="64" fill={d.url("vig")} />;

/** Drifting embers — fixed positions (no Math.random in render). */
const EMBERS = [
  [8, 14, 0.7],
  [19, 8, 0.5],
  [29, 17, 0.6],
  [41, 6, 0.8],
  [52, 15, 0.5],
  [57, 26, 0.7],
  [12, 28, 0.5],
  [46, 22, 0.6],
];
const Embers = ({ color = "#fdba74", n = 8 }: { color?: string; n?: number }) => (
  <g fill={color}>
    {EMBERS.slice(0, n).map(([x, y, r], i) => (
      <circle key={i} cx={x} cy={y} r={r} opacity={0.55 + (i % 3) * 0.15} />
    ))}
  </g>
);

function RohanCavalry() {
  const d = useDefs();
  return (
    <Frame>
      <Sky d={d} top="#7f1d1d" mid="#b45309" glowAt="78% 30%" glow="#fcd34d" />
      {/* rising sun */}
      <circle cx="50" cy="20" r="7" fill="#fde68a" opacity=".9" />
      <circle cx="50" cy="20" r="11" fill="#fbbf24" opacity=".25" />
      {/* hills */}
      <path d="M0 46 C12 40 22 44 34 40 C46 36 54 42 64 38 V64 H0 Z" fill="#3f1d0b" />
      <path d="M0 52 C14 48 30 54 44 49 C52 46 58 49 64 47 V64 H0 Z" fill="#1c0a04" />
      {/* hoof dust */}
      <g fill="#d6a55a">
        <ellipse cx="14" cy="50" rx="10" ry="3.2" opacity=".35" />
        <ellipse cx="7" cy="46" rx="6" ry="2.4" opacity=".25" />
        <ellipse cx="22" cy="53" rx="7" ry="2" opacity=".3" />
      </g>
      {/* horse (galloping, facing right) */}
      <g fill="#fef3c7" stroke="#78350f" strokeWidth=".5">
        <path d="M18 38 C20 32 30 31 38 32 L44 26 C45 24 48 23 50 24 L53 27 C52 28.5 50.5 28.5 49 28.3 L46.5 33 C46.5 37 44.5 40 41 41 L45 47 L43 48.5 L38.5 42 L29 42 L22.5 48.5 L20.5 47 L24 41.5 C20.5 41.5 18 40.5 18 38 Z" />
        <path d="M41 41 L37 49 L35 48 L37.5 41.5 Z M29 42 L28 50 L26 50 L26.5 42 Z" />
      </g>
      {/* golden mane + tail */}
      <path d="M44 26 C41 27 39 29 37.5 32 M46 25 C43 26.5 41 28.5 40 31" stroke="#f59e0b" strokeWidth="1.3" fill="none" strokeLinecap="round" />
      <path d="M18.5 37 C14 36 11.5 39.5 10 44 C13.5 41 16 40 19 39.5 Z" fill="#f59e0b" />
      {/* rider */}
      <path d="M31.5 31.5 L33 23 L37 23 L37.5 31.5 Z" fill="#1e3a2a" stroke="#d4a54a" strokeWidth=".5" />
      <circle cx="35" cy="20.5" r="2.4" fill="#e5e7eb" stroke="#78350f" strokeWidth=".4" />
      <path d="M32.6 19.5 L35 16.5 L37.4 19.5" fill="#d4a54a" />
      {/* lance + fluttering banner */}
      <path d="M24 33 L61 9" stroke={d.url("steel")} strokeWidth="1.4" strokeLinecap="round" />
      <path d="M53 14 C56 12 58 14.5 61.5 12.5 L60.5 18 C57.5 19.5 55.5 17 52.5 19 Z" fill="#15803d" stroke="#fde68a" strokeWidth=".4" />
      <path d="M55.5 15.8 L57.5 14.8" stroke="#fef3c7" strokeWidth=".8" />
      <Vignette d={d} />
    </Frame>
  );
}

function ShieldWall() {
  const d = useDefs();
  const arrows = [
    [4, 2],
    [16, -1],
    [28, 3],
    [40, 0],
    [52, 4],
  ];
  return (
    <Frame>
      <Sky d={d} top="#1c0708" mid="#450a0a" glowAt="50% 10%" glow="#ea580c" />
      {/* fortress wall + battlements */}
      <path d="M0 30 V22 H6 V19 H10 V22 H16 V19 H20 V22 H26 V19 H30 V22 H36 V19 H40 V22 H46 V19 H50 V22 H56 V19 H60 V22 H64 V30 Z" fill="#292524" stroke="#57534e" strokeWidth=".5" />
      <path d="M0 26 H64" stroke="#44403c" strokeWidth=".4" />
      {/* fire-arrow rain */}
      {arrows.map(([x, y], i) => (
        <g key={i}>
          <path d={`M${x + 10} ${y} L${x} ${y + 16}`} stroke="#fdba74" strokeWidth=".7" opacity=".85" />
          <circle cx={x + 0.4} cy={y + 15.4} r="1.8" fill={d.url("fire")} />
        </g>
      ))}
      {/* spears through the shield gaps */}
      <g stroke={d.url("steel")} strokeWidth="1.1" strokeLinecap="round">
        <path d="M12 44 L4 26" />
        <path d="M26 44 L19 25" />
        <path d="M40 44 L34 25" />
        <path d="M54 44 L49 26" />
      </g>
      <g fill="#e2e8f0">
        <path d="M4 26 L3 22 L5.8 25 Z" />
        <path d="M19 25 L18 21 L20.8 24 Z" />
        <path d="M34 25 L33.2 21 L35.8 24 Z" />
        <path d="M49 26 L48 22 L50.8 25 Z" />
      </g>
      {/* locked kite shields */}
      {[2, 16, 30, 44].map((x, i) => (
        <g key={x}>
          <path d={`M${x} 38 H${x + 18} V46 C${x + 18} 53 ${x + 13} 57 ${x + 9} 59 C${x + 5} 57 ${x} 53 ${x} 46 Z`} fill={i % 2 ? "#1e293b" : "#334155"} stroke="#cbd5e1" strokeWidth=".7" />
          <path d={`M${x + 9} 40 V56 M${x + 3} 46 H${x + 15}`} stroke="#b91c1c" strokeWidth="1.1" />
        </g>
      ))}
      <Embers color="#fb923c" n={5} />
      <Vignette d={d} />
    </Frame>
  );
}

function SiegeCatapult() {
  const d = useDefs();
  return (
    <Frame>
      <Sky d={d} top="#1e0b0b" mid="#7c2d12" glowAt="70% 55%" glow="#f97316" />
      {/* tiered white city on the right */}
      <g fill="#e7e5e4" stroke="#78716c" strokeWidth=".4">
        <path d="M40 58 V44 H64 V58 Z" />
        <path d="M44 44 V34 H64 V44 Z" />
        <path d="M49 34 V25 H64 V34 Z" />
        <path d="M55 25 V12 L58 8 L61 12 V25 Z" />
      </g>
      <path d="M40 44 H64 M44 34 H64 M49 25 H64" stroke="#a8a29e" strokeWidth=".8" />
      {/* fire on the walls */}
      <circle cx="47" cy="41" r="4" fill={d.url("fire")} />
      <circle cx="53" cy="31" r="3" fill={d.url("fire")} />
      {/* siege tower */}
      <path d="M26 58 V30 L29 27 H35 L38 30 V58 Z" fill="#3b2412" stroke="#92400e" strokeWidth=".6" />
      <path d="M26 38 H38 M26 46 H38 M26 30 L38 58 M38 30 L26 58" stroke="#78350f" strokeWidth=".5" />
      {/* trebuchet */}
      <g stroke="#a16207" strokeWidth="1.5" fill="none" strokeLinecap="round">
        <path d="M3 58 L10 40 L17 58" />
        <path d="M5 44 L22 22" />
      </g>
      <rect x="2" y="42" width="6" height="5" fill="#57534e" transform="rotate(-50 5 44)" />
      {/* flaming boulder + arc */}
      <path d="M22 22 C30 10 38 8 44 14" stroke="#fb923c" strokeWidth="1" strokeDasharray="1.6 1.6" fill="none" />
      <circle cx="44" cy="14" r="6" fill={d.url("fire")} />
      <circle cx="44" cy="14" r="2.6" fill="#44403c" stroke="#fde68a" strokeWidth=".5" />
      {/* ground smoke */}
      <path d="M0 58 C10 54 20 60 32 56 C44 52 54 58 64 55 V64 H0 Z" fill="#0c0a09" opacity=".85" />
      <Embers />
      <Vignette d={d} />
    </Frame>
  );
}

function OrcHorde() {
  const d = useDefs();
  return (
    <Frame>
      <Sky d={d} top="#180404" mid="#3f0a0a" glowAt="50% 30%" glow="#b91c1c" />
      {/* blood moon */}
      <circle cx="32" cy="20" r="12" fill="#7f1d1d" opacity=".75" />
      <circle cx="32" cy="20" r="12" fill="none" stroke="#dc2626" strokeWidth=".6" opacity=".6" />
      {/* torches */}
      {[
        [10, 26],
        [54, 24],
      ].map(([x, y]) => (
        <g key={x}>
          <path d={`M${x} ${y + 4} L${x} ${y + 26}`} stroke="#78350f" strokeWidth="1.3" />
          <circle cx={x} cy={y + 1} r="4.5" fill={d.url("fire")} />
        </g>
      ))}
      {/* raised bloodied cleaver */}
      <path d="M40 46 L46 18" stroke="#57534e" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M45 20 C50 18 54 20 55 25 L47 29 Z" fill={d.url("steel")} stroke="#1c1917" strokeWidth=".4" />
      <path d="M49 27.5 C50 28.5 49.5 31 50.2 32.5 M52.5 26.2 C53.2 27.5 52.8 29.5 53.4 30.5" stroke="#b91c1c" strokeWidth="1" strokeLinecap="round" />
      {/* jagged axe */}
      <path d="M22 46 L16 20" stroke="#57534e" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M17 22 L10 19 L12 24 L8 27 L18.5 28 Z" fill="#a1a1aa" stroke="#1c1917" strokeWidth=".4" />
      {/* ranks of spiked helms */}
      {[
        [4, 48, "#0f0a0a"],
        [18, 46, "#1c1414"],
        [32, 48, "#0f0a0a"],
        [46, 46, "#1c1414"],
        [11, 55, "#050303"],
        [25, 54, "#0a0606"],
        [39, 55, "#050303"],
        [53, 54, "#0a0606"],
      ].map(([x, y, c], i) => (
        <g key={i} fill={c as string} stroke="#44403c" strokeWidth=".4">
          <path d={`M${x} ${(y as number) + 14} V${(y as number) + 5} C${x} ${y} ${(x as number) + 12} ${y} ${(x as number) + 12} ${(y as number) + 5} V${(y as number) + 14} Z`} />
          <path d={`M${(x as number) + 3} ${(y as number) + 1.5} L${(x as number) + 4} ${(y as number) - 3} L${(x as number) + 5.5} ${(y as number) + 0.8} M${(x as number) + 7} ${(y as number) + 0.8} L${(x as number) + 8.5} ${(y as number) - 3.5} L${(x as number) + 9.5} ${(y as number) + 1.6}`} />
          <path d={`M${(x as number) + 3} ${(y as number) + 7} H${(x as number) + 5} M${(x as number) + 7} ${(y as number) + 7} H${(x as number) + 9}`} stroke="#ef4444" strokeWidth=".9" />
        </g>
      ))}
      <Embers color="#f87171" n={6} />
      <Vignette d={d} />
    </Frame>
  );
}

function ArcherVolley() {
  const d = useDefs();
  return (
    <Frame>
      <Sky d={d} top="#0a1a12" mid="#3b0d0d" glowAt="70% 20%" glow="#fca5a5" />
      {/* pale moon */}
      <circle cx="48" cy="12" r="5" fill="#fee2e2" opacity=".7" />
      {/* arrow volley across the sky */}
      <g stroke="#e5e7eb" strokeWidth=".6" opacity=".85">
        {[
          [8, 22],
          [18, 16],
          [28, 20],
          [38, 13],
          [14, 28],
          [34, 26],
        ].map(([x, y], i) => (
          <g key={i}>
            <path d={`M${x} ${y} L${x + 12} ${y - 6}`} />
            <path d={`M${x + 12} ${y - 6} L${x + 10} ${y - 6.2} L${x + 11} ${y - 4.4} Z`} fill="#e5e7eb" />
          </g>
        ))}
      </g>
      {/* dark forest trunks */}
      <g fill="#052e16">
        <path d="M2 64 V10 C3 6 6 6 7 10 V64 Z" />
        <path d="M56 64 V16 C57 12 60 12 61 16 V64 Z" />
        <path d="M11 64 V26 C12 23 14 23 15 26 V64 Z" opacity=".8" />
      </g>
      <path d="M0 50 C14 46 28 52 40 48 C50 45 58 48 64 46 V64 H0 Z" fill="#021a0c" />
      {/* drawn longbow + nocked arrow */}
      <path d="M28 20 C44 30 44 50 28 60" stroke="#ca8a04" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <path d="M28 20 L22 40 L28 60" stroke="#fef08a" strokeWidth=".6" fill="none" />
      <path d="M22 40 L58 34" stroke={d.url("steel")} strokeWidth="1.3" strokeLinecap="round" />
      <path d="M58 34 L53.5 31.8 L54.5 36 Z" fill="#e2e8f0" stroke="#b91c1c" strokeWidth=".4" />
      <path d="M22 40 L19 37.5 M22 40 L19.5 42.5 M24 39.7 L21 37.2 M24 39.7 L21.5 42.2" stroke="#16a34a" strokeWidth="1" />
      {/* archer's arm */}
      <path d="M20 44 C21 42 22 41 23 40.5" stroke="#1c1917" strokeWidth="2.6" strokeLinecap="round" />
      <Vignette d={d} />
    </Frame>
  );
}

function MordorOnslaught() {
  const d = useDefs();
  return (
    <Frame>
      <Sky d={d} top="#1a0505" mid="#450a0a" glowAt="50% 40%" glow="#ef4444" />
      {/* ash clouds */}
      <path d="M0 14 C10 8 20 16 30 10 C40 5 50 13 64 8 V0 H0 Z" fill="#0c0a09" opacity=".8" />
      {/* erupting peak */}
      <path d="M8 50 L30 20 L34 20 L56 50 Z" fill="#0a0707" />
      <path d="M30 20 L34 20 L33 26 L31 26 Z" fill="#f97316" />
      <circle cx="32" cy="18" r="6" fill={d.url("fire")} />
      <path d="M31 26 C30 32 32 36 29 42 M33 26 C34 31 33 35 35.5 40" stroke="#ea580c" strokeWidth="1" fill="none" />
      {/* troll with a war-hammer */}
      <g fill="#1c1917" stroke="#44403c" strokeWidth=".5">
        <path d="M40 60 C39 50 40 44 44 40 C47 38 52 38 55 41 C58 45 59 52 58 60 Z" />
        <circle cx="49.5" cy="35.5" r="4.2" />
        <path d="M42 45 C38 42 35 38 34 33" strokeWidth="3" stroke="#1c1917" fill="none" strokeLinecap="round" />
      </g>
      <circle cx="48" cy="35" r=".7" fill="#ef4444" />
      <circle cx="51" cy="35" r=".7" fill="#ef4444" />
      <path d="M34 34 L22 18" stroke="#57534e" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="15" y="12" width="12" height="8" rx="1.2" fill="#27272a" stroke="#dc2626" strokeWidth=".8" transform="rotate(-38 21 16)" />
      {/* lava front line */}
      <path d="M0 58 C8 55 16 60 24 57 C32 54 40 60 48 57 C54 55 60 58 64 56 V64 H0 Z" fill="#dc2626" opacity=".8" />
      <path d="M0 60 C10 58 20 62 32 59 C44 57 54 61 64 59" stroke="#fde68a" strokeWidth=".6" fill="none" opacity=".8" />
      <Embers color="#fca5a5" />
      <Vignette d={d} />
    </Frame>
  );
}

export function MilitaryWarArt({ name, units }: { name: string; units?: number }) {
  switch (warSceneFor(name, units)) {
    case "ROHAN_CAVALRY":
      return <RohanCavalry />;
    case "SHIELD_WALL":
      return <ShieldWall />;
    case "SIEGE_CATAPULT":
      return <SiegeCatapult />;
    case "ORC_HORDE":
      return <OrcHorde />;
    case "ARCHER_VOLLEY":
      return <ArcherVolley />;
    case "MORDOR_ONSLAUGHT":
      return <MordorOnslaught />;
  }
}
