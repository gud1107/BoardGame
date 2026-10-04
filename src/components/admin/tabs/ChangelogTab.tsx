import { ADMIN_CHANGELOG } from "@/constants/adminChangelog";
import { Panel } from "../adminUi";

const TYPE_LABEL = { FEAT: "추가", FIX: "수정", IMPROVE: "개선" } as const;

/** 변경 기록 tab: admin-only changes kept out of the public /patch-notes. */
export default function ChangelogTab() {
  return (
    <Panel title="🗒 관리자 변경 기록" note="공개 패치노트에는 싣지 않는 관리자 전용 기능의 변경 이력입니다.">
      <ul className="space-y-2">
        {ADMIN_CHANGELOG.map((e, i) => (
          <li key={i} className="flex gap-3 text-sm">
            <span className="shrink-0 tabular-nums text-white/50 light:text-slate-500">{e.date}</span>
            <span className="shrink-0 rounded bg-white/10 px-1.5 text-xs leading-5 light:bg-slate-200">{TYPE_LABEL[e.type]}</span>
            <span>{e.desc}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
