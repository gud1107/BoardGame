"use client";

import Overlay from "@/components/Overlay";
import { EVENTS, type EventId } from "./data";
import { EVENT_TIPS } from "./guide";

const SITUATIONS: [string, string][] = [
  ["❌ 블록이 「실패」로 떴어요", "그 블록 비용(체력·멘탈)을 낼 수 없었다는 뜻이에요. 성장은 없고 모자란 게이지가 0이 돼서 곧바로 탈진·번아웃으로 이어져요. 계획 화면의 빨간 테두리 칸이 실패 예정 칸이니 확정 전에 꼭 고치세요."],
  ["🥵 탈진 / 😵 번아웃", "체력이나 멘탈이 0이 되면 −3점, 그날 남은 블록은 🫥 무효. 다음 날 아침 게이지가 3까지 응급 회복되지만 몸살·무기력이 와요."],
  ["🤒 몸살", "탈진했거나 감기 유행 날 체력 4 이하로 마감하면 다음 날 운동 금지. 공부·약속·수면 위주로 짜세요."],
  ["😶 무기력", "번아웃 다음 날엔 공부·일 금지, 유혹 저항 불가. 대신 E7 야근은 면제돼요. 휴식으로 멘탈부터 채우세요."],
  ["😈 유혹을 「참기」 버튼이 안 눌려요", "참으려면 멘탈이 (참기 비용 + 1) 이상이어야 해요. 무기력이어도 참을 수 없어요. 이럴 땐 피해가 가장 적은 블록에 넘어가세요."],
  ["🤝 약속인데 관계가 줄었어요 / 🙇 펑크", "약속 블록에서 체력이 모자라 못 나가면 펑크 — 관계 −1이에요. 혼자 나간 약속은 펑크는 아니지만 기본 관계 +1만 받아요. 같은 블록에 다른 사람·친구(1~3인)가 있거나 단체 회식 날이면 성사돼 보너스를 받아요."],
  ["🍀 기회 카드를 신청했는데 못 받았어요", "계획에 그 블록·활동이 없거나, 정원이 넘쳐 성장 합이 더 낮은 사람이 먼저 받았을 수 있어요."],
  ["⚠️ 습관이 흔들려요", "습관 블록을 하루 빠지면 흔들림(점수 1점), 이틀 연속 빠지면 사라져요. 다음 날 같은 블록에 다시 하면 회복돼요."],
  ["⏱ 시간 안에 확정 못 했어요", "제한 시간이 끝나면 지금까지 짠 계획으로 자동 확정돼요. 아예 못 보냈다면 기본 계획이 들어가요."],
  ["🔌 연결이 끊겼어요", "다시 들어오면 이어서 할 수 있어요. 오래 비우면 다른 사람 투표로 봇이 대신 할 수 있어요."],
  ["🏁 마지막 날엔?", "내일이 없으니 게이지를 아낄 필요가 없어요. 남은 (체력+멘탈)÷4만 점수가 되니 성장에 다 쓰되 0만 피하세요."],
];

const H3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";
const LIST = "list-disc space-y-1.5 pl-4 text-white/70 light:text-slate-600";

/** 게임 중 📖 버튼 — 전체 룰북(boardGameRule/갓생플래너/갓생플래너.md)의 앱 적용판 요약. */
export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="📖 갓생 플래너 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80 light:text-slate-700">
        <section className="rounded-xl border border-amber-400/30 bg-amber-400/[0.06] p-3 light:bg-amber-50">
          <h3 className={H3}>🏆 이기는 법 (한 줄 요약)</h3>
          <p className="break-keep text-white/80 light:text-slate-700">
            매일 계획을 짜서 <b>네 트랙을 골고루 키우고</b>, <b>습관</b>을 만들고, <b>비밀 인생 목표</b>를 달성하되 <b>체력·멘탈이 0이 되지 않게</b> 하세요. 마지막 날 마감 점수 1등이 승리예요.
          </p>
        </section>

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
          <h3 className={H3}>상황별 안내</h3>
          <dl className="flex flex-col gap-2">
            {SITUATIONS.map(([q, a]) => (
              <div key={q}>
                <dt className="font-semibold text-white/85 light:text-slate-800">{q}</dt>
                <dd className="break-keep text-white/65 light:text-slate-600">{a}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section>
          <h3 className={H3}>오늘의 이벤트 · 대처법</h3>
          <ul className="flex flex-col gap-1.5 text-white/70 light:text-slate-600">
            {(Object.keys(EVENTS) as EventId[]).map((id) => (
              <li key={id} className="break-keep">
                {EVENTS[id].emoji} <b className="text-white/85 light:text-slate-800">{EVENTS[id].name}</b> — {EVENTS[id].text}
                <span className="block text-xs text-white/50 light:text-slate-500">→ {EVENT_TIPS[id]}</span>
              </li>
            ))}
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
