"use client";

import Overlay from "@/components/Overlay";
import { AIM_TIMEOUT_MS, DEFAULT_BONUS_SHOTS, ROUND_SHOT_LIMIT } from "./engine";

const H3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";
const LIST = "list-disc space-y-1.5 pl-4 text-white/70 light:text-slate-600";

/** 게임 중 📖 버튼 — 전체 룰북(boardGameRule/알까기대전/알까기대전.md)의 앱 적용판 요약. */
export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="📖 알까기 대전 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80 light:text-slate-700">
        <section>
          <h3 className={H3}>목표</h3>
          <p className="break-keep text-white/70 light:text-slate-600">
            바둑판 위에서 내 알을 손가락으로 튕겨 <b>상대 알을 판 밖으로 떨어뜨려요</b>. 내 알이 하나도 안 남으면 탈락, <b>마지막까지 알이 남은 사람이 1등</b>이에요.
          </p>
        </section>

        <section>
          <h3 className={H3}>튕기는 법</h3>
          <ol className="list-decimal space-y-1.5 pl-4 text-white/70 light:text-slate-600">
            <li>내 차례에 빛나는 고리가 생긴 <b>내 알을 꾹 누르고 뒤로 당겨요</b>(새총처럼).</li>
            <li>당긴 반대쪽으로 화살표가 나와요. <b>멀리 당길수록 세게</b> — 초록 → 노랑 → 빨강.</li>
            <li>점선은 처음 부딪칠 알까지만 보여줘요. 부딪친 뒤 어디로 튈지는 직접 감으로!</li>
            <li><b>손을 떼면 딱!</b> 아주 조금만 당기고 떼면(5% 미만) 취소돼요.</li>
          </ol>
        </section>

        <section>
          <h3 className={H3}>물리</h3>
          <ul className={LIST}>
            <li>알의 <b>중심이 판 끝을 넘으면</b> 떨어져요. 반쯤 걸쳐 있어도 중심이 안쪽이면 버텨요.</li>
            <li>정면으로 맞히면 맞은 알이 거의 그 속도로 날아가고 내 알은 그 자리에 멈춰요. 비스듬히 맞히면 둘 다 갈라져요.</li>
            <li>모든 기기가 같은 계산을 해서 결과가 똑같아요. 주고받는 건 튕긴 방향·세기뿐이에요.</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>연속 공격 · 탈락</h3>
          <ul className={LIST}>
            <li>상대 알을 떨어뜨리고 <b>튕긴 내 알이 판에 남으면 한 번 더</b> — 보너스 횟수는 방장이 방을 만들 때 정해요(끔·1·2·3·5회, 기본 {DEFAULT_BONUS_SHOTS}회).</li>
            <li>내 알이 스스로 떨어지면 그 알도 잃어요.</li>
            <li>여러 명이 한꺼번에 탈락하면 알이 더 오래 판에 남았던 사람이 위예요(같은 순간이면 튕긴 사람이 아래).</li>
            <li>한 판에 {ROUND_SHOT_LIMIT}번 튕겨도 안 끝나면 남은 알 수(왕알은 2개) → 이번 판에 떨어뜨린 수로 순위를 정해요.</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>👑 왕알 모드</h3>
          <ul className={LIST}>
            <li>각자 가운데 알 하나가 크고 무거운 왕알(무게 3배, 잘 안 미끄러짐)이에요.</li>
            <li><b>왕알이 떨어지면 나머지 알도 모두 내려가고 즉시 탈락!</b> 왕알로 들이받으면 세지만 잃으면 끝이에요.</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>판 · 점수</h3>
          <ul className={LIST}>
            <li>판마다 (인원 수 − 순위)점. 4인전이면 1등 3점 · 2등 2점 · 3등 1점.</li>
            <li>방장이 단판 또는 3판을 골라요. 다음 판은 직전 판 꼴찌부터.</li>
            <li>최종 순위: 점수 → 판 1등 횟수 → 떨어뜨린 상대 알 수.</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>시간 · 화면</h3>
          <ul className={LIST}>
            <li>조준 {AIM_TIMEOUT_MS / 1000}초를 넘기면 그 차례는 넘어가요(연속 공격도 끝).</li>
            <li>빈 곳을 끌면 판 주위를 돌아보고, 휠·두 손가락으로 확대/축소. 🎥 버튼으로 위에서 보기.</li>
            <li>다른 사람이 조준하는 화살표도 실시간으로 보여요.</li>
            <li>색 구분이 어려우면: 홍은 금색 고리, 청은 금색 점이 알 위에 있어요.</li>
          </ul>
        </section>
      </div>
    </Overlay>
  );
}
