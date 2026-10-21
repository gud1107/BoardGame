"use client";

import { useEffect, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { AVATAR_OPTIONS, resolveLook, type AvatarProfile, type PersonGender, type PersonLook } from "@/lib/character/avatar";
import { useMyCharacter } from "@/lib/character/myCharacter";

const CharacterPreview3D = dynamic(() => import("./CharacterPreview3D"), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-xs text-white/40">3D 불러오는 중…</div>,
});

/** The seat whose default look is shown before any choice (seat 0 = the first K-pop woman). */
const PREVIEW_SEAT = 0;

/** Everything the profile can hold, read off a resolved look — so the first tap freezes the whole look, not one field. */
function toProfile(l: PersonLook): AvatarProfile {
  return { gender: l.gender, skin: l.skin, hair: l.hair, hairStyle: l.hairStyle, coat: l.coat, shirt: l.shirt, glasses: l.glasses, lip: l.lip };
}

/**
 * 3D character picker (profile → 캐릭터 선택). Every tap saves immediately
 * (`useMyCharacter`), and the other players see it at the 3D tables via the
 * room's presence (`roomCharacters.ts`). Options come from `AVATAR_OPTIONS`,
 * so adding a colour or cut there shows up here automatically.
 */
export default function CharacterPicker() {
  const character = useMyCharacter((s) => s.character);
  const init = useMyCharacter((s) => s.init);
  const save = useMyCharacter((s) => s.set);
  const clear = useMyCharacter((s) => s.clear);
  useEffect(() => {
    void init();
  }, [init]);

  const look = resolveLook(PREVIEW_SEAT, ["none"], character);
  const update = (patch: AvatarProfile) => save({ ...toProfile(look), ...patch });
  const setGender = (g: PersonGender) => {
    if (g === look.gender) return;
    const f = g === "f";
    update({
      gender: g,
      hairStyle: f ? "straight" : "comma",
      hair: (f ? AVATAR_OPTIONS.hairF : AVATAR_OPTIONS.hairM)[0].id,
      lip: f ? AVATAR_OPTIONS.lip[0].id : "#c27a6e",
      glasses: f ? false : look.glasses,
    });
  };
  const hairs = look.gender === "f" ? AVATAR_OPTIONS.hairF : AVATAR_OPTIONS.hairM;

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="h-48 w-full overflow-hidden rounded-xl bg-gradient-to-b from-[#3a3550] to-[#22202e]">
        <CharacterPreview3D look={look} />
      </div>
      <p className="text-center text-[11px] text-white/45 light:text-slate-500">
        {character ? "3D 게임 테이블에서 다른 참가자에게 이 캐릭터로 보여요." : "아직 고르지 않았어요 — 지금은 자리마다 기본 캐릭터가 나와요."}
      </p>

      <Row label="성별">
        {AVATAR_OPTIONS.gender.map((o) => (
          <Chip key={o.id} selected={look.gender === o.id} onClick={() => setGender(o.id)}>
            {o.id === "f" ? "👩 " : "👨 "}
            {o.label}
          </Chip>
        ))}
      </Row>
      <Row label="헤어스타일">
        {AVATAR_OPTIONS.hairStyle.map((o) => (
          <Chip key={o.id} selected={look.hairStyle === o.id} onClick={() => update({ hairStyle: o.id })}>
            {o.label}
          </Chip>
        ))}
      </Row>
      <Row label="머리색">
        {hairs.map((o) => (
          <Swatch key={o.id} color={o.id} label={o.label} selected={look.hair === o.id} onClick={() => update({ hair: o.id })} />
        ))}
      </Row>
      <Row label="피부톤">
        {AVATAR_OPTIONS.skin.map((o) => (
          <Swatch key={o.id} color={o.id} label={o.label} selected={look.skin === o.id} onClick={() => update({ skin: o.id })} />
        ))}
      </Row>
      <Row label="옷 색">
        {AVATAR_OPTIONS.coat.map((o) => (
          <Swatch key={o.id} color={o.id} label={o.label} selected={look.coat === o.id} onClick={() => update({ coat: o.id })} />
        ))}
      </Row>
      <Row label="입술">
        {AVATAR_OPTIONS.lip.map((o) => (
          <Swatch key={o.id} color={o.id} label={o.label} selected={look.lip === o.id} onClick={() => update({ lip: o.id })} />
        ))}
      </Row>
      <Row label="안경">
        <Chip selected={!look.glasses} onClick={() => update({ glasses: false })}>
          없음
        </Chip>
        <Chip selected={look.glasses} onClick={() => update({ glasses: true })}>
          👓 동그란 안경
        </Chip>
      </Row>

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
