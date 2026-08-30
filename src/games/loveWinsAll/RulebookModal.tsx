"use client";

import Overlay from "@/components/Overlay";
import { ANTE_PER_ROUND, MAX_TIE_ROUNDS } from "./engine";

export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="💕 러브 윈즈 올 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80">
        <section>
          <p className="text-white/70">
            넷플릭스 예능 《데스게임》에 등장한{" "}
            <span className="text-pink-300">1:1 심리·배신 데스매치</span> 게임입니다. 두 플레이어가
            가림판 뒤에서 비공개로 <span className="text-rose-300">LOVE(협력)</span> 또는{" "}
            <span className="text-rose-300">WAR(배신)</span> 중 하나를 골라 동시에 공개하고, 그
            조합에 따라 단 한 번의 승부로 최종 승패가 갈리는 죄수의 딜레마 게임입니다.
          </p>
          <p className="mt-2 text-xs text-white/40">
            [확인된 하우스 결정] 룰북 원문은 인원수/라운드 구조를 두 가지로 병기하고 있어 세션 시작
            전 사용자와 직접 확인했습니다: 2인 전용(룰북 원문 그대로), 단판 승부 구조(하트/생명력
            게이지 없음), 둘 다 LOVE를 낸 무승부는 판돈을 이월하며 즉시 재경기, 이탈 플레이어의 AI
            봇은 신뢰를 쌓다가 배신 타이밍을 노리는 휴리스틱 전략을 사용합니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">
            비공개 선택 &amp; 동시 공개
          </h3>
          <p className="text-white/70">
            대화와 심리전 끝에 각자 가림판 뒤에서 LOVE 또는 WAR 카드를 내려놓습니다. 신호에 맞춰 두
            사람의 카드를 동시에 공개하는 쇼다운으로 넘어갑니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">
            선택 조합별 승패 판정
          </h3>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-3">
              <p className="mb-1 font-medium text-emerald-200">💚 LOVE + LOVE</p>
              <p className="text-xs text-white/60">
                아름다운 신뢰 — 무승부. 판돈이 다음 판으로 이월되며 즉시 재경기합니다.
              </p>
            </div>
            <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-3">
              <p className="mb-1 font-medium text-rose-200">💔 LOVE + WAR</p>
              <p className="text-xs text-white/60">
                일방적 배신 — WAR를 낸 쪽이 판돈 전부를 독식하며 그 즉시 단독 최종 승리합니다.
              </p>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/5 p-3">
              <p className="mb-1 font-medium text-white">💀 WAR + WAR</p>
              <p className="text-xs text-white/60">
                상호 파멸 — 둘 다 최종 패배(공동 탈락)하며 판돈은 아무에게도 돌아가지 않습니다.
              </p>
            </div>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">판돈</h3>
          <p className="text-white/70">
            매 판마다 {ANTE_PER_ROUND}점이 판돈에 쌓입니다. 무승부로 재경기가 이어질 때마다 판돈이
            또 쌓여 배신의 유혹이 점점 커집니다. 다만 계속 둘 다 LOVE만 선택할 경우 {MAX_TIE_ROUNDS}
            번째 무승부에서는 서로의 신뢰가 증명된 것으로 보아 자동으로 공동 승리 처리됩니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">
            핵심 심리 전략 팁
          </h3>
          <p className="text-white/70">
            완전히 상대의 신뢰를 얻어 상대가 100% LOVE를 내도록 만든 후, 자신은 WAR를 내어 단독
            승리를 챙기는 것이 가장 전형적인 승리법입니다. 반대로 내가 절대 LOVE를 내지 않을 것임을
            강하게 어필해 상대가 먼저 배신하지 못하게 압박하는 배짱 전략도 가능합니다.
          </p>
        </section>
      </div>
    </Overlay>
  );
}
