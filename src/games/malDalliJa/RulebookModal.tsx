"use client";

import Overlay from "@/components/Overlay";

export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="🐎 말달리자 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80">
        <section>
          <p className="text-white/70">
            넷플릭스 예능 《데스게임》에 등장한 2인 전용 두뇌 게임입니다. 11×11 사막 보드의
            <span className="text-amber-300"> 4개 모서리</span>에서 각자 말{" "}
            <span className="text-amber-300">10개</span>(모서리당 5개, 대각선으로 마주보는
            두 모서리를 한 진영이 소유)를 출발시켜, 보드 정중앙의{" "}
            <span className="text-sky-300">🔵 오아시스</span> 칸에 자신의 말 1개를 먼저
            정확히 착지시키면 즉시 승리합니다.
          </p>
          <p className="mt-2 text-xs text-white/40">
            [하우스 룰] 룰북 원문은 &ldquo;플레이어당 말 1개&rdquo;지만, 이 방은 제공된 보드판 이미지(
            말달리자판.png) 기준으로 4개 모서리에 말 5개씩(모서리당) 배치되는 세팅을
            채택했습니다. 슬라이드 이동은 아래 [하우스 룰]대로 상하좌우 4방향으로 제한되며, 그
            외 이동 규칙(§3 L자 이동/§4)은 룰북 원문 그대로입니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">
            매 턴, 말 1개를 골라 두 이동 방식 중 하나를 선택
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="mb-1 font-medium text-white">➡️ 슬라이드 이동</p>
              <p className="text-xs text-white/60">
                상하좌우 4방향 중 하나로, 다른 말(내 말/상대 말 모두)이나 보드판 끝에 부딪혀
                막힐 때까지 직선으로 끝까지 미끄러집니다. 중간에 멈춰 설 수 없습니다. 오아시스
                칸에 정확히 멈춰야 승리로 인정되며, 지나쳐 가는 것은 승리가 아닙니다.{" "}
                <span className="text-white/40">
                  [하우스 룰] 룰북 원문은 대각선 4방향을 포함한 8방향이지만, 이 방은 대각선
                  슬라이드를 금지하는 하우스 룰을 적용합니다.
                </span>
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
            [하우스 룰] 오아시스 구역 L자 이동 제약{" "}
            <span className="text-white/30 normal-case">(룰북 원문에는 없는 추가 규칙)</span>
          </h3>
          <p className="text-white/70">
            보드 정중앙의 <span className="text-sky-300">🔵 오아시스</span> 칸과 그 주변을
            감싸는 <span className="text-emerald-300">🟢 초록 구역</span>(중앙에서 십자·대각
            방향으로 2칸 이내, 총 13칸 다이아몬드)에서는 L자(나이트) 이동을 전혀 쓸 수
            없습니다 — 그 구역 위에 있는 말이거나, 착지 지점이 구역 안이거나, L자 경로가 구역을
            지나기만 해도 그 이동 자체가 차단됩니다. 오아시스 구역 안팎으로 이동하려면 반드시{" "}
            <span className="text-amber-300">슬라이드 이동</span>만 사용해야 하며, 오아시스에
            입성하려면 슬라이드로 정확히 멈춰야 합니다. 구역 밖 일반 칸에서는 L자 이동에 아무
            제약이 없습니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">
            길막기 전략
          </h3>
          <p className="text-white/70">
            슬라이드 이동 중 다른 말(내 말이든 상대 말이든)이 경로상에 있으면 그 바로 앞 칸에서
            멈춥니다. 이를 이용해 상대의 직선 경로를 방해하거나, 반대로 내 이동의 발판으로 삼을
            수 있습니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">
            [하우스 룰] 단판 승부
          </h3>
          <p className="text-white/70">
            원작 방송은 3전 2선승제지만, 이 방은 단 1번의 라운드에서 오아시스에 먼저 입성한
            사람이 즉시 최종 승자가 되는 <span className="text-rose-300">단판 승부</span> 모드로
            진행됩니다. 방장이 켜둔 경우, 턴마다 제한 시간(30초~1분)이 있으며 시간 내에 움직이지
            못하면 해당 턴이 자동으로 패스됩니다.
          </p>
        </section>
      </div>
    </Overlay>
  );
}
