import { theme } from "../theme";
import { chunkWords, activeChunkIndex } from "../lib/captions";
import { activeWordIndex } from "../lib/karaoke";
import { boilJitter } from "../lib/boil";
import { MarkerText } from "./MarkerText";
import type { WordTiming } from "../lib/types";

export function RollingCaption({
  words,
  currentMs,
  frame,
  fontSize,
  maxWordsPerChunk = 14,
  boil = false,
  fontFamily = theme.fonts.family,
  lineHeight = 1.5,
}: {
  words: WordTiming[];
  currentMs: number;
  frame: number;
  fontSize: number;
  maxWordsPerChunk?: number;
  boil?: boolean;
  fontFamily?: string;
  lineHeight?: number;
}) {
  const chunks = chunkWords(words, maxWordsPerChunk);
  const activeChunk = chunks[activeChunkIndex(chunks, currentMs)];
  if (!activeChunk) return null;

  const active = activeWordIndex(activeChunk.words, currentMs);
  return (
    <div
      style={{
        fontFamily,
        fontSize,
        color: theme.colors.ink,
        textAlign: "left",
        lineHeight,
      }}
    >
      {activeChunk.words.map((w, i) => {
        const j = boil ? boilJitter(w.word, i, frame, theme) : null;
        const drawProgress = Math.max(0, Math.min(1, (currentMs - w.startMs) / theme.marker.drawMs));
        return (
          <span
            key={i}
            style={{
              opacity: i <= active ? 1 : 0.35,
              marginRight: "0.3em",
              display: "inline-block",
              transform: j ? `translate(${j.x}px, ${j.y}px)` : undefined,
            }}
          >
            <MarkerText text={w.word} marked={w.marked} frame={frame} fontSize={fontSize} drawProgress={drawProgress} />
          </span>
        );
      })}
    </div>
  );
}
