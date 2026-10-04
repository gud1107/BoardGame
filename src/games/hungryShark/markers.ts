/**
 * Target Feed Indicator — picks which nearby entities get a world-space
 * reticle and classifies each one against the player's current tier.
 * Pure (no canvas) so it's unit-testable; `render.ts` draws the result and
 * `HungrySharkCanvas.tsx` uses it for the danger-approach beep.
 *
 *   edible  🟢 green ring  "+HP" / "+score"
 *   gold    🟡 gold ring   during Gold Rush (pink during Mega)
 *   danger  🔴 red ring    ☠ "T3 귀상어 필요" — hurts on contact
 *   blocked 🔴 red ring    ✖ "T4 뱀상어 필요" — harmless, you just bounce off
 */

import { GOLD_RUSH_COIN_MULT, healGain, NEVER, PREY_EFFECTS, preyEffectLabel, sharksOfTier, ENTITY_DEFS, type EntityDef, type EntityKind, MAPS, type MapDef } from "./data";
import { isEdible, mouthPos, type Entity, type World } from "./engine";

export type MarkerKind = "edible" | "gold" | "mega" | "danger" | "blocked";

export interface Marker {
  e: Entity;
  kind: MarkerKind;
  label: string;
  sub: string;
}

export const MAX_MARKERS = 8;
/** Same-kind markers closer than this collapse into one (fish schools). */
const DECLUTTER = 70;

/** "Field of view" radius around the head — grows with the shark's size. */
export function markerDetectRadius(w: World): number {
  return 240 + w.stats.length * 1.3;
}

const TIER_NAMES: Record<number, string> = { 1: "암초상어", 2: "2단계 진화", 3: "3단계 진화", 4: "최종 진화" };

export function tierLabel(tier: number): string {
  const name = TIER_NAMES[tier] ?? sharksOfTier(tier)[0]?.name;
  return name ? `T${tier} ${name}` : `T${tier}`;
}

/** Short warning line for things that hurt (also used by the bestiary). */
export function hazardTip(def: EntityDef): string {
  if (def.damageKind === "explode") return "폭발 주의";
  if (def.damageKind === "poison") return "독 주의";
  if (def.behavior === "hunter") return "물어뜯기 주의";
  if (def.kind === "rock") return "낙석 주의";
  return "가시 주의";
}

export function classify(w: World, e: Entity): Marker {
  const def = e.def;
  const gold = w.gold.active;
  if (isEdible(w, e)) {
    if (gold) {
      const coins = Math.round(
        (e.kind === "chest" ? def.coins : Math.max(1, def.coins) * GOLD_RUSH_COIN_MULT * (w.gold.mega ? 2 : 1)) * w.stats.goldMultiplier,
      );
      return {
        e,
        kind: w.gold.mega ? "mega" : "gold",
        label: w.gold.mega ? "MEGA GOLD!" : "GOLD RUSH!",
        sub: `🪙+${coins} · HP 완전회복`,
      };
    }
    if (e.kind === "chest") return { e, kind: "edible", label: "🎁 보물 상자", sub: `🪙+${Math.round(def.coins * w.stats.goldMultiplier)}~` };
    if (e.kind === "goldenTuna") return { e, kind: "gold", label: "✨ 황금 참치", sub: "즉시 골드 러시!" };
    const bites = def.toughness > 1 ? Math.ceil(e.hp / w.stats.biteForce) : 0;
    return {
      e,
      kind: "edible",
      label: `+${Math.round(healGain(def.heal, w.stats.biteLevel) * w.stats.healMul)} HP`,
      sub: bites > 1 ? `+${def.score}점 · ${bites}번 물기` : PREY_EFFECTS[e.kind] ? `+${def.score}점 · ${preyEffectLabel(PREY_EFFECTS[e.kind]!)}` : `+${def.score}점`,
    };
  }
  const need = def.requiredTier >= NEVER ? "메가 골드 러시 전용" : `${tierLabel(def.requiredTier)} 필요`;
  if (def.damage > 0 && !gold) return { e, kind: "danger", label: `☠ ${need}`, sub: hazardTip(def) };
  return { e, kind: "blocked", label: `✖ ${need}`, sub: gold ? "무적 중 · 피해 없음" : "더 큰 상어 필요" };
}

export function selectMarkers(w: World, max = MAX_MARKERS): Marker[] {
  if (w.over) return [];
  const s = w.shark;
  const m = mouthPos(w);
  const R = markerDetectRadius(w);
  const hx = Math.cos(s.angle), hy = Math.sin(s.angle);
  const cands: { e: Entity; d: number; threat: boolean }[] = [];
  for (const e of w.entities) {
    if (!e.alive) continue;
    const dx = e.x - m.x, dy = e.y - m.y;
    if (Math.abs(dx) > R + e.def.radius || Math.abs(dy) > R + e.def.radius) continue;
    const d = Math.hypot(dx, dy) - e.def.radius;
    if (d > R) continue;
    // Moving threats are always shown; everything else only toward the head.
    const threat = !isEdible(w, e) && e.def.damage > 0 && !w.gold.active &&
      (e.def.behavior === "hunter" || e.kind === "torpedo" || e.kind === "rock" || d < R * 0.45);
    const bx = e.x - s.x, by = e.y - s.y;
    const facing = (hx * bx + hy * by) / (Math.hypot(bx, by) || 1);
    if (!threat && facing < -0.2) continue;
    cands.push({ e, d, threat });
  }
  cands.sort((a, b) => (a.threat === b.threat ? a.d - b.d : a.threat ? -1 : 1));
  const out: Marker[] = [];
  for (const c of cands) {
    if (out.length >= max) break;
    if (out.some((o) => o.e.kind === c.e.kind && Math.abs(o.e.x - c.e.x) < DECLUTTER && Math.abs(o.e.y - c.e.y) < DECLUTTER)) continue;
    out.push(classify(w, c.e));
  }
  return out;
}

export const MARKER_COLORS: Record<MarkerKind, string> = {
  edible: "#4ade80",
  gold: "#facc15",
  mega: "#f472b6",
  danger: "#ef4444",
  blocked: "#f87171",
};

// ── Bestiary data (spec's PreyDataSO: habitat + warning tip) ─────────────────

const M = (y: number) => Math.round(y / 10);

export function habitatLabel(kind: EntityKind): string {
  const def = ENTITY_DEFS[kind];
  switch (def.behavior) {
    case "fly":
    case "heli": return "공중 (수면 위)";
    case "surfaceSwim":
    case "surfaceBoat": return "수면";
    case "crawl": return "해저 바닥";
    case "static": return "해저 바닥 (맵마다 9~20곳)";
    case "torpedo": return "잠수함 주변";
    case "rock": return kind === "iceShard" ? "빙판 밑 고드름 아래" : "해구 (250m~)";
    default: return `${M(def.depth[0])}~${M(def.depth[1])}m`;
  }
}

/** Order + flavor for the bestiary. */
export const BESTIARY_ORDER: EntityKind[] = [
  "smallFish", "crab", "swimmer", "chest", "goldenTuna",
  "puffer", "pelican", "diver", "grouper",
  "ray", "tuna", "sailor",
  "angler", "fishingBoat", "passenger", "smallShark",
  "cageDiver", "submarine",
  "ghostShark", "yacht", "helicopter",
  "penguin", "seal", "narwhal", "orca",
  "treasureHunter", "barracuda", "moray", "giantSquid",
  "greenJelly", "redJelly", "mineS", "mineM", "mineL", "mineXL", "torpedo", "rock", "iceberg", "iceShard",
];

/** Maps this kind actually shows up on (roster, plus kinds that only come from something else). */
export function mapsWhere(kind: EntityKind): MapDef[] {
  const from: Partial<Record<EntityKind, EntityKind>> = { torpedo: "submarine", passenger: "yacht" };
  if (kind === "chest") return MAPS;
  if (kind === "rock") return MAPS.filter((m) => m.feature === "coral");
  if (kind === "iceShard") return MAPS.filter((m) => m.feature === "iceSheet");
  const src = from[kind];
  return MAPS.filter((m) => (m.spawns[kind] ?? 0) > 0 || (src && (m.spawns[src] ?? 0) > 0) || (kind === "sailor" && (m.spawns.fishingBoat ?? 0) > 0));
}

/** Kinds that spawn on exactly this one map (shown on the map picker). */
export function mapExclusives(map: MapDef): EntityKind[] {
  return BESTIARY_ORDER.filter((k) => {
    const where = mapsWhere(k);
    return where.length === 1 && where[0].id === map.id && ENTITY_DEFS[k].behavior !== "rock";
  });
}

export const BESTIARY_TIPS: Partial<Record<EntityKind, string>> = {
  smallFish: "떼로 몰려다니며 상어가 다가오면 흩어집니다. 콤보 쌓기에 최고.",
  crab: "해저 바닥을 기어 다닙니다.",
  swimmer: "수면에서 헤엄칩니다. 가까이 가면 허둥지둥 도망쳐요.",
  chest: "미니맵의 노란 점. 입으로 물면 코인이 쏟아집니다.",
  goldenTuna: "아주 드물게 나타나는 번쩍이는 참치. 먹으면 즉시 골드 러시 + 코인 150~300.",
  puffer: "가시가 있어 T1 상어가 물면 따끔합니다.",
  pelican: "수면 위를 날다 가끔 급강하합니다. 점프해서 잡으세요.",
  diver: "산소통을 멘 다이버. 도망치는 속도가 느립니다.",
  ray: "넓적한 몸으로 천천히 날갯짓합니다.",
  tuna: "매우 빠릅니다. 부스트로 따라잡으세요.",
  sailor: "낚싯배가 부서지면 물에 떨어집니다.",
  angler: "심해의 빛나는 미끼로 유인한 뒤 물어뜯습니다.",
  fishingBoat: "여러 번 물어 부수면 선원들이 물에 빠집니다.",
  passenger: "보트가 부서지면 물에 빠집니다.",
  smallShark: "약한 상어를 5초간 추격합니다.",
  cageDiver: "철창 안에서 작살을 쏩니다.",
  submarine: "T3 이하 상어에게 유도 어뢰를 쏩니다(은신 중엔 못 쏩니다).",
  ghostShark: "해구에 사는 반투명 포식자. 멀리서도 쫓아옵니다.",
  yacht: "부수면 승객들이 물에 빠집니다.",
  helicopter: "높이 떠 있어 부스트 점프가 필요합니다.",
  greenJelly: "3초간 0.5초마다 체력 5% 감소 + 속도 −40%.",
  redJelly: "3.5초간 0.5초마다 체력 6% 감소 + 속도 −40%.",
  mineS: "가까이 가면 폭발. 주변 기뢰를 연쇄 폭발시킵니다.",
  mineM: "폭발 반경 160. 거리가 가까울수록 큰 피해.",
  mineL: "폭발 반경 210. 심해에 많습니다.",
  mineXL: "폭발 반경 280. 해구의 최대 위험.",
  torpedo: "6초간 상어를 추적한 뒤 폭발합니다.",
  rock: "해구에서 위로부터 떨어집니다.",
  iceberg: "얼음 해협의 숨구멍에 떠다니는 빙산. 해롭진 않지만 부딪히면 튕겨 나가고 점프를 막습니다.",
  iceShard: "빙판 밑을 헤엄치면 머리 위 고드름 끝이 부러집니다. 잠깐 떨리며 빨간 낙하선을 보여준 뒤 떨어지니 옆으로 피하세요.",
  penguin: "얼음 해협 빙판 아래를 떼 지어 헤엄칩니다. 먹으면 부스트가 조금 찹니다.",
  seal: "재빠른 물범. 빙판 아래 얕은 물에서 상어를 피해 다닙니다.",
  narwhal: "엄니로 들이받는 일각고래. T2 이하 상어를 5초간 쫓아옵니다.",
  orca: "바다의 최상위 포식자. 멀리서도 알아채고 쫓아오며 한 번에 크게 물어뜯습니다.",
  treasureHunter: "난파선을 뒤지는 잠수부. 먹으면 골드 게이지가 크게 찹니다.",
  barracuda: "빠르게 돌진하는 꼬치고기. 암초상어에겐 따끔한 위협입니다.",
  moray: "선체 틈에 숨어 있다가 가까이 오면 튀어나와 뭅니다.",
  giantSquid: "심해 단구의 괴물. 긴 촉수로 붙잡아 큰 피해를 줍니다. T4만 사냥 가능.",
};
