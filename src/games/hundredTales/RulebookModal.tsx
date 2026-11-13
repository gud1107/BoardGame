"use client";

import { useState } from "react";
import Overlay from "@/components/Overlay";
import { CURSE_FINE, GHOST_EMOJI, GHOST_LABEL, GHOSTS, PERFECT_BONUS, RELIGHT, SALT_MAX, SEAT_HANDICAP, TURN_TIMEOUT_MS } from "./engine";

const H3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";
const LIST = "list-disc space-y-1.5 pl-4 text-white/70 light:text-slate-600";

type Tab = "basic" | "turn" | "cards" | "end" | "controls";
const TABS: { id: Tab; label: string }[] = [
  { id: "basic", label: "🕯️ 기본" },
  { id: "turn", label: "👻 내 차례" },
  { id: "cards", label: "🃏 카드" },
  { id: "end", label: "💀 끝과 점수" },
  { id: "controls", label: "🎮 조작" },
];

/** 게임 중 📖 버튼 — boardGameRule/백개의괴담/백개의괴담.md 의 앱 적용판. */
export default function RulebookModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("basic");
  return (
    <Overlay title="📖 백 개의 괴담 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-4 text-sm text-white/80 light:text-slate-700">
        <div className="flex flex-wrap gap-1.5" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-full border px-3 py-1 text-xs font-bold ${tab === t.id ? "border-rose-400 bg-rose-500/20 text-rose-100 light:text-rose-800" : "border-white/15 text-white/60 light:border-slate-300 light:text-slate-600"}`}
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
                깊은 밤, 촛불 100개를 켜 놓고 둘러앉아 돌아가며 괴담을 들려줘요. 이야기 하나를 할 때마다 그 이야기의 <b>공포</b>만큼 촛불이 꺼지고, 꺼진 촛불만큼 점수가 내 이야기에 쌓여요. 촛불은 모두가 나눠 먹는 파이 — 더 많이 가져가려면 더 오래 이야기해야 하지만, <b>같은 귀신을 두 번 부르면 씌어서</b> 모은 이야기가 날아가요.
              </p>
            </section>
            <section>
              <h3 className={H3}>인원과 순서</h3>
              <ul className={LIST}>
                <li>2~6명. 빈자리는 AI 봇(Lv.1~10)이 채워요.</li>
                <li>첫 이야기꾼은 무작위. 먼저 시작할수록 차례가 한 번 더 돌아올 수 있어서, 늦은 순번은 순번 하나당 {SEAT_HANDICAP}점을 들고 시작해요.</li>
                <li>촛불 100개(정식) 또는 60개(짧은 밤) 중에서 방장이 골라요.</li>
              </ul>
            </section>
          </>
        )}

        {tab === "turn" && (
          <section>
            <h3 className={H3}>내 차례</h3>
            <ul className={LIST}>
              <li>
                <b>최소 한 이야기</b>는 꼭 해야 해요(덱 맨 위 카드를 뒤집기).
              </li>
              <li>귀신 카드는 내 앞 &ldquo;이야기&rdquo;에 쌓이고, 공포 수만큼 촛불이 꺼져요.</li>
              <li>
                그다음 <b>👻 한 이야기 더</b> 또는 <b>🛑 여기까지</b>. 여기까지를 고르면 이야기의 공포 합계가 내 점수가 돼요.
              </li>
              <li>
                이번 차례에 <b>이미 나온 귀신이 또 나오면 씌임 😱</b> — 이번 차례 이야기는 점수 없이 버려지고 차례가 넘어가요(꺼진 촛불은 그대로 꺼진 채).
              </li>
              <li>
                다섯 귀신({GHOSTS.map((g) => GHOST_EMOJI[g]).join("")})이 한 이야기에 다 모이면 <b>다섯 귀신</b> — +{PERFECT_BONUS}점 보너스와 함께 자동으로 모아요.
              </li>
              <li>{TURN_TIMEOUT_MS / 1000}초 안에 고르지 않으면: 아직 한 이야기도 안 했으면 하나 하고, 바로 여기까지.</li>
            </ul>
          </section>
        )}

        {tab === "cards" && (
          <section>
            <h3 className={H3}>괴담 카드 45장</h3>
            <ul className={LIST}>
              <li>
                귀신 다섯 종({GHOSTS.map((g) => `${GHOST_EMOJI[g]} ${GHOST_LABEL[g]}`).join(" · ")}) × 공포 1·1·2·2·3·3·4 = 35장
              </li>
              <li>🧂 소금 부적 ×4 — 갖고 있다가 씌일 뻔할 때 한 번 대신 타버려요(최대 {SALT_MAX}개, 다음 차례로 이어짐).</li>
              <li>🕯️ 새 초 ×3 — 꺼진 촛불 {RELIGHT}개를 다시 켜요(처음 개수까지).</li>
              <li>🪞 거울 ×3 — 다음 카드가 모두에게 보여요. 보고 나서 더 할지 정하세요.</li>
              <li>카드는 모두 공개돼요. 덱이 떨어지면 버린 카드를 섞어 다시 써요. 남은 귀신 수는 화면 아래에서 셀 수 있어요.</li>
            </ul>
          </section>
        )}

        {tab === "end" && (
          <section>
            <h3 className={H3}>백 번째 이야기</h3>
            <ul className={LIST}>
              <li>
                <b>마지막 촛불을 끈 사람</b>이 저주를 받아요: 이번 이야기는 날아가고 점수의 <b>절반</b>(최소 {CURSE_FINE}점)을 잃어요. 그 즉시 게임 끝.
              </li>
              <li>촛불이 적게 남으면 &ldquo;최소 한 이야기&rdquo;가 무서워져요 — 화면에 저주 확률이 떠요.</li>
              <li>점수가 가장 높은 사람이 우승. 동점이면 덜 씐 사람이 위.</li>
            </ul>
          </section>
        )}

        {tab === "controls" && (
          <section>
            <h3 className={H3}>조작</h3>
            <ul className={LIST}>
              <li>버튼 또는 키보드: Space/Enter = 한 이야기 더, S/Esc = 여기까지.</li>
              <li>🔰 도우미(방 설정)를 켜면 씌일 확률·저주 확률·기대 점수를 보여줘요(공개된 카드만 세서 계산).</li>
              <li>🧊 3D / 🖼️ 2D 전환, 🎥 1인칭 / 🪑 테이블 시점은 화면 위·캔버스 구석 버튼으로.</li>
              <li>귀신은 색이 아니라 그림(👻👹🦊💀🥚)으로 구분하고, 자리는 색 + 모양(●◆▲■★✚)으로 표시해요.</li>
            </ul>
          </section>
        )}
      </div>
    </Overlay>
  );
}
