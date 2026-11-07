/**
 * Lockstep desync guard — detects when this client's game state has drifted
 * from the host's, and pulls the host's state back in.
 *
 * Why: every lockstep game here has each client replay the same broadcast
 * `EngineAction`s from a shared seed. Two near-simultaneous actions from
 * different seats (Coup's 외화 도입 block window, simultaneous responses) can
 * reach different clients in a different order, and nothing used to notice —
 * the match just kept going with two versions of the truth.
 *
 * Protocol (no server, piggybacks on the game's existing channel):
 *  - Host: once its state has been unchanged for `SETTLE_MS`, broadcasts a
 *    digest of it once (`DESYNC_DIGEST_EVENT`).
 *  - Everyone else: on receipt, compares against its own state — only if its
 *    own state has also been quiet for `QUIET_MS`, so an action that's still
 *    in flight is never mistaken for drift. On mismatch, sends
 *    `state-request` with `{ desync: true }`.
 *  - Only the host answers a `desync` request (`skipSyncAnswer`). Ordinary
 *    reconnect requests are untouched, but a desync request must not be
 *    answered by every client — when states have diverged, "last reply wins"
 *    would leave each client with a different one.
 *  - Safety valve: a game whose state isn't actually deterministic across
 *    clients (some local-only field) would mismatch forever; after
 *    `MAX_RESYNCS` resyncs within `RESYNC_WINDOW_MS` the guard switches itself
 *    off for the rest of the session instead of resetting the board in a loop.
 */
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

export const DESYNC_DIGEST_EVENT = "state-digest";

export const SETTLE_MS = 1500;
export const QUIET_MS = 800;
export const RESYNC_COOLDOWN_MS = 5000;
export const MAX_RESYNCS = 3;
export const RESYNC_WINDOW_MS = 60_000;

/** Key-order-independent JSON of what would actually go over the wire. */
export function canonicalJson(value: unknown): string {
  const plain = JSON.parse(JSON.stringify(value ?? null)) as unknown;
  const walk = (v: unknown): string => {
    if (Array.isArray(v)) return `[${v.map(walk).join(",")}]`;
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      return `{${Object.keys(o)
        .sort()
        .map((k) => `${JSON.stringify(k)}:${walk(o[k])}`)
        .join(",")}}`;
    }
    return JSON.stringify(v);
  };
  return walk(plain);
}

/** Two independent 32-bit FNV-1a passes → 16 hex chars. Not cryptographic; only needs to catch drift. */
export function stateDigest(value: unknown): string {
  const s = canonicalJson(value);
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995) ^ (b >>> 15);
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

export type DigestVerdict = "match" | "skip" | "resync";

/** Pure timing/decision core — the hook below only wires it to React and the channel. */
export class DesyncMonitor {
  private state: unknown = undefined;
  private changedAt = 0;
  private cached: { state: unknown; digest: string } | null = null;
  private sentFor: unknown = undefined;
  private lastResyncAt = -Infinity;
  private resyncs: number[] = [];
  disabled = false;

  noteState(state: unknown, now: number): void {
    if (state === this.state) return;
    this.state = state;
    this.changedAt = now;
  }

  private digestOf(state: unknown): string {
    if (this.cached && this.cached.state === state) return this.cached.digest;
    const digest = stateDigest(state);
    this.cached = { state, digest };
    return digest;
  }

  /** Host side: the digest to broadcast now, or null (not settled yet / already sent for this state). */
  hostTick(now: number): string | null {
    if (this.disabled || this.state == null) return null;
    if (now - this.changedAt < SETTLE_MS) return null;
    if (this.sentFor === this.state) return null;
    this.sentFor = this.state;
    return this.digestOf(this.state);
  }

  /** Non-host side: compare the host's digest with ours. */
  onDigest(hostDigest: unknown, now: number): DigestVerdict {
    if (this.disabled || typeof hostDigest !== "string" || this.state == null) return "skip";
    if (now - this.changedAt < QUIET_MS) return "skip";
    if (this.digestOf(this.state) === hostDigest) return "match";
    if (now - this.lastResyncAt < RESYNC_COOLDOWN_MS) return "skip";
    this.resyncs = this.resyncs.filter((t) => now - t < RESYNC_WINDOW_MS);
    if (this.resyncs.length >= MAX_RESYNCS) {
      this.disabled = true;
      return "skip";
    }
    this.resyncs.push(now);
    this.lastResyncAt = now;
    return "resync";
  }
}

type DesyncGuard = {
  onDigest(payload: unknown): void;
  skipSyncAnswer(payload: unknown): boolean;
};

type ChannelRef = MutableRefObject<RealtimeChannel | null>;

/**
 * Guards are looked up by the game's `channelRef` (a stable `useRef`), so the
 * channel-setup effect can call the two functions below without listing a
 * hook value in its deps or caring where in the component the hook sits.
 */
const guards = new WeakMap<ChannelRef, DesyncGuard>();

/** Wire to `channel.on("broadcast", { event: DESYNC_DIGEST_EVENT }, ({ payload }) => desyncOnDigest(channelRef, payload))`. */
export function desyncOnDigest(channelRef: ChannelRef, payload: unknown): void {
  guards.get(channelRef)?.onDigest(payload);
}

/** First line of the `state-request` handler: true → this client must not answer. */
export function desyncSkipSyncAnswer(channelRef: ChannelRef, payload: unknown): boolean {
  return guards.get(channelRef)?.skipSyncAnswer(payload) ?? false;
}

export function useDesyncGuard(opts: {
  channelRef: MutableRefObject<RealtimeChannel | null>;
  state: unknown;
  isHost: boolean;
  /** Only compare during live play (phase === "playing"). */
  active: boolean;
}): void {
  const { channelRef, state, isHost, active } = opts;
  const [monitor] = useState(() => new DesyncMonitor());
  const flagsRef = useRef({ isHost, active });

  useEffect(() => {
    flagsRef.current = { isHost, active };
  }, [isHost, active]);

  useEffect(() => {
    monitor.noteState(state, Date.now());
  }, [state, monitor]);

  useEffect(() => {
    if (!isHost || !active) return;
    const id = window.setInterval(() => {
      const digest = monitor.hostTick(Date.now());
      if (digest) channelRef.current?.send({ type: "broadcast", event: DESYNC_DIGEST_EVENT, payload: { d: digest } });
    }, 500);
    return () => window.clearInterval(id);
  }, [isHost, active, channelRef, monitor]);

  const guard = useMemo<DesyncGuard>(
    () => ({
      onDigest(payload) {
        const { isHost: host, active: live } = flagsRef.current;
        if (host || !live) return;
        const verdict = monitor.onDigest((payload as { d?: unknown } | null)?.d, Date.now());
        if (verdict !== "resync") return;
        console.warn("[desync] state differs from the host's — resyncing");
        channelRef.current?.send({ type: "broadcast", event: "state-request", payload: { desync: true } });
      },
      skipSyncAnswer(payload) {
        return !!(payload as { desync?: unknown } | null)?.desync && !flagsRef.current.isHost;
      },
    }),
    [channelRef, monitor],
  );

  useEffect(() => {
    guards.set(channelRef, guard);
    return () => {
      if (guards.get(channelRef) === guard) guards.delete(channelRef);
    };
  }, [channelRef, guard]);
}
