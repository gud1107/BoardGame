"use client";

import { approxChestSpots, geometryFor, SKY_TOP, ZONES, type MapDef } from "./data";
import { geoFloor, ICE_TOP } from "./mapGeometry";

/**
 * Rulebook mini map: a to-scale side cross-section of a dive site, drawn from
 * the same geometry the engine collides with — seabed profile, ice sheet with
 * its breathing holes, solid structures, depth-zone boundaries, approximate
 * treasure-chest spots, the dive start and its safe zone. `compact` = the
 * map-picker thumbnail (no labels/caption).
 */
export default function MapProfile({ map, compact = false }: { map: MapDef; compact?: boolean }) {
  const g = geometryFor(map);
  const W = map.width;
  const top = Math.max(SKY_TOP * 0.35, -320);
  const bottom = g.floorMax + 160;
  const H = bottom - top;
  const step = 40;
  const floorPts: string[] = [];
  for (let x = 0; x <= W; x += step) floorPts.push(`${x},${geoFloor(g, x).toFixed(0)}`);
  const floorPath = `M0,${bottom} L${floorPts.join(" L")} L${W},${bottom} Z`;

  // Ice sheet as runs between breathing holes.
  const ice: [number, number][] = [];
  if (g.ice) {
    let start: number | null = null;
    for (let x = 0; x <= W; x += 20) {
      const covered = !g.ice.holes.some(([cx, wd]) => Math.abs(x - cx) < wd / 2);
      if (covered && start === null) start = x;
      if ((!covered || x + 20 > W) && start !== null) {
        ice.push([start, covered ? W : x]);
        start = null;
      }
    }
  }
  const startX = 1400, startY = 260;
  const gradId = `mp-water-${map.id}`;
  const sky = map.palette.sky;
  const water = map.palette.water;
  const structColor = (k: string) => (k === "hull" || k === "mast" ? "#3b2a1a" : "#e0f2fe");
  const depthM = Math.round(g.floorMax / 10);
  const zoneLines = ZONES.slice(0, -1).filter((z) => z.to < g.floorMax);
  const chests = approxChestSpots(map);
  const zoneName = (to: number) => ZONES.find((z) => z.from === to)?.name ?? "";

  return (
    <figure className={compact ? "mt-1.5" : "mt-1.5"}>
      <svg
        viewBox={`0 ${top} ${W} ${H}`}
        className={`block h-auto w-full rounded-md ${compact ? "opacity-95 ring-1 ring-black/20" : ""}`}
        role="img"
        aria-label={`${map.name} 지형 단면도`}
      >
        <defs>
          <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={water[0]} />
            <stop offset="0.3" stopColor={water[1]} />
            <stop offset="0.65" stopColor={water[2]} />
            <stop offset="1" stopColor={water[4]} />
          </linearGradient>
        </defs>
        <rect x={0} y={top} width={W} height={-top} fill={sky[1]} />
        <rect x={0} y={0} width={W} height={bottom} fill={`url(#${gradId})`} />
        {zoneLines.map((z) => (
          <g key={z.id}>
            <line x1={0} x2={W} y1={z.to} y2={z.to} stroke="rgba(255,255,255,0.35)" strokeWidth={compact ? 18 : 12} strokeDasharray="120 90" />
            {!compact && (
              <text x={W - 60} y={z.to - 40} fontSize={170} textAnchor="end" fill="rgba(255,255,255,0.75)">
                {Math.round(z.to / 10)}m · {zoneName(z.to)}
              </text>
            )}
          </g>
        ))}
        <path d={floorPath} fill={map.palette.sand[0]} stroke="rgba(0,0,0,0.35)" strokeWidth={14} />
        {ice.map(([a, b]) => (
          <rect key={a} x={a} y={ICE_TOP - 20} width={b - a} height={g.ice!.thickness + 40} fill="#f0f9ff" opacity={0.95} />
        ))}
        {g.colliders.map((c, i) => (
          <circle key={i} cx={c.x} cy={c.y} r={c.r} fill={structColor(c.kind ?? "")} />
        ))}
        {chests.map((c, i) => (
          <circle key={`c${i}`} cx={c.x} cy={c.y} r={compact ? 95 : 75} fill="#facc15" stroke="#713f12" strokeWidth={compact ? 24 : 18} />
        ))}
        {map.safeStart && (
          <circle cx={startX} cy={startY} r={map.safeStart.radius} fill="rgba(94,234,212,0.12)" stroke="#5eead4" strokeWidth={22} strokeDasharray="90 70" />
        )}
        <text x={startX} y={startY + 90} fontSize={compact ? 340 : 260} textAnchor="middle">🦈</text>
      </svg>
      {!compact && (
        <figcaption className="mt-0.5 flex flex-wrap justify-between gap-x-2 text-[10px] text-white/45 light:text-slate-500">
          <span>◀ 0m · 🦈 시작 지점{map.safeStart ? " (🛡 안전 구역)" : ""} · 🟡 보물 상자(대략 위치 — 잠수마다 ±30m, 침몰선·얼음 기둥 근처는 반대편일 수도) · 점선 = 수심 구역 경계</span>
          <span>가로 {(W / 10).toLocaleString()}m · 최대 수심 약 {depthM}m ▶</span>
        </figcaption>
      )}
    </figure>
  );
}
