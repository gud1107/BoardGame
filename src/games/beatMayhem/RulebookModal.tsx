"use client";

import { useState } from "react";
import Overlay from "@/components/Overlay";
import {
  COMBO_BONUS_MAX,
  DIFFICULTY_INFO,
  GAUGE_GREAT,
  GAUGE_MAX,
  GAUGE_PERFECT,
  GOOD_MS,
  GREAT_MS,
  LANE_KEYS,
  PERFECT_MS,
  PRANK_BEATS,
  PRANK_INFO,
  PRANK_KINDS,
  PRANK_LEAD_BEATS,
  PTS,
  SHIELD_COST,
  STYLE_IDS,
  type Difficulty,
} from "./data";
import { STYLES } from "./song";

const H3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";
const LIST = "list-disc space-y-1.5 pl-4 text-white/70 light:text-slate-600";

type Tab = "basic" | "controls" | "judge" | "prank" | "songs" | "sync" | "score";
const TABS: { id: Tab; label: string }[] = [
  { id: "basic", label: "🎵 기본" },
  { id: "controls", label: "🎮 조작" },
  { id: "judge", label: "🎯 판정" },
  { id: "prank", label: "⚡ 장난" },
  { id: "songs", label: "🎪 곡" },
  { id: "sync", label: "🎧 박자 맞추기" },
  { id: "score", label: "🏆 순위" },
];

/** 게임 중 📖 버튼 — 전체 룰북(boardGameRule/박자난장판/박자난장판.md)의 앱 적용판 요약. */
export default function RulebookModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("basic");
  return (
    <Overlay title="📖 박자 난장판 룰북" onClose={onClose} wide>
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
                모두가 <b>같은 곡을 동시에</b> 쳐서 점수를 겨루는 1~8인 리듬 대결이에요. 노트가 흰 판정선에 닿는 순간 그 줄을 눌러요. 정확할수록, 콤보가 길수록 점수가 커지고, 1~3곡의 점수를 더해 가장 높은 사람이 우승해요.
              </p>
            </section>
            <section>
              <h3 className={H3}>한 곡의 흐름</h3>
              <ol className="list-decimal space-y-1.5 pl-4 text-white/70 light:text-slate-600">
                <li>카운트다운 3·2·1 뒤 &quot;똑 똑 똑 똑&quot; 네 박을 세고 곡이 시작돼요.</li>
                <li>곡은 인트로 → A → B → 브리지 → A′ → B′ 로 갈수록 빽빽해져요 (약 1분).</li>
                <li>잘 치면 ⚡ 장난 게이지가 차요. 가득 차면 바로 위 등수에게 장난을 쏠 수 있어요.</li>
                <li>곡이 끝나면 결과를 보고 다음 곡으로 — 점수는 이어져요.</li>
              </ol>
            </section>
            <section>
              <h3 className={H3}>소리를 꺼도 돼요</h3>
              <p className="break-keep text-white/70 light:text-slate-600">박자선(한 박마다 내려오는 가로선)과 판정 글자, 장난 예고가 모두 화면에 나와요. 사이트 소리는 기본이 꺼짐이라, 곡을 들으려면 화면 위 🔇을 눌러 켜세요.</p>
            </section>
          </>
        )}

        {tab === "controls" && (
          <>
            <section>
              <h3 className={H3}>키보드</h3>
              <ul className={LIST}>
                <li>
                  왼쪽부터 네 줄: <b>{LANE_KEYS.join(" · ")}</b> (또는 ← ↓ ↑ →)
                </li>
                <li><b>Space / Enter</b> — 게이지가 가득 찼을 때 장난 쏘기</li>
              </ul>
            </section>
            <section>
              <h3 className={H3}>휴대폰</h3>
              <ul className={LIST}>
                <li>화면 아래 네 칸을 톡 (여러 손가락 동시에 가능)</li>
                <li>오른쪽 ⚡ 버튼 — 장난 쏘기</li>
              </ul>
            </section>
            <section>
              <h3 className={H3}>⚙️ 설정</h3>
              <ul className={LIST}>
                <li>노트 빠르기: 느림 / 보통 / 빠름 — 노트가 달려오는 속도만 바뀌고 박자는 같아요</li>
                <li>보기: 3D 무대 / 2D 낙하, 화질</li>
                <li>판정 보정: &quot;🎧 박자 맞추기&quot; 탭 참고</li>
              </ul>
            </section>
          </>
        )}

        {tab === "judge" && (
          <>
            <section>
              <h3 className={H3}>판정 창과 점수</h3>
              <ul className={LIST}>
                <li>퍼펙트: ±{PERFECT_MS}ms — {PTS.perfect}점, 게이지 +{GAUGE_PERFECT}</li>
                <li>그레이트: ±{GREAT_MS}ms — {PTS.great}점, 게이지 +{GAUGE_GREAT}</li>
                <li>굿: ±{GOOD_MS}ms — {PTS.good}점</li>
                <li>미스: 노트가 판정선을 {GOOD_MS}ms 넘게 지나감 — 0점, 콤보 끊김</li>
              </ul>
            </section>
            <section>
              <h3 className={H3}>콤보 보너스</h3>
              <p className="break-keep text-white/70 light:text-slate-600">
                맞힐 때마다 지금 콤보 수만큼(최대 +{COMBO_BONUS_MAX}) 점수가 더 붙어요. {COMBO_BONUS_MAX}콤보를 넘기면 퍼펙트 하나가 {PTS.perfect + COMBO_BONUS_MAX}점이에요 — 끊기지 않는 게 가장 중요해요.
              </p>
            </section>
            <section>
              <h3 className={H3}>빈 곳을 누르면</h3>
              <p className="break-keep text-white/70 light:text-slate-600">노트가 없는 곳을 눌러도 벌점은 없어요. 같은 줄에 노트가 여럿 겹치면 가장 먼저 온 노트부터 판정돼요.</p>
            </section>
          </>
        )}

        {tab === "prank" && (
          <>
            <section>
              <h3 className={H3}>게이지</h3>
              <ul className={LIST}>
                <li>퍼펙트 +{GAUGE_PERFECT}, 그레이트 +{GAUGE_GREAT}로 차고 {GAUGE_MAX}에서 멈춰요.</li>
                <li><b>{GAUGE_MAX}</b>이면 장난을 쏠 수 있어요 (전부 소모). 받는 사람은 <b>내 바로 위 등수</b>, 내가 1등이면 2등이에요.</li>
                <li>게이지가 <b>{SHIELD_COST} 이상</b> 있을 때 장난이 날아오면 🛡 자동으로 막고 {SHIELD_COST}을 써요.</li>
                <li>그래서 선택이 생겨요: 가득 채워 쏠까, 남겨서 방패로 둘까.</li>
              </ul>
            </section>
            <section>
              <h3 className={H3}>장난 5가지 (무작위)</h3>
              <ul className={LIST}>
                {PRANK_KINDS.map((k) => (
                  <li key={k}>
                    <b>
                      {PRANK_INFO[k].emoji} {PRANK_INFO[k].name}
                    </b>{" "}
                    — {PRANK_INFO[k].desc}
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h3 className={H3}>언제 걸리나</h3>
              <p className="break-keep text-white/70 light:text-slate-600">
                쏜 뒤 {PRANK_LEAD_BEATS}박자 예고가 뜨고, {PRANK_BEATS}박자 동안 이어져요. 한 사람에게 장난이 겹치면 뒤로 줄을 서요. 곡 끝 10박자쯤부터는 쏠 수 없어요. 방을 만들 때 &quot;장난 끄기&quot;를 고르면 순수 점수 대결이 돼요.
              </p>
            </section>
          </>
        )}

        {tab === "songs" && (
          <>
            <section>
              <h3 className={H3}>곡 스타일</h3>
              <ul className={LIST}>
                {STYLE_IDS.map((id) => (
                  <li key={id}>
                    <b>
                      {STYLES[id].emoji} {STYLES[id].name}
                    </b>{" "}
                    — {STYLES[id].desc}
                  </li>
                ))}
              </ul>
              <p className="mt-2 break-keep text-white/60 light:text-slate-500">곡은 판마다 새로 만들어져요(선율·리듬·화음 진행). 같은 방의 모든 사람은 똑같은 곡·똑같은 노트를 받아요. &quot;무작위&quot;를 고르면 곡마다 스타일이 바뀌어요.</p>
            </section>
            <section>
              <h3 className={H3}>난이도</h3>
              <ul className={LIST}>
                {(Object.keys(DIFFICULTY_INFO) as Difficulty[]).map((d) => (
                  <li key={d}>
                    <b>{DIFFICULTY_INFO[d].name}</b> — {DIFFICULTY_INFO[d].desc}
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}

        {tab === "sync" && (
          <>
            <section>
              <h3 className={H3}>판정 보정이 필요한 때</h3>
              <p className="break-keep text-white/70 light:text-slate-600">
                기기·이어폰마다 소리가 나오기까지 걸리는 시간이 달라요. 소리에 맞춰 쳤는데 계속 <b>◀ 빠름</b>이 뜨면 소리가 늦게 들리는 거예요 → ⚙️에서 판정 보정을 <b>+</b>로. 계속 <b>늦음 ▶</b>이 뜨면 <b>−</b>로. 블루투스 이어폰은 보통 +100~200ms예요.
              </p>
            </section>
            <section>
              <h3 className={H3}>온라인 지연은?</h3>
              <ul className={LIST}>
                <li>판정은 <b>내 기기에서</b> 해요. 인터넷이 느려도 내 박자에는 영향이 없어요.</li>
                <li>기기마다 곡이 수십 ms 늦게 시작할 수 있지만 소리·화면·판정이 같이 밀려서 차이가 없어요.</li>
                <li>남의 점수는 0.1~0.3초 늦게 보일 수 있어요. 곡이 끝나면 2초쯤 기다려 모든 기록을 모은 뒤 결과를 내요.</li>
              </ul>
            </section>
          </>
        )}

        {tab === "score" && (
          <>
            <section>
              <h3 className={H3}>순위</h3>
              <ul className={LIST}>
                <li>모든 곡의 점수 합이 높은 순.</li>
                <li>동점이면 퍼펙트 수 → 최대 콤보. 그래도 같으면 같은 등수.</li>
              </ul>
            </section>
            <section>
              <h3 className={H3}>끊겼을 때</h3>
              <ul className={LIST}>
                <li>누가 나가면 10초 뒤 그 자리를 AI가 대신 쳐요. 다시 들어오면 그때부터 직접 쳐요 (그사이 지나간 노트는 AI가 친 기록).</li>
                <li>방장이 나가면 3초 뒤 남은 사람이 판을 이어받아요. 곡은 각자 기기에서 계속 흘러요.</li>
              </ul>
            </section>
            <section>
              <h3 className={H3}>AI 봇</h3>
              <p className="break-keep text-white/70 light:text-slate-600">Lv.1은 다섯 번에 한 번 놓치고 박자가 많이 흔들려요. Lv.10은 거의 퍼펙트만 쳐요. 봇도 장난에 걸리면 흔들리고, 게이지가 차면 장난을 쏴요 (Lv.7 이상 1등은 방패로 아껴 둬요).</p>
            </section>
          </>
        )}
      </div>
    </Overlay>
  );
}
