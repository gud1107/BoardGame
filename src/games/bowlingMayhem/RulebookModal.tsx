"use client";

import { useState } from "react";
import Overlay from "@/components/Overlay";
import { AIM_TIMEOUT_MS, ITEMS, ITEM_KINDS, LANE_MODS, MAX_ITEMS, type LaneMod } from "./engine";

const H3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";
const LIST = "list-disc space-y-1.5 pl-4 text-white/70 light:text-slate-600";

type Tab = "basic" | "score" | "chaos" | "items" | "terms";
const TABS: { id: Tab; label: string }[] = [
  { id: "basic", label: "🎳 던지기" },
  { id: "score", label: "🧮 점수" },
  { id: "chaos", label: "🎲 난장판 레인" },
  { id: "items", label: "🎒 아이템" },
  { id: "terms", label: "📚 용어" },
];

const MOD_ORDER: LaneMod[] = ["ice", "bumpers", "giantPins", "featherPins", "wind", "shuffle", "giantBall"];

/** 게임 중 📖 버튼 — 전체 룰북(boardGameRule/볼링난장판/볼링난장판.md)의 앱 적용판 요약. */
export default function RulebookModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("basic");
  return (
    <Overlay title="📖 볼링 난장판 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-4 text-sm text-white/80 light:text-slate-700">
        <div className="flex flex-wrap gap-1.5" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-full border px-3 py-1 text-xs font-bold ${tab === t.id ? "border-fuchsia-400 bg-fuchsia-500/20 text-fuchsia-100 light:text-fuchsia-800" : "border-white/15 text-white/60 light:border-slate-300 light:text-slate-600"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "basic" && (
          <>
            <section>
              <h3 className={H3}>목표</h3>
              <p className="break-keep text-white/70 light:text-slate-600">
                공을 굴려 <b>핀 10개를 쓰러뜨려요</b>. 진짜 볼링 점수 규칙으로 계산해서 <b>점수가 가장 높은 사람이 1등</b>. 프레임마다 레인이 바뀌고, 상대 레인에 방해물을 놓을 수도 있어요.
              </p>
            </section>
            <section>
              <h3 className={H3}>던지는 법 (4단계)</h3>
              <ol className="list-decimal space-y-1.5 pl-4 text-white/70 light:text-slate-600">
                <li>
                  <b>📍 서는 위치</b> — 파울 라인 위 어디서 놓을지. 3D에서 공 근처를 좌우로 끌어도 돼요(가운데가 20번 보드).
                </li>
                <li>
                  <b>🎯 방향</b> — 핀 말고 <b>레인의 화살표</b>를 보고 겨눠요. 레인 멀리를 끌면 그쪽으로 겨눠요(최대 약 5.7°).
                </li>
                <li>
                  <b>🌀 회전(훅)</b> — 공은 처음 7 m는 곧게 미끄러지고, 그다음부터 회전 방향으로 점점 휘어요.
                </li>
                <li>
                  <b>🎳 세기</b> — 던지기 버튼(스페이스)을 <b>꾹 누르면 세기 막대가 왔다 갔다</b>, 원하는 순간에 손을 떼요. 세게 던지면 덜 휘고, 약하면 많이 휘어요.
                </li>
              </ol>
            </section>
            <section>
              <h3 className={H3}>시간 · 화면</h3>
              <ul className={LIST}>
                <li>핀이 멈춘 뒤 {AIM_TIMEOUT_MS / 1000}초 안에 안 던지면 <b>파울(0핀, F)</b>이에요.</li>
                <li>오른쪽 위 핀 배치도: 흰 핀은 서 있는 핀, 빨간 테두리는 방금 쓰러진 핀이에요.</li>
                <li>🔰 초보 도우미(방 옵션)를 켜면 공이 휘어 갈 길 전체가 하늘색 점선으로 보여요.</li>
                <li>키보드: ←→ 위치 · ↑↓ 방향 · A/D 회전 · 스페이스 꾹 → 놓기.</li>
                <li>색을 구분하기 어려우면: 볼·점수표에 ● ◆ ▲ ■ ★ ✚ 무늬가 함께 있어요.</li>
              </ul>
            </section>
          </>
        )}

        {tab === "score" && (
          <>
            <section>
              <h3 className={H3}>기본</h3>
              <ul className={LIST}>
                <li>
                  <b>스트라이크 X</b>: 첫 공에 10개 전부 → 10 + <b>다음 두 공</b>의 핀 수.
                </li>
                <li>
                  <b>스페어 /</b>: 두 공으로 10개 전부 → 10 + <b>다음 한 공</b>의 핀 수.
                </li>
                <li>
                  <b>오픈</b>: 두 공으로 못 다 쓰러뜨리면 쓰러뜨린 수 그대로. <b>-</b>는 0핀.
                </li>
                <li>
                  <b>마지막 프레임</b>: 스트라이크·스페어면 한 번 더 — 최대 3구까지, 다 쓰러뜨릴 때마다 핀을 새로 세워요.
                </li>
              </ul>
            </section>
            <section>
              <h3 className={H3}>예시</h3>
              <ul className={LIST}>
                <li>X · 7/ · 9- → 1프레임 10+7+3 = 20, 2프레임 20+10+9 = 39, 3프레임 39+9 = 48.</li>
                <li>10프레임 전부 스트라이크(마지막 프레임 X X X) = 300점 퍼펙트 게임.</li>
              </ul>
            </section>
            <section>
              <h3 className={H3}>이름 붙는 순간</h3>
              <ul className={LIST}>
                <li>스트라이크 2연속 ⚡ 더블, 3연속 🦃 터키, 4연속부터 🔥 N-배거.</li>
                <li>
                  <b>스플릿</b>: 1번 핀이 쓰러졌는데 남은 핀이 떨어진 두 무리로 갈라진 것(예: 7-10). 다음 공으로 다 쓰러뜨리면 🤯 스플릿 처리!
                </li>
                <li>순위: 점수 → 스트라이크 수 → 스페어 수.</li>
              </ul>
            </section>
          </>
        )}

        {tab === "chaos" && (
          <section>
            <h3 className={H3}>🎲 난장판 레인 (방 옵션)</h3>
            <p className="mb-2 break-keep text-white/70 light:text-slate-600">
              1프레임은 늘 정통 레인. 2프레임부터 레인이 바뀌고(가끔 정통), <b>마지막 프레임은 꼭 변형 레인</b>이에요. 한 프레임에선 모두 같은 레인을 쳐요.
            </p>
            <ul className="flex flex-col gap-1.5">
              {MOD_ORDER.map((m) => (
                <li key={m} className="flex gap-2 rounded-lg bg-white/[0.03] px-3 py-1.5 light:bg-slate-50">
                  <span className="text-lg">{LANE_MODS[m].icon}</span>
                  <span className="break-keep">
                    <b>{LANE_MODS[m].name}</b> — {LANE_MODS[m].desc}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {tab === "items" && (
          <>
            <section>
              <h3 className={H3}>받는 법 · 쓰는 법</h3>
              <ul className={LIST}>
                <li>시작할 때 모두 1개. 매 프레임이 끝날 때 <b>누계 꼴찌</b>가 1개 더(최대 {MAX_ITEMS}개).</li>
                <li>내 프레임 <b>첫 공 전에, 한 프레임에 하나만</b> 쓸 수 있어요.</li>
                <li>방해는 상대의 <b>다음 차례</b>에 걸려요. 아직 이번 프레임을 안 친 상대면 바로 이번 프레임에 걸려요.</li>
                <li>방해물 위치는 레인에 3D로 보여요 — 피해서 던지는 것도 실력!</li>
              </ul>
            </section>
            <ul className="flex flex-col gap-1.5">
              {ITEM_KINDS.map((k) => (
                <li key={k} className="flex gap-2 rounded-lg bg-white/[0.03] px-3 py-1.5 light:bg-slate-50">
                  <span className="text-lg">{ITEMS[k].icon}</span>
                  <span className="break-keep">
                    <b>{ITEMS[k].name}</b> {ITEMS[k].self ? "(나에게)" : "(상대에게)"} — {ITEMS[k].desc}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        {tab === "terms" && (
          <ul className={LIST}>
            <li>
              <b>포켓</b>: 1번 핀 바로 옆(오른쪽으로 들어오면 1-3번 사이). 스트라이크가 가장 잘 나는 곳.
            </li>
            <li>
              <b>훅</b>: 회전 때문에 레인 뒤쪽에서 공이 휘는 것.
            </li>
            <li>
              <b>스키드</b>: 회전이 걸리기 전 공이 곧게 미끄러지는 앞쪽 7 m.
            </li>
            <li>
              <b>보드</b>: 레인을 이루는 나무판 39장. 오른쪽 끝이 1번, 가운데가 20번.
            </li>
            <li>
              <b>화살표</b>: 파울 라인에서 4.6 m 지점의 표시 7개 — 볼러는 이걸 보고 겨눠요.
            </li>
            <li>
              <b>거터</b>: 레인 양옆 홈. 공 중심이 레인 끝을 넘으면 빠지고, 핀을 못 맞혀요.
            </li>
            <li>
              <b>킥백 · 피트</b>: 핀 옆 벽(맞고 튕긴 핀이 다른 핀을 쓰러뜨려요) · 핀 뒤 구덩이.
            </li>
            <li>
              <b>데드우드</b>: 쓰러져서 치워지는 핀. 서 있는 핀은 두 번째 공 때 그 자리에 그대로 있어요.
            </li>
            <li>
              <b>파울 F</b>: 시간 초과로 그 공이 0핀 처리된 것.
            </li>
          </ul>
        )}
      </div>
    </Overlay>
  );
}
