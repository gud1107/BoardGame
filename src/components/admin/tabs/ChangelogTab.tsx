"use client";

import { useMemo, useState } from "react";
import { ADMIN_CHANGELOG, ADMIN_COMMIT_KO, type AdminChangelogEntry } from "@/constants/adminChangelog";
import { ADMIN_COMMITS } from "@/constants/adminChangelog.generated";
import { Chip, Empty, Panel } from "../adminUi";

type ChangeType = AdminChangelogEntry["type"];
type Source = "default" | "curated" | "auto" | "all";

const TYPE_LABEL: Record<ChangeType, string> = { FEAT: "추가", FIX: "수정", IMPROVE: "개선" };
const TYPES: (ChangeType | "all")[] = ["all", "FEAT", "FIX", "IMPROVE"];
const SOURCES: { key: Source; label: string }[] = [
  { key: "default", label: "기본" },
  { key: "curated", label: "📝 정리된 기록" },
  { key: "auto", label: "🤖 커밋 자동 기록" },
  { key: "all", label: "전체(겹침 포함)" },
];

interface Row extends AdminChangelogEntry {
  key: string;
  auto: boolean;
  scope?: string;
  /** Original English commit subject, shown on hover when Korean is displayed. */
  original?: string;
}

const ROWS: Row[] = [
  ...ADMIN_CHANGELOG.map((e, i) => ({ ...e, key: `c${i}`, auto: false })),
  ...ADMIN_COMMITS.map((c) => {
    const ko = c.ko ?? ADMIN_COMMIT_KO[c.hash];
    return { ...c, desc: ko ?? c.desc, original: ko ? c.desc : undefined, key: c.hash, auto: true };
  }),
].sort((a, b) => b.date.localeCompare(a.date) || Number(a.auto) - Number(b.auto));

/**
 * Curated rows already summarize the commits up to their newest date, so the
 * 기본 view shows curated rows plus only the auto rows that came after them.
 */
const CURATED_UNTIL = ADMIN_CHANGELOG.reduce((max, e) => (e.date > max ? e.date : max), "");

function matchesSource(r: Row, source: Source): boolean {
  if (source === "all") return true;
  if (source === "curated") return !r.auto;
  if (source === "auto") return r.auto;
  return !r.auto || r.date > CURATED_UNTIL;
}

const MONTHS = [...new Set(ROWS.map((r) => r.date.slice(0, 7)))];

/**
 * 변경 기록 tab: admin-only changes kept out of the public /patch-notes —
 * hand-curated rows plus every admin-scoped commit collected at build time.
 */
export default function ChangelogTab() {
  const [type, setType] = useState<ChangeType | "all">("all");
  const [month, setMonth] = useState("all");
  const [source, setSource] = useState<Source>("default");

  const rows = useMemo(
    () =>
      ROWS.filter(
        (r) =>
          (type === "all" || r.type === type) &&
          (month === "all" || r.date.startsWith(month)) &&
          matchesSource(r, source),
      ),
    [type, month, source],
  );

  return (
    <Panel
      title="🗒 관리자 변경 기록"
      note="공개 패치노트에는 싣지 않는 관리자 전용 변경 이력입니다. admin·visitors·analytics 커밋은 배포 때마다 자동으로 추가되고, '기본'은 정리된 기록과 겹치는 자동 기록을 숨깁니다."
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {TYPES.map((t) => (
          <Chip key={t} active={type === t} onClick={() => setType(t)}>
            {t === "all" ? "모든 종류" : TYPE_LABEL[t]}
          </Chip>
        ))}
        <select
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded-lg border border-white/15 bg-transparent px-2 py-1 text-xs light:border-slate-300"
          aria-label="월 선택"
        >
          <option value="all">모든 달</option>
          {MONTHS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        {SOURCES.map((s) => (
          <Chip key={s.key} active={source === s.key} onClick={() => setSource(s.key)}>
            {s.label}
          </Chip>
        ))}
        <span className="text-xs text-white/40 light:text-slate-500">{rows.length}건</span>
      </div>
      {rows.length === 0 ? (
        <Empty>조건에 맞는 기록이 없습니다.</Empty>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.key} className="flex gap-3 text-sm">
              <span className="shrink-0 tabular-nums text-white/50 light:text-slate-500">{r.date}</span>
              <span className="shrink-0 rounded bg-white/10 px-1.5 text-xs leading-5 light:bg-slate-200">{TYPE_LABEL[r.type]}</span>
              <span className={r.auto ? "text-white/70 light:text-slate-600" : undefined} title={r.original}>
                {r.desc}
                {r.auto && (
                  <span className="ml-1.5 text-xs text-white/35 light:text-slate-400">
                    🤖 {r.scope} · {r.key}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
