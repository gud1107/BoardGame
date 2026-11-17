"use client";

import { useState } from "react";
import Overlay from "@/components/Overlay";
import {
  BASH_MS,
  CAMP_R,
  EXPOSE_MS,
  FREEZE_MS,
  GATE_OPEN_MS,
  GAUGE_CATCH,
  GAUGE_MIN_ON,
  GAUGE_REGEN_SEC,
  GRACE_MS,
  HEART_R,
  KICK_LOSS,
  KICK_MS,
  KID_HEAR_MUL,
  MASK_OFF_MS,
  MASK_ON_MS,
  MATCH_MINUTES,
  MAX_FREEZES,
  NOISE_RUN,
  NOISE_SEAL,
  NOISE_THAW,
  NOISE_WALK,
  RECOVER_HIT_MS,
  RECOVER_MISS_MS,
  SALT_MAX,
  SALT_RANGE,
  SALT_SLOW_MS,
  SALT_START,
  SEAL_HELP,
  STUN_KID_MS,
  STUN_MASK_MS,
  THAW_MS,
  THAW_SAFE_MS,
  maskSecFor,
  sealMsFor,
  sealsFor,
} from "./data";

const H3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";
const LIST = "list-disc space-y-1.5 pl-4 text-white/70 light:text-slate-600";

type Tab = "basic" | "controls" | "runner" | "tagger" | "freeze" | "salt" | "end";
const TABS: { id: Tab; label: string }[] = [
  { id: "basic", label: "🏫 기본" },
  { id: "controls", label: "🎮 조작" },
  { id: "runner", label: "🏃 도망자" },
  { id: "tagger", label: "👹 술래" },
  { id: "freeze", label: "❄ 얼음땡" },
  { id: "salt", label: "🧂 소금" },
  { id: "end", label: "🚪 끝·결과" },
];

/** 게임 중 📖 버튼 — 전체 룰북(boardGameRule/술래는우리중에/술래는우리중에.md)의 앱 적용판 요약. */
export default function RulebookModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("basic");
  const s = (ms: number) => `${ms / 1000}초`;
  return (
    <Overlay title="📖 술래는 우리 중에 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-4 text-sm text-white/80 light:text-slate-700">
        <div className="flex flex-wrap gap-1.5" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-full border px-3 py-1 text-xs font-bold ${tab === t.id ? "border-sky-400 bg-sky-500/20 text-sky-100 light:text-sky-800" : "border-white/15 text-white/60 light:border-slate-300 light:text-slate-600"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "basic" && (
          <section>
            <h3 className={H3}>🏫 무엇을 하나</h3>
            <ul className={LIST}>
              <li>
                한밤의 폐교 <b>달빛초등학교</b>에 3~5명이 갇혔어요. 그중 <b>한 명이 술래</b>예요 — 누구인지는 술래 본인만 알아요.
              </li>
              <li>
                <b>🏃 도망자</b>: 눈이 붉게 뜬 <b>🧧 장승</b>을 봉인해요(도망자 2명 {sealsFor(2)}곳 · 3명 {sealsFor(3)}곳 · 4명 {sealsFor(4)}곳). 다 봉인하면 {s(GATE_OPEN_MS)} 뒤 <b>교문 두 곳</b>(북쪽 급식실 뒷문 · 남쪽 중앙 현관 정문)이 열려요. 교문에 닿으면 탈출.
              </li>
              <li>
                <b>👹 술래</b>: 평소엔 다른 아이와 <b>똑같이</b> 보여요. 탈을 쓰면 빨라지고 덮쳐서 아이를 <b>❄ 얼음</b>으로 만들 수 있어요.
              </li>
              <li>
                <b>승패</b>: 탈출한 도망자가 <b>절반을 넘으면 도망자 승</b>, 딱 절반이면 무승부, 못 미치면 술래 승. 움직일 수 있는 도망자가 하나도 없으면(모두 얼거나 끌려가면) 바로 끝나요.
              </li>
              <li>
                제한 시간({MATCH_MINUTES.join("/")}분 중 방장이 선택)이 지나 첫닭이 울면, 아직 학교 안에 있는 도망자는 모두 끌려가요.
              </li>
              <li>시작하고 {s(GRACE_MS)} 동안은 술래가 탈을 못 써요 — 그동안 흩어지세요.</li>
            </ul>
          </section>
        )}

        {tab === "controls" && (
          <section>
            <h3 className={H3}>🎮 조작</h3>
            <ul className={LIST}>
              <li>
                <b>PC</b>: 화면을 클릭하면 마우스로 둘러봐요(Esc로 풀기). WASD 이동 · Shift 달리기 · C 앉기(다시 누르면 서기) · F 손전등 · M 지도.
              </li>
              <li>
                E 상호작용 — 장승 봉인·친구 녹이기는 <b>누르고 있기</b>, 문은 한 번.
              </li>
              <li>
                <b>도망자</b>: 왼쪽 클릭 또는 Q로 🧂 소금 뿌리기(바라보는 쪽 {SALT_RANGE}m).
              </li>
              <li>
                <b>술래</b>: Space(또는 R)로 탈 쓰기·벗기 · 탈을 쓴 채 왼쪽 클릭으로 덮치기 · E로 닫힌 문 부수기 / 진행 중인 장승 걷어차기(누르고 있기).
              </li>
              <li>
                <b>휴대폰</b>: 왼쪽을 끌어 이동(끝까지 밀면 달리기), 오른쪽을 끌어 시선. 버튼 ✋ 상호작용 · 🧂 소금 · 👹 탈 · 🫳 덮치기 · ⬇ 앉기 · 🔦 · 🗺️.
              </li>
              <li>
                🗺️ 지도에는 내 위치·깨어난 장승(진행도)·얼어붙은 친구·교문만 나와요. <b>다른 사람의 위치는 나오지 않아요.</b>
              </li>
              <li>⚙️ 설정: 화질 · 시선 감도 · 놀람 연출 줄이기(흔들림·번쩍임을 약하게).</li>
            </ul>
          </section>
        )}

        {tab === "runner" && (
          <section>
            <h3 className={H3}>🏃 도망자</h3>
            <ul className={LIST}>
              <li>
                학교에는 장승이 12개 있지만 이번 판에 <b>깨어난 장승</b>(눈이 붉고 바닥에 붉은 금줄)만 봉인할 수 있어요. 필요한 수보다 2곳 더 깨어나요 — 가까운 곳, 술래가 없는 곳을 고르세요.
              </li>
              <li>
                봉인 하나는 혼자서 {s(sealMsFor(2))}(도망자 2명) · {s(sealMsFor(3))}(3명) · {s(sealMsFor(4))}(4명). <b>함께 하면</b> 한 명 늘 때마다 {SEAL_HELP * 100}% 빨라져요. 손을 떼도 진행도는 남아요.
              </li>
              <li>
                봉인을 끝낸 순간 손대고 있던 도망자는 <b>🧂 소금 한 줌</b>을 얻어요(최대 {SALT_MAX}).
              </li>
              <li>
                <b>소리</b>: 걷기 {NOISE_WALK}m · 달리기 {NOISE_RUN}m · 봉인 {NOISE_SEAL}m · 녹이기 {NOISE_THAW}m 안에 술래가 있으면 술래 눈에 벽 너머 <b>노란 파문</b>으로 보여요. <b>앉아서 걸으면 소리가 안 나요.</b>
              </li>
              <li>
                <b>💓 심장 소리</b>: 탈을 쓴 술래가 {HEART_R}m 안에 들어오면 뛰기 시작하고 가까울수록 빨라져요(화면 가장자리도 붉게 뜁니다). 변장 중인 술래에게는 뛰지 않아요.
              </li>
              <li>누가 술래인지 추리하세요 — 탈이 나타났을 때 안 보이는 아이, 봉인하는 척만 하는 아이(진행도가 안 오름), 얼어붙은 친구를 안 녹이는 아이.</li>
            </ul>
          </section>
        )}

        {tab === "tagger" && (
          <section>
            <h3 className={H3}>👹 술래</h3>
            <ul className={LIST}>
              <li>
                <b>변장 중</b>: 다른 아이와 똑같이 걷고 뛰고 손전등을 켜요. 장승 앞에서 E를 누르면 <b>봉인하는 척</b>을 해요(진행도는 안 올라요). 귀는 어두워서 소리 반경의 {KID_HEAR_MUL * 100}%만 들려요.
              </li>
              <li>
                <b>탈 쓰기</b>: 탈 기운이 {GAUGE_MIN_ON} 이상일 때. 쓰는 데 {s(MASK_ON_MS)}, 벗는 데 {s(MASK_OFF_MS)} — 그동안 못 움직이고, 쓰는 소리는 모두에게 들려요.
              </li>
              <li>
                탈을 쓰면 달리는 아이만큼은 아니어도 지치지 않고 빠르게 움직이고, 붉은 밤눈으로 멀리 봐요. 탈 기운은 도망자 2명일 때 {maskSecFor(2)}초 · 3명 {maskSecFor(3)}초 · 4명 {maskSecFor(4)}초면 바닥나 저절로 벗겨져요. 벗고 있으면 {GAUGE_REGEN_SEC}초에 가득 차고, 한 명 얼릴 때마다 +{GAUGE_CATCH}.
              </li>
              <li>
                <b>덮치기</b>(왼쪽 클릭): 보는 쪽으로 돌진해 처음 닿는 도망자를 얼려요. 맞히면 {s(RECOVER_HIT_MS)}, 헛치면 {s(RECOVER_MISS_MS)} 동안 숨을 고르느라 느려지고 다시 못 덮쳐요.
              </li>
              <li>
                탈을 쓴 채로는 문을 못 닫아요. 닫힌 문은 {s(BASH_MS)} 걸려 <b>부숴서</b> 열어요(소리가 크게 나요).
              </li>
              <li>
                <b>봉인 걷어차기</b>: 탈을 쓰고 진행 중인 장승 앞에서 E를 {s(KICK_MS)} 누르면 진행도가 {KICK_LOSS * 100}%p 깎여요. 끝난 봉인은 못 건드려요.
              </li>
            </ul>
          </section>
        )}

        {tab === "freeze" && (
          <section>
            <h3 className={H3}>❄ 얼음땡</h3>
            <ul className={LIST}>
              <li>술래에게 덮쳐지면 그 자리에서 <b>얼음</b>이 돼요. 못 움직이고 손전등도 꺼져요.</li>
              <li>
                다른 도망자가 다가와 E를 {s(THAW_MS)} 누르고 있으면 <b>땡!</b> — 다시 움직일 수 있고 {s(THAW_SAFE_MS)} 동안은 다시 얼지 않아요.
              </li>
              <li>
                첫 번째 얼음은 {s(FREEZE_MS[0])}, 두 번째는 {s(FREEZE_MS[1])} 안에 못 녹으면 <b>끌려가요</b>(탈락). <b>{MAX_FREEZES}번째로 붙잡히면 바로 끌려가요.</b>
              </li>
              <li>
                탈 쓴 술래가 얼음 {CAMP_R}m 안에서 지키고 있으면 <b>얼음 시계가 멈춰요</b> — 지키기만 해서는 탈락시킬 수 없어요(그동안 탈 기운은 계속 닳아요).
              </li>
              <li>얼어붙은 친구는 🗺️ 지도에 하늘색 네모로 보여요. 끌려가거나 탈출한 사람은 남은 친구의 눈으로 관전해요.</li>
            </ul>
          </section>
        )}

        {tab === "salt" && (
          <section>
            <h3 className={H3}>🧂 소금</h3>
            <ul className={LIST}>
              <li>
                도망자는 소금 {SALT_START}줌을 들고 시작해요(최대 {SALT_MAX}, 봉인을 끝낼 때마다 +1). 바라보는 쪽 {SALT_RANGE}m 안에서 가장 가까운 사람이 맞아요(벽·닫힌 문 너머는 안 맞아요).
              </li>
              <li>
                <b>탈 쓴 술래</b>가 맞으면 {s(STUN_MASK_MS)} 동안 꼼짝 못 해요 — 그 틈에 달아나거나 친구를 녹이세요.
              </li>
              <li>
                <b>변장 중인 술래</b>가 맞으면 {s(STUN_KID_MS)} 멈추고, <b>{s(EXPOSE_MS)} 동안 정체가 모두에게 드러나요</b>(머리 위 붉은 표시 + 이름 옆 👹).
              </li>
              <li>
                <b>친구</b>가 맞으면 {s(SALT_SLOW_MS)} 동안 눈이 따가워 느려져요 — 의심만으로 뿌리면 손해예요.
              </li>
            </ul>
          </section>
        )}

        {tab === "end" && (
          <section>
            <h3 className={H3}>🚪 끝 · 결과 · 온라인</h3>
            <ul className={LIST}>
              <li>판이 끝나는 때: 움직일 수 있는 도망자가 없을 때(탈출·얼음·끌려감만 남음) / 첫닭이 울 때. 그때 얼어 있던 사람은 끌려간 것으로 쳐요.</li>
              <li>순위: 도망자 승이면 탈출한 도망자 1위, 나머지 2위. 술래 승·무승부면 술래 1위(무승부일 땐 탈출한 도망자도 1위).</li>
              <li>기록(내 기록·업적): 술래 승, 탈출, 한 번도 안 얼고 탈출, 봉인, 땡!, 소금 명중, 변장 들추기 등.</li>
              <li>사람이 나가면 10초 뒤 AI가 그 자리를 대신하고(술래 자리여도), 돌아오면 돌려받아요. 방장이 나가면 남은 사람이 판을 이어받아요.</li>
              <li>친구끼리 하는 게임이라 판정은 방장 기기가 해요 — 누가 술래인지는 화면에 안 나오지만 네트워크를 뜯어보면 알 수 있어요.</li>
            </ul>
          </section>
        )}
      </div>
    </Overlay>
  );
}
