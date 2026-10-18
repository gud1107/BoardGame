"use client";

import Overlay from "@/components/Overlay";
import { AIM_TIMEOUT_MS, RUN_GRACE_MS } from "./engine";
import { PARTY_EMOJI } from "./SheetCanvas";

const H3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";
const LIST = "list-disc space-y-1.5 pl-4 text-white/70 light:text-slate-600";

/** 게임 중 📖 버튼 — 전체 룰북(boardGameRule/컬링파티/컬링파티.md)의 앱 적용판 요약. */
export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="📖 컬링 파티 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80 light:text-slate-700">
        <section>
          <h3 className={H3}>목표</h3>
          <p className="break-keep text-white/70 light:text-slate-600">
            스톤을 얼음 위로 밀어 하우스 한가운데 <b>버튼</b>에 가깝게 붙이세요. 엔드가 끝나면 <b>버튼에 가장 가까운 스톤의 편</b>이, 다른 편의 가장 가까운 스톤보다 더 가까운 자기 스톤 수만큼 점수를 얻어요. 모든 엔드 합계가 높은 쪽이 승리!
          </p>
        </section>

        <section>
          <h3 className={H3}>내 차례</h3>
          <ol className="list-decimal space-y-1.5 pl-4 text-white/70 light:text-slate-600">
            <li>
              <b>브룸 옮기기</b> — 시트를 좌우로 끌면 티 라인 위의 브룸(조준점)이 움직여요. ◀ ▶로 5 cm씩.
            </li>
            <li>
              <b>회전</b> — ↻는 오른쪽, ↺는 왼쪽으로 휘어요. <b>느려질수록 많이 휘니까</b> 브룸은 목표보다 휘는 반대쪽에.
            </li>
            <li>
              <b>꾹 눌러 힘 모으기 → 떼면 출발</b> — 게이지의 가드 / 하우스 / 테이크아웃 구간을 보세요. 누르는 동안 시트에 직선 예상 정지 위치가 떠요(휘는 양·쓸기·다른 스톤은 빼고).
            </li>
            <li>
              <b>쓸기!</b> — 스톤이 가는 동안 🧹 버튼(스페이스 바)을 연타. 쓸면 <b>더 멀리, 더 곧게</b> 가요.
            </li>
          </ol>
        </section>

        <section>
          <h3 className={H3}>쓸기 (스위핑)</h3>
          <ul className={LIST}>
            <li>던진 편은 처음부터 끝까지, 같은 팀 모두가 함께 쓸 수 있어요. 여럿이 쓰면 세기가 더해져요.</li>
            <li>
              상대 편은 스톤이 <b>티 라인을 넘은 뒤에만</b> 쓸 수 있어요 — 하우스 뒤로 밀어내 버리기!
            </li>
            <li>0.6초에 3번 이상 누르면 최대 세기. 마찰 최대 20%↓, 휘는 힘 최대 45%↓. 일찍 쓸수록 효과가 커요.</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>엔드 · 해머</h3>
          <ul className={LIST}>
            <li>팀전은 자리 홀짝으로 🔴 레드 / 🟡 옐로. 해머(마지막 스톤)가 없는 팀부터 번갈아 던져요. 팀 안에서는 돌아가며 던져요.</li>
            <li>개인전(3~6명)은 모두 각자 한 편, 3명이면 3스톤 · 4명 이상이면 2스톤씩.</li>
            <li>점수를 낸 편은 다음 엔드에 먼저 던져요(해머는 상대에게). 블랭크 엔드면 해머가 그대로. 해머 없이 점수를 내면 스틸!</li>
            <li>마지막 엔드 뒤 1위가 같으면 연장 1엔드, 그래도 같으면 공동 순위.</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>아웃</h3>
          <ul className={LIST}>
            <li>옆 벽에 닿거나 백 라인을 완전히 넘으면 아웃.</li>
            <li>아무것도 안 맞히고 파 호그 라인(굵은 빨간 선)을 완전히 넘지 못하면 아웃.</li>
            <li>
              🛡️ <b>프리 가드 존</b>(켜져 있으면): 엔드 초반 몇 투구 동안 하우스 앞의 상대 가드를 내보내면 모든 스톤이 원위치되고 던진 스톤만 빠져요.
            </li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>🎉 파티 스톤 (엔드마다 편별 1개)</h3>
          <ul className={LIST}>
            <li>{PARTY_EMOJI.bomb} 폭탄 — 멈추면 펑! 반경 1.25 m 스톤을 날리고 사라져요.</li>
            <li>{PARTY_EMOJI.heavy} 묵직이 — 무게 2배, 계속 묵직해요.</li>
            <li>{PARTY_EMOJI.sticky} 끈끈이 — 처음 닿은 스톤과 그 자리에 철썩 붙어 멈춰요.</li>
            <li>{PARTY_EMOJI.swirl} 회오리 — 2.4배로 휘어요.</li>
            <li>{PARTY_EMOJI.ghost} 유령 — 하우스에 들어가기 전까지 다른 스톤을 통과해요.</li>
            <li>{PARTY_EMOJI.magnet} 자석 — 하우스 안에서 버튼 쪽으로 끌려가요.</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>시간</h3>
          <ul className={LIST}>
            <li>
              조준 + 힘 모으기 {AIM_TIMEOUT_MS / 1000}초. 넘기면 &ldquo;얼어붙은 손&rdquo; — 가드 자리에 약하게 자동 투구.
            </li>
            <li>스톤이 출발하면 {RUN_GRACE_MS / 1000}초가 더 붙어요. 두 번 연속 시간 초과면 봇 대체 투표가 떠요.</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>키보드</h3>
          <ul className={LIST}>
            <li>← → 브룸 · Q / E 회전 · 스페이스 누르고 떼기 = 투구 · 스톤이 가는 동안 스페이스 연타 = 쓸기</li>
          </ul>
        </section>
      </div>
    </Overlay>
  );
}
