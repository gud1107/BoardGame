"use client";

import Overlay from "@/components/Overlay";
import { AUG_PICK_SECONDS, AUG_ROUNDS, AUG_TIER_NAME, AUGMENT_LIST, DOCTRINES, ERA_DOCTRINES, ERA_TURRETS, ERA_UNITS, ERAS, ITEMS, PLANS, ROLE_ICON, SHOP_BUDGET, SPECIALS, TICKS_PER_SEC, TURRETS, UNITS, type Era } from "./data";

const H3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";
const P = "text-white/70 light:text-slate-600";
const TD = "px-2 py-1 border-t border-white/10 light:border-slate-200";

export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="📖 시대의 진격 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80 light:text-slate-700">
        <section>
          <h3 className={H3}>목표</h3>
          <p className={P}>
            한 줄 전장의 양 끝에 기지가 있습니다. 골드로 유닛을 생산하면 유닛이 스스로 전진해 싸웁니다. <b>상대 기지 HP를 0으로</b> 만들면 승리.
            12분이 지나면 <b>서든데스</b> — 양쪽 기지가 매초 최대 HP의 1.5%씩 무너집니다. 같은 순간 둘 다 무너지면 남은 HP 비율이 높은 쪽이 이깁니다.
          </p>
        </section>
        <section>
          <h3 className={H3}>🛒 전략 상점 (매 판 시작 전)</h3>
          <p className={P}>지휘 노선 1개를 고르고 ★{SHOP_BUDGET} 안에서 준비물을 삽니다. 상대의 선택은 전투 직전 카운트다운에 공개됩니다. 온라인은 40초 안에 고르지 않으면 그때 선택이 자동 확정됩니다.</p>
          <ul className={`mt-1 list-disc space-y-1 pl-4 ${P}`}>
            {Object.values(PLANS).map((pl) => (
              <li key={pl.id}>{pl.emoji} <b>{pl.name}</b>: {pl.pros.join(" · ")} / <span className="text-rose-300">{pl.cons}</span></li>
            ))}
          </ul>
          <ul className={`mt-2 list-disc space-y-1 pl-4 ${P}`}>
            {Object.values(ITEMS).map((it) => (
              <li key={it.id}>{it.emoji} <b>{it.name}</b> ({"★".repeat(it.cost)}): {it.desc}</li>
            ))}
          </ul>
        </section>
        <section>
          <h3 className={H3}>자원</h3>
          <ul className={`list-disc space-y-1 pl-4 ${P}`}>
            <li><b>기본 수입</b>: 시대별 초당 {ERAS.map((e) => e.income).join(" / ")} 골드</li>
            <li><b>처치 보상</b>: 잡은 유닛 비용의 62% 골드 + 2배 XP. 나보다 <b>높은 시대</b> 유닛을 잡으면 ×1.5</li>
            <li><b>전선 수입</b>: 내 최전방이 중앙선을 넘어 100 전진할 때마다 초당 +1 (최대 +4)</li>
            <li><b>XP</b>: 처치 · 생산(비용의 50%) · 매초 시대 수입만큼 자동 획득</li>
          </ul>
        </section>
        <section>
          <h3 className={H3}>진화 (XP와 골드가 둘 다 필요)</h3>
          <table className="w-full text-left text-xs">
            <thead><tr><th className="px-2">시대</th><th className="px-2">필요 XP</th><th className="px-2">골드</th><th className="px-2">기지 HP</th><th className="px-2">교리 선택</th></tr></thead>
            <tbody>
              {ERAS.map((e) => {
                const pair = ERA_DOCTRINES[e.id as Era];
                return (
                  <tr key={e.id}>
                    <td className={TD}>{e.emoji} {e.name}</td>
                    <td className={TD}>{e.xpNeed || "-"}</td>
                    <td className={TD}>{e.goldCost || "-"}</td>
                    <td className={TD}>{e.baseHp}</td>
                    <td className={TD}>{pair ? pair.map((d) => `${DOCTRINES[d].emoji} ${DOCTRINES[d].name}`).join(" / ") : "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className={`mt-2 ${P}`}>상대가 이미 다음 시대라면 진화 골드 30% 할인. 진화하면 늘어난 최대 HP만큼 기지가 회복되고 필살기가 즉시 충전됩니다.</p>
        </section>
        <section>
          <h3 className={H3}>상성</h3>
          <p className={P}>⚔ 근접 ▶ 🐎 돌격 ▶ 🏹 원거리 ▶ ⚔ 근접 — 유리하면 피해 ×1.5(주황 숫자), 불리하면 ×0.75(회색 숫자). ✚ 지원은 상성 없음.</p>
          <p className={`mt-1 ${P}`}>시대마다 5종: 근접 · 원거리 · 돌격 · <b>✚ 지원</b>(가장 앞의 다친 아군을 치유, 최대 3명) · <b>🎯 공성</b>(느리고 약하지만 사거리가 길고 범위 공격, 기지에 2.5배 피해). 교리를 고르면 전용 유닛이 1종 더 생깁니다.</p>
        </section>
        <section>
          <h3 className={H3}>교리</h3>
          <ul className={`list-disc space-y-1 pl-4 ${P}`}>
            {Object.values(DOCTRINES).map((d) => (
              <li key={d.id}>{d.emoji} <b>{d.name}</b> ({ERAS[d.era].emoji}): {d.passive} + {UNITS[d.unit].emoji} {UNITS[d.unit].name} — {UNITS[d.unit].desc}</li>
            ))}
          </ul>
        </section>
        <section>
          <h3 className={H3}>✨ 증강 (전투 중 3장 중 1장)</h3>
          <p className={P}>
            {AUG_ROUNDS.map((r) => `${Math.floor(r.sec / 60)}:${String(r.sec % 60).padStart(2, "0")}`).join(" · ")}에 증강 카드 3장이 뜹니다. 하나를 고르면 그 판 끝까지 효과가 유지되고, 같은 증강은 두 번 나오지 않아요. 양쪽은 매번 <b>같은 등급</b>(실버/골드/프리즘)을 받고, 뒤로 갈수록 프리즘이 잘 나옵니다.
          </p>
          <p className={`mt-1 ${P}`}>솔로는 고르는 동안 전투가 멈춥니다. 온라인은 전투가 계속되고 {AUG_PICK_SECONDS}초 안에 고르지 않으면 첫 번째 카드가 자동 선택돼요. 🎲 다시 뽑기는 한 판에 1번. 상대가 고른 증강은 상대 기지 카드 아래에 보입니다.</p>
          {(["silver", "gold", "prism"] as const).map((t) => (
            <div key={t} className="mt-2">
              <div className="text-xs font-black text-white/80">{AUG_TIER_NAME[t]}</div>
              <ul className={`list-disc space-y-0.5 pl-4 ${P}`}>
                {AUGMENT_LIST.filter((a) => a.tier === t).map((a) => (
                  <li key={a.id}>{a.emoji} <b>{a.name}</b>: {a.desc}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>
        <section>
          <h3 className={H3}>유닛</h3>
          <table className="w-full text-left text-xs">
            <thead><tr><th className="px-2">유닛</th><th className="px-2">병종</th><th className="px-2">비용</th><th className="px-2">HP</th><th className="px-2">공격</th><th className="px-2">사거리</th></tr></thead>
            <tbody>
              {ERA_UNITS.flat().concat(Object.values(DOCTRINES).map((d) => d.unit)).map((k) => {
                const u = UNITS[k];
                return (
                  <tr key={k}>
                    <td className={TD}>{ERAS[u.era].emoji} {u.emoji} {u.name}</td>
                    <td className={TD}>{ROLE_ICON[u.role]}</td>
                    <td className={TD}>{u.cost}</td>
                    <td className={TD}>{u.hp}</td>
                    <td className={TD}>{u.atk}/{(u.cdTicks / TICKS_PER_SEC).toFixed(1)}s</td>
                    <td className={TD}>{u.range}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
        <section>
          <h3 className={H3}>포탑 · 필살기</h3>
          <p className={P}>
            기지 슬롯 3칸(2·3번은 250/900G로 개방). 포탑은 판매 시 50% 환급, 다른 포탑을 올리면 기존 것은 자동 판매. 적이 기지 150 안에 들어오면 <b>결사항전</b>으로 포탑 피해 +30%.
          </p>
          <ul className={`mt-1 list-disc space-y-1 pl-4 ${P}`}>
            {ERA_TURRETS.map((pair, i) => (
              <li key={i}>{ERAS[i].emoji} {pair.map((k) => `${TURRETS[k].emoji} ${TURRETS[k].name}(${TURRETS[k].cost}G${TURRETS[k].splash ? ", 범위" : ""})`).join(" · ")}</li>
            ))}
          </ul>
          <ul className={`mt-2 list-disc space-y-1 pl-4 ${P}`}>
            {SPECIALS.map((s) => (
              <li key={s.era}>{ERAS[s.era].emoji} {s.emoji} <b>{s.name}</b> — {s.desc}</li>
            ))}
          </ul>
        </section>
        <section>
          <h3 className={H3}>조작</h3>
          <p className={P}>1~5 유닛 생산 · E 진화 · R 필살기 · Q 포탑 패널 · Space 일시정지 · ←/→(A/D) 카메라 이동 · 휠/핀치 확대. 전장을 끌면 카메라가 움직이고, 4초 뒤 다시 전선을 따라갑니다. 위쪽 미니맵을 누르면 그 지점으로 이동. 생산 대기열을 누르면 취소(전액 환급).</p>
        </section>
      </div>
    </Overlay>
  );
}
