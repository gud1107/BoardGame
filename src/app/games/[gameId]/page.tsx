"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getGameMeta } from "@/games/registry";
import { PLAYABLE_GAME_COMPONENTS } from "@/games/playableGames";
import type { GameCompletionResult } from "@/games/types";
import { useBettingStore } from "@/store/bettingStore";
import { saveGameResult } from "@/lib/db/repository";
import RoundResultEntry from "@/components/betting/RoundResultEntry";

type Stage = "select" | "playing" | "record" | "done";

export default function GamePlayPage() {
  const params = useParams<{ gameId: string }>();
  const game = getGameMeta(params.gameId);

  const session = useBettingStore((s) => s.session);
  const hydrated = useBettingStore((s) => s.hydrated);
  const init = useBettingStore((s) => s.init);
  const recordRound = useBettingStore((s) => s.recordRound);

  useEffect(() => {
    void init();
  }, [init]);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [adHocNames, setAdHocNames] = useState<string[]>([]);
  const [stage, setStage] = useState<Stage>("select");
  const [result, setResult] = useState<GameCompletionResult | null>(null);

  const min = game?.players.min ?? 2;
  const max = game?.players.max ?? 2;

  const [adHocCount, setAdHocCount] = useState(min);
  const [namesForCount, setNamesForCount] = useState(adHocCount);
  if (adHocCount !== namesForCount) {
    setNamesForCount(adHocCount);
    setAdHocNames((prev) => {
      const next = [...prev];
      next.length = adHocCount;
      return next.map((n, i) => n ?? `플레이어${i + 1}`);
    });
  }

  const activeParticipants = useMemo(() => {
    if (session) {
      return session.participants
        .filter((p) => selectedIds.includes(p.playerId))
        .map((p) => ({ id: p.playerId, name: p.name }));
    }
    return adHocNames.map((name, i) => ({ id: `adhoc-${i}`, name: name.trim() || `플레이어${i + 1}` }));
  }, [session, selectedIds, adHocNames]);

  if (!game) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <p className="text-white/60">존재하지 않는 게임입니다.</p>
        <Link href="/" className="mt-4 inline-block text-rose-300 underline">
          대시보드로 돌아가기
        </Link>
      </div>
    );
  }

  if (!game.playable) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <div className="text-5xl">{game.thumbnail.emoji}</div>
        <h1 className="mt-4 text-xl font-bold text-white">{game.name}</h1>
        <p className="mt-2 text-sm text-white/50">아직 준비 중인 게임입니다. 곧 만나보실 수 있어요!</p>
        <Link href="/" className="mt-6 inline-block text-rose-300 underline">
          대시보드로 돌아가기
        </Link>
      </div>
    );
  }

  const GameComponent = PLAYABLE_GAME_COMPONENTS[game.id];

  async function handleGameComplete(res: GameCompletionResult) {
    setResult(res);
    await saveGameResult({
      gameId: game!.id,
      gameName: game!.name,
      participantIds: activeParticipants.map((p) => p.id),
      rankedPlayerIds: res.rankings.sort((a, b) => a.rank - b.rank).map((r) => r.playerId),
      playedAt: res.finishedAt,
      bettingSessionId: session?.id,
    });
    setStage(session ? "record" : "done");
  }

  async function handleConfirmRound(ranks: Record<string, number>) {
    await recordRound(game!.id, game!.name, ranks);
    setStage("done");
  }

  const canSelectFromRoster = Boolean(session);
  const selectionValid = canSelectFromRoster
    ? selectedIds.length >= min && selectedIds.length <= max
    : activeParticipants.length >= min;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center gap-3">
        <span className="text-3xl">{game.thumbnail.emoji}</span>
        <div>
          <h1 className="text-xl font-bold text-white">{game.name}</h1>
          <p className="text-xs text-white/45">
            {game.players.min === game.players.max
              ? `${game.players.min}인 전용`
              : `${game.players.min}~${game.players.max}인`}{" "}
            · {game.playTime.minMinutes}~{game.playTime.maxMinutes}분
          </p>
        </div>
      </div>

      {stage === "select" && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          {canSelectFromRoster ? (
            <>
              <p className="mb-3 text-sm text-white/70">
                이번 판을 플레이할 참가자를 {min === max ? `${min}명` : `${min}~${max}명`} 선택하세요.
                (내기 참가자 목록에서)
              </p>
              <div className="flex flex-wrap gap-2">
                {session!.participants.map((p) => {
                  const selected = selectedIds.includes(p.playerId);
                  return (
                    <button
                      key={p.playerId}
                      onClick={() =>
                        setSelectedIds((prev) =>
                          selected
                            ? prev.filter((id) => id !== p.playerId)
                            : prev.length < max
                              ? [...prev, p.playerId]
                              : prev,
                        )
                      }
                      className={`rounded-full border px-3 py-1.5 text-sm transition ${
                        selected
                          ? "border-rose-400 bg-rose-500/20 text-white"
                          : "border-white/15 text-white/60 hover:border-white/30"
                      }`}
                    >
                      {p.name}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-white/40">
                {selectedIds.length}/{max} 선택됨 · 선택되지 않은 참가자는 이번 판 상금/벌금에 영향을
                주지 않도록 다음 화면에서 조정할 수 있어요.
              </p>
            </>
          ) : (
            <>
              <p className="mb-3 text-sm text-white/70">
                내기 없이 자유롭게 플레이합니다. 참가자 이름을 입력하세요.
              </p>
              {min !== max && (
                <div className="mb-3 flex items-center gap-2 text-sm text-white/70">
                  <span>인원 수</span>
                  <button
                    onClick={() => setAdHocCount((c) => Math.max(min, c - 1))}
                    className="h-7 w-7 rounded-full border border-white/15 hover:border-white/40"
                  >
                    −
                  </button>
                  <span className="w-6 text-center">{adHocCount}</span>
                  <button
                    onClick={() => setAdHocCount((c) => Math.min(max, c + 1))}
                    className="h-7 w-7 rounded-full border border-white/15 hover:border-white/40"
                  >
                    +
                  </button>
                </div>
              )}
              <div className="flex flex-col gap-2">
                {adHocNames.map((name, i) => (
                  <input
                    key={i}
                    value={name}
                    onChange={(e) =>
                      setAdHocNames((prev) => prev.map((n, idx) => (idx === i ? e.target.value : n)))
                    }
                    placeholder={`플레이어${i + 1}`}
                    className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-rose-400 focus:outline-none"
                  />
                ))}
              </div>
            </>
          )}

          <button
            disabled={!selectionValid}
            onClick={() => setStage("playing")}
            className="mt-5 w-full rounded-xl bg-rose-500 py-3 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
          >
            게임 시작
          </button>
        </div>
      )}

      {stage === "playing" && hydrated && (
        <GameComponent participants={activeParticipants} onComplete={handleGameComplete} />
      )}

      {stage === "record" && session && result && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <RoundResultEntry
            participants={session.participants}
            autoRanking={result.rankings}
            onConfirm={handleConfirmRound}
          />
        </div>
      )}

      {stage === "done" && result && (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
          <span className="text-4xl">✅</span>
          <p className="text-white/80">
            {session ? "결과가 내기에 반영되었습니다." : "게임이 종료되었습니다."}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setStage("select");
                setSelectedIds([]);
                setResult(null);
              }}
              className="rounded-xl border border-white/15 px-4 py-2.5 text-sm text-white/70 hover:border-white/30"
            >
              이 게임 다시하기
            </button>
            <Link
              href="/"
              className="rounded-xl bg-rose-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-400"
            >
              대시보드로
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
