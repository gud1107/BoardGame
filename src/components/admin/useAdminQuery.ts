"use client";

import { useEffect, useState } from "react";

/**
 * Runs `load` whenever `key` changes (period, exclude toggle, reload
 * counter …) and exposes its rows or error. Stale responses from an older
 * key are dropped.
 */
export function useAdminQuery<T>(
  load: () => Promise<{ data: T[] } | { error: string }>,
  key: string,
): { data: T[] | null; error: string | null } {
  const [state, setState] = useState<{ key: string; data: T[] | null; error: string | null }>({
    key: "",
    data: null,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    void load().then((result) => {
      if (cancelled) return;
      if ("error" in result) setState({ key, data: null, error: result.error });
      else setState({ key, data: result.data, error: null });
    });
    return () => {
      cancelled = true;
    };
    // `load` is recreated every render; `key` is what identifies the query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // While a new key is loading, show nothing rather than the old rows.
  if (state.key !== key) return { data: null, error: null };
  return { data: state.data, error: state.error };
}
