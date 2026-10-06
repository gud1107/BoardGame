"use client";

import { useEffect } from "react";
import Overlay from "@/components/Overlay";
import { ALL_MISSIONS_BONUS_RATE, allMissionsBonusRate, MISSION_STREAK_CAP, MISSION_STREAK_STEP, BRANCH_INFO, ENTITY_DEFS, MAPS, FRENZY_STEPS, mapCoinBonus, MISSIONS, NEVER, PREY_EFFECTS, preyEffectLabel, SHARKS, sharksOfTier, type EntityKind, type MapDef } from "./data";
import { mapExclusives } from "./markers";
import MapProfile from "./MapProfile";

/** Level layout + map-only rules, one line each (data-driven where the numbers live in MapDef). */
const MAP_FEATURES: Record<MapDef["id"], string[]> = {
  deepBlue: [
    "지형: 완만한 산호 언덕이 화산 해구까지 이어지는 탁 트인 바다. 수면 어디서나 점프할 수 있습니다.",
    "고유 위험: 수심 250m 아래 해구에서 화산 암석이 떨어집니다.",
  ],
  frozenStrait: [
    "지형: 수면 전체가 두꺼운 빙판 — 빙판 밑은 천장이라 숨구멍(5곳)에서만 점프할 수 있고, 공중에서 빙판에 떨어지면 튕긴 뒤 가까운 숨구멍으로 미끄러집니다. 배·선원·빙산도 숨구멍 안에만 있습니다.",
    "얕은 대륙붕(약 90m) 사이로 깊은 해구 두 개가 갈라집니다. 심해로 가려면 해구를 찾아야 합니다.",
    "장애물: 천장의 고드름, 해구 바닥에서 솟은 얼음 기둥 — 부딪히면 막힙니다.",
    "고유 위험: 빙판 밑을 지나면 머리 위 고드름 끝이 부러집니다(0.9초 흔들림 + 빨간 낙하선 → 낙하, 피해 26).",
  ],
  shipwreck: [
    "지형: 계단처럼 꺼지는 해저 단구를 따라 심연(약 340m)까지 내려갔다가 다시 올라옵니다.",
    "장애물: 단구마다 거대한 침몰선 선체와 부러진 돛대가 벽처럼 놓여 있습니다. 보물 상자는 선체 주변에 많습니다.",
    "고유 위험: 돛대 아래를 지나면 활대가 부러져 떨어집니다(1초 삐걱 + 빨간 낙하선 → 낙하, 피해 34).",
  ],
};

const H3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";
const P = "text-white/70 light:text-slate-600";

export default function RulebookModal({ onClose, focusMap }: { onClose: () => void; focusMap?: MapDef["id"] }) {
  useEffect(() => {
    if (!focusMap) return;
    // Wait a frame for the overlay to lay out, then bring that map's card to the middle.
    const t = window.setTimeout(() => document.getElementById(`rb-map-${focusMap}`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 60);
    return () => window.clearTimeout(t);
  }, [focusMap]);
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
            <li><b>PC</b>: 마우스 커서 방향으로 헤엄칩니다(WASD/방향키가 우선). <b>마우스 클릭 유지 / Shift</b>로 부스트, <b>Space(또는 E·Q)</b>로 상어 고유 스킬 발동. Esc·P로 일시정지.</li>
            <li><b>모바일</b>: 화면 아무 곳이나 누른 채 끌면 그 자리에 가상 조이스틱이 생깁니다. 오른쪽 🚀 버튼을 누르고 있으면 부스트, ⚡ 버튼으로 스킬.</li>
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
            <li>1.5초 안에 연속으로 먹으면 <b>콤보</b>가 쌓여 점수가 ×1.5(6콤보) · ×2(15콤보) · ×3(30콤보)이 됩니다.</li>
            <li>콤보는 <b>FRENZY 코인 배율</b>도 올립니다: {[...FRENZY_STEPS].reverse().map(([at, m]) => `${at}콤보 ×${m}`).join(" · ")} (최대 ×5).</li>
          </ol>
        </section>

        <section>
          <h3 className={H3}>먹이 인디케이터 · 먹이 도감</h3>
          <ul className={`list-disc space-y-1.5 pl-4 ${P}`}>
            <li>상어 머리 주변 시야 안의 생물 위에 조준 링이 뜹니다(최대 8개, 물고기 떼는 하나로 묶음).</li>
            <li><span className="font-bold text-emerald-400">🟢 녹색 링</span>: 지금 먹을 수 있음 — 회복량(+HP)과 점수 표시. 여러 번 물어야 하는 대상은 남은 물기 횟수도 표시.</li>
            <li><span className="font-bold text-red-400">🔴 ☠ 적색 링(깜빡임)</span>: 티어 부족 + 위험 — 필요한 상어(예: &quot;T3 귀상어 필요&quot;)와 위험 종류. 새 위협이 링 안에 들어오면 경고 비프음. 쫓아오는 포식자·어뢰·낙석은 뒤쪽에 있어도 표시.</li>
            <li><span className="font-bold text-red-300">🔴 ✖ 적색 링</span>: 티어 부족이지만 무해 — 부딪히면 튕겨 나갈 뿐입니다.</li>
            <li><span className="font-bold text-yellow-300">🟡 황금 링</span>: 골드 러시 중 먹을 수 있는 대상(코인 드롭 + 체력 완전 회복). 메가 골드 러시에선 분홍빛으로 모든 대상이 바뀝니다.</li>
            <li>🎯 버튼으로 인디케이터를 끄고 켤 수 있습니다. 📖 버튼·일시정지 메뉴·<b>B</b> 키로 <b>먹이 도감</b>을 열면 현재 티어 기준 사냥 가능/티어 부족/위험 생물을 필터링해 회복량·점수·코인·출몰 수심·<b>서식 지역(📍)</b>을 볼 수 있습니다.</li>
            <li>도감 맨 위 <b>💀 나를 가장 많이 죽인 생물</b>: 지금까지의 사망 원인을 모든 지역에 걸쳐 합산한 상위 5(지역별 횟수 포함). 굶주림은 생물이 아니라 따로 표시합니다. 각 생물 카드에 &quot;💀 나를 N번 죽임&quot;, 필터 <b>💀 나를 죽인</b>(많이 죽인 순).</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>진화 트리 (5계통 · 26종)</h3>
          <p className={`mb-2 ${P}`}>
            암초상어에서 출발해 2티어부터 <b>다섯 갈래 계통</b> 중 하나로 진화하고, 3티어에서 계통마다 <b>두 갈래</b>로 한 번 더 나뉩니다. 상위 상어를 해금하려면 바로 이전 단계를 먼저 보유해야
            하며, 다른 계통도 언제든 따로 키울 수 있습니다. 같은 티어의 상어는 같은 먹이를 먹고, 계통마다 능력치·패시브·고유 스킬이 다릅니다.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-white/50 light:text-slate-500">
                <tr>
                  <th className="py-1 pr-2">상어</th>
                  <th className="py-1 pr-2">계통</th>
                  <th className="py-1 pr-2">스킬 (Space)</th>
                  <th className="py-1">해금</th>
                </tr>
              </thead>
              <tbody className="text-white/75 light:text-slate-700">
                {SHARKS.map((s) => (
                  <tr key={s.id} className="border-t border-white/5 align-top light:border-slate-200">
                    <td className="py-1.5 pr-2 font-bold whitespace-nowrap">T{s.tier} {s.name}</td>
                    <td className="py-1.5 pr-2 whitespace-nowrap">{BRANCH_INFO[s.branch].emoji} {BRANCH_INFO[s.branch].short}</td>
                    <td className="py-1.5 pr-2">
                      <b>{s.skill.name}</b> ({s.skill.cooldown}초) — {s.skill.desc}
                      {s.passive && <div className="text-emerald-400 light:text-emerald-700">패시브 {s.passive.name}: {s.passive.desc}</div>}
                      <div className="text-amber-300/80 light:text-amber-700">골드 ×{s.goldMultiplier.toFixed(1)} · 자석 {s.magnetRadius} · 부스트 효율 ×{s.boostEfficiency.toFixed(1)}</div>
                    </td>
                    <td className="py-1.5 whitespace-nowrap">{s.cost ? `${s.cost.toLocaleString()}🪙` : "기본"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={`mt-2 text-xs ${P}`}>
            <b>먹이 자석</b>: 상어 입 주변 반경 안의 작은 먹이가 입으로 빨려 들어옵니다. <b>골드 배율</b>은 그 상어로 얻는 모든 코인에 곱해집니다.
          </p>
        </section>

        <section>
          <h3 className={H3}>잠수 중 진화</h3>
          <p className={P}>
            잠수 도중 <b>보유 코인 + 이번 잠수에서 번 코인</b>이 다음 진화 비용을 넘으면 화면 오른쪽에 <b>🧬 진화 가능!</b> 버튼이
            깜빡입니다(PC는 <b>V</b> 키). 누르면 게임이 멈추고 진화 분기를 고를 수 있으며, 비용은 보유 코인에서 먼저 빠지고 모자란 만큼
            이번 잠수 코인에서 빠집니다. 진화하면 그 자리에서 체력·부스트가 가득 찬 새 상어로 바뀌고 점수·미션·골드 게이지는 그대로 이어집니다.
            이미 보유한 상어로는 비용 없이 바꿀 수 있습니다.
          </p>
        </section>

        <section>
          <h3 className={H3}>잠수 지역 (맵)</h3>
          <p className={`mb-2 ${P}`}>세 지역은 색만 다른 게 아니라 <b>지형·장애물·몬스터·고유 위험</b>이 모두 다릅니다. 지역 전용 몬스터는 다른 지역에 나오지 않습니다. 단면도는 실제 지형을 같은 비율로 줄인 것입니다(갈색 = 침몰선, 흰색 = 빙판·고드름·얼음 기둥).</p>
          <div className="flex flex-col gap-2">
            {MAPS.map((m) => (
              <div
                key={m.id}
                id={`rb-map-${m.id}`}
                className={`scroll-mt-4 rounded-lg border p-2.5 ${m.id === focusMap ? "border-cyan-300 ring-2 ring-cyan-300/40" : "border-white/10 light:border-slate-200"}`}
              >
                <div className="font-bold text-white light:text-slate-900">
                  {m.emoji} {m.name}{" "}
                  <span className="text-xs font-normal text-white/50 light:text-slate-500">
                    권장 T{m.recommendedTier}+ · 가로 {(m.width / 10).toLocaleString()}m · 보물 상자 {m.chestCount}개 · 코인 ×{m.coinBonus}
                    {m.tierCoinBonus?.[4] ? ` (T4 ×${mapCoinBonus(m, 4).toFixed(2)})` : ""}
                  </span>
                </div>
                <MapProfile map={m} />
                <ul className={`mt-1 list-disc space-y-0.5 pl-4 text-xs ${P}`}>
                  {MAP_FEATURES[m.id].map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                  <li>전용 몬스터: {mapExclusives(m).map((k) => ENTITY_DEFS[k].name).join(" · ")}</li>
                  {m.safeStart && (
                    <li>
                      🛡 <b>시작 안전 구역</b>: 잠수 시작 후 {m.safeStart.seconds}초 동안 시작 지점 주변(반경 {m.safeStart.radius})에 포식자가 들어오지 않습니다(기뢰·해파리는 그대로).
                    </li>
                  )}
                  {m.lowTierMercy && (
                    <li>
                      <b>저티어 배려</b>: 내 상어보다 2티어 이상 높은 포식자는 덜 나오고(×{m.lowTierMercy.spawn}) 덜 쫓아오며(추격 거리 ×{m.lowTierMercy.aggro})
                      {m.lowTierMercy.near ? `, 1티어 높은 포식자도 조금 덜 나옵니다(×${m.lowTierMercy.near.spawn})` : ""}.
                    </li>
                  )}
                </ul>
              </div>
            ))}
          </div>
          <p className={`mt-1 text-xs ${P}`}>상점 아래 &quot;잠수 지역 선택&quot;에서 고릅니다. 권장 티어는 참고용이며 모든 지역이 처음부터 열려 있습니다. 얼음 해협은 먹이가 얕은 대륙붕에 몰려 있어 대형(T4) 상어의 코인 배율이 낮습니다.</p>
        </section>

        <section>
          <h3 className={H3}>티어별 먹이</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-white/50 light:text-slate-500">
                <tr>
                  <th className="py-1 pr-2">티어</th>
                  <th className="py-1 pr-2">상어</th>
                  <th className="py-1">새로 먹을 수 있는 것</th>
                </tr>
              </thead>
              <tbody className="text-white/75 light:text-slate-700">
                {[1, 2, 3, 4].map((t) => (
                  <tr key={t} className="border-t border-white/5 light:border-slate-200">
                    <td className="py-1.5 pr-2 font-bold">T{t}</td>
                    <td className="py-1.5 pr-2">{sharksOfTier(t).map((s) => s.name).join(" / ")}</td>
                    <td className="py-1.5">{byTier(t)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={`mt-2 text-xs ${P}`}>상위 티어는 하위 티어의 먹이도 전부 먹을 수 있습니다. <b>{neverEdible}</b>은 메가 골드 러시 중에만 먹을 수 있습니다(샌드타이거의 크러시 바이트 중엔 화산 암석을 뺀 나머지도 가능).</p>
        </section>

        <section>
          <h3 className={H3}>특수 먹이 효과</h3>
          <ul className={`list-disc space-y-1 pl-4 ${P}`}>
            {(Object.keys(PREY_EFFECTS) as EntityKind[]).map((k) => (
              <li key={k}>
                <b>{ENTITY_DEFS[k].name}</b>: {preyEffectLabel(PREY_EFFECTS[k]!)}
              </li>
            ))}
          </ul>
          <p className={`mt-1 text-xs ${P}`}><b>황금 참치</b>는 아주 드물게 나타나며 코인 150~300과 함께 즉시 골드 러시를 터뜨립니다. 귀상어의 소나 펄스로 위치를 찾을 수 있습니다.</p>
        </section>

        <section>
          <h3 className={H3}>골드 러시 · 메가 골드 러시</h3>
          <ul className={`list-disc space-y-1.5 pl-4 ${P}`}>
            <li>먹을 때마다 (획득 점수 × 0.02)만큼 화면 위쪽 황금 게이지가 찹니다. 가득 차면 <b>골드 러시</b> 발동!</li>
            <li>8초 동안 <b>무적</b>, 굶주림 정지, <b>부스트 무제한</b>, 먹을 수 있는 모든 먹이가 황금색으로 빛나며 먹을 때마다 <b>체력 완전 회복 + 코인 100% 드롭(×2)</b>.</li>
            <li>점수 배율은 발동 횟수에 따라 ×2 → ×3 → … → 최대 ×8.</li>
            <li><b>8번째 발동마다 메가 골드 러시</b>(10초, ×10): 기뢰·해파리·어뢰·나보다 큰 상어까지 화면의 <b>모든 것</b>을 한입에 먹을 수 있습니다.</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>위험 요소</h3>
          <ul className={`list-disc space-y-1.5 pl-4 ${P}`}>
            <li><b>기뢰</b>: 가까이 가면 폭발. 피해 = 최대 피해 × (1 − 거리 ÷ 폭발 반경). 폭발은 주변 작은 물고기를 죽이고 근처 기뢰를 연쇄 폭발시킵니다. 수심이 깊을수록 더 큰 기뢰가 있습니다.</li>
            <li><b>해파리</b>: 닿으면 3초간(붉은 해파리 3.5초) 0.5초마다 최대 체력의 5%(붉은 6%) 피해 + 이동 속도 40% 감소.</li>
            <li><b>잠수함</b>은 티어 3 이하 상어에게 유도 어뢰를 발사합니다. <b>소형 상어·심해 아귀·유령 상어·꼬치고기·곰치·대왕오징어·일각고래·범고래</b>는 나보다 강하면 쫓아와 물어뜯습니다(약 5초 쫓다 지쳐서 물러남)(화면 가장자리 빨간 화살표로 경고).</li>
            <li><b>딥 블루 오션</b> 수심 250m 아래 해구(화산 지대)에서는 화산 암석이 떨어집니다. 깊을수록 어두워지고 시야가 좁아집니다.</li>
            <li><b>떨어지는 고드름</b>(얼음 해협)·<b>무너지는 돛대 파편</b>(난파선 무덤): 머리 위에서 흔들리며 빨간 점선으로 떨어질 자리를 보여준 뒤 떨어집니다. 점선 아래에서 옆으로 비키세요. 메가 골드 러시 중엔 먹을 수 있습니다.</li>
            <li><b>지형 장애물</b>(빙판 천장·고드름·얼음 기둥·침몰선 선체·돛대)은 통과할 수 없고, 세게 부딪히면 튕겨 나옵니다.</li>
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
            <li>잠수마다 <b>무작위 미션 3개</b>가 주어지고, 달성 즉시 보상 코인을 받습니다(기본 {Math.min(...MISSIONS.map((m) => m.reward))}~{Math.max(...MISSIONS.map((m) => m.reward))}🪙, 티어가 높을수록 목표와 보상이 커짐).</li>
            <li>
              한 잠수에서 <b>미션 3개를 모두 완료</b>하면 그 세 보상 합계의 {Math.round(ALL_MISSIONS_BONUS_RATE * 100)}%를 <b>올클리어 보너스</b>로 추가로 받습니다.
              여러 잠수 <b>🔥 연속으로</b> 올클리어하면 1회마다 +{Math.round(MISSION_STREAK_STEP * 100)}%p씩 커집니다(최대 {Math.round(allMissionsBonusRate(MISSION_STREAK_CAP) * 100)}%). 올클리어하지 못한 잠수가 끝나면 연속 기록은 0으로 돌아갑니다.
            </li>
            <li>해저 곳곳에 <b>보물 상자</b>(지역마다 9~20개)가 숨어 있습니다(미니맵의 노란 점). 입으로 물면 코인이 쏟아집니다.</li>
            <li>상점에서 상어마다 <b>물어뜯기 · 속도 · 부스트</b>를 각각 10레벨까지 강화할 수 있습니다. 진행 상황은 이 브라우저에 저장됩니다.</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>상점 · 상어 목록 정렬/필터</h3>
          <ul className={`list-disc space-y-1.5 pl-4 ${P}`}>
            <li><b>정렬</b>: 진화 트리(기본) / 가격 / 티어 / 체력 / 속도 / 골드 배율 / 부스트 효율 / 최고 점수 — [높은 순 | 낮은 순]. 진화 트리 외 기준을 고르면 카드가 한 줄 목록으로 바뀌고 기준 수치가 표시됩니다(체력·속도는 업그레이드 반영).</li>
            <li><b>필터</b>: &quot;지금 살 수 있는 상어만&quot;(이전 단계 보유 + 코인 충분), &quot;보유 상어 숨기기&quot;. 해당 상어가 없으면 다음 상어까지 남은 코인을 알려 줍니다.</li>
            <li>정렬·필터 선택은 저장되어 다음 방문에도 유지됩니다.</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>결과 화면 · 기록</h3>
          <ul className={`list-disc space-y-1.5 pl-4 ${P}`}>
            <li><b>이번 잠수 사망 원인</b>: 무엇에 당했는지, 이 지역에서 몇 번째인지, 원인별 대처 팁, 이 지역에서 자주 당한 원인 상위 3. 피해를 입고 5초 안에 굶주려 죽으면 굶주림이 아니라 그 피해 원인으로 기록됩니다.</li>
            <li><b>맵별 최고 기록</b>: 세 지역의 최고 점수·상어·생존 시간. 지역 줄을 누르면 그 지역의 <b>상어별 최고 기록</b>이 펼쳐집니다(👑 1위).</li>
            <li><b>축하 연출</b>: 지역 신기록(색종이 + 금화 + 긴 팡파르), 상어 개인 최고 기록, 미션 올클리어(초록 색종이 + 차임)마다 연출이 나옵니다. 음소거·움직임 줄이기 설정을 따릅니다.</li>
          </ul>
        </section>
      </div>
    </Overlay>
  );
}
