/**
 * ♟️ 체스 N수 메이트 puzzles. Every position is White to move; MyosuDojo.test.ts
 * proves each has a forced mate in exactly `n`, no shorter one, and a single
 * key (first) move. Mate-in-1s are classic patterns composed by hand; the
 * 2- and 3-movers come from a generator that kept unique-key positions with
 * castled-king pawn shelters, then were picked by hand.
 */

export interface ChessPuzzle {
  id: string;
  title: string;
  /** Mate in this many White moves. */
  n: number;
  fen: string;
  /** Key move (SAN) — "정답 보기" and tests. */
  key: string;
  hint: string;
}

export const CHESS_PUZZLES: ChessPuzzle[] = [
  { id: "c1", n: 1, title: "뒷줄이 비었다", fen: "6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1", key: "Rd8#", hint: "검은 킹 앞을 자기 폰들이 막고 있어요. 킹이 도망칠 칸이 남아 있나요?" },
  { id: "c2", n: 1, title: "질식", fen: "6rk/6pp/8/6N1/8/8/6PP/6K1 w - - 0 1", key: "Nf7#", hint: "킹이 자기 기물에 갇혀 숨을 못 쉬어요. 그 칸들을 뛰어넘어 공격할 수 있는 기물은?" },
  { id: "c3", n: 1, title: "아라비안", fen: "7k/1R6/5N2/8/8/8/6PP/6K1 w - - 0 1", key: "Rh7#", hint: "나이트가 g8과 h7을 지키고 있어요. 룩이 킹 바로 옆까지 가도 잡히지 않아요." },
  { id: "c4", n: 1, title: "대각선 포대", fen: "6k1/5p1p/6n1/8/8/2Q5/1B3PPP/6K1 w - - 0 1", key: "Qg7#", hint: "퀸 뒤의 비숍이 같은 대각선을 보고 있어요. 퀸이 대각선 끝까지 가면?" },
  { id: "c5", n: 1, title: "엇갈린 두 비숍", fen: "2kr4/p2n4/8/8/5B2/8/4B3/6K1 w - - 0 1", key: "Ba6#", hint: "한 비숍은 이미 b8·c7을 막고 있어요. 다른 비숍이 반대쪽 대각선으로 체크하면?" },
  { id: "c6", n: 1, title: "견장", fen: "3rkr2/pp4pp/8/8/2Q5/8/PP4PP/6K1 w - - 0 1", key: "Qe6#", hint: "킹 양옆을 자기 룩이 어깨처럼 막고 있어요. 앞에서 정면으로 체크하면 도망칠 곳이 없어요." },
  { id: "c7", n: 2, title: "퀸을 바쳐라", fen: "3r3k/6pp/7N/8/2Q5/8/6PP/6K1 w - - 0 1", key: "Qg8+", hint: "가장 강한 기물을 내주는 수부터 생각해 보세요. 룩이 퀸을 잡으면 킹은 어떻게 될까요?" },
  { id: "c8", n: 2, title: "조용한 한 수", fen: "7k/4Q1p1/1R5p/8/8/8/2b2PPP/6K1 w - - 0 1", key: "Rb7", hint: "체크가 아닌 수가 정답이에요. 퀸 혼자서는 g7 폰을 잡을 수 없어요. g7을 함께 노려 줄 기물이 있다면?" },
  { id: "c9", n: 2, title: "끝줄 장악", fen: "2k5/ppp5/8/8/8/2b3Q1/5PPP/B3R1K1 w - - 0 1", key: "Re7", hint: "체크 없이 룩을 7번째 줄로 들여보내면 검은 킹은 뒷줄에 갇혀요. 그다음은 퀸이 8번째 줄로 들어갈 차례예요." },
  { id: "c10", n: 2, title: "비숍 둘의 그물", fen: "6k1/5ppp/7B/1B5p/6b1/8/5PPP/2Q3K1 w - - 0 1", key: "Qg5", hint: "h6 비숍이 이미 g7을 노리고 있어요. 퀸도 g7을 노리게 하면 검은 쪽이 막을 수 있을까요?" },
  { id: "c11", n: 2, title: "나이트 두 마리", fen: "6k1/p4ppp/6p1/2N3N1/8/Q7/4bPPP/6K1 w - - 0 1", key: "Nd7", hint: "f8 칸이 열쇠예요. 나이트가 f8을 지키면 퀸이 그 칸으로 들어갈 수 있어요." },
  { id: "c12", n: 3, title: "f6의 쐐기", fen: "5rk1/5ppp/5P2/8/8/3nQ1P1/3N1P1P/6K1 w - - 0 1", key: "Qg5", hint: "f6 폰이 g7을 지켜 줘요. 퀸이 g7을 노리는 자리로 조용히 가 보세요." },
  { id: "c13", n: 3, title: "f8의 비숍", fen: "5Bk1/5p1p/6p1/3p4/7Q/3r4/PPP5/2K5 w - - 0 1", key: "Qh6", hint: "f8 비숍이 g7을 지키고 있어요. 퀸이 g7에 들어가는 길을 만드세요." },
  { id: "c14", n: 3, title: "일곱 번째 줄", fen: "2k2r2/ppp3Q1/8/8/7R/8/5PPP/6K1 w - - 0 1", key: "Rh7", hint: "룩과 퀸이 7번째 줄에 함께 서면 검은 킹 앞줄이 무너져요." },
  { id: "c15", n: 3, title: "구석으로 몰기", fen: "6k1/1p2Rpp1/4p2p/8/1Q6/5p2/5PPP/N5K1 w - - 0 1", key: "Qf4", hint: "f7 폰이 약점이에요. 퀸과 룩이 동시에 f7을 노리면 검은 쪽이 다 막을 수 있을까요?" },
];

export const CHESS_CHAPTERS = [
  { n: 1, title: "한 수 메이트", emoji: "♙", desc: "단 한 수로 체크메이트" },
  { n: 2, title: "두 수 메이트", emoji: "♘", desc: "상대가 어떻게 막아도 두 수 안에" },
  { n: 3, title: "세 수 메이트", emoji: "♛", desc: "끝까지 버티는 상대를 세 수 안에" },
] as const;
