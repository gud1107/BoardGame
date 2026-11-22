"use client";

import { useState } from "react";
import Overlay from "@/components/Overlay";
import Portrait from "./Portrait";
import { COMBO_MS, DIFF, ENEMIES, GRAZE_R, INVULN_MS, MAX_POWER, MID_TIMEOUT_MS, PILOTS, PILOT_IDS, REVIVE_MS, SELF_REVIVE_MS, SELF_REVIVE_PENALTY, STAGES, STAR_SCORE } from "./data";

const H3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";
const LIST = "list-disc space-y-1.5 pl-4 text-white/70 light:text-slate-600";

type Tab = "basic" | "controls" | "pilots" | "flow" | "squad" | "score";
const TABS: { id: Tab; label: string }[] = [
  { id: "basic", label: "✈️ 기본" },
  { id: "controls", label: "🎮 조작" },
  { id: "pilots", label: "🧑‍✈️ 조종사" },
  { id: "flow", label: "🗺️ 스테이지" },
  { id: "squad", label: "🤝 협동" },
  { id: "score", label: "🧮 점수" },
];

/** 게임 중 📖 버튼 — 전체 룰북(boardGameRule/구름편대/구름편대.md)의 앱 적용판 요약. */
export default function RulebookModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("basic");
  const s = (ms: number) => `${ms / 1000}초`;
  return (
    <Overlay title="📖 구름 편대 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-4 text-sm text-white/80 light:text-slate-700">
        <div className="flex flex-wrap gap-1.5" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-full border px-3 py-1 text-xs font-bold ${tab === t.id ? "border-sky-400 bg-sky-500/20 text-sky-100 light:text-sky-800" : "border-white/15 text-white/60 light:border-slate-300 light:text-slate-600"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "basic" && (
          <section>
            <h3 className={H3}>목표</h3>
            <ul className={LIST}>
              <li>1~4명이 조종사를 하나씩 골라 편대를 짜고, 스테이지마다 잡몹 → 중간 보스 → 보스를 격파해요. 마지막 보스를 잡으면 원정 성공(모두 1등), 편대가 전멸하면 실패예요.</li>
              <li>사격은 자동이에요. 탄을 피하는 데만 집중하면 돼요.</li>
              <li>
                <b>판정점</b>은 기체 가운데 작은 흰 점뿐이에요. 날개에 탄이 겹쳐도 판정점에 안 닿으면 안 맞아요. 맞으면 체력 1칸이 줄고 {s(INVULN_MS)} 동안 무적이에요.
              </li>
              <li>적탄은 모두 흰 테두리 링이 있어요(아군 탄은 테두리 없는 빛). 색이 잘 안 보여도 모양으로 구분할 수 있어요.</li>
              <li>
                아이템: <b>P</b> 파워 업(최대 {MAX_POWER}단계, 탄이 굵어지고 늘어남) · <b>+</b> 체력 1칸 · <b>★</b> 별 +{STAR_SCORE}점. 가까이 가면 빨려 와요. 격추되면 파워가 1 내려가요.
              </li>
            </ul>
          </section>
        )}

        {tab === "controls" && (
          <section>
            <h3 className={H3}>키보드</h3>
            <ul className={LIST}>
              <li>WASD / 방향키 — 이동</li>
              <li>Shift — 정밀 비행 (느려지고 판정점·스침 범위가 보여요)</li>
              <li>Space / J / Q — 스킬 (조종사마다 다름, 재사용 대기 있음)</li>
              <li>E / K — 궁극기 (노란 게이지 100%)</li>
            </ul>
            <h3 className={`${H3} mt-4`}>터치 · 마우스</h3>
            <ul className={LIST}>
              <li>화면 아무 데나 대고 끌면 손가락이 움직인 만큼 기체가 따라와요(기체 속도 한도 안에서). 손가락이 기체를 가리지 않아요.</li>
              <li>두 손가락을 대면 정밀 비행.</li>
              <li>오른쪽 아래 버튼: 작은 것 = 스킬, 큰 ★ = 궁극기.</li>
            </ul>
          </section>
        )}

        {tab === "pilots" && (
          <section className="flex flex-col gap-3">
            {PILOT_IDS.map((id) => {
              const P = PILOTS[id];
              return (
                <div key={id} className="flex gap-3 rounded-xl border border-white/10 p-2 light:border-slate-200">
                  <Portrait id={id} size={56} />
                  <div className="flex min-w-0 flex-col gap-0.5 text-xs">
                    <b style={{ color: P.color }}>
                      {P.name} · {P.role} <span className="font-normal text-white/50 light:text-slate-500">체력 {P.maxHp} · 스킬 대기 {s(P.skillCd)}</span>
                    </b>
                    <span>🔫 {P.shot.name} — {P.shot.desc}</span>
                    <span>⚡ {P.skill.name} — {P.skill.desc}</span>
                    <span>★ {P.ult.name} — {P.ult.desc}</span>
                  </div>
                </div>
              );
            })}
            <p className="text-xs text-white/50 light:text-slate-500">한 판에 같은 조종사는 한 명만 고를 수 있어요.</p>
          </section>
        )}

        {tab === "flow" && (
          <section>
            <h3 className={H3}>스테이지 흐름</h3>
            <ul className={LIST}>
              {STAGES.map((st, i) => (
                <li key={i}>
                  <b>{st.name}</b> — 잡몹 {Math.round(st.wavesA / 1000)}초 → 중간 보스 {ENEMIES.frigate.name}({s(MID_TIMEOUT_MS)} 안에 못 잡으면 물러남) → 잡몹 {Math.round(st.wavesB / 1000)}초 → ⚠ 경고 → 보스 <b>{ENEMIES[st.boss].name}</b>
                </li>
              ))}
              <li>보스는 체력 66%·33%에서 공격이 바뀌어요. 바뀌는 순간 화면 탄 절반이 별이 돼요.</li>
              <li>번개 줄기: 점선 기둥으로 0.9초 먼저 예고돼요. 기둥 밖으로 피하세요.</li>
              <li>2분 넘게 보스를 못 잡으면 보스가 광폭화해서 탄이 빨라져요.</li>
              <li>
                난이도:{" "}
                {(["easy", "normal", "hard"] as const).map((d) => (
                  <span key={d} className="mr-2">
                    {DIFF[d].label}(이어 하기 {DIFF[d].continues}번)
                  </span>
                ))}
              </li>
              <li>적 체력은 인원이 많을수록 늘어나요 (×(0.6 + 0.4×인원)).</li>
            </ul>
          </section>
        )}

        {tab === "squad" && (
          <section>
            <h3 className={H3}>부활</h3>
            <ul className={LIST}>
              <li>체력이 0이 되면 🪂 낙하산을 타고 천천히 떨어져요. 동료가 곁(초록 점선 원)에 {s(REVIVE_MS)} 머물면 체력 1칸으로 부활해요. 여러 명이 같이 있으면 더 빨라요.</li>
              <li>
                아무도 안 오면 {s(SELF_REVIVE_MS)} 뒤 스스로 복귀해요 (−{SELF_REVIVE_PENALTY}점).
              </li>
              <li>편대 전원이 동시에 쓰러지면 이어 하기를 1번 써서 모두 꽉 찬 체력으로 복귀(점수 −20%). 이어 하기가 없으면 원정 실패.</li>
            </ul>
            <h3 className={`${H3} mt-4`}>합동 궁극기 · 스침</h3>
            <ul className={LIST}>
              <li>두 사람이 {s(COMBO_MS)} 안에 궁극기를 쓰면 합동 궁극기: 2.5초 동안 두 사람의 모든 피해 ×1.3, 각자 +2000점.</li>
              <li>판정점 {GRAZE_R}px 안을 지나간 적탄은 스침 — +10점, 궁극기 게이지가 빨리 차요. 게이지는 적에게 피해를 줄 때와 시간이 지날 때도 차요.</li>
            </ul>
          </section>
        )}

        {tab === "score" && (
          <section>
            <h3 className={H3}>점수</h3>
            <ul className={LIST}>
              <li>잡몹은 마지막으로 맞힌 사람, 중간 보스·보스는 준 피해 비율대로 나눠 가져요.</li>
              <li>스테이지 돌파: 각자 +1000 + 남은 체력 1칸당 +500.</li>
              <li>동료 부활 +300 · 스침 +10 · 별 +{STAR_SCORE} · 합동 궁극기 +2000.</li>
              <li>결과 화면에서 점수 1위가 MVP예요. 원정 성공이면 모두 1등, 실패면 모두 2등으로 기록돼요.</li>
            </ul>
          </section>
        )}
      </div>
    </Overlay>
  );
}
