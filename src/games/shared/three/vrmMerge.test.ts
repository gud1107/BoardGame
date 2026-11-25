import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { mergeHair } from "./vrmMerge";

function lock(material: THREE.Material | THREE.Material[], skeleton: THREE.Skeleton) {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.clearGroups();
  const n = g.attributes.position.count;
  g.setAttribute("skinIndex", new THREE.BufferAttribute(new Uint16Array(n * 4), 4));
  g.setAttribute("skinWeight", new THREE.BufferAttribute(new Float32Array(n * 4), 4));
  if (Array.isArray(material)) material.forEach((_, i) => g.addGroup(0, Infinity, i));
  const m = new THREE.SkinnedMesh(g, material);
  m.bind(skeleton, new THREE.Matrix4());
  return m;
}
const named = (name: string) => Object.assign(new THREE.MeshBasicMaterial(), { name });

describe("mergeHair", () => {
  it("merges locks sharing a material and skeleton, keeping every triangle and the outline pass", () => {
    const sk = new THREE.Skeleton([new THREE.Bone()]);
    const mats = [named("A_HAIR"), named("A_HAIR (Outline)")];
    const root = new THREE.Group();
    const tris = Array.from({ length: 5 }, () => lock(mats, sk)).map((m) => (root.add(m), m.geometry.index!.count));
    expect(mergeHair(root)).toBe(4);
    const g = (root.children[0] as THREE.SkinnedMesh).geometry;
    const total = tris.reduce((a, b) => a + b, 0);
    expect(root.children).toHaveLength(1);
    expect(g.index!.count).toBe(total);
    expect(g.groups.map((x) => [x.start, x.count, x.materialIndex])).toEqual([[0, total, 0], [0, total, 1]]);
  });

  it("leaves body meshes, hidden, blended, morphing meshes and other skeletons alone", () => {
    const sk = new THREE.Skeleton([new THREE.Bone()]);
    const hair = named("HAIR");
    const body = named("Body_SKIN");
    const blended = Object.assign(named("HAIR2"), { transparent: true, depthWrite: false });
    const root = new THREE.Group();
    const hidden = lock(hair, sk);
    hidden.visible = false;
    const morph = lock(hair, sk);
    morph.geometry.morphAttributes.position = [new THREE.BufferAttribute(new Float32Array(72), 3)];
    root.add(lock(body, sk), lock(body, sk), lock(blended, sk), lock(blended, sk), hidden, morph, lock(hair, sk), lock(hair, new THREE.Skeleton([new THREE.Bone()])));
    expect(mergeHair(root)).toBe(0);
    expect(root.children).toHaveLength(8);
  });
});
