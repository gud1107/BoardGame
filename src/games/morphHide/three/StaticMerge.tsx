"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * 움직이지 않는 소품 수백 개를 재질별로 한 덩어리씩 합쳐 그린다.
 *
 * 가구·바깥 소품은 작은 상자·원기둥 여러 개로 되어 있어(판마다 ~470개) 그대로 두면
 * 화면 그리기 + 그림자 그리기가 각각 수백 번이다. 자식을 한 번 그려서 월드 위치를 굽고
 * 같은 재질끼리 합친 뒤, 원본은 더 그리지 않는다(`key`가 바뀌면 다시 굽는다).
 * 공간을 칸으로 나눠 합치므로 화면 밖 칸은 여전히 건너뛴다.
 */

const CELL = 30;
const WHITE = new THREE.Color(1, 1, 1);

function matKey(m: THREE.Material): string {
  const a = m as THREE.MeshStandardMaterial & THREE.MeshBasicMaterial;
  // 색은 꼭짓점 색으로 굽고, 거칠기는 0.1 단위로 묶는다 — 묶음 수가 확 줄어든다
  return [m.type, a.map ? a.color?.getHexString() : "", Math.round((a.roughness ?? 1) * 10), Math.round((a.metalness ?? 0) * 10), a.emissive?.getHexString(), a.emissiveIntensity, a.map?.uuid ?? "", m.transparent, m.opacity, m.side, m.toneMapped, m.depthWrite].join("|");
}

function prepGeometry(src: THREE.BufferGeometry, mat: THREE.Matrix4, color: THREE.Color): THREE.BufferGeometry {
  const g = src.index ? src.toNonIndexed() : src.clone();
  for (const name of Object.keys(g.attributes)) if (name !== "position" && name !== "normal" && name !== "uv") g.deleteAttribute(name);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = color.r;
    col[i * 3 + 1] = color.g;
    col[i * 3 + 2] = color.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.morphAttributes = {};
  g.clearGroups();
  g.applyMatrix4(mat);
  if (mat.determinant() < 0) {
    // 거울상 변환이면 삼각형 감김 방향을 되돌린다
    const p = g.attributes.position.array as Float32Array;
    const nn = g.attributes.normal.array as Float32Array;
    const u = g.attributes.uv.array as Float32Array;
    for (let i = 0; i < p.length; i += 9) {
      for (const [arr, w] of [[p, 3], [nn, 3], [u, 2]] as const) {
        const o = (i / 3) * w;
        for (let k = 0; k < w; k++) {
          const t = arr[o + w + k];
          arr[o + w + k] = arr[o + 2 * w + k];
          arr[o + 2 * w + k] = t;
        }
      }
    }
  }
  return g;
}

interface Baked {
  key: string;
  meshes: THREE.Mesh[];
}

export default function StaticMerge({ bakeKey, children }: { bakeKey: string; children: ReactNode }) {
  const src = useRef<THREE.Group>(null);
  const [baked, setBaked] = useState<Baked | null>(null);
  const ready = baked?.key === bakeKey;

  useLayoutEffect(() => {
    if (ready) return;
    const root = src.current;
    if (!root) return;
    root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const buckets = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[] }>();
    const local = new THREE.Matrix4();
    const c = new THREE.Vector3();
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || Array.isArray(m.material) || !m.geometry?.attributes.position) return;
      local.multiplyMatrices(inv, m.matrixWorld);
      const mc = (m.material as THREE.MeshStandardMaterial).color;
      const tinted = !!mc && !(m.material as THREE.MeshStandardMaterial).map;
      const g = prepGeometry(m.geometry, local, tinted ? mc : WHITE);
      g.computeBoundingBox();
      g.boundingBox!.getCenter(c);
      const k = `${Math.floor(c.x / CELL)},${Math.floor(c.z / CELL)}|${matKey(m.material)}`;
      let b = buckets.get(k);
      if (!b) {
        const mat = m.material.clone() as THREE.MeshStandardMaterial;
        if (tinted) mat.color = new THREE.Color(1, 1, 1);
        mat.vertexColors = true;
        buckets.set(k, (b = { mat, geos: [] }));
      }
      b.geos.push(g);
    });
    const meshes: THREE.Mesh[] = [];
    for (const { mat, geos } of buckets.values()) {
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      meshes.push(new THREE.Mesh(merged, mat));
    }
    setBaked({ key: bakeKey, meshes });
  }, [bakeKey, ready]);

  useLayoutEffect(() => {
    if (!baked) return;
    return () => {
      for (const m of baked.meshes) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    };
  }, [baked]);

  return (
    <group>
      {ready ? baked.meshes.map((m) => <primitive key={m.uuid} object={m} />) : <group ref={src}>{children}</group>}
    </group>
  );
}
