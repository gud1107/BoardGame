"use client";

import Overlay from "@/components/Overlay";

const HINT_COLORS = [
  { emoji: "🟩", name: "초록 (Green)", desc: "해당 위치의 자음/모음이 정확히 일치함" },
  { emoji: "🟨", name: "노랑 (Yellow)", desc: "글자가 비밀 단어에 포함되어 있으나 위치가 틀림" },
  { emoji: "⬜", name: "회색 (Gray)", desc: "해당 자음/모음이 비밀 단어에 전혀 포함되지 않음" },
];

export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="📖 언어의 조각 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80">
        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">
            준비 (§1~2)
          </h3>
          <p className="text-white/70">
            두 사람이 함께 글자 수(2~5글자)를 정한 뒤, 각자 상대가 맞혀야 할{" "}
            <b className="text-white">비밀 단어 1개</b>를 자신만 알게 정합니다. 선/후공은
            무작위로 정해집니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">
            내 턴에 하는 일 (§3)
          </h3>
          <p className="text-white/70">
            상대의 비밀 단어를 추정해 같은 글자 수의 단어 1개를 제시합니다. 그러면 자동으로
            제시한 단어와 상대 비밀 단어의 <b className="text-white">초성·중성·종성</b>을
            한 글자씩 비교해 힌트 색을 보여줍니다.
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
            [하우스 룰] 단판 승부 종료 (§4)
          </h3>
          <p className="text-white/70">
            <b className="text-white">승리 조건 A</b> — 상대의 비밀 단어를 글자 위치까지
            완벽하게 맞혀 모든 글자가 초록색이 되면 즉시 승리합니다.
          </p>
          <p className="mt-2 text-white/70">
            <b className="text-white">승리 조건 B (선택)</b> — 방장이 최대 시도 횟수를 정해둔
            경우, 두 사람 모두 그 횟수 안에 정답을 맞히지 못하면 더 많은 초록/노랑 힌트를
            이끌어낸 쪽이 판정승합니다(동점이면 무승부).
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">
            핵심 전략 (§5)
          </h3>
          <ul className="list-disc space-y-1 pl-4 text-white/70">
            <li>초반에는 중복 자모음이 없는 다양한 단어로 회색을 최대한 지워내세요.</li>
            <li>된소리(ㄲ,ㄸ,ㅃ)나 복합 모음(ㅞ,ㅟ)이 든 단어를 비밀 단어로 고르면 상대를 더 오래 헤매게 할 수 있습니다.</li>
          </ul>
        </section>
      </div>
    </Overlay>
  );
}
