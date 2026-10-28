"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import FirstPersonCamera, { FPV_SEAT_IN } from "./FirstPersonCamera";
import { holdsInMood, type HatKind, type PersonLook, type PersonMood } from "./SeatedPerson";
import { useCameraView } from "./viewPref";
import { resolveLook, type AvatarProfile } from "@/lib/character/avatar";
import { useRoomCharacter } from "@/lib/character/roomCharacters";
import VrmPerson, { VRM_NAME_Y } from "./VrmPerson";
import ScreenSprite from "./ScreenSprite";
import SpeechBubble from "./SpeechBubble";
import { AdaptiveResolution, BlobShadow, PerfHud, PostFx, StudioEnvironment } from "./sceneFx";
import { labelTexture, polar, seatAngle, type BubbleStyle } from "./tableKit";
import { personaFor } from "./persona";
import { nextEmotionLine, speakEmotion } from "@/lib/audio/characterVoice";

/**
 * The shared "real people around a table" scene for the card / social
 * games that sit everyone at one round table (달무티, 마피아, 페루도, 아발론,
 * 쿠). The game hands in already-filtered display data per seat — mood,
 * gaze, bubble, tags, and whatever sits on the table in front of them — plus
 * a themed environment and a centrepiece; this file owns the table, chairs,
 * people, name tags, turn ring, click-to-pick, lights and the first-person
 * camera. It never sees hidden state, so it can't leak it.
 *
 * Coordinates: the viewer sits at +z (angle 0) and has no body (first
 * person) — unless `firstPerson` is on: then my own VRM sits in my chair,
 * holding `firstPerson.held`, and the camera looks out of its head.
 * `front` children are placed on the table in front of their seat
 * in a local frame where +z points toward that seat's player and y = 0 is
 * the table top.
 */

export interface TableGeo {
  n: number;
  viewerSeat: number;
  seatR: number;
  tableR: number;
  tableY: number;
  angleOf: (seat: number) => number;
  /** Point on the table top in front of `seat`, `inset` in from the edge. */
  spotOf: (seat: number, inset?: number) => THREE.Vector3;
  /** Head position (the viewer's is the camera's neighbourhood). */
  headOf: (seat: number) => THREE.Vector3;
}

const GeoContext = createContext<TableGeo | null>(null);
/** Same as `useTableGeo`, but null outside a `TableScene` instead of throwing. */
export function useTableGeoOptional(): TableGeo | null {
  return useContext(GeoContext);
}

/** Seat geometry for centrepieces / extras rendered inside a `TableScene`. */
export function useTableGeo(): TableGeo {
  const g = useContext(GeoContext);
  if (!g) throw new Error("useTableGeo outside TableScene");
  return g;
}

export const TABLE_Y = 0.92;
const HEAD_Y = 1.52;

export function tableDims(n: number, lifelike = false) {
  // face-to-face duels sit closer so the opponent isn't a speck across an empty table
  const seatR = n <= 2 ? 1.9 : n === 3 ? 2.1 : 2.3 + Math.max(0, n - 4) * 0.3;
  // life-size people next to a table sized for the big-headed rig look tiny — pull everyone in
  const r = lifelike ? Math.max(1.6, seatR * 0.82) : seatR;
  return { seatR: r, tableR: r - 0.72 };
}

export interface TableSeat {
  seat: number;
  name: string;
  /** Second, smaller tag line under the name (coins, dice, hand size …). */
  sub?: string | null;
  mood: PersonMood;
  /** Seat to look at, "center" for the table, null for straight ahead / default. */
  lookSeat?: number | "center" | null;
  out?: boolean;
  /** Pulsing turn ring on the table in front of this seat. */
  active?: boolean;
  /** Coloured floor ring around the chair (selection, team …). */
  ring?: string | null;
  bubble?: { text: string; style: BubbleStyle; key: string; width?: number } | null;
  /** A badge above the name (🎭 라이어, 👑 리더 …). */
  tag?: { text: string; color: string; bg?: string } | null;
  hat?: HatKind;
  /** Explicit avatar override (sanitized). Missing → the character this seat's player chose in their profile (looked up by `name`), else the seat's default K-pop look. */
  avatar?: AvatarProfile | null;
  /** Game-specific look overrides, applied on top of the avatar (e.g. a role costume). */
  look?: Partial<PersonLook>;
  chair?: "wood" | "stool" | "throne";
  headSlot?: ReactNode;
  front?: ReactNode;
  /** Held in both hands in front of the chest instead of standing on the table (e.g. this seat's hand of cards, backs out). Same frame as `front`. */
  held?: ReactNode;
  /** Overrides the theme's seat colour (name tag, tie, my placard). */
  color?: string;
  /** 연결 끊김 — the name tag gets a 📴 mark. */
  away?: boolean;
  /** Click/tap the person (or the viewer's placard) to pick this seat. */
  onSelect?: (() => void) | null;
}

export interface TableTheme {
  background: string;
  fog: [number, number];
  ambient: [string, number];
  hemi: [string, string, number];
  /** Extra directional fills: [color, intensity, x, y, z]. */
  fills: [string, number, number, number, number][];
  /** Hanging lamp above the table (the shadow caster). */
  lamp: { color: string; intensity: number; height: number } | null;
  table: { top: string; rim: string; felt: string; inlay: string; base: string; feltMap?: () => THREE.Texture };
  chair: "wood" | "stool" | "throne";
  chairColor: string;
  seatColors: string[];
  hats: HatKind[];
  /** Where the name tags sit on the head-local y axis. */
  nameY?: number;
  /** "realistic" = eye-level camera and closer seats; the players are VRoid models either way (unused since 2026-10-27). */
  personStyle?: "cartoon" | "realistic";
  /** Render polish: image-based light strength (0 = off) and bloom strength (0 = off). */
  fx?: { env?: number; bloom?: number };
}

export interface TableSceneProps {
  seatCount: number;
  viewerSeat: number;
  seats: TableSeat[];
  theme: TableTheme;
  environment?: ReactNode;
  /** Rendered at the table centre, y = table top. */
  center?: ReactNode;
  /** Free-form scene content (arrows, flying props) — may call `useTableGeo`. */
  extras?: ReactNode;
  overview: boolean;
  lowDetail: boolean;
  ringColor?: string;
  /** 0..1 multiplier for the hanging lamp (eases toward it), e.g. dimmed at night. */
  lampDim?: number;
  /** Moods that stay silent at this table (no voice line, no caption) — e.g. 텔레파시 bans talking. */
  quietMoods?: readonly PersonMood[];
  /**
   * Liar's Bar–style seat: my own body in my chair, holding `held` (keep `mood` one that holds
   * cards), the camera inside my head with its eyes resting at `pitch` (see FirstPersonCamera).
   * `frontShift` [right, toward me] moves my own `front` aside — right under my eyes, a tall
   * prop (페루도's cup) would wall off the middle of the table.
   * My name plate / tag / bubble are dropped — the board shows them in its own HUD.
   */
  firstPerson?: { held: ReactNode; pitch: number; mood: PersonMood; frontShift?: [number, number] } | null;
  /**
   * Table view, but with me in my chair too (seen from behind and above, over my own
   * shoulder): my whole body holding `held`. My name plate / tag stay on the table edge.
   */
  selfBody?: { held: ReactNode; mood: PersonMood } | null;
  /**
   * Let the scene own the camera choice: a "🎥 1인칭 | 🪑 테이블" switch in the canvas corner
   * (remembered under this key), my own body in my chair in both views. Ignored when the game
   * drives `firstPerson` / `selfBody` itself (5 오이).
   */
  cameraKey?: string;
  /** What my own body holds / how it sits under `cameraKey` (default: my seat's mood, empty hands). */
  selfView?: { held?: ReactNode; mood?: PersonMood; pitch?: number; frontShift?: [number, number] };
}

// ---------------------------------------------------------------------------

function Table({ tableR, theme, lowDetail }: { tableR: number; theme: TableTheme; lowDetail: boolean }) {
  const seg = lowDetail ? 32 : 72;
  const t = theme.table;
  const feltMap = useMemo(() => t.feltMap?.() ?? null, [t]);
  return (
    <group>
      <mesh position={[0, TABLE_Y - 0.06, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[tableR + 0.14, tableR + 0.1, 0.12, seg]} />
        <meshStandardMaterial color={t.rim} roughness={0.38} metalness={0.08} />
      </mesh>
      {/* rounded bull-nose edge */}
      <mesh position={[0, TABLE_Y - 0.005, 0]} rotation-x={Math.PI / 2}>
        <torusGeometry args={[tableR + 0.1, 0.035, 8, seg]} />
        <meshStandardMaterial color={t.rim} roughness={0.32} metalness={0.1} />
      </mesh>
      <mesh position={[0, TABLE_Y + 0.004, 0]} rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[tableR - 0.04, seg]} />
        <meshStandardMaterial color={feltMap ? "#ffffff" : t.felt} map={feltMap} roughness={0.96} />
      </mesh>
      <mesh position={[0, TABLE_Y + 0.006, 0]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[tableR - 0.12, tableR - 0.09, seg]} />
        <meshStandardMaterial color={t.inlay} roughness={0.5} metalness={0.6} />
      </mesh>
      <mesh position={[0, TABLE_Y + 0.006, 0]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.55, 0.57, seg]} />
        <meshStandardMaterial color={t.inlay} roughness={0.5} metalness={0.6} transparent opacity={0.6} />
      </mesh>
      <mesh position={[0, TABLE_Y / 2 - 0.05, 0]} castShadow>
        <cylinderGeometry args={[0.24, 0.42, TABLE_Y - 0.1, 20]} />
        <meshStandardMaterial color={t.base} roughness={0.55} />
      </mesh>
      <mesh position={[0, 0.04, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.75, 0.85, 0.08, 24]} />
        <meshStandardMaterial color={t.base} roughness={0.55} />
      </mesh>
      <BlobShadow radius={tableR + 0.35} y={0.008} opacity={0.75} />
    </group>
  );
}

/** Tall gilded throne back drawn behind a person whose own chair is "none". */
function Throne({ color }: { color: string }) {
  const gold = <meshStandardMaterial color="#d4a52c" metalness={0.85} roughness={0.3} />;
  return (
    <group>
      <mesh position={[0, 1.2, -0.38]} castShadow>
        <boxGeometry args={[0.86, 1.4, 0.1]} />
        <meshStandardMaterial color={color} roughness={0.85} />
      </mesh>
      <mesh position={[0, 1.95, -0.38]}>
        <coneGeometry args={[0.2, 0.32, 4]} />
        {gold}
      </mesh>
      {[-1, 1].map((s) => (
        <group key={s}>
          <mesh position={[0.45 * s, 1.15, -0.38]} castShadow>
            <boxGeometry args={[0.08, 1.5, 0.14]} />
            {gold}
          </mesh>
          <mesh position={[0.45 * s, 1.95, -0.38]}>
            <sphereGeometry args={[0.07, 12, 10]} />
            {gold}
          </mesh>
          <mesh position={[0.4 * s, 0.68, 0]}>
            <boxGeometry args={[0.08, 0.1, 0.62]} />
            {gold}
          </mesh>
        </group>
      ))}
      <mesh position={[0, 0.48, 0]} castShadow>
        <boxGeometry args={[0.8, 0.12, 0.68]} />
        <meshStandardMaterial color={color} roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.22, 0]}>
        <boxGeometry args={[0.76, 0.42, 0.6]} />
        <meshStandardMaterial color="#3b2412" roughness={0.6} />
      </mesh>
    </group>
  );
}

function TurnRing({ position, color }: { position: THREE.Vector3; color: string }) {
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  const mesh = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const p = Math.sin(clock.elapsedTime * 5);
    if (mat.current) mat.current.opacity = 0.55 + p * 0.3;
    mesh.current?.scale.setScalar(1 + p * 0.06);
  });
  return (
    <mesh ref={mesh} position={[position.x, TABLE_Y + 0.012, position.z]} rotation-x={-Math.PI / 2}>
      <ringGeometry args={[0.24, 0.31, 40]} />
      <meshBasicMaterial ref={mat} color={color} transparent opacity={0.8} depthWrite={false} />
    </mesh>
  );
}

function FloorRing({ color }: { color: string }) {
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (mat.current) mat.current.opacity = 0.5 + Math.sin(clock.elapsedTime * 3.2) * 0.2;
  });
  return (
    <mesh position={[0, 0.02, 0]} rotation-x={-Math.PI / 2}>
      <ringGeometry args={[0.5, 0.62, 40]} />
      <meshBasicMaterial ref={mat} color={color} transparent opacity={0.6} depthWrite={false} />
    </mesh>
  );
}

let haloTex: THREE.Texture | null = null;
function haloTexture(): THREE.Texture {
  if (haloTex) return haloTex;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 30, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,0)");
  grad.addColorStop(0.55, "rgba(255,255,255,0.9)");
  grad.addColorStop(0.75, "rgba(255,255,255,0.5)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  haloTex = new THREE.CanvasTexture(c);
  return haloTex;
}

/**
 * For ~3 s after a seat's bubble pops, a halo in the seat colour pulses behind the speaker's
 * head, so a "이 트릭은 내 거!" across the table is tied to a face, not to a card in the middle.
 * A sprite at head height (a floor ring hid behind the table for the far seats).
 */
function SpeakerPulse({ color, popKey, y, size = 0.75 }: { color: string; popKey: string; y: number; size?: number }) {
  const ref = useRef<THREE.Sprite>(null);
  const born = useRef({ key: "", at: 0 });
  const map = useMemo(() => haloTexture(), []);
  useFrame(({ clock }) => {
    const s = ref.current;
    if (!s) return;
    if (born.current.key !== popKey) born.current = { key: popKey, at: clock.elapsedTime };
    const t = clock.elapsedTime - born.current.at;
    s.visible = t < 3;
    const ph = (t * 1.4) % 1;
    s.scale.setScalar(size * (0.8 + ph * 0.6));
    (s.material as THREE.SpriteMaterial).opacity = (1 - ph) * 0.9 * Math.min(1, 3 - t);
  });
  return (
    <sprite ref={ref} position={[0, y, -0.05]} visible={false}>
      <spriteMaterial map={map} color={color} transparent depthWrite={false} opacity={0} />
    </sprite>
  );
}

/** Caption for a voiced reaction (characterVoice.ts): light and italic-feeling, so it reads as an aside, not a game call. */
const EMOTE_STYLE: BubbleStyle = { bg: "rgba(255,255,255,0.93)", fg: "#3f3f46", border: "#a1a1aa", size: 48 };

/** Pointer handlers that ignore drags (the canvas drag looks around). */
function useSelect(onSelect: (() => void) | null | undefined) {
  const [hover, setHover] = useState(false);
  if (!onSelect) return { hover: false, handlers: {} };
  return {
    hover,
    handlers: {
      onClick: (e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        if (e.delta > 8) return;
        onSelect();
      },
      onPointerOver: (e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        setHover(true);
        document.body.style.cursor = "pointer";
      },
      onPointerOut: () => {
        setHover(false);
        document.body.style.cursor = "";
      },
    },
  };
}

function SeatView({ s, geo, theme, lowDetail, ringColor, quietMoods, firstPerson, selfBody }: { s: TableSeat; geo: TableGeo; theme: TableTheme; lowDetail: boolean; ringColor: string; quietMoods?: readonly PersonMood[]; firstPerson?: TableSceneProps["firstPerson"]; selfBody?: TableSceneProps["selfBody"] }) {
  const angle = geo.angleOf(s.seat);
  const isViewer = s.seat === geo.viewerSeat;
  const color = s.color ?? theme.seatColors[s.seat % theme.seatColors.length];
  const { hover, handlers } = useSelect(s.onSelect);
  const chosen = useRoomCharacter(s.name);
  const look = useMemo(() => {
    const base = resolveLook(s.seat, theme.hats, s.avatar ?? chosen);
    return { ...base, ...(s.hat ? { hat: s.hat } : {}), ...s.look };
  }, [s.seat, s.hat, s.avatar, chosen, s.look, theme.hats]);
  const lookAt = s.lookSeat === "center" ? new THREE.Vector3(0, TABLE_Y, 0) : s.lookSeat === null || s.lookSeat === undefined ? null : geo.headOf(s.lookSeat);
  const nameY = theme.nameY ?? (theme.personStyle === "realistic" ? 1.86 : VRM_NAME_Y);
  // bubble bottom edge (SpeechBubble centres itself above it when anchored)
  const bubbleY = nameY + (s.tag ? 0.34 : 0.14);
  const labelBase = nameY - (s.sub ? 0.29 : 0.11);
  const frontSpot = geo.spotOf(s.seat, isViewer ? 0.45 : 0.38);
  const chair = s.chair ?? theme.chair;
  const Person = VrmPerson;
  // the game turning this person's mood emotional is their cue to say something, in their own
  // voice and words (characterVoice.ts); never on first mount, never for my own seat
  // the same line shows as a short caption bubble, so it reaches players with the sound off too
  const prevMood = useRef(s.mood);
  const lastLine = useRef(-Infinity);
  const [emote, setEmote] = useState<{ text: string; key: string } | null>(null);
  useEffect(() => {
    if (prevMood.current === s.mood) return;
    prevMood.current = s.mood;
    if (isViewer || s.out || quietMoods?.includes(s.mood)) return;
    const now = performance.now();
    if (now - lastLine.current < 2500) return;
    const text = nextEmotionLine(s.seat, s.mood, personaFor(s.seat));
    if (!text) return;
    lastLine.current = now;
    speakEmotion({ seat: s.seat, mood: s.mood, persona: personaFor(s.seat), gender: look.gender, text });
    const key = `${s.seat}:${now}`;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a timed caption triggered by a prop change
    setEmote({ text, key });
    const t = window.setTimeout(() => setEmote((e) => (e?.key === key ? null : e)), 2400);
    return () => window.clearTimeout(t);
  }, [s.mood, s.seat, s.out, isViewer, look.gender, quietMoods]);
  // a game bubble always wins the spot above the head
  const shownBubble = useMemo(() => s.bubble ?? (emote ? { text: emote.text, style: EMOTE_STYLE, key: emote.key, width: 0.8 } : null), [s.bubble, emote]);
  // every bubble carries its speaker: a name tab in the seat colour (and a matching border)
  const bubbleStyle = useMemo(() => (shownBubble ? { ...shownBubble.style, who: isViewer ? "나" : s.name, whoColor: color } : null), [shownBubble, isViewer, s.name, color]);

  return (
    <group>
      {s.front && (
        <group position={frontSpot} rotation-y={angle}>
          <group position={isViewer && firstPerson?.frontShift ? [firstPerson.frontShift[0], 0, firstPerson.frontShift[1]] : [0, 0, 0]}>{s.front}</group>
        </group>
      )}
      {s.active && <TurnRing position={geo.spotOf(s.seat, 0.16)} color={ringColor} />}
      {isViewer && firstPerson ? (
        <Person
          seed={s.seat * 7 + 3}
          look={look}
          color={color}
          position={polar(angle, geo.seatR - FPV_SEAT_IN)}
          facing={angle + Math.PI}
          mood={firstPerson.mood}
          lookAt={null}
          out={s.out}
          lowDetail={lowDetail}
          chair={chair === "throne" ? "wood" : chair}
          chairColor={theme.chairColor}
          persona="focused"
          held={firstPerson.held}
          firstPerson
        />
      ) : isViewer ? (
        <group>
        {selfBody && (
          <Person
            seed={s.seat * 7 + 3}
            look={look}
            color={color}
            position={polar(angle, geo.seatR)}
            facing={angle + Math.PI}
            mood={selfBody.mood}
            lookAt={null}
            out={s.out}
            lowDetail={lowDetail}
            // a backrest right under the camera would wall off the bottom of the view
            chair="stool"
            chairColor={theme.chairColor}
            persona="focused"
            held={selfBody.held}
          />
        )}
        <group position={geo.spotOf(s.seat, 0.08).toArray()} rotation-y={angle}>
          {/* my placard — tap target for picking myself */}
          <group {...handlers} position={[0, 0.06, 0]} rotation-x={-0.5}>
            <mesh>
              <boxGeometry args={[0.5, 0.12, 0.02]} />
              {/* dark rim-wood plate: with the environment map lit, a gold metal plate reads bright and swallows the name */}
              <meshStandardMaterial color={hover ? "#fde68a" : theme.table.rim} metalness={0.15} roughness={0.45} emissive={s.ring ?? "#000"} emissiveIntensity={s.ring ? 0.7 : 0} />
            </mesh>
            <mesh position={[0, 0, 0.012]}>
              <planeGeometry args={[0.48, 0.12]} />
              <meshBasicMaterial map={labelTexture(`${s.name} (나)`, color)} transparent />
            </mesh>
          </group>
          {/* with the low lifelike camera, keep my own tag on the table so it doesn't cover faces opposite */}
          {s.tag && <ScreenSprite position={theme.personStyle === "realistic" ? [0, 0.1, 0.12] : [0, 0.45, -0.1]} scale={theme.personStyle === "realistic" ? [0.5, 0.125] : [0.66, 0.165]} map={labelTexture(s.tag.text, s.tag.color, { bg: s.tag.bg })} />}
          {s.bubble && bubbleStyle && <SpeechBubble text={s.bubble.text} style={bubbleStyle} y={0.82} popKey={s.bubble.key} width={Math.max(0.62, s.bubble.width ?? 0.9)} />}
          {s.bubble && <SpeakerPulse color={color} popKey={s.bubble.key} y={0.3} size={0.5} />}
        </group>
        </group>
      ) : (
        <group {...handlers}>
          <group position={polar(angle, geo.seatR - 0.12)}>
            <BlobShadow radius={0.62} y={0.01} opacity={s.out ? 0.5 : 0.85} />
          </group>
          {chair === "throne" && (
            <group position={polar(angle, geo.seatR)} rotation-y={angle + Math.PI}>
              <Throne color={theme.chairColor} />
            </group>
          )}
          <Person
            seed={s.seat * 7 + 3}
            look={look}
            color={color}
            position={polar(angle, geo.seatR)}
            facing={angle + Math.PI}
            mood={s.mood}
            lookAt={lookAt}
            out={s.out}
            lowDetail={lowDetail}
            chair={chair === "throne" ? "none" : chair}
            chairColor={theme.chairColor}
            headSlot={s.headSlot}
            persona={personaFor(s.seat)}
            viewerAt={geo.headOf(geo.viewerSeat)}
            held={s.held}
          >
            {(s.ring || hover) && <FloorRing color={hover && !s.ring ? "#fde68a" : (s.ring ?? "#fde68a")} />}
            {/* the stack (sub · name · tag · bubble) grows as one block with distance */}
            <ScreenSprite anchorY={labelBase} position={[0, nameY, 0]} scale={[0.86, 0.21]} map={labelTexture(s.away ? `📴 ${s.name}` : s.name, s.away ? "#71717a" : color)} />
            {s.sub && <ScreenSprite anchorY={labelBase} position={[0, nameY - 0.2, 0]} scale={[0.7, 0.175]} map={labelTexture(s.sub, color, { bg: "rgba(0,0,0,0.75)" })} />}
            {s.tag && <ScreenSprite anchorY={labelBase} position={[0, nameY + 0.22, 0]} scale={[0.7, 0.175]} map={labelTexture(s.tag.text, s.tag.color, { bg: s.tag.bg ?? "rgba(20,10,10,0.85)" })} />}
            {shownBubble && bubbleStyle && <SpeechBubble anchorY={labelBase} text={shownBubble.text} style={bubbleStyle} y={bubbleY} popKey={shownBubble.key} width={Math.max(0.62, shownBubble.width ?? 1.0)} />}
            {shownBubble && <SpeakerPulse color={color} popKey={shownBubble.key} y={theme.personStyle === "realistic" ? 1.52 : 1.5} size={theme.personStyle === "realistic" ? 0.55 : 0.8} />}
          </Person>
          {/* generous invisible hit box so a tap on the chair area counts too */}
          {s.onSelect && (
            <mesh position={polar(angle, geo.seatR, 1.0)}>
              <boxGeometry args={[0.9, 2.0, 0.9]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
            </mesh>
          )}
        </group>
      )}
    </group>
  );
}

function Lamp({ lamp, lowDetail, dim }: { lamp: NonNullable<TableTheme["lamp"]>; lowDetail: boolean; dim: number }) {
  const light = useRef<THREE.PointLight>(null);
  const level = useRef(dim);
  useFrame(({ clock }, dt) => {
    level.current += (dim - level.current) * (1 - Math.exp(-dt * 1.4));
    if (light.current) light.current.intensity = (lamp.intensity + Math.sin(clock.elapsedTime * 2.1) * lamp.intensity * 0.025) * level.current;
  });
  return (
    <pointLight
      ref={light}
      position={[0, lamp.height, 0]}
      color={lamp.color}
      intensity={lamp.intensity}
      distance={14}
      decay={2}
      castShadow={!lowDetail}
      shadow-mapSize-width={1024}
      shadow-mapSize-height={1024}
      shadow-bias={-0.002}
    />
  );
}

function SceneContents(props: TableSceneProps) {
  const { seatCount: n, viewerSeat, theme, lowDetail } = props;
  const geo = useMemo<TableGeo>(() => {
    const { seatR, tableR } = tableDims(n, theme.personStyle === "realistic");
    const angleOf = (seat: number) => seatAngle(seat, viewerSeat, n);
    return {
      n,
      viewerSeat,
      seatR,
      tableR,
      tableY: TABLE_Y,
      angleOf,
      spotOf: (seat, inset = 0.4) => polar(angleOf(seat), tableR - inset, TABLE_Y),
      headOf: (seat) => (seat === viewerSeat ? new THREE.Vector3(0, 1.9, seatR + 0.6) : polar(angleOf(seat), seatR - 0.05, HEAD_Y)),
    };
  }, [n, viewerSeat, theme.personStyle]);
  const env = theme.fx?.env ?? 0.42;
  const envOn = env > 0;

  return (
    <GeoContext.Provider value={geo}>
      <color attach="background" args={[theme.background]} />
      <fog attach="fog" args={[theme.background, theme.fog[0], theme.fog[1]]} />
      {/* the environment map now supplies soft fill, so the flat ambient term is trimmed to keep each theme's mood */}
      {envOn && <StudioEnvironment intensity={env} />}
      <ambientLight color={theme.ambient[0]} intensity={theme.ambient[1] * (envOn ? 0.65 : 1)} />
      <hemisphereLight args={theme.hemi} />
      {theme.fills.map(([c, i, x, y, z], k) => (
        <directionalLight key={k} color={c} intensity={i} position={[x, y, z]} />
      ))}
      {theme.lamp && <Lamp lamp={theme.lamp} lowDetail={lowDetail} dim={props.lampDim ?? 1} />}
      {props.environment}
      <Table tableR={geo.tableR} theme={theme} lowDetail={lowDetail} />
      <group position={[0, TABLE_Y, 0]}>{props.center}</group>
      {props.seats.map((s) => (
        <SeatView key={s.seat} s={s} geo={geo} theme={theme} lowDetail={lowDetail} ringColor={props.ringColor ?? "#fbbf24"} quietMoods={props.quietMoods} firstPerson={props.firstPerson} selfBody={props.selfBody} />
      ))}
      {props.extras}
      {theme.personStyle === "realistic" && (
        // a soft key light from my side so faces across the table read clearly
        <directionalLight position={[0, 2.6, geo.seatR + 2]} intensity={0.9} color="#fff4e6" />
      )}
      <FirstPersonCamera seatR={geo.seatR} tableY={TABLE_Y} overview={props.overview} seats={n} eyeLevel={theme.personStyle === "realistic"} fpv={props.firstPerson ? { pitch: props.firstPerson.pitch } : null} />
      <AdaptiveResolution />
      <PerfHud />
      {!lowDetail && <PostFx bloom={theme.fx?.bloom ?? 0.28} />}
    </GeoContext.Provider>
  );
}

/** The scene-owned camera switch + (first person) my own name / status, since my plate isn't in view. */
function CameraOverlay({ cam, me }: { cam: ReturnType<typeof useCameraView>; me: TableSeat | undefined }) {
  const status = cam.camera === "fpv" && me ? [me.sub, me.tag?.text].filter(Boolean).join(" · ") : "";
  return (
    <div className="pointer-events-none absolute top-1.5 left-1.5 z-10 flex max-w-[70%] flex-col items-start gap-1">
      <div role="group" aria-label="3D 시점" className="pointer-events-auto flex overflow-hidden rounded-full border border-white/20 bg-black/55 text-[10px] sm:text-[11px]">
        {(
          [
            ["fpv", "🎥 1인칭", "내 캐릭터의 눈으로 봐요"],
            ["table", "🪑 테이블", "내 자리 뒤·위에서 테이블 전체를 봐요"],
          ] as const
        ).map(([v, label, title]) => (
          <button
            key={v}
            type="button"
            title={title}
            aria-pressed={cam.camera === v}
            onClick={() => cam.setCamera(v)}
            className={`px-2 py-0.5 transition sm:px-2.5 sm:py-1 ${cam.camera === v ? "bg-white/20 font-semibold text-white" : "text-white/60 hover:text-white"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {cam.camera === "fpv" && me && (
        <span className="truncate rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white/85 sm:text-[11px]">
          🙋 {me.name} (나){status ? ` · ${status}` : ""}
        </span>
      )}
    </div>
  );
}

export default function TableScene(props: TableSceneProps) {
  const high = !props.lowDetail;
  // the scene owns the camera choice only when the game hasn't wired its own (5 오이 has)
  const managed = !!props.cameraKey && props.firstPerson === undefined && props.selfBody === undefined;
  const cam = useCameraView(props.cameraKey ?? "table-camera");
  const me = props.seats.find((x) => x.seat === props.viewerSeat);
  let { firstPerson, selfBody } = props;
  if (managed) {
    const held = props.selfView?.held ?? null;
    const mood = props.selfView?.mood ?? me?.mood ?? "rest";
    // inside my head my hands keep hold of whatever they hold (a cheer would drop it)
    const fpMood = held && !holdsInMood(mood) ? "rest" : mood;
    firstPerson = cam.camera === "fpv" ? { held, pitch: props.selfView?.pitch ?? 0, mood: fpMood, frontShift: props.selfView?.frontShift } : null;
    selfBody = cam.camera === "table" ? { held, mood } : null;
  }
  const canvas = (
    <Canvas
      shadows={high}
      // AdaptiveResolution picks the real ratio (≤ 2) and steps it down on a slow device;
      // MSAA stays on for phones too — it's cheap on tile GPUs and the tags/edges jagged without it
      dpr={[1, 2]}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      camera={{ fov: 58, position: [0, 2.4, 4.2], near: 0.05, far: 120 }}
      style={{ touchAction: "pan-y" }}
      onPointerMissed={() => {
        document.body.style.cursor = "";
      }}
    >
      <SceneContents {...props} firstPerson={firstPerson} selfBody={selfBody} />
    </Canvas>
  );
  if (!managed) return canvas;
  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {canvas}
      <CameraOverlay cam={cam} me={me} />
    </div>
  );
}
