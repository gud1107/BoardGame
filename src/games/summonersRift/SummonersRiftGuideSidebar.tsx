"use client";

import { ITEM_CATALOG, MONSTER_CATALOG } from "./engine";

/**
 * Always-visible compact "player aid" sidebar (task brief §4, content based
 * on `boardGameRule/소환사의 협곡/설명카드조각1.png`'s monster/counter summary
 * card) — a condensed turn-flow cheat sheet plus the monster-vs-counter-item
 * table, so nobody needs to open the full rulebook mid-turn just to remember
 * which item beats which monster. Deliberately NOT a duplicate of
 * `RulebookModal` (which stays the full detailed rulebook opened on demand)
 * — this is the always-on quick-reference companion, rendered beside the
 * board on wide screens and stacked below it on narrow ones (see
 * `SummonersRiftBoard.tsx`'s outer layout and the summoners-rift-only wide
 * page container in `app/games/[gameId]/page.tsx`).
 */
export default function SummonersRiftGuideSidebar() {
  return (
    <aside
      className="flex w-full shrink-0 flex-col gap-3 rounded-[24px] border p-3 text-xs sm:p-4 lg:w-72"
      style={{ borderColor: "rgba(200,170,110,0.25)", background: "linear-gradient(160deg,#151b28 0%,#0d121c 45%,#06090f 100%)" }}
    >
      <h3 className="text-[11px] font-semibold tracking-wide uppercase" style={{ color: "#c8aa6e" }}>
        📖 인게임 요약 가이드
      </h3>

      <section className="flex flex-col gap-1.5">
        <p className="text-[10px] font-semibold tracking-wide text-white/50 uppercase">진행 흐름</p>
        <ol className="list-decimal space-y-1 pl-4 text-white/70">
          <li>
            내 차례: 카드를 뽑아 혼자 확인한 뒤 <b className="text-rose-200">협곡에 넣기</b> 또는{" "}
            <b className="text-amber-200">아이템 1개 해제해 숨기기</b> 중 하나. 아니면 <b className="text-white">패스</b>.
          </li>
          <li>단 1명만 남으면 그 소환사가 최종 도전자가 되어, 남은 아이템으로 총 HP를 계산합니다.</li>
          <li>협곡 더미를 한 장씩 공개 — 처치 아이템이 있으면 무피해, 없으면 위협도만큼 HP가 감소합니다.</li>
          <li>HP 1 이상으로 전부 처리하면 성공, 도중 0 이하가 되면 즉시 실패입니다.</li>
        </ol>
      </section>

      <section className="flex flex-col gap-1.5">
        <p className="text-[10px] font-semibold tracking-wide text-white/50 uppercase">몬스터 &amp; 카운터 아이템</p>
        <div className="overflow-x-auto rounded-lg border border-white/10">
          <table className="w-full min-w-[220px] border-collapse text-[10px]">
            <thead>
              <tr className="bg-white/5 text-white/50">
                <th className="px-1.5 py-1 text-left">강도</th>
                <th className="px-1.5 py-1 text-left">몬스터</th>
                <th className="px-1.5 py-1 text-left">카운터</th>
              </tr>
            </thead>
            <tbody>
              {MONSTER_CATALOG.map((m) => {
                const counters = ITEM_CATALOG.filter((i) => !i.isGoldenSpatula && i.kills.includes(m.threat));
                return (
                  <tr key={m.threat} className="border-t border-white/5">
                    <td className="px-1.5 py-1 font-bold text-rose-200">{m.threat}</td>
                    <td className="px-1.5 py-1 text-white/80">{m.name}</td>
                    <td className="px-1.5 py-1 text-white/50">{counters.length > 0 ? counters.map((c) => c.name).join(", ") : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[9px] leading-relaxed text-white/35">🥄 황금 뒤집개는 협곡 진입 전 지정한 몬스터 1종류를 무엇이든 무력화합니다.</p>
      </section>
    </aside>
  );
}
