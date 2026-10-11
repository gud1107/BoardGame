"use client";

/**
 * Six-shot revolver model with separately animatable parts, found by name
 * from the owner's `useFrame` (`group.getObjectByName(...)`):
 *  - "crane"  swings the cylinder out to the side (rotate around x),
 *  - "cyl"    the cylinder itself (rotate around x — one notch = π/3),
 *  - "hammer" cocks back (rotate around z, negative = cocked),
 *  - "muzzle" an empty marker at the barrel tip (flash / smoke anchor).
 * Barrel points along +x, the grip hangs down toward −x/−y. `spent` marks
 * how many chambers are already proven empty (painted black); the rest stay
 * plain steel — the live round is never shown, nobody knows where it is.
 */
export default function Revolver({ spent = 0, lowDetail = false }: { spent?: number; lowDetail?: boolean }) {
  const seg = lowDetail ? 8 : 14;
  const steel = <meshStandardMaterial color="#2f3036" metalness={0.85} roughness={0.32} />;
  return (
    <group>
      {/* barrel + top rib + front sight */}
      <mesh position={[0.2, 0.012, 0]} rotation-z={Math.PI / 2} castShadow>
        <cylinderGeometry args={[0.026, 0.028, 0.3, seg]} />
        {steel}
      </mesh>
      <mesh position={[0.2, 0.045, 0]}>
        <boxGeometry args={[0.3, 0.018, 0.026]} />
        {steel}
      </mesh>
      <mesh position={[0.34, 0.06, 0]}>
        <boxGeometry args={[0.012, 0.022, 0.008]} />
        {steel}
      </mesh>
      <group name="muzzle" position={[0.36, 0.012, 0]} />
      {/* frame */}
      <mesh position={[-0.03, 0.0, 0]} castShadow>
        <boxGeometry args={[0.16, 0.11, 0.066]} />
        <meshStandardMaterial color="#3a3b42" metalness={0.8} roughness={0.35} />
      </mesh>
      {/* trigger guard + trigger */}
      <mesh position={[-0.04, -0.07, 0]} rotation-x={Math.PI / 2}>
        <torusGeometry args={[0.035, 0.007, 6, 14, Math.PI]} />
        {steel}
      </mesh>
      <mesh position={[-0.045, -0.065, 0]} rotation-z={0.3}>
        <boxGeometry args={[0.01, 0.04, 0.01]} />
        {steel}
      </mesh>
      {/* hammer */}
      <group name="hammer" position={[-0.1, 0.05, 0]}>
        <mesh position={[-0.01, 0.03, 0]}>
          <boxGeometry args={[0.022, 0.06, 0.02]} />
          {steel}
        </mesh>
      </group>
      {/* grip with wood panels */}
      <mesh position={[-0.14, -0.1, 0]} rotation-z={-0.42} castShadow>
        <boxGeometry args={[0.075, 0.19, 0.06]} />
        <meshStandardMaterial color="#6b3a1f" roughness={0.55} />
      </mesh>
      <mesh position={[-0.17, -0.18, 0]} rotation-z={-0.42}>
        <boxGeometry args={[0.08, 0.025, 0.064]} />
        {steel}
      </mesh>
      {/* crane → cylinder (swing-out) */}
      <group name="crane" position={[0.02, -0.008, 0]}>
        <group name="cyl">
          <mesh rotation-z={Math.PI / 2} castShadow>
            <cylinderGeometry args={[0.058, 0.058, 0.1, lowDetail ? 6 : 18]} />
            <meshStandardMaterial color="#55565e" metalness={0.92} roughness={0.22} />
          </mesh>
          {Array.from({ length: 6 }, (_, i) => {
            const a = (i / 6) * Math.PI * 2;
            return (
              <mesh key={i} position={[0.051, Math.cos(a) * 0.034, Math.sin(a) * 0.034]} rotation-z={Math.PI / 2}>
                <cylinderGeometry args={[0.012, 0.012, 0.004, 8]} />
                <meshStandardMaterial color={i < spent ? "#050506" : "#7d7f87"} metalness={i < spent ? 0.1 : 0.7} roughness={0.45} />
              </mesh>
            );
          })}
        </group>
      </group>
    </group>
  );
}

const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Timing of one pull, as built by timeline.ts (only the fields this needs). */
export interface PullBeats {
  openAt: number;
  spinAt: number;
  closeAt: number;
  cockAt: number;
  fireAt: number;
  k: number;
}

/**
 * Poses the named parts of a `<Revolver>` group for time `t` of a pull:
 * cylinder swings out → advances exactly one notch (from `spent` chambers)
 * → swings back → hammer cocks → snaps forward at the shot. Returns the
 * muzzle-flash strength (0..1) for a live round.
 */
export function animateRevolver(g: { getObjectByName: (n: string) => { rotation: { x: number; z: number }; position: { set: (x: number, y: number, z: number) => void } } | undefined }, p: PullBeats, t: number, spent: number, hit: boolean): number {
  const span = (a: number, b: number) => clamp01((t - a) / Math.max(1e-6, b - a));
  const open = ease(span(p.openAt, p.openAt + 0.25 * p.k)) * (1 - ease(span(p.closeAt, p.closeAt + 0.12 * p.k)));
  const crane = g.getObjectByName("crane");
  if (crane) {
    crane.rotation.x = -1.25 * open;
    crane.position.set(0.02, -0.008 - 0.045 * open, 0.06 * open);
  }
  const cyl = g.getObjectByName("cyl");
  if (cyl) cyl.rotation.x = (spent + ease(span(p.spinAt, p.spinAt + 0.16 * p.k))) * (Math.PI / 3);
  const hammer = g.getObjectByName("hammer");
  if (hammer) hammer.rotation.z = t >= p.fireAt ? 0 : -0.6 * ease(span(p.cockAt, p.cockAt + 0.14 * p.k));
  return hit && t >= p.fireAt && t < p.fireAt + 0.2 ? 1 - (t - p.fireAt) / 0.2 : 0;
}
