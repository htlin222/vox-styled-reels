// Convert a GitHub Issue body into one or more strict card JSON files.
//
// Driven by .github/workflows/issue-to-card.yml: the issue body/title/author
// arrive via env vars, Groq turns the prose into JSON matching the card
// schema, and each card is written to cards/<id>.json for a PR. The LLM output
// is validated against the exact same zod schema that gates a render, so a
// malformed card fails here rather than in the build.
//
// Env:
//   GROQ_API_KEY   (required) Groq API key
//   ISSUE_TITLE    issue title (context for the model)
//   ISSUE_BODY     (required) issue markdown body
//   ISSUE_AUTHOR   GitHub login / display name, used as the card author
//   GROQ_MODEL     optional model override
//
// Writes the created filenames (one per line) to $GITHUB_OUTPUT as `files=...`
// when running in Actions; always prints them to stdout.

import { writeFileSync, appendFileSync } from "fs";
import { join } from "path";
import { cardSchema, type CardInput } from "../remotion/lib/cardSchema";

const CARDS_DIR = "cards";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// A meaningful, filename-safe id. Prefer the model's id, but reject empty or
// generic placeholders ("card-3") and fall back to the first few title words —
// the id becomes both the filename and the release tag (card-<id>), so it
// should describe the card, not its position.
function deriveId(rawId: string | undefined, title: string | undefined, index: number): string {
  const fromId = slugify(rawId ?? "");
  if (fromId && !/^card-?\d+$/.test(fromId)) return fromId;
  const fromTitle = slugify(title ?? "").split("-").slice(0, 7).join("-");
  return fromTitle || `card-${index + 1}`;
}

// The schema the model must satisfy, described in prose for the prompt. Kept in
// sync with remotion/lib/cardSchema.ts by hand — the zod parse below is the
// real gate, so drift only shows up as a rejected card, never a bad render.
const SCHEMA_DESC = `{
  "cards": [
    {
      "id": "kebab-case-slug",            // lowercase letters, digits, hyphens; unique per card; also the filename
      "main": "string",                    // top-level collection, e.g. "Board Review"
      "section": "string",                 // broad specialty, e.g. "Hematology"
      "topic": "string",                   // specific subject, e.g. "Aplastic Anemia"
      "author": "string",                  // author name
      "title": "string",                   // the question
      "answer": "string",                  // the concise answer
      "detail": ["string", "..."],         // 1+ supporting bullet points
      "releaseNote": "string"              // one-paragraph summary of the card
    }
  ]
}`;

// Split a multi-card issue into per-card chunks. Prefer explicit "### Card N"
// headings; fall back to horizontal rules; otherwise treat the whole body as
// one card. Chunking keeps each Groq request well under the free-tier
// tokens-per-minute cap — a 20-card issue in one shot blows past it.
function splitIntoChunks(body: string): string[] {
  // Drop a trailing References/Figure section: it's shared, not per-card, and
  // just wastes tokens.
  const trimmed = body.replace(/\n#{1,6}\s*References[\s\S]*$/i, "").trim();

  const byCardHeading = trimmed.split(/\n(?=#{1,6}\s*Card\b)/i).filter((s) => /#{1,6}\s*Card\b/i.test(s));
  if (byCardHeading.length > 1) return byCardHeading.map((s) => s.trim());

  const byRule = trimmed
    .split(/\n-{3,}\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (byRule.length > 1) return byRule;

  return [trimmed];
}

// Pack chunks into batches under a rough character budget (~4 chars/token) so
// each request's prompt stays small enough for the TPM limit.
function batchChunks(chunks: string[], maxChars = 3000): string[] {
  const batches: string[] = [];
  let current = "";
  for (const chunk of chunks) {
    if (current && current.length + chunk.length > maxChars) {
      batches.push(current);
      current = "";
    }
    current = current ? `${current}\n\n${chunk}` : chunk;
  }
  if (current) batches.push(current);
  return batches;
}

function buildPrompt(title: string, body: string, author: string): string {
  return `請把以下 GitHub Issue 內容轉換成「嚴格合法 JSON」。

規則：
- 只能輸出 JSON，不要 markdown
- 不要加解釋
- 缺少的欄位用空字串或空陣列
- 一個 Issue 可能包含多張卡片（例如 "Card 1"、"Card 2"...），請每一張都轉成一個物件放進 "cards" 陣列
- "id" 必須是 kebab-case（僅小寫英文、數字、連字號），且每張卡片唯一、能當檔名；請用能描述內容的關鍵字（例如 "race-trial-primary-endpoint"），不要用 "card-1"、"card-2" 這種流水號
- "title" 放問題，"answer" 放答案，"detail" 放每個支持論點（一個 bullet 一個字串）
- 保留內文中的 **粗體** 標記（螢幕上會畫成紅色標記），但移除引用連結，例如 [[1]](http://...) 這種參考標註要拿掉，只留純文字
- "author" 若 Issue 沒特別指定，就用 "${author}"
- "main" 預設 "Board Review"；"section" / "topic" 依內容判斷
- "releaseNote" 用一段話總結該張卡片的重點

請符合這個 schema：
${SCHEMA_DESC}

Issue 標題：${title}

Issue 內容：
${body}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function callGroq(prompt: string, attempts = 4): Promise<unknown> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is not set");

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        // Enough headroom for 20+ cards while staying under the free-tier
        // tokens-per-minute budget (prompt + completion).
        max_tokens: 8000,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You convert GitHub issues into strict, schema-valid JSON. Output only JSON — no markdown, no commentary.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (res.ok) {
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error("Groq returned no content");
      return JSON.parse(content);
    }

    const text = await res.text();
    lastError = new Error(`Groq request failed: ${res.status} ${res.statusText}\n${text}`);

    // Rate-limited: honour the suggested retry delay ("try again in 5.14s").
    if (res.status === 429 && attempt < attempts) {
      const suggested = Number(text.match(/try again in ([\d.]+)s/)?.[1]);
      const waitMs = Number.isFinite(suggested) ? suggested * 1000 + 500 : attempt * 3000;
      console.error(`Rate limited; retrying in ${Math.round(waitMs)}ms (attempt ${attempt}/${attempts})`);
      await sleep(waitMs);
      continue;
    }
    break;
  }
  throw lastError;
}

function extractCards(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.cards)) return obj.cards;
    // A single-card object also counts.
    if ("title" in obj && "answer" in obj) return [obj];
  }
  throw new Error("Could not find a cards array in the model output");
}

function ensureUniqueId(id: string, used: Set<string>): string {
  let candidate = id;
  let n = 2;
  while (used.has(candidate)) candidate = `${id}-${n++}`;
  used.add(candidate);
  return candidate;
}

// Count how many cards the issue looks like it holds, using the exact same
// splitter the generator uses — so the preflight can't disagree with the
// generator about what "one card" means.
function detectCardCount(body: string): number {
  return splitIntoChunks(body).length;
}

async function main() {
  const title = process.env.ISSUE_TITLE ?? "";
  const body = process.env.ISSUE_BODY ?? "";
  const author = process.env.ISSUE_AUTHOR?.trim() || "Board Review";

  if (!body.trim()) throw new Error("ISSUE_BODY is empty");

  // Preflight mode: report the detected card count and exit without calling the
  // LLM. The workflow uses this to bounce multi-card issues back to the author.
  if (process.argv.includes("--check")) {
    const count = detectCardCount(body);
    console.log(`Detected ${count} card(s)`);
    const gho = process.env.GITHUB_OUTPUT;
    if (gho) appendFileSync(gho, `card_count=${count}\n`);
    return;
  }

  const batches = batchChunks(splitIntoChunks(body));
  console.log(`Split issue into ${batches.length} batch(es)`);

  const candidates: unknown[] = [];
  for (let b = 0; b < batches.length; b++) {
    const raw = await callGroq(buildPrompt(title, batches[b], author));
    const cards = extractCards(raw);
    console.log(`  batch ${b + 1}/${batches.length}: ${cards.length} card(s)`);
    candidates.push(...cards);
  }
  if (candidates.length === 0) throw new Error("Model produced zero cards");

  const usedIds = new Set<string>();
  const written: string[] = [];
  const errors: string[] = [];

  candidates.forEach((candidate, i) => {
    const c = candidate as Partial<CardInput>;
    // Derive/normalise the id (and thus filename) before validating.
    const id = ensureUniqueId(deriveId(c.id, c.title, i), usedIds);
    const card = { ...c, id };

    const result = cardSchema.safeParse(card);
    if (!result.success) {
      errors.push(
        `card #${i + 1} (${id}):\n` +
          result.error.issues.map((iss) => `    ${iss.path.join(".") || "(root)"}: ${iss.message}`).join("\n"),
      );
      return;
    }

    const file = join(CARDS_DIR, `${result.data.id}.json`);
    writeFileSync(file, JSON.stringify(result.data, null, 2) + "\n");
    written.push(file);
    console.log(`✓ wrote ${file}`);
  });

  if (errors.length) {
    console.error(`\n✗ ${errors.length} card(s) failed validation:\n${errors.join("\n")}`);
  }

  if (written.length === 0) {
    throw new Error("No valid cards were produced");
  }

  const gho = process.env.GITHUB_OUTPUT;
  if (gho) {
    appendFileSync(gho, `files=${written.join(" ")}\n`);
    appendFileSync(gho, `count=${written.length}\n`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
