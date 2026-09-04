#!/usr/bin/env bun
import { registerEventsCommands } from "@hasna/events/commander";
import { Command } from "commander";
import chalk from "chalk";
import { homedir } from "node:os";
// NOTE: the legacy SQLite migration helpers are NOT imported at module scope.
// This CLI is remote-only in api mode (HASNA_CALENDAR_API_URL configured):
// nothing may open or create a local database then. `db/database.js` is loaded
// lazily only by `db-migrate`, after that command has refused to run in api
// mode — so `new Database(...)` is unreachable whenever the API URL is set.
import { getStore } from "../store/index.js";
import { resolveClientTransport } from "../store/http-storage.js";
import type { CalendarVisibility, EventStatus, EventBusyType, AttendeeStatus, OrgRole } from "../types/index.js";

const packageJson = await Bun.file(new URL("../../package.json", import.meta.url)).json() as { version: string };
const program = new Command();
const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 100;

program
  .name("calendar")
  .description("Universal calendar management for AI coding agents")
  .version(packageJson.version);

program.enablePositionalOptions();
program.exitOverride();
program.configureOutput({
  writeErr: (str) => {
    if (!wantsJson()) process.stderr.write(str);
  },
});

// Global flags
program.option("--agent <name>", "Agent name");
program.option("--org <slug>", "Org slug");
program.option("--json", "Output as JSON");

// ── Org commands ─────────────────────────────────────────────────────────────

calendarCommand("org-add <name>")
  .description("Create a new org")
  .option("--slug <slug>", "Org slug")
  .option("--description <desc>", "Description")
  .action(async (name, opts) => {
    const org = await getStore().createOrg({ name, slug: opts.slug, description: opts.description });
    output(wantsJson(opts) ? JSON.stringify(org) : chalk.green(`Org created: ${org.name} (${org.slug}) [${org.id}]`));
  });

listCommand("org-list")
  .description("List all orgs")
  .action(async (opts) => {
    const orgs = await getStore().listOrgs();
    outputList(orgs, opts, {
      empty: "No orgs",
      hint: "Use --verbose or calendar org-show <id> for details.",
      row: (o) => opts.verbose
        ? `${o.id}  ${o.slug}  ${truncate(o.name, 36)}  desc=${truncate(o.description)}`
        : `${o.id}  ${o.slug}  ${truncate(o.name, 48)}`,
    });
  });

calendarCommand("org-show <id>")
  .description("Show org details")
  .action(async (id, opts) => {
    const org = await getStore().getOrg(id);
    if (!org) fail("Org not found");
    output(wantsJson(opts) ? JSON.stringify(org) : `${org.name} (${org.slug})\n  ID: ${org.id}`);
  });

calendarCommand("org-update <id>")
  .description("Update an org")
  .option("--name <name>", "Org name")
  .option("--description <desc>", "Description")
  .action(async (id, opts) => {
    const org = await getStore().updateOrg(id, { name: opts.name, description: opts.description });
    output(wantsJson(opts) ? JSON.stringify(org) : chalk.green(`Org updated: ${org.name}`));
  });

calendarCommand("org-delete <id>")
  .description("Delete an org")
  .action(async (id, opts) => {
    const ok = await getStore().deleteOrg(id);
    outputJsonOrText({ deleted: ok }, ok ? chalk.green("Org deleted") : chalk.red("Org not found"), opts);
  });

// ── Agent commands ───────────────────────────────────────────────────────────

calendarCommand("init <name>")
  .description("Register an agent")
  .option("--description <desc>", "Description")
  .option("--role <role>", "Role")
  .option("--org <org>", "Org ID")
  .action(async (name, opts) => {
    const agent = await getStore().registerAgent({ name, description: opts.description, role: opts.role, org_id: opts.org });
    output(wantsJson(opts) ? JSON.stringify(agent) : chalk.green(`Agent registered: ${agent.name} [${agent.id}]`));
  });

listCommand("agents")
  .description("List agents")
  .action(async (opts) => {
    const agents = await getStore().listAgents();
    outputList(agents, opts, {
      empty: "No agents",
      hint: "Use --verbose for role/session fields. Use --json for full records.",
      row: (a) => opts.verbose
        ? `${a.id}  ${a.name}  status=${a.status}  role=${a.role || "-"}  last_seen=${a.last_seen_at}  dir=${truncate(a.working_dir)}`
        : `${a.id}  ${a.name}  ${a.status}  ${a.role || "-"}`,
    });
  });

calendarCommand("heartbeat [agent]")
  .description("Update agent heartbeat")
  .action(async (agent, opts) => {
    const name = agent || opts.agent || program.opts().agent;
    if (!name) fail("Agent name required");
    const updated = await getStore().heartbeatAgent(name);
    if (!updated) fail("Agent not found");
    outputJsonOrText(updated, chalk.green(`Heartbeat: ${name}`), opts);
  });

calendarCommand("agent-update <id>")
  .description("Update an agent")
  .option("--description <desc>", "Description")
  .option("--role <role>", "Role")
  .action(async (id, opts) => {
    const agent = await getStore().updateAgent(id, { description: opts.description, role: opts.role });
    output(wantsJson(opts) ? JSON.stringify(agent) : chalk.green(`Agent updated: ${agent?.name}`));
  });

calendarCommand("agent-delete <id>")
  .description("Delete an agent")
  .action(async (id, opts) => {
    const ok = await getStore().deleteAgent(id);
    outputJsonOrText({ deleted: ok }, ok ? chalk.green("Agent deleted") : chalk.red("Agent not found"), opts);
  });

// ── Calendar commands ────────────────────────────────────────────────────────

calendarCommand("cal-add <name>")
  .description("Create a calendar")
  .requiredOption("--org <orgId>", "Org ID")
  .option("--slug <slug>", "Calendar slug")
  .option("--description <desc>", "Description")
  .option("--color <color>", "Color hex")
  .option("--timezone <tz>", "Timezone (default: UTC)")
  .option("--visibility <vis>", "Visibility: public, org, private")
  .action(async (name, opts) => {
    const cal = await getStore().createCalendar({
      name,
      org_id: opts.org,
      slug: opts.slug,
      description: opts.description,
      color: opts.color,
      timezone: opts.timezone || "UTC",
      visibility: opts.visibility as CalendarVisibility | undefined,
    });
    output(wantsJson(opts) ? JSON.stringify(cal) : chalk.green(`Calendar created: ${cal.name} [${cal.id}]`));
  });

listCommand("cal-list")
  .description("List calendars")
  .option("--org <orgId>", "Filter by org")
  .action(async (opts) => {
    const cals = await getStore().listCalendars(opts.org || undefined);
    outputList(cals, opts, {
      empty: "No calendars",
      hint: "Use --verbose for org/timezone fields. Use --json for full records.",
      row: (c) => opts.verbose
        ? `${c.id}  ${c.slug}  ${truncate(c.name, 36)}  org=${c.org_id}  tz=${c.timezone}  visibility=${c.visibility}  desc=${truncate(c.description)}`
        : `${c.id}  ${c.slug}  ${truncate(c.name, 48)}  ${c.visibility}`,
    });
  });

calendarCommand("cal-update <id>")
  .description("Update a calendar")
  .option("--name <name>", "Name")
  .option("--description <desc>", "Description")
  .option("--color <color>", "Color")
  .option("--timezone <tz>", "Timezone")
  .option("--visibility <vis>", "Visibility")
  .action(async (id, opts) => {
    const cal = await getStore().updateCalendar(id, {
      name: opts.name,
      description: opts.description,
      color: opts.color,
      timezone: opts.timezone,
      visibility: opts.visibility as CalendarVisibility | undefined,
    });
    output(wantsJson(opts) ? JSON.stringify(cal) : chalk.green(`Calendar updated: ${cal.name}`));
  });

calendarCommand("cal-delete <id>")
  .description("Delete a calendar")
  .action(async (id, opts) => {
    const ok = await getStore().deleteCalendar(id);
    outputJsonOrText({ deleted: ok }, ok ? chalk.green("Calendar deleted") : chalk.red("Calendar not found"), opts);
  });

// ── Event commands ───────────────────────────────────────────────────────────

calendarCommand("add <title>")
  .description("Create an event")
  .requiredOption("--calendar <calendarId>", "Calendar ID")
  .requiredOption("--start <iso>", "Start time (ISO 8601)")
  .requiredOption("--end <iso>", "End time (ISO 8601)")
  .option("--org <orgId>", "Org ID")
  .option("--description <desc>", "Description")
  .option("--location <loc>", "Location")
  .option("--all-day", "All day event")
  .option("--status <status>", "Status: tentative, confirmed, cancelled")
  .option("--busy <type>", "Busy type: busy, free, out_of_office")
  .option("--timezone <tz>", "Timezone")
  .option("--rrule <rule>", "Recurrence rule (RRULE)")
  .option("--source-task <id>", "Link to todos task ID")
  .option("--agent <agentId>", "Creator agent ID")
  .action(async (title, opts) => {
    const store = getStore();
    const cal = await store.getCalendar(opts.calendar);
    if (!cal) fail("Calendar not found");

    const evt = await store.createEvent({
      title,
      calendar_id: opts.calendar,
      org_id: opts.org || cal.org_id,
      start_at: opts.start,
      end_at: opts.end,
      description: opts.description,
      location: opts.location,
      all_day: opts.allDay,
      timezone: opts.timezone || cal.timezone,
      status: opts.status as EventStatus | undefined,
      busy_type: opts.busy as EventBusyType | undefined,
      recurrence_rule: opts.rrule,
      source_task_id: opts.sourceTask,
      created_by: opts.agent,
    });

    output(wantsJson(opts) ? JSON.stringify(evt) : chalk.green(`Event created: ${evt.title}\n  ${evt.start_at} -> ${evt.end_at} [${evt.id}]`));
  });

listCommand("list")
  .description("List events")
  .option("--calendar <calendarId>", "Calendar ID")
  .option("--org <orgId>", "Org ID")
  .option("--after <date>", "After date (ISO)")
  .option("--before <date>", "Before date (ISO)")
  .action(async (opts) => {
    const events = await getStore().listEvents({
      calendar_id: opts.calendar,
      org_id: opts.org,
      after: opts.after,
      before: opts.before,
    });
    outputList(events, opts, {
      empty: "No events",
      hint: "Use --verbose or calendar show <id> for details.",
      row: (e) => opts.verbose
        ? `${e.id}  ${e.start_at} -> ${e.end_at}  ${e.status}  ${truncate(e.title, 44)}  calendar=${e.calendar_id}  location=${truncate(e.location)}  desc=${truncate(e.description)}`
        : `${e.id}  ${e.start_at} -> ${e.end_at}  ${e.status}  ${truncate(e.title, 56)}`,
    });
  });

calendarCommand("show <id>")
  .description("Show event details")
  .action(async (id, opts) => {
    const result = await getStore().getEventWithAttendees(id);
    if (!result) fail("Event not found");
    const { event: evt, attendees } = result;
    output(wantsJson(opts) ? JSON.stringify(result) : `${evt.title}\n  ${evt.start_at} -> ${evt.end_at}\n  Location: ${evt.location || "—"}\n  Status: ${evt.status}\n  Attendees: ${attendees.length}`);
  });

calendarCommand("update <id>")
  .description("Update an event")
  .option("--title <title>", "Title")
  .option("--start <iso>", "Start time")
  .option("--end <iso>", "End time")
  .option("--description <desc>", "Description")
  .option("--location <loc>", "Location")
  .option("--status <status>", "Status")
  .action(async (id, opts) => {
    const evt = await getStore().updateEvent(id, {
      title: opts.title,
      start_at: opts.start,
      end_at: opts.end,
      description: opts.description,
      location: opts.location,
      status: opts.status as EventStatus | undefined,
    });
    output(wantsJson(opts) ? JSON.stringify(evt) : chalk.green(`Event updated: ${evt.title}`));
  });

calendarCommand("delete <id>")
  .description("Delete an event")
  .action(async (id, opts) => {
    const ok = await getStore().deleteEvent(id);
    outputJsonOrText({ deleted: ok }, ok ? chalk.green("Event deleted") : chalk.red("Event not found"), opts);
  });

listCommand("search <query>")
  .description("Search events (full-text)")
  .option("--org <orgId>", "Org ID")
  .action(async (query, opts) => {
    const events = await getStore().searchEvents(query, opts.org || undefined);
    outputList(events, opts, {
      empty: "No results",
      hint: "Use --verbose or calendar show <id> for details.",
      row: (e) => opts.verbose
        ? `${e.id}  ${e.start_at} -> ${e.end_at}  ${e.status}  ${truncate(e.title, 44)}  location=${truncate(e.location)}  desc=${truncate(e.description)}`
        : `${e.id}  ${e.start_at}  ${truncate(e.title, 64)}`,
    });
  });

listCommand("conflicts <calendarId>")
  .description("Find conflicting events for a time range")
  .requiredOption("--start <iso>", "Start time")
  .requiredOption("--end <iso>", "End time")
  .action(async (calendarId, opts) => {
    const conflicts = await getStore().findConflicts(calendarId, { start: opts.start, end: opts.end });
    outputList(conflicts, opts, {
      empty: "No conflicts",
      hint: "Use --verbose or calendar show <id> for details.",
      row: (e) => opts.verbose
        ? `${e.id}  ${e.start_at} -> ${e.end_at}  ${e.status}  ${truncate(e.title, 44)}  location=${truncate(e.location)}`
        : `${e.id}  ${e.start_at} -> ${e.end_at}  ${truncate(e.title, 56)}`,
    });
  });

// ── Attendee commands ────────────────────────────────────────────────────────

calendarCommand("attendee-add")
  .description("Add attendee to event")
  .requiredOption("--event <eventId>", "Event ID")
  .option("--agent <agentId>", "Agent ID")
  .option("--name <name>", "Display name")
  .option("--email <email>", "Email")
  .option("--required", "Required attendee (default)")
  .option("--optional", "Optional attendee")
  .action(async (opts) => {
    const attendee = await getStore().createAttendee({
      event_id: opts.event,
      agent_id: opts.agent,
      display_name: opts.name,
      email: opts.email,
      required: !opts.optional,
    });
    output(wantsJson(opts) ? JSON.stringify(attendee) : chalk.green(`Attendee added: ${attendee.display_name || attendee.agent_id || attendee.email || "?"} [${attendee.id}]`));
  });

calendarCommand("attendee-respond <attendeeId>")
  .description("Respond to event invitation")
  .requiredOption("--status <status>", "Status: accepted, declined, tentative")
  .option("--comment <comment>", "Response comment")
  .action(async (attendeeId, opts) => {
    const attendee = await getStore().updateAttendee(attendeeId, { status: opts.status as AttendeeStatus, response_comment: opts.comment || null });
    output(wantsJson(opts) ? JSON.stringify(attendee) : chalk.green(`Response recorded: ${attendee.status}`));
  });

calendarCommand("attendee-delete <id>")
  .description("Delete an attendee")
  .action(async (id, opts) => {
    const ok = await getStore().deleteAttendee(id);
    outputJsonOrText({ deleted: ok }, ok ? chalk.green("Attendee deleted") : chalk.red("Attendee not found"), opts);
  });

// ── Availability commands ────────────────────────────────────────────────────

calendarCommand("availability-set")
  .description("Set agent availability for a day of week")
  .requiredOption("--agent <agentId>", "Agent ID")
  .requiredOption("--org <orgId>", "Org ID")
  .requiredOption("--day <0-6>", "Day of week (0=Sun, 6=Sat)", parseInt)
  .requiredOption("--start <HH:mm>", "Start time")
  .requiredOption("--end <HH:mm>", "End time")
  .action(async (opts) => {
    const av = await getStore().upsertAgentAvailability(opts.agent, opts.org, opts.day, opts.start, opts.end);
    output(wantsJson(opts) ? JSON.stringify(av) : chalk.green(`Availability set: day ${opts.day} ${opts.start}-${opts.end} [${av.id}]`));
  });

listCommand("availability-show <agentId>")
  .description("Show agent availability")
  .option("--org <orgId>", "Org ID")
  .action(async (agentId, opts) => {
    const avail = await getStore().getAvailabilityForAgent(agentId, opts.org || undefined);
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    outputList(avail, opts, {
      empty: "No availability set",
      hint: "Use --verbose for IDs/org fields. Use --json for full records.",
      row: (a) => opts.verbose
        ? `${a.id}  ${days[a.day_of_week]}  ${a.start_time}-${a.end_time}  org=${a.org_id}  agent=${a.agent_id}`
        : `${days[a.day_of_week]}  ${a.start_time}-${a.end_time}  org=${a.org_id}`,
    });
  });

calendarCommand("availability-delete <id>")
  .description("Delete an availability entry")
  .action(async (id, opts) => {
    const ok = await getStore().deleteAvailability(id);
    outputJsonOrText({ deleted: ok }, ok ? chalk.green("Availability deleted") : chalk.red("Availability not found"), opts);
  });

// ── Membership commands ──────────────────────────────────────────────────────

calendarCommand("member-add")
  .description("Add agent to org")
  .requiredOption("--org <orgId>", "Org ID")
  .requiredOption("--agent <agentId>", "Agent ID")
  .option("--role <role>", "Role: admin, member, service")
  .action(async (opts) => {
    const m = await getStore().createMembership({ org_id: opts.org, agent_id: opts.agent, role: opts.role as OrgRole | undefined });
    output(wantsJson(opts) ? JSON.stringify(m) : chalk.green(`Added ${opts.agent} to org ${opts.org} as ${m.role}`));
  });

listCommand("members <orgId>")
  .description("List org members")
  .action(async (orgId, opts) => {
    const members = await getStore().getMembershipsForOrg(orgId);
    outputList(members, opts, {
      empty: "No members",
      hint: "Use --verbose for membership IDs. Use --json for full records.",
      row: (m) => opts.verbose
        ? `${m.id}  agent=${m.agent_id}  role=${m.role}  created=${m.created_at}`
        : `${m.agent_id}  ${m.role}`,
    });
  });

calendarCommand("member-remove <agentId> <orgId>")
  .description("Remove agent from org")
  .action(async (agentId, orgId, opts) => {
    const ok = await getStore().deleteMembershipByAgentAndOrg(agentId, orgId);
    outputJsonOrText({ removed: ok }, ok ? chalk.green("Member removed") : chalk.red("Member not found"), opts);
  });

// ── Agent org management ─────────────────────────────────────────────────────

listCommand("agent-orgs <agentId>")
  .description("List orgs an agent belongs to")
  .action(async (agentId, opts) => {
    const orgs = await getStore().getOrgsForAgent(agentId);
    outputList(orgs, opts, {
      empty: "No orgs",
      hint: "Use --verbose for membership IDs. Use --json for full records.",
      row: (m) => opts.verbose
        ? `${m.id}  org=${m.org_id}  role=${m.role}  created=${m.created_at}`
        : `${m.org_id}  ${m.role}`,
    });
  });

// ── Status ────────────────────────────────────────────────────────────────────

calendarCommand("status")
  .description("Show CLI version, store transport, and record counts")
  .action(async (opts) => {
    const report: Record<string, unknown> = {
      service: "calendar",
      version: packageJson.version,
    };
    let text = `calendar v${packageJson.version}`;
    // Classify BEFORE any request: only a box with no resolvable API URL + key
    // (the same check resolveStorageClient uses) reports "unconfigured". A
    // configured box whose API call fails (401, 5xx, network down) is a
    // transport error, never a config status — relabeling it "unconfigured"
    // would hide the very drift this command exists to expose (hasna/apps#1602).
    if (resolveClientTransport("calendar", process.env).transport === "unconfigured") {
      report.transport = "unconfigured";
      text = `calendar v${packageJson.version} — not configured (set HASNA_CALENDAR_API_URL plus a calendar API key)`;
    } else {
      try {
        const store = getStore();
        const [orgs, calendars] = await Promise.all([store.listOrgs(), store.listCalendars()]);
        report.transport = store.transport;
        report.counts = { orgs: orgs.length, calendars: calendars.length };
        text = `calendar v${packageJson.version} — transport: ${store.transport}, orgs: ${orgs.length}, calendars: ${calendars.length}`;
      } catch (err) {
        report.transport = "error";
        report.error = err instanceof Error ? err.message : String(err);
        text = `calendar v${packageJson.version} — transport error (${report.error})`;
      }
    }
    outputJsonOrText(report, text, opts);
  });

// ── Local database (legacy, LOCAL-ONLY) ─────────────────────────────────────

function isApiModeConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["HASNA_CALENDAR_API_URL"] !== undefined || env["CALENDAR_API_URL"] !== undefined
    || env["HASNA_CALENDAR_API_KEY"] !== undefined || env["CALENDAR_API_KEY"] !== undefined;
}

calendarCommand("db-migrate")
  .description("One-time migration of legacy non-canonical calendar data into ~/.hasna/calendar (LOCAL-ONLY; refused in api mode)")
  .option("--dry-run", "Report what would migrate without writing anything")
  .action(async (opts) => {
    // Fleet doctrine (docs/fleet-local-storage.md): in api mode the hosted API
    // is the only write path — a fleet CLI must not create, open, or migrate
    // any local database. Refuse BEFORE the sqlite layer is even loaded, and
    // emit no legacy-data JSON (it would leak local paths).
    if (isApiModeConfigured()) {
      fail(
        "calendar db-migrate is LOCAL-ONLY and refused in api mode: HASNA_CALENDAR_API_URL "
          + "is configured, so the hosted API is the only write path and no local database "
          + "may be created or migrated. Unset the API URL/key to run the one-time legacy migration.",
      );
    }
    // Loaded only here, only in local mode: keeps `bun:sqlite` out of the
    // api-mode CLI bundle and makes the local tier unreachable in api mode.
    const { migrateLegacyData, scanLegacyData } = await import("../db/database.js");
    const scan = scanLegacyData();
    if (opts.dryRun) {
      outputJsonOrText(scan, `Legacy data scan: ${scan.reason} (source: ${scan.source ?? "none"}, target: ${scan.target})`, opts);
      return;
    }
    if (!scan.wouldMigrate) {
      outputJsonOrText(scan, `Nothing to migrate: ${scan.reason}`, opts);
      return;
    }
    if (scan.source === null) {
      fail("scan reported a migration with no source — refusing to run");
    }
    // Trigger the guarded one-time migration (no-op if it already ran).
    migrateLegacyData(process.cwd(), process.env["HOME"] || homedir(), scan.target);
    outputJsonOrText({ ...scan, migrated: true }, `Migrated ${scan.source} -> ${scan.target}`, opts);
  });

// ── Helpers ──────────────────────────────────────────────────────────────────

function calendarCommand(name: string) {
  return program.command(name).option("--json", "Output as JSON");
}

function listCommand(name: string) {
  return calendarCommand(name)
    .option("--limit <n>", `Max rows for human output (default ${DEFAULT_PAGE_LIMIT}, max ${MAX_PAGE_LIMIT})`, parseInteger)
    .option("--cursor <n>", "Zero-based row offset for the next page", parseInteger)
    .option("--verbose", "Show additional fields without switching to JSON");
}

function parseInteger(value: string): number {
  if (!/^-?\d+$/.test(value)) throw new Error(`Expected an integer, got "${value}"`);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) throw new Error(`Expected an integer, got "${value}"`);
  return parsed;
}

function wantsJson(opts: { json?: boolean } = {}) {
  return Boolean(opts.json || program.opts().json || process.argv.includes("--json") || process.argv.includes("-j"));
}

function outputJsonOrText(value: unknown, text: string, opts: { json?: boolean } = {}) {
  output(wantsJson(opts) ? JSON.stringify(value) : text);
}

function fail(message: string): never {
  output(wantsJson() ? JSON.stringify({ error: message }) : chalk.red(message));
  process.exit(1);
}

function truncate(value: string | null | undefined, max = 72): string {
  const text = (value || "-").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, Math.max(0, max - 3))}...` : text;
}

function pageItems<T>(items: T[], opts: { json?: boolean; limit?: number; cursor?: number }) {
  const jsonUnpaged = wantsJson(opts) && opts.limit === undefined && opts.cursor === undefined;
  const cursor = opts.cursor ?? 0;
  const requestedLimit = opts.limit ?? (jsonUnpaged ? Math.max(items.length, 1) : DEFAULT_PAGE_LIMIT);
  if (cursor < 0) fail("--cursor must be zero or greater");
  if (requestedLimit <= 0) fail("--limit must be greater than zero");
  const limit = jsonUnpaged ? requestedLimit : Math.min(requestedLimit, MAX_PAGE_LIMIT);
  const rows = items.slice(cursor, cursor + limit);
  const nextCursor = cursor + rows.length < items.length ? cursor + rows.length : null;
  return { rows, cursor, limit, nextCursor, total: items.length, jsonUnpaged };
}

function outputList<T>(
  items: T[],
  opts: { json?: boolean; verbose?: boolean; limit?: number; cursor?: number },
  config: { empty: string; hint: string; row: (item: T) => string },
) {
  const page = pageItems(items, opts);
  if (wantsJson(opts)) {
    output(JSON.stringify(page.jsonUnpaged
      ? page.rows
      : { items: page.rows, total: page.total, limit: page.limit, cursor: page.cursor, next_cursor: page.nextCursor }));
    return;
  }
  if (page.rows.length === 0) {
    output(chalk.gray(config.empty));
    return;
  }

  const lines = page.rows.map(config.row);
  const shownEnd = page.cursor + page.rows.length;
  lines.push(chalk.gray(`Showing ${page.cursor + 1}-${shownEnd} of ${page.total}.`));
  if (page.nextCursor !== null) {
    lines.push(chalk.gray(`Next page: rerun with --cursor ${page.nextCursor}.`));
  }
  lines.push(chalk.gray(config.hint));
  output(lines.join("\n"));
}

function handleError(error: unknown): never {
  const commanderError = error as { code?: string; exitCode?: number; message?: string };
  const isCommanderExit = typeof commanderError.code === "string" && commanderError.code.startsWith("commander.");
  const exitCode = commanderError.exitCode ?? 1;

  if (commanderError.code === "commander.helpDisplayed" || commanderError.code === "commander.version") {
    process.exit(exitCode);
  }

  if (wantsJson()) {
    output(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  } else if (!isCommanderExit) {
    output(chalk.red(error instanceof Error ? error.message : String(error)));
  }

  process.exit(exitCode);
}

function output(text: string) {
  console.log(text);
}
registerEventsCommands(program, { source: "calendar" });

try {
  await program.parseAsync();
} catch (error) {
  handleError(error);
}
