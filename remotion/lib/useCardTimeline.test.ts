import { describe, it, expect } from "vitest";
import { buildTimeline } from "./useCardTimeline";
import { theme } from "../theme";
import type { CardTiming } from "./types";

function makeTiming(durationsMs: number[]): CardTiming {
  return {
    cardId: "test",
    main: "Test Main",
    section: "Test Section",
    topic: "Test Topic",
    author: "Test Author",
    segments: durationsMs.map((durationMs, i) => ({
      key: `seg-${i}`,
      text: "",
      audioPath: "",
      durationMs,
      words: [],
    })),
  };
}

describe("buildTimeline", () => {
  it("places a single segment starting at frame 0", () => {
    const { phases } = buildTimeline(makeTiming([1000]));
    expect(phases).toHaveLength(1);
    expect(phases[0]).toEqual({ key: "seg-0", startFrame: 0, endFrame: theme.fps });
  });

  it("places multiple segments back to back with a gap between them", () => {
    const { phases } = buildTimeline(makeTiming([1000, 2000]));
    const gapFrames = Math.round((theme.timing.detailGapMs / 1000) * theme.fps);
    expect(phases[0]).toEqual({ key: "seg-0", startFrame: 0, endFrame: theme.fps });
    expect(phases[1].startFrame).toBe(theme.fps + gapFrames);
    expect(phases[1].endFrame).toBe(theme.fps + gapFrames + theme.fps * 2);
  });

  it("rounds fractional durations to the nearest frame", () => {
    // 1033ms at 30fps = 30.99 frames, should round to 31
    const { phases } = buildTimeline(makeTiming([1033]));
    expect(phases[0].endFrame).toBe(31);
  });

  it("totalFrames covers the last phase plus the end hold, with no extra trailing gap", () => {
    const { phases, totalFrames } = buildTimeline(makeTiming([1000, 1000]));
    const endHoldFrames = Math.round(((theme.timing.endHoldMs + theme.timing.musicTailMs) / 1000) * theme.fps);
    const lastPhase = phases[phases.length - 1];
    expect(totalFrames).toBe(lastPhase.endFrame + endHoldFrames);
  });

  it("holds after the title segment for the settle + box fade window", () => {
    const timing = makeTiming([1000, 1000]);
    timing.segments[0].key = "title";
    const { phases } = buildTimeline(timing);
    const gapFrames = Math.round((theme.timing.detailGapMs / 1000) * theme.fps);
    const holdFrames = Math.round(((theme.titleIntro.settleMs + theme.titleIntro.boxFadeMs) / 1000) * theme.fps);
    expect(phases[1].startFrame).toBe(theme.fps + gapFrames + holdFrames);
  });

  it("returns no phases and just the end hold for a card with no segments", () => {
    const { phases, totalFrames } = buildTimeline(makeTiming([]));
    const endHoldFrames = Math.round(((theme.timing.endHoldMs + theme.timing.musicTailMs) / 1000) * theme.fps);
    expect(phases).toEqual([]);
    expect(totalFrames).toBe(endHoldFrames);
  });
});
