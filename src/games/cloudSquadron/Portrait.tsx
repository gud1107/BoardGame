import { useId } from "react";
import { PILOTS, type PilotId } from "./data";

/**
 * 조종사 초상화 (SVG). 얼굴에 왼쪽 위 빛·오른쪽 아래 그늘, 머리카락 윤기, 대표색 테두리 빛,
 * 비행 재킷 깃과 어깨 휘장까지. 색만이 아니라 머리 모양·고글·안경·수염·후드로도 구분된다.
 */
export default function Portrait({ id, size = 96, dim = false, className = "" }: { id: PilotId; size?: number; dim?: boolean; className?: string }) {
  const uid = useId().replace(/:/g, "");
  const P = PILOTS[id];
  const L = P.look;
  const c = P.color;
  const hood = L.hairStyle === "hood";
  const hair = {
    swept: (
      <>
        <path d="M39 55 Q38 29 60 28 Q83 28 81 55 Q76 40 62 39 Q48 39 39 55Z" fill={`url(#hair-${uid})`} />
        <path d="M73 33 Q95 28 104 43 Q91 37 79 45Z" fill={`url(#hair-${uid})`} />
        <path d="M44 38 Q56 28 72 33 Q60 35 50 45Z" fill={`url(#hair-${uid})`} />
        <path d="M50 33 Q60 29 70 32" stroke="rgba(255,255,255,.35)" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      </>
    ),
    buzz: (
      <>
        <path d="M41 51 Q42 31 60 31 Q78 31 79 51 Q70 41 60 41 Q50 41 41 51Z" fill={`url(#hair-${uid})`} />
        <path d="M48 36 Q60 32 72 36" stroke="rgba(255,255,255,.18)" strokeWidth="1.4" fill="none" />
      </>
    ),
    pony: (
      <>
        <path d="M77 42 Q101 44 97 74 Q90 59 78 54Z" fill={`url(#hair-${uid})`} />
        <path d="M39 55 Q37 28 60 28 Q83 28 81 55 Q79 42 66 39 Q57 46 43 44 Q40 48 39 55Z" fill={`url(#hair-${uid})`} />
        <path d="M48 33 Q58 29 70 31" stroke="rgba(255,255,255,.35)" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        <circle cx="79" cy="45" r="2.6" fill={c} />
      </>
    ),
    spiky: (
      <>
        <path d="M37 55 L33 34 L46 39 L45 21 L56 32 L62 16 L67 32 L79 21 L78 38 L89 31 L83 55 Q74 41 60 41 Q46 41 37 55Z" fill={`url(#hair-${uid})`} />
        <path d="M56 32 L62 20 M67 32 L76 24" stroke="rgba(255,255,255,.5)" strokeWidth="1.2" />
      </>
    ),
    hood: null,
    mohawk: (
      <>
        <path d="M42 50 Q43 33 60 33 Q77 33 78 50 Q70 42 60 42 Q50 42 42 50Z" fill={L.hair} opacity=".3" />
        <path d="M53 41 Q54 13 60 8 Q66 13 67 41 Q60 36 53 41Z" fill={`url(#hair-${uid})`} />
        <path d="M58 14 Q59 26 58 36" stroke="rgba(255,255,255,.45)" strokeWidth="1.2" fill="none" />
      </>
    ),
  }[L.hairStyle];
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} role="img" aria-label={`${P.name} 초상화`} className={className} style={dim ? { filter: "grayscale(.85) brightness(.6)" } : undefined}>
      <defs>
        <radialGradient id={`bg-${uid}`} cx="40%" cy="30%" r="80%">
          <stop offset="0" stopColor={c} stopOpacity=".55" />
          <stop offset=".7" stopColor="#0f1a33" stopOpacity=".95" />
          <stop offset="1" stopColor="#0a1124" />
        </radialGradient>
        <radialGradient id={`skin-${uid}`} cx="38%" cy="35%" r="75%">
          <stop offset="0" stopColor={L.skin} />
          <stop offset=".75" stopColor={L.skin} />
          <stop offset="1" stopColor="#7a4b35" stopOpacity=".8" />
        </radialGradient>
        <linearGradient id={`hair-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={L.hair} stopOpacity=".85" />
          <stop offset=".5" stopColor={L.hair} />
          <stop offset="1" stopColor="#000" stopOpacity=".55" />
        </linearGradient>
        <linearGradient id={`jacket-${uid}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#000" stopOpacity=".5" />
          <stop offset=".35" stopColor={P.look.jacket} />
          <stop offset="1" stopColor="#000" stopOpacity=".55" />
        </linearGradient>
        <clipPath id={`clip-${uid}`}>
          <circle cx="60" cy="60" r="57" />
        </clipPath>
        <filter id={`glow-${uid}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <circle cx="60" cy="60" r="58" fill={`url(#bg-${uid})`} />
      <g clipPath={`url(#clip-${uid})`}>
        {/* 뒤 구름 */}
        <ellipse cx="22" cy="96" rx="30" ry="10" fill="#fff" opacity=".07" />
        <ellipse cx="100" cy="86" rx="26" ry="8" fill="#fff" opacity=".06" />
        {hood && <path d="M27 98 Q25 27 60 23 Q95 27 93 98Z" fill={`url(#hair-${uid})`} />}
        {/* 재킷 */}
        <path d="M10 124 Q15 92 44 86 L76 86 Q105 92 110 124Z" fill={`url(#jacket-${uid})`} />
        <path d="M44 86 L52 104 L60 96 L68 104 L76 86" fill="#000" opacity=".22" />
        <path d="M30 98 L40 96 L42 104 L32 106Z" fill={c} opacity=".9" />
        <circle cx="86" cy="101" r="4.5" fill="none" stroke={c} strokeWidth="1.6" />
        <rect x="53" y="73" width="14" height="15" fill={L.skin} />
        <rect x="53" y="80" width="14" height="8" fill="#000" opacity=".18" />
        {/* 얼굴 */}
        <ellipse cx="60" cy="56" rx="20.5" ry="23.5" fill={`url(#skin-${uid})`} />
        <ellipse cx="40" cy="58" rx="3.2" ry="5" fill={L.skin} />
        <ellipse cx="80" cy="58" rx="3.2" ry="5" fill={L.skin} />
        {L.beard && <path d="M40 62 Q42 85 60 85 Q78 85 80 62 Q73 73 60 73 Q47 73 40 62Z" fill={`url(#hair-${uid})`} />}
        {L.mask && <path d="M39 60 L81 60 Q79 82 60 83 Q41 82 39 60Z" fill="#11162a" />}
        {L.mask && <path d="M42 64 H78" stroke={c} strokeWidth=".8" opacity=".7" />}
        {/* 볼 홍조 */}
        {!L.mask && !L.beard && (
          <>
            <ellipse cx="48" cy="65" rx="4" ry="2.2" fill="#ff7a7a" opacity=".22" />
            <ellipse cx="72" cy="65" rx="4" ry="2.2" fill="#ff7a7a" opacity=".22" />
          </>
        )}
        {/* 눈 */}
        <g filter={L.mask ? `url(#glow-${uid})` : undefined}>
          <ellipse cx="52" cy="57" rx="2.8" ry="3.4" fill={L.eyes} />
          <ellipse cx="68" cy="57" rx="2.8" ry="3.4" fill={L.eyes} />
        </g>
        {!L.mask && (
          <>
            <circle cx="53" cy="56" r=".9" fill="#fff" />
            <circle cx="69" cy="56" r=".9" fill="#fff" />
          </>
        )}
        <path d="M46.5 50 L56 51.2 M64 51.2 L73.5 50" stroke={L.mask ? c : "#3a2418"} strokeWidth="1.7" strokeLinecap="round" opacity=".85" />
        {!L.mask && !L.beard && <path d="M55 70 Q60 73.5 65 70" stroke="#7a3b2a" strokeWidth="1.8" fill="none" strokeLinecap="round" />}
        {L.beard && <path d="M54 71 Q60 74 66 71" stroke="#2a1a12" strokeWidth="1.6" fill="none" />}
        <path d="M60 58 Q58 64 60.5 65" stroke="#000" strokeOpacity=".18" strokeWidth="1.2" fill="none" />
        {L.glasses && (
          <g fill="none" stroke="#2a1d10" strokeWidth="1.5">
            <circle cx="52" cy="57" r="6" />
            <circle cx="68" cy="57" r="6" />
            <path d="M58 57 H62" />
            <path d="M48 53 Q50 52 52 53" stroke="#fff" strokeOpacity=".6" strokeWidth=".9" />
          </g>
        )}
        {hair}
        {hood && <path d="M33 59 Q33 29 60 29 Q87 29 87 59 Q81 40 60 40 Q39 40 33 59Z" fill={`url(#hair-${uid})`} />}
        {hood && <path d="M36 52 Q40 34 60 32" stroke={c} strokeWidth="1" fill="none" opacity=".6" />}
        {L.goggles && (
          <g>
            <rect x="37" y="36.5" width="46" height="5.5" rx="2.5" fill="#23283a" />
            <circle cx="51" cy="40" r="7" fill="#23283a" />
            <circle cx="69" cy="40" r="7" fill="#23283a" />
            <circle cx="51" cy="40" r="5" fill={c} opacity=".9" />
            <circle cx="69" cy="40" r="5" fill={c} opacity=".9" />
            <path d="M47.5 38 Q49.5 36 52 36.5 M65.5 38 Q67.5 36 70 36.5" stroke="#fff" strokeWidth="1.3" fill="none" strokeLinecap="round" />
          </g>
        )}
        {L.scarf ? (
          <>
            <path d="M41 84 Q60 96 79 84 L81 93 Q60 105 39 93Z" fill={L.scarf} />
            <path d="M74 90 L106 99 L100 110 L70 97Z" fill={L.scarf} />
            <path d="M44 89 Q60 98 76 89" stroke="#9fb0d4" strokeWidth=".8" fill="none" />
          </>
        ) : (
          <path d="M45 86 L60 97 L75 86" stroke={c} strokeWidth="3" fill="none" />
        )}
      </g>
      <circle cx="60" cy="60" r="57" fill="none" stroke={c} strokeWidth="2.2" />
      <path d="M18 40 A46 46 0 0 1 60 14" stroke="#fff" strokeOpacity=".35" strokeWidth="1.5" fill="none" strokeLinecap="round" />
    </svg>
  );
}
