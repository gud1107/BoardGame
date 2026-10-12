"use client";

import Overlay from "@/components/Overlay";
import { MAX_PENDING_PER_ROUND, MAX_WORDS_PER_ROUND } from "./engine";
import { TOPICS } from "./words";

const H3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";
const LIST = "list-disc space-y-1.5 pl-4 text-white/70 light:text-slate-600";

/** 게임 중 📖 버튼 — 전체 룰북(boardGameRule/단어마천루/단어마천루.md)의 앱 적용판 요약. */
export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="📖 단어 마천루 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80 light:text-slate-700">
        <section>
          <h3 className={H3}>목표</h3>
          <p className="break-keep text-white/70 light:text-slate-600">
            주제가 공개되면 모두 <b>동시에</b> 그 주제의 단어를 입력해 <b>자기 탑</b>을 쌓아요. 라운드가 끝났을 때 <b>가장 높은 탑</b>이 1등(🏆)! 속도 경쟁이 아니라서 같은 단어를 여러 명이 써도 모두 인정돼요.
          </p>
        </section>

        <section>
          <h3 className={H3}>한 라운드</h3>
          <ol className="list-decimal space-y-1.5 pl-4 text-white/70 light:text-slate-600">
            <li><b>📣 주제 공개</b> (3초)</li>
            <li><b>🏗️ 쌓기</b> (방장 설정 45/60/90초) — 단어를 하나씩 입력하고 엔터. <b>남의 단어는 안 보이고</b> 탑 높이만 보여요.</li>
            <li><b>🗳️ 심사</b> (최대 25초) — 사전에 없는 단어가 있을 때만. 다른 사람들이 ✅/❌로 결정해요.</li>
            <li><b>🏆 결과</b> — 모든 단어 공개, 순위 발표.</li>
          </ol>
        </section>

        <section>
          <h3 className={H3}>층 계산</h3>
          <ul className={LIST}>
            <li>단어 하나 = <b>글자 수만큼 층, 최대 4층</b> (배 1층 · 사과 2층 · 복숭아 3층 · 파인애플 4층).</li>
            <li>띄어쓰기·문장부호는 지우고 판정해요. 한글 1~8글자만.</li>
            <li>이번 판에 <b>내가 이미 쓴 단어</b>는 다시 못 써요. 한 라운드 최대 {MAX_WORDS_PER_ROUND}개.</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>사전에 없는 단어 — 심사 투표</h3>
          <ul className={LIST}>
            <li>사전에 없으면 반투명한 <b>보류 층</b>으로 올라가요(라운드당 {MAX_PENDING_PER_ROUND}개까지).</li>
            <li>낸 사람을 뺀 <b>사람 플레이어</b>가 투표해요. AI 봇은 기권.</li>
            <li><b>인정 표가 거절 표보다 많으면 인정</b>. 동점이거나 아무도 투표하지 않으면 거절.</li>
            <li>거절되면 그 층이 무너지고 <b>벌점 −1층</b>. 그래서 봇만 있는 판에선 사전 단어로 승부하세요.</li>
            <li>모두 투표를 마치면 25초를 기다리지 않고 바로 결과로 넘어가요.</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>순위 · 승리</h3>
          <ul className={LIST}>
            <li>라운드 순위: 높이 → 거절 적은 사람 → 단어 많은 사람 → 그래도 같으면 <b>공동 1등</b>(모두 🏆). 높이 0은 1등 불가.</li>
            <li>최종 순위: <b>🏆 개수</b> → 전체 누적 층수.</li>
            <li>라운드 1등을 연속으로 하면 🔥연승 — 최고 연승은 전적에 남아요.</li>
          </ul>
        </section>

        <section className="rounded-xl border border-amber-300/20 bg-amber-400/5 p-3 light:border-amber-300 light:bg-amber-50">
          <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-amber-200/90 uppercase light:text-amber-800">🎯 정답 모으기 버전 (방 만들 때 선택)</h3>
          <ul className="list-disc space-y-1.5 pl-4 text-xs text-white/70 light:text-slate-700">
            <li>정답이 <b>4~10개로 정해진 주제</b> — 계절(봄·여름·가을·겨울), 요일, 태양계 행성, 무지개 색…</li>
            <li><b>모두의 답이 실시간 공개</b> — 아래 &quot;📢 실시간 기록&quot;에 누가 무엇을 냈는지 다 보여요.</li>
            <li>정답은 <b>선착순</b> — 먼저 낸 한 사람만 차지(<b>2층</b>). 이미 차지된 정답은 못 내요. 오답은 <b>−1층</b>(심사 없음).</li>
            <li>다른 표기도 정답(월=월요일, 녹색=초록). 정답이 모두 차지되면 시간이 남아도 라운드 끝.</li>
            <li>혼자 정답을 전부 차지하면 <b>🧹 싹쓸이 +3층</b>.</li>
          </ul>
        </section>

        <section className="rounded-xl border border-sky-300/20 bg-sky-400/5 p-3 light:border-sky-300 light:bg-sky-50">
          <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-sky-200/90 uppercase light:text-sky-800">🏗️ 자유 쌓기 주제 {TOPICS.length}개 (라운드마다 겹치지 않게 무작위)</h3>
          <p className="break-keep text-xs leading-relaxed text-white/70 light:text-slate-700">{TOPICS.map((t) => `${t.emoji} ${t.name}`).join(" · ")}</p>
          <p className="mt-1.5 break-keep text-[11px] text-white/50 light:text-slate-500">🐾 동물은 새·바다 생물·곤충 단어도 인정해요.</p>
        </section>
      </div>
    </Overlay>
  );
}
