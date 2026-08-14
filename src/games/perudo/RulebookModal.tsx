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
            셀 때는 실제 4의 개수 + 페루도(1)의 개수를 더합니다. 단, 팔라피코 라운드에서는 조커 기능이 사라집니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">선언 올리기</h3>
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-white/15 bg-white/[0.03] p-3">
              <p className="mb-1 font-medium text-white/90">일반(2~6) → 일반(2~6)</p>
              <p className="text-xs text-white/60">개수를 올리거나(숫자는 자유), 개수를 유지한 채 숫자만 더 높게.</p>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/[0.03] p-3">
              <p className="mb-1 flex items-center gap-1 font-medium text-white/90">
                일반 → 페루도 <PerudoFaceIcon className="h-3.5 w-3.5 text-red-400" />
              </p>
              <p className="text-xs text-white/60">필요 개수를 절반으로 (소수점 올림). 예: 5개 → 페루도 3개↑</p>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/[0.03] p-3">
              <p className="mb-1 flex items-center gap-1 font-medium text-white/90">
                페루도 <PerudoFaceIcon className="h-3.5 w-3.5 text-red-400" /> → 일반
              </p>
              <p className="text-xs text-white/60">필요 개수는 (페루도 개수 × 2) + 1. 예: 페루도 3개 → 숫자 7개↑</p>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/[0.03] p-3">
              <p className="mb-1 font-medium text-white/90">페루도 → 페루도</p>
              <p className="text-xs text-white/60">숫자는 그대로, 개수만 더 높게 올릴 수 있습니다.</p>
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
                <span className="text-white">차례와 상관없이</span> 아무 때나 외칠 수 있습니다. 정확히 일치하면 주사위 1개를
                되찾고(최대 5개), 틀리면 |실제 개수 − 선언 개수|개(절댓값 오차)를 한 번에 잃습니다. 팔라피코 라운드에서는
                사용할 수 없습니다.
              </p>
            </div>
          </div>
          <p className="mt-2 text-xs text-amber-300/80">
            ⚠️ 페널티를 받은 사람이 다음 라운드의 선(先)이 되어 모두 다시 굴립니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">⚠️ 팔라피코 (Palafico)</h3>
          <p className="text-white/70">
            선 플레이어의 주사위가 <span className="text-rose-300">딱 1개</span>가 되는 순간, 그 라운드는 특수 규칙이
            적용됩니다.
          </p>
          <ul className="mt-2 list-inside list-disc text-xs text-white/60">
            <li>페루도(1)의 조커 기능이 사라집니다 — 그냥 숫자 1로만 취급.</li>
            <li>선이 처음 선언한 숫자가 고정되고, 이후에는 개수만 올릴 수 있습니다.</li>
            <li>&quot;맞아!&quot;를 외칠 수 없습니다.</li>
          </ul>
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
