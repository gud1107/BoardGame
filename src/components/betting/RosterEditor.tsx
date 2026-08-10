"use client";

import { useState } from "react";
import type { PlayerRecord } from "@/lib/db/types";
import { confirmMerge, createFresh, resolvePlayerIdentity } from "@/lib/identity/resolve";

export interface RosterParticipant {
  id: string;
  name: string;
}

interface Props {
  participants: RosterParticipant[];
  onChange: (participants: RosterParticipant[]) => void;
  maxParticipants?: number;
}

export default function RosterEditor({ participants, onChange, maxParticipants = 10 }: Props) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ nickname: string; candidates: PlayerRecord[] } | null>(
    null,
  );

  async function handleAdd() {
    const nickname = input.trim();
    if (!nickname) return;
    if (participants.some((p) => p.name === nickname)) {
      setInput("");
      return;
    }
    if (participants.length >= maxParticipants) return;

    setBusy(true);
    try {
      const resolution = await resolvePlayerIdentity(nickname);
      if (resolution.kind === "needs-confirmation") {
        setPending({ nickname: resolution.nickname, candidates: resolution.candidates });
        return;
      }
      const player =
        resolution.kind === "known-device" ? resolution.player : await createFresh(resolution.nickname);
      onChange([...participants, { id: player.id, name: player.name }]);
      setInput("");
    } finally {
      setBusy(false);
    }
  }

  async function resolvePending(mode: "merge" | "new", candidateId?: string) {
    if (!pending) return;
    setBusy(true);
    try {
      const player =
        mode === "merge" && candidateId
          ? await confirmMerge(candidateId, pending.nickname)
          : await createFresh(pending.nickname);
      onChange([...participants, { id: player.id, name: player.name }]);
      setPending(null);
      setInput("");
    } finally {
      setBusy(false);
    }
  }

  function remove(id: string) {
    onChange(participants.filter((p) => p.id !== id));
  }

  return (
    <div>
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder="닉네임 입력 후 추가"
          disabled={busy || participants.length >= maxParticipants}
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-rose-400 focus:outline-none"
        />
        <button
          onClick={handleAdd}
          disabled={busy || !input.trim() || participants.length >= maxParticipants}
          className="min-h-11 shrink-0 rounded-lg bg-rose-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-400 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
        >
          추가
        </button>
      </div>

      {pending && (
        <div className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm">
          <p className="mb-2 text-amber-200">
            &lsquo;{pending.nickname}&rsquo;와 동일 인물로 보이는 플레이어를 찾았어요. 같은
            사람인가요?
          </p>
          <div className="flex flex-wrap gap-2">
            {pending.candidates.map((c) => (
              <button
                key={c.id}
                onClick={() => resolvePending("merge", c.id)}
                disabled={busy}
                className="rounded-full bg-amber-400/20 px-3 py-1 text-xs font-medium text-amber-100 hover:bg-amber-400/30"
              >
                네, {c.name}님이에요
              </button>
            ))}
            <button
              onClick={() => resolvePending("new")}
              disabled={busy}
              className="rounded-full border border-white/20 px-3 py-1 text-xs font-medium text-white/70 hover:border-white/40"
            >
              아니요, 다른 사람이에요
            </button>
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {participants.map((p) => (
          <span
            key={p.id}
            className="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 py-1 pr-1.5 pl-3 text-sm text-white"
          >
            {p.name}
            <button
              onClick={() => remove(p.id)}
              className="grid h-5 w-5 place-items-center rounded-full text-white/50 hover:bg-white/10 hover:text-white"
              aria-label={`${p.name} 제거`}
            >
              ×
            </button>
          </span>
        ))}
        {participants.length === 0 && (
          <p className="text-xs text-white/40">참가자를 2명 이상 추가하세요.</p>
        )}
      </div>
    </div>
  );
}
