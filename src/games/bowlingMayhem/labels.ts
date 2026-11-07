import type { RollRecord } from "./engine";

/** Pin numbers (1..10) for a list of ids. */
const pinNames = (ids: readonly number[]) =>
  [...ids]
    .sort((a, b) => a - b)
    .map((id) => id + 1)
    .join("-");

/** The headline for a roll's result (§5). */
export function resultLabel(r: RollRecord): { text: string; tone: "gold" | "good" | "bad" | "info"; big: boolean } {
  if (r.foul) return { text: "⏱️ 파울! (시간 초과 0핀)", tone: "bad", big: false };
  if (r.strike) {
    if (r.streak >= 4) return { text: `🔥 ${r.streak}-배거!`, tone: "gold", big: true };
    if (r.streak === 3) return { text: "🦃 터키!!!", tone: "gold", big: true };
    if (r.streak === 2) return { text: "⚡ 더블!!", tone: "gold", big: true };
    return { text: "STRIKE!", tone: "gold", big: true };
  }
  if (r.spare) return { text: r.splitConverted ? "🤯 스플릿 처리! SPARE!" : "SPARE!", tone: "good", big: true };
  const n = r.down.length;
  const left = r.setup.pins.map((p) => p.id).filter((id) => !r.down.includes(id));
  if (r.split) return { text: `😱 스플릿! ${pinNames(left)}`, tone: "bad", big: false };
  if (n === 0) return { text: r.gutter ? "🕳️ 거터…" : "💨 미스…", tone: "bad", big: false };
  if (n === 9 && r.setup.pins.length === 10) return { text: `9핀! ${pinNames(left)}번 하나 남음`, tone: "info", big: false };
  return { text: `${n}핀`, tone: "info", big: false };
}

