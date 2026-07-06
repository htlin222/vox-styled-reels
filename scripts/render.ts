import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { execSync } from "child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { VERSION } from "remotion";
import { theme } from "../remotion/theme";

const CARDS_DIR = "cards";
const AUDIO_DIR = "remotion/audio";
const OUT_DIR = "out";

// Each card renders into its own folder: out/<slug>/{long.mp4, short.mp4,
// audio.mp3, config.json}. audio.mp3 is the final mix (narration + music + sfx)
// pulled from the long cut; config.json snapshots everything needed to
// reproduce this exact render later.
const CUTS = [
  { compositionId: "LongForm", outName: "long.mp4" },
  { compositionId: "Shorts", outName: "short.mp4" },
] as const;

async function main() {
  // Must point at remotion/index.ts (the file that calls registerRoot()), not Root.tsx directly —
  // see Task 14 Step 2b. bundle() validates that the entry point file literally contains "registerRoot".
  const bundleLocation = await bundle({ entryPoint: join("remotion", "index.ts"), publicDir: "assets" });
  const cardFiles = readdirSync(CARDS_DIR).filter((f) => f.endsWith(".json") && !f.startsWith("_"));

  for (const file of cardFiles) {
    const cardId = file.replace(/\.json$/, "");
    const card = JSON.parse(readFileSync(join(CARDS_DIR, file), "utf-8"));
    const { id: cardIdJson, topic, author } = card;
    const cardOut = join(OUT_DIR, cardId);
    mkdirSync(cardOut, { recursive: true });

    for (const { compositionId, outName } of CUTS) {
      const composition = await selectComposition({
        serveUrl: bundleLocation,
        id: compositionId,
        inputProps: { cardId: cardIdJson, topic, author },
      });

      const outputLocation = join(cardOut, outName);
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

    execSync(`ffmpeg -y -i "${join(cardOut, "long.mp4")}" -vn -q:a 2 "${join(cardOut, "audio.mp3")}"`, {
      stdio: "ignore",
    });
    console.log(`  done: ${join(cardOut, "audio.mp3")}`);

    const timing = JSON.parse(readFileSync(join(AUDIO_DIR, cardId, "timing.json"), "utf-8"));
    const config = {
      renderedAt: new Date().toISOString(),
      gitCommit: execSync("git rev-parse HEAD").toString().trim(),
      remotionVersion: VERSION,
      card,
      timing,
      theme,
    };
    writeFileSync(join(cardOut, "config.json"), JSON.stringify(config, null, 2));
    console.log(`  done: ${join(cardOut, "config.json")}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
