"use client";

import Overlay from "@/components/Overlay";
import { ItemSlot, MonsterFace } from "./CardArt";
import { BASE_HP, FAILURE_TOKENS_TO_ELIMINATE, ITEM_CATALOG, MONSTER_CATALOG, SUCCESS_TOKENS_TO_WIN } from "./engine";

export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="📖 소환사의 협곡 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80">
        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">목표</h3>
          <p className="text-white/70">
            모두가 공유하는 챔피언(기본 HP {BASE_HP})과 6개의 아이템/스킬을 함께 두고 시작합니다. 매 턴 몬스터를
            <span className="mx-0.5 text-rose-300">협곡 더미에 밀어넣거나</span>, 아이템을 하나 해제해 뽑은 몬스터를
            <span className="mx-0.5 text-amber-200">숨기거나</span>, <span className="mx-0.5 text-white">패스</span>합니다.
            끝까지 패스하지 않고 남은 마지막 1명이 남은 아이템만으로 협곡 더미 전체와 싸워야 합니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">아이템 & 스킬 (6종)</h3>
          <div className="flex flex-wrap justify-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
            {ITEM_CATALOG.map((item) => (
              <ItemSlot key={item.id} itemId={item.id} equipped size="md" />
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">몬스터 (총 13장)</h3>
          <div className="flex flex-wrap justify-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
            {MONSTER_CATALOG.map((m) => (
              <div key={m.threat} className="flex flex-col items-center gap-1">
                <MonsterFace threat={m.threat} size="sm" />
                <span className="text-[9px] text-white/40">{m.copies}장</span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">① 베팅 단계 — 내 차례에 할 일</h3>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-xl border border-white/15 bg-white/[0.03] p-3">
              <p className="mb-1 font-medium text-white/90">🃏 카드 뽑기 → 협곡에 넣기</p>
              <p className="text-xs text-white/60">몬스터 덱 맨 위 카드를 혼자 확인한 뒤, 뒷면으로 협곡 더미에 놓습니다.</p>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/[0.03] p-3">
              <p className="mb-1 font-medium text-white/90">🃏 카드 뽑기 → 아이템 해제</p>
              <p className="text-xs text-white/60">뽑은 카드를 몰래 숨기는 대신, 6개 아이템 중 1개를 해제합니다. 해제된 아이템은 이번 라운드에 쓸 수 없습니다.</p>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/[0.03] p-3">
              <p className="mb-1 font-medium text-white/90">🏳️ 패스</p>
              <p className="text-xs text-white/60">이번 라운드에서 기권합니다. 한 번 패스하면 이번 라운드엔 다시 차례가 오지 않습니다. 덱이 떨어지면 무조건 패스해야 합니다.</p>
            </div>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">② 협곡 공략 단계</h3>
          <p className="mb-2 text-white/70">
            단 1명만 남을 때까지 모두 패스하면, 그 마지막 소환사가 최종 도전자가 됩니다. 남은 아이템으로 총 HP를
            계산하고(황금 뒤집개가 남아있다면 무력화할 몬스터 1종류를 미리 지정), 협곡 더미를 맨 위부터 한 장씩 공개합니다.
          </p>
          <ul className="list-disc space-y-1 pl-4 text-xs text-white/60">
            <li>남은 아이템(또는 지정한 황금 뒤집개 대상)이 그 몬스터를 처치할 수 있으면 데미지 없이 제거.</li>
            <li>처치할 수단이 없으면 몬스터의 위협도만큼 HP가 깎입니다.</li>
            <li>모든 몬스터를 처리할 때까지 HP가 1 이상이면 성공! HP가 0 이하가 되면 즉시 실패.</li>
          </ul>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">게임 종료</h3>
          <p className="text-white/70">
            성공 토큰을 <b>가장 먼저 {SUCCESS_TOKENS_TO_WIN}개</b> 모으거나, 다른 모든 소환사가 실패 토큰{" "}
            {FAILURE_TOKENS_TO_ELIMINATE}개로 탈락해 <b>최후의 1인</b>만 남으면 즉시 승리합니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">전략 팁</h3>
          <ul className="list-disc space-y-1 pl-4 text-xs text-white/60">
            <li>강타를 몰래 제거해두고 장로드래곤(9)을 협곡에 넣으면, 다음 도전자는 강타 없이 9데미지를 직격으로 맞습니다.</li>
            <li>황금 뒤집개는 무엇이든 지목만 맞히면 완벽히 차단하는 만능 카드입니다.</li>
            <li>어떤 아이템이 해제됐는지 항상 살펴 남은 협곡 더미의 위험도를 계산하세요.</li>
          </ul>
        </section>
      </div>
    </Overlay>
  );
}
