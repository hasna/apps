#!/usr/bin/env bun
import type * as BankingModule from "../src/index.ts";

async function main(): Promise<number> {
  if (Bun.env.BANKING_MERCURY_LIVE_SMOKE !== "true") {
    console.log(JSON.stringify({
      status: "skipped",
      providerId: "mercury",
      reason: "Set BANKING_MERCURY_LIVE_SMOKE=true to run the read-only live smoke.",
      mutationExecutionMode: "disabled",
    }, null, 2));
    return 0;
  }

  try {
    const banking = await loadBankingModule();
    const environment = banking.parseProviderEnvironment(Bun.env.BANKING_MERCURY_ENVIRONMENT, "BANKING_MERCURY_ENVIRONMENT");
    const limit = parseLimit(Bun.env.BANKING_MERCURY_LIVE_SMOKE_LIMIT);
    const summary = await banking.runMercuryLiveReadSmoke(banking.createMercuryReadClient({
      environment,
      env: Bun.env,
      ...(Bun.env.BANKING_MERCURY_SECRET_KEY ? { secretKey: Bun.env.BANKING_MERCURY_SECRET_KEY } : {}),
    }), {
      environment,
      ...(limit !== undefined ? { limit } : {}),
      ...(Bun.env.BANKING_MERCURY_BALANCE_ACCOUNT_ID ? { balanceAccountId: Bun.env.BANKING_MERCURY_BALANCE_ACCOUNT_ID } : {}),
      includeBalance: Bun.env.BANKING_MERCURY_SKIP_BALANCE !== "true",
    });
    console.log(JSON.stringify(summary, null, 2));
    return 0;
  } catch (error) {
    const classified = classifyFailure(error);
    console.error(JSON.stringify({
      status: "failed",
      providerId: "mercury",
      errorClass: classified.errorClass,
      ...(classified.httpStatus ? { httpStatus: classified.httpStatus } : {}),
      message: "Mercury live smoke failed. Output is sanitized; check local configuration, credentials, network access, and provider status.",
      mutationExecutionMode: "disabled",
    }, null, 2));
    return 1;
  }
}

async function loadBankingModule(): Promise<typeof BankingModule> {
  const srcUrl = new URL("../src/index.ts", import.meta.url);
  if (await Bun.file(srcUrl).exists()) {
    return await import(srcUrl.href) as typeof BankingModule;
  }
  const distUrl = new URL("../dist/index.js", import.meta.url);
  if (await Bun.file(distUrl).exists()) {
    return await import(distUrl.href) as typeof BankingModule;
  }
  throw new Error("BANKING_MERCURY_MODULE_MISSING");
}

function parseLimit(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error("BANKING_MERCURY_LIVE_SMOKE_LIMIT must be a number.");
  return parsed;
}

function classifyFailure(
  error: unknown,
): { readonly errorClass: "credential_error" | "mercury_api_error" | "configuration_error" | "unexpected_error"; readonly httpStatus?: number } {
  if (error instanceof Error && error.name === "MercuryCredentialError") return { errorClass: "credential_error" };
  if (error instanceof Error && error.name === "MercuryApiError") {
    const status = (error as { readonly status?: unknown }).status;
    return typeof status === "number" ? { errorClass: "mercury_api_error", httpStatus: status } : { errorClass: "mercury_api_error" };
  }
  if (error instanceof Error && (error.message.includes("BANKING_MERCURY") || error.message.includes("--BANKING_MERCURY_ENVIRONMENT"))) {
    return { errorClass: "configuration_error" };
  }
  return { errorClass: "unexpected_error" };
}

process.exit(await main());
