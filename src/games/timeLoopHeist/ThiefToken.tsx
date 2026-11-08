/**
 * 2D 격자용 도둑 토큰 — 좌석 색 비니 · 검은 도미노 가면 · 줄무늬 목깃의 캣버글러 얼굴.
 * 좌석은 색과 함께 격자 옆 표식(▲●■◆)으로도 구분된다. 유령은 반투명 + 점선 테두리,
 * 지금 녹화 중인 나는 노란 고리, 들킨 자아는 빨간 경고, 보석을 들면 오른쪽 위에 💎.
 */
export function ThiefToken({ color, ghost, live, caught, carrying }: { color: string; ghost: boolean; live: boolean; caught: boolean; carrying: boolean }) {
  const cap = caught ? "#ef4444" : color;
  return (
    <svg viewBox="0 0 40 40" className="h-full w-full overflow-visible" style={{ opacity: ghost ? 0.62 : 1 }} aria-hidden>
      {live && <circle cx="20" cy="21" r="19" fill="none" stroke="#fde047" strokeWidth="2.6" />}
      {ghost && <circle cx="20" cy="21" r="18" fill="none" stroke={color} strokeWidth="1.4" strokeDasharray="3 2.4" />}
      {/* 목깃(줄무늬 스웨터) */}
      <path d="M8 36 Q20 28 32 36 L32 40 L8 40 Z" fill="#111827" />
      <path d="M10 36.4 Q20 30.4 30 36.4" fill="none" stroke={cap} strokeWidth="1.6" />
      {/* 얼굴 */}
      <ellipse cx="20" cy="22" rx="10.5" ry="11" fill="#f3d2b3" />
      {/* 비니 */}
      <path d="M8.6 19 Q9 7 20 7 Q31 7 31.4 19 Z" fill={cap} />
      <rect x="8" y="16.6" width="24" height="4" rx="2" fill={cap} />
      <rect x="8" y="16.6" width="24" height="4" rx="2" fill="#000" opacity="0.22" />
      <circle cx="20" cy="6.4" r="2.6" fill={cap} />
      {/* 도미노 가면 */}
      <path d="M8.8 23.4 Q9.6 20.6 14 20.8 L20 22 L26 20.8 Q30.4 20.6 31.2 23.4 Q30.6 27.6 26 27 Q22.6 26.6 20 25.2 Q17.4 26.6 14 27 Q9.4 27.6 8.8 23.4 Z" fill="#0b0f1a" />
      <ellipse cx="15" cy="23.8" rx="2.4" ry="1.6" fill="#fff" />
      <ellipse cx="25" cy="23.8" rx="2.4" ry="1.6" fill="#fff" />
      <circle cx="15.6" cy="23.9" r="1" fill="#0b0f1a" />
      <circle cx="25.6" cy="23.9" r="1" fill="#0b0f1a" />
      {/* 살짝 웃는 입 */}
      <path d="M17.2 29.6 Q20 31.4 22.8 29.6" fill="none" stroke="#7c4a32" strokeWidth="1.1" strokeLinecap="round" />
      {caught && (
        <g>
          <circle cx="33" cy="8" r="5.5" fill="#ef4444" stroke="#fff" strokeWidth="1" />
          <text x="33" y="11" textAnchor="middle" fontSize="8.5" fontWeight="800" fill="#fff">
            !
          </text>
        </g>
      )}
      {carrying && !caught && <path d="M33 2.5 L37.5 7.5 L33 13.5 L28.5 7.5 Z" fill="#67e8f9" stroke="#0e7490" strokeWidth="0.9" />}
    </svg>
  );
}
