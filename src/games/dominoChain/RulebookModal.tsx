"use client";

import { useState } from "react";
import Overlay from "@/components/Overlay";
import { BOMB_PENALTY, DIAG_TICKS, LONGEST_BONUS, ORTHO_TICKS, PLACEMENTS_PER_TURN, TURN_TIMEOUT_MS } from "./engine";

const H3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";
const LIST = "list-disc space-y-1.5 pl-4 text-white/70 light:text-slate-600";

type Tab = "basic" | "build" | "topple" | "score" | "controls";
const TABS: { id: Tab; label: string }[] = [
  { id: "basic", label: "🁢 기본" },
  { id: "build", label: "🧱 쌓기" },
  { id: "topple", label: "💥 와르르" },
  { id: "score", label: "🔔 점수" },
  { id: "controls", label: "🎮 조작" },
];

/** 게임 중 📖 버튼 — boardGameRule/도미노연쇄/도미노연쇄.md 의 앱 적용판. */
export default function RulebookModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("basic");
  return (
    <Overlay title="📖 도미노 연쇄 룰북" onClose={onClose} wide>
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

        {tab === "basic" && (
          <>
            <section>
              <h3 className={H3}>목표</h3>
              <p className="break-keep text-white/70 light:text-slate-600">
                같은 판 위에 2~4명이 각자 색 도미노를 줄줄이 세운 뒤, <b>모두의 밀대를 동시에 밀어</b> 와르르 쓰러뜨려요. 내 사슬이 <b>🔔 종을 울리면 점수</b>, 그리고 — 남의 사슬에 <b>먼저 닿으면 그 뒤가 전부 내 것</b>이 돼요.
              </p>
            </section>
            <section>
              <h3 className={H3}>한 라운드</h3>
              <ol className="list-decimal space-y-1.5 pl-4 text-white/70 light:text-slate-600">
                <li>🧱 쌓기: 돌아가며 한 차례에 {PLACEMENTS_PER_TURN}개씩 세워요 (2인 6차례, 3인 5차례, 4인 4차례).</li>
                <li>💥 와르르: 다 세우면 모두의 밀대가 한꺼번에 넘어지고, 사슬이 같은 시계로 달려요.</li>
                <li>점수 정산 → 새 판으로 다음 라운드 (방장이 1·3라운드 중 선택).</li>
              </ol>
            </section>
          </>
        )}

        {tab === "build" && (
          <section className="flex flex-col gap-3">
            <ul className={LIST}>
              <li>
                새 도미노는 <b>내 사슬의 끝</b>에만 세울 수 있어요 — 내 도미노(또는 밀대)가 쓰러지면 닿을 빈칸. 판에 내 색으로 빛나요.
              </li>
              <li>세울 때 쓰러질 방향을 골라요: 사슬이 들어온 방향에서 <b>왼쪽·오른쪽 90°까지</b> (5방향, 대각선 포함).</li>
              <li>
                <b>🔀 갈림길</b>(라운드마다 1개): 앞쪽 두 대각선 칸으로 동시에 쓰러져 사슬이 두 갈래로.
              </li>
              <li>
                <b>🧱 벽</b>(라운드마다 1개): 아무 빈칸에나(밀대 바로 옆만 빼고). 어느 사슬이든 벽에서 멈춰요 — 상대의 길목을 막아요.
              </li>
              <li>🔔 종은 사슬을 막지 않아요 — 울리고 같은 방향으로 계속 넘어가요. 그래서 종 너머 칸도 사슬 끝이 돼요.</li>
              <li>사슬 끝이 다 막히면 벽을 쓰거나 차례를 넘겨요. {TURN_TIMEOUT_MS / 1000}초가 지나면 남은 놓기는 넘어가요.</li>
              <li>
                <b>먼저 쌓는 사람은 첫 차례에 1개만</b> (늦게 쌓는 쪽이 대응할 수 있어 생기는 차이를 맞춰요). 2라운드부터는 <b>점수 1등이 먼저</b> 쌓아요.
              </li>
            </ul>
          </section>
        )}

        {tab === "topple" && (
          <section className="flex flex-col gap-3">
            <ul className={LIST}>
              <li>모든 밀대가 동시에 넘어져요. 도미노가 쓰러지는 데 곧게는 {ORTHO_TICKS}틱, 대각선은 {DIAG_TICKS}틱 — 대각선 사슬이 더 느려요!</li>
              <li>
                쓰러진 도미노는 자기가 바라보는 방향으로 넘어져 다음 칸을 쳐요(옆이나 뒤에서 맞아도 자기 방향으로).
              </li>
              <li>
                <b>🦝 가로채기</b>: 어떤 도미노에 <b>가장 먼저 닿은 사슬의 주인</b>이 그 도미노와 그 뒤 사슬을 전부 가져가요. 같은 틱에 여러 사슬이 닿으면 원래 주인이 지켜요(주인이 없으면 이번 라운드 쌓기 순서상 먼저인 사람).
              </li>
              <li>
                <b>💣 폭탄</b>: 건드린 사슬 주인 −{BOMB_PENALTY}점. 대신 주변 8칸을 한꺼번에 쳐서 — 그 도미노·종도 건드린 사람 것.
              </li>
              <li>🪨 바위·🧱 벽·판 끝에서 사슬은 멈춰요.</li>
            </ul>
          </section>
        )}

        {tab === "score" && (
          <section className="flex flex-col gap-3">
            <ul className={LIST}>
              <li>🔔 종: 가운데 큰 종 3점, 가까운 종 2점, 바깥 종 1점 (받침 둘레 금 점 개수 = 점수). 처음 울린 사슬만 점수 — 같은 틱에 같이 울리면 둘 다.</li>
              <li>🏁 가장 많이 쓰러뜨린 사슬(가로챈 것 포함, 밀대 제외): +{LONGEST_BONUS} (동점이면 +1씩).</li>
              <li>💣 −{BOMB_PENALTY}. 점수는 라운드마다 쌓여요. 동점이면 울린 종 수 → 쓰러뜨린 도미노 수.</li>
              <li>🔮 미리보기(방장 선택): 쌓는 동안 &ldquo;지금 다 쓰러지면&rdquo; 점수와 빼앗길 도미노(다른 색 테두리)를 보여줘요.</li>
            </ul>
          </section>
        )}

        {tab === "controls" && (
          <ul className={LIST}>
            <li>아래에서 🁢 도미노 / 🔀 갈림길 / 🧱 벽을 고르고 → 빛나는 칸을 누르고 → 나침반에서 방향을 눌러요.</li>
            <li>판을 끌면 돌려 볼 수 있고, 휠·핀치로 확대·축소. 🎥 버튼으로 위에서 보기.</li>
            <li>자리 색은 모양으로도 구분돼요: ● 빨강 · ▲ 파랑 · ■ 노랑 · ◆ 초록 (판 가장자리 띠 = 그 사람 밀대 쪽).</li>
            <li>🔇 소리 없이도 종을 울린 색·가로채기·폭탄은 화면에 표시돼요.</li>
          </ul>
        )}
      </div>
    </Overlay>
  );
}
