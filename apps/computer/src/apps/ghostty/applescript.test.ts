import { describe, expect, test } from "bun:test";
import {
  parseGrid,
  parseTabsSpec,
  escapeAppleScript,
  shellQuote,
  assignPaneCommands,
  buildGhosttyScript,
  wrapCommandForTranscript,
} from "./applescript.js";

describe("parseGrid", () => {
  test("parses 2x2", () => {
    expect(parseGrid("2x2")).toEqual({ rows: 2, cols: 2 });
  });

  test("parses 3x1", () => {
    expect(parseGrid("3x1")).toEqual({ rows: 3, cols: 1 });
  });

  test("parses 1x4", () => {
    expect(parseGrid("1x4")).toEqual({ rows: 1, cols: 4 });
  });

  test("rejects malformed specs", () => {
    expect(() => parseGrid("2x")).toThrow();
    expect(() => parseGrid("x2")).toThrow();
    expect(() => parseGrid("axb")).toThrow();
    expect(() => parseGrid("2x2x2")).toThrow();
    expect(() => parseGrid("")).toThrow();
  });

  test("rejects zero dimensions", () => {
    expect(() => parseGrid("0x2")).toThrow();
    expect(() => parseGrid("2x0")).toThrow();
  });
});

describe("parseTabsSpec", () => {
  test('parses "2x2,1x2"', () => {
    expect(parseTabsSpec("2x2,1x2")).toEqual([
      { rows: 2, cols: 2 },
      { rows: 1, cols: 2 },
    ]);
  });

  test('parses "2x2,1x2,1x2" (three tabs)', () => {
    expect(parseTabsSpec("2x2,1x2,1x2")).toEqual([
      { rows: 2, cols: 2 },
      { rows: 1, cols: 2 },
      { rows: 1, cols: 2 },
    ]);
  });

  test("tolerates whitespace around specs", () => {
    expect(parseTabsSpec("2x2, 1x2")).toEqual([
      { rows: 2, cols: 2 },
      { rows: 1, cols: 2 },
    ]);
  });

  test("rejects empty and malformed entries", () => {
    expect(() => parseTabsSpec("")).toThrow();
    expect(() => parseTabsSpec("2x2,,1x2")).toThrow();
    expect(() => parseTabsSpec("2x2,nope")).toThrow();
  });
});

describe("escapeAppleScript", () => {
  test("escapes double quotes", () => {
    expect(escapeAppleScript('echo "hi"')).toBe('echo \\"hi\\"');
  });

  test("escapes backslashes", () => {
    expect(escapeAppleScript("printf '\\n'")).toBe("printf '\\\\n'");
  });

  test("escapes backslashes before quotes (order matters)", () => {
    expect(escapeAppleScript('a\\"b')).toBe('a\\\\\\"b');
  });

  test("leaves plain text alone", () => {
    expect(escapeAppleScript("htop")).toBe("htop");
  });
});

describe("shellQuote", () => {
  test("single-quotes plain paths", () => {
    expect(shellQuote("/Users/me/proj")).toBe("'/Users/me/proj'");
  });

  test("handles embedded single quotes", () => {
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });
});

describe("assignPaneCommands", () => {
  test("pads missing commands with undefined", () => {
    expect(assignPaneCommands(4, ["a", "b"], false)).toEqual(["a", "b", undefined, undefined]);
  });

  test("all=true fills every pane with the single command", () => {
    expect(assignPaneCommands(4, ["codewith"], true)).toEqual([
      "codewith",
      "codewith",
      "codewith",
      "codewith",
    ]);
  });

  test("all=true requires exactly one command", () => {
    expect(() => assignPaneCommands(4, ["a", "b"], true)).toThrow();
    expect(() => assignPaneCommands(4, [], true)).toThrow();
  });

  test("rejects more commands than panes", () => {
    expect(() => assignPaneCommands(2, ["a", "b", "c"], false)).toThrow();
  });
});

describe("buildGhosttyScript — single grid", () => {
  test("2x2 grid splits column 0 down then rows right, row-major", () => {
    const script = buildGhosttyScript({ tabs: [{ rows: 2, cols: 2 }] });
    expect(script).toContain('tell application "Ghostty"');
    expect(script).toContain("set w to new window");
    expect(script).toContain("set t0_0_0 to focused terminal of selected tab of w");
    // column 0 built downward first
    expect(script).toContain("set t0_1_0 to split t0_0_0 direction down");
    // then each row rightward
    expect(script).toContain("set t0_0_1 to split t0_0_0 direction right");
    expect(script).toContain("set t0_1_1 to split t0_1_0 direction right");
    // down split comes before right splits
    expect(script.indexOf("direction down")).toBeLessThan(script.indexOf("direction right"));
    expect(script).toContain('perform action "equalize_splits" on t0_0_0');
    expect(script).toContain("focus t0_0_0");
    expect(script.trimEnd().endsWith("end tell")).toBe(true);
  });

  test("3x1 grid has two down splits and no right splits", () => {
    const script = buildGhosttyScript({ tabs: [{ rows: 3, cols: 1 }] });
    expect(script).toContain("set t0_1_0 to split t0_0_0 direction down");
    expect(script).toContain("set t0_2_0 to split t0_1_0 direction down");
    expect(script).not.toContain("direction right");
  });

  test("1x1 grid has no splits and no equalize", () => {
    const script = buildGhosttyScript({ tabs: [{ rows: 1, cols: 1 }] });
    expect(script).not.toContain("split");
    expect(script).not.toContain("equalize_splits");
  });

  test("equalize is emitted once per multi-pane tab", () => {
    const script = buildGhosttyScript({ tabs: [{ rows: 2, cols: 2 }] });
    expect(script.split("equalize_splits").length - 1).toBe(1);
  });
});

describe("buildGhosttyScript — commands", () => {
  test("injects commands row-major with input text + enter key", () => {
    const script = buildGhosttyScript({
      tabs: [{ rows: 2, cols: 2 }],
      commands: ["htop", "btop", "vim", "npm run dev"],
    });
    expect(script).toContain('input text "htop" to t0_0_0');
    expect(script).toContain('send key "enter" to t0_0_0');
    expect(script).toContain('input text "btop" to t0_0_1');
    expect(script).toContain('input text "vim" to t0_1_0');
    expect(script).toContain('input text "npm run dev" to t0_1_1');
    // row-major order: t0_0_1 (btop) before t0_1_0 (vim)
    expect(script.indexOf('input text "btop"')).toBeLessThan(script.indexOf('input text "vim"'));
  });

  test("every input text is followed by a send key enter to the same pane", () => {
    const script = buildGhosttyScript({
      tabs: [{ rows: 2, cols: 2 }],
      commands: ["a", "b", "c", "d"],
    });
    const inputs = script.split("\n").filter((l) => l.includes("input text"));
    const enters = script.split("\n").filter((l) => l.includes('send key "enter"'));
    expect(inputs.length).toBe(4);
    expect(enters.length).toBe(4);
    const lines = script.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/input text .* to (t\d+_\d+_\d+)$/);
      if (m) expect(lines[i + 1]).toContain(`send key "enter" to ${m[1]}`);
    }
  });

  test("panes without a command get no input text", () => {
    const script = buildGhosttyScript({
      tabs: [{ rows: 2, cols: 2 }],
      commands: ["only-one", undefined, undefined, undefined],
    });
    expect(script.split("input text").length - 1).toBe(1);
    expect(script.split('send key "enter"').length - 1).toBe(1);
  });

  test("escapes quotes and backslashes in commands", () => {
    const script = buildGhosttyScript({
      tabs: [{ rows: 1, cols: 1 }],
      commands: ['echo "hello \\ world"'],
    });
    expect(script).toContain('input text "echo \\"hello \\\\ world\\"" to t0_0_0');
  });
});

describe("buildGhosttyScript — dir", () => {
  test("prefixes each command with cd <dir> &&", () => {
    const script = buildGhosttyScript({
      tabs: [{ rows: 1, cols: 2 }],
      commands: ["bun dev", "bun test"],
      dir: "/Users/me/proj",
    });
    expect(script).toContain("input text \"cd '/Users/me/proj' && bun dev\" to t0_0_0");
    expect(script).toContain("input text \"cd '/Users/me/proj' && bun test\" to t0_0_1");
  });

  test("panes with dir but no command just cd", () => {
    const script = buildGhosttyScript({
      tabs: [{ rows: 1, cols: 2 }],
      commands: ["bun dev", undefined],
      dir: "/Users/me/proj",
    });
    expect(script).toContain("input text \"cd '/Users/me/proj'\" to t0_0_1");
    expect(script).toContain('send key "enter" to t0_0_1');
  });

  test("dir with spaces stays shell-quoted inside the AppleScript string", () => {
    const script = buildGhosttyScript({
      tabs: [{ rows: 1, cols: 1 }],
      commands: ["ls"],
      dir: "/Users/me/my proj",
    });
    expect(script).toContain("input text \"cd '/Users/me/my proj' && ls\" to t0_0_0");
  });
});

describe("buildGhosttyScript — transcript capture", () => {
  test("wraps commands with tee and status-file transcript capture", () => {
    const script = buildGhosttyScript({
      tabs: [{ rows: 1, cols: 1 }],
      commands: ["bun test"],
      dir: "/Users/me/proj",
      transcript: {
        id: "tr",
        panes: [{
          paneIndex: 0,
          marker: "tr:pane-0:abc123",
          logPath: "/tmp/occtrl/pane-0.log",
          statusPath: "/tmp/occtrl/pane-0.status",
        }],
      },
    });

    expect(script).toContain("[occtrl:tr:pane-0:abc123:begin pane=0]");
    expect(script).toContain("tee -a '/tmp/occtrl/pane-0.log'");
    expect(script).toContain("__occtrl_status_file='/tmp/occtrl/pane-0.status'");
    expect(script).toContain("cd '/Users/me/proj' && { bun test; }");
    expect(script).toContain('send key "enter" to t0_0_0');
  });

  test("wrapCommandForTranscript preserves the command status through a status file", () => {
    const command = wrapCommandForTranscript(
      "false",
      "/Users/me/proj",
      {
        paneIndex: 3,
        marker: "tr:pane-3:def456",
        logPath: "/tmp/occtrl/pane-3.log",
        statusPath: "/tmp/occtrl/pane-3.status",
      },
    );

    expect(command).toContain("printf '[occtrl:%s:end pane=%s status=%s]");
    expect(command).toContain('__occtrl_status="$(cat "$__occtrl_status_file"');
    expect(command).toContain("cd '/Users/me/proj';");
    expect(command).toContain('if [ "$__occtrl_status" -eq 0 ]; then true; else false; fi');
    expect(command).toContain("'3' \"$__occtrl_status\"");
    expect(command).not.toContain("undefined");
    expect(command.trim().startsWith("(")).toBe(false);
    expect(command.indexOf("2>&1 | tee")).toBeLessThan(command.lastIndexOf("cd '/Users/me/proj';"));
  });
});

describe("buildGhosttyScript — maximize", () => {
  test("emits toggle_maximize once right after the first terminal when max", () => {
    const script = buildGhosttyScript({ tabs: [{ rows: 2, cols: 2 }], max: true });
    expect(script.split("toggle_maximize").length - 1).toBe(1);
    const lines = script.split("\n").map((l) => l.trim());
    const idx = lines.indexOf("set t0_0_0 to focused terminal of selected tab of w");
    expect(lines[idx + 1]).toBe('perform action "toggle_maximize" on t0_0_0');
  });

  test("no toggle_maximize without max", () => {
    const script = buildGhosttyScript({ tabs: [{ rows: 2, cols: 2 }] });
    expect(script).not.toContain("toggle_maximize");
  });
});

describe("buildGhosttyScript — tabs", () => {
  test('"2x2,1x2" creates a second tab with its own grid', () => {
    const script = buildGhosttyScript({
      tabs: parseTabsSpec("2x2,1x2"),
    });
    expect(script).toContain("set tb1 to new tab in w");
    expect(script).toContain("set t1_0_0 to focused terminal of tb1");
    expect(script).toContain("set t1_0_1 to split t1_0_0 direction right");
    // one equalize per multi-pane tab
    expect(script.split("equalize_splits").length - 1).toBe(2);
    expect(script).toContain('perform action "equalize_splits" on t1_0_0');
    // never use the reserved word `tab` as a variable
    expect(script).not.toMatch(/set tab\d* to/);
  });

  test("commands flow across tabs in pane order", () => {
    const script = buildGhosttyScript({
      tabs: parseTabsSpec("1x2,1x2"),
      commands: ["one", "two", "three", "four"],
    });
    expect(script).toContain('input text "one" to t0_0_0');
    expect(script).toContain('input text "two" to t0_0_1');
    expect(script).toContain('input text "three" to t1_0_0');
    expect(script).toContain('input text "four" to t1_0_1');
  });

  test("focus returns to the first pane of the first tab", () => {
    const script = buildGhosttyScript({ tabs: parseTabsSpec("2x2,1x2") });
    const lines = script.trimEnd().split("\n").map((l) => l.trim());
    expect(lines[lines.length - 2]).toBe("focus t0_0_0");
    expect(lines[lines.length - 1]).toBe("end tell");
  });
});
