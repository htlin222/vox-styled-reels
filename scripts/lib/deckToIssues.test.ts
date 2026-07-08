import { describe, it, expect } from "vitest";
import { parseDeck, type ParsedCard } from "../deck-to-issues";

// ---------------------------------------------------------------------------
// Helper: quick card assertions
// ---------------------------------------------------------------------------
function expectCard(
  card: ParsedCard,
  title: string,
  answer: string,
  detailCount?: number,
) {
  expect(card.title).toBe(title);
  expect(card.answer).toBe(answer);
  if (detailCount !== undefined) expect(card.detail).toHaveLength(detailCount);
}

// ═══════════════════════════════════════════════════════════════════════════
// The core design: normalizeLabel strips decoration → one match
// These tests prove every cosmetic variation converges.
// ═══════════════════════════════════════════════════════════════════════════

describe("field label normalization — all styles parse identically", () => {
  // Each sub-array is a set of cosmetic variations that must all produce
  // the same card.
  const variations = [
    // colon outside bold
    "**title**: What is X?\n\n**answer**: Y.\n\n**detail**:\n- One.",
    // colon inside bold
    "**Title:** What is X?\n\n**Answer:** Y.\n\n**Details:**\n- One.",
    // heading + bold, colon inside
    "### **Title:** What is X?\n\n### **Answer:** Y.\n\n### **Details:**\n- One.",
    // heading + bold, colon outside
    "### **title**: What is X?\n\n### **answer**: Y.\n\n### **detail**:\n- One.",
    // heading only
    "### Title: What is X?\n\n### Answer: Y.\n\n### Detail:\n- One.",
    // plain (no markdown)
    "title: What is X?\n\nanswer: Y.\n\ndetail:\n- One.",
    // ## heading
    "## Title: What is X?\n\n## Answer: Y.\n\n## Detail:\n- One.",
    // ALLCAPS
    "**TITLE**: What is X?\n\n**ANSWER**: Y.\n\n**DETAIL**:\n- One.",
    // mixed casing, space before colon
    "**Title** : What is X?\n\n**Answer** : Y.\n\n**Details** :\n- One.",
  ];

  variations.forEach((body, i) => {
    it(`variation ${i + 1}`, () => {
      const cards = parseDeck(body);
      expect(cards).toHaveLength(1);
      expectCard(cards[0], "What is X?", "Y.", 1);
      expect(cards[0].detail[0]).toBe("One.");
    });
  });
});

describe("label on its own line — content on next line", () => {
  it("**bold** with no colon", () => {
    const cards = parseDeck(
      "**title**\nWhat is standalone?\n\n**answer**\nStandalone answer.\n\n**detail**\n- Bullet.",
    );
    expect(cards).toHaveLength(1);
    expectCard(cards[0], "What is standalone?", "Standalone answer.", 1);
  });

  it("heading with no colon", () => {
    const cards = parseDeck(
      "### Title\nHeading standalone?\n\n### Answer\nYes.\n\n### Detail\n- Bullet.",
    );
    expect(cards).toHaveLength(1);
    expectCard(cards[0], "Heading standalone?", "Yes.", 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Splitting strategies
// ═══════════════════════════════════════════════════════════════════════════

describe("card splitting", () => {
  it("splits on --- horizontal rules", () => {
    const body =
      "**title**: A?\n**answer**: B.\n**detail**:\n- D1.\n\n---\n\n**title**: C?\n**answer**: D.\n**detail**:\n- D2.";
    expect(parseDeck(body)).toHaveLength(2);
  });

  it("splits on title-field when no ---", () => {
    const body =
      "**title**: Card one?\n**answer**: One.\n**detail**:\n- D1.\n\n**title**: Card two?\n**answer**: Two.\n**detail**:\n- D2.";
    const cards = parseDeck(body);
    expect(cards).toHaveLength(2);
    expect(cards[0].title).toBe("Card one?");
    expect(cards[1].title).toBe("Card two?");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Cleanup: Figures, References, noise lines
// ═══════════════════════════════════════════════════════════════════════════

describe("body cleanup", () => {
  it("strips ### References and everything after", () => {
    const body =
      "**title**: X?\n**answer**: Y.\n**detail**:\n- D.\n\n### References\n\n1. Ref one.\n2. Ref two.";
    const cards = parseDeck(body);
    expect(cards).toHaveLength(1);
    expect(cards[0].detail).toEqual(["D."]);
  });

  it("strips trailing Figure blocks", () => {
    const body =
      "**title**: X?\n**answer**: Y.\n**detail**:\n- D.\n\nFigure 3\nCaption here.\nAuthor et al. 2024.";
    expect(parseDeck(body)).toHaveLength(1);
  });

  it("strips **Total words: N** lines", () => {
    const body =
      "**title**: X?\n**answer**: Y.\n**detail**:\n- D.\n\n**Total words: 89**";
    const cards = parseDeck(body);
    expect(cards).toHaveLength(1);
    expect(cards[0].detail).toEqual(["D."]);
  });

  it("strips ### Card N headings", () => {
    const body =
      "### Card 1\n\n**title**: X?\n**answer**: Y.\n**detail**:\n- D.";
    const cards = parseDeck(body);
    expect(cards).toHaveLength(1);
    expect(cards[0].title).toBe("X?");
  });

  it("strips trailing LLM prose", () => {
    const body =
      "**title**: X?\n**answer**: Y.\n**detail**:\n- D.\n\nWould you like to explore more?";
    const cards = parseDeck(body);
    expect(cards).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Citation cleanup
// ═══════════════════════════════════════════════════════════════════════════

describe("citation stripping", () => {
  it("strips [N] references", () => {
    const cards = parseDeck(
      "**title**: Cited?[1]\n**answer**: Refs.[2][3]\n**detail**:\n- Point.[4]",
    );
    expect(cards[0].title).toBe("Cited?");
    expect(cards[0].answer).toBe("Refs.");
    expect(cards[0].detail[0]).toBe("Point.");
  });

  it("strips [[N]](url) references", () => {
    const cards = parseDeck(
      "**title**: X?\n**answer**: Y.\n**detail**:\n- Has [[1]](http://example.com) inline.",
    );
    expect(cards[0].detail[0]).toBe("Has inline.");
  });

  it("preserves content links [text](url)", () => {
    const cards = parseDeck(
      "**title**: X?\n**answer**: Y.\n**detail**:\n- See [immune thrombocytopenia](https://example.com) here.",
    );
    expect(cards[0].detail[0]).toContain("[immune thrombocytopenia]");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Bullet styles
// ═══════════════════════════════════════════════════════════════════════════

describe("bullet styles", () => {
  it("handles - bullets", () => {
    const cards = parseDeck("**title**: X?\n**answer**: Y.\n**detail**:\n- A.\n- B.");
    expect(cards[0].detail).toEqual(["A.", "B."]);
  });

  it("handles * bullets", () => {
    const cards = parseDeck("**title**: X?\n**answer**: Y.\n**detail**:\n* A.\n* B.");
    expect(cards[0].detail).toEqual(["A.", "B."]);
  });

  it("handles • bullets", () => {
    const cards = parseDeck("**title**: X?\n**answer**: Y.\n**detail**:\n• A.\n• B.");
    expect(cards[0].detail).toEqual(["A.", "B."]);
  });

  it("handles numbered 1. bullets", () => {
    const cards = parseDeck(
      "**title**: X?\n**answer**: Y.\n**detail**:\n1. A.\n2. B.\n3) C.",
    );
    expect(cards[0].detail).toEqual(["A.", "B.", "C."]);
  });

  it("handles multi-line bullet continuation", () => {
    const cards = parseDeck(
      "**title**: X?\n**answer**: Y.\n**detail**:\n- First line\n  continued.\n- Second.",
    );
    expect(cards[0].detail[0]).toBe("First line continued.");
    expect(cards[0].detail[1]).toBe("Second.");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Graceful degradation
// ═══════════════════════════════════════════════════════════════════════════

describe("graceful degradation", () => {
  it("emits card with missing answer", () => {
    const cards = parseDeck("**title**: Minimal?\n**detail**:\n- Point.");
    expect(cards).toHaveLength(1);
    expect(cards[0].answer).toBe("(see details)");
  });

  it("emits card with missing detail", () => {
    const cards = parseDeck("**title**: No detail?\n**answer**: Just answer.");
    expect(cards).toHaveLength(1);
    expect(cards[0].detail).toEqual(["Just answer."]);
  });

  it("skips chunks with no title", () => {
    const cards = parseDeck("Some random text\nwithout any fields.");
    expect(cards).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Integration: full demo.md format
// ═══════════════════════════════════════════════════════════════════════════

describe("integration: demo.md format (colon outside bold)", () => {
  const body = `**title**: What CMV viral load threshold should trigger preemptive therapy after HSCT?

**answer**: No universal threshold exists; most centers use 100-1000 IU/mL in plasma based on patient risk.

**detail**:

- ECIL guidelines recommend 2-3 log₁₀ IU/mL as common thresholds.[1][2]
- High-risk patients may warrant treatment at 100 IU/mL.[3]

---

**title**: How quickly does CMV viral load escalate once reactivation begins after HSCT?

**answer**: CMV viral load can progress from 250 to 1000 IU/mL in just 4 days median.

**detail**:

- Rapid escalation occurs after exceeding 250 IU/mL.[4]

Figure 3
Some figure.

### References

1. Reference one.`;

  it("parses 2 cards, strips figures/refs/citations", () => {
    const cards = parseDeck(body);
    expect(cards).toHaveLength(2);
    expect(cards[0].title).toBe(
      "What CMV viral load threshold should trigger preemptive therapy after HSCT?",
    );
    expect(cards[0].detail[0]).not.toContain("[1]");
    expect(cards[0].detail[0]).not.toContain("[2]");
    expect(cards[1].detail[0]).not.toContain("[4]");
  });
});

describe("integration: LLM format (### Card N, colon inside bold, **Details:**)", () => {
  const body = `## Aplastic Anemia Treatment Trials

### Card 1

**Title:** What was the primary endpoint in the RACE trial?

**Answer:** Complete hematologic response at three months.[1]

**Details:**

- RACE compared horse ATG plus cyclosporine with eltrombopag.[1]
- The trial enrolled 197 patients.[1]

**Total words: 89**

---

### Card 2

**Title:** What were the complete response rates at three months?

**Answer:** Complete response was 10% versus 22% with eltrombopag.[1]

**Details:**

- The odds ratio was 3.2 favoring eltrombopag.[1]
- At six months, response increased to 41% versus 68%.[1]

**Total words: 82**

---

### Card 3

**Title:** What bone marrow changes occurred with eltrombopag?

**Answer:** Bone marrow cellularity increased along with CD34 cells.[3][2]

**Details:**

- These changes suggest direct effect on marrow stem cells.[3]
- Reticulin findings are consistent with [immune thrombocytopenia](https://example.com).[1]

**Total words: 80**

Would you like to explore more?

Figure 1
Some figure.

### References

1. Reference one.`;

  it("parses 3 cards", () => {
    const cards = parseDeck(body);
    expect(cards).toHaveLength(3);
  });

  it("extracts title/answer/detail correctly", () => {
    const cards = parseDeck(body);
    expectCard(cards[0], "What was the primary endpoint in the RACE trial?", "Complete hematologic response at three months.", 2);
    expectCard(cards[1], "What were the complete response rates at three months?", "Complete response was 10% versus 22% with eltrombopag.", 2);
  });

  it("strips citations but preserves content links", () => {
    const cards = parseDeck(body);
    expect(cards[2].answer).toBe(
      "Bone marrow cellularity increased along with CD34 cells.",
    );
    expect(cards[2].detail[1]).toContain("[immune thrombocytopenia]");
    expect(cards[2].detail[1]).not.toMatch(/\[\d+\]/);
  });
});
