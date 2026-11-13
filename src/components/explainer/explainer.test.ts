import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GAME_REGISTRY } from "@/games/registry";
import { getRoomRulebookSummary } from "@/constants/roomRulebookSummaries";
import { buildTimeline, chapterAt, cueSeconds, locate, speakable } from "./timeline";
import { ANIMATED_EXPLAINERS, getExplainerScript } from "./scripts";
import type { ExplainerScript } from "./types";

const tiny: ExplainerScript = {
  gameId: "x",
  title: "x",
  kind: "summary",
  chapters: [
    { title: "A", scenes: [{ cues: ["가나다라마바사아자차카타파하", "하나 둘"], render: () => null }] },
    { title: "B", scenes: [{ cues: ["셋"], render: () => null, tail: 2 }] },
  ],
};

describe("timeline", () => {
  it("lays cues back to back and chapters cover the whole duration", () => {
    const tl = buildTimeline(tiny);
    expect(tl.cues).toHaveLength(3);
    expect(tl.cues[1].start).toBeCloseTo(tl.cues[0].end);
    expect(tl.chapters[0].start).toBe(0);
    expect(tl.chapters[1].start).toBeCloseTo(tl.chapters[0].end);
    expect(tl.chapters[1].end).toBeCloseTo(tl.duration);
  });

  it("locates scene, cue and quiet tail", () => {
    const tl = buildTimeline(tiny);
    expect(locate(tl, 0).cueIndex).toBe(0);
    expect(locate(tl, tl.cues[1].start + 0.01).cueIndex).toBe(1);
    expect(locate(tl, tl.cues[2].start + 0.01)).toMatchObject({ sceneIndex: 1, cueIndex: 2, chapterIndex: 1 });
    // inside the 2s tail after the last cue
    expect(locate(tl, tl.duration - 0.5).cueIndex).toBe(-1);
    expect(locate(tl, 1e9).sceneIndex).toBe(1);
    expect(chapterAt(tl, tl.chapters[1].start + 0.1)).toBe(1);
  });

  it("gives longer lines more time and strips emoji for speech", () => {
    expect(cueSeconds("가".repeat(40))).toBeGreaterThan(cueSeconds("가나다"));
    expect(speakable("🎯 3~35 카드 ×2 (보너스)")).toBe("3에서 35 카드 곱하기 2 보너스");
  });
});

/** Render every scene at a spread of moments — catches crashes in any frame. */
function renderAll(script: ExplainerScript) {
  const tl = buildTimeline(script);
  const scenes = script.chapters.flatMap((c) => c.scenes);
  scenes.forEach((sc, i) => {
    const meta = tl.scenes[i];
    for (let k = 0; k <= 12; k++) {
      const t = (meta.dur * k) / 12;
      const loc = locate(tl, meta.start + Math.min(t, meta.dur - 1e-3));
      const node = sc.render({ t, dur: meta.dur, at: (n) => meta.cueStarts[Math.min(Math.max(n, 0), meta.cueStarts.length - 1)], cue: loc.sceneCue });
      renderToStaticMarkup(createElement(Fragment, null, node));
    }
  });
  return tl;
}

describe("explainer scripts", () => {
  const playable = GAME_REGISTRY.filter((g) => g.playable && !g.hiddenFromLobby);

  it("every game with a 30초 룰북 entry gets an explainer", () => {
    for (const g of playable) {
      if (!getRoomRulebookSummary(g.id) && !ANIMATED_EXPLAINERS[g.id]) continue;
      expect(getExplainerScript(g.id), g.id).not.toBeNull();
    }
  });

  it.each(Object.keys(ANIMATED_EXPLAINERS))("animated %s renders every frame and runs 2–6 minutes", (id) => {
    const script = getExplainerScript(id)!;
    expect(script.kind).toBe("animated");
    const tl = renderAll(script);
    expect(tl.duration).toBeGreaterThan(120);
    expect(tl.duration).toBeLessThan(360);
  });

  it("summary explainers render for every game", () => {
    for (const g of playable) {
      const s = getExplainerScript(g.id);
      if (!s || s.kind !== "summary") continue;
      renderAll(s);
    }
  });
});

describe("cue boundaries", () => {
  it("a line's own start time always shows that line (no float gap)", () => {
    for (const id of Object.keys(ANIMATED_EXPLAINERS)) {
      const tl = buildTimeline(getExplainerScript(id)!);
      tl.cues.forEach((c, i) => {
        if (c.text.trim()) expect(locate(tl, c.start).cueIndex, `${id} cue ${i}`).toBe(i);
      });
    }
  });
});
