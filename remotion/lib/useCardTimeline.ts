import { theme } from "../theme";
import type { CardTiming } from "./types";

export type PhaseFrame = { key: string; startFrame: number; endFrame: number };

export function buildTimeline(timing: CardTiming): { phases: PhaseFrame[]; totalFrames: number } {
  const gapFrames = Math.round((theme.timing.detailGapMs / 1000) * theme.fps);
  // Extra hold after the title so it can settle into its anchor and the answer
  // box can fade in before the answer narration starts.
  const titleHoldFrames = Math.round(((theme.titleIntro.settleMs + theme.titleIntro.boxFadeMs) / 1000) * theme.fps);
  let cursor = 0;
  const phases: PhaseFrame[] = [];

  for (const segment of timing.segments) {
    const durationFrames = Math.round((segment.durationMs / 1000) * theme.fps);
    phases.push({ key: segment.key, startFrame: cursor, endFrame: cursor + durationFrames });
    cursor += durationFrames + gapFrames;
    if (segment.key === "title") cursor += titleHoldFrames;
  }

  // Hold on the last frame, then keep rolling for the music tail so the score can
  // swell and fade out after the narration ends.
  const endHoldFrames = Math.round(((theme.timing.endHoldMs + theme.timing.musicTailMs) / 1000) * theme.fps);
  const totalFrames = phases.length > 0 ? phases[phases.length - 1].endFrame + endHoldFrames : endHoldFrames;
  return { phases, totalFrames };
}
