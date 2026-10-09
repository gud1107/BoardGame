"use client";

import { useState, type ComponentProps } from "react";
import { AUTO_PRESET_PARAM, describeAutoConfig, encodeAutoPreset, type AutoPreset } from "./autoSettings";
import { loadLimit, MAPS, sanitizeDifficulty, sanitizeMap, type Difficulty, type GameMode } from "./engine";
import RoomSettings, { DIFFICULTY_LABEL, type MapChoice } from "./RoomSettings";

/** Invite code, seat list and room rules while players gather (props only — the room hook lives in MergeDefenseGame). */
export default function WaitingRoomPanel({
  roomCode,
  shareUrl,
  autoPresets = [],
  seats,
  joined,
  mySeat,
  hostRules,
  isHost,
  settings,
  onFillWithAi,
}: {
  roomCode: string | null;
  shareUrl: string;
  /** My saved 🤖 자동 presets — one can ride along on the invite link. */
  autoPresets?: AutoPreset[];
  /** One entry per seat: the occupant's name, or null while empty. */
  seats: (string | null)[];
  joined: number;
  mySeat: number | null;
  /** What the host has announced (what everyone will play). */
  hostRules: { mode?: GameMode; difficulty?: Difficulty; limit?: number | null; map?: MapChoice };
  isHost: boolean;
  /** The host's own pickers; only rendered for the host. */
  settings: ComponentProps<typeof RoomSettings>;
  onFillWithAi: () => void;
}) {
  const target = seats.length;
  const [attach, setAttach] = useState(-1);
  const [copied, setCopied] = useState(false);
  const attached = autoPresets[attach];
  const inviteUrl = attached && shareUrl ? `${shareUrl}&${AUTO_PRESET_PARAM}=${encodeAutoPreset(attached)}` : shareUrl;
  const diff = DIFFICULTY_LABEL[sanitizeDifficulty(hostRules.difficulty)];
  return (
    <>
      <p className="text-sm text-white/50 light:text-slate-500">초대 코드</p>
      <p className="text-4xl font-bold tracking-[0.3em] text-white light:text-slate-900">{roomCode}</p>
      <button
        onClick={() =>
          navigator.clipboard
            ?.writeText(inviteUrl)
            .then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            })
            .catch(() => {})
        }
        className="rounded-full border border-white/15 px-4 py-2 text-xs text-white/70 hover:border-white/30 light:border-slate-300 light:text-slate-600"
      >
        {copied ? "✓ 복사했어요" : attached ? `🔗 초대 링크 복사 (+ 📌 ${attached.name})` : "🔗 초대 링크 복사"}
      </button>
      {autoPresets.length > 0 && (
        <label className="flex max-w-xs flex-col items-center gap-1 text-[11px] text-white/50 light:text-slate-500">
          🤖 초대 링크에 내 자동 프리셋 붙이기
          <select
            value={attach}
            onChange={(e) => setAttach(Number(e.target.value))}
            className="max-w-full rounded-lg border border-white/15 bg-black/40 px-2 py-1 text-xs text-white light:border-slate-300 light:bg-white light:text-slate-800"
          >
            <option value={-1}>안 붙임</option>
            {autoPresets.map((p, i) => (
              <option key={`${p.name}-${i}`} value={i}>
                📌 {p.name} — {describeAutoConfig(p)}
              </option>
            ))}
          </select>
          {attached && <span className="break-keep">링크를 연 친구는 이 방에 들어오면서 프리셋을 가져올 수 있어요.</span>}
        </label>
      )}
      <p className="text-xs text-white/50 light:text-slate-500">
        {joined} / {target}명 참여 중
      </p>
      <div className="mt-2 flex w-full max-w-xs flex-col gap-1.5">
        {seats.map((name, seat) => (
          <p key={seat} className="truncate text-sm text-white/70 light:text-slate-600">
            {seat === mySeat ? "나" : `${seat + 1}번`}: {name ?? <span className="text-white/30 light:text-slate-400">대기 중...</span>}
          </p>
        ))}
      </div>
      <p className="text-xs font-semibold break-keep text-orange-200 light:text-orange-700">
        {hostRules.mode === "versus" ? "⚔️ 유닛 대결" : "🛡️ 생존전"} · {hostRules.map === "random" ? "🎲 랜덤 맵" : `${MAPS[sanitizeMap(hostRules.map)].emoji} ${MAPS[sanitizeMap(hostRules.map)].name}`} · {diff.emoji} {diff.name} · 💀{" "}
        {hostRules.limit ? `${hostRules.limit}마리` : `${loadLimit(target)}마리(인원별)`}에서 탈락
      </p>
      {isHost ? (
        <div className="w-full max-w-sm text-left">
          <p className="mb-1 text-[11px] text-white/40 light:text-slate-400">⚙️ 방장 설정 — 시작 전까지 바꿀 수 있어요</p>
          <RoomSettings {...settings} compact />
        </div>
      ) : (
        <p className="text-[11px] break-keep text-white/40 light:text-slate-400">방장이 시작 전까지 모드·맵·난이도·탈락 기준을 바꿀 수 있어요.</p>
      )}
      <p className="text-xs text-white/40 light:text-slate-400">{target}명이 모이면 자동으로 시작해요.</p>
      {isHost && joined < target && (
        <button onClick={onFillWithAi} className="rounded-full bg-orange-600 px-4 py-2 text-xs font-semibold text-white hover:bg-orange-500">
          🤖 빈자리 AI로 채우고 시작
        </button>
      )}
    </>
  );
}
