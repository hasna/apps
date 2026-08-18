import { describe, expect, test } from "bun:test";
import { MockRunner } from "../test/mock-runner.js";
import { Tmux } from "./tmux.js";
import { Mosaic } from "./mosaic.js";
import { performBulkDispatch } from "./bulk.js";

/** MockRunner that answers `mosaic prompt send` with a validated receipt derived from argv. */
function mosaicControlRunner(machine = "local"): MockRunner {
  const r = new MockRunner(machine);
  r.responder = (argv) => {
    if (argv[1] === "--session" && argv.includes("prompt") && argv.includes("send")) {
      const session = String(argv[2]);
      const paneId = String(argv[argv.indexOf("--pane-id") + 1]);
      return {
        stdout: JSON.stringify({
          schema_version: "mosaic.control.v1",
          event: "receipt",
          operation: "prompt.send",
          session,
          pane_id: paneId,
          id: `receipt-${session}-${paneId}`,
          status: "accepted",
          ack: argv.includes("--queue") ? "queued" : "server_accepted",
          timestamp_ms: 1782290000000,
          error: null,
        }),
        stderr: "",
        exitCode: 0,
        source: "local",
      };
    }
    return { stdout: "", stderr: "", exitCode: 0, source: "local" };
  };
  return r;
}

function agentTmux(capture = "> idle composer"): Tmux {
  const r = new MockRunner();
  let submitted = false;
  let composerText = "";
  let bufferText = "";
  r.responder = (argv, input) => {
    if (argv[1] === "list-panes") return { stdout: "%1\n", stderr: "", exitCode: 0, source: "local" };
    if (argv[1] === "display-message" && argv.at(-1) === "#{pane_current_command}") {
      return { stdout: "codewith\n", stderr: "", exitCode: 0, source: "local" };
    }
    if (argv[1] === "display-message" && argv.at(-1) === "#{pane_in_mode}") {
      return { stdout: "0\n", stderr: "", exitCode: 0, source: "local" };
    }
    if (argv[1] === "load-buffer") {
      bufferText = input ?? "";
      return { stdout: "", stderr: "", exitCode: 0, source: "local" };
    }
    if (argv[1] === "paste-buffer") {
      composerText = bufferText;
      return { stdout: "", stderr: "", exitCode: 0, source: "local" };
    }
    if (argv[1] === "send-keys" && argv.includes("-l")) {
      composerText = argv.at(-1) ?? "";
      return { stdout: "", stderr: "", exitCode: 0, source: "local" };
    }
    if (argv[1] === "send-keys" && (argv.includes("Enter") || argv.includes("Tab"))) {
      submitted = true;
      return { stdout: "", stderr: "", exitCode: 0, source: "local" };
    }
    if (argv[1] === "capture-pane") {
      return {
        stdout: submitted
          ? "Messages to be submitted after next tool call\nQueued: Queue this"
          : composerText
            ? `${capture}\n> ${composerText}`
            : capture,
        stderr: "",
        exitCode: 0,
        source: "local",
      };
    }
    return { stdout: "", stderr: "", exitCode: 0, source: "local" };
  };
  return new Tmux(r);
}

describe("performBulkDispatch", () => {
  test("dry-runs explicit bulk sends with configured concurrency and jitter", async () => {
    const sleeps: number[] = [];
    const result = await performBulkDispatch(
      {
        targets: [{ target: "work:1.1" }, { target: "work:1.2" }],
        prompt: "Bulk prompt",
        dryRun: true,
        maxConcurrency: 2,
        jitterMs: 20,
        perMachineLimit: 1,
      },
      {
        makeTmux: async () => agentTmux(),
        random: () => 0.5,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      },
    );

    expect(result).toMatchObject({
      status: "completed",
      source: "explicit",
      requested: 2,
      planned: 2,
      succeeded: 0,
      skipped: 2,
      failed: 0,
      dryRun: true,
      maxConcurrency: 2,
      jitterMs: 20,
      perMachineLimit: 1,
    });
    expect(sleeps).toContain(10);
    expect(result.records.every((r) => r.detail?.includes("dry run"))).toBe(true);
  });

  test("sessions-query bulk sends default to idle-only delivery", async () => {
    const result = await performBulkDispatch(
      {
        source: "sessions-query",
        targets: [{ target: "sessions:2.1", machine: "spark02", source: "sessions-query", state: "active" }],
        prompt: "Do not hit busy sessions",
        queue: false,
      },
      {
        makeTmux: async () => agentTmux("✶ Working… (esc to interrupt)"),
        sleep: async () => undefined,
      },
    );

    expect(result.status).toBe("failed");
    expect(result.skipped).toBe(1);
    expect(result.detail).toMatch(/skipped/);
    expect(result.records[0]).toMatchObject({
      target: "sessions:2.1",
      status: "skipped",
      targetState: "active",
    });
  });

  test("explicit bulk sends also default to idle-only delivery", async () => {
    const result = await performBulkDispatch(
      {
        targets: [{ target: "a:1.1" }, { target: "b:1.1" }],
        prompt: "Do not touch active panes by default",
      },
      {
        makeTmux: async () => agentTmux("✶ Working… (esc to interrupt)"),
        sleep: async () => undefined,
      },
    );

    expect(result.status).toBe("failed");
    expect(result.skipped).toBe(2);
    expect(result.succeeded).toBe(0);
    expect(result.records.every((r) => r.targetState === "active")).toBe(true);
  });

  test("queue permits active sessions-query targets explicitly", async () => {
    const result = await performBulkDispatch(
      {
        source: "sessions-query",
        targets: [{ target: "sessions:2.1", source: "sessions-query", state: "active" }],
        prompt: "Queue this",
        queue: true,
        submitDelayMs: 0,
      },
      {
        makeTmux: async () => agentTmux("✶ Working… (esc to interrupt)"),
        sleep: async () => undefined,
      },
    );

    expect(result.succeeded).toBe(1);
    expect(result.records[0]).toMatchObject({
      status: "succeeded",
      targetState: "active",
      confirm: { queued: true },
      detection: { recommendedSubmitKey: "Tab" },
    });
  });

  test("returns a failed summary when a source resolves no targets", async () => {
    const result = await performBulkDispatch(
      { source: "sessions-query", targets: [], prompt: "No targets" },
      { makeTmux: async () => agentTmux() },
    );

    expect(result).toMatchObject({
      status: "failed",
      source: "sessions-query",
      requested: 0,
      planned: 0,
      detail: "no targets resolved",
    });
  });

  test("records machine setup failures and continues with other targets", async () => {
    const result = await performBulkDispatch(
      {
        targets: [
          { target: "bad:1.1", machine: "bad-machine" },
          { target: "good:1.1", machine: "local" },
        ],
        prompt: "Bulk prompt",
        goal: true,
        submit: false,
      },
      {
        makeTmux: async (machine) => {
          if (machine === "bad-machine") throw new Error("route unavailable");
          return agentTmux();
        },
        sleep: async () => undefined,
      },
    );

    expect(result.status).toBe("failed");
    expect(result.failed).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.records.find((r) => r.target === "bad:1.1")).toMatchObject({
      status: "failed",
      machine: "bad-machine",
      prompt: "/goal Bulk prompt",
      detail: "bulk dispatch failed before delivery: route unavailable",
    });
  });
});

describe("performBulkDispatch on the mosaic slice", () => {
  test("fans out to mosaic prompt.send and delivers validated receipts", async () => {
    const r = mosaicControlRunner();
    const result = await performBulkDispatch(
      {
        targets: [{ target: "work:terminal_1" }, { target: "work:terminal_2" }],
        prompt: "Bulk prompt",
        queue: true,
        maxConcurrency: 2,
      },
      {
        makeMosaic: async () => new Mosaic(r),
        sleep: async () => undefined,
      },
    );

    expect(result.status).toBe("completed");
    expect(result.requested).toBe(2);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.records.every((rec) => rec.status === "succeeded" && rec.backend === "mosaic")).toBe(true);
    expect(result.records.map((rec) => rec.target).sort()).toEqual(["work:terminal_1", "work:terminal_2"]);
    expect(result.records.every((rec) => rec.confirm?.delivered === true && rec.receipt != null)).toBe(true);

    const argvs = r.argvs();
    expect(argvs).toHaveLength(2);
    expect(
      argvs.every(
        (argv) => argv[0] === "mosaic" && argv.includes("prompt") && argv.includes("send") && argv.includes("--queue"),
      ),
    ).toBe(true);
    expect(argvs.map((argv) => argv[argv.indexOf("--pane-id") + 1]).sort()).toEqual(["terminal_1", "terminal_2"]);
  });

  test("defaults to the idle guard exactly like the tmux slice", async () => {
    const result = await performBulkDispatch(
      {
        targets: [{ target: "work:terminal_1" }, { target: "work:terminal_2" }],
        prompt: "Do not interrupt active Mosaic panes by default",
      },
      {
        makeMosaic: async () => new Mosaic(mosaicControlRunner()),
        sleep: async () => undefined,
      },
    );

    expect(result.status).toBe("failed");
    expect(result.skipped).toBe(2);
    expect(result.succeeded).toBe(0);
    expect(result.records.every((rec) => rec.status === "skipped" && rec.backend === "mosaic")).toBe(true);
    expect(
      result.records.every((rec) =>
        rec.detail?.includes("Mosaic backend cannot prove target idleness in this slice"),
      ),
    ).toBe(true);
  });

  test("routes targets by machine and reuses one Mosaic per machine", async () => {
    const made: string[] = [];
    const result = await performBulkDispatch(
      {
        targets: [
          { target: "work:terminal_1" },
          { target: "work:terminal_2" },
          { target: "work:terminal_3", machine: "spark02" },
        ],
        prompt: "Bulk prompt",
        queue: true,
      },
      {
        makeMosaic: async (machine) => {
          made.push(machine ?? "local");
          return new Mosaic(mosaicControlRunner(machine ?? "local"));
        },
        sleep: async () => undefined,
      },
    );

    expect(result.status).toBe("completed");
    expect(result.succeeded).toBe(3);
    expect(made).toHaveLength(2);
    expect(made).toContain("local");
    expect(made).toContain("spark02");
    expect(result.records.map((rec) => rec.machine).sort()).toEqual(["local", "local", "spark02"]);
  });
});
