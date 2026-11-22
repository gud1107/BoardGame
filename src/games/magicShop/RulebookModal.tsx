"use client";

import Overlay from "@/components/Overlay";
import { CARDS, ORDERS, STARTER } from "./cards";
import { FAME_GOAL, HAND_SIZE, MAX_FLASK, PATIENCE, REROLL_COST, START_FLASK, TURN_MS, WEB_PENALTY } from "./engine";
import { ElChip, MagicCard } from "./CardArt";

const H3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 light:text-slate-500 uppercase";
const EM = "text-violet-300 light:text-violet-700";

export default function RulebookModal({ onClose }: { onClose: () => void }) {
  const shop = CARDS.map((c, i) => ({ c, i })).filter(({ c }) => c.kind === "shop");
  const supply = CARDS.map((c, i) => ({ c, i })).filter(({ c }) => c.kind === "supply");
  const starterIds = [...new Set(STARTER)];
  return (
    <Overlay title="🧙 마법 상점 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80 light:text-slate-700">
        <section>
          <p className="text-white/70 light:text-slate-600">
            견습 마법사들이 한 거리에 마법 상점을 열었어요. 진열대에서 재료 카드를 사서 <span className={EM}>내 덱을 키우고</span>, 손님이 원하는 🔥💧🌿✨ 원소를 모아 물약을 납품해{" "}
            <span className={EM}>⭐ 명성</span>을 쌓아요. 누군가 목표 명성(2인 {FAME_GOAL[2]} · 3인 {FAME_GOAL[3]} · 4인 {FAME_GOAL[4]})에 닿으면 그 라운드까지 하고 끝 — 명성이 가장
            높은 사람이 우승! 2~4인, 약 15~25분.
          </p>
        </section>

        <section>
          <h3 className={H3}>1. 시작</h3>
          <p>
            모두 같은 10장으로 시작해요: 🪙 동전 6장 · 🌱 말린 약초 2장 · 🔸 불씨 · 💠 이슬 방울. 덱을 섞어 {HAND_SIZE}장을 손에 들어요. 뒤에 하는 사람은 첫 턴에 🧪 보관병에 원소가 조금 들어
            있어요(2번째 자리부터 🌿, 🔥🌿, 🔥💧🌿).
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {starterIds.map((id) => (
              <MagicCard key={id} id={id} compact />
            ))}
          </div>
        </section>

        <section>
          <h3 className={H3}>2. 내 차례 (순서 자유, {TURN_MS / 1000}초)</h3>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <b>카드 내기</b>: 손의 카드를 눌러 내면 🪙 골드와 원소가 이번 턴 <b>가마솥</b>에 쌓여요. &quot;카드 +N&quot;은 바로 더 뽑기, 🧹 폐기는 손의 카드를 골라 게임에서 없애기(덱이
              가벼워져요). <b>▶ 모두 내기</b>는 고를 것 없는 카드를 한 번에 내요.
            </li>
            <li>
              <b>카드 사기</b>: 🪙로 🛒 진열대(무작위 5장) 또는 계산대(늘 있는 3종)의 카드를 사요. 산 카드는 <b>버린 더미</b>로 가서, 덱을 다 쓰고 다시 섞을 때부터 손에 들어와요. 여러 장 사도 돼요.
            </li>
            <li>
              <b>의뢰 납품</b>: 손님 카드에 적힌 원소를 가마솥에서 내면 ⭐ 명성과 🎁 보너스를 받아요. 한 턴에 여러 명도 돼요.
            </li>
            <li>
              <b>🔄 돌려보내기</b>: 턴에 한 번, 🪙{REROLL_COST}로 손님 한 명을 덱 맨 아래로 보내고 새 손님을 받아요.
            </li>
            <li>
              <b>턴 끝</b>: 남은 원소는 🧪 보관병 칸 수(처음 {START_FLASK}칸, 최대 {MAX_FLASK}칸)만큼 다음 턴으로 가져가고 나머지는 사라져요. 🪙는 남지 않아요. 손과 낸 카드는 모두 버린 더미로 →{" "}
              {HAND_SIZE}장 새로 뽑기.
            </li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>3. 손님 의뢰</h3>
          <p>
            의뢰는 3장이 펼쳐져 있어요. 손님은 {PATIENCE}라운드를 기다리다 아무도 안 채우면 떠나고(⏳ 표시), 새 손님이 와요. ✨ 별빛이 들어간 의뢰일수록 명성이 커요. 🎁 보너스: 🪙+2 · 카드 1장
            · 🧪 보관병 +1칸 · 🕸️ 거미줄 1장 없애기.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
            {ORDERS.filter((_, i) => i % 4 === 0).map((o) => (
              <span key={o.id} className="flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 light:border-slate-200">
                {o.emoji} {o.potion} {o.need.map((v, e) => (v ? <ElChip key={e} e={e} n={v} /> : null))} → ⭐{o.fame}
              </span>
            ))}
          </div>
        </section>

        <section>
          <h3 className={H3}>4. 상점 카드</h3>
          <p className="mb-2 text-xs text-white/55 light:text-slate-500">왼쪽 위 노란 숫자 = 가격. 계산대 카드는 몇 장이든 살 수 있고, 진열대 카드는 산 자리에 창고에서 새 카드가 나와요.</p>
          <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
            {[...supply, ...shop].map(({ i }) => (
              <MagicCard key={i} id={i} />
            ))}
          </div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
            <li>🐈‍⬛ 검은 고양이: 다른 모두의 버린 더미에 🕸️ 거미줄(아무 효과 없음, 끝날 때 명성 −{WEB_PENALTY}). 거미줄은 🧹·🗿로 없앨 수 있어요.</li>
            <li>🪞 거울 마법: 이번 턴에 바로 앞에 낸 카드의 효과를 한 번 더 (🔮 앞에 내면 카드 3장 더!). 처음 낸 카드면 효과 없음.</li>
            <li>🪧 황금 간판: 낼 때마다 명성 +1 — 늦게 사면 몇 번 못 내요.</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>5. 끝과 점수</h3>
          <p>
            내 턴이 끝났을 때 명성이 목표 이상이면(또는 손님이 다 떨어지면) <b>그 라운드의 마지막 사람까지</b> 하고 끝나요 — 모두 같은 횟수만큼 해요. 최종 = 명성 − 🕸️ 거미줄 수. 동점이면 의뢰를 더 많이
            채운 사람, 그래도 같으면 카드가 적은 사람.
          </p>
        </section>

        <section>
          <h3 className={H3}>6. 요령</h3>
          <ul className="list-disc space-y-1 pl-5">
            <li>처음 몇 턴은 🪙로 원소 카드를 사서 덱을 키우세요. 🧹 빗자루로 동전을 지우면 좋은 카드가 더 자주 와요.</li>
            <li>펼쳐진 손님이 원하는 원소를 보고 사세요. ✨는 계산대 🫙 별가루 병으로 언제나 살 수 있어요.</li>
            <li>🧪 보관병에 ✨를 남겨 두면 다음 턴 큰 의뢰를 노릴 수 있어요.</li>
            <li>카드가 너무 많으면 좋은 카드가 묻혀요. 막판엔 새 카드보다 납품이 더 중요해요.</li>
          </ul>
          <p className="mt-2 text-xs text-white/45 light:text-slate-400">
            시간 초과면 고를 것 없는 카드를 다 내고 가능한 의뢰만 채운 뒤 자동으로 턴이 끝나요(사지는 않아요). 카드 {CARDS.length - 1}종 · 손님 {ORDERS.length}명.
          </p>
        </section>
      </div>
    </Overlay>
  );
}
