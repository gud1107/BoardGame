import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { VRMHumanBoneName } from "@pixiv/three-vrm";
import { cycleAt, GAIT_STYLES, gaitLocal, gaitParents, parseGait, sampleGait } from "./vrmGait";

const data = parseGait(JSON.parse(readFileSync(join(process.cwd(), "public/models/motion/gait.json"), "utf8")));
const B = data.bones.length;
const at = (b: VRMHumanBoneName) => data.bones.indexOf(b);
const one = (s: (typeof GAIT_STYLES)[number]) => GAIT_STYLES.map((x) => (x === s ? 1 : 0));

function pose(style: (typeof GAIT_STYLES)[number], u: number) {
  const D = Array.from({ length: B }, () => new THREE.Quaternion());
  const hips = { x: 0, y: 0 };
  sampleGait(data, one(style), u, D, hips);
  return { D, hips };
}

/** Where a limb segment points in the world (T-pose rest: legs down, left arm +x). */
const dir = (D: THREE.Quaternion[], b: VRMHumanBoneName, rest: [number, number, number]) => new THREE.Vector3(...rest).applyQuaternion(D[at(b)]);

describe("baked mocap gait", () => {
  it("has every clip and the humanoid bones the body uses", () => {
    for (const b of ["hips", "spine", "chest", "neck", "head", "leftUpperLeg", "rightLowerLeg", "leftUpperArm", "rightFoot"] as VRMHumanBoneName[]) expect(at(b)).toBeGreaterThanOrEqual(0);
    expect(data.clips.walk.cycleSec).toBeGreaterThan(0.9);
    expect(data.clips.walk.cycleSec).toBeLessThan(1.5);
    expect(data.clips.run.cycleSec).toBeLessThan(data.clips.walk.cycleSec);
  });

  it.each(GAIT_STYLES)("%s starts with the right thigh forward and the left back, and swaps half a cycle later", (s) => {
    const a = pose(s, 0).D;
    const h = pose(s, 0.5).D;
    expect(dir(a, "rightUpperLeg", [0, -1, 0]).z).toBeGreaterThan(0.2);
    expect(dir(a, "leftUpperLeg", [0, -1, 0]).z).toBeLessThan(dir(a, "rightUpperLeg", [0, -1, 0]).z);
    expect(dir(h, "leftUpperLeg", [0, -1, 0]).z).toBeGreaterThan(dir(h, "rightUpperLeg", [0, -1, 0]).z);
  });

  it.each(GAIT_STYLES)("%s keeps the body upright, facing +z, arms down — not a T-pose", (s) => {
    for (const u of [0, 0.25, 0.5, 0.75]) {
      const { D, hips } = pose(s, u);
      // the creeping walk is hunched (chest ~40° forward), the others stay tall
      expect(dir(D, "head", [0, 1, 0]).y).toBeGreaterThan(s === "sneak" ? 0.7 : 0.9);
      expect(dir(D, "hips", [0, 0, 1]).z).toBeGreaterThan(0.85);
      expect(dir(D, "leftUpperArm", [1, 0, 0]).y).toBeLessThan(-0.6);
      expect(dir(D, "rightUpperArm", [-1, 0, 0]).y).toBeLessThan(-0.6);
      expect(Math.abs(hips.y)).toBeLessThan(0.12);
      // the creeping walk shifts its weight wide from foot to foot
      expect(Math.abs(hips.x)).toBeLessThan(s === "sneak" ? 0.2 : 0.06);
    }
  });

  it.each(GAIT_STYLES)("%s loops without a jump at the seam", (s) => {
    const a = pose(s, 0.999).D;
    const b = pose(s, 0).D;
    for (let i = 0; i < B; i++) expect(a[i].angleTo(b[i])).toBeLessThan(0.08);
  });

  it("maps addWalk's phase onto the cycle (right thigh most forward = cycle start)", () => {
    expect(cycleAt((3 * Math.PI) / 2)).toBeCloseTo(0);
    expect(cycleAt((3 * Math.PI) / 2 + Math.PI)).toBeCloseTo(0.5);
    expect(cycleAt(-100)).toBeGreaterThanOrEqual(0);
  });

  it("finds each bone's parent on models without upperChest / shoulders", () => {
    const missing = new Set<VRMHumanBoneName>(["upperChest", "leftShoulder", "rightShoulder", "leftToes"]);
    const par = gaitParents(data.bones, (b) => !missing.has(b));
    expect(data.bones[par[at("neck")]]).toBe("chest");
    expect(data.bones[par[at("leftUpperArm")]]).toBe("chest");
    expect(data.bones[par[at("leftFoot")]]).toBe("leftLowerLeg");
    expect(par[at("hips")]).toBe(-1);
  });

  it("local rotations rebuild the world deltas down the chain", () => {
    const { D } = pose("walk", 0.3);
    const par = gaitParents(data.bones, () => true);
    const world: THREE.Quaternion[] = [];
    for (let i = 0; i < B; i++) {
      const l = gaitLocal(D, par, i, new THREE.Quaternion());
      world[i] = par[i] < 0 ? l : world[par[i]].clone().multiply(l);
      expect(world[i].angleTo(D[i])).toBeLessThan(1e-4);
    }
  });
});
