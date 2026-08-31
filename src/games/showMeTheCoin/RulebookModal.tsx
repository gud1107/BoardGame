"use client";

import Overlay from "@/components/Overlay";
import { ANTE, MAX_COMMIT, MIN_COMMIT, opponentCommitRange, STARTING_CHIPS } from "./engine";

/** Worked ±1 example for the 1단계 section below — a mid-range first-submitter count with plenty of coins on hand, so the window is never clamped by scarcity. */
const EXAMPLE_FIRST_COUNT = 3;
const exampleRange = opponentCommitRange(EXAMPLE_FIRST_COUNT, 99);

export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="🪙 쇼미더코인 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80">
        <section>
          <p className="text-white/70" style={{ wordBreak: "keep-all" }}>
            넷플릭스 예능 《데스게임》에 등장한{" "}
            <span className="text-pink-300">1:1 두뇌·베팅 심리전</span> 게임입니다. 두 플레이어가 각자{" "}
            <span className="text-amber-300">숫자 코인 50개(3,000점)</span>와{" "}
            <span className="text-amber-300">베팅칩 {STARTING_CHIPS}개</span>를 가지고 시작합니다. 숫자 코인은 매
            라운드 승패를 가르는 &ldquo;패&rdquo;이고, 베팅칩은 실제로 오가는 판돈입니다 — 서로 다른 두 자원이라는
            점이 이 게임의 핵심입니다.
          </p>
          <p className="mt-2 text-xs text-white/40" style={{ wordBreak: "keep-all" }}>
            [확인된 하우스 결정] 룰북 원문은 인원수와 §1 코인 제출 개수 상한을 명시하지 않아 세션 시작 전 사용자와
            직접 확인했습니다: 2인 전용(다른 데스게임 컬렉션 타이틀과 동일), 선공의 코인 제출 개수는{" "}
            {MIN_COMMIT}~{MAX_COMMIT}개, 정해진 라운드 상한 없이 최후의 1인이 남을 때까지 진행, 레이즈 금액은
            자유(직전 베팅보다 많고 남은 칩 이하면 얼마든지). 2026-09-01 세션에서{" "}
            <span className="text-amber-300">선공→후공 순차 제출 + 후공의 ±1개 제출 제약 + 정확한 개수 공개</span>
            로 §1이 개편됐습니다(아래 1·2단계 참고).
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">
            1단계 · 앤티 &amp; 순차 코인 제출 (±1 규칙)
          </h3>
          <p className="text-white/70" style={{ wordBreak: "keep-all" }}>
            라운드가 시작되면 모두 팟에 기본 앤티로 베팅칩 {ANTE}개를 자동으로 지불합니다. 이어서{" "}
            <span className="text-amber-300">선공이 먼저</span> 가림판 뒤에서 이번 라운드 승부에 쓸 숫자 코인을{" "}
            <span className="text-amber-300">
              {MIN_COMMIT}개~{MAX_COMMIT}개
            </span>{" "}
            비공개로 골라 제출합니다. 선공이 제출한 순간 그 <span className="text-amber-300">정확한 개수</span>가
            양쪽 화면에 즉시 공개되고(권종·금액은 여전히 비공개), 후공은 그 개수를 보고{" "}
            <span className="text-amber-300">±1개 범위</span> 안에서만 자신의 코인을 고를 수 있습니다 — 예를 들어
            선공이 {EXAMPLE_FIRST_COUNT}개를 냈다면 후공은{" "}
            {exampleRange.min}~{exampleRange.max}개 중에서만 고를 수 있습니다(가진
            코인이 부족하면 가능한 만큼으로 자동 조정). 이 코인은 팟에 들어가지 않고, 오직 쇼다운에서 합산 금액을
            비교하는 &ldquo;패&rdquo; 역할만 합니다 — 승패와 상관없이{" "}
            <span className="text-rose-300">이번 라운드가 끝나면 제출한 코인은 전량 영구 소멸</span>됩니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">2단계 · 동전 개수 공개</h3>
          <p className="text-white/70" style={{ wordBreak: "keep-all" }}>
            양쪽 모두 제출을 마치면, 두 좌석이 낸 <span className="text-amber-300">정확한 동전 개수</span>가 화면
            중앙과 각자 슬롯에 큼직하게 포커싱 표시됩니다(최소 3초 유지, 직하단 스킵 버튼으로 더 빨리 넘어갈 수
            있음). 금액(권종)은 여기서도 계속 비공개이며, 이 단계가 끝나면 곧바로 칩 베팅으로 넘어갑니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">
            3단계 · 베팅 (체크 · 콜 · 레이즈 · 폴드)
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="mb-1 font-medium text-white">✅ 체크 / 콜</p>
              <p className="text-xs text-white/60" style={{ wordBreak: "keep-all" }}>
                앞선 베팅이 없으면 무료로 패스(체크), 있으면 그 금액만큼 칩을 냅니다.
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="mb-1 font-medium text-white">🔺 레이즈 / 🔥 올인</p>
              <p className="text-xs text-white/60" style={{ wordBreak: "keep-all" }}>
                상대보다 더 많은 칩을 걸어 판돈을 키웁니다. 남은 칩 전부를 걸면 올인 연출이 표출됩니다.
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3 sm:col-span-2">
              <p className="mb-1 font-medium text-white">🏳️ 폴드</p>
              <p className="text-xs text-white/60" style={{ wordBreak: "keep-all" }}>
                승부를 포기하고 이번 라운드 팟을 상대에게 그대로 내줍니다. 어느 쪽 코인도 공개되지 않지만, 이미
                고른 코인은 동일하게 소멸됩니다.
              </p>
            </div>
          </div>
          <p className="mt-2 text-xs text-white/40" style={{ wordBreak: "keep-all" }}>
            둘 다 체크(또는 콜)하면 베팅이 종료되고 4단계 공개로 넘어갑니다. 남은 칩보다 많이 걸 수는 없으며(자연스러운
            올인 한도), 콜할 칩이 모자라면 가진 만큼만 내는 &ldquo;콜 for less&rdquo;가 허용됩니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">
            4단계 · 쇼다운 (공개 &amp; 승패)
          </h3>
          <p className="text-white/70" style={{ wordBreak: "keep-all" }}>
            1단계에서 제출한 코인을 동시에 앞면으로 공개하고 합산 금액을 비교합니다. 더 높은 쪽이 팟의 베팅칩 전부를
            가져갑니다. <span className="text-amber-300">금액이 완전히 같으면 팟을 절반씩 균등 분배</span>하고,
            나누어 떨어지지 않는 칩은 다음 라운드로 이월됩니다. 베팅 도중 상대가 폴드하면 마지막 1인이 코인을 공개하지
            않고 팟을 독식합니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">
            5단계 · 사용 코인 폐기 (핵심 규칙)
          </h3>
          <p className="text-white/70" style={{ wordBreak: "keep-all" }}>
            이번 라운드에 제출됐던 모든 플레이어의 코인은 승패·폴드 여부와 상관없이 전량 회수되어 게임에서
            영구 제외됩니다. 승자도 자신이 낸 코인은 돌려받지 못하며, 오직 베팅칩만 얻습니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">탈락 &amp; 최종 승리</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-rose-400/20 bg-rose-500/5 p-3">
              <p className="mb-1 font-medium text-white">💸 파산 탈락</p>
              <p className="text-xs text-white/60" style={{ wordBreak: "keep-all" }}>베팅칩 {STARTING_CHIPS}개가 모두 소진되면 즉시 탈락합니다.</p>
            </div>
            <div className="rounded-xl border border-rose-400/20 bg-rose-500/5 p-3">
              <p className="mb-1 font-medium text-white">🪙 코인 고갈</p>
              <p className="text-xs text-white/60" style={{ wordBreak: "keep-all" }}>칩이 남아있어도 제출할 코인이 완전히 바닥나면 탈락합니다.</p>
            </div>
          </div>
          <p className="mt-2 text-white/70" style={{ wordBreak: "keep-all" }}>
            상대가 위 두 조건 중 하나로 탈락하면 그 즉시 최종 승리합니다. 정해진 라운드 수 제한은 없으며, 둘 중 한쪽이
            탈락할 때까지 라운드가 계속됩니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">블러핑 팁</h3>
          <p className="text-white/70" style={{ wordBreak: "keep-all" }}>
            낮은 코인을 내고도 강하게 레이즈를 던져 상대의 폴드를 유도할 수 있습니다. 반대로 값비싼 코인을 너무 자주
            소진하면 후반 승부에서 밀릴 수 있으니, 50개 코인의 페이스 조절이 승패를 가릅니다.
          </p>
        </section>
      </div>
    </Overlay>
  );
}
