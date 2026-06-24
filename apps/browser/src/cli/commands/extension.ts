import type { Command } from "commander";
import chalk from "chalk";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { limited, parseLimit, printListFooter, shortId } from "../output.js";

const DEFAULT_SERVER_URL = `http://127.0.0.1:${process.env["BROWSER_SERVER_PORT"] ?? "7030"}`;

function extensionPath(): string {
  const sourcePath = join(import.meta.dir, "../../../extension/dist");
  if (existsSync(sourcePath)) return sourcePath;
  return join(import.meta.dir, "../../extension/dist");
}

function headers(): Record<string, string> {
  const out: Record<string, string> = { "Content-Type": "application/json" };
  const apiKey = process.env["BROWSER_API_KEY"];
  if (apiKey) out["Authorization"] = `Bearer ${apiKey}`;
  return out;
}

function normalizeServer(url: string): string {
  return url.replace(/\/+$/, "");
}

async function request<T>(serverUrl: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${normalizeServer(serverUrl)}${path}`, {
    ...init,
    headers: { ...headers(), ...(init?.headers as Record<string, string> | undefined) },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
  return response.json() as Promise<T>;
}

export function register(program: Command) {
  const extension = program
    .command("extension")
    .description("Pair and inspect the Chrome MV3 extension bridge");

  extension
    .command("path")
    .description("Print the built extension/dist path for Chrome Load unpacked")
    .option("--json", "Output as JSON")
    .action((opts: { json?: boolean }) => {
      const path = extensionPath();
      if (opts.json) console.log(JSON.stringify({ path }, null, 2));
      else console.log(path);
    });

  extension
    .command("pair")
    .description("Create a short-lived extension pairing code on browser-serve")
    .option("--server <url>", "browser-serve URL", DEFAULT_SERVER_URL)
    .option("--ttl-ms <ms>", "Pairing code lifetime in milliseconds", "300000")
    .option("--wait", "Poll status until an extension connects")
    .option("--timeout-ms <ms>", "Wait timeout in milliseconds", "60000")
    .option("--json", "Output as JSON")
    .action(async (opts: { server: string; ttlMs: string; wait?: boolean; timeoutMs: string; json?: boolean }) => {
      const pair = await request<{ code: string; expires_at: string; extension_path: string; websocket_url: string }>(
        opts.server,
        "/api/extension/pair",
        {
          method: "POST",
          body: JSON.stringify({ ttl_ms: Number(opts.ttlMs) }),
        },
      );

      if (opts.wait) {
        const deadline = Date.now() + Number(opts.timeoutMs);
        while (Date.now() < deadline) {
          const status = await request<{ connected: boolean }>(opts.server, "/api/extension/status");
          if (status.connected) break;
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      if (opts.json) {
        console.log(JSON.stringify(pair, null, 2));
        return;
      }

      console.log(chalk.bold("Chrome extension pairing"));
      console.log(`  Code: ${chalk.green(pair.code)}`);
      console.log(`  Expires: ${pair.expires_at}`);
      console.log(`  Load unpacked: ${pair.extension_path}`);
      console.log(`  Server: ${opts.server}`);
    });

  extension
    .command("status")
    .description("Show extension pairing and connection status")
    .option("--server <url>", "browser-serve URL", DEFAULT_SERVER_URL)
    .option("--json", "Output as JSON")
    .option("--limit <n>", "Max extension rows to print in compact output", String(20))
    .option("--verbose", "Show full token ids")
    .action(async (opts: { server: string; json?: boolean; limit?: string; verbose?: boolean }) => {
      const status = await request<unknown>(opts.server, "/api/extension/status");
      if (opts.json) {
        console.log(JSON.stringify(status, null, 2));
        return;
      }
      const typed = status as { paired?: boolean; connected?: boolean; extensions?: Array<{ token_id: string; connected: boolean; last_seen_at?: string }> };
      console.log(`Paired: ${typed.paired ? chalk.green("yes") : chalk.gray("no")}`);
      console.log(`Connected: ${typed.connected ? chalk.green("yes") : chalk.gray("no")}`);
      const extensions = typed.extensions ?? [];
      const { visible } = limited(extensions, parseLimit(opts.limit));
      for (const ext of visible) {
        const token = opts.verbose ? ext.token_id : shortId(ext.token_id);
        console.log(`  ${token} ${ext.connected ? chalk.green("connected") : chalk.gray("offline")} ${ext.last_seen_at ?? ""}`);
      }
      if (extensions.length > 0) printListFooter(extensions.length, visible.length, "Use --limit N, --verbose, or --json for full extension token details.");
    });

  extension
    .command("unpair")
    .description("Revoke one extension token or all extension tokens")
    .option("--server <url>", "browser-serve URL", DEFAULT_SERVER_URL)
    .option("--token-id <id>", "Specific extension token id to revoke")
    .option("--json", "Output as JSON")
    .action(async (opts: { server: string; tokenId?: string; json?: boolean }) => {
      const result = await request<unknown>(opts.server, "/api/extension/unpair", {
        method: "POST",
        body: JSON.stringify({ token_id: opts.tokenId }),
      });
      if (opts.json) console.log(JSON.stringify(result, null, 2));
      else console.log(chalk.green("Revoked extension pairing"));
    });
}
