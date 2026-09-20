"use client";

import Overlay from "@/components/Overlay";

const CLASSIC_ROLES: { emoji: string; name: string; desc: string }[] = [
  { emoji: "🙂", name: "시민 (시민팀)", desc: "특수 능력 없음. 낮 토론과 투표로 마피아를 찾아내야 합니다." },
  { emoji: "🔪", name: "마피아 (마피아팀)", desc: "매일 밤 동료와 함께 시민 1명을 지목해 제거합니다." },
  { emoji: "👮", name: "경찰 (시민팀)", desc: "매일 밤 1명을 조사해 마피아인지 아닌지 확인합니다." },
  { emoji: "💉", name: "의사 (시민팀)", desc: "매일 밤 1명을 지정해 마피아의 습격으로부터 보호합니다." },
];

const EXPANSION_ROLES: { emoji: string; name: string; desc: string }[] = [
  { emoji: "🕶️", name: "스파이 (마피아팀)", desc: "매일 밤 1명을 조사해 정확한 직업을 알아냅니다. 마피아를 찾으면 그날 밤부터 암살 표결에 합류합니다." },
  { emoji: "🪖", name: "군인 (시민팀)", desc: "마피아의 첫 습격을 1회 자동으로 방어합니다 (방탄조끼)." },
  { emoji: "🎩", name: "정치인 (시민팀)", desc: "낮 찬반 투표로는 처형되지 않으며, 투표권이 2표로 계산됩니다." },
  { emoji: "🔮", name: "영매 (시민팀)", desc: "매일 밤 이미 사망한 사람 1명의 진짜 직업을 확인합니다." },
  { emoji: "💣", name: "테러리스트 (시민팀)", desc: "낮 투표로 처형당하면, 자신을 지목했던 사람 중 1명을 길동무로 데려갑니다." },
];

export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="📖 마피아 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80 light:text-slate-700">
        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500">승리 조건</h3>
          <p className="text-white/70 light:text-slate-600">
            <span className="text-sky-300 light:text-sky-700">시민 진영</span>은 모든 마피아 진영(마피아, 스파이 포함)을 제거하면 승리합니다.{" "}
            <span className="text-rose-300 light:text-rose-700">마피아 진영</span>은 생존한 마피아 수가 생존한 시민 진영 수와 같아지거나
            더 많아지면 승리합니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500">🎲 기본룰 (Classic) 직업</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {CLASSIC_ROLES.map((r) => (
              <div key={r.name} className="rounded-xl border border-white/10 bg-white/5 p-3 light:border-slate-200 light:bg-slate-50">
                <p className="mb-1 font-medium text-white light:text-slate-900">
                  {r.emoji} {r.name}
                </p>
                <p className="text-xs text-white/60 light:text-slate-600">{r.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500">🃏 확장룰 (Expansion) 추가 직업</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {EXPANSION_ROLES.map((r) => (
              <div key={r.name} className="rounded-xl border border-white/10 bg-white/5 p-3 light:border-slate-200 light:bg-slate-50">
                <p className="mb-1 font-medium text-white light:text-slate-900">
                  {r.emoji} {r.name}
                </p>
                <p className="text-xs text-white/60 light:text-slate-600">{r.desc}</p>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-amber-300/80 light:text-amber-700">
            ⚠️ 테러리스트는 8인 이상, 영매는 9인 이상부터 등장합니다. 8인 이상은 마피아가 2명으로 늘어납니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500">진행 순서</h3>
          <p className="text-white/70 light:text-slate-600">
            ① 첫날 밤은 상견례만 하고 아무 일도 일어나지 않습니다 → ② 낮에 사망자를 발표하고 자유 토론 → ③ 가장 의심스러운
            사람을 지목하는 투표(동률이면 무효, 바로 밤으로) → ④ 최후 변론 → ⑤ 찬반 투표로 처형 여부 결정(과반수 찬성 필요,
            정치인은 면제) → ⑥ 밤에 마피아의 습격과 각 직업의 능력이 동시에 발동 → ⑦ 마피아 전멸 또는 마피아 수가
            시민 수 이상이 될 때까지 반복.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500">유령 관전</h3>
          <p className="text-white/70 light:text-slate-600">
            사망한 플레이어는 방에서 나가지 않고 즉시 👻 유령 모드로 전환됩니다. 모든 사람의 직업을 볼 수 있는 전지적
            시점이 되며, 생존자에게는 보이지 않는 유령 전용 채팅으로만 대화할 수 있습니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500">방 설정 토글</h3>
          <p className="text-white/70 light:text-slate-600">
            처형 시 직업 공개 여부, 의사의 첫 실제 능력 밤(1일차 밤) 자가치료 허용 여부, 낮 토론 시간(30/60/90초)을 방
            만들기 화면에서 고를 수 있습니다. 자가치료는 허용하더라도 1일차 밤에만 가능하고, 이후 밤에는 항상 금지됩니다.
          </p>
        </section>
      </div>
    </Overlay>
  );
}
