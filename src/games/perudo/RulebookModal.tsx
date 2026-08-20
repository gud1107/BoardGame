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
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">선언 올리기 — 보드 트랙</h3>
          <p className="mb-2 text-xs text-white/60">
            2026-08-19 개편: 이제 모든 선언은 보드 위에 그려진 <span className="text-amber-300">고정된 한 줄짜리 트랙</span>(1 →
            [페루도1] → 2 → 3 → [페루도2] → 4 → ... → [페루도10] → 20, 총 37칸)의 한 칸에 대응합니다. 다음 선언은{" "}
            <span className="text-amber-300">반드시 지금 선언이 놓인 칸보다 트랙 상 더 뒤에 있는 칸</span>이어야 하며, 같거나
            이전 칸으로는 절대 되돌아갈 수 없습니다(역행 차단). 숫자 라벨 자체는 커졌다 작아지는 구간이 있지만, 유효성은 오직{" "}
            <span className="text-amber-300">트랙 상의 위치</span>로만 판정됩니다 — 예: 트랙이 &quot;...6 → 7 → 4 → [페루도4]...&quot;
            순서라면, 7 다음에 숫자만 보면 더 작아 보이는 4라도 트랙 상 아직 지나지 않은 뒤 칸이므로 유효한 선언입니다.
          </p>
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-white/15 bg-white/[0.03] p-3">
              <p className="mb-1 font-medium text-white/90">일반 숫자 칸(2~6 눈금)</p>
              <p className="text-xs text-white/60">칸에 적힌 개수로, 2~6 중 원하는 눈금을 자유롭게 선택해 선언합니다.</p>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/[0.03] p-3">
              <p className="mb-1 flex items-center gap-1 font-medium text-white/90">
                <PerudoFaceIcon className="h-3.5 w-3.5 text-red-400" /> [페루도 N] 칸
              </p>
              <p className="text-xs text-white/60">
                페루도(눈금 1)는 오직 트랙에 표시된 [페루도 N] 칸으로만 선언할 수 있습니다 — 자유롭게 개수를 고를 수 없습니다.
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
