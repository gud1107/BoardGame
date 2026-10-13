"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { HeroId } from "./units";

/**
 * 영웅 고르기 화면에서 마우스를 올리면(모바일은 "미리보기" 탭) 뜨는 능력 미리보기.
 * 작은 보드 그림이 "전 → 후"로 1.6초마다 번갈아 바뀌며 능력이 무엇을 바꾸는지 보여 준다.
 * 숫자는 예시일 뿐 — 실제 규칙은 engine.ts/combat.ts.
 */

type Mini = { e: string; a?: number; h?: number; shield?: boolean; dead?: boolean; hl?: boolean };

type Demo = {
  /** 언제 발동하나 */
  when: string;
  before: ReactNode;
  after: ReactNode;
  /** 바뀐 점 한 줄 */
  caption: string;
  tips: string[];
};

function Unit({ u }: { u: Mini }) {
  return (
    <span
      className={`relative flex h-12 w-10 flex-col items-center justify-center rounded-lg border text-xl transition-all duration-300 ${
        u.dead ? "border-white/10 bg-black/40 opacity-40 grayscale" : u.hl ? "border-yellow-300 bg-yellow-300/15 shadow-[0_0_10px_rgba(250,204,21,0.6)]" : "border-white/15 bg-stone-800"
      } ${u.shield ? "ring-2 ring-sky-300/80" : ""}`}
    >
      {u.dead ? "💀" : u.e}
      {u.a !== undefined && (
        <span className={`absolute -bottom-1.5 flex gap-0.5 text-[10px] font-black ${u.hl ? "tb-hp-pop" : ""}`}>
          <span className="rounded bg-amber-500 px-0.5 text-black">{u.a}</span>
          <span className="rounded bg-rose-600 px-0.5 text-white">{u.h}</span>
        </span>
      )}
      {u.shield && <span className="absolute -right-1.5 -top-1.5 text-xs">🫧</span>}
    </span>
  );
}

const Row = ({ units }: { units: Mini[] }) => (
  <span className="flex gap-1">
    {units.map((u, i) => (
      <Unit key={i} u={u} />
    ))}
  </span>
);

const Chip = ({ children, hl }: { children: ReactNode; hl?: boolean }) => (
  <span className={`rounded-lg px-2 py-1 text-xs font-black ${hl ? "tb-hp-pop bg-yellow-400 text-black" : "bg-white/10 text-white/80"}`}>{children}</span>
);

const Slot = ({ e, hl }: { e: string; hl?: boolean }) => (
  <span className={`flex h-9 w-8 items-center justify-center rounded-md border text-base ${hl ? "border-yellow-300 bg-yellow-300/15" : "border-amber-900/50 bg-amber-950/40"}`}>{e}</span>
);

const DEMOS: Record<HeroId, Demo> = {
  mage: {
    when: "상점 단계 · 버튼을 누르고 아군 1명 고르기",
    before: (
      <span className="flex flex-col items-center gap-1.5">
        <Row units={[{ e: "🐺", a: 2, h: 3 }, { e: "🛡️", a: 3, h: 3 }]} />
        <Chip>🪙 5</Chip>
      </span>
    ),
    after: (
      <span className="flex flex-col items-center gap-1.5">
        <Row units={[{ e: "🐺", a: 3, h: 4, hl: true }, { e: "🛡️", a: 3, h: 3 }]} />
        <Chip hl>🪙 4</Chip>
      </span>
    ),
    caption: "1골드로 고른 아군 1명 +1/+1",
    tips: ["라운드당 1번", "버프는 계속 남아요 — 키울 유닛 하나에 꾸준히"],
  },
  mercenary: {
    when: "항상 (상점 단계마다)",
    before: (
      <span className="flex flex-col items-center gap-1.5">
        <span className="flex gap-1">
          <Slot e="🐗" />
          <Slot e="🤖" />
          <Slot e="🧚" />
        </span>
        <Chip>🔄 새로고침 🪙1</Chip>
      </span>
    ),
    after: (
      <span className="flex flex-col items-center gap-1.5">
        <span className="flex gap-1">
          <Slot e="🐗" />
          <Slot e="🤖" />
          <Slot e="🧚" />
          <Slot e="🐉" hl />
        </span>
        <Chip hl>🔄 새로고침 무료</Chip>
      </span>
    ),
    caption: "상점 칸 +1, 매 상점 단계 무료 새로고침",
    tips: ["눌러 쓸 필요 없는 지속 효과", "원하는 유닛을 찾기 쉬워서 3장 합성(황금)에 유리"],
  },
  castellan: {
    when: "전투 시작 시 자동",
    before: <Row units={[{ e: "🐻", a: 4, h: 5 }, { e: "🧙", a: 3, h: 2 }, { e: "🐉", a: 5, h: 5 }]} />,
    after: <Row units={[{ e: "🐻", a: 4, h: 5, shield: true, hl: true }, { e: "🧙", a: 3, h: 2 }, { e: "🐉", a: 5, h: 5 }]} />,
    caption: "가장 왼쪽 아군에게 보호막 🫧 (첫 피해 무시)",
    tips: ["눌러 쓸 필요 없는 지속 효과", "맨 왼쪽에 튼튼한 유닛·도발 유닛을 두면 좋아요"],
  },
  merchant: {
    when: "항상 (유닛을 팔 때)",
    before: (
      <span className="flex items-center gap-1.5">
        <Unit u={{ e: "🐗", a: 2, h: 2 }} />
        <span className="text-white/50">팔기 →</span>
        <Chip>🪙 +1</Chip>
      </span>
    ),
    after: (
      <span className="flex items-center gap-1.5">
        <Unit u={{ e: "🐗", a: 2, h: 2 }} />
        <span className="text-white/50">팔기 →</span>
        <Chip hl>🪙 +2</Chip>
      </span>
    ),
    caption: "유닛을 팔 때마다 골드 +1 추가",
    tips: ["눌러 쓸 필요 없는 지속 효과", "판매가가 2배라 유닛 갈아타기가 싸져요"],
  },
  tamer: {
    when: "상점 단계 · 버튼 누르기",
    before: (
      <span className="flex flex-col items-center gap-1.5">
        <Row units={[{ e: "🐺", a: 2, h: 3 }, { e: "🐻", a: 4, h: 5 }, { e: "🦅", a: 3, h: 2 }]} />
        <Chip>🪙 6</Chip>
      </span>
    ),
    after: (
      <span className="flex flex-col items-center gap-1.5">
        <Row units={[{ e: "🐺", a: 3, h: 4, hl: true }, { e: "🐻", a: 5, h: 6, hl: true }, { e: "🦅", a: 4, h: 3, hl: true }]} />
        <Chip hl>🪙 3</Chip>
      </span>
    ),
    caption: "3골드로 보드의 모든 아군 +1/+1",
    tips: ["라운드당 1번", "보드가 꽉 찰수록 이득이 커져요"],
  },
  prophet: {
    when: "상점 단계 · 버튼 누르기",
    before: (
      <span className="flex flex-col items-center gap-1.5">
        <span className="flex gap-1">
          <Slot e="❔" />
          <Slot e="❔" />
          <Slot e="❔" />
        </span>
        <Chip>🪙 6</Chip>
      </span>
    ),
    after: (
      <span className="flex flex-col items-center gap-1.5">
        <span className="flex gap-1">
          <Slot e="🐲" />
          <Slot e="🧛" hl />
          <Slot e="🦄" />
        </span>
        <Chip hl>🪙 3 · 🧛 손으로</Chip>
      </span>
    ),
    caption: "3골드로 내 여관 등급 유닛 3장 중 1장을 골라 손패로",
    tips: ["라운드당 1번", "필요한 종족·직업을 콕 집어 찾을 때"],
  },
  necro: {
    when: "전투 중 자동 (전투마다 1번)",
    before: <Row units={[{ e: "🐻", dead: true }, { e: "🧙", a: 3, h: 2 }]} />,
    after: <Row units={[{ e: "🐻", a: 4, h: 1, hl: true }, { e: "🧙", a: 3, h: 2 }]} />,
    caption: "처음 죽는 아군(부활 없는)이 체력 1로 되살아남",
    tips: ["눌러 쓸 필요 없는 지속 효과", "공격력 높은 유닛이 한 번 더 때려요"],
  },
  architect: {
    when: "항상 (여관 등급업)",
    before: <Chip>⬆️ 등급업 🪙5</Chip>,
    after: <Chip hl>⬆️ 등급업 🪙3</Chip>,
    caption: "여관 등급업 비용이 항상 2 싸요",
    tips: ["눌러 쓸 필요 없는 지속 효과", "남보다 빨리 높은 등급 유닛을 만나요"],
  },
};

export default function HeroPreview({ hero }: { hero: HeroId }) {
  const d = DEMOS[hero];
  const [after, setAfter] = useState(false);
  useEffect(() => {
    const t = window.setInterval(() => setAfter((v) => !v), 1600);
    return () => window.clearInterval(t);
  }, []);
  if (!d) return null;
  return (
    <div className="flex flex-col gap-2 text-left text-[11px] leading-snug text-white/85">
      <style>{`@keyframes tb-hp-pop{0%{transform:scale(.6)}60%{transform:scale(1.35)}100%{transform:scale(1)}}.tb-hp-pop{animation:tb-hp-pop .35s ease-out}`}</style>
      <span className="self-start rounded-full bg-amber-500/20 px-2 py-0.5 font-bold text-amber-200">⏱ {d.when}</span>
      <div className="flex flex-col items-center gap-1 rounded-xl bg-black/40 px-2 py-3">
        <span className={`text-[10px] font-black tracking-widest ${after ? "text-yellow-300" : "text-white/40"}`}>{after ? "능력 적용" : "능력 없을 때"}</span>
        <div key={after ? "a" : "b"} className="tb-pop flex min-h-14 items-center justify-center">
          {after ? d.after : d.before}
        </div>
      </div>
      <p className="font-semibold text-yellow-100">✨ {d.caption}</p>
      <ul className="flex flex-col gap-0.5 text-white/65">
        {d.tips.map((t) => (
          <li key={t}>· {t}</li>
        ))}
      </ul>
    </div>
  );
}
