"use client";

import { useEffect, useState } from "react";
import { adminRpc, adminWrite } from "./adminApi";
import { ErrorNote, Panel } from "./adminUi";

interface AlertSettings {
  enabled: boolean;
  ntfy_topic: string | null;
  notify_visits: boolean;
  notify_starts: boolean;
}

const ANDROID_URL = "https://play.google.com/store/apps/details?id=io.heckel.ntfy";
const IOS_URL = "https://apps.apple.com/app/ntfy/id1625396347";

/** A hard-to-guess ntfy topic — anyone who knows it can read the alerts. */
export function makeTopic(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `bghub-${Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 20)}`;
}

function Toggle({ on, label, onChange, disabled }: { on: boolean; label: string; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`inline-flex items-center gap-2 text-xs ${disabled ? "opacity-40" : "cursor-pointer"}`}>
      <input type="checkbox" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="accent-amber-500" />
      {label}
    </label>
  );
}

/**
 * 📱 휴대폰 알림 (ntfy): set up the topic, choose what alerts, send a test.
 * The database posts to ntfy.sh itself when a named IP whose 🔔 switch is
 * on visits or starts a game (supabase/admin_alerts.sql), so this page
 * doesn't need to stay open.
 */
export default function AlertSettingsPanel() {
  const [settings, setSettings] = useState<AlertSettings | null>(null);
  const [missing, setMissing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void adminRpc<AlertSettings>("admin_get_alert_settings", {}).then((result) => {
      if (cancelled) return;
      if ("error" in result) setMissing(true);
      else setSettings(result.data[0] ?? { enabled: false, ntfy_topic: null, notify_visits: true, notify_starts: true });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(next: AlertSettings, successText: string) {
    setSaving(true);
    const err = await adminWrite("admin_set_alert_settings", {
      p_enabled: next.enabled,
      p_topic: next.ntfy_topic ?? "",
      p_visits: next.notify_visits,
      p_starts: next.notify_starts,
    });
    setSaving(false);
    if (err) {
      setMessage({ ok: false, text: err });
      return;
    }
    setSettings(next);
    setMessage({ ok: true, text: successText });
  }

  async function test() {
    setSaving(true);
    const err = await adminWrite("admin_send_test_alert", {});
    setSaving(false);
    setMessage(err ? { ok: false, text: err } : { ok: true, text: "테스트 알림을 보냈어요. 몇 초 안에 휴대폰에 도착합니다." });
  }

  if (missing) {
    return (
      <Panel title="📱 휴대폰 알림">
        <p className="text-xs text-white/50">supabase/admin_alerts.sql을 실행하면 이곳에서 휴대폰 알림을 설정할 수 있습니다.</p>
      </Panel>
    );
  }
  if (!settings) return null;

  const topic = settings.ntfy_topic;
  return (
    <Panel
      title={`📱 휴대폰 알림 ${settings.enabled && topic ? "· 켜짐" : "· 꺼짐"}`}
      note="🔔를 켠 이름의 사람이 접속하거나 게임을 시작하면 휴대폰으로 알려줍니다 (접속은 30분, 게임 시작은 10분에 한 번). 관리자 페이지를 열어두지 않아도 됩니다."
    >
      <ol className="flex list-decimal flex-col gap-3 pl-5 text-xs text-white/80 light:text-slate-700">
        <li>
          휴대폰에 <b>ntfy</b> 앱 설치:{" "}
          <a href={ANDROID_URL} target="_blank" rel="noreferrer" className="text-sky-300 underline">
            안드로이드
          </a>{" "}
          ·{" "}
          <a href={IOS_URL} target="_blank" rel="noreferrer" className="text-sky-300 underline">
            아이폰
          </a>
        </li>
        <li>
          {topic ? (
            <div className="flex flex-col gap-1.5">
              <span>
                앱에서 <b>＋ (Subscribe to topic)</b>을 누르고 아래 주제 이름을 그대로 입력하세요.
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <code className="rounded bg-white/10 px-2 py-1 font-mono text-sm text-amber-200 light:bg-slate-100 light:text-amber-800">{topic}</code>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(topic).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    });
                  }}
                  className="text-xs text-white/60 underline"
                >
                  {copied ? "복사됨 ✓" : "복사"}
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    if (window.confirm("주제 이름을 새로 만들면 지금 구독한 휴대폰에는 더 이상 알림이 가지 않습니다. 바꿀까요?")) {
                      void save({ ...settings, ntfy_topic: makeTopic() }, "새 주제를 만들었어요. 휴대폰에서 다시 구독해 주세요.");
                    }
                  }}
                  className="text-xs text-white/40 underline"
                >
                  새로 만들기
                </button>
              </div>
              <span className="text-white/40">주제 이름을 아는 사람은 알림을 볼 수 있으니 다른 사람과 공유하지 마세요. 알림에는 IP가 아니라 붙여둔 이름만 들어갑니다.</span>
            </div>
          ) : (
            <button
              type="button"
              disabled={saving}
              onClick={() => void save({ ...settings, ntfy_topic: makeTopic() }, "주제를 만들었어요. 휴대폰 ntfy 앱에서 구독해 주세요.")}
              className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-40"
            >
              내 알림 주제 만들기
            </button>
          )}
        </li>
        <li className="flex flex-col gap-2">
          <span>알림 켜기 · 받을 종류 고르기 (사람별 🔔는 아래 IP 목록에서)</span>
          <div className="flex flex-wrap gap-4">
            <Toggle
              on={settings.enabled}
              label="알림 켜기"
              disabled={saving || !topic}
              onChange={(v) => void save({ ...settings, enabled: v }, v ? "알림을 켰어요." : "알림을 껐어요.")}
            />
            <Toggle
              on={settings.notify_visits}
              label="접속했을 때"
              disabled={saving || !topic}
              onChange={(v) => void save({ ...settings, notify_visits: v }, "저장했어요.")}
            />
            <Toggle
              on={settings.notify_starts}
              label="게임을 시작했을 때"
              disabled={saving || !topic}
              onChange={(v) => void save({ ...settings, notify_starts: v }, "저장했어요.")}
            />
          </div>
        </li>
        <li>
          <button
            type="button"
            disabled={saving || !topic || !settings.enabled}
            onClick={() => void test()}
            className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-white/80 hover:border-amber-400 disabled:opacity-40 light:border-slate-300 light:text-slate-700"
          >
            📨 테스트 알림 보내기
          </button>
          {(!topic || !settings.enabled) && <span className="ml-2 text-white/40">주제를 만들고 알림을 켜면 보낼 수 있어요</span>}
        </li>
      </ol>
      {message && (message.ok ? <p className="mt-3 text-xs text-emerald-300">{message.text}</p> : <ErrorNote message={message.text} />)}
    </Panel>
  );
}
