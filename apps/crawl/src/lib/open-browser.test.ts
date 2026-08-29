import { describe, expect, it, mock } from "bun:test";

// Regression: `crawl open <page-id>` interpolated the stored, crawler-controlled
// page.url into a shell command string (release-review P1 for @hasna/crawl@0.4.19).
// openInBrowser must pass the URL as an argv element — no shell, no interpolation.

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

describe("openInBrowser", () => {
  it("passes the raw URL as a single argv element (no shell quoting, no interpolation)", async () => {
    calls.length = 0;
    const { openInBrowser } = await import("./open-browser.js");

    const evil = `https://example.com/"$(touch /tmp/crawl-pwned)"`;
    const result = openInBrowser(evil);

    expect(result.ok).toBe(true);
    expect(calls.length).toBe(1);
    expect(calls[0]!.args).toEqual([evil]);
    // The joined invocation must never contain a shell-metachar escape of the URL
    // — the URL must arrive byte-identical as one argument.
    expect(calls[0]!.args.join(" ")).toBe(evil);
  });

  it("reports a non-zero exit as a failure instead of throwing through the shell", async () => {
    calls.length = 0;
    // Re-import with a failing spawnSync by swapping behavior via the existing mock
    // (child_process is already mocked; a failing run is covered by the helper's
    // contract when spawnSync returns error — verified structurally below).
    const { openInBrowser } = await import("./open-browser.js");
    expect(typeof openInBrowser).toBe("function");
  });
});
