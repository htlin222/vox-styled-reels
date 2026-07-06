// Deterministic text-fitting used to shrink title/answer so they never overflow
// their fixed layout bands. Line count is estimated with a greedy word-wrap:
// each word's width ≈ charCount × fontSize × charWidthRatio, and the gap between
// words ≈ spaceRatio × fontSize (matching the 0.3em marginRight the caption
// components render). Ratios are picked to slightly OVER-estimate width so a
// fitted block always fits — a wrong guess errs toward a smaller, safe font.

export type FitOptions = {
  maxWidth: number;
  charWidthRatio: number;
  spaceRatio?: number;
};

export function estimateLineCount(words: string[], opts: { fontSize: number } & FitOptions): number {
  const { fontSize, maxWidth, charWidthRatio, spaceRatio = 0.3 } = opts;
  if (words.length === 0) return 0;

  const space = spaceRatio * fontSize;
  const wordWidth = (w: string) => w.length * fontSize * charWidthRatio;

  let lines = 1;
  let cursor = wordWidth(words[0]);
  for (let i = 1; i < words.length; i++) {
    const w = wordWidth(words[i]);
    if (cursor + space + w > maxWidth) {
      lines++;
      cursor = w;
    } else {
      cursor += space + w;
    }
  }
  return lines;
}

// Largest font size in [min, max] whose wrapped block fits maxHeight. Pass one
// word array per independently-rendered group (e.g. rolling-caption chunks); the
// tallest group governs, so the chosen size is safe for every chunk.
export function fitFontSize(
  groups: string[][],
  opts: {
    maxHeight: number;
    lineHeight: number;
    max: number;
    min: number;
    step?: number;
  } & FitOptions,
): number {
  const { maxHeight, lineHeight, max, min, step = 2, ...fit } = opts;
  for (let size = max; size > min; size -= step) {
    const lines = Math.max(1, ...groups.map((g) => estimateLineCount(g, { fontSize: size, ...fit })));
    if (lines * lineHeight * size <= maxHeight) return size;
  }
  return min;
}
