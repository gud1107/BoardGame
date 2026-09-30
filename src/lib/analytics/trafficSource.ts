/**
 * Where a visit came from, for the /admin/games 유입 경로 tab. In-app
 * browsers are recognised from the User-Agent first (KakaoTalk opens links
 * in its own browser and usually sends no referrer), then the referrer's
 * host decides search vs. another site; no referrer at all is 직접 방문.
 */
export function classifyTrafficSource(userAgent: string | null | undefined, referrer: string | null | undefined): {
  source: string;
  referrerHost: string | null;
} {
  const ua = userAgent ?? "";
  let host: string | null = null;
  try {
    host = referrer ? new URL(referrer).hostname.replace(/^www\./, "") : null;
  } catch {
    host = null;
  }

  if (/KAKAOTALK/i.test(ua)) return { source: "카카오톡", referrerHost: host };
  if (/Instagram/.test(ua)) return { source: "인스타그램", referrerHost: host };
  if (/FBAN|FBAV/.test(ua)) return { source: "페이스북", referrerHost: host };
  if (/NAVER\(inapp/i.test(ua)) return { source: "네이버앱", referrerHost: host };

  if (!host) return { source: "직접 방문", referrerHost: null };
  if (/(^|\.)naver\.com$/.test(host)) return { source: "검색(네이버)", referrerHost: host };
  if (/(^|\.)google\./.test(host)) return { source: "검색(구글)", referrerHost: host };
  if (/(^|\.)daum\.net$|(^|\.)kakao\.com$/.test(host)) return { source: "검색(다음)", referrerHost: host };
  if (/(^|\.)bing\.com$|(^|\.)yahoo\./.test(host)) return { source: "검색(기타)", referrerHost: host };
  if (/(^|\.)instagram\.com$/.test(host)) return { source: "인스타그램", referrerHost: host };
  if (/(^|\.)facebook\.com$/.test(host)) return { source: "페이스북", referrerHost: host };
  if (/(^|\.)(youtube\.com|youtu\.be)$/.test(host)) return { source: "유튜브", referrerHost: host };
  return { source: "외부 링크", referrerHost: host };
}
