/**
 * Pure inline-SVG "오이" (cucumber) token visual — no external image asset,
 * same convention as splendor/GemToken.tsx, century/ResourceIcon.tsx, and
 * perudo/PerudoFaceIcon.tsx. Used both on card faces (cucumber-count icons,
 * task brief §2) and the player scoreboard (cucumber-token tally).
 */
export function CucumberIcon({ className = "h-4 w-4", title = "오이" }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} role="img" aria-label={title}>
      <title>{title}</title>
      <defs>
        <linearGradient id="cucumber-body" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#a3e635" />
          <stop offset="55%" stopColor="#4d9d2f" />
          <stop offset="100%" stopColor="#2f6e1c" />
        </linearGradient>
      </defs>
      <path
        d="M4.5 8.2C7 4.6 10.8 2.6 14.8 2.9c1.3.1 2.3 1.2 2.3 2.5 0 .5-.1.9-.4 1.3 2.6.6 4.4 2.9 4.2 5.6-.3 4.2-4.5 7.9-9.2 8.6-3.8.6-7.3-1-9-4.1-1.6-2.8-1.1-6.1 1.8-8.6Z"
        fill="url(#cucumber-body)"
        stroke="#1f4d12"
        strokeWidth="0.6"
      />
      <g stroke="#dff5c8" strokeWidth="0.5" strokeLinecap="round" opacity="0.8">
        <path d="M7 9.2c2.6-2.6 6-4.1 9-4.3" />
        <path d="M6 12.4c2.9-2.7 6.6-4.3 9.9-4.6" />
        <path d="M5.7 15.6c3-2.4 6.8-3.8 10.2-4" />
      </g>
    </svg>
  );
}

/** "🥒 x N" badge, matching splendor's `GemCountBadge` shape/spacing convention. */
export function CucumberCountBadge({ count, size = "h-4 w-4" }: { count: number; size?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/30 px-1.5 py-0.5 text-[11px] font-semibold text-white/90">
      <CucumberIcon className={size} />
      {count}
    </span>
  );
}

/** A row of N cucumber icons — used on card faces where the count itself IS the visual (task brief §2), not a "icon + number" badge. */
export function CucumberRow({ count, size = "h-3 w-3" }: { count: number; size?: string }) {
  if (count === 0) return <span className="text-[9px] text-white/25">오이 없음</span>;
  return (
    <span className="flex flex-wrap items-center gap-0.5" title={`오이 ${count}개`}>
      {Array.from({ length: count }, (_, i) => (
        <CucumberIcon key={i} className={size} />
      ))}
    </span>
  );
}
