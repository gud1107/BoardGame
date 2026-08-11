"use client";

import Overlay from "@/components/Overlay";
import { TileFace, WormRow } from "./TileFace";
import { DieFace } from "./DieFace";

const TIER_ROWS: { range: string; worms: number }[] = [
  { range: "21 ~ 24", worms: 1 },
  { range: "25 ~ 28", worms: 2 },
  { range: "29 ~ 32", worms: 3 },
  { range: "33 ~ 36", worms: 4 },
];

export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="📖 지렁이 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80">
        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">목표</h3>
          <p className="text-white/70">
            중앙에 놓인 21~36번 타일을 주사위로 따내는 푸시유어럭 게임입니다. 중앙 타일이 모두 소진되면 게임이
            끝나고, 자기 타일 스택에 그려진 <span className="text-lime-300">🪱 지렁이 개수의 총합</span>이 가장
            높은 사람이 승리합니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">구성품</h3>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-col items-center gap-1">
              <div className="flex gap-1">
                <TileFace tileNumber={21} worms={1} size="h-14 w-12" />
                <TileFace tileNumber={25} worms={2} size="h-14 w-12" />
                <TileFace tileNumber={30} worms={3} size="h-14 w-12" />
                <TileFace tileNumber={36} worms={4} size="h-14 w-12" />
              </div>
              <span className="text-[11px] text-white/50">타일 21~36 (16장)</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <div className="flex gap-1">
                <DieFace face={3} size="h-10 w-10" />
                <DieFace face="worm" size="h-10 w-10" />
              </div>
              <span className="text-[11px] text-white/50">특수 주사위 8개 (1~5 + 🪱)</span>
            </div>
          </div>
          <div className="mt-2 overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full min-w-[260px] border-collapse text-xs">
              <thead>
                <tr className="bg-white/5 text-white/50">
                  <th className="px-2 py-1.5 text-left">타일 번호</th>
                  <th className="px-2 py-1.5 text-left">지렁이 개수</th>
                </tr>
              </thead>
              <tbody>
                {TIER_ROWS.map((row) => (
                  <tr key={row.range} className="border-t border-white/10">
                    <td className="px-2 py-1.5 font-semibold text-white/80">{row.range}</td>
                    <td className="px-2 py-1.5">
                      <WormRow count={row.worms} size="h-3.5 w-3.5" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">턴 진행 — 굴리기 & 킵</h3>
          <ol className="list-decimal space-y-1.5 pl-4 text-white/70">
            <li>차례가 되면 주사위 8개를 모두 굴립니다.</li>
            <li>
              나온 눈금 중 <b>숫자 하나(또는 🪱)</b>를 골라 그 눈금이 나온 주사위를 전부 킵합니다. 한 번 킵한
              숫자는 이번 턴에는 다시 고를 수 없습니다.
            </li>
            <li>남은 주사위가 있다면 계속 굴리거나, 지금까지 킵한 것만으로 스톱을 선언할 수 있습니다.</li>
            <li>
              굴린 눈금이 전부 이미 킵한 숫자뿐이라 더 고를 게 없거나, 주사위를 다 썼는데 🪱를 한 번도 못
              킵했다면 <b>즉시 실패(Bust)</b> 처리됩니다.
            </li>
          </ol>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">타일 가져오기 & 뺏기</h3>
          <p className="text-white/70">
            스톱을 선언하려면 킵한 주사위 중 <b>🪱가 최소 1개</b> 있어야 합니다. 킵한 주사위 눈금의 총합(🪱는
            5로 계산)으로 다음 순서로 타일을 가져옵니다:
          </p>
          <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-xs text-white/60">
            <li>총합과 정확히 같은 번호의 타일이 중앙에 있으면 그걸 가져옵니다.</li>
            <li>없다면, 총합과 정확히 같은 번호가 상대방 스택 맨 위에 있으면 그 타일을 뺏어옵니다.</li>
            <li>그것도 아니라면, 중앙에서 총합보다 작은 타일 중 가장 높은 번호의 타일을 가져옵니다.</li>
            <li>그마저도 없다면(총합보다 낮은 타일이 중앙에 하나도 없음) 실패 처리됩니다.</li>
          </ol>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">실패(Bust) 처리</h3>
          <p className="text-white/70">
            실패하면 <b>내 스택 맨 위 타일을 중앙에 반납</b>하고(스택이 비어 있다면 반납 없이 다음 단계로),
            그 직후 <b>중앙에 남은 타일 중 가장 높은 번호를 뒤집어(비공개) 게임에서 완전히 제거</b>한 뒤 차례를
            넘깁니다. 두 단계가 항상 순서대로 일어나므로, 방금 반납한 타일이 곧바로 최고 숫자가 되면 그 타일이
            그대로 다시 제거될 수도 있습니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">종료 & 승리</h3>
          <p className="text-white/70">
            중앙 타일이 모두 사라지면(가져갔거나 뒤집혀 제거됨) 게임이 끝납니다. 각자 스택에 있는 타일들의 🪱
            개수를 모두 더해 가장 많은 사람이 승리합니다(동점이면 공동 우승).
          </p>
        </section>

        <section className="rounded-xl border border-amber-300/20 bg-amber-400/5 p-3">
          <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-amber-200/90 uppercase">참고 — 하우스 룰 안내</h3>
          <p className="text-xs text-white/60">
            이 구현은 작업 요청에 직접 명시된 규칙을 그대로 따릅니다. 특히 위 &ldquo;실패 처리&rdquo;의 두 단계(내 타일
            반납 + 중앙 최고 타일 제거)는 <b>항상 둘 다 일어나는 것</b>으로 구현했습니다 — 원작 Heckmeck/Pickomino의
            &ldquo;내 타일이 있으면 그것만, 없을 때만 중앙 최고 타일&rdquo; 조건부 규칙과는 다른 하우스 룰입니다.
          </p>
        </section>
      </div>
    </Overlay>
  );
}
