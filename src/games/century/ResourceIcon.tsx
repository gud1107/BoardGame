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

/**
 * Jewel palette per spice — deliberately richer than RESOURCE_META's flat
 * UI colors: each spice reads as a real stone (citrine, ruby, emerald,
 * smoky topaz). `hi`→`mid`→`lo` is the lit-to-shadow body ramp, `rim` the
 * girdle outline, `glint` the specular tint.
 */
const GEM: Record<Resource, { hi: string; mid: string; lo: string; rim: string; glint: string }> = {
  yellow: { hi: "#fff7c2", mid: "#f5b90b", lo: "#9a5b04", rim: "#6b3d02", glint: "#fffdf0" },
  red: { hi: "#ffd1dc", mid: "#e0183f", lo: "#6d0a22", rim: "#4a0616", glint: "#fff1f4" },
  green: { hi: "#c9fbe4", mid: "#0fae6f", lo: "#04513a", rim: "#033527", glint: "#effff7" },
  brown: { hi: "#f6d9b8", mid: "#a4581f", lo: "#43200a", rim: "#2c1405", glint: "#fff6ec" },
};

/**
 * Octagonal step-cut ("emerald cut") gemstone glyph — an outer girdle, four
 * trapezoid crown facets lit from the top-left, a flat table with a soft
 * inner glow, a thin gold-white rim line and one four-point sparkle. Kept
 * to a handful of large shapes so it still reads cleanly at 10-16px (point
 * card cost rows). Gradient ids are per-resource and identical wherever
 * they're repeated, so a duplicate id resolving to another instance is
 * harmless.
 */
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
  const g = GEM[resource];
  const id = (n: string) => `century-gem-${n}-${resource}`;
  return (
    <svg viewBox="0 0 24 24" className={className} role="img" aria-label={title ?? meta.label}>
      <title>{title ?? meta.label}</title>
      <defs>
        <linearGradient id={id("body")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={g.hi} />
          <stop offset="45%" stopColor={g.mid} />
          <stop offset="100%" stopColor={g.lo} />
        </linearGradient>
        <radialGradient id={id("table")} cx="38%" cy="32%" r="80%">
          <stop offset="0%" stopColor={g.glint} stopOpacity="0.95" />
          <stop offset="35%" stopColor={g.mid} />
          <stop offset="100%" stopColor={g.lo} />
        </radialGradient>
      </defs>
      {/* Drop shadow + girdle */}
      <polygon points="7.5,3.2 16.5,3.2 21.3,8 21.3,17 16.5,21.8 7.5,21.8 2.7,17 2.7,8" fill="#000" opacity="0.25" transform="translate(0 0.8)" />
      <polygon points="7.5,2.2 16.5,2.2 21.3,7 21.3,16 16.5,20.8 7.5,20.8 2.7,16 2.7,7" fill={`url(#${id("body")})`} stroke={g.rim} strokeWidth="0.9" strokeLinejoin="round" />
      {/* Crown facets: top/left lit, right/bottom in shadow */}
      <polygon points="7.5,2.2 16.5,2.2 15,6.4 9,6.4" fill="#fff" opacity="0.5" />
      <polygon points="2.7,7 7.5,2.2 9,6.4 6.9,8.5" fill="#fff" opacity="0.62" />
      <polygon points="2.7,7 6.9,8.5 6.9,14.5 2.7,16" fill="#fff" opacity="0.28" />
      <polygon points="16.5,2.2 21.3,7 17.1,8.5 15,6.4" fill="#fff" opacity="0.22" />
      <polygon points="21.3,7 21.3,16 17.1,14.5 17.1,8.5" fill="#000" opacity="0.18" />
      <polygon points="2.7,16 6.9,14.5 9,16.6 7.5,20.8" fill="#000" opacity="0.12" />
      <polygon points="21.3,16 16.5,20.8 15,16.6 17.1,14.5" fill="#000" opacity="0.3" />
      <polygon points="7.5,20.8 16.5,20.8 15,16.6 9,16.6" fill="#000" opacity="0.24" />
      {/* Table */}
      <polygon points="9,6.4 15,6.4 17.1,8.5 17.1,14.5 15,16.6 9,16.6 6.9,14.5 6.9,8.5" fill={`url(#${id("table")})`} stroke={g.glint} strokeOpacity="0.55" strokeWidth="0.45" strokeLinejoin="round" />
      <polygon points="9.6,7.6 13.4,7.6 11,10.4 8.1,10.4 8.1,9.1" fill="#fff" opacity="0.35" />
      {/* Sparkle */}
      <path d="M6.2 4.4 L6.7 5.8 L8.1 6.3 L6.7 6.8 L6.2 8.2 L5.7 6.8 L4.3 6.3 L5.7 5.8 Z" fill={g.glint} opacity="0.95" />
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
        background: `linear-gradient(145deg, ${GEM[resource].hi} 0%, ${GEM[resource].mid} 42%, ${GEM[resource].lo} 100%)`,
        boxShadow: `inset 0 1px 1px rgba(255,255,255,0.7), inset 0 -1.5px 2px rgba(0,0,0,0.35), 0 1.5px 2.5px rgba(0,0,0,0.45)`,
        border: `1px solid ${GEM[resource].rim}`,
      }}
    >
      {/* Polished step-cut: a soft bevel ring (lit top-left, shaded
          bottom-right) around an inset "table" facet with its own sheen. */}
      <span
        className="absolute inset-[18%] rounded-[3px]"
        style={{
          background: `linear-gradient(145deg, ${GEM[resource].hi} 0%, ${GEM[resource].mid} 55%, ${GEM[resource].lo} 120%)`,
          boxShadow: `0 0 0 0.5px ${GEM[resource].glint}99, inset 0 -1px 1.5px rgba(0,0,0,0.25)`,
          opacity: 0.9,
        }}
      />
      <span
        className="absolute top-[10%] left-[12%] h-[28%] w-[28%] rounded-full"
        style={{ background: "radial-gradient(circle, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0) 70%)" }}
      />
    </span>
  );
}

/**
 * Larger illustrated "hero" rendering of one spice, one distinct SVG per
 * resource rather than a shared gem/cube shape — a heaped bowl of ground
 * turmeric (yellow), a splayed bundle of saffron threads with a ruby facet
 * (red), a ridged cardamom pod with a leaf (green), a rolled cinnamon quill
 * (brown). Used anywhere the brief asks for a "고화질 입체 향신료 아이콘" beyond
 * the flat gem/cube glyphs above — spice-bowl headers, the mobile compact
 * dashboard's market strip, card-preview modals — while `ResourceIcon`/
 * `ResourceCube` stay untouched for every existing dense inline usage (cart
 * wells, chips, staked-card cubes) where this much detail wouldn't read at
 * that size anyway. Still pure inline SVG + gradients, same
 * no-external-image-asset convention as the rest of this module.
 */
export function SpiceHeroIcon({
  resource,
  className = "h-10 w-10",
  title,
}: {
  resource: Resource;
  className?: string;
  title?: string;
}) {
  const meta = RESOURCE_META[resource];
  const uid = resource; // stable per-resource id suffix, safe to reuse across multiple mounts of the same resource
  return (
    <svg viewBox="0 0 32 32" className={className} role="img" aria-label={title ?? meta.label}>
      <title>{title ?? meta.label}</title>
      <defs>
        <radialGradient id={`spice-glow-${uid}`} cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="45%" stopColor="#ffffff" stopOpacity="0.08" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>
      {resource === "yellow" && (
        <>
          {/* Bowl of ground turmeric — a squat clay bowl heaped with powder, dusted specks around it */}
          <ellipse cx="16" cy="24.5" rx="10.5" ry="3.2" fill="#7c5f38" opacity="0.35" />
          <path d="M6 20a10 4.4 0 0 0 20 0 v1.4a10 4.6 0 0 1 -20 0 Z" fill="#8a6a3a" stroke="#5b4322" strokeWidth="0.6" />
          <path d="M6.6 19.6C6.6 15.6 10.8 12.2 16 12.2s9.4 3.4 9.4 7.4c0 2.4-4.2 4.4-9.4 4.4s-9.4-2-9.4-4.4Z" fill="#facc15" stroke="#a3690a" strokeWidth="0.5" />
          <ellipse cx="16" cy="18.4" rx="7.4" ry="3.6" fill="#fde047" opacity="0.75" />
          <ellipse cx="13" cy="17.2" rx="2.6" ry="1.3" fill="#fff3b0" opacity="0.6" />
          <circle cx="9" cy="9" r="0.9" fill="#facc15" opacity="0.85" />
          <circle cx="22.5" cy="7.5" r="0.7" fill="#facc15" opacity="0.7" />
          <circle cx="24" cy="11" r="1" fill="#eab308" opacity="0.6" />
          <circle cx="12" cy="6.5" r="0.6" fill="#eab308" opacity="0.6" />
          <ellipse cx="16" cy="18" rx="10" ry="9" fill={`url(#spice-glow-${uid})`} />
        </>
      )}
      {resource === "red" && (
        <>
          {/* Splayed bundle of saffron threads fanning from a base knot, plus a ruby-cut accent gem */}
          <g stroke="#b91c1c" strokeWidth="1.4" strokeLinecap="round">
            <path d="M16 27 C13 20 10 14 7 6" />
            <path d="M16 27 C14.5 19 13 12 12 4" />
            <path d="M16 27 C15.6 18 15.8 11 16 3" />
            <path d="M16 27 C17.5 19 19 12 20 4" />
            <path d="M16 27 C19 20 22 14 25 6" />
          </g>
          <g fill="#f87171">
            <circle cx="7" cy="6" r="1.1" />
            <circle cx="12" cy="4" r="1" />
            <circle cx="16" cy="3" r="1" />
            <circle cx="20" cy="4" r="1" />
            <circle cx="25" cy="6" r="1.1" />
          </g>
          <polygon points="16,20 20,24 16,29 12,24" fill="#ef4444" stroke="#7f1d1d" strokeWidth="0.6" />
          <polygon points="16,20 20,24 16,24.5" fill="#fca5a5" opacity="0.7" />
          <ellipse cx="16" cy="16" rx="9" ry="11" fill={`url(#spice-glow-${uid})`} />
        </>
      )}
      {resource === "green" && (
        <>
          {/* Plump ridged cardamom pod with a small leaf */}
          <path d="M15 3c2.5 1 3.5 4 2 6.5-1 1.6-1 2-1 3.5 0 2 1.5 2.6 1.5 5 0 4-2.5 8-4.5 8s-4.5-4-4.5-8c0-2.4 1.5-3 1.5-5 0-1.5 0-1.9-1-3.5C7.5 7 8.5 4 11 3c1.3-0.5 2.7-0.5 4 0Z" fill="#22c55e" stroke="#14532d" strokeWidth="0.6" />
          <path d="M13 6.5c0 8 0 13.5 0 19M19 6.5c0 8 0 13.5 0 19" stroke="#14532d" strokeWidth="0.5" opacity="0.55" fill="none" />
          <path d="M9 10c1.5 0.6 2 2 1.8 3.6M23 10c-1.5 0.6-2 2-1.8 3.6" stroke="#14532d" strokeWidth="0.5" opacity="0.5" fill="none" />
          <ellipse cx="13.5" cy="9" rx="2.6" ry="4.5" fill="#86efac" opacity="0.55" />
          <path d="M22 4c2 0.5 3.5 2.4 3 4.4-1.8 0.4-3.6-0.6-4-2.6-0.2-0.9 0-1.6 1-1.8Z" fill="#4ade80" stroke="#166534" strokeWidth="0.5" />
          <ellipse cx="16" cy="16" rx="9" ry="12" fill={`url(#spice-glow-${uid})`} />
        </>
      )}
      {resource === "brown" && (
        <>
          {/* Rolled cinnamon quill — nested spiral rings + bark texture */}
          <path d="M6 15c0-6 5-11 11-11s11 5 11 11-4.5 10-10 10" fill="none" stroke="#a16207" strokeWidth="3.4" strokeLinecap="round" />
          <path d="M6 15c0-6 5-11 11-11s11 5 11 11-4.5 10-10 10" fill="none" stroke="#78350f" strokeWidth="3.4" strokeLinecap="round" opacity="0.35" strokeDasharray="0.5 3" />
          <circle cx="17" cy="15" r="6" fill="#c2793a" stroke="#78350f" strokeWidth="1" />
          <circle cx="17" cy="15" r="3.4" fill="#a16207" stroke="#5b3a10" strokeWidth="0.8" />
          <circle cx="17" cy="15" r="1.2" fill="#78350f" />
          <path d="M8 20c1.5 3 4.5 5 8 5.4" stroke="#78350f" strokeWidth="2.6" strokeLinecap="round" fill="none" />
          <ellipse cx="13" cy="10" rx="3" ry="1.6" fill="#e3a765" opacity="0.6" />
          <ellipse cx="16" cy="16" rx="10" ry="11" fill={`url(#spice-glow-${uid})`} />
        </>
      )}
    </svg>
  );
}
