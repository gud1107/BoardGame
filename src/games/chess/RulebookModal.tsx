"use client";

import Overlay from "@/components/Overlay";
import ChessPiece, { ChessPieceDefs, type PieceType } from "./ChessPieces";

/** 게임 중 📖 버튼 — 전체 룰북(boardGameRule/체스/체스.md)의 앱 적용판 요약. */

const PIECES: { t: PieceType; name: string; value: string; move: string }[] = [
  { t: "k", name: "킹", value: "∞", move: "모든 방향 1칸. 공격받는 칸으로는 못 감 — 두 킹은 붙을 수 없어요." },
  { t: "q", name: "퀸", value: "9", move: "가로·세로·대각선 몇 칸이든 (룩 + 비숍)." },
  { t: "r", name: "룩", value: "5", move: "가로·세로 몇 칸이든. 캐슬링에 참여." },
  { t: "b", name: "비숍", value: "3", move: "대각선 몇 칸이든 — 평생 처음 칸 색에서만." },
  { t: "n", name: "나이트", value: "3", move: "L자(2+1칸). 유일하게 다른 기물을 뛰어넘어요." },
  { t: "p", name: "폰", value: "1", move: "앞으로 1칸(처음엔 2칸까지). 잡을 때만 대각선 앞 1칸. 뒤로 못 감." },
];

const H3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";
const CARD = "rounded-xl border border-white/10 bg-white/5 p-3 light:border-slate-200 light:bg-slate-50";
const EM = "text-amber-300 light:text-amber-700";

export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="📖 체스 룰북" onClose={onClose} wide>
      <ChessPieceDefs />
      <div className="flex flex-col gap-5 text-sm text-white/80 light:text-slate-700">
        <section>
          <h3 className={H3}>목표</h3>
          <p>
            상대 <span className={EM}>킹을 체크메이트</span>하면 승리 — 킹이 공격받고 있고(체크) 어떤 수로도 피할 수 없는 상태입니다. 언제나 <b>백</b>이 먼저 두고, 한 번에 한 수씩 번갈아 둡니다(패스 없음).
          </p>
        </section>

        <section>
          <h3 className={H3}>기물과 이동 (§4)</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {PIECES.map((p) => (
              <div key={p.t} className={`${CARD} flex gap-3`}>
                <div className="flex shrink-0 gap-0.5">
                  <ChessPiece type={p.t} white className="h-9 w-9" />
                  <ChessPiece type={p.t} white={false} className="h-9 w-9" />
                </div>
                <div>
                  <p className="font-medium text-white light:text-slate-900">
                    {p.name} <span className="text-xs text-white/40 light:text-slate-400">가치 {p.value}</span>
                  </p>
                  <p className="text-xs text-white/60 light:text-slate-600">{p.move}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-white/55 light:text-slate-500">퀸·룩·비숍은 가는 길이 막히면 그 앞까지만. 상대 기물이 있는 칸으로 가면 잡습니다(잡기는 의무 아님).</p>
        </section>

        <section>
          <h3 className={H3}>특수 수 (§6~§8)</h3>
          <div className="grid gap-2">
            <div className={CARD}>
              <p className="font-medium text-white light:text-slate-900">🏰 캐슬링 — O-O / O-O-O</p>
              <p className="text-xs text-white/60 light:text-slate-600">
                킹을 룩 쪽으로 2칸, 룩은 킹을 넘어 바로 옆으로. <b>안 되는 경우</b>: 킹이나 그 룩이 한 번이라도 움직였음 · 사이에 기물 있음 · 지금 체크 · 킹이 지나가거나 도착하는 칸이 공격받음. (조작: 킹을 2칸 옆 또는 내 룩 위에 놓기)
              </p>
            </div>
            <div className={CARD}>
              <p className="font-medium text-white light:text-slate-900">👻 앙파상</p>
              <p className="text-xs text-white/60 light:text-slate-600">상대 폰이 2칸 전진해 내 폰 바로 옆에 서면, <b>바로 다음 수에만</b> 그 폰이 1칸만 왔을 때처럼 대각선으로 잡을 수 있어요.</p>
            </div>
            <div className={CARD}>
              <p className="font-medium text-white light:text-slate-900">♛ 프로모션(승진)</p>
              <p className="text-xs text-white/60 light:text-slate-600">폰이 끝 랭크에 닿으면 반드시 퀸·룩·비숍·나이트 중 하나로 바뀝니다. 퀸이 있어도 또 만들 수 있어요.</p>
            </div>
          </div>
        </section>

        <section>
          <h3 className={H3}>체크와 끝 (§9~§11)</h3>
          <ul className="list-disc space-y-1 pl-5 text-xs text-white/70 light:text-slate-600">
            <li>
              <b>체크</b>는 반드시 풀어야 합니다 — 킹 피하기 / 공격한 기물 잡기 / 사이 막기. 앱은 합법 수만 받아요(내 킹을 위험에 두는 수 불가).
            </li>
            <li>
              <b>승리</b>: 체크메이트 · 상대 기권 · 상대 시간 패
            </li>
            <li>
              <b>무승부</b>: 스테일메이트(체크 아닌데 둘 수 없음) · 기물 부족(킹 대 킹, 킹+나이트/비숍 하나 대 킹 등) · <span className={EM}>같은 국면 3번</span> · <span className={EM}>50수 동안 폰 이동·잡기 없음</span> · 합의 — 앱에서는 3회 반복과 50수가 자동 무승부입니다.
            </li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>시계 · 제안 (§12, §13)</h3>
          <ul className="list-disc space-y-1 pl-5 text-xs text-white/70 light:text-slate-600">
            <li>방장이 ∞ 무제한 / 1+0 / 3+2 / 5+0 / 10+0 / 15+10 / 30+0 중 고릅니다. 「+초」는 수마다 더해지는 시간.</li>
            <li>양쪽 첫 수는 시간이 줄지 않아요. 내 시간이 0이 되면 패배 — 단 상대가 킹만(또는 킹+나이트/비숍 하나만) 있으면 무승부.</li>
            <li>🤝 무승부 제안(한 판 3번, 같은 국면 1번) · ↩️ 무르기 요청(한 판 3번, 내 마지막 수까지 되돌림, 시계는 그대로) · 🏳️ 기권.</li>
            <li>봇: 무승부는 자기가 불리하거나 비슷할 때만 수락, 무르기는 Lv.1~5만 받아 줘요.</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>조작 · 이펙트 (§16, §17)</h3>
          <p className="text-xs text-white/70 light:text-slate-600">
            기물을 <b>누르고 → 칸 누르기</b> 또는 <b>끌어서 놓기</b>. 점(•)은 갈 수 있는 칸, 고리는 잡을 수 있는 칸. 기보의 수를 누르면 그때 판을 되감아 볼 수 있어요. 수마다 미끄러짐·잔상, 나이트 점프, 잡기 파편, 캐슬링 금빛 궤적, 앙파상 소용돌이, 승진 빛기둥, 체크 공격선, 체크메이트 충격파와 꽃가루가 나옵니다.
          </p>
        </section>
      </div>
    </Overlay>
  );
}
