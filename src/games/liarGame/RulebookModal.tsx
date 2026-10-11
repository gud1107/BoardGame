"use client";

import Overlay from "@/components/Overlay";

const H3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";
const LIST = "list-disc space-y-1.5 pl-4 text-white/70 light:text-slate-600";

/** 게임 중 📖 버튼 — 전체 룰북(boardGameRule/라이어게임/라이어게임.md)의 앱 적용판 요약. */
export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="📖 라이어를 찾아라 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80 light:text-slate-700">
        <section>
          <h3 className={H3}>목표</h3>
          <p className="break-keep text-white/70 light:text-slate-600">
            모두 같은 <b>카테고리</b>를 듣고, <b>시민</b>은 <b>제시어</b>를 받지만 <b>라이어</b> 한 명은 제시어를 모릅니다.
            시민은 제시어를 들키지 않게 설명하며 라이어를 찾고, 라이어는 정체를 숨기며 제시어를 알아내야 합니다.
          </p>
        </section>

        <section>
          <h3 className={H3}>한 라운드</h3>
          <ol className="list-decimal space-y-1.5 pl-4 text-white/70 light:text-slate-600">
            <li><b>🗣️ 설명</b> — 선 플레이어부터 차례로 한 마디씩(방장 설정에 따라 1~2바퀴, 1인 30초).</li>
            <li><b>💬 토론</b> — 채팅으로 자유롭게 의심하고 해명해요. 모두 &quot;투표하러 가기&quot;를 누르거나 90초가 지나면 투표.</li>
            <li><b>🗳️ 투표</b> — 동시에 라이어라고 생각하는 한 명을 지목(자기 자신은 불가, 30초).</li>
            <li><b>🎭 공개</b> — 최다 득표자의 정체 공개. 시민이면 라이어 승리!</li>
            <li><b>🔍 정답 맞히기</b> — 라이어가 지목되면 제시어를 <b>한 번</b> 맞힐 기회. 맞히면 라이어 승, 틀리면 시민 승.</li>
          </ol>
        </section>

        <section>
          <h3 className={H3}>금지 · 판정</h3>
          <ul className={LIST}>
            <li>제시어를 직접 쓰거나, 초성만 쓰거나, 같은 라운드에 이미 나온 설명을 그대로 쓰면 입력이 막혀요.</li>
            <li>시간 안에 설명하지 못하면 &quot;패스&quot;로 기록돼요(의심받기 쉬워요).</li>
            <li>동점이면 동점자끼리 재투표 — 동점자는 투표하지 않고 나머지가 투표해요. 또 동점이면 라이어 승리.</li>
            <li>투표 시간이 끝날 때까지 안 고른 표는 무효예요. 유효표가 하나도 없으면 라이어 승리.</li>
            <li>정답은 띄어쓰기·문장부호 차이만 인정해요(상위어·비슷한 말은 오답).</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>점수</h3>
          <ul className={LIST}>
            <li>라이어가 지목을 피함(엉뚱한 사람 지목 · 끝까지 동점) — <b>라이어 +3</b></li>
            <li>지목됐지만 제시어를 맞힘 — <b>라이어 +2</b></li>
            <li>지목되고 제시어를 못 맞힘 — <b>시민 모두 +1</b>, 1차 투표에서 라이어를 찍은 시민은 <b>+1 더</b></li>
            <li>마지막 라운드가 끝났을 때 점수가 가장 높은 사람이 우승(동점은 공동 우승).</li>
          </ul>
        </section>

        <section className="rounded-xl border border-fuchsia-300/20 bg-fuchsia-400/5 p-3 light:border-fuchsia-300 light:bg-fuchsia-50">
          <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-fuchsia-200/90 uppercase light:text-fuchsia-800">방장 설정</h3>
          <ul className="list-disc space-y-1.5 pl-4 text-xs text-white/70 light:text-slate-700">
            <li><b>🤪 바보 모드</b> — 라이어도 &quot;비슷한 다른 제시어&quot;를 받아서 자기가 라이어인 줄 몰라요.</li>
            <li><b>🔢 객관식 / ✍️ 주관식</b> — 라이어의 정답 맞히기를 6지선다로 할지, 직접 입력으로 할지.</li>
            <li><b>라운드 수 · 설명 바퀴 수 · 카테고리</b>(랜덤 또는 고정).</li>
          </ul>
        </section>
      </div>
    </Overlay>
  );
}
