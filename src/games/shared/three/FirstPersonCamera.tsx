"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { FIRST_PERSON_LAYER, THIRD_PERSON_LAYER } from "./VrmPerson";

/** Where my eyes are in `fpv` (my seated VRM's head; TableScene seats me at `seatR - FPV_SEAT_IN`). */
export const FPV_SEAT_IN = 0.2;
const FPV_EYE_Y = 1.5;

/**
 * First-person camera at my seat (+z side of a round table). Dragging the
 * canvas sideways looks around; letting go drifts back. `overview` lifts the
 * camera up and back for a view of the whole table (reveals / results).
 *
 * `fpv`: sit inside my own head (Liar's Bar style) — my own VRM body and held
 * cards are in the scene (VrmPerson `firstPerson`). `fpv.pitch` is where the
 * eyes rest (0 = across the table, negative = down at my hand); a mouse can
 * also drag up/down, a touch drag only turns (vertical stays page scroll).
 */
export default function FirstPersonCamera({ seatR, tableY, overview, seats, eyeLevel = false, fpv }: { seatR: number; tableY: number; overview: boolean; seats: number; eyeLevel?: boolean; fpv?: { pitch: number } | null }) {
  const gl = useThree((s) => s.gl);
  const look = useRef(new THREE.Vector3(0, tableY, 0));
  const yaw = useRef(0);
  const yawTarget = useRef(0);
  const pitch = useRef(fpv?.pitch ?? 0);
  const pitchDrag = useRef(0);
  const inFpv = !!fpv;
  useEffect(() => {
    const el = gl.domElement;
    let drag: { x: number; y: number; yaw: number; mouse: boolean } | null = null;
    const down = (e: PointerEvent) => {
      drag = { x: e.clientX, y: e.clientY, yaw: yawTarget.current, mouse: e.pointerType === "mouse" };
    };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      const reach = inFpv ? 1.5 : 1.4;
      yawTarget.current = Math.max(-reach, Math.min(reach, drag.yaw - ((e.clientX - drag.x) / (el.clientWidth || 1)) * 3));
      if (inFpv && drag.mouse) pitchDrag.current = Math.max(-0.7, Math.min(0.5, -((e.clientY - drag.y) / (el.clientHeight || 1)) * 1.6));
    };
    const up = () => {
      drag = null;
      yawTarget.current = 0;
      pitchDrag.current = 0;
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    for (const ev of ["pointerup", "pointerleave", "pointercancel"] as const) el.addEventListener(ev, up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      for (const ev of ["pointerup", "pointerleave", "pointercancel"] as const) el.removeEventListener(ev, up);
    };
  }, [gl, inFpv]);
  useFrame((frame) => {
    const cam = frame.camera as THREE.PerspectiveCamera;
    const portrait = frame.size.width / frame.size.height < 1;
    yaw.current += (yawTarget.current - yaw.current) * 0.12;
    const up = new THREE.Vector3(0, 1, 0);
    if (fpv && !overview) {
      // inside my head: my head-less body (first-person layer) shows, the full one doesn't
      cam.layers.enable(FIRST_PERSON_LAYER);
      cam.layers.disable(THIRD_PERSON_LAYER);
      const t = frame.clock.elapsedTime;
      pitch.current += (fpv.pitch + pitchDrag.current - pitch.current) * 0.1;
      // a breath of sway so the seat feels occupied, small enough not to swim
      cam.position.lerp(new THREE.Vector3(Math.sin(t * 0.7) * 0.004, FPV_EYE_Y + Math.sin(t * 1.3) * 0.003, seatR - FPV_SEAT_IN - 0.1), 0.2);
      const dir = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(1, 0, 0), pitch.current - 0.3).applyAxisAngle(up, yaw.current);
      look.current.copy(cam.position).add(dir);
      cam.lookAt(look.current);
      const fov = portrait ? 80 : 68;
      if (Math.abs(cam.fov - fov) > 0.05) {
        cam.fov += (fov - cam.fov) * 0.1;
        cam.updateProjectionMatrix();
      }
      return;
    }
    cam.layers.disable(FIRST_PERSON_LAYER);
    cam.layers.enable(THIRD_PERSON_LAYER);
    // narrow (portrait) canvases back off so the side seats stay in frame
    // and bigger tables pull back further so my immediate neighbours aren't cut off
    const extra = Math.max(0, 1.05 - frame.size.width / frame.size.height) * 3.4 + Math.max(0, seats - 4) * 0.45;
    // eyeLevel: sit at the table like a player (lifelike faces need to be seen up close, not from above)
    const pos = overview
      ? new THREE.Vector3(0, 3.1 + seatR * 0.2 + extra * 0.6, seatR + 1.5 + extra)
      : eyeLevel
        ? new THREE.Vector3(0, 1.95 + extra * 0.35, seatR + 0.95 + extra * 0.75)
        : new THREE.Vector3(0, 2.4 + extra * 0.5, seatR + 1.3 + extra);
    cam.position.lerp(pos.applyAxisAngle(up, yaw.current * 0.2), 0.08);
    const target = overview ? new THREE.Vector3(0, tableY + 0.2, -0.1) : eyeLevel ? new THREE.Vector3(0, tableY + 0.32, -0.35) : new THREE.Vector3(0, tableY + 0.45, -0.3);
    look.current.lerp(target.applyAxisAngle(up, yaw.current), 0.08);
    cam.lookAt(look.current);
    const fov = (portrait ? 74 : frame.size.width / frame.size.height < 1.3 ? 64 : 58) - (eyeLevel && !overview ? 2 : 0);
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov += (fov - cam.fov) * 0.1;
      cam.updateProjectionMatrix();
    }
  });
  return null;
}
