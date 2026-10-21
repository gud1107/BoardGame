"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

/**
 * First-person camera at my seat (+z side of a round table). Dragging the
 * canvas sideways looks around; letting go drifts back. `overview` lifts the
 * camera up and back for a view of the whole table (reveals / results).
 */
export default function FirstPersonCamera({ seatR, tableY, overview, seats, eyeLevel = false }: { seatR: number; tableY: number; overview: boolean; seats: number; eyeLevel?: boolean }) {
  const gl = useThree((s) => s.gl);
  const look = useRef(new THREE.Vector3(0, tableY, 0));
  const yaw = useRef(0);
  const yawTarget = useRef(0);
  useEffect(() => {
    const el = gl.domElement;
    let drag: { x: number; yaw: number } | null = null;
    const down = (e: PointerEvent) => {
      drag = { x: e.clientX, yaw: yawTarget.current };
    };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      yawTarget.current = Math.max(-1.4, Math.min(1.4, drag.yaw - ((e.clientX - drag.x) / (el.clientWidth || 1)) * 3));
    };
    const up = () => {
      drag = null;
      yawTarget.current = 0;
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    for (const ev of ["pointerup", "pointerleave", "pointercancel"] as const) el.addEventListener(ev, up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      for (const ev of ["pointerup", "pointerleave", "pointercancel"] as const) el.removeEventListener(ev, up);
    };
  }, [gl]);
  useFrame((frame) => {
    const cam = frame.camera as THREE.PerspectiveCamera;
    const portrait = frame.size.width / frame.size.height < 1;
    yaw.current += (yawTarget.current - yaw.current) * 0.12;
    const up = new THREE.Vector3(0, 1, 0);
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
