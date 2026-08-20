"use client";

import Overlay from "@/components/Overlay";
import PerudoFaceIcon from "./PerudoFaceIcon";

export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="📖 페루도 룰북" onClose={onClose}>
      <div className="flex flex-col gap-5 text-sm text-white/80">
        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">목표</h3>
          <p className="text-white/70">
            각자 주사위 5개로 시작합니다. 자신의 주사위는 나에게만 보이고 남에게는 숨긴 채로, 다른 플레이어의 선언을 의심하거나 넘겨서
            주사위를 잃게 만드세요. <span className="text-amber-300">끝까지 주사위를 지킨 마지막 1인</span>이 승리합니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-white/50 uppercase">
            핵심 규칙: 페루도 <PerudoFaceIcon className="h-4 w-4 text-red-400" /> (1번 눈)
          </h3>
          <p className="text-white/70">
            주사위 눈금 1은 <span className="text-amber-300">페루도</span>라고 부릅니다.{" "}
            <span className="text-amber-300">2~6 모든 숫자로 조커처럼 합산</span>됩니다. 예: &quot;4가 5개&quot;를
            셀 때는 실제 4의 개수 + 페루도(1)의 개수를 더합니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">선언 올리기</h3>
          <p className="mb-2 text-xs text-white/60">
            다음 선언은 반드시 직전 선언보다 <span className="text-amber-300">더 강해야</span> 합니다:{" "}
            <span className="text-amber-300">개수를 늘리면 눈금은 무엇이든 자유롭게</span> 고를 수 있고, 개수를 그대로 둔다면{" "}
            <span className="text-amber-300">눈금을 반드시 더 높은 쪽으로만</span> 올릴 수 있습니다 — 예: &quot;5가 3개&quot;
            다음에는 같은 3개로 눈금 2·3·4·5로는 갈 수 없고 오직 6으로만 갈 수 있으며, 개수를 4개 이상으로 늘리면 눈금은 다시
            자유입니다. 보드 위 트랙 칸(개수를 따라 나열된 숫자/[페루도 N] 칸)은 이 규칙을 보여주는 시각 요소일 뿐{" "}
            <span className="text-amber-300">칸 위치 자체가 유효성을 정하지는 않습니다</span> — 클릭해서 바로 그 개수로
            이동할 수 있는 보조 수단입니다.
          </p>
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-white/15 bg-white/[0.03] p-3">
              <p className="mb-1 font-medium text-white/90">일반 눈금(2~6) ↔ 일반 눈금</p>
              <p className="text-xs text-white/60">개수가 늘면 눈금 자유, 개수가 같으면 눈금은 반드시 더 높아야 합니다.</p>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/[0.03] p-3">
              <p className="mb-1 flex items-center gap-1 font-medium text-white/90">
                <PerudoFaceIcon className="h-3.5 w-3.5 text-red-400" /> 페루도(눈금 1) 전환
              </p>
              <p className="text-xs text-white/60">
                일반→페루도는 개수 <span className="text-amber-300">⌈직전 개수 ÷ 2⌉</span> 이상, 페루도→일반은 개수{" "}
                <span className="text-amber-300">직전 개수 × 2 + 1</span> 이상이어야 합니다. 페루도→페루도는 개수가 반드시
                더 커야 합니다.
              </p>
            </div>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">액션</h3>
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-rose-400/30 bg-rose-400/10 p-3">
              <p className="mb-1 font-medium text-rose-200">🚨 페루도! (의심)</p>
              <p className="text-xs text-white/60">
                자기 차례에만 외칠 수 있습니다. 모두 주사위를 공개해 앞 선언과 비교합니다. 실제 개수가{" "}
                <span className="text-white">선언보다 적으면 직전 선언자</span>가 [선언 개수 − 실제 개수]개를, 선언 이상이면{" "}
                <span className="text-white">의심한 사람</span>이 [실제 개수 − 선언 개수 + 1]개를 잃습니다 — 틀린 차이만큼
                차등으로 잃는 페널티입니다.
              </p>
            </div>
            <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-3">
              <p className="mb-1 font-medium text-emerald-200">🎯 맞아! (정확히 일치)</p>
              <p className="text-xs text-white/60">
                <span className="text-white">차례와 상관없이</span> 아무 때나 외칠 수 있습니다. 정확히 일치하면 주사위 1개를{" "}
                <span className="text-white">되찾습니다(개수 제한 없음)</span>, 틀리면 |실제 개수 − 선언 개수|개(절댓값 오차)를
                한 번에 잃습니다.
              </p>
            </div>
          </div>
          <p className="mt-2 text-xs text-amber-300/80">
            ⚠️ 페널티를 받은 사람이 다음 라운드의 선(先)이 되어 모두 다시 굴립니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">게임 종료</h3>
          <p className="text-white/70">
            주사위를 모두 잃으면 탈락합니다. 마지막까지 남은 1인이 우승하며, 다른 플레이어의 순위는 탈락한 순서의
            역순(늦게 탈락할수록 높은 순위)으로 매겨집니다.
          </p>
        </section>
      </div>
    </Overlay>
  );
}
