import { existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { z } from "zod";
import {
  defineConnector,
  type ConnectorCommandDescriptor,
  type ConnectorCommandResult,
} from "../connector.js";

type OutputFormat = "json" | "pretty";

interface StripeProfileConfig {
  apiKey?: string;
  apiSecret?: string;
  accountId?: string;
}

interface StripeEntity {
  id?: string;
  name?: string;
  email?: string;
  nickname?: string;
  description?: string | null;
  active?: boolean;
}

interface StripeListResponse<T> {
  data: T[];
  has_more?: boolean;
}

interface LegacyConfigModule {
  getApiKey: () => string | undefined;
  setApiKey: (apiKey: string) => void;
  getApiSecret: () => string | undefined;
  setApiSecret: (apiSecret: string) => void;
  getAccountId: () => string | undefined;
  setAccountId: (accountId: string) => void;
  getCurrentProfile: () => string;
  setCurrentProfile: (profile: string) => void;
  listProfiles: () => string[];
  createProfile: (profile: string, config?: StripeProfileConfig) => boolean;
  deleteProfile: (profile: string) => boolean;
  profileExists: (profile: string) => boolean;
  loadProfile: (profile?: string) => StripeProfileConfig;
  clearConfig: () => void;
  getConfigDir: () => string;
}

interface StripeApiModule {
  Connector: new (config: {
    apiKey: string;
    apiSecret?: string;
    accountId?: string;
  }) => {
    balance: {
      get: () => Promise<unknown>;
    };
    products: {
      list: (options?: Record<string, unknown>) => Promise<StripeListResponse<StripeEntity>>;
      get: (id: string) => Promise<unknown>;
    };
    prices: {
      list: (options?: Record<string, unknown>) => Promise<StripeListResponse<StripeEntity>>;
      get: (id: string) => Promise<unknown>;
    };
    customers: {
      list: (options?: Record<string, unknown>) => Promise<StripeListResponse<StripeEntity>>;
      get: (id: string) => Promise<unknown>;
    };
  };
}

interface ParsedGlobalArgs {
  remaining: string[];
  format: OutputFormat;
  profile?: string;
  apiKey?: string;
}

interface ParsedOptions {
  positionals: string[];
  options: Record<string, string | boolean>;
}

interface RunContext {
  format: OutputFormat;
  profile?: string;
  apiKey?: string;
}

interface CommandSpec {
  name: string;
  description: string;
  subcommands?: string[];
}

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveStripeConnectorDir(): string {
  const candidates = [
    join(__dirname, "..", "..", "..", "connectors", "stripe"),
    join(__dirname, "..", "..", "connectors", "stripe"),
    join(__dirname, "..", "connectors", "stripe"),
    join(process.cwd(), "connectors", "stripe"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

const CONNECTOR_DIR = resolveStripeConnectorDir();

const COMMAND_SPECS: CommandSpec[] = [
  {
    name: "profile",
    description: "Manage configuration profiles",
    subcommands: [
      "list",
      "use <name>",
      "create <name>",
      "delete <name>",
      "show [name]",
    ],
  },
  {
    name: "config",
    description: "Manage CLI configuration (for active profile)",
    subcommands: [
      "set-key <apiKey>",
      "set-account <accountId>",
      "show",
      "clear",
    ],
  },
  { name: "balance", description: "Get account balance" },
  {
    name: "products",
    description: "Manage products",
    subcommands: [
      "list",
      "get <id>",
      "create",
      "update <id>",
      "delete <id>",
      "search",
    ],
  },
  {
    name: "prices",
    description: "Manage prices",
    subcommands: [
      "list",
      "get <id>",
      "create",
      "update <id>",
      "search",
    ],
  },
  {
    name: "customers",
    description: "Manage customers",
    subcommands: [
      "list",
      "get <id>",
      "create",
      "update <id>",
      "delete <id>",
      "search",
    ],
  },
  {
    name: "subscriptions",
    description: "Manage subscriptions",
    subcommands: [
      "list",
      "get <id>",
      "create",
      "update <id>",
      "cancel <id>",
      "resume <id>",
      "search",
    ],
  },
  {
    name: "payment-intents",
    description: "Manage payment intents",
    subcommands: [
      "list",
      "get <id>",
      "create",
      "update <id>",
      "confirm <id>",
      "cancel <id>",
      "capture <id>",
      "search",
    ],
  },
  {
    name: "payment-methods",
    description: "Manage payment methods",
    subcommands: [
      "list",
      "get <id>",
      "attach <id>",
      "detach <id>",
    ],
  },
  {
    name: "charges",
    description: "Manage charges",
    subcommands: [
      "list",
      "get <id>",
      "create",
      "update <id>",
      "capture <id>",
      "search",
    ],
  },
  {
    name: "invoices",
    description: "Manage invoices",
    subcommands: [
      "list",
      "get <id>",
      "create",
      "update <id>",
      "delete <id>",
      "finalize <id>",
      "pay <id>",
      "send <id>",
      "void <id>",
      "mark-uncollectible <id>",
      "search",
    ],
  },
  {
    name: "invoice-items",
    description: "Manage invoice items",
    subcommands: [
      "list",
      "get <id>",
      "create",
      "update <id>",
      "delete <id>",
    ],
  },
  {
    name: "coupons",
    description: "Manage coupons",
    subcommands: [
      "list",
      "get <id>",
      "create",
      "update <id>",
      "delete <id>",
    ],
  },
  {
    name: "events",
    description: "List Stripe events",
    subcommands: ["list", "get <id>"],
  },
  {
    name: "webhooks",
    description: "Manage webhooks",
    subcommands: [
      "list",
      "get <id>",
      "create",
      "update <id>",
      "delete <id>",
    ],
  },
  {
    name: "checkout",
    description: "Manage checkout sessions",
    subcommands: ["create", "get <id>", "list", "expire <id>"],
  },
  {
    name: "payment-links",
    description: "Manage payment links",
    subcommands: [
      "create",
      "get <id>",
      "list",
      "update <id>",
      "deactivate <id>",
    ],
  },
  {
    name: "billing-portal",
    description: "Manage billing portal",
    subcommands: [
      "create-session",
      "list-configurations",
      "get-configuration <id>",
    ],
  },
];

function buildRootHelp(specs: CommandSpec[]): string {
  const lines = [
    "Usage: connect-stripe [options] [command]",
    "",
    "Stripe API connector CLI",
    "",
    "Options:",
    "  -V, --version            output the version number",
    "  -k, --api-key <key>      API key (overrides config)",
    '  -f, --format <format>    Output format (json, pretty) (default: "pretty")',
    "  -p, --profile <profile>  Use a specific profile",
    "  -h, --help               display help for command",
    "",
    "Commands:",
  ];

  for (const spec of specs) {
    lines.push(`  ${spec.name.padEnd(24)}${spec.description}`);
  }

  lines.push("  help [command]           display help for command");
  return lines.join("\n");
}

function buildCommandHelp(spec: CommandSpec): string {
  const lines = [
    `Usage: connect-stripe ${spec.name}${spec.subcommands ? " [options] [command]" : " [options]"}`,
    "",
    spec.description,
    "",
    "Options:",
    "  -h, --help  display help for command",
  ];

  if (spec.subcommands?.length) {
    lines.push("", "Commands:");
    for (const subcommand of spec.subcommands) {
      lines.push(`  ${subcommand}`);
    }
    lines.push("  help [command]");
  }

  return lines.join("\n");
}

const ROOT_HELP = buildRootHelp(COMMAND_SPECS);
const COMMAND_HELP = Object.fromEntries(
  COMMAND_SPECS.map((spec) => [spec.name, buildCommandHelp(spec)])
) as Record<string, string>;

async function loadStripeApiModule(): Promise<StripeApiModule> {
  return (await import(
    pathToFileURL(join(CONNECTOR_DIR, "src", "api", "index.ts")).href
  )) as StripeApiModule;
}

async function loadStripeConfigModule(): Promise<LegacyConfigModule> {
  return (await import(
    pathToFileURL(join(CONNECTOR_DIR, "src", "utils", "config.ts")).href
  )) as LegacyConfigModule;
}

function extractGlobalArgs(args: string[]): ParsedGlobalArgs {
  const remaining: string[] = [];
  let format: OutputFormat = "pretty";
  let profile: string | undefined;
  let apiKey: string | undefined;

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

    if (flag === "--api-key" || flag === "-k") {
      const value = inlineValue ?? args[index + 1];
      if (inlineValue === undefined) {
        index += 1;
      }
      if (value) {
        apiKey = value;
      }
      continue;
    }

    remaining.push(arg);
  }

  return { remaining, format, profile, apiKey };
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

function asNumber(value: string | boolean | undefined, fallback: number): number {
  if (typeof value !== "string") {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asOptionalBoolean(
  value: string | boolean | undefined
): boolean | undefined {
  if (value === true) {
    return true;
  }
  if (value === false) {
    return false;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return undefined;
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function failure(stderr: string): ConnectorCommandResult {
  return { stdout: "", stderr, exitCode: 1, success: false };
}

function success(stdout: string): ConnectorCommandResult {
  return { stdout, stderr: "", exitCode: 0, success: true };
}

function hasHelpFlag(args: string[]): boolean {
  return args.includes("--help") || args.includes("-h");
}

function noApiKeyResult(): ConnectorCommandResult {
  return failure(
    'No API key configured. Run "connect-stripe config set-key <key>" or set STRIPE_API_KEY environment variable.'
  );
}

function formatCollection(
  items: StripeEntity[],
  format: OutputFormat,
  emptyMessage: string
): ConnectorCommandResult {
  if (format === "json") {
    return success(formatJson(items));
  }

  if (items.length === 0) {
    return success(emptyMessage);
  }

  return success(
    items
      .map((item) => {
        const primary = item.name ?? item.email ?? item.nickname ?? item.id ?? "unknown";
        if (item.id && primary !== item.id) {
          return `${primary} (${item.id})`;
        }
        return primary;
      })
      .join("\n")
  );
}

async function createStripeClient(
  context: RunContext
): Promise<
  | {
      client: InstanceType<StripeApiModule["Connector"]>;
      configModule: LegacyConfigModule;
      profileName: string;
      profileConfig: StripeProfileConfig;
    }
  | { error: ConnectorCommandResult }
> {
  const configModule = await loadStripeConfigModule();

  if (context.profile && !configModule.profileExists(context.profile)) {
    return {
      error: failure(`Profile "${context.profile}" does not exist`),
    };
  }

  const profileName = context.profile ?? configModule.getCurrentProfile();
  const profileConfig = configModule.loadProfile(profileName);
  const apiKey = context.apiKey ?? process.env.STRIPE_API_KEY ?? profileConfig.apiKey;
  const apiSecret = process.env.STRIPE_API_SECRET ?? profileConfig.apiSecret;
  const accountId = process.env.STRIPE_ACCOUNT_ID ?? profileConfig.accountId;

  if (!apiKey) {
    return { error: noApiKeyResult() };
  }

  const apiModule = await loadStripeApiModule();

  return {
    client: new apiModule.Connector({ apiKey, apiSecret, accountId }),
    configModule,
    profileName,
    profileConfig,
  };
}

async function runProfileCommand(
  args: string[],
  context: RunContext
): Promise<ConnectorCommandResult | null> {
  const configModule = await loadStripeConfigModule();
  const subcommand = args[0];

  if (!subcommand || hasHelpFlag(args)) {
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
      string: { "--api-key": "apiKey" },
    });
    if (!parsed || parsed.positionals.length !== 1) {
      return null;
    }
    const name = parsed.positionals[0];
    const created = configModule.createProfile(name, {
      apiKey: asString(parsed.options.apiKey),
    });
    if (!created) {
      return failure(`Profile "${name}" already exists`);
    }
    if (parsed.options.use === true) {
      configModule.setCurrentProfile(name);
      return success(`Profile "${name}" created\nSwitched to profile: ${name}`);
    }
    return success(`Profile "${name}" created`);
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
          apiKeyConfigured: Boolean(config.apiKey),
          apiSecretConfigured: Boolean(config.apiSecret),
          accountId: config.accountId ?? null,
        })
      );
    }

    const isOrgKey = config.apiKey?.startsWith("sk_org_");
    const lines = [
      `Profile: ${name}${name === current ? " (active)" : ""}`,
      `API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : "not set"}`,
    ];
    if (isOrgKey || config.accountId) {
      lines.push(`Account ID: ${config.accountId ?? "not set"}`);
    }
    return success(lines.join("\n"));
  }

  return null;
}

async function runConfigCommand(
  args: string[],
  context: RunContext
): Promise<ConnectorCommandResult | null> {
  const configModule = await loadStripeConfigModule();
  const subcommand = args[0];

  if (!subcommand || hasHelpFlag(args)) {
    return success(COMMAND_HELP.config);
  }

  if (subcommand === "set-key") {
    const apiKey = args[1];
    if (!apiKey) {
      return null;
    }
    configModule.setApiKey(apiKey);
    return success(`API key saved to profile: ${configModule.getCurrentProfile()}`);
  }

  if (subcommand === "set-account") {
    const accountId = args[1];
    if (!accountId) {
      return null;
    }
    configModule.setAccountId(accountId);
    return success(`Account ID saved to profile: ${configModule.getCurrentProfile()}`);
  }

  if (subcommand === "show") {
    const profile = configModule.getCurrentProfile();
    const config = configModule.loadProfile(profile);
    const apiKey = context.apiKey ?? process.env.STRIPE_API_KEY ?? config.apiKey;
    const accountId = process.env.STRIPE_ACCOUNT_ID ?? config.accountId;
    const isOrgKey = apiKey?.startsWith("sk_org_");

    if (context.format === "json") {
      return success(
        formatJson({
          profile,
          configDir: configModule.getConfigDir(),
          apiKeyConfigured: Boolean(apiKey),
          accountId: accountId ?? null,
        })
      );
    }

    const lines = [
      `Active Profile: ${profile}`,
      `Config directory: ${configModule.getConfigDir()}`,
      `API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : "not set"}`,
    ];

    if (isOrgKey || accountId) {
      lines.push(`Account ID: ${accountId ?? "not set (required for org keys)"}`);
    }

    return success(lines.join("\n"));
  }

  if (subcommand === "clear") {
    configModule.clearConfig();
    return success(`Configuration cleared for profile: ${configModule.getCurrentProfile()}`);
  }

  return null;
}

async function runBalanceCommand(
  args: string[],
  context: RunContext
): Promise<ConnectorCommandResult | null> {
  if (hasHelpFlag(args)) {
    return success(COMMAND_HELP.balance);
  }
  if (args.length > 0) {
    return null;
  }

  const runtime = await createStripeClient(context);
  if ("error" in runtime) {
    return runtime.error;
  }

  const result = await runtime.client.balance.get();
  return success(formatJson(result));
}

async function runProductsCommand(
  args: string[],
  context: RunContext
): Promise<ConnectorCommandResult | null> {
  const subcommand = args[0];
  if (!subcommand || hasHelpFlag(args)) {
    return success(COMMAND_HELP.products);
  }

  const runtime = await createStripeClient(context);
  if ("error" in runtime) {
    return runtime.error;
  }

  if (subcommand === "list") {
    const parsed = parseOptions(args.slice(1), {
      string: {
        "--limit": "limit",
        "-l": "limit",
        "--active": "active",
        "--starting-after": "startingAfter",
      },
    });
    if (!parsed) {
      return null;
    }

    const result = await runtime.client.products.list({
      limit: asNumber(parsed.options.limit, 10),
      active: asOptionalBoolean(parsed.options.active),
      starting_after: asString(parsed.options.startingAfter),
    });

    return formatCollection(result.data, context.format, "No products found");
  }

  if (subcommand === "get") {
    const id = args[1];
    if (!id) {
      return null;
    }
    const result = await runtime.client.products.get(id);
    return success(formatJson(result));
  }

  return null;
}

async function runPricesCommand(
  args: string[],
  context: RunContext
): Promise<ConnectorCommandResult | null> {
  const subcommand = args[0];
  if (!subcommand || hasHelpFlag(args)) {
    return success(COMMAND_HELP.prices);
  }

  const runtime = await createStripeClient(context);
  if ("error" in runtime) {
    return runtime.error;
  }

  if (subcommand === "list") {
    const parsed = parseOptions(args.slice(1), {
      string: {
        "--limit": "limit",
        "-l": "limit",
        "--product": "product",
        "--active": "active",
        "--type": "type",
        "--starting-after": "startingAfter",
      },
    });
    if (!parsed) {
      return null;
    }

    const result = await runtime.client.prices.list({
      limit: asNumber(parsed.options.limit, 10),
      product: asString(parsed.options.product),
      active: asOptionalBoolean(parsed.options.active),
      type: asString(parsed.options.type),
      starting_after: asString(parsed.options.startingAfter),
    });

    return formatCollection(result.data, context.format, "No prices found");
  }

  if (subcommand === "get") {
    const id = args[1];
    if (!id) {
      return null;
    }
    const result = await runtime.client.prices.get(id);
    return success(formatJson(result));
  }

  return null;
}

async function runCustomersCommand(
  args: string[],
  context: RunContext
): Promise<ConnectorCommandResult | null> {
  const subcommand = args[0];
  if (!subcommand || hasHelpFlag(args)) {
    return success(COMMAND_HELP.customers);
  }

  const runtime = await createStripeClient(context);
  if ("error" in runtime) {
    return runtime.error;
  }

  if (subcommand === "list") {
    const parsed = parseOptions(args.slice(1), {
      string: {
        "--limit": "limit",
        "-l": "limit",
        "--email": "email",
        "--starting-after": "startingAfter",
      },
    });
    if (!parsed) {
      return null;
    }

    const result = await runtime.client.customers.list({
      limit: asNumber(parsed.options.limit, 10),
      email: asString(parsed.options.email),
      starting_after: asString(parsed.options.startingAfter),
    });

    return formatCollection(result.data, context.format, "No customers found");
  }

  if (subcommand === "get") {
    const id = args[1];
    if (!id) {
      return null;
    }
    const result = await runtime.client.customers.get(id);
    return success(formatJson(result));
  }

  return null;
}

const COMMAND_DESCRIPTORS: ConnectorCommandDescriptor[] = COMMAND_SPECS.map(
  (spec) => ({
    name: spec.name,
    summary: spec.description,
    helpText: COMMAND_HELP[spec.name],
  })
);

const commandInputSchema = z
  .object({
    args: z.array(z.string()).default([]),
    format: z.enum(["json", "pretty"]).default("pretty"),
    profile: z.string().optional(),
    apiKey: z.string().optional(),
  })
  .default({});

export const stripeConnector = defineConnector({
  meta: {
    name: "stripe",
    displayName: "Stripe",
    description: "Payments, subscriptions, and billing platform.",
    category: "Commerce & Finance",
    version: "0.1.0",
    tags: ["payments", "billing", "subscriptions"],
  },
  auth: {
    type: "api_key",
    supportsProfiles: true,
    fields: [
      {
        key: "apiKey",
        env: "STRIPE_API_KEY",
        label: "Stripe API key",
        description: "Secret Stripe API key used for authenticated API requests.",
        required: true,
        secret: true,
      },
      {
        key: "accountId",
        env: "STRIPE_ACCOUNT_ID",
        label: "Stripe account ID",
        description: "Optional Stripe account context for organization keys.",
        required: false,
        secret: false,
      },
    ],
  },
  operations: {
    profile: {
      summary: "Manage Stripe connector profiles",
      inputSchema: commandInputSchema,
      async execute(_ctx, input) {
        const result = await runProfileCommand(input.args, input);
        if (!result) {
          throw new Error("Unsupported Stripe profile subcommand");
        }
        return result;
      },
    },
    config: {
      summary: "Manage Stripe connector configuration",
      inputSchema: commandInputSchema,
      async execute(_ctx, input) {
        const result = await runConfigCommand(input.args, input);
        if (!result) {
          throw new Error("Unsupported Stripe config subcommand");
        }
        return result;
      },
    },
    balance: {
      summary: "Get Stripe account balance",
      inputSchema: commandInputSchema,
      async execute(_ctx, input) {
        const result = await runBalanceCommand(input.args, input);
        if (!result) {
          throw new Error("Unsupported Stripe balance command");
        }
        return result;
      },
    },
    products: {
      summary: "Manage Stripe products",
      inputSchema: commandInputSchema,
      async execute(_ctx, input) {
        const result = await runProductsCommand(input.args, input);
        if (!result) {
          throw new Error("Unsupported Stripe products subcommand");
        }
        return result;
      },
    },
    prices: {
      summary: "Manage Stripe prices",
      inputSchema: commandInputSchema,
      async execute(_ctx, input) {
        const result = await runPricesCommand(input.args, input);
        if (!result) {
          throw new Error("Unsupported Stripe prices subcommand");
        }
        return result;
      },
    },
    customers: {
      summary: "Manage Stripe customers",
      inputSchema: commandInputSchema,
      async execute(_ctx, input) {
        const result = await runCustomersCommand(input.args, input);
        if (!result) {
          throw new Error("Unsupported Stripe customers subcommand");
        }
        return result;
      },
    },
  },
  commandRuntime: {
    helpText: ROOT_HELP,
    commands: COMMAND_DESCRIPTORS,
    getHelp(command) {
      if (!command) {
        return ROOT_HELP;
      }
      return COMMAND_HELP[command] ?? null;
    },
    async run(args) {
      const { remaining, format, profile, apiKey } = extractGlobalArgs(args);
      const context: RunContext = { format, profile, apiKey };

      const command = remaining[0];

      if (!command || command === "--help" || command === "-h" || command === "help") {
        return success(ROOT_HELP);
      }

      if (command === "--version" || command === "-V") {
        return success("0.1.0");
      }

      if (remaining[1] === "--help" || remaining[1] === "-h") {
        const helpText = COMMAND_HELP[command];
        return helpText ? success(helpText) : null;
      }

      const commandArgs = remaining.slice(1);

      switch (command) {
        case "profile":
          return runProfileCommand(commandArgs, context);
        case "config":
          return runConfigCommand(commandArgs, context);
        case "balance":
          return runBalanceCommand(commandArgs, context);
        case "products":
          return runProductsCommand(commandArgs, context);
        case "prices":
          return runPricesCommand(commandArgs, context);
        case "customers":
          return runCustomersCommand(commandArgs, context);
        default:
          return null;
      }
    },
  },
});
