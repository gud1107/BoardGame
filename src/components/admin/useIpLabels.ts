"use client";

import { useCallback, useEffect, useState } from "react";
import { adminRpc, type IpLabel, type IpLabelMap } from "./adminApi";

/**
 * The admin's IP names, loaded once for the whole hub so every tab shows
 * "🏷️ 철수네 집" instead of a bare IP. `reload` after saving a label.
 * Empty until supabase/admin_ip_labels.sql has been run.
 */
export function useIpLabels(): { labels: IpLabelMap; reload: () => void } {
  const [labels, setLabels] = useState<IpLabelMap>(() => new Map());
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      adminRpc<IpLabel>("admin_list_ip_labels", {}),
      // 🔔 switches — absent until supabase/admin_alerts.sql has run.
      adminRpc<{ ip: string; alert: boolean }>("admin_ip_alert_flags", {}),
    ]).then(([result, flags]) => {
      if (cancelled || "error" in result) return;
      const alertByIp = new Map("error" in flags ? [] : flags.data.map((f) => [f.ip, f.alert]));
      setLabels(new Map(result.data.map((l) => [l.ip, { ...l, alert: alertByIp.get(l.ip) }])));
    });
    return () => {
      cancelled = true;
    };
  }, [version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { labels, reload };
}
