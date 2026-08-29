import { describe, expect, it, mock } from "bun:test";

// Regression: `crawl open <page-id>` interpolated the stored, crawler-controlled
// page.url into a shell command string (release-review P1 for @hasna/crawl@0.4.19).
// openInBrowser must pass the URL as an argv element to a NON-shell launcher on
// every platform — no sh, no cmd.exe (cmd re-parses its command line and treats
// & | < > as metacharacters even in argv position).

const calls: Array<{ cmd: string; args: string[] }> = [];

mock.module("child_process", () => ({
  spawnSync: (cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    return { status: 0, error: undefined, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  },
  execSync: () => {
    throw new Error("execSync must not be used by openInBrowser");
  },
}));

describe("platformCommand", () => {
  it("passes the raw URL as a single argv element on unix (no shell quoting, no interpolation)", async () => {
    const { platformCommand } = await import("./open-browser.js");
    const evil = `https://example.com/"$(touch /tmp/crawl-pwned)"`;
    const target = platformCommand("linux", evil);
    expect(target).not.toBeNull();
    expect(target!.cmd).toBe("xdg-open");
    expect(target!.args).toEqual([evil]);
    expect(target!.args.join(" ")).toBe(evil);
  });

  it("never routes the win32 path through cmd.exe (explorer argv-only)", async () => {
    const { platformCommand } = await import("./open-browser.js");
    const evil = `https://example.com/?x=1&calc.exe|more`;
    const target = platformCommand("win32", evil);
    expect(target).not.toBeNull();
    expect(target!.cmd).toBe("explorer");
    expect(target!.args).toEqual([evil]);
    expect(target!.cmd + " " + target!.args.join(" ")).not.toContain("cmd");
  });

  it("refuses non-http(s) URLs outright", async () => {
    const { platformCommand } = await import("./open-browser.js");
    for (const bad of ["javascript:alert(1)", "file:///etc/passwd", "not a url"]) {
      expect(platformCommand("linux", bad)).toBeNull();
    }
  });

  it("openInBrowser reports ok for a successful argv launch", async () => {
    calls.length = 0;
    const { openInBrowser } = await import("./open-browser.js");
    const result = openInBrowser("https://example.com/");
    expect(result.ok).toBe(true);
    expect(calls.length).toBe(1);
  });
});
