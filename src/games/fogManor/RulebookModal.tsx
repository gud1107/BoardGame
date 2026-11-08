"use client";

import { useState } from "react";
import Overlay from "@/components/Overlay";
import { FLOOR_NAMES, ROOMS, ROUNDS_BY_PLAYERS, SUSPECTS, VAULT_BY_PLAYERS, WEAPONS, WING_NAMES } from "./data";
import { RESPOND_MS } from "./engine";

const H3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";
const LIST = "list-disc space-y-1.5 pl-4 text-white/70 light:text-slate-600";

type Tab = "goal" | "turn" | "ask" | "end" | "cards" | "online";
const TABS: { id: Tab; label: string }[] = [
  { id: "goal", label: "🕯️ 목표·준비" },
  { id: "turn", label: "🔄 차례" },
  { id: "ask", label: "🗣️ 심문·수색" },
  { id: "end", label: "⚖️ 고발·새벽" },
  { id: "cards", label: "🃏 카드·특징" },
  { id: "online", label: "🌐 온라인" },
];

/** 게임 중 📖 버튼 — 전체 규칙서(boardGameRule/안개저택살인사건/안개저택살인사건.md)의 앱 적용판. */
export default function RulebookModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("goal");
  return (
    <Overlay title="📖 안개 저택 살인사건 규칙" onClose={onClose} wide>
      <div className="flex flex-col gap-4 text-sm text-white/80 light:text-slate-700">
        <div className="flex flex-wrap gap-1.5" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-full border px-3 py-1 text-xs font-bold ${tab === t.id ? "border-amber-400 bg-amber-500/20 text-amber-100 light:text-amber-800" : "border-white/15 text-white/60 light:border-slate-300 light:text-slate-600"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "goal" && (
          <section className="flex flex-col gap-3">
            <p className="break-keep">
              폭풍우 치는 밤, 외딴 섬의 안개 저택에서 남궁 회장이 쓰러진 채 발견됐다. 배는 <b>새벽 6시</b>에야 온다. 여러분은 모두 탐정 — 경찰이 오기 전에 <b>누가 · 무엇으로 · 어디서</b>를 가장 먼저 밝혀내세요.
            </p>
            <div>
              <h3 className={H3}>준비</h3>
              <ul className={LIST}>
                <li>용의자 6 · 흉기 6 · 장소 9 중 한 장씩이 봉투 속 <b>정답</b>. 나머지를 똑같이 나눠 가져요 — 내 카드는 정답이 아니에요.</li>
                <li>남는 카드: 4인 2장·5인 3장은 <b>앞면 공개</b>(현장 보존 증거). 2인은 {VAULT_BY_PLAYERS[2]}장이 <b>🗄️ 금고</b>로 — 아무도 못 보고 물을 수도 없어서 단서로만 지울 수 있어요.</li>
                <li>방마다 단서 2장이 엎어져 있어요. 모두 🏛️ 대연회장에서 출발.</li>
                <li>
                  시계는 00:00 → 06:00. 라운드 수: {Object.entries(ROUNDS_BY_PLAYERS)
                    .map(([n, r]) => `${n}인 ${r}`)
                    .join(" · ")}
                  .
                </li>
              </ul>
            </div>
          </section>
        )}

        {tab === "turn" && (
          <section className="flex flex-col gap-3">
            <ul className={LIST}>
              <li>
                <b>🚶 이동(선택)</b>: 문으로 붙은 방 한 칸. 🕳️ 비밀 통로 2개(🛏️ 침실 ↔ 🎱 당구실, 📚 서재 ↔ 🍳 주방)도 한 칸이에요.
              </li>
              <li>
                <b>행동 1개</b>: 🗣️ 대질 심문 · 🔍 현장 수색 · ⚖️ 고발 · 💤 쉬기
              </li>
              <li>모두 한 번씩 하면 시계가 가요. 1/3·2/3 지점엔 🔔 괘종이 울리고, 어느 방에 강한 새 단서가 놓이는지 모두에게 알려져요.</li>
            </ul>
          </section>
        )}

        {tab === "ask" && (
          <section className="flex flex-col gap-3">
            <div>
              <h3 className={H3}>🗣️ 대질 심문 — 핵심</h3>
              <ul className={LIST}>
                <li>탐정 한 명(누명 쓴 사람도 가능)과 용의자 1·흉기 1을 고르면, 장소는 <b>지금 내 방</b>.</li>
                <li>
                  상대는 셋 중 <b>몇 장을 가졌는지 모두가 듣게</b> 답해요 (0~3장). 1장 이상이면 그중 한 장을 <b>나에게만</b> 몰래 보여 줘요(2장 이상이면 상대가 골라요, {RESPOND_MS / 1000}초).
                </li>
                <li>장수는 모두의 정보! “저 사람은 이 셋 중 2장”으로 남들도 추리해요. 내 카드를 섞어 부르는 것도 전략.</li>
                <li>부른 용의자는 내 방으로 끌려와요(분위기).</li>
              </ul>
            </div>
            <div>
              <h3 className={H3}>🔍 현장 수색</h3>
              <ul className={LIST}>
                <li>지금 방의 맨 위 단서를 가져가 혼자 봐요. 남들은 누가 어디를 뒤졌는지만 알아요.</li>
                <li>단서는 언제나 사실: 🔎 특징 단서(“범인은 왼손잡이다”, “시신에 외상이 없다”, “현장은 지하다”) 또는 🧾 알리바이(“○○는 정답이 아니다”).</li>
              </ul>
            </div>
          </section>
        )}

        {tab === "end" && (
          <section className="flex flex-col gap-3">
            <div>
              <h3 className={H3}>⚖️ 고발</h3>
              <ul className={LIST}>
                <li>내 차례 행동으로 용의자·흉기·장소(어디든)를 말해요. 맞으면 즉시 승리.</li>
                <li>틀리면 그 조합이 모두에게 공개되고 <b>🚫 누명</b>: 차례는 없지만 심문엔 계속 답해요. 모두 누명이면 범인이 달아나요.</li>
              </ul>
            </div>
            <div>
              <h3 className={H3}>🌅 새벽</h3>
              <ul className={LIST}>
                <li>마지막 라운드까지 아무도 못 맞히면, 남은 탐정이 동시에 비밀 추리를 내거나 기권해요.</li>
                <li>맞힘 = 공동 1위 · 기권 = 2위 · 틀림 = 3위. 확신이 없으면 기권이 나을 수도!</li>
              </ul>
            </div>
            <div>
              <h3 className={H3}>순위</h3>
              <ul className={LIST}>
                <li>🥇 맞힌 탐정 · 🥈 끝까지 틀리지 않은 탐정 · 🥉 틀린 고발/새벽 오답</li>
              </ul>
            </div>
          </section>
        )}

        {tab === "cards" && (
          <section className="flex flex-col gap-3">
            <div>
              <h3 className={H3}>🧑 용의자 (✋손잡이 · 📏키 · 👃냄새 — 조합이 모두 달라요)</h3>
              <ul className={LIST}>
                {SUSPECTS.map((s) => (
                  <li key={s.name} className="break-keep">
                    {s.icon} <b>{s.name}</b>({s.job}) — {s.traits[0] ? "왼손" : "오른손"} · {s.traits[1] ? "큰 키" : "작은 키"} · {s.traits[2] ? "담배" : "향수"}
                    <span className="text-white/45"> · {s.motive}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className={H3}>🔪 흉기 (🩸상처 · 🏠출처)</h3>
              <ul className={LIST}>
                {WEAPONS.map((w) => (
                  <li key={w.name}>
                    {w.icon} <b>{w.name}</b> — {w.traits[0] ? "외상" : "무외상"} · {w.traits[1] ? "저택 물건" : "외부 반입"}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className={H3}>🚪 장소 (층 · 관)</h3>
              <div className="grid grid-cols-3 gap-1 text-center text-xs">
                {ROOMS.map((r) => (
                  <div key={r.name} className="rounded-lg border border-white/10 p-1.5 light:border-slate-300">
                    {r.icon} {r.name}
                    <div className="text-[10px] text-white/45">
                      {FLOOR_NAMES[r.floor]} · {WING_NAMES[r.wing]}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {tab === "online" && (
          <section className="flex flex-col gap-3">
            <ul className={LIST}>
              <li>🔒 서버 판정: 정답·남의 카드·남이 본 단서·남에게 보여 준 카드는 서버만 알아요.</li>
              <li>⏱️ 차례 시간 안에 행동하지 않으면 💤 쉬기. 연속 2번이거나 접속이 끊기면 투표로 AI가 대신해요.</li>
              <li>📒 수사 노트: 확실한 사실은 자동으로 채워지고(밑줄), 나머지는 눌러서 ✗/✓/? 표시. 공개 심문 장수는 직접 추리하세요.</li>
              <li>🤖 AI 봇 Lv.1~10: 높을수록 공개 장수·손패 수·틀린 고발까지 모두 엮어 추리해요.</li>
            </ul>
          </section>
        )}
      </div>
    </Overlay>
  );
}
