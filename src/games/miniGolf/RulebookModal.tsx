"use client";

import { useState } from "react";
import Overlay from "@/components/Overlay";
import { HOLES, OBSTACLES, OBSTACLE_KINDS } from "./course";
import { CAP_MULT, PICK_TIMEOUT_MS, SHOT_TIMEOUT_MS } from "./engine";

const H3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";
const LIST = "list-disc space-y-1.5 pl-4 text-white/70 light:text-slate-600";

type Tab = "basic" | "score" | "course" | "obstacles" | "terms";
const TABS: { id: Tab; label: string }[] = [
  { id: "basic", label: "⛳ 치는 법" },
  { id: "score", label: "🧮 점수" },
  { id: "course", label: "🏝️ 코스" },
  { id: "obstacles", label: "🌀 장애물" },
  { id: "terms", label: "📚 용어" },
];

/** 게임 중 📖 버튼 — 전체 룰북(boardGameRule/미니골프파티/미니골프파티.md)의 앱 적용판 요약. */
export default function RulebookModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("basic");
  return (
    <Overlay title="📖 미니골프 파티 룰북" onClose={onClose} wide>
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
          <>
            <section>
              <h3 className={H3}>목표</h3>
              <p className="break-keep text-white/70 light:text-slate-600">
                하늘에 뜬 섬 코스를 돌며 공을 컵에 넣어요. <b>모든 홀의 타수를 더해 가장 적은 사람이 1등</b>. 홀이 끝날 때마다 <b>꼴찌가 다음 홀의 장애물을 골라</b> 역전을 노려요.
              </p>
            </section>
            <section>
              <h3 className={H3}>차례</h3>
              <ul className={LIST}>
                <li>홀마다 정해진 순서대로 <b>한 사람이 한 번씩</b> 쳐요. 컵에 넣은 사람은 건너뛰어요.</li>
                <li>첫 홀은 자리 순서, 다음 홀부터는 <b>누적 타수가 적은 사람부터</b>. 장애물을 고른 사람은 맨 마지막에 쳐요(남들이 어떻게 치는지 보고 칠 수 있어요).</li>
              </ul>
            </section>
            <section>
              <h3 className={H3}>치는 법</h3>
              <ol className="list-decimal space-y-1.5 pl-4 text-white/70 light:text-slate-600">
                <li>
                  <b>🏹 새총처럼 끌기</b> — 코스 아무 데나 누른 채 <b>보내고 싶은 쪽의 반대로</b> 끌어당겨요. 많이 당길수록 세게. 놓으면 바로 쳐요(공 근처로 되돌리면 취소).
                </li>
                <li>
                  <b>🎯 정밀 조준</b> — 아래 ◀ ▶ 버튼(1°, 10°)·세기 막대로 맞춘 뒤 <b>🏌️ 치기</b>. 키보드: ←→ 방향 · ↑↓ 세기 · 스페이스 치기.
                </li>
              </ol>
            </section>
            <section>
              <h3 className={H3}>시간 · 화면</h3>
              <ul className={LIST}>
                <li>공이 멈춘 뒤 {SHOT_TIMEOUT_MS / 1000}초 안에 안 치면 <b>헛스윙(+1타, 공은 그대로)</b>.</li>
                <li>🗺️ 버튼으로 홀 전체 보기 ↔ 공 따라가기를 바꿀 수 있어요.</li>
                <li>🔰 초보 도우미(방 옵션)를 켜면 공이 굴러갈 길이 하늘색 점선으로 보여요.</li>
                <li>색을 구분하기 어려우면: 공·점수표에 ● ◆ ▲ ■ ★ ✚ 무늬가 함께 있어요.</li>
              </ul>
            </section>
          </>
        )}

        {tab === "score" && (
          <>
            <section>
              <h3 className={H3}>타수</h3>
              <ul className={LIST}>
                <li>한 번 칠 때마다 1타. 섬 밖으로 떨어지면 <b>+1벌타</b>, 공은 친 자리로 돌아와요.</li>
                <li>한 홀에서 <b>파의 {CAP_MULT}배</b>를 쳐도 못 넣으면 공을 줍고 그 홀은 <b>파×{CAP_MULT}+1타</b>로 적어요.</li>
                <li>
                  남의 공을 쳐서 섬 밖으로 떨어뜨리면 그 공은 원래 자리로 돌아와요(벌타 없음). <b>남의 공을 컵에 넣어 주면</b> 그 사람은 그 타수 그대로 홀아웃!
                </li>
              </ul>
            </section>
            <section>
              <h3 className={H3}>순위</h3>
              <ul className={LIST}>
                <li>총 타수가 적을수록 위. 같으면 홀인원 수 → 파 이하로 끝낸 홀 수.</li>
              </ul>
            </section>
          </>
        )}

        {tab === "course" && (
          <section>
            <h3 className={H3}>하늘섬 9홀</h3>
            <ol className="space-y-1.5 text-white/70 light:text-slate-600">
              {HOLES.map((h) => (
                <li key={h.id} className="break-keep">
                  <b>
                    {h.id + 1}. {h.name}
                  </b>{" "}
                  (파 {h.par}) — {h.hint}
                </li>
              ))}
            </ol>
            <p className="mt-2 text-xs text-white/50 light:text-slate-500">3홀 게임은 1·4·9번, 6홀 게임은 1·2·4·5·7·9번 홀을 쳐요.</p>
            <ul className={`${LIST} mt-2`}>
              <li>
                <b>난간</b>이 없는 가장자리는 낭떠러지예요. <b>🟫 모래</b>는 공이 확 느려지고, <b>🧊 얼음</b>은 잘 안 멈춰요.
              </li>
              <li>
                <b>⌄ 화살표 무늬</b>는 비탈 — 화살표 쪽으로 공이 흘러요. <b>🔴 범퍼</b>는 통통 튕겨요.
              </li>
            </ul>
          </section>
        )}

        {tab === "obstacles" && (
          <>
            <section>
              <h3 className={H3}>꼴찌의 선택</h3>
              <ul className={LIST}>
                <li>홀이 끝나면 누적 타수 꼴찌(같으면 방금 홀을 더 못 친 사람)가 다음 홀에 놓을 장애물을 하나 골라요.</li>
                <li>{PICK_TIMEOUT_MS / 1000}초 안에 안 고르면 무작위. 장애물을 고른 사람은 그 홀에서 맨 마지막에 쳐요.</li>
              </ul>
            </section>
            {OBSTACLE_KINDS.map((k) => (
              <section key={k}>
                <h3 className={H3}>
                  {OBSTACLES[k].icon} {OBSTACLES[k].name}
                </h3>
                <p className="break-keep text-white/70 light:text-slate-600">{OBSTACLES[k].desc}</p>
                <p className="mt-1 text-xs break-keep text-emerald-200/80 light:text-emerald-700">💡 {OBSTACLES[k].tip}</p>
              </section>
            ))}
          </>
        )}

        {tab === "terms" && (
          <section>
            <ul className={LIST}>
              <li>
                <b>파</b> — 그 홀의 기준 타수. <b>버디</b> −1, <b>이글</b> −2, <b>보기</b> +1, <b>더블 보기</b> +2.
              </li>
              <li>
                <b>홀인원</b> — 한 번에 컵에 넣기!
              </li>
              <li>
                <b>립아웃</b> — 너무 세게 굴러 컵 위를 스치고 지나가는 것. 컵 근처에선 살살.
              </li>
              <li>
                <b>뱅크 샷</b> — 난간에 맞혀 각도를 꺾는 샷.
              </li>
            </ul>
          </section>
        )}
      </div>
    </Overlay>
  );
}
