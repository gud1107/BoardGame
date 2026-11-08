import { capOf, scoreName, type ShotRecord } from "./engine";
import { HOLES } from "./course";

/** The headline for a stroke's result (§4, §9). */
export function resultLabel(r: ShotRecord, names: Record<number, string> = {}): { text: string; tone: "gold" | "good" | "bad" | "info"; big: boolean } {
  const par = HOLES[r.holeId].par;
  if (r.timeout) return { text: r.picked ? `⏱️ 헛스윙… 공 줍기 (${capOf(par) + 1}타)` : "⏱️ 헛스윙! (+1타)", tone: "bad", big: false };
  if (r.holed) {
    const name = scoreName(r.stroke, par);
    if (r.stroke === 1) return { text: "⛳ 홀인원!!!", tone: "gold", big: true };
    const d = r.stroke - par;
    if (d <= -1) return { text: `🐦 ${name}!`, tone: "gold", big: true };
    if (d === 0) return { text: "✅ 파!", tone: "good", big: true };
    return { text: `${name} (${r.stroke}타)`, tone: "info", big: false };
  }
  if (r.knockedIn.length > 0) return { text: `🎁 ${r.knockedIn.map((s) => names[s] ?? "누군가").join(", ")}님 공을 넣어줬어요!`, tone: "info", big: false };
  if (r.out) return { text: r.picked ? `☁️ 추락… 공 줍기 (${capOf(par) + 1}타)` : "☁️ 추락! +1벌타", tone: "bad", big: false };
  if (r.picked) return { text: `🧺 공 줍기 — ${capOf(par) + 1}타`, tone: "bad", big: false };
  if (r.knockedOut.length > 0) return { text: `💥 ${r.knockedOut.map((s) => names[s] ?? "누군가").join(", ")}님 공을 섬 밖으로!`, tone: "good", big: false };
  if (r.jumped) return { text: "🛹 점프 성공!", tone: "good", big: false };
  if (r.windmillPass) return { text: "🌀 풍차 통과!", tone: "good", big: false };
  if (r.windmillHit) return { text: "🌀 날개에 퉁!", tone: "info", big: false };
  return { text: `${r.stroke}타째`, tone: "info", big: false };
}
