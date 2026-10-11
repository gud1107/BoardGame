"use client";

import Overlay from "@/components/Overlay";
import { BREAK_MS, GRACE_MS, HOLD_TO_PLAY_MS, MAX_LIVES, MAX_STARS, REWARDS, RESYNC_PER_LEVEL, SETUP, STAR_COOLDOWN_MS, STAR_VOTE_MS } from "./engine";

const H3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";
const P = "text-white/70 light:text-slate-600";
const sec = (ms: number) => `${ms / 1000}초`;

/** Tiny card chip used in the worked examples. */
function Chip({ n, tone = "plain" }: { n: number | string; tone?: "plain" | "out" | "pile" }) {
  const cls =
    tone === "out"
      ? "border-dashed border-amber-300/70 text-amber-200 line-through decoration-amber-300/60 light:text-amber-700"
      : tone === "pile"
        ? "border-white/70 bg-indigo-100 text-indigo-900"
        : "border-white/20 text-white light:border-slate-300 light:text-slate-800";
  return <span className={`inline-flex min-w-7 justify-center rounded-md border px-1.5 py-0.5 text-xs font-bold tabular-nums ${cls}`}>{n}</span>;
}

/**
 * In-game rulebook (📖 button on the board). Mirrors the online rulebook
 * boardGameRule/더마인드/더마인드_온라인판.md; numbers come from engine.ts so
 * the two can't drift. `focus="star"` scrolls straight to the ⚡ section.
 */
export default function RulebookModal({ onClose, focus }: { onClose: () => void; focus?: "star" }) {
  const rewardLevels = (kind: "star" | "life") =>
    Object.entries(REWARDS)
      .filter(([, k]) => k === kind)
      .map(([lv]) => lv)
      .join("·");

  return (
    <Overlay title="📖 텔레파시 룰북" onClose={onClose} wide>
      <div
        className="flex flex-col gap-5 text-sm text-white/80 light:text-slate-700"
        ref={(el) => {
          if (el && focus === "star") el.querySelector("#tlp-rule-star")?.scrollIntoView({ block: "start" });
        }}
      >
        <section>
          <h3 className={H3}>목표</h3>
          <p className={P}>
            모두가 한 팀인 <b>협력 게임</b>이에요. 각자 1~100 숫자 카드를 들고, <b>아무 말도 신호도 없이</b> 팀 전체 카드를 <b>작은 수부터 한 장씩</b> 가운데에 쌓아요.
            차례는 없어요 — 누구든 &ldquo;이제 내 카드가 나갈 때&rdquo;라고 느낄 때 냅니다. 마지막 레벨까지 통과하면 모두 승리, 하트를 다 잃으면 모두 패배예요.
          </p>
        </section>

        <section>
          <h3 className={H3}>인원별 설정</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[280px] border-collapse text-xs">
              <thead>
                <tr className="text-white/50 light:text-slate-500">
                  <th className="border-b border-white/10 px-2 py-1.5 text-left light:border-slate-200">인원</th>
                  <th className="border-b border-white/10 px-2 py-1.5 text-right light:border-slate-200">레벨</th>
                  <th className="border-b border-white/10 px-2 py-1.5 text-right light:border-slate-200">시작 ❤️</th>
                  <th className="border-b border-white/10 px-2 py-1.5 text-right light:border-slate-200">시작 ⚡</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(SETUP).map(([n, s]) => (
                  <tr key={n} className="text-white/80 light:text-slate-700">
                    <td className="border-b border-white/5 px-2 py-1.5 light:border-slate-100">{n}인</td>
                    <td className="border-b border-white/5 px-2 py-1.5 text-right light:border-slate-100">1~{s.levels}</td>
                    <td className="border-b border-white/5 px-2 py-1.5 text-right light:border-slate-100">{s.lives}</td>
                    <td className="border-b border-white/5 px-2 py-1.5 text-right light:border-slate-100">{s.stars}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1.5 text-xs text-white/50 light:text-slate-500">
            레벨 N에서는 1인당 카드 N장. 매 레벨마다 100장을 다시 섞어요. 하트는 최대 {MAX_LIVES}개, ⚡는 최대 {MAX_STARS}개.
          </p>
        </section>

        <section>
          <h3 className={H3}>진행 순서</h3>
          <ol className={`list-decimal space-y-1.5 pl-4 ${P}`}>
            <li>
              <b>🖐 준비</b>: 카드를 받으면 모두 🖐 준비 버튼을 켜요. 전원이 켜면 3초 카운트다운 후 시작해요.
            </li>
            <li>
              <b>카드 내기</b>: 내 <b>가장 낮은 카드</b>를 {sec(HOLD_TO_PLAY_MS)} 동안 <b>꾹 누르면</b> 나가요(스페이스바도 돼요). 누르는 동안 다른 사람 화면의 내 자리에 <b>✋ 뻗는 중</b>이 보여요 — 테이블에서 손을 뻗는 모습 대신이에요. 중간에 떼면 취소(레벨당 3번까지 자유, 그 뒤엔 취소마다 2초 잠김).
            </li>
            <li>
              <b>⏱ 흐름 시계</b>: 가운데 원이 마지막 카드가 나온 뒤 지난 시간을 보여줘요. 모두에게 똑같이 흐르니 이걸 공통 박자 삼아 &ldquo;몇 초쯤 지나면 내 차례&rdquo;를 맞춰요.
            </li>
            <li>
              <b>레벨 통과</b>: 모든 손이 비면 통과! {sec(BREAK_MS)} 동안 쉬며 방금 레벨의 타임라인(누가 언제 무엇을 냈는지)을 볼 수 있어요. 모두 &ldquo;다음 레벨 준비&rdquo;를 누르면 바로 넘어가요.
            </li>
          </ol>
        </section>

        <section>
          <h3 className={H3}>💔 실수</h3>
          <p className={P}>
            카드가 나왔는데 누군가 <b>그보다 낮은 카드</b>를 아직 들고 있으면 실수예요. 서버가 바로 판정해서, 더 낮은 카드를 <b>전부 공개하고 버린 뒤</b> 하트가 <b>1개</b> 깨져요(버려진 카드가 몇 장이든 1개).
            레벨은 처음부터 다시 하지 않고, 다시 🖐 준비부터 이어가요.
          </p>
          <p className="mt-1.5 flex flex-wrap items-center gap-1 text-xs text-white/60 light:text-slate-500">
            예: 더미 <Chip n={34} tone="pile" /> → A가 <Chip n={52} tone="pile" /> 냄, B 손에 <Chip n={41} /> → 41 공개·버림, ❤️ −1
          </p>
        </section>

        <section id="tlp-rule-star" className="scroll-mt-4 rounded-xl border-2 border-amber-300/50 bg-amber-400/10 p-3 light:border-amber-300 light:bg-amber-50">
          <h3 className="mb-2 text-sm font-bold text-amber-200 light:text-amber-700">⚡ 번뜩임 — 막혔을 때 쓰는 팀 공용 능력</h3>
          <p className={P}>
            흐름이 꼬여서 누가 낼 차례인지 감이 안 올 때 써요. <b>모두가 각자 가장 낮은 카드 1장씩을 동시에 공개하고 버려요.</b> 버린 카드는 더미에 쌓이지 않아서 <b>실수가 아니고 하트도 안 잃어요.</b>{" "}
            공개된 숫자를 보고 &ldquo;아, 저 사람은 아직 큰 수구나&rdquo; 하고 서로의 범위를 짐작하는 게 진짜 가치예요.
          </p>
          <div className="my-2 flex flex-col gap-1 rounded-lg bg-black/20 p-2 text-xs text-white/70 light:bg-white light:text-slate-600">
            <p className="font-semibold text-amber-200 light:text-amber-700">예시 (더미 맨 위 20)</p>
            <p className="flex flex-wrap items-center gap-1">
              나 <Chip n={31} tone="out" /> <Chip n={77} /> · 봇1 <Chip n={58} tone="out" /> · 봇2 <Chip n={24} tone="out" /> <Chip n={90} />
            </p>
            <p>→ 31·58·24가 공개되고 버려져요. 남은 건 나 77, 봇2 90 — 이제 내가 먼저 내면 된다는 걸 알 수 있죠!</p>
          </div>
          <ul className={`list-disc space-y-1 pl-4 ${P}`}>
            <li>
              쓰는 법: <b>⚡ 번뜩임 쓰기</b> 버튼 → 모두에게 투표 창이 떠요 ({sec(STAR_VOTE_MS)}). <b>전원 찬성</b>해야 발동해요.
            </li>
            <li>투표하는 동안 게임과 흐름 시계는 멈춰요. 한 명이라도 반대하거나 시간이 지나면 취소되고, {sec(STAR_COOLDOWN_MS)} 동안 다시 제안할 수 없어요.</li>
            <li>손에 카드가 없는 사람은 공개할 게 없어요. 공개 후 모든 손이 비면 그대로 레벨 통과예요.</li>
            <li>
              ⚡ 1개를 써요. {rewardLevels("star")}레벨을 통과하면 1개씩 더 받아요(최대 {MAX_STARS}개).
            </li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>🎁 레벨 보상</h3>
          <p className={P}>
            {rewardLevels("star")}레벨 통과 → ⚡ +1 · {rewardLevels("life")}레벨 통과 → ❤️ +1. 이미 최대면 보상은 사라져요.
          </p>
        </section>

        <section>
          <h3 className={H3}>🌐 온라인 전용 규칙</h3>
          <ul className={`list-disc space-y-1.5 pl-4 ${P}`}>
            <li>
              <b>{sec(GRACE_MS)} 관용 판정</b>: 거의 동시에 낸 두 카드는 인터넷 속도 때문에 순서가 바뀔 수 있어요. {sec(GRACE_MS)} 안에 들어온 더 낮은 카드는 먼저 낸 것으로 바로잡아요 (실수 아님).
            </li>
            <li>
              <b>🖐 다시 맞추기</b>: 흐름이 꼬였다 싶으면 누구든 카드 내기를 멈추고 다 같이 🖐 준비부터 다시 할 수 있어요. 카드·하트·⚡는 그대로이고 흐름 시계만 0초로 돌아가요 (1인당 레벨마다 {RESYNC_PER_LEVEL}번, 누가 요청했는지 화면에 표시).
            </li>
            <li>
              <b>📜 기록</b>: 위쪽 📜 버튼(또는 가운데 &ldquo;이전&rdquo; 줄)을 누르면 레벨마다 더미에 쌓인 순서, 실수·⚡로 버려진 카드, 시간 흐름을 볼 수 있어요. 끝난 레벨은 각자 처음 받은 카드까지 공개돼요.
            </li>
            <li>
              <b>접속 끊김</b>: 누가 끊기면 바로 멈추고 기다려요. 돌아오지 않으면 투표로 AI 봇이 그 자리를 이어받아요.
            </li>
            <li>
              <b>🧪 연습 모드</b>: 하트·⚡가 줄지 않고 전적에 남지 않아요.
            </li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>🏆 점수</h3>
          <p className={P}>
            통과한 레벨마다 레벨×100점, 실수 없이 통과하면 +50, 최종 승리 +500, 승리 시 남은 하트 1개당 +100 · ⚡ 1개당 +50. 시간은 점수와 상관없어요 — 천천히 기다려도 괜찮아요.
          </p>
        </section>

        <section className="rounded-xl border border-rose-300/20 bg-rose-400/5 p-3 light:border-rose-300 light:bg-rose-50">
          <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-rose-200/90 uppercase light:text-rose-700">🤐 금지</h3>
          <p className="text-xs text-white/60 light:text-slate-600">
            숫자를 말하거나 암시하기(&ldquo;나 아직 멀었어&rdquo;), 손가락으로 숫자 표시, 미리 &ldquo;1초에 몇씩 센다&rdquo;처럼 박자를 약속하기. 음성 통화 중이라도 숫자 이야기는 하지 않는 게 이 게임의 전부예요!
          </p>
        </section>
      </div>
    </Overlay>
  );
}
