import { PATCH_NOTES, type PatchNoteChange, type PatchNoteEntry, type PatchNoteGameTag } from "./patchNotes";

/**
 * The patch-notes page shows one card per **date**, not per version (2026-10-21
 * user request): one day often ships several versions, and the same game used
 * to appear in several cards that day. Within a day, all of a game's lines are
 * merged into one group; a group with this many lines or more starts folded,
 * showing only a one-line summary.
 */
export const DAY_GROUP_COLLAPSE_AT = 4;

/**
 * One-line summary shown for a folded day group, keyed by releaseDate then
 * game. **Required** for every group of `DAY_GROUP_COLLAPSE_AT`+ lines
 * (patchNoteDays.test.ts fails otherwise) — when you add patch-note lines
 * that push a game past that on one date, add or update its summary here.
 * Keep it short (≤ 80 chars), headline features only.
 */
export const PATCH_NOTE_DAY_SUMMARIES: Record<string, Partial<Record<PatchNoteGameTag, string>>> = {
  "2026-11-14": {
    "morph-hide": "👮 점검원이 진짜 순경 차림·자연스러운 몸짓, 🔍 더 선명한 화면·바닥 질감 2배·부드러운 노을 하늘",
    "thin-ice-party": "🧊 새 게임 살얼음 파티 — 금 가는 얼음·점프·내려찍기·해빙 경보·유령 투표, 🔊 모든 동작 효과음·3단계 BGM",
  },
  "2026-11-08": {
    "time-loop-heist": "⏳ 새 게임 시간 루프 도둑단 — 루프마다 동시 녹화, 유령·⚠️ 시간 역설, 작전 4개, 🔍 휴대폰 3D 확대",
    "morph-hide": "🃏 증강 고를 때 전체 화면 잠시 해제, 🖥️ PC 큰 화면, 🎭 숨은 모습 진열대, 🗣️ 캐릭터 목소리 감정표현·외침, 👯 분신 제자리",
    common: "🔗 온라인 판 어긋남 자동 복구, ⏳ 장고 게임 무응답 투표 2분, 🧹 준비중 게임 11종 정리",
    "play-dead": "🧬 1·4·7라운드 증강 3택 1 — 23종, 시체에서도 작동하는 부비트랩·명배우, 🪖 BGM·효과음, 🔊 증강 전용 효과음",
  },
  "2026-11-07": {
    "era-march": "✨ 전투 중 증강 3택 1 — 51종(견제 카드 포함), 같은 등급 공정 추첨, 🔍 증강 비교 창, 🤖 봇 증강 선택",
    "morph-hide": "🃏 술래·숨는 쪽 증강(28+12종), 사냥 중 증강 패널, 📋 Tab 라운드 현황, 👮 술래 경찰 모자",
    "merge-defense": "✨ 3·10·18웨이브 증강 3택 1 — 31종, 같은 등급 공정 추첨, 🔄 새로고침, 상대 증강 표시, ⚖️ 봇 2,400판 밸런스, 📈 카드별 내 보드 체감 수치, ✨ 증강 비교 창",
  },
  "2026-11-06": {
    "morph-hide": "🔨 무기·공격 모션, 🏁 꼼꼬미 규칙, ⚡ 렉 줄이기, ⚖️ 헛손질 연속 가중·잡으면 회복, 🤖 셀프플레이 AI, 🧑‍🎤 VRM 캐릭터, 👁 둘러보기·↩ 뒤돌기",
  },
  "2026-11-05": {
    "morph-hide": "🦎 새 게임 변신 숨바꼭질 — 실시간 3D 변신 숨바꼭질, 시간별 무기, 🎥 배그식 3인칭",
  },
  "2026-11-04": {
    "hide-and-seek": "🫣 새 게임 한밤의 숨바꼭질 — 3D 저택을 직접 걸어 숨기, 🔦 손전등·🏃 찜!, 🤖 AI 봇, 🎵 소리",
  },
  "2026-11-01": {
    "star-rummy": "🌌 새 게임 별빛 러미 — 숫자 타일 런·그룹, 🔭 관측소, 🧊 천문대 3D, ✨ 첫 관측 도우미",
    "play-dead": "💀 새 게임 죽은척 대작전 — 몰래 고르고 동시에 쏘는 블러프 총격전, 🪖 전장에 모두 엎드려 엄폐",
    coup: "💥 화려한 연출, 🎭 행동·방어·패스마다 캐릭터 동작, 📜 내 카드 능력, ✓ 진실 행동 하이라이트",
    qplay: "🧊 3D 퀴즈 스튜디오, 🧗 탑·🚀 받침대·⭕❌ 광장 3D 무대, 🎚️ 문제 난이도 선택",
    "era-march": "⚔️ 새 게임 시대의 진격 — 3D 레인 전쟁, 📜 시대마다 교리, 🌐 1:1 온라인, 🛒 전략 상점",
    common: "🎁 보상 69종 5등급(🥉~👑) + 게임 화면 🎁 보상 창, 🗣️ 캐릭터마다 고유 목소리",
  },
  "2026-10-31": {
    common: "🎨 내 스킨 — 뒷면·테이블(방 테마)·🏷️ 이름표·🏺 소품, ✨ 세트, 🖼️ 그림 뒷면 해금 — 같은 방 모두에게 보여요",
  },
  "2026-10-29": {
    "five-cucumbers": "🎥 1인칭(내 캐릭터가 손패를 쥐고 눌러서 내기) | 🪑 테이블 시점에도 내 캐릭터, 🏷️ 누가 낸 카드인지",
    "doodle-phone": "🤖 AI가 주제를 지어내고, 그림 45개·펜 스케치도 알아봐요, 말투, 색약 배려, 🧪 AI 시험장",
  },
  "2026-10-28": {
    common: "🏆 랭킹에 캐릭터 얼굴·👑 1위 칩, ✏️ 꾸미기·💾 저장, 🏷️ 게임 닉네임·👥 같은 이름 구분, 🤲 카드 쥐는 손",
  },
  "2026-10-27": {
    "five-cucumbers": "🧑‍🎤 VRoid 캐릭터, 🃏 3D 테이블 아래 내 손패, 👀 낸 카드는 내 자리에서 똑바로 한 줄로",
    common: "🧑‍🎤 3D 인물이 VRoid 캐릭터 12명으로 — 👗 헤어·옷·신발 바꿔 입기, 💄 메이크업·눈매·렌즈, ⚡ 렉 줄이기",
  },
  "2026-10-25": {
    common: "💡 3D 테이블 조명·선명도, 🃏 손패 쥐기·🎭 성격·🗣️ 감정 음성, 💬 말한 사람 표시, 🏛️ 고풍스러운 배경",
  },
  "2026-10-23": {
    "prism-five": "🦸 신규 변신 히어로 액션 — 고유 규칙이 다른 5명, 콤보·필살기, 괴인 보스 브레이크, 🤖 거대 로봇전",
    "city-chase": "🦹 도둑을 직접 조종해 털고 숨기, 🚓👮🚁 경찰 3종·수갑 검거, 👀 읽기 쉬운 3D·탑뷰, 🔦 화려한 수색",
    "splendor-duel": "💎 보석판은 2D 나선 그대로 반듯하게, 보석만 빛나는 입체 3D — 가져가면 들려 올라 내 자리로",
  },
  "2026-10-22": {
    common: "🧑‍🎤 3D 캐릭터가 K-pop 아이돌로, 📋 캐릭터 목록에서 내 캐릭터 선택, 🤲 손까지 자연스러운 동작",
  },
  "2026-10-21": {
    "god-life-planner": "🎧 전용 BGM·활동별 효과음, 🎬 하루 다시 보기·미리 재생, 🏆 목표 카드·상황 안내·결과 변화 보기",
    "five-cucumbers": "🥒 텃밭 3D 테이블, 🧑 어른 비율의 사실적인 인물, ✨ 이목구비 뚜렷한 미남·미녀 얼굴",
    common: "🎬 49개 게임 카드에 마우스오버 하이라이트 영상, 🖼️ 3D 게임은 '2D로' 버튼으로 예전 화면, 📝 패치노트 날짜별 보기",
  },
  "2026-10-20": {
    "merge-defense": "🧊 3D 입체 디오라마 보드(2D 전환 가능)와 렉 감소, 🗿 사색의 석상 새 디자인",
  },
  "2026-10-19": {
    common: "🎬 영화 포스터 같은 게임 카드, 🔃 정렬 뒤집기·🆕 신규만 보기",
    curling: "🔰 처음 하는 사람용 그림 안내·코치·초보 도우미, 🤖 AI 스킵 콜 개선·숨기기",
  },
  "2026-10-18": {
    chess: "♟️ 신규 게임 체스 — 국제 규칙·체스 시계·수마다 이펙트·기보, AI 봇 Lv.1~10",
    curling: "🥌 신규 게임 컬링 파티 — 다 같이 쓸기·파티 스톤, 스킵 콜·투구 예측, 색약도 구분되는 기호",
    alkkagi: "⚫ 신규 게임 알까기 대전 — 3D 바둑판 알 튕기기, 탁!/딱!/쾅! 충돌 이펙트",
    "wobble-tower": "🪵 신규 게임 와르르 타워 — 직접 잡아 빼는 3D 블록 탑, 관전 예측·리액션",
    "merge-defense": "🗽🗿 석상 타워 2종, 설치 칸 확장·초반 짝 보정, 모바일 알림·판매·자동 버튼 정리",
  },
  "2026-10-15": {
    "merge-defense": "새 타워 3종·몬스터 2종, 등급별 타워 스킬 20종과 스킬마다 전용 이펙트",
  },
  "2026-10-13": {
    "tavern-brawl": "직업 시너지 9개·새 종족 4개·유닛 33종, 시너지 표·감정표현·영웅 아바타, 전투 연출·렉 개선",
    "word-tower": "🏙️ 신규 게임 단어 마천루 — 동시 입력 3D 단어 탑, 🎯 정답 모으기 버전·주제 카테고리",
  },
  "2026-10-12": {
    "tavern-brawl": "🍺 신규 게임 여관 난투 — 2~8인 오토배틀러, 3D 여관 탁자와 타격감",
    "liar-game": "🎭 아는/모르는 라이어 버전, 동시 비공개 설명, 말을 알아듣는 AI",
  },
  "2026-10-11": {
    "bluff-roulette": "🎭 신규 3D 게임 블러프 룰렛 — 카드 블러프와 6연발 리볼버, 살롱 테이블·방아쇠 연출",
    telepathy: "📡 신규 협력 게임 텔레파시 — 꾹 눌러 내기·⚡ 번뜩임, BGM·축하 음악, 인원별 최고 기록",
    common: "🏅 15개 게임 전적 누락 수정·업적 탭, 🎵 27개 게임 BGM, 패치노트 게임별 묶음",
    "ink-duel": "🖌️ 붓 커서와 끝점 이어 그리기(끊어 그린 도형도 인식), 만화 결투 BGM",
    "hungry-shark": "🌟 4티어 각성 5단계, 내 빌드 필터·최강 상어 표시, 심해 사냥 BGM",
  },
  "2026-10-09": {
    "ink-duel": "⚙️ 모드별 방 설정·프리셋 저장·링크 공유, 🛡️ 방패 개편, 방장이 나가도 계속되는 무빙 모드",
    "merge-defense": "새 맵 3종·🤖 자동 모드·맵별 기록, 방어력·판매·웨이브 예고, AI 실력 5단계",
  },
  "2026-10-08": {
    "merge-defense": "신규 게임 랜덤 합성 디펜스 — 생존전·유닛 대결, 난이도·탈락 기준, 광폭 보스·치명타 콤보",
    "ink-duel": "그래픽 전면 개편, 캐릭터 6종·맵 4종, 무기 11종·색 효과 12종, 🏃 실시간 무빙 모드",
    "hungry-shark": "상어 15종 추가(총 41종)·진화 트리 정리, 🎯 추천 진화, 2티어 상향",
  },
  "2026-10-07": {
    common: "🌐 공개방 — 로비 공개방 목록·⚡ 빠른 참가·방 제목, 언제든 공개/비공개 전환",
  },
  "2026-10-04": {
    common: "🌗 라이트 모드 눈부심 줄이기, 🌙 다크 / ☀️ 라이트 / 🖥️ 시스템 테마 선택",
  },
  "2026-09-12": {
    common: "데스크톱 로비 카드 그리드·실시간 인원 뱃지·블랙&골드 테마",
  },
  "2026-08-29": {
    common: "끊긴 자리 봇 대체 투표, 내기 정산 장부, 모바일 로비·제스처 개선",
  },
};

export interface PatchNoteDayGroup {
  game: PatchNoteGameTag;
  /** Newest first (PATCH_NOTES order). */
  changes: PatchNoteChange[];
  /** Folded by default (`changes.length >= DAY_GROUP_COLLAPSE_AT`). */
  collapsed: boolean;
  /** Set for collapsed groups only. */
  summary?: string;
}

export interface PatchNoteDay {
  releaseDate: string;
  /** That day's versions, newest first. */
  entries: PatchNoteEntry[];
  /** One group per game, in first-appearance order. */
  groups: PatchNoteDayGroup[];
}

const TYPE_LABEL = { FEAT: "새 기능", IMPROVE: "개선", FIX: "수정" } as const;

/** Fallback when a summary is missing — e.g. "새 기능 3 · 개선 2". */
function countSummary(changes: PatchNoteChange[]) {
  return (["FEAT", "IMPROVE", "FIX"] as const)
    .map((t) => [t, changes.filter((c) => c.type === t).length] as const)
    .filter(([, n]) => n > 0)
    .map(([t, n]) => `${TYPE_LABEL[t]} ${n}`)
    .join(" · ");
}

/** PATCH_NOTES (newest first) → one `PatchNoteDay` per releaseDate. */
export function groupPatchNotesByDay(notes: PatchNoteEntry[] = PATCH_NOTES): PatchNoteDay[] {
  const days: PatchNoteDay[] = [];
  for (const entry of notes) {
    const last = days[days.length - 1];
    if (last && last.releaseDate === entry.releaseDate) last.entries.push(entry);
    else days.push({ releaseDate: entry.releaseDate, entries: [entry], groups: [] });
  }
  for (const day of days) {
    const byGame = new Map<PatchNoteGameTag, PatchNoteChange[]>();
    for (const change of day.entries.flatMap((e) => e.changes)) {
      const group = byGame.get(change.game);
      if (group) group.push(change);
      else byGame.set(change.game, [change]);
    }
    day.groups = [...byGame].map(([game, changes]) => {
      const collapsed = changes.length >= DAY_GROUP_COLLAPSE_AT;
      if (!collapsed) return { game, changes, collapsed };
      const summary = PATCH_NOTE_DAY_SUMMARIES[day.releaseDate]?.[game] ?? countSummary(changes);
      return { game, changes, collapsed, summary };
    });
  }
  return days;
}
