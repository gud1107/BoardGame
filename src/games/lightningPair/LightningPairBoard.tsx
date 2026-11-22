"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSuiteBgm } from "@/lib/audio/useProceduralSuite";
import { cardLayout, DECK, FREEZE_MS, GOLDEN_EVERY, HINT_MS, INTRO_MS, MODE_INFO, SEAT_COLORS, SEAT_SYMBOLS, SYMBOL_NAMES, SYMBOLS } from "./data";
import { answerFor, score, topCard, type PairAction, type PairState } from "./engine";
import { getLightningPairSound } from "./lightningPairSound";
import RulebookModal from "./RulebookModal";

/**
 * 번개 짝꿍 보드: 가운데 카드 + 내 카드 두 장을 크게 그리고, 두 카드 어느 쪽 그림을 눌러도 맞힘으로 보낸다.
 *
 * 반응 시간은 여기서 잰다 (룰북 §5): 지금 카드 쌍이 이 기기 화면에 그려진 순간(`useLayoutEffect`)부터 그림을 누른 순간
 * (`pointerdown` — click보다 휴대폰 지연이 적다)까지. 짝인지 아닌지는 화면에서 바로 알 수 있어서, 틀리면 방장 답을 기다리지 않고
 * 곧바로 ❄️ 얼음을 보여 준다 (방장도 똑같이 판정한다).
 */

export interface LightningPairBoardProps {
  state: PairState;
  mySeat: number;
  names: string[];
  botSeats: Set<number>;
  onAction: (a: PairAction) => void;
  /** 방장 시계 − 내 시계 (ms) */
  clockOffset: number;
}

function Tag({ seat, name }: { seat: number; name: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1 font-bold" style={{ color: SEAT_COLORS[seat] }}>
      <span aria-hidden>{SEAT_SYMBOLS[seat]}</span>
      <span className="truncate text-white light:text-slate-900">{name}</span>
    </span>
  );
}

/** 카드 지름 — 휴대폰은 두 장이 위아래로 한 화면에, 넓은 화면은 나란히. */
const CARD_SIZE_CLASS = "[--c:min(80vw,29vh,290px)] sm:[--c:min(40vw,50vh,330px)]";

function Card({
  card,
  salt,
  label,
  golden,
  highlight,
  hint,
  dim,
  disabled,
  onPick,
}: {
  card: number;
  salt: number;
  label: string;
  golden?: boolean;
  highlight?: number | null;
  hint?: number | null;
  dim?: boolean;
  disabled?: boolean;
  onPick: (sym: number) => void;
}) {
  const layout = cardLayout(card, salt);
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-xs font-semibold text-white/60 light:text-slate-500">{label}</span>
      <div
        role="group"
        aria-label={`${label}: ${layout.map((l) => SYMBOL_NAMES[l.sym]).join(", ")}`}
        className={`relative rounded-full border-4 bg-white shadow-xl transition ${CARD_SIZE_CLASS} ${golden ? "border-amber-400 shadow-amber-400/50 ring-4 ring-amber-300/60" : "border-slate-300"} ${dim ? "opacity-50 grayscale" : ""}`}
        style={{ width: "var(--c)", height: "var(--c)" }}
      >
        {golden && (
          <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-black text-slate-900 shadow">⚡ 번개 카드 2점</span>
        )}
        {layout.map((l) => {
          const hit = highlight === l.sym;
          const hinted = hint === l.sym;
          return (
            <button
              key={l.sym}
              type="button"
              disabled={disabled}
              aria-label={SYMBOL_NAMES[l.sym]}
              onPointerDown={(e) => {
                e.preventDefault();
                onPick(l.sym);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onPick(l.sym);
                }
              }}
              className={`absolute flex items-center justify-center rounded-full leading-none select-none focus-visible:outline-3 focus-visible:outline-indigo-500 ${hit ? "z-10 bg-amber-200 ring-4 ring-amber-500" : ""} ${hinted ? "animate-pulse ring-4 ring-sky-400" : ""} ${disabled ? "cursor-default" : "cursor-pointer active:scale-90"}`}
              style={{
                left: `${50 + l.x}%`,
                top: `${50 + l.y}%`,
                width: `calc(var(--c) * ${0.2 * l.scale})`,
                height: `calc(var(--c) * ${0.2 * l.scale})`,
                fontSize: `calc(var(--c) * ${0.15 * l.scale})`,
                transform: `translate(-50%, -50%) rotate(${l.rot}deg) scale(${hit ? 1.25 : 1})`,
                touchAction: "manipulation",
              }}
            >
              {SYMBOLS[l.sym]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function LightningPairBoard({ state, mySeat, names, botSeats, onAction, clockOffset }: LightningPairBoardProps) {
  const sound = getLightningPairSound;
  const [rulebook, setRulebook] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, []);

  /* ── 반응 시간 재기 ─────────────────────────────────────────────── */
  const shownAt = useRef<{ seq: number; t: number } | null>(null);
  const [sentSeq, setSentSeq] = useState(-1);
  const [localFreeze, setLocalFreeze] = useState<{ seq: number; until: number } | null>(null);
  const [feedback, setFeedback] = useState<{ seq: number; text: string; tone: "good" | "bad" } | null>(null);
  const playing = state.phase === "play";
  /** 방장 시계로 어림한 지금 (얼음·3·2·1·힌트 표시용 — 판정에는 쓰지 않는다) */
  const hostNow = now + clockOffset;

  useLayoutEffect(() => {
    if (!playing) return;
    if (shownAt.current?.seq === state.seq) return;
    shownAt.current = { seq: state.seq, t: performance.now() };
  }, [playing, state.seq]);

  const myTop = topCard(state, mySeat);
  const answer = answerFor(state, mySeat);
  const myPending = state.pending.some((p) => p.seat === mySeat) || sentSeq === state.seq;

  const pick = useCallback(
    (sym: number) => {
      if (state.phase !== "play" || myTop === null || shownAt.current?.seq !== state.seq) return;
      if (sentSeq === state.seq) return;
      const t = performance.now();
      if (localFreeze && localFreeze.until > Date.now()) return;
      const rt = Math.round(t - shownAt.current.t);
      onAction({ type: "claim", seat: mySeat, sym, seq: state.seq, rt });
      if (sym !== answer) {
        setLocalFreeze({ seq: state.seq, until: Date.now() + FREEZE_MS });
        setFeedback({ seq: state.seq, text: `❄️ ${SYMBOL_NAMES[sym]}은(는) 짝이 아니에요 — 얼음!`, tone: "bad" });
        sound().play("wrong");
        navigator.vibrate?.(120);
        return;
      }
      setSentSeq(state.seq);
      setFeedback({ seq: state.seq, text: `✋ ${SYMBOLS[sym]} ${(rt / 1000).toFixed(2)}초 — 판정 중…`, tone: "good" });
    },
    [state, myTop, answer, mySeat, onAction, localFreeze, sentSeq, sound],
  );

  /* ── 소리 ───────────────────────────────────────────────────────── */
  useSuiteBgm(sound, state.phase !== "finished", playing ? 1 : 0);
  const prev = useRef<PairState>(state);
  useEffect(() => {
    const p = prev.current;
    prev.current = state;
    if (p === state) return;
    const s = sound();
    if (state.phase === "reveal" && p.phase !== "reveal" && state.last) {
      if (state.last.winner === mySeat) s.play("claim");
      else if (state.last.rivals.includes(mySeat)) s.play("close");
      else s.play("claimOther");
    }
    if (state.phase === "play" && p.phase !== "play") {
      s.play(state.golden ? "golden" : p.phase === "intro" ? "go" : "flip");
    }
  }, [state, mySeat, sound]);

  // 3·2·1
  const introLeft = state.phase === "intro" ? Math.max(1, Math.min(3, Math.ceil((INTRO_MS - (hostNow - state.phaseAt)) / 1000))) : 0;
  const lastCount = useRef(0);
  useEffect(() => {
    if (introLeft && introLeft !== lastCount.current) sound().play("count");
    lastCount.current = introLeft;
  }, [introLeft, sound]);

  // 💡 힌트: 이 카드 쌍이 HINT_MS 넘게 그대로면 내 짝 그림이 깜빡인다 (내 화면에만)
  const hintOn = playing && hostNow - state.centerAt > HINT_MS;
  const hintPlayed = useRef(-1);
  useEffect(() => {
    if (hintOn && hintPlayed.current !== state.seq) {
      hintPlayed.current = state.seq;
      sound().play("hint");
    }
  }, [hintOn, state.seq, sound]);

  /* ── 보여 줄 카드 ───────────────────────────────────────────────── */
  const reveal = state.phase === "reveal" ? state.last : null;
  const shownCenter = reveal ? reveal.center : state.center;
  const shownMine = reveal && reveal.winner === mySeat ? reveal.top : myTop;
  const shownGolden = reveal ? reveal.golden : state.golden;
  const highlight = reveal ? reveal.sym : null;
  const myFrozenLeft = Math.max(localFreeze && localFreeze.seq === state.seq ? localFreeze.until - now : 0, state.frozenUntil[mySeat] - hostNow);
  const fb = feedback && feedback.seq === state.seq ? feedback : null;

  const order = Array.from({ length: state.playerCount }, (_, i) => i).sort((a, b) => (state.mode === "grab" ? score(state, b) - score(state, a) : score(state, a) - score(state, b)) || a - b);
  const progress =
    state.mode === "grab" ? `가운데 카드 ${state.roundsLeft}장 남음` : `내 손 카드 ${state.piles[mySeat].length}장 남음`;

  return (
    <div className="flex flex-col gap-2 sm:gap-3">
      <div className="flex items-center justify-between gap-2 text-xs text-white/60 light:text-slate-500">
        <span className="font-semibold">
          {MODE_INFO[state.mode].emoji} {MODE_INFO[state.mode].label} · {progress}
        </span>
        <button onClick={() => setRulebook(true)} className="rounded-full border border-white/15 px-3 py-1 text-white/70 hover:border-white/30 light:border-slate-300 light:text-slate-600">
          📖 룰북
        </button>
      </div>
      {rulebook && <RulebookModal onClose={() => setRulebook(false)} />}

      {/* 점수판 */}
      <div className="flex flex-wrap justify-center gap-1">
        {order.map((seat) => {
          const fz = state.frozenUntil[seat] > hostNow;
          const pend = state.pending.some((p) => p.seat === seat);
          const won = reveal?.winner === seat;
          return (
            <div
              key={seat}
              className={`flex max-w-[48%] items-center gap-1.5 rounded-lg border px-2 py-0.5 text-[11px] sm:max-w-none sm:text-xs ${won ? "border-amber-400 bg-amber-400/20" : seat === mySeat ? "border-indigo-400/60 bg-indigo-500/10" : "border-white/10 bg-white/[0.03] light:border-slate-200 light:bg-white"}`}
            >
              <span className="flex min-w-0 items-center gap-1">
                <Tag seat={seat} name={names[seat] ?? `${seat + 1}번`} />
                {botSeats.has(seat) && <span className="text-[10px] text-white/40 light:text-slate-400">🤖</span>}
                {fz && <span title="얼음">❄️</span>}
                {pend && <span title="맞힘 판정 중">✋</span>}
              </span>
              <span className="shrink-0 font-black tabular-nums text-white light:text-slate-900">
                {state.mode === "grab" ? `${score(state, seat)}점` : `${score(state, seat)}장`}
              </span>
            </div>
          );
        })}
      </div>

      {/* 알림 줄 — 소리 없이도 무슨 일이 났는지 보이게 */}
      <div className="flex min-h-9 items-center justify-center rounded-xl bg-slate-900/80 px-3 py-1 text-center text-sm font-bold text-white">
        {state.phase === "intro" ? (
          <span className="text-2xl font-black text-amber-300">{introLeft || "시작!"}</span>
        ) : reveal ? (
          <span>
            {reveal.winner === mySeat ? "🎉 내가 " : `${names[reveal.winner]} — `}
            <span className="text-2xl">{SYMBOLS[reveal.sym]}</span> {SYMBOL_NAMES[reveal.sym]} {(reveal.rt / 1000).toFixed(2)}초
            {reveal.golden ? " · ⚡ 2점!" : ""}
            {reveal.rivals.includes(mySeat) ? " · 나도 맞혔지만 아깝게 늦었어요" : ""}
          </span>
        ) : myFrozenLeft > 0 ? (
          <span className="text-sky-200">❄️ 얼음 {(myFrozenLeft / 1000).toFixed(1)}초</span>
        ) : fb ? (
          <span className={fb.tone === "good" ? "text-emerald-300" : "text-rose-300"}>{fb.text}</span>
        ) : hintOn ? (
          <span className="text-sky-200">💡 힌트: 깜빡이는 그림을 찾아보세요</span>
        ) : (
          <span className="text-white/80">두 카드에 똑같이 있는 그림 <b>하나</b>를 먼저 누르세요!</span>
        )}
      </div>

      <div className="relative flex flex-col items-center justify-center gap-1 sm:flex-row sm:gap-8">
        <Card
          card={shownCenter}
          salt={state.salt}
          label={state.mode === "grab" ? (shownGolden ? "가운데 카드 ⚡" : "가운데 카드") : "가운데 더미"}
          golden={shownGolden}
          highlight={highlight}
          hint={null}
          disabled={!playing}
          onPick={pick}
        />
        {shownMine !== null ? (
          <div className="relative">
            <Card
              card={shownMine}
              salt={state.salt}
              label={state.mode === "grab" ? "내 카드 (맨 위)" : `내 손 카드 (${state.piles[mySeat].length}장)`}
              highlight={reveal?.winner === mySeat ? highlight : null}
              hint={hintOn ? answer : null}
              dim={myFrozenLeft > 0 || (myPending && playing)}
              disabled={!playing}
              onPick={pick}
            />
            {myFrozenLeft > 0 && (
              <div className="pointer-events-none absolute inset-0 top-5 flex items-center justify-center">
                <span className="rounded-full bg-sky-900/80 px-3 py-1 text-lg font-black text-sky-100">❄️ 얼음</span>
              </div>
            )}
          </div>
        ) : (
          <div className={`flex items-center justify-center text-sm font-bold text-emerald-300 ${CARD_SIZE_CLASS}`} style={{ width: "var(--c)", height: "var(--c)" }}>
            🎉 다 버렸어요!
          </div>
        )}
      </div>
      <p className="text-center text-[11px] text-white/40 light:text-slate-400">
        {state.mode === "grab"
          ? `어느 카드의 그림을 눌러도 돼요 · 틀리면 ❄️ ${FREEZE_MS / 1000}초 얼음 · ${GOLDEN_EVERY}장마다 ⚡ 번개 카드(2점)`
          : `어느 카드의 그림을 눌러도 돼요 · 틀리면 ❄️ ${FREEZE_MS / 1000}초 얼음 · 먼저 다 버리면 우승`}
      </p>
      {/* DECK 참조: 카드 하나에 그림 8개 */}
      <span className="sr-only">카드 한 장에 그림 {DECK[0].length}개, 어떤 두 카드든 같은 그림이 딱 하나예요.</span>
    </div>
  );
}
