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
  HOME: workspace, TMPDIR: workspace, NO_COLOR: "1", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
  NPM_CONFIG_USERCONFIG: join(workspace, "user.npmrc"), NPM_CONFIG_GLOBALCONFIG: join(workspace, "global.npmrc") };

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
import { RemoteSkillsClient, RemoteSkillsAuthClient, RemoteCapabilityUnavailableError as RootCapabilityError, runSkill } from "@hasna/skills";
import { SKILLS_NATIVE_STORAGE_ENV, type SkillsNativeStorageConfig } from "@hasna/skills/storage";
import { SkillsAdminSetUserRoleRequestSchema, SkillsAdminSuspendOrganizationRequestSchema,
  SkillsAdminResumeOrganizationRequestSchema, SkillsAdminListUsersResponseSchema,
  SkillsAdminShowOrganizationResponseSchema, SkillsAdminSetUserRoleResponseSchema } from "@hasna/skills/admin-contract";
declare const store: SkillsProductStore;
// Only compiled, never executed: preserve the existing modes and check the
// additive streaming option through actual installed declarations.
const streamOptions: Parameters<typeof runSkill>[2] = { stdio: "stderr" };
const inheritedOptions: Parameters<typeof runSkill>[2] = { stdio: "inherit" };
const capturedOptions: Parameters<typeof runSkill>[2] = { stdio: "pipe" };
// @ts-expect-error A misspelled mode must not silently become any.
const invalidStreamOptions: Parameters<typeof runSkill>[2] = { stdio: "stderr-buffered" };
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
declare const profile: Awaited<ReturnType<typeof client.updateProfile>>;
const displayName: string | null = profile.user.displayName;
const customerRole: "owner" | "admin" | "member" | "viewer" = profile.user.role;
// @ts-expect-error Name updates do not accept a role assignment.
client.updateProfile({ displayName: "Example", role: "owner" });
// @ts-expect-error Name responses retain a concrete role, not any.
const wrongCustomerRole: "superuser" = profile.user.role;
declare const workspace: Awaited<ReturnType<typeof auth.updateCurrentWorkspace>>;
const workspaceName: string = workspace.organization.name;
// @ts-expect-error Workspace identity cannot be changed through this method.
auth.updateCurrentWorkspace("reader@example.test", "000000", { name: "Example", id: "other" });
declare const roster: Awaited<ReturnType<typeof client.listWorkspaceMembers>>;
declare const freshRoster: Awaited<ReturnType<typeof auth.listWorkspaceMembers>>;
const rosterIdentity: string = roster.organizationId;
const rosterMember: import("@hasna/skills/sdk").RemoteWorkspaceMember = roster.members[0]!;
const rosterRootMember: import("@hasna/skills").RemoteWorkspaceMember = rosterMember;
const rosterPage: import("@hasna/skills/sdk").RemoteWorkspaceMembersPage = freshRoster;
const rosterRole: "owner" | "admin" | "member" | "viewer" = rosterMember.role;
const rosterDisplayName: string | null = rosterMember.displayName;
const rosterCursor: string | null = roster.nextCursor;
const rosterTimestamp: string = rosterMember.createdAt;
client.listWorkspaceMembers({ limit: 1, cursor: "opaque_cursor" });
auth.listWorkspaceMembers("reader@example.test", "000000", { limit: 100 });
// @ts-expect-error The current roster does not select a different workspace.
client.listWorkspaceMembers({ organizationId: "other" });
// @ts-expect-error Pagination limit stays numeric.
auth.listWorkspaceMembers("reader@example.test", "000000", { limit: "1" });
// @ts-expect-error A roster role must retain concrete inference, not any.
const inventedRosterRole: "superuser" = rosterMember.role;
// @ts-expect-error Exact timestamps remain strings; Date would lose precision.
const roundedRosterTimestamp: Date = rosterMember.createdAt;
// @ts-expect-error Complete pages require handling a null continuation.
const alwaysRosterCursor: string = roster.nextCursor;
// @ts-expect-error Auth metadata is not part of the safe member projection.
rosterMember.otpCodeHash;
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
type ListRole = ReturnType<typeof SkillsAdminListUsersResponseSchema.parse>["users"][number]["role"];
const noDefaultMembership: ListRole = null;
const activeDefaultMembership: ListRole = "viewer";
// @ts-expect-error The list role is required; absent and null differ.
const absentListRole: ListRole = undefined;
// @ts-expect-error List roles must not lose inference to arbitrary strings/any.
const inventedListRole: ListRole = "superuser";
// @ts-expect-error Active organization rosters still require a concrete role.
const nullOrganizationRole: ReturnType<typeof SkillsAdminShowOrganizationResponseSchema.parse>["users"][number]["role"] = null;
// @ts-expect-error Role assignment input does not allow null.
const nullMutationInput: typeof SkillsAdminSetUserRoleRequestSchema._input["role"] = null;
// @ts-expect-error Successful role mutation responses remain nonnullable.
const nullMutationOutput: ReturnType<typeof SkillsAdminSetUserRoleResponseSchema.parse>["user"]["role"] = null;
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
  await writeFile(join(workspace, "admin-list-runtime.ts"), `
import { strict as assert } from "node:assert";
import { SkillsAdminListUsersResponseSchema as List, SkillsAdminShowOrganizationResponseSchema as Show,
  SkillsAdminSetUserRoleRequestSchema as Input, SkillsAdminSetUserRoleResponseSchema as Output } from "@hasna/skills/admin-contract";
const user = { id: "owned-user", email: "owned@example.test", organizationId: "owned-org", role: null, metadata: {}, createdAt: "2026-09-06T00:00:00Z" };
const list = (row: unknown) => List.safeParse({ users: [row], limit: 1, offset: 0 }).success;
assert.equal(list(user), true);
assert.equal(list({ ...user, role: "viewer" }), true);
assert.equal(list({ ...user, role: undefined }), false);
const { role, ...missing } = user; assert.equal(list(missing), false);
assert.equal(list({ ...user, role: "superuser" }), false);
const organization = { id: "owned-org", slug: "owned", name: "Owned", metadata: {}, createdAt: user.createdAt };
const show = (row: unknown) => Show.safeParse({ organization, users: [row], balance: null, subscription: null }).success;
assert.equal(show(user), false); assert.equal(show({ ...user, role: "viewer" }), true);
assert.equal(Input.safeParse({ role: null }).success, false);
assert.equal(Output.safeParse({ ok: true, user }).success, false);
assert.equal(Output.safeParse({ ok: true, user: { ...user, role: "viewer" } }).success, true);
console.log("Installed admin list runtime: 10 assertions passed.");
`);
  await run([process.execPath, "install", "--ignore-scripts", "--registry", "https://registry.npmjs.org"], workspace);
  await run([process.execPath, "node_modules/typescript/bin/tsc", "-p", "tsconfig.json"], workspace);
  console.log((await run([process.execPath, "--no-env-file", "admin-list-runtime.ts"], workspace)).trim());
  console.log(`Consumer types: @hasna/skills@${metadata.version} passed strict installed-package checking for all four exports (skipLibCheck=false).`);
} finally { await rm(workspace, { recursive: true, force: true }); }
