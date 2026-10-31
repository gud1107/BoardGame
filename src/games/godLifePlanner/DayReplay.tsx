"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ACTIVITY_INFO, BLOCK_INFO, DAY_NAMES, OPPORTUNITY_BY_ID, TEMPTATIONS, TRACKS, TRACK_INFO, TUNING, type Track } from "./data";
import { resistCost, type BlockOutcome, type DayRecord, type GameState, type Tracks } from "./engine";
import { cellArg, getGodLifePlannerSound } from "./godLifePlannerSound";
import VlogStage, { type VlogClip } from "./VlogStage";
import { narrate, setVoicePref, speechSupported, unlockVoice, useVoicePref } from "./vlogVoice";
import { isSfxEffectivelyMuted, useAudioSettingsStore } from "@/lib/audio/audioSettings";
import { characterVoice } from "@/lib/audio/characterVoice";
import { useMyCharacter } from "@/lib/character/myCharacter";

/**
 * 하루 재생 — 내가 짠 계획이 B1(0시)부터 B8(24시)까지 실행되며 체력·멘탈·트랙이 어떻게 변하는지
 * 한 블록씩 애니메이션으로 보여 준다. 실제 결과(`dayResult`)와 계획 미리보기(`previewDay`)가 같은
 * `DayRecord`를 쓰므로 선택을 바꾸면 영상도 그대로 바뀐다. 표시만 하고 상태는 건드리지 않는다.
 */

interface Props {
  state: GameState;
  rec: DayRecord;
  /** 마감 뒤 트랙(수면 부족·생일 등 마감 보정 포함) */
  endTracks: Tracks;
  /** 미리보기면 약속 성사·기회 카드 경쟁이 빠진 예상이라고 알린다 */
  preview?: boolean;
  /** true면 마운트될 때 자동 재생 */
  autoPlay?: boolean;
  onClose?: () => void;
}

interface Frame {
  label: string;
  sub: string;
  hp: number;
  mp: number;
  tracks: Tracks;
  outcome: BlockOutcome | null;
  /** 떠오르는 변화 표시 */
  pops: { text: string; tone: "good" | "bad" | "info" }[];
  collapse: "exhausted" | "burnout" | null;
}

// 시간대별 하늘(심야 → 새벽 → 아침 → 낮 → 저녁 → 밤)
const SKY = [
  "linear-gradient(180deg,#0b1026,#1e1b4b)",
  "linear-gradient(180deg,#1e1b4b,#4c1d95 70%,#9d174d)",
  "linear-gradient(180deg,#fb923c,#fcd34d 60%,#fde68a)",
  "linear-gradient(180deg,#38bdf8,#7dd3fc 70%,#bae6fd)",
  "linear-gradient(180deg,#0ea5e9,#38bdf8 60%,#a5f3fc)",
  "linear-gradient(180deg,#f59e0b,#fbbf24 60%,#fde68a)",
  "linear-gradient(180deg,#7c3aed,#db2777 65%,#f97316)",
  "linear-gradient(180deg,#0f172a,#312e81)",
];
const SKY_START = "linear-gradient(180deg,#334155,#475569)";
const SKY_END = "linear-gradient(180deg,#111827,#1f2937)";
const NIGHT = new Set([0, 1, 7]);

function clampG(n: number) {
  return Math.max(0, Math.min(TUNING.gaugeMax, n));
}

interface Shot {
  clip: VlogClip;
  /** 화면 자막 */
  caption: string;
  /** 내레이션 — 브이로거가 카메라에 말하듯 */
  speech: string;
  /** 촬영 장소 태그 */
  place: string;
}

/** 내레이션용 "n째 날" — 숫자를 넘기면 TTS가 "데이 이"처럼 읽는다. */
const NTH_DAY = ["첫째", "둘째", "셋째", "넷째", "다섯째", "여섯째", "일곱째"];

/** 프레임마다 깔 영상·자막·내레이션. */
function vlogShot(f: Frame, i: number, last: number, rec: DayRecord, day: number): Shot {
  const o = f.outcome;
  const dayName = `${DAY_NAMES[day]}요일`;
  if (i === 0)
    return {
      clip: "wake",
      caption: `Day ${day + 1} · ${dayName} 갓생 브이로그 시작 🌅`,
      speech: day === 0 ? `안녕하세요, 갓생로그예요. 오늘부터 일주일 동안 갓생 살기 도전합니다. 첫날 ${dayName}, 시작해 볼게요.` : `안녕하세요, 갓생로그예요. 오늘은 ${dayName}, 도전 ${NTH_DAY[day] ?? "마지막"} 날! 오늘도 시작해 볼게요.`,
      place: "🏠 내 방",
    };
  if (!o || i === last) {
    const rough = rec.exhausted || rec.burnout;
    return {
      clip: "dusk",
      caption: rough ? "오늘은 좀 무리했다… 내일은 쉬엄쉬엄 🌙" : "오늘 하루 끝! 수고했어 나 자신 🌙",
      speech: rough ? "오늘은 진짜 좀 무리했네요. 내일은 쉬엄쉬엄 해 볼게요. 다들 푹 쉬세요." : "오늘 하루도 끝! 수고했어요 나 자신. 구독이랑 좋아요는 갓생의 시작이에요. 내일 또 만나요!",
      place: "🌃 서울의 밤",
    };
  }
  if (f.collapse)
    return f.collapse === "exhausted"
      ? { clip: "collapse", caption: "더는 못 버티겠다… 완전 방전 🥵", speech: "아, 더는 못 버티겠어요. 완전히 방전됐어요.", place: "😵 기절 직전" }
      : { clip: "collapse", caption: "멘탈 바닥… 아무것도 하기 싫다 😵", speech: "멘탈이 바닥났어요. 진짜 아무것도 하기 싫어요.", place: "😵 번아웃" };
  const b = i - 1;
  const lucky = o.opp ? " · 🍀 기회 잡았다!" : "";
  const luckySay = o.opp ? " 그리고 오늘 좋은 기회까지 잡았어요!" : "";
  if (o.kind === "fail") return { clip: "tired", caption: "하려고 했는데… 힘이 없어서 포기 😣", speech: "하려고 했는데, 너무 힘들어서 결국 포기했어요.", place: "😮‍💨 체력 바닥" };
  if (o.kind === "void") return { clip: "collapse", caption: "쓰러져서 아무것도 못 했다 🫥", speech: "쓰러져서 아무것도 못 했어요.", place: "😮‍💨 기절" };
  if (o.kind === "nap") return { clip: "sleep", caption: "잠깐 누웠는데 그대로 기절 💤", speech: "잠깐 눕기만 했는데, 그대로 잠들어 버렸어요.", place: "🛏️ 침대" };
  if (o.noShow) return { clip: "tired", caption: "약속 펑크 냈다… 미안해 🙇", speech: "약속을 펑크 내 버렸어요. 친구야, 진짜 미안해.", place: "📱 미안 문자 중" };
  switch (o.cell) {
    case "sleep":
      return NIGHT.has(b)
        ? { clip: "sleep", caption: "꿀잠 충전 중… 쿨쿨 😴", speech: "지금은 꿀잠 자는 중이에요. 잠이 보약이죠.", place: "🛏️ 침실" }
        : { clip: "sleep", caption: "낮잠으로 체력 보충 😴", speech: "잠깐 낮잠으로 체력 충전할게요.", place: "🛏️ 침실" };
    case "study":
      return { clip: "study", caption: `집중 모드 ON, 오늘도 공부 📘${lucky}`, speech: `지금은 공부 시간이에요. 오늘도 조금씩 쌓아 갑니다.${luckySay}`, place: "📚 책상" };
    case "exercise":
      return b <= 2
        ? { clip: "exercise", caption: `아침 운동 인증 💪 땀 한 바가지${lucky}`, speech: `아침 운동 인증! 하고 나면 몸이 확실히 가벼워요.${luckySay}`, place: "🧘 홈트" }
        : { clip: "exercise", caption: `오늘 운동 완료 💪 몸이 가볍다${lucky}`, speech: `운동 끝! 땀 흘리니까 너무 개운하네요.${luckySay}`, place: "🧘 홈트" };
    case "work":
      if (o.overtime) return { clip: "nightWork", caption: `야근 확정… 아직 퇴근 못 함 🌙${lucky}`, speech: `결국 야근이에요. 아직 퇴근을 못 했어요.${luckySay}`, place: "🏢 야근 중" };
      return NIGHT.has(b)
        ? { clip: "nightWork", caption: `밤에도 일하는 중 💼${lucky}`, speech: `밤인데도 일하는 중이에요. 조금만 더 힘내 볼게요.${luckySay}`, place: "🏢 사무실" }
        : { clip: "work", caption: `업무 처리 중 💼 오늘도 열일${lucky}`, speech: `지금은 업무 시간! 오늘도 열일하는 중이에요.${luckySay}`, place: "🏢 사무실" };
    case "meet":
      return o.matched
        ? { clip: "meet", caption: `친구 만나서 수다 타임! 🤝${lucky}`, speech: `친구 만나서 수다 떠는 중! 이런 시간이 진짜 소중하죠.${luckySay}`, place: "☕ 카페" }
        : { clip: "rest", caption: `약속 장소 나왔는데 혼자네… 🥲${lucky}`, speech: `약속 장소에 나왔는데, 친구가 안 왔네요. 혼자 커피나 마실게요.${luckySay}`, place: "☕ 카페" };
    case "rest":
      return { clip: "rest", caption: `커피 한 잔의 여유 ☕${lucky}`, speech: `커피 한 잔 하면서 잠깐 쉬어 갈게요.${luckySay}`, place: "☕ 휴식" };
    case "temptation": {
      const t = TEMPTATIONS[rec.temptationId];
      return { clip: "temptation", caption: `${t ? `${t.emoji} ${t.name}… ` : ""}딱 5분만 보려 했는데 😈`, speech: `${t ? `${t.name}, ` : ""}딱 오 분만 하려고 했는데, 벌써 시간이 이렇게 됐어요.`, place: "🛏️ 침대 위" };
    }
    default:
      return { clip: "idle", caption: "멍… 아무것도 안 하는 중", speech: "잠깐 멍 때리는 중이에요.", place: "🪟 창가" };
  }
}

function ui() {
  getGodLifePlannerSound().play("ui");
}

/** 프레임 하나의 효과음 — 0 = 하루 시작, last = 마감, 그 사이는 블록. */
function playFrameSound(f: Frame, i: number, last: number) {
  const sound = getGodLifePlannerSound();
  const o = f.outcome;
  if (f.collapse) sound.play("collapse");
  else if (i === 0) sound.play("wake");
  else if (i === last || !o) sound.play("dayEnd");
  else if (o.kind === "fail" || o.kind === "void") sound.play("fail");
  else if (o.kind === "nap") sound.play("nap");
  else if (o.kind === "empty") sound.play("ui");
  else if (o.opp) sound.play("lucky");
  else if (o.matched) sound.play("match");
  else sound.play("paint", cellArg(o.cell));
}

function buildFrames(state: GameState, rec: DayRecord, endTracks: Tracks): Frame[] {
  const start: Tracks = rec.startTracks ? { ...rec.startTracks } : { ...endTracks };
  const frames: Frame[] = [];
  const card = TEMPTATIONS[rec.temptationId];
  // 아침: 유혹 저항 비용 · 즉시형 유혹(블록을 차지하지 않음)
  let hp = rec.startHp;
  let mp = rec.startMp;
  const morning = { ...start };
  const mPops: Frame["pops"] = [];
  if (rec.plan.temptation === "resist") {
    const c = resistCost(state);
    mp = clampG(mp - c);
    mPops.push({ text: `🛡️ 유혹 참기 💗−${c}`, tone: "info" });
  } else if (rec.plan.instant && card) {
    hp = clampG(hp + (card.effect.hp ?? 0));
    mp = clampG(mp + (card.effect.mp ?? 0));
    for (const t of TRACKS) morning[t] = Math.max(0, morning[t] + (card.effect.tracks?.[t] ?? 0));
    mPops.push({ text: `${card.emoji} ${card.name}에 넘어감`, tone: "bad" });
  }
  frames.push({ label: "☀️ 하루 시작", sub: `⚡${rec.startHp} 💗${rec.startMp}로 출발`, hp, mp, tracks: morning, outcome: null, pops: mPops, collapse: null });

  let tracks = morning;
  let prevHp = hp;
  let prevMp = mp;
  rec.outcomes.forEach((o, b) => {
    tracks = { ...tracks };
    for (const t of TRACKS) tracks[t] = Math.max(0, tracks[t] + (o.gains[t] ?? 0));
    const pops: Frame["pops"] = [];
    if (o.kind === "fail") pops.push({ text: "❌ 비용 부족 — 실패", tone: "bad" });
    if (o.kind === "void") pops.push({ text: "🫥 쓰러져서 무효", tone: "bad" });
    if (o.kind === "nap") pops.push({ text: "💤 쓰러져 잠듦", tone: "bad" });
    for (const t of TRACKS) {
      const g = o.gains[t];
      if (g) pops.push({ text: `${TRACK_INFO[t].emoji} ${TRACK_INFO[t].name} ${g > 0 ? "+" : "−"}${Math.abs(g)}`, tone: g > 0 ? "good" : "bad" });
    }
    const dh = o.hp - prevHp;
    const dm = o.mp - prevMp;
    if (dh) pops.push({ text: `⚡ ${dh > 0 ? "+" : "−"}${Math.abs(dh)}`, tone: dh > 0 ? "good" : "bad" });
    if (dm) pops.push({ text: `💗 ${dm > 0 ? "+" : "−"}${Math.abs(dm)}`, tone: dm > 0 ? "good" : "bad" });
    if (o.matched) pops.push({ text: "🤝 약속 성사!", tone: "good" });
    if (o.opp) pops.push({ text: `${OPPORTUNITY_BY_ID[o.opp]?.emoji ?? "🍀"} ${OPPORTUNITY_BY_ID[o.opp]?.name ?? "기회 카드"}`, tone: "good" });
    if (o.noShow) pops.push({ text: "🙇 약속 펑크", tone: "bad" });
    if (o.overtime) pops.push({ text: "🌙 야근", tone: "info" });
    const collapse = o.hp === 0 && prevHp > 0 ? "exhausted" : o.mp === 0 && prevMp > 0 ? "burnout" : null;
    const name = o.cell === "temptation" ? (card ? `${card.emoji} ${card.name}` : "유혹") : `${ACTIVITY_INFO[o.cell].emoji} ${ACTIVITY_INFO[o.cell].name}`;
    frames.push({
      label: `${BLOCK_INFO[b].label} ${BLOCK_INFO[b].time} ${BLOCK_INFO[b].name}`,
      sub: name,
      hp: o.hp,
      mp: o.mp,
      tracks,
      outcome: o,
      pops,
      collapse,
    });
    prevHp = o.hp;
    prevMp = o.mp;
  });

  const ePops: Frame["pops"] = [];
  if (rec.exhausted) ePops.push({ text: "🥵 오늘 탈진 −3점 · 내일 몸살", tone: "bad" });
  if (rec.burnout) ePops.push({ text: "😵 오늘 번아웃 −3점 · 내일 무기력", tone: "bad" });
  const dh = rec.endHp - prevHp;
  const dm = rec.endMp - prevMp;
  if (dh) ePops.push({ text: `마감 보정 ⚡${dh > 0 ? "+" : "−"}${Math.abs(dh)}`, tone: dh > 0 ? "good" : "bad" });
  if (dm) ePops.push({ text: `마감 보정 💗${dm > 0 ? "+" : "−"}${Math.abs(dm)}`, tone: dm > 0 ? "good" : "bad" });
  for (const t of TRACKS) {
    const d = endTracks[t] - tracks[t];
    if (d) ePops.push({ text: `마감 보정 ${TRACK_INFO[t].emoji}${d > 0 ? "+" : "−"}${Math.abs(d)}`, tone: d > 0 ? "good" : "bad" });
  }
  const scoreLine = rec.scoreBefore && rec.scoreAfter ? `🏆 ${rec.scoreBefore.total} → ${rec.scoreAfter.total}점 (${rec.scoreAfter.total - rec.scoreBefore.total >= 0 ? "+" : "−"}${Math.abs(rec.scoreAfter.total - rec.scoreBefore.total)})` : "";
  frames.push({ label: "🌙 마감", sub: scoreLine || `성장 +${rec.growth}`, hp: rec.endHp, mp: rec.endMp, tracks: { ...endTracks }, outcome: null, pops: ePops, collapse: null });
  return frames;
}

function Bar({ value, max, color, flash }: { value: number; max: number; color: string; flash: number }) {
  return (
    <span className="relative block h-2 overflow-hidden rounded-full bg-black/30">
      <span className={`block h-full rounded-full ${color}`} style={{ width: `${Math.min(100, (value / max) * 100)}%`, transition: "width 0.55s cubic-bezier(.2,.9,.3,1.2)" }} />
      {flash !== 0 && <span key={`${flash}-${value}`} className={`absolute inset-0 ${flash > 0 ? "bg-white/40" : "bg-rose-500/50"}`} style={{ animation: "glr-flash 0.6s ease-out both" }} />}
    </span>
  );
}

export default function DayReplay({ state, rec, endTracks, preview, autoPlay = true, onClose }: Props) {
  const frames = useMemo(() => buildFrames(state, rec, endTracks), [state, rec, endTracks]);
  const reduced = useMemo(() => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches, []);
  const [idx, setIdx] = useState(autoPlay && !reduced ? 0 : frames.length - 1);
  const [playing, setPlaying] = useState(autoPlay && !reduced);
  const [speed, setSpeed] = useState<1 | 2>(1);
  const last = frames.length - 1;
  // it's my day — narrated in the voice of the character I picked (프로필 → 캐릭터)
  const myCharacter = useMyCharacter((s) => s.character);
  const voice = useMemo(() => characterVoice(0, myCharacter ?? undefined), [myCharacter]);

  // 계획이 바뀌면(미리보기) 처음부터 다시
  const sig = useMemo(() => JSON.stringify([rec.plan.cells, rec.plan.temptation, rec.endHp, rec.endMp]), [rec]);
  const [prevSig, setPrevSig] = useState(sig);
  if (prevSig !== sig) {
    setPrevSig(sig);
    setIdx(0);
    setPlaying(!reduced);
  }
  const running = playing && idx < last;
  const shots = useMemo(() => frames.map((fr, i) => vlogShot(fr, i, last, rec, state.day)), [frames, last, rec, state.day]);

  // 내레이션: 켜져 있으면 프레임마다 자막을 읽고, 다 읽은 뒤에 다음 블록으로 넘어간다
  const voicePref = useVoicePref();
  const audio = useAudioSettingsStore();
  const voiceOn = voicePref && speechSupported() && !isSfxEffectivelyMuted(audio);
  // 다른 사람이 준비를 눌러 상태가 바뀌어도 읽던 문장을 끊지 않게 ref로 읽는다
  const shotsRef = useRef(shots);
  useEffect(() => {
    shotsRef.current = shots;
  }, [shots]);
  useEffect(() => {
    if (!playing) return;
    const minMs = (idx === 0 ? 900 : 1150) / speed;
    const advance = () => setIdx((i) => Math.min(last, i + 1));
    if (!voiceOn) {
      if (idx >= last) return;
      const t = window.setTimeout(advance, minMs);
      return () => window.clearTimeout(t);
    }
    let minPassed = false;
    let spoken = false;
    let gap = 0;
    const go = () => {
      if (minPassed && spoken && idx < last) gap = window.setTimeout(advance, 220 / speed);
    };
    const t = window.setTimeout(() => {
      minPassed = true;
      go();
    }, minMs);
    const cancel = narrate(shotsRef.current[idx].speech, speed === 2 ? 1.5 : 1.08, () => {
      spoken = true;
      go();
    }, voice);
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(gap);
      cancel();
    };
  }, [playing, idx, last, speed, voiceOn, voice]);

  function toggleVoice() {
    ui();
    if (voiceOn) {
      setVoicePref(false);
      return;
    }
    unlockVoice();
    setVoicePref(true);
    // 사이트 전체가 음소거면 효과음 쪽을 같이 켠다(헤더 🔊·HUD 🔔와 같은 설정)
    if (isSfxEffectivelyMuted(audio)) {
      audio.setMasterMuted(false);
      audio.setSfxMuted(false);
    }
  }

  // 효과음: 블록마다 그 활동 소리, 성사·기회 카드·실패·낮잠·붕괴는 각자 소리
  const soundIdx = useRef(-1);
  useEffect(() => {
    if (!playing || soundIdx.current === idx) return;
    // 재생 중 지나간 프레임만(마지막 프레임 도착 포함)
    soundIdx.current = idx;
    playFrameSound(frames[idx], idx, last);
  }, [idx, playing, frames, last]);

  const f = frames[idx];
  const prev = frames[Math.max(0, idx - 1)];
  const blockIdx = idx >= 1 && idx <= 8 ? idx - 1 : null;
  const sky = blockIdx !== null ? SKY[blockIdx] : idx === 0 ? SKY_START : SKY_END;
  const dim = !!f.outcome && (f.outcome.kind === "fail" || f.outcome.kind === "void" || f.outcome.kind === "nap");
  const clockPct = blockIdx !== null ? ((blockIdx + 0.5) / 8) * 100 : idx === 0 ? 0 : 100;
  const celestial = blockIdx !== null && !NIGHT.has(blockIdx) ? "☀️" : "🌙";
  const clips = useMemo(() => [...new Set(shots.map((x) => x.clip))], [shots]);
  const shot = shots[idx];
  const stamp = blockIdx !== null ? `${BLOCK_INFO[blockIdx].time.slice(0, 2)}:00` : idx === 0 ? "AM" : "24:00";

  function restart() {
    ui();
    unlockVoice();
    setIdx(0);
    setPlaying(true);
  }

  return (
    <div className="flex flex-col gap-2" data-glr>
      <style>{KEYFRAMES}</style>
      <div
        className="relative overflow-hidden rounded-2xl border border-white/10 text-white light:border-slate-200"
        style={{ background: sky, transition: "background 0.8s ease" }}
      >
        {/* 시계 막대 */}
        <div className="relative mx-3 mt-3 h-6">
          <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-black/25" />
          <div className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/70" style={{ width: `${clockPct}%`, transition: "width 0.8s ease" }} />
          <span className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-lg drop-shadow" style={{ left: `${clockPct}%`, transition: "left 0.8s ease" }}>
            {celestial}
          </span>
        </div>
        <div className="flex justify-between px-3 text-[10px] font-semibold text-white/80 drop-shadow">
          <span>0시</span>
          <span>6시</span>
          <span>12시</span>
          <span>18시</span>
          <span>24시</span>
        </div>

        {/* 무대 — 브이로그 영상 */}
        <div className="relative aspect-video max-h-80 w-full overflow-hidden bg-black" style={f.collapse ? { animation: "glr-shake 0.5s ease both" } : undefined}>
          <VlogStage clips={clips} active={shot.clip} playing={playing} dim={dim} />
          {blockIdx !== null && NIGHT.has(blockIdx) && shot.clip !== "sleep" && <div className="pointer-events-none absolute inset-0 bg-indigo-950/30" />}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-14 bg-gradient-to-b from-black/55 to-transparent" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/75 to-transparent" />
          {f.collapse && <div key={`flash-${idx}`} className="pointer-events-none absolute inset-0 bg-rose-600/40" style={{ animation: "glr-flash 0.9s ease-out both" }} />}

          {/* 촬영 UI: REC · 시각 · 채널 */}
          <div className="pointer-events-none absolute inset-x-2 top-2 flex items-center justify-between gap-2 text-[10px] font-bold sm:text-[11px]">
            <span className="flex items-center gap-1.5 rounded bg-black/45 px-1.5 py-0.5">
              <span className={`h-2 w-2 rounded-full bg-red-500 ${running ? "animate-pulse" : ""}`} />
              {running ? "REC" : "II"}
              <span className="tabular-nums text-white/85">{stamp}</span>
              <span className="text-white/60">{DAY_NAMES[state.day]}</span>
            </span>
            <span className="flex min-w-0 items-center gap-1 truncate rounded bg-black/45 px-1.5 py-0.5">
              <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-gradient-to-br from-amber-300 to-rose-400 text-[9px]">📅</span>
              <span className="truncate">@갓생로그 · Day {state.day + 1}</span>
            </span>
          </div>

          <span key={`place-${shot.place}`} className="pointer-events-none absolute left-2 top-8 rounded bg-white/85 px-1.5 py-0.5 text-[10px] font-bold text-slate-800 shadow sm:text-[11px]" style={{ animation: "glr-fade 0.35s ease both" }}>
            📍 {shot.place}
          </span>

          {/* 인트로 타이틀 · 아웃트로 구독 카드 */}
          {idx === 0 && (
            <div className="pointer-events-none absolute inset-x-0 top-[40%] flex items-center justify-center gap-2" style={{ animation: "glr-enter 0.6s cubic-bezier(.2,.9,.3,1.2) both" }}>
              <span className="rounded-md bg-white/90 px-1.5 py-0.5 text-[9px] font-black tracking-[0.2em] text-rose-500 sm:text-[11px]">VLOG</span>
              <span className="text-xl font-black sm:text-3xl" style={{ textShadow: "0 2px 10px rgba(0,0,0,.6)" }}>
                Day {state.day + 1} <span className="text-amber-200">{DAY_NAMES[state.day]}요일</span>
              </span>
            </div>
          )}
          {idx === last && (
            <div className="pointer-events-none absolute inset-x-0 top-[30%] flex justify-center gap-1.5 text-[11px] font-bold sm:text-xs">
              {["👍 좋아요", "🔔 구독", "💬 댓글"].map((t, i) => (
                <span key={t} className={`rounded-full px-2.5 py-1 shadow-lg ${i === 1 ? "bg-rose-600" : "bg-white/90 text-slate-800"}`} style={{ animation: `glr-pop 0.5s cubic-bezier(.2,.9,.3,1.4) both`, animationDelay: `${200 + i * 160}ms` }}>
                  {t}
                </span>
              ))}
            </div>
          )}

          {f.collapse && (
            <p className="absolute left-1/2 top-9 -translate-x-1/2 whitespace-nowrap rounded-full bg-rose-600 px-3 py-1 text-sm font-black shadow-lg" style={{ animation: "glr-enter 0.4s ease both" }}>
              {f.collapse === "exhausted" ? "🥵 탈진! −3점" : "😵 번아웃! −3점"}
            </p>
          )}

          {/* 떠오르는 변화 */}
          <div className={`pointer-events-none absolute inset-x-2 flex flex-wrap justify-center gap-1 ${f.collapse ? "top-[4.75rem]" : "top-14"}`}>
            {f.pops.map((p, i) => (
              <span
                key={`pop-${idx}-${i}`}
                className={`rounded-full px-2 py-0.5 text-[11px] font-bold shadow ${p.tone === "good" ? "bg-emerald-500/90" : p.tone === "bad" ? "bg-rose-500/90" : "bg-slate-800/80"}`}
                style={{ animation: `glr-pop 0.5s cubic-bezier(.2,.9,.3,1.4) both`, animationDelay: `${120 + i * 110}ms` }}
              >
                {p.text}
              </span>
            ))}
          </div>

          {/* 자막 */}
          <div className="pointer-events-none absolute inset-x-3 bottom-2.5 flex flex-col items-center gap-1 text-center">
            <p key={`cap-${idx}`} className="break-keep text-sm font-black leading-snug sm:text-lg" style={{ animation: "glr-fade 0.35s ease both", textShadow: "0 0 3px #000, 0 1px 2px #000, 0 2px 8px rgba(0,0,0,.6)" }}>
              {shot.caption}
            </p>
            <span key={`label-${idx}`} className="rounded-full bg-black/45 px-2 py-0.5 text-[10px] font-semibold text-white/85" style={{ animation: "glr-fade 0.35s ease both" }}>
              {f.label} · {f.sub}
            </span>
          </div>
        </div>

        {/* 게이지 · 트랙 */}
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 bg-black/35 px-3 py-2.5 text-[11px] sm:grid-cols-3">
          <div className="flex flex-col gap-0.5">
            <span className="flex justify-between">
              <span>⚡ 체력</span>
              <b className="tabular-nums">{f.hp}</b>
            </span>
            <Bar value={f.hp} max={TUNING.gaugeMax} color={f.hp <= 2 ? "bg-rose-500" : "bg-rose-400"} flash={Math.sign(f.hp - prev.hp) * (idx + 1)} />
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="flex justify-between">
              <span>💗 멘탈</span>
              <b className="tabular-nums">{f.mp}</b>
            </span>
            <Bar value={f.mp} max={TUNING.gaugeMax} color={f.mp <= 2 ? "bg-rose-500" : "bg-violet-400"} flash={Math.sign(f.mp - prev.mp) * (idx + 1)} />
          </div>
          {TRACKS.map((t: Track) => (
            <div key={t} className="flex flex-col gap-0.5">
              <span className="flex justify-between">
                <span>
                  {TRACK_INFO[t].emoji} {TRACK_INFO[t].name}
                </span>
                <b className="tabular-nums">{f.tracks[t]}</b>
              </span>
              <Bar value={f.tracks[t]} max={TUNING.trackMax} color="bg-emerald-400" flash={Math.sign(f.tracks[t] - prev.tracks[t]) * (idx + 1)} />
            </div>
          ))}
        </div>

        {/* 블록 진행 띠 */}
        <div className="grid grid-cols-8 gap-0.5 bg-black/45 px-2 py-1.5">
          {rec.outcomes.map((o, b) => {
            const shown = idx >= b + 1;
            const now = blockIdx === b;
            const emoji = o.cell === "temptation" ? (TEMPTATIONS[rec.temptationId]?.emoji ?? "😈") : ACTIVITY_INFO[o.cell].emoji;
            return (
              <button
                key={`strip-${b}`}
                onClick={() => {
                  setPlaying(false);
                  setIdx(b + 1);
                  playFrameSound(frames[b + 1], b + 1, last);
                }}
                className={`flex flex-col items-center rounded-md py-0.5 text-[10px] transition ${now ? "bg-white/30 ring-1 ring-white" : shown ? "bg-white/10" : "bg-white/[0.03] opacity-50"}`}
                aria-label={`${BLOCK_INFO[b].label} 보기`}
              >
                <span className="text-sm leading-none">{shown ? (o.kind === "fail" ? "❌" : emoji) : "·"}</span>
                <span className="leading-tight text-white/70">{BLOCK_INFO[b].label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 조작 */}
      <div className="flex flex-wrap items-center gap-1.5">
        {running ? (
          <button
            onClick={() => {
              ui();
              setPlaying(false);
            }}
            className={BTN}
          >
            ⏸ 일시정지
          </button>
        ) : idx >= last ? (
          <button onClick={restart} className={BTN}>
            🔁 다시 보기
          </button>
        ) : (
          <button
            onClick={() => {
              ui();
              unlockVoice();
              setPlaying(true);
            }}
            className={BTN}
          >
            ▶ 재생
          </button>
        )}
        {speechSupported() && (
          <button onClick={toggleVoice} aria-pressed={voiceOn} className={`${BTN} ${voiceOn ? "!border-rose-400/60 !text-rose-200 light:!text-rose-600" : ""}`} title={voiceOn ? "내레이션 끄기" : "내레이션 켜기"}>
            {voiceOn ? "🎙️ 목소리 켜짐" : "🔇 목소리 꺼짐"}
          </button>
        )}
        <button
          onClick={() => {
            ui();
            setSpeed((s) => (s === 1 ? 2 : 1));
          }}
          className={BTN}
        >
          ⏩ {speed}배속
        </button>
        {idx < last && (
          <button
            onClick={() => {
              setPlaying(false);
              setIdx(last);
              playFrameSound(frames[last], last, last);
            }}
            className={BTN}
          >
            ⏭ 결과로
          </button>
        )}
        {onClose && (
          <button
            onClick={() => {
              ui();
              onClose();
            }}
            className={BTN}
          >
            ✕ 닫기
          </button>
        )}
        {preview && <span className="text-[11px] text-white/45 light:text-slate-400">미리보기 — 약속 성사·기회 카드 경쟁은 공개 후 결정돼요</span>}
      </div>
    </div>
  );
}

const BTN =
  "rounded-xl border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/80 transition hover:border-white/30 light:border-slate-300 light:text-slate-600 light:hover:border-slate-400";

const KEYFRAMES = `
@keyframes glr-enter{0%{opacity:0;transform:translateY(14px) scale(.6)}100%{opacity:1;transform:none}}
@keyframes glr-fade{0%{opacity:0}100%{opacity:1}}
@keyframes glr-pop{0%{opacity:0;transform:translateY(10px) scale(.7)}100%{opacity:1;transform:none}}
@keyframes glr-cam{0%{transform:scale(1.07) translate(0,0) rotate(0)}30%{transform:scale(1.08) translate(-0.7%,0.4%) rotate(-0.3deg)}65%{transform:scale(1.07) translate(0.5%,-0.5%) rotate(0.25deg)}100%{transform:scale(1.09) translate(-0.3%,0.6%) rotate(-0.15deg)}}
@keyframes glr-grain{0%{transform:translate(0,0)}33%{transform:translate(-6px,4px)}66%{transform:translate(5px,-5px)}100%{transform:translate(0,0)}}
@keyframes glr-flash{0%{opacity:1}100%{opacity:0}}
@keyframes glr-shake{0%,100%{transform:none}20%{transform:translateX(-7px)}40%{transform:translateX(6px)}60%{transform:translateX(-4px)}80%{transform:translateX(3px)}}
@media (prefers-reduced-motion: reduce){[data-glr] *{animation-duration:0.01ms !important;animation-iteration-count:1 !important}}
`;
