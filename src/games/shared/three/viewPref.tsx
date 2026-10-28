"use client";

import { useCallback, useState, type ReactNode } from "react";

/**
 * The board-side half of the 3D kit — deliberately free of any `three`
 * import so a board can offer the 🧊 3D / 🖼️ 2D choice without pulling
 * three.js into its main chunk (the scene itself is `next/dynamic`-loaded).
 */

export function webglAvailable(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}

export type BoardView = "3d" | "2d";

function readView(key: string): BoardView {
  try {
    return window.localStorage.getItem(key) === "2d" ? "2d" : "3d";
  } catch {
    return "3d";
  }
}

/**
 * The board's 3D/2D choice, remembered per game in localStorage. Without
 * WebGL the board is always 2D and `canToggle` is false (hide the button).
 */
export function useBoardView(storageKey: string): { view: BoardView; setView: (v: BoardView) => void; canToggle: boolean } {
  const [hasWebgl] = useState(webglAvailable);
  const [view, setViewState] = useState<BoardView>(() => (typeof window === "undefined" ? "3d" : readView(storageKey)));
  const setView = useCallback(
    (v: BoardView) => {
      setViewState(v);
      try {
        window.localStorage.setItem(storageKey, v);
      } catch {
        /* private mode — keep the in-memory choice */
      }
    },
    [storageKey],
  );
  return { view: hasWebgl ? view : "2d", setView, canToggle: hasWebgl };
}

export type CameraView = "fpv" | "table";

/**
 * The 3D table's camera: 🎥 first person (my own body in my chair, Liar's Bar style)
 * or 🪑 the over-the-shoulder table view. Remembered per game; first person by default.
 */
export function useCameraView(storageKey: string): { camera: CameraView; setCamera: (v: CameraView) => void } {
  const [camera, setState] = useState<CameraView>(() => {
    if (typeof window === "undefined") return "fpv";
    try {
      return window.localStorage.getItem(storageKey) === "table" ? "table" : "fpv";
    } catch {
      return "fpv";
    }
  });
  const setCamera = useCallback(
    (v: CameraView) => {
      setState(v);
      try {
        window.localStorage.setItem(storageKey, v);
      } catch {
        /* private mode — keep the in-memory choice */
      }
    },
    [storageKey],
  );
  return { camera, setCamera };
}

/** The header's two-way camera switch — 🎥 1인칭 | 🪑 테이블, the current one lit. */
export function CameraToggle({ cam }: { cam: ReturnType<typeof useCameraView> }) {
  const opts: [CameraView, string, string][] = [
    ["fpv", "🎥 1인칭", "내 캐릭터의 눈으로 보고, 손에 든 카드를 눌러 내요"],
    ["table", "🪑 테이블", "내 자리 뒤·위에서 테이블 전체를 보고, 손패는 아래 칸에서 내요"],
  ];
  return (
    <div role="group" aria-label="3D 시점" className="flex overflow-hidden rounded-full border border-white/15 light:border-slate-300">
      {opts.map(([v, label, title]) => (
        <button
          key={v}
          type="button"
          title={title}
          aria-pressed={cam.camera === v}
          onClick={() => cam.setCamera(v)}
          className={`px-2.5 py-1 text-[11px] transition ${
            cam.camera === v ? "bg-white/15 font-semibold text-white light:bg-slate-800 light:text-white" : "text-white/55 hover:text-white light:bg-white/80 light:text-slate-600"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Low detail on narrow / weak devices (fewer segments, no shadows). */
export function preferLowDetail(): boolean {
  if (typeof window === "undefined") return true;
  const cores = navigator.hardwareConcurrency ?? 4;
  return window.innerWidth < 640 || cores < 4;
}

/** The header's "🖼️ 2D로 / 🧊 3D로" pill (renders nothing without WebGL). */
export function ViewToggle({ board }: { board: ReturnType<typeof useBoardView> }) {
  if (!board.canToggle) return null;
  return (
    <button
      type="button"
      onClick={() => board.setView(board.view === "3d" ? "2d" : "3d")}
      className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/60 transition hover:border-white/30 hover:text-white light:border-slate-300 light:bg-white/80 light:text-slate-600"
    >
      {board.view === "3d" ? "🖼️ 2D로" : "🧊 3D로"}
    </button>
  );
}

/** The framed canvas box every 3D board sits in, with a hint pill at the bottom. */
export function Frame3D({ children, hint, tall = false }: { children: ReactNode; hint?: string; tall?: boolean }) {
  return (
    <div className={`relative z-10 w-full overflow-hidden rounded-2xl border border-black/50 ${tall ? "h-[380px] sm:h-[500px]" : "h-[330px] sm:h-[440px]"}`}>
      {children}
      {hint && (
        <span className="pointer-events-none absolute bottom-2 left-1/2 max-w-[92%] -translate-x-1/2 truncate rounded-full bg-black/55 px-3 py-1 text-[11px] whitespace-nowrap text-white/75">
          {hint}
        </span>
      )}
    </div>
  );
}

/** Placeholder shown while the 3D chunk downloads. */
export function Loading3D({ label = "3D 준비 중…" }: { label?: string }) {
  return <div className="flex h-full items-center justify-center text-xs text-white/45">{label}</div>;
}
