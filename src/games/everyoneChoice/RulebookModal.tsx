"use client";

import { useState } from "react";
import Overlay from "@/components/Overlay";
import { CHOOSE_MS, LONE_BONUS, LOSS, MAX_PLAYERS, MIN_PLAYERS } from "./engine";

const H3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";
const LIST = "list-disc space-y-1.5 pl-4 text-white/70 light:text-slate-600";

type Tab = "basic" | "chips" | "rounds" | "end" | "controls";
const TABS: { id: Tab; label: string }[] = [
  { id: "basic", label: "🗳️ 기본" },
  { id: "chips", label: "🪙 확신 칩" },
  { id: "rounds", label: "🔄 라운드 종류" },
  { id: "end", label: "🏁 끝과 순위" },
  { id: "controls", label: "🎮 조작" },
];

/** 게임 중 📖 버튼 — boardGameRule/모두의선택/모두의선택.md 의 앱 적용판. */
export default function RulebookModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("basic");
  return (
    <Overlay title="📖 모두의 선택 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-4 text-sm text-white/80 light:text-slate-700">
        <div className="flex flex-wrap gap-1.5" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-full border px-3 py-1 text-xs font-bold ${tab === t.id ? "border-violet-400 bg-violet-500/20 text-violet-100 light:text-violet-800" : "border-white/15 text-white/60 light:border-slate-300 light:text-slate-600"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "basic" && (
          <section>
            <h3 className={H3}>목표: 다른 사람들이 뭘 고를지 맞히기</h3>
            <ul className={LIST}>
              <li>
                {MIN_PLAYERS}~{MAX_PLAYERS}명. 매 라운드 &ldquo;짜장면 vs 짬뽕&rdquo; 같은 질문 하나에 선택지가 2~4개 나와요.
              </li>
              <li>
                <b>내 취향이 아니라 &ldquo;모두가 고를 것 같은 쪽&rdquo;</b>을 고르는 게임이에요. 정답은 없고, 이번 방 사람들의 선택이 곧 정답이에요.
              </li>
              <li>{CHOOSE_MS / 1000}초 안에 몰래 하나를 고르고 확신 칩을 걸어요. 고른 것은 잠긴 채(암호처럼) 보내져서 모두 펼치기 전엔 아무도 몰라요.</li>
              <li>모두 고르면(또는 시간이 끝나면) 한꺼번에 펼쳐서 누가 무엇을 골랐는지 이름과 함께 보여줘요.</li>
            </ul>
          </section>
        )}

        {tab === "chips" && (
          <section>
            <h3 className={H3}>🪙 확신 칩 (1~3개)</h3>
            <ul className={LIST}>
              <li>
                🪙 1개: 이기면 +1, 지면 {LOSS[1]} — 안전
              </li>
              <li>
                🪙🪙 2개: 이기면 +2, 지면 −{LOSS[2]} — 반반보다 자신 있을 때
              </li>
              <li>
                🪙🪙🪙 3개: 이기면 +3, 지면 −{LOSS[3]} — 확실할 때만!
              </li>
              <li>시간 안에 못 고르면 그 라운드는 점수 변화 없음.</li>
            </ul>
          </section>
        )}

        {tab === "rounds" && (
          <section>
            <h3 className={H3}>라운드 종류 (질문 위에 미리 알려줘요)</h3>
            <ul className={LIST}>
              <li>
                👥 <b>다수파</b> — 가장 많은 사람이 고른 쪽이 이겨요. 동률이면 동률인 쪽 모두 이겨요.
              </li>
              <li>
                🔄 <b>반전</b> — 가장 <b>적은</b> 사람이 고른 쪽이 이겨요(아무도 안 고른 선택지는 빼고). 모두 같은 걸 고르면 모두 져요.
              </li>
              <li>
                🐺 <b>외톨이</b> — 선택지를 <b>혼자만</b> 고른 사람이 이겨요. 외톨이가 딱 1명이면 칩 + {LONE_BONUS}점, 여럿이면 각자 칩만큼. 외톨이가 있으면 나머지는 점수 변화 없음. 외톨이가 없으면 다수파 규칙으로. (3명 이상 답했을 때만, 선택지 3개 이상 질문에서만 나와요)
              </li>
              <li>
                ✨ <b>두 배</b> — 마지막 라운드. 다수파 규칙에 얻고 잃는 점수가 모두 두 배.
              </li>
              <li>첫 두 라운드는 항상 👥, 특수 라운드(🔄🐺)는 연달아 나오지 않아요. 8문제 판: 🔄 2번 · 🐺 1번, 12문제 판: 🔄 2번 · 🐺 2번.</li>
            </ul>
          </section>
        )}

        {tab === "end" && (
          <section>
            <h3 className={H3}>끝과 순위</h3>
            <ul className={LIST}>
              <li>8문제 또는 12문제가 끝나면 점수가 가장 높은 사람이 우승. 점수는 마이너스가 될 수도 있어요.</li>
              <li>점수가 같으면 이긴 라운드가 많은 사람이 위, 그것도 같으면 공동 순위.</li>
              <li>👥 대세 감별사(가장 많이 다수 쪽을 고른 사람) · 🦄 마이웨이(가장 많이 절반 미만 쪽을 고른 사람) 칭호도 붙어요.</li>
            </ul>
          </section>
        )}

        {tab === "controls" && (
          <section>
            <h3 className={H3}>조작</h3>
            <ul className={LIST}>
              <li>선택지 누르기(키보드 1~4) → 칩 고르기(Q/W/E) → 🔒 이걸로!(Enter).</li>
              <li>선택지는 색 + 모양(●◆▲■)으로 구분하고, 소리로 알리는 일은 화면 문구로도 나와요.</li>
            </ul>
          </section>
        )}
      </div>
    </Overlay>
  );
}
