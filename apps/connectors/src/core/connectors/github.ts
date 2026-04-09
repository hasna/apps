import { Buffer } from "buffer";
import { existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { z } from "zod";
import {
  defineConnector,
  type ConnectorCommandResult,
} from "../connector.js";

type OutputFormat = "json" | "pretty";

interface GitHubProfileConfig {
  token?: string;
  baseUrl?: string;
}

interface GitHubUser {
  login: string;
  id: number;
}

interface GitHubRepository {
  full_name: string;
  private: boolean;
  stargazers_count: number;
  description?: string | null;
  type?: string;
  content?: string;
}

interface GitHubIssue {
  number: number;
  title: string;
  state: string;
  labels: Array<{ name: string }>;
  assignee?: { login: string } | null;
}

interface GitHubReview {
  state: string;
  body?: string | null;
  user: { login: string };
}

interface GitHubCommit {
  sha: string;
  author?: { login?: string };
  parents: Array<{ sha: string }>;
  commit: {
    message: string;
    author?: {
      name?: string;
      date?: string;
    };
  };
}

interface GitHubPr {
  number: number;
  title: string;
  state: string;
  merged?: boolean;
  draft?: boolean;
  head: { ref: string };
  base: { ref: string };
  user?: { login: string } | null;
}

interface GitHubBranch {
  name: string;
  protected: boolean;
  commit: { sha: string };
}

interface LegacyConfigModule {
  getConfigDir: () => string;
  getCurrentProfile: () => string;
  setCurrentProfile: (profile: string) => void;
  listProfiles: () => string[];
  createProfile: (profile: string, config?: GitHubProfileConfig) => boolean;
  deleteProfile: (profile: string) => boolean;
  profileExists: (profile: string) => boolean;
  loadProfile: (profile?: string) => GitHubProfileConfig;
  setToken: (token: string) => void;
  clearConfig: () => void;
}

interface GitHubApiModule {
  GitHub: new (config: { token: string; baseUrl?: string }) => {
    repos: {
      listForAuthenticatedUser: (options?: Record<string, unknown>) => Promise<GitHubRepository[]>;
      list: (owner: string, options?: Record<string, unknown>) => Promise<GitHubRepository[]>;
      listOrg: (owner: string, options?: Record<string, unknown>) => Promise<GitHubRepository[]>;
      get: (owner: string, repo: string) => Promise<unknown>;
      getContent: (
        owner: string,
        repo: string,
        path: string,
        options?: Record<string, unknown>
      ) => Promise<unknown>;
      listCommits: (
        owner: string,
        repo: string,
        options?: Record<string, unknown>
      ) => Promise<GitHubCommit[]>;
      getCommit: (owner: string, repo: string, ref: string) => Promise<GitHubCommit>;
      listBranches: (
        owner: string,
        repo: string,
        options?: Record<string, unknown>
      ) => Promise<GitHubBranch[]>;
    };
    issues: {
      list: (owner: string, repo: string, options?: Record<string, unknown>) => Promise<GitHubIssue[]>;
      get: (owner: string, repo: string, number: number) => Promise<unknown>;
      listComments: (owner: string, repo: string, number: number) => Promise<unknown[]>;
    };
    pulls: {
      list: (owner: string, repo: string, options?: Record<string, unknown>) => Promise<GitHubPr[]>;
      get: (owner: string, repo: string, number: number) => Promise<unknown>;
      listReviews: (owner: string, repo: string, number: number) => Promise<GitHubReview[]>;
    };
    users: {
      getAuthenticated: () => Promise<unknown>;
      get: (username: string) => Promise<unknown>;
      listFollowers: (username: string, options?: Record<string, unknown>) => Promise<GitHubUser[]>;
      listFollowing: (username: string, options?: Record<string, unknown>) => Promise<GitHubUser[]>;
      listMyFollowers: (options?: Record<string, unknown>) => Promise<GitHubUser[]>;
      listMyFollowing: (options?: Record<string, unknown>) => Promise<GitHubUser[]>;
    };
  };
}

interface ParsedGlobalArgs {
  remaining: string[];
  format: OutputFormat;
  profile?: string;
  token?: string;
}

interface ParsedOptions {
  positionals: string[];
  options: Record<string, string | boolean>;
}

interface RunContext {
  format: OutputFormat;
  profile?: string;
  token?: string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveGithubConnectorDir(): string {
  const candidates = [
    join(__dirname, "..", "..", "..", "connectors", "connect-github"),
    join(__dirname, "..", "..", "connectors", "connect-github"),
    join(__dirname, "..", "connectors", "connect-github"),
    join(process.cwd(), "connectors", "connect-github"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

const CONNECTOR_DIR = resolveGithubConnectorDir();
const ROOT_HELP = `Usage: connect-github [options] [command]

GitHub API connector CLI

Options:
  -V, --version            output the version number
  -t, --token <token>      GitHub token (overrides config)
  -f, --format <format>    Output format (json, pretty) (default: "pretty")
  -p, --profile <profile>  Use a specific profile
  -h, --help               display help for command

Commands:
  profile                  Manage configuration profiles
  config                   Manage CLI configuration (for active profile)
  repo                     Manage repositories
  issue                    Manage issues
  pr                       Manage pull requests
  user                     User information
  help [command]           display help for command`;

const COMMAND_HELP: Record<string, string> = {
  profile: `Usage: connect-github profile [options] [command]

Manage configuration profiles

Options:
  -h, --help              display help for command

Commands:
  list                    List all profiles
  use <name>              Switch to a profile
  create [options] <name> Create a new profile
  delete <name>           Delete a profile
  show [name]             Show profile configuration
  help [command]          display help for command`,
  config: `Usage: connect-github config [options] [command]

Manage CLI configuration (for active profile)

Options:
  -h, --help           display help for command

Commands:
  set-token <token>    Set GitHub token
  show                 Show current configuration
  clear                Clear configuration for active profile
  help [command]       display help for command`,
  repo: `Usage: connect-github repo [options] [command]

Manage repositories

Options:
  -h, --help                               display help for command

Commands:
  list [options] [owner]                   List repositories for a user/org (defaults to authenticated user)
  get <owner> <repo>                       Get repository information
  create [options] <name>                  Create a new repository
  delete <owner> <repo>                    Delete a repository
  content [options] <owner> <repo> <path>  Get file or directory content
  commits [options] <owner> <repo>         List commits on a repository
  commit <owner> <repo> <ref>              Get a single commit by SHA or ref
  branches [options] <owner> <repo>        List branches for a repository
  help [command]                           display help for command`,
  issue: `Usage: connect-github issue [options] [command]

Manage issues

Options:
  -h, --help                                 display help for command

Commands:
  list [options] <owner> <repo>              List issues in a repository
  get <owner> <repo> <number>                Get an issue
  create [options] <owner> <repo>            Create an issue
  close [options] <owner> <repo> <number>    Close an issue
  comment [options] <owner> <repo> <number>  Add a comment to an issue
  comments <owner> <repo> <number>           List comments on an issue
  help [command]                             display help for command`,
  pr: `Usage: connect-github pr [options] [command]

Manage pull requests

Options:
  -h, --help                                display help for command

Commands:
  list [options] <owner> <repo>             List pull requests
  get <owner> <repo> <number>               Get a pull request
  create [options] <owner> <repo>           Create a pull request
  merge [options] <owner> <repo> <number>   Merge a pull request
  reviews <owner> <repo> <number>           List reviews on a pull request
  review [options] <owner> <repo> <number>  Create a review on a pull request
  help [command]                            display help for command`,
  user: `Usage: connect-github user [options] [command]

User information

Options:
  -h, --help                      display help for command

Commands:
  info [username]                 Get user information (defaults to authenticated user)
  followers [options] [username]  List followers
  following [options] [username]  List users being followed
  help [command]                  display help for command`,
};

async function loadGitHubApiModule(): Promise<GitHubApiModule> {
  return (await import(
    pathToFileURL(join(CONNECTOR_DIR, "src", "api", "index.ts")).href
  )) as GitHubApiModule;
}

async function loadGitHubConfigModule(): Promise<LegacyConfigModule> {
  return (await import(
    pathToFileURL(join(CONNECTOR_DIR, "src", "utils", "config.ts")).href
  )) as LegacyConfigModule;
}

function extractGlobalArgs(args: string[]): ParsedGlobalArgs {
  const remaining: string[] = [];
  let format: OutputFormat = "pretty";
  let profile: string | undefined;
  let token: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [flag, inlineValue] = arg.split("=", 2);

    if (flag === "--format" || flag === "-f") {
      const value = inlineValue ?? args[index + 1];
      if (inlineValue === undefined) {
        index += 1;
      }
      if (value === "json" || value === "pretty") {
        format = value;
      }
      continue;
    }

    if (flag === "--profile" || flag === "-p") {
      const value = inlineValue ?? args[index + 1];
      if (inlineValue === undefined) {
        index += 1;
      }
      if (value) {
        profile = value;
      }
      continue;
    }

    if (flag === "--token" || flag === "-t") {
      const value = inlineValue ?? args[index + 1];
      if (inlineValue === undefined) {
        index += 1;
      }
      if (value) {
        token = value;
      }
      continue;
    }

    remaining.push(arg);
  }

  return { remaining, format, profile, token };
}

function parseOptions(
  args: string[],
  spec: {
    boolean?: Record<string, string>;
    string?: Record<string, string>;
  }
): ParsedOptions | null {
  const positionals: string[] = [];
  const options: Record<string, string | boolean> = {};
  const booleanFlags = spec.boolean ?? {};
  const stringFlags = spec.string ?? {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      positionals.push(...args.slice(index + 1));
      break;
    }

    if (arg.startsWith("--")) {
      const [flag, inlineValue] = arg.split("=", 2);
      const booleanKey = booleanFlags[flag];
      if (booleanKey) {
        options[booleanKey] = inlineValue === undefined ? true : inlineValue !== "false";
        continue;
      }

      const stringKey = stringFlags[flag];
      if (stringKey) {
        const value = inlineValue ?? args[index + 1];
        if (value === undefined || value.startsWith("-")) {
          return null;
        }
        if (inlineValue === undefined) {
          index += 1;
        }
        options[stringKey] = value;
        continue;
      }

      return null;
    }

    if (arg.startsWith("-") && arg !== "-") {
      const booleanKey = booleanFlags[arg];
      if (booleanKey) {
        options[booleanKey] = true;
        continue;
      }

      const stringKey = stringFlags[arg];
      if (stringKey) {
        const value = args[index + 1];
        if (value === undefined || value.startsWith("-")) {
          return null;
        }
        index += 1;
        options[stringKey] = value;
        continue;
      }

      return null;
    }

    positionals.push(arg);
  }

  return { positionals, options };
}

function asString(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asBoolean(value: string | boolean | undefined): boolean {
  return value === true;
}

function asNumber(value: string | boolean | undefined, fallback: number): number {
  if (typeof value !== "string") {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function formatLines(lines: string[], format: OutputFormat, fallbackValue?: unknown): string {
  if (format === "json" && fallbackValue !== undefined) {
    return formatJson(fallbackValue);
  }
  return lines.join("\n");
}

function failure(stderr: string): ConnectorCommandResult {
  return { stdout: "", stderr, exitCode: 1, success: false };
}

function success(stdout: string): ConnectorCommandResult {
  return { stdout, stderr: "", exitCode: 0, success: true };
}

function noTokenResult(): ConnectorCommandResult {
  return failure(
    'No GitHub token configured. Run "connect-github config set-token <token>" or set GITHUB_TOKEN environment variable.'
  );
}

async function createGitHubClient(
  context: RunContext
): Promise<
  | {
      client: InstanceType<GitHubApiModule["GitHub"]>;
      configModule: LegacyConfigModule;
      profileName: string;
    }
  | { error: ConnectorCommandResult }
> {
  const configModule = await loadGitHubConfigModule();

  if (context.profile && !configModule.profileExists(context.profile)) {
    return {
      error: failure(`Profile "${context.profile}" does not exist`),
    };
  }

  const profileName = context.profile ?? configModule.getCurrentProfile();
  const profileConfig = configModule.loadProfile(profileName);
  const token = context.token ?? process.env.GITHUB_TOKEN ?? profileConfig.token;
  const baseUrl = process.env.GITHUB_BASE_URL ?? profileConfig.baseUrl;

  if (!token) {
    return { error: noTokenResult() };
  }

  const apiModule = await loadGitHubApiModule();

  return {
    client: new apiModule.GitHub({ token, baseUrl }),
    configModule,
    profileName,
  };
}

async function runProfileCommand(
  args: string[],
  context: RunContext
): Promise<ConnectorCommandResult | null> {
  const subcommand = args[0];
  const configModule = await loadGitHubConfigModule();

  if (!subcommand) {
    return success(COMMAND_HELP.profile);
  }

  if (subcommand === "list") {
    const profiles = configModule.listProfiles();
    const current = configModule.getCurrentProfile();
    if (context.format === "json") {
      return success(formatJson({ current, profiles }));
    }

    if (profiles.length === 0) {
      return success('No profiles found. Use "profile create <name>" to create one.');
    }

    const lines = ["Profiles:"];
    for (const profile of profiles) {
      lines.push(`  ${profile}${profile === current ? " (active)" : ""}`);
    }
    return success(lines.join("\n"));
  }

  if (subcommand === "use") {
    const name = args[1];
    if (!name) {
      return null;
    }
    if (!configModule.profileExists(name)) {
      return failure(`Profile "${name}" does not exist. Create it with "profile create ${name}"`);
    }
    configModule.setCurrentProfile(name);
    return success(`Switched to profile: ${name}`);
  }

  if (subcommand === "create") {
    const parsed = parseOptions(args.slice(1), {
      boolean: { "--use": "use" },
      string: { "--token": "token" },
    });
    if (!parsed || parsed.positionals.length !== 1) {
      return null;
    }
    const name = parsed.positionals[0];
    if (configModule.profileExists(name)) {
      return failure(`Profile "${name}" already exists`);
    }

    configModule.createProfile(name, {
      token: asString(parsed.options.token),
    });

    if (asBoolean(parsed.options.use)) {
      configModule.setCurrentProfile(name);
    }

    const message = asBoolean(parsed.options.use)
      ? `Profile "${name}" created\nSwitched to profile: ${name}`
      : `Profile "${name}" created`;

    return success(message);
  }

  if (subcommand === "delete") {
    const name = args[1];
    if (!name) {
      return null;
    }
    if (name === "default") {
      return failure("Cannot delete the default profile");
    }
    if (!configModule.deleteProfile(name)) {
      return failure(`Profile "${name}" not found`);
    }
    return success(`Profile "${name}" deleted`);
  }

  if (subcommand === "show") {
    const name = args[1] ?? configModule.getCurrentProfile();
    const config = configModule.loadProfile(name);
    const current = configModule.getCurrentProfile();
    if (context.format === "json") {
      return success(
        formatJson({
          profile: name,
          active: name === current,
          tokenConfigured: Boolean(config.token),
          baseUrl: config.baseUrl ?? null,
        })
      );
    }

    return success(
      [`Profile: ${name}${name === current ? " (active)" : ""}`, `Token: ${config.token ? `${config.token.substring(0, 8)}...` : "not set"}`].join(
        "\n"
      )
    );
  }

  return null;
}

async function runConfigCommand(
  args: string[],
  context: RunContext
): Promise<ConnectorCommandResult | null> {
  const subcommand = args[0];
  const configModule = await loadGitHubConfigModule();

  if (!subcommand) {
    return success(COMMAND_HELP.config);
  }

  if (subcommand === "set-token") {
    const token = args[1];
    if (!token) {
      return null;
    }
    configModule.setToken(token);
    return success(`Token saved to profile: ${configModule.getCurrentProfile()}`);
  }

  if (subcommand === "show") {
    const profile = configModule.getCurrentProfile();
    const config = configModule.loadProfile(profile);
    const token = context.token ?? process.env.GITHUB_TOKEN ?? config.token;
    if (context.format === "json") {
      return success(
        formatJson({
          profile,
          configDir: configModule.getConfigDir(),
          tokenConfigured: Boolean(token),
        })
      );
    }

    return success(
      [
        `Active Profile: ${profile}`,
        `Config directory: ${configModule.getConfigDir()}`,
        `Token: ${token ? `${token.substring(0, 8)}...` : "not set"}`,
      ].join("\n")
    );
  }

  if (subcommand === "clear") {
    configModule.clearConfig();
    return success(`Configuration cleared for profile: ${configModule.getCurrentProfile()}`);
  }

  return null;
}

async function runUserCommand(
  args: string[],
  context: RunContext
): Promise<ConnectorCommandResult | null> {
  const subcommand = args[0];
  const runtime = await createGitHubClient(context);
  if ("error" in runtime) {
    return runtime.error;
  }

  const { client } = runtime;

  if (subcommand === "info") {
    const username = args[1];
    const result = username
      ? await client.users.get(username)
      : await client.users.getAuthenticated();
    return success(formatJson(result));
  }

  if (subcommand === "followers") {
    const parsed = parseOptions(args.slice(1), {
      string: {
        "--per-page": "perPage",
        "-n": "perPage",
      },
    });
    if (!parsed) {
      return null;
    }
    const username = parsed.positionals[0];
    const perPage = asNumber(parsed.options.perPage, 30);
    const result = username
      ? await client.users.listFollowers(username, { per_page: perPage })
      : await client.users.listMyFollowers({ per_page: perPage });

    if (context.format === "json") {
      return success(formatJson(result));
    }

    return success(formatLines(result.map((user) => user.login), context.format));
  }

  if (subcommand === "following") {
    const parsed = parseOptions(args.slice(1), {
      string: {
        "--per-page": "perPage",
        "-n": "perPage",
      },
    });
    if (!parsed) {
      return null;
    }
    const username = parsed.positionals[0];
    const perPage = asNumber(parsed.options.perPage, 30);
    const result = username
      ? await client.users.listFollowing(username, { per_page: perPage })
      : await client.users.listMyFollowing({ per_page: perPage });

    if (context.format === "json") {
      return success(formatJson(result));
    }

    return success(formatLines(result.map((user) => user.login), context.format));
  }

  return null;
}

async function runRepoCommand(
  args: string[],
  context: RunContext
): Promise<ConnectorCommandResult | null> {
  const subcommand = args[0];
  const runtime = await createGitHubClient(context);
  if ("error" in runtime) {
    return runtime.error;
  }

  const { client } = runtime;

  if (subcommand === "list") {
    const parsed = parseOptions(args.slice(1), {
      boolean: { "--org": "org" },
      string: {
        "--per-page": "perPage",
        "-n": "perPage",
        "--page": "page",
        "--sort": "sort",
      },
    });
    if (!parsed || parsed.positionals.length > 1) {
      return null;
    }
    const owner = parsed.positionals[0];
    const options = {
      per_page: asNumber(parsed.options.perPage, 30),
      page: asNumber(parsed.options.page, 1),
      sort: asString(parsed.options.sort) ?? "updated",
    };
    const result = !owner
      ? await client.repos.listForAuthenticatedUser(options)
      : asBoolean(parsed.options.org)
        ? await client.repos.listOrg(owner, options)
        : await client.repos.list(owner, options);

    if (context.format === "json") {
      return success(formatJson(result));
    }

    const lines = result.length
      ? result.flatMap((repo) =>
          repo.description
            ? [`${repo.full_name}`, `  ${repo.description}`]
            : [repo.full_name]
        )
      : ["No repositories found"];
    return success(lines.join("\n"));
  }

  if (subcommand === "get") {
    if (args.length < 3) {
      return null;
    }
    const result = await client.repos.get(args[1], args[2]);
    return success(formatJson(result));
  }

  if (subcommand === "content") {
    const parsed = parseOptions(args.slice(1), {
      string: { "--ref": "ref" },
    });
    if (!parsed || parsed.positionals.length !== 3) {
      return null;
    }
    const [owner, repo, path] = parsed.positionals;
    const result = await client.repos.getContent(owner, repo, path, {
      ref: asString(parsed.options.ref),
    });

    if (
      context.format !== "json" &&
      !Array.isArray(result) &&
      typeof result === "object" &&
      result !== null &&
      "type" in result &&
      result.type === "file" &&
      "content" in result &&
      typeof result.content === "string"
    ) {
      return success(Buffer.from(result.content, "base64").toString("utf-8"));
    }

    return success(formatJson(result));
  }

  if (subcommand === "commits") {
    const parsed = parseOptions(args.slice(1), {
      string: {
        "--sha": "sha",
        "--path": "path",
        "--author": "author",
        "--since": "since",
        "--until": "until",
        "--limit": "limit",
      },
    });
    if (!parsed || parsed.positionals.length !== 2) {
      return null;
    }
    const [owner, repo] = parsed.positionals;
    const result = await client.repos.listCommits(owner, repo, {
      sha: asString(parsed.options.sha),
      path: asString(parsed.options.path),
      author: asString(parsed.options.author),
      since: asString(parsed.options.since),
      until: asString(parsed.options.until),
      per_page: asNumber(parsed.options.limit, 10),
    });

    if (context.format === "json") {
      return success(formatJson(result));
    }

    if (result.length === 0) {
      return success("No commits found.");
    }

    return success(
      result
        .map((commit) => {
          const author = commit.commit.author?.name ?? commit.author?.login ?? "unknown";
          const message = commit.commit.message.split("\n")[0];
          return `${commit.sha.slice(0, 7)} ${author} ${message}`;
        })
        .join("\n")
    );
  }

  if (subcommand === "commit") {
    if (args.length < 4) {
      return null;
    }
    const result = await client.repos.getCommit(args[1], args[2], args[3]);
    return success(formatJson(result));
  }

  if (subcommand === "branches") {
    const parsed = parseOptions(args.slice(1), {
      boolean: { "--protected": "protected" },
      string: { "--limit": "limit" },
    });
    if (!parsed || parsed.positionals.length !== 2) {
      return null;
    }
    const [owner, repo] = parsed.positionals;
    const result = await client.repos.listBranches(owner, repo, {
      protected: asBoolean(parsed.options.protected),
      per_page: asNumber(parsed.options.limit, 30),
    });

    if (context.format === "json") {
      return success(formatJson(result));
    }

    if (result.length === 0) {
      return success("No branches found.");
    }

    return success(
      result
        .map((branch) => `${branch.name}${branch.protected ? " [protected]" : ""} ${branch.commit.sha.slice(0, 7)}`)
        .join("\n")
    );
  }

  return null;
}

async function runIssueCommand(
  args: string[],
  context: RunContext
): Promise<ConnectorCommandResult | null> {
  const subcommand = args[0];
  const runtime = await createGitHubClient(context);
  if ("error" in runtime) {
    return runtime.error;
  }

  const { client } = runtime;

  if (subcommand === "list") {
    const parsed = parseOptions(args.slice(1), {
      string: {
        "--state": "state",
        "--labels": "labels",
        "--per-page": "perPage",
        "-n": "perPage",
        "--page": "page",
      },
    });
    if (!parsed || parsed.positionals.length !== 2) {
      return null;
    }
    const [owner, repo] = parsed.positionals;
    const result = await client.issues.list(owner, repo, {
      state: asString(parsed.options.state) ?? "open",
      labels: asString(parsed.options.labels),
      per_page: asNumber(parsed.options.perPage, 30),
      page: asNumber(parsed.options.page, 1),
    });

    if (context.format === "json") {
      return success(formatJson(result));
    }

    if (result.length === 0) {
      return success("No issues found");
    }

    return success(
      result
        .map((issue) => `#${issue.number} ${issue.state} ${issue.title}`)
        .join("\n")
    );
  }

  if (subcommand === "get") {
    if (args.length < 4) {
      return null;
    }
    const result = await client.issues.get(args[1], args[2], Number.parseInt(args[3], 10));
    return success(formatJson(result));
  }

  if (subcommand === "comments") {
    if (args.length < 4) {
      return null;
    }
    const result = await client.issues.listComments(
      args[1],
      args[2],
      Number.parseInt(args[3], 10)
    );
    return success(formatJson(result));
  }

  return null;
}

async function runPrCommand(
  args: string[],
  context: RunContext
): Promise<ConnectorCommandResult | null> {
  const subcommand = args[0];
  const runtime = await createGitHubClient(context);
  if ("error" in runtime) {
    return runtime.error;
  }

  const { client } = runtime;

  if (subcommand === "list") {
    const parsed = parseOptions(args.slice(1), {
      string: {
        "--state": "state",
        "--base": "base",
        "--head": "head",
        "--per-page": "perPage",
        "-n": "perPage",
        "--page": "page",
      },
    });
    if (!parsed || parsed.positionals.length !== 2) {
      return null;
    }
    const [owner, repo] = parsed.positionals;
    const result = await client.pulls.list(owner, repo, {
      state: asString(parsed.options.state) ?? "open",
      base: asString(parsed.options.base),
      head: asString(parsed.options.head),
      per_page: asNumber(parsed.options.perPage, 30),
      page: asNumber(parsed.options.page, 1),
    });

    if (context.format === "json") {
      return success(formatJson(result));
    }

    if (result.length === 0) {
      return success("No pull requests found");
    }

    return success(
      result
        .map((pr) => `#${pr.number} ${pr.state}${pr.merged ? " [merged]" : ""}${pr.draft ? " [draft]" : ""} ${pr.title}`)
        .join("\n")
    );
  }

  if (subcommand === "get") {
    if (args.length < 4) {
      return null;
    }
    const result = await client.pulls.get(args[1], args[2], Number.parseInt(args[3], 10));
    return success(formatJson(result));
  }

  if (subcommand === "reviews") {
    if (args.length < 4) {
      return null;
    }
    const result = await client.pulls.listReviews(
      args[1],
      args[2],
      Number.parseInt(args[3], 10)
    );
    return success(formatJson(result));
  }

  return null;
}

async function runGitHubTopLevelCommand(
  command: string,
  args: string[],
  context: RunContext
): Promise<ConnectorCommandResult | null> {
  if (command === "profile") {
    return runProfileCommand(args, context);
  }
  if (command === "config") {
    return runConfigCommand(args, context);
  }
  if (command === "repo") {
    return runRepoCommand(args, context);
  }
  if (command === "issue") {
    return runIssueCommand(args, context);
  }
  if (command === "pr") {
    return runPrCommand(args, context);
  }
  if (command === "user") {
    return runUserCommand(args, context);
  }
  return null;
}

export const githubConnector = defineConnector({
  meta: {
    name: "github",
    displayName: "GitHub",
    description: "GitHub repositories, pull requests, issues, and user workflows.",
    category: "Developer Tools",
    tags: ["git", "code", "repositories", "pull-requests"],
  },
  auth: {
    type: "bearer_token",
    supportsProfiles: true,
    fields: [
      {
        key: "token",
        env: "GITHUB_TOKEN",
        label: "GitHub token",
        description: "Personal access token or GitHub App token.",
        required: true,
        secret: true,
      },
    ],
  },
  operations: {
    profile: {
      summary: "Manage GitHub connector profiles",
      inputSchema: z
        .object({
          args: z.array(z.string()).default([]),
          format: z.enum(["json", "pretty"]).default("pretty"),
          profile: z.string().optional(),
          token: z.string().optional(),
        })
        .default({}),
      async execute(_ctx, input) {
        const result = await runProfileCommand(input.args, input);
        if (!result) {
          throw new Error("Unsupported GitHub profile subcommand");
        }
        return result;
      },
    },
    config: {
      summary: "Manage GitHub connector configuration",
      inputSchema: z
        .object({
          args: z.array(z.string()).default([]),
          format: z.enum(["json", "pretty"]).default("pretty"),
          profile: z.string().optional(),
          token: z.string().optional(),
        })
        .default({}),
      async execute(_ctx, input) {
        const result = await runConfigCommand(input.args, input);
        if (!result) {
          throw new Error("Unsupported GitHub config subcommand");
        }
        return result;
      },
    },
    repo: {
      summary: "Manage GitHub repositories",
      inputSchema: z
        .object({
          args: z.array(z.string()).default([]),
          format: z.enum(["json", "pretty"]).default("pretty"),
          profile: z.string().optional(),
          token: z.string().optional(),
        })
        .default({}),
      async execute(_ctx, input) {
        const result = await runRepoCommand(input.args, input);
        if (!result) {
          throw new Error("Unsupported GitHub repo subcommand");
        }
        return result;
      },
    },
    issue: {
      summary: "Manage GitHub issues",
      inputSchema: z
        .object({
          args: z.array(z.string()).default([]),
          format: z.enum(["json", "pretty"]).default("pretty"),
          profile: z.string().optional(),
          token: z.string().optional(),
        })
        .default({}),
      async execute(_ctx, input) {
        const result = await runIssueCommand(input.args, input);
        if (!result) {
          throw new Error("Unsupported GitHub issue subcommand");
        }
        return result;
      },
    },
    pr: {
      summary: "Manage GitHub pull requests",
      inputSchema: z
        .object({
          args: z.array(z.string()).default([]),
          format: z.enum(["json", "pretty"]).default("pretty"),
          profile: z.string().optional(),
          token: z.string().optional(),
        })
        .default({}),
      async execute(_ctx, input) {
        const result = await runPrCommand(input.args, input);
        if (!result) {
          throw new Error("Unsupported GitHub pull request subcommand");
        }
        return result;
      },
    },
    user: {
      summary: "Query GitHub users and authenticated identity",
      inputSchema: z
        .object({
          args: z.array(z.string()).default([]),
          format: z.enum(["json", "pretty"]).default("pretty"),
          profile: z.string().optional(),
          token: z.string().optional(),
        })
        .default({}),
      async execute(_ctx, input) {
        const result = await runUserCommand(input.args, input);
        if (!result) {
          throw new Error("Unsupported GitHub user subcommand");
        }
        return result;
      },
    },
  },
  commandRuntime: {
    helpText: ROOT_HELP,
    commands: [
      { name: "profile", summary: "Manage configuration profiles", helpText: COMMAND_HELP.profile },
      { name: "config", summary: "Manage CLI configuration (for active profile)", helpText: COMMAND_HELP.config },
      { name: "repo", summary: "Manage repositories", helpText: COMMAND_HELP.repo },
      { name: "issue", summary: "Manage issues", helpText: COMMAND_HELP.issue },
      { name: "pr", summary: "Manage pull requests", helpText: COMMAND_HELP.pr },
      { name: "user", summary: "User information", helpText: COMMAND_HELP.user },
    ],
    getHelp(command) {
      if (!command) {
        return ROOT_HELP;
      }
      return COMMAND_HELP[command] ?? null;
    },
    async run(args) {
      const parsed = extractGlobalArgs(args);
      const command = parsed.remaining[0];

      if (!command || command === "--help" || command === "-h" || command === "help") {
        return success(ROOT_HELP);
      }

      if (parsed.remaining[1] === "--help" || parsed.remaining[1] === "-h") {
        const helpText = COMMAND_HELP[command];
        return helpText ? success(helpText) : null;
      }

      return runGitHubTopLevelCommand(command, parsed.remaining.slice(1), {
        format: parsed.format,
        profile: parsed.profile,
        token: parsed.token,
      });
    },
  },
});
