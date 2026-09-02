"use client";

import { useState } from "react";
import type { Scenario } from "./scenarios";
import type { QuestionLogEntry } from "./engine";
import PhotoModal from "./PhotoModal";
import LockedEvidenceSlot from "./LockedEvidenceSlot";

/**
 * 체계적 수사 분석 대시보드 — 타임테이블/증거단서함/문자메시지/증언록 4개 탭을 오가는
 * 드로어. 데스크톱은 화면 우측에서 슬라이드, 모바일은 하단 바텀시트로 뜬다(둘 다 같은
 * 토글 버튼 하나로 열고 닫음 — 달무티 `ExchangeHistoryPanel.tsx`의 "상시 표시 사이드바"
 * 대신, 이 게임은 콘텐츠가 4탭×여러 항목으로 훨씬 커서 필요할 때만 펼치는 드로어 형태를
 * 택했다). 전원 공개 정보이므로 좌석/뷰어 구분 없이 시나리오 데이터를 그대로 보여준다.
 *
 * 2026-09-03 세션 — 난이도 3단계 확장: `difficulty`가 LV2 이상이면 증거 카드에 카메라
 * 아이콘/썸네일이 붙어 `PhotoModal` 라이트박스로 확대할 수 있고, LV3면 증언록이
 * `testimoniesLv3`(위증 포함 버전)로 바뀌고 잠금 단서 섹션이 추가된다. 잠금 해금 판정은
 * 새 상태 없이 `questionLog`(triggerId+verdict)만으로 순수 계산한다 — 엔진 변경 없음.
 */

type TabId = "timeline" | "evidence" | "messages" | "testimonies";

const TABS: { id: TabId; label: string; emoji: string }[] = [
  { id: "timeline", label: "타임테이블", emoji: "⏰" },
  { id: "evidence", label: "증거단서함", emoji: "🔍" },
  { id: "messages", label: "문자메시지", emoji: "💬" },
  { id: "testimonies", label: "인물 증언록", emoji: "🗣️" },
];

export default function InvestigationPanel({
  scenario,
  difficulty,
  questionLog,
}: {
  scenario: Scenario;
  difficulty: Scenario["difficultySupport"][number];
  questionLog: readonly QuestionLogEntry[];
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<TabId>("timeline");
  const [openPhoto, setOpenPhoto] = useState<{ title: string; photo: NonNullable<Scenario["evidence"][number]["photo"]> } | null>(null);

  const showPhotos = difficulty !== "LV1";
  const isLv3 = difficulty === "LV3";
  const testimonies = isLv3 && scenario.testimoniesLv3 ? scenario.testimoniesLv3 : scenario.testimonies;
  const greenTriggerIds = new Set(questionLog.filter((e) => e.verdict === "green" && e.triggerId).map((e) => e.triggerId as string));

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        // bottom-24: 사이트 전역 플로팅 버튼(내기 사이드바 `right-4 bottom-4`,
        // 채팅/버그 리포트 `left-4 bottom-4`)과의 충돌을 피하려고 두 버튼 위쪽
        // 자리에 고정 — sm 이상에서도 내리지 않는다(desktop에서 bottom-6까지
        // 내리면 내기 사이드바 토글과 다시 겹치는 실측 버그를 봐서 고정값 유지).
        className="fixed bottom-24 right-3 z-30 flex items-center gap-1.5 rounded-full border border-cyan-400/30 bg-slate-900/90 px-4 py-2.5 text-xs font-semibold text-cyan-200 shadow-lg backdrop-blur-md transition hover:border-cyan-300/50"
      >
        🗂️ 수사 노트
      </button>

      {open && (
        <div className="fixed inset-0 z-40 flex items-end justify-end sm:items-stretch">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="relative flex max-h-[85vh] w-full flex-col rounded-t-2xl border border-white/10 bg-slate-900 shadow-2xl sm:h-full sm:max-h-none sm:w-[420px] sm:rounded-none sm:rounded-l-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <h3 className="break-keep text-sm font-bold text-white">🗂️ 수사 노트</h3>
              <button onClick={() => setOpen(false)} className="rounded-full p-1.5 text-white/50 hover:bg-white/10 hover:text-white">
                ✕
              </button>
            </div>

            <div className="flex gap-1 overflow-x-auto border-b border-white/10 px-2 py-2">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`shrink-0 whitespace-nowrap break-keep rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    tab === t.id ? "bg-cyan-500 text-slate-950" : "text-white/60 hover:bg-white/10"
                  }`}
                >
                  {t.emoji} {t.label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {tab === "timeline" && (
                <ol className="flex flex-col gap-3">
                  {scenario.timeline.map((e, i) => (
                    <li key={i} className="flex gap-3 text-sm">
                      <span className="shrink-0 rounded-md bg-cyan-500/10 px-2 py-0.5 text-xs font-mono font-semibold text-cyan-300">{e.time}</span>
                      <span className="break-keep text-white/80">{e.description}</span>
                    </li>
                  ))}
                </ol>
              )}
              {tab === "evidence" && (
                <ul className="flex flex-col gap-3">
                  {scenario.evidence.map((e) => {
                    const photo = showPhotos ? e.photo : undefined;
                    return (
                      <li key={e.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                        <div className="flex items-start gap-3">
                          {photo && (
                            <button
                              onClick={() => setOpenPhoto({ title: e.name, photo })}
                              className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-black/30"
                            >
                              {/* 썸네일은 순수 CSS 배경으로 — 목록 스크롤 중 다수의 next/image
                                  인스턴스를 띄우지 않으려는 선택(라이트박스에서만 next/image 사용). */}
                              <span
                                className="absolute inset-0 bg-cover bg-center"
                                style={{ backgroundImage: `url(${photo.url})` }}
                              />
                              <span className="absolute bottom-0.5 right-0.5 rounded bg-black/60 px-1 text-[9px]">📷</span>
                            </button>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="break-keep text-sm font-bold text-white">🧩 {e.name}</p>
                            <p className="mt-1 break-keep text-xs leading-relaxed text-white/60">{e.description}</p>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                  {isLv3 && scenario.lockedEvidence && scenario.lockedEvidence.length > 0 && (
                    <>
                      <p className="mt-1 break-keep text-[11px] font-semibold tracking-wide text-fuchsia-300/70 uppercase">
                        🔐 잠금 단서
                      </p>
                      {scenario.lockedEvidence.map((locked) => (
                        <LockedEvidenceSlot key={locked.id} item={locked} unlocked={greenTriggerIds.has(locked.unlockTriggerId)} />
                      ))}
                    </>
                  )}
                </ul>
              )}
              {tab === "messages" && (
                <ul className="flex flex-col gap-2.5">
                  {scenario.messages.map((m) => (
                    <li key={m.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                      <p className="flex items-center justify-between text-xs text-white/40">
                        <span className="break-keep font-semibold text-cyan-300">
                          {m.from} → {m.to}
                        </span>
                        <span className="font-mono">{m.time}</span>
                      </p>
                      <p className="mt-1 break-keep text-sm text-white/80">&ldquo;{m.content}&rdquo;</p>
                    </li>
                  ))}
                </ul>
              )}
              {tab === "testimonies" && (
                <ul className="flex flex-col gap-3">
                  {isLv3 && (
                    <p className="break-keep rounded-md bg-fuchsia-500/10 px-2.5 py-1.5 text-[11px] text-fuchsia-200/80">
                      ⚠️ 이 난이도에서는 증언 중 일부가 사건의 진실과 어긋날 수 있습니다 — 신호등 판정, 타임테이블,
                      증거와 교차 대조해서 위증을 스스로 간파해 보세요.
                    </p>
                  )}
                  {testimonies.map((t) => (
                    <li key={t.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                      <p className="break-keep text-sm font-bold text-white">🗣️ {t.witness}</p>
                      <p className="mt-1 break-keep text-sm leading-relaxed text-white/80">&ldquo;{t.statement}&rdquo;</p>
                      {t.contradictsWith && t.contradictsWith.length > 0 && (
                        <p className="mt-2 break-keep rounded-md bg-rose-500/10 px-2 py-1 text-xs text-rose-300">
                          ⚠️ 다른 증언과 모순됨 —{" "}
                          {t.contradictsWith
                            .map((id) => testimonies.find((o) => o.id === id)?.witness)
                            .filter(Boolean)
                            .join(", ")}
                          의 증언과 대조해 보세요.
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
      {openPhoto && <PhotoModal title={openPhoto.title} photo={openPhoto.photo} onClose={() => setOpenPhoto(null)} />}
    </>
  );
}
