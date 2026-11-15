"use client";

import { useState } from "react";
import Overlay from "@/components/Overlay";
import {
  CATCH_COST,
  CELL_INFO,
  COURSES,
  COURSE_IDS,
  CRUMBLE_MS,
  GRAB_MIN,
  HANG_REGEN,
  HAUL_DRAIN,
  HAUL_SPEED,
  HOLD_DRAIN,
  LEAP_COST,
  LEDGE_REGEN,
  LOAD_DRAIN,
  MOVE_DRAIN,
  OVERHANG_MULT,
  PTS_CATCH,
  PTS_HAUL,
  PTS_LEAD,
  PTS_STAR,
  PTS_SUMMIT,
  ROCK_HIT_COST,
  ROCK_WARN_MS,
  ROPE_LEN,
  ROPE_MIN,
  SEAT_COLOR_NAMES,
  SEAT_SYMBOLS,
  TEAM_FALL_MS,
  WIND_DRAIN_MULT,
  WIND_MS,
  WIND_WARN_MS,
  type Cell,
} from "./data";

const H3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";
const LIST = "list-disc space-y-1.5 pl-4 text-white/70 light:text-slate-600";

type Tab = "basic" | "controls" | "rope" | "stamina" | "wall" | "hazard" | "score";
const TABS: { id: Tab; label: string }[] = [
  { id: "basic", label: "🧗 기본" },
  { id: "controls", label: "🎮 조작" },
  { id: "rope", label: "🪢 줄" },
  { id: "stamina", label: "💪 체력" },
  { id: "wall", label: "🧱 벽" },
  { id: "hazard", label: "🪨 위험" },
  { id: "score", label: "⭐ 결과" },
];

/** 게임 중 📖 버튼 — 전체 룰북(boardGameRule/한줄등반대/한줄등반대.md)의 앱 적용판 요약. */
export default function RulebookModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("basic");
  const s = (ms: number) => `${ms / 1000}초`;
  return (
    <Overlay title="📖 한 줄 등반대 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-4 text-sm text-white/80 light:text-slate-700">
        <div className="flex flex-wrap gap-1.5" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-full border px-3 py-1 text-xs font-bold ${tab === t.id ? "border-amber-400 bg-amber-500/20 text-amber-100 light:text-amber-800" : "border-white/15 text-white/60 light:border-slate-300 light:text-slate-600"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "basic" && (
          <>
            <section>
              <h3 className={H3}>목표</h3>
              <p className="break-keep text-white/70 light:text-slate-600">
                2~4명이 <b>밧줄 한 줄로 묶인 채</b> 암벽을 오르는 협동 게임이에요. <b>모두가 정상 턱에 올라서면 완등</b>(전원 승리). 제한 시간이 끝나거나 ⛑를 다 쓰고 또 추락하면 실패예요.
              </p>
            </section>
            <section>
              <h3 className={H3}>한 판의 흐름</h3>
              <ol className="list-decimal space-y-1.5 pl-4 text-white/70 light:text-slate-600">
                <li>출발 바닥에서 시작. 자리 순서대로 옆 사람과 {ROPE_LEN}m 줄로 이어져요.</li>
                <li>바위를 잡고 오르면 체력이 닳아요. 바위 턱(▬)에 서면 빠르게 회복돼요.</li>
                <li>누가 떨어지면 줄이 팽팽해지며 <b>잡고 있는 옆 사람이 버텨요</b>. 버티는 사람은 줄을 당겨 끌어올릴 수 있어요.</li>
                <li>⛺ 캠프 턱에 닿으면 체크포인트 — 팀 추락 뒤 여기서 다시 시작해요.</li>
                <li>모두 정상(🚩)에 서면 완등. 시간·추락 횟수로 ⭐ 1~3개를 받아요.</li>
              </ol>
            </section>
            <section>
              <h3 className={H3}>자리 표시</h3>
              <p className="text-white/70 light:text-slate-600">
                색과 모양으로 함께 표시해요: {SEAT_SYMBOLS.map((sym, i) => `${sym} ${SEAT_COLOR_NAMES[i]}`).join(" · ")}. 화면 위 체력판은 줄 순서대로 놓여 있고, 사이의 ━🪢━는 그 줄이 팽팽하다는 뜻이에요.
              </p>
            </section>
          </>
        )}

        {tab === "controls" && (
          <>
            <section>
              <h3 className={H3}>키보드</h3>
              <ul className={LIST}>
                <li><b>WASD / 방향키</b> — 잡고 있을 땐 오르내리기, 공중에선 좌우로 몸 흔들기</li>
                <li><b>Space / K</b> — 잡고 있을 때: 방향키와 함께 누르면 그쪽으로 <b>도약</b>, 방향 없이 누르면 손 놓기. 공중일 때: 바위를 <b>잡기</b></li>
                <li><b>Shift / E / J (누르고 있기)</b> — 공중에 있는 옆 사람 쪽 줄을 <b>당겨 끌어올리기</b></li>
              </ul>
            </section>
            <section>
              <h3 className={H3}>휴대폰</h3>
              <ul className={LIST}>
                <li>화면 왼쪽 아래를 끌면 조이스틱</li>
                <li>오른쪽 큰 버튼: 잡고 있으면 ⤴ 도약, 공중이면 ✋ 잡기</li>
                <li>🪢 버튼: 누르고 있는 동안 끌어올리기</li>
              </ul>
            </section>
            <section>
              <h3 className={H3}>알아 두면 좋은 것</h3>
              <ul className={LIST}>
                <li>도약은 약 2m — 2칸짜리 매끈한 띠는 뛰어넘을 수 있어요. 못 잡으면 줄이 받아 줘요.</li>
                <li>바위 턱에는 떨어지다 닿으면 저절로 내려서요 (너무 세게 떨어지면 잠깐 휘청).</li>
                <li>잡기 버튼은 조금 일찍 눌러도 0.2초 동안 기억돼요.</li>
              </ul>
            </section>
          </>
        )}

        {tab === "rope" && (
          <>
            <section>
              <h3 className={H3}>줄의 규칙</h3>
              <ul className={LIST}>
                <li>자리 1–2, 2–3, 3–4가 각각 {ROPE_LEN}m 줄로 이어져요 (한 줄로 엮인 사슬).</li>
                <li><b>둘 다 잡고 있을 때</b>: 줄 길이보다 멀어질 수 없어요. 더 가려면 옆 사람이 따라와야 해요.</li>
                <li><b>한 명이 공중일 때</b>: 그 사람은 잡고 있는 사람을 중심으로 줄에 매달려 흔들려요. 잡고 있는 사람이 움직이면 같이 끌려와요.</li>
                <li><b>아무도 못 잡은 채 {s(TEAM_FALL_MS)}</b>가 지나면 팀 추락 — ⛑ 하나를 잃고 마지막 캠프에서 다시 시작해요.</li>
              </ul>
            </section>
            <section>
              <h3 className={H3}>끌어올리기</h3>
              <ul className={LIST}>
                <li>잡고 있는 사람이 당기기를 누르고 있으면 공중에 있는 옆 사람 쪽 줄이 초당 {HAUL_SPEED}m씩 짧아져요 (최소 {ROPE_MIN}m).</li>
                <li>매끈한 띠는 한 명이 오버행 틈(▼)으로 먼저 넘은 뒤, 나머지는 손을 놓고 끌려 올라가는 게 체력이 훨씬 덜 들어요.</li>
                <li>끌려 올라간 사람은 바위 위에 오면 잡기 버튼으로 잡아요. 다시 잡으면 줄은 원래 길이로 풀려요.</li>
              </ul>
            </section>
            <section>
              <h3 className={H3}>받아내기</h3>
              <p className="break-keep text-white/70 light:text-slate-600">
                떨어지던 사람이 줄 끝에서 채이면 버티는 사람의 체력이 속도 1m/s마다 {CATCH_COST}씩 깎여요. 줄이 느슨할수록 길게 떨어져 더 아파요 — 위험한 곳에선 서로 가까이 붙으세요.
              </p>
            </section>
          </>
        )}

        {tab === "stamina" && (
          <>
            <section>
              <h3 className={H3}>체력 (0~100)</h3>
              <ul className={LIST}>
                <li>오르는 동안 초당 −{MOVE_DRAIN}, 가만히 매달려 있으면 초당 −{HOLD_DRAIN}</li>
                <li>오버행(▼) 위에선 {OVERHANG_MULT}배, 돌풍이 부는 동안 {WIND_DRAIN_MULT}배</li>
                <li>매달린 동료 한 명을 버티면 초당 −{LOAD_DRAIN} (양쪽에서 같이 버티면 반씩), 끌어올리는 동안 초당 −{HAUL_DRAIN} 더</li>
                <li>도약 한 번 −{LEAP_COST}, 낙석에 맞으면 −{ROCK_HIT_COST}</li>
              </ul>
            </section>
            <section>
              <h3 className={H3}>회복</h3>
              <ul className={LIST}>
                <li>바위 턱(▬)에 서 있으면 초당 +{LEDGE_REGEN}</li>
                <li>줄에 매달려 있으면 초당 +{HANG_REGEN} (대신 버티는 사람이 닳아요)</li>
              </ul>
            </section>
            <section>
              <h3 className={H3}>체력이 0이 되면</h3>
              <p className="break-keep text-white/70 light:text-slate-600">
                손을 놓치고 떨어져요. 체력이 {GRAB_MIN} 이상 찰 때까지는 다시 잡을 수 없어요 (턱에 내려서는 건 언제나 돼요). 줄에 매달려 숨을 고른 뒤 다시 잡으세요.
              </p>
            </section>
          </>
        )}

        {tab === "wall" && (
          <section>
            <h3 className={H3}>벽의 칸 (색 + 모양으로 구분)</h3>
            <ul className="space-y-2 text-white/70 light:text-slate-600">
              {([0, 1, 2, 3, 4] as Cell[]).map((c) => (
                <li key={c} className="flex gap-2">
                  <span className="inline-flex h-6 w-8 shrink-0 items-center justify-center rounded border border-white/20 text-xs font-bold light:border-slate-300">{CELL_INFO[c].mark || "　"}</span>
                  <span>
                    <b className="text-white light:text-slate-900">{CELL_INFO[c].name}</b> — {CELL_INFO[c].desc}
                    {c === 3 && ` (${s(CRUMBLE_MS)})`}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 break-keep text-white/60 light:text-slate-500">
              장애물 바로 위에는 대개 두 칸짜리 쉼터 턱이 있어요. 벽 전체를 가로지르는 매끈한 띠에는 오버행 틈이 꼭 한 줄 있어요. ⭐ 별은 주로 매끈한 띠 한가운데 — 줄에 매달려야 닿아요.
            </p>
            <h3 className={`${H3} mt-4`}>산 3곳</h3>
            <ul className={LIST}>
              {COURSE_IDS.map((id) => (
                <li key={id}>
                  <b>
                    {COURSES[id].emoji} {COURSES[id].name}
                  </b>{" "}
                  {"★".repeat(COURSES[id].stars)} · {COURSES[id].height}m · 캠프 {COURSES[id].camps}곳 · 제한 {COURSES[id].limitMs / 60000}분 — {COURSES[id].desc}
                </li>
              ))}
            </ul>
          </section>
        )}

        {tab === "hazard" && (
          <>
            <section>
              <h3 className={H3}>🪨 낙석</h3>
              <ul className={LIST}>
                <li>누군가의 머리 위쯤에 빨간 기둥이 {s(ROCK_WARN_MS)} 깜빡인 뒤 돌이 떨어져요. 옆으로 한 칸만 비켜도 피해요.</li>
                <li>맞으면 체력 −{ROCK_HIT_COST}, 잠깐 휘청, 벽을 잡고 있었다면 손을 놓쳐요 (턱 위에선 휘청만).</li>
                <li>정상에 선 사람은 맞지 않아요.</li>
              </ul>
            </section>
            <section>
              <h3 className={H3}>💨 돌풍 (빙벽·화산)</h3>
              <ul className={LIST}>
                <li>{s(WIND_WARN_MS)} 전에 방향과 함께 예고돼요. {s(WIND_MS)} 동안 불어요.</li>
                <li>공중에 있는 사람은 옆으로 날리고, 잡고 있는 사람은 체력이 {WIND_DRAIN_MULT}배로 닳아요. 예고가 뜨면 턱으로 가거나 꽉 잡고 멈추세요.</li>
              </ul>
            </section>
            <section>
              <h3 className={H3}>💥 팀 추락</h3>
              <p className="break-keep text-white/70 light:text-slate-600">
                모두가 공중에 뜬 채 {s(TEAM_FALL_MS)}가 지나면 팀 추락이에요. ⛑ 하나를 잃고 마지막 캠프에서 체력을 채워 다시 시작해요. ⛑가 0일 때 또 추락하면 실패예요. 한 사람이라도 벽을 잡고 있으면 추락이 아니에요.
              </p>
            </section>
          </>
        )}

        {tab === "score" && (
          <>
            <section>
              <h3 className={H3}>⭐ 등급 (완등했을 때)</h3>
              <ul className={LIST}>
                <li>⭐ 완등</li>
                <li>⭐ 팀 추락 1번 이하</li>
                <li>⭐ 기준 시간 안에 완등 (산마다 다름 — 방 만들 때 보여요)</li>
              </ul>
            </section>
            <section>
              <h3 className={H3}>순위</h3>
              <p className="break-keep text-white/70 light:text-slate-600">협동 게임이에요. 완등하면 <b>전원 1등(승리)</b>, 실패하면 전원 패배로 기록돼요.</p>
            </section>
            <section>
              <h3 className={H3}>기여 점수 (MVP 표시용)</h3>
              <ul className={LIST}>
                <li>선등: 팀 최고 높이를 1m 새로 올릴 때마다 +{PTS_LEAD}</li>
                <li>끌어올리기: 동료를 1m 끌어올릴 때마다 +{PTS_HAUL}</li>
                <li>받아내기: 떨어지는 동료를 줄로 붙잡을 때마다 +{PTS_CATCH}</li>
                <li>⭐ 별 하나 +{PTS_STAR}, 완등하면 모두 +{PTS_SUMMIT}</li>
              </ul>
            </section>
            <section>
              <h3 className={H3}>끊겼을 때</h3>
              <ul className={LIST}>
                <li>누가 나가면 10초 뒤 그 자리를 AI가 대신해요. 다시 들어오면 돌려받아요.</li>
                <li>방장이 나가면 3초 뒤 남은 사람이 판을 이어받아요.</li>
              </ul>
            </section>
          </>
        )}
      </div>
    </Overlay>
  );
}
