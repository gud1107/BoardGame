/**
 * Character emotion voices for the 3D table people — short Korean interjections spoken with
 * the browser's speech synthesis when a seat's mood turns emotional (cheer, shock, laugh …).
 *
 * Each character sounds like themself along three axes:
 *  - lines:  the persona picks the words ("야호!" vs a shy "와… 됐다" vs a starer's "봤지?")
 *  - voice:  gender + seat set the pitch; with several Korean voices installed, women and men
 *            get different ones
 *  - manner: the persona sets speed and loudness (the dreamer drawls, the shy one murmurs)
 *
 * The choice logic (lines, profile, who may speak now) is pure and unit-tested; `speakEmotion`
 * is the thin browser side. Respects the shared SFX mute/volume — speechSynthesis bypasses the
 * Web Audio gain graph, so it is checked here (same as SoundEngine.speakPass).
 */

import type { Persona } from "@/games/shared/three/persona";
import type { PersonMood } from "@/games/shared/three/SeatedPerson";
import { isSfxEffectivelyMuted, useAudioSettingsStore } from "./audioSettings";

/** Moods worth a voice line. Idle/working moods (rest, think, talk, write) stay silent. */
export type VoicedMood = "cheer" | "shock" | "laugh" | "sad" | "smug" | "nervous" | "point" | "clap" | "shrug" | "slump" | "raise";

const VOICED = new Set<PersonMood>(["cheer", "shock", "laugh", "sad", "smug", "nervous", "point", "clap", "shrug", "slump", "raise"]);
export const isVoiced = (m: PersonMood): m is VoicedMood => VOICED.has(m);

const BASE_LINES: Record<VoicedMood, string[]> = {
  cheer: ["야호!", "좋았어!", "해냈다!"],
  shock: ["헉!", "뭐야?!", "말도 안 돼!"],
  laugh: ["하하하!", "푸하하!", "크크크"],
  sad: ["아…", "에이…", "망했다…"],
  smug: ["흥.", "역시 나지.", "후후"],
  nervous: ["어, 어…", "아 떨린다…", "제발…"],
  point: ["너!", "바로 너야!"],
  clap: ["오~!", "나이스!"],
  shrug: ["글쎄…?", "음…?"],
  slump: ["으아…", "끝났다…"],
  raise: ["저요!", "여기!"],
};

/** Persona-flavoured lines; anything missing falls back to BASE_LINES. */
const PERSONA_LINES: Record<Persona, Partial<Record<VoicedMood, string[]>>> = {
  starer: { cheer: ["봤지?", "당연하지."], shock: ["…뭐?"], laugh: ["훗."], sad: ["…쳇."], smug: ["예상대로야.", "다 보였어."], point: ["너잖아."], nervous: ["…흠."] },
  shy: { cheer: ["와… 됐다", "헤헤, 됐어요"], shock: ["어머…", "히익"], laugh: ["히히", "후훗"], sad: ["흑…", "아… 어떡해"], smug: ["헤헤"], point: ["저, 저기…"], raise: ["저, 저요…"], nervous: ["으… 떨려요"] },
  scanner: { cheer: ["오오 좋아!"], shock: ["어디? 뭐?", "엥?!"], laugh: ["아하하!"], sad: ["어라…"], smug: ["그렇지~"], clap: ["오 대박!"] },
  focused: { cheer: ["좋아.", "계획대로."], shock: ["음?!"], laugh: ["하."], sad: ["아쉽네."], smug: ["계산대로."], point: ["너다."], nervous: ["집중…"] },
  dreamer: { cheer: ["어… 이겼네?", "오~ 좋다~"], shock: ["응…? 뭐야~"], laugh: ["헤헤헤…"], sad: ["아~ 그렇구나…"], smug: ["음~ 좋아~"], shrug: ["몰라~"] },
  fidget: { cheer: ["앗싸! 앗싸!", "예스 예스!"], shock: ["헐 헐 헐!", "으악!"], laugh: ["깔깔깔!", "아 웃겨!"], sad: ["으아아 안 돼!"], smug: ["히힛!"], nervous: ["어떡해 어떡해!"], clap: ["짝짝짝!"] },
};

const hash = (a: number, b: number) => {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** The `n`-th line this character says for `mood` (varies call to call, same for the same inputs). */
export function voiceLine(persona: Persona, mood: VoicedMood, seat: number, n: number): string {
  const lines = PERSONA_LINES[persona][mood] ?? BASE_LINES[mood];
  return lines[Math.floor(hash(seat + 1, n) * lines.length) % lines.length];
}

export interface VoiceProfile {
  pitch: number;
  rate: number;
  volume: number;
}

const MANNER: Record<Persona, { rate: number; volume: number }> = {
  starer: { rate: 0.95, volume: 0.9 },
  shy: { rate: 0.95, volume: 0.6 },
  scanner: { rate: 1.18, volume: 0.95 },
  focused: { rate: 1.0, volume: 0.85 },
  dreamer: { rate: 0.8, volume: 0.8 },
  fidget: { rate: 1.3, volume: 1 },
};

/** Pitch from gender, spread per seat so two women (or two men) at a table don't sound alike. */
export function voiceProfile(seat: number, gender: "f" | "m", persona: Persona): VoiceProfile {
  const spread = hash(seat, 7) - 0.5; // −0.5 … 0.5
  const pitch = gender === "f" ? 1.3 + spread * 0.4 : 0.85 + spread * 0.3;
  const m = MANNER[persona];
  return { pitch: Math.max(0.5, Math.min(2, pitch)), rate: m.rate, volume: m.volume };
}

/** Strong reactions may cut in over a line already playing; the rest wait their turn (are skipped). */
const URGENT = new Set<VoicedMood>(["shock", "cheer"]);

/** perSeat/global: seconds between lines; urgent: even a shock waits this long into the current line before cutting it. */
export const VOICE_GAP = { perSeat: 2.5, global: 0.9, urgent: 0.5 };

/**
 * Rate limiter: who may speak at `now` (seconds). One voice at a time keeps a table of eight
 * from turning into noise; `busy` = a line is still playing.
 */
export class VoiceGate {
  private lastSeat = new Map<number, number>();
  private lastAny = -Infinity;

  allow(seat: number, mood: VoicedMood, now: number, busy: boolean): "speak" | "cut" | "skip" {
    if (now - (this.lastSeat.get(seat) ?? -Infinity) < VOICE_GAP.perSeat) return "skip";
    const urgent = URGENT.has(mood);
    const since = now - this.lastAny;
    // a whole table reacting in the same frame would otherwise cut each other off down to the last one
    if (since < (urgent ? VOICE_GAP.urgent : VOICE_GAP.global)) return "skip";
    if (busy && !urgent) return "skip";
    this.lastSeat.set(seat, now);
    this.lastAny = now;
    return busy ? "cut" : "speak";
  }
}

// --- browser side -------------------------------------------------------------------------

const gate = new VoiceGate();
const said = new Map<number, number>();

const FEMALE = /female|woman|여성|heami|sunhi|yuna|sora|jimin|seoyeon|nara/i;
const MALE = /male|man|남성|injoon|hyunsu|minho|jinho/i;

function pickVoice(gender: "f" | "m", seat: number): SpeechSynthesisVoice | null {
  const ko = window.speechSynthesis.getVoices().filter((v) => v.lang?.toLowerCase().startsWith("ko"));
  if (ko.length === 0) return null;
  // "female" contains "male" — rule female names out before matching male ones
  const want = ko.filter((v) => (gender === "f" ? FEMALE.test(v.name) : !FEMALE.test(v.name) && MALE.test(v.name)));
  const pool = want.length > 0 ? want : ko;
  return pool[seat % pool.length];
}

/** Say this seat's line for `mood`, if sound is on and the gate lets it through. Safe to call anywhere. */
export function speakEmotion(o: { seat: number; mood: PersonMood; persona: Persona; gender: "f" | "m" }) {
  if (!isVoiced(o.mood)) return;
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const settings = useAudioSettingsStore.getState();
  if (isSfxEffectivelyMuted(settings)) return;
  const synth = window.speechSynthesis;
  const verdict = gate.allow(o.seat, o.mood, performance.now() / 1000, synth.speaking || synth.pending);
  if (verdict === "skip") return;
  if (verdict === "cut") synth.cancel();
  const n = (said.get(o.seat) ?? 0) + 1;
  said.set(o.seat, n);
  const p = voiceProfile(o.seat, o.gender, o.persona);
  try {
    const u = new SpeechSynthesisUtterance(voiceLine(o.persona, o.mood, o.seat, n));
    u.lang = "ko-KR";
    u.pitch = p.pitch;
    u.rate = p.rate;
    u.volume = p.volume * settings.sfxVolume;
    const v = pickVoice(o.gender, o.seat);
    if (v) u.voice = v;
    synth.speak(u);
  } catch {
    // an old WebView without SpeechSynthesisUtterance — voices are decoration, stay silent
  }
}
