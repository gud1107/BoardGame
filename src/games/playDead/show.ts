import { MAX_LIE, type GameState, type Hit, type MoveKind, type RoundEvent, type Seat, type SeatState } from "./engine";
import type { ArenaFighter, ArenaFx } from "./three/PlayDeadArena3D";
import type { FighterPose } from "./three/VrmFighter";

/**
 * 판정 연출 — 엔진의 라운드 이벤트를 "기! 기! 파!" 구호 → 동시 동작 → 명중 → 털썩 타임라인으로
 * 풀어 낸다(React/three 없이 순수 함수라 테스트 가능). 숨은 정보는 여기서 걸러진다:
 * 남의 실제 피해량은 공개 범위로만, 쓰러진 사람의 선택은 실제로 일어난 일로만 보인다.
 */

export const SHOW = { chant: 1.5, act: 1.5, impact: 2.35, fall: 2.85, end: 4.2 } as const;
/** 판정 화면을 보여 주는 최소 시간(ms) — 방장은 이 뒤에 다음 라운드로 넘긴다(전원 준비면 더 일찍) */
export const RESOLVED_MS = 6500;

export function chantAt(e: number): string | null {
  if (e < 0 || e >= SHOW.chant) return null;
  return e < 0.5 ? "기!" : e < 1.0 ? "기!" : "파!";
}

export const MOVE_LABEL: Record<MoveKind, { icon: string; label: string }> = {
  charge: { icon: "⚡", label: "기 모으기" },
  block: { icon: "🛡️", label: "막기" },
  pa: { icon: "👊", label: "파" },
  jangpung: { icon: "🌀", label: "장풍" },
  energy: { icon: "💥", label: "에네르기파" },
  loot: { icon: "💰", label: "기 뺏기" },
  finish: { icon: "🔪", label: "확인사살" },
  hold: { icon: "🤫", label: "숨죽이기" },
  rise: { icon: "🧍", label: "일어나기" },
  ambush: { icon: "⚡", label: "벌떡 기습" },
};

/** 피해 표시: 맞은 본인에게는 실제 값, 다른 사람에게는 공개 범위 */
export function dmgText(hit: Hit, target: Seat, viewer: Seat): string {
  if (target === viewer) return `−${hit.dmg}`;
  return hit.lo === hit.hi ? `−${hit.lo}` : `−${hit.lo}~${hit.hi}`;
}

export function statusOf(s: SeatState): string | null {
  if (s.confirmed) return "☠ 사망 확인";
  if (s.down) return s.lie >= MAX_LIE ? "쓰러짐 · 미동도 없음…" : `쓰러짐 · 누운 지 ${s.lie}/${MAX_LIE}`;
  return null;
}

function hitTargets(events: RoundEvent[]): Set<Seat> {
  const out = new Set<Seat>();
  for (const e of events) {
    if ((e.t === "blast" || e.t === "ambush" || e.t === "finish") && e.hit) out.add(e.t === "finish" && e.result === "countered" ? e.target : e.target);
  }
  return out;
}

/**
 * 각 자리의 자세. `prev` = 판정 직전 자리 상태(없으면 연출 없이 결과만), `e` = 연출 시작 후 초.
 */
export function fightersAt(state: GameState, prev: SeatState[] | null, viewer: Seat, names: Record<Seat, string>, e: number, committed: boolean[]): ArenaFighter[] {
  const showing = (state.phase === "resolved" || state.phase === "ended") && prev !== null;
  const hits = showing ? hitTargets(state.events) : new Set<Seat>();
  return state.seats.map((s, seat) => {
    const base = { seat, name: names[seat] ?? `${seat + 1}번` };
    if (!showing) {
      const waiting = state.phase === "choosing" && !s.confirmed;
      return {
        ...base,
        pose: s.down ? "down" : "idle",
        poseKey: `${state.stage}:${s.down ? "down" : "idle"}`,
        moveToSeat: null,
        aimSeat: null,
        out: s.confirmed,
        ki: s.ki,
        status: statusOf(s) ?? (waiting ? (committed[seat] ? "✅ 결정 완료" : "🤔 고민 중…") : null),
      };
    }
    const p = prev![seat];
    let pose: FighterPose = p.down ? "down" : "idle";
    let moveToSeat: number | null = null;
    let aimSeat: number | null = null;
    const m = state.lastMoves[seat];
    if (e >= SHOW.act && e < SHOW.end) {
      if (m) {
        if (m.kind === "charge" || m.kind === "block" || m.kind === "pa" || m.kind === "jangpung" || m.kind === "energy") pose = m.kind;
        if (m.kind === "loot" || m.kind === "finish") {
          pose = m.kind;
          moveToSeat = e < SHOW.end - 0.5 ? m.target! : null;
        }
        aimSeat = m.target ?? null;
      } else if (p.down) {
        const amb = state.events.find((ev) => ev.t === "ambush" && ev.seat === seat);
        const rose = state.events.some((ev) => (ev.t === "rise" && ev.seat === seat && ev.reason === "choice") || (ev.t === "finish" && ev.target === seat && ev.result !== "dead"));
        if (amb && amb.t === "ambush") {
          pose = "ambush";
          aimSeat = amb.target;
        } else if (rose) pose = "rise";
      }
      if (hits.has(seat) && e >= SHOW.impact) pose = "hit";
    }
    if (e >= SHOW.fall) {
      const breath = state.events.some((ev) => ev.t === "rise" && ev.seat === seat && ev.reason === "breath");
      if (s.down) pose = hits.has(seat) && e < SHOW.end ? "hit" : "down";
      else if (breath && e < SHOW.end) pose = "rise";
      else if (e >= SHOW.end) pose = state.phase === "ended" && !s.dead ? "win" : "idle";
    }
    const after = e >= SHOW.impact;
    return {
      ...base,
      pose,
      poseKey: `${state.stage}:${pose}`,
      moveToSeat,
      aimSeat,
      out: after ? s.confirmed : p.confirmed,
      ki: after ? s.ki : p.ki,
      status: e >= SHOW.fall ? statusOf(s) : statusOf(p),
    };
  });
}

/** 이번 라운드의 시각 효과(구슬·폭발·글자) */
export function buildFx(state: GameState, viewer: Seat): ArenaFx[] {
  const fx: ArenaFx[] = [];
  const tag = `${state.stage}`;
  const RED = "#f87171";
  state.events.forEach((ev, i) => {
    const key = `${tag}:${i}`;
    switch (ev.t) {
      case "charge":
        fx.push({ key, kind: "text", seat: ev.seat, text: "+1 기", color: "#fde047", at: SHOW.impact });
        break;
      case "blast": {
        const wind = ev.tier >= 3 ? 0.45 : 0.3;
        const start = SHOW.act + wind;
        const dur = SHOW.impact - start;
        if (ev.result === "clash") {
          fx.push({ key: `${key}a`, kind: "orb", from: ev.seat, to: ev.target, tier: ev.tier, at: start, dur, stop: "clash" });
          fx.push({ key: `${key}b`, kind: "orb", from: ev.target, to: ev.seat, tier: ev.tier, at: start, dur, stop: "clash" });
          fx.push({ key: `${key}c`, kind: "midBurst", a: ev.seat, b: ev.target, at: start + dur * 0.5 });
          fx.push({ key: `${key}t`, kind: "text", seat: ev.seat, text: "기 충돌! 상쇄", color: "#e2e8f0", at: SHOW.impact });
        } else if (ev.result === "overpowered") {
          fx.push({ key: `${key}a`, kind: "orb", from: ev.seat, to: ev.target, tier: ev.tier, at: start, dur, stop: "clash" });
          fx.push({ key: `${key}t`, kind: "text", seat: ev.seat, text: "밀렸다!", color: "#e2e8f0", at: SHOW.impact });
        } else {
          fx.push({ key: `${key}a`, kind: "orb", from: ev.seat, to: ev.target, tier: ev.tier, at: start, dur, stop: ev.result === "blocked" ? "block" : "hit" });
          if (ev.result === "blocked") fx.push({ key: `${key}t`, kind: "text", seat: ev.target, text: "🛡️ 막음!", color: "#93c5fd", at: SHOW.impact });
          else {
            fx.push({ key: `${key}b`, kind: "burst", seat: ev.target, color: ev.tier >= 3 ? "#fde047" : "#f0abfc", at: SHOW.impact, big: ev.tier >= 3 });
            fx.push({ key: `${key}t`, kind: "text", seat: ev.target, text: `${ev.result === "pierce" ? "관통! " : ""}${dmgText(ev.hit!, ev.target, viewer)}`, color: RED, at: SHOW.impact });
          }
        }
        break;
      }
      case "ambush": {
        const start = SHOW.act + 0.55;
        fx.push({ key: `${key}a`, kind: "orb", from: ev.seat, to: ev.target, tier: 2, at: start, dur: SHOW.impact - start, stop: ev.result === "blocked" ? "block" : "hit" });
        if (ev.result === "blocked") fx.push({ key: `${key}t`, kind: "text", seat: ev.target, text: "🛡️ 기습 막음!", color: "#93c5fd", at: SHOW.impact });
        else {
          fx.push({ key: `${key}b`, kind: "burst", seat: ev.target, color: "#fb923c", at: SHOW.impact, big: true });
          fx.push({ key: `${key}t`, kind: "text", seat: ev.target, text: `⚡기습! ${dmgText(ev.hit!, ev.target, viewer)}`, color: RED, at: SHOW.impact });
        }
        break;
      }
      case "finish":
        if (ev.result === "dead") fx.push({ key, kind: "text", seat: ev.target, text: "☠ 진짜 시체였다", color: "#fca5a5", at: SHOW.impact });
        else if (ev.hit) {
          fx.push({ key: `${key}b`, kind: "burst", seat: ev.target, color: "#f87171", at: SHOW.impact });
          fx.push({ key, kind: "text", seat: ev.target, text: `${ev.result === "countered" ? "기습 간파!" : "들켰다!"} ${dmgText(ev.hit, ev.target, viewer)}`, color: RED, at: SHOW.impact });
        }
        break;
      case "loot":
        if (ev.took > 0) {
          fx.push({ key: `${key}f`, kind: "kiFlow", from: ev.target, to: ev.seat, at: SHOW.act + 0.8 });
          fx.push({ key, kind: "text", seat: ev.seat, text: `💰 +${ev.took} 기`, color: "#fde047", at: SHOW.impact });
        } else fx.push({ key, kind: "text", seat: ev.seat, text: ev.foiled ? "헛탕!" : "빈털터리…", color: "#cbd5e1", at: SHOW.impact });
        break;
      case "rise":
        if (ev.reason === "breath") fx.push({ key, kind: "text", seat: ev.seat, text: "헉헉… 숨이 차서 벌떡", color: "#e2e8f0", at: SHOW.fall });
        break;
      case "fall":
        ev.seats.forEach((seat) => fx.push({ key: `${key}:${seat}`, kind: "text", seat, text: "털썩!", color: "#e2e8f0", at: SHOW.fall + 0.2 }));
        break;
      default:
        break;
    }
  });
  return fx;
}

/** 로그용 문장 (숨은 정보는 보는 사람 기준으로 거른다) */
export function describeEvents(state: GameState, names: Record<Seat, string>, viewer: Seat): { text: string; mine?: boolean }[] {
  const nm = (s: Seat) => (s === viewer ? "나" : (names[s] ?? `${s + 1}번`));
  const out: { text: string; mine?: boolean }[] = [];
  for (const ev of state.events) {
    switch (ev.t) {
      case "blast": {
        const tech = ev.tier === 1 ? "👊 파" : ev.tier === 2 ? "🌀 장풍" : "💥 에네르기파";
        if (ev.result === "clash") out.push({ text: `${nm(ev.seat)} ↔ ${nm(ev.target)} ${tech} 충돌! 서로 상쇄` });
        else if (ev.result === "overpowered") out.push({ text: `${nm(ev.seat)}의 ${tech}, ${nm(ev.target)}의 더 센 기술에 밀렸다` });
        else if (ev.result === "blocked") out.push({ text: `${nm(ev.seat)} ${tech} → ${nm(ev.target)} 🛡️ 막음` });
        else out.push({ text: `${nm(ev.seat)} ${tech} → ${nm(ev.target)} ${ev.result === "pierce" ? "막기 관통 " : ""}${dmgText(ev.hit!, ev.target, viewer)}`, mine: ev.target === viewer });
        break;
      }
      case "ambush":
        out.push({
          text: ev.result === "blocked" ? `⚡ ${nm(ev.seat)}의 벌떡 기습! ${nm(ev.target)}이(가) 막았다` : `⚡ 쓰러져 있던 ${nm(ev.seat)}의 벌떡 기습! ${nm(ev.target)} ${dmgText(ev.hit!, ev.target, viewer)}${ev.result === "looter" ? " (기 뺏으러 왔다가)" : ""}`,
          mine: ev.target === viewer,
        });
        break;
      case "finish":
        out.push({
          text:
            ev.result === "dead"
              ? `🔪 ${nm(ev.seat)}의 확인사살 — ${nm(ev.target)}은(는) 진짜 시체였다`
              : ev.result === "exposed"
                ? `🔪 ${nm(ev.seat)}의 확인사살 — ${nm(ev.target)}은(는) 죽은 척이었다! ${ev.hit ? dmgText(ev.hit, ev.target, viewer) : ""}`
                : `🔪 ${nm(ev.target)}이(가) 기습하려다 ${nm(ev.seat)}에게 간파당했다! ${ev.hit ? dmgText(ev.hit, ev.target, viewer) : ""}`,
          mine: ev.target === viewer,
        });
        break;
      case "loot":
        out.push({ text: ev.took > 0 ? `💰 ${nm(ev.seat)}이(가) ${nm(ev.target)}의 몸에서 기 ${ev.took}개를 뺏었다` : `💰 ${nm(ev.seat)}의 기 뺏기 — ${ev.foiled ? "헛탕!" : "빈털터리였다"}` });
        break;
      case "rise":
        out.push({ text: ev.reason === "breath" ? `😮‍💨 ${nm(ev.seat)}이(가) 숨이 차서 벌떡 일어났다 (살아 있었다!)` : `🧍 ${nm(ev.seat)}이(가) 털고 일어났다` });
        break;
      case "fall":
        out.push({ text: `💀 ${ev.seats.map(nm).join(", ")} 털썩 쓰러졌다! 진짜 죽었을까?` });
        break;
      default:
        break;
    }
  }
  const charged = state.events.filter((e) => e.t === "charge").map((e) => nm((e as { seat: Seat }).seat));
  const blocked = state.events.filter((e) => e.t === "block").map((e) => nm((e as { seat: Seat }).seat));
  if (charged.length) out.unshift({ text: `⚡ 기 모으기: ${charged.join(", ")}` });
  if (blocked.length) out.unshift({ text: `🛡️ 막기: ${blocked.join(", ")}` });
  if (state.seats[viewer]?.dead && state.events.some((e) => e.t === "fall" && e.seats.includes(viewer))) out.push({ text: "🔒 당신은 진짜로 쓰러졌습니다. 남들은 아직 모르니 끝까지 연기하세요!", mine: true });
  return out;
}
