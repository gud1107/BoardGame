"use client";

import Overlay from "@/components/Overlay";
import { CucumberIcon, CucumberRow } from "./CucumberIcon";

const TIER_ROWS: { range: string; count: number }[] = [
  { range: "1 ~ 5", count: 0 },
  { range: "6 ~ 9", count: 1 },
  { range: "10 ~ 11", count: 2 },
  { range: "12 ~ 13", count: 3 },
  { range: "14", count: 4 },
  { range: "15", count: 5 },
];

export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="📖 오이 다섯 개 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80">
        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">목표</h3>
          <p className="text-white/70">
            1~15 숫자 카드(각 4장, 총 60장)로 트릭테이킹을 벌이는 게임입니다.{" "}
            <span className="text-emerald-300">이 게임의 목표는 트릭을 이기는 게 아니라 — 정확히 그 반대로, 매 라운드의
            마지막(7번째) 트릭을 따내지 않는 것</span>
            입니다. 마지막 트릭을 따낸 사람은 <CucumberIcon className="mx-0.5 inline h-4 w-4 align-[-3px]" />오이 토큰을
            벌점으로 받으며, 너무 많이 모으면 탈락합니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">준비</h3>
          <p className="text-white/70">모든 플레이어에게 카드를 7장씩 나눠주고, 한 라운드는 총 7번의 트릭으로 진행됩니다.</p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">트릭 진행 — 카드 내는 규칙</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-white/15 bg-white/[0.03] p-3">
              <p className="mb-1 font-medium text-white/90">① 선 플레이어</p>
              <p className="text-xs text-white/60">손에 있는 카드 중 아무거나 1장을 내며 트릭을 시작합니다.</p>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/[0.03] p-3">
              <p className="mb-1 font-medium text-white/90">② 다음 플레이어들 — 둘 중 하나만</p>
              <p className="text-xs text-white/60">
                (a) 지금까지 나온 카드 중 <b>가장 높은 숫자와 같거나 더 높은</b> 카드를 내거나, (b) 높은 카드를 내기
                싫거나 없다면 <b>자신의 손패 중 가장 낮은 숫자</b>의 카드를 냅니다. (b)는 언제든 선택할 수 있는
                안전한 선택지입니다 — 굳이 이길 필요가 없을 때 낮은 카드를 미리 처리하는 데 씁니다.
              </p>
            </div>
          </div>
          <p className="mt-2 text-xs text-white/60">
            가장 높은 숫자를 낸 사람이 트릭을 따냅니다. 동점이면 <b>나중에 낸 사람</b>이 이깁니다. 1~6번째
            트릭의 승자는 벌점 없이 다음 트릭의 선이 됩니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">
            마지막(7번째) 트릭 — 오이 정산
          </h3>
          <p className="mb-2 text-white/70">
            7번째 트릭에서 가장 높은 숫자를 낸 사람(들)이 그 카드의 오이 개수만큼 오이 토큰을 받습니다. 동점이면
            동점자 <b>모두 각자</b> 같은 개수를 받습니다(나눠 갖지 않음).
          </p>
          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full min-w-[280px] border-collapse text-xs">
              <thead>
                <tr className="bg-white/5 text-white/50">
                  <th className="px-2 py-1.5 text-left">카드 숫자</th>
                  <th className="px-2 py-1.5 text-left">오이 개수</th>
                </tr>
              </thead>
              <tbody>
                {TIER_ROWS.map((row) => (
                  <tr key={row.range} className="border-t border-white/10">
                    <td className="px-2 py-1.5 font-semibold text-white/80">{row.range}</td>
                    <td className="px-2 py-1.5">
                      <CucumberRow count={row.count} size="h-3.5 w-3.5" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-amber-200/80">
            🔥 1번 카드의 배수 효과: 7번째 트릭에 <b>1번 카드</b>가 나온 만큼 오이 개수가 2배씩 늘어납니다 —
            1장이면 ×2, 2장이면 ×4, 3장이면 ×8. (예: 14번 카드로 이겼는데 같은 트릭에 1번 카드가 나왔다면
            기본 오이 4개가 8개가 됩니다.)
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">탈락 기준 (하우스 룰)</h3>
          <p className="text-white/70">
            누적 오이 토큰이 방장이 정한 기준(<b>5개</b> 또는 <b>6개</b>, 둘 다 공식 룰이 인정하는 값입니다) 이상이
            되면 즉시 탈락합니다. 탈락한 플레이어는 이후 라운드에 참여하지 않고, 남은 플레이어들끼리 새 카드를
            나눠 다음 라운드를 계속합니다. <b>최후까지 살아남은 단 1명</b>이 최종 승리자입니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">전략 팁</h3>
          <ul className="list-disc space-y-1 pl-4 text-xs text-white/60">
            <li>15번 카드는 트릭을 이기기 가장 쉽지만, 마지막 트릭에 내면 오이 5개를 받으니 초반에 안전하게 털어내세요.</li>
            <li>손패에 어중간하게 높은 카드(12~13 등)만 남으면 마지막 트릭에서 어쩔 수 없이 이기게 됩니다 — 미리 관리하세요.</li>
            <li>1번 카드는 마지막 트릭까지 아껴뒀다가 1등에게 오이 2배 폭탄을 터뜨리는 전략이 강력합니다.</li>
          </ul>
        </section>
      </div>
    </Overlay>
  );
}
