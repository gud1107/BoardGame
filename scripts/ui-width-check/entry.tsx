/**
 * Screens rendered by scripts/ui-width-check/run.mjs — the real merge-defense
 * components with fixed demo data, picked by `?screen=`.
 */
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import MergeDefenseBoard from "@/games/mergeDefense/MergeDefenseBoard";
import MergeDefenseGame from "@/games/mergeDefense/MergeDefenseGame";
import MergeDefenseResults from "@/games/mergeDefense/MergeDefenseResults";
import WaitingRoomPanel from "@/games/mergeDefense/WaitingRoomPanel";
import { SEAT_COLORS } from "@/games/mergeDefense/render";
import {
  BOSS_EVERY,
  applyAction,
  chooseBotAction,
  computeRankings,
  eliminationLimit,
  startGame,
  stepGame,
  type GameMode,
  type MapId,
  type MergeDefenseState,
} from "@/games/mergeDefense/engine";

const screen = new URLSearchParams(location.search).get("screen") ?? "";
const noop = () => {};
const names = { 0: "초록고양이", 1: "🤖 AI 2", 2: "길고긴닉네임플레이어입니다", 3: "🤖 AI 4" };
const settings = {
  mode: "versus" as GameMode,
  onMode: noop,
  best: { classic: { easy: 0, normal: 31, hard: 0 }, plaza: { easy: 0, normal: 0, hard: 0 }, figure8: { easy: 0, normal: 27, hard: 0 }, diamond: { easy: 0, normal: 0, hard: 0 } },
  difficulty: "hard" as const,
  limit: null,
  playerCount: 4,
  onDifficulty: noop,
  onLimit: noop,
  map: "figure8" as const,
  onMap: noop,
};

function botGame(mode: GameMode): MergeDefenseState {
  let s = startGame(4, 1300, [0, 1, 2, 3], mode, null, "hard");
  while (s.phase === "playing" && s.tick < 20 * 60 * 30) {
    for (let seat = 0; seat < 4; seat++) {
      if ((s.tick + seat * 3) % 10 !== 0) continue;
      const a = chooseBotAction(s, seat);
      if (a) s = applyAction(s, seat, a);
    }
    s = stepGame(s);
  }
  return s;
}

function results(mode: GameMode): ReactNode {
  const s = botGame(mode);
  const history = {
    limit: eliminationLimit(s),
    bossEvery: BOSS_EVERY,
    series: s.boards.map((b, seat) => ({
      seat,
      color: SEAT_COLORS[seat],
      out: !b.alive,
      load: b.alive ? [...(b.loadHistory ?? []), b.wavePeak ?? 0] : (b.loadHistory ?? []),
      gold: b.alive ? [...(b.goldHistory ?? []), Math.round(b.goldEarned ?? 0)] : (b.goldHistory ?? []),
      kills: b.alive ? [...(b.killHistory ?? []), b.kills] : (b.killHistory ?? []),
      upgrades: b.upgradeLog ?? [],
      bossKills: b.bossKills ?? [],
    })),
  };
  return (
    <MergeDefenseResults
      rankings={computeRankings(s)}
      names={names}
      mySeat={0}
      mode={mode}
      myRecord={{ mode, difficulty: "hard", wave: 26, prev: 24 }}
      history={history}
      isHost
      settings={{ ...settings, mode }}
      onLeave={noop}
      onRestart={noop}
    />
  );
}

function board(mode: GameMode, map: MapId = "classic"): ReactNode {
  let s = startGame(4, 3, [1, 2, 3], mode, null, "hard", map);
  while (s.wave < 3) s = stepGame(s);
  s.boards[0].units[6] = { kind: "archer", grade: 3, cd: 0, stun: 30 };
  s.boards[0].gold = 340;
  return <MergeDefenseBoard state={s} mySeat={0} names={names} onAction={noop} />;
}

const waiting = (isHost: boolean) => (
  <div className="flex flex-col items-center gap-5 rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
    <WaitingRoomPanel
      roomCode="4821"
      shareUrl="https://example.com"
      seats={["초록고양이", "길고긴닉네임플레이어입니다", null, null]}
      joined={2}
      mySeat={isHost ? 0 : 1}
      hostRules={{ mode: "versus", difficulty: "hard", limit: 45 }}
      isHost={isHost}
      settings={settings}
      onFillWithAi={noop}
    />
  </div>
);

const SCREENS: Record<string, () => ReactNode> = {
  "board-survival": () => board("survival"),
  "board-versus": () => board("versus"),
  "board-plaza": () => board("survival", "plaza"),
  "board-figure8": () => board("versus", "figure8"),
  "board-diamond": () => board("survival", "diamond"),
  "board-intro": () => <MergeDefenseBoard state={startGame(2, 5, [1], "survival", null, "normal", "plaza")} mySeat={0} names={names} onAction={noop} mapBest={27} />,
  lobby: () => <MergeDefenseGame participants={[]} onComplete={noop} />,
  "waiting-host": () => waiting(true),
  "waiting-guest": () => waiting(false),
  "results-versus": () => results("versus"),
  "results-survival": () => results("survival"),
};

const render = SCREENS[screen];
createRoot(document.getElementById("root")!).render(<div className="px-4 py-3">{render ? render() : `unknown screen "${screen}"`}</div>);
