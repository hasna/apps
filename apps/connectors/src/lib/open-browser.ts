import open from "open";

export type OpenBrowserResult = { ok: true } | { ok: false; error: unknown };

/**
 * Open a URL in the platform's default browser, surfacing failure.
 *
 * The W2-12 browser-launch change hand-rolled `spawn("start", [url])` on
 * Windows. `start` is a cmd.exe built-in, not an executable, so shell-less
 * spawn fails with ENOENT while the CLI reported "Browser opened". The
 * `open` package (already a runtime dependency) implements the Windows path
 * as `cmd.exe /c start "" <escaped-url>` with proper quoting — the
 * battle-tested form the hand-rolled call lacked — and rejects on failure so
 * callers can fall back to printing the URL.
 */
export async function openBrowser(url: string): Promise<OpenBrowserResult> {
  try {
    await open(url);
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}
