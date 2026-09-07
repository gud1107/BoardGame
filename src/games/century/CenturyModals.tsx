import { BundleRow } from "./boardChrome";
import { ResourceCube } from "./ResourceIcon";
import { bundleTotal, RESOURCE_ORDER, subtractBundle, type Resource, type ResourceBundle } from "./cards";
import { maxTradeRepeats, simulateUpgrade, type PlayerState } from "./engine";

// ---------------------------------------------------------------------------
// Action-flow modals (extracted out of CenturyBoard.tsx unchanged) — every
// one of these follows the same "stage a choice in local state, nothing
// reaches `onAction` until 확정" contract described in CenturyBoard.tsx's
// state doc comment. See CardPreviewModal.tsx (a separate file) for the
// newer tap-to-preview modal used by the market panels.
// ---------------------------------------------------------------------------

export function ModalShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl border p-5 shadow-2xl sm:rounded-2xl"
        style={{
          background: "linear-gradient(165deg, #2c1c0e 0%, #1c1208 55%, #120b05 100%)",
          borderColor: "rgba(198,160,90,0.3)",
        }}
      >
        <h3 className="mb-3 text-sm font-bold text-amber-50">{title}</h3>
        {children}
      </div>
    </div>
  );
}

/**
 * Shared "review then confirm or cancel" step for actions that have nothing
 * to choose (production cards) but previously dispatched straight off a
 * single click — see CenturyBoard.tsx's `confirmingProduction`. Nothing
 * reaches `onAction` until "확정" is pressed, so "취소" always leaves the
 * hand/cart exactly as it was.
 */
export function ConfirmActionModal({
  title,
  description,
  preview,
  confirmLabel = "확정",
  confirmColorClass = "bg-emerald-600",
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  preview?: React.ReactNode;
  confirmLabel?: string;
  confirmColorClass?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ModalShell title={title}>
      <p className="mb-3 text-xs text-white/60">{description}</p>
      {preview && <div className="mb-3 rounded-lg border border-white/10 bg-black/25 p-2">{preview}</div>}
      <div className="flex gap-2">
        <button onClick={onCancel} className="flex-1 rounded-xl border border-white/15 py-2 text-sm text-white/70 hover:border-white/30">
          취소
        </button>
        <button onClick={onConfirm} className={`flex-1 rounded-xl py-2 text-sm font-semibold text-white ${confirmColorClass}`}>
          {confirmLabel}
        </button>
      </div>
    </ModalShell>
  );
}

export function UpgradeModal({
  me,
  cardId,
  steps,
  onChangeSteps,
  onCancel,
  onConfirm,
}: {
  me: PlayerState;
  cardId: string;
  steps: Resource[];
  onChangeSteps: (steps: Resource[]) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const card = me.hand.find((c) => c.id === cardId);
  if (!card || card.effect.kind !== "upgrade") return null;
  const maxSteps = card.effect.upgrades;
  const working = simulateUpgrade(me.resources, steps) ?? me.resources;
  const upgradable = RESOURCE_ORDER.filter((r) => r !== "brown" && (working[r] ?? 0) > 0);

  return (
    <ModalShell title={`업그레이드 카드 (최대 ${maxSteps}회)`}>
      <p className="mb-2 text-xs text-white/60">
        {steps.length} / {maxSteps}회 사용 — 업그레이드할 자원을 순서대로 눌러주세요. 같은 자원을 연속으로 누르면 두 단계 위로도 올릴 수 있어요.
      </p>
      <div className="mb-3 rounded-lg border border-white/10 bg-black/25 p-2">
        <p className="mb-1 text-[10px] text-white/40 uppercase">결과 미리보기</p>
        <BundleRow bundle={working} size="h-5 w-5" />
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {upgradable.length === 0 && <span className="text-xs text-white/40">업그레이드할 자원이 없습니다.</span>}
        {upgradable.map((r) => (
          <button
            key={r}
            disabled={steps.length >= maxSteps}
            onClick={() => onChangeSteps([...steps, r])}
            className="flex items-center gap-1.5 rounded-full border border-sky-300/40 bg-sky-400/10 px-2.5 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ResourceCube resource={r} className="h-4 w-4" /> 업그레이드
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <button onClick={onCancel} className="flex-1 rounded-xl border border-white/15 py-2 text-sm text-white/70 hover:border-white/30">
          취소
        </button>
        {steps.length > 0 && (
          <button onClick={() => onChangeSteps(steps.slice(0, -1))} className="flex-1 rounded-xl border border-white/15 py-2 text-sm text-white/70 hover:border-white/30">
            되돌리기
          </button>
        )}
        <button onClick={onConfirm} disabled={steps.length === 0} className="flex-1 rounded-xl bg-sky-600 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30">
          확정
        </button>
      </div>
    </ModalShell>
  );
}

export function TradeModal({
  me,
  cardId,
  repeats,
  onChangeRepeats,
  onCancel,
  onConfirm,
}: {
  me: PlayerState;
  cardId: string;
  repeats: number;
  onChangeRepeats: (n: number) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const card = me.hand.find((c) => c.id === cardId);
  if (!card || card.effect.kind !== "trade") return null;
  const max = Math.max(1, maxTradeRepeats(me, card.effect.cost));
  const totalCost: ResourceBundle = {};
  const totalGain: ResourceBundle = {};
  for (const r of RESOURCE_ORDER) {
    if (card.effect.cost[r]) totalCost[r] = card.effect.cost[r]! * repeats;
    if (card.effect.gain[r]) totalGain[r] = card.effect.gain[r]! * repeats;
  }

  return (
    <ModalShell title="교환 카드 — 반복 횟수 선택">
      <div className="mb-3 flex items-center justify-center gap-3">
        <button onClick={() => onChangeRepeats(Math.max(1, repeats - 1))} className="h-8 w-8 rounded-full border border-white/15 text-white/80 hover:border-white/30">
          −
        </button>
        <span className="w-10 text-center text-lg font-bold text-white">{repeats}회</span>
        <button onClick={() => onChangeRepeats(Math.min(max, repeats + 1))} className="h-8 w-8 rounded-full border border-white/15 text-white/80 hover:border-white/30">
          +
        </button>
      </div>
      <div className="mb-3 flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-black/25 p-3">
        <BundleRow bundle={totalCost} size="h-5 w-5" />
        <span className="text-white/50">→</span>
        <BundleRow bundle={totalGain} size="h-5 w-5" />
      </div>
      <div className="flex gap-2">
        <button onClick={onCancel} className="flex-1 rounded-xl border border-white/15 py-2 text-sm text-white/70 hover:border-white/30">
          취소
        </button>
        <button onClick={onConfirm} disabled={max === 0} className="flex-1 rounded-xl bg-amber-600 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30">
          확정
        </button>
      </div>
    </ModalShell>
  );
}

export function AcquireModal({
  me,
  index,
  payment,
  onChangePayment,
  onCancel,
  onConfirm,
}: {
  me: PlayerState;
  index: number;
  payment: Resource[];
  onChangePayment: (payment: Resource[]) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const remaining = subtractBundle(me.resources, payment.reduce<ResourceBundle>((acc, r) => ({ ...acc, [r]: (acc[r] ?? 0) + 1 }), {}));
  const done = payment.length === index;
  const isFree = index === 0;
  return (
    <ModalShell title={isFree ? "상인 카드 획득 — 무료" : `상인 카드 획득 — 자원 ${index}개 배치`}>
      <p className="mb-2 text-xs text-white/60">
        {isFree
          ? "가장 왼쪽 카드는 대가 없이 무료로 가져옵니다. 잘못 눌렀다면 취소할 수 있습니다."
          : `앞에 놓인 ${index}장의 카드 위에 자원을 1개씩 올려야 합니다 (${payment.length}/${index}).`}
      </p>
      {!isFree && (
        <>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {RESOURCE_ORDER.map((r) => (
              <button
                key={r}
                disabled={done || (remaining[r] ?? 0) <= 0}
                onClick={() => onChangePayment([...payment, r])}
                className="flex items-center gap-1.5 rounded-full border border-emerald-300/40 bg-emerald-400/10 px-2.5 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ResourceCube resource={r} className="h-4 w-4" /> {remaining[r] ?? 0}
              </button>
            ))}
          </div>
          <div className="mb-3 rounded-lg border border-white/10 bg-black/25 p-2">
            <p className="mb-1 text-[10px] text-white/40 uppercase">배치할 자원</p>
            <BundleRow bundle={payment.reduce<ResourceBundle>((acc, r) => ({ ...acc, [r]: (acc[r] ?? 0) + 1 }), {})} size="h-5 w-5" />
          </div>
        </>
      )}
      <div className="flex gap-2">
        <button onClick={onCancel} className="flex-1 rounded-xl border border-white/15 py-2 text-sm text-white/70 hover:border-white/30">
          취소
        </button>
        {payment.length > 0 && (
          <button onClick={() => onChangePayment(payment.slice(0, -1))} className="flex-1 rounded-xl border border-white/15 py-2 text-sm text-white/70 hover:border-white/30">
            되돌리기
          </button>
        )}
        <button onClick={onConfirm} disabled={!done} className="flex-1 rounded-xl bg-emerald-600 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30">
          확정
        </button>
      </div>
    </ModalShell>
  );
}

export function DiscardModal({
  me,
  discardPick,
  remaining,
  onPick,
  onUndo,
  onReset,
  onConfirm,
}: {
  me: PlayerState;
  discardPick: ResourceBundle;
  remaining: number;
  onPick: (r: Resource) => void;
  onUndo: (r: Resource) => void;
  onReset: () => void;
  onConfirm: () => void;
}) {
  const hasPicks = bundleTotal(discardPick) > 0;
  return (
    <ModalShell title="자원 10개 초과 — 버릴 자원 선택">
      <p className="mb-2 text-xs text-white/60">{remaining > 0 ? `${remaining}개 더 버려야 합니다.` : "정확히 10개가 되었습니다."}</p>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {RESOURCE_ORDER.filter((r) => (me.resources[r] ?? 0) > 0).map((r) => (
          <div key={r} className="flex items-center gap-1 rounded-full border border-rose-300/40 bg-rose-400/10 px-2 py-1">
            <ResourceCube resource={r} className="h-4 w-4" />
            <button onClick={() => onUndo(r)} className="px-1 text-white/70 hover:text-white">
              −
            </button>
            <span className="w-4 text-center text-xs text-white">{discardPick[r] ?? 0}</span>
            <button onClick={() => onPick(r)} disabled={(discardPick[r] ?? 0) >= (me.resources[r] ?? 0)} className="px-1 text-white/70 hover:text-white disabled:opacity-30">
              +
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        {hasPicks && (
          <button onClick={onReset} className="flex-1 rounded-xl border border-white/15 py-2 text-sm text-white/70 hover:border-white/30">
            선택 해제
          </button>
        )}
        <button
          onClick={onConfirm}
          disabled={remaining !== 0}
          className="flex-1 rounded-xl bg-rose-600 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
        >
          버리기 확정
        </button>
      </div>
    </ModalShell>
  );
}
