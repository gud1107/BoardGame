"use client";

import Overlay from "@/components/Overlay";
import { CARD_COUNT, CLAIM_WINDOW_MS, dumpHand, FREEZE_MS, GOLDEN_EVERY, GRAB_ROUNDS, HINT_MS, LATENCY_ALLOW_MS, MAX_PLAYERS, MIN_PLAYERS, SYMBOLS_PER_CARD } from "./data";

const H3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";
const P = "text-white/70 light:text-slate-600";
const sec = (ms: number) => `${ms / 1000}초`;

/**
 * 게임 안 룰북 (📖). boardGameRule/번개짝꿍/번개짝꿍.md 를 줄인 것 — 숫자는 data.ts에서 읽어 어긋나지 않는다.
 */
export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="📖 번개 짝꿍 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80 light:text-slate-700">
        <section>
          <h3 className={H3}>목표</h3>
          <p className={P}>
            동그란 카드 {CARD_COUNT}장, 한 장에 그림 {SYMBOLS_PER_CARD}개. <b>어떤 두 카드를 골라도 똑같은 그림이 딱 하나</b> 있어요. 내 카드와 가운데 카드에 같이 있는 그림을 남보다 먼저 찾아 누르세요!
            {MIN_PLAYERS}~{MAX_PLAYERS}명, 눈썰미와 순발력의 싸움.
          </p>
        </section>

        <section>
          <h3 className={H3}>누르는 법</h3>
          <ul className={`list-disc space-y-1 pl-5 ${P}`}>
            <li>두 카드 중 <b>어느 쪽의 그림을 눌러도</b> 돼요. 그림 크기·기울기가 카드마다 달라서 같은 그림도 달라 보여요.</li>
            <li>
              틀린 그림을 누르면 <b>❄️ {sec(FREEZE_MS)} 얼음</b> — 그동안은 눌러도 소용없어요. 마구 누르기보다 정확히!
            </li>
            <li>
              {sec(HINT_MS)} 동안 아무도 못 찾으면 내 화면에서 정답 그림이 💡 깜빡여요 (내 화면에만).
            </li>
            <li>키보드: Tab으로 그림을 옮겨 다니고 Enter/Space로 눌러요.</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>⚡ 쟁탈전</h3>
          <ul className={`list-disc space-y-1 pl-5 ${P}`}>
            <li>모두 카드 1장씩 받고, 가운데에 카드 1장이 펼쳐져요. 사람마다 내 카드가 달라서 찾을 그림도 달라요.</li>
            <li>짝을 먼저 찾으면 가운데 카드를 가져와 내 더미 맨 위에 올려요 → 이제 그 카드가 내 카드. 가운데에는 새 카드.</li>
            <li>
              <b>{GOLDEN_EVERY}장마다 ⚡ 번개 카드</b> (금색 테두리) — 가져오면 2점.
            </li>
            <li>
              가운데 카드 {GRAB_ROUNDS}장을 다 펼치면 끝. 모은 카드 + ⚡ 보너스가 가장 많은 사람이 우승 (같으면 평균 반응이 빠른 사람).
            </li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>🎯 떨이전</h3>
          <ul className={`list-disc space-y-1 pl-5 ${P}`}>
            <li>
              손 카드를 {dumpHand(2)}장(5명 {dumpHand(5)}장 · 8명 {dumpHand(8)}장) 받고, 맨 위 카드만 보여요. 가운데엔 카드 1장.
            </li>
            <li>내 맨 위 카드와 가운데 카드의 짝을 찾으면 내 카드를 가운데로 버려요 → 이제 <b>모두가</b> 새 가운데 카드로 찾아야 해요.</li>
            <li>손 카드를 가장 먼저 다 버린 사람이 우승. 나머지는 남은 카드가 적은 순.</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>누가 먼저였나 (온라인 공정성)</h3>
          <p className={P}>
            카드가 <b>내 화면에 그려진 순간</b>부터 그림을 누른 순간까지를 내 기기에서 재요. 방장은 첫 맞힘이 도착하면 {sec(CLAIM_WINDOW_MS)} 더 기다렸다가 그 안의 맞힘 중{" "}
            <b>가장 빨리 찾은 사람</b>에게 줘요 — 인터넷이 조금 느린 사람도 손해를 덜 봐요. 다만 방장 기준 걸린 시간보다 {sec(LATENCY_ALLOW_MS)} 넘게 짧다고 하면 믿지 않고 끌어올려요.
          </p>
        </section>

        <section>
          <h3 className={H3}>AI 봇</h3>
          <p className={P}>
            봇도 보이는 두 카드만 보고 찾아요. Lv.1은 짝 하나 찾는 데 평균 3.6초에 자주 헛짚고, Lv.10은 1.45초에 거의 안 틀려요. 2초쯤 걸리는 보통 사람은 Lv.5까지는 잘 이기고, Lv.7이면
            반반, Lv.9부터는 어려워요.
          </p>
        </section>
      </div>
    </Overlay>
  );
}
