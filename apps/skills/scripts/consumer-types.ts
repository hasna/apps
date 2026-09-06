#!/usr/bin/env bun
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

// Check the public distribution against its declared dependencies, independently
// of workspace overrides and skipLibCheck. npm's lifecycle is disabled in the
// inner pack so this can safely run from prepack without recursive builds.
const root = resolve(import.meta.dir, "..");
const workspace = await mkdtemp(join(tmpdir(), "skills-consumer-types-"));
const env = { PATH: `${dirname(process.execPath)}:${process.env.PATH ?? "/usr/bin:/bin"}`,
  TMPDIR: workspace, NO_COLOR: "1" };

async function run(command: string[], cwd: string) {
  const child = Bun.spawn(command, { cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 120_000);
  try {
    const [stdout, stderr, status] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    if (status !== 0) throw new Error(`Consumer type check command failed (${command[0]}, exit ${status}):\n${stdout.slice(-16_000)}${stderr.slice(-16_000)}`);
    return stdout;
  } finally { clearTimeout(timeout); }
}

try {
  const packed = JSON.parse(await run(["npm", "pack", "--ignore-scripts", "--json", "--pack-destination", workspace], root));
  const filename = packed[0]?.filename;
  if (typeof filename !== "string" || filename !== "hasna-skills-" + packed[0]?.version + ".tgz") throw new Error("Unexpected Skills package archive");
  const metadata = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const checkedExports = [".", "./storage", "./sdk", "./admin-contract"];
  if (JSON.stringify(Object.keys(metadata.exports).sort()) !== JSON.stringify(checkedExports.sort())) {
    throw new Error("Update the installed consumer fixture to check every public package export.");
  }
  await writeFile(join(workspace, "package.json"), JSON.stringify({ private: true, type: "module",
    dependencies: { "@hasna/skills": `file:${join(workspace, filename)}` },
    devDependencies: { typescript: "5.9.3", "@types/bun": metadata.devDependencies["@types/bun"] },
  }));
  await writeFile(join(workspace, "tsconfig.json"), JSON.stringify({ compilerOptions: {
    target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true,
    skipLibCheck: false, noEmit: true, types: ["bun"], allowSyntheticDefaultImports: true,
  }, files: ["consumer.ts"] }));
  await writeFile(join(workspace, "consumer.ts"), `
import { createRunService, runAdmissionSchema, runTerminalSchema, type SkillsProductStore, RemoteCapabilityUnavailableError, RemoteRequestError } from "@hasna/skills/sdk";
import { RemoteSkillsClient, RemoteSkillsAuthClient, RemoteCapabilityUnavailableError as RootCapabilityError } from "@hasna/skills";
import { SKILLS_NATIVE_STORAGE_ENV, type SkillsNativeStorageConfig } from "@hasna/skills/storage";
import { SkillsAdminSetUserRoleRequestSchema, SkillsAdminSuspendOrganizationRequestSchema,
  SkillsAdminResumeOrganizationRequestSchema } from "@hasna/skills/admin-contract";
declare const store: SkillsProductStore;
const service = createRunService({ store });
const admission = runAdmissionSchema.parse({});
const version: 1 = admission.contractVersion;
const status: "admitted" = admission.status;
const terminal = runTerminalSchema.parse({});
const terminalStatus: "succeeded" | "failed" | "cancelled" | "expired" = terminal.status;
// These directives also catch accidental loss of inference to any.
// @ts-expect-error A validated run cannot have a different protocol version.
const wrongVersion: 2 = admission.contractVersion;
// @ts-expect-error Admission does not produce a terminal state.
const wrongStatus: "succeeded" = admission.status;
const client = new RemoteSkillsClient("fixture", "https://skills.example.com/api/v1");
const auth = new RemoteSkillsAuthClient("https://skills.example.com/api/v1");
const unavailable = new RemoteCapabilityUnavailableError();
const rootError: RemoteCapabilityUnavailableError = new RootCapabilityError();
const requestError: RemoteRequestError = unavailable;
const unavailableCode: "SUBSCRIPTION_CHECKOUT_UNAVAILABLE" = unavailable.code;
// @ts-expect-error Arbitrary server error codes are not part of this safe contract.
const arbitraryCode: "ARBITRARY_SERVER_CODE" = unavailable.code;
const storageEnv: "HASNA_SKILLS_DATABASE_URL" = SKILLS_NATIVE_STORAGE_ENV.databaseUrl;
const storage: SkillsNativeStorageConfig = { syncBatchSize: 10, dryRun: true };
// @ts-expect-error Storage configuration retains its numeric batch size.
const invalidStorage: SkillsNativeStorageConfig = { syncBatchSize: "ten", dryRun: true };
const role = SkillsAdminSetUserRoleRequestSchema.parse({ role: "admin" }).role;
const validRole: "owner" | "admin" | "member" | "viewer" = role;
// @ts-expect-error Administrative roles cannot widen to arbitrary strings or any.
const invalidRole: "superuser" = role;
const suspended = SkillsAdminSuspendOrganizationRequestSchema.parse({ suspended: true, reason: "fixture" }).suspended;
const resumed = SkillsAdminResumeOrganizationRequestSchema.parse({ suspended: false, reason: "fixture" }).suspended;
const suspendLiteral: true = suspended;
const resumeLiteral: false = resumed;
// @ts-expect-error Suspend and resume retain opposite literal contracts.
const wrongSuspend: false = suspended;
// @ts-expect-error Resume cannot be widened to boolean or any.
const wrongResume: true = resumed;
void [service, version, status, terminalStatus, wrongVersion, wrongStatus, client, auth,
  rootError, requestError, unavailableCode, arbitraryCode, storageEnv, storage, invalidStorage,
  validRole, invalidRole, suspendLiteral, resumeLiteral, wrongSuspend, wrongResume];
`);
  await run([process.execPath, "install", "--ignore-scripts", "--registry", "https://registry.npmjs.org"], workspace);
  await run([process.execPath, "node_modules/typescript/bin/tsc", "-p", "tsconfig.json"], workspace);
  console.log(`Consumer types: @hasna/skills@${metadata.version} passed strict installed-package checking for all four exports (skipLibCheck=false).`);
} finally { await rm(workspace, { recursive: true, force: true }); }
