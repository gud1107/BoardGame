"use client";

import { useState } from "react";
import Overlay from "@/components/Overlay";
import {
  BELT_SPEED,
  BOX_INFO,
  COLD_LIFE_MS,
  DASH_CD_MS,
  DEST_INFO,
  EXPRESS_BONUS,
  EXPRESS_MS,
  FULL_BONUS,
  INCIDENT_EVERY_MS,
  INCIDENT_FIRST_MS,
  INCIDENT_INFO,
  INCIDENT_KINDS,
  LEVEL_INFO,
  MISS_PENALTY,
  ROLES,
  ROLE_INFO,
  SCAN_BONUS,
  SHOT_BONUS,
  STAR_TITLES,
  THROW_RANGE,
  THROW_RANGE_PITCHER,
  TRUCK_AWAY_MS,
  TRUCK_STAY_MS,
  UNKNOWN_AFTER_MS,
  type BoxKind,
  type Level,
} from "./data";

const H3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";
const LIST = "list-disc space-y-1.5 pl-4 text-white/70 light:text-slate-600";

type Tab = "basic" | "controls" | "boxes" | "trucks" | "roles" | "incidents" | "score";
const TABS: { id: Tab; label: string }[] = [
  { id: "basic", label: "📦 기본" },
  { id: "controls", label: "🎮 조작" },
  { id: "boxes", label: "🥚 상자 종류" },
  { id: "trucks", label: "🚚 트럭" },
  { id: "roles", label: "🎭 역할" },
  { id: "incidents", label: "🚨 돌발 사건" },
  { id: "score", label: "★ 점수·모드" },
];

const sec = (ms: number) => `${ms / 1000}초`;

/** 게임 중 📖 버튼 — 전체 룰북(boardGameRule/택배대란/택배대란.md)의 앱 적용판 요약. */
export default function RulebookModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("basic");
  return (
    <Overlay title="📖 택배 대란 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-4 text-sm text-white/80 light:text-slate-700">
        <div className="flex flex-wrap gap-1.5" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-full border px-3 py-1 text-xs font-bold ${tab === t.id ? "border-amber-400 bg-amber-500/20 text-amber-100 light:text-amber-800" : "border-white/15 text-white/60 light:border-slate-300 light:text-slate-600"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "basic" && (
          <section>
            <h3 className={H3}>목표</h3>
            <ul className={LIST}>
              <li>물류 창고 근무 시간(2·3·4분) 동안 컨베이어에서 나오는 상자를 집어, 라벨이 같은 🚚 트럭 칸에 들고 들어가요. 칸에 들어가면 자동으로 실려요.</li>
              <li>
                목적지는 색 + 기호 + 이름으로 구분해요:{" "}
                {DEST_INFO.map((d) => (
                  <span key={d.sym} className="mr-1 inline-block rounded px-1.5 text-white" style={{ background: d.color }}>
                    {d.sym} {d.name}
                  </span>
                ))}
              </li>
              <li>
                컨베이어는 초당 {BELT_SPEED}m로 흘러요. 끝까지 간 상자는 🗑️ 반송 — 협동에선 팀 점수 −{MISS_PENALTY}.
              </li>
              <li>
                시작 {sec(UNKNOWN_AFTER_MS)} 뒤부터 가끔 ❓ 라벨 없는 상자가 나와요. 들고 왼쪽 🔍 스캐너 원에 들어가면 라벨이 보여요(+{SCAN_BONUS}).
              </li>
              <li>물량은 근무 후반으로 갈수록 늘어나요. {(Object.keys(LEVEL_INFO) as Level[]).map((l) => `${LEVEL_INFO[l].emoji} ${LEVEL_INFO[l].name} ×${LEVEL_INFO[l].rate}`).join(" · ")}.</li>
            </ul>
          </section>
        )}

        {tab === "controls" && (
          <section>
            <h3 className={H3}>키보드 / 휴대폰</h3>
            <ul className={LIST}>
              <li>이동: WASD·방향키 / 왼쪽 화면을 끌어 조이스틱</li>
              <li>🤲 잡기·놓기: Space·J·E / 큰 버튼 — 가까운(앞쪽) 상자를 집고, 다시 누르면 앞에 내려놔요. 컨베이어 위 상자도 옆에서 집을 수 있어요.</li>
              <li>
                🎯 던지기: K·F — 보는(움직이는) 방향으로 {THROW_RANGE}m(🎯 투수 {THROW_RANGE_PITCHER}m). 날아가는 상자는 빈손인 사람이 가까이 있으면 받아요. 트럭 칸에 떨어지면 바로 실려요(🎯 슛 +{SHOT_BONUS}).
              </li>
              <li>💨 돌진: Shift·L — 잠깐 빠르게 ({sec(DASH_CD_MS)}마다). 🛋️ 가구를 들고는 못 해요.</li>
              <li>던진 상자는 선반 위로 넘어가요. 몸은 선반·컨베이어를 못 지나가요.</li>
            </ul>
          </section>
        )}

        {tab === "boxes" && (
          <section>
            <h3 className={H3}>상자 5종</h3>
            <ul className={LIST}>
              {(Object.keys(BOX_INFO) as BoxKind[]).map((k) => (
                <li key={k}>
                  {BOX_INFO[k].emoji} <b>{BOX_INFO[k].name}</b> ({BOX_INFO[k].value}점) — {BOX_INFO[k].desc}
                </li>
              ))}
              <li>
                🧊 냉장은 {sec(COLD_LIFE_MS)} 뒤 녹아 사라져요(−{MISS_PENALTY}). ⚡ 특급은 {sec(EXPRESS_MS)} 안에 실으면 +{EXPRESS_BONUS}.
              </li>
              <li>🛋️ 가구를 팀원이 혼자 들고 있으면, 반대쪽에서 🤲를 눌러 같이 들 수 있어요(협동). 둘이 같은 쪽으로 밀어야 빨라요 — 반대로 밀면 안 움직여요.</li>
              <li>🥚는 던지거나(🎯 투수 빼고) 부딪혀 떨어뜨리면 깨져요(−{MISS_PENALTY}). 내려놓는 건 괜찮아요.</li>
            </ul>
          </section>
        )}

        {tab === "trucks" && (
          <section>
            <h3 className={H3}>트럭</h3>
            <ul className={LIST}>
              <li>윗벽 칸마다 트럭이 한 대씩 서 있어요. 1~2인은 3대(5개씩), 3인 이상은 4대(6개씩).</li>
              <li>
                가득 차면 바로 출발 — 🚚 가득 보너스 +{FULL_BONUS}. 가득 안 차도 {sec(TRUCK_STAY_MS)}가 지나면 실린 만큼만 싣고 떠나요(빈 트럭은 더 기다림).
              </li>
              <li>떠난 트럭은 {sec(TRUCK_AWAY_MS)} 뒤 빈 트럭으로 다시 와요. 그동안 그 목적지 상자는 칸 앞에서 기다리거나 바닥에 잠깐 놔두세요.</li>
              <li>위 트럭 현황에서 남은 시간(⏱)과 실린 개수를 볼 수 있어요. 내 상자 트럭은 👈 표시와 칸 깜빡임으로 알려줘요.</li>
            </ul>
          </section>
        )}

        {tab === "roles" && (
          <section>
            <h3 className={H3}>🎭 역할 (켜기/끄기 가능)</h3>
            <ul className={LIST}>
              {ROLES.map((r) => (
                <li key={r}>
                  {ROLE_INFO[r].emoji} <b>{ROLE_INFO[r].name}</b> — {ROLE_INFO[r].desc}
                </li>
              ))}
              <li>판마다 섞어서 나눠요. 5~6명이면 두 번째 바퀴부터 겹쳐요. 역할마다 혼자서는 못 하는 일이 있어서, 한 사람이 다 지시하기보다 각자 잘하는 걸 맡는 게 빨라요.</li>
            </ul>
          </section>
        )}

        {tab === "incidents" && (
          <section>
            <h3 className={H3}>🚨 돌발 사건 (켜기/끄기 가능)</h3>
            <ul className={LIST}>
              <li>
                시작 {sec(INCIDENT_FIRST_MS)} 뒤부터 {sec(INCIDENT_EVERY_MS)}마다 하나 (같은 사건 연속 없음, 마지막 8초 없음).
              </li>
              {INCIDENT_KINDS.map((k) => (
                <li key={k}>
                  {INCIDENT_INFO[k].emoji} <b>{INCIDENT_INFO[k].name}</b> ({sec(INCIDENT_INFO[k].ms)}) — {INCIDENT_INFO[k].desc}
                </li>
              ))}
              <li>🚜 지게차는 2초 동안 길이 노랗게 깜빡인 뒤 지나가요. 길 위의 사람은 밀려나고 든 상자를 떨어뜨려요(🥚는 깨짐).</li>
            </ul>
          </section>
        )}

        {tab === "score" && (
          <section>
            <h3 className={H3}>🤝 협동</h3>
            <ul className={LIST}>
              <li>모두의 점수가 팀 점수로 합쳐져요. 놓친 상자(반송·깨짐·녹음)는 −{MISS_PENALTY}.</li>
              <li>
                ★ 기준은 인원·근무 시간·물량으로 정해지고 시작 화면에 보여요: ★ {STAR_TITLES[1]} · ★★ {STAR_TITLES[2]} · ★★★ {STAR_TITLES[3]}. 별 1개 이상이면 모두 승리로 기록돼요.
              </li>
            </ul>
            <h3 className={`${H3} mt-4`}>⚔️ 실적 경쟁</h3>
            <ul className={LIST}>
              <li>내가 실은 값 + 🎯 슛·⚡ 덤 + 🚚 마지막 상자로 가득 채운 보너스가 내 점수. 놓친 상자 벌점은 없어요.</li>
              <li>💨 돌진으로 상자를 든 사람을 들이받으면 상자를 떨어뜨려요(🛋️ 가구는 안 떨어짐, 🥚는 깨짐). 던진 상자는 누구든 가로챌 수 있어요.</li>
              <li>🐢 꼴찌(혼자일 때)는 6% 빠르게. 동점이면 실은 개수 → 덜 깨뜨린 사람.</li>
              <li>🛋️ 가구는 경쟁에선 같이 들 수 없어요 — 💪 장사가 유리해요.</li>
            </ul>
          </section>
        )}
      </div>
    </Overlay>
  );
}
