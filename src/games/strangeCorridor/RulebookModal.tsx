"use client";

import { useState } from "react";
import Overlay from "@/components/Overlay";
import { BASE_POINTS, LOOK_MS, REVEAL_MS, SPEED_POINTS, STREAK_CAP, STREAK_STEP, STUDY_MS } from "./engine";

const H3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";
const LIST = "list-disc space-y-1.5 pl-4 text-white/70 light:text-slate-600";

type Tab = "basic" | "round" | "anomaly" | "score" | "controls";
const TABS: { id: Tab; label: string }[] = [
  { id: "basic", label: "🚪 기본" },
  { id: "round", label: "⏱️ 라운드" },
  { id: "anomaly", label: "🚨 이상 현상" },
  { id: "score", label: "🧮 점수" },
  { id: "controls", label: "🎮 조작" },
];

/** 게임 중 📖 버튼 — boardGameRule/이상한복도/이상한복도.md 의 앱 적용판. */
export default function RulebookModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("basic");
  return (
    <Overlay title="📖 이상한 복도 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-4 text-sm text-white/80 light:text-slate-700">
        <div className="flex flex-wrap gap-1.5" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-full border px-3 py-1 text-xs font-bold ${tab === t.id ? "border-emerald-400 bg-emerald-500/20 text-emerald-100 light:text-emerald-800" : "border-white/15 text-white/60 light:border-slate-300 light:text-slate-600"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "basic" && (
          <section>
            <h3 className={H3}>목표</h3>
            <p className="break-keep text-white/70 light:text-slate-600">
              한밤의 같은 복도를 몇 번이고 걸어요. 처음엔 <b>평범한 복도</b>를 외우고, 그다음부터는 걸을 때마다 복도가 그대로일 수도, <b>딱 한 곳</b>이 이상해져 있을 수도 있어요. 모두 동시에 답해요 — 이상한 곳을 직접 누르거나, &ldquo;이상 없음&rdquo;. 빨리, 연달아 맞힐수록 점수가 커요. 1~8명, 혼자서도 OK.
            </p>
          </section>
        )}

        {tab === "round" && (
          <section>
            <h3 className={H3}>라운드 진행</h3>
            <ul className={LIST}>
              <li>
                <b>기억하기</b>({STUDY_MS / 1000}초): 이상이 없는 원래 복도. 모두 &ldquo;다 외웠어요&rdquo;를 누르면 바로 시작해요.
              </li>
              <li>
                <b>복도 걷기</b>({LOOK_MS / 1000}초 × 8 또는 12번): 카메라가 천천히 복도를 걸어 들어가요. 모두 답하거나 시간이 끝나면 정답 공개.
              </li>
              <li>
                <b>정답 공개</b>({REVEAL_MS / 1000}초): 바뀐 곳이 빨갛게 깜빡이고, 누가 맞혔는지 보여줘요.
              </li>
              <li>이상한 복도는 약 65%. 평범한 복도는 한 판에 최소 2번 나오고, 3번 연속으로는 나오지 않아요.</li>
            </ul>
          </section>
        )}

        {tab === "anomaly" && (
          <section>
            <h3 className={H3}>이상 현상의 종류</h3>
            <ul className={LIST}>
              <li>사라짐 · 색 바뀜 · 커짐 · 그림/글자 바뀜(문 번호, 그림, 포스터, 창밖, 비상구 표지) · 원래 없던 것(손자국, 발자국, 사람 그림자)</li>
              <li>
                <b>어려움</b>에서만: 자리가 옮겨짐 · 기울어짐.
              </li>
              <li>사라진 것을 고르려면 <b>그게 있던 자리</b>를 누르세요.</li>
              <li>🫣 공포 연출(방 설정)을 끄면 사람 그림자가 나오지 않고, 틀려도 화면이 붉게 깜빡이지 않아요.</li>
              <li>뒤로 갈수록 불이 어두워지고 한 등이 깜빡여요 — 깜빡임 자체는 이상 현상이 아니에요.</li>
            </ul>
          </section>
        )}

        {tab === "score" && (
          <section>
            <h3 className={H3}>점수</h3>
            <ul className={LIST}>
              <li>
                맞히면 {BASE_POINTS}점 + 속도 보너스(바로 답하면 {SPEED_POINTS}, 시간이 다 되면 0) + 연속 보너스(앞서 연달아 맞힌 수 × {STREAK_STEP}, 최대 {STREAK_CAP}).
              </li>
              <li>틀리거나 시간 안에 답하지 못하면 0점, 연속 기록이 끊겨요.</li>
              <li>최종 점수가 높은 순, 같으면 맞힌 수가 많은 순.</li>
            </ul>
          </section>
        )}

        {tab === "controls" && (
          <section>
            <h3 className={H3}>조작</h3>
            <ul className={LIST}>
              <li>🧊 3D: 드래그로 둘러보기, 눌러서 고르기 → &ldquo;🚨 여기가 이상해요&rdquo;로 확정. 🖼️ 2D 원근 그림으로도 같은 복도를 볼 수 있어요.</li>
              <li>키보드: N = 이상 없음, Enter = 고른 곳으로 확정.</li>
              <li>자리는 색 + 모양(●◆▲■★✚⬟✦)으로 구분해요. 소리로 알리는 정답·오답은 화면 문구로도 나와요.</li>
            </ul>
          </section>
        )}
      </div>
    </Overlay>
  );
}
