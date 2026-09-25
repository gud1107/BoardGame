"use client";

import { NAZGUL_START, RING_TRACK_SPACES, TRACK_TILES, type TrackRewardType } from "./data";
import type { Faction } from "./types";

/**
 * 반지 원정 트랙 — a panorama of the 4 assembled track tiles (spaces 1–16)
 * under a start row holding the Nazgûl pursuit zone and the Shire (0).
 * Each space shows its place name and the reward paid when a marker passes
 * through or lands on it; `trail` glows the spaces just crossed.
 */

export const REWARD_BADGE: Record<TrackRewardType, { icon: string; label: string; tone: string } | null> = {
  COINS: { icon: "🪙", label: "주화", tone: "text-amber-200" },
  ALLIANCE_TOKEN_CHOICE: { icon: "📜", label: "동맹", tone: "text-emerald-300" },
  PLACE_UNIT: { icon: "⚔️", label: "배치", tone: "text-rose-300" },
  MOVE_UNIT: { icon: "🏃", label: "이동", tone: "text-cyan-300" },
  SNIPE_UNIT: { icon: "🎯", label: "저격", tone: "text-fuchsia-300" },
  DESTROY_FORTRESS: { icon: "💥", label: "요새파괴", tone: "text-orange-300" },
  NONE: null,
};

function rewardText(pos: number): string {
  const s = RING_TRACK_SPACES[pos];
  switch (s.rewardType) {
    case "COINS":
      return `주화 ${s.rewardValue}개`;
    case "ALLIANCE_TOKEN_CHOICE":
      return "원하는 종족 더미 위 2개 중 동맹 토큰 1개";
    case "PLACE_UNIT":
      return "원하는 지역에 내 유닛 1개 배치";
    case "MOVE_UNIT":
      return "내 유닛 1개를 인접 지역으로 이동";
    case "SNIPE_UNIT":
      return "적 유닛 1개 제거";
    case "DESTROY_FORTRESS":
      return "적 요새 1개 파괴";
    case "NONE":
      return pos === 16 ? "프로도 & 샘 도착 시 원정대 승리" : "보상 없음";
  }
}

function Marker({ who }: { who: Faction }) {
  return who === "FELLOWSHIP" ? (
    <span title="프로도 & 샘" className="flex h-5 w-5 items-center justify-center rounded-full border border-white bg-gradient-to-b from-yellow-200 to-amber-500 text-[11px] shadow-[0_0_8px_rgba(250,204,21,.9)]">
      🧝
    </span>
  ) : (
    <span title="나즈굴" className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-rose-500 bg-neutral-900 text-[11px] shadow-[0_0_8px_rgba(244,63,94,.9)]">
      🐉
    </span>
  );
}

export default function RingTrackBoard({
  frodoPos,
  nazgulPos,
  trail,
}: {
  frodoPos: number;
  nazgulPos: number;
  trail: { key: number; faction: Faction; from: number; to: number } | null;
}) {
  const trailClass = (pos: number) => (trail && pos > trail.from && pos <= trail.to ? (trail.faction === "FELLOWSHIP" ? "lotrfx-trail-blue" : "lotrfx-trail-red") : "");

  const cell = (pos: number) => {
    const space = RING_TRACK_SPACES[pos];
    const badge = REWARD_BADGE[space.rewardType];
    const doom = pos === 16;
    return (
      <div
        key={pos}
        title={`${pos} · ${space.theme} — ${rewardText(pos)}`}
        className={`relative flex min-h-[58px] flex-col items-center rounded-lg border px-0.5 pt-0.5 pb-1 text-center ${
          doom ? "border-rose-500/80 bg-gradient-to-b from-orange-600/40 to-red-950/80 ring-1 ring-rose-500/70" : badge ? "border-amber-400/45 bg-black/45" : "border-white/10 bg-black/25"
        } ${trailClass(pos)}`}
      >
        <span className="flex w-full items-center justify-between text-[8px] leading-none">
          <span className="font-bold text-white/40">{pos}</span>
          {badge && (
            <span className={`font-bold ${badge.tone}`}>
              {badge.icon}
              {space.rewardType === "COINS" ? space.rewardValue : ""}
            </span>
          )}
          {doom && <span>🌋</span>}
        </span>
        <span className="mt-0.5 w-full truncate font-serif text-[8.5px] leading-tight text-amber-50/85">{space.theme}</span>
        <span className="mt-auto flex gap-0.5 pt-0.5">
          {frodoPos === pos && <Marker who="FELLOWSHIP" />}
          {nazgulPos === pos && <Marker who="SAURON" />}
        </span>
      </div>
    );
  };

  const pursuit = Array.from({ length: -NAZGUL_START }, (_, i) => NAZGUL_START + i);

  return (
    <div className="flex flex-col gap-1.5 select-none">
      {/* start row: Nazgûl pursuit zone + the Shire */}
      <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-1.5">
        <div className="flex flex-col justify-center rounded-lg border border-rose-900/50 bg-gradient-to-r from-black/70 to-rose-950/40 px-1.5 py-1" title="나즈굴은 샤이어 뒤 추격 대기열에서 출발합니다 (트랙 보상은 1번 칸부터)">
          <span className="text-[8.5px] font-bold text-rose-300/80">나즈굴 추격 대기열</span>
          <span className="mt-0.5 flex items-center gap-0.5">
            {pursuit.map((p) => (
              <span key={p} className={`flex h-5 flex-1 items-center justify-center rounded border border-rose-900/60 bg-black/50 text-[8px] text-white/30 ${trailClass(p)}`}>
                {nazgulPos === p ? <Marker who="SAURON" /> : p}
              </span>
            ))}
          </span>
        </div>
        <div className="rounded-lg bg-gradient-to-br from-lime-800/40 to-emerald-950/60 p-px">{cell(0)}</div>
      </div>
      {/* the 4 assembled tiles */}
      {TRACK_TILES.map((tile, t) => (
        <div key={tile.name} className={`rounded-xl border border-amber-800/40 bg-gradient-to-r ${tile.tone} p-1`}>
          <p className="mb-0.5 flex items-center justify-between px-0.5 text-[9px] font-semibold text-amber-200/70">
            <span className="font-serif">
              타일 {t + 1} · {tile.name}
            </span>
            <span className="text-white/35">
              {tile.from}–{tile.to}
            </span>
          </p>
          <div className="grid grid-cols-4 gap-1">{Array.from({ length: tile.to - tile.from + 1 }, (_, k) => cell(tile.from + k))}</div>
        </div>
      ))}
    </div>
  );
}
