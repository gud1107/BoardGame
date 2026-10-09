"use client";

import Overlay from "@/components/Overlay";
import { BOSS_EVERY, GAMBLE_COST, GAMBLE_ODDS, GRADE_COLORS, GRADE_NAMES, loadLimit, MAP_IDS, MAPS, SEND_EVERY, UNIT_KINDS, UNITS } from "./engine";
import { MapThumb } from "./RoomSettings";

export default function RulebookModal({ onClose }: { onClose: () => void }) {
  const h3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";
  return (
    <Overlay title="📖 랜덤 합성 디펜스 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80 light:text-slate-700">
        <section>
          <h3 className={h3}>목표</h3>
          <p className="text-white/70 light:text-slate-600">
            모두가 똑같은 웨이브를 동시에 막는 실시간 생존 대결이에요. 내 길 위의 몬스터가{" "}
            정해진 마릿수에 닿으면 탈락하고, 마지막까지 버틴 사람이 승리해요. 탈락 기준은 인원에 따라 달라요 — 2인{" "}
            <b className="text-rose-300 light:text-rose-600">{loadLimit(2)}마리</b> · 3인{" "}
            <b className="text-rose-300 light:text-rose-600">{loadLimit(3)}마리</b> · 4인{" "}
            <b className="text-rose-300 light:text-rose-600">{loadLimit(4)}마리</b>(인원이 많을수록 끝까지 남는 데 오래 걸리니 기준이 낮아요). 방장이 방을 만들 때(또는 대기실에서 시작 전까지) 35·45·55·70마리 중에서 직접 정할 수도 있어요. 웨이브 난이도도 🌱 쉬움(몬스터 체력 ×0.7) · ⚖️ 보통 · 🔥 어려움(몬스터 체력 ×1.2 + 웨이브당 몬스터 수 ×1.25) 중에서 고를 수 있어요. 모드·난이도별 내 최고 웨이브 기록이 이 기기에 저장돼요.
          </p>
        </section>

        <section>
          <h3 className={h3}>진행</h3>
          <ol className="list-decimal space-y-1.5 pl-4 text-white/70 light:text-slate-600">
            <li>
              <b>🏗️ 건설 위치</b>: 빈 칸을 눌러 고른 뒤 <b>🎲 소환</b>을 누르면 그 칸에 무작위 유닛이 세워져요. 소환할수록 값이 조금씩
              올라가고, 6% 확률로 처음부터 희귀 등급이 나와요.
            </li>
            <li>
              <b>🎯 사거리</b>: 유닛은 점선 원 안을 지나는 몬스터만 공격해요. 길과 가까운 칸일수록 오래 때려요 — 맵마다 좋은 칸이 달라요(🧭 배치
              가이드가 알려줘요).
            </li>
            <li>
              <b>🧭 배치 가이드</b>: 켜 두면 빈 칸마다 길을 얼마나 덮는지 %로 보여줘요(★ = 가장 좋은 자리). 유닛을 고르거나 끌고 있을 때는 그 유닛의 사거리
              기준으로 바뀌어요.
            </li>
            <li>
              <b>↔️ 이동</b>: 유닛을 끌어 다른 칸에 놓거나(겹치면 자리 교환), 유닛을 고른 뒤 빈 칸을 눌러 옮길 수 있어요.
            </li>
            <li>
              <b>🔀 합성 (무료)</b>: <b>종류와 등급이 같은</b> 유닛 2개를 겹치면(드래그하거나 차례로 탭) 한 단계 높은 등급의{" "}
              <b>무작위 종류</b> 유닛 1개가 돼요. 무엇이 나올지는 운!
            </li>
            <li>
              <b>💎 도박</b>: 보석 {GAMBLE_COST}개로 희귀~전설 유닛을 노려요. 보석은 시작할 때 1개, 보스를 잡을 때마다 2개 받아요.
              <span className="mt-1 flex flex-wrap gap-1.5 text-xs">
                {GAMBLE_ODDS.map((o) => (
                  <span
                    key={o.grade}
                    className="rounded-md border border-white/10 px-1.5 py-0.5 light:border-slate-200"
                    style={o.grade ? { color: GRADE_COLORS[o.grade] } : undefined}
                  >
                    {o.grade ? GRADE_NAMES[o.grade] : "꽝"} <b>{o.pct}%</b>
                  </span>
                ))}
              </span>
            </li>
            <li>
              <b>⬆️ 강화</b>: 골드로 종류별 공격력을 영구히 올려요(레벨당 +15%, 최대 Lv.10).
            </li>
            <li>
              <b>✨ 하이라이트</b>: 지금 누를 수 있는 버튼(소환·도박·합성·강화·집중·결속)은 흰 테두리로 반짝여요.
            </li>
            <li>
              <b>🤖 자동</b>: 위쪽 줄의 <b>🤖 자동</b> 버튼을 켜면 AI가 내 보드를 대신 운영해요(소환·도박·합성·강화·배치). 다시 누르면 꺼지고, 판이 새로
              시작되면 꺼진 상태로 돌아가요. 메뉴에서 맡길 일(소환·도박 / 합성 / 강화 / 배치 / 공격)을 골라 부분만 맡길 수 있고, “💎 보석이 N개 모이면
              한꺼번에 도박”, “⬆️ 골드가 N 이상일 때만 강화” 조건도 걸 수 있어요.
            </li>
          </ol>
        </section>

        <section>
          <h3 className={h3}>맵</h3>
          <p className="mb-2 text-white/70 light:text-slate-600">방장이 방을 만들 때(또는 대기실에서) 고를 수 있어요. 로비의 🏅 기록표 칸을 누르면 그 맵·난이도로 바로 AI와 대결해요. 길 모양과 칸 수가 달라서 좋은 자리도 달라요. 보라색 점이 몬스터가 나오는 포털이에요.</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {MAP_IDS.map((id) => (
              <div key={id} className="flex flex-col gap-1 text-xs">
                <MapThumb id={id} />
                <b>
                  {MAPS[id].emoji} {MAPS[id].name}
                </b>
                <span className="text-white/60 light:text-slate-500">{MAPS[id].desc}</span>
                {MAPS[id].hp !== 1 && <span className="text-white/40 light:text-slate-400">몬스터 체력 ×{MAPS[id].hp}</span>}
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className={h3}>유닛</h3>
          <ul className="space-y-1 text-white/70 light:text-slate-600">
            {UNIT_KINDS.map((k) => (
              <li key={k}>
                {UNITS[k].emoji} <b>{UNITS[k].name}</b> — {UNITS[k].desc}
              </li>
            ))}
          </ul>
          <p className="mt-2 flex flex-wrap gap-x-2 text-xs">
            등급:
            {GRADE_NAMES.slice(1).map((n, i) => (
              <span key={n} style={{ color: GRADE_COLORS[i + 1] }}>
                {n}
              </span>
            ))}
            <span className="text-white/50 light:text-slate-500">(한 단계마다 공격력 ×2.5)</span>
          </p>
        </section>

        <section>
          <h3 className={h3}>웨이브 & 대결</h3>
          <ul className="list-disc space-y-1.5 pl-4 text-white/70 light:text-slate-600">
            <li>웨이브는 20초마다 오고 갈수록 단단해져요. {BOSS_EVERY}웨이브마다 보스가 나와요 — 살아 있는 동안 4초마다 졸개를 불러요(보스 1마리당 쉬움 2 · 보통 4 · 어려움 6마리). 졸개를 다 부르면 😡 광폭화해서 6초마다 가장 가까운 타워를 2초 동안 기절시켜요. 기절한 타워가 있으면 보드 위 <b>⚡ 기절 해제</b>로 골드를 내고 바로 깨울 수 있고, 광폭화한 보스·전쟁군주를 잡으면 골드 50% 보너스와 💎 1개를 더 받아요. 모든 공격은 12% 확률로 <b>치명타</b>(피해 2배, 금색 숫자)가 터져요. 치명타가 0.45초 안에 이어지면 <b>콤보</b>가 쌓여요 — 8콤보에 골드 보너스, 20콤보에 💎 1개(각각 웨이브마다 한 번). ⚔️ 유닛 대결에서는 이때 다음 상대의 가장 강한 타워 2개(20콤보는 3개)를 기절시켜요(상대의 🛡️ 결속만큼 짧아지고, 결속 3단계면 아예 막힌 뒤 <b>반격</b>으로 보낸 사람의 가장 강한 타워가 0.7초 기절해요). <b>🎯 집중</b>을 올리면 단계마다 치명타 확률 +3%p · 배율 +0.15(최대 5단계 = 27% · ×2.75). 강화 줄의 <b>🛡️ 결속</b>을 올리면 기절 시간이 단계마다 25%씩 줄어들어요(최대 3단계 = 0.5초).</li>
            <li>몬스터는 길을 따라 계속 돌아요 — 잡지 못하면 쌓여요. 종류와 상관없이 1마리 = 1로 세요.</li>
            <li>
              몬스터를 {SEND_EVERY}마리 잡을 때마다 다음 상대에게 <b>🔥 정예 몬스터</b>가 넘어가요. 잘 막을수록 상대가 힘들어져요.
            </li>
          </ul>
        </section>

        <section>
          <h3 className={h3}>⚔️ 유닛 대결 모드</h3>
          <ul className="list-disc space-y-1.5 pl-4 text-white/70 light:text-slate-600">
            <li>내 유닛을 고르고 <b>⚔️ 보내기</b>를 누르면 그 유닛이 내 판에서 사라지고 상대 길에 <b>침략자</b>로 나타나요.</li>
            <li>등급이 높을수록 침략자가 단단해요. 보낸 뒤 3초 동안은 다시 보낼 수 없어요.</li>
            <li>
              <b>👾 몬스터 구매</b>: 골드로 몬스터를 사서 상대 길에 보낼 수 있어요 — 🦇 박쥐 떼(빠른 6마리), 👻 망령(아주 빠름·둔화 면역, 2웨이브~), 🪨
              바위 골렘(아주 단단함, 3웨이브~), 👹 전쟁군주(미니 보스, 5웨이브~). 가격은 웨이브마다 올라가고, 유닛 보내기와 3초 재사용 대기시간을 같이 써요.
            </li>
            <li>3~4인전에서는 위쪽 상대 판을 눌러 🎯 대상을 바꿀 수 있어요.</li>
          </ul>
        </section>

        <section className="rounded-xl border border-amber-300/20 bg-amber-400/5 p-3 light:border-amber-300 light:bg-amber-50">
          <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-amber-200/90 uppercase light:text-amber-700">참고</h3>
          <p className="text-xs text-white/60 light:text-slate-600">
            방을 만든 사람의 기기가 전투를 계산해요(호스트). 호스트가 탭을 닫으면 그 판은 멈춰요. 빈자리는 AI로 채울 수 있어요.
          </p>
        </section>
      </div>
    </Overlay>
  );
}
