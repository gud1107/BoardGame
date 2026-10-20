import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getPosterImage } from "./posterImages";
import { getPosterVideo, POSTER_VIDEO_ID_LIST } from "./posterVideos";

const publicDir = join(process.cwd(), "public");
const highlights = JSON.parse(
  readFileSync(join(process.cwd(), "scripts", "poster-videos", "highlights.json"), "utf8"),
) as Record<string, unknown>;

describe("poster hover videos", () => {
  it.each(POSTER_VIDEO_ID_LIST.map((id) => [id]))("%s has both files, a still poster and a recorded highlight", (id) => {
    const video = getPosterVideo(id);
    expect(video).not.toBeNull();
    expect(existsSync(join(publicDir, video!.webm))).toBe(true);
    expect(existsSync(join(publicDir, video!.mp4))).toBe(true);
    // The clip fades in over the still capture, so the card needs one.
    expect(getPosterImage(id)).not.toBeNull();
    expect(highlights[id]).toBeDefined();
  });
});
