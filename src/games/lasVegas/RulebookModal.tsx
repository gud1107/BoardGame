"use client";

import Overlay from "@/components/Overlay";
import { DiceFace } from "./DiceIcon";
import { MIN_CASINO_TOTAL, NEUTRAL_DICE_TABLE } from "./engine";

const NEUTRAL_ROWS = [
  { count: "2인", perPlayer: NEUTRAL_DICE_TABLE[2].perPlayer, note: "개인 8개 + 중립 4개 = 12개" },
  { count: "3인", perPlayer: NEUTRAL_DICE_TABLE[3].perPlayer, note: "개인 8개 + 중립 2개(+시작 전 남은 중립 2개 선배치)" },
  { count: "4인", perPlayer: NEUTRAL_DICE_TABLE[4].perPlayer, note: "개인 8개 + 중립 2개 = 10개" },
  { count: "5인", perPlayer: NEUTRAL_DICE_TABLE[5].perPlayer, note: "개인 8개만 (중립 없음)" },
];

export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="📖 라스베가스 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80">
        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">목표</h3>
          <p className="text-white/70">
            1번부터 6번까지의 카지노에 주사위를 배치해 가장 높은 지폐를 차지하는 확률·심리전 게임입니다. 이 구현은{" "}
            <span className="text-amber-300">룰북 원문이 정식으로 채택한 단판(1라운드 완결) 모드</span>로 진행되며, 정산이 끝나는
            즉시 최종 승자가 가려집니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">세팅</h3>
          <ul className="list-disc space-y-1 pl-4 text-xs text-white/60">
            <li>1번~6번 카지노를 순서대로 늘어놓습니다.</li>
            <li>
              지폐 54장을 섞어 1번 카지노부터 차례대로 한 장씩 올리고, 그 카지노의 합계가{" "}
              <b>{money(MIN_CASINO_TOTAL)} 이상</b>이 될 때까지 계속 쌓습니다. 그다음 카지노로 넘어가 같은 방식으로 반복합니다.
              각 카지노에 쌓인 지폐는 금액이 높은 것이 맨 위로 오도록 정렬합니다.
            </li>
            <li>각 플레이어는 자신의 색상 주사위 8개를 받습니다. 인원수에 따라 중립(백색) 주사위가 추가됩니다.</li>
          </ul>
          <div className="mt-2 overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full min-w-[420px] border-collapse text-xs">
              <thead>
                <tr className="bg-white/5 text-white/50">
                  <th className="px-2 py-1.5 text-left">인원수</th>
                  <th className="px-2 py-1.5 text-left">1인당 중립 주사위</th>
                  <th className="px-2 py-1.5 text-left">비고</th>
                </tr>
              </thead>
              <tbody>
                {NEUTRAL_ROWS.map((row) => (
                  <tr key={row.count} className="border-t border-white/10">
                    <td className="px-2 py-1.5 font-semibold text-white/80">{row.count}</td>
                    <td className="px-2 py-1.5">{row.perPlayer}개</td>
                    <td className="px-2 py-1.5 text-white/50">{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">내 턴에 하는 일</h3>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-xl border border-white/15 bg-white/[0.03] p-3">
              <p className="mb-1 font-medium text-white/90">① 주사위 던지기</p>
              <p className="text-xs text-white/60">손에 남은 모든 주사위(개인+중립)를 한 번에 굴립니다.</p>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/[0.03] p-3">
              <p className="mb-1 font-medium text-white/90">② 숫자 하나 선택</p>
              <p className="text-xs text-white/60">굴린 눈금 중 단 하나의 숫자를 고릅니다.</p>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/[0.03] p-3">
              <p className="mb-1 font-medium text-white/90">③ 전량 배치</p>
              <p className="text-xs text-white/60">
                그 숫자가 나온 주사위 전부(개인+중립)를 해당 번호 카지노에 올립니다. 일부만 넣을 수 없습니다.
              </p>
            </div>
          </div>
          <p className="mt-2 text-xs text-white/60">
            주사위가 다 떨어진 플레이어는 자동으로 차례를 건너뜁니다. 모든 플레이어가 주사위를 전부 배치하면 즉시 정산에
            들어갑니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">정산 — 동률 상쇄 규칙 (핵심!)</h3>
          <p className="text-white/70">
            1번 카지노부터 순서대로 정산합니다. 카지노에 놓인 주사위 개수를 색상별(중립 포함)로 확인해{" "}
            <b>개수가 같은 색상들은 전부 무효화(상쇄)</b>되어 치워집니다.
          </p>
          <div className="my-2 flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-black/20 p-2 text-xs">
            <span className="text-white/60">예:</span>
            <DiceFace face={4} color="#ef4444" size="h-5 w-5" /> ×3
            <DiceFace face={4} color="#3b82f6" size="h-5 w-5" /> ×3
            <span className="text-rose-300">→ 둘 다 상쇄</span>
            <DiceFace face={4} color="#22c55e" size="h-5 w-5" /> ×1
            <DiceFace face={4} color="#9ca3af" size="h-5 w-5" /> ×1
            <span className="text-rose-300">→ 둘 다 상쇄</span>
          </div>
          <p className="text-white/70">
            상쇄되지 않고 남은 색상 중 <b>주사위 개수가 가장 많은</b> 쪽부터 그 카지노에서 가장 높은 지폐를 가져가고, 그다음
            많은 쪽이 다음 지폐를 가져가는 식으로 순서대로 나눠 갖습니다. 지폐보다 순위가 밀리면 아무것도 못 받습니다.{" "}
            <b>중립 주사위가 1등이 되면</b> 그 지폐는 누구도 갖지 못하고 버려집니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">최종 승리</h3>
          <p className="text-white/70">
            1번~6번 카지노 정산이 모두 끝나면 각자 획득한 지폐 금액을 합산합니다.{" "}
            <b>총상금이 가장 높은 플레이어가 승리</b>합니다. 총상금이 같다면 <b>지폐 장수가 더 많은 쪽</b>이 승리하며(작은 돈을
            여러 장 모은 쪽이 유리), 그마저 같다면 공동 승리로 처리합니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">전략 팁</h3>
          <ul className="list-disc space-y-1 pl-4 text-xs text-white/60">
            <li>물귀신 작전: 상대가 확실히 1등인 카지노에 똑같은 개수로 맞춰 넣어 상금을 통째로 무산시킬 수 있습니다.</li>
            <li>중립 주사위는 시한폭탄입니다 — 남의 몫을 무산시키거나 상금을 공중분해시키는 용도로 활용하세요.</li>
            <li>주사위를 아꼈다가 남들이 다 패스한 뒤 마지막에 원하는 카지노를 독식하는 후반 노림수도 가능합니다.</li>
          </ul>
        </section>
      </div>
    </Overlay>
  );
}

function money(v: number): string {
  return `$${v.toLocaleString("en-US")}`;
}
