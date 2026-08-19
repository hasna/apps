import { describe, expect, test } from "bun:test";
import {
  inspectAgentTarget,
  inspectListedAgentTarget,
  TARGET_DISCOVERY_CAPTURE_MAX_CHARS,
  TARGET_DISCOVERY_PROCESS_MAX_LINES,
  TARGET_DISCOVERY_PROCESS_MAX_LINE_CHARS,
  validateAgentComposerTarget,
} from "./agent-target.js";
import { Tmux } from "./tmux.js";
import { MockRunner, type Responder } from "../test/mock-runner.js";

const CODEPATH_PROCESS_TREE = `
1234 1 Ss /usr/bin/bash
1240 1234 Sl+ node /home/hasna/.bun/bin/codewith --auth-profile account005
1241 1240 Sl+ /home/hasna/.bun/install/global/node_modules/@hasna/codewith/node_modules/@hasna/codewith-linux-arm64/vendor/aarch64-unknown-linux-musl/bin/codewith --auth-profile account005
`;

const CODEPATH_IDLE_VISIBLE = `
╭─────────────────────────────────────────────────────────╮
│ ⎔  Hasna Codewith (v0.1.42)                             │
│                                                         │
│ model:       gpt-5.5 xhigh   fast   /model to change    │
│ directory:   ~/workspace/hasna/opensource/codewith      │
│ permissions: YOLO mode                                  │
╰─────────────────────────────────────────────────────────╯

  Tip: Use /skills to list available skills or ask Codewith to use one.

› idle composer
`;

const ACTIVE_CODEPATH_VISIBLE = `
Goal active Objective: Add reliable session orchestration to dispatch

› Follow-up implementation prompt

  gpt-5.5 xhigh fast · account016 · 5h 9% left · Main [default]       Pursuing goal (3m)
`;

const SPOOFED_BANNER = `
╭─────────────────────────────────────────────────────────╮
│ ⎔  Hasna Codewith (v0.1.42)                             │
│ model:       gpt-5.5 xhigh                              │
╰─────────────────────────────────────────────────────────╯
`;

const IDLE_MARKER = "> idle composer\n";

function tmuxFor(responder: Responder, machine = "local"): Tmux {
  const mock = new MockRunner(machine);
  mock.responder = responder;
  return new Tmux(mock);
}

/** Default responder: pane exists, command is an agent, idle visible. */
function defaultResponder(overrides: Partial<Record<string, unknown>> = {}): Responder {
  return (argv) => {
    const verb = argv[1];
    if (verb === "list-panes") return { stdout: "%1", stderr: "", exitCode: 0, source: "local" };
    if (verb === "display-message") {
      const property = argv[argv.length - 1] ?? "";
      const value = property === "#{pane_in_mode}" ? (overrides.paneInMode ?? "0") : overrides.paneCommand ?? "claude";
      return { stdout: `${value}\n`, stderr: "", exitCode: 0, source: "local" };
    }
    if (verb === "capture-pane") return { stdout: String(overrides.visible ?? IDLE_MARKER), stderr: "", exitCode: 0, source: "local" };
    if (verb === "copy-mode") return { stdout: "", stderr: "", exitCode: 0, source: "local" };
    return { stdout: "", stderr: "", exitCode: 0, source: "local" };
  };
}

describe("inspectAgentTarget", () => {
  test("refuses a missing pane with machine-qualified detail and no further probes", () => {
    const calls: string[][] = [];
    const mock = new MockRunner("remote1");
    mock.responder = (argv) => {
      calls.push(argv);
      return { stdout: "", stderr: "no such pane", exitCode: 1, source: "local" };
    };
    const tmux = new Tmux(mock);
    const result = inspectAgentTarget(tmux, "sess:0.1");
    expect(result.ok).toBe(false);
    expect(result.paneCommand).toBe("");
    expect(result.detail).toContain("target pane not found");
    expect(result.detail).toContain("remote1");
    // Only the existence probe ran — no capture, no mode probe on a dead pane.
    expect(calls.map((c) => c[1])).toEqual(["list-panes"]);
  });

  test("assumeExists skips the pane existence probe", () => {
    const calls: string[][] = [];
    const mock = new MockRunner("local");
    mock.responder = (argv) => {
      calls.push(argv);
      const verb = argv[1];
      if (verb === "display-message") return { stdout: "bash\n", stderr: "", exitCode: 0, source: "local" };
      return { stdout: "", stderr: "", exitCode: 0, source: "local" };
    };
    const tmux = new Tmux(mock);
    const result = inspectAgentTarget(tmux, "sess:0.1", { assumeExists: true });
    expect(calls.some((c) => c[1] === "list-panes")).toBe(false);
    expect(result.ok).toBe(false); // a shell pane is still refused
    expect(result.detail).toContain("shell");
  });

  test("classifies a shell pane as not ok with the shell reason", () => {
    const result = inspectAgentTarget(tmuxFor(defaultResponder({ paneCommand: "/usr/bin/zsh" })), "sess:0.1");
    expect(result.ok).toBe(false);
    expect(result.targetKind).toBe("shell");
    expect(result.detail).toMatch(/shell/);
    expect(result.detection?.canReceivePrompt).toBe(false);
  });

  test("refuses an unknown pane command as not a recognized agent composer", () => {
    const result = inspectAgentTarget(tmuxFor(defaultResponder({ paneCommand: "vim" })), "sess:0.1");
    expect(result.ok).toBe(false);
    expect(result.targetKind).toBe("unknown");
    expect(result.detail).toMatch(/not a recognized agent composer/);
  });

  test("accepts a direct agent pane whose visible shows an idle composer", () => {
    const result = inspectAgentTarget(tmuxFor(defaultResponder({ paneCommand: "claude" })), "sess:0.1");
    expect(result.ok).toBe(true);
    expect(result.targetKind).toBe("agent");
    expect(result.activity).toBe("idle");
    expect(result.detection?.agentKind).toBe("claude");
    expect(result.detection?.canReceivePrompt).toBe(true);
  });

  test("accepts a node-wrapped Codewith pane only with process-tree proof", () => {
    const responder: Responder = (argv) => {
      const verb = argv[1];
      if (verb === "list-panes") return { stdout: "%1", stderr: "", exitCode: 0, source: "local" };
      if (verb === "display-message") {
        const property = argv[argv.length - 1] ?? "";
        if (property === "#{pane_in_mode}") return { stdout: "0\n", stderr: "", exitCode: 0, source: "local" };
        if (property === "#{pane_pid}") return { stdout: "1241\n", stderr: "", exitCode: 0, source: "local" };
        return { stdout: "node\n", stderr: "", exitCode: 0, source: "local" };
      }
      if (verb === "capture-pane") return { stdout: ACTIVE_CODEPATH_VISIBLE, stderr: "", exitCode: 0, source: "local" };
      if (argv[0] === "sh" || argv[0] === "ps") return { stdout: CODEPATH_PROCESS_TREE, stderr: "", exitCode: 0, source: "local" };
      return { stdout: "", stderr: "", exitCode: 0, source: "local" };
    };
    const result = inspectAgentTarget(tmuxFor(responder), "sess:0.1");
    expect(result.ok).toBe(true);
    expect(result.detection?.agentKind).toBe("codewith");
    expect(result.activity).toBe("active");
    expect(result.detection?.canQueuePrompt).toBe(true);
  });

  test("refuses a spoofed Codewith banner when no process evidence matches", () => {
    const responder: Responder = (argv) => {
      const verb = argv[1];
      if (verb === "list-panes") return { stdout: "%1", stderr: "", exitCode: 0, source: "local" };
      if (verb === "display-message") {
        const property = argv[argv.length - 1] ?? "";
        const value = property === "#{pane_in_mode}" ? "0" : "node";
        return { stdout: `${value}\n`, stderr: "", exitCode: 0, source: "local" };
      }
      if (verb === "capture-pane") return { stdout: SPOOFED_BANNER, stderr: "", exitCode: 0, source: "local" };
      if (argv[0] === "sh" || argv[0] === "ps") return { stdout: "9999 1 Ss /usr/bin/nginx\n", stderr: "", exitCode: 0, source: "local" };
      return { stdout: "", stderr: "", exitCode: 0, source: "local" };
    };
    const result = inspectAgentTarget(tmuxFor(responder), "sess:0.1");
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/not a recognized agent composer|wrapper/);
  });

  test("prepareForDelivery refuses a pane stuck in copy-mode when exit fails", () => {
    const responder: Responder = (argv) => {
      const verb = argv[1];
      if (verb === "list-panes") return { stdout: "%1", stderr: "", exitCode: 0, source: "local" };
      if (verb === "display-message") {
        const property = argv[argv.length - 1] ?? "";
        if (property === "#{pane_in_mode}") return { stdout: "1\n", stderr: "", exitCode: 0, source: "local" };
        return { stdout: "claude\n", stderr: "", exitCode: 0, source: "local" };
      }
      if (verb === "capture-pane") return { stdout: IDLE_MARKER, stderr: "", exitCode: 0, source: "local" };
      // copy-mode -q fails to clear the mode
      if (verb === "copy-mode") return { stdout: "", stderr: "mode not cleared", exitCode: 1, source: "local" };
      return { stdout: "", stderr: "", exitCode: 0, source: "local" };
    };
    const result = inspectAgentTarget(tmuxFor(responder), "sess:0.1", { prepareForDelivery: true });
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/copy-mode|pane mode/);
  });

  test("prepareForDelivery exits copy-mode before accepting", () => {
    let modeProbes = 0;
    let copyModeCalls = 0;
    const responder: Responder = (argv) => {
      const verb = argv[1];
      if (verb === "list-panes") return { stdout: "%1", stderr: "", exitCode: 0, source: "local" };
      if (verb === "display-message") {
        const property = argv[argv.length - 1] ?? "";
        if (property === "#{pane_in_mode}") {
          modeProbes += 1;
          // inspect probe (1) and exitCopyMode's first check (2) still see the
          // mode; the post-clear re-check (3+) sees it gone.
          return { stdout: `${modeProbes <= 2 ? "1" : "0"}\n`, stderr: "", exitCode: 0, source: "local" };
        }
        return { stdout: "claude\n", stderr: "", exitCode: 0, source: "local" };
      }
      if (verb === "capture-pane") return { stdout: IDLE_MARKER, stderr: "", exitCode: 0, source: "local" };
      if (verb === "copy-mode") {
        copyModeCalls += 1;
        return { stdout: "", stderr: "", exitCode: 0, source: "local" };
      }
      return { stdout: "", stderr: "", exitCode: 0, source: "local" };
    };
    const result = inspectAgentTarget(tmuxFor(responder), "sess:0.1", { prepareForDelivery: true });
    expect(result.ok).toBe(true);
    expect(modeProbes).toBeGreaterThanOrEqual(3);
    expect(copyModeCalls).toBe(1);
  });

  test("prepareForDelivery fails closed when the mode probe itself throws", () => {
    const mock = new MockRunner("local");
    mock.responder = (argv) => {
      if (argv[1] === "list-panes") return { stdout: "%1", stderr: "", exitCode: 0, source: "local" };
      if (argv[1] === "display-message") {
        const property = argv[argv.length - 1] ?? "";
        if (property === "#{pane_in_mode}") throw new Error("tmux transport failed");
        return { stdout: "claude\n", stderr: "", exitCode: 0, source: "local" };
      }
      return { stdout: "", stderr: "", exitCode: 0, source: "local" };
    };
    const tmux = new Tmux(mock);
    const result = inspectAgentTarget(tmux, "sess:0.1", { prepareForDelivery: true });
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/copy-mode/);
  });

  test("bounded discovery applies capture and process-tree limits", () => {
    // More than TARGET_DISCOVERY_CAPTURE_MAX_CHARS, with the composer evidence
    // at the tail so the bounded capture still classifies it.
    const longVisible = `${"pad line\n".repeat(6000)}${ACTIVE_CODEPATH_VISIBLE}`;
    const calls: string[][] = [];
    const responder: Responder = (argv) => {
      calls.push(argv);
      const verb = argv[1];
      if (verb === "list-panes") return { stdout: "%1", stderr: "", exitCode: 0, source: "local" };
      if (verb === "display-message") {
        const property = argv[argv.length - 1] ?? "";
        if (property === "#{pane_in_mode}") return { stdout: "0\n", stderr: "", exitCode: 0, source: "local" };
        if (property === "#{pane_pid}") return { stdout: "1241\n", stderr: "", exitCode: 0, source: "local" };
        return { stdout: "node\n", stderr: "", exitCode: 0, source: "local" };
      }
      if (verb === "capture-pane") return { stdout: longVisible, stderr: "", exitCode: 0, source: "local" };
      if (argv[0] === "sh" && argv[1] === "-c") return { stdout: CODEPATH_PROCESS_TREE, stderr: "", exitCode: 0, source: "local" };
      return { stdout: "", stderr: "", exitCode: 0, source: "local" };
    };
    const result = inspectListedAgentTarget(tmuxFor(responder), "sess:0.1", { paneCommand: "node" });
    expect(result.ok).toBe(true);
    expect(result.visible?.length).toBe(TARGET_DISCOVERY_CAPTURE_MAX_CHARS);
    const treeCall = calls.find((c) => c[0] === "sh" && c[1] === "-c");
    expect(treeCall).toBeDefined();
    expect(treeCall).toContain(String(TARGET_DISCOVERY_PROCESS_MAX_LINES));
    expect(treeCall).toContain(String(TARGET_DISCOVERY_PROCESS_MAX_LINE_CHARS));
  });

  test("validateAgentComposerTarget prepares for delivery", () => {
    let modeProbes = 0;
    const responder: Responder = (argv) => {
      const verb = argv[1];
      if (verb === "list-panes") return { stdout: "%1", stderr: "", exitCode: 0, source: "local" };
      if (verb === "display-message") {
        const property = argv[argv.length - 1] ?? "";
        if (property === "#{pane_in_mode}") {
          modeProbes += 1;
          return { stdout: `${modeProbes <= 2 ? "1" : "0"}\n`, stderr: "", exitCode: 0, source: "local" };
        }
        return { stdout: "claude\n", stderr: "", exitCode: 0, source: "local" };
      }
      if (verb === "capture-pane") return { stdout: IDLE_MARKER, stderr: "", exitCode: 0, source: "local" };
      if (verb === "copy-mode") return { stdout: "", stderr: "", exitCode: 0, source: "local" };
      return { stdout: "", stderr: "", exitCode: 0, source: "local" };
    };
    const result = validateAgentComposerTarget(tmuxFor(responder), "sess:0.1");
    expect(result.ok).toBe(true);
    expect(modeProbes).toBeGreaterThanOrEqual(3);
  });
});
