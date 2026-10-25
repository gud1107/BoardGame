// Opening seconds of an 8-player Avalon table (lowDetail = the phone path) for scripts/3d-perf/run.mjs.
import { createRoot } from "react-dom/client";
import AvalonTable3D from "@/games/avalon/three/AvalonTable3D";
const seats = Array.from({ length: 8 }, (_, i) => ({ seat: i, name: i === 0 ? "나" : `봇${i}`, isLeader: i === 2, onTeam: false, selected: false, voted: false, vote: null, questSubmitted: false, onSelect: null }));
createRoot(document.getElementById("root")!).render(
  <div style={{ width: "100%", height: 340 }}>
    <AvalonTable3D playerCount={8} viewerSeat={0} seats={seats} phase="team-proposal" round={1} teamSizes={[3,4,4,5,5]} twoFails={[false,false,false,true,false]}
      results={[]} consecutiveRejects={0} questCardsIn={0} lastQuestReveal={null} assassinSeat={null} overview={false} lowDetail={true} names={Object.fromEntries(seats.map((s) => [s.seat, s.name]))} />
  </div>,
);
