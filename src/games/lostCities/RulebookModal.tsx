"use client";

import Overlay from "@/components/Overlay";
import { EXPEDITION_THEME, COLORS } from "./engine";

export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="🗺️ 로스트 시티 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80">
        <section>
          <p className="text-white/70">
            라이너 크니치아의 2인 전용 탐험 카드 게임. 5개의 미지의 지역으로 원정을 떠나 카드를
            오름차순으로 쌓아 올리되, 원정을 시작하는 순간 기본 -20점의 비용이 발생하므로 충분한
            수익이 날 원정에만 뛰어들어야 합니다.
          </p>
          <p className="mt-2 text-xs text-white/40">
            [하우스 룰] 룰북 원문(§7)은 3라운드 누적 점수제가 정식 규칙이지만, 이 방은 이 저장소의
            다른 온라인 카드 게임들과 동일하게 <span className="text-emerald-300">단판 승부</span>{" "}
            (1회 플레이 후 즉시 결과) 방식으로 진행됩니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">5개 원정로</h3>
          <div className="grid grid-cols-5 gap-1.5 text-center text-[11px]">
            {COLORS.map((color) => (
              <div key={color} className="rounded-lg border border-white/10 bg-white/5 py-2">
                <div className="text-lg">{EXPEDITION_THEME[color].emoji}</div>
                <div className="text-white/60">{EXPEDITION_THEME[color].name}</div>
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-white/40">색상별 12장(투자 카드 3장 + 숫자 2~10 각 1장), 총 60장.</p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">매 턴 2단계 필수 행동</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="mb-1 font-medium text-white">1️⃣ 내거나 버리기</p>
              <p className="text-xs text-white/60">
                손패 1장을 자신의 원정로에 <span className="text-emerald-300">오름차순</span>으로
                놓거나(건너뛰기 가능, 예: 4 다음 7), 중앙의 같은 색 버림 더미에 버립니다. 🤝 투자
                카드는 그 색 숫자 카드를 놓기 전까지만(최대 3장) 놓을 수 있습니다.
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="mb-1 font-medium text-white">2️⃣ 보충하기</p>
              <p className="text-xs text-white/60">
                덱에서 1장을 뽑거나, 5개 버림 더미 중 원하는 곳의 맨 위 카드를 가져와 손패를 다시
                8장으로 채웁니다. 단, 방금 1단계에서 자신이 버린 카드는 같은 턴에 즉시 다시 가져올
                수 없습니다.
              </p>
            </div>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">게임 종료 &amp; 점수</h3>
          <p className="text-white/70">덱의 마지막 카드를 누군가 뽑는 즉시 게임이 끝납니다. 원정로별 점수:</p>
          <p className="mt-1 rounded-lg bg-black/30 px-3 py-2 font-mono text-xs text-emerald-200">(숫자 합계 − 20) × (투자 카드 수 + 1) + (8장 이상이면 +20)</p>
          <p className="mt-1.5 text-xs text-white/40">카드를 한 장도 놓지 않은 원정로는 0점(감점 없음).</p>
        </section>
      </div>
    </Overlay>
  );
}
