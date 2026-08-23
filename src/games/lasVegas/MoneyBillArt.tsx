/**
 * Original inline-SVG "casino note" art for the rulebook's 9 bill values
 * ($10,000-$90,000, `MONEY_VALUES` in `engine.ts`) — same
 * "<Feature>Icon.tsx"/pure-SVG convention as `CasinoEmblem.tsx`/`DiceIcon.tsx`,
 * and the deliberate choice for this one asset per the user's decision
 * (2026-08-23 라스베가스 실사 에셋 요청): no real dollar-bill photo exists in
 * `boardGameRule/라스베가스/` to sync in (see `CasinoPhotoArt.tsx`'s doc for
 * the casino-photo half of that same request), so this renders as a fresh
 * illustrated casino chip-note — a distinct per-denomination color, an
 * engraved-guilloche-style border, and a die-pip corner mark tying it to the
 * game's own theme — rather than a photo-real US bank note (avoiding any
 * question of reproducing real currency imagery, on top of not having a
 * source photo to begin with). Replaces `LasVegasBoard.tsx`'s previous plain
 * `$N` text-in-a-div `MoneyStack` cards.
 */

/** One color identity per denomination — lets a stack be scanned by color before the digits even register, same reasoning as `CASINO_ACCENTS` in `LasVegasBoard.tsx`. */
const BILL_THEMES: Record<number, { top: string; bottom: string; ink: string; edge: string }> = {
  10_000: { top: "#d9f2e6", bottom: "#7fd8ac", ink: "#0b4a30", edge: "#2f8f5c" },
  20_000: { top: "#dcefff", bottom: "#82b8f2", ink: "#0c3868", edge: "#3e7bc4" },
  30_000: { top: "#eee3ff", bottom: "#bb96f2", ink: "#3a1568", edge: "#7c4dc4" },
  40_000: { top: "#ffe3f3", bottom: "#f290c6", ink: "#6b0f45", edge: "#c94d92" },
  50_000: { top: "#fff2d0", bottom: "#f6c34a", ink: "#5c3a02", edge: "#c98f10" },
  60_000: { top: "#ffe6d3", bottom: "#f4986a", ink: "#63260a", edge: "#c95c26" },
  70_000: { top: "#ffdcdc", bottom: "#f07373", ink: "#601313", edge: "#c93838" },
  80_000: { top: "#e4e4ff", bottom: "#8f8fe8", ink: "#211a5c", edge: "#4f4fbf" },
  90_000: { top: "#fef0b8", bottom: "#e8b400", ink: "#3d2c00", edge: "#a97800" },
};

function digitsOf(value: number): string {
  return value.toLocaleString("en-US");
}

/**
 * One bill note, ~100x44 native art (matches the ~w-full h-9 rectangle the
 * previous plain-text card used). `size` just scales the whole SVG —
 * callers still control the box via className/width like any `<svg>`.
 */
export function MoneyBillArt({
  value,
  className = "",
  title,
}: {
  value: number;
  className?: string;
  title?: string;
}) {
  const theme = BILL_THEMES[value] ?? BILL_THEMES[10_000];
  const id = `lv-bill-${value}`;
  const label = title ?? `${digitsOf(value)}원 상당 카지노 지폐`;
  return (
    <svg viewBox="0 0 100 44" className={`block h-full w-full ${className}`} role="img" aria-label={label} preserveAspectRatio="none">
      <title>{label}</title>
      <defs>
        <linearGradient id={`${id}-bg`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={theme.top} />
          <stop offset="100%" stopColor={theme.bottom} />
        </linearGradient>
      </defs>
      <rect x="0.6" y="0.6" width="98.8" height="42.8" rx="3.2" fill={`url(#${id}-bg)`} stroke={theme.edge} strokeWidth="1.2" />
      {/* inner engraved-look frame */}
      <rect x="3.2" y="3.2" width="93.6" height="37.6" rx="1.8" fill="none" stroke={theme.edge} strokeWidth="0.6" opacity="0.75" />
      {/* corner guilloche squiggles (purely decorative, not any real note's pattern) */}
      <g stroke={theme.edge} strokeWidth="0.5" fill="none" opacity="0.5">
        <path d="M5 8 q4 -4 8 0 t8 0" />
        <path d="M5 36 q4 4 8 0 t8 0" />
        <path d="M79 8 q4 -4 8 0 t8 0" />
        <path d="M79 36 q4 4 8 0 t8 0" />
      </g>
      {/* corner denomination + die-pip mark */}
      {[
        [8, 8],
        [92, 36],
      ].map(([cx, cy], i) => (
        <g key={i} transform={`translate(${cx} ${cy})`}>
          <circle r="5.6" fill={theme.edge} opacity="0.18" />
          <circle r="1.3" fill={theme.ink} />
        </g>
      ))}
      {/* center denomination — 2026-08-23 요청: 하단 배치 전환과 함께 액면가 폰트
          확대(12.5 → 15.5, 세로 정렬은 그대로 y=21 기준 유지, 최장 라벨
          "$90,000"(7자)도 100 단위 너비에 여유 있게 들어맞음). */}
      <text x="50" y="21" textAnchor="middle" fontSize="15.5" fontWeight="800" fill={theme.ink} fontFamily="ui-sans-serif, system-ui, sans-serif">
        ${digitsOf(value)}
      </text>
      <text x="50" y="32.5" textAnchor="middle" fontSize="4.2" fontWeight="700" letterSpacing="2.5" fill={theme.ink} opacity="0.75">
        LAS VEGAS CASINO
      </text>
    </svg>
  );
}

/** Small flying-bill glyph used by payout FX (`DiceEffects.tsx`'s money-fly) — same art, just a convenient default size. */
export function MoneyBillIcon({ value, className = "h-6 w-9" }: { value: number; className?: string }) {
  return <MoneyBillArt value={value} className={className} />;
}
