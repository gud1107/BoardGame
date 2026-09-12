/**
 * Player-count filter chips ("전체"/"2인"/"3~4인"/"5~7인"/"8인") shared between
 * the mobile/tablet catalog (`src/app/page.tsx`) and the xl+ desktop
 * dashboard (`src/components/lobby/DesktopDashboard.tsx`) — extracted
 * 2026-09-12 so both surfaces filter identically instead of drifting. The
 * desktop dashboard briefly lost this filter entirely when it was rebuilt
 * into a single full-width grid (its header only kept a text search input);
 * this file exists so restoring it there doesn't mean duplicating the
 * label/test-fn list by hand.
 */
export const PLAYER_FILTERS = [
  { label: "전체", test: () => true },
  { label: "2인", test: (min: number, max: number) => min <= 2 && max >= 2 },
  { label: "3~4인", test: (min: number, max: number) => min <= 4 && max >= 3 },
  { label: "5~7인", test: (min: number, max: number) => min <= 7 && max >= 5 },
  { label: "8인", test: (min: number, max: number) => min <= 8 && max >= 8 },
];
