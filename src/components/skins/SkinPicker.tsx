"use client";

import { useEffect, useState, type ReactNode } from "react";
import Overlay from "@/components/Overlay";
import { CARD_BACK_SKINS, DEFAULT_SKIN_ID, PLATE_SKINS, TABLE_SKINS, cardBackSkin, patternCss, plateSkin, tableSkin, type PlateSkin, type SkinPattern } from "@/lib/skins/catalog";
import { useMySkin } from "@/lib/skins/mySkin";
import SkinBackFace from "./SkinBackFace";

const PATTERN_LABEL: Record<SkinPattern, string> = { diag: "사선 무늬", diamond: "다이아 무늬", dots: "물방울 무늬", waves: "물결 무늬", grid: "격자 무늬", plain: "단색" };

/** A pickable skin. The chosen one must be unmistakable: thick gold ring + glow, lifted, ✓ badge, "선택됨". */
function Tile({ selected, onClick, label, kind, children }: { selected: boolean; onClick: () => void; label: string; kind: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`relative flex min-h-11 flex-col items-center gap-1 rounded-xl p-1.5 pt-2 text-[11px] transition duration-200 ${
        selected
          ? "z-10 scale-105 border-2 border-amber-300 bg-amber-300/20 font-bold text-amber-50 shadow-[0_0_0_3px_rgba(252,211,77,0.35),0_0_20px_rgba(252,211,77,0.55)] light:border-amber-500 light:bg-amber-100 light:text-amber-900 light:shadow-[0_0_0_3px_rgba(245,158,11,0.3),0_0_16px_rgba(245,158,11,0.45)]"
          : "border border-white/10 text-white/70 opacity-80 hover:border-white/30 hover:opacity-100 light:border-slate-200 light:text-slate-600"
      }`}
    >
      {selected && (
        <span aria-hidden className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-amber-400 text-xs font-black text-slate-900 shadow light:border-white">
          ✓
        </span>
      )}
      {children}
      <span className="leading-tight break-keep">{label}</span>
      <span className={`text-[10px] leading-tight ${selected ? "text-amber-200 light:text-amber-700" : "text-white/40 light:text-slate-400"}`}>{selected ? "✓ 선택됨" : kind}</span>
    </button>
  );
}

/** The 3D name plate as CSS — same layers as `labelTexture` (seat-colour inner border, skin frame + emblems). */
function PlateFace({ plate, name, seatColor = "#fbbf24" }: { plate: PlateSkin | null; name: string; seatColor?: string }) {
  if (!plate)
    return (
      <div className="flex h-9 w-full min-w-0 items-center justify-center rounded-full border-[3px] bg-stone-950/80 px-3 text-xs font-bold text-amber-50" style={{ borderColor: seatColor }}>
        <span className="truncate">{name}</span>
      </div>
    );
  return (
    <div
      className="flex h-9 w-full min-w-0 items-center justify-between gap-1 rounded-full border-[3px] px-2 text-xs font-bold"
      style={{ borderColor: seatColor, boxShadow: `0 0 0 2px ${plate.accent}`, background: `linear-gradient(rgba(0,0,0,0.3),rgba(0,0,0,0.3)),${patternCss(plate.pattern, plate.colors)}`, color: plate.fg }}
    >
      <span style={{ color: plate.accent }}>{plate.emblem}</span>
      <span className="truncate">{name}</span>
      <span style={{ color: plate.accent }}>{plate.emblem}</span>
    </div>
  );
}

/** The current pick, big, so the choice reads at a glance before scrolling the lists. */
function CurrentPreview({ backId, tableId, plateId }: { backId: string; tableId: string; plateId: string }) {
  const back = cardBackSkin(backId);
  const table = tableSkin(tableId);
  const plate = plateSkin(plateId);
  return (
    <div className="flex flex-col gap-3 rounded-2xl border-2 border-amber-300/60 bg-amber-300/10 p-3 light:border-amber-400 light:bg-amber-50">
    <div className="flex items-center gap-4">
      {back ? (
        <SkinBackFace skin={back} className="h-24 w-16 shadow-lg" emblemClassName="text-3xl" />
      ) : (
        <div className="flex h-24 w-16 shrink-0 items-center justify-center rounded-lg border-2 border-dashed border-white/30 text-3xl light:border-slate-300">🂠</div>
      )}
      <div className="flex h-20 w-24 shrink-0 items-center justify-center rounded-xl p-2" style={{ background: table?.background ?? "#1f2937" }}>
        {table ? (
          <div className="h-full w-full rounded-full border-[3px]" style={{ background: patternCss(table.pattern, [table.felt, table.feltAccent]), borderColor: table.inlay }} />
        ) : (
          <span className="text-3xl">🪑</span>
        )}
      </div>
      <div className="min-w-0 break-keep text-xs text-white/70 light:text-slate-600">
        <p className="font-bold text-amber-200 light:text-amber-700">지금 내 스킨</p>
        <p className="mt-1">🃏 {back ? `${back.emoji} ${back.name}` : "게임 기본"}</p>
        <p>🎲 {table ? `${table.emoji} ${table.name}` : "게임 기본"}</p>
        <p>🏷️ {plate ? `${plate.emoji} ${plate.name}` : "기본 이름표"}</p>
      </div>
    </div>
    <div className="mx-auto w-full max-w-60">
      <PlateFace plate={plate} name="내 이름" />
    </div>
    </div>
  );
}

/** 🎨 내 스킨: card back + name plate (mine, seen by everyone) + table (the whole room's, when I'm the host). */
export function SkinPicker() {
  const skin = useMySkin((s) => s.skin);
  const set = useMySkin((s) => s.set);
  const init = useMySkin((s) => s.init);
  useEffect(() => {
    void init();
  }, [init]);

  return (
    <div className="flex flex-col gap-5">
      <CurrentPreview backId={skin.back} tableId={skin.table} plateId={skin.plate} />
      <section>
        <h3 className="text-sm font-bold text-white light:text-slate-900">🃏 카드 뒷면</h3>
        <p className="mt-0.5 text-xs text-white/50 light:text-slate-500">내 손패를 같은 방 사람들이 이 뒷면으로 봐요. 덱·버린 더미 같은 공용 카드는 게임 기본 뒷면 그대로예요.</p>
        <div className="mt-3 grid grid-cols-3 gap-2.5 sm:grid-cols-5">
          <Tile selected={skin.back === DEFAULT_SKIN_ID} onClick={() => set({ back: DEFAULT_SKIN_ID })} label="게임 기본" kind="게임마다 달라요">
            <div className="flex h-16 w-11 items-center justify-center rounded-lg border-2 border-dashed border-white/25 text-lg light:border-slate-300">🂠</div>
          </Tile>
          {CARD_BACK_SKINS.map((b) => (
            <Tile key={b.id} selected={skin.back === b.id} onClick={() => set({ back: b.id })} label={`${b.emoji} ${b.name}`} kind={`${PATTERN_LABEL[b.pattern]} · ${b.emblem}`}>
              <SkinBackFace skin={b} className="h-16 w-11" emblemClassName="text-xl" />
            </Tile>
          ))}
        </div>
      </section>
      <section>
        <h3 className="text-sm font-bold text-white light:text-slate-900">🎲 테이블 (3D)</h3>
        <p className="mt-0.5 text-xs text-white/50 light:text-slate-500">내가 방장인 방에서는 모두의 3D 테이블 천과 배경이 이 스킨으로 바뀌어요. 다른 사람 방에서는 방장의 테이블이 보여요.</p>
        <div className="mt-3 grid grid-cols-3 gap-2.5 sm:grid-cols-5">
          <Tile selected={skin.table === DEFAULT_SKIN_ID} onClick={() => set({ table: DEFAULT_SKIN_ID })} label="게임 기본" kind="게임마다 달라요">
            <div className="flex h-12 w-full items-center justify-center rounded-lg border-2 border-dashed border-white/25 text-lg light:border-slate-300">🪑</div>
          </Tile>
          {TABLE_SKINS.map((t) => (
            <Tile key={t.id} selected={skin.table === t.id} onClick={() => set({ table: t.id })} label={`${t.emoji} ${t.name}`} kind={PATTERN_LABEL[t.pattern]}>
              <div className="flex h-12 w-full items-center justify-center rounded-lg p-1.5" style={{ background: t.background }}>
                <div className="h-full w-full rounded-full border-2" style={{ background: patternCss(t.pattern, [t.felt, t.feltAccent]), borderColor: t.inlay }} />
              </div>
            </Tile>
          ))}
        </div>
      </section>
      <section>
        <h3 className="text-sm font-bold text-white light:text-slate-900">🏷️ 3D 이름표</h3>
        <p className="mt-0.5 text-xs text-white/50 light:text-slate-500">3D 테이블에서 내 머리 위 이름표를 모두가 이 스킨으로 봐요. 안쪽 테두리는 자리 색 그대로라 누구 자리인지 헷갈리지 않아요.</p>
        <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          <Tile selected={skin.plate === DEFAULT_SKIN_ID} onClick={() => set({ plate: DEFAULT_SKIN_ID })} label="기본 이름표" kind="어두운 기본형">
            <PlateFace plate={null} name="이름" />
          </Tile>
          {PLATE_SKINS.map((pl) => (
            <Tile key={pl.id} selected={skin.plate === pl.id} onClick={() => set({ plate: pl.id })} label={`${pl.emoji} ${pl.name}`} kind={`${PATTERN_LABEL[pl.pattern]} · ${pl.emblem}`}>
              <PlateFace plate={pl} name="이름" />
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
  const plate = plateSkin(skin.plate);
  // emoji only — three names wouldn't fit one line on a 360px phone
  const summary = [back, table, plate].map((x) => x?.emoji ?? "").join("");
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 self-start text-xs text-white/50 underline hover:text-white/80 light:text-slate-500 light:hover:text-slate-700"
      >
        🎨 {summary ? `내 스킨 ${summary} 바꾸기` : "카드 뒷면·테이블·이름표 스킨 고르기"}
      </button>
      {open && (
        <Overlay title="🎨 내 스킨" onClose={() => setOpen(false)} wide>
          <SkinPicker />
        </Overlay>
      )}
    </>
  );
}
