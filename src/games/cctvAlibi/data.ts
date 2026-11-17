/**
 * CCTV 알리바이 — 저택 지도와 상수. 규칙 원전: boardGameRule/CCTV알리바이/CCTV알리바이.md
 *
 * 3×3 방(0~8) + 지하 금고실(9). 금고실로 내려가는 계단은 십자 모양 다섯 방(🪜)에만 있다 —
 * 네 구석 방(서재·침실·음악실·주방)에는 계단이 없다.
 *
 *   [0 서재  ][1 갤러리🪜][2 침실  ]
 *   [3 온실🪜][4 중앙홀🪜][5 식당🪜]        [9 지하 금고실]
 *   [6 음악실][7 현관🪜  ][8 주방  ]
 *
 * 계단이 다섯 곳인 이유(§9): 처음엔 두 곳이었는데, 그 근처를 맴도는 영상만으로 범인이 절반 넘게 드러났다.
 */

export const ROOM_COUNT = 9;
export const VAULT = 9;
/** 밤의 길이 — 시각 0(21:00, 출발)부터 시각 TICKS(01:00)까지 */
export const TICKS = 8;
/** 영상에서 바꿔치기할 수 있는 연속 구간의 최대 길이 */
export const MAX_WINDOW = 3;
/** 손님 한 명의 할 일(들러야 하는 방) 수 */
export const ERRAND_COUNT = 2;

export interface RoomInfo {
  name: string;
  icon: string;
  /** 2D 지도·영상 표의 바탕색 */
  tint: string;
  /** 손님의 할 일 문구 */
  errand: string;
}

export const ROOMS: RoomInfo[] = [
  { name: "서재", icon: "📚", tint: "#4a3524", errand: "편지 쓰기" },
  { name: "갤러리", icon: "🖼️", tint: "#3d3151", errand: "그림 감상" },
  { name: "침실", icon: "🛏️", tint: "#4b2d3a", errand: "겉옷 챙기기" },
  { name: "온실", icon: "🌿", tint: "#24452f", errand: "꽃에 물 주기" },
  { name: "중앙 홀", icon: "🏛️", tint: "#4d4326", errand: "괘종시계 맞추기" },
  { name: "식당", icon: "🍽️", tint: "#50301f", errand: "야식 먹기" },
  { name: "음악실", icon: "🎹", tint: "#2b3d55", errand: "피아노 치기" },
  { name: "현관", icon: "🚪", tint: "#39404a", errand: "우산 챙기기" },
  { name: "주방", icon: "🍳", tint: "#3f4a2a", errand: "차 끓이기" },
  { name: "지하 금고실", icon: "💎", tint: "#5a1f2a", errand: "" },
];

/** 금고실로 내려가는 계단이 있는 방 */
export const VAULT_DOORS: number[] = [1, 3, 4, 5, 7];

const ADJ: number[][] = (() => {
  const adj: number[][] = Array.from({ length: ROOM_COUNT + 1 }, () => []);
  const link = (a: number, b: number) => {
    adj[a].push(b);
    adj[b].push(a);
  };
  for (let r = 0; r < ROOM_COUNT; r++) {
    const row = Math.floor(r / 3);
    const col = r % 3;
    if (col < 2) link(r, r + 1);
    if (row < 2) link(r, r + 3);
  }
  for (const r of VAULT_DOORS) link(VAULT, r);
  return adj.map((a) => a.sort((x, y) => x - y));
})();

/** 문으로 이어진 방 (자기 자신 제외) */
export function neighbors(room: number): number[] {
  return ADJ[room] ?? [];
}

/** 한 시각 동안 a에서 b로 갈 수 있나 (머무르기 포함) */
export function canStep(a: number, b: number): boolean {
  return a === b || (ADJ[a]?.includes(b) ?? false);
}

const DIST: number[][] = (() => {
  const n = ROOM_COUNT + 1;
  return Array.from({ length: n }, (_, from) => {
    const d = Array(n).fill(99);
    d[from] = 0;
    const q = [from];
    for (let i = 0; i < q.length; i++) {
      for (const nb of ADJ[q[i]]) {
        if (d[nb] <= d[q[i]] + 1) continue;
        d[nb] = d[q[i]] + 1;
        q.push(nb);
      }
    }
    return d;
  });
})();

export function dist(a: number, b: number): number {
  return DIST[a]?.[b] ?? 99;
}

const GUEST_DIST: number[][] = (() => {
  const n = ROOM_COUNT;
  return Array.from({ length: n }, (_, from) => {
    const d = Array(n + 1).fill(99);
    d[from] = 0;
    const q = [from];
    for (let i = 0; i < q.length; i++) {
      for (const nb of ADJ[q[i]]) {
        if (nb === VAULT || d[nb] <= d[q[i]] + 1) continue;
        d[nb] = d[q[i]] + 1;
        q.push(nb);
      }
    }
    return d;
  });
})();

/** 금고실을 지나지 않는 거리 (손님 동선용) */
export function guestDist(a: number, b: number): number {
  return GUEST_DIST[a]?.[b] ?? 99;
}

/** 시각 번호 → "21:30" */
export function timeLabel(t: number): string {
  const m = 21 * 60 + t * 30;
  return `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function roomLabel(room: number): string {
  const r = ROOMS[room];
  return r ? `${r.icon} ${r.name}` : "?";
}

export const SEAT_COLORS = ["#f59e0b", "#38bdf8", "#f472b6", "#4ade80", "#a78bfa", "#fb7185"];
/** 색각 배려: 좌석마다 다른 도형 */
export const SEAT_GLYPHS = ["◆", "●", "▲", "■", "★", "✚"];

/** 인원별 수사 라운드 수 (§9 자가 대국으로 맞춘 값) */
export const ROUNDS_BY_PLAYERS: Record<number, number> = { 3: 2, 4: 2, 5: 1, 6: 1 };

/** 이 방에 금고실 계단이 있나 */
export function hasStairs(room: number): boolean {
  return VAULT_DOORS.includes(room);
}
