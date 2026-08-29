import { spawnSync } from "child_process";

// Opens a URL in the system browser WITHOUT passing it through a shell.
// The stored page.url is crawler-controlled (it comes from crawled pages), so it
// must never reach a shell interpreter: no cmd.exe, no sh, no PowerShell
// (release-review P1 for @hasna/crawl@0.4.19 — command injection via
// `crawl open <page-id>`).

export interface OpenBrowserResult {
  ok: boolean;
  error?: string;
}

/**
 * Resolve the platform launcher as an argv array. Never uses a shell:
 * - darwin: `open <url>`
 * - win32:  `explorer.exe <url>` (NOT `cmd /c start` — cmd.exe re-parses its
 *   command line and treats & | < > as metacharacters even when the URL is a
 *   separate argv element)
 * - other:  `xdg-open <url>`
 *
 * Only http(s) URLs are accepted; anything else is refused (null), so a
 * malicious stored value cannot reach a launcher at all.
 */
export function platformCommand(
  platform: NodeJS.Platform,
  url: string
): { cmd: string; args: string[] } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  if (platform === "darwin") {
    return { cmd: "open", args: [url] };
  }
  if (platform === "win32") {
    return { cmd: "explorer", args: [url] };
  }
  return { cmd: "xdg-open", args: [url] };
}

export function openInBrowser(url: string): OpenBrowserResult {
  const target = platformCommand(process.platform, url);
  if (!target) {
    return { ok: false, error: "refusing to open a non-http(s) URL" };
  }

  const res = spawnSync(target.cmd, target.args, { stdio: "ignore" });
  if (res.error) {
    return { ok: false, error: res.error.message };
  }
  if (res.status !== 0) {
    return { ok: false, error: `exited with status ${res.status}` };
  }
  return { ok: true };
}
