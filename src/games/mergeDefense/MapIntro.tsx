"use client";

import { useEffect, useState } from "react";
import { MAP_IDS, MAPS, type MapId } from "./engine";
import { MapThumb } from "./RoomSettings";
import * as audio from "./mergeDefenseAudio";

const SPIN_MS = 1100;
const HOLD_MS = 1700;

/**
 * Match-start card over the battlefield: the map's sketch, name and blurb.
 * A 🎲 room first spins through the maps like a slot reel and slows onto the
 * drawn one (a click per flip, a bell 'ding' on landing). Click-through, gone
 * after ~3s; reduced motion skips the spin.
 */
export default function MapIntro({ map, random }: { map: MapId; random: boolean }) {
  const [shown, setShown] = useState<MapId>(() => (random ? MAP_IDS[(MAP_IDS.indexOf(map) + 1) % MAP_IDS.length] : map));
  const [landed, setLanded] = useState(!random);
  const [fading, setFading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const timers: number[] = [];
    let spin = 0;
    if (random && !reduce) {
      // Ticks get further apart — the reel slows down before it stops.
      let t = 0;
      let i = MAP_IDS.indexOf(map);
      for (let gap = 70; t + gap < SPIN_MS; gap *= 1.18) {
        t += gap;
        i += 1;
        const id = MAP_IDS[i % MAP_IDS.length];
        timers.push(
          window.setTimeout(() => {
            setShown(id);
            audio.playReelTick();
          }, t),
        );
      }
      spin = SPIN_MS;
    }
    timers.push(
      window.setTimeout(() => {
        setShown(map);
        setLanded(true);
        audio.playReelDing(random);
      }, spin),
    );
    timers.push(window.setTimeout(() => setFading(true), spin + HOLD_MS - 350));
    timers.push(window.setTimeout(() => setDone(true), spin + HOLD_MS));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [map, random]);

  if (done) return null;
  const m = MAPS[shown];
  return (
    <div className={`pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/45 px-4 transition-opacity duration-300 ${fading ? "opacity-0" : ""}`}>
      <style>{`@keyframes md-intro-land{0%{transform:scale(.8)}60%{transform:scale(1.1)}100%{transform:scale(1)}}`}</style>
      <div
        key={landed ? "landed" : "spin"}
        className={`flex w-full max-w-[260px] flex-col items-center gap-1 rounded-2xl border px-4 py-2.5 text-center shadow-2xl backdrop-blur-sm ${
          landed ? "border-amber-300/70 bg-slate-900/85 motion-safe:animate-[md-intro-land_0.45s_ease-out]" : "border-white/20 bg-slate-900/70"
        }`}
      >
        <p className="text-[11px] font-bold tracking-wide text-amber-200/90">{random ? (landed ? "🎲 이번 맵은…" : "🎲 맵 뽑는 중…") : "🗺️ 이번 맵"}</p>
        <div className="w-[55%] max-w-[130px]">
          <MapThumb id={shown} className={landed ? "" : "opacity-70 blur-[1px]"} />
        </div>
        <p className="text-xl font-black text-white sm:text-2xl">
          {m.emoji} {m.name}
        </p>
        {landed && <p className="text-[11px] break-keep text-white/70">{m.desc}</p>}
      </div>
    </div>
  );
}
