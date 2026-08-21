"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getGameMeta } from "@/games/registry";
import { PLAYABLE_GAME_COMPONENTS } from "@/games/playableGames";
import type { GameCompletionResult } from "@/games/types";
import { useBettingStore } from "@/store/bettingStore";
import { useSubscriptionStore } from "@/store/subscriptionStore";
import { saveGameResult } from "@/lib/db/repository";
import RoundResultEntry from "@/components/betting/RoundResultEntry";
import GameThumbnail from "@/components/GameThumbnail";
import BugReportFloatingButton from "@/components/bugReport/BugReportFloatingButton";

type Stage = "select" | "playing" | "record" | "done";
/** Frozen once per page load right after the subscription store hydrates — see the entitlement gate below. */
type GateStatus = "checking" | "ok" | "login-required" | "limit-reached";

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

  // Entitlement gate: resolved once, right after the subscription store
  // finishes hydrating, and then frozen — never re-evaluated mid-game, so a
  // usage count ticking over while an online-multiplayer room is already in
  // progress can never yank a player out of it. It only decides whether
  // this page render *starts* a game at all.
  const subHydrated = useSubscriptionStore((s) => s.hydrated);
  const subConfigured = useSubscriptionStore((s) => s.configured);
  const loginRequired = useSubscriptionStore((s) => s.loginRequired);
  const entitlement = useSubscriptionStore((s) => s.entitlement);
  const initSubscription = useSubscriptionStore((s) => s.init);
  const recordPlay = useSubscriptionStore((s) => s.recordPlay);

  useEffect(() => {
    void initSubscription();
  }, [initSubscription]);

  const [gateStatus, setGateStatus] = useState<GateStatus>("checking");
  if (gateStatus === "checking" && subHydrated) {
    if (!subConfigured) {
      setGateStatus("ok"); // Accounts feature disabled entirely — behave exactly like before this feature existed.
    } else if (loginRequired) {
      setGateStatus("login-required");
    } else if (entitlement && !entitlement.allowed) {
      setGateStatus("limit-reached");
    } else {
      setGateStatus("ok");
    }
  }

  const playStartedAtRef = useRef<number | null>(null);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // Online-multiplayer games run their own room lobby (create/join/waiting)
  // in place of this page's local participant-selection step.
  const [stage, setStage] = useState<Stage>(game?.onlineMultiplayer ? "playing" : "select");
  const [result, setResult] = useState<GameCompletionResult | null>(null);

  useEffect(() => {
    if (stage === "playing" && playStartedAtRef.current === null) {
      playStartedAtRef.current = Date.now();
    }
    if (stage === "select") {
      playStartedAtRef.current = null; // "이 게임 다시하기" restarts the elapsed-time clock too.
    }
  }, [stage]);

  const min = game?.players.min ?? 2;
  const max = game?.players.max ?? 2;

  // Default ad-hoc names are pre-filled (not just placeholders) so the
  // "게임 시작" button works immediately without typing anything — this is
  // what actually makes it "always enabled" for fixed player-count games
  // (min === max), where the count never changes and a placeholder-only
  // empty array would render zero inputs.
  const [adHocCount, setAdHocCount] = useState(min);
  const [adHocNames, setAdHocNames] = useState<string[]>(() =>
    Array.from({ length: min }, (_, i) => `Player ${i + 1}`),
  );
  const [namesForCount, setNamesForCount] = useState(min);
  if (adHocCount !== namesForCount) {
    setNamesForCount(adHocCount);
    setAdHocNames((prev) => Array.from({ length: adHocCount }, (_, i) => prev[i] ?? `Player ${i + 1}`));
  }

  // When a betting session is active, default the roster selection to its
  // first `min` participants so their nicknames drive the game immediately
  // — still freely adjustable via the buttons below.
  const [autoSelectedSessionId, setAutoSelectedSessionId] = useState<string | null>(null);
  if (session && session.id !== autoSelectedSessionId && selectedIds.length === 0) {
    setAutoSelectedSessionId(session.id);
    setSelectedIds(session.participants.slice(0, min).map((p) => p.playerId));
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
        <div className="relative mx-auto flex h-28 w-24 items-center justify-center overflow-hidden rounded-lg bg-white/5">
          {/* imageClassName padding (not container padding) actually insets
              the art — next/image's `fill` positions absolutely against the
              container's padding box, so container padding alone wouldn't
              shrink it. */}
          <GameThumbnail
            game={game}
            className="text-5xl"
            imageClassName="object-contain p-2"
            imageSizes="96px"
          />
        </div>
        <h1 className="mt-4 text-xl font-bold text-white">{game.name}</h1>
        <p className="mt-2 text-sm text-white/50">아직 준비 중인 게임입니다. 곧 만나보실 수 있어요!</p>
        <Link href="/" className="mt-6 inline-block text-rose-300 underline">
          대시보드로 돌아가기
        </Link>
      </div>
    );
  }

  if (gateStatus === "login-required") {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <span className="text-4xl">🔒</span>
        <h1 className="mt-4 text-xl font-bold text-white">로그인이 필요합니다</h1>
        <p className="mt-2 text-sm text-white/50">지금은 게스트 모드가 꺼져 있어 로그인한 회원만 플레이할 수 있어요.</p>
        <Link
          href={`/login?next=${encodeURIComponent(`/games/${game.id}`)}`}
          className="mt-6 inline-block rounded-xl bg-rose-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-400"
        >
          로그인하러 가기
        </Link>
      </div>
    );
  }

  if (gateStatus === "limit-reached") {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <span className="text-4xl">⏳</span>
        <h1 className="mt-4 text-xl font-bold text-white">오늘의 이용 한도를 모두 사용했어요</h1>
        <p className="mt-2 text-sm text-white/50">
          {entitlement?.unit === "minutes"
            ? `오늘 이용 시간(${entitlement.cap}분)을 모두 사용했습니다.`
            : `오늘 게임 횟수(${entitlement?.cap}회)를 모두 사용했습니다.`}{" "}
          내일 다시 초기화되거나, 구독을 업그레이드하면 더 많이 플레이할 수 있어요.
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Link
            href="/account"
            className="rounded-xl bg-rose-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-400"
          >
            구독 업그레이드
          </Link>
          <button
            disabled
            title="준비 중인 기능입니다"
            className="cursor-not-allowed rounded-xl border border-white/15 px-4 py-2.5 text-sm text-white/40"
          >
            코인 충전 (준비중)
          </button>
        </div>
      </div>
    );
  }

  const GameComponent = PLAYABLE_GAME_COMPONENTS[game.id];

  async function handleGameComplete(res: GameCompletionResult) {
    setResult(res);
    if (subConfigured) {
      const startedAt = playStartedAtRef.current ?? Date.now();
      const minutes = Math.max(1, Math.round((Date.now() - startedAt) / 60000));
      void recordPlay(minutes);
    }
    await saveGameResult({
      gameId: game!.id,
      gameName: game!.name,
      // Rankings are always exactly who played — a more reliable source than
      // activeParticipants, which online-multiplayer games leave empty since
      // they resolve identity through their own room instead.
      participantIds: res.rankings.map((r) => r.playerId),
      rankedPlayerIds: res.rankings.sort((a, b) => a.rank - b.rank).map((r) => r.playerId),
      playedAt: res.finishedAt,
      bettingSessionId: session?.id,
    });
    // Online games own their own post-game screen (rematch/leave) inside the
    // room; swapping this page's stage away from "playing" would unmount it
    // mid-transition and tear the Realtime channel down before it ever shows.
    if (game?.onlineMultiplayer) return;
    setStage(session ? "record" : "done");
  }

  async function handleConfirmRound(ranks: Record<string, number>) {
    await recordRound(game!.id, game!.name, ranks);
    setStage("done");
  }

  const canSelectFromRoster = Boolean(session);
  // Betting (roster) mode still needs a valid selection count, since it maps
  // straight into the payout table. Free-play (ad-hoc) mode always has
  // default names pre-filled, so its start button is always enabled.
  const selectionValid = canSelectFromRoster
    ? selectedIds.length >= min && selectedIds.length <= max
    : true;

  // 소환사의 협곡 alone gets a wider page container so its always-visible
  // player-aid sidebar (SummonersRiftGuideSidebar) can sit beside the board
  // on desktop instead of squeezing both into the standard max-w-2xl column
  // every other game here uses.
  const pageMaxWidth = game.id === "summoners-rift" ? "max-w-5xl" : "max-w-2xl";

  return (
    <div className={`mx-auto ${pageMaxWidth} px-4 py-8 sm:px-6`}>
      <div className="mb-6 flex items-center gap-3">
        <div className="relative flex h-14 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white/5">
          <GameThumbnail
            game={game}
            className="text-3xl"
            imageClassName="object-contain p-1"
            imageSizes="44px"
          />
        </div>
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

      <BugReportFloatingButton gameId={game.id} gameName={game.name} />
    </div>
  );
}
