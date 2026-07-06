import { describe, expect, it } from "vitest";
import { estimateLineCount, fitFontSize } from "./fitText";

const ratio = { maxWidth: 800, charWidthRatio: 0.6 };

describe("estimateLineCount", () => {
  it("returns 0 for no words", () => {
    expect(estimateLineCount([], { fontSize: 40, ...ratio })).toBe(0);
  });

  it("keeps short text on one line", () => {
    expect(estimateLineCount(["a", "b", "c"], { fontSize: 40, ...ratio })).toBe(1);
  });

  it("wraps when the running width exceeds maxWidth", () => {
    const words = ["severely", "elevated", "in", "tumor", "lysis", "syndrome"];
    expect(estimateLineCount(words, { fontSize: 60, ...ratio })).toBeGreaterThan(1);
  });

  it("produces more lines at a larger font size", () => {
    const words = ["Why", "withhold", "calcium", "when", "phosphorus", "is", "severely", "elevated"];
    const small = estimateLineCount(words, { fontSize: 40, ...ratio });
    const large = estimateLineCount(words, { fontSize: 72, ...ratio });
    expect(large).toBeGreaterThanOrEqual(small);
  });
});

describe("fitFontSize", () => {
  const opts = { maxWidth: 800, charWidthRatio: 0.6, lineHeight: 1.4, max: 60, min: 44, step: 2 };

  it("returns max when the text already fits", () => {
    expect(fitFontSize([["short"]], { ...opts, maxHeight: 1000 })).toBe(60);
  });

  it("shrinks a long title so its block fits the height budget", () => {
    const title = ["Why", "withhold", "calcium", "when", "phosphorus", "is", "severely", "elevated", "in", "tumor", "lysis", "syndrome"];
    const size = fitFontSize([title], { ...opts, maxHeight: 276 });
    expect(size).toBeLessThan(60);
    const lines = estimateLineCount(title, { fontSize: size, maxWidth: opts.maxWidth, charWidthRatio: opts.charWidthRatio });
    expect(lines * opts.lineHeight * size).toBeLessThanOrEqual(276);
  });

  it("never returns below min", () => {
    const huge = Array.from({ length: 60 }, () => "phosphorus");
    expect(fitFontSize([huge], { ...opts, maxHeight: 100 })).toBe(44);
  });

  it("is governed by the tallest group", () => {
    const short = ["one", "two"];
    const tall = Array.from({ length: 20 }, () => "phosphorus");
    const both = fitFontSize([short, tall], { ...opts, maxHeight: 300 });
    const tallOnly = fitFontSize([tall], { ...opts, maxHeight: 300 });
    expect(both).toBe(tallOnly);
  });
});
