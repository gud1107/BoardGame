/**
 * 진실의 고개 — 시나리오 DB.
 *
 * 유형 A(필수 원작 재현) / 유형 B(사전 검증 롤링) 스키마는 동일하다 — `type` 필드로만
 * 구분한다. 유형 C(실시간 웹 탐색 모드)는 설계에서 완전히 제외됐다(이 파일은 오직
 * 로컬 정적 데이터만 다룬다 — 런타임에 외부 API를 호출하지 않는다, `applyAction`의
 * 순수성 계약을 그대로 지킨다).
 *
 * ⚠️ 저작권 참고: `type: "A"` 시나리오("하준 vs 소라")는 요청서가 언급한 실제 예능
 * 프로그램(및 그 안의 특정 회차)을 **그대로 복제하지 않는다** — 인물명·구체적 대사·
 * 트릭의 세부 구현을 전부 새로 창작한 "오리지널 헌정작(원작 스타일 오마주)"이다
 * (2026-09-02 세션에서 AskUserQuestion으로 확정, HANDOFF.md 참고). 실제 저작물의
 * 캐릭터명이나 트릭을 그대로 가져오지 않았으므로, 실존 콘텐츠와의 직접적 유사성은
 * 의도적으로 배제했다.
 *
 * 판정 방식: 룰북상 "딜러"는 사람이 아니라 이 파일의 데이터로 구동되는 게임 엔진
 * 자체다(2026-09-02 세션에서 확정). 외부 LLM 호출 없이 순수 텍스트 매칭만으로
 * 신호등 판정을 내려야 하므로, 플레이어의 자유 텍스트 질문은 `questionBank`의
 * `keywords`(부분 문자열 매칭, OR)로 판정한다 — 아무 트리거에도 안 걸리면 기본값은
 * 🔴 빨간불이다(룰북 "질문 내용이 사건의 진실과 전혀 다름"과 동일한 의미로 취급).
 * 이 한계 때문에 각 시나리오는 흔히 나올 법한 질문 각도를 폭넓게 커버하는
 * `questionBank`를 갖춰야 한다.
 */

export type SemaphoreColor = "green" | "yellow" | "red";

/**
 * 방 난이도 3단계(2026-09-03 세션, AskUserQuestion으로 확정) — 딜러 판정 로직
 * (`matchTrigger`/`isCorrectAnswer`)은 난이도와 무관하게 항상 진실 기준으로만
 * 동작한다(전혀 변경 없음). 난이도가 실제로 바꾸는 건 ①시나리오 풀 필터링
 * (`difficultySupport`)과 ②UI에 무엇을 더 보여주는지뿐이다:
 *  - LV1: 텍스트 단서만(타임테이블/증거/메시지/증언). 기존 10개 시나리오는 전부 LV1만 지원.
 *  - LV2: LV1 전부 + 증거 항목에 사진(`EvidenceItem.photo`)이 붙어 라이트박스로 확대 가능.
 *  - LV3: LV2 전부 + 증언록 일부가 진실과 어긋나는 위증 버전(`testimoniesLv3`)으로 교체되고,
 *    특정 트리거에서 초록불을 받아야 해금되는 `lockedEvidence`가 추가된다.
 * 히든 질문 횟수(7회)와 오답 쿨타임(20초)은 이번 패치에서 난이도별로 차등화하지
 * 않기로 확정했다(요청자 지시 — "쿨타임은 일단 이번 패치에선 제한하지 말아주세요").
 */
export type Difficulty = "LV1" | "LV2" | "LV3";

/** 딜러 판정 트리거 1건. `sampleQuestion`은 봇이 실제로 물어보는 질문 문장이자, 사람
 * 플레이어에게 보여주는 예시이기도 하다. */
export interface QuestionTrigger {
  id: string;
  /** 이 트리거가 대표하는 실제 질문 문장(봇이 그대로 사용). */
  sampleQuestion: string;
  /** 플레이어의 자유 텍스트 질문에 이 키워드 중 하나라도 포함되면 이 트리거가 발동. */
  keywords: string[];
  verdict: SemaphoreColor;
  /** verdict가 yellow일 때 필수 — 노란불 복기 리포트에 그대로 노출되는 사유. */
  yellowDetail?: string;
  /** 봇의 질문 우선순위(1=낮음~3=핵심 단서). 레벨이 높을수록 importance가 큰 순서로 소진한다. */
  importance: 1 | 2 | 3;
}

export interface TimelineEntry {
  time: string;
  description: string;
}

export interface EvidencePhoto {
  /** `/public` 기준 로컬 경로 — 전부 무료 라이선스(CC0/CC-BY/CC-BY-SA/Public domain)
   * 이미지를 인터넷에서 검색해 다운로드한 실사진이다(2026-09-03 세션 지시 —
   * "이미지를 직접 생성하지 말고 인터넷에서 찾아서 다운로드"). 출처는
   * `public/images/hillOfTruth/evidence/CREDITS.json` 참고. */
  url: string;
  alt: string;
  /** 라이선스 표기(라이트박스 하단에 노출) — CC-BY 계열 출처 표시 의무 준수. */
  credit: string;
}

export interface EvidenceItem {
  id: string;
  name: string;
  description: string;
  /** LV2 이상에서만 노출되는 사진 증거(선택 필드). 없으면 텍스트 카드로만 렌더링된다. */
  photo?: EvidencePhoto;
}

/** LV3 전용 잠금 단서 — 특정 트리거(questionBank의 id)로 초록불을 받아야 해금된다.
 * 해금 판정은 새 상태 없이 기존 `questionLog`(triggerId+verdict)만으로 순수 계산한다
 * (엔진 변경 불필요 — HillOfTruthBoard/InvestigationPanel의 UI 계산). */
export interface LockedEvidenceItem {
  id: string;
  name: string;
  /** 해금 전 잠금 상태에서 보여주는 힌트 문구. */
  unlockHint: string;
  /** 해금 후 노출되는 본문. */
  description: string;
  photo?: EvidencePhoto;
  /** 이 트리거 id로 초록불을 받아야 해금(questionBank 트리거 참조). */
  unlockTriggerId: string;
}

export interface MessageLogEntry {
  id: string;
  from: string;
  to: string;
  time: string;
  content: string;
}

export interface TestimonyEntry {
  id: string;
  witness: string;
  statement: string;
  /** 서로 모순되는 다른 증언의 id 목록(대조표 렌더링용). */
  contradictsWith?: string[];
}

export interface Scenario {
  id: string;
  type: "A" | "B";
  /** 이 시나리오가 어떤 방 난이도에서 롤링될 수 있는지. 기존 10개 시나리오는
   * `["LV1"]`뿐이고, 2026-09-03 세션에서 신규 저작한 시나리오만 3단계를 전부 지원한다. */
  difficultySupport: readonly Difficulty[];
  title: string;
  /** 전 플레이어 공개 개요(세팅 시 공유). */
  synopsis: string;
  /** 사건의 진실 전문 — 정답 적중/노란불 복기 리포트에서만 노출. */
  truth: string;
  /** 최종 정답 판정: 각 그룹에서 최소 1개 키워드가 텍스트에 포함돼야 하며, 모든
   * 그룹을 통과해야 정답으로 인정한다(그룹 = 범인/트릭/동기 등 핵심 요소 단위). */
  answerRequiredKeywordGroups: { label: string; keywords: string[] }[];
  questionBank: QuestionTrigger[];
  timeline: TimelineEntry[];
  evidence: EvidenceItem[];
  messages: MessageLogEntry[];
  testimonies: TestimonyEntry[];
  /** LV3에서만 `testimonies` 대신 이 배열을 보여준다(위증 포함 버전). 없으면 LV3도
   * `testimonies` 그대로 사용. */
  testimoniesLv3?: readonly TestimonyEntry[];
  /** LV3 전용 잠금 단서. 없으면 빈 배열과 동일하게 취급. */
  lockedEvidence?: readonly LockedEvidenceItem[];
}

function buildCorrectAnswerText(scenario: Scenario): string {
  return scenario.answerRequiredKeywordGroups.map((g) => g.keywords[0]).join(" ");
}

/** 봇/테스트가 실제로 "정답"으로 제출할 수 있는 완전한 정답 텍스트. */
export function correctAnswerTextFor(scenario: Scenario): string {
  return buildCorrectAnswerText(scenario);
}

// ---------------------------------------------------------------------------
// 유형 A: 필수 원작 재현(오리지널 헌정작) — 1선
// ---------------------------------------------------------------------------

const SCENARIO_A_HAJUN_SORA: Scenario = {
  id: "a-01-midnight-broadcast",
  type: "A",
  difficultySupport: ["LV1"],
  title: "심야 생방송의 밀실",
  synopsis:
    "인기 진행자 하준과 게스트 소라가 단둘이 진행하던 심야 라디오 생방송 도중, 방송 부스 안에서 하준이 정신을 잃은 채 발견됐다. 부스 문은 안에서 잠겨 있었고, 방송은 끊기지 않은 채 그대로 흘러나가고 있었다. 소라는 방송 종료 10분 전 부스 밖으로 나갔다고 주장한다. 대체 무슨 일이 있었던 걸까?",
  truth:
    "소라는 방송 중 하준에게 몰래 수면 성분이 든 음료를 건넨 뒤, 부스 문이 자동으로 잠기는 '방음 모드'를 원격으로 작동시키고 밖으로 나갔다. 방송이 끊기지 않은 것처럼 보인 건 사전 녹음된 하준의 오프닝 멘트 구간을 반복 재생하는 '컨티뉴어스 루프' 장비를 소라가 사전에 설정해뒀기 때문이다. 동기는 하준이 소라의 표절 의혹을 다음 방송에서 폭로하려던 것을 막기 위함이었다.",
  answerRequiredKeywordGroups: [
    { label: "범인", keywords: ["소라"] },
    { label: "트릭", keywords: ["루프", "반복재생", "컨티뉴어스", "녹음"] },
    { label: "동기", keywords: ["표절", "폭로"] },
  ],
  questionBank: [
    { id: "a01-q1", sampleQuestion: "범인은 소라입니까?", keywords: ["범인", "소라"], verdict: "green", importance: 3 },
    { id: "a01-q2", sampleQuestion: "하준은 독극물 때문에 쓰러졌습니까?", keywords: ["독극물", "독"], verdict: "yellow", yellowDetail: "완전한 독극물은 아니지만 '수면 성분이 든 음료'라는 점에서는 방향이 맞습니다.", importance: 3 },
    { id: "a01-q3", sampleQuestion: "부스 문은 물리적으로 잠긴 것입니까?", keywords: ["문", "잠금", "잠겼"], verdict: "yellow", yellowDetail: "문이 잠긴 건 맞지만 '물리적 자물쇠'가 아니라 원격 조작된 '방음 모드'입니다.", importance: 2 },
    { id: "a01-q4", sampleQuestion: "방송이 계속 나온 건 사전 녹음 반복 재생 때문입니까?", keywords: ["녹음", "반복", "루프"], verdict: "green", importance: 3 },
    { id: "a01-q5", sampleQuestion: "범행 동기는 표절 폭로를 막기 위해서입니까?", keywords: ["표절", "폭로", "동기"], verdict: "green", importance: 3 },
    { id: "a01-q6", sampleQuestion: "제3의 인물이 부스에 몰래 들어왔습니까?", keywords: ["제3", "다른 사람", "공범"], verdict: "red", importance: 2 },
    { id: "a01-q7", sampleQuestion: "소라가 방송 종료 10분 전 나간 건 사실입니까?", keywords: ["10분 전", "나간"], verdict: "yellow", yellowDetail: "시간대는 맞지만 '단순히 나간 것'이 아니라 그 직전에 음료에 수면 성분을 타는 결정적 행동을 했습니다.", importance: 2 },
    { id: "a01-q8", sampleQuestion: "하준이 스스로 쓰러진 건 지병 때문입니까?", keywords: ["지병", "지병때문", "자연"], verdict: "red", importance: 1 },
    { id: "a01-q9", sampleQuestion: "루프 장비는 사전에 설정된 것입니까?", keywords: ["사전", "미리 설정", "예약"], verdict: "green", importance: 2 },
    { id: "a01-q10", sampleQuestion: "소라는 하준과 방송 파트너 관계였습니까?", keywords: ["파트너", "관계", "동료"], verdict: "yellow", yellowDetail: "표면적으로는 방송 파트너지만, 실제로는 표절 의혹을 두고 대립하던 관계였습니다.", importance: 1 },
    { id: "a01-q11", sampleQuestion: "부스 안에 흉기가 있었습니까?", keywords: ["흉기", "칼", "무기"], verdict: "red", importance: 1 },
    { id: "a01-q12", sampleQuestion: "음료에 무언가를 탄 사람이 범인입니까?", keywords: ["음료", "탄", "성분"], verdict: "green", importance: 3 },
  ],
  timeline: [
    { time: "23:00", description: "생방송 시작. 하준과 소라 둘만 부스에 입장." },
    { time: "23:20", description: "소라가 하준에게 '피로회복 음료'를 건넴(수면 성분 투입 시점)." },
    { time: "23:45", description: "소라가 방음 모드 원격 스위치를 조작." },
    { time: "23:50", description: "소라, 부스 밖으로 나감. 이후 방송은 사전 녹음 루프로 대체." },
    { time: "00:00", description: "방송 종료 직후 스태프가 부스 문을 열지 못해 비상 해제." },
    { time: "00:05", description: "하준, 의식 잃은 채 발견됨." },
  ],
  evidence: [
    { id: "a01-e1", name: "피로회복 음료 캔", description: "소라가 건넨 음료 캔. 미세한 가루 흔적이 발견됨." },
    { id: "a01-e2", name: "방음 모드 원격 스위치 로그", description: "23:45에 스위치가 원격으로 작동한 기록." },
    { id: "a01-e3", name: "루프 장비 예약 설정 화면", description: "23:50부터 하준의 오프닝 멘트가 반복 재생되도록 예약돼 있었음." },
    { id: "a01-e4", name: "표절 의혹 제보 메일", description: "하준이 받은 익명 제보 메일. 소라의 과거 방송 대본이 타 작가 원고와 유사하다는 내용." },
  ],
  messages: [
    { id: "a01-m1", from: "하준", to: "제작진", time: "22:40", content: "다음 방송에서 표절 건 짚고 넘어가려고요. 자료 준비해주세요." },
    { id: "a01-m2", from: "소라", to: "지인", time: "22:55", content: "오늘 방송 끝나고 얘기 좀 해야 할 것 같아요. 중요한 일이에요." },
    { id: "a01-m3", from: "제작진", to: "소라", time: "23:10", content: "표절 관련 자료 하준 작가님이 요청하셨는데 혹시 아시는 내용 있으세요?" },
  ],
  testimonies: [
    { id: "a01-t1", witness: "소라", statement: "저는 방송 종료 10분 전에 화장실 때문에 잠깐 나갔을 뿐이에요.", contradictsWith: ["a01-t2"] },
    { id: "a01-t2", witness: "스태프 민서", statement: "23:45쯤 소라 씨가 조정실 쪽 스위치 패널 앞에 서 있는 걸 봤어요.", contradictsWith: ["a01-t1"] },
    { id: "a01-t3", witness: "작가 도윤", statement: "하준 작가가 표절 의혹 자료를 다음 방송에서 공개하겠다고 저한테 말했어요." },
  ],
};

// ---------------------------------------------------------------------------
// 유형 B: 사전 검증 롤링 DB — 9선(300선 확장 가능 스키마의 시드셋,
// 2026-09-02 세션 확정 — 소규모 시드 + 확장 가능 스키마)
// ---------------------------------------------------------------------------

function b(scenario: Scenario): Scenario {
  return scenario;
}

const SCENARIO_B_LIST: Scenario[] = [
  b({
    id: "b-01-greenhouse",
    type: "B",
    difficultySupport: ["LV1"],
    title: "온실 속 유언장",
    synopsis: "대저택 온실에서 화훼 재배 사업가가 급사했다. 사망 직전 새 유언장에 서명했다는 소문이 돈다. 유족 세 명 중 누가, 어떻게 진실을 숨기고 있을까?",
    truth: "둘째 아들 태오가 온실 관수 시스템에 독성 화학비료를 섞어 넣어 아버지가 매일 마시던 허브차 재료에 스며들게 했다. 유언장을 자신에게 유리하게 다시 쓰게 만든 뒤 범행을 저질렀다.",
    answerRequiredKeywordGroups: [
      { label: "범인", keywords: ["태오"] },
      { label: "트릭", keywords: ["비료", "관수", "허브차"] },
      { label: "동기", keywords: ["유언장", "상속"] },
    ],
    questionBank: [
      { id: "b01-q1", sampleQuestion: "범인은 태오입니까?", keywords: ["태오"], verdict: "green", importance: 3 },
      { id: "b01-q2", sampleQuestion: "독은 음식에 직접 넣은 것입니까?", keywords: ["음식", "직접"], verdict: "yellow", yellowDetail: "독이 들어간 경로는 맞지만 '음식에 직접'이 아니라 '관수 시스템 → 허브차 재료'를 거친 간접 경로입니다.", importance: 2 },
      { id: "b01-q3", sampleQuestion: "관수 시스템에 화학비료를 섞었습니까?", keywords: ["관수", "비료"], verdict: "green", importance: 3 },
      { id: "b01-q4", sampleQuestion: "동기는 유언장 상속 문제입니까?", keywords: ["유언장", "상속"], verdict: "green", importance: 3 },
      { id: "b01-q5", sampleQuestion: "첫째 딸 유리가 범인입니까?", keywords: ["유리"], verdict: "red", importance: 2 },
      { id: "b01-q6", sampleQuestion: "피해자는 심장 지병으로 자연사했습니까?", keywords: ["지병", "자연사"], verdict: "red", importance: 1 },
      { id: "b01-q7", sampleQuestion: "허브차가 매개체입니까?", keywords: ["허브차"], verdict: "green", importance: 2 },
      { id: "b01-q8", sampleQuestion: "유언장은 사망 당일 새로 작성됐습니까?", keywords: ["당일", "새로 작성"], verdict: "yellow", yellowDetail: "유언장이 바뀐 건 맞지만 '당일'이 아니라 사망 며칠 전에 이미 다시 작성됐습니다.", importance: 1 },
    ],
    timeline: [
      { time: "D-3", description: "태오가 아버지를 설득해 유언장을 새로 작성하게 함." },
      { time: "D-1 저녁", description: "태오가 온실 관수 시스템 배관에 화학비료 원액을 주입." },
      { time: "당일 오전", description: "피해자가 평소대로 온실에서 허브차 재료를 수확." },
      { time: "당일 낮", description: "허브차를 마신 뒤 온실에서 쓰러진 채 발견." },
    ],
    evidence: [
      { id: "b01-e1", name: "관수 배관 잔여물", description: "배관 내부에서 화학비료 성분 검출." },
      { id: "b01-e2", name: "새 유언장 사본", description: "사망 3일 전 작성. 태오 몫이 크게 늘어남." },
      { id: "b01-e3", name: "허브차 찻잎 시료", description: "독성 성분이 미량 검출됨." },
    ],
    messages: [
      { id: "b01-m1", from: "태오", to: "변호사", time: "D-3", content: "유언장 변경 절차 다시 확인 부탁드립니다." },
      { id: "b01-m2", from: "유리", to: "태오", time: "D-2", content: "아버지 요즘 왜 이렇게 갑자기 마음이 바뀌셨을까?" },
    ],
    testimonies: [
      { id: "b01-t1", witness: "태오", statement: "저는 관수 시스템은 손댄 적도 없어요.", contradictsWith: ["b01-t2"] },
      { id: "b01-t2", witness: "정원사 만수", statement: "태오 도련님이 D-1 저녁에 관수실 열쇠를 빌려가셨어요.", contradictsWith: ["b01-t1"] },
    ],
  }),
  b({
    id: "b-02-gallery",
    type: "B",
    difficultySupport: ["LV1"],
    title: "갤러리 폐관 후 사라진 그림",
    synopsis: "야간 개장 행사 직후, 전시된 원화 한 점이 감쪽같이 사라졌다. CCTV에는 아무도 전시실에 들어가지 않은 것으로 보인다. 큐레이터, 경비원, 초대 작가 중 진범은?",
    truth: "큐레이터 은채가 행사 전 미리 진품을 정교한 복제품으로 바꿔치기해두고, 폐관 후 진품을 개인 창고로 옮겼다. CCTV에 이상이 없어 보인 건 바꿔치기가 행사 시작 전에 이미 끝나 있었기 때문이다. 동기는 거액의 사설 컬렉터 거래였다.",
    answerRequiredKeywordGroups: [
      { label: "범인", keywords: ["은채"] },
      { label: "트릭", keywords: ["복제품", "바꿔치기"] },
      { label: "동기", keywords: ["컬렉터", "거래", "판매"] },
    ],
    questionBank: [
      { id: "b02-q1", sampleQuestion: "범인은 큐레이터 은채입니까?", keywords: ["은채", "큐레이터"], verdict: "green", importance: 3 },
      { id: "b02-q2", sampleQuestion: "그림은 폐관 후 몰래 반출됐습니까?", keywords: ["반출", "폐관 후"], verdict: "yellow", yellowDetail: "진품이 창고로 옮겨진 시점은 맞지만, 핵심 트릭은 '반출'이 아니라 그 이전의 '복제품 바꿔치기'입니다.", importance: 2 },
      { id: "b02-q3", sampleQuestion: "행사 전에 이미 복제품으로 바뀌어 있었습니까?", keywords: ["복제품", "바꿔치기", "행사 전"], verdict: "green", importance: 3 },
      { id: "b02-q4", sampleQuestion: "경비원이 공범입니까?", keywords: ["경비원", "공범"], verdict: "red", importance: 2 },
      { id: "b02-q5", sampleQuestion: "동기는 사설 컬렉터에게 판매하기 위해서입니까?", keywords: ["컬렉터", "판매", "거래"], verdict: "green", importance: 3 },
      { id: "b02-q6", sampleQuestion: "CCTV가 고장 났습니까?", keywords: ["고장", "CCTV 고장"], verdict: "red", importance: 1 },
      { id: "b02-q7", sampleQuestion: "초대 작가가 자기 작품을 되가져간 것입니까?", keywords: ["초대 작가", "되가져"], verdict: "red", importance: 1 },
    ],
    timeline: [
      { time: "행사 D-1", description: "은채가 진품을 반출해 정교한 복제품으로 교체." },
      { time: "행사 당일 18:00", description: "야간 개장, 관람객 다수 입장." },
      { time: "22:00", description: "폐관, 은채가 창고에서 진품을 개인 차량으로 옮김." },
      { time: "익일", description: "정기 점검 중 복제품이 발견됨." },
    ],
    evidence: [
      { id: "b02-e1", name: "복제품 물감 분석 보고서", description: "최신 안료 성분 검출 — 원화보다 훨씬 최근에 제작됨." },
      { id: "b02-e2", name: "개인 창고 열쇠", description: "은채 명의로 등록된 별도 창고." },
      { id: "b02-e3", name: "컬렉터와의 거래 메모", description: "고가 매입 의사를 밝힌 익명 쪽지." },
    ],
    messages: [
      { id: "b02-m1", from: "은채", to: "익명 구매자", time: "행사 D-2", content: "물건 준비되면 바로 연락드릴게요." },
      { id: "b02-m2", from: "경비원", to: "은채", time: "행사 당일 21:50", content: "폐관 순찰 돌겠습니다, 큐레이터님." },
    ],
    testimonies: [
      { id: "b02-t1", witness: "은채", statement: "저는 그날 창고 근처엔 가지도 않았어요.", contradictsWith: ["b02-t2"] },
      { id: "b02-t2", witness: "야간 경비 반장", statement: "22시경 큐레이터님이 개인 차량을 몰고 후문으로 나가는 걸 봤습니다.", contradictsWith: ["b02-t1"] },
    ],
  }),
  b({
    id: "b-03-ski-resort",
    type: "B",
    difficultySupport: ["LV1"],
    title: "스키 리조트의 마지막 곤돌라",
    synopsis: "폐장 직전 마지막 곤돌라를 탄 네 명 중 한 명이 하산 도중 실종됐다. 곤돌라는 도중에 멈춘 적이 없다고 기록돼 있는데, 어떻게 사라진 걸까?",
    truth: "동승자 재민이 곤돌라 정차 구간(정비 점검용 임시 정지)에서 피해자를 강제로 내리게 한 뒤, 자신은 다음 칸으로 옮겨 타 하산했다. 기록상 '정차 없음'은 정비 로그 조작 때문이었다. 동기는 사업 동업 자금 횡령을 은폐하기 위함이었다.",
    answerRequiredKeywordGroups: [
      { label: "범인", keywords: ["재민"] },
      { label: "트릭", keywords: ["정비", "정차", "칸 이동", "옮겨"] },
      { label: "동기", keywords: ["횡령", "동업", "은폐"] },
    ],
    questionBank: [
      { id: "b03-q1", sampleQuestion: "범인은 재민입니까?", keywords: ["재민"], verdict: "green", importance: 3 },
      { id: "b03-q2", sampleQuestion: "곤돌라가 실제로는 정차한 적이 있습니까?", keywords: ["정차", "멈춘"], verdict: "green", importance: 3 },
      { id: "b03-q3", sampleQuestion: "정비 로그가 조작됐습니까?", keywords: ["로그", "조작", "정비"], verdict: "green", importance: 2 },
      { id: "b03-q4", sampleQuestion: "피해자가 스스로 뛰어내린 것입니까?", keywords: ["뛰어내", "자진"], verdict: "red", importance: 1 },
      { id: "b03-q5", sampleQuestion: "동기는 사업 자금 횡령을 숨기기 위해서입니까?", keywords: ["횡령", "은폐"], verdict: "green", importance: 3 },
      { id: "b03-q6", sampleQuestion: "재민이 다음 칸으로 옮겨 탔습니까?", keywords: ["옮겨", "칸 이동", "다음 칸"], verdict: "green", importance: 2 },
      { id: "b03-q7", sampleQuestion: "리조트 직원이 공범입니까?", keywords: ["직원", "공범"], verdict: "yellow", yellowDetail: "직원이 직접 가담한 건 아니지만, 정비 로그 조작에 이용된 관리자 계정은 직원 것이었습니다.", importance: 2 },
    ],
    timeline: [
      { time: "17:40", description: "네 명이 마지막 곤돌라 탑승." },
      { time: "17:52", description: "정비 점검 구간에서 곤돌라 일시 정지(로그엔 미기록)." },
      { time: "17:53", description: "재민이 피해자를 강제로 하차시킴." },
      { time: "17:55", description: "재민, 다음 칸으로 옮겨 타 하산 계속." },
      { time: "18:10", description: "종점 도착 — 일행 중 피해자만 없음이 확인됨." },
    ],
    evidence: [
      { id: "b03-e1", name: "정비 시스템 원본 로그", description: "17:52 정차 기록이 삭제된 흔적이 남아 있음." },
      { id: "b03-e2", name: "동업 계약서", description: "재민과 피해자 공동 명의 사업 계좌 내역." },
      { id: "b03-e3", name: "곤돌라 손잡이 지문", description: "정차 구간 칸에서 두 사람 분 지문 발견." },
    ],
    messages: [
      { id: "b03-m1", from: "재민", to: "회계 담당", time: "당일 오전", content: "그 자금 건 오늘 안에 확실히 정리해야 해요." },
      { id: "b03-m2", from: "피해자", to: "재민", time: "당일 오후", content: "장부 좀 같이 다시 봐야 할 것 같은데?" },
    ],
    testimonies: [
      { id: "b03-t1", witness: "재민", statement: "저는 종점까지 같은 칸에 쭉 타고 있었어요.", contradictsWith: ["b03-t2"] },
      { id: "b03-t2", witness: "동승객 하나", statement: "정차했을 때 재민 씨가 옆 칸으로 넘어가는 걸 봤어요.", contradictsWith: ["b03-t1"] },
    ],
  }),
  b({
    id: "b-04-bakery",
    type: "B",
    difficultySupport: ["LV1"],
    title: "새벽 빵집의 레시피 도난",
    synopsis: "3대째 이어온 빵집의 비밀 레시피 노트가 새벽 사이 사라졌다. 문은 잠겨 있었고 알람도 울리지 않았다. 안에서 벌어진 일이었을까?",
    truth:
      "막내 직원 하나가 폐점 전 미리 알람 시스템의 야간 예외 시간을 자신의 근무시간대로 설정해두고, 폐점 후 몰래 재입장해 레시피 노트를 촬영한 뒤 원본은 제자리에 돌려놨다(사라진 것처럼 보인 건 노트 위치를 다른 서랍으로 옮겨뒀기 때문). 동기는 경쟁 프랜차이즈에 레시피를 팔아넘기기 위해서였다.",
    answerRequiredKeywordGroups: [
      { label: "범인", keywords: ["하나"] },
      { label: "트릭", keywords: ["알람", "예외 시간", "옮겨", "촬영"] },
      { label: "동기", keywords: ["프랜차이즈", "매도", "판매"] },
    ],
    questionBank: [
      { id: "b04-q1", sampleQuestion: "범인은 막내 직원 하나입니까?", keywords: ["하나"], verdict: "green", importance: 3 },
      { id: "b04-q2", sampleQuestion: "노트는 실제로 가게 밖으로 나간 적이 없습니까?", keywords: ["가게 밖", "나간 적 없"], verdict: "green", importance: 3 },
      { id: "b04-q3", sampleQuestion: "알람 시스템에 예외 시간이 설정돼 있었습니까?", keywords: ["알람", "예외"], verdict: "green", importance: 2 },
      { id: "b04-q4", sampleQuestion: "노트를 사진으로 찍어 유출했습니까?", keywords: ["사진", "촬영"], verdict: "green", importance: 2 },
      { id: "b04-q5", sampleQuestion: "동기는 경쟁 프랜차이즈에 팔기 위해서입니까?", keywords: ["프랜차이즈", "판매", "매도"], verdict: "green", importance: 3 },
      { id: "b04-q6", sampleQuestion: "사장님이 자작극을 벌인 것입니까?", keywords: ["사장", "자작극"], verdict: "red", importance: 1 },
      { id: "b04-q7", sampleQuestion: "문이 물리적으로 강제 개방됐습니까?", keywords: ["강제 개방", "부수고"], verdict: "red", importance: 1 },
    ],
    timeline: [
      { time: "폐점 D-1", description: "하나가 알람 시스템 관리자 화면에서 예외 시간을 자신의 근무시간대로 설정." },
      { time: "폐점 당일 22:00", description: "정상 폐점, 알람 작동(예외 시간 전)." },
      { time: "23:30", description: "하나가 예외 시간대에 맞춰 재입장." },
      { time: "23:40", description: "레시피 노트를 촬영 후 다른 서랍으로 옮겨 보관." },
      { time: "익일 오전", description: "사장이 제자리에서 노트를 찾지 못해 '도난'으로 신고." },
    ],
    evidence: [
      { id: "b04-e1", name: "알람 시스템 설정 로그", description: "23:00~00:00 예외 시간대가 하나의 근무 코드로 등록됨." },
      { id: "b04-e2", name: "옮겨진 서랍 속 레시피 노트", description: "결국 다른 서랍에서 발견됨 — 진짜 '도난'은 없었음." },
      { id: "b04-e3", name: "하나의 휴대폰 사진첩(복구본)", description: "레시피 페이지를 촬영한 사진 다수." },
    ],
    messages: [
      { id: "b04-m1", from: "하나", to: "경쟁 프랜차이즈 담당자", time: "폐점 D-2", content: "확실한 자료 있으면 얼마까지 쳐주실 수 있어요?" },
      { id: "b04-m2", from: "경쟁 프랜차이즈 담당자", to: "하나", time: "폐점 D-1", content: "레시피 원문 확인되면 바로 입금해드릴게요." },
    ],
    testimonies: [
      { id: "b04-t1", witness: "하나", statement: "저는 그날 알람 설정 화면은 만진 적도 없어요.", contradictsWith: ["b04-t2"] },
      { id: "b04-t2", witness: "야간 배송 기사", statement: "23시 반쯤 가게에 불이 잠깐 켜지는 걸 봤어요, 그때 하나 씨 오토바이가 있었고요.", contradictsWith: ["b04-t1"] },
    ],
  }),
  b({
    id: "b-05-orchestra",
    type: "B",
    difficultySupport: ["LV1"],
    title: "오케스트라 수석의 침묵",
    synopsis: "정기 연주회 직전, 바이올린 수석이 무대 뒤에서 실신했다. 원인 불명. 지휘자, 매니저, 동료 단원 중 누가 무언가를 감추고 있을까?",
    truth: "동료 단원 세영이 수석 자리를 빼앗기 위해 대기실 공용 텀블러에 극심한 어지럼증을 유발하는 약초 성분을 섞었다. 실신은 독살이 아니라 일시적 부작용을 노린 것이었고, 목표는 살해가 아니라 그날 무대에 서지 못하게 하는 것이었다. 동기는 오디션 자리를 대신 차지하기 위해서였다.",
    answerRequiredKeywordGroups: [
      { label: "범인", keywords: ["세영"] },
      { label: "트릭", keywords: ["텀블러", "약초", "어지럼증"] },
      { label: "동기", keywords: ["수석", "오디션", "자리"] },
    ],
    questionBank: [
      { id: "b05-q1", sampleQuestion: "범인은 동료 단원 세영입니까?", keywords: ["세영"], verdict: "green", importance: 3 },
      { id: "b05-q2", sampleQuestion: "독은 치명적인 것이었습니까?", keywords: ["치명적", "죽", "사망"], verdict: "yellow", yellowDetail: "성분을 탄 건 맞지만 치명적인 독이 아니라 '일시적 어지럼증'만 유발하는 것이었습니다.", importance: 2 },
      { id: "b05-q3", sampleQuestion: "공용 텀블러에 무언가를 탔습니까?", keywords: ["텀블러"], verdict: "green", importance: 3 },
      { id: "b05-q4", sampleQuestion: "목적은 살해였습니까?", keywords: ["살해", "죽이려"], verdict: "red", importance: 2 },
      { id: "b05-q5", sampleQuestion: "동기는 수석 자리(오디션)를 차지하기 위해서입니까?", keywords: ["수석", "오디션", "자리"], verdict: "green", importance: 3 },
      { id: "b05-q6", sampleQuestion: "지휘자가 관련이 있습니까?", keywords: ["지휘자"], verdict: "red", importance: 1 },
      { id: "b05-q7", sampleQuestion: "매니저가 실수로 잘못된 약을 줬습니까?", keywords: ["매니저", "실수"], verdict: "red", importance: 1 },
    ],
    timeline: [
      { time: "공연 D-1", description: "세영이 오디션 공고를 확인, 수석 결원이 필요함을 인지." },
      { time: "공연 당일 17:00", description: "세영이 대기실 공용 텀블러에 약초 성분 투입." },
      { time: "18:30", description: "수석이 텀블러의 물을 마심." },
      { time: "18:50", description: "무대 직전 어지럼증으로 실신." },
      { time: "19:00", description: "세영이 대타로 수석 자리에서 연주." },
    ],
    evidence: [
      { id: "b05-e1", name: "공용 텀블러 잔여물", description: "어지럼증 유발 약초 성분 검출." },
      { id: "b05-e2", name: "오디션 공고문", description: "수석 결원 시 즉시 오디션 진행 규정." },
      { id: "b05-e3", name: "세영의 개인 사물함", description: "동일 약초 소분 봉지 발견." },
    ],
    messages: [
      { id: "b05-m1", from: "세영", to: "친구", time: "공연 D-1", content: "이번엔 진짜 기회일 수도 있어." },
      { id: "b05-m2", from: "매니저", to: "전 단원", time: "공연 당일", content: "공용 텀블러는 항상 리허설실에 비치돼 있어요." },
    ],
    testimonies: [
      { id: "b05-t1", witness: "세영", statement: "저는 그날 대기실 텀블러 쪽엔 가지도 않았어요.", contradictsWith: ["b05-t2"] },
      { id: "b05-t2", witness: "신입 단원 리나", statement: "세영 선배가 리허설 직후 텀블러 뚜껑을 만지작거리는 걸 봤어요.", contradictsWith: ["b05-t1"] },
    ],
  }),
  b({
    id: "b-06-esports",
    type: "B",
    difficultySupport: ["LV1"],
    title: "e스포츠 결승전의 접속 끊김",
    synopsis: "결승전 3세트, 우승 후보 선수의 게임이 갑자기 렉과 함께 튕겼다. 팀은 '해킹'을 주장하지만 상대팀은 '자작극'이라 반박한다. 진실은?",
    truth: "같은 팀 코치 두현이 상대팀에게 거액의 승부조작 대가를 받고, 선수 PC에 원격으로 접속해 네트워크 트래픽을 인위적으로 폭주시켜 튕기게 만들었다. '해킹당했다'는 주장은 사실이지만, 외부 해커가 아니라 내부자(코치) 소행이었다.",
    answerRequiredKeywordGroups: [
      { label: "범인", keywords: ["두현", "코치"] },
      { label: "트릭", keywords: ["원격", "트래픽", "네트워크"] },
      { label: "동기", keywords: ["승부조작", "대가", "돈"] },
    ],
    questionBank: [
      { id: "b06-q1", sampleQuestion: "범인은 팀 코치 두현입니까?", keywords: ["두현", "코치"], verdict: "green", importance: 3 },
      { id: "b06-q2", sampleQuestion: "정말 해킹이 있긴 있었습니까?", keywords: ["해킹", "있었"], verdict: "yellow", yellowDetail: "네트워크 공격이 있었다는 사실 자체는 맞지만, 외부 해커가 아니라 내부자(코치) 소행이라는 점이 다릅니다.", importance: 2 },
      { id: "b06-q3", sampleQuestion: "외부 해커의 소행입니까?", keywords: ["외부 해커", "외부인"], verdict: "red", importance: 2 },
      { id: "b06-q4", sampleQuestion: "네트워크 트래픽을 인위적으로 폭주시켰습니까?", keywords: ["트래픽", "폭주", "네트워크"], verdict: "green", importance: 3 },
      { id: "b06-q5", sampleQuestion: "동기는 상대팀에게 돈을 받은 승부조작입니까?", keywords: ["승부조작", "대가", "돈"], verdict: "green", importance: 3 },
      { id: "b06-q6", sampleQuestion: "선수 본인이 일부러 접속을 끊었습니까?", keywords: ["선수 본인", "일부러"], verdict: "red", importance: 1 },
      { id: "b06-q7", sampleQuestion: "원격 접속 프로그램이 사용됐습니까?", keywords: ["원격 접속", "원격"], verdict: "green", importance: 2 },
    ],
    timeline: [
      { time: "결승 D-2", description: "두현이 상대팀 관계자로부터 은밀히 접촉받음." },
      { time: "결승 D-1", description: "선수 PC에 원격 관리 프로그램을 몰래 설치." },
      { time: "결승 3세트 중", description: "두현이 원격으로 트래픽 폭주 스크립트 실행." },
      { time: "직후", description: "선수 게임 클라이언트 강제 종료(튕김)." },
    ],
    evidence: [
      { id: "b06-e1", name: "선수 PC 원격 접속 로그", description: "결승 도중 낯선 IP의 원격 접속 기록." },
      { id: "b06-e2", name: "두현의 별도 계좌", description: "결승 D-3에 거액 입금 내역." },
      { id: "b06-e3", name: "네트워크 트래픽 분석 리포트", description: "3세트 중 비정상적 트래픽 폭주 패턴 확인." },
    ],
    messages: [
      { id: "b06-m1", from: "두현", to: "상대팀 관계자", time: "결승 D-2", content: "그 일 확실히 처리하면 얘기했던 금액 맞는 거죠?" },
      { id: "b06-m2", from: "상대팀 관계자", to: "두현", time: "결승 D-1", content: "일 끝나는 대로 바로 입금할게요." },
    ],
    testimonies: [
      { id: "b06-t1", witness: "두현", statement: "저는 결승 내내 벤치에만 있었어요, PC는 손도 안 댔습니다.", contradictsWith: ["b06-t2"] },
      { id: "b06-t2", witness: "팀 매니저", statement: "3세트 직전에 두현 코치가 노트북으로 뭔가 계속 만지고 있던 게 기억나요.", contradictsWith: ["b06-t1"] },
    ],
  }),
  b({
    id: "b-07-camping",
    type: "B",
    difficultySupport: ["LV1"],
    title: "캠핑장 밤의 정전",
    synopsis: "단체 캠핑 중 한밤중 전력이 끊기고, 그 사이 귀중품 보관함이 열렸다. 정전은 낙뢰 때문이라는데, 정말 그럴까?",
    truth: "참가자 중 한 명인 지훈이 미리 발전기 연료 밸브를 조작해 예정된 시간에 정전이 일어나도록 만든 뒤, 어둠 속에서 보관함을 열어 자신의 빚 문서(공동 투자 손실 증거)를 몰래 빼돌렸다. 낙뢰는 실제로 있었지만 정전의 직접 원인은 아니었다.",
    answerRequiredKeywordGroups: [
      { label: "범인", keywords: ["지훈"] },
      { label: "트릭", keywords: ["발전기", "연료", "밸브"] },
      { label: "동기", keywords: ["투자", "손실", "문서"] },
    ],
    questionBank: [
      { id: "b07-q1", sampleQuestion: "범인은 지훈입니까?", keywords: ["지훈"], verdict: "green", importance: 3 },
      { id: "b07-q2", sampleQuestion: "정전은 낙뢰 때문입니까?", keywords: ["낙뢰"], verdict: "yellow", yellowDetail: "낙뢰가 그날 실제로 있었던 건 맞지만, 정전의 직접 원인은 아니고 지훈이 조작한 발전기 연료 밸브 때문이었습니다.", importance: 2 },
      { id: "b07-q3", sampleQuestion: "발전기 연료 밸브를 미리 조작했습니까?", keywords: ["발전기", "연료", "밸브"], verdict: "green", importance: 3 },
      { id: "b07-q4", sampleQuestion: "귀중품을 훔치려던 것입니까?", keywords: ["귀중품", "훔치"], verdict: "yellow", yellowDetail: "보관함을 연 건 맞지만 목적은 금품 절도가 아니라 자신에게 불리한 '문서'를 빼돌리는 것이었습니다.", importance: 2 },
      { id: "b07-q5", sampleQuestion: "동기는 투자 손실 증거 문서를 없애기 위해서입니까?", keywords: ["투자", "손실", "문서"], verdict: "green", importance: 3 },
      { id: "b07-q6", sampleQuestion: "캠핑장 관리인이 범인입니까?", keywords: ["관리인"], verdict: "red", importance: 1 },
      { id: "b07-q7", sampleQuestion: "정전은 완전한 우연입니까?", keywords: ["우연", "그냥 사고"], verdict: "red", importance: 1 },
    ],
    timeline: [
      { time: "캠핑 D-1", description: "지훈이 공동 투자 손실 사실을 문서로 은닉해야 함을 인지." },
      { time: "캠핑 당일 저녁", description: "지훈이 발전기 연료 밸브를 절반만 열어 예정된 시간에 꺼지도록 조작." },
      { time: "22:30", description: "실제 낙뢰 발생(우연히 같은 시간대)." },
      { time: "22:32", description: "발전기 정지, 야영지 전체 정전." },
      { time: "22:35", description: "지훈이 어둠 속에서 보관함을 열어 문서를 회수." },
    ],
    evidence: [
      { id: "b07-e1", name: "발전기 연료 밸브", description: "절반만 열려 있던 상태로 발견 — 고장이 아니라 인위적 조작." },
      { id: "b07-e2", name: "보관함 지문", description: "지훈의 지문이 보관함 손잡이에서 검출." },
      { id: "b07-e3", name: "투자 손실 문서", description: "지훈의 배낭에서 발견된 공동 투자 손실 증거." },
    ],
    messages: [
      { id: "b07-m1", from: "지훈", to: "동업자", time: "캠핑 D-2", content: "그 서류, 캠핑 가서 확실히 처리할게." },
      { id: "b07-m2", from: "동업자", to: "지훈", time: "캠핑 D-1", content: "다들 알기 전에 빨리 정리해." },
    ],
    testimonies: [
      { id: "b07-t1", witness: "지훈", statement: "저는 정전 내내 텐트 안에 있었어요.", contradictsWith: ["b07-t2"] },
      { id: "b07-t2", witness: "동행자 세미", statement: "정전 직후에 지훈 씨가 손전등 들고 보관함 쪽으로 걸어가는 걸 봤어요.", contradictsWith: ["b07-t1"] },
    ],
  }),
  b({
    id: "b-08-webnovel",
    type: "B",
    difficultySupport: ["LV1"],
    title: "웹소설 연재 중단 사건",
    synopsis: "인기 웹소설 작가의 계정이 해킹당해 마지막 화가 삭제됐다는 신고가 접수됐다. 그런데 삭제된 원고는 사실 다른 곳에 이미 저장돼 있었다.",
    truth: "작가의 매니저 유진이 다음 시즌 계약 조건을 유리하게 만들기 위해, 스스로 작가 계정에 접속해 마지막 화를 비공개로 전환한 뒤 '해킹당했다'고 신고했다. 원고는 삭제되지 않고 유진의 개인 클라우드에 백업돼 있었다. 동기는 플랫폼 측으로부터 동정 여론과 재계약 우위를 이끌어내기 위함이었다.",
    answerRequiredKeywordGroups: [
      { label: "범인", keywords: ["유진"] },
      { label: "트릭", keywords: ["비공개", "자작", "백업"] },
      { label: "동기", keywords: ["재계약", "여론", "조건"] },
    ],
    questionBank: [
      { id: "b08-q1", sampleQuestion: "범인은 매니저 유진입니까?", keywords: ["유진"], verdict: "green", importance: 3 },
      { id: "b08-q2", sampleQuestion: "정말 외부 해킹이 있었습니까?", keywords: ["외부 해킹", "진짜 해킹"], verdict: "red", importance: 2 },
      { id: "b08-q3", sampleQuestion: "원고는 실제로 삭제됐습니까?", keywords: ["삭제됐", "완전히 사라"], verdict: "yellow", yellowDetail: "독자들 눈에는 사라진 것처럼 보였지만 실제로는 삭제가 아니라 '비공개 전환'이었고, 원본은 그대로 백업돼 있었습니다.", importance: 2 },
      { id: "b08-q4", sampleQuestion: "원고가 다른 곳에 백업돼 있었습니까?", keywords: ["백업"], verdict: "green", importance: 3 },
      { id: "b08-q5", sampleQuestion: "동기는 재계약 협상에서 유리한 여론을 만들기 위해서입니까?", keywords: ["재계약", "여론"], verdict: "green", importance: 3 },
      { id: "b08-q6", sampleQuestion: "작가 본인이 스스로 벌인 일입니까?", keywords: ["작가 본인", "작가가 스스로"], verdict: "red", importance: 1 },
      { id: "b08-q7", sampleQuestion: "플랫폼 직원이 관련돼 있습니까?", keywords: ["플랫폼 직원"], verdict: "red", importance: 1 },
    ],
    timeline: [
      { time: "사건 D-3", description: "유진이 재계약 조건 협상에서 난항을 겪음." },
      { time: "사건 당일 새벽", description: "유진이 작가 계정으로 로그인, 원고를 개인 클라우드에 백업." },
      { time: "직후", description: "마지막 화를 비공개로 전환." },
      { time: "오전", description: "유진이 '해킹당했다'며 플랫폼에 신고." },
    ],
    evidence: [
      { id: "b08-e1", name: "계정 접속 로그", description: "삭제(비공개 전환) 시각의 접속 IP가 유진의 자택과 일치." },
      { id: "b08-e2", name: "유진의 개인 클라우드", description: "삭제됐다던 마지막 화 원고 전문이 그대로 보관돼 있음." },
      { id: "b08-e3", name: "재계약 협상 메모", description: "유진이 작성한 '동정 여론 활용' 메모." },
    ],
    messages: [
      { id: "b08-m1", from: "유진", to: "플랫폼 담당자", time: "사건 당일 오전", content: "작가님 계정이 해킹당한 것 같아요, 급히 확인 부탁드립니다." },
      { id: "b08-m2", from: "유진", to: "지인", time: "사건 D-2", content: "이번 기회에 계약 조건 다시 얘기해봐야겠어." },
    ],
    testimonies: [
      { id: "b08-t1", witness: "유진", statement: "저도 아침에 알림 보고 놀라서 바로 신고한 거예요.", contradictsWith: ["b08-t2"] },
      { id: "b08-t2", witness: "플랫폼 보안팀", statement: "접속 로그상 새벽 접속 IP가 매니저님 자택 IP와 정확히 일치했습니다.", contradictsWith: ["b08-t1"] },
    ],
  }),
  b({
    id: "b-09-marathon",
    type: "B",
    difficultySupport: ["LV1"],
    title: "마라톤 대회 1위의 비밀",
    synopsis: "아마추어 마라톤 대회에서 무명 선수가 우승했다. 그런데 중간 체크포인트 기록 하나가 통째로 비어 있다.",
    truth: "우승자 도경이 중간 구간에서 미리 대기시켜둔 쌍둥이 형이 대신 뛰게 하고, 자신은 지름길로 이동해 마지막 구간부터 다시 합류했다. 체크포인트 기록이 비어 있던 건 그 구간을 실제로는 형이 뛰었고, 바뀐 시점에 태그가 잠깐 인식되지 않았기 때문이다. 동기는 우승 상금과 스폰서 계약이었다.",
    answerRequiredKeywordGroups: [
      { label: "범인", keywords: ["도경"] },
      { label: "트릭", keywords: ["쌍둥이", "형", "교대"] },
      { label: "동기", keywords: ["상금", "스폰서"] },
    ],
    questionBank: [
      { id: "b09-q1", sampleQuestion: "우승자 도경이 부정을 저질렀습니까?", keywords: ["도경"], verdict: "green", importance: 3 },
      { id: "b09-q2", sampleQuestion: "약물을 사용했습니까?", keywords: ["약물", "도핑"], verdict: "red", importance: 2 },
      { id: "b09-q3", sampleQuestion: "쌍둥이 형이 중간 구간을 대신 뛰었습니까?", keywords: ["쌍둥이", "형"], verdict: "green", importance: 3 },
      { id: "b09-q4", sampleQuestion: "지름길로 이동했습니까?", keywords: ["지름길"], verdict: "yellow", yellowDetail: "지름길 자체가 핵심은 아니고, 그 구간에서 '형과 교대'했다는 사실이 핵심 트릭입니다.", importance: 2 },
      { id: "b09-q5", sampleQuestion: "동기는 우승 상금과 스폰서 계약입니까?", keywords: ["상금", "스폰서"], verdict: "green", importance: 3 },
      { id: "b09-q6", sampleQuestion: "체크포인트 기기가 단순 고장난 것입니까?", keywords: ["기기 고장", "단순 고장"], verdict: "yellow", yellowDetail: "그 순간 태그가 인식되지 않은 건 맞지만, 원인은 '기기 고장'이 아니라 '선수 교대'가 일어난 순간이었기 때문입니다.", importance: 2 },
      { id: "b09-q7", sampleQuestion: "대회 관계자가 공모했습니까?", keywords: ["대회 관계자", "공모"], verdict: "red", importance: 1 },
    ],
    timeline: [
      { time: "대회 D-7", description: "도경과 쌍둥이 형이 교대 계획을 세움." },
      { time: "대회 당일 스타트", description: "도경이 정상적으로 출발." },
      { time: "중간 체크포인트 부근", description: "형이 대기하다 도경과 교대, 도경은 지름길로 이동." },
      { time: "이후 구간", description: "형이 대신 완주 페이스 유지." },
      { time: "마지막 구간", description: "도경이 다시 합류해 결승선 통과." },
    ],
    evidence: [
      { id: "b09-e1", name: "체크포인트 태그 로그", description: "중간 구간에서 태그 인식이 약 12분간 비어 있음." },
      { id: "b09-e2", name: "구간별 페이스 그래프", description: "중간 구간에서 페이스가 부자연스럽게 급변." },
      { id: "b09-e3", name: "형의 목격 제보 사진", description: "중간 구간 인근에서 도경과 닮은 인물이 대기하는 사진." },
    ],
    messages: [
      { id: "b09-m1", from: "도경", to: "형", time: "대회 D-2", content: "그 구간에서 딱 맞춰서 자리 잡고 있어줘." },
      { id: "b09-m2", from: "형", to: "도경", time: "대회 D-1", content: "알겠어, 시간 정확히 맞춰서 준비할게." },
    ],
    testimonies: [
      { id: "b09-t1", witness: "도경", statement: "저 혼자 처음부터 끝까지 다 뛴 거예요.", contradictsWith: ["b09-t2"] },
      { id: "b09-t2", witness: "구간 자원봉사자", statement: "중간에 도경 선수처럼 보이는 두 사람이 잠깐 같이 있는 걸 본 것 같아요.", contradictsWith: ["b09-t1"] },
    ],
  }),
];

// ---------------------------------------------------------------------------
// LV2/LV3 사진 증거 공용 라이브러리 (2026-09-03 세션 신설, 2026-09-05 세션 정밀화)
//
// 시나리오마다 새 사진을 일일이 촬영/생성할 수 없으므로(원작이 없는 가상의
// 사건), 무료 라이선스(CC0/CC-BY/CC-BY-SA/Public domain/Pexels License) 실사진을
// Wikimedia Commons·Pexels에서 카테고리별로 검색·다운로드해
// `public/images/hillOfTruth/evidence/`에 저장하고, 여러 시나리오가 같은
// "증거 유형" 사진을 공유해서 쓴다(출처는 그 폴더의 CREDITS.json 그대로). 각
// 증거 항목의 `name`/`description`은 전부 시나리오별로 새로 쓴 고유 텍스트다.
//
// ⚠️ 2026-09-05 세션 정밀화(요청서 "진실의 고개 사진 단서 전면 교체" 처리 세션,
// AskUserQuestion으로 전부 확정): 대다수 카테고리는 여전히 "이런 느낌의 증거"라는
// 분위기 담당이지만, 42편 중 실제 몸싸움·폭행이 있는 15편(c02/c04/c05/c06/c11/
// c14/c15/c17/c18/c19/c25/c26/c28/c29/c30)에 한해서는 방침을 뒤집어 시나리오
// truth에 실제로 등장하는 물증(부서진 소품 상자·파손된 기기 화면·타박상·깨진
// 화분·어질러진 사무실·깨진 전시실 유리)과 1:1로 정밀 매칭했다. 이 게임은
// 흉기·혈흔이 42편 전체에 단 한 건도 등장하지 않는 저작물이라(전부 "밀치기→
// 물건에 부딪힘" 수준), 요청서의 "핏자국/흉기 마커"는 사실에 없는 내용이라
// 적용하지 않기로 확정했다 — 대신 실제로 존재하는 몸싸움 흔적만 사진으로 보강.
// 15편 중 broken-crate(c02)/broken-laptop(c05)/bruise-arm(c06)/broken-pot(c18)/
// ransacked-office(c26)/broken-glass 재확인(c29) 6편만 실제로 딱 맞는 무료
// 사진을 찾았고, 나머지(화분 없는 소파·서가·선반·대기 스탠드 등)는 Wikimedia+
// Pexels+Pixabay를 모두 검색했지만 맞는 실사진이 없어 기존 분위기용 사진을
// 그대로 유지했다(HANDOFF.md 2026-09-05 항목 참고 — 억지로 안 맞는 사진을
// 끼워 넣지 않기로 함). 실존 인물 얼굴이 나오는 사진은 전부 제외했다(초상권/
// 오해 방지 — 이 원칙은 신규 사진에도 동일 적용).
// ---------------------------------------------------------------------------

const PHOTO_CREDITS: Record<string, { file: string; artist: string; license: string; source?: string }> = {
  "security-camera": { file: "security-camera.jpg", artist: "Tdorante10", license: "CC BY-SA 4.0" },
  corridor: { file: "corridor.jpg", artist: "JIP", license: "CC BY-SA 4.0" },
  receipt: { file: "receipt.jpg", artist: "Peter Merholz", license: "CC BY-SA 2.0" },
  handwriting: { file: "handwriting.jpg", artist: "Carl Fredrik von Schantz", license: "Public domain" },
  keys: { file: "keys.jpg", artist: "Mgmoscatello", license: "CC BY-SA 3.0" },
  "police-tape": { file: "police-tape.jpg", artist: "Tony Webster", license: "CC BY-SA 4.0" },
  documents: { file: "documents.jpg", artist: "Blogtrepreneur", license: "CC BY 2.0" },
  keypad: { file: "keypad.jpg", artist: "Ca.garcia.s", license: "CC BY-SA 4.0" },
  footprint: { file: "footprint.jpg", artist: "Chris Hunkeler", license: "CC BY-SA 2.0" },
  "car-night": { file: "car-night.jpg", artist: "W.carter", license: "CC BY-SA 4.0" },
  "computer-log": { file: "computer-log.jpg", artist: "Slashme", license: "CC0" },
  flashlight: { file: "flashlight.jpg", artist: "Franz van Duns", license: "CC BY-SA 4.0" },
  envelope: { file: "envelope.jpg", artist: "Steve Shook", license: "CC BY 2.0" },
  fingerprint: { file: "fingerprint.jpg", artist: "US Air Force", license: "Public domain" },
  "financial-doc": { file: "financial-doc.jpg", artist: "M/s. Kanshi Ram Dharam Pal", license: "Public domain" },
  watch: { file: "watch.jpg", artist: "Soulful sunshine", license: "CC BY-SA 4.0" },
  suitcase: { file: "suitcase.jpg", artist: "Sandrine Z", license: "CC BY-SA 4.0" },
  "broken-glass": { file: "broken-glass.png", artist: "OathOn", license: "CC BY-SA 4.0" },
  "ferris-wheel": { file: "ferris-wheel.jpg", artist: "Basile Morin", license: "CC BY-SA 4.0" },
  carousel: { file: "carousel.jpg", artist: "Christine Matthews", license: "CC BY-SA 2.0" },
  // 2026-09-05 세션 신규 — 몸싸움 시나리오 정밀 매칭용(위 주석 참고).
  "broken-crate": { file: "broken-crate.jpg", artist: "Mdornseif", license: "CC BY-SA 4.0" },
  "broken-laptop": { file: "broken-laptop.jpg", artist: "Ashwin Kumar", license: "CC BY-SA 2.0" },
  "bruise-arm": { file: "bruise-arm.jpg", artist: "Jean van Kasteel", license: "CC BY-SA 4.0" },
  "broken-pot": { file: "broken-pot.jpg", artist: "KAMTBIC", license: "Pexels License", source: "Pexels" },
  "ransacked-office": { file: "ransacked-office.jpg", artist: "Martin Dalsgaard", license: "Pexels License", source: "Pexels" },
};

/** 증거 항목에 LV2+ 사진을 붙이는 헬퍼 — `category`는 위 `PHOTO_CREDITS` 키. */
function photo(category: keyof typeof PHOTO_CREDITS, alt: string): EvidencePhoto {
  const c = PHOTO_CREDITS[category];
  return { url: `/images/hillOfTruth/evidence/${c.file}`, alt, credit: `${c.artist} · ${c.license} (${c.source ?? "Wikimedia Commons"})` };
}

// ---------------------------------------------------------------------------
// 유형 C-확장: LV1~LV3 완전 저작 시나리오 32편 (2026-09-03 세션, 요청자 승인)
//
// `type` 필드는 여전히 "A"|"B"만 존재(룰북 §2 — 유형 C는 "실시간 웹 탐색 모드"라는
// 별개 개념이라 이 32편도 전부 `type: "B"`로 등록한다). 차이는 `difficultySupport`가
// LV1~LV3를 전부 포함하고, 사진 증거·LV3 위증 증언·잠금 단서까지 갖췄다는 점뿐이다.
// 위증 판정에 새 로직은 없다 — `testimoniesLv3`는 순수 표시용 텍스트고, 딜러는
// 여전히 questionBank(진실 기준)로만 신호등을 켠다(엔진 §5 계약 그대로).
// ---------------------------------------------------------------------------

const SCENARIO_C_LIST: Scenario[] = [
  b({
    id: "c-01-ferris-wheel",
    type: "B",
    difficultySupport: ["LV1", "LV2", "LV3"],
    title: "정지된 관람차",
    synopsis:
      "심야 놀이공원 폐장 직후, 마지막 탑승객 중 한 명이 대관람차 아래에서 의식을 잃은 채 발견됐다. 관람차는 운행 기록상 한 번도 멈춘 적이 없다고 되어 있는데, 어떻게 이런 일이 벌어졌을까?",
    truth:
      "정비팀장 도현이 심야 정비 점검 구간(짧은 일시 정지 구간)에서 피해자를 강제로 하차시킨 뒤, 정비 시스템 로그에서 그 구간의 정지 기록을 삭제해 '정차 없음'으로 조작했다. 동기는 피해자가 도현의 안전 점검 미비를 다음 주 감사에서 폭로하려던 것을 막기 위해서였다.",
    answerRequiredKeywordGroups: [
      { label: "범인", keywords: ["도현"] },
      { label: "트릭", keywords: ["정비", "로그삭제", "정차기록"] },
      { label: "동기", keywords: ["감사", "폭로", "안전점검"] },
    ],
    questionBank: [
      { id: "c01-q1", sampleQuestion: "범인은 정비팀장 도현입니까?", keywords: ["도현"], verdict: "green", importance: 3 },
      { id: "c01-q2", sampleQuestion: "관람차가 실제로 멈춘 적이 있습니까?", keywords: ["멈춘", "정차", "정지"], verdict: "green", importance: 3 },
      { id: "c01-q3", sampleQuestion: "정비 로그가 삭제됐습니까?", keywords: ["로그", "삭제", "조작"], verdict: "green", importance: 2 },
      { id: "c01-q4", sampleQuestion: "피해자가 스스로 뛰어내렸습니까?", keywords: ["뛰어내", "자진"], verdict: "red", importance: 1 },
      { id: "c01-q5", sampleQuestion: "동기는 감사에서 안전 점검 미비가 폭로되는 걸 막기 위해서입니까?", keywords: ["감사", "폭로", "안전점검"], verdict: "green", importance: 3 },
      { id: "c01-q6", sampleQuestion: "동승객이 공범입니까?", keywords: ["동승객", "공범"], verdict: "red", importance: 1 },
      { id: "c01-q7", sampleQuestion: "안전바가 고장났습니까?", keywords: ["안전바", "고장"], verdict: "yellow", yellowDetail: "안전바 자체가 고장난 게 아니라, 도현이 정비 구간에서 수동으로 열어 피해자를 하차시킨 것입니다.", importance: 2 },
      { id: "c01-q8", sampleQuestion: "매표소 직원이 그 시각 자리를 비웠습니까?", keywords: ["매표소", "자리비"], verdict: "red", importance: 1 },
    ],
    timeline: [
      { time: "23:10", description: "마지막 탑승 순서, 피해자 포함 4인 탑승." },
      { time: "23:24", description: "정비 점검 구간에서 관람차 일시 정지(로그엔 미기록)." },
      { time: "23:25", description: "도현이 정비 통로를 통해 접근, 피해자를 강제로 하차시킴." },
      { time: "23:26", description: "관람차 재가동, 나머지 탑승객은 그대로 하강." },
      { time: "23:40", description: "도현이 정비 시스템 로그에서 23:24 구간 기록을 삭제." },
      { time: "23:55", description: "피해자, 관람차 하부 정비 통로 인근에서 발견됨." },
    ],
    evidence: [
      { id: "c01-e1", name: "정비 시스템 원본 백업 로그", description: "23:24 정차 기록이 삭제된 흔적이 남은 서버 백업본.", photo: photo("computer-log", "정비 시스템 로그 화면") },
      { id: "c01-e2", name: "관람차 야간 전경 사진", description: "사건 당일 심야, 조명이 켜진 대관람차의 모습.", photo: photo("ferris-wheel", "심야 대관람차 전경") },
      { id: "c01-e3", name: "안전 감사 통지서", description: "다음 주로 예정된 놀이공원 안전 감사 공문." },
      { id: "c01-e4", name: "정비 통로 손전등", description: "도현의 사물함에서 발견된 손전등 — 정비 시간 외 사용 흔적.", photo: photo("flashlight", "정비 통로 손전등") },
      { id: "c01-e5", name: "피해자의 감사 제보 메모", description: "피해자가 감사관에게 전달하려던 안전 점검 미비 지적 메모." },
    ],
    messages: [
      { id: "c01-m1", from: "도현", to: "정비팀 동료", time: "당일 오후", content: "다음 주 감사 전에 확실히 정리해야 할 게 있어." },
      { id: "c01-m2", from: "피해자", to: "감사관", time: "당일 저녁", content: "내일 뵙기 전에 미리 자료 정리해서 보내드릴게요." },
    ],
    testimonies: [
      { id: "c01-t1", witness: "도현", statement: "저는 그 시각 정비실에서 서류만 작성하고 있었어요.", contradictsWith: ["c01-t2"] },
      { id: "c01-t2", witness: "매표소 직원 은서", statement: "23시 20분쯤 도현 팀장님이 정비 통로 쪽으로 걸어가는 걸 봤어요.", contradictsWith: ["c01-t1"] },
    ],
    testimoniesLv3: [
      { id: "c01-t1", witness: "도현", statement: "저는 그 시각 정비실에서 서류만 작성하고 있었어요.", contradictsWith: ["c01-t2", "c01-t3"] },
      { id: "c01-t2", witness: "매표소 직원 은서", statement: "23시 20분쯤 도현 팀장님이 정비 통로 쪽으로 걸어가는 걸 봤어요.", contradictsWith: ["c01-t1"] },
      { id: "c01-t3", witness: "동료 정비공 하람", statement: "도현 팀장님은 그날 정차 구간 점검 자체를 아예 하지 않았다고 저한테 말했어요.", contradictsWith: ["c01-t1"] },
    ],
    lockedEvidence: [
      {
        id: "c01-locked-1",
        name: "정비 시스템 포렌식 감정서",
        unlockHint: "관람차가 실제로 멈췄었는지를 정확히 짚는 질문에서 초록불을 받아야 해금됩니다.",
        description: "복구 전문 업체가 삭제된 로그를 복원한 감정서 — 23:24~23:26 사이 정차 및 도현 계정의 로그인 기록이 명확히 남아 있다.",
        photo: photo("documents", "정비 시스템 포렌식 감정서"),
        unlockTriggerId: "c01-q2",
      },
    ],
  }),
  b({
    id: "c-02-escape-room",
    type: "B",
    difficultySupport: ["LV1", "LV2", "LV3"],
    title: "심야 방탈출카페 마지막 게임",
    synopsis:
      "폐점 직전 마지막 팀 플레이 도중, 스태프 한 명이 밀실 테마룸 안에서 쓰러진 채 발견됐다. 출입은 전자 키패드로만 가능했고, 그 시각 룸에 들어간 기록은 아무에게도 없다.",
    truth:
      "동료 스태프 재윤이 근무표 조작으로 자신의 퇴근 시각을 앞당겨 기록해두고, 실제로는 마스터 키패드 비밀번호로 몰래 재입장해 피해자와 다퉜다. 다툼 중 피해자가 소품 상자에 부딪혀 쓰러졌고, 재윤은 출입 로그에서 자신의 재입장 기록만 골라 삭제했다. 동기는 재윤이 몰래 다른 방탈출 프랜차이즈에 테마 아이디어를 팔아넘긴 걸 피해자가 알아챈 것이었다.",
    answerRequiredKeywordGroups: [
      { label: "범인", keywords: ["재윤"] },
      { label: "트릭", keywords: ["마스터키", "로그삭제", "재입장"] },
      { label: "동기", keywords: ["아이디어", "프랜차이즈", "매도"] },
    ],
    questionBank: [
      { id: "c02-q1", sampleQuestion: "범인은 동료 스태프 재윤입니까?", keywords: ["재윤"], verdict: "green", importance: 3 },
      { id: "c02-q2", sampleQuestion: "재윤은 그 시각 이미 퇴근한 상태였습니까?", keywords: ["퇴근", "이미"], verdict: "yellow", yellowDetail: "근무 기록상으로는 퇴근한 걸로 보이지만, 실제로는 마스터 키패드로 몰래 재입장했습니다.", importance: 2 },
      { id: "c02-q3", sampleQuestion: "마스터 키패드 비밀번호로 재입장한 사람이 있습니까?", keywords: ["마스터키", "재입장"], verdict: "green", importance: 3 },
      { id: "c02-q4", sampleQuestion: "출입 로그가 조작됐습니까?", keywords: ["로그", "삭제", "조작"], verdict: "green", importance: 2 },
      { id: "c02-q5", sampleQuestion: "동기는 테마 아이디어를 경쟁 프랜차이즈에 팔아넘긴 걸 들켜서입니까?", keywords: ["아이디어", "프랜차이즈", "매도"], verdict: "green", importance: 3 },
      { id: "c02-q6", sampleQuestion: "손님 팀 중 한 명이 범인입니까?", keywords: ["손님", "팀원"], verdict: "red", importance: 1 },
      { id: "c02-q7", sampleQuestion: "피해자는 소품 상자에 부딪혀 쓰러졌습니까?", keywords: ["소품", "부딪"], verdict: "green", importance: 2 },
      { id: "c02-q8", sampleQuestion: "미리 계획된 살해였습니까?", keywords: ["계획된 살해", "미리 계획"], verdict: "red", importance: 1 },
    ],
    timeline: [
      { time: "22:00", description: "마지막 팀 입장, 재윤은 근무표상 퇴근으로 기록." },
      { time: "22:15", description: "재윤이 마스터 키패드로 직원 전용 통로를 통해 재입장." },
      { time: "22:20", description: "피해자와 재윤이 테마룸 뒤편에서 다툼." },
      { time: "22:22", description: "피해자가 소품 상자에 부딪혀 쓰러짐." },
      { time: "22:35", description: "재윤이 출입 로그에서 자신의 재입장 기록만 삭제." },
      { time: "22:50", description: "손님 팀이 게임 종료 후 피해자를 발견해 신고." },
    ],
    evidence: [
      { id: "c02-e1", name: "직원 전용 통로 키패드", description: "마스터 비밀번호로 열린 기록이 남은 전자 키패드.", photo: photo("keypad", "직원 전용 통로 전자 키패드") },
      { id: "c02-e2", name: "부서진 소품 상자", description: "테마룸 뒤편에서 발견된 파손된 나무 소품 상자.", photo: photo("broken-crate", "쪼개진 나무 소품 상자 클로즈업") },
      { id: "c02-e3", name: "근무표 원본", description: "재윤의 퇴근 시각이 실제보다 30분 앞당겨 기재된 근무표." },
      { id: "c02-e4", name: "복도 CCTV 스틸컷", description: "22:15경 직원 통로 쪽에서 포착된 흐릿한 인영.", photo: photo("corridor", "직원 전용 통로 CCTV 스틸컷") },
      { id: "c02-e5", name: "경쟁 프랜차이즈 제안 메일 출력본", description: "재윤이 테마 아이디어를 판매하겠다고 제안한 메일." },
    ],
    messages: [
      { id: "c02-m1", from: "재윤", to: "경쟁 프랜차이즈 담당자", time: "사건 D-3", content: "이번 테마 설계도, 확실한 값 쳐주시면 넘길게요." },
      { id: "c02-m2", from: "피해자", to: "재윤", time: "사건 당일 낮", content: "그 메일, 나한테도 참조로 왔던데 무슨 얘기야?" },
    ],
    testimonies: [
      { id: "c02-t1", witness: "재윤", statement: "저는 21시 반에 퇴근하고 바로 집에 갔어요.", contradictsWith: ["c02-t2"] },
      { id: "c02-t2", witness: "야간 매니저 소민", statement: "22시 15분쯤 직원 통로 키패드 불빛이 잠깐 켜지는 걸 봤어요.", contradictsWith: ["c02-t1"] },
    ],
    testimoniesLv3: [
      { id: "c02-t1", witness: "재윤", statement: "저는 21시 반에 퇴근하고 바로 집에 갔어요.", contradictsWith: ["c02-t2", "c02-t3"] },
      { id: "c02-t2", witness: "야간 매니저 소민", statement: "22시 15분쯤 직원 통로 키패드 불빛이 잠깐 켜지는 걸 봤어요.", contradictsWith: ["c02-t1"] },
      { id: "c02-t3", witness: "동료 스태프 하늘", statement: "재윤 씨는 그날 야간 근무 자체가 아예 없었다고 알고 있어요.", contradictsWith: ["c02-t1"] },
    ],
    lockedEvidence: [
      {
        id: "c02-locked-1",
        name: "디지털 출입 포렌식 감정서",
        unlockHint: "마스터 키패드로 몰래 재입장한 사람이 있었는지를 정확히 짚는 질문에서 초록불을 받아야 해금됩니다.",
        description: "출입 통제 업체의 포렌식 복구 결과 — 22:15 마스터 비밀번호 로그인 계정이 재윤 명의로 특정됐다.",
        photo: photo("documents", "디지털 출입 포렌식 감정서"),
        unlockTriggerId: "c02-q3",
      },
    ],
  }),
  b({
    id: "c-03-cosplay-convention",
    type: "B",
    difficultySupport: ["LV1", "LV2", "LV3"],
    title: "코스프레 컨벤션 탈의실 소동",
    synopsis:
      "대형 코스프레 컨벤션 둘째 날, 인기 코스어 한 명이 공용 탈의실에서 정신을 잃은 채 발견됐다. 그날 같은 캐릭터 의상을 입은 참가자가 셋이나 있어서 목격자들의 진술이 서로 엇갈린다.",
    truth:
      "라이벌 코스어 다인이 같은 캐릭터 의상과 가발로 완벽히 변장한 뒤, 피해자의 탈의실 사물함에 몰래 접근해 소품용 스프레이(실은 자극성 화학물질을 섞은)를 얼굴에 뿌렸다. 목격자들이 '피해자 본인'으로 착각한 건 다인의 완벽한 의상 때문이었다. 동기는 그해 최우수 코스프레상 심사에서 피해자에게 밀린 것에 대한 앙심이었다.",
    answerRequiredKeywordGroups: [
      { label: "범인", keywords: ["다인"] },
      { label: "트릭", keywords: ["같은 의상", "가발", "변장"] },
      { label: "동기", keywords: ["심사", "수상", "앙심"] },
    ],
    questionBank: [
      { id: "c03-q1", sampleQuestion: "범인은 라이벌 코스어 다인입니까?", keywords: ["다인"], verdict: "green", importance: 3 },
      { id: "c03-q2", sampleQuestion: "목격자들이 본 사람은 정말 피해자 본인이었습니까?", keywords: ["본인", "피해자 본인"], verdict: "yellow", yellowDetail: "목격자들이 본 실루엣과 의상은 진짜지만, 그 사람은 피해자가 아니라 같은 의상을 입은 다인이었습니다.", importance: 2 },
      { id: "c03-q3", sampleQuestion: "동일한 의상으로 변장해 피해자로 착각하게 만들었습니까?", keywords: ["같은 의상", "변장", "가발"], verdict: "green", importance: 3 },
      { id: "c03-q4", sampleQuestion: "스프레이에 자극성 물질이 섞여 있었습니까?", keywords: ["스프레이", "자극성"], verdict: "green", importance: 2 },
      { id: "c03-q5", sampleQuestion: "동기는 최우수상 심사 결과에 대한 앙심입니까?", keywords: ["심사", "수상", "앙심"], verdict: "green", importance: 3 },
      { id: "c03-q6", sampleQuestion: "주최 측 스태프가 관련돼 있습니까?", keywords: ["스태프", "주최"], verdict: "red", importance: 1 },
      { id: "c03-q7", sampleQuestion: "피해자가 알레르기로 스스로 쓰러졌습니까?", keywords: ["알레르기", "스스로"], verdict: "red", importance: 1 },
      { id: "c03-q8", sampleQuestion: "세 번째 동일 의상 참가자가 공범입니까?", keywords: ["세번째", "공범"], verdict: "red", importance: 1 },
    ],
    timeline: [
      { time: "13:00", description: "동일 캐릭터 코스어 3인 확인(피해자, 다인, 참가자 C)." },
      { time: "13:40", description: "다인이 탈의실 뒤편에서 몰래 가발과 소품을 완전히 맞춤." },
      { time: "13:50", description: "다인이 피해자 사물함 앞에서 대기." },
      { time: "13:55", description: "피해자 등장, 다인이 스프레이 분사." },
      { time: "14:00", description: "다인이 관람객 틈으로 유유히 빠져나감." },
      { time: "14:10", description: "피해자, 탈의실에서 쓰러진 채 발견." },
    ],
    evidence: [
      { id: "c03-e1", name: "현장 소품 스프레이 캔", description: "탈의실 바닥에서 발견된 소품용 스프레이 캔 — 성분 검사 결과 자극성 물질 검출." },
      { id: "c03-e2", name: "탈의실 앞 통로 CCTV 스틸컷", description: "13:55경 동일 의상을 입은 인물이 탈의실로 들어가는 장면.", photo: photo("corridor", "탈의실 앞 통로 CCTV 스틸컷") },
      { id: "c03-e3", name: "다인의 가발 영수증", description: "사건 D-2에 특수 가발숍에서 결제한 영수증 — 피해자와 동일한 색상.", photo: photo("receipt", "특수 가발숍 결제 영수증") },
      { id: "c03-e4", name: "심사 결과 발표문", description: "전년도 최우수 코스프레상 심사 결과 — 다인이 근소한 차이로 피해자에게 밀림." },
      { id: "c03-e5", name: "다인의 사물함 열쇠", description: "다인 명의 사물함에서 발견된 여분의 스프레이 캔 뚜껑.", photo: photo("keys", "사물함 열쇠와 여분 뚜껑") },
    ],
    messages: [
      { id: "c03-m1", from: "다인", to: "친구", time: "사건 D-1", content: "이번엔 진짜 그 사람 코를 납작하게 해줄 거야." },
      { id: "c03-m2", from: "참가자 C", to: "다인", time: "사건 당일 오전", content: "오늘 우리 셋 다 같은 캐릭터라 헷갈리겠다 ㅋㅋ" },
    ],
    testimonies: [
      { id: "c03-t1", witness: "다인", statement: "저는 그 시간엔 포토존에서 사진 찍고 있었어요.", contradictsWith: ["c03-t2"] },
      { id: "c03-t2", witness: "포토존 스태프", statement: "13시 50분 이후로는 다인 씨가 포토존에 안 보였어요.", contradictsWith: ["c03-t1"] },
    ],
    testimoniesLv3: [
      { id: "c03-t1", witness: "다인", statement: "저는 그 시간엔 포토존에서 사진 찍고 있었어요.", contradictsWith: ["c03-t2", "c03-t3"] },
      { id: "c03-t2", witness: "포토존 스태프", statement: "13시 50분 이후로는 다인 씨가 포토존에 안 보였어요.", contradictsWith: ["c03-t1"] },
      { id: "c03-t3", witness: "참가자 C", statement: "다인 씨는 그날 아예 가발을 새로 사지 않았다고 저한테 말했어요.", contradictsWith: ["c03-t1"] },
    ],
    lockedEvidence: [
      {
        id: "c03-locked-1",
        name: "가발숍 결제 내역 포렌식 조회서",
        unlockHint: "동일한 의상으로 변장해 착각을 유도했는지를 정확히 짚는 질문에서 초록불을 받아야 해금됩니다.",
        description: "가발숍 카드 결제 시스템 조회 결과 — 다인 명의 카드로 피해자와 동일한 색상의 특수 가발이 결제된 기록이 확인됐다.",
        photo: photo("financial-doc", "가발숍 결제 내역 조회서"),
        unlockTriggerId: "c03-q3",
      },
    ],
  }),
  b({
    id: "c-04-night-ferry",
    type: "B",
    difficultySupport: ["LV1", "LV2", "LV3"],
    title: "국제선 야간 페리 카지노",
    synopsis:
      "국제선 야간 페리의 선상 카지노에서, 거액을 딴 손님 한 명이 갑판에서 정신을 잃은 채 발견됐다. 용의 선상에 오른 딜러는 사건 시각 자신이 다른 층 매점에 있었다는 카드 결제 기록을 알리바이로 내민다.",
    truth:
      "카지노 딜러 세훈이 공범에게 자신의 매점 카드를 미리 맡겨 대신 결제하게 해 알리바이 기록을 만든 뒤, 실제로는 갑판으로 나가 피해자와 정산 문제로 다투다 피해자를 밀쳤다. 동기는 세훈이 카드 카운팅 사실을 피해자에게 들켜 협박당하고 있었기 때문이다.",
    answerRequiredKeywordGroups: [
      { label: "범인", keywords: ["세훈"] },
      { label: "트릭", keywords: ["카드", "대신결제", "알리바이"] },
      { label: "동기", keywords: ["카운팅", "협박"] },
    ],
    questionBank: [
      { id: "c04-q1", sampleQuestion: "범인은 카지노 딜러 세훈입니까?", keywords: ["세훈"], verdict: "green", importance: 3 },
      { id: "c04-q2", sampleQuestion: "매점 결제 기록은 진짜 알리바이입니까?", keywords: ["매점", "결제", "알리바이"], verdict: "yellow", yellowDetail: "결제 자체는 실제로 일어났지만, 세훈 본인이 아니라 공범이 대신 결제한 것입니다.", importance: 2 },
      { id: "c04-q3", sampleQuestion: "카드를 다른 사람에게 맡겨 대신 결제하게 했습니까?", keywords: ["대신결제", "카드"], verdict: "green", importance: 3 },
      { id: "c04-q4", sampleQuestion: "동기는 카드 카운팅을 들켜서입니까?", keywords: ["카운팅", "협박"], verdict: "green", importance: 3 },
      { id: "c04-q5", sampleQuestion: "다른 손님이 범인입니까?", keywords: ["다른 손님"], verdict: "red", importance: 1 },
      { id: "c04-q6", sampleQuestion: "선상에서 몸싸움이 있었습니까?", keywords: ["몸싸움", "밀쳤"], verdict: "green", importance: 2 },
      { id: "c04-q7", sampleQuestion: "선원이 공범입니까?", keywords: ["선원", "공범"], verdict: "yellow", yellowDetail: "공범이 있었던 건 맞지만 선원이 아니라 세훈의 친구인 승객이었습니다.", importance: 2 },
      { id: "c04-q8", sampleQuestion: "피해자가 술에 취해 실족했습니까?", keywords: ["실족", "취해"], verdict: "red", importance: 1 },
    ],
    timeline: [
      { time: "23:00", description: "피해자가 카지노 테이블에서 거액을 땀." },
      { time: "23:20", description: "세훈이 공범 승객에게 자신의 매점 카드를 맡김." },
      { time: "23:25", description: "공범이 매점에서 세훈 명의 카드로 결제(알리바이용)." },
      { time: "23:26", description: "세훈이 갑판으로 나가 피해자와 정산 문제로 다툼." },
      { time: "23:30", description: "몸싸움 중 피해자가 갑판 난간 근처에서 쓰러짐." },
      { time: "23:45", description: "순찰 승무원이 피해자를 발견." },
    ],
    evidence: [
      { id: "c04-e1", name: "매점 카드 결제 영수증", description: "23:25 세훈 명의 카드로 결제된 매점 영수증.", photo: photo("receipt", "선내 매점 카드 결제 영수증") },
      { id: "c04-e2", name: "갑판 CCTV 스틸컷", description: "23:26경 두 사람이 다투는 듯한 흐릿한 실루엣.", photo: photo("security-camera", "갑판 CCTV 스틸컷") },
      { id: "c04-e3", name: "세훈의 카운팅 메모", description: "테이블 배당률을 기록한 개인 메모지." },
      { id: "c04-e4", name: "피해자의 협박 녹취 메모", description: "피해자가 세훈에게 카운팅 사실을 언급하며 정산을 요구한 메모." },
      { id: "c04-e5", name: "야간 갑판 전경 사진", description: "안개가 낀 야간 갑판의 모습.", photo: photo("car-night", "안개 낀 야간 갑판") },
    ],
    messages: [
      { id: "c04-m1", from: "피해자", to: "세훈", time: "당일 저녁", content: "당신 카운팅하는 거 다 봤어요, 얘기 좀 하죠." },
      { id: "c04-m2", from: "세훈", to: "공범 승객", time: "당일 밤", content: "내 카드로 매점에서 뭐 하나만 사줘, 부탁이야." },
    ],
    testimonies: [
      { id: "c04-t1", witness: "세훈", statement: "저는 그 시각 매점에 있었어요, 결제 기록 보시면 알잖아요.", contradictsWith: ["c04-t2"] },
      { id: "c04-t2", witness: "갑판 순찰 승무원", statement: "23시 26분쯤 갑판에서 딜러 유니폼을 입은 사람을 본 것 같아요.", contradictsWith: ["c04-t1"] },
    ],
    testimoniesLv3: [
      { id: "c04-t1", witness: "세훈", statement: "저는 그 시각 매점에 있었어요, 결제 기록 보시면 알잖아요.", contradictsWith: ["c04-t2", "c04-t3"] },
      { id: "c04-t2", witness: "갑판 순찰 승무원", statement: "23시 26분쯤 갑판에서 딜러 유니폼을 입은 사람을 본 것 같아요.", contradictsWith: ["c04-t1"] },
      { id: "c04-t3", witness: "매점 직원", statement: "그 시각 카드를 내민 손님은 세훈 씨 얼굴이 아니었어요.", contradictsWith: ["c04-t1"] },
    ],
    lockedEvidence: [
      {
        id: "c04-locked-1",
        name: "매점 CCTV 대조 감정서",
        unlockHint: "매점 결제가 정말 세훈 본인이 한 것인지를 정확히 짚는 질문에서 초록불을 받아야 해금됩니다.",
        description: "매점 CCTV와 카드 결제 로그를 대조한 감정서 — 결제 시각 매점에 있던 사람은 세훈이 아니라 체격이 비슷한 다른 승객이었다.",
        photo: photo("documents", "매점 CCTV 대조 감정서"),
        unlockTriggerId: "c04-q2",
      },
    ],
  }),
  b({
    id: "c-05-robotics-lab",
    type: "B",
    difficultySupport: ["LV1", "LV2", "LV3"],
    title: "대학 로봇공학 랩 화재경보",
    synopsis:
      "대학 로봇공학 랩에서 한밤중 화재경보가 울려 전원이 대피했다. 재입장 후, 대학원생 한 명이 실험실 구석에서 쓰러진 채 발견됐다. 화재는 없었는데 경보는 왜 울린 걸까?",
    truth:
      "동료 대학원생 지완이 논문 공동 저자 순위 문제로 갈등을 겪던 피해자를 실험실에 단둘이 남기기 위해, 소화기 근처 감지기에 라이터로 미세한 열을 가해 가짜 화재경보를 울렸다. 전원이 대피한 틈을 타 지완만 몰래 남아 피해자의 연구 노트북을 빼돌리려다 몸싸움이 벌어졌다. 동기는 피해자의 데이터를 지완 단독 명의로 먼저 발표하려는 의도였다.",
    answerRequiredKeywordGroups: [
      { label: "범인", keywords: ["지완"] },
      { label: "트릭", keywords: ["감지기", "가짜경보", "라이터"] },
      { label: "동기", keywords: ["논문", "저자순위", "단독발표"] },
    ],
    questionBank: [
      { id: "c05-q1", sampleQuestion: "범인은 대학원생 지완입니까?", keywords: ["지완"], verdict: "green", importance: 3 },
      { id: "c05-q2", sampleQuestion: "실제로 화재가 있었습니까?", keywords: ["실제 화재", "불이 났"], verdict: "red", importance: 2 },
      { id: "c05-q3", sampleQuestion: "화재경보는 감지기를 조작해 울린 가짜였습니까?", keywords: ["감지기", "가짜경보", "조작"], verdict: "green", importance: 3 },
      { id: "c05-q4", sampleQuestion: "대피 후 실험실에 몰래 남은 사람이 있었습니까?", keywords: ["몰래 남", "대피 후"], verdict: "green", importance: 2 },
      { id: "c05-q5", sampleQuestion: "동기는 논문 저자 순위 문제입니까?", keywords: ["논문", "저자순위", "단독발표"], verdict: "green", importance: 3 },
      { id: "c05-q6", sampleQuestion: "지도교수가 관련돼 있습니까?", keywords: ["지도교수"], verdict: "red", importance: 1 },
      { id: "c05-q7", sampleQuestion: "노트북을 빼돌리려던 것입니까?", keywords: ["노트북", "빼돌"], verdict: "green", importance: 2 },
      { id: "c05-q8", sampleQuestion: "경비원이 경보를 잘못 울렸습니까?", keywords: ["경비원", "잘못 울"], verdict: "red", importance: 1 },
    ],
    timeline: [
      { time: "23:50", description: "지완이 화재감지기 근처에서 라이터로 미세한 열을 가함." },
      { time: "23:52", description: "화재경보 작동, 랩 전원 대피." },
      { time: "23:55", description: "지완만 몰래 되돌아와 피해자의 노트북에 접근." },
      { time: "23:57", description: "마침 남아 있던 피해자와 몸싸움 발생." },
      { time: "00:10", description: "소방점검 후 이상 없음 확인, 재입장." },
      { time: "00:12", description: "피해자가 실험실 구석에서 발견됨." },
    ],
    evidence: [
      { id: "c05-e1", name: "화재감지기 손상 흔적", description: "감지기 표면에서 발견된 미세한 그을음 — 실제 화재가 아닌 국소 가열 흔적.", photo: photo("broken-glass", "손상된 화재감지기 표면") },
      { id: "c05-e2", name: "지완의 라이터", description: "실험실 서랍에서 발견된 라이터, 지완의 지문 검출." },
      { id: "c05-e3", name: "출입 카드 재입장 기록", description: "대피 직후 지완의 카드로 랩에 재입장한 기록.", photo: photo("keypad", "실험실 출입 카드 리더기") },
      { id: "c05-e4", name: "논문 초안 이메일", description: "지완이 단독 저자로 표기해 미리 투고 준비한 논문 초안." },
      { id: "c05-e5", name: "피해자의 연구 노트북", description: "몸싸움 중 바닥에 떨어져 액정이 파손된 노트북.", photo: photo("broken-laptop", "충격으로 거미줄처럼 금이 간 기기 화면") },
    ],
    messages: [
      { id: "c05-m1", from: "지완", to: "학회 담당자", time: "사건 D-2", content: "제 단독 저자로 먼저 투고하고 싶은데 가능할까요?" },
      { id: "c05-m2", from: "피해자", to: "지완", time: "사건 당일 낮", content: "저자 순서 문제는 교수님이랑 다 같이 얘기해야지." },
    ],
    testimonies: [
      { id: "c05-t1", witness: "지완", statement: "저는 대피하고 나서 계속 밖에 있었어요.", contradictsWith: ["c05-t2"] },
      { id: "c05-t2", witness: "동료 대학원생 유나", statement: "23시 55분쯤 지완 씨가 다시 건물 쪽으로 들어가는 걸 봤어요.", contradictsWith: ["c05-t1"] },
    ],
    testimoniesLv3: [
      { id: "c05-t1", witness: "지완", statement: "저는 대피하고 나서 계속 밖에 있었어요.", contradictsWith: ["c05-t2", "c05-t3"] },
      { id: "c05-t2", witness: "동료 대학원생 유나", statement: "23시 55분쯤 지완 씨가 다시 건물 쪽으로 들어가는 걸 봤어요.", contradictsWith: ["c05-t1"] },
      { id: "c05-t3", witness: "경비원", statement: "지완 학생 카드는 그 시간대에 전혀 사용되지 않았다고 들었어요.", contradictsWith: ["c05-t1"] },
    ],
    lockedEvidence: [
      {
        id: "c05-locked-1",
        name: "출입 카드 시스템 포렌식 감정서",
        unlockHint: "대피 후 실험실에 몰래 남은 사람이 있었는지를 정확히 짚는 질문에서 초록불을 받아야 해금됩니다.",
        description: "출입 통제 시스템 감정 결과 — 23:55 지완 명의 카드로 랩 재입장이 확인됐다.",
        photo: photo("documents", "출입 카드 시스템 포렌식 감정서"),
        unlockTriggerId: "c05-q4",
      },
    ],
  }),
  b({
    id: "c-06-quiz-show",
    type: "B",
    difficultySupport: ["LV1", "LV2", "LV3"],
    title: "생중계 퀴즈쇼 정답 유출",
    synopsis:
      "생중계 퀴즈쇼 결승전에서, 우승 후보가 결정적인 문제에서 갑자기 정답을 맞히지 못하고 쓰러졌다. 방송 직후 '부정행위 의혹'이 불거졌는데, 정작 쓰러진 사람이 피해자라니 이상한 일이다.",
    truth:
      "상대 참가자 은호가 몰래 초소형 이어폰으로 외부 조력자의 힌트를 받아왔는데, 결승 직전 피해자가 이 사실을 알아채고 항의하자 은호가 대기실에서 몸싸움을 벌였다. 방송 중 쓰러진 건 그 몸싸움 때문이었고, 부정행위 의혹은 오히려 은호가 여론을 돌리려고 흘린 역정보였다. 동기는 우승 상금과 방송 출연 계약이었다.",
    answerRequiredKeywordGroups: [
      { label: "범인", keywords: ["은호"] },
      { label: "트릭", keywords: ["이어폰", "몸싸움", "대기실"] },
      { label: "동기", keywords: ["상금", "출연계약"] },
    ],
    questionBank: [
      { id: "c06-q1", sampleQuestion: "범인은 상대 참가자 은호입니까?", keywords: ["은호"], verdict: "green", importance: 3 },
      { id: "c06-q2", sampleQuestion: "부정행위를 한 사람은 피해자입니까?", keywords: ["피해자", "부정행위"], verdict: "red", importance: 2 },
      { id: "c06-q3", sampleQuestion: "은호가 초소형 이어폰으로 힌트를 받았습니까?", keywords: ["이어폰", "힌트"], verdict: "green", importance: 3 },
      { id: "c06-q4", sampleQuestion: "대기실에서 몸싸움이 있었습니까?", keywords: ["대기실", "몸싸움"], verdict: "green", importance: 3 },
      { id: "c06-q5", sampleQuestion: "동기는 우승 상금과 출연 계약입니까?", keywords: ["상금", "출연계약"], verdict: "green", importance: 3 },
      { id: "c06-q6", sampleQuestion: "제작진이 조작에 가담했습니까?", keywords: ["제작진", "가담"], verdict: "red", importance: 1 },
      { id: "c06-q7", sampleQuestion: "피해자가 긴장해서 스스로 쓰러졌습니까?", keywords: ["긴장", "스스로"], verdict: "red", importance: 1 },
      { id: "c06-q8", sampleQuestion: "부정행위 의혹은 은호가 흘린 역정보입니까?", keywords: ["역정보", "흘린"], verdict: "green", importance: 2 },
    ],
    timeline: [
      { time: "D-1", description: "은호가 외부 조력자와 이어폰 힌트 시스템을 준비." },
      { time: "결승 직전", description: "피해자가 은호의 이어폰을 목격하고 항의." },
      { time: "결승 30분 전", description: "대기실에서 두 사람 몸싸움." },
      { time: "결승 시작", description: "피해자, 충격으로 결정적 문제에서 답을 못 함." },
      { time: "결승 중", description: "피해자가 무대 위에서 쓰러짐." },
      { time: "방송 직후", description: "은호 측에서 '피해자 부정행위 의혹'을 흘림." },
    ],
    evidence: [
      { id: "c06-e1", name: "초소형 이어폰", description: "은호의 대기실 사물함에서 발견된 초소형 무선 이어폰." },
      { id: "c06-e2", name: "대기실 CCTV 스틸컷", description: "몸싸움 직전 두 사람이 대기실에 함께 있는 장면.", photo: photo("corridor", "대기실 앞 CCTV 스틸컷") },
      { id: "c06-e3", name: "외부 조력자와의 문자 내역", description: "결승 문제 힌트를 주고받은 것으로 보이는 문자 기록." },
      { id: "c06-e4", name: "출연 계약서 초안", description: "우승 시 은호에게 유리한 방송 출연 계약 조건이 담긴 문서.", photo: photo("documents", "방송 출연 계약서 초안") },
      { id: "c06-e5", name: "피해자의 멍든 팔 사진", description: "몸싸움 중 생긴 것으로 보이는 팔의 타박상 자국.", photo: photo("bruise-arm", "몸싸움 중 생긴 팔의 타박상") },
    ],
    messages: [
      { id: "c06-m1", from: "은호", to: "외부 조력자", time: "결승 D-1", content: "결승 문제 힌트, 시간 맞춰서 꼭 보내주세요." },
      { id: "c06-m2", from: "피해자", to: "은호", time: "결승 직전", content: "그 이어폰 뭐야, 지금 나랑 얘기 좀 해." },
    ],
    testimonies: [
      { id: "c06-t1", witness: "은호", statement: "저는 대기실에서 혼자 조용히 준비만 하고 있었어요.", contradictsWith: ["c06-t2"] },
      { id: "c06-t2", witness: "대기실 담당 스태프", statement: "결승 30분 전에 대기실에서 언성이 높아지는 소리를 들었어요.", contradictsWith: ["c06-t1"] },
    ],
    testimoniesLv3: [
      { id: "c06-t1", witness: "은호", statement: "저는 대기실에서 혼자 조용히 준비만 하고 있었어요.", contradictsWith: ["c06-t2", "c06-t3"] },
      { id: "c06-t2", witness: "대기실 담당 스태프", statement: "결승 30분 전에 대기실에서 언성이 높아지는 소리를 들었어요.", contradictsWith: ["c06-t1"] },
      { id: "c06-t3", witness: "동료 참가자", statement: "은호 씨는 그날 피해자와 아예 마주친 적도 없다고 하던데요.", contradictsWith: ["c06-t1"] },
    ],
    lockedEvidence: [
      {
        id: "c06-locked-1",
        name: "이어폰 통신 기록 포렌식 감정서",
        unlockHint: "은호가 초소형 이어폰으로 힌트를 받았는지를 정확히 짚는 질문에서 초록불을 받아야 해금됩니다.",
        description: "통신사 협조로 확보한 이어폰 페어링 기록 — 결승 문제 시각과 정확히 일치하는 수신 로그가 확인됐다.",
        photo: photo("computer-log", "이어폰 통신 기록 포렌식 감정서"),
        unlockTriggerId: "c06-q3",
      },
    ],
  }),
  b({
    id: "c-07-mountain-trail",
    type: "B",
    difficultySupport: ["LV1", "LV2", "LV3"],
    title: "등산로 야간 하산 사고",
    synopsis:
      "동호회 야간 등반 도중, 회원 한 명이 하산길에서 굴러떨어져 발견됐다. 안전 장비를 항상 철저히 점검하던 사람이라 단순 사고로 보기엔 석연치 않다.",
    truth:
      "동호회 부회장 인석이 회장 선거를 앞두고 경쟁자였던 피해자의 등산화 밑창 스파이크를 미리 느슨하게 풀어뒀다. 하산길 젖은 바위 구간에서 스파이크가 빠지며 피해자가 미끄러졌다. 동기는 다가오는 동호회장 선거에서 유일한 경쟁자를 제거하려는 것이었다.",
    answerRequiredKeywordGroups: [
      { label: "범인", keywords: ["인석"] },
      { label: "트릭", keywords: ["스파이크", "등산화", "풀어"] },
      { label: "동기", keywords: ["선거", "회장", "경쟁자"] },
    ],
    questionBank: [
      { id: "c07-q1", sampleQuestion: "범인은 부회장 인석입니까?", keywords: ["인석"], verdict: "green", importance: 3 },
      { id: "c07-q2", sampleQuestion: "등산화 스파이크가 미리 풀려 있었습니까?", keywords: ["스파이크", "풀려"], verdict: "green", importance: 3 },
      { id: "c07-q3", sampleQuestion: "단순히 젖은 바위에서 실족한 사고입니까?", keywords: ["단순 사고", "실족"], verdict: "yellow", yellowDetail: "미끄러진 지점 자체는 맞지만, 원인은 '단순 실족'이 아니라 미리 풀려 있던 스파이크입니다.", importance: 2 },
      { id: "c07-q4", sampleQuestion: "동기는 동호회장 선거 경쟁 때문입니까?", keywords: ["선거", "회장", "경쟁자"], verdict: "green", importance: 3 },
      { id: "c07-q5", sampleQuestion: "다른 회원이 장비를 빌려줬다가 실수한 것입니까?", keywords: ["빌려줬다가", "실수"], verdict: "red", importance: 1 },
      { id: "c07-q6", sampleQuestion: "인석이 사건 전날 피해자의 장비에 접근했습니까?", keywords: ["전날", "장비", "접근"], verdict: "green", importance: 2 },
      { id: "c07-q7", sampleQuestion: "날씨 탓에 전원이 위험했던 상황입니까?", keywords: ["날씨", "전원 위험"], verdict: "red", importance: 1 },
      { id: "c07-q8", sampleQuestion: "인석이 선거에서 이기기 위해 계획적으로 움직였습니까?", keywords: ["계획적", "선거"], verdict: "green", importance: 2 },
    ],
    timeline: [
      { time: "등반 D-1 저녁", description: "인석이 장비 보관실에서 피해자의 등산화 스파이크를 느슨하게 풂." },
      { time: "당일 18:00", description: "동호회 야간 등반 시작." },
      { time: "21:30", description: "정상 도착, 잠시 휴식." },
      { time: "22:00", description: "하산 시작, 젖은 바위 구간 진입." },
      { time: "22:15", description: "피해자의 등산화 스파이크가 빠지며 미끄러짐." },
      { time: "22:20", description: "동료들이 피해자를 발견해 구조 요청." },
    ],
    evidence: [
      { id: "c07-e1", name: "피해자의 등산화", description: "스파이크 고정 나사가 헐거워진 상태로 회수된 등산화." },
      { id: "c07-e2", name: "장비 보관실 출입 기록", description: "등반 전날 저녁 인석의 카드로 장비 보관실이 열린 기록.", photo: photo("keypad", "장비 보관실 출입 카드 리더기") },
      { id: "c07-e3", name: "하산길 젖은 바위 구간 사진", description: "사고 지점의 젖은 바위 구간 모습.", photo: photo("footprint", "젖은 바위 구간 발자국") },
      { id: "c07-e4", name: "동호회장 선거 공고문", description: "다가오는 동호회장 선거 후보 등록 공고 — 인석과 피해자 단 둘." },
      { id: "c07-e5", name: "인석의 공구 세트", description: "스파이크 조정용 육각렌치가 포함된 개인 공구 세트." },
    ],
    messages: [
      { id: "c07-m1", from: "인석", to: "친구", time: "등반 D-2", content: "이번 선거는 무조건 내가 돼야 해." },
      { id: "c07-m2", from: "피해자", to: "동호회 단톡방", time: "등반 D-1", content: "내일 등반 다들 장비 점검 잘하고 오세요!" },
    ],
    testimonies: [
      { id: "c07-t1", witness: "인석", statement: "저는 전날 저녁엔 집에만 있었어요, 장비실 근처도 안 갔어요.", contradictsWith: ["c07-t2"] },
      { id: "c07-t2", witness: "총무 재현", statement: "전날 저녁 인석 씨 카드로 장비 보관실 문이 열린 기록이 있던데요.", contradictsWith: ["c07-t1"] },
    ],
    testimoniesLv3: [
      { id: "c07-t1", witness: "인석", statement: "저는 전날 저녁엔 집에만 있었어요, 장비실 근처도 안 갔어요.", contradictsWith: ["c07-t2", "c07-t3"] },
      { id: "c07-t2", witness: "총무 재현", statement: "전날 저녁 인석 씨 카드로 장비 보관실 문이 열린 기록이 있던데요.", contradictsWith: ["c07-t1"] },
      { id: "c07-t3", witness: "동호회원 다솜", statement: "인석 씨는 그 전날 등반 준비 때문에 계속 저희랑 같이 있었다고 들었어요.", contradictsWith: ["c07-t1"] },
    ],
    lockedEvidence: [
      {
        id: "c07-locked-1",
        name: "장비 보관실 출입 포렌식 감정서",
        unlockHint: "등산화 스파이크가 미리 풀려 있었는지를 정확히 짚는 질문에서 초록불을 받아야 해금됩니다.",
        description: "장비 보관실 출입 시스템 감정 결과 — 등반 전날 저녁 인석 명의 카드로 15분간 출입한 기록이 확인됐다.",
        photo: photo("documents", "장비 보관실 출입 포렌식 감정서"),
        unlockTriggerId: "c07-q2",
      },
    ],
  }),
  b({
    id: "c-08-aquarium-night",
    type: "B",
    difficultySupport: ["LV1", "LV2", "LV3"],
    title: "수족관 야간 특별관람",
    synopsis:
      "수족관 야간 특별관람 행사 도중, 사육사 한 명이 대형 수조 관리 통로에서 쓰러진 채 발견됐다. 통로는 스마트 도어락으로만 열리는데, 그 시각 문이 열린 기록 자체가 없다.",
    truth:
      "동료 사육사 하윤이 스마트 도어락 앱의 원격 제어 기능으로 자신의 스마트폰에서 문을 열고 잠갔는데, 앱 로그 서버 설정을 미리 건드려 자기 계정의 원격 개폐 기록만 서버에 남지 않도록 조작해뒀다. 통로에서 피해자와 사료 발주 비리 문제로 다투다 피해자가 미끄러져 부딪혔다. 동기는 피해자가 하윤의 사료 발주 리베이트 정황을 관장에게 보고하려던 것을 막기 위해서였다.",
    answerRequiredKeywordGroups: [
      { label: "범인", keywords: ["하윤"] },
      { label: "트릭", keywords: ["원격제어", "로그조작", "스마트도어락"] },
      { label: "동기", keywords: ["리베이트", "발주비리", "보고"] },
    ],
    questionBank: [
      { id: "c08-q1", sampleQuestion: "범인은 동료 사육사 하윤입니까?", keywords: ["하윤"], verdict: "green", importance: 3 },
      { id: "c08-q2", sampleQuestion: "그 시각 통로 문이 정말 열리지 않았습니까?", keywords: ["문이 안 열", "열리지 않"], verdict: "yellow", yellowDetail: "서버 로그상으로는 안 열린 것처럼 보이지만, 실제로는 하윤이 원격으로 열고 로그만 조작해 지운 것입니다.", importance: 2 },
      { id: "c08-q3", sampleQuestion: "스마트폰 앱으로 원격으로 문을 열었습니까?", keywords: ["원격제어", "스마트폰", "앱"], verdict: "green", importance: 3 },
      { id: "c08-q4", sampleQuestion: "도어락 로그가 조작됐습니까?", keywords: ["로그", "조작"], verdict: "green", importance: 2 },
      { id: "c08-q5", sampleQuestion: "동기는 사료 발주 리베이트 문제입니까?", keywords: ["리베이트", "발주비리"], verdict: "green", importance: 3 },
      { id: "c08-q6", sampleQuestion: "관람객이 통로에 몰래 들어갔습니까?", keywords: ["관람객", "몰래"], verdict: "red", importance: 1 },
      { id: "c08-q7", sampleQuestion: "피해자가 바닥에 미끄러져 부딪힌 것입니까?", keywords: ["미끄러", "부딪"], verdict: "green", importance: 2 },
      { id: "c08-q8", sampleQuestion: "수조 여과 장치 고장이 원인입니까?", keywords: ["여과장치", "고장"], verdict: "red", importance: 1 },
    ],
    timeline: [
      { time: "D-3", description: "하윤이 도어락 서버 설정을 미리 조작해 자기 계정 로그를 숨김." },
      { time: "당일 20:00", description: "야간 특별관람 행사 시작." },
      { time: "20:40", description: "하윤이 스마트폰으로 관리 통로 문을 원격으로 개방." },
      { time: "20:42", description: "통로 안에서 피해자와 발주 문제로 다툼." },
      { time: "20:44", description: "피해자가 젖은 바닥에 미끄러져 부딪힘." },
      { time: "21:00", description: "순찰 사육사가 피해자를 발견." },
    ],
    evidence: [
      { id: "c08-e1", name: "스마트 도어락 서버 원본 로그", description: "서버 설정 변경 이력 — 하윤 계정의 개폐 기록만 별도로 숨겨진 흔적.", photo: photo("computer-log", "스마트 도어락 서버 로그 화면") },
      { id: "c08-e2", name: "관리 통로 스마트 도어락", description: "관리 통로 입구에 설치된 스마트 도어락 패널.", photo: photo("keypad", "관리 통로 스마트 도어락") },
      { id: "c08-e3", name: "사료 발주 내역서", description: "하윤이 특정 업체에만 몰아준 사료 발주 내역." },
      { id: "c08-e4", name: "피해자의 보고서 초안", description: "관장에게 제출하려던 발주 비리 의혹 보고서 초안." },
      { id: "c08-e5", name: "통로 바닥 물기 흔적 사진", description: "미끄러운 상태였던 통로 바닥 모습.", photo: photo("footprint", "통로 바닥 미끄럼 흔적") },
    ],
    messages: [
      { id: "c08-m1", from: "피해자", to: "관장", time: "당일 오후", content: "발주 관련해서 확인해주셔야 할 게 있어요, 내일 보고드릴게요." },
      { id: "c08-m2", from: "하윤", to: "발주 업체 담당자", time: "사건 D-5", content: "이번 달도 잘 부탁드려요, 늘 하던 대로요." },
    ],
    testimonies: [
      { id: "c08-t1", witness: "하윤", statement: "저는 그 시각 로비에서 관람객 안내만 하고 있었어요.", contradictsWith: ["c08-t2"] },
      { id: "c08-t2", witness: "동료 사육사 소이", statement: "20시 40분쯤 하윤 씨가 스마트폰을 보며 관리 통로 쪽으로 가는 걸 봤어요.", contradictsWith: ["c08-t1"] },
    ],
    testimoniesLv3: [
      { id: "c08-t1", witness: "하윤", statement: "저는 그 시각 로비에서 관람객 안내만 하고 있었어요.", contradictsWith: ["c08-t2", "c08-t3"] },
      { id: "c08-t2", witness: "동료 사육사 소이", statement: "20시 40분쯤 하윤 씨가 스마트폰을 보며 관리 통로 쪽으로 가는 걸 봤어요.", contradictsWith: ["c08-t1"] },
      { id: "c08-t3", witness: "야간 경비원", statement: "하윤 사육사님은 그날 로비를 벗어난 적이 없다고 알고 있어요.", contradictsWith: ["c08-t1"] },
    ],
    lockedEvidence: [
      {
        id: "c08-locked-1",
        name: "도어락 서버 포렌식 복구 감정서",
        unlockHint: "스마트폰 앱으로 원격으로 문을 열었는지를 정확히 짚는 질문에서 초록불을 받아야 해금됩니다.",
        description: "보안 업체의 서버 포렌식 복구 결과 — 20:40 하윤 계정의 원격 개폐 요청이 삭제 처리 직전 기록으로 남아 있었다.",
        photo: photo("documents", "도어락 서버 포렌식 복구 감정서"),
        unlockTriggerId: "c08-q3",
      },
    ],
  }),
  b({
    id: "c-09-wedding-hall",
    type: "B",
    difficultySupport: ["LV1", "LV2", "LV3"],
    title: "웨딩홀 피로연 반지 실종",
    synopsis:
      "결혼식 피로연 도중, 신부 대기실에 보관해둔 고가의 결혼반지 세트가 감쪽같이 사라졌다. 대기실은 카드키로만 출입 가능한데, 출입 기록엔 아무도 들어간 사람이 없다.",
    truth:
      "웨딩플래너 보조 다연이 미리 대기실 카드키를 복제해두고, 자신의 정식 출입 기록이 남지 않도록 복제 카드로 몰래 들어가 반지를 훔친 뒤 하객용 꽃다발 속에 숨겨 반출했다. 동기는 다연이 개인 사채 빚 문제로 급전이 필요했기 때문이다.",
    answerRequiredKeywordGroups: [
      { label: "범인", keywords: ["다연"] },
      { label: "트릭", keywords: ["복제카드", "꽃다발", "반출"] },
      { label: "동기", keywords: ["사채", "빚", "급전"] },
    ],
    questionBank: [
      { id: "c09-q1", sampleQuestion: "범인은 웨딩플래너 보조 다연입니까?", keywords: ["다연"], verdict: "green", importance: 3 },
      { id: "c09-q2", sampleQuestion: "출입 기록에 남지 않은 카드키가 사용됐습니까?", keywords: ["복제카드", "복제"], verdict: "green", importance: 3 },
      { id: "c09-q3", sampleQuestion: "반지는 꽃다발 속에 숨겨져 반출됐습니까?", keywords: ["꽃다발", "반출"], verdict: "green", importance: 3 },
      { id: "c09-q4", sampleQuestion: "동기는 사채 빚 때문입니까?", keywords: ["사채", "빚", "급전"], verdict: "green", importance: 3 },
      { id: "c09-q5", sampleQuestion: "신랑 측 하객이 범인입니까?", keywords: ["하객", "신랑측"], verdict: "red", importance: 1 },
      { id: "c09-q6", sampleQuestion: "정식 카드키 출입 기록이 있습니까?", keywords: ["정식 출입", "출입기록"], verdict: "red", importance: 2 },
      { id: "c09-q7", sampleQuestion: "경비 업체 직원이 공범입니까?", keywords: ["경비", "공범"], verdict: "red", importance: 1 },
      { id: "c09-q8", sampleQuestion: "다연이 사건 전날 카드키 복제 장비를 준비했습니까?", keywords: ["복제 장비", "전날"], verdict: "green", importance: 2 },
    ],
    timeline: [
      { time: "D-1", description: "다연이 대기실 카드키를 몰래 복제." },
      { time: "당일 피로연 중", description: "다연이 복제 카드로 대기실에 잠입." },
      { time: "직후", description: "반지 세트를 꽃다발 속에 숨김." },
      { time: "피로연 종료 무렵", description: "다연이 꽃다발을 들고 자연스럽게 퇴장." },
      { time: "익일", description: "신부가 반지 분실을 확인하고 신고." },
    ],
    evidence: [
      { id: "c09-e1", name: "대기실 카드키 리더기", description: "정식 카드 출입 기록이 없는 대기실 입구 리더기.", photo: photo("keypad", "신부 대기실 카드키 리더기") },
      { id: "c09-e2", name: "다연의 복제 카드", description: "다연의 가방에서 발견된 미등록 복제 카드." },
      { id: "c09-e3", name: "하객용 꽃다발 잔해", description: "피로연 종료 후 발견된, 안쪽에 빈 공간이 있던 꽃다발.", photo: photo("suitcase", "속을 비운 꽃다발 포장") },
      { id: "c09-e4", name: "사채업체 독촉 문자 캡처", description: "다연의 휴대폰에서 발견된 사채 상환 독촉 메시지." },
      { id: "c09-e5", name: "대기실 CCTV 스틸컷", description: "대기실 앞 복도에서 포착된 인영 — 얼굴은 확인 불가.", photo: photo("corridor", "대기실 앞 복도 CCTV 스틸컷") },
    ],
    messages: [
      { id: "c09-m1", from: "사채업체", to: "다연", time: "사건 D-2", content: "이번 주까지 입금 안 되면 곤란해집니다." },
      { id: "c09-m2", from: "다연", to: "친구", time: "사건 D-1", content: "이번 주 안에 무조건 돈을 구해야 해." },
    ],
    testimonies: [
      { id: "c09-t1", witness: "다연", statement: "저는 그날 대기실 근처엔 얼씬도 안 했어요.", contradictsWith: ["c09-t2"] },
      { id: "c09-t2", witness: "동료 플래너 시은", statement: "피로연 중간에 다연 씨가 꽃다발을 들고 대기실 쪽 복도에서 나오는 걸 봤어요.", contradictsWith: ["c09-t1"] },
    ],
    testimoniesLv3: [
      { id: "c09-t1", witness: "다연", statement: "저는 그날 대기실 근처엔 얼씬도 안 했어요.", contradictsWith: ["c09-t2", "c09-t3"] },
      { id: "c09-t2", witness: "동료 플래너 시은", statement: "피로연 중간에 다연 씨가 꽃다발을 들고 대기실 쪽 복도에서 나오는 걸 봤어요.", contradictsWith: ["c09-t1"] },
      { id: "c09-t3", witness: "웨딩홀 매니저", statement: "다연 씨는 그날 계속 로비 안내 데스크에만 있었다고 알고 있어요.", contradictsWith: ["c09-t1"] },
    ],
    lockedEvidence: [
      {
        id: "c09-locked-1",
        name: "카드키 시스템 포렌식 감정서",
        unlockHint: "출입 기록에 남지 않은 카드키가 사용됐는지를 정확히 짚는 질문에서 초록불을 받아야 해금됩니다.",
        description: "카드키 시스템 제조사의 포렌식 결과 — 미등록 복제 카드의 물리적 신호 패턴이 다연이 소지한 카드와 일치했다.",
        photo: photo("documents", "카드키 시스템 포렌식 감정서"),
        unlockTriggerId: "c09-q2",
      },
    ],
  }),
  b({
    id: "c-10-boxing-gym",
    type: "B",
    difficultySupport: ["LV1", "LV2", "LV3"],
    title: "복싱 체육관 스파링 사고",
    synopsis:
      "아마추어 복싱 대회를 앞둔 스파링 도중, 유망주 한 명이 평소와 다르게 갑자기 기력을 잃고 쓰러졌다. 단순 컨디션 난조로 보기엔 회복 속도가 이상하다.",
    truth:
      "같은 체급 경쟁자 태민이 계체량 통과를 위해 몰래 이뇨제 성분을 피해자의 개인 물통에 섞어 넣었다. 급격한 탈수로 피해자가 스파링 중 쓰러진 것이었다. 동기는 태민이 대회 출전권이 두 명 중 한 명에게만 주어지는 상황에서 피해자를 탈락시키려던 것이었다.",
    answerRequiredKeywordGroups: [
      { label: "범인", keywords: ["태민"] },
      { label: "트릭", keywords: ["이뇨제", "물통", "탈수"] },
      { label: "동기", keywords: ["출전권", "대회", "탈락"] },
    ],
    questionBank: [
      { id: "c10-q1", sampleQuestion: "범인은 경쟁자 태민입니까?", keywords: ["태민"], verdict: "green", importance: 3 },
      { id: "c10-q2", sampleQuestion: "피해자가 약물로 컨디션이 나빠졌습니까?", keywords: ["약물", "이뇨제"], verdict: "green", importance: 3 },
      { id: "c10-q3", sampleQuestion: "물통에 무언가를 탔습니까?", keywords: ["물통", "탔"], verdict: "green", importance: 3 },
      { id: "c10-q4", sampleQuestion: "단순 컨디션 난조입니까?", keywords: ["컨디션 난조", "단순"], verdict: "red", importance: 2 },
      { id: "c10-q5", sampleQuestion: "동기는 대회 출전권 경쟁 때문입니까?", keywords: ["출전권", "대회", "탈락"], verdict: "green", importance: 3 },
      { id: "c10-q6", sampleQuestion: "코치가 훈련을 과하게 시킨 게 원인입니까?", keywords: ["코치", "과한 훈련"], verdict: "red", importance: 1 },
      { id: "c10-q7", sampleQuestion: "태민이 계체량 통과를 위해 이뇨제를 사용했습니까?", keywords: ["계체량", "이뇨제"], verdict: "yellow", yellowDetail: "이뇨제를 사용한 건 맞지만, 자기 계체량용이 아니라 피해자의 물통에 몰래 탄 것입니다.", importance: 2 },
      { id: "c10-q8", sampleQuestion: "피해자 본인이 실수로 잘못된 보충제를 먹었습니까?", keywords: ["본인 실수", "보충제"], verdict: "red", importance: 1 },
    ],
    timeline: [
      { time: "스파링 D-1", description: "태민이 이뇨제 성분을 구입." },
      { time: "당일 오전", description: "태민이 락커룸에서 피해자의 물통에 몰래 성분을 섞음." },
      { time: "오후 스파링 시작", description: "피해자가 평소처럼 물통을 마시며 훈련." },
      { time: "스파링 중반", description: "피해자가 급격히 탈수 증상을 보이며 쓰러짐." },
      { time: "직후", description: "코치가 응급처치 후 병원 이송." },
    ],
    evidence: [
      { id: "c10-e1", name: "피해자의 물통", description: "성분 검사 결과 이뇨제 잔여물이 검출된 개인 물통." },
      { id: "c10-e2", name: "락커룸 CCTV 스틸컷", description: "당일 오전 락커룸에서 물통 근처를 서성이는 인물.", photo: photo("corridor", "락커룸 CCTV 스틸컷") },
      { id: "c10-e3", name: "태민의 약국 영수증", description: "사건 전날 이뇨제 성분 약품을 구입한 영수증.", photo: photo("receipt", "약국 구입 영수증") },
      { id: "c10-e4", name: "대회 출전권 규정문", description: "같은 체급에서 단 한 명만 출전 가능하다는 대회 규정." },
      { id: "c10-e5", name: "코치의 진단 메모", description: "피해자의 급격한 탈수 증상을 기록한 코치의 메모." },
    ],
    messages: [
      { id: "c10-m1", from: "태민", to: "친구", time: "스파링 D-1", content: "이번엔 무조건 내가 출전권 가져가야 해." },
      { id: "c10-m2", from: "코치", to: "태민", time: "당일 오전", content: "오늘 스파링 컨디션 괜찮아? 몸 상태 체크하고 들어와." },
    ],
    testimonies: [
      { id: "c10-t1", witness: "태민", statement: "저는 락커룸엔 아침에 잠깐 들렀다가 바로 나왔어요.", contradictsWith: ["c10-t2"] },
      { id: "c10-t2", witness: "체육관 관장", statement: "태민 씨가 오전에 락커룸에서 꽤 오래 머물러 있던 게 기억나요.", contradictsWith: ["c10-t1"] },
    ],
    testimoniesLv3: [
      { id: "c10-t1", witness: "태민", statement: "저는 락커룸엔 아침에 잠깐 들렀다가 바로 나왔어요.", contradictsWith: ["c10-t2", "c10-t3"] },
      { id: "c10-t2", witness: "체육관 관장", statement: "태민 씨가 오전에 락커룸에서 꽤 오래 머물러 있던 게 기억나요.", contradictsWith: ["c10-t1"] },
      { id: "c10-t3", witness: "동료 선수", statement: "태민 씨는 그날 아침 락커룸에 아예 오지 않았다고 들었어요.", contradictsWith: ["c10-t1"] },
    ],
    lockedEvidence: [
      {
        id: "c10-locked-1",
        name: "물통 성분 정밀 감정서",
        unlockHint: "물통에 무언가를 탔는지를 정확히 짚는 질문에서 초록불을 받아야 해금됩니다.",
        description: "약물 정밀 감정 결과 — 물통에서 검출된 이뇨제 성분이 태민이 구입한 약품과 동일 성분으로 확인됐다.",
        photo: photo("documents", "물통 성분 정밀 감정서"),
        unlockTriggerId: "c10-q3",
      },
    ],
  }),
  b({
    id: "c-11-old-bookstore",
    type: "B",
    difficultySupport: ["LV1", "LV2", "LV3"],
    title: "오래된 서점 폐업 전날",
    synopsis:
      "3대째 이어온 헌책방이 폐업하기 전날 밤, 가게 안쪽 창고에서 단골손님 한 명이 쓰러진 채 발견됐다. 창고엔 대대로 내려오던 희귀 초판본 한 권이 사라지고 없다.",
    truth:
      "서점 단골이자 고서 수집가인 명우가 폐업 정리를 돕는 척 창고에 남아, 진짜 초판본을 몰래 빼돌리고 정교한 복제본을 그 자리에 꽂아뒀다. 피해자가 이를 눈치채고 따지자 명우가 밀쳐 넘어뜨렸다. 동기는 그 초판본을 해외 경매에 고가로 팔아넘기려는 것이었다.",
    answerRequiredKeywordGroups: [
      { label: "범인", keywords: ["명우"] },
      { label: "트릭", keywords: ["복제본", "바꿔치기"] },
      { label: "동기", keywords: ["경매", "판매", "고가"] },
    ],
    questionBank: [
      { id: "c11-q1", sampleQuestion: "범인은 단골손님 명우입니까?", keywords: ["명우"], verdict: "green", importance: 3 },
      { id: "c11-q2", sampleQuestion: "초판본이 정말 사라졌습니까?", keywords: ["사라졌", "없어졌"], verdict: "yellow", yellowDetail: "책장에 책이 꽂혀 있긴 하지만 그건 진품이 아니라 정교한 복제본입니다.", importance: 2 },
      { id: "c11-q3", sampleQuestion: "진품을 복제본으로 바꿔치기했습니까?", keywords: ["복제본", "바꿔치기"], verdict: "green", importance: 3 },
      { id: "c11-q4", sampleQuestion: "동기는 해외 경매에 팔기 위해서입니까?", keywords: ["경매", "판매", "고가"], verdict: "green", importance: 3 },
      { id: "c11-q5", sampleQuestion: "서점 주인이 공범입니까?", keywords: ["서점 주인", "공범"], verdict: "red", importance: 1 },
      { id: "c11-q6", sampleQuestion: "피해자가 밀려 넘어졌습니까?", keywords: ["밀려", "넘어"], verdict: "green", importance: 2 },
      { id: "c11-q7", sampleQuestion: "명우가 폐업 정리를 돕겠다고 자원했습니까?", keywords: ["정리 돕", "자원"], verdict: "green", importance: 2 },
      { id: "c11-q8", sampleQuestion: "복제본은 몇 주 전부터 준비돼 있었습니까?", keywords: ["몇 주 전", "준비"], verdict: "green", importance: 1 },
    ],
    timeline: [
      { time: "폐업 D-14", description: "명우가 몰래 복제본 제작을 의뢰." },
      { time: "폐업 전날 저녁", description: "명우가 정리를 돕겠다며 창고에 남음." },
      { time: "21:00", description: "명우가 진품을 복제본으로 바꿔치기." },
      { time: "21:10", description: "피해자가 책 상태를 확인하다 위화감을 느낌." },
      { time: "21:12", description: "피해자가 따지자 명우가 밀쳐 넘어뜨림." },
      { time: "21:30", description: "서점 주인이 창고에서 쓰러진 피해자를 발견." },
    ],
    evidence: [
      { id: "c11-e1", name: "복제본 정밀 감정 자료", description: "종이 질감과 잉크 성분이 원본과 미묘하게 다른 복제본." },
      { id: "c11-e2", name: "복제 제작업체 영수증", description: "명우 명의로 결제된 정교한 고서 복제 제작 영수증.", photo: photo("receipt", "고서 복제 제작 영수증") },
      { id: "c11-e3", name: "창고 CCTV 스틸컷", description: "21시경 창고 안에서 두 사람의 실루엣.", photo: photo("corridor", "서점 창고 CCTV 스틸컷") },
      { id: "c11-e4", name: "해외 경매 등록 메일", description: "명우가 초판본을 해외 경매에 등록하려 준비한 메일 초안." },
      { id: "c11-e5", name: "낡은 서가 열쇠", description: "창고 서가를 열 때 쓰이는 낡은 열쇠 — 명우의 지문 검출.", photo: photo("keys", "서가 열쇠") },
    ],
    messages: [
      { id: "c11-m1", from: "명우", to: "복제 제작업체", time: "폐업 D-14", content: "표지 질감까지 원본이랑 똑같이 부탁드려요." },
      { id: "c11-m2", from: "명우", to: "해외 경매 담당자", time: "폐업 D-3", content: "물건 준비되는 대로 바로 사진 보내드릴게요." },
    ],
    testimonies: [
      { id: "c11-t1", witness: "명우", statement: "저는 창고엔 아예 들어가지도 않았어요, 그냥 카운터만 도왔어요.", contradictsWith: ["c11-t2"] },
      { id: "c11-t2", witness: "서점 주인", statement: "명우 씨가 정리를 돕겠다며 창고에 꽤 오래 있었어요.", contradictsWith: ["c11-t1"] },
    ],
    testimoniesLv3: [
      { id: "c11-t1", witness: "명우", statement: "저는 창고엔 아예 들어가지도 않았어요, 그냥 카운터만 도왔어요.", contradictsWith: ["c11-t2", "c11-t3"] },
      { id: "c11-t2", witness: "서점 주인", statement: "명우 씨가 정리를 돕겠다며 창고에 꽤 오래 있었어요.", contradictsWith: ["c11-t1"] },
      { id: "c11-t3", witness: "단골손님 나래", statement: "명우 씨는 그날 창고 쪽엔 얼씬도 안 했다고 저한테 말했어요.", contradictsWith: ["c11-t1"] },
    ],
    lockedEvidence: [
      {
        id: "c11-locked-1",
        name: "고서 감정 전문기관 정밀 감정서",
        unlockHint: "진품이 복제본으로 바꿔치기됐는지를 정확히 짚는 질문에서 초록불을 받아야 해금됩니다.",
        description: "고서 감정 전문기관의 정밀 분석 결과 — 서가에 남은 책은 최근 제작된 복제본이며, 원본의 특징적인 얼룩 패턴이 없다는 사실이 확인됐다.",
        photo: photo("documents", "고서 정밀 감정서"),
        unlockTriggerId: "c11-q3",
      },
    ],
  }),
  b({
    id: "c-12-night-bus",
    type: "B",
    difficultySupport: ["LV1", "LV2", "LV3"],
    title: "심야버스 종점 승객 실종",
    synopsis:
      "심야 시외버스 종점에서, 마지막까지 남아있던 승객 한 명이 사라졌다. 차량 블랙박스에는 버스가 종점까지 한 번도 서지 않은 것으로 기록돼 있는데, 정말 그럴까?",
    truth:
      "버스 기사 광수가 사전에 블랙박스 영상 일부를 미리 녹화해둔 반복 재생 구간으로 바꿔치기해, 실제로는 도중에 정차했던 사실을 숨겼다. 정차 구간에서 피해자와 요금 정산 문제로 다투다 피해자를 강제로 하차시켰다. 동기는 광수가 승차 요금을 몰래 착복해온 사실을 피해자가 알아챈 것이었다.",
    answerRequiredKeywordGroups: [
      { label: "범인", keywords: ["광수"] },
      { label: "트릭", keywords: ["블랙박스", "반복재생", "사전녹화"] },
      { label: "동기", keywords: ["요금", "착복", "횡령"] },
    ],
    questionBank: [
      { id: "c12-q1", sampleQuestion: "범인은 버스 기사 광수입니까?", keywords: ["광수"], verdict: "green", importance: 3 },
      { id: "c12-q2", sampleQuestion: "버스가 실제로 중간에 정차한 적이 있습니까?", keywords: ["정차", "멈춘"], verdict: "green", importance: 3 },
      { id: "c12-q3", sampleQuestion: "블랙박스 영상이 조작됐습니까?", keywords: ["블랙박스", "조작", "반복재생"], verdict: "green", importance: 3 },
      { id: "c12-q4", sampleQuestion: "동기는 요금 착복 사실을 들켜서입니까?", keywords: ["요금", "착복", "횡령"], verdict: "green", importance: 3 },
      { id: "c12-q5", sampleQuestion: "승객이 스스로 중간에 내렸습니까?", keywords: ["스스로 내렸", "자진 하차"], verdict: "red", importance: 1 },
      { id: "c12-q6", sampleQuestion: "다른 승객이 목격자입니까?", keywords: ["다른 승객", "목격"], verdict: "red", importance: 1 },
      { id: "c12-q7", sampleQuestion: "정차 구간에서 다툼이 있었습니까?", keywords: ["정차 구간", "다툼"], verdict: "green", importance: 2 },
      { id: "c12-q8", sampleQuestion: "회사 차원의 조직적 은폐입니까?", keywords: ["회사", "조직적 은폐"], verdict: "red", importance: 1 },
    ],
    timeline: [
      { time: "D-1", description: "광수가 미리 반복 재생용 블랙박스 구간을 준비." },
      { time: "당일 23:30", description: "심야버스 출발, 승객은 피해자 포함 2명뿐." },
      { time: "00:10", description: "한적한 구간에서 광수가 버스를 정차, 블랙박스를 반복 재생 구간으로 전환." },
      { time: "00:12", description: "요금 문제로 광수와 피해자가 다툼." },
      { time: "00:15", description: "광수가 피해자를 강제로 하차시킴." },
      { time: "00:40", description: "버스가 종점 도착, 피해자는 없음이 확인됨." },
    ],
    evidence: [
      { id: "c12-e1", name: "블랙박스 원본 저장장치", description: "복구 결과 00:10~00:15 구간이 이전 영상으로 덮어씌워진 흔적이 남은 저장장치.", photo: photo("computer-log", "블랙박스 저장장치 데이터 화면") },
      { id: "c12-e2", name: "정차 구간 CCTV(인근 상가)", description: "심야 버스가 정차한 것으로 보이는 인근 상가 CCTV.", photo: photo("car-night", "정차 구간 인근 야간 도로") },
      { id: "c12-e3", name: "요금 착복 내역 메모", description: "광수의 개인 수첩에서 발견된 요금 착복 기록." },
      { id: "c12-e4", name: "피해자의 항의 문자 초안", description: "회사에 요금 착복 의혹을 제보하려던 문자 초안." },
      { id: "c12-e5", name: "버스 정차 지점 표지판 사진", description: "블랙박스 조작 구간과 일치하는 도로 표지판.", photo: photo("broken-glass", "심야 도로변 표지판") },
    ],
    messages: [
      { id: "c12-m1", from: "피해자", to: "버스회사", time: "당일 오후", content: "요금 관련해서 확인할 게 있어서 내일 연락드릴게요." },
      { id: "c12-m2", from: "광수", to: "동료 기사", time: "당일 밤", content: "오늘 노선 좀 조용히 넘어가야 하는데." },
    ],
    testimonies: [
      { id: "c12-t1", witness: "광수", statement: "저는 종점까지 한 번도 안 서고 그대로 운행했어요.", contradictsWith: ["c12-t2"] },
      { id: "c12-t2", witness: "동료 기사 정우", statement: "그 시간대 무전으로 광수 씨가 잠깐 정차한다고 했던 게 기억나요.", contradictsWith: ["c12-t1"] },
    ],
    testimoniesLv3: [
      { id: "c12-t1", witness: "광수", statement: "저는 종점까지 한 번도 안 서고 그대로 운행했어요.", contradictsWith: ["c12-t2", "c12-t3"] },
      { id: "c12-t2", witness: "동료 기사 정우", statement: "그 시간대 무전으로 광수 씨가 잠깐 정차한다고 했던 게 기억나요.", contradictsWith: ["c12-t1"] },
      { id: "c12-t3", witness: "버스회사 관제팀", statement: "광수 기사님 차량은 그날 GPS상 정차 기록이 전혀 없었다고 들었어요.", contradictsWith: ["c12-t1"] },
    ],
    lockedEvidence: [
      {
        id: "c12-locked-1",
        name: "블랙박스 저장장치 포렌식 감정서",
        unlockHint: "버스가 실제로 중간에 정차한 적이 있었는지를 정확히 짚는 질문에서 초록불을 받아야 해금됩니다.",
        description: "디지털 포렌식 복구 결과 — 00:10~00:15 구간 영상이 이전 운행분으로 덮어씌워진 정황이 메타데이터에서 확인됐다.",
        photo: photo("documents", "블랙박스 포렌식 감정서"),
        unlockTriggerId: "c12-q2",
      },
    ],
  }),
  b({
    id: "c-13-ice-rink",
    type: "B",
    difficultySupport: ["LV1", "LV2", "LV3"],
    title: "아이스링크 쇼케이스 사고",
    synopsis:
      "피겨스케이팅 쇼케이스 리허설 도중, 신인 선수가 빙판 위에서 크게 넘어져 부상을 입었다. 단순 실수처럼 보였지만, 넘어진 지점의 얼음 상태가 유독 이상했다.",
    truth:
      "쇼케이스 기획사 대표 규현이 보험금을 노리고 피해자의 동선에 맞춰 빙판 특정 구간에 미세한 흠집을 내뒀다. 피해자가 그 구간에서 발이 걸려 넘어지도록 유도한 것이었다. 동기는 회사 자금난을 보험금으로 메우려던 것이었다.",
    answerRequiredKeywordGroups: [
      { label: "범인", keywords: ["규현"] },
      { label: "트릭", keywords: ["빙판", "흠집", "유도"] },
      { label: "동기", keywords: ["보험금", "자금난"] },
    ],
    questionBank: [
      { id: "c13-q1", sampleQuestion: "범인은 기획사 대표 규현입니까?", keywords: ["규현"], verdict: "green", importance: 3 },
      { id: "c13-q2", sampleQuestion: "빙판에 미리 흠집이 나 있었습니까?", keywords: ["흠집", "빙판"], verdict: "green", importance: 3 },
      { id: "c13-q3", sampleQuestion: "단순히 선수 본인의 실수였습니까?", keywords: ["본인 실수", "단순 실수"], verdict: "red", importance: 2 },
      { id: "c13-q4", sampleQuestion: "동기는 보험금을 노린 것입니까?", keywords: ["보험금"], verdict: "green", importance: 3 },
      { id: "c13-q5", sampleQuestion: "다른 선수가 질투로 저지른 일입니까?", keywords: ["다른 선수", "질투"], verdict: "red", importance: 1 },
      { id: "c13-q6", sampleQuestion: "제빙기 오작동이 원인입니까?", keywords: ["제빙기", "오작동"], verdict: "yellow", yellowDetail: "얼음 상태가 이상했던 건 맞지만 제빙기 오작동이 아니라 사람이 의도적으로 낸 흠집입니다.", importance: 2 },
      { id: "c13-q7", sampleQuestion: "규현이 회사 자금난을 겪고 있었습니까?", keywords: ["자금난"], verdict: "green", importance: 2 },
      { id: "c13-q8", sampleQuestion: "규현이 피해자의 동선을 미리 파악했습니까?", keywords: ["동선", "미리 파악"], verdict: "green", importance: 2 },
    ],
    timeline: [
      { time: "리허설 D-1", description: "규현이 회사 자금 상황을 확인하고 보험 계약 내용을 다시 검토." },
      { time: "당일 새벽", description: "규현이 빙판 관리 도구로 특정 구간에 미세한 흠집을 냄." },
      { time: "오전 리허설", description: "피해자가 정해진 동선대로 스케이팅." },
      { time: "리허설 중반", description: "피해자가 흠집 구간에서 발이 걸려 넘어짐." },
      { time: "직후", description: "응급처치 후 병원 이송." },
    ],
    evidence: [
      { id: "c13-e1", name: "빙판 흠집 정밀 사진", description: "넘어진 지점 인근 빙판에 남은 인위적인 흠집.", photo: photo("broken-glass", "빙판 표면 흠집 클로즈업") },
      { id: "c13-e2", name: "빙판 관리 도구", description: "새벽 시간대 사용 흔적이 있는 빙판 관리 도구." },
      { id: "c13-e3", name: "보험 계약서 사본", description: "피해자 앞으로 최근 새로 가입된 상해보험 계약서.", photo: photo("documents", "상해보험 계약서") },
      { id: "c13-e4", name: "회사 자금난 관련 내부 메모", description: "규현이 작성한 자금 압박 관련 내부 메모." },
      { id: "c13-e5", name: "새벽 출입 기록", description: "규현이 새벽 시간대 링크에 출입한 기록.", photo: photo("keypad", "링크 새벽 출입 기록") },
    ],
    messages: [
      { id: "c13-m1", from: "규현", to: "보험 설계사", time: "리허설 D-3", content: "그 선수 앞으로 상해보험 가입 진행해주세요, 최대한 빨리요." },
      { id: "c13-m2", from: "직원", to: "규현", time: "리허설 D-1", content: "대표님, 이번 달 자금 상황이 많이 안 좋아요." },
    ],
    testimonies: [
      { id: "c13-t1", witness: "규현", statement: "저는 새벽엔 링크 근처에도 안 갔어요, 집에 있었어요.", contradictsWith: ["c13-t2"] },
      { id: "c13-t2", witness: "야간 관리인", statement: "새벽에 규현 대표님 차가 링크 주차장에 있는 걸 봤어요.", contradictsWith: ["c13-t1"] },
    ],
    testimoniesLv3: [
      { id: "c13-t1", witness: "규현", statement: "저는 새벽엔 링크 근처에도 안 갔어요, 집에 있었어요.", contradictsWith: ["c13-t2", "c13-t3"] },
      { id: "c13-t2", witness: "야간 관리인", statement: "새벽에 규현 대표님 차가 링크 주차장에 있는 걸 봤어요.", contradictsWith: ["c13-t1"] },
      { id: "c13-t3", witness: "코치", statement: "규현 대표님은 그날 새벽엔 아예 링크에 올 일이 없었다고 들었어요.", contradictsWith: ["c13-t1"] },
    ],
    lockedEvidence: [
      {
        id: "c13-locked-1",
        name: "빙판 흠집 정밀 감정서",
        unlockHint: "빙판에 미리 흠집이 나 있었는지를 정확히 짚는 질문에서 초록불을 받아야 해금됩니다.",
        description: "빙상 전문가의 정밀 감정 결과 — 흠집은 제빙 과정에서 생길 수 없는 인위적인 도구 자국으로 확인됐다.",
        photo: photo("documents", "빙판 흠집 정밀 감정서"),
        unlockTriggerId: "c13-q2",
      },
    ],
  }),
  b({
    id: "c-14-lan-party",
    type: "B",
    difficultySupport: ["LV1", "LV2", "LV3"],
    title: "게임 LAN파티 우승자 논란",
    synopsis:
      "오프라인 게임 대회 결승전 직후, 우승이 유력했던 참가자의 세이브 파일에서 이상한 조작 흔적이 발견됐다는 신고가 접수됐다. 정작 신고 직후 그 참가자는 대회장 구석에서 정신을 잃은 채 발견됐다.",
    truth:
      "라이벌 참가자 유빈이 대회 전날 대회용 PC에 USB로 몰래 접근해 피해자의 세이브 파일 타임스탬프를 조작해뒀다. 결승 직후 피해자가 이를 눈치채고 항의하자 유빈이 몸싸움을 벌였다. 동기는 우승 상금과 프로팀 스카우트 제의를 가로채려는 것이었다.",
    answerRequiredKeywordGroups: [
      { label: "범인", keywords: ["유빈"] },
      { label: "트릭", keywords: ["세이브파일", "타임스탬프", "usb"] },
      { label: "동기", keywords: ["상금", "스카우트"] },
    ],
    questionBank: [
      { id: "c14-q1", sampleQuestion: "범인은 라이벌 참가자 유빈입니까?", keywords: ["유빈"], verdict: "green", importance: 3 },
      { id: "c14-q2", sampleQuestion: "세이브 파일을 조작한 사람은 피해자 본인입니까?", keywords: ["본인", "피해자 본인"], verdict: "red", importance: 2 },
      { id: "c14-q3", sampleQuestion: "USB로 세이브 파일 타임스탬프를 조작했습니까?", keywords: ["usb", "타임스탬프", "조작"], verdict: "green", importance: 3 },
      { id: "c14-q4", sampleQuestion: "동기는 우승 상금과 프로팀 스카우트 때문입니까?", keywords: ["상금", "스카우트"], verdict: "green", importance: 3 },
      { id: "c14-q5", sampleQuestion: "대회 운영진이 조작에 가담했습니까?", keywords: ["운영진", "가담"], verdict: "red", importance: 1 },
      { id: "c14-q6", sampleQuestion: "몸싸움이 있었습니까?", keywords: ["몸싸움"], verdict: "green", importance: 2 },
      { id: "c14-q7", sampleQuestion: "유빈이 대회 전날 대회용 PC에 접근했습니까?", keywords: ["전날", "pc", "접근"], verdict: "green", importance: 2 },
      { id: "c14-q8", sampleQuestion: "조작 흔적 신고 자체가 거짓 신고입니까?", keywords: ["거짓 신고"], verdict: "red", importance: 1 },
    ],
    timeline: [
      { time: "대회 D-1", description: "유빈이 USB로 대회용 PC에 접근해 세이브 파일을 조작." },
      { time: "결승전", description: "피해자 우승 확정." },
      { time: "결승 직후", description: "피해자가 세이브 파일 조작 흔적을 발견." },
      { time: "곧이어", description: "피해자가 항의하자 유빈과 몸싸움 발생." },
      { time: "몸싸움 직후", description: "피해자가 대회장 구석에서 발견됨." },
    ],
    evidence: [
      { id: "c14-e1", name: "대회용 PC 접속 로그", description: "대회 전날 유빈의 USB 기기 ID로 접속한 기록.", photo: photo("computer-log", "대회용 PC 접속 로그 화면") },
      { id: "c14-e2", name: "세이브 파일 타임스탬프 분석", description: "실제 플레이 시각과 어긋나는 세이브 파일 메타데이터." },
      { id: "c14-e3", name: "대회장 구석 CCTV 스틸컷", description: "몸싸움 직후로 추정되는 흐릿한 장면.", photo: photo("corridor", "대회장 구석 CCTV 스틸컷") },
      { id: "c14-e4", name: "프로팀 스카우트 제의 메일", description: "우승자에게 전달될 예정이던 프로팀 스카우트 제의 메일." },
      { id: "c14-e5", name: "유빈의 USB", description: "유빈의 가방에서 발견된 범용 USB 저장장치." },
    ],
    messages: [
      { id: "c14-m1", from: "유빈", to: "친구", time: "대회 D-1", content: "이번 대회 우승, 무조건 내가 가져가야 해." },
      { id: "c14-m2", from: "피해자", to: "유빈", time: "결승 직후", content: "이 세이브 파일 시간이 왜 이래? 얘기 좀 해." },
    ],
    testimonies: [
      { id: "c14-t1", witness: "유빈", statement: "저는 대회 전날 그 PC 근처엔 가지도 않았어요.", contradictsWith: ["c14-t2"] },
      { id: "c14-t2", witness: "대회 스태프", statement: "대회 전날 저녁 유빈 씨가 대회용 PC 앞에 앉아 있는 걸 봤어요.", contradictsWith: ["c14-t1"] },
    ],
    testimoniesLv3: [
      { id: "c14-t1", witness: "유빈", statement: "저는 대회 전날 그 PC 근처엔 가지도 않았어요.", contradictsWith: ["c14-t2", "c14-t3"] },
      { id: "c14-t2", witness: "대회 스태프", statement: "대회 전날 저녁 유빈 씨가 대회용 PC 앞에 앉아 있는 걸 봤어요.", contradictsWith: ["c14-t1"] },
      { id: "c14-t3", witness: "동료 참가자", statement: "유빈 씨는 대회 전날 저희랑 계속 같이 숙소에 있었다고 하던데요.", contradictsWith: ["c14-t1"] },
    ],
    lockedEvidence: [
      {
        id: "c14-locked-1",
        name: "PC 접속 기록 포렌식 감정서",
        unlockHint: "USB로 세이브 파일을 조작했는지를 정확히 짚는 질문에서 초록불을 받아야 해금됩니다.",
        description: "디지털 포렌식 감정 결과 — 대회 전날 유빈의 USB 기기 ID가 대회용 PC 접속 로그에 명확히 남아 있었다.",
        photo: photo("documents", "PC 접속 기록 포렌식 감정서"),
        unlockTriggerId: "c14-q3",
      },
    ],
  }),
  b({
    id: "c-15-photo-studio",
    type: "B",
    difficultySupport: ["LV1", "LV2", "LV3"],
    title: "사진관 마지막 촬영",
    synopsis:
      "동네 사진관의 마지막 촬영일, 오래 일한 스튜디오 실장이 암실에서 쓰러진 채 발견됐다. 곧이어 실장이 고객 사진을 조작해왔다는 소문이 퍼졌는데, 정작 소문의 근거가 된 사진 자체가 수상하다.",
    truth:
      "후배 작가 도윤이 실장의 자리를 노리고, 실장이 촬영한 사진 파일을 정교하게 합성해 '조작 증거'처럼 보이는 가짜 사진을 만들어 퍼뜨렸다. 실장이 이를 알아채고 추궁하자 암실에서 몸싸움이 벌어졌다. 동기는 도윤이 사진관 후계자 자리를 차지하려는 것이었다.",
    answerRequiredKeywordGroups: [
      { label: "범인", keywords: ["도윤"] },
      { label: "트릭", keywords: ["합성", "가짜사진", "조작"] },
      { label: "동기", keywords: ["후계자", "자리"] },
    ],
    questionBank: [
      { id: "c15-q1", sampleQuestion: "범인은 후배 작가 도윤입니까?", keywords: ["도윤"], verdict: "green", importance: 3 },
      { id: "c15-q2", sampleQuestion: "실장이 정말 사진을 조작해왔습니까?", keywords: ["실장이 조작", "실장 조작"], verdict: "red", importance: 2 },
      { id: "c15-q3", sampleQuestion: "소문의 근거가 된 사진 자체가 합성된 것입니까?", keywords: ["합성", "가짜사진"], verdict: "green", importance: 3 },
      { id: "c15-q4", sampleQuestion: "동기는 사진관 후계자 자리를 노려서입니까?", keywords: ["후계자", "자리"], verdict: "green", importance: 3 },
      { id: "c15-q5", sampleQuestion: "고객이 항의하러 왔다가 벌어진 일입니까?", keywords: ["고객", "항의"], verdict: "red", importance: 1 },
      { id: "c15-q6", sampleQuestion: "암실에서 몸싸움이 있었습니까?", keywords: ["암실", "몸싸움"], verdict: "green", importance: 2 },
      { id: "c15-q7", sampleQuestion: "도윤이 합성 프로그램을 사용한 흔적이 있습니까?", keywords: ["합성 프로그램", "편집"], verdict: "green", importance: 2 },
      { id: "c15-q8", sampleQuestion: "실장이 스스로 소문을 냈습니까?", keywords: ["스스로 소문"], verdict: "red", importance: 1 },
    ],
    timeline: [
      { time: "D-5", description: "도윤이 실장의 사진 파일을 몰래 확보." },
      { time: "D-3", description: "도윤이 합성 프로그램으로 가짜 '조작 증거' 사진 제작." },
      { time: "D-1", description: "가짜 사진이 SNS를 통해 조용히 퍼짐." },
      { time: "마지막 촬영일 저녁", description: "실장이 소문의 근원을 추적하다 도윤을 의심." },
      { time: "직후", description: "암실에서 두 사람 몸싸움." },
      { time: "20분 후", description: "다른 직원이 암실에서 쓰러진 실장을 발견." },
    ],
    evidence: [
      { id: "c15-e1", name: "합성 사진 원본 레이어 파일", description: "도윤의 컴퓨터에서 발견된, 합성 과정이 그대로 남은 편집 파일.", photo: photo("computer-log", "사진 합성 편집 파일 화면") },
      { id: "c15-e2", name: "암실 CCTV 스틸컷", description: "몸싸움 직전 두 사람이 암실로 들어가는 장면.", photo: photo("corridor", "암실 앞 CCTV 스틸컷") },
      { id: "c15-e3", name: "후계자 논의 내부 메모", description: "사진관 후계자 후보로 도윤과 실장이 함께 거론된 메모." },
      { id: "c15-e4", name: "SNS 유포 계정 접속 기록", description: "가짜 사진을 처음 올린 익명 계정의 접속 IP 기록." },
      { id: "c15-e5", name: "실장의 원본 촬영 파일", description: "조작되지 않은 실제 원본 사진 파일." },
    ],
    messages: [
      { id: "c15-m1", from: "도윤", to: "익명 계정", time: "D-3", content: "이거면 확실히 소문 퍼질 거예요, 조용히 올려주세요." },
      { id: "c15-m2", from: "실장", to: "도윤", time: "마지막 촬영일 저녁", content: "이 사진 어디서 난 건지 얘기 좀 해야겠는데." },
    ],
    testimonies: [
      { id: "c15-t1", witness: "도윤", statement: "저는 그 사진에 대해 전혀 아는 게 없어요.", contradictsWith: ["c15-t2"] },
      { id: "c15-t2", witness: "동료 직원 서아", statement: "도윤 씨가 며칠 전부터 컴퓨터로 뭔가 계속 편집하고 있던 게 기억나요.", contradictsWith: ["c15-t1"] },
    ],
    testimoniesLv3: [
      { id: "c15-t1", witness: "도윤", statement: "저는 그 사진에 대해 전혀 아는 게 없어요.", contradictsWith: ["c15-t2", "c15-t3"] },
      { id: "c15-t2", witness: "동료 직원 서아", statement: "도윤 씨가 며칠 전부터 컴퓨터로 뭔가 계속 편집하고 있던 게 기억나요.", contradictsWith: ["c15-t1"] },
      { id: "c15-t3", witness: "단골손님", statement: "도윤 작가님은 요즘 컴퓨터 작업을 거의 안 하신다고 들었어요.", contradictsWith: ["c15-t1"] },
    ],
    lockedEvidence: [
      {
        id: "c15-locked-1",
        name: "이미지 포렌식 정밀 감정서",
        unlockHint: "소문의 근거가 된 사진이 합성됐는지를 정확히 짚는 질문에서 초록불을 받아야 해금됩니다.",
        description: "이미지 포렌식 전문가의 정밀 분석 결과 — 문제의 사진에서 명백한 합성 경계선과 편집 프로그램 메타데이터가 검출됐다.",
        photo: photo("documents", "이미지 포렌식 정밀 감정서"),
        unlockTriggerId: "c15-q3",
      },
    ],
  }),
  b({
    id: "c-16-hot-spring-inn",
    type: "B",
    difficultySupport: ["LV1", "LV2", "LV3"],
    title: "온천 여관 심야 정전",
    synopsis:
      "산속 온천 여관에 묵던 단체 손님 중 한 명이 한밤중 정전 사이 계단에서 굴러떨어져 발견됐다. 정전은 낙뢰 때문이라는 여관 측 설명과 달리, 그날은 날씨가 맑았다.",
    truth:
      "동행자 중 한 명인 세진이 스마트 차단기 앱으로 원격으로 여관 전체 전원을 차단한 뒤, 어둠을 틈타 피해자를 계단에서 밀었다. 동기는 세진이 피해자와 함께 진행하던 동업 사업에서 피해자 몫의 지분을 독차지하려던 것이었다.",
    answerRequiredKeywordGroups: [
      { label: "범인", keywords: ["세진"] },
      { label: "트릭", keywords: ["스마트차단기", "원격", "정전"] },
      { label: "동기", keywords: ["지분", "동업", "독차지"] },
    ],
    questionBank: [
      { id: "c16-q1", sampleQuestion: "범인은 동행자 세진입니까?", keywords: ["세진"], verdict: "green", importance: 3 },
      { id: "c16-q2", sampleQuestion: "정전은 낙뢰 때문입니까?", keywords: ["낙뢰"], verdict: "red", importance: 2 },
      { id: "c16-q3", sampleQuestion: "정전은 스마트 차단기 앱으로 원격 조작된 것입니까?", keywords: ["스마트차단기", "원격"], verdict: "green", importance: 3 },
      { id: "c16-q4", sampleQuestion: "동기는 동업 지분을 독차지하기 위해서입니까?", keywords: ["지분", "동업", "독차지"], verdict: "green", importance: 3 },
      { id: "c16-q5", sampleQuestion: "여관 직원이 실수로 차단기를 내렸습니까?", keywords: ["직원 실수", "여관 직원"], verdict: "red", importance: 1 },
      { id: "c16-q6", sampleQuestion: "피해자가 어둠 속에서 스스로 헛디뎠습니까?", keywords: ["헛디뎠", "스스로"], verdict: "yellow", yellowDetail: "계단에서 발을 헛디딘 건 맞지만 '스스로'가 아니라 어둠 속에서 세진에게 떠밀린 것입니다.", importance: 2 },
      { id: "c16-q7", sampleQuestion: "세진이 사건 전날 차단기 앱 접근 권한을 확보했습니까?", keywords: ["앱 접근", "권한", "전날"], verdict: "green", importance: 2 },
      { id: "c16-q8", sampleQuestion: "낙뢰가 실제로 그날 있었습니까?", keywords: ["낙뢰 실제", "그날 낙뢰"], verdict: "red", importance: 1 },
    ],
    timeline: [
      { time: "D-1", description: "세진이 여관 스마트 차단기 앱 관리자 권한을 몰래 확보." },
      { time: "당일 22:00", description: "단체 손님 온천욕 후 취침 준비." },
      { time: "22:40", description: "세진이 스마트폰으로 여관 전체 전원을 원격 차단." },
      { time: "22:41", description: "어둠 속에서 세진이 계단 근처의 피해자를 밀침." },
      { time: "22:50", description: "여관 직원이 정전을 확인, 낙뢰로 추정해 복구 작업." },
      { time: "23:00", description: "다른 손님이 계단 아래에서 쓰러진 피해자를 발견." },
    ],
    evidence: [
      { id: "c16-e1", name: "스마트 차단기 앱 로그", description: "22:40 세진의 계정으로 원격 차단 명령이 실행된 기록.", photo: photo("computer-log", "스마트 차단기 앱 로그 화면") },
      { id: "c16-e2", name: "계단 손전등", description: "세진의 가방에서 발견된, 정전 직후 사용된 흔적이 있는 손전등.", photo: photo("flashlight", "계단에서 발견된 손전등") },
      { id: "c16-e3", name: "동업 계약서 사본", description: "세진과 피해자의 지분 배분이 명시된 동업 계약서.", photo: photo("documents", "동업 계약서 사본") },
      { id: "c16-e4", name: "기상 관측 자료", description: "사건 당일 인근 지역 낙뢰 관측 기록 없음을 보여주는 자료." },
      { id: "c16-e5", name: "계단 난간 지문", description: "계단 난간 부근에서 발견된 두 사람 분의 지문.", photo: photo("fingerprint", "계단 난간 지문 채취") },
    ],
    messages: [
      { id: "c16-m1", from: "세진", to: "동업 담당 변호사", time: "D-2", content: "지분 정리, 이번 여행 다녀와서 확실히 마무리하죠." },
      { id: "c16-m2", from: "피해자", to: "세진", time: "당일 낮", content: "지분 얘기는 우리 둘이 다시 한번 얘기해봐야 할 것 같아." },
    ],
    testimonies: [
      { id: "c16-t1", witness: "세진", statement: "저는 정전 내내 방에서 꼼짝도 안 했어요.", contradictsWith: ["c16-t2"] },
      { id: "c16-t2", witness: "다른 투숙객", statement: "정전 직후에 세진 씨가 손전등을 들고 복도로 나가는 걸 봤어요.", contradictsWith: ["c16-t1"] },
    ],
    testimoniesLv3: [
      { id: "c16-t1", witness: "세진", statement: "저는 정전 내내 방에서 꼼짝도 안 했어요.", contradictsWith: ["c16-t2", "c16-t3"] },
      { id: "c16-t2", witness: "다른 투숙객", statement: "정전 직후에 세진 씨가 손전등을 들고 복도로 나가는 걸 봤어요.", contradictsWith: ["c16-t1"] },
      { id: "c16-t3", witness: "여관 직원", statement: "세진 손님은 정전 이후로 계속 로비에 앉아 계셨다고 들었어요.", contradictsWith: ["c16-t1"] },
    ],
    lockedEvidence: [
      {
        id: "c16-locked-1",
        name: "스마트 차단기 앱 포렌식 감정서",
        unlockHint: "정전이 원격으로 조작된 것인지를 정확히 짚는 질문에서 초록불을 받아야 해금됩니다.",
        description: "앱 서비스 업체 협조로 확보한 포렌식 로그 — 22:40 세진 계정에서 원격 차단 명령이 전송된 사실이 명확히 확인됐다.",
        photo: photo("documents", "스마트 차단기 앱 포렌식 감정서"),
        unlockTriggerId: "c16-q3",
      },
    ],
  }),
  b({
    id: "c-17-karaoke-room",
    type: "B",
    difficultySupport: ["LV1", "LV2", "LV3"],
    title: "노래방 개인실 마이크 사건",
    synopsis:
      "회사 회식 후 2차 노래방에서, 팀장 한 명이 개인실 소파에 쓰러진 채 발견됐다. 그 방엔 팀장과 신입사원 단둘뿐이었다는데, 신입사원은 자신도 잠깐 졸았을 뿐이라고 주장한다.",
    truth:
      "동료 대리 채원이 미리 그 방의 리모컨 뒤에 소형 녹음기를 숨겨뒀었는데, 팀장이 회식 중 부적절한 발언을 한 사실을 알고 몰래 방에 들어와 녹음기를 회수하려다 팀장에게 들켰다. 몸싸움 끝에 팀장이 소파에 부딪혀 쓰러졌다. 동기는 채원이 그 녹음 파일로 팀장을 압박해 인사고과를 유리하게 받으려던 것이었다.",
    answerRequiredKeywordGroups: [
      { label: "범인", keywords: ["채원"] },
      { label: "트릭", keywords: ["녹음기", "리모컨", "숨겨"] },
      { label: "동기", keywords: ["인사고과", "압박", "협박"] },
    ],
    questionBank: [
      { id: "c17-q1", sampleQuestion: "범인은 동료 대리 채원입니까?", keywords: ["채원"], verdict: "green", importance: 3 },
      { id: "c17-q2", sampleQuestion: "신입사원이 졸다가 실수로 부딪힌 것입니까?", keywords: ["신입사원", "졸다가"], verdict: "red", importance: 2 },
      { id: "c17-q3", sampleQuestion: "방 안에 몰래 숨겨둔 녹음기가 있었습니까?", keywords: ["녹음기", "숨겨"], verdict: "green", importance: 3 },
      { id: "c17-q4", sampleQuestion: "동기는 녹음 파일로 인사고과를 압박하려던 것입니까?", keywords: ["인사고과", "압박", "협박"], verdict: "green", importance: 3 },
      { id: "c17-q5", sampleQuestion: "채원이 녹음기를 회수하러 방에 들어왔습니까?", keywords: ["회수", "들어와"], verdict: "green", importance: 2 },
      { id: "c17-q6", sampleQuestion: "노래방 직원이 관련돼 있습니까?", keywords: ["노래방 직원"], verdict: "red", importance: 1 },
      { id: "c17-q7", sampleQuestion: "팀장이 술에 취해 혼자 넘어졌습니까?", keywords: ["혼자 넘어", "술에 취해"], verdict: "yellow", yellowDetail: "소파에 부딪힌 건 맞지만 '혼자'가 아니라 몸싸움 중에 벌어진 일입니다.", importance: 2 },
      { id: "c17-q8", sampleQuestion: "채원이 사건 며칠 전 그 방을 미리 예약해 녹음기를 설치했습니까?", keywords: ["미리 예약", "설치"], verdict: "green", importance: 2 },
    ],
    timeline: [
      { time: "회식 D-3", description: "채원이 같은 노래방 방을 미리 예약해 리모컨 뒤에 녹음기를 설치." },
      { time: "회식 당일", description: "팀원 전체가 그 방으로 2차 이동." },
      { time: "회식 중", description: "팀장이 부적절한 발언, 녹음기에 그대로 기록됨." },
      { time: "1차 인원 귀가 후", description: "채원이 녹음기를 회수하러 몰래 방에 들어옴." },
      { time: "직후", description: "팀장에게 들켜 몸싸움, 팀장이 소파에 부딪힘." },
      { time: "10분 후", description: "신입사원이 화장실에서 돌아와 쓰러진 팀장을 발견." },
    ],
    evidence: [
      { id: "c17-e1", name: "리모컨 뒤 소형 녹음기", description: "노래방 리모컨 뒷면에 테이프로 고정돼 있던 소형 녹음기." },
      { id: "c17-e2", name: "노래방 복도 CCTV 스틸컷", description: "1차 인원 귀가 후 복도에서 포착된 인영.", photo: photo("corridor", "노래방 복도 CCTV 스틸컷") },
      { id: "c17-e3", name: "사전 예약 영수증", description: "채원 명의로 사건 며칠 전 같은 방을 예약한 영수증.", photo: photo("receipt", "노래방 사전 예약 영수증") },
      { id: "c17-e4", name: "녹음 파일 일부 복구본", description: "팀장의 부적절한 발언이 담긴 녹음 파일 일부." },
      { id: "c17-e5", name: "채원의 인사고과 관련 메모", description: "다가오는 인사평가 시즌을 앞둔 채원의 개인 메모." },
    ],
    messages: [
      { id: "c17-m1", from: "채원", to: "친구", time: "회식 D-3", content: "이번엔 확실한 걸 하나 준비해뒀어." },
      { id: "c17-m2", from: "팀장", to: "채원", time: "몸싸움 직후", content: "(발신 실패 — 팀장 휴대폰이 소파 아래에서 발견됨)" },
    ],
    testimonies: [
      { id: "c17-t1", witness: "채원", statement: "저는 1차 끝나고 바로 집에 갔어요, 2차 방엔 간 적도 없어요.", contradictsWith: ["c17-t2"] },
      { id: "c17-t2", witness: "노래방 카운터 직원", statement: "1차 인원 나가고 얼마 안 돼서 채원 씨가 다시 들어오는 걸 봤어요.", contradictsWith: ["c17-t1"] },
    ],
    testimoniesLv3: [
      { id: "c17-t1", witness: "채원", statement: "저는 1차 끝나고 바로 집에 갔어요, 2차 방엔 간 적도 없어요.", contradictsWith: ["c17-t2", "c17-t3"] },
      { id: "c17-t2", witness: "노래방 카운터 직원", statement: "1차 인원 나가고 얼마 안 돼서 채원 씨가 다시 들어오는 걸 봤어요.", contradictsWith: ["c17-t1"] },
      { id: "c17-t3", witness: "동료 사원", statement: "채원 씨는 1차 끝나고 계속 저희랑 택시를 기다리고 있었다고 들었어요.", contradictsWith: ["c17-t1"] },
    ],
    lockedEvidence: [
      {
        id: "c17-locked-1",
        name: "녹음기 회수 CCTV 포렌식 감정서",
        unlockHint: "방 안에 몰래 숨겨둔 녹음기가 있었는지를 정확히 짚는 질문에서 초록불을 받아야 해금됩니다.",
        description: "복도 CCTV 화질 복원 감정서 — 재입장한 인물의 체형과 옷차림이 채원과 일치한다는 분석 결과가 담겼다.",
        photo: photo("documents", "CCTV 포렌식 감정서"),
        unlockTriggerId: "c17-q3",
      },
    ],
  }),
  b({
    id: "c-18-flower-shop",
    type: "B",
    difficultySupport: ["LV1", "LV2", "LV3"],
    title: "플라워샵 발렌타인 대목",
    synopsis:
      "발렌타인데이를 앞둔 대목, 인기 플라워샵 사장이 작업실에서 쓰러진 채 발견됐다. 마침 그날 완성된 특별 주문 꽃다발 하나가 사라지고 없다.",
    truth:
      "직원 라은이 경쟁 플라워샵에 레시피를 넘기기로 하고, 사장이 개발한 특제 보존액 레시피가 담긴 꽃다발을 훔치려 했다. 사장이 작업실에 들어와 이를 목격하자 라은이 밀치고 도망쳤는데, 그 과정에서 사장이 관엽식물 화분에 부딪혀 쓰러졌다. 동기는 라은이 경쟁 업체로부터 거액의 이직 조건을 제안받은 것이었다.",
    answerRequiredKeywordGroups: [
      { label: "범인", keywords: ["라은"] },
      { label: "트릭", keywords: ["보존액", "레시피", "꽃다발"] },
      { label: "동기", keywords: ["이직", "경쟁업체", "제안"] },
    ],
    questionBank: [
      { id: "c18-q1", sampleQuestion: "범인은 직원 라은입니까?", keywords: ["라은"], verdict: "green", importance: 3 },
      { id: "c18-q2", sampleQuestion: "사라진 꽃다발 자체가 목적이었습니까?", keywords: ["꽃다발이 목적", "꽃다발 자체"], verdict: "yellow", yellowDetail: "꽃다발을 노린 건 맞지만 꽃 자체가 아니라 그 안에 담긴 특제 보존액 레시피가 진짜 목적이었습니다.", importance: 2 },
      { id: "c18-q3", sampleQuestion: "특제 보존액 레시피를 훔치려 한 것입니까?", keywords: ["보존액", "레시피"], verdict: "green", importance: 3 },
      { id: "c18-q4", sampleQuestion: "동기는 경쟁 업체로 이직하기 위해서입니까?", keywords: ["이직", "경쟁업체", "제안"], verdict: "green", importance: 3 },
      { id: "c18-q5", sampleQuestion: "손님이 실수로 화분을 넘어뜨린 것입니까?", keywords: ["손님", "화분 넘어"], verdict: "red", importance: 1 },
      { id: "c18-q6", sampleQuestion: "사장이 라은을 목격하고 밀쳐졌습니까?", keywords: ["목격", "밀쳐"], verdict: "green", importance: 2 },
      { id: "c18-q7", sampleQuestion: "라은이 경쟁 업체와 사전에 접촉했습니까?", keywords: ["사전 접촉", "경쟁 업체"], verdict: "green", importance: 2 },
      { id: "c18-q8", sampleQuestion: "사장이 지병으로 쓰러졌습니까?", keywords: ["지병"], verdict: "red", importance: 1 },
    ],
    timeline: [
      { time: "대목 D-5", description: "라은이 경쟁 플라워샵으로부터 이직 제안을 받음." },
      { time: "대목 D-1", description: "라은이 레시피를 넘기기로 합의." },
      { time: "당일 저녁", description: "라은이 특별 주문 꽃다발째로 레시피를 빼돌리려 작업실에 접근." },
      { time: "직후", description: "사장이 작업실에 들어와 목격, 라은이 밀치고 도망." },
      { time: "그 순간", description: "사장이 관엽식물 화분에 부딪혀 쓰러짐." },
      { time: "20분 후", description: "다른 직원이 작업실에서 사장을 발견." },
    ],
    evidence: [
      { id: "c18-e1", name: "쓰러진 관엽식물 화분", description: "작업실 바닥에 쓰러진 채 발견된 큰 화분 — 몸싸움 중 부딪혀 한쪽이 깨졌다.", photo: photo("broken-pot", "몸싸움 중 깨진 화분") },
      { id: "c18-e2", name: "특제 보존액 배합 노트", description: "사장이 직접 개발한 보존액 배합 비율이 적힌 노트.", photo: photo("handwriting", "특제 보존액 배합 노트") },
      { id: "c18-e3", name: "경쟁 업체 이직 제안서", description: "라은에게 전달된 거액의 이직 조건 제안서.", photo: photo("documents", "이직 조건 제안서") },
      { id: "c18-e4", name: "작업실 CCTV 스틸컷", description: "사건 시각 작업실 입구를 드나드는 인영.", photo: photo("corridor", "플라워샵 작업실 CCTV 스틸컷") },
      { id: "c18-e5", name: "라은의 이직 계약금 입금 내역", description: "경쟁 업체로부터 미리 입금된 계약금 내역.", photo: photo("financial-doc", "이직 계약금 입금 내역") },
    ],
    messages: [
      { id: "c18-m1", from: "경쟁업체 담당자", to: "라은", time: "대목 D-5", content: "그 레시피만 확실하면 계약금 바로 넣어드릴게요." },
      { id: "c18-m2", from: "라은", to: "친구", time: "대목 D-1", content: "오늘 밤 안에 확실히 끝내야 해." },
    ],
    testimonies: [
      { id: "c18-t1", witness: "라은", statement: "저는 그날 저녁엔 이미 퇴근하고 없었어요.", contradictsWith: ["c18-t2"] },
      { id: "c18-t2", witness: "동료 직원 미소", statement: "저녁 무렵 라은 씨가 작업실 쪽에서 급히 나오는 걸 봤어요.", contradictsWith: ["c18-t1"] },
    ],
    testimoniesLv3: [
      { id: "c18-t1", witness: "라은", statement: "저는 그날 저녁엔 이미 퇴근하고 없었어요.", contradictsWith: ["c18-t2", "c18-t3"] },
      { id: "c18-t2", witness: "동료 직원 미소", statement: "저녁 무렵 라은 씨가 작업실 쪽에서 급히 나오는 걸 봤어요.", contradictsWith: ["c18-t1"] },
      { id: "c18-t3", witness: "단골손님", statement: "라은 씨는 그날 일찍 퇴근한다고 저한테 인사까지 하고 갔는데요.", contradictsWith: ["c18-t1"] },
    ],
    lockedEvidence: [
      {
        id: "c18-locked-1",
        name: "이직 계약 정황 감정서",
        unlockHint: "특제 보존액 레시피를 노렸는지를 정확히 짚는 질문에서 초록불을 받아야 해금됩니다.",
        description: "경쟁 업체와의 계약 정황을 정리한 감정서 — 라은이 넘기기로 한 자료 목록에 '보존액 배합 비율'이 명시돼 있었다.",
        photo: photo("documents", "이직 계약 정황 감정서"),
        unlockTriggerId: "c18-q3",
      },
    ],
  }),
  b({
    id: "c-19-auction-house",
    type: "B",
    difficultySupport: ["LV1", "LV2", "LV3"],
    title: "경매장 서명 위조 소동",
    synopsis:
      "유명 작가의 친필 서명본 경매를 앞두고, 감정을 맡았던 직원이 창고에서 쓰러진 채 발견됐다. 그가 마지막으로 감정하던 서명본이 진품인지 위조인지에 대한 소문이 무성하다.",
    truth:
      "경매장 큐레이터 지호가 진품 서명본을 미리 빼돌리고, 정교하게 위조한 서명본을 감정 목록에 끼워 넣었다. 감정 직원이 필적 대조 중 미세한 차이를 발견하고 추궁하자 지호가 몸싸움 끝에 창고 선반으로 밀쳤다. 동기는 진품을 해외 개인 컬렉터에게 몰래 고가로 팔아넘기려는 것이었다.",
    answerRequiredKeywordGroups: [
      { label: "범인", keywords: ["지호"] },
      { label: "트릭", keywords: ["위조서명", "바꿔치기"] },
      { label: "동기", keywords: ["컬렉터", "밀매", "판매"] },
    ],
    questionBank: [
      { id: "c19-q1", sampleQuestion: "범인은 큐레이터 지호입니까?", keywords: ["지호"], verdict: "green", importance: 3 },
      { id: "c19-q2", sampleQuestion: "감정 목록의 서명본이 진품입니까?", keywords: ["진품", "감정목록"], verdict: "red", importance: 2 },
      { id: "c19-q3", sampleQuestion: "위조 서명본을 진품 자리에 끼워 넣었습니까?", keywords: ["위조서명", "바꿔치기"], verdict: "green", importance: 3 },
      { id: "c19-q4", sampleQuestion: "동기는 진품을 해외 컬렉터에게 팔기 위해서입니까?", keywords: ["컬렉터", "밀매", "판매"], verdict: "green", importance: 3 },
      { id: "c19-q5", sampleQuestion: "감정 직원이 실수로 서명본을 훼손했습니까?", keywords: ["직원 실수", "훼손"], verdict: "red", importance: 1 },
      { id: "c19-q6", sampleQuestion: "감정 직원이 필적 차이를 발견했습니까?", keywords: ["필적 차이", "발견"], verdict: "green", importance: 2 },
      { id: "c19-q7", sampleQuestion: "경매 대행사가 조직적으로 가담했습니까?", keywords: ["대행사", "조직적"], verdict: "red", importance: 1 },
      { id: "c19-q8", sampleQuestion: "지호가 위조본을 미리 준비해뒀습니까?", keywords: ["위조본 준비", "미리"], verdict: "green", importance: 2 },
    ],
    timeline: [
      { time: "경매 D-10", description: "지호가 위조 서명본 제작을 의뢰." },
      { time: "경매 D-2", description: "지호가 진품을 위조본으로 바꿔치기해 감정 목록에 등록." },
      { time: "경매 D-1", description: "감정 직원이 필적 대조 중 미세한 차이를 발견." },
      { time: "직후", description: "감정 직원이 지호를 추궁." },
      { time: "곧이어", description: "창고에서 몸싸움, 직원이 선반에 부딪힘." },
      { time: "30분 후", description: "다른 직원이 창고에서 쓰러진 감정 직원을 발견." },
    ],
    evidence: [
      { id: "c19-e1", name: "위조 서명본 필적 대조 자료", description: "진품과 미세하게 다른 필압이 확인된 서명 대조 자료.", photo: photo("handwriting", "서명 필적 대조 자료") },
      { id: "c19-e2", name: "위조 제작업체 결제 내역", description: "지호 명의로 결제된 정교한 위조 서명본 제작 대금.", photo: photo("financial-doc", "위조 제작업체 결제 내역") },
      { id: "c19-e3", name: "창고 CCTV 스틸컷", description: "몸싸움 직전 창고 안 두 사람의 실루엣.", photo: photo("corridor", "경매장 창고 CCTV 스틸컷") },
      { id: "c19-e4", name: "해외 컬렉터와의 협상 메일", description: "지호가 진품을 은밀히 판매하기 위해 주고받은 메일." },
      { id: "c19-e5", name: "창고 열쇠", description: "창고 선반 인근에서 발견된 지호의 열쇠 꾸러미.", photo: photo("keys", "창고 열쇠 꾸러미") },
    ],
    messages: [
      { id: "c19-m1", from: "지호", to: "해외 컬렉터", time: "경매 D-8", content: "진품 확보되는 대로 바로 사진 보내드릴게요." },
      { id: "c19-m2", from: "감정 직원", to: "지호", time: "경매 D-1", content: "이 서명, 필압이 좀 이상한데 같이 다시 확인해볼까요?" },
    ],
    testimonies: [
      { id: "c19-t1", witness: "지호", statement: "저는 그 시각 사무실에서 계속 서류 작업만 했어요.", contradictsWith: ["c19-t2"] },
      { id: "c19-t2", witness: "경비원", statement: "그 시간대 지호 씨가 창고 쪽으로 들어가는 걸 봤어요.", contradictsWith: ["c19-t1"] },
    ],
    testimoniesLv3: [
      { id: "c19-t1", witness: "지호", statement: "저는 그 시각 사무실에서 계속 서류 작업만 했어요.", contradictsWith: ["c19-t2", "c19-t3"] },
      { id: "c19-t2", witness: "경비원", statement: "그 시간대 지호 씨가 창고 쪽으로 들어가는 걸 봤어요.", contradictsWith: ["c19-t1"] },
      { id: "c19-t3", witness: "동료 큐레이터", statement: "지호 씨는 그 시간 계속 저랑 같이 사무실에 있었다고 들었어요.", contradictsWith: ["c19-t1"] },
    ],
    lockedEvidence: [
      {
        id: "c19-locked-1",
        name: "필적 정밀 감정서",
        unlockHint: "위조 서명본이 진품 자리에 끼워 넣어졌는지를 정확히 짚는 질문에서 초록불을 받아야 해금됩니다.",
        description: "필적 감정 전문가의 정밀 분석 결과 — 감정 목록의 서명은 필압과 잉크 성분에서 진품과 명백한 차이를 보였다.",
        photo: photo("documents", "필적 정밀 감정서"),
        unlockTriggerId: "c19-q3",
      },
    ],
  }),
  b({
    id: "c-20-pet-hotel",
    type: "B",
    difficultySupport: ["LV1", "LV2", "LV3"],
    title: "반려동물 호텔 야간 실종",
    synopsis:
      "고급 반려동물 호텔에 맡겨진 손님의 반려견이 한밤중 우리에서 사라졌다. CCTV상 우리 문은 그대로 잠긴 채였는데, 강아지는 대체 어디로 간 걸까?",
    truth:
      "야간 관리 직원 우진이 낮 동안 반려견 산책 중 목줄을 놓쳐 잃어버렸는데, 이를 숨기기 위해 CCTV 저장장치의 해당 구간을 지우고 우리 문이 원래부터 잠긴 채였던 것처럼 위장했다. 동기는 관리 부실 책임을 지고 해고당하는 걸 피하려던 것이었다.",
    answerRequiredKeywordGroups: [
      { label: "범인", keywords: ["우진"] },
      { label: "트릭", keywords: ["목줄", "산책중분실", "cctv삭제"] },
      { label: "동기", keywords: ["해고", "책임회피"] },
    ],
    questionBank: [
      { id: "c20-q1", sampleQuestion: "이 상황을 만든 사람은 야간 관리 직원 우진입니까?", keywords: ["우진"], verdict: "green", importance: 3 },
      { id: "c20-q2", sampleQuestion: "강아지가 우리 안에서 사라진 것입니까?", keywords: ["우리 안에서", "우리 안 사라"], verdict: "red", importance: 2 },
      { id: "c20-q3", sampleQuestion: "낮 산책 중에 목줄을 놓쳐 잃어버린 것입니까?", keywords: ["목줄", "산책중"], verdict: "green", importance: 3 },
      { id: "c20-q4", sampleQuestion: "CCTV 영상이 삭제됐습니까?", keywords: ["cctv", "삭제"], verdict: "green", importance: 2 },
      { id: "c20-q5", sampleQuestion: "동기는 해고를 피하려는 책임 회피입니까?", keywords: ["해고", "책임회피"], verdict: "green", importance: 3 },
      { id: "c20-q6", sampleQuestion: "다른 손님이 실수로 우리를 열었습니까?", keywords: ["다른 손님", "실수로 열"], verdict: "red", importance: 1 },
      { id: "c20-q7", sampleQuestion: "우리 문 자체는 계속 잠겨 있었습니까?", keywords: ["문 잠겨", "계속 잠김"], verdict: "green", importance: 2 },
      { id: "c20-q8", sampleQuestion: "강아지를 훔쳐서 판 것입니까?", keywords: ["훔쳐서", "판"], verdict: "red", importance: 1 },
    ],
    timeline: [
      { time: "낮 15:00", description: "우진이 반려견을 산책시키던 중 목줄을 놓쳐 강아지를 잃어버림." },
      { time: "15:30", description: "우진이 인근을 수색했으나 찾지 못함." },
      { time: "16:00", description: "우진이 CCTV 저장장치에서 산책 구간 영상을 삭제." },
      { time: "16:10", description: "우진이 우리 문을 잠근 채로 두고 '사라진 것처럼' 정리." },
      { time: "저녁", description: "주인이 면회를 요청, 강아지가 없다는 사실이 드러남." },
    ],
    evidence: [
      { id: "c20-e1", name: "CCTV 저장장치 삭제 흔적", description: "15:00~16:00 구간 영상이 삭제된 저장장치 로그.", photo: photo("computer-log", "CCTV 저장장치 로그 화면") },
      { id: "c20-e2", name: "우리 문 잠금 상태 사진", description: "발견 당시에도 정상적으로 잠겨 있던 우리 문.", photo: photo("keypad", "반려동물 우리 잠금 장치") },
      { id: "c20-e3", name: "산책로 인근 목격 제보 사진", description: "산책로 인근에서 목줄 없이 뛰어다니는 강아지를 봤다는 제보 사진.", photo: photo("footprint", "산책로 인근 발자국") },
      { id: "c20-e4", name: "우진의 근무 평가서", description: "최근 관리 부실로 경고를 받은 우진의 근무 평가 기록." },
      { id: "c20-e5", name: "분실 목줄", description: "산책로 근처 수풀에서 나중에 발견된 목줄." },
    ],
    messages: [
      { id: "c20-m1", from: "우진", to: "동료 직원", time: "당일 15:40", content: "이거 알려지면 나 진짜 잘릴 것 같아, 어떡하지." },
      { id: "c20-m2", from: "동료 직원", to: "우진", time: "당일 15:45", content: "일단 침착하게 생각해봐, 무리하게 처리하지 말고." },
    ],
    testimonies: [
      { id: "c20-t1", witness: "우진", statement: "저는 그날 산책은 정상적으로 다 마치고 데려다놨어요.", contradictsWith: ["c20-t2"] },
      { id: "c20-t2", witness: "동료 직원 하나", statement: "우진 씨가 산책 다녀와서 안색이 안 좋았던 게 기억나요.", contradictsWith: ["c20-t1"] },
    ],
    testimoniesLv3: [
      { id: "c20-t1", witness: "우진", statement: "저는 그날 산책은 정상적으로 다 마치고 데려다놨어요.", contradictsWith: ["c20-t2", "c20-t3"] },
      { id: "c20-t2", witness: "동료 직원 하나", statement: "우진 씨가 산책 다녀와서 안색이 안 좋았던 게 기억나요.", contradictsWith: ["c20-t1"] },
      { id: "c20-t3", witness: "산책로 관리인", statement: "우진 직원분은 그날 산책로 쪽에 오지 않았다고 알고 있어요.", contradictsWith: ["c20-t1"] },
    ],
    lockedEvidence: [
      {
        id: "c20-locked-1",
        name: "CCTV 삭제 구간 포렌식 감정서",
        unlockHint: "낮 산책 중에 목줄을 놓쳐 잃어버렸는지를 정확히 짚는 질문에서 초록불을 받아야 해금됩니다.",
        description: "저장장치 포렌식 복구 결과 — 15:00경 산책로에서 목줄이 풀리는 순간이 삭제 직전 영상 조각에서 복원됐다.",
        photo: photo("documents", "CCTV 삭제 구간 포렌식 감정서"),
        unlockTriggerId: "c20-q3",
      },
    ],
  }),
  b({
    id: "c-21-hospital-night-shift",
    type: "B",
    difficultySupport: ["LV1", "LV2", "LV3"],
    title: "대학병원 야간 당직실",
    synopsis:
      "대학병원 야간 당직 중, 인턴 한 명이 당직실에서 쓰러진 채 발견됐다. 처방 기록을 확인해보니 본인이 받은 처방과 실제 복용한 약이 다르다는 사실이 드러났다.",
    truth:
      "동료 인턴 서준이 레지던트 선발 경쟁에서 앞서기 위해, 피해자의 개인 약통에 처방받은 약과 겉모습이 비슷하지만 진정 성분이 훨씬 강한 다른 약을 몰래 섞어 넣었다. 동기는 다가오는 당직 평가에서 피해자의 컨디션을 무너뜨려 자신이 유리한 평가를 받으려던 것이었다.",
    answerRequiredKeywordGroups: [
      { label: "범인", keywords: ["서준"] },
      { label: "트릭", keywords: ["약통", "바꿔치기", "진정성분"] },
      { label: "동기", keywords: ["레지던트", "평가", "경쟁"] },
    ],
    questionBank: [
      { id: "c21-q1", sampleQuestion: "범인은 동료 인턴 서준입니까?", keywords: ["서준"], verdict: "green", importance: 3 },
      { id: "c21-q2", sampleQuestion: "피해자가 원래 처방받은 약을 그대로 먹었습니까?", keywords: ["원래 처방", "그대로 먹"], verdict: "red", importance: 2 },
      { id: "c21-q3", sampleQuestion: "약통에 다른 약이 섞여 있었습니까?", keywords: ["약통", "바꿔치기"], verdict: "green", importance: 3 },
      { id: "c21-q4", sampleQuestion: "동기는 레지던트 선발 평가에서 유리해지기 위해서입니까?", keywords: ["레지던트", "평가", "경쟁"], verdict: "green", importance: 3 },
      { id: "c21-q5", sampleQuestion: "약사가 조제 과정에서 실수했습니까?", keywords: ["약사", "조제 실수"], verdict: "red", importance: 1 },
      { id: "c21-q6", sampleQuestion: "섞인 약은 진정 성분이 훨씬 강한 약이었습니까?", keywords: ["진정성분", "강한 약"], verdict: "green", importance: 2 },
      { id: "c21-q7", sampleQuestion: "서준이 사건 전날 피해자의 약통에 접근했습니까?", keywords: ["전날", "약통", "접근"], verdict: "green", importance: 2 },
      { id: "c21-q8", sampleQuestion: "피해자가 과로로 스스로 쓰러진 것입니까?", keywords: ["과로", "스스로"], verdict: "yellow", yellowDetail: "체력이 떨어져 있던 상태이긴 했지만, 결정적 원인은 '과로'가 아니라 약통에 섞인 약이었습니다.", importance: 2 },
    ],
    timeline: [
      { time: "당직 D-1", description: "서준이 약국에서 겉모습이 비슷한 진정 성분 약을 구입." },
      { time: "당직 D-1 저녁", description: "서준이 피해자의 개인 약통에 몰래 접근해 약을 섞음." },
      { time: "당직 당일 새벽", description: "피해자가 평소대로 약통에서 약을 꺼내 복용." },
      { time: "30분 후", description: "피해자가 극심한 졸음과 어지럼증을 호소." },
      { time: "새벽 5시", description: "당직실에서 쓰러진 채 발견됨." },
    ],
    evidence: [
      { id: "c21-e1", name: "피해자의 약통", description: "겉모습이 비슷한 두 종류의 약이 섞여 있던 개인 약통." },
      { id: "c21-e2", name: "서준의 약국 구입 영수증", description: "당직 전날 진정 성분 약을 구입한 영수증.", photo: photo("receipt", "약국 구입 영수증") },
      { id: "c21-e3", name: "당직실 CCTV 스틸컷", description: "전날 저녁 당직실 사물함 근처를 서성이는 인영.", photo: photo("corridor", "당직실 CCTV 스틸컷") },
      { id: "c21-e4", name: "레지던트 평가 기준표", description: "당직 컨디션이 반영되는 레지던트 선발 평가 기준 문서.", photo: photo("documents", "레지던트 평가 기준표") },
      { id: "c21-e5", name: "혈액 검사 결과지", description: "처방받지 않은 성분이 검출된 피해자의 혈액 검사 결과.", photo: photo("financial-doc", "혈액 검사 결과지") },
    ],
    messages: [
      { id: "c21-m1", from: "서준", to: "친구", time: "당직 D-1", content: "이번 평가는 무조건 내가 앞서야 해." },
      { id: "c21-m2", from: "피해자", to: "서준", time: "당직 당일 낮", content: "오늘 당직 컨디션 관리 잘하자, 우리 둘 다." },
    ],
    testimonies: [
      { id: "c21-t1", witness: "서준", statement: "저는 전날 저녁엔 당직실 근처도 안 갔어요.", contradictsWith: ["c21-t2"] },
      { id: "c21-t2", witness: "간호사 다인", statement: "전날 저녁 서준 선생님이 당직실 사물함 쪽에 있는 걸 봤어요.", contradictsWith: ["c21-t1"] },
    ],
    testimoniesLv3: [
      { id: "c21-t1", witness: "서준", statement: "저는 전날 저녁엔 당직실 근처도 안 갔어요.", contradictsWith: ["c21-t2", "c21-t3"] },
      { id: "c21-t2", witness: "간호사 다인", statement: "전날 저녁 서준 선생님이 당직실 사물함 쪽에 있는 걸 봤어요.", contradictsWith: ["c21-t1"] },
      { id: "c21-t3", witness: "동료 인턴", statement: "서준 선생님은 전날 저녁 내내 응급실에만 있었다고 들었어요.", contradictsWith: ["c21-t1"] },
    ],
    lockedEvidence: [
      {
        id: "c21-locked-1",
        name: "약물 성분 정밀 감정서",
        unlockHint: "약통에 다른 약이 섞여 있었는지를 정확히 짚는 질문에서 초록불을 받아야 해금됩니다.",
        description: "약물 정밀 감정 결과 — 약통에서 검출된 진정 성분이 서준이 구입한 약품과 동일 성분·동일 제조번호로 확인됐다.",
        photo: photo("documents", "약물 성분 정밀 감정서"),
        unlockTriggerId: "c21-q3",
      },
    ],
  }),
  b({
    id: "c-22-subway-last-train",
    type: "B",
    difficultySupport: ["LV1", "LV2", "LV3"],
    title: "지하철 막차 정지 사건",
    synopsis:
      "지하철 막차가 종착역 직전 터널 구간에서 갑자기 급정지했다. 관제실 기록엔 '신호 이상'으로만 남아 있는데, 그 사이 열차 안에 있던 승객 한 명이 의식을 잃었다.",
    truth:
      "동승 기관사 훈련생 도영이 정식 기관사 자리를 두고 경쟁하던 피해자(같은 훈련생)를 곤란하게 만들려고, 열차 제어 시스템에 임시 접근해 비상 제동을 인위적으로 걸었다. 급정지 충격으로 피해자가 손잡이에 머리를 부딪혔다. 동기는 다가오는 정식 임용 심사에서 피해자의 실수처럼 보이게 만들어 자신이 유리해지려던 것이었다.",
    answerRequiredKeywordGroups: [
      { label: "범인", keywords: ["도영"] },
      { label: "트릭", keywords: ["비상제동", "인위적", "제어시스템"] },
      { label: "동기", keywords: ["임용심사", "경쟁", "정식기관사"] },
    ],
    questionBank: [
      { id: "c22-q1", sampleQuestion: "범인은 기관사 훈련생 도영입니까?", keywords: ["도영"], verdict: "green", importance: 3 },
      { id: "c22-q2", sampleQuestion: "정말 신호 이상 때문에 급정지했습니까?", keywords: ["신호 이상"], verdict: "yellow", yellowDetail: "관제 기록상 '신호 이상'으로 남았지만, 실제로는 도영이 제어 시스템에 접근해 인위적으로 건 비상 제동입니다.", importance: 2 },
      { id: "c22-q3", sampleQuestion: "비상 제동을 인위적으로 걸었습니까?", keywords: ["비상제동", "인위적"], verdict: "green", importance: 3 },
      { id: "c22-q4", sampleQuestion: "동기는 정식 임용 심사 경쟁 때문입니까?", keywords: ["임용심사", "경쟁", "정식기관사"], verdict: "green", importance: 3 },
      { id: "c22-q5", sampleQuestion: "실제 열차 설비 결함이 원인입니까?", keywords: ["설비 결함"], verdict: "red", importance: 2 },
      { id: "c22-q6", sampleQuestion: "승객이 장난으로 비상벨을 눌렀습니까?", keywords: ["장난", "비상벨"], verdict: "red", importance: 1 },
      { id: "c22-q7", sampleQuestion: "도영이 제어 시스템에 임시 접근 권한이 있었습니까?", keywords: ["접근 권한", "제어시스템"], verdict: "green", importance: 2 },
      { id: "c22-q8", sampleQuestion: "피해자가 도영과 같은 훈련생입니까?", keywords: ["같은 훈련생", "동료 훈련생"], verdict: "green", importance: 1 },
    ],
    timeline: [
      { time: "운행 D-1", description: "도영이 훈련 명목으로 제어 시스템 임시 접근 권한을 확보." },
      { time: "당일 막차 운행 중", description: "도영이 관제실 인근에서 대기." },
      { time: "종착역 직전", description: "도영이 원격으로 비상 제동을 인위적으로 작동." },
      { time: "직후", description: "급정지 충격으로 승객들이 크게 휘청, 피해자가 손잡이에 머리를 부딪힘." },
      { time: "5분 후", description: "구조대가 도착해 피해자를 확인." },
    ],
    evidence: [
      { id: "c22-e1", name: "제어 시스템 접근 로그", description: "도영의 훈련생 계정으로 비상 제동이 수동 작동된 기록.", photo: photo("computer-log", "제어 시스템 접근 로그 화면") },
      { id: "c22-e2", name: "열차 내부 CCTV 스틸컷", description: "급정지 순간 열차 내부의 흔들리는 승객들.", photo: photo("security-camera", "열차 내부 CCTV 스틸컷") },
      { id: "c22-e3", name: "정식 임용 심사 공고문", description: "도영과 피해자가 함께 경쟁하는 정식 기관사 임용 공고." },
      { id: "c22-e4", name: "관제실 신호 기록", description: "'신호 이상'으로만 기록된 관제실 로그 — 실제 신호 장비엔 이상 없음이 별도로 확인됨." },
      { id: "c22-e5", name: "손잡이 충격 흔적", description: "피해자가 부딪힌 것으로 보이는 손잡이 부분의 흔적." },
    ],
    messages: [
      { id: "c22-m1", from: "도영", to: "친구", time: "운행 D-1", content: "이번 임용 심사는 무조건 내가 앞서야 해." },
      { id: "c22-m2", from: "피해자", to: "도영", time: "당일 낮", content: "오늘 막차 운행 같이 잘해보자, 훈련 마지막이니까." },
    ],
    testimonies: [
      { id: "c22-t1", witness: "도영", statement: "저는 그때 계속 관제실 밖에서 대기만 하고 있었어요.", contradictsWith: ["c22-t2"] },
      { id: "c22-t2", witness: "관제실 직원", statement: "그 시각 도영 씨가 제어 콘솔 쪽에 가까이 있는 걸 봤어요.", contradictsWith: ["c22-t1"] },
    ],
    testimoniesLv3: [
      { id: "c22-t1", witness: "도영", statement: "저는 그때 계속 관제실 밖에서 대기만 하고 있었어요.", contradictsWith: ["c22-t2", "c22-t3"] },
      { id: "c22-t2", witness: "관제실 직원", statement: "그 시각 도영 씨가 제어 콘솔 쪽에 가까이 있는 걸 봤어요.", contradictsWith: ["c22-t1"] },
      { id: "c22-t3", witness: "동료 훈련생", statement: "도영 씨는 그 시간에 계속 대합실에서 저랑 같이 있었다고 들었어요.", contradictsWith: ["c22-t1"] },
    ],
    lockedEvidence: [
      {
        id: "c22-locked-1",
        name: "제어 시스템 포렌식 감정서",
        unlockHint: "비상 제동이 인위적으로 걸렸는지를 정확히 짚는 질문에서 초록불을 받아야 해금됩니다.",
        description: "철도 안전 기관의 포렌식 감정 결과 — 비상 제동 작동 시점에 도영의 훈련생 계정 접속 기록이 명확히 남아 있었다.",
        photo: photo("documents", "제어 시스템 포렌식 감정서"),
        unlockTriggerId: "c22-q3",
      },
    ],
  }),
  b({
    id: "c-23-climbing-gym",
    type: "B",
    difficultySupport: ["LV1", "LV2", "LV3"],
    title: "실내 클라이밍짐 대회",
    synopsis:
      "실내 클라이밍 대회 결승전 도중, 선두를 달리던 선수가 카라비너가 풀리며 추락했다. 안전 매트 덕에 큰 부상은 면했지만, 장비 자체에 이상이 있었다는 의혹이 제기됐다.",
    truth:
      "같은 체육관 소속 후배 선수 하진이 결승 전 대기 시간에 몰래 피해자의 개인 장비함에서 카라비너를 정상 제품과 겉보기엔 똑같지만 잠금 나사가 헐거운 불량품으로 바꿔치기했다. 동기는 하진이 이번 대회 성적으로 스폰서 계약을 결정짓는 상황에서 유일한 라이벌을 제거하려던 것이었다.",
    answerRequiredKeywordGroups: [
      { label: "범인", keywords: ["하진"] },
      { label: "트릭", keywords: ["카라비너", "바꿔치기", "불량품"] },
      { label: "동기", keywords: ["스폰서", "계약", "라이벌"] },
    ],
    questionBank: [
      { id: "c23-q1", sampleQuestion: "범인은 후배 선수 하진입니까?", keywords: ["하진"], verdict: "green", importance: 3 },
      { id: "c23-q2", sampleQuestion: "카라비너 자체는 원래 불량품이었습니까?", keywords: ["원래 불량", "제조 불량"], verdict: "red", importance: 2 },
      { id: "c23-q3", sampleQuestion: "정상 장비를 불량품으로 바꿔치기했습니까?", keywords: ["바꿔치기", "불량품"], verdict: "green", importance: 3 },
      { id: "c23-q4", sampleQuestion: "동기는 스폰서 계약 경쟁 때문입니까?", keywords: ["스폰서", "계약", "라이벌"], verdict: "green", importance: 3 },
      { id: "c23-q5", sampleQuestion: "대회 운영진의 장비 점검 실수입니까?", keywords: ["운영진", "점검 실수"], verdict: "red", importance: 1 },
      { id: "c23-q6", sampleQuestion: "하진이 결승 전 피해자의 장비함에 접근했습니까?", keywords: ["장비함", "접근"], verdict: "green", importance: 2 },
      { id: "c23-q7", sampleQuestion: "안전 매트가 없었다면 크게 다쳤을 상황입니까?", keywords: ["안전매트", "크게 다쳤"], verdict: "green", importance: 1 },
      { id: "c23-q8", sampleQuestion: "하진이 불량 카라비너를 미리 준비해뒀습니까?", keywords: ["미리 준비", "불량 카라비너"], verdict: "green", importance: 2 },
    ],
    timeline: [
      { time: "대회 D-3", description: "하진이 겉보기엔 똑같은 불량 카라비너를 구함." },
      { time: "결승 대기 시간", description: "하진이 피해자의 개인 장비함에서 카라비너를 바꿔치기." },
      { time: "결승 시작", description: "피해자가 평소처럼 장비를 착용하고 등반 시작." },
      { time: "결승 중반", description: "선두를 달리던 중 카라비너 잠금이 풀리며 추락." },
      { time: "직후", description: "안전 매트 덕에 큰 부상은 면했으나 의식을 잃음." },
    ],
    evidence: [
      { id: "c23-e1", name: "풀린 카라비너", description: "잠금 나사가 헐거운 상태로 회수된 카라비너." },
      { id: "c23-e2", name: "장비함 근처 CCTV 스틸컷", description: "결승 대기 시간 장비함 근처를 서성이는 인영.", photo: photo("corridor", "클라이밍짐 장비함 근처 CCTV 스틸컷") },
      { id: "c23-e3", name: "스폰서 계약 조건서", description: "이번 대회 성적에 따라 스폰서 계약이 결정된다는 조건서.", photo: photo("documents", "스폰서 계약 조건서") },
      { id: "c23-e4", name: "하진의 장비 구입 내역", description: "대회 며칠 전 특정 쇼핑몰에서 구입한 카라비너 결제 내역.", photo: photo("receipt", "카라비너 구입 영수증") },
      { id: "c23-e5", name: "안전 매트 충격 흔적", description: "추락 충격이 남은 안전 매트 표면." },
    ],
    messages: [
      { id: "c23-m1", from: "하진", to: "친구", time: "대회 D-3", content: "이번 대회 스폰서 계약, 무조건 내가 따내야 해." },
      { id: "c23-m2", from: "피해자", to: "하진", time: "결승 전날", content: "내일 결승 우리 둘 다 잘해보자!" },
    ],
    testimonies: [
      { id: "c23-t1", witness: "하진", statement: "저는 대기 시간 내내 몸 풀기만 하고 있었어요.", contradictsWith: ["c23-t2"] },
      { id: "c23-t2", witness: "체육관 코치", statement: "대기 시간에 하진 선수가 장비함 쪽에 가 있는 걸 봤어요.", contradictsWith: ["c23-t1"] },
    ],
    testimoniesLv3: [
      { id: "c23-t1", witness: "하진", statement: "저는 대기 시간 내내 몸 풀기만 하고 있었어요.", contradictsWith: ["c23-t2", "c23-t3"] },
      { id: "c23-t2", witness: "체육관 코치", statement: "대기 시간에 하진 선수가 장비함 쪽에 가 있는 걸 봤어요.", contradictsWith: ["c23-t1"] },
      { id: "c23-t3", witness: "동료 선수", statement: "하진 선수는 대기 시간 내내 저희 팀 쪽에만 있었다고 들었어요.", contradictsWith: ["c23-t1"] },
    ],
    lockedEvidence: [
      {
        id: "c23-locked-1",
        name: "카라비너 정밀 감정서",
        unlockHint: "정상 장비가 불량품으로 바꿔치기됐는지를 정확히 짚는 질문에서 초록불을 받아야 해금됩니다.",
        description: "장비 제조사의 정밀 감정 결과 — 회수된 카라비너는 정식 유통 제품이 아닌, 잠금 나사 규격 자체가 다른 모조품으로 확인됐다.",
        photo: photo("documents", "카라비너 정밀 감정서"),
        unlockTriggerId: "c23-q3",
      },
    ],
  }),
  b({
    id: "c-24-brewery-tasting",
    type: "B",
    difficultySupport: ["LV1", "LV2", "LV3"],
    title: "브루어리 신메뉴 시음회",
    synopsis:
      "수제 맥주 브루어리의 신메뉴 시음회 도중, 헤드 브루어가 시음 도중 갑자기 몸을 가누지 못하고 쓰러졌다. 그가 마시던 잔에서 평소와 다른 이상한 향이 났다는 목격담이 나온다.",
    truth:
      "경쟁 브루어리에서 파견된 참가자로 위장한 정민이 신메뉴 레시피를 훔치기 위해 시음회에 잠입했는데, 헤드 브루어가 레시피 노트를 넘겨주지 않자 그의 시음잔에 독한 향신료 추출액을 몰래 섞어 혼란을 틈타 노트를 훔치려 했다. 동기는 경쟁 브루어리로부터 신메뉴 레시피를 빼오면 거액을 받기로 한 것이었다.",
    answerRequiredKeywordGroups: [
      { label: "범인", keywords: ["정민"] },
      { label: "트릭", keywords: ["향신료", "추출액", "시음잔"] },
      { label: "동기", keywords: ["레시피", "경쟁브루어리", "거액"] },
    ],
    questionBank: [
      { id: "c24-q1", sampleQuestion: "범인은 위장 참가자 정민입니까?", keywords: ["정민"], verdict: "green", importance: 3 },
      { id: "c24-q2", sampleQuestion: "시음잔에 독한 향신료 추출액이 섞여 있었습니까?", keywords: ["향신료", "추출액"], verdict: "green", importance: 3 },
      { id: "c24-q3", sampleQuestion: "단순히 신메뉴 자체가 문제였습니까?", keywords: ["신메뉴 자체", "레시피 문제"], verdict: "red", importance: 2 },
      { id: "c24-q4", sampleQuestion: "동기는 신메뉴 레시피를 훔치기 위해서입니까?", keywords: ["레시피", "경쟁브루어리", "거액"], verdict: "green", importance: 3 },
      { id: "c24-q5", sampleQuestion: "정민이 경쟁 브루어리에서 파견됐습니까?", keywords: ["경쟁 브루어리", "파견"], verdict: "green", importance: 2 },
      { id: "c24-q6", sampleQuestion: "다른 참가자가 실수로 재료를 잘못 넣었습니까?", keywords: ["다른 참가자", "실수"], verdict: "red", importance: 1 },
      { id: "c24-q7", sampleQuestion: "정민이 레시피 노트를 노렸습니까?", keywords: ["레시피 노트", "노렸"], verdict: "green", importance: 2 },
      { id: "c24-q8", sampleQuestion: "헤드 브루어가 알레르기 반응을 일으킨 것뿐입니까?", keywords: ["알레르기"], verdict: "red", importance: 1 },
    ],
    timeline: [
      { time: "시음회 D-3", description: "정민이 경쟁 브루어리로부터 레시피 탈취 제안을 받음." },
      { time: "시음회 당일", description: "정민이 일반 참가자로 위장해 입장." },
      { time: "시음회 중반", description: "정민이 헤드 브루어에게 레시피를 요청했다가 거절당함." },
      { time: "직후", description: "정민이 헤드 브루어의 시음잔에 향신료 추출액을 몰래 섞음." },
      { time: "곧이어", description: "헤드 브루어가 시음 도중 몸을 가누지 못하고 쓰러짐." },
    ],
    evidence: [
      { id: "c24-e1", name: "헤드 브루어의 시음잔", description: "성분 검사 결과 강한 향신료 추출액이 검출된 시음잔." },
      { id: "c24-e2", name: "시음회장 CCTV 스틸컷", description: "정민이 시음잔 근처에서 손을 움직이는 장면.", photo: photo("corridor", "시음회장 CCTV 스틸컷") },
      { id: "c24-e3", name: "경쟁 브루어리 제안 메일", description: "정민에게 전달된 레시피 탈취 대가 제안 메일.", photo: photo("documents", "경쟁 브루어리 제안 메일 출력본") },
      { id: "c24-e4", name: "향신료 추출액 병", description: "정민의 가방에서 발견된 소량의 향신료 추출액 병." },
      { id: "c24-e5", name: "헤드 브루어의 레시피 노트", description: "정민이 노렸던 것으로 보이는 신메뉴 레시피 노트.", photo: photo("handwriting", "신메뉴 레시피 노트") },
    ],
    messages: [
      { id: "c24-m1", from: "경쟁 브루어리 담당자", to: "정민", time: "시음회 D-3", content: "레시피 확실히 가져오면 약속한 금액 바로 드릴게요." },
      { id: "c24-m2", from: "정민", to: "친구", time: "시음회 당일", content: "오늘 안에 확실히 끝내야 해." },
    ],
    testimonies: [
      { id: "c24-t1", witness: "정민", statement: "저는 시음회 내내 다른 참가자들이랑 같이 있었어요.", contradictsWith: ["c24-t2"] },
      { id: "c24-t2", witness: "시음회 스태프", statement: "정민 씨가 헤드 브루어님 잔 근처에서 혼자 서 있는 걸 봤어요.", contradictsWith: ["c24-t1"] },
    ],
    testimoniesLv3: [
      { id: "c24-t1", witness: "정민", statement: "저는 시음회 내내 다른 참가자들이랑 같이 있었어요.", contradictsWith: ["c24-t2", "c24-t3"] },
      { id: "c24-t2", witness: "시음회 스태프", statement: "정민 씨가 헤드 브루어님 잔 근처에서 혼자 서 있는 걸 봤어요.", contradictsWith: ["c24-t1"] },
      { id: "c24-t3", witness: "다른 참가자", statement: "정민 씨는 시음회 내내 저희 테이블에서 한 발짝도 안 움직였다고 하던데요.", contradictsWith: ["c24-t1"] },
    ],
    lockedEvidence: [
      {
        id: "c24-locked-1",
        name: "시음잔 성분 정밀 감정서",
        unlockHint: "시음잔에 독한 향신료 추출액이 섞여 있었는지를 정확히 짚는 질문에서 초록불을 받아야 해금됩니다.",
        description: "성분 정밀 감정 결과 — 시음잔에서 검출된 추출액이 정민의 가방에서 발견된 병의 성분과 일치했다.",
        photo: photo("documents", "시음잔 성분 정밀 감정서"),
        unlockTriggerId: "c24-q2",
      },
    ],
  }),
  b({
    id: "c-25-webtoon-studio",
    type: "B",
    difficultySupport: ["LV1", "LV2", "LV3"],
    title: "웹툰 작업실 마감 전날",
    synopsis:
      "연재 마감을 하루 앞둔 웹툰 작업실에서, 어시스턴트 한 명이 작업용 컴퓨터 앞에 쓰러진 채 발견됐다. 그날 밤 완성됐어야 할 최종 원고 파일이 감쪽같이 사라졌다.",
    truth:
      "동료 어시스턴트 은결이 독립 연재를 준비하며 작가의 화풍과 스토리 구성을 참고하려고, 피해자가 백업해둔 외장하드를 몰래 자신의 것과 바꿔치기했다. 피해자가 파일이 없어진 걸 발견하고 추궁하자 몸싸움이 벌어졌다. 동기는 은결이 같은 장르로 먼저 데뷔하려는 조급함이었다.",
    answerRequiredKeywordGroups: [
      { label: "범인", keywords: ["은결"] },
      { label: "트릭", keywords: ["외장하드", "바꿔치기"] },
      { label: "동기", keywords: ["독립연재", "데뷔", "참고"] },
    ],
    questionBank: [
      { id: "c25-q1", sampleQuestion: "범인은 동료 어시스턴트 은결입니까?", keywords: ["은결"], verdict: "green", importance: 3 },
      { id: "c25-q2", sampleQuestion: "원고 파일이 완전히 삭제됐습니까?", keywords: ["완전히 삭제", "영구 삭제"], verdict: "yellow", yellowDetail: "원고가 사라진 것처럼 보이지만 삭제된 게 아니라 은결이 외장하드째로 바꿔치기해 가져간 것입니다.", importance: 2 },
      { id: "c25-q3", sampleQuestion: "외장하드가 바꿔치기됐습니까?", keywords: ["외장하드", "바꿔치기"], verdict: "green", importance: 3 },
      { id: "c25-q4", sampleQuestion: "동기는 독립 연재를 위해 화풍을 참고하려던 것입니까?", keywords: ["독립연재", "데뷔", "참고"], verdict: "green", importance: 3 },
      { id: "c25-q5", sampleQuestion: "편집자가 원고를 회수해간 것입니까?", keywords: ["편집자", "회수"], verdict: "red", importance: 1 },
      { id: "c25-q6", sampleQuestion: "몸싸움이 있었습니까?", keywords: ["몸싸움"], verdict: "green", importance: 2 },
      { id: "c25-q7", sampleQuestion: "은결이 사건 며칠 전부터 비슷한 외장하드를 준비했습니까?", keywords: ["비슷한 외장하드", "준비"], verdict: "green", importance: 2 },
      { id: "c25-q8", sampleQuestion: "정전으로 파일이 손상된 것입니까?", keywords: ["정전", "손상"], verdict: "red", importance: 1 },
    ],
    timeline: [
      { time: "마감 D-3", description: "은결이 피해자 것과 똑같은 외장하드 모델을 구입." },
      { time: "마감 전날 밤", description: "은결이 작업실에 남아 외장하드를 바꿔치기." },
      { time: "직후", description: "피해자가 파일이 사라진 걸 발견." },
      { time: "곧이어", description: "은결을 추궁하다 몸싸움 발생." },
      { time: "20분 후", description: "다른 어시스턴트가 쓰러진 피해자를 발견." },
    ],
    evidence: [
      { id: "c25-e1", name: "바꿔치기된 외장하드", description: "겉모습은 같지만 내용물이 텅 빈 외장하드." },
      { id: "c25-e2", name: "은결의 구입 영수증", description: "마감 D-3에 동일 모델 외장하드를 구입한 영수증.", photo: photo("receipt", "외장하드 구입 영수증") },
      { id: "c25-e3", name: "작업실 CCTV 스틸컷", description: "마감 전날 밤 늦게까지 남아 있는 인영.", photo: photo("corridor", "웹툰 작업실 CCTV 스틸컷") },
      { id: "c25-e4", name: "은결의 독립 연재 기획안", description: "피해자의 화풍과 유사한 구성이 담긴 은결의 개인 기획안.", photo: photo("handwriting", "독립 연재 기획안 스케치") },
      { id: "c25-e5", name: "피해자의 원본 외장하드", description: "은결의 가방에서 나중에 발견된 진짜 원고가 담긴 외장하드." },
    ],
    messages: [
      { id: "c25-m1", from: "은결", to: "친구", time: "마감 D-3", content: "이번엔 진짜 내 걸로 먼저 데뷔하고 싶어." },
      { id: "c25-m2", from: "피해자", to: "은결", time: "마감 전날 밤", content: "내 외장하드 어디 갔어? 원고가 왜 안 열려?" },
    ],
    testimonies: [
      { id: "c25-t1", witness: "은결", statement: "저는 마감 전날엔 일찍 퇴근했어요, 밤엔 작업실에 없었어요.", contradictsWith: ["c25-t2"] },
      { id: "c25-t2", witness: "다른 어시스턴트 재이", statement: "마감 전날 밤늦게까지 은결 씨 자리에 불이 켜져 있었어요.", contradictsWith: ["c25-t1"] },
    ],
    testimoniesLv3: [
      { id: "c25-t1", witness: "은결", statement: "저는 마감 전날엔 일찍 퇴근했어요, 밤엔 작업실에 없었어요.", contradictsWith: ["c25-t2", "c25-t3"] },
      { id: "c25-t2", witness: "다른 어시스턴트 재이", statement: "마감 전날 밤늦게까지 은결 씨 자리에 불이 켜져 있었어요.", contradictsWith: ["c25-t1"] },
      { id: "c25-t3", witness: "작가 매니저", statement: "은결 씨는 그날 일찍 퇴근했다고 저한테 보고했었어요.", contradictsWith: ["c25-t1"] },
    ],
    lockedEvidence: [
      {
        id: "c25-locked-1",
        name: "외장하드 구입 이력 포렌식 조회서",
        unlockHint: "외장하드가 바꿔치기됐는지를 정확히 짚는 질문에서 초록불을 받아야 해금됩니다.",
        description: "구입처 포렌식 조회 결과 — 은결 명의로 결제된 동일 모델 외장하드가 사건 며칠 전 구매된 사실이 확인됐다.",
        photo: photo("documents", "외장하드 구입 이력 조회서"),
        unlockTriggerId: "c25-q3",
      },
    ],
  }),
  b({
    id: "c-26-art-appraisal",
    type: "B",
    difficultySupport: ["LV1", "LV2", "LV3"],
    title: "미술품 감정서 위조",
    synopsis:
      "유명 화가의 미공개작이 경매에 출품되기 직전, 감정을 담당한 전문가가 사무실에서 쓰러진 채 발견됐다. 알고 보니 그 그림의 진품 감정서 자체가 위조된 것이었다.",
    truth:
      "화랑 실장 태희가 무명 화가의 그림을 유명 화가의 미공개작으로 둔갑시키기 위해 가짜 감정서를 만들어 감정 전문가에게 검토를 요청했다. 전문가가 위조를 알아채고 신고하려 하자 태희가 사무실에서 몸싸움을 벌였다. 동기는 위조 미공개작을 경매에 출품해 거액을 챙기려던 것이었다.",
    answerRequiredKeywordGroups: [
      { label: "범인", keywords: ["태희"] },
      { label: "트릭", keywords: ["위조감정서", "무명화가"] },
      { label: "동기", keywords: ["경매", "거액", "출품"] },
    ],
    questionBank: [
      { id: "c26-q1", sampleQuestion: "범인은 화랑 실장 태희입니까?", keywords: ["태희"], verdict: "green", importance: 3 },
      { id: "c26-q2", sampleQuestion: "그림 자체가 진짜 미공개작입니까?", keywords: ["진짜 미공개작", "진품"], verdict: "red", importance: 2 },
      { id: "c26-q3", sampleQuestion: "감정서가 위조됐습니까?", keywords: ["위조감정서", "감정서 위조"], verdict: "green", importance: 3 },
      { id: "c26-q4", sampleQuestion: "실제로는 무명 화가의 그림입니까?", keywords: ["무명화가"], verdict: "green", importance: 2 },
      { id: "c26-q5", sampleQuestion: "동기는 경매에서 거액을 챙기려던 것입니까?", keywords: ["경매", "거액", "출품"], verdict: "green", importance: 3 },
      { id: "c26-q6", sampleQuestion: "감정 전문가 본인이 위조에 가담했습니까?", keywords: ["전문가 가담", "공모"], verdict: "red", importance: 2 },
      { id: "c26-q7", sampleQuestion: "전문가가 위조를 알아채고 신고하려 했습니까?", keywords: ["신고", "알아채"], verdict: "green", importance: 2 },
      { id: "c26-q8", sampleQuestion: "무명 화가 본인이 위조에 가담했습니까?", keywords: ["무명 화가가", "화가 본인 가담"], verdict: "red", importance: 1 },
    ],
    timeline: [
      { time: "경매 D-14", description: "태희가 무명 화가의 그림을 저렴하게 사들임." },
      { time: "경매 D-10", description: "태희가 위조 감정서 제작을 의뢰." },
      { time: "경매 D-2", description: "감정 전문가가 검토 중 위조 흔적을 발견." },
      { time: "직후", description: "전문가가 신고 의사를 밝히자 태희가 만류하다 몸싸움." },
      { time: "30분 후", description: "다른 직원이 사무실에서 쓰러진 전문가를 발견." },
    ],
    evidence: [
      { id: "c26-e1", name: "위조 감정서 원본", description: "실제 감정 기관 양식을 그대로 베낀 위조 감정서.", photo: photo("documents", "위조 감정서 원본") },
      { id: "c26-e2", name: "무명 화가와의 구매 계약서", description: "태희가 저렴하게 그림을 사들인 계약서.", photo: photo("financial-doc", "무명 화가 구매 계약서") },
      { id: "c26-e3", name: "화랑 사무실 CCTV 스틸컷", description: "몸싸움 직전 사무실 안 두 사람의 실루엣.", photo: photo("corridor", "화랑 사무실 CCTV 스틸컷") },
      { id: "c26-e4", name: "경매 출품 신청서", description: "태희가 미공개작으로 등록해 제출한 경매 출품 신청서." },
      { id: "c26-e5", name: "물감 성분 분석 자료", description: "그림에 사용된 물감이 최근 제작된 것임을 보여주는 분석 자료." },
      { id: "c26-e6", name: "몸싸움 흔적이 남은 사무실 바닥", description: "태희와 감정 전문가의 몸싸움 중 서랍장이 넘어지고 서류가 사무실 바닥에 흩어졌다.", photo: photo("ransacked-office", "몸싸움으로 어질러진 화랑 사무실 바닥") },
    ],
    messages: [
      { id: "c26-m1", from: "태희", to: "위조 제작업자", time: "경매 D-10", content: "감정서 양식 최대한 진짜처럼 부탁드려요." },
      { id: "c26-m2", from: "감정 전문가", to: "태희", time: "경매 D-2", content: "이 감정서, 발급 기관에 직접 확인해봐야 할 것 같은데요." },
    ],
    testimonies: [
      { id: "c26-t1", witness: "태희", statement: "저는 그 감정서, 정식으로 발급받은 거예요.", contradictsWith: ["c26-t2"] },
      { id: "c26-t2", witness: "발급 기관 담당자", statement: "저희 기관에서는 그런 감정서를 발급한 적이 없습니다.", contradictsWith: ["c26-t1"] },
    ],
    testimoniesLv3: [
      { id: "c26-t1", witness: "태희", statement: "저는 그 감정서, 정식으로 발급받은 거예요.", contradictsWith: ["c26-t2", "c26-t3"] },
      { id: "c26-t2", witness: "발급 기관 담당자", statement: "저희 기관에서는 그런 감정서를 발급한 적이 없습니다.", contradictsWith: ["c26-t1"] },
      { id: "c26-t3", witness: "화랑 직원", statement: "태희 실장님은 그 감정서를 정식 절차로 받아왔다고 저희한테 말씀하셨어요.", contradictsWith: ["c26-t1"] },
    ],
    lockedEvidence: [
      {
        id: "c26-locked-1",
        name: "감정서 발급 기관 정밀 대조 감정서",
        unlockHint: "감정서가 위조됐는지를 정확히 짚는 질문에서 초록불을 받아야 해금됩니다.",
        description: "발급 기관 정밀 대조 결과 — 감정서 발급번호가 실제 시스템에 존재하지 않는 허위 번호로 확인됐다.",
        photo: photo("documents", "감정서 발급 기관 대조 감정서"),
        unlockTriggerId: "c26-q3",
      },
    ],
  }),
  b({
    id: "c-27-startup-demoday",
    type: "B",
    difficultySupport: ["LV1", "LV2", "LV3"],
    title: "스타트업 데모데이 리허설",
    synopsis:
      "투자 유치 데모데이를 하루 앞두고 리허설 도중, 대표가 발표 직전 쓰러졌다. 곧이어 발표 프로토타입이 오작동을 일으켰는데, 알고 보니 시연용 기기에 악성 코드가 심어져 있었다.",
    truth:
      "공동창업자였다가 지분 분쟁으로 갈라선 전 동료 재하가 몰래 사무실에 침입해 시연용 기기 USB 포트에 악성 코드를 심었다. 대표가 리허설 중 이를 발견하고 대응하려다 스트레스로 쓰러졌다. 동기는 재하가 데모데이를 망쳐 투자 유치를 무산시키고, 이후 회사 지분을 헐값에 인수하려던 것이었다.",
    answerRequiredKeywordGroups: [
      { label: "범인", keywords: ["재하"] },
      { label: "트릭", keywords: ["악성코드", "usb", "침입"] },
      { label: "동기", keywords: ["지분분쟁", "헐값인수", "투자무산"] },
    ],
    questionBank: [
      { id: "c27-q1", sampleQuestion: "범인은 전 공동창업자 재하입니까?", keywords: ["재하"], verdict: "green", importance: 3 },
      { id: "c27-q2", sampleQuestion: "프로토타입 자체의 결함입니까?", keywords: ["프로토타입 결함", "제품 결함"], verdict: "red", importance: 2 },
      { id: "c27-q3", sampleQuestion: "시연용 기기에 악성 코드가 심어졌습니까?", keywords: ["악성코드", "usb"], verdict: "green", importance: 3 },
      { id: "c27-q4", sampleQuestion: "재하가 사무실에 몰래 침입했습니까?", keywords: ["침입", "몰래"], verdict: "green", importance: 2 },
      { id: "c27-q5", sampleQuestion: "동기는 지분 분쟁 끝에 회사를 헐값에 인수하려던 것입니까?", keywords: ["지분분쟁", "헐값인수", "투자무산"], verdict: "green", importance: 3 },
      { id: "c27-q6", sampleQuestion: "투자자 측에서 조작에 가담했습니까?", keywords: ["투자자", "가담"], verdict: "red", importance: 1 },
      { id: "c27-q7", sampleQuestion: "대표가 단순 과로로 쓰러졌습니까?", keywords: ["과로", "단순"], verdict: "yellow", yellowDetail: "체력이 떨어진 상태이긴 했지만, 결정적 계기는 '과로'가 아니라 악성 코드로 인한 오작동을 발견한 충격이었습니다.", importance: 2 },
      { id: "c27-q8", sampleQuestion: "재하가 예전 사무실 출입 카드를 여전히 갖고 있었습니까?", keywords: ["출입 카드", "여전히"], verdict: "green", importance: 2 },
    ],
    timeline: [
      { time: "데모데이 D-3", description: "재하가 예전 출입 카드로 사무실 접근이 가능함을 확인." },
      { time: "데모데이 D-1 새벽", description: "재하가 사무실에 몰래 들어와 시연용 기기에 악성 코드 심음." },
      { time: "당일 오전 리허설", description: "대표가 발표를 시작, 프로토타입이 이상 동작." },
      { time: "곧이어", description: "대표가 원인을 파악하려다 극심한 스트레스로 쓰러짐." },
      { time: "직후", description: "팀원들이 대표를 발견해 응급 대응." },
    ],
    evidence: [
      { id: "c27-e1", name: "시연용 기기 악성 코드 로그", description: "USB 포트를 통해 심어진 악성 코드 실행 기록.", photo: photo("computer-log", "시연용 기기 악성 코드 로그") },
      { id: "c27-e2", name: "사무실 출입 기록", description: "재하의 옛 출입 카드로 새벽 시간 사무실이 열린 기록.", photo: photo("keypad", "사무실 출입 카드 리더기") },
      { id: "c27-e3", name: "지분 분쟁 소송 서류", description: "재하와 대표 사이의 지분 분쟁 관련 소송 서류.", photo: photo("documents", "지분 분쟁 소송 서류") },
      { id: "c27-e4", name: "재하의 인수 제안 메모", description: "회사 지분을 헐값에 인수하겠다는 재하의 개인 메모." },
      { id: "c27-e5", name: "USB 저장장치", description: "재하의 차량에서 발견된 악성 코드가 담긴 USB." },
    ],
    messages: [
      { id: "c27-m1", from: "재하", to: "친구", time: "데모데이 D-3", content: "이번 데모데이만 망치면 지분 헐값에 가져올 수 있어." },
      { id: "c27-m2", from: "대표", to: "재하", time: "데모데이 D-5", content: "지분 문제는 변호사 통해서 정식으로 얘기하자." },
    ],
    testimonies: [
      { id: "c27-t1", witness: "재하", statement: "저는 회사랑 관계 끊긴 지 오래돼서 사무실 근처도 안 가요.", contradictsWith: ["c27-t2"] },
      { id: "c27-t2", witness: "건물 경비원", statement: "새벽에 재하 씨로 보이는 사람이 카드로 문을 열고 들어가는 걸 봤어요.", contradictsWith: ["c27-t1"] },
    ],
    testimoniesLv3: [
      { id: "c27-t1", witness: "재하", statement: "저는 회사랑 관계 끊긴 지 오래돼서 사무실 근처도 안 가요.", contradictsWith: ["c27-t2", "c27-t3"] },
      { id: "c27-t2", witness: "건물 경비원", statement: "새벽에 재하 씨로 보이는 사람이 카드로 문을 열고 들어가는 걸 봤어요.", contradictsWith: ["c27-t1"] },
      { id: "c27-t3", witness: "재하의 지인", statement: "재하 씨는 그날 새벽 저랑 계속 통화하고 있었다고 하던데요.", contradictsWith: ["c27-t1"] },
    ],
    lockedEvidence: [
      {
        id: "c27-locked-1",
        name: "악성 코드 포렌식 정밀 감정서",
        unlockHint: "시연용 기기에 악성 코드가 심어졌는지를 정확히 짚는 질문에서 초록불을 받아야 해금됩니다.",
        description: "보안 업체의 포렌식 정밀 분석 결과 — 악성 코드의 컴파일 시각이 새벽 사무실 출입 기록과 정확히 일치했다.",
        photo: photo("documents", "악성 코드 포렌식 정밀 감정서"),
        unlockTriggerId: "c27-q3",
      },
    ],
  }),
  b({
    id: "c-28-yacht-club",
    type: "B",
    difficultySupport: ["LV1", "LV2", "LV3"],
    title: "요트클럽 심야 항해",
    synopsis:
      "요트클럽 회원들의 심야 크루징 도중, 선장을 맡았던 회원이 갑판에서 쓰러진 채 발견됐다. 자동항법장치가 갑자기 항로를 이탈했는데, 기기 결함으로 보기엔 이상한 점이 많다.",
    truth:
      "동승자 중 한 명인 은표가 스마트폰 앱으로 자동항법장치의 항로 설정을 몰래 변경해 배를 암초 근처로 유도한 뒤, 혼란을 틈타 선장이었던 피해자를 갑판에서 밀쳤다. 동기는 은표가 피해자와 공동 소유하던 요트의 단독 소유권을 보험금과 함께 차지하려던 것이었다.",
    answerRequiredKeywordGroups: [
      { label: "범인", keywords: ["은표"] },
      { label: "트릭", keywords: ["자동항법", "항로변경", "앱"] },
      { label: "동기", keywords: ["단독소유", "보험금", "공동소유"] },
    ],
    questionBank: [
      { id: "c28-q1", sampleQuestion: "범인은 동승자 은표입니까?", keywords: ["은표"], verdict: "green", importance: 3 },
      { id: "c28-q2", sampleQuestion: "자동항법장치가 단순 결함으로 오작동했습니까?", keywords: ["단순 결함", "기기 결함"], verdict: "red", importance: 2 },
      { id: "c28-q3", sampleQuestion: "항로 설정이 앱으로 원격 변경됐습니까?", keywords: ["자동항법", "항로변경", "앱"], verdict: "green", importance: 3 },
      { id: "c28-q4", sampleQuestion: "동기는 요트 단독 소유권과 보험금 때문입니까?", keywords: ["단독소유", "보험금", "공동소유"], verdict: "green", importance: 3 },
      { id: "c28-q5", sampleQuestion: "선장이 스스로 실수한 것입니까?", keywords: ["선장 실수", "스스로"], verdict: "red", importance: 1 },
      { id: "c28-q6", sampleQuestion: "다른 동승자가 목격했습니까?", keywords: ["다른 동승자", "목격"], verdict: "yellow", yellowDetail: "다른 동승자가 뭔가를 보긴 했지만, 그 순간엔 무슨 일이 벌어지는지 정확히 알아채지 못했습니다.", importance: 1 },
      { id: "c28-q7", sampleQuestion: "은표가 사건 전날 항법 앱 접근 권한을 확보했습니까?", keywords: ["앱 접근", "전날"], verdict: "green", importance: 2 },
      { id: "c28-q8", sampleQuestion: "배가 실제로 암초 근처로 향했습니까?", keywords: ["암초"], verdict: "green", importance: 2 },
    ],
    timeline: [
      { time: "항해 D-1", description: "은표가 자동항법 앱의 원격 접근 권한을 몰래 확보." },
      { time: "당일 22:00", description: "심야 크루징 출항." },
      { time: "23:30", description: "은표가 스마트폰으로 항로를 암초 근처로 변경." },
      { time: "23:35", description: "배가 이상 항로로 진입, 선내 혼란 발생." },
      { time: "23:36", description: "혼란을 틈타 은표가 갑판의 선장을 밀침." },
      { time: "23:50", description: "다른 동승자가 쓰러진 선장을 발견." },
    ],
    evidence: [
      { id: "c28-e1", name: "자동항법 앱 로그", description: "23:30 은표의 계정으로 항로가 변경된 기록.", photo: photo("computer-log", "자동항법 앱 로그 화면") },
      { id: "c28-e2", name: "갑판 CCTV 스틸컷", description: "23:35경 갑판에서 포착된 흔들리는 실루엣.", photo: photo("security-camera", "요트 갑판 CCTV 스틸컷") },
      { id: "c28-e3", name: "요트 공동 소유 계약서", description: "은표와 피해자의 요트 공동 소유 지분이 명시된 계약서.", photo: photo("documents", "요트 공동 소유 계약서") },
      { id: "c28-e4", name: "보험 가입 내역", description: "최근 새로 상향 조정된 요트 보험 가입 내역.", photo: photo("financial-doc", "요트 보험 가입 내역") },
      { id: "c28-e5", name: "야간 항해 사진", description: "사건 당일 심야 요트 항해 모습.", photo: photo("car-night", "심야 요트 항해 전경") },
    ],
    messages: [
      { id: "c28-m1", from: "은표", to: "보험 설계사", time: "항해 D-5", content: "요트 보험, 최대한도로 조정 부탁드려요." },
      { id: "c28-m2", from: "피해자", to: "은표", time: "항해 D-2", content: "이번 크루징 끝나고 소유권 문제 정리 좀 하자." },
    ],
    testimonies: [
      { id: "c28-t1", witness: "은표", statement: "저는 그때 계속 조타실 반대편에 있었어요.", contradictsWith: ["c28-t2"] },
      { id: "c28-t2", witness: "동승자 하윤", statement: "혼란이 생겼을 때 은표 씨가 갑판 쪽으로 급히 움직이는 걸 봤어요.", contradictsWith: ["c28-t1"] },
    ],
    testimoniesLv3: [
      { id: "c28-t1", witness: "은표", statement: "저는 그때 계속 조타실 반대편에 있었어요.", contradictsWith: ["c28-t2", "c28-t3"] },
      { id: "c28-t2", witness: "동승자 하윤", statement: "혼란이 생겼을 때 은표 씨가 갑판 쪽으로 급히 움직이는 걸 봤어요.", contradictsWith: ["c28-t1"] },
      { id: "c28-t3", witness: "다른 동승자", statement: "은표 씨는 그 시간 계속 저희랑 선실 안에 있었다고 들었어요.", contradictsWith: ["c28-t1"] },
    ],
    lockedEvidence: [
      {
        id: "c28-locked-1",
        name: "항법 앱 포렌식 감정서",
        unlockHint: "항로 설정이 앱으로 원격 변경됐는지를 정확히 짚는 질문에서 초록불을 받아야 해금됩니다.",
        description: "앱 서비스 업체 협조로 확보한 포렌식 로그 — 23:30 은표 계정에서 항로 변경 명령이 전송된 사실이 확인됐다.",
        photo: photo("documents", "항법 앱 포렌식 감정서"),
        unlockTriggerId: "c28-q3",
      },
    ],
  }),
  b({
    id: "c-29-wax-museum",
    type: "B",
    difficultySupport: ["LV1", "LV2", "LV3"],
    title: "왁스 뮤지엄 야간 경비",
    synopsis:
      "왁스 뮤지엄 야간 경비 중, 경비원 한 명이 전시실에서 쓰러진 채 발견됐다. 곧이어 전시된 고가의 왁스 피규어 한 점이 파손됐다는 사실이 드러났는데, 파손 흔적이 어딘가 부자연스럽다.",
    truth:
      "동료 경비원 진혁이 근무 태만으로 순찰 중 고가 피규어를 실수로 파손했는데, 이를 숨기기 위해 '침입자 소행'으로 위장하려고 전시실 유리를 일부러 깨고 경보를 늦게 울렸다. 피해자가 순찰 기록의 모순을 발견하고 추궁하자 진혁이 밀쳐 넘어뜨렸다. 동기는 파손 배상 책임과 해고를 피하려는 것이었다.",
    answerRequiredKeywordGroups: [
      { label: "범인", keywords: ["진혁"] },
      { label: "트릭", keywords: ["침입자위장", "유리파손", "경보지연"] },
      { label: "동기", keywords: ["배상책임", "해고회피"] },
    ],
    questionBank: [
      { id: "c29-q1", sampleQuestion: "범인은 동료 경비원 진혁입니까?", keywords: ["진혁"], verdict: "green", importance: 3 },
      { id: "c29-q2", sampleQuestion: "실제로 외부 침입자가 있었습니까?", keywords: ["외부 침입자", "침입자"], verdict: "red", importance: 2 },
      { id: "c29-q3", sampleQuestion: "침입 흔적은 진혁이 위장한 것입니까?", keywords: ["침입자위장", "유리파손"], verdict: "green", importance: 3 },
      { id: "c29-q4", sampleQuestion: "동기는 파손 배상 책임과 해고를 피하려던 것입니까?", keywords: ["배상책임", "해고회피"], verdict: "green", importance: 3 },
      { id: "c29-q5", sampleQuestion: "피규어는 순찰 중 실수로 파손됐습니까?", keywords: ["순찰 중", "실수로 파손"], verdict: "green", importance: 2 },
      { id: "c29-q6", sampleQuestion: "경보 시스템 자체의 오작동입니까?", keywords: ["경보 오작동"], verdict: "red", importance: 1 },
      { id: "c29-q7", sampleQuestion: "진혁이 경보를 일부러 늦게 울렸습니까?", keywords: ["경보 지연", "늦게 울"], verdict: "green", importance: 2 },
      { id: "c29-q8", sampleQuestion: "피해자가 순찰 기록의 모순을 발견했습니까?", keywords: ["모순", "순찰 기록"], verdict: "green", importance: 2 },
    ],
    timeline: [
      { time: "22:00", description: "진혁이 순찰 중 실수로 고가 피규어를 파손." },
      { time: "22:10", description: "진혁이 전시실 유리를 일부러 깨 침입 흔적처럼 위장." },
      { time: "22:15", description: "진혁이 경보를 일부러 몇 분 늦게 작동시킴." },
      { time: "22:30", description: "피해자가 순찰 기록 시간이 앞뒤가 안 맞는 걸 발견." },
      { time: "22:32", description: "피해자가 추궁하자 진혁이 밀쳐 넘어뜨림." },
      { time: "22:45", description: "관리소장이 전시실에서 쓰러진 피해자를 발견." },
    ],
    evidence: [
      { id: "c29-e1", name: "파손된 왁스 피규어", description: "파손 각도가 외부 충격이 아닌 내부 접촉으로 보이는 피규어." },
      { id: "c29-e2", name: "전시실 유리 파편", description: "바깥이 아닌 안쪽에서 깨진 방향으로 흩어진 유리 파편.", photo: photo("broken-glass", "전시실 유리 파편") },
      { id: "c29-e3", name: "경보 시스템 작동 로그", description: "파손 시점보다 한참 늦게 작동한 경보 기록.", photo: photo("computer-log", "경보 시스템 작동 로그") },
      { id: "c29-e4", name: "순찰 기록표", description: "진혁이 순찰 시각을 앞당겨 기재한 순찰 기록표.", photo: photo("documents", "야간 순찰 기록표") },
      { id: "c29-e5", name: "피규어 배상 규정문", description: "파손 시 담당 경비원에게 배상 책임이 부과된다는 내부 규정." },
    ],
    messages: [
      { id: "c29-m1", from: "진혁", to: "동료 경비원", time: "22:12", content: "이거 알려지면 나 배상금에 잘리기까지 하는데, 어떡하지." },
      { id: "c29-m2", from: "동료 경비원", to: "진혁", time: "22:14", content: "일단 침착하게 생각해봐, 괜히 일 키우지 말고." },
    ],
    testimonies: [
      { id: "c29-t1", witness: "진혁", statement: "저는 그 시간엔 전시실 반대편을 순찰하고 있었어요.", contradictsWith: ["c29-t2"] },
      { id: "c29-t2", witness: "관리소장", statement: "22시쯤 진혁 씨가 피규어 전시실 쪽에서 나오는 걸 봤어요.", contradictsWith: ["c29-t1"] },
    ],
    testimoniesLv3: [
      { id: "c29-t1", witness: "진혁", statement: "저는 그 시간엔 전시실 반대편을 순찰하고 있었어요.", contradictsWith: ["c29-t2", "c29-t3"] },
      { id: "c29-t2", witness: "관리소장", statement: "22시쯤 진혁 씨가 피규어 전시실 쪽에서 나오는 걸 봤어요.", contradictsWith: ["c29-t1"] },
      { id: "c29-t3", witness: "동료 경비원", statement: "진혁 씨는 그 시간대 계속 반대편 구역만 순찰했다고 들었어요.", contradictsWith: ["c29-t1"] },
    ],
    lockedEvidence: [
      {
        id: "c29-locked-1",
        name: "유리 파손 방향 정밀 감정서",
        unlockHint: "침입 흔적이 위장된 것인지를 정확히 짚는 질문에서 초록불을 받아야 해금됩니다.",
        description: "파손 흔적 정밀 감정 결과 — 유리가 바깥이 아닌 안쪽에서 가해진 힘으로 깨졌다는 사실이 명확히 확인됐다.",
        photo: photo("documents", "유리 파손 방향 정밀 감정서"),
        unlockTriggerId: "c29-q3",
      },
    ],
  }),
  b({
    id: "c-30-comic-signing",
    type: "B",
    difficultySupport: ["LV1", "LV2", "LV3"],
    title: "대형서점 만화 사인회",
    synopsis:
      "인기 만화가의 사인회 도중, 서점 직원 한 명이 대기 줄 관리 구역에서 쓰러진 채 발견됐다. 곧이어 사인회에서 받은 친필 사인본들이 온라인 중고 거래에 대거 올라온 정황이 드러났다.",
    truth:
      "행사 대행업체 스태프 유찬이 사인회 대기표를 부정 발급해 대량으로 사인본을 받은 뒤 고가에 되파는 스캘핑을 벌였는데, 직원이 대기표 발급 수량 불일치를 발견하고 추궁하자 유찬이 밀쳐 넘어뜨렸다. 동기는 한정판 사인본 리셀로 큰 차익을 남기려던 것이었다.",
    answerRequiredKeywordGroups: [
      { label: "범인", keywords: ["유찬"] },
      { label: "트릭", keywords: ["대기표", "부정발급", "대량확보"] },
      { label: "동기", keywords: ["리셀", "되팔이", "차익"] },
    ],
    questionBank: [
      { id: "c30-q1", sampleQuestion: "범인은 행사 스태프 유찬입니까?", keywords: ["유찬"], verdict: "green", importance: 3 },
      { id: "c30-q2", sampleQuestion: "사인본이 정식 절차로 판매된 것입니까?", keywords: ["정식 절차", "정상 판매"], verdict: "red", importance: 2 },
      { id: "c30-q3", sampleQuestion: "대기표가 부정 발급됐습니까?", keywords: ["대기표", "부정발급"], verdict: "green", importance: 3 },
      { id: "c30-q4", sampleQuestion: "동기는 사인본을 리셀해 차익을 남기려던 것입니까?", keywords: ["리셀", "되팔이", "차익"], verdict: "green", importance: 3 },
      { id: "c30-q5", sampleQuestion: "만화가 본인이 관련돼 있습니까?", keywords: ["만화가 본인", "작가 가담"], verdict: "red", importance: 1 },
      { id: "c30-q6", sampleQuestion: "직원이 발급 수량 불일치를 발견했습니까?", keywords: ["수량 불일치", "발견"], verdict: "green", importance: 2 },
      { id: "c30-q7", sampleQuestion: "유찬이 대량의 대기표를 미리 확보했습니까?", keywords: ["대량", "미리 확보"], verdict: "green", importance: 2 },
      { id: "c30-q8", sampleQuestion: "손님들끼리 새치기 다툼이 원인입니까?", keywords: ["새치기", "손님끼리"], verdict: "red", importance: 1 },
    ],
    timeline: [
      { time: "사인회 D-2", description: "유찬이 대기표 발급 시스템에 접근할 권한을 확보." },
      { time: "사인회 당일 오전", description: "유찬이 대기표를 부정으로 대량 발급." },
      { time: "사인회 중반", description: "직원이 발급 수량과 실제 참가자 수가 안 맞는 걸 발견." },
      { time: "직후", description: "직원이 유찬을 추궁." },
      { time: "곧이어", description: "대기 줄 관리 구역에서 몸싸움, 직원이 넘어짐." },
    ],
    evidence: [
      { id: "c30-e1", name: "대기표 발급 시스템 로그", description: "유찬 계정으로 정상 수량보다 훨씬 많은 대기표가 발급된 기록.", photo: photo("computer-log", "대기표 발급 시스템 로그") },
      { id: "c30-e2", name: "온라인 중고 거래 게시글 캡처", description: "사인회 직후 대량으로 올라온 사인본 판매 게시글." },
      { id: "c30-e3", name: "대기 줄 관리 구역 CCTV 스틸컷", description: "몸싸움 직전 관리 구역의 두 사람.", photo: photo("corridor", "대기 줄 관리 구역 CCTV 스틸컷") },
      { id: "c30-e4", name: "유찬의 리셀 계좌 입금 내역", description: "사인본 판매로 입금된 내역이 담긴 계좌 명세.", photo: photo("financial-doc", "리셀 계좌 입금 내역") },
      { id: "c30-e5", name: "부정 발급된 대기표 뭉치", description: "유찬의 가방에서 발견된 미사용 대기표 뭉치." },
    ],
    messages: [
      { id: "c30-m1", from: "유찬", to: "리셀 구매자", time: "사인회 D-2", content: "이번 사인본, 물량 확실히 준비해드릴게요." },
      { id: "c30-m2", from: "직원", to: "유찬", time: "사인회 중반", content: "대기표 수량이 왜 이렇게 안 맞지? 확인 좀 해봐야겠어요." },
    ],
    testimonies: [
      { id: "c30-t1", witness: "유찬", statement: "저는 대기표는 정해진 수량만 정상적으로 발급했어요.", contradictsWith: ["c30-t2"] },
      { id: "c30-t2", witness: "서점 매니저", statement: "유찬 씨 계정으로 발급된 대기표 수가 신청 인원보다 훨씬 많았어요.", contradictsWith: ["c30-t1"] },
    ],
    testimoniesLv3: [
      { id: "c30-t1", witness: "유찬", statement: "저는 대기표는 정해진 수량만 정상적으로 발급했어요.", contradictsWith: ["c30-t2", "c30-t3"] },
      { id: "c30-t2", witness: "서점 매니저", statement: "유찬 씨 계정으로 발급된 대기표 수가 신청 인원보다 훨씬 많았어요.", contradictsWith: ["c30-t1"] },
      { id: "c30-t3", witness: "동료 스태프", statement: "유찬 씨는 대기표 시스템을 아예 다뤄본 적이 없다고 하던데요.", contradictsWith: ["c30-t1"] },
    ],
    lockedEvidence: [
      {
        id: "c30-locked-1",
        name: "발급 시스템 포렌식 감정서",
        unlockHint: "대기표가 부정 발급됐는지를 정확히 짚는 질문에서 초록불을 받아야 해금됩니다.",
        description: "시스템 포렌식 감정 결과 — 유찬 계정에서 정상 절차를 우회한 대량 발급 명령이 반복 실행된 기록이 확인됐다.",
        photo: photo("documents", "발급 시스템 포렌식 감정서"),
        unlockTriggerId: "c30-q3",
      },
    ],
  }),
  b({
    id: "c-31-livestream-collab",
    type: "B",
    difficultySupport: ["LV1", "LV2", "LV3"],
    title: "온라인 방송 스트리머 합방 사고",
    synopsis:
      "인기 스트리머 두 명의 합동 방송 도중, 한 명이 방송 중 갑자기 화면 밖으로 쓰러졌다. 시청자들은 도네이션 알림음이 이상하게 겹쳐 울렸던 걸 기억한다.",
    truth:
      "합방 상대였던 스트리머 予準(예준)이 후원 알림 봇을 조작해, 상대 스트리머의 과거 비공개 발언을 담은 음성 파일을 도네이션 문구로 위장해 방송에 강제로 재생시켰다. 피해자가 이 사실에 큰 충격을 받고 방송 중 쓰러졌다. 동기는 예준이 상대방의 구독자를 빼앗아오려는 악의적 화제몰이였다.",
    answerRequiredKeywordGroups: [
      { label: "범인", keywords: ["예준"] },
      { label: "트릭", keywords: ["후원봇", "음성파일", "강제재생"] },
      { label: "동기", keywords: ["구독자", "화제몰이", "악의적"] },
    ],
    questionBank: [
      { id: "c31-q1", sampleQuestion: "범인은 합방 상대 스트리머 예준입니까?", keywords: ["예준"], verdict: "green", importance: 3 },
      { id: "c31-q2", sampleQuestion: "정말 시청자가 보낸 정상적인 도네이션이었습니까?", keywords: ["정상 도네이션", "시청자가 보낸"], verdict: "red", importance: 2 },
      { id: "c31-q3", sampleQuestion: "후원 알림 봇을 조작해 음성을 강제로 재생시켰습니까?", keywords: ["후원봇", "강제재생"], verdict: "green", importance: 3 },
      { id: "c31-q4", sampleQuestion: "재생된 건 피해자의 과거 비공개 발언 음성이었습니까?", keywords: ["비공개 발언", "음성파일"], verdict: "green", importance: 2 },
      { id: "c31-q5", sampleQuestion: "동기는 구독자를 빼앗기 위한 화제몰이였습니까?", keywords: ["구독자", "화제몰이", "악의적"], verdict: "green", importance: 3 },
      { id: "c31-q6", sampleQuestion: "방송 플랫폼 시스템 오류입니까?", keywords: ["플랫폼 오류", "시스템 오류"], verdict: "red", importance: 1 },
      { id: "c31-q7", sampleQuestion: "제3의 해커가 봇을 조작했습니까?", keywords: ["해커", "제3자"], verdict: "red", importance: 1 },
      { id: "c31-q8", sampleQuestion: "예준이 사건 며칠 전부터 음성 파일을 확보해뒀습니까?", keywords: ["며칠 전", "음성 파일 확보"], verdict: "green", importance: 2 },
    ],
    timeline: [
      { time: "합방 D-5", description: "예준이 피해자의 과거 비공개 발언 음성 파일을 입수." },
      { time: "합방 D-2", description: "예준이 후원 알림 봇 설정에 접근해 강제 재생 스크립트를 심음." },
      { time: "합방 당일", description: "방송 시작, 시청자들과 자연스럽게 진행." },
      { time: "방송 중반", description: "예준이 스크립트를 작동시켜 음성 파일이 도네이션으로 위장돼 재생." },
      { time: "직후", description: "피해자가 충격으로 방송 중 쓰러짐." },
    ],
    evidence: [
      { id: "c31-e1", name: "후원 알림 봇 설정 로그", description: "예준 계정으로 강제 재생 스크립트가 등록된 설정 기록.", photo: photo("computer-log", "후원 알림 봇 설정 로그") },
      { id: "c31-e2", name: "재생된 음성 파일 원본", description: "도네이션으로 위장돼 재생된 음성 파일의 원본." },
      { id: "c31-e3", name: "예준과 정보원의 메시지 내역", description: "비공개 발언 음성을 입수한 경로가 담긴 메시지 내역." },
      { id: "c31-e4", name: "구독자 수 변동 그래프", description: "사건 직후 예준 채널로 구독자가 대거 이동한 그래프." },
      { id: "c31-e5", name: "방송 장비 접속 기록", description: "합방 D-2 예준이 방송 시스템 설정에 접근한 기록.", photo: photo("keypad", "방송 장비 접속 패널") },
    ],
    messages: [
      { id: "c31-m1", from: "예준", to: "정보원", time: "합방 D-5", content: "그 음성 파일, 확실한 거 맞죠? 이번에 제대로 써먹을게요." },
      { id: "c31-m2", from: "예준", to: "친구", time: "합방 D-2", content: "이번 합방에서 화제 제대로 몰고 갈 준비 끝났어." },
    ],
    testimonies: [
      { id: "c31-t1", witness: "예준", statement: "저도 그 도네이션 보고 완전 놀랐어요, 저랑은 상관없는 일이에요.", contradictsWith: ["c31-t2"] },
      { id: "c31-t2", witness: "방송 스태프", statement: "합방 이틀 전에 예준 씨가 후원 봇 설정 화면을 계속 만지고 있었어요.", contradictsWith: ["c31-t1"] },
    ],
    testimoniesLv3: [
      { id: "c31-t1", witness: "예준", statement: "저도 그 도네이션 보고 완전 놀랐어요, 저랑은 상관없는 일이에요.", contradictsWith: ["c31-t2", "c31-t3"] },
      { id: "c31-t2", witness: "방송 스태프", statement: "합방 이틀 전에 예준 씨가 후원 봇 설정 화면을 계속 만지고 있었어요.", contradictsWith: ["c31-t1"] },
      { id: "c31-t3", witness: "예준의 매니저", statement: "예준 씨는 방송 설정 쪽은 아예 다룰 줄 모른다고 알고 있어요.", contradictsWith: ["c31-t1"] },
    ],
    lockedEvidence: [
      {
        id: "c31-locked-1",
        name: "후원 봇 시스템 포렌식 감정서",
        unlockHint: "후원 알림 봇이 조작돼 강제로 음성을 재생시켰는지를 정확히 짚는 질문에서 초록불을 받아야 해금됩니다.",
        description: "플랫폼 보안팀의 포렌식 감정 결과 — 강제 재생 스크립트가 예준 계정에서 합방 이틀 전 등록된 사실이 확인됐다.",
        photo: photo("documents", "후원 봇 시스템 포렌식 감정서"),
        unlockTriggerId: "c31-q3",
      },
    ],
  }),
  b({
    id: "c-32-golf-course",
    type: "B",
    difficultySupport: ["LV1", "LV2", "LV3"],
    title: "골프장 새벽 라운딩 실종",
    synopsis:
      "이른 새벽 프라이빗 라운딩 도중, 동반자 한 명이 홀 사이 숲길에서 실종됐다. 카트 GPS 기록상 전원이 계속 페어웨이 위에만 있었던 것으로 나오는데, 실제로 그랬을까?",
    truth:
      "사업 파트너였던 승우가 카트에 부착된 GPS 트래커 신호를 미리 준비한 신호 증폭 중계기로 조작해, 실제 이동 경로와 다른 '정상 경로'가 기록되도록 만들었다. 그 틈에 숲길로 피해자를 유인해 사업 자금 문제로 다투다 피해자를 놓아둔 채 자리를 떴다. 동기는 승우가 동업 자금을 횡령한 사실을 피해자가 알아채 정산을 요구한 것이었다.",
    answerRequiredKeywordGroups: [
      { label: "범인", keywords: ["승우"] },
      { label: "트릭", keywords: ["gps", "신호조작", "중계기"] },
      { label: "동기", keywords: ["횡령", "정산", "동업자금"] },
    ],
    questionBank: [
      { id: "c32-q1", sampleQuestion: "범인은 사업 파트너 승우입니까?", keywords: ["승우"], verdict: "green", importance: 3 },
      { id: "c32-q2", sampleQuestion: "GPS 기록이 실제 이동 경로와 일치합니까?", keywords: ["gps 일치", "실제 경로"], verdict: "red", importance: 2 },
      { id: "c32-q3", sampleQuestion: "GPS 신호가 중계기로 조작됐습니까?", keywords: ["gps", "신호조작", "중계기"], verdict: "green", importance: 3 },
      { id: "c32-q4", sampleQuestion: "동기는 동업 자금 횡령 문제입니까?", keywords: ["횡령", "정산", "동업자금"], verdict: "green", importance: 3 },
      { id: "c32-q5", sampleQuestion: "캐디가 관련돼 있습니까?", keywords: ["캐디", "관련"], verdict: "red", importance: 1 },
      { id: "c32-q6", sampleQuestion: "피해자가 숲길로 유인당했습니까?", keywords: ["유인", "숲길"], verdict: "green", importance: 2 },
      { id: "c32-q7", sampleQuestion: "승우가 사건 전 중계기를 미리 준비했습니까?", keywords: ["중계기", "미리 준비"], verdict: "green", importance: 2 },
      { id: "c32-q8", sampleQuestion: "피해자가 길을 잃고 스스로 숲으로 들어갔습니까?", keywords: ["길을 잃", "스스로"], verdict: "red", importance: 1 },
    ],
    timeline: [
      { time: "라운딩 D-2", description: "승우가 GPS 신호 증폭 중계기를 구입." },
      { time: "당일 새벽", description: "라운딩 시작, 승우가 카트에 중계기 설치." },
      { time: "3번 홀 인근", description: "승우가 피해자를 숲길로 유인." },
      { time: "직후", description: "자금 정산 문제로 다툼." },
      { time: "곧이어", description: "승우가 피해자를 숲길에 두고 카트로 복귀." },
      { time: "1시간 후", description: "다른 동반자들이 피해자가 없어진 걸 확인." },
    ],
    evidence: [
      { id: "c32-e1", name: "GPS 트래커 신호 기록", description: "실제 이동 경로와 어긋나는 GPS 트래커 기록.", photo: photo("computer-log", "GPS 트래커 신호 기록 화면") },
      { id: "c32-e2", name: "신호 증폭 중계기", description: "승우의 카트 좌석 아래에서 발견된 소형 중계기." },
      { id: "c32-e3", name: "숲길 발자국 사진", description: "정규 경로를 벗어난 숲길에서 발견된 발자국.", photo: photo("footprint", "숲길 발자국") },
      { id: "c32-e4", name: "동업 자금 정산 요청 메모", description: "피해자가 승우에게 전달하려던 자금 정산 요청 메모." },
      { id: "c32-e5", name: "승우의 중계기 구입 영수증", description: "라운딩 이틀 전 온라인으로 구입한 중계기 결제 영수증.", photo: photo("receipt", "중계기 구입 영수증") },
    ],
    messages: [
      { id: "c32-m1", from: "피해자", to: "승우", time: "라운딩 D-3", content: "동업 자금 내역, 이번 라운딩 때 확실히 짚고 넘어가자." },
      { id: "c32-m2", from: "승우", to: "지인", time: "라운딩 D-2", content: "이번엔 확실하게 준비해서 나가야 해." },
    ],
    testimonies: [
      { id: "c32-t1", witness: "승우", statement: "저는 계속 페어웨이 위에서만 플레이했어요, GPS 기록 보시면 알잖아요.", contradictsWith: ["c32-t2"] },
      { id: "c32-t2", witness: "캐디", statement: "3번 홀 인근에서 승우 님 카트가 잠깐 숲길 쪽으로 들어갔던 것 같아요.", contradictsWith: ["c32-t1"] },
    ],
    testimoniesLv3: [
      { id: "c32-t1", witness: "승우", statement: "저는 계속 페어웨이 위에서만 플레이했어요, GPS 기록 보시면 알잖아요.", contradictsWith: ["c32-t2", "c32-t3"] },
      { id: "c32-t2", witness: "캐디", statement: "3번 홀 인근에서 승우 님 카트가 잠깐 숲길 쪽으로 들어갔던 것 같아요.", contradictsWith: ["c32-t1"] },
      { id: "c32-t3", witness: "다른 동반자", statement: "승우 씨는 그 시간 내내 저희 카트 바로 옆에 있었다고 하던데요.", contradictsWith: ["c32-t1"] },
    ],
    lockedEvidence: [
      {
        id: "c32-locked-1",
        name: "GPS 신호 정밀 포렌식 감정서",
        unlockHint: "GPS 신호가 중계기로 조작됐는지를 정확히 짚는 질문에서 초록불을 받아야 해금됩니다.",
        description: "위치 신호 정밀 포렌식 결과 — 기록된 신호 패턴이 실제 위성 신호가 아닌 지상 중계기 신호와 일치했다.",
        photo: photo("documents", "GPS 신호 정밀 포렌식 감정서"),
        unlockTriggerId: "c32-q3",
      },
    ],
  }),
];

export const SCENARIOS: readonly Scenario[] = [SCENARIO_A_HAJUN_SORA, ...SCENARIO_B_LIST, ...SCENARIO_C_LIST];

export const SCENARIOS_BY_ID: Readonly<Record<string, Scenario>> = Object.fromEntries(
  SCENARIOS.map((s) => [s.id, s]),
);

export function getScenario(id: string): Scenario {
  const scenario = SCENARIOS_BY_ID[id];
  if (!scenario) throw new Error(`Unknown hill-of-truth scenario id: ${id}`);
  return scenario;
}

/** 유형 A 1개 + 유형 B 목록 중 시드로 결정론적 롤링(락스텝 계약 — Math.random 금지). */
export function rollScenarioId(rng: () => number): string {
  const idx = Math.floor(rng() * SCENARIOS.length);
  return SCENARIOS[Math.min(idx, SCENARIOS.length - 1)].id;
}
