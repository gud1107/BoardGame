"use client";

import { useState } from "react";
import Overlay from "@/components/Overlay";
import {
  COMEBACK_GAP,
  CREDIT_MS,
  FIGHT_MAX_MS,
  ICE_DRAIN,
  ITEM_INFO,
  ITEM_KINDS,
  JUMP_CD_MS,
  KNOCK_R,
  PTS_DRAW,
  PTS_FISH,
  PTS_KO,
  PTS_PLACE,
  REFREEZE,
  SEAT_COLOR_NAMES,
  SEAT_SYMBOLS,
  STOMP_CD_MS,
  STOMP_R,
  SUDDEN_MS,
  SUDDEN_RING_MS,
  THAW_DAMAGE,
  THAW_WARN_MS,
} from "./data";

const H3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";
const LIST = "list-disc space-y-1.5 pl-4 text-white/70 light:text-slate-600";

type Tab = "basic" | "controls" | "ice" | "thaw" | "score" | "items" | "ghost";
const TABS: { id: Tab; label: string }[] = [
  { id: "basic", label: "🧊 기본" },
  { id: "controls", label: "🎮 조작" },
  { id: "ice", label: "❄️ 얼음" },
  { id: "thaw", label: "☀️ 해빙" },
  { id: "score", label: "🧮 점수" },
  { id: "items", label: "🐟 아이템" },
  { id: "ghost", label: "👻 유령" },
];

/** 게임 중 📖 버튼 — 전체 룰북(boardGameRule/살얼음파티/살얼음파티.md)의 앱 적용판 요약. */
export default function RulebookModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("basic");
  const s = (ms: number) => `${ms / 1000}초`;
  return (
    <Overlay title="📖 살얼음 파티 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-4 text-sm text-white/80 light:text-slate-700">
        <div className="flex flex-wrap gap-1.5" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-full border px-3 py-1 text-xs font-bold ${tab === t.id ? "border-sky-400 bg-sky-500/20 text-sky-100 light:text-sky-800" : "border-white/15 text-white/60 light:border-slate-300 light:text-slate-600"}`}
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
                얼어붙은 호수 위, <b>오래 서 있으면 금이 가는 얼음판</b>에서 마지막까지 물에 빠지지 않고 버티는 실시간 서바이벌이에요. 라운드마다 <b>늦게 빠질수록, 남을 많이 빠뜨릴수록</b> 점수를 얻고, 모든 라운드가 끝났을 때 점수가 가장 높은 사람이 우승해요.
              </p>
            </section>
            <section>
              <h3 className={H3}>한 라운드의 흐름</h3>
              <ol className="list-decimal space-y-1.5 pl-4 text-white/70 light:text-slate-600">
                <li>모두 호수 가운데 둘레에서 시작해요 (라운드마다 자리가 섞여요).</li>
                <li>얼음은 <b>내가 서 있는 동안</b> 깎여요 — 한 칸에 혼자 약 2초면 깨져요. 계속 움직이세요!</li>
                <li>몇 초마다 <b>☀️ 해빙 경보</b>가 한 구역을 비추고, {s(THAW_WARN_MS)} 뒤 그 구역 얼음이 크게 녹아요.</li>
                <li>
                  {s(SUDDEN_MS)}가 지나면 <b>⚠️ 서든데스</b> — 바깥 고리부터 {s(SUDDEN_RING_MS)}마다 한 고리씩 무너져요.
                </li>
                <li>마지막 한 명이 남으면 라운드 끝.</li>
              </ol>
            </section>
            <section>
              <h3 className={H3}>자리 구분</h3>
              <p className="text-white/70 light:text-slate-600">
                자리마다 색과 모양이 함께 있어요 — {SEAT_SYMBOLS.map((sym, i) => `${sym} ${SEAT_COLOR_NAMES[i]}`).join(" · ")}. 발밑 고리와 털모자도 자리 색이에요. 내 이름표엔 &ldquo;나&rdquo;와 아래 화살표가 붙어요.
              </p>
            </section>
          </>
        )}

        {tab === "controls" && (
          <>
            <section>
              <h3 className={H3}>키보드</h3>
              <ul className={LIST}>
                <li>
                  이동: <b>WASD</b> 또는 <b>방향키</b> — 얼음이라 미끄러워요. 손을 떼도 1m쯤 더 미끄러져요.
                </li>
                <li>
                  ⤴ 점프: <b>Space</b> 또는 <b>K</b> — 누르는 방향으로 뛰어올라 구멍 한 칸을 건너요. 떠 있는 동안은 얼음이 안 깎이지만, 내려앉을 때 살짝 금이 가요. 재사용 {s(JUMP_CD_MS)}
                </li>
                <li>
                  💥 내려찍기: <b>Shift</b>·<b>J</b>·<b>E</b> — 살짝 떠올랐다가 쿵! 반경 {STOMP_R}m 얼음에 금을 내고, {KNOCK_R}m 안의 사람을 밀쳐내요. 점프 중에 누르면 그 자리에서 바로 내리꽂아요. <b>내 발밑 칸이 가장 크게 깨지니</b> 조심! 재사용 {s(STOMP_CD_MS)}
                </li>
              </ul>
            </section>
            <section>
              <h3 className={H3}>휴대폰</h3>
              <ul className={LIST}>
                <li>화면 왼쪽 아래 아무 데나 손가락을 대고 끌면 조이스틱이 나타나요.</li>
                <li>오른쪽 아래: ⤴ 점프 · 큰 💥 내려찍기. 버튼 둘레의 원이 다 차면 다시 쓸 수 있어요.</li>
                <li>⛶ 크게 버튼으로 전체화면, ⚙️에서 3D/2D 보기·화질을 바꿀 수 있어요.</li>
              </ul>
            </section>
          </>
        )}

        {tab === "ice" && (
          <section>
            <h3 className={H3}>얼음 칸</h3>
            <ul className={LIST}>
              <li>
                호수 크기: 2명 61칸 · 3~4명 91칸 · 5~6명 127칸. 칸마다 얼음 두께가 있어요(멀쩡 = 100%).
              </li>
              <li>
                서 있는 사람 한 명당 초당 {Math.round(ICE_DRAIN * 100)}%씩 깎여요. <b>여럿이 한 칸에 몰리면 그만큼 빨리</b> 깨져요.
              </li>
              <li>
                <b>금 1단계</b>(66% 아래): 가는 금 무늬 · <b>금 2단계</b>(33% 아래): 굵은 금 + 움푹 + 덜덜 떨림. 2D 보기에선 선 하나 / X 표시. 내 발밑이 2단계면 화면에 경고 글자가 떠요.
              </li>
              <li>아무도 안 선 칸은 아주 천천히(초당 {Math.round(REFREEZE * 1000) / 10}%) 다시 얼어요. 깨진 칸은 다시 안 생겨요.</li>
              <li>몸 가운데가 깨진 칸이나 호수 밖으로 나가면 첨벙! 점프 중엔 구멍 위를 지날 수 있지만, 내려앉은 곳이 구멍이면 빠져요.</li>
            </ul>
          </section>
        )}

        {tab === "thaw" && (
          <section>
            <h3 className={H3}>☀️ 해빙 경보 · ⚠️ 서든데스</h3>
            <ul className={LIST}>
              <li>호수는 1~6번 <b>구역</b>(부채꼴)으로 나뉘어요. 가장자리에 번호가 떠 있어요. 가운데 칸은 어느 구역에도 속하지 않아요.</li>
              <li>
                싸움 시작 5초 뒤 첫 경보. 경보가 뜬 구역은 <b>주황빛으로 깜빡이고 햇살 기둥</b>이 내려와요(2D 보기: 빗금 + ☀). {s(THAW_WARN_MS)} 뒤 그 구역 모든 얼음이 {Math.round(THAW_DAMAGE * 100)}%씩 녹아요 — 이미 금 간 칸은 바로 깨져요.
              </li>
              <li>경보는 처음 8초마다, 갈수록 빨라져 5초마다 와요.</li>
              <li>
                {s(SUDDEN_MS)}엔 <b>서든데스</b>: 바깥 고리 칸들이 빨갛게 흔들리다(2D: !) 1~2초 뒤 깨지고, {s(SUDDEN_RING_MS)}마다 한 고리씩 안쪽으로 들어와요. 결국 가운데 칸까지 깨지니 언젠가는 끝나요.
              </li>
              <li>안전장치: {s(FIGHT_MAX_MS)}가 지나도 2명 이상 남으면 무승부(남은 사람 +{PTS_DRAW}).</li>
            </ul>
          </section>
        )}

        {tab === "score" && (
          <>
            <section>
              <h3 className={H3}>라운드 점수</h3>
              <ul className={LIST}>
                <li>
                  🏆 <b>생존 1등 +{PTS_PLACE[0]}</b> · 🥈 2등 +{PTS_PLACE[1]}(3명 이상) · 🥉 3등 +{PTS_PLACE[2]}(4명 이상) — 늦게 빠질수록 높은 등수
                </li>
                <li>
                  💥 <b>KO +{PTS_KO}</b>: 빠진 사람을 마지막으로 밀친 사람({s(CREDIT_MS)} 안 — 내려찍기나 세게 부딪히기). 혼자 빠지면 아무도 점수를 못 받아요.
                </li>
                <li>🐟 물고기 +{PTS_FISH} (아이템)</li>
                <li>🤝 마지막 사람들이 같은 순간 빠지면 그 사람들끼리 +{PTS_DRAW}씩</li>
              </ul>
            </section>
            <section>
              <h3 className={H3}>최종 순위 · 역전</h3>
              <ul className={LIST}>
                <li>점수 → 라운드 1등 횟수 → KO 수 → 버틴 시간 합. 그래도 같으면 같은 등수.</li>
                <li>
                  🥾 <b>꼴찌 보호</b>: 라운드가 시작될 때 1등보다 {COMEBACK_GAP}점 이상 뒤진 사람은 아이젠을 신고 시작해요.
                </li>
              </ul>
            </section>
          </>
        )}

        {tab === "items" && (
          <section>
            <h3 className={H3}>아이템 (방 설정에서 끌 수 있어요)</h3>
            <ul className={LIST}>
              {ITEM_KINDS.map((k) => (
                <li key={k}>
                  {ITEM_INFO[k].emoji} <b>{ITEM_INFO[k].name}</b> — {ITEM_INFO[k].desc}
                </li>
              ))}
              <li>7초마다 하나씩(최대 2개) 떠오르고, 12초 뒤 사라져요(3초 전부터 깜빡임). 위를 지나가기만 하면 주워요. 점프 중엔 못 주워요.</li>
            </ul>
          </section>
        )}

        {tab === "ghost" && (
          <section>
            <h3 className={H3}>👻 유령 (방 설정에서 끌 수 있어요)</h3>
            <ul className={LIST}>
              <li>빠진 사람은 유령이 되어 <b>다음 해빙 구역을 직접 골라요</b> — 화면 아래 6칸 육각판에서 번호를 누르면 돼요(키보드 1~6도 OK).</li>
              <li>다음 경보가 뜰 때 유령 표가 가장 많은 구역이 비춰져요. 동점이면 그중 무작위, 아무도 안 고르면 해님이 무작위로(바로 전 구역은 웬만하면 피함).</li>
              <li>경보가 뜨면 표는 비워지고, 다음 경보를 위해 다시 골라요. 누가 어디를 골랐는지는 모두에게 보여요.</li>
              <li>유령이 고른 해빙으로 누가 빠져도 점수는 없어요(기록에만 남아요) — 먼저 빠진 사람도 끝까지 판에 끼는 장치예요.</li>
              <li>봇 유령은 살아 있는 사람이 많은 구역, 특히 점수 1등이 있는 구역을 노려요.</li>
            </ul>
          </section>
        )}
      </div>
    </Overlay>
  );
}
