"use client";

import type { PropKind } from "../house";

/**
 * 숨을 곳 가구 25종 — 프리미티브 몇 개씩으로 만든 저폴리 소품. 원점 = 가구 바닥 가운데,
 * +z가 방 안쪽(앞). 그림자 맵 없이 밤 조명만으로 읽히게 색 대비를 크게 했다.
 */

type V3 = [number, number, number];

function Box({ p, s, c, r = 0.7, m = 0 }: { p: V3; s: V3; c: string; r?: number; m?: number }) {
  return (
    <mesh position={p}>
      <boxGeometry args={s} />
      <meshStandardMaterial color={c} roughness={r} metalness={m} />
    </mesh>
  );
}

function Cyl({ p, rt, rb, h, c, rot }: { p: V3; rt: number; rb: number; h: number; c: string; rot?: V3 }) {
  return (
    <mesh position={p} rotation={rot}>
      <cylinderGeometry args={[rt, rb, h, 14]} />
      <meshStandardMaterial color={c} roughness={0.6} />
    </mesh>
  );
}

export default function Prop({ kind }: { kind: PropKind }) {
  switch (kind) {
    case "shelf":
      return (
        <group>
          <Box p={[0, 1.0, 0]} s={[1.4, 2.0, 0.5]} c="#6b4a2b" />
          {[0.45, 1.0, 1.55].map((y) => (
            <Box key={y} p={[0, y, 0.05]} s={[1.3, 0.06, 0.48]} c="#8a6a45" />
          ))}
          <Box p={[-0.35, 1.18, 0.1]} s={[0.35, 0.3, 0.3]} c="#c0392b" m={0.4} />
          <Box p={[0.3, 0.63, 0.1]} s={[0.45, 0.3, 0.3]} c="#2e86c1" m={0.3} />
        </group>
      );
    case "bike":
      return (
        <group>
          <Cyl p={[0, 0.38, -0.5]} rt={0.36} rb={0.36} h={0.06} c="#222" rot={[0, 0, Math.PI / 2]} />
          <Cyl p={[0, 0.38, 0.5]} rt={0.36} rb={0.36} h={0.06} c="#222" rot={[0, 0, Math.PI / 2]} />
          <Box p={[0, 0.62, 0]} s={[0.06, 0.06, 1.0]} c="#e74c3c" m={0.5} />
          <Box p={[0, 0.82, -0.35]} s={[0.25, 0.06, 0.12]} c="#333" />
          <Box p={[0, 0.95, 0.42]} s={[0.5, 0.05, 0.05]} c="#999" m={0.6} />
          <Box p={[0, 0.5, -0.9]} s={[1.0, 1.0, 0.25]} c="#7f8c8d" />
        </group>
      );
    case "boxes":
      return (
        <group>
          <Box p={[-0.3, 0.3, 0]} s={[0.7, 0.6, 0.7]} c="#b9874f" r={0.9} />
          <Box p={[0.4, 0.28, 0.1]} s={[0.6, 0.56, 0.6]} c="#a97a45" r={0.9} />
          <Box p={[0.0, 0.85, -0.05]} s={[0.65, 0.5, 0.6]} c="#c99a5f" r={0.9} />
          <Box p={[0.35, 0.72, 0.1]} s={[0.4, 0.32, 0.4]} c="#b0824a" r={0.9} />
        </group>
      );
    case "shoecab":
      return (
        <group>
          <Box p={[0, 0.6, 0]} s={[1.3, 1.2, 0.5]} c="#d8c3a0" />
          <Box p={[-0.32, 0.6, 0.26]} s={[0.6, 1.1, 0.03]} c="#c4ab84" />
          <Box p={[0.32, 0.6, 0.26]} s={[0.6, 1.1, 0.03]} c="#c4ab84" />
          <Box p={[0.3, 0.06, 0.45]} s={[0.25, 0.1, 0.12]} c="#e74c3c" />
        </group>
      );
    case "coats":
      return (
        <group>
          <Cyl p={[0, 0.95, 0]} rt={0.04} rb={0.06} h={1.9} c="#5d4037" />
          <Box p={[-0.25, 1.1, 0.12]} s={[0.5, 1.0, 0.25]} c="#34495e" r={0.95} />
          <Box p={[0.25, 1.05, 0.08]} s={[0.45, 1.1, 0.28]} c="#8e44ad" r={0.95} />
          <Box p={[0.0, 1.0, 0.25]} s={[0.55, 0.9, 0.2]} c="#a0522d" r={0.95} />
        </group>
      );
    case "sofa":
      return (
        <group>
          <Box p={[0, 0.25, 0]} s={[2.0, 0.5, 0.9]} c="#b03a2e" r={0.9} />
          <Box p={[0, 0.7, -0.35]} s={[2.0, 0.7, 0.25]} c="#a93226" r={0.9} />
          <Box p={[-0.92, 0.55, 0]} s={[0.2, 0.4, 0.9]} c="#a93226" r={0.9} />
          <Box p={[0.92, 0.55, 0]} s={[0.2, 0.4, 0.9]} c="#a93226" r={0.9} />
          <Box p={[-0.4, 0.58, 0.05]} s={[0.4, 0.3, 0.15]} c="#f5cba7" r={0.9} />
        </group>
      );
    case "curtain":
      return (
        <group>
          <Box p={[0, 1.3, -0.15]} s={[1.2, 1.4, 0.05]} c="#1b2a49" />
          <Box p={[0, 2.05, 0]} s={[1.5, 0.05, 0.05]} c="#6d4c41" />
          {[-0.5, -0.25, 0, 0.25, 0.5].map((x, i) => (
            <Box key={x} p={[x, 1.05, 0.02 + (i % 2) * 0.05]} s={[0.24, 2.0, 0.06]} c={i % 2 ? "#1e8449" : "#239b56"} r={0.95} />
          ))}
        </group>
      );
    case "piano":
      return (
        <group>
          <Box p={[0, 0.65, -0.1]} s={[1.5, 1.3, 0.55]} c="#141414" r={0.25} m={0.2} />
          <Box p={[0, 0.78, 0.25]} s={[1.4, 0.08, 0.3]} c="#f2f2f2" r={0.3} />
          <Box p={[-0.6, 0.35, 0.25]} s={[0.1, 0.7, 0.1]} c="#141414" />
          <Box p={[0.6, 0.35, 0.25]} s={[0.1, 0.7, 0.1]} c="#141414" />
          <Box p={[0, 0.25, 0.75]} s={[0.8, 0.5, 0.35]} c="#3e2723" />
        </group>
      );
    case "tub":
      return (
        <group>
          <Box p={[0, 0.3, 0]} s={[1.7, 0.6, 0.85]} c="#fdfefe" r={0.2} />
          <Box p={[0, 0.5, 0]} s={[1.5, 0.3, 0.65]} c="#aed6f1" r={0.1} />
          <Box p={[0, 2.1, 0.45]} s={[1.8, 0.04, 0.04]} c="#bdc3c7" m={0.8} />
          {[-0.7, -0.35, 0, 0.35, 0.7].map((x, i) => (
            <Box key={x} p={[x, 1.35, 0.45 + (i % 2) * 0.04]} s={[0.36, 1.4, 0.03]} c={i % 2 ? "#f9e79f" : "#f7dc6f"} r={0.95} />
          ))}
        </group>
      );
    case "washer":
      return (
        <group>
          <Box p={[0, 0.45, 0]} s={[0.75, 0.9, 0.7]} c="#ecf0f1" r={0.3} />
          <Cyl p={[0, 0.45, 0.36]} rt={0.24} rb={0.24} h={0.04} c="#5d6d7e" rot={[Math.PI / 2, 0, 0]} />
          <Box p={[0.7, 0.3, 0.05]} s={[0.5, 0.6, 0.5]} c="#d4ac0d" r={0.95} />
        </group>
      );
    case "table":
      return (
        <group>
          <Box p={[0, 0.78, 0]} s={[1.8, 0.08, 1.1]} c="#a04000" />
          {[
            [-0.8, -0.45],
            [0.8, -0.45],
            [-0.8, 0.45],
            [0.8, 0.45],
          ].map(([x, z]) => (
            <Box key={`${x}${z}`} p={[x, 0.38, z]} s={[0.08, 0.76, 0.08]} c="#784212" />
          ))}
          <Box p={[0, 0.66, 0]} s={[1.9, 0.12, 1.2]} c="#f5eef8" r={0.95} />
          <Cyl p={[0.3, 0.88, 0]} rt={0.12} rb={0.1} h={0.12} c="#e67e22" />
        </group>
      );
    case "pantry":
      return (
        <group>
          <Box p={[0, 1.1, 0]} s={[1.0, 2.2, 0.6]} c="#f0e3c4" />
          <Box p={[0, 1.1, 0.31]} s={[0.92, 2.1, 0.03]} c="#e2cfa3" />
          <Box p={[0.35, 1.1, 0.34]} s={[0.05, 0.25, 0.04]} c="#7f8c8d" m={0.7} />
        </group>
      );
    case "sink":
      return (
        <group>
          <Box p={[0, 0.45, 0]} s={[1.6, 0.9, 0.6]} c="#d5dbdb" />
          <Box p={[0, 0.92, 0]} s={[1.7, 0.06, 0.65]} c="#7b7d7d" r={0.3} m={0.4} />
          <Box p={[-0.38, 0.45, 0.31]} s={[0.72, 0.8, 0.03]} c="#ccd1d1" />
          <Box p={[0.38, 0.45, 0.31]} s={[0.72, 0.8, 0.03]} c="#ccd1d1" />
          <Cyl p={[0.2, 1.1, -0.2]} rt={0.03} rb={0.03} h={0.35} c="#bdc3c7" />
        </group>
      );
    case "hamper":
      return (
        <group>
          <Cyl p={[0, 0.4, 0]} rt={0.4} rb={0.33} h={0.8} c="#c8a165" />
          <Box p={[0.05, 0.82, 0]} s={[0.5, 0.15, 0.4]} c="#5dade2" r={0.95} />
          <Box p={[-0.1, 0.86, 0.1]} s={[0.3, 0.12, 0.3]} c="#f1948a" r={0.95} />
        </group>
      );
    case "plant":
      return (
        <group>
          <Cyl p={[0, 0.3, 0]} rt={0.35} rb={0.28} h={0.6} c="#b9770e" />
          {[0, 1.3, 2.6, 3.9, 5.2].map((a) => (
            <mesh key={a} position={[Math.cos(a) * 0.3, 1.2, Math.sin(a) * 0.3]} rotation={[Math.cos(a) * 0.4, 0, Math.sin(a) * 0.4]}>
              <coneGeometry args={[0.35, 1.3, 6]} />
              <meshStandardMaterial color="#1e8449" roughness={0.8} />
            </mesh>
          ))}
        </group>
      );
    case "wardrobe":
      return (
        <group>
          <Box p={[0, 1.15, 0]} s={[1.3, 2.3, 0.65]} c="#7e5109" />
          <Box p={[-0.32, 1.15, 0.33]} s={[0.62, 2.15, 0.03]} c="#9c640c" />
          <Box p={[0.32, 1.15, 0.33]} s={[0.62, 2.15, 0.03]} c="#9c640c" />
          <Box p={[-0.05, 1.15, 0.37]} s={[0.04, 0.2, 0.04]} c="#f4d03f" m={0.8} />
          <Box p={[0.05, 1.15, 0.37]} s={[0.04, 0.2, 0.04]} c="#f4d03f" m={0.8} />
        </group>
      );
    case "bed":
      return (
        <group>
          <Box p={[0, 0.3, 0]} s={[1.6, 0.35, 2.0]} c="#6e2c00" />
          <Box p={[0, 0.55, 0.05]} s={[1.5, 0.18, 1.85]} c="#f8f9f9" r={0.95} />
          <Box p={[0, 0.6, 0.3]} s={[1.52, 0.2, 1.2]} c="#5b2c6f" r={0.95} />
          <Box p={[0, 0.78, -0.75]} s={[1.0, 0.18, 0.35]} c="#fdfefe" r={0.95} />
          <Box p={[0, 0.8, -0.98]} s={[1.6, 1.0, 0.1]} c="#6e2c00" />
        </group>
      );
    case "vanity":
      return (
        <group>
          <Box p={[0, 0.4, 0]} s={[0.9, 0.8, 0.45]} c="#f5cba7" />
          <mesh position={[0, 1.35, -0.15]}>
            <circleGeometry args={[0.38, 24]} />
            <meshStandardMaterial color="#d6eaf8" metalness={0.9} roughness={0.08} />
          </mesh>
          <Cyl p={[0.3, 0.88, 0.05]} rt={0.04} rb={0.05} h={0.14} c="#e91e63" />
        </group>
      );
    case "toybox":
      return (
        <group>
          <Box p={[0, 0.35, 0]} s={[1.1, 0.7, 0.7]} c="#f4d03f" />
          <Box p={[0, 0.74, -0.25]} s={[1.12, 0.08, 0.7]} c="#e74c3c" />
          <mesh position={[0.6, 0.25, 0.45]}>
            <sphereGeometry args={[0.22, 14, 10]} />
            <meshStandardMaterial color="#3498db" roughness={0.4} />
          </mesh>
          <mesh position={[-0.3, 0.86, 0.1]}>
            <sphereGeometry args={[0.18, 12, 10]} />
            <meshStandardMaterial color="#a0522d" roughness={0.95} />
          </mesh>
        </group>
      );
    case "tent":
      return (
        <group>
          <mesh position={[0, 0.8, 0]}>
            <coneGeometry args={[0.95, 1.6, 6]} />
            <meshStandardMaterial color="#f0b27a" roughness={0.9} />
          </mesh>
          <mesh position={[0, 0.5, 0.62]} rotation-x={-0.42}>
            <planeGeometry args={[0.55, 0.9]} />
            <meshStandardMaterial color="#2c3e50" />
          </mesh>
          {[0, 2.1, 4.2].map((a) => (
            <Cyl key={a} p={[Math.cos(a) * 0.12, 1.75, Math.sin(a) * 0.12]} rt={0.015} rb={0.015} h={0.5} c="#6e2c00" />
          ))}
        </group>
      );
    case "bunk":
      return (
        <group>
          {[
            [-0.75, -0.45],
            [0.75, -0.45],
            [-0.75, 0.45],
            [0.75, 0.45],
          ].map(([x, z]) => (
            <Box key={`${x}${z}`} p={[x, 1.0, z]} s={[0.08, 2.0, 0.08]} c="#2874a6" />
          ))}
          <Box p={[0, 0.35, 0]} s={[1.5, 0.15, 0.9]} c="#5dade2" r={0.95} />
          <Box p={[0, 1.55, 0]} s={[1.5, 0.15, 0.9]} c="#58d68d" r={0.95} />
          <Box p={[0, 1.75, 0.42]} s={[1.5, 0.25, 0.05]} c="#2874a6" />
          <Box p={[0.8, 1.0, 0.5]} s={[0.06, 1.6, 0.06]} c="#a9cce3" />
        </group>
      );
    case "desk":
      return (
        <group>
          <Box p={[0, 0.76, 0]} s={[1.6, 0.08, 0.8]} c="#6e2c00" />
          <Box p={[-0.6, 0.38, 0]} s={[0.4, 0.76, 0.76]} c="#784212" />
          <Box p={[0.75, 0.38, 0]} s={[0.06, 0.76, 0.76]} c="#784212" />
          <Box p={[0.3, 0.95, -0.2]} s={[0.4, 0.3, 0.05]} c="#1c2833" />
          <Cyl p={[-0.5, 1.0, -0.15]} rt={0.12} rb={0.04} h={0.3} c="#f4d03f" />
        </group>
      );
    case "bookcase":
      return (
        <group>
          <Box p={[0, 1.2, 0]} s={[1.5, 2.4, 0.45]} c="#4a2f1b" />
          {[0.35, 0.95, 1.55, 2.1].map((y, i) => (
            <group key={y}>
              {Array.from({ length: 7 }, (_, k) => (
                <Box key={k} p={[-0.6 + k * 0.2, y + 0.18, 0.12]} s={[0.15, 0.36 - ((k + i) % 3) * 0.05, 0.25]} c={["#c0392b", "#2471a3", "#d4ac0d", "#239b56", "#7d3c98"][(k + i) % 5]} r={0.8} />
              ))}
            </group>
          ))}
        </group>
      );
    case "trunk":
      return (
        <group>
          <Box p={[0, 0.35, 0]} s={[1.2, 0.7, 0.7]} c="#6e2c00" />
          <mesh position={[0, 0.7, 0]} rotation-z={Math.PI / 2}>
            <cylinderGeometry args={[0.35, 0.35, 1.2, 12, 1, false, 0, Math.PI]} />
            <meshStandardMaterial color="#784212" roughness={0.8} />
          </mesh>
          <Box p={[0, 0.5, 0.36]} s={[0.15, 0.2, 0.04]} c="#d4ac0d" m={0.8} />
          <Box p={[-0.45, 0.5, 0]} s={[0.06, 0.72, 0.72]} c="#1c1c1c" m={0.6} />
          <Box p={[0.45, 0.5, 0]} s={[0.06, 0.72, 0.72]} c="#1c1c1c" m={0.6} />
        </group>
      );
    case "mannequin":
      return (
        <group>
          {[-0.45, 0.45].map((x) => (
            <group key={x} position={[x, 0, 0]}>
              <Cyl p={[0, 0.05, 0]} rt={0.25} rb={0.25} h={0.06} c="#2c2c2c" />
              <Cyl p={[0, 0.5, 0]} rt={0.03} rb={0.03} h={0.9} c="#555" />
              <mesh position={[0, 1.25, 0]} scale={[1, 1.4, 0.75]}>
                <sphereGeometry args={[0.3, 14, 10]} />
                <meshStandardMaterial color={x < 0 ? "#e8daef" : "#d5d8dc"} roughness={0.6} />
              </mesh>
              <mesh position={[0, 1.8, 0]}>
                <sphereGeometry args={[0.13, 10, 8]} />
                <meshStandardMaterial color="#d5d8dc" roughness={0.6} />
              </mesh>
            </group>
          ))}
        </group>
      );
  }
}
