#!/usr/bin/env bun
import { listProviders } from "../index.ts";

const VERSION = "0.0.1";

function printHelp(): void {
  console.log(`banking-mcp ${VERSION}

This scaffold exposes the future MCP server entrypoint for @hasna/banking.
Implemented now:
  --help
  --version
  --list-tools

The full MCP protocol server lands with the agent-safe surfaces.`);
}

export function listMcpTools(): readonly string[] {
  return [
    "banking_providers_list",
    "banking_accounts_list",
    "banking_balance_get",
    "banking_transactions_list",
    "banking_cards_list",
    "banking_payment_quote",
    "banking_payment_request",
    "banking_payment_status",
    "banking_card_request",
    "banking_card_update_request",
    "banking_card_freeze_request",
  ];
}

export function runMcp(argv: readonly string[] = Bun.argv.slice(2)): number {
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return 0;
  }

  if (argv.includes("--version") || argv.includes("-v")) {
    console.log(VERSION);
    return 0;
  }

  if (argv.includes("--list-tools")) {
    console.log(JSON.stringify({ tools: listMcpTools(), providers: listProviders() }, null, 2));
    return 0;
  }

  console.error("banking-mcp scaffold: full MCP protocol server is not implemented yet.");
  return 1;
}

if (import.meta.main) {
  process.exit(runMcp());
}
