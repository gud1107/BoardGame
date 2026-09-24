"use client";

import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CardFace, CharacterCard } from "./CardFace";
import { CARDS, CHARACTERS, FACTION_LABEL, REGIONS } from "./data";
import type { CombatReport, EngineAction, Faction, LotrState } from "./types";

/**
 * Combat cinematics. Rendered through a portal (same reason as
 * `components/Overlay.tsx`: a `fixed` element under a `backdrop-filter`
 * ancestor gets clipped to that ancestor's box).
 *
 * - `LiveCombatModal`   — while `state.combat` is open: reveal, pre-combat
 *   choices (Frodo/Pippin), and the blind card pick. The opponent's pick is
 *   shown only as "선택 완료" with a face-down card until resolution.
 * - `CombatResultModal` — after resolution: both cards flip, final power,
 *   casualties, full combat log.
 */

function Shell({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "win" | "lose" }) {
  if (typeof document === "undefined") return null;
  const glow = tone === "win" ? "shadow-[0_0_60px_rgba(251,191,36,0.35)]" : tone === "lose" ? "shadow-[0_0_60px_rgba(239,68,68,0.35)]" : "shadow-[0_0_50px_rgba(245,158,11,0.18)]";
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm">
      <div className={`lotr-modal-in flex max-h-[92dvh] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-3xl border border-amber-500/30 bg-[linear-gradient(180deg,#15121c,#0a0a0f)] p-4 text-neutral-100 ${glow}`}>{children}</div>
    </div>,
    document.body,
  );
}

function sortHand(ids: string[]): string[] {
  return [...ids].sort((a, b) => {
    const ca = CARDS[a];
    const cb = CARDS[b];
    if (ca.type !== cb.type) return ca.type === "BASIC" ? -1 : 1;
    return ca.power - cb.power || a.localeCompare(b);
  });
}

export function LiveCombatModal({ state, myFaction, onAction }: { state: LotrState; myFaction: Faction; onAction: (a: EngineAction) => void }) {
  const c = state.combat!;
  const [selected, setSelected] = useState<string | null>(null);
  const attacker = CHARACTERS[c.attackerId];
  const defender = CHARACTERS[c.defenderId];
  const iAmAttacker = attacker.faction === myFaction;
  const mine = iAmAttacker ? c.attackerId : c.defenderId;
  const theirs = iAmAttacker ? c.defenderId : c.attackerId;
  const oppFaction: Faction = myFaction === "FELLOWSHIP" ? "SAURON" : "FELLOWSHIP";
  const pending = c.pendingChoice;
  const myPick = c.picks[myFaction];
  const oppPicked = !!c.picks[oppFaction];
  const peek = state.peek && state.peek.viewer === myFaction && state.peek.combatNo === state.combatCount ? state.peek : null;

  return (
    <Shell>
      <div className="text-center">
        <p className="text-[10px] font-bold tracking-[0.3em] text-rose-300/80">BATTLE</p>
        <h2 className="font-serif text-lg font-black text-amber-200">⚔️ {REGIONS[c.regionId].name} 전투</h2>
      </div>
      <div className="flex items-start justify-center gap-3">
        <CharacterCard id={mine} flip label={`나 · ${iAmAttacker ? "공격" : "방어"}`} />
        <span className="self-center font-serif text-2xl font-black text-rose-400">VS</span>
        <CharacterCard id={theirs} flip label={`상대 · ${iAmAttacker ? "방어" : "공격"}`} />
      </div>

      <ul className="flex flex-col gap-1 rounded-xl bg-black/30 p-2 text-xs text-white/70">
        {c.log.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>

      {peek && (
        <div className="flex items-center gap-3 rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-2 text-xs text-emerald-100">
          <CardFace cardId={peek.cardId} />
          <span>
            {CHARACTERS[peek.by].name}의 정찰 — 상대 손에 <b>[{CARDS[peek.cardId].name}]</b> 카드가 있습니다.
          </span>
        </div>
      )}

      {c.step === "PRE_COMBAT" && pending && pending.faction === myFaction && (
        <div className="flex flex-col gap-2">
          <p className="text-center text-sm font-bold text-amber-200">
            {pending.kind === "FRODO_FLEE" ? "💍 프로도의 도주 — 카드를 내기 전에 몸을 피할까요?" : "🍎 피핀의 정찰 — 어떻게 할까요?"}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {pending.options.map((r) => (
              <button
                key={r}
                onClick={() => onAction({ type: "preChoice", faction: myFaction, choice: pending.kind === "FRODO_FLEE" ? { kind: "flee", to: r } : { kind: "sidestep", to: r } })}
                className="rounded-xl bg-sky-600 px-3 py-2 text-xs font-bold text-white hover:bg-sky-500"
              >
                {pending.kind === "FRODO_FLEE" ? "🏃 도주" : "↔️ 비켜서기"} → {REGIONS[r].name}
              </button>
            ))}
            <button
              onClick={() => onAction({ type: "preChoice", faction: myFaction, choice: pending.kind === "FRODO_FLEE" ? { kind: "stay" } : { kind: "peek" } })}
              className="rounded-xl border border-amber-400/50 px-3 py-2 text-xs font-bold text-amber-200 hover:bg-amber-400/10"
            >
              {pending.kind === "FRODO_FLEE" ? "⚔️ 맞서 싸운다" : "👀 상대 패 1장 엿보고 싸운다"}
            </button>
          </div>
        </div>
      )}
      {c.step === "PRE_COMBAT" && pending && pending.faction !== myFaction && <p className="animate-pulse text-center text-sm text-white/60">상대가 선제 능력 사용 여부를 고르는 중…</p>}

      {c.step === "CARD_PICK" && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-center gap-6">
            <div className="flex flex-col items-center gap-1">
              <span className="text-[10px] text-white/50">내 카드</span>
              <CardFace cardId={myPick ?? selected} size="lg" faceDown={!myPick && !selected} />
            </div>
            <div className="flex flex-col items-center gap-1">
              <span className="text-[10px] text-white/50">상대 카드</span>
              <CardFace cardId={null} size="lg" faceDown />
              <span className={`text-[10px] font-bold ${oppPicked ? "text-emerald-300" : "animate-pulse text-white/40"}`}>{oppPicked ? "✓ 선택 완료" : "고르는 중…"}</span>
            </div>
          </div>
          {!myPick ? (
            <>
              <p className="text-center text-xs text-amber-200/80">손패 {state.hands[myFaction].length}장 중 1장을 비밀리에 고르세요. 기본 전투력 + 카드 수치가 높은 쪽이 승리합니다.</p>
              <div className="flex flex-wrap justify-center gap-1.5">
                {sortHand(state.hands[myFaction]).map((id) => (
                  <CardFace key={id} cardId={id} selected={selected === id} onClick={() => setSelected(id)} />
                ))}
              </div>
              <button
                disabled={!selected}
                onClick={() => selected && onAction({ type: "pickCard", faction: myFaction, cardId: selected })}
                className="rounded-xl bg-amber-500 py-2.5 text-sm font-black text-black transition enabled:hover:bg-amber-400 disabled:opacity-40"
              >
                {selected ? `[${CARDS[selected].name}] 뒷면으로 제출` : "카드를 고르세요"}
              </button>
            </>
          ) : (
            <p className="animate-pulse text-center text-sm text-white/60">상대의 카드를 기다리는 중…</p>
          )}
        </div>
      )}
      <p className="text-center text-[10px] text-white/35">
        {FACTION_LABEL[attacker.faction]} {attacker.name} (공격) · {FACTION_LABEL[defender.faction]} {defender.name} (방어)
      </p>
    </Shell>
  );
}

const OUTCOME_TEXT: Record<CombatReport["outcome"], string> = {
  "attacker-wins": "공격 성공",
  "defender-wins": "방어 성공",
  "both-die": "양측 전사",
  "both-survive": "양측 생존",
  escaped: "전투 회피",
  "pre-kill": "선제 처치",
};

export function CombatResultModal({ report, myFaction, onClose }: { report: CombatReport; myFaction: Faction; onClose: () => void }) {
  const mineIsAttacker = report.attacker.faction === myFaction;
  const me = mineIsAttacker ? report.attacker : report.defender;
  const them = mineIsAttacker ? report.defender : report.attacker;
  const tone = me.died && !them.died ? "lose" : them.died && !me.died ? "win" : "neutral";
  return (
    <Shell tone={tone}>
      <div className="text-center">
        <p className="text-[10px] font-bold tracking-[0.3em] text-amber-300/70">{REGIONS[report.regionId].name} 전투 결과</p>
        <h2 className={`lotr-stamp font-serif text-2xl font-black ${tone === "win" ? "text-yellow-300" : tone === "lose" ? "text-rose-400" : "text-amber-100"}`}>{OUTCOME_TEXT[report.outcome]}</h2>
      </div>
      <div className="flex items-start justify-center gap-3">
        <div className="flex flex-col items-center gap-2">
          <CharacterCard id={me.characterId} dead={me.died} power={me.power} label={`나 · ${mineIsAttacker ? "공격" : "방어"}`} />
          {me.card && <CardFace cardId={me.card} size="lg" flip />}
        </div>
        <div className="flex flex-col items-center gap-2">
          <CharacterCard id={them.characterId} dead={them.died} power={them.power} label={`상대 · ${mineIsAttacker ? "방어" : "공격"}`} />
          {them.card && <CardFace cardId={them.card} size="lg" flip />}
        </div>
      </div>
      <ul className="flex flex-col gap-1 rounded-xl bg-black/30 p-2 text-xs text-white/75">
        {report.log.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
      <button onClick={onClose} className="rounded-xl bg-amber-500 py-2.5 text-sm font-black text-black hover:bg-amber-400">
        확인
      </button>
    </Shell>
  );
}

export function VictoryModal({
  state,
  myFaction,
  onRematch,
  onLeave,
  onClose,
}: {
  state: LotrState;
  myFaction: Faction;
  onRematch: () => void;
  onLeave: () => void;
  onClose: () => void;
}) {
  const won = state.winner === myFaction;
  const light = state.winner === "FELLOWSHIP";
  return (
    <Shell tone={won ? "win" : "lose"}>
      <div className="flex flex-col items-center gap-2 py-3 text-center">
        <span className="lotr-victory-emblem text-6xl">{light ? "💍" : "👁️"}</span>
        <p className="text-[11px] font-bold tracking-[0.35em] text-amber-300/70">{light ? "THE RING IS UNMADE" : "DARKNESS FALLS"}</p>
        <h2 className={`lotr-stamp font-serif text-3xl font-black ${won ? "text-yellow-300" : "text-rose-400"}`}>{won ? "승리!" : "패배"}</h2>
        <p className="font-serif text-base font-bold text-amber-100">{state.winner ? `${FACTION_LABEL[state.winner]}의 승리` : ""}</p>
        <p className="text-sm text-white/70">{state.winReason}</p>
        <p className="text-xs text-white/40">총 {state.turnNumber}턴 · 전투 {state.combatCount}회 · 전사 {state.graveyard.length}명</p>
      </div>
      <div className="flex gap-2">
        <button onClick={onClose} className="flex-1 rounded-xl border border-white/15 py-2.5 text-sm text-white/70 hover:border-white/30">
          보드 보기
        </button>
        <button onClick={onLeave} className="flex-1 rounded-xl border border-white/15 py-2.5 text-sm text-white/70 hover:border-white/30">
          나가기
        </button>
        <button onClick={onRematch} className="flex-1 rounded-xl bg-amber-500 py-2.5 text-sm font-black text-black hover:bg-amber-400">
          진영 바꿔 재대결
        </button>
      </div>
    </Shell>
  );
}
