"use client";

import { useState } from "react";
import Overlay from "@/components/Overlay";
import {
  BATTERY_SEC,
  BUDDY_R,
  BURN_MS,
  CHILL_R,
  DIFFICULTIES,
  DIFFICULTY_INFO,
  GRACE_MS,
  ITEM_INFO,
  LANTERN_MS,
  MANIFEST_R,
  MAX_CARRY,
  MAX_TEA,
  MAX_WATER,
  PANIC_CLEAR,
  PANIC_FEAR,
  POSSESS_FEAR,
  POSSESS_R,
  POWERS,
  POWER_ORDER,
  REVIVE_MS,
  RITUAL_R,
  SEARCH_MS,
  SHIMMER_BEAM_R,
  SHIMMER_LIT_R,
  TEA_CALM,
  TIME_LIMIT_MS,
  WARD_R,
  WATER_R,
  WATER_REVEAL_MS,
  WATER_STUN_MS,
  cursesFor,
  ritualRate,
  selfWakeMs,
  soulsFor,
} from "./data";

const H3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";
const LIST = "list-disc space-y-1.5 pl-4 text-white/70 light:text-slate-600";

type Tab = "basic" | "controls" | "fear" | "hunter" | "ghost" | "ritual" | "team";
const TABS: { id: Tab; label: string }[] = [
  { id: "basic", label: "🏯 기본" },
  { id: "controls", label: "🎮 조작" },
  { id: "fear", label: "💓 공포" },
  { id: "hunter", label: "🧿 퇴마사" },
  { id: "ghost", label: "👻 원귀" },
  { id: "ritual", label: "🔥 의식" },
  { id: "team", label: "🤝 협동·결과" },
];

/** 게임 중 📖 버튼 — 전체 룰북(boardGameRule/빙의의밤/빙의의밤.md)의 앱 적용판 요약. */
export default function RulebookModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("basic");
  const s = (ms: number) => `${ms / 1000}초`;
  return (
    <Overlay title="📖 빙의의 밤 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-4 text-sm text-white/80 light:text-slate-700">
        <div className="flex flex-wrap gap-1.5" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`min-h-8 rounded-full border px-3 py-1 text-xs font-semibold transition ${tab === t.id ? "border-cyan-300/70 bg-cyan-400/15 text-cyan-100 light:text-cyan-700" : "border-white/15 text-white/60 hover:border-white/30 light:border-slate-300 light:text-slate-500"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "basic" && (
          <section>
            <h3 className={H3}>목표</h3>
            <ul className={LIST}>
              <li>3~6명. 한 명은 몸이 보이지 않는 👻 원귀, 나머지는 🧿 퇴마사. 무대는 ㅁ자 산골 고택 — 가운데 달빛 마당에 화로가 있다.</li>
              <li>
                🧿 퇴마사: 방마다 숨은 🪆 저주받은 물건(퇴마사 2명 {cursesFor(2)} · 3명 {cursesFor(3)} · 4명 {cursesFor(4)} · 5명 {cursesFor(5)}개)을 찾아 화로에 모두 태운 뒤, 화로 곁에서 🔥 퇴마 의식을 100%까지 채우면 승리.
              </li>
              <li>
                👻 원귀: 혼을 빼앗으면(빙의 횟수 — 퇴마사 2명 {soulsFor(2)} · 3명 {soulsFor(3)} · 4명 {soulsFor(4)} · 5명 {soulsFor(5)}번) 승리. 퇴마사가 모두 한꺼번에 빙의돼 있어도 승리. 첫닭이 울 때({TIME_LIMIT_MS / 60000}분, 새벽 5시)까지 의식이 안 끝나도 승리.
              </li>
              <li>원귀는 시작하고 {s(GRACE_MS)} 동안 힘을 못 쓴다. 원귀가 누구인지는 시작할 때 정해진다(방장이 무작위·자리 번호로 고른다).</li>
            </ul>
          </section>
        )}

        {tab === "controls" && (
          <section>
            <h3 className={H3}>🧿 퇴마사 (키보드 · 마우스)</h3>
            <ul className={LIST}>
              <li>WASD 이동 · Shift 달리기 · 마우스 둘러보기</li>
              <li>
                E/Space 누르고 있기: 뒤지기 {s(SEARCH_MS)} · 화로에 태우기 {s(BURN_MS)} · 등잔 켜기 {s(LANTERN_MS)} · 빙의된 동료 퇴마 {s(REVIVE_MS)}
              </li>
              <li>F 손전등 · Q/클릭 💧 성수 · R 🍵 청심환 · M 지도</li>
            </ul>
            <h3 className={`${H3} mt-3`}>👻 원귀</h3>
            <ul className={LIST}>
              <li>WASD 떠다니기(벽을 뚫는다) · 마우스 둘러보기 · 1~5 힘 · E/클릭 빙의 · M 지도</li>
            </ul>
            <h3 className={`${H3} mt-3`}>터치</h3>
            <ul className={LIST}>
              <li>왼쪽 아래 끌어서 이동(끝까지 = 달리기) · 오른쪽 화면 끌어서 둘러보기 · 버튼으로 행동·힘</li>
            </ul>
          </section>
        )}

        {tab === "fear" && (
          <section>
            <h3 className={H3}>💓 공포 (0~100)</h3>
            <ul className={LIST}>
              <li>차오른다: {BUDDY_R}m 안에 서 있는 동료가 없을 때 · 등잔이 꺼진 방(손전등까지 끄면 더) · 저주받은 물건을 들고 있을 때 · 원귀가 {CHILL_R}m 안(한기 — 입김) · 원귀의 힘.</li>
              <li>가라앉는다: 동료 곁 · 🏮 켜진 등잔 방 · 달빛 마당 · 🍵 청심환(-{TEA_CALM}).</li>
              <li>
                <b>{POSSESS_FEAR} 이상 + 혼자</b>면 원귀가 {POSSESS_R}m 안에서 빙의할 수 있다. <b>{PANIC_FEAR} = 😱 공황</b>: 달릴 수 없고 손전등이 떨리며, 동료가 곁에 있어도 빙의당한다({PANIC_CLEAR}까지 내려가야 풀린다).
              </li>
              <li>내 공포는 💓 막대·화면 가장자리 붉은 빛·심장 소리로 나온다. 동료의 공포도 왼쪽 위 목록에 보인다.</li>
            </ul>
          </section>
        )}

        {tab === "hunter" && (
          <section>
            <h3 className={H3}>🧿 퇴마사의 도구</h3>
            <ul className={LIST}>
              <li>🔦 손전등: 100%로 {BATTERY_SEC}초. 빛줄기 {SHIMMER_BEAM_R}m 안의 원귀는 희미한 그림자로 보인다.</li>
              <li>
                🔮 영기 탐지기: 원귀까지 14m · 8m · 4m 안이면 1·2·3칸. 동료와 칸 수를 맞춰 보면 원귀가 어디쯤인지 짐작할 수 있다.
              </li>
              <li>
                💧 {ITEM_INFO.water.name}: 앞쪽 {WATER_R}m로 뿌린다 — 원귀가 맞으면 {s(WATER_STUN_MS)} 묶이고 {s(WATER_REVEAL_MS)} 모습이 드러나며 원한 -25. 최대 {MAX_WATER}개.
              </li>
              <li>🍵 {ITEM_INFO.tea.name}: 공포 -{TEA_CALM}. 최대 {MAX_TEA}개. 🔋 건전지: 손전등 +50%.</li>
              <li>🏮 등잔: 방마다 하나. 켜 두면 그 방에선 공포가 가라앉고, 그 방의 원귀는 {SHIMMER_LIT_R}m 안에서 희미하게 보인다. 원귀가 🕯️ 소등으로 끈다.</li>
              <li>🪆 물건은 한 번에 {MAX_CARRY}개까지. 빙의되면 그 자리에 떨어뜨린다(누구든 주울 수 있다).</li>
            </ul>
          </section>
        )}

        {tab === "ghost" && (
          <section>
            <h3 className={H3}>👻 원귀의 힘 (원한을 쓴다 — 초당 3.4씩 모인다, 퇴마사가 많을수록 빨리)</h3>
            <ul className={LIST}>
              {POWER_ORDER.map((k) => (
                <li key={k}>
                  {POWERS[k].emoji} <b>{POWERS[k].name}</b> ({POWERS[k].key}) — 원한 {POWERS[k].cost} · 대기 {POWERS[k].cdMs / 1000}초: {POWERS[k].desc}
                </li>
              ))}
            </ul>
            <h3 className={`${H3} mt-3`}>원귀의 눈과 몸</h3>
            <ul className={LIST}>
              <li>벽을 뚫고 떠다니고, 어둠 속에서도 다 본다. 퇴마사는 공포만큼 붉게 빛나고, 저주받은 물건이 든 곳은 붉은 기운이 샌다.</li>
              <li>마당 화로의 결계({WARD_R}m) 안으로는 못 들어간다. 현신({MANIFEST_R}m 안 겁주기)·성수에 맞은 동안은 느려지고 모두에게 보인다.</li>
              <li>원귀가 어디 있는지는 원귀 기기만 안다 — 다른 사람에게는 모습이 드러났을 때만 위치가 전해진다.</li>
            </ul>
          </section>
        )}

        {tab === "ritual" && (
          <section>
            <h3 className={H3}>🔥 퇴마 의식</h3>
            <ul className={LIST}>
              <li>물건을 모두 태우면 시작된다. 화로 {RITUAL_R}m 안에 선 사람 수에 따라 초당 1명 {ritualRate(1)}% · 2명 {ritualRate(2)}% · 3명 이상 {ritualRate(3)}%.</li>
              <li>원귀는 화로 6m 안에서 🌫️ 불길 꺾기로 -25%. 의식하는 사람을 겁줘 흩어 놓는 것도 방법.</li>
            </ul>
          </section>
        )}

        {tab === "team" && (
          <section>
            <h3 className={H3}>협동</h3>
            <ul className={LIST}>
              <li>
                빙의된 동료는 옆에서 {s(REVIVE_MS)} 붙들면 깨어난다(혼은 이미 빼앗겼다). 아무도 안 오면 {selfWakeMs(2) / 1000}초 뒤 스스로 깨어난다. 깨어난 뒤 5초 동안은 안전하다.
              </li>
              <li>둘씩 짝을 지어 뒤지고, 한 사람은 손전등으로 짝의 등 뒤를 비춰 주자 — 그림자가 보이면 💧!</li>
              <li>나간 사람 자리는 10초 뒤 봇이 대신하고, 판정 기기가 나가도 다른 사람이 판을 이어받는다(그때 원귀 자리와 물건 자리는 새로 정해진다).</li>
            </ul>
            <h3 className={`${H3} mt-3`}>밤의 어둠 (난이도 — 퇴마사 기준)</h3>
            <ul className={LIST}>
              {DIFFICULTIES.map((d) => (
                <li key={d}>
                  {DIFFICULTY_INFO[d].emoji} {DIFFICULTY_INFO[d].label} — {DIFFICULTY_INFO[d].desc}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Overlay>
  );
}
