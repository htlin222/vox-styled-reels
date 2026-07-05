import type { WordTiming } from "./types";

export type CaptionChunk = { words: WordTiming[]; startMs: number; endMs: number };

export function chunkWords(words: WordTiming[], maxWordsPerChunk = 14): CaptionChunk[] {
  const chunks: CaptionChunk[] = [];
  for (let i = 0; i < words.length; i += maxWordsPerChunk) {
    const slice = words.slice(i, i + maxWordsPerChunk);
    chunks.push({
      words: slice,
      startMs: slice[0].startMs,
      endMs: slice[slice.length - 1].endMs,
    });
  }
  return chunks;
}
