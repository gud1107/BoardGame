"use client";

import Overlay from "@/components/Overlay";
import type { GreatLegacyMode } from "./types";

const MODE_SPEC: Record<GreatLegacyMode, { coins: string; cards: string; specials: string }> = {
  "4p": { coins: "140코인 (20×2, 10×5, 5×8, 1×10)", cards: "25장 중 3장 제외 → 22장 진행", specials: "초대형호재 2 · 악재/어닝쇼크 2 · 상장폐지 2 · 강제반대매매 1 (총 7장)" },
  "8p": { coins: "110코인 (20×2, 10×3, 5×6, 1×10)", cards: "28장 중 3장 제외 → 25장 진행", specials: "초대형호재 3 · 악재/어닝쇼크 3 · 상장폐지 3 · 강제반대매매 1 (총 10장)" },
};

export default function RulebookModal({ onClose, mode }: { onClose: () => void; mode?: GreatLegacyMode }) {
  const spec4p = MODE_SPEC["4p"];
  const spec8p = MODE_SPEC["8p"];

  return (
    <Overlay title="📖 위대한 투자 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80 light:text-slate-700">
        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500">목표</h3>
          <p className="text-white/70 light:text-slate-600">
            신용대출로 자금을 끌어모은 레버리지 투자자가 되어 전 세계 3대 시장(국장·미장·코인)의 핵심 자산을 경매로 매수하고, 컬렉션
            보너스까지 쌓아 <span className="text-amber-300 light:text-amber-700">최종 평가액(점수)이 가장 높은</span> 사람이 승리합니다.
            동점이면 <span className="text-amber-300 light:text-amber-700">남은 코인 액면가 합계</span>가 더 많은 쪽이 이기고, 그마저 같으면
            공동 우승입니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500">인원 모드</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className={`rounded-xl border p-3 ${mode === "4p" ? "border-emerald-400/50 bg-emerald-400/10" : "border-white/15 bg-white/[0.03] light:border-slate-200 light:bg-white"}`}>
              <p className="mb-1 font-medium text-white/90 light:text-slate-800">👥 4인 (원작)</p>
              <ul className="list-disc space-y-0.5 pl-4 text-xs text-white/60 light:text-slate-500">
                <li>초기 대출 한도 {spec4p.coins}</li>
                <li>특수 카드 {spec4p.specials}</li>
                <li>{spec4p.cards}</li>
              </ul>
            </div>
            <div className={`rounded-xl border p-3 ${mode === "8p" ? "border-emerald-400/50 bg-emerald-400/10" : "border-white/15 bg-white/[0.03] light:border-slate-200 light:bg-white"}`}>
              <p className="mb-1 font-medium text-white/90 light:text-slate-800">👥👥 8인 (리밸런싱 변형)</p>
              <ul className="list-disc space-y-0.5 pl-4 text-xs text-white/60 light:text-slate-500">
                <li>초기 대출 한도 {spec8p.coins}</li>
                <li>특수 카드 {spec8p.specials}</li>
                <li>{spec8p.cards}</li>
              </ul>
            </div>
          </div>
          <p className="mt-2 text-xs text-white/50 light:text-slate-500">
            3대 시장(미장·국장·코인) × 3대 섹터(빅테크&AI·블루칩·밈&테마주) 자산 18장은 두 모드 모두 동일 — 8인전은 자금·특수카드
            매수·제외 매수만 조정한 하우스룰입니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500">자산 카드 점수표</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-xs">
              <thead>
                <tr className="text-white/50 light:text-slate-500">
                  <th className="border-b border-white/10 px-2 py-1.5 text-left light:border-slate-200"></th>
                  <th className="border-b border-white/10 px-2 py-1.5 text-left light:border-slate-200">🇺🇸 미장</th>
                  <th className="border-b border-white/10 px-2 py-1.5 text-left light:border-slate-200">🇰🇷 국장</th>
                  <th className="border-b border-white/10 px-2 py-1.5 text-left light:border-slate-200">🪙 코인</th>
                </tr>
              </thead>
              <tbody className="text-white/70 light:text-slate-600">
                <tr>
                  <td className="border-b border-white/5 px-2 py-1.5 font-medium text-white/90 light:border-slate-100 light:text-slate-800">🤖 빅테크&AI</td>
                  <td className="border-b border-white/5 px-2 py-1.5 light:border-slate-100">애플(3) · 구글 알파벳(3)</td>
                  <td className="border-b border-white/5 px-2 py-1.5 light:border-slate-100">카카오(2) · 네이버(2)</td>
                  <td className="border-b border-white/5 px-2 py-1.5 light:border-slate-100">솔라나(2) · 리플(1)</td>
                </tr>
                <tr>
                  <td className="border-b border-white/5 px-2 py-1.5 font-medium text-white/90 light:border-slate-100 light:text-slate-800">🏆 블루칩</td>
                  <td className="border-b border-white/5 px-2 py-1.5 light:border-slate-100">엔비디아(5) · 마이크로소프트(5)</td>
                  <td className="border-b border-white/5 px-2 py-1.5 light:border-slate-100">삼성전자(4) · 현대차(3)</td>
                  <td className="border-b border-white/5 px-2 py-1.5 light:border-slate-100">비트코인(5) · 이더리움(4)</td>
                </tr>
                <tr>
                  <td className="px-2 py-1.5 font-medium text-white/90 light:text-slate-800">🎢 밈&테마주</td>
                  <td className="px-2 py-1.5">테슬라(3) · 게임스탑(1)</td>
                  <td className="px-2 py-1.5">초전도체 테마주(4) · 정치인 테마주(4)</td>
                  <td className="px-2 py-1.5">도지코인(3) · 페페 코인(3)</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-white/50 light:text-slate-500">낙찰된 자산의 점수는 즉시 자신의 포트폴리오 점수로 집계됩니다.</p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500">경매 진행 (일반)</h3>
          <ul className="list-disc space-y-1 pl-4 text-white/70 light:text-slate-600">
            <li>선 플레이어부터 원하는 만큼 코인을 제출해 입찰 — 다음 사람은 직전 총액보다 반드시 더 많이 제출해야 합니다.</li>
            <li>여러 번 입찰하면 이전에 낸 코인에 누적됩니다. <span className="text-amber-300 light:text-amber-700">이미 낸 코인의 구성은 바꿀 수 없고, 추가만 가능합니다.</span></li>
            <li>포기하면 그동안 낸 코인을 전부 돌려받고 이번 경매에서 빠집니다.</li>
            <li>나 빼고 전원이 포기하면 마지막 남은 사람이 낙찰 — 낙찰자가 다음 매물의 선 플레이어가 됩니다.</li>
          </ul>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500">⚠️ 역경매 — 악재/어닝쇼크 · 상장폐지 · 강제반대매매</h3>
          <div className="rounded-xl border border-rose-400/30 bg-rose-400/10 p-3 light:border-rose-300 light:bg-rose-50">
            <p className="text-rose-100 light:text-rose-800">
              이 세 카드는 경매 방식이 <b>정반대</b>입니다. <b>가장 먼저 &quot;포기&quot;를 선언한 사람</b>이 그 카드를 떠안고(낙찰), 그 사람 자신이
              냈던 코인은 환불되지만 <b>나머지 전원이 냈던 코인은 전부 소멸</b>(회수 불가)됩니다. 다들 받기 싫어서 서로 입찰가를 올리다가, 먼저
              손을 든 사람이 역설적으로 카드를 떠안는 방식입니다.
            </p>
          </div>
          <p className="mt-2 text-xs text-white/50 light:text-slate-500">초대형 호재 카드는 이 예외에 해당하지 않고, 위의 일반 경매 방식 그대로 진행됩니다.</p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500">특수 카드 효과</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-3 light:border-emerald-400 light:bg-emerald-50">
              <p className="mb-1 font-medium text-emerald-200 light:text-emerald-700">🚀 초대형 호재</p>
              <p className="text-xs text-white/60 light:text-slate-500">직전에 획득한 자산의 점수를 5점으로 변경 (일반 경매)</p>
            </div>
            <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 light:border-amber-400 light:bg-amber-50">
              <p className="mb-1 font-medium text-amber-200 light:text-amber-700">📉 악재 / 어닝쇼크</p>
              <p className="text-xs text-white/60 light:text-slate-500">직전에 획득한 자산의 점수를 1점으로 변경 (역경매)</p>
            </div>
            <div className="rounded-xl border border-rose-400/30 bg-rose-400/10 p-3 light:border-rose-300 light:bg-rose-50">
              <p className="mb-1 font-medium text-rose-200 light:text-rose-700">🗑️ 상장폐지</p>
              <p className="text-xs text-white/60 light:text-slate-500">직전에 획득한 자산을 영구 폐기 (역경매)</p>
            </div>
            <div className="rounded-xl border border-rose-400/30 bg-rose-400/10 p-3 light:border-rose-300 light:bg-rose-50">
              <p className="mb-1 font-medium text-rose-200 light:text-rose-700">⚠️ 강제 반대매매</p>
              <p className="text-xs text-white/60 light:text-slate-500">직전에 획득한 자산을 영구 폐기 (역경매)</p>
            </div>
          </div>
          <p className="mt-2 text-xs text-white/50 light:text-slate-500">
            특수 카드 1장은 자산 1장에만 적용됩니다. 자산을 하나도 보유하지 않았을 때 특수 카드를 받으면, 다음번에 낙찰받는 자산부터
            순서대로(먼저 받은 것부터) 적용됩니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500">포트폴리오 시너지 (컬렉션 보너스)</h3>
          <ul className="list-disc space-y-1 pl-4 text-white/70 light:text-slate-600">
            <li><b className="text-white light:text-slate-900">영끌 올인 +3점</b> — 같은 시장의 빅테크&AI · 블루칩 · 밈&테마주를 각 1장씩 모으면.</li>
            <li><b className="text-white light:text-slate-900">테마 분산투자 +3점</b> — 같은 섹터(예: 블루칩)를 미장 · 국장 · 코인 3개 시장 모두 모으면.</li>
          </ul>
          <p className="mt-2 text-xs text-amber-300/80 light:text-amber-700">
            자산 1장은 같은 종류의 컬렉션에서는 한 번만 카운트되지만, 시장/섹터 두 컬렉션에는 각각 따로 카운트될 수 있어 최대 두 번 겹쳐
            쓰일 수 있습니다. (예: 삼성전자(국장/블루칩) → 영끌 올인 1회 + 테마 분산투자 1회)
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500">방 설정 옵션</h3>
          <ul className="list-disc space-y-1 pl-4 text-white/70 light:text-slate-600">
            <li><b>턴 제한시간</b> — 없음 / 15초 / 30초. 시간 초과 시 자동으로 포기 처리됩니다.</li>
            <li><b>코인 공개 모드</b> — 비밀(각자 자기 코인만 확인) / 공개(모두의 코인이 항상 공개). 어느 쪽이든 <b>경매에 실제로 낸 입찰 코인</b>은 항상 공개됩니다.</li>
          </ul>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500">게임 종료</h3>
          <p className="text-white/70 light:text-slate-600">모든 매물이 소진되면 즉시 종료되며, 자산 점수 + 컬렉션 보너스 합계가 가장 높은 사람이 승리합니다.</p>
        </section>
      </div>
    </Overlay>
  );
}
