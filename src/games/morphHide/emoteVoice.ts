import type { Persona } from "@/games/shared/three/persona";
import { seatVoice } from "@/lib/audio/seatVoice";
import { speakLineAs } from "@/lib/audio/characterVoice";
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
};

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
