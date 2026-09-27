"use client";

import Overlay from "@/components/Overlay";
import { MAX_PLAYERS, MIN_PLAYERS, TEXT_MAX_CHARS, TEXT_MIN_CHARS } from "./engine";
import { GAME_MODES, MODES, TIME_MULTIPLIER_MAX, TIME_MULTIPLIER_MIN } from "./modes";
import { THEME_CATEGORIES, THEME_CHOICE_COUNT, THEME_INFO } from "./themes";

const box = "rounded-xl border border-white/10 bg-white/5 p-3 light:border-slate-200 light:bg-white light:shadow-sm";
const h3 = "mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";

/** In-app summary of boardGameRule/갈틱폰/갈틱폰.md. Mode names and times come from modes.ts so they can't drift. */
export default function DoodlePhoneRulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="✏️ 그림 전화기 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80 light:text-slate-700">
        <p className="text-white/70 light:text-slate-600">
          갈틱폰 스타일 그림 릴레이 게임 ({MIN_PLAYERS}~{MAX_PLAYERS}인). 문장 → 그림 → 문장 → 그림… 이 사람에서 사람으로 전달되며 점점 엉뚱하게 변해가는 과정을 함께 보며 웃는 게임이에요.
        </p>

        <section>
          <h3 className={h3}>진행 (일반 모드 기준)</h3>
          <div className={box}>
            <ol className="list-decimal space-y-1 pl-4 text-xs text-white/70 light:text-slate-600">
              <li>1턴: 모두 각자 자기 앨범에 재미있는 문장(제시어)을 씁니다.</li>
              <li>앨범이 옆 사람에게 넘어가고, 짝수 턴에는 받은 <b>문장만</b> 보고 그림을 그립니다.</li>
              <li>홀수 턴에는 받은 <b>그림만</b> 보고 무엇인지 문장으로 추측합니다.</li>
              <li>인원 수만큼 턴을 돌면 모든 앨범이 완성되고, 결과 발표가 시작돼요.</li>
            </ol>
          </div>
        </section>

        <section>
          <h3 className={h3}>게임 모드 9종 (방장이 대기실에서 선택)</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {GAME_MODES.map((mode) => (
              <div key={mode} className={box}>
                <b>
                  {MODES[mode].icon} {MODES[mode].title}
                </b>
                <p className="mt-1 text-xs text-white/70 light:text-slate-600">{MODES[mode].description}</p>
                <p className="mt-1 text-[11px] text-white/45 light:text-slate-400">⏱ {MODES[mode].timeLabel}</p>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-white/50 light:text-slate-500">
            방장은 제한 시간 배율({TIME_MULTIPLIER_MIN}×~{TIME_MULTIPLIER_MAX}×), 애니메이션 잔상 표시, 되돌리기 허용 여부도 정할 수 있어요. 모두 제출하면 시간이
            남아도 바로 다음 턴으로 넘어가요. 0초가 되면 그리던 그림은 그대로 제출되고, 비어 있는 문장은 랜덤 제시어로 자동 채워져요(⏰ 자동 표시).
          </p>
        </section>

        <section>
          <h3 className={h3}>테마 팩 (모드와 자유롭게 조합)</h3>
          <div className="grid gap-2 sm:grid-cols-3">
            {THEME_CATEGORIES.map((theme) => (
              <div key={theme} className={box}>
                <b>
                  {THEME_INFO[theme].icon} {THEME_INFO[theme].name}
                </b>
                <p className="mt-1 text-xs text-white/60 light:text-slate-500">{THEME_INFO[theme].description}</p>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-white/50 light:text-slate-500">
            자유 주제가 아니면 1턴에 앨범마다 테마 키워드 {THEME_CHOICE_COUNT}개를 추천해요 — 눌러서 고르거나 직접 써도 돼요. 전부 그림인 모드에서는 첫 그림의
            아이디어로 보여줘요. 아이스브레이커 모드는 질문의 답이 제시어라 테마가 적용되지 않아요.
          </p>
        </section>

        <section>
          <h3 className={h3}>입력</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className={box}>✍️ 문장은 {TEXT_MIN_CHARS}~{TEXT_MAX_CHARS}자, Enter로 바로 제출.</div>
            <div className={box}>🎨 펜 · 직선 · 네모 · 원(면 채우기 가능, Shift로 정사각형·정원) · 채우기 · 지우개 · 되돌리기(Ctrl+Z) · 다시하기(Ctrl+Y) · 전체 지우기, 👆 선택·이동(옮기기·크기 조절·선택 삭제), 굵기 5단계, 20색 + 🎨 직접 고르기 + 💧 스포이드, 농도(연하게 ↔ 짙게). 📱 두 손가락으로 확대·이동(데스크톱은 Ctrl+휠). 잉크 게이지를 다 쓰면 더 그릴 수 없어요.</div>
          </div>
        </section>

        <section>
          <h3 className={h3}>결과 발표 & 웃음왕</h3>
          <div className={box}>
            <ul className="list-disc space-y-1 pl-4 text-xs text-white/70 light:text-slate-600">
              <li>방장이 앨범을 한 장씩 넘기며 공개해요(자동 넘기기 가능). 그림은 그려지는 과정이 재생됩니다.</li>
              <li>누구나 😂 🤯 👏 ❤️ 🤔 리액션을 보낼 수 있어요 — 한 장에 최대 3번, 내 작품에는 불가.</li>
              <li>리액션을 가장 많이 받은 사람이 <b>웃음왕</b>! (점수 모드에서는 앨범마다 최고의 장면 투표 득표 수로 순위를 정해요.) 결과 화면에서 모든 앨범을 다시 보고 그림을 PNG로 저장할 수 있어요.</li>
            </ul>
          </div>
        </section>

        <section>
          <h3 className={h3}>연결이 끊기면</h3>
          <div className={box}>
            다른 플레이어들의 투표로 AI 봇이 그 자리를 이어받아 그리고 추측해요. 돌아오면 자리를 되찾을 수 있어요. 응답이 없는 자리는 방장 기기가 제한 시간 뒤 자동으로 채워 게임이 멈추지 않아요.
          </div>
        </section>
      </div>
    </Overlay>
  );
}
