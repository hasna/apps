import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

interface CommandResult { exitCode: number; stdout: string; stderr: string }

async function run(command: string[], cwd: string, env: Record<string, string>): Promise<CommandResult> {
  const child = Bun.spawn(command, { cwd, env, stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

async function checked(command: string[], cwd: string, env: Record<string, string>): Promise<CommandResult> {
  const result = await run(command, cwd, env);
  if (result.exitCode !== 0) throw new Error(`Command failed (${command.join(" ")}): ${result.stderr || result.stdout}`);
  return result;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function json(text: string): Record<string, unknown> {
  const value = JSON.parse(text) as unknown;
  assert(typeof value === "object" && value !== null && !Array.isArray(value), "Expected a JSON object");
  return value as Record<string, unknown>;
}

const root = resolve(import.meta.dir, "..");
const temporary = mkdtempSync(join(tmpdir(), "computers-pack-verification-"));
const environment: Record<string, string> = {
  HOME: temporary,
  NO_COLOR: "1",
  PATH: Bun.env.PATH ?? "/usr/bin:/bin",
  TMPDIR: temporary,
};

try {
  await checked([process.execPath, "run", "build"], root, environment);
  const archive = join(temporary, "hasna-computers.tgz");
  await checked([process.execPath, "pm", "pack", "--ignore-scripts", "--filename", archive], root, environment);
  const listing = (await checked(["tar", "-tzf", archive], root, environment)).stdout.trim().split("\n").filter(Boolean);
  assert(listing.length > 0 && listing.every((entry) => entry.startsWith("package/")), "Packed archive has an invalid root");
  const forbidden = [/(?:^|\/)src\//, /(?:^|\/)tests\//, /(?:^|\/)scripts\//, /node_modules\//, /(?:^|\/)\.env(?:\.|$)/, /\.db(?:-|$)/, /\.tgz$/, /bun\.lock$/, /package-lock\.json$/];
  for (const entry of listing) assert(!forbidden.some((pattern) => pattern.test(entry)), `Forbidden packed content: ${entry}`);
  const required = [
    "package/package.json", "package/dist/index.js", "package/dist/index.d.ts", "package/dist/sdk.js", "package/dist/sdk.d.ts",
    "package/dist/contracts.js", "package/dist/contracts.d.ts", "package/dist/providers.js", "package/dist/providers.d.ts",
    "package/dist/storage.js", "package/dist/storage.d.ts", "package/dist/bin/computers.js", "package/dist/bin/computers-serve.js",
    "package/dist/bin/computers-mcp.js", "package/dist/bin/computers-worker.js", "package/dist/bin/computers-resident.js", "package/dist/bin/computers-migrate.js",
  ];
  for (const entry of required) assert(listing.includes(entry), `Packed archive is missing ${entry}`);

  const consumer = join(temporary, "consumer");
  mkdirSync(consumer, { mode: 0o700 });
  writeFileSync(join(consumer, "package.json"), `${JSON.stringify({ private: true, type: "module", dependencies: { "@hasna/computers": `file:${archive}` } }, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(join(consumer, "tsconfig.json"), `${JSON.stringify({ compilerOptions: {
    target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, noEmit: true,
    types: ["bun"], typeRoots: [join(root, "node_modules", "@types")], skipLibCheck: false,
  }, include: ["consumer.ts"] }, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(join(consumer, "consumer.ts"), `import * as root from "@hasna/computers";
import * as sdk from "@hasna/computers/sdk";
import * as contracts from "@hasna/computers/contracts";
import * as providers from "@hasna/computers/providers";
import * as storage from "@hasna/computers/storage";
const surfaces = [root, sdk, contracts, providers, storage];
if (surfaces.some((surface) => Object.keys(surface).length === 0)) throw new Error("empty package export");
process.stdout.write("packed consumer imports passed\\n");
`, { mode: 0o600 });
  await checked([process.execPath, "install", "--offline", "--ignore-scripts"], consumer, environment);
  await checked([process.execPath, join(root, "node_modules", "typescript", "bin", "tsc"), "-p", join(consumer, "tsconfig.json")], consumer, environment);
  const imported = await checked([process.execPath, join(consumer, "consumer.ts")], consumer, environment);
  assert(imported.stdout === "packed consumer imports passed\n" && imported.stderr === "", "Packed consumer runtime import failed");

  const binary = (name: string): string => join(consumer, "node_modules", ".bin", name);
  const database = join(temporary, "binary-smoke.db");
  const help = await run([binary("computers"), "--help"], consumer, environment);
  assert(help.exitCode === 0 && help.stderr === "" && help.stdout.includes("Requests return a truthful pending operation"), "computers help contract failed");
  const migrate = await run([binary("computers-migrate"), "--db", database], consumer, environment);
  const migrated = json(migrate.stdout);
  assert(migrate.exitCode === 0 && migrate.stderr === "" && migrated.migrated === true && migrated.schemaVersion === 1, "computers-migrate contract failed");
  const worker = await run([binary("computers-worker"), "--db", database, "--tenant", "tenant_pack"], consumer, environment);
  const worked = json(worker.stdout);
  assert(worker.exitCode === 0 && worker.stderr === "" && worked.handled === 0 && worked.providerAdaptersConfigured === false, "computers-worker contract failed");
  const resident = await run([binary("computers-resident")], consumer, environment);
  const residentStatus = json(resident.stdout);
  assert(resident.exitCode === 1 && resident.stderr === "" && residentStatus.ready === false && residentStatus.mtlsTransport === false && residentStatus.privilegedDaemon === false, "computers-resident contract failed");
  const mcp = await run([binary("computers-mcp")], consumer, environment);
  assert(mcp.exitCode === 1 && mcp.stdout === "" && JSON.stringify(json(mcp.stderr)) === JSON.stringify({ error: { code: "configuration_error", message: "MCP controller configuration is invalid" } }), "computers-mcp contract failed");
  const serve = await run([binary("computers-serve")], consumer, { ...environment, COMPUTERS_AUTH: "{", COMPUTERS_DB: join(temporary, "must-not-exist.db") });
  assert(serve.exitCode === 1 && serve.stdout === "" && JSON.stringify(json(serve.stderr)) === JSON.stringify({ error: { code: "configuration_error", message: "Controller configuration is invalid" } }), "computers-serve contract failed");
  process.stdout.write(`packed release verification passed (${listing.length} files, 5 exports, 6 binaries)\n`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
