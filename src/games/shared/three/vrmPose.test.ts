import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { armJointQuat, toVrm0, upperArmQuat } from "./vrmPose";

// In the VRM T-pose the left arm points +x and the right arm −x (model faces +z).
const ARM = { l: new THREE.Vector3(1, 0, 0), r: new THREE.Vector3(-1, 0, 0) };

describe("vrmPose", () => {
  it("rest channels hang both arms down (a touch outward)", () => {
    for (const s of ["l", "r"] as const) {
      const v = ARM[s].clone().applyQuaternion(upperArmQuat(s, 0, 0, 0));
      expect(v.y).toBeLessThan(-0.99);
      expect(Math.sign(v.x)).toBe(s === "l" ? 1 : -1);
    }
  });

  it("negative shoulder x swings the arm forward, like SeatedPerson", () => {
    const v = ARM.l.clone().applyQuaternion(upperArmQuat("l", -1.0, 0, 0));
    expect(v.z).toBeGreaterThan(0.8);
  });

  it("a negative elbow flex lifts the forearm forward in the hanging frame", () => {
    // forearm in the bone's own frame also points along the arm (+x for the left arm)
    const upper = upperArmQuat("l", 0, 0, 0);
    const fore = ARM.l.clone().applyQuaternion(armJointQuat("l", -Math.PI / 2, 0)).applyQuaternion(upper);
    expect(fore.z).toBeGreaterThan(0.95);
  });

  it("toVrm0 is the conjugate by a 180° turn about y", () => {
    const quat = upperArmQuat("r", -0.7, 0.2, 0.3);
    const flip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
    const expected = flip.clone().multiply(quat).multiply(flip.clone().invert());
    const got = toVrm0(quat.clone());
    expect(Math.abs(got.dot(expected))).toBeCloseTo(1, 6);
  });
});
