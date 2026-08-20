import { CARD_META, EQUIP_ORDER, WEAPON_TYPES } from "./cardMeta";
import { weaponRange, type EquipSlot, type PlayerState } from "./engine";

/**
 * The viewer's own equipped-item chip — item 3 of the 2026-08-21 redesign
 * (see HANDOFF.md): "장착된 아이템의 이름, 사거리(+/-), 고유 지속 효과가 한눈에
 * 보이도록". Deliberately only rendered for the viewer's own equipment panel
 * (see BangBoard.tsx's `MyStatusPanel`) — the compact icon-only `EquipRow`
 * still used for the other 3-6 seats around the oval table stays as-is
 * (minus its old Tooltip wrap, per the same session's item 1 "제거"
 * instruction), since there's no room around the table for full prose per
 * opponent without crowding every other seat badge.
 */
export function EquipSlotCard({ player, slot }: { player: PlayerState; slot: EquipSlot }) {
  const card = player.equipment[slot];
  if (!card) return null;
  const meta = CARD_META[card.type];
  const isWeapon = WEAPON_TYPES.includes(card.type);
  const rangeNote = isWeapon
    ? `사거리 ${weaponRange(player)}`
    : slot === "scope"
      ? "내 사거리 -1 (조준할 때)"
      : slot === "mustang"
        ? "상대 사거리 +1 (조준당할 때)"
        : null;
  return (
    <div className="flex w-36 flex-col gap-0.5 rounded-lg border border-amber-500/40 bg-black/40 px-2 py-1.5 text-left">
      <span className="flex items-center gap-1.5 text-xs font-bold text-amber-100">
        <span className="text-base leading-none">{meta.icon}</span>
        {meta.label}
      </span>
      {rangeNote && <span className="text-[10px] font-semibold text-amber-300">{rangeNote}</span>}
      <span className="text-[10px] leading-snug text-amber-100/60">{meta.desc}</span>
    </div>
  );
}

export function MyEquipmentRow({ player }: { player: PlayerState }) {
  const slots = EQUIP_ORDER.filter((slot) => player.equipment[slot] !== null);
  if (slots.length === 0) {
    return <p className="text-center text-[11px] text-amber-100/30">장착한 아이템 없음</p>;
  }
  return (
    <div className="flex flex-wrap justify-center gap-1.5">
      {slots.map((slot) => (
        <EquipSlotCard key={slot} player={player} slot={slot} />
      ))}
    </div>
  );
}
