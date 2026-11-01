"use client";

import { useEffect, useState } from "react";
import type { PlayableGameProps } from "../types";
import { trackGameEvent } from "@/lib/analytics/gameEvents";
import { recordMatchStat } from "@/lib/stats/playerStats";
import { useAudioSettingsStore } from "@/lib/audio/audioSettings";
import { AI_LEVEL_INFO, botLoadout, sanitizeAiLevel, type AiLevel } from "./ai";
import { DOCTRINES, ERAS, SPECIALS, type Loadout } from "./data";
import ShopPhase from "./ShopPhase";
import EraMarchBoard, { type MatchSummary } from "./EraMarchBoard";
import EraMarchOnline, { type OnlineResult } from "./EraMarchOnline";
import { SoloDriver } from "./driver";
import RulebookModal from "./RulebookModal";
import { playCue, unlockAudio } from "./eraMarchAudio";

/**
 * 시대의 진격 entry: 메뉴 → AI 대전(SoloDriver) 또는 🌐 온라인 1:1
 * (EraMarchOnline) → 결과 → 재대결. An invite link (`?room=1234`) opens the
 * online join step directly. Each finished match is recorded to /stats right
 * away (so rematches count); "나가기" only tells the game page the session is
 * over.
 *
 * Sound is on by default here: the first visit unmutes the site audio
 * settings once (remembered), after that whatever the player picks sticks.
 */

const GAME_ID = "era-march";
const PREF_KEY = "era-march-prefs";
const WINS_KEY = "era-march-wins";
const SOUND_DEFAULT_KEY = "era-march-sound-default-v1";

function roomFromUrl(): string | null {
  const v = new URLSearchParams(window.location.search).get("room");
  return v && /^\d{4}$/.test(v) ? v : null;
}

interface Prefs {
  level: AiLevel;
  reduceShake: boolean;
}

function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(window.localStorage.getItem(PREF_KEY) ?? "{}");
    return { level: sanitizeAiLevel(raw.level ?? 3), reduceShake: !!raw.reduceShake };
  } catch {
    return { level: 3, reduceShake: false };
  }
}

function loadWins(): Record<number, number> {
  try {
    return JSON.parse(window.localStorage.getItem(WINS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export default function EraMarchGame({ participants, onComplete }: PlayableGameProps) {
  // the component is loaded client-only (ssr: false), so window/localStorage are there on first render
  const [online, setOnline] = useState<{ intent: "create" | "join"; code?: string } | null>(() => {
    const code = roomFromUrl();
    return code ? { intent: "join", code } : null;
  });
  const [screen, setScreen] = useState<"menu" | "shop" | "playing" | "results">("menu");
  const [shopLevel, setShopLevel] = useState<AiLevel>(3);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [wins, setWins] = useState<Record<number, number>>(loadWins);
  const [run, setRun] = useState<{ n: number; level: AiLevel; driver: SoloDriver | null }>({ n: 0, level: 3, driver: null });
  const [result, setResult] = useState<(MatchSummary & { level: AiLevel }) | null>(null);
  const [rules, setRules] = useState(false);
  const audio = useAudioSettingsStore();
  const soundOn = !audio.masterMuted && !(audio.bgmMuted && audio.sfxMuted);

  // sound on by default: unmute once on the first visit, then respect the player's own choice
  useEffect(() => {
    try {
      if (window.localStorage.getItem(SOUND_DEFAULT_KEY)) return;
      window.localStorage.setItem(SOUND_DEFAULT_KEY, "1");
    } catch {
      return;
    }
    const st = useAudioSettingsStore.getState();
    st.setMasterMuted(false);
    st.setBgmMuted(false);
    st.setSfxMuted(false);
  }, []);

  const savePrefs = (p: Prefs) => {
    setPrefs(p);
    try {
      window.localStorage.setItem(PREF_KEY, JSON.stringify(p));
    } catch {}
  };

  /** Every match starts in the 🛒 strategy shop. */
  const openShop = (level: AiLevel = prefs.level) => {
    unlockAudio();
    if (level !== prefs.level) savePrefs({ ...prefs, level });
    setShopLevel(level);
    setScreen("shop");
  };

  const start = (level: AiLevel, mine: Loadout) => {
    trackGameEvent(GAME_ID, "game_start", { isHost: true });
    const seed = Math.floor(Math.random() * 2_000_000_000);
    const me = participants[0]?.name || "나";
    const bot = botLoadout(level, seed);
    setRun((r) => ({ n: r.n + 1, level, driver: new SoloDriver(seed, level, me, AI_LEVEL_INFO[level].label, [mine, bot]) }));
    setScreen("playing");
  };

  const handleEnd = (summary: MatchSummary) => {
    const m = { ...summary, level: run.level };
    setResult(m);
    setScreen("results");
    if (m.won) {
      const next = { ...wins, [m.level]: (wins[m.level] ?? 0) + 1 };
      setWins(next);
      try {
        window.localStorage.setItem(WINS_KEY, JSON.stringify(next));
      } catch {}
    }
    void recordMatchStat(
      GAME_ID,
      {
        rank: m.won ? 1 : 2,
        playerCount: 2,
        botPlayed: false,
        withBots: true,
        botLevel: m.level,
        details: { kills: m.kills, trained: m.trained, maxEra: m.era + 1, damage: Math.round(m.damage), specials: m.specials, maxLevelWon: m.won ? m.level : 0 },
      },
      new Date().toISOString(),
    );
  };

  const handleOnline = (r: OnlineResult) => {
    const m = r.summary;
    void recordMatchStat(
      GAME_ID,
      {
        rank: m.won ? 1 : 2,
        playerCount: 2,
        botPlayed: r.botPlayed,
        withBots: r.withBots,
        botLevel: r.withBots ? 5 : null,
        details: { kills: m.kills, trained: m.trained, maxEra: m.era + 1, damage: Math.round(m.damage), specials: m.specials, onlineWins: m.won ? 1 : 0 },
      },
      new Date().toISOString(),
    );
  };

  const finish = () => {
    const pid = participants[0]?.id ?? "solo";
    onComplete({ rankings: [{ playerId: pid, rank: result?.won ? 1 : 2 }], finishedAt: new Date().toISOString() });
  };

  if (online) {
    return (
      <>
        <EraMarchOnline intent={online.intent} initialCode={online.code} reduceShake={prefs.reduceShake} onExit={() => setOnline(null)} onResult={handleOnline} onRules={() => setRules(true)} />
        {rules && <div className="fixed inset-0 z-[90]"><RulebookModal onClose={() => setRules(false)} /></div>}
      </>
    );
  }

  if (screen === "shop") {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <ShopPhase opponent={AI_LEVEL_INFO[shopLevel].label} onConfirm={(l) => start(shopLevel, l)} onBack={() => setScreen("menu")} />
      </div>
    );
  }

  if (screen === "playing" && run.driver) {
    return (
      <>
        <EraMarchBoard key={run.n} driver={run.driver} subtitle={`${AI_LEVEL_INFO[run.level].label} 상대`} reduceShake={prefs.reduceShake} onEnd={handleEnd} onQuit={() => setScreen("menu")} onRules={() => setRules(true)} />
        {rules && <div className="fixed inset-0 z-[70]"><RulebookModal onClose={() => setRules(false)} /></div>}
      </>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 text-white light:text-slate-800">
      {screen === "results" && result && (
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-stone-800 to-stone-950 p-5 text-center text-white shadow-xl">
          <div className="text-5xl">{result.draw ? "🤝" : result.won ? "🏆" : "💥"}</div>
          <div className={`mt-1 text-3xl font-black ${result.won ? "text-amber-300" : "text-white/80"}`}>{result.draw ? "무승부" : result.won ? "승리!" : "패배"}</div>
          <div className="text-sm text-white/60">vs {AI_LEVEL_INFO[result.level].label} · {Math.floor(result.seconds / 60)}분 {result.seconds % 60}초</div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-sm sm:grid-cols-6">
            <Stat label="도달 시대" value={`${ERAS[result.era].emoji}`} />
            <Stat label="처치" value={result.kills} />
            <Stat label="생산" value={result.trained} />
            <Stat label="잃은 유닛" value={result.lost} />
            <Stat label="필살기" value={result.specials} />
            <Stat label="총 피해" value={Math.round(result.damage).toLocaleString()} />
          </div>
          {result.doctrines.length > 0 && <div className="mt-3 text-sm text-white/70">교리: {result.doctrines.map((d) => `${DOCTRINES[d].emoji} ${DOCTRINES[d].name}`).join(" · ")}</div>}
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <button onClick={() => openShop(result.level)} className="rounded-xl bg-amber-500 px-5 py-2 font-black text-black">재대결</button>
            {result.won && result.level < 10 && (
              <button onClick={() => openShop((result.level + 1) as AiLevel)} className="rounded-xl bg-emerald-500 px-5 py-2 font-black text-black">다음 레벨 ▶ Lv.{result.level + 1}</button>
            )}
            <button onClick={() => setScreen("menu")} className="rounded-xl bg-white/10 px-5 py-2 font-bold">메뉴</button>
            <button onClick={finish} className="rounded-xl bg-white/10 px-5 py-2 font-bold">나가기</button>
          </div>
        </div>
      )}

      {screen === "menu" && (
        <>
          <div className="relative overflow-hidden rounded-2xl border border-white/10 p-5 text-white shadow-xl" style={{ background: "linear-gradient(120deg,#7c2d12 0%,#1e3a8a 55%,#4c1d95 100%)" }}>
            <div className="text-xs font-bold tracking-widest text-amber-200/80">3D 레인 전쟁</div>
            <div className="text-4xl font-black drop-shadow">⚔️ 시대의 진격</div>
            <p className="mt-2 max-w-xl text-sm text-white/85">
              유닛을 뽑아 한 줄 전선으로 보내고, 경험치로 <b>부족 → 제국 → 항해 → 증기 → 전격</b> 시대를 거슬러 올라가세요. 진화할 때마다 두 교리 중 하나를 골라 군대의 색깔이 바뀝니다. 상대 기지를 먼저 무너뜨리면 승리!
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5 text-lg">{ERAS.map((e) => <span key={e.id} title={e.name} className="rounded-lg bg-black/30 px-2 py-0.5">{e.emoji}</span>)}</div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/30 p-4 light:border-slate-200 light:bg-white">
            <div className="mb-2 text-sm font-bold">상대 지휘관 (AI 레벨)</div>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
              {(Object.keys(AI_LEVEL_INFO).map(Number) as AiLevel[]).map((lv) => (
                <button
                  key={lv}
                  onClick={() => { savePrefs({ ...prefs, level: lv }); playCue("click"); }}
                  className={`rounded-xl border px-2 py-2 text-left transition ${prefs.level === lv ? "border-amber-400 bg-amber-500/20" : "border-white/10 bg-white/5 hover:bg-white/10 light:border-slate-200 light:bg-slate-50"}`}
                >
                  <div className="text-sm font-black">{AI_LEVEL_INFO[lv].label}{wins[lv] ? <span className="ml-1 text-amber-400">🏆{wins[lv]}</span> : null}</div>
                  <div className="text-[11px] opacity-70">{AI_LEVEL_INFO[lv].desc}</div>
                </button>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <button
                onClick={() => {
                  unlockAudio();
                  const st = useAudioSettingsStore.getState();
                  if (soundOn) st.setMasterMuted(true);
                  else {
                    st.setMasterMuted(false);
                    st.setBgmMuted(false);
                    st.setSfxMuted(false);
                    setTimeout(() => playCue("start"), 50);
                  }
                }}
                className={`rounded-lg px-3 py-1.5 font-bold ${soundOn ? "bg-emerald-600/30" : "bg-white/10 light:bg-slate-100"}`}
              >
                {soundOn ? "🔊 소리 켜짐" : "🔇 소리 켜기 (배경음악 + 효과음)"}
              </button>
              <label className="flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 light:bg-slate-100">
                <input type="checkbox" checked={prefs.reduceShake} onChange={(e) => savePrefs({ ...prefs, reduceShake: e.target.checked })} />
                화면 흔들림 줄이기
              </label>
              <button onClick={() => setRules(true)} className="rounded-lg bg-white/10 px-3 py-1.5 font-bold light:bg-slate-100">📖 룰북</button>
            </div>
            <button onClick={() => openShop()} className="mt-4 w-full rounded-xl bg-gradient-to-b from-amber-300 to-amber-500 py-3 text-lg font-black text-black shadow-lg active:scale-[0.99]">
              ⚔️ {AI_LEVEL_INFO[prefs.level].label}와 전투 시작
            </button>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button onClick={() => { unlockAudio(); trackGameEvent(GAME_ID, "room_create"); setOnline({ intent: "create" }); }} className="rounded-xl border border-sky-400/40 bg-sky-500/15 py-2.5 text-sm font-black light:bg-sky-50">
                🌐 친구와 온라인 대전
              </button>
              <button onClick={() => { unlockAudio(); trackGameEvent(GAME_ID, "invite_click"); setOnline({ intent: "join" }); }} className="rounded-xl border border-white/15 bg-white/5 py-2.5 text-sm font-bold light:border-slate-200 light:bg-slate-50">
                🔑 초대 코드로 참여
              </button>
            </div>
          </div>

          <div className="grid gap-2 text-sm sm:grid-cols-3">
            <Tip title="🛒 전략 상점" body="매 판 시작 전 지휘 노선(철벽·돌격·학자·상인) 1개와 ★5 준비물을 골라요. 상대 전략은 카운트다운에 공개!" />
            <Tip title="전선 수입" body="내 최전방이 중앙선을 넘어 100 전진할 때마다 초당 골드 +1 (최대 +4). 밀어붙일수록 부자가 됩니다." />
            <Tip title="역전 장치" body="나보다 높은 시대 유닛을 잡으면 보상 ×1.5, 뒤처진 시대는 진화 비용 30% 할인, 기지 근처에선 포탑 +30%." />
          </div>
          <div className="rounded-xl bg-white/5 p-3 text-xs text-white/60 light:bg-slate-100 light:text-slate-600">
            필살기: {SPECIALS.map((s) => `${s.emoji} ${s.name}`).join(" · ")} — 시대마다 하나, 60초 충전. 단축키 1~5 생산 · E 진화 · R 필살기 · Q 포탑 · Space 일시정지 · ←/→ 카메라.
          </div>
        </>
      )}
      {rules && <RulebookModal onClose={() => setRules(false)} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl bg-white/5 p-2">
      <div className="text-[11px] text-white/50">{label}</div>
      <div className="text-lg font-black">{value}</div>
    </div>
  );
}

function Tip({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3 light:border-slate-200 light:bg-white">
      <div className="font-bold">{title}</div>
      <div className="mt-0.5 text-xs opacity-75">{body}</div>
    </div>
  );
}
