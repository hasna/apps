import { existsSync, readFileSync } from "node:fs";
import { basename, resolve, sep } from "node:path";
import type {
  CatchUpPolicy,
  CreateLoopInput,
  GoalSpec,
  LoopMachineRef,
  LoopTarget,
  OverlapPolicy,
  ScheduleSpec,
} from "../types.js";

export interface OpenReposSelector {
  orgs?: string[];
  repos?: string[];
  packageScopes?: string[];
  languages?: string[];
  paths?: string[];
  tags?: string[];
  query?: string;
  limit?: number;
}

export interface OpenReposSdk {
  listRepos: (opts?: { org?: string; query?: string; limit?: number; offset?: number }) => unknown[];
  getRepo?: (idOrPath: string | number) => unknown;
  listTags?: (opts?: { repo_id?: number; limit?: number; offset?: number }) => unknown[];
}

export interface OpenReposLoopRepo {
  id: string;
  numericId?: number;
  name: string;
  fullName: string;
  path: string;
  org?: string;
  remoteUrl?: string;
  defaultBranch?: string;
  description?: string;
  language?: string;
  packageName?: string;
  packageScope?: string;
  tags: string[];
}

export interface DiscoverOpenReposResult {
  repos: OpenReposLoopRepo[];
  warnings: string[];
  source: "open-repos";
}

export interface RepoLoopContext {
  group: string;
  kind: "command" | "agent" | "workflow";
  repo: OpenReposLoopRepo;
  maxConcurrency: number;
  memoryLimitMb: number;
}

export interface RepoLoopPlanEntry {
  repo: OpenReposLoopRepo;
  input: CreateLoopInput;
  env: Record<string, string>;
}

export interface MultiRepoLoopPlan {
  group: string;
  kind: RepoLoopContext["kind"];
  maxConcurrency: number;
  memoryLimitMb: number;
  scheduling: {
    mode: "per-repo-loops";
    defaultSequential: boolean;
    description: string;
  };
  loops: RepoLoopPlanEntry[];
  warnings: string[];
}

export interface MultiRepoLoopPlanOptions {
  group: string;
  kind: RepoLoopContext["kind"];
  repos: OpenReposLoopRepo[];
  schedule: ScheduleSpec;
  targetForRepo: (repo: OpenReposLoopRepo, env: Record<string, string>) => LoopTarget;
  description?: string;
  nameTemplate?: string;
  maxConcurrency?: number;
  memoryLimitMb?: number;
  goal?: GoalSpec;
  machine?: LoopMachineRef;
  policy?: {
    catchUp?: CatchUpPolicy;
    catchUpLimit?: number;
    overlap?: OverlapPolicy;
    maxAttempts?: number;
    retryDelayMs?: number;
    leaseMs?: number;
    expiresAt?: string;
  };
  warnings?: string[];
}

const DEFAULT_PAGE_SIZE = 500;
const DEFAULT_REPO_LIMIT = 5_000;
export const DEFAULT_OPEN_REPOS_LOOP_NAME_TEMPLATE = "repo:{kind}:{group}:{repo}";
export const DEFAULT_OPEN_REPOS_MEMORY_LIMIT_MB = 2_048;

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function stringField(value: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const raw = value[key];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
  }
  return undefined;
}

function arrayField(value: Record<string, unknown>, ...keys: string[]): string[] {
  for (const key of keys) {
    const raw = value[key];
    if (Array.isArray(raw)) return raw.filter((entry): entry is string => typeof entry === "string");
  }
  return [];
}

function numericId(value: Record<string, unknown>): number | undefined {
  const raw = value["id"];
  if (typeof raw === "number" && Number.isInteger(raw)) return raw;
  if (typeof raw === "string") {
    const parsed = Number(raw);
    if (Number.isInteger(parsed)) return parsed;
  }
  return undefined;
}

function normalizedList(values: string[] | undefined): string[] {
  return (values ?? []).map((value) => value.trim()).filter(Boolean);
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

function sameToken(a: string | undefined, b: string): boolean {
  return normalizeToken(a ?? "") === normalizeToken(b);
}

function includesToken(values: string[], value: string | undefined): boolean {
  return Boolean(value) && values.some((entry) => sameToken(value, entry));
}

function parsePackage(repoPath: string): { name?: string; scope?: string } {
  const file = `${repoPath}/package.json`;
  if (!existsSync(file)) return {};
  try {
    const body = JSON.parse(readFileSync(file, "utf8")) as { name?: unknown };
    if (typeof body.name !== "string" || !body.name.trim()) return {};
    const name = body.name.trim();
    const scope = name.startsWith("@") && name.includes("/") ? name.slice(0, name.indexOf("/")) : undefined;
    return { name, scope };
  } catch {
    return {};
  }
}

function detectLanguage(repoPath: string, raw: Record<string, unknown>): string | undefined {
  const fromSdk = stringField(raw, "language", "primaryLanguage");
  if (fromSdk) return fromSdk;
  if (existsSync(`${repoPath}/tsconfig.json`)) return "TypeScript";
  if (existsSync(`${repoPath}/package.json`)) return "JavaScript";
  if (existsSync(`${repoPath}/pyproject.toml`) || existsSync(`${repoPath}/setup.py`)) return "Python";
  if (existsSync(`${repoPath}/Cargo.toml`)) return "Rust";
  if (existsSync(`${repoPath}/go.mod`)) return "Go";
  if (existsSync(`${repoPath}/Gemfile`)) return "Ruby";
  if (existsSync(`${repoPath}/composer.json`)) return "PHP";
  if (existsSync(`${repoPath}/pom.xml`) || existsSync(`${repoPath}/build.gradle`)) return "Java";
  return undefined;
}

function sdkTags(raw: Record<string, unknown>, sdk: OpenReposSdk): string[] {
  const fromRepo = arrayField(raw, "tags", "topics");
  if (fromRepo.length > 0) return fromRepo;
  const id = numericId(raw);
  if (!id || !sdk.listTags) return [];
  try {
    return sdk
      .listTags({ repo_id: id, limit: 1_000 })
      .map((tag) => asObject(tag))
      .map((tag) => (tag ? stringField(tag, "name") : undefined))
      .filter((tag): tag is string => Boolean(tag));
  } catch {
    return [];
  }
}

function normalizeRepo(rawValue: unknown, sdk: OpenReposSdk): OpenReposLoopRepo | undefined {
  const raw = asObject(rawValue);
  if (!raw) return undefined;
  const path = stringField(raw, "path", "localPath", "repo_path");
  const name = stringField(raw, "name", "repo_name") ?? (path ? basename(path) : undefined);
  if (!path || !name) return undefined;
  const org = stringField(raw, "org", "owner", "organization") ?? undefined;
  const pkg = parsePackage(path);
  const id = stringField(raw, "id") ?? String(numericId(raw) ?? path);
  const tags = sdkTags(raw, sdk);
  return {
    id,
    numericId: numericId(raw),
    name,
    fullName: org ? `${org}/${name}` : name,
    path,
    org,
    remoteUrl: stringField(raw, "remote_url", "remoteUrl"),
    defaultBranch: stringField(raw, "default_branch", "defaultBranch"),
    description: stringField(raw, "description"),
    language: detectLanguage(path, raw),
    packageName: pkg.name,
    packageScope: pkg.scope,
    tags,
  };
}

async function loadDefaultOpenReposSdk(): Promise<OpenReposSdk> {
  try {
    const mod = await import("@hasna/repos");
    const sdk = mod as unknown as OpenReposSdk;
    if (typeof sdk.listRepos !== "function") throw new Error("missing listRepos export");
    return sdk;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`could not load @hasna/repos SDK: ${detail}`);
  }
}

function pathMatches(repoPath: string, selector: string): boolean {
  const resolved = resolve(selector);
  const normalizedRepo = resolve(repoPath);
  return normalizedRepo === resolved || normalizedRepo.startsWith(`${resolved}${sep}`);
}

function repoMatchesName(repo: OpenReposLoopRepo, selector: string): boolean {
  return [repo.id, repo.name, repo.fullName, repo.path, repo.remoteUrl]
    .filter((value): value is string => Boolean(value))
    .some((value) => sameToken(value, selector));
}

function repoMatchesQuery(repo: OpenReposLoopRepo, query: string): boolean {
  const needle = normalizeToken(query);
  return [
    repo.name,
    repo.fullName,
    repo.path,
    repo.org,
    repo.remoteUrl,
    repo.description,
    repo.packageName,
    repo.packageScope,
    repo.language,
    ...repo.tags,
  ]
    .filter((value): value is string => Boolean(value))
    .some((value) => normalizeToken(value).includes(needle));
}

function repoMatchesSelector(repo: OpenReposLoopRepo, selector: OpenReposSelector): boolean {
  const orgs = normalizedList(selector.orgs);
  const repos = normalizedList(selector.repos);
  const packageScopes = normalizedList(selector.packageScopes).map((scope) => (scope.startsWith("@") ? scope : `@${scope}`));
  const languages = normalizedList(selector.languages);
  const paths = normalizedList(selector.paths);
  const tags = normalizedList(selector.tags);
  const query = selector.query?.trim();
  const hasSelector =
    orgs.length + repos.length + packageScopes.length + languages.length + paths.length + tags.length > 0 || Boolean(query);
  if (!hasSelector) return false;
  if (orgs.length > 0 && !includesToken(orgs, repo.org)) return false;
  if (repos.length > 0 && !repos.some((repoSelector) => repoMatchesName(repo, repoSelector))) return false;
  if (packageScopes.length > 0 && !includesToken(packageScopes, repo.packageScope)) return false;
  if (languages.length > 0 && !includesToken(languages, repo.language)) return false;
  if (paths.length > 0 && !paths.some((path) => pathMatches(repo.path, path))) return false;
  if (tags.length > 0 && !tags.every((tag) => includesToken(repo.tags, tag))) return false;
  if (query && !repoMatchesQuery(repo, query)) return false;
  return true;
}

export async function discoverOpenRepos(
  selector: OpenReposSelector,
  deps: { sdk?: OpenReposSdk } = {},
): Promise<DiscoverOpenReposResult> {
  const sdk = deps.sdk ?? (await loadDefaultOpenReposSdk());
  const warnings: string[] = [];
  const selectedLimit = Math.max(1, selector.limit ?? DEFAULT_REPO_LIMIT);
  const fetchLimit = DEFAULT_REPO_LIMIT;
  const sdkOrg = selector.orgs?.length === 1 ? selector.orgs[0] : undefined;
  const sdkQuery = selector.query?.trim() || undefined;
  const repos: OpenReposLoopRepo[] = [];
  const seen = new Set<string>();
  let offset = 0;
  let fetched = 0;
  while (repos.length < selectedLimit && fetched < fetchLimit) {
    const limit = Math.min(DEFAULT_PAGE_SIZE, fetchLimit - fetched);
    const page = sdk.listRepos({ org: sdkOrg, query: sdkQuery, limit, offset });
    fetched += page.length;
    offset += page.length;
    for (const raw of page) {
      const repo = normalizeRepo(raw, sdk);
      if (!repo || !repoMatchesSelector(repo, selector)) continue;
      const key = `${repo.id}:${repo.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      repos.push(repo);
      if (repos.length >= selectedLimit) break;
    }
    if (page.length < limit) break;
  }
  if (normalizedList(selector.languages).length > 0) {
    warnings.push("language selection uses SDK language fields when present and local file inference otherwise");
  }
  if (normalizedList(selector.packageScopes).length > 0) {
    warnings.push("package-scope selection is inferred from local package.json names until open-repos exposes package metadata");
  }
  if (normalizedList(selector.tags).length > 0) {
    warnings.push("tag selection uses SDK repo tags/topics when present and falls back to indexed git tags");
  }
  return { repos, warnings, source: "open-repos" };
}

export function positiveInt(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved <= 0) throw new Error(`${label} must be a positive integer`);
  return resolved;
}

function nameToken(value: string | undefined, fallback = "unknown"): string {
  return (value || fallback)
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || fallback;
}

function templateContext(ctx: RepoLoopContext, sanitize: boolean): Record<string, string> {
  const value = (input: string | undefined, fallback?: string) => (sanitize ? nameToken(input, fallback) : input ?? fallback ?? "");
  return {
    group: value(ctx.group, "group"),
    kind: value(ctx.kind),
    repo: value(ctx.repo.name, "repo"),
    repoName: value(ctx.repo.name, "repo"),
    repoPath: sanitize ? value(ctx.repo.path, "repo") : ctx.repo.path,
    org: value(ctx.repo.org, "local"),
    fullName: value(ctx.repo.fullName, "repo"),
    packageName: value(ctx.repo.packageName, ""),
    packageScope: value(ctx.repo.packageScope, ""),
    language: value(ctx.repo.language, ""),
  };
}

export function renderRepoTemplate(template: string, ctx: RepoLoopContext, opts: { sanitize?: boolean } = {}): string {
  const values = templateContext(ctx, Boolean(opts.sanitize));
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (match, key: string) => values[key] ?? match);
}

export function repoLoopEnv(ctx: RepoLoopContext): Record<string, string> {
  const env: Record<string, string> = {
    OPENLOOPS_GROUP: ctx.group,
    OPENLOOPS_REPO_ID: ctx.repo.id,
    OPENLOOPS_REPO_NAME: ctx.repo.name,
    OPENLOOPS_REPO_FULL_NAME: ctx.repo.fullName,
    OPENLOOPS_REPO_PATH: ctx.repo.path,
    OPENLOOPS_MAX_CONCURRENCY: String(ctx.maxConcurrency),
    OPENLOOPS_MEMORY_LIMIT_MB: String(ctx.memoryLimitMb),
    OPENLOOPS_SCHEDULING_MODE: "per-repo-loops",
  };
  if (ctx.repo.org) env.OPENLOOPS_REPO_ORG = ctx.repo.org;
  if (ctx.repo.remoteUrl) env.OPENLOOPS_REPO_REMOTE_URL = ctx.repo.remoteUrl;
  if (ctx.repo.defaultBranch) env.OPENLOOPS_REPO_DEFAULT_BRANCH = ctx.repo.defaultBranch;
  if (ctx.repo.packageName) env.OPENLOOPS_REPO_PACKAGE_NAME = ctx.repo.packageName;
  if (ctx.repo.packageScope) env.OPENLOOPS_REPO_PACKAGE_SCOPE = ctx.repo.packageScope;
  if (ctx.repo.language) env.OPENLOOPS_REPO_LANGUAGE = ctx.repo.language;
  if (ctx.repo.tags.length > 0) env.OPENLOOPS_REPO_TAGS = ctx.repo.tags.join(",");
  return env;
}

export function repoLoopMetadata(ctx: RepoLoopContext): NonNullable<CreateLoopInput["metadata"]> {
  return {
    openReposSource: "open-repos",
    openReposGroup: ctx.group,
    openReposKind: ctx.kind,
    openReposRepoId: ctx.repo.id,
    openReposRepoName: ctx.repo.name,
    openReposRepoPath: ctx.repo.path,
    openReposRepoOrg: ctx.repo.org ?? "",
    openReposRepoFullName: ctx.repo.fullName,
    openReposMaxConcurrency: ctx.maxConcurrency,
    openReposMemoryLimitMb: ctx.memoryLimitMb,
    openReposSchedulingMode: "per-repo-loops",
  };
}

export function createMultiRepoLoopPlan(opts: MultiRepoLoopPlanOptions): MultiRepoLoopPlan {
  const maxConcurrency = positiveInt(opts.maxConcurrency, 1, "--max-concurrency");
  const memoryLimitMb = positiveInt(opts.memoryLimitMb, DEFAULT_OPEN_REPOS_MEMORY_LIMIT_MB, "--memory-limit-mb");
  const nameTemplate = opts.nameTemplate ?? DEFAULT_OPEN_REPOS_LOOP_NAME_TEMPLATE;
  const loops = opts.repos.map((repo) => {
    const ctx: RepoLoopContext = { group: opts.group, kind: opts.kind, repo, maxConcurrency, memoryLimitMb };
    const env = repoLoopEnv(ctx);
    const input: CreateLoopInput = {
      name: renderRepoTemplate(nameTemplate, ctx, { sanitize: true }),
      description:
        opts.description ??
        `OpenRepos multi-repo ${opts.kind} loop for ${repo.fullName}; group=${opts.group}; scheduling=per-repo-loops; maxConcurrency=${maxConcurrency}`,
      schedule: opts.schedule,
      target: opts.targetForRepo(repo, env),
      goal: opts.goal,
      machine: opts.machine,
      metadata: repoLoopMetadata(ctx),
      ...opts.policy,
    };
    return { repo, input, env };
  });
  return {
    group: opts.group,
    kind: opts.kind,
    maxConcurrency,
    memoryLimitMb,
    scheduling: {
      mode: "per-repo-loops",
      defaultSequential: maxConcurrency === 1,
      description:
        maxConcurrency === 1
          ? "OpenLoops stores one native loop per repo and the daemon claims at most one due repo loop from this group at a time."
          : `OpenLoops stores one native loop per repo and the daemon claims at most ${maxConcurrency} due repo loops from this group at a time.`,
    },
    loops,
    warnings: opts.warnings ?? [],
  };
}
