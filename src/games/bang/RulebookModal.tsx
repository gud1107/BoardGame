"use client";

import Overlay from "@/components/Overlay";

const ROLES = [
  {
    emoji: "⭐",
    name: "보안관 (공개)",
    desc: "게임 시작부터 모두에게 공개됩니다. 부보안관과 함께 무법자·배신자를 모두 없애면 승리합니다.",
  },
  {
    emoji: "🥈",
    name: "부보안관 (비공개, 5인 이상)",
    desc: "보안관 편이지만 정체는 숨깁니다. 제거되면 정체가 공개됩니다.",
  },
  {
    emoji: "🥷",
    name: "무법자 (비공개)",
    desc: "보안관을 제거하면 승리합니다. 무법자를 제거한 사람은 카드 3장을 보너스로 뽑습니다.",
  },
  {
    emoji: "🃏",
    name: "배신자 (비공개)",
    desc: "혼자 살아남으면 단독으로 승리합니다. 다른 모두가 죽어도 배신자 혼자 남아야만 승리해요.",
  },
];

const CARDS = [
  { emoji: "💥", name: "뱅!", desc: "사거리 내의 상대 1명을 조준합니다. 상대는 빗나감!을 내거나 체력 1을 잃습니다. 한 턴에 1장만 낼 수 있어요 (볼카닉 장착 시 제한 없음)." },
  { emoji: "🛡️", name: "빗나감!", desc: "뱅!이나 개틀링에 대한 방어 카드입니다." },
  { emoji: "🍺", name: "맥주", desc: "체력을 1 회복합니다 (생존자가 2명뿐일 때는 효과 없음)." },
  { emoji: "🍻", name: "선술집", desc: "생존한 모든 플레이어가 체력을 1씩 회복합니다." },
  { emoji: "🤠", name: "듀얼", desc: "상대 1명과 결투합니다. 번갈아 뱅!을 내다 먼저 못 내면 체력 1을 잃습니다 (거리 무관)." },
  { emoji: "🏹", name: "인디언!", desc: "나를 제외한 모두가 뱅!을 버리거나 체력 1을 잃습니다." },
  { emoji: "🔫", name: "개틀링", desc: "나를 제외한 모두에게 뱅!과 같은 효과 (거리 무관, 빗나감!으로 방어 가능)." },
  { emoji: "🏪", name: "종합 상점", desc: "생존자 수만큼 카드를 공개하고, 낸 사람부터 순서대로 한 장씩 가져갑니다." },
  { emoji: "🐎", name: "역마차", desc: "카드를 2장 더 뽑습니다." },
  { emoji: "🚂", name: "웰스파고", desc: "카드를 3장 더 뽑습니다." },
  { emoji: "😱", name: "패닉!", desc: "거리 1 이내의 상대에게서 카드 1장(패 또는 장비)을 빼앗습니다." },
  { emoji: "🐈", name: "고양이 발톱", desc: "거리 상관없이 상대의 카드 1장(패 또는 장비)을 버리게 합니다." },
  { emoji: "🔒", name: "감옥", desc: "보안관을 제외한 상대에게 씌웁니다. 다음 턴 시작 시 하트를 못 뽑으면 턴을 건너뜁니다." },
  { emoji: "🧨", name: "다이너마이트", desc: "자신에게 장착. 매 턴 시작 시 스페이드 2~9를 뽑으면 폭발(체력 3 손실), 아니면 다음 사람에게 넘어갑니다." },
  { emoji: "🔫", name: "무기 (볼카닉/스코필드/레밍턴/카빈/윈체스터)", desc: "사거리를 1~5로 정하는 장비 카드. 새로 장착하면 이전 무기는 버려집니다." },
  { emoji: "🛢️", name: "술통", desc: "뱅!·개틀링을 맞았을 때 카드를 뽑아 하트가 나오면 방어합니다." },
  { emoji: "🔭", name: "쌍안경", desc: "내가 상대를 조준할 때 거리가 1 가까워집니다." },
  { emoji: "🐎", name: "무스탕", desc: "상대가 나를 조준할 때 거리가 1 멀어집니다." },
];

export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="📖 뱅! 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80">
        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">역할과 승리 조건</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {ROLES.map((r) => (
              <div key={r.name} className="rounded-xl border border-white/10 bg-white/5 p-3">
                <p className="mb-1 font-medium text-white">
                  {r.emoji} {r.name}
                </p>
                <p className="text-xs text-white/60">{r.desc}</p>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-white/50">
            역할이 제거되면 즉시 정체가 공개됩니다. 배신자가 마지막 생존자라면 다른 조건보다{" "}
            <span className="text-amber-300">우선</span>해서 배신자 단독 승리로 처리됩니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">거리(Range)</h3>
          <p className="text-white/70">
            자리는 원탁으로 고정되며, 죽은 자리는 계산에서 제외되어 원이 좁혀집니다. 무기가 정하는
            사거리 이내의 상대만 뱅!으로 조준할 수 있습니다. 쌍안경은 내가 보는 거리를 1 줄이고,
            무스탕은 상대가 나를 보는 거리를 1 늘립니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">턴 순서</h3>
          <p className="text-white/70">
            ① 다이너마이트 확인 → ② 감옥 확인(당첨 시 턴 종료) → ③ 카드 2장 뽑기 → ④ 원하는 만큼
            카드 사용 → ⑤ 체력보다 카드가 많으면 초과분 버리기 → ⑥ 다음 생존자에게 턴이 넘어갑니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">카드 목록</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {CARDS.map((c) => (
              <div key={c.name} className="rounded-xl border border-white/10 bg-white/5 p-3">
                <p className="mb-1 font-medium text-white">
                  {c.emoji} {c.name}
                </p>
                <p className="text-xs text-white/60">{c.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">이 버전의 생략 사항</h3>
          <p className="text-white/70">
            정식 룰의 개별 캐릭터 고유 능력(윌리 더 키드, 바트 카시디 등 16종)은 이번 버전에
            포함되지 않았습니다. 모든 플레이어는 역할(보안관/부보안관/무법자/배신자)만 가진 채로
            플레이합니다.
          </p>
        </section>
      </div>
    </Overlay>
  );
}
