"use client";

import { useState } from "react";
import Overlay from "@/components/Overlay";
import {
  AMMO_MAX,
  AMMO_MAX_BLIZZARD,
  AMMO_START,
  BLIZZARD_AT_MS,
  BLIZZARD_MELT_MS,
  COCOA_MS,
  DASH_CD_MS,
  FROZEN_MS,
  GATHER_MS,
  GIANT_DMG,
  HP_MAX,
  HP_SMALL_TEAM,
  ITEM_EVERY_MS,
  ROUND_MS,
  WALL_COST,
  WALL_HP,
  WALL_LIFE_MS,
  WALL_MAX_TEAM,
  snowmanHpFor,
} from "./data";

const H3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";
const LIST = "list-disc space-y-1.5 pl-4 text-white/70 light:text-slate-600";

type Tab = "basic" | "snow" | "throw" | "fort" | "round" | "items" | "controls";
const TABS: { id: Tab; label: string }[] = [
  { id: "basic", label: "⛄ 기본" },
  { id: "snow", label: "🫳 눈 뭉치기" },
  { id: "throw", label: "🎯 던지기" },
  { id: "fort", label: "🧱 벽·요새" },
  { id: "round", label: "🏆 라운드" },
  { id: "items", label: "🍫 아이템" },
  { id: "controls", label: "🎮 조작" },
];

/** 게임 중 📖 버튼 — boardGameRule/눈싸움요새전/눈싸움요새전.md 의 앱 적용판. */
export default function RulebookModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("basic");
  return (
    <Overlay title="📖 눈싸움 요새전 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-4 text-sm text-white/80 light:text-slate-700">
        <div className="flex flex-wrap gap-1.5" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-full border px-3 py-1 text-xs font-bold ${tab === t.id ? "border-cyan-300 bg-cyan-400/20 text-cyan-100 light:text-cyan-800" : "border-white/15 text-white/60 light:border-slate-300 light:text-slate-600"}`}
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
                🍓 딸기팀(●)과 🥤 소다팀(▲)이 눈밭 양쪽 요새에서 눈싸움! 상대 요새의 <b>☃️ 눈사람 대장</b>을 먼저 무너뜨리면 라운드 승리. 1·3·5라운드 중 과반을 먼저 이긴 팀이 이겨요.
              </p>
            </section>
            <section>
              <h3 className={H3}>팀과 인원</h3>
              <ul className={LIST}>
                <li>2~8명. 자리 번호 홀수(1·3·5·7번)는 딸기팀, 짝수(2·4·6·8번)는 소다팀. 빈자리는 AI 봇(Lv.1~10).</li>
                <li>인원이 적은 팀은 몸이 하나 더 단단하고(체력 {HP_SMALL_TEAM}), 눈을 1.35배 빨리 뭉치고, 얼어도 빨리 녹고, 눈사람도 더 튼튼해요.</li>
                <li>체력 {HP_MAX}: 눈덩이 {HP_MAX}번 맞으면 <b>꽁꽁 얼어 {FROZEN_MS / 1000}초</b> 쉬고, 녹으면 우리 진영에서 다시 시작(잠깐 무적).</li>
                <li>같은 팀 눈덩이는 그냥 지나가요 — 팀끼리 맞을 걱정은 없어요.</li>
              </ul>
            </section>
          </>
        )}

        {tab === "snow" && (
          <section>
            <h3 className={H3}>눈 뭉치기</h3>
            <ul className={LIST}>
              <li>가만히 서서 <b>꾹 누르고 있으면</b> 쪼그려 앉아 {GATHER_MS / 1000}초마다 눈덩이 1개. 움직이면 멈춰요.</li>
              <li>파란 고리의 <b>눈더미</b> 옆에서 뭉치면 1.8배 빨라요(우리 진영 2곳 + 요새 앞 1곳, 상대 진영도 같은 자리).</li>
              <li>처음엔 {AMMO_START}개, 최대 {AMMO_MAX}개까지 들 수 있어요(❄️ 눈보라 땐 {AMMO_MAX_BLIZZARD}개).</li>
            </ul>
          </section>
        )}

        {tab === "throw" && (
          <section>
            <h3 className={H3}>던지기</h3>
            <ul className={LIST}>
              <li>꾹 누르는 동안 힘이 모여요(0.9초면 가득). 떼면 던져요. 노란 점선 포물선이 떨어질 곳을 보여줘요.</li>
              <li>
                <b>약하게</b> = 4m, 낮고 빠름 (벽에 막혀요). <b>세게</b> = 최대 18m, 높은 포물선 (벽을 넘겨요). 힘을 모으는 동안엔 걸음이 느려져요.
              </li>
              <li>맞으면 퍽! 1 피해와 함께 살짝 밀려요. 내 벽이든 남의 벽이든 낮은 공은 벽에 막혀요.</li>
              <li>💨 구르기(쿨 {DASH_CD_MS / 1000}초): 앞구르기로 짧게 확 움직이고, 구르기 시작한 순간엔 눈덩이가 안 맞아요.</li>
            </ul>
          </section>
        )}

        {tab === "fort" && (
          <section className="flex flex-col gap-3">
            <div>
              <h3 className={H3}>🧱 눈벽</h3>
              <ul className={LIST}>
                <li>눈덩이 {WALL_COST}개로 바라보는 쪽 바로 앞에 벽을 세워요 (가로 2.4m, 높이 1.15m).</li>
                <li>우리 진영(가운데선 너머 1m까지)에만. 팀당 동시에 {WALL_MAX_TEAM}개, {WALL_LIFE_MS / 1000}초 뒤 녹아요. 눈덩이 {WALL_HP}번이면 무너져요.</li>
              </ul>
            </div>
            <div>
              <h3 className={H3}>☃️ 요새</h3>
              <ul className={LIST}>
                <li>눈사람 앞에는 사라지지 않는 요새 벽 3개(체력 4)가 있어요 — 부수거나, 포물선으로 넘기거나, 옆으로 돌아 노려요.</li>
                <li>눈사람 체력 = 쳐들어오는 상대 인원에 맞춰: 1명 {snowmanHpFor(1)} · 2명 {snowmanHpFor(2)} · 3명 {snowmanHpFor(3)} · 4명 {snowmanHpFor(4)}.</li>
                <li>맞을수록 기울고, 3분의 1 아래로 떨어지면 머리가 떨어져요.</li>
              </ul>
            </div>
          </section>
        )}

        {tab === "round" && (
          <section>
            <h3 className={H3}>라운드</h3>
            <ul className={LIST}>
              <li>한 라운드 {ROUND_MS / 1000}초. 눈사람이 먼저 쓰러진 팀이 져요.</li>
              <li>시간이 다 되면 눈사람 체력(비율)이 더 많이 남은 팀 승리 → 같으면 얼린 사람 수 → 그래도 같으면 무승부.</li>
              <li>
                <b>❄️ 눈보라</b>(방장 선택, {BLIZZARD_AT_MS / 1000}초부터): 모든 벽이 {BLIZZARD_MELT_MS / 1000}초마다 1씩 녹고, 눈덩이를 {AMMO_MAX_BLIZZARD}개까지·1.5배 빨리 뭉쳐요. 시야도 흐려져요.
              </li>
              <li>순위: 이긴 팀 모두 1등(무승부면 모두 1등). 개인 점수(맞힘 1 · 얼림 2 · 눈사람 1)는 MVP 표시용.</li>
            </ul>
          </section>
        )}

        {tab === "items" && (
          <section>
            <h3 className={H3}>아이템 (방장 선택, {ITEM_EVERY_MS / 1000}초마다 가운데선 근처)</h3>
            <ul className={LIST}>
              <li>🍫 <b>핫초코</b>: 체력 가득 + {COCOA_MS / 1000}초 동안 뭉치기·힘 모으기 2배.</li>
              <li>🧊 <b>왕눈덩이</b>: 다음 한 번이 왕눈덩이 — 피해 {GIANT_DMG}, 벽을 한 방에 부숴요(눈사람도 {GIANT_DMG}).</li>
              <li>가운데선에 나오니 서로 달려들어요 — 위험하지만 흐름을 바꿔요.</li>
            </ul>
          </section>
        )}

        {tab === "controls" && (
          <ul className={LIST}>
            <li>
              <b>PC</b>: WASD/방향키 이동 · 마우스로 조준 · 왼쪽 버튼(또는 Space) 꾹 → 떼면 던지기 · E 꾹 뭉치기 · Q 벽 · Shift 구르기.
            </li>
            <li>
              <b>휴대폰</b>: 왼쪽 막대 이동 · 오른쪽 막대를 끌어 조준하고 떼면 던지기(길게 누를수록 멀리) — 오른쪽을 <b>톡 치면</b> 가장 가까운 상대에게 자동 조준 · ⛄ 꾹 뭉치기 · 🧱 벽 · 💨 구르기.
            </li>
            <li>팀은 색 + 모양(● 딸기 · ▲ 소다)으로, 같은 팀 안에서는 목도리 색으로 구분해요. 이름표의 ♥가 남은 체력.</li>
            <li>🔇 소리가 꺼져 있어도 맞음·얼음·벽 부숨·눈보라는 화면 글자와 눈가루로 보여요.</li>
            <li>⚙️에서 3D/2D 보기와 화질을 바꿀 수 있어요. ⛶ 크게 = 전체화면.</li>
          </ul>
        )}
      </div>
    </Overlay>
  );
}
