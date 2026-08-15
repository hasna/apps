import { describe, test, expect } from "bun:test";
import { splitCards, extractTitle } from "./splitter";

describe("splitCards", () => {
  test("empty document returns empty title and no cards", () => {
    const result = splitCards("");
    expect(result.title).toBe("");
    expect(result.cards).toHaveLength(0);
  });

  test("document with no separators returns title only", () => {
    const result = splitCards("# My App\n\nSome description");
    expect(result.title).toBe("# My App\n\nSome description");
    expect(result.cards).toHaveLength(0);
  });

  test("single card after title", () => {
    const doc = `# My App

---

type: project
id: init

Set up the project.`;

    const result = splitCards(doc);
    expect(result.title).toBe("# My App");
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].raw).toContain("type: project");
    expect(result.cards[0].raw).toContain("Set up the project.");
  });

  test("multiple cards", () => {
    const doc = `# App

---

type: project
id: init

First card.

---

type: database
id: db

Second card.

---

type: table
id: users

Third card.`;

    const result = splitCards(doc);
    expect(result.title).toBe("# App");
    expect(result.cards).toHaveLength(3);
    expect(result.cards[0].raw).toContain("type: project");
    expect(result.cards[1].raw).toContain("type: database");
    expect(result.cards[2].raw).toContain("type: table");
  });

  test("consecutive separators produce no empty cards", () => {
    const doc = `# App

---

---

---

type: project
id: init

Only card.`;

    const result = splitCards(doc);
    expect(result.title).toBe("# App");
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].raw).toContain("type: project");
  });

  test("table separator lines are NOT treated as card separators", () => {
    const doc = `# App

---

type: table
id: users

| column | type |
|--------|------|
| id     | text |
| name   | text |

Define the users table.`;

    const result = splitCards(doc);
    expect(result.cards).toHaveLength(1);
    const card = result.cards[0];
    expect(card.raw).toContain("|--------|------|");
    expect(card.raw).toContain("| id     | text |");
  });

  test("tracks line numbers correctly", () => {
    const doc = `# App

---

type: first
id: a

---

type: second
id: b`;

    const result = splitCards(doc);
    expect(result.cards).toHaveLength(2);
    // First card starts after first ---
    expect(result.cards[0].lineNumber).toBe(4);
  });

  test("handles leading/trailing whitespace on separators", () => {
    const doc = `# App

  ---

type: project
id: init

Card content.`;

    const result = splitCards(doc);
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].raw).toContain("type: project");
  });

  test("handles document with only separators", () => {
    const doc = `---
---
---`;
    const result = splitCards(doc);
    expect(result.title).toBe("");
    expect(result.cards).toHaveLength(0);
  });
});

describe("extractTitle", () => {
  test("extracts title from # heading", () => {
    expect(extractTitle("# My App")).toBe("My App");
  });

  test("extracts title from # heading with extra text", () => {
    expect(extractTitle("# My App\n\nSome description")).toBe("My App");
  });

  test("returns raw text when no heading", () => {
    expect(extractTitle("Just some text")).toBe("Just some text");
  });

  test("handles empty string", () => {
    expect(extractTitle("")).toBe("");
  });
});
