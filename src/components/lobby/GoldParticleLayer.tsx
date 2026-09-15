import type { CSSProperties } from "react";
import type { GoldParticle } from "./useGoldClickBurst";

/** `useGoldClickBurst`가 만든 파티클을 그리는 순수 렌더 레이어 — 부모가 `relative overflow-hidden`이어야 한다. */
export default function GoldParticleLayer({ particles }: { particles: GoldParticle[] }) {
  if (particles.length === 0) return null;
  return (
    <>
      {particles.map((p) => (
        <span
          key={p.id}
          className="lobby-card-gold-particle pointer-events-none absolute z-20 h-1.5 w-1.5 rounded-full bg-gradient-to-r from-amber-300 to-yellow-100"
          style={
            {
              left: p.x,
              top: p.y,
              boxShadow: "0 0 12px 2px rgba(251, 191, 36, 0.9)",
              "--angle": `${p.angle}deg`,
              "--distance": `${p.distance}px`,
            } as CSSProperties
          }
        />
      ))}
    </>
  );
}
