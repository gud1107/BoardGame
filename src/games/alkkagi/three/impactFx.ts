import * as THREE from "three";
import { WORDS, wordTier, type WordTier } from "./fxWords";

/**
 * 알까기 대전 collision effects (rulebook §13). Purely cosmetic, owned by
 * the 3D scene: every stone-on-stone hit gets a flash, a shockwave ring on
 * the board, a spray of sparks and a comic word that pops up and floats
 * away. Stones hitting the floor kick up dust.
 *
 * Word tiers (must read without sound or colour, at 360 px too):
 *   탁!  light hit — plain, smallest
 *   딱!  solid hit that knocks nothing off — bigger, speed ticks around it
 *   쾅!  ONLY the hit that sends a stone off the board — biggest, jagged
 *        burst behind it, double shockwave, flash, hit-stop
 * Each tier has a minimum on-screen height so phones still read it.
 *
 * Board coords (x, y) → three.js (x, −y), board top at y = 0.
 * `k` is the hit strength 0..1 (impulse / 9, clamped).
 */

interface Fx {
  obj: THREE.Object3D;
  born: number;
  dur: number;
  step: (age: number, dt: number) => void;
  dispose?: () => void;
}

let glowTex: THREE.Texture | null = null;
function glowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.25, "rgba(255,240,200,0.85)");
  grad.addColorStop(0.6, "rgba(255,190,90,0.25)");
  grad.addColorStop(1, "rgba(255,160,60,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

let puffTex: THREE.Texture | null = null;
function puffTexture(): THREE.Texture {
  if (puffTex) return puffTex;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(235,215,180,0.75)");
  grad.addColorStop(1, "rgba(235,215,180,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  puffTex = new THREE.CanvasTexture(c);
  puffTex.colorSpace = THREE.SRGBColorSpace;
  return puffTex;
}

const wordTex = new Map<WordTier, THREE.Texture>();
/** Comic onomatopoeia with a thick outline; 딱 gets speed ticks, 쾅 a jagged burst (shape cues, not just colour). */
function wordTexture(tier: WordTier): THREE.Texture {
  const hit = wordTex.get(tier);
  if (hit) return hit;
  const { word, fill } = WORDS[tier];
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const g = c.getContext("2d")!;
  const cx = 128;
  const cy = 64;
  if (tier === 2) {
    // explosion burst
    g.beginPath();
    const spikes = 14;
    for (let i = 0; i <= spikes * 2; i++) {
      const ang = (i / (spikes * 2)) * Math.PI * 2;
      const r = i % 2 === 0 ? 1 : 0.62 + ((i * 37) % 7) * 0.025;
      const x = cx + Math.cos(ang) * 124 * r;
      const y = cy + Math.sin(ang) * 62 * r;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
    g.fillStyle = "#fff1a8";
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = "#1a0d05";
    g.stroke();
  } else if (tier === 1) {
    // speed ticks on both sides
    g.strokeStyle = "#1a0d05";
    g.lineCap = "round";
    for (const [x1, y1, x2, y2] of [
      [14, 30, 40, 44],
      [8, 64, 38, 64],
      [14, 98, 40, 84],
      [242, 30, 216, 44],
      [248, 64, 218, 64],
      [242, 98, 216, 84],
    ]) {
      g.lineWidth = 12;
      g.strokeStyle = "#1a0d05";
      g.beginPath();
      g.moveTo(x1, y1);
      g.lineTo(x2, y2);
      g.stroke();
      g.lineWidth = 5;
      g.strokeStyle = fill;
      g.beginPath();
      g.moveTo(x1, y1);
      g.lineTo(x2, y2);
      g.stroke();
    }
  }
  const size = tier === 2 ? 92 : tier === 1 ? 92 : 84;
  g.font = `900 ${size}px 'Pretendard', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineJoin = "round";
  g.lineWidth = 18;
  g.strokeStyle = "#1a0d05";
  g.strokeText(word, cx, cy + 4);
  g.fillStyle = fill;
  g.fillText(word, cx, cy + 4);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  wordTex.set(tier, tex);
  return tex;
}

const ringGeo = new THREE.RingGeometry(0.82, 1, 48);
const sparkGeo = new THREE.SphereGeometry(1, 6, 4);
const sparkMat = new THREE.MeshBasicMaterial({ color: "#fff2c4", blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

export class ImpactFx {
  readonly root = new THREE.Group();
  private list: Fx[] = [];
  private lastWordAt = -1e9;

  /**
   * A stone-on-stone hit at board point (x, y). `fatal` = this hit sends a
   * stone off the board; `unitsPerPx` = world units per screen pixel at the
   * hit (keeps the word readable on small screens).
   */
  hit(x: number, y: number, kIn: number, now: number, low: boolean, fatal = false, unitsPerPx = 0) {
    const px = x;
    const pz = -y;
    // a knock-off always reads as a big hit; a hit that knocks nothing off stays modest
    const k = fatal ? Math.max(0.85, kIn) : Math.min(kIn, 0.7);

    // shockwave ring flat on the board
    const ringMat = new THREE.MeshBasicMaterial({ color: k > 0.7 ? "#ffd27a" : "#fff3d6", transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(px, 0.03, pz);
    const ringMax = 0.7 + k * 2.1;
    this.add(ring, now, 0.34 + k * 0.16, (a) => {
      const e = easeOut(a);
      ring.scale.setScalar(0.25 + e * ringMax);
      ringMat.opacity = 0.9 * (1 - a);
    }, () => ringMat.dispose());

    if (fatal) {
      // a second, slower ring for the knock-off
      const ring2Mat = ringMat.clone();
      const ring2 = new THREE.Mesh(ringGeo, ring2Mat);
      ring2.rotation.x = -Math.PI / 2;
      ring2.position.set(px, 0.025, pz);
      this.add(ring2, now, 0.6, (a) => {
        ring2.scale.setScalar(0.3 + easeOut(a) * ringMax * 1.6);
        ring2Mat.opacity = 0.45 * (1 - a);
      }, () => ring2Mat.dispose());
    }

    // white-hot flash
    const flashMat = new THREE.SpriteMaterial({ map: glowTexture(), color: "#ffffff", transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const flash = new THREE.Sprite(flashMat);
    flash.position.set(px, 0.35, pz);
    const fs = 0.9 + k * 2.4;
    this.add(flash, now, 0.16 + k * 0.08, (a) => {
      flash.scale.setScalar(fs * (0.6 + a * 0.6));
      flashMat.opacity = 1 - a;
    }, () => flashMat.dispose());

    // sparks: hot specks that arc out and fall (skipped on ⚡ 가볍게)
    const n = low ? 0 : 4 + Math.round(k * 10);
    for (let i = 0; i < n; i++) {
      const mesh = new THREE.Mesh(sparkGeo, sparkMat);
      const ang = Math.random() * Math.PI * 2;
      const sp = 1.8 + Math.random() * 4 * (0.4 + k);
      let sx = px;
      let sz = pz;
      let sy = 0.25;
      let vx = Math.cos(ang) * sp;
      let vz = Math.sin(ang) * sp;
      let vy = 1.5 + Math.random() * 3.5 * (0.5 + k);
      const size = 0.035 + Math.random() * 0.04 + k * 0.03;
      this.add(mesh, now, 0.3 + Math.random() * 0.25, (a, dt) => {
        vy -= 14 * dt;
        sx += vx * dt;
        sz += vz * dt;
        sy = Math.max(0.02, sy + vy * dt);
        vx *= 0.97;
        vz *= 0.97;
        mesh.position.set(sx, sy, sz);
        mesh.scale.setScalar(size * (1 - a));
      });
    }

    // "탁!" for a tap, "딱!" for a solid hit, "쾅!" for a smash
    const tier = wordTier(kIn, fatal);
    // a knock-off always gets its word; small taps are rate-limited so chains don't pile up
    if (tier !== null && (tier === 2 || now - this.lastWordAt > 140)) {
      this.lastWordAt = now;
      const spec = WORDS[tier];
      const mat = new THREE.SpriteMaterial({ map: wordTexture(tier), transparent: true, depthWrite: false, depthTest: false });
      const sprite = new THREE.Sprite(mat);
      sprite.renderOrder = 10 + tier;
      const base = Math.max(spec.world, spec.minPx * unitsPerPx);
      const tilt = (Math.random() - 0.5) * 0.5;
      mat.rotation = tilt;
      this.add(sprite, now, tier === 2 ? 1 : 0.75, (a) => {
        // pop in with overshoot, then drift up and fade
        const pop = a < 0.18 ? easeOut(a / 0.18) * 1.25 : 1.25 - Math.min(1, (a - 0.18) / 0.15) * 0.25;
        sprite.scale.set(base * 2 * pop, base * pop, 1);
        sprite.position.set(px, 1.1 + a * 1.4, pz);
        mat.opacity = a < 0.6 ? 1 : 1 - (a - 0.6) / 0.4;
      }, () => mat.dispose());
    }
  }

  /** A fallen stone smacks the floor: a ring of dust. */
  dust(x: number, y: number, floorY: number, k: number, now: number, low: boolean) {
    const px = x;
    const pz = -y;
    const ringMat = new THREE.MeshBasicMaterial({ color: "#f3dfb8", transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(px, floorY + 0.03, pz);
    this.add(ring, now, 0.45, (a) => {
      ring.scale.setScalar(0.3 + easeOut(a) * (0.9 + k * 0.9));
      ringMat.opacity = 0.55 * (1 - a);
    }, () => ringMat.dispose());
    if (low) return;
    for (let i = 0; i < 5; i++) {
      const mat = new THREE.SpriteMaterial({ map: puffTexture(), transparent: true, depthWrite: false });
      const s = new THREE.Sprite(mat);
      const ang = (i / 5) * Math.PI * 2 + Math.random();
      const r0 = 0.2;
      this.add(s, now, 0.7 + Math.random() * 0.3, (a) => {
        const e = easeOut(a);
        const r = r0 + e * (0.8 + k);
        s.position.set(px + Math.cos(ang) * r, floorY + 0.15 + e * 0.5, pz + Math.sin(ang) * r);
        s.scale.setScalar(0.4 + e * 0.9);
        mat.opacity = 0.7 * (1 - a);
      }, () => mat.dispose());
    }
  }

  update(now: number, dt: number) {
    this.list = this.list.filter((f) => {
      const a = (now - f.born) / 1000 / f.dur;
      if (a >= 1) {
        this.root.remove(f.obj);
        f.dispose?.();
        return false;
      }
      f.step(Math.max(0, a), dt);
      return true;
    });
  }

  dispose() {
    for (const f of this.list) {
      this.root.remove(f.obj);
      f.dispose?.();
    }
    this.list = [];
  }

  private add(obj: THREE.Object3D, now: number, dur: number, step: Fx["step"], dispose?: () => void) {
    const fx: Fx = { obj, born: now, dur, step, dispose };
    step(0, 0);
    this.root.add(obj);
    this.list.push(fx);
  }
}
