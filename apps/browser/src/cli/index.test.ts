import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resetDatabase } from "../db/schema.js";

let tmpDir: string;

function setupDb() {
  tmpDir = mkdtempSync(join(tmpdir(), "browser-cli-test-"));
  process.env["BROWSER_DB_PATH"] = join(tmpDir, "test.db");
  process.env["BROWSER_DATA_DIR"] = tmpDir;
  resetDatabase();
}

function teardownDb() {
  resetDatabase();
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  delete process.env["BROWSER_DB_PATH"];
  delete process.env["BROWSER_DATA_DIR"];
}

async function runCli(
  ...args: string[]
): Promise<{ stdout: string; stderr: string; code: number }> {
  return runCliWithTimeout(args, 10_000);
}

async function runCliWithTimeout(
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; code: number; timedOut: boolean }> {
  const proc = Bun.spawn(
    ["bun", "run", join(import.meta.dir, "index.tsx"), ...args],
    {
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        BROWSER_DB_PATH: process.env["BROWSER_DB_PATH"],
        BROWSER_DATA_DIR: process.env["BROWSER_DATA_DIR"],
        HASNA_EVENTS_DIR: join(tmpDir, "events"),
      },
    }
  );
  const stdoutPromise = new Response(proc.stdout).text();
  const stderrPromise = new Response(proc.stderr).text();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = await Promise.race([
    proc.exited.then(() => false),
    new Promise<boolean>((resolve) => {
      timeout = setTimeout(() => {
        proc.kill();
        resolve(true);
      }, timeoutMs);
    }),
  ]);
  if (timeout) clearTimeout(timeout);
  const code = timedOut ? -1 : await proc.exited;
  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
  return { stdout, stderr, code, timedOut };
}

describe("CLI — one-shot browse commands", () => {
  beforeEach(setupDb);
  afterEach(teardownDb);

  it("check --json closes its Playwright browser and exits", async () => {
    const { stdout, code, timedOut } = await runCliWithTimeout(
      [
        "check",
        "data:text/html,<title>CLI check</title><a href='https://example.com/next'>next</a>",
        "--json",
      ],
      5_000,
    );
    expect(timedOut).toBe(false);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.title).toBe("CLI check");
    expect(parsed.links_count).toBe(1);
    expect(parsed.screenshot).toBeString();
  }, 10_000);
});

describe("CLI — help flags", () => {
  beforeEach(setupDb);
  afterEach(teardownDb);

  it("browser --help exits 0 and shows commands", async () => {
    const { stdout, code } = await runCli("--help");
    expect(code).toBe(0);
    expect(stdout).toContain("navigate");
    expect(stdout).toContain("session");
    expect(stdout).toContain("extension");
    expect(stdout).toContain("kernel");
    expect(stdout).toContain("agent");
    expect(stdout).toContain("events");
    expect(stdout).toContain("project");
    expect(stdout).toContain("webhooks");
  });

  it("browser session --help shows subcommands", async () => {
    const { stdout, code } = await runCli("session", "--help");
    expect(code).toBe(0);
    expect(stdout).toContain("create");
    expect(stdout).toContain("list");
    expect(stdout).toContain("close");
  });

  it("browser kernel --help shows Kernel operations", async () => {
    const { stdout, code } = await runCli("kernel", "--help");
    expect(code).toBe(0);
    expect(stdout).toContain("status");
    expect(stdout).toContain("sessions");
    expect(stdout).toContain("files");
    expect(stdout).toContain("replays");
  });

  it("browser navigate --help shows Kernel session flags", async () => {
    const { stdout, code } = await runCli("navigate", "--help");
    expect(code).toBe(0);
    expect(stdout).toContain("--kernel-persistence-id");
    expect(stdout).toContain("--kernel-profile-id");
    expect(stdout).toContain("--kernel-env-secret");
  });

  it("browser extension --help shows subcommands", async () => {
    const { stdout, code } = await runCli("extension", "--help");
    expect(code).toBe(0);
    expect(stdout).toContain("pair");
    expect(stdout).toContain("status");
    expect(stdout).toContain("path");
    expect(stdout).toContain("unpair");
  });

  it("browser agent --help shows subcommands", async () => {
    const { stdout, code } = await runCli("agent", "--help");
    expect(code).toBe(0);
    expect(stdout).toContain("register");
    expect(stdout).toContain("list");
    expect(stdout).toContain("heartbeat");
  });

  it("browser project --help shows subcommands", async () => {
    const { stdout, code } = await runCli("project", "--help");
    expect(code).toBe(0);
    expect(stdout).toContain("create");
    expect(stdout).toContain("list");
  });

  it("browser record --help shows subcommands", async () => {
    const { stdout, code } = await runCli("record", "--help");
    expect(code).toBe(0);
    expect(stdout).toContain("start");
    expect(stdout).toContain("stop");
    expect(stdout).toContain("replay");
  });

  it("browser events commands use the shared event store", async () => {
    const { stdout: eventsOut, code: eventsCode } = await runCli("events", "list", "--json");
    expect(eventsCode).toBe(0);
    expect(JSON.parse(eventsOut)).toEqual([]);

    const { stdout: webhooksOut, code: webhooksCode } = await runCli("webhooks", "list", "--json");
    expect(webhooksCode).toBe(0);
    expect(JSON.parse(webhooksOut)).toEqual([]);
  });

  it("browser video --help shows subcommands", async () => {
    const { stdout, code } = await runCli("video", "--help");
    expect(code).toBe(0);
    expect(stdout).toContain("record");
    expect(stdout).toContain("list");
    expect(stdout).toContain("delete");
  });

  it("browser video record --help documents TUI command recording", async () => {
    const { stdout, code } = await runCli("video", "record", "--help");
    expect(code).toBe(0);
    expect(stdout).toContain("terminal command");
    expect(stdout).toContain("--engine");
    expect(stdout).toContain("--format");
    expect(stdout).toContain("--capture-mode");
    expect(stdout).toContain("--encoding");
    expect(stdout).toContain("--crf");
    expect(stdout).toContain("--fps");
    expect(stdout).toContain("--display-scale");
    expect(stdout).toContain("--xvfb-path");
    expect(stdout).toContain("--video-bitrate");
    expect(stdout).toContain("--ffmpeg-preset");
    expect(stdout).toContain("--preset");
    expect(stdout).toContain("--tui-font-size");
    expect(stdout).toContain("--tui-zoom");
    expect(stdout).toContain("--tui-frame-fit");
    expect(stdout).toContain("--tui-padding");
  });

  it("browser video record rejects invalid options before launching capture", async () => {
    const { stderr, code, timedOut } = await runCliWithTimeout(
      ["video", "record", "https://example.test", "--format", "avi"],
      5_000,
    );

    expect(timedOut).toBe(false);
    expect(code).not.toBe(0);
    expect(stderr).toContain("Unknown --format");
  });
});

describe("CLI — session commands (DB-only)", () => {
  beforeEach(setupDb);
  afterEach(teardownDb);

  it("session list shows no sessions initially", async () => {
    const { stdout, code } = await runCli("session", "list");
    expect(code).toBe(0);
    expect(stdout).toContain("No sessions");
  });
});

describe("CLI — agent commands", () => {
  beforeEach(setupDb);
  afterEach(teardownDb);

  it("agent register creates agent and shows JSON", async () => {
    const { stdout, code } = await runCli("agent", "register", "testbot", "--description", "my bot");
    expect(code).toBe(0);
    expect(stdout).toContain("testbot");
    expect(stdout).toContain("my bot");
  });

  it("agent list shows registered agent", async () => {
    const { registerAgent, listAgents } = await import("../lib/agents.js");
    registerAgent("myagent");
    const agents = listAgents();
    expect(agents.some((a) => a.name === "myagent")).toBe(true);
  });

  it("agent list shows empty when no agents", async () => {
    const { listAgents } = await import("../lib/agents.js");
    expect(listAgents()).toHaveLength(0);
  });
});

describe("CLI — project commands", () => {
  beforeEach(setupDb);
  afterEach(teardownDb);

  it("project create creates project and shows JSON", async () => {
    const { stdout, code } = await runCli("project", "create", "myapp", "/tmp/myapp");
    expect(code).toBe(0);
    expect(stdout).toContain("myapp");
    expect(stdout).toContain("/tmp/myapp");
  });

  it("project list shows created project", async () => {
    const { ensureProject, listProjects } = await import("../db/projects.js");
    ensureProject("webapp", "/tmp/webapp");
    const projects = listProjects();
    expect(projects.some((p) => p.name === "webapp")).toBe(true);
  });

  it("project list shows empty initially", async () => {
    const { listProjects } = await import("../db/projects.js");
    expect(listProjects()).toHaveLength(0);
  });
});

describe("CLI — record commands (DB-only)", () => {
  beforeEach(setupDb);
  afterEach(teardownDb);

  it("record list shows empty initially", async () => {
    const { stdout, code } = await runCli("record", "list");
    expect(code).toBe(0);
    expect(stdout).toContain("No recordings");
  });
});

describe("CLI — version flag", () => {
  beforeEach(setupDb);
  afterEach(teardownDb);

  it("--version shows current version from package.json", async () => {
    const { stdout, code } = await runCli("--version");
    expect(code).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
