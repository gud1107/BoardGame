import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Only the 지렁이 cover (`public/games/worm.svg`) needs this — every other
    // game's box art is a raster photo. The asset is a trusted local file we
    // authored ourselves (not user-uploaded), so the strict CSP below is
    // enough to keep next/image's optimizer from executing anything in it.
    dangerouslyAllowSVG: true,
    contentDispositionType: "attachment",
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
};

export default nextConfig;
