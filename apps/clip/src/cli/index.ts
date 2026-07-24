#!/usr/bin/env bun
import { Command } from "commander";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readConfig, updateConfig } from "../config.js";
import { DEFAULT_PORT, resolveConfigPath } from "../paths.js";
import { renderShareQrCode } from "../qr.js";
import { ClipClient, createClipClient } from "../sdk.js";
import { purgeClipStore } from "../storage.js";
import { buildClipEvidenceRef, buildClipRecordContracts, buildClipResourceRefs } from "../contracts.js";
import type { ClipContractFormat } from "../contracts.js";
import type { CaptureAnnotation, CaptureMode, ClipboardHistoryRecord, ClipboardKind, ClipClientOptions, ClipRecord } from "../types.js";
import { startClipServer } from "../server/server.js";
import { compactRecord } from "../util.js";
import { parseCaptureAnnotations } from "../capture/annotate.js";

function getPackageVersion(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
    return (JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function globalOptions(_command?: unknown): ClipClientOptions {
  const opts = program.opts() as {
    db?: string;
    home?: string;
    artifactDir?: string;
    baseUrl?: string;
    host?: string;
    port?: string;
  };
  return {
    dbPath: opts.db,
    homeDir: opts.home,
    artifactDir: opts.artifactDir,
    baseUrl: opts.baseUrl,
    host: opts.host,
    port: opts.port ? Number.parseInt(opts.port, 10) : undefined,
  };
}

function commandOptions(command: Command | undefined): Record<string, unknown> {
  return command && typeof command.opts === "function" ? command.opts() : {};
}

function argvValue(flag: string): string | undefined {
  const index = process.argv.lastIndexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function rootAndCommandOptions(command: Command | undefined): ClipClientOptions {
  const root = globalOptions(command);
  const local = commandOptions(command) as {
    baseUrl?: string;
    host?: string;
    port?: string;
  };
  return {
    ...root,
    baseUrl: local.baseUrl ?? root.baseUrl,
    host: local.host ?? root.host,
    port: local.port ? Number.parseInt(local.port, 10) : root.port,
  };
}

function isJson(_command?: unknown): boolean {
  return Boolean((program.opts() as { json?: boolean }).json || process.argv.includes("--json"));
}

function output(program: Command, data: unknown, formatted: string): void {
  if (isJson(program)) {
    console.log(JSON.stringify(data));
    return;
  }
  console.log(formatted);
}

function normalizeContractFormat(value: unknown): ClipContractFormat | null {
  if (value === undefined || value === false) return null;
  if (value === true) return "evidence";
  const normalized = String(value).trim().toLowerCase();
  if (!normalized || normalized === "true" || normalized === "evidence" || normalized === "evidence-ref" || normalized === "evidence_ref") {
    return "evidence";
  }
  if (normalized === "resources" || normalized === "resource" || normalized === "resource-refs" || normalized === "resource_ref") {
    return "resources";
  }
  if (normalized === "all" || normalized === "bundle") return "all";
  throw new Error(`Unknown contract type '${String(value)}'. Use evidence, resources, or all.`);
}

function contractForRecord(record: ClipRecord, format: ClipContractFormat): unknown {
  if (format === "evidence") return buildClipEvidenceRef(record);
  if (format === "resources") return buildClipResourceRefs(record);
  return buildClipRecordContracts(record);
}

function outputContract(data: unknown): void {
  console.log(JSON.stringify(data));
}

function outputRecord(program: Command, record: ClipRecord, contract?: unknown): void {
  const format = normalizeContractFormat(contract);
  if (format) {
    outputContract(contractForRecord(record, format));
    return;
  }
  output(program, record, compactRecord(record));
}

function outputRecords(program: Command, records: ClipRecord[], formatted: string, contract?: unknown): void {
  const format = normalizeContractFormat(contract);
  if (format) {
    const payload = format === "resources"
      ? records.flatMap((record) => buildClipResourceRefs(record))
      : records.map((record) => contractForRecord(record, format));
    outputContract(payload);
    return;
  }
  output(program, records, formatted);
}

function compactHistoryRecord(value: ClipboardHistoryRecord): string {
  const title = value.title ? ` ${value.title}` : "";
  return `${value.id} ${value.slug} ${value.kind}${title} ${value.createdAt}`;
}

async function outputShareQr(record: ClipRecord): Promise<void> {
  if (!record.shareUrl) throw new Error(`Share URL unavailable for ${record.id}`);
  const qr = await renderShareQrCode(record.shareUrl);
  console.log(qr.terminal);
  console.log(qr.payload);
}

function client(program: Command): ClipClient {
  return createClipClient(globalOptions(program));
}

function collectOption(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function parseNumberList(value: string, expected: number, label: string): number[] {
  const parts = value.split(",").map((part) => part.trim());
  if (parts.length < expected) throw new Error(`${label} expects at least ${expected} comma-separated values.`);
  const values = parts.slice(0, expected).map((part) => Number.parseFloat(part));
  if (values.some((part) => !Number.isFinite(part))) throw new Error(`${label} values must be finite numbers.`);
  return values;
}

function annotationFlagValue(argv: string[], index: number, flag: string): { value: string; nextIndex: number } {
  const arg = argv[index]!;
  if (arg.startsWith(`${flag}=`)) return { value: arg.slice(flag.length + 1), nextIndex: index };
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${flag} expects a value.`);
  return { value, nextIndex: index + 1 };
}

function parseCaptureAnnotationFlags(argv = process.argv): CaptureAnnotation[] | undefined {
  const annotations: CaptureAnnotation[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    const flag = ["--annotation", "--crop", "--box", "--blur", "--arrow"].find((candidate) => arg === candidate || arg.startsWith(`${candidate}=`));
    if (!flag) continue;
    const parsedFlag = annotationFlagValue(argv, index, flag);
    index = parsedFlag.nextIndex;
    if (flag === "--annotation") {
      const parsed = parseCaptureAnnotations(JSON.parse(parsedFlag.value));
      if (parsed) annotations.push(...parsed);
    } else if (flag === "--crop") {
      const [x, y, width, height] = parseNumberList(parsedFlag.value, 4, flag);
      annotations.push({ type: "crop", x: x!, y: y!, width: width!, height: height! });
    } else if (flag === "--box") {
      const [x, y, width, height] = parseNumberList(parsedFlag.value, 4, flag);
      annotations.push({ type: "box", x: x!, y: y!, width: width!, height: height! });
    } else if (flag === "--blur") {
      const [x, y, width, height] = parseNumberList(parsedFlag.value, 4, flag);
      annotations.push({ type: "blur", x: x!, y: y!, width: width!, height: height! });
    } else {
      const [x1, y1, x2, y2] = parseNumberList(parsedFlag.value, 4, flag);
      annotations.push({ type: "arrow", from: { x: x1!, y: y1! }, to: { x: x2!, y: y2! } });
    }
  }
  return annotations.length > 0 ? annotations : undefined;
}

function handleError(program: Command, error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (isJson(program)) {
    console.log(JSON.stringify({ error: message }));
  } else {
    console.error(`Error: ${message}`);
  }
  process.exit(1);
}

const program = new Command();
program
  .name("clip")
  .description("Local and self-hosted screenshot and clipboard sharing")
  .version(getPackageVersion())
  .option("--json", "Output compact JSON")
  .option("--home <path>", "Override local data directory")
  .option("--db <path>", "Override SQLite database path")
  .option("--artifact-dir <path>", "Override artifact directory")
  .option("--base-url <url>", "Override share URL base")
  .option("--host <host>", "Server host/share host")
  .option("--port <port>", "Server/share port");

program
  .command("capture")
  .argument("[mode]", "full, window, or region", "full")
  .option("--title <title>", "Share title")
  .option("--copy-link", "Copy the share URL after capture")
  .option("--annotation <json>", "JSON annotation operation or array", collectOption, [])
  .option("--crop <x,y,width,height>", "Crop the screenshot before sharing", collectOption, [])
  .option("--box <x,y,width,height>", "Draw a box annotation before sharing", collectOption, [])
  .option("--blur <x,y,width,height>", "Blur a region before sharing", collectOption, [])
  .option("--arrow <x1,y1,x2,y2>", "Draw an arrow annotation before sharing", collectOption, [])
  .option("--contract [type]", "Emit contract JSON: evidence (default), resources, or all")
  .description("Capture a screenshot with best-effort OS tools")
  .action(async (
    mode: CaptureMode,
    opts: { title?: string; copyLink?: boolean; annotation?: string[]; crop?: string[]; box?: string[]; blur?: string[]; arrow?: string[]; contract?: boolean | string },
    command: Command,
  ) => {
    try {
      const record = await client(command).captureScreenshot(mode, { title: opts.title, annotations: parseCaptureAnnotationFlags() });
      if (opts.copyLink) await client(command).copyLink(record.id);
      outputRecord(command, record, opts.contract);
    } catch (error) {
      handleError(command, error);
    }
  });

program
  .command("clipboard")
  .option("--kind <kind>", "auto, text, image, or file", "auto")
  .option("--title <title>", "Share title")
  .option("--copy-link", "Copy the share URL after sharing")
  .option("--contract [type]", "Emit contract JSON: evidence (default), resources, or all")
  .description("Share clipboard text, image, or file content")
  .action(async (opts: { kind: ClipboardKind; title?: string; copyLink?: boolean; contract?: boolean | string }, command: Command) => {
    try {
      const record = await client(command).shareClipboard(opts.kind, { title: opts.title });
      if (opts.copyLink) await client(command).copyLink(record.id);
      outputRecord(command, record, opts.contract);
    } catch (error) {
      handleError(command, error);
    }
  });

const history = program
  .command("history")
  .option("--limit <n>", "Maximum rows", "25")
  .description("List and manage opt-in local clipboard history")
  .action((opts: { limit: string }, command: Command) => {
    try {
      const records = client(command).listClipboardHistory({ limit: Number.parseInt(opts.limit, 10) });
      output(command, records, records.map(compactHistoryRecord).join("\n") || "No clipboard history");
    } catch (error) {
      handleError(command, error);
    }
  });

history
  .command("list")
  .option("--limit <n>", "Maximum rows", "25")
  .description("List opt-in local clipboard history")
  .action((opts: { limit: string }, command: Command) => {
    try {
      const records = client(command).listClipboardHistory({ limit: Number.parseInt(opts.limit, 10) });
      output(command, records, records.map(compactHistoryRecord).join("\n") || "No clipboard history");
    } catch (error) {
      handleError(command, error);
    }
  });

history
  .command("capture")
  .option("--kind <kind>", "auto, text, image, or file", "auto")
  .option("--title <title>", "History item title")
  .option("--max-items <n>", "Maximum local history items to retain", "25")
  .description("Capture the current clipboard into local history")
  .action(async (opts: { kind: ClipboardKind; title?: string; maxItems: string }, command: Command) => {
    try {
      const record = await client(command).captureClipboardHistory(opts.kind, {
        title: opts.title,
        maxItems: Number.parseInt(opts.maxItems, 10),
      });
      output(command, record, compactHistoryRecord(record));
    } catch (error) {
      handleError(command, error);
    }
  });

history
  .command("share")
  .alias("reshare")
  .argument("<id-or-slug>")
  .option("--title <title>", "Share title")
  .option("--copy-link", "Copy the share URL after sharing")
  .description("Create a normal share from a clipboard history item")
  .action(async (ref: string, opts: { title?: string; copyLink?: boolean }, command: Command) => {
    try {
      const record = client(command).shareClipboardHistory(ref, { title: opts.title });
      if (opts.copyLink) await client(command).copyLink(record.id);
      outputRecord(command, record);
    } catch (error) {
      handleError(command, error);
    }
  });

const share = program.command("share").description("Create a share from explicit content");

share
  .command("text")
  .argument("<text...>", "Text to share")
  .option("--title <title>", "Share title")
  .option("--contract [type]", "Emit contract JSON: evidence (default), resources, or all")
  .description("Create a text share")
  .action((parts: string[], opts: { title?: string; contract?: boolean | string }, command: Command) => {
    try {
      outputRecord(command, client(command).createTextShare(parts.join(" "), { title: opts.title }), opts.contract);
    } catch (error) {
      handleError(command, error);
    }
  });

share
  .command("file")
  .argument("<path>", "File to import")
  .option("--title <title>", "Share title")
  .option("--contract [type]", "Emit contract JSON: evidence (default), resources, or all")
  .description("Import and share a local file")
  .action((path: string, opts: { title?: string; contract?: boolean | string }, command: Command) => {
    try {
      outputRecord(command, client(command).importFile(path, { title: opts.title }), opts.contract);
    } catch (error) {
      handleError(command, error);
    }
  });

program
  .command("list")
  .option("--limit <n>", "Maximum rows", "25")
  .option("--deleted", "Include deleted rows")
  .option("--contract [type]", "Emit contract JSON: evidence (default), resources, or all")
  .description("List recent shares")
  .action((opts: { limit: string; deleted?: boolean; contract?: boolean | string }, command: Command) => {
    try {
      const records = client(command).listShares({ limit: Number.parseInt(opts.limit, 10), includeDeleted: opts.deleted });
      outputRecords(command, records, records.map(compactRecord).join("\n") || "No shares", opts.contract);
    } catch (error) {
      handleError(command, error);
    }
  });

program
  .command("show")
  .argument("<id-or-slug>")
  .option("--qr", "Render the share URL as a terminal QR code")
  .option("--contract [type]", "Emit contract JSON: evidence (default), resources, or all")
  .description("Show one share")
  .action(async (ref: string, opts: { qr?: boolean; contract?: boolean | string }, command: Command) => {
    try {
      const record = client(command).getShare(ref);
      if (!record) throw new Error(`Share not found: ${ref}`);
      const format = normalizeContractFormat(opts.contract);
      if (format) {
        outputContract(contractForRecord(record, format));
        return;
      }
      if (opts.qr && !isJson(command)) {
        await outputShareQr(record);
        return;
      }
      output(command, record, JSON.stringify(record, null, 2));
    } catch (error) {
      handleError(command, error);
    }
  });

program
  .command("delete")
  .argument("<id-or-slug>")
  .description("Soft-delete one share")
  .action((ref: string, command: Command) => {
    try {
      const deleted = client(command).deleteShare(ref);
      output(command, { deleted, ref }, deleted ? `Deleted ${ref}` : `Not found ${ref}`);
    } catch (error) {
      handleError(command, error);
    }
  });

program
  .command("uninstall")
  .option("--yes", "Confirm removal of the local clip store and config")
  .description("Remove the local clip store and config")
  .action((opts: { yes?: boolean }, command: Command) => {
    try {
      if (!opts.yes) throw new Error("Refusing to uninstall clip data without --yes. This removes the local clip store and config.");
      const result = purgeClipStore({ ...globalOptions(command), confirm: true });
      output(command, result, result.removed ? `Removed clip data at ${result.homeDir}` : `No clip data found at ${result.homeDir}`);
    } catch (error) {
      handleError(command, error);
    }
  });

program
  .command("open")
  .argument("<id-or-slug>")
  .description("Open the artifact or share URL locally")
  .action(async (ref: string, command: Command) => {
    try {
      const result = await client(command).openShare(ref);
      output(command, result, result.opened ? `Opened ${result.target}` : `Open failed: ${result.error}`);
    } catch (error) {
      handleError(command, error);
    }
  });

program
  .command("open-recent")
  .description("Open the most recent non-deleted share")
  .action(async (command: Command) => {
    try {
      const recent = client(command).listShares({ limit: 1 })[0];
      if (!recent) throw new Error("No shares found");
      const result = await client(command).openShare(recent.id);
      output(command, result, result.opened ? `Opened ${result.target}` : `Open failed: ${result.error}`);
    } catch (error) {
      handleError(command, error);
    }
  });

program
  .command("copy-link")
  .argument("<id-or-slug>")
  .option("--qr", "Render the share URL as a terminal QR code")
  .description("Copy a share URL to the system clipboard")
  .action(async (ref: string, opts: { qr?: boolean }, command: Command) => {
    try {
      const result = await client(command).copyLink(ref);
      if (opts.qr && !isJson(command)) {
        await outputShareQr(result.record);
        return;
      }
      output(command, result, result.copied ? result.record.shareUrl ?? "" : `Copy failed: ${result.error}`);
    } catch (error) {
      handleError(command, error);
    }
  });

program
  .command("serve")
  .option("--host <host>", "Bind host", process.env["HOST"] ?? "127.0.0.1")
  .option("--port <port>", "Bind port", process.env["PORT"] ?? String(DEFAULT_PORT))
  .option("--base-url <url>", "Public/self-hosted share URL base")
  .option("--auth-token <token>", "Require Bearer token for mutating API routes (default CLIP_AUTH_TOKEN)")
  .description("Start the self-hosted HTTP API and share server")
  .action(async (opts: { host: string; port: string; baseUrl?: string; authToken?: string }, command: Command) => {
    try {
      const serveOptions = commandOptions(command) as { host?: string; port?: string; baseUrl?: string; authToken?: string };
      const resolvedHost = argvValue("--host") ?? serveOptions.host ?? opts.host ?? "127.0.0.1";
      const rawPort = argvValue("--port") ?? serveOptions.port ?? opts.port ?? String(DEFAULT_PORT);
      const port = Number.parseInt(rawPort, 10);
      const resolvedBaseUrl = argvValue("--base-url") ?? serveOptions.baseUrl ?? opts.baseUrl ?? globalOptions(command).baseUrl;
      const authToken = argvValue("--auth-token") ?? serveOptions.authToken ?? opts.authToken;
      const clientOptions = rootAndCommandOptions(command);
      const server = startClipServer({
        host: resolvedHost,
        port,
        baseUrl: resolvedBaseUrl,
        authToken,
        clientOptions,
      });
      const url = `http://${resolvedHost}:${server.port}`;
      output(command, { status: "listening", url, api: `${url}/api`, shares: `${url}/s/:slug` }, `clip serve listening on ${url}`);
      await new Promise<never>(() => {});
    } catch (error) {
      handleError(command, error);
    }
  });

const config = program.command("config").description("Read or update local config");

config
  .command("list")
  .description("List config")
  .action((_opts: unknown, command: Command) => {
    try {
      const opts = globalOptions(command);
      output(command, { path: resolveConfigPath(opts), config: readConfig(opts) }, JSON.stringify(readConfig(opts), null, 2));
    } catch (error) {
      handleError(command, error);
    }
  });

config
  .command("get")
  .argument("[key]")
  .description("Get a config key or all config")
  .action((key: string | undefined, command: Command) => {
    try {
      const configValue = readConfig(globalOptions(command));
      const value = key ? configValue[key] : configValue;
      output(command, { key, value }, typeof value === "string" || typeof value === "number" ? String(value) : JSON.stringify(value, null, 2));
    } catch (error) {
      handleError(command, error);
    }
  });

config
  .command("set")
  .argument("<key>")
  .argument("<value>")
  .description("Set a config key")
  .action((key: string, value: string, command: Command) => {
    try {
      const next = updateConfig(key, value, globalOptions(command));
      output(command, next, JSON.stringify(next, null, 2));
    } catch (error) {
      handleError(command, error);
    }
  });

program
  .command("status")
  .description("Show storage and platform status")
  .action(async (_opts: unknown, command: Command) => {
    try {
      const status = await client(command).status();
      output(command, status, JSON.stringify(status, null, 2));
    } catch (error) {
      handleError(command, error);
    }
  });

program
  .command("doctor")
  .description("Diagnose storage, capture, and clipboard capability")
  .action(async (_opts: unknown, command: Command) => {
    try {
      const status = await client(command).status();
      const ok = status.capture.modes.full || status.clipboard.supports.text || status.clipboard.supports.image;
      output(command, { ok, ...status }, JSON.stringify({ ok, ...status }, null, 2));
    } catch (error) {
      handleError(command, error);
    }
  });

await program.parseAsync();
