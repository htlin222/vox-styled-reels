import { describe, it, expect } from "vitest";
import { chunkWords } from "./captions";
import type { WordTiming } from "./types";

function makeWords(n: number): WordTiming[] {
  return Array.from({ length: n }, (_, i) => ({
    word: `w${i}`,
    startMs: i * 100,
    endMs: i * 100 + 90,
  }));
}

describe("chunkWords", () => {
  it("groups words into chunks no larger than maxWordsPerChunk", () => {
    const chunks = chunkWords(makeWords(30), 14);
    expect(chunks.length).toBe(3);
    expect(chunks[0].words).toHaveLength(14);
    expect(chunks[2].words).toHaveLength(2);
  });

  it("sets chunk startMs/endMs from its first/last word", () => {
    const chunks = chunkWords(makeWords(5), 14);
    expect(chunks[0].startMs).toBe(0);
    expect(chunks[0].endMs).toBe(490);
  });

  it("returns an empty array for no words", () => {
    expect(chunkWords([], 14)).toEqual([]);
  });

  it("handles fewer words than one chunk", () => {
    const chunks = chunkWords(makeWords(3), 14);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].words).toHaveLength(3);
  });
});
