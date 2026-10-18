"use client";

import { useState, type ReactNode } from "react";
import Overlay from "@/components/Overlay";

/**
 * Onboarding for first-time players (rulebook §21): an illustrated
 * "처음 해요" tour, a glossary, the diagrams the 📖 rulebook reuses, and the
 * catalogue of one-time coach tips the board shows at the moment each rule
 * first matters. Everything here is presentation — no game state.
 */

/* ── 그림 ─────────────────────────────────────────────────── */

const ICE = "#eef6fb";
const RED = "#ef4444";
const YEL = "#facc15";

function House({ cx, cy, s }: { cx: number; cy: number; s: number }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={1.83 * s} fill="#2563eb" opacity={0.85} />
      <circle cx={cx} cy={cy} r={1.22 * s} fill="#f8fafc" />
      <circle cx={cx} cy={cy} r={0.61 * s} fill="#dc2626" opacity={0.85} />
      <circle cx={cx} cy={cy} r={0.15 * s} fill="#f8fafc" />
    </g>
  );
}

function Stone({ x, y, r, side, label }: { x: number; y: number; r: number; side: 0 | 1; label?: string }) {
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill="#8d939c" stroke="#4b5260" strokeWidth={1} />
      <circle cx={x} cy={y} r={r * 0.7} fill={side === 0 ? RED : YEL} />
      {side === 0 ? (
        <circle cx={x} cy={y} r={r * 0.32} fill="#fff" stroke="#0f172a" strokeWidth={0.8} />
      ) : (
        <path d={`M${x} ${y - r * 0.45} L${x + r * 0.4} ${y} L${x} ${y + r * 0.45} L${x - r * 0.4} ${y} Z`} fill="#0f172a" />
      )}
      {label && (
        <g>
          <circle cx={x + r} cy={y - r} r={r * 0.62} fill="#0f172a" />
          <text x={x + r} y={y - r + r * 0.25} fontSize={r * 0.8} fontWeight={900} fill="#fde047" textAnchor="middle">
            {label}
          </text>
        </g>
      )}
    </g>
  );
}

function Label({ x, y, children, anchor = "start", color = "#0f172a" }: { x: number; y: number; children: ReactNode; anchor?: "start" | "middle" | "end"; color?: string }) {
  return (
    <text x={x} y={y} fontSize={11} fontWeight={800} fill={color} textAnchor={anchor} style={{ paintOrder: "stroke", stroke: "rgba(255,255,255,0.85)", strokeWidth: 3 }}>
      {children}
    </text>
  );
}

const FRAME = "w-full max-w-sm self-center rounded-xl border border-white/10 light:border-slate-200";

/** 시트 한눈에: 하우스·버튼·티 라인·백 라인·호그 라인·가드 자리. */
export function SheetDiagram() {
  const s = 26;
  return (
    <svg viewBox="0 0 300 260" className={FRAME} role="img" aria-label="시트와 하우스 구조">
      <rect width={300} height={260} fill="#0f172a" />
      <rect x={30} y={0} width={180} height={260} fill={ICE} />
      <House cx={120} cy={70} s={s} />
      <line x1={30} x2={210} y1={70} y2={70} stroke="#334155" strokeWidth={1} />
      <line x1={30} x2={210} y1={70 + 1.83 * s} y2={70 + 1.83 * s} stroke="#334155" strokeWidth={1} strokeDasharray="3 3" />
      <line x1={30} x2={210} y1={22} y2={22} stroke="#334155" strokeWidth={1.2} />
      <rect x={30} y={226} width={180} height={4} fill="#dc2626" />
      <rect x={30} y={70 + 1.83 * s + 2} width={180} height={226 - (70 + 1.83 * s + 2)} fill="#38bdf8" opacity={0.13} />
      <line x1={120} x2={120} y1={0} y2={260} stroke="#334155" strokeWidth={0.8} />
      <Stone x={150} y={160} r={9} side={1} />
      <Label x={216} y={26} color="#e2e8f0">백 라인</Label>
      <Label x={216} y={74} color="#e2e8f0">티 라인</Label>
      <Label x={120} y={74} anchor="middle">버튼</Label>
      <Label x={216} y={58} color="#93c5fd">하우스(과녁)</Label>
      <Label x={216} y={170} color="#7dd3fc">가드 자리</Label>
      <Label x={216} y={232} color="#fca5a5">호그 라인</Label>
      <Label x={120} y={252} anchor="middle" color="#e2e8f0">▲ 스톤은 아래에서 위로</Label>
    </svg>
  );
}

/** 회전과 휨: 브룸을 목표 반대쪽에 두면 휘어서 들어온다. */
export function CurlDiagram() {
  return (
    <svg viewBox="0 0 300 220" className={FRAME} role="img" aria-label="회전에 따라 휘는 경로">
      <rect width={300} height={220} fill={ICE} />
      <House cx={150} cy={48} s={20} />
      <line x1={150} x2={92} y1={212} y2={48} stroke="#475569" strokeWidth={1.5} strokeDasharray="5 4" />
      <path d="M150 212 Q 118 110 150 50" fill="none" stroke={RED} strokeWidth={3} />
      <rect x={80} y={42} width={24} height={8} rx={3} fill={RED} stroke="#0f172a" />
      <Stone x={150} y={50} r={8} side={0} />
      <Label x={70} y={36} anchor="middle">브룸(조준점)</Label>
      <Label x={190} y={120}>↻ 시계 방향</Label>
      <Label x={190} y={136}>→ 오른쪽으로 휨</Label>
      <Label x={20} y={150}>점선 = 처음 출발 방향</Label>
      <Label x={20} y={166}>빨간 선 = 실제 길</Label>
      <Label x={150} y={208} anchor="middle">투구</Label>
    </svg>
  );
}

/** 쓸기: 앞 얼음을 닦으면 더 멀리·더 곧게. */
export function SweepDiagram() {
  return (
    <svg viewBox="0 0 300 150" className={FRAME} role="img" aria-label="쓸기의 효과">
      <rect width={300} height={150} fill={ICE} />
      <path d="M40 130 Q 70 70 120 40" fill="none" stroke="#94a3b8" strokeWidth={3} strokeDasharray="4 4" />
      <path d="M60 130 Q 78 70 100 18" fill="none" stroke="#0284c7" strokeWidth={3} />
      <Stone x={120} y={42} r={8} side={0} />
      <Stone x={100} y={20} r={8} side={0} />
      <rect x={86} y={34} width={22} height={6} rx={2} fill={RED} transform="rotate(-20 97 37)" />
      <Label x={150} y={36} color="#0369a1">쓸면: 더 멀리 · 더 곧게</Label>
      <Label x={150} y={54} color="#475569">안 쓸면: 덜 가고 더 휨</Label>
      <Label x={150} y={92}>🧹 버튼(스페이스) 연타</Label>
      <Label x={150} y={110}>우리 팀 스톤 = 언제나</Label>
      <Label x={150} y={128}>상대 스톤 = 티 라인 넘은 뒤</Label>
    </svg>
  );
}

/** 점수 예시: 레드가 가장 가깝고, 옐로의 가장 가까운 스톤보다 안쪽 레드 2개 → 레드 2점. */
export function ScoringDiagram() {
  const s = 40;
  const cx = 150;
  const cy = 95;
  return (
    <svg viewBox="0 0 300 190" className={FRAME} role="img" aria-label="점수 계산 예시">
      <rect width={300} height={190} fill={ICE} />
      <House cx={cx} cy={cy} s={s} />
      <circle cx={cx} cy={cy} r={0.95 * s} fill="none" stroke="#0f172a" strokeWidth={1.2} strokeDasharray="4 3" />
      <Stone x={cx + 0.15 * s} y={cy - 0.2 * s} r={8} side={0} label="1" />
      <Stone x={cx - 0.55 * s} y={cy + 0.3 * s} r={8} side={0} label="2" />
      <Stone x={cx + 0.6 * s} y={cy + 0.75 * s} r={8} side={1} />
      <Stone x={cx - 1.3 * s} y={cy - 0.9 * s} r={8} side={0} />
      <Label x={8} y={182}>점선 = 옐로의 가장 가까운 스톤 거리</Label>
      <Label x={292} y={16} anchor="end">🔴 레드 2점!</Label>
    </svg>
  );
}

/* ── 처음 해요 투어 ───────────────────────────────────────── */

export const TOUR_KEY = "curling-tour-done";

const STEPS: { title: string; art: ReactNode; body: ReactNode }[] = [
  {
    title: "🎯 목표: 버튼에 가장 가까이",
    art: <SheetDiagram />,
    body: (
      <>
        얼음 위로 <b>스톤</b>을 밀어 위쪽 과녁(<b>하우스</b>)의 한가운데 <b>버튼</b>에 붙이는 게임이에요. 모두가 정해진 수만큼 던지면 한 <b>엔드</b>가 끝나고 점수를 세요. 엔드 점수를 모두 더해 많은 편이 이겨요.
      </>
    ),
  },
  {
    title: "🥌 던지기: 브룸 → 회전 → 꾹 눌렀다 떼기",
    art: <CurlDiagram />,
    body: (
      <>
        ① 시트를 좌우로 끌어 <b>브룸(조준점)</b>을 놓아요. ② <b>회전</b>을 골라요 — ↻는 오른쪽, ↺는 왼쪽으로 <b>휘어요</b>. 느려질수록 많이 휘니까 브룸은 목표보다 <b>휘는 반대쪽</b>에! ③ 🥌 버튼을 <b>꾹 누르면 힘 게이지</b>가 움직이고, <b>떼는 순간</b> 출발해요. 처음엔 빨간 <b>&lsquo;하우스&rsquo;</b> 구간에서 떼 보세요.
      </>
    ),
  },
  {
    title: "🧹 쓸기: 다 같이 연타!",
    art: <SweepDiagram />,
    body: (
      <>
        스톤이 미끄러지는 동안 <b>🧹 버튼을 연타</b>(또는 스페이스 바)하면 앞 얼음을 닦아 <b>더 멀리, 더 곧게</b> 가요. 짧아 보이면 쓸고, 너무 길어 보이면 멈추세요. 우리 팀 스톤은 팀원 모두가 처음부터, <b>상대 스톤은 티 라인을 넘은 뒤에</b> 쓸어서 하우스 밖으로 밀어낼 수 있어요.
      </>
    ),
  },
  {
    title: "🏆 점수 세기",
    art: <ScoringDiagram />,
    body: (
      <>
        엔드가 끝나면 <b>버튼에 가장 가까운 스톤의 편만</b> 점수를 얻어요. 점수 = <b>상대의 가장 가까운 스톤보다 안쪽에 있는 내 스톤 수</b>. 위 그림은 레드 1·2번이 옐로보다 안쪽이라 <b>레드 2점</b>(바깥 레드는 안 세요). 하우스에 닿아 있어야 세고, 아무도 없으면 0점(블랭크).
      </>
    ),
  },
  {
    title: "🔨 순서와 해머",
    art: null,
    body: (
      <>
        두 팀이 한 개씩 번갈아 던져요. 엔드의 <b>마지막 스톤</b>을 던지는 권리를 <b>해머</b>라고 해요 — 마지막에 결과를 뒤집을 수 있어 가장 유리해요(점수판 🔨). <b>점수를 낸 편은 다음 엔드에 먼저</b> 던져서 해머를 넘겨줘요. 해머 없이 점수를 내면 <b>스틸</b>!
      </>
    ),
  },
  {
    title: "🚫 조심 + 🎉 파티 스톤",
    art: null,
    body: (
      <ul className="list-disc space-y-1 pl-4">
        <li>
          아무것도 안 맞히고 <b>굵은 빨간 호그 라인</b>을 못 넘으면 아웃(너무 약함).
        </li>
        <li>옆 벽에 닿거나 하우스 뒤 백 라인을 완전히 넘어도 아웃(너무 셈).</li>
        <li>
          엔드 초반 몇 투구 동안은 하우스 앞 <b>상대 가드를 쳐내면 안 돼요</b>(프리 가드 존) — 쳐내면 원위치.
        </li>
        <li>
          엔드마다 편별로 <b>파티 스톤</b> 1개(💣🐘🍯🌀👻🧲) — 조준할 때 버튼을 눌러 그 투구에 써요.
        </li>
        <li>
          남의 차례엔 🔮 예측, 팀원이면 📣 스킵 콜(시트 탭)로 함께 해요. 막히면 📖 룰북 · 🔰 안내!
        </li>
      </ul>
    ),
  },
];

export function HowToPlayTour({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0);
  const step = STEPS[i];
  const done = () => {
    try {
      window.localStorage.setItem(TOUR_KEY, "1");
    } catch {
      /* ignore */
    }
    onClose();
  };
  return (
    <Overlay title={`🔰 처음 해요 · ${i + 1}/${STEPS.length}`} onClose={done} wide>
      <div className="flex flex-col gap-3 text-sm text-white/80 light:text-slate-700">
        <h3 className="text-base font-black text-white light:text-slate-900">{step.title}</h3>
        {step.art}
        <div className="break-keep leading-relaxed">{step.body}</div>
        <div className="flex items-center justify-center gap-1.5 py-1">
          {STEPS.map((_, k) => (
            <span key={k} className={`h-1.5 rounded-full transition-all ${k === i ? "w-5 bg-sky-400" : "w-1.5 bg-white/25 light:bg-slate-300"}`} />
          ))}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={done} className="rounded-xl border border-white/15 px-3 py-2.5 text-xs text-white/60 light:border-slate-300 light:text-slate-500">
            건너뛰기
          </button>
          {i > 0 && (
            <button type="button" onClick={() => setI(i - 1)} className="flex-1 rounded-xl border border-white/15 py-2.5 text-sm text-white/80 light:border-slate-300 light:text-slate-700">
              ◀ 이전
            </button>
          )}
          <button type="button" onClick={() => (i + 1 < STEPS.length ? setI(i + 1) : done())} className="flex-1 rounded-xl bg-sky-600 py-2.5 text-sm font-bold text-white hover:bg-sky-500">
            {i + 1 < STEPS.length ? "다음 ▶" : "시작할게요!"}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

/* ── 용어 사전 ─────────────────────────────────────────────── */

export const GLOSSARY: [string, string][] = [
  ["엔드", "모두가 정해진 스톤을 다 던질 때까지의 한 판. 끝나면 점수를 세고 시트를 비워요."],
  ["하우스", "과녁 모양의 원(바깥 파랑 → 흰색 → 빨강 → 버튼). 여기에 닿은 스톤만 점수를 세요."],
  ["버튼", "하우스 한가운데 작은 흰 원. 여기에 가장 가까운 편이 점수를 얻어요."],
  ["티 라인", "버튼을 가로지르는 선. 상대 스톤은 이 선을 넘은 뒤에만 쓸 수 있어요."],
  ["호그 라인", "하우스 앞 굵은 빨간 선. 아무것도 안 맞히고 이걸 다 못 넘으면 아웃."],
  ["백 라인", "하우스 뒤 끝 선. 완전히 넘으면 아웃."],
  ["브룸", "조준점. 스톤은 투구 지점에서 브룸을 향해 출발해요."],
  ["회전(컬)", "↻ 시계 방향이면 오른쪽, ↺ 반시계면 왼쪽으로 휘어요. 느려질수록 많이 휘어요."],
  ["웨이트(힘)", "얼마나 세게 미는지. 게이지 구간: 미달 · 가드 · 하우스 · 테이크아웃."],
  ["쓸기(스위핑)", "스톤 앞 얼음을 닦기. 더 멀리·더 곧게. 연타할수록 세게."],
  ["해머", "엔드의 마지막 스톤을 던지는 권리. 가장 유리해요(🔨)."],
  ["드로우", "다른 스톤을 안 맞히고 원하는 자리(보통 하우스)에 멈추게 하는 샷."],
  ["가드", "하우스 앞에 세워 뒤의 스톤을 지키는 스톤."],
  ["테이크아웃", "상대 스톤을 맞혀 경기 밖으로 내보내는 샷. 세게 던져요."],
  ["히트 앤 스테이", "상대 스톤을 쳐내고 내 스톤은 그 자리에 남는 샷."],
  ["프리즈", "다른 스톤에 딱 붙여 멈추는 샷 — 쳐내기 어려워요."],
  ["레이즈", "내 스톤을 밀어 하우스 안쪽으로 넣는 샷."],
  ["프리 가드 존", "엔드 초반엔 하우스 앞 상대 가드를 쳐낼 수 없어요(쳐내면 원위치)."],
  ["블랭크 엔드", "아무도 점수를 못 낸 엔드. 해머는 그대로 유지."],
  ["스틸", "해머가 없는 편이 점수를 내는 것."],
  ["스킵 콜", "팀원이 시트를 탭해 '여기!'를 짚어 주는 것(📣)."],
  ["파티 스톤", "엔드마다 편별 1개: 💣 폭탄 · 🐘 묵직이 · 🍯 끈끈이 · 🌀 회오리 · 👻 유령 · 🧲 자석."],
];

export function GlossaryList() {
  return (
    <dl className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
      {GLOSSARY.map(([term, desc]) => (
        <div key={term} className="rounded-lg bg-white/[0.04] px-3 py-2 light:bg-slate-50">
          <dt className="text-xs font-black text-sky-200 light:text-sky-700">{term}</dt>
          <dd className="text-xs break-keep text-white/70 light:text-slate-600">{desc}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ── 코치 말풍선 (처음 한 번씩) ───────────────────────────── */

export const COACH_KEY = "curling-coach-seen";

export type CoachId =
  | "aim-broom"
  | "aim-spin"
  | "aim-power"
  | "card"
  | "hammer"
  | "sweep-own"
  | "sweep-opp"
  | "watch"
  | "mate-call"
  | "scored"
  | "hog"
  | "through"
  | "fgz"
  | "guard";

export const COACH_TEXT: Record<CoachId, string> = {
  "aim-broom": "① 시트를 좌우로 끌어 브룸(조준점)을 옮겨요. 스톤은 브룸을 향해 출발해요. (◀ ▶로 미세 조정)",
  "aim-spin": "② 회전을 골라요. ↻ 시계 방향은 오른쪽으로 휘어요 — 그래서 브룸은 목표보다 왼쪽에! 바꾸면 브룸도 반대편으로 옮겨져요.",
  "aim-power": "③ 🥌 버튼을 꾹 누르면 힘 게이지가 오르내려요. 처음엔 빨간 '하우스' 구간에서 떼 보세요. 시트 위 표시가 직선 기준 멈출 자리예요.",
  card: "🎉 이번 엔드의 파티 스톤이 있어요! 버튼을 눌러 켜면 이번 투구에 써요. 엔드가 끝나면 사라지니 아끼지 마세요.",
  hammer: "🔨 이번이 엔드의 마지막 스톤(해머)! 결과를 뒤집을 마지막 기회예요. 지금 끝나면 누가 몇 점인지 위 칩을 보세요.",
  "sweep-own": "🧹 지금 연타! 쓸면 더 멀리·더 곧게 가요. 짧아 보이면 쓸고, 하우스를 지나칠 것 같으면 멈추세요.",
  "sweep-opp": "상대 스톤이 티 라인을 넘었어요! 지금 쓸면 더 멀리 가서 하우스 밖으로 밀어낼 수 있어요.",
  watch: "상대 차례예요. 🔮 하우스에 남을지 예측해 보고, 스톤이 티 라인을 넘으면 쓸어서 밀어낼 준비!",
  "mate-call": "📣 우리 팀이 던질 차례예요. 아래에서 콜 종류를 고르고 시트를 탭하면 던지는 사람에게 '여기!'가 보여요.",
  scored: "점수 계산: 버튼에 가장 가까운 편만 점수! 상대의 가장 가까운 스톤보다 안쪽에 있는 내 스톤 수(노란 번호)가 점수예요.",
  hog: "힘이 약했어요 — 아무것도 안 맞히면 굵은 빨간 호그 라인을 다 넘어야 살아남아요. 게이지를 조금 더 오래!",
  through: "너무 셌어요 — 하우스에 멈추려면 게이지 빨간 '하우스' 구간에서 떼고, 길어 보이면 쓸기를 멈추세요.",
  fgz: "🛡️ 프리 가드 존: 엔드 초반엔 하우스 앞 상대 가드를 쳐낼 수 없어서 원위치됐어요. 가드를 피해 돌아 들어가 보세요(회전 활용).",
  guard: "🛡️ 가드: 하우스 앞 스톤은 뒤에 숨은 내 스톤을 지켜줘요. 해머가 있을 때 특히 좋아요.",
};

export function loadCoachSeen(): Set<CoachId> {
  try {
    const raw = window.localStorage.getItem(COACH_KEY);
    return new Set(raw ? (JSON.parse(raw) as CoachId[]) : []);
  } catch {
    return new Set();
  }
}

export function saveCoachSeen(seen: Set<CoachId>) {
  try {
    window.localStorage.setItem(COACH_KEY, JSON.stringify([...seen]));
  } catch {
    /* ignore */
  }
}

export function CoachBubble({ id, onDismiss }: { id: CoachId; onDismiss: () => void }) {
  return (
    <div className="pointer-events-auto absolute inset-x-2 bottom-2 z-10 flex items-start gap-2 rounded-2xl border border-sky-300/40 bg-slate-900/90 p-3 text-xs text-white shadow-xl backdrop-blur light:border-sky-400 light:bg-white/95 light:text-slate-800">
      <span className="text-xl leading-none">🔰</span>
      <p className="min-w-0 flex-1 break-keep leading-relaxed">{COACH_TEXT[id]}</p>
      <button type="button" onClick={onDismiss} className="shrink-0 rounded-full bg-sky-600 px-2.5 py-1 text-[11px] font-bold text-white">
        알겠어요
      </button>
    </div>
  );
}
