import { describe, expect, it } from "vitest";
import { summarizeThemeRows, type ThemeRow } from "./ThemeTab";

const row = (origin: string, os: string, first: string, now: string, devices: number, changed = 0): ThemeRow => ({
  origin,
  os_scheme: os,
  first_theme: first,
  current_pref: now,
  devices,
  changed,
});

describe("summarizeThemeRows", () => {
  it("splits by first-visit kind and totals into all", () => {
    const s = summarizeThemeRows([
      row("new", "light", "light", "system", 3),
      row("new", "dark", "dark", "system", 5),
      row("new", "light", "light", "dark", 1, 1),
      row("returning", "light", "dark", "dark", 4),
    ]);
    expect(s.new).toMatchObject({ devices: 9, firstLight: 4, osLight: 4, changed: 1 });
    expect(s.new.now).toEqual({ dark: 1, light: 0, system: 8 });
    expect(s.returning).toMatchObject({ devices: 4, firstLight: 0, osLight: 4 });
    expect(s.all).toMatchObject({ devices: 13, firstLight: 4, osLight: 8, changed: 1 });
    expect(s.legacy).toBeUndefined();
  });

  it("accepts bigint-as-string counts from PostgREST", () => {
    const s = summarizeThemeRows([{ ...row("legacy", "?", "light", "light", 0), devices: "2" as unknown as number }]);
    expect(s.legacy.devices).toBe(2);
    expect(s.legacy.now.light).toBe(2);
  });
});
