"use client";

import { useState } from "react";
import { adminRpc, adminWrite, DATE_TIME, fmt, type IpLabelMap } from "../adminApi";
import { Chip, Empty, ErrorNote, Loading, Panel } from "../adminUi";
import { useAdminQuery } from "../useAdminQuery";
import AlertSettingsPanel from "../AlertSettingsPanel";

interface TopIpRow {
  ip: string;
  visits: number;
  game_starts: number;
  events: number;
  devices: number;
  nicknames: string[];
  first_at: string;
  last_at: string;
  label: string | null;
  memo: string | null;
}

/** Per-name 🔔: phone alerts for this IP (supabase/admin_alerts.sql). Only named IPs can alert. */
function AlertSwitch({ ip, labels, onSaved }: { ip: string; labels: IpLabelMap; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);
  const entry = labels.get(ip);
  if (!entry || entry.alert === undefined) return null;
  const on = entry.alert;
  return (
    <button
      type="button"
      disabled={saving}
      title={on ? "이 사람 알림 끄기" : "이 사람이 오면 휴대폰으로 알림 받기"}
      onClick={async () => {
        setSaving(true);
        await adminWrite("admin_set_ip_alert", { p_ip: ip, p_alert: !on });
        setSaving(false);
        onSaved();
      }}
      className={`rounded-full px-2 py-0.5 text-xs font-semibold transition disabled:opacity-40 ${
        on ? "bg-sky-500/20 text-sky-200 light:bg-sky-100 light:text-sky-800" : "text-white/40 hover:text-white/70 light:text-slate-400"
      }`}
    >
      {on ? "🔔 알림 켜짐" : "🔕 알림 꺼짐"}
    </button>
  );
}

/** Inline "name this IP" editor: shows the saved name, or a form while editing. */
function LabelEditor({
  ip,
  label,
  memo,
  onSaved,
}: {
  ip: string;
  label: string | null;
  memo: string | null;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(label ?? "");
  const [note, setNote] = useState(memo ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(nextName: string, nextNote: string) {
    setSaving(true);
    const err = await adminWrite("admin_set_ip_label", { p_ip: ip, p_label: nextName, p_memo: nextNote });
    setSaving(false);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setEditing(false);
    onSaved();
  }

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {label ? (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-200 light:bg-amber-100 light:text-amber-800">
            🏷️ {label}
          </span>
        ) : (
          <span className="text-xs text-white/30">이름 없음</span>
        )}
        {memo && <span className="text-xs text-white/50">{memo}</span>}
        <button type="button" onClick={() => setEditing(true)} className="text-xs text-white/50 underline hover:text-white/80">
          {label ? "수정" : "이름 등록"}
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save(name, note);
      }}
      className="flex flex-wrap items-center gap-2"
    >
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value.slice(0, 40))}
        placeholder="예) 철수네 집"
        className="w-32 rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-xs text-white outline-none focus:border-amber-400 light:border-slate-300 light:bg-white light:text-slate-900"
      />
      <input
        value={note}
        onChange={(e) => setNote(e.target.value.slice(0, 200))}
        placeholder="메모 (선택)"
        className="w-40 rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-xs text-white outline-none focus:border-amber-400 light:border-slate-300 light:bg-white light:text-slate-900"
      />
      <button type="submit" disabled={saving} className="rounded-lg bg-amber-500 px-2.5 py-1 text-xs font-semibold text-black disabled:opacity-40">
        저장
      </button>
      {label && (
        <button type="button" disabled={saving} onClick={() => void save("", "")} className="text-xs text-rose-300 underline">
          이름 지우기
        </button>
      )}
      <button type="button" onClick={() => setEditing(false)} className="text-xs text-white/50 underline">
        취소
      </button>
      {error && <span className="text-xs text-rose-300">{error}</span>}
    </form>
  );
}

/**
 * 🏷️ IP 관리 tab: the IPs seen most often (visits + game activity), each
 * with an inline name/memo the admin can set — names then show across the
 * hub (게임 통계's device list). Only raw IPs can be listed: rows recorded
 * before raw IPs were stored have just a hash.
 */
export default function IpLabelsTab({
  since,
  myIp,
  labels,
  onLabelsChanged,
  reloadKey,
}: {
  since: string | null;
  myIp: string | null;
  labels: IpLabelMap;
  onLabelsChanged: () => void;
  reloadKey: number;
}) {
  const [version, setVersion] = useState(0);
  const [onlyUnnamed, setOnlyUnnamed] = useState(false);
  const [newIp, setNewIp] = useState("");
  const { data, error } = useAdminQuery<TopIpRow>(
    () => adminRpc("admin_top_ips", { p_since: since, p_limit: 100 }),
    JSON.stringify([since, reloadKey, version]),
  );

  const saved = () => {
    setVersion((v) => v + 1);
    onLabelsChanged();
  };

  const rows = (data ?? []).filter((r) => !onlyUnnamed || !r.label);
  const seen = new Set((data ?? []).map((r) => r.ip));
  // Named IPs with no activity in this period still deserve a place to edit them.
  const idleNamed = [...labels.values()].filter((l) => !seen.has(l.ip));

  return (
    <div className="flex flex-col gap-4">
      <AlertSettingsPanel />
      <Panel title="IP에 이름 붙이기" note="자주 오는 IP가 누구인지 적어두면 게임 통계의 기기 목록에도 그 이름이 보입니다. 이름은 관리자만 볼 수 있습니다.">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (newIp.trim()) setNewIp(newIp.trim());
          }}
          className="flex flex-wrap items-center gap-2"
        >
          <input
            value={newIp}
            onChange={(e) => setNewIp(e.target.value.slice(0, 45))}
            placeholder="IP 직접 입력 (예: 211.234.1.2)"
            className="w-56 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 font-mono text-xs text-white outline-none focus:border-amber-400 light:border-slate-300 light:bg-white light:text-slate-900"
          />
          {myIp && (
            <button type="button" onClick={() => setNewIp(myIp)} className="text-xs text-emerald-300 underline">
              👤 내 IP 넣기 ({myIp})
            </button>
          )}
        </form>
        {newIp.trim() && (
          <div className="mt-3 rounded-lg border border-white/10 p-3 light:border-slate-200">
            <p className="mb-2 font-mono text-xs text-white/70">{newIp.trim()}</p>
            <LabelEditor
              key={newIp.trim()}
              ip={newIp.trim()}
              label={labels.get(newIp.trim())?.label ?? null}
              memo={labels.get(newIp.trim())?.memo ?? null}
              onSaved={() => {
                saved();
                setNewIp("");
              }}
            />
          </div>
        )}
      </Panel>

      <div className="flex flex-wrap items-center gap-2">
        <Chip active={!onlyUnnamed} onClick={() => setOnlyUnnamed(false)}>
          전체
        </Chip>
        <Chip active={onlyUnnamed} onClick={() => setOnlyUnnamed(true)}>
          이름 없는 IP만
        </Chip>
        <span className="text-xs text-white/40">많이 들어온 순 · 이 기간에 기록된 IP 원문 기준</span>
      </div>

      <ErrorNote message={error} />
      {!data && !error && <Loading />}
      {data && rows.length === 0 && <Empty>{data.length === 0 ? "아직 기록된 IP가 없습니다." : "모든 IP에 이름이 붙어 있습니다."}</Empty>}
      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-white/10 light:border-slate-200">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="bg-white/[0.04] text-white/50 light:bg-slate-50 light:text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">IP</th>
                <th className="px-3 py-2 font-medium">이름 / 메모</th>
                <th className="px-3 py-2 font-medium">휴대폰 알림</th>
                <th className="px-3 py-2 text-right font-medium">방문</th>
                <th className="px-3 py-2 text-right font-medium">게임 시작</th>
                <th className="px-3 py-2 text-right font-medium">기기</th>
                <th className="px-3 py-2 font-medium">쓴 닉네임</th>
                <th className="px-3 py-2 font-medium">최근</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-white/80 light:divide-slate-100 light:text-slate-700">
              {rows.map((r) => (
                <tr key={r.ip} className="align-top">
                  <td className="px-3 py-2 font-mono">
                    {r.ip}
                    {r.ip === myIp && <span className="ml-1.5 font-sans text-[10px] font-bold text-emerald-300">👤 나</span>}
                  </td>
                  <td className="px-3 py-2">
                    <LabelEditor ip={r.ip} label={r.label} memo={r.memo} onSaved={saved} />
                  </td>
                  <td className="px-3 py-2">
                    {r.label ? <AlertSwitch ip={r.ip} labels={labels} onSaved={saved} /> : <span className="text-white/25">이름 먼저</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(r.visits)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(r.game_starts)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(r.devices)}대</td>
                  <td className="px-3 py-2">{r.nicknames.length ? r.nicknames.join(", ") : <span className="text-white/30">—</span>}</td>
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums">{DATE_TIME.format(new Date(r.last_at))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {idleNamed.length > 0 && !onlyUnnamed && (
        <Panel title="이름 붙인 IP 중 이 기간 기록이 없는 것">
          <ul className="flex flex-col gap-2">
            {idleNamed.map((l) => (
              <li key={l.ip} className="flex flex-wrap items-center gap-3 text-xs">
                <span className="font-mono text-white/70">{l.ip}</span>
                <LabelEditor ip={l.ip} label={l.label} memo={l.memo} onSaved={saved} />
                <AlertSwitch ip={l.ip} labels={labels} onSaved={saved} />
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
