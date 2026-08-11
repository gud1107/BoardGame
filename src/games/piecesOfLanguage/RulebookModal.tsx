"use client";

import Overlay from "@/components/Overlay";

const HINT_COLORS = [
  { emoji: "🟩", name: "초록 (Green)", desc: "글자와 위치가 모두 일치함" },
  { emoji: "🟨", name: "노랑 (Yellow)", desc: "글자는 단어에 포함되나 위치가 다름" },
  { emoji: "🟥", name: "빨강 (Red)", desc: "단어에 전혀 포함되지 않은 글자" },
];

export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="📖 언어의 조각 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80">
        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">
            준비
          </h3>
          <p className="text-white/70">
            게임을 시작하면 시스템이 정해진 글자 수(2~5글자)의{" "}
            <b className="text-white">공통 정답 단어 1개</b>를 무작위로 뽑아 숨겨둡니다. 이
            단어는 두 사람 모두가 함께 맞혀야 하는 유일한 정답입니다. 선/후공은 무작위로
            정해집니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">
            공통 자모음 조각 풀
          </h3>
          <p className="text-white/70">
            게임 시작과 동시에 <b className="text-white">공통 정답 단어에 실제로 쓰인 자음/모음</b>
            만큼의 조각이 화면 중앙에 노출됩니다(예: 정답이 &ldquo;가을&rdquo;이면 ㄴ·ㅏ·ㅇ·ㅡ·ㄹ
            5조각). 이 풀은 게임 내내 고정이며, 두 사람 모두 같은 조각을 봅니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">
            글자 조합 — 자음/모음 회전 &amp; 조합 제약
          </h3>
          <p className="text-white/70">
            추측 단어는 타이핑이 아니라 <b className="text-white">글자 조각 회전</b>으로
            만듭니다. 글자마다 초성·중성·종성 다이얼을 각각 돌려(◀ ▶) 조합하세요. 풀의 일부
            조각은 <b className="text-white">회전시키면 다른 자모로도 쓸 수 있어요</b>(예: ㄱ↔ㄴ,
            ㅡ↔ㅣ — 풀 조각에 ↻ 표시로 안내됩니다).
          </p>
          <p className="mt-2 text-white/70">
            <b className="text-white">조합 제약(하드 레일)</b> — 초성·중성·종성 각각은 오직{" "}
            <b className="text-white">공통 조각 풀에 있는 자모(또는 그 회전형)</b>로만 채울 수
            있습니다. 등록된 단어라도 풀로 조합할 수 없으면 제시할 수 없고, 조합이 불완전하거나
            풀 밖의 단어면 대신 <b className="text-white">조각 풀로 조합 가능한 단어 힌트</b>를
            보여줍니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">
            턴 진행 — 글자 단위 불빛 판정 &amp; 2×N 기록판
          </h3>
          <p className="text-white/70">
            Player 1과 Player 2가 <b className="text-white">번갈아가며</b> 같은 글자 수의 추측
            단어를 하나씩 제시합니다. 제시하면 자동으로 그 단어와 공통 정답 단어를 비교해{" "}
            <b className="text-white">완성된 글자 1개당 불빛 1개</b>로 판정합니다 (예: 2글자
            단어 = 불빛 2개). 두 사람의 시도 기록은 <b className="text-white">좌우 2열(2×N)</b>
            로 나란히 쌓여, 같은 턴 번호끼리 한눈에 비교할 수 있습니다.
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {HINT_COLORS.map((c) => (
              <div key={c.name} className="rounded-xl border border-white/10 bg-white/5 p-3">
                <p className="mb-1 font-medium text-white">
                  {c.emoji} {c.name}
                </p>
                <p className="text-xs text-white/60">{c.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">
            단판 승부 종료
          </h3>
          <p className="text-white/70">
            <b className="text-white">승리 조건</b> — 공통 정답 단어를 글자 위치까지 완벽하게
            맞혀 모든 글자가 초록불이 되면, 그 즉시 먼저 맞힌 플레이어가 최종 승자가 됩니다.
          </p>
          <p className="mt-2 text-white/70">
            <b className="text-white">최대 시도 횟수 (선택)</b> — 방장이 정해둔 경우, 두 사람의
            시도 횟수를 합산해 그 횟수 안에 아무도 정답을 맞히지 못하면 더 많은 초록/노랑
            불빛을 이끌어낸 쪽이 판정승합니다(동점이면 무승부).
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">
            핵심 전략
          </h3>
          <ul className="list-disc space-y-1 pl-4 text-white/70">
            <li>초반에는 중복 자모음이 없는 다양한 단어로 빨간불을 최대한 지워내세요.</li>
            <li>상대의 시도와 힌트도 함께 공개되니, 상대의 진행 상황을 참고해 더 빠르게 좁혀보세요.</li>
            <li>
              공통 조각 풀의 ↻ 표시를 눈여겨보세요 — 풀에 없는 자모라도 회전으로 만들 수 있다면
              조합에 쓸 수 있습니다.
            </li>
            <li>노란불이 뜬 글자는 다음 턴에 위치를 바꿔 다시 제시하면 빠르게 초록불로 바꿀 수 있어요.</li>
          </ul>
        </section>
      </div>
    </Overlay>
  );
}
