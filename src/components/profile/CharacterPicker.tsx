"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { speakIntro } from "@/lib/audio/characterVoice";
import { AVATAR_OPTIONS, CHARACTER_PRESETS, DYED_BY_DEFAULT, resolveLook, VRM_MODEL_GENDER, VRM_WARDROBE, wardrobeFor, type AvatarProfile, type PersonLook, type VrmModel, type WardrobeSlot } from "@/lib/character/avatar";
import { MAX_SAVED, portraitKey, PREVIOUS_ACCOUNT_LOOK, useMyCharacter } from "@/lib/character/myCharacter";

const CharacterPreview3D = dynamic(() => import("./CharacterPreview3D"), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-xs text-white/40">3D 불러오는 중…</div>,
});

const CharacterThumbs3D = dynamic(() => import("./CharacterThumbs3D"), { ssr: false });

/** The seat whose default look is shown before any choice (seat 0 = the first K-pop woman). */
const PREVIEW_SEAT = 0;

/** Everything the profile can hold, read off a resolved look — so the first tap freezes the whole look, not one field. */
function toProfile(l: PersonLook): AvatarProfile {
  return {
    gender: l.gender,
    skin: l.skin,
    hair: l.hair,
    hairStyle: l.hairStyle,
    coat: l.coat,
    shirt: l.shirt,
    glasses: l.glasses,
    lip: l.lip,
    build: l.build,
    face: l.face,
    eyes: l.eyes,
    mark: l.mark,
    model: l.model,
    hairFrom: l.hairFrom,
    outfitFrom: l.outfitFrom,
    shoesFrom: l.shoesFrom,
    hairDye: l.hairDye,
    outfitDye: l.outfitDye,
    iris: l.iris,
    blush: l.blush,
    shadow: l.shadow,
  };
}

const PRESET_THUMBS = CHARACTER_PRESETS.map((c) => ({ key: c.id, look: c.look }));

/** The model the preview seat would get with no choice made (seat 0 is a woman → the pixiv sample). */
const DEFAULT_MODEL: VrmModel = "pixiv-sample";
const SLOT_ROWS: [WardrobeSlot, string, "hairFrom" | "outfitFrom" | "shoesFrom"][] = [
  ["hair", "💇 헤어스타일", "hairFrom"],
  ["outfit", "👗 옷", "outfitFrom"],
  ["shoes", "👟 신발", "shoesFrom"],
];

/**
 * The look being edited and the actions on it — shared by the list (`CharacterPicker`)
 * and the 직접 꾸미기 panel (`CharacterCustomizer`), which the profile shows side by side
 * on PC and one at a time on phones. Both write the same store, so they never disagree.
 */
function useCharacterEdit() {
  const character = useMyCharacter((s) => s.character);
  const init = useMyCharacter((s) => s.init);
  const save = useMyCharacter((s) => s.set);
  const clear = useMyCharacter((s) => s.clear);
  useEffect(() => {
    void init();
  }, [init]);

  const resolved = resolveLook(PREVIEW_SEAT, ["none"], character);
  const look: PersonLook = { ...resolved, model: resolved.model ?? DEFAULT_MODEL };
  // a manual tweak means it's no longer exactly that preset
  const update = (patch: AvatarProfile) => save({ ...toProfile(look), ...patch });
  const model = look.model ?? DEFAULT_MODEL;
  const setModel = (m: VrmModel) => {
    if (m === model) return;
    const g = VRM_MODEL_GENDER[m];
    // switching between a woman's and a man's body starts from that gender's first hair colour;
    // borrowed parts that don't fit the new body are dropped by resolveLook, and dyeing resets
    update({ model: m, gender: g, hairDye: undefined, outfitDye: undefined, ...(g !== look.gender ? { hair: (g === "f" ? AVATAR_OPTIONS.hairF : AVATAR_OPTIONS.hairM)[0].id } : {}) });
  };
  return { character, save, clear, look, update, model, setModel };
}

function Preview({ look }: { look: PersonLook }) {
  return (
    <div className="h-40 w-full shrink-0 overflow-hidden rounded-xl bg-gradient-to-b from-[#3a3550] to-[#22202e] sm:h-48">
      <CharacterPreview3D look={look} />
    </div>
  );
}

/**
 * 3D character picker (profile → 캐릭터 선택): pick one of the listed
 * characters (`CHARACTER_PRESETS` — the same one as anyone else is fine), or
 * open 직접 꾸미기 (`CharacterCustomizer`). Every tap saves immediately
 * (`useMyCharacter`), and the other players see it at the 3D tables via the
 * room's presence (`roomCharacters.ts`).
 *
 * `showPreview` is off while the customizer beside it carries the 3D preview (one canvas, not two).
 */
export default function CharacterPicker({ showPreview = true, customizing = false, onCustomize }: { showPreview?: boolean; customizing?: boolean; onCustomize: () => void }) {
  const { character, save, clear, look } = useCharacterEdit();
  const savedLooks = useMyCharacter((s) => s.saved);
  const removeSaved = useMyCharacter((s) => s.removeSaved);
  const parked = useMyCharacter((s) => s.parked);
  const dismissParked = useMyCharacter((s) => s.dismissParked);
  const swapParked = useMyCharacter((s) => s.swapParked);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const onShot = useCallback((id: string, url: string) => setThumbs((t) => (t[id] === url ? t : { ...t, [id]: url })), []);
  // saved looks get a thumbnail per look version, so editing one re-shoots it
  const savedThumbs = useMemo(() => savedLooks.map((s) => ({ key: `saved:${portraitKey(s.look)}`, look: s.look })), [savedLooks]);
  const mine = character ? portraitKey(character) : null;

  return (
    <div className="flex w-full flex-col gap-3">
      {showPreview && <Preview look={look} />}
      <p className="text-center text-[11px] text-white/45 light:text-slate-500">
        {character ? "3D 게임 테이블에서 다른 참가자에게 이 캐릭터로 보여요." : "아직 고르지 않았어요 — 지금은 자리마다 기본 캐릭터가 나와요."}
      </p>

      <button
        type="button"
        aria-pressed={customizing}
        onClick={onCustomize}
        className={`min-h-11 rounded-xl border px-4 py-2.5 text-sm font-semibold transition ${
          customizing
            ? "border-rose-400 bg-rose-500/20 text-white light:text-slate-900"
            : "border-white/15 text-white/80 hover:border-white/30 light:border-slate-300 light:text-slate-700 light:hover:border-slate-400"
        }`}
      >
        ✏️ 직접 꾸미기 — 얼굴·메이크업·헤어·옷
      </button>
      <Row label={`💾 내가 만든 캐릭터 (${savedLooks.length}/${MAX_SAVED})`}>
        {parked && (
          <div className="flex w-full flex-wrap items-center gap-2 rounded-xl border border-amber-400/40 bg-amber-500/10 p-2.5 text-[11px] leading-relaxed text-amber-100/90 light:border-amber-300 light:bg-amber-50 light:text-amber-800">
            <span className="min-w-0 flex-1">
              ⚠️ 칸이 꽉 차서 &lsquo;{PREVIOUS_ACCOUNT_LOOK}&rsquo;(로그인 전 계정에 있던 캐릭터)가 기다리고 있어요. 아래에서 하나를 지우면 그 자리에 자동으로 들어가요.
            </span>
            <button
              type="button"
              onClick={swapParked}
              title="지금 입은 캐릭터가 대신 기다려요"
              className="min-h-9 shrink-0 rounded-lg border border-amber-400/50 px-2.5 text-xs font-semibold hover:bg-amber-500/20 light:border-amber-400"
            >
              바꿔 입기
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`'${PREVIOUS_ACCOUNT_LOOK}'를 버릴까요? 되돌릴 수 없어요.`)) dismissParked();
              }}
              className="min-h-9 shrink-0 rounded-lg px-2.5 text-xs text-amber-100/70 underline hover:text-amber-100 light:text-amber-700"
            >
              버리기
            </button>
          </div>
        )}
        {savedLooks.length === 0 ? (
          <p className="text-[11px] text-white/45 light:text-slate-500">직접 꾸미기에서 &lsquo;💾 저장&rsquo;을 누르면 여기에 모아 두고 언제든 다시 입을 수 있어요.</p>
        ) : (
          <div className="grid w-full grid-cols-3 gap-2 sm:grid-cols-4">
            {savedLooks.map((sv) => {
              const k = portraitKey(sv.look);
              const selected = mine === k;
              return (
                <div key={sv.id} className="relative">
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => save({ ...sv.look })}
                    className={`flex w-full flex-col items-center gap-0.5 rounded-xl border p-1.5 transition ${
                      selected
                        ? "border-rose-400 bg-rose-500/15 ring-2 ring-rose-400/40"
                        : "border-white/10 bg-white/[0.03] hover:border-white/30 light:border-slate-200 light:bg-white light:hover:border-slate-400"
                    }`}
                  >
                    <div className="aspect-square w-full overflow-hidden rounded-lg bg-gradient-to-b from-[#3a3550] to-[#22202e]">
                      {thumbs[`saved:${k}`] ? (
                        // eslint-disable-next-line @next/next/no-img-element -- runtime-rendered data URL
                        <img src={thumbs[`saved:${k}`]} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full items-center justify-center text-2xl">💾</div>
                      )}
                    </div>
                    <span className="line-clamp-1 text-xs font-semibold text-white light:text-slate-800">
                      {selected && "✓ "}
                      {sv.name}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`${sv.name} 삭제`}
                    onClick={() => {
                      if (window.confirm(`'${sv.name}'을(를) 삭제할까요?`)) removeSaved(sv.id);
                    }}
                    className="absolute -right-1.5 -top-1.5 grid h-7 w-7 place-items-center rounded-full border border-white/20 bg-[#151022] text-xs text-white/70 hover:text-white light:border-slate-300 light:bg-white light:text-slate-500"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </Row>

      <Row label="캐릭터 목록 · 다른 사람과 같은 캐릭터도 고를 수 있어요">
        <div className="grid w-full grid-cols-3 gap-2 sm:grid-cols-4">
          {CHARACTER_PRESETS.map((c) => {
            const selected = character?.presetId === c.id;
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  save({ ...c.look, presetId: c.id });
                  // a hello in the voice they'll have at every table
                  speakIntro(c.id);
                }}
                className={`flex flex-col items-center gap-0.5 rounded-xl border p-1.5 transition ${
                  selected
                    ? "border-rose-400 bg-rose-500/15 ring-2 ring-rose-400/40"
                    : "border-white/10 bg-white/[0.03] hover:border-white/30 light:border-slate-200 light:bg-white light:hover:border-slate-400"
                }`}
              >
                <div className="aspect-square w-full overflow-hidden rounded-lg" style={{ background: `linear-gradient(160deg, ${c.look.coat}55, #22202e)` }}>
                  {thumbs[c.id] ? (
                    // eslint-disable-next-line @next/next/no-img-element -- runtime-rendered data URL
                    <img src={thumbs[c.id]} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-2xl">{c.look.gender === "f" ? "👩" : "👨"}</div>
                  )}
                </div>
                <span className="text-xs font-semibold text-white light:text-slate-800">
                  {selected && "✓ "}
                  {c.name}
                </span>
                <span className="line-clamp-1 text-[10px] text-white/50 light:text-slate-500">{c.concept}</span>
              </button>
            );
          })}
        </div>
      </Row>
      <CharacterThumbs3D items={PRESET_THUMBS} onShot={onShot} />
      {savedThumbs.length > 0 && <CharacterThumbs3D items={savedThumbs} onShot={onShot} />}

      <button
        type="button"
        onClick={clear}
        disabled={!character}
        className="self-center text-xs text-white/45 underline hover:text-white/75 disabled:no-underline disabled:opacity-40 light:text-slate-500 light:hover:text-slate-700"
      >
        기본 캐릭터로 되돌리기 (자리마다 자동)
      </button>
    </div>
  );
}

/**
 * 직접 꾸미기: the VRoid body (`model`), borrowed hair/outfit/shoes, the colours tinted
 * onto it, and the make-up / 눈매 that tell two players on one body apart (vrmMakeup.ts).
 * Options come from `AVATAR_OPTIONS`, so adding a colour or cut there shows up here.
 * The 3D preview stays pinned at the top while the options scroll under it.
 */
export function CharacterCustomizer({ onDone, doneLabel }: { onDone: () => void; doneLabel: string }) {
  const { look, update, model, setModel } = useCharacterEdit();
  const wardrobe = wardrobeFor(model);
  const hairDye = look.hairDye ?? DYED_BY_DEFAULT.has(model);
  const outfitDye = look.outfitDye ?? DYED_BY_DEFAULT.has(model);
  const hairs = look.gender === "f" ? AVATAR_OPTIONS.hairF : AVATAR_OPTIONS.hairM;

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="sticky top-0 z-10 -mx-1 flex flex-col gap-2 bg-[#151022] px-1 pb-2 light:bg-white">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-bold text-white light:text-slate-900">✏️ 직접 꾸미기</span>
          <button
            type="button"
            onClick={onDone}
            className="min-h-9 rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/80 transition hover:border-white/30 light:border-slate-300 light:text-slate-700 light:hover:border-slate-400"
          >
            {doneLabel}
          </button>
        </div>
        <Preview look={look} />
        <SaveBar look={look} />
      </div>

      <Row label="캐릭터 (얼굴·몸)">
        {AVATAR_OPTIONS.model.map((o) => (
          <Chip key={o.id} selected={model === o.id} onClick={() => setModel(o.id)}>
            {VRM_MODEL_GENDER[o.id] === "f" ? "👩" : "👨"} {o.label}
          </Chip>
        ))}
      </Row>
      {wardrobe.hair.length > 0 ? (
        SLOT_ROWS.map(([slot, label, field]) => (
          <Row key={slot} label={label}>
            <Chip selected={!look[field] || look[field] === model} onClick={() => update({ [field]: undefined })}>
              기본 ({VRM_WARDROBE[model]![slot]})
            </Chip>
            {wardrobe[slot]
              .filter((m) => m !== model)
              .map((m) => (
                <Chip key={m} selected={look[field] === m} onClick={() => update({ [field]: m })}>
                  {VRM_WARDROBE[m]![slot]}
                </Chip>
              ))}
          </Row>
        ))
      ) : (
        <p className="text-[11px] text-white/45 light:text-slate-500">이 캐릭터는 헤어·옷·신발을 바꿀 수 없어요 (다른 캐릭터들과 뼈대가 달라요). 색은 바꿀 수 있어요.</p>
      )}
      <Row label="머리색">
        <Chip selected={!hairDye} onClick={() => update({ hairDye: false })}>
          원래 색
        </Chip>
        {hairs.map((o) => (
          <Swatch key={o.id} color={o.id} label={o.label} selected={hairDye && look.hair === o.id} onClick={() => update({ hair: o.id, hairDye: true })} />
        ))}
      </Row>
      <Row label="옷 색 (상의)">
        <Chip selected={!outfitDye} onClick={() => update({ outfitDye: false })}>
          원래 색
        </Chip>
        {AVATAR_OPTIONS.coat.map((o) => (
          <Swatch key={o.id} color={o.id} label={o.label} selected={outfitDye && look.coat === o.id} onClick={() => update({ coat: o.id, outfitDye: true })} />
        ))}
      </Row>
      <Row label="피부톤">
        {AVATAR_OPTIONS.skin.map((o) => (
          <Swatch key={o.id} color={o.id} label={o.label} selected={look.skin === o.id} onClick={() => update({ skin: o.id })} />
        ))}
      </Row>

      <span className="mt-1 text-xs font-bold text-white/80 light:text-slate-700">💄 얼굴 · 메이크업 — 같은 캐릭터도 다른 사람처럼</span>
      <Row label="눈매">
        {AVATAR_OPTIONS.eyes.map((o) => (
          <Chip key={o.id} selected={look.eyes === o.id} onClick={() => update({ eyes: o.id })}>
            {o.label}
          </Chip>
        ))}
      </Row>
      <Row label="얼굴형">
        {AVATAR_OPTIONS.face.map((o) => (
          <Chip key={o.id} selected={look.face === o.id} onClick={() => update({ face: o.id })}>
            {o.label}
          </Chip>
        ))}
      </Row>
      <Row label="렌즈 (눈동자 색)">
        <Chip selected={!look.iris} onClick={() => update({ iris: undefined })}>
          원래 눈
        </Chip>
        {AVATAR_OPTIONS.iris.map((o) => (
          <Swatch key={o.id} color={o.id} label={o.label} selected={look.iris === o.id} onClick={() => update({ iris: o.id })} />
        ))}
      </Row>
      {model === "seed-san" ? (
        <p className="text-[11px] text-white/45 light:text-slate-500">이 캐릭터는 얼굴 그림 방식이 달라서 아이섀도·블러셔·립·점은 안 보여요 (눈매·얼굴형·렌즈는 적용돼요).</p>
      ) : (
        <>
          <Row label="아이섀도">
            <Chip selected={!look.shadow} onClick={() => update({ shadow: undefined })}>
              없음
            </Chip>
            {AVATAR_OPTIONS.shadow.map((o) => (
              <Swatch key={o.id} color={o.id} label={o.label} selected={look.shadow === o.id} onClick={() => update({ shadow: o.id })} />
            ))}
          </Row>
          <Row label="립 컬러">
            {AVATAR_OPTIONS.lip.map((o) => (
              <Swatch key={o.id} color={o.id} label={o.label} selected={look.lip === o.id} onClick={() => update({ lip: o.id })} />
            ))}
          </Row>
          <Row label="블러셔">
            <Chip selected={!look.blush} onClick={() => update({ blush: undefined })}>
              없음
            </Chip>
            {AVATAR_OPTIONS.blush.map((o) => (
              <Swatch key={o.id} color={o.id} label={o.label} selected={look.blush === o.id} onClick={() => update({ blush: o.id })} />
            ))}
          </Row>
          <Row label="포인트">
            {AVATAR_OPTIONS.mark.map((o) => (
              <Chip key={o.id} selected={look.mark === o.id} onClick={() => update({ mark: o.id })}>
                {o.label}
              </Chip>
            ))}
          </Row>
        </>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-white/70 light:text-slate-600">{label}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Chip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`min-h-9 rounded-full border px-3 py-1.5 text-xs transition ${
        selected
          ? "border-rose-400 bg-rose-500/20 text-white light:text-slate-900"
          : "border-white/15 text-white/70 hover:border-white/30 light:border-slate-300 light:text-slate-600 light:hover:border-slate-400"
      }`}
    >
      {children}
    </button>
  );
}

/** A colour button that also says its name (tooltip + label), so it doesn't rely on colour alone. */
function Swatch({ color, label, selected, onClick }: { color: string; label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`h-9 w-9 rounded-full border-2 transition ${selected ? "scale-110 border-rose-400 ring-2 ring-rose-400/40" : "border-white/20 hover:border-white/50 light:border-slate-300"}`}
      style={{ background: color }}
    >
      {selected && <span className="text-xs font-bold text-white mix-blend-difference">✓</span>}
    </button>
  );
}

/** 💾 저장: keep the current look under a name (same name = overwrite) for 내가 만든 캐릭터. */
function SaveBar({ look }: { look: PersonLook }) {
  const saved = useMyCharacter((s) => s.saved);
  const saveLook = useMyCharacter((s) => s.saveLook);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const fallback = `내 캐릭터 ${saved.length + 1}`;
  const target = name.trim() || fallback;
  const overwrite = saved.some((s) => s.name === target);
  const full = !overwrite && saved.length >= MAX_SAVED;
  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (!saveLook(target, toProfile(look))) return setMsg(`가득 찼어요 (최대 ${MAX_SAVED}개) — 목록에서 하나 지우거나 같은 이름으로 덮어써 주세요.`);
        setMsg(overwrite ? `'${target}'에 덮어썼어요.` : `'${target}'(으)로 저장했어요 — 캐릭터 목록 위 '내가 만든 캐릭터'에 있어요.`);
        setName("");
      }}
    >
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setMsg(null);
          }}
          maxLength={12}
          placeholder={fallback}
          aria-label="저장할 이름"
          className="min-w-0 flex-1 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-rose-400 focus:outline-none light:border-slate-300 light:bg-white light:text-slate-900 light:placeholder:text-slate-400"
        />
        <button type="submit" disabled={full} className="shrink-0 rounded-xl bg-rose-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-400 disabled:opacity-40">
          💾 {overwrite ? "덮어쓰기" : "저장"}
        </button>
      </div>
      {(msg || full) && <p className="text-[11px] text-white/60 light:text-slate-500">{msg ?? `가득 찼어요 (최대 ${MAX_SAVED}개) — 목록에서 하나 지우거나 같은 이름으로 덮어써 주세요.`}</p>}
    </form>
  );
}
