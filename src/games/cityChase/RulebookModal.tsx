"use client";

import Overlay from "@/components/Overlay";

const box = "rounded-xl border border-white/10 bg-white/5 p-3 light:border-slate-200 light:bg-white light:shadow-sm";
const h3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";

export default function CityChaseRulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="🚓 시티 체이스 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80 light:text-slate-700">
        <section>
          <p className="text-white/70 light:text-slate-600">
            1명의 <b>도둑</b>과 1~3명의 <b>경찰 팀</b>이 벌이는 1 대 다 비대칭 숨바꼭질. 도둑은 5×5 도시의 건물 밑에 차를 숨겨 달아나고,
            경찰은 헬리콥터 3대로 건물을 들어 올려 차를 찾습니다.
          </p>
        </section>

        <section>
          <h3 className={h3}>승리 조건</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className={box}>🚓 <b>경찰</b> — 11라운드가 끝나기 전 어느 헬기든 도둑의 차를 찾거나, 도둑이 더 이동할 곳이 없으면 즉시 승리</div>
            <div className={box}>🦹 <b>도둑</b> — 11라운드(빨간 토큰) 경찰 수색까지 버텨내면 승리</div>
          </div>
        </section>

        <section>
          <h3 className={h3}>① 도둑의 턴 — 경찰은 볼 수 없어요</h3>
          <div className={box}>
            <ul className="list-disc space-y-1 pl-4 text-xs text-white/70 light:text-slate-600">
              <li>1라운드: 원하는 건물 1개 밑에 차와 <span className="font-semibold text-yellow-300 light:text-yellow-600">노란 토큰</span>을 숨깁니다. 이때 판 위엔 아직 헬기가 없어요.</li>
              <li>2~11라운드: <b>상·하·좌·우로 붙은 건물</b>로만 이동 (대각선 불가, 제자리 불가 — 매 라운드 반드시 이동).</li>
              <li>떠난 건물에는 그 라운드의 흔적 토큰이 남습니다 (2~5·7~10라운드 <span className="font-semibold text-cyan-300 light:text-cyan-600">파랑</span>, 6라운드 <span className="font-semibold text-purple-300 light:text-purple-600">보라</span>, 11라운드 <span className="font-semibold text-red-300 light:text-red-600">빨강</span>).</li>
              <li><b>한 번 지나간 건물로는 다시 돌아갈 수 없습니다.</b> 막다른 곳에 몰려 더 이동할 수 없으면 그 즉시 경찰 승리!</li>
            </ul>
          </div>
        </section>

        <section>
          <h3 className={h3}>② 경찰의 턴 — 헬기 3대가 각각 한 번씩</h3>
          <div className={`${box} mb-2`}>
            <p className="mb-1 font-medium text-white light:text-slate-900">🚁 1라운드: 헬기 배치</p>
            <p className="text-xs text-white/60 light:text-slate-600">
              도둑이 숨고 나면 경찰이 헬기 3대를 원하는 교차로에 1대씩 놓습니다 (같은 교차로에 겹칠 수 없음). 1라운드 경찰 턴은 배치로 끝나고, 수색은 2라운드부터입니다.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className={box}>
              <p className="mb-1 font-medium text-white light:text-slate-900">↗ 이동</p>
              <p className="text-xs text-white/60 light:text-slate-600">도로를 따라 붙어 있는 교차로로 1칸 이동합니다.</p>
            </div>
            <div className={box}>
              <p className="mb-1 font-medium text-white light:text-slate-900">🔍 수색</p>
              <p className="text-xs text-white/60 light:text-slate-600">
                헬기가 선 교차로에 맞닿은 건물(최대 4개) 중 1개를 들어 올립니다. 빈 건물 / 흔적 토큰(도둑이 지나감) / 🚗 차 발견(즉시 승리).
              </p>
            </div>
          </div>
          <p className="mt-2 text-xs text-white/50 light:text-slate-500">
            경찰이 여러 명이면 헬기를 나눠 조종합니다 (2명: 1·3번 / 2번, 3명: 1대씩). 헬기는 건물 위가 아니라 항상 교차로(건물 모서리)에 섭니다.
          </p>
        </section>

        <section>
          <h3 className={h3}>이 앱에서의 진행</h3>
          <ul className="list-disc space-y-1 pl-4 text-xs text-white/60 light:text-slate-500">
            <li>경찰 화면에는 도둑의 차와 토큰이 보이지 않고, 지금까지의 수색 결과만 건물 배지로 남습니다 (✕ = 빈 건물, 색 점 = 발견한 흔적).</li>
            <li>원작 룰북은 되돌아가기를 허용하지만, 이 앱은 하우스룰로 재방문을 막습니다.</li>
            <li>🗺️ 수사 지도: 지금까지의 수색 기록만으로 계산한 &ldquo;차가 있을 확률&rdquo;을 건물마다 보여주는 보조 기능 (켜고 끌 수 있음).</li>
            <li>파란 빛이 도는 건물 = 지금 헬기가 수색할 수 있는 감시 구역.</li>
            <li>원작은 헬기가 정해진 시작 교차로에서 출발하지만, 이 앱은 도둑이 먼저 숨은 뒤 경찰이 헬기 위치를 직접 고르는 하우스룰을 씁니다.</li>
          </ul>
        </section>
      </div>
    </Overlay>
  );
}
