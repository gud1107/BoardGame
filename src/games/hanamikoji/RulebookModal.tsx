"use client";

import Overlay from "@/components/Overlay";

const ACTIONS = [
  {
    emoji: "🤫",
    name: "비밀 (밀서)",
    desc: "카드 1장을 아무도 모르게 뒤집어 숨깁니다. 라운드가 끝날 때 공개되어 집계에 포함됩니다.",
  },
  {
    emoji: "🗑️",
    name: "거래 (버리기)",
    desc: "카드 2장을 그대로 버립니다. 이 라운드의 집계에서 완전히 제외됩니다.",
  },
  {
    emoji: "🎁",
    name: "선물",
    desc: "카드 3장을 상대에게 보여주면, 상대가 그중 1장을 가져가고 나머지 2장은 내가 가져갑니다.",
  },
  {
    emoji: "⚔️",
    name: "경쟁 (경매)",
    desc: "카드 4장을 2장씩 두 묶음으로 나누면, 상대가 먼저 한 묶음을 가져가고 남은 묶음을 내가 가져갑니다.",
  },
];

export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="📖 하나미코지 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80">
        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">
            매 턴 4가지 액션 (라운드당 한 번씩만)
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {ACTIONS.map((a) => (
              <div key={a.name} className="rounded-xl border border-white/10 bg-white/5 p-3">
                <p className="mb-1 font-medium text-white">
                  {a.emoji} {a.name}
                </p>
                <p className="text-xs text-white/60">{a.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">
            라운드 종료
          </h3>
          <p className="text-white/70">
            게이샤마다 두 사람이 모은 카드 수를 비교해, 더 많이 모은 쪽이 그 게이샤를 차지합니다
            (동수면 소유권 변동 없음). 한 번 차지한 게이샤는 다음 라운드에도 계속 유지됩니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">
            승리 조건
          </h3>
          <p className="text-white/70">
            게이샤 7명 중 <span className="text-rose-300">4명 이상</span>을 확보하거나, 확보한
            게이샤의 호감도 합이 <span className="text-rose-300">11점 이상</span>이 되는 즉시
            매치에서 승리합니다. 한 라운드에서 두 조건이 동시에 충족되면 호감도 합이 더 높은
            쪽이 승리합니다.
          </p>
        </section>
      </div>
    </Overlay>
  );
}
