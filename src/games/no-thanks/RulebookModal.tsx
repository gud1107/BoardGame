"use client";

import Overlay from "@/components/Overlay";

const CHIP_TABLE: { count: string; chips: string }[] = [
  { count: "3~5인", chips: "11개" },
  { count: "6인", chips: "9개" },
  { count: "7인", chips: "7개" },
];

export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="📖 노땡스! 룰북" onClose={onClose}>
      <div className="flex flex-col gap-5 text-sm text-white/80">
        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">목표</h3>
          <p className="text-white/70">
            숫자 카드는 전부 <span className="text-rose-300">벌점</span>이고, 남은 칩은 개당{" "}
            <span className="text-emerald-300">+1점</span> 상쇄해줍니다. 게임이 끝났을 때{" "}
            <span className="text-emerald-300">벌점이 가장 낮은</span> 사람이 승리합니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">게임 모드 (칩 공개 여부)</h3>
          <p className="text-white/70">
            방장이 방을 만들 때 아래 두 모드 중 하나를 고릅니다. 게임 도중에는 바뀌지 않습니다.
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-white/15 bg-white/[0.03] p-3">
              <p className="mb-1 font-medium text-white/90">🔒 비밀 모드 (공식 룰)</p>
              <p className="text-xs text-white/60">각자 자기 칩 개수만 확인할 수 있습니다. 상대의 칩은 상시 &quot;?&quot;로 표시됩니다.</p>
            </div>
            <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3">
              <p className="mb-1 font-medium text-amber-200">👁️ 공개 모드 (커스텀 룰)</p>
              <p className="text-xs text-white/60">모든 플레이어의 칩 개수가 항상 숫자로 공개됩니다.</p>
            </div>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">준비</h3>
          <p className="text-white/70">
            3~35 숫자 카드 33장 중 <span className="text-amber-300">무작위 9장을 아무도 보지 않고 완전히 제외</span>하고
            남은 24장으로 진행합니다. 인원수별 시작 칩 개수:
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[240px] border-collapse text-xs">
              <thead>
                <tr className="text-white/50">
                  <th className="border-b border-white/10 px-2 py-1.5 text-left">인원</th>
                  <th className="border-b border-white/10 px-2 py-1.5 text-left">시작 칩</th>
                </tr>
              </thead>
              <tbody>
                {CHIP_TABLE.map((row) => (
                  <tr key={row.count}>
                    <td className="border-b border-white/5 px-2 py-1.5 text-white">{row.count}</td>
                    <td className="border-b border-white/5 px-2 py-1.5 text-amber-300">{row.chips}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">진행 방식</h3>
          <p className="text-white/70">
            중앙에 카드 1장이 공개되어 있습니다. 자기 차례에 둘 중 하나를 선택하세요.
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3">
              <p className="mb-1 font-medium text-amber-200">🙅 노 땡스! (거절)</p>
              <p className="text-xs text-white/60">칩 1개를 카드 위에 올리고 다음 사람에게 차례를 넘깁니다.</p>
            </div>
            <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-3">
              <p className="mb-1 font-medium text-emerald-200">✅ 가져오기 (인수)</p>
              <p className="text-xs text-white/60">
                카드와 그 위에 쌓인 칩을 모두 가져오고, 바로 다음 카드를 뒤집어 계속 자신의 차례를 이어갑니다.
              </p>
            </div>
          </div>
          <p className="mt-2 text-xs text-amber-300/80">
            ⚠️ 칩이 0개면 거절할 수 없습니다 — 반드시 카드를 가져와야 합니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">
            핵심 규칙: 연속 숫자 카드
          </h3>
          <p className="text-white/70">
            연속된 숫자의 카드를 여러 장 갖고 있으면, <span className="text-emerald-300">그중 가장 작은 숫자 1장만</span>{" "}
            벌점으로 계산합니다. (예: 13·14·15·16 → 13점만 벌점) 처음에 9장이 무작위로 빠지기 때문에 중간 숫자가
            빠져서 연속이 끊기는 경우가 흔합니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">게임 종료 & 점수</h3>
          <p className="text-white/70">
            마지막 카드를 누군가 가져가는 즉시 게임이 끝납니다.
            <br />
            <span className="text-white">최종 벌점 = (연속 그룹별 최소 숫자의 합) − (남은 칩 개수)</span>
            <br />
            벌점이 가장 낮은 사람이 승리하며, 동점이면 남은 칩이 더 많은 사람이 이깁니다(그마저 같으면 공동 승리).
          </p>
        </section>
      </div>
    </Overlay>
  );
}
