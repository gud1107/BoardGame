"use client";

import { useState } from "react";
import { SealStamp } from "./CardArt";
import { RACES, RACE_INFO, TOKENS } from "./data";
import { tokenOptions, type AllianceRace, type AllianceTokenId, type LotrDuelState, type PendingStep } from "./engine";

/**
 * Center floating modal for every alliance-token choice — the "2 cards of one
 * race" pair, the once-per-game "3 different races" trio, the ring-track
 * token points (5/16) and Grey Havens. Two steps share it:
 *  - `TOKEN_RACE`: pick which race pile to reveal (piles stay face-down — only
 *    the race and how many tokens are left are shown);
 *  - `TOKEN`: the revealed tops as cards side by side; picking one plays a
 *    short transition (chosen card rises, the rest slide back onto their
 *    piles) before the action is sent.
 *
 * Fixed to the viewport centre (`fixed inset-0` + flex centring, `max-h-[85dvh]`
 * with inner scroll) so it sits inside the safe area on phones too. The player
 * can minimise it to look at the board; the action prompt reopens it.
 */

const KEYFRAMES = `
@keyframes lotrm-in { 0% { opacity: 0; transform: translateY(14px) scale(.94) } 100% { opacity: 1; transform: none } }
@keyframes lotrm-fade { 0% { opacity: 0 } 100% { opacity: 1 } }
@keyframes lotrm-rim { 0%,100% { box-shadow: 0 0 30px rgba(245,158,11,.22), inset 0 0 0 1px rgba(251,191,36,.35) } 50% { box-shadow: 0 0 60px rgba(245,158,11,.4), inset 0 0 0 1px rgba(251,191,36,.6) } }
@keyframes lotrm-chosen { 0% { transform: none } 40% { transform: translateY(-10px) scale(1.08); box-shadow: 0 0 40px rgba(251,191,36,.8) } 100% { transform: translateY(-30px) scale(.9); opacity: 0 } }
@keyframes lotrm-return { 0% { transform: none; opacity: 1 } 100% { transform: translateY(40px) scale(.85) rotateX(40deg); opacity: 0 } }
@keyframes lotrm-card-in { 0% { opacity: 0; transform: perspective(700px) rotateY(-70deg) } 100% { opacity: 1; transform: perspective(700px) rotateY(0) } }
.lotrm-card { transform-style: preserve-3d; transition: transform .3s cubic-bezier(.2,.8,.2,1), box-shadow .3s, border-color .3s }
.lotrm-card:hover, .lotrm-card:focus-visible { transform: perspective(700px) translateZ(26px) rotateX(4deg) scale(1.04) }
@media (prefers-reduced-motion: reduce) { .lotrm-card, .lotrm-card:hover { transition: none; transform: none } [style*="lotrm-"] { animation-duration: .01ms !important } }
`;

const PICK_MS = 520;

type TokenStep = Extract<PendingStep, { kind: "TOKEN" | "TOKEN_RACE" }>;

export default function AllianceTokenSelectModal({
  state,
  step,
  onPickRace,
  onPickToken,
  onMinimize,
}: {
  state: LotrDuelState;
  step: TokenStep;
  onPickRace: (race: AllianceRace) => void;
  onPickToken: (id: AllianceTokenId) => void;
  onMinimize: () => void;
}) {
  const [picked, setPicked] = useState<AllianceTokenId | null>(null);

  const races: AllianceRace[] = step.kind === "TOKEN" ? step.races : [];
  const single = races.length === 1 ? races[0] : null;
  const options = step.kind === "TOKEN" ? tokenOptions(state, step) : [];

  const title =
    step.kind === "TOKEN_RACE" ? "종족 지원 — 동맹 더미 선택" : single ? `${RACE_INFO[single].name} 동맹 능력 선택` : "서로 다른 종족 동맹 — 능력 선택";
  const subtitle =
    step.kind === "TOKEN_RACE"
      ? "공개할 종족 더미를 고르세요. 그 더미 위 2개의 토큰이 공개되고, 그중 1개를 가져갑니다."
      : `공개된 ${options.length}개의 동맹 토큰 중 1개를 선택하세요. 선택한 능력은 즉시 내 진영에 합류하고, 남은 토큰은 더미 맨 위로 돌아갑니다.`;

  function choose(id: AllianceTokenId) {
    if (picked) return;
    setPicked(id);
    window.setTimeout(() => onPickToken(id), PICK_MS);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md select-none" style={{ animation: "lotrm-fade .25s ease-out both" }} role="dialog" aria-modal="true" aria-label={title}>
      <style>{KEYFRAMES}</style>
      <div
        className="relative flex max-h-[85dvh] w-full max-w-lg flex-col overflow-hidden rounded-3xl border-2 border-amber-500/50 bg-neutral-950/95 text-center text-white"
        style={{ animation: "lotrm-in .35s cubic-bezier(.2,.9,.2,1) both, lotrm-rim 2.6s ease-in-out infinite" }}
      >
        <div className="pointer-events-none absolute top-0 left-1/2 h-32 w-72 -translate-x-1/2 bg-amber-500/15 blur-3xl" />
        <div className="relative overflow-y-auto p-5">
          {/* header */}
          <div className="mb-1 flex items-center justify-center gap-2">
            {step.kind === "TOKEN" &&
              races.map((r) => (
                <span key={r} className="inline-block h-9 w-9 drop-shadow">
                  <SealStamp race={r} />
                </span>
              ))}
            {step.kind === "TOKEN_RACE" && <span className="text-3xl">📜</span>}
          </div>
          <h3 className="bg-gradient-to-r from-amber-200 via-yellow-300 to-amber-500 bg-clip-text font-serif text-lg font-black tracking-wider text-transparent sm:text-xl">{title}</h3>
          <p className="mx-auto mt-1 mb-1 max-w-sm text-xs text-neutral-400">{subtitle}</p>
          <p className="mb-4 text-[10px] text-amber-400/70">{step.source}</p>

          {step.kind === "TOKEN_RACE" ? (
            <div className="grid grid-cols-3 gap-2">
              {RACES.map((r) => {
                const left = state.allianceTokenDecks[r].length;
                return (
                  <button
                    key={r}
                    type="button"
                    disabled={left === 0}
                    onClick={() => onPickRace(r)}
                    className="lotrm-card flex flex-col items-center gap-1 rounded-2xl border-2 border-neutral-700/80 bg-gradient-to-b from-neutral-900 to-neutral-950 p-2.5 hover:border-amber-400 hover:shadow-[0_0_20px_rgba(251,191,36,.3)] disabled:opacity-30 disabled:hover:border-neutral-700/80"
                  >
                    <span className="h-12 w-12">
                      <SealStamp race={r} />
                    </span>
                    <span className="text-xs font-bold">{RACE_INFO[r].name}</span>
                    <span className="text-[10px] text-neutral-400">{left > 0 ? `남은 토큰 ${left}개` : "비었음"}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className={`grid gap-3 ${options.length >= 3 ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-2"}`}>
              {options.map((id, i) => {
                const t = TOKENS[id];
                const phase = picked === null ? "idle" : picked === id ? "chosen" : "return";
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => choose(id)}
                    disabled={picked !== null}
                    className={`lotrm-card group flex flex-col items-center rounded-2xl border-2 bg-gradient-to-b from-neutral-900 via-neutral-900/90 to-neutral-950 p-3 text-center ${
                      phase === "chosen" ? "border-amber-300" : "border-neutral-700/80 hover:border-amber-400 hover:shadow-[0_0_24px_rgba(251,191,36,.35)]"
                    } ${options.length >= 3 ? "max-sm:flex-row max-sm:gap-3 max-sm:text-left" : ""}`}
                    style={{
                      animation:
                        phase === "chosen"
                          ? `lotrm-chosen ${PICK_MS}ms ease-in both`
                          : phase === "return"
                            ? `lotrm-return ${PICK_MS}ms ease-in both`
                            : `lotrm-card-in .5s cubic-bezier(.2,.9,.2,1) ${120 + i * 110}ms both`,
                    }}
                  >
                    <span className={`flex w-full items-center justify-between border-b border-white/10 pb-1.5 text-[10px] font-bold text-amber-400/85 ${options.length >= 3 ? "max-sm:hidden" : ""}`}>
                      <span>{t.isOneShot ? "⚡ 즉시 1회" : "♾️ 지속 능력"}</span>
                      <span>{RACE_INFO[t.race].name}</span>
                    </span>
                    <span className={`my-2 inline-block h-14 w-14 shrink-0 ${options.length >= 3 ? "max-sm:my-0 max-sm:h-12 max-sm:w-12" : ""}`}>
                      <SealStamp race={t.race} />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="font-serif text-sm font-bold transition-colors group-hover:text-amber-300">{t.name}</span>
                      <span className="mt-1 text-xs leading-relaxed text-neutral-300">{t.description}</span>
                      {options.length >= 3 && <span className="mt-0.5 text-[10px] text-amber-400/80 sm:hidden">{t.isOneShot ? "⚡ 즉시 1회" : "♾️ 지속 능력"}</span>}
                    </span>
                    <span
                      className={`mt-3 w-full rounded-xl border py-2 text-xs font-bold transition ${options.length >= 3 ? "max-sm:hidden" : ""} ${
                        phase === "chosen" ? "border-amber-300 bg-amber-400 text-neutral-950" : "border-neutral-600 bg-neutral-800 text-neutral-200 group-hover:border-amber-400 group-hover:bg-amber-500 group-hover:text-neutral-950"
                      }`}
                    >
                      {phase === "chosen" ? "합류!" : "이 능력 획득"}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <p className="mt-4 text-[10px] text-neutral-500">※ 선택하지 않은 토큰은 해당 종족 더미 맨 위로 돌아갑니다.</p>
          <button type="button" onClick={onMinimize} className="mt-2 text-[11px] text-neutral-400 underline-offset-2 hover:text-neutral-200 hover:underline">
            잠시 보드 보기
          </button>
        </div>
      </div>
    </div>
  );
}
