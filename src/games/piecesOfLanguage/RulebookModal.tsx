"use client";

import Overlay from "@/components/Overlay";

const HINT_COLORS = [
  { emoji: "🟦", name: "청색 (Blue)", desc: "해당 위치의 자음/모음이 정답 단어와 정확히 일치함" },
  { emoji: "🟨", name: "노랑 (Yellow)", desc: "글자가 정답 단어에 포함되어 있으나 위치가 틀림" },
  { emoji: "⬜", name: "회색 (Gray)", desc: "해당 자음/모음이 정답 단어에 전혀 포함되지 않음" },
];

export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="📖 언어의 조각 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80">
        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">
            준비
          </h3>
          <p className="text-white/70">
            게임을 시작하면 시스템이 정해진 글자 수(2~5글자)의{" "}
            <b className="text-white">공통 정답 단어 1개</b>를 무작위로 뽑아 숨겨둡니다. 이
            단어는 두 사람 모두가 함께 맞혀야 하는 유일한 정답입니다. 선/후공은 무작위로
            정해집니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">
            턴 진행
          </h3>
          <p className="text-white/70">
            Player 1과 Player 2가 <b className="text-white">번갈아가며</b> 같은 글자 수의 추측
            단어를 하나씩 제시합니다. 제시하면 자동으로 그 단어와 공통 정답 단어의{" "}
            <b className="text-white">초성·중성·종성</b>을 한 글자씩 비교해 힌트 색을 보여줍니다.
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {HINT_COLORS.map((c) => (
              <div key={c.name} className="rounded-xl border border-white/10 bg-white/5 p-3">
                <p className="mb-1 font-medium text-white">
                  {c.emoji} {c.name}
                </p>
                <p className="text-xs text-white/60">{c.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">
            단판 승부 종료
          </h3>
          <p className="text-white/70">
            <b className="text-white">승리 조건</b> — 공통 정답 단어를 글자 위치까지 완벽하게
            맞혀 모든 글자가 청색이 되면, 그 즉시 먼저 맞힌 플레이어가 최종 승자가 됩니다.
          </p>
          <p className="mt-2 text-white/70">
            <b className="text-white">최대 시도 횟수 (선택)</b> — 방장이 정해둔 경우, 두 사람의
            시도 횟수를 합산해 그 횟수 안에 아무도 정답을 맞히지 못하면 더 많은 청색/노랑
            힌트를 이끌어낸 쪽이 판정승합니다(동점이면 무승부).
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">
            핵심 전략
          </h3>
          <ul className="list-disc space-y-1 pl-4 text-white/70">
            <li>초반에는 중복 자모음이 없는 다양한 단어로 회색을 최대한 지워내세요.</li>
            <li>상대의 시도와 힌트도 함께 공개되니, 상대의 진행 상황을 참고해 더 빠르게 좁혀보세요.</li>
          </ul>
        </section>
      </div>
    </Overlay>
  );
}
