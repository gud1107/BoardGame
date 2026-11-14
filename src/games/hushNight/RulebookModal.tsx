"use client";

import { useState } from "react";
import Overlay from "@/components/Overlay";
import { CARRY_MAX, CHOOSE_MS, HEAR_PER_LEVEL, MONSTER_SPEED, NOISE, PEBBLES, RAGE_SPEED, THROW_RANGE } from "./engine";

const H3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";
const LIST = "list-disc space-y-1.5 pl-4 text-white/70 light:text-slate-600";

type Tab = "basic" | "move" | "monster" | "keys" | "controls";
const TABS: { id: Tab; label: string }[] = [
  { id: "basic", label: "🤫 기본" },
  { id: "move", label: "🚶 행동과 소리" },
  { id: "monster", label: "👹 괴물" },
  { id: "keys", label: "🗝️ 열쇠와 점수" },
  { id: "controls", label: "🎮 조작" },
];

/** 게임 중 📖 버튼 — boardGameRule/숨죽인밤/숨죽인밤.md 의 앱 적용판. */
export default function RulebookModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("basic");
  return (
    <Overlay title="📖 숨죽인 밤 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-4 text-sm text-white/80 light:text-slate-700">
        <div className="flex flex-wrap gap-1.5" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-full border px-3 py-1 text-xs font-bold ${tab === t.id ? "border-indigo-400 bg-indigo-500/20 text-indigo-100 light:text-indigo-800" : "border-white/15 text-white/60 light:border-slate-300 light:text-slate-600"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "basic" && (
          <section>
            <h3 className={H3}>목표</h3>
            <p className="break-keep text-white/70 light:text-slate-600">
              불 꺼진 집(7×7칸)에 2~4명이 갇혔어요. 집 한가운데 지하실 문(🕳️)에서 나온 <b>눈먼 괴물</b>은 소리만 듣고 움직여요. 구석구석 흩어진 열쇠를 주워 <b>지하실 문까지 가져가야</b> 점수가 돼요. 밤이 끝났을 때(10번 또는 14번) 가져간 열쇠가 가장 많은 사람이 우승, 같으면 덜 잡힌 사람이 위.
            </p>
          </section>
        )}

        {tab === "move" && (
          <section>
            <h3 className={H3}>매 밤: 모두 몰래 고르고, 한꺼번에 펼쳐요</h3>
            <ul className={LIST}>
              <li>🤫 숨죽이기 — 제자리, 소리 {NOISE.hush}</li>
              <li>🚶 걷기 — 1칸, 도착한 곳에서 소리 {NOISE.walk}</li>
              <li>🏃 달리기 — 정확히 2칸, 도착한 곳에서 소리 {NOISE.run}</li>
              <li>
                🪨 돌 던지기 — {THROW_RANGE}칸 안 아무 곳에 소리 {NOISE.throw}, 나는 제자리(한 판에 {PEBBLES}개). 괴물을 남에게 보낼 수도!
              </li>
              <li>
                열쇠를 주우면 +{NOISE.key}, 지하실 문을 열면 +{NOISE.door} 소리가 더 나요.
              </li>
              <li>고른 것은 잠긴 채(암호처럼) 보내져서 펼치기 전엔 아무도 몰라요. {CHOOSE_MS / 1000}초 안에 안 고르면 숨죽이기.</li>
            </ul>
          </section>
        )}

        {tab === "monster" && (
          <section>
            <h3 className={H3}>눈먼 괴물</h3>
            <ul className={LIST}>
              <li>
                소리 크기 L은 가구를 돌아가는 길로 <b>L × {HEAR_PER_LEVEL}칸</b> 안에서 들려요. 괴물은 가장 크게 들린 소리(크기×{HEAR_PER_LEVEL} − 거리)로 가요 — 같으면 더 가까운 쪽, 그래도 같으면 무작위.
              </li>
              <li>
                한 밤에 {MONSTER_SPEED}칸, 밤의 마지막 ⅓부터는 😡 {RAGE_SPEED}칸. 첫 밤은 아직 잠들어 있어요.
              </li>
              <li>아무것도 못 들으면 마지막으로 들은 곳으로, 그것도 없으면 아무 데로나 한 칸.</li>
              <li>
                괴물이 <b>지나가거나 멈춘 칸</b>에 있으면 잡혀요 — 들고 있던 열쇠를 그 자리에 떨어뜨리고 처음 자리로 돌아가요.
              </li>
            </ul>
          </section>
        )}

        {tab === "keys" && (
          <section>
            <h3 className={H3}>열쇠</h3>
            <ul className={LIST}>
              <li>모두의 구석에 똑같은 모양으로 열쇠가 3개씩 놓여요(빈 구석엔 없어요).</li>
              <li>열쇠 칸에 도착하면 주워요(최대 {CARRY_MAX}개). 둘이 같이 도착하면 밤마다 돌아가는 순서로.</li>
              <li>지하실 문 칸에 들어가면 들고 있던 열쇠가 모두 점수가 돼요. 들고만 있는 열쇠는 점수가 아니에요.</li>
              <li>열쇠가 모두 지하실로 가면 밤이 일찍 끝나요.</li>
            </ul>
          </section>
        )}

        {tab === "controls" && (
          <section>
            <h3 className={H3}>조작</h3>
            <ul className={LIST}>
              <li>행동 버튼(키보드 1~4) → 빛나는 칸 누르기 → 🔒 이렇게 하기(Enter).</li>
              <li>🔰 도우미(방 설정)를 켜면 &ldquo;다른 사람이 모두 숨죽인다면&rdquo; 괴물이 갈 길을 빨간 원으로 보여줘요.</li>
              <li>🧊 3D(드래그로 돌려보기) / 🖼️ 2D 칸 보기. 자리는 색 + 모양(●◆▲■)으로 구분하고, 소리로 알리는 일은 화면 문구로도 나와요.</li>
            </ul>
          </section>
        )}
      </div>
    </Overlay>
  );
}
