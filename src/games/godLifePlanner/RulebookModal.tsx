"use client";

import Overlay from "@/components/Overlay";

const H3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";
const LIST = "list-disc space-y-1.5 pl-4 text-white/70 light:text-slate-600";

/** 게임 중 📖 버튼 — 전체 룰북(boardGameRule/갓생플래너/갓생플래너.md)의 앱 적용판 요약. */
export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="📖 갓생 플래너 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80 light:text-slate-700">
        <section>
          <h3 className={H3}>목표</h3>
          <p className="break-keep text-white/70 light:text-slate-600">
            일주일(월~일) 동안 하루를 3시간짜리 <b>8블록</b>으로 나눠 계획해요. 체력 ⚡과 멘탈 💗을 써서 지식 📘 · 몸 💪 · 자산 💰 · 관계 🤝를 키우고, 일주일 뒤 점수가 가장 높은 사람이 이겨요.
          </p>
        </section>

        <section>
          <h3 className={H3}>하루의 흐름</h3>
          <ol className="list-decimal space-y-1.5 pl-4 text-white/70 light:text-slate-600">
            <li><b>아침</b> — 오늘의 이벤트, 기회 카드, 나만 보는 유혹 카드 1장.</li>
            <li><b>계획</b> — 8블록을 비공개로 채우고 🔒 확정(제한 시간이 끝나면 지금까지 짠 계획으로 자동 확정).</li>
            <li><b>공개 · 실행</b> — 모두 동시에 공개하고 B1(0시)부터 B8(24시)까지 차례로 실행.</li>
            <li><b>마감</b> — 수면 부족 판정, 습관 판정, 주간 도전 판정.</li>
          </ol>
        </section>

        <section>
          <h3 className={H3}>활동</h3>
          <ul className={LIST}>
            <li>😴 <b>수면</b> — 밤잠(B1·B2·B8) 체력 +2 / 낮잠 체력 +1. 밤잠이 2블록 미만이면 마감 때 체력 −2, 멘탈 −1.</li>
            <li>📘 <b>공부</b> 체력 −1 멘탈 −1 지식 +2 (B3 +1) · 💼 <b>일</b> 체력 −1 멘탈 −1 자산 +2</li>
            <li>💪 <b>운동</b> 체력 −2 몸 +2 (B3·B7 +1) · 🤝 <b>약속</b> 체력 −1 관계 +1 (B7 +1)</li>
            <li>☕ <b>휴식</b> 멘탈 +2 — 멘탈을 회복하는 주된 방법이에요.</li>
            <li>B1·B2에 공부·운동·일 = <b>밤샘</b>(체력 −1 더). 평일 B4~B6 밖의 일 = <b>야근</b>(멘탈 −1 더, 자산 +1 더). 주말엔 모든 일이 특근.</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>붕괴 · 습관</h3>
          <ul className={LIST}>
            <li>비용을 낼 수 없으면 <b>실패</b>. 게이지가 0이 되면 <b>탈진</b>(체력) / <b>번아웃</b>(멘탈) — −3점, 그날 남은 블록은 날아가고 다음 날 몸살·무기력.</li>
            <li>같은 블록에 같은 활동을 <b>3일 연속</b> 성공하면 <b>습관</b> 🌱 — 비용 −1, 성장 +1 (최대 4개). 하루 빠지면 흔들림 ⚠️, 이틀 연속 빠지면 사라져요.</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>약속 · 기회 · 유혹</h3>
          <ul className={LIST}>
            <li>같은 블록에 약속을 잡은 사람이 2명 이상이면 <b>성사</b> 🤝 — 관계 +1, 멘탈 +1 더. 1~3인 게임은 매일 친구 시간이 하나 공개돼요.</li>
            <li>기회 카드 🍀는 하루 1장 신청. 정원이 넘치면 성장 합이 낮은 사람이 먼저 받아요.</li>
            <li>유혹 😈은 멘탈을 내고 <b>참거나</b>, 블록을 내주고 <b>넘어가요</b>. 멘탈이 부족하면 참을 수 없어요.</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>점수</h3>
          <p className="break-keep text-white/70 light:text-slate-600">
            네 트랙 합 + <b>가장 낮은 트랙</b>(균형 보너스) + 습관(2점, 흔들림 1점) + 비밀 인생 목표 + 주간 도전 + (체력+멘탈)÷4 − 붕괴×3
          </p>
        </section>
      </div>
    </Overlay>
  );
}
