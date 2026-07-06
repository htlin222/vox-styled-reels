import { readdirSync, readFileSync } from "fs";
import { basename, join } from "path";
import { z } from "zod";

const CARDS_DIR = "cards";

const nonEmpty = z.string().trim().min(1);

export const cardSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "id must be kebab-case (lowercase letters, digits, hyphens)"),
    main: nonEmpty,
    section: nonEmpty,
    topic: nonEmpty,
    author: nonEmpty,
    title: nonEmpty,
    answer: nonEmpty,
    detail: z.array(nonEmpty).min(1),
  })
  .strict();

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
