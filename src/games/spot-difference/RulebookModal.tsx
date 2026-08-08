"use client";

import Overlay from "@/components/Overlay";

export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="📖 틀린 그림 찾기 룰북" onClose={onClose}>
      <div className="flex flex-col gap-5 text-sm text-white/80">
        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">목표</h3>
          <p className="text-white/70">
            원본 그림과 살짝 다른 수정본 그림이 나란히 놓입니다. 각 팀이 찾아낸{" "}
            <span className="text-amber-300">틀린 곳의 총합(누적 개수)</span>으로 승패를 가릅니다 — 번갈아
            맞히는 방식이 아니라, 팀원 누구든 언제든 클릭할 수 있어요.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">승리 조건</h3>
          <ul className="list-disc space-y-1 pl-4 text-white/70">
            <li>모든 스테이지의 모든 차이를 먼저 다 찾으면 그 즉시 게임이 끝나고, 더 많이 찾은 팀이 승리합니다.</li>
            <li>제한 시간이 다 되면, 그때까지 더 많은 차이를 찾은 팀이 승리합니다.</li>
            <li>양 팀 총합이 같으면 공동 승리로 처리됩니다.</li>
          </ul>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">오답 페널티</h3>
          <p className="text-white/70">
            틀린 위치를 클릭하면 <span className="text-rose-300">2초간</span> 내 클릭이 잠깁니다. 팀원이 함께
            찾는 게임이니 신중하게 클릭하세요.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">힌트</h3>
          <p className="text-white/70">
            팀마다 힌트를 <span className="text-amber-300">2회</span> 사용할 수 있습니다. 힌트를 쓰면 아직
            발견하지 못한 차이 중 하나가 우리 팀에게만 파동/위글 애니메이션으로 표시됩니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">모드</h3>
          <ul className="list-disc space-y-1 pl-4 text-white/70">
            <li>
              <span className="text-white/90">기본 스테이지</span> — 미리 만들어진 그림 세트(스테이지당 5개
              차이). 방 만들 때 1~3 스테이지를 이어서 플레이할 수 있어요.
            </li>
            <li>
              <span className="text-white/90">내 사진으로 게임하기 📸</span> — 직접 업로드한 사진 하나를 원본
              그대로 두고, 색상 반전/모자이크/블러/좌우 반전 등 자동 변형을 몇 군데(5~10곳) 적용해 문제를
              생성합니다. 어디가 바뀌었는지는 아무도 미리 알 수 없어요.
            </li>
          </ul>
        </section>
      </div>
    </Overlay>
  );
}
