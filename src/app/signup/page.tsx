"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getAuthSupabase } from "@/lib/supabase/authClient";
import SupabaseRequiredNotice from "@/components/SupabaseRequiredNotice";
import { TRIAL_DAYS } from "@/lib/entitlements/types";

export default function SignupPage() {
  const router = useRouter();
  const supabase = getAuthSupabase();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [needsEmailConfirm, setNeedsEmailConfirm] = useState(false);

  if (!supabase) {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <SupabaseRequiredNotice feature="회원가입" />
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("비밀번호는 8자 이상이어야 합니다.");
      return;
    }
    setLoading(true);
    const { data, error: signUpError } = await supabase!.auth.signUp({ email, password });
    if (signUpError) {
      setError(signUpError.message.includes("already registered") ? "이미 가입된 이메일입니다." : "가입에 실패했습니다.");
      setLoading(false);
      return;
    }
    if (!data.session) {
      // Project requires email confirmation — no session yet, so the
      // bootstrap route (which needs an authenticated caller) can't run
      // until the user confirms and logs in for the first time.
      setNeedsEmailConfirm(true);
      setLoading(false);
      return;
    }
    await fetch("/api/auth/bootstrap", { method: "POST" }).catch(() => {});
    router.push("/");
    router.refresh();
  }

  if (needsEmailConfirm) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <span className="text-4xl">📬</span>
        <h1 className="mt-4 text-xl font-bold text-white">이메일을 확인해주세요</h1>
        <p className="mt-2 text-sm text-white/60">{email}로 보낸 확인 메일의 링크를 클릭하면 가입이 완료됩니다.</p>
        <Link href="/login" className="mt-6 inline-block text-rose-300 underline">
          로그인으로
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <h1 className="mb-2 text-xl font-bold text-white">회원가입</h1>
      <p className="mb-6 text-sm text-white/50">가입하면 {TRIAL_DAYS}일 무료 Lite 체험이 자동으로 시작돼요.</p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="이메일"
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-rose-400 focus:outline-none"
        />
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="비밀번호 (8자 이상)"
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-rose-400 focus:outline-none"
        />
        {error && <p className="text-xs text-rose-300">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="mt-2 w-full rounded-xl bg-rose-500 py-3 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
        >
          {loading ? "가입 중…" : "회원가입"}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-white/50">
        이미 계정이 있으신가요?{" "}
        <Link href="/login" className="text-rose-300 underline">
          로그인
        </Link>
      </p>
    </div>
  );
}
