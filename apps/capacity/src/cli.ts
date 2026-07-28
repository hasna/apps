#!/usr/bin/env bun

import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import {
  AccountsError,
  createAccountsCapacity,
  createReferenceAuthProvider,
  asAccountsError,
  canonicalJson,
  createSQLiteAccounts,
  decodeRecordEnvelope,
  exitCodeForError,
  parseAccessMethodId,
  parseAccountId,
  parseAuthCapsuleId,
  parseCapacityPoolId,
  parseClosedJsonBytes,
  parseCredentialBindingId,
  parseEntitlementId,
  evaluateNativeSubscriptionProbe,
  redactEntity,
  StaticNativeSubscriptionSnapshotSource,
  PACKAGE_VERSION,
  parseClosedJson,
  toErrorEnvelope,
  validateSlotEligibility,
  type AccountsCapacity,
  type AccountsCapacityCredentialResolver,
  type EntityKind,
  type EntityMap,
  type EligibilityRequest,
  type NativeSubscriptionBindingSnapshot,
  type SlotEligibilityMetadata,
} from "./index";

const CLI_SCHEMA_VERSION = "accounts.cli.v1" as const;

const NOUNS: Readonly<Record<string, EntityKind>> = {
  accounts: "account",
  entitlements: "entitlement",
  "capacity-pools": "capacity_pool",
  "access-methods": "access_method",
  "auth-capsules": "auth_capsule",
  "credential-bindings": "credential_binding",
};

/**
 * HASNA_ACCOUNTS_CAPACITY_AUTH_REF carries a Secrets-managed credential
 * reference, never credential material, so it is held to the reference shape
 * and is never used as a bearer value.
 */
const SELF_HOSTED_AUTH_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/;

/**
 * Names the deployment's Secrets resolver executable. It carries a command
 * path, never credential material: the command is run with the credential
 * reference as its only argument and returns the audienced credential on
 * stdout, so the packaged binary reaches the API without this package ever
 * bundling, storing, or logging a credential.
 */
const CREDENTIAL_COMMAND_VARIABLE = "HASNA_ACCOUNTS_CAPACITY_CREDENTIAL_COMMAND";

/** Bounds the resolver command's stdout before it reaches the auth provider. */
const MAX_CREDENTIAL_BYTES = 4096;

/**
 * Resolving the capacity client credential reference is a deployment-owned
 * Secrets capability. This package ships no resolver: an embedder injects one,
 * or the deployment names one through HASNA_ACCOUNTS_CAPACITY_CREDENTIAL_COMMAND.
 * With neither, the self-hosted CLI refuses before any request is built.
 */
export interface AccountsCliOptions {
  readonly credentialResolver?: AccountsCapacityCredentialResolver;
}

interface CliCatalog {
  doctor(): Promise<unknown>;
  list(kind: EntityKind): Promise<readonly unknown[]>;
  get(kind: EntityKind, id: EntityMap[EntityKind]["id"]): Promise<unknown>;
  eligibility(request: EligibilityRequest): Promise<SlotEligibilityMetadata>;
  close(): Promise<void>;
}

interface ParsedArguments {
  readonly positionals: readonly string[];
  readonly flags: Readonly<Record<string, string | true>>;
}

export async function runAccountsCli(
  argv: readonly string[],
  options: AccountsCliOptions = {},
): Promise<number> {
  const jsonRequested = argv.includes("--json");
  try {
    const parsed = parseArguments(argv);
    const [command, ...positionals] = parsed.positionals;
    if (command === "help" || parsed.flags.help === true) {
      output(jsonRequested, "help", { usage: usageText() });
      return 0;
    }
    if (command === "version" || parsed.flags.version === true) {
      output(jsonRequested, "version", { package: "@hasna/capacity", version: PACKAGE_VERSION });
      return 0;
    }
    if (command === undefined) {
      output(jsonRequested, "help", { usage: usageText() });
      return 0;
    }
    if (command === "validate") return await validateCommand(positionals, parsed.flags, jsonRequested);
    if (command === "probe-native") {
      return await probeNativeCommand(positionals, parsed.flags, jsonRequested);
    }

    const catalog = createCliCatalog(options);
    try {
      if (command === "doctor") {
        requireNoPositionals(positionals, "doctor");
        output(jsonRequested, "doctor", await catalog.doctor());
        return 0;
      }
      if (command === "list") {
        const kind = parseNoun(positionals[0]);
        requirePositionals(positionals, 1, "list");
        const records = await catalog.list(kind);
        output(jsonRequested, "list", {
          kind,
          records: records.map((data) => ({
            schemaVersion: "accounts.capacity.v1",
            kind,
            data,
          })),
        });
        return 0;
      }
      if (command === "get") {
        const kind = parseNoun(positionals[0]);
        requirePositionals(positionals, 2, "get");
        const id = parseEntityId(kind, positionals[1]);
        const record = await catalog.get(kind, id as never);
        output(jsonRequested, "get", {
          schemaVersion: "accounts.capacity.v1",
          kind,
          data: record,
        });
        return 0;
      }
      if (command === "eligibility") {
        requirePositionals(positionals, 1, "eligibility");
        const accessMethodId = parseAccessMethodId(positionals[0]);
        const operation = requiredFlag(parsed.flags, "operation");
        const model = requiredFlag(parsed.flags, "model");
        const dataClassification = requiredFlag(parsed.flags, "data-classification");
        const destinationPolicyClass =
          typeof parsed.flags["destination-policy-class"] === "string"
            ? parsed.flags["destination-policy-class"]
            : "default";
        const result = await catalog.eligibility({
          accessMethodId,
          operation,
          model,
          dataClassification,
          destinationPolicyClass,
        });
        output(jsonRequested, "eligibility", result);
        return result.eligible ? 0 : 7;
      }
      throw usageError("Unknown command");
    } finally {
      await catalog.close();
    }
  } catch (error) {
    const safe = asAccountsError(error);
    const envelope = toErrorEnvelope(safe, randomUUID());
    if (jsonRequested) Bun.stderr.write(`${canonicalJson(envelope)}\n`);
    else Bun.stderr.write(`${envelope.error.code}: ${envelope.error.message}\n`);
    return exitCodeForError(safe);
  }
}

function createCliCatalog(options: AccountsCliOptions): CliCatalog {
  const deployment = Bun.env.HASNA_ACCOUNTS_DEPLOYMENT;
  const localPath = Bun.env.HASNA_ACCOUNTS_DATABASE_PATH;
  const apiUrl = Bun.env.HASNA_ACCOUNTS_CAPACITY_API_URL;
  const authRef = Bun.env.HASNA_ACCOUNTS_CAPACITY_AUTH_REF;
  const serviceConfigPresent = apiUrl !== undefined || authRef !== undefined;
  if (deployment === "self_hosted" && localPath !== undefined) {
    throw usageError("Self-hosted deployment cannot use a local database path");
  }
  if (deployment === "self_hosted") {
    if (apiUrl === undefined || apiUrl.length === 0) {
      throw usageError("HASNA_ACCOUNTS_CAPACITY_API_URL is required for self_hosted");
    }
    if (authRef === undefined || !SELF_HOSTED_AUTH_REF_PATTERN.test(authRef)) {
      throw usageError("HASNA_ACCOUNTS_CAPACITY_AUTH_REF is required for self_hosted");
    }
    return createSelfHostedCliCatalog(apiUrl, authRef, credentialResolver(options));
  }
  if (deployment !== "local") {
    throw usageError("HASNA_ACCOUNTS_DEPLOYMENT must be local or self_hosted");
  }
  if (serviceConfigPresent) {
    throw usageError("Local deployment cannot use self-hosted capacity configuration");
  }
  if (localPath !== undefined && !isAbsolute(localPath)) {
    throw usageError("HASNA_ACCOUNTS_DATABASE_PATH must be absolute");
  }
  const path = localPath === undefined ? join(homedir(), ".hasna", "accounts", "accounts.db") : localPath;
  const catalog = createSQLiteAccounts({ path });
  return Object.freeze({
    doctor: () => catalog.doctor(),
    // Local reads pass through the same reader projection the API serves, so
    // both deployment modes emit one record schema and neither discloses a
    // provider subject value.
    list: async (kind: EntityKind) =>
      (await catalog.list(kind)).map((record) => redactEntity(kind, record)),
    get: async (kind: EntityKind, id: EntityMap[EntityKind]["id"]) =>
      redactEntity(kind, await catalog.get(kind, id as never)),
    eligibility: (request: EligibilityRequest) => catalog.eligibility(request),
    close: () => catalog.close(),
  });
}

function createSelfHostedCliCatalog(
  baseUrl: string,
  authRef: string,
  resolver: AccountsCapacityCredentialResolver,
): CliCatalog {
  const authProvider = createReferenceAuthProvider(authRef, resolver);
  const client = createAccountsCapacity({ mode: "self_hosted", baseUrl, authProvider });
  return new SelfHostedCliCatalog(baseUrl, client);
}

/**
 * An embedder-supplied resolver wins; otherwise the deployment names its own
 * Secrets command. Neither present is still a refusal, so the packaged binary
 * never invents a credential source.
 */
function credentialResolver(options: AccountsCliOptions): AccountsCapacityCredentialResolver {
  if (options.credentialResolver !== undefined) return options.credentialResolver;
  const command = Bun.env[CREDENTIAL_COMMAND_VARIABLE];
  if (command === undefined || command.length === 0) {
    throw new AccountsError(
      "DEPENDENCY_UNAVAILABLE",
      "Capacity client credential resolution is unavailable",
    );
  }
  if (!isAbsolute(command)) {
    throw usageError(`${CREDENTIAL_COMMAND_VARIABLE} must be an absolute path`);
  }
  assertTrustedCredentialCommand(command);
  return createCommandCredentialResolver(command);
}

/**
 * Mirrors the launcher's artifact check. A resolver another local account can
 * rewrite is a credential-exfiltration path, so it is refused before it runs
 * rather than after it has been handed the reference.
 */
function assertTrustedCredentialCommand(command: string): void {
  let mode: number;
  let isFile: boolean;
  try {
    const status = statSync(command);
    mode = status.mode;
    isFile = status.isFile();
  } catch {
    throw new AccountsError("DEPENDENCY_UNAVAILABLE", "Capacity credential command is unavailable");
  }
  if (!isFile || (process.platform !== "win32" && (mode & 0o022) !== 0)) {
    throw new AccountsError("POLICY_DENIED", "Capacity credential command is not trusted", {
      details: { field: "credentialCommand" },
    });
  }
}

function createCommandCredentialResolver(command: string): AccountsCapacityCredentialResolver {
  return Object.freeze({
    resolve: async (reference: string, signal?: AbortSignal): Promise<string> => {
      try {
        const child = Bun.spawn([command, reference], {
          stdin: "ignore",
          stdout: "pipe",
          // Resolver diagnostics can echo credential material, so stderr is
          // never captured, printed, or attached to an error.
          stderr: "ignore",
          ...(signal === undefined ? {} : { signal }),
        });
        const [stdout, exitCode] = await Promise.all([
          new Response(child.stdout).text(),
          child.exited,
        ]);
        if (exitCode !== 0 || stdout.length > MAX_CREDENTIAL_BYTES) {
          throw credentialCommandFailed();
        }
        // createReferenceAuthProvider holds the result to the credential shape
        // and rejects an echoed reference, so this only removes the trailing
        // newline a well-behaved command writes.
        return stdout.trim();
      } catch (error) {
        if (error instanceof AccountsError) throw error;
        throw credentialCommandFailed();
      }
    },
  });
}

function credentialCommandFailed(): AccountsError {
  return new AccountsError(
    "DEPENDENCY_UNAVAILABLE",
    "Capacity client credential resolution failed",
    { retryable: true },
  );
}

class SelfHostedCliCatalog implements CliCatalog {
  private readonly baseUrl: URL;

  constructor(
    baseUrl: string,
    private readonly client: AccountsCapacity,
  ) {
    this.baseUrl = new URL("/", new URL(baseUrl));
  }

  async doctor(): Promise<unknown> {
    const [health, readiness, version] = await Promise.all([
      this.fetchDiagnostic("/health", [200], ["schemaVersion", "status"]),
      this.fetchDiagnostic("/ready", [200, 503], ["schemaVersion", "status"]),
      this.fetchDiagnostic("/version", [200], ["schemaVersion", "version", "contractSha256"]),
    ]);
    expectLiteral(health.schemaVersion, "accounts.health.v1", "schemaVersion");
    expectLiteral(health.status, "ok", "status");
    expectLiteral(readiness.schemaVersion, "accounts.readiness.v1", "schemaVersion");
    if (readiness.status !== "ready" && readiness.status !== "not_ready") invalidServiceField("status");
    expectLiteral(version.schemaVersion, "accounts.version.v1", "schemaVersion");
    if (typeof version.version !== "string" || version.version.length === 0) invalidServiceField("version");
    if (typeof version.contractSha256 !== "string" || !/^[0-9a-f]{64}$/.test(version.contractSha256)) {
      invalidServiceField("contractSha256");
    }
    return {
      adapter: "http",
      health: health.status,
      readiness: readiness.status,
      version: version.version,
      contractSha256: version.contractSha256,
    };
  }

  async list(kind: EntityKind): Promise<readonly unknown[]> {
    const records: unknown[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.listPage(kind, cursor);
      records.push(...page.records);
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
    return Object.freeze(records);
  }

  get(kind: EntityKind, id: EntityMap[EntityKind]["id"]): Promise<unknown> {
    switch (kind) {
      case "account":
        return this.client.providerAccounts.get(parseAccountId(id));
      case "entitlement":
        return this.client.entitlements.get(parseEntitlementId(id));
      case "capacity_pool":
        return this.client.capacityPools.get(parseCapacityPoolId(id));
      case "access_method":
        return this.client.lanes.get(parseAccessMethodId(id));
      case "auth_capsule":
        return this.client.capsules.get(parseAuthCapsuleId(id));
      case "credential_binding":
        return this.client.credentialBindings.get(parseCredentialBindingId(id));
    }
  }

  eligibility(request: EligibilityRequest): Promise<SlotEligibilityMetadata> {
    return this.client.capacity.query(request);
  }

  close(): Promise<void> {
    return this.client.close();
  }

  private async listPage(kind: EntityKind, cursor: string | undefined) {
    const options = { ...(cursor === undefined ? {} : { cursor }), limit: 100 };
    switch (kind) {
      case "account":
        return this.client.providerAccounts.list(options);
      case "entitlement":
        return this.client.entitlements.list(options);
      case "capacity_pool":
        return this.client.capacityPools.list(options);
      case "access_method":
        return this.client.lanes.list(options);
      case "auth_capsule":
        return this.client.capsules.list(options);
      case "credential_binding":
        return this.client.credentialBindings.list(options);
    }
  }

  private async fetchDiagnostic(
    path: string,
    allowedStatuses: readonly number[],
    requiredFields: readonly string[],
  ): Promise<Record<string, unknown>> {
    const url = new URL(path, this.baseUrl);
    if (url.origin !== this.baseUrl.origin) {
      throw new AccountsError("VALIDATION_FAILED", "Self-hosted diagnostic origin escaped");
    }
    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: { accept: "application/json" },
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
      });
    } catch {
      throw new AccountsError("DEPENDENCY_UNAVAILABLE", "Capacity service is unavailable", {
        retryable: true,
      });
    }
    const body = await response.text();
    if (!allowedStatuses.includes(response.status)) {
      throw new AccountsError("DEPENDENCY_UNAVAILABLE", "Capacity service diagnostic failed", {
        retryable: response.status >= 500,
      });
    }
    let parsed: unknown;
    try {
      parsed = parseClosedJson(body);
    } catch {
      throw new AccountsError("DEPENDENCY_UNAVAILABLE", "Capacity service returned invalid JSON");
    }
    return closedDiagnosticObject(parsed, requiredFields);
  }
}

function closedDiagnosticObject(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalidServiceField("response");
  const record = value as Record<string, unknown>;
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(record)) if (!allowed.has(key)) invalidServiceField(key);
  for (const key of required) if (!Object.hasOwn(record, key)) invalidServiceField(key);
  return record;
}

function expectLiteral(value: unknown, expected: string, field: string): void {
  if (value !== expected) invalidServiceField(field);
}

function invalidServiceField(field: string): never {
  throw new AccountsError("DEPENDENCY_UNAVAILABLE", "Capacity service returned an invalid diagnostic", {
    details: { field: field.replace(/[^A-Za-z0-9_.]/g, "_").slice(0, 64) },
  });
}

async function validateCommand(
  positionals: readonly string[],
  flags: Readonly<Record<string, string | true>>,
  jsonRequested: boolean,
): Promise<number> {
  requirePositionals(positionals, 1, "validate");
  const bytes =
    positionals[0] === "-"
      ? new Uint8Array(await Bun.stdin.arrayBuffer())
      : new Uint8Array(await Bun.file(resolve(positionals[0]!)).arrayBuffer());
  const parsed = parseClosedJsonBytes(bytes);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw usageError("Expected a DTO object");
  const schemaVersion = (parsed as Record<string, unknown>).schemaVersion;
  let documentKind: string;
  if (schemaVersion === "accounts.capacity.v1") {
    documentKind = decodeRecordEnvelope(parsed).kind;
  } else if (schemaVersion === "accounts.slot-eligibility.v1") {
    validateSlotEligibility(parsed);
    documentKind = "slot_eligibility";
  } else {
    throw new AccountsError("SCHEMA_VERSION_UNSUPPORTED", "Unsupported DTO schema version");
  }
  if (flags.json !== undefined && flags.json !== true) throw usageError("--json takes no value");
  output(jsonRequested, "validate", { valid: true, documentKind });
  return 0;
}

async function probeNativeCommand(
  positionals: readonly string[],
  flags: Readonly<Record<string, string | true>>,
  jsonRequested: boolean,
): Promise<number> {
  requirePositionals(positionals, 2, "probe-native");
  const ownerRef = requiredFlag(flags, "owner");
  const request = parseClosedJsonBytes(
    new Uint8Array(await Bun.file(resolve(positionals[0]!)).arrayBuffer()),
  );
  const snapshot = parseClosedJsonBytes(
    new Uint8Array(await Bun.file(resolve(positionals[1]!)).arrayBuffer()),
  );
  const source = new StaticNativeSubscriptionSnapshotSource([
    snapshot as NativeSubscriptionBindingSnapshot,
  ]);
  const result = await evaluateNativeSubscriptionProbe(request, source, ownerRef);
  output(jsonRequested, "probe-native", result);
  return result.capability_eligible ? 0 : 7;
}

function parseArguments(argv: readonly string[]): ParsedArguments {
  const positionals: string[] = [];
  const flags: Record<string, string | true> = Object.create(null) as Record<string, string | true>;
  const valueFlags = new Set(["operation", "model", "data-classification", "destination-policy-class", "owner"]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (!argument.startsWith("--")) {
      positionals.push(argument);
      continue;
    }
    const name = argument.slice(2);
    if (name.length === 0 || Object.hasOwn(flags, name)) throw usageError("Invalid or duplicate option");
    if (valueFlags.has(name)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) throw usageError("Option value is required");
      flags[name] = value;
      index += 1;
    } else if (name === "json" || name === "help" || name === "version") {
      flags[name] = true;
    } else {
      throw usageError("Unknown option");
    }
  }
  return { positionals, flags };
}

function parseNoun(value: string | undefined): EntityKind {
  if (value === undefined || NOUNS[value] === undefined) throw usageError("Unknown record noun");
  return NOUNS[value];
}

function parseEntityId(kind: EntityKind, value: string | undefined) {
  switch (kind) {
    case "account":
      return parseAccountId(value);
    case "entitlement":
      return parseEntitlementId(value);
    case "capacity_pool":
      return parseCapacityPoolId(value);
    case "access_method":
      return parseAccessMethodId(value);
    case "auth_capsule":
      return parseAuthCapsuleId(value);
    case "credential_binding":
      return parseCredentialBindingId(value);
  }
}

function requiredFlag(flags: Readonly<Record<string, string | true>>, name: string): string {
  const value = flags[name];
  if (typeof value !== "string" || value.length === 0 || value.length > 255) {
    throw usageError(`--${name} is required`);
  }
  return value;
}

function requirePositionals(positionals: readonly string[], count: number, command: string): void {
  if (positionals.length !== count) throw usageError(`Invalid ${command} arguments`);
}

function requireNoPositionals(positionals: readonly string[], command: string): void {
  requirePositionals(positionals, 0, command);
}

function usageError(message: string): AccountsError {
  return new AccountsError("VALIDATION_FAILED", message);
}

function output(json: boolean, command: string, data: unknown): void {
  const envelope = { schemaVersion: CLI_SCHEMA_VERSION, command, data };
  if (json) Bun.stdout.write(`${canonicalJson(envelope)}\n`);
  else if (command === "help") Bun.stdout.write(`${(data as { usage: string }).usage}\n`);
  else Bun.stdout.write(`${canonicalJson(data)}\n`);
}

function usageText(): string {
  return [
    "capacity validate <file|-> [--json]",
    "capacity probe-native <request-file> <snapshot-file> --owner <principal> [--json]",
    "capacity doctor [--json]",
    "capacity list <accounts|entitlements|capacity-pools|access-methods|auth-capsules|credential-bindings> [--json]",
    "capacity get <noun> <uuidv7> [--json]",
    "capacity eligibility <access-method-uuidv7> --operation <id> --model <id> --data-classification <id> [--json]",
  ].join("\n");
}

if (import.meta.main) {
  const code = await runAccountsCli(Bun.argv.slice(2));
  process.exitCode = code;
}
