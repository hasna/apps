#!/usr/bin/env bun
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface CommandResult {
  command: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
}

const textDecoder = new TextDecoder();
const filesCommand = commandFromEnv();
const testDir = mkdtempSync(join(tmpdir(), "open-files-installed-knowledge-smoke-"));
const sourceRoot = join(testDir, "source");
const dataDir = join(testDir, "data");
const dbPath = join(dataDir, "files.db");
const sentinel = `OPEN_FILES_KNOWLEDGE_PACKAGE_SMOKE_${Date.now()}_${Math.random().toString(16).slice(2)}`;
const env = {
  ...process.env,
  HASNA_FILES_DATA_DIR: dataDir,
  HASNA_FILES_DB_PATH: dbPath,
};

try {
  mkdirSync(sourceRoot, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(
    join(sourceRoot, "package-smoke.md"),
    [
      "# Open-files package smoke",
      "This file proves the installed package can export source refs.",
      sentinel,
      "",
    ].join("\n"),
  );

  const version = run([...filesCommand, "--version"]).stdout.trim();
  run([...filesCommand, "sources", "add", sourceRoot, "--name", "installed-knowledge-smoke"]);
  run([...filesCommand, "index"]);

  const sources = parseJson<Array<{ id: string; name: string }>>(
    run([...filesCommand, "sources", "list", "--json"]).stdout,
    "sources list",
  );
  const source = sources.find((entry) => entry.name === "installed-knowledge-smoke");
  if (!source) throw new Error("Smoke source was not created.");

  const files = parseJson<Array<{ id: string; name: string }>>(
    run([...filesCommand, "list", "--json"]).stdout,
    "files list",
  );
  const file = files.find((entry) => entry.name === "package-smoke.md");
  if (!file) throw new Error("Smoke file was not indexed.");
  const sourceRef = `open-files://file/${file.id}`;

  const manifest = parseJson<{
    items: Array<{
      source_ref: string;
      revision_id?: string;
      source_revision_hash?: string;
      open_files_root?: unknown;
      storage?: unknown;
    }>;
  }>(run([...filesCommand, "knowledge", "manifest", "--source", source.id, "--json"]).stdout, "knowledge manifest");
  const manifestItem = manifest.items.find((item) => item.source_ref === sourceRef);
  if (!manifestItem) throw new Error("Manifest does not include the smoke file source ref.");
  if (!manifestItem.revision_id) throw new Error("Manifest item is missing revision_id.");
  if (!manifestItem.source_revision_hash?.startsWith("sha256:")) {
    throw new Error("Manifest item is missing source_revision_hash.");
  }
  if (!manifestItem.open_files_root) throw new Error("Manifest item is missing open_files_root evidence.");

  const manifestText = JSON.stringify(manifest);
  assertDoesNotContainRawOrSecrets(manifestText, "manifest");

  const doctor = parseJson<{
    checks: Array<{ source_ref: string; status: string; recommendation: string }>;
  }>(run([...filesCommand, "knowledge", "doctor", sourceRef, "--json"]).stdout, "knowledge doctor");
  const doctorCheck = doctor.checks.find((check) => check.source_ref === sourceRef);
  if (!doctorCheck) throw new Error("Doctor output does not include the smoke source ref.");
  if (doctorCheck.status !== "ready") throw new Error(`Doctor status is not ready: ${doctorCheck.status}`);
  if (doctorCheck.recommendation !== "none") {
    throw new Error(`Doctor recommendation is not none: ${doctorCheck.recommendation}`);
  }

  const resolved = parseJson<{
    status: string;
    source_ref: string;
    content: {
      extracted_text_ref?: string;
      extraction?: { status: string; extractor: string };
      bytes_base64?: string;
    };
    extracted_text?: unknown;
    storage?: unknown;
    access?: unknown;
  }>(
    run([...filesCommand, "knowledge", "resolve", sourceRef, "--mode", "extracted_text", "--max-bytes", "4096", "--json"]).stdout,
    "knowledge resolve",
  );
  if (resolved.status !== "ready") throw new Error(`Resolver status is not ready: ${resolved.status}`);
  if (resolved.source_ref !== sourceRef && !resolved.source_ref.startsWith(`${sourceRef}/revision/`)) {
    throw new Error(`Resolver returned an unexpected source_ref: ${resolved.source_ref}`);
  }
  if (!resolved.content.extracted_text_ref) throw new Error("Resolver output is missing extracted_text_ref.");
  if (resolved.content.extraction?.status !== "ready") throw new Error("Resolver extraction status is not ready.");
  if (resolved.content.bytes_base64) throw new Error("Resolver output contains a raw base64 byte dump.");
  assertDoesNotContainSecrets(JSON.stringify(resolved), "resolver");

  const outbox = parseJson<{
    events: Array<{ event_type: string; file_id?: string; source_ref?: string }>;
    watermark?: unknown;
  }>(run([...filesCommand, "knowledge", "outbox", "poll", "--json"]).stdout, "knowledge outbox");
  if (!outbox.events.some((event) => event.event_type === "indexed" && event.file_id === file.id)) {
    throw new Error("Outbox does not include the smoke file indexed event.");
  }
  assertDoesNotContainRawOrSecrets(JSON.stringify(outbox), "outbox");

  const summary = {
    ok: true,
    files_version: version,
    command: filesCommand.join(" "),
    checked: {
      manifest: true,
      doctor: true,
      resolver: true,
      outbox: true,
      no_raw_sentinel_in_manifest_or_outbox: true,
      no_secret_fields: true,
    },
    source_ref: sourceRef,
    revision_id: manifestItem.revision_id,
    open_files_root: true,
  };
  console.log(JSON.stringify(summary, null, 2));
} finally {
  if (process.env.KEEP_OPEN_FILES_KNOWLEDGE_SMOKE_DIR !== "1") {
    rmSync(testDir, { recursive: true, force: true });
  } else {
    console.error(`Kept smoke directory: ${testDir}`);
  }
}

function commandFromEnv(): string[] {
  const bin = process.env.FILES_BIN?.trim() || "files";
  const args = splitArgs(process.env.FILES_BIN_ARGS ?? "");
  return [bin, ...args];
}

function splitArgs(value: string): string[] {
  return value.split(/\s+/).map((part) => part.trim()).filter(Boolean);
}

function run(command: string[]): CommandResult {
  const proc = Bun.spawnSync({
    cmd: command,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const result = {
    command,
    exitCode: proc.exitCode,
    stdout: textDecoder.decode(proc.stdout),
    stderr: textDecoder.decode(proc.stderr),
  };
  if (result.exitCode !== 0) {
    throw new Error([
      `Command failed (${result.exitCode}): ${command.join(" ")}`,
      result.stdout.trim(),
      result.stderr.trim(),
    ].filter(Boolean).join("\n"));
  }
  return result;
}

function parseJson<T>(value: string, label: string): T {
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    throw new Error(`Invalid JSON from ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertDoesNotContainRawOrSecrets(value: string, label: string): void {
  if (value.includes(sentinel)) throw new Error(`${label} output contains the raw sentinel text.`);
  assertDoesNotContainSecrets(value, label);
}

function assertDoesNotContainSecrets(value: string, label: string): void {
  for (const field of ["accessKeyId", "secretAccessKey", "sessionToken", "X-Amz-Credential"]) {
    if (value.includes(field)) throw new Error(`${label} output contains secret-like field ${field}.`);
  }
}
