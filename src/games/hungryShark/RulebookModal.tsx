"use client";

import Overlay from "@/components/Overlay";
import { ENTITY_DEFS, NEVER, SHARKS, type EntityKind } from "./data";

const H3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";
const P = "text-white/70 light:text-slate-600";

export default function RulebookModal({ onClose }: { onClose: () => void }) {
  const byTier = (tier: number) =>
    (Object.values(ENTITY_DEFS) as (typeof ENTITY_DEFS)[EntityKind][])
      .filter((d) => d.requiredTier === tier && d.kind !== "chest")
      .map((d) => d.name)
      .join(", ");
  const neverEdible = (Object.values(ENTITY_DEFS) as (typeof ENTITY_DEFS)[EntityKind][])
    .filter((d) => d.requiredTier === NEVER)
    .map((d) => d.name)
    .join(", ");

  return (
    <Overlay title="📖 배고픈 상어 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80 light:text-slate-700">
        <section>
          <h3 className={H3}>목표</h3>
          <p className={P}>
            1인용 실시간 해양 액션 서바이벌입니다. 상어는 가만히 있어도 체력이 계속 줄어들고, <b>오래 살아남을수록
            더 빨리</b> 굶주립니다. 쉬지 않고 사냥해 체력을 회복하며 최대한 높은 점수를 올리고, 모은 코인으로 상어를
            업그레이드하거나 더 큰 상어를 해금하세요. 체력이 0이 되면 잠수가 끝납니다.
          </p>
        </section>

        <section>
          <h3 className={H3}>조작법</h3>
          <ul className={`list-disc space-y-1.5 pl-4 ${P}`}>
            <li><b>PC</b>: 마우스 커서 방향으로 헤엄칩니다(WASD/방향키가 우선). <b>마우스 클릭 유지 / 스페이스 / Shift</b>로 부스트. Esc·P로 일시정지.</li>
            <li><b>모바일</b>: 화면 아무 곳이나 누른 채 끌면 그 자리에 가상 조이스틱이 생깁니다. 오른쪽 🚀 버튼을 누르고 있으면 부스트.</li>
            <li>부스트 게이지는 쓰지 않을 때 서서히 다시 찹니다. 수면 위로 부스트를 쓰며 뛰어오르면 더 높이 점프합니다.</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>굶주림 공식</h3>
          <p className={P}>
            초당 체력 감소량 = <b>기본 감소량 × (1 + 생존시간 ÷ 180)<sup>1.3</sup></b>. 3분을 버티면 처음보다 약 2.5배
            빨리 굶주립니다. 먹이를 먹으면 <b>먹이 회복량 × (1 + 물어뜯기 레벨 × 0.05)</b>만큼 회복합니다.
          </p>
        </section>

        <section>
          <h3 className={H3}>포식 판정</h3>
          <ol className={`list-decimal space-y-1.5 pl-4 ${P}`}>
            <li><b>입 앞쪽</b>에 닿아야 먹습니다 — 상어가 향한 방향 기준 전방 약 75° 안쪽만 유효. 옆구리나 꼬리로 스치면 그냥 지나갑니다.</li>
            <li><b>티어 검사</b>: 내 상어 티어 ≥ 먹이의 필요 티어일 때만 먹을 수 있습니다. 모자라면 튕겨나가거나(무해한 대상), 피해를 입습니다(위험한 대상).</li>
            <li>보트·잠수함·헬리콥터·큰 상어처럼 <b>체력 바가 있는 대상</b>은 여러 번 물어뜯어야 쓰러집니다(물기 피해 = 물어뜯기 업그레이드).</li>
            <li>빠르게 연속으로 먹으면 <b>콤보</b>가 쌓여 점수가 ×1.5(6콤보) · ×2(15콤보) · ×3(30콤보)이 됩니다.</li>
          </ol>
        </section>

        <section>
          <h3 className={H3}>상어 티어별 먹이</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-white/50 light:text-slate-500">
                <tr>
                  <th className="py-1 pr-2">티어</th>
                  <th className="py-1 pr-2">상어</th>
                  <th className="py-1 pr-2">새로 먹을 수 있는 것</th>
                  <th className="py-1">해금 비용</th>
                </tr>
              </thead>
              <tbody className="text-white/75 light:text-slate-700">
                {SHARKS.map((s) => (
                  <tr key={s.id} className="border-t border-white/5 light:border-slate-200">
                    <td className="py-1.5 pr-2 font-bold">T{s.tier}</td>
                    <td className="py-1.5 pr-2">{s.name}</td>
                    <td className="py-1.5 pr-2">{byTier(s.tier)}</td>
                    <td className="py-1.5">{s.cost ? `${s.cost.toLocaleString()}🪙` : "기본"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={`mt-2 text-xs ${P}`}>상위 티어는 하위 티어의 먹이도 전부 먹을 수 있습니다. <b>{neverEdible}</b>은 메가 골드 러시 중에만 먹을 수 있습니다.</p>
        </section>

        <section>
          <h3 className={H3}>골드 러시 · 메가 골드 러시</h3>
          <ul className={`list-disc space-y-1.5 pl-4 ${P}`}>
            <li>먹을 때마다 (획득 점수 × 0.02)만큼 화면 위쪽 황금 게이지가 찹니다. 가득 차면 <b>골드 러시</b> 발동!</li>
            <li>8초 동안 <b>무적</b>, 굶주림 정지, <b>부스트 무제한</b>, 먹을 수 있는 모든 먹이가 황금색으로 빛나며 먹을 때마다 <b>체력 완전 회복 + 코인 100% 드롭</b>.</li>
            <li>점수 배율은 발동 횟수에 따라 ×2 → ×3 → … → 최대 ×8.</li>
            <li><b>8번째 발동마다 메가 골드 러시</b>(10초, ×10): 기뢰·해파리·어뢰·나보다 큰 상어까지 화면의 <b>모든 것</b>을 한입에 먹을 수 있습니다.</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>위험 요소</h3>
          <ul className={`list-disc space-y-1.5 pl-4 ${P}`}>
            <li><b>기뢰</b>: 가까이 가면 폭발. 피해 = 최대 피해 × (1 − 거리 ÷ 폭발 반경). 폭발은 주변 작은 물고기를 죽이고 근처 기뢰를 연쇄 폭발시킵니다. 수심이 깊을수록 더 큰 기뢰가 있습니다.</li>
            <li><b>해파리</b>: 닿으면 3초간(붉은 해파리 4초) 0.5초마다 최대 체력의 5%(붉은 8%) 피해 + 이동 속도 40% 감소.</li>
            <li><b>잠수함</b>은 티어 5 이하 상어에게 유도 어뢰를 발사합니다. <b>소형 상어·심해 아귀·유령 상어</b>는 나보다 강하면 쫓아와 물어뜯습니다(화면 가장자리 빨간 화살표로 경고).</li>
            <li>수심 250m 아래 <b>해구(화산 지대)</b>에서는 화산 암석이 떨어집니다. 깊을수록 어두워지고 시야가 좁아집니다.</li>
            <li>체력이 25% 아래로 떨어지면 화면이 붉게 맥동하며 심장 박동 경고음이 울립니다.</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>수면 · 점프</h3>
          <p className={P}>
            수면 위로 올라가면 중력이 적용되어 포물선으로 날아오르고, 공중에서는 방향을 거의 바꿀 수 없습니다. 펠리컨과
            헬리콥터는 점프해서 잡아야 합니다. 다시 입수할 때 수직으로 꽂힐수록 속도 손실이 적고, 배로 떨어지면 물보라와
            함께 크게 감속합니다.
          </p>
        </section>

        <section>
          <h3 className={H3}>코인 · 미션 · 보물 상자</h3>
          <ul className={`list-disc space-y-1.5 pl-4 ${P}`}>
            <li>먹이를 먹으면 확률적으로 코인이 나옵니다(골드 러시 중엔 100%). 코인은 잠수가 끝나도 유지됩니다.</li>
            <li>잠수마다 <b>무작위 미션 3개</b>가 주어지고, 달성 즉시 보너스 코인을 받습니다.</li>
            <li>해저 곳곳에 <b>보물 상자 7개</b>가 숨어 있습니다(미니맵의 노란 점). 입으로 물면 코인이 쏟아집니다.</li>
            <li>상점에서 상어마다 <b>물어뜯기 · 속도 · 부스트</b>를 각각 10레벨까지 강화할 수 있습니다. 진행 상황은 이 브라우저에 저장됩니다.</li>
          </ul>
        </section>
      </div>
    </Overlay>
  );
}
