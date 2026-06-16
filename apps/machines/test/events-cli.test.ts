import { describe, expect, test } from "bun:test";

describe("events CLI surface", () => {
  test("exposes shared webhooks and events commands", async () => {
    const child = Bun.spawn({
      cmd: ["bun", "run", "src/cli/index.ts", "--help"],
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    });
    const [stdout, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      child.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("webhooks");
    expect(stdout).toContain("events");
  });
});
