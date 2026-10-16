"use client";

import Overlay from "@/components/Overlay";
import { DIFFICULTY_LABEL, DIFFICULTY_ORDER, MAX_TOLERANCE, configFor, tokensPerPlayer } from "./engine";

export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="📖 기억의 만찬 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80">
        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">
            배치 단계
          </h3>
          <p className="text-white/70">
            두 사람은 같은 접시 보드를 공유합니다. 방을 만들 때 토큰 방식을 고릅니다 —{" "}
            <span className="text-amber-300">1개씩</span>(기본: 매 라운드 토큰 1개, 접시와 라운드가 더 많음) 또는{" "}
            <span className="text-amber-300">늘어나는 토큰</span>(원작: 라운드 N에 토큰 N개). 그 라운드의 토큰을 접시 하나에
            올립니다(p1 먼저, p2가 이어서). <span className="text-amber-300">내가 놓은 개수는
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
            성공</span> — 두 접시를 가져가 그 위의 토큰 전부가 내 점수가 되고, 연속으로 한 번 더
            턴을 얻습니다. 가져간 접시는 판에서 빠지고, 빈 접시(토큰 0개)는 고를 수 없습니다. 총합이 다르면 <span className="text-rose-300">매칭 실패</span> — 벌점이
            쌓이고 턴이 상대에게 넘어갑니다. 한 번 열어본 접시는 실패하더라도 나에게는 그 값을
            영구히 기억하게 됩니다(상대에게는 다시 가려짐).
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">
            한 끗 차이 단계
          </h3>
          <p className="text-white/70">
            총합이 같은 쌍이 더 없으면 바로 끝나지 않고 <span className="text-amber-300">한 끗 차이 단계</span>로
            넘어갑니다. 먼저 총합 차이 <span className="text-amber-300">±1</span>까지, 그래도 없으면{" "}
            <span className="text-amber-300">±{MAX_TOLERANCE}</span>까지 짝으로 인정합니다. 단계가 바뀔 때는{" "}
            <span className="text-sky-300">점수가 뒤진 사람</span>(동점이면 기다리던 사람)이 먼저 맞힙니다 — 연속
            턴으로 판이 한 번에 쓸려도 역전 기회가 남습니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">
            승리 / 패배 조건
          </h3>
          <p className="text-white/70">
            ±{MAX_TOLERANCE} 단계까지 짝이 하나도 남지 않으면 게임이 끝나고,{" "}
            <span className="text-emerald-300">점수가 높은 쪽</span>이 승리합니다(점수가 같으면 벌점이
            적은 쪽, 그것도 같으면 무승부). 매칭 실패 벌점이 난이도별 임계치 이상 쌓이면 즉시 패배합니다. 오픈 단계 제한
            시간을 넘기면 자동으로 1회 실패 처리됩니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">
            난이도
          </h3>
          <div className="grid gap-2 sm:grid-cols-3">
            {DIFFICULTY_ORDER.map((d) => {
              const single = configFor(d, "single");
              const cfg = configFor(d, "growing");
              return (
                <div key={d} className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <p className="mb-1 font-medium text-white">{DIFFICULTY_LABEL[d]}</p>
                  <ul className="space-y-0.5 text-xs text-white/60">
                    <li>
                      1개씩: 접시 {single.plateCount}개 · {single.totalRounds}라운드 (토큰 {tokensPerPlayer(d, "single")}개)
                    </li>
                    <li>
                      원작: 접시 {cfg.plateCount}개 · {cfg.totalRounds}라운드 (토큰 {tokensPerPlayer(d)}개)
                    </li>
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
