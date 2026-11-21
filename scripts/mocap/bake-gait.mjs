#!/usr/bin/env node
/**
 * Bakes real motion-capture gait cycles (walk / run / sneak) for the shared VRM standing
 * body (src/games/shared/three/vrmGait.ts) → public/models/motion/gait.json.
 *
 * Source: CMU Graphics Lab Motion Capture Database, MotionBuilder-friendly BVH release
 * (cgspeed, mirrored at github.com/una-dinosauria/cmu-mocap). "Free for use in research
 * and commercial projects worldwide" — see CREDITS.md. Every file's frame 0 is a T-pose,
 * which is exactly the rest pose of VRM's normalized humanoid bones, so retargeting is:
 *
 *   D_t(bone) = W_t(bone) · W_0(bone)⁻¹      (world rotation relative to the T-pose)
 *
 * stored per VRM humanoid bone; the runtime turns those into local rotations against
 * whichever parent bones the model actually has (upperChest / shoulders / toes are optional).
 *
 * Per clip: split into stride cycles (right thigh most forward → next), drop the first and
 * last stride (starting / stopping) and any stride that turns, face each stride along +z,
 * average them into one cycle of N samples, and spread the loop seam out over the cycle.
 *
 *   node scripts/mocap/bake-gait.mjs            (downloads the BVHs into scripts/mocap/.cache)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { BVHLoader } from "three/examples/jsm/loaders/BVHLoader.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const cache = path.join(here, ".cache");
const OUT = path.join(root, "public/models/motion/gait.json");
const N = 32;

/** clip → CMU takes (subject, trial) whose strides are averaged. Chosen by eye from the CMU index; see CREDITS.md. */
const CLIPS = {
  walk: [["007", "07_01"], ["008", "08_01"], ["016", "16_15"], ["012", "12_02"]],
  run: [["016", "16_35"], ["113", "113_07"]],
  sneak: [["077", "77_29"]],
};

/** VRM humanoid bone → CMU (MotionBuilder naming) joint. Root-first. */
const MAP = [
  ["hips", "Hips"],
  ["spine", "LowerBack"],
  ["chest", "Spine"],
  ["upperChest", "Spine1"],
  ["neck", "Neck"],
  ["head", "Head"],
  ["leftShoulder", "LeftShoulder"],
  ["leftUpperArm", "LeftArm"],
  ["leftLowerArm", "LeftForeArm"],
  ["leftHand", "LeftHand"],
  ["rightShoulder", "RightShoulder"],
  ["rightUpperArm", "RightArm"],
  ["rightLowerArm", "RightForeArm"],
  ["rightHand", "RightHand"],
  ["leftUpperLeg", "LeftUpLeg"],
  ["leftLowerLeg", "LeftLeg"],
  ["leftFoot", "LeftFoot"],
  ["leftToes", "LeftToeBase"],
  ["rightUpperLeg", "RightUpLeg"],
  ["rightLowerLeg", "RightLeg"],
  ["rightFoot", "RightFoot"],
  ["rightToes", "RightToeBase"],
];

async function bvhText(subject, trial) {
  fs.mkdirSync(cache, { recursive: true });
  const file = path.join(cache, `${trial}.bvh`);
  if (!fs.existsSync(file)) {
    const url = `https://raw.githubusercontent.com/una-dinosauria/cmu-mocap/master/data/${subject}/${trial}.bvh`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    fs.writeFileSync(file, await r.text());
  }
  return fs.readFileSync(file, "utf8");
}

/** World rotations of the mapped joints + hips world position for every frame. */
function sampleFrames(text) {
  const { skeleton, clip } = new BVHLoader().parse(text);
  const byName = new Map(skeleton.bones.map((b) => [b.name, b]));
  const holder = new THREE.Group();
  holder.add(skeleton.bones[0]);
  const tracks = clip.tracks.map((t) => {
    const [name, prop] = t.name.split(".");
    return { bone: byName.get(name), prop, track: t };
  });
  const times = clip.tracks[0].times;
  const frames = [];
  for (let f = 0; f < times.length; f++) {
    for (const { bone, prop, track } of tracks) {
      const s = track.getValueSize();
      const v = track.values;
      if (prop === "quaternion") bone.quaternion.fromArray(v, f * s);
      else if (prop === "position") bone.position.fromArray(v, f * s);
    }
    holder.updateMatrixWorld(true);
    const q = {};
    for (const [vrm, cmu] of MAP) {
      const b = byName.get(cmu);
      if (!b) throw new Error(`missing joint ${cmu}`);
      q[vrm] = b.getWorldQuaternion(new THREE.Quaternion());
    }
    const pos = (n) => byName.get(n).getWorldPosition(new THREE.Vector3());
    frames.push({ q, hips: pos("Hips"), lFoot: pos("LeftFoot"), lHand: pos("LeftHand"), lArm: pos("LeftArm") });
  }
  return frames;
}

const yawOf = (v) => Math.atan2(v.x, v.z);

/** Steady straight strides of one recording, each resampled to N+1 samples faced along +z. */
function stridesOf(frames, name) {
  const t0 = frames[0];
  // the T-pose must face +z with the actor's left arm along +x (VRM's convention)
  const armDir = t0.lHand.clone().sub(t0.lArm);
  if (armDir.x < 0.8 * armDir.length()) throw new Error(`${name}: frame 0 is not a +z-facing T-pose (left arm ${armDir.toArray()})`);
  const legLen = t0.hips.y - t0.lFoot.y;
  const inv0 = Object.fromEntries(MAP.map(([b]) => [b, t0.q[b].clone().invert()]));
  const D = frames.map((fr) => Object.fromEntries(MAP.map(([b]) => [b, fr.q[b].clone().multiply(inv0[b])])));

  // stride boundaries: right thigh pointing most forward (thigh axis = D · (0,−1,0))
  const fwd = D.map((d) => new THREE.Vector3(0, -1, 0).applyQuaternion(d.rightUpperLeg));
  const heading = (i) => {
    const h = new THREE.Vector3(0, 0, 1).applyQuaternion(D[i].hips);
    return Math.atan2(h.x, h.z);
  };
  const sig = fwd.map((v, i) => {
    // forward relative to where the hips face
    const y = heading(i);
    return v.x * Math.sin(y) + v.z * Math.cos(y);
  });
  const smooth = sig.map((_, i) => {
    let s = 0, n = 0;
    for (let k = -6; k <= 6; k++)
      if (sig[i + k] !== undefined) {
        s += sig[i + k];
        n++;
      }
    return s / n;
  });
  const peaks = [];
  for (let i = 30; i < smooth.length - 6; i++) {
    let top = true;
    for (let k = -25; k <= 25; k++) if (smooth[i + k] > smooth[i]) top = false;
    if (top && smooth[i] > 0.15 && (!peaks.length || i - peaks.at(-1) > 40)) peaks.push(i);
  }
  const strides = [];
  for (let i = 0; i + 1 < peaks.length; i++) {
    const a = peaks[i], b = peaks[i + 1];
    const disp = frames[b].hips.clone().sub(frames[a].hips).setY(0);
    const turn = Math.abs(((heading(b) - heading(a) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
    strides.push({ a, b, disp, turn });
  }
  // keep steady straight strides (not the first / last of a long take, which start and stop)
  const keep = (strides.length > 3 ? strides.slice(1, -1) : strides).filter((s) => s.turn < 0.26 && s.disp.length() > 0.25 * legLen);
  if (!keep.length) console.warn(`  (skipped ${name}: no steady strides)`);

  const tmp = new THREE.Quaternion();
  return keep.map((s) => {
    const R = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -yawOf(s.disp));
    const start = frames[s.a].hips;
    const rots = MAP.map(() => []);
    const pos = [];
    for (let k = 0; k <= N; k++) {
      const f = s.a + ((s.b - s.a) * k) / N;
      const i = Math.min(Math.floor(f), frames.length - 2);
      const u = f - i;
      MAP.forEach(([b], j) => rots[j].push(R.clone().multiply(tmp.copy(D[i][b]).slerp(D[i + 1][b], u))));
      // the hips path with forward travel removed, in leg lengths
      const h = frames[i].hips.clone().lerp(frames[i + 1].hips, u).sub(start).applyQuaternion(R);
      h.z -= (s.disp.length() * k) / N;
      pos.push(h.multiplyScalar(1 / legLen));
    }
    return { rots, pos, secs: (s.b - s.a) / 120, len: s.disp.length() / legLen };
  });
}

/** One looping cycle: the average of every stride, with the loop seam spread over the cycle. */
function bakeCycle(strides, name) {
  const rots = MAP.map(() => Array.from({ length: N + 1 }, () => new THREE.Quaternion(0, 0, 0, 0)));
  const pos = Array.from({ length: N + 1 }, () => new THREE.Vector3());
  for (const s of strides)
    for (let k = 0; k <= N; k++) {
      MAP.forEach((_, j) => {
        const q = s.rots[j][k].clone();
        const acc = rots[j][k];
        if (acc.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
        acc.set(acc.x + q.x, acc.y + q.y, acc.z + q.z, acc.w + q.w);
      });
      pos[k].add(s.pos[k]);
    }
  for (const r of rots) for (const q of r) q.normalize();
  for (const p of pos) p.multiplyScalar(1 / strides.length);
  for (const r of rots) {
    const err = r[0].clone().multiply(r[N].clone().invert());
    for (let k = 0; k <= N; k++) r[k].premultiply(new THREE.Quaternion().slerp(err, k / N));
  }
  const drift = pos[N].clone().sub(pos[0]);
  for (let k = 0; k <= N; k++) pos[k].sub(drift.clone().multiplyScalar(k / N));
  const mean = pos.slice(0, N).reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / N);

  const r4 = (x) => Math.round(x * 1e4) / 1e4;
  const q = [];
  for (let k = 0; k < N; k++) for (const r of rots) q.push(r4(r[k].x), r4(r[k].y), r4(r[k].z), r4(r[k].w));
  const hips = [];
  for (let k = 0; k < N; k++) hips.push(r4(pos[k].x - mean.x), r4(pos[k].y - mean.y));
  const avg = (f) => strides.reduce((a, s) => a + f(s), 0) / strides.length;
  const secs = avg((s) => s.secs);
  console.log(`${name}: ${strides.length} strides averaged, cycle ${secs.toFixed(2)}s, stride ${avg((s) => s.len).toFixed(2)} leg lengths`);
  return { n: N, cycleSec: r4(secs), stride: r4(avg((s) => s.len)), q, hips };
}

const out = { source: "CMU Graphics Lab Motion Capture Database (mocap.cs.cmu.edu), cgspeed BVH release", bones: MAP.map(([b]) => b), clips: {} };
// TRY="walk=029/29_01+016/16_15" bakes just those (prints stats, writes nothing)
const TRY = process.env.TRY ? Object.fromEntries(process.env.TRY.split(",").map((e) => e.split("=")).map(([k, v]) => [k, v.split("+").map((x) => x.split("/"))])) : null;
for (const [name, takes] of Object.entries(TRY ?? CLIPS)) {
  const strides = [];
  for (const [subject, trial] of takes) strides.push(...stridesOf(sampleFrames(await bvhText(subject, trial)), `${name} ${trial}`));
  if (!strides.length) throw new Error(`${name}: no strides`);
  out.clips[name] = { from: takes.map((t) => t[1]), ...bakeCycle(strides, name) };
}
if (TRY) process.exit(0);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`wrote ${path.relative(root, OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(1)} KB)`);
