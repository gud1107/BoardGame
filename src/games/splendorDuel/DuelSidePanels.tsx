"use client";

import { useState, type ReactNode } from "react";
import { DuelToken, TOKEN_LABEL } from "./DuelToken";
import {
  colorPoints,
  crownsOf,
  GEM_ORDER,
  otherSeat,
  prestigeOf,
  TOKEN_LIMIT,
  WIN_CROWNS,
  WIN_PRESTIGE,
  WIN_SINGLE_COLOR,
  type GemColor,
  type PlayerState,
  type Seat,
  type SplendorDuelState,
} from "./engine";

/**
 * The two always-available side panels of the 스플렌더 대결 screen:
 *  - left  `VictoryPanel` — the 3 win conditions with both players' live progress
 *  - right `BeginnerGuide` — plain-language "how do I…" cards for every action,
 *    highlighting whichever one the current turn state is about.
 * On xl+ screens the board renders them as sticky side columns; below that
 * they live in `EdgeDrawer`s (fixed edge tabs) so they never add page height
 * to the zero-scroll phone layout.
 */

function Bar({ value, goal, tone }: { value: number; goal: number; tone: string }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-white/10 light:bg-slate-200">
      <div className={`h-full rounded-full ${tone} transition-all duration-500`} style={{ width: `${Math.min(100, (value / goal) * 100)}%` }} />
    </div>
  );
}

function bestColor(p: PlayerState): GemColor {
  const pts = colorPoints(p);
  return GEM_ORDER.reduce((a, b) => (pts[b] > pts[a] ? b : a));
}

export function VictoryPanel({ state, viewerSeat, names }: { state: SplendorDuelState; viewerSeat: Seat; names: Record<Seat, string> }) {
  const me = state.players[viewerSeat];
  const opp = state.players[otherSeat(viewerSeat)];
  const rows = [
    { key: "prestige", icon: "⭐", label: "위신 점수", goal: WIN_PRESTIGE, desc: "산 카드 + 왕실 카드의 점수 합", of: (p: PlayerState) => prestigeOf(p) },
    { key: "crowns", icon: "👑", label: "왕관", goal: WIN_CROWNS, desc: "산 카드에 그려진 왕관 개수", of: (p: PlayerState) => crownsOf(p) },
    { key: "color", icon: "🎨", label: "한 가지 색 점수", goal: WIN_SINGLE_COLOR, desc: "같은 색 카드들의 점수만 합산", of: (p: PlayerState) => colorPoints(p)[bestColor(p)] },
  ];
  const remaining = rows.map((r) => ({ label: r.label, left: Math.max(0, r.goal - r.of(me)) })).sort((a, b) => a.left - b.left)[0];
  const myPts = colorPoints(me);
  const oppPts = colorPoints(opp);
  return (
    <div className="flex flex-col gap-3 text-white light:text-slate-900">
      <div>
        <p className="font-serif text-sm font-black text-amber-200 light:text-amber-700">🏆 승리 조건</p>
        <p className="mt-0.5 text-[11px] leading-snug text-white/60 light:text-slate-500">
          내 턴이 끝났을 때 아래 <b>셋 중 하나라도</b> 채우면 즉시 승리!
        </p>
      </div>
      {rows.map((r) => (
        <div key={r.key} className="rounded-xl border border-white/10 bg-white/[0.03] p-2 light:border-slate-200 light:bg-white">
          <p className="flex items-baseline justify-between text-xs font-bold">
            <span>
              {r.icon} {r.label}
            </span>
            <span className="font-mono text-amber-200 light:text-amber-700">{r.goal}</span>
          </p>
          <p className="mb-1.5 text-[10px] text-white/45 light:text-slate-400">{r.desc}</p>
          <div className="flex flex-col gap-1">
            {[
              { p: me, who: names[viewerSeat], tone: "bg-amber-400" },
              { p: opp, who: names[otherSeat(viewerSeat)], tone: "bg-slate-400" },
            ].map(({ p, who, tone }, i) => (
              <div key={i}>
                <p className="flex justify-between text-[10px] text-white/70 light:text-slate-600">
                  <span className="truncate">
                    {i === 0 ? "나" : who}
                    {r.key === "color" && <span className="ml-1 text-white/40">({TOKEN_LABEL[bestColor(p)]})</span>}
                  </span>
                  <span className="ml-1 shrink-0 font-mono">
                    {r.of(p)}/{r.goal}
                  </span>
                </p>
                <Bar value={r.of(p)} goal={r.goal} tone={tone} />
              </div>
            ))}
          </div>
          {r.key === "color" && (
            <div className="mt-2 grid grid-cols-5 gap-0.5 text-center font-mono text-[10px]">
              {GEM_ORDER.map((c) => (
                <div key={c} className="flex flex-col items-center">
                  <DuelToken color={c} className="h-4 w-4" />
                  <span className="text-amber-200 light:text-amber-700">{myPts[c]}</span>
                  <span className="text-white/40 light:text-slate-400">{oppPts[c]}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
      {state.phase !== "gameOver" && (
        <p className="rounded-lg bg-amber-500/10 px-2 py-1.5 text-[11px] leading-snug text-amber-100 light:text-amber-800">
          💡 지금 가장 가까운 길: <b>{remaining.label}</b> {remaining.left}만 더!
        </p>
      )}
    </div>
  );
}

export type GuideTopic = "gems" | "scroll" | "refill" | "reserve" | "buy" | "steal" | "abilities" | "royal" | "limit";

function GuideCard({ icon, title, active, children }: { icon: string; title: string; active: boolean; children: ReactNode }) {
  return (
    <div
      className={`rounded-xl border p-2 transition ${
        active ? "border-amber-300 bg-amber-400/10 shadow-[0_0_14px_rgba(251,191,36,0.25)]" : "border-white/10 bg-white/[0.03] light:border-slate-200 light:bg-white"
      }`}
    >
      <p className="mb-1 flex items-center gap-1.5 text-xs font-black">
        <span className="text-base">{icon}</span>
        {title}
        {active && <span className="ml-auto shrink-0 rounded-full bg-amber-400 px-1.5 text-[9px] whitespace-nowrap text-black">지금!</span>}
      </p>
      <div className="flex flex-col gap-1 text-[11px] leading-snug text-white/70 light:text-slate-600">{children}</div>
    </div>
  );
}

function MiniLine({ cells, ok }: { cells: (GemColor | "pearl" | null)[]; ok: boolean }) {
  return (
    <span className="inline-flex items-center gap-0.5 rounded-md bg-black/40 px-1 py-0.5">
      {cells.map((c, i) => (c ? <DuelToken key={i} color={c} className="h-3.5 w-3.5" /> : <span key={i} className="h-3.5 w-3.5 rounded-full border border-dashed border-white/30" />))}
      <span className="ml-0.5 text-[10px]">{ok ? "✅" : "❌"}</span>
    </span>
  );
}

export function BeginnerGuide({ focus }: { focus: GuideTopic | null }) {
  return (
    <div className="flex flex-col gap-2 text-white light:text-slate-900">
      <div>
        <p className="font-serif text-sm font-black text-amber-200 light:text-amber-700">📘 처음이라면 여기부터</p>
        <p className="mt-0.5 text-[11px] leading-snug text-white/60 light:text-slate-500">
          내 차례엔 <b>필수 행동 1개</b>(보석 가져오기 · 카드 찜하기 · 카드 사기)를 꼭 하고, 그 전에 두루마리 사용/보드 채우기는 해도 되고 안 해도 돼요.
        </p>
      </div>

      <GuideCard icon="💎" title="보석 가져오기 (필수 행동)" active={focus === "gems"}>
        <p>보드에서 <b>한 줄로 붙어 있는 보석 1~3개</b>를 눌러 고른 뒤 &ldquo;가져오기&rdquo;.</p>
        <p>가로·세로·대각선 모두 OK, 중간에 빈칸이나 황금이 있으면 안 돼요(황금은 줄로 못 가져와요).</p>
        <div className="flex flex-wrap gap-1">
          <MiniLine cells={["red", "blue", "green"]} ok />
          <MiniLine cells={["red", null, "green"]} ok={false} />
        </div>
        <p className="text-amber-200/90 light:text-amber-700">⚠️ 같은 색 3개 또는 진주 2개를 가져가면 상대가 두루마리 1개를 받아요.</p>
      </GuideCard>

      <GuideCard icon="📜" title="두루마리 (특권 스크롤)" active={focus === "scroll"}>
        <p>
          쓰면 보드에서 <b>원하는 보석 1개</b>를 공짜로 가져와요(황금 제외). 필수 행동 전에, 가진 만큼 여러 번 쓸 수 있어요.
        </p>
        <p>게임에 딱 3개뿐! 받을 차례인데 테이블에 없으면 <b>상대 것을 빼앗아</b> 와요. 후공은 1개 들고 시작.</p>
      </GuideCard>

      <GuideCard icon="🔄" title="보드 채우기" active={focus === "refill"}>
        <p>주머니 속 보석을 섞어 빈칸을 채워요. 대신 <b>상대가 두루마리 1개</b>를 받아요. 가져올 보석이 없을 때 쓰세요.</p>
      </GuideCard>

      <GuideCard icon="📥" title="카드 찜하기 (예약) + 황금" active={focus === "reserve"}>
        <p>갖고 싶은 카드를 손으로 가져와 <b>나만 살 수 있게</b> 찜해요. 덤으로 <b>황금 1개</b>!</p>
        <p>
          황금 <DuelToken color="gold" className="inline h-3.5 w-3.5 align-text-bottom" />은 어떤 보석으로도 쓸 수 있는 만능 조커. 찜은 최대 3장.
        </p>
        <p>
          황금은 게임 전체에 <b>딱 3개</b>, 보석 보드 25칸 사이에 섞여 있어요. 찜할 때 보드의 황금 1개를 골라 가져오고, 보드에 없으면 카드만 찜해요. 쓴 황금은 주머니로 돌아가 보드를 채울 때 다시 나와요.
          두루마리·강탈로는 황금을 가져올 수 없어요.
        </p>
      </GuideCard>

      <GuideCard icon="💰" title="카드 사기" active={focus === "buy"}>
        <p>카드 아래 적힌 보석을 내고 사요. 반짝이는 테두리 = 지금 살 수 있는 카드.</p>
        <p>
          산 카드의 보석 그림은 <b>영구 할인</b>! 예: 사파이어 카드 2장이 있으면 사파이어 비용이 항상 2개 싸져요.
        </p>
      </GuideCard>

      <GuideCard icon="✋" title="상대 것 가져오기 (강탈)" active={focus === "steal"}>
        <p>
          ✋ 표시 카드나 왕실 카드를 얻으면 <b>상대가 가진 보석이나 진주 1개</b>를 골라 빼앗아요. 황금은 못 빼앗아요.
        </p>
      </GuideCard>

      <GuideCard icon="🎴" title="카드 특수 능력" active={focus === "abilities"}>
        <p>↻ 추가 턴 — 이번 턴이 끝나면 한 번 더!</p>
        <p>? 보너스 복사 — 내 카드 한 장의 색을 따라 해요.</p>
        <p>⬇ 토큰 획득 — 같은 색 보석 1개를 보드에서 더 가져와요.</p>
        <p>📜 특권 획득 — 두루마리 1개를 받아요.</p>
      </GuideCard>

      <GuideCard icon="👑" title="왕관과 왕실 카드" active={focus === "royal"}>
        <p>
          카드의 왕관이 <b>3개, 6개</b>가 되는 순간 왕실 카드를 1장씩 공짜로 골라요(최대 2장). 왕관 10개면 그 자체로 승리!
        </p>
      </GuideCard>

      <GuideCard icon="🎒" title={`보석은 ${TOKEN_LIMIT}개까지`} active={focus === "limit"}>
        <p>턴이 끝날 때 황금 포함 {TOKEN_LIMIT}개를 넘으면 넘친 만큼 골라서 돌려놔요.</p>
      </GuideCard>
    </div>
  );
}

/** Fixed edge tab + slide-out panel, used below xl where there's no room for side columns. */
export function EdgeDrawer({ side, label, children }: { side: "left" | "right"; label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const left = side === "left";
  return (
    <div className="xl:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`fixed top-1/2 z-40 w-4 -translate-y-1/2 border border-amber-400/50 bg-stone-950/95 py-2.5 text-[10px] leading-none font-black text-amber-200 shadow-lg [writing-mode:vertical-rl] sm:w-6 sm:text-[11px] ${
          left ? "left-0 rounded-r-xl border-l-0" : "right-0 rounded-l-xl border-r-0"
        }`}
      >
        {label}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]" onClick={() => setOpen(false)}>
          <div
            className={`absolute top-0 h-full w-[min(86vw,300px)] overflow-y-auto border-amber-400/30 bg-gradient-to-b from-stone-900 to-black p-3 light:from-white light:to-amber-50 ${
              left ? "left-0 border-r" : "right-0 border-l"
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <button onClick={() => setOpen(false)} className="mb-2 ml-auto block rounded-full border border-white/15 px-2 py-0.5 text-[11px] text-white/70 light:text-slate-600">
              닫기 ✕
            </button>
            {children}
          </div>
        </div>
      )}
    </div>
  );
}
