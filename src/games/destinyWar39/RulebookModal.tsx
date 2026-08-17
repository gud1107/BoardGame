"use client";

import Overlay from "@/components/Overlay";
import { PLAYER_COUNT, TOTAL_ROUNDS } from "./engine";

export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="📖 운명전쟁39 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80">
        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">목표</h3>
          <p className="text-white/70">
            매 라운드 자신이 몇 번 승리할지 예측하고, 실제 승수가 정확히 그 예측과 일치해야 점수를 얻습니다.
            <span className="text-fuchsia-300"> 많이 이기는 게 아니라, 정확히 예측한 만큼만 이기는 것</span>이 핵심입니다.
            {PLAYER_COUNT}인 고정, 총 {TOTAL_ROUNDS}라운드로 진행됩니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">카드 구성 (총 45장)</h3>
          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full min-w-[380px] border-collapse text-xs">
              <thead>
                <tr className="bg-white/5 text-white/50">
                  <th className="px-2 py-1.5 text-left">카드</th>
                  <th className="px-2 py-1.5 text-left">비고</th>
                  <th className="px-2 py-1.5 text-right">장수</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-white/10">
                  <td className="px-2 py-1.5 font-semibold text-white/80">0</td>
                  <td className="px-2 py-1.5">가장 약해 보이지만, 특정 조건에서 가장 강함</td>
                  <td className="px-2 py-1.5 text-right">5장</td>
                </tr>
                <tr className="border-t border-white/10">
                  <td className="px-2 py-1.5 font-semibold text-white/80">1 ~ 39</td>
                  <td className="px-2 py-1.5">숫자가 클수록 강함 (11 / 22 / 33은 리버스 카드 겸용)</td>
                  <td className="px-2 py-1.5 text-right">각 1장</td>
                </tr>
                <tr className="border-t border-white/10">
                  <td className="px-2 py-1.5 font-semibold text-white/80">💀 데스카드</td>
                  <td className="px-2 py-1.5">평소 가장 강한 카드</td>
                  <td className="px-2 py-1.5 text-right">1장</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-white/50">매 라운드 시작 시 45장 전체를 다시 섞어 배분합니다. 사용된 카드도 폐기되지 않고 다음 라운드에 다시 등장할 수 있습니다.</p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">라운드 구조 — &quot;라운드 R은 R장, R턴&quot;</h3>
          <p className="text-white/70">
            라운드 번호가 R이면, 각자 카드 <b>R장</b>을 받고 그 라운드는 <b>R번의 턴</b>으로 진행됩니다. (1라운드=1턴, 2라운드=2턴 … 9라운드=9턴)
            각 턴마다 5명이 카드를 1장씩 내고 승부해 그 턴의 승자를 정하며, 한 라운드의 <b>실제 승수</b>는 그 라운드에서 이긴 턴의 개수(0~R)입니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">카드 공개 순서</h3>
          <ul className="list-disc space-y-1 pl-4 text-xs text-white/70">
            <li>1라운드: 5명 전원 동시 공개 (선/후공 없음)</li>
            <li>2라운드부터: 그 턴의 승자가 곧바로 다음 턴의 선공이 되고, 이후 좌석 순서(시계방향)로 공개</li>
            <li>2라운드부터는 그 라운드에 받은 손패 중 원하는 카드를 자유롭게 골라 낼 수 있습니다</li>
          </ul>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">승부 판정</h3>
          <ul className="list-disc space-y-1 pl-4 text-xs text-white/70">
            <li>그 턴에 나온 5장 중 리버스 카드(11/22/33) 개수가 <b>홀수</b>면 리버스 활성(작은 숫자 승리), <b>짝수</b>면 비활성(큰 숫자 승리)</li>
            <li>
              리버스 <b>비활성</b>: 0 카드가 있으면 <b>0이 데스카드까지 포함해 무조건 승리</b>. 0이 없으면 데스카드가 있으면 데스카드 승리, 없으면 가장 큰 숫자 승리
            </li>
            <li>
              리버스 <b>활성</b>: 데스카드가 있으면 <b>데스카드가 0까지 포함해 무조건 승리</b>. 데스카드가 없으면 가장 작은 숫자 승리(0이 가장 강함)
            </li>
            <li>0 카드끼리 동률이면 그 턴(1라운드는 무작위 고정 좌석 순서 기준)에서 먼저 낸 사람이 승리</li>
          </ul>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">예측 &amp; 히든</h3>
          <ul className="list-disc space-y-1 pl-4 text-xs text-white/70">
            <li>매 라운드 시작 시(손패 확인 후) 그 라운드의 예측 승수(0~R)를 새로 선언합니다. 이전 라운드 예측과는 무관합니다</li>
            <li>히든은 게임 전체에서 <b>딱 1회</b>, 원하는 라운드에 사용할 수 있습니다 — 예측은 정상적으로 확정하되 다른 플레이어에게만 숨깁니다</li>
            <li>히든으로 숨긴 예측값은 9라운드가 모두 끝난 뒤에 공개됩니다</li>
          </ul>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">점수 산식</h3>
          <div className="rounded-xl border border-white/15 bg-white/[0.03] p-3 text-xs text-white/70">
            <p>
              예측 <b>P</b> ≥ 1: 성공 → <b>+P×2</b> / 실패 → <b>-|P-A|×2</b>
            </p>
            <p className="mt-1">
              예측 <b>P</b> = 0: 성공(A=0) → <b>+R</b> / 실패(A&gt;0) → <b>-R</b> (R=라운드 번호)
            </p>
            <p className="mt-1 text-white/50">9라운드 각각의 점수를 모두 합산한 값이 최종 점수입니다.</p>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">게임 종료</h3>
          <p className="text-white/70">
            9라운드 종료 후 최종 점수가 가장 높은 플레이어가 승리합니다. 점수가 같으면 공동 등수로 처리하며 별도의 타이브레이커는 없습니다.
          </p>
        </section>
      </div>
    </Overlay>
  );
}
