// b27cc4a0: the accounts display surface renders as a clean aligned TABLE in
// text mode. Golden-string tests pin the exact rendered shape so the CLI's
// "messy ad-hoc lines" cannot silently creep back.
import { describe, expect, test } from "bun:test";
import { renderTable } from "./render-table.js";

interface Row {
  name: string;
  tool: string;
  email: string;
}

const COLUMNS = [
  { header: "NAME", cell: (r: Row) => r.name },
  { header: "TOOL", cell: (r: Row) => r.tool },
  { header: "EMAIL", cell: (r: Row) => r.email },
] as const;

describe("renderTable", () => {
  test("renders aligned columns padded to the widest cell", () => {
    const out = renderTable(
      [
        { name: "alpha", tool: "claude", email: "a@example.com" },
        { name: "account-beta-long", tool: "codex", email: "(no email)" },
      ],
      COLUMNS,
    );
    expect(out).toBe(
      [
        "NAME               TOOL    EMAIL",
        "-----------------  ------  -------------",
        "alpha              claude  a@example.com",
        "account-beta-long  codex   (no email)",
      ].join("\n"),
    );
  });

  test("a single row still emits header, separator, and row", () => {
    const out = renderTable([{ name: "one", tool: "claude", email: "o@x.io" }], COLUMNS);
    expect(out).toBe(
      ["NAME  TOOL    EMAIL", "----  ------  ------", "one   claude  o@x.io"].join("\n"),
    );
  });

  test("empty rows render only the header and separator", () => {
    const out = renderTable<Row>([], COLUMNS);
    expect(out).toBe(["NAME  TOOL  EMAIL", "----  ----  -----"].join("\n"));
  });
});
