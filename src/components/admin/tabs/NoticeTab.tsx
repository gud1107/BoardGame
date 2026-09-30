"use client";

import { useEffect, useState } from "react";
import { fetchSiteNotice, type NoticeLevel } from "@/lib/siteConfig/siteConfig";
import { adminWrite } from "../adminApi";
import { Chip, ErrorNote, Loading, Panel } from "../adminUi";

const LEVELS: { key: NoticeLevel; label: string; hint: string }[] = [
  { key: "info", label: "📢 안내", hint: "파란색 · 방문자가 닫을 수 있음" },
  { key: "warning", label: "⚠️ 주의", hint: "노란색 · 방문자가 닫을 수 있음" },
  { key: "maintenance", label: "🛠 점검", hint: "빨간색 · 닫을 수 없음" },
];

/** 공지 tab: the banner under the site header (`SiteNoticeBanner`). */
export default function NoticeTab() {
  const [loaded, setLoaded] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState("");
  const [level, setLevel] = useState<NoticeLevel>("info");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchSiteNotice().then((n) => {
      if (cancelled) return;
      if (n) {
        setEnabled(n.enabled);
        setMessage(n.message);
        setLevel(n.level);
      }
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(nextEnabled: boolean) {
    setSaving(true);
    const err = await adminWrite("admin_set_notice", { p_enabled: nextEnabled, p_message: message, p_level: level });
    setSaving(false);
    if (err) {
      setStatus({ ok: false, text: err });
      return;
    }
    setEnabled(nextEnabled);
    setStatus({ ok: true, text: nextEnabled ? "공지를 게시했습니다. 방문자가 새로고침하면 보입니다." : "공지를 내렸습니다." });
  }

  if (!loaded) return <Loading />;

  return (
    <Panel title="사이트 상단 공지" note={`현재 상태: ${enabled ? "게시 중" : "꺼짐"} · 내용을 바꾸면 이전에 닫은 방문자에게도 다시 보입니다`}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          {LEVELS.map((l) => (
            <Chip key={l.key} active={level === l.key} onClick={() => setLevel(l.key)}>
              {l.label}
            </Chip>
          ))}
        </div>
        <p className="text-xs text-white/40">{LEVELS.find((l) => l.key === level)?.hint}</p>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value.slice(0, 300))}
          rows={3}
          placeholder="예) 10월 5일 새벽 2시~4시 서버 점검이 있습니다."
          className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-amber-400 light:border-slate-300 light:bg-white light:text-slate-900"
        />
        <p className="text-right text-[11px] text-white/40">{message.length}/300</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={saving || !message.trim()}
            onClick={() => void save(true)}
            className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-black hover:bg-amber-400 disabled:opacity-40"
          >
            {enabled ? "공지 수정 게시" : "공지 게시"}
          </button>
          {enabled && (
            <button
              type="button"
              disabled={saving}
              onClick={() => void save(false)}
              className="rounded-xl border border-white/15 px-4 py-2 text-sm text-white/80 hover:border-rose-400 disabled:opacity-40 light:border-slate-300 light:text-slate-700"
            >
              공지 내리기
            </button>
          )}
        </div>
        {status && (status.ok ? <p className="text-sm text-emerald-300">{status.text}</p> : <ErrorNote message={status.text} />)}
      </div>
    </Panel>
  );
}
