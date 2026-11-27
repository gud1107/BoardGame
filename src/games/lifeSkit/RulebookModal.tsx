"use client";

import { useState } from "react";
import Overlay from "@/components/Overlay";
import { ROLES, SCENE_COUNT, STATS, TRAITS } from "./data";
import { MAX_PLAYERS, MIN_PLAYERS, SCORE_PER_CLAP, SCORE_PER_STAT, STAT_MAX } from "./engine";

const H3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";
const LIST = "list-disc space-y-1.5 pl-4 text-white/70 light:text-slate-600";

type Tab = "basic" | "scene" | "trait" | "score" | "roles" | "controls";
const TABS: { id: Tab; label: string }[] = [
  { id: "basic", label: "🎬 기본" },
  { id: "scene", label: "🎭 장면" },
  { id: "trait", label: "🦋 성격과 나비효과" },
  { id: "score", label: "🏆 엔딩과 점수" },
  { id: "roles", label: "👥 배역" },
  { id: "controls", label: "🎮 조작" },
];

/** 게임 중 📖 버튼 — boardGameRule/인생상황극/인생상황극.md 의 앱 적용판. */
export default function RulebookModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("basic");
  return (
    <Overlay title="📖 인생 상황극 룰북" onClose={onClose} wide>
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
            <p className="break-keep text-white/70 light:text-slate-600">
              {MIN_PLAYERS}~{MAX_PLAYERS}명이 각자 배역 하나를 골라 <b>{SCENE_COUNT}장면짜리 인생</b>을 동시에 살아 보는 콩트 게임이에요. 장면마다 세 가지 중 하나를 고르고, 한꺼번에 공개해 서로의 인생을 구경해요. 막이 내렸을 때 <b>인생 점수 + 받은 박수</b>가 가장 높은 사람이 오늘의 주인공! 혼자서도 할 수 있어요.
            </p>
            <h3 className={`${H3} mt-4`}>네 가지 수치 (0~{STAT_MAX})</h3>
            <ul className={LIST}>
              {STATS.map((s) => (
                <li key={s.key}>
                  {s.emoji} <b>{s.name}</b>
                </li>
              ))}
            </ul>
          </section>
        )}

        {tab === "scene" && (
          <section>
            <h3 className={H3}>한 장면의 흐름</h3>
            <ul className={LIST}>
              <li>🎭 상대역이 말을 걸고, 자막이 상황을 알려 줘요.</li>
              <li>
                모두 <b>동시에</b> 세 선택지 중 하나를 골라요. 선택지에는 <b>얻을 것 같은 것</b>만 보여요 — 대가와 성격 변화는 숨어 있어요.
              </li>
              <li>
                ⚡ <b>지름길</b>(장면마다 하나)은 눈앞의 이득이 크지만 대가가 따라와요. 늘 나쁜 건 아니에요.
              </li>
              <li>모두 고르면 🥁 공개 — 결과 문장, 수치 변화, 새로 굳은 성격, 나비효과가 드러나요.</li>
              <li>공개 화면에서 다른 사람의 장면 하나에 👏 박수를 칠 수 있어요(장면마다 한 번, 받은 사람 +{SCORE_PER_CLAP}점).</li>
              <li>모두 ▶ 다음 장면을 누르면 넘어가요. 제한 시간이 있는 방에서는 시간이 다 되면 아무거나 대신 골라져요.</li>
            </ul>
          </section>
        )}

        {tab === "trait" && (
          <section>
            <h3 className={H3}>성격은 뒤 장면을 바꿔요</h3>
            <ul className={LIST}>
              <li>
                어떤 선택은 <b>성격</b>을 굳혀요. 한번 굳은 성격은 끝까지 가요.
              </li>
              <li>
                <b>바뀌는 선택지</b>: 성격에 따라 뒤 장면의 선택지가 다른 것으로 바뀌어요. 예) 🧊 무심해진 CEO에게 딸 생일 장면의 &ldquo;비서에게 맡긴다&rdquo;는 &ldquo;…내일이 무슨 날이라고?&rdquo;가 돼요.
              </li>
              <li>
                🦋 <b>나비효과</b>: 그 성격으로 어떤 장면에 들어서면, 무엇을 고르든 예전 선택의 값이 청구돼요.
              </li>
              <li>엔딩도 성격을 봐요 — 같은 수치라도 어떤 사람이 되었느냐에 따라 결말이 달라요.</li>
            </ul>
            <h3 className={`${H3} mt-4`}>성격 {Object.keys(TRAITS).length}가지</h3>
            <ul className="grid grid-cols-1 gap-1 text-xs text-white/70 sm:grid-cols-2 light:text-slate-600">
              {Object.values(TRAITS).map((t) => (
                <li key={t.name}>
                  {t.emoji} <b>{t.name}</b> — {t.desc}
                </li>
              ))}
            </ul>
          </section>
        )}

        {tab === "score" && (
          <section>
            <h3 className={H3}>엔딩</h3>
            <ul className={LIST}>
              <li>배역마다 엔딩이 4~5개. 마지막 장면 뒤의 수치와 성격으로 정해져요(위에서부터 처음 맞는 것).</li>
              <li>명장면 엔딩은 보너스가 크고, 씁쓸한 엔딩은 작아요.</li>
            </ul>
            <h3 className={`${H3} mt-4`}>점수</h3>
            <ul className={LIST}>
              <li>
                인생 점수 = 배역 기본점 + 배역 배율 × (<b>늘어난 수치 합 × {SCORE_PER_STAT}</b> + <b>엔딩 보너스</b>)
              </li>
              <li>
                배역마다 출발점과 함정의 깊이가 달라서, 어떤 배역을 골라도 비슷한 점수대에서 겨루도록 기본점·배율을 AI 자가 대전으로 맞췄어요. 부자로 태어난 배역은 &ldquo;얼마나 가졌나&rdquo;가 아니라 &ldquo;얼마나 나아졌나&rdquo;로 봐요.
              </li>
              <li>최종 점수 = 인생 점수 + 👏 받은 박수 × {SCORE_PER_CLAP}</li>
              <li>동점이면 ❤️ 관계 → 😊 행복이 높은 사람이 위.</li>
            </ul>
          </section>
        )}

        {tab === "roles" && (
          <section>
            <h3 className={H3}>배역 {ROLES.length}개</h3>
            <ul className="space-y-2 text-white/70 light:text-slate-600">
              {ROLES.map((r) => (
                <li key={r.id}>
                  <b>
                    {r.emoji} {r.name}
                  </b>{" "}
                  <span className="text-[11px] opacity-70">({r.era === "joseon" ? "조선" : "현대"} · 시작 {STATS.map((s, i) => `${s.emoji}${r.start[i]}`).join(" ")})</span>
                  <br />
                  <span className="text-xs">{r.blurb}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {tab === "controls" && (
          <section>
            <h3 className={H3}>조작</h3>
            <ul className={LIST}>
              <li>선택지 카드를 누르면 바로 확정이에요(바꿀 수 없어요).</li>
              <li>공개 화면에서 🎬 무대에서 보기를 누르면 그 사람의 장면이 무대에 올라와요.</li>
              <li>엔딩 화면의 📜 인생 돌아보기로 누구의 인생이든 7장면을 다시 볼 수 있어요.</li>
              <li>🧊 3D 무대 / 🖼️ 2D 그림 전환. 자리는 색 + 모양(●◆▲■★✚⬟♥)으로, 수치 변화는 ▲▼ 기호로도 표시해요. 소리로 알리는 일은 화면 문구로도 나와요.</li>
              <li>나간 사람의 자리는 투표로 AI가 이어받아요.</li>
            </ul>
          </section>
        )}
      </div>
    </Overlay>
  );
}
