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
import { inspectSkillBundle, packSkillBundle, SKILL_BUNDLE_INSPECTION_LIMITS, SkillBundleInspectionError,
  type InspectSkillBundleOptions, type InspectedSkillBundle, type SkillBundleEntry, type OwnedBytes } from "@hasna/skills/sdk";
const inspectionOptions: InspectSkillBundleOptions = { limits: { entries: 1, timeoutMs: 1000 }, signal: new AbortController().signal };
const inspection: Promise<InspectedSkillBundle> = inspectSkillBundle(new Uint8Array(), inspectionOptions);
const packedBundle = packSkillBundle("fixture", { maxUnpackedBytes: 1024 });
const packedBody: OwnedBytes = packedBundle.bytes;
declare const inspected: InspectedSkillBundle;
const inspectedEntry: SkillBundleEntry | undefined = inspected.entries[0];
const ownedBody: ArrayBuffer | undefined = inspectedEntry?.bytes.buffer;
const inspectionCode: "BUNDLE_INVALID" | "BUNDLE_LIMIT" | "BUNDLE_ABORTED" | "BUNDLE_TIMEOUT" = new SkillBundleInspectionError("BUNDLE_INVALID", "fixture").code;
// @ts-expect-error Inspection is asynchronous; partial entries never escape.
const partialInspection: InspectedSkillBundle = inspection;
// @ts-expect-error Finite limits are numeric, never an off switch.
const disabledInspection: InspectSkillBundleOptions = { limits: { decompressedBytes: false } };
// @ts-expect-error Hard ceilings are immutable.
SKILL_BUNDLE_INSPECTION_LIMITS.entries = 0;
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
const workspaceContext: import("@hasna/skills/sdk").RemoteWorkspaceContext = { userId: "observed-user", membershipId: "observed-membership" };
const rootWorkspaceContext: import("@hasna/skills").RemoteWorkspaceContext = workspaceContext;
client.listAccountWorkspaces();
client.switchWorkspace(workspaceContext);
auth.listAccountWorkspaces("reader@example.test", "000000", workspaceContext.userId);
auth.switchWorkspace("reader@example.test", "000000", workspaceContext);
auth.updateCurrentWorkspace("reader@example.test", "000000", { name: "Selected" }, workspaceContext);
auth.listWorkspaceMembers("reader@example.test", "000000", { limit: 1 }, workspaceContext);
auth.createApiKey("reader@example.test", "000000", "selected", ["skills:read"], workspaceContext);
import * as InvRoot from "@hasna/skills";
const invitationListRoot: InvRoot.ListRemoteWorkspaceInvitations = { after: "observed-cursor" };
const invitationIssueRoot: InvRoot.IssueRemoteWorkspaceInvitation = { email: "recipient@example.test", role: "viewer", idempotencyKey: "stable-key", confirm: true };
const invitationResendRoot: InvRoot.ResendRemoteWorkspaceInvitation = { expectedGeneration: 1, idempotencyKey: "stable-key", confirm: true };
const invitationRevokeRoot: InvRoot.RevokeRemoteWorkspaceInvitation = { expectedGeneration: 1, confirm: true };
const invitationAcceptRoot: InvRoot.AcceptRemoteWorkspaceInvitation = { token: "secret-input-only", confirm: true };
declare const invitationRoot: InvRoot.RemoteWorkspaceInvitation;
declare const invitationPageRoot: InvRoot.RemoteWorkspaceInvitationsPage;
declare const invitationResultRoot: InvRoot.RemoteWorkspaceInvitationResult;
declare const invitationAcceptedRoot: InvRoot.RemoteWorkspaceInvitationAcceptance;
const invitationErrorCodeRoot: InvRoot.RemoteWorkspaceInvitationErrorCode = "INVITATION_FORBIDDEN";
new InvRoot.RemoteWorkspaceInvitationError(invitationErrorCodeRoot);
new InvRoot.WorkspaceInvitationInputError(); new InvRoot.RemoteWorkspaceInvitationReadError(); new InvRoot.RemoteWorkspaceInvitationUnconfirmedError();
const invitationClientRoot = new InvRoot.RemoteSkillsClient("fixture", "https://skills.example.com/api/v1");
const invitationAuthRoot = new InvRoot.RemoteSkillsAuthClient("https://skills.example.com/api/v1");
invitationClientRoot.listWorkspaceInvitations(workspaceContext, invitationListRoot);
invitationClientRoot.getWorkspaceInvitation(workspaceContext, "observed-invitation");
invitationClientRoot.issueWorkspaceInvitation(workspaceContext, invitationIssueRoot);
invitationClientRoot.resendWorkspaceInvitation(workspaceContext, "observed-invitation", invitationResendRoot);
invitationClientRoot.revokeWorkspaceInvitation(workspaceContext, "observed-invitation", invitationRevokeRoot);
invitationClientRoot.acceptWorkspaceInvitation(workspaceContext, "observed-invitation", invitationAcceptRoot);
invitationAuthRoot.listWorkspaceInvitations("reader@example.test", "000000", workspaceContext, invitationListRoot);
invitationAuthRoot.getWorkspaceInvitation("reader@example.test", "000000", workspaceContext, "observed-invitation");
invitationAuthRoot.issueWorkspaceInvitation("reader@example.test", "000000", workspaceContext, invitationIssueRoot);
invitationAuthRoot.resendWorkspaceInvitation("reader@example.test", "000000", workspaceContext, "observed-invitation", invitationResendRoot);
invitationAuthRoot.revokeWorkspaceInvitation("reader@example.test", "000000", workspaceContext, "observed-invitation", invitationRevokeRoot);
invitationAuthRoot.acceptWorkspaceInvitation("reader@example.test", "000000", workspaceContext, "observed-invitation", invitationAcceptRoot);
const invitationRoleRoot: "owner" | "admin" | "member" | "viewer" = invitationRoot.role;
const invitationStatusRoot: "queued" | "sending" | "uncertain" | "provider_accepted" | "failed" | "cancelled" = invitationRoot.delivery.state;
const invitationChangedRoot: boolean = invitationResultRoot.changed;
const invitationAcceptedFlagRoot: true = invitationAcceptedRoot.accepted;
// @ts-expect-error Confirmation cannot degrade to optional or any.
invitationClientRoot.issueWorkspaceInvitation(workspaceContext, { email: "recipient@example.test", role: "member", idempotencyKey: "stable-key" });
// @ts-expect-error Expected generation is numeric.
const wrongInvitationGenerationRoot: string = invitationRoot.generation;
// @ts-expect-error A projection never returns the acceptance secret.
const exposedInvitationTokenRoot: string = invitationRoot.token;
// @ts-expect-error Pagination retains useful item types.
const wrongInvitationIdRoot: number = invitationPageRoot.invitations[0]!.id;
// @ts-expect-error Accepted flag is a literal true.
const wrongInvitationAcceptedRoot: false = invitationAcceptedRoot.accepted;
// @ts-expect-error Error codes are closed.
const wrongInvitationCodeRoot: InvRoot.RemoteWorkspaceInvitationErrorCode = "UNKNOWN";

import * as InvSdk from "@hasna/skills/sdk";
const invitationListSdk: InvSdk.ListRemoteWorkspaceInvitations = { after: "observed-cursor" };
const invitationIssueSdk: InvSdk.IssueRemoteWorkspaceInvitation = { email: "recipient@example.test", role: "viewer", idempotencyKey: "stable-key", confirm: true };
const invitationResendSdk: InvSdk.ResendRemoteWorkspaceInvitation = { expectedGeneration: 1, idempotencyKey: "stable-key", confirm: true };
const invitationRevokeSdk: InvSdk.RevokeRemoteWorkspaceInvitation = { expectedGeneration: 1, confirm: true };
const invitationAcceptSdk: InvSdk.AcceptRemoteWorkspaceInvitation = { token: "secret-input-only", confirm: true };
declare const invitationSdk: InvSdk.RemoteWorkspaceInvitation;
declare const invitationPageSdk: InvSdk.RemoteWorkspaceInvitationsPage;
declare const invitationResultSdk: InvSdk.RemoteWorkspaceInvitationResult;
declare const invitationAcceptedSdk: InvSdk.RemoteWorkspaceInvitationAcceptance;
const invitationErrorCodeSdk: InvSdk.RemoteWorkspaceInvitationErrorCode = "INVITATION_FORBIDDEN";
new InvSdk.RemoteWorkspaceInvitationError(invitationErrorCodeSdk);
new InvSdk.WorkspaceInvitationInputError(); new InvSdk.RemoteWorkspaceInvitationReadError(); new InvSdk.RemoteWorkspaceInvitationUnconfirmedError();
const invitationClientSdk = new InvSdk.RemoteSkillsClient("fixture", "https://skills.example.com/api/v1");
const invitationAuthSdk = new InvSdk.RemoteSkillsAuthClient("https://skills.example.com/api/v1");
invitationClientSdk.listWorkspaceInvitations(workspaceContext, invitationListSdk);
invitationClientSdk.getWorkspaceInvitation(workspaceContext, "observed-invitation");
invitationClientSdk.issueWorkspaceInvitation(workspaceContext, invitationIssueSdk);
invitationClientSdk.resendWorkspaceInvitation(workspaceContext, "observed-invitation", invitationResendSdk);
invitationClientSdk.revokeWorkspaceInvitation(workspaceContext, "observed-invitation", invitationRevokeSdk);
invitationClientSdk.acceptWorkspaceInvitation(workspaceContext, "observed-invitation", invitationAcceptSdk);
invitationAuthSdk.listWorkspaceInvitations("reader@example.test", "000000", workspaceContext, invitationListSdk);
invitationAuthSdk.getWorkspaceInvitation("reader@example.test", "000000", workspaceContext, "observed-invitation");
invitationAuthSdk.issueWorkspaceInvitation("reader@example.test", "000000", workspaceContext, invitationIssueSdk);
invitationAuthSdk.resendWorkspaceInvitation("reader@example.test", "000000", workspaceContext, "observed-invitation", invitationResendSdk);
invitationAuthSdk.revokeWorkspaceInvitation("reader@example.test", "000000", workspaceContext, "observed-invitation", invitationRevokeSdk);
invitationAuthSdk.acceptWorkspaceInvitation("reader@example.test", "000000", workspaceContext, "observed-invitation", invitationAcceptSdk);
const invitationRoleSdk: "owner" | "admin" | "member" | "viewer" = invitationSdk.role;
const invitationStatusSdk: "queued" | "sending" | "uncertain" | "provider_accepted" | "failed" | "cancelled" = invitationSdk.delivery.state;
const invitationChangedSdk: boolean = invitationResultSdk.changed;
const invitationAcceptedFlagSdk: true = invitationAcceptedSdk.accepted;
// @ts-expect-error Confirmation cannot degrade to optional or any.
invitationClientSdk.issueWorkspaceInvitation(workspaceContext, { email: "recipient@example.test", role: "member", idempotencyKey: "stable-key" });
// @ts-expect-error Expected generation is numeric.
const wrongInvitationGenerationSdk: string = invitationSdk.generation;
// @ts-expect-error A projection never returns the acceptance secret.
const exposedInvitationTokenSdk: string = invitationSdk.token;
// @ts-expect-error Pagination retains useful item types.
const wrongInvitationIdSdk: number = invitationPageSdk.invitations[0]!.id;
// @ts-expect-error Accepted flag is a literal true.
const wrongInvitationAcceptedSdk: false = invitationAcceptedSdk.accepted;
// @ts-expect-error Error codes are closed.
const wrongInvitationCodeSdk: InvSdk.RemoteWorkspaceInvitationErrorCode = "UNKNOWN";

declare const selectedSession: Awaited<ReturnType<typeof auth.switchWorkspace>>;
const sessionContract: import("@hasna/skills/sdk").RemoteWorkspaceSession = selectedSession;
const rootSessionContract: import("@hasna/skills").RemoteWorkspaceSession = sessionContract;
const selectedMembership: string = selectedSession.user.membershipId;
const selectedRole: "owner" | "admin" | "member" | "viewer" = selectedSession.user.role;
declare const discoveredWorkspaces: Awaited<ReturnType<typeof auth.listAccountWorkspaces>>;
const discoveredUser: string = discoveredWorkspaces.userId;
const currentWorkspace: boolean = discoveredWorkspaces.workspaces[0]!.current;
// @ts-expect-error Workspace selection binds the expected user too.
client.switchWorkspace({ membershipId: "observed-membership" });
// @ts-expect-error Slugs cannot select a membership incarnation.
auth.switchWorkspace("reader@example.test", "000000", { userId: "observed-user", slug: "workspace" });
// @ts-expect-error Captured context is immutable.
workspaceContext.membershipId = "changed";
// @ts-expect-error Session roles retain concrete inference, not any.
const inventedSelectionRole: "superuser" = selectedSession.user.role;
// @ts-expect-error Safe discovery never exposes session credentials.
const listedToken: string = discoveredWorkspaces.token;
// @ts-expect-error A boolean current flag cannot lose inference to any.
const wrongCurrentFlag: string = discoveredWorkspaces.workspaces[0]!.current;
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
client.setWorkspaceMemberRole(rosterMember.membershipId, { role: "viewer", expectedRole: "member" });
auth.setWorkspaceMemberRole("owner@example.test", "000000", rosterMember.membershipId, { role: "admin", expectedRole: "member" });
client.removeWorkspaceMember(rosterMember.membershipId, { expectedRole: "viewer" });
auth.removeWorkspaceMember("owner@example.test", "000000", rosterMember.membershipId, { expectedRole: "member" });
declare const roleResult: Awaited<ReturnType<typeof client.setWorkspaceMemberRole>>;
declare const removeResult: Awaited<ReturnType<typeof auth.removeWorkspaceMember>>;
const typedRoleResult: import("@hasna/skills/sdk").RemoteWorkspaceMemberRoleResult = roleResult;
const typedRemoval: import("@hasna/skills").RemoteWorkspaceMemberRemovalResult = removeResult;
const changedMember: import("@hasna/skills").RemoteWorkspaceMember = roleResult.member;
const roleChanged: boolean = roleResult.changed;
const removedMembership: true = removeResult.removed;
const alreadyRemoved: boolean = removeResult.alreadyRemoved;
declare const memberError: import("@hasna/skills/sdk").RemoteWorkspaceMemberError;
const memberRequestError: RemoteRequestError = memberError;
const memberErrorCode: import("@hasna/skills").RemoteWorkspaceMemberErrorCode = memberError.code;
// @ts-expect-error A role change requires the observed concurrency precondition.
client.setWorkspaceMemberRole(rosterMember.membershipId, { role: "viewer" });
// @ts-expect-error Removal requires the observed role.
auth.removeWorkspaceMember("owner@example.test", "000000", rosterMember.membershipId, {});
// @ts-expect-error A caller cannot select another workspace through this mutation.
client.removeWorkspaceMember(rosterMember.membershipId, { expectedRole: "member", organizationId: "other" });
// @ts-expect-error Roles remain the documented union, not arbitrary strings.
auth.setWorkspaceMemberRole("owner@example.test", "000000", rosterMember.membershipId, { role: "superuser", expectedRole: "member" });
// @ts-expect-error Results preserve concrete booleans and cannot degrade to any.
const numericChanged: number = roleResult.changed;
// @ts-expect-error Removal is a positive literal, never an assumed false success.
const removalFalse: false = removeResult.removed;
// @ts-expect-error Exact server timestamps remain strings.
const roundedMemberTimestamp: Date = roleResult.member.createdAt;
// @ts-expect-error Membership refusal codes do not contain arbitrary server strings.
const arbitraryMemberCode: "ARBITRARY_SERVER_CODE" = memberError.code;
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
  await writeFile(join(workspace, "bundle-runtime.ts"), `
import { strict as assert } from "node:assert";
import { mkdirSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { getEventListeners } from "node:events";
import { inspectSkillBundle, packSkillBundle, SkillBundleInspectionError } from "@hasna/skills/sdk";
mkdirSync("bundle-fixture"); writeFileSync("bundle-fixture/SKILL.md", "# Installed fixture");
const packed = packSkillBundle("bundle-fixture");
const inspected = await inspectSkillBundle(packed.bytes);
assert.equal(inspected.sha256, packed.sha256);
assert.equal(inspected.fileCount, 1);
assert.equal(inspected.entries[0].path, "SKILL.md");
assert.equal(new TextDecoder().decode(inspected.entries[0].bytes), "# Installed fixture");
assert.equal(inspected.entries[0].bytes.byteLength, inspected.entries[0].bytes.buffer.byteLength);
assert.notEqual(inspected.entries[0].bytes.buffer, packed.bytes.buffer);
await assert.rejects(inspectSkillBundle(gzipSync(new Uint8Array(1024 * 1024)), { limits: { decompressedBytes: 512 } }),
  error => error instanceof SkillBundleInspectionError && error.code === "BUNDLE_LIMIT");
const controller = new AbortController(); controller.abort();
await assert.rejects(inspectSkillBundle(packed.bytes, { signal: controller.signal }),
  error => error instanceof SkillBundleInspectionError && error.code === "BUNDLE_ABORTED");
const expansion = gzipSync(new Uint8Array(64 * 1024 * 1024));
const midstream = new AbortController();
const pending = inspectSkillBundle(expansion, { signal: midstream.signal });
const abortTimer = setTimeout(() => midstream.abort(), 1);
try { await assert.rejects(pending, error => error instanceof SkillBundleInspectionError && error.code === "BUNDLE_ABORTED"); }
finally { clearTimeout(abortTimer); }
assert.equal(getEventListeners(midstream.signal, "abort").length, 0);
const timed = new AbortController();
await assert.rejects(inspectSkillBundle(expansion, { signal: timed.signal, limits: { timeoutMs: 1 } }),
  error => error instanceof SkillBundleInspectionError && error.code === "BUNDLE_TIMEOUT");
assert.equal(getEventListeners(timed.signal, "abort").length, 0);
assert.equal((await inspectSkillBundle(packed.bytes)).sha256, packed.sha256);
console.log("Installed bundle SDK runtime: 13 assertions passed.");
`);
  await run([process.execPath, "install", "--ignore-scripts", "--registry", "https://registry.npmjs.org"], workspace);
  await run([process.execPath, "node_modules/typescript/bin/tsc", "-p", "tsconfig.json"], workspace);
  console.log((await run([process.execPath, "--no-env-file", "admin-list-runtime.ts"], workspace)).trim());
  console.log((await run([process.execPath, "--no-env-file", "bundle-runtime.ts"], workspace)).trim());
  console.log(`Consumer types: @hasna/skills@${metadata.version} passed strict installed-package checking for all four exports (skipLibCheck=false).`);
} finally { await rm(workspace, { recursive: true, force: true }); }
