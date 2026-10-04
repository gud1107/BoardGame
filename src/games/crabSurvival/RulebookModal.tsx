"use client";

import Overlay from "@/components/Overlay";
import { BOXES, CREATURES, FOODS, GEAR_RARITY, GEAR_STACK_CD, GEAR_STACK_DMG, GEAR_STACK_MAX, gearDropOdds, GEARS, LEVELS, MAX_GEAR, MUTATION_LIST, roadmap, SHIELDS, SPECIES_LIST, TIERS, WEAPONS } from "./data";

const H3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";
const P = "text-white/70 light:text-slate-600";
const TD = "px-2 py-1 border-t border-white/10 light:border-slate-200";

export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="📖 꽃게 서바이벌 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80 light:text-slate-700">
        <section>
          <h3 className={H3}>목표</h3>
          <p className={P}>
            해변 섬에 떨어진 <b>아기 꽃게</b>가 되어 AI 게 13마리와 생존 경쟁을 벌입니다. 음식과 작은 생물을 먹고, 상자를 부숴
            무기·방패를 챙기고, 다른 게를 뒤집어 점수를 빼앗으며 몸집을 키우세요. 제한 시간이 끝났을 때 <b>점수 순위</b>로
            최종 등수가 정해지고, 실시간 1위는 <b>👑 킹 크랩</b>이 되어 모두의 표적이 됩니다.
          </p>
        </section>

        <section>
          <h3 className={H3}>조작법</h3>
          <ul className={`list-disc space-y-1.5 pl-4 ${P}`}>
            <li>
              <b>PC</b>: 마우스 커서 쪽으로 이동하며 커서 방향을 바라봅니다(🖱️ 버튼으로 끄면 <b>WASD/방향키 이동 + 마우스 조준</b>). <b>좌클릭 / 스페이스 / J</b> 집게 공격(누르고 있으면 연속 공격),{" "}
              <b>우클릭 / Shift / K</b> 부스트, <b>E / Q / L</b> 티어 특수기, Esc·P 일시정지.
            </li>
            <li>
              <b>모바일</b>: 화면 아무 곳이나 눌러 끌면 조이스틱. 🦀 버튼 공격(가까운 대상 자동 조준), 💨 버튼 부스트, 그 위 노란 버튼이 티어 특수기(남은 쿨타임 숫자 표시).
            </li>
            <li>
              <b>부스트</b>: 이동 속도 +50%, 스태미나를 소모합니다. 손을 떼고 2초 뒤부터 빠르게 다시 찹니다.
            </li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>성장 단계 (기본: 꽃게 로드맵 12단계)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-center text-xs">
              <thead className="text-white/50 light:text-slate-500">
                <tr>
                  <th className="px-2 py-1">단계</th>
                  <th className="px-2 py-1">필요 점수</th>
                  <th className="px-2 py-1">크기</th>
                  <th className="px-2 py-1">공격력</th>
                  <th className="px-2 py-1">체력</th>
                  <th className="px-2 py-1">속도</th>
                  <th className="px-2 py-1">흡수 배율</th>
                </tr>
              </thead>
              <tbody>
                {LEVELS.map((l) => (
                  <tr key={l.level}>
                    <td className={TD}>
                      Lv{l.level} {l.name}
                    </td>
                    <td className={`${TD} tabular-nums`}>{l.points.toLocaleString()}</td>
                    <td className={TD}>{l.scale}x</td>
                    <td className={TD}>{l.atk}</td>
                    <td className={`${TD} tabular-nums`}>{l.hp.toLocaleString()}</td>
                    <td className={TD}>{l.speedLabel}</td>
                    <td className={TD}>×{l.gain}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={`mt-2 text-xs ${P}`}>
            몸집이 커질수록 공격력·체력·사정거리가 늘고 카메라가 멀어져 시야가 넓어지지만, 느려지고 피격 판정도 커집니다.
            <b> 흡수 배율</b>만큼 음식·생물·상자 코인 점수를 더 받습니다. 레벨업하면 체력이 비율대로 늘고 최대 체력의 12%를 즉시 회복합니다. <b>하이퍼 성장</b> 업데이트로 초반(Lv2~6) 필요 점수를 40% 줄이고 🍌바나나·🦪조개 점수를 2.5배로 올려, 초반 1~3분 안에 Tier 3까지 도달할 수 있습니다. 후반 구간은 새 무기·변이·특수기로 늘어난 수입에 맞춰 다시 조정했습니다(킹 크랩 도달이 이전보다 약 2배 빠름).
          </p>
        </section>

        <section>
          <h3 className={H3}>성장 경로 (게 종류)</h3>
          <p className={`mb-2 text-xs ${P}`}>
            로비에서 고른 게 종류에 따라 위 표에 능력치 배율이 붙고, 레벨업 필요 점수 곡선도 달라집니다. 레벨업할 때마다 종류별 <b>특성</b>이 잠깐 발동합니다. 꽃게 외 경로는 누적 🏆 트로피로 해금되며(1위 +30 · 2위 +20 · 3위 +14 · 상위 절반 +8 · 그 외 +2), 종류별 전적(최고 점수·1위 횟수)이 따로 기록됩니다. AI 게들은 무작위 종류로 등장합니다.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-center text-xs">
              <thead className="text-white/50 light:text-slate-500">
                <tr>
                  <th className="px-2 py-1">종류</th>
                  <th className="px-2 py-1">공격</th>
                  <th className="px-2 py-1">체력</th>
                  <th className="px-2 py-1">속도</th>
                  <th className="px-2 py-1">특성</th>
                  <th className="px-2 py-1">Lv7 필요</th>
                  <th className="px-2 py-1">Lv12 필요</th>
                  <th className="px-2 py-1">레벨업 특성</th>
                  <th className="px-2 py-1">해금</th>
                </tr>
              </thead>
              <tbody>
                {SPECIES_LIST.map((sp) => {
                  const road = roadmap(sp.id);
                  const extra = [
                    sp.crit > 0 ? `치명 +${Math.round(sp.crit * 100)}%` : "",
                    sp.staminaDrain < 1 ? `부스트 소모 -${Math.round((1 - sp.staminaDrain) * 100)}%` : "",
                    sp.regen > 1 ? `회복 +${Math.round((sp.regen - 1) * 100)}%` : "",
                    sp.scale !== 1 ? `몸집 ×${sp.scale}` : "",
                  ].filter(Boolean);
                  return (
                    <tr key={sp.id}>
                      <td className={TD}>
                        <b>{sp.name}</b> {sp.role}
                      </td>
                      <td className={TD}>×{sp.atk}</td>
                      <td className={TD}>×{sp.hp}</td>
                      <td className={TD}>×{sp.speed}</td>
                      <td className={TD}>{extra.join(" · ") || "—"}</td>
                      <td className={`${TD} tabular-nums`}>{road[6].points.toLocaleString()}</td>
                      <td className={`${TD} tabular-nums`}>{road[11].points.toLocaleString()}</td>
                      <td className={TD}>
                        {sp.perk.icon} {sp.perk.name} — {sp.perk.desc}
                      </td>
                      <td className={TD}>{sp.unlock === 0 ? "기본" : `🏆 ${sp.unlock}`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h3 className={H3}>전투</h3>
          <ul className={`list-disc space-y-1.5 pl-4 ${P}`}>
            <li>공격은 바라보는 방향의 <b>부채꼴 범위</b> 안 모든 대상(게·생물·상자)을 한 번에 칩니다. 맨손이면 양쪽 집게를 번갈아 휘두릅니다.</li>
            <li>
              <b>콤보</b>: 1.6초 안에 연속으로 맞히면 콤보가 쌓여 피해가 콤보당 +8%(최대 +80%)되고, 3콤보부터 보너스 점수를 받습니다.
            </li>
            <li>
              <b>치명타!</b> 기본 8% + 무기 보너스 확률로 ×1.75. <b>일격!</b> 한 방에 상대 최대 체력의 30% 이상을 깎은 공격.
            </li>
            <li>
              <b>반격!</b> 맞은 뒤 0.45초 안에 나를 때린 상대를 되받아치면 ×1.5.
            </li>
            <li>
              <b>방패 가드</b>: 방패를 든 게는 <b>정면 ±60°</b>에서 들어온 공격을 방패 등급만큼(50~70%) 줄이고 넉백·기절도 막습니다. 뒤나 옆을 노리세요!
            </li>
            <li>
              <b>내구도</b>: 무기는 살아있는 대상을 맞힌 공격마다, 방패는 막을 때마다 1씩 닳고 0이 되면 <b>파괴!</b>됩니다. 더 좋은 장비를 밟으면 자동으로 바꿔 끼고 쓰던 것은 바닥에 떨어뜨립니다.
            </li>
            <li>공격이 명중하면 짧은 역경직(0.05초)과 화면 흔들림이 생기고, 피해 숫자가 떠오릅니다.</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>장비</h3>
          <div className="grid gap-1.5 text-xs sm:grid-cols-2">
            {Object.values(WEAPONS).map((wd) => (
              <div key={wd.kind} className="rounded-md bg-white/5 px-2 py-1.5 light:bg-slate-100">
                <b>
                  {wd.emoji} {wd.name}
                </b>{" "}
                <span className="text-white/50 light:text-slate-500">
                  {wd.family === "blunt" ? "둔기 · 넉백/기절" : wd.family === "blade" ? "절단 · 빠름/치명타" : "중화기 · 광역 일격"}
                </span>
                <div className="text-white/60 light:text-slate-600">
                  피해 ×{wd.dmg} · 공속 {wd.cooldown}s · 치명 +{Math.round(wd.crit * 100)}% · 내구도 {wd.durability}
                </div>
              </div>
            ))}
            {Object.values(SHIELDS).map((sd) => (
              <div key={sd.kind} className="rounded-md bg-emerald-500/10 px-2 py-1.5">
                <b>
                  {sd.emoji} {sd.name}
                </b>
                <div className="text-white/60 light:text-slate-600">
                  정면 피해 -{Math.round(sd.block * 100)}% · 내구도 {sd.durability}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className={H3}>진화 티어 · 게딱지 특수기</h3>
          <p className={`mb-2 text-xs ${P}`}>
            레벨이 오르면 4단계로 <b>진화</b>합니다. 티어 보너스는 누적되며, 티어마다 <b>E 키(모바일 노란 버튼)</b>로 쓰는 특수기가 바뀝니다. 기획서의 Tier 4(Lv15)는 최대 레벨(12)을 넘으므로 Lv11에서 열립니다.
          </p>
          <div className="grid gap-1.5 text-xs sm:grid-cols-2">
            {Object.values(TIERS).map((t) => (
              <div key={t.tier} className="rounded-md bg-white/5 px-2 py-1.5 light:bg-slate-100">
                <b>
                  Tier {t.tier} {t.name}
                </b>{" "}
                <span className="text-white/50 light:text-slate-500">Lv{t.level}~ · {t.passive}</span>
                <div className="text-white/60 light:text-slate-600">
                  {t.skillIcon} <b>{t.skillName}</b> (쿨타임 {t.skillCooldown}초) — {t.skillDescription}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className={H3}>필드 드롭 해저 무기 (자동 발사)</h3>
          <p className={`mb-2 text-xs ${P}`}>
            생물을 처치하거나(꼬마 게·물고기 6%·가재 25%·바다거북 70%·대왕 랍스터 100%) 황금 상자를 열면(100%), 나무 상자에서도 22% 확률로 반짝이는 해저 무기가 떨어집니다. 밟으면 집게에 장착되어 <b>가장 가까운 적을 향해 자동으로 발사</b>되고, 정해진 시간이 지나면 사라집니다. 최대 {MAX_GEAR}개까지 동시에 들 수 있고, <b>같은 무기를 또 주우면 ★강화</b>(최대 ★{GEAR_STACK_MAX}) — 별 하나마다 피해 +{Math.round(GEAR_STACK_DMG * 100)}%·연사 +{Math.round(GEAR_STACK_CD * 100)}%, 시간도 다시 찹니다(★{GEAR_STACK_MAX} 산탄총은 7발). ★{GEAR_STACK_MAX} 무기는 탄환·톱날·지뢰·번개가 커지고 금빛으로 바뀝니다. 꽉 찬 상태에서는 등급이 가장 낮은(같으면 시간이 가장 적게 남은) 무기와 교체하고, 더 높은 등급 무기는 언제든 낮은 등급을 밀어냅니다(낮은 등급은 높은 등급의 시간이 25% 미만 남았을 때만 교체). 무기는 <b>일반 · 희귀 · 전설</b> 등급이 있고 높을수록 드물게 떨어지는 대신 더 강합니다 — 희귀는 피해 +15%·사용 시간 +20%, 전설은 피해 +30%·사용 시간 +40%(아래 수치에 반영됨). 황금 상자와 대왕 랍스터는 희귀 이상만 떨어뜨리고, 전설 무기는 바닥에 금빛 기둥이 솟습니다. 전설 무기를 주우면 <b>섬 전체에 알림</b>이 가고 미니맵에 금빛 점으로 표시되며, AI 게들이 멀리서도 몰려와 노립니다 — 쓰러뜨리면 <b>💰 현상금</b>(3,000 + 상대 레벨×500점, 상대가 전설을 들고 버틴 1초마다 +120점·최대 +15,000)을 받고 그 전설 무기도 빼앗을 수 있습니다. 반대로 내가 전설을 들고 버티면 5초마다 <b>🛡 생존 보상</b>(150점 × 흡수 배율)을 받고, 머리 위 현상금 숫자가 계속 커집니다. 현상금이 <b>10,000점</b>을 넘으면 <b>🚨 현상수배</b>가 되어 섬 전체에 알려지고 미니맵에 크고 빨간 점으로 표시됩니다. 게 종류별로 <b>최다 현상금</b>(한 판에 받은 현상금 합계)과 <b>최장 전설 보유</b> 시간이 기록됩니다. 장착 중인 집게 공격과는 따로 작동하며, 무기 피해는 내 레벨 공격력에 비례합니다. 게가 쓰러지면 남은 시간이 가장 긴 무기를 떨어뜨립니다.
          </p>
          <div className="grid gap-1.5 text-xs sm:grid-cols-2">
            {Object.values(GEARS).map((g) => (
              <div key={g.kind} className="rounded-md bg-cyan-500/10 px-2 py-1.5" style={{ boxShadow: `inset 3px 0 0 ${GEAR_RARITY[g.rarity].color}` }}>
                <b style={{ color: GEAR_RARITY[g.rarity].color }}>[{GEAR_RARITY[g.rarity].label}]</b>{" "}
                <b>
                  {g.emoji} {g.name}
                </b>{" "}
                <span className="text-white/50 light:text-slate-500">{g.desc}</span>
                <div className="text-white/60 light:text-slate-600">
                  피해 ×{g.dmg}
                  {g.kind === "shotgun" ? "(발당)" : g.kind === "vortex" ? "(0.25초마다)" : ""} · 쿨타임 {g.cooldown}s · 사용 시간 {g.duration}초 · 드롭 {Math.round(gearDropOdds()[g.kind] * 100)}%
                  {g.rarity !== "common" && <> (황금 상자 {Math.round(gearDropOdds("rare")[g.kind] * 100)}%)</>}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className={H3}>변이 아이템 (강화 · 리스크)</h3>
          <p className={`mb-2 text-xs ${P}`}>
            섬 곳곳(항상 26개 유지)에 놓이고 생물을 잡으면 12% 확률로 떨어지는 변이 아이템은 먹는 순간 효과가 걸립니다. 🟢 초록 빛은 순수 강화, 🔴 빨간 빛은 강력하지만 대가가 따르는 리스크 아이템입니다. 리스크 아이템의 <b>벌칙은 처음 몇 초만</b> 걸리고 이점은 그보다 오래 남으니, 벌칙이 끝날 때까지 버티면 이득만 남습니다. 바닥의 바닥의 검은 <b>기름 웅덩이</b>는 함정입니다. 같은 변이를 다시 먹으면 시간이 갱신됩니다. AI 게들도 먹습니다 — 대담한 게일수록 리스크 아이템을 노립니다.
          </p>
          <div className="grid gap-1.5 text-xs sm:grid-cols-2">
            {MUTATION_LIST.map((m) => (
              <div key={m.kind} className={`rounded-md px-2 py-1.5 ${m.risk ? "bg-rose-500/10" : "bg-emerald-500/10"}`}>
                <b>
                  {m.emoji} {m.name}
                </b>{" "}
                <span className="text-white/50 light:text-slate-500">{m.good ? `${m.duration}초` : ""}</span>
                <div className="text-white/60 light:text-slate-600">
                  {m.good && <>▲ {m.good}</>}
                  {m.good && m.bad ? " · " : ""}
                  {m.bad && (
                    <span className="text-rose-300 light:text-rose-600">
                      ▼ {m.bad} ({m.penalty ?? m.duration}초)
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className={H3}>섬의 오브젝트</h3>
          <ul className={`list-disc space-y-1.5 pl-4 ${P}`}>
            <li>
              <b>음식</b>:{" "}
              {Object.values(FOODS)
                .filter((f) => f.weight > 0)
                .map((f) => `${f.emoji}${f.name} ${f.points}`)
                .join(" · ")}{" "}
              점(× 흡수 배율) + 약간의 체력 회복. 🍖고기는 쓰러진 생물·게가 떨어뜨립니다.
            </li>
            <li>
              <b>생물</b>:{" "}
              {Object.values(CREATURES)
                .map((c) => `${c.name} ${c.points.toLocaleString()}점${c.atk > 0 ? "(반격함)" : ""}`)
                .join(" · ")}
              . 물고기는 얕은 물가에만 삽니다. 대왕 랍스터는 작은 게가 다가오면 먼저 공격합니다.
            </li>
            <li>
              <b>{BOXES.wood.name}</b>: 집게로 여러 번 쳐서 부수면 무기/방패와 코인이 튀어나옵니다.
            </li>
            <li>
              <b>{BOXES.gold.name}</b>: 잠겨 있어 <b>🔑 열쇠</b>를 들고 한 번 치면 열립니다. 상급 무기·방패와 대량의 코인, 수박이 나옵니다. 열쇠는 한 번에 하나만 들 수 있고, 절반은 <b>바위 고리 안쪽</b>에 숨어 있습니다.
            </li>
            <li>
              <b>바위 고리</b>: 바위 사이 틈은 <b>몸집 1.4배 이하의 작은 게만</b> 빠져나갈 수 있습니다. 큰 게에게 쫓기면 틈으로 도망치세요.
            </li>
            <li>
              <b>💧 치유의 웅덩이</b>: 안에 있으면 매초 최대 체력의 5%를 회복합니다. 전투 없이 5초가 지나도 천천히 회복됩니다.
            </li>
            <li>얕은 물가에서는 이동 속도가 느려집니다.</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>킹 크랩 · 사망 · 정산</h3>
          <ul className={`list-disc space-y-1.5 pl-4 ${P}`}>
            <li>실시간 1위는 황금 왕관을 쓰고 전체 방송으로 알려지며, 모든 게의 화면 가장자리와 미니맵에 위치 핑이 표시됩니다. 도전자는 왕보다 5% 이상(최소 300점) 앞서야 왕관을 빼앗습니다.</li>
            <li>
              게를 뒤집으면 상대 점수의 20% + 레벨×150점을 받고, 상대 점수의 25%가 코인으로 흩어지며 장비·열쇠도 떨어집니다. <b>킹 크랩을 쓰러뜨리면</b> 점수의 30%와 10,000점이 추가됩니다.
            </li>
            <li>
              내가 뒤집히면 <b>❤️ 부활</b>(경기당 1회 — 점수 50%와 내구도 절반의 장비 유지) 또는 <b>게임 종료</b>(사망 시점 점수로 정산)를 고릅니다. AI 게는 4초 뒤 아기 게로 다시 태어납니다.
            </li>
            <li>시간이 끝나면 점수 순위로 등수가 매겨지고, 등수에 따라 트로피를 받습니다.</li>
          </ul>
        </section>
      </div>
    </Overlay>
  );
}
