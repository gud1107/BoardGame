"use client";

import Overlay from "@/components/Overlay";

const ROLES: { emoji: string; name: string; desc: string }[] = [
  { emoji: "🧙", name: "메를린 (선)", desc: "모드레드를 제외한 모든 악한 세력의 정체(오베론 포함)를 알고 시작합니다. 너무 티내면 마지막 암살 단계에서 지목당해요." },
  { emoji: "🛡️", name: "퍼시벌 (선)", desc: "메를린과 모르가나, 두 사람을 알지만 누가 진짜 메를린인지는 구분할 수 없습니다." },
  { emoji: "⚔️", name: "충신 (선)", desc: "추가 정보 없이 원정 성공만을 위해 신중하게 투표하고 참여해야 합니다." },
  { emoji: "🌙", name: "모르가나 (악)", desc: "퍼시벌에게 메를린인 것처럼 보이는 교란 담당입니다. 다른 악한 세력과는 서로를 압니다." },
  { emoji: "👑", name: "모드레드 (악)", desc: "메를린에게조차 정체가 밝혀지지 않는 악의 수장입니다. 다른 악한 세력과는 서로를 압니다." },
  { emoji: "🏹", name: "암살자 (악)", desc: "3번째 원정이 성공하면 메를린으로 의심되는 사람을 지목합니다. 정확히 맞히면 악이 역전승합니다." },
  { emoji: "🏝️", name: "오베론 (악)", desc: "다른 악한 세력과 서로 정체를 모르는 외딴 존재입니다. (메를린은 오베론을 악으로 확인 가능)" },
];

const COMPOSITION: { count: string; good: string; evil: string }[] = [
  { count: "5인", good: "3명", evil: "2명 (모르가나, 암살자)" },
  { count: "6인", good: "4명", evil: "2명 (모르가나, 암살자)" },
  { count: "7인", good: "4명", evil: "3명 (모르가나, 암살자, 모드레드)" },
  { count: "8인", good: "5명", evil: "3명 (모르가나, 암살자, 모드레드)" },
  { count: "9인", good: "6명", evil: "3명 (모르가나, 암살자, 모드레드)" },
  { count: "10인", good: "6명", evil: "4명 (모르가나, 암살자, 모드레드, 오베론)" },
];

const TEAM_SIZES: { count: string; sizes: string }[] = [
  { count: "5인", sizes: "2 · 3 · 2 · 3 · 3" },
  { count: "6인", sizes: "2 · 3 · 4 · 3 · 4" },
  { count: "7인", sizes: "2 · 3 · 3 · 4 · 4" },
  { count: "8~10인", sizes: "3 · 4 · 4 · 5 · 5" },
];

export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="📖 아발론 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80">
        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">목표</h3>
          <p className="text-white/70">
            <span className="text-sky-300">선한 세력</span>은 원정(퀘스트)을 3회 성공시키고, 암살자가 메를린을 맞히지
            못해야 최종 승리합니다. <span className="text-rose-300">악한 세력</span>은 원정을 3회 실패시키거나, 원정대
            지목이 연속 5회 부결되거나, 원정 3회가 성공해도 암살자가 메를린을 정확히 지목하면 승리합니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">역할</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {ROLES.map((r) => (
              <div key={r.name} className="rounded-xl border border-white/10 bg-white/5 p-3">
                <p className="mb-1 font-medium text-white">
                  {r.emoji} {r.name}
                </p>
                <p className="text-xs text-white/60">{r.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">인원별 세력 구성</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[360px] border-collapse text-xs">
              <thead>
                <tr className="text-white/50">
                  <th className="border-b border-white/10 px-2 py-1.5 text-left">인원</th>
                  <th className="border-b border-white/10 px-2 py-1.5 text-left">선</th>
                  <th className="border-b border-white/10 px-2 py-1.5 text-left">악</th>
                </tr>
              </thead>
              <tbody>
                {COMPOSITION.map((row) => (
                  <tr key={row.count}>
                    <td className="border-b border-white/5 px-2 py-1.5 text-white">{row.count}</td>
                    <td className="border-b border-white/5 px-2 py-1.5 text-sky-300">{row.good}</td>
                    <td className="border-b border-white/5 px-2 py-1.5 text-rose-300">{row.evil}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">원정 참여 인원 (1~5라운드)</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[300px] border-collapse text-xs">
              <thead>
                <tr className="text-white/50">
                  <th className="border-b border-white/10 px-2 py-1.5 text-left">인원</th>
                  <th className="border-b border-white/10 px-2 py-1.5 text-left">라운드별 인원수</th>
                </tr>
              </thead>
              <tbody>
                {TEAM_SIZES.map((row) => (
                  <tr key={row.count}>
                    <td className="border-b border-white/5 px-2 py-1.5 text-white">{row.count}</td>
                    <td className="border-b border-white/5 px-2 py-1.5 text-white/70">{row.sizes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-amber-300/80">
            ⚠️ 7인 이상의 4라운드는 실패 카드가 2장 이상 나와야 실패 처리됩니다 (1장만 나오면 성공).
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">진행 순서</h3>
          <p className="text-white/70">
            ① 리더가 이번 라운드 인원수만큼 원정대를 지목 → ② 전원이 동시에 찬성/반대 투표 (과반수 찬성이어야 통과,
            동수는 부결) → ③ 부결되면 리더가 시계방향으로 넘어가 다시 지목 (한 라운드에서 <span className="text-rose-300">연속 5회</span>{" "}
            부결 시 즉시 악 승리) → ④ 승인되면 원정대만 비공개로 성공/실패 카드를 제출 (선한 세력은 무조건 성공만
            제출 가능) → ⑤ 공개해서 원정 성공/실패 판정 → ⑥ 다음 라운드로.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">암살 단계</h3>
          <p className="text-white/70">
            원정 3회가 먼저 성공하면 곧바로 게임이 끝나지 않고, 악한 세력의 암살자가 메를린으로 의심되는 사람 1명을
            지목합니다. 정확히 메를린이면 악한 세력이 역전 승리하고, 아니면 선한 세력의 승리로 확정됩니다.
          </p>
        </section>
      </div>
    </Overlay>
  );
}
