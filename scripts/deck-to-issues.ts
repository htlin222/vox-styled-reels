// Deterministically parse a "deck" issue body into individual card issues,
// each labelled `card` to trigger the issue-to-card chain.
//
// Design: instead of matching every cosmetic variation of field labels
// (bold, headings, colon placement, casing…) with separate regexes, we
// **normalize each line first** — strip markdown decoration — then match
// against a single canonical pattern.  One normalizer, one matcher.
//
// No LLM involved — pure deterministic text parsing.
//
// Env:
//   ISSUE_BODY     (required) deck issue markdown body
//   ISSUE_TITLE    deck issue title (used as context)
//   ISSUE_NUMBER   deck issue number (for back-linking)
//   GH_TOKEN       GitHub token for creating issues

import { appendFileSync } from "fs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedCard {
  title: string;
  answer: string;
  detail: string[];
}

// ---------------------------------------------------------------------------
// Phase 0 — Global cleanup: strip non-card content from the body
// ---------------------------------------------------------------------------

/**
 * Remove content that isn't part of any card:
 *  - ### References … (and everything after)
 *  - Figure N blocks (standalone "Figure \d" line to end-of-body)
 *  - Trailing LLM chatter ("Would you like…", "Let me know…")
 *  - **Total words: N** noise lines
 *  - ### Card N headings (structural, not content)
 */
function cleanBody(body: string): string {
  let s = body;

  // References section (any heading level) to end
  s = s.replace(/\n#{1,6}\s*References[\s\S]*$/i, "");

  // Figure blocks at end (Figure N + description lines)
  s = s.replace(/\n(?=Figure\s+\d)[\s\S]*$/m, "");

  // Trailing LLM prose
  s = s.replace(
    /\n(?:Would you like|Let me know|Do you want|Shall I|If you|Feel free)[^\n]*\s*$/im,
    "",
  );

  // **Total words: N** noise
  s = s.replace(/^\s*\*\*Total words:\s*\d+\*\*\s*$/gm, "");

  // ### Card N headings — useful for splitting but not content
  s = s.replace(/^#{1,6}\s*Card\s+\d+\s*$/gim, "");

  return s.trim();
}

// ---------------------------------------------------------------------------
// Phase 1 — Split body into card chunks
// ---------------------------------------------------------------------------

/**
 * Split by `---` horizontal rules. If there's only one chunk, fall back to
 * splitting on every title-field line (detected via normalizeLabel).
 */
function splitIntoChunks(body: string): string[] {
  // Strategy 1: horizontal rules (the canonical separator)
  const byRule = body
    .split(/\n-{3,}\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (byRule.length > 1) return byRule;

  // Strategy 2: split on title-field lines
  const lines = body.split(/\r?\n/);
  const chunks: string[] = [];
  let buf: string[] = [];

  for (const line of lines) {
    const label = normalizeLabel(line);
    if (label?.field === "title" && buf.length > 0) {
      const chunk = buf.join("\n").trim();
      if (chunk) chunks.push(chunk);
      buf = [];
    }
    buf.push(line);
  }
  const tail = buf.join("\n").trim();
  if (tail) chunks.push(tail);

  return chunks.length > 0 ? chunks : [body.trim()];
}

// ---------------------------------------------------------------------------
// Phase 2 — Normalize a line, then detect field labels
// ---------------------------------------------------------------------------

// The three fields we care about, with accepted synonyms.
const FIELD_SYNONYMS: Record<string, string> = {
  title: "title",
  answer: "answer",
  detail: "detail",
  details: "detail",
};

/**
 * Strip **all** markdown decoration from a line so that every cosmetic
 * variant collapses to the same canonical form:
 *
 *   "### **Title:** Some text"  →  "title: some text"
 *   "**answer** : Yes."         →  "answer : yes."
 *   "**Details:**"              →  "details:"
 *   "## Title"                  →  "title"
 *
 * Steps:
 *  1. Strip leading `#`s (headings)
 *  2. Strip `**` / `*` / `__` bold/italic markers
 *  3. Trim whitespace
 *  4. Lowercase the first word only (for matching; rest stays as-is for content)
 */
function stripDecoration(raw: string): string {
  let s = raw;
  // 1. Strip leading heading markers
  s = s.replace(/^#{1,6}\s+/, "");
  // 2. Strip bold/italic markers everywhere
  s = s.replace(/\*{1,2}|_{1,2}/g, "");
  // 3. Trim
  s = s.trim();
  return s;
}

/**
 * Attempt to detect a field label on this line.  Returns the canonical
 * field name and the remaining content, or null if no label found.
 *
 * After stripping decoration, the line looks like one of:
 *   "Title: Some question?"     → field=title, rest="Some question?"
 *   "Details:"                  → field=detail, rest=""
 *   "Answer"                    → field=answer, rest="" (content on next line)
 */
function normalizeLabel(
  raw: string,
): { field: string; rest: string } | null {
  const stripped = stripDecoration(raw);
  if (!stripped) return null;

  // Try "word:" or "word :" at start — grab the first word before the colon
  const withColon = stripped.match(/^(\w+)\s*:\s*(.*)/);
  if (withColon) {
    const word = withColon[1].toLowerCase();
    const canonical = FIELD_SYNONYMS[word];
    if (canonical) return { field: canonical, rest: withColon[2].trim() };
  }

  // Try bare word on its own line (no colon, no other text)
  const bareWord = stripped.match(/^(\w+)$/);
  if (bareWord) {
    const word = bareWord[1].toLowerCase();
    const canonical = FIELD_SYNONYMS[word];
    if (canonical) return { field: canonical, rest: "" };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Phase 3 — Parse a single card chunk
// ---------------------------------------------------------------------------

/**
 * Is this line a noise line we should skip entirely?
 *  - ### Card N headings (already stripped in cleanBody, but defense-in-depth)
 *  - **Total words: N**
 *  - Blank lines (handled by caller but listed for clarity)
 */
function isNoiseLine(trimmed: string): boolean {
  if (/^#{1,6}\s*Card\s+\d+/i.test(trimmed)) return true;
  if (/^\*\*Total words:\s*\d+\*\*$/i.test(trimmed)) return true;
  return false;
}

/**
 * Parse a bullet line. Handles:  - text,  * text,  • text,  1. text,  1) text
 * Returns the bullet content or null if not a bullet.
 */
function parseBullet(trimmed: string): string | null {
  const m = trimmed.match(/^(?:[-*•]|\d+[.)]\s*)\s+(.*)/);
  return m ? m[1].trim() : null;
}

function parseChunk(chunk: string): ParsedCard | null {
  const lines = chunk.split(/\r?\n/);

  let title = "";
  let answer = "";
  const detail: string[] = [];
  let section = "none";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (isNoiseLine(trimmed)) continue;

    // Try to detect a field label
    const label = normalizeLabel(trimmed);
    if (label) {
      section = label.field;
      const rest = label.rest;
      if (section === "title" && rest) title = rest;
      else if (section === "answer" && rest) answer = rest;
      else if (section === "detail" && rest) detail.push(rest);
      continue;
    }

    // Content line — route to current section
    switch (section) {
      case "title":
        title = title ? `${title} ${trimmed}` : trimmed;
        break;
      case "answer":
        answer = answer ? `${answer} ${trimmed}` : trimmed;
        break;
      case "detail": {
        const bullet = parseBullet(trimmed);
        if (bullet) {
          detail.push(bullet);
        } else if (detail.length > 0) {
          // Continuation of previous bullet
          detail[detail.length - 1] += " " + trimmed;
        } else {
          // Bare text in detail section — treat as a bullet
          detail.push(trimmed);
        }
        break;
      }
      // "none": skip lines before first recognized field
    }
  }

  if (!title) return null;

  // Clean citations from all fields
  title = cleanCitations(title);
  answer = cleanCitations(answer);
  for (let i = 0; i < detail.length; i++) {
    detail[i] = cleanCitations(detail[i]);
  }

  return {
    title,
    answer: answer || "(see details)",
    detail: detail.length > 0 ? detail : [answer || title],
  };
}

// ---------------------------------------------------------------------------
// Citation cleanup
// ---------------------------------------------------------------------------

/**
 * Remove numeric reference markers while preserving content links.
 *
 * Citations:  [1]  [2][3]  [[1]](http://…)  [4](http://…)
 * Content:    [immune thrombocytopenia](http://…)  ← keep
 *
 * Rule: a markdown link `[text](url)` is a citation iff `text` is purely
 * digits (possibly wrapped in extra brackets). Everything else is content.
 */
function cleanCitations(text: string): string {
  let s = text;
  // [[N]](url)
  s = s.replace(/\[\[\d+\]\]\([^)]*\)/g, "");
  // [N](url) — numeric-only text
  s = s.replace(/\[\d+\]\([^)]*\)/g, "");
  // Bare [N] not followed by ( — so [text](url) links survive
  s = s.replace(/\[\d+\](?!\()/g, "");
  // Collapse runs of whitespace / trim
  s = s.replace(/\s{2,}/g, " ").trim();
  // Tidy trailing-punctuation artifacts from stripped refs
  s = s.replace(/\.\s*$/, ".").replace(/,\s*$/, "");
  return s;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function parseDeck(body: string): ParsedCard[] {
  const cleaned = cleanBody(body);
  const chunks = splitIntoChunks(cleaned);
  const cards: ParsedCard[] = [];

  for (const chunk of chunks) {
    const card = parseChunk(chunk);
    if (card) cards.push(card);
  }

  return cards;
}

// ---------------------------------------------------------------------------
// CLI — issue creation via `gh`
// ---------------------------------------------------------------------------

function formatCardIssueBody(card: ParsedCard): string {
  const bullets = card.detail.map((d) => `- ${d}`).join("\n");
  return `**title**: ${card.title}\n\n**answer**: ${card.answer}\n\n**detail**:\n\n${bullets}`;
}

async function main() {
  const body = process.env.ISSUE_BODY ?? "";
  const deckNumber = process.env.ISSUE_NUMBER ?? "";

  if (!body.trim()) throw new Error("ISSUE_BODY is empty");

  // --check mode: report card count and exit
  if (process.argv.includes("--check")) {
    const cards = parseDeck(body);
    console.log(`Detected ${cards.length} card(s) in deck`);
    const gho = process.env.GITHUB_OUTPUT;
    if (gho) appendFileSync(gho, `card_count=${cards.length}\n`);
    return;
  }

  const cards = parseDeck(body);
  if (cards.length === 0) throw new Error("No cards found in deck body");

  console.log(`Parsed ${cards.length} card(s) from deck`);

  const { execSync } = await import("child_process");
  const createdNumbers: string[] = [];

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const issueTitle = card.title;
    const issueBody =
      formatCardIssueBody(card) +
      (deckNumber ? `\n\n---\n_From deck #${deckNumber}_` : "");

    console.log(
      `  Creating issue ${i + 1}/${cards.length}: ${issueTitle.slice(0, 60)}…`,
    );

    const result = execSync(
      `gh issue create --label card --title "${issueTitle.replace(/"/g, '\\"')}" --body-file -`,
      {
        input: issueBody,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    const match = result.trim().match(/\/(\d+)\s*$/);
    if (match) {
      createdNumbers.push(match[1]);
      console.log(`    → issue #${match[1]}`);
    } else {
      console.log(`    → created (URL: ${result.trim()})`);
    }

    // Delay so each labelled-event fires without racing
    if (i < cards.length - 1) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  console.log(
    `\n✓ Created ${createdNumbers.length} card issue(s): ${createdNumbers.map((n) => `#${n}`).join(", ")}`,
  );

  const gho = process.env.GITHUB_OUTPUT;
  if (gho) {
    appendFileSync(gho, `card_count=${createdNumbers.length}\n`);
    appendFileSync(gho, `card_issues=${createdNumbers.join(",")}\n`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
