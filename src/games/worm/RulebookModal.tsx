"use client";

import Overlay from "@/components/Overlay";

export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="📖 지렁이 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80">
        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">목표</h3>
          <p className="text-white/70">
            Slither.io 스타일의 실시간 대전입니다. 바닥에 떨어진 먹이를 먹어 몸집을 키우고, 상대의 몸통을
            들이받아 꼬리를 잘라 빼앗으면서 제한 시간 3분 동안 살아남으세요. 시간이 다 되면{" "}
            <span className="text-lime-300">누적 점수</span>가 가장 높은 지렁이가 승리합니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">조작법</h3>
          <ul className="list-disc space-y-1.5 pl-4 text-white/70">
            <li>
              <b>PC</b>: 마우스를 화면 중앙(내 머리) 기준으로 움직인 방향으로 이동합니다. 방향키/WASD를 누르고
              있으면 그 방향이 우선합니다. <b>스페이스바</b> 또는 마우스 클릭 유지로 부스터(대시)를 씁니다.
            </li>
            <li>
              <b>모바일</b>: 화면 좌하단 가상 조이스틱을 드래그해 방향을 조절하고, 우하단 🚀 버튼을 눌러 부스터를
              씁니다.
            </li>
          </ul>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">핵심 메커니즘</h3>
          <ol className="list-decimal space-y-1.5 pl-4 text-white/70">
            <li>
              <b>먹이 섭취</b>: 바닥에 무작위로 떨어진 먹이 알갱이를 머리로 스치면 즉시 흡수해 몸통이 늘어나고
              점수가 오릅니다.
            </li>
            <li>
              <b>꼬리 약탈</b>: 내 머리로 상대 몸통의 특정 지점을 들이받으면, 그 지점부터 뒤쪽 꼬리가 전부
              잘려나가며 그 자리에 먹이로 흩뿌려집니다 — 누구든 즉시 먹어서 흡수할 수 있습니다. 나는 죽지
              않습니다.
            </li>
            <li>
              <b>머리 vs 머리 충돌</b>: 더 긴 지렁이가 살아남고 짧은 쪽이 사망합니다(전체 꼬리 드랍). 길이가
              같으면 둘 다 죽지 않고 각자 꼬리 1마디만 잃습니다.
            </li>
            <li>
              <b>자폭</b>: 내 머리가 내 몸통(머리 바로 뒤 몇 마디는 예외)에 부딪히면 즉시 사망하며 몸 전체가
              먹이로 흩뿌려집니다.
            </li>
            <li>
              <b>벽 충돌</b>: 경기장 바깥 경계에 머리가 닿아도 사망 처리됩니다(자폭과 동일하게 전체 드랍).
            </li>
            <li>
              <b>부스터(대시)</b>: 이동 속도가 약 1.7배 빨라지지만, 사용하는 동안 일정 시간마다 꼬리 1마디씩
              바닥에 흘리며 몸집이 줄어듭니다. 몸집이 너무 작으면(6마디 이하) 부스터를 쓸 수 없습니다.
            </li>
            <li>
              <b>사망 후 부활</b>: 사망하면 약 1.8초 후 새로운 위치에서 짧은 몸으로 다시 시작합니다. 이미 얻은
              누적 점수와 최고 길이 기록은 유지됩니다.
            </li>
          </ol>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">HUD & 리더보드</h3>
          <p className="text-white/70">
            좌상단에서 내 현재 길이·점수·남은 시간을, 우상단 리더보드에서 현재 전장에서 가장 긴 지렁이 TOP 5를
            실시간으로 확인할 수 있습니다. 몸집이 길어질수록 카메라가 살짝 넓게 보여줍니다(다이나믹 줌아웃).
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">종료 & 승리</h3>
          <p className="text-white/70">
            제한 시간 3분이 지나면 즉시 게임이 끝납니다. 순위는 죽어도 사라지지 않는{" "}
            <b>누적 점수</b>(먹이를 먹어 얻은 총합)로 매기고, 점수가 같으면 그동안 도달한{" "}
            <b>최고 길이</b>로 동점을 가릅니다.
          </p>
        </section>

        <section className="rounded-xl border border-amber-300/20 bg-amber-400/5 p-3">
          <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-amber-200/90 uppercase">참고</h3>
          <p className="text-xs text-white/60">
            이 게임은 각자 다른 기기에서 접속하는 실시간 온라인 전용 대전입니다. 방을 만든 사람의 기기가 물리
            연산을 담당하고(호스트), 나머지는 그 결과를 실시간으로 전달받아 화면에 그립니다 — 호스트 탭을 닫으면
            그 판은 더 이상 진행되지 않으니 유의하세요.
          </p>
        </section>
      </div>
    </Overlay>
  );
}
