import { createHash, createVerify } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  loadConfig,
  saveConfig,
  type LocalExtensionManifest,
  type LocalExtensionRecord,
} from "./config.js";
import { getPackageVersion } from "./package-version.js";
import { redactValue } from "./redaction.js";

export interface ExtensionSourceInspection {
  source: string;
  source_type: "manifest" | "directory" | "bundle";
  manifest_path: string;
  manifest: LocalExtensionManifest;
  checksum: string;
  validation: ExtensionValidationResult;
  bundle: boolean;
}

export interface ExtensionValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  compatible: boolean;
  todos_version: string;
  compatibility_range: string | null;
}

export interface InstallLocalExtensionInput {
  source: string;
  trust?: boolean;
  checksum?: string;
  signature?: string;
  public_key?: string;
}

export interface VerifyExtensionSignatureInput {
  checksum: string;
  signature?: string;
  public_key?: string;
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeName(name: string): string {
  const normalized = name.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_.-]{0,63}$/.test(normalized)) {
    throw new Error("extension name must use lowercase letters, numbers, dots, dashes, or underscores");
  }
  return normalized;
}

function unique(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean))).sort();
}

function normalizeManifest(input: unknown): LocalExtensionManifest {
  if (!isObject(input)) throw new Error("extension manifest must be a JSON object");
  const name = normalizeName(String(input["name"] || ""));
  const version = String(input["version"] || "").trim();
  if (!version) throw new Error("extension manifest requires version");
  const compatibility = isObject(input["compatibility"]) ? {
    todos: typeof input["compatibility"]["todos"] === "string" ? input["compatibility"]["todos"] : undefined,
  } : undefined;
  const commands = Array.isArray(input["commands"]) ? input["commands"].filter(isObject).map((command) => ({
    name: normalizeName(String(command["name"] || "")),
    command: typeof command["command"] === "string" ? command["command"] : undefined,
    description: typeof command["description"] === "string" ? command["description"] : undefined,
  })) : [];
  const mcpTools = Array.isArray(input["mcp_tools"]) ? input["mcp_tools"].filter(isObject).map((tool) => ({
    name: normalizeName(String(tool["name"] || "")),
    description: typeof tool["description"] === "string" ? tool["description"] : undefined,
  })) : [];
  return {
    schema_version: typeof input["schema_version"] === "number" ? input["schema_version"] : 1,
    name,
    version,
    description: typeof input["description"] === "string" ? input["description"] : undefined,
    compatibility,
    permissions: unique(input["permissions"]),
    commands,
    mcp_tools: mcpTools,
    hooks: unique(input["hooks"]),
    checksum: typeof input["checksum"] === "string" ? input["checksum"] : undefined,
    signature: typeof input["signature"] === "string" ? input["signature"] : undefined,
    public_key: typeof input["public_key"] === "string" ? input["public_key"] : undefined,
  };
}

function parseJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function sha256(bytes: Buffer | string): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function compareVersions(a: string, b: string): number {
  const left = a.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const right = b.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function versionSatisfies(version: string, range: string | undefined): boolean {
  const value = (range || "*").trim();
  if (!value || value === "*") return true;
  if (value.startsWith(">=")) return compareVersions(version, value.slice(2).trim()) >= 0;
  if (value.startsWith(">")) return compareVersions(version, value.slice(1).trim()) > 0;
  if (value.startsWith("<=")) return compareVersions(version, value.slice(2).trim()) <= 0;
  if (value.startsWith("<")) return compareVersions(version, value.slice(1).trim()) < 0;
  if (value.startsWith("^")) {
    const base = value.slice(1).trim();
    const major = (Number.parseInt(base.split(".")[0] || "0", 10) || 0) + 1;
    return compareVersions(version, base) >= 0 && compareVersions(version, `${major}.0.0`) < 0;
  }
  return compareVersions(version, value) === 0;
}

function decodeSignature(signature: string): Buffer {
  const trimmed = signature.trim();
  const value = trimmed.startsWith("sha256:") ? trimmed.slice("sha256:".length) : trimmed;
  if (/^[a-f0-9]+$/i.test(value) && value.length % 2 === 0) return Buffer.from(value, "hex");
  return Buffer.from(value, "base64");
}

export function verifyExtensionSignature(input: VerifyExtensionSignatureInput): boolean {
  if (!input.signature || !input.public_key) return false;
  const verifier = createVerify("sha256");
  verifier.update(input.checksum);
  verifier.end();
  return verifier.verify(input.public_key, decodeSignature(input.signature));
}

export function inspectExtensionSource(source: string): ExtensionSourceInspection {
  const resolved = resolve(source);
  if (!existsSync(resolved)) throw new Error(`extension source not found: ${source}`);
  const stat = statSync(resolved);
  const manifestPath = stat.isDirectory()
    ? [join(resolved, "todos.extension.json"), join(resolved, "extension.json")].find(existsSync)
    : resolved;
  if (!manifestPath) throw new Error(`extension directory ${source} is missing todos.extension.json`);
  const raw = readFileSync(manifestPath);
  const parsed = parseJson(manifestPath);
  const bundle = isObject(parsed) && isObject(parsed["manifest"]);
  const manifest = normalizeManifest(bundle ? parsed["manifest"] : parsed);
  const sourceType = stat.isDirectory() ? "directory" : bundle ? "bundle" : "manifest";
  const checksum = sha256(raw);
  return {
    source: resolved,
    source_type: sourceType,
    manifest_path: manifestPath,
    manifest,
    checksum,
    validation: validateExtensionManifest(manifest),
    bundle,
  };
}

export function validateExtensionManifest(manifest: LocalExtensionManifest): ExtensionValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let normalized: LocalExtensionManifest | null = null;
  try {
    normalized = normalizeManifest(manifest);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  const candidate = normalized || manifest;
  const todosVersion = getPackageVersion();
  const compatibilityRange = candidate.compatibility?.todos || null;
  const compatible = versionSatisfies(todosVersion, compatibilityRange || "*");
  if (!compatible) errors.push(`extension requires @hasna/todos ${compatibilityRange}, current version is ${todosVersion}`);
  if ((candidate.permissions || []).length === 0) warnings.push("extension declares no permissions");
  if ((candidate.commands || []).length === 0 && (candidate.mcp_tools || []).length === 0 && (candidate.hooks || []).length === 0) {
    warnings.push("extension declares no commands, MCP tools, or hooks");
  }
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    compatible,
    todos_version: todosVersion,
    compatibility_range: compatibilityRange,
  };
}

export function installLocalExtension(input: InstallLocalExtensionInput): LocalExtensionRecord {
  const inspected = inspectExtensionSource(input.source);
  const expectedChecksum = input.checksum || inspected.manifest.checksum;
  if (expectedChecksum && expectedChecksum !== inspected.checksum) {
    throw new Error(`extension checksum mismatch: expected ${expectedChecksum}, got ${inspected.checksum}`);
  }
  const signature = input.signature || inspected.manifest.signature;
  const publicKey = input.public_key || inspected.manifest.public_key;
  const signatureVerified = verifyExtensionSignature({ checksum: inspected.checksum, signature, public_key: publicKey });
  const validation = inspected.validation;
  if (!validation.ok) throw new Error(`extension manifest invalid: ${validation.errors.join("; ")}`);
  const timestamp = new Date().toISOString();
  const config = loadConfig();
  const existing = config.extension_registry?.[inspected.manifest.name];
  const trusted = Boolean(input.trust);
  const record: LocalExtensionRecord = {
    name: inspected.manifest.name,
    version: inspected.manifest.version,
    source: inspected.source,
    source_type: inspected.source_type,
    manifest: redactValue(inspected.manifest) as LocalExtensionManifest,
    checksum: inspected.checksum,
    signature_verified: signatureVerified,
    trusted,
    status: trusted ? "trusted" : "needs_review",
    warnings: [
      ...validation.warnings,
      ...(signature || publicKey ? (signatureVerified ? [] : ["extension signature could not be verified"]) : ["extension is unsigned"]),
      ...(trusted ? [] : ["extension installed as needs_review until trusted explicitly"]),
    ],
    installed_at: existing?.installed_at || timestamp,
    updated_at: timestamp,
  };
  saveConfig({
    ...config,
    extension_registry: {
      ...(config.extension_registry || {}),
      [record.name]: record,
    },
  });
  return record;
}

export function listLocalExtensions(): LocalExtensionRecord[] {
  return Object.values(loadConfig().extension_registry || {}).sort((a, b) => a.name.localeCompare(b.name));
}

export function getLocalExtension(name: string): LocalExtensionRecord | null {
  return loadConfig().extension_registry?.[normalizeName(name)] || null;
}

export function removeLocalExtension(name: string): boolean {
  const normalized = normalizeName(name);
  const config = loadConfig();
  if (!config.extension_registry?.[normalized]) return false;
  const next = { ...config.extension_registry };
  delete next[normalized];
  saveConfig({ ...config, extension_registry: next });
  return true;
}

export function renderExtensionSummary(record: LocalExtensionRecord): string {
  return `${record.name}@${record.version} ${record.status} ${basename(record.source)} ${record.signature_verified ? "signed" : "unsigned"}`;
}
