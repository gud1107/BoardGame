"use client";

/** In-game rules for 묘수 도장 — mirrors boardGameRule/묘수도장/묘수도장.md. */
export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-3" onClick={onClose} role="dialog" aria-modal="true" aria-label="묘수 도장 규칙">
      <div className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-emerald-800/60 bg-stone-900 p-5 text-sm text-stone-200" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-black text-emerald-300">📖 묘수 도장 규칙</h2>
          <button onClick={onClose} className="rounded-lg bg-stone-800 px-3 py-1" aria-label="닫기">✕</button>
        </div>
        <Section title="🧩 공통">
          혼자 푸는 묘수풀이 모음이에요. 모든 문제는 기존 게임(체스·당구 파티·알까기 대전·컬링 파티·도미노 연쇄)의 규칙과 물리를 그대로 써요. 정답이 반드시 있고, 같은 수는 언제나 같은 결과가 나와요. 각 장의 첫 문제는 열려 있고, 문제를 깨면 다음 문제가 열려요.
        </Section>
        <Section title="⭐ 별">
          문제마다 별 조건이 3단계로 적혀 있어요. 앞 단계를 모두 지켜야 다음 별을 받아요. 🔑 정답 보기를 쓰면 그 문제 기록은 ⭐ 1개까지만 남아요(이미 받은 별은 그대로).
        </Section>
        <Section title="♟️ 체스 N수 메이트">
          백 차례. 흑이 어떻게 막아도 N수 안에 체크메이트하세요. 흑은 가장 오래 버티는 수로 자동 응수해요. 틀린 수를 두면 흑이 빠져나가는 수를 보여 주고, ↶ 그 수 무르기로 돌아갈 수 있어요(실수 1번). 스테일메이트는 무승부라 실패예요. ⭐ 메이트 · ⭐⭐ 실수 1번 이하 · ⭐⭐⭐ 실수·힌트 없이.
        </Section>
        <Section title="🎱 당구 한 큐">
          큐는 한 번. 판을 끌어 방향을 정하고, 힘과 당점(↕ 밀어치기/끌어치기, ↔ 좌우 회전)을 고른 뒤 치세요. 흰 실선은 처음 맞는 곳까지, 노란 점선은 맞은 공이 굴러갈 방향이에요. 포켓볼 장은 구멍 있는 테이블, 캐롬 장은 구멍이 없고 쿠션 횟수를 세요.
        </Section>
        <Section title="🥏 알까기">
          흰 알 하나를 골라(여러 개면 눌러서 선택) 한 번 튕겨요. 중심이 판 밖으로 나간 알은 떨어져요. 왕(王)은 3배 무겁고 잘 미끄러지지 않아요.
        </Section>
        <Section title="🥌 컬링 마지막 스톤">
          빨강의 마지막 스톤이에요. 브룸 위치(겨냥점), 세기, 회전(휘는 방향)만 정해 던지고 스위핑은 없어요. 빨간 점선은 다른 스톤이 없을 때의 길이에요. 던진 뒤 단추에 가장 가까운 팀이, 상대 스톤보다 가까운 자기 스톤 수만큼 점수를 얻어요.
        </Section>
        <Section title="🁢 도미노 설계">
          빈칸 아무 곳에나 8방향 중 하나로 도미노를 세우세요(세운 조각을 누르면 45° 회전). ▶ 와르르를 누르면 빨간 밀대가 쓰러지며 연쇄가 시작돼요. 🔔 종은 울리고 같은 방향으로 계속 넘어가고, 💣 폭탄은 주변 8칸을 한꺼번에 쓰러뜨리고, 🪨 바위는 막아요. ⑂ 갈림 도미노는 앞쪽 두 대각선으로 쓰러져요. 하늘색 칸은 지금 연쇄가 닿는 곳이에요. ⭐ 종 모두 · ⭐⭐ 최소+2개 이하 · ⭐⭐⭐ 최소 개수(솔버가 증명한 최솟값).
        </Section>
        <Section title="⌨️ 조작">
          물리 문제: 판 끌기 = 방향 · ←→ 방향(또는 브룸) · ↑↓ 힘 · Shift = 크게 · Space 실행/다시 · R 다시. 미세 조정 버튼(‹ ›)은 0.1° 단위예요.
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="mb-0.5 font-black text-emerald-200">{title}</div>
      <div className="leading-relaxed text-stone-300">{children}</div>
    </div>
  );
}
