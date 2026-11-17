"use client";

import { useState } from "react";
import Overlay from "@/components/Overlay";
import { MAX_WINDOW, ROOMS, ROOM_COUNT, ROUNDS_BY_PLAYERS, hasStairs } from "./data";
import { SCORE_ESCAPE, SCORE_GUEST_CATCH, SCORE_VOTE_BONUS, VOTE_MS, WATCH_MS } from "./engine";

const H3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";
const LIST = "list-disc space-y-1.5 pl-4 text-white/70 light:text-slate-600";

type Tab = "goal" | "night" | "footage" | "probe" | "vote" | "online";
const TABS: { id: Tab; label: string }[] = [
  { id: "goal", label: "📹 목표" },
  { id: "night", label: "🌙 밤 동선" },
  { id: "footage", label: "📼 영상 판독" },
  { id: "probe", label: "🔎 수사" },
  { id: "vote", label: "🗳️ 투표·점수" },
  { id: "online", label: "🌐 온라인" },
];

/** 게임 중 📖 버튼 — 전체 규칙서(boardGameRule/CCTV알리바이/CCTV알리바이.md)의 앱 적용판. */
export default function RulebookModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("goal");
  return (
    <Overlay title="📖 CCTV 알리바이 규칙" onClose={onClose} wide>
      <div className="flex flex-col gap-4 text-sm text-white/80 light:text-slate-700">
        <div className="flex flex-wrap gap-1.5" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-full border px-3 py-1 text-xs font-bold ${tab === t.id ? "border-sky-400 bg-sky-500/20 text-sky-100 light:text-sky-800" : "border-white/15 text-white/60 light:border-slate-300 light:text-slate-600"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "goal" && (
          <section className="flex flex-col gap-3">
            <p className="break-keep">
              저택의 밤, 지하 금고실의 보석이 사라졌다. 저택 CCTV에는 손님 모두의 밤 동선이 찍혀 있지만 — <b>범인 한 명의 영상은 일부가 가짜</b>예요. 영상을 돌려 보고, 센서 기록과 서로의 기억으로 가짜를 찾아내세요.
            </p>
            <ul className={LIST}>
              <li>
                <b>🙋 손님</b>: 투표로 범인을 잡으면 승리.
              </li>
              <li>
                <b>🦹 범인</b>(한 사건에 한 명, 비밀): 금고실에 다녀오고도 투표에서 달아나면 승리.
              </li>
              <li>사건을 2~3번 하면 사건마다 범인이 바뀌고, 점수를 더해 순위를 가려요.</li>
            </ul>
            <div>
              <h3 className={H3}>저택</h3>
              <div className="grid grid-cols-3 gap-1 text-center text-xs">
                {Array.from({ length: ROOM_COUNT }, (_, r) => (
                  <div key={r} className="rounded-lg border border-white/10 p-1.5 light:border-slate-300">
                    {ROOMS[r].icon} {ROOMS[r].name}
                    {hasStairs(r) && " 🪜"}
                  </div>
                ))}
              </div>
              <p className="mt-1.5 text-xs break-keep text-white/55 light:text-slate-500">옆(위아래·좌우) 방으로만 다닐 수 있어요. 💎 지하 금고실은 🪜 계단이 있는 다섯 방에서만 내려갈 수 있어요.</p>
            </div>
          </section>
        )}

        {tab === "night" && (
          <section className="flex flex-col gap-3">
            <ul className={LIST}>
              <li>밤은 21:00~01:00, 30분 단위 8칸. 모두 서로 다른 방에서 출발해 <b>동시에, 몰래</b> 동선을 짜요.</li>
              <li>한 칸마다 옆방으로 가거나 그 자리에 머물러요.</li>
              <li>
                <b>손님</b>은 ⭐ 할 일 두 곳을 꼭 들러야 해요(순서·시각 자유). 금고실에는 못 내려가요.
              </li>
              <li>
                <b>범인</b>은 할 일이 없는 대신 💎 금고실에 한 번 이상 들러야 해요. 그리고 금고실에 있던 시각을 모두 덮는 <b>연속 1~{MAX_WINDOW}칸</b>의 영상을 가짜 장면으로 바꿔요.
              </li>
              <li>가짜 장면도 “옆방으로 한 칸씩” 이어져야 해요 — 영상만 봐서는 티가 나지 않아요.</li>
              <li>시간 안에 못 정하면 자동으로 짜 줘요.</li>
            </ul>
          </section>
        )}

        {tab === "footage" && (
          <section className="flex flex-col gap-3">
            <ul className={LIST}>
              <li>밤이 지나면 모두의 영상이 공개돼요({WATCH_MS / 1000}초 판독). ▶로 돌려 보거나 시각을 눌러 넘겨요.</li>
              <li>
                <b>📼 사람별 표</b>: 한 줄이 한 사람의 밤. 노란 밑줄은 🪜 계단 방이에요.
              </li>
              <li>
                <b>🧠 내 기억</b>: 나는 <b>같은 방에 실제로 있던 사람</b>만 기억해요. 영상과 다르면 ❗로 알려 줘요.
              </li>
              <li>범인의 영상에는 반드시 “금고실에 다녀올 틈”이 있어요: 가짜 구간 앞뒤가 계단 방에서 닿는 곳이어야 해요.</li>
              <li>구석 방(서재·침실·음악실·주방)은 계단까지 한 걸음이 더 들어서, 거기 머문 사람은 한 칸짜리 틈이 없어요.</li>
            </ul>
          </section>
        )}

        {tab === "probe" && (
          <section className="flex flex-col gap-3">
            <p className="break-keep">
              돌아가며 한 번씩, 다음 중 하나를 해요. 수사 라운드:{" "}
              {Object.entries(ROUNDS_BY_PLAYERS)
                .map(([n, r]) => `${n}인 ${r}바퀴`)
                .join(" · ")}
              .
            </p>
            <div>
              <h3 className={H3}>🔎 센서 대조</h3>
              <ul className={LIST}>
                <li>시각 하나 × 방 하나를 골라 그때 그 방에 <b>실제로 몇 명</b> 있었는지 봐요(모두에게 공개).</li>
                <li>영상 인원보다 적으면 → 그 칸에 찍힌 사람 중에 가짜가 있어요. 많으면 → 범인이 실제로는 거기 있었어요.</li>
                <li>같으면 그 칸에 찍힌 사람은 그 시각만큼은 진짜예요.</li>
              </ul>
            </div>
            <div>
              <h3 className={H3}>🗣️ 증언 (한 사건에 한 번)</h3>
              <ul className={LIST}>
                <li>손님은 <b>내 기억과 영상이 어긋난 장면만</b> 증언할 수 있어요: “그 시각 그 방에 ○○는 없었다 / 있었다”.</li>
                <li>범인은 무엇이든 지어낼 수 있어요.</li>
                <li>그래서 증언이 나오면 범인은 <b>증언한 사람 아니면 지목된 사람</b> 둘 중 하나예요.</li>
              </ul>
            </div>
            <div>
              <h3 className={H3}>💤 넘기기</h3>
              <ul className={LIST}>
                <li>아무것도 안 해요. 제한 시간이 지나도 넘어가요.</li>
              </ul>
            </div>
          </section>
        )}

        {tab === "vote" && (
          <section className="flex flex-col gap-3">
            <ul className={LIST}>
              <li>모두 동시에 비밀 투표({VOTE_MS / 1000}초). 자기 자신에겐 못 하고, 기권할 수 있어요.</li>
              <li>
                범인이 <b>혼자 가장 많은 표</b>를 받으면 검거. 동률이거나 한 표도 없으면 달아나요.
              </li>
              <li>
                점수: 검거하면 손님 모두 +{SCORE_GUEST_CATCH} · 범인을 찍은 손님 +{SCORE_VOTE_BONUS}(검거에 실패해도) · 달아난 범인 +{SCORE_ESCAPE}.
              </li>
              <li>마지막 사건이 끝나면 총점 순위. 동점은 같은 순위예요.</li>
            </ul>
          </section>
        )}

        {tab === "online" && (
          <section className="flex flex-col gap-3">
            <ul className={LIST}>
              <li>🔒 서버 판정: 범인이 누구인지, 남의 실제 동선·할 일·표는 서버만 알아요. 내 기기에는 내 몫만 와요.</li>
              <li>⏱️ 시간 초과: 밤 → 자동 동선, 수사 → 넘기기, 투표 → 기권. 두 번 잇달아 놓치거나 접속이 끊기면 투표로 AI가 대신해요.</li>
              <li>🤖 AI 봇 Lv.1~10: 높을수록 금고실에 다녀올 틈·센서 결과·증언을 모두 엮어 추리하고, 범인일 땐 짧게 조작하고 맞증언을 해요.</li>
              <li>📝 사람 이름표를 누르면 😇·🤔·😈 메모를 남길 수 있어요(나만 보여요).</li>
            </ul>
          </section>
        )}
      </div>
    </Overlay>
  );
}
