import type { Persona } from "@/games/shared/three/persona";
import { seatVoice } from "@/lib/audio/seatVoice";
import { excitedVoice, speakLineAs } from "@/lib/audio/characterVoice";
import { EMOTES } from "./data";

/**
 * 감정표현 대사 — 플레이어가 고른 캐릭터의 성격(persona)마다 말투가 다르고, 같은 감정표현도 매번
 * 몇 가지 중 하나를 말한다. 어떤 대사인지는 (자리, 감정표현을 한 시각)으로 정해서 모든 기기의
 * 말풍선·목소리가 같다. 목소리는 사이트 공용 캐릭터 목소리(`seatVoice`)라 다른 게임과 같은 사람처럼 들린다.
 */
const LINES: Record<string, Record<Persona | "base", string[]>> = {
  wave: {
    base: ["안녕~", "여기 여기!", "안녕하세요!"],
    starer: ["…안녕.", "어, 왔어?"],
    shy: ["아, 안녕하세요…", "저, 저 여기요…"],
    scanner: ["어? 안녕, 안녕!", "야, 여기야 여기!"],
    focused: ["안녕. 잘 찾아봐.", "반가워."],
    dreamer: ["안녀엉~", "하이~ 나 여기~"],
    fidget: ["안녕안녕! 나 여기!", "야호, 안녕!"],
  },
  dance: {
    base: ["룰루랄라~", "랄라라~ 신난다!"],
    starer: ["흠, 리듬 좀 타 볼까.", "이 정도 여유는 있지."],
    shy: ["헤헤, 조금만 출게요…", "아, 부끄러워요~"],
    scanner: ["오, 이 노래 좋다!", "둠칫 둠칫!"],
    focused: ["하나, 둘, 셋, 넷.", "박자 정확하게."],
    dreamer: ["음~ 흥얼흥얼~", "둥실둥실~ 좋다~"],
    fidget: ["둠칫둠칫! 신난다!", "예이! 춤춰 춤춰!"],
  },
  laugh: {
    base: ["푸하하!", "아하하, 웃겨!"],
    starer: ["훗.", "하, 귀엽네."],
    shy: ["후후… 죄송해요, 웃겨서요.", "히히…"],
    scanner: ["아하하, 대박!", "푸하하, 진짜?"],
    focused: ["하하, 재밌군.", "후, 웃음 참기 힘드네."],
    dreamer: ["헤헤~ 웃기다~", "후후후~"],
    fidget: ["아하하하! 배 아파!", "깔깔깔! 미쳤다!"],
  },
  taunt: {
    base: ["나 여기 있지롱~", "메롱~ 못 찾겠지?"],
    starer: ["못 찾겠지? 당연하지.", "아직도 못 찾았어?"],
    shy: ["저, 저 여기 있는데요…?", "헤헤, 못 찾으시죠?"],
    scanner: ["여기다 여기~ 아니 저기다!", "메롱! 어디게?"],
    focused: ["시간 얼마 안 남았을 텐데.", "아직 멀었어."],
    dreamer: ["나 찾아봐라~", "여기 있는데~ 모르겠지~"],
    fidget: ["메롱메롱! 못 잡지롱!", "약 오르지? 약 오르지?"],
  },
  // --- 꼼꼼이 외침 (감정표현처럼 그 사람 목소리·말투로) ---
  /** 술래가 돌아와서 외친다 */
  found: {
    base: ["찾는다!", "찾았다!"],
    starer: ["찾았다. 나와.", "거기 있는 거 다 알아."],
    shy: ["차, 찾았어요!", "저기… 찾았어요!"],
    scanner: ["찾았다 찾았다!", "어? 거기! 찾았다!"],
    focused: ["찾았다. 예상대로야.", "거기. 찾았어."],
    dreamer: ["찾았다~", "어~ 찾았네~"],
    fidget: ["찾았다아! 딱 걸렸어!", "찾았다! 찾았다!"],
  },
  /** "찾는다!"에 걸린 숨는 사람 */
  busted: {
    base: ["들켰다!", "앗, 들켰다…"],
    starer: ["…쳇, 들켰군.", "흠, 여기까지인가."],
    shy: ["어, 어떡해요… 들켰어요…", "아… 들켰다…"],
    scanner: ["헉, 어떻게 알았지?", "엥? 들켰어?"],
    focused: ["들켰군. 다음엔 다르게.", "읽혔네."],
    dreamer: ["아~ 들켜 버렸네~", "어라~ 들켰다~"],
    fidget: ["으악, 들켰다!", "안 돼, 안 돼! 들켰어!"],
  },
  /**
   * 몰래 전봇대를 찍은 숨는 사람 — 성격과 상관없이 들뜬 외침. TTS가 또렷하게 읽도록 더듬기(꼬, 꼼…)·
   * 늘이기(~)·흐리기(…)·늘어진 받침(꼼꼬미이) 없이 "꼼꼬미!"를 맨 앞 한 마디로 끊는다.
   */
  kkom: {
    base: ["꼼꼬미! 찍었다!", "꼼꼬미! 신난다!"],
    starer: ["꼼꼬미! 내가 먼저 찍었다!", "꼼꼬미! 봤지?"],
    shy: ["꼼꼬미! 제가 찍었어요!", "꼼꼬미! 성공했어요!"],
    scanner: ["꼼꼬미! 봤지, 봤지?", "꼼꼬미! 찍었다!"],
    focused: ["꼼꼬미! 계획대로야!", "꼼꼬미! 성공!"],
    dreamer: ["꼼꼬미! 와, 찍었다!", "꼼꼬미! 야호!"],
    fidget: ["꼼꼬미! 앗싸!", "꼼꼬미! 예스!"],
  },
};

export type ShoutKind = "found" | "busted" | "kkom";

const pick = (seat: number, at: number, n: number) => {
  const x = Math.sin(seat * 91.7 + Math.floor(at) * 0.0137) * 43758.5453;
  return Math.floor((x - Math.floor(x)) * n);
};

/** 이 자리가 `at`(시뮬 시각)에 한 감정표현의 대사 — 성격 대사 + 공통 대사 중 하나 */
export function emoteLine(emoteId: string, seat: number, at: number, name: string | null | undefined): string {
  const set = LINES[emoteId];
  if (!set) return EMOTES.find((e) => e.id === emoteId)?.line ?? "";
  const persona = seatVoice(seat, name).persona;
  const pool = [...set[persona], ...set.base];
  return pool[pick(seat, at, pool.length)];
}

/** 그 사람의 캐릭터 목소리로 말하기 (`vol` = 거리 감쇠) */
export function speakEmote(emoteId: string, seat: number, at: number, name: string | null | undefined, vol: number) {
  speakLineAs(seatVoice(seat, name), emoteLine(emoteId, seat, at, name), vol);
}

/** 꼼꼼이 외침("찾는다!"·"들켰다!"·"꼼꼬미!")을 그 사람 캐릭터 목소리·말투로 — "꼼꼬미!"는 들뜬 목소리로 또박또박 */
export function speakShout(kind: ShoutKind, seat: number, at: number, name: string | null | undefined, vol: number) {
  const voice = seatVoice(seat, name);
  if (kind === "kkom") speakLineAs(excitedVoice(voice), emoteLine(kind, seat, at, name), vol, true);
  else speakLineAs(voice, emoteLine(kind, seat, at, name), vol);
}
