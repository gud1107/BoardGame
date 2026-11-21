"use client";

import { useState } from "react";
import Overlay from "@/components/Overlay";
import {
  BATTERY_MS,
  BOX_RESPAWN_MS,
  BUBBLE_MS,
  CRASH_MS,
  DRAFT_CHARGE_MS,
  DRAFT_MULT,
  DRIFT_BOOST1_MS,
  DRIFT_BOOST2_MS,
  DRIFT_T1_MS,
  DRIFT_T2_MS,
  FINISH_GRACE_MS,
  GP_POINTS,
  INTERMISSION_MS,
  ITEM_INFO,
  ITEM_KINDS,
  ITEM_ROLL_MS,
  LAP_TIMEOUT_MS,
  RESET_MS,
  ROCKET_BOOST_MS,
  ROCKET_EARLY_MS,
  RUG_MULT,
  SPIN_IMMUNE_MS,
  SPIN_MS,
  STALL_MS,
  TOP_MS,
  TOY_AHEAD,
  TOY_AUTO_MS,
  TOY_LIFE_MS,
  TOY_WARN_MS,
  TRACK_IDS,
  TRACK_INFO,
  itemWeights,
} from "./data";

const H3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";
const LIST = "list-disc space-y-1.5 pl-4 text-white/70 light:text-slate-600";

type Tab = "basic" | "controls" | "drive" | "items" | "toy" | "tracks" | "score";
const TABS: { id: Tab; label: string }[] = [
  { id: "basic", label: "🏁 기본" },
  { id: "controls", label: "🎮 조작" },
  { id: "drive", label: "🌀 운전 기술" },
  { id: "items", label: "🎁 아이템" },
  { id: "toy", label: "🧸 꼴찌의 장난감" },
  { id: "tracks", label: "🛋️ 트랙" },
  { id: "score", label: "🏆 순위·점수" },
];

const sec = (ms: number) => `${ms / 1000}초`;
const pct = (v: number) => `${Math.round(v * 100)}%`;

/** 게임 중 📖 버튼 — 전체 룰북(boardGameRule/장난감방레이스/장난감방레이스.md)의 앱 적용판 요약. */
export default function RulebookModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("basic");
  const front = itemWeights(0);
  const back = itemWeights(1);
  return (
    <Overlay title="📖 장난감 방 레이스 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-4 text-sm text-white/80 light:text-slate-700">
        <div className="flex flex-wrap gap-1.5" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-full border px-3 py-1 text-xs font-bold ${tab === t.id ? "border-orange-400 bg-orange-500/20 text-orange-100 light:text-orange-800" : "border-white/15 text-white/60 light:border-slate-300 light:text-slate-600"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "basic" && (
          <>
            <section>
              <h3 className={H3}>목표</h3>
              <p className="break-keep text-white/70 light:text-slate-600">
                방바닥에 깔린 놀이 매트 도로를 장난감 차로 달려요. 정해진 바퀴(2·3·5)를 <b>가장 먼저 다 돈 사람이 1등</b>이에요. 차는 <b>저절로 앞으로 달려요</b> — 나는 핸들·브레이크·드리프트·아이템만 하면 돼요.
              </p>
            </section>
            <section>
              <h3 className={H3}>한 판의 흐름</h3>
              <ol className="list-decimal space-y-1.5 pl-4 text-white/70 light:text-slate-600">
                <li>출발선 뒤에 두 줄로 서요 (첫 레이스는 무작위 순서). 신호등 불 3개가 하나씩 켜져요.</li>
                <li>
                  불이 다 켜지고 <b>출발 직전 {sec(ROCKET_EARLY_MS)} 안</b>에 🚀(↑)을 누르면 출발 부스트 {sec(ROCKET_BOOST_MS)}. 그보다 일찍 누르면 시동이 꺼져 {sec(STALL_MS)} 늦게 출발해요.
                </li>
                <li>🎁 선물 상자를 지나가면 아이템 하나를 받아요 (한 번에 하나만 가질 수 있어요).</li>
                <li>선두가 한 바퀴를 돌 때마다 꼴찌가 🧸 장난감 상자를 받아요 — 선두 앞에 장난감 벽을 떨어뜨려요.</li>
                <li>
                  첫 사람이 들어오면 나머지는 <b>{sec(FINISH_GRACE_MS)} 안</b>에 들어와야 해요. 못 들어오면 더 멀리 간 순서로 순위가 정해져요.
                </li>
              </ol>
            </section>
          </>
        )}

        {tab === "controls" && (
          <section className="flex flex-col gap-3">
            <div>
              <h3 className={H3}>키보드</h3>
              <ul className={LIST}>
                <li>
                  <b>← → / A D</b> — 핸들
                </li>
                <li>
                  <b>↓ / S</b> — 브레이크 (멈춘 뒤 계속 누르면 후진)
                </li>
                <li>
                  <b>Shift / J</b> 꾹 — 🌀 드리프트 (핸들을 꺾은 채로)
                </li>
                <li>
                  <b>Space / K / E</b> — 🎁 아이템 쓰기 · 카운트다운 중엔 🚀 출발 부스트
                </li>
                <li>
                  <b>Q / L</b> — 🧸 꼴찌의 장난감 던지기
                </li>
                <li>
                  <b>R</b> — 🔁 제자리로 (길 가운데로 돌아가요, {sec(RESET_MS)} 멈춤)
                </li>
                <li>
                  <b>↑ / W</b> — 🚀 출발 부스트
                </li>
              </ul>
            </div>
            <div>
              <h3 className={H3}>휴대폰</h3>
              <ul className={LIST}>
                <li>왼쪽 아래 ◀ ▶ 를 누르고 있으면 핸들</li>
                <li>오른쪽 아래 🌀 드리프트(꾹) · ⏬ 브레이크(꾹) · 🎁 아이템 · 🧸 투하 (가지고 있을 때만 보여요)</li>
                <li>카운트다운 중엔 🎁 자리에 🚀 출발 버튼이 나와요</li>
                <li>멈췄거나 반대로 가면 🔁 제자리로 버튼이 나와요</li>
              </ul>
            </div>
            <div>
              <h3 className={H3}>⚙️ 설정</h3>
              <ul className={LIST}>
                <li>🎥 3D 뒤에서 / 🗺️ 2D 위에서 보기 · 카메라 가까이/멀리 · 화질</li>
                <li>
                  <b>🧑‍🦽 주행 보조</b>: 핸들을 놓으면 길 가운데로 살살 꺾어 주고, 급한 굽이 앞에서 대신 브레이크를 밟아요. 직접 꺾으면 내 조작이 우선이에요.
                </li>
              </ul>
            </div>
          </section>
        )}

        {tab === "drive" && (
          <section className="flex flex-col gap-3">
            <ul className={LIST}>
              <li>
                <b>🌀 드리프트</b> — 빠르게 달리며 핸들을 꺾은 채 드리프트를 꾹 누르면 미끄러지며 더 많이 돌아요. 꾹 누른 시간이 {sec(DRIFT_T1_MS)}를 넘으면 차 뒤에 <b>파랑 불똥(1단)</b>, {sec(DRIFT_T2_MS)}를 넘으면 <b>주황 불똥(2단)</b> — 떼면 ⚡ 부스트 {sec(DRIFT_BOOST1_MS)} / {sec(DRIFT_BOOST2_MS)}. 화면 아래에도 「🌀 1단/2단」으로 써 있어요. 울타리에 박으면 모은 게 사라져요.
              </li>
              <li>
                <b>💨 바람막이</b> — 앞차 바로 뒤에 {sec(DRAFT_CHARGE_MS)} 붙어 있으면 {pct(DRAFT_MULT - 1)} 빨라져요 (차 옆에 흰 줄).
              </li>
              <li>
                <b>🧶 러그</b> — 도로 밖 카펫은 최고 속도가 {pct(RUG_MULT)}로 떨어져요. 그 밖은 블록 울타리 — 박으면 튕겨 나와요.
              </li>
              <li>
                <b>📚 점프대</b> — 빠르게 넘으면 붕 떠요. 공중에선 핸들이 안 먹고, 내릴 때 차가 길 방향을 보고 있으면 <b>✨ 완벽한 착지</b> 부스트.
              </li>
              <li>
                <b>💫 빙글</b> — 아이템·오리에 맞으면 {sec(SPIN_MS)} 동안 핸들이 안 먹고 느려져요. 끝난 뒤 {sec(SPIN_IMMUNE_MS)}는 다시 안 맞아요. 장난감 벽·기차에 박으면 뒤로 튕기며 {sec(CRASH_MS)} 멈칫해요.
              </li>
              <li>
                <b>↩ 반대 방향</b> — 거꾸로 달리면 화면에 경고가 떠요. R(🔁)로 길 가운데 앞 방향으로 돌아가요.
              </li>
            </ul>
          </section>
        )}

        {tab === "items" && (
          <section className="flex flex-col gap-3">
            <p className="break-keep text-white/70 light:text-slate-600">
              🎁 선물 상자는 트랙에 3~4줄 있고, 깨지면 {sec(BOX_RESPAWN_MS)} 뒤 다시 생겨요. 받은 아이템은 {sec(ITEM_ROLL_MS)} 동안 룰렛이 돈 뒤에 쓸 수 있어요. <b>순위가 낮을수록 따라잡는 아이템</b>이 잘 나와요.
            </p>
            <ul className={LIST}>
              {ITEM_KINDS.map((k) => (
                <li key={k}>
                  <b>
                    {ITEM_INFO[k].emoji} {ITEM_INFO[k].name}
                  </b>{" "}
                  — {ITEM_INFO[k].desc}
                  <span className="ml-1 text-[11px] text-white/40 light:text-slate-400">
                    (선두 {front[k]}% · 꼴찌 {back[k]}%)
                  </span>
                </li>
              ))}
            </ul>
            <ul className={LIST}>
              <li>🔋 건전지 {sec(BATTERY_MS)} · 🫧 방패 {sec(BUBBLE_MS)} · 🌀 팽이 {sec(TOP_MS)}</li>
              <li>털실 공과 고무 오리가 부딪히면 둘 다 사라져요 — 뒤에서 오는 털실을 오리로 막을 수 있어요.</li>
              <li>🪀 요요는 트랙을 따라 쫓아가서 피할 수 없어요. 🫧 방패나 🌀 팽이로만 막혀요.</li>
            </ul>
          </section>
        )}

        {tab === "toy" && (
          <section className="flex flex-col gap-3">
            <p className="break-keep text-white/70 light:text-slate-600">
              선두가 독주하지 않도록 <b>꼴찌가 반격</b>할 수 있어요. 하지만 운이 아니라 <b>보고 피할 수 있는</b> 장애물이에요.
            </p>
            <ol className="list-decimal space-y-1.5 pl-4 text-white/70 light:text-slate-600">
              <li>선두가 새 바퀴에 들어설 때마다 꼴찌(6명 이상이면 뒤 두 명)가 🧸를 받아요. 1등은 못 받아요.</li>
              <li>
                Q(🧸 버튼)로 던지면, 선두보다 {TOY_AHEAD}u 이상 앞의 정해진 투하 자리에 <b>장난감 블록 벽</b>이 떨어져요. 안 던지고 버티면 {sec(TOY_AUTO_MS)} 뒤 저절로 떨어져요.
              </li>
              <li>
                벽은 도로의 <b>반쪽</b>만 막아요 (던진 순간 선두가 달리던 쪽). {sec(TOY_WARN_MS)} 동안 <b>붉은 그림자가 깜빡</b>이며 미리 보이고, 선두 화면엔 「⚠️ 앞에 장난감 벽」 경고가 떠요.
              </li>
              <li>
                박으면 뒤로 튕기며 {sec(CRASH_MS)} 멈칫하고 벽은 와르르 무너져요 (한 번만). 선두가 피해서 지나가도 무너져요 — 뒤따르던 차가 대신 박지 않게. 아무도 안 박으면 {sec(TOY_LIFE_MS)} 뒤 사라져요. 🫧 방패·🌀 팽이는 벽을 부수고 지나가요.
              </li>
            </ol>
          </section>
        )}

        {tab === "tracks" && (
          <section className="flex flex-col gap-3">
            <ul className={LIST}>
              {TRACK_IDS.map((t) => (
                <li key={t}>
                  <b>
                    {TRACK_INFO[t].emoji} {TRACK_INFO[t].name}
                  </b>{" "}
                  — {TRACK_INFO[t].short}
                </li>
              ))}
            </ul>
            <ul className={LIST}>
              <li>🫧 비누 거품 구간: 미끄럽고 핸들이 둔해요 — 드리프트는 일찍, 브레이크는 미리.</li>
              <li>🧴 샴푸 통·🧱 블록 탑: 도로 위 고정 장애물. 부딪히면 튕겨요.</li>
              <li>📚 책 다리: 8자 코스는 가운데에서 위아래로 엇갈려요 — 다리 위·아래 차끼리는 부딪히지 않아요.</li>
              <li>🚂 기차 건널목: 불이 깜빡이면 곧 기차가 와요. 지나가는 동안 건널목에 있으면 쾅!</li>
            </ul>
          </section>
        )}

        {tab === "score" && (
          <section className="flex flex-col gap-3">
            <ul className={LIST}>
              <li>
                <b>🏁 단판</b>: 들어온 순서가 순위. 못 들어온 사람은 더 멀리 간 순서.
              </li>
              <li>
                <b>🏆 그랑프리</b>: 거실 → 욕실 → 아이 방 세 레이스. 순위 점수 {GP_POINTS.join("·")}점을 더해 가장 높은 사람이 우승. 동점이면 마지막 레이스 순위가 높은 사람. 레이스 사이 {sec(INTERMISSION_MS)} 결과를 보여 주고, <b>점수가 낮은 사람이 앞줄</b>에서 출발해요.
              </li>
              <li>레이스가 너무 길어지면(바퀴당 {sec(LAP_TIMEOUT_MS)}) 그 자리 순위로 끝나요.</li>
              <li>내 최고 랩 기록은 트랙마다 이 기기에 저장돼요 (🆕 새 기록 알림).</li>
              <li>방장이 나가도 남은 사람이 판을 이어받아요. 나간 사람 자리는 10초 뒤 AI가 대신 달리고, 돌아오면 돌려받아요.</li>
            </ul>
          </section>
        )}
      </div>
    </Overlay>
  );
}
