// Renders (and, via the CLI below, posts) a single live "build progress"
// comment on the originating issue. The comment is updated in place across two
// workflows — issue-to-card.yml (generate → PR) and release-cards.yml (audio →
// render → release) — so the issue author sees one checklist tick through to
// 🎉. Progress is a single "current stage": everything before it is ✅ done,
// the current one is 💪 working, everything after is ⏳ pending. The start
// timestamp is stashed in a hidden marker so elapsed time survives across
// workflow runs (each run reads the existing comment before editing it).

export const MARKER = "<!-- card-progress -->";
const START_RE = /<!--\s*card-progress:start=(\d+)\s*-->/;

export const STAGES = [
  { id: "generate", label: "Generate card from issue" },
  { id: "pr", label: "Open pull request" },
  { id: "merge", label: "Merge & validate" },
  { id: "audio", label: "Generate narration (TTS)" },
  { id: "render", label: "Render videos" },
  { id: "release", label: "Publish release" },
] as const;

export type StageId = (typeof STAGES)[number]["id"];
export type Target = StageId | "done";

const ICON = { done: "✅", working: "💪", pending: "⏳" } as const;

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}h ${m}m ${sec}s`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
}

// Pull the stored start epoch (ms) out of an existing comment body, if any.
export function parseStart(body: string | undefined): number | undefined {
  const m = body?.match(START_RE);
  return m ? Number(m[1]) : undefined;
}

export function renderProgress(opts: {
  target: Target;
  startMs: number;
  nowMs: number;
  releaseUrl?: string;
}): string {
  const { target, startMs, nowMs, releaseUrl } = opts;
  const done = target === "done";
  const currentIdx = done ? STAGES.length : STAGES.findIndex((s) => s.id === target);

  const lines = STAGES.map((stage, i) => {
    const state = done || i < currentIdx ? "done" : i === currentIdx ? "working" : "pending";
    return `- ${ICON[state]} ${stage.label}`;
  });

  const header = done ? "### 🎉 Card built!" : "### 🃏 Card build progress";
  const parts = [header, "", ...lines, ""];

  if (done) {
    if (releaseUrl) parts.push(`**Release:** ${releaseUrl}`);
    parts.push(`**Elapsed:** ${formatElapsed(nowMs - startMs)}`);
  } else {
    parts.push(`_Updating live — elapsed ${formatElapsed(nowMs - startMs)}._`);
  }

  parts.push("", MARKER, `<!-- card-progress:start=${startMs} -->`);
  return parts.join("\n");
}
