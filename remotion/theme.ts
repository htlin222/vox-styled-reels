export const theme = {
  // Bauhaus primary triad (Itten) + neutral: red #C8302A, yellow #E8C018,
  // blue #1E3878, off-white #F5F2E8.
  colors: { bg: "#F5F2E8", ink: "#111111", marker: "#C8302A", answerBg: "#E8C018", header: "#1E3878" },
  fonts: {
    family: "Noto Sans, sans-serif",
    titleSize: 72,
    titleWeight: 800,
    shortsTitleSize: 60,
    answerSize: 56,
    detailSize: 48,
    shortsDetailSize: 52,
    headerSize: 24,
  },
  layout: { headerMargin: 56 },
  grain: { opacity: 0.06 },
  timing: { revealDurationMs: 400, detailGapMs: 300, endFadeFrames: 30, endHoldMs: 1500, musicTailMs: 2500 },
  // Background music bed. Quiet under the narration, swells once the voice-over
  // ends, then fades to silence across the music tail. src is served from public/.
  music: { src: "sfx/bg_music.mp3", low: 0.05, high: 0.28, fadeInMs: 500, swellMs: 500 },
  // End card shown over the music tail: the author name scrambles in, centered,
  // in a heavy slab serif with extra grain (Vox-logo feel).
  outro: { startAfterNarrationMs: 1000, contentFadeMs: 400, inMs: 500, shortsSize: 130, longformSize: 190, grainOpacity: 0.14 },
  marker: { boilFps: 10, strokeWidth: 7, segments: 9, wobblePx: 2.4, sagPx: 3, overshootPct: 3, drawMs: 280 },
  boil: { boilFps: 10, jitterPx: 1.4 },
  grid: { size: 40, color: "rgba(17,17,17,0.08)", dotColor: "rgba(17,17,17,0.16)", dotMinRadius: 1, dotMaxRadius: 3.2, dotChance: 0.45 },
  progress: {
    wipeFrames: 5,
    dotSize: 15,
    dotGap: 12,
    fontSize: 30,
    dotColorActive: "#111111",
    dotColorInactive: "rgba(17,17,17,0.18)",
  },
  transition: { scrollFrames: 8, scrollDistance: 60 },
  // Title opening: the title plays its karaoke centered, oversized and heavier,
  // then settles into its anchor (font-size tweens per frame so line breaks
  // reflow naturally); only after it lands does the answer box fade in.
  titleIntro: { sizeBoost: 1.8, startWeight: 900, settleMs: 700, boxFadeMs: 300 },
  opening: { settleFrames: 12, startScale: 1.05, maxBlur: 12 },
  // Gentle Vox-style flavor: an imperceptible whole-video push-in, a soft edge
  // vignette, a paper-cutout shadow under the answer box, and a paper texture
  // base beneath the grid. All tuned to stay under the threshold of notice.
  camera: { pushInScale: 1.015 },
  vignette: { opacity: 0.18 },
  // Print-misregistration shadow: brand red offset one way, brand blue the
  // other, like a silkscreen pass that missed registration.
  answerShadow: "8px 8px 0 rgba(200,48,42,0.4), -8px -8px 0 rgba(30,56,120,0.3)",
  paper: { opacity: 0.06, seed: 7 },
  scramble: { durationFrames: 14, charset: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#%&@" },
  tts: { voice: "en-US-AvaNeural", rate: "+0%" },
  sfx: { begin: "sfx/Tink.m4a", click: "sfx/Pop.m4a" },
  safeZone: { shorts: { w: 900, h: 1350 } },
  fps: 30,
} as const;
