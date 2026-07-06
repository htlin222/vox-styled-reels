import { useMemo } from "react";
import { AbsoluteFill, Html5Audio as Audio, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../theme";
import { Header } from "../components/Header";
import { GridBackground } from "../components/GridBackground";
import { GrainOverlay } from "../components/GrainOverlay";
import { ProgressBar } from "../components/ProgressBar";
import { KaraokeText } from "../components/KaraokeText";
import { RollingCaption } from "../components/RollingCaption";
import { buildTimeline } from "../lib/useCardTimeline";
import { currentPhaseIndex } from "../lib/progress";
import { easeInCubic, easeOutCubic } from "../lib/easing";
import { openingEffect } from "../lib/opening";
import { answerFontFor } from "../lib/answerFonts";
import { fitFontSize } from "../lib/fitText";
import type { CardTiming } from "../lib/types";

const SAFE_TOP = (1920 - theme.safeZone.shorts.h) / 2;
const SAFE_LEFT = (1080 - theme.safeZone.shorts.w) / 2;
const SAFE_BOTTOM = SAFE_TOP + theme.safeZone.shorts.h;
const CONTENT_LEFT = SAFE_LEFT + 50;
const CONTENT_WIDTH = theme.safeZone.shorts.w - 100;
const DETAIL_INDENT = 40;

// Fixed y-anchors so the yellow answer box never shifts when a detail line's
// height changes. The detail lives in its own band and centers within it.
const TITLE_TOP = SAFE_TOP + 40;
const ANSWER_TOP = SAFE_TOP + 360;
const DETAIL_BAND_TOP = SAFE_TOP + 720;
const PROGRESS_TOP = SAFE_BOTTOM + 20;
const DETAIL_BAND_BOTTOM = PROGRESS_TOP - 120;

// Adaptive text fitting. Title and answer live in fixed bands (so the yellow box
// never shifts), so instead of moving anchors we shrink the font until the block
// fits its band — with a breathing gap so a tall title never kisses the box and a
// long answer never bleeds into the detail band below.
const GAP_TITLE_ANSWER = 44;
const GAP_ANSWER_DETAIL = 36;
const TITLE_LINE_HEIGHT = 1.4; // must match KaraokeText's lineHeight
const ANSWER_LINE_HEIGHT = 1.2;
const ANSWER_PAD_V = 24;
const ANSWER_PAD_H = 40;
const ANSWER_MAX_WORDS = 200; // one chunk: the whole answer shows at once, no rolling stages
const TITLE_WIDTH_RATIO = 0.6; // bold sans runs wide; over-estimate to stay safe
const ANSWER_WIDTH_RATIO = 0.56; // covers the widest serif in the answer pool

const TITLE_BUDGET_H = ANSWER_TOP - TITLE_TOP - GAP_TITLE_ANSWER;
const ANSWER_INNER_WIDTH = CONTENT_WIDTH - ANSWER_PAD_H * 2;
const ANSWER_BUDGET_H = DETAIL_BAND_TOP - ANSWER_TOP - GAP_ANSWER_DETAIL - ANSWER_PAD_V * 2;

export function Shorts({
  timing,
  main,
  section,
  topic,
  author,
}: {
  cardId: string;
  timing: CardTiming;
  main: string;
  section: string;
  topic: string;
  author: string;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { phases, totalFrames } = buildTimeline(timing);
  const byKey = Object.fromEntries(timing.segments.map((s) => [s.key, s]));
  const phaseByKey = Object.fromEntries(phases.map((p) => [p.key, p]));

  const titleSize = useMemo(
    () =>
      fitFontSize([byKey["title"].words.map((w) => w.word)], {
        maxWidth: CONTENT_WIDTH,
        maxHeight: TITLE_BUDGET_H,
        lineHeight: TITLE_LINE_HEIGHT,
        max: theme.fonts.shortsTitleSize,
        min: 44,
        charWidthRatio: TITLE_WIDTH_RATIO,
      }),
    [byKey["title"].words],
  );

  const answerSize = useMemo(
    () =>
      fitFontSize([byKey["answer"].words.map((w) => w.word)], {
        maxWidth: ANSWER_INNER_WIDTH,
        maxHeight: ANSWER_BUDGET_H,
        lineHeight: ANSWER_LINE_HEIGHT,
        max: theme.fonts.answerSize,
        min: 32,
        charWidthRatio: ANSWER_WIDTH_RATIO,
      }),
    [byKey["answer"].words],
  );

  const detailPhases = phases.filter((p) => p.key.startsWith("detail-"));

  const titlePhase = phaseByKey["title"];
  const answerPhase = phaseByKey["answer"];
  const titleDone = frame >= titlePhase.endFrame;

  const progressIndex = currentPhaseIndex(phases, frame);
  const progressPhaseStart = phases[progressIndex]?.startFrame ?? 0;

  // Answer re-letters each time a detail is revealed (the progress pushes on).
  const detailsRevealed = detailPhases.filter((p) => p.startFrame <= frame).length;
  const answerFont = answerFontFor(detailsRevealed);

  const fadeOpacity = interpolate(frame, [totalFrames - theme.timing.endFadeFrames, totalFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const open = openingEffect(frame, theme);

  return (
    <AbsoluteFill style={{ background: theme.colors.bg }}>
      <AbsoluteFill style={{ transform: `scale(${open.scale})`, filter: open.blurPx ? `blur(${open.blurPx}px)` : undefined }}>
        <GridBackground />

        <AbsoluteFill style={{ opacity: fadeOpacity }}>
          <Header main={main} section={section} topic={topic} author={author} position="top" top={SAFE_TOP - 40} sideInset={CONTENT_LEFT} />

          <Sequence from={0} layout="none">
            <div style={{ position: "absolute", top: TITLE_TOP, left: CONTENT_LEFT, width: CONTENT_WIDTH }}>
              <KaraokeText
                words={byKey["title"].words}
                currentMs={(frame / fps) * 1000}
                frame={frame}
                fontSize={titleSize}
                bold
                boil
              />
            </div>
          </Sequence>

          {titleDone && (
            <Sequence from={answerPhase.startFrame} layout="none">
              <div style={{ position: "absolute", top: ANSWER_TOP, left: CONTENT_LEFT, width: CONTENT_WIDTH }}>
                <div style={{ position: "relative", display: "inline-block", maxWidth: "100%", background: theme.colors.answerBg, borderRadius: 14, padding: `${ANSWER_PAD_V}px ${ANSWER_PAD_H}px`, overflow: "hidden" }}>
                  <GrainOverlay frame={frame} id="grain-answer-sh" opacity={0.35} radius={14} />
                  <RollingCaption
                    words={byKey["answer"].words}
                    currentMs={((frame - answerPhase.startFrame) / fps) * 1000}
                    frame={frame}
                    fontSize={answerSize}
                    maxWordsPerChunk={ANSWER_MAX_WORDS}
                    lineHeight={ANSWER_LINE_HEIGHT}
                    boil
                    fontFamily={answerFont}
                  />
                </div>
              </div>
            </Sequence>
          )}

          <div
            style={{
              position: "absolute",
              top: DETAIL_BAND_TOP,
              left: CONTENT_LEFT + DETAIL_INDENT,
              width: CONTENT_WIDTH - DETAIL_INDENT,
              height: DETAIL_BAND_BOTTOM - DETAIL_BAND_TOP,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
            }}
          >
            {timing.segments
              .filter((s) => s.key.startsWith("detail-"))
              .map((seg, i) => {
                const p = phaseByKey[seg.key];
                const nextDetailPhase = detailPhases[i + 1];
                const durationInFrames = (nextDetailPhase ? nextDetailPhase.startFrame : totalFrames) - p.startFrame;
                const localFrame = frame - p.startFrame;
                const enterY = interpolate(localFrame, [0, theme.transition.scrollFrames], [theme.transition.scrollDistance, 0], {
                  easing: easeOutCubic,
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                });
                const exitStart = durationInFrames - theme.transition.scrollFrames;
                const exitY = interpolate(localFrame, [exitStart, durationInFrames], [0, -theme.transition.scrollDistance], {
                  easing: easeInCubic,
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                });
                const exitOpacity = interpolate(localFrame, [exitStart, durationInFrames], [1, 0], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                });
                return (
                  <Sequence key={seg.key} from={p.startFrame} durationInFrames={durationInFrames} layout="none">
                    <div style={{ transform: `translateY(${enterY + exitY}px)`, opacity: exitOpacity }}>
                      <RollingCaption
                        words={seg.words}
                        currentMs={((frame - p.startFrame) / fps) * 1000}
                        frame={frame}
                        fontSize={theme.fonts.shortsDetailSize}
                      />
                    </div>
                  </Sequence>
                );
              })}
          </div>

          <div style={{ position: "absolute", top: PROGRESS_TOP, left: 0, width: 1080, display: "flex", justifyContent: "center" }}>
            <ProgressBar current={progressIndex} total={timing.segments.length} frame={frame} currentPhaseStart={progressPhaseStart} />
          </div>

          <Audio src={staticFile(theme.sfx.begin)} />
          {titleDone && (
            <Sequence from={titlePhase.endFrame} durationInFrames={5}>
              <Audio src={staticFile(theme.sfx.click)} />
            </Sequence>
          )}
          {detailPhases.map((p) => (
            <Sequence key={p.key} from={p.startFrame} durationInFrames={5}>
              <Audio src={staticFile(theme.sfx.click)} />
            </Sequence>
          ))}

          {timing.segments.map((seg) => {
            const p = phaseByKey[seg.key];
            return (
              <Sequence key={seg.key} from={p.startFrame}>
                <Audio src={staticFile(seg.audioPath.replace(/^remotion\//, ""))} />
              </Sequence>
            );
          })}
        </AbsoluteFill>

        <GrainOverlay frame={frame} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
