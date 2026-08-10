"use client";

import Overlay from "@/components/Overlay";

export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="🐎 말달리자 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80">
        <section>
          <p className="text-white/70">
            넷플릭스 예능 《데스게임》에 등장한 2인 전용 두뇌 게임입니다. 11×11 사막 보드에서
            각자 <span className="text-amber-300">말 10개</span>를 자기 진영(대각선 모서리 2곳,
            5개씩)에서 출발시켜, 내 말 중 하나라도{" "}
            <span className="text-amber-300">상대 진영에 먼저 도착</span>시키면 즉시 승리합니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">
            세팅 — 대각선 모서리 진영
          </h3>
          <p className="text-white/70">
            보드에는 대각선이 2개, 모서리가 4곳 있습니다. 한 플레이어가 대각선 하나를 통째로
            차지해 그 양 끝 모서리에 말을 5개씩 나눠 놓고 시작합니다 — 두 플레이어의 진영은
            서로 겹치지 않습니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">
            매 턴, 말 하나를 골라 두 이동 방식 중 하나를 선택
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="mb-1 font-medium text-white">➡️ 슬라이드 이동</p>
              <p className="text-xs text-white/60">
                상하좌우+대각선 8방향 중 하나로, 다른 말(내 말이든 상대 말이든)이나 보드판
                끝에 부딪혀 막힐 때까지 직선으로 끝까지 미끄러집니다. 중간에 멈춰 설 수
                없습니다.
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="mb-1 font-medium text-white">♞ L자 이동 (나이트)</p>
              <p className="text-xs text-white/60">
                체스 나이트와 동일한 L자 이동(직진 2칸+꺾어서 1칸). 다른 말을 뛰어넘을 수
                있지만, 착지 칸은 반드시 비어 있어야 합니다.
              </p>
            </div>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">
            승리 조건 & 길막기
          </h3>
          <p className="text-white/70">
            내 말 10개 중 <span className="text-amber-300">단 하나라도</span> 상대 진영(🏁
            표시) 칸에 정확히 착지하는 순간 즉시 승리합니다. 슬라이드 경로에 다른 말이 있으면
            그 바로 앞 칸에서 멈추는 걸 이용해 상대의 진로를 막을 수 있습니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">
            [하우스 룰] 단판 승부
          </h3>
          <p className="text-white/70">
            원작 방송은 3전 2선승제지만, 이 방은 단 1번의 라운드에서 상대 진영에 먼저 도착한
            사람이 즉시 최종 승자가 되는 <span className="text-rose-300">단판 승부</span> 모드로
            진행됩니다. 방장이 켜둔 경우, 턴마다 제한 시간(30초~1분)이 있으며 시간 내에 움직이지
            못하면 해당 턴이 자동으로 패스됩니다.
          </p>
        </section>
      </div>
    </Overlay>
  );
}
