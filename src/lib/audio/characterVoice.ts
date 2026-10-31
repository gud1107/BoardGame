/**
 * Character emotion voices for the 3D table people — short Korean interjections spoken with
 * the browser's speech synthesis when a seat's mood turns emotional (cheer, shock, laugh …).
 *
 * Each character sounds like themself along three axes:
 *  - lines:  the persona picks the words ("야호!" vs a shy "와… 됐다" vs a starer's "봤지?")
 *  - voice:  gender + pitch; with several Korean voices installed, women and men get different ones
 *  - manner: the persona sets speed and loudness (the dreamer drawls, the shy one murmurs)
 *
 * A player who picked a ready-made character (프로필 → 캐릭터 선택) gets that character's own
 * voice at every table and seat (`characterVoice`); everyone else falls back to their seat.
 *
 * The choice logic (lines, profile, who may speak now) is pure and unit-tested; `speakEmotion`
 * is the thin browser side. Respects the shared SFX mute/volume — speechSynthesis bypasses the
 * Web Audio gain graph, so it is checked here (same as SoundEngine.speakPass).
 */

import { personaFor, type Persona } from "@/games/shared/three/persona";
import type { PersonMood } from "@/games/shared/three/SeatedPerson";
import { CHARACTER_PRESETS, type AvatarProfile } from "@/lib/character/avatar";
import { isSfxEffectivelyMuted, useAudioSettingsStore } from "./audioSettings";

/** Moods worth a voice line. Idle/working moods (rest, think, talk, write) stay silent. */
export type VoicedMood = "cheer" | "shock" | "laugh" | "sad" | "smug" | "nervous" | "point" | "clap" | "shrug" | "slump" | "raise";

const VOICED = new Set<PersonMood>(["cheer", "shock", "laugh", "sad", "smug", "nervous", "point", "clap", "shrug", "slump", "raise"]);
export const isVoiced = (m: PersonMood): m is VoicedMood => VOICED.has(m);

const BASE_LINES: Record<VoicedMood, string[]> = {
  cheer: ["좋았어!", "됐다, 됐어!", "이야, 해냈네!"],
  shock: ["헉, 진짜?", "어? 이게 뭐야?", "아니, 말도 안 돼!"],
  laugh: ["아하하, 진짜 웃기다!", "푸하하, 이게 뭐야.", "하하, 못 말려."],
  sad: ["아, 아깝다…", "에이, 이게 아닌데…", "아이고, 망했네…"],
  smug: ["후후, 이 정도쯤이야.", "역시, 그럴 줄 알았지.", "뭐, 당연한 결과지."],
  nervous: ["어, 어떡하지…", "아, 떨린다…", "제발, 제발…"],
  point: ["너, 바로 너야!", "너지? 딱 보니까 알겠네."],
  clap: ["오, 잘했네!", "와, 멋지다!", "나이스, 진짜 잘했어!"],
  shrug: ["글쎄, 잘 모르겠는데?", "음, 어쩔 수 없지 뭐."],
  slump: ["아, 끝났다…", "하아, 힘들다…"],
  raise: ["저요, 저요!", "잠깐만요, 저 할게요!"],
};

/**
 * Persona-flavoured lines; anything missing falls back to BASE_LINES. Written the way people
 * actually talk at a table — an interjection, then a few plain words. `~` (drawn out) and
 * `…` (trailing off) are for the caption; `spokenPhrases` turns them into intonation.
 */
const PERSONA_LINES: Record<Persona, Partial<Record<VoicedMood, string[]>>> = {
  starer: {
    cheer: ["봤지? 이게 실력이야.", "당연하지."],
    shock: ["…뭐라고?", "흠, 이건 예상 못 했네."],
    laugh: ["훗, 재밌네."],
    sad: ["쳇, 이번엔 봐준다."],
    smug: ["역시, 예상대로야.", "흠, 이 정도는 기본이지."],
    point: ["너잖아. 숨길 생각 마."],
    nervous: ["흠… 조금 까다롭군."],
  },
  shy: {
    cheer: ["어, 됐다… 다행이에요.", "와, 제가 했어요!"],
    shock: ["어머, 정말요?", "어, 어떡해요?"],
    laugh: ["후후, 재밌어요.", "아, 정말 웃겨요."],
    sad: ["아, 아쉬워요…", "어떡하죠, 망했어요…"],
    smug: ["헤헤, 운이 좋았네요."],
    point: ["저, 저기… 그쪽 아니에요?"],
    raise: ["저, 저도 할게요."],
    nervous: ["으, 너무 떨려요…"],
  },
  scanner: {
    cheer: ["오, 좋아 좋아!", "그렇지, 바로 그거야!"],
    shock: ["어? 어디, 뭔데?", "엥, 이게 왜?"],
    laugh: ["아하하, 대박이다!"],
    sad: ["어라, 이게 아닌데…"],
    smug: ["그렇지, 내가 뭐랬어?"],
    clap: ["오, 대박! 잘한다!"],
  },
  focused: {
    cheer: ["좋아, 계획대로야.", "됐어, 깔끔하게."],
    shock: ["음? 변수가 생겼군."],
    laugh: ["하, 재미있네."],
    sad: ["아쉽군. 다음엔 다르게 가야겠어."],
    smug: ["계산한 대로야.", "자, 여기까지는 순조롭네."],
    point: ["너다. 근거도 있어."],
    nervous: ["집중하자. 아직 안 끝났어."],
  },
  dreamer: {
    cheer: ["어, 이겼네? 좋다~", "오~ 나쁘지 않은데?"],
    shock: ["응? 뭐야, 언제?"],
    laugh: ["헤헤, 재밌다~"],
    sad: ["아~ 그렇게 됐구나…"],
    smug: ["으음~ 좋아, 좋아.", "뭐~ 이 정도면 괜찮지."],
    shrug: ["글쎄~ 잘 모르겠어."],
  },
  fidget: {
    cheer: ["앗싸, 됐다 됐어!", "예스! 이거지!"],
    shock: ["헐, 헐, 진짜?", "으악, 안 돼!"],
    laugh: ["아하하, 아 웃겨 진짜!"],
    sad: ["아 안 돼, 안 돼…"],
    smug: ["히히, 나 좀 잘하지?"],
    nervous: ["어떡해, 어떡해!"],
    clap: ["와, 최고다 진짜!"],
  },
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

/**
 * The ready-made cast's voices: a persona that fits the concept (words + manner) and a pitch
 * inside their gender's band, all different, so 하린 sounds like 하린 wherever she sits.
 * Keyed by preset id (stable, stored in profiles); the test checks every preset has one.
 */
export const PRESET_VOICES: Record<string, { persona: Persona; pitch: number }> = {
  haerin: { persona: "shy", pitch: 1.42 },
  yuna: { persona: "starer", pitch: 1.18 },
  sia: { persona: "fidget", pitch: 1.56 },
  chaewon: { persona: "focused", pitch: 1.24 },
  minji: { persona: "scanner", pitch: 1.36 },
  seoa: { persona: "starer", pitch: 1.1 },
  doyoon: { persona: "starer", pitch: 0.78 },
  jun: { persona: "dreamer", pitch: 0.83 },
  taeo: { persona: "shy", pitch: 0.95 },
  hyun: { persona: "focused", pitch: 0.88 },
  riku: { persona: "scanner", pitch: 0.98 },
  ian: { persona: "fidget", pitch: 1.02 },
  danbi: { persona: "shy", pitch: 1.5 },
  sua: { persona: "focused", pitch: 1.3 },
  bomi: { persona: "dreamer", pitch: 1.46 },
  ella: { persona: "scanner", pitch: 1.52 },
  nabi: { persona: "fidget", pitch: 1.62 },
  vita: { persona: "focused", pitch: 1.14 },
  ria: { persona: "dreamer", pitch: 1.2 },
  geonu: { persona: "focused", pitch: 0.73 },
  haechan: { persona: "scanner", pitch: 0.9 },
};

/** Everything that makes one character sound like themself. `slot` picks among installed Korean voices. */
export interface CharacterVoice extends VoiceProfile {
  gender: "f" | "m";
  persona: Persona;
  slot: number;
}

/**
 * The voice of whoever sits at `seat`: their chosen character's own voice if they picked one
 * from the cast, else a seat-based one in the gender they look (`gender`, default: the
 * seat's default look — women on even seats).
 */
export function characterVoice(seat: number, avatar?: AvatarProfile, gender?: "f" | "m"): CharacterVoice {
  const idx = avatar?.presetId ? CHARACTER_PRESETS.findIndex((p) => p.id === avatar.presetId) : -1;
  const preset = idx >= 0 ? CHARACTER_PRESETS[idx] : null;
  const own = preset ? PRESET_VOICES[preset.id] : undefined;
  const g = preset?.look.gender ?? avatar?.gender ?? gender ?? (seat % 2 === 0 ? "f" : "m");
  if (own) return { gender: g, persona: own.persona, pitch: own.pitch, ...MANNER[own.persona], slot: idx };
  const persona = personaFor(seat);
  return { gender: g, persona, ...voiceProfile(seat, g, persona), slot: seat };
}

/** One breath of a line, with its intonation relative to the speaker's own pitch and pace. */
export interface SpokenPhrase {
  text: string;
  pitch: number;
  rate: number;
}

/**
 * Caption → what the speech engine should say. TTS reads `~` aloud as "물결표" and gives every
 * word the same flat pitch, so the line is cut into phrases at `~`, `…` and sentence ends and
 * each one gets the contour a person would give it:
 *   `~`  drawn out and lilting up       (음~ 좋아 → a slow, rising "음", then "좋아")
 *   `…`  slower, falling, trailing off
 *   `!`  brighter and a touch quicker
 *   `?`  slight lift; the engine adds the question rise itself
 * Commas stay inside a phrase — the engine already pauses there, and too many separate
 * utterances sound choppy.
 */
export function spokenPhrases(line: string): SpokenPhrase[] {
  const out: SpokenPhrase[] = [];
  for (const m of line.matchAll(/([^~…!?.]*)([~…!?.]*)/g)) {
    const words = m[1].replace(/[^\p{L}\p{N}\s,]/gu, "").replace(/\s+/g, " ").replace(/^[\s,]+|[\s,]+$/g, "");
    if (!words) continue;
    const end = m[2];
    if (end.includes("~")) out.push({ text: words, pitch: 1.08, rate: 0.78 });
    else if (end.includes("…")) out.push({ text: `${words}.`, pitch: 0.92, rate: 0.85 });
    else if (end.includes("?")) out.push({ text: `${words}?`, pitch: end.includes("!") ? 1.1 : 1.04, rate: 1 });
    else if (end.includes("!")) out.push({ text: `${words}!`, pitch: 1.1, rate: 1.06 });
    else out.push({ text: `${words}.`, pitch: 1, rate: 1 });
  }
  return out;
}

/**
 * Only the big moments are spoken aloud: a win, a shock, a loss, being knocked out. Routine
 * moods (smug after submitting, nervous while waiting, a shrug on a pass …) come up nearly
 * every turn, so they stay caption-only — a voice each turn quickly turns into noise.
 */
const SPOKEN = new Set<VoicedMood>(["cheer", "shock", "sad", "slump"]);

/** Strong reactions may cut in over a line already playing; the rest wait their turn (are skipped). */
const URGENT = new Set<VoicedMood>(["shock", "cheer"]);

/**
 * perSeat/global: seconds between lines; urgent: a shock/cheer may speak this soon after the
 * last line (cutting it if still playing). Several turns pass between voices, so one stands out.
 */
export const VOICE_GAP = { perSeat: 30, global: 14, urgent: 6 };

/**
 * Rate limiter: who may speak at `now` (seconds). One voice at a time keeps a table of eight
 * from turning into noise; `busy` = a line is still playing.
 */
export class VoiceGate {
  private lastSeat = new Map<number, number>();
  private lastAny = -Infinity;

  allow(seat: number, mood: VoicedMood, now: number, busy: boolean): "speak" | "cut" | "skip" {
    if (!SPOKEN.has(mood)) return "skip";
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

/** A pass, said the character's way — short, since passes come every round. */
const PASS_LINES: Record<Persona, string[]> = {
  starer: ["패스.", "넘겨."],
  shy: ["저, 패스할게요…", "패스요…"],
  scanner: ["난 패스!", "패스, 패스!"],
  focused: ["패스.", "이번엔 넘긴다."],
  dreamer: ["음~ 패스.", "패스~"],
  fidget: ["패스 패스!", "아, 패스!"],
};

/**
 * A game's big call ("페루도", "코요테", "의심" …) said the character's way: the starer states it,
 * the shy one half-asks it, the fidget can't say it just once.
 */
export function callLine(persona: Persona, word: string): string {
  return {
    starer: `${word}.`,
    shy: `저, ${word}…`,
    scanner: `${word}!`,
    focused: `${word}.`,
    dreamer: `음~ ${word}.`,
    fidget: `${word}, ${word}!`,
  }[persona];
}

/** The `n`-th pass line for this character. */
export function passLine(persona: Persona, seat: number, n: number): string {
  const lines = PASS_LINES[persona];
  return lines[Math.floor(hash(seat + 3, n) * lines.length) % lines.length];
}

/** How a character greets you when picked in the profile — a preview of their voice. */
export function introLine(persona: Persona, name: string): string {
  return {
    starer: `${name}. 잘 부탁해.`,
    shy: `저, ${name}… 잘 부탁해요.`,
    scanner: `안녕! ${name}, 잘 부탁해!`,
    focused: `${name}. 같이 잘 해보자.`,
    dreamer: `음~ ${name}, 잘 부탁해~`,
    fidget: `안녕 안녕! ${name}, 잘 부탁해!`,
  }[persona];
}

/**
 * Which gender an installed Korean voice speaks in, from its name (null = can't tell).
 * Windows: Heami/SunHi (f), InJoon/Hyunsu (m); Chrome's network "Google 한국의" is a woman;
 * Android ships codes (ko-kr-x-ism/kob = f, koc/kod = m); iOS Yuna/Sora/Suhyun (f), Minsu (m).
 */
export function voiceGender(name: string): "f" | "m" | null {
  // "female" contains "male" — rule female names out before matching male ones
  if (/female|woman|여성|heami|sunhi|yuna|sora|jimin|seoyeon|nara|suhyun|google|x-ism|x-kob/i.test(name)) return "f";
  if (/male|\bman\b|남성|injoon|hyunsu|minho|jinho|minsu|x-koc|x-kod/i.test(name)) return "m";
  return null;
}

/**
 * With no voice of the character's gender installed (desktop Chrome on Windows has only women:
 * Heami + Google), pitch alone has to carry it: a man on a woman's voice goes well below his
 * usual pitch and a touch slower, a woman on a man's voice well above, so they still read as
 * the other gender rather than a slightly lower/higher copy of the same one.
 */
export const CROSS_VOICE: Record<"f" | "m", { pitch: number; rate: number }> = {
  m: { pitch: 0.75, rate: 0.94 },
  f: { pitch: 1.25, rate: 1.03 },
};

/** Seconds a waiting pass stays news; older ones are dropped (the bubble already showed it). */
export const PASS_STALE = 2.5;

/**
 * Passes take turns instead of cutting each other off. Bots pass 0.5–1.5 s apart while a pass
 * line takes about 1–1.5 s, so cutting the one playing chopped every line in a big game. Now a
 * line always finishes; while it plays, the newest pass waits (replacing any older waiting
 * one — at a fast table you hear the first and the latest, never fragments).
 */
export class PassQueue<T> {
  private waiting: { item: T; at: number } | null = null;

  /** A new pass at `now` (seconds): the item to speak right away, or null if it waits. */
  offer(item: T, now: number, busy: boolean): T | null {
    if (!busy) {
      this.waiting = null;
      return item;
    }
    this.waiting = { item, at: now };
    return null;
  }

  /** Once the voice is free: the waiting pass, unless it went stale. */
  take(now: number, busy: boolean): T | null {
    if (busy || !this.waiting) return null;
    const w = this.waiting;
    this.waiting = null;
    return now - w.at <= PASS_STALE ? w.item : null;
  }

  get pending(): boolean {
    return this.waiting !== null;
  }
}

// --- browser side -------------------------------------------------------------------------

const gate = new VoiceGate();
const said = new Map<number, number>();

/** An installed Korean voice for `gender`; `cross` = none of that gender, so the pitch has to carry it. */
function pickVoice(gender: "f" | "m", slot: number): { voice: SpeechSynthesisVoice | null; cross: boolean } {
  const ko = window.speechSynthesis.getVoices().filter((v) => v.lang?.toLowerCase().startsWith("ko") || /ko-kr/i.test(v.name));
  if (ko.length === 0) return { voice: null, cross: false };
  const want = ko.filter((v) => voiceGender(v.name) === gender);
  if (want.length > 0) return { voice: want[slot % want.length], cross: false };
  // unknown names may well be the right gender; only a table of known other-gender voices is cross
  const unknown = ko.filter((v) => voiceGender(v.name) === null);
  if (unknown.length > 0) return { voice: unknown[slot % unknown.length], cross: false };
  return { voice: ko[slot % ko.length], cross: true };
}

/**
 * The next line this seat says for `mood` (null for silent moods) — shown as a caption bubble
 * whether or not sound is on, then handed to `speakEmotion`, so players with the sound off
 * (or a device without a Korean voice) still get the reaction.
 */
export function nextEmotionLine(seat: number, mood: PersonMood, persona: Persona): string | null {
  if (!isVoiced(mood)) return null;
  const n = (said.get(seat) ?? 0) + 1;
  said.set(seat, n);
  return voiceLine(persona, mood, seat, n);
}

/** Queue `text` in `voice`, phrase by phrase (`pace` > 1 = hurried). The caller has already checked sound is on. */
function say(voice: CharacterVoice, text: string, pace = 1) {
  const synth = window.speechSynthesis;
  const volume = voice.volume * useAudioSettingsStore.getState().sfxVolume;
  try {
    const { voice: v, cross } = pickVoice(voice.gender, voice.slot);
    const shift = cross ? CROSS_VOICE[voice.gender] : { pitch: 1, rate: 1 };
    // queued back to back, so the phrases play as one line with a breath between them
    for (const ph of spokenPhrases(text)) {
      const u = new SpeechSynthesisUtterance(ph.text);
      u.lang = "ko-KR";
      u.pitch = Math.max(0, Math.min(2, voice.pitch * shift.pitch * ph.pitch));
      u.rate = voice.rate * shift.rate * ph.rate * pace;
      u.volume = volume;
      if (v) u.voice = v;
      synth.speak(u);
    }
  } catch {
    // an old WebView without SpeechSynthesisUtterance — voices are decoration, stay silent
  }
}

const canSpeak = () => typeof window !== "undefined" && "speechSynthesis" in window && !isSfxEffectivelyMuted(useAudioSettingsStore.getState());

/** Say `text` in this seat's voice, if sound is on, the mood is a big moment and the gate lets it through. Safe to call anywhere. */
export function speakEmotion(o: { seat: number; mood: PersonMood; voice: CharacterVoice; text: string }) {
  if (!isVoiced(o.mood) || !canSpeak()) return;
  const synth = window.speechSynthesis;
  const verdict = gate.allow(o.seat, o.mood, performance.now() / 1000, synth.speaking || synth.pending);
  if (verdict === "skip") return;
  if (verdict === "cut") synth.cancel();
  say(o.voice, o.text);
}

const lineQueue = new PassQueue<{ voice: CharacterVoice; text: string }>();
const passes = new Map<number, number>();
let queueTimer: number | null = null;

const voiceBusy = () => window.speechSynthesis.speaking || window.speechSynthesis.pending;

/**
 * Say a short table line (a pass, a game's call) in `voice` without cutting the line that is
 * playing — it waits its turn (see PassQueue) and, having waited, is said a bit quicker to
 * catch up with the table.
 */
function speakQueued(voice: CharacterVoice, text: string) {
  if (!canSpeak()) return;
  const ready = lineQueue.offer({ voice, text }, performance.now() / 1000, voiceBusy());
  if (ready) return say(ready.voice, ready.text);
  if (queueTimer !== null) return;
  queueTimer = window.setInterval(() => {
    const next = lineQueue.take(performance.now() / 1000, voiceBusy());
    if (next && canSpeak()) say(next.voice, next.text, 1.15);
    if (!lineQueue.pending && queueTimer !== null) {
      window.clearInterval(queueTimer);
      queueTimer = null;
    }
  }, 120);
}

/** A pass in this seat's character voice ("저, 패스할게요…" / "패스 패스!" …). Safe to call anywhere. */
export function speakPass(seat: number, voice: CharacterVoice) {
  const n = (passes.get(seat) ?? 0) + 1;
  passes.set(seat, n);
  speakQueued(voice, passLine(voice.persona, seat, n));
}

/** A game's call (`word`, e.g. "코요테") in this character's voice and manner. Safe to call anywhere. */
export function speakCall(voice: CharacterVoice, word: string) {
  speakQueued(voice, callLine(voice.persona, word));
}

/**
 * For games that build their own utterance (a narration, a shout): the installed voice and the
 * pitch/rate multipliers that make it this character. Null where speech isn't available.
 */
export function utteranceVoice(voice: CharacterVoice): { voice: SpeechSynthesisVoice | null; pitch: number; rate: number } | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  const { voice: v, cross } = pickVoice(voice.gender, voice.slot);
  const shift = cross ? CROSS_VOICE[voice.gender] : { pitch: 1, rate: 1 };
  return { voice: v, pitch: voice.pitch * shift.pitch, rate: voice.rate * shift.rate };
}

/** The picked cast character introduces themself in their own voice (profile preview). */
export function speakIntro(presetId: string) {
  const preset = CHARACTER_PRESETS.find((p) => p.id === presetId);
  if (!preset || !canSpeak()) return;
  const voice = characterVoice(0, { presetId });
  window.speechSynthesis.cancel();
  say(voice, introLine(voice.persona, preset.name));
}
