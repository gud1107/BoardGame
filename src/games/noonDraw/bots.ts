import type { BotLevel } from "@/games/shared/bot/botDifficulty";
import type { NoonAction, NoonState, SeatIndex } from "./engine";

/**
 * 정오의 발도 AI (룰북 §10). 봇은 사람과 똑같이 **공개된 상태만** 본다 — 방장의 비밀 신호 계획은 쓰지 않는다.
 *
 * - 반응 시간: 레벨별 평균·흔들림을 가진 정규분포 + 가끔 "멈칫"(+250~450ms). Lv.1 평균 ≈ 440ms, Lv.10 ≈ 233ms.
 * - 가짜 신호에 속기: 가짜 신호가 뜰 때마다 레벨별 확률로 0.18~0.35초 뒤 칼을 뽑아 버린다 (Lv.1 22% → Lv.10 2%).
 * - 지레짐작: 합마다 아주 낮은 확률로, 아무 신호 없이 "이쯤이겠지" 하고 먼저 뽑는다.
 * - 🔮 예측: 구경하는 봇은 기다림이 시작되면 아무나 한 명을 고른다.
 */

interface Plan {
  at: number;
  early: boolean;
  rt?: number;
}

export interface BotMemory {
  boutId: number;
  plans: Map<SeatIndex, Plan>;
  seenFeints: number;
  /** 지레짐작 굴림을 한 자리 */
  rolled: Set<SeatIndex>;
  picked: Set<SeatIndex>;
  signalSeen: boolean;
}

export function createBotMemory(): BotMemory {
  return { boutId: -1, plans: new Map(), seenFeints: 0, rolled: new Set(), picked: new Set(), signalSeen: false };
}

export function botMeanRt(level: number): number {
  return 440 - (level - 1) * 23;
}
export function botRtSpread(level: number): number {
  return 88 - level * 6;
}
export function botFeintFool(level: number): number {
  return Math.max(0.02, 0.22 - (level - 1) * 0.022);
}
export function botAnticipate(level: number): number {
  return Math.max(0.004, 0.035 - (level - 1) * 0.0035);
}

function gauss(rng: () => number): number {
  const u = Math.max(1e-9, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function sampleBotRt(level: number, rng: () => number): number {
  let rt = botMeanRt(level) + gauss(rng) * botRtSpread(level);
  if (rng() < 0.03) rt += 250 + rng() * 200;
  return Math.round(Math.max(125, Math.min(1400, rt)));
}

export function runBots(s: NoonState, now: number, bots: Map<SeatIndex, BotLevel | number>, mem: BotMemory, rng: () => number): NoonAction[] {
  const bout = s.bout;
  if (s.phase !== "bout" || !bout || bots.size === 0) return [];
  if (mem.boutId !== bout.id) {
    mem.boutId = bout.id;
    mem.plans.clear();
    mem.rolled.clear();
    mem.picked.clear();
    mem.seenFeints = 0;
    mem.signalSeen = false;
  }
  const out: NoonAction[] = [];
  const mine = bout.participants.filter((p) => bots.has(p) && !bout.draws[p]);

  if (bout.phase === "wait") {
    // 🔮 구경하는 봇의 예측
    if (s.mode === "tournament") {
      for (const [seat] of bots) {
        if (bout.participants.includes(seat) || mem.picked.has(seat) || seat >= s.playerCount) continue;
        mem.picked.add(seat);
        out.push({ type: "pick", seat, target: bout.participants[Math.floor(rng() * bout.participants.length)] });
      }
    }
    for (const seat of mine) {
      if (mem.rolled.has(seat)) continue;
      mem.rolled.add(seat);
      if (rng() < botAnticipate(bots.get(seat)!)) mem.plans.set(seat, { at: now + 900 + rng() * 4200, early: true });
    }
    for (let i = mem.seenFeints; i < bout.feints.length; i++) {
      const f = bout.feints[i];
      for (const seat of mine) {
        if (mem.plans.get(seat)?.early) continue;
        if (rng() < botFeintFool(bots.get(seat)!)) mem.plans.set(seat, { at: f.at + 180 + rng() * 170, early: true });
      }
    }
    mem.seenFeints = bout.feints.length;
  }

  if ((bout.phase === "draw" || bout.phase === "wait") && bout.signalAt !== null && !mem.signalSeen) {
    mem.signalSeen = true;
    for (const seat of mine) {
      const p = mem.plans.get(seat);
      // 신호보다 늦게 잡혀 있던 지레짐작·속임수 반응은 진짜 반응으로 바뀐다
      if (p?.early && p.at < bout.signalAt) continue;
      const rt = sampleBotRt(bots.get(seat)!, rng);
      mem.plans.set(seat, { at: bout.signalAt + rt, early: false, rt });
    }
  }

  if (bout.phase === "wait" || bout.phase === "draw") {
    for (const seat of mine) {
      const p = mem.plans.get(seat);
      if (!p || p.at > now) continue;
      mem.plans.delete(seat);
      out.push(p.early ? { type: "draw", seat, early: true } : { type: "draw", seat, rt: p.rt });
    }
  }
  return out;
}
