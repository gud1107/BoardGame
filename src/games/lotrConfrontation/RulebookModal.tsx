"use client";

import Overlay from "@/components/Overlay";
import { EFFECT_ICON } from "./CardFace";
import { ALL_CARDS, CHARACTERS, FACTION_CHARACTERS } from "./data";
import { TURN_LIMIT } from "./engine";
import type { Faction } from "./types";

const box = "rounded-xl border border-white/10 bg-white/5 p-3 light:border-slate-200 light:bg-white light:shadow-sm";
const h3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";

function CharacterTable({ faction }: { faction: Faction }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-2">
      {FACTION_CHARACTERS[faction].map((id) => {
        const c = CHARACTERS[id];
        return (
          <div key={id} className={`${box} flex gap-2 p-2`}>
            <span className="text-2xl">{c.emoji}</span>
            <div className="min-w-0">
              <p className="text-xs font-bold text-white light:text-slate-900">
                {c.name} <span className="text-amber-400">⚔{c.basePower}</span> · {c.abilityName}
              </p>
              <p className="text-[11px] text-white/60 light:text-slate-600">{c.abilityDescription}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SpecialCards({ faction }: { faction: Faction }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-2">
      {ALL_CARDS.filter((c) => c.faction === faction && c.type === "SPECIAL").map((c) => (
        <div key={c.id} className={`${box} p-2 text-[11px]`}>
          <b className="text-white light:text-slate-900">
            {c.effectType && EFFECT_ICON[c.effectType]} {c.name} (+{c.power})
          </b>
          <p className="text-white/60 light:text-slate-600">{c.description}</p>
        </div>
      ))}
    </div>
  );
}

export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="💍 반지의 제왕: 가운데땅에서의 대결 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80 light:text-slate-700">
        <p className="text-white/70 light:text-slate-600">
          2인 비대칭 블러핑 전략 게임. 내 말은 정체가 보이지만 상대 말은 전투가 벌어지기 전까지 룬 스탠드(ᛟ)로만 보입니다. 원정대는 남쪽 샤이어,
          사우론은 북쪽 모르도르에서 출발하며 <b>원정대가 항상 선공</b>입니다.
        </p>

        <section>
          <h3 className={h3}>승리 조건</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className={box}>
              💍 <b>원정대</b>: 프로도가 모르도르에 들어가면 즉시 승리 · 또는 사우론 말 전멸
            </div>
            <div className={box}>
              👁️ <b>사우론</b>: 프로도 처치 · 또는 사우론 말 3개가 샤이어에 진입
            </div>
            <div className={box}>🚫 자기 차례에 움직일 수 있는 말이 하나도 없으면 즉시 패배</div>
            <div className={box}>⏳ (하우스룰) {TURN_LIMIT}턴이 지나면 사우론 승리 — 도주 무한 반복 방지</div>
          </div>
        </section>

        <section>
          <h3 className={h3}>준비 & 이동</h3>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-xs">
            <li>본거지 3칸 + 인접 세 구역 각 2칸 = 9칸에 말을 비밀리에 배치합니다(두 사람 동시에).</li>
            <li>매 턴 반드시 말 1개를 연결선을 따라 1칸 이동. 원정대는 북쪽·옆으로, 사우론은 남쪽·옆으로만(후퇴 불가).</li>
            <li>일반 구역 최대 2개, ⛰️ 카라드라스(산맥)는 단 1개, 본거지(샤이어·모르도르)는 4개.</li>
            <li>적 1개가 있는 칸에 들어가면 전투. 적이 2개 있거나 이미 교전 중인 칸에는 못 들어갑니다.</li>
            <li>🦇 나즈굴은 앞으로 2칸을 날아가고, 🛡️ 동부인은 빈 평지를 지나 2칸 이동할 수 있습니다.</li>
          </ul>
        </section>

        <section>
          <h3 className={h3}>전투 5단계</h3>
          <ol className="flex list-decimal flex-col gap-1 pl-5 text-xs">
            <li>두 말의 정체 공개(이후 계속 공개 상태).</li>
            <li>선제 능력 처리 — 공격자 먼저, 그다음 방어자(김리·레골라스·메리 즉시 처치, 보로미르 동반 사망, 쉐롭 거미줄, 고블린·피핀 정찰, 프로도 도주). 여기서 끝나면 카드를 쓰지 않습니다.</li>
            <li>양쪽이 손패 18장 중 1장을 비밀리에 선택.</li>
            <li>동시 공개 → 텍스트 무효화(간달프·사루만·마법·암흑의 공포·빛의 일격)를 먼저 판정 → 즉발 효과(엘프의 활·사우론의 눈·모르굴의 칼날·퇴각/독수리).</li>
            <li>기본 전투력 + 카드 수치가 높은 쪽 승리, 패자 영구 사망. 동점이면 둘 다 사망. 둘 다 살아남으면 공격자는 원래 칸으로 물러납니다.</li>
          </ol>
          <p className="mt-2 text-xs text-white/55 light:text-slate-500">쓴 카드는 버린 더미로. 손패가 0장이 되는 순간 버린 더미 전체를 다시 손으로 가져옵니다.</p>
        </section>

        <section>
          <h3 className={h3}>원정대 9인</h3>
          <CharacterTable faction="FELLOWSHIP" />
        </section>
        <section>
          <h3 className={h3}>사우론 9인</h3>
          <CharacterTable faction="SAURON" />
        </section>

        <section>
          <h3 className={h3}>카드 (각 진영 18장 — 기본 9장 + 특수 9장)</h3>
          <p className="mb-2 text-xs">기본: 숫자 1~6, ✨마법 ×2(상대 카드 텍스트 무력화), ↩️퇴각(빈 후방/측면 칸으로 물러나며 전투 취소).</p>
          <p className="mb-1 text-xs font-bold text-sky-300 light:text-sky-700">원정대 특수</p>
          <SpecialCards faction="FELLOWSHIP" />
          <p className="mt-3 mb-1 text-xs font-bold text-rose-400 light:text-rose-700">사우론 특수</p>
          <SpecialCards faction="SAURON" />
        </section>
      </div>
    </Overlay>
  );
}
