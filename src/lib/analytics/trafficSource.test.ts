import { describe, expect, it } from "vitest";
import { classifyTrafficSource } from "./trafficSource";

const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const KAKAO =
  "Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36 KAKAOTALK 10.8.0";

describe("classifyTrafficSource", () => {
  it("recognises KakaoTalk's in-app browser even without a referrer", () => {
    expect(classifyTrafficSource(KAKAO, "")).toEqual({ source: "카카오톡", referrerHost: null });
  });

  it("splits search engines, other sites and direct visits", () => {
    expect(classifyTrafficSource(CHROME, "https://search.naver.com/search.naver?q=x").source).toBe("검색(네이버)");
    expect(classifyTrafficSource(CHROME, "https://www.google.com/").source).toBe("검색(구글)");
    expect(classifyTrafficSource(CHROME, "https://blog.example.com/post")).toEqual({
      source: "외부 링크",
      referrerHost: "blog.example.com",
    });
    expect(classifyTrafficSource(CHROME, "")).toEqual({ source: "직접 방문", referrerHost: null });
  });

  it("survives a malformed referrer", () => {
    expect(classifyTrafficSource(CHROME, "not a url").source).toBe("직접 방문");
  });
});
