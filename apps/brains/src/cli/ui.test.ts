// agent-authored (no SOL consult available)

import { describe, expect, test } from "bun:test";
import {
  printTable,
  printStatus,
  printJson,
  printError,
  printSuccess,
  printInfo,
  printHint,
} from "./ui.js";

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

function captureConsole(
  kind: "log" | "error",
): { calls: string[]; restore: () => void } {
  const original = console[kind];
  const calls: string[] = [];
  console[kind] = (...args: unknown[]) => {
    calls.push(args.map(String).join(" "));
  };
  return {
    calls,
    restore: () => {
      console[kind] = original;
    },
  };
}

describe("cli ui", () => {
  test("printTable renders a header separator and every cell", () => {
    const { calls, restore } = captureConsole("log");
    try {
      printTable(["ID", "Name"], [
        ["m-1", "model one"],
        ["m-2", "model two"],
      ]);
    } finally {
      restore();
    }
    const text = calls.join("\n");
    expect(text).toContain("ID");
    expect(text).toContain("Name");
    expect(text).toContain("m-1");
    expect(text).toContain("model one");
    expect(text).toContain("m-2");
    expect(text).toContain("model two");
    // Box-drawing borders are drawn
    expect(text).toContain("┌");
    expect(text).toContain("┐");
    expect(text).toContain("┘");
  });

  test("printTable pads columns to the widest cell", () => {
    const { calls, restore } = captureConsole("log");
    try {
      printTable(["A"], [["x"], ["very-long-cell"]]);
    } finally {
      restore();
    }
    const text = stripAnsi(calls.join("\n"));
    // The widest cell is 14 chars; borders add 2 padding each side → 16
    const topBorder = text.split("\n").find((l) => l.startsWith("┌")) ?? "";
    expect(topBorder).toContain("─".repeat(16));
    // The long row cell is padded to the same width
    const longRow = text.split("\n").find((l) => l.includes("very-long-cell")) ?? "";
    const cell = longRow.slice(1, longRow.indexOf("│", 1));
    expect(cell.length).toBe(16);
    expect(cell.trim()).toBe("very-long-cell");
  });

  test("printTable prints an empty-state line for no rows", () => {
    const { calls, restore } = captureConsole("log");
    try {
      printTable(["A"], []);
    } finally {
      restore();
    }
    expect(stripAnsi(calls.join("\n"))).toContain("(no records)");
  });

  test("printStatus renders known statuses and falls back for unknown ones", () => {
    for (const status of ["succeeded", "running", "pending", "failed", "cancelled", "queued"]) {
      const rendered = stripAnsi(printStatus(status));
      expect(rendered).toBe(`● ${status}`);
    }
    const unknown = stripAnsi(printStatus("mystery"));
    expect(unknown).toBe("● mystery");
  });

  test("printJson pretty-prints with two-space indentation", () => {
    const { calls, restore } = captureConsole("log");
    try {
      printJson({ a: 1, b: [2, 3] });
    } finally {
      restore();
    }
    expect(calls[0]).toBe('{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}');
  });

  test("printError writes to stderr with the error marker", () => {
    const { calls, restore } = captureConsole("error");
    try {
      printError("kaboom");
    } finally {
      restore();
    }
    expect(stripAnsi(calls[0] ?? "")).toContain("✗ Error:");
    expect(stripAnsi(calls[0] ?? "")).toContain("kaboom");
  });

  test("printSuccess, printInfo and printHint write to stdout", () => {
    const { calls, restore } = captureConsole("log");
    try {
      printSuccess("done");
      printInfo("note");
      printHint("hint");
    } finally {
      restore();
    }
    expect(stripAnsi(calls[0] ?? "")).toContain("✓");
    expect(stripAnsi(calls[0] ?? "")).toContain("done");
    expect(stripAnsi(calls[1] ?? "")).toContain("note");
    expect(stripAnsi(calls[2] ?? "")).toContain("hint");
  });
});
