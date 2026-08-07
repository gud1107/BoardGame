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
