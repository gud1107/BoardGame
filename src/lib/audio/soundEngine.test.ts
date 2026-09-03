import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSoundEngine } from "./soundEngine";
import { useAudioSettingsStore } from "./audioSettings";

/**
 * Load/gating tests for the SFX polyphony control described in
 * `soundEngine.ts`'s file header ("Polyphony control"): `gate()` is a
 * per-SFX-type cooldown plus a global concurrent-channel cap, not a single
 * shared debounce — and every one-shot SFX method already creates an
 * independent Web Audio node per call, so unlike an `HTMLAudioElement`-reuse
 * design there's no "previous sound hasn't finished" conflict to begin with.
 *
 * These tests exercise the real public API (`playCardFlick`/`playGridSnap`,
 * as called by `GridPokerBoard.tsx`'s `placeAt`) and assert on `gate()`'s
 * return value via a spy, since in this project's node test environment (no
 * `window`/`AudioContext`) the methods return early after the gate check and
 * produce no observable audio side effect.
 *
 * Fake timers drive both the simulated click spacing (`vi.advanceTimersByTime`)
 * and `gate()`'s internal channel-release `setTimeout`s together, so the
 * channel cap behaves the same way it would in real elapsed time — advancing
 * a mocked `performance.now()` alone (without also advancing timers) would
 * let the release callbacks starve and make the channel cap trip early.
 */
describe("soundEngine SFX gate — rapid consecutive playback", () => {
  const engine = getSoundEngine();

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] });
    // Unmute for the duration of the test — the store defaults to fully
    // muted (see audioSettings.ts), which would make every gate() call
    // return false regardless of cooldown timing.
    useAudioSettingsStore.getState().setMasterMuted(false);
    useAudioSettingsStore.getState().setSfxMuted(false);
    // Reset the engine's internal cooldown/channel bookkeeping between
    // tests — it's a module-level singleton (`getSoundEngine()` always
    // returns the same instance), so state from one test would otherwise
    // leak into the next.
    (engine as unknown as { lastPlayedAt: Map<string, number> }).lastPlayedAt = new Map();
    (engine as unknown as { activeChannels: number }).activeChannels = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("plays the same SFX 5 times in a row at 100ms intervals with none dropped", () => {
    const gateSpy = vi.spyOn(engine as unknown as { gate: (key: string, cooldownMs: number) => boolean }, "gate");

    for (let i = 0; i < 5; i++) {
      engine.playCardFlick();
      vi.advanceTimersByTime(100);
    }

    expect(gateSpy).toHaveReturnedTimes(5);
    expect(gateSpy.mock.results.map((r) => r.value)).toEqual([true, true, true, true, true]);
  });

  it("triggers every card-flick + grid-snap pair for 5 rapid Grid Poker placements", () => {
    // Mirrors GridPokerBoard.tsx's placeAt(): a flick immediately, then a
    // snap 90ms later — repeated for 5 placements spaced 150ms apart (a
    // brisk but human clicking pace, faster than the old 80ms gridSnap
    // cooldown would tolerate back-to-back with other SFX noise).
    const gateSpy = vi.spyOn(engine as unknown as { gate: (key: string, cooldownMs: number) => boolean }, "gate");

    for (let i = 0; i < 5; i++) {
      engine.playCardFlick();
      vi.advanceTimersByTime(90);
      engine.playGridSnap();
      vi.advanceTimersByTime(60); // remainder of the 150ms placement spacing
    }

    // 5 placements × (1 flick + 1 snap) = 10 gate() calls, none blocked.
    expect(gateSpy).toHaveReturnedTimes(10);
    expect(gateSpy.mock.results.every((r) => r.value === true)).toBe(true);
  });

  it("still throttles calls faster than the tuned cooldown (gate isn't accidentally disabled)", () => {
    const gateSpy = vi.spyOn(engine as unknown as { gate: (key: string, cooldownMs: number) => boolean }, "gate");

    engine.playCardFlick(); // t=0, allowed
    vi.advanceTimersByTime(10); // well under the 40ms cardFlick cooldown
    engine.playCardFlick(); // t=10, should be blocked

    expect(gateSpy.mock.results.map((r) => r.value)).toEqual([true, false]);
  });
});

/**
 * Gate-key coverage for the 8 new action SFX added in the 2026-08-27(오후)
 * "게임별 세부 액션 SFX 완전 바인딩" 세션(destinyWar39/lasVegas/grid-poker/
 * malDalliJa/dalmuti gap-fill — see HANDOFF.md). Each method must call
 * `gate()` with its own distinct key/cooldown so it isn't accidentally
 * sharing a cooldown bucket with an unrelated SFX, and must actually return
 * (produce a sound) when unmuted and off cooldown, and be blocked by a
 * same-tick repeat.
 */
describe("soundEngine SFX gate — 2026-08-27 신규 세부 액션 SFX", () => {
  const engine = getSoundEngine();

  const NEW_SFX: { name: string; call: () => void }[] = [
    { name: "playDeathCardSting", call: () => engine.playDeathCardSting() },
    { name: "playPredictionWin", call: () => engine.playPredictionWin() },
    { name: "playPredictionLose", call: () => engine.playPredictionLose() },
    { name: "playBillCount", call: () => engine.playBillCount() },
    { name: "playHandFanfare", call: () => engine.playHandFanfare() },
    { name: "playVictoryStamp", call: () => engine.playVictoryStamp() },
    { name: "playRaceDiceClatter", call: () => engine.playRaceDiceClatter() },
    { name: "playPassWhiff", call: () => engine.playPassWhiff() },
    { name: "playRevolutionBell", call: () => engine.playRevolutionBell() },
  ];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] });
    useAudioSettingsStore.getState().setMasterMuted(false);
    useAudioSettingsStore.getState().setSfxMuted(false);
    (engine as unknown as { lastPlayedAt: Map<string, number> }).lastPlayedAt = new Map();
    (engine as unknown as { activeChannels: number }).activeChannels = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each(NEW_SFX)("$name plays once when off cooldown and blocks an immediate repeat", ({ call }) => {
    const gateSpy = vi.spyOn(engine as unknown as { gate: (key: string, cooldownMs: number) => boolean }, "gate");

    call(); // first call — off cooldown, should play
    call(); // immediate repeat — same tick, must be blocked

    expect(gateSpy.mock.results.map((r) => r.value)).toEqual([true, false]);
  });

  it("each new SFX gates on its own distinct key (no accidental cross-throttling)", () => {
    const gateSpy = vi.spyOn(engine as unknown as { gate: (key: string, cooldownMs: number) => boolean }, "gate");

    // Spaced >SFX_CHANNEL_RELEASE_MS (450ms) apart so the *global* concurrent-
    // channel cap (a separate, legitimate mechanism — see file header "Polyphony
    // control") can't itself block a call and produce a false positive here;
    // this test is only about per-SFX-type key collisions, not the channel cap.
    for (const { call } of NEW_SFX) {
      call();
      vi.advanceTimersByTime(500);
    }

    // If any two shared a gate key, a later call would be blocked (return
    // false) purely due to the earlier one's cooldown, despite the spacing above.
    expect(gateSpy.mock.results.every((r) => r.value === true)).toBe(true);
    const keysUsed = gateSpy.mock.calls.map(([key]) => key);
    expect(new Set(keysUsed).size).toBe(keysUsed.length);
  });

  it("respects the shared master mute — no new SFX plays while muted", () => {
    useAudioSettingsStore.getState().setMasterMuted(true);
    const gateSpy = vi.spyOn(engine as unknown as { gate: (key: string, cooldownMs: number) => boolean }, "gate");

    for (const { call } of NEW_SFX) call();

    expect(gateSpy.mock.results.every((r) => r.value === false)).toBe(true);
  });
});

/**
 * 2026-09-03 세션(후속) — 코요테 탈락(하트 0) 데스 이펙트용 신규 SFX 2개
 * (`playCardShatter`/`playEliminationSlam`, HANDOFF.md 참고). 위 블록과 동일한
 * "게이트 통과/즉시 반복 차단/서로 다른 gate 키/뮤트 시 무음" 커버리지.
 */
describe("soundEngine SFX gate — 코요테 탈락 데스 이펙트 SFX", () => {
  const engine = getSoundEngine();

  const DEATH_SFX: { name: string; call: () => void }[] = [
    { name: "playCardShatter", call: () => engine.playCardShatter() },
    { name: "playEliminationSlam", call: () => engine.playEliminationSlam() },
  ];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] });
    useAudioSettingsStore.getState().setMasterMuted(false);
    useAudioSettingsStore.getState().setSfxMuted(false);
    (engine as unknown as { lastPlayedAt: Map<string, number> }).lastPlayedAt = new Map();
    (engine as unknown as { activeChannels: number }).activeChannels = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each(DEATH_SFX)("$name plays once when off cooldown and blocks an immediate repeat", ({ call }) => {
    const gateSpy = vi.spyOn(engine as unknown as { gate: (key: string, cooldownMs: number) => boolean }, "gate");

    call();
    call();

    expect(gateSpy.mock.results.map((r) => r.value)).toEqual([true, false]);
  });

  it("each death SFX gates on its own distinct key (no accidental cross-throttling)", () => {
    const gateSpy = vi.spyOn(engine as unknown as { gate: (key: string, cooldownMs: number) => boolean }, "gate");

    for (const { call } of DEATH_SFX) {
      call();
      vi.advanceTimersByTime(500);
    }

    expect(gateSpy.mock.results.every((r) => r.value === true)).toBe(true);
    const keysUsed = gateSpy.mock.calls.map(([key]) => key);
    expect(new Set(keysUsed).size).toBe(keysUsed.length);
  });

  it("respects the shared master mute — no death SFX plays while muted", () => {
    useAudioSettingsStore.getState().setMasterMuted(true);
    const gateSpy = vi.spyOn(engine as unknown as { gate: (key: string, cooldownMs: number) => boolean }, "gate");

    for (const { call } of DEATH_SFX) call();

    expect(gateSpy.mock.results.every((r) => r.value === false)).toBe(true);
  });
});

/**
 * 2026-09-04 세션 — 달무티 게임 액션 버튼(카드 제출/패스/세금 반환/혁명/평민 교환 등)
 * 클릭 즉시 재생되는 신규 `playUiClickTick`. 위 블록들과 동일한 "게이트 통과/즉시
 * 반복 차단/뮤트 시 무음" 커버리지 — 이 SFX는 1개뿐이라 "서로 다른 gate 키" 테스트는
 * 해당 없음.
 */
describe("soundEngine SFX gate — 달무티 버튼 클릭 틱", () => {
  const engine = getSoundEngine();

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] });
    useAudioSettingsStore.getState().setMasterMuted(false);
    useAudioSettingsStore.getState().setSfxMuted(false);
    (engine as unknown as { lastPlayedAt: Map<string, number> }).lastPlayedAt = new Map();
    (engine as unknown as { activeChannels: number }).activeChannels = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("plays once when off cooldown and blocks an immediate repeat", () => {
    const gateSpy = vi.spyOn(engine as unknown as { gate: (key: string, cooldownMs: number) => boolean }, "gate");

    engine.playUiClickTick();
    engine.playUiClickTick();

    expect(gateSpy.mock.results.map((r) => r.value)).toEqual([true, false]);
  });

  it("allows a fresh tick once its 60ms cooldown has elapsed", () => {
    const gateSpy = vi.spyOn(engine as unknown as { gate: (key: string, cooldownMs: number) => boolean }, "gate");

    engine.playUiClickTick();
    vi.advanceTimersByTime(65);
    engine.playUiClickTick();

    expect(gateSpy.mock.results.map((r) => r.value)).toEqual([true, true]);
  });

  it("respects the shared master mute — no tick plays while muted", () => {
    useAudioSettingsStore.getState().setMasterMuted(true);
    const gateSpy = vi.spyOn(engine as unknown as { gate: (key: string, cooldownMs: number) => boolean }, "gate");

    engine.playUiClickTick();

    expect(gateSpy.mock.results.every((r) => r.value === false)).toBe(true);
  });
});
