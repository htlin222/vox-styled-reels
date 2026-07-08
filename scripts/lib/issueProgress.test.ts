import { describe, it, expect } from "vitest";
import { renderProgress, parseStart, formatElapsed, MARKER, STAGES } from "./issueProgress";

describe("formatElapsed", () => {
  it("formats seconds, minutes, and hours", () => {
    expect(formatElapsed(4200)).toBe("4s");
    expect(formatElapsed(95_000)).toBe("1m 35s");
    expect(formatElapsed(3_661_000)).toBe("1h 1m 1s");
  });
});

describe("parseStart", () => {
  it("round-trips the start epoch stored in a rendered body", () => {
    const body = renderProgress({ target: "audio", startMs: 1_720_000_000_000, nowMs: 1_720_000_030_000 });
    expect(parseStart(body)).toBe(1_720_000_000_000);
  });
  it("returns undefined when absent", () => {
    expect(parseStart("no marker here")).toBeUndefined();
    expect(parseStart(undefined)).toBeUndefined();
  });
});

describe("renderProgress", () => {
  it("marks prior stages done, current working, later pending", () => {
    const body = renderProgress({ target: "render", startMs: 0, nowMs: 1000 });
    expect(body).toContain("✅ Generate card from issue");
    expect(body).toContain("💪 Render videos");
    expect(body).toContain("⏳ Publish release");
    expect(body).toContain(MARKER);
  });

  it("marks every stage done with 🎉, release link and elapsed when done", () => {
    const body = renderProgress({
      target: "done",
      startMs: 0,
      nowMs: 272_000,
      releaseUrl: "https://example.com/releases/card-x",
    });
    expect(body).toContain("🎉 Card built!");
    for (const stage of STAGES) expect(body).toContain(`✅ ${stage.label}`);
    expect(body).not.toContain("💪");
    expect(body).not.toContain("⏳");
    expect(body).toContain("**Release:** https://example.com/releases/card-x");
    expect(body).toContain("**Elapsed:** 4m 32s");
  });
});
