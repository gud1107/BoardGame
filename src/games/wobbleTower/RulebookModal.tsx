"use client";

import Overlay from "@/components/Overlay";
import { PLACE_TIMEOUT_MS, PULL_TIMEOUT_MS, TIMEOUT_QUALITY } from "./engine";

const H3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";
const LIST = "list-disc space-y-1.5 pl-4 text-white/70 light:text-slate-600";

/** 게임 중 📖 버튼 — 전체 룰북(boardGameRule/와르르타워/와르르타워.md)의 앱 적용판 요약. */
export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="📖 와르르 타워 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80 light:text-slate-700">
        <section>
          <h3 className={H3}>목표</h3>
          <p className="break-keep text-white/70 light:text-slate-600">
            18층 나무 탑에서 블록을 <b>하나 빼서 꼭대기에 올리기</b>를 돌아가며 해요. <b>탑을 무너뜨린 사람이 져요(💥)</b>. 무너지기 직전에 마지막으로 올리기까지 성공한 사람은 <b>🏅 마지막 건축가</b>.
          </p>
        </section>

        <section>
          <h3 className={H3}>내 차례</h3>
          <ol className="list-decimal space-y-1.5 pl-4 text-white/70 light:text-slate-600">
            <li><b>블록 고르기</b> — 탑의 블록을 눌러요. 고른 블록은 헐거운 만큼 덜그럭거리고 헐렁해요/보통/뻑뻑해요가 떠요.</li>
            <li><b>잡아 빼기</b> — 카메라가 다가가면 그 블록을 <b>꾹 잡고 빼고 싶은 쪽으로</b> 끌어요. 내 쪽으로 끌면 끝을 집어 당기고, 반대쪽으로 끌면 손가락으로 밀어내요. <b>천천히, 일정하게!</b> 빠르게 끌면 긴장도가 올라요.</li>
            <li><b>🔒 걸림</b>이 뜨면 손을 멈추고 풀릴 때까지 기다려요. 걸린 채로 끌면 긴장도가 확 올라요. 긴장도가 끝까지 차면 <b>덜컥!</b></li>
            <li><b>올리기</b> — 꼭대기의 빈칸(반짝이는 자리)을 눌러 올려요.</li>
          </ol>
        </section>

        <section>
          <h3 className={H3}>뺄 수 있는 블록</h3>
          <ul className={LIST}>
            <li>꼭대기 층은 안 돼요. 꼭대기가 3개로 안 찼으면 그 바로 아래 층도 안 돼요.</li>
            <li>층에 마지막 1개 남은 블록은 못 빼요.</li>
            <li>가장자리 하나만 남게 되는 빼기처럼 버틸 수 없는 수는 두는 순간 무너져요.</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>무너질 확률이 오르는 것</h3>
          <ul className={LIST}>
            <li>거친 손놀림(빠르게·걸린 채로 당김) × 뻑뻑하고 위에 많이 얹힌 블록</li>
            <li>빈칸이 많은 층, 무게중심이 받침 가장자리에 가까운 층</li>
            <li>방금까지 거칠게 뺀 흔들림(차례가 지나면 조금씩 가라앉아요), 18층보다 높은 탑</li>
            <li>한쪽으로 몰아 올리면 탑 전체가 기울어 모두가 위험해져요.</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>점수 · 판</h3>
          <ul className={LIST}>
            <li>무너뜨린 사람 빼고 모두 +1점, 🏅 마지막 건축가는 +1점 더.</li>
            <li>방장이 단판 또는 3판을 골라요. 다음 판은 직전 판의 패자부터.</li>
            <li>최종 순위: 점수 → 💥 적은 순 → 성공한 빼기 많은 순.</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>남의 차례에는</h3>
          <ul className={LIST}>
            <li><b>🔮 버틴다 / 무너진다</b>를 찍어요 — 당기기 시작하면 마감. 버틴다 적중 +1, 무너짐 적중 +2 (승패와 별개인 예언 점수).</li>
            <li>👏 😱 🤫 😂 🙏 리액션이 이름과 함께 무대 위로 떠올라요.</li>
            <li><b>💨 입김</b> — 차례마다 한 번, 모두의 화면에서 탑이 살짝 흔들려요. 판정에는 영향 없어요.</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>시간</h3>
          <ul className={LIST}>
            <li>빼기 {PULL_TIMEOUT_MS / 1000}초를 넘기면 &ldquo;떨리는 손&rdquo; — 가장 안전해 보이는 블록을 손놀림 {Math.round(TIMEOUT_QUALITY * 100)}%로 자동으로 빼요.</li>
            <li>올리기 {PLACE_TIMEOUT_MS / 1000}초를 넘기면 가장 균형이 좋은 칸에 자동으로 올려요.</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>조작</h3>
          <ul className={LIST}>
            <li>화면을 드래그하면 탑 주위를 돌아보고, 휠·두 손가락으로 확대/축소해요.</li>
            <li>다른 사람이 당기는 모습도 실시간으로 보여요. 판정은 다 뺀 뒤의 손놀림 점수로만 해요.</li>
          </ul>
        </section>
      </div>
    </Overlay>
  );
}
