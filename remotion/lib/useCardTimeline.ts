import { theme } from "../theme";
import type { CardTiming } from "./types";

export type PhaseFrame = { key: string; startFrame: number; endFrame: number };

export function buildTimeline(timing: CardTiming): { phases: PhaseFrame[]; totalFrames: number } {
  const gapFrames = Math.round((theme.timing.detailGapMs / 1000) * theme.fps);
  let cursor = 0;
  const phases: PhaseFrame[] = [];

  for (const segment of timing.segments) {
    const durationFrames = Math.round((segment.durationMs / 1000) * theme.fps);
    phases.push({ key: segment.key, startFrame: cursor, endFrame: cursor + durationFrames });
    cursor += durationFrames + gapFrames;
  }

  const endHoldFrames = Math.round(1.5 * theme.fps);
  return { phases, totalFrames: cursor + endHoldFrames };
}
