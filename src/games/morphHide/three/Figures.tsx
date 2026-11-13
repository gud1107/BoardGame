"use client";

import { useMemo, useRef, type ReactNode, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import PoliceCap from "./PoliceCap";

/**
 * 저폴리 캐릭터 — VRM 없이 상자·구로 만든 사람/점검원(술래)/강아지/고양이/청소기/자동차.
 * 몸짓은 `anim` 문자열 하나로 정해지고 useFrame에서 관절 각도만 바꾼다(가볍다).
 * 원점 = 발바닥 가운데, +z = 앞.
 */

type V3 = [number, number, number];

const SHIRTS = ["#e76f51", "#2a9d8f", "#e9c46a", "#8ab17d", "#f4a261", "#9b5de5", "#00bbf9", "#f15bb5"];
const PANTS = ["#264653", "#3d405b", "#5c4033", "#22223b", "#4a4e69", "#2b2d42", "#6c584c", "#1d3557"];
const SKIN = ["#f1c27d", "#e0ac69", "#c68642", "#ffdbac", "#8d5524", "#f5d0a9", "#d1a17a", "#e8b98a"];
const HAIR = ["#2b1d14", "#5a3825", "#111", "#c19a6b", "#7b3f00", "#d4af37", "#333", "#8b4513"];

function B({ p, s, c, r }: { p: V3; s: V3; c: string; r?: V3 }) {
  return (
    <mesh position={p} rotation={r}>
      <boxGeometry args={s} />
      <meshStandardMaterial color={c} roughness={0.75} />
    </mesh>
  );
}

function S({ p, r, c }: { p: V3; r: number; c: string }) {
  return (
    <mesh position={p}>
      <sphereGeometry args={[r, 12, 10]} />
      <meshStandardMaterial color={c} roughness={0.7} />
    </mesh>
  );
}

export type WeaponLook = "hand" | "hammer" | "sling" | "pistol" | "shotgun" | "sniper" | "flashlight" | null;

function HeldItem({ kind }: { kind: WeaponLook }) {
  switch (kind) {
    case "hammer":
      return (
        <group position={[0, -0.32, 0.08]} rotation={[Math.PI / 2, 0, 0]}>
          <B p={[0, 0, 0.18]} s={[0.05, 0.05, 0.4]} c="#f2c14e" />
          <B p={[0, 0, 0.4]} s={[0.22, 0.14, 0.14]} c="#e63946" />
        </group>
      );
    case "sling":
      return <B p={[0, -0.32, 0.12]} s={[0.04, 0.2, 0.12]} c="#8d6e63" />;
    case "pistol":
      return <B p={[0, -0.3, 0.12]} s={[0.07, 0.12, 0.28]} c="#222" />;
    case "shotgun":
      return <B p={[0, -0.3, 0.3]} s={[0.08, 0.1, 0.7]} c="#4e342e" />;
    case "sniper":
      return (
        <group position={[0, -0.3, 0.35]}>
          <B p={[0, 0, 0]} s={[0.07, 0.1, 0.95]} c="#2f3e46" />
          <B p={[0, 0.09, 0.05]} s={[0.06, 0.06, 0.25]} c="#111" />
        </group>
      );
    case "flashlight":
      return (
        <group position={[0, -0.3, 0.1]}>
          <B p={[0, 0, 0]} s={[0.06, 0.06, 0.22]} c="#333" />
          <B p={[0, 0, 0.1]} s={[0.075, 0.075, 0.05]} c="#1a1a1a" />
          <mesh position={[0, 0, 0.128]}>
            <sphereGeometry args={[0.032, 10, 8]} />
            <meshBasicMaterial color="#fff6c2" toneMapped={false} />
          </mesh>
          {/* 희미한 손전등 빛줄기 — 점검원·술래인 척 모두 같다 */}
          <mesh position={[0, 0, 0.13 + 0.65]} rotation-x={-Math.PI / 2} renderOrder={2}>
            <coneGeometry args={[0.26, 1.3, 16, 1, true]} />
            <meshBasicMaterial color="#fff1b8" transparent opacity={0.06} depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} toneMapped={false} />
          </mesh>
        </group>
      );
    default:
      return null;
  }
}

/** 사람 (행인·점검원·술래) */
export function Humanoid({ anim, look = 0, uniform = false, held = null, scale = 1, children }: { anim: string; look?: number; uniform?: boolean; held?: WeaponLook; scale?: number; children?: ReactNode }) {
  const root = useRef<THREE.Group>(null);
  const hips = useRef<THREE.Group>(null);
  const torso = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Group>(null);
  const legR = useRef<THREE.Group>(null);
  const kneeL = useRef<THREE.Group>(null);
  const kneeR = useRef<THREE.Group>(null);
  const elbowL = useRef<THREE.Group>(null);
  const elbowR = useRef<THREE.Group>(null);
  const shirt = SHIRTS[look % SHIRTS.length];
  const pants = PANTS[(look * 3) % PANTS.length];
  const skin = SKIN[(look * 5) % SKIN.length];
  const hair = HAIR[(look * 7) % HAIR.length];
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const g = { hipsY: 0.92, hipsRX: 0, torsoRX: 0, torsoRY: 0, torsoRZ: 0, headRX: 0, headRY: 0, aL: [0, 0, 0.08], aR: [0, 0, -0.08], lL: 0, lR: 0, kL: 0, kR: 0, rootRX: 0, rootY: 0, eL: 0.15, eR: 0.15 };
    const sw = (f: number, a: number, ph = 0) => Math.sin(t * f + ph) * a;
    switch (anim) {
      case "walk":
        g.lL = sw(7, 0.55);
        g.lR = -g.lL;
        g.kL = Math.max(0, -sw(7, 0.7));
        g.kR = Math.max(0, sw(7, 0.7));
        g.aL = [-g.lL * 0.8, 0, 0.08];
        g.aR = [-g.lR * 0.8, 0, -0.08];
        g.hipsY = 0.92 + Math.abs(sw(7, 0.03));
        g.eL = 0.3 + Math.max(0, g.lL) * 0.5;
        g.eR = 0.3 + Math.max(0, g.lR) * 0.5;
        break;
      case "run":
        g.lL = sw(12, 0.95);
        g.lR = -g.lL;
        g.kL = Math.max(0, -sw(12, 1.3)) + 0.2;
        g.kR = Math.max(0, sw(12, 1.3)) + 0.2;
        g.aL = [-g.lL * 1.1, 0, 0.12];
        g.aR = [-g.lR * 1.1, 0, -0.12];
        g.torsoRX = 0.25;
        g.hipsY = 0.9 + Math.abs(sw(12, 0.07));
        g.eL = g.eR = 1.25;
        break;
      case "jump":
        g.lL = -0.6;
        g.lR = 0.3;
        g.kL = 1.0;
        g.kR = 0.6;
        g.aL = [-2.4, 0, 0.3];
        g.aR = [-2.4, 0, -0.3];
        g.eL = g.eR = 0.35;
        break;
      case "sit":
        g.hipsY = 0.48;
        g.lL = -1.5;
        g.lR = -1.5;
        g.kL = 1.5;
        g.kR = 1.5;
        g.aL = [-0.4, 0, 0.1];
        g.aR = [-0.4, 0, -0.1];
        g.eL = g.eR = 0.9;
        break;
      case "crouch":
        g.hipsY = 0.5;
        g.lL = -1.9;
        g.lR = -1.9;
        g.kL = 2.4;
        g.kR = 2.4;
        g.torsoRX = 0.45;
        g.aL = [-1.2, 0, 0.2];
        g.aR = [-1.2, 0, -0.2];
        g.eL = g.eR = 0.7;
        break;
      case "lie":
        g.rootRX = -Math.PI / 2;
        g.rootY = 0.15;
        g.aL = [0, 0, 0.3];
        g.aR = [0, 0, -0.3];
        break;
      case "phone":
        g.aR = [-1.3, 0.3, -0.25];
        g.aL = [-0.9, -0.2, 0.2];
        g.headRX = 0.5;
        g.eR = 1.3;
        g.eL = 1.0;
        break;
      case "inspect":
      case "aim":
        // 손을 앞으로 쭉 — 술래가 뒤질 때 하는 그 동작
        g.aR = [-1.55 + sw(5, 0.08), 0, -0.05];
        g.aL = [anim === "aim" ? -1.45 : -1.2 + sw(4, 0.1, 1), 0, 0.15];
        g.torsoRX = anim === "aim" ? 0.05 : 0.2;
        g.headRX = 0.25;
        g.headRY = sw(1.8, 0.4);
        g.eR = 0.05;
        g.eL = anim === "aim" ? 0.1 : 0.55;
        break;
      case "radio":
        // 어깨 무전기를 잡고 고개를 살짝 돌린다
        g.aR = [-0.55, 0, -0.32];
        g.eR = 2.25;
        g.headRY = 0.35;
        g.headRX = 0.15;
        break;
      case "wave":
        g.aR = [-2.8, 0, -0.4 + sw(10, 0.4)];
        g.eR = 0.5;
        break;
      case "dance":
        g.hipsY = 0.9 + Math.abs(sw(8, 0.08));
        g.torsoRZ = sw(4, 0.25);
        g.aL = [-2.6, 0, 0.6 + sw(8, 0.5)];
        g.aR = [-2.6, 0, -0.6 + sw(8, 0.5, 1)];
        g.lL = sw(8, 0.4);
        g.lR = sw(8, 0.4, Math.PI);
        g.eL = g.eR = 0.9;
        break;
      case "laugh":
        g.torsoRX = -0.3 + sw(14, 0.1);
        g.headRX = -0.4;
        g.aL = [-0.5, 0, 0.6];
        g.aR = [-0.5, 0, -0.6];
        g.eL = g.eR = 1.3;
        break;
      case "taunt":
        g.aL = [-1.8 + sw(9, 0.3), 0, 0.5];
        g.aR = [-1.8 + sw(9, 0.3, 1), 0, -0.5];
        g.torsoRY = sw(6, 0.4);
        g.hipsY = 0.92 + Math.abs(sw(9, 0.05));
        g.eL = g.eR = 0.8;
        break;
      case "caught":
        g.rootRX = -Math.PI / 2.3;
        g.rootY = 0.1;
        break;
      default:
        g.aL = [sw(1.5, 0.04), 0, 0.08];
        g.aR = [sw(1.5, 0.04, 1), 0, -0.08];
        g.hipsY = 0.92 + sw(2, 0.006);
    }
    if (root.current) {
      root.current.rotation.x = g.rootRX;
      root.current.position.y = g.rootY;
    }
    if (hips.current) hips.current.position.y = g.hipsY;
    if (torso.current) torso.current.rotation.set(g.torsoRX, g.torsoRY, g.torsoRZ);
    if (head.current) head.current.rotation.set(g.headRX, g.headRY, 0);
    armL.current?.rotation.set(g.aL[0], g.aL[1], g.aL[2]);
    armR.current?.rotation.set(g.aR[0], g.aR[1], g.aR[2]);
    if (legL.current) legL.current.rotation.x = g.lL;
    if (legR.current) legR.current.rotation.x = g.lR;
    if (kneeL.current) kneeL.current.rotation.x = g.kL;
    if (kneeR.current) kneeR.current.rotation.x = g.kR;
    if (elbowL.current) elbowL.current.rotation.x = -g.eL;
    if (elbowR.current) elbowR.current.rotation.x = -g.eR;
  });
  if (uniform)
    return (
      <group scale={scale}>
        <group ref={root}>
          <group ref={hips} position={[0, 0.92, 0]}>
            <OfficerBody look={look} held={held} torsoRef={torso} headRef={head} armLRef={armL} armRRef={armR} legLRef={legL} legRRef={legR} kneeLRef={kneeL} kneeRRef={kneeR} elbowLRef={elbowL} elbowRRef={elbowR} />
          </group>
        </group>
        {children}
      </group>
    );
  const leg = (side: number, legRef: typeof legL, kneeRef: typeof kneeL) => (
    <group ref={legRef} position={[0.11 * side, 0, 0]}>
      <B p={[0, -0.22, 0]} s={[0.15, 0.44, 0.17]} c={pants} />
      <group ref={kneeRef} position={[0, -0.44, 0]}>
        <B p={[0, -0.21, 0]} s={[0.14, 0.42, 0.15]} c={pants} />
        <B p={[0, -0.44, 0.05]} s={[0.15, 0.07, 0.26]} c="#222" />
      </group>
    </group>
  );
  return (
    <group scale={scale}>
      <group ref={root}>
        <group ref={hips} position={[0, 0.92, 0]}>
          {leg(-1, legL, kneeL)}
          {leg(1, legR, kneeR)}
          <group ref={torso}>
            <B p={[0, 0.3, 0]} s={[0.42, 0.56, 0.24]} c={shirt} />
            <group ref={head} position={[0, 0.68, 0]}>
              <S p={[0, 0.1, 0]} r={0.15} c={skin} />
              <B p={[0, 0.2, -0.03]} s={[0.31, 0.12, 0.3]} c={hair} />
              <B p={[-0.055, 0.12, 0.14]} s={[0.04, 0.04, 0.02]} c="#111" />
              <B p={[0.055, 0.12, 0.14]} s={[0.04, 0.04, 0.02]} c="#111" />
            </group>
            <group ref={armL} position={[-0.27, 0.55, 0]}>
              <B p={[0, -0.25, 0]} s={[0.11, 0.5, 0.12]} c={shirt} />
              <S p={[0, -0.52, 0]} r={0.06} c={skin} />
            </group>
            <group ref={armR} position={[0.27, 0.55, 0]}>
              <B p={[0, -0.25, 0]} s={[0.11, 0.5, 0.12]} c={shirt} />
              <S p={[0, -0.52, 0]} r={0.06} c={skin} />
              <HeldItem kind={held} />
              {anim === "phone" && <B p={[0, -0.55, 0.06]} s={[0.08, 0.14, 0.02]} c="#111" />}
            </group>
          </group>
        </group>
      </group>
      {children}
    </group>
  );
}

// ---------------------------------------------------------------------------
// 순경 (점검원 NPC · "술래인 척" 변신 공용)
// 한국 지구대 순경 근무 차림: 감청색 근무복 + 형광 반사 조끼(등판 POLICE / 가슴 경찰),
// 흉장·명찰, 견장, 어깨 무전기, 근무벨트(권총집·경찰봉·수갑집), 광 나는 구두.

const OF = {
  shirt: "#2b4166",
  shirtDark: "#1d2e4d",
  pants: "#18223a",
  vest: "#c9f02b",
  reflect: "#dfe5ec",
  belt: "#121212",
  gold: "#e8b93a",
  black: "#0d0d0f",
};

const officerTexCache = new Map<string, THREE.CanvasTexture>();
function officerText(text: string, w: number, h: number, fg: string, bg: string, font: string) {
  const key = `${text}|${w}|${h}|${fg}|${bg}|${font}`;
  let tex = officerTexCache.get(key);
  if (tex) return tex;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = fg;
  g.font = font;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, w / 2, h / 2 + h * 0.04);
  tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  officerTexCache.set(key, tex);
  return tex;
}

function M({ c, r = 0.7, m = 0, e }: { c: string; r?: number; m?: number; e?: number }) {
  return <meshStandardMaterial color={c} roughness={r} metalness={m} emissive={e ? c : "#000"} emissiveIntensity={e ?? 0} />;
}

function Pill({ p, rad, len, c, r }: { p: V3; rad: number; len: number; c: string; r?: number }) {
  return (
    <mesh position={p}>
      <capsuleGeometry args={[rad, len, 4, 10]} />
      <M c={c} r={r} />
    </mesh>
  );
}

/** 몸통(타원 기둥) 한 겹 — z 방향으로 납작하게 */
function Shell({ y, top, bot, h, c, r, m, e, open }: { y: number; top: number; bot: number; h: number; c: string; r?: number; m?: number; e?: number; open?: boolean }) {
  return (
    <mesh position-y={y} scale={[1, 1, 0.64]}>
      <cylinderGeometry args={[top, bot, h, 22, 1, !!open]} />
      <M c={c} r={r} m={m} e={e} />
    </mesh>
  );
}

type GRef = RefObject<THREE.Group | null>;
type OfficerRefs = { torsoRef: GRef; headRef: GRef; armLRef: GRef; armRRef: GRef; legLRef: GRef; legRRef: GRef; kneeLRef: GRef; kneeRRef: GRef; elbowLRef: GRef; elbowRRef: GRef };

const OFFICER_NAMES = ["김순경", "이순경", "박순경", "최순경", "정순경", "강순경", "조순경", "윤순경"];

function OfficerBody({ look, held, torsoRef, headRef, armLRef, armRRef, legLRef, legRRef, kneeLRef, kneeRRef, elbowLRef, elbowRRef }: { look: number; held: WeaponLook } & OfficerRefs) {
  const skin = SKIN[(look * 5) % SKIN.length];
  const hair = look % 3 === 2 ? "#3a2a1e" : "#141110";
  const back = useMemo(() => officerText("POLICE", 256, 72, "#0f1b33", OF.vest, "900 58px Arial, sans-serif"), []);
  const chest = useMemo(() => officerText("경찰", 128, 64, "#0f1b33", OF.vest, "900 44px 'Malgun Gothic', sans-serif"), []);
  const name = useMemo(() => officerText(OFFICER_NAMES[look % OFFICER_NAMES.length], 128, 40, "#fff", "#1a1a1a", "700 26px 'Malgun Gothic', sans-serif"), [look]);
  const patch = useMemo(() => officerText("POLICE", 96, 96, OF.gold, "#16233f", "900 22px Arial, sans-serif"), []);

  const leg = (side: number, legRef: GRef, kneeRef: GRef) => (
    <group ref={legRef} position={[0.105 * side, 0, 0]}>
      <Pill p={[0, -0.21, 0]} rad={0.082} len={0.28} c={OF.pants} r={0.8} />
      <group ref={kneeRef} position={[0, -0.44, 0]}>
        <Pill p={[0, -0.19, 0]} rad={0.068} len={0.28} c={OF.pants} r={0.8} />
        {/* 광 나는 검정 구두 */}
        <mesh position={[0, -0.425, 0.045]} scale={[1, 0.55, 1.6]}>
          <sphereGeometry args={[0.078, 14, 10]} />
          <M c={OF.black} r={0.18} m={0.25} />
        </mesh>
        <B p={[0, -0.452, 0.04]} s={[0.11, 0.018, 0.2]} c="#050505" />
      </group>
    </group>
  );

  const arm = (side: number, armRef: GRef, elbowRef: GRef, item: boolean) => (
    <group ref={armRef} position={[0.265 * side, 0.54, 0]}>
      {/* 어깨 */}
      <mesh position={[0, -0.02, 0]}>
        <sphereGeometry args={[0.072, 12, 10]} />
        <M c={OF.shirt} />
      </mesh>
      <Pill p={[0, -0.14, 0]} rad={0.06} len={0.16} c={OF.shirt} />
      {/* 팔 견장 (POLICE 패치) */}
      <mesh position={[0.062 * side, -0.11, 0]} rotation-y={(side * Math.PI) / 2}>
        <planeGeometry args={[0.07, 0.07]} />
        <meshStandardMaterial map={patch} roughness={0.8} />
      </mesh>
      <group ref={elbowRef} position={[0, -0.28, 0]}>
        <Pill p={[0, -0.12, 0]} rad={0.052} len={0.14} c={OF.shirt} />
        {/* 소매 끝 */}
        <mesh position={[0, -0.215, 0]}>
          <cylinderGeometry args={[0.056, 0.056, 0.03, 12]} />
          <M c={OF.shirtDark} />
        </mesh>
        {/* 손 */}
        <mesh position={[0, -0.27, 0.01]} scale={[0.85, 1.1, 1]}>
          <sphereGeometry args={[0.052, 12, 10]} />
          <M c={skin} r={0.6} />
        </mesh>
        {item && (
          <group position={[0, 0.04, 0]}>
            <HeldItem kind={held} />
          </group>
        )}
      </group>
    </group>
  );

  return (
    <>
      {leg(-1, legLRef, kneeLRef)}
      {leg(1, legRRef, kneeRRef)}
      <group ref={torsoRef}>
        {/* 골반·바지 엉덩이 */}
        <mesh position-y={0.02} scale={[1, 0.8, 0.7]}>
          <sphereGeometry args={[0.19, 16, 12]} />
          <M c={OF.pants} r={0.8} />
        </mesh>
        {/* 근무복 상의 */}
        <Shell y={0.33} top={0.215} bot={0.188} h={0.5} c={OF.shirt} />
        {/* 어깨선 (둥글게) */}
        <mesh position-y={0.555} scale={[1.55, 0.42, 0.95]}>
          <sphereGeometry args={[0.145, 16, 10]} />
          <M c={OF.shirt} />
        </mesh>
        {/* 견장 */}
        {[-1, 1].map((sd) => (
          <group key={sd} position={[0.16 * sd, 0.598, 0]} rotation-z={-0.2 * sd}>
            <B p={[0, 0, 0]} s={[0.12, 0.016, 0.075]} c={OF.shirtDark} />
            <mesh position={[0.045 * sd, 0.01, 0]}>
              <sphereGeometry args={[0.011, 8, 6]} />
              <M c={OF.gold} m={0.8} r={0.25} />
            </mesh>
          </group>
        ))}
        {/* 형광 반사 조끼 */}
        <Shell y={0.3} top={0.228} bot={0.204} h={0.38} c={OF.vest} r={0.55} e={0.12} />
        {/* 반사띠 두 줄 */}
        <Shell y={0.2} top={0.217} bot={0.214} h={0.034} c={OF.reflect} r={0.22} m={0.55} e={0.18} open />
        <Shell y={0.375} top={0.226} bot={0.223} h={0.034} c={OF.reflect} r={0.22} m={0.55} e={0.18} open />
        {/* 등판 POLICE */}
        <mesh position={[0, 0.29, -0.142]} rotation-y={Math.PI}>
          <planeGeometry args={[0.3, 0.084]} />
          <meshStandardMaterial map={back} roughness={0.55} emissive="#c9f02b" emissiveIntensity={0.06} />
        </mesh>
        {/* 가슴: 흉장(한쪽) · 명찰·경찰 글씨(반대쪽) */}
        <group position={[-0.095, 0.44, 0.15]}>
          <mesh rotation-x={Math.PI / 2}>
            <cylinderGeometry args={[0.034, 0.03, 0.008, 6]} />
            <M c={OF.gold} m={0.85} r={0.22} e={0.15} />
          </mesh>
          <mesh position-z={0.006}>
            <sphereGeometry args={[0.014, 8, 6]} />
            <M c="#1c3d8c" m={0.4} r={0.3} />
          </mesh>
        </group>
        <mesh position={[0.095, 0.29, 0.145]} rotation-x={-0.04}>
          <planeGeometry args={[0.1, 0.05]} />
          <meshStandardMaterial map={chest} roughness={0.55} />
        </mesh>
        <mesh position={[0.095, 0.445, 0.152]}>
          <planeGeometry args={[0.09, 0.028]} />
          <meshStandardMaterial map={name} roughness={0.5} />
        </mesh>
        {/* 어깨 무전기 + 안테나 */}
        <group position={[0.155, 0.5, 0.135]} rotation-x={-0.15}>
          <B p={[0, 0, 0]} s={[0.05, 0.085, 0.032]} c="#1b1b1b" />
          <B p={[0, 0.012, 0.017]} s={[0.034, 0.03, 0.004]} c="#3b3b3b" />
          <mesh position={[0.015, 0.075, 0]}>
            <cylinderGeometry args={[0.006, 0.008, 0.07, 6]} />
            <M c="#111" />
          </mesh>
          <mesh position={[-0.012, 0.055, 0]}>
            <sphereGeometry args={[0.008, 6, 5]} />
            <meshBasicMaterial color="#ff3b3b" toneMapped={false} />
          </mesh>
        </group>
        {/* 근무벨트 + 버클 + 장구류 */}
        <Shell y={0.085} top={0.205} bot={0.203} h={0.06} c={OF.belt} r={0.35} m={0.1} />
        <B p={[0, 0.085, 0.133]} s={[0.07, 0.048, 0.014]} c={OF.gold} />
        <group position={[0.205, 0.02, 0.01]}>
          {/* 권총집 */}
          <B p={[0, -0.02, 0]} s={[0.055, 0.17, 0.095]} c="#151515" />
          <B p={[0, 0.085, -0.015]} s={[0.045, 0.06, 0.06]} c="#2a2320" />
        </group>
        <group position={[-0.2, 0.03, 0.05]} rotation={[0.2, 0, 0.12]}>
          {/* 경찰봉 */}
          <mesh position-y={-0.14}>
            <cylinderGeometry args={[0.016, 0.016, 0.38, 8]} />
            <M c="#0b0b0b" r={0.35} />
          </mesh>
        </group>
        {/* 수갑집 */}
        <B p={[0, 0.07, -0.142]} s={[0.09, 0.06, 0.04]} c="#161616" />
        {/* 목 + 셔츠 깃 */}
        <mesh position-y={0.62}>
          <cylinderGeometry args={[0.058, 0.064, 0.09, 12]} />
          <M c={skin} r={0.6} />
        </mesh>
        {[-1, 1].map((sd) => (
          <B key={sd} p={[0.045 * sd, 0.6, 0.055]} s={[0.07, 0.035, 0.04]} c={OF.shirt} r={[0.5, 0, 0.5 * sd]} />
        ))}
        {/* 머리 */}
        <group ref={headRef} position={[0, 0.68, 0]}>
          <mesh position={[0, 0.1, 0]} scale={[0.93, 1.06, 0.98]}>
            <sphereGeometry args={[0.14, 20, 16]} />
            <M c={skin} r={0.6} />
          </mesh>
          {/* 짧은 머리 (모자 밖으로 보이는 뒤·옆) */}
          <mesh position={[0, 0.105, -0.004]}>
            <sphereGeometry args={[0.145, 18, 12, Math.PI * 0.85, Math.PI * 1.3, Math.PI * 0.18, Math.PI * 0.42]} />
            <meshStandardMaterial color={hair} roughness={0.9} side={THREE.DoubleSide} />
          </mesh>
          {/* 귀 */}
          {[-1, 1].map((sd) => (
            <mesh key={sd} position={[0.13 * sd, 0.09, -0.005]} scale={[0.45, 1, 0.8]}>
              <sphereGeometry args={[0.035, 8, 6]} />
              <M c={skin} r={0.6} />
            </mesh>
          ))}
          {/* 눈·눈썹 */}
          {[-1, 1].map((sd) => (
            <group key={sd} position={[0.048 * sd, 0.115, 0.122]}>
              <mesh scale={[1.25, 0.8, 0.5]}>
                <sphereGeometry args={[0.019, 10, 8]} />
                <meshStandardMaterial color="#f4f1ea" roughness={0.3} />
              </mesh>
              <mesh position-z={0.008}>
                <sphereGeometry args={[0.011, 8, 6]} />
                <meshStandardMaterial color="#1a120c" roughness={0.2} />
              </mesh>
              <B p={[0, 0.034, 0.004]} s={[0.046, 0.011, 0.01]} c={hair} r={[0, 0, -0.12 * sd]} />
            </group>
          ))}
          {/* 코·입 */}
          <mesh position={[0, 0.07, 0.137]} rotation-x={Math.PI / 2}>
            <coneGeometry args={[0.018, 0.04, 8]} />
            <M c={skin} r={0.6} />
          </mesh>
          <B p={[0, 0.025, 0.128]} s={[0.048, 0.008, 0.01]} c="#7a3b32" />
          {/* 술래와 같은 경찰 모자 */}
          <group position={[0, 0.165, 0]}>
            <PoliceCap scale={1.22} />
          </group>
        </group>
        {arm(-1, armLRef, elbowLRef, false)}
        {arm(1, armRRef, elbowRRef, true)}
      </group>
    </>
  );
}

/** 강아지 */
export function Dog({ anim, look = 0 }: { anim: string; look?: number }) {
  const legs = [useRef<THREE.Group>(null), useRef<THREE.Group>(null), useRef<THREE.Group>(null), useRef<THREE.Group>(null)];
  const body = useRef<THREE.Group>(null);
  const tail = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const fur = ["#c68642", "#f5deb3", "#3b2f2f", "#8b5a2b", "#fff", "#d2b48c"][look % 6];
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const f = anim === "run" ? 16 : 9;
    const moving = anim === "walk" || anim === "run";
    legs.forEach((l, i) => {
      if (!l.current) return;
      l.current.rotation.x = moving ? Math.sin(t * f + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI / 2 : 0)) * (anim === "run" ? 0.8 : 0.45) : anim === "lie" || anim === "roll" ? (i < 2 ? -1.3 : 1.3) : anim === "sit" && i > 1 ? -1.2 : 0;
    });
    if (body.current) {
      body.current.position.y = anim === "lie" || anim === "roll" ? 0.2 : anim === "sit" ? 0.36 : 0.42 + (moving ? Math.abs(Math.sin(t * f)) * 0.04 : 0);
      body.current.rotation.x = anim === "sit" ? -0.5 : 0;
      body.current.rotation.z = anim === "roll" ? Math.sin(t * 3) * 1.4 : 0;
    }
    if (tail.current) tail.current.rotation.y = Math.sin(t * (moving ? 14 : 8)) * 0.6;
    if (head.current) head.current.rotation.y = moving ? 0 : Math.sin(t * 0.9) * 0.5;
  });
  return (
    <group ref={body} position={[0, 0.42, 0]}>
      <B p={[0, 0, 0]} s={[0.3, 0.28, 0.62]} c={fur} />
      <group ref={head} position={[0, 0.18, 0.36]}>
        <B p={[0, 0, 0]} s={[0.24, 0.24, 0.24]} c={fur} />
        <B p={[0, -0.04, 0.16]} s={[0.13, 0.11, 0.13]} c={fur} />
        <B p={[0, -0.01, 0.23]} s={[0.05, 0.04, 0.03]} c="#111" />
        <B p={[-0.12, 0.08, -0.02]} s={[0.05, 0.16, 0.1]} c="#5c3d2e" r={[0, 0, 0.3]} />
        <B p={[0.12, 0.08, -0.02]} s={[0.05, 0.16, 0.1]} c="#5c3d2e" r={[0, 0, -0.3]} />
        <B p={[-0.06, 0.05, 0.125]} s={[0.035, 0.035, 0.01]} c="#111" />
        <B p={[0.06, 0.05, 0.125]} s={[0.035, 0.035, 0.01]} c="#111" />
      </group>
      <group ref={tail} position={[0, 0.1, -0.31]}>
        <B p={[0, 0.06, -0.08]} s={[0.05, 0.05, 0.2]} c={fur} r={[0.6, 0, 0]} />
      </group>
      {(
        [
          [-0.1, 0.22],
          [0.1, 0.22],
          [-0.1, -0.22],
          [0.1, -0.22],
        ] as const
      ).map(([x, z], i) => (
        <group key={i} ref={legs[i]} position={[x, -0.1, z]}>
          <B p={[0, -0.14, 0]} s={[0.08, 0.3, 0.08]} c={fur} />
        </group>
      ))}
    </group>
  );
}

/** 고양이 */
export function Cat({ anim, look = 0 }: { anim: string; look?: number }) {
  const body = useRef<THREE.Group>(null);
  const tail = useRef<THREE.Group>(null);
  const legs = [useRef<THREE.Group>(null), useRef<THREE.Group>(null), useRef<THREE.Group>(null), useRef<THREE.Group>(null)];
  const fur = ["#ff9f43", "#222", "#ddd", "#8395a7", "#c8a27c"][look % 5];
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const moving = anim === "walk" || anim === "run";
    const f = anim === "run" ? 15 : 8;
    legs.forEach((l, i) => {
      if (l.current) l.current.rotation.x = moving ? Math.sin(t * f + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI / 2 : 0)) * 0.5 : anim === "loaf" ? (i < 2 ? -1.4 : 1.4) : 0;
    });
    if (body.current) {
      body.current.position.y = anim === "loaf" ? 0.14 : 0.27;
      body.current.scale.z = anim === "stretch" ? 1.25 + Math.sin(t * 2) * 0.05 : 1;
      body.current.rotation.x = anim === "stretch" ? 0.25 : 0;
    }
    if (tail.current) tail.current.rotation.z = Math.sin(t * 2.2) * 0.4;
  });
  return (
    <group ref={body} position={[0, 0.27, 0]}>
      <B p={[0, 0, 0]} s={[0.2, 0.18, 0.42]} c={fur} />
      <group position={[0, 0.12, 0.24]}>
        <B p={[0, 0, 0]} s={[0.19, 0.17, 0.17]} c={fur} />
        <B p={[-0.06, 0.12, 0]} s={[0.05, 0.08, 0.04]} c={fur} r={[0, 0, 0.3]} />
        <B p={[0.06, 0.12, 0]} s={[0.05, 0.08, 0.04]} c={fur} r={[0, 0, -0.3]} />
        <B p={[-0.045, 0.02, 0.09]} s={[0.03, 0.035, 0.01]} c="#9be564" />
        <B p={[0.045, 0.02, 0.09]} s={[0.03, 0.035, 0.01]} c="#9be564" />
      </group>
      <group ref={tail} position={[0, 0.05, -0.21]}>
        <B p={[0, 0.17, -0.03]} s={[0.04, 0.34, 0.04]} c={fur} r={[-0.3, 0, 0]} />
      </group>
      {(
        [
          [-0.07, 0.15],
          [0.07, 0.15],
          [-0.07, -0.15],
          [0.07, -0.15],
        ] as const
      ).map(([x, z], i) => (
        <group key={i} ref={legs[i]} position={[x, -0.07, z]}>
          <B p={[0, -0.1, 0]} s={[0.05, 0.2, 0.05]} c={fur} />
        </group>
      ))}
    </group>
  );
}

export function Vacuum({ anim }: { anim: string }) {
  const led = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (led.current) led.current.color.set(anim === "walk" && Math.sin(clock.elapsedTime * 6) > 0 ? "#22d3ee" : "#0e7490");
  });
  return (
    <group>
      <mesh position={[0, 0.06, 0]}>
        <cylinderGeometry args={[0.3, 0.3, 0.1, 24]} />
        <meshStandardMaterial color="#e5e7eb" roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.115, 0]}>
        <cylinderGeometry args={[0.22, 0.24, 0.02, 24]} />
        <meshStandardMaterial color="#374151" />
      </mesh>
      <mesh position={[0, 0.13, 0.15]}>
        <sphereGeometry args={[0.03, 8, 6]} />
        <meshBasicMaterial ref={led} color="#22d3ee" toneMapped={false} />
      </mesh>
    </group>
  );
}

export function Car({ look = 0, anim }: { look?: number; anim: string }) {
  const color = ["#d62828", "#1d4ed8", "#f5f5f5", "#065f46", "#f59e0b"][look % 5];
  const wheels = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (wheels.current && anim === "drive") wheels.current.children.forEach((w) => (w.rotation.x += dt * 12));
  });
  return (
    <group>
      <B p={[0, 0.55, 0]} s={[1.8, 0.6, 3.9]} c={color} />
      <B p={[0, 1.05, -0.2]} s={[1.6, 0.5, 2.0]} c="#a5d8ff" />
      <B p={[0, 1.31, -0.2]} s={[1.62, 0.04, 2.02]} c={color} />
      {[-0.6, 0.6].map((x) => (
        <mesh key={x} position={[x, 0.6, 1.96]}>
          <boxGeometry args={[0.35, 0.15, 0.04]} />
          <meshBasicMaterial color="#fff7cc" toneMapped={false} />
        </mesh>
      ))}
      {[-0.6, 0.6].map((x) => (
        <mesh key={`r${x}`} position={[x, 0.6, -1.96]}>
          <boxGeometry args={[0.35, 0.12, 0.04]} />
          <meshBasicMaterial color={anim === "stop" ? "#ff2d2d" : "#7f1d1d"} toneMapped={false} />
        </mesh>
      ))}
      <group ref={wheels}>
        {(
          [
            [-0.85, 1.3],
            [0.85, 1.3],
            [-0.85, -1.3],
            [0.85, -1.3],
          ] as const
        ).map(([x, z]) => (
          <mesh key={`${x}${z}`} position={[x, 0.32, z]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.32, 0.32, 0.22, 14]} />
            <meshStandardMaterial color="#111" />
          </mesh>
        ))}
      </group>
    </group>
  );
}
