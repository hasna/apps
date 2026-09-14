import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { signingFixtureCommand } from "./helpers/signing-fixture.js";
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runStartupFixture, startupFixtureEnv } from "./helpers/startup-fixture.js";

async function entry(surface: "cli" | "mcp" | "server", args: string[], token = false, input: string | Uint8Array = "") {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "recordings-hosted-entry-")));
  chmodSync(home, 0o700);
  try {
    const result = await runStartupFixture(home, [process.execPath, "--preload",
      join(import.meta.dir, "helpers/hosted-entry-preload.ts"), join(import.meta.dir, "../" + surface + "/index.ts"), ...args],
      startupFixtureEnv(home, token ? { SELECTED_SESSION: "fictional-entry-session" } : {}), input);
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

test.each([false, true])("real MCP stdio entry preserves reads and gates mutations with allowWrites=%s", async allowWrites => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "recordings-hosted-entry-"))); chmodSync(home, 0o700);
  const command = signingFixtureCommand(home, [process.execPath, "--preload", join(import.meta.dir, "helpers/hosted-entry-preload.ts"),
    join(import.meta.dir, "../mcp/index.ts"), "--hosted", "--stdio", "--api-base", "https://fictional.example.test/api/v1/",
    "--credential-env", "SELECTED_SESSION", ...(allowWrites ? ["--allow-writes"] : [])]);
  const transport = new StdioClientTransport({ command: command[0]!, args: command.slice(1), cwd: home,
    env: startupFixtureEnv(home, { SELECTED_SESSION: "fictional-entry-session" }), stderr: "pipe" });
  const client = new Client({ name: "fictional-paste-process", version: "1" });
  const counts = () => JSON.parse(readFileSync(join(home, "boundary.json"), "utf8"));
  let stderr = "";
  try {
    await client.connect(transport, { timeout: 3000 });
    transport.stderr?.on("data", chunk => { stderr += String(chunk); if (stderr.length > 65536) void transport.close(); });
    const { tools } = await client.listTools({}, { timeout: 3000 });
    const reads = ["recordings_hosted_audio_metadata", "recordings_hosted_export", "recordings_hosted_get", "recordings_hosted_list", "recordings_hosted_paste_history", "recordings_hosted_providers"];
    expect(tools.map(tool => tool.name).sort()).toEqual([...reads, ...(allowWrites ? ["recordings_hosted_delete", "recordings_hosted_paste_save", "recordings_hosted_rename", "recordings_hosted_save"] : [])].sort());
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
    const exported = await client.callTool({ name: "recordings_hosted_export", arguments: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } }, undefined, { timeout: 3000 });
    expect(exported.isError).not.toBe(true);
    expect(exported.structuredContent).toEqual({ recordingId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      fileName: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.txt", mediaType: "text/plain; charset=utf-8", text: "Hidden fictional transcript." });
    expect(counts()).toEqual({ denied: 0, requests: 3 }); expect(stderr).toBe("");
    if (allowWrites) {
      const saved = await client.callTool({ name: "recordings_hosted_save", arguments: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        title: "Saved", transcript: "Hidden fictional transcript.", durationMs: 1000 } }, undefined, { timeout: 3000 });
      expect(saved.isError).not.toBe(true); expect(saved.structuredContent).toMatchObject({ recording: { title: "Saved" } });
      expect(JSON.stringify(saved)).not.toContain("Hidden fictional transcript");
      const renamed = await client.callTool({ name: "recordings_hosted_rename", arguments: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", title: " Renamed " } }, undefined, { timeout: 3000 });
      expect(renamed.isError).not.toBe(true); expect(renamed.structuredContent).toMatchObject({ recording: { title: "Renamed" } });
      expect(JSON.stringify(renamed)).not.toContain("Hidden fictional transcript");
      const deleted = await client.callTool({ name: "recordings_hosted_delete", arguments: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } }, undefined, { timeout: 3000 });
      expect(deleted.isError).not.toBe(true); expect(deleted.structuredContent).toEqual({ state: "pending" });
      const pasted = await client.callTool({ name: "recordings_hosted_paste_save", arguments: {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", recordingId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        text: "Hidden fictional paste.", status: "confirmed",
      } }, undefined, { timeout: 3000 });
      expect(pasted.isError).not.toBe(true); expect(pasted.structuredContent).toMatchObject({ receipt: { status: "confirmed" } });
      expect(JSON.stringify(pasted)).not.toContain("Hidden fictional paste.");
      expect(counts()).toEqual({ denied: 0, requests: 7 }); expect(stderr).toBe("");
    } else {
      const refused = await client.callTool({ name: "recordings_hosted_delete", arguments: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } }, undefined, { timeout: 3000 });
      expect(refused.isError).toBe(true); expect(counts()).toEqual({ denied: 0, requests: 3 });
    }
  } finally { await client.close(); await transport.close(); rmSync(home, { recursive: true, force: true }); }
}, 15000);

test("real hosted CLI rename and delete make one request each without local fallback", async () => {
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const connection = ["hosted", "--api-base", "https://fictional.example.test/api/v1/", "--credential-env", "SELECTED_SESSION"];
  for (const args of [["rename", id, " Renamed "], ["delete", id]]) {
    const result = await entry("cli", [...connection, ...args], true);
    expect(result.exitCode).toBe(0); expect(result.requests).toBe(1); expect(result.stderr).toBe("");
    const body = JSON.parse(result.stdout);
    if (args[0] === "rename") expect(body.recording.title).toBe("Renamed");
    else expect(body).toEqual({ state: "pending" });
    expect(result.stdout).not.toContain("Hidden fictional transcript");
    const missing = await entry("cli", [...connection, ...args]);
    expect(missing.exitCode).toBe(1); expect(missing.requests).toBe(0);
  }
  for (const args of [["rename", id, " "], ["delete", "../account"]]) {
    const invalid = await entry("cli", [...connection, ...args], true);
    expect(invalid.exitCode).toBe(1); expect(invalid.requests).toBe(0);
  }
});

test("real hosted CLI save uses the hosted write path once without private output", async () => {
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const connection = ["hosted", "--api-base", "https://fictional.example.test/api/v1/", "--credential-env", "SELECTED_SESSION"];
  const result = await entry("cli", [...connection, "save", id, "Saved", "--transcript", "Hidden fictional transcript.", "--duration-ms", "1000"], true);
  expect(result.exitCode).toBe(0); expect(result.requests).toBe(1); expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout).recording.title).toBe("Saved");
  expect(result.stdout).not.toContain("Hidden fictional transcript.");
  const missing = await entry("cli", [...connection, "save", id, "Saved", "--transcript", "Hidden fictional transcript.", "--duration-ms", "1000"]);
  expect(missing.exitCode).toBe(1); expect(missing.requests).toBe(0);
});

test("real hosted CLI save reads one bounded UTF-8 transcript from stdin", async () => {
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const connection = ["hosted", "--api-base", "https://fictional.example.test/api/v1/", "--credential-env", "SELECTED_SESSION"];
  const result = await entry("cli", [...connection, "save", id, "Saved", "--transcript-stdin", "--duration-ms", "1000"], true,
    "Hidden fictional transcript.");
  expect(result.exitCode).toBe(0); expect(result.requests).toBe(1); expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout).recording.title).toBe("Saved");
  expect(result.stdout).not.toContain("Hidden fictional transcript.");
});

test("real hosted CLI paste-save reads bounded UTF-8 stdin and omits private output", async () => {
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const connection = ["hosted", "--api-base", "https://fictional.example.test/api/v1/", "--credential-env", "SELECTED_SESSION"];
  const result = await entry("cli", [...connection, "paste-save", id, "--text-stdin", "--status", "confirmed", "--recording-id", id],
    true, "Hidden fictional paste.");
  expect(result.exitCode).toBe(0); expect(result.requests).toBe(1); expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout).receipt.status).toBe("confirmed");
  expect(result.stdout).not.toContain("Hidden fictional paste.");
});

test("hosted CLI paste-save rejects malformed and oversized stdin before credentials or writes", async () => {
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const connection = ["hosted", "--api-base", "https://fictional.example.test/api/v1/", "--credential-env", "SELECTED_SESSION",
    "paste-save", id, "--text-stdin", "--status", "confirmed"];
  for (const input of [new Uint8Array([0xff]), "x".repeat(1_048_577)] as const) {
    const result = await entry("cli", connection, true, input);
    expect(result.exitCode).toBe(1); expect(result.requests).toBe(0); expect(result.stderr).toBe("");
  }
});

test("hosted CLI stdin save rejects empty, conflicting, malformed and oversized input before credentials or writes", async () => {
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const connection = ["hosted", "--api-base", "https://fictional.example.test/api/v1/", "--credential-env", "SELECTED_SESSION"];
  for (const [args, input] of [
    [[...connection, "save", id, "Saved", "--duration-ms", "1000"], ""],
    [[...connection, "save", id, "Saved", "--transcript-stdin", "--duration-ms", "1000"], ""],
    [[...connection, "save", id, "Saved", "--transcript", " ", "--duration-ms", "1000"], ""],
    [[...connection, "save", id, "Saved", "--transcript", "Hidden fictional transcript.", "--transcript-stdin", "--duration-ms", "1000"], "ignored"],
    [[...connection, "save", id, "Saved", "--transcript-stdin", "--duration-ms", "1000"], new Uint8Array([0xff])],
    [[...connection, "save", id, "Saved", "--transcript-stdin", "--duration-ms", "1000"], "x".repeat(1_048_577)],
  ] as const) {
    const result = await entry("cli", args, true, input);
    expect(result.exitCode).toBe(1); expect(result.requests).toBe(0); expect(result.stderr).toBe("");
    expect(result.stdout).not.toContain("Hidden fictional transcript.");
  }
});

function processAudioFixture(): Uint8Array {
  const pcm = new Uint8Array(4_802);
  const bytes = new Uint8Array(44 + pcm.byteLength);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("RIFF"), 0); view.setUint32(4, bytes.byteLength - 8, true);
  bytes.set(new TextEncoder().encode("WAVE"), 8); bytes.set(new TextEncoder().encode("fmt "), 12);
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 24_000, true); view.setUint32(28, 48_000, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  bytes.set(new TextEncoder().encode("data"), 36); view.setUint32(40, pcm.byteLength, true); bytes.set(pcm, 44);
  return bytes;
}

const PROCESS_AUDIO_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROCESS_AUDIO_BASE = "https://fictional.example.test/api/v1/";
const PROCESS_AUDIO_PRELOAD = join(import.meta.dir, "helpers/hosted-entry-preload.ts");

function readEntryBoundary(home: string) {
  expect(existsSync(join(home, "boundary.json"))).toBe(true);
  return JSON.parse(readFileSync(join(home, "boundary.json"), "utf8")) as { denied: number; requests: number };
}

test("real hosted CLI audio metadata/upload/download use raw files and preserve destinations", async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "recordings-hosted-entry-"))); chmodSync(home, 0o700);
  const source = join(home, "source.wav"), destination = join(home, "download.wav"), existing = join(home, "existing.wav");
  const audio = processAudioFixture(), sha256 = createHash("sha256").update(audio).digest("hex");
  writeFileSync(source, audio);
  const command = [process.execPath, "--preload", PROCESS_AUDIO_PRELOAD, join(import.meta.dir, "../cli/index.ts")];
  const connection = ["--json", "hosted", "--api-base", PROCESS_AUDIO_BASE, "--credential-env", "SELECTED_SESSION"];
  try {
    const metadata = await runStartupFixture(home, [...command, ...connection, "audio-metadata", PROCESS_AUDIO_ID], startupFixtureEnv(home, { SELECTED_SESSION: "fictional-entry-session" }));
    expect(metadata.exitCode).toBe(0); expect(readEntryBoundary(home)).toEqual({ denied: 0, requests: 1 });
    expect(JSON.parse(metadata.stdout)).toMatchObject({ state: "available", byteLength: audio.byteLength, pcmBytes: 4_802, sha256, durationMs: 4_802 / 48 });
    expect(metadata.stdout).not.toContain("Hidden fictional transcript"); expect(metadata.stderr).toBe("");

    const upload = await runStartupFixture(home, [...command, ...connection, "audio-upload", PROCESS_AUDIO_ID, "--input", source, "--retain-audio"], startupFixtureEnv(home, { SELECTED_SESSION: "fictional-entry-session" }));
    expect(upload.exitCode).toBe(0); expect(readEntryBoundary(home)).toEqual({ denied: 0, requests: 1 });
    expect(JSON.parse(upload.stdout)).toMatchObject({ state: "available", byteLength: audio.byteLength, sha256 });
    expect(upload.stdout).not.toContain("Hidden fictional transcript"); expect(upload.stderr).toBe("");

    const download = await runStartupFixture(home, [...command, ...connection, "audio-download", PROCESS_AUDIO_ID, "--output", destination], startupFixtureEnv(home, { SELECTED_SESSION: "fictional-entry-session" }));
    expect(download.exitCode).toBe(0); expect(readEntryBoundary(home)).toEqual({ denied: 0, requests: 1 });
    expect(JSON.parse(download.stdout)).toMatchObject({ byteLength: audio.byteLength, sha256, status: 200 });
    expect(new Uint8Array(readFileSync(destination))).toEqual(audio); expect(download.stdout).not.toContain("Hidden fictional transcript"); expect(download.stderr).toBe("");

    writeFileSync(existing, Buffer.from("preserve"));
    const refused = await runStartupFixture(home, [...command, ...connection, "audio-download", PROCESS_AUDIO_ID, "--output", existing], startupFixtureEnv(home, { SELECTED_SESSION: "fictional-entry-session" }));
    expect(refused.exitCode).toBe(1); expect(readEntryBoundary(home)).toEqual({ denied: 0, requests: 0 });
    expect(readFileSync(existing, "utf8")).toBe("preserve"); expect(refused.stdout).not.toContain("existing.wav"); expect(refused.stderr).toBe("");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("real hosted MCP audio tools use configured basenames and raw files", async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "recordings-hosted-entry-"))); chmodSync(home, 0o700);
  const source = join(home, "source.wav"), destination = join(home, "roundtrip.wav"), audio = processAudioFixture();
  writeFileSync(source, audio);
  const command = signingFixtureCommand(home, [process.execPath, "--preload", PROCESS_AUDIO_PRELOAD,
    join(import.meta.dir, "../mcp/index.ts"), "--hosted", "--stdio", "--allow-writes", "--audio-directory", home,
    "--api-base", PROCESS_AUDIO_BASE, "--credential-env", "SELECTED_SESSION"]);
  const transport = new StdioClientTransport({ command: command[0]!, args: command.slice(1), cwd: home,
    env: startupFixtureEnv(home, { SELECTED_SESSION: "fictional-entry-session" }), stderr: "pipe" });
  const client = new Client({ name: "fictional-audio-process", version: "1" });
  let stderr = "";
  try {
    await client.connect(transport, { timeout: 3000 });
    transport.stderr?.on("data", chunk => { stderr += String(chunk); });
    const listed = await client.listTools({}, { timeout: 3000 });
    expect(listed.tools.map(tool => tool.name)).toEqual(expect.arrayContaining([
      "recordings_hosted_audio_metadata", "recordings_hosted_audio_upload", "recordings_hosted_audio_download",
    ]));
    const metadata = await client.callTool({ name: "recordings_hosted_audio_metadata", arguments: { id: PROCESS_AUDIO_ID } }, undefined, { timeout: 3000 });
    expect(metadata.isError).not.toBe(true); expect(metadata.structuredContent).toMatchObject({ state: "available", byteLength: audio.byteLength });
    const upload = await client.callTool({ name: "recordings_hosted_audio_upload", arguments: { id: PROCESS_AUDIO_ID, fileName: "source.wav", retainAudio: true } }, undefined, { timeout: 3000 });
    expect(upload.isError).not.toBe(true); expect(upload.structuredContent).toMatchObject({ state: "available", byteLength: audio.byteLength });
    const download = await client.callTool({ name: "recordings_hosted_audio_download", arguments: { id: PROCESS_AUDIO_ID, fileName: "roundtrip.wav" } }, undefined, { timeout: 3000 });
    expect(download.isError).not.toBe(true); expect(download.structuredContent).toMatchObject({ fileName: "roundtrip.wav", byteLength: audio.byteLength, status: 200 });
    expect(JSON.stringify(download)).not.toContain(home); expect(new Uint8Array(readFileSync(destination))).toEqual(audio);
    expect(readEntryBoundary(home)).toEqual({ denied: 0, requests: 3 }); expect(stderr).toBe("");
  } finally { await client.close(); await transport.close(); rmSync(home, { recursive: true, force: true }); }
}, 15000);

test("write startup flag cannot enter legacy MCP or serve modes", async () => {
  for (const surface of ["mcp", "server"] as const) {
    for (const flag of ["--allow-writes", "--allow-writes=true"]) {
      const result = await entry(surface, [flag]);
      expect(result.exitCode).toBe(1); expect(result.requests).toBe(0);
      expect(JSON.parse(result.stderr).error.code).toBe("invalid_configuration");
    }
  }
});
