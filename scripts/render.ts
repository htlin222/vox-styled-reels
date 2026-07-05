import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { readdirSync } from "fs";
import { join } from "path";

const CARDS_DIR = "cards";
const OUT_DIR = "out";

async function main() {
  // Must point at remotion/index.ts (the file that calls registerRoot()), not Root.tsx directly —
  // see Task 14 Step 2b. bundle() validates that the entry point file literally contains "registerRoot".
  const bundleLocation = await bundle({ entryPoint: join("remotion", "index.ts") });
  const cardFiles = readdirSync(CARDS_DIR).filter((f) => f.endsWith(".json") && !f.startsWith("_"));

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

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
