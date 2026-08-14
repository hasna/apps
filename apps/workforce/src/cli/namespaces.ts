import { writeFileSync, readFileSync } from "node:fs";
import { Command } from "commander";
import { openApiDocument, openApiDocumentJson } from "../api/index.js";
import {
  assignmentService,
  capabilityService,
  exportService,
  lifecycleService,
  memberService,
} from "../services/index.js";
import type { CapabilityLevel, MemberKind, MemberStatus } from "../types/index.js";
import { toErrorEnvelope } from "../types/index.js";
import { resolveDbPath, resolveStorageMode, databaseUrlPresent } from "../config.js";
import { getDatabase } from "../db/database.js";
import { SYSTEM_AUTHORIZATION_CONTEXT, type AuthorizationContext } from "../services/authorization.js";
import { emit } from "./context.js";

function handle(json: boolean, fn: () => unknown): void {
  try {
    emit(fn(), json);
  } catch (error) {
    const env = toErrorEnvelope(error);
    if (json) {
      console.error(JSON.stringify({ ...env, error: env.message }));
    } else {
      console.error([env.message, env.suggestion].filter(Boolean).join(" "));
    }
    process.exitCode = 1;
  }
}

function isJson(cmd: Command): boolean {
  return Boolean((cmd.optsWithGlobals() as { json?: boolean }).json);
}

export function registerNamespaces(program: Command, authCtx: AuthorizationContext = SYSTEM_AUTHORIZATION_CONTEXT): void {
  // Every CLI action runs under the resolved principal: SYSTEM bypass for the
  // trusted local operator, or a scoped NON-bypass principal when an API token is
  // supplied — so CLI enforces scope identically to the MCP and /v1 surfaces.
  const ctx = () => authCtx;
  // ---- member ----
  const member = program.command("member").description("Roster member operations");
  member
    .command("list")
    .description("List members")
    .option("--kind <kind>")
    .option("--status <status>")
    .option("--owner <id>")
    .option("--entity <id>")
    .action((opts, cmd: Command) =>
      handle(isJson(cmd), () =>
        memberService.listMembers(
          {
            ...(opts.kind ? { kind: opts.kind as MemberKind } : {}),
            ...(opts.status ? { status: opts.status as MemberStatus } : {}),
            ...(opts.owner ? { owner_id: opts.owner } : {}),
            ...(opts.entity ? { entity_id: opts.entity } : {}),
          },
          ctx(),
        ),
      ),
    );
  member
    .command("get <id>")
    .description("Get a member by id")
    .action((id: string, _opts, cmd: Command) => handle(isJson(cmd), () => memberService.getMember(id, ctx())));
  member
    .command("create")
    .description("Onboard a member (human|contractor|agent)")
    .requiredOption("--kind <kind>", "human|contractor|agent")
    .requiredOption("--name <name>")
    .requiredOption("--entity <uuid>", "home entity id (UUIDv4)")
    .option("--slug <slug>", "home entity slug")
    .option("--role <role>")
    .option("--owner <id>", "owning human member id (required for agents)")
    .option("--email <email>")
    .option("--effective-date <date>")
    .action((opts, cmd: Command) =>
      handle(isJson(cmd), () =>
        memberService.createMember(
          {
            kind: opts.kind as MemberKind,
            name: opts.name,
            home_entity_id: opts.entity,
            home_entity_slug: opts.slug ?? null,
            role: opts.role,
            owner_id: opts.owner ?? null,
            email: opts.email ?? null,
            effective_date: opts.effectiveDate,
          },
          ctx(),
        ),
      ),
    );
  member
    .command("update <id>")
    .description("Update member attributes")
    .option("--name <name>")
    .option("--role <role>")
    .option("--slug <slug>")
    .option("--email <email>")
    .option("--owner <id>")
    .option("--expected-version <n>")
    .action((id: string, opts, cmd: Command) =>
      handle(isJson(cmd), () =>
        memberService.updateMember(
          id,
          {
            name: opts.name,
            role: opts.role,
            home_entity_slug: opts.slug,
            email: opts.email,
            owner_id: opts.owner,
            expected_version: opts.expectedVersion ? Number(opts.expectedVersion) : undefined,
          },
          ctx(),
        ),
      ),
    );

  // ---- capability ----
  const capability = program.command("capability").description("Member capability catalog");
  capability
    .command("list <member_id>")
    .description("List a member's capabilities")
    .action((memberId: string, _opts, cmd: Command) => handle(isJson(cmd), () => capabilityService.listCapabilities(memberId, ctx())));
  capability
    .command("add <member_id>")
    .description("Add a capability to a member")
    .requiredOption("--name <name>")
    .option("--category <category>")
    .option("--level <level>", "novice|intermediate|advanced|expert")
    .option("--notes <notes>")
    .action((memberId: string, opts, cmd: Command) =>
      handle(isJson(cmd), () =>
        capabilityService.addCapability(
          { member_id: memberId, name: opts.name, category: opts.category, level: opts.level as CapabilityLevel | undefined, notes: opts.notes ?? null },
          ctx(),
        ),
      ),
    );
  capability
    .command("remove <id>")
    .description("Remove a capability by id")
    .action((id: string, _opts, cmd: Command) => handle(isJson(cmd), () => capabilityService.removeCapability(id, ctx())));

  // ---- lifecycle ----
  const lifecycle = program.command("lifecycle").description("Joiner-mover-leaver lifecycle");
  lifecycle
    .command("list <member_id>")
    .description("List a member's lifecycle events")
    .action((memberId: string, _opts, cmd: Command) => handle(isJson(cmd), () => lifecycleService.listMemberLifecycle(memberId, ctx())));
  lifecycle
    .command("role-change <member_id>")
    .description("Record a role change")
    .requiredOption("--to-role <role>")
    .option("--effective-date <date>")
    .option("--reason <reason>")
    .action((memberId: string, opts, cmd: Command) =>
      handle(isJson(cmd), () => lifecycleService.recordRoleChange({ member_id: memberId, to_role: opts.toRole, effective_date: opts.effectiveDate, reason: opts.reason }, ctx())),
    );
  for (const [name, fn, desc] of [
    ["suspend", "suspendMember", "Suspend a member"],
    ["reactivate", "reactivateMember", "Reactivate a suspended member"],
    ["offboard", "offboardMember", "Offboard a member"],
  ] as const) {
    lifecycle
      .command(`${name} <member_id>`)
      .description(desc)
      .option("--effective-date <date>")
      .option("--reason <reason>")
      .action((memberId: string, opts, cmd: Command) =>
        handle(isJson(cmd), () => (lifecycleService[fn] as (i: unknown, c: unknown) => unknown)({ member_id: memberId, effective_date: opts.effectiveDate, reason: opts.reason }, ctx())),
      );
  }
  lifecycle
    .command("verify")
    .description("Verify the tamper-evident lifecycle audit chain")
    .action((_opts, cmd: Command) => handle(isJson(cmd), () => lifecycleService.verifyLifecycleAudit(ctx())));

  // ---- assignment ----
  const assignment = program.command("assignment").description("Member-to-entity/project assignments");
  assignment
    .command("list")
    .description("List assignments")
    .option("--member <id>")
    .option("--entity <id>")
    .option("--status <status>")
    .action((opts, cmd: Command) =>
      handle(isJson(cmd), () =>
        assignmentService.listAssignments(
          { ...(opts.member ? { member_id: opts.member } : {}), ...(opts.entity ? { entity_id: opts.entity } : {}), ...(opts.status ? { status: opts.status } : {}) },
          ctx(),
        ),
      ),
    );
  assignment
    .command("get <id>")
    .description("Get an assignment by id")
    .action((id: string, _opts, cmd: Command) => handle(isJson(cmd), () => assignmentService.getAssignment(id, ctx())));
  assignment
    .command("create")
    .description("Assign a member to an entity/project")
    .requiredOption("--member <id>")
    .requiredOption("--entity <uuid>")
    .option("--project <project>")
    .option("--role <role>")
    .option("--allocation <pct>")
    .option("--start-date <date>")
    .option("--end-date <date>")
    .action((opts, cmd: Command) =>
      handle(isJson(cmd), () =>
        assignmentService.createAssignment(
          {
            member_id: opts.member,
            entity_id: opts.entity,
            project: opts.project ?? null,
            role_on_assignment: opts.role,
            allocation_pct: opts.allocation ? Number(opts.allocation) : undefined,
            start_date: opts.startDate,
            end_date: opts.endDate ?? null,
          },
          ctx(),
        ),
      ),
    );
  assignment
    .command("end <id>")
    .description("End an assignment")
    .option("--end-date <date>")
    .action((id: string, opts, cmd: Command) => handle(isJson(cmd), () => assignmentService.endAssignment(id, { end_date: opts.endDate }, ctx())));

  // ---- export ----
  const exportCmd = program.command("export").description("Payroll/timesheets export contract");
  exportCmd
    .command("roster")
    .description("Export the roster contract")
    .option("--entity <id>")
    .option("--include-offboarded")
    .action((opts, cmd: Command) =>
      handle(isJson(cmd), () => exportService.exportRoster({ ...(opts.entity ? { entity_id: opts.entity } : {}), include_offboarded: Boolean(opts.includeOffboarded) }, ctx())),
    );

  // ---- openapi ----
  const openapi = program.command("openapi").description("OpenAPI document operations");
  openapi
    .command("generate")
    .description("Write the OpenAPI document")
    .option("--out <path>", "output file", "openapi.json")
    .action((opts, cmd: Command) =>
      handle(isJson(cmd), () => {
        writeFileSync(opts.out, openApiDocumentJson() + "\n", "utf8");
        return { ok: true, out: opts.out, paths: Object.keys(openApiDocument.paths).length };
      }),
    );
  openapi
    .command("check")
    .description("Verify a checked-in OpenAPI document matches the code")
    .option("--path <path>", "file to check", "openapi.json")
    .action((opts, cmd: Command) =>
      handle(isJson(cmd), () => {
        const onDisk = readFileSync(opts.path, "utf8").trim();
        const current = openApiDocumentJson().trim();
        if (onDisk !== current) throw new Error(`openapi.json is stale; run: workforce openapi generate --out ${opts.path}`);
        return { ok: true, path: opts.path };
      }),
    );

  // ---- db ----
  const db = program.command("db").description("Storage diagnostics");
  db.command("status")
    .description("Redacted storage status")
    .action((_opts, cmd: Command) =>
      handle(isJson(cmd), () => {
        let mode = "local";
        try {
          mode = resolveStorageMode();
        } catch {
          mode = "local";
        }
        const migrations = getDatabase().query("SELECT COUNT(*) AS n FROM schema_migrations").get() as { n: number };
        return { mode, dsn_present: databaseUrlPresent(), sqlite_path: resolveDbPath(), migrations_applied: migrations.n, remote_reachable: false };
      }),
    );
  db.command("verify-audit")
    .description("Verify the tamper-evident lifecycle audit chain")
    .action((_opts, cmd: Command) => handle(isJson(cmd), () => lifecycleService.verifyLifecycleAudit(ctx())));
}
