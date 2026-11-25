import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * VRoid exports hair as one skinned mesh per lock: 40–114 draw calls for one head, all with the
 * same material and skeleton. Merge those locks into one mesh, so a head of hair is one draw.
 *
 * Only hair: first-person mode hides it by material name, so it needs no per-mesh VRM
 * annotation, unlike the body and face meshes. Morphing, hidden or no-depth-write meshes are left alone.
 * Returns how many meshes were merged away.
 */
export function mergeHair(root: THREE.Object3D): number {
  const groups = new Map<string, THREE.SkinnedMesh[]>();
  root.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh || !mesh.visible || mesh.children.length > 0 || !mesh.parent) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (!/hair/i.test(mats[0].name) || mats.some((m) => m.transparent && !m.depthWrite)) return;
    const g = mesh.geometry;
    if (!g.index || Object.keys(g.morphAttributes).length > 0) return;
    // several materials = the MToon outline pass, which draws the whole mesh again
    if (g.groups.some((r) => r.start !== 0 || (r.count !== Infinity && r.count < g.index!.count))) return;
    const attrs = Object.keys(g.attributes)
      .sort()
      .map((n) => {
        const a = g.attributes[n] as THREE.BufferAttribute;
        return `${n}:${a.array.constructor.name}:${a.itemSize}:${a.normalized}:${(a as unknown as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute ?? false}`;
      })
      .join();
    mesh.updateMatrix();
    const key = [mesh.parent.uuid, mesh.skeleton.uuid, mats.map((m) => m.uuid).join(), attrs, mesh.matrix.elements.join(), mesh.bindMatrix.elements.join(), mesh.layers.mask, mesh.renderOrder].join("|");
    const list = groups.get(key);
    if (list) list.push(mesh);
    else groups.set(key, [mesh]);
  });
  let gone = 0;
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const parts = list.map((m) => m.geometry);
    const merged = mergeGeometries(parts, false);
    if (!merged) continue;
    const keep = list[0];
    if (Array.isArray(keep.material)) keep.material.forEach((_, i) => merged.addGroup(0, merged.index!.count, i));
    keep.geometry = merged;
    for (const m of list.slice(1)) m.removeFromParent();
    for (const g of parts) g.dispose();
    gone += list.length - 1;
  }
  return gone;
}
