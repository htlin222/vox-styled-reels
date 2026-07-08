import { readdirSync, readFileSync } from "fs";
import { basename, join } from "path";
import { cardSchema } from "../remotion/lib/cardSchema";

export { cardSchema };

const CARDS_DIR = "cards";

function main() {
  const files = process.argv.slice(2).length
    ? process.argv.slice(2)
    : readdirSync(CARDS_DIR)
        .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
        .map((f) => join(CARDS_DIR, f));

  let failed = false;
  for (const file of files) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(file, "utf-8"));
    } catch (e) {
      console.error(`✗ ${file}: invalid JSON — ${(e as Error).message}`);
      failed = true;
      continue;
    }

    const result = cardSchema.safeParse(parsed);
    if (!result.success) {
      console.error(`✗ ${file}:`);
      for (const issue of result.error.issues) {
        console.error(`    ${issue.path.join(".") || "(root)"}: ${issue.message}`);
      }
      failed = true;
      continue;
    }

    const expectedId = basename(file, ".json");
    if (result.data.id !== expectedId) {
      console.error(`✗ ${file}: id "${result.data.id}" must match filename "${expectedId}"`);
      failed = true;
      continue;
    }

    console.log(`✓ ${file}`);
  }

  if (failed) process.exit(1);
}

main();
