/**
 * The pill-shaped drag affordance shown at the top of a mobile bottom sheet
 * (`Overlay.tsx`/`ChatDrawer.tsx`/`BettingSidebar.tsx`). Purely visual — the
 * actual drag tracking lives in `useSwipeToDismiss`, attached to a
 * surrounding drag zone that includes this handle plus the header row, so
 * dragging from either the bar or the title works. Hidden at `sm` and up
 * since desktop layouts (centered modal / side drawer) don't use the
 * swipe-down gesture.
 */
export default function DragHandle() {
  return (
    <div className="mb-2 flex justify-center sm:hidden">
      <div className="h-1 w-9 shrink-0 rounded-full bg-white/25" />
    </div>
  );
}
