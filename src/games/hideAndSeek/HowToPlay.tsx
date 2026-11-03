"use client";

import { useState } from "react";
import { FLASH_CHARGES, ITCH_AT, SCORE_CATCH, SCORE_HELPER, SCORE_HOME, SCORE_SURVIVE } from "./engine";

/** 게임 화면의 접히는 "게임 방법" 패널 — 첫 라운드엔 펼쳐서 시작 */
export default function HowToPlay({ startOpen }: { startOpen: boolean }) {
  const [open, setOpen] = useState(startOpen);
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] text-sm light:border-slate-200 light:bg-white">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between px-3 py-2 text-left font-semibold text-white/85 light:text-slate-800">
        <span>📖 게임 방법</span>
        <span className="text-xs text-white/40 light:text-slate-400">{open ? "접기 ▲" : "펼치기 ▼"}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-2 border-t border-white/10 px-3 py-2.5 text-[13px] leading-relaxed text-white/75 light:border-slate-200 light:text-slate-600">
          <p className="break-keep">
            <b className="text-white light:text-slate-900">목표</b> — 라운드마다 한 명이 👁️ 술래, 나머지는 저택 어딘가에 숨어요. 모두 한 번씩 술래를 하고 점수 합이 가장 높은 사람이 승리!
          </p>
          <p className="break-keep">
            <b className="text-white light:text-slate-900">한 턴</b> — 모두 몰래 행동을 고르고(🔒) 동시에 공개돼요. 남이 뭘 골랐는지는 공개 전까지 아무도 몰라요.
          </p>
          <p className="break-keep">
            <b className="text-white light:text-slate-900">🕹️ 직접 걷기</b> — 내 차례엔 내 캐릭터를 WASD·방향키(휴대폰은 왼쪽 아래 조이스틱)로 움직여요. 금빛 고리 가구 앞에 서면 버튼이 떠요 — E·스페이스(또는 버튼)로 숨기·뒤지기, 술래는 Q로 그 방에서 멈추기. 계단은 똑바로 걸어 오르내리고, 다락은 아이방 사다리 앞에서 E. 이번 턴에 갈 수 없는 방의 문은 막혀 있어요.
          </p>
          <ul className="flex list-disc flex-col gap-1 pl-5 break-keep">
            <li>
              <b>👁️ 술래</b>: 🔍 뒤지기(지금 방이나 옆방의 숨을 곳 하나, 그 방으로 이동) · 🚶 이동(두 방까지) · 🔦 손전등(옆방에 몇 명 숨었는지, 라운드당 {FLASH_CHARGES}번)
            </li>
            <li>
              <b>🫣 숨은 사람</b>: 🤫 숨죽이기 · 🐾 살금살금(같은 방·옆방의 다른 곳으로 — 떠난 방에서 🔊 삐걱!) · 🏃 찜!(마당과 붙은 창고·현관·거실에서만)
            </li>
            <li>
              <b>🔦 꼬마 술래</b>: 잡힌 사람은 술래 편이 되어 같이 뒤져요 (직접 잡으면 +{SCORE_HELPER})
            </li>
          </ul>
          <ul className="flex list-disc flex-col gap-1 pl-5 break-keep">
            <li>뒤진 곳에 있으면 잡혀요. 술래가 멈춘 방에서 움직이면 딱 마주쳐 잡혀요.</li>
            <li>찜하러 뛸 때 술래가 마당이나 내 방으로 오면 막혀서 잡혀요.</li>
            <li>술래가 멈춘 방에 누가 있으면 💓 인기척이 모두에게 공개돼요.</li>
            <li>같은 곳에서 {ITCH_AT}턴 연달아 숨죽이면 다리가 저려 매 턴 🍃 부스럭 소리가 나요.</li>
          </ul>
          <p className="break-keep">
            <b className="text-white light:text-slate-900">점수</b> — 🙌 찜 +{SCORE_HOME} · 🐦 끝까지 숨음(못 찾겠다 꾀꼬리) +{SCORE_SURVIVE} · 👁️ 술래는 잡힌 사람마다 +{SCORE_CATCH}
          </p>
        </div>
      )}
    </div>
  );
}
