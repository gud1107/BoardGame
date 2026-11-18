"use client";

import { useState } from "react";
import Overlay from "@/components/Overlay";
import {
  BANANA_SLIP_MS,
  CROWN_DROP_BAN_MS,
  CROWN_DROP_MS,
  CURSE_HASTE_MAX,
  CURSE_HASTE_PER_STEP,
  DASH_CD_MS,
  FAKE_MS,
  GOLDEN_MS,
  GOLDEN_MULT,
  INVULN_MS,
  ITEM_INFO,
  ITEM_KINDS,
  LAG_COMP_MS,
  MAGNET_MS,
  MAGNET_REACH,
  PAD_CD_MS,
  RESPAWN_MS,
  REVENGE_MS,
  ROAR_R,
  SNARE_MS,
  SNARE_R,
  SNARE_SLOW,
  TEAM_INFO,
  TEAM_MIN_PLAYERS,
  UNDERDOG_BONUS,
  WEIGHT_MAX,
  WEIGHT_PER_STEP,
  WEIGHT_STEP_MS,
} from "./data";

const H3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";
const LIST = "list-disc space-y-1.5 pl-4 text-white/70 light:text-slate-600";

type Tab = "basic" | "controls" | "crown" | "arena" | "items" | "modes" | "score";
const TABS: { id: Tab; label: string }[] = [
  { id: "basic", label: "👑 기본" },
  { id: "controls", label: "🎮 조작" },
  { id: "crown", label: "🛡 왕관 규칙" },
  { id: "arena", label: "🏛 광장" },
  { id: "items", label: "🍌 아이템" },
  { id: "modes", label: "⚔️ 모드" },
  { id: "score", label: "🧮 점수·동점" },
];

const sec = (ms: number) => `${ms / 1000}초`;
const pct = (v: number) => `${Math.round(v * 100)}%`;

/** 게임 중 📖 버튼 — 전체 룰북(boardGameRule/왕관도둑/왕관도둑.md)의 앱 적용판 요약. */
export default function RulebookModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("basic");
  return (
    <Overlay title="📖 왕관 도둑 룰북" onClose={onClose} wide>
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
                하늘에 뜬 왕궁 안뜰에 <b>왕관이 딱 하나</b> 있어요. 왕관을 쓰고 있는 동안만 점수가 올라요. <b>왕을 만지면 그 사람이 새 왕</b>이 돼요. 경기 시간이 끝났을 때 왕관을 가장 오래 쓴 사람이 우승이에요.
              </p>
            </section>
            <section>
              <h3 className={H3}>한 판의 흐름</h3>
              <ol className="list-decimal space-y-1.5 pl-4 text-white/70 light:text-slate-600">
                <li>모두 광장 가장자리 쪽 둘레에서, 가운데에서 같은 거리로 시작해요.</li>
                <li>시작 {sec(CROWN_DROP_MS)} 뒤 왕관이 광장 한가운데 떨어져요 (그림자로 미리 보여요). 먼저 닿은 사람이 첫 왕!</li>
                <li>왕은 도망치고, 나머지는 쫓아요. 왕관을 쓴 시간이 0.1초 단위로 점수가 돼요.</li>
                <li>
                  마지막 {sec(GOLDEN_MS)}는 <b>✨ 황금 왕관</b> — 점수가 {GOLDEN_MULT}배로 올라요. 막판 역전이 가능해요.
                </li>
                <li>시간이 끝나면 점수 순으로 순위를 매겨요.</li>
              </ol>
            </section>
          </>
        )}

        {tab === "controls" && (
          <section className="flex flex-col gap-3">
            <div>
              <h3 className={H3}>키보드</h3>
              <ul className={LIST}>
                <li>
                  <b>WASD / 방향키</b> — 이동
                </li>
                <li>
                  <b>Space / K</b> — 💨 돌진: 누르는 쪽으로 짧게 튀어나가요 (재사용 {sec(DASH_CD_MS)}). 쫓을 땐 거리를 좁히고, 왕일 땐 빠져나갈 때 써요. 돌진으로 부딪히면 상대가 휘청해요.
                </li>
                <li>
                  <b>Shift / J / E</b> — 📣 왕의 호령 (왕만, 왕관을 쓸 때마다 한 번): 반지름 {ROAR_R}m 안의 사람을 바깥으로 밀쳐내요. 가장자리 근처라면 떨어뜨릴 수도!
                </li>
              </ul>
            </div>
            <div>
              <h3 className={H3}>휴대폰</h3>
              <ul className={LIST}>
                <li>화면 왼쪽을 끌어 이동 (가상 조이스틱)</li>
                <li>오른쪽 아래 💨 버튼 = 돌진, 👑 버튼 = 호령 (왕일 때만 밝아져요)</li>
                <li>버튼 둘레의 원이 다 차면 다시 쓸 수 있어요</li>
              </ul>
            </div>
          </section>
        )}

        {tab === "crown" && (
          <section className="flex flex-col gap-3">
            <p className="break-keep text-white/70 light:text-slate-600">왕관이 두 사람 사이를 계속 오가지 않도록 세 가지 장치가 있어요.</p>
            <ul className={LIST}>
              <li>
                <b>🛡 새 왕 무적</b> — 왕관을 받은 직후 {sec(INVULN_MS)} 동안은 뺏기지 않아요. 왕관 둘레의 금빛 원이 줄어드는 게 남은 시간이에요.
              </li>
              <li>
                <b>✋ 복수 금지</b> — 방금 뺏긴 사람은 {sec(REVENGE_MS)} 동안 그 왕관을 다시 뺏을 수 없어요 (이름표에 ✋ 표시). 다른 사람은 바로 뺏을 수 있어요.
              </li>
              <li>
                <b>🪨 무거운 왕관</b> — 왕관을 오래 쓸수록 {sec(WEIGHT_STEP_MS)}마다 {pct(WEIGHT_PER_STEP)}씩 느려져요 (최대 {pct(WEIGHT_MAX)}). 뺏기면 다시 가벼워져요.
              </li>
              <li>
                <b>🐢 꼴찌 보정</b> — 점수가 가장 낮은 사람(왕 제외)은 {pct(UNDERDOG_BONUS)} 빨라요.
              </li>
            </ul>
            <div>
              <h3 className={H3}>세부 판정</h3>
              <ul className={LIST}>
                <li>몸끼리 닿으면 “만진 것”이에요. 공중(점프대 비행)·떨어지는 중·다시 나타난 직후 반투명일 땐 뺏지도 뺏기지도 않아요.</li>
                <li>두 사람이 같은 순간 닿으면 더 가까운 사람, 거리까지 같으면 점수가 낮은 사람, 그래도 같으면 자리 번호가 앞인 사람이 가져가요.</li>
                <li>인터넷 지연 보정: 왕이 {LAG_COMP_MS}ms 안에 있던 자리를 만져도 인정해요 (쫓는 쪽 유리). 왕관이 넘어가는 연출은 방장이 확정한 뒤에 나와요.</li>
                <li>
                  왕이 광장 밖으로 떨어지거나 연결이 끊기면 왕관은 그 근처 바닥에 떨어져요. 떨어뜨린 사람은 {sec(CROWN_DROP_BAN_MS)} 동안 못 주워요.
                </li>
              </ul>
            </div>
          </section>
        )}

        {tab === "arena" && (
          <section className="flex flex-col gap-3">
            <ul className={LIST}>
              <li>
                <b>광장 크기</b>는 인원수에 따라 달라요: 2~3명 반지름 8.5m · 4~5명 10.5m · 6~8명 12.5m. 배치는 원점 대칭이라 어느 자리도 유리하지 않아요.
              </li>
              <li>
                <b>🏛 기둥</b> — 지나갈 수 없어요. 왕은 기둥을 끼고 빙빙 돌며 버틸 수 있어요.
              </li>
              <li>
                <b>🌳 덤불</b> — 지나갈 수 있고, 안에 들어가면 이름표가 숨어요. 매복하기 좋아요. 단, 왕관 빛은 덤불 밖으로 새어 나와요.
              </li>
              <li>
                <b>🌀 점프대</b> — 밟으면 짝꿍 점프대 쪽으로 붕 날아가요. 나는 동안은 뺏지도 뺏기지도 않아요. 한 사람이 다시 쓰려면 {sec(PAD_CD_MS)} 기다려야 해요.
              </li>
              <li>
                <b>☁️ 가장자리</b> — 밖으로 나가면 구름 아래로 떨어지고 {sec(RESPAWN_MS)} 뒤 다른 사람과 먼 곳에 다시 나타나요. 밀어서 떨어뜨리면 기록(💥)에 남아요.
              </li>
            </ul>
          </section>
        )}

        {tab === "items" && (
          <section className="flex flex-col gap-3">
            <p className="break-keep text-white/70 light:text-slate-600">아이템을 켜면 시작 10초 뒤부터 약 13초마다 하나씩(최대 2개) 나타나고, 12초 뒤 사라져요. 지나가면 바로 써져요.</p>
            <ul className={LIST}>
              {ITEM_KINDS.map((k) => (
                <li key={k}>
                  <b>
                    {ITEM_INFO[k].emoji} {ITEM_INFO[k].name}
                  </b>{" "}
                  — {ITEM_INFO[k].desc}
                </li>
              ))}
            </ul>
            <ul className={LIST}>
              <li>🍌 껍질을 놓은 사람도 1.5초 뒤부터는 밟으면 미끄러져요. 미끄러지면 {sec(BANANA_SLIP_MS)} 동안 조작할 수 없어요.</li>
              <li>
                🧲 자석은 {sec(MAGNET_MS)} 동안 손이 {MAGNET_REACH}m 더 닿아요. 저주 모드에선 왕이 떠넘길 때 써요.
              </li>
              <li>🎭 가짜 왕관은 {sec(FAKE_MS)} 동안 진짜와 똑같이 보여요. 가짜를 쓴 사람을 만져도 아무 일 없어요. 저주 모드에선 나오지 않아요.</li>
            </ul>
          </section>
        )}

        {tab === "modes" && (
          <section className="flex flex-col gap-3">
            <div>
              <h3 className={H3}>👑 개인전 (기본)</h3>
              <p className="break-keep text-white/70 light:text-slate-600">왕관을 가장 오래 쓴 사람이 우승.</p>
            </div>
            <div>
              <h3 className={H3}>⚔️ 팀전 ({TEAM_MIN_PLAYERS}명 이상)</h3>
              <ul className={LIST}>
                <li>
                  자리 번호 홀짝으로 {TEAM_INFO[0].symbol} {TEAM_INFO[0].name}과 {TEAM_INFO[1].symbol} {TEAM_INFO[1].name}으로 나뉘어요. 이름표에 팀 기호가 붙어요.
                </li>
                <li>우리 팀이 왕이면 팀원은 왕관을 뺏지 않아요. 몸으로 막아 주는 경호가 핵심이에요. 호령도 팀원은 밀지 않아요.</li>
                <li>팀원이 쓴 시간을 합산해요. 인원이 적은 팀은 점수에 배수가 붙어요 (예: 3대2면 2명 팀 ×1.5).</li>
                <li>이긴 팀 모두 1등. 점수가 같으면 끝날 때 왕관을 쓴 팀이 이겨요.</li>
              </ul>
            </div>
            <div>
              <h3 className={H3}>💀 저주의 왕관</h3>
              <ul className={LIST}>
                <li>왕관이 저주예요! 쓰고 있는 동안 저주가 쌓이고, 저주가 가장 적은 사람이 우승해요.</li>
                <li>시작 {sec(CROWN_DROP_MS)} 뒤 무작위 한 사람에게 저주가 내려앉아요. 저주받은 왕이 다른 사람을 만지면 떠넘겨요.</li>
                <li>
                  받은 직후 {sec(INVULN_MS)}는 못 떠넘기고, 준 사람에게는 {sec(REVENGE_MS)} 동안 못 돌려줘요. 저주를 오래 쓸수록 {pct(CURSE_HASTE_PER_STEP)}씩 빨라져요 (최대 {pct(CURSE_HASTE_MAX)}).
                </li>
                <li>
                  왕의 기술은 💀 저주의 손길 — 반지름 {SNARE_R}m 안 사람을 {sec(SNARE_MS)} 동안 {pct(SNARE_SLOW)} 느리게 해요. 떨어져도 저주는 그대로예요.
                </li>
              </ul>
            </div>
          </section>
        )}

        {tab === "score" && (
          <section className="flex flex-col gap-3">
            <ul className={LIST}>
              <li>점수 = 왕관을 쓴 시간(초, 소수 한 자리). 황금 왕관 구간은 {GOLDEN_MULT}배.</li>
              <li>개인전 동점: 끝날 때 왕관을 쓴 사람 → 마지막으로 왕관을 쓴 시각이 늦은 사람 → 뺏은 횟수 → 그래도 같으면 같은 등수.</li>
              <li>저주 동점: 끝날 때 저주를 안 쓴 사람 → 저주를 덜 떠안은 사람 → 그래도 같으면 같은 등수.</li>
              <li>나간 사람은 10초 뒤 AI가 대신 뛰고, 돌아오면 돌려받아요. 방장이 나가면 남은 사람이 판을 이어받아요.</li>
            </ul>
          </section>
        )}
      </div>
    </Overlay>
  );
}
