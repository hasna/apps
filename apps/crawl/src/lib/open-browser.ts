import { spawnSync } from "child_process";

// Opens a URL in the system browser WITHOUT passing it through a shell.
// The stored page.url is crawler-controlled (it comes from crawled pages), so it
// must never be interpolated into a shell command string (release-review P1 for
// @hasna/crawl@0.4.19 — command injection via `crawl open <page-id>`).

export interface OpenBrowserResult {
  ok: boolean;
  error?: string;
}

export function openInBrowser(url: string): OpenBrowserResult {
  let cmd: string;
  let args: string[];

  if (process.platform === "darwin") {
    cmd = "open";
    args = [url];
  } else if (process.platform === "win32") {
    // `start` is a cmd builtin; pass the URL as a separate argv element.
    cmd = "cmd";
    args = ["/c", "start", "", url];
  } else {
    cmd = "xdg-open";
    args = [url];
  }

  const res = spawnSync(cmd, args, { stdio: "ignore" });
  if (res.error) {
    return { ok: false, error: res.error.message };
  }
  if (res.status !== 0) {
    return { ok: false, error: `exited with status ${res.status}` };
  }
  return { ok: true };
}
