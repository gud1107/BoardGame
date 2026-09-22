/**
 * Pure line-picker for AI bot chat participation (2026-09-20 후속 요청).
 * `useBotAutoplay`/`chooseBotAction` in engine.ts only ever dispatch
 * `EngineAction`s — this module is intentionally separate because chat
 * messages are NOT part of the lockstep engine (they don't affect
 * `MafiaState`), so there's no reducer purity constraint here: `rng`
 * defaults to `Math.random()` and callers may pass real seat names/state
 * straight from the room component.
 *
 * Scope (see HANDOFF.md): bots only speak during `dayDiscuss` (one line,
 * at a random moment) and `defense` (the suspect, if a bot, posts one
 * self-defense line) — the two phases where the physical rulebook itself
 * expects talking. Lines never reference a role's OWN past night-
 * investigation result, since `MafiaState.nightActions` (and therefore
 * `policeResult`/`spyResult`/`mediumResult`) is wiped the moment a night
 * resolves (see engine.ts's `resolveNight`) — a human player only has that
 * information from having read it themselves in the moment, and a bot has
 * no equivalent memory to draw on without a persistent investigation log,
 * which is out of scope for this pass.
 */

import { getKnowledge, type MafiaState, type SeatIndex } from "./engine";

const GENERIC_LINES = [
  "다들 신중하게 생각해봐요.",
  "저는 아직 잘 모르겠어요.",
  "누가 마피아인지 감이 안 오네요.",
  "천천히 얘기해보죠.",
  "시간이 얼마 없으니 빨리 결정해야 할 것 같아요.",
  "다들 어떻게 생각하세요?",
  "저는 오늘 좀 더 지켜보고 싶어요.",
];

function nightReactionWithVictim(name: string): string[] {
  return [
    `${name}님이 이렇게 가시다니 안타깝네요.`,
    `어젯밤 ${name}님을 노렸다는 게 뭔가 단서가 될 것 같아요.`,
    `${name}님 죽음이 그냥 넘어갈 일은 아닌 것 같아요.`,
  ];
}

const NIGHT_REACTION_NO_VICTIM = [
  "어젯밤 아무 일도 없었던 게 오히려 수상해요.",
  "누군가 지켜준 걸까요? 다행이네요.",
  "조용한 밤이었네요.",
];

/**
 * Day-1-only opening lines (2026-09-22 확인된 실제 버그) — `dayNumber === 1`은
 * 항상 밤 0(상견례, 능력 자체가 없는 밤)이 지난 직후라 `lastNightOutcome.victim`이
 * 구조적으로 항상 null이다. 이전 코드는 이 경우도 `NIGHT_REACTION_NO_VICTIM`으로
 * 처리해 "아무 일도 없었던 게 수상하다"는 대사를 쳤는데, 애초에 아무 능력도
 * 발동될 수 없었던 밤이라 전혀 수상할 게 없다 — 탐색형 인사말로 교체.
 */
const DAY1_OPENING_LINES = [
  "오늘부터 본격적인 조사가 시작되네요. 다들 자기소개부터 해볼까요?",
  "첫날이니 서로 발언을 잘 지켜봐야겠어요.",
  "아직은 다 처음이라 누가 누군지 감이 안 잡히네요.",
  "긴장되지만 차근차근 얘기해봐요.",
  "첫날부터 무리하게 몰아가진 말죠.",
];

function accuseTemplates(name: string): string[] {
  return [
    `${name}님이 좀 수상한 것 같아요.`,
    `${name}님, 왜 그렇게 조용하세요?`,
    `저는 ${name}님을 의심하고 있어요.`,
    `${name}님 행동이 좀 이상하지 않았나요?`,
    `${name}님 쪽에 눈이 가네요.`,
  ];
}

function defendTemplates(name: string): string[] {
  return [`저는 ${name}님은 아닐 것 같아요.`, `${name}님을 의심하는 건 성급한 것 같은데요.`, `${name}님보다 더 수상한 사람이 있는 것 같아요.`];
}

const SELF_DEFENSE_LINES = [
  "저는 정말 마피아가 아니에요!",
  "왜 저를 의심하시는 거예요? 억울해요.",
  "믿어주세요, 전 시민이에요.",
  "다시 한번 생각해봐 주세요.",
  "저를 처형하면 진짜 마피아가 웃을 거예요.",
];

const SELF_DEFENSE_TERRORIST_FLAVOR = ["저를 처형하면... 후회하실 수도 있어요.", "정말 저를 처형하실 건가요? 신중하게 생각하세요."];

function pick<T>(arr: readonly T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

function countCurrentNominations(state: MafiaState, targetSeat: SeatIndex): number {
  return Object.values(state.nominations).filter((t) => t === targetSeat).length;
}

/** One line for a bot seat to post during `dayDiscuss`. */
export function chooseDiscussionLine(
  state: MafiaState,
  seat: SeatIndex,
  names: Record<SeatIndex, string>,
  rng: () => number = Math.random,
): string {
  const player = state.players[seat];
  const knowledge = getKnowledge(state, seat);
  const aliveOthers = state.players.filter((p) => p.alive && p.seat !== seat);
  const isMafiaAligned = player.team === "mafia" || (player.role === "spy" && player.spyContactedMafia);
  const nonTeammates = aliveOthers.filter((p) => !knowledge.mafiaTeammates.includes(p.seat));

  if (rng() < 0.2 && state.lastNightOutcome) {
    if (state.dayNumber === 1) return pick(DAY1_OPENING_LINES, rng);
    if (state.dayNumber === 2) {
      if (state.lastNightOutcome.victim !== null) return pick(nightReactionWithVictim(names[state.lastNightOutcome.victim]), rng);
      return pick(NIGHT_REACTION_NO_VICTIM, rng);
    }
  }

  if (isMafiaAligned) {
    const teammateInTrouble = knowledge.mafiaTeammates.find((t) => state.players[t].alive && countCurrentNominations(state, t) > 0);
    if (teammateInTrouble !== undefined && rng() < 0.4) return pick(defendTemplates(names[teammateInTrouble]), rng);
    if (nonTeammates.length > 0 && rng() < 0.6) return pick(accuseTemplates(names[pick(nonTeammates, rng).seat]), rng);
    return pick(GENERIC_LINES, rng);
  }

  if (aliveOthers.length > 0 && rng() < 0.5) return pick(accuseTemplates(names[pick(aliveOthers, rng).seat]), rng);
  return pick(GENERIC_LINES, rng);
}

/** One self-defense line for a bot seat currently on trial (`defense` phase). */
export function chooseSelfDefenseLine(state: MafiaState, seat: SeatIndex, rng: () => number = Math.random): string {
  const player = state.players[seat];
  if (player.role === "terrorist" && rng() < 0.25) return pick(SELF_DEFENSE_TERRORIST_FLAVOR, rng);
  return pick(SELF_DEFENSE_LINES, rng);
}
