/**
 * 시대의 진격 3D battlefield — plain three.js (no R3F), display only.
 *
 * EraMarchBoard owns the simulation; once per animation frame it calls
 * `render(frame)` with the live state, the previous tick's positions (for
 * interpolation) and `alpha` into the current tick. Fresh engine events go
 * through `onEvents`, which only spawns effects — nothing here feeds back
 * into the rules.
 *
 * Draw-call budget (same approach as mergeDefense's defenseScene): every
 * unit look is one InstancedMesh per layer (body / team tint / glow), so the
 * count scales with distinct looks on screen, not with soldiers. Particles,
 * projectiles, rings and corpses are fixed instanced pools; nothing
 * allocates per frame. Resolution and shadows step down when frames run
 * long.
 *
 * Mirror (online guest, side 1): the whole scene gets scale.x = −1 so your
 * own base is on the left too; only the camera, the overlay projection and
 * drag direction need to know (three.js flips face winding for negative
 * determinants by itself).
 *
 * Readability layer: a 2D canvas on top draws HP bars in team colour with a
 * role glyph (⚔/🏹/🐎), floating damage numbers (orange and larger on a
 * counter hit, grey on a weak one), gold pop-ups, base HP plates and an edge
 * arrow when your base is under attack off-screen.
 */

import * as THREE from "three";
import { ERAS, LANE, ROLE_ICON, TICK_MS, UNITS, type Era, type Fx, type TurretKind, type UnitKind } from "../data";
import { frontProgress, fromProgress, progress, wallX, type EraMarchState, type FxEvent, type Side } from "../engine";
import { airshipTemplate, baseTemplate, mammothTemplate, rockTemplate, shipTemplate, treeTemplate, turretTemplate, TURRET_SLOTS, type Template } from "./models";
import { TEAM_HEX, unitHeight, unitRig, type Rig } from "./rigs";
import { computePose, deathPose, newPose, type Pose } from "./anim";

export { TEAM_HEX };
const TEAM = TEAM_HEX.map((h) => new THREE.Color(h)) as [THREE.Color, THREE.Color];

const W = (laneX: number) => laneX / 10 - LANE / 20;
const BASE_OFFSET = 2.4; // base origin sits this far behind its wall
const VEHICLES = new Set<UnitKind>(["chariot", "armored", "steamtank", "hovertank", "drone", "colossus"]);
const UNIT_CAP = 40;
const HOVER = new Set<UnitKind>(["hovertank", "drone"]);

export interface Frame {
  s: EraMarchState;
  prevX: Map<number, number>;
  alpha: number;
  now: number;
  dt: number;
  viewer: Side;
  reduceShake: boolean;
}

/* ── instanced pools for one unit rig ────────────────────────────────── */

const _B = new THREE.Matrix4();
const _UB = new THREE.Matrix4();
const _P = new THREE.Matrix4();
const _R = new THREE.Matrix4();
const _T = new THREE.Matrix4();

/**
 * Every part of one kind × side rig is an InstancedMesh (plus a glow mesh
 * where it has lit-up bits). `push` composes unit → body lean → joint for
 * every part of one soldier.
 */
class RigPool {
  parts: { key: Rig["parts"][number]["key"]; pivots: THREE.Vector3[]; main: THREE.InstancedMesh | null; glow: THREE.InstancedMesh | null; n: number }[];
  constructor(readonly rig: Rig, mats: Mats, scene: THREE.Scene) {
    const white = new THREE.Color(1, 1, 1);
    this.parts = rig.parts.map((part) => {
      const cap = UNIT_CAP * part.pivots.length;
      const mk = (g: THREE.BufferGeometry | null, mat: THREE.Material, shadow: boolean) => {
        if (!g) return null;
        const m = new THREE.InstancedMesh(g, mat, cap);
        m.castShadow = shadow;
        m.frustumCulled = false;
        m.count = 0;
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        scene.add(m);
        return m;
      };
      const main = mk(part.main, mats.body, true);
      if (main) for (let i = 0; i < cap; i++) main.setColorAt(i, white);
      return { key: part.key, pivots: part.pivots, main, glow: mk(part.glow, mats.glow, false), n: 0 };
    });
  }
  begin() {
    for (const p of this.parts) p.n = 0;
  }
  push(U: THREE.Matrix4, pose: Pose, flash: number) {
    const hip = this.rig.hipY;
    // body lean around the hips, then the step forward/back and the bob
    _q.setFromEuler(_e.set(pose.roll, pose.twist, -pose.pitch, "YZX"));
    _B.makeTranslation(pose.lunge, pose.bob + hip, 0).multiply(_R.makeRotationFromQuaternion(_q)).multiply(_T.makeTranslation(0, -hip, 0));
    _UB.multiplyMatrices(U, _B);
    _c.setScalar(flash);
    for (const p of this.parts) {
      for (let i = 0; i < p.pivots.length; i++) {
        const pv = p.pivots[i];
        switch (p.key) {
          case "body":
            _P.copy(_UB);
            break;
          case "armL":
          case "armR": {
            const rot = p.key === "armL" ? pose.armL : pose.armR;
            const off = p.key === "armL" ? pose.armLx : pose.armRx;
            _P.copy(_UB).multiply(_T.makeTranslation(pv.x + off, pv.y, pv.z)).multiply(_R.makeRotationZ(rot));
            break;
          }
          case "barrel":
            _P.copy(_UB).multiply(_T.makeTranslation(pv.x + pose.barrel, pv.y, pv.z));
            break;
          case "rotor":
            _P.copy(_UB).multiply(_T.makeTranslation(pv.x, pv.y, pv.z)).multiply(_R.makeRotationY(pose.rotor + i));
            break;
          default: {
            const rot = p.key === "legs" ? pose.legs[i] : p.key === "fleg" ? pose.fleg[i] : p.key === "bleg" ? pose.bleg[i] : p.key === "wheel" ? pose.wheel : p.key === "cape" ? pose.cape : 0;
            _P.copy(_UB).multiply(_T.makeTranslation(pv.x, pv.y, pv.z)).multiply(_R.makeRotationZ(rot ?? 0));
          }
        }
        const idx = p.n++;
        if (p.main && idx < p.main.instanceMatrix.count) {
          p.main.setMatrixAt(idx, _P);
          p.main.setColorAt(idx, _c);
        }
        if (p.glow && idx < p.glow.instanceMatrix.count) p.glow.setMatrixAt(idx, _P);
      }
    }
  }
  end() {
    for (const p of this.parts) {
      for (const m of [p.main, p.glow]) {
        if (!m) continue;
        m.count = Math.min(p.n, m.instanceMatrix.count);
        m.visible = m.count > 0;
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
    }
  }
  dispose() {
    for (const p of this.parts) {
      p.main?.dispose();
      p.glow?.dispose();
    }
  }
}

/** Per-unit animation memory (not part of the simulation). */
interface UnitView {
  lastX: number;
  stride: number;
  move: number;
  spawnAt: number;
  hitAt: number;
  hitPow: number;
}

const POSE = newPose();

interface Mats {
  body: THREE.MeshStandardMaterial;
  team: THREE.MeshStandardMaterial;
  glow: THREE.MeshBasicMaterial;
}

const _c = new THREE.Color();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);

/* ── particles ───────────────────────────────────────────────────────── */

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  g: number;
  drag: number;
  life: number;
  max: number;
  s0: number;
  s1: number;
  r: number;
  gr: number;
  b: number;
}

class ParticlePool {
  mesh: THREE.InstancedMesh;
  list: Particle[] = [];
  constructor(scene: THREE.Scene, mat: THREE.Material, cap: number, geo: THREE.BufferGeometry) {
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    scene.add(this.mesh);
  }
  spawn(p: Omit<Particle, "life">) {
    if (this.list.length >= this.mesh.instanceMatrix.count) this.list.shift();
    this.list.push({ ...p, life: 0 });
  }
  update(dt: number) {
    let n = 0;
    const keep: Particle[] = [];
    for (const p of this.list) {
      p.life += dt;
      if (p.life >= p.max) continue;
      p.vy -= p.g * dt;
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vy *= d;
      p.vz *= d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < 0.05 && p.g > 0) {
        p.y = 0.05;
        p.vy *= -0.3;
        p.vx *= 0.6;
        p.vz *= 0.6;
      }
      const k = p.life / p.max;
      const sc = p.s0 + (p.s1 - p.s0) * k;
      _m.compose(_v.set(p.x, p.y, p.z), _q.setFromEuler(_e.set(p.life * 3, p.life * 2, 0)), _s.setScalar(Math.max(0.001, sc)));
      this.mesh.setMatrixAt(n, _m);
      this.mesh.setColorAt(n, _c.setRGB(p.r, p.gr, p.b));
      n++;
      keep.push(p);
    }
    this.list = keep;
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

/* ── projectiles ─────────────────────────────────────────────────────── */

type ProjStyle = "stone" | "arrow" | "bullet" | "bomb" | "orb" | "heal" | "beam" | "zapbeam" | "rock" | "shell";

interface Proj {
  style: ProjStyle;
  a: THREE.Vector3;
  b: THREE.Vector3;
  t0: number;
  dur: number;
  arc: number;
}

const FX_STYLE: Partial<Record<Fx, ProjStyle>> = {
  stone: "stone",
  arrow: "arrow",
  musket: "bullet",
  rifle: "bullet",
  bomb: "bomb",
  shell: "bomb",
  plasma: "orb",
  heal: "heal",
  rail: "beam",
  zap: "zapbeam",
};

interface Ring {
  mesh: THREE.Mesh;
  t0: number;
  dur: number;
  r0: number;
  r1: number;
  op: number;
}

interface Corpse {
  kind: UnitKind;
  side: Side;
  x: number;
  z: number;
  t0: number;
  dir: number;
  seed: number;
}

interface FloatText {
  text: string;
  x: number;
  y: number;
  z: number;
  t0: number;
  color: string;
  size: number;
  dur: number;
}

interface BaseView {
  group: THREE.Group;
  era: Era;
  meshes: Map<Era, THREE.Group>;
  rise: { from: Era; to: Era; t0: number } | null;
  shake: number;
  turrets: (THREE.Group | null)[];
  turretKinds: (TurretKind | null)[];
}

const laneZ = (id: number) => (((id * 37) % 7) - 3) * 0.42;

export class BattleScene {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(36, 1, 0.5, 600);
  private overlay: CanvasRenderingContext2D;
  private mats: Mats;
  private rigs = new Map<string, RigPool>();
  private uview = new Map<number, UnitView>();
  private blobs!: THREE.InstancedMesh;
  private sparks: ParticlePool;
  private debris: ParticlePool;
  private smoke: ParticlePool;
  private projPools = new Map<ProjStyle, THREE.InstancedMesh>();
  private projs: Proj[] = [];
  private rings: Ring[] = [];
  private ringFree: THREE.Mesh[] = [];
  private lights: { l: THREE.PointLight; t0: number; dur: number; peak: number }[] = [];
  private corpses: Corpse[] = [];
  private texts: FloatText[] = [];
  private flashAt = new Map<number, number>();
  private bases: [BaseView, BaseView];
  private sky: THREE.Mesh;
  private skyMat: THREE.ShaderMaterial;
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private front: [THREE.Mesh, THREE.Mesh];
  /** Team-coloured ground ring under every unit — reads blue vs red from any zoom. */
  private feet: THREE.InstancedMesh;
  private ships: THREE.Group[] = [];
  private shipsUntil: [number, number] = [0, 0];
  private airship: THREE.Group;
  private mammoths: THREE.Group[] = [];
  private emp: { mesh: THREE.Mesh; t0: number; x: number; dir: number } | null = null;
  private empMesh: THREE.Mesh;
  private camX = -30;
  private camTarget = -30;
  private zoom = 1;
  private manualUntil = 0;
  private shake = 0;
  private w = 1;
  private h = 1;
  private dpr = 1;
  private slowFrames = 0;
  private quality = 2;
  private lastSmoke = 0;
  private skyEra = -1;
  private now = 0;

  /** −1 when the view is mirrored. */
  private readonly M: number;

  constructor(private host: HTMLElement, overlayCanvas: HTMLCanvasElement, private mirror = false) {
    this.M = mirror ? -1 : 1;
    this.scene.scale.x = this.M;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    host.prepend(this.renderer.domElement);
    this.overlay = overlayCanvas.getContext("2d")!;

    this.mats = {
      body: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.05 }),
      team: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.05, emissive: 0x111111 }),
      glow: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    };
    // warm rim light: silhouettes read crisply against the ground at any zoom
    this.mats.body.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\n  float emRim = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);\n  totalEmissiveRadiance += vec3(1.0, 0.92, 0.78) * emRim * 0.3;",
      );
    };

    // sky dome
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { top: { value: new THREE.Color("#7aa7d6") }, bottom: { value: new THREE.Color("#f5c487") } },
      vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader: "uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = clamp(vP.y*1.6+0.15,0.0,1.0); gl_FragColor = vec4(mix(bottom, top, h), 1.0); }",
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(400, 24, 12), this.skyMat);
    this.scene.add(this.sky);
    this.scene.fog = new THREE.Fog("#e9d3b0", 110, 330);

    this.hemi = new THREE.HemisphereLight("#dbeafe", "#5b4a2b", 1.1);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight("#fff3d6", 2.4);
    this.sun.position.set(25, 60, 45);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 1024);
    const sc = this.sun.shadow.camera;
    sc.left = -60;
    sc.right = 60;
    sc.top = 30;
    sc.bottom = -30;
    sc.near = 10;
    sc.far = 160;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);

    this.buildGround();

    // effects
    const blob = new THREE.IcosahedronGeometry(1, 0);
    this.sparks = new ParticlePool(this.scene, new THREE.MeshBasicMaterial({ color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }), 700, blob);
    this.debris = new ParticlePool(this.scene, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), 500, blob);
    this.smoke = new ParticlePool(this.scene, new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, flatShading: true }), 300, new THREE.IcosahedronGeometry(1, 1));
    this.debris.mesh.castShadow = true;
    this.buildProjectilePools();
    for (let i = 0; i < 24; i++) {
      const mesh = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      this.scene.add(mesh);
      this.ringFree.push(mesh);
    }
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight("#ffb366", 0, 30, 1.6);
      this.scene.add(l);
      this.lights.push({ l, t0: -1, dur: 0, peak: 0 });
    }

    // bases
    this.bases = [this.makeBase(0), this.makeBase(1)];

    // fronts (team strips on the lane edge)
    this.front = ([0, 1] as const).map((side): THREE.Mesh => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.55), new THREE.MeshBasicMaterial({ color: TEAM[side], transparent: true, opacity: 0.75, toneMapped: false }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(0, 0.06, 3.9);
      this.scene.add(m);
      return m;
    }) as unknown as [THREE.Mesh, THREE.Mesh];

    this.feet = new THREE.InstancedMesh(new THREE.RingGeometry(0.5, 0.82, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false }), 40);
    this.feet.frustumCulled = false;
    this.feet.count = 0;
    this.feet.setColorAt(0, TEAM[0]);
    this.scene.add(this.feet);
    this.blobs = new THREE.InstancedMesh(new THREE.CircleGeometry(0.85, 18).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }), UNIT_CAP * 2);
    this.blobs.frustumCulled = false;
    this.blobs.count = 0;
    this.scene.add(this.blobs);

    // special props
    for (let i = 0; i < 4; i++) this.mammoths.push(this.propGroup(mammothTemplate(), 0));
    this.airship = this.propGroup(airshipTemplate(), 0);
    for (let i = 0; i < 4; i++) this.ships.push(this.propGroup(shipTemplate(), i < 2 ? 0 : 1));
    this.empMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.MeshBasicMaterial({ color: "#67e8f9", transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    this.empMesh.visible = false;
    this.scene.add(this.empMesh);

    this.resize();
  }

  /* ── setup helpers ─────────────────────────────────────────────────── */

  private buildGround() {
    const g = new THREE.PlaneGeometry(520, 260, 80, 40);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    const cols = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const n = Math.sin(x * 0.21) * Math.cos(z * 0.17) + Math.sin(x * 0.05 + z * 0.09);
      if (z < -14) pos.setY(i, Math.max(0, (-z - 14) * 0.05 * (1 + Math.sin(x * 0.07) * 0.6)));
      c.set("#6f8f3a").offsetHSL(n * 0.015, 0, n * 0.04);
      cols.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute("color", new THREE.BufferAttribute(cols, 3));
    g.computeVertexNormals();
    const ground = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
    ground.receiveShadow = true;
    this.scene.add(ground);

    // dirt lane with ruts
    const lane = new THREE.PlaneGeometry(LANE / 10 + 30, 8.4, 120, 6);
    lane.rotateX(-Math.PI / 2);
    const lp = lane.attributes.position;
    const lc = new Float32Array(lp.count * 3);
    for (let i = 0; i < lp.count; i++) {
      const x = lp.getX(i);
      const z = lp.getZ(i);
      const edge = Math.abs(z) / 4.2;
      const rut = Math.abs(Math.abs(z) - 1.6) < 0.5 ? -0.05 : 0;
      c.set("#a07a4a").offsetHSL(0, -0.05 * edge, Math.sin(x * 1.3 + z * 2.1) * 0.03 + rut - edge * 0.05);
      lc.set([c.r, c.g, c.b], i * 3);
    }
    lane.setAttribute("color", new THREE.BufferAttribute(lc, 3));
    const laneMesh = new THREE.Mesh(lane, new THREE.MeshLambertMaterial({ vertexColors: true }));
    laneMesh.position.y = 0.03;
    laneMesh.receiveShadow = true;
    this.scene.add(laneMesh);

    // centre marker
    const mid = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 8.4), new THREE.MeshBasicMaterial({ color: "#fef3c7", transparent: true, opacity: 0.5 }));
    mid.rotation.x = -Math.PI / 2;
    mid.position.set(0, 0.05, 0);
    this.scene.add(mid);

    // scenery
    const rng = mulberry(77);
    const tree = treeTemplate();
    const trees = new THREE.InstancedMesh(tree.main, this.mats.body, 90);
    trees.castShadow = true;
    let n = 0;
    for (let i = 0; i < 90; i++) {
      const x = -95 + rng() * 190;
      const z = -10 - rng() * 60;
      if (Math.abs(x) > 54 && Math.abs(z) < 16) continue;
      const s = 0.8 + rng() * 1.1;
      trees.setMatrixAt(n++, _m.compose(_v.set(x, Math.max(0, (-z - 14) * 0.05), z), _q.setFromAxisAngle(AXIS_Y, rng() * 6), _s.setScalar(s)));
    }
    trees.count = n;
    this.scene.add(trees);
    const rock = rockTemplate();
    const rocks = new THREE.InstancedMesh(rock.main, this.mats.body, 60);
    rocks.castShadow = true;
    for (let i = 0; i < 60; i++) {
      const front = i % 3 === 0;
      const x = -80 + rng() * 160;
      const z = front ? 6 + rng() * 10 : -6 - rng() * 30;
      rocks.setMatrixAt(i, _m.compose(_v.set(x, 0, z), _q.setFromAxisAngle(AXIS_Y, rng() * 6), _s.setScalar(0.4 + rng() * (front ? 0.5 : 1.3))));
    }
    this.scene.add(rocks);
    // distant mountains
    const mountMat = new THREE.MeshLambertMaterial({ color: "#8aa0b8", flatShading: true });
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(new THREE.ConeGeometry(25 + rng() * 30, 30 + rng() * 40, 5), mountMat);
      m.position.set(-220 + i * 34 + rng() * 10, 10, -150 - rng() * 40);
      this.scene.add(m);
    }
    // grass tufts along the lane
    const tuft = new THREE.InstancedMesh(new THREE.ConeGeometry(0.18, 0.6, 3), new THREE.MeshLambertMaterial({ color: "#5f7f2c" }), 400);
    for (let i = 0; i < 400; i++) {
      const z = (rng() < 0.5 ? -1 : 1) * (4.4 + rng() * 6);
      tuft.setMatrixAt(i, _m.compose(_v.set(-70 + rng() * 140, 0.25, z), _q.identity(), _s.setScalar(0.6 + rng())));
    }
    this.scene.add(tuft);
  }

  private buildProjectilePools() {
    const add = (style: ProjStyle, geo: THREE.BufferGeometry, mat: THREE.Material, cap = 80) => {
      const m = new THREE.InstancedMesh(geo, mat, cap);
      m.frustumCulled = false;
      m.count = 0;
      this.scene.add(m);
      this.projPools.set(style, m);
    };
    const glow = (hex: string) => new THREE.MeshBasicMaterial({ color: hex, toneMapped: false, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
    add("stone", new THREE.DodecahedronGeometry(0.2, 0), new THREE.MeshLambertMaterial({ color: "#8b8b8b", flatShading: true }));
    add("arrow", new THREE.BoxGeometry(0.9, 0.05, 0.05), new THREE.MeshLambertMaterial({ color: "#6b4a2b" }));
    add("bullet", new THREE.BoxGeometry(1.1, 0.07, 0.07), glow("#fde68a"));
    add("bomb", new THREE.IcosahedronGeometry(0.26, 1), new THREE.MeshStandardMaterial({ color: "#1f2937", roughness: 0.4, metalness: 0.4 }));
    add("orb", new THREE.IcosahedronGeometry(0.3, 1), glow("#67e8f9"));
    add("heal", new THREE.IcosahedronGeometry(0.22, 1), glow("#4ade80"));
    add("beam", new THREE.BoxGeometry(1, 0.12, 0.12), glow("#c4b5fd"), 30);
    add("zapbeam", new THREE.BoxGeometry(1, 0.1, 0.1), glow("#a5f3fc"), 60);
    add("rock", new THREE.DodecahedronGeometry(1.0, 0), new THREE.MeshLambertMaterial({ color: "#78716c", flatShading: true }), 20);
    add("shell", new THREE.IcosahedronGeometry(0.45, 1), new THREE.MeshStandardMaterial({ color: "#111827", roughness: 0.3, metalness: 0.6 }), 20);
  }

  private propGroup(t: Template, side: Side): THREE.Group {
    const g = new THREE.Group();
    const main = new THREE.Mesh(t.main, this.mats.body);
    main.castShadow = true;
    g.add(main);
    if (t.team) {
      const tm = new THREE.Mesh(t.team, this.mats.team.clone());
      (tm.material as THREE.MeshStandardMaterial).color.copy(TEAM[side]);
      tm.castShadow = true;
      g.add(tm);
    }
    if (t.glow) g.add(new THREE.Mesh(t.glow, this.mats.glow));
    g.visible = false;
    this.scene.add(g);
    return g;
  }

  private setPropTeam(g: THREE.Group, side: Side) {
    const tm = g.children[1] as THREE.Mesh | undefined;
    if (tm && tm.material instanceof THREE.MeshStandardMaterial && tm.material !== this.mats.body) tm.material.color.copy(TEAM[side]);
  }

  private makeBase(side: Side): BaseView {
    const group = new THREE.Group();
    const x = W(side === 0 ? 0 : LANE) + (side === 0 ? 1 : -1) * (BASE_OFFSET - 1);
    group.position.set(x, 0, 0);
    group.rotation.y = side === 0 ? 0 : Math.PI;
    this.scene.add(group);
    const view: BaseView = { group, era: 0, meshes: new Map(), rise: null, shake: 0, turrets: [null, null, null], turretKinds: [null, null, null] };
    view.meshes.set(0, this.baseMeshes(0, side, group));
    // slot pads
    for (const [sx, sy, sz] of TURRET_SLOTS) {
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.95, 0.25, 8), new THREE.MeshStandardMaterial({ color: "#57534e", roughness: 0.9 }));
      pad.position.set(sx, sy - 0.12, sz);
      pad.castShadow = true;
      group.add(pad);
    }
    return view;
  }

  private baseMeshes(era: Era, side: Side, parent: THREE.Group): THREE.Group {
    const t = baseTemplate(era);
    const g = new THREE.Group();
    const main = new THREE.Mesh(t.main, this.mats.body);
    main.castShadow = true;
    main.receiveShadow = true;
    g.add(main);
    if (t.team) {
      const mat = this.mats.team.clone();
      mat.color.copy(TEAM[side]);
      const tm = new THREE.Mesh(t.team, mat);
      tm.castShadow = true;
      g.add(tm);
    }
    if (t.glow) g.add(new THREE.Mesh(t.glow, this.mats.glow));
    parent.add(g);
    return g;
  }

  private rigPool(kind: UnitKind, side: Side): RigPool {
    const key = `${kind}:${side}`;
    let p = this.rigs.get(key);
    if (!p) {
      p = new RigPool(unitRig(kind, side), this.mats, this.scene);
      this.rigs.set(key, p);
    }
    return p;
  }

  private unitView(id: number, x: number): UnitView {
    let v = this.uview.get(id);
    if (!v) {
      v = { lastX: x, stride: (id * 0.37) % 2, move: 0, spawnAt: -10, hitAt: -10, hitPow: 0 };
      this.uview.set(id, v);
    }
    return v;
  }


  /* ── public controls ───────────────────────────────────────────────── */

  resize() {
    const r = this.host.getBoundingClientRect();
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.dpr = Math.min(window.devicePixelRatio || 1, this.quality >= 2 ? 2 : this.quality === 1 ? 1.25 : 0.85);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(this.w, this.h, false);
    const cv = this.overlay.canvas;
    const odpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(this.w * odpr);
    cv.height = Math.round(this.h * odpr);
    this.overlay.setTransform(odpr, 0, 0, odpr, 0, 0);
    const aspect = this.w / this.h;
    this.camera.aspect = aspect;
    this.camera.fov = aspect < 1 ? 50 : aspect < 1.4 ? 42 : 36;
    this.camera.updateProjectionMatrix();
  }

  /** Drag in screen pixels → camera pan; auto-follow resumes after a pause. */
  pan(dxPx: number) {
    const span = this.visibleWidth();
    this.camX = clamp(this.camX - (dxPx / this.w) * span * this.M, -48, 48);
    this.camTarget = this.camX;
    this.manualUntil = performance.now() + 4000;
  }

  zoomBy(f: number) {
    this.zoom = clamp(this.zoom * f, 0.55, 1.7);
  }

  /** Jump to a lane position (minimap tap). */
  focusLane(laneX: number) {
    this.camX = this.camTarget = clamp(W(laneX), -48, 48);
    this.manualUntil = performance.now() + 5000;
  }

  /** Lane x at the camera centre and half the visible span — for the minimap box and positional sound. */
  view(): { center: number; half: number } {
    return { center: (this.camX + LANE / 20) * 10, half: this.visibleWidth() * 5 };
  }

  private camDistance() {
    const aspect = this.w / this.h;
    return (aspect < 1 ? 52 : aspect < 1.4 ? 46 : 44) * this.zoom;
  }

  private visibleWidth() {
    const hf = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) * this.camera.aspect);
    return 2 * this.camDistance() * Math.tan(hf / 2);
  }

  /* ── events → effects ──────────────────────────────────────────────── */

  onEvents(events: readonly FxEvent[], s: EraMarchState) {
    const now = this.now;
    for (const e of events) {
      switch (e.t) {
        case "spawn": {
          const x = W(fromProgress(e.side, 40));
          this.unitView(e.id, fromProgress(e.side, 40)).spawnAt = now;
          this.ring(x, 0.1, laneZ(e.id), 0.4, 2.2, 0.35, TEAM_HEX[e.side], 0.9);
          this.burst(this.debris, x, 0.2, laneZ(e.id), 8, 2.5, 3, 0.15, 0.6, "#a07a4a", 6);
          break;
        }
        case "shot": {
          const style = e.fx === "zap" && e.turret < 0 ? null : FX_STYLE[e.fx];
          const fromY = e.turret >= 0 ? TURRET_SLOTS[e.turret][1] + 1.2 : e.fx === "heal" ? 2.0 : 1.4;
          const fromZ = e.turret >= 0 ? TURRET_SLOTS[e.turret][2] * (e.side === 0 ? 1 : -1) : e.id > 0 ? laneZ(e.id) : 0;
          const toY = e.base ? 3 : 1.2;
          const a = new THREE.Vector3(W(e.from), fromY, fromZ);
          const b = new THREE.Vector3(W(e.to), toY, e.base ? 0 : fromZ * 0.5);
          if (style) {
            const dur = (e.ticks * TICK_MS) / 1000;
            const arc = style === "stone" || style === "bomb" ? Math.abs(a.x - b.x) * 0.22 + 1 : style === "arrow" ? Math.abs(a.x - b.x) * 0.1 : 0;
            if (style === "beam" || style === "zapbeam") this.projs.push({ style, a, b, t0: now, dur: 0.16, arc: 0 });
            else this.projs.push({ style, a, b, t0: now, dur, arc });
          }
          if (e.fx === "musket" || e.fx === "rifle" || e.fx === "shell") {
            const d = e.side === 0 ? 1 : -1;
            this.burst(this.sparks, a.x + d * 0.8, a.y, a.z, 6, 4, 0, 0.12, 0.16, "#fff1b8", 2, d);
            this.burst(this.smoke, a.x + d * 0.6, a.y, a.z, 3, 1.2, -0.5, 0.25, 0.9, "#d6d3d1", 0.7);
          }
          if (e.fx === "rail" || e.fx === "plasma") this.burst(this.sparks, a.x, a.y, a.z, 6, 3, 0, 0.12, 0.2, "#c4b5fd", 2);
          break;
        }
        case "swing":
          break;
        case "hit": {
          if (e.dmg <= 0) {
            this.burst(this.debris, W(e.x), 0.3, 0, 5, 2, 6, 0.12, 0.5, "#a07a4a", 4);
            break;
          }
          if (e.id > 0) {
            this.flashAt.set(e.id, now);
            const v = this.uview.get(e.id);
            if (v) {
              v.hitAt = now;
              v.hitPow = e.mul > 1 ? 1.4 : e.mul < 1 ? 0.6 : 1;
            }
          }
          const x = W(e.x);
          const z = e.base ? 0 : e.id > 0 ? laneZ(e.id) : 0;
          const y = e.base ? 2 + Math.random() * 3 : 1.2;
          this.hitFx(e.fx, x, y, z, e.base);
          if (e.base) this.bases[e.side].shake = Math.min(1, this.bases[e.side].shake + 0.35);
          const big = e.mul > 1;
          const weak = e.mul < 1;
          this.texts.push({
            text: big ? `${e.dmg}!` : String(e.dmg),
            x: x + (Math.random() - 0.5) * 0.8,
            y: y + 1.2,
            z,
            t0: now,
            color: e.base ? "#fecaca" : big ? "#fb923c" : weak ? "#a8a29e" : "#ffffff",
            size: e.base ? 15 : big ? 17 : weak ? 11 : 13,
            dur: 0.9,
          });
          break;
        }
        case "death": {
          const def = UNITS[e.kind];
          const x = W(e.x);
          const z = laneZ(e.id);
          this.corpses.push({ kind: e.kind, side: e.side, x, z, t0: now, dir: e.id % 2 ? 1 : -1, seed: e.id * 7 + Math.floor(Math.random() * 3) });
          this.uview.delete(e.id);
          if (VEHICLES.has(e.kind)) this.explosion(x, 1, z, 1 + def.size * 0.4, false);
          else {
            this.burst(this.sparks, x, 1.4, z, 10, 2.5, -2, 0.18, 0.7, "#ffffff", 3);
            this.burst(this.debris, x, 0.5, z, 6, 3, 7, 0.12, 0.8, "#a07a4a", 5);
          }
          break;
        }
        case "bounty": {
          this.texts.push({ text: `+${e.gold}${e.bonus ? "★" : ""}`, x: W(e.x), y: 3.2, z: 0, t0: now, color: e.side === 0 ? "#fde047" : "#fca5a5", size: e.side === 0 ? 14 : 11, dur: 1.2 });
          if (e.side === 0) this.burst(this.sparks, W(e.x), 2.4, 0, 6, 2, -3, 0.12, 0.6, "#fde047", 3);
          break;
        }
        case "heal":
          this.burst(this.sparks, W(e.x), 1.2, 0, 8, 1, -4, 0.14, 0.7, "#4ade80", 1.4);
          this.texts.push({ text: `+${e.amt}`, x: W(e.x), y: 2.6, z: 0, t0: now, color: "#86efac", size: 11, dur: 0.8 });
          break;
        case "steal":
          this.texts.push({ text: `💰-${e.gold}`, x: W(e.x), y: 3, z: 0, t0: now, color: "#fbbf24", size: 11, dur: 0.8 });
          break;
        case "evolve": {
          const b = this.bases[e.side];
          b.rise = { from: b.era, to: e.era, t0: now };
          if (!b.meshes.has(e.era)) b.meshes.set(e.era, this.baseMeshes(e.era, e.side, b.group));
          b.era = e.era;
          const x = b.group.position.x;
          this.pillar(x, ERAS[e.era].accent);
          this.ring(x, 0.2, 0, 1, 18, 1.2, "#fde68a", 1);
          this.ring(x, 0.2, 0, 1, 11, 0.9, TEAM_HEX[e.side], 1);
          this.burst(this.sparks, x, 4, 0, 60, 9, -2, 0.25, 1.6, "#fde68a", 8);
          this.burst(this.smoke, x, 1, 0, 24, 6, -1, 1.2, 2.2, "#c8b89a", 3);
          this.light(x, 6, 0, "#fde68a", 40, 1.4);
          this.kick(0.6);
          break;
        }
        case "special":
          this.specialStart(e.side, e.era, s);
          break;
        case "strike":
          if (e.era === 1) this.explosion(W(e.x), 0.5, 0, 2.4, true, "#a8a29e");
          else if (e.era === 2) this.explosion(W(e.x), 0.8, 0, 1.6, true);
          else if (e.era === 3) this.explosion(W(e.x), 0.6, (Math.random() - 0.5) * 2, 1.8, true);
          else if (e.era === 4) this.lightning(W(e.x));
          break;
        case "turret":
        case "sell": {
          const b = this.bases[e.side];
          const [sx, sy, sz] = TURRET_SLOTS[e.slot];
          const wx = b.group.position.x + (e.side === 0 ? sx : -sx);
          this.burst(this.smoke, wx, sy, sz * (e.side === 0 ? 1 : -1), 10, 2.5, -1, 0.4, 1, "#d6d3d1", 2);
          this.burst(this.sparks, wx, sy + 0.5, sz * (e.side === 0 ? 1 : -1), 14, 4, 4, 0.12, 0.5, "#fde68a", 3);
          break;
        }
        case "slot": {
          const b = this.bases[e.side];
          const [sx, sy, sz] = TURRET_SLOTS[e.slot];
          this.ring(b.group.position.x + (e.side === 0 ? sx : -sx), sy, sz * (e.side === 0 ? 1 : -1), 0.4, 2.4, 0.5, "#fde68a", 1);
          break;
        }
        case "end": {
          if (e.winner === "draw") break;
          const loser = this.bases[e.winner === 0 ? 1 : 0];
          const x = loser.group.position.x;
          for (let i = 0; i < 6; i++) this.explosion(x + (Math.random() - 0.5) * 6, 2 + Math.random() * 6, (Math.random() - 0.5) * 8, 2.5, true);
          this.kick(1.2);
          break;
        }
        default:
          break;
      }
    }
  }

  private hitFx(fx: Fx, x: number, y: number, z: number, base: boolean) {
    switch (fx) {
      case "sword":
      case "blade":
      case "bayonet":
        this.burst(this.sparks, x, y, z, 7, 5, 4, 0.08, 0.25, "#fff7d6", 3);
        break;
      case "club":
      case "gore":
      case "trample":
      case "ram":
        this.burst(this.debris, x, 0.4, z, 5, 3, 8, 0.14, 0.6, "#a07a4a", 5);
        this.burst(this.smoke, x, 0.5, z, 2, 1.2, -0.3, 0.4, 0.7, "#cbb894", 0.8);
        this.burst(this.sparks, x, y, z, 4, 3, 3, 0.1, 0.2, "#ffffff", 2);
        break;
      case "stone":
        this.burst(this.debris, x, y, z, 5, 3, 8, 0.1, 0.5, "#8b8b8b", 4);
        break;
      case "arrow":
        this.burst(this.debris, x, y, z, 3, 2, 8, 0.06, 0.4, "#6b4a2b", 3);
        this.burst(this.sparks, x, y, z, 3, 2, 3, 0.07, 0.15, "#ffffff", 2);
        break;
      case "musket":
      case "rifle":
        this.burst(this.sparks, x, y, z, 6, 4, 3, 0.07, 0.2, "#fde68a", 3);
        this.burst(this.smoke, x, y, z, 1, 0.8, -0.5, 0.3, 0.5, "#e7e5e4", 0.6);
        break;
      case "bomb":
      case "shell":
        this.explosion(x, Math.max(0.5, y - 0.6), z, base ? 1.4 : 1.1, false);
        break;
      case "plasma":
      case "zap":
      case "rail":
        this.burst(this.sparks, x, y, z, 10, 5, 0, 0.1, 0.3, fx === "rail" ? "#c4b5fd" : "#67e8f9", 4);
        this.ring(x, y, z, 0.2, 1.4, 0.25, fx === "rail" ? "#a78bfa" : "#22d3ee", 0.9, true);
        break;
      case "heal":
        break;
    }
  }

  private explosion(x: number, y: number, z: number, size: number, shake: boolean, dust = "#57534e") {
    this.burst(this.sparks, x, y, z, Math.round(18 * size), 7 * size, -1, 0.35 * size, 0.55, "#ffb347", 5 * size);
    this.burst(this.sparks, x, y, z, Math.round(8 * size), 3 * size, -1, 0.5 * size, 0.3, "#fff1b8", 2 * size);
    this.burst(this.smoke, x, y + 0.5, z, Math.round(8 * size), 2.2 * size, -1.2, 0.7 * size, 1.6, dust, 1.6 * size);
    this.burst(this.debris, x, y, z, Math.round(10 * size), 6 * size, 12, 0.14, 1.1, "#3f3f46", 7 * size);
    this.ring(x, 0.15, z, 0.4, 4 * size, 0.45, "#fed7aa", 0.9);
    this.light(x, y + 1, z, "#ffb366", 25 * size, 0.35);
    if (shake) this.kick(0.25 * size);
  }

  private lightning(x: number) {
    const top = new THREE.Vector3(x + (Math.random() - 0.5) * 2, 20, 0);
    let prev = top.clone();
    for (let i = 1; i <= 6; i++) {
      const next = new THREE.Vector3(x + (Math.random() - 0.5) * (i < 6 ? 2.4 : 0), 20 - i * 3.3, (Math.random() - 0.5) * 1.5);
      this.projs.push({ style: "zapbeam", a: prev, b: next, t0: this.now, dur: 0.22, arc: 0 });
      prev = next;
    }
    this.burst(this.sparks, x, 1, 0, 16, 6, 0, 0.12, 0.4, "#a5f3fc", 5);
    this.ring(x, 0.2, 0, 0.3, 3, 0.4, "#22d3ee", 1);
    this.light(x, 3, 0, "#67e8f9", 30, 0.3);
  }

  private specialStart(side: Side, era: Era, s: EraMarchState) {
    const d = side === 0 ? 1 : -1;
    if (era === 0) {
      this.mammoths.forEach((m) => {
        m.visible = true;
        m.rotation.y = side === 0 ? 0 : Math.PI;
      });
      this.kick(0.3);
    } else if (era === 2) {
      this.shipsUntil[side] = this.now + 3.2;
      const front = W(fromProgress(side, frontProgress(s, side)));
      this.ships.forEach((sh, i) => {
        if ((i < 2 ? 0 : 1) !== side) return;
        sh.visible = true;
        sh.position.set(front - d * (10 + (i % 2) * 14), -4, -26 - (i % 2) * 8);
        sh.rotation.y = side === 0 ? 0 : Math.PI;
      });
    } else if (era === 3) {
      this.setPropTeam(this.airship, side);
      this.airship.rotation.y = side === 0 ? 0 : Math.PI;
    } else if (era === 4) {
      const x = W(fromProgress(side, Math.max(80, frontProgress(s, side))));
      this.emp = { mesh: this.empMesh, t0: this.now, x, dir: d };
      this.light(x, 4, 0, "#67e8f9", 60, 0.8);
      this.ring(x, 0.3, 0, 1, 60, 0.9, "#22d3ee", 1);
      this.kick(0.5);
    }
    if (era === 1) {
      // catapult launch puff behind my base
      const bx = this.bases[side].group.position.x - d * 3;
      this.burst(this.smoke, bx, 6, 0, 12, 3, -1, 0.6, 1.4, "#a8a29e", 2);
    }
    for (const m of this.mammoths) this.setPropTeam(m, side);
  }

  /* ── small FX helpers ──────────────────────────────────────────────── */

  private burst(pool: ParticlePool, x: number, y: number, z: number, n: number, speed: number, g: number, size: number, life: number, hex: string, up = 3, biasX = 0) {
    _c.set(hex);
    const r = _c.r;
    const gr = _c.g;
    const b = _c.b;
    const lim = this.quality === 0 ? Math.ceil(n / 2) : n;
    for (let i = 0; i < lim; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.35 + Math.random() * 0.65);
      const smoke = pool === this.smoke;
      pool.spawn({
        x,
        y,
        z,
        vx: Math.cos(a) * sp + biasX * speed * 0.8,
        vy: up * (0.4 + Math.random()),
        vz: Math.sin(a) * sp * 0.6,
        g,
        drag: smoke ? 1.8 : 1.2,
        max: life * (0.7 + Math.random() * 0.6),
        s0: size * (smoke ? 0.6 : 1),
        s1: smoke ? size * 2.2 : size * 0.2,
        r,
        gr,
        b,
      });
    }
  }

  private ring(x: number, y: number, z: number, r0: number, r1: number, dur: number, hex: string, op: number, upright = false) {
    const mesh = this.ringFree.pop() ?? this.rings.shift()?.mesh;
    if (!mesh) return;
    (mesh.material as THREE.MeshBasicMaterial).color.set(hex);
    mesh.position.set(x, y, z);
    mesh.rotation.set(upright ? 0 : -Math.PI / 2, upright ? Math.PI / 2 : 0, 0);
    mesh.visible = true;
    this.rings.push({ mesh, t0: this.now, dur, r0, r1, op });
  }

  private pillar(x: number, hex: string) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(3, 4.5, 40, 16, 1, true), new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    m.position.set(x, 20, 0);
    this.scene.add(m);
    const t0 = this.now;
    const tick = () => {
      const k = (this.now - t0) / 1.6;
      if (k >= 1) {
        this.scene.remove(m);
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
        return;
      }
      m.scale.set(1 - k * 0.6, 1, 1 - k * 0.6);
      (m.material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - k);
      this.later.push(tick);
    };
    this.later.push(tick);
  }
  private later: (() => void)[] = [];

  private light(x: number, y: number, z: number, hex: string, peak: number, dur: number) {
    const slot = this.lights.reduce((a, b) => (a.t0 + a.dur < b.t0 + b.dur ? a : b));
    slot.l.color.set(hex);
    slot.l.position.set(x, y, z);
    slot.t0 = this.now;
    slot.dur = dur;
    slot.peak = peak;
  }

  private kick(amount: number) {
    this.shake = Math.min(1.4, this.shake + amount);
  }

  /* ── per-frame render ──────────────────────────────────────────────── */

  render(f: Frame) {
    const { s, prevX, alpha, dt } = f;
    this.now += dt;
    const now = this.now;
    const tickF = s.tick - 1 + alpha;

    // queued once-per-frame callbacks (pillars)
    const later = this.later;
    this.later = [];
    for (const fn of later) fn();

    // sky by the most advanced era
    const era = Math.max(s.players[0].era, s.players[1].era) as Era;
    if (era !== this.skyEra) {
      this.skyEra = era;
      this.skyMat.uniforms.top.value.set(ERAS[era].sky[1]);
      this.skyMat.uniforms.bottom.value.set(ERAS[era].sky[0]);
      (this.scene.fog as THREE.Fog).color.set(ERAS[era].sky[0]);
      this.hemi.color.set(era === 4 ? "#c7d2fe" : "#dbeafe");
      this.sun.color.set(era === 4 ? "#e0e7ff" : "#fff3d6");
    }

    // camera follow
    const f0 = frontProgress(s, 0);
    const f1 = frontProgress(s, 1);
    const focus = f0 || f1 ? W((f0 + (LANE - f1)) / 2) : -30;
    const half = this.visibleWidth() / 2;
    if (performance.now() > this.manualUntil) this.camTarget = clamp(focus, -50 + half * 0.55, 50 - half * 0.55);
    this.camX += (this.camTarget - this.camX) * Math.min(1, dt * 2.2);
    const dist = this.camDistance();
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const sk = f.reduceShake ? 0 : this.shake * this.shake * 0.8;
    this.camera.position.set(this.camX * this.M + (Math.random() - 0.5) * sk, dist * 0.42 + (Math.random() - 0.5) * sk, dist);
    this.camera.lookAt(this.camX * this.M, 2.2, 0);
    this.sun.position.set(this.camX + 25, 60, 45);
    this.sun.target.position.set(this.camX, 0, 0);

    // units: jointed rigs posed from the engine's attack timing
    for (const p of this.rigs.values()) p.begin();
    let feet = 0;
    const cheer = s.winner === 0 || s.winner === 1 ? s.winner : -1;
    for (const u of s.units) {
      const def = UNITS[u.kind];
      const px = prevX.get(u.id) ?? u.x;
      const lx = px + (u.x - px) * alpha;
      const pool = this.rigPool(u.kind, u.side);
      const v = this.unitView(u.id, lx);
      const step = Math.abs(lx - v.lastX) / 10;
      v.lastX = lx;
      if (step < 2) v.stride += step;
      v.move += ((u.moving ? 1 : 0) - v.move) * Math.min(1, dt * 9);
      const cdSec = (def.cdTicks * TICK_MS) / 1000;
      const since = ((tickF - u.lastAtk) * TICK_MS) / 1000;
      const engaged = since < cdSec * 1.6 + 0.25;
      const z = laneZ(u.id);
      computePose(
        {
          rig: pool.rig,
          t: now,
          stride: v.stride,
          move: v.move,
          since: Math.max(0, since),
          cd: cdSec,
          engaged,
          hit: Math.max(0, 1 - (now - v.hitAt) / 0.26) * v.hitPow,
          stunned: u.stun > 0,
          spawn: Math.min(1, (now - v.spawnAt) / 0.38),
          cheer: cheer === u.side,
          seed: u.id,
        },
        POSE,
      );
      if (HOVER.has(u.kind)) POSE.bob += 0.35;
      const fl = this.flashAt.get(u.id);
      const flash = fl !== undefined && now - fl < 0.1 ? 2.4 : 1;
      _q.setFromAxisAngle(AXIS_Y, u.side === 0 ? 0 : Math.PI);
      _m.compose(_v.set(W(lx), 0, z), _q, _s.setScalar(POSE.scale));
      pool.push(_m, POSE, flash);
      if (feet < UNIT_CAP) {
        const r = def.size > 1.3 ? 1.6 : 1;
        this.feet.setMatrixAt(feet, _m.compose(_v.set(W(lx), 0.07, z), _q.identity(), _s.set(r, 1, r)));
        this.feet.setColorAt(feet, TEAM[u.side]);
        this.blobs.setMatrixAt(feet, _m.compose(_v.set(W(lx) + 0.15, 0.05, z - 0.1), _q, _s.set(r * 1.1, 1, r * 0.8)));
        feet++;
      }
      const dir = u.side === 0 ? 1 : -1;
      if (def.role === "charge" && u.moving && Math.random() < dt * 14) this.burst(this.smoke, W(lx) - dir, 0.2, z, 1, 0.6, -0.4, 0.25, 0.6, "#c8b48c", 0.5);
      if (u.kind === "steamtank" && Math.random() < dt * 6) this.burst(this.smoke, W(lx) - dir * 1.0, 3.4, z, 1, 0.4, -1.5, 0.35, 1.5, "#57534e", 1);
      if (u.moving && !VEHICLES.has(u.kind) && def.role !== "charge" && Math.random() < dt * 2.5) this.burst(this.debris, W(lx) - dir * 0.2, 0.08, z, 1, 0.5, 4, 0.05, 0.35, "#a07a4a", 0.6);
    }
    this.feet.count = feet;
    this.feet.instanceMatrix.needsUpdate = true;
    if (this.feet.instanceColor) this.feet.instanceColor.needsUpdate = true;
    // corpses: fall, flail, sink
    this.corpses = this.corpses.filter((c) => now - c.t0 < 2.1);
    let blobN = feet;
    for (const c of this.corpses) {
      const el = now - c.t0;
      const pool = this.rigPool(c.kind, c.side);
      deathPose(pool.rig, el, c.dir, c.seed, POSE);
      _q.setFromAxisAngle(AXIS_Y, c.side === 0 ? 0 : Math.PI);
      _m.compose(_v.set(c.x, 0, c.z), _q, _s.setScalar(1));
      pool.push(_m, POSE, el < 0.08 ? 2.2 : 0.75);
      if (blobN < UNIT_CAP * 2 && el < 1.2) this.blobs.setMatrixAt(blobN++, _m.compose(_v.set(c.x, 0.05, c.z), _q.identity(), _s.set(1.2, 1, 0.9)));
    }
    this.blobs.count = blobN;
    this.blobs.instanceMatrix.needsUpdate = true;
    for (const p of this.rigs.values()) p.end();
    if (s.tick % 100 === 0 && this.uview.size > s.units.length + 20) {
      const alive = new Set(s.units.map((u) => u.id));
      for (const id of this.uview.keys()) if (!alive.has(id)) this.uview.delete(id);
    }

    // bases, turrets
    for (const side of [0, 1] as const) this.updateBase(side, s, now, dt, tickF);

    // fronts
    for (const side of [0, 1] as const) {
      const fp = frontProgress(s, side);
      const m = this.front[side];
      const len = Math.max(0.01, (fp - 40) / 10);
      m.visible = fp > 45;
      m.scale.x = len;
      m.position.x = W(fromProgress(side, 40 + (fp - 40) / 2));
    }

    // sweeps (mammoths, airship)
    let mammothOn = false;
    let airOn = false;
    for (const w of s.sweeps) {
      if (w.era === 0) {
        mammothOn = true;
        const d = w.vx > 0 ? 1 : -1;
        this.mammoths.forEach((m, i) => {
          m.position.set(W(w.x) - d * (i * 2.6 + (i % 2) * 1.2), Math.abs(Math.sin(now * 12 + i)) * 0.3, (i - 1.5) * 1.8);
        });
        if (Math.random() < 0.8) this.burst(this.smoke, W(w.x) - d * 3, 0.3, (Math.random() - 0.5) * 6, 2, 2, -0.5, 0.6, 1.2, "#c8b48c", 1);
        this.shake = Math.max(this.shake, 0.35);
      } else if (w.era === 3) {
        airOn = true;
        this.airship.position.set(W(w.x), 14 + Math.sin(now * 1.5) * 0.4, -1);
        if (Math.random() < dt * 8) this.projs.push({ style: "bomb", a: new THREE.Vector3(W(w.x), 11.5, 0), b: new THREE.Vector3(W(w.x) + (w.vx > 0 ? 2 : -2), 0.4, 0), t0: now, dur: 0.6, arc: 0 });
      }
    }
    if (!mammothOn) for (const m of this.mammoths) m.visible = false;
    this.airship.visible = airOn;

    // strikes in flight
    this.projPools.get("rock")!.count = 0;
    this.projPools.get("shell")!.count = 0;
    for (const k of s.strikes) {
      if (k.target === -2 || k.era === 4) continue;
      const kf = clamp((tickF - k.at) / (k.due - k.at), 0, 1);
      const d = k.side === 0 ? 1 : -1;
      const tx = W(k.x);
      let a: THREE.Vector3;
      if (k.era === 1) a = _v2.set(this.bases[k.side].group.position.x - d * 4, 10, 0);
      else {
        const ship = this.ships.find((sh, i) => (i < 2 ? 0 : 1) === k.side && sh.visible);
        a = _v2.set(ship ? ship.position.x : tx - d * 15, 6, ship ? ship.position.z : -26);
        if (kf < 0.08 && ship && Math.random() < 0.5) this.burst(this.sparks, a.x + d * 3, 4, a.z + 1, 6, 3, 0, 0.4, 0.3, "#fff1b8", 1, d);
      }
      const style: ProjStyle = k.era === 1 ? "rock" : "shell";
      const pool = this.projPools.get(style)!;
      if (pool.count >= pool.instanceMatrix.count) continue;
      const px = a.x + (tx - a.x) * kf;
      const py = a.y + (0.6 - a.y) * kf + Math.sin(kf * Math.PI) * 10;
      const pz = a.z + (0 - a.z) * kf;
      pool.setMatrixAt(pool.count++, _m.compose(_v.set(px, py, pz), _q.setFromEuler(_e.set(now * 4, now * 3, 0)), _s.setScalar(1)));
    }
    // ships rise/sink
    this.ships.forEach((sh, i) => {
      if (!sh.visible) return;
      const side = i < 2 ? 0 : 1;
      const left = this.shipsUntil[side] - now;
      const target = left > 0 ? 0 : -6;
      sh.position.y += (target - sh.position.y) * Math.min(1, dt * 3);
      sh.rotation.z = Math.sin(now * 1.3 + i) * 0.04;
      if (left < -2) sh.visible = false;
    });
    // EMP dome
    if (this.emp) {
      const k = (now - this.emp.t0) / 0.9;
      if (k >= 1) {
        this.emp = null;
        this.empMesh.visible = false;
      } else {
        this.empMesh.visible = true;
        const r = 4 + k * 70;
        this.empMesh.position.set(this.emp.x + this.emp.dir * r * 0.6, 0, 0);
        this.empMesh.scale.set(r, r * 0.5, r * 0.35);
        (this.empMesh.material as THREE.MeshBasicMaterial).opacity = 0.3 * (1 - k);
      }
    }

    this.updateProjectiles(now);

    // particles
    this.sparks.update(dt);
    this.debris.update(dt);
    this.smoke.update(dt);

    // rings
    this.rings = this.rings.filter((r) => {
      const k = (now - r.t0) / r.dur;
      if (k >= 1) {
        r.mesh.visible = false;
        this.ringFree.push(r.mesh);
        return false;
      }
      const sc = r.r0 + (r.r1 - r.r0) * (1 - (1 - k) * (1 - k));
      r.mesh.scale.setScalar(sc);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = r.op * (1 - k);
      return true;
    });
    for (const L of this.lights) {
      const k = L.dur > 0 ? (now - L.t0) / L.dur : 1;
      L.l.intensity = k >= 0 && k < 1 ? L.peak * (1 - k) * (1 - k) * 8 : 0;
    }

    this.renderer.render(this.scene, this.camera);
    this.drawOverlay(f);
    this.adapt(dt);
  }

  private updateBase(side: Side, s: EraMarchState, now: number, dt: number, tickF: number) {
    const b = this.bases[side];
    const p = s.players[side];
    if (p.era !== b.era) this.onEvents([{ t: "evolve", side, era: p.era, doctrine: null }], s);
    b.shake = Math.max(0, b.shake - dt * 3);
    const baseX = W(side === 0 ? 0 : LANE) + (side === 0 ? 1 : -1) * (BASE_OFFSET - 1);
    b.group.position.x = baseX + (Math.random() - 0.5) * b.shake * 0.5;
    for (const [era, g] of b.meshes) {
      if (b.rise && (era === b.rise.from || era === b.rise.to)) {
        const k = clamp((now - b.rise.t0) / 1.4, 0, 1);
        const e = 1 - (1 - k) * (1 - k);
        g.visible = true;
        g.position.y = era === b.rise.to ? -14 * (1 - e) : -14 * e;
        if (k >= 1) b.rise = null;
      } else {
        g.visible = era === b.era;
        g.position.y = 0;
      }
    }
    // turrets
    for (let i = 0; i < 3; i++) {
      const t = p.turrets[i];
      if ((t?.kind ?? null) !== b.turretKinds[i]) {
        if (b.turrets[i]) b.group.remove(b.turrets[i]!);
        b.turrets[i] = null;
        b.turretKinds[i] = t?.kind ?? null;
        if (t) {
          const tt = turretTemplate(t.kind);
          const g = new THREE.Group();
          const main = new THREE.Mesh(tt.main, this.mats.body);
          main.castShadow = true;
          g.add(main);
          if (tt.team) {
            const mat = this.mats.team.clone();
            mat.color.copy(TEAM[side]);
            g.add(new THREE.Mesh(tt.team, mat));
          }
          if (tt.glow) g.add(new THREE.Mesh(tt.glow, this.mats.glow));
          const [sx, sy, sz] = TURRET_SLOTS[i];
          g.position.set(sx, sy, sz);
          b.group.add(g);
          b.turrets[i] = g;
        }
      }
      const g = b.turrets[i];
      if (g && t) {
        const k = (tickF - t.lastShot) / 5;
        g.position.x = TURRET_SLOTS[i][0] - (k >= 0 && k < 1 ? Math.sin(k * Math.PI) * 0.35 : 0);
        if (t.kind === "tesla") g.rotation.y = now * 0.6;
      }
    }
    // damage smoke / fire
    const hp = p.baseHp / p.baseMax;
    if (hp < 0.6 && now - this.lastSmoke > 0.12) {
      this.lastSmoke = now;
      const x = baseX - (side === 0 ? 1 : -1) * 1.5;
      this.burst(this.smoke, x + (Math.random() - 0.5) * 3, 4 + Math.random() * 3, (Math.random() - 0.5) * 6, 1, 0.5, -1.4, 0.6, 2.4, hp < 0.3 ? "#292524" : "#78716c", 1.2);
      if (hp < 0.3) this.burst(this.sparks, x + (Math.random() - 0.5) * 3, 3 + Math.random() * 2, (Math.random() - 0.5) * 6, 2, 0.6, -2, 0.3, 0.6, "#fb923c", 1.5);
    }
  }

  private updateProjectiles(now: number) {
    for (const [style, pool] of this.projPools) if (style !== "rock" && style !== "shell") pool.count = 0;
    this.projs = this.projs.filter((p) => {
      const k = (now - p.t0) / p.dur;
      if (k >= 1) return false;
      const pool = this.projPools.get(p.style)!;
      if (pool.count >= pool.instanceMatrix.count) return true;
      if (p.style === "beam" || p.style === "zapbeam") {
        _v.copy(p.a).add(p.b).multiplyScalar(0.5);
        const len = p.a.distanceTo(p.b);
        _v2.copy(p.b).sub(p.a).normalize();
        _q.setFromUnitVectors(AXIS_X, _v2);
        const th = (1 - k) * (p.style === "beam" ? 1.6 : 1.2);
        _m.compose(_v, _q, _s.set(len, th, th));
      } else {
        const x = p.a.x + (p.b.x - p.a.x) * k;
        const y = p.a.y + (p.b.y - p.a.y) * k + Math.sin(k * Math.PI) * p.arc;
        const z = p.a.z + (p.b.z - p.a.z) * k;
        // heading along the arc
        const dy = (p.b.y - p.a.y) + Math.cos(k * Math.PI) * Math.PI * p.arc;
        _v2.set(p.b.x - p.a.x, dy, p.b.z - p.a.z).normalize();
        _q.setFromUnitVectors(AXIS_X, _v2);
        _m.compose(_v.set(x, y, z), _q, _s.setScalar(1));
        if (p.style === "bomb" && Math.random() < 0.4) this.burst(this.sparks, x, y + 0.2, z, 1, 0.3, 0, 0.08, 0.2, "#fbbf24", 0.3);
        if (p.style === "orb" && Math.random() < 0.6) this.burst(this.sparks, x, y, z, 1, 0.3, 0, 0.12, 0.25, "#67e8f9", 0.2);
      }
      pool.setMatrixAt(pool.count++, _m);
      return true;
    });
    for (const pool of this.projPools.values()) pool.instanceMatrix.needsUpdate = true;
  }

  /* ── overlay ───────────────────────────────────────────────────────── */

  private project(x: number, y: number, z: number): { x: number; y: number; ok: boolean } {
    _v.set(x * this.M, y, z).project(this.camera);
    return { x: (_v.x * 0.5 + 0.5) * this.w, y: (-_v.y * 0.5 + 0.5) * this.h, ok: _v.z < 1 && _v.x > -1.2 && _v.x < 1.2 };
  }

  private drawOverlay(f: Frame) {
    const ctx = this.overlay;
    const { s, prevX, alpha } = f;
    ctx.clearRect(0, 0, this.w, this.h);
    const small = this.w < 520;
    const barW = small ? 22 : 30;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const u of s.units) {
      const px = prevX.get(u.id) ?? u.x;
      const lx = px + (u.x - px) * alpha;
      const p = this.project(W(lx), unitHeight(u.kind) + 0.45 + (HOVER.has(u.kind) ? 0.4 : 0), laneZ(u.id));
      if (!p.ok) continue;
      const def = UNITS[u.kind];
      const w = barW * (def.size > 1.3 ? 1.35 : 1);
      const k = Math.max(0, u.hp / u.maxHp);
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(p.x - w / 2 - 1, p.y - 3, w + 2, 6);
      ctx.fillStyle = k > 0.5 ? TEAM_HEX[u.side] : k > 0.25 ? "#f59e0b" : "#dc2626";
      ctx.fillRect(p.x - w / 2, p.y - 2, w * k, 4);
      // role glyph chip (shape + colour both carry the side: ▲ blue, ■ red)
      const gx = p.x - w / 2 - 8;
      ctx.fillStyle = TEAM_HEX[u.side];
      ctx.beginPath();
      if (u.side === 0) {
        ctx.moveTo(gx, p.y - 7);
        ctx.lineTo(gx + 7, p.y + 5);
        ctx.lineTo(gx - 7, p.y + 5);
      } else ctx.rect(gx - 6, p.y - 6, 12, 12);
      ctx.fill();
      ctx.font = `${small ? 8 : 9}px system-ui, sans-serif`;
      ctx.fillStyle = "#fff";
      ctx.fillText(ROLE_ICON[def.role], gx, p.y + (u.side === 0 ? 1 : 0));
      if (u.stun > 0) {
        ctx.font = "12px system-ui";
        ctx.fillText("💫", p.x, p.y - 10);
      }
    }
    // base plates
    for (const side of [0, 1] as const) {
      const pl = s.players[side];
      const top = baseTemplate(pl.era).height + 2;
      const p = this.project(this.bases[side].group.position.x, top, 0);
      if (!p.ok) continue;
      const w = small ? 70 : 100;
      const k = pl.baseHp / pl.baseMax;
      ctx.fillStyle = "rgba(0,0,0,0.65)";
      roundRect(ctx, p.x - w / 2 - 3, p.y - 9, w + 6, 18, 5);
      ctx.fill();
      ctx.fillStyle = k > 0.5 ? TEAM_HEX[side] : k > 0.25 ? "#f59e0b" : "#dc2626";
      roundRect(ctx, p.x - w / 2, p.y - 6, w * k, 12, 3);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = `bold ${small ? 9 : 11}px system-ui, sans-serif`;
      ctx.fillText(`${ERAS[pl.era].emoji} ${Math.ceil(pl.baseHp)}`, p.x, p.y);
      // last-stand tag
      const near = s.units.some((u) => u.side !== side && Math.abs(u.x - wallX(side)) <= 150);
      if (near && pl.turrets.some((t) => t)) {
        ctx.font = `bold ${small ? 9 : 10}px system-ui`;
        ctx.fillStyle = "#fde68a";
        ctx.fillText("🔥 결사항전 +30%", p.x, p.y - 18);
      }
    }
    // floating numbers
    const now = this.now;
    this.texts = this.texts.filter((t) => now - t.t0 < t.dur);
    for (const t of this.texts) {
      const k = (now - t.t0) / t.dur;
      const p = this.project(t.x, t.y + k * 1.6, t.z);
      if (!p.ok) continue;
      const pop = k < 0.15 ? 1 + (0.15 - k) * 3 : 1;
      ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
      ctx.font = `900 ${Math.round(t.size * pop * (small ? 0.9 : 1))}px system-ui, sans-serif`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(0,0,0,0.75)";
      ctx.strokeText(t.text, p.x, p.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, p.x, p.y);
      ctx.globalAlpha = 1;
    }
    if (this.texts.length > 90) this.texts.splice(0, this.texts.length - 90);
    // off-screen alert: enemies at my wall while the camera is elsewhere
    const v = this.view();
    const me = f.viewer;
    const threat = s.units.some((u) => u.side !== me && progress(me === 0 ? 1 : 0, u.x) > LANE - 220);
    if (threat && Math.abs(v.center - wallX(me)) > v.half * 0.9) {
      // your base is on the left in both the normal and the mirrored view
      const left = me === 0 !== this.mirror;
      const pulse = 0.6 + Math.sin(now * 8) * 0.4;
      ctx.globalAlpha = pulse;
      ctx.fillStyle = "#dc2626";
      const x = left ? 18 : this.w - 18;
      ctx.beginPath();
      ctx.moveTo(x + (left ? -8 : 8), this.h / 2);
      ctx.lineTo(x + (left ? 10 : -10), this.h / 2 - 14);
      ctx.lineTo(x + (left ? 10 : -10), this.h / 2 + 14);
      ctx.fill();
      ctx.font = "bold 11px system-ui";
      ctx.fillText("기지 공격!", x + (left ? 34 : -34), this.h / 2 + 26);
      ctx.globalAlpha = 1;
    }
  }

  private adapt(dt: number) {
    if (dt > 0.034) this.slowFrames++;
    else this.slowFrames = Math.max(0, this.slowFrames - 0.5);
    if (this.slowFrames > 90 && this.quality > 0) {
      this.quality--;
      this.slowFrames = 0;
      if (this.quality === 0) this.renderer.shadowMap.enabled = false;
      this.resize();
    }
  }

  /** Clears transient effects (new match). */
  reset() {
    this.projs = [];
    this.corpses = [];
    this.texts = [];
    this.sparks.list = [];
    this.debris.list = [];
    this.smoke.list = [];
  }

  dispose() {
    for (const p of this.rigs.values()) p.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

function mulberry(seed: number) {
  let a = seed;
  return () => {
    let t = (a = (a + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, Math.max(0, w), h, Math.min(r, Math.max(0, w) / 2));
}
