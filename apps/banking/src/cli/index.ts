#!/usr/bin/env bun
import {
  createMercuryReadClient,
  createBankingClient,
  moneyInput,
  type MercuryReadClientInput,
  type MercuryFetch,
  type BankingPolicy,
  type CurrencyCode,
  type PaymentRail,
  type ProviderEnvironment,
  type ProviderId,
} from "../index.ts";

const VERSION = "0.0.3";

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
  banking providers list [--json]
  banking providers show <provider> [--json]
  banking accounts list --provider <provider> [--live true --environment <sandbox|production> --secret-key <key>] [--limit <n>] [--json]
  banking balances get --provider <provider> --account <id> [--live true --environment <sandbox|production> --secret-key <key>] [--json]
  banking transactions list --provider <provider> --account <id> [--live true --environment <sandbox|production> --secret-key <key>] [--limit <n>] [--json]
  banking payments quote --provider <provider> --account <id> --amount <decimal> --currency <code> --to <name> [--recipient <provider-recipient-id>] [--rail <rail>] [--json]
  banking payments request --provider <provider> --account <id> --amount <decimal> --currency <code> --to <name> [--recipient <provider-recipient-id>] [--rail <rail>] [--json]
  banking payments status --provider <provider> --request <id> [--json]
  banking cards list --provider <provider> --account <id> [--live true --environment <sandbox|production> --secret-key <key>] [--json]
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
    if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
      printHelp();
      return 0;
    }

    if (args.includes("--version") || args.includes("-v")) {
      emit(VERSION, parsed.json);
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
        const provider = providerId(requiredOption(parsed, "provider"));
        if (provider !== "mercury") return failLiveUnsupported("accounts list", provider, parsed.json);
        const limit = limitOption(parsed);
        emit({ accounts: await mercuryReadClient(parsed, runtime).listAccounts(limit ? { limit } : {}) }, parsed.json);
        return 0;
      }
      return failNotImplemented("accounts list", parsed.json);
    }
    if (args[0] === "balances" && args[1] === "get") {
      if (isLive(parsed)) {
        const provider = providerId(requiredOption(parsed, "provider"));
        if (provider !== "mercury") return failLiveUnsupported("balances get", provider, parsed.json);
        emit({ balance: await mercuryReadClient(parsed, runtime).getBalance({ accountId: requiredOption(parsed, "account") }) }, parsed.json);
        return 0;
      }
      return failNotImplemented("balances get", parsed.json);
    }
    if (args[0] === "transactions" && args[1] === "list") {
      if (isLive(parsed)) {
        const provider = providerId(requiredOption(parsed, "provider"));
        if (provider !== "mercury") return failLiveUnsupported("transactions list", provider, parsed.json);
        const limit = limitOption(parsed);
        emit({
          transactions: await mercuryReadClient(parsed, runtime).listTransactions({
            accountId: requiredOption(parsed, "account"),
            ...(limit ? { limit } : {}),
          }),
        }, parsed.json);
        return 0;
      }
      return failNotImplemented("transactions list", parsed.json);
    }
    if (args[0] === "cards" && args[1] === "list") {
      if (isLive(parsed)) {
        const provider = providerId(requiredOption(parsed, "provider"));
        if (provider !== "mercury") return failLiveUnsupported("cards list", provider, parsed.json);
        if (option(parsed, "limit")) throw new Error("--limit is not supported for Mercury cards list.");
        emit({
          cards: await mercuryReadClient(parsed, runtime).listCards({
            accountId: requiredOption(parsed, "account"),
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
        providerId: providerId(requiredOption(parsed, "provider")),
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
        providerId: providerId(requiredOption(parsed, "provider")),
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
        providerId: providerId(requiredOption(parsed, "provider")),
        requester: actor(parsed),
        reason: option(parsed, "reason") ?? "card update requested from CLI",
        cardId: requiredOption(parsed, "card"),
        ...(label ? { label } : {}),
      }, policyInput(parsed)), parsed.json);
      return 0;
    }

    if (args[0] === "cards" && ["freeze", "unfreeze", "terminate"].includes(args[1] ?? "")) {
      emit(createBankingClient().createCardLifecycle({
        providerId: providerId(requiredOption(parsed, "provider")),
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
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const key = arg.slice(2);
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
    providerId: providerId(requiredOption(parsed, "provider")),
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
    environment: environment(option(parsed, "environment") ?? "sandbox"),
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

function mercuryReadClient(parsed: ParsedArgs, runtime: CliRuntime) {
  const secretKey = option(parsed, "secret-key");
  const input: MercuryReadClientInput = {
    environment: environment(requiredOption(parsed, "environment")),
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
  const id = providerId(value);
  const provider = createBankingClient().getProvider(id);
  if (!provider) throw new Error(`Unknown provider: ${id}`);
  return provider;
}

function providerId(value: string | undefined): ProviderId {
  if (!value) throw new Error("Missing required --provider value.");
  if (!["mercury", "bunq", "revolut-business", "erste-bcr"].includes(value)) {
    throw new Error(`Unknown provider: ${value}`);
  }
  return value as ProviderId;
}

function environment(value: string): ProviderEnvironment {
  if (value !== "sandbox" && value !== "production") {
    throw new Error(`Unknown environment: ${value}`);
  }
  return value;
}

function currency(value: string): CurrencyCode {
  return value.toUpperCase() as CurrencyCode;
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

if (import.meta.main) {
  process.exit(await runCli());
}
