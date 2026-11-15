import { LANES, STYLE_IDS, type Difficulty, type StyleChoice, type StyleId } from "./data";

/**
 * 곡과 채보 만들기 (룰북 §3). 씨앗·라운드·스타일·난이도만으로 정해지므로 방장·손님이 같은 곡을
 * 각자 만든다 — 네트워크로 채보를 보내지 않는다.
 *
 * 곡 = 카운트인 1마디 + 인트로 2 + A 8 + B 8 + 브리지 4 + A′ 4 + B′ 8 = 35마디.
 * 멜로디를 먼저 만들고(마디마다 리듬 틀 + 음계 위 걸음), 그 음이 곧 노트가 된다 — 치는 박자가
 * 들리는 선율과 맞는다. 쉬움은 멜로디 일부만(8분음표 격자), 어려움은 더 빽빽한 리듬 + 동시치기.
 */

export interface StyleSpec {
  id: StyleId;
  name: string;
  emoji: string;
  bpm: number;
  /** 으뜸음 (MIDI) */
  root: number;
  scale: number[];
  /** 4마디 화음 진행들 (음계 도수) */
  progs: number[][];
  bass: string;
  chord: string;
  lead: string;
  desc: string;
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];

export const STYLES: Record<StyleId, StyleSpec> = {
  polka: { id: "polka", name: "깡충 폴카", emoji: "🎪", bpm: 126, root: 62, scale: MAJOR, progs: [[0, 3, 4, 0], [0, 5, 3, 4]], bass: "upright", chord: "pizz", lead: "marimba", desc: "밝고 통통 튀는 126 BPM — 처음 하기 좋아요" },
  city: { id: "city", name: "밤의 도시", emoji: "🌃", bpm: 108, root: 57, scale: MINOR, progs: [[0, 5, 2, 6], [0, 3, 5, 4]], bass: "synthBass", chord: "epiano", lead: "lead", desc: "느긋한 108 BPM 신스 — 엇박이 많아요" },
  rush: { id: "rush", name: "드럼 러시", emoji: "🔥", bpm: 148, root: 52, scale: MINOR, progs: [[0, 0, 5, 6], [0, 2, 5, 4]], bass: "chipBass", chord: "stab", lead: "chip", desc: "148 BPM 질주 — 손이 바빠요" },
};

export interface SongNote {
  /** 곡 시각 (ms) */
  t: number;
  lane: number;
  /** 박자 번호 (소수) — 장난 구간 판단용 */
  beat: number;
}

export interface AudioEvent {
  t: number;
  inst: string;
  freq: number;
  /** 초 */
  dur: number;
  gain: number;
}

export interface Song {
  style: StyleId;
  bpm: number;
  beatMs: number;
  barMs: number;
  bars: number;
  lengthMs: number;
  totalBeats: number;
  notes: SongNote[];
  audio: AudioEvent[];
  /** 마디별 구간 이름 (HUD) */
  sections: { bar: number; name: string }[];
}

function mulberry(seed: number) {
  let a = seed | 0;
  return () => {
    let t = (a = (a + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const freqOf = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/** 마디 구성: [이름, 길이(마디), 밀도 0~3] */
const FORM: [string, number, number][] = [
  ["인트로", 2, 0],
  ["A", 8, 1],
  ["B", 8, 2],
  ["브리지", 4, 1],
  ["A′", 4, 2],
  ["B′", 8, 3],
];

/** 밀도별 리듬 틀 (한 마디 16칸 중 음이 나오는 칸) */
const RHYTHMS: number[][][] = [
  [[0, 8], [0, 4, 8, 12], [0, 8, 12]],
  [[0, 4, 8, 12], [0, 4, 6, 8, 12], [0, 4, 8, 10, 12], [0, 6, 8, 12], [0, 4, 8, 12, 14]],
  [[0, 2, 4, 8, 10, 12], [0, 4, 6, 8, 12, 14], [0, 2, 4, 6, 8, 12], [0, 3, 6, 8, 12, 14], [0, 2, 4, 8, 12, 14]],
  [[0, 2, 4, 6, 8, 10, 12, 14], [0, 2, 3, 4, 8, 10, 11, 12], [0, 2, 4, 6, 8, 9, 10, 12, 14], [0, 1, 2, 4, 6, 8, 10, 12, 13, 14], [0, 2, 4, 6, 7, 8, 10, 12, 14]],
];

export function resolveStyle(choice: StyleChoice, seed: number, round: number): StyleId {
  if (choice !== "random") return choice;
  // 라운드마다 다른 스타일이 나오게 씨앗에서 시작점만 정하고 차례로 돈다
  const start = Math.abs(seed | 0) % STYLE_IDS.length;
  return STYLE_IDS[(start + round - 1) % STYLE_IDS.length];
}

const cache = new Map<string, Song>();

export function buildSong(seed: number, round: number, choice: StyleChoice, difficulty: Difficulty): Song {
  const style = resolveStyle(choice, seed, round);
  const key = `${seed}:${round}:${style}:${difficulty}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const spec = STYLES[style];
  const rnd = mulberry((seed ^ (round * 0x9e3779b9)) + 17);
  const ri = (n: number) => Math.floor(rnd() * n);
  const beatMs = 60000 / spec.bpm;
  const stepMs = beatMs / 4;
  const barMs = beatMs * 4;
  const bars = 1 + FORM.reduce((a, f) => a + f[1], 0);
  const audio: AudioEvent[] = [];
  const notes: SongNote[] = [];
  const sections: Song["sections"] = [];
  const stepS = stepMs / 1000;
  // 드럼은 음높이 배수(1 = 원래 소리)를, 나머지는 MIDI 번호를 넘긴다
  const add = (bar: number, step: number, inst: string, midiOrFreq: number, steps: number, gain: number, isFreq = false) => audio.push({ t: bar * barMs + step * stepMs, inst, freq: isFreq ? midiOrFreq : freqOf(midiOrFreq), dur: steps * stepS, gain });
  const degMidi = (deg: number) => spec.root + spec.scale[((deg % 7) + 7) % 7] + 12 * Math.floor(deg / 7);

  // 카운트인: 네 번 똑딱
  for (let b = 0; b < 4; b++) add(0, b * 4, "woodblock", b === 3 ? 1.35 : 1, 1, 0.9, true);

  const prog = spec.progs[ri(spec.progs.length)];
  const progB = spec.progs[(spec.progs.indexOf(prog) + 1) % spec.progs.length];
  let bar = 1;
  let deg = 4; // 멜로디 위치 (음계 도수, 0 = 으뜸음)
  let lane = 1 + ri(2);
  let sameRun = 0;
  for (const [name, len, density] of FORM) {
    sections.push({ bar, name });
    const useProg = name.startsWith("B") ? progB : prog;
    // 구간마다 리듬 틀 두 개를 골라 번갈아 쓴다 (듣기에 반복이 느껴지게)
    const mel = Math.min(3, density + (difficulty === "hard" ? 1 : 0));
    const ra = RHYTHMS[mel][ri(RHYTHMS[mel].length)];
    const rb = RHYTHMS[mel][ri(RHYTHMS[mel].length)];
    for (let k = 0; k < len; k++, bar++) {
      const chordDeg = useProg[k % 4];
      const rootMidi = degMidi(chordDeg);
      const last = k === len - 1;
      /* 드럼 */
      const kick = density >= 2 ? [0, 6, 8, 14] : density === 1 ? [0, 8, 10] : [0, 8];
      for (const st of style === "rush" && density >= 2 ? [0, 4, 8, 12] : kick) add(bar, st, style === "polka" ? "softKick" : "kick", 1, 2, 0.8, true);
      if (density >= 1) for (const st of [4, 12]) add(bar, st, style === "polka" ? "rim" : "snare", 1, 2, style === "polka" ? 0.5 : 0.55, true);
      if (density >= 3) for (const st of [4, 12]) add(bar, st, "clap", 1, 2, 0.4, true);
      const hatStep = density >= 3 || style === "rush" ? 1 : 2;
      for (let st = density === 0 ? 2 : 0; st < 16; st += hatStep) add(bar, st, style === "polka" ? "shaker" : "hat", 1, 1, st % 4 === 2 ? 0.3 : 0.18, true);
      if (last && density >= 1) for (const st of [12, 13, 14, 15]) add(bar, st, "tom", 1 - (st - 12) * 0.1, 1, 0.45, true);
      /* 베이스 */
      const bassSteps = style === "rush" ? [0, 2, 4, 6, 8, 10, 12, 14] : style === "city" ? [0, 6, 8, 11, 14] : [0, 8];
      for (const st of bassSteps) add(bar, st, spec.bass, rootMidi - 24 + (style === "polka" && st === 8 ? 7 : 0), 2, 0.75);
      /* 화음 */
      const triad = [chordDeg, chordDeg + 2, chordDeg + 4].map(degMidi);
      const chordSteps = style === "polka" ? [4, 12] : style === "city" ? [0, 6] : [0, 3, 6, 10];
      if (density >= 1 || style !== "rush") for (const st of chordSteps) for (const m of triad) add(bar, st, spec.chord, m - (style === "polka" ? 0 : 12), style === "city" ? 5 : 2, 0.22);
      /* 멜로디 → 노트 */
      const rhythm = k % 2 === 0 ? ra : rb;
      for (let i = 0; i < rhythm.length; i++) {
        const st = rhythm[i];
        const prevDeg = deg;
        if (st === 0) {
          // 마디 첫 음은 화음 구성음으로
          const tones = [chordDeg, chordDeg + 2, chordDeg + 4, chordDeg + 7];
          let best = tones[0];
          for (const tn of tones) if (Math.abs(tn - deg) < Math.abs(best - deg)) best = tn;
          deg = best;
        } else deg += [-2, -1, -1, 1, 1, 2, 0][ri(7)];
        if (deg < 0) deg += 3;
        if (deg > 11) deg -= 3;
        const next = rhythm[i + 1] ?? 16;
        add(bar, st, spec.lead, degMidi(deg) + 12, Math.min(3, next - st), 0.5);
        // 쉬움: 8분음표 격자의 음만, 그리고 밀도 높은 구간은 한 칸 걸러
        if (difficulty === "easy" && (st % 2 === 1 || (mel >= 2 && st % 4 === 2 && rnd() < 0.6))) continue;
        const move = Math.sign(deg - prevDeg);
        let nl = lane + move;
        if (move === 0) nl = sameRun >= 1 ? lane + (rnd() < 0.5 ? 1 : -1) : lane;
        if (nl < 0) nl = 1;
        if (nl >= LANES) nl = LANES - 2;
        sameRun = nl === lane ? sameRun + 1 : 0;
        lane = nl;
        const t = bar * barMs + st * stepMs;
        notes.push({ t, lane, beat: t / beatMs });
        // 어려움: 마지막 구간들의 큰 박에 동시치기
        if (difficulty === "hard" && density >= 2 && (st === 0 || st === 8)) notes.push({ t, lane: (lane + 2) % LANES, beat: t / beatMs });
      }
    }
  }
  // 끝음
  add(bar - 1, 16, spec.lead, degMidi(0) + 12, 6, 0.6);
  for (const m of [0, 2, 4].map(degMidi)) add(bar - 1, 16, spec.chord, m, 8, 0.3);
  add(bar - 1, 16, style === "polka" ? "softKick" : "kick", 1, 2, 0.9, true);
  notes.sort((a, b) => a.t - b.t || a.lane - b.lane);
  audio.sort((a, b) => a.t - b.t);
  const song: Song = { style, bpm: spec.bpm, beatMs, barMs, bars, lengthMs: bars * barMs + beatMs * 2, totalBeats: bars * 4, notes, audio, sections };
  if (cache.size > 16) cache.clear();
  cache.set(key, song);
  return song;
}

export function sectionAt(song: Song, t: number): string {
  const bar = Math.floor(t / song.barMs);
  let name = "카운트인";
  for (const s of song.sections) if (bar >= s.bar) name = s.name;
  return name;
}
