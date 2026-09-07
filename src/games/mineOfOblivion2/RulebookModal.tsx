"use client";

import Overlay from "@/components/Overlay";
import { MINES_PER_PLAYER, START_TILE, TIME_BOMBS_PER_PLAYER, TIME_BOMB_FUSE_OPTIONS, TIME_BOMB_MANUAL_TRIGGER_DELAY, TREASURE_TILES } from "./engine";

export default function MineOfOblivion2RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="🧨 망각의 지뢰 2 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80">
        <section>
          <p className="text-white/70">
            1편의 11×11 탐험 레이스(비밀 지뢰 매설 + 인접 지뢰 수 점수제 + 보물 순차 획득)에 신규
            <span className="text-amber-300"> 시한폭탄(Time Bomb) </span>레이어를 추가한 후속작입니다. 각자
            시한폭탄 {TIME_BOMBS_PER_PLAYER}개를 추가로 비밀 매설하고, 카운트다운이 0이 되는 순간 설치 칸
            중심 3×3(9칸) 범위가 대폭발합니다.
          </p>
          <p className="mt-2 text-xs text-white/40">
            나머지 규칙(안전구역, 보물 순차 점수, 지뢰 명중 −5, 인접 지뢰 수 공개)은 1편과 완전히 동일합니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">세팅</h3>
          <p className="text-white/70">
            🛡️ 안전구역(시작 칸): <span className="font-mono text-rose-300">{START_TILE.p1}</span>(선공) /{" "}
            <span className="font-mono text-fuchsia-300">{START_TILE.p2}</span>(후공). 보물 3개는{" "}
            <span className="font-mono text-amber-300">{TREASURE_TILES.join(", ")}</span> 칸에 고정 배치됩니다.
          </p>
          <p className="mt-1.5 text-xs text-white/40">
            각자 가림판 뒤에서 일반 지뢰 {MINES_PER_PLAYER}개와 시한폭탄 {TIME_BOMBS_PER_PLAYER}개, 총{" "}
            {MINES_PER_PLAYER + TIME_BOMBS_PER_PLAYER}개를 서로 겹치지 않는 칸에 비밀리에 매설합니다. 보물 칸과
            양쪽 안전구역에는 매설할 수 없습니다. 시한폭탄은 하나씩 설치할 때마다{" "}
            {TIME_BOMB_FUSE_OPTIONS.join("/")}턴 중 원하는 카운트다운 길이를 직접 고릅니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">🧨 시한폭탄 규칙</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3">
              <p className="mb-1 font-medium text-amber-300">⏱️ 카운트다운 (전역 턴 기준)</p>
              <p className="text-xs text-white/60">
                설치 시 고른 턴 수(3~5턴)에서 시작해, <b>누구 턴이든 이동이 한 번 일어날 때마다</b> 1씩
                줄어듭니다. 즉 한 라운드(양쪽 모두 1번씩 이동)에 2씩 감소합니다. 본인이 설치한 폭탄에는 남은
                턴 수가 째깍거리는 숫자로 항상 표시되지만, 상대의 폭탄은 터지기 전까지 전혀 보이지 않습니다.
              </p>
            </div>
            <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-3">
              <p className="mb-1 font-medium text-emerald-300">🚶 아직 안 터진 폭탄 칸을 밟으면?</p>
              <p className="text-xs text-white/60">
                아무 일도 일어나지 않습니다. 완전히 평범한 칸과 똑같이 판정되며(최초 방문이면 인접 지뢰 수
                점수 획득), 밟는다고 해체되거나 조기 폭발하지 않습니다. 오직 카운트다운이 스스로 0이 되었을
                때만 터집니다.
              </p>
            </div>
            <div className="rounded-xl border border-rose-400/20 bg-rose-400/5 p-3 sm:col-span-2">
              <p className="mb-1 font-medium text-rose-300">💥 카운트다운 만료 · 3×3 대폭발</p>
              <p className="text-xs text-white/60">
                설치 칸을 중심으로 3×3(최대 9칸) 범위가 즉시 폭발합니다. 그 순간 범위 안에 있는 모든
                플레이어(설치자 본인 포함)가 각각 <b>−5점</b> 페널티를 받고, 지뢰 명중과 동일하게 자신의
                출발지 인근 가장 가까운 안전 칸으로 강제 리스폰됩니다. 반경 안에 아무도 없이 안전하게
                지나갔다면, 설치자가 <b>+2점</b> 보너스를 받습니다.
              </p>
            </div>
            <div className="rounded-xl border border-orange-400/20 bg-orange-400/5 p-3 sm:col-span-2">
              <p className="mb-1 font-medium text-orange-300">🕹️ 원격 즉시 격발 (수동 기폭)</p>
              <p className="text-xs text-white/60">
                본인 차례라면, 상대의 위치나 남은 턴 수와 무관하게 언제든 자신이 설치한 시한폭탄 칸을 탭해
                <b> [즉시 격발]</b>을 누를 수 있습니다. 다만 그 자리에서 바로 터지는 것은 아니고, 남은 턴이{" "}
                <b>{TIME_BOMB_MANUAL_TRIGGER_DELAY}턴</b>으로 강제 단축될 뿐입니다 — 이후로는 평소와 똑같이
                {TIME_BOMB_MANUAL_TRIGGER_DELAY}번의 이동(전역 턴)이 더 지나야 실제로 3×3 폭발이 일어납니다.
                이미 남은 턴이 {TIME_BOMB_MANUAL_TRIGGER_DELAY}턴 이하라면 더 단축할 게 없어 격발 버튼이
                비활성화됩니다. 이 격발은 이동과 별개의 <b>무료 액션</b>이라 턴을 소모하지 않으므로, 격발
                후에도 그대로 이동해 턴을 마칠 수 있습니다.
              </p>
            </div>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">도착 칸 판정 (1편과 동일)</h3>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-3">
              <p className="mb-1 font-medium text-emerald-300">🟢 미답사 칸</p>
              <p className="text-xs text-white/60">인접 8칸의 총 지뢰 수만큼 즉시 점수 획득(시한폭탄은 이 숫자에 포함되지 않습니다).</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="mb-1 font-medium text-white/70">⬜ 기답사 칸</p>
              <p className="text-xs text-white/60">0점, 즉시 다음 차례로 넘어갑니다.</p>
            </div>
            <div className="rounded-xl border border-rose-400/20 bg-rose-400/5 p-3">
              <p className="mb-1 font-medium text-rose-300">💣 지뢰 명중</p>
              <p className="text-xs text-white/60">−5점 후 해당 지뢰 전부 제거, 안전구역 인근으로 강제 리스폰(시한폭탄과 별개 하자드).</p>
            </div>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">보물 순차 점수제 · 승리 조건</h3>
          <p className="text-white/70">
            보물 획득 순서에 따라 1번째 <span className="text-amber-300">+10점</span>, 2번째{" "}
            <span className="text-amber-300">+15점</span>, 3번째 <span className="text-amber-300">+20점</span>.
            3개 모두 획득되는 즉시 게임 종료, 총점이 더 높은 쪽이 승리(동점이면 무승부)합니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">전략 팁</h3>
          <ul className="list-disc space-y-1 pl-4 text-xs text-white/60">
            <li>짧은 퓨즈(3턴)는 빨리 터져 기습에 유리하지만, 상대가 아직 근처에 없을 확률도 높습니다.</li>
            <li>긴 퓨즈(5턴)는 상대가 그 구역을 지나갈 때까지 기다릴 시간을 벌지만, 그만큼 상대도 대비할 시간이 늘어납니다.</li>
            <li>내 시한폭탄의 3×3 반경에 스스로 들어가면 자폭 −5를 당하니, 카운트다운이 얼마 안 남은 내 폭탄 근처는 직접 피하세요.</li>
            <li>일반 지뢰와 달리 시한폭탄은 밟아도 안전하다는 점을 역이용해, 상대를 방심시키는 블러핑 동선도 가능합니다.</li>
            <li>
              상대가 내 시한폭탄 반경 안에 막 들어온 순간을 놓쳤다면, 자동 카운트다운을 기다리지 말고
              [즉시 격발]로 {TIME_BOMB_MANUAL_TRIGGER_DELAY}턴짜리 강제 카운트다운을 새로 걸어 추격전을 걸 수도
              있습니다.
            </li>
          </ul>
        </section>
      </div>
    </Overlay>
  );
}
