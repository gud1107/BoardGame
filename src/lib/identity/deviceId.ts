import { v4 as uuid } from "uuid";

const STORAGE_KEY = "bg_device_id";

/**
 * Stable per-browser identifier, persisted in localStorage. This is the
 * primary signal for mapping "the same person" across days on one device —
 * combined with IP (when Supabase is configured) and manual user
 * confirmation for cross-device matching. See `resolvePlayerIdentity`.
 */
export function getDeviceId(): string {
  if (typeof window === "undefined") {
    throw new Error("getDeviceId() can only be called in the browser");
  }
  let id = window.localStorage.getItem(STORAGE_KEY);
  if (!id) {
    id = uuid();
    window.localStorage.setItem(STORAGE_KEY, id);
  }
  return id;
}
