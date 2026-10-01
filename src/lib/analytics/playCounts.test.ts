import { describe, expect, it } from "vitest";
import { isAutomatedClient } from "./playCounts";

const DESKTOP_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const KAKAO_INAPP =
  "Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36 KAKAOTALK 10.8.0";

describe("isAutomatedClient", () => {
  it("counts ordinary browsers", () => {
    for (const ua of [DESKTOP_CHROME, IPHONE_SAFARI, KAKAO_INAPP]) {
      expect(isAutomatedClient(ua, false)).toBe(false);
      expect(isAutomatedClient(ua, undefined)).toBe(false);
    }
  });

  it("excludes Playwright via the webdriver flag even with a normal UA", () => {
    expect(isAutomatedClient(DESKTOP_CHROME, true)).toBe(true);
  });

  it("excludes headless and crawler user agents", () => {
    expect(isAutomatedClient(DESKTOP_CHROME.replace("Chrome/", "HeadlessChrome/"), false)).toBe(true);
    expect(isAutomatedClient("Mozilla/5.0 (compatible; Googlebot/2.1)", false)).toBe(true);
  });
});

import { isClaudeTestClient } from "./playCounts";

describe("isClaudeTestClient", () => {
  it("is Claude's Playwright / headless test browser, not every bot", () => {
    expect(isClaudeTestClient(DESKTOP_CHROME, true)).toBe(true);
    expect(isClaudeTestClient(DESKTOP_CHROME.replace("Chrome/", "HeadlessChrome/"), false)).toBe(true);
    expect(isClaudeTestClient("Mozilla/5.0 (compatible; Googlebot/2.1)", false)).toBe(false);
    expect(isClaudeTestClient(IPHONE_SAFARI, false)).toBe(false);
  });
});
