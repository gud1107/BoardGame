"use client";

import Overlay from "@/components/Overlay";
import KeyHelpTable from "./KeyHelpTable";
import { BOSSES, DIFFICULTIES, ENEMIES, HERO_ORDER, HEROES, MECHA, STAGES, STYLE_RANKS, TEAM_ULT, type MoveDef } from "./data";

const H3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";
const P = "text-white/70 light:text-slate-600";
const TD = "px-2 py-1 border-t border-white/10 light:border-slate-200";

const sec = (ticks?: number) => (ticks ? `${(ticks / 60).toFixed(1)}초` : "-");
const totalDmg = (m: MoveDef) => m.hits.reduce((s, h) => s + h.dmg, 0) + (m.proj ?? []).reduce((s, p) => s + p.hit.dmg * (1 + (p.fanZ?.length ?? 0)), 0);

export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="📖 섬광전대 프리즘파이브 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80 light:text-slate-700">
        <section>
          <h3 className={H3}>목표</h3>
          <p className={P}>
            암흑제국의 침공을 막는 <b>5인 전대 히어로</b>가 되어 횡스크롤 거리를 돌파합니다. 화면이 잠기면 <b>잔몹(졸개)</b>을 모두 쓰러뜨려야
            앞으로 갈 수 있고, 각 스테이지 끝에는 <b>괴인 보스</b>가 기다립니다. 보스를 쓰러뜨리면 <b>거대화</b>한 괴인과{" "}
            <b>{MECHA.name}</b>로 거대 로봇전을 벌이고, 체력을 25% 아래로 깎은 뒤 <b>필살 섬광 일도양단</b>으로 마무리하면 스테이지 클리어!
            5개 스테이지를 모두 클리어하면 엔딩입니다.
          </p>
        </section>

        <section>
          <h3 className={H3}>조작법 · 모든 단축키</h3>
          <p className={`mb-2 ${P}`}>
            게임 중 <b>?</b> 또는 <b>F1</b>(모바일은 ⌨️ 버튼)을 누르면 언제든 이 표를 다시 볼 수 있습니다. 모바일은 왼쪽 절반을 끌면 조이스틱이 생깁니다.
          </p>
          <KeyHelpTable />
        </section>

        <section>
          <h3 className={H3}>게이지</h3>
          <ul className={`list-disc space-y-1 pl-4 ${P}`}>
            <li><b>HP</b>(초록): 0이 되면 변신 해제 → 남은 <b>변신 스톡</b>이 있으면 체력 가득 재변신(주변 적을 날려 보냄), 없으면 게임 오버.</li>
            <li><b>EN</b>(파랑): 스킬 비용. 초당 2씩, 타격마다 +1.2, 섬광 회피 +15, 에너지 크리스탈 +40.</li>
            <li><b>필살 게이지</b>(무지개): 준 피해·받은 피해·섬광 회피로 충전. 가득 차면 <b>필살기</b>(컷인 연출 + 화면 전체 공격, 사용 중 무적).</li>
            <li><b>팀 스톡</b>(◆ 최대 3): 타격 40회마다 1개. 1개로 동료 1명 <b>어시스트</b> 호출, 3개가 모두 차 있으면 <b>5인 합동기 「{TEAM_ULT.name}」</b>.</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>콤보 · 캔슬 규칙</h3>
          <ul className={`list-disc space-y-1 pl-4 ${P}`}>
            <li><b>약공격 연타</b> = 영웅별 3~5연격 체인. 마지막 타는 적을 날려 보냅니다.</li>
            <li><b>약공격 2타 이상 → 강공격</b> = <b>피니셔</b>(큰 넉백·브레이크 피해). 약공격 1타 이하 → 강공격 = <b>띄우기</b>.</li>
            <li><b>띄우기 적중 직후 점프</b> = <b>점프 추격</b> → 공중 약공격 체인 → 공중 강공격(<b>다이브</b>: 내리꽂아 지면 바운드 → 다시 띄울 수 있음).</li>
            <li>공중에서 적을 맞히면 잠깐 떠 있습니다(점프당 6회). 같은 적을 너무 오래 띄우면 무거워지고, 14타를 넘기면 <b>MAX</b> — 무적 상태로 떨어집니다.</li>
            <li><b>스킬 캔슬</b>: 일반기가 적중한 뒤엔 언제든 스킬로 캔슬. <b>회피 캔슬</b>: 적중 후 EN 10을 써서 회피로 끊기.</li>
            <li>달리면서 약공격 = 돌진기, 강공격 = 슬라이딩(낮은 띄우기).</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>피격 모션 (적·나 모두 동일)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <tbody>
                {[
                  ["경직 (상단/하단)", "약공격. 머리가 젖혀지거나 몸이 꺾이며 0.3초 행동 불가 — 번갈아 나옴"],
                  ["휘청", "강한 타격. 크게 뒤로 밀리며 0.5초 행동 불가"],
                  ["띄우기", "공중으로 떠오름. 공중 콤보 가능, 떨어지면 다운"],
                  ["다운 · 기상", "바닥에 누움 → 일어날 때 무적(적 0.2초 · 나 0.7초)"],
                  ["지면 바운드", "공중에서 내리꽂히면 한 번 튀어 올라 다시 띄울 수 있음"],
                  ["벽꽝", "화면이 잠긴 상태에서 빠르게 날아가 벽에 부딪히면 튕겨 나와 콤보 연장"],
                  ["바인드", "리본에 묶여 약 2초 행동 불가"],
                  ["회전 날아감", "필살기 마무리 타. 빙글빙글 돌며 날아감"],
                  ["잡기", "보스 크랩톤의 조이기 — 아무 버튼 연타로 빨리 탈출"],
                  ["낙법", "띄워져 떨어질 때 점프를 누르면 다운 없이 즉시 기상(무적 0.4초)"],
                ].map(([a, b]) => (
                  <tr key={a}>
                    <td className={`${TD} font-bold whitespace-nowrap`}>{a}</td>
                    <td className={TD}>{b}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h3 className={H3}>회피 · 섬광 회피 · 브레이크</h3>
          <ul className={`list-disc space-y-1 pl-4 ${P}`}>
            <li><b>회피</b>: 구르기(약 0.37초). 앞 0.25초는 무적. 방향 없이 누르면 뒤로.</li>
            <li><b>섬광 회피</b>: 공격이 닿기 직전(회피 시작 0.13초 안)에 피하면 <b>슬로 모션</b> + 필살 게이지 +15 + EN +15 + 스타일 대폭 상승.</li>
            <li><b>브레이크</b>: 보스·근위대장은 강한 공격에도 밀리지 않는 <b>슈퍼아머</b>. 대신 노란 브레이크 게이지가 쌓여 가득 차면 <b>BREAK!</b> — 약 3.7초 기절, 받는 피해 1.5배, 띄우기·콤보가 들어갑니다.</li>
            <li>적의 공격 전에는 머리 위에 <b className="text-red-400">!</b> 예고가 뜹니다(저격병은 붉은 조준선, 돌진은 붉은 길).</li>
            <li>공격 토큰: 한 번에 덤비는 졸개 수는 난이도별 최대 1/2/3명. 나머지는 주위를 맴돕니다.</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>히어로 5인</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {HERO_ORDER.map((id) => {
              const h = HEROES[id];
              return (
                <div key={id} className="rounded-lg border border-white/10 p-2 light:border-slate-200" style={{ borderLeft: `4px solid ${h.color}` }}>
                  <div className="font-black" style={{ color: h.color }}>
                    {h.name} <span className="text-xs font-semibold text-white/50 light:text-slate-500">({h.person}) {h.role} · {h.weapon}</span>
                  </div>
                  <div className="text-xs text-white/50 light:text-slate-500">HP {h.hp} · 속도 {h.speed} · 공격 ×{h.atk}{h.heavyArmor ? " · 강공격 슈퍼아머" : ""}</div>
                  <p className={`mt-1 text-xs ${P}`}>{h.blurb}</p>
                  <p className="mt-1 text-xs">
                    <b style={{ color: h.trim }}>고유 능력 · {h.traitName}</b> — {h.traitDesc}
                  </p>
                  <ul className="mt-1 space-y-0.5 text-xs">
                    <li>약공격 {h.chain.length}연격: {h.chain.map((m) => m.name).join(" → ")}</li>
                    <li>강공격 띄우기 {h.heavy.name} → 추가타 {h.heavy2.name} · 피니셔 {h.finisher.name} · 다이브 {h.airHeavy.name}</li>
                    <li>
                      <b>H</b> 견제기 {h.poke.name} (EN·쿨타임 없음) · 달리기 공격 {h.dashAtk.name} · 슬라이딩 {h.slide.name}
                    </li>
                    {h.skills.map((s, i) => (
                      <li key={s.id}>
                        <b>{"UIO"[i]}</b> {s.name} — EN {s.en} · 쿨 {sec(s.cd)} · 피해 약 {totalDmg(s)}
                        {s.invuln ? " · 무적" : ""}
                        {s.armor ? " · 슈퍼아머" : ""}
                      </li>
                    ))}
                    <li>
                      <b>F</b> 필살 {h.ult.name} · <b>어시스트</b> {h.assist.name}
                    </li>
                  </ul>
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <h3 className={H3}>잔몹 (암흑제국 전투원)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-white/50 light:text-slate-500">
                <tr>
                  <th className="px-2 py-1">이름</th>
                  <th className="px-2 py-1">HP</th>
                  <th className="px-2 py-1">공략</th>
                </tr>
              </thead>
              <tbody>
                {Object.values(ENEMIES).map((e) => (
                  <tr key={e.id}>
                    <td className={`${TD} font-bold whitespace-nowrap`}>{e.name}</td>
                    <td className={`${TD} tabular-nums`}>{e.hp}</td>
                    <td className={TD}>{e.blurb}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h3 className={H3}>스테이지 · 보스</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <tbody>
                {STAGES.map((s) => {
                  const bossId = s.waves.find((wv) => wv.boss)?.boss;
                  const b = bossId ? BOSSES[bossId] : null;
                  return (
                    <tr key={s.id}>
                      <td className={`${TD} font-bold whitespace-nowrap`}>{s.name}</td>
                      <td className={TD}>
                        {s.waves.filter((wv) => !wv.boss).length}개 구역 → {b ? `${b.title} ${b.name} (HP ${b.hp.toLocaleString()} · 브레이크 ${b.breakMax})` : ""}
                        {b && <div className="text-white/50 light:text-slate-500">{b.intro} 패턴: {b.patterns.map((p) => p.move.name).join(" · ")} — 체력 66%/33%에서 분노·최종 형태로 패턴 추가</div>}
                        {s.vents && <div className="text-orange-300">증기 배관: 4초마다 노란 구역에서 증기 분출 — 적도 휘말립니다</div>}
                      </td>
                      <td className={`${TD} whitespace-nowrap`}>기준 {Math.floor(s.par / 60)}분 {s.par % 60}초</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h3 className={H3}>거대 로봇전</h3>
          <ul className={`list-disc space-y-1 pl-4 ${P}`}>
            <li>보스 격파 → 괴인이 <b>거대화</b> → 5대의 머신이 <b>{MECHA.name}</b>로 합체(HP {MECHA.hp}).</li>
            <li>좌우 이동만 가능. 약공격 {MECHA.chain.map((m) => m.name).join(" → ")}, 강공격 {MECHA.heavy.name}, 스킬 {MECHA.rocket.name}(EN {MECHA.rocket.en}), 회피 = 백스텝.</li>
            <li>거대 괴인은 일반 공격으로는 <b>HP 1</b> 아래로 내려가지 않습니다. 체력 바의 노란 선(25%) 밑으로 깎으면 <b>필살 섬광 일도양단</b>이 해금 — F / 필살 버튼으로 마무리!</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>점수 · 스타일 · 랭크</h3>
          <ul className={`list-disc space-y-1 pl-4 ${P}`}>
            <li>준 피해 × 스타일 배율 + 처치 점수 + 콤보 종료 보너스(콤보 5 이상, 콤보^1.5 × 12).</li>
            <li>
              스타일 랭크: {STYLE_RANKS.map((r) => `${r.id}(×${r.mul})`).join(" · ")} — 같은 기술만 반복하면 오르지 않고, 맞으면 크게 깎입니다.
            </li>
            <li>클리어 보너스: 스테이지 × 5000 · 기준 시간보다 빠른 1초당 40 · 노데스 6000 · 남은 변신 스톡 × 1500.</li>
            <li>클리어 등급 S/A/B/C: 잃은 변신 스톡, 받은 피해, 기준 시간, 최대 콤보로 계산.</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>난이도</h3>
          <div className="grid gap-2 sm:grid-cols-3">
            {Object.values(DIFFICULTIES).map((d) => (
              <div key={d.id} className="rounded-lg border border-white/10 p-2 text-xs light:border-slate-200">
                <div className="font-black">{d.name}</div>
                <div className="text-white/60 light:text-slate-500">받는 피해 ×{d.dmg} · 적 HP ×{d.hp} · 동시 공격 {d.tokens} · 변신 스톡 {d.lives} · 점수 ×{d.score}</div>
                <div className="mt-1">{d.blurb}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </Overlay>
  );
}
