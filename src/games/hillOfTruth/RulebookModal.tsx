"use client";

import Overlay from "@/components/Overlay";
import { MAX_HIDDEN_QUESTIONS, ANSWER_COOLDOWN_MS } from "./engine";

export default function RulebookModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="📖 진실의 고개 룰북" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm text-white/80">
        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">목표</h3>
          <p className="text-white/70">
            딜러(게임 시스템)가 숨겨둔 사건의 진실을 질문으로 파헤쳐, 참가자 중 <b>가장 먼저 정답을 맞히는</b> 사람이
            승리하는 단서 추리 게임입니다. 2~8인이 함께 참여할 수 있습니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">시나리오 구성</h3>
          <ul className="list-disc space-y-1.5 pl-4 text-white/70">
            <li>
              <b>유형 A(원작 헌정 시나리오)</b>: 방송 밀실 사건을 다루는 완결형 시나리오 1편이 고정 후보로
              포함됩니다.
            </li>
            <li>
              <b>유형 B(사전 검증 시나리오)</b>: 정제된 시나리오 풀에서 매 게임 시작 시 무작위로 하나를 뽑습니다
              (인터넷 실시간 검색은 전혀 쓰지 않는, 완전히 로컬화된 데이터입니다).
            </li>
          </ul>
        </section>

        <section className="rounded-xl border border-cyan-300/20 bg-cyan-400/5 p-3">
          <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-cyan-200/90 uppercase">🎚️ 난이도 3단계 (방 생성 시 선택)</h3>
          <ul className="list-disc space-y-1.5 pl-4 text-xs text-white/70">
            <li>
              <b>🟢 Lv.1 기본</b> — 텍스트 단서(타임테이블/증거/메시지/증언록)만으로 추리합니다.
            </li>
            <li>
              <b>🟡 Lv.2 심화</b> — Lv.1 전부 + 증거단서함의 일부 항목에 실제 사진이 붙습니다. 증거 카드의
              📷 썸네일을 누르면 화면 중앙에 고해상도로 확대돼 열립니다.
            </li>
            <li>
              <b>🔴 Lv.3 하드코어</b> — Lv.2 전부 + 증언록 중 일부가 사건의 진실과 어긋나는 <b>위증</b>을
              포함합니다(딜러는 여전히 진실 기준으로만 판정하므로, 증언과 판정이 어긋나면 그 자체가 단서입니다).
              또한 특정 핵심 질문에서 초록불을 받아야만 해금되는 🔐 <b>잠금 단서</b>가 증거단서함에 추가됩니다.
            </li>
          </ul>
          <p className="mt-2 break-keep text-[11px] text-white/50">
            히든 질문 횟수(최대 {MAX_HIDDEN_QUESTIONS}회)와 오답 쿨타임({ANSWER_COOLDOWN_MS / 1000}초)은 난이도와
            무관하게 동일합니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">내 턴에 하는 행동</h3>
          <ol className="list-decimal space-y-1.5 pl-4 text-white/70">
            <li>
              <b>🌐 공개 질문</b>: 질문 내용과 딜러의 판정이 전원에게 공개됩니다.
            </li>
            <li>
              <b>🔒 히든 질문</b>: 질문 <b>내용</b>은 나와 딜러만 알 수 있고, 다른 참가자에게는 판정
              색상만 공개됩니다. 1인당 최대 <b>{MAX_HIDDEN_QUESTIONS}회</b>까지 쓸 수 있으며, 남은 횟수는 질문
              입력창 옆에 실시간으로 표시됩니다.
            </li>
            <li>
              <b>🙋 정답 선언</b>: 사건의 진상을 문장으로 제출합니다.
            </li>
            <li>
              <b>⏭️ 패스</b>: 이번 턴을 그냥 넘길 수도 있습니다.
            </li>
          </ol>
          <p className="mt-2 text-xs text-white/50">순서는 참가자 순번대로 돌아가며(라운드 로빈), 자기 턴에만 행동할 수 있습니다.</p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">딜러의 3색 신호등 판정</h3>
          <ul className="list-disc space-y-1.5 pl-4 text-white/70">
            <li>🔵 <b>초록불</b> — 질문이 사건의 진실과 정확히 일치합니다.</li>
            <li>🟡 <b>노란불</b> — 일부만 맞거나 방향이 근접합니다(구체적으로 어디가 맞고 틀렸는지는 게임 종료 후 복기 리포트에서 확인).</li>
            <li>🔴 <b>빨간불</b> — 질문이 사건의 진실과 다릅니다.</li>
          </ul>
        </section>

        <section className="rounded-xl border border-emerald-300/20 bg-emerald-400/5 p-3">
          <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-emerald-200/90 uppercase">승리 &amp; 오답 페널티 (구버전과의 차이)</h3>
          <p className="text-xs text-white/70">
            <b>선착순 정답 적중 승리제</b> — 누구든 사건의 핵심 요소(범인·트릭·동기 등)를 모두 포함한 정답을 먼저
            선언하면 그 즉시 승리합니다. 오답을 제출해도 <b>탈락하지 않습니다</b> — 대신 그 사람에게만{" "}
            <b>{ANSWER_COOLDOWN_MS / 1000}초 쿨타임</b>이 걸려 그 시간 동안은 정답 선언 버튼만 잠기고(질문은 계속
            가능), 게임은 계속됩니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">🗂️ 수사 노트 (분석 도구)</h3>
          <p className="text-white/70">
            화면 우하단 &ldquo;🗂️ 수사 노트&rdquo; 버튼으로 언제든 열 수 있는 4개 탭 — ⏰ 타임테이블(시간대별
            사건 흐름), 🔍 증거단서함, 💬 문자메시지/통화내역, 🗣️ 인물 증언록(모순되는 증언끼리 서로 표시)을
            자유롭게 오가며 단서를 정리할 수 있습니다.
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">🟡 노란불 복기 리포트</h3>
          <p className="text-white/70">
            게임이 끝나면 이번 판에 나온 모든 노란불 판정을 모아, 각 질문의 어느 부분이 맞고 어느 부분이 틀렸는지
            짚어주는 리포트가 자동으로 뜹니다(3초 후 자동으로 닫히며, 하단 ⏩ 스킵 버튼으로 언제든 즉시 닫을 수
            있습니다 — 결과 화면에서 다시 볼 수도 있습니다).
          </p>
        </section>

        <section className="rounded-xl border border-amber-300/20 bg-amber-400/5 p-3">
          <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-amber-200/90 uppercase">참고</h3>
          <p className="text-xs text-white/60">
            각자 다른 기기에서 접속하는 실시간 온라인 전용 대전입니다. 딜러의 판정은 사람이 아니라 게임 시스템이
            사전에 정해둔 데이터로 자동 채점하므로, 질문은 예/아니오로 답할 수 있는 구체적인 문장 형태를 권장합니다.
          </p>
        </section>
      </div>
    </Overlay>
  );
}
