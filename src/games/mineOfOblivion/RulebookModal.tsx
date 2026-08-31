"use client";

import Overlay from "@/components/Overlay";
import { MINES_PER_PLAYER, START_TILE, TREASURE_TILES } from "./engine";

export default function MineOfOblivionRulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="💣 망각의 지뢰 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80">
        <section>
          <p className="text-white/70">
            11×11 대형 격자 위에서 자신이 직접 묻은 지뢰의 위치와 상대가 묻은 지뢰의 위치를 기억·추리하며,
            처음 밟는 칸의 인접 지뢰 수만큼 점수를 쌓고 3개의 보물을 선점하는 탐험 레이스입니다.
          </p>
          <p className="mt-2 text-xs text-white/40">
            [개편 안내] 5×5 판 · 지뢰 밟으면 시작 칸으로 후퇴하며 보물을 반납하던 구버전 규칙을 완전히
            폐기하고, 11×11 판 · 8방향 이동 · 인접 지뢰 수 점수제 · 보물 순차 점수제로 전면 개편했습니다.
            원 룰북에 없던 🔭 정찰 아이템은 이번 개편에서 삭제되었습니다(인접 지뢰 수 공개가 그 역할을
            대신합니다).
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">세팅</h3>
          <p className="text-white/70">
            시작 칸: <span className="font-mono text-rose-300">{START_TILE.p1}</span>(선공) /{" "}
            <span className="font-mono text-fuchsia-300">{START_TILE.p2}</span>(후공) — 보드 대각선의 양 끝
            코너입니다. 보물 토큰 3개는 다른 쪽 대각선 코너 2곳 + 정중앙{" "}
            <span className="font-mono text-amber-300">{TREASURE_TILES.join(", ")}</span> 칸에 고정 배치됩니다.
          </p>
          <p className="mt-1.5 text-xs text-white/40">
            각자 가림판 뒤에서 지뢰 {MINES_PER_PLAYER}개를 비밀리에 매설합니다. 보물 칸과{" "}
            <span className="text-white/60">본인의</span> 시작 칸에는 매설할 수 없습니다(상대 시작 칸은 매설
            가능). 내가 어디에 묻었는지 스스로 기억하지 못하면, 내 지뢰를 내가 밟고 폭사할 수도 있습니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">내 턴에 하는 일</h3>
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <p className="mb-1 font-medium text-white">🧭 8방향 1칸 이동</p>
            <p className="text-xs text-white/60">
              상·하·좌·우 + 대각선까지 8방향 중 1칸으로 이동합니다. 다른 플레이어가 이미 있는 칸으로는
              이동할 수 없습니다(동일 칸 중복 진입 금지).
            </p>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">도착 칸 판정</h3>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-3">
              <p className="mb-1 font-medium text-emerald-300">🟢 미답사 칸 (최초 진입)</p>
              <p className="text-xs text-white/60">인접 8칸에 있는 총 지뢰 수만큼 즉시 점수를 획득합니다(지뢰 1개당 1점).</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="mb-1 font-medium text-white/70">⬜ 기답사 칸</p>
              <p className="text-xs text-white/60">본인 또는 상대가 이미 한 번이라도 밟은 칸이면 0점입니다.</p>
            </div>
            <div className="rounded-xl border border-rose-400/20 bg-rose-400/5 p-3">
              <p className="mb-1 font-medium text-rose-300">💥 지뢰 명중</p>
              <p className="text-xs text-white/60">
                -5점 페널티. 해당 칸의 지뢰는 (여러 개라도) 전부 즉시 제거되어 영구히 안전해집니다. 자신의
                출발지 인근에서 가장 가까운 빈 안전 칸으로 강제 리스폰됩니다.
              </p>
            </div>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">보물 순차 점수제</h3>
          <p className="text-white/70">
            보물을 밟으면 그 칸의 인접 지뢰 수 대신, 획득 순서에 따라 차등 점수를 받습니다: 1번째{" "}
            <span className="text-amber-300">+10점</span>, 2번째 <span className="text-amber-300">+15점</span>,
            3번째 <span className="text-amber-300">+20점</span>. 한 번 획득한 보물 점수는 이후 지뢰를 밟아도
            반납되지 않습니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">승리 조건</h3>
          <p className="text-white/70">보물 3개가 모두 획득되는 즉시 게임이 종료되며, 총점이 더 높은 플레이어가 승리합니다. 총점이 같으면 무승부입니다.</p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">블러핑 &amp; 추리 팁</h3>
          <ul className="list-disc space-y-1 pl-4 text-xs text-white/60">
            <li>내가 묻은 지뢰 칸을 태연히 지나가 상대가 &ldquo;저긴 안전하다&rdquo;고 오판하게 유도할 수 있습니다.</li>
            <li>한 번 공개된 인접 지뢰 수는 모두에게 공개된 정보입니다 — 숫자가 높은 칸 주변은 조심하세요.</li>
            <li>상대가 보물로 직진하지 않고 크게 돌아간다면, 직선 경로에 지뢰를 묻었을 가능성이 높습니다.</li>
          </ul>
        </section>
      </div>
    </Overlay>
  );
}
