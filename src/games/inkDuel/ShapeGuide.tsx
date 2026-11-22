"use client";

/**
 * 낙서 결투 — "무엇을 그리면 뭐가 나오나" 그림 사전. Each entry shows an
 * example doodle that really reads as that weapon (pinned by a test), how to
 * draw it, and what it does. The weapon the current doodle reads as is
 * highlighted so players can see why they got what they got.
 */

import { useState } from "react";
import { COLOR_NAMES, ELEMENT_LABEL, ELEMENTS, INK_COLORS, WEAPON_LABEL, type WeaponKind } from "./analyze";
import { GUIDE_EXAMPLES } from "./guideExamples";
import { DoodleSvg } from "./WeaponPad";

/** How to draw each weapon (the pad reads the longest continued line). */
const HOW_TO: Record<WeaponKind, string> = {
  spear: "한 번에 곧게 쭉",
  bomb: "동그라미 — 시작점 근처에서 닫기",
  rocket: "세모 — 꼭짓점 3개를 또렷하게",
  anvil: "네모·오각형 — 꼭짓점 4~6개",
  shuriken: "뾰족한 별, 또는 ✕·+처럼 가운데서 엇갈린 직선",
  lightning: "지그재그 — 3번 이상 꺾기",
  boomerang: "닫지 않은 C자 반원",
  drill: "소용돌이 — 2바퀴 이상 빙글빙글",
  wave: "둥글게 출렁이는 S자 물결",
  cluster: "점·짧은 선을 4개 이상 흩뿌리기",
  club: "그 밖의 모양 (ㄱ자처럼 한 번 꺾인 선 등)",
};

/** What it does, one line. */
const EFFECT: Record<WeaponKind, string> = {
  spear: "벽 관통 · 빠름 · 직격 고피해",
  bomb: "클수록 큰 폭발 · 지형 파기",
  rocket: "중력 덜 받음 · 뾰족한 쪽으로 직진",
  anvil: "무겁게 뚝 · 큰 피해",
  shuriken: "땅에 2번 튕김 · 치명타↑",
  lightning: "주변 적에게 연쇄 피해",
  boomerang: "나갔다 돌아옴 · 오갈 때 모두 맞힘",
  drill: "땅을 파고들어 폭발",
  wave: "맞은 상대를 밀어냄",
  cluster: "흩어지며 여러 번 폭발",
  club: "묵직한 둔기",
};

const ORDER: WeaponKind[] = ["spear", "bomb", "rocket", "anvil", "shuriken", "lightning", "boomerang", "drill", "wave", "cluster", "club"];
const STORAGE_KEY = "ink-duel:shape-guide";

function readOpen(): boolean {
  try {
    return typeof window === "undefined" || window.localStorage.getItem(STORAGE_KEY) !== "closed";
  } catch {
    return true;
  }
}

/**
 * Collapsible guide under the pad. Starts open until the player closes it
 * once (remembered), so first-timers see it without asking.
 */
export default function ShapeGuide({ current }: { current: WeaponKind | null }) {
  const [open, setOpen] = useState(readOpen);
  const [tab, setTab] = useState<"shape" | "color">("shape");
  const toggle = () => {
    setOpen((o) => {
      try {
        window.localStorage.setItem(STORAGE_KEY, o ? "closed" : "open");
      } catch {
        /* private mode — just don't remember */
      }
      return !o;
    });
  };
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] light:border-slate-200 light:bg-white/70">
      <button type="button" onClick={toggle} aria-expanded={open} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-white/80 light:text-slate-700">
        📖 무엇을 그리면 뭐가 나올까?
        {current && !open && (
          <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-200 light:bg-amber-100 light:text-amber-800">
            지금: {WEAPON_LABEL[current].emoji} {WEAPON_LABEL[current].name}
          </span>
        )}
        <span className="ml-auto text-white/40 light:text-slate-400">{open ? "접기 ▴" : "펼치기 ▾"}</span>
      </button>
      {open && (
        <div className="px-2 pb-2">
          <div className="mb-2 flex gap-1 px-1">
            {(
              [
                ["shape", "✏️ 모양 → 무기"],
                ["color", "🎨 색 → 효과"],
              ] as const
            ).map(([t, label]) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${tab === t ? "bg-amber-500 text-white" : "text-white/55 hover:text-white light:text-slate-500"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === "shape" ? (
            <>
              <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
                {ORDER.map((k) => {
                  const on = current === k;
                  return (
                    <li
                      key={k}
                      className={`flex items-center gap-2 rounded-lg border p-1.5 transition ${
                        on ? "border-amber-400 bg-amber-400/15 ring-1 ring-amber-400/60 light:bg-amber-50" : "border-white/10 bg-white/[0.03] light:border-slate-200 light:bg-white"
                      }`}
                    >
                      <span className="shrink-0 rounded-md bg-[#fffdf6] p-0.5 [&>svg]:h-8 [&>svg]:w-8 sm:[&>svg]:h-10 sm:[&>svg]:w-10">
                        <DoodleSvg strokes={GUIDE_EXAMPLES[k]} size={40} />
                      </span>
                      <span className="min-w-0 leading-tight">
                        <span className="block text-[12px] font-bold text-white light:text-slate-800">
                          {WEAPON_LABEL[k].emoji} {WEAPON_LABEL[k].name}
                          {on && <span className="ml-1 text-[9px] font-semibold text-amber-300 light:text-amber-700">← 지금</span>}
                        </span>
                        <span className="block text-[10px] text-white/65 light:text-slate-600">{HOW_TO[k]}</span>
                        <span className="hidden text-[10px] text-white/40 sm:block light:text-slate-400">{EFFECT[k]}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[10px] text-white/50 light:text-slate-500">
                <li>판정은 가장 긴 선 하나로 해요. 마우스를 뗐다가도 선 끝 근처에서 다시 그리면 한 선으로 이어져요.</li>
                <li>동그라미·세모·네모는 시작점 근처에서 끝내면 닫힌 도형이에요 (조금 지나쳐도 괜찮아요).</li>
                <li>세모·네모의 꼭짓점은 살짝 멈췄다 꺾듯이 또렷하게 — 둥글게 돌리면 폭탄이 돼요.</li>
                <li>잉크를 많이 쓸수록 무거워져요: 피해↑ 속도↓.</li>
              </ul>
            </>
          ) : (
            <>
              <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                {INK_COLORS.map((c, i) => (
                  <li key={c} className="flex items-center gap-2 text-[11px] text-white/75 light:text-slate-600">
                    <span className="h-4 w-4 shrink-0 rounded-full border border-white/20 light:border-slate-300" style={{ background: c }} />
                    <b className="w-7 shrink-0">{COLOR_NAMES[i]}</b>
                    <span className="min-w-0">{ELEMENT_LABEL[ELEMENTS[i]].replace(/^\S+\s/, "")}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 px-1 text-[10px] text-white/50 light:text-slate-500">가장 많이 쓴 색이 속성이 돼요. 두 번째 색이 잉크의 35% 이상이면 그 효과도 함께 붙어요.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
