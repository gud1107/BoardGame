"use client";

import Overlay from "@/components/Overlay";
import { PLAYER_SETUP } from "./engine";

export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="📖 포세일(For Sale) 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80">
        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">목표</h3>
          <p className="text-white/70">
            부동산 중개인이 되어 두 단계로 겨룹니다. <span className="text-sky-300">1단계: 매수</span>에서는 부동산
            카드를 경매로 최대한 저렴하게 확보하고, <span className="text-emerald-300">2단계: 매도</span>에서는
            확보한 부동산을 팔아 수표(돈)를 얻습니다. 수표 총액과 남은 동전을 합쳐 가장 부유한 사람이 승리합니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">구성품</h3>
          <ul className="list-disc space-y-1 pl-4 text-xs text-white/70">
            <li>부동산 카드 30장 (1~30번, 숫자가 높을수록 좋은 부동산)</li>
            <li>수표 카드 30장 ($0~$14,000, $1,000 단위로 각 2장씩)</li>
            <li>동전 토큰 ($1,000 / $2,000 단위)</li>
          </ul>
          <div className="mt-2 overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full min-w-[380px] border-collapse text-xs">
              <thead>
                <tr className="bg-white/5 text-white/50">
                  <th className="px-2 py-1.5 text-left">인원</th>
                  <th className="px-2 py-1.5 text-right">시작 자금</th>
                  <th className="px-2 py-1.5 text-right">사용 카드 수</th>
                  <th className="px-2 py-1.5 text-right">1인당 카드</th>
                </tr>
              </thead>
              <tbody>
                {[3, 4, 5, 6].map((n) => (
                  <tr key={n} className="border-t border-white/10">
                    <td className="px-2 py-1.5 font-semibold text-white/80">{n}명</td>
                    <td className="px-2 py-1.5 text-right">${PLAYER_SETUP[n].cash.toLocaleString()}</td>
                    <td className="px-2 py-1.5 text-right">{PLAYER_SETUP[n].cardsUsed}장</td>
                    <td className="px-2 py-1.5 text-right">{PLAYER_SETUP[n].cardsUsed / n}장</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">1단계: 부동산 경매</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-white/15 bg-white/[0.03] p-3">
              <p className="mb-1 font-medium text-white/90">💰 입찰(Bid)</p>
              <p className="text-xs text-white/60">현재 입찰가보다 최소 $1,000 이상 높은 금액을 부릅니다.</p>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/[0.03] p-3">
              <p className="mb-1 font-medium text-white/90">🙅 포기(Pass)</p>
              <p className="text-xs text-white/60">
                내가 마지막으로 불렀던 입찰금의 절반(가장 가까운 $1,000 단위로 내림)을 내고, 바닥에 남은 카드 중{" "}
                <b>가장 낮은 번호</b>를 가져갑니다. 한 번도 입찰하지 않았다면 $0을 내고 가져갑니다.
              </p>
            </div>
          </div>
          <p className="mt-2 text-xs text-white/60">
            마지막까지 남은 1명은 자신이 불렀던 입찰금 전액을 내고, 남아있는 <b>가장 높은 번호</b>의 부동산을
            가져갑니다. 이 사람이 다음 라운드의 시작 플레이어가 됩니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">2단계: 수표 판매</h3>
          <p className="text-xs text-white/60">
            모든 플레이어가 자신의 부동산 카드 중 1장을 <b>뒷면으로 동시에</b> 제출합니다. 모두 제출하면 일제히
            공개하여, 가장 높은 번호의 부동산을 낸 사람부터 가장 높은 금액의 수표를 차례로 가져갑니다. 제출한
            부동산 카드는 소멸합니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">최종 점수 계산</h3>
          <ul className="list-disc space-y-1 pl-4 text-xs text-white/70">
            <li>모은 수표 금액을 모두 더합니다.</li>
            <li>1단계에서 쓰지 않고 남은 동전을 그대로 더합니다.</li>
            <li>
              총합(수표 + 남은 동전)이 가장 높은 사람이 승리 — 동점이면 <b>남은 동전이 더 많은 쪽</b>이 승리,
              그마저 같으면 공동 승리입니다.
            </li>
          </ul>
        </section>
      </div>
    </Overlay>
  );
}
