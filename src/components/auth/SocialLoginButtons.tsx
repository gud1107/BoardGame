"use client";

import { useEffect, useState } from "react";
import { getAuthSupabase } from "@/lib/supabase/authClient";

type Provider = "kakao" | "google" | "github" | "discord";

const PROVIDERS: { id: Provider; label: string; className: string; icon: React.ReactNode }[] = [
  {
    id: "kakao",
    label: "카카오로 계속하기",
    className: "bg-[#FEE500] text-black/85 hover:brightness-95",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
        <path
          fill="currentColor"
          d="M12 3C6.48 3 2 6.52 2 10.86c0 2.8 1.86 5.25 4.66 6.64l-.95 3.48c-.08.3.26.54.52.37l4.15-2.74c.53.07 1.07.11 1.62.11 5.52 0 10-3.52 10-7.86S17.52 3 12 3z"
        />
      </svg>
    ),
  },
  {
    id: "google",
    label: "Google로 계속하기",
    className: "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
        <path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.78.43 3.45 1.18 4.94l3.66-2.84z" />
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38z" />
      </svg>
    ),
  },
  {
    id: "github",
    label: "GitHub로 계속하기",
    className: "bg-[#24292f] text-white hover:bg-[#32383f]",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
        <path
          fill="currentColor"
          d="M12 .5A11.5 11.5 0 0 0 8.36 22.9c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.7 5.4-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5z"
        />
      </svg>
    ),
  },
  {
    id: "discord",
    label: "Discord로 계속하기",
    className: "bg-[#5865F2] text-white hover:bg-[#4752c4]",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
        <path
          fill="currentColor"
          d="M20.32 4.37A19.8 19.8 0 0 0 15.4 2.85a13.8 13.8 0 0 0-.63 1.29 18.4 18.4 0 0 0-5.53 0 12.6 12.6 0 0 0-.64-1.29 19.7 19.7 0 0 0-4.92 1.52C.53 9.05-.32 13.6.1 18.1a19.9 19.9 0 0 0 6.03 3.05c.49-.66.92-1.36 1.29-2.1a12.9 12.9 0 0 1-2.03-.97c.17-.12.34-.25.5-.38a14.2 14.2 0 0 0 12.22 0l.5.38c-.65.38-1.33.71-2.04.97.37.74.8 1.44 1.29 2.1a19.8 19.8 0 0 0 6.03-3.05c.5-5.22-.84-9.73-3.57-13.73zM8.02 15.33c-1.18 0-2.16-1.08-2.16-2.42 0-1.33.95-2.42 2.16-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.34-.95 2.42-2.16 2.42zm7.97 0c-1.18 0-2.16-1.08-2.16-2.42 0-1.33.95-2.42 2.16-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.34-.95 2.42-2.16 2.42z"
        />
      </svg>
    ),
  },
];

/**
 * Social (OAuth) login buttons for /login and /signup. Only providers that
 * are actually switched on in the Supabase dashboard are shown — read from
 * GoTrue's public `/auth/v1/settings` endpoint — so a provider nobody has
 * configured yet never shows a button that dead-ends on a Supabase error.
 * Renders nothing until at least one is enabled.
 */
export default function SocialLoginButtons({ next }: { next?: string | null }) {
  const [enabled, setEnabled] = useState<Provider[] | null>(null);
  const [pending, setPending] = useState<Provider | null>(null);

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) return;
    let cancelled = false;
    fetch(`${url}/auth/v1/settings`, { headers: { apikey: anonKey } })
      .then((r) => (r.ok ? r.json() : null))
      .then((settings: { external?: Record<string, boolean> } | null) => {
        if (cancelled) return;
        const external = settings?.external ?? {};
        setEnabled(PROVIDERS.filter((p) => external[p.id]).map((p) => p.id));
      })
      .catch(() => !cancelled && setEnabled([]));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!enabled || enabled.length === 0) return null;

  async function handleClick(provider: Provider) {
    const supabase = getAuthSupabase();
    if (!supabase) return;
    setPending(provider);
    const callback = new URL("/auth/callback", window.location.origin);
    if (next) callback.searchParams.set("next", next);
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: callback.toString() },
    });
    // On success the browser is already navigating away to the provider.
    if (error) setPending(null);
  }

  return (
    <div className="flex flex-col gap-2">
      {PROVIDERS.filter((p) => enabled.includes(p.id)).map((p) => (
        <button
          key={p.id}
          type="button"
          disabled={pending !== null}
          onClick={() => handleClick(p.id)}
          className={`flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition disabled:cursor-wait disabled:opacity-60 ${p.className}`}
        >
          {p.icon}
          {pending === p.id ? "이동 중…" : p.label}
        </button>
      ))}
      <div className="my-2 flex items-center gap-3 text-xs text-white/40 light:text-slate-400">
        <span className="h-px flex-1 bg-white/10 light:bg-slate-200" />
        또는 이메일로
        <span className="h-px flex-1 bg-white/10 light:bg-slate-200" />
      </div>
    </div>
  );
}
