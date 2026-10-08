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
          <h3 className={h3}>① 모양 → 무기 11종 (가장 긴 선 기준)</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className={box}>🗡️ <b>창</b> — 곧게 쭉 그은 선. 벽을 <b>관통</b>, 직격해야 피해(높은 피해).</div>
            <div className={box}>💣 <b>폭탄</b> — 둥근 닫힌 도형. 넓을수록 폭발↑, 지형을 파내요.</div>
            <div className={box}>🚀 <b>로켓</b> — 세모. 중력을 덜 받아 뾰족한 쪽으로 쭉 날아가요.</div>
            <div className={box}>🔨 <b>모루</b> — 네모·오각형. 무겁게 뚝 떨어져 큰 피해.</div>
            <div className={box}>✴️ <b>표창</b> — 뾰족한 별 또는 엇갈린 두 직선. 땅에 두 번 튕기고 치명타가 잘 나요.</div>
            <div className={box}>⚡ <b>번개</b> — 지그재그. 가까운 적에게 연쇄 피해 (꺾을수록 연쇄↑).</div>
            <div className={box}>🪃 <b>부메랑</b> — 부드러운 C자 호. 나갔다가 돌아와 내가 받아요 — 오갈 때 모두 맞혀요.</div>
            <div className={box}>🌀 <b>드릴</b> — 한 바퀴 반 이상 감은 소용돌이. 땅을 파고 들어가 큰 구덩이를 내며 폭발.</div>
            <div className={box}>🌊 <b>파도</b> — S자 물결. 맞은 상대를 50px 밀어내요 (맵 끝으로 밀어붙이기!).</div>
            <div className={box}>🎆 <b>산탄</b> — 작은 낙서 4개 이상. 흩어지며 여러 번 터져요.</div>
            <div className={box}>🪨 <b>몽둥이</b> — 그 밖의 낙서(작은 덩어리 등). 묵직한 둔기 피해.</div>
          </div>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-white/60 light:text-slate-500">
            <li>뾰족한 꼭짓점이 많을수록 <b>치명타</b> 확률↑ (×1.6, 최대 45%).</li>
            <li>잉크를 많이 쓸수록 무거워져 <b>피해↑ 속도↓</b> — 큰 폭탄은 멀리 못 던져요.</li>
            <li>직격하면 피해 +20%. 내 폭발에 휘말리면 절반 피해를 입어요.</li>
          </ul>
        </section>

        <section>
          <h3 className={h3}>② 색 → 효과 12종 (가장 많이 쓴 색)</h3>
          <div className={box}>
            <ul className="grid gap-1 text-xs text-white/70 sm:grid-cols-2 light:text-slate-600">
              <li>⚫ 검정 — 강철: 피해 +10%</li>
              <li>🔴 빨강 — 🔥 화상: 지속 피해</li>
              <li>🔵 파랑 — ❄️ 빙결: 잉크 감소 / 무빙에선 1.2초 꽁꽁</li>
              <li>🟢 초록 — ☠️ 중독: 긴 지속 피해</li>
              <li>🟡 노랑 — 전기: 연쇄 +1, 20% 확률 💫 기절</li>
              <li>🩵 하늘 — 🐌 느려짐(50% 확률): 이동 절반 + 발사 힘 −7%</li>
              <li>🟤 갈색 — 💫 기절(45% 확률): 스탑에선 한 턴 쉼, 무빙에선 1.5초 행동 불가 (피해 −20%)</li>
              <li>🟣 보라 — ⬇️ 약화: 주는 피해 −20%</li>
              <li>🟠 주황 — 💔 취약: 받는 피해 +25%</li>
              <li>🩷 분홍 — 흡혈: 준 피해의 30% 회복</li>
              <li>⚪ 회색 — 😵 혼란(50% 확률): 스탑에선 다음 발사 각도가 4~9° 빗나감, 무빙에선 좌우 조작 반대</li>
              <li>🔷 남색 — 🕶️ 실명(50% 확률): 조준선·바람이 안 보이고 시야가 어두워지며, 발사 힘이 ±3~8 흔들림</li>
            </ul>
            <p className="mt-1.5 text-xs text-white/60 light:text-slate-500">🎨 두 번째로 많이 쓴 색이 잉크의 35% 이상이면 그 효과도 50% 확률로 붙어요(흡혈은 절반). 기절·혼란·느려짐·실명은 연속으로 걸리지 않아요.</p>
          </div>
        </section>

        <section>
          <h3 className={h3}>③ 내 차례에 할 수 있는 일 (셋 중 하나)</h3>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className={box}>⚔️ <b>무기 그리기</b> — 공책 패드에 그리고, 각도·힘을 정해 발사. 경기장을 드래그해서 조준할 수도 있어요. 점선은 궤적의 앞부분만 보여줘요.</div>
            <div className={box}>🛡️ <b>방패</b> — 공책 패드에 그린 모양이 내 옆(정한 방향)에 방패로 서요. 내구도 = 잉크 ×1.3, 다음 내 차례까지 받는 피해 −40%.</div>
            <div className={box}>🧱 <b>벽 그리기</b> — 내 주변 파란 영역에 직접 선을 그어 벽 생성. 내구도 = 사용한 잉크. 상대 바로 옆에는 그릴 수 없어요.</div>
          </div>
          <p className="mt-2 text-xs text-white/60 light:text-slate-500">
            🚶 <b>이동</b> — 행동 전에 좌우로 최대 80px 걸을 수 있어요. 4px 걸을 때마다 잉크 1이 들어서(80px = 잉크 20), 많이 걸을수록 그릴 잉크가 줄어요. 상대나 땅에 붙은 벽은 지나갈 수 없어요.
          </p>
          <p className="mt-2 text-xs text-white/50 light:text-slate-500">🌬️ 바람은 매 턴 바뀌어요. 제한 시간 45초가 지나면 그려둔 무기가 자동 발사되고, 없으면 패스합니다.</p>
        </section>

        <section>
          <h3 className={h3}>④ 모드</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className={box}>🛑 <b>스탑 모드</b> — 포트리스처럼 한 명씩 차례로. 턴마다 잉크 100, 이동·무기·방패·벽 중 하나. 10라운드. ⚙️ 방장은 턴 시간(30/45/60초)·라운드 수(5/10/15)·턴당 잉크(70/100/130)를 바꿀 수 있어요.</div>
            <div className={box}>
              🏃 <b>무빙 모드</b> — 모두 동시에 실시간! ←/→(A/D) 이동, ↑/W/스페이스 점프. 경기장을 드래그해 조준하고 놓으면 발사(F/Enter도 발사). 잉크는 초당 16씩 차오르고(최대 100), 발사 후 1.8초 재장전. 그린 무기는 남아 있어 계속 다시 쏠 수 있어요. 방패는 6초, 3분이 지나면 체력 높은 순. ⚙️ 방장은 대기실에서 이동 속도·재장전·피해량·잉크 충전·시간을 바꾸거나, 🧘 기본·⚔️ 난전·🎯 저격전·⚡ 속공전 프리셋을 한 번에 고를 수 있어요.
            </div>
          </div>
        </section>

        <section>
          <h3 className={h3}>⑤ 캐릭터 & 맵</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className={box}>🎭 <b>캐릭터 6종</b> — 마법사·고양이·개구리·토끼·병아리·펭귄. 방에 들어가기 전이나 대기실에서 고르고, 겹치면 먼저 고른 사람이 우선이에요 (능력 차이 없음).</div>
            <div className={box}>
              🗺️ <b>맵 4종</b> (방장이 선택, 랜덤 가능)
              <ul className="mt-1 space-y-0.5 text-xs text-white/60 light:text-slate-500">
                <li>🌼 공책 들판 — 기본</li>
                <li>🏜️ 모래 사막 — 바람 1.6배</li>
                <li>❄️ 눈 덮인 산 — 구덩이 1.4배</li>
                <li>🌋 불꽃 화산 — 구덩이 0.7배, 들쭉날쭉한 지형</li>
              </ul>
            </div>
          </div>
        </section>
      </div>
    </Overlay>
  );
}
