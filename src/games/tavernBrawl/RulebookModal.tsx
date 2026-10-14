"use client";

import Overlay from "@/components/Overlay";
import { CLASSES, CLASS_ORDER, HEROES, KEYWORDS, TRIBES, TRIBE_ORDER } from "./units";

const H3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";
const LIST = "list-disc space-y-1.5 pl-4 text-white/70 light:text-slate-600";

/** 게임 중 📖 버튼 — 전체 룰북(boardGameRule/여관난투/여관난투.md)의 요약. 종족·키워드·영웅 표는 units.ts에서 바로 그린다. */
export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="📖 여관 난투 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80 light:text-slate-700">
        <section>
          <h3 className={H3}>목표</h3>
          <p className="break-keep text-white/70 light:text-slate-600">
            여관 상점에서 유닛을 사서 보드(최대 7칸)에 세우면 다른 손님과 <b>자동으로 전투</b>해요. 지면 체력 ❤️이 깎이고, 마지막까지 살아남은 한 명이 챔피언이에요.
          </p>
        </section>

        <section>
          <h3 className={H3}>상점 단계 (모두 동시에, 비공개)</h3>
          <ul className={LIST}>
            <li>골드 🪙: 1라운드 3 → 매 라운드 +1, 최대 10. 3연승·3연패면 +1. 남은 골드는 사라져요.</li>
            <li><b>구매</b> 3골드 → 손패(최대 10) · <b>판매</b> +1골드 · <b>새로고침</b> 1골드 · <b>고정 🔒</b> 다음 라운드에도 상점 유지.</li>
            <li>손패에서 <b>보드에 낼 때</b> 📣 전투의 함성 발동. 보드 순서가 곧 공격 순서(왼쪽부터).</li>
            <li><b>여관 등급업</b> ⬆: 2등급 5 · 3등급 7 · 4등급 8 · 5등급 9 · 6등급 10골드, 매 라운드 1씩 싸져요. 등급이 높을수록 좋은 유닛과 상점 칸이 늘어요.</li>
            <li>상점 단계가 끝날 때 🌱 성장 효과가 발동해요(영구).</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>3장 합성 · 황금</h3>
          <p className="break-keep text-white/70 light:text-slate-600">
            같은 유닛 3장이 모이면 <b>황금 유닛</b>(기본 스탯 2배 + 버프 합, 효과 2배)이 손패로 와요. 황금 유닛을 보드에 내면 <b>내 여관 등급 +1</b> 유닛 3장 중 1장을 <b>발견</b>해요.
          </p>
        </section>

        <section>
          <h3 className={H3}>전투 단계 (자동)</h3>
          <ul className={LIST}>
            <li>유닛이 많은 쪽이 선공. 영웅·시너지·“전투 시작” 효과 후, 양쪽이 번갈아 왼쪽부터 한 마리씩 공격해요.</li>
            <li>대상은 도발 유닛 우선, 없으면 무작위. 서로 공격력만큼 피해를 주고받아요.</li>
            <li>죽으면 🪦 죽음의 메아리(그 자리에 소환), 🔁 부활은 체력 1로 한 번 더.</li>
            <li>
              ⚡ <b>기력·스킬</b>: 공격할 때·맞고 버틸 때 기력 +1. 가득 차면 자기 차례에 <b>직업 스킬</b>을 먼저 쓰고 공격해요(전사 필살 일격, 수호자 방벽, 마법사 화염구, 궁수 화살 비 …). 위력은 유닛 등급만큼(황금 2배) — 카드 설명창에서 확인.
            </li>
            <li>진 쪽 피해 = 이긴 쪽 여관 등급 + 살아남은 유닛 등급 합. 1~3라운드 최대 5, 4~7라운드 최대 10.</li>
            <li>전투 중 버프는 그 전투에서만. 인원이 홀수면 한 명은 최근 탈락자의 👻 유령과 싸워요.</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>종족 · 직업</h3>
          <p className="break-keep text-white/70 light:text-slate-600">
            모든 유닛은 <b>종족</b>(중립 제외) 하나와 <b>직업</b> 하나를 가져요. 보드 위 같은 종족·직업이 2·4·6명이면 각각 시너지가 켜져요. 종족은 10개 중 <b>한 판에 7개</b>만 상점에 나와요(화면 위 「이번 판」).
          </p>
        </section>

        <section>
          <h3 className={H3}>종족 시너지 (보드 위 같은 종족 수)</h3>
          <ul className="space-y-1.5 text-white/70 light:text-slate-600">
            {TRIBE_ORDER.map((t) => (
              <li key={t}>
                <b>
                  {TRIBES[t].emoji} {TRIBES[t].name}
                </b>{" "}
                — {TRIBES[t].levels.map(([n, text]) => `(${n}) ${text}`).join(" · ")}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className={H3}>직업 시너지 (보드 위 같은 직업 수)</h3>
          <ul className="space-y-1.5 text-white/70 light:text-slate-600">
            {CLASS_ORDER.map((k) => (
              <li key={k}>
                <b>
                  {CLASSES[k].emoji} {CLASSES[k].name}
                </b>{" "}
                — {CLASSES[k].levels.map(([n, text]) => `(${n}) ${text}`).join(" · ")}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className={H3}>키워드</h3>
          <ul className={LIST}>
            {Object.values(KEYWORDS).map((k) => (
              <li key={k.name}>
                {k.icon} <b>{k.name}</b> — {k.text}
              </li>
            ))}
            <li>📣 <b>전투의 함성</b> — 보드에 낼 때 · 🪦 <b>죽음의 메아리</b> — 죽을 때 · 🌱 <b>성장</b> — 상점 단계가 끝날 때</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>영웅</h3>
          <ul className={LIST}>
            {HEROES.map((h) => (
              <li key={h.id}>
                {h.emoji} <b>{h.name}</b> · {h.power} — {h.text}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Overlay>
  );
}
