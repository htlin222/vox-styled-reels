import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, cpSync, rmSync } from "fs";
import { join } from "path";
import { theme } from "../remotion/theme";
import { parseWordTimings } from "../remotion/lib/timing";
import type { Card, CardTiming, SegmentTiming } from "../remotion/lib/types";
import { parseMarkers, attachWordMarkers } from "../remotion/lib/markers";

const CARDS_DIR = "cards";
const AUDIO_DIR = "remotion/audio";

function segmentsFor(card: Card): { key: string; text: string }[] {
  return [
    { key: "title", text: card.title },
    { key: "answer", text: card.answer },
    ...card.detail.map((text, i) => ({ key: `detail-${i}`, text })),
  ];
}

async function synthesizeSegment(cardId: string, key: string, text: string): Promise<SegmentTiming> {
  const dir = join(AUDIO_DIR, cardId, key);
  const sourcePath = join(dir, "source.txt");

  // Marker syntax (**word**) is for on-screen highlighting only — TTS should speak plain text.
  const { plainText: spokenText, markers } = parseMarkers(text);

  if (existsSync(sourcePath) && readFileSync(sourcePath, "utf-8") === spokenText) {
    const raw = JSON.parse(readFileSync(join(dir, "metadata.json"), "utf-8"));
    const words = attachWordMarkers(parseWordTimings(raw), spokenText, markers);
    return {
      key,
      text,
      audioPath: join(dir, "audio.mp3"),
      durationMs: words.length ? words[words.length - 1].endMs : 0,
      words,
    };
  }

  mkdirSync(dir, { recursive: true });
  const tts = new MsEdgeTTS();
  await tts.setMetadata(theme.tts.voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3, {
    wordBoundaryEnabled: true,
    sentenceBoundaryEnabled: true,
  });
  const { metadataFilePath } = await tts.toFile(dir, spokenText, { rate: theme.tts.rate });
  tts.close();

  writeFileSync(sourcePath, spokenText);
  const raw = JSON.parse(readFileSync(metadataFilePath!, "utf-8"));
  const words = attachWordMarkers(parseWordTimings(raw), spokenText, markers);

  return {
    key,
    text,
    audioPath: join(dir, "audio.mp3"),
    durationMs: words.length ? words[words.length - 1].endMs : 0,
    words,
  };
}

async function processCard(cardPath: string) {
  const card: Card = JSON.parse(readFileSync(cardPath, "utf-8"));
  console.log(`Processing card: ${card.id}`);

  const segments: SegmentTiming[] = [];
  for (const { key, text } of segmentsFor(card)) {
    segments.push(await synthesizeSegment(card.id, key, text));
  }

  const timing: CardTiming = { cardId: card.id, topic: card.topic, author: card.author, segments };
  writeFileSync(join(AUDIO_DIR, card.id, "timing.json"), JSON.stringify(timing, null, 2));
  console.log(`  wrote timing.json (${segments.length} segments)`);
}

async function main() {
  const files = readdirSync(CARDS_DIR).filter((f) => f.endsWith(".json") && !f.startsWith("_"));
  for (const file of files) {
    await processCard(join(CARDS_DIR, file));
  }

  // Rebuild public/audio from scratch so renamed/removed cards don't leave stale served files behind.
  rmSync("public/audio", { recursive: true, force: true });
  cpSync(AUDIO_DIR, "public/audio", { recursive: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
