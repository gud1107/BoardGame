"use client";

import { useEffect, useState, type ReactNode } from "react";
import Overlay from "@/components/Overlay";
import { CARD_BACK_SKINS, DEFAULT_SKIN_ID, TABLE_SKINS, cardBackSkin, patternCss, tableSkin } from "@/lib/skins/catalog";
import { useMySkin } from "@/lib/skins/mySkin";
import SkinBackFace from "./SkinBackFace";

function Tile({ selected, onClick, label, children }: { selected: boolean; onClick: () => void; label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`flex min-h-11 flex-col items-center gap-1 rounded-xl border p-1.5 text-[11px] transition ${
        selected ? "border-amber-300 bg-amber-300/15 font-semibold text-amber-100 light:border-amber-500 light:bg-amber-50 light:text-amber-800" : "border-white/10 text-white/70 hover:border-white/30 light:border-slate-200 light:text-slate-600"
      }`}
    >
      {children}
      <span className="leading-tight">
        {selected && "✓ "}
        {label}
      </span>
    </button>
  );
}

/** 🎨 내 스킨: card back (my hand, seen by everyone) + table (the whole room's, when I'm the host). */
export function SkinPicker() {
  const skin = useMySkin((s) => s.skin);
  const set = useMySkin((s) => s.set);
  const init = useMySkin((s) => s.init);
  useEffect(() => {
    void init();
  }, [init]);

  return (
    <div className="flex flex-col gap-5">
      <section>
        <h3 className="text-sm font-bold text-white light:text-slate-900">🃏 카드 뒷면</h3>
        <p className="mt-0.5 text-xs text-white/50 light:text-slate-500">내 손패를 같은 방 사람들이 이 뒷면으로 봐요. 덱·버린 더미 같은 공용 카드는 게임 기본 뒷면 그대로예요.</p>
        <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">
          <Tile selected={skin.back === DEFAULT_SKIN_ID} onClick={() => set({ back: DEFAULT_SKIN_ID })} label="게임 기본">
            <div className="flex h-14 w-10 items-center justify-center rounded-lg border-2 border-dashed border-white/25 text-lg light:border-slate-300">🂠</div>
          </Tile>
          {CARD_BACK_SKINS.map((b) => (
            <Tile key={b.id} selected={skin.back === b.id} onClick={() => set({ back: b.id })} label={`${b.emoji} ${b.name}`}>
              <SkinBackFace skin={b} className="h-14 w-10" emblemClassName="text-lg" />
            </Tile>
          ))}
        </div>
      </section>
      <section>
        <h3 className="text-sm font-bold text-white light:text-slate-900">🎲 테이블 (3D)</h3>
        <p className="mt-0.5 text-xs text-white/50 light:text-slate-500">내가 방장인 방에서는 모두의 3D 테이블 천과 배경이 이 스킨으로 바뀌어요. 다른 사람 방에서는 방장의 테이블이 보여요.</p>
        <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">
          <Tile selected={skin.table === DEFAULT_SKIN_ID} onClick={() => set({ table: DEFAULT_SKIN_ID })} label="게임 기본">
            <div className="flex h-12 w-full items-center justify-center rounded-lg border-2 border-dashed border-white/25 text-lg light:border-slate-300">🪑</div>
          </Tile>
          {TABLE_SKINS.map((t) => (
            <Tile key={t.id} selected={skin.table === t.id} onClick={() => set({ table: t.id })} label={`${t.emoji} ${t.name}`}>
              <div className="flex h-12 w-full items-center justify-center rounded-lg p-1.5" style={{ background: t.background }}>
                <div className="h-full w-full rounded-full border-2" style={{ background: patternCss(t.pattern, [t.felt, t.feltAccent]), borderColor: t.inlay }} />
              </div>
            </Tile>
          ))}
        </div>
      </section>
    </div>
  );
}

/** Opens 🎨 내 스킨 — next to the 3D character button on every online game's room screen. */
export default function SkinButton() {
  const [open, setOpen] = useState(false);
  const skin = useMySkin((s) => s.skin);
  const init = useMySkin((s) => s.init);
  useEffect(() => {
    void init();
  }, [init]);
  const back = cardBackSkin(skin.back);
  const table = tableSkin(skin.table);
  const summary = [back && `${back.emoji} ${back.name}`, table && `${table.emoji} ${table.name}`].filter(Boolean).join(" · ");
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 self-start text-xs text-white/50 underline hover:text-white/80 light:text-slate-500 light:hover:text-slate-700"
      >
        🎨 {summary ? `내 스킨: ${summary}` : "카드 뒷면·테이블 스킨 고르기"}
      </button>
      {open && (
        <Overlay title="🎨 내 스킨" onClose={() => setOpen(false)} wide>
          <SkinPicker />
        </Overlay>
      )}
    </>
  );
}
