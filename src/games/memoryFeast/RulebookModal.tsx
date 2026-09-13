"use client";

import Overlay from "@/components/Overlay";
import { DIFFICULTY_CONFIG, DIFFICULTY_LABEL, DIFFICULTY_ORDER, totalStock } from "./engine";

export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="📖 기억의 만찬 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80">
        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">
            배치 단계
          </h3>
          <p className="text-white/70">
            두 사람은 같은 접시 보드를 공유합니다. 라운드 N에는 그 라운드의 토큰 N개를 접시 하나에
            전부 올립니다(p1 먼저, p2가 이어서). <span className="text-amber-300">내가 놓은 개수는
            항상 보이지만</span>, 상대가 놓는 순간은 짧게만 보여지고 이후 다시 가려집니다 — 그
            개수를 기억해둬야 합니다. 같은 접시에 여러 라운드에 걸쳐 계속 쌓일 수 있고, 총합은
            따로 알려주지 않습니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">
            오픈(맞히기) 단계
          </h3>
          <p className="text-white/70">
            배치가 전부 끝나면 턴제로 전환됩니다. 내 차례에 접시 2개를 지정해 공개합니다. 두
            접시의 실제 총합(내가 넣은 개수 + 상대가 넣은 개수)이 같으면 <span className="text-emerald-300">매칭
            성공</span> — 그 총합만큼 내 개인 토큰 저장고에서 차감되고 연속으로 한 번 더 턴을
            얻습니다. 총합이 다르면 <span className="text-rose-300">매칭 실패</span> — 벌점이
            쌓이고 턴이 상대에게 넘어갑니다. 한 번 열어본 접시는 실패하더라도 나에게는 그 값을
            영구히 기억하게 됩니다(상대에게는 다시 가려짐).
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">
            승리 / 패배 조건
          </h3>
          <p className="text-white/70">
            내 저장고를 먼저 <span className="text-emerald-300">0개</span>로 만들면 즉시 승리합니다.
            반대로 매칭 실패 벌점이 난이도별 임계치 이상 쌓이면 즉시 패배합니다. 오픈 단계 제한
            시간을 넘기면 자동으로 1회 실패 처리됩니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">
            난이도
          </h3>
          <div className="grid gap-2 sm:grid-cols-3">
            {DIFFICULTY_ORDER.map((d) => {
              const cfg = DIFFICULTY_CONFIG[d];
              return (
                <div key={d} className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <p className="mb-1 font-medium text-white">{DIFFICULTY_LABEL[d]}</p>
                  <ul className="space-y-0.5 text-xs text-white/60">
                    <li>접시 {cfg.plateCount}개 · {cfg.totalRounds}라운드</li>
                    <li>저장고 {totalStock(d)}개</li>
                    <li>제한시간 {Math.round(cfg.timeLimitMs / 1000)}초</li>
                    <li>벌점 패배 {cfg.penaltyLossThreshold}회</li>
                    {cfg.allowMemoPad && <li className="text-amber-300">개인 메모장 사용 가능</li>}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </Overlay>
  );
}
