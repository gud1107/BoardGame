import type * as CANNON_NS from "cannon-es";

/**
 * Cosmetic collapse (§13) — a cannon-es rigid-body world seeded from the
 * tower's current pose. The upper part starts tipping toward the engine's
 * collapse direction around the failing interface; physics does the rest.
 * Never feeds back into the game: the engine has already decided the result.
 */

type Cannon = typeof CANNON_NS;

export interface CollapseBody {
  id: number;
  pos: [number, number, number];
  quat: [number, number, number, number];
}

export interface CollapseSpec {
  bodies: CollapseBody[];
  half: [number, number, number];
  /** World height of the failing interface; bodies above it tip. */
  pivotY: number;
  dir: { x: number; z: number };
  /** Extra shove (jerked pull / structural failure feel stronger). */
  force: number;
  seed: number;
}

export interface CollapseSim {
  step(dt: number): void;
  /** Writes each body's pose; returns the summed speed of the fastest few impacts this step (for sound/shake). */
  read(out: Map<number, { p: [number, number, number]; q: [number, number, number, number] }>): number;
}

export function createCollapse(C: Cannon, spec: CollapseSpec): CollapseSim {
  let s = spec.seed | 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const world = new C.World({ gravity: new C.Vec3(0, -9.82 * 1.6, 0) });
  world.broadphase = new C.SAPBroadphase(world);
  world.allowSleep = true;
  const wood = new C.Material("wood");
  world.defaultContactMaterial = new C.ContactMaterial(wood, wood, { friction: 0.42, restitution: 0.12 });
  (world.solver as CANNON_NS.GSSolver).iterations = 12;

  const ground = new C.Body({ mass: 0, material: wood, shape: new C.Plane() });
  ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(ground);

  const shape = new C.Box(new C.Vec3(spec.half[0], spec.half[1], spec.half[2]));
  const len = Math.hypot(spec.dir.x, spec.dir.z) || 1;
  const dir = { x: spec.dir.x / len, z: spec.dir.z / len };
  // tip axis = up × dir
  const axis = new C.Vec3(dir.z, 0, -dir.x);
  const omega = 1.1 + spec.force * 1.4;
  const pivot = new C.Vec3(dir.x * 0.75, spec.pivotY, dir.z * 0.75);
  const bodies: { id: number; body: CANNON_NS.Body }[] = [];
  for (const b of spec.bodies) {
    const body = new C.Body({ mass: 1, material: wood, shape, linearDamping: 0.04, angularDamping: 0.06, sleepSpeedLimit: 0.08, sleepTimeLimit: 0.6 });
    body.position.set(b.pos[0], b.pos[1], b.pos[2]);
    body.quaternion.set(b.quat[0], b.quat[1], b.quat[2], b.quat[3]);
    if (b.pos[1] > spec.pivotY) {
      const r = body.position.vsub(pivot);
      const w = axis.scale(omega);
      const v = w.cross(r);
      const above = Math.min(1, (b.pos[1] - spec.pivotY) / 3);
      body.velocity.set(v.x + dir.x * spec.force * 0.8 * above + (rnd() - 0.5) * 0.25, v.y, v.z + dir.z * spec.force * 0.8 * above + (rnd() - 0.5) * 0.25);
      body.angularVelocity.set(w.x + (rnd() - 0.5) * 0.8, (rnd() - 0.5) * 0.8, w.z + (rnd() - 0.5) * 0.8);
    } else {
      // lower blocks get jostled a touch so the base settles naturally instead of standing frozen
      body.velocity.set((rnd() - 0.5) * 0.04, 0, (rnd() - 0.5) * 0.04);
    }
    world.addBody(body);
    bodies.push({ id: b.id, body });
  }
  let impact = 0;
  return {
    step(dt: number) {
      const h = Math.min(dt, 1 / 20);
      world.step(1 / 120, h, 6);
      impact = 0;
      for (const c of world.contacts) {
        const v = Math.abs(c.getImpactVelocityAlongNormal());
        if (v > 1.2) impact += v;
      }
    },
    read(out) {
      for (const { id, body } of bodies) {
        out.set(id, {
          p: [body.position.x, body.position.y, body.position.z],
          q: [body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w],
        });
      }
      return impact;
    },
  };
}
