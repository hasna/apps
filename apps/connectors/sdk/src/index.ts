/**
 * @hasna/connectors-sdk
 * Zero-dependency TypeScript SDK for the @hasna/connectors REST API.
 * Default server port: 9876 (matches connectors-serve default).
 */

// ── Types ──────────────────────────────────────────────────────────────────

export interface AuthStatus {
  type: "apikey" | "api_key" | "oauth" | "bearer" | "none";
  configured?: boolean;
  connected?: boolean;
  expiresAt?: number | null;
  tokenExpiry?: number | null;
  hasRefreshToken?: boolean;
  profile?: string;
  envVars?: Array<{ variable: string; description: string; set: boolean }>;
  envVarSetCount?: number;
  envVarTotalCount?: number;
}

export interface ConnectorSummary {
  name: string;
  category: string;
  installed: boolean;
}

export interface Connector {
  name: string;
  displayName: string;
  description: string;
  category: string;
  version?: string;
  installed: boolean;
  auth: AuthStatus | null;
  overview?: string | null;
}

export interface ConnectorOperationsResponse {
  connector: string;
  displayName: string;
  auth?: AuthStatus;
  commands: string[];
  operations: ConnectorOperationDescriptor[];
  helpText: string;
}

export interface ConnectorOperationDescriptor {
  name: string;
  aliases: string[];
  usage: string;
  summary: string;
  source: "internal" | "cli";
}

export interface ConnectorOperationHelpResponse {
  connector: string;
  displayName: string;
  command: string;
  help: string;
}

export interface ConnectorCapabilityRuntime {
  packageName: "@hasna/connectors";
  connectorId: string;
  legacyConnectorId: string;
  packagePath: string;
  configDirName: string;
  legacyConfigDirName: string;
  internal: boolean;
  packageDirectory: boolean;
  commandSurface: boolean;
}

export interface ConnectorCapabilityAuth {
  type: AuthStatus["type"];
  summary: string | null;
  envVars: Array<{ variable: string; description: string }>;
}

export interface ConnectorCapabilityDocs {
  overview: string;
  cliCommands: string;
  dataStorage: string | null;
}

export interface ConnectorCapability {
  id: string;
  name: string;
  displayName: string;
  description: string;
  category: string;
  tags: string[];
  version?: string;
  aliases: string[];
  runtime: ConnectorCapabilityRuntime;
  auth: ConnectorCapabilityAuth;
  docs: ConnectorCapabilityDocs;
  operations?: ConnectorOperationDescriptor[];
}

export interface ConnectorCapabilityManifest {
  version: 1;
  packageName: "@hasna/connectors";
  packageVersion: string;
  generatedAt: string;
  categories: readonly string[];
  connectorCount: number;
  connectors: ConnectorCapability[];
}

export interface RunOperationResponse {
  connector: string;
  displayName: string;
  success: boolean;
  output: string;
}

export interface StructuredRunOperationOptions<TInput extends Record<string, unknown> = Record<string, unknown>> {
  operation: string;
  input?: TInput;
  profile?: string;
  timeout?: number;
  parseJson?: boolean;
}

export interface StructuredRunOperationResponse<TData = unknown> {
  connector: string;
  displayName: string;
  operation: string;
  profile?: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  success: boolean;
  data?: TData;
}

export interface Profile {
  id: string;
  [key: string]: unknown;
}

export interface ProfilesResponse {
  current: string;
  profiles: Profile[];
}

export interface ActivityEntry {
  action: string;
  connector: string;
  timestamp: number;
  detail?: string;
}

export interface UpdateResult {
  name: string;
  success: boolean;
  error?: string;
}

export interface UpdateResponse {
  results: UpdateResult[];
  count: number;
  total: number;
}

export interface InstallResponse {
  success: boolean;
  name: string;
}

export interface UninstallResponse {
  success: boolean;
  name: string;
}

export interface SetKeyResponse {
  success: boolean;
}

export interface RefreshResponse {
  success: boolean;
  expiresAt?: number | null;
  error?: string;
}

export interface SwitchProfileResponse {
  success: boolean;
  profile: string;
}

export interface ApiError {
  error: string;
}

export interface RunResult {
  success: boolean;
  output: string;
  exitCode: number;
}

export interface RunOptions {
  /** Timeout in milliseconds. Default: 30000 */
  timeout?: number;
  /** Output format passed to the connector CLI (e.g. "json") */
  format?: string;
  /** Working directory for the connector process */
  cwd?: string;
}

export interface ConnectorsClientOptions {
  /** Base URL of the connectors server. Defaults to http://localhost:9876 */
  serverUrl?: string;
  /** Directory where connector binaries are installed. Default: .connectors */
  connectorsDir?: string;
}

export interface ListOptions {
  /** Return compact list (name, category, installed only) */
  compact?: boolean;
  /** Comma-separated list of fields to return */
  fields?: string;
}

export interface RunOperationOptions {
  format?: "json" | "pretty";
  timeout?: number;
}

export interface ManifestOptions {
  includeOperations?: boolean;
  connectorNames?: string[];
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface HostedConnectorsClientOptions {
  /** Base URL of the hosted platform-connectors API, for example https://connectors.example */
  apiUrl: string;
  /** Bearer API key issued by the hosted platform. */
  apiKey?: string;
  /** Fetch implementation for tests, browsers, or custom runtimes. Defaults to global fetch. */
  fetchImpl?: FetchLike;
  /** Additional headers to send with every hosted API request. */
  headers?: Record<string, string>;
}

export interface HostedWhoamiResponse {
  organizationId: string;
  userId: string;
  authMethod: "api_key" | "session" | string;
  scopes: string[];
  serviceConsumer?: {
    serviceSlug: string;
    externalOrganizationId: string;
    externalOrganizationSlug?: string | null;
  } | null;
}

export interface HostedApiContract {
  service: string;
  version: string;
  basePath: "/api/v1" | string;
  auth: Record<string, unknown>;
  endpoints: Array<{
    method: string;
    path: string;
    scopes: string[];
    description: string;
  }>;
  errors: Array<{
    code: string;
    status: number;
    retryable: boolean;
  }>;
}

export interface HostedConnectorSummary {
  name: string;
  displayName: string;
  description: string;
  category: string;
  version?: string | null;
  tags: string[];
  hasCommandSurface: boolean;
}

export interface HostedConnectorAuthUrl {
  connector: string;
  provider: string | null;
  available: boolean;
  url: string | null;
  redirectUrl: string;
  scopes?: string[];
  state?: string;
  reason?: string;
}

export interface HostedAuthUrlOptions {
  redirectUrl?: string;
  returnUrl?: string;
  profileName?: string;
  scopes?: string[];
}

export interface HostedAccountConnectionStatus {
  connectorSlug: string;
  connected: boolean;
  accountCount: number;
  profileCount: number;
  statuses: string[];
}

export interface HostedAccount {
  id: string;
  organizationId?: string;
  connectorSlug: string;
  displayName: string;
  authType: string;
  externalAccountId?: string | null;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface HostedProfile {
  id?: string;
  accountId?: string;
  profileName: string;
  oauthScopes?: string[];
  expiresAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface HostedConnectAccountInput {
  connectorSlug: string;
  displayName?: string;
  authType?: string;
  externalAccountId?: string;
  profileName?: string;
  credentials: Record<string, unknown>;
  oauthScopes?: string[];
  expiresAt?: string;
}

export interface HostedConnectAccountResponse {
  account: HostedAccount;
  profile: HostedProfile;
}

export interface HostedCredentialCheck {
  available: boolean;
}

export type HostedRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "canceled" | string;

export interface HostedRun {
  id: string;
  connector: string;
  connectorSlug?: string;
  operationName: string;
  status: HostedRunStatus;
  accountId?: string | null;
  profileName?: string | null;
  idempotencyKey?: string | null;
  requestSource?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface HostedRunPollingStatus extends HostedRun {
  terminal: boolean;
  recommendedPollAfterMs: number | null;
}

export interface HostedSubmitRunInput {
  connectorSlug: string;
  operationName: string;
  args?: string[];
  input?: Record<string, unknown>;
  accountId?: string;
  profileName?: string;
  requestedByAgentId?: string;
  idempotencyKey?: string;
  estimatedCredits?: number;
}

export interface HostedApprovalRequiredRun {
  status: "approval_required";
  approval: HostedApproval;
}

export interface HostedRunLog {
  id?: string;
  runId?: string;
  sequence?: number;
  level?: string;
  message?: string;
  createdAt?: string;
  [key: string]: unknown;
}

export interface HostedRunArtifact {
  id?: string;
  runId?: string;
  fileName?: string;
  storageProvider?: string;
  storageBucket?: string | null;
  storageKey?: string | null;
  sourceUri?: string | null;
  name?: string;
  contentType?: string;
  sizeBytes?: number;
  byteSize?: number | null;
  sha256?: string;
  url?: string;
  [key: string]: unknown;
}

export interface HostedApproval {
  id: string;
  status: "pending" | "approved" | "rejected" | "expired" | string;
  actionType: string;
  resourceType: string;
  resourceId?: string | null;
  reason?: string | null;
  requestPayload?: Record<string, unknown>;
  createdAt?: string;
  expiresAt?: string | null;
  [key: string]: unknown;
}

export interface HostedRequestApprovalInput {
  actionType: string;
  resourceType: string;
  resourceId?: string;
  reason?: string;
  requestPayload?: Record<string, unknown>;
  requestedByAgentId?: string;
  expiresAt?: string;
}

export interface HostedBillingStatus {
  customer?: Record<string, unknown> | null;
  subscription?: Record<string, unknown> | null;
  creditBalance?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface HostedBillingCustomerInput {
  email?: string;
  currency?: string;
  providerCustomerId?: string;
}

export interface HostedCheckoutSessionInput {
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  creditPackCredits?: number;
  idempotencyKey: string;
}

export interface HostedPortalSessionInput {
  returnUrl: string;
  idempotencyKey: string;
}

export interface HostedAddCreditsInput {
  amountCredits: number;
  idempotencyKey: string;
  description?: string;
}

export interface HostedUsage {
  runs: number;
  creditsUsed?: number;
  creditBalance?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface HostedQuotas {
  maxRunsPerMinute: number | null;
  spendingLimitCredits: number | null;
  creditsUsed: number;
  creditBalance?: Record<string, unknown>;
}

export interface HostedPolicy {
  connectorAllowlist?: string[];
  connectorBlocklist?: string[];
  operationAllowlist?: string[];
  operationDenylist?: string[];
  approvalRequiredOperations?: string[];
  [key: string]: unknown;
}

export interface HostedAuditTimelineEvent {
  id: string;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  outcome: string;
  code: string;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface HostedTenantMapping {
  organizationId: string;
  serviceSlug: string;
  externalOrganizationId: string;
  externalOrganizationSlug?: string | null;
  displayName?: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface HostedTenantMappingInput {
  externalOrganizationSlug?: string;
  displayName?: string;
  metadata?: Record<string, unknown>;
}

export interface HostedApiErrorPayload {
  error?: string;
  code?: string;
  [key: string]: unknown;
}

export class HostedConnectorsError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly payload: unknown;
  readonly requestId?: string;

  constructor(message: string, options: {
    status: number;
    code?: string;
    payload: unknown;
    requestId?: string;
  }) {
    super(message);
    this.name = "HostedConnectorsError";
    this.status = options.status;
    this.code = options.code;
    this.payload = options.payload;
    this.requestId = options.requestId;
  }
}

export function normalizeConnectorSlug(slug: string): string {
  let normalized = slug.trim().toLowerCase();
  if (normalized.startsWith("@hasna/")) normalized = normalized.slice("@hasna/".length);
  if (normalized.startsWith("connect-")) normalized = normalized.slice("connect-".length);
  if (!normalized) throw new Error("connector slug is required");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(normalized)) {
    throw new Error(`invalid connector slug: ${slug}`);
  }
  return normalized;
}

function normalizeOperationKey(value: string): string {
  const [connectorSlug, ...rest] = value.split(":");
  return rest.length === 0
    ? normalizeConnectorSlug(connectorSlug)
    : `${normalizeConnectorSlug(connectorSlug)}:${rest.join(":")}`;
}

function normalizePolicyConnectorLists(input: HostedPolicy): HostedPolicy {
  const copy: HostedPolicy = { ...input };
  for (const key of ["connectorAllowlist", "connectorBlocklist"] as const) {
    if (Array.isArray(copy[key])) {
      copy[key] = copy[key].map((value) =>
        typeof value === "string" ? normalizeConnectorSlug(value) : value
      );
    }
  }
  for (const key of ["operationAllowlist", "operationDenylist", "approvalRequiredOperations"] as const) {
    if (Array.isArray(copy[key])) {
      copy[key] = copy[key].map((value) =>
        typeof value === "string" ? normalizeOperationKey(value) : value
      );
    }
  }
  return copy;
}

// ── Client ─────────────────────────────────────────────────────────────────

export class LocalConnectorsClient {
  private readonly baseUrl: string;
  private readonly connectorsDir: string;

  constructor(options: ConnectorsClientOptions = {}) {
<<<<<<< Updated upstream
    this.baseUrl = (options.serverUrl ?? "http://localhost:9876").replace(/\/$/, "");
=======
    this.baseUrl = (options.serverUrl ?? "http://localhost:19426").replace(/\/$/, "");
    this.connectorsDir = options.connectorsDir ?? ".connectors";
>>>>>>> Stashed changes
  }

  private async request<T>(
    path: string,
    options?: RequestInit
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });

    const data = await res.json() as T | ApiError;

    if (!res.ok) {
      const err = data as ApiError;
      throw new Error(err.error ?? `Request failed with status ${res.status}`);
    }

    return data as T;
  }

  /**
   * List all connectors.
   * @param opts.compact - Return compact list (name, category, installed only)
   * @param opts.fields - Comma-separated list of fields to return
   */
  async list(opts: ListOptions & { compact: true }): Promise<ConnectorSummary[]>;
  async list(opts?: ListOptions): Promise<Connector[]>;
  async list(opts: ListOptions = {}): Promise<Connector[] | ConnectorSummary[]> {
    const params = new URLSearchParams();
    if (opts.compact) params.set("compact", "true");
    if (opts.fields) params.set("fields", opts.fields);
    const qs = params.toString() ? `?${params.toString()}` : "";
    return this.request<Connector[]>(`/api/connectors${qs}`);
  }

  /**
   * Get a single connector by name.
   */
  async get(name: string): Promise<Connector> {
    return this.request<Connector>(`/api/connectors/${encodeURIComponent(normalizeConnectorSlug(name))}`);
  }

  /**
   * List runnable operations for a connector.
   */
  async listOperations(name: string): Promise<ConnectorOperationsResponse> {
    name = normalizeConnectorSlug(name);
    return this.request<ConnectorOperationsResponse>(
      `/api/connectors/${encodeURIComponent(name)}/operations`
    );
  }

  /**
   * Get help text for a connector command.
   */
  async getOperationHelp(
    name: string,
    command: string
  ): Promise<ConnectorOperationHelpResponse> {
    name = normalizeConnectorSlug(name);
    return this.request<ConnectorOperationHelpResponse>(
      `/api/connectors/${encodeURIComponent(name)}/operations/${encodeURIComponent(command)}`
    );
  }

  /**
   * Get the platform-consumable connector capability manifest.
   */
  async getManifest(options: ManifestOptions = {}): Promise<ConnectorCapabilityManifest> {
    const params = new URLSearchParams();
    if (options.includeOperations) params.set("includeOperations", "true");
    if (options.connectorNames?.length) params.set("connectors", options.connectorNames.map(normalizeConnectorSlug).join(","));
    const qs = params.toString() ? `?${params.toString()}` : "";
    return this.request<ConnectorCapabilityManifest>(`/api/connectors/manifest${qs}`);
  }

  /**
   * Execute a connector command.
   */
  async runOperation(
    name: string,
    args: string[],
    options: RunOperationOptions = {}
  ): Promise<RunOperationResponse> {
    name = normalizeConnectorSlug(name);
    return this.request<RunOperationResponse>(
      `/api/connectors/${encodeURIComponent(name)}/operations/run`,
      {
        method: "POST",
        body: JSON.stringify({
          args,
          ...(options.format ? { format: options.format } : {}),
          ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
        }),
      }
    );
  }

  /**
   * Execute a structured connector operation.
   */
  async runStructuredOperation<
    TData = unknown,
    TInput extends Record<string, unknown> = Record<string, unknown>,
  >(
    name: string,
    options: StructuredRunOperationOptions<TInput>
  ): Promise<StructuredRunOperationResponse<TData>> {
    name = normalizeConnectorSlug(name);
    return this.request<StructuredRunOperationResponse<TData>>(
      `/api/connectors/${encodeURIComponent(name)}/operations/run`,
      {
        method: "POST",
        body: JSON.stringify({
          operation: options.operation,
          ...(options.input ? { input: options.input } : {}),
          ...(options.profile ? { profile: options.profile } : {}),
          ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
          ...(options.parseJson !== undefined ? { parseJson: options.parseJson } : {}),
        }),
      }
    );
  }

  /**
   * Install a connector.
   */
  async install(name: string): Promise<InstallResponse> {
    name = normalizeConnectorSlug(name);
    return this.request<InstallResponse>(`/api/connectors/${encodeURIComponent(name)}/install`, {
      method: "POST",
    });
  }

  /**
   * Uninstall a connector.
   */
  async uninstall(name: string): Promise<UninstallResponse> {
    name = normalizeConnectorSlug(name);
    return this.request<UninstallResponse>(`/api/connectors/${encodeURIComponent(name)}/uninstall`, {
      method: "POST",
    });
  }

  /**
   * Save an API key for a connector.
   * @param name - Connector name
   * @param key - The API key value
   * @param field - Optional field name (for connectors with multiple key fields)
   */
  async setKey(name: string, key: string, field?: string): Promise<SetKeyResponse> {
    name = normalizeConnectorSlug(name);
    return this.request<SetKeyResponse>(`/api/connectors/${encodeURIComponent(name)}/key`, {
      method: "POST",
      body: JSON.stringify({ key, ...(field ? { field } : {}) }),
    });
  }

  /**
   * Refresh OAuth tokens for a connector.
   */
  async refresh(name: string): Promise<RefreshResponse> {
    name = normalizeConnectorSlug(name);
    return this.request<RefreshResponse>(`/api/connectors/${encodeURIComponent(name)}/refresh`, {
      method: "POST",
    });
  }

  /**
   * Get profiles for a connector.
   */
  async getProfiles(name: string): Promise<ProfilesResponse> {
    name = normalizeConnectorSlug(name);
    return this.request<ProfilesResponse>(`/api/connectors/${encodeURIComponent(name)}/profiles`);
  }

  /**
   * Switch the active profile for a connector.
   */
  async switchProfile(name: string, profileId: string): Promise<SwitchProfileResponse> {
    name = normalizeConnectorSlug(name);
    return this.request<SwitchProfileResponse>(`/api/connectors/${encodeURIComponent(name)}/profiles/switch`, {
      method: "POST",
      body: JSON.stringify({ profile: profileId }),
    });
  }

  /**
   * Delete a profile for a connector. Cannot delete the "default" profile.
   */
  async deleteProfile(name: string, profileId: string): Promise<{ success: boolean }> {
    name = normalizeConnectorSlug(name);
    return this.request<{ success: boolean }>(
      `/api/connectors/${encodeURIComponent(name)}/profiles/${encodeURIComponent(profileId)}`,
      { method: "DELETE" }
    );
  }

  /**
   * Get the activity log.
   * @param limit - Maximum number of entries to return (client-side truncation)
   */
  async getActivity(limit?: number): Promise<ActivityEntry[]> {
    const entries = await this.request<ActivityEntry[]>("/api/activity");
    return limit !== undefined ? entries.slice(0, limit) : entries;
  }

  /**
   * Re-install all installed connectors (update from package).
   */
  async update(): Promise<UpdateResponse> {
    return this.request<UpdateResponse>("/api/update", { method: "POST" });
  }

  /**
   * Export all connector credentials.
   */
  async export(): Promise<{ connectors: Record<string, unknown>; exportedAt: string }> {
    return this.request<{ connectors: Record<string, unknown>; exportedAt: string }>("/api/export");
  }

  /**
   * Import connector credentials from backup JSON.
   */
  async import(data: { connectors: Record<string, { profiles: Record<string, unknown> }> }): Promise<{ success: boolean; imported: number }> {
    return this.request<{ success: boolean; imported: number }>("/api/import", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }
  // ── CLI Execution Methods ──────────────────────────────────────────────

  /**
   * Run a connector CLI binary and capture its output.
   * @param name - Connector name (e.g. "exa"). Binary is resolved as `{connectorsDir}/connect-{name}`.
   * @param args - Arguments to pass to the connector CLI.
   * @param options - Execution options (timeout, format, cwd).
   */
  async run(name: string, args: string[] = [], options: RunOptions = {}): Promise<RunResult> {
    const { timeout = 30_000, format, cwd } = options;
    const bin = `${this.connectorsDir}/connect-${name}`;

    const fullArgs = format ? [...args, "--format", format] : [...args];

    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);

    try {
      const { stdout, stderr } = await execFileAsync(bin, fullArgs, {
        timeout,
        cwd,
        maxBuffer: 10 * 1024 * 1024, // 10 MB
        env: { ...process.env },
      });
      const output = stdout || stderr;
      return { success: true, output: output.trimEnd(), exitCode: 0 };
    } catch (err: any) {
      const exitCode = typeof err.code === "number" ? err.code : (err.status ?? 1);
      const output = (err.stdout || err.stderr || err.message || "").trimEnd();
      return { success: false, output, exitCode };
    }
  }

  /**
   * Run a connector CLI binary and parse the output as JSON.
   * @param name - Connector name.
   * @param args - Arguments to pass to the connector CLI.
   * @param options - Execution options (timeout, cwd). Format is forced to "json".
   */
  async runJson<T = unknown>(name: string, args: string[] = [], options: Omit<RunOptions, "format"> = {}): Promise<T> {
    const result = await this.run(name, args, { ...options, format: "json" });
    if (!result.success) {
      throw new Error(`Connector "${name}" exited with code ${result.exitCode}: ${result.output}`);
    }
    try {
      return JSON.parse(result.output) as T;
    } catch {
      throw new Error(`Failed to parse JSON output from connector "${name}": ${result.output}`);
    }
  }

  /**
   * Convenience method for Exa search.
   * @param query - Search query string.
   * @param opts - Search options.
   */
  async search(query: string, opts?: { numResults?: number; type?: string }): Promise<any> {
    const args = ["search", "query", query];
    if (opts?.numResults !== undefined) {
      args.push("--num-results", String(opts.numResults));
    }
    if (opts?.type) {
      args.push("--type", opts.type);
    }
    return this.runJson("exa", args);
  }
}

export class ConnectorsClient extends LocalConnectorsClient {}

export class HostedConnectorsClient {
  private readonly apiUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: FetchLike;
  private readonly headers: Record<string, string>;

  constructor(options: HostedConnectorsClientOptions) {
    if (!options.apiUrl.trim()) throw new Error("apiUrl is required");
    this.apiUrl = options.apiUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.headers = options.headers ?? {};
  }

  async whoami(): Promise<HostedWhoamiResponse> {
    return this.request<HostedWhoamiResponse>("/auth/whoami");
  }

  async getContract(): Promise<HostedApiContract> {
    return this.request<HostedApiContract>("/contract");
  }

  async listConnectors(options: { search?: string } = {}): Promise<HostedConnectorSummary[]> {
    const query = new URLSearchParams();
    if (options.search) query.set("search", options.search);
    return this.request<HostedConnectorSummary[]>(`/connectors${query.size ? `?${query.toString()}` : ""}`);
  }

  async getConnector(connectorSlug: string): Promise<HostedConnectorSummary & Record<string, unknown>> {
    connectorSlug = normalizeConnectorSlug(connectorSlug);
    return this.request<HostedConnectorSummary & Record<string, unknown>>(`/connectors/${encodeURIComponent(connectorSlug)}`);
  }

  async getConnectorDocs(connectorSlug: string): Promise<{ connector: string; docs: ConnectorCapabilityDocs }> {
    connectorSlug = normalizeConnectorSlug(connectorSlug);
    return this.request<{ connector: string; docs: ConnectorCapabilityDocs }>(`/connectors/${encodeURIComponent(connectorSlug)}/docs`);
  }

  async getConnectorOperations(connectorSlug: string): Promise<ConnectorOperationsResponse> {
    connectorSlug = normalizeConnectorSlug(connectorSlug);
    return this.request<ConnectorOperationsResponse>(`/connectors/${encodeURIComponent(connectorSlug)}/operations`);
  }

  async getConnectorAuthUrl(
    connectorSlug: string,
    options: HostedAuthUrlOptions = {}
  ): Promise<HostedConnectorAuthUrl> {
    connectorSlug = normalizeConnectorSlug(connectorSlug);
    const query = new URLSearchParams();
    if (options.redirectUrl) query.set("redirectUrl", options.redirectUrl);
    if (options.returnUrl) query.set("returnUrl", options.returnUrl);
    if (options.profileName) query.set("profileName", options.profileName);
    if (options.scopes?.length) query.set("scopes", options.scopes.join(","));
    return this.request<HostedConnectorAuthUrl>(
      `/connectors/${encodeURIComponent(connectorSlug)}/auth-url${query.size ? `?${query.toString()}` : ""}`
    );
  }

  async listAccounts(): Promise<HostedAccount[]> {
    return this.request<HostedAccount[]>("/accounts");
  }

  async getAccountConnectionStatus(): Promise<HostedAccountConnectionStatus[]> {
    return this.request<HostedAccountConnectionStatus[]>("/accounts/status");
  }

  async connectAccount(input: HostedConnectAccountInput): Promise<HostedConnectAccountResponse> {
    return this.request<HostedConnectAccountResponse>("/accounts", {
      method: "POST",
      body: JSON.stringify({
        ...input,
        connectorSlug: normalizeConnectorSlug(input.connectorSlug),
      }),
    });
  }

  async listAccountProfiles(accountId: string): Promise<HostedProfile[]> {
    return this.request<HostedProfile[]>(`/accounts/${encodeURIComponent(accountId)}/profiles`);
  }

  async revokeAccount(accountId: string): Promise<{ account: HostedAccount; profilesRevoked: number }> {
    return this.request<{ account: HostedAccount; profilesRevoked: number }>(
      `/accounts/${encodeURIComponent(accountId)}`,
      { method: "DELETE" }
    );
  }

  async revokeAccountProfile(accountId: string, profileName: string): Promise<HostedProfile> {
    return this.request<HostedProfile>(
      `/accounts/${encodeURIComponent(accountId)}/profiles/${encodeURIComponent(profileName)}`,
      { method: "DELETE" }
    );
  }

  async checkAccountCredentials(accountId: string, profileName: string): Promise<HostedCredentialCheck> {
    return this.request<HostedCredentialCheck>(
      `/accounts/${encodeURIComponent(accountId)}/profiles/${encodeURIComponent(profileName)}/credential-check`
    );
  }

  async listRuns(): Promise<HostedRun[]> {
    return this.request<HostedRun[]>("/runs");
  }

  async submitRun(input: HostedSubmitRunInput): Promise<HostedRun | HostedApprovalRequiredRun> {
    return this.request<HostedRun | HostedApprovalRequiredRun>("/runs", {
      method: "POST",
      body: JSON.stringify({
        ...input,
        connectorSlug: normalizeConnectorSlug(input.connectorSlug),
      }),
    });
  }

  async getRun(runId: string): Promise<HostedRun> {
    return this.request<HostedRun>(`/runs/${encodeURIComponent(runId)}`);
  }

  async getRunStatus(runId: string): Promise<HostedRunPollingStatus> {
    return this.request<HostedRunPollingStatus>(`/runs/${encodeURIComponent(runId)}/status`);
  }

  async listRunLogs(runId: string): Promise<HostedRunLog[]> {
    return this.request<HostedRunLog[]>(`/runs/${encodeURIComponent(runId)}/logs`);
  }

  async listRunArtifacts(runId: string): Promise<HostedRunArtifact[]> {
    return this.request<HostedRunArtifact[]>(`/runs/${encodeURIComponent(runId)}/artifacts`);
  }

  async listApprovals(): Promise<HostedApproval[]> {
    return this.request<HostedApproval[]>("/approvals");
  }

  async requestApproval(input: HostedRequestApprovalInput): Promise<HostedApproval> {
    return this.request<HostedApproval>("/approvals", {
      method: "POST",
      body: JSON.stringify(normalizeHostedApprovalInput(input)),
    });
  }

  async decideApproval(id: string, decision: "approve" | "reject"): Promise<HostedApproval> {
    return this.request<HostedApproval>(`/approvals/${encodeURIComponent(id)}/${decision}`, {
      method: "POST",
    });
  }

  async getBillingStatus(): Promise<HostedBillingStatus> {
    return this.request<HostedBillingStatus>("/billing/status");
  }

  async createBillingCustomer(input: HostedBillingCustomerInput): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("/billing/customers", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async createCheckoutSession(input: HostedCheckoutSessionInput): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("/billing/checkout", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async createBillingPortalSession(input: HostedPortalSessionInput): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("/billing/portal", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async addBillingCredits(input: HostedAddCreditsInput): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("/billing/credits", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async listBillingTransactions(): Promise<Array<Record<string, unknown>>> {
    return this.request<Array<Record<string, unknown>>>("/billing/transactions");
  }

  async listBillingInvoices(): Promise<Array<Record<string, unknown>>> {
    return this.request<Array<Record<string, unknown>>>("/billing/invoices");
  }

  async getUsage(): Promise<HostedUsage> {
    return this.request<HostedUsage>("/usage");
  }

  async getQuotas(): Promise<HostedQuotas> {
    return this.request<HostedQuotas>("/quotas");
  }

  async getPolicy(): Promise<HostedPolicy> {
    return this.request<HostedPolicy>("/policy");
  }

  async updatePolicy(input: HostedPolicy): Promise<HostedPolicy> {
    return this.request<HostedPolicy>("/policy", {
      method: "PUT",
      body: JSON.stringify(normalizePolicyConnectorLists(input)),
    });
  }

  async emergencyRevokePolicy(input: { reason?: string } = {}): Promise<HostedPolicy> {
    return this.request<HostedPolicy>("/policy/emergency-revoke", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async emergencyRestorePolicy(): Promise<HostedPolicy> {
    return this.request<HostedPolicy>("/policy/emergency-restore", {
      method: "POST",
      body: JSON.stringify({}),
    });
  }

  async listAuditTimeline(): Promise<HostedAuditTimelineEvent[]> {
    return this.request<HostedAuditTimelineEvent[]>("/audit-timeline");
  }

  async listTenantMappings(): Promise<HostedTenantMapping[]> {
    return this.request<HostedTenantMapping[]>("/tenant-mappings");
  }

  async upsertTenantMapping(
    serviceSlug: string,
    externalOrganizationId: string,
    input: HostedTenantMappingInput = {}
  ): Promise<HostedTenantMapping> {
    return this.request<HostedTenantMapping>(
      `/tenant-mappings/${encodeURIComponent(serviceSlug)}/${encodeURIComponent(externalOrganizationId)}`,
      {
        method: "PUT",
        body: JSON.stringify(input),
      }
    );
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.headers,
      ...(init.headers as Record<string, string> | undefined),
    };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    const response = await this.fetchImpl(`${this.apiUrl}/api/v1${path}`, {
      ...init,
      headers,
    });
    const payload = await readResponsePayload(response);

    if (!response.ok) {
      const errorPayload = isRecord(payload) ? payload as HostedApiErrorPayload : {};
      throw new HostedConnectorsError(
        typeof errorPayload.error === "string"
          ? errorPayload.error
          : `request failed with status ${response.status}`,
        {
          status: response.status,
          code: typeof errorPayload.code === "string" ? errorPayload.code : undefined,
          payload,
          requestId: response.headers.get("x-request-id") ?? undefined,
        }
      );
    }

    return payload as T;
  }
}

function normalizeHostedApprovalInput(input: HostedRequestApprovalInput): HostedRequestApprovalInput {
  const requestPayload = input.requestPayload && typeof input.requestPayload.connectorSlug === "string"
    ? {
        ...input.requestPayload,
        connectorSlug: normalizeConnectorSlug(input.requestPayload.connectorSlug),
      }
    : input.requestPayload;
  return {
    ...input,
    resourceId: input.resourceId ? normalizeOperationKey(input.resourceId) : undefined,
    requestPayload,
  };
}

async function readResponsePayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export default ConnectorsClient;
