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

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
