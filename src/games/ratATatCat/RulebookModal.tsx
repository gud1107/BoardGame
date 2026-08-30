"use client";

import Overlay from "@/components/Overlay";

export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="🐱 랫어탯캣 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80">
        <section>
          <p className="text-white/70">
            쥐(높은 숫자/벌점)를 피하고 고양이(낮은 숫자/득점)를 모아, 자신의 카드 4장 숫자 합을
            최대한 낮추는 기억력·블러핑 카드 게임. 카드 위치와 값을 기억하고, 특수 능력 카드로
            엿보거나 바꿔치기하며 가장 낮은 점수를 노려보세요.
          </p>
          <p className="mt-2 text-xs text-white/40">
            [하우스 룰] 룰북 §6은 다회 라운드 누적 승점제도 언급하지만, 이 방은 이 저장소의 다른
            온라인 카드 게임들과 동일하게 <span className="text-emerald-300">단판 승부</span>{" "}
            (1회 플레이 후 즉시 결과) 방식으로 진행됩니다. &ldquo;랫어탯캣!&rdquo;을 외친 사람이 결과적으로
            최저점이 아니어도 <span className="text-emerald-300">별도 페널티는 없습니다</span> —
            그냥 카드 합이 가장 낮은 사람이 승리합니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">카드 구성 (총 54장)</h3>
          <div className="grid grid-cols-2 gap-1.5 text-center text-[11px] sm:grid-cols-4">
            <div className="rounded-lg border border-white/10 bg-white/5 py-2">
              <div className="text-lg">🐱 0-8</div>
              <div className="text-white/60">각 4장 (36장)</div>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/5 py-2">
              <div className="text-lg">🐭 9</div>
              <div className="text-white/60">9장</div>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/5 py-2">
              <div className="text-lg">🔎 엿보기</div>
              <div className="text-white/60">3장</div>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/5 py-2">
              <div className="text-lg">🔄 바꾸기</div>
              <div className="text-white/60">3장</div>
            </div>
          </div>
          <p className="mt-1.5 text-xs text-white/40">2️⃣ 두 번 뽑기 3장 포함, 특수 카드 총 9장.</p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">시작 세팅</h3>
          <p className="text-white/70">
            각자 4장을 뒷면으로 받아 1~4번 자리에 늘어놓고, 시작 전 딱 한 번{" "}
            <span className="text-emerald-300">양 끝(1, 4번)</span>만 몰래 확인한 뒤 다시 뒤집습니다.
            가운데 2장(2, 3번)은 능력을 쓰기 전까지 아무도(자신도) 모릅니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">매 턴 진행</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="mb-1 font-medium text-white">1️⃣ 가져오기</p>
              <p className="text-xs text-white/60">
                덱에서 몰래 1장을 뽑거나, 버림 더미 맨 위가 <span className="text-emerald-300">숫자 카드</span>일 때만 공개로 가져올 수 있어요.
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="mb-1 font-medium text-white">2️⃣ 처리하기</p>
              <p className="text-xs text-white/60">
                숫자 카드면 내 카드 1장과 교체하거나 그냥 버리고, 특수 카드면 능력을 즉시 쓰거나
                그냥 버립니다. 버림 더미 카드는 반드시 교체해야 해요.
              </p>
            </div>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">특수 카드</h3>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-white/60">
              <p className="mb-1 font-medium text-white">🔎 엿보기</p>내 카드 1장을 몰래 확인.
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-white/60">
              <p className="mb-1 font-medium text-white">🔄 바꾸기</p>내 카드 1장과 상대 카드 1장을
              앞면을 보지 않고 그대로 교환.
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-white/60">
              <p className="mb-1 font-medium text-white">2️⃣ 두 번 뽑기</p>덱에서 1장을 뽑아 마음에
              들면 사용, 아니면 버리고 반드시 사용/버려야 하는 2번째 카드를 새로 뽑음.
            </div>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">게임 종료 &amp; 점수</h3>
          <p className="text-white/70">
            자신의 턴에 카드를 뽑는 대신 <span className="text-rose-300">&ldquo;랫어탯캣!&rdquo;</span>을 외치면,
            나머지 모두가 마지막 1턴씩 진행한 뒤 전원 카드를 공개합니다. 4장 합이{" "}
            <span className="text-emerald-300">가장 낮은</span> 사람이 승리! 덱이 바닥나면 그 즉시
            게임이 끝납니다.
          </p>
          <p className="mt-1.5 text-xs text-white/40">
            게임이 끝날 때까지 특수 카드가 손에 남아있으면, 덱에서 숫자 카드가 나올 때까지 뽑아 그
            값으로 대체해 채점합니다.
          </p>
        </section>
      </div>
    </Overlay>
  );
}
