"use client";

import Overlay from "@/components/Overlay";
import { MAX_COMMIT, MIN_COMMIT, STARTING_COINS } from "./engine";

export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="🪙 쇼미더코인 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80">
        <section>
          <p className="text-white/70">
            넷플릭스 예능 《데스게임》에 등장한{" "}
            <span className="text-pink-300">1:1 두뇌·베팅 심리전</span> 게임입니다. 두 플레이어가
            동일한 코인을 가지고 시작해, 매 라운드 가림판 뒤에서 비공개로 코인을 걸고 포커식
            베팅으로 판돈을 키운 뒤 동시에 공개해 더 많이 건 쪽이 판돈을 독식합니다. 상대의 코인을
            0개로 만들면 즉시 최종 승리하는 서바이벌 단판 승부입니다.
          </p>
          <p className="mt-2 text-xs text-white/40">
            [확인된 하우스 결정] 룰북 원문은 인원수/시작 코인 수를 명시하지 않아 세션 시작 전
            사용자와 직접 확인했습니다: 2인 전용(룰북 원문 그대로), 시작 코인{" "}
            {STARTING_COINS}개, 정해진 라운드 상한 없이 KO까지 무제한 진행, 동률 시 판돈은
            분할하지 않고 다음 라운드로 이월.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">
            1단계 · 비공개 배치
          </h3>
          <p className="text-white/70">
            라운드가 시작되면 각자 가림판 뒤에서 이번 라운드에 걸 코인을{" "}
            <span className="text-amber-300">
              {MIN_COMMIT}개~{MAX_COMMIT}개
            </span>{" "}
            사이에서 비공개로 정합니다. 이 코인은 즉시 판돈(팟)에 투입되며, 서로 상대가 얼마를
            냈는지 알 수 없는 상태로 다음 단계로 넘어갑니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">
            2단계 · 베팅 (콜 · 레이즈 · 폴드)
          </h3>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="mb-1 font-medium text-white">✅ 콜 / 체크</p>
              <p className="text-xs text-white/60">상대가 제시한 베팅액을 동일하게 맞춥니다(맞출 코인이 없으면 체크).</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="mb-1 font-medium text-white">🔺 레이즈</p>
              <p className="text-xs text-white/60">상대보다 더 많은 코인을 걸어 판돈을 키웁니다. 남은 코인만큼만 걸 수 있습니다.</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="mb-1 font-medium text-white">🏳️ 폴드</p>
              <p className="text-xs text-white/60">승부를 포기하고 이번 라운드 판돈을 상대에게 그대로 내줍니다. 내가 낸 코인 수는 공개되지 않습니다.</p>
            </div>
          </div>
          <p className="mt-2 text-xs text-white/40">
            둘 다 체크(또는 콜)하면 베팅이 종료되고 3단계 공개로 넘어갑니다. 남은 코인보다 많이
            걸 수는 없으며(자연스러운 올인 한도), 콜할 코인이 모자라면 가진 만큼만 내는
            &ldquo;콜 for less&rdquo;가 허용됩니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">
            3단계 · 공개 (쇼다운)
          </h3>
          <p className="text-white/70">
            두 플레이어가 1단계에서 낸 코인 개수를 동시에 공개합니다. 더 많이 낸 쪽이 판돈 전부를
            가져갑니다. 동률이면 이번 판돈은 분배되지 않고 그대로 다음 라운드로 이월됩니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">
            최종 승리 조건
          </h3>
          <p className="text-white/70">
            상대방의 코인을 전량 소진시키면(0개) 그 즉시 최종 승리합니다. 정해진 라운드 수 제한은
            없으며, 둘 중 한쪽이 코인을 모두 잃을 때까지 라운드가 계속됩니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">블러핑 팁</h3>
          <p className="text-white/70">
            내 코인 수가 적어도 강하게 레이즈를 던져 상대의 폴드를 유도할 수 있습니다. 반대로
            초반에 코인을 무리하게 소진하면 후반 방어가 어려워지니, 페이스 조절이 핵심입니다.
          </p>
        </section>
      </div>
    </Overlay>
  );
}
