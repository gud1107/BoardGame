import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Sign-in scenarios end to end through the real store: a fake auth client,
 * one shared localStorage, and each "tab" a freshly imported module (its own
 * zustand store), wired together by `storage` events and a FIFO Web Lock.
 */

type Listener = (e: { key: string | null }) => void;

function browser() {
  const data = new Map<string, string>();
  const tabs: Listener[][] = [];
  let lockTail: Promise<unknown> = Promise.resolve();
  return {
    data,
    newTab() {
      const listeners: Listener[] = [];
      tabs.push(listeners);
      const localStorage = {
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => {
          data.set(k, v);
          for (const other of tabs) if (other !== listeners) other.forEach((l) => l({ key: k }));
        },
        removeItem: (k: string) => {
          data.delete(k);
          for (const other of tabs) if (other !== listeners) other.forEach((l) => l({ key: k }));
        },
      };
      const window = { localStorage, addEventListener: (type: string, l: Listener) => type === "storage" && listeners.push(l) };
      const navigator = {
        locks: {
          request: (_: string, fn: () => Promise<void>) => {
            const run = lockTail.then(fn);
            lockTail = run.catch(() => {});
            return run;
          },
        },
      };
      return { window, navigator };
    },
  };
}

function fakeAuth() {
  const auth = {
    user: null as null | { user_metadata: Record<string, unknown> },
    authListeners: [] as ((event: string) => void)[],
    client: {
      auth: {
        getUser: async () => ({ data: { user: auth.user && { user_metadata: { ...auth.user.user_metadata } } } }),
        updateUser: async ({ data }: { data: Record<string, unknown> }) => {
          if (!auth.user) return { error: new Error("signed out") };
          auth.user.user_metadata = { ...auth.user.user_metadata, ...data };
          return { error: null };
        },
        onAuthStateChange: (cb: (event: string) => void) => {
          auth.authListeners.push(cb);
          return { data: { subscription: { unsubscribe() {} } } };
        },
      },
    },
    signIn(meta: Record<string, unknown>) {
      auth.user = { user_metadata: meta };
      auth.authListeners.forEach((cb) => cb("SIGNED_IN"));
    },
  };
  return auth;
}

/** Imports a fresh copy of the store as a tab of `b`, with `globalThis` pointing at that tab. */
async function openTab(b: ReturnType<typeof browser>, auth: ReturnType<typeof fakeAuth>) {
  const tab = b.newTab();
  vi.stubGlobal("window", tab.window);
  vi.stubGlobal("navigator", tab.navigator);
  vi.resetModules();
  vi.doMock("@/lib/supabase/authClient", () => ({ getAuthSupabase: () => auth.client }));
  const mod = await import("./myCharacter");
  await mod.useMyCharacter.getState().init();
  /** Runs `fn` as this tab (the store reads `window` at call time). */
  const act = (fn: () => void) => {
    vi.stubGlobal("window", tab.window);
    vi.stubGlobal("navigator", tab.navigator);
    fn();
  };
  return { ...mod, act };
}

const settle = () => new Promise((r) => setTimeout(r, 20));
const looks = (n: number) => Array.from({ length: n }, (_, i) => ({ model: "vroid-d", iris: `#00000${i}` }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock("@/lib/supabase/authClient");
});

describe("signing in after editing as a guest (store scenario)", () => {
  it("the guest look survives sign-in and a reload; the account's old look is kept", async () => {
    const b = browser();
    const auth = fakeAuth();
    const tab = await openTab(b, auth);
    tab.useMyCharacter.getState().set({ model: "vroid-e" });
    await settle();
    auth.signIn({ character: { v: 1, look: { model: "vroid-d" } } });
    await settle();

    // reload: a brand-new store reading localStorage + the account
    const reloaded = await openTab(b, auth);
    await settle();
    const s = reloaded.useMyCharacter.getState();
    expect(s.character).toMatchObject({ model: "vroid-e" });
    expect(s.saved.map((x) => x.name)).toEqual([reloaded.PREVIOUS_ACCOUNT_LOOK]);
    expect(auth.user!.user_metadata.character).toMatchObject({ look: { model: "vroid-e" } });
  });

  it("two tabs saving as guests, then signing in in one: the account gets both", async () => {
    const b = browser();
    const auth = fakeAuth();
    const a = await openTab(b, auth);
    const c = await openTab(b, auth);
    a.act(() => a.useMyCharacter.getState().saveLook("탭A", { model: "vroid-d" }));
    await settle();
    c.act(() => c.useMyCharacter.getState().saveLook("탭C", { model: "vroid-e" }));
    await settle();
    auth.signIn({ savedCharacters: [{ id: "acc1", name: "계정", look: { model: "vroid-g" } }] });
    await settle();
    const names = (auth.user!.user_metadata.savedCharacters as { name: string }[]).map((x) => x.name);
    expect(names).toEqual(["계정", "탭A", "탭C"]);
    expect(a.useMyCharacter.getState().saved.map((x) => x.name)).toEqual(names);
    expect(c.useMyCharacter.getState().saved.map((x) => x.name)).toEqual(names);
  });

  it("a full list parks the account's old look; deleting one moves it in", async () => {
    const b = browser();
    const auth = fakeAuth();
    const full = looks(8).map((look, i) => ({ id: `s${i}`, name: `n${i}`, look }));
    const tab = await openTab(b, auth);
    tab.useMyCharacter.getState().set({ model: "vroid-e" });
    await settle();
    auth.signIn({ character: { v: 1, look: { model: "vroid-g" } }, savedCharacters: full });
    await settle();
    let s = tab.useMyCharacter.getState();
    expect(s.saved).toHaveLength(8);
    expect(s.parked).toMatchObject({ model: "vroid-g" });
    expect(auth.user!.user_metadata.parkedCharacter).toMatchObject({ look: { model: "vroid-g" } });

    s.removeSaved("s0");
    await settle();
    s = tab.useMyCharacter.getState();
    expect(s.parked).toBeNull();
    expect(s.saved.at(-1)).toMatchObject({ name: tab.PREVIOUS_ACCOUNT_LOOK, look: { model: "vroid-g" } });
    expect(auth.user!.user_metadata.parkedCharacter).toBeNull();
  });
});
