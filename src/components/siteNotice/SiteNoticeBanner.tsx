"use client";

import { useEffect, useState } from "react";
import { fetchSiteNotice, type NoticeLevel, type SiteNotice } from "@/lib/siteConfig/siteConfig";

const DISMISS_KEY = "bg_notice_dismissed";

const STYLES: Record<NoticeLevel, { box: string; icon: string }> = {
  info: { box: "bg-sky-500/15 text-sky-100 light:bg-sky-50 light:text-sky-800", icon: "📢" },
  warning: { box: "bg-amber-500/20 text-amber-100 light:bg-amber-50 light:text-amber-900", icon: "⚠️" },
  maintenance: { box: "bg-rose-600/25 text-rose-100 light:bg-rose-50 light:text-rose-800", icon: "🛠" },
};

/**
 * Site-wide notice under the header, set from /admin/games (공지 tab).
 * A visitor can close it; closing is remembered per notice version
 * (`updated_at`), so editing the notice shows it again. Maintenance
 * notices can't be closed.
 */
export default function SiteNoticeBanner() {
  const [notice, setNotice] = useState<SiteNotice | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchSiteNotice().then((n) => {
      if (cancelled || !n?.enabled || !n.message.trim()) return;
      let wasDismissed = false;
      try {
        wasDismissed = window.localStorage.getItem(DISMISS_KEY) === n.updated_at;
      } catch {}
      setDismissed(wasDismissed && n.level !== "maintenance");
      setNotice(n);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!notice || dismissed) return null;
  const style = STYLES[notice.level] ?? STYLES.info;

  return (
    <div className={`flex items-start gap-2 px-4 py-2 text-sm ${style.box}`} role="status">
      <span aria-hidden>{style.icon}</span>
      <p className="flex-1 whitespace-pre-line break-keep">{notice.message}</p>
      {notice.level !== "maintenance" && (
        <button
          type="button"
          aria-label="공지 닫기"
          onClick={() => {
            try {
              window.localStorage.setItem(DISMISS_KEY, notice.updated_at);
            } catch {}
            setDismissed(true);
          }}
          className="shrink-0 px-1 opacity-70 hover:opacity-100"
        >
          ✕
        </button>
      )}
    </div>
  );
}
