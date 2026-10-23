"use client";

import Overlay from "@/components/Overlay";
import {
  CHOICE_POINTS,
  CHOICE_FLOOR,
  CHOSUNG_POINTS,
  CHOSUNG_FLOOR,
  CHOSUNG_TRIES,
  CLIMB_FINISH,
  CLIMB_FLOOR_POINTS,
  CLIMB_TOP,
  LAST_SURVIVOR,
  MINI_IDS,
  MINI_INFO,
  MISSILE_DEFEND,
  MISSILE_HIT,
  MISSILE_HP,
  MISSILE_HP_POINTS,
  MISSILE_KILL,
  OX_CORRECT,
  OX_SURVIVE,
} from "./engine";

const H3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";
const LIST = "list-disc space-y-1.5 pl-4 text-white/70 light:text-slate-600";

/** 게임 중 📖 버튼 — 전체 룰북(boardGameRule/큐플레이/큐플레이.md)의 앱 적용판 요약. */
export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="📖 큐플레이 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80 light:text-slate-700">
        <section>
          <h3 className={H3}>목표</h3>
          <p className="break-keep text-white/70 light:text-slate-600">
            8가지 미니 퀴즈 게임을 이어서 치르며 점수를 모아요. 모든 게임이 끝났을 때 <b>누적 점수 1등</b>이 우승! 동점이면 미니 게임 1등 횟수로, 그래도 같으면 공동 우승.
          </p>
        </section>

        <section>
          <h3 className={H3}>진행</h3>
          <ol className="list-decimal space-y-1.5 pl-4 text-white/70 light:text-slate-600">
            <li><b>게임 소개</b> (4.5초) → <b>문제</b> → <b>정답 공개</b>(3.5초) 반복 → <b>게임 결과</b>(7초, 방장은 바로 넘기기 가능)</li>
            <li>모두 답하면 시간이 남아도 바로 정답 공개. 한 번 고른 답은 바꿀 수 없어요.</li>
            <li>방장이 고른 미니 게임 중에서 무작위 순서로 3/5/8개. 같은 판에 같은 문제는 다시 안 나와요.</li>
          </ol>
        </section>

        <section>
          <h3 className={H3}>미니 게임 8종</h3>
          <ul className="flex flex-col gap-2">
            {MINI_IDS.map((m) => (
              <li key={m} className="rounded-xl border border-white/10 bg-white/[0.03] p-3 light:border-slate-200 light:bg-slate-50">
                <p className="font-black text-white light:text-slate-900">
                  {MINI_INFO[m].emoji} {MINI_INFO[m].name}
                </p>
                <p className="mt-1 break-keep text-xs leading-relaxed text-white/70 light:text-slate-600">{DETAIL[m]}</p>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className={H3}>선착순 점수 (속담·사자성어·넌센스·상식)</h3>
          <ul className={LIST}>
            <li>정답자끼리 답을 낸 순서대로 {CHOICE_POINTS.join(" · ")}점, 5등부터 {CHOICE_FLOOR}점. 오답·무응답 0점(감점 없음).</li>
            <li>순서는 방장 기기가 받은 순서라 모든 기기에서 똑같아요.</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>연결이 끊기면</h3>
          <ul className={LIST}>
            <li>같은 초대 코드로 다시 들어오면 내 자리로 돌아가요.</li>
            <li>나가거나 4문제 연속 답을 안 하면, 남은 사람들의 투표로 AI가 대신 플레이해요. 돌아와서 &quot;내가 할게요&quot;를 누르면 되찾을 수 있어요.</li>
            <li>방장이 나가도 남은 사람 중 한 명이 진행을 이어받아요.</li>
          </ul>
        </section>
      </div>
    </Overlay>
  );
}

const DETAIL: Record<(typeof MINI_IDS)[number], string> = {
  ox: `문제 8초, ⭕/❌ 중 하나. 맞히면 +${OX_CORRECT}점, 틀리거나 안 고르면 탈락. 살아 있는 사람이 모두 틀리면 아무도 탈락하지 않아요(전원 부활). 1명 이하로 남으면 끝, 끝까지 살아남으면 +${OX_SURVIVE}점.`,
  proverb: "속담 앞부분을 보고 4개 보기 중 뒷부분 고르기(12초). 정답 공개 때 뜻을 알려 줘요.",
  idiom: "뜻 → 사자성어, 사자성어 → 뜻이 번갈아 나와요(12초). 정답 공개 때 한자와 뜻을 알려 줘요.",
  nonsense: "말장난 넌센스 퀴즈 4지선다(12초). 정답 공개 때 왜 그런지 풀이를 보여 줘요.",
  general: "역사·과학·지리·생활·문화 상식 4지선다(12초).",
  chosung: `주제와 초성(예: 🍎 과일 · ㅅㄱ)을 보고 단어를 직접 입력(25초). 같은 주제에서 초성이 같은 단어면 모두 정답. 오답은 ${CHOSUNG_TRIES}번까지. 정답자 순서대로 ${CHOSUNG_POINTS.join(" · ")}점, 그 뒤 ${CHOSUNG_FLOOR}점. 누가 맞혔는지는 바로 보이지만 단어는 공개 때까지 비밀.`,
  climb: `모두 동시에 각자 따로 3지선다(계산·큰 수·짝수)를 풀어요. 맞히면 한 층 위, 틀리면 한 층 아래(0층 아래로는 안 내려가요) + 1초 멈춤. ${CLIMB_TOP}층 꼭대기에 먼저 도착할수록 보너스(${CLIMB_FINISH.join(" · ")}, 그 뒤 10). 점수 = 층 × ${CLIMB_FLOOR_POINTS} + 완주 보너스.`,
  missile: `모두 하트 ${MISSILE_HP}개. 4지선다(10초)를 가장 먼저 맞힌 사람이 미사일 1발로 다른 사람을 조준(7초) — 맞으면 하트 −1, 0이면 탈락. 쏜 사람 +${MISSILE_HIT}점, 격추하면 +${MISSILE_KILL}점 더. 두 번째 이후 정답자는 +${MISSILE_DEFEND}점. 안 고르면 하트가 가장 많은 사람에게 자동 발사. 끝나면 남은 하트 × ${MISSILE_HP_POINTS}점, 최후의 1인은 +${LAST_SURVIVOR}점.`,
};
