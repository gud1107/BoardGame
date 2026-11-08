/** WebGL 지원 여부 — three.js를 불러오지 않고 확인한다(2D로 대체할지 결정). */
export function webglAvailable(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}
