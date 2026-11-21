"use client";

import { useState } from "react";
import Overlay from "@/components/Overlay";
import {
  BOMB_BASKET_LOSS,
  BOMB_FUSE_MAX,
  BOMB_FUSE_MIN,
  BOMB_HASTE,
  BOMB_RESPAWN_MS,
  BOMB_REVEAL_MS,
  BOMB_REVENGE_MS,
  BOMB_SHIELD_MS,
  CUT_BOOST,
  CUT_BOOST_MS,
  CUT_CD_MS,
  DASH_CD_MS,
  DEPOSIT_MS,
  EVENT_EVERY_MS,
  EVENT_FIRST_MS,
  EVENT_INFO,
  GOAL_BONUS,
  GOAL_INFO,
  GOAL_KINDS,
  LAG_COMP_MS,
  LOOT_CD_MS,
  MAX_CHAIN,
  REVENGE_MS,
  SALE_MS,
  SALE_MS_DUEL,
  SET_RAINBOW_BONUS,
  SET_TRIPLE_BONUS,
  SHIELD_MS,
  SNATCH_CD_MS,
  SNATCH_SHIELD_MS,
  TEAM_INFO,
  TEAM_MIN_PLAYERS,
  TOY_INFO,
  UNDERDOG_BONUS,
  UNDERDOG_SAFE,
  WEIGHT_MAX,
  WEIGHT_PER,
  type ToyKind,
} from "./data";

const H3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";
const LIST = "list-disc space-y-1.5 pl-4 text-white/70 light:text-slate-600";

type Tab = "basic" | "controls" | "chain" | "basket" | "shop" | "modes" | "score";
const TABS: { id: Tab; label: string }[] = [
  { id: "basic", label: "🖐️ 기본" },
  { id: "controls", label: "🎮 조작" },
  { id: "chain", label: "🚂 줄 규칙" },
  { id: "basket", label: "🧺 바구니·세트" },
  { id: "shop", label: "📢 방송·목표" },
  { id: "modes", label: "🤝 모드" },
  { id: "score", label: "🧮 점수·동점" },
];

const sec = (ms: number) => `${ms / 1000}초`;
const pct = (v: number) => `${Math.round(v * 100)}%`;

/** 게임 중 📖 버튼 — 전체 룰북(boardGameRule/만지면내꺼/만지면내꺼.md)의 앱 적용판 요약. */
export default function RulebookModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("basic");
  return (
    <Overlay title="📖 만지면 내 꺼! 룰북" onClose={onClose} wide>
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
                문 닫기 직전 장난감 백화점의 둥근 홀. <b>바닥의 물건을 만지면 내 꺼</b> — 내 뒤에 줄줄이 매달려요. 홀 둘레의 <b>🧺 내 바구니</b>에 들어가야 점수가 돼요. 경기가 끝났을 때 바구니(+ 보너스) 점수가 가장 높은 사람이 우승. <b>줄에 매달린 채 끝난 물건은 0점</b>이에요.
              </p>
            </section>
            <section>
              <h3 className={H3}>물건</h3>
              <ul className={LIST}>
                {(Object.keys(TOY_INFO) as ToyKind[]).map((k) => (
                  <li key={k}>
                    {TOY_INFO[k].emoji} {TOY_INFO[k].name} — 값 <b>{TOY_INFO[k].value}</b>
                    {k === "gift" && " · 줄에 1개만"}
                    {k === "trophy" && ` · 🔥 마감 세일 때 가운데에 1개 · 줄에 1개만 · 무게 ${TOY_INFO.trophy.weight}`}
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h3 className={H3}>한 판</h3>
              <ul className={LIST}>
                <li>카운트다운 4초 뒤 시작 · 120 / 150 / 180초 (기본 150초)</li>
                <li>바닥 물건이 처음의 30% 아래로 줄면 8초마다 지붕 틈에서 2개씩 떨어져요 (바닥 그림자로 1.5초 예고)</li>
                <li>
                  🔥 <b>마감 세일</b>: 마지막 {sec(SALE_MS)}(2명이면 {sec(SALE_MS_DUEL)}) — 🏆 황금 트로피가 떨어지고, <b>남의 바구니 맨 위 1개를 털 수 있어요</b>
                </li>
              </ul>
            </section>
          </>
        )}

        {tab === "controls" && (
          <section>
            <h3 className={H3}>조작</h3>
            <ul className={LIST}>
              <li>이동: WASD / 방향키 (휴대폰: 왼쪽 아래를 끌기)</li>
              <li>💨 돌진: Space / K — 짧게 튀어나가요 ({sec(DASH_CD_MS)}마다). 돌진 중엔 바닥 물건은 줍지만 <b>남의 줄은 못 가로채요</b>. 돌진으로 부딪힌 사람은 잠깐 휘청</li>
              <li>
                ✂️ 줄 끊기: Shift / J / E — 내 줄 <b>뒤쪽 절반</b>을 그 자리에 버리고 {sec(CUT_BOOST_MS)} 동안 +{pct(CUT_BOOST)} 빨라져요 ({sec(CUT_CD_MS)}마다). 버린 물건은 1초 동안 아무도 못 주워요
              </li>
              <li>🤝 팀전: 팀원 몸에 닿은 채 Shift → 내 줄을 통째로 팀원에게 넘겨요</li>
              <li>사람끼리 부딪히면 밀리지만 사람을 만져서 뺏는 건 없어요 — 오직 물건만!</li>
            </ul>
          </section>
        )}

        {tab === "chain" && (
          <section>
            <h3 className={H3}>🚂 줄 규칙</h3>
            <ul className={LIST}>
              <li>만진 물건은 내 줄 맨 끝에 붙고, 내가 지나간 길을 따라와요. 최대 {MAX_CHAIN}개</li>
              <li>
                🐢 무게: 줄의 무게 합 × {pct(WEIGHT_PER)}만큼 느려져요 (최대 {pct(WEIGHT_MAX)}) — 비쌀수록 무거워요
              </li>
              <li>
                ✂️ <b>가로채기</b>: 남의 줄 <b>k번째</b> 물건을 만지면 <b>k번째부터 끝까지 전부</b> 내 줄 끝으로! 앞쪽은 원래 주인에게 남아요
              </li>
              <li>✊ 몸 바로 뒤 첫 번째 물건은 손에 꼭 쥐고 있어서 못 뺏어요</li>
              <li>
                🛡 갓 찜 보호: 막 주운 물건 {sec(SHIELD_MS)} · 막 가로챈 물건 {sec(SNATCH_SHIELD_MS)} 동안 못 뺏어요 (흰 고리 깜빡임)
              </li>
              <li>🤲 손이 무거움: 가로챈 사람은 {sec(SNATCH_CD_MS)} 동안 다시 가로챌 수 없어요 (바닥 줍기는 돼요)</li>
              <li>✋ 되찜 금지: 방금 내 줄을 가져간 사람의 줄은 {sec(REVENGE_MS)} 동안 못 건드려요 (다른 사람은 바로 돼요)</li>
              <li>🧺 내 바구니 안에 서 있는 동안엔 내 줄을 아무도 못 건드려요</li>
              <li>
                🐣 꼴찌 보호: 점수가 혼자 가장 낮은 사람은 줄 앞 {UNDERDOG_SAFE}개가 안전하고, 바구니도 안 털리고, +{pct(UNDERDOG_BONUS)} 빨라요
              </li>
              <li>동시에 같은 물건: 가까운 사람 → 점수가 낮은 사람 → 자리 번호 앞. 같은 줄을 동시에 만지면 더 앞 칸을 만진 사람이 먼저</li>
              <li>핑 보정: 방장이 물건의 {LAG_COMP_MS}ms 전 위치까지 봐 줘요</li>
            </ul>
          </section>
        )}

        {tab === "basket" && (
          <>
            <section>
              <h3 className={H3}>🧺 바구니</h3>
              <ul className={LIST}>
                <li>내 바구니 원 안에 들어가면 줄 앞에서부터 {sec(DEPOSIT_MS)}마다 하나씩 넣어요 — 바구니 밖으로 나가면 멈춰요</li>
                <li>넣은 물건은 안전해요 (🔥 마감 세일 때 맨 위 1개만 빼고)</li>
                <li>
                  🔥 마감 세일: 남의 바구니 가장자리에 닿으면 <b>맨 위 1개</b>를 내 줄로 가져와요. 털린 바구니는 {sec(LOOT_CD_MS)} 동안 다시 못 털어요. <b>주인이 바구니 안에 서 있으면 못 털어요</b>
                </li>
              </ul>
            </section>
            <section>
              <h3 className={H3}>🌈 세트 보너스 (한 번에 넣을 때)</h3>
              <ul className={LIST}>
                <li>바구니에 들어가서 나오기 전까지가 &lsquo;한 번&rsquo;이에요</li>
                <li>
                  같은 종류 3개 (🧦🧦🧦 · 🦆🦆🦆 · 🤖🤖🤖 · 🎁는 줄에 1개라 불가) → <b>+{SET_TRIPLE_BONUS}</b>
                </li>
                <li>
                  🧦🦆🤖🎁 4종 모두 → 🌈 <b>+{SET_RAINBOW_BONUS}</b>
                </li>
              </ul>
            </section>
          </>
        )}

        {tab === "shop" && (
          <>
            <section>
              <h3 className={H3}>📢 점장 방송 (옵션, 기본 켜짐)</h3>
              <p className="mb-2 text-white/60 light:text-slate-500">
                시작 {sec(EVENT_FIRST_MS)} 뒤부터 {sec(EVENT_EVERY_MS)}마다 하나 (같은 방송 연속 없음, 마감 세일 직전엔 없음)
              </p>
              <ul className={LIST}>
                <li>
                  {EVENT_INFO.timeSale.emoji} {EVENT_INFO.timeSale.name} ({sec(EVENT_INFO.timeSale.ms)}): 🧦·🦆·🤖 중 한 종류를 넣으면 값 2배
                </li>
                <li>
                  {EVENT_INFO.rain.emoji} {EVENT_INFO.rain.name}: 지붕 틈에서 물건 6개가 우수수
                </li>
                <li>
                  {EVENT_INFO.wet.emoji} {EVENT_INFO.wet.name} ({sec(EVENT_INFO.wet.ms)}): 바닥이 미끄러워 잘 안 서요
                </li>
              </ul>
            </section>
            <section>
              <h3 className={H3}>🎖 보너스 목표 (옵션, 기본 켜짐)</h3>
              <p className="mb-2 text-white/60 light:text-slate-500">시작 때 아래에서 2개를 뽑아 모두에게 보여 줘요. 끝났을 때 달성한 사람(동점이면 모두) +{GOAL_BONUS}</p>
              <ul className={LIST}>
                {GOAL_KINDS.map((g) => (
                  <li key={g}>
                    {GOAL_INFO[g].emoji} {GOAL_INFO[g].name} — {GOAL_INFO[g].desc}
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}

        {tab === "modes" && (
          <>
            <section>
              <h3 className={H3}>🤝 팀전 ({TEAM_MIN_PLAYERS}명 이상)</h3>
              <ul className={LIST}>
                <li>
                  자리 번호 짝수 = {TEAM_INFO[0].symbol} {TEAM_INFO[0].name}, 홀수 = {TEAM_INFO[1].symbol} {TEAM_INFO[1].name}. 팀 바구니는 하나 (마주보는 두 곳)
                </li>
                <li>팀원 줄은 안 가로채요 · 팀원에게 닿은 채 Shift로 줄을 통째로 넘겨요 (운반병 · 수집병)</li>
                <li>인원이 적은 팀은 점수 배수 (큰 팀 ÷ 작은 팀)</li>
              </ul>
            </section>
            <section>
              <h3 className={H3}>💣 폭탄 세일</h3>
              <ul className={LIST}>
                <li>개인전 규칙 + 째깍 폭탄 (4명까지 1개, 5명부터 2개). 시작 6초 뒤 <b>1등(동점이면 무작위)</b>에게 떨어져요</li>
                <li>
                  폭탄을 든 사람이 <b>다른 사람 몸</b>을 만지면 떠넘겨요. 받은 직후 {sec(BOMB_SHIELD_MS)}는 못 넘기고, 준 사람에게는 {sec(BOMB_REVENGE_MS)} 동안 못 돌려줘요. 폭탄을 든 사람은 +{pct(BOMB_HASTE)} 빨라요
                </li>
                <li>
                  터지는 시간은 {sec(BOMB_FUSE_MIN)}~{sec(BOMB_FUSE_MAX)} 사이 비밀 — 마지막 {sec(BOMB_REVEAL_MS)}만 숫자로 보여요 (네트워크로도 미리 안 보내요)
                </li>
                <li>
                  💥 터지면: 줄이 전부 흩어지고 바구니 맨 위 {BOMB_BASKET_LOSS}개가 날아가 바구니 앞에 떨어져요 (누구나 주울 수 있음). {sec(BOMB_RESPAWN_MS)} 뒤 새 폭탄이 다시 1등에게
                </li>
              </ul>
            </section>
          </>
        )}

        {tab === "score" && (
          <section>
            <h3 className={H3}>점수 · 순위 · 동점</h3>
            <ul className={LIST}>
              <li>점수 = 바구니 물건 값 합 + 세트 보너스 + 타임세일 덤 + 🎖 목표</li>
              <li>줄 위 물건은 0점 (끝나기 직전 &lsquo;넣을까 말까&rsquo;가 마지막 승부!)</li>
              <li>개인전 동점: 바구니 물건 개수가 적은 사람(비싼 걸 넣은 사람) → 가로챈 값이 큰 사람 → 같은 등수</li>
              <li>팀전 동점: 트로피를 넣은 팀 → 바구니 물건이 적은 팀 → 무승부</li>
              <li>사람이 나가면 10초 뒤 AI가 대신(🤖대신), 돌아오면 돌려받아요. 방장이 나가면 다른 사람이 판을 이어받아요</li>
            </ul>
          </section>
        )}
      </div>
    </Overlay>
  );
}
