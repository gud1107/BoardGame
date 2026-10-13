"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import UnitCard, { type CardUnit } from "./UnitCard";
import { unitDef } from "./units";

/**
 * 3장 합성 연출 — 같은 유닛 3장이 양옆·가운데에서 빨려 들어와 부딪히고(0~0.7초),
 * 번쩍임 + 충격파 + 회전하는 금빛 광선 + 불꽃 파편 속에서 황금 유닛이 튀어나온다(0.7초~).
 * 전체 2.6초, 화면을 막지 않는다(pointer-events-none). document.body 포털이라 3D/2D 어디서든 위에 뜬다.
 * 파편 배치는 결정적(Math.random 없음).
 */

export const GOLDEN_MERGE_MS = 2600;

const SPARKS = Array.from({ length: 28 }, (_, i) => {
  const a = (i / 28) * Math.PI * 2 + (i % 2 ? 0.11 : 0);
  const r = 150 + ((i * 37) % 5) * 28;
  return { dx: Math.cos(a) * r, dy: Math.sin(a) * r, delay: (i % 4) * 0.03, size: 6 + ((i * 13) % 3) * 3 };
});

const CSS = `
@keyframes gm-dim { 0%{opacity:0} 10%{opacity:1} 85%{opacity:1} 100%{opacity:0} }
@keyframes gm-in-l { 0%{transform:translate(-190px,0) rotate(-14deg) scale(.9); opacity:0} 15%{opacity:1} 70%{transform:translate(-150px,0) rotate(-8deg)} 100%{transform:translate(0,0) rotate(0) scale(.8); opacity:1} }
@keyframes gm-in-r { 0%{transform:translate(190px,0) rotate(14deg) scale(.9); opacity:0} 15%{opacity:1} 70%{transform:translate(150px,0) rotate(8deg)} 100%{transform:translate(0,0) rotate(0) scale(.8); opacity:1} }
@keyframes gm-in-c { 0%{transform:translate(0,-160px) scale(.9); opacity:0} 15%{opacity:1} 70%{transform:translate(0,-120px)} 100%{transform:translate(0,0) scale(.8); opacity:1} }
@keyframes gm-shake { 0%,100%{margin-left:0} 25%{margin-left:-3px} 75%{margin-left:3px} }
@keyframes gm-flash { 0%{opacity:0} 8%{opacity:.95} 100%{opacity:0} }
@keyframes gm-ring { 0%{width:20px;height:20px;opacity:1;border-width:10px} 100%{width:520px;height:520px;opacity:0;border-width:1px} }
@keyframes gm-rays { 0%{opacity:0; transform:translate(-50%,-50%) rotate(0) scale(.4)} 15%{opacity:.9} 80%{opacity:.75} 100%{opacity:0; transform:translate(-50%,-50%) rotate(140deg) scale(1.15)} }
@keyframes gm-spark { 0%{opacity:1; transform:translate(-50%,-50%) scale(1.4)} 100%{opacity:0; transform:translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(.2)} }
@keyframes gm-pop { 0%{opacity:0; transform:scale(.2) rotate(-20deg)} 55%{opacity:1; transform:scale(1.35) rotate(4deg)} 75%{transform:scale(.95) rotate(-1deg)} 100%{opacity:1; transform:scale(1.15) rotate(0)} }
@keyframes gm-float { 0%,100%{translate:0 0} 50%{translate:0 -6px} }
@keyframes gm-title { 0%{opacity:0; transform:scale(2.4); letter-spacing:.5em} 60%{opacity:1; transform:scale(.95); letter-spacing:.08em} 100%{opacity:1; transform:scale(1); letter-spacing:.08em} }
@keyframes gm-sheen { 0%{background-position:-150% 0} 100%{background-position:250% 0} }
@keyframes gm-hide { to { visibility: hidden } }
@keyframes gm-out { 0%,85%{opacity:1} 100%{opacity:0} }
.gm-root { animation: gm-out ${GOLDEN_MERGE_MS}ms ease-in forwards; }
.gm-sheen { background: linear-gradient(100deg, transparent 30%, rgba(255,255,255,.85) 50%, transparent 70%); background-size: 200% 100%; animation: gm-sheen 1.1s ease-in-out .9s 2; mix-blend-mode: overlay; }
@media (prefers-reduced-motion: reduce) {
  .gm-root *, .gm-root { animation-duration: 1ms !important; animation-delay: 0ms !important; }
}
`;

function Spot({ children }: { children: React.ReactNode }) {
  return <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">{children}</div>;
}

export default function GoldenMergeFX({ unit, onDone }: { unit: CardUnit; onDone: () => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t0 = window.setTimeout(() => setMounted(true), 0);
    const t1 = window.setTimeout(onDone, GOLDEN_MERGE_MS);
    return () => {
      window.clearTimeout(t0);
      window.clearTimeout(t1);
    };
  }, [onDone]);
  if (!mounted) return null;
  const d = unitDef(unit.defId);
  const normal: CardUnit = { defId: unit.defId, atk: d.atk, hp: d.hp, golden: false, kw: [...d.keywords] };
  const IMPACT = 0.7;

  return createPortal(
    <div className="gm-root pointer-events-none fixed inset-0 z-[90] overflow-hidden" aria-live="polite">
      <style>{CSS}</style>
      {/* 어두운 배경 + 금빛 중심광 */}
      <div className="absolute inset-0" style={{ background: "radial-gradient(circle at 50% 50%, rgba(250,204,21,.28), rgba(0,0,0,.72) 60%)", animation: `gm-dim ${GOLDEN_MERGE_MS}ms ease forwards` }} />

      {/* 1) 같은 카드 3장이 빨려 들어온다 */}
      {(["l", "c", "r"] as const).map((k) => (
        <Spot key={k}>
          <div style={{ animation: `gm-in-${k} ${IMPACT}s cubic-bezier(.6,0,.9,.4) forwards, gm-shake .08s linear ${IMPACT * 0.6}s 4, gm-hide 1ms linear ${IMPACT}s forwards` }}>
            <UnitCard unit={normal} size="lg" />
          </div>
        </Spot>
      ))}

      {/* 2) 충돌: 번쩍임 · 충격파 · 광선 · 파편 */}
      <div className="absolute inset-0 bg-white" style={{ opacity: 0, animation: `gm-flash .55s ease-out ${IMPACT}s forwards` }} />
      {[0, 0.12, 0.26].map((delay, i) => (
        <span
          key={i}
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-yellow-200"
          style={{ opacity: 0, animation: `gm-ring .8s ease-out ${IMPACT + delay}s forwards`, boxShadow: "0 0 30px rgba(250,204,21,.8)" }}
        />
      ))}
      <span
        className="absolute left-1/2 top-1/2 h-[640px] w-[640px] rounded-full"
        style={{
          opacity: 0,
          background: "repeating-conic-gradient(from 0deg, rgba(253,224,71,.55) 0deg 7deg, transparent 7deg 22deg)",
          maskImage: "radial-gradient(circle, black 15%, transparent 68%)",
          WebkitMaskImage: "radial-gradient(circle, black 15%, transparent 68%)",
          animation: `gm-rays ${(GOLDEN_MERGE_MS / 1000 - IMPACT).toFixed(2)}s linear ${IMPACT}s forwards`,
        }}
      />
      {SPARKS.map((s, i) => (
        <span
          key={i}
          className="absolute left-1/2 top-1/2 rounded-full"
          style={
            {
              width: s.size,
              height: s.size,
              opacity: 0,
              background: i % 3 ? "#fde047" : "#fff7cc",
              boxShadow: "0 0 10px #facc15",
              "--dx": `${s.dx}px`,
              "--dy": `${s.dy}px`,
              animation: `gm-spark .9s cubic-bezier(.1,.7,.3,1) ${IMPACT + s.delay}s forwards`,
            } as React.CSSProperties
          }
        />
      ))}

      {/* 3) 황금 유닛 등장 */}
      <Spot>
        <div className="flex flex-col items-center gap-3">
          <div style={{ opacity: 0, animation: `gm-pop .6s cubic-bezier(.2,1.4,.4,1) ${IMPACT + 0.05}s forwards` }}>
            <div className="relative" style={{ animation: `gm-float 1.2s ease-in-out ${IMPACT + 0.7}s infinite` }}>
              <div className="rounded-2xl shadow-[0_0_40px_12px_rgba(250,204,21,.65)]">
                <UnitCard unit={unit} size="lg" />
              </div>
              <span className="gm-sheen absolute inset-0 rounded-2xl" />
            </div>
          </div>
        </div>
      </Spot>
      <div className="absolute inset-x-0 top-[calc(50%+7.5rem)] flex flex-col items-center gap-1 text-center">
        <p
          className="bg-gradient-to-b from-yellow-100 via-yellow-300 to-amber-600 bg-clip-text text-3xl font-black text-transparent drop-shadow-[0_3px_0_rgba(0,0,0,.6)] sm:text-4xl"
          style={{ opacity: 0, animation: `gm-title .55s cubic-bezier(.2,1.2,.4,1) ${IMPACT + 0.2}s forwards` }}
        >
          ✨ 황금 합성! ✨
        </p>
        <p className="text-sm font-bold text-yellow-50 drop-shadow" style={{ opacity: 0, animation: `gm-title .4s ease-out ${IMPACT + 0.45}s forwards` }}>
          {d.emoji} 황금 {d.name} · 스탯·효과 2배
        </p>
        <p className="text-[11px] text-white/75" style={{ opacity: 0, animation: `gm-title .4s ease-out ${IMPACT + 0.6}s forwards` }}>
          보드에 내면 🔍 발견 — 한 등급 위 유닛 1장을 골라요
        </p>
      </div>
    </div>,
    document.body,
  );
}
