"use client";

import Overlay from "@/components/Overlay";
import {
  ARRIVAL_GRACE_MS,
  BRAWL_MAX_ROUNDS,
  brawlHearts,
  DRAW_LIMIT_MS,
  FEINT_INFO,
  FEINT_KINDS,
  feintRange,
  MAX_PLAYERS,
  MIN_HUMAN_RT_MS,
  MIN_PLAYERS,
  READY_MS,
  STALL_LIMIT,
  SWIFT_RT_MS,
  WAIT_MAX_MS,
  WAIT_MIN_MS,
  WINS_FINAL,
  WINS_TO_ADVANCE,
} from "./data";

const H3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";
const P = "text-white/70 light:text-slate-600";
const sec = (ms: number) => `${ms / 1000}초`;

/**
 * 게임 안 룰북 (📖). boardGameRule/정오의발도/정오의발도.md 를 줄인 것 — 숫자는 data.ts에서 읽어 어긋나지 않는다.
 */
export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="📖 정오의 발도 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80 light:text-slate-700">
        <section>
          <h3 className={H3}>목표</h3>
          <p className={P}>
            한낮의 모래 마당, 칼자루에 손을 얹은 채 마주 선 결투자들. 화면 한가운데 <b>❗</b>가 뜨는 순간 가장 먼저 칼을 뽑는 사람이 이겨요. 너무 일찍 뽑으면 <b>부정 출발</b>로 져요.
            {MIN_PLAYERS}~{MAX_PLAYERS}명, 반응 속도와 참을성의 싸움!
          </p>
        </section>

        <section>
          <h3 className={H3}>한 합의 흐름</h3>
          <ol className={`list-decimal space-y-1 pl-5 ${P}`}>
            <li>
              <b>자세</b> ({sec(READY_MS)}) — 이때 누르는 건 무시돼요.
            </li>
            <li>
              <b>기다림</b> ({sec(WAIT_MIN_MS)}~최대 {sec(WAIT_MAX_MS)}, 매번 무작위) — 이때 누르면 <b>부정 출발</b>. 중간중간 가짜 신호가 끼어들어요.
            </li>
            <li>
              <b>❗ 신호</b> — 징이 울리고 화면 가운데 빨간 ❗가 떠요. {sec(DRAW_LIMIT_MS)} 안에 누르세요 (넘기면 &ldquo;못 뽑음&rdquo;).
            </li>
            <li>
              <b>결과</b> — 칼이 스치고, 진 사람은 무릎을 꿇어요.
            </li>
          </ol>
          <p className={`mt-2 text-xs ${P}`}>
            조작: 화면 아무 데나 누르기 · 아래 큰 🗡️ 버튼 · Space / Enter / J / F. 휴대폰은 손을 떼는 순간이 아니라 <b>닿는 순간</b>을 재요.
          </p>
        </section>

        <section>
          <h3 className={H3}>반응 시간은 내 기기에서 재요</h3>
          <p className={P}>
            ❗가 <b>내 화면에 뜬 순간</b>부터 내가 누른 순간까지를 잽니다 — 방장과의 인터넷 거리(핑)는 승부에 들어가지 않아요. 단 <b>{MIN_HUMAN_RT_MS}ms 미만</b>은 사람이 볼 수 없는 속도라
            부정 출발로 쳐요 (육상 규칙과 같음). {SWIFT_RT_MS}ms 미만이면 ✨ 신속 기록. 신호 시각은 방장 기기만 알고, 화면에는 신호가 터진 뒤에야 전해져요 — 미리 알아낼 방법이 없어요.
            늦게 도착하는 입력을 위해 방장은 {sec(ARRIVAL_GRACE_MS)} 더 기다려 줘요.
          </p>
        </section>

        <section>
          <h3 className={H3}>가짜 신호 (속지 마세요)</h3>
          <ul className={`space-y-1 ${P}`}>
            {FEINT_KINDS.map((k) => (
              <li key={k}>
                {FEINT_INFO[k].emoji} {FEINT_INFO[k].label} {FEINT_INFO[k].minHeat > 0 && <span className="text-xs text-white/50 light:text-slate-400">(긴장 {"🔥".repeat(FEINT_INFO[k].minHeat + 1)}부터)</span>}
              </li>
            ))}
          </ul>
          <p className={`mt-2 text-xs ${P}`}>
            가짜 신호는 화면 <b>왼쪽 위</b>에 그림·글자로, 진짜 ❗는 <b>한가운데 빨간 원</b>으로 떠요 — 소리를 꺼도 똑같이 구분돼요. 긴장 🔥가 오를수록 가짜 신호가 많아지고(🔥 {feintRange(0).join("~")}번 → 🔥🔥🔥 {feintRange(2).join("~")}번) 기다림이 길어져요.
          </p>
        </section>

        <section>
          <h3 className={H3}>⚔️ 토너먼트</h3>
          <ul className={`list-disc space-y-1 pl-5 ${P}`}>
            <li>
              무작위 대진표. 인원이 2·4·8명이 아니면 몇 명이 <b>부전승</b>으로 올라가요. 같은 라운드 경기는 <b>모두 같은 신호</b>로 동시에 치러요.
            </li>
            <li>
              {WINS_TO_ADVANCE}선승이면 다음 라운드, <b>결승은 {WINS_FINAL}선승</b>. 라운드가 오를수록 긴장 🔥가 올라가요.
            </li>
            <li>한 합: 더 빠른 쪽 승 · 상대가 부정 출발/못 뽑음이면 승 · 둘 다 부정 출발·둘 다 못 뽑음·완전히 같은 ms면 다시.</li>
            <li>
              점수 없는 합이 {STALL_LIMIT}번 이어지면 <b>심판 판정</b>: 이 경기 평균 반응이 빠른 쪽 → 부정 출발이 적은 쪽.
            </li>
            <li>
              탈락했거나 기다리는 사람은 <b>🔮 예측</b>: 합마다 이길 사람을 고르고, 맞히면 +1. 같은 라운드에서 떨어진 사람끼리는 가장 빠른 기록 → 예측 점수로 순위를 가려요.
            </li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>🌪️ 난투</h3>
          <ul className={`list-disc space-y-1 pl-5 ${P}`}>
            <li>
              모두가 둥글게 서서 한꺼번에. 하트 ❤️ {brawlHearts(2)}개 (6명 이상은 {brawlHearts(6)}개).
            </li>
            <li>부정 출발·못 뽑음은 하트 −1. 그런 사람이 없으면 가장 느린 1명(5명 이상 남았으면 2명)이 −1. 가장 빠른 사람은 절대 잃지 않아요.</li>
            <li>
              하트가 0이면 탈락, 마지막 1명이 우승. 같은 합에 모두 떨어지면 그 합 성적 순. {BRAWL_MAX_ROUNDS}합이 넘으면 하트 → 평균 반응 순.
            </li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>AI 봇</h3>
          <p className={P}>
            봇도 사람처럼 화면에 보이는 것만 보고 움직여요. Lv.1은 평균 0.44초에 가짜 신호에 자주 속고, Lv.10은 평균 0.23초에 거의 속지 않아요. 보통 사람(0.26초 안팎)은 Lv.7까지는
            잘 이기고 Lv.9부터 어려워요.
          </p>
        </section>
      </div>
    </Overlay>
  );
}
