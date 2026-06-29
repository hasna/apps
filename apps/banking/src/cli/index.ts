#!/usr/bin/env bun
import {
  createBankingClient,
  moneyInput,
  type BankingPolicy,
  type CurrencyCode,
  type PaymentRail,
  type ProviderEnvironment,
  type ProviderId,
} from "../index.ts";

const VERSION = "0.0.1";

interface ParsedArgs {
  readonly positionals: readonly string[];
  readonly options: Readonly<Record<string, string | true>>;
  readonly json: boolean;
}

function printHelp(): void {
  console.log(`banking ${VERSION}

Usage:
  banking --help
  banking --version
  banking providers list [--json]
  banking providers show <provider> [--json]
  banking accounts list --provider <provider> [--json]
  banking balances get --provider <provider> --account <id> [--json]
  banking transactions list --provider <provider> --account <id> [--json]
  banking payments quote --provider <provider> --account <id> --amount <decimal> --currency <code> --to <name> [--rail <rail>] [--json]
  banking payments request --provider <provider> --account <id> --amount <decimal> --currency <code> --to <name> [--rail <rail>] [--json]
  banking payments status --provider <provider> --request <id> [--json]
  banking cards list --provider <provider> [--json]
  banking cards request --provider <provider> --account <id> --label <label> [--limit-month <decimal> --currency <code>] [--json]
  banking cards update --provider <provider> --card <id> [--label <label>] [--json]
  banking cards freeze|unfreeze|terminate --provider <provider> --card <id> [--json]
  banking admin --help

All mutation commands create request envelopes only. Provider adapters and live execution are not implemented.`);
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

export function runCli(argv: readonly string[] = Bun.argv.slice(2)): number {
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
      return failNotImplemented("accounts list", parsed.json);
    }
    if (args[0] === "balances" && args[1] === "get") {
      return failNotImplemented("balances get", parsed.json);
    }
    if (args[0] === "transactions" && args[1] === "list") {
      return failNotImplemented("transactions list", parsed.json);
    }
    if (args[0] === "cards" && args[1] === "list") {
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
    requireApprovalForProviderSideEffects: option(parsed, "require-approval") !== "false",
    allowSensitiveCardData: false,
  };
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
  process.exit(runCli());
}
