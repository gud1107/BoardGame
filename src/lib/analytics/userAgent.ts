export interface DeviceSummary {
  deviceType: "모바일" | "태블릿" | "PC";
  os: string;
  browser: string;
}

/**
 * Coarse, human-readable device summary for the /visitors table — just
 * enough to tell "iPhone Safari" from "Windows Chrome", not a fingerprint.
 * Order matters: in-app browsers and Edge/Samsung/Whale all also contain
 * "Chrome"/"Safari", so the specific tokens are checked first.
 */
export function summarizeUserAgent(ua: string | null | undefined): DeviceSummary {
  const s = ua ?? "";

  const os = /iPhone|iPod/.test(s)
    ? "iOS"
    : /iPad/.test(s)
      ? "iPadOS"
      : /Android/.test(s)
        ? "Android"
        : /Windows/.test(s)
          ? "Windows"
          : /Macintosh|Mac OS X/.test(s)
            ? "macOS"
            : /CrOS/.test(s)
              ? "ChromeOS"
              : /Linux/.test(s)
                ? "Linux"
                : "기타";

  const browser = /KAKAOTALK/i.test(s)
    ? "카카오톡"
    : /NAVER\(inapp/i.test(s)
      ? "네이버앱"
      : /Instagram/.test(s)
        ? "인스타그램"
        : /FBAN|FBAV/.test(s)
          ? "페이스북"
          : /Whale\//.test(s)
            ? "웨일"
            : /SamsungBrowser\//.test(s)
              ? "삼성인터넷"
              : /Edg\//.test(s)
                ? "Edge"
                : /OPR\/|Opera/.test(s)
                  ? "Opera"
                  : /Firefox\/|FxiOS/.test(s)
                    ? "Firefox"
                    : /CriOS|Chrome\//.test(s)
                      ? "Chrome"
                      : /Safari\//.test(s)
                        ? "Safari"
                        : "기타";

  const isTablet = /iPad|Tablet/.test(s) || (/Android/.test(s) && !/Mobile/.test(s));
  const isMobile = !isTablet && /Mobi|iPhone|iPod|Android/.test(s);

  return { deviceType: isTablet ? "태블릿" : isMobile ? "모바일" : "PC", os, browser };
}
