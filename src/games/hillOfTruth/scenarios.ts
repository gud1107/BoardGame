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

export interface EvidenceItem {
  id: string;
  name: string;
  description: string;
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

export const SCENARIOS: readonly Scenario[] = [SCENARIO_A_HAJUN_SORA, ...SCENARIO_B_LIST];

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
