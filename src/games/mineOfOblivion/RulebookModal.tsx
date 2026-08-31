"use client";

import Overlay from "@/components/Overlay";
import { MINES_PER_PLAYER, START_TILE, TREASURE_TILES, TURN_CAP } from "./engine";

export default function MineOfOblivionRulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="💣 망각의 지뢰 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80">
        <section>
          <p className="text-white/70">
            넷플릭스 예능 &lt;데스게임&gt;에 등장한 1대1 데스매치. 5×5 격자 위에서 자신이 직접 묻은 지뢰의
            위치와 상대가 묻은 지뢰의 위치를 기억·추리하며 보물을 선점하는 고난도 블러핑 &amp; 기억력 대결입니다.
          </p>
          <p className="mt-2 text-xs text-white/40">
            [하우스 룰] 원 룰북엔 없는 <span className="text-cyan-300">🔭 정찰 아이템</span>(게임당 1회, 인접
            칸의 지뢰 유무 확인 — 이동 대신 턴 소모)과{" "}
            <span className="text-cyan-300">
              {TURN_CAP / 2}턴/인 제한(총 {TURN_CAP}턴)
            </span>
            을 이 방의 표준 규칙으로 추가했습니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">세팅</h3>
          <p className="text-white/70">
            시작 칸: <span className="font-mono text-rose-300">{START_TILE.p1}</span>(선공) /{" "}
            <span className="font-mono text-fuchsia-300">{START_TILE.p2}</span>(후공). 보물 토큰 3개는{" "}
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
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="mb-1 font-medium text-white">1️⃣ 말 이동</p>
              <p className="text-xs text-white/60">상·하·좌·우 1칸만 이동 가능(대각선 불가). 도착한 칸의 지뢰 유무가 즉시 판정됩니다.</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="mb-1 font-medium text-white">🔭 정찰 (대체 행동, 게임당 1회)</p>
              <p className="text-xs text-white/60">이동 대신, 인접한 칸 1곳의 지뢰 유무만 확인합니다. 말은 움직이지 않지만 턴은 소모됩니다.</p>
            </div>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">도착 칸 판정</h3>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-3">
              <p className="mb-1 font-medium text-emerald-300">✅ 안전</p>
              <p className="text-xs text-white/60">아무 일도 없이 턴 종료.</p>
            </div>
            <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3">
              <p className="mb-1 font-medium text-amber-300">💎 보물</p>
              <p className="text-xs text-white/60">보물 토큰 1개 즉시 획득.</p>
            </div>
            <div className="rounded-xl border border-rose-400/20 bg-rose-400/5 p-3">
              <p className="mb-1 font-medium text-rose-300">💥 지뢰</p>
              <p className="text-xs text-white/60">
                시작 칸으로 강제 후퇴 + 보물 1개 반납(있다면) + 밟힌 지뢰는 영구 소멸(이후 모두에게 안전).
              </p>
            </div>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">승리 조건</h3>
          <p className="text-white/70">
            <span className="text-amber-300">A. 보물 독점</span> — 보물 2개를 먼저 모으면 즉시 승리.
          </p>
          <p className="mt-1 text-white/70">
            <span className="text-amber-300">B. 턴 제한 도달</span> — {TURN_CAP}턴(각 {TURN_CAP / 2}턴)까지
            아무도 2개를 못 모으면, 보물 개수가 많은 쪽 승리 → 동률이면 지뢰를 밟은 횟수가 적은 쪽 승리 →
            그래도 동률이면 무승부.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">블러핑 팁</h3>
          <ul className="list-disc space-y-1 pl-4 text-xs text-white/60">
            <li>내가 묻은 지뢰 칸을 태연히 지나가 상대가 &ldquo;저긴 안전하다&rdquo;고 오판하게 유도할 수 있습니다.</li>
            <li>상대가 보물로 직진하지 않고 크게 돌아간다면, 직선 경로에 지뢰를 묻었을 가능성이 높습니다.</li>
            <li>의심스러운 길목은 보물이 없을 때 미리 밟아 지뢰를 제거해두면 이후 안전하게 지나갈 수 있습니다.</li>
          </ul>
        </section>
      </div>
    </Overlay>
  );
}
