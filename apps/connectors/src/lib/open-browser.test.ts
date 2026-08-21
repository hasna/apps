import { describe, expect, test, mock } from "bun:test";

// Regression for the W2-12 browser-launch change: it hand-rolled
// `spawn("start", [url])` on Windows. `start` is a cmd.exe built-in, not an
// executable, so shell-less spawn fails with ENOENT while the CLI reported
// "Browser opened". The fix delegates to the `open` package (already a
// runtime dependency), which implements the Windows path as
// `cmd.exe /c start "" <escaped-url>` with proper quoting, and surfaces
// failure to the caller. These tests pin BOTH halves: delegation to the
// Windows-capable opener, and failure surfacing.
const openImpl = mock(async (_url: string): Promise<void> => {});

mock.module("open", () => ({ default: openImpl }));

const { openBrowser } = await import("./open-browser");

describe("openBrowser", () => {
  test("delegates to the Windows-capable open package with the exact URL", async () => {
    openImpl.mockClear();

    const result = await openBrowser("http://localhost:3000/callback?code=abc123");

    expect(result.ok).toBe(true);
    expect(openImpl).toHaveBeenCalledWith("http://localhost:3000/callback?code=abc123");
  });

  test("surfaces launch failure instead of claiming the browser opened", async () => {
    openImpl.mockClear();
    openImpl.mockImplementationOnce(async () => {
      throw new Error("spawn ENOENT");
    });

    const result = await openBrowser("http://localhost:3000");

    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: unknown }).error).toBeInstanceOf(Error);
  });
});
