"use client";

/**
 * 변신 숨바꼭질 효과음 — 음원 파일 없이 WebAudio로 즉석 합성(가볍다).
 * 거리 감쇠는 부르는 쪽이 `vol`(0~1)로 넘긴다. 감정표현 대사는 브라우저 TTS.
 */

export type Sfx = "shot" | "sniper" | "shotgun" | "swing" | "catch" | "wrong" | "door" | "window" | "chest" | "tier" | "goal" | "escape" | "tick" | "start" | "decoy" | "pick" | "jump" | "seekerDown";

let ctx: AudioContext | null = null;
let muted = false;

function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!C) return null;
    ctx = new C();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export function setMuted(m: boolean) {
  muted = m;
  if (m && typeof window !== "undefined") window.speechSynthesis?.cancel();
}

export function isMuted() {
  return muted;
}

function tone(c: AudioContext, freq: number, dur: number, type: OscillatorType, gain: number, at = 0, slide?: number) {
  const o = c.createOscillator();
  const g = c.createGain();
  const t = c.currentTime + at;
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(c: AudioContext, dur: number, gain: number, at = 0, lp = 3000) {
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = lp;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(c.destination);
  src.start(c.currentTime + at);
}

export function play(s: Sfx, vol = 1) {
  if (muted || vol <= 0.02) return;
  const c = ac();
  if (!c) return;
  const v = Math.min(1, vol) * 0.5;
  switch (s) {
    case "shot":
      noise(c, 0.18, v * 0.9, 0, 2600);
      tone(c, 180, 0.12, "square", v * 0.25, 0, 60);
      break;
    case "shotgun":
      noise(c, 0.35, v, 0, 1800);
      tone(c, 120, 0.25, "square", v * 0.3, 0, 40);
      break;
    case "sniper":
      noise(c, 0.5, v, 0, 4000);
      tone(c, 900, 0.4, "sawtooth", v * 0.15, 0, 120);
      break;
    case "swing":
      noise(c, 0.16, v * 0.35, 0, 1200);
      break;
    case "catch":
      tone(c, 523, 0.12, "triangle", v * 0.6);
      tone(c, 784, 0.12, "triangle", v * 0.6, 0.1);
      tone(c, 1046, 0.3, "triangle", v * 0.6, 0.2);
      break;
    case "wrong":
      tone(c, 220, 0.18, "sawtooth", v * 0.4);
      tone(c, 160, 0.3, "sawtooth", v * 0.4, 0.15);
      break;
    case "door":
      tone(c, 140, 0.35, "sawtooth", v * 0.15, 0, 260);
      noise(c, 0.12, v * 0.3, 0.3, 700);
      break;
    case "window":
      tone(c, 900, 0.18, "sine", v * 0.15, 0, 600);
      break;
    case "chest":
      [660, 880, 1100, 1320].forEach((f, i) => tone(c, f, 0.18, "triangle", v * 0.4, i * 0.08));
      break;
    case "tier":
      tone(c, 392, 0.15, "square", v * 0.25);
      tone(c, 523, 0.15, "square", v * 0.25, 0.12);
      tone(c, 659, 0.35, "square", v * 0.25, 0.24);
      break;
    case "goal":
      [523, 659, 784, 1046].forEach((f, i) => tone(c, f, 0.25, "triangle", v * 0.45, i * 0.12));
      break;
    case "escape":
      [784, 988, 1175, 1568].forEach((f, i) => tone(c, f, 0.2, "sine", v * 0.5, i * 0.07));
      break;
    case "tick":
      tone(c, 1200, 0.05, "square", v * 0.15);
      break;
    case "start":
      tone(c, 440, 0.2, "square", v * 0.3);
      tone(c, 880, 0.45, "square", v * 0.3, 0.2);
      break;
    case "decoy":
      tone(c, 300, 0.2, "sine", v * 0.4, 0, 900);
      break;
    case "pick":
      tone(c, 700, 0.08, "triangle", v * 0.4);
      tone(c, 1050, 0.12, "triangle", v * 0.4, 0.07);
      break;
    case "jump":
      tone(c, 300, 0.12, "sine", v * 0.15, 0, 600);
      break;
    case "seekerDown":
      tone(c, 400, 0.6, "sawtooth", v * 0.35, 0, 80);
      break;
  }
}

/** 감정표현 대사 — 짧은 음성 + 효과음 */
export function speak(line: string, vol = 1) {
  if (muted || vol <= 0.05 || typeof window === "undefined" || !window.speechSynthesis) return;
  try {
    const u = new SpeechSynthesisUtterance(line);
    u.lang = "ko-KR";
    u.volume = Math.min(1, vol);
    u.rate = 1.15;
    u.pitch = 1.3;
    window.speechSynthesis.speak(u);
  } catch {
    // 음성 미지원 — 말풍선만
  }
}

/** 거리 → 음량 (25m 밖은 안 들림) */
export function falloff(d: number): number {
  return Math.max(0, 1 - d / 25) ** 1.5;
}
