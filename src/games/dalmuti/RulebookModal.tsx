"use client";

import Overlay from "@/components/Overlay";
import { CARD_RANK_INFO } from "./CardArt";
import { JOKER_RANK, MAX_CARD_RANK } from "./engine";

export default function RulebookModal({ onClose }: { onClose: () => void }) {
  const rankRows = Array.from({ length: MAX_CARD_RANK }, (_, i) => i + 1);
  return (
    <Overlay title="📖 달무티 룰북 (단판승부 하우스 룰)" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80">
        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">목표</h3>
          <p className="text-white/70">
            80장(계급 카드 78장 + 조커 2장)을 나눠 갖고, <span className="text-amber-300">손패를 가장 먼저 전부 털어낸 사람</span>이
            승리하는 단 1라운드짜리 단판 승부입니다. 카드의 숫자가 작을수록 높은 계급이며, 해당 숫자만큼 카드 장수가 존재합니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">계급 카드 구성 (숫자 = 카드 수)</h3>
          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full min-w-[420px] border-collapse text-xs">
              <thead>
                <tr className="bg-white/5 text-white/50">
                  <th className="px-2 py-1.5 text-left">계급</th>
                  <th className="px-2 py-1.5 text-left">신분</th>
                  <th className="px-2 py-1.5 text-right">장수</th>
                </tr>
              </thead>
              <tbody>
                {rankRows.map((rank) => (
                  <tr key={rank} className="border-t border-white/10">
                    <td className="px-2 py-1.5 font-semibold text-white/80">{rank}</td>
                    <td className="px-2 py-1.5">
                      {CARD_RANK_INFO[rank].emoji} {CARD_RANK_INFO[rank].title}
                    </td>
                    <td className="px-2 py-1.5 text-right">{rank}장</td>
                  </tr>
                ))}
                <tr className="border-t border-white/10">
                  <td className="px-2 py-1.5 font-semibold text-white/80">{JOKER_RANK}</td>
                  <td className="px-2 py-1.5">
                    {CARD_RANK_INFO[JOKER_RANK].emoji} {CARD_RANK_INFO[JOKER_RANK].title}
                  </td>
                  <td className="px-2 py-1.5 text-right">2장</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">게임 시작 — 초기 신분 결정 & 카드 분배</h3>
          <p className="text-white/70">
            모든 플레이어의 초기 신분(<b>달무티</b> ~ <b>대농노</b>)이 무작위로 정해진 뒤, 달무티부터 시계 방향으로 카드가 균등하게
            나눠집니다(남는 카드는 이번 판에 쓰이지 않고 치워둡니다).
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">혁명 (Revolution)</h3>
          <p className="text-white/70">
            조커 2장을 모두 가진 플레이어는 세금 바치기 전에 혁명을 선포할 수 있습니다.
          </p>
          <ul className="mt-1.5 list-disc space-y-1 pl-4 text-xs text-white/60">
            <li>
              <b>일반 혁명</b>(달무티~중농~소농노가 선포): 세금 바치기가 취소되고 바로 카드 내기로 들어갑니다.
            </li>
            <li>
              <b>대혁명</b>(대농노가 선포): 세금도 취소되고, <b>모든 신분이 정반대로 뒤집힙니다</b>(대농노 → 달무티 등).
            </li>
          </ul>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">세금 바치기 (혁명이 없을 때)</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-white/15 bg-white/[0.03] p-3">
              <p className="mb-1 font-medium text-white/90">대농노 ↔ 달무티</p>
              <p className="text-xs text-white/60">대농노는 가장 높은 계급 카드 2장을 자동으로 바치고, 달무티는 원하는 카드 2장을 돌려줍니다.</p>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/[0.03] p-3">
              <p className="mb-1 font-medium text-white/90">소농노 ↔ 총리</p>
              <p className="text-xs text-white/60">소농노는 가장 높은 계급 카드 1장을 자동으로 바치고, 총리는 원하는 카드 1장을 돌려줍니다.</p>
            </div>
          </div>
          <p className="mt-2 text-xs text-white/60">조커는 세금 대상에서 제외됩니다. (3인 게임은 소농노=총리라 두 번째 교환이 없습니다.)</p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">카드 내기 (본 게임)</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-white/15 bg-white/[0.03] p-3">
              <p className="mb-1 font-medium text-white/90">① 선 플레이어</p>
              <p className="text-xs text-white/60">달무티가 첫 트릭의 선입니다. 원하는 계급의 카드를 1장 이상(동일 숫자 세트) 냅니다.</p>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/[0.03] p-3">
              <p className="mb-1 font-medium text-white/90">② 다음 플레이어들</p>
              <p className="text-xs text-white/60">
                직전과 <b>같은 장수</b>이면서 <b>더 높은 계급(더 작은 숫자)</b>인 카드만 내거나, 패스합니다. 패스했어도 다음 차례에
                다시 참여할 수 있습니다.
              </p>
            </div>
          </div>
          <p className="mt-2 text-xs text-amber-200/80">
            🃏 조커는 단독으로는 숫자 13, 다른 카드와 함께 내면 그 카드의 와일드카드입니다 (예: 4번 2장 + 조커 1장 = 4번 3장 인정).
          </p>
          <p className="mt-2 text-xs text-white/60">한 명이 낸 뒤 나머지 전원이 패스하면 트릭이 종료되고, 마지막으로 낸 사람이 다음 트릭의 선이 됩니다.</p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">게임 종료</h3>
          <p className="text-white/70">
            손패를 가장 먼저 전부 털어낸 사람이 최종 승리자(진정한 달무티)입니다. 이후 카드를 턴 순서대로 2등, 3등...이 정해지고,
            단 한 명만 남으면 그 사람은 자동으로 꼴찌가 되며 게임이 끝납니다.
          </p>
        </section>
      </div>
    </Overlay>
  );
}
