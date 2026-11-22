"use client";

import Overlay from "@/components/Overlay";
import { DESIGN_MS, ROUNDS } from "./engine";
import { SCENARIOS } from "./scenarios";
import { PIECES, TWISTS } from "./sim";

const H3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 light:text-slate-500 uppercase";
const EM = "text-amber-300 light:text-amber-700";
const TIER = ["", "⭐", "⭐⭐", "⭐⭐⭐"];

export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="🐶 멍냥 방어선 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80 light:text-slate-700">
        <section>
          <p className="text-white/70 light:text-slate-600">
            동네에 재난이 들이닥쳤어요! 모두가 <span className={EM}>같은 재난</span>을 각자의 판에서 맞아요. 정해진 🪙 예산으로 기물을 놓아 내 펫(🐶🐱🐥🐹)을 지키고, 옆 사람에게는 몰래{" "}
            <span className={EM}>🎴 변수 카드</span>를 보내 방어선을 흔들어요. {ROUNDS}라운드 동안 점수가 가장 높은 사람이 우승! 2~4인, 약 15~20분.
          </p>
        </section>
        <section>
          <h3 className={H3}>1. 라운드 진행</h3>
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              <b>설계 ({DESIGN_MS / 1000}초, 모두 동시에)</b>: 재난 설명과 위험이 나오는 곳(아이콘)을 보고 기물을 놓아요. 펫 바로 옆 8칸과 맨 윗줄엔 못 지어요. 같은 기물을 다시 누르면 치워요.
            </li>
            <li>
              <b>🔍 시험 가동</b>: 라운드마다 3번, 변수 없이 내 설계를 미리 돌려 볼 수 있어요.
            </li>
            <li>
              <b>🎴 변수 보내기</b>: 받은 카드 3장 중 1장을 <b>다음 자리</b> 사람에게 보내요. 나도 앞자리 사람에게서 1장을 받지만, 무엇인지는 시작할 때 공개돼요.
            </li>
            <li>
              <b>재난 시작</b>: 모두 제출하면 모든 판이 동시에 돌아가요. 시간이 끝나면 지금까지 놓은 대로 자동 제출돼요.
            </li>
          </ol>
        </section>
        <section>
          <h3 className={H3}>2. 점수</h3>
          <p>
            끝까지 버티면 <b>10점 + 남긴 🪙</b>. 다치면 버틴 시간만큼 <b>0~6점</b>(⌊7 × 버틴 틱 ÷ 전체 틱⌋). 동점이면 더 많이 버틴 라운드 수, 그다음 쓴 🪙가 적은 사람.
          </p>
        </section>
        <section>
          <h3 className={H3}>3. 기물</h3>
          <ul className="space-y-1">
            {PIECES.map((p) => (
              <li key={p.name}>
                {p.emoji} <b>{p.name}</b> 🪙{p.cost} — {p.desc}
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3 className={H3}>4. 위험의 성질</h3>
          <ul className="list-disc space-y-1 pl-5 text-xs">
            <li>💧 물·🧪 산성액은 아래로 떨어지고 옆으로 퍼지며 <b>대각선 틈으로도 새요</b>. 🌋 용암은 3배 느리게 흘러요. 산성 빗방울은 70틱 뒤 증발해요.</li>
            <li>🏜️ 모래·❄️ 눈·🪨 바위는 쌓이며 비탈로 미끄러져요. 펫 <b>머리 위</b>에 얹히면 다쳐요. 3칸 넘게 떨어진 바위는 나무판을 부숴요.</li>
            <li>☠️ 독가스는 위로 올라가 천장에 고였다가 옆으로 번져요 — 지붕 밑에 갇히기도 해요.</li>
            <li>🔥 불은 🪵·🌿 덤불·🌻을 태우며 번지고, 불똥은 한 칸 빈틈을 뛰어넘어요(가운데에 단단한 기물이 있으면 막혀요). 물이 닿으면 꺼져요. 용암+물 = 흑요석.</li>
            <li>🐝 벌은 가장 짧은 길로 날아와요(대각선 틈은 못 지나감). 🐝 빨간 테 말벌·🐀 쥐는 나무판을 갉아 뚫고, 쥐는 바닥·벽을 타고만 다녀요. 🦇 박쥐는 대각선으로 튕기며 날아요. 물에 빠지면 모두 떨어져요.</li>
            <li>⚡ 번개는 10틱 전에 떨어질 열이 노랗게 깜빡이고, 그 열의 가장 위에 있는 것을 때려요. 물웅덩이에 떨어지면 웅덩이에 닿은 펫이 감전돼요. ☄️ 운석은 부딪힌 곳 3×3을 날려요(돌벽·바위는 버팀).</li>
            <li>펫은 위험이 상하좌우에 닿거나 생물이 바로 옆에 오면 다쳐요.</li>
          </ul>
        </section>
        <section>
          <h3 className={H3}>5. 변수 카드</h3>
          <ul className="space-y-1 text-xs">
            {TWISTS.map((t) => (
              <li key={t.id}>
                {t.emoji} <b>{t.name}</b> — {t.desc}
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3 className={H3}>6. 재난 {SCENARIOS.length}가지</h3>
          <p className="mb-1 text-xs text-white/55 light:text-slate-500">1~2라운드 ⭐, 3~4라운드 ⭐⭐, 5~6라운드 ⭐⭐⭐ 중에서 겹치지 않게 나와요.</p>
          <ul className="grid gap-1 text-xs sm:grid-cols-2">
            {SCENARIOS.map((s) => (
              <li key={s.id}>
                {s.emoji} <b>{s.name}</b> {TIER[s.tier]} · 🪙{s.budget} · {s.ticks}틱
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3 className={H3}>7. 요령</h3>
          <ul className="list-disc space-y-1 pl-5 text-xs">
            <li>상자로 꽁꽁 싸면 안전하지만 🪙가 남지 않아요. 물길 돌리기·미끼·피뢰침처럼 싸게 막을수록 점수가 커요.</li>
            <li>🔀 역방향과 🐾 산책에 대비해 한쪽만 막지 마세요. 🧨 지진은 가장 비싼 기물을 부숴요.</li>
            <li>보낼 변수는 받는 사람의 재난을 보고 고르세요 — 물이면 💪 폭주, 한쪽에서만 오면 🔀 역방향이 아파요.</li>
          </ul>
        </section>
      </div>
    </Overlay>
  );
}
