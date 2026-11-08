"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import SuiteSoundHud from "@/components/audio/SuiteSoundHud";
import { useSoundCues, useSuiteBgm } from "@/lib/audio/useProceduralSuite";
import { Frame3D, Loading3D, ViewToggle, preferLowDetail, useBoardView } from "@/games/shared/three/viewPref";
import { FLOOR_NAMES, PASSAGES, ROOMS, ROOM_BASE, SEAT_COLORS, SEAT_GLYPHS, SUSPECTS, cardLabel, cardsOf, reachable } from "./data";
import { rankOf, roundsLeft, showableCards, type EngineAction, type GameState, type Guess, type LogEntry } from "./engine";
import CaseCard from "./Cards";
import Notebook from "./Notebook";
import RulebookModal from "./RulebookModal";
import { clockLabel, clueText, guessText, logLine, seatTag, storyOf } from "./show";
import { fogCues, getFogSound } from "./fogManorSound";

const ManorScene3D = dynamic(() => import("./three/ManorScene3D"), { ssr: false, loading: () => <Loading3D label="안개 저택에 불을 켜는 중…" /> });

export interface FogManorBoardProps {
  state: GameState;
  viewerSeat: number;
  names: Record<number, string>;
  deadlineMs: number | null;
  nowMs: number;
  onAction: (a: EngineAction) => void;
  onGameEnd: () => void;
}

type Fx =
  | { id: string; kind: "accuse"; seat: number; guess: Guess; correct: boolean }
  | { id: string; kind: "ask"; seat: number; target: number; cards: number[]; count: number }
  | { id: string; kind: "received"; from: number; card: number }
  | { id: string; kind: "clue"; text: string; bell: boolean }
  | { id: string; kind: "bell"; room: number }
  | { id: string; kind: "vault"; card: number }
  | { id: string; kind: "dawn" };

const FX_MS: Record<Fx["kind"], number> = { accuse: 4300, ask: 2600, received: 2800, clue: 3600, bell: 2800, vault: 2600, dawn: 3000 };

const THUNDER = (round: number, caseNo: number) => (round * 7 + caseNo) % 3 === 0;

function receivedEntries(view: GameState, me: number) {
  const out: { i: number; e: Extract<LogEntry, { kind: "ask" }> }[] = [];
  view.log.forEach((e, i) => {
    if (e.kind === "ask" && e.seat === me && e.shown !== null && e.shown >= 0) out.push({ i, e });
  });
  return out;
}

const BTN = "rounded-xl px-3 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-35";

export default function FogManorBoard(props: FogManorBoardProps) {
  const { state: view, viewerSeat: me, names, deadlineMs, nowMs, onAction, onGameEnd } = props;
  const board = useBoardView("fog-manor-view");
  const [lowDetail] = useState(preferLowDetail);
  const [rules, setRules] = useState(false);
  const [composer, setComposer] = useState<null | "ask" | "accuse">(null);
  const [askTarget, setAskTarget] = useState<number | null>(null);
  const [pickS, setPickS] = useState<number | null>(null);
  const [pickW, setPickW] = useState<number | null>(null);
  const [pickR, setPickR] = useState<number | null>(null);
  const [confirmAccuse, setConfirmAccuse] = useState(false);
  const [tab, setTab] = useState<"notes" | "log" | "hand">("notes");

  const ended = view.phase === "ended";
  const myTurn = view.phase === "turn" && view.turn === me;
  const responding = view.phase === "respond" && view.pending?.target === me;
  const dawnPending = view.phase === "dawn" && !view.finalIn[me] && !view.eliminated[me];
  const here = view.pos[me];
  const moveOptions = useMemo(() => (myTurn && !view.moved ? [...reachable(here).keys()] : []), [myTurn, view.moved, here]);

  // ── 소리
  useSuiteBgm(getFogSound, !ended, !ended && roundsLeft(view) <= 1 ? 1 : 0);
  const classify = useMemo(() => fogCues(me), [me]);
  useSoundCues(view, getFogSound, classify);
  const secLeft = deadlineMs ? Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000)) : null;
  const urgent = (myTurn || responding || dawnPending) && secLeft !== null && secLeft <= 5 && secLeft > 0;
  useEffect(() => {
    if (urgent) getFogSound().play("tick");
  }, [urgent, secLeft]);

  // ── 연출 큐 (기록·받은 카드·단서 수가 늘면 쌓는다 — 렌더 중 상태 조정 패턴)
  const recv = receivedEntries(view, me);
  const myClues = view.clues[me] ?? [];
  const [seen, setSeen] = useState({ caseNo: view.caseNo, log: view.log.length, recv: recv.length, clues: myClues.length, round: view.round });
  const [fx, setFx] = useState<Fx[]>([]);
  const [flash, setFlash] = useState<number>(0);
  if (seen.caseNo !== view.caseNo) {
    setSeen({ caseNo: view.caseNo, log: view.log.length, recv: recv.length, clues: myClues.length, round: view.round });
    setFx([]);
  } else if (seen.log !== view.log.length || seen.recv !== recv.length || seen.clues !== myClues.length || seen.round !== view.round) {
    const fresh: Fx[] = [];
    view.log.slice(seen.log).forEach((e, k) => {
      const id = `${seen.log + k}`;
      if (e.kind === "accuse") fresh.push({ id, kind: "accuse", seat: e.seat, guess: e.guess, correct: e.correct });
      else if (e.kind === "ask" && e.seat !== me) fresh.push({ id, kind: "ask", seat: e.seat, target: e.target, cards: e.cards, count: e.count });
      else if (e.kind === "bell") fresh.push({ id, kind: "bell", room: e.room });
      else if (e.kind === "vault") fresh.push({ id, kind: "vault", card: e.card });
      else if (e.kind === "dawn") fresh.push({ id, kind: "dawn" });
      else if (e.kind === "ask" && e.seat === me && e.count === 0) fresh.push({ id, kind: "ask", seat: e.seat, target: e.target, cards: e.cards, count: 0 });
    });
    for (const r of recv.slice(seen.recv)) fresh.push({ id: `r${r.i}`, kind: "received", from: r.e.target, card: r.e.shown! });
    for (const c of myClues.slice(seen.clues)) fresh.push({ id: `c${c.id}`, kind: "clue", text: clueText(c), bell: c.bell });
    if (view.round !== seen.round && THUNDER(view.round, view.caseNo)) setFlash(view.round);
    setSeen({ caseNo: view.caseNo, log: view.log.length, recv: recv.length, clues: myClues.length, round: view.round });
    if (fresh.length) setFx((q) => [...q, ...fresh].slice(-6));
  }
  const curFx = fx[0] ?? null;
  useEffect(() => {
    if (!curFx) return;
    const t = window.setTimeout(() => setFx((q) => q.slice(1)), FX_MS[curFx.kind]);
    return () => window.clearTimeout(t);
  }, [curFx]);
  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(0), 700);
    return () => window.clearTimeout(t);
  }, [flash]);

  // 차례가 바뀌면 작성 중인 창 닫기
  const [composerStage, setComposerStage] = useState(view.stage);
  if (composerStage !== view.stage) {
    setComposerStage(view.stage);
    // 이동은 stage를 바꾸지 않으므로 여기 오면 차례·단계가 바뀐 것
    setComposer(null);
    setConfirmAccuse(false);
  }

  function act(a: EngineAction) {
    getFogSound().unlock();
    getFogSound().play("select");
    onAction(a);
  }

  function openComposer(kind: "ask" | "accuse") {
    getFogSound().unlock();
    getFogSound().play("select");
    setComposer(kind);
    setConfirmAccuse(false);
    if (kind === "ask" && (askTarget === null || askTarget === me)) setAskTarget((me + 1) % view.seatCount);
    if (kind === "accuse") setPickR(ROOM_BASE + here);
  }

  const bellFresh = useMemo(() => {
    const fresh = new Set<number>();
    for (const e of view.log) {
      if (e.kind === "bell") fresh.add(e.room);
      if (e.kind === "search") fresh.delete(e.room);
    }
    return fresh;
  }, [view.log]);

  const turnText = ended
    ? "🕯️ 사건 종결"
    : view.phase === "dawn"
      ? dawnPending
        ? "🌅 새벽 — 마지막 추리를 내세요"
        : "🌅 다른 탐정의 마지막 추리를 기다리는 중…"
      : view.phase === "respond"
        ? responding
          ? `🗣️ ${seatTag(view.pending!.asker, names)}에게 보여 줄 카드를 고르세요`
          : `🤫 ${seatTag(view.pending!.target, names)}이(가) 보여 줄 카드를 고르는 중…`
        : myTurn
          ? view.moved
            ? "🎯 내 차례 — 행동을 고르세요"
            : "🎯 내 차례 — 옆방으로 이동(선택) 후 행동"
          : `⏳ ${seatTag(view.turn, names)}의 차례`;

  return (
    <div className={`relative flex flex-col gap-3 ${curFx?.kind === "bell" ? "animate-[fogShake_0.5s_ease-in-out_2]" : ""}`}>
      <style>{`@keyframes fogShake{0%,100%{transform:translateX(0)}25%{transform:translateX(-4px)}75%{transform:translateX(4px)}}
@keyframes fogFlip{0%{transform:rotateY(90deg);opacity:0}100%{transform:rotateY(0);opacity:1}}
@keyframes fogStamp{0%{transform:scale(2.4) rotate(-14deg);opacity:0}60%{transform:scale(.9) rotate(-14deg);opacity:1}100%{transform:scale(1) rotate(-14deg);opacity:1}}
@keyframes fogPop{0%{transform:scale(.6);opacity:0}100%{transform:scale(1);opacity:1}}
@keyframes fogFlash{0%{opacity:.85}100%{opacity:0}}`}</style>
      {flash > 0 && <div className="pointer-events-none fixed inset-0 z-40 bg-white animate-[fogFlash_0.7s_ease-out_forwards]" aria-hidden />}

      {/* 상단 바 */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-gradient-to-r from-[#1a1220] to-[#10141c] px-3 py-2 light:border-slate-300">
        <span className="text-sm font-bold text-amber-100">🕯️ 사건 #{view.caseNo}</span>
        <span className="rounded-full bg-black/40 px-2.5 py-0.5 font-mono text-sm text-amber-200" title="새벽 6시에 배가 온다">
          🕰️ {clockLabel(view)} <span className="text-white/40">/ 06:00</span>
        </span>
        <span className="text-xs text-white/50">
          {Math.min(view.round, view.maxRounds)}/{view.maxRounds}라운드
          {!ended && view.phase !== "dawn" && roundsLeft(view) <= 1 && <b className="ml-1 text-rose-300">· 새벽 직전!</b>}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <SuiteSoundHud suite={getFogSound} icon="🕯️" label="Fog Manor Nocturne" preview="clue" />
          <ViewToggle board={board} />
          <button type="button" onClick={() => setRules(true)} className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/70 hover:border-white/30">
            📖 규칙
          </button>
        </div>
      </div>

      {/* 차례 안내 + 타이머 */}
      <div className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold ${myTurn || responding || dawnPending ? "bg-amber-400/15 text-amber-100" : "bg-white/5 text-white/70"}`}>
        <span className="flex-1 break-keep">{turnText}</span>
        {secLeft !== null && !ended && <span className={`font-mono text-xs ${secLeft <= 10 ? "text-rose-300" : "text-white/50"}`}>⏱ {secLeft}s</span>}
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          {/* 저택 지도 */}
          <div className="relative">
            {board.view === "3d" ? (
              <Frame3D tall hint={moveOptions.length ? "빛나는 방을 눌러 이동" : "안개 저택 단면도"}>
                <ManorScene3D
                  pos={view.pos}
                  suspectPos={view.suspectPos}
                  names={names}
                  viewerSeat={me}
                  moveOptions={moveOptions}
                  onPickRoom={(r) => act({ type: "MOVE", seat: me, stage: view.stage, room: r })}
                  bellRooms={[...bellFresh]}
                  deckCount={view.deckCount}
                  lastMove={(() => {
                    const e = [...view.log].reverse().find((x) => x.kind === "move");
                    return e && e.kind === "move" ? { seat: e.seat, from: e.from, to: e.to, key: view.log.lastIndexOf(e) } : null;
                  })()}
                  eliminated={view.eliminated}
                  lowDetail={lowDetail}
                />
              </Frame3D>
            ) : (
              <ManorMap2D view={view} me={me} names={names} moveOptions={moveOptions} bellRooms={bellFresh} onPick={(r) => act({ type: "MOVE", seat: me, stage: view.stage, room: r })} />
            )}
            {curFx && <FxOverlay fx={curFx} me={me} names={names} />}
          </div>

          {/* 행동 */}
          {myTurn && (
            <div className="flex flex-col gap-2 rounded-2xl border border-amber-400/30 bg-amber-400/5 p-3">
              <p className="text-xs break-keep text-amber-100/80">
                지금 {ROOMS[here].icon} <b>{ROOMS[here].name}</b>
                {!view.moved && moveOptions.length > 0 && <> · 이동할 수 있는 방: {moveOptions.map((r) => ROOMS[r].icon).join(" ")} (지도에서 누르기)</>}
                {view.moved && " · 이동 완료"}
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <button type="button" className={`${BTN} bg-rose-600 text-white hover:bg-rose-500`} onClick={() => openComposer("ask")}>
                  🗣️ 심문
                </button>
                <button
                  type="button"
                  className={`${BTN} bg-sky-700 text-white hover:bg-sky-600`}
                  disabled={view.deckCount[here] === 0}
                  onClick={() => {
                    if (view.deckCount[here] === 0) {
                      getFogSound().play("empty");
                      return;
                    }
                    act({ type: "SEARCH", seat: me, stage: view.stage });
                  }}
                >
                  🔍 수색 ({view.deckCount[here]})
                </button>
                <button type="button" className={`${BTN} bg-amber-500 text-slate-900 hover:bg-amber-400`} onClick={() => openComposer("accuse")}>
                  ⚖️ 고발
                </button>
                <button type="button" className={`${BTN} border border-white/15 text-white/70 hover:border-white/30`} onClick={() => act({ type: "PASS", seat: me, stage: view.stage })}>
                  💤 쉬기
                </button>
              </div>
            </div>
          )}
          {view.eliminated[me] && !ended && <p className="rounded-xl bg-rose-500/10 px-3 py-2 text-xs break-keep text-rose-200">🚫 누명을 썼어요 — 차례는 없지만 심문받으면 계속 답해요.</p>}

          {/* 탐정들 */}
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: view.seatCount }, (_, s) => (
              <span
                key={s}
                className={`rounded-full border px-2.5 py-1 text-[11px] ${view.turn === s && view.phase === "turn" ? "border-amber-300 bg-amber-300/15" : "border-white/10 bg-white/5"} ${view.eliminated[s] ? "line-through opacity-50" : ""}`}
              >
                <b style={{ color: SEAT_COLORS[s % SEAT_COLORS.length] }}>{SEAT_GLYPHS[s % SEAT_GLYPHS.length]}</b> {s === me ? "나" : (names[s] ?? `${s + 1}번`)} · 🃏{view.handCount[s]} · 🔍{view.tally[s].searches}
                {view.eliminated[s] && " 🚫"}
                {view.phase === "dawn" && view.finalIn[s] && !view.eliminated[s] && " 📜"}
              </span>
            ))}
            {view.vaultCount > 0 && <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px]">🗄️ 금고 {view.vaultCount}장</span>}
          </div>
        </div>

        {/* 오른쪽: 노트·기록·내 카드 */}
        <div className="flex flex-col gap-2">
          <div className="flex gap-1">
            {(
              [
                ["notes", "📒 수사 노트"],
                ["hand", `🃏 내 카드 ${view.hands[me]?.length ?? 0}`],
                ["log", "📜 기록"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-bold ${tab === id ? "bg-amber-400/20 text-amber-100" : "bg-white/5 text-white/55"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === "notes" && <Notebook view={view} me={me} names={names} />}
          {tab === "hand" && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-1.5">
                {(view.hands[me] ?? []).map((c) => (
                  <CaseCard key={c} card={c} />
                ))}
              </div>
              {view.publicCards.length > 0 && (
                <>
                  <p className="text-[11px] text-white/50">🗂️ 공개 증거 (모두 앎 · 정답 아님)</p>
                  <div className="flex flex-wrap gap-1.5">
                    {view.publicCards.map((c) => (
                      <CaseCard key={c} card={c} size="sm" />
                    ))}
                  </div>
                </>
              )}
              <p className="text-[10px] break-keep text-white/40">내 카드는 정답이 아니에요. 심문받으면 이 중에서 보여 줘요.</p>
            </div>
          )}
          {tab === "log" && <LogList view={view} me={me} names={names} />}
        </div>
      </div>

      {/* 심문 작성 */}
      {composer === "ask" && myTurn && (
        <Composer title="🗣️ 대질 심문" onClose={() => setComposer(null)}>
          <p className="text-xs text-white/60">누구에게?</p>
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: view.seatCount }, (_, s) => s)
              .filter((s) => s !== me)
              .map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setAskTarget(s)}
                  className={`rounded-full border px-3 py-1 text-xs ${askTarget === s ? "border-amber-300 bg-amber-300/20 text-amber-100" : "border-white/15 text-white/70"}`}
                >
                  <b style={{ color: SEAT_COLORS[s % SEAT_COLORS.length] }}>{SEAT_GLYPHS[s % SEAT_GLYPHS.length]}</b> {names[s] ?? `${s + 1}번`} 🃏{view.handCount[s]}
                  {view.eliminated[s] && " 🚫"}
                </button>
              ))}
          </div>
          <CardPicker label="용의자" cards={cardsOf("suspect")} value={pickS} onPick={setPickS} mine={view.hands[me] ?? []} />
          <CardPicker label="흉기" cards={cardsOf("weapon")} value={pickW} onPick={setPickW} mine={view.hands[me] ?? []} />
          <div className="flex items-center gap-2 text-xs text-white/60">
            장소(지금 방): <CaseCard card={ROOM_BASE + here} size="sm" />
          </div>
          <p className="text-[11px] break-keep text-white/45">상대가 셋 중 몇 장을 가졌는지는 모두가 들어요. 1장 이상이면 한 장을 나에게만 보여 줘요.</p>
          <button
            type="button"
            disabled={askTarget === null || pickS === null || pickW === null}
            onClick={() => {
              act({ type: "ASK", seat: me, stage: view.stage, target: askTarget!, suspect: pickS!, weapon: pickW! });
              setComposer(null);
            }}
            className={`${BTN} bg-rose-600 text-white`}
          >
            심문하기
          </button>
        </Composer>
      )}

      {/* 고발 작성 */}
      {composer === "accuse" && myTurn && (
        <Composer title="⚖️ 고발" onClose={() => setComposer(null)}>
          <GuessPicker s={pickS} w={pickW} r={pickR} setS={setPickS} setW={setPickW} setR={setPickR} mine={view.hands[me] ?? []} />
          <p className="text-[11px] break-keep text-rose-200/80">틀리면 🚫 누명 — 더는 차례가 없고 고발한 조합이 모두에게 공개돼요.</p>
          {!confirmAccuse ? (
            <button type="button" disabled={pickS === null || pickW === null || pickR === null} onClick={() => setConfirmAccuse(true)} className={`${BTN} bg-amber-500 text-slate-900`}>
              고발 준비
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                act({ type: "ACCUSE", seat: me, stage: view.stage, guess: { suspect: pickS!, weapon: pickW!, room: pickR! } });
                getFogSound().play("sealed");
                setComposer(null);
              }}
              className={`${BTN} animate-pulse bg-rose-600 text-white`}
            >
              정말 고발! {pickS !== null && pickW !== null && pickR !== null && guessText({ suspect: pickS, weapon: pickW, room: pickR })}
            </button>
          )}
        </Composer>
      )}

      {/* 카드 보여 주기 */}
      {responding && view.pending && (
        <Composer title="🤫 보여 줄 카드 고르기">
          <p className="text-xs break-keep text-white/70">
            {seatTag(view.pending.asker, names)}의 심문: {view.pending.cards.map(cardLabel).join(" · ")}
            <br />
            나는 그중 <b className="text-amber-200">{showableCards(view).length}장</b> (모두에게 공개됨). 한 장을 골라 {names[view.pending.asker] ?? "상대"}에게만 보여 주세요.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {showableCards(view).map((c) => (
              <CaseCard key={c} card={c} size="lg" onClick={() => act({ type: "SHOW", seat: me, stage: view.stage, card: c })} />
            ))}
          </div>
          <p className="text-[10px] text-white/40">팁: 그 사람에게 이미 보여 준 카드를 다시 보여 주면 새 정보가 없어요.</p>
        </Composer>
      )}

      {/* 새벽 추리 */}
      {dawnPending && (
        <Composer title="🌅 새벽 — 마지막 추리">
          <p className="text-xs break-keep text-white/70">맞히면 공동 1위, 틀리면 3위, 기권하면 2위. 모두 낸 뒤 한꺼번에 공개돼요.</p>
          <GuessPicker s={pickS} w={pickW} r={pickR} setS={setPickS} setW={setPickW} setR={setPickR} mine={view.hands[me] ?? []} />
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                act({ type: "FINAL", seat: me, stage: view.stage, guess: null });
                getFogSound().play("sealed");
              }}
              className={`${BTN} border border-white/20 text-white/80`}
            >
              🏳️ 기권
            </button>
            <button
              type="button"
              disabled={pickS === null || pickW === null || pickR === null}
              onClick={() => {
                act({ type: "FINAL", seat: me, stage: view.stage, guess: { suspect: pickS!, weapon: pickW!, room: pickR! } });
                getFogSound().play("sealed");
              }}
              className={`${BTN} bg-amber-500 text-slate-900`}
            >
              📜 봉인 제출
            </button>
          </div>
        </Composer>
      )}

      {ended && view.outcome && <ResultPanel view={view} me={me} names={names} onGameEnd={onGameEnd} />}
      {rules && <RulebookModal onClose={() => setRules(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

function ManorMap2D({
  view,
  me,
  names,
  moveOptions,
  bellRooms,
  onPick,
}: {
  view: GameState;
  me: number;
  names: Record<number, string>;
  moveOptions: number[];
  bellRooms: Set<number>;
  onPick: (r: number) => void;
}) {
  const passageOf = (r: number) => {
    for (const [a, b] of PASSAGES) {
      if (a === r) return b;
      if (b === r) return a;
    }
    return -1;
  };
  return (
    <div className="rounded-2xl border border-white/10 bg-[radial-gradient(ellipse_at_top,#2a2333,#0c0a10)] p-2 light:border-slate-300">
      <div className="mb-1 flex items-center justify-center gap-1 text-[10px] text-white/40">⛈️ 안개 저택 단면도 · 🕳️ = 비밀 통로</div>
      <div className="grid grid-cols-[1.4rem_repeat(3,minmax(0,1fr))] gap-1.5">
        {[0, 1, 2].map((row) => (
          <div key={row} className="contents">
            <div className="flex items-center justify-center text-[10px] font-bold text-white/35 [writing-mode:vertical-rl]">{FLOOR_NAMES[row]}</div>
            {[0, 1, 2].map((col) => {
              const r = row * 3 + col;
              const room = ROOMS[r];
              const canMove = moveOptions.includes(r);
              const detectives = view.pos.map((p, s) => (p === r ? s : -1)).filter((s) => s >= 0);
              const suspects = view.suspectPos.map((p, i) => (p === r ? i : -1)).filter((i) => i >= 0);
              const pass = passageOf(r);
              return (
                <button
                  key={r}
                  type="button"
                  disabled={!canMove}
                  onClick={() => onPick(r)}
                  style={{ backgroundColor: room.tint }}
                  className={`relative flex min-h-[5.6rem] flex-col items-start gap-0.5 overflow-hidden rounded-xl border p-1.5 text-left transition sm:min-h-[6.6rem] ${
                    view.pos[me] === r ? "border-amber-300/80 shadow-[0_0_14px_rgba(251,191,36,0.35)]" : "border-white/10"
                  } ${canMove ? "cursor-pointer ring-2 ring-amber-300/70 ring-offset-1 ring-offset-black hover:brightness-125" : "cursor-default"}`}
                >
                  <span className="text-[11px] leading-tight font-bold text-white/90">
                    {room.icon} {room.name}
                  </span>
                  <span className="text-[9px] text-white/45">
                    {"🔍".repeat(view.deckCount[r])}
                    {view.deckCount[r] === 0 && "뒤짐"}
                    {bellRooms.has(r) && <span className="ml-0.5 animate-pulse">🔔</span>}
                  </span>
                  {pass >= 0 && <span className="absolute top-1 right-1 text-[9px] text-white/50" title={`비밀 통로 → ${ROOMS[pass].name}`}>🕳️{ROOMS[pass].icon}</span>}
                  <span className="mt-auto flex flex-wrap gap-0.5">
                    {suspects.map((i) => (
                      <span key={i} title={`${SUSPECTS[i].job} ${SUSPECTS[i].name}`} className="rounded bg-black/40 px-0.5 text-[11px] opacity-80">
                        {SUSPECTS[i].icon}
                      </span>
                    ))}
                  </span>
                  <span className="flex flex-wrap gap-0.5">
                    {detectives.map((s) => (
                      <span
                        key={s}
                        title={names[s]}
                        className={`rounded-full px-1 text-[10px] font-black text-black ${view.eliminated[s] ? "opacity-40" : ""} ${s === me ? "ring-1 ring-white" : ""}`}
                        style={{ backgroundColor: SEAT_COLORS[s % SEAT_COLORS.length] }}
                      >
                        {SEAT_GLYPHS[s % SEAT_GLYPHS.length]}
                        {s === me ? "나" : ""}
                      </span>
                    ))}
                  </span>
                  {canMove && <span className="absolute right-1 bottom-1 rounded bg-amber-300 px-1 text-[9px] font-bold text-black">이동</span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function FxOverlay({ fx, me, names }: { fx: Fx; me: number; names: Record<number, string> }) {
  const who = (s: number) => (s === me ? "나" : seatTag(s, names));
  const box = "pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 rounded-2xl bg-black/70 p-3 text-center backdrop-blur-[2px]";
  switch (fx.kind) {
    case "accuse":
      return (
        <div className={box}>
          <p className="text-base font-black text-amber-200">⚖️ {who(fx.seat)}의 고발!</p>
          <div className="flex gap-1.5 [perspective:600px]">
            {[fx.guess.suspect, fx.guess.weapon, fx.guess.room].map((c, i) => (
              <div key={c} style={{ animation: `fogFlip 0.45s ${0.35 + i * 0.4}s both` }}>
                <CaseCard card={c} />
              </div>
            ))}
          </div>
          <p
            style={{ animation: "fogStamp 0.5s 1.9s both" }}
            className={`rounded-lg border-4 px-4 py-1 text-2xl font-black ${fx.correct ? "border-emerald-400 text-emerald-300" : "border-rose-500 text-rose-400"}`}
          >
            {fx.correct ? "✅ 정답!" : "❌ 누명!"}
          </p>
        </div>
      );
    case "ask":
      return (
        <div className="pointer-events-none absolute inset-x-2 top-2 z-20 flex flex-col items-center gap-1 rounded-2xl bg-black/75 p-2 text-center" style={{ animation: "fogPop 0.25s both" }}>
          <p className="text-xs text-white/80">
            🗣️ {who(fx.seat)} → {who(fx.target)}
          </p>
          <p className="text-[11px] text-white/60">{fx.cards.map(cardLabel).join(" · ")}</p>
          <p className="text-2xl font-black text-amber-200" style={{ animation: "fogPop 0.3s 0.5s both" }}>
            {fx.count}장
          </p>
        </div>
      );
    case "received":
      return (
        <div className={box} style={{ animation: "fogPop 0.25s both" }}>
          <p className="text-sm font-bold text-emerald-200">🤫 {who(fx.from)}이(가) 몰래 보여 준 카드</p>
          <div style={{ animation: "fogFlip 0.5s 0.2s both" }}>
            <CaseCard card={fx.card} size="lg" />
          </div>
          <p className="text-[11px] text-white/60">수사 노트에 자동으로 적었어요</p>
        </div>
      );
    case "clue":
      return (
        <div className={box} style={{ animation: "fogPop 0.25s both" }}>
          <p className="text-sm font-bold text-sky-200">{fx.bell ? "🔔 괘종 단서 발견!" : "🔎 단서 발견!"}</p>
          <p className="max-w-xs rounded-xl border border-amber-200/30 bg-[#f3e9d2] px-3 py-2 text-sm font-semibold break-keep text-[#3b2a16] shadow-lg">{fx.text}</p>
        </div>
      );
    case "bell":
      return (
        <div className={box} style={{ animation: "fogPop 0.25s both" }}>
          <p className="text-3xl">🔔</p>
          <p className="text-sm font-bold break-keep text-amber-100">
            괘종이 울린다 — {ROOMS[fx.room].icon} {ROOMS[fx.room].name}에서 무언가 떨어지는 소리!
          </p>
          <p className="text-[11px] text-white/60">그 방 맨 위에 강한 단서가 놓였어요</p>
        </div>
      );
    case "vault":
      return (
        <div className={box} style={{ animation: "fogPop 0.25s both" }}>
          <p className="text-sm font-bold text-amber-100">🗄️ 금고가 열렸다</p>
          <CaseCard card={fx.card} />
        </div>
      );
    case "dawn":
      return (
        <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 rounded-2xl bg-gradient-to-t from-amber-300/60 to-indigo-950/80 p-3 text-center" style={{ animation: "fogPop 0.4s both" }}>
          <p className="text-3xl">🌅</p>
          <p className="text-base font-black text-white">새벽 6시 — 배가 들어온다</p>
          <p className="text-xs text-white/80">마지막 추리를 봉인하세요</p>
        </div>
      );
  }
}

function LogList({ view, me, names }: { view: GameState; me: number; names: Record<number, string> }) {
  const lines = view.log.map((e, i) => ({ i, ...logLine(e, me, names, view) })).reverse();
  return (
    <div className="flex max-h-[26rem] flex-col gap-1 overflow-y-auto rounded-xl border border-white/10 bg-black/20 p-2">
      {lines.length === 0 && <p className="text-xs text-white/40">아직 기록이 없어요.</p>}
      {lines.map((l) => (
        <p key={l.i} className={`text-[11px] break-keep ${l.tone === "good" ? "text-emerald-200" : l.tone === "bad" ? "text-rose-200" : l.tone === "info" ? "text-amber-100/90" : "text-white/65"}`}>
          {l.icon} {l.text}
        </p>
      ))}
    </div>
  );
}

function Composer({ title, onClose, children }: { title: string; onClose?: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 flex justify-center p-2 sm:p-4">
      <div className="flex max-h-[80vh] w-full max-w-xl flex-col gap-2.5 overflow-y-auto rounded-2xl border border-amber-300/30 bg-[#17121b]/95 p-3 shadow-2xl backdrop-blur" style={{ animation: "fogPop 0.2s both" }}>
        <div className="flex items-center">
          <p className="flex-1 text-sm font-black text-amber-100">{title}</p>
          {onClose && (
            <button type="button" onClick={onClose} className="rounded-full px-2 text-white/60 hover:text-white" aria-label="닫기">
              ✕
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

function CardPicker({ label, cards, value, onPick, mine }: { label: string; cards: number[]; value: number | null; onPick: (c: number) => void; mine: number[] }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-white/60">{label}</p>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {cards.map((c) => (
          <CaseCard
            key={c}
            card={c}
            size="sm"
            selected={value === c}
            badge={mine.includes(c) ? "내 것" : undefined}
            onClick={() => {
              getFogSound().play("select");
              onPick(c);
            }}
          />
        ))}
      </div>
    </div>
  );
}

function GuessPicker(p: { s: number | null; w: number | null; r: number | null; setS: (c: number) => void; setW: (c: number) => void; setR: (c: number) => void; mine: number[] }) {
  return (
    <>
      <CardPicker label="범인" cards={cardsOf("suspect")} value={p.s} onPick={p.setS} mine={p.mine} />
      <CardPicker label="흉기" cards={cardsOf("weapon")} value={p.w} onPick={p.setW} mine={p.mine} />
      <CardPicker label="장소" cards={cardsOf("room")} value={p.r} onPick={p.setR} mine={p.mine} />
    </>
  );
}

function ResultPanel({ view, me, names, onGameEnd }: { view: GameState; me: number; names: Record<number, string>; onGameEnd: () => void }) {
  const o = view.outcome!;
  const sol = o.solution;
  const myRank = rankOf(view, me);
  const medal = ["", "🥇", "🥈", "🥉"];
  const seats = Array.from({ length: view.seatCount }, (_, s) => s).sort((a, b) => rankOf(view, a) - rankOf(view, b));
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-3" style={{ animation: "fogPop 0.3s both" }}>
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-2xl border border-amber-300/30 bg-gradient-to-b from-[#221827] to-[#0d0b11] p-4 text-center">
        <p className="text-xs text-white/50">🕯️ 사건 #{view.caseNo} 종결</p>
        <p className="text-xl font-black text-amber-100">
          {o.winners.length === 0 ? "🌫️ 범인이 새벽 배를 타고 사라졌다…" : o.winners.includes(me) ? "🎉 내가 사건을 풀었다!" : `🔎 ${o.winners.map((s) => seatTag(s, names)).join(", ")}이(가) 사건을 풀었다`}
        </p>
        <div className="flex justify-center gap-2">
          {[sol.suspect, sol.weapon, sol.room].map((c, i) => (
            <div key={c} style={{ animation: `fogFlip 0.5s ${0.2 + i * 0.35}s both` }}>
              <CaseCard card={c} size="md" />
            </div>
          ))}
        </div>
        <div className="rounded-xl bg-[#f3e9d2] px-3 py-2 text-left text-sm break-keep text-[#3b2a16]">
          {storyOf(sol).map((l) => (
            <p key={l}>{l}</p>
          ))}
        </div>
        <div className="flex flex-col gap-1 text-left">
          {seats.map((s) => (
            <div key={s} className="flex items-start gap-2 rounded-lg bg-white/5 px-2 py-1.5 text-xs text-white/80">
              <span className="text-base">{medal[rankOf(view, s)]}</span>
              <span className="flex-1">
                <b style={{ color: SEAT_COLORS[s % SEAT_COLORS.length] }}>{SEAT_GLYPHS[s % SEAT_GLYPHS.length]}</b> {s === me ? "나" : (names[s] ?? `${s + 1}번`)}
                <span className="text-white/45"> · 심문 {view.tally[s].asks} · 수색 {view.tally[s].searches}</span>
                <span className="block text-[10px] text-white/40">손패: {(view.hands[s] ?? []).map(cardLabel).join(", ")}</span>
              </span>
            </div>
          ))}
          {view.vault.length > 0 && <p className="text-[10px] text-white/40">🗄️ 금고: {view.vault.map(cardLabel).join(", ")}</p>}
        </div>
        <p className="text-xs text-white/60">내 순위: {medal[myRank]} {myRank}위</p>
        <button type="button" onClick={onGameEnd} className="rounded-xl bg-amber-400 px-4 py-2.5 text-sm font-bold text-slate-900">
          결과 기록하고 계속
        </button>
      </div>
    </div>
  );
}
