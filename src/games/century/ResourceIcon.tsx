import type { Resource } from "./cards";

/**
 * Pure inline-SVG gem/cube icon per resource color — no external image
 * asset, same convention as perudo/PerudoFaceIcon.tsx. Colors follow the
 * rulebook's own names (§2): 노란색(심지/turmeric), 빨간색(홍화/saffron),
 * 초록색(카다멈/cardamom), 갈색(시나몬/cinnamon), in that value order (§4.1).
 */
export const RESOURCE_META: Record<Resource, { fill: string; stroke: string; label: string }> = {
  yellow: { fill: "#facc15", stroke: "#854d0e", label: "노란색 (심지)" },
  red: { fill: "#ef4444", stroke: "#7f1d1d", label: "빨간색 (홍화)" },
  green: { fill: "#22c55e", stroke: "#14532d", label: "초록색 (카다멈)" },
  brown: { fill: "#a16207", stroke: "#3f2408", label: "갈색 (시나몬)" },
};

export default function ResourceIcon({
  resource,
  className = "h-5 w-5",
  title,
}: {
  resource: Resource;
  className?: string;
  title?: string;
}) {
  const meta = RESOURCE_META[resource];
  return (
    <svg viewBox="0 0 24 24" className={className} role="img" aria-label={title ?? meta.label}>
      <title>{title ?? meta.label}</title>
      <polygon points="12,2 21,9 17,22 7,22 3,9" fill={meta.fill} stroke={meta.stroke} strokeWidth="1.5" strokeLinejoin="round" />
      <polygon points="12,2 21,9 12,11.5 3,9" fill="#ffffff" opacity="0.3" />
      <polygon points="7,22 17,22 12,11.5" fill="#000000" opacity="0.12" />
    </svg>
  );
}

/**
 * Glossy, rounded-corner 3D "sticker cube" — the physical wooden-cube stand-in
 * used anywhere a resource sits *on* something real (a caravan slot, a spice
 * bowl, a merchant card's staked pile), as opposed to `ResourceIcon`'s flatter
 * gem glyph used in text-adjacent badges/chips. Built from layered CSS
 * gradients + box-shadow only (no image asset, same convention as the rest of
 * this module) — a top-left highlight + bottom-right shade fake a rounded
 * cube's lit faces, and the outer shadow lifts it off whatever it's resting on.
 */
export function ResourceCube({
  resource,
  className = "h-6 w-6",
  title,
}: {
  resource: Resource;
  className?: string;
  title?: string;
}) {
  const meta = RESOURCE_META[resource];
  return (
    <span
      role="img"
      aria-label={title ?? meta.label}
      title={title ?? meta.label}
      className={`relative inline-block shrink-0 rounded-[6px] ${className}`}
      style={{
        background: `linear-gradient(155deg, ${meta.fill}f2 0%, ${meta.fill} 45%, ${meta.stroke} 130%)`,
        boxShadow: `inset 0 1.5px 1.5px rgba(255,255,255,0.75), inset 0 -2px 3px rgba(0,0,0,0.35), 0 2px 3px rgba(0,0,0,0.5)`,
        border: `1px solid ${meta.stroke}`,
      }}
    >
      <span
        className="absolute top-[12%] left-[14%] h-[35%] w-[35%] rounded-full"
        style={{ background: "radial-gradient(circle, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0) 75%)" }}
      />
    </span>
  );
}
