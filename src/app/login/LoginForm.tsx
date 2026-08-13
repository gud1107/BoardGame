"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getAuthSupabase } from "@/lib/supabase/authClient";
import SupabaseRequiredNotice from "@/components/SupabaseRequiredNotice";

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = getAuthSupabase();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!supabase) {
    return <SupabaseRequiredNotice feature="로그인" />;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error: signInError } = await supabase!.auth.signInWithPassword({ email, password });
    if (signInError) {
      setError("이메일 또는 비밀번호가 올바르지 않습니다.");
      setLoading(false);
      return;
    }
    // Idempotent — self-heals a profile that never got created on signup
    // (e.g. email confirmation was required, so no session existed then).
    await fetch("/api/auth/bootstrap", { method: "POST" }).catch(() => {});
    router.push(searchParams.get("next") || "/");
    router.refresh();
  }

  return (
    <>
      <h1 className="mb-6 text-xl font-bold text-white">로그인</h1>
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-5"
      >
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
          placeholder="비밀번호"
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-rose-400 focus:outline-none"
        />
        {error && <p className="text-xs text-rose-300">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="mt-2 w-full rounded-xl bg-rose-500 py-3 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
        >
          {loading ? "로그인 중…" : "로그인"}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-white/50">
        계정이 없으신가요?{" "}
        <Link href="/signup" className="text-rose-300 underline">
          회원가입
        </Link>
      </p>
    </>
  );
}
