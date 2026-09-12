import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { signingFixtureCommand } from "./helpers/signing-fixture.js";
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runStartupFixture, startupFixtureEnv } from "./helpers/startup-fixture.js";

async function entry(surface: "cli" | "mcp" | "server", args: string[], token = false) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "recordings-hosted-entry-")));
  chmodSync(home, 0o700);
  try {
    const result = await runStartupFixture(home, [process.execPath, "--preload",
      join(import.meta.dir, "helpers/hosted-entry-preload.ts"), join(import.meta.dir, "../" + surface + "/index.ts"), ...args],
      startupFixtureEnv(home, token ? { SELECTED_SESSION: "fictional-entry-session" } : {}));
    expect(existsSync(join(home, "boundary.json")), result.stderr).toBe(true);
    const counts = JSON.parse(readFileSync(join(home, "boundary.json"), "utf8"));
    expect(counts.denied).toBe(0);
    return { ...result, requests: counts.requests };
  } finally { rmSync(home, { recursive: true, force: true }); }
}

test("all real hosted entry help paths avoid providers, credentials, native controls and listeners", async () => {
  for (const surface of ["cli", "mcp", "server"] as const) {
    const result = await entry(surface, surface === "cli" ? ["hosted", "--help"] : ["--hosted", "--help"]);
    expect(result.exitCode).toBe(0); expect(result.requests).toBe(0);
    expect(result.stdout).toContain("--api-base");
    expect(result.stderr).toBe("");
  }
});

test("real CLI hosted list emits metadata through one hosted request", async () => {
  const result = await entry("cli", ["--json", "hosted", "--api-base", "https://fictional.example.test/api/v1/",
    "--credential-env", "SELECTED_SESSION", "list", "--limit", "1"], true);
  expect(result.exitCode).toBe(0); expect(result.requests).toBe(1);
  const output = JSON.parse(result.stdout);
  expect(output.recordings).toHaveLength(1); expect(output.recordings[0].title).toBe("Fictional");
  expect(result.stdout).not.toContain("Hidden fictional transcript");
  expect(result.stderr).toBe("");
});

test("real CLI provider discovery emits configured defaults without provider configuration", async () => {
  const args = ["hosted", "--api-base", "https://fictional.example.test/api/v1/", "--credential-env", "SELECTED_SESSION", "providers"];
  const result = await entry("cli", args, true);
  expect(result.exitCode).toBe(0); expect(result.requests).toBe(1); expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout)).toMatchObject({ defaultProvider: "fictional", providers: [{ defaultModel: "fictional-model", transcriptionMode: "realtime" }] });
  expect(result.stdout).not.toContain("Hidden fictional provider configuration");
  const missing = await entry("cli", args);
  expect(missing.exitCode).toBe(1); expect(missing.requests).toBe(0);
});

test("hosted process entry refusals stay fixed and cannot route to legacy modes", async () => {
  for (const [surface, args] of [
    ["mcp", ["--hosted", "--http", "--api-base", "https://fictional.example.test/api/v1/"]],
    ["server", ["--hosted", "migrate", "--api-base", "https://fictional.example.test/api/v1/"]],
    ["cli", ["--json", "hosted", "--api-base", "https://fictional.example.test/api/v1/", "--credential-env", "MISSING_SESSION", "list"]],
    ["cli", ["--json", "hosted", "--api-base", "https://fictional.example.test/api/v1/", "--credential-env", "SELECTED_SESSION", "list", "--token", "fictional-do-not-echo"]],
  ] as const) {
    const result = await entry(surface, [...args]);
    expect(result.exitCode).toBe(1); expect(result.requests).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).not.toContain("fictional.example.test");
    expect(output).not.toContain("MISSING_SESSION");
    expect(output).not.toContain("fictional-do-not-echo");
  }
});


test("real CLI hosted paste-history emits reported evidence and only explicitly requested text", async () => {
  for (const includeText of [false, true]) {
    const result = await entry("cli", ["hosted", "--api-base", "https://fictional.example.test/api/v1/",
      "--credential-env", "SELECTED_SESSION", "paste-history", "--limit", "1", ...(includeText ? ["--include-text"] : [])], true);
    expect(result.exitCode).toBe(0); expect(result.requests).toBe(1); expect(result.stderr).toBe("");
    const page = JSON.parse(result.stdout);
    expect(page.receipts[0]).toMatchObject({ destinationAppName: "Fictional editor", status: "confirmed", evidenceSource: "client_reported" });
    expect(Object.hasOwn(page.receipts[0], "text")).toBe(includeText);
    if (includeText) expect(page.receipts[0].text).toBe("Hidden fictional paste.");
    expect(result.stdout).not.toContain("Hidden future detail");
  }
});

test("real MCP stdio entry discovers without requests then serves paste history and provider catalogs", async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "recordings-hosted-entry-"))); chmodSync(home, 0o700);
  const command = signingFixtureCommand(home, [process.execPath, "--preload", join(import.meta.dir, "helpers/hosted-entry-preload.ts"),
    join(import.meta.dir, "../mcp/index.ts"), "--hosted", "--stdio", "--api-base", "https://fictional.example.test/api/v1/",
    "--credential-env", "SELECTED_SESSION"]);
  const transport = new StdioClientTransport({ command: command[0]!, args: command.slice(1), cwd: home,
    env: startupFixtureEnv(home, { SELECTED_SESSION: "fictional-entry-session" }), stderr: "pipe" });
  const client = new Client({ name: "fictional-paste-process", version: "1" });
  const counts = () => JSON.parse(readFileSync(join(home, "boundary.json"), "utf8"));
  let stderr = "";
  try {
    await client.connect(transport, { timeout: 3000 });
    transport.stderr?.on("data", chunk => { stderr += String(chunk); if (stderr.length > 65536) void transport.close(); });
    const { tools } = await client.listTools({}, { timeout: 3000 });
    expect(tools.map(tool => tool.name).sort()).toEqual(["recordings_hosted_get", "recordings_hosted_list", "recordings_hosted_paste_history", "recordings_hosted_providers"]);
    expect(counts()).toEqual({ denied: 0, requests: 0 });
    const result = await client.callTool({ name: "recordings_hosted_paste_history", arguments: { limit: 1 } }, undefined, { timeout: 3000 });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ receipts: [{ status: "confirmed", evidenceSource: "client_reported", destinationAppName: "Fictional editor" }] });
    expect(JSON.stringify(result)).not.toContain("Hidden fictional paste."); expect(JSON.stringify(result)).not.toContain("Hidden future detail");
    expect(counts()).toEqual({ denied: 0, requests: 1 }); expect(stderr).toBe("");
    const catalog = await client.callTool({ name: "recordings_hosted_providers", arguments: {} }, undefined, { timeout: 3000 });
    expect(catalog.isError).not.toBe(true);
    expect(catalog.structuredContent).toMatchObject({ defaultProvider: "fictional", providers: [{ name: "Fictional provider" }] });
    expect(JSON.stringify(catalog)).not.toContain("Hidden fictional provider configuration");
    expect(counts()).toEqual({ denied: 0, requests: 2 }); expect(stderr).toBe("");
  } finally { await client.close(); await transport.close(); rmSync(home, { recursive: true, force: true }); }
}, 15000);
