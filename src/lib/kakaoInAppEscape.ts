/**
 * KakaoTalk's in-app browser pins its own back/forward/reload toolbar to the
 * bottom of the screen, eating game space — and a web page cannot hide it
 * (the Fullscreen API is ignored there too). So when the page is opened
 * inside KakaoTalk, hand the current URL (incl. `?room=` etc.) to the phone's
 * default browser via Kakao's `openExternal` scheme.
 *
 * Runs as an inline <head> script so the jump happens before hydration.
 * `?inapp=1` opts out (debugging / if a user really wants to stay in Kakao).
 */
export const KAKAO_INAPP_ESCAPE_SCRIPT = `
(function () {
  try {
    if (!/KAKAOTALK/i.test(navigator.userAgent)) return;
    if (/[?&]inapp=1(&|$)/.test(location.search)) return;
    location.href =
      "kakaotalk://web/openExternal?url=" + encodeURIComponent(location.href);
  } catch (e) {}
})();
`;
