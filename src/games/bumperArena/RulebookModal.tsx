"use client";

import { useState } from "react";
import Overlay from "@/components/Overlay";
import {
  BRACE_KNOCK,
  COMEBACK_GAP,
  CREDIT_MS,
  CRUMBLE_START_MS,
  DASH_CD_MS,
  FIGHT_MAX_MS,
  GUST_CD_MS,
  ITEM_INFO,
  ITEM_KINDS,
  JUMP_CD_MS,
  PTS_KO,
  PTS_RUNNER_UP,
  PTS_TIMEOUT,
  PTS_WIN,
  SEAT_COLOR_NAMES,
  SEAT_SYMBOLS,
  SUDDEN_MS,
  WARN_MS,
} from "./data";

const H3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";
const LIST = "list-disc space-y-1.5 pl-4 text-white/70 light:text-slate-600";

type Tab = "basic" | "controls" | "score" | "island" | "items" | "ghost";
const TABS: { id: Tab; label: string }[] = [
  { id: "basic", label: "🥊 기본" },
  { id: "controls", label: "🎮 조작" },
  { id: "score", label: "🧮 점수" },
  { id: "island", label: "🏝️ 섬" },
  { id: "items", label: "🍄 아이템" },
  { id: "ghost", label: "👻 유령" },
];

/** 게임 중 📖 버튼 — 전체 룰북(boardGameRule/범퍼아레나/범퍼아레나.md)의 앱 적용판 요약. */
export default function RulebookModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("basic");
  const s = (ms: number) => `${ms / 1000}초`;
  return (
    <Overlay title="📖 범퍼 아레나 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-4 text-sm text-white/80 light:text-slate-700">
        <div className="flex flex-wrap gap-1.5" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-full border px-3 py-1 text-xs font-bold ${tab === t.id ? "border-amber-400 bg-amber-500/20 text-amber-100 light:text-amber-800" : "border-white/15 text-white/60 light:border-slate-300 light:text-slate-600"}`}
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
                구름 위에 뜬 육각 타일 섬에서 범퍼 튜브를 탄 캐릭터끼리 <b>몸으로 밀어 섬 밖으로 떨어뜨리는</b> 실시간 난투예요. 라운드마다 <b>마지막까지 살아남거나 많이 떨어뜨려</b> 점수를 모으고, 모든 라운드가 끝났을 때 점수가 가장 높은 사람이 우승해요.
              </p>
            </section>
            <section>
              <h3 className={H3}>열기 %</h3>
              <ul className={LIST}>
                <li>
                  부딪혀서 밀릴 때마다 <b>🔥 열기</b>가 올라요. 열기가 100%면 <b>2배</b>, 200%면 <b>3배</b> 멀리 날아가요.
                </li>
                <li>열기는 이름표 숫자와 튜브 색(하양→주황→빨강) 두 가지로 보여요. 라운드가 바뀌면 0%로 돌아가요.</li>
                <li>대시로 박으면 상대가 더 멀리(×1.2) 날아가요. 박은 쪽은 반동으로 거의 멈추지만, 빗맞거나 피하면 그대로 미끄러져 떨어질 수도 있어요. 정면으로 둘 다 대시하면 둘 다 크게 튕겨요.</li>
              </ul>
            </section>
            <section>
              <h3 className={H3}>자리 구분</h3>
              <p className="text-white/70 light:text-slate-600">
                자리마다 색과 모양이 함께 있어요 — {SEAT_SYMBOLS.map((sym, i) => `${sym} ${SEAT_COLOR_NAMES[i]}`).join(" · ")}. 내 캐릭터 이름표엔 &ldquo;나&rdquo;와 아래 화살표가 붙어요.
              </p>
            </section>
          </>
        )}

        {tab === "controls" && (
          <>
            <section>
              <h3 className={H3}>키보드</h3>
              <ul className={LIST}>
                <li>이동: <b>WASD</b> 또는 <b>방향키</b> (화면 기준 위·아래·왼쪽·오른쪽)</li>
                <li>
                  💨 대시: <b>Space</b> 또는 <b>J</b> — 누르는 방향(안 누르면 바라보는 쪽)으로 확 돌진. 재사용 {s(DASH_CD_MS)}
                </li>
                <li>
                  ⤴ 점프: <b>K</b> 또는 <b>E</b> — 0.65초 동안 떠서 대시를 피하고 구멍을 건너요. 착지하면 <b>충격파</b>로 주변을 밀어내요. 재사용 {s(JUMP_CD_MS)}
                </li>
                <li>
                  🛡 버티기: <b>Shift</b> 또는 <b>L</b>을 <b>누르고 있기</b> — 무게 2.5배, 받는 넉백 ×{BRACE_KNOCK}, 열기도 절반만. 대신 거의 못 움직이고 힘(초록 막대)이 2초면 바닥나요.
                </li>
              </ul>
            </section>
            <section>
              <h3 className={H3}>휴대폰</h3>
              <ul className={LIST}>
                <li>화면 왼쪽 아래 아무 데나 손가락을 대고 끌면 조이스틱이 나타나요.</li>
                <li>오른쪽 아래: 큰 💨 대시 · ⤴ 점프 · 🛡 버티기(누르고 있기). 버튼 둘레의 원이 다 차면 다시 쓸 수 있어요.</li>
                <li>⛶ 크게 버튼으로 전체화면, ⚙️에서 3D/2D 보기·화질을 바꿀 수 있어요.</li>
              </ul>
            </section>
          </>
        )}

        {tab === "score" && (
          <>
            <section>
              <h3 className={H3}>라운드 점수</h3>
              <ul className={LIST}>
                <li>
                  💥 <b>KO +{PTS_KO}</b>: 떨어진 사람을 마지막으로 민 사람({s(CREDIT_MS)} 안). 혼자 떨어지면 아무도 점수를 못 받아요.
                </li>
                <li>
                  🏆 <b>마지막 생존 +{PTS_WIN}</b> · 🥈 <b>마지막에 떨어진 사람 +{PTS_RUNNER_UP}</b>
                </li>
                <li>
                  ⏰ {s(FIGHT_MAX_MS)}가 지나도 2명 이상 남으면 <b>무승부 — 남은 사람 모두 +{PTS_TIMEOUT}</b>
                </li>
                <li>🤝 마지막 사람들이 같은 순간 떨어지면 그 사람들끼리 +2씩</li>
              </ul>
            </section>
            <section>
              <h3 className={H3}>최종 순위 · 역전</h3>
              <ul className={LIST}>
                <li>점수 → 라운드 승리 수 → KO 수 → 덜 떨어진 순. 그래도 같으면 같은 등수.</li>
                <li>
                  🛡️ <b>꼴찌 보호막</b>: 라운드가 시작될 때 1등보다 {COMEBACK_GAP}점 이상 뒤진 사람은 방패를 하나 들고 시작해요.
                </li>
              </ul>
            </section>
          </>
        )}

        {tab === "island" && (
          <section>
            <h3 className={H3}>무너지는 섬</h3>
            <ul className={LIST}>
              <li>인원이 많을수록 섬이 커요: 2명 37칸 · 3~4명 61칸 · 5~6명 91칸.</li>
              <li>
                싸움 시작 {s(CRUMBLE_START_MS)} 뒤부터 <b>바깥 링부터</b> 타일이 흔들리다(빨갛게 깜빡임 · 2D 보기에선 ! 표시) {s(WARN_MS)} 뒤에 떨어져요. 갈수록 빨라져요.
              </li>
              <li>
                {s(SUDDEN_MS)}엔 <b>⚠️ 서든데스</b> — 훨씬 빨리 무너지고 음악이 바뀌어요. <b>가운데 금색 칸</b>은 끝까지 안 무너져요.
              </li>
              <li>4명 이상이면 빨간 <b>범퍼 기둥</b>이 서 있어요. 부딪히면 핀볼처럼 더 세게 튕겨 나와요(기둥이 선 칸이 무너지면 같이 사라짐).</li>
              <li>몸 가운데가 섬 밖으로 나가면 떨어져요. 점프 중엔 구멍 위를 지나갈 수 있지만, 착지한 곳이 구멍이면 떨어져요.</li>
            </ul>
          </section>
        )}

        {tab === "items" && (
          <section>
            <h3 className={H3}>아이템 (방 설정에서 끌 수 있어요)</h3>
            <ul className={LIST}>
              {ITEM_KINDS.map((k) => (
                <li key={k}>
                  {ITEM_INFO[k].emoji} <b>{ITEM_INFO[k].name}</b> — {ITEM_INFO[k].desc}
                </li>
              ))}
              <li>6초마다 빈 칸에 하나씩(최대 2개) 나오고, 12초 뒤에 사라져요(사라지기 3초 전부터 깜빡임). 지나가기만 하면 주워요.</li>
            </ul>
          </section>
        )}

        {tab === "ghost" && (
          <section>
            <h3 className={H3}>👻 유령 (방 설정에서 끌 수 있어요)</h3>
            <ul className={LIST}>
              <li>떨어진 사람은 유령이 되어 섬 위를 자유롭게 날아다녀요(부딪히지 않음).</li>
              <li>
                💨(대시 키)로 <b>바라보는 쪽으로 입김</b>을 불어 반경 2m 안의 사람을 살짝 밀어요. {s(GUST_CD_MS)}마다 한 번.
              </li>
              <li>입김은 열기와 상관없이 늘 같은 세기이고, 입김으로 떨어져도 <b>KO 점수는 없어요</b>(그 전에 민 사람이 있으면 그 사람 점수).</li>
              <li>봇 유령은 점수 1등을 노려요 — 앞서가는 사람 견제용.</li>
            </ul>
          </section>
        )}
      </div>
    </Overlay>
  );
}
