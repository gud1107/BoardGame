"use client";

import { useState } from "react";
import Overlay from "@/components/Overlay";
import {
  BATTERY_PACK,
  BATTERY_SEC,
  BLEED_MS,
  BREATH_MAX,
  DIFFICULTIES,
  DIFFICULTY_INFO,
  DOOR_MUFFLE,
  FEAR_BEAT_1,
  FEAR_BEAT_2,
  GASP_LOCK_MS,
  GRACE_MS,
  HUSH_MS,
  HUSH_WARN_MS,
  ITEM_INFO,
  MAX_BOTTLES,
  MAX_PILLS,
  NOISE_BEAT_1,
  NOISE_BEAT_2,
  NOISE_BOTTLE,
  NOISE_DOOR,
  NOISE_GASP,
  NOISE_RUN,
  NOISE_SEARCH,
  NOISE_WALK,
  PLACE_MS,
  REVIVE_MS,
  SEARCH_MS,
  TIME_LIMIT_MS,
  talismansFor,
} from "./data";

const H3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";
const LIST = "list-disc space-y-1.5 pl-4 text-white/70 light:text-slate-600";

type Tab = "basic" | "controls" | "sound" | "ghost" | "hush" | "fear" | "items" | "team";
const TABS: { id: Tab; label: string }[] = [
  { id: "basic", label: "🏥 기본" },
  { id: "controls", label: "🎮 조작" },
  { id: "sound", label: "🔊 소리" },
  { id: "ghost", label: "👂 청귀" },
  { id: "hush", label: "🔔 종" },
  { id: "fear", label: "💓 공포·숨" },
  { id: "items", label: "🧧 물건" },
  { id: "team", label: "✚ 협동·결과" },
];

/** 게임 중 📖 버튼 — 전체 룰북(boardGameRule/숨죽인병동/숨죽인병동.md)의 앱 적용판 요약. */
export default function RulebookModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("basic");
  const s = (ms: number) => `${ms / 1000}초`;
  return (
    <Overlay title="📖 숨죽인 병동 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-4 text-sm text-white/80 light:text-slate-700">
        <div className="flex flex-wrap gap-1.5" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-full border px-3 py-1 text-xs font-bold ${tab === t.id ? "border-emerald-400 bg-emerald-500/20 text-emerald-100 light:text-emerald-800" : "border-white/15 text-white/60 light:border-slate-300 light:text-slate-600"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "basic" && (
          <section>
            <h3 className={H3}>🏥 무엇을 하나</h3>
            <ul className={LIST}>
              <li>새벽 3시, 문 닫은 요양병원 3병동. 들어오자마자 현관이 잠겼어요. 1~4명이 <b>협동</b>해서 빠져나가야 해요.</li>
              <li>
                병동 곳곳의 <b>서랍장</b>을 뒤져 <b>🧧 봉인 부적</b>을 찾고(1인 {talismansFor(1)}장 · 2인 {talismansFor(2)}장 · 3인 {talismansFor(3)}장 · 4인 {talismansFor(4)}장), 가운데 <b>🕯️ 기도실 제단</b>에 전부 붙이면 현관 자물쇠가 풀려요.
              </li>
              <li>자물쇠가 풀리면 <b>로비 남쪽 현관</b>으로 가면 탈출. <b>한 명이라도 나가면 팀 승리</b>, 전원이 무사히 나가면 S등급.</li>
              <li>
                병동에는 <b>청귀(聽鬼)</b>가 돌아다녀요. 눈이 꿰매어져 <b>아무것도 못 보고 소리만 들어요</b>. 손전등은 마음껏 켜도 되지만, 발소리·문소리·심장 소리는 안 돼요.
              </li>
              <li>새벽 4:44(실제 {TIME_LIMIT_MS / 60000}분)가 되면 문이 영영 닫혀요. 모두 쓰러져도 끝.</li>
              <li>시작하고 {s(GRACE_MS)} 동안은 청귀가 잠들어 있어요 — 그동안 조작을 익히세요.</li>
            </ul>
          </section>
        )}

        {tab === "controls" && (
          <section>
            <h3 className={H3}>🎮 조작</h3>
            <ul className={LIST}>
              <li><b>PC</b>: 화면을 클릭하면 마우스로 둘러봐요(Esc로 풀기). WASD 이동 · Shift 달리기 · C 앉기(다시 누르면 서기) · Space 누르고 있는 동안 숨 참기.</li>
              <li>E 상호작용(서랍·제단·동료는 <b>누르고 있기</b>, 문은 한 번) · F 손전등 · Q 또는 클릭 약병 던지기 · R 진정제 · M 지도.</li>
              <li><b>휴대폰</b>: 왼쪽을 끌어 이동(끝까지 밀면 달리기), 오른쪽을 끌어 시선. 버튼 ✋ 상호작용 · 🤫 숨(누르고 있기) · ⬇ 앉기 · 🔦 · 🍾 · 💊 · 🗺️.</li>
              <li>약병은 바라보는 쪽으로 날아가요. 위를 볼수록 멀리(4~12m), 벽에 맞으면 그 앞에서 깨져요.</li>
              <li>🗺️ 지도에는 내 위치·동료·뒤진 서랍이 나와요. <b>청귀는 지도에 나오지 않아요.</b></li>
              <li>⚙️ 설정: 화질 · 시선 감도 · 놀람 연출 줄이기(비명·흔들림·번쩍임을 약하게).</li>
            </ul>
          </section>
        )}

        {tab === "sound" && (
          <section>
            <h3 className={H3}>🔊 소리 — 이 게임의 전부</h3>
            <ul className={LIST}>
              <li>모든 행동에는 <b>소리 반경</b>이 있어요. 청귀의 귀까지 <b>길을 따라 잰 거리</b>(벽은 못 뚫고 복도를 돌아가요)가 반경 안이면 들려요.</li>
              <li>
                앉아 걷기 <b>0m(무음)</b> · 걷기 <b>{NOISE_WALK}m</b> · 달리기 <b>{NOISE_RUN}m</b> · 문 여닫기 <b>{NOISE_DOOR}m</b>(앉아서 하면 무음) · 서랍 뒤지기 <b>{NOISE_SEARCH}m</b>
              </li>
              <li>
                심장 소리 <b>{NOISE_BEAT_1}m</b>(공포 {FEAR_BEAT_1}↑) / <b>{NOISE_BEAT_2}m</b>(공포 {FEAR_BEAT_2}↑) · 숨 터짐 <b>{NOISE_GASP}m</b> · 약병 깨짐 <b>{NOISE_BOTTLE}m</b>
              </li>
              <li>닫힌 문 하나는 소리를 {DOOR_MUFFLE}m만큼 막아 줘요 — 방에 들어가 문을 닫고 뒤지면 훨씬 안전해요.</li>
              <li>화면 왼쪽 아래 🔇/🔈/🔉/🔊가 <b>내가 지금 내는 소리</b>예요.</li>
              <li>
                청귀는 돌아다닐 때 <b>&quot;딱…딱…&quot;</b> 소리를 내요. 가까울수록 크고 잦아요(👂 ▮▮▮ 표시로도 보여요). <b>소리가 멎으면 멈춰서 귀를 기울이는 중</b>이라 더 위험해요.
              </li>
            </ul>
          </section>
        )}

        {tab === "ghost" && (
          <section>
            <h3 className={H3}>👂 청귀(聽鬼)</h3>
            <ul className={LIST}>
              <li><b>어슬렁</b>: 병동을 돌아다녀요. 정확한 위치는 모르지만 사람이 있는 쪽으로 슬슬 다가와요.</li>
              <li><b>확인</b>: 소리를 들으면 그 자리로 빠르게 와서 3.5초 동안 귀를 기울여요.</li>
              <li><b>추격</b>: 소리가 아주 가깝거나(4m) 여러 번 들리면 비명을 지르고 쫓아와요. 달리기보다 조금 느리지만 체력은 끝이 없어요.</li>
              <li>추격 중에는 <b>마지막으로 소리가 난 자리</b>로 와요. 달아난 뒤 <b>앉아서 조용히 자리를 옮기면</b> 2.6초 뒤 놓쳐요. 그 자리에 가만히 있으면 잡혀요.</li>
              <li>몸이 닿으면(0.55m) 어떤 상태든 붙잡혀요. 복도에서는 <b>벽에 바짝 붙으면</b> 스치듯 지나가요 — 그때 심장 소리를 숨으로 감추세요.</li>
              <li>닫힌 문은 0.8초 걸려 박차고 열어요(쾅!). 문을 닫아 두면 오는 걸 미리 알 수 있어요.</li>
              <li>부적을 붙일 때마다 조금씩 빨라지고 귀가 밝아져요. 사람이 많을수록 귀가 조금 더 밝아요.</li>
              <li>누군가를 붙잡은 뒤에는 한동안 귀가 어두워지고 멀리 떠나요 — 그때가 일으켜 줄 기회예요.</li>
            </ul>
          </section>
        )}

        {tab === "hush" && (
          <section>
            <h3 className={H3}>🔔 종 — 정적</h3>
            <ul className={LIST}>
              <li>가끔 종이 <b>세 번</b> 울려요({s(HUSH_WARN_MS)} 예고). 그 뒤 <b>{s(HUSH_MS)}</b> 동안 청귀가 멈춰 서서 온 병동에 귀를 기울여요.</li>
              <li>그동안 <b>모든 소리 반경이 3배</b>가 되고, 평소엔 무음인 앉아 걷기도 살짝 들려요.</li>
              <li>들키면 평소보다 빠른 추격이 시작돼요. 종이 울리면 <b>멈추고, 서랍에서 손을 떼고, 심장이 뛰면 숨을 참으세요.</b></li>
              <li>화면에 큰 &quot;쉿&quot;과 남은 시간이 나오니 소리를 꺼도 알 수 있어요.</li>
              <li>부적을 붙일수록, 난이도가 높을수록 종이 더 자주 울려요.</li>
            </ul>
          </section>
        )}

        {tab === "fear" && (
          <section>
            <h3 className={H3}>💓 공포 · 숨 · 손전등</h3>
            <ul className={LIST}>
              <li><b>공포</b>는 어둠 속에서 오르고(손전등이 꺼졌을 때), 청귀가 가까울수록 빨리 올라요. 손전등 불빛 안이나 동료 곁에서는 내려가요.</li>
              <li>
                공포 {FEAR_BEAT_1} 이상이면 <b>심장 소리</b>가 나서 가만히 있어도 들켜요. {FEAR_BEAT_2} 이상이면 더 크게.
              </li>
              <li>
                <b>숨 참기</b>(최대 {BREATH_MAX}초): 참는 동안 심장 소리가 안 나요. 끝까지 참으면 &quot;헉!&quot; 하고 큰 소리가 나고 {s(GASP_LOCK_MS)} 동안 못 참아요 — 바닥나기 전에 떼세요. 달리면서는 못 참아요.
              </li>
              <li>
                <b>손전등</b>은 가득 채워 {BATTERY_SEC}초. 청귀는 못 보니 켜도 안전하지만 건전지가 문제예요. 15% 아래면 깜빡여요.
              </li>
              <li>동료의 손전등 불빛 가까이(4m) 있으면 내 손전등을 꺼도 공포가 안 올라요 — 번갈아 켜면 건전지를 아껴요.</li>
            </ul>
          </section>
        )}

        {tab === "items" && (
          <section>
            <h3 className={H3}>🧧 서랍 속 물건</h3>
            <ul className={LIST}>
              {(["talisman", "battery", "bottle", "pill", "charm"] as const).map((k) => (
                <li key={k}>
                  {ITEM_INFO[k].emoji} <b>{ITEM_INFO[k].name}</b> — {ITEM_INFO[k].desc}
                </li>
              ))}
              <li>
                서랍 하나를 뒤지는 데 {s(SEARCH_MS)}, 부적 한 장 붙이는 데 {s(PLACE_MS)}. 약병은 {MAX_BOTTLES}개, 진정제는 {MAX_PILLS}개까지 들 수 있어요(넘치면 그대로 두고 와요). 건전지는 바로 +{BATTERY_PACK}%.
              </li>
              <li>봉인 부적은 되도록 서로 다른 방에 숨겨져 있어요. 서랍은 모두 26개.</li>
              <li><b>부적을 붙이면 큰 소리</b>가 나서 청귀가 기도실로 와요. 붙이고 나면 바로 흩어지세요.</li>
              <li>마지막 부적이 붙으면 <b>현관 경보</b>가 울려 청귀가 로비로 가요. 약병을 멀리 던져 따돌리거나, 귀를 기울이다 떠날 때까지 기다리세요.</li>
            </ul>
          </section>
        )}

        {tab === "team" && (
          <section>
            <h3 className={H3}>✚ 협동 · 난이도 · 결과</h3>
            <ul className={LIST}>
              <li>붙잡히면 <b>쓰러져요</b>. 동료가 다가와 {s(REVIVE_MS)} 동안 붙들어 주면 일어나요. {s(BLEED_MS)} 안에 못 일으키면 끝.</li>
              <li>혼자 할 때는 🧿 수호 부적 1장을 갖고 시작해요(붙잡힐 때 한 번 대신 타 버림).</li>
              <li>살아 있는 사람이 아무도 없으면(모두 쓰러지거나 탈출하면) 판이 끝나요. 쓰러진 동료를 두고 마지막 사람이 나가면 그 동료는 못 나와요.</li>
              <li>끝난 사람은 남은 동료의 눈으로 지켜봐요.</li>
              {DIFFICULTIES.map((d) => (
                <li key={d}>
                  {DIFFICULTY_INFO[d].emoji} <b>{DIFFICULTY_INFO[d].label}</b> — {DIFFICULTY_INFO[d].desc}
                </li>
              ))}
              <li>등급: <b>S</b> 전원 탈출 + 아무도 안 붙잡힘 · <b>A</b> 전원 탈출 · <b>B</b> 절반 이상 · <b>C</b> 한 명이라도 · <b>F</b> 실패.</li>
              <li>빈자리는 AI 동료(Lv.1~10)가 채워요. 레벨이 낮으면 종이 울려도 몇 걸음 더 걷고, 청귀 가까이에서도 그냥 걸어요.</li>
            </ul>
          </section>
        )}
      </div>
    </Overlay>
  );
}
