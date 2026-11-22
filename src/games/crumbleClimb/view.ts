import type { SnapBuffer } from "./net";
import type { MatchState } from "./sim";

/** 3D 무대·2D 보기·보드가 함께 쓰는 값 (매 프레임 바뀌는 건 React 상태가 아니라 이 객체에) */
export interface SceneShared {
  buf: SnapBuffer;
  mySeat: number;
  shake: number;
  labels: (HTMLDivElement | null)[];
  /** 카메라가 기둥 둘레 어느 각도에 있나 (입력 방향 바꾸기용) */
  camAngle: number;
  /** 카메라가 따라가는 자리 */
  follow: number;
  /** 자리별 마지막 밀치기 시각 (performance.now) — 스냅샷 사이에 끼는 짧은 동작을 잠깐 붙잡는다 */
  shoveAt: number[];
}

/** 카메라가 따라갈 자리: 내가 오르는 중이면 나, 아니면 아직 오르는 사람 중 가장 높은 사람 */
export function followSeat(snap: MatchState, me: number): number {
  const p = snap.players[me];
  if (!p || p.status === "climb" || snap.phase !== "climb") return me;
  let best = -1;
  let by = -Infinity;
  for (const o of snap.players)
    if (o.status === "climb" && o.y > by) {
      by = o.y;
      best = o.seat;
    }
  return best >= 0 ? best : me;
}

/**
 * 화면 방향(sx → 오른쪽, sz → 아래) → 월드 이동 방향. 카메라는 기둥 바깥 각도 θ에서 기둥을 보므로
 * 화면 오른쪽 = (sin θ, −cos θ), 화면 위 = 기둥 쪽 (−cos θ, −sin θ).
 */
export function screenToWorld(sx: number, sz: number, camAngle: number): { mx: number; mz: number } {
  const s = Math.sin(camAngle);
  const c = Math.cos(camAngle);
  return { mx: sx * s + sz * c, mz: -sx * c + sz * s };
}
