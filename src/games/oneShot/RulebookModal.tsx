"use client";

/** In-game rules for 한 발의 묘수 — mirrors boardGameRule/한발의묘수/한발의묘수.md. */
export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-3" onClick={onClose} role="dialog" aria-modal="true" aria-label="한 발의 묘수 규칙">
      <div className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-amber-800/60 bg-stone-900 p-5 text-sm text-stone-200" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-black text-amber-300">📖 한 발의 묘수 규칙</h2>
          <button onClick={onClose} className="rounded-lg bg-stone-800 px-3 py-1" aria-label="닫기">✕</button>
        </div>
        <Section title="🎯 목표">모든 표적(빨강·흰색 동심원)을 맞히세요. 장면은 매번 똑같이 움직이니 정답이 반드시 있어요. 인질(파란 사람 모양, 점선 원)은 맞히면 즉시 실패예요.</Section>
        <Section title="🔍 관찰 → 사격">
          관찰 모드에서 시간을 멈추고 되감으며 패턴을 읽으세요. 조준선은 처음 부딪히는 곳까지만 보여요. 철판에서 튕긴 다음 경로는 직접 계산해야 해요.
        </Section>
        <Section title="🧩 연습 / 🔥 실전">
          <b>연습</b>: 타임라인의 원하는 순간에 사격을 예약하고 ▶ 실행으로 확인해요. <b>실전</b>: 3·2·1 뒤 장면이 실시간으로 흐르고, 그 순간에 직접 방아쇠를 당겨요. ⭐⭐⭐은 실전에서만 받을 수 있어요.
        </Section>
        <Section title="🔫 총알의 성질">
          총알은 날아가는 데 시간이 걸려요(움직이는 표적은 미리 겨누기). 표적과 인질은 뚫고 지나가요. 철판에서는 튕기고, 나무 벽에서는 멈춰요. 밧줄을 끊으면 무게추가 떨어지거나 흔들리던 방향으로 날아가요. 화약통은 주변을 날려 버리고 옆 화약통도 터뜨려요.
        </Section>
        <Section title="⭐ 평가">
          ⭐ 클리어 · ⭐⭐ 기준 탄수 이하 · ⭐⭐⭐ 실전에서 기준 탄수 이하(정답 고스트를 안 본 경우) · 💎 묘수: 기준보다 적은 숨은 정답을 찾으면.
        </Section>
        <Section title="💡 힌트 3단계">① 쓰는 장치 ② 쏴야 할 시간대(타임라인 노란 구간) ③ 정답 고스트(하늘색 점선, 이 스테이지는 ⭐⭐까지).</Section>
        <Section title="⌨️ 조작">
          마우스로 가리켜 조준 · ↑↓(W/S) 조준, Shift로 미세 조정 · ←→ 시간 이동 · P 재생/정지 · Space 예약/발사/시작 · R 다시. 터치는 화면을 위아래로 끌어 조준하고 버튼으로 쏴요.
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="mb-0.5 font-black text-amber-200">{title}</div>
      <div className="leading-relaxed text-stone-300">{children}</div>
    </div>
  );
}
