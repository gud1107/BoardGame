"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTheme, type ThemePreference } from "@/contexts/ThemeContext";
import { getAuthSupabase } from "@/lib/supabase/authClient";

/**
 * Theme picker shared by SiteHeader (present on every page, lobby and
 * in-game alike, see layout.tsx) and the game page's title bar. Pure
 * client-side attribute flip (see ThemeContext.tsx); never touches
 * socket/game state, so switching mid-turn is always safe.
 *
 * 2026-10-04: the icon button opens a small menu — 🌙 다크 / ☀️ 라이트 /
 * 🖥️ 시스템(OS 설정 따름) — instead of cycling through them on each tap, so
 * every option is visible and one tap away. The menu is `position: fixed`,
 * placed from the button's rect and clamped to the viewport, because the
 * header wraps on phones and the button can land anywhere in it.
 */
const OPTIONS: { pref: ThemePreference; icon: string; label: string }[] = [
  { pref: "dark", icon: "🌙", label: "다크" },
  { pref: "light", icon: "☀️", label: "라이트" },
  { pref: "system", icon: "🖥️", label: "시스템 설정 따름" },
];
const ICON: Record<ThemePreference, string> = { dark: "🌙", light: "☀️", system: "🖥️" };
const MENU_W = 208;
const GAP = 8;

export default function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, preference, setPreference } = useTheme();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const nowLabel = theme === "light" ? "라이트" : "다크";
  const current = OPTIONS.find((o) => o.pref === preference)!;
  const buttonLabel = `테마: ${current.label}${preference === "system" ? ` (지금: ${nowLabel})` : ""}`;

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = buttonRef.current?.getBoundingClientRect();
      if (!r) return;
      const left = Math.min(Math.max(GAP, r.right - MENU_W), window.innerWidth - MENU_W - GAP);
      setPos({ top: r.bottom + 6, left });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  // Focus the checked item once the menu has actually been placed and rendered.
  const placed = pos !== null;
  useEffect(() => {
    if (open && placed) menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
  }, [open, placed]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !buttonRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    let cancelled = false;
    void getAuthSupabase()
      ?.auth.getSession()
      .then(({ data }) => {
        if (!cancelled) setSignedIn(!!data.session);
      });
    return () => {
      cancelled = true;
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
  };

  return (
    <>
      <button
        ref={buttonRef}
        onClick={() => setOpen((o) => !o)}
        title={buttonLabel}
        aria-label={buttonLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-amber-500/30 bg-neutral-900/60 text-sm transition hover:border-amber-400/70 hover:shadow-[0_0_12px_rgba(245,158,11,0.3)] light:border-slate-300 light:bg-white light:shadow-sm light:hover:border-slate-400 light:hover:shadow-md ${className}`}
      >
        <span aria-hidden="true">{ICON[preference]}</span>
      </button>
      {open && pos && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="테마 선택"
          onKeyDown={onMenuKey}
          style={{ top: pos.top, left: pos.left, width: MENU_W }}
          className="fixed z-[60] rounded-xl border border-amber-500/25 bg-neutral-950/95 p-1.5 text-sm shadow-[0_12px_32px_rgba(0,0,0,0.5)] backdrop-blur-xl light:border-slate-200 light:bg-white light:shadow-lg"
        >
          {OPTIONS.map((o) => {
            const selected = o.pref === preference;
            return (
              <button
                key={o.pref}
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => {
                  if (!selected) setPreference(o.pref);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left outline-none transition ${
                  selected
                    ? "bg-amber-500/15 text-amber-100 light:bg-amber-50 light:text-amber-800"
                    : "text-white/80 hover:bg-white/5 focus-visible:bg-white/5 light:text-slate-700 light:hover:bg-slate-100 light:focus-visible:bg-slate-100"
                }`}
              >
                <span aria-hidden="true" className="w-5 text-center">
                  {o.icon}
                </span>
                <span className="flex-1">
                  {o.label}
                  {o.pref === "system" && (
                    <span className="block text-[11px] text-white/45 light:text-slate-500">지금은 {nowLabel}</span>
                  )}
                </span>
                {selected && <span aria-hidden="true">✓</span>}
              </button>
            );
          })}
          {signedIn !== null && (
            <p className="mt-1 border-t border-white/10 px-2.5 pt-1.5 pb-0.5 text-[11px] leading-snug text-white/45 light:border-slate-200 light:text-slate-500">
              {signedIn ? "계정에 저장돼 다른 기기에서도 똑같이 적용돼요" : "로그인하면 다른 기기에서도 똑같이 적용돼요"}
            </p>
          )}
        </div>
      )}
    </>
  );
}
