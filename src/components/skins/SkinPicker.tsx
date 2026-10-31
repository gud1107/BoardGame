"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import Overlay from "@/components/Overlay";
import {
  CARD_BACK_SKINS,
  DEFAULT_SKIN_ID,
  PLATE_SKINS,
  PROP_SKINS,
  SKIN_SETS,
  TABLE_SKINS,
  cardBackSkin,
  patternCss,
  plateSkin,
  propSkin,
  tableSkin,
  type PlateSkin,
  type PropSkin,
  type SkinParticles,
  type SkinPattern,
  type TableSkin,
  type UnlockId,
} from "@/lib/skins/catalog";
import { useMySkin } from "@/lib/skins/mySkin";
import { TIERS, TIER_ORDER, TRACKS, UNLOCKS, isUnlocked, tierBg, tierBorder, tierText, tierVars, type RewardTier, useSkinProgress, type SkinProgress } from "@/lib/skins/unlocks";
import SkinBackFace from "./SkinBackFace";

const PATTERN_LABEL: Record<SkinPattern, string> = { diag: "사선 무늬", diamond: "다이아 무늬", dots: "물방울 무늬", waves: "물결 무늬", grid: "격자 무늬", plain: "단색" };
const PARTICLE_LABEL: Record<SkinParticles, string> = { petals: "🌸 꽃잎", stars: "✨ 별빛", snow: "❄️ 눈", bubbles: "🫧 거품", embers: "🔥 불씨", sparkles: "💫 반짝이" };

/**
 * A pickable skin. The chosen one must be unmistakable: thick gold ring + glow, lifted, ✓ badge,
 * "선택됨". A reward skin not earned yet is greyed with a 🔒, its goal and a progress bar.
 */
function Tile({
  selected,
  onClick,
  label,
  kind,
  lock,
  reward,
  onLocked,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  kind: string;
  lock?: { label: string; value: number; goal: number } | null;
  /** Reward skin: its tier badge shows whether it's earned yet or not. */
  reward?: UnlockId;
  /** Tapping a locked tile explains how to earn it instead of doing nothing. */
  onLocked?: () => void;
  children: ReactNode;
}) {
  const locked = !!lock;
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={locked ? onLocked : onClick}
      title={locked ? `🔒 ${lock.label} (${lock.value}/${lock.goal})` : undefined}
      className={`relative flex min-h-11 flex-col items-center gap-0.5 rounded-lg p-1 pt-2 text-[11px] transition duration-200 ${
        selected
          ? "z-10 scale-105 border-2 border-amber-300 bg-amber-300/20 font-bold text-amber-50 shadow-[0_0_0_3px_rgba(252,211,77,0.35),0_0_20px_rgba(252,211,77,0.55)] light:border-amber-500 light:bg-amber-100 light:text-amber-900 light:shadow-[0_0_0_3px_rgba(245,158,11,0.3),0_0_16px_rgba(245,158,11,0.45)]"
          : locked
            ? "cursor-help border border-dashed border-white/15 text-white/50 light:border-slate-300 light:text-slate-500"
            : "border border-white/10 text-white/70 opacity-80 hover:border-white/30 hover:opacity-100 light:border-slate-200 light:text-slate-600"
      }`}
    >
      {reward && (
        <span
          className={`absolute -top-2 -left-1.5 rounded-full border bg-stone-950 px-1.5 text-[9px] leading-4 font-bold whitespace-nowrap light:bg-white ${tierBorder} ${tierText}`}
          style={tierVars(UNLOCKS[reward].tier)}
        >
          {TIERS[UNLOCKS[reward].tier].emoji} {TIERS[UNLOCKS[reward].tier].label}
        </span>
      )}
      {selected && (
        <span aria-hidden className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-amber-400 text-xs font-black text-slate-900 shadow light:border-white">
          ✓
        </span>
      )}
      <div className={`flex w-full justify-center ${locked ? "opacity-40 grayscale" : ""}`}>{children}</div>
      {locked && (
        <span aria-hidden className="absolute top-1/3 left-1/2 -translate-x-1/2 text-2xl drop-shadow">
          🔒
        </span>
      )}
      <span className="leading-tight break-keep">{label}</span>
      {locked ? (
        <span className="w-full text-[10px] leading-tight break-keep text-amber-200/80 light:text-amber-700">
          {lock.label}
          <span className="mt-0.5 block h-1 w-full overflow-hidden rounded-full bg-white/10 light:bg-slate-200">
            <span className="block h-full rounded-full bg-amber-400" style={{ width: `${Math.min(100, (lock.value / lock.goal) * 100)}%` }} />
          </span>
          <span className="tabular-nums">
            {Math.min(lock.value, lock.goal)}/{lock.goal}
          </span>
        </span>
      ) : (
        <span className={`text-[10px] leading-tight break-keep ${selected ? "text-amber-200 light:text-amber-700" : "text-white/40 light:text-slate-400"}`}>{selected ? "✓ 선택됨" : kind}</span>
      )}
    </button>
  );
}

/** Free skins first, then rewards from 🥉 to 👑 and, within a tier, the nearer goal first. */
function byReward<T extends { unlock?: UnlockId }>(list: readonly T[]): T[] {
  const key = (s: T) => (s.unlock ? [1 + TIER_ORDER.indexOf(UNLOCKS[s.unlock].tier), UNLOCKS[s.unlock].goal] : [0, 0]);
  return [...list].sort((a, b) => key(a)[0] - key(b)[0] || key(a)[1] - key(b)[1]);
}

function lockOf(id: UnlockId | undefined, p: SkinProgress) {
  if (!id || isUnlocked(id, p)) return null;
  const u = UNLOCKS[id];
  return { label: u.label, value: p[u.of], goal: u.goal };
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

function TableFace({ table, className = "h-12" }: { table: TableSkin | null; className?: string }) {
  if (!table)
    return <div className={`flex w-full items-center justify-center rounded-lg border-2 border-dashed border-white/25 text-lg light:border-slate-300 ${className}`}>🪑</div>;
  return (
    <div className={`flex w-full items-center justify-center rounded-lg p-1.5 ${className}`} style={{ background: `radial-gradient(circle at 50% 0%, ${table.lamp}55, transparent 70%), ${table.background}` }}>
      <div className="h-full w-full rounded-full border-2" style={{ background: patternCss(table.pattern, [table.felt, table.feltAccent]), borderColor: table.inlay }} />
    </div>
  );
}

/** A cup with a few coins beside it, in the prop skin's colours. */
function PropFace({ prop }: { prop: PropSkin | null }) {
  const cup = prop?.cup ?? "#6b3a1f";
  const ring = prop?.ring ?? "#e9b949";
  const coin = prop?.coin ?? "#f2c14e";
  const edge = prop?.coinEdge ?? "#a8801e";
  return (
    <div className="flex h-14 items-end justify-center gap-1.5">
      <div className="relative h-12 w-9 rounded-t-md rounded-b-xl" style={{ background: `linear-gradient(90deg, ${cup}, ${cup}cc 60%, ${cup})` }}>
        <div className="absolute inset-x-0 top-2 h-1.5" style={{ background: ring }} />
        <div className="absolute inset-x-0 top-5 h-1 bg-white/40" />
      </div>
      <div className="flex flex-col-reverse">
        {[0, 1, 2].map((i) => (
          <div key={i} className="-mt-1 h-2.5 w-6 rounded-full border" style={{ background: coin, borderColor: edge }} />
        ))}
      </div>
    </div>
  );
}

/** The current pick, big, so the choice reads at a glance before scrolling the lists. */
function CurrentPreview({ backId, tableId, plateId, propId }: { backId: string; tableId: string; plateId: string; propId: string }) {
  const back = cardBackSkin(backId);
  const table = tableSkin(tableId);
  const plate = plateSkin(plateId);
  const prop = propSkin(propId);
  return (
    <div className="flex flex-col gap-3 rounded-2xl border-2 border-amber-300/60 bg-amber-300/10 p-3 light:border-amber-400 light:bg-amber-50">
      <div className="flex items-center gap-3">
        {back ? (
          <SkinBackFace skin={back} className="h-24 w-16 shadow-lg" emblemClassName="text-3xl" />
        ) : (
          <div className="flex h-24 w-16 shrink-0 items-center justify-center rounded-lg border-2 border-dashed border-white/30 text-3xl light:border-slate-300">🂠</div>
        )}
        <div className="w-24 shrink-0">
          <TableFace table={table} className="h-20" />
        </div>
        <div className="min-w-0 break-keep text-xs text-white/70 light:text-slate-600">
          <p className="font-bold text-amber-200 light:text-amber-700">지금 내 스킨</p>
          <p className="mt-1">🃏 {back ? `${back.emoji} ${back.name}` : "게임 기본"}</p>
          <p>🎲 {table ? `${table.emoji} ${table.name}` : "게임 기본"}</p>
          <p>🏷️ {plate ? `${plate.emoji} ${plate.name}` : "기본 이름표"}</p>
          <p>🏺 {prop ? `${prop.emoji} ${prop.name}` : "게임 기본"}</p>
        </div>
      </div>
      <div className="mx-auto w-full max-w-60">
        <PlateFace plate={plate} name="내 이름" />
      </div>
    </div>
  );
}

function Section({ title, hint, cols = "grid-cols-4 sm:grid-cols-6 lg:grid-cols-8", children }: { title: string; hint: string; cols?: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="text-sm font-bold text-white light:text-slate-900">{title}</h3>
      <p className="mt-0.5 text-xs break-keep text-white/50 light:text-slate-500">{hint}</p>
      <div className={`mt-2 grid gap-1.5 ${cols}`}>{children}</div>
    </section>
  );
}

type ViewFilter = "all" | "owned" | "locked";
type TierFilter = "any" | "free" | RewardTier;
const FILTER_KEY = "bg_skin_filter_v1";

function readFilter(): { view: ViewFilter; tier: TierFilter } {
  try {
    const raw = JSON.parse(localStorage.getItem(FILTER_KEY) ?? "null") as { view?: string; tier?: string } | null;
    const view = (["all", "owned", "locked"] as const).find((v) => v === raw?.view) ?? "all";
    const tier = (["any", "free", ...TIER_ORDER] as const).find((t) => t === raw?.tier) ?? "any";
    return { view, tier };
  } catch {
    return { view: "all", tier: "any" };
  }
}

function Chip({ on, onClick, children, style, className = "" }: { on: boolean; onClick: () => void; children: ReactNode; style?: CSSProperties; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      style={style}
      className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-bold whitespace-nowrap transition ${
        on ? "border-amber-300 bg-amber-300/25 text-amber-50 light:border-amber-500 light:bg-amber-100 light:text-amber-900" : `border-white/15 text-white/60 hover:text-white light:border-slate-300 light:text-slate-500 ${className}`
      }`}
    >
      {children}
    </button>
  );
}

/** What a locked reward needs, pinned to the bottom of the picker after tapping its tile. */
function UnlockHint({ name, unlock, progress, onClose }: { name: string; unlock: UnlockId; progress: SkinProgress; onClose: () => void }) {
  const u = UNLOCKS[unlock];
  const tier = TIERS[u.tier];
  const value = Math.min(progress[u.of], u.goal);
  const left = u.goal - value;
  return (
    <div role="status" className="sticky bottom-0 z-20 -mx-1 flex flex-col gap-1.5 rounded-xl border-2 border-amber-300/70 bg-stone-950/95 p-3 text-xs shadow-2xl backdrop-blur light:border-amber-400 light:bg-white/95">
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold text-white light:text-slate-900">🔒 {name}</span>
        <span className={`rounded-full border px-1.5 text-[10px] leading-4 font-bold ${tierBorder} ${tierText}`} style={tierVars(u.tier)}>
          {tier.emoji} {tier.label}
        </span>
        <button type="button" onClick={onClose} aria-label="닫기" className="ml-auto rounded-full px-2 text-base text-white/60 hover:text-white light:text-slate-500">
          ✕
        </button>
      </div>
      <p className="font-semibold break-keep text-amber-200 light:text-amber-800">
        {TRACKS[u.of].emoji} {u.label} — 지금 {value}/{u.goal}, {left}만 더 하면 열려요
      </p>
      <span className="block h-1.5 w-full overflow-hidden rounded-full bg-white/10 light:bg-slate-200">
        <span className={`block h-full rounded-full ${tierBg}`} style={{ ...tierVars(u.tier), width: `${(value / u.goal) * 100}%` }} />
      </span>
      <p className="break-keep text-white/60 light:text-slate-500">{TRACKS[u.of].how}</p>
    </div>
  );
}

/** 🎨 내 스킨: sets, card back, table (room theme), 3D name plate, props — reward skins unlock from /stats. */
export function SkinPicker() {
  const skin = useMySkin((s) => s.skin);
  const set = useMySkin((s) => s.set);
  const init = useMySkin((s) => s.init);
  const progress = useSkinProgress();
  const [filter, setFilterState] = useState(readFilter);
  const [hint, setHint] = useState<{ name: string; unlock: UnlockId } | null>(null);
  useEffect(() => {
    void init();
  }, [init]);

  const setFilter = (f: Partial<typeof filter>) => {
    const next = { ...filter, ...f };
    setFilterState(next);
    try {
      localStorage.setItem(FILTER_KEY, JSON.stringify(next));
    } catch {
      // the choice just lasts this window
    }
  };
  const shows = (unlock: UnlockId | undefined) => {
    const owned = isUnlocked(unlock, progress);
    if (filter.view === "owned" && !owned) return false;
    if (filter.view === "locked" && owned) return false;
    if (filter.tier === "free") return !unlock;
    if (filter.tier !== "any") return !!unlock && UNLOCKS[unlock].tier === filter.tier;
    return true;
  };
  // "게임 기본", sets and props are free and always yours
  const showFree = shows(undefined);
  const backs = byReward(CARD_BACK_SKINS).filter((b) => shows(b.unlock));
  const tables = byReward(TABLE_SKINS).filter((t) => shows(t.unlock));
  const plates = byReward(PLATE_SKINS).filter((pl) => shows(pl.unlock));
  const rewards = [...CARD_BACK_SKINS, ...TABLE_SKINS, ...PLATE_SKINS];
  const tierCount = (t: RewardTier) => {
    const list = rewards.filter((x) => x.unlock && UNLOCKS[x.unlock].tier === t);
    return `${list.filter((x) => isUnlocked(x.unlock, progress)).length}/${list.length}`;
  };
  const shown = backs.length + tables.length + plates.length + (showFree ? PROP_SKINS.length : 0);

  return (
    <div className="flex flex-col gap-5">
      <CurrentPreview backId={skin.back} tableId={skin.table} plateId={skin.plate} propId={skin.prop} />
      <div className="sticky -top-4 z-20 -mx-1 flex flex-col gap-1.5 rounded-xl border border-white/10 bg-stone-950/95 p-2 backdrop-blur light:border-slate-200 light:bg-white/95">
        <div className="flex gap-1 overflow-x-auto">
          <Chip on={filter.view === "all"} onClick={() => setFilter({ view: "all" })}>
            전체
          </Chip>
          <Chip on={filter.view === "owned"} onClick={() => setFilter({ view: "owned" })}>
            ✅ 쓸 수 있는 것
          </Chip>
          <Chip on={filter.view === "locked"} onClick={() => setFilter({ view: "locked" })}>
            🔒 잠긴 것
          </Chip>
          <span className="ml-auto shrink-0 self-center pl-2 text-[11px] text-white/45 tabular-nums light:text-slate-500">{shown}종</span>
        </div>
        <div className="flex gap-1 overflow-x-auto">
          <Chip on={filter.tier === "any"} onClick={() => setFilter({ tier: "any" })}>
            모든 등급
          </Chip>
          <Chip on={filter.tier === "free"} onClick={() => setFilter({ tier: "free" })}>
            무료
          </Chip>
          {TIER_ORDER.map((t) => (
            <Chip key={t} on={filter.tier === t} onClick={() => setFilter({ tier: t })} style={tierVars(t)} className={tierText}>
              {TIERS[t].emoji} {TIERS[t].label} <span className="font-normal tabular-nums opacity-70">{tierCount(t)}</span>
            </Chip>
          ))}
        </div>
      </div>
      {shown === 0 && <p className="py-6 text-center text-xs text-white/50 light:text-slate-500">이 조건에 맞는 스킨이 없어요. 다른 필터를 골라 보세요.</p>}
      {showFree && (
      <Section title="✨ 세트로 한 번에" hint="카드 뒷면·테이블·이름표·소품을 어울리는 조합으로 한 번에 바꿔요. 고른 뒤에 하나씩 바꿔도 돼요." cols="grid-cols-3">
        {SKIN_SETS.map((st) => {
          const on = skin.table === st.table && skin.back === st.back && skin.plate === st.plate && skin.prop === st.prop;
          const b = cardBackSkin(st.back);
          return (
            <Tile key={st.id} selected={on} onClick={() => set({ table: st.table, back: st.back, plate: st.plate, prop: st.prop })} label={`${st.emoji} ${st.name}`} kind="4종 세트">
              <div className="flex items-center gap-1">
                {b && <SkinBackFace skin={b} className="h-12 w-8" emblemClassName="text-sm" />}
                <div className="w-12">
                  <TableFace table={tableSkin(st.table)} className="h-10" />
                </div>
              </div>
            </Tile>
          );
        })}
      </Section>
      )}
      {(showFree || backs.length > 0) && (
      <Section title={`🃏 카드 뒷면 · ${backs.length + (showFree ? 1 : 0)}`} hint="내 손패를 같은 방 사람들이 이 뒷면으로 봐요. 덱·버린 더미 같은 공용 카드는 게임 기본 뒷면 그대로예요. 🖼️ 그림 뒷면은 플레이로 해금돼요.">
        {showFree && (
          <Tile selected={skin.back === DEFAULT_SKIN_ID} onClick={() => set({ back: DEFAULT_SKIN_ID })} label="게임 기본" kind="게임마다 달라요">
            <div className="flex h-16 w-11 items-center justify-center rounded-lg border-2 border-dashed border-white/25 text-lg light:border-slate-300">🂠</div>
          </Tile>
        )}
        {backs.map((b) => (
          <Tile key={b.id} selected={skin.back === b.id} onClick={() => set({ back: b.id })} label={`${b.emoji} ${b.name}`} kind={b.image ? "🖼️ 그림 뒷면" : `${PATTERN_LABEL[b.pattern]} · ${b.emblem}`} lock={lockOf(b.unlock, progress)} reward={b.unlock} onLocked={() => b.unlock && setHint({ name: `${b.emoji} ${b.name}`, unlock: b.unlock })}>
            <SkinBackFace skin={b} className="h-16 w-11" emblemClassName="text-xl" />
          </Tile>
        ))}
      </Section>
      )}
      {(showFree || tables.length > 0) && (
      <Section title={`🎲 테이블 · 방 테마 (3D) · ${tables.length + (showFree ? 1 : 0)}`} cols="grid-cols-3 sm:grid-cols-5 lg:grid-cols-7" hint="내가 방장인 방에서는 모두의 3D 테이블 천·배경·조명색·의자가 이 테마로 바뀌고, 꽃잎·별빛 같은 효과가 흩날려요(저사양 모드에선 효과 꺼짐). 다른 사람 방에서는 방장의 테마가 보여요.">
        {showFree && (
          <Tile selected={skin.table === DEFAULT_SKIN_ID} onClick={() => set({ table: DEFAULT_SKIN_ID })} label="게임 기본" kind="게임마다 달라요">
            <TableFace table={null} />
          </Tile>
        )}
        {tables.map((t) => (
          <Tile key={t.id} selected={skin.table === t.id} onClick={() => set({ table: t.id })} label={`${t.emoji} ${t.name}`} kind={t.particles ? PARTICLE_LABEL[t.particles] : PATTERN_LABEL[t.pattern]} lock={lockOf(t.unlock, progress)} reward={t.unlock} onLocked={() => t.unlock && setHint({ name: `${t.emoji} ${t.name}`, unlock: t.unlock })}>
            <TableFace table={t} />
          </Tile>
        ))}
      </Section>
      )}
      {(showFree || plates.length > 0) && (
      <Section title={`🏷️ 3D 이름표 · ${plates.length + (showFree ? 1 : 0)}`} hint="3D 테이블에서 내 머리 위 이름표를 모두가 이 스킨으로 봐요. 안쪽 테두리는 자리 색 그대로라 누구 자리인지 헷갈리지 않아요." cols="grid-cols-2 sm:grid-cols-4 lg:grid-cols-5">
        {showFree && (
          <Tile selected={skin.plate === DEFAULT_SKIN_ID} onClick={() => set({ plate: DEFAULT_SKIN_ID })} label="기본 이름표" kind="어두운 기본형">
            <PlateFace plate={null} name="이름" />
          </Tile>
        )}
        {plates.map((pl) => (
          <Tile key={pl.id} selected={skin.plate === pl.id} onClick={() => set({ plate: pl.id })} label={`${pl.emoji} ${pl.name}`} kind={`${PATTERN_LABEL[pl.pattern]} · ${pl.emblem}`} lock={lockOf(pl.unlock, progress)} reward={pl.unlock} onLocked={() => pl.unlock && setHint({ name: `${pl.emoji} ${pl.name}`, unlock: pl.unlock })}>
            <PlateFace plate={pl} name="이름" />
          </Tile>
        ))}
      </Section>
      )}
      {showFree && (
      <Section title="🏺 소품 (컵·코인)" hint="3D 테이블에서 내 자리의 페루도 컵과 코인 더미가 이 색이 돼요. 컵의 자리 색 띠, 그리고 금·은·보석처럼 색이 뜻을 가진 코인은 그대로예요.">
        <Tile selected={skin.prop === DEFAULT_SKIN_ID} onClick={() => set({ prop: DEFAULT_SKIN_ID })} label="게임 기본" kind="나무 컵 · 금화">
          <PropFace prop={null} />
        </Tile>
        {PROP_SKINS.map((pr) => (
          <Tile key={pr.id} selected={skin.prop === pr.id} onClick={() => set({ prop: pr.id })} label={`${pr.emoji} ${pr.name}`} kind="컵 · 코인">
            <PropFace prop={pr} />
          </Tile>
        ))}
      </Section>
      )}
      {hint && <UnlockHint name={hint.name} unlock={hint.unlock} progress={progress} onClose={() => setHint(null)} />}
    </div>
  );
}

/** Opens 🎨 내 스킨 — next to the 3D character button on every online game's room screen, and on every 3D table. */
export default function SkinButton({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const skin = useMySkin((s) => s.skin);
  const init = useMySkin((s) => s.init);
  useEffect(() => {
    void init();
  }, [init]);
  // emoji only — four names wouldn't fit one line on a 360px phone
  const summary = [cardBackSkin(skin.back), tableSkin(skin.table), plateSkin(skin.plate), propSkin(skin.prop)].map((x) => x?.emoji ?? "").join("");
  return (
    <>
      {compact ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="내 스킨 바꾸기"
          className="pointer-events-auto rounded-full border border-white/20 bg-black/55 px-2 py-0.5 text-[10px] text-white/80 hover:text-white sm:px-2.5 sm:py-1 sm:text-[11px]"
        >
          🎨 스킨
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 self-start text-xs text-white/50 underline hover:text-white/80 light:text-slate-500 light:hover:text-slate-700"
        >
          🎨 {summary ? `내 스킨 ${summary} 바꾸기` : "카드 뒷면·테이블·이름표 스킨 고르기"}
        </button>
      )}
      {open && (
        <Overlay title="🎨 내 스킨" onClose={() => setOpen(false)} wide="xl">
          <SkinPicker />
        </Overlay>
      )}
    </>
  );
}
