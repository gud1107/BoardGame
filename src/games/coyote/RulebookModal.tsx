"use client";

import Overlay from "@/components/Overlay";
import { STARTING_HEARTS } from "./engine";

export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="📖 코요테(Coyote) 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80">
        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">목표</h3>
          <p className="text-white/70">
            모든 플레이어는 카드 1장을 <span className="text-amber-300">자신은 보지 못하게</span> 이마에 붙입니다. 남의 카드는
            전부 보이지만 내 카드만은 숨겨진 채, 테이블 전체 카드 숫자의 합을 두고 블러핑과 배팅을 겨룹니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">카드 구성 (총 36장)</h3>
          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full min-w-[420px] border-collapse text-xs">
              <thead>
                <tr className="bg-white/5 text-white/50">
                  <th className="px-2 py-1.5 text-left">카드</th>
                  <th className="px-2 py-1.5 text-left">효과</th>
                  <th className="px-2 py-1.5 text-right">장수</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-white/10">
                  <td className="px-2 py-1.5 font-semibold text-white/80">1 / 2 / 3 / 4 / 5 / 10 / 15 / 20</td>
                  <td className="px-2 py-1.5">그 숫자만큼 합산</td>
                  <td className="px-2 py-1.5 text-right">26장</td>
                </tr>
                <tr className="border-t border-white/10">
                  <td className="px-2 py-1.5 font-semibold text-white/80">0</td>
                  <td className="px-2 py-1.5">합산에 0으로 반영</td>
                  <td className="px-2 py-1.5 text-right">3장</td>
                </tr>
                <tr className="border-t border-white/10">
                  <td className="px-2 py-1.5 font-semibold text-white/80">-5 / -10</td>
                  <td className="px-2 py-1.5">합산에서 차감</td>
                  <td className="px-2 py-1.5 text-right">2장 / 1장</td>
                </tr>
                <tr className="border-t border-white/10">
                  <td className="px-2 py-1.5 font-semibold text-white/80">🌙 0 (선 교체)</td>
                  <td className="px-2 py-1.5">합산 0, 이 카드를 가진 사람이 다음 라운드의 선이 됩니다</td>
                  <td className="px-2 py-1.5 text-right">1장</td>
                </tr>
                <tr className="border-t border-white/10">
                  <td className="px-2 py-1.5 font-semibold text-white/80">🎁 ?</td>
                  <td className="px-2 py-1.5">덱 맨 위 카드를 추가로 공개해 합산 (또 나오면 계속 뽑음)</td>
                  <td className="px-2 py-1.5 text-right">1장</td>
                </tr>
                <tr className="border-t border-white/10">
                  <td className="px-2 py-1.5 font-semibold text-white/80">👧 MAX→0</td>
                  <td className="px-2 py-1.5">공개된 카드 중 가장 높은 숫자 1장을 0으로 무효화</td>
                  <td className="px-2 py-1.5 text-right">1장</td>
                </tr>
                <tr className="border-t border-white/10">
                  <td className="px-2 py-1.5 font-semibold text-white/80">🪶 ×2</td>
                  <td className="px-2 py-1.5">최종 합산 총합을 2배로</td>
                  <td className="px-2 py-1.5 text-right">1장</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">진행 순서</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-white/15 bg-white/[0.03] p-3">
              <p className="mb-1 font-medium text-white/90">① 숫자 선언하기</p>
              <p className="text-xs text-white/60">직전 선언보다 반드시 더 큰 숫자를 불러야 합니다.</p>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/[0.03] p-3">
              <p className="mb-1 font-medium text-white/90">② &quot;코요테!&quot; 외치기</p>
              <p className="text-xs text-white/60">직전 선언이 실제 총합보다 크다(오버했다)고 판단되면 외칩니다.</p>
            </div>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">정산 (§4)</h3>
          <ul className="list-disc space-y-1 pl-4 text-xs text-white/70">
            <li>
              실제 총합이 <b>선언한 숫자보다 작다</b> (오버 배팅) → <b>직전 선언자</b>가 벌점(하트 1개 상실).
            </li>
            <li>
              실제 총합이 <b>선언한 숫자 이상</b> (안전한 배팅) → <b>&quot;코요테!&quot;를 외친 사람</b>이 벌점(하트 1개 상실).
            </li>
          </ul>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">게임 종료</h3>
          <p className="text-white/70">
            하트를 {STARTING_HEARTS}개(벌점 토큰 {STARTING_HEARTS}개) 모두 잃으면 즉시 탈락합니다. 최후까지 살아남은 1명이
            최종 승리자입니다.
          </p>
        </section>
      </div>
    </Overlay>
  );
}
