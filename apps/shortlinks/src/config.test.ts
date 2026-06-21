import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeHostname } from "./config.js";

describe("normalizeHostname", () => {
  test("normalizes protocol, case, path, and trailing dot", () => {
    expect(normalizeHostname("https://HAS.NA/docs.")).toBe("has.na");
    expect(normalizeHostname("go.example.com.")).toBe("go.example.com");
  });

  test("rejects hostnames with invalid DNS labels", () => {
    expect(() => normalizeHostname("-bad.example.com")).toThrow("Invalid domain");
    expect(() => normalizeHostname("bad-.example.com")).toThrow("Invalid domain");
    expect(() => normalizeHostname(`go.${"a".repeat(64)}.example.com`)).toThrow("Invalid domain");
  });
});

describe("getClickSalt", () => {
  test("initializes one salt across concurrent first-use processes", async () => {
    const home = mkdtempSync(join(tmpdir(), "shortlinks-click-salt-"));
    const configUrl = pathToFileURL(join(process.cwd(), "src/config.ts")).href;
    const script = `import { getClickSalt } from ${JSON.stringify(configUrl)};\nconsole.log(getClickSalt());`;
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) env[key] = value;
    }
    env.SHORTLINKS_HOME = home;
    delete env.SHORTLINKS_CLICK_SALT;

    try {
      const processes = Array.from({ length: 24 }, () => Bun.spawn({
        cmd: ["bun", "-e", script],
        cwd: process.cwd(),
        env,
        stdout: "pipe",
        stderr: "pipe",
      }));
      const results = await Promise.all(processes.map(async (proc) => ({
        exitCode: await proc.exited,
        stdout: await new Response(proc.stdout).text(),
        stderr: await new Response(proc.stderr).text(),
      })));
      const failures = results.filter((result) => result.exitCode !== 0);
      if (failures.length > 0) {
        throw new Error(failures.map((result) => result.stderr).join("\n"));
      }

      const salts = results.map((result) => result.stdout.trim()).filter(Boolean);
      expect(salts).toHaveLength(24);
      expect(new Set(salts).size).toBe(1);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
