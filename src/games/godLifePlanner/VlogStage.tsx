"use client";

import { useEffect, useRef } from "react";

/**
 * 하루 재생의 "브이로그" 화면 — 실제 사람이 찍은 짧은 영상(Coverr 무료 라이선스, CREDITS.md)을
 * 활동마다 깔고, 같은 클립이 이어지면 끊지 않고 계속 재생한다. 하루에 쓰는 클립만 미리 받아
 * 두고 투명도로 바꿔서 블록이 넘어갈 때 깜빡이지 않는다. 소리는 없다(BGM·효과음이 따로 있음).
 */

export type VlogClip = "wake" | "sleep" | "study" | "exercise" | "work" | "nightWork" | "meet" | "rest" | "temptation" | "tired" | "idle" | "dusk";

const BASE = "/assets/games/god-life-planner/vlog/";

export default function VlogStage({ clips, active, playing, dim }: { clips: VlogClip[]; active: VlogClip; playing: boolean; dim: boolean }) {
  const refs = useRef<Partial<Record<VlogClip, HTMLVideoElement | null>>>({});
  const lastRef = useRef<VlogClip | null>(null);

  useEffect(() => {
    const changed = lastRef.current !== active;
    lastRef.current = active;
    for (const c of clips) {
      const v = refs.current[c];
      if (!v) continue;
      if (c !== active) {
        v.pause();
        continue;
      }
      if (changed) {
        try {
          v.currentTime = 0;
        } catch {
          // 메타데이터 전이면 무시 — 처음부터 재생된다
        }
      }
      if (playing) v.play().catch(() => {});
      else v.pause();
    }
  }, [active, playing, clips]);

  return (
    <div className="absolute inset-0" style={{ filter: dim ? "grayscale(0.85) brightness(0.8)" : undefined, transition: "filter 0.5s ease" }}>
      {clips.map((c) => (
        <video
          key={c}
          ref={(el) => {
            refs.current[c] = el;
          }}
          poster={`${BASE}${c}.webp`}
          muted
          loop
          playsInline
          preload="auto"
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover"
          style={{ opacity: c === active ? 1 : 0, transition: "opacity 0.45s ease" }}
        >
          {/* VP9(표준 범위) 먼저 — 오픈소스 크로미움엔 H.264가 없다. 사파리 등은 mp4 */}
          <source src={`${BASE}${c}.webm`} type="video/webm" />
          <source src={`${BASE}${c}.mp4`} type="video/mp4" />
        </video>
      ))}
    </div>
  );
}
