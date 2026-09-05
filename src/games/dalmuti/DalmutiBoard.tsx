"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Avatar from "@/components/common/Avatar";
import MyTurnOverlay from "@/components/common/MyTurnOverlay";
import { getSoundEngine } from "@/lib/audio/soundEngine";
import { useAudioSettingsStore } from "@/lib/audio/audioSettings";
import RulebookModal from "./RulebookModal";
import CardExchangeModal from "./CardExchangeModal";
import { CardFace, RoleBadge, type AuraTier } from "./CardArt";
import {
  detectCommonerExchangeHistoryEvents,
  detectCommonerSwapEvents,
  detectPlayImpactEvents,
  detectTaxEvents,
  detectTaxHighlightEvents,
  FlyingExchangeCard,
  FxButton,
  PlayImpactBurst,
  ReceivedCardGlow,
  RevolutionBanner,
  type ExchangeHistoryEntry,
  type PlayImpactEvent,
  type TaxFlyEvent,
  type TaxHighlightEvent,
} from "./DalmutiEffects";
import {
  AUTO_PASS_TOAST_MS,
  AutoPassBadge,
  AutoPassSettingsPanel,
  AutoPassToast,
  evaluateAutoPass,
  useAutoPassSettings,
} from "./AutoPass";
import TaxHighlightModal from "./TaxHighlightModal";
import ExchangeHistoryPanel from "./ExchangeHistoryPanel";
import {
  computeRankings,
  isLegalPlay,
  legalPlayOptions,
  rankTitle,
  type Card,
  type DalmutiState,
  type EngineAction,
  type SeatIndex,
  type TrickResult,
} from "./engine";

/**
 * Pure game UI + rules driver — same controlled-component contract as every
 * other `<Game>Board.tsx` in this project (state via props only, intent out
 * via `onAction`). Every client holds the FULL state (every seat's hand) per
 * this project's lockstep trust model, but a hand is meant to stay secret
 * from *opponents* by the physical rules — enforced here only: the hand
 * section renders the viewer's own hand face-up but every other seat's hand
 * as a face-down count (see engine.ts's module doc).
 */
export interface DalmutiBoardProps {
  state: DalmutiState;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  connectedSeats: Set<SeatIndex>;
  onAction: (action: EngineAction) => void;
  onGameEnd: () => void;
}

export default function DalmutiBoard({ state, viewerSeat, names, connectedSeats, onAction, onGameEnd }: DalmutiBoardProps) {
  const [rulebookOpen, setRulebookOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Card-exchange VFX (2026-08-25 후속 세션) added this game's first sound —
  // browsers refuse to start audio before a user gesture, so every local
  // action dispatch below routes through this instead of `onAction`
  // directly, unlocking the shared AudioContext on the same click that
  // fires the action (same `unlock()`-inside-a-handler technique Perudo
  // uses for its dice SFX).
  // Reads the site-wide `audioSettings` store directly (2026-08-26 세션)
  // instead of a local copy of `soundEngine.isMuted()`, so this button stays
  // in sync with the header's global toggle and the settings modal.
  const muted = useAudioSettingsStore((s) => s.masterMuted);
  const toggleMasterMuted = useAudioSettingsStore((s) => s.toggleMasterMuted);
  function toggleMuted() {
    toggleMasterMuted();
    getSoundEngine().unlock();
  }
  function dispatch(action: EngineAction) {
    const engine = getSoundEngine();
    engine.unlock();
    // 양피지 카드 제출음 / 조공·세금 금화 소리 — 실제 카드 교환(진상/하사) VFX와는
    // 별개로, 매 트릭 제출·세금 반환 시점의 SFX (2026-08-26 세션).
    if (action.type === "playCards") engine.playParchmentSubmit();
    else if (action.type === "returnTax") engine.playCoinTribute();
    // 패스 선언 톤(ACTION_PASS 매핑 — AskUserQuestion으로 확정, 2026-08-27 세션 오후) +
    // "패스!" 음성(task brief §2, 2026-09-05 세션 — AskUserQuestion: 브라우저 내장
    // TTS). 자동 패스(§3, AutoPass.tsx)도 이 동일한 `dispatch`를 통해 pass를
    // 보내므로, 수동 클릭이든 자동 패스든 항상 같은 SFX+음성을 듣는다.
    else if (action.type === "pass") {
      engine.playPassWhiff();
      engine.speakPass();
    }
    onAction(action);
  }
  /** Role title for a seat, independent of the viewer — used by the exchange FX's third-party message. */
  const titleFor = useCallback((seat: SeatIndex) => rankTitle(state.rankOrder.indexOf(seat), state.playerCount), [state.rankOrder, state.playerCount]);

  // Same "diff consecutive lockstep snapshots on render" pattern every other
  // Board in this project uses to drive purely cosmetic flourishes — see
  // DalmutiEffects.tsx's module doc.
  const [trackedState, setTrackedState] = useState(state);
  const [taxEvents, setTaxEvents] = useState<TaxFlyEvent[]>([]);
  // Large "내가 준 카드 / 받은 카드" recap popup (task brief, 2026-09-01 세션) —
  // a separate queue from `taxEvents` above: that's the ~1.4s flight overlay
  // every viewer sees (masked for non-parties); this is the additive, unmasked
  // big popup shown only to the exchange's two actual parties, once per
  // resolved tribute (see TaxHighlightModal.tsx's module doc). Queued (not a
  // single nullable field) in case this viewer is ever a party to two
  // tributes resolving in quick succession — shown one at a time.
  const [taxHighlights, setTaxHighlights] = useState<TaxHighlightEvent[]>([]);
  const [trickFlash, setTrickFlash] = useState<TrickResult | null>(null);
  const [revolutionBanner, setRevolutionBanner] = useState<{ seat: SeatIndex; isGrand: boolean } | null>(null);
  const [commonerSwapFlash, setCommonerSwapFlash] = useState<{ seatA: SeatIndex; seatB: SeatIndex } | null>(null);
  // Cards *this* viewer just received via tax/tribute or 평민 swap — driving
  // `ReceivedCardGlow`'s persistent 3.5s hand-card highlight (task brief
  // "수령 카드 3초 이상 지속 이펙트", see DalmutiEffects.tsx's module doc).
  // Independent of `taxEvents` above: that's the ~1.4s portaled flight
  // overlay, this is the actual card sitting in the hand staying lit once it
  // lands, even after the flight overlay is long gone.
  const [receivedCards, setReceivedCards] = useState<Map<string, AuraTier>>(new Map());
  // Permanent "📜 세금 교환 기록" log (task brief, 2026-09-02 세션) — unlike
  // every queue above (each self-clears once its transient animation
  // finishes), this one only ever grows for the rest of the game. Holds
  // *every* exchange (own and others'), not just this viewer's own —
  // `ExchangeHistoryPanel.tsx` decides per row how much detail to reveal
  // (AskUserQuestion: full card detail for a party, masked count-only
  // summary for everyone else), same "log everything, mask at render time"
  // split `FlyingExchangeCard`'s `isExchangeParticipant` already uses.
  const [exchangeHistory, setExchangeHistory] = useState<ExchangeHistoryEntry[]>([]);
  // 카드 출도 타격 이펙트 큐 (task brief §1, 2026-09-05 세션) — 트릭에 새로
  // 추가된 플레이마다 하나씩, `PlayImpactBurst`가 스스로 정리(self-clean)한다.
  // 같은 트리거로 화면 미세 진동(`shake`)도 함께 건다 — 두 개의 동일한 모양
  // 키프레임(`dalmuti-screen-shake-1`/`-2`)을 번갈아 사용해, 연달아 카드가
  // 나올 때도 애니메이션이 매번 처음부터 다시 재생되도록 한다(globals.css 참고).
  const [playImpacts, setPlayImpacts] = useState<PlayImpactEvent[]>([]);
  const [shake, setShake] = useState<{ token: number; grand: boolean } | null>(null);
  if (trackedState !== state) {
    const newTax = detectTaxEvents(trackedState, state);
    const newCommonerSwaps = detectCommonerSwapEvents(trackedState, state);
    const newPlayImpacts = detectPlayImpactEvents(trackedState, state);
    const newTrick = state.lastTrickResult !== trackedState.lastTrickResult ? state.lastTrickResult : null;
    const newRevolution = state.revolutionDeclared !== trackedState.revolutionDeclared ? state.revolutionDeclared : null;
    setTrackedState(state);
    if (newPlayImpacts.length > 0) {
      setPlayImpacts((prev) => {
        let nextId = (prev.at(-1)?.id ?? 0) + 1;
        return [...prev, ...newPlayImpacts.map((e) => ({ ...e, id: nextId++ }))];
      });
      // 묵직한 타격 SFX(+대량 출도/조커 시 골드 스파클) — 제출한 본인뿐 아니라
      // 트릭을 보고 있는 모든 접속자에게 동일하게 재생(`playRevolutionBell`과
      // 같은 diff-트리거 위치, dispatch()의 actor-only 사운드들과는 다름).
      const grand = newPlayImpacts.some((e) => e.isGrand);
      getSoundEngine().playCardSlam(grand);
      // `playIndex`(트릭 내에서 항상 증가, 새 트릭마다 0부터 재시작)를 그대로
      // 토큰으로 재사용 — 렌더 중에는 ref를 건드릴 수 없으므로(react-hooks/refs)
      // 별도 카운터 ref 없이 이미 갖고 있는 값으로 짝/홀만 구분하면 충분하다.
      setShake({ token: newPlayImpacts[newPlayImpacts.length - 1].playIndex, grand });
    }
    if (newTax.length > 0 || newCommonerSwaps.length > 0) {
      setTaxEvents((prev) => {
        let nextId = (prev.at(-1)?.id ?? 0) + 1;
        return [...prev, ...[...newTax, ...newCommonerSwaps].map((e) => ({ ...e, id: nextId++ }))];
      });
    }
    const newTributeHighlights = detectTaxHighlightEvents(trackedState, state);
    // Only queued for the two actual parties (AskUserQuestion, 2026-09-01) —
    // never for a third-party viewer, same masking scope as `taxEvents` above.
    const newHighlights = newTributeHighlights.filter((e) => e.recipientSeat === viewerSeat || e.giverSeat === viewerSeat);
    if (newHighlights.length > 0) {
      setTaxHighlights((prev) => {
        let nextId = (prev.at(-1)?.id ?? 0) + 1;
        return [...prev, ...newHighlights.map((e) => ({ ...e, id: nextId++ }))];
      });
    }
    // History log: every resolved tribute + every resolved commoner swap,
    // for every viewer (AskUserQuestion, 2026-09-02) — detail level is
    // decided per-row by ExchangeHistoryPanel.tsx, not filtered here.
    const newCommonerHistory = detectCommonerExchangeHistoryEvents(trackedState, state);
    if (newTributeHighlights.length > 0 || newCommonerHistory.length > 0) {
      setExchangeHistory((prev) => {
        let nextId = (prev.at(-1)?.id ?? 0) + 1;
        const tributeEntries: ExchangeHistoryEntry[] = newTributeHighlights.map((e) => ({
          id: nextId++,
          kind: e.auraTier as "king" | "noble", // detectTaxHighlightEvents only ever tags "king"/"noble" (see its doc) — auraTier's 3rd value ("commoner") belongs solely to the unrelated FlyingExchangeCard flight tier
          recipientSeat: e.recipientSeat,
          giverSeat: e.giverSeat,
          givenCards: e.givenCards,
          returnedCards: e.returnedCards,
        }));
        const commonerEntries: ExchangeHistoryEntry[] = newCommonerHistory.map((e) => ({
          id: nextId++,
          kind: "commoner",
          seatA: e.seatA,
          seatB: e.seatB,
          cardFromA: e.cardFromA,
          cardFromB: e.cardFromB,
        }));
        return [...prev, ...tributeEntries, ...commonerEntries];
      });
    }
    const newlyReceivedByMe = [...newTax, ...newCommonerSwaps].filter((e) => e.targetSeat === viewerSeat);
    if (newlyReceivedByMe.length > 0) {
      setReceivedCards((prev) => {
        const next = new Map(prev);
        for (const e of newlyReceivedByMe) for (const c of e.cards) next.set(c.id, e.auraTier);
        return next;
      });
    }
    if (newTrick) setTrickFlash(newTrick);
    if (newRevolution) {
      setRevolutionBanner(newRevolution);
      // 반란 종소리(REVOLUTION_BELL 매핑 — AskUserQuestion으로 확정, 2026-08-27
      // 세션 오후). 라스베가스 diff 블록의 playCasinoDiceRoll/playTieSpark와
      // 같은 패턴으로, 상태 변화 자체를 감지해 모든 뷰어에게 재생(선언한
      // 본인의 로컬 dispatch()에만 의존하지 않음).
      getSoundEngine().playRevolutionBell();
    }
    // Commoner-swap events come in pairs (one per direction) — surface the
    // "교환 완료" popup once per completed pair, not once per direction.
    if (newCommonerSwaps.length > 0) setCommonerSwapFlash({ seatA: newCommonerSwaps[0].seat, seatB: newCommonerSwaps[0].targetSeat });
  }
  const clearReceivedCard = useCallback((cardId: string) => {
    setReceivedCards((prev) => {
      if (!prev.has(cardId)) return prev;
      const next = new Map(prev);
      next.delete(cardId);
      return next;
    });
  }, []);
  const clearPlayImpact = useCallback((id: number) => {
    setPlayImpacts((prev) => prev.filter((e) => e.id !== id));
  }, []);
  useEffect(() => {
    if (!trickFlash) return;
    const t = setTimeout(() => setTrickFlash(null), 3200);
    return () => clearTimeout(t);
  }, [trickFlash]);
  useEffect(() => {
    if (!commonerSwapFlash) return;
    const t = setTimeout(() => setCommonerSwapFlash(null), 3200);
    return () => clearTimeout(t);
  }, [commonerSwapFlash]);
  useEffect(() => {
    if (!shake) return;
    const t = setTimeout(() => setShake(null), shake.grand ? 450 : 300);
    return () => clearTimeout(t);
  }, [shake]);

  // ---------------------------------------------------------------------
  // 스마트 자동 패스 (task brief §3, 2026-09-05 세션) — see AutoPass.tsx's
  // module doc for the condition semantics. Placed here, above the
  // `gameOver` early return below, per this file's own Rules-of-Hooks note
  // further down (every hook must run on every render).
  // ---------------------------------------------------------------------
  const autoPass = useAutoPassSettings();
  const [autoPassPanelOpen, setAutoPassPanelOpen] = useState(false);
  const [autoPassToast, setAutoPassToast] = useState<{ id: number; reason: string } | null>(null);
  const autoPassToastIdRef = useRef(0);
  useEffect(() => {
    // 수동으로 카드를 고르기 시작하면 자동 패스 의도를 취소한 것으로 간주
    // (AskUserQuestion, 2026-09-05: "수동 개입 시 자동 취소").
    if (selected.size > 0) return;
    const decision = evaluateAutoPass(state, viewerSeat, autoPass.settings);
    if (!decision.shouldPass) return;
    const id = ++autoPassToastIdRef.current;
    setAutoPassToast({ id, reason: decision.reason });
    const t = setTimeout(() => {
      setAutoPassToast((prev) => (prev?.id === id ? null : prev));
      dispatch({ type: "pass", seat: viewerSeat });
    }, AUTO_PASS_TOAST_MS);
    // 정리 시점에 토스트/타이머를 함께 걷어낸다 — `state`/`selected`/설정이
    // 바뀌어 이 effect가 다시 실행될 때(예: 수동 선택으로 취소, 다음 턴으로
    // 진행 등) 낡은 토스트가 남아있지 않도록 한다.
    return () => {
      clearTimeout(t);
      setAutoPassToast((prev) => (prev?.id === id ? null : prev));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `dispatch`/`autoPass.settings` intentionally re-read fresh each run, same as every other closure in this component
  }, [state, viewerSeat, selected, autoPass.settings]);
  // 게임 시작 시 신분 배정 SFX — 왕/귀족 등 상위 신분은 팡파르, 최하위(노예)는
  // 쇠사슬음. 이 보드가 마운트되는 시점(대국 시작)에 1회만 재생 (2026-08-26 세션).
  useEffect(() => {
    const engine = getSoundEngine();
    const myRankPosition = state.rankOrder.indexOf(viewerSeat);
    if (myRankPosition === state.playerCount - 1) engine.playChainRattle();
    else engine.playRankFanfare();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const handleTaxDone = useCallback((id: number) => {
    setTaxEvents((prev) => prev.filter((e) => e.id !== id));
  }, []);
  const handleTaxHighlightDone = useCallback((id: number) => {
    setTaxHighlights((prev) => prev.filter((e) => e.id !== id));
  }, []);

  // Card-selection resets whenever the turn/trick shape moves on, so a stale
  // partial selection from a previous turn never lingers into the next one.
  // Adjusted directly during render (React's recommended "state adjustment"
  // pattern, same as `trackedState` above) rather than in an effect, so it
  // never triggers a second cascading render just to clear a selection.
  const selectionKey = `${state.activeSeat}-${state.trick.plays.length}-${state.phase}`;
  const [trackedSelectionKey, setTrackedSelectionKey] = useState(selectionKey);
  if (trackedSelectionKey !== selectionKey) {
    setTrackedSelectionKey(selectionKey);
    setSelected(new Set());
  }

  const seatRowRefs = useRef(new Map<SeatIndex, HTMLElement>());
  function setSeatRowRef(seat: SeatIndex) {
    return (el: HTMLElement | null) => {
      if (el) seatRowRefs.current.set(seat, el);
      else seatRowRefs.current.delete(seat);
    };
  }

  const rulebookButton = (
    <button
      onClick={() => setRulebookOpen(true)}
      className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/60 transition hover:border-white/30 hover:text-white"
    >
      📖 달무티 룰북
    </button>
  );

  const muteButton = (
    <button
      onClick={toggleMuted}
      title={muted ? "효과음 켜기" : "효과음 끄기"}
      className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/60 transition hover:border-white/30 hover:text-white"
    >
      {muted ? "🔇" : "🔊"}
    </button>
  );

  // ⚙️ 자동 패스 설정 드롭다운 토글 — task brief §3. 열고 닫는 상태(`autoPassPanelOpen`)만
  // 로컬 UI 상태이고, 실제 조건 값은 위에서 이미 초기화한 `autoPass`가 들고 있다.
  const autoPassButton = (
    <div className="relative">
      <FxButton
        variant="slate"
        onClick={() => {
          getSoundEngine().unlock();
          setAutoPassPanelOpen((v) => !v);
        }}
        className={`rounded-full border px-2.5 py-1 text-[11px] break-keep transition ${
          autoPass.anyEnabled ? "border-sky-300/60 bg-sky-400/10 text-sky-100" : "border-white/15 text-white/60 hover:border-white/30 hover:text-white"
        }`}
      >
        ⚙️ 자동 패스{autoPass.anyEnabled ? " · ON" : ""}
      </FxButton>
      {autoPassPanelOpen && (
        <AutoPassSettingsPanel
          settings={autoPass.settings}
          onChange={(patch) => {
            getSoundEngine().unlock();
            autoPass.update(patch);
          }}
          onClose={() => setAutoPassPanelOpen(false)}
        />
      )}
    </div>
  );

  // ---------------------------------------------------------------------
  // Game over
  // ---------------------------------------------------------------------
  if (state.phase === "gameOver") {
    const rankings = computeRankings(state);
    const winner = rankings.find((r) => r.rank === 1)!;
    return (
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:gap-4">
      <div
        className="relative flex min-w-0 flex-1 flex-col items-center gap-5 rounded-[28px] border border-black/60 p-6 text-center shadow-[0_25px_60px_-25px_rgba(0,0,0,0.95)] sm:p-8"
        style={{ background: "linear-gradient(160deg,#241a3a 0%,#160f26 55%,#0a0714 100%)" }}
      >
        <span className="text-5xl">👑</span>
        <h2 className="text-2xl font-bold text-amber-100">{names[winner.seat]}님이 진정한 왕이 되었습니다!</h2>
        <p className="text-xs text-white/50">손패를 가장 먼저 털어낸 사람이 이기는 단판 승부입니다.</p>
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-xs">
            <thead>
              <tr className="text-white/50">
                <th className="border-b border-white/10 px-2 py-2 text-left">순위</th>
                <th className="border-b border-white/10 px-2 py-2 text-left">플레이어</th>
                <th className="border-b border-white/10 px-2 py-2 text-left">시작 신분</th>
              </tr>
            </thead>
            <tbody>
              {rankings.map(({ seat, rank }) => {
                const startTitle = rankTitle(state.rankOrder.indexOf(seat), state.playerCount);
                return (
                  <tr key={seat} className={rank === 1 ? "bg-amber-400/10" : ""}>
                    <td className="border-b border-white/5 px-2 py-2 text-left font-bold text-amber-200">{rank === 1 ? "👑 1" : rank}</td>
                    <td className="border-b border-white/5 px-2 py-2 text-left text-white">
                      <span className="flex items-center gap-1.5">
                        <Avatar size={20} />
                        {names[seat]}
                        {seat === viewerSeat && <span className="text-amber-200">(나)</span>}
                      </span>
                    </td>
                    <td className="border-b border-white/5 px-2 py-2 text-left">
                      <RoleBadge title={startTitle} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button onClick={onGameEnd} className="rounded-full bg-amber-500 px-8 py-3 font-medium text-black transition hover:bg-amber-400">
          결과 확정하고 계속하기
        </button>
      </div>
      <ExchangeHistoryPanel entries={exchangeHistory} viewerSeat={viewerSeat} names={names} titleFor={titleFor} />
      </div>
    );
  }

  // ---------------------------------------------------------------------
  // Playing (revolutionOption / taxReturn / trick)
  // ---------------------------------------------------------------------
  const me = state.players.find((p) => p.seat === viewerSeat)!;
  const myPosition = state.rankOrder.indexOf(viewerSeat);
  const myTitle = rankTitle(myPosition, state.playerCount);
  const seatOrder = state.rankOrder;

  const isMyTrickTurn = state.phase === "trick" && state.activeSeat === viewerSeat;
  const trickOptions = isMyTrickTurn ? legalPlayOptions(state, viewerSeat) : [];
  const legalRanks = new Set(trickOptions.map((o) => o.rank));
  const myTribute = state.tributes.find((t) => t.toSeat === viewerSeat && !t.resolved);
  const isMyTaxTurn = state.phase === "taxReturn" && !!myTribute;
  const isMyRevolutionTurn = state.phase === "revolutionOption" && state.pendingRevolution?.seat === viewerSeat;

  const myCommonerParticipant = state.commonerExchange?.participants.find((p) => p.seat === viewerSeat) ?? null;
  const isMyCommonerOptInTurn = state.phase === "commonerExchange" && !!myCommonerParticipant && myCommonerParticipant.participate === null;
  const myCommonerPair = state.commonerExchange?.pairs.find((p) => !p.resolved && (p.seatA === viewerSeat || p.seatB === viewerSeat)) ?? null;
  const myCommonerPairIsA = myCommonerPair?.seatA === viewerSeat;
  const myCommonerAlreadyPicked = !!myCommonerPair && (myCommonerPairIsA ? myCommonerPair.cardIdA !== null : myCommonerPair.cardIdB !== null);
  const isMyCommonerOfferTurn = state.phase === "commonerExchange" && !!myCommonerPair && !myCommonerAlreadyPicked;
  const myCommonerPartnerSeat = myCommonerPair ? (myCommonerPairIsA ? myCommonerPair.seatB : myCommonerPair.seatA) : null;

  const selectedCards = me.hand.filter((c) => selected.has(c.id));
  const selectedNonJokerRanks = new Set(selectedCards.filter((c) => !c.isJoker).map((c) => c.rank));

  function isSelectableForTrick(card: Card): boolean {
    if (!isMyTrickTurn) return false;
    const requiredCount = state.trick.count;
    if (requiredCount > 0 && selected.size >= requiredCount) return false;
    if (card.isJoker) {
      if (requiredCount === 0) return true; // leading: a joker is always a legal addition
      return selectedNonJokerRanks.size > 0; // following: joker only useful once a beating rank is chosen
    }
    if (!legalRanks.has(card.rank)) return false;
    if (selectedNonJokerRanks.size > 0 && !selectedNonJokerRanks.has(card.rank)) return false;
    return true;
  }

  // commonerExchange's card pick no longer shares this inline hand-click
  // flow — it gets its own dedicated `CardExchangeModal` (task brief §1,
  // 2026-08-25 후속 세션), rendered further down.
  //
  // 2026-09-04 세션: kept as plain functions, *not* `useCallback` — this
  // component has an earlier conditional `return` for `state.phase ===
  // "gameOver"` (above), so hooks placed here would only run some renders
  // (a real Rules-of-Hooks violation, caught by `react-hooks/rules-of-hooks`
  // while wiring up `FxButton` below). Memoizing them would also buy nothing
  // real anyway: `dispatch` itself (just above) is a fresh closure every
  // render, so any `useCallback` wrapping one of these would still change
  // identity every render regardless.
  function toggleCard(card: Card) {
    if (state.phase === "trick") {
      if (!isMyTrickTurn) return;
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(card.id)) {
          next.delete(card.id);
          return next;
        }
        return isSelectableForTrick(card) ? new Set(next).add(card.id) : prev;
      });
    } else if (state.phase === "taxReturn" && isMyTaxTurn && myTribute) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(card.id)) {
          next.delete(card.id);
          return next;
        }
        if (next.size >= myTribute.givenCardIds.length) return prev;
        return new Set(next).add(card.id);
      });
    }
  }

  const canSubmitPlay = state.phase === "trick" && isMyTrickTurn && selected.size > 0 && isLegalPlay(state, viewerSeat, Array.from(selected));
  const canReturnTax = isMyTaxTurn && !!myTribute && selected.size === myTribute.givenCardIds.length;

  function submitPlay() {
    if (!canSubmitPlay) return;
    dispatch({ type: "playCards", seat: viewerSeat, cardIds: Array.from(selected) });
  }
  function passTurn() {
    if (state.phase !== "trick" || !isMyTrickTurn || state.trick.count === 0) return;
    dispatch({ type: "pass", seat: viewerSeat });
  }
  function submitReturnTax() {
    if (!canReturnTax) return;
    dispatch({ type: "returnTax", seat: viewerSeat, cardIds: Array.from(selected) });
  }
  function submitCommonerOffer(cardId: string) {
    dispatch({ type: "commonerOfferCard", seat: viewerSeat, cardId });
  }

  const cardIsClickable = (state.phase === "trick" && isMyTrickTurn) || (state.phase === "taxReturn" && isMyTaxTurn);
  const cardIsHighlighted = (card: Card) => {
    if (selected.has(card.id)) return true;
    if (state.phase === "trick") return isMyTrickTurn && isSelectableForTrick(card);
    if (state.phase === "taxReturn") return isMyTaxTurn && !!myTribute && selected.size < myTribute.givenCardIds.length;
    return false;
  };

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:gap-4">
    <MyTurnOverlay isMyTurn={isMyTrickTurn} />
    <div
      className="flex min-w-0 flex-1 flex-col gap-3 rounded-[28px] border border-black/60 p-2.5 shadow-[0_25px_60px_-25px_rgba(0,0,0,0.95)] sm:p-4"
      style={{
        background: "linear-gradient(160deg,#1c1430 0%,#120c20 45%,#080510 100%)",
        // 카드 출도 타격 시 화면 미세 진동(task brief §1) — 두 개의 동일한
        // 모양 키프레임을 번갈아 사용해 연달아 카드가 나올 때도 매번 처음부터
        // 다시 재생되도록 한다 (globals.css의 `dalmuti-screen-shake-1/-2` 참고).
        animation: shake ? `dalmuti-screen-shake-${shake.token % 2 === 0 ? 1 : 2} ${shake.grand ? 450 : 300}ms ease-in-out` : undefined,
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs text-purple-100/70">
        <span className="flex items-center gap-1.5">
          {state.playerCount}인 · 단판 승부 ·{" "}
          <RoleBadge title={myTitle} />
        </span>
        <div className="flex flex-wrap gap-1.5">
          {autoPassButton}
          {muteButton}
          {rulebookButton}
        </div>
      </div>

      {/* Revolution option */}
      {state.phase === "revolutionOption" && state.pendingRevolution && (
        <div className="rounded-xl border border-rose-400/40 bg-rose-500/10 px-3 py-3 text-center text-xs">
          {isMyRevolutionTurn ? (
            <div className="flex flex-col items-center gap-2">
              <p className="font-semibold text-rose-200">
                🃏 조커 2장을 모두 갖고 있습니다! {state.pendingRevolution.isGrand ? "대혁명(모든 신분 역전)" : "혁명(세금 취소)"}을 선포하시겠습니까?
              </p>
              <div className="flex gap-2">
                <FxButton
                  variant="rose"
                  onClick={() => dispatch({ type: "declareRevolution", seat: viewerSeat })}
                  className="rounded-full bg-rose-500 px-4 py-2 text-xs font-bold text-white hover:bg-rose-400"
                >
                  {state.pendingRevolution.isGrand ? "🔥 대혁명 선포" : "⚡ 혁명 선포"}
                </FxButton>
                <FxButton
                  variant="slate"
                  onClick={() => dispatch({ type: "declineRevolution", seat: viewerSeat })}
                  className="rounded-full border border-white/20 px-4 py-2 text-xs text-white/70 hover:border-white/40"
                >
                  선포하지 않기
                </FxButton>
              </div>
            </div>
          ) : (
            <p className="text-white/70">
              {names[state.pendingRevolution.seat]}님이 조커 2장을 모두 갖고 있어 혁명 선포 여부를 고민 중입니다...
            </p>
          )}
        </div>
      )}

      {/* Tax phase */}
      {state.phase === "taxReturn" && (
        <div className="flex flex-col gap-1.5 rounded-xl border border-amber-300/30 bg-amber-400/10 px-3 py-2.5 text-xs">
          <p className="text-center font-semibold text-amber-200">💰 세금 바치기</p>
          {state.tributes.map((t, i) => (
            <p key={i} className="text-center text-white/70">
              {names[t.fromSeat]} → {names[t.toSeat]}: {t.givenCardIds.length}장 진상{" "}
              {t.resolved ? "✅ 하사 완료" : t.toSeat === viewerSeat ? "⏳ 내가 돌려줄 카드 선택 중" : "⏳ 대기 중"}
            </p>
          ))}
          {isMyTaxTurn && myTribute && (
            <p className="mt-1 text-center font-medium text-amber-100">
              🫵 아래 손패에서 돌려줄 카드 {myTribute.givenCardIds.length}장을 고른 뒤 확정하세요.
            </p>
          )}
        </div>
      )}

      {/* Commoner (평민) mutual exchange phase */}
      {state.phase === "commonerExchange" && state.commonerExchange && (
        <div className="flex flex-col gap-1.5 rounded-xl border border-emerald-300/30 bg-emerald-400/10 px-3 py-2.5 text-xs">
          <p className="text-center font-semibold text-emerald-200">🌾 평민 카드 교환</p>
          {commonerSwapFlash && (
            <p className="text-center text-emerald-100">
              ✅ {names[commonerSwapFlash.seatA]}님과 {names[commonerSwapFlash.seatB]}님이 카드를 교환했습니다!
            </p>
          )}
          <div className="flex flex-col gap-1">
            {state.commonerExchange.participants.map((p) => {
              const pair = state.commonerExchange!.pairs.find((pr) => pr.seatA === p.seat || pr.seatB === p.seat);
              let status: string;
              if (p.participate === null) status = "⏳ 참여 여부 결정 중";
              else if (p.participate === false) status = "🙅 교환 미참여";
              else if (!pair) status = "🙅 짝 없음(참여자 홀수)";
              else if (pair.resolved) status = "✅ 교환 완료";
              else status = "⏳ 카드 선택 중";
              return (
                <p key={p.seat} className="text-center text-white/70">
                  {names[p.seat]}: {status}
                </p>
              );
            })}
          </div>
          {isMyCommonerOptInTurn && (
            <div className="mt-1 flex flex-col items-center gap-2">
              <p className="font-medium text-emerald-100">🫵 다른 평민과 카드 1장을 맞교환하시겠습니까?</p>
              <div className="flex gap-2">
                <FxButton
                  variant="emerald"
                  onClick={() => dispatch({ type: "commonerOptIn", seat: viewerSeat, participate: true })}
                  className="rounded-full bg-emerald-500 px-4 py-2 text-xs font-bold text-black hover:bg-emerald-400"
                >
                  🤝 교환 요청
                </FxButton>
                <FxButton
                  variant="slate"
                  onClick={() => dispatch({ type: "commonerOptIn", seat: viewerSeat, participate: false })}
                  className="rounded-full border border-white/20 px-4 py-2 text-xs text-white/70 hover:border-white/40"
                >
                  ❌ 거절
                </FxButton>
              </div>
            </div>
          )}
          {isMyCommonerOfferTurn && (
            <p className="mt-1 text-center font-medium text-emerald-100">🫵 팝업 창에서 상대에게 건넬 카드를 골라주세요.</p>
          )}
        </div>
      )}

      {/* Trick area */}
      {state.phase === "trick" && (
        <>
          {trickFlash && (
            <div className="rounded-xl border border-amber-300/30 bg-amber-400/10 px-3 py-2 text-center text-xs text-white/70">
              {names[trickFlash.winnerSeat]}님이 {trickFlash.rankValue === 13 ? "조커" : `${trickFlash.rankValue}번`} {trickFlash.count}장으로 트릭을 가져가 다음 리드가 됩니다.
            </div>
          )}
          <p className={`text-center text-xs font-medium ${isMyTrickTurn ? "text-amber-200" : "text-white/50"}`}>
            {isMyTrickTurn
              ? state.trick.count === 0
                ? "🫵 당신 차례입니다! 트릭을 리드할 카드를 원하는 계급/장수로 내세요."
                : `🫵 당신 차례입니다! 같은 장수(${state.trick.count}장)이면서 더 높은 계급(숫자 < ${state.trick.rankValue})만 낼 수 있어요.`
              : `${names[state.activeSeat]}님 차례를 기다리는 중...`}
          </p>
          <section className="flex flex-wrap items-start justify-center gap-2.5 rounded-2xl border border-white/10 bg-black/25 p-3">
            {state.trick.plays.length === 0 ? (
              <p className="py-6 text-xs text-white/30">아직 아무도 카드를 내지 않았어요. 이 트릭의 선입니다.</p>
            ) : (
              state.trick.plays.map((play, i) => {
                const cardsEl = (
                  <div className="flex -space-x-8">
                    {play.cards.map((c) => (
                      <CardFace key={c.id} card={c} />
                    ))}
                  </div>
                );
                // 이 play에 해당하는 카드 출도 타격 이펙트가 아직 재생 중이면
                // 감싸서 보여준다 — playIndex로 정확히 매칭(task brief §1).
                const impact = playImpacts.find((e) => e.playIndex === i);
                return (
                  <div key={`${play.seat}-${i}`} className="flex flex-col items-center gap-1">
                    <span className={`text-[10px] font-semibold ${play.seat === viewerSeat ? "text-amber-200" : "text-white/50"}`}>
                      {i + 1}. {names[play.seat]}
                    </span>
                    {impact ? (
                      <PlayImpactBurst isGrand={impact.isGrand} onDone={() => clearPlayImpact(impact.id)}>
                        {cardsEl}
                      </PlayImpactBurst>
                    ) : (
                      cardsEl
                    )}
                  </div>
                );
              })
            )}
          </section>
        </>
      )}

      {/* Scoreboard */}
      <section className="flex flex-col gap-1.5">
        {seatOrder.map((seat, position) => {
          const p = state.players.find((pl) => pl.seat === seat)!;
          const title = rankTitle(position, state.playerCount);
          const isActive = state.phase === "trick" && state.activeSeat === seat;
          const isSelf = seat === viewerSeat;
          return (
            <div
              key={seat}
              ref={setSeatRowRef(seat)}
              className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border p-2 text-xs transition ${
                p.finishedAtOrder !== null
                  ? "border-white/5 bg-black/10 opacity-60"
                  : isActive
                    ? "border-amber-300/60 bg-amber-400/10"
                    : "border-white/10 bg-black/20"
              }`}
            >
              <span className="flex items-center gap-1.5 font-semibold text-white/90">
                <Avatar size={20} />
                <span className={`h-1.5 w-1.5 rounded-full ${connectedSeats.has(seat) ? "bg-emerald-400" : "bg-white/20"}`} />
                {isActive && <span title="차례">👉</span>}
                <RoleBadge title={title} />
                {names[seat]}
                {isSelf && <span className="text-amber-200">(나)</span>}
                {p.finishedAtOrder !== null && <span className="text-amber-300">🏁 {p.finishedAtOrder}등</span>}
              </span>
              <span className="text-white/70" title="남은 손패 수">
                🂠 {p.hand.length}장
              </span>
            </div>
          );
        })}
      </section>

      {/* My hand */}
      <section
        className="rounded-2xl border border-purple-300/20 p-2.5 sm:p-3"
        style={{ background: "linear-gradient(160deg,#241a3a 0%,#160f26 55%,#0a0714 100%)" }}
      >
        <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-purple-200/90 uppercase">🃏 내 손패 ({me.hand.length}장)</h3>
        {me.hand.length === 0 ? (
          <p className="text-xs text-white/30">손패가 없습니다.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {[...me.hand]
              .sort((a, b) => a.rank - b.rank)
              .map((c) => {
                const clickable = cardIsClickable;
                const highlighted = cardIsHighlighted(c);
                const receivedTier = receivedCards.get(c.id);
                const button = (
                  <FxButton
                    key={c.id}
                    variant="card"
                    disabled={!clickable || (!highlighted && !selected.has(c.id))}
                    onClick={() => toggleCard(c)}
                    className={`transition ${clickable && (highlighted || selected.has(c.id)) ? "cursor-pointer hover:-translate-y-1" : "cursor-not-allowed opacity-40"} ${
                      selected.has(c.id) ? "-translate-y-2" : ""
                    }`}
                  >
                    <CardFace card={c} highlight={highlighted} />
                  </FxButton>
                );
                // Stacks with (doesn't replace) the "legal to play" gold ring
                // above — task brief follow-up confirmed via AskUserQuestion.
                if (!receivedTier) return button;
                return (
                  <ReceivedCardGlow key={c.id} tier={receivedTier} onDone={() => clearReceivedCard(c.id)}>
                    {button}
                  </ReceivedCardGlow>
                );
              })}
          </div>
        )}
        {state.phase === "trick" && isMyTrickTurn && (
          <div className="mt-3 flex flex-col items-center">
            {autoPass.anyEnabled && <AutoPassBadge onDisable={autoPass.disableAll} />}
            <div className="flex justify-center gap-2">
            <FxButton
              variant="slate"
              onClick={passTurn}
              disabled={state.trick.count === 0}
              className="rounded-full border border-white/20 px-5 py-2 text-xs font-semibold text-white/80 transition hover:border-white/40 disabled:cursor-not-allowed disabled:opacity-30"
            >
              🙅 패스
            </FxButton>
            <FxButton
              variant="gold"
              onClick={submitPlay}
              disabled={!canSubmitPlay}
              className="rounded-full bg-amber-500 px-5 py-2 text-xs font-bold text-black transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-30"
            >
              🃏 카드 내기 ({selected.size}장)
            </FxButton>
            </div>
          </div>
        )}
        {state.phase === "taxReturn" && isMyTaxTurn && (
          <div className="mt-3 flex justify-center">
            <FxButton
              variant="gold"
              onClick={submitReturnTax}
              disabled={!canReturnTax}
              className="rounded-full bg-amber-500 px-5 py-2 text-xs font-bold text-black transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-30"
            >
              💰 {selected.size}/{myTribute?.givenCardIds.length ?? 0}장 돌려주기
            </FxButton>
          </div>
        )}
      </section>

      {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}

      {/* 평민 카드 교환 — 원하는 카드 1장 자유 선택 모달 (task brief §1) */}
      {isMyCommonerOfferTurn && myCommonerPartnerSeat !== null && (
        <CardExchangeModal hand={me.hand} partnerName={names[myCommonerPartnerSeat]} onSubmit={submitCommonerOffer} />
      )}

      {/* Tax/tribute + 평민 교환 FX — masked to CardBack for any viewer who isn't a party to that specific exchange (task brief §2) */}
      {taxEvents.map((event) => (
        <FlyingExchangeCard
          key={event.id}
          event={event}
          viewerSeat={viewerSeat}
          names={names}
          titleFor={titleFor}
          getSeatEl={(seat) => seatRowRefs.current.get(seat) ?? null}
          onDone={handleTaxDone}
        />
      ))}

      {/* Large tax-exchange recap popup — one at a time, additive on top of
          the flight FX above (AskUserQuestion, 2026-09-01). */}
      {taxHighlights.length > 0 && (
        <TaxHighlightModal
          key={taxHighlights[0].id}
          event={taxHighlights[0]}
          viewerSeat={viewerSeat}
          names={names}
          titleFor={titleFor}
          onDone={() => handleTaxHighlightDone(taxHighlights[0].id)}
        />
      )}

      {/* Revolution banner */}
      {revolutionBanner && (
        <RevolutionBanner
          isGrand={revolutionBanner.isGrand}
          seatLabel={names[revolutionBanner.seat]}
          onDone={() => setRevolutionBanner(null)}
        />
      )}

      {/* 🤖 자동 패스 조건 충족 토스트 (task brief §3) */}
      {autoPassToast && <AutoPassToast reason={autoPassToast.reason} />}
    </div>
    <ExchangeHistoryPanel entries={exchangeHistory} viewerSeat={viewerSeat} names={names} titleFor={titleFor} />
    </div>
  );
}
