"use client";

import Overlay from "@/components/Overlay";
import { BOXES, CREATURES, FOODS, LEVELS, SHIELDS, WEAPONS } from "./data";

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
              <b>우클릭 / Shift / K</b> 부스트, Esc·P 일시정지.
            </li>
            <li>
              <b>모바일</b>: 화면 아무 곳이나 눌러 끌면 조이스틱. 🦀 버튼 공격(가까운 대상 자동 조준), 💨 버튼 부스트.
            </li>
            <li>
              <b>부스트</b>: 이동 속도 +50%, 스태미나를 소모합니다. 손을 떼고 2초 뒤부터 빠르게 다시 찹니다.
            </li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>성장 단계</h3>
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
            <b> 흡수 배율</b>만큼 음식·생물·상자 코인 점수를 더 받습니다. 레벨업하면 체력이 비율대로 늘고 최대 체력의 20%를 즉시 회복합니다.
          </p>
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
              <b>바위 고리</b>: 바위 사이 틈은 <b>Lv2 이하의 작은 게만</b> 빠져나갈 수 있습니다. 큰 게에게 쫓기면 틈으로 도망치세요.
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
