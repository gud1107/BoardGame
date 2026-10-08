"use client";

import Overlay from "@/components/Overlay";
import { BOSS_EVERY, GRADE_COLORS, GRADE_NAMES, LOAD_LIMIT, SEND_EVERY, UNIT_KINDS, UNITS } from "./engine";

export default function RulebookModal({ onClose }: { onClose: () => void }) {
  const h3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";
  return (
    <Overlay title="📖 랜덤 합성 디펜스 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80 light:text-slate-700">
        <section>
          <h3 className={h3}>목표</h3>
          <p className="text-white/70 light:text-slate-600">
            모두가 똑같은 웨이브를 동시에 막는 실시간 생존 대결이에요. 내 길 위의 몬스터가{" "}
            <b className="text-rose-300 light:text-rose-600">{LOAD_LIMIT}마리</b>에 닿으면 탈락하고, 마지막까지 버틴 사람이
            승리해요.
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
              <b>🎯 사거리</b>: 유닛은 점선 원 안을 지나는 몬스터만 공격해요. 길과 가까운 칸일수록 오래 때려요 — 특히 왼쪽·오른쪽
              가운데 칸이 길을 가장 넓게 덮어요.
            </li>
            <li>
              <b>🧭 배치 가이드</b>: 켜 두면 빈 칸마다 길을 얼마나 덮는지 %로 보여줘요(★ = 가장 좋은 자리). 유닛을 고르거나 끌고 있을 때는 그 유닛의 사거리
              기준으로 바뀌어요.
            </li>
            <li>
              <b>↔️ 이동</b>: 유닛을 끌어 다른 칸에 놓거나(겹치면 자리 교환), 유닛을 고른 뒤 빈 칸을 눌러 옮길 수 있어요.
            </li>
            <li>
              <b>🔀 합성</b>: <b>종류와 등급이 같은</b> 유닛 2개를 겹치면(드래그하거나 차례로 탭) 한 단계 높은 등급의{" "}
              <b>무작위 종류</b> 유닛 1개가 돼요. 무엇이 나올지는 운!
            </li>
            <li>
              <b>💎 도박</b>: 보석 1개로 희귀~전설 유닛을 노려요(20%는 꽝). 보석은 시작할 때 1개, 보스를 잡을 때마다 2개 받아요.
            </li>
            <li>
              <b>⬆️ 강화</b>: 골드로 종류별 공격력을 영구히 올려요(레벨당 +15%, 최대 Lv.10).
            </li>
          </ol>
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
            <li>웨이브는 20초마다 오고 갈수록 단단해져요. {BOSS_EVERY}웨이브마다 보스가 나와요 — 살아 있는 동안 4초마다 졸개를 불러요.</li>
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
