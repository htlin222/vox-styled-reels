import { execFileSync } from "child_process";
import { writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { MARKER, STAGES, renderProgress, parseStart, type Target } from "./lib/issueProgress";

// CLI: update the live progress comment on an issue.
//
//   tsx scripts/issue-progress.ts <issueNumber> <stageId|done> [releaseUrl]
//
// Finds the existing comment by its hidden marker (reusing its stored start
// time), or creates one if none exists. Needs `gh` on PATH with GH_TOKEN set
// and GITHUB_REPOSITORY=owner/repo (both provided by GitHub Actions). Failures
// are non-fatal: a broken status comment must never fail a build.

function gh(args: string[]): string {
  return execFileSync("gh", args, { encoding: "utf-8" });
}

function main() {
  const [, , issueArg, targetArg, releaseUrl] = process.argv;
  const issue = Number(issueArg);
  const target = targetArg as Target;

  if (!Number.isInteger(issue) || issue <= 0) throw new Error(`invalid issue number: ${issueArg}`);
  if (target !== "done" && !STAGES.some((s) => s.id === target)) throw new Error(`invalid stage: ${targetArg}`);

  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) throw new Error("GITHUB_REPOSITORY is not set");

  // Locate an existing progress comment (id + body) so we can edit in place and
  // preserve the original start timestamp.
  const comments = JSON.parse(gh(["api", `repos/${repo}/issues/${issue}/comments`, "--paginate"])) as {
    id: number;
    body: string;
  }[];
  const existing = comments.find((c) => c.body?.includes(MARKER));

  const startMs = parseStart(existing?.body) ?? Date.now();
  const body = renderProgress({ target, startMs, nowMs: Date.now(), releaseUrl });

  // Pass the body as a JSON request payload via a temp file — sidesteps all
  // shell-escaping of markdown/newlines.
  const dir = mkdtempSync(join(tmpdir(), "progress-"));
  const payload = join(dir, "payload.json");
  writeFileSync(payload, JSON.stringify({ body }));

  if (existing) {
    gh(["api", "--method", "PATCH", `repos/${repo}/issues/comments/${existing.id}`, "--input", payload]);
    console.log(`updated progress comment ${existing.id} → ${target}`);
  } else {
    gh(["api", "--method", "POST", `repos/${repo}/issues/${issue}/comments`, "--input", payload]);
    console.log(`created progress comment on #${issue} → ${target}`);
  }
}

try {
  main();
} catch (e) {
  // Never fail the workflow over a status comment.
  console.error(`issue-progress: ${(e as Error).message}`);
}
