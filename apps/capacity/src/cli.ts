#!/usr/bin/env bun

import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  AccountsError,
  asAccountsError,
  canonicalJson,
  createAccountsCapacity,
  createSQLiteAccounts,
  decodeRecordEnvelope,
  decodeRedactedRecordEnvelope,
  encodeRedactedRecordEnvelope,
  exitCodeForError,
  parseAccessMethodId,
  parseAccountId,
  parseAuthCapsuleId,
  parseCapacityPoolId,
  parseClosedJson,
  parseClosedJsonBytes,
  parseCredentialBindingId,
  parseEntitlementId,
  evaluateNativeSubscriptionProbe,
  StaticNativeSubscriptionSnapshotSource,
  PACKAGE_VERSION,
  toErrorEnvelope,
  validateSlotEligibility,
  type AccountsAuthProvider,
  type AccountsCapacity,
  type EntityKind,
  type EntityMap,
  type EligibilityRequest,
  type ListOptions,
  type Page,
  type RedactedRecord,
  type SlotEligibilityMetadata,
  type NativeSubscriptionBindingSnapshot,
} from "./index";

const CLI_SCHEMA_VERSION = "accounts.cli.v1" as const;
/** Largest page the capacity API accepts, and the bound on pages a list may walk. */
const SELF_HOSTED_PAGE_LIMIT = 100;
const SELF_HOSTED_MAX_PAGES = 1000;
/**
 * Absolute path or `file:` URL of the deployment-owned module the installed
 * `capacity` binary loads to resolve capacity client credentials. Without it the
 * self-hosted commands stay fail-closed.
 */
const CREDENTIAL_RESOLVER_MODULE_ENVIRONMENT = "HASNA_ACCOUNTS_CAPACITY_RESOLVER_MODULE";

const NOUNS: Readonly<Record<string, EntityKind>> = {
  accounts: "account",
  entitlements: "entitlement",
  "capacity-pools": "capacity_pool",
  "access-methods": "access_method",
  "auth-capsules": "auth_capsule",
  "credential-bindings": "credential_binding",
};
const FORBIDDEN_AUTH_HEADERS = new Set([
  "cookie",
  "proxy-authorization",
  "x-api-key",
  "x-auth-token",
  "x-legacy-api-key",
]);

interface ParsedArguments {
  readonly positionals: readonly string[];
  readonly flags: Readonly<Record<string, string | true>>;
}

interface CliCatalog {
  doctor(): Promise<unknown>;
  list(kind: EntityKind): Promise<readonly RedactedRecord[]>;
  get(kind: EntityKind, id: EntityMap[EntityKind]["id"]): Promise<RedactedRecord>;
  eligibility(request: EligibilityRequest): Promise<SlotEligibilityMetadata>;
  close(): Promise<void>;
}

/**
 * Exchanges the Secrets-managed capacity client credential reference in
 * HASNA_ACCOUNTS_CAPACITY_AUTH_REF for the separately audienced client
 * credential the capacity API accepts. The reference is not credential
 * material, so the CLI never presents it as one; a deployment supplies the
 * resolver that its Secrets runtime backs, either through
 * {@link AccountsCliOptions} or through the module named by
 * HASNA_ACCOUNTS_CAPACITY_RESOLVER_MODULE.
 */
export interface CapacityClientCredentialResolver {
  resolve(reference: string, signal?: AbortSignal): Promise<string>;
}

export interface AccountsCliOptions {
  readonly credentialResolver?: CapacityClientCredentialResolver;
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

    const catalog = await createCliCatalog(options);
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
          records: records.map((data) => encodeRedactedRecordEnvelope(kind, data)),
        });
        return 0;
      }
      if (command === "get") {
        const kind = parseNoun(positionals[0]);
        requirePositionals(positionals, 2, "get");
        const id = parseEntityId(kind, positionals[1]);
        const record = await catalog.get(kind, id as never);
        output(jsonRequested, "get", encodeRedactedRecordEnvelope(kind, record));
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

async function createCliCatalog(options: AccountsCliOptions): Promise<CliCatalog> {
  const deployment = Bun.env.HASNA_ACCOUNTS_DEPLOYMENT;
  const localPath = Bun.env.HASNA_ACCOUNTS_DATABASE_PATH;
  if (deployment === "self_hosted" && localPath !== undefined) {
    throw usageError("Self-hosted deployment cannot use a local database path");
  }
  if (deployment === "self_hosted") {
    const baseUrl = requiredEnvironment("HASNA_ACCOUNTS_CAPACITY_API_URL");
    const authRef = requiredEnvironment("HASNA_ACCOUNTS_CAPACITY_AUTH_REF");
    // An embedding caller may inject the resolver directly; the installed binary
    // has no such caller, so it loads the deployment-configured module instead.
    const resolver = options.credentialResolver ?? (await loadConfiguredCredentialResolver());
    return createSelfHostedCliCatalog(baseUrl, authRef, resolver);
  }
  const serviceConfigPresent =
    Bun.env.HASNA_ACCOUNTS_CAPACITY_API_URL !== undefined ||
    Bun.env.HASNA_ACCOUNTS_CAPACITY_AUTH_REF !== undefined ||
    Bun.env[CREDENTIAL_RESOLVER_MODULE_ENVIRONMENT] !== undefined;
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
    // Local records reach the envelope unprojected; encodeRedactedRecordEnvelope
    // applies the same reader redactor the API applies, so both deployments emit
    // the identical record projection.
    list: async (kind: EntityKind) =>
      (await catalog.list(kind)).map((record) => record as unknown as RedactedRecord),
    get: async (kind: EntityKind, id: EntityMap[EntityKind]["id"]) =>
      (await catalog.get(kind, id as never)) as unknown as RedactedRecord,
    eligibility: (request: EligibilityRequest) => catalog.eligibility(request),
    close: () => catalog.close(),
  });
}

function createSelfHostedCliCatalog(
  baseUrl: string,
  authRef: string,
  resolver: CapacityClientCredentialResolver | undefined,
): CliCatalog {
  const authProvider = resolvedCredentialAuthProvider(authRef, resolver);
  const client = createAccountsCapacity({
    mode: "self_hosted",
    baseUrl,
    authProvider,
  });
  const origin = new URL(`${new URL(baseUrl).origin}/`);
  return Object.freeze({
    doctor: () => selfHostedDoctor(origin, authProvider),
    list: (kind: EntityKind) => listSelfHosted(client, kind),
    get: async (kind: EntityKind, id: EntityMap[EntityKind]["id"]) =>
      (await getSelfHosted(client, kind, id)) as unknown as RedactedRecord,
    eligibility: (request: EligibilityRequest) => client.capacity.query(request),
    close: () => client.close(),
  });
}

function requiredEnvironment(name: string): string {
  const value = Bun.env[name];
  if (value === undefined || value.length === 0) throw usageError(`${name} is required`);
  return value;
}

/**
 * Loads the deployment-owned credential resolver named by
 * HASNA_ACCOUNTS_CAPACITY_RESOLVER_MODULE, so the installed `capacity` binary
 * reaches the self-hosted path without an embedding library caller. Returns
 * undefined when unset, which keeps self-hosted commands fail-closed with
 * DEPENDENCY_UNAVAILABLE.
 */
async function loadConfiguredCredentialResolver(): Promise<CapacityClientCredentialResolver | undefined> {
  const specifier = Bun.env[CREDENTIAL_RESOLVER_MODULE_ENVIRONMENT];
  if (specifier === undefined || specifier.length === 0) return undefined;
  const path = credentialResolverModulePath(specifier);
  requireOwnerOnlyModule(path);
  let loaded: Record<string, unknown>;
  try {
    loaded = (await import(pathToFileURL(path).href)) as Record<string, unknown>;
  } catch {
    throw new AccountsError(
      "DEPENDENCY_UNAVAILABLE",
      "Capacity client credential resolver module could not be loaded",
    );
  }
  const exported = loaded.resolve;
  if (typeof exported !== "function") {
    throw new AccountsError(
      "DEPENDENCY_UNAVAILABLE",
      "Capacity client credential resolver module does not export resolve",
    );
  }
  const moduleResolve = exported as CapacityClientCredentialResolver["resolve"];
  return Object.freeze({
    resolve: async (reference: string, signal?: AbortSignal) => {
      const credential = await moduleResolve(reference, signal);
      // A non-string would otherwise be stringified into a bearer credential by
      // the visible-ASCII check the auth provider applies.
      if (typeof credential !== "string") {
        throw new AccountsError(
          "DEPENDENCY_UNAVAILABLE",
          "Capacity client credential resolver returned a non-string credential",
        );
      }
      return credential;
    },
  });
}

/** The resolver module is executed in-process, so a remote or relative specifier is refused. */
function credentialResolverModulePath(specifier: string): string {
  if (/^file:/i.test(specifier)) {
    try {
      return fileURLToPath(new URL(specifier));
    } catch {
      throw resolverModuleUsageError();
    }
  }
  if (!isAbsolute(specifier)) throw resolverModuleUsageError();
  return specifier;
}

function resolverModuleUsageError(): AccountsError {
  return usageError(`${CREDENTIAL_RESOLVER_MODULE_ENVIRONMENT} must be an absolute path or file: URL`);
}

/**
 * Mirrors the packaged launcher's payload check: a resolver module any other
 * account can rewrite is arbitrary code running with the operator's authority.
 */
function requireOwnerOnlyModule(path: string): void {
  let mode: number;
  let isFile: boolean;
  try {
    const status = statSync(path);
    mode = status.mode;
    isFile = status.isFile();
  } catch {
    throw new AccountsError(
      "DEPENDENCY_UNAVAILABLE",
      "Capacity client credential resolver module is missing or unreadable",
    );
  }
  if (!isFile || (process.platform !== "win32" && (mode & 0o022) !== 0)) {
    throw new AccountsError(
      "POLICY_DENIED",
      "Capacity client credential resolver module must be a regular file that is not group- or world-writable",
    );
  }
}

function resolvedCredentialAuthProvider(
  authRef: string,
  resolver: CapacityClientCredentialResolver | undefined,
): AccountsAuthProvider {
  if (!/^[\x21-\x7e]{1,4096}$/.test(authRef)) {
    throw usageError("HASNA_ACCOUNTS_CAPACITY_AUTH_REF must be a visible ASCII credential reference");
  }
  if (resolver === undefined) {
    throw new AccountsError(
      "DEPENDENCY_UNAVAILABLE",
      "Capacity client credential resolution is not configured for this deployment",
    );
  }
  return Object.freeze({
    authorize: async (headers: Headers, signal?: AbortSignal) => {
      if (signal?.aborted) throw signal.reason ?? new DOMException("The operation was aborted", "AbortError");
      const credential = await resolver.resolve(authRef, signal);
      // A resolver that hands back its own input has resolved nothing; the
      // reference must never travel to the API as a bearer credential.
      if (credential === authRef || !/^[\x21-\x7e]{1,4096}$/.test(credential)) {
        throw new AccountsError("DEPENDENCY_UNAVAILABLE", "Capacity client credential is unresolved or invalid");
      }
      headers.set("authorization", `Bearer ${credential}`);
    },
  });
}

/** Walks every page so an api-mode list returns the same record set a local list returns. */
async function listSelfHosted(client: AccountsCapacity, kind: EntityKind): Promise<readonly RedactedRecord[]> {
  const readPage = selfHostedListPage(client, kind);
  const records: RedactedRecord[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < SELF_HOSTED_MAX_PAGES; page += 1) {
    const result = await readPage(
      cursor === undefined ? { limit: SELF_HOSTED_PAGE_LIMIT } : { cursor, limit: SELF_HOSTED_PAGE_LIMIT },
    );
    for (const record of result.records) records.push(record as RedactedRecord);
    if (result.nextCursor === null) return Object.freeze(records);
    if (result.nextCursor === cursor) break;
    cursor = result.nextCursor;
  }
  throw new AccountsError("DEPENDENCY_UNAVAILABLE", "Capacity list pagination did not terminate");
}

function selfHostedListPage(
  client: AccountsCapacity,
  kind: EntityKind,
): (options: ListOptions) => Promise<Page<unknown>> {
  switch (kind) {
    case "account":
      return (options) => client.providerAccounts.list(options);
    case "entitlement":
      return (options) => client.entitlements.list(options);
    case "capacity_pool":
      return (options) => client.capacityPools.list(options);
    case "access_method":
      return (options) => client.lanes.list(options);
    case "auth_capsule":
      return (options) => client.capsules.list(options);
    case "credential_binding":
      return (options) => client.credentialBindings.list(options);
  }
}

function getSelfHosted(
  client: AccountsCapacity,
  kind: EntityKind,
  id: EntityMap[EntityKind]["id"],
): Promise<unknown> {
  switch (kind) {
    case "account":
      return client.providerAccounts.get(id as EntityMap["account"]["id"]);
    case "entitlement":
      return client.entitlements.get(id as EntityMap["entitlement"]["id"]);
    case "capacity_pool":
      return client.capacityPools.get(id as EntityMap["capacity_pool"]["id"]);
    case "access_method":
      return client.lanes.get(id as EntityMap["access_method"]["id"]);
    case "auth_capsule":
      return client.capsules.get(id as EntityMap["auth_capsule"]["id"]);
    case "credential_binding":
      return client.credentialBindings.get(id as EntityMap["credential_binding"]["id"]);
  }
}

async function selfHostedDoctor(
  origin: URL,
  authProvider: AccountsAuthProvider,
): Promise<Readonly<Record<string, unknown>>> {
  const [health, ready, version] = await Promise.all([
    fetchSelfHostedDiagnostic(origin, "/health", authProvider, new Set([200])),
    fetchSelfHostedDiagnostic(origin, "/ready", authProvider, new Set([200, 503])),
    fetchSelfHostedDiagnostic(origin, "/version", authProvider, new Set([200])),
  ]);
  const healthRecord = closedObject(health, ["schemaVersion", "status"]);
  literal(healthRecord.schemaVersion, "accounts.health.v1", "schemaVersion");
  literal(healthRecord.status, "ok", "status");
  const readyRecord = closedObject(ready, ["schemaVersion", "status"]);
  literal(readyRecord.schemaVersion, "accounts.readiness.v1", "schemaVersion");
  if (readyRecord.status !== "ready" && readyRecord.status !== "not_ready") invalidDiagnostic("status");
  const versionRecord = closedObject(version, ["schemaVersion", "version", "contractSha256"]);
  literal(versionRecord.schemaVersion, "accounts.version.v1", "schemaVersion");
  if (typeof versionRecord.version !== "string" || versionRecord.version.length === 0) {
    invalidDiagnostic("version");
  }
  if (typeof versionRecord.contractSha256 !== "string" || !/^[0-9a-f]{64}$/.test(versionRecord.contractSha256)) {
    invalidDiagnostic("contractSha256");
  }
  return Object.freeze({
    adapter: "http",
    health: "ok",
    readiness: readyRecord.status,
    version: versionRecord.version,
    contractSha256: versionRecord.contractSha256,
  });
}

async function fetchSelfHostedDiagnostic(
  origin: URL,
  path: string,
  authProvider: AccountsAuthProvider,
  acceptedStatuses: ReadonlySet<number>,
): Promise<unknown> {
  const url = new URL(path, origin);
  if (url.origin !== origin.origin) {
    throw new AccountsError("VALIDATION_FAILED", "Self-hosted diagnostic origin escape is forbidden", {
      details: { field: "baseUrl" },
    });
  }
  const headers = new Headers({ accept: "application/json" });
  try {
    await authProvider.authorize(headers);
  } catch {
    throw new AccountsError("DEPENDENCY_UNAVAILABLE", "Capacity authentication is unavailable");
  }
  validateAuthorizationHeaders(headers);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers,
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
    });
  } catch {
    throw new AccountsError("DEPENDENCY_UNAVAILABLE", "Capacity service is unavailable", {
      retryable: true,
    });
  }
  let decoded: unknown;
  try {
    decoded = parseClosedJson(await response.text());
  } catch {
    throw new AccountsError("DEPENDENCY_UNAVAILABLE", "Capacity service returned invalid JSON");
  }
  if (!acceptedStatuses.has(response.status)) {
    throw new AccountsError("DEPENDENCY_UNAVAILABLE", "Capacity diagnostic endpoint is unavailable", {
      retryable: response.status >= 500,
    });
  }
  return decoded;
}

function validateAuthorizationHeaders(headers: Headers): void {
  const authorization = headers.get("authorization");
  if (authorization === null || !/^Bearer [\x21-\x7e]{1,4096}$/.test(authorization)) {
    throw new AccountsError("FORBIDDEN", "Capacity authorization is missing or invalid");
  }
  for (const name of FORBIDDEN_AUTH_HEADERS) {
    if (headers.has(name)) {
      throw new AccountsError("VALIDATION_FAILED", "Legacy or ambient credential header is forbidden", {
        details: { field: name.replace(/-/g, "_") },
      });
    }
  }
}

function closedObject(value: unknown, required: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalidDiagnostic("response");
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) if (!required.includes(key)) invalidDiagnostic(key);
  for (const key of required) if (!Object.hasOwn(record, key)) invalidDiagnostic(key);
  return record;
}

function literal(value: unknown, expected: string, field: string): void {
  if (value !== expected) invalidDiagnostic(field);
}

function invalidDiagnostic(field: string): never {
  throw new AccountsError("DEPENDENCY_UNAVAILABLE", "Capacity service returned an invalid diagnostic response", {
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
  } else if (schemaVersion === "accounts.capacity-redacted.v1") {
    documentKind = decodeRedactedRecordEnvelope(parsed).kind;
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
