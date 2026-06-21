import { describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHelpers } from "./helpers.js";
import { shellQuote } from "../../shell-quote.js";

describe("createHelpers", () => {
  it("resolves home-relative paths for file tools", () => {
    const previousHome = process.env.HOME;
    process.env.HOME = "/tmp/test home";

    try {
      const helpers = createHelpers("test-session");
      expect(helpers.resolvePath("~/notes.md")).toBe("/tmp/test home/notes.md");
      expect(helpers.resolvePath("~")).toBe("/tmp/test home");
      expect(helpers.resolvePath("src/index.ts", "~/project")).toBe("/tmp/test home/project/src/index.ts");
    } finally {
      process.env.HOME = previousHome;
    }
  });

  it("expands home-relative cwd values before spawning commands", async () => {
    const tempHome = mkdtempSync(join(tmpdir(), "terminal-home-"));
    const workDir = join(tempHome, "work space");
    mkdirSync(workDir);
    const previousHome = process.env.HOME;
    process.env.HOME = tempHome;

    try {
      const helpers = createHelpers("test-session");
      const result = await helpers.exec("pwd", "~/work space", 5000);

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe(workDir);
    } finally {
      process.env.HOME = previousHome;
      rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it("keeps commands without timeouts in the parent process group on POSIX", async () => {
    if (process.platform === "win32") return;

    const helpers = createHelpers("test-session");
    const command = `printf "$(ps -o pgid= -p $$ | tr -d ' '):$(ps -o pgid= -p ${process.pid} | tr -d ' ')"`;
    const result = await helpers.exec(command);
    const [childProcessGroup, parentProcessGroup] = result.stdout.trim().split(":");

    expect(result.exitCode).toBe(0);
    expect(childProcessGroup).toBe(parentProcessGroup);
  });

  it("force-kills commands that ignore SIGTERM after timeout", async () => {
    const helpers = createHelpers("test-session");
    const script = "process.on('SIGTERM', () => {}); setTimeout(() => process.exit(0), 1200);";
    const command = `${shellQuote(process.execPath)} -e ${shellQuote(script)}`;
    const startedAt = Date.now();

    const result = await helpers.exec(command, undefined, 50);

    expect(Date.now() - startedAt).toBeLessThan(900);
    expect(result.exitCode).toBe(124);
    expect(result.timedOut).toBe(true);
    expect(result.stderr).toContain("Command timed out after 50ms");
  });
});
