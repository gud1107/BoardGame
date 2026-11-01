"use client";

import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel, RealtimePresenceState } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase/client";
import { getDeviceId } from "@/lib/identity/deviceId";
import { getVisitorNickname } from "@/lib/identity/lastNickname";
import GameLeaveGuardModal from "@/components/GameLeaveGuardModal";
import { useGameLeaveGuard } from "@/hooks/useGameLeaveGuard";
import { useBackgroundResync } from "@/hooks/useBackgroundResync";
import { useActiveRoomListing } from "@/games/shared/room/useActiveRoomListing";
import { withUniqueNames } from "@/games/shared/room/uniqueNames";
import { trackGameEvent } from "@/lib/analytics/gameEvents";
import RoomNicknameField, { type RoomIdentityValue } from "@/components/identity/RoomNicknameField";
import { BotTakeoverSelfBanner, BotTakeoverVoteModal } from "@/components/lobby/BotTakeoverVoteModal";
import { activeVoteFor, INITIAL_BOT_TAKEOVER_STATE, isSeatTakenOver, reduceBotTakeover, voteThresholdMet, voteYesCount, type BotTakeoverEvent, type BotTakeoverState } from "@/games/shared/bot/botTakeover";
import type { EraMarchState, Side } from "./engine";
import { OnlineDriver, type Batch } from "./online";
import EraMarchBoard, { type MatchSummary } from "./EraMarchBoard";
import { unlockAudio } from "./eraMarchAudio";

/**
 * 시대의 진격 online room (1:1). Channel `era-march-room-<code>`; the creator
 * sits on side 0 (blue), the joiner on side 1 (red). The match itself is the
 * command replay in online.ts: the authority (host, or the guest once the
 * host's seat is taken over) broadcasts `batch`es, everyone else replays them.
 *
 * Messages: `game-start {seed, authority}` · `input {side, cmd}` → authority ·
 * `batch` → followers · `state-request` / `state-sync {state, botTakeover,
 * authority, names}` for joins and reconnects · `bot-takeover-event` (the
 * shared vote flow; a converted seat is played by the authority's bot).
 */

type Occupant = { deviceId: string; seat: number; name: string; playerId?: string; isHost?: boolean };
type Phase = "enter-name" | "connecting" | "waiting" | "playing" | "post-game" | "room-full" | "supabase-missing" | "channel-error";

const GAME_ID = "era-march";
const PING_MS = 5000;
const IDLE_VOTE_MS = 45_000;

const seatKey = (code: string) => `era-march-seat-${code}`;
function storedSeat(code: string): number | null {
  try {
    const v = window.localStorage.getItem(seatKey(code));
    return v === null ? null : Number(v);
  } catch {
    return null;
  }
}
function storeSeat(code: string, seat: number) {
  try {
    window.localStorage.setItem(seatKey(code), String(seat));
  } catch {}
}

export interface OnlineResult {
  summary: MatchSummary;
  opponent: string;
  /** A bot played my seat at the end. */
  botPlayed: boolean;
  /** A bot played the other seat at some point. */
  withBots: boolean;
}

export default function EraMarchOnline({ intent, initialCode, reduceShake, onExit, onResult, onRules }: { intent: "create" | "join"; initialCode?: string; reduceShake: boolean; onExit: () => void; onResult: (r: OnlineResult) => void; onRules: () => void }) {
  const isHost = intent === "create";
  const [phase, setPhase] = useState<Phase>("enter-name");
  const [identity, setIdentity] = useState<RoomIdentityValue>(() => ({ name: getVisitorNickname() || "" }));
  const [codeInput, setCodeInput] = useState(initialCode ?? "");
  const [formError, setFormError] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [myName, setMyName] = useState("");
  const [myPlayerId, setMyPlayerId] = useState<string | undefined>(undefined);
  const [mySeat, setMySeat] = useState<number | null>(null);
  const [occupants, setOccupants] = useState<Occupant[]>([]);
  const [driver, setDriver] = useState<OnlineDriver | null>(null);
  const [matchKey, setMatchKey] = useState(0);
  const [result, setResult] = useState<MatchSummary | null>(null);
  const [botTakeover, setBotTakeover] = useState<BotTakeoverState>(INITIAL_BOT_TAKEOVER_STATE);
  const [dismissedVote, setDismissedVote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const driverRef = useRef<OnlineDriver | null>(null);
  const phaseRef = useRef<Phase>(phase);
  const occupantsRef = useRef<Occupant[]>([]);
  const mySeatRef = useRef<number | null>(null);
  const takeoverRef = useRef<BotTakeoverState>(INITIAL_BOT_TAKEOVER_STATE);
  const lastInputRef = useRef<Record<number, number>>({});
  const startedAtRef = useRef(0);
  const startSentRef = useRef(false);
  const hadBotRef = useRef(false);
  const deviceId = typeof window !== "undefined" ? getDeviceId() : "";

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    occupantsRef.current = occupants;
  }, [occupants]);
  useEffect(() => {
    mySeatRef.current = mySeat;
  }, [mySeat]);

  const nameOf = (seat: number) => occupantsRef.current.find((o) => o.seat === seat)?.name ?? (seat === 0 ? "방장" : "도전자");
  const namesNow = (): [string, string] => [nameOf(0), nameOf(1)];

  function applyTakeover(event: BotTakeoverEvent) {
    const next = reduceBotTakeover(takeoverRef.current, event);
    takeoverRef.current = next;
    setBotTakeover(next);
    const d = driverRef.current;
    if (!d) return;
    if (event.type === "convert") {
      const seat = Number(event.seatKey) as Side;
      hadBotRef.current = true;
      // the authority left → whoever is still here carries on with its own state
      if (!d.authority && seat !== d.mySide) d.becomeAuthority();
      if (d.authority) d.setBot(seat, true);
    } else if (event.type === "reclaim") {
      d.setBot(Number(event.seatKey) as Side, false);
    }
  }

  function makeDriver(seat: number, seed: number, authoritySeat: number, names: [string, string]) {
    const ch = channelRef.current;
    const d = new OnlineDriver(seat as Side, seed, seat === authoritySeat, names, (event, payload) => {
      ch?.send({ type: "broadcast", event, payload });
    });
    for (const k of Object.keys(takeoverRef.current.takeovers)) if (d.authority) d.setBot(Number(k) as Side, true);
    driverRef.current = d;
    setDriver(d);
    setMatchKey((k) => k + 1);
    return d;
  }

  function requestState() {
    const ch = channelRef.current;
    if (!ch) return;
    if (ch.state !== "joined") ch.subscribe();
    ch.send({ type: "broadcast", event: "state-request", payload: {} });
  }

  function enter() {
    setFormError(null);
    if (!getSupabase()) {
      setPhase("supabase-missing");
      return;
    }
    const code = isHost ? String(Math.floor(1000 + Math.random() * 9000)) : codeInput.trim();
    if (!isHost && !/^\d{4}$/.test(code)) {
      setFormError("4자리 초대 코드를 정확히 입력하세요.");
      return;
    }
    unlockAudio();
    setMyName(identity.name.trim() || "플레이어");
    setMyPlayerId(identity.name.trim() ? identity.playerId : undefined);
    setRoomCode(code);
    setPhase("connecting");
    if (isHost) window.history.replaceState(null, "", `${window.location.pathname}?room=${code}`);
  }

  /* ── channel ──────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!roomCode) return;
    const supabase = getSupabase();
    if (!supabase) return;
    const channel = supabase.channel(`era-march-room-${roomCode}`, { config: { broadcast: { self: false }, presence: { key: deviceId } } });
    channelRef.current = channel;
    startSentRef.current = false;

    channel.on("broadcast", { event: "game-start" }, ({ payload }) => {
      const seat = mySeatRef.current;
      if (seat === null || seat > 1) return;
      startMatch(seat, Number(payload?.seed) | 0, Number(payload?.authority) | 0);
    });
    channel.on("broadcast", { event: "input" }, ({ payload }) => {
      const side = Number(payload?.side);
      if (side !== 0 && side !== 1) return;
      lastInputRef.current[side] = Date.now();
      if (payload?.cmd) driverRef.current?.onInput(side as Side, payload.cmd);
    });
    channel.on("broadcast", { event: "batch" }, ({ payload }) => {
      driverRef.current?.onBatch(payload as Batch);
    });
    channel.on("broadcast", { event: "state-request" }, () => {
      const d = driverRef.current;
      if (!d?.authority) return;
      channel.send({ type: "broadcast", event: "state-sync", payload: { state: d.snapshot(), botTakeover: takeoverRef.current, authority: d.mySide, names: d.names } });
    });
    channel.on("broadcast", { event: "state-sync" }, ({ payload }) => {
      const state = payload?.state as EraMarchState | undefined;
      const seat = mySeatRef.current;
      if (!state || seat === null || seat > 1) return;
      const take = (payload?.botTakeover as BotTakeoverState | undefined) ?? INITIAL_BOT_TAKEOVER_STATE;
      takeoverRef.current = take;
      setBotTakeover(take);
      let d = driverRef.current;
      if (d?.authority) return; // only the authority sends these; never demote ourselves
      if (!d) d = makeDriver(seat, 1, Number(payload?.authority) | 0, (payload?.names as [string, string]) ?? namesNow());
      d.onSync(state);
      setResult(null);
      setPhase("playing");
    });
    channel.on("broadcast", { event: "bot-takeover-event" }, ({ payload }) => {
      const event = payload?.event as BotTakeoverEvent | undefined;
      if (!event) return;
      applyTakeover(event);
      if (event.type !== "vote-cast") return;
      const vote = takeoverRef.current.votes[event.seatKey];
      if (!vote) return;
      const taken = new Set(Object.keys(takeoverRef.current.takeovers).map(Number));
      const eligible = occupantsRef.current.filter((o) => o.seat !== Number(event.seatKey) && !taken.has(o.seat)).length;
      if (voteThresholdMet(voteYesCount(takeoverRef.current, event.seatKey), eligible)) {
        const convert: BotTakeoverEvent = { type: "convert", seatKey: event.seatKey, at: Date.now() };
        channel.send({ type: "broadcast", event: "bot-takeover-event", payload: { event: convert } });
        applyTakeover(convert);
      }
    });
    channel.on("presence", { event: "leave" }, ({ leftPresences }) => {
      if (phaseRef.current !== "playing") return;
      for (const p of leftPresences as unknown as Occupant[]) {
        const key = String(p.seat);
        if (p.seat > 1 || activeVoteFor(takeoverRef.current, key) || isSeatTakenOver(takeoverRef.current, key)) continue;
        sendTakeover({ type: "vote-start", seatKey: key, reason: "disconnected", startedAt: Date.now(), originalUserId: p.playerId ?? `${roomCode}:${p.seat}`, originalName: p.name });
      }
    });
    let resolveFirst = () => {};
    const firstSync = new Promise<void>((r) => (resolveFirst = r));
    channel.on("presence", { event: "sync" }, () => {
      const raw = channel.presenceState() as RealtimePresenceState<Occupant>;
      setOccupants(withUniqueNames(Object.values(raw).flat()));
      resolveFirst();
    });
    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await Promise.race([firstSync, new Promise((r) => setTimeout(r, 800))]);
        let seat = storedSeat(roomCode);
        const existing = Object.values(channel.presenceState() as RealtimePresenceState<Occupant>).flat();
        if (seat === null || existing.some((o) => o.seat === seat && o.deviceId !== deviceId)) {
          const taken = new Set(existing.filter((o) => o.deviceId !== deviceId).map((o) => o.seat));
          seat = 0;
          while (taken.has(seat)) seat++;
          if (seat > 1) {
            setPhase("room-full");
            return;
          }
          storeSeat(roomCode, seat);
        }
        setMySeat(seat);
        mySeatRef.current = seat;
        await channel.track({ deviceId, seat, name: myName, playerId: myPlayerId, isHost } satisfies Occupant);
        requestState();
        setPhase((p) => (p === "connecting" ? "waiting" : p));
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        setPhase("channel-error");
      }
    });
    return () => {
      supabase.removeChannel(channel);
      if (channelRef.current === channel) channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode, myName, myPlayerId, isHost]);

  function sendTakeover(event: BotTakeoverEvent) {
    channelRef.current?.send({ type: "broadcast", event: "bot-takeover-event", payload: { event } });
    applyTakeover(event);
  }

  function startMatch(seat: number, seed: number, authority: number) {
    takeoverRef.current = INITIAL_BOT_TAKEOVER_STATE;
    setBotTakeover(INITIAL_BOT_TAKEOVER_STATE);
    hadBotRef.current = false;
    lastInputRef.current = {};
    startedAtRef.current = Date.now();
    makeDriver(seat, seed, authority, namesNow());
    setResult(null);
    setPhase("playing");
  }

  function sendStart() {
    const seat = mySeatRef.current;
    if (seat === null) return;
    startSentRef.current = true;
    const seed = Math.floor(Math.random() * 2_000_000_000);
    channelRef.current?.send({ type: "broadcast", event: "game-start", payload: { seed, authority: seat } });
    startMatch(seat, seed, seat);
  }

  // host: start as soon as both seats are filled
  useEffect(() => {
    if (phase !== "waiting" || !isHost || startSentRef.current || mySeat === null) return;
    if (occupants.filter((o) => o.seat <= 1).length >= 2) sendStart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [occupants, phase, isHost, mySeat]);

  // a joiner keeps asking for the state until a match shows up (host may still be voting someone out)
  useEffect(() => {
    if (phase !== "waiting" || isHost) return;
    const id = window.setInterval(requestState, 3000);
    return () => window.clearInterval(id);
  }, [phase, isHost]);

  // heartbeat + idle takeover trigger
  useEffect(() => {
    if (phase !== "playing" || !roomCode) return;
    const id = window.setInterval(() => {
      const seat = mySeatRef.current;
      if (seat !== null && document.visibilityState === "visible") channelRef.current?.send({ type: "broadcast", event: "input", payload: { side: seat, cmd: null } });
      for (const occ of occupantsRef.current) {
        if (occ.seat > 1 || occ.seat === seat) continue;
        const key = String(occ.seat);
        if (activeVoteFor(takeoverRef.current, key) || isSeatTakenOver(takeoverRef.current, key)) continue;
        const lastAt = lastInputRef.current[occ.seat] ?? startedAtRef.current;
        if (Date.now() - lastAt < IDLE_VOTE_MS) continue;
        sendTakeover({ type: "vote-start", seatKey: key, reason: "idle", startedAt: Date.now(), originalUserId: occ.playerId ?? `${roomCode}:${occ.seat}`, originalName: occ.name });
      }
    }, PING_MS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, roomCode]);

  function leave() {
    if (channelRef.current) getSupabase()?.removeChannel(channelRef.current);
    channelRef.current = null;
    driverRef.current = null;
    window.history.replaceState(null, "", window.location.pathname);
    onExit();
  }

  const { exitConfirmOpen, cancelExit, confirmExit } = useGameLeaveGuard(roomCode !== null && phase === "playing", leave);
  useBackgroundResync(roomCode !== null && phase === "playing" && !driver?.authority, requestState);
  useActiveRoomListing({
    gameId: GAME_ID,
    roomCode,
    isHost,
    isWaiting: phase === "waiting",
    isPlaying: phase === "playing",
    hostName: myName,
    playerCount: occupants.length,
    occupants,
    maxPlayers: 2,
  });

  const shareUrl = typeof window !== "undefined" && roomCode ? `${window.location.origin}${window.location.pathname}?room=${roomCode}` : "";
  const panel = "flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-white light:border-slate-200 light:bg-white light:text-slate-800 light:shadow-sm";
  const guard = <GameLeaveGuardModal open={exitConfirmOpen} onCancel={cancelExit} onConfirm={confirmExit} />;

  if (phase === "supabase-missing" || phase === "room-full" || phase === "channel-error") {
    const msg = { "supabase-missing": ["⚠️", "온라인 대전을 사용할 수 없어요 (Supabase 설정 필요)"], "room-full": ["🚫", "이미 두 명이 들어간 방이에요"], "channel-error": ["📡", "연결에 실패했습니다"] }[phase];
    return (
      <div className={`${panel} items-center text-center`}>
        <span className="text-3xl">{msg[0]}</span>
        <p className="font-bold">{msg[1]}</p>
        <button onClick={leave} className="rounded-full bg-orange-600 px-5 py-2 text-sm font-semibold text-white">처음으로</button>
      </div>
    );
  }

  if (phase === "enter-name") {
    return (
      <div className={panel}>
        <h2 className="text-base font-bold">{isHost ? "🌐 온라인 방 만들기" : "🔑 초대 코드로 참여"}</h2>
        <div className="flex flex-col gap-1.5 text-sm opacity-90">
          내 닉네임
          <RoomNicknameField value={identity} onChange={setIdentity} onEnter={enter} accent="amber" />
        </div>
        {!isHost && (
          <label className="flex flex-col gap-1.5 text-sm opacity-90">
            초대 코드 (4자리)
            <input
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value.replace(/\D/g, "").slice(0, 4))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) enter();
              }}
              placeholder="0000"
              inputMode="numeric"
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-center text-lg font-semibold tracking-[0.3em] focus:border-amber-400 focus:outline-none light:border-slate-300 light:bg-white"
            />
          </label>
        )}
        {formError && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{formError}</p>}
        <div className="flex gap-2">
          <button onClick={leave} className="flex-1 rounded-xl border border-white/15 py-2.5 text-sm light:border-slate-300">뒤로</button>
          <button onClick={enter} className="flex-1 rounded-xl bg-orange-600 py-2.5 text-sm font-semibold text-white">{isHost ? "방 만들기" : "참여하기"}</button>
        </div>
      </div>
    );
  }

  if (phase === "connecting" || phase === "waiting" || !driver) {
    return (
      <div className={`${panel} items-center text-center`}>
        {phase === "connecting" ? (
          <p className="text-sm opacity-60">연결하는 중...</p>
        ) : (
          <>
            <div className="text-xs font-bold tracking-widest text-amber-300">초대 코드</div>
            <div className="text-5xl font-black tracking-[0.3em]">{roomCode}</div>
            {isHost && (
              <button
                onClick={() => {
                  void navigator.clipboard?.writeText(shareUrl);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="rounded-lg bg-white/10 px-3 py-1.5 text-sm font-bold light:bg-slate-100"
              >
                {copied ? "✅ 복사됨" : "🔗 초대 링크 복사"}
              </button>
            )}
            <div className="grid w-full max-w-sm grid-cols-2 gap-2 text-sm">
              {[0, 1].map((seat) => {
                const o = occupants.find((x) => x.seat === seat);
                return (
                  <div key={seat} className="rounded-xl border border-white/10 p-3 light:border-slate-200" style={{ borderColor: o ? (seat === 0 ? "#3b82f6" : "#ef4444") : undefined }}>
                    <div className="text-[11px] opacity-60">{seat === 0 ? "🔵 블루 (방장)" : "🔴 레드"}</div>
                    <div className="font-bold">{o ? `${o.name}${seat === mySeat ? " (나)" : ""}` : "기다리는 중…"}</div>
                  </div>
                );
              })}
            </div>
            <p className="text-xs opacity-60">{isHost ? "친구가 들어오면 바로 전투가 시작돼요." : "방장의 게임 시작을 기다리는 중…"}</p>
            <button onClick={leave} className="text-xs underline opacity-60">나가기</button>
          </>
        )}
      </div>
    );
  }

  const seat = mySeat ?? 0;
  const myVote = activeVoteFor(botTakeover, String(seat));
  const takenOver = isSeatTakenOver(botTakeover, String(seat));
  const vote = Object.values(botTakeover.votes).find((v) => v.seatKey !== String(seat) && `${v.seatKey}:${v.startedAt}` !== dismissedVote);
  const taken = new Set(Object.keys(botTakeover.takeovers).map(Number));
  const canRematch = driver.authority && occupants.filter((o) => o.seat <= 1).length >= 2;

  return (
    <>
      <EraMarchBoard
        key={matchKey}
        driver={driver}
        reduceShake={reduceShake}
        subtitle={`vs ${driver.names[seat === 0 ? 1 : 0]} · 온라인 대전`}
        onQuit={leave}
        onRules={onRules}
        onEnd={(m) => {
          setResult(m);
          setPhase("post-game");
          trackGameEvent(GAME_ID, "game_end", { roomCode, isHost });
          onResult({ summary: m, opponent: driver.names[seat === 0 ? 1 : 0], botPlayed: isSeatTakenOver(takeoverRef.current, String(seat)), withBots: hadBotRef.current });
        }}
      >
        <div className="absolute inset-x-0 top-[124px] z-20 flex flex-col items-center gap-2 px-3">
          {myVote && <BotTakeoverSelfBanner mode="prove-presence" onConfirm={() => sendTakeover({ type: "vote-cancel", seatKey: String(seat) })} />}
          {!myVote && takenOver && <BotTakeoverSelfBanner mode="reclaim" onConfirm={() => sendTakeover({ type: "reclaim", seatKey: String(seat) })} />}
        </div>
        {vote && (
          <BotTakeoverVoteModal
            targetName={driver.names[Number(vote.seatKey)] ?? vote.originalName}
            reason={vote.reason}
            yesCount={vote.yesVoterDeviceIds.length}
            eligibleVoterCount={occupants.filter((o) => o.seat !== Number(vote.seatKey) && !taken.has(o.seat)).length}
            hasVoted={vote.yesVoterDeviceIds.includes(deviceId)}
            onVoteYes={() => {
              const ev: BotTakeoverEvent = { type: "vote-cast", seatKey: vote.seatKey, voterDeviceId: deviceId };
              channelRef.current?.send({ type: "broadcast", event: "bot-takeover-event", payload: { event: ev } });
              applyTakeover(ev);
              const v = takeoverRef.current.votes[vote.seatKey];
              const eligible = occupantsRef.current.filter((o) => o.seat !== Number(vote.seatKey) && !taken.has(o.seat)).length;
              if (v && voteThresholdMet(voteYesCount(takeoverRef.current, vote.seatKey), eligible)) sendTakeover({ type: "convert", seatKey: vote.seatKey, at: Date.now() });
            }}
            onDismiss={() => setDismissedVote(`${vote.seatKey}:${vote.startedAt}`)}
          />
        )}
      </EraMarchBoard>
      {phase === "post-game" && result && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4 text-white">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-gradient-to-b from-stone-800 to-stone-950 p-5 text-center shadow-2xl">
            <div className="text-5xl">{result.draw ? "🤝" : result.won ? "🏆" : "💥"}</div>
            <div className={`text-3xl font-black ${result.won ? "text-amber-300" : "text-white/80"}`}>{result.draw ? "무승부" : result.won ? "승리!" : "패배"}</div>
            <div className="text-sm text-white/60">vs {driver.names[seat === 0 ? 1 : 0]} · {Math.floor(result.seconds / 60)}분 {result.seconds % 60}초</div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
              <div className="rounded-xl bg-white/5 p-2"><div className="text-[11px] text-white/50">처치</div><div className="text-lg font-black">{result.kills}</div></div>
              <div className="rounded-xl bg-white/5 p-2"><div className="text-[11px] text-white/50">생산</div><div className="text-lg font-black">{result.trained}</div></div>
              <div className="rounded-xl bg-white/5 p-2"><div className="text-[11px] text-white/50">필살기</div><div className="text-lg font-black">{result.specials}</div></div>
            </div>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {canRematch ? (
                <button onClick={sendStart} className="rounded-xl bg-amber-500 px-5 py-2 font-black text-black">재대결</button>
              ) : (
                <span className="rounded-xl bg-white/5 px-4 py-2 text-sm text-white/60">{occupants.filter((o) => o.seat <= 1).length < 2 ? "상대가 나갔어요" : "상대의 재대결을 기다리는 중…"}</span>
              )}
              <button onClick={leave} className="rounded-xl bg-white/10 px-5 py-2 font-bold">나가기</button>
            </div>
          </div>
        </div>
      )}
      {guard}
    </>
  );
}
