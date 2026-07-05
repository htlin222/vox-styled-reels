# Board Review Clips Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Remotion pipeline that turns a review-card JSON (title/answer/detail/header) into a 16:9 long-form video and a 9:16 Shorts video, narrated by zh-TW edge-tts reading the English source text, with skeleton reveal, karaoke/rolling captions, hand-drawn marker highlights, Ken Burns camera movement, and macOS sound effects.

**Architecture:** Two-stage pipeline. Stage 1 (`scripts/generate-audio.ts`) calls `msedge-tts` per text segment (title/answer/detail[n]) and writes an mp3 + normalized word-timing JSON per segment. Stage 2 (`scripts/render.ts`) reads card JSON + timing JSON and renders two Remotion compositions (`LongForm`, `Shorts`) per card. Pure timing/parsing/layout logic (ticks→ms, marker parsing, caption chunking, karaoke index lookup, camera zoom math) is factored into testable functions under `remotion/lib/`; visual React components are thin wrappers verified by eye in Remotion Studio plus a smoke-test render.

**Tech Stack:** TypeScript, pnpm, Remotion 4 (React 19), `msedge-tts` for TTS, Vitest for unit tests, macOS `/System/Library/Sounds` for SFX.

**Reference:** Design doc at `docs/plans/2026-07-05-board-review-clips-design.md`.

---

## Task 1: Scaffold the project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore` (already exists at repo root — skip if present)

**Step 1: Write package.json**

```json
{
  "name": "board-review-clips",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "audio": "tsx scripts/generate-audio.ts",
    "render": "tsx scripts/render.ts",
    "studio": "remotion studio remotion/Root.tsx",
    "test": "vitest run"
  },
  "dependencies": {
    "msedge-tts": "^2.0.6",
    "react": "^19.2.7",
    "react-dom": "^19.2.7",
    "remotion": "^4.0.484",
    "@remotion/cli": "^4.0.484",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "tsx": "^4.19.0",
    "vitest": "^2.1.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@types/node": "^22.0.0"
  }
}
```

**Step 2: Write tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "lib": ["ES2020", "DOM"]
  },
  "include": ["remotion", "scripts"]
}
```

**Step 3: Install and verify**

Run: `pnpm install`
Expected: lockfile created, no errors.

Run: `pnpm exec tsc --noEmit`
Expected: passes (no source files yet, nothing to check, exit 0).

**Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.json
git commit -m "chore: scaffold TypeScript project with Remotion and msedge-tts"
```

---

## Task 2: Card data model, theme, and sample fixture

**Files:**
- Create: `cards/scd-median-survival.json`
- Create: `remotion/theme.ts`
- Create: `remotion/lib/types.ts`

**Step 1: Write the sample card**

`cards/scd-median-survival.json`:

```json
{
  "id": "scd-median-survival",
  "topic": "Hematology Board Review",
  "author": "Your Name",
  "title": "What is the median overall survival of a patient with SCD?",
  "answer": "The estimated median survival for SCD in developed nations is ~60 years.",
  "detail": [
    "The infant and childhood mortality decreased substantially with the introduction of the pneumococcal vaccine.",
    "Although death related to organ failure does occur in SCD, most deaths occur during a vaso-occlusive crisis related to acute chest syndrome, stroke, or venous thromboembolism (VTE).",
    "Elevated hemoglobin F levels are associated with **improved outcomes**.",
    "Coinheritance of **alpha thalassemia** reduces risk of stroke in SCD."
  ]
}
```

**Step 2: Write shared types**

`remotion/lib/types.ts`:

```ts
export type Card = {
  id: string;
  topic: string;
  author: string;
  title: string;
  answer: string;
  detail: string[];
};

export type WordTiming = {
  word: string;
  startMs: number;
  endMs: number;
};

export type SegmentTiming = {
  key: string; // "title" | "answer" | "detail-0" | "detail-1" ...
  text: string;
  audioPath: string;
  durationMs: number;
  words: WordTiming[];
};

export type CardTiming = {
  cardId: string;
  segments: SegmentTiming[];
};
```

**Step 3: Write the theme**

`remotion/theme.ts`:

```ts
export const theme = {
  colors: { bg: "#FFFFFF", ink: "#111111", skeleton: "#E5E5E5", marker: "#111111" },
  fonts: {
    family: "Noto Sans, Noto Sans TC, sans-serif",
    titleSize: 64,
    bodySize: 44,
    headerSize: 24,
  },
  timing: { revealDurationMs: 400, detailGapMs: 300 },
  camera: {
    baseZoomStart: 1.0,
    baseZoomEnd: 1.06,
    switchPushPct: 0.04,
    switchPushFrames: 10,
  },
  marker: { boilFps: 10, boilJitterPx: 1.5, strokeWidth: 3 },
  tts: { voice: "zh-TW-HsiaoChenNeural", rate: "+0%" },
  sfx: { begin: "sfx/Tink.mp3", click: "sfx/Pop.mp3", end: "sfx/Glass.mp3" },
  safeZone: { shorts: { w: 1080, h: 1350 } },
  fps: 30,
} as const;
```

**Step 4: Commit**

```bash
git add cards remotion/theme.ts remotion/lib/types.ts
git commit -m "feat: add card data model, shared types, and design theme"
```

---

## Task 3: De-risk spike — validate zh-TW voice reading English text

This is the highest-risk assumption in the whole design (flagged in the design doc): a `zh-TW` neural voice reading raw English medical text, with word-boundary timestamps accurate enough for karaoke sync. Validate it **before** building anything else on top of it.

**Files:**
- Create: `scripts/spike-tts.ts` (throwaway, delete after validation)

**Step 1: Write the spike script**

```ts
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { mkdirSync } from "fs";

const outDir = "./.spike-output";
mkdirSync(outDir, { recursive: true });

const tts = new MsEdgeTTS();
await tts.setMetadata("zh-TW-HsiaoChenNeural", OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3, {
  wordBoundaryEnabled: true,
  sentenceBoundaryEnabled: true,
});

const text = "What is the median overall survival of a patient with SCD?";
const { audioFilePath, metadataFilePath } = await tts.toFile(outDir, text);

console.log("audio:", audioFilePath);
console.log("metadata:", metadataFilePath);

const raw = JSON.parse(await (await import("fs/promises")).readFile(metadataFilePath!, "utf-8"));
const words = raw.Metadata.filter((m: any) => m.Type === "WordBoundary");
console.log(`${words.length} word boundaries:`);
for (const w of words) {
  console.log(
    `  "${w.Data.text.Text}" ${(w.Data.Offset / 10000).toFixed(0)}ms +${(w.Data.Duration / 10000).toFixed(0)}ms`
  );
}
tts.close();
```

**Step 2: Run it and listen**

Run: `pnpm exec tsx scripts/spike-tts.ts`
Expected: prints `audio:`/`metadata:` paths and a per-word timing list with one entry per English word (roughly — abbreviations like "SCD" may come back as one token or be spelled out).

Run: `afplay .spike-output/audio.mp3`
Listen for: is "SCD" pronounced as letters (S-C-D) or mangled? Is pacing/intonation acceptable for a study video?

**Step 3: Decision gate**

Report back to the user: pronunciation quality, whether word-boundary count roughly matches the number of words (so karaoke sync will look right), and whether abbreviations need special handling (e.g. inserting spaces between letters: "S C D" in the source text if "SCD" reads badly). Do not proceed to Task 4 until the user confirms the voice is acceptable or agrees on a text-preprocessing workaround.

**Step 4: Clean up**

```bash
rm -rf .spike-output scripts/spike-tts.ts
```

(Nothing to commit — this task intentionally leaves no trace once validated.)

---

## Task 4: Pure helper — ticks to milliseconds

**Files:**
- Create: `remotion/lib/timing.ts`
- Test: `remotion/lib/timing.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { ticksToMs } from "./timing";

describe("ticksToMs", () => {
  it("converts 100-nanosecond ticks to milliseconds", () => {
    expect(ticksToMs(10_000_000)).toBe(1000);
    expect(ticksToMs(35_875_000)).toBe(3587.5);
    expect(ticksToMs(0)).toBe(0);
  });
});
```

**Step 2: Run test, verify it fails**

Run: `pnpm exec vitest run remotion/lib/timing.test.ts`
Expected: FAIL — `timing.ts` does not exist / `ticksToMs` is not defined.

**Step 3: Implement**

```ts
export function ticksToMs(ticks: number): number {
  return ticks / 10_000;
}
```

**Step 4: Run test, verify it passes**

Run: `pnpm exec vitest run remotion/lib/timing.test.ts`
Expected: PASS (3 assertions).

**Step 5: Commit**

```bash
git add remotion/lib/timing.ts remotion/lib/timing.test.ts
git commit -m "feat: add ticks-to-milliseconds conversion helper"
```

---

## Task 5: Pure function — normalize msedge-tts metadata into WordTiming[]

**Files:**
- Modify: `remotion/lib/timing.ts`
- Modify: `remotion/lib/timing.test.ts`

**Step 1: Write the failing test**

Append to `remotion/lib/timing.test.ts`:

```ts
import { parseWordTimings } from "./timing";

describe("parseWordTimings", () => {
  it("extracts only WordBoundary entries and converts to ms", () => {
    const raw = {
      Metadata: [
        {
          Type: "WordBoundary",
          Data: { Offset: 1_000_000, Duration: 500_000, text: { Text: "Hi", BoundaryType: "WordBoundary" } },
        },
        {
          Type: "SentenceBoundary",
          Data: { Offset: 0, Duration: 10_000_000, text: { Text: "Hi, how are you?", BoundaryType: "SentenceBoundary" } },
        },
        {
          Type: "WordBoundary",
          Data: { Offset: 1_600_000, Duration: 400_000, text: { Text: "how", BoundaryType: "WordBoundary" } },
        },
      ],
    };

    const words = parseWordTimings(raw);

    expect(words).toEqual([
      { word: "Hi", startMs: 100, endMs: 150 },
      { word: "how", startMs: 160, endMs: 200 },
    ]);
  });

  it("returns an empty array when there are no word boundaries", () => {
    expect(parseWordTimings({ Metadata: [] })).toEqual([]);
  });
});
```

**Step 2: Run test, verify it fails**

Run: `pnpm exec vitest run remotion/lib/timing.test.ts`
Expected: FAIL — `parseWordTimings` is not defined.

**Step 3: Implement**

Add to `remotion/lib/timing.ts`:

```ts
import type { WordTiming } from "./types";

type MsEdgeMetadataItem = {
  Type: string;
  Data: { Offset: number; Duration: number; text: { Text: string } };
};

export function parseWordTimings(raw: { Metadata: MsEdgeMetadataItem[] }): WordTiming[] {
  return raw.Metadata.filter((m) => m.Type === "WordBoundary").map((m) => ({
    word: m.Data.text.Text,
    startMs: ticksToMs(m.Data.Offset),
    endMs: ticksToMs(m.Data.Offset + m.Data.Duration),
  }));
}
```

**Step 4: Run test, verify it passes**

Run: `pnpm exec vitest run remotion/lib/timing.test.ts`
Expected: PASS (5 assertions total).

**Step 5: Commit**

```bash
git add remotion/lib/timing.ts remotion/lib/timing.test.ts
git commit -m "feat: parse msedge-tts metadata into normalized word timings"
```

---

## Task 6: Pure function — markdown `**bold**` marker parser

**Files:**
- Create: `remotion/lib/markers.ts`
- Test: `remotion/lib/markers.test.ts`

**Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { parseMarkers } from "./markers";

describe("parseMarkers", () => {
  it("extracts a single marked range and strips the ** syntax", () => {
    const result = parseMarkers("Elevated hemoglobin F levels are associated with **improved outcomes**.");
    expect(result.plainText).toBe("Elevated hemoglobin F levels are associated with improved outcomes.");
    expect(result.markers).toEqual([{ start: 50, end: 67 }]);
    expect(result.plainText.slice(result.markers[0].start, result.markers[0].end)).toBe("improved outcomes");
  });

  it("supports multiple markers in one string", () => {
    const result = parseMarkers("**alpha** and **beta**");
    expect(result.plainText).toBe("alpha and beta");
    expect(result.markers).toHaveLength(2);
    expect(result.plainText.slice(result.markers[0].start, result.markers[0].end)).toBe("alpha");
    expect(result.plainText.slice(result.markers[1].start, result.markers[1].end)).toBe("beta");
  });

  it("treats unclosed ** as literal text with no marker", () => {
    const result = parseMarkers("this is **broken");
    expect(result.plainText).toBe("this is **broken");
    expect(result.markers).toEqual([]);
  });

  it("returns no markers for plain text", () => {
    const result = parseMarkers("no markers here");
    expect(result.plainText).toBe("no markers here");
    expect(result.markers).toEqual([]);
  });
});
```

**Step 2: Run tests, verify they fail**

Run: `pnpm exec vitest run remotion/lib/markers.test.ts`
Expected: FAIL — module does not exist.

**Step 3: Implement**

```ts
export type Marker = { start: number; end: number };
export type ParsedMarkers = { plainText: string; markers: Marker[] };

export function parseMarkers(input: string): ParsedMarkers {
  const pattern = /\*\*(.+?)\*\*/g;
  let plainText = "";
  let markers: Marker[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(input)) !== null) {
    plainText += input.slice(lastIndex, match.index);
    const start = plainText.length;
    plainText += match[1];
    markers.push({ start, end: plainText.length });
    lastIndex = match.index + match[0].length;
  }
  plainText += input.slice(lastIndex);

  return { plainText, markers };
}
```

**Step 4: Run tests, verify they pass**

Run: `pnpm exec vitest run remotion/lib/markers.test.ts`
Expected: PASS (4 tests).

**Step 5: Commit**

```bash
git add remotion/lib/markers.ts remotion/lib/markers.test.ts
git commit -m "feat: add markdown bold marker parser for highlight effect"
```

---

## Task 7: Pure function — active word lookup for karaoke highlight

**Files:**
- Create: `remotion/lib/karaoke.ts`
- Test: `remotion/lib/karaoke.test.ts`

**Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { activeWordIndex } from "./karaoke";
import type { WordTiming } from "./types";

const words: WordTiming[] = [
  { word: "Hi", startMs: 0, endMs: 100 },
  { word: "how", startMs: 100, endMs: 250 },
  { word: "are", startMs: 250, endMs: 400 },
];

describe("activeWordIndex", () => {
  it("returns the index of the word containing currentMs", () => {
    expect(activeWordIndex(words, 50)).toBe(0);
    expect(activeWordIndex(words, 150)).toBe(1);
  });

  it("returns -1 before the first word starts", () => {
    expect(activeWordIndex(words, -10)).toBe(-1);
  });

  it("returns the last word's index once time is past the end", () => {
    expect(activeWordIndex(words, 10_000)).toBe(2);
  });

  it("returns -1 for an empty word list", () => {
    expect(activeWordIndex([], 100)).toBe(-1);
  });
});
```

**Step 2: Run tests, verify they fail**

Run: `pnpm exec vitest run remotion/lib/karaoke.test.ts`
Expected: FAIL — module does not exist.

**Step 3: Implement**

```ts
import type { WordTiming } from "./types";

export function activeWordIndex(words: WordTiming[], currentMs: number): number {
  if (words.length === 0) return -1;
  if (currentMs < words[0].startMs) return -1;
  if (currentMs >= words[words.length - 1].endMs) return words.length - 1;

  for (let i = 0; i < words.length; i++) {
    if (currentMs >= words[i].startMs && currentMs < words[i].endMs) return i;
  }
  return words.length - 1;
}
```

**Step 4: Run tests, verify they pass**

Run: `pnpm exec vitest run remotion/lib/karaoke.test.ts`
Expected: PASS (4 tests).

**Step 5: Commit**

```bash
git add remotion/lib/karaoke.ts remotion/lib/karaoke.test.ts
git commit -m "feat: add karaoke active-word lookup function"
```

---

## Task 8: Pure function — rolling caption chunker (for Shorts)

**Files:**
- Create: `remotion/lib/captions.ts`
- Test: `remotion/lib/captions.test.ts`

**Step 1: Write the failing tests**

```ts
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
```

**Step 2: Run tests, verify they fail**

Run: `pnpm exec vitest run remotion/lib/captions.test.ts`
Expected: FAIL — module does not exist.

**Step 3: Implement**

```ts
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
```

**Step 4: Run tests, verify they pass**

Run: `pnpm exec vitest run remotion/lib/captions.test.ts`
Expected: PASS (4 tests).

**Step 5: Commit**

```bash
git add remotion/lib/captions.ts remotion/lib/captions.test.ts
git commit -m "feat: add rolling-caption word chunker for Shorts layout"
```

> Note: `maxWordsPerChunk = 14` is a starting point (~3-4 lines at `theme.fonts.bodySize` in the 1080-wide safe zone). Task 16 (Shorts composition) is where we render real text and eyeball whether 14 words wraps to 3-4 lines — adjust the constant there if not.

---

## Task 9: Pure function — camera zoom/push math

**Files:**
- Create: `remotion/lib/camera.ts`
- Test: `remotion/lib/camera.test.ts`

**Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { baseZoom, pushBump } from "./camera";
import { theme } from "../theme";

describe("baseZoom", () => {
  it("starts at baseZoomStart and ends at baseZoomEnd", () => {
    expect(baseZoom(0, 300, theme)).toBeCloseTo(theme.camera.baseZoomStart);
    expect(baseZoom(300, 300, theme)).toBeCloseTo(theme.camera.baseZoomEnd);
  });

  it("is roughly linear at the midpoint", () => {
    const mid = baseZoom(150, 300, theme);
    expect(mid).toBeCloseTo((theme.camera.baseZoomStart + theme.camera.baseZoomEnd) / 2, 3);
  });
});

describe("pushBump", () => {
  it("is at its peak exactly at the switch frame", () => {
    expect(pushBump(100, 100, theme)).toBeCloseTo(theme.camera.switchPushPct);
  });

  it("decays to 0 by switchPushFrames after the switch", () => {
    expect(pushBump(100 + theme.camera.switchPushFrames, 100, theme)).toBeCloseTo(0);
  });

  it("is 0 before the switch frame", () => {
    expect(pushBump(50, 100, theme)).toBe(0);
  });
});
```

**Step 2: Run tests, verify they fail**

Run: `pnpm exec vitest run remotion/lib/camera.test.ts`
Expected: FAIL — module does not exist.

**Step 3: Implement**

```ts
import { interpolate } from "remotion";
import type { theme as themeType } from "../theme";

type Theme = typeof themeType;

export function baseZoom(frame: number, totalFrames: number, theme: Theme): number {
  return interpolate(frame, [0, totalFrames], [theme.camera.baseZoomStart, theme.camera.baseZoomEnd], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

export function pushBump(frame: number, switchFrame: number, theme: Theme): number {
  const t = frame - switchFrame;
  if (t < 0 || t > theme.camera.switchPushFrames) return 0;
  return interpolate(t, [0, theme.camera.switchPushFrames], [theme.camera.switchPushPct, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}
```

**Step 4: Run tests, verify they pass**

Run: `pnpm exec vitest run remotion/lib/camera.test.ts`
Expected: PASS (5 tests).

**Step 5: Commit**

```bash
git add remotion/lib/camera.ts remotion/lib/camera.test.ts
git commit -m "feat: add Ken Burns zoom and detail-switch push math"
```

---

## Task 10: generate-audio.ts — TTS pre-processing script

**Files:**
- Create: `scripts/generate-audio.ts`

**Step 1: Write the script**

```ts
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { theme } from "../remotion/theme";
import { parseWordTimings } from "../remotion/lib/timing";
import type { Card, CardTiming, SegmentTiming } from "../remotion/lib/types";
import { parseMarkers } from "../remotion/lib/markers";

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
  const spokenText = parseMarkers(text).plainText;

  if (existsSync(sourcePath) && readFileSync(sourcePath, "utf-8") === spokenText) {
    const raw = JSON.parse(readFileSync(join(dir, "metadata.json"), "utf-8"));
    const words = parseWordTimings(raw);
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
  const words = parseWordTimings(raw);

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

  const timing: CardTiming = { cardId: card.id, segments };
  writeFileSync(join(AUDIO_DIR, card.id, "timing.json"), JSON.stringify(timing, null, 2));
  console.log(`  wrote timing.json (${segments.length} segments)`);
}

async function main() {
  const files = readdirSync(CARDS_DIR).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    await processCard(join(CARDS_DIR, file));
  }
}

main();
```

**Step 2: Run it**

Run: `pnpm exec tsx scripts/generate-audio.ts`
Expected: `Processing card: scd-median-survival` then `wrote timing.json (6 segments)`. Check `remotion/audio/scd-median-survival/timing.json` exists and each segment has non-empty `words`.

**Step 3: Verify caching works**

Run: `pnpm exec tsx scripts/generate-audio.ts` again.
Expected: same output, but near-instant (no network calls) — caching via `source.txt` comparison is skipping re-synthesis.

**Step 4: Commit**

```bash
git add scripts/generate-audio.ts
git commit -m "feat: add TTS pre-processing script with per-segment caching"
```

---

## Task 11: Copy macOS sound effects into public/

**Files:**
- Create: `public/sfx/Tink.mp3`, `public/sfx/Pop.mp3`, `public/sfx/Glass.mp3`

**Step 1: Convert and copy**

Remotion renders can't reference absolute system paths, and `.aiff` support in the render pipeline is inconsistent — convert to mp3 into `public/sfx/`:

```bash
mkdir -p public/sfx
afconvert -f mp4f -d aac /System/Library/Sounds/Tink.aiff public/sfx/Tink.m4a
afconvert -f mp4f -d aac /System/Library/Sounds/Pop.aiff public/sfx/Pop.m4a
afconvert -f mp4f -d aac /System/Library/Sounds/Glass.aiff public/sfx/Glass.m4a
```

**Step 2: Update theme.ts sfx paths to match the `.m4a` extension**

Modify `remotion/theme.ts`:

```ts
  sfx: { begin: "sfx/Tink.m4a", click: "sfx/Pop.m4a", end: "sfx/Glass.m4a" },
```

**Step 3: Verify playback**

Run: `afplay public/sfx/Pop.m4a`
Expected: audible short pop sound.

**Step 4: Commit**

Note: `public/sfx/` is gitignored (generated from system files, not portable across machines). Instead, commit a small script so any dev can regenerate them:

Create `scripts/copy-sfx.sh`:

```bash
#!/bin/sh
set -e
mkdir -p public/sfx
afconvert -f mp4f -d aac /System/Library/Sounds/Tink.aiff public/sfx/Tink.m4a
afconvert -f mp4f -d aac /System/Library/Sounds/Pop.aiff public/sfx/Pop.m4a
afconvert -f mp4f -d aac /System/Library/Sounds/Glass.aiff public/sfx/Glass.m4a
echo "sfx copied to public/sfx/"
```

```bash
chmod +x scripts/copy-sfx.sh
git add scripts/copy-sfx.sh remotion/theme.ts
git commit -m "feat: add sfx setup script and point theme at generated mp4 audio"
```

---

## Task 12: Skeleton, Header, MarkerText, KaraokeText components

**Files:**
- Create: `remotion/components/Skeleton.tsx`
- Create: `remotion/components/Header.tsx`
- Create: `remotion/components/MarkerText.tsx`
- Create: `remotion/components/KaraokeText.tsx`

**Step 1: Skeleton**

```tsx
import { useCurrentFrame, interpolate } from "remotion";
import { theme } from "../theme";

export function Skeleton({ width, height }: { width: number; height: number }) {
  const frame = useCurrentFrame();
  const shimmer = interpolate(frame % 40, [0, 40], [-width, width]);
  return (
    <div style={{ width, height, background: theme.colors.skeleton, borderRadius: 12, overflow: "hidden", position: "relative" }}>
      <div
        style={{
          position: "absolute",
          top: 0,
          left: shimmer,
          width: width * 0.4,
          height: "100%",
          background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.6), transparent)",
        }}
      />
    </div>
  );
}
```

**Step 2: Header**

```tsx
import { theme } from "../theme";

export function Header({ topic, author, position }: { topic: string; author?: string; position: "top" | "bottom" }) {
  return (
    <div
      style={{
        position: "absolute",
        [position]: 24,
        left: 24,
        fontFamily: theme.fonts.family,
        fontSize: theme.fonts.headerSize,
        color: theme.colors.ink,
        opacity: 0.6,
      }}
    >
      {topic}
      {author ? ` · ${author}` : ""}
    </div>
  );
}
```

**Step 3: MarkerText**

```tsx
import { random } from "remotion";
import { theme } from "../theme";
import { parseMarkers } from "../lib/markers";

export function MarkerText({ text, frame, fontSize }: { text: string; frame: number; fontSize: number }) {
  const { plainText, markers } = parseMarkers(text);
  const boilFrame = Math.floor((frame / 30) * theme.marker.boilFps);

  return (
    <span style={{ position: "relative", fontFamily: theme.fonts.family, fontSize, color: theme.colors.ink }}>
      {plainText}
      <svg style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
        {markers.map((m, i) => {
          const jitter = (seed: number) =>
            (random(`marker-${i}-${boilFrame}-${seed}`) - 0.5) * 2 * theme.marker.boilJitterPx;
          // Approximate horizontal position by character fraction; refine visually once real text renders.
          const startFrac = m.start / plainText.length;
          const endFrac = m.end / plainText.length;
          return (
            <line
              key={i}
              x1={`${startFrac * 100 + jitter(1)}%`}
              x2={`${endFrac * 100 + jitter(2)}%`}
              y1={`${100 + jitter(3)}%`}
              y2={`${100 + jitter(4)}%`}
              stroke={theme.colors.marker}
              strokeWidth={theme.marker.strokeWidth}
              strokeLinecap="round"
            />
          );
        })}
      </svg>
    </span>
  );
}
```

**Step 4: KaraokeText**

```tsx
import { theme } from "../theme";
import { activeWordIndex } from "../lib/karaoke";
import { MarkerText } from "./MarkerText";
import type { WordTiming } from "../lib/types";

export function KaraokeText({
  words,
  currentMs,
  frame,
  fontSize,
}: {
  words: WordTiming[];
  currentMs: number;
  frame: number;
  fontSize: number;
}) {
  const active = activeWordIndex(words, currentMs);
  return (
    <div style={{ fontFamily: theme.fonts.family, fontSize, color: theme.colors.ink, lineHeight: 1.4 }}>
      {words.map((w, i) => (
        <span key={i} style={{ opacity: i <= active ? 1 : 0.35, marginRight: "0.3em" }}>
          <MarkerText text={w.word} frame={frame} fontSize={fontSize} />
        </span>
      ))}
    </div>
  );
}
```

**Step 5: Verify visually**

These are pure-render components with no test coverage of their own (the logic they call — `activeWordIndex`, `parseMarkers` — is already tested). Visual correctness is verified in Task 15/16 once wired into a real composition in Remotion Studio.

**Step 6: Commit**

```bash
git add remotion/components/Skeleton.tsx remotion/components/Header.tsx remotion/components/MarkerText.tsx remotion/components/KaraokeText.tsx
git commit -m "feat: add Skeleton, Header, MarkerText, and KaraokeText components"
```

---

## Task 13: RollingCaption component (Shorts)

**Files:**
- Create: `remotion/components/RollingCaption.tsx`

**Step 1: Implement**

```tsx
import { theme } from "../theme";
import { chunkWords, activeChunkIndex } from "../lib/captions";
import { activeWordIndex } from "../lib/karaoke";
import { MarkerText } from "./MarkerText";
import type { WordTiming } from "../lib/types";

export function RollingCaption({
  words,
  currentMs,
  frame,
  fontSize,
  maxWordsPerChunk = 14,
}: {
  words: WordTiming[];
  currentMs: number;
  frame: number;
  fontSize: number;
  maxWordsPerChunk?: number;
}) {
  const chunks = chunkWords(words, maxWordsPerChunk);
  const activeChunk = chunks[activeChunkIndex(chunks, currentMs)];
  if (!activeChunk) return null;

  const active = activeWordIndex(activeChunk.words, currentMs);
  return (
    <div
      style={{
        fontFamily: theme.fonts.family,
        fontSize,
        color: theme.colors.ink,
        textAlign: "center",
        lineHeight: 1.5,
      }}
    >
      {activeChunk.words.map((w, i) => (
        <span key={i} style={{ opacity: i <= active ? 1 : 0.35, marginRight: "0.3em" }}>
          <MarkerText text={w.word} marked={w.marked} frame={frame} fontSize={fontSize} />
        </span>
      ))}
    </div>
  );
}
```

**Step 2: Verify visually in Task 16**

**Step 3: Commit**

```bash
git add remotion/components/RollingCaption.tsx
git commit -m "feat: add RollingCaption component for Shorts word chunks"
```

---

## Task 14: Root.tsx and shared timeline hook

**Files:**
- Create: `remotion/Root.tsx`
- Create: `remotion/lib/useCardTimeline.ts`

**Step 1: Build the shared timeline hook**

This computes, in frames, when each phase (title/reveal/answer/detail-N/end) starts, from the `CardTiming` JSON produced by Task 10. Both compositions use it so LongForm and Shorts never drift out of sync.

```ts
import { theme } from "../theme";
import type { CardTiming } from "./types";

export type PhaseFrame = { key: string; startFrame: number; endFrame: number };

export function buildTimeline(timing: CardTiming): { phases: PhaseFrame[]; totalFrames: number } {
  const gapFrames = Math.round((theme.timing.detailGapMs / 1000) * theme.fps);
  let cursor = 0;
  const phases: PhaseFrame[] = [];

  for (const segment of timing.segments) {
    const durationFrames = Math.round((segment.durationMs / 1000) * theme.fps);
    phases.push({ key: segment.key, startFrame: cursor, endFrame: cursor + durationFrames });
    cursor += durationFrames + gapFrames;
  }

  const endHoldFrames = Math.round(1.5 * theme.fps);
  return { phases, totalFrames: cursor + endHoldFrames };
}
```

**Step 2: Register compositions in Root.tsx**

```tsx
import { Composition } from "remotion";
import { readFileSync } from "fs";
import { join } from "path";
import { LongForm } from "./compositions/LongForm";
import { Shorts } from "./compositions/Shorts";
import { buildTimeline } from "./lib/useCardTimeline";
import { theme } from "./theme";
import type { CardTiming } from "./lib/types";

function loadTiming(cardId: string): CardTiming {
  return JSON.parse(readFileSync(join("remotion/audio", cardId, "timing.json"), "utf-8"));
}

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="LongForm"
        component={LongForm}
        width={1920}
        height={1080}
        fps={theme.fps}
        durationInFrames={150}
        defaultProps={{ cardId: "scd-median-survival" }}
        calculateMetadata={async ({ props }) => {
          const timing = loadTiming(props.cardId);
          const { totalFrames } = buildTimeline(timing);
          return { durationInFrames: totalFrames, props: { ...props, timing } };
        }}
      />
      <Composition
        id="Shorts"
        component={Shorts}
        width={1080}
        height={1920}
        fps={theme.fps}
        durationInFrames={150}
        defaultProps={{ cardId: "scd-median-survival" }}
        calculateMetadata={async ({ props }) => {
          const timing = loadTiming(props.cardId);
          const { totalFrames } = buildTimeline(timing);
          return { durationInFrames: totalFrames, props: { ...props, timing } };
        }}
      />
    </>
  );
};
```

**Step 3: Verify**

Run: `pnpm exec tsx scripts/generate-audio.ts` (if not already run for this card)
Run: `pnpm studio`
Expected: Remotion Studio opens, lists `LongForm` and `Shorts` compositions (they'll error until Task 15/16 create the component files — that's expected here, fix in next tasks).

**Step 4: Commit**

```bash
git add remotion/Root.tsx remotion/lib/useCardTimeline.ts
git commit -m "feat: register compositions and add timeline-from-audio hook"
```

---

## Task 15: LongForm composition

**Files:**
- Create: `remotion/compositions/LongForm.tsx`

**Step 1: Implement**

```tsx
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../theme";
import { Header } from "../components/Header";
import { Skeleton } from "../components/Skeleton";
import { KaraokeText } from "../components/KaraokeText";
import { baseZoom, pushBump } from "../lib/camera";
import { buildTimeline } from "../lib/useCardTimeline";
import type { CardTiming } from "../lib/types";

export function LongForm({ timing, topic, author }: { cardId?: string; timing: CardTiming; topic: string; author: string }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { phases, totalFrames } = buildTimeline(timing);
  const byKey = Object.fromEntries(timing.segments.map((s) => [s.key, s]));
  const phaseByKey = Object.fromEntries(phases.map((p) => [p.key, p]));

  const detailPhases = phases.filter((p) => p.key.startsWith("detail-"));
  const nearestSwitch = detailPhases.reduce(
    (best, p) => (Math.abs(p.startFrame - frame) < Math.abs(best - frame) ? p.startFrame : best),
    -Infinity
  );

  const zoom = baseZoom(frame, totalFrames, theme) + pushBump(frame, nearestSwitch, theme);
  const titlePhase = phaseByKey["title"];
  const answerPhase = phaseByKey["answer"];
  const titleDone = frame >= titlePhase.endFrame;

  return (
    <AbsoluteFill style={{ background: theme.colors.bg }}>
      <AbsoluteFill style={{ transform: `scale(${zoom})` }}>
        <Header topic={topic} author={author} position="top" />

        <Sequence from={0} durationInFrames={titlePhase.endFrame}>
          <div style={{ position: "absolute", top: 120, left: 120, width: 1680 }}>
            <KaraokeText
              words={byKey["title"].words}
              currentMs={(frame / fps) * 1000}
              frame={frame}
              fontSize={theme.fonts.titleSize}
            />
          </div>
        </Sequence>

        {!titleDone && (
          <div style={{ position: "absolute", top: 400, left: 120 }}>
            <Skeleton width={1680} height={500} />
          </div>
        )}

        {titleDone && (
          <Sequence from={answerPhase.startFrame}>
            <div style={{ position: "absolute", top: 400, left: 120, width: 1680 }}>
              <KaraokeText
                words={byKey["answer"].words}
                currentMs={((frame - answerPhase.startFrame) / fps) * 1000}
                frame={frame}
                fontSize={theme.fonts.bodySize}
              />
            </div>
          </Sequence>
        )}

        {timing.segments
          .filter((s) => s.key.startsWith("detail-"))
          .map((seg) => {
            const p = phaseByKey[seg.key];
            return (
              <Sequence key={seg.key} from={p.startFrame}>
                <div style={{ position: "absolute", top: 620, left: 120, width: 1680 }}>
                  <KaraokeText
                    words={seg.words}
                    currentMs={((frame - p.startFrame) / fps) * 1000}
                    frame={frame}
                    fontSize={theme.fonts.bodySize}
                  />
                </div>
              </Sequence>
            );
          })}
      </AbsoluteFill>

      <Audio src={staticFile(theme.sfx.begin)} />
      {titleDone && <Sequence from={titlePhase.endFrame} durationInFrames={5}><Audio src={staticFile(theme.sfx.click)} /></Sequence>}
      {detailPhases.map((p) => (
        <Sequence key={p.key} from={p.startFrame} durationInFrames={5}>
          <Audio src={staticFile(theme.sfx.click)} />
        </Sequence>
      ))}
      <Sequence from={totalFrames - fps} durationInFrames={5}>
        <Audio src={staticFile(theme.sfx.end)} />
      </Sequence>

      {timing.segments.map((seg) => {
        const p = phaseByKey[seg.key];
        return <Audio key={seg.key} src={staticFile(seg.audioPath.replace(/^remotion\//, ""))} startFrom={0} from={p.startFrame} />;
      })}
    </AbsoluteFill>
  );
}
```

**Step 2: Make audio files reachable via staticFile**

Remotion's `staticFile()` resolves from `public/`. Since `generate-audio.ts` writes to `remotion/audio/`, symlink or copy that tree into `public/` before rendering:

Add to `scripts/generate-audio.ts`, at the end of `main()`:

```ts
import { cpSync } from "fs";
// ...
cpSync(AUDIO_DIR, "public/audio", { recursive: true });
```

And add `public/audio/` to `.gitignore` (it's regenerated, same as `remotion/audio/`).

**Step 3: Verify in Studio**

Run: `pnpm studio`, open `LongForm`, scrub the timeline.
Expected: Header visible throughout; title text karaoke-highlights while Skeleton sits below it; once title's audio duration elapses, Skeleton disappears and Answer fades in and highlights; each detail paragraph appears in turn with a small camera push at the switch; audio (once briefly muted/unmuted while checking) is audible and roughly in sync with highlighted words.

**Step 4: Commit**

```bash
git add remotion/compositions/LongForm.tsx scripts/generate-audio.ts .gitignore
git commit -m "feat: implement LongForm composition with full timeline"
```

---

## Task 16: Shorts composition

**Files:**
- Create: `remotion/compositions/Shorts.tsx`

**Step 1: Implement**

Same phase logic as `LongForm`, but text is constrained to the 1080×1350 safe zone and uses `RollingCaption` instead of full-block `KaraokeText` for answer/detail.

```tsx
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../theme";
import { Header } from "../components/Header";
import { Skeleton } from "../components/Skeleton";
import { KaraokeText } from "../components/KaraokeText";
import { RollingCaption } from "../components/RollingCaption";
import { baseZoom, pushBump } from "../lib/camera";
import { buildTimeline } from "../lib/useCardTimeline";
import type { CardTiming } from "../lib/types";

const SAFE_TOP = (1920 - theme.safeZone.shorts.h) / 2;
const SAFE_LEFT = (1080 - theme.safeZone.shorts.w) / 2;

export function Shorts({ timing, topic, author }: { cardId?: string; timing: CardTiming; topic: string; author: string }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { phases, totalFrames } = buildTimeline(timing);
  const byKey = Object.fromEntries(timing.segments.map((s) => [s.key, s]));
  const phaseByKey = Object.fromEntries(phases.map((p) => [p.key, p]));

  const detailPhases = phases.filter((p) => p.key.startsWith("detail-"));
  const nearestSwitch = detailPhases.reduce(
    (best, p) => (Math.abs(p.startFrame - frame) < Math.abs(best - frame) ? p.startFrame : best),
    -Infinity
  );
  const zoom = baseZoom(frame, totalFrames, theme) + pushBump(frame, nearestSwitch, theme);

  const titlePhase = phaseByKey["title"];
  const answerPhase = phaseByKey["answer"];
  const titleDone = frame >= titlePhase.endFrame;

  return (
    <AbsoluteFill style={{ background: theme.colors.bg }}>
      <AbsoluteFill style={{ transform: `scale(${zoom})` }}>
        <Header topic={topic} author={author} position="top" />

        <Sequence from={0} durationInFrames={titlePhase.endFrame}>
          <div style={{ position: "absolute", top: SAFE_TOP, left: SAFE_LEFT, width: theme.safeZone.shorts.w }}>
            <KaraokeText
              words={byKey["title"].words}
              currentMs={(frame / fps) * 1000}
              frame={frame}
              fontSize={theme.fonts.bodySize}
            />
          </div>
        </Sequence>

        {!titleDone && (
          <div style={{ position: "absolute", top: SAFE_TOP + 300, left: SAFE_LEFT }}>
            <Skeleton width={theme.safeZone.shorts.w} height={400} />
          </div>
        )}

        {titleDone && (
          <Sequence from={answerPhase.startFrame}>
            <div style={{ position: "absolute", top: SAFE_TOP + 300, left: SAFE_LEFT, width: theme.safeZone.shorts.w }}>
              <RollingCaption
                words={byKey["answer"].words}
                currentMs={((frame - answerPhase.startFrame) / fps) * 1000}
                frame={frame}
                fontSize={theme.fonts.bodySize}
              />
            </div>
          </Sequence>
        )}

        {timing.segments
          .filter((s) => s.key.startsWith("detail-"))
          .map((seg) => {
            const p = phaseByKey[seg.key];
            return (
              <Sequence key={seg.key} from={p.startFrame}>
                <div style={{ position: "absolute", top: SAFE_TOP + 600, left: SAFE_LEFT, width: theme.safeZone.shorts.w }}>
                  <RollingCaption
                    words={seg.words}
                    currentMs={((frame - p.startFrame) / fps) * 1000}
                    frame={frame}
                    fontSize={theme.fonts.bodySize}
                  />
                </div>
              </Sequence>
            );
          })}
      </AbsoluteFill>

      <Audio src={staticFile(theme.sfx.begin)} />
      {detailPhases.map((p) => (
        <Sequence key={p.key} from={p.startFrame} durationInFrames={5}>
          <Audio src={staticFile(theme.sfx.click)} />
        </Sequence>
      ))}
      <Sequence from={totalFrames - fps} durationInFrames={5}>
        <Audio src={staticFile(theme.sfx.end)} />
      </Sequence>

      {timing.segments.map((seg) => {
        const p = phaseByKey[seg.key];
        return <Audio key={seg.key} src={staticFile(seg.audioPath.replace(/^remotion\//, ""))} from={p.startFrame} />;
      })}
    </AbsoluteFill>
  );
}
```

**Step 2: Verify in Studio**

Run: `pnpm studio`, open `Shorts`, scrub the timeline.
Expected: all text stays inside the central safe-zone box (compare against `youtube-shorts-safe-zone.png`); answer/detail render as rolling 3-4 line chunks instead of one full block. If a chunk visually wraps to more or fewer than 3-4 lines at `theme.fonts.bodySize`, adjust `maxWordsPerChunk` in the `RollingCaption` call here (not in the tested default) until it looks right.

**Step 3: Commit**

```bash
git add remotion/compositions/Shorts.tsx
git commit -m "feat: implement Shorts composition with safe-zone rolling captions"
```

---

## Task 17: render.ts — batch render script

**Files:**
- Create: `scripts/render.ts`

**Step 1: Implement**

```ts
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { readdirSync } from "fs";
import { join } from "path";

const CARDS_DIR = "cards";
const OUT_DIR = "out";

async function main() {
  const bundleLocation = await bundle({ entryPoint: join("remotion", "Root.tsx") });
  const cardFiles = readdirSync(CARDS_DIR).filter((f) => f.endsWith(".json"));

  for (const file of cardFiles) {
    const cardId = file.replace(/\.json$/, "");
    const { id: cardIdJson, topic, author } = JSON.parse(
      await (await import("fs/promises")).readFile(join(CARDS_DIR, file), "utf-8")
    );

    for (const compositionId of ["LongForm", "Shorts"] as const) {
      const composition = await selectComposition({
        serveUrl: bundleLocation,
        id: compositionId,
        inputProps: { cardId: cardIdJson, topic, author },
      });

      const outputLocation = join(OUT_DIR, `${cardId}-${compositionId}.mp4`);
      console.log(`Rendering ${outputLocation} (${composition.durationInFrames} frames)...`);

      await renderMedia({
        composition,
        serveUrl: bundleLocation,
        codec: "h264",
        outputLocation,
        inputProps: { cardId: cardIdJson, topic, author },
      });

      console.log(`  done: ${outputLocation}`);
    }
  }
}

main();
```

**Step 2: Run it**

Run: `pnpm exec tsx scripts/render.ts`
Expected: `out/scd-median-survival-LongForm.mp4` and `out/scd-median-survival-Shorts.mp4` both created.

**Step 3: Spot-check the output**

Run: `open out/scd-median-survival-LongForm.mp4` (and the Shorts one)
Watch both end-to-end. Confirm: narration audible, karaoke/rolling captions track the voice, sfx play at the right moments, camera zoom/push feels subtle not seasick, marker underline shows on "improved outcomes" and "alpha thalassemia".

**Step 4: Commit**

```bash
git add scripts/render.ts
git commit -m "feat: add batch render script for LongForm and Shorts"
```

---

## Task 18: Smoke test

**Files:**
- Create: `scripts/smoke-test.ts`

**Step 1: Implement**

```ts
import { execSync } from "child_process";
import { statSync, readFileSync } from "fs";
import { join } from "path";

const CARD_ID = "scd-median-survival";

function ffprobeDurationSeconds(path: string): number {
  const out = execSync(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${path}"`
  );
  return parseFloat(out.toString());
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`SMOKE TEST FAILED: ${message}`);
  console.log(`  ok: ${message}`);
}

async function main() {
  console.log("Running generate-audio...");
  execSync("pnpm exec tsx scripts/generate-audio.ts", { stdio: "inherit" });

  console.log("Running render...");
  execSync("pnpm exec tsx scripts/render.ts", { stdio: "inherit" });

  const timing = JSON.parse(readFileSync(join("remotion/audio", CARD_ID, "timing.json"), "utf-8"));
  const expectedNarrationMs = timing.segments.reduce((sum: number, s: any) => sum + s.durationMs, 0);

  for (const compositionId of ["LongForm", "Shorts"]) {
    const path = join("out", `${CARD_ID}-${compositionId}.mp4`);
    const stat = statSync(path);
    assert(stat.size > 0, `${path} is non-empty`);

    const durationSeconds = ffprobeDurationSeconds(path);
    const durationMs = durationSeconds * 1000;
    assert(
      durationMs >= expectedNarrationMs,
      `${compositionId} duration (${durationMs.toFixed(0)}ms) covers total narration (${expectedNarrationMs.toFixed(0)}ms)`
    );
  }

  console.log("SMOKE TEST PASSED");
}

main();
```

**Step 2: Run it**

Run: `pnpm exec tsx scripts/smoke-test.ts`
Expected: series of `ok:` lines ending in `SMOKE TEST PASSED`. Requires `ffprobe` on PATH (`brew install ffmpeg` if missing).

**Step 3: Commit**

```bash
git add scripts/smoke-test.ts
git commit -m "test: add end-to-end smoke test for audio+render pipeline"
```

---

## Task 19: Edge case tests

**Files:**
- Modify: `remotion/lib/markers.test.ts`
- Modify: `remotion/lib/captions.test.ts`
- Create: `remotion/lib/header-fallback.test.ts` (or fold into Header if it grows logic)

**Step 1: Add marker edge cases**

Append to `remotion/lib/markers.test.ts`:

```ts
it("handles nested-looking markers by matching the shortest non-greedy span", () => {
  const result = parseMarkers("**a** **b** **c**");
  expect(result.markers).toHaveLength(3);
});

it("preserves Greek letters and special characters", () => {
  const result = parseMarkers("Coinheritance of **alpha thalassemia** (α) reduces risk.");
  expect(result.plainText).toContain("α");
  expect(result.plainText.slice(result.markers[0].start, result.markers[0].end)).toBe("alpha thalassemia");
});
```

Run: `pnpm exec vitest run remotion/lib/markers.test.ts` — expect PASS.

**Step 2: Add caption chunker edge cases**

Append to `remotion/lib/captions.test.ts`:

```ts
it("handles a single word", () => {
  const chunks = chunkWords(makeWords(1), 14);
  expect(chunks).toHaveLength(1);
  expect(chunks[0].words).toHaveLength(1);
});
```

Run: `pnpm exec vitest run remotion/lib/captions.test.ts` — expect PASS.

**Step 3: Add a card fixture stressing detail-array size**

Create `cards/_fixture-edge-cases.json` (underscore prefix keeps it out of normal batch runs if you filter by naming convention, or just delete after manual testing):

```json
{
  "id": "fixture-edge-cases",
  "topic": "Test Fixture",
  "author": "",
  "title": "Edge case card with one detail paragraph",
  "answer": "Short answer.",
  "detail": ["Just one detail paragraph to confirm a single-segment card still renders end-to-end."]
}
```

Run: `pnpm exec tsx scripts/generate-audio.ts && pnpm exec tsx scripts/render.ts`
Expected: renders `fixture-edge-cases-LongForm.mp4` / `-Shorts.mp4` without crashing, and the empty `author` string doesn't render a stray `" · "` separator in Header (if it does, fix `Header.tsx`'s `author ? ...: ""` check to also treat `""` as falsy — it already does, since `""` is falsy in JS).

**Step 4: Delete the fixture card once verified (or keep as a permanent regression fixture — your call)**

**Step 5: Commit**

```bash
git add remotion/lib/markers.test.ts remotion/lib/captions.test.ts cards/_fixture-edge-cases.json
git commit -m "test: add edge case coverage for markers, captions, and single-detail cards"
```

---

## Task 20: Final full test run and wrap-up

**Step 1: Run the full test suite**

Run: `pnpm test`
Expected: all vitest files pass.

**Step 2: Run the smoke test one more time**

Run: `pnpm exec tsx scripts/smoke-test.ts`
Expected: `SMOKE TEST PASSED`.

**Step 3: Hand off**

At this point the pipeline can take any `cards/*.json` and produce both video formats. Use `superpowers:finishing-a-development-branch` to decide how to merge `feature/implement-pipeline` back into `main`.
