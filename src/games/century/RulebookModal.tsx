"use client";

import Overlay from "@/components/Overlay";
import ResourceIcon from "./ResourceIcon";

export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="📖 센추리: 향신료의 길 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80">
        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">목표</h3>
          <p className="text-white/70">
            향신료 상인이 되어 자원을 생산·업그레이드·교환해 점수 카드를 모으세요.{" "}
            <span className="text-amber-300">누군가 점수 카드 목표치를 채우면</span> 그 라운드의 마지막 플레이어까지
            진행한 뒤 게임이 끝나며, 최종 점수가 가장 높은 사람이 승리합니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">자원 가치 순서</h3>
          <div className="flex flex-wrap items-center gap-2">
            <ResourceIcon resource="yellow" className="h-6 w-6" /> <span>노란색(심지)</span>
            <span className="text-white/40">&lt;</span>
            <ResourceIcon resource="red" className="h-6 w-6" /> <span>빨간색(홍화)</span>
            <span className="text-white/40">&lt;</span>
            <ResourceIcon resource="green" className="h-6 w-6" /> <span>초록색(카다멈)</span>
            <span className="text-white/40">&lt;</span>
            <ResourceIcon resource="brown" className="h-6 w-6" /> <span>갈색(시나몬)</span>
          </div>
          <p className="mt-1 text-xs text-white/50">
            업그레이드는 이 순서대로 한 단계씩 자원을 승급시킵니다 (갈색은 최고 등급이라 더 올릴 수 없음).
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">내 차례에 할 수 있는 4가지 행동 — 정확히 1가지만</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-white/15 bg-white/[0.03] p-3">
              <p className="mb-1 font-medium text-white/90">🎴 카드 사용 (Play)</p>
              <p className="text-xs text-white/60">
                손패의 상인 카드 1장을 내려놓고 효과 실행: <b>생산</b>(자원 획득), <b>업그레이드</b>(자원 승급, 여러
                번 나눠 쓰거나 한 자원을 여러 단계 올릴 수 있음), <b>교환</b>(비용을 내고 자원 획득 — 자원이 있는 한
                한 턴에 여러 번 반복 가능).
              </p>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/[0.03] p-3">
              <p className="mb-1 font-medium text-white/90">🛒 상인 카드 획득 (Acquire)</p>
              <p className="text-xs text-white/60">
                공개된 6장 중 1장을 가져옵니다. 맨 왼쪽(0번)은 무료, N번째 카드는 그 앞 카드들 위에 자원을 1개씩
                올려야 하며 그 카드들 위에 쌓인 자원도 함께 가져갑니다.
              </p>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/[0.03] p-3">
              <p className="mb-1 font-medium text-white/90">😴 휴식 (Rest)</p>
              <p className="text-xs text-white/60">이미 사용한 카드를 전부 손으로 회수합니다.</p>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/[0.03] p-3">
              <p className="mb-1 font-medium text-white/90">🏆 점수 카드 완성 (Claim)</p>
              <p className="text-xs text-white/60">
                요구 자원을 지불하고 점수 카드를 가져옵니다. 1번째 칸은 <b>금화</b>(3점), 2번째 칸은 <b>은화</b>
                (1점)를 함께 받습니다.
              </p>
            </div>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">수레 제한</h3>
          <p className="text-white/70">
            턴이 끝날 때 자원이 <span className="text-rose-300">10개를 넘으면</span> 원하는 색을 골라 10개가 될 때까지
            반드시 버려야 합니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">게임 종료 및 최종 점수</h3>
          <p className="text-white/70">
            누군가 점수 카드 목표치(4~5인 5장 / 2~3인 6장)를 모으면, 마지막 플레이어까지 턴을 마친 뒤 게임이
            끝납니다. 최종 점수 = 점수 카드 합 + 금화×3 + 은화×1 + (노란색 제외) 잔여 자원 개수. 동점이면 마지막에
            턴을 진행한 플레이어가 승리합니다.
          </p>
        </section>
      </div>
    </Overlay>
  );
}
