import type {
  ProjectRegistrationAuthorities,
  ProjectRegistrationAuthorityAdapter,
  ProjectRegistrationAuthorityCapability,
  ProjectRegistrationAuthorityInverseVerification,
  ProjectRegistrationAuthorityLookupRequest,
  ProjectRegistrationAuthorityLookupResult,
  ProjectRegistrationAuthorityName,
  ProjectRegistrationAuthorityReceipt,
  ProjectRegistrationAuthorityRecord,
  ProjectRegistrationAuthorityRequest,
  ProjectRegistrationAuthorityTransport,
  ProjectRegistrationGuardedProjectReceiptLookupRequest,
  ProjectRegistrationGuardedProjectRollbackRequest,
  ProjectRegistrationGuardedProjectUpdateRequest,
  ProjectRegistrationGuardedProjectUpdateResult,
  ProjectRegistrationResourceKind,
} from "./project-registration.js";

type AuthorityEnvironment = Record<string, string | undefined>;
type AuthorityModuleImporter = (specifier: string) => Promise<unknown>;

export interface ProductionProjectRegistrationAuthorityOptions {
  env?: AuthorityEnvironment;
  fetch?: typeof globalThis.fetch;
  importModule?: AuthorityModuleImporter;
}

interface AuthorityEndpointConfig {
  authority: ProjectRegistrationAuthorityName;
  apiUrlKeys: readonly string[];
  apiKeyKeys: readonly string[];
  dbPathKeys: readonly string[];
}

interface ShippedConversationsClient {
  getChannel(name: string): Promise<Record<string, unknown> | null>;
  getProjectChannelRegistrationCapability(): Promise<Record<string, unknown>>;
  registerProjectChannel(body: Record<string, unknown>): Promise<Record<string, unknown>>;
  adoptExistingProjectChannel?(body: Record<string, unknown>): Promise<Record<string, unknown>>;
  readProjectChannelRegistrationExact(
    id: string,
    query: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  lookupProjectChannelRegistrationReceipt(
    query: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  compensateProjectChannelRegistration(body: Record<string, unknown>): Promise<Record<string, unknown>>;
  verifyProjectChannelRegistrationInverse(body: Record<string, unknown>): Promise<Record<string, unknown>>;
}

const AUTHORITY_ENDPOINTS: Record<ProjectRegistrationAuthorityName, AuthorityEndpointConfig> = {
  todos: {
    authority: "todos",
    apiUrlKeys: ["HASNA_TODOS_API_URL", "TODOS_API_URL"],
    apiKeyKeys: ["HASNA_TODOS_API_KEY", "TODOS_API_KEY"],
    dbPathKeys: ["HASNA_TODOS_DB_PATH", "TODOS_DB_PATH"],
  },
  mementos: {
    authority: "mementos",
    apiUrlKeys: ["HASNA_MEMENTOS_API_URL", "MEMENTOS_API_URL"],
    apiKeyKeys: ["HASNA_MEMENTOS_API_KEY", "MEMENTOS_API_KEY"],
    dbPathKeys: ["HASNA_MEMENTOS_DB_PATH", "MEMENTOS_DB_PATH"],
  },
  conversations: {
    authority: "conversations",
    apiUrlKeys: ["HASNA_CONVERSATIONS_API_URL", "CONVERSATIONS_API_URL"],
    apiKeyKeys: ["HASNA_CONVERSATIONS_API_KEY", "CONVERSATIONS_API_KEY"],
    dbPathKeys: ["HASNA_CONVERSATIONS_DB_PATH", "CONVERSATIONS_DB_PATH"],
  },
};

function firstConfigured(
  env: AuthorityEnvironment,
  keys: readonly string[],
): { key: string; value: string } | null {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return { key, value };
  }
  return null;
}

/**
 * Normalize a configured authority base URL to the root the shipped HTTP
 * clients append `/v1/...` to.
 *
 * The gateway addresses each app as `https://api.hasna.com/<app>/v1/...`
 * (hasna/apps#1512), so an operator may configure `https://host`,
 * `https://host/v1`, `https://api.hasna.com/todos` or
 * `https://api.hasna.com/todos/v1`. The path prefix must SURVIVE: returning
 * `url.origin` here was the hasna/apps#1601 defect — it silently dropped
 * `/todos` and the authority could never be reached through the gateway. A
 * base that already carries `/v1` has it folded off exactly once, because the
 * clients add their own `/v1` route prefix.
 *
 * TODO(hasna/apps#1601): replace this with the shared base-URL join helper
 * from `@hasna/contracts` once that release lands and this package's pin is
 * bumped; the semantics here are intentionally identical to it.
 */
function authorityRoot(raw: string, sourceKey: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${sourceKey} must be an absolute http(s) URL`);
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`${sourceKey} must be an absolute http(s) URL`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${sourceKey} must not contain userinfo, query, or fragment data`);
  }
  const pathname = url.pathname.replace(/\/+$/, "");
  const prefix = pathname === "/v1" ? "" : pathname.replace(/\/v1$/, "");
  return `${url.origin}${prefix}`;
}

function authorityHttpConfig(
  config: AuthorityEndpointConfig,
  env: AuthorityEnvironment,
): { baseUrl: string; apiKey: string } | null {
  const localDatabase = firstConfigured(env, config.dbPathKeys);
  if (localDatabase) return null;
  const url = firstConfigured(env, config.apiUrlKeys);
  const key = firstConfigured(env, config.apiKeyKeys);
  if (!url && !key) {
    throw new Error(
      `${config.authority} project registration requires ${config.apiUrlKeys[0]} `
      + `or an explicit ${config.dbPathKeys[0]}`,
    );
  }
  if (!url) {
    throw new Error(`${config.apiUrlKeys[0]} is required when ${key!.key} is configured`);
  }
  if (!key) {
    throw new Error(`${config.apiKeyKeys[0]} is required when ${url.key} is configured`);
  }
  return {
    baseUrl: authorityRoot(url.value, url.key),
    apiKey: key.value,
  };
}

function moduleObject(value: unknown, packageName: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${packageName} did not load as an ES module`);
  }
  return value as Record<string, unknown>;
}

function responseObject(
  authority: ProjectRegistrationAuthorityName,
  value: unknown,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${authority} project registration returned a non-object response`);
  }
  return value as Record<string, unknown>;
}

function selectedResponse<T>(
  authority: ProjectRegistrationAuthorityName,
  value: unknown,
  key?: string,
): T {
  const body = responseObject(authority, value);
  return (key && key in body ? body[key] : body) as T;
}

function withoutTarget(request: ProjectRegistrationAuthorityRequest): Record<string, unknown> {
  const { target: _target, ...serializable } = request;
  return serializable;
}

function withTargetDigest(request: ProjectRegistrationAuthorityRequest): Record<string, unknown> {
  return {
    ...withoutTarget(request),
    target_digest: request.target.digest,
  };
}

function assertAdapter(
  authority: ProjectRegistrationAuthorityName,
  value: unknown,
): ProjectRegistrationAuthorityAdapter {
  if (
    !value
    || typeof value !== "object"
    || (value as { authority?: unknown }).authority !== authority
  ) {
    throw new Error(`${authority} package did not return its project registration authority`);
  }
  return value as ProjectRegistrationAuthorityAdapter;
}

class ConversationsSdkAuthority implements ProjectRegistrationAuthorityAdapter {
  readonly authority = "conversations" as const;

  constructor(private readonly client: ShippedConversationsClient) {}

  async capability(): Promise<ProjectRegistrationAuthorityCapability> {
    return selectedResponse(
      this.authority,
      await this.client.getProjectChannelRegistrationCapability(),
    );
  }

  async create(request: ProjectRegistrationAuthorityRequest): Promise<ProjectRegistrationAuthorityReceipt> {
    if (request.operation_intent === "adopt_existing") {
      if (!this.client.adoptExistingProjectChannel) {
        throw new Error("Conversations SDK does not expose adoptExistingProjectChannel");
      }
      return selectedResponse(
        this.authority,
        await this.client.adoptExistingProjectChannel(withTargetDigest(request)),
      );
    }
    return selectedResponse(
      this.authority,
      await this.client.registerProjectChannel(withTargetDigest(request)),
    );
  }

  async readExact(request: {
    resource_kind: ProjectRegistrationResourceKind;
    target_id: string;
    target: ProjectRegistrationAuthorityRequest["target"];
    response_byte_limit: number;
    time_budget_ms: number;
  }): Promise<ProjectRegistrationAuthorityRecord> {
    return selectedResponse(
      this.authority,
      await this.client.readProjectChannelRegistrationExact(request.target_id, {
        resource_kind: request.resource_kind,
        target_digest: request.target.digest,
        response_byte_limit: request.response_byte_limit,
        time_budget_ms: request.time_budget_ms,
        call_limit: 1,
      }),
    );
  }

  async lookupReceipt(
    request: ProjectRegistrationAuthorityLookupRequest,
  ): Promise<ProjectRegistrationAuthorityLookupResult> {
    return selectedResponse(
      this.authority,
      await this.client.lookupProjectChannelRegistrationReceipt({
        ...request,
        call_limit: 1,
      }),
    );
  }

  async validateExistingAdoption(
    request: ProjectRegistrationAuthorityRequest,
    receipt: ProjectRegistrationAuthorityReceipt,
  ): Promise<boolean> {
    if (request.resource_kind !== "channel" || typeof request.desired.channel !== "string") return false;
    const response = await this.client.getChannel(request.desired.channel);
    if (!response) return false;
    const nestedChannel = response.channel;
    const channel = nestedChannel
      && typeof nestedChannel === "object"
      && !Array.isArray(nestedChannel)
      ? nestedChannel as Record<string, unknown>
      : response;
    return channel.id === receipt.target_id
      && channel.name === request.desired.channel
      && (channel.project_id === null || channel.project_id === request.project_id);
  }

  async compensate(request: ProjectRegistrationAuthorityRequest): Promise<ProjectRegistrationAuthorityReceipt> {
    return selectedResponse(
      this.authority,
      await this.client.compensateProjectChannelRegistration(withTargetDigest(request)),
    );
  }

  async verifyInverse(
    request: ProjectRegistrationAuthorityRequest,
  ): Promise<ProjectRegistrationAuthorityInverseVerification> {
    return selectedResponse(
      this.authority,
      await this.client.verifyProjectChannelRegistrationInverse(withTargetDigest(request)),
    );
  }
}

async function loadHttpAuthority(
  authority: ProjectRegistrationAuthorityName,
  http: { baseUrl: string; apiKey: string },
  fetchImpl: typeof globalThis.fetch,
  importModule: AuthorityModuleImporter,
): Promise<ProjectRegistrationAuthorityAdapter> {
  if (authority === "todos") {
    const specifier = "@hasna/todos/project-registration";
    const module = moduleObject(await importModule(specifier), specifier);
    const createClient = module.createTodosProjectRegistrationHttpClient;
    if (typeof createClient !== "function") {
      throw new Error(`${specifier} does not expose createTodosProjectRegistrationHttpClient`);
    }
    return assertAdapter(authority, createClient({
      baseUrl: http.baseUrl,
      apiKey: http.apiKey,
      fetch: fetchImpl,
    }));
  }
  if (authority === "mementos") {
    const specifier = "@hasna/mementos/project-registration";
    const module = moduleObject(await importModule(specifier), specifier);
    const createClient = module.createMementosProjectRegistrationHttpClient;
    if (typeof createClient !== "function") {
      throw new Error(`${specifier} does not expose createMementosProjectRegistrationHttpClient`);
    }
    return assertAdapter(authority, createClient({
      baseUrl: http.baseUrl,
      apiKey: http.apiKey,
      fetch: fetchImpl,
    }));
  }
  const specifier = "@hasna/conversations/sdk";
  const module = moduleObject(await importModule(specifier), specifier);
  const ConversationsClient = module.ConversationsClient;
  if (typeof ConversationsClient !== "function") {
    throw new Error(`${specifier} does not expose ConversationsClient`);
  }
  const client = new (ConversationsClient as new (options: {
    baseUrl: string;
    apiKey: string;
    fetch: typeof globalThis.fetch;
  }) => ShippedConversationsClient)({
    baseUrl: http.baseUrl,
    apiKey: http.apiKey,
    fetch: fetchImpl,
  });
  return new ConversationsSdkAuthority(client);
}

async function loadLocalAuthority(
  authority: ProjectRegistrationAuthorityName,
  importModule: AuthorityModuleImporter,
): Promise<ProjectRegistrationAuthorityAdapter> {
  if (authority === "todos") {
    const specifier = "@hasna/todos";
    const module = moduleObject(await importModule(specifier), specifier);
    const getDatabase = module.getDatabase;
    const createAuthority = module.createLocalTodosProjectRegistrationAuthority;
    if (typeof getDatabase !== "function" || typeof createAuthority !== "function") {
      throw new Error(`${specifier} does not expose the shipped local project registration authority`);
    }
    return assertAdapter(authority, createAuthority(getDatabase()));
  }
  if (authority === "mementos") {
    const specifier = "@hasna/mementos";
    const module = moduleObject(await importModule(specifier), specifier);
    const getDatabase = module.getDatabase;
    const createAuthority = module.createLocalMementosProjectRegistrationAuthority;
    if (typeof getDatabase !== "function" || typeof createAuthority !== "function") {
      throw new Error(`${specifier} does not expose the shipped local project registration authority`);
    }
    return assertAdapter(authority, createAuthority(getDatabase()));
  }
  const specifier = "@hasna/conversations";
  const module = moduleObject(await importModule(specifier), specifier);
  const createAuthority = module.createProjectChannelRegistrationAuthority;
  if (typeof createAuthority !== "function") {
    throw new Error(`${specifier} does not expose the shipped project channel registration authority`);
  }
  return assertAdapter(authority, createAuthority());
}

class LazyProjectRegistrationAuthority implements ProjectRegistrationAuthorityAdapter {
  readonly authority: ProjectRegistrationAuthorityName;
  readonly transport?: ProjectRegistrationAuthorityTransport;
  private delegate: Promise<ProjectRegistrationAuthorityAdapter> | null = null;

  constructor(
    authority: ProjectRegistrationAuthorityName,
    transport: ProjectRegistrationAuthorityTransport | undefined,
    private readonly load: () => Promise<ProjectRegistrationAuthorityAdapter>,
  ) {
    this.authority = authority;
    this.transport = transport;
  }

  private resolve(): Promise<ProjectRegistrationAuthorityAdapter> {
    this.delegate ??= this.load();
    return this.delegate;
  }

  async capability(): Promise<ProjectRegistrationAuthorityCapability> {
    return (await this.resolve()).capability();
  }

  async create(request: ProjectRegistrationAuthorityRequest): Promise<ProjectRegistrationAuthorityReceipt> {
    return (await this.resolve()).create(request);
  }

  async readExact(request: {
    resource_kind: ProjectRegistrationResourceKind;
    target_id: string;
    target: ProjectRegistrationAuthorityRequest["target"];
    response_byte_limit: number;
    time_budget_ms: number;
  }): Promise<ProjectRegistrationAuthorityRecord> {
    return (await this.resolve()).readExact(request);
  }

  async lookupReceipt(
    request: ProjectRegistrationAuthorityLookupRequest,
  ): Promise<ProjectRegistrationAuthorityLookupResult> {
    return (await this.resolve()).lookupReceipt(request);
  }

  async validateExistingAdoption(
    request: ProjectRegistrationAuthorityRequest,
    receipt: ProjectRegistrationAuthorityReceipt,
  ): Promise<boolean> {
    const delegate = await this.resolve();
    return delegate.validateExistingAdoption?.(request, receipt) ?? false;
  }

  async validatePriorRegistrationAdoption(
    sourceRequest: ProjectRegistrationAuthorityRequest,
    sourceReceipt: ProjectRegistrationAuthorityReceipt,
    currentRecord: ProjectRegistrationAuthorityRecord,
  ): Promise<boolean> {
    const delegate = await this.resolve();
    return delegate.validatePriorRegistrationAdoption?.(
      sourceRequest,
      sourceReceipt,
      currentRecord,
    ) ?? false;
  }

  async compensate(request: ProjectRegistrationAuthorityRequest): Promise<ProjectRegistrationAuthorityReceipt> {
    return (await this.resolve()).compensate(request);
  }

  async verifyInverse(
    request: ProjectRegistrationAuthorityRequest,
  ): Promise<ProjectRegistrationAuthorityInverseVerification> {
    return (await this.resolve()).verifyInverse(request);
  }

  async guardedUpdateProject(
    targetId: string,
    request: ProjectRegistrationGuardedProjectUpdateRequest,
  ): Promise<ProjectRegistrationGuardedProjectUpdateResult> {
    const delegate = await this.resolve();
    if (!delegate.guardedUpdateProject) {
      throw new Error(`${this.authority} package does not expose guardedUpdateProject`);
    }
    return delegate.guardedUpdateProject(targetId, request);
  }

  async getGuardedProjectUpdateReceipt(
    targetId: string,
    receiptId: string,
    request: ProjectRegistrationGuardedProjectReceiptLookupRequest,
  ) {
    const delegate = await this.resolve();
    if (!delegate.getGuardedProjectUpdateReceipt) {
      throw new Error(`${this.authority} package does not expose getGuardedProjectUpdateReceipt`);
    }
    return delegate.getGuardedProjectUpdateReceipt(targetId, receiptId, request);
  }

  async rollbackGuardedProjectUpdate(
    targetId: string,
    request: ProjectRegistrationGuardedProjectRollbackRequest,
  ): Promise<ProjectRegistrationGuardedProjectUpdateResult> {
    const delegate = await this.resolve();
    if (!delegate.rollbackGuardedProjectUpdate) {
      throw new Error(`${this.authority} package does not expose rollbackGuardedProjectUpdate`);
    }
    return delegate.rollbackGuardedProjectUpdate(targetId, request);
  }
}

function configuredAuthority(
  authority: ProjectRegistrationAuthorityName,
  options: Required<ProductionProjectRegistrationAuthorityOptions>,
): ProjectRegistrationAuthorityAdapter {
  const config = AUTHORITY_ENDPOINTS[authority];
  const transport = firstConfigured(options.env, config.dbPathKeys)
    ? "local"
    : firstConfigured(options.env, [...config.apiUrlKeys, ...config.apiKeyKeys])
      ? "api"
      : undefined;
  return new LazyProjectRegistrationAuthority(authority, transport, async () => {
    const http = authorityHttpConfig(config, options.env);
    return http
      ? loadHttpAuthority(authority, http, options.fetch, options.importModule)
      : loadLocalAuthority(authority, options.importModule);
  });
}

export function productionProjectRegistrationAuthorities(
  options: ProductionProjectRegistrationAuthorityOptions = {},
): ProjectRegistrationAuthorities {
  const resolved: Required<ProductionProjectRegistrationAuthorityOptions> = {
    env: options.env ?? process.env,
    fetch: options.fetch ?? globalThis.fetch,
    importModule: options.importModule ?? ((specifier) => import(specifier)),
  };
  return {
    todos: configuredAuthority("todos", resolved),
    mementos: configuredAuthority("mementos", resolved),
    conversations: configuredAuthority("conversations", resolved),
  };
}
