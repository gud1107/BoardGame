/**
 * Game-specific detail stats carried in `GameSelfResult.details`.
 *
 * Merge rule (mirrored by `merge_stat_details()` in supabase/player_stats.sql
 * — keep the two in sync): keys starting with `max` keep the highest value,
 * keys starting with `min` keep the lowest, every other key is summed.
 * Values are non-negative numbers.
 */
import { RP_GAIN_KEY, rpFromDetails, tierOf } from "./rankTier";
export type StatDetails = Record<string, number>;

export function mergeStatDetails(base: StatDetails | undefined, delta: StatDetails | undefined): StatDetails {
  const out: StatDetails = { ...(base ?? {}) };
  for (const [key, value] of Object.entries(delta ?? {})) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const prev = out[key];
    if (key.startsWith("max")) out[key] = Math.max(prev ?? value, value);
    else if (key.startsWith("min")) out[key] = Math.min(prev ?? value, value);
    else out[key] = (prev ?? 0) + value;
  }
  return out;
}

interface DetailRow {
  label: string;
  value: (d: StatDetails, played: number) => string | null;
}

const n = (v: number | undefined) => (v ?? 0).toLocaleString("ko-KR");
const ratio = (hit: number | undefined, total: number | undefined) =>
  total ? `${Math.round(((hit ?? 0) / total) * 100)}% (${n(hit)}/${n(total)})` : null;
const avg = (sum: number | undefined, count: number, digits = 1) =>
  count > 0 && sum !== undefined ? (sum / count).toFixed(digits) : null;

const waves3 = (...v: (number | undefined)[]) => (v.some((x) => x) ? v.map((x) => (x ? `W${n(x)}` : "-")).join(" · ") : null);

/** One-line headline per 1-player game for the /stats 솔로 기록 table. */
export const SOLO_HEADLINE: Record<string, (d: StatDetails) => string> = {
  "hungry-shark": (d) => `최고 ${n(d.maxScore)}점 · 🔥 최고 연속 올클리어 ${n(d.maxMissionStreak)}회`,
  "crab-survival": (d) => `최고 ${n(d.maxScore)}점 · 👑 1등 ${n(d.firsts)}회${d.minRank !== undefined ? ` · 최고 ${n(d.minRank)}위` : ""}`,
  "prism-five": (d) => `최고 ${n(d.maxScore)}점 · STAGE ${n(d.maxStage)} · 최대 ${n(d.maxCombo)}콤보`,
};

/** What /stats shows per game — only games listed here have a detail panel. */
export const STAT_DETAIL_ROWS: Record<string, DetailRow[]> = {
  "great-legacy": [
    { label: "최고 점수", value: (d) => n(d.maxScore) },
    { label: "평균 점수", value: (d, played) => avg(d.totalScore, played) },
    { label: "최고가 낙찰", value: (d) => `${n(d.maxWinningBid)}코인` },
    {
      label: "투자 효율 (자산점수 ÷ 낙찰가)",
      value: (d) => (d.totalPaid ? `${((d.totalAssetScore ?? 0) / d.totalPaid).toFixed(2)}점/코인` : null),
    },
    { label: "완성한 컬렉션", value: (d) => `${n(d.synergies)}개 (한 판 최고 ${n(d.maxSynergies)}개)` },
    { label: "초대형호재 / 악재 맞은 자산", value: (d) => `${n(d.boosted)} / ${n(d.crashed)}` },
    { label: "상장폐지·반대매매로 잃은 자산", value: (d) => n(d.delisted) },
    { label: "코인 0으로 끝낸 판 (파산)", value: (d) => n(d.brokeGames) },
  ],
  "bluff-roulette": [
    { label: "\"거짓말!\" 적중률", value: (d) => ratio(d.liarCorrect, d.liarCalls) },
    { label: "들킨 거짓말 / 거짓 선언", value: (d) => `${n(d.liesCaught)} / ${n(d.liesTold)}` },
    { label: "방아쇠 생존 / 당긴 방아쇠", value: (d) => `${n(d.survivedPulls)} / ${n(d.triggerPulls)}` },
    { label: "한 판 최다 생존 방아쇠", value: (d) => n(d.maxPullsSurvived) },
    { label: "방아쇠 없이 1위", value: (d) => n(d.flawlessWins) },
    { label: "해골 발동", value: (d) => n(d.skullTriggers) },
  ],
  "tavern-brawl": [
    {
      label: "🏆 랭크",
      value: (d) => (d[RP_GAIN_KEY] === undefined ? null : `${tierOf(rpFromDetails(d)).tier.emoji} ${tierOf(rpFromDetails(d)).tier.name} · ${n(rpFromDetails(d))} RP`),
    },
    { label: "1위 / 4위 안", value: (d) => `${n(d.firstPlaces)} / ${n(d.topFour)}` },
    { label: "황금 유닛", value: (d) => n(d.triples) },
    { label: "전투 승리", value: (d) => n(d.combatWins) },
    { label: "여관 6등급 도달", value: (d) => n(d.tier6) },
    { label: "준 피해 합계", value: (d) => n(d.damageDealt) },
  ],
  "god-life-planner": [
    { label: "한 판 최고 점수", value: (d) => n(d.maxScore) },
    { label: "인생 목표 달성", value: (d) => n(d.goalsMet) },
    { label: "만든 습관", value: (d) => n(d.habitsFormed) },
    { label: "붕괴 없는 일주일", value: (d) => n(d.flawlessWeeks) },
    { label: "약속 성사 / 기회 카드", value: (d) => `${n(d.matches)} / ${n(d.opportunities)}` },
  ],
  chess: [
    { label: "체크메이트 승 / 빠른 메이트", value: (d) => `${n(d.mateWins)} / ${n(d.quickMates)}` },
    { label: "수 / 체크", value: (d) => `${n(d.moves)} / ${n(d.checks)}` },
    { label: "잡은 기물 (한 판 최다)", value: (d) => `${n(d.captures)}개 (${n(d.maxCaptures)})` },
    { label: "캐슬링 / 앙파상", value: (d) => `${n(d.castles)} / ${n(d.enPassants)}` },
    { label: "승진 (언더프로모션)", value: (d) => `${n(d.promotions)} (${n(d.underPromotions)})` },
  ],
  "tagger-among-us": [
    { label: "🏃 탈출 / 도망자 판 (한 번도 안 얼고)", value: (d) => `${n(d.escapes)} / ${n(d.runnerGames)} (${n(d.cleanEscapes)})` },
    { label: "🧧 봉인 · 🫱 땡! · ❄ 얼음", value: (d) => `${n(d.seals)} · ${n(d.thaws)} · ${n(d.frozen)}` },
    { label: "🧂 소금 명중 / 뿌림 (변장 들춤 · 친구 맞힘)", value: (d) => `${n(d.saltHits)} / ${n(d.salts)} (${n(d.unmasks)} · ${n(d.friendly)})` },
    { label: "👹 술래 승 / 술래 판 (전원 저지)", value: (d) => `${n(d.taggerWins)} / ${n(d.taggerGames)} (${n(d.sweeps)})` },
    { label: "❄ 얼린 횟수 (한 판 최다) · 👣 걷어참", value: (d) => `${n(d.catches)} (${n(d.maxCatches)}) · ${n(d.kicks)}` },
    { label: "⏱ 가장 빠른 탈출", value: (d) => (d.minEscapeSec !== undefined ? `${n(d.minEscapeSec)}초` : "-") },
  ],
  "mannequin-mall": [
    { label: "🚪 탈출 / 팀 승리 (전원 무사 S)", value: (d) => `${n(d.escapes)} / ${n(d.teamWins)} (${n(d.perfect)})` },
    { label: "⚡ 퓨즈 찾음 / 꽂음 · 뒤진 상자", value: (d) => `${n(d.fuseFound)} / ${n(d.fusePlaced)} · ${n(d.searches)}` },
    { label: "👁 붙들어 둔 시간 · 🔦 쓰러뜨림 · 🛡 동료 구함", value: (d) => `${n(d.stareSec)}초 · ${n(d.topples)} · ${n(d.saves)}` },
    { label: "📸 플래시 (드러냄) · 🎀 묶음 (그냥 마네킹)", value: (d) => `${n(d.flashes)} (${n(d.revealed)}) · ${n(d.binds)} (${n(d.decoys)})` },
    { label: "✚ 풀어 준 동료 · 붙잡힘", value: (d) => `${n(d.revives)} · ${n(d.downs)}` },
    { label: "⏱ 가장 빠른 탈출 · 🔦 혼자 탈출 · 💀 악몽 탈출", value: (d) => `${d.minEscapeSec !== undefined ? `${n(d.minEscapeSec)}초` : "-"} · ${n(d.soloEscapes)} · ${n(d.nightmareEscapes)}` },
  ],
  "possession-night": [
    { label: "🏆 승리 · 🧿 퇴마사 승/판 · 👻 원귀 승/판", value: (d) => `${n(d.wins)} · ${n(d.hunterWins)}/${n(d.hunterGames)} · ${n(d.ghostWins)}/${n(d.ghostGames)}` },
    { label: "🪆 찾음 / 태움 · 뒤진 곳 · 🏮 등잔", value: (d) => `${n(d.cursesFound)} / ${n(d.burned)} · ${n(d.searches)} · ${n(d.lanterns)}` },
    { label: "💧 성수 맞힘/뿌림 · 🍵 청심환 · ✚ 퇴마해 줌", value: (d) => `${n(d.waterHits)}/${n(d.waters)} · ${n(d.teas)} · ${n(d.revives)}` },
    { label: "👻 빙의당함 · 😱 공황 · 🔥 의식 곁", value: (d) => `${n(d.possessed)} · ${n(d.panics)} · ${n(d.ritualSec)}초` },
    { label: "👻 원귀: 빙의 · 🗣️ 속삭임 · 💥 덜컹 · 👁️ 현신 · 💧 맞음", value: (d) => `${n(d.possessions)} · ${n(d.whispers)} · ${n(d.slams)} · ${n(d.manifests)} · ${n(d.hits)}` },
    { label: "⏱ 가장 빠른 승리", value: (d) => (d.minWinSec !== undefined ? `${n(d.minWinSec)}초` : "-") },
  ],
  "hushed-ward": [
    { label: "🚪 탈출 / 팀 승리 (전원 무사 S)", value: (d) => `${n(d.escapes)} / ${n(d.teamWins)} (${n(d.perfect)})` },
    { label: "🧧 부적 찾음 / 붙임 · 뒤진 서랍", value: (d) => `${n(d.talFound)} / ${n(d.talPlaced)} · ${n(d.searches)}` },
    { label: "😱 쫓김 / 붙잡힘 · 🧿 타 버린 부적", value: (d) => `${n(d.hunted)} / ${n(d.downs)} · ${n(d.charmsBurnt)}` },
    { label: "✚ 일으킨 동료 · 🔔 들키지 않고 넘긴 종", value: (d) => `${n(d.revives)} · ${n(d.hushOk)}` },
    { label: "🍾 던진 약병 / 💊 진정제", value: (d) => `${n(d.bottles)} / ${n(d.pills)}` },
    { label: "⏱ 가장 빠른 탈출 · 🔦 혼자 탈출 · 💀 악몽 탈출", value: (d) => `${d.minEscapeSec !== undefined ? `${n(d.minEscapeSec)}초` : "-"} · ${n(d.soloEscapes)} · ${n(d.nightmareEscapes)}` },
  ],
  "rope-climbers": [
    { label: "🚩 완등 (⭐⭐⭐ · 🌋 화산)", value: (d) => `${n(d.summits)} (${n(d.stars3)} · ${n(d.volcano)})` },
    { label: "🧗 선등 / 💪 끌어올림", value: (d) => `${n(d.leadM)}m / ${n(d.haulM)}m` },
    { label: "🪢 받아냄 / 줄 덕에 삶", value: (d) => `${n(d.catches)} / ${n(d.saved)}` },
    { label: "😵 손 놓침 / 🪨 낙석 맞음 / 💥 팀 추락", value: (d) => `${n(d.slips)} / ${n(d.rockHits)} / ${n(d.falls)}` },
    { label: "⭐ 별 · 📍 최고 높이", value: (d) => `${n(d.stars)}개 · ${n(d.maxAlt)}m` },
    { label: "🪢 줄에 매달린 시간", value: (d) => `${n(d.hangSec)}초` },
  ],
  "beat-mayhem": [
    { label: "🎵 친 곡 / 🏆 곡 1등", value: (d) => `${n(d.songs)} / ${n(d.roundWins)}` },
    { label: "퍼펙트 / 그레이트 / 굿 / 미스", value: (d) => `${n(d.perfects)} / ${n(d.greats)} / ${n(d.goods)} / ${n(d.misses)}` },
    { label: "🔥 최대 콤보 · ✨ 풀 콤보", value: (d) => `${n(d.maxCombo)} · ${n(d.fullCombos)}곡` },
    { label: "🎯 한 곡 최고 정확도", value: (d) => `${n(d.maxAcc)}%` },
    { label: "⚡ 쏜 장난 / 🛡 막음 / 😵 걸림", value: (d) => `${n(d.pranksSent)} / ${n(d.pranksBlocked)} / ${n(d.pranksTaken)}` },
  ],
  "billiards-party": [
    { label: "🎱 넣은 공 (⭐9 · ×2)", value: (d) => `${n(d.pots)} (${n(d.golds)} · ${n(d.luckyPots)})` },
    { label: "🔥 최다 연속 득점 · 한 번에 최다", value: (d) => `${n(d.bestRun)}타 · ${n(d.bestShot)}개` },
    { label: "🎯 캐롬 / 🌈 쓰리쿠션", value: (d) => `${n(d.caroms)} / ${n(d.threeCushions)}` },
    { label: "❌ 반칙 (흰 공 빠짐)", value: (d) => `${n(d.fouls)} (${n(d.scratches)})` },
    { label: "🏆 판 1등 · 친 횟수", value: (d) => `${n(d.rackWins)} · ${n(d.shots)}타` },
  ],
  "domino-chain": [
    { label: "🔔 울린 종 (가운데 큰 종)", value: (d) => `${n(d.bells)} (${n(d.bigBells)})` },
    { label: "🦝 가로챈 도미노", value: (d) => `${n(d.steals)}개` },
    { label: "🁢 쓰러뜨림 · 최장 사슬", value: (d) => `${n(d.toppled)} · ${n(d.maxChain)}개` },
    { label: "🏁 최장 보너스 / 💣 폭탄", value: (d) => `${n(d.longest)} / ${n(d.bombs)}` },
    { label: "🧱 세운 도미노 · 🔀 · 벽", value: (d) => `${n(d.placed)} · ${n(d.splits)} · ${n(d.walls)}` },
    { label: "🏆 라운드 1등 · 최고 라운드", value: (d) => `${n(d.roundWins)} · ${n(d.bestRound)}점` },
  ],
  "snowball-fort": [
    { label: "🏆 팀 승리 / 이긴 라운드", value: (d) => `${n(d.matchWins)} / ${n(d.roundWins)}` },
    { label: "🎯 맞힘 / 던짐 · ❄️ 얼림", value: (d) => `${n(d.hits)} / ${n(d.throws)} · ${n(d.freezes)}` },
    { label: "☃️ 눈사람 명중 · 🏁 마무리", value: (d) => `${n(d.snowmanHits)} · ${n(d.finishers)}` },
    { label: "🧱 세운 벽 / 부순 벽", value: (d) => `${n(d.walls)} / ${n(d.wallBreaks)}` },
    { label: "🌈 포물선 명중 · 🥶 얼음", value: (d) => `${n(d.lobHits)} · ${n(d.frozen)}` },
    { label: "⛄ 뭉친 눈덩이 · 🍫 아이템 · 🌟 MVP", value: (d) => `${n(d.gathered)} · ${n(d.items)} · ${n(d.mvps)}` },
  ],
  "parcel-panic": [
    { label: "📦 실은 상자 (점수) · 🔥 최고 연속", value: (d) => `${n(d.loads)} (${n(d.loadValue)}) · ${n(d.bestStreak)}` },
    { label: "🤝 협동 클리어 · ★3 · 최고 팀 점수", value: (d) => `${n(d.coopClears)} · ${n(d.threeStars)} · ${n(d.maxTeamScore)}` },
    { label: "🎯 슛 / 던지기 · 🙌 받기 · 🔍 스캔", value: (d) => `${n(d.shots)} / ${n(d.throws)} · ${n(d.catches)} · ${n(d.scans)}` },
    { label: "🛋️ 둘이서 · ⚡ 시간 안 · 🚚 가득 채움", value: (d) => `${n(d.heavyDuo)} · ${n(d.expressOnTime)} · ${n(d.fullTrucks)}` },
    { label: "🥚 깨뜨림·녹임 · 🚜 지게차 · ⚔️ 들이받기 / 당함", value: (d) => `${n(d.breaks)} · ${n(d.forkHits)} · ${n(d.knocks)} / ${n(d.knocked)}` },
  ],
  "toy-room-race": [
    { label: "🏁 레이스 1등 / 레이스 수 · 🏆 그랑프리 우승", value: (d) => `${n(d.raceWins)} / ${n(d.races)} · ${n(d.gpWins)}` },
    { label: "⏱ 가장 빠른 랩", value: (d) => (d.minLapCs ? `${Math.floor(d.minLapCs / 6000)}:${((d.minLapCs % 6000) / 100).toFixed(2).padStart(5, "0")}` : null) },
    { label: "⬆️ 추월 · 🚀 출발 부스트 (시동 꺼짐)", value: (d) => `${n(d.passes)} · ${n(d.rockets)} (${n(d.stalls)})` },
    { label: "🌀 드리프트 부스트 (2단) · ✨ 완벽한 착지", value: (d) => `${n(d.driftBoosts)} (${n(d.bigDrifts)}) · ${n(d.perfectLands)}` },
    { label: "🎁 아이템 · 🎯 맞힘 / 💫 맞음 · 🫧 막음", value: (d) => `${n(d.items)} · ${n(d.hits)} / ${n(d.spun)} · ${n(d.blocked)}` },
    { label: "🧸 장난감 투하 / 선두 명중 · 🧱 박음", value: (d) => `${n(d.toyDrops)} / ${n(d.toyHits)} · ${n(d.crashes)}` },
  ],
  "finders-keepers": [
    { label: "🧺 넣은 값 (개수) · 한 번 최고", value: (d) => `${n(d.depositValue)} (${n(d.deposits)}) · ${n(d.bestRun)}점` },
    { label: "🧸 바닥 줍기 · ✂️ 가로채기 (값)", value: (d) => `${n(d.picks)} · ${n(d.snatches)} (${n(d.snatchedValue)})` },
    { label: "😱 가로채기 당함 (값) · 😭 줄에 남김", value: (d) => `${n(d.lost)} (${n(d.lostValue)}) · ${n(d.wastedValue)}` },
    { label: "🌈 세트 보너스 · 🏷️ 타임세일 덤 · 🎖 목표", value: (d) => `${n(d.setBonus)} · ${n(d.saleBonus)} · ${n(d.goalsWon)}` },
    { label: "🔥 털기 / 털림 · ✂️ 줄 끊기 · 🤝 넘기기", value: (d) => `${n(d.loots)} / ${n(d.looted)} · ${n(d.cuts)} · ${n(d.passes)}` },
    { label: "🏆 트로피 · 💣 떠넘김 / 펑", value: (d) => `${n(d.trophies)} · ${n(d.bombPasses)} / ${n(d.bombBooms)}` },
  ],
  "crown-thief": [
    { label: "👑 왕관 쓴 시간 합 · 한 번 최장", value: (d) => `${n(d.crownSec)}초 · ${n(d.bestReignSec)}초` },
    { label: "🦹 뺏기 / 뺏김 / 바닥 줍기", value: (d) => `${n(d.steals)} / ${n(d.lost)} / ${n(d.pickups)}` },
    { label: "💨 돌진 (박치기) · 📣 호령 (밀침)", value: (d) => `${n(d.dashes)} (${n(d.dashHits)}) · ${n(d.roars)} (${n(d.roarHits)})` },
    { label: "☁️ 떨어짐 (혼자) / 💥 떨어뜨림 (왕)", value: (d) => `${n(d.falls)} (${n(d.selfFalls)}) / ${n(d.kos)} (${n(d.kingKos)})` },
    { label: "🎁 아이템 · 🍌 미끄러뜨림 · 🌀 점프대", value: (d) => `${n(d.items)} · ${n(d.bananaHits)} · ${n(d.padJumps)}` },
    { label: "💀 저주 쌓인 시간 · 저주 모드 1등", value: (d) => `${n(d.curseSec)}초 · ${n(d.curseWins)}` },
  ],
  "cloud-squadron": [
    { label: "🏁 원정 성공 · 돌파한 스테이지 · 보스 격파", value: (d) => `${n(d.clears)} · ${n(d.stagesCleared)} · ${n(d.bossKills)}` },
    { label: "💥 격추 · 💚 동료 부활 · 🪂 격추당함", value: (d) => `${n(d.kills)} · ${n(d.revives)} · ${n(d.downs)}` },
    { label: "✨ 스침 · ★ 궁극기 (합동) · ⚡ 스킬", value: (d) => `${n(d.grazes)} · ${n(d.ults)} (${n(d.combos)}) · ${n(d.skills)}` },
    { label: "🛡 무피격 원정 성공 · 🎁 아이템", value: (d) => `${n(d.noHitClears)} · ${n(d.items)}` },
  ],
  "thin-ice-party": [
    { label: "💥 KO / 🌊 빠짐 (혼자)", value: (d) => `${n(d.kos)} / ${n(d.falls)} (${n(d.selfFalls)})` },
    { label: "🏆 라운드 1등 / 3등 안", value: (d) => `${n(d.roundWins)} / ${n(d.podiums)}` },
    { label: "⏱ 버틴 시간 합 · 한 라운드 최장", value: (d) => `${n(d.surviveSec)}초 · ${n(d.maxSurviveSec)}초` },
    { label: "💥 내려찍기 / 밀친 사람 / 깬 얼음", value: (d) => `${n(d.stomps)} / ${n(d.stompHits)} / ${n(d.tilesBroken)}` },
    { label: "🎁 아이템 (🐟 물고기 · ❄️ 냉기)", value: (d) => `${n(d.items)} (${n(d.fish)} · ${n(d.frosts)})` },
    { label: "👻 내 표로 정한 해빙 / 그때 빠진 사람", value: (d) => `${n(d.votes)} / ${n(d.voteHits)}` },
  ],
  curling: [
    { label: "투구 / 🎯 버튼", value: (d) => `${n(d.throws)} / ${n(d.buttons)}` },
    { label: "테이크아웃 (더블 이상)", value: (d) => `${n(d.takeouts)}개 (${n(d.doubles)})` },
    { label: "득점 엔드 / 엔드 최고", value: (d) => `${n(d.endsWon)} / ${n(d.maxEnd)}점` },
    { label: "스틸 / 🧊 프리즈", value: (d) => `${n(d.steals)} / ${n(d.freezes)}` },
    { label: "파티 스톤 / 호그 라인 미달", value: (d) => `${n(d.partyStones)} / ${n(d.hogs)}` },
  ],
  alkkagi: [
    { label: "떨어뜨린 알 / 잃은 알", value: (d) => `${n(d.knocked)} / ${n(d.lost)}` },
    { label: "판 1등 / 무결점 승리", value: (d) => `${n(d.roundWins)} / ${n(d.flawless)}` },
    { label: "더블킬 (한 번에 2개+)", value: (d) => n(d.multiKnocks) },
    { label: "한 번에 최다", value: (d) => `${n(d.bestShot)}개` },
    { label: "왕 잡기 / 스스로 떨어짐", value: (d) => `${n(d.kingKills)} / ${n(d.selfFalls)}` },
  ],
  "bowling-mayhem": [
    { label: "최고 점수 (10프레임 정식)", value: (d) => `${n(d.maxScore)}점 (${n(d.maxScore10)}점)` },
    { label: "스트라이크 / 스페어", value: (d) => `${n(d.strikes)} / ${n(d.spares)}` },
    { label: "🦃 터키 / 최장 연속 스트라이크", value: (d) => `${n(d.turkeys)} / ${n(d.maxStreak)}연속` },
    { label: "스플릿 처리", value: (d) => ratio(d.splitsConverted, d.splits) },
    { label: "거터 / 던진 공", value: (d) => `${n(d.gutters)} / ${n(d.rolls)}` },
    { label: "방해 / 방해받고 X·/", value: (d) => `${n(d.sabotages)} / ${n(d.hazardBeaten)}` },
  ],
  "cargo-stack": [
    { label: "🏗️ 실은 컨테이너 / 얻은 점수", value: (d) => `${n(d.placed)} / ${n(d.points)}` },
    { label: "🗼 최고 층 · 💰 한 번에 최고", value: (d) => `${n(d.maxTier)}층 · ${n(d.maxPlace)}점` },
    { label: "🌊 내가 쏟음 / 잃음 (출항 때)", value: (d) => `${n(d.spills)} / ${n(d.lost)} (${n(d.stormLost)})` },
    { label: "🚨 전복 · 🥚 깨뜨림 / 배달", value: (d) => `${n(d.capsizes)} · ${n(d.crushes)} / ${n(d.fragileSaved)}` },
    { label: "💎 귀중품 / ⚙️ 철강 / ⚓ 밸러스트", value: (d) => `${n(d.golds)} / ${n(d.steel)} / ${n(d.ballasts)}` },
    { label: "🧘 무손실 항해 / 항해", value: (d) => `${n(d.cleanVoyages)} / ${n(d.voyages)}` },
  ],
  "island-pioneers": [
    { label: "최종 우승 / 최고 점수", value: (d) => `${n(d.gamesWon)} / ${n(d.maxScore)}` },
    { label: "🚩 완성한 지역 (석호)", value: (d) => `${n(d.regionsCompleted)} (${n(d.lagoons)})` },
    { label: "한 번 최고 완성 점수 · 최대 칸 수", value: (d) => `${n(d.maxRegionPoints)} · ${n(d.maxRegionTiles)}` },
    { label: "📜 의뢰 (처음 이룸)", value: (d) => `${n(d.questsDone)} (${n(d.questsFirst)})` },
    { label: "🎒 자원 / 4종 세트", value: (d) => `${n(d.resourcesTotal)} / ${n(d.sets)}` },
    { label: "🧱 놓은 타일 / 세운 개척자", value: (d) => `${n(d.tilesPlaced)} / ${n(d.settlersPlaced)}` },
  ],
  "hundred-tales": [
    { label: "🕯️ 들려준 괴담 / 끈 촛불", value: (d) => `${n(d.told)} / ${n(d.snuffed)}` },
    { label: "📜 모은 이야기 / 모은 점수", value: (d) => `${n(d.stories)} / ${n(d.banked)}` },
    { label: "😨 한 번에 최고 · 최대 장수", value: (d) => `${n(d.maxStory)}점 · ${n(d.maxChain)}장` },
    { label: "😱 씌임 / 날린 점수", value: (d) => `${n(d.busts)} / ${n(d.lostToBust)}` },
    { label: "👻 다섯 귀신 · 💀 저주", value: (d) => `${n(d.perfects)} · ${n(d.curses)}` },
    { label: "🧂 부적으로 버팀 / 🕯️ 새 초 / 🪞 거울", value: (d) => `${n(d.saltSaves)} / ${n(d.relit)} / ${n(d.mirrors)}` },
  ],
  "hush-night": [
    { label: "🗝️ 주운 열쇠 / 🕳️ 가져간 열쇠", value: (d) => `${n(d.picked)} / ${n(d.banked)}` },
    { label: "한 번에 가져간 최대 · 한 판 최고", value: (d) => `${n(d.maxBank)} · ${n(d.maxScore)}` },
    { label: "😱 잡힘 / 떨어뜨린 열쇠", value: (d) => `${n(d.caught)} / ${n(d.dropped)}` },
    { label: "🤫 숨죽임 / 🚶 걷기 / 🏃 달리기", value: (d) => `${n(d.hushes)} / ${n(d.walks)} / ${n(d.runs)}` },
    { label: "🪨 던진 돌 / 괴물을 끈 돌", value: (d) => `${n(d.throws)} / ${n(d.lured)}` },
  ],
  "strange-corridor": [
    { label: "🚪 걸은 복도 / 정답", value: (d) => `${n(d.rounds)} / ${n(d.correct)}` },
    { label: "🔍 찾은 이상 / 놓친 이상", value: (d) => `${n(d.found)} / ${n(d.missed)}` },
    { label: "🧘 평범한 복도 통과 / 헛것", value: (d) => `${n(d.cleared)} / ${n(d.falseAlarms)}` },
    { label: "🔥 최고 연속 · ⚡ 최고 속도", value: (d) => `${n(d.maxStreak)} · ${n(d.maxSpeed)}` },
    { label: "🏆 완벽한 판 · ⏰ 시간 초과", value: (d) => `${n(d.perfectGames)} · ${n(d.timeouts)}` },
  ],
  "mini-golf": [
    { label: "⛳ 홀인원 / 이글 / 버디", value: (d) => `${n(d.holeInOnes)} / ${n(d.eagles)} / ${n(d.birdies)}` },
    { label: "파 / 보기 이상", value: (d) => `${n(d.pars)} / ${n(d.bogeys)}` },
    { label: "최고 언더파 · 9홀 최소 타수", value: (d) => `${n(d.maxUnderPar)} · ${d.min9 ? `${n(d.min9)}타` : "—"}` },
    { label: "☁️ 추락 / 공 줍기", value: (d) => `${n(d.falls)} / ${n(d.pickups)}` },
    { label: "💥 남의 공 떨어뜨림 / 🎁 넣어 줌", value: (d) => `${n(d.knockOffs)} / ${n(d.gifts)}` },
    { label: "🛹 점프 / 🌀 풍차 통과", value: (d) => `${n(d.jumps)} / ${n(d.windmillPasses)}` },
  ],
  "wobble-tower": [
    { label: "빼기 성공 / 무너뜨림", value: (d) => `${n(d.pulls)} / ${n(d.collapses)}` },
    { label: "🏅 마지막 건축가", value: (d) => n(d.lastBuilder) },
    { label: "완벽한 빼기 (95%+)", value: (d) => n(d.perfectPulls) },
    { label: "빈칸 층에서 버틴 빼기", value: (d) => n(d.riskyPulls) },
    { label: "최고 층수 / 최고 손놀림", value: (d) => `${n(d.maxLevels)}층 / ${n(d.bestQuality)}%` },
  ],
  qplay: [
    { label: "미니 게임 1등", value: (d) => n(d.miniWins) },
    { label: "한 판 최고 점수", value: (d) => `${n(d.maxScore)}점` },
    { label: "정답 / 푼 문제", value: (d) => `${n(d.correct)} / ${n(d.answered)}` },
    { label: "OX 끝까지 생존", value: (d) => n(d.oxSurvived) },
    { label: "미사일 명중 / 격추", value: (d) => `${n(d.missileHits)} / ${n(d.missileKills)}` },
    { label: "올라올라 완주 / 1등", value: (d) => `${n(d.climbFinishes)} / ${n(d.climbFirst)}` },
    { label: "초성 퀴즈 1등 정답", value: (d) => n(d.chosungFirst) },
  ],
  "word-tower": [
    { label: "라운드 1등", value: (d) => n(d.roundWins) },
    { label: "최고 연승", value: (d) => n(d.bestStreak) },
    { label: "한 라운드 최고 층수", value: (d) => `${n(d.maxHeight)}층` },
    { label: "쌓은 단어 / 누적 층수", value: (d) => `${n(d.words)} / ${n(d.totalHeight)}층` },
    { label: "심사 인정 / 거절·오답", value: (d) => `${n(d.approvedWords)} / ${n(d.rejectedWords)}` },
    { label: "싹쓸이 (🎯 정답 모으기)", value: (d) => n(d.completedTopics) },
  ],
  "liar-game": [
    { label: "라이어로 지목 피함 / 라이어 라운드", value: (d) => `${n(d.liarEscapes)} / ${n(d.liarRounds)}` },
    { label: "들킨 뒤 제시어 맞혀 역전", value: (d) => n(d.liarGuesses) },
    { label: "시민으로 승리 / 시민 라운드", value: (d) => `${n(d.citizenWins)} / ${n(d.citizenRounds)}` },
    { label: "라이어에게 투표 적중률", value: (d) => ratio(d.correctVotes, d.citizenRounds) },
    { label: "한 판 최고 점수", value: (d) => n(d.maxScore) },
  ],
  telepathy: [
    { label: "최고 도달 레벨", value: (d) => `레벨 ${n(d.maxLevel)}` },
    {
      label: "인원별 최고 점수",
      value: (d) => {
        const parts = [2, 3, 4, 5, 6].filter((c) => d[`maxScore${c}p`]).map((c) => `${c}인 ${n(d[`maxScore${c}p`])}`);
        return parts.length > 0 ? parts.join(" · ") : null;
      },
    },
    { label: "최고 점수", value: (d) => n(d.maxScore) },
    { label: "실수 없이 통과한 레벨", value: (d) => n(d.perfectLevels) },
    { label: "실수 / ⚡ 사용", value: (d) => `${n(d.mistakes)} / ${n(d.starsUsed)}` },
    { label: "0.25초 관용 판정으로 피한 실수", value: (d) => n(d.graceSaves) },
  ],
  perudo: [
    { label: "\"페루도!\" 적중률", value: (d) => ratio(d.dudoCorrect, d.dudoCalls) },
    { label: "\"맞아!\" 적중률", value: (d) => ratio(d.calzaCorrect, d.calzaCalls) },
    { label: "내 선언이 의심받고 버텨냄", value: (d) => n(d.bidsHeld) },
    { label: "내 선언이 들킴", value: (d) => n(d.bluffsCaught) },
    { label: "경계 적중 (모두 1개씩 잃게 함)", value: (d) => n(d.exactHits) },
    { label: "주사위 1개에서 역전승", value: (d) => n(d.oneDieComebacks) },
    { label: "한 번에 가장 많이 잃은 주사위", value: (d) => `${n(d.maxDiceLostOnce)}개` },
  ],
  dalmuti: [
    { label: "1등으로 끝냄 / 꼴찌로 끝냄", value: (d) => `${n(d.finishedFirst)} / ${n(d.finishedLast)}` },
    { label: "농노로 시작해 1등 (역전승)", value: (d) => n(d.winAsPeon) },
    { label: "달무티로 시작해 꼴찌 (강등)", value: (d) => n(d.loseAsDalmuti) },
    { label: "혁명 / 대혁명", value: (d) => `${n(d.revolutions)} / ${n(d.grandRevolutions)}` },
    { label: "조커로 마무리", value: (d) => n(d.jokerFinishes) },
    { label: "한 번에 낸 최대 카드 수", value: (d) => `${n(d.maxCardsInOnePlay)}장` },
  ],
  "five-cucumbers": [
    { label: "누적 먹은 오이", value: (d) => `${n(d.cucumbersEaten)}개` },
    { label: "판당 평균 오이", value: (d, played) => avg(d.cucumbersEaten, played) },
    { label: "마지막 트릭 생존율", value: (d) => ratio(d.finalTricksSurvived, d.finalTricks) },
    { label: "15 카드로 따낸 트릭", value: (d) => n(d.topCardTricks) },
    { label: "마지막 트릭에서 1로 방어", value: (d) => n(d.oneCardDefenses) },
    { label: "한 번에 먹은 최대 오이", value: (d) => `${n(d.maxPenaltyOnce)}개` },
    { label: "탈락한 판", value: (d) => n(d.eliminated) },
  ],
  coyote: [
    { label: "\"코요테!\" 적중률", value: (d) => ratio(d.coyoteCorrect, d.coyoteCalls) },
    { label: "내 선언이 의심받고 버텨낸 비율", value: (d) => ratio(d.bidsHeld, d.bidsChallenged) },
    { label: "하트를 하나도 잃지 않고 1위", value: (d) => n(d.flawlessWins) },
    { label: "이마에 ?·MAX→0·x2가 붙은 라운드", value: (d) => n(d.specialCardRounds) },
  ],
  "rat-a-tat-cat": [
    { label: "최저 점수 (낮을수록 좋음)", value: (d) => (d.minHandScore === undefined ? null : `${n(d.minHandScore)}점`) },
    { label: "평균 점수", value: (d, played) => avg(d.totalHandScore, played) },
    { label: "0점 퍼펙트 핸드", value: (d) => n(d.zeroHands) },
    { label: "\"랫어탯캣!\" 선언 후 1등", value: (d) => ratio(d.ratCallWins, d.ratCalls) },
    { label: "Swap 사용 / 이득 본 Swap", value: (d) => `${n(d.swaps)} / ${n(d.gainfulSwaps)}` },
  ],
  century: [
    { label: "최고 승점", value: (d) => n(d.maxScore) },
    { label: "평균 승점", value: (d, played) => avg(d.totalScore, played) },
    { label: "금화(3점) / 은화(1점)", value: (d) => `${n(d.goldCoins)} / ${n(d.silverCoins)}` },
    { label: "모은 승점 카드", value: (d) => `${n(d.pointCards)}장` },
    { label: "갈색(시나몬) 확보량", value: (d) => n(d.brownGained) },
    { label: "가장 빨리 이긴 판", value: (d) => (d.minWinRounds === undefined ? null : `${n(d.minWinRounds)}라운드`) },
  ],
  "spot-difference": [
    { label: "누적 찾은 틀린 곳", value: (d) => n(d.spotsFound) },
    { label: "오클릭률", value: (d) => ratio(d.missClicks, (d.spotsFound ?? 0) + (d.missClicks ?? 0)) },
    { label: "한 판 최다 발견", value: (d) => n(d.maxSpotsInGame) },
    { label: "오답 없는 퍼펙트 판", value: (d) => n(d.perfectGames) },
    { label: "Lv.10 봇 상대 승리", value: (d) => n(d.lv10BotWins) },
  ],
  "doodle-phone": [
    { label: "그린 그림 / 쓴 문장", value: (d) => `${n(d.drawings)} / ${n(d.texts)}` },
    { label: "원래 문장을 정확히 맞힘", value: (d) => n(d.exactGuesses) },
    { label: "받은 반응 (😂🤯👏❤️🤔)", value: (d) => n(d.reactionsReceived) },
    { label: "한 장에 받은 최다 반응", value: (d) => n(d.maxReactionsOnePage) },
    { label: "받은 투표 (점수 모드)", value: (d) => n(d.votesReceived) },
    { label: "시간 초과로 자동 제출", value: (d) => n(d.autoFilled) },
  ],
  "morph-hide": [
    { label: "최고 점수", value: (d) => n(d.maxScore) },
    { label: "끝까지 숨음 / 찜 탈출", value: (d) => `${n(d.survives)} / ${n(d.escapes)}` },
    { label: "술래로 찾은 사람 (한 판 최다)", value: (d) => `${n(d.catches)} (${n(d.maxCatches)})` },
    { label: "엉뚱한 걸 친 횟수", value: (d) => n(d.wrongHits) },
    { label: "만든 분신", value: (d) => n(d.decoys) },
  ],
  "cctv-alibi": [
    { label: "손님으로 검거 / 손님 사건", value: (d) => `${n(d.catches)} / ${n(d.guestCases)}` },
    { label: "범인 적중 표", value: (d) => n(d.correctVotes) },
    { label: "범인으로 도주 / 범인 사건", value: (d) => `${n(d.escapes)} / ${n(d.culpritCases)}` },
    { label: "한 표도 안 받고 도주", value: (d) => n(d.cleanEscapes) },
    { label: "센서 대조 (가짜 칸 적중)", value: (d) => `${n(d.checks)} (${n(d.hits)})` },
    { label: "증언 / 목격한 사건", value: (d) => `${n(d.testimonies)} / ${n(d.witnessed)}` },
    { label: "결백한데 받은 표", value: (d) => n(d.framedVotes) },
  ],
  "fog-manor": [
    { label: "해결 (고발 / 새벽)", value: (d) => `${n(d.solves)} (${n(d.accuseSolves)} / ${n(d.dawnSolves)})` },
    { label: "빠른 해결 (자정의 추리)", value: (d) => n(d.fastSolves) },
    { label: "누명 쓴 횟수", value: (d) => n(d.wrongAccusations) },
    { label: "심문 / 수색", value: (d) => `${n(d.asks)} / ${n(d.searches)}` },
    { label: "찾은 단서 (괘종 단서)", value: (d) => `${n(d.clues)} (${n(d.bellClues)})` },
    { label: "비밀 통로 이용", value: (d) => n(d.passages) },
  ],
  "lantern-keepers": [
    { label: "탈출 (별 3개)", value: (d) => `${n(d.escapes)} (${n(d.threeStars)})` },
    { label: "받은 별 합계", value: (d) => n(d.stars) },
    {
      label: "숲별 최고 별",
      value: (d) => {
        const ids: [string, string][] = [
          ["trail", "🌲"],
          ["deep", "🌳"],
          ["shadow", "🌑"],
        ];
        const parts = ids.filter(([id]) => d[`maxStars_${id}`]).map(([id, l]) => `${l} ${"⭐".repeat(d[`maxStars_${id}`] ?? 0)}`);
        return parts.length > 0 ? parts.join(" · ") : null;
      },
    },
    { label: "주운 빛 조각 / 반딧불 병", value: (d) => `${n(d.shards)} / ${n(d.jars)}` },
    { label: "해제한 함정 / 퇴치한 괴물", value: (d) => `${n(d.disarms)} / ${n(d.banishes)}` },
    { label: "보낸 핑 / 다친 횟수", value: (d) => `${n(d.pings)} / ${n(d.hurt)}` },
  ],
  "time-loop-heist": [
    { label: "작전 성공 (별 3개)", value: (d) => `${n(d.clears)} (${n(d.threeStars)})` },
    { label: "받은 별 합계", value: (d) => n(d.stars) },
    {
      label: "작전별 최고 별",
      value: (d) => {
        const ids: [string, string][] = [
          ["plates", "1호"],
          ["two-keys", "2호"],
          ["patrol", "3호"],
          ["grand-vault", "4호"],
        ];
        const parts = ids.filter(([id]) => d[`maxStars_${id}`]).map(([id, l]) => `${l} ${"⭐".repeat(d[`maxStars_${id}`] ?? 0)}`);
        return parts.length > 0 ? parts.join(" · ") : null;
      },
    },
    { label: "입금한 보석 / 동전", value: (d) => `${n(d.gemsBanked)} / ${n(d.coinsBanked)}` },
    { label: "시간 역설 / 체포된 자아", value: (d) => `${n(d.paradoxes)} / ${n(d.caught)}` },
  ],
  "hide-and-seek": [
    { label: "최고 점수", value: (d) => n(d.maxScore) },
    { label: "찜 / 끝까지 숨음", value: (d) => `${n(d.homes)} / ${n(d.survives)}` },
    { label: "술래로 찾은 사람 (한 판 최다)", value: (d) => `${n(d.catches)} (${n(d.maxCatches)})` },
    { label: "싹쓸이", value: (d) => n(d.sweeps) },
    { label: "찜 막기", value: (d) => n(d.blocks) },
    { label: "꼬마 술래로 찾음", value: (d) => n(d.helperCatches) },
    { label: "술래와 같은 방에서 버팀", value: (d) => n(d.closeCalls) },
  ],
  "star-rummy": [
    { label: "최종 우승 / 라운드 승리", value: (d) => `${n(d.gamesWon)} / ${n(d.roundsWon)}` },
    { label: "러미 (손 다 비우기)", value: (d) => n(d.rummyOuts) },
    { label: "내려놓은 타일 (한 차례 최다)", value: (d) => `${n(d.tilesPlayed)} (${n(d.maxTurnTiles)})` },
    { label: "테이블 재배치한 차례", value: (d) => n(d.rearranges) },
    { label: "관측소에서 가져온 타일 / 전체 뽑기", value: (d) => `${n(d.observatoryPicks)} / ${n(d.draws)}` },
    { label: "혜성 내려놓기", value: (d) => n(d.wildsPlayed) },
    { label: "최고 합계 점수", value: (d) => n(d.maxTotal) },
  ],
  "play-dead": [
    { label: "최후의 생존", value: (d) => n(d.survived) },
    { label: "끝내기 (한 판 최다)", value: (d) => `${n(d.kills)} (${n(d.maxKills)})` },
    { label: "사격 명중 / 벌떡 기습 명중", value: (d) => `${n(d.blastHits)} / ${n(d.ambushHits)}` },
    { label: "죽은 척 폭로", value: (d) => n(d.exposes) },
    { label: "탄약 뺏기로 챙긴 탄약", value: (d) => n(d.ammoLooted) },
    { label: "살아서 죽은 척한 라운드", value: (d) => n(d.fakeRounds) },
    { label: "죽은 척하는 채로 승리", value: (d) => n(d.fakeWins) },
  ],
  "prism-five": [
    { label: "최고 점수 (한 스테이지)", value: (d) => n(d.maxScore) },
    { label: "클리어", value: (d) => ratio(d.clears, d.runs) },
    { label: "최고 스테이지 · FINAL 클리어", value: (d) => `STAGE ${n(d.maxStage)} · ${n(d.finalClears)}회` },
    { label: "최대 콤보", value: (d) => `${n(d.maxCombo)} HITS` },
    { label: "처치 (보스)", value: (d) => `${n(d.kills)} (${n(d.bossKills)})` },
    { label: "S 등급 / 노데스 클리어", value: (d) => `${n(d.sGrades)} / ${n(d.noDeathClears)}` },
    { label: "섬광 회피", value: (d) => `${n(d.perfectDodges)}회` },
  ],
  "crab-survival": [
    { label: "최고 점수 (한 판)", value: (d) => n(d.maxScore) },
    { label: "1등", value: (d) => ratio(d.firsts, d.matches) },
    { label: "3위 안", value: (d) => ratio(d.top3, d.matches) },
    { label: "최고 순위", value: (d) => (d.minRank === undefined ? null : `${n(d.minRank)}위`) },
    { label: "처치 (판당 평균 · 한 판 최다)", value: (d) => `${avg(d.kills, d.matches ?? 0) ?? "-"} · ${n(d.maxKills)}` },
    { label: "왕관 보유 시간", value: (d) => `${n(Math.round((d.kingSeconds ?? 0) / 60))}분` },
    { label: "최고 레벨", value: (d) => n(d.maxLevel) },
    { label: "현상금 / 역습", value: (d) => `${n(d.bounties)} / ${n(d.revenges)}` },
  ],
  "hungry-shark": [
    { label: "최고 점수 (한 잠수)", value: (d) => n(d.maxScore) },
    { label: "누적 잠수", value: (d) => `${n(d.dives)}회` },
    { label: "미션 올클리어", value: (d) => ratio(d.missionAllClears, d.dives) },
    { label: "최고 연속 미션 올클리어", value: (d) => `${n(d.maxMissionStreak)}회` },
  ],
  "merge-defense": [
    { label: "최고 웨이브 (전체)", value: (d) => (d.maxWave ? `WAVE ${n(d.maxWave)}` : null) },
    {
      label: "🛡️ 생존전 최고 (쉬움 · 보통 · 어려움)",
      value: (d) => waves3(d.maxWaveSurvivalEasy, d.maxWaveSurvivalNormal, d.maxWaveSurvivalHard),
    },
    {
      label: "⚔️ 유닛 대결 최고 (쉬움 · 보통 · 어려움)",
      value: (d) => waves3(d.maxWaveVersusEasy, d.maxWaveVersusNormal, d.maxWaveVersusHard),
    },
    { label: "처치 (누적 · 판당 평균)", value: (d, played) => `${n(d.kills)} · ${avg(d.kills, played) ?? "-"}` },
    { label: "😡 광폭화 보스·전쟁군주 처치", value: (d) => `${n(d.rageKills)}회` },
    { label: "⚡ 최고 치명타 콤보", value: (d) => (d.maxCritCombo ? `${n(d.maxCritCombo)}콤보` : null) },
    { label: "8콤보 보너스 달성률 (10웨이브 이후)", value: (d) => ratio(d.comboBonusWaves, d.lateWaves) },
    {
      label: "⚔️ 콤보 견제 (건 · 당함 · 막음 · 반격당함)",
      value: (d) =>
        d.jamsSent || d.jamsTaken || d.jamsBlocked || d.reflectsTaken
          ? `${n(d.jamsSent)} · ${n(d.jamsTaken)} · ${n(d.jamsBlocked)} · ${n(d.reflectsTaken)}`
          : null,
    },
    { label: "🎯 집중 단계 (판당 평균 · 최고)", value: (d, played) => `${avg(d.focusTotal, played) ?? "-"} · ${n(d.maxFocus)}` },
    { label: "🛡️ 결속 단계 (판당 평균 · 최고)", value: (d, played) => `${avg(d.braceTotal, played) ?? "-"} · ${n(d.maxBrace)}` },
  ],
  "for-sale": [
    { label: "최고 최종 자산", value: (d) => `$${n(d.maxTotal)}` },
    { label: "평균 최종 자산", value: (d, played) => (played ? `$${n(Math.round((d.totalMoney ?? 0) / played))}` : null) },
    { label: "가장 큰 수표", value: (d) => `$${n(d.maxCheck)}` },
    { label: "0원 수표 받은 횟수", value: (d) => n(d.zeroChecks) },
    { label: "30번 매물 보유한 판", value: (d) => n(d.had30) },
    { label: "30번 매물 보유 + 1위", value: (d) => n(d.won30) },
    { label: "30번 매물을 0원에 판 굴욕", value: (d) => n(d.sold30ForZero) },
  ],
};
