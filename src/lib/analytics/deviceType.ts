import type { DeviceType } from "./types";

/**
 * Coarse device-type classification from a User-Agent string, for the
 * `site_visit_log.device_type` column. Deliberately simple (no external
 * UA-parsing dependency) — this only needs to answer "phone, tablet, or
 * desktop" for the admin dashboard, not full device/browser detection.
 */
export function detectDeviceType(userAgent: string | null | undefined): DeviceType {
  if (!userAgent) return "unknown";
  const ua = userAgent.toLowerCase();
  // iPadOS 13+ Safari reports as "Macintosh" with touch support, which no
  // UA-string check can see — this is the same best-effort ceiling every
  // UA-based device check has, not something worth working around here.
  if (/ipad|tablet|(android(?!.*mobile))/.test(ua)) return "tablet";
  if (/mobile|iphone|ipod|android|windows phone/.test(ua)) return "mobile";
  return "desktop";
}
