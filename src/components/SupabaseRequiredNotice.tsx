/** Shared "Supabase isn't configured" fallback for the accounts/admin pages (login, signup, /account, /admin). */
export default function SupabaseRequiredNotice({ feature }: { feature: string }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-2xl border border-amber-400/30 bg-amber-500/10 p-6 text-center">
      <h2 className="text-lg font-bold text-white">{feature}을(를) 사용할 수 없어요</h2>
      <p className="text-sm text-amber-100/80">
        계정/구독 기능은 Supabase 설정이 필요합니다.
        <code className="mx-1 rounded bg-black/30 px-1.5 py-0.5 text-xs">.env.local</code>
        에 <code className="rounded bg-black/30 px-1.5 py-0.5 text-xs">NEXT_PUBLIC_SUPABASE_URL</code> /
        <code className="mx-1 rounded bg-black/30 px-1.5 py-0.5 text-xs">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>
        를 채워주세요 (README 참고).
      </p>
    </div>
  );
}
