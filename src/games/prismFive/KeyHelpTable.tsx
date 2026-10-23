"use client";

import { Fragment } from "react";
import { KEY_HELP } from "./data";

/** Every control in one table — shared by the rulebook, the menu and the in-game ⌨️ overlay. */
export default function KeyHelpTable({ compact = false }: { compact?: boolean }) {
  const groups = [...new Set(KEY_HELP.map((k) => k.group))];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="text-white/50 light:text-slate-500">
          <tr>
            <th className="px-2 py-1">동작</th>
            <th className="px-2 py-1">PC 키</th>
            <th className="px-2 py-1">모바일</th>
            {!compact && <th className="px-2 py-1">설명</th>}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <Fragment key={g}>
              <tr>
                <td colSpan={compact ? 3 : 4} className="px-2 pt-2 pb-0.5 text-[10px] font-bold tracking-wide text-yellow-300/80 light:text-amber-600">
                  {g}
                </td>
              </tr>
              {KEY_HELP.filter((k) => k.group === g).map((k) => (
                <tr key={k.action} className="border-t border-white/10 light:border-slate-200">
                  <td className="px-2 py-1 font-bold whitespace-nowrap">{k.action}</td>
                  <td className="px-2 py-1 font-mono whitespace-nowrap">
                    {k.pc.split(" · ").map((key, i) => (
                      <span key={key}>
                        {i > 0 && <span className="text-white/40"> / </span>}
                        <kbd className="rounded border border-white/20 bg-white/10 px-1 py-0.5 text-[11px] light:border-slate-300 light:bg-slate-100">{key}</kbd>
                      </span>
                    ))}
                  </td>
                  <td className="px-2 py-1 whitespace-nowrap">{k.mobile}</td>
                  {!compact && <td className="px-2 py-1 text-white/60 light:text-slate-500">{k.note ?? ""}</td>}
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
