#!/usr/bin/env bun
import {
  createMercuryReadClient,
  createBankingClient,
  listOperationDescriptors,
  moneyInput,
  parseProviderEnvironment,
  parseProviderId,
  planProviderOperation,
  requireOperationDescriptor,
  type BankingOperationSafetyClass,
  type MercuryReadClientInput,
  type MercuryFetch,
  type BankingPolicy,
  type CurrencyCode,
  type PaymentRail,
  type ProviderEnvironment,
  type ProviderId,
} from "../index.ts";

const VERSION = "0.0.6";

interface ParsedArgs {
  readonly positionals: readonly string[];
  readonly options: Readonly<Record<string, string | true>>;
  readonly json: boolean;
}

export interface CliRuntime {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly fetch?: MercuryFetch;
  readonly readSecret?: (key: string) => string | undefined;
}

function printHelp(): void {
  console.log(`banking ${VERSION}

Usage:
  banking --help
  banking --version
  banking ops list [--provider <provider>] [--safety <class>] [--include-unsupported true] [--json]
  banking ops describe <provider.operation> [--json]
  banking ops plan <provider.operation> --environment <sandbox|production> [--scopes <scope,...>] [--env-keys <KEY,...>] [--json]
  banking providers list [--json]
  banking providers show <provider> [--json]
  banking accounts list --provider <provider> [--live true --environment <sandbox|production> --secret-key <key>] [--limit <n>] [--json]
  banking balances get --provider <provider> --account <id> [--live true --environment <sandbox|production> --secret-key <key>] [--json]
  banking transactions list --provider <provider> [--account <id>] [--live true --environment <sandbox|production> --secret-key <key>] [--limit <n>] [--order <asc|desc>] [--json]
  banking payments quote --provider <provider> --account <id> --amount <decimal> --currency <code> --to <name> [--recipient <provider-recipient-id>] [--rail <rail>] [--json]
  banking payments request --provider <provider> --account <id> --amount <decimal> --currency <code> --to <name> [--recipient <provider-recipient-id>] [--rail <rail>] [--json]
  banking payments status --provider <provider> --request <id> [--json]
  banking cards list --provider <provider> [--account <id>] [--live true --environment <sandbox|production> --secret-key <key>] [--limit <n>] [--json]
  banking cards request --provider <provider> --account <id> --label <label> [--limit-month <decimal> --currency <code>] [--json]
  banking cards update --provider <provider> --card <id> [--label <label>] [--json]
  banking cards freeze|unfreeze|terminate --provider <provider> --card <id> [--json]
  banking admin --help

Live reads are currently implemented for Mercury only and require --live true, explicit --environment, and MERCURY_API_KEY or optional local --secret-key.
All mutation commands create request envelopes only. Provider-side mutations are still gated.`);
}

function emit(value: unknown, json: boolean): void {
  if (json || typeof value !== "string") {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  console.log(value);
}

function emitError(value: unknown, json: boolean): void {
  if (json || typeof value !== "string") {
    console.error(JSON.stringify(value, null, 2));
    return;
  }
  console.error(value);
}

function failNotImplemented(command: string, json: boolean): number {
  emitError({
    status: "not_implemented",
    command,
    message: "Provider adapters are not implemented yet; this command cannot read live banking data.",
  }, json);
  return 2;
}

function failAdminGated(command: string, json: boolean): number {
  emitError({
    status: "admin_approval_required",
    command,
    message: "Administrative capability verification is gated and must be implemented through the provider conformance workflow.",
  }, json);
  return 3;
}

function failLiveUnsupported(command: string, providerId: ProviderId, json: boolean): number {
  emitError({
    status: "not_implemented",
    command,
    providerId,
    message: "Live read adapters are currently implemented for Mercury only.",
  }, json);
  return 2;
}

export async function runCli(argv: readonly string[] = Bun.argv.slice(2), runtime: CliRuntime = {}): Promise<number> {
  const parsed = parseArgs(argv);
  const args = parsed.positionals;

  try {
    if (hasFlag(parsed, args, "version", "-v")) {
      emit(VERSION, parsed.json);
      return 0;
    }

    if (args.length === 0 || hasFlag(parsed, args, "help", "-h")) {
      printHelp();
      return 0;
    }

    if (args[0] === "ops" && args[1] === "list") {
      const provider = option(parsed, "provider");
      emit({
        operations: listOperationDescriptors({
          ...(provider ? { providerId: parseProviderId(provider) } : {}),
          ...optionalSafetyClass(parsed),
          includeUnsupported: option(parsed, "include-unsupported") === "true",
        }),
      }, parsed.json);
      return 0;
    }

    if (args[0] === "ops" && args[1] === "describe") {
      emit({ operation: requireOperationDescriptor(requiredPositional(args, 2, "operation")) }, parsed.json);
      return 0;
    }

    if (args[0] === "ops" && args[1] === "plan") {
      const descriptor = requireOperationDescriptor(requiredPositional(args, 2, "operation"));
      emit({
        operation: descriptor,
        plan: planProviderOperation({
          providerId: descriptor.providerId,
          operation: descriptor.operation,
          environment: parseProviderEnvironment(requiredOption(parsed, "environment")),
          grantedScopes: csvOption(parsed, "scopes", "scope"),
          env: Object.fromEntries(csvOption(parsed, "env-keys", "env-key").map((key) => [key, "set"])),
        }),
      }, parsed.json);
      return 0;
    }

    if (args[0] === "providers" && args[1] === "list") {
      emit({ providers: createBankingClient().listProviders() }, parsed.json);
      return 0;
    }

    if (args[0] === "providers" && args[1] === "show") {
      const provider = requireProvider(args[2]);
      emit({ provider }, parsed.json);
      return 0;
    }

    if (args[0] === "accounts" && args[1] === "list") {
      if (isLive(parsed)) {
        const provider = parseProviderId(requiredOption(parsed, "provider"));
        if (provider !== "mercury") return failLiveUnsupported("accounts list", provider, parsed.json);
        const limit = limitOption(parsed);
        emit({ accounts: await mercuryReadClient(parsed, runtime).listAccounts(limit ? { limit } : {}) }, parsed.json);
        return 0;
      }
      return failNotImplemented("accounts list", parsed.json);
    }
    if (args[0] === "balances" && args[1] === "get") {
      if (isLive(parsed)) {
        const provider = parseProviderId(requiredOption(parsed, "provider"));
        if (provider !== "mercury") return failLiveUnsupported("balances get", provider, parsed.json);
        emit({ balance: await mercuryReadClient(parsed, runtime).getBalance({ accountId: requiredOption(parsed, "account") }) }, parsed.json);
        return 0;
      }
      return failNotImplemented("balances get", parsed.json);
    }
    if (args[0] === "transactions" && args[1] === "list") {
      if (isLive(parsed)) {
        const provider = parseProviderId(requiredOption(parsed, "provider"));
        if (provider !== "mercury") return failLiveUnsupported("transactions list", provider, parsed.json);
        const limit = limitOption(parsed);
        const order = orderOption(parsed);
        emit({
          transactions: await mercuryReadClient(parsed, runtime).listTransactions({
            ...optionalOption(parsed, "account", "accountId"),
            ...(limit ? { limit } : {}),
            ...(order ? { order } : {}),
          }),
        }, parsed.json);
        return 0;
      }
      return failNotImplemented("transactions list", parsed.json);
    }
    if (args[0] === "cards" && args[1] === "list") {
      if (isLive(parsed)) {
        const provider = parseProviderId(requiredOption(parsed, "provider"));
        if (provider !== "mercury") return failLiveUnsupported("cards list", provider, parsed.json);
        const limit = limitOption(parsed);
        emit({
          cards: await mercuryReadClient(parsed, runtime).listCards({
            ...optionalOption(parsed, "account", "accountId"),
            ...(limit ? { limit } : {}),
          }),
        }, parsed.json);
        return 0;
      }
      return failNotImplemented("cards list", parsed.json);
    }

    if (args[0] === "payments" && args[1] === "quote") {
      emit(createBankingClient().createPaymentQuote(paymentInput(parsed), policyInput(parsed)), parsed.json);
      return 0;
    }
    if (args[0] === "payments" && args[1] === "request") {
      emit(createBankingClient().createPaymentRequest(paymentInput(parsed), policyInput(parsed)), parsed.json);
      return 0;
    }
    if (args[0] === "payments" && args[1] === "status") {
      const providerPaymentId = option(parsed, "provider-payment");
      emit(createBankingClient().createPaymentStatus({
        providerId: parseProviderId(requiredOption(parsed, "provider")),
        requester: actor(parsed),
        reason: option(parsed, "reason") ?? "payment status requested from CLI",
        paymentRequestId: requiredOption(parsed, "request"),
        ...(providerPaymentId ? { providerPaymentId } : {}),
      }, policyInput(parsed)), parsed.json);
      return 0;
    }

    if (args[0] === "cards" && args[1] === "request") {
      const spendingControls = cardSpendingControls(parsed);
      emit(createBankingClient().createCardRequest({
        providerId: parseProviderId(requiredOption(parsed, "provider")),
        requester: actor(parsed),
        reason: option(parsed, "reason") ?? "virtual card requested from CLI",
        accountId: requiredOption(parsed, "account"),
        label: requiredOption(parsed, "label"),
        ...(spendingControls ? { spendingControls } : {}),
      }, policyInput(parsed)), parsed.json);
      return 0;
    }

    if (args[0] === "cards" && args[1] === "update") {
      const label = option(parsed, "label");
      emit(createBankingClient().createCardUpdate({
        providerId: parseProviderId(requiredOption(parsed, "provider")),
        requester: actor(parsed),
        reason: option(parsed, "reason") ?? "card update requested from CLI",
        cardId: requiredOption(parsed, "card"),
        ...(label ? { label } : {}),
      }, policyInput(parsed)), parsed.json);
      return 0;
    }

    if (args[0] === "cards" && ["freeze", "unfreeze", "terminate"].includes(args[1] ?? "")) {
      emit(createBankingClient().createCardLifecycle({
        providerId: parseProviderId(requiredOption(parsed, "provider")),
        requester: actor(parsed),
        reason: option(parsed, "reason") ?? `card ${args[1]} requested from CLI`,
        cardId: requiredOption(parsed, "card"),
        kind: args[1] as "freeze" | "unfreeze" | "terminate",
      }, policyInput(parsed)), parsed.json);
      return 0;
    }

    if (args[0] === "admin") {
      if (args.length === 1 || args.includes("--help") || args.includes("-h")) {
        emit("Admin commands are gated. Available later: banking admin providers verify-operation.", parsed.json);
        return 0;
      }
      return failAdminGated(args.join(" "), parsed.json);
    }

    emitError(`Unknown command: ${args.join(" ")}`, parsed.json);
    return 1;
  } catch (error) {
    emitError({ status: "invalid_request", message: error instanceof Error ? error.message : String(error) }, parsed.json);
    return 1;
  }
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const options: Record<string, string | true> = {};
  const positionals: string[] = [];
  let positionalOnly = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;
    if (arg === "--") {
      positionalOnly = true;
      continue;
    }
    if (positionalOnly || !arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const equalsIndex = key.indexOf("=");
    if (equalsIndex >= 0) {
      options[key.slice(0, equalsIndex)] = key.slice(equalsIndex + 1);
      continue;
    }
    if (key === "json") {
      options[key] = true;
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
      continue;
    }
    options[key] = next;
    index += 1;
  }
  return { positionals, options, json: options.json === true };
}

function paymentInput(parsed: ParsedArgs) {
  const providerRecipientId = option(parsed, "recipient");
  return {
    providerId: parseProviderId(requiredOption(parsed, "provider")),
    requester: actor(parsed),
    reason: option(parsed, "reason") ?? "payment intent requested from CLI",
    sourceAccountId: requiredOption(parsed, "account"),
    counterparty: {
      name: requiredOption(parsed, "to"),
      ...(providerRecipientId ? { providerRecipientId } : {}),
    },
    amount: moneyInput(requiredOption(parsed, "amount"), currency(requiredOption(parsed, "currency"))),
    rail: (option(parsed, "rail") ?? "ach") as PaymentRail,
  };
}

function cardSpendingControls(parsed: ParsedArgs) {
  const month = option(parsed, "limit-month");
  if (!month) return undefined;
  return {
    month: moneyInput(month, currency(requiredOption(parsed, "currency"))),
  };
}

function policyInput(parsed: ParsedArgs): BankingPolicy {
  return {
    liveMode: option(parsed, "live") === "true",
    environment: parseProviderEnvironment(option(parsed, "environment") ?? "sandbox"),
    requireApprovalForProviderSideEffects: true,
    allowSensitiveCardData: false,
  };
}

function isLive(parsed: ParsedArgs): boolean {
  return option(parsed, "live") === "true";
}

function limitOption(parsed: ParsedArgs): number | undefined {
  const value = option(parsed, "limit");
  if (!value) return undefined;
  const parsedValue = Number(value);
  if (!Number.isFinite(parsedValue) || parsedValue < 1 || parsedValue > 1000) {
    throw new Error("--limit must be between 1 and 1000.");
  }
  return Math.trunc(parsedValue);
}

function orderOption(parsed: ParsedArgs): "asc" | "desc" | undefined {
  const value = option(parsed, "order");
  if (!value) return undefined;
  if (value !== "asc" && value !== "desc") throw new Error("--order must be asc or desc.");
  return value;
}

function mercuryReadClient(parsed: ParsedArgs, runtime: CliRuntime) {
  const secretKey = option(parsed, "secret-key");
  const input: MercuryReadClientInput = {
    environment: parseProviderEnvironment(requiredOption(parsed, "environment")),
    ...(secretKey ? { secretKey } : {}),
    ...(runtime.env ? { env: runtime.env } : {}),
    ...(runtime.fetch ? { fetch: runtime.fetch } : {}),
    ...(runtime.readSecret ? { readSecret: runtime.readSecret } : {}),
  };
  return createMercuryReadClient(input);
}

function actor(parsed: ParsedArgs) {
  return {
    id: option(parsed, "actor") ?? "agent-cli",
    type: "agent" as const,
  };
}

function requireProvider(value: string | undefined) {
  const id = parseProviderId(value);
  const provider = createBankingClient().getProvider(id);
  if (!provider) throw new Error(`Unknown provider: ${id}`);
  return provider;
}

function currency(value: string): CurrencyCode {
  return value.toUpperCase() as CurrencyCode;
}

function requiredPositional(args: readonly string[], index: number, label: string): string {
  const value = args[index];
  if (!value) throw new Error(`Missing required ${label}.`);
  return value;
}

function requiredOption(parsed: ParsedArgs, key: string): string {
  const value = option(parsed, key);
  if (!value) throw new Error(`Missing required --${key} value.`);
  return value;
}

function option(parsed: ParsedArgs, key: string): string | undefined {
  const value = parsed.options[key];
  return typeof value === "string" ? value : undefined;
}

function optionalOption(parsed: ParsedArgs, key: string, targetKey: string): Record<string, string> {
  const value = option(parsed, key);
  return value ? { [targetKey]: value } : {};
}

function csvOption(parsed: ParsedArgs, key: string, singularKey?: string): readonly string[] {
  const value = option(parsed, key) ?? (singularKey ? option(parsed, singularKey) : undefined);
  if (!value) return [];
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function optionalSafetyClass(parsed: ParsedArgs): { readonly safetyClass?: BankingOperationSafetyClass } {
  const safetyClass = option(parsed, "safety");
  if (!safetyClass) return {};
  if (!["read", "metadata_write", "money_movement", "card_lifecycle", "sensitive_read", "webhook_mutation", "auth_flow"].includes(safetyClass)) {
    throw new Error(`Unknown safety class: ${safetyClass}`);
  }
  return { safetyClass: safetyClass as BankingOperationSafetyClass };
}

function hasFlag(parsed: ParsedArgs, args: readonly string[], key: string, short: string): boolean {
  return parsed.options[key] === true || args.includes(short);
}

if (import.meta.main) {
  process.exit(await runCli());
}
