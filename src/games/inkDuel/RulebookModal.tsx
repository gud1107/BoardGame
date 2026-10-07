"use client";

import Overlay from "@/components/Overlay";

const box = "rounded-xl border border-white/10 bg-white/5 p-3 light:border-slate-200 light:bg-white light:shadow-sm";
const h3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";

export default function InkDuelRulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="✏️ 낙서 결투 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80 light:text-slate-700">
        <section>
          <p className="text-white/70 light:text-slate-600">
            공책 위 2~4명의 낙서 전사가 벌이는 턴제 포격전. 내 차례마다 받는 <b>잉크 100</b>으로 무기를 그려 던지거나, 경기장에 직접 벽을 그려 몸을 지킵니다.
            <b> 무엇을 그렸는지 알아맞히지 않아요</b> — 선의 <b>모양</b>이 곧 능력치이고, 그린 그림이 그대로 날아가 충돌 판정이 됩니다.
          </p>
        </section>

        <section>
          <h3 className={h3}>승리 조건</h3>
          <div className={box}>
            ♥100으로 시작해 <b>마지막까지 살아남은 사람</b>이 승리. 10라운드가 끝나면 남은 체력이 가장 높은 사람이 승리합니다.
          </div>
        </section>

        <section>
          <h3 className={h3}>① 모양 → 무기 (가장 긴 선 기준)</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className={box}>🗡️ <b>창</b> — 곧게 쭉 그은 선. 벽을 <b>관통</b>하고 빠르게 날아가지만 직격해야만 피해(높은 피해).</div>
            <div className={box}>💣 <b>폭탄</b> — 시작점과 끝점이 만나는 닫힌 도형. 넓게 그릴수록 폭발 반경↑, 지형을 파내요.</div>
            <div className={box}>⚡ <b>번개</b> — 지그재그. 맞은 곳에서 가까운 적에게 연쇄 피해 (꺾을수록 연쇄↑).</div>
            <div className={box}>🪨 <b>몽둥이</b> — 그 밖의 자유 낙서. 작은 범위의 묵직한 둔기 피해.</div>
          </div>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-white/60 light:text-slate-500">
            <li>뾰족한 꼭짓점이 많을수록 <b>치명타</b> 확률↑ (×1.6, 최대 45%).</li>
            <li>잉크를 많이 쓸수록 무거워져 <b>피해↑ 속도↓</b> — 큰 폭탄은 멀리 못 던져요.</li>
            <li>직격하면 피해 +20%. 내 폭발에 휘말리면 절반 피해를 입어요.</li>
          </ul>
        </section>

        <section>
          <h3 className={h3}>② 색 → 속성 (가장 많이 쓴 색)</h3>
          <div className={box}>
            <ul className="space-y-1 text-xs text-white/70 light:text-slate-600">
              <li>⚫ 검정 — 강철: 피해 +10%</li>
              <li>🔴 빨강 — 화염: 맞은 상대가 2턴 동안 턴 시작마다 −6</li>
              <li>🔵 파랑 — 빙결: 맞은 상대의 다음 턴 잉크가 65로 줄어듦</li>
              <li>🟢 초록 — 독: 3턴 동안 턴 시작마다 −4</li>
              <li>🟡 노랑 — 전기: 연쇄 +1회</li>
            </ul>
          </div>
        </section>

        <section>
          <h3 className={h3}>③ 내 차례에 할 수 있는 일 (둘 중 하나)</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className={box}>⚔️ <b>무기 그리기</b> — 공책 패드에 그리고, 각도·힘을 정해 발사. 경기장을 드래그해서 조준할 수도 있어요. 점선은 궤적의 앞부분만 보여줘요.</div>
            <div className={box}>🧱 <b>벽 그리기</b> — 내 주변 파란 영역에 직접 선을 그어 벽 생성. 내구도 = 사용한 잉크. 상대 바로 옆에는 그릴 수 없어요.</div>
          </div>
          <p className="mt-2 text-xs text-white/60 light:text-slate-500">
            🚶 <b>이동</b> — 행동 전에 좌우로 최대 80px 걸을 수 있어요. 4px 걸을 때마다 잉크 1이 들어서(80px = 잉크 20), 많이 걸을수록 그릴 잉크가 줄어요. 상대나 땅에 붙은 벽은 지나갈 수 없어요.
          </p>
          <p className="mt-2 text-xs text-white/50 light:text-slate-500">🌬️ 바람은 매 턴 바뀌어요. 제한 시간 45초가 지나면 그려둔 무기가 자동 발사되고, 없으면 패스합니다.</p>
        </section>
      </div>
    </Overlay>
  );
}
