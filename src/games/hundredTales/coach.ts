import { tableShift } from "./bot";
import { canStop, curseFine, drawOdds, storyPoints, type Seat, type TalesState } from "./engine";

/**
 * 🧭 백 개의 괴담 coach (rulebook §13) — tells a player how they're doing.
 *
 * It reads only public information (the same `drawOdds` as the 🔰 helper and
 * the bots) and grades each of your decisions against the Lv.10 bot's rule:
 * "draw while the expected change of the story beats the table read".
 *
 *  - `advise`  — before you choose: which button the coach would press and why.
 *  - `judge`   — after you chose: was it a good call, greed, bad luck, too early?
 *  - `standing`— where you are against the leader and how much night is left.
 */

export type Pick = "draw" | "stop" | "close";

export interface Advice {
  pick: Pick;
  /** Expected change of the story minus the table read (> 0 = draw is better). */
  margin: number;
  bust: number;
  curse: number;
  gain: number;
  text: string;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const signed = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(1)}`;

/** Only meaningful once a tale was told this turn (the first one is forced). */
export function advise(s: TalesState, seat: Seat): Advice | null {
  if (s.phase !== "play" || s.seat !== seat || !canStop(s)) return null;
  const o = drawOdds(s, seat);
  const shift = tableShift(s, seat);
  const margin = o.gain - shift;
  const pick: Pick = margin > 0.6 ? "draw" : margin < -0.6 ? "stop" : "close";
  const stake = storyPoints(s.story);
  let text: string;
  if (s.peek) {
    text = o.bust > 0 ? "🪞 다음 이야기가 씌는 귀신이에요 — 멈추세요" : o.curse > 0 ? "🪞 다음 이야기가 마지막 촛불을 꺼요 — 멈추세요" : "🪞 다음 이야기는 안전해요 — 한 장 더!";
  } else if (o.curse > 0) {
    text = `💀 ${pct(o.curse)} 확률로 마지막 촛불을 꺼 저주(−${curseFine(s.scores[seat])}) — ${pick === "draw" ? "그래도 해볼 만해요" : "멈추는 게 좋아요"}`;
  } else if (pick === "draw") {
    text = `👍 한 장 더 추천 — 씌일 확률 ${pct(o.bust)}, 기대 ${signed(o.gain)}점`;
  } else if (pick === "stop") {
    text = `🛑 멈출 때 — 걸린 ${stake}점을 잃을 확률 ${pct(o.bust)}`;
  } else {
    text = `⚖️ 반반 — 씌일 확률 ${pct(o.bust)}, 기대 ${signed(o.gain)}점. 취향대로!`;
  }
  if (!s.peek && Math.abs(shift) >= 0.5) text += shift > 0 ? " · 1위라 지키는 쪽이 유리" : " · 뒤처져서 조금 더 과감하게";
  return { pick, margin, bust: o.bust, curse: o.curse, gain: o.gain, text };
}

export type Grade = "good" | "ok" | "early" | "greedy" | "unlucky" | "bold" | "timeout";

export interface Verdict {
  grade: Grade;
  text: string;
  /** Counts as a decision the coach agrees with. */
  agreed: boolean;
}

export const GRADE_STYLE: Record<Grade, { icon: string; label: string }> = {
  good: { icon: "👍", label: "좋은 판단" },
  ok: { icon: "🙂", label: "무난" },
  early: { icon: "🤏", label: "이른 멈춤" },
  greedy: { icon: "😈", label: "욕심" },
  unlucky: { icon: "🍀", label: "불운" },
  bold: { icon: "🎲", label: "대담" },
  timeout: { icon: "⏰", label: "시간 초과" },
};

/**
 * Grade the decision that turned `prev` into `next` for `seat`. Null when it
 * wasn't that seat's choice (other players, or the forced first tale that
 * didn't go wrong).
 */
export function judge(prev: TalesState, next: TalesState, seat: Seat): Verdict | null {
  const ev = next.lastEvent;
  if (!ev || ev === prev.lastEvent || ev.seat !== seat || prev.seat !== seat || prev.phase !== "play") return null;
  if (ev.act === "stop" && ev.auto) return { grade: "timeout", text: "⏰ 시간 초과로 자동 멈춤 — 25초 안에 골라야 해요", agreed: false };
  const a = advise(prev, seat);
  if (!a) {
    // the forced first tale: nothing to grade unless it was the curse
    if (ev.act === "curse") return { grade: "unlucky", text: "🍀 첫 이야기는 꼭 해야 하니 어쩔 수 없었어요", agreed: true };
    return null;
  }
  if (ev.act === "stop") {
    if (a.pick === "draw") return { grade: "early", text: `🤏 조금 이른 멈춤 — 한 장 더 기대 ${signed(a.gain)}점 (씌일 ${pct(a.bust)})`, agreed: false };
    if (a.pick === "stop") return { grade: "good", text: `👍 좋은 멈춤 — 잃을 확률 ${pct(a.bust)}에서 +${ev.gained}점 지켰어요`, agreed: true };
    return { grade: "ok", text: `🙂 무난한 멈춤 — +${ev.gained}점`, agreed: true };
  }
  if (ev.act === "bust" || ev.act === "curse") {
    const risk = ev.act === "curse" ? a.curse : a.bust;
    if (a.pick === "stop") return { grade: "greedy", text: `😈 욕심이었어요 — ${ev.act === "curse" ? "저주" : "씌일"} 확률 ${pct(risk)}에서 한 장 더`, agreed: false };
    return { grade: "unlucky", text: `🍀 운이 나빴어요 — ${ev.act === "curse" ? "저주" : "씌일"} 확률은 ${pct(risk)}뿐이었어요. 판단은 좋았어요`, agreed: true };
  }
  // drew and survived (ghost, special, salt save, 다섯 귀신)
  if (a.pick === "stop") return { grade: "bold", text: `🎲 대담했어요 — 씌일 확률 ${pct(a.bust)}였는데 통했어요`, agreed: false };
  if (a.pick === "draw") return { grade: "good", text: ev.act === "perfect" ? "👍 밀어붙인 보람 — 다섯 귀신!" : `👍 좋은 한 장 — 씌일 확률 ${pct(a.bust)}였어요`, agreed: true };
  return { grade: "ok", text: "🙂 반반 승부, 이번엔 통했어요", agreed: true };
}

export interface CoachTally {
  decisions: number;
  agreed: number;
  grades: Partial<Record<Grade, number>>;
}
export const EMPTY_TALLY: CoachTally = { decisions: 0, agreed: 0, grades: {} };

export function addVerdict(t: CoachTally, v: Verdict): CoachTally {
  return { decisions: t.decisions + 1, agreed: t.agreed + (v.agreed ? 1 : 0), grades: { ...t.grades, [v.grade]: (t.grades[v.grade] ?? 0) + 1 } };
}

/** One closing tip from the tally — the habit worth fixing first. */
export function tallyTip(t: CoachTally): string {
  const g = t.grades;
  if (t.decisions === 0) return "다음 판엔 한 장 더/여기까지를 직접 골라 보세요.";
  if ((g.timeout ?? 0) >= 2) return "⏰ 시간 초과가 잦았어요 — 25초 안에 고르면 손해가 줄어요.";
  if ((g.greedy ?? 0) + (g.bold ?? 0) > (g.early ?? 0) + 1) return "😈 위험할 때도 더 뽑는 편이에요 — 씌일 확률 35%를 넘으면 멈춰 보세요.";
  if ((g.early ?? 0) > (g.greedy ?? 0) + 1) return "🤏 너무 일찍 멈추는 편이에요 — 씌일 확률 20% 아래면 한 장 더가 이득이에요.";
  if (t.agreed / t.decisions >= 0.8) return "🧭 거의 코치와 같은 판단이었어요 — 이제 순위 보고 밀고 당기기를 연습해 보세요.";
  return "🧭 걸린 점수가 클수록 씌일 확률을 더 무겁게 보세요.";
}

export interface Standing {
  rank: number;
  text: string;
}

/** Average candles one turn snuffs (≈ 2.9 tales × 2.3 fear), for the "night left" estimate. */
const CANDLES_PER_TURN = 6.5;

export function standing(s: TalesState, seat: Seat): Standing {
  const mine = s.scores[seat];
  const rank = 1 + s.scores.filter((v) => v > mine).length;
  const others = s.scores.filter((_, i) => i !== seat);
  const best = Math.max(...others);
  const rounds = Math.max(0, Math.round(s.candles / CANDLES_PER_TURN / s.playerCount));
  const night = s.phase === "ended" ? "" : rounds <= 0 ? " · 🕯️ 이번 바퀴가 마지막일 수도" : ` · 🕯️ 약 ${rounds}바퀴 남음`;
  const gap = mine > best ? `👑 1위 — 2위와 ${mine - best}점 차` : mine === best ? "🤝 공동 1위" : `${rank}위 — 1위까지 ${best - mine}점`;
  return { rank, text: gap + night };
}

/** Did this event put `seat` alone in first place? (for the lead sting) */
export function tookLead(prev: TalesState, next: TalesState, seat: Seat): boolean {
  const lead = (s: TalesState) => {
    const top = Math.max(...s.scores);
    return s.scores[seat] === top && s.scores.filter((v) => v === top).length === 1;
  };
  return !lead(prev) && lead(next);
}
