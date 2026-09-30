import { describe, expect, it } from "vitest";
import { summarizeUserAgent } from "./userAgent";

describe("summarizeUserAgent", () => {
  it.each([
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      { deviceType: "모바일", os: "iOS", browser: "Safari" },
    ],
    [
      "Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36 KAKAOTALK 10.8.0",
      { deviceType: "모바일", os: "Android", browser: "카카오톡" },
    ],
    [
      "Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36",
      { deviceType: "모바일", os: "Android", browser: "삼성인터넷" },
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
      { deviceType: "PC", os: "Windows", browser: "Edge" },
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
      { deviceType: "PC", os: "macOS", browser: "Chrome" },
    ],
    [
      "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
      { deviceType: "태블릿", os: "Android", browser: "Chrome" },
    ],
  ])("%s", (ua, expected) => {
    expect(summarizeUserAgent(ua)).toEqual(expected);
  });

  it("handles a missing UA", () => {
    expect(summarizeUserAgent(null)).toEqual({ deviceType: "PC", os: "기타", browser: "기타" });
  });
});
