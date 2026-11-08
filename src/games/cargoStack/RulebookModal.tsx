"use client";

import { useState } from "react";
import Overlay from "@/components/Overlay";
import {
  BALLAST_MAX,
  BALLAST_STEP,
  CAPSIZE_FINE,
  COLS,
  CRUSH_FINE,
  CRUSH_WEIGHT,
  FRAGILE_BONUS,
  LIMIT_BASE,
  LIMIT_MIN,
  LIMIT_PER_HEIGHT,
  MAX_DEPART_SPILL,
  MAX_SPILL,
  PASS_FINE,
  SAIL_TIMEOUT_MS,
  SPILL_FINE,
  TIERS,
  TURN_TIMEOUT_MS,
  WAVE,
} from "./engine";

const H3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";
const LIST = "list-disc space-y-1.5 pl-4 text-white/70 light:text-slate-600";

type Tab = "basic" | "stack" | "score" | "tilt" | "weather" | "controls";
const TABS: { id: Tab; label: string }[] = [
  { id: "basic", label: "🚢 기본" },
  { id: "stack", label: "🏗️ 싣기" },
  { id: "score", label: "🧮 점수" },
  { id: "tilt", label: "⚖️ 기울기" },
  { id: "weather", label: "⛈️ 출항" },
  { id: "controls", label: "🎮 조작" },
];

/** 게임 중 📖 버튼 — 전체 룰북(boardGameRule/화물선쌓기/화물선쌓기.md)의 앱 적용판 요약. */
export default function RulebookModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("basic");
  return (
    <Overlay title="📖 화물선 쌓기 룰북" onClose={onClose} wide>
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
          <>
            <section>
              <h3 className={H3}>목표</h3>
              <p className="break-keep text-white/70 light:text-slate-600">
                모두가 <b>한 척의 화물선</b>에 번갈아 컨테이너를 실어요. 높이 실을수록 점수가 크지만, 배가 한쪽으로 너무 기울면 컨테이너가 <b>바다로 미끄러지고</b> 끝내 <b>뒤집혀요</b>. 항해가 모두 끝났을 때 점수가 가장 높은 사람이 1등.
              </p>
            </section>
            <section>
              <h3 className={H3}>항해와 차례</h3>
              <ul className={LIST}>
                <li>
                  항해 1/2/3번(방 옵션). 항해마다 빈 배로 시작하고, 한 사람당 차례 수는 <b>1명 10 · 2명 8 · 3명 6 · 4명 5 · 5~6명 4</b>.
                </li>
                <li>첫 항해는 1번 자리부터, 다음 항해는 <b>점수가 가장 낮은 사람부터</b>.</li>
                <li>
                  내 차례: <b>🏗️ 싣기</b> · <b>⚓ 밸러스트</b>(항해마다 1번) · <b>⏭️ 넘기기</b>(−{PASS_FINE}점, 실을 게 없고 밸러스트도 썼으면 무료) 중 하나.
                </li>
                <li>
                  {TURN_TIMEOUT_MS / 1000}초 안에 안 하면 <b>가장 안전한 자리에 자동으로</b> 실어요.
                </li>
              </ul>
            </section>
            <section>
              <h3 className={H3}>컨테이너 4종</h3>
              <ul className={LIST}>
                <li>📦 일반 — 1칸 1~2t · 2칸 2~3t · 3칸 3~4t</li>
                <li>⚙️ 철강(빗금) — 1칸 4t · 2칸 6t. 점수도 기울기도 크다</li>
                <li>
                  🥚 유리(점선 테두리) — 1t. 바로 위에 <b>{CRUSH_WEIGHT}t 이상</b>을 올리면 깨져요. 출항까지 무사하면 주인 <b>+{FRAGILE_BONUS}</b>
                </li>
                <li>
                  💎 귀중품(금색 띠) — 1칸 2t, 점수 <b>2배</b>
                </li>
              </ul>
            </section>
          </>
        )}

        {tab === "stack" && (
          <>
            <section>
              <h3 className={H3}>싣는 법</h3>
              <ul className={LIST}>
                <li>
                  크레인 대기열 <b>3개</b> 중 하나를 고르고 칸을 정해요. 컨테이너는 위에서 내려와 <b>덮는 칸들 중 가장 높은 곳</b>에 멈춰요(아래 빈틈은 그대로).
                </li>
                <li>
                  갑판은 가로 {COLS}칸 × 세로 {TIERS}층. 5번 칸(노란 숫자)이 배의 가운데. {TIERS}층 위로는 못 쌓아요.
                </li>
                <li>고른 자리는 덱 맨 위 화물로 채워지고, 그다음 화물 1개는 미리 보여요.</li>
              </ul>
            </section>
            <section>
              <h3 className={H3}>받침 규칙</h3>
              <ul className={LIST}>
                <li>컨테이너의 가운데가, 바로 아래에서 받쳐 주는 칸들의 범위(±반 칸) 안에 있어야 해요.</li>
                <li>1칸은 언제나 OK · 2칸은 한 칸만 받쳐도 OK(반 칸 내밀기) · 3칸은 가운데가 받쳐지거나 양 끝이 다 받쳐져야 해요.</li>
                <li>안 되는 자리는 빨간 ✕로 보이고 고를 수 없어요.</li>
              </ul>
            </section>
          </>
        )}

        {tab === "score" && (
          <section>
            <ul className={LIST}>
              <li>
                실으면 바로 <b>무게 × 층</b>점 (1층 ×1 … 6층 ×6). 💎는 2배.
              </li>
              <li>
                바다로 떨어진 컨테이너는 <b>주인이 그 점수를 잃어요</b>.
              </li>
              <li>
                내 차례에 쏠림이 일어나면 떨어진 컨테이너 1개마다 <b>나에게 −{SPILL_FINE}</b> (내 것이든 남의 것이든).
              </li>
              <li>
                🥚 유리를 깨뜨리면 유리 주인은 그 점수를 잃고 <b>깨뜨린 사람 −{CRUSH_FINE}</b>. 깨진 유리는 받침으로는 남아요.
              </li>
              <li>
                배를 뒤집으면 <b>−{CAPSIZE_FINE}</b>, 그 항해는 바로 끝.
              </li>
              <li>
                출항 때 무사한 🥚 유리마다 주인 <b>+{FRAGILE_BONUS}</b>.
              </li>
              <li>동점이면 바다에 잃은 내 컨테이너가 적은 사람, 그다음 뒤집은 횟수가 적은 사람이 위.</li>
            </ul>
          </section>
        )}

        {tab === "tilt" && (
          <>
            <section>
              <h3 className={H3}>기울기와 한계</h3>
              <ul className={LIST}>
                <li>
                  <b>기울기</b> = Σ(무게 × 가운데에서 떨어진 칸 수) + 밸러스트. 왼쪽 −, 오른쪽 +.
                </li>
                <li>
                  <b>한계</b> = {LIMIT_BASE} − {LIMIT_PER_HEIGHT} × 무게중심 높이(층), 최소 {LIMIT_MIN}. <b>높이 쌓을수록 한계가 줄어요.</b>
                </li>
                <li>게이지: 초록(여유) → 노랑(한계의 60%↑) → 빨강(85%↑), 숫자와 ⚠도 함께.</li>
              </ul>
            </section>
            <section>
              <h3 className={H3}>쏠림 → 전복</h3>
              <ul className={LIST}>
                <li>
                  기울기가 한계를 넘으면, 기운 쪽에서 <b>위에 아무것도 안 얹힌</b> 컨테이너 중 <b>가장 높고 바깥쪽</b>인 것부터 바다로 미끄러져요. 한계 안으로 돌아올 때까지 최대 {MAX_SPILL}개.
                </li>
                <li>
                  {MAX_SPILL}개가 떨어져도 넘치면 <b>전복</b>!
                </li>
                <li>
                  ⚓ <b>밸러스트</b>: 항해마다 한 번, 배 밑 물탱크를 옮겨 기울기를 {BALLAST_STEP}만큼 바꿔요(범위 ±{BALLAST_MAX}).
                </li>
                <li>💡 내 비싼 컨테이너는 위에서 덮어 두면 안 떨어져요. 가장자리 높은 곳의 노출 컨테이너는 다음 쏠림의 표적.</li>
              </ul>
            </section>
          </>
        )}

        {tab === "weather" && (
          <section>
            <ul className={LIST}>
              <li>
                항해마다 <b>날씨 예보</b>가 처음부터 보여요: ☀️ 잔잔(파도 {WAVE.calm}) · 🌊 너울(파도 {WAVE.swell}) · ⛈️ 폭풍(파도 {WAVE.storm}). 마지막 항해는 최소 너울.
              </li>
              <li>
                항해가 끝나면 출항하며 흔들려요: <b>한계 − 파도</b>로 쏠림을 다시 판정(최대 {MAX_DEPART_SPILL}개, 전복·벌금 없음, 주인만 점수를 잃음).
              </li>
              <li>💡 폭풍이면 마지막 몇 차례는 여유(한계 − |기울기|)를 5 이상 남겨 두세요.</li>
              <li>
                결과 화면에서 다음 항해의 선 플레이어가 <b>⚓ 다음 항해</b>를 눌러요({SAIL_TIMEOUT_MS / 1000}초 뒤 자동).
              </li>
            </ul>
          </section>
        )}

        {tab === "controls" && (
          <section>
            <ul className={LIST}>
              <li>대기열 화물을 누르고 → 배 위 칸을 누르면 그림자(고스트)가 보여요. 같은 칸을 한 번 더 누르거나 <b>🏗️ 내리기</b>로 확정.</li>
              <li>키보드: 1·2·3 화물 고르기 · ←→ 칸 옮기기 · Enter/Space 내리기 · B 밸러스트 모드(←→ 방향, Enter 확정, Esc 취소) · P 넘기기.</li>
              <li>🔰 도우미(방 옵션)가 켜져 있으면, 내려놓은 뒤의 기울기·점수와 떨어질 컨테이너(노란 테두리)를 미리 보여줘요.</li>
              <li>컨테이너 주인은 색 + 무늬(● ◆ ▲ ■ ★ ✚)로, 무게는 숫자로 적혀 있어요.</li>
              <li>🧊 3D / 📐 2D 보기 전환. 휴대폰이 느리면 2D가 가벼워요.</li>
            </ul>
          </section>
        )}
      </div>
    </Overlay>
  );
}
