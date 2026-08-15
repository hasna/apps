#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { generateOtpCode, getOtpStorageStatus, listOtpEntries } from "../index.js";

function getPackageVersion(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
    return (JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function jsonText(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function parseTime(value: string | undefined): Date | number | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number.parseInt(value, 10) * 1000;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("at must be a Unix timestamp in seconds or ISO date");
  return date;
}

function generationOptions(at: string | undefined): { at?: Date | number } {
  const parsed = parseTime(at);
  return parsed === undefined ? {} : { at: parsed };
}

export function buildServer(): McpServer {
  const server = new McpServer({
    name: "otp",
    version: getPackageVersion(),
  });

  server.tool(
    "otp_list_labels",
    "List stored OTP labels and ids without returning TOTP seeds.",
    {},
    async () => jsonText(listOtpEntries().map((entry) => ({
      id: entry.id,
      label: entry.label,
      issuer: entry.issuer,
      account: entry.account,
      algorithm: entry.algorithm,
      digits: entry.digits,
      period: entry.period,
    }))),
  );

  server.tool(
    "otp_generate_code",
    "Generate a TOTP code by id, label, issuer:account, or unique account. Seeds are never returned.",
    {
      target: z.string().describe("OTP entry id, label, issuer:account, or unique account"),
      at: z.string().optional().describe("Unix timestamp in seconds or ISO date for deterministic generation"),
    },
    async (args) => jsonText(generateOtpCode(args.target, generationOptions(args.at))),
  );

  server.tool(
    "otp_status",
    "Show local OTP storage status without returning seeds.",
    {},
    async () => {
      const status = getOtpStorageStatus();
      return jsonText({
        home: status.home,
        entries: status.entries,
        storage: status.storage,
        encrypted_at_rest: status.encrypted_at_rest,
      });
    },
  );

  return server;
}

function printHelp(): void {
  console.log(`Usage: otp-mcp [options]

Runs the @hasna/otp MCP server over stdio.

Options:
  -V, --version    output the version number
  -h, --help       display help for command`);
}

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}

if (args.includes("--version") || args.includes("-V")) {
  console.log(getPackageVersion());
  process.exit(0);
}

async function main(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`otp-mcp: ${message}`);
  process.exit(1);
});
