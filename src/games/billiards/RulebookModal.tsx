"use client";

import { useState } from "react";
import Overlay from "@/components/Overlay";
import { AIM_TIMEOUT_MS, CAROM_SHOT_LIMIT, FOUL_PENALTY, GOLD_POINTS, POCKET_SHOT_LIMIT, THREE_CUSHION_POINTS } from "./engine";

const H3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";
const LIST = "list-disc space-y-1.5 pl-4 text-white/70 light:text-slate-600";

type Tab = "basic" | "pocket" | "carom" | "shot" | "controls";
const TABS: { id: Tab; label: string }[] = [
  { id: "basic", label: "🎱 기본" },
  { id: "pocket", label: "🕳️ 럭키 포켓" },
  { id: "carom", label: "🎯 캐롬 파티" },
  { id: "shot", label: "🌀 당점·가이드" },
  { id: "controls", label: "🎮 조작" },
];

/** 게임 중 📖 버튼 — boardGameRule/당구파티/당구파티.md 의 앱 적용판. */
export default function RulebookModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("basic");
  return (
    <Overlay title="📖 당구 파티 룰북" onClose={onClose} wide>
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
                2~4명이 한 당구대에서 돌아가며 흰 공(큐볼)을 쳐서 점수를 모아요. 방장이 고르는 두 가지 놀이 — <b>🕳️ 럭키 포켓</b>(구멍에 공 넣기)과 <b>🎯 캐롬 파티</b>(구멍 없는 대에서 빨간 공 두 개 맞히기).
              </p>
            </section>
            <section>
              <h3 className={H3}>차례</h3>
              <ul className={LIST}>
                <li>첫 사람은 무작위. 점수를 내면 <b>한 번 더</b>, 못 내면 다음 사람.</li>
                <li>한 번 칠 시간은 {AIM_TIMEOUT_MS / 1000}초(공이 다 멈춘 뒤부터). 넘기면 차례가 넘어가요(럭키 포켓은 다음 사람이 프리볼).</li>
                <li>모든 기기가 같은 물리로 결과를 다시 계산해요 — 누가 쳐도 똑같이 굴러가요.</li>
              </ul>
            </section>
          </>
        )}

        {tab === "pocket" && (
          <section className="flex flex-col gap-3">
            <div>
              <h3 className={H3}>🕳️ 럭키 포켓</h3>
              <ul className={LIST}>
                <li>1~9번 공을 다이아몬드로 모아 놓고 시작. 1번이 맨 앞, ★9(황금 공)가 가운데.</li>
                <li>
                  <b>흰 공이 가장 먼저 맞히는 공은 반드시 &ldquo;남은 공 중 가장 낮은 번호&rdquo;</b>여야 해요. 그다음엔 어떤 공이 들어가도 OK — 낮은 공을 맞혀 ★9를 넣는 조합 샷도 인정!
                </li>
                <li>넣은 공 1개 = 1점, <b>★9 = {GOLD_POINTS}점</b>. 노란 고리가 빛나는 <b>×2 포켓</b>에 들어가면 두 배. ×2 포켓은 한 번 칠 때마다 자리를 옮겨요.</li>
                <li>공을 하나라도 넣으면 한 번 더. 대 위의 공을 다 넣으면 그 판 끝 (최대 {POCKET_SHOT_LIMIT}타).</li>
              </ul>
            </div>
            <div>
              <h3 className={H3}>반칙 (−{FOUL_PENALTY}점, 0점 아래로는 안 내려가요)</h3>
              <ul className={LIST}>
                <li>흰 공이 구멍에 빠짐 · 아무 공도 못 맞힘 · 가장 낮은 번호가 아닌 공을 먼저 맞힘.</li>
                <li>반칙 샷에 들어간 공은 점수가 없고, ★9는 제자리(풋 스폿)로 돌아와요.</li>
                <li>다음 사람은 <b>🖐 프리볼</b> — 흰 공을 대 위 아무 데나 놓고 칠 수 있어요.</li>
              </ul>
            </div>
            <div>
              <h3 className={H3}>여러 판</h3>
              <p className="break-keep text-white/70 light:text-slate-600">1·2·3판 중 방장이 골라요. 점수는 판마다 쌓이고, 다음 판은 그때 꼴찌가 먼저 깨요. 동점이면 넣은 공 수 → 반칙이 적은 사람.</p>
            </div>
          </section>
        )}

        {tab === "carom" && (
          <section className="flex flex-col gap-3">
            <div>
              <h3 className={H3}>🎯 캐롬 파티 (구멍 없는 대)</h3>
              <ul className={LIST}>
                <li>공은 넷: 모두가 같이 치는 흰 공, 빨간 공 둘(◎ 무늬로 구분), 방해꾼 노란 공(✕).</li>
                <li>
                  흰 공이 <b>빨간 공 두 개를 모두 맞히고 노란 공은 안 건드리면 +1점</b>, 한 번 더.
                </li>
                <li>
                  두 번째 빨간 공을 맞히기 전에 흰 공이 쿠션에 <b>3번 이상</b> 닿았다면 <b>⭐ 쓰리쿠션 +{THREE_CUSHION_POINTS}</b>.
                </li>
                <li>흰 공이 노란 공을 건드리면 −{FOUL_PENALTY}점, 차례 끝. 공은 멈춘 자리 그대로 다음 사람이 이어 쳐요.</li>
                <li>
                  누가 목표 점수(3·5·8점)에 닿으면 그 사람 차례는 끝나고, <b>이번 바퀴에서 아직 안 친 사람까지만</b> 한 번씩 더 쳐요(먼저 치는 사람만 유리하지 않게). 그 뒤 점수가 가장 높은 사람이 1등 · {CAROM_SHOT_LIMIT}타가 지나도 점수 순.
                </li>
              </ul>
            </div>
          </section>
        )}

        {tab === "shot" && (
          <section className="flex flex-col gap-3">
            <div>
              <h3 className={H3}>세기</h3>
              <p className="break-keep text-white/70 light:text-slate-600">큐를 많이 당길수록 세게. 약하게는 아주 섬세하게, 세게는 시원하게 늘어나요(곡선). 5% 아래에서 놓으면 취소.</p>
            </div>
            <div>
              <h3 className={H3}>🌀 당점 (흰 공의 어디를 치나)</h3>
              <ul className={LIST}>
                <li>
                  <b>위(밀어치기)</b>: 맞힌 뒤 흰 공이 앞으로 따라가요. <b>아래(끌어치기)</b>: 맞힌 뒤 뒤로 돌아와요. 가운데는 그 자리에 서는 느낌.
                </li>
                <li>
                  <b>좌우(회전)</b>: 쿠션에 맞고 튕기는 각이 그쪽으로 꺾여요. 쿠션에 닿을 때마다 회전이 절반쯤 줄어요.
                </li>
              </ul>
            </div>
            <div>
              <h3 className={H3}>가이드</h3>
              <ul className={LIST}>
                <li>흰 점선: 흰 공이 처음 닿는 곳(유령 공). 그 너머는 안 보여줘요.</li>
                <li>긴 가이드(방장 선택): 노란 점선 = 맞은 공이 갈 길, 하늘색 점선 = 흰 공이 비껴갈 길(당점 없을 때 기준).</li>
              </ul>
            </div>
          </section>
        )}

        {tab === "controls" && (
          <section className="flex flex-col gap-3">
            <ul className={LIST}>
              <li>
                <b>🎥 조준 시점</b>: 화면을 좌우로 끌면 큐가 돌아가요. <b>위에서 보기</b>: 칠 곳을 눌러요.
              </li>
              <li>오른쪽 <b>세기 막대</b>를 아래로 끌어 당겼다가 손을 떼면 쳐요.</li>
              <li>왼쪽 아래 흰 공 그림을 눌러 당점, ◀ ▶ 로 미세 조준.</li>
              <li>키보드: ←/→(A/D) 조준 · Shift와 함께 미세 · W/S 밀어/끌어 · Q/E 좌우 회전 · Space 꾹 눌렀다 떼면 샷.</li>
              <li>🖐 프리볼일 땐 초록 고리의 흰 공을 끌어 놓아요.</li>
              <li>휠/핀치로 확대·축소. 🔇 소리 없이도 득점·반칙은 화면 글자로 나와요. 공마다 번호가 있어 색을 몰라도 구분돼요.</li>
            </ul>
          </section>
        )}
      </div>
    </Overlay>
  );
}
