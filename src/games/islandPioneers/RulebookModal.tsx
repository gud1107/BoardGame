"use client";

import Overlay from "@/components/Overlay";
import { COMPLETE_POINTS, DECK_SIZE, QUEST_FIRST, QUEST_LATER, QUESTS, SET_BONUS, SETTLERS, TURN_MS } from "./engine";
import { RESOURCE_EMOJI, RESOURCE_NAMES, TERRAIN_EMOJI, TERRAIN_NAMES, TILE_DEFS } from "./tiles";
import { SEAT_COLORS, SEAT_NAMES, SEAT_SHAPES, TERRAIN_FILL, TERRAIN_GLYPH, TileCard } from "./TileArt";

const H3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 light:text-slate-500 uppercase";
const EM = "text-emerald-300 light:text-emerald-700";

const find = (pattern: string, withRes = false) =>
  Math.max(
    1,
    TILE_DEFS.findIndex((t, i) => i > 0 && (t.res >= 0) === withRes && t.q.map((x) => "FMRS"[x]).join("") === pattern),
  );

function Example({ tile, rot = 0, caption }: { tile: number; rot?: number; caption: string }) {
  return (
    <div className="flex w-[92px] flex-col items-center gap-1 text-center">
      <TileCard tile={tile} rot={rot} size={64} />
      <span className="text-[11px] leading-tight text-white/55 light:text-slate-500">{caption}</span>
    </div>
  );
}

export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="🏝️ 섬 개척자 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80 light:text-slate-700">
        <section>
          <p className="text-white/70 light:text-slate-600">
            바다 한가운데 🏕️ 상륙 캠프에서 시작해, 지형 타일을 한 장씩 이어 붙여 <span className={EM}>섬을 함께 넓혀요</span>. 내 🚩 개척자를 세운 숲·초원·산·석호가 완성되면 점수와
            자원을 얻어요. 항구의 타일이 모두 떨어지면 끝 — 점수가 가장 높은 사람이 우승! 2~5인, 약 15~30분.
          </p>
        </section>

        <section>
          <h3 className={H3}>1. 타일 읽기</h3>
          <p>
            타일은 모서리에서 모서리로 <b>4개의 삼각형</b>(북·동·남·서)으로 나뉘고, 삼각형마다 지형이 하나씩 있어요. 타일의 각 변 = 그 변 쪽 삼각형의 지형이에요.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {TERRAIN_NAMES.map((n, t) => (
              <span key={n} className="flex items-center gap-1 rounded-full border border-white/10 px-2 py-0.5 text-xs light:border-slate-200">
                <span className="inline-block h-3 w-3 rounded-sm" style={{ background: TERRAIN_FILL[t] }} />
                {TERRAIN_EMOJI[t]} {n} <span className="opacity-60">무늬 {TERRAIN_GLYPH[t]}</span>
              </span>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-3">
            <Example tile={find("FFFF")} caption="온통 숲" />
            <Example tile={find("FFMM")} caption="숲 반·초원 반" />
            <Example tile={find("FMFM")} caption="마주 보는 숲은 따로따로" />
            <Example tile={find("SSSF", true)} caption="자원 아이콘이 있는 타일" />
          </div>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>한 타일 안에서 <b>이웃한 두 삼각형</b>(북–동, 동–남…)이 같은 지형이면 이어진 땅이에요. 마주 보는 삼각형(북–남)은 사이에 같은 지형이 없으면 따로예요.</li>
            <li>지형마다 무늬(♣ 〃 ▲ ≈)가 달라서 색을 구분하기 어려워도 읽을 수 있어요.</li>
            <li>
              일부 타일엔 자원 아이콘이 하나 있어요: {RESOURCE_NAMES.map((n, k) => `${RESOURCE_EMOJI[k]} ${n}(${TERRAIN_NAMES[k]})`).join(" · ")}
            </li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>2. 준비</h3>
          <ul className="list-disc space-y-1 pl-5">
            <li>🏕️ 상륙 캠프(숲·초원·바다·산 네 지형)를 가운데에 놓아요. 섬은 11×11 칸 안에서만 자라요.</li>
            <li>
              타일 더미를 섞어 인원에 맞게 써요 — 2인 {DECK_SIZE[2]} · 3인 {DECK_SIZE[3]} · 4인 {DECK_SIZE[4]} · 5인 {DECK_SIZE[5]}장. 3장을 앞면으로 펼쳐 🛶 항구를 만들어요.
            </li>
            <li>
              각자 🚩 개척자 {SETTLERS}명. 색마다 모양이 달라요:{" "}
              {SEAT_NAMES.map((n, i) => (
                <span key={n} style={{ color: SEAT_COLORS[i] }} className="drop-shadow-[0_0_1px_#000]">
                  {SEAT_SHAPES[i]}
                  {n}{" "}
                </span>
              ))}
            </li>
            <li>📜 개척 의뢰 8장 중 3장을 무작위로 공개해요. 첫 차례는 무작위.</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>3. 내 차례</h3>
          <ol className="list-decimal space-y-1.5 pl-5">
            <li>
              <b>고르기</b> — 🛶 항구의 앞면 타일 3장 중 하나를 골라요.
            </li>
            <li>
              <b>놓기</b> — 이미 놓인 타일 옆 빈칸에, 마음대로 돌려서 놓아요. <span className={EM}>맞닿는 모든 변의 지형이 같아야</span> 해요(대각선은 상관없음).
            </li>
            <li>
              <b>자원 줍기</b> — 놓은 타일에 자원 아이콘이 있으면 그 자원 1개를 바로 받아요.
            </li>
            <li>
              <b>개척자 세우기(선택)</b> — 방금 놓은 타일의 땅(또는 바다) 하나에 내 개척자 1명을 세울 수 있어요. 단, 그 땅과 이어진 지역에 <b>이미 누구의 개척자도 없어야</b> 해요.
            </li>
            <li>
              <b>완성 점수</b> → 항구를 3장으로 채우고 다음 사람 차례.
            </li>
          </ol>
          <p className="mt-2 text-xs text-white/50 light:text-slate-500">
            따로 차지한 두 지역이 나중에 타일 하나로 합쳐질 수도 있어요 — 그러면 한 지역에 여러 사람의 개척자가 함께 있게 돼요. 남의 땅에 끼어드는 유일한 방법!
          </p>
        </section>

        <section>
          <h3 className={H3}>4. 지역 완성</h3>
          <ul className="list-disc space-y-1 pl-5">
            <li>같은 지형으로 이어진 삼각형 묶음 = 지역. 지역의 바깥 변이 모두 다른 지형(또는 같은 지역)에 막히면 <b>완성</b>이에요.</li>
            <li>
              바다는 <b>🏝️ 석호</b>가 될 수 있어요: 육지에 완전히 둘러싸여 먼바다(지도 끝)와 안 이어진 바다만 완성돼요.
            </li>
            <li>
              완성되면 그 지역에 개척자가 <b>가장 많은 사람</b>이 점수를 받아요(동점이면 모두 받음): 🌲 숲 · 🌾 초원 칸당 {COMPLETE_POINTS[0]}점, ⛰️ 산 · 🏝️ 석호 칸당{" "}
              {COMPLETE_POINTS[2]}점 (지역이 걸친 타일 수로 셈).
            </li>
            <li>점수를 받는 사람은 지역 안의 자원 아이콘도 모두 한 번 더 받아요.</li>
            <li>완성된 지역의 개척자는 모두 주인에게 돌아가 다시 쓸 수 있어요.</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>5. 📜 개척 의뢰</h3>
          <p>
            게임마다 3장 공개. 조건을 <b>처음 이룬 사람 +{QUEST_FIRST}</b>, 그 뒤에 이룬 사람은 각 +{QUEST_LATER} (한 사람당 한 번). 같은 차례에 여럿이 처음 이루면 모두 +{QUEST_FIRST}.
          </p>
          <ul className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2">
            {QUESTS.map((q) => (
              <li key={q.id} className="text-xs">
                {q.emoji} <b>{q.name}</b> — {q.desc}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className={H3}>6. 떠내려가는 타일 · 게임 끝</h3>
          <ul className="list-disc space-y-1 pl-5">
            <li>🌊 항구의 타일이 섬 어디에도 놓일 수 없으면 떠내려가고(버림) 더미에서 새로 채워요.</li>
            <li>더미와 항구가 모두 비면 게임 끝. 마지막 점수:</li>
            <li className="ml-4 list-none">• 완성 못 한 지역: 개척자 다수인 사람이 타일 칸당 1점 (그 지역의 자원은 못 받음)</li>
            <li className="ml-4 list-none">• 자원 1개당 1점 + 🪵🐑💎🐟 4종 한 벌마다 +{SET_BONUS}점</li>
            <li>합계가 가장 높은 사람이 우승. 동점이면 자원이 많은 사람, 그래도 같으면 공동 순위.</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>7. 조작 방법</h3>
          <ul className="list-disc space-y-1 pl-5">
            <li>항구 타일을 누르고(키보드 1·2·3) → 지도의 빛나는 칸을 누르면 그 자리에 맞게 돌아간 미리보기가 놓여요.</li>
            <li>⟳ 돌리기(R) / ⟲ 왼쪽(E)으로 그 칸에서 맞는 방향만 돌아가며 보여 줘요.</li>
            <li>미리보기 위의 🚩 칸을 누르면 개척자를 세우고, 다시 누르면 취소. ✔ 놓기(Enter)로 확정, ↩ 취소(Esc).</li>
            <li>놓기 전에 &quot;이렇게 놓으면 몇 점&quot;이 화면에 미리 나와요. 지도의 땅에 마우스를 올리면 그 지역 정보(칸 수·열린 변·주인)가 보여요.</li>
            <li>한 차례 {TURN_MS / 1000}초 — 시간이 끝나면 놓을 수 있는 첫 타일이 자동으로 놓여요(개척자 없이). 오래 응답이 없으면 투표로 AI가 대신 맡아요.</li>
            <li>🧊 3D로 보면 섬이 자라는 모습을 둘러볼 수 있어요(조작은 아래 지도에서).</li>
          </ul>
        </section>
      </div>
    </Overlay>
  );
}
