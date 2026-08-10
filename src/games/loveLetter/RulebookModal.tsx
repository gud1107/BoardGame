"use client";

import Overlay from "@/components/Overlay";
import { CARD_IMAGES } from "./CardArt";

export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="📖 러브레터(Love Letter) 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80">
        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">목표 (단판 승부)</h3>
          <p className="text-white/70">
            공주에게 편지를 전하기 위해 궁정의 인물들을 활용하는 눈치싸움 카드 게임입니다.{" "}
            <span className="text-rose-300">단 한 번의 라운드</span>에서 공주에게 편지를 전달하거나 끝까지 살아남은 1인이 즉시 최종
            승리자가 됩니다 — 여러 라운드에 걸친 호감도 토큰 누적은 없습니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">카드 구성 (총 16장)</h3>
          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full min-w-[520px] border-collapse text-xs">
              <thead>
                <tr className="bg-white/5 text-white/50">
                  <th className="px-2 py-1.5 text-left">카드</th>
                  <th className="px-2 py-1.5 text-left">이름</th>
                  <th className="px-2 py-1.5 text-left">효과</th>
                  <th className="px-2 py-1.5 text-right">장수</th>
                </tr>
              </thead>
              <tbody>
                {[
                  [1, "경비병", "다른 플레이어 1명을 지정 + 카드 번호(2~8) 추측. 맞히면 즉시 탈락.", 5],
                  [2, "사제", "다른 플레이어 1명의 손패를 나만 확인.", 2],
                  [3, "남작", "다른 플레이어 1명과 손패 숫자 비교 — 낮은 쪽이 탈락 (동률이면 무효).", 2],
                  [4, "하녀", "다음 내 차례까지 다른 카드 효과의 대상이 되지 않음.", 2],
                  [5, "왕자", "나를 포함한 1명을 지정 — 손패를 버리고 새 카드를 뽑음.", 2],
                  [6, "왕", "다른 플레이어 1명과 손패를 서로 교환.", 1],
                  [7, "백작부인", "손에 왕자(5)나 왕(6)이 있으면 반드시 이 카드를 내야 함.", 1],
                  [8, "공주", "어떤 이유로든 이 카드가 버려지면 즉시 탈락.", 1],
                ].map(([n, name, effect, count]) => (
                  <tr key={n as number} className="border-t border-white/10">
                    <td className="px-2 py-1.5">
                      {/* eslint-disable-next-line @next/next/no-img-element -- tiny fixed thumbnail inside a rules table, next/image's layout overhead isn't worth it here */}
                      <img src={CARD_IMAGES[n as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8]} alt="" className="h-12 w-9 rounded object-cover" />
                    </td>
                    <td className="px-2 py-1.5 font-semibold whitespace-nowrap text-white/80">
                      {n}. {name}
                    </td>
                    <td className="px-2 py-1.5">{effect}</td>
                    <td className="px-2 py-1.5 text-right">{count}장</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">세팅</h3>
          <ul className="list-disc space-y-1 pl-4 text-xs text-white/70">
            <li>덱을 섞어 맨 위 1장을 아무도 보지 못하게 비공개로 제거합니다.</li>
            <li>
              <b>2인 플레이 전용:</b> 추가로 3장을 앞면이 보이게 공개하여 제외합니다.
            </li>
            <li>각 플레이어에게 카드 1장씩 나누어 줍니다.</li>
          </ul>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">내 턴에 하는 행동 (2단계)</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-white/15 bg-white/[0.03] p-3">
              <p className="mb-1 font-medium text-white/90">① 카드 뽑기</p>
              <p className="text-xs text-white/60">덱 맨 위에서 1장을 가져와 손에 2장을 듭니다.</p>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/[0.03] p-3">
              <p className="mb-1 font-medium text-white/90">② 카드 내기</p>
              <p className="text-xs text-white/60">2장 중 1장을 앞면으로 내려놓고 효과를 즉시 적용합니다.</p>
            </div>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">지목 불가능 상황</h3>
          <p className="text-xs text-white/70">
            자신을 제외한 모든 플레이어가 하녀(4번) 효과로 보호받고 있다면, 지목 효과(1·2·3·5·6번)는 대상을 지정하지 못하고 그냥
            소멸합니다. 단, 왕자(5번)는 이 경우 반드시 자기 자신을 지정해야 합니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">라운드(=게임) 종료</h3>
          <ul className="list-disc space-y-1 pl-4 text-xs text-white/70">
            <li>
              <b>최후의 1인 생존:</b> 다른 모두가 탈락하면 즉시 최종 승리.
            </li>
            <li>
              <b>덱 소진:</b> 마지막 카드를 가져간 사람이 턴을 마쳤는데도 2명 이상 살아있다면, 손패를 공개해 숫자가 가장 높은
              사람이 승리. 동률이면 각자의 버린 카드 숫자 합이 더 높은 사람이 승리(그마저 같으면 공동 승리).
            </li>
          </ul>
        </section>
      </div>
    </Overlay>
  );
}
