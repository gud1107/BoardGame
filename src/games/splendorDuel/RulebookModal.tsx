"use client";

import Overlay from "@/components/Overlay";
import { ABILITY_META } from "./CardMarket";
import { AbilityJewel } from "./LuxuryArt";
import type { CardAbility } from "./engine";

const box = "rounded-xl border border-white/10 bg-white/5 p-3 light:border-slate-200 light:bg-white light:shadow-sm";
const h3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";

export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="💎 스플렌더 대결 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80 light:text-slate-700">
        <section>
          <p className="text-white/70 light:text-slate-600">
            2인 전용 보석 쟁탈전. 5×5 보석 보드(25칸: 기본 보석 20 · 진주 2 · 황금 3)에서 토큰을 모아 발전 카드를 사고, 카드 보너스로 다음 구매를 할인받으며 엔진을 키웁니다.
            후공은 특권 스크롤 1개를 들고 시작합니다.
          </p>
        </section>

        <section>
          <h3 className={h3}>승리 조건 — 내 턴이 끝났을 때 하나라도 달성하면 즉시 승리</h3>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className={box}>⭐ 위신 점수 <b>20점</b></div>
            <div className={box}>👑 왕관 <b>10개</b></div>
            <div className={box}>🎨 한 가지 색 카드의 위신 점수 합 <b>10점</b></div>
          </div>
        </section>

        <section>
          <h3 className={h3}>선택 행동 (필수 행동 전, 원하는 만큼)</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className={box}>
              <p className="mb-1 font-medium text-white light:text-slate-900">📜 특권 스크롤 사용</p>
              <p className="text-xs text-white/60 light:text-slate-600">스크롤 1개를 공용으로 돌려놓고 보드의 토큰 1개(황금 제외)를 가져옵니다.</p>
            </div>
            <div className={box}>
              <p className="mb-1 font-medium text-white light:text-slate-900">🔄 보드 보충</p>
              <p className="text-xs text-white/60 light:text-slate-600">
                주머니의 토큰을 모두 섞어 중앙부터 소용돌이 순서로 빈칸에 채웁니다. <b>상대가 스크롤 1개</b>를 얻습니다.
              </p>
            </div>
          </div>
        </section>

        <section>
          <h3 className={h3}>필수 행동 (정확히 1가지)</h3>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className={box}>
              <p className="mb-1 font-medium text-white light:text-slate-900">① 토큰 가져오기</p>
              <p className="text-xs text-white/60 light:text-slate-600">
                가로·세로·대각선으로 끊김 없이 이어진 1~3개. 같은 색 3개 또는 진주 2개를 가져가면 상대가 스크롤 1개를 얻습니다.
              </p>
            </div>
            <div className={box}>
              <p className="mb-1 font-medium text-white light:text-slate-900">② 예약 + 황금</p>
              <p className="text-xs text-white/60 light:text-slate-600">
                펼쳐진 카드나 덱 맨 위 카드를 손으로 예약(최대 3장)하고, 보드 위 황금 1개를 골라 가져옵니다. 보드에 황금이 없으면 카드만 예약. 황금은 이 방법으로만 가져올 수 있어요.
              </p>
            </div>
            <div className={box}>
              <p className="mb-1 font-medium text-white light:text-slate-900">③ 카드 구매</p>
              <p className="text-xs text-white/60 light:text-slate-600">
                비용에서 내 카드 보너스만큼 할인. 모자란 보석·진주는 황금으로 대신 냅니다. 쓴 토큰은 황금까지 모두 주머니로 돌아갑니다.
              </p>
            </div>
          </div>
        </section>

        <section>
          <h3 className={h3}>카드 능력</h3>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {(Object.keys(ABILITY_META) as CardAbility[]).map((a) => (
              <p key={a} className="text-xs">
                <AbilityJewel ability={a} className="mr-1 h-5 w-5" />
                <b>{ABILITY_META[a].label}</b> — {ABILITY_META[a].desc}
              </p>
            ))}
          </div>
        </section>

        <section>
          <h3 className={h3}>턴 종료 & 특수 룰</h3>
          <ul className="list-disc space-y-1 pl-5 text-xs text-white/60 light:text-slate-600">
            <li>왕관이 3개, 6개가 되는 순간 왕실 카드 1장을 무료로 가져갑니다(최대 2장). 왕실 카드는 점수와 능력만, 할인 보너스는 없습니다.</li>
            <li>턴 종료 시 토큰은 황금 포함 10개까지. 초과분은 골라서 반납합니다.</li>
            <li>특권 스크롤은 게임 전체에 3개뿐 — 받아야 하는데 공용에 없으면 상대 것을 빼앗아 옵니다.</li>
            <li>카드 데이터(67장)는 룰북에 카드 목록이 없어 공식 수량·구조를 따라 이 앱에서 자체 설계했습니다.</li>
          </ul>
        </section>
      </div>
    </Overlay>
  );
}
