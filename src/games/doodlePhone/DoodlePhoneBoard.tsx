"use client";

import { useEffect } from "react";
import { getDoodlePhoneSound } from "./doodlePhoneSound";
import { gamePhase, type DoodlePhoneState, type EngineAction, type SeatIndex } from "./engine";
import ResultsStage from "./ResultsStage";
import ShowcaseStage from "./ShowcaseStage";
import TurnStage from "./TurnStage";

export interface DoodlePhoneBoardProps {
  state: DoodlePhoneState;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  connectedSeats: ReadonlySet<SeatIndex>;
  isHost: boolean;
  /** Local wall-clock ms at which this device saw the current turn open. */
  turnStartedAt: number;
  onAction: (action: EngineAction) => void;
  onRematch: () => void;
  onLeave: () => void;
}

/**
 * Controlled board (ARCHITECTURE.md §2): renders the stage for the derived
 * game phase and turns clicks into `EngineAction`s. Knows nothing about the
 * network or betting.
 */
export default function DoodlePhoneBoard(props: DoodlePhoneBoardProps) {
  const { state, viewerSeat, names, connectedSeats, isHost, turnStartedAt, onAction, onRematch, onLeave } = props;

  // The lo-fi BGM plays while a match is on screen (and BGM is unmuted in the site settings).
  useEffect(() => {
    const sound = getDoodlePhoneSound();
    sound.setBgmWanted(true);
    return () => sound.setBgmWanted(false);
  }, []);

  switch (gamePhase(state)) {
    case "turns":
      return <TurnStage state={state} viewerSeat={viewerSeat} names={names} connectedSeats={connectedSeats} turnStartedAt={turnStartedAt} onAction={onAction} />;
    case "showcase":
      return <ShowcaseStage state={state} viewerSeat={viewerSeat} names={names} isHost={isHost} onAction={onAction} />;
    case "finished":
      return <ResultsStage state={state} viewerSeat={viewerSeat} names={names} isHost={isHost} onRematch={onRematch} onLeave={onLeave} />;
  }
}
