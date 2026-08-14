import { spawn, spawnSync, execFileSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { MCPS_DIR } from "./config.js";
import { getMachine, listMachines, updateMachine } from "./machines.js";
import type {
  FleetHealthReport,
  FleetInstallPackageResult,
  FleetInstallReport,
  HasnaMcpCatalogEntry,
  MachineEntry,
  MachinePackageHealth,
  MachineInstaller,
  MachinePlatform,
  MachineArch,
} from "../types.js";

const NPM_SEARCH_URL = "https://registry.npmjs.org/-/v1/search";
const NPM_REGISTRY_URL = "https://registry.npmjs.org";
const CATALOG_CACHE_PATH = join(MCPS_DIR, "cache", "hasna-catalog.json");
const DEFAULT_CATALOG_CACHE_TTL_MS = 60 * 60 * 1000;
const DEFAULT_REMOTE_TIMEOUT_MS = 180_000;
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 2_500;

interface NpmSearchResponse {
  objects?: Array<{
    package: {
      name: string;
      version?: string;
      description?: string;
      keywords?: string[];
      links?: {
        repository?: string;
      };
    };
  }>;
}

interface NpmPackageMetadata {
  "dist-tags"?: {
    latest?: string;
  };
  versions?: Record<
    string,
    {
      bin?: string | Record<string, string>;
      description?: string;
      keywords?: string[];
      repository?: {
        url?: string;
      };
    }
  >;
}

interface RemoteRunnerResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface RemoteSnapshot {
  hostname: string | null;
  platform: MachinePlatform;
  arch: MachineArch;
  nodePath: string | null;
  npmPath: string | null;
  bunPath: string | null;
  installedPackages: Record<string, string>;
  handshakes: Record<
    string,
    {
      binaryName: string | null;
      binaryPath: string | null;
      ok: boolean;
      error: string | null;
    }
  >;
}

interface RemoteInstallPayload {
  installer: Exclude<MachineInstaller, "auto"> | null;
  bunPath: string | null;
  npmPath: string | null;
  results: FleetInstallPackageResult[];
}

export interface FleetDependencies {
  fetchImpl?: typeof fetch;
  runRemoteScript?: (machine: MachineEntry, script: string, timeoutMs: number) => Promise<RemoteRunnerResult>;
  now?: () => Date;
}

export interface FleetHealthOptions {
  machineIds?: string[];
  packages?: string[];
  refreshCatalog?: boolean;
  timeoutMs?: number;
}

export interface FleetInstallOptions extends FleetHealthOptions {
  mode?: "missing" | "missing-or-outdated" | "all";
  installer?: MachineInstaller;
}

function normalizeQueryList(values?: string[]): string[] | undefined {
  const trimmed = values?.map((value) => value.trim()).filter(Boolean);
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function readCatalogCache(maxAgeMs: number): HasnaMcpCatalogEntry[] | null {
  try {
    if (!existsSync(CATALOG_CACHE_PATH)) return null;
    const parsed = JSON.parse(readFileSync(CATALOG_CACHE_PATH, "utf-8")) as {
      cachedAt?: number;
      entries?: HasnaMcpCatalogEntry[];
    };
    if (!parsed.cachedAt || !Array.isArray(parsed.entries)) return null;
    if (Date.now() - parsed.cachedAt > maxAgeMs) return null;
    return parsed.entries;
  } catch {
    return null;
  }
}

function writeCatalogCache(entries: HasnaMcpCatalogEntry[]): void {
  try {
    mkdirSync(join(MCPS_DIR, "cache"), { recursive: true });
    writeFileSync(
      CATALOG_CACHE_PATH,
      JSON.stringify({ cachedAt: Date.now(), entries }, null, 2),
      "utf-8",
    );
  } catch {
    // best-effort cache only
  }
}

function isLikelyHasnaMcpPackage(candidate: {
  name: string;
  description?: string;
  keywords?: string[];
}): boolean {
  if (!candidate.name.startsWith("@hasna/")) return false;
  const haystack = `${candidate.name} ${candidate.description ?? ""} ${(candidate.keywords ?? []).join(" ")}`.toLowerCase();
  return haystack.includes("mcp") || haystack.includes("model context protocol");
}

function normalizeBins(
  packageName: string,
  binField: string | Record<string, string> | undefined,
): Record<string, string> {
  if (!binField) return {};
  if (typeof binField === "string") {
    return { [packageName.split("/").pop() ?? packageName]: binField };
  }
  return binField;
}

function pickMcpBinary(packageName: string, bins: Record<string, string>): string | null {
  const names = Object.keys(bins);
  if (names.length === 0) return null;
  const exact = names.find((name) => name.endsWith("-mcp"));
  if (exact) return exact;
  const loose = names.find((name) => name.includes("mcp"));
  if (loose) return loose;
  if (names.length === 1) return names[0] ?? null;
  const fallback = packageName.split("/").pop();
  return fallback && names.includes(fallback) ? fallback : names[0] ?? null;
}

async function fetchJson<T>(url: string, fetchImpl: typeof fetch): Promise<T> {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText} (${url})`);
  }
  return (await response.json()) as T;
}

async function mapLimit<T, R>(
  values: T[],
  limit: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= values.length) return;
      results[current] = await mapper(values[current]!, current);
    }
  }

  const workers = Array.from({ length: Math.max(1, Math.min(limit, values.length)) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function listHasnaMcpCatalog(
  options: { fetchImpl?: typeof fetch; refresh?: boolean; cacheTtlMs?: number } = {},
): Promise<HasnaMcpCatalogEntry[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const refresh = options.refresh ?? false;
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CATALOG_CACHE_TTL_MS;

  if (!refresh) {
    const cached = readCatalogCache(cacheTtlMs);
    if (cached) return cached;
  }

  const searchUrl = new URL(NPM_SEARCH_URL);
  searchUrl.searchParams.set("text", "@hasna");
  searchUrl.searchParams.set("size", "250");

  const searchResults = await fetchJson<NpmSearchResponse>(searchUrl.toString(), fetchImpl);
  const packages = (searchResults.objects ?? [])
    .map((item) => item.package)
    .filter(isLikelyHasnaMcpPackage)
    .sort((left, right) => left.name.localeCompare(right.name));

  const catalog = await mapLimit(packages, 8, async (pkg) => {
    const metaUrl = `${NPM_REGISTRY_URL}/${encodeURIComponent(pkg.name)}`;
    const metadata = await fetchJson<NpmPackageMetadata>(metaUrl, fetchImpl).catch(() => null);
    const latestVersion = metadata?.["dist-tags"]?.latest ?? pkg.version ?? "latest";
    const latestManifest = metadata?.versions?.[latestVersion];
    const bins = normalizeBins(pkg.name, latestManifest?.bin);
    return {
      name: pkg.name,
      version: latestVersion,
      description: latestManifest?.description ?? pkg.description ?? "",
      keywords: latestManifest?.keywords ?? pkg.keywords ?? [],
      repository: latestManifest?.repository?.url ?? pkg.links?.repository ?? null,
      bins,
      mcpBin: pickMcpBinary(pkg.name, bins),
    } satisfies HasnaMcpCatalogEntry;
  });

  writeCatalogCache(catalog);
  return catalog;
}

function filterCatalog(catalog: HasnaMcpCatalogEntry[], packages?: string[]): HasnaMcpCatalogEntry[] {
  const selected = normalizeQueryList(packages);
  if (!selected) return catalog;
  const set = new Set(selected);
  return catalog.filter((entry) => set.has(entry.name));
}

function assertCatalogEntries(entries: HasnaMcpCatalogEntry[], packages?: string[]): void {
  if (entries.length > 0) return;
  const requested = normalizeQueryList(packages);
  if (requested) {
    throw new Error(`No matching @hasna MCP packages found for: ${requested.join(", ")}`);
  }
  throw new Error("No @hasna MCP packages were discovered from npm.");
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.replace(/^v/i, "").split(/[-+]/)[0]!.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = right.replace(/^v/i, "").split(/[-+]/)[0]!.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

function resolveMachines(machineIds?: string[]): MachineEntry[] {
  const selected = normalizeQueryList(machineIds);
  const allMachines = listMachines().filter((machine) => machine.enabled);
  if (!selected) return allMachines;
  return selected
    .map((machineId) => getMachine(machineId))
    .filter((machine): machine is MachineEntry => machine !== null && machine.enabled);
}

function buildRemoteRunnerTarget(machine: MachineEntry): string {
  return machine.username ? `${machine.username}@${machine.host}` : machine.host;
}

async function runRemoteNodeScript(machine: MachineEntry, script: string, timeoutMs: number): Promise<RemoteRunnerResult> {
  const sshArgs = [
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "ConnectTimeout=10",
  ];
  if (machine.port) sshArgs.push("-p", String(machine.port));
  if (machine.ssh_key_path) sshArgs.push("-i", machine.ssh_key_path);
  sshArgs.push(buildRemoteRunnerTarget(machine), "node", "-");

  return await new Promise<RemoteRunnerResult>((resolve, reject) => {
    const child = spawn("ssh", sshArgs, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`Timed out after ${timeoutMs}ms while contacting ${machine.id}`));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? -1 });
    });
    child.stdin.end(script);
  });
}

function buildRemoteSnapshotScript(
  machine: MachineEntry,
  catalog: HasnaMcpCatalogEntry[],
  handshakeTimeoutMs: number,
): string {
  const minimizedCatalog = catalog.map((entry) => ({
    name: entry.name,
    mcpBin: entry.mcpBin,
  }));

  return `
const { execFileSync, spawnSync, spawn } = require("child_process");
const { existsSync } = require("fs");
const { dirname, join } = require("path");

const machine = ${JSON.stringify({
    bun_path: machine.bun_path,
    npm_path: machine.npm_path,
  })};
const catalog = ${JSON.stringify(minimizedCatalog)};
const handshakeTimeoutMs = ${handshakeTimeoutMs};
const protocolVersion = "2025-03-26";

function execMaybe(file, args) {
  try {
    return execFileSync(file, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    if (error && typeof error === "object" && "stdout" in error && typeof error.stdout === "string") {
      return error.stdout.trim();
    }
    return null;
  }
}

function resolveCommand(name, extraDirs) {
  const env = { ...process.env };
  env.PATH = [...extraDirs.filter(Boolean), env.PATH || ""].filter(Boolean).join(":");
  const out = spawnSync("which", [name], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env });
  if (out.status === 0 && out.stdout.trim()) return out.stdout.trim();
  for (const dir of extraDirs) {
    if (!dir) continue;
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function parseInstalledPackages() {
  const raw = execMaybe(machine.npm_path || "npm", ["ls", "-g", "--depth=0", "--json"]);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    const dependencies = parsed.dependencies || {};
    const result = {};
    for (const [name, info] of Object.entries(dependencies)) {
      if (!name.startsWith("@hasna/")) continue;
      result[name] = info && typeof info === "object" && typeof info.version === "string" ? info.version : "unknown";
    }
    return result;
  } catch {
    return {};
  }
}

function extractMessages(buffer) {
  const messages = [];
  let rest = buffer;
  while (true) {
    const start = rest.indexOf("Content-Length:");
    if (start === -1) return { messages, rest: "" };
    if (start > 0) rest = rest.slice(start);
    const headerEnd = rest.indexOf("\\r\\n\\r\\n");
    if (headerEnd === -1) return { messages, rest };
    const header = rest.slice(0, headerEnd);
    const match = /Content-Length:\\s*(\\d+)/i.exec(header);
    if (!match) {
      rest = rest.slice(headerEnd + 4);
      continue;
    }
    const bodyStart = headerEnd + 4;
    const bodyLength = Number(match[1]);
    if (rest.length < bodyStart + bodyLength) return { messages, rest };
    const body = rest.slice(bodyStart, bodyStart + bodyLength);
    try {
      messages.push(JSON.parse(body));
    } catch {}
    rest = rest.slice(bodyStart + bodyLength);
  }
}

function encodeFrame(message) {
  const json = JSON.stringify(message);
  return \`Content-Length: \${Buffer.byteLength(json, "utf8")}\\r\\n\\r\\n\${json}\`;
}

async function handshake(binaryPath, extraDirs) {
  return await new Promise((resolve) => {
    const env = { ...process.env, PATH: [...extraDirs.filter(Boolean), process.env.PATH || ""].filter(Boolean).join(":") };
    const child = spawn(binaryPath, [], { stdio: ["pipe", "pipe", "pipe"], env });
    let stdout = "";
    let stderr = "";
    let done = false;

    const finish = (payload) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill("SIGTERM");
      resolve(payload);
    };

    const timer = setTimeout(() => {
      finish({ ok: false, error: \`initialize timeout after \${handshakeTimeoutMs}ms\` });
    }, handshakeTimeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const parsed = extractMessages(stdout);
      stdout = parsed.rest;
      for (const message of parsed.messages) {
        if (message && message.id === 1 && message.result) {
          child.stdin.write(encodeFrame({
            jsonrpc: "2.0",
            method: "notifications/initialized",
            params: {},
          }));
          finish({ ok: true, error: null });
          return;
        }
        if (message && message.id === 1 && message.error) {
          finish({ ok: false, error: message.error.message || "initialize failed" });
          return;
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      finish({ ok: false, error: error.message });
    });
    child.on("close", (code) => {
      if (done) return;
      finish({ ok: false, error: stderr.trim() || \`process exited with code \${code ?? -1}\` });
    });

    child.stdin.write(encodeFrame({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion,
        capabilities: {},
        clientInfo: { name: "mcps-fleet", version: "0.0.1" },
      },
    }));
  });
}

async function mapLimit(values, limit, mapper) {
  const results = new Array(values.length);
  let nextIndex = 0;
  async function worker() {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= values.length) return;
      results[current] = await mapper(values[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, values.length)) }, () => worker()));
  return results;
}

(async () => {
  const npmPath = resolveCommand("npm", machine.npm_path ? [dirname(machine.npm_path)] : []);
  const npmPrefix = npmPath ? execMaybe(npmPath, ["prefix", "-g"]) : null;
  const npmBin = npmPath ? (execMaybe(npmPath, ["bin", "-g"]) || (npmPrefix ? join(npmPrefix, "bin") : null)) : null;
  const bunPath = resolveCommand("bun", machine.bun_path ? [dirname(machine.bun_path)] : []);
  const bunBin = bunPath ? execMaybe(bunPath, ["pm", "bin", "-g"]) : null;
  const extraDirs = [npmBin, bunBin, machine.bun_path ? dirname(machine.bun_path) : null].filter(Boolean);
  const installedPackages = parseInstalledPackages();
  const handshakes = {};

  const checks = catalog.filter((entry) => installedPackages[entry.name] && entry.mcpBin);
  await mapLimit(checks, 4, async (entry) => {
    const binaryPath = entry.mcpBin ? resolveCommand(entry.mcpBin, extraDirs) : null;
    if (!binaryPath) {
      handshakes[entry.name] = {
        binaryName: entry.mcpBin || null,
        binaryPath: null,
        ok: false,
        error: entry.mcpBin ? \`\${entry.mcpBin} not found on PATH\` : "No MCP binary declared",
      };
      return;
    }
    const result = await handshake(binaryPath, extraDirs);
    handshakes[entry.name] = {
      binaryName: entry.mcpBin || null,
      binaryPath,
      ok: !!result.ok,
      error: result.error || null,
    };
  });

  process.stdout.write(JSON.stringify({
    hostname: execMaybe("hostname", []) || null,
    platform: process.platform === "darwin" ? "darwin" : process.platform === "linux" ? "linux" : "unknown",
    arch: process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x64" : "unknown",
    nodePath: process.execPath || null,
    npmPath,
    bunPath,
    installedPackages,
    handshakes,
  }));
})().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
`;
}

function buildRemoteInstallScript(
  machine: MachineEntry,
  specs: Array<{ packageName: string; requestedVersion: string }>,
  installer: Exclude<MachineInstaller, "auto">,
): string {
  return `
const { execFileSync, spawnSync } = require("child_process");
const { dirname } = require("path");

const machine = ${JSON.stringify({
    bun_path: machine.bun_path,
    npm_path: machine.npm_path,
  })};
const installer = ${JSON.stringify(installer)};
const specs = ${JSON.stringify(specs)};

function execMaybe(file, args) {
  try {
    return execFileSync(file, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    if (error && typeof error === "object" && "stdout" in error && typeof error.stdout === "string") {
      return error.stdout.trim();
    }
    return null;
  }
}

function resolveCommand(name, extraDirs) {
  const env = { ...process.env };
  env.PATH = [...extraDirs.filter(Boolean), env.PATH || ""].filter(Boolean).join(":");
  const out = spawnSync("which", [name], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env });
  if (out.status === 0 && out.stdout.trim()) return out.stdout.trim();
  return null;
}

function installPackage(binaryPath, args) {
  try {
    const stdout = execFileSync(binaryPath, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 20 * 1024 * 1024,
    });
    return { success: true, stdout, stderr: "" };
  } catch (error) {
    return {
      success: false,
      stdout: error && typeof error.stdout === "string" ? error.stdout : "",
      stderr: error && typeof error.stderr === "string" ? error.stderr : (error instanceof Error ? error.message : String(error)),
    };
  }
}

(async () => {
  const npmPath = resolveCommand("npm", machine.npm_path ? [dirname(machine.npm_path)] : []);
  const bunPath = resolveCommand("bun", machine.bun_path ? [dirname(machine.bun_path)] : []);
  const binaryPath = installer === "bun" ? bunPath : npmPath;
  if (!binaryPath) {
    throw new Error(\`\${installer} is not available on the remote machine\`);
  }

  const results = [];
  for (const spec of specs) {
    const packageSpec = \`\${spec.packageName}@\${spec.requestedVersion}\`;
    const args = installer === "bun" ? ["install", "-g", packageSpec] : ["install", "-g", packageSpec];
    const command = [binaryPath, ...args].join(" ");
    const outcome = installPackage(binaryPath, args);
    results.push({
      packageName: spec.packageName,
      requestedVersion: spec.requestedVersion,
      installer,
      command,
      success: outcome.success,
      stdout: outcome.stdout,
      stderr: outcome.stderr,
    });
  }

  process.stdout.write(JSON.stringify({
    installer,
    bunPath,
    npmPath,
    results,
  }));
})().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
`;
}

function summarizePackages(packages: MachinePackageHealth[]): FleetHealthReport["summary"] {
  let current = 0;
  let missing = 0;
  let outdated = 0;
  let unresponsive = 0;

  for (const pkg of packages) {
    if (pkg.drift === "missing") missing += 1;
    else if (pkg.drift === "outdated") outdated += 1;
    else current += 1;

    if (pkg.handshakeOk === false) unresponsive += 1;
  }

  return {
    total: packages.length,
    current,
    missing,
    outdated,
    unresponsive,
  };
}

function toPackageHealth(catalog: HasnaMcpCatalogEntry[], snapshot: RemoteSnapshot): MachinePackageHealth[] {
  return catalog.map((entry) => {
    const installedVersion = snapshot.installedPackages[entry.name] ?? null;
    const handshake = snapshot.handshakes[entry.name];
    const drift =
      installedVersion === null
        ? "missing"
        : compareVersions(installedVersion, entry.version) < 0
        ? "outdated"
        : "current";

    return {
      packageName: entry.name,
      latestVersion: entry.version,
      installedVersion,
      drift,
      binaryName: handshake?.binaryName ?? entry.mcpBin,
      binaryPath: handshake?.binaryPath ?? null,
      handshakeOk: entry.mcpBin && installedVersion ? handshake?.ok ?? false : null,
      handshakeError: handshake?.error ?? null,
    } satisfies MachinePackageHealth;
  });
}

function chooseInstaller(
  machine: MachineEntry,
  runtime: FleetHealthReport["runtime"],
  requestedInstaller?: MachineInstaller,
): Exclude<MachineInstaller, "auto"> | null {
  if (requestedInstaller && requestedInstaller !== "auto") return requestedInstaller;
  if (machine.installer !== "auto") return machine.installer;
  return runtime.bunPath ? "bun" : runtime.npmPath ? "npm" : null;
}

export async function runFleetHealthCheck(
  options: FleetHealthOptions = {},
  dependencies: FleetDependencies = {},
): Promise<FleetHealthReport[]> {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const runRemoteScript = dependencies.runRemoteScript ?? runRemoteNodeScript;
  const now = dependencies.now ?? (() => new Date());

  const machines = resolveMachines(options.machineIds);
  if (machines.length === 0) {
    throw new Error("No enabled machines registered. Use `mcps machines add` or `mcps machines seed-defaults` first.");
  }

  const catalog = filterCatalog(
    await listHasnaMcpCatalog({ fetchImpl, refresh: options.refreshCatalog }),
    options.packages,
  );
  assertCatalogEntries(catalog, options.packages);

  const timeoutMs = options.timeoutMs ?? DEFAULT_REMOTE_TIMEOUT_MS;
  const handshakeTimeoutMs = Math.min(DEFAULT_HANDSHAKE_TIMEOUT_MS, Math.max(1_000, Math.floor(timeoutMs / 20)));

  return await Promise.all(
    machines.map(async (machine) => {
      const checkedAt = now().toISOString();
      try {
        const remote = await runRemoteScript(
          machine,
          buildRemoteSnapshotScript(machine, catalog, handshakeTimeoutMs),
          timeoutMs,
        );
        if (remote.exitCode !== 0) {
          throw new Error(remote.stderr.trim() || `remote process exited with code ${remote.exitCode}`);
        }

        const snapshot = JSON.parse(remote.stdout) as RemoteSnapshot;
        const packages = toPackageHealth(catalog, snapshot);
        const report: FleetHealthReport = {
          machine,
          checkedAt,
          runtime: {
            hostname: snapshot.hostname,
            platform: snapshot.platform,
            arch: snapshot.arch,
            nodePath: snapshot.nodePath,
            npmPath: snapshot.npmPath,
            bunPath: snapshot.bunPath,
          },
          packages,
          summary: summarizePackages(packages),
          error: null,
        };

        updateMachine(machine.id, {
          last_seen_at: checkedAt,
          last_error: null,
          npm_path: machine.npm_path ?? snapshot.npmPath,
          bun_path: machine.bun_path ?? snapshot.bunPath,
          platform: machine.platform === "unknown" ? snapshot.platform : machine.platform,
          arch: machine.arch === "unknown" ? snapshot.arch : machine.arch,
        });

        return report;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateMachine(machine.id, { last_error: message });
        return {
          machine,
          checkedAt,
          runtime: {
            hostname: null,
            platform: machine.platform,
            arch: machine.arch,
            nodePath: null,
            npmPath: machine.npm_path,
            bunPath: machine.bun_path,
          },
          packages: [],
          summary: { total: 0, current: 0, missing: 0, outdated: 0, unresponsive: 0 },
          error: message,
        } satisfies FleetHealthReport;
      }
    }),
  );
}

export async function runFleetInstall(
  options: FleetInstallOptions = {},
  dependencies: FleetDependencies = {},
): Promise<FleetInstallReport[]> {
  const runRemoteScript = dependencies.runRemoteScript ?? runRemoteNodeScript;
  const now = dependencies.now ?? (() => new Date());
  const healthReports = await runFleetHealthCheck(options, dependencies);
  const mode = options.mode ?? "missing-or-outdated";
  const timeoutMs = options.timeoutMs ?? DEFAULT_REMOTE_TIMEOUT_MS;

  return await Promise.all(
    healthReports.map(async (report) => {
      if (report.error) {
        return {
          machine: report.machine,
          installer: null,
          attempted: 0,
          results: [],
          error: report.error,
        } satisfies FleetInstallReport;
      }

      const candidates = report.packages.filter((pkg) => {
        if (mode === "all") return true;
        if (mode === "missing") return pkg.drift === "missing";
        return pkg.drift !== "current" || pkg.handshakeOk === false;
      });

      if (candidates.length === 0) {
        return {
          machine: report.machine,
          installer: chooseInstaller(report.machine, report.runtime, options.installer),
          attempted: 0,
          results: [],
          error: null,
        } satisfies FleetInstallReport;
      }

      const installer = chooseInstaller(report.machine, report.runtime, options.installer);
      if (!installer) {
        return {
          machine: report.machine,
          installer: null,
          attempted: candidates.length,
          results: [],
          error: "No supported installer found on the remote machine",
        } satisfies FleetInstallReport;
      }

      try {
        const remote = await runRemoteScript(
          report.machine,
          buildRemoteInstallScript(
            report.machine,
            candidates.map((pkg) => ({
              packageName: pkg.packageName,
              requestedVersion: pkg.latestVersion,
            })),
            installer,
          ),
          timeoutMs,
        );
        if (remote.exitCode !== 0) {
          throw new Error(remote.stderr.trim() || `remote process exited with code ${remote.exitCode}`);
        }

        const payload = JSON.parse(remote.stdout) as RemoteInstallPayload;
        updateMachine(report.machine.id, {
          last_seen_at: now().toISOString(),
          last_error: null,
          npm_path: report.machine.npm_path ?? payload.npmPath,
          bun_path: report.machine.bun_path ?? payload.bunPath,
        });

        return {
          machine: report.machine,
          installer: payload.installer,
          attempted: payload.results.length,
          results: payload.results,
          error: null,
        } satisfies FleetInstallReport;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateMachine(report.machine.id, { last_error: message });
        return {
          machine: report.machine,
          installer,
          attempted: candidates.length,
          results: [],
          error: message,
        } satisfies FleetInstallReport;
      }
    }),
  );
}
