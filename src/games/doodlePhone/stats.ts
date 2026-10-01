import { pageKey, reactionTotal, votesFor, type DoodlePhoneState, type SeatIndex } from "./engine";

const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();

/**
 * Per-match detail stats from the finished albums (merge rule: `max*` keeps
 * the highest, others sum). exactGuesses = 그림을 보고 쓴 내 답이 그 그림의
 * 원래 문장과 (공백·대소문자 무시) 똑같았던 횟수. reactions/votes are what
 * other players gave my pages.
 */
export function doodlePhoneStatDetails(state: DoodlePhoneState, seat: SeatIndex): Record<string, number> {
  let drawings = 0;
  let texts = 0;
  let autoFilled = 0;
  let exactGuesses = 0;
  let reactions = 0;
  let votes = 0;
  let maxReactionsOnePage = 0;
  state.albums.forEach((album, a) => {
    album.forEach((page, i) => {
      if (!page || page.author !== seat) return;
      const turn = i + 1;
      if (page.auto) autoFilled++;
      else if (page.kind === "drawing") drawings++;
      else texts++;
      if (!page.auto && page.kind === "text" && i >= 2) {
        const source = album[i - 2];
        if (source?.kind === "text" && norm(source.text) === norm(page.text)) exactGuesses++;
      }
      const r = reactionTotal(state.reactions[pageKey(a, turn)]);
      reactions += r;
      maxReactionsOnePage = Math.max(maxReactionsOnePage, r);
      if (state.options.mode === "SCORE") votes += votesFor(state, a, turn);
    });
  });
  return { drawings, texts, autoFilled, exactGuesses, reactionsReceived: reactions, votesReceived: votes, maxReactionsOnePage };
}
