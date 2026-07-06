import { useMemo } from "react";
import { AbsoluteFill, Html5Audio as Audio, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../theme";
import { Header } from "../components/Header";
import { GridBackground } from "../components/GridBackground";
import { PaperTexture } from "../components/PaperTexture";
import { Vignette } from "../components/Vignette";
import { GrainOverlay } from "../components/GrainOverlay";
import { ProgressBar } from "../components/ProgressBar";
import { KaraokeText } from "../components/KaraokeText";
import { RollingCaption } from "../components/RollingCaption";
import { BackgroundMusic } from "../components/BackgroundMusic";
import { Outro } from "../components/Outro";
import { buildTimeline } from "../lib/useCardTimeline";
import { currentPhaseIndex } from "../lib/progress";
import { easeInCubic, easeInOutCubic, easeOutCubic } from "../lib/easing";
import { closingEffect, openingEffect } from "../lib/opening";
import { answerFontFor } from "../lib/answerFonts";
import { estimateLineCount, fitFontSize } from "../lib/fitText";
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
const ANSWER_TOP = SAFE_TOP + 320; // yellow box band widened +40 up / +40 down
const DETAIL_BAND_TOP = SAFE_TOP + 760;
const PROGRESS_TOP = SAFE_BOTTOM + 20;
const PROGRESS_OFFSET_X = 200; // nudge the dots right, clear of Shorts UI chrome
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

  // Title opening: the karaoke plays centered, oversized and heavier, then the
  // title settles into its TITLE_TOP anchor while the font size tweens down —
  // the browser reflows every frame, so line breaks move naturally.
  const titleBigSize = useMemo(
    () =>
      fitFontSize([byKey["title"].words.map((w) => w.word)], {
        maxWidth: CONTENT_WIDTH,
        maxHeight: theme.safeZone.shorts.h * 0.75,
        lineHeight: TITLE_LINE_HEIGHT,
        max: Math.round(theme.fonts.shortsTitleSize * theme.titleIntro.sizeBoost),
        min: titleSize,
        charWidthRatio: TITLE_WIDTH_RATIO,
      }),
    [byKey["title"].words, titleSize],
  );

  const detailPhases = phases.filter((p) => p.key.startsWith("detail-"));

  const titlePhase = phaseByKey["title"];
  const answerPhase = phaseByKey["answer"];
  const titleDone = frame >= titlePhase.endFrame;

  const settleFrames = Math.round((theme.titleIntro.settleMs / 1000) * fps);
  const boxFadeFrames = Math.round((theme.titleIntro.boxFadeMs / 1000) * fps);
  const settle = interpolate(frame, [titlePhase.endFrame, titlePhase.endFrame + settleFrames], [0, 1], {
    easing: easeInOutCubic,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const bigLines = estimateLineCount(
    byKey["title"].words.map((w) => w.word),
    { fontSize: titleBigSize, maxWidth: CONTENT_WIDTH, charWidthRatio: TITLE_WIDTH_RATIO },
  );
  const centerTop = SAFE_TOP + (theme.safeZone.shorts.h - bigLines * titleBigSize * TITLE_LINE_HEIGHT) / 2;
  const titleTop = centerTop + (TITLE_TOP - centerTop) * settle;
  const titleFontSize = titleBigSize + (titleSize - titleBigSize) * settle;
  const titleWeight = Math.round(theme.titleIntro.startWeight + (theme.fonts.titleWeight - theme.titleIntro.startWeight) * settle);

  // The answer box fades in (with its dimmed preview text) only after the
  // title has landed; the answer narration then starts and lights it up.
  const boxFadeStart = titlePhase.endFrame + settleFrames;
  const boxOpacity = interpolate(frame, [boxFadeStart, boxFadeStart + boxFadeFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const progressIndex = currentPhaseIndex(phases, frame);
  const progressPhaseStart = phases[progressIndex]?.startFrame ?? 0;

  // Answer re-letters each time a detail is revealed (the progress pushes on).
  const detailsRevealed = detailPhases.filter((p) => p.startFrame <= frame).length;
  const answerFont = answerFontFor(detailsRevealed);

  // The main card fades out into the end card once the narration ends and the
  // music swells; the Outro then owns the music tail.
  const narrationEndFrame = phases[phases.length - 1]?.endFrame ?? 0;
  const outroStart = narrationEndFrame + Math.round((theme.outro.startAfterNarrationMs / 1000) * fps);
  const contentFadeFrames = Math.round((theme.outro.contentFadeMs / 1000) * fps);
  const fadeOpacity = interpolate(frame, [outroStart, outroStart + contentFadeFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const open = openingEffect(frame, theme);
  const close = closingEffect(frame, totalFrames, theme);
  // Imperceptible push-in across the whole video so the frame never sits still.
  const drift = interpolate(frame, [0, totalFrames], [1, theme.camera.pushInScale]);
  const viewScale = open.scale * close.scale * drift;
  const viewBlur = open.blurPx + close.blurPx;

  return (
    <AbsoluteFill style={{ background: theme.colors.bg }}>
      <AbsoluteFill style={{ transform: `scale(${viewScale})`, filter: viewBlur ? `blur(${viewBlur}px)` : undefined }}>
        <GridBackground />
        <PaperTexture />

        <AbsoluteFill style={{ opacity: fadeOpacity }}>
          <Header main={main} section={section} topic={topic} author={author} position="top" top={SAFE_TOP - 40} sideInset={CONTENT_LEFT} />

          <Sequence from={0} layout="none">
            <div style={{ position: "absolute", top: titleTop, left: CONTENT_LEFT, width: CONTENT_WIDTH }}>
              <KaraokeText
                words={byKey["title"].words}
                currentMs={(frame / fps) * 1000}
                frame={frame}
                fontSize={titleFontSize}
                fontWeight={titleWeight}
                bold
                boil
              />
            </div>
          </Sequence>

          {frame >= boxFadeStart && (
            <Sequence from={boxFadeStart} layout="none">
              <div style={{ position: "absolute", top: ANSWER_TOP, left: CONTENT_LEFT, width: CONTENT_WIDTH, opacity: boxOpacity }}>
                <div style={{ position: "relative", display: "inline-block", maxWidth: "100%", background: theme.colors.answerBg, borderRadius: 14, padding: `${ANSWER_PAD_V}px ${ANSWER_PAD_H}px`, overflow: "hidden", boxShadow: theme.answerShadow }}>
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

          <div style={{ position: "absolute", top: PROGRESS_TOP, left: PROGRESS_OFFSET_X, width: 1080, display: "flex", justifyContent: "center" }}>
            <ProgressBar current={progressIndex} total={timing.segments.length} frame={frame} currentPhaseStart={progressPhaseStart} />
          </div>

          <BackgroundMusic narrationEndFrame={phases[phases.length - 1]?.endFrame ?? 0} totalFrames={totalFrames} />

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

        <Outro author={author} startFrame={outroStart + contentFadeFrames} totalFrames={totalFrames} fontSize={theme.outro.shortsSize} />

        <Vignette />
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
