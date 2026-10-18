"use client";

import { useState } from "react";
import Overlay from "@/components/Overlay";
import { AIM_TIMEOUT_MS, RUN_GRACE_MS } from "./engine";
import { PARTY_EMOJI } from "./SheetCanvas";
import { CurlDiagram, GlossaryList, ScoringDiagram, SheetDiagram, SweepDiagram } from "./guide";

const H3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";
const LIST = "list-disc space-y-1.5 pl-4 text-white/70 light:text-slate-600";

type Tab = "start" | "rules" | "words";
const TABS: { id: Tab; label: string }[] = [
  { id: "start", label: "🔰 처음 해요" },
  { id: "rules", label: "📖 전체 규칙" },
  { id: "words", label: "📚 용어" },
];

/** 게임 중 📖 버튼 — 전체 룰북(boardGameRule/컬링파티/컬링파티.md)의 앱 적용판: 그림 설명 · 전체 규칙 · 용어 사전. */
export default function RulebookModal({ onClose, onReplayTour, onResetCoach }: { onClose: () => void; onReplayTour?: () => void; onResetCoach?: () => void }) {
  const [tab, setTab] = useState<Tab>("start");
  return (
    <Overlay title="📖 컬링 파티 룰북" onClose={onClose} wide>
      <div className="mb-4 grid grid-cols-3 gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-xl border px-2 py-2 text-xs font-bold ${tab === t.id ? "border-sky-400 bg-sky-500/20 text-sky-100 light:text-sky-800" : "border-white/15 text-white/60 light:border-slate-300 light:text-slate-600"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "start" && <QuickStart onReplayTour={onReplayTour} onResetCoach={onResetCoach} />}
      {tab === "words" && <GlossaryList />}
      {tab === "rules" && <FullRules />}
    </Overlay>
  );
}

function QuickStart({ onReplayTour, onResetCoach }: { onReplayTour?: () => void; onResetCoach?: () => void }) {
  return (
    <div className="flex flex-col gap-4 text-sm break-keep text-white/80 light:text-slate-700">
      <section className="flex flex-col gap-2">
        <h3 className={H3}>1분 요약</h3>
        <ol className="list-decimal space-y-1.5 pl-4 text-white/75 light:text-slate-600">
          <li>
            위쪽 과녁(<b>하우스</b>) 한가운데 <b>버튼</b>에 내 스톤을 가장 가깝게!
          </li>
          <li>
            내 차례: <b>브룸 옮기기 → 회전 고르기 → 🥌 꾹 눌렀다 떼기</b>.
          </li>
          <li>
            스톤이 가는 동안 <b>🧹 연타</b> = 더 멀리·더 곧게.
          </li>
          <li>
            엔드 끝: <b>가장 가까운 편만</b>, 상대 최고 스톤보다 안쪽의 내 스톤 수만큼 점수.
          </li>
        </ol>
      </section>
      <section className="flex flex-col gap-2">
        <h3 className={H3}>시트 구조</h3>
        <SheetDiagram />
      </section>
      <section className="flex flex-col gap-2">
        <h3 className={H3}>회전과 휘기 — 브룸은 휘는 반대쪽에</h3>
        <CurlDiagram />
        <p className="text-xs text-white/60 light:text-slate-500">스톤은 느려질수록 많이 휘어요. 드로우(하우스에 멈추기)는 약 1.1 m, 세게 던지는 테이크아웃은 0.4~0.8 m 휘어요. 🔰 초보 도우미가 켜진 방에서는 힘을 모으는 동안 휘는 길(다른 스톤·쓸기 제외)이 보여요.</p>
      </section>
      <section className="flex flex-col gap-2">
        <h3 className={H3}>힘 게이지 읽기</h3>
        <ul className={LIST}>
          <li>
            <b className="text-slate-300">회색 미달</b> — 호그 라인을 못 넘어 아웃.
          </li>
          <li>
            <b className="text-sky-300">파랑 가드</b> — 하우스 앞에 멈춰 길을 막아요.
          </li>
          <li>
            <b className="text-rose-300">빨강 하우스</b> — 과녁 안에 멈춰요. 처음엔 여기!
          </li>
          <li>
            <b className="text-amber-300">주황 테이크아웃</b> — 상대 스톤을 쳐내는 세기. 아무것도 안 맞히면 뒤로 나가요.
          </li>
        </ul>
      </section>
      <section className="flex flex-col gap-2">
        <h3 className={H3}>쓸기</h3>
        <SweepDiagram />
      </section>
      <section className="flex flex-col gap-2">
        <h3 className={H3}>점수 세기 예시</h3>
        <ScoringDiagram />
        <p className="text-xs text-white/60 light:text-slate-500">레드 1·2번이 옐로의 가장 가까운 스톤(점선)보다 안쪽 → 레드 2점. 바깥쪽 레드는 세지 않아요. 게임 중엔 위쪽 &ldquo;지금 끝나면&rdquo; 칩이 실시간으로 알려 줘요.</p>
      </section>
      <section className="flex flex-col gap-2">
        <h3 className={H3}>처음 하는 사람을 위한 팁</h3>
        <ul className={LIST}>
          <li>첫 투구는 브룸을 기본 위치 그대로 두고 빨간 &lsquo;하우스&rsquo; 구간에서 떼 보세요 — 그것만으로 하우스에 들어가요.</li>
          <li>상대 스톤이 버튼 근처에 있으면 주황 구간으로 쳐내고, 내가 이기고 있으면 하우스 앞에 가드를 세워 지키세요.</li>
          <li>마지막 스톤(🔨 해머)을 가진 편이 유리해요. 해머가 없으면 하우스 앞을 막아 상대를 귀찮게!</li>
          <li>팀원이 짚어 준 📣 콜(시트 위 점선 원)을 참고하세요. 봇 팀원의 콜은 레벨만큼만 믿을 만해요.</li>
        </ul>
      </section>
      {(onReplayTour || onResetCoach) && (
        <div className="grid grid-cols-2 gap-2">
          {onReplayTour && (
            <button type="button" onClick={onReplayTour} className="rounded-xl bg-sky-600 py-2.5 text-xs font-bold text-white">
              🔰 처음 안내 다시 보기
            </button>
          )}
          {onResetCoach && (
            <button type="button" onClick={onResetCoach} className="rounded-xl border border-white/15 py-2.5 text-xs font-bold text-white/80 light:border-slate-300 light:text-slate-700">
              💬 코치 말풍선 다시 켜기
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function FullRules() {
  return (
      <div className="flex flex-col gap-5 text-sm text-white/80 light:text-slate-700">
        <section>
          <h3 className={H3}>목표</h3>
          <p className="break-keep text-white/70 light:text-slate-600">
            스톤을 얼음 위로 밀어 하우스 한가운데 <b>버튼</b>에 가깝게 붙이세요. 엔드가 끝나면 <b>버튼에 가장 가까운 스톤의 편</b>이, 다른 편의 가장 가까운 스톤보다 더 가까운 자기 스톤 수만큼 점수를 얻어요. 모든 엔드 합계가 높은 쪽이 승리!
          </p>
        </section>

        <section>
          <h3 className={H3}>내 차례</h3>
          <ol className="list-decimal space-y-1.5 pl-4 text-white/70 light:text-slate-600">
            <li>
              <b>브룸 옮기기</b> — 시트를 좌우로 끌면 티 라인 위의 브룸(조준점)이 움직여요. ◀ ▶로 5 cm씩.
            </li>
            <li>
              <b>회전</b> — ↻는 오른쪽, ↺는 왼쪽으로 휘어요. <b>느려질수록 많이 휘니까</b> 브룸은 목표보다 휘는 반대쪽에.
            </li>
            <li>
              <b>꾹 눌러 힘 모으기 → 떼면 출발</b> — 게이지의 가드 / 하우스 / 테이크아웃 구간을 보세요. 누르는 동안 시트에 직선 예상 정지 위치가 떠요(휘는 양·쓸기·다른 스톤은 빼고).
            </li>
            <li>
              <b>쓸기!</b> — 스톤이 가는 동안 🧹 버튼(스페이스 바)을 연타. 쓸면 <b>더 멀리, 더 곧게</b> 가요.
            </li>
          </ol>
        </section>

        <section>
          <h3 className={H3}>쓸기 (스위핑)</h3>
          <ul className={LIST}>
            <li>던진 편은 처음부터 끝까지, 같은 팀 모두가 함께 쓸 수 있어요. 여럿이 쓰면 세기가 더해져요.</li>
            <li>
              상대 편은 스톤이 <b>티 라인을 넘은 뒤에만</b> 쓸 수 있어요 — 하우스 뒤로 밀어내 버리기!
            </li>
            <li>0.6초에 3번 이상 누르면 최대 세기. 마찰 최대 20%↓, 휘는 힘 최대 45%↓. 일찍 쓸수록 효과가 커요.</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>엔드 · 해머</h3>
          <ul className={LIST}>
            <li>팀전은 자리 홀짝으로 🔴 레드 / 🟡 옐로. 해머(마지막 스톤)가 없는 팀부터 번갈아 던져요. 팀 안에서는 돌아가며 던져요.</li>
            <li>개인전(3~6명)은 모두 각자 한 편, 3명이면 3스톤 · 4명 이상이면 2스톤씩.</li>
            <li>점수를 낸 편은 다음 엔드에 먼저 던져요(해머는 상대에게). 블랭크 엔드면 해머가 그대로. 해머 없이 점수를 내면 스틸!</li>
            <li>마지막 엔드 뒤 1위가 같으면 연장 1엔드, 그래도 같으면 공동 순위.</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>아웃</h3>
          <ul className={LIST}>
            <li>옆 벽에 닿거나 백 라인을 완전히 넘으면 아웃.</li>
            <li>아무것도 안 맞히고 파 호그 라인(굵은 빨간 선)을 완전히 넘지 못하면 아웃.</li>
            <li>
              🛡️ <b>프리 가드 존</b>(켜져 있으면): 엔드 초반 몇 투구 동안 하우스 앞의 상대 가드를 내보내면 모든 스톤이 원위치되고 던진 스톤만 빠져요.
            </li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>🎉 파티 스톤 (엔드마다 편별 1개)</h3>
          <ul className={LIST}>
            <li>{PARTY_EMOJI.bomb} 폭탄 — 멈추면 펑! 반경 1.25 m 스톤을 날리고 사라져요.</li>
            <li>{PARTY_EMOJI.heavy} 묵직이 — 무게 2배, 계속 묵직해요.</li>
            <li>{PARTY_EMOJI.sticky} 끈끈이 — 처음 닿은 스톤과 그 자리에 철썩 붙어 멈춰요.</li>
            <li>{PARTY_EMOJI.swirl} 회오리 — 2.4배로 휘어요.</li>
            <li>{PARTY_EMOJI.ghost} 유령 — 하우스에 들어가기 전까지 다른 스톤을 통과해요.</li>
            <li>{PARTY_EMOJI.magnet} 자석 — 하우스 안에서 버튼 쪽으로 끌려가요.</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>시간</h3>
          <ul className={LIST}>
            <li>
              조준 + 힘 모으기 {AIM_TIMEOUT_MS / 1000}초. 넘기면 &ldquo;얼어붙은 손&rdquo; — 가드 자리에 약하게 자동 투구.
            </li>
            <li>스톤이 출발하면 {RUN_GRACE_MS / 1000}초가 더 붙어요. 두 번 연속 시간 초과면 봇 대체 투표가 떠요.</li>
          </ul>
        </section>

        <section>
          <h3 className={H3}>키보드</h3>
          <ul className={LIST}>
            <li>← → 브룸 · Q / E 회전 · 스페이스 누르고 떼기 = 투구 · 스톤이 가는 동안 스페이스 연타 = 쓸기</li>
          </ul>
        </section>
      </div>
  );
}
