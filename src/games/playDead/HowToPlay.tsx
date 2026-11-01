"use client";

import { useState } from "react";
import { DMG, FINISH_COST, LOOT_TAKE, MAX_AMMO, MAX_LIE, START_HP, SURGE_ROUND } from "./engine";

/**
 * 📖 게임 방법 — 게임 화면 안에서 펼쳐 보는 규칙 요약. 첫 라운드엔 펼쳐서 시작한다.
 * 숫자는 엔진 상수에서 바로 읽어 룰과 어긋나지 않게 한다.
 */

const range = (r: readonly [number, number]) => (r[0] === r[1] ? `${r[0]}` : `${r[0]}~${r[1]}`);

function Row({ icon, name, cost, text }: { icon: string; name: string; cost?: string; text: string }) {
  return (
    <li className="flex gap-2">
      <span className="w-5 shrink-0 text-center">{icon}</span>
      <span className="min-w-0 break-keep">
        <b className="text-white light:text-slate-900">{name}</b>
        {cost && <span className="ml-1 text-[11px] text-amber-300 light:text-amber-600">{cost}</span>} — {text}
      </span>
    </li>
  );
}

export default function HowToPlay({ startOpen }: { startOpen: boolean }) {
  const [open, setOpen] = useState(startOpen);
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] light:border-slate-200 light:bg-white">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-semibold text-white/85 light:text-slate-800">
        <span>📖 게임 방법</span>
        <span className="text-xs font-normal text-white/50 light:text-slate-400">{open ? "접기 ▲" : "펼치기 ▼"}</span>
      </button>
      {open && (
        <div className="grid gap-3 border-t border-white/10 px-3 py-3 text-[13px] leading-relaxed text-white/75 light:border-slate-200 light:text-slate-600 sm:grid-cols-2">
          <section className="flex flex-col gap-1.5 sm:col-span-2">
            <p className="break-keep">
              <b className="text-amber-300 light:text-amber-600">🎯 목표</b> — 마지막까지 살아남기. 모두 목숨 {START_HP}(남은 목숨은 나만 봐요)·탄약 0발로 시작해요.
            </p>
            <p className="break-keep">
              <b className="text-amber-300 light:text-amber-600">🔁 한 라운드</b> — ① 행동 카드 1장을 몰래 골라 <b>결정!</b> → ② “준비! 조준! 발사!”에 모두 동시에 공개 → ③ 결과. 시간이 지나면 서 있는 사람은 장전, 누운 사람은 숨죽이기가 들어가요.
            </p>
            <p className="break-keep rounded-lg bg-rose-500/10 px-2 py-1.5 text-rose-100 light:bg-rose-50 light:text-rose-800">
              💀 <b>핵심</b> — 맞으면 살았든 죽었든 <b>무조건 쓰러져요.</b> 피해량은 맞은 사람만 알아서, 쓰러진 사람이 진짜 죽었는지 죽은 척인지 아무도 몰라요. 그래서 평소엔 모두 엎드려 있어요.
            </p>
          </section>
          <section>
            <h4 className="mb-1 text-xs font-semibold text-white/60 light:text-slate-500">🧍 서 있을 때</h4>
            <ul className="flex flex-col gap-1">
              <Row icon="🔄" name="장전" text={`탄약 +1발 (최대 ${MAX_AMMO}발)`} />
              <Row icon="🪖" name="엄폐" text="사격·연사를 피해요. 수류탄은 1만 들어와요. 두 라운드 연속은 안 돼요" />
              <Row icon="🔫" name="사격" cost="1발" text={`피해 ${range(DMG.shot)}`} />
              <Row icon="💥" name="연사" cost="2발" text={`피해 ${range(DMG.burst)}`} />
              <Row icon="💣" name="수류탄" cost="3발" text={`피해 ${range(DMG.grenade)}, 엄폐해도 1`} />
              <Row icon="🎒" name="탄약 뺏기" text={`쓰러진 몸에서 ${LOOT_TAKE}발 — 살아 있던 상대가 기습하면 내가 ${range(DMG.ambushLooter)} 피해`} />
              <Row icon="🔪" name="확인사살" cost={`${FINISH_COST}발`} text={`죽은 척이면 ${range(DMG.finish)} 피해 + 정체 폭로, 진짜 시체면 사망 확인`} />
            </ul>
            <p className="mt-1.5 break-keep text-xs text-white/55 light:text-slate-500">서로를 쏘면 화력(사격 &lt; 연사 &lt; 수류탄)이 센 쪽이 제압, 같으면 맞사격으로 둘 다 빗나가요.</p>
          </section>
          <section>
            <h4 className="mb-1 text-xs font-semibold text-white/60 light:text-slate-500">💀 쓰러져 있을 때</h4>
            <ul className="flex flex-col gap-1">
              <Row icon="🤫" name="숨죽이기" text="계속 누워 있어요. 누운 사람은 총의 표적이 안 돼요" />
              <Row icon="🧍" name="일어나기" text="털고 일어나요 (살아 있다는 게 드러나요)" />
              <Row icon="⚡" name="벌떡 기습" text={`일어나며 피해 ${range(DMG.ambush)}, 나를 털러 온 상대면 ${range(DMG.ambushLooter)}`} />
            </ul>
            <h4 className="mb-1 mt-2 text-xs font-semibold text-white/60 light:text-slate-500">🕵️ 누가 진짜 죽었을까?</h4>
            <ul className="flex list-disc flex-col gap-0.5 pl-4 text-xs">
              <li className="break-keep">참가자 표의 ‘맞은 피해’ 범위와 ‘살아 있을 확률’을 보세요.</li>
              <li className="break-keep">살아 있으면 {MAX_LIE}라운드째에 숨이 차서 일어나요 — 그보다 오래 누워 있으면 진짜 시체.</li>
              <li className="break-keep">진짜로 죽어도 남들은 몰라요. 끝까지 연기하세요!</li>
              <li className="break-keep">🔥 {SURGE_ROUND}라운드부터 총공세 — 모든 피해 +1.</li>
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
