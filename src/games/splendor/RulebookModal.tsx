"use client";

import Overlay from "@/components/Overlay";
import { GemChip } from "./GemToken";

export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="📖 스플렌더 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80">
        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">목표</h3>
          <p className="text-white/70">
            보석 상인이 되어 토큰으로 개발 카드를 사들이고, 카드가 주는 영구 할인을 쌓아 귀족의 방문까지 받으세요.{" "}
            <span className="text-violet-300">누군가 자기 차례 종료 시 위신 점수 15점 이상을 달성하면</span> 그 라운드의
            마지막 플레이어까지 진행한 뒤 게임이 끝나며, 최종 점수가 가장 높은 사람이 승리합니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">보석 5종 + 황금 토큰</h3>
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1">
              <GemChip color="white" className="h-6 w-6" /> 다이아몬드
            </span>
            <span className="flex items-center gap-1">
              <GemChip color="blue" className="h-6 w-6" /> 사파이어
            </span>
            <span className="flex items-center gap-1">
              <GemChip color="green" className="h-6 w-6" /> 에메랄드
            </span>
            <span className="flex items-center gap-1">
              <GemChip color="red" className="h-6 w-6" /> 루비
            </span>
            <span className="flex items-center gap-1">
              <GemChip color="black" className="h-6 w-6" /> 오닉스
            </span>
            <span className="flex items-center gap-1">
              <GemChip color="gold" className="h-6 w-6" /> 황금 (조커)
            </span>
          </div>
          <p className="mt-1 text-xs text-white/50">
            황금 토큰은 카드를 살 때 어떤 색으로도 대체할 수 있습니다. 인원수와 상관없이 항상 5개 준비됩니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">내 차례에 할 수 있는 4가지 행동 — 정확히 1가지만</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-white/15 bg-white/[0.03] p-3">
              <p className="mb-1 font-medium text-white/90">💎 서로 다른 보석 3개 가져오기</p>
              <p className="text-xs text-white/60">서로 다른 색상의 보석 토큰을 1개씩, 총 3개 가져옵니다. 황금 토큰은 이 방식으로 가져올 수 없습니다.</p>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/[0.03] p-3">
              <p className="mb-1 font-medium text-white/90">💎💎 같은 보석 2개 가져오기</p>
              <p className="text-xs text-white/60">공급처에 해당 색상이 4개 이상 남아있을 때만 가능합니다.</p>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/[0.03] p-3">
              <p className="mb-1 font-medium text-white/90">🗂️ 카드 예약 + 황금 획득</p>
              <p className="text-xs text-white/60">
                공개된 카드 1장 또는 덱 맨 위 카드 1장을 비공개로 예약하고, 황금 토큰이 남아있다면 1개 함께 받습니다.
                최대 3장까지 예약할 수 있습니다.
              </p>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/[0.03] p-3">
              <p className="mb-1 font-medium text-white/90">🛍️ 카드 구매</p>
              <p className="text-xs text-white/60">
                공개된 카드 또는 내가 예약한 카드 1장을 구매합니다. 이미 산 카드의 보석 보너스만큼 비용이 자동으로
                할인되고, 부족한 만큼만 토큰(황금 포함)으로 지불합니다.
              </p>
            </div>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">엔진 빌딩 & 귀족</h3>
          <p className="text-white/70">
            구매한 카드는 해당 색상 보석 1개와 같은 영구 할인을 제공합니다. 자기 차례가 끝날 때 내가 보유한 카드의
            보석 보너스 구성이 귀족 타일의 조건을 만족하면 귀족이 자동으로 방문해 <b>3점</b>을 줍니다(토큰 소모 없음,
            보유 토큰은 조건에 포함되지 않음). 한 차례에는 귀족 1명만 방문하며, 여러 명이 동시에 조건을 만족하면
            어느 귀족을 받을지 선택합니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">토큰 보유 제한</h3>
          <p className="text-white/70">
            차례가 끝나는 시점에 보유 토큰(황금 포함)이 <span className="text-rose-300">10개를 초과</span>하면 원하는
            토큰을 골라 10개가 될 때까지 반드시 반납해야 합니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">게임 종료 및 동점자 처리</h3>
          <p className="text-white/70">
            누군가 15점을 달성한 라운드의 마지막 플레이어까지 차례를 마치면 게임이 끝납니다. 점수가 가장 높은
            플레이어가 승리하며, 동점이면 구매한 개발 카드 수가 더 적은 쪽이 승리합니다. 그마저 같다면 공동 승리로
            처리됩니다.
          </p>
        </section>
      </div>
    </Overlay>
  );
}
