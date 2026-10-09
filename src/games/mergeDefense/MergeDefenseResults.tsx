"use client";

import type { ComponentProps } from "react";
import { COMBO, MAPS, sanitizeMap, type Difficulty, type GameMode, type MapId, type RankedSeat } from "./engine";
import RoomSettings, { DIFFICULTY_LABEL } from "./RoomSettings";
import WaveChart, { type WaveSeries } from "./WaveChart";
import RecordBurst from "./RecordBurst";

export interface MatchRecord {
  mode: GameMode;
  difficulty: Difficulty;
  /** Records are kept per map; absent = 순환로 (older callers). */
  map?: MapId;
  wave: number;
  prev: number;
}

export interface WaveHistory {
  limit: number;
  bossEvery: number;
  series: Omit<WaveSeries, "name" | "me">[];
}

/** Post-game card: winner, personal record, ranking table, wave chart, host's next-round settings (props only). */
export default function MergeDefenseResults({
  rankings,
  names,
  mySeat,
  mode,
  myRecord,
  history,
  isHost,
  settings,
  onLeave,
  onRestart,
}: {
  rankings: RankedSeat[];
  names: Record<number, string>;
  mySeat: number | null;
  mode: GameMode | undefined;
  myRecord: MatchRecord | null;
  history: WaveHistory | null;
  isHost: boolean;
  settings: ComponentProps<typeof RoomSettings>;
  onLeave: () => void;
  onRestart: () => void;
}) {
  const winner = rankings.find((r) => r.rank === 1);
  const iWon = winner?.seat === mySeat;
  const me = rankings.find((r) => r.seat === mySeat);
  const versus = mode === "versus";
  const bestCombo = Math.max(...rankings.map((r) => r.combo));
  // Beat the record the map-intro card showed → the big celebration.
  const mapRecord = myRecord && myRecord.prev > 0 && myRecord.wave > myRecord.prev ? myRecord : null;
  const recordMap = MAPS[sanitizeMap(myRecord?.map)];
  return (
    <div
      className="relative flex flex-col items-center gap-5 rounded-[28px] border border-black/60 px-3 py-6 text-center shadow-[0_25px_60px_-25px_rgba(0,0,0,0.95)] sm:p-8"
      style={{ background: "linear-gradient(160deg,#3b1d06 0%,#1c1206 55%,#0a0703 100%)" }}
    >
      <span className="text-5xl">{iWon ? "🏆" : "🛡️"}</span>
      <h2 className="text-2xl font-bold break-keep text-amber-100 [overflow-wrap:anywhere]">{winner ? `${names[winner.seat]}님 승리!` : "무승부!"}</h2>
      <p className="text-xs text-white/50">마지막까지 방어선을 지킨 사람이 승리합니다.</p>
      {mapRecord && <RecordBurst />}
      {mapRecord && (
        <div className="relative w-full max-w-sm overflow-hidden rounded-2xl border-2 border-amber-300/80 bg-gradient-to-b from-amber-400/30 to-orange-600/20 px-4 py-3 shadow-[0_0_40px_-8px_rgba(251,191,36,0.8)] motion-safe:animate-[md-record-big_0.7s_cubic-bezier(.2,1.6,.4,1)]">
          <style>{`@keyframes md-record-big{0%{transform:scale(.4) rotate(-6deg);opacity:0}100%{transform:scale(1) rotate(0)}}@keyframes md-record-shine{0%{transform:translateX(-120%) skewX(-20deg)}100%{transform:translateX(260%) skewX(-20deg)}}`}</style>
          <span className="pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/30 to-transparent motion-safe:animate-[md-record-shine_1.6s_ease-in-out_0.5s_2]" />
          <p className="text-xs font-bold tracking-wide text-amber-200">
            {recordMap.emoji} {recordMap.name} · {DIFFICULTY_LABEL[mapRecord.difficulty].emoji} {DIFFICULTY_LABEL[mapRecord.difficulty].name} ·{" "}
            {mapRecord.mode === "versus" ? "유닛 대결" : "생존전"}
          </p>
          <p className="text-3xl font-black break-keep text-amber-50 drop-shadow-[0_2px_0_rgba(0,0,0,0.5)] sm:text-4xl">🏆 이 맵 신기록!</p>
          <p className="mt-1 font-mono text-lg font-bold text-white">
            WAVE {mapRecord.prev} → <span className="text-amber-300">{mapRecord.wave}</span>
            <span className="ml-1.5 rounded-full bg-emerald-500/30 px-2 py-0.5 text-sm text-emerald-100">+{mapRecord.wave - mapRecord.prev}</span>
          </p>
        </div>
      )}
      {myRecord && !mapRecord && (
        <div
          className={`rounded-xl border px-4 py-2 text-sm break-keep ${
            myRecord.wave > myRecord.prev ? "animate-[md-record_0.6s_ease-out] border-amber-300/70 bg-amber-400/15 text-amber-100" : "border-white/10 bg-white/5 text-white/70"
          }`}
        >
          <style>{`@keyframes md-record{0%{transform:scale(.7);opacity:0}70%{transform:scale(1.08);opacity:1}100%{transform:scale(1)}}`}</style>
          {myRecord.mode === "versus" ? "⚔️ 유닛 대결" : "🛡️ 생존전"} · {MAPS[sanitizeMap(myRecord.map)].emoji} {MAPS[sanitizeMap(myRecord.map)].name} · {DIFFICULTY_LABEL[myRecord.difficulty].emoji} {DIFFICULTY_LABEL[myRecord.difficulty].name} ·{" "}
          {myRecord.wave > myRecord.prev ? (
            <b>
              🏅 최고 기록 갱신! WAVE {myRecord.wave}
              {myRecord.prev > 0 && <span className="ml-1 text-xs font-normal opacity-75">(이전 {myRecord.prev})</span>}
            </b>
          ) : (
            <>
              이번 WAVE {myRecord.wave} · 최고 기록 WAVE {myRecord.prev}
            </>
          )}
        </div>
      )}
      {me && me.lateWaves > 0 && (
        // This match's combo-bonus coverage (waves from W10 that paid the gold milestone).
        <p className="-mt-2 text-xs text-white/60">
          ⚡ {COMBO.goldAt}콤보 보너스 <b className="text-amber-200">{me.comboBonusWaves}</b>/{me.lateWaves} 웨이브 ({Math.round((me.comboBonusWaves / me.lateWaves) * 100)}%)
          <span className="ml-1 text-[10px] text-white/40">· 10웨이브 이후</span>
        </p>
      )}
      <div className="w-full overflow-x-auto">
        {/* Short headers + nowrap cells keep this to one screen width on phones (checked at 375px). */}
        <table className="w-full border-collapse text-xs whitespace-nowrap">
          <thead>
            <tr className="text-white/50">
              <th className="border-b border-white/10 px-1.5 py-2 text-left sm:px-2">#</th>
              <th className="border-b border-white/10 px-1.5 py-2 text-left sm:px-2">플레이어</th>
              <th className="border-b border-white/10 px-1.5 py-2 text-right sm:px-2" title="버틴 웨이브">
                🌊<span className="hidden sm:inline"> 웨이브</span>
              </th>
              {/* The narrowest phones (≈320px) drop this column; it's on the chart's 처치 tab too. */}
              <th className="border-b border-white/10 px-1.5 py-2 text-right max-[350px]:hidden sm:px-2">처치</th>
              <th className="border-b border-white/10 px-1.5 py-2 text-right sm:px-2" title="최고 치명타 콤보">
                ⚡<span className="hidden sm:inline"> 콤보</span>
              </th>
              {versus && (
                <th className="border-b border-white/10 px-1.5 py-2 text-right sm:px-2" title="콤보 견제를 건 횟수 / 당한 횟수 / 결속으로 막은 횟수 / 막혀서 반격당한 횟수">
                  견제
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rankings.map(({ seat, rank, wave, kills, combo, jamsSent, jamsTaken, jamsBlocked, reflectsTaken }) => (
              <tr key={seat} className={rank === 1 ? "bg-amber-400/10" : ""}>
                <td className="border-b border-white/5 px-1.5 py-2 text-left font-bold text-amber-200 sm:px-2">{rank === 1 ? "🏆" : rank}</td>
                <td className="max-w-[7.5rem] truncate border-b border-white/5 px-1.5 py-2 text-left text-white sm:max-w-none sm:px-2" title={names[seat]}>
                  {seat === mySeat && <span className="mr-1 text-amber-200">나</span>}
                  {names[seat]}
                </td>
                <td className="border-b border-white/5 px-1.5 py-2 text-right text-amber-200 sm:px-2">{wave}</td>
                <td className="border-b border-white/5 px-1.5 py-2 text-right text-white/70 max-[350px]:hidden sm:px-2">{kills.toLocaleString("ko-KR")}</td>
                <td className={`border-b border-white/5 px-1.5 py-2 text-right sm:px-2 ${combo > 0 && combo === bestCombo ? "font-bold text-amber-300" : "text-white/70"}`}>
                  {combo > 0 ? combo : "-"}
                </td>
                {versus && (
                  <td className="border-b border-white/5 px-1.5 py-2 text-right font-mono text-[11px] text-white/70 sm:px-2">
                    <span className="text-emerald-300">{jamsSent}</span>/<span className="text-rose-300">{jamsTaken}</span>/
                    <span className="text-sky-300">{jamsBlocked}</span>/<span className="text-violet-300">{reflectsTaken}</span>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {versus && (
          <p className="mt-1 text-right text-[10px] text-white/40">
            견제 = <span className="text-emerald-300">건</span>/<span className="text-rose-300">당함</span>/<span className="text-sky-300">막음</span>/
            <span className="text-violet-300">반격당함</span>
          </p>
        )}
      </div>
      {history && history.series.some((s) => s.load.length > 1) && (
        <WaveChart
          limit={history.limit}
          bossEvery={history.bossEvery}
          series={history.series.map((s) => ({ ...s, name: names[s.seat] ?? `${s.seat + 1}번`, me: s.seat === mySeat }))}
        />
      )}
      {isHost && (
        <div className="w-full max-w-sm text-left">
          <p className="mb-1 text-[11px] text-white/40">⚙️ 다음 판 설정</p>
          <RoomSettings {...settings} compact />
        </div>
      )}
      <div className="flex gap-2">
        <button onClick={onLeave} className="rounded-xl border border-white/15 px-4 py-2.5 text-sm text-white/70 hover:border-white/30">
          나가기
        </button>
        {isHost ? (
          <button onClick={onRestart} className="rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-500">
            다시하기
          </button>
        ) : (
          <span className="self-center text-xs text-white/50">방장이 다시하기를 누르면 시작해요</span>
        )}
      </div>
    </div>
  );
}
