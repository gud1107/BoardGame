"use client";

import { useState } from "react";
import Overlay from "@/components/Overlay";
import {
  BATTERY_PACK,
  BATTERY_SEC,
  BIND_HOLD_MS,
  BIND_MS,
  BLEED_MS,
  CREAK_R,
  DARK_RANGE,
  DIFFICULTIES,
  DIFFICULTY_INFO,
  FLASH_RANGE,
  FLASH_STUN_MS,
  FLICKER_MS,
  FLICKER_WARN_MS,
  GRAB_R,
  ITEM_INFO,
  LIGHT_RANGE,
  MAX_CAMERAS,
  MAX_RIBBONS,
  MQ_SPEED,
  PLACE_MS,
  REVIVE_MS,
  SEARCH_MS,
  SPEED_RUN,
  SPEED_WALK,
  STARE_MS,
  STARE_RANGE,
  TIME_LIMIT_MS,
  TOPPLE_MS,
  fusesFor,
} from "./data";

const H3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";
const LIST = "list-disc space-y-1.5 pl-4 text-white/70 light:text-slate-600";

type Tab = "basic" | "controls" | "gaze" | "mannequin" | "stare" | "flicker" | "items" | "team";
const TABS: { id: Tab; label: string }[] = [
  { id: "basic", label: "🛍️ 기본" },
  { id: "controls", label: "🎮 조작" },
  { id: "gaze", label: "👁 시선" },
  { id: "mannequin", label: "🧍 마네킹" },
  { id: "stare", label: "🔦 노려보기" },
  { id: "flicker", label: "⚡ 정전" },
  { id: "items", label: "📸 물건" },
  { id: "team", label: "✚ 협동·결과" },
];

/** 게임 중 📖 버튼 — 전체 룰북(boardGameRule/마네킹백화점/마네킹백화점.md)의 앱 적용판 요약. */
export default function RulebookModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("basic");
  const s = (ms: number) => `${ms / 1000}초`;
  return (
    <Overlay title="📖 마네킹 백화점 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-4 text-sm text-white/80 light:text-slate-700">
        <div className="flex flex-wrap gap-1.5" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`min-h-8 rounded-full border px-3 py-1 text-xs font-semibold transition ${tab === t.id ? "border-amber-400/70 bg-amber-400/15 text-amber-100 light:text-amber-700" : "border-white/15 text-white/60 hover:border-white/30 light:border-slate-300 light:text-slate-500"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "basic" && (
          <section>
            <h3 className={H3}>목표</h3>
            <ul className={LIST}>
              <li>밤 10시, 폐점한 백화점에 갇혔다. 계산대·상자를 뒤져 ⚡ 셔터 퓨즈를 찾아 가운데 에스컬레이터 앞 배전반에 모두 꽂으면 정문 셔터가 올라간다.</li>
              <li>
                필요한 퓨즈: 1인 {fusesFor(1)} · 2인 {fusesFor(2)} · 3인 {fusesFor(3)} · 4인 {fusesFor(4)}개. 셔터가 열린 뒤 <b>한 명이라도</b> 정문에 닿으면 팀 승리.
              </li>
              <li>자정({TIME_LIMIT_MS / 60000}분)이 되거나 모두 굳으면 패배.</li>
              <li>등급: S 전원 탈출·아무도 안 붙잡힘 · A 전원 탈출 · B 절반 이상 · C 한 명 이상 · F 실패.</li>
              <li>진열된 마네킹 26개 중 몇 개는 살아 있다. 처음엔 1~2개, 퓨즈를 꽂을 때마다 하나씩 더 깨어난다.</li>
            </ul>
          </section>
        )}

        {tab === "controls" && (
          <section>
            <h3 className={H3}>키보드 · 마우스</h3>
            <ul className={LIST}>
              <li>WASD 이동 · Shift 달리기(앞으로만) · 마우스 둘러보기 — 뒷걸음질은 느리다(보면서 물러나기)</li>
              <li>E 또는 Space 누르고 있기: 뒤지기 {s(SEARCH_MS)} · 퓨즈 꽂기 {s(PLACE_MS)} · 동료 풀어 주기 {s(REVIVE_MS)} · 🎀 묶기 {s(BIND_MS)}</li>
              <li>F 손전등 · Q 또는 클릭 📸 플래시 · M 지도 · Esc 마우스 풀기</li>
            </ul>
            <h3 className={`${H3} mt-3`}>터치</h3>
            <ul className={LIST}>
              <li>왼쪽 아래 끌어서 이동(끝까지 밀면 달리기) · 오른쪽 화면 끌어서 둘러보기</li>
              <li>✋ 누르고 있기 · 🔦 손전등 · 📸 플래시 · 🗺️ 지도</li>
            </ul>
          </section>
        )}

        {tab === "gaze" && (
          <section>
            <h3 className={H3}>&quot;본다&quot;는 것</h3>
            <ul className={LIST}>
              <li>살아 있는 사람의 시선 원뿔 안에 마네킹이 있고, 사이에 벽·키 큰 진열장이 없으면 본다.</li>
              <li>
                🔦 손전등을 켜면 {LIGHT_RANGE}m까지, 끄면 코앞 {DARK_RANGE}m만. 건전지는 100%로 {BATTERY_SEC}초.
              </li>
              <li>낮은 계산대·에스컬레이터 빈 곳 너머는 보인다. 바닥만 내려다보면 안 보인다.</li>
              <li>누구든 한 명이 보고 있으면 그 마네킹은 멈춘다 — 동료의 눈도 내 방패다.</li>
            </ul>
          </section>
        )}

        {tab === "mannequin" && (
          <section>
            <h3 className={H3}>살아 있는 마네킹</h3>
            <ul className={LIST}>
              <li>
                아무도 안 보면 가장 가까운 사람에게 걸어온다 — 초속 {MQ_SPEED}m(걷기 {SPEED_WALK}m보다 빠르고 달리기 {SPEED_RUN}m보다 느림). 퓨즈가 꽂힐수록 빨라진다.
              </li>
              <li>{GRAB_R}m 안까지 오면 붙잡는다 → 그 자리에서 굳는다.</li>
              <li>겉모습은 그냥 마네킹과 똑같다. 돌아봤을 때 <b>자리나 포즈가 바뀌어 있으면</b> 살아 있는 것이다.</li>
              <li>움직이는 동안 &quot;삐걱…&quot; 소리가 {CREAK_R}m 안에 들린다. 화면 가장자리 붉은 빛과 👂 3단계로도 보인다.</li>
            </ul>
          </section>
        )}

        {tab === "stare" && (
          <section>
            <h3 className={H3}>노려보기</h3>
            <ul className={LIST}>
              <li>
                켠 손전등으로 {STARE_RANGE}m 안의 살아 있는 마네킹을 계속 비추면 부들부들 떨다가 {s(STARE_MS)}(둘이 함께 비추면 절반) 만에 와르르 쓰러져 {s(TOPPLE_MS)} 동안 못 움직인다.
              </li>
              <li>쓰러질 때마다 다음엔 더 오래 버틴다. 비추지 않으면 천천히 빠진다.</li>
              <li>그냥 마네킹은 아무리 비춰도 안 떤다 — 노려보기는 정체를 알아내는 방법이기도 하다.</li>
            </ul>
          </section>
        )}

        {tab === "flicker" && (
          <section>
            <h3 className={H3}>정전</h3>
            <ul className={LIST}>
              <li>
                가끔 형광등이 {s(FLICKER_WARN_MS)} 동안 지직거린 뒤 {s(FLICKER_MS)} 동안 모든 불이 꺼진다. 그동안 아무도 못 보고, 살아 있는 마네킹은 더 빨리 온다.
              </li>
              <li>퓨즈를 꽂으면 곧바로 전력이 출렁여 정전이 온다.</li>
              <li>경고가 울리면 의심 가는 마네킹에게서 6m 넘게 물러나고 동료 곁으로.</li>
            </ul>
          </section>
        )}

        {tab === "items" && (
          <section>
            <h3 className={H3}>상자 속 물건</h3>
            <ul className={LIST}>
              <li>
                {ITEM_INFO.fuse.emoji} {ITEM_INFO.fuse.name} — {ITEM_INFO.fuse.desc}
              </li>
              <li>
                {ITEM_INFO.battery.emoji} {ITEM_INFO.battery.name} — 손전등 +{BATTERY_PACK}%
              </li>
              <li>
                {ITEM_INFO.camera.emoji} {ITEM_INFO.camera.name} (최대 {MAX_CAMERAS}) — 앞 {FLASH_RANGE}m의 살아 있는 마네킹이 {s(FLASH_STUN_MS)} 굳고, 눈이 붉게 드러난다.
              </li>
              <li>
                {ITEM_INFO.ribbon.emoji} {ITEM_INFO.ribbon.name} (최대 {MAX_RIBBONS}) — 바로 앞 마네킹을 묶는다. 살아 있으면 {s(BIND_HOLD_MS)} 동안 못 움직이고, 그냥 마네킹이면 끈만 날린다.
              </li>
              <li>손에 가득 차면 상자를 그대로 둔다. 혼자 하면 📸 1개, 순한 밤이면 모두 📸 1개를 더 갖고 시작.</li>
            </ul>
          </section>
        )}

        {tab === "team" && (
          <section>
            <h3 className={H3}>협동</h3>
            <ul className={LIST}>
              <li>뒤지는 동안엔 상자만 본다. 동료가 등 뒤를 봐 주면 안전하다 — &quot;내가 볼게, 뒤져!&quot;</li>
              <li>굳은 동료는 옆에서 {s(REVIVE_MS)} 붙들면 풀린다({BLEED_MS / 1000}초 안에). 풀린 뒤 3초 동안은 안전하다.</li>
              <li>나간 사람 자리는 10초 뒤 AI가 대신하고, 방장이 나가도 다른 사람이 판을 이어받는다.</li>
            </ul>
            <h3 className={`${H3} mt-3`}>난이도</h3>
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
