"use client";

import Overlay from "@/components/Overlay";
import { CRISIS_DAY, DAY_MS, DAYS, DECLARE_IDS, DECLARES, EVENTS, PLAN_MS, SEASONS, STRENGTH_IDS, STRENGTHS, TOKEN_IDS, TOKENS, TUNING } from "./engine";

const H3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 light:text-slate-500 uppercase";
const EM = "text-teal-300 light:text-teal-700";
const TABLE = "w-full border-collapse text-xs [&_td]:border [&_td]:border-white/10 light:[&_td]:border-slate-200 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-white/10 light:[&_th]:border-slate-200 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left";

export default function RulebookModal({ onClose }: { onClose: () => void }) {
  const start = TUNING.startBag;
  return (
    <Overlay title="🔥 작심삼일 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80 light:text-slate-700">
        <section>
          <p className="text-white/70 light:text-slate-600">
            매 시즌 결심을 하나 세우고, 하루하루 <span className={EM}>내 유혹 주머니</span>에서 토큰을 뽑으며 일주일을 버텨요. 독하게 결심할수록 보상은 크지만 <span className={EM}>3일차 고비</span>에
            무너지기도 쉬워요. &quot;여기서 타협할까, 끝까지 갈까?&quot; — {SEASONS}시즌 뒤 점수가 가장 높은 사람이 우승! 2~6인, 약 15~20분. 모두가 같은 날을 <b>동시에</b> 진행해요.
          </p>
        </section>

        <section>
          <h3 className={H3}>1. 유혹 주머니</h3>
          <p>
            처음 주머니: {TOKEN_IDS.filter((k) => start[k] > 0).map((k) => `${TOKENS[k].emoji}${TOKENS[k].name}(${TOKENS[k].value}점)×${start[k]}`).join(" · ")}. 뽑은 유혹 점수의 합이 <b>한계치(처음 {TUNING.startLimit})를 넘으면</b> 그 시즌 결심은 무너져요. 뽑은 토큰은 <b>다시 주머니에 넣어요</b> — 그래서 날마다 확률이 같고, 화면에 &quot;무너질 확률&quot;이 계산돼 나와요.
          </p>
        </section>

        <section>
          <h3 className={H3}>2. 시즌 시작 — 비밀로 고르고 동시에 공개 ({PLAN_MS / 1000}초)</h3>
          <table className={TABLE}>
            <thead>
              <tr>
                <th>① 강도</th>
                <th>성공 보상</th>
                <th>이번 시즌 주머니에 추가</th>
              </tr>
            </thead>
            <tbody>
              {STRENGTH_IDS.map((s) => (
                <tr key={s}>
                  <td>
                    {STRENGTHS[s].emoji} {STRENGTHS[s].name}
                  </td>
                  <td>{STRENGTHS[s].reward}점</td>
                  <td>{STRENGTHS[s].extra.length ? STRENGTHS[s].extra.map((t) => TOKENS[t].emoji).join(" ") : "없음"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className={`${TABLE} mt-2`}>
            <thead>
              <tr>
                <th>② 선언</th>
                <th>보상</th>
                <th>한계치</th>
                <th>무너지면</th>
                <th>타협하면</th>
              </tr>
            </thead>
            <tbody>
              {DECLARE_IDS.map((d) => (
                <tr key={d}>
                  <td>
                    {DECLARES[d].emoji} {DECLARES[d].name}
                  </td>
                  <td>×{DECLARES[d].mult} (올림)</td>
                  <td>{DECLARES[d].limit > 0 ? `+${DECLARES[d].limit} (부담 없음)` : DECLARES[d].limit < 0 ? `${DECLARES[d].limit} (시선 압박)` : "그대로"}</td>
                  <td>{DECLARES[d].penalty ? `−${DECLARES[d].penalty}점` : "0점"}</td>
                  <td>{DECLARES[d].facePenalty ? `체면 −${DECLARES[d].facePenalty}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2">
            ③ <b>걸기</b>(선택): 다른 한 명에게 👏 <b>응원</b>(그 사람이 성공하면 나 +{TUNING.cheerPay}, 그 사람은 이번 시즌 한계 +{TUNING.cheerLimit}, 응원은 여러 명이 해도 한계 +{TUNING.cheerCap}까지) 또는 🍿 <b>구경</b>(그 사람이 무너지면 나 +{TUNING.watchPay}). 누가 누구에게 걸었는지는 시즌이 끝나야 공개돼요. 응원받은 사람 수(👏)만 시작할 때 보여요.
          </p>
        </section>

        <section>
          <h3 className={H3}>3. 하루하루 (1~{DAYS}일차, 하루 {DAY_MS / 1000}초)</h3>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <b>✊ 버티기</b>: 토큰 1개를 뽑아요. <b>{CRISIS_DAY}일차는 고비</b> — 2개를 뽑아요.
            </li>
            <li>
              <b>🤝 타협</b>: 여기서 멈추고 버틴 날 하루에 0.5점(내림)을 받아요. 배율은 없고, 남에게 말했다면 체면 벌점이 붙어요.
            </li>
            <li>
              <b>🍰 치팅데이</b>(시즌에 한 번, 고비 날 제외): 오늘은 뽑지 않고 하루를 넘겨요. 대신 성공 보상 −{TUNING.cheatCost}.
            </li>
            <li>
              {DAYS}일차까지 무너지지 않으면 <b>성공</b> — 강도 보상 × 선언 배율!
            </li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>4. 시즌이 끝나면</h3>
          <ul className="list-disc space-y-1 pl-5">
            <li>✅ 성공: 😞 자책 토큰 1개를 털어내요. 자책이 없으면 💧 의지 +1 (최대 {TUNING.maxWill}개) — 습관이 돼요.</li>
            <li>🤝 타협: 주머니 그대로.</li>
            <li>
              💥 실패: 😞 자책(2점) 1개가 주머니에 영구로 들어와요. 대신 <b>📘 교훈</b> +1(최대 {TUNING.maxLessons}). 교훈은 다음에 &quot;이걸 뽑으면 무너지는&quot; 토큰이 나왔을 때 자동으로 써서 그 토큰을 주머니에 되돌려요.
            </li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>5. 시즌 이벤트 (시즌마다 하나, 1시즌은 늘 평온)</h3>
          <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {EVENTS.map((e) => (
              <li key={e.id}>
                {e.emoji} <b>{e.name}</b> — {e.desc}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className={H3}>6. 승리</h3>
          <p>
            {SEASONS}시즌 점수 합(결심 보상 + 걸기 수익 − 벌점)이 가장 높은 사람이 우승. 동점이면 성공한 시즌이 많은 사람. 시간이 다 되면 자동으로 🙂 가볍게 · 🤫 혼자, 하루 선택은 🤝 타협이 돼요.
          </p>
        </section>
      </div>
    </Overlay>
  );
}
