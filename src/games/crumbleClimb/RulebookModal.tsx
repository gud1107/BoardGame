"use client";

import { useState } from "react";
import Overlay from "@/components/Overlay";
import {
  CAUGHT_DEPTH,
  COLLAPSE_DELAY_MS,
  COLLAPSE_WARN_H,
  CRUMBLE_MS,
  FINAL_CALL_MUL,
  FINISH_PTS,
  ITEM_INFO,
  ITEM_KINDS,
  RESPAWN_MS,
  ROCK_WARN_MS,
  SAB_GAP,
  SAB_GHOST_MS,
  SAB_INFO,
  SAB_KINDS,
  SAB_LAST_MS,
  SAB_PICK_MS,
  SEAT_COLOR_NAMES,
  SEAT_SYMBOLS,
  SHOVE_CD_MS,
  SHOVE_R,
  TOWER_H,
} from "./data";

const H3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";
const LIST = "list-disc space-y-1.5 pl-4 text-white/70 light:text-slate-600";

type Tab = "basic" | "controls" | "tower" | "collapse" | "sabotage" | "items" | "score";
const TABS: { id: Tab; label: string }[] = [
  { id: "basic", label: "🧱 기본" },
  { id: "controls", label: "🎮 조작" },
  { id: "tower", label: "🪜 발판" },
  { id: "collapse", label: "💨 붕괴" },
  { id: "sabotage", label: "🪨 방해 카드" },
  { id: "items", label: "🪶 아이템" },
  { id: "score", label: "🧮 점수" },
];

/** 게임 중 📖 버튼 — 전체 룰북(boardGameRule/무너지는탑오르기/무너지는탑오르기.md)의 앱 적용판 요약. */
export default function RulebookModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("basic");
  const s = (ms: number) => `${ms / 1000}초`;
  return (
    <Overlay title="📖 무너지는 탑 오르기 룰북" onClose={onClose} wide>
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
                가운데 돌기둥을 나선으로 감고 오르는 탑을 <b>누가 먼저 꼭대기 👑 왕관 발판까지</b> 오르나 겨루는 실시간 레이스예요(높이 약 {TOWER_H}m). 탑은 <b>아래부터 무너져 올라와요</b> — 붕괴에 휩쓸리면 그 라운드는 끝. 라운드마다 먼저 오른 순서대로 점수를 받고, 모든 라운드가 끝났을 때 점수가 가장 높은 사람이 우승해요.
              </p>
            </section>
            <section>
              <h3 className={H3}>한 라운드의 흐름</h3>
              <ol className="list-decimal space-y-1.5 pl-4 text-white/70 light:text-slate-600">
                <li>라운드마다 <b>새 탑</b>이 솟아요. 모두 바닥 원판에서, 첫 발판까지 똑같은 거리에서 출발해요.</li>
                <li>점프로 발판을 하나씩 건너 올라가요. 본길 발판은 언제나 보통 점프로 닿게 놓여 있고, 옆에 샛길이 붙어 있어요.</li>
                <li>
                  출발 {s(COLLAPSE_DELAY_MS)} 뒤부터 <b>붕괴선</b>이 바닥부터 올라와요. 갈수록 빨라져요.
                </li>
                <li>
                  누군가 꼭대기에 오르면 <b>🏁 붕괴가 {FINAL_CALL_MUL}배 빨라져요</b> — 남은 사람은 서둘러요!
                </li>
                <li>모두 오르거나 휩쓸리면 라운드 끝.</li>
              </ol>
            </section>
            <section>
              <h3 className={H3}>자리 구분</h3>
              <p className="text-white/70 light:text-slate-600">
                자리마다 색과 모양이 함께 있어요 — {SEAT_SYMBOLS.map((sym, i) => `${sym} ${SEAT_COLOR_NAMES[i]}`).join(" · ")}. 헬멧·발밑 고리·등 깃발이 자리 색이고, 이름표와 오른쪽 <b>높이 막대</b>엔 모양 기호가 붙어요.
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
                  이동: <b>WASD</b>/<b>방향키</b> — 카메라가 늘 기둥 바깥에서 나를 보니 <b>←→ = 탑 둘레를 돌기</b>, <b>↑ = 기둥 쪽 · ↓ = 바깥쪽</b>이에요.
                </li>
                <li>
                  ⤴ 점프: <b>Space</b>/<b>K</b> — 약 1.7m까지 뛰어요. 발판 끝에서 살짝 떨어진 직후에도(0.1초) 뛸 수 있고, 착지 직전에 미리 눌러 둬도 돼요.
                </li>
                <li>
                  👊 밀치기: <b>Shift</b>·<b>J</b>·<b>E</b> — 바라보는 쪽 {SHOVE_R}m 안, 비슷한 높이의 사람을 밀어 휘청이게 해요. 재사용 {s(SHOVE_CD_MS)}
                </li>
                <li>🧱 방해 카드: <b>1~3</b> 키 (카드가 왔을 때)</li>
              </ul>
            </section>
            <section>
              <h3 className={H3}>휴대폰</h3>
              <ul className={LIST}>
                <li>화면 왼쪽 아래 아무 데나 손가락을 대고 끌면 조이스틱이 나타나요.</li>
                <li>오른쪽 아래: 큰 ⤴ 점프 · 👊 밀치기(둘레 원이 다 차면 다시 쓸 수 있어요).</li>
                <li>⛶ 크게 버튼으로 전체화면, ⚙️에서 3D/2D 보기·화질을 바꿀 수 있어요. 2D는 탑 둘레를 펼친 옆모습이에요.</li>
              </ul>
            </section>
          </>
        )}

        {tab === "tower" && (
          <section>
            <h3 className={H3}>발판 종류 (색 + 무늬로 구분)</h3>
            <ul className={LIST}>
              <li>
                🪨 <b>돌 발판</b>(베이지 원판) — 평범한 발판.
              </li>
              <li>
                🟫 <b>금 간 발판</b>(갈색 각진 원판 + 금 무늬, 2D: 톱니) — 처음 밟히고 {s(CRUMBLE_MS)} 뒤 무너져요. {s(RESPAWN_MS)} 뒤 다시 생겨요. 남이 먼저 밟은 금 간 발판엔 조심!
              </li>
              <li>
                🟩 <b>트램펄린</b>(초록 + 흰 고리 + 아래 스프링, 2D: ⬆) — 밟으면 약 2.9m 튕겨 올라요. 지름길!
              </li>
              <li>
                🟦 <b>움직이는 발판</b>(파랑 + 화살표, 2D: ↔) — 탑 둘레를 좌우로 오가요. 위에 서 있으면 같이 실려 가요.
              </li>
              <li>
                👑 <b>왕관 발판</b>(금색, 꼭대기) — 닿으면 등정!
              </li>
              <li>발판은 아래에서 위로 뚫고 올라갈 수 있어요(머리를 부딪치지 않아요). 기둥은 못 뚫어요. 바닥 원판엔 낮은 울타리가 있어 바닥이 무너지기 전까지는 밖으로 떨어지지 않아요.</li>
            </ul>
          </section>
        )}

        {tab === "collapse" && (
          <section>
            <h3 className={H3}>💨 붕괴</h3>
            <ul className={LIST}>
              <li>
                출발 {s(COLLAPSE_DELAY_MS)} 뒤 붕괴선이 바닥부터 올라와요. 처음엔 천천히, 갈수록 빨라져요(대략 40~50초면 꼭대기 근처).
              </li>
              <li>
                붕괴선보다 <b>{COLLAPSE_WARN_H}m 위</b>까지의 발판은 빨갛게 흔들리며 경고해요(2D: 빨간 테두리 + 점선). 붕괴선 아래 발판은 영영 사라져요.
              </li>
              <li>
                붕괴선보다 {CAUGHT_DEPTH}m 아래로 떨어지면 <b>휩쓸림</b> — 그 라운드는 끝이에요(점수 0). 대신 🧱 방해 카드를 받아요.
              </li>
              <li>내 발밑이 붕괴선에 가까워지면 화면에 경고 글자·경고음이 나오고 캐릭터 무릎이 덜덜 떨려요.</li>
              <li>🏁 첫 등정자가 나오면 붕괴가 {FINAL_CALL_MUL}배로 빨라져요. 왕관 발판은 무너지지 않아요.</li>
            </ul>
          </section>
        )}

        {tab === "sabotage" && (
          <section>
            <h3 className={H3}>🧱 방해 카드 (방 설정에서 끌 수 있어요)</h3>
            <ul className={LIST}>
              <li>
                <b>받는 사람</b>: 붕괴에 휩쓸린 사람({s(SAB_GHOST_MS)}마다 한 장), 그리고 아직 오르는 중인 <b>꼴찌</b> — 선두보다 {SAB_GAP}m 이상 낮을 때만({s(SAB_LAST_MS)}마다). 출발 10초 뒤부터.
              </li>
              <li>
                카드 4종 중 3장이 나오고 하나를 골라요({s(SAB_PICK_MS)} 안에 안 고르면 무작위). 과녁은 <b>쓰는 순간 가장 높이 있는 사람</b>(나 빼고)이에요.
              </li>
              {SAB_KINDS.map((k) => (
                <li key={k}>
                  {SAB_INFO[k].emoji} <b>{SAB_INFO[k].name}</b> — {SAB_INFO[k].desc}
                  {k === "rocks" && ` (바닥에 빨간 경고 원이 ${s(ROCK_WARN_MS)} 보여요)`}
                </li>
              ))}
              <li>과녁이 되면 화면에 경고 배너와 경고음이 나와요. 🛡 방패가 있으면 낙석·돌풍·밀치기를 한 번 막아요.</li>
            </ul>
          </section>
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
              <li>5.5초마다 하나씩(최대 3개) 발판 위에 떠요 — 주로 <b>뒤처진 사람 근처(아래쪽 절반)</b>에. 15초 뒤 사라져요(3초 전부터 깜빡임). 발판에 올라 지나가면 주워요.</li>
            </ul>
          </section>
        )}

        {tab === "score" && (
          <section>
            <h3 className={H3}>점수 · 순위</h3>
            <ul className={LIST}>
              <li>
                라운드마다 등정 순서대로 <b>{FINISH_PTS.map((p, i) => `${i + 1}등 +${p}`).join(" · ")}</b>. 못 오르면 0점.
              </li>
              <li>모든 라운드가 끝나면 점수 → 라운드 1등 등정 횟수 → 라운드마다 가장 높이 오른 높이의 합 순서로 순위를 정해요. 그래도 같으면 같은 등수.</li>
              <li>방장이 나가도 다른 사람이 판을 이어받고, 나간 자리는 AI가 대신 올라요(다시 들어오면 돌려받아요).</li>
            </ul>
          </section>
        )}
      </div>
    </Overlay>
  );
}
