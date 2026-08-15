/**
 * The 페루도 face (die value 1) — redesigned as a domed, split-wing "ladybug"
 * medallion (rounded body, a small head wedge on top, a center split line
 * down the middle, and a scatter of round spots on each wing) to match the
 * physical die photographed in `boardGameRule/페루도/페루도모양.jpg` (a white
 * mark on the red face reads as a beetle/ladybug silhouette, not the
 * skull/mask this icon used before that photo was available). Drawn as a
 * single even-odd path — the body is one solid blob, and the split line +
 * spots are subtracted "holes" punched through it — so it stays a flat
 * two-tone mark that shows the surface behind it (die red, badge dark, etc.)
 * rather than needing to know that color up front. A good-faith stylized
 * recreation of the general iconographic impression, not a pixel trace of
 * any photo. `currentColor`-driven so callers control color via a
 * text-color class — reused on the die face (white-on-red), the face
 * picker, the bid track's watermark tiles, the stats panel, and the
 * rulebook (see PerudoBoard.tsx / RulebookModal.tsx). `drawPerudoMark` in
 * `dice3d/diceTexture.ts` is a 1:1 canvas port of this same path.
 */
export default function PerudoFaceIcon({ className = "h-full w-full" }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        fill="currentColor"
        d="M50,14 C70,14 85,32 85,55 C85,76 69,90 50,90 C31,90 15,76 15,55 C15,32 30,14 50,14 Z
           M50,3 L41,15 L59,15 Z
           M46.5,16 L53.5,16 L53.5,87 L46.5,87 Z
           M36,40 A6,6 0 1,0 24,40 A6,6 0 1,0 36,40 Z
           M31.5,63 A5.5,5.5 0 1,0 20.5,63 A5.5,5.5 0 1,0 31.5,63 Z
           M44.5,76 A4.5,4.5 0 1,0 35.5,76 A4.5,4.5 0 1,0 44.5,76 Z
           M76,40 A6,6 0 1,0 64,40 A6,6 0 1,0 76,40 Z
           M79.5,63 A5.5,5.5 0 1,0 68.5,63 A5.5,5.5 0 1,0 79.5,63 Z
           M64.5,76 A4.5,4.5 0 1,0 55.5,76 A4.5,4.5 0 1,0 64.5,76 Z"
      />
    </svg>
  );
}
