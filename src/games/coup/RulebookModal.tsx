"use client";

import Overlay from "@/components/Overlay";
import { ASSASSINATE_COST, CHARACTER_EMOJI, CHARACTER_NAMES, COUP_COST, FORCED_COUP_THRESHOLD, MAX_PLAYERS, MIN_PLAYERS, STARTING_COINS } from "./engine";

export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="📖 레지스탕스 쿠(Coup) 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80">
        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">목표 (단판 승부)</h3>
          <p className="text-white/70">
            거짓말과 추리, 블러핑으로 상대 가문의 영향력을 제거하는 게임입니다. 영향력(카드) 2장이 모두 앞면으로 뒤집혀 사망하면{" "}
            <span className="text-amber-300">그 즉시 완전히 탈락</span>하며, 최후까지 살아남은 단 1명이 즉시 최종 승자가 됩니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">세팅</h3>
          <ul className="list-disc space-y-1 pl-4 text-xs text-white/70">
            <li>
              {MIN_PLAYERS}~{MAX_PLAYERS}명, 캐릭터 카드 5종({(["duke", "assassin", "contessa", "captain", "ambassador"] as const)
                .map((c) => `${CHARACTER_EMOJI[c]}${CHARACTER_NAMES[c]}`)
                .join(" · ")}) 각 3장씩 총 15장.
            </li>
            <li>
              각자 코인 {STARTING_COINS}개, 비공개 영향력 카드 2장씩 지급받습니다.
            </li>
          </ul>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">내 턴 — 7가지 중 택 1</h3>
          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full min-w-[480px] border-collapse text-xs">
              <thead>
                <tr className="bg-white/5 text-white/50">
                  <th className="px-2 py-1.5 text-left">행동</th>
                  <th className="px-2 py-1.5 text-left">효과</th>
                  <th className="px-2 py-1.5 text-left">방해 가능</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["소득", "1코인 획득 (방어 불가)", "—"],
                  ["외화 도입", "2코인 획득", "👑 공작"],
                  [`쿠데타 (${COUP_COST}코인)`, "대상 1명의 영향력 1장 제거 (방해/의심 불가)", "—"],
                  ["👑 세금 징수", "3코인 획득", "—(의심만 가능)"],
                  [`🗡️ 암살 (${ASSASSINATE_COST}코인)`, "대상 1명의 영향력 1장 제거", "🛡️ 백작부인"],
                  ["⚓ 갈취", "대상 1명의 코인 2개 획득", "⚓ 사령관 / 🕊️ 제상"],
                  ["🕊️ 교환", "덱에서 2장을 뽑아 내 카드와 함께 본 뒤 2장을 돌려놓음", "—(의심만 가능)"],
                ].map(([name, effect, block]) => (
                  <tr key={name} className="border-t border-white/10">
                    <td className="px-2 py-1.5 font-semibold whitespace-nowrap text-white/80">{name}</td>
                    <td className="px-2 py-1.5">{effect}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{block}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-amber-200/80">
            ⚠️ 필수 규칙: 내 턴이 시작될 때 코인을 {FORCED_COUP_THRESHOLD}개 이상 들고 있다면 무조건 쿠데타를 사용해야 합니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">의심(Challenge) &amp; 방어(Counter)</h3>
          <ul className="list-disc space-y-1 pl-4 text-xs text-white/70">
            <li>해당 캐릭터가 없어도 있는 척 거짓말로 능력을 선언할 수 있습니다.</li>
            <li>
              <b>도전 성공</b>(거짓말이었을 경우): 거짓말한 사람이 카드 1장 공개(사망), 선언한 행동은 무효가 됩니다.
            </li>
            <li>
              <b>도전 실패</b>(진짜였을 경우): 카드를 낸 사람은 그 카드를 덱에 넣고 새 카드로 교체하며 행동은 정상 실행되고, 도전자가 벌점으로
              카드 1장을 공개(사망)합니다.
            </li>
            <li>공격을 받으면 방해 캐릭터가 있다고 주장하며 방어할 수 있고, 그 방어 주장도 다시 도전받을 수 있습니다.</li>
          </ul>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">⚠️ 단판 승부 대형 사고 (Double Kill)</h3>
          <p className="text-xs text-white/70">
            암살을 당한 사람이 거짓으로 &ldquo;나 백작부인 있어&rdquo;라고 방어했다가 역도전에 걸려 들통나면 → 거짓말 실패로 카드 1장 사망 +
            암살 피격으로 카드 1장 사망 = 카드 2장이 한 번에 날아가 즉시 탈락할 수 있습니다!
          </p>
        </section>
      </div>
    </Overlay>
  );
}
