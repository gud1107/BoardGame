"use client";

/**
 * City Chase 3D: each of the 25 building types told apart by its shape, not by a sign
 * (2026-10-27, user: "간판에 이름을 적기보다는 건물의 외형을 바꾸는 쪽으로").
 *
 * Local coords of one shop: origin = footprint centre on the ground, south (camera) wall at
 * z = F, roof top at y = h + 0.08. Tall props sit on the back half of the roof (z < 0) so the
 * floating "🏦C4" roof tag in front of them stays readable. Everything is plain boxes /
 * cylinders / cones — no lights, no textures — and lives only while the shop isn't see-through.
 */
import * as THREE from "three";
import type { BuildingShape, BuildingType } from "../CityMap";

type V3 = [number, number, number];
/** Half the shop footprint (`FOOT / 2` in CityMap3D). */
const F = 0.65;

function Bx({ p, s, c, glow = false, rot }: { p: V3; s: V3; c: string; glow?: boolean; rot?: V3 }) {
  return (
    <mesh position={p} rotation={rot}>
      <boxGeometry args={s} />
      {glow ? <meshBasicMaterial color={c} /> : <meshStandardMaterial color={c} roughness={0.7} />}
    </mesh>
  );
}

function Cy({ p, r, len, c, r2, seg = 12, rot, glow = false }: { p: V3; r: number; len: number; c: string; r2?: number; seg?: number; rot?: V3; glow?: boolean }) {
  return (
    <mesh position={p} rotation={rot}>
      <cylinderGeometry args={[r, r2 ?? r, len, seg]} />
      {glow ? <meshBasicMaterial color={c} /> : <meshStandardMaterial color={c} roughness={0.6} />}
    </mesh>
  );
}

/** Triangular prism, apex up: `w` long along x, base `d` deep along z, `hgt` tall, base at p.y. */
function Gable({ p, w, d, hgt, c, rotY = 0 }: { p: V3; w: number; d: number; hgt: number; c: string; rotY?: number }) {
  return (
    <group position={p} rotation-y={rotY}>
      {/* unit 3-sided cylinder with a vertex on +x, laid on its side so that vertex points up */}
      <mesh position={[0, hgt / 3, 0]} rotation-z={Math.PI / 2} scale={[hgt / 1.5, w, d / 1.732]}>
        <cylinderGeometry args={[1, 1, 1, 3, 1, false, Math.PI / 2]} />
        <meshStandardMaterial color={c} roughness={0.7} flatShading />
      </mesh>
    </group>
  );
}

function Door({ w = 0.3, c = "#0f172a", open }: { w?: number; c?: string; open: boolean }) {
  return (
    <mesh position={[0, 0.17, F + 0.005]}>
      <planeGeometry args={[w, 0.34]} />
      <meshBasicMaterial color={open ? "#fef9c3" : c} />
    </mesh>
  );
}

/** Lit shop windows either side of the door. */
function Display({ c = "#fde68a", wide = false }: { c?: string; wide?: boolean }) {
  return (
    <>
      {[-1, 1].map((sgn) => (
        <mesh key={sgn} position={[sgn * (wide ? 0.38 : 0.4), 0.17, F + 0.006]}>
          <planeGeometry args={[wide ? 0.42 : 0.3, wide ? 0.3 : 0.24]} />
          <meshBasicMaterial color={c} transparent opacity={0.85} />
        </mesh>
      ))}
    </>
  );
}

function Awning({ c, w = 1.0 }: { c: string; w?: number }) {
  return <Bx p={[0, 0.38, F + 0.1]} s={[w, 0.02, 0.22]} c={c} rot={[0.5, 0, 0]} />;
}

/** Steps + four columns + entablature: the civic look (bank / museum / library / city hall). */
function Portico({ stone = "#e7e5e4" }: { stone?: string }) {
  return (
    <>
      <Bx p={[0, 0.02, F + 0.1]} s={[1.22, 0.04, 0.2]} c="#d6d3d1" />
      {[-0.44, -0.2, 0.2, 0.44].map((x) => (
        <Cy key={x} p={[x, 0.21, F + 0.12]} r={0.04} r2={0.045} len={0.34} c={stone} seg={8} />
      ))}
      <Bx p={[0, 0.41, F + 0.11]} s={[1.22, 0.06, 0.22]} c={stone} />
    </>
  );
}

function Flag({ p, c }: { p: V3; c: string }) {
  return (
    <>
      <Cy p={[p[0], p[1] + 0.25, p[2]]} r={0.012} len={0.5} c="#cbd5e1" seg={6} />
      <mesh position={[p[0] + 0.09, p[1] + 0.42, p[2]]}>
        <planeGeometry args={[0.18, 0.11]} />
        <meshBasicMaterial color={c} side={THREE.DoubleSide} />
      </mesh>
    </>
  );
}

function Umbrella({ p, c }: { p: V3; c: string }) {
  return (
    <>
      <Cy p={[p[0], 0.13, p[2]]} r={0.01} len={0.26} c="#e5e7eb" seg={5} />
      <Cy p={[p[0], 0.27, p[2]]} r={0} r2={0.15} len={0.08} c={c} seg={8} />
    </>
  );
}

type Build = (b: BuildingType, R: number, open: boolean) => React.ReactNode;

const SHAPES: Record<BuildingShape, Build> = {
  // 🏦 triangular pediment over the columns + gold roof trim
  bank: (b, R, open) => (
    <>
      <Door open={open} />
      <Portico />
      <Gable p={[0, 0.44, F + 0.11]} w={0.2} d={1.22} hgt={0.2} c="#e7e5e4" rotY={Math.PI / 2} />
      <Bx p={[0, R + 0.02, 0]} s={[1.36, 0.04, 1.36]} c="#d4a017" />
    </>
  ),
  // 🏛️ columns + a big dome
  museum: (b, R, open) => (
    <>
      <Door open={open} />
      <Portico />
      <Cy p={[0, R + 0.05, -0.15]} r={0.4} len={0.1} c="#d6d3d1" seg={20} />
      <mesh position={[0, R + 0.1, -0.15]}>
        <sphereGeometry args={[0.36, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#5eead4" roughness={0.4} metalness={0.3} />
      </mesh>
    </>
  ),
  // 📚 columns + stepped two-tier roof
  library: (b, R, open) => (
    <>
      <Door open={open} />
      <Portico stone="#d6d3d1" />
      <Bx p={[0, R + 0.06, -0.08]} s={[1.05, 0.12, 1.0]} c="#78716c" />
      <Bx p={[0, R + 0.18, -0.15]} s={[0.7, 0.12, 0.65]} c="#a8a29e" />
    </>
  ),
  // 🏢 columns + a spire clock tower with a flag
  cityHall: (b, R, open) => (
    <>
      <Door open={open} />
      <Portico />
      <Bx p={[0, R + 0.27, -0.3]} s={[0.34, 0.54, 0.34]} c="#e7e5e4" />
      <mesh position={[0, R + 0.27 + 0.1, -0.3 + 0.171]}>
        <circleGeometry args={[0.1, 20]} />
        <meshBasicMaterial color="#fef3c7" />
      </mesh>
      <Cy p={[0, R + 0.68, -0.3]} r={0} r2={0.26} len={0.28} c="#1e40af" seg={4} rot={[0, Math.PI / 4, 0]} />
      <Flag p={[0, R + 0.8, -0.3]} c="#ef4444" />
    </>
  ),
  // 📮 a giant red post box out front + a radio mast
  postOffice: (b, R, open) => (
    <>
      <Door w={0.4} c="#1e3a5f" open={open} />
      <Bx p={[0, 0.4, F + 0.01]} s={[1.3, 0.05, 0.02]} c="#fef2f2" glow />
      <Bx p={[-0.42, 0.16, F + 0.17]} s={[0.2, 0.32, 0.18]} c="#dc2626" />
      <Cy p={[-0.42, 0.32, F + 0.17]} r={0.1} len={0.18} c="#dc2626" rot={[Math.PI / 2, 0, 0]} />
      <Cy p={[0.35, R + 0.35, -0.35]} r={0.015} r2={0.03} len={0.7} c="#cbd5e1" seg={6} />
      <Cy p={[0.35, R + 0.25, -0.35]} r={0.12} len={0.03} c="#e5e7eb" rot={[0.9, 0, 0]} />
    </>
  ),
  // 🏥 white canopy, rooftop helipad with a red cross
  hospital: (b, R, open) => (
    <>
      <Door w={0.44} c="#bae6fd" open={open} />
      <Bx p={[0, 0.37, F + 0.12]} s={[0.8, 0.03, 0.24]} c="#f8fafc" />
      <Cy p={[0, R + 0.01, -0.1]} r={0.5} len={0.02} c="#f8fafc" seg={24} />
      <Bx p={[0, R + 0.03, -0.1]} s={[0.42, 0.02, 0.13]} c="#ef4444" glow />
      <Bx p={[0, R + 0.03, -0.1]} s={[0.13, 0.02, 0.42]} c="#ef4444" glow />
    </>
  ),
  // 🏫 pitched roof over the entrance, clock tower + flag
  school: (b, R, open) => (
    <>
      <Door w={0.36} open={open} />
      <Display c="#fef9c3" />
      <Gable p={[0, R, 0.2]} w={1.36} d={0.7} hgt={0.26} c="#9a3412" />
      <Bx p={[-0.35, R + 0.25, -0.35]} s={[0.28, 0.5, 0.26]} c={b.wall} />
      <mesh position={[-0.35, R + 0.36, -0.35 + 0.131]}>
        <circleGeometry args={[0.1, 20]} />
        <meshBasicMaterial color="#f8fafc" />
      </mesh>
      <Gable p={[-0.35, R + 0.5, -0.35]} w={0.32} d={0.3} hgt={0.16} c="#9a3412" />
      <Flag p={[0.45, R, -0.4]} c={b.sign} />
    </>
  ),
  // 🚒 striped red bay door + a tall hose-drying tower
  fireStation: (b, R, open) => (
    <>
      <mesh position={[0, 0.17, F + 0.005]}>
        <planeGeometry args={[0.72, 0.34]} />
        <meshBasicMaterial color={open ? "#fef9c3" : "#991b1b"} />
      </mesh>
      {[0.08, 0.17, 0.26].map((y) => (
        <Bx key={y} p={[0, y, F + 0.008]} s={[0.72, 0.015, 0.002]} c="#fecaca" glow />
      ))}
      <Bx p={[0.4, R + 0.38, -0.38]} s={[0.3, 0.76, 0.3]} c="#b91c1c" />
      <Bx p={[0.4, R + 0.8, -0.38]} s={[0.38, 0.08, 0.38]} c="#7f1d1d" />
      <Cy p={[0.4, R + 0.9, -0.38]} r={0.05} len={0.1} c="#fbbf24" glow />
    </>
  ),
  // 🏨 a narrower upper tower, rooftop pool at the front
  hotel: (b, R, open) => (
    <>
      <Door w={0.44} c="#1e3a5f" open={open} />
      <Bx p={[0, 0.37, F + 0.1]} s={[0.6, 0.03, 0.2]} c="#d4a017" />
      <Bx p={[0, R + 0.24, -0.25]} s={[1.0, 0.48, 0.6]} c="#52526e" />
      {[0.12, 0.26, 0.4].map((y) => (
        <Bx key={y} p={[0, R + y, 0.051]} s={[0.86, 0.05, 0.002]} c="#fde68a" glow />
      ))}
      <Bx p={[0, R + 0.005, 0.35]} s={[0.8, 0.01, 0.4]} c="#22d3ee" glow />
    </>
  ),
  // 🎬 bright marquee box over the door + poster panels
  cinema: (b, R, open) => (
    <>
      <Door w={0.36} open={open} />
      <Bx p={[0, 0.42, F + 0.12]} s={[1.1, 0.16, 0.22]} c="#fde047" glow />
      <Bx p={[0, 0.42, F + 0.235]} s={[0.96, 0.1, 0.01]} c="#7e22ce" glow />
      {[-0.42, 0.42].map((x) => (
        <Bx key={x} p={[x, 0.17, F + 0.01]} s={[0.2, 0.28, 0.01]} c={x < 0 ? "#f472b6" : "#38bdf8"} glow />
      ))}
      <Cy p={[0.3, R + 0.2, -0.3]} r={0.17} len={0.06} c="#1f2937" rot={[Math.PI / 2, 0, 0]} />
      <Cy p={[-0.05, R + 0.2, -0.3]} r={0.17} len={0.06} c="#1f2937" rot={[Math.PI / 2, 0, 0]} />
    </>
  ),
  // 💪 a giant dumbbell on the roof
  gym: (b, R, open) => (
    <>
      <Door w={0.44} c="#1e3a5f" open={open} />
      <Display c="#7dd3fc" wide />
      <Cy p={[0, R + 0.16, -0.2]} r={0.035} len={0.8} c="#cbd5e1" rot={[0, 0, Math.PI / 2]} />
      {[-0.36, 0.36].map((x) => (
        <Cy key={x} p={[x, R + 0.16, -0.2]} r={0.16} len={0.12} c="#111827" rot={[0, 0, Math.PI / 2]} />
      ))}
    </>
  ),
  // 🎮 neon stripes + a giant joystick
  arcade: (b, R, open) => (
    <>
      <Door w={0.36} c="#1e1b4b" open={open} />
      {[
        [0.42, "#f472b6"],
        [0.5, "#22d3ee"],
      ].map(([y, c]) => (
        <Bx key={c as string} p={[0, y as number, F + 0.01]} s={[1.3, 0.035, 0.01]} c={c as string} glow />
      ))}
      <Bx p={[0, R + 0.04, -0.25]} s={[0.5, 0.08, 0.4]} c="#111827" />
      <Cy p={[0, R + 0.22, -0.25]} r={0.03} len={0.3} c="#9ca3af" seg={8} />
      <mesh position={[0, R + 0.4, -0.25]}>
        <sphereGeometry args={[0.1, 14, 10]} />
        <meshBasicMaterial color="#ef4444" />
      </mesh>
    </>
  ),
  // ☕ a giant coffee cup on the roof
  cafe: (b, R, open) => (
    <>
      <Door open={open} />
      <Display />
      <Awning c={b.sign} />
      <Cy p={[0, R + 0.14, -0.2]} r={0.24} r2={0.18} len={0.28} c="#f8fafc" seg={18} />
      <Cy p={[0, R + 0.281, -0.2]} r={0.22} len={0.01} c="#78350f" seg={18} glow />
      <mesh position={[0.26, R + 0.15, -0.2]}>
        <torusGeometry args={[0.07, 0.02, 6, 14]} />
        <meshStandardMaterial color="#f8fafc" />
      </mesh>
    </>
  ),
  // 🍞 gable roof + chimney, cottage bakery
  bakery: (b, R, open) => (
    <>
      <Door open={open} />
      <Display />
      <Awning c={b.sign} />
      <Gable p={[0, R - 0.04, 0]} w={1.36} d={1.36} hgt={0.42} c="#b45309" />
      <Bx p={[0.38, R + 0.32, -0.3]} s={[0.14, 0.4, 0.14]} c="#7c2d12" />
    </>
  ),
  // 📖 a stack of giant books on the roof
  bookstore: (b, R, open) => (
    <>
      <Door open={open} />
      <Display c="#fef3c7" />
      <Awning c={b.sign} />
      {[
        ["#15803d", 0, 0.62],
        ["#b91c1c", 0.11, 0.56],
        ["#1d4ed8", 0.22, 0.5],
      ].map(([c, y, w], k) => (
        <Bx key={k} p={[k * 0.05 - 0.05, R + 0.05 + (y as number), -0.2]} s={[w as number, 0.1, 0.42]} c={c as string} rot={[0, k * 0.25, 0]} />
      ))}
    </>
  ),
  // 🧸 stacked primary-colour toy blocks
  toyStore: (b, R, open) => (
    <>
      <Door open={open} />
      <Display c="#fbcfe8" />
      <Awning c={b.sign} />
      <Bx p={[-0.2, R + 0.12, -0.25]} s={[0.24, 0.24, 0.24]} c="#ef4444" />
      <Bx p={[0.1, R + 0.12, -0.25]} s={[0.24, 0.24, 0.24]} c="#3b82f6" />
      <Bx p={[-0.05, R + 0.36, -0.25]} s={[0.24, 0.24, 0.24]} c="#facc15" rot={[0, 0.4, 0]} />
    </>
  ),
  // 🏪 full glass front, rooftop AC units
  convenience: (b, R, open) => (
    <>
      <Door w={0.3} c="#a7f3d0" open={open} />
      <Display c="#ecfccb" wide />
      <Bx p={[0, 0.39, F + 0.01]} s={[1.3, 0.06, 0.01]} c={b.sign} glow />
      {[-0.3, 0.2].map((x) => (
        <Bx key={x} p={[x, R + 0.09, -0.3]} s={[0.3, 0.18, 0.24]} c="#9ca3af" />
      ))}
    </>
  ),
  // 🛒 sawtooth roof, wide lit front
  mart: (b, R, open) => (
    <>
      <Door w={0.36} c="#fed7aa" open={open} />
      <Display c="#fff7ed" wide />
      <Bx p={[0, 0.39, F + 0.01]} s={[1.3, 0.06, 0.01]} c={b.sign} glow />
      {[-0.42, 0, 0.42].map((z) => (
        <Gable key={z} p={[0, R, z]} w={1.3} d={0.42} hgt={0.2} c="#ea580c" />
      ))}
    </>
  ),
  // 💊 a big green cross standing on the roof edge
  pharmacy: (b, R, open) => (
    <>
      <Door open={open} />
      <Display c="#d1fae5" />
      <Awning c={b.sign} />
      <Bx p={[0, R + 0.26, 0.1]} s={[0.14, 0.44, 0.06]} c="#22c55e" glow />
      <Bx p={[0, R + 0.26, 0.1]} s={[0.44, 0.14, 0.06]} c="#22c55e" glow />
    </>
  ),
  // 💎 a glowing diamond hovering over the roof
  jewelry: (b, R, open) => (
    <>
      <Door open={open} />
      <Display c="#e9d5ff" />
      <Awning c="#1e1b4b" />
      <Cy p={[0, R + 0.03, -0.15]} r={0.2} len={0.06} c="#1e1b4b" seg={16} />
      <mesh position={[0, R + 0.32, -0.15]} scale={[1, 1.3, 1]}>
        <octahedronGeometry args={[0.2]} />
        <meshStandardMaterial color="#a5f3fc" emissive="#67e8f9" emissiveIntensity={0.6} metalness={0.4} roughness={0.1} flatShading />
      </mesh>
    </>
  ),
  // 🌸 flower boxes out front + a rooftop garden
  florist: (b, R, open) => (
    <>
      <Door open={open} />
      <Display c="#fce7f3" />
      <Awning c={b.sign} />
      {[-0.45, -0.3, 0.3, 0.45].map((x, k) => (
        <group key={x}>
          <Bx p={[x, 0.05, F + 0.12]} s={[0.12, 0.1, 0.12]} c="#78350f" />
          <mesh position={[x, 0.14, F + 0.12]}>
            <sphereGeometry args={[0.07, 8, 6]} />
            <meshStandardMaterial color={["#f472b6", "#facc15", "#fb7185", "#c084fc"][k]} />
          </mesh>
        </group>
      ))}
      <Bx p={[0, R + 0.01, -0.05]} s={[1.2, 0.02, 1.1]} c="#15803d" />
      {[-0.35, 0.05, 0.38].map((x, k) => (
        <mesh key={x} position={[x, R + 0.12, -0.3 + k * 0.08]}>
          <sphereGeometry args={[0.13, 10, 8]} />
          <meshStandardMaterial color="#22c55e" />
        </mesh>
      ))}
    </>
  ),
  // 💇 a spinning-style barber pole by the door
  salon: (b, R, open) => (
    <>
      <Door open={open} />
      <Display c="#f5d0fe" />
      <Awning c={b.sign} />
      {[0, 1, 2, 3, 4, 5].map((k) => (
        <Cy key={k} p={[0.52, 0.06 + k * 0.06, F + 0.16]} r={0.05} len={0.06} c={["#ef4444", "#f8fafc", "#2563eb"][k % 3]} glow />
      ))}
      <mesh position={[0.52, 0.42, F + 0.16]}>
        <sphereGeometry args={[0.06, 10, 8]} />
        <meshBasicMaterial color="#f8fafc" />
      </mesh>
    </>
  ),
  // 🧺 round washer windows + a rooftop clothesline
  laundry: (b, R, open) => (
    <>
      <Door open={open} />
      {[-0.42, 0.42].map((x) => (
        <mesh key={x} position={[x, 0.18, F + 0.006]}>
          <circleGeometry args={[0.11, 18]} />
          <meshBasicMaterial color="#a5f3fc" />
        </mesh>
      ))}
      {[-0.5, 0.5].map((x) => (
        <Cy key={x} p={[x, R + 0.18, -0.25]} r={0.012} len={0.36} c="#cbd5e1" seg={6} />
      ))}
      <Bx p={[0, R + 0.35, -0.25]} s={[1.0, 0.008, 0.008]} c="#e5e7eb" glow />
      {[
        [-0.3, "#f472b6"],
        [0, "#38bdf8"],
        [0.3, "#facc15"],
      ].map(([x, c]) => (
        <mesh key={c as string} position={[x as number, R + 0.25, -0.25]}>
          <planeGeometry args={[0.2, 0.2]} />
          <meshBasicMaterial color={c as string} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </>
  ),
  // 🍗 patio umbrellas on the sidewalk
  chicken: (b, R, open) => (
    <>
      <Door open={open} />
      <Display />
      <Awning c={b.sign} />
      <Umbrella p={[-0.42, 0, F + 0.2]} c="#f97316" />
      <Umbrella p={[0.42, 0, F + 0.2]} c="#facc15" />
      <Cy p={[0.3, R + 0.15, -0.35]} r={0.06} len={0.3} c="#6b7280" seg={8} />
    </>
  ),
  // 🍜 a red four-sided (hip) roof with lanterns
  restaurant: (b, R, open) => (
    <>
      <Door open={open} />
      <Display c="#fecaca" />
      <Cy p={[0, R + 0.17, 0]} r={0} r2={1.0} len={0.34} c="#b91c1c" seg={4} rot={[0, Math.PI / 4, 0]} />
      {[-0.42, 0.42].map((x) => (
        <mesh key={x} position={[x, 0.42, F + 0.1]}>
          <sphereGeometry args={[0.06, 10, 8]} />
          <meshBasicMaterial color="#f87171" />
        </mesh>
      ))}
    </>
  ),
};

export function Landmark({ b, h, open }: { b: BuildingType; h: number; open: boolean }) {
  return <>{SHAPES[b.shape](b, h + 0.08, open)}</>;
}
