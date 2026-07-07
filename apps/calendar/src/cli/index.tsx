#!/usr/bin/env bun
import { registerEventsCommands } from "@hasna/events/commander";
import { Command } from "commander";
import chalk from "chalk";
import { createOrg, getOrg, getOrgBySlug, listOrgs, updateOrg, deleteOrg } from "../db/orgs.js";
import { registerAgent, getAgentByName, listAgents, heartbeat, updateAgent, deleteAgent } from "../db/agents.js";
import { createCalendar, getCalendar, listCalendars, updateCalendar, deleteCalendar } from "../db/calendars.js";
import { createEvent, getEvent, listEvents, updateEvent, deleteEvent, findConflicts, searchEvents } from "../db/events.js";
import { createAttendee, getAttendeesForEvent, updateAttendee, deleteAttendee } from "../db/attendees.js";
import { getAvailabilityForAgent, upsertAgentAvailability, deleteAvailability } from "../db/availability.js";
import { createMembership, getMembershipsForOrg, getOrgsForAgent, deleteMembershipByAgentAndOrg } from "../db/memberships.js";
import { getCalendarCloud } from "../cloud/store.js";

const packageJson = await Bun.file(new URL("../../package.json", import.meta.url)).json() as { version: string };
const program = new Command();

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
    const cloud = getCalendarCloud();
    const org = cloud
      ? (await cloud.createOrg({ name, slug: opts.slug, description: opts.description })) as any
      : createOrg({ name, slug: opts.slug, description: opts.description });
    output(wantsJson(opts) ? JSON.stringify(org) : chalk.green(`Org created: ${org.name} (${org.slug}) [${org.id}]`));
  });

calendarCommand("org-list")
  .description("List all orgs")
  .action(async (opts) => {
    const cloud = getCalendarCloud();
    const orgs = (cloud ? await cloud.listOrgs() : listOrgs()) as any[];
    output(wantsJson(opts) ? JSON.stringify(orgs) : orgs.map((o) => `${o.name} (${o.slug}) [${o.id}]`).join("\n") || chalk.gray("No orgs"));
  });

calendarCommand("org-show <id>")
  .description("Show org details")
  .action(async (id, opts) => {
    const cloud = getCalendarCloud();
    const org = (cloud ? await cloud.getOrg(id) : (getOrg(id) || getOrgBySlug(id))) as any;
    if (!org) fail("Org not found");
    output(wantsJson(opts) ? JSON.stringify(org) : `${org.name} (${org.slug})\n  ID: ${org.id}`);
  });

calendarCommand("org-update <id>")
  .description("Update an org")
  .option("--name <name>", "Org name")
  .option("--description <desc>", "Description")
  .action(async (id, opts) => {
    const cloud = getCalendarCloud();
    const org = (cloud
      ? await cloud.updateOrg(id, { name: opts.name, description: opts.description })
      : updateOrg(id, { name: opts.name, description: opts.description })) as any;
    output(wantsJson(opts) ? JSON.stringify(org) : chalk.green(`Org updated: ${org.name}`));
  });

calendarCommand("org-delete <id>")
  .description("Delete an org")
  .action(async (id, opts) => {
    const cloud = getCalendarCloud();
    const ok = cloud ? await cloud.deleteOrg(id) : deleteOrg(id);
    outputJsonOrText({ deleted: ok }, ok ? chalk.green("Org deleted") : chalk.red("Org not found"), opts);
  });

// ── Agent commands ───────────────────────────────────────────────────────────

calendarCommand("init <name>")
  .description("Register an agent")
  .option("--description <desc>", "Description")
  .option("--role <role>", "Role")
  .option("--org <org>", "Org ID")
  .action((name, opts) => {
    const agent = registerAgent({ name, description: opts.description, role: opts.role, org_id: opts.org });
    output(wantsJson(opts) ? JSON.stringify(agent) : chalk.green(`Agent registered: ${agent.name} [${agent.id}]`));
  });

calendarCommand("agents")
  .description("List agents")
  .action((opts) => {
    const agents = listAgents();
    output(wantsJson(opts) ? JSON.stringify(agents) : agents.map((a) => `${a.name} [${a.id}]`).join("\n") || chalk.gray("No agents"));
  });

calendarCommand("heartbeat [agent]")
  .description("Update agent heartbeat")
  .action((agent, opts) => {
    const name = agent || opts.agent || program.opts().agent;
    if (!name) fail("Agent name required");
    const a = getAgentByName(name);
    if (!a) fail("Agent not found");
    const updated = heartbeat(a.id);
    outputJsonOrText(updated, chalk.green(`Heartbeat: ${name}`), opts);
  });

calendarCommand("agent-update <id>")
  .description("Update an agent")
  .option("--description <desc>", "Description")
  .option("--role <role>", "Role")
  .action((id, opts) => {
    const agent = updateAgent(id, { description: opts.description, role: opts.role });
    output(wantsJson(opts) ? JSON.stringify(agent) : chalk.green(`Agent updated: ${agent?.name}`));
  });

calendarCommand("agent-delete <id>")
  .description("Delete an agent")
  .action((id, opts) => {
    const ok = deleteAgent(id);
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
    const input = {
      name,
      org_id: opts.org,
      slug: opts.slug,
      description: opts.description,
      color: opts.color,
      timezone: opts.timezone || "UTC",
      visibility: opts.visibility as any,
    };
    const cloud = getCalendarCloud();
    const cal = (cloud ? await cloud.createCalendar(input) : createCalendar(input)) as any;
    output(wantsJson(opts) ? JSON.stringify(cal) : chalk.green(`Calendar created: ${cal.name} [${cal.id}]`));
  });

calendarCommand("cal-list")
  .description("List calendars")
  .option("--org <orgId>", "Filter by org")
  .action(async (opts) => {
    const cloud = getCalendarCloud();
    const cals = (cloud ? await cloud.listCalendars(opts.org || undefined) : listCalendars(opts.org || undefined)) as any[];
    output(wantsJson(opts) ? JSON.stringify(cals) : cals.map((c) => `${c.name} (${c.slug}) [${c.id}]`).join("\n") || chalk.gray("No calendars"));
  });

calendarCommand("cal-update <id>")
  .description("Update a calendar")
  .option("--name <name>", "Name")
  .option("--description <desc>", "Description")
  .option("--color <color>", "Color")
  .option("--timezone <tz>", "Timezone")
  .option("--visibility <vis>", "Visibility")
  .action(async (id, opts) => {
    const input = {
      name: opts.name,
      description: opts.description,
      color: opts.color,
      timezone: opts.timezone,
      visibility: opts.visibility as any,
    };
    const cloud = getCalendarCloud();
    const cal = (cloud ? await cloud.updateCalendar(id, input) : updateCalendar(id, input)) as any;
    output(wantsJson(opts) ? JSON.stringify(cal) : chalk.green(`Calendar updated: ${cal.name}`));
  });

calendarCommand("cal-delete <id>")
  .description("Delete a calendar")
  .action(async (id, opts) => {
    const cloud = getCalendarCloud();
    const ok = cloud ? await cloud.deleteCalendar(id) : deleteCalendar(id);
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
  .option("--source-task <id>", "Link to open-todos task ID")
  .option("--agent <agentId>", "Creator agent ID")
  .action(async (title, opts) => {
    const cloud = getCalendarCloud();
    const cal = (cloud ? await cloud.getCalendar(opts.calendar) : getCalendar(opts.calendar)) as any;
    if (!cal) fail("Calendar not found");

    const input = {
      title,
      calendar_id: opts.calendar,
      org_id: opts.org || cal.org_id,
      start_at: opts.start,
      end_at: opts.end,
      description: opts.description,
      location: opts.location,
      all_day: opts.allDay,
      timezone: opts.timezone || cal.timezone,
      status: opts.status as any,
      busy_type: opts.busy as any,
      recurrence_rule: opts.rrule,
      source_task_id: opts.sourceTask,
      created_by: opts.agent,
    };
    const evt = (cloud ? await cloud.createEvent(input) : createEvent(input)) as any;

    output(wantsJson(opts) ? JSON.stringify(evt) : chalk.green(`Event created: ${evt.title}\n  ${evt.start_at} -> ${evt.end_at} [${evt.id}]`));
  });

calendarCommand("list")
  .description("List events")
  .option("--calendar <calendarId>", "Calendar ID")
  .option("--org <orgId>", "Org ID")
  .option("--after <date>", "After date (ISO)")
  .option("--before <date>", "Before date (ISO)")
  .option("--limit <n>", "Limit results", parseInt)
  .action(async (opts) => {
    const filter = {
      calendar_id: opts.calendar,
      org_id: opts.org,
      after: opts.after,
      before: opts.before,
      limit: opts.limit,
    };
    const cloud = getCalendarCloud();
    const events = (cloud ? await cloud.listEvents(filter) : listEvents(filter)) as any[];
    output(wantsJson(opts) ? JSON.stringify(events) : events.map((e) => `${e.title}\n  ${e.start_at} -> ${e.end_at} [${e.id}]`).join("\n") || chalk.gray("No events"));
  });

calendarCommand("show <id>")
  .description("Show event details")
  .action(async (id, opts) => {
    const cloud = getCalendarCloud();
    let evt: any;
    let attendees: any[];
    if (cloud) {
      const withAtt = await cloud.getEventWithAttendees(id);
      if (!withAtt) fail("Event not found");
      evt = withAtt!.event;
      attendees = withAtt!.attendees as any[];
    } else {
      evt = getEvent(id);
      if (!evt) fail("Event not found");
      attendees = getAttendeesForEvent(id);
    }
    const result = { event: evt, attendees };
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
    const input = {
      title: opts.title,
      start_at: opts.start,
      end_at: opts.end,
      description: opts.description,
      location: opts.location,
      status: opts.status as any,
    };
    const cloud = getCalendarCloud();
    const evt = (cloud ? await cloud.updateEvent(id, input) : updateEvent(id, input)) as any;
    output(wantsJson(opts) ? JSON.stringify(evt) : chalk.green(`Event updated: ${evt.title}`));
  });

calendarCommand("delete <id>")
  .description("Delete an event")
  .action(async (id, opts) => {
    const cloud = getCalendarCloud();
    const ok = cloud ? await cloud.deleteEvent(id) : deleteEvent(id);
    outputJsonOrText({ deleted: ok }, ok ? chalk.green("Event deleted") : chalk.red("Event not found"), opts);
  });

calendarCommand("search <query>")
  .description("Search events (full-text)")
  .option("--org <orgId>", "Org ID")
  .action((query, opts) => {
    const events = searchEvents(query, opts.org || undefined);
    output(wantsJson(opts) ? JSON.stringify(events) : events.map((e) => `${e.title}\n  ${e.start_at} -> ${e.end_at}`).join("\n") || chalk.gray("No results"));
  });

calendarCommand("conflicts <calendarId>")
  .description("Find conflicting events for a time range")
  .requiredOption("--start <iso>", "Start time")
  .requiredOption("--end <iso>", "End time")
  .action((calendarId, opts) => {
    const conflicts = findConflicts(calendarId, { start: opts.start, end: opts.end });
    output(wantsJson(opts) ? JSON.stringify(conflicts) : conflicts.length === 0
      ? chalk.green("No conflicts")
      : chalk.yellow(`${conflicts.length} conflict(s):\n${conflicts.map((e) => `  ${e.title} (${e.start_at} -> ${e.end_at})`).join("\n")}`)
    );
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
  .action((opts) => {
    const attendee = createAttendee({
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
  .action((attendeeId, opts) => {
    const attendee = updateAttendee(attendeeId, { status: opts.status as any, response_comment: opts.comment || null });
    output(wantsJson(opts) ? JSON.stringify(attendee) : chalk.green(`Response recorded: ${attendee.status}`));
  });

calendarCommand("attendee-delete <id>")
  .description("Delete an attendee")
  .action((id, opts) => {
    const ok = deleteAttendee(id);
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
  .action((opts) => {
    const av = upsertAgentAvailability(opts.agent, opts.org, opts.day, opts.start, opts.end);
    output(wantsJson(opts) ? JSON.stringify(av) : chalk.green(`Availability set: day ${opts.day} ${opts.start}-${opts.end} [${av.id}]`));
  });

calendarCommand("availability-show <agentId>")
  .description("Show agent availability")
  .option("--org <orgId>", "Org ID")
  .action((agentId, opts) => {
    const avail = getAvailabilityForAgent(agentId, opts.org || undefined);
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    output(wantsJson(opts) ? JSON.stringify(avail) : avail.map((a) => `  ${days[a.day_of_week]}: ${a.start_time} - ${a.end_time}`).join("\n") || chalk.gray("No availability set"));
  });

calendarCommand("availability-delete <id>")
  .description("Delete an availability entry")
  .action((id, opts) => {
    const ok = deleteAvailability(id);
    outputJsonOrText({ deleted: ok }, ok ? chalk.green("Availability deleted") : chalk.red("Availability not found"), opts);
  });

// ── Membership commands ──────────────────────────────────────────────────────

calendarCommand("member-add")
  .description("Add agent to org")
  .requiredOption("--org <orgId>", "Org ID")
  .requiredOption("--agent <agentId>", "Agent ID")
  .option("--role <role>", "Role: admin, member, service")
  .action((opts) => {
    const m = createMembership({ org_id: opts.org, agent_id: opts.agent, role: opts.role as any });
    output(wantsJson(opts) ? JSON.stringify(m) : chalk.green(`Added ${opts.agent} to org ${opts.org} as ${m.role}`));
  });

calendarCommand("members <orgId>")
  .description("List org members")
  .action((orgId, opts) => {
    const members = getMembershipsForOrg(orgId);
    output(wantsJson(opts) ? JSON.stringify(members) : members.map((m) => `  ${m.agent_id} — ${m.role}`).join("\n") || chalk.gray("No members"));
  });

calendarCommand("member-remove <agentId> <orgId>")
  .description("Remove agent from org")
  .action((agentId, orgId, opts) => {
    const ok = deleteMembershipByAgentAndOrg(agentId, orgId);
    outputJsonOrText({ removed: ok }, ok ? chalk.green("Member removed") : chalk.red("Member not found"), opts);
  });

// ── Agent org management ─────────────────────────────────────────────────────

calendarCommand("agent-orgs <agentId>")
  .description("List orgs an agent belongs to")
  .action((agentId, opts) => {
    const orgs = getOrgsForAgent(agentId);
    output(wantsJson(opts) ? JSON.stringify(orgs) : orgs.map((m) => `  ${m.org_id} — ${m.role}`).join("\n") || chalk.gray("No orgs"));
  });

// ── Helpers ──────────────────────────────────────────────────────────────────

function calendarCommand(name: string) {
  return program.command(name).option("--json", "Output as JSON");
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
