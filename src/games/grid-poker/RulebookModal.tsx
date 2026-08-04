"use client";

import Overlay from "@/components/Overlay";
import { CardChip, SUIT_SYMBOL } from "./cardDisplay";
import type { Card } from "./engine";

function ex(rank: number, suit: "S" | "D" | "H" | "C"): Card {
  return { id: `${rank}${suit}`, kind: "std", rank, suit };
}

const HAND_EXAMPLES: { name: string; cards: Card[]; note?: string }[] = [
  { name: "로열 스트레이트 플러시", cards: [ex(14, "S"), ex(13, "S"), ex(12, "S"), ex(11, "S"), ex(10, "S")], note: "같은 문양 10~A" },
  { name: "스트레이트 플러시", cards: [ex(9, "H"), ex(8, "H"), ex(7, "H"), ex(6, "H"), ex(5, "H")] },
  { name: "포카드", cards: [ex(9, "S"), ex(9, "D"), ex(9, "H"), ex(9, "C"), ex(3, "S")] },
  { name: "풀 하우스", cards: [ex(6, "S"), ex(6, "D"), ex(6, "H"), ex(2, "C"), ex(2, "S")] },
  { name: "플러시", cards: [ex(13, "C"), ex(9, "C"), ex(7, "C"), ex(4, "C"), ex(2, "C")] },
  { name: "스트레이트", cards: [ex(8, "S"), ex(7, "D"), ex(6, "H"), ex(5, "C"), ex(4, "S")], note: "문양 무관, 숫자만 5연속" },
  { name: "트리플", cards: [ex(11, "S"), ex(11, "D"), ex(11, "H"), ex(6, "C"), ex(2, "S")] },
  { name: "투 페어", cards: [ex(10, "S"), ex(10, "D"), ex(5, "H"), ex(5, "C"), ex(2, "S")] },
  { name: "원 페어", cards: [ex(8, "S"), ex(8, "D"), ex(12, "H"), ex(6, "C"), ex(2, "S")] },
  { name: "하이 카드 (탑)", cards: [ex(14, "S"), ex(10, "D"), ex(7, "H"), ex(5, "C"), ex(2, "S")], note: "A가 가장 높음" },
];

export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="📖 그리드 포커 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80">
        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">카드 구성</h3>
          <p className="text-white/70">
            2~10, J, Q, K, A (13종 × 4문양 = 52장) + 조커 2장, 총 <span className="text-white">54장</span>.
            공통 카드는 뽑을 때마다 즉시 덱에 되돌아가므로 매 순간 어떤 카드가 나올 확률은 항상{" "}
            <span className="text-white">1/54</span>로 동일합니다 — 같은 카드가 한 판에 여러 번 나올 수 있어요.
            조커는 <span className="text-amber-300">어떤 숫자·문양으로도</span> 대체할 수 있는 완전 와일드 카드입니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">보드판 & 배치</h3>
          <p className="text-white/70">
            각자 5×5(25칸) 보드판을 갖습니다. 공통 카드가 한 장씩 공개될 때마다 모든 플레이어가{" "}
            <span className="text-white">동시에</span> 자신의 빈 칸 중 원하는 곳에 배치하며, 25칸이 다 찰
            때까지(25번) 반복합니다. 내가 <span className="text-white">가장 처음 놓은 칸</span>만 상대에게
            공개되고, 그 외의 내 보드판 전체는 나만 볼 수 있습니다 (상대도 마찬가지).
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">족보 제출 & 승부</h3>
          <p className="mb-2 text-white/70">
            보드판이 다 차면, 가로 5줄 + 세로 5줄 + 대각선 2줄, 총 <span className="text-white">12개 라인</span>이
            생깁니다. 매 라운드마다 모두가 자신의 라인 중 아직 제출하지 않은 라인을 하나 골라{" "}
            <span className="text-white">동시에</span> 제출하고, 공개해서 가장 높은 포커 족보를 완성한 사람이
            그 라운드를 가져갑니다. 한 번 제출한 라인은 다시 제출할 수 없습니다.
          </p>
          <p className="text-white/70">
            <span className="text-white">2인전</span>: 12개 중 10개 라인만 사용하며 (나머지 2개는 전략적으로
            포기), 10라운드 중 <span className="text-amber-300">6승을 먼저</span> 달성하면 즉시 승리합니다.
            <br />
            <span className="text-white">3인 이상</span>: 12개 라인을 모두 제출하며, 12라운드 종료 후 승점이
            가장 높은 사람이 승리합니다 (도중에 <span className="text-amber-300">7승</span>을 채우면 즉시
            승리 확정).
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">동점 판정</h3>
          <p className="text-white/70">
            ① 족보 자체가 높은 쪽이 승리 → ② 같은 족보면 주 카드 숫자(A가 가장 높음)가 높은 쪽 → ③ 그래도
            같으면 나머지 카드(키커)를 순서대로 비교 → ④{" "}
            <span className="text-white">5장 구성이 완전히 동일</span>할 때만 가장 높은 카드의 문양(
            <span className="text-white">{SUIT_SYMBOL.S} &gt; {SUIT_SYMBOL.D} &gt; {SUIT_SYMBOL.H} &gt; {SUIT_SYMBOL.C}</span>
            )으로 승부를 가립니다. 그래도 완전히 같다면 그 라운드는 무승부(승점 없음)입니다.
          </p>
        </section>

        <section>
          <h3 className="mb-3 text-xs font-semibold tracking-wide text-white/50 uppercase">
            포커 족보 (높은 순)
          </h3>
          <div className="flex flex-col gap-1.5">
            {HAND_EXAMPLES.map((h, i) => (
              <div
                key={h.name}
                className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-2.5"
              >
                <span className="w-5 shrink-0 text-center text-xs text-white/40">{i + 1}</span>
                <div className="flex shrink-0 gap-1">
                  {h.cards.map((c) => (
                    <CardChip key={c.id} card={c} size="sm" />
                  ))}
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-white">{h.name}</p>
                  {h.note && <p className="text-xs text-white/50">{h.note}</p>}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </Overlay>
  );
}
