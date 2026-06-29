import type { ProviderEnvironment } from "../core/providers.ts";

export interface MercuryCredentialInput {
  readonly environment: ProviderEnvironment;
  readonly apiKey?: string;
  readonly secretKey?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly readSecret?: (key: string) => string | undefined;
}

export interface MercuryReadClientInput extends MercuryCredentialInput {
  readonly baseUrl?: string;
  readonly fetch?: MercuryFetch;
}

export type MercuryFetch = (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>;

export interface MercuryAccountSummary {
  readonly id: string;
  readonly name?: string;
  readonly kind?: string;
  readonly type?: string;
  readonly status?: string;
  readonly legalBusinessName?: string;
  readonly currentBalance?: unknown;
  readonly availableBalance?: unknown;
  readonly accountNumberLast4?: string;
  readonly routingNumberLast4?: string;
}

export interface MercuryBalanceSummary {
  readonly accountId: string;
  readonly currentBalance: unknown;
  readonly availableBalance: unknown;
  readonly status?: string;
}

export interface MercuryCardSummary {
  readonly id: string;
  readonly accountId?: string;
  readonly nickname?: string;
  readonly type?: string;
  readonly kind?: string;
  readonly status?: string;
  readonly lastFour?: string;
  readonly expiration?: string;
  readonly spendLimit?: unknown;
}

export interface MercuryTransactionSummary {
  readonly id: string;
  readonly amount: unknown;
  readonly status: string;
  readonly kind?: string;
  readonly postedAt?: string;
  readonly createdAt?: string;
  readonly counterpartyName?: string;
  readonly description?: string;
}

export interface MercuryReadClient {
  listAccounts(input?: { readonly limit?: number }): Promise<readonly MercuryAccountSummary[]>;
  getBalance(input: { readonly accountId: string }): Promise<MercuryBalanceSummary>;
  listCards(input: { readonly accountId: string }): Promise<readonly MercuryCardSummary[]>;
  listTransactions(input: { readonly accountId: string; readonly limit?: number }): Promise<readonly MercuryTransactionSummary[]>;
}

export class MercuryCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MercuryCredentialError";
  }
}

export class MercuryApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "MercuryApiError";
    this.status = status;
  }
}

export function resolveMercuryApiKey(input: MercuryCredentialInput): string {
  const env = input.env ?? Bun.env;
  const direct = input.apiKey
    ?? env.MERCURY_API_KEY
    ?? env[`MERCURY_${input.environment.toUpperCase()}_API_KEY`];
  if (direct && direct.trim().length > 0) return direct.trim();

  if (input.secretKey) {
    const value = (input.readSecret ?? readSecretWithCli)(input.secretKey);
    if (value && value.trim().length > 0) return value.trim();
  }

  throw new MercuryCredentialError(
    "Missing Mercury API key. Set MERCURY_API_KEY, or pass --secret-key only on machines with a compatible local secrets CLI.",
  );
}

export function createMercuryReadClient(input: MercuryReadClientInput): MercuryReadClient {
  const apiKey = resolveMercuryApiKey(input);
  const baseUrl = input.baseUrl ?? mercuryBaseUrl(input.environment);
  const fetchImpl = input.fetch ?? fetch;

  async function request(path: string, params?: Readonly<Record<string, string | number | undefined>>): Promise<unknown> {
    const url = new URL(`${baseUrl}${path}`);
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const response = await fetchImpl(url, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${apiKey}`,
      },
    });

    const text = await response.text();
    if (!response.ok) {
      throw new MercuryApiError(response.status, `Mercury API request failed with HTTP ${response.status}.`);
    }
    if (!text.trim()) return {};
    return JSON.parse(text) as unknown;
  }

  return {
    async listAccounts(input = {}) {
      const payload = await request("/accounts", { limit: limitParam(input.limit) });
      return arrayFromPayload(payload, "accounts").map(normalizeAccount);
    },
    async getBalance(input) {
      const payload = await request(`/account/${encodeURIComponent(input.accountId)}`);
      const record = expectRecord(payload, "Mercury account");
      const account = normalizeAccount(payload);
      return {
        accountId: account.id,
        currentBalance: requiredUnknown(record, "currentBalance"),
        availableBalance: requiredUnknown(record, "availableBalance"),
        ...(account.status ? { status: account.status } : {}),
      };
    },
    async listCards(input) {
      const payload = await request(`/account/${encodeURIComponent(input.accountId)}/cards`);
      return arrayFromPayload(payload, "cards").map(normalizeCard);
    },
    async listTransactions(input) {
      const payload = await request(`/account/${encodeURIComponent(input.accountId)}/transactions`, {
        limit: limitParam(input.limit),
      });
      return arrayFromPayload(payload, "transactions").map(normalizeTransaction);
    },
  };
}

export function mercuryBaseUrl(environment: ProviderEnvironment): string {
  return environment === "sandbox"
    ? "https://api-sandbox.mercury.com/api/v1"
    : "https://api.mercury.com/api/v1";
}

function readSecretWithCli(key: string): string | undefined {
  const result = Bun.spawnSync(["secrets", "get", key], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) return undefined;
  return new TextDecoder().decode(result.stdout).trim();
}

function limitParam(limit: number | undefined): number | undefined {
  if (limit === undefined) return undefined;
  if (!Number.isFinite(limit) || limit < 1 || limit > 1000) {
    throw new MercuryApiError(400, "Mercury limit must be between 1 and 1000.");
  }
  return Math.trunc(limit);
}

function arrayFromPayload(payload: unknown, key: string): readonly Record<string, unknown>[] {
  const entries = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload[key])
      ? payload[key]
      : undefined;
  if (entries) {
    return entries.map((entry, index) => {
      if (!isRecord(entry)) throw new MercuryApiError(502, `Mercury ${key} response item ${index} was not an object.`);
      return entry;
    });
  }
  throw new MercuryApiError(502, `Mercury response is missing ${key}.`);
}

function normalizeAccount(value: unknown): MercuryAccountSummary {
  const record = expectRecord(value, "Mercury account");
  return {
    id: requiredString(record, "id"),
    ...stringProp(record, "name"),
    ...stringProp(record, "kind"),
    ...stringProp(record, "type"),
    ...stringProp(record, "status"),
    ...stringProp(record, "legalBusinessName"),
    ...unknownProp(record, "currentBalance"),
    ...unknownProp(record, "availableBalance"),
    ...last4Prop(record, "accountNumber", "accountNumberLast4"),
    ...last4Prop(record, "routingNumber", "routingNumberLast4"),
  };
}

function normalizeCard(value: unknown): MercuryCardSummary {
  const record = expectRecord(value, "Mercury card");
  const lastFour = firstString(record, ["lastFour", "lastFourDigits"]);
  const expiration = firstString(record, ["expiration", "expirationDate"]);
  return {
    id: requiredStringAny(record, ["id", "cardId"], "id"),
    ...stringProp(record, "accountId"),
    ...stringProp(record, "nickname"),
    ...stringProp(record, "type"),
    ...stringProp(record, "kind"),
    ...stringProp(record, "status"),
    ...(lastFour ? { lastFour } : {}),
    ...(expiration ? { expiration } : {}),
    ...unknownProp(record, "spendLimit"),
  };
}

function normalizeTransaction(value: unknown): MercuryTransactionSummary {
  const record = expectRecord(value, "Mercury transaction");
  return {
    id: requiredString(record, "id"),
    amount: requiredUnknown(record, "amount"),
    status: requiredString(record, "status"),
    ...stringProp(record, "kind"),
    ...stringProp(record, "postedAt"),
    ...stringProp(record, "createdAt"),
    ...stringProp(record, "counterpartyName"),
    ...stringProp(record, "description"),
  };
}

function expectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new MercuryApiError(502, `${label} response was not an object.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new MercuryApiError(502, `Mercury response is missing required ${key}.`);
  }
  return value;
}

function requiredStringAny(record: Record<string, unknown>, keys: readonly string[], label: string): string {
  const value = firstString(record, keys);
  if (!value) throw new MercuryApiError(502, `Mercury response is missing required ${label}.`);
  return value;
}

function requiredUnknown(record: Record<string, unknown>, key: string): unknown {
  const value = record[key];
  if (value === undefined) throw new MercuryApiError(502, `Mercury response is missing required ${key}.`);
  return value;
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function stringProp(record: Record<string, unknown>, key: string): Record<string, string> {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? { [key]: value } : {};
}

function unknownProp(record: Record<string, unknown>, key: string): Record<string, unknown> {
  return record[key] !== undefined ? { [key]: record[key] } : {};
}

function last4Prop(record: Record<string, unknown>, sourceKey: string, targetKey: string): Record<string, string> {
  const value = record[sourceKey];
  if (typeof value !== "string" || value.length < 4) return {};
  return { [targetKey]: value.slice(-4) };
}
