"use client";

import Overlay from "@/components/Overlay";
import { COLOR_INFO, FRODO_START, LANDMARKS, RACES, RACE_INFO, TECHS, TECH_INFO, TOKENS, TOKEN_IDS_BY_RACE, TRACK_LENGTH } from "./data";

const box = "rounded-xl border border-white/10 bg-white/5 p-3 light:border-slate-200 light:bg-white light:shadow-sm";
const h3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";
const li = "text-xs text-white/75 light:text-slate-700";

export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="💍 반지의 제왕: 가운데땅에서의 대결 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-3">
        <div className={box}>
          <p className={h3}>개요</p>
          <p className={li}>
            반지 원정대 vs 사우론 2인 대결. 3개 챕터 동안 20장짜리 카드 피라미드에서 번갈아 카드를 가져가며 세력을 키웁니다. 사우론이 먼저 둡니다. 시작 자금은 원정대 3주화, 사우론 2주화이고 아르노르에 원정대
            유닛 2개, 모르도르에 사우론 유닛 2개가 놓입니다.
          </p>
        </div>

        <div className={box}>
          <p className={h3}>내 차례 — 둘 중 하나</p>
          <ul className="flex list-disc flex-col gap-1 pl-4">
            <li className={li}>
              <b>카드 가져오기</b>: 다른 카드에 덮이지 않은 카드를 1장 가져와 <b>비용을 내고 내려놓아</b> 효과를 쓰거나, <b>버리고 챕터 수만큼 주화</b>(1/2/3)를 받습니다. 덮고 있던 카드가
              모두 치워지면 아래 뒷면 카드가 앞면으로 뒤집힙니다.
            </li>
            <li className={li}>
              <b>랜드마크 건설</b>: 공개된 3장 중 1장을 골라 인쇄된 비용 + <b>내 요새 1개당 1주화</b>를 내고, 해당 지역에 요새를 놓고 보너스를 받습니다. 챕터 중에는 새로 채우지 않습니다.
            </li>
          </ul>
        </div>

        <div className={box}>
          <p className={h3}>비용과 연계</p>
          <ul className="flex list-disc flex-col gap-1 pl-4">
            <li className={li}>
              회색 카드는 기술 기호({TECHS.map((s) => `${TECH_INFO[s].emoji}${TECH_INFO[s].name}`).join(" · ")})를 매 턴 영구 생산합니다. 없는 기호는 <b>1개당 1주화</b>로 대신 냅니다.
            </li>
            <li className={li}>
              카드 위의 🔗 연계 기호가 내가 이미 내려놓은 카드의 연계 기호와 같으면 <b>완전 무료</b>입니다.
            </li>
            <li className={li}>
              카드 색상: {Object.entries(COLOR_INFO).map(([, v]) => `${v.emoji}${v.name}`).join(" · ")} (보라 전술은 3챕터 전용)
            </li>
          </ul>
        </div>

        <div className={box}>
          <p className={h3}>지도와 전투</p>
          <ul className="flex list-disc flex-col gap-1 pl-4">
            <li className={li}>빨간 카드는 표시된 두 지역 중 한 곳에 유닛을 놓습니다. 이동 효과는 유닛 1개를 인접 지역으로 옮깁니다.</li>
            <li className={li}>한 지역에 양측 유닛이 모이면 주사위 없이 1:1로 동시에 제거됩니다. 제거된 유닛은 보급처로 돌아갑니다.</li>
            <li className={li}>요새는 전투로 파괴되지 않습니다 (엔트 토큰으로만 파괴).</li>
          </ul>
        </div>

        <div className={box}>
          <p className={h3}>동맹 토큰 (6종족 × 3)</p>
          <p className={`${li} mb-2`}>
            같은 종족 초록 카드 2장 → 그 종족 더미 위 2개 중 1개 선택. 서로 다른 3종족 달성(게임 중 1회) → 세 종족 더미 위 1개씩 중 1개 선택.
          </p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {RACES.map((r) => (
              <div key={r} className="rounded-lg bg-black/20 p-2 light:bg-slate-50">
                <p className="text-xs font-bold">
                  {RACE_INFO[r].emoji} {RACE_INFO[r].name}
                  {TOKENS[TOKEN_IDS_BY_RACE[r][0]].isOneShot ? " (즉시 1회)" : " (지속)"}
                </p>
                {TOKEN_IDS_BY_RACE[r].map((id) => (
                  <p key={id} className="text-[11px] text-white/65 light:text-slate-600">
                    · {TOKENS[id].name}: {TOKENS[id].description}
                  </p>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className={box}>
          <p className={h3}>랜드마크 7종</p>
          <ul className="flex flex-col gap-0.5">
            {Object.values(LANDMARKS).map((l) => (
              <li key={l.id} className={li}>
                🏰 <b>{l.name}</b> ({l.baseCost.coins}주화{l.baseCost.tech?.map((s) => TECH_INFO[s].emoji).join("")}) — {l.description}
              </li>
            ))}
          </ul>
        </div>

        <div className={box}>
          <p className={h3}>승리 조건</p>
          <ul className="flex list-disc flex-col gap-1 pl-4">
            <li className={li}>
              💍 <b>반지 원정</b>: 파란 카드 등의 반지 기호는 <b>내 말</b>을 전진시킵니다. 트랙은 0~{TRACK_LENGTH}번 한 줄이고 프로도 & 샘과 나즈굴 모두 {FRODO_START}번에서 함께
              출발합니다. 말이 <b>지나가거나 멈춘 모든 칸</b>의 보상을 순서대로 받습니다(양 진영 모두): 2번 🪙 주화 1, 4번 ⚔️ 유닛 1개 배치, 6번 📜 동맹 토큰(종족 선택 → 위 2개 중 1개),
              8번 ⏩ 이번 차례 후 추가 턴, 10번 💥 적 요새 1개 파괴. <b>레이스</b>: 프로도 & 샘이든 나즈굴이든 {TRACK_LENGTH}번 종착점에 <b>먼저</b> 도달한
              진영이 즉시 승리 — 그 이동의 칸 보상은 받지 않습니다. 두 말이 같은 칸에 서거나 서로 추월해도 게임은 끝나지 않고, 각자 지나간 칸의 보상만 따로 받습니다.
            </li>
            <li className={li}>
              🌿 <b>종족 동맹</b>: 서로 다른 종족 기호 6개(🦅 독수리 토큰 포함) 달성 시 즉시 승리.
            </li>
            <li className={li}>
              🗺️ <b>완전 정복</b>: 7개 지역 모두에 내 유닛 또는 요새가 있으면 즉시 승리.
            </li>
            <li className={li}>
              🏁 3챕터가 끝나면 내 세력이 있는 지역이 더 많은 쪽이 승리. 동률이면 종족 기호 수 → 주화 → 원정대 순으로 가립니다.
            </li>
          </ul>
        </div>
        <p className="text-[11px] text-white/40 light:text-slate-500">
          챕터가 끝나면 마지막 카드를 가져간 플레이어의 상대가 다음 챕터를 시작하고, 랜드마크를 3장으로 채웁니다. 카드별 세부 비용·지역 배치·트랙 길이는 이 사이트에서 정한 값입니다.
        </p>
      </div>
    </Overlay>
  );
}
