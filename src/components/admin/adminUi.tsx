import type { ReactNode } from "react";

export function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
        active
          ? "border-amber-400 bg-amber-500/20 text-amber-200 light:text-amber-800"
          : "border-white/15 text-white/60 hover:border-white/30 light:border-slate-300 light:text-slate-600"
      }`}
    >
      {children}
    </button>
  );
}

export function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 light:border-slate-200 light:bg-white">
      <p className="text-xs text-white/50 light:text-slate-500">{label}</p>
      <p className="mt-1.5 text-2xl font-bold text-white tabular-nums light:text-slate-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-white/40 light:text-slate-400">{sub}</p>}
    </div>
  );
}

export function Panel({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5 light:border-slate-200 light:bg-white">
      <h3 className="text-sm font-semibold text-white/85 light:text-slate-800">{title}</h3>
      {note && <p className="mt-0.5 text-xs text-white/40 light:text-slate-500">{note}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{message}</p>;
}

export function Loading() {
  return <p className="py-8 text-center text-sm text-white/40">불러오는 중…</p>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-white/40 light:text-slate-400">{children}</p>;
}
