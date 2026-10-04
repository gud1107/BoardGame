import { describe, expect, it } from "vitest";
import { botTag } from "./MatchRecordCard";

describe("botTag", () => {
  it("labels the bot filter a match counts under", () => {
    expect(botTag({ withBots: false, botLevel: null })).toBe("👥 이번 판: 사람끼리");
    expect(botTag({ withBots: true, botLevel: 7 })).toBe("🤖 이번 판: Lv.7 봇 포함");
    // Only a takeover bot (no level) at the table.
    expect(botTag({ withBots: true, botLevel: null })).toBe("🤖 이번 판: 봇 포함 (도중 교체)");
  });
});
