/**
 * 마피아 전용 페이즈 반응형 배경음악 — Web Audio 오실레이터/노이즈 합성으로만
 * 만든다. 실제 음원 파일(mp3 등)은 쓰지 않는다: `저작권, 상표권.md`가
 * "배경음악"을 명시적으로 보호 대상 표현으로 분류해 두었고, `bgmManager.ts`
 * 헤더가 밝히듯 이 프로젝트는 지금까지 실제 오디오 파일을 커밋한 적이 없다
 * (6개 허브 게임의 `<audio>` 트랙도 사용자가 직접 로열티프리 파일을 내려받아
 * 채워 넣는 구조). 그래서 `bgmManager.ts`(파일 기반)가 아니라 `soundEngine.ts`의
 * 합성 기법을 따라, 이 게임 전용 페이즈 트랙 3종(밤 드론/낮 토론 틱톡/최후
 * 변론·투표 심장박동)을 직접 오실레이터로 만든다.
 *
 * 뮤트/볼륨은 이 파일이 따로 들고 있지 않고 `audioSettings.ts`의 공유 스토어
 * (`bgmMuted`+`bgmVolume`, `masterMuted`)를 그대로 읽는다 — 헤더의 전역 토글이나
 * 설정 모달과 항상 같은 상태를 보여주기 위해서다(다른 모든 게임의 뮤트 버튼과
 * 동일 원칙, `soundEngine.ts` 파일 헤더 참고).
 */

import { isBgmEffectivelyMuted, useAudioSettingsStore } from "@/lib/audio/audioSettings";
import type { Phase } from "./engine";

/** 페이즈 전환 시 크로스페이드 소요 시간(초) — 이전 트랙 페이드아웃과 새 트랙 페이드인이 동시에 진행된다. */
const CROSSFADE_SECONDS = 1.5;

type PhaseTrack = "night" | "discuss" | "verdict" | "silence";

/** 엔진의 9단계 `Phase`를 3가지 사운드스케이프로 묶는다. */
function trackForPhase(phase: Phase): PhaseTrack {
  switch (phase) {
    case "night":
      return "night";
    case "dayAnnounce":
    case "dayDiscuss":
    case "nomination":
      return "discuss";
    case "defense":
    case "finalVote":
    case "execution":
    case "terroristRevenge":
      return "verdict";
    case "gameOver":
      return "silence";
  }
}

function noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

interface TrackHandle {
  /** 자신의 트랙 게인만 0으로 램프시키고, 노드는 램프가 끝난 뒤 정리한다 — 새 트랙의 페이드인과 동시에 진행되어야 크로스페이드가 된다. */
  stop: (fadeSeconds: number) => void;
}

class MafiaBgmEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private current: TrackHandle | null = null;
  private currentTrack: PhaseTrack | null = null;
  private subscribed = false;

  private targetVolume(): number {
    const settings = useAudioSettingsStore.getState();
    return isBgmEffectivelyMuted(settings) ? 0 : settings.bgmVolume;
  }

  private ensureContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.targetVolume();
      this.masterGain.connect(this.ctx.destination);
      this.subscribeToSettings();
    }
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  private subscribeToSettings() {
    if (this.subscribed) return;
    this.subscribed = true;
    useAudioSettingsStore.subscribe(() => {
      if (this.masterGain && this.ctx) {
        this.masterGain.gain.setTargetAtTime(this.targetVolume(), this.ctx.currentTime, 0.05);
      }
    });
  }

  /** 사용자 제스처(클릭/탭) 핸들러 안에서 최소 1회 호출 — 브라우저의 오디오 자동재생 제약 해제. */
  unlock() {
    this.ensureContext();
  }

  /** 현재 페이즈에 맞는 트랙으로 1.5초 크로스페이드 전환. 같은 트랙 그룹이면 아무것도 하지 않는다(같은 낮 토론 하위 페이즈끼리 전환 시 끊김 없음). */
  transitionToPhase(phase: Phase) {
    const track = trackForPhase(phase);
    if (track === this.currentTrack) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;

    if (this.current) {
      this.current.stop(CROSSFADE_SECONDS);
      this.current = null;
    }
    this.currentTrack = track;

    if (track === "night") this.current = this.playNightDrone(ctx, this.masterGain);
    else if (track === "discuss") this.current = this.playDiscussionPulse(ctx, this.masterGain);
    else if (track === "verdict") this.current = this.playVerdictHeartbeat(ctx, this.masterGain);
    // "silence"(게임 종료)는 위에서 이미 이전 트랙을 페이드아웃했으니 그대로 둔다.
  }

  /** 컴포넌트 언마운트 시 즉시 정리(페이드아웃은 유지) — 다음 방 입장 때 새 인스턴스처럼 깨끗하게 시작하도록. */
  stop() {
    if (this.current) {
      this.current.stop(CROSSFADE_SECONDS);
      this.current = null;
    }
    this.currentTrack = null;
  }

  // ---------------------------------------------------------------------
  // 페이즈별 트랙 합성
  // ---------------------------------------------------------------------

  /** [밤] 43.65Hz+65.41Hz 저역 드론 + 저역통과 톱니파로 두께 추가 + 느리게 일렁이는 밴드패스 노이즈(차가운 바람). */
  private playNightDrone(ctx: AudioContext, out: GainNode): TrackHandle {
    const now = ctx.currentTime;
    const trackGain = ctx.createGain();
    trackGain.gain.setValueAtTime(0, now);
    trackGain.gain.linearRampToValueAtTime(1, now + CROSSFADE_SECONDS);
    trackGain.connect(out);

    const osc1 = ctx.createOscillator();
    osc1.type = "sine";
    osc1.frequency.value = 43.65; // F1
    const osc2 = ctx.createOscillator();
    osc2.type = "sawtooth";
    osc2.frequency.value = 65.41; // C2
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 160;
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.5;
    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(droneGain).connect(trackGain);
    osc1.start(now);
    osc2.start(now);

    const windSrc = ctx.createBufferSource();
    windSrc.buffer = noiseBuffer(ctx, 4);
    windSrc.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = "bandpass";
    windFilter.frequency.value = 500;
    windFilter.Q.value = 0.6;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.06;
    windSrc.connect(windFilter).connect(windGain).connect(trackGain);
    windSrc.start(now);

    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 0.05;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 250;
    lfo.connect(lfoGain).connect(windFilter.frequency);
    lfo.start(now);

    let stopped = false;
    return {
      stop: (fadeSeconds) => {
        if (stopped || !this.ctx) return;
        stopped = true;
        const t = this.ctx.currentTime;
        trackGain.gain.cancelScheduledValues(t);
        trackGain.gain.setValueAtTime(trackGain.gain.value, t);
        trackGain.gain.linearRampToValueAtTime(0, t + fadeSeconds);
        setTimeout(() => {
          try {
            osc1.stop();
            osc2.stop();
            windSrc.stop();
            lfo.stop();
            trackGain.disconnect();
          } catch {
            // 이미 정지된 노드 — 무해.
          }
        }, fadeSeconds * 1000 + 100);
      },
    };
  }

  /** [낮 토론] ~72bpm 금속 시계추 틱톡(정박마다) + 첼로 피치카토(짝수 박마다, 저역통과 톱니파). */
  private playDiscussionPulse(ctx: AudioContext, out: GainNode): TrackHandle {
    const now = ctx.currentTime;
    const trackGain = ctx.createGain();
    trackGain.gain.setValueAtTime(0, now);
    trackGain.gain.linearRampToValueAtTime(1, now + CROSSFADE_SECONDS);
    trackGain.connect(out);

    let running = true;
    let step = 0;
    const beatSeconds = 60 / 72;

    const scheduleTick = () => {
      if (!running || !this.ctx) return;
      const t = this.ctx.currentTime;

      const tick = this.ctx.createOscillator();
      tick.type = "square";
      tick.frequency.value = step % 2 === 0 ? 1500 : 1100;
      const tickFilter = this.ctx.createBiquadFilter();
      tickFilter.type = "highpass";
      tickFilter.frequency.value = 800;
      const tickGain = this.ctx.createGain();
      tickGain.gain.setValueAtTime(0.09, t);
      tickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      tick.connect(tickFilter).connect(tickGain).connect(trackGain);
      tick.start(t);
      tick.stop(t + 0.06);

      if (step % 2 === 0) {
        const cello = this.ctx.createOscillator();
        cello.type = "sawtooth";
        cello.frequency.value = 110; // A2
        const celloFilter = this.ctx.createBiquadFilter();
        celloFilter.type = "lowpass";
        celloFilter.frequency.value = 500;
        const celloGain = this.ctx.createGain();
        celloGain.gain.setValueAtTime(0.14, t);
        celloGain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
        cello.connect(celloFilter).connect(celloGain).connect(trackGain);
        cello.start(t);
        cello.stop(t + 0.4);
      }

      step++;
      setTimeout(scheduleTick, beatSeconds * 1000);
    };
    scheduleTick();

    let stopped = false;
    return {
      stop: (fadeSeconds) => {
        if (stopped || !this.ctx) return;
        stopped = true;
        running = false;
        const t = this.ctx.currentTime;
        trackGain.gain.cancelScheduledValues(t);
        trackGain.gain.setValueAtTime(trackGain.gain.value, t);
        trackGain.gain.linearRampToValueAtTime(0, t + fadeSeconds);
        setTimeout(() => {
          try {
            trackGain.disconnect();
          } catch {
            // 이미 정지된 노드 — 무해.
          }
        }, fadeSeconds * 1000 + 100);
      },
    };
  }

  /** [최후 변론 / 찬반 투표 / 집행 / 길동무] ~120bpm 서브베이스 킥 + 반박마다 트레몰로풍 바이올린 스팅(밴드패스 톱니파). */
  private playVerdictHeartbeat(ctx: AudioContext, out: GainNode): TrackHandle {
    const now = ctx.currentTime;
    const trackGain = ctx.createGain();
    trackGain.gain.setValueAtTime(0, now);
    trackGain.gain.linearRampToValueAtTime(1, now + CROSSFADE_SECONDS);
    trackGain.connect(out);

    let running = true;
    const beatSeconds = 60 / 120;

    const pulse = () => {
      if (!running || !this.ctx) return;
      const t = this.ctx.currentTime;

      const kick = this.ctx.createOscillator();
      kick.type = "sine";
      kick.frequency.setValueAtTime(90, t);
      kick.frequency.exponentialRampToValueAtTime(35, t + 0.15);
      const kickGain = this.ctx.createGain();
      kickGain.gain.setValueAtTime(0.32, t);
      kickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      kick.connect(kickGain).connect(trackGain);
      kick.start(t);
      kick.stop(t + 0.2);

      const stingAt = t + beatSeconds * 0.5;
      const violin = this.ctx.createOscillator();
      violin.type = "sawtooth";
      violin.frequency.value = 880;
      const violinFilter = this.ctx.createBiquadFilter();
      violinFilter.type = "bandpass";
      violinFilter.frequency.value = 1200;
      violinFilter.Q.value = 3;
      const violinGain = this.ctx.createGain();
      violinGain.gain.setValueAtTime(0.05, stingAt);
      violinGain.gain.exponentialRampToValueAtTime(0.001, stingAt + 0.12);
      violin.connect(violinFilter).connect(violinGain).connect(trackGain);
      violin.start(stingAt);
      violin.stop(stingAt + 0.14);

      setTimeout(pulse, beatSeconds * 1000);
    };
    pulse();

    let stopped = false;
    return {
      stop: (fadeSeconds) => {
        if (stopped || !this.ctx) return;
        stopped = true;
        running = false;
        const t = this.ctx.currentTime;
        trackGain.gain.cancelScheduledValues(t);
        trackGain.gain.setValueAtTime(trackGain.gain.value, t);
        trackGain.gain.linearRampToValueAtTime(0, t + fadeSeconds);
        setTimeout(() => {
          try {
            trackGain.disconnect();
          } catch {
            // 이미 정지된 노드 — 무해.
          }
        }, fadeSeconds * 1000 + 100);
      },
    };
  }
}

let instance: MafiaBgmEngine | null = null;

export function getMafiaBgm(): MafiaBgmEngine {
  if (!instance) instance = new MafiaBgmEngine();
  return instance;
}
