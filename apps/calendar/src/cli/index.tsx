import { Command } from "commander";
import chalk from "chalk";
import { createOrg, getOrg, getOrgBySlug, listOrgs, updateOrg, deleteOrg } from "../db/orgs.js";
import { registerAgent, getAgentByName, listAgents, heartbeat, updateAgent, deleteAgent } from "../db/agents.js";
import { createCalendar, getCalendar, listCalendars, updateCalendar, deleteCalendar } from "../db/calendars.js";
import { createEvent, getEvent, listEvents, updateEvent, deleteEvent, findConflicts, searchEvents } from "../db/events.js";
import { createAttendee, getAttendeesForEvent, updateAttendee, deleteAttendee } from "../db/attendees.js";
import { getAvailabilityForAgent, upsertAgentAvailability, deleteAvailability } from "../db/availability.js";
import { createMembership, getMembershipsForOrg, getOrgsForAgent, deleteMembershipByAgentAndOrg } from "../db/memberships.js";

const program = new Command();

program
  .name("calendar")
  .description("Universal calendar management for AI coding agents")
  .version("0.1.0");

// Global flags
program.option("--agent <name>", "Agent name");
program.option("--org <slug>", "Org slug");
program.option("--json", "Output as JSON");

// ── Org commands ─────────────────────────────────────────────────────────────

program
  .command("org-add <name>")
  .description("Create a new org")
  .option("--slug <slug>", "Org slug")
  .option("--description <desc>", "Description")
  .action((name, opts) => {
    const org = createOrg({ name, slug: opts.slug, description: opts.description });
    output(opts.json ? JSON.stringify(org) : chalk.green(`Org created: ${org.name} (${org.slug}) [${org.id}]`));
  });

program
  .command("org-list")
  .description("List all orgs")
  .action((opts) => {
    const orgs = listOrgs();
    output(opts.json ? JSON.stringify(orgs) : orgs.map((o) => `${o.name} (${o.slug}) [${o.id}]`).join("\n") || chalk.gray("No orgs"));
  });

program
  .command("org-show <id>")
  .description("Show org details")
  .action((id, opts) => {
    const org = getOrg(id) || getOrgBySlug(id);
    if (!org) { output(chalk.red("Org not found")); process.exit(1); }
    output(opts.json ? JSON.stringify(org) : `${org.name} (${org.slug})\n  ID: ${org.id}`);
  });

program
  .command("org-update <id>")
  .description("Update an org")
  .option("--name <name>", "Org name")
  .option("--description <desc>", "Description")
  .action((id, opts) => {
    const org = updateOrg(id, { name: opts.name, description: opts.description });
    output(opts.json ? JSON.stringify(org) : chalk.green(`Org updated: ${org.name}`));
  });

program
  .command("org-delete <id>")
  .description("Delete an org")
  .action((id) => {
    const ok = deleteOrg(id);
    output(ok ? chalk.green("Org deleted") : chalk.red("Org not found"));
  });

// ── Agent commands ───────────────────────────────────────────────────────────

program
  .command("init <name>")
  .description("Register an agent")
  .option("--description <desc>", "Description")
  .option("--role <role>", "Role")
  .option("--org <org>", "Org ID")
  .action((name, opts) => {
    const agent = registerAgent({ name, description: opts.description, role: opts.role, org_id: opts.org });
    output(opts.json ? JSON.stringify(agent) : chalk.green(`Agent registered: ${agent.name} [${agent.id}]`));
  });

program
  .command("agents")
  .description("List agents")
  .action((opts) => {
    const agents = listAgents();
    output(opts.json ? JSON.stringify(agents) : agents.map((a) => `${a.name} [${a.id}]`).join("\n") || chalk.gray("No agents"));
  });

program
  .command("heartbeat [agent]")
  .description("Update agent heartbeat")
  .action((agent, opts) => {
    const name = agent || opts.agent;
    if (!name) { output(chalk.red("Agent name required")); process.exit(1); }
    const a = getAgentByName(name);
    if (!a) { output(chalk.red("Agent not found")); process.exit(1); }
    heartbeat(a.id);
    output(chalk.green(`Heartbeat: ${name}`));
  });

program
  .command("agent-update <id>")
  .description("Update an agent")
  .option("--description <desc>", "Description")
  .option("--role <role>", "Role")
  .action((id, opts) => {
    const agent = updateAgent(id, { description: opts.description, role: opts.role });
    output(opts.json ? JSON.stringify(agent) : chalk.green(`Agent updated: ${agent?.name}`));
  });

program
  .command("agent-delete <id>")
  .description("Delete an agent")
  .action((id) => {
    const ok = deleteAgent(id);
    output(ok ? chalk.green("Agent deleted") : chalk.red("Agent not found"));
  });

// ── Calendar commands ────────────────────────────────────────────────────────

program
  .command("cal-add <name>")
  .description("Create a calendar")
  .requiredOption("--org <orgId>", "Org ID")
  .option("--slug <slug>", "Calendar slug")
  .option("--description <desc>", "Description")
  .option("--color <color>", "Color hex")
  .option("--timezone <tz>", "Timezone (default: UTC)")
  .option("--visibility <vis>", "Visibility: public, org, private")
  .action((name, opts) => {
    const cal = createCalendar({
      name,
      org_id: opts.org,
      slug: opts.slug,
      description: opts.description,
      color: opts.color,
      timezone: opts.timezone || "UTC",
      visibility: opts.visibility as any,
    });
    output(opts.json ? JSON.stringify(cal) : chalk.green(`Calendar created: ${cal.name} [${cal.id}]`));
  });

program
  .command("cal-list")
  .description("List calendars")
  .option("--org <orgId>", "Filter by org")
  .action((opts) => {
    const cals = listCalendars(opts.org || undefined);
    output(opts.json ? JSON.stringify(cals) : cals.map((c) => `${c.name} (${c.slug}) [${c.id}]`).join("\n") || chalk.gray("No calendars"));
  });

program
  .command("cal-update <id>")
  .description("Update a calendar")
  .option("--name <name>", "Name")
  .option("--description <desc>", "Description")
  .option("--color <color>", "Color")
  .option("--timezone <tz>", "Timezone")
  .option("--visibility <vis>", "Visibility")
  .action((id, opts) => {
    const cal = updateCalendar(id, {
      name: opts.name,
      description: opts.description,
      color: opts.color,
      timezone: opts.timezone,
      visibility: opts.visibility as any,
    });
    output(opts.json ? JSON.stringify(cal) : chalk.green(`Calendar updated: ${cal.name}`));
  });

program
  .command("cal-delete <id>")
  .description("Delete a calendar")
  .action((id) => {
    const ok = deleteCalendar(id);
    output(ok ? chalk.green("Calendar deleted") : chalk.red("Calendar not found"));
  });

// ── Event commands ───────────────────────────────────────────────────────────

program
  .command("add <title>")
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
  .action((title, opts) => {
    const cal = getCalendar(opts.calendar);
    if (!cal) { output(chalk.red("Calendar not found")); process.exit(1); }

    const evt = createEvent({
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
    });

    output(opts.json ? JSON.stringify(evt) : chalk.green(`Event created: ${evt.title}\n  ${evt.start_at} -> ${evt.end_at} [${evt.id}]`));
  });

program
  .command("list")
  .description("List events")
  .option("--calendar <calendarId>", "Calendar ID")
  .option("--org <orgId>", "Org ID")
  .option("--after <date>", "After date (ISO)")
  .option("--before <date>", "Before date (ISO)")
  .option("--limit <n>", "Limit results", parseInt)
  .action((opts) => {
    const events = listEvents({
      calendar_id: opts.calendar,
      org_id: opts.org,
      after: opts.after,
      before: opts.before,
      limit: opts.limit,
    });
    output(opts.json ? JSON.stringify(events) : events.map((e) => `${e.title}\n  ${e.start_at} -> ${e.end_at} [${e.id}]`).join("\n") || chalk.gray("No events"));
  });

program
  .command("show <id>")
  .description("Show event details")
  .action((id, opts) => {
    const evt = getEvent(id);
    if (!evt) { output(chalk.red("Event not found")); process.exit(1); }
    const attendees = getAttendeesForEvent(id);
    const result = { event: evt, attendees };
    output(opts.json ? JSON.stringify(result) : `${evt.title}\n  ${evt.start_at} -> ${evt.end_at}\n  Location: ${evt.location || "—"}\n  Status: ${evt.status}\n  Attendees: ${attendees.length}`);
  });

program
  .command("update <id>")
  .description("Update an event")
  .option("--title <title>", "Title")
  .option("--start <iso>", "Start time")
  .option("--end <iso>", "End time")
  .option("--description <desc>", "Description")
  .option("--location <loc>", "Location")
  .option("--status <status>", "Status")
  .action((id, opts) => {
    const evt = updateEvent(id, {
      title: opts.title,
      start_at: opts.start,
      end_at: opts.end,
      description: opts.description,
      location: opts.location,
      status: opts.status as any,
    });
    output(opts.json ? JSON.stringify(evt) : chalk.green(`Event updated: ${evt.title}`));
  });

program
  .command("delete <id>")
  .description("Delete an event")
  .action((id) => {
    const ok = deleteEvent(id);
    output(ok ? chalk.green("Event deleted") : chalk.red("Event not found"));
  });

program
  .command("search <query>")
  .description("Search events (full-text)")
  .option("--org <orgId>", "Org ID")
  .action((query, opts) => {
    const events = searchEvents(query, opts.org || undefined);
    output(opts.json ? JSON.stringify(events) : events.map((e) => `${e.title}\n  ${e.start_at} -> ${e.end_at}`).join("\n") || chalk.gray("No results"));
  });

program
  .command("conflicts <calendarId>")
  .description("Find conflicting events for a time range")
  .requiredOption("--start <iso>", "Start time")
  .requiredOption("--end <iso>", "End time")
  .action((calendarId, opts) => {
    const conflicts = findConflicts(calendarId, { start: opts.start, end: opts.end });
    output(opts.json ? JSON.stringify(conflicts) : conflicts.length === 0
      ? chalk.green("No conflicts")
      : chalk.yellow(`${conflicts.length} conflict(s):\n${conflicts.map((e) => `  ${e.title} (${e.start_at} -> ${e.end_at})`).join("\n")}`)
    );
  });

// ── Attendee commands ────────────────────────────────────────────────────────

program
  .command("attendee-add")
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
    output(opts.json ? JSON.stringify(attendee) : chalk.green(`Attendee added: ${attendee.display_name || attendee.agent_id || attendee.email || "?"} [${attendee.id}]`));
  });

program
  .command("attendee-respond <attendeeId>")
  .description("Respond to event invitation")
  .requiredOption("--status <status>", "Status: accepted, declined, tentative")
  .option("--comment <comment>", "Response comment")
  .action((attendeeId, opts) => {
    const attendee = updateAttendee(attendeeId, { status: opts.status as any, response_comment: opts.comment || null });
    output(opts.json ? JSON.stringify(attendee) : chalk.green(`Response recorded: ${attendee.status}`));
  });

program
  .command("attendee-delete <id>")
  .description("Delete an attendee")
  .action((id) => {
    const ok = deleteAttendee(id);
    output(ok ? chalk.green("Attendee deleted") : chalk.red("Attendee not found"));
  });

// ── Availability commands ────────────────────────────────────────────────────

program
  .command("availability-set")
  .description("Set agent availability for a day of week")
  .requiredOption("--agent <agentId>", "Agent ID")
  .requiredOption("--org <orgId>", "Org ID")
  .requiredOption("--day <0-6>", "Day of week (0=Sun, 6=Sat)", parseInt)
  .requiredOption("--start <HH:mm>", "Start time")
  .requiredOption("--end <HH:mm>", "End time")
  .action((opts) => {
    const av = upsertAgentAvailability(opts.agent, opts.org, opts.day, opts.start, opts.end);
    output(opts.json ? JSON.stringify(av) : chalk.green(`Availability set: day ${opts.day} ${opts.start}-${opts.end} [${av.id}]`));
  });

program
  .command("availability-show <agentId>")
  .description("Show agent availability")
  .option("--org <orgId>", "Org ID")
  .action((agentId, opts) => {
    const avail = getAvailabilityForAgent(agentId, opts.org || undefined);
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    output(opts.json ? JSON.stringify(avail) : avail.map((a) => `  ${days[a.day_of_week]}: ${a.start_time} - ${a.end_time}`).join("\n") || chalk.gray("No availability set"));
  });

program
  .command("availability-delete <id>")
  .description("Delete an availability entry")
  .action((id) => {
    const ok = deleteAvailability(id);
    output(ok ? chalk.green("Availability deleted") : chalk.red("Availability not found"));
  });

// ── Membership commands ──────────────────────────────────────────────────────

program
  .command("member-add")
  .description("Add agent to org")
  .requiredOption("--org <orgId>", "Org ID")
  .requiredOption("--agent <agentId>", "Agent ID")
  .option("--role <role>", "Role: admin, member, service")
  .action((opts) => {
    const m = createMembership({ org_id: opts.org, agent_id: opts.agent, role: opts.role as any });
    output(opts.json ? JSON.stringify(m) : chalk.green(`Added ${opts.agent} to org ${opts.org} as ${m.role}`));
  });

program
  .command("members <orgId>")
  .description("List org members")
  .action((orgId, opts) => {
    const members = getMembershipsForOrg(orgId);
    output(opts.json ? JSON.stringify(members) : members.map((m) => `  ${m.agent_id} — ${m.role}`).join("\n") || chalk.gray("No members"));
  });

program
  .command("member-remove <agentId> <orgId>")
  .description("Remove agent from org")
  .action((agentId, orgId) => {
    const ok = deleteMembershipByAgentAndOrg(agentId, orgId);
    output(ok ? chalk.green("Member removed") : chalk.red("Member not found"));
  });

// ── Agent org management ─────────────────────────────────────────────────────

program
  .command("agent-orgs <agentId>")
  .description("List orgs an agent belongs to")
  .action((agentId, opts) => {
    const orgs = getOrgsForAgent(agentId);
    output(opts.json ? JSON.stringify(orgs) : orgs.map((m) => `  ${m.org_id} — ${m.role}`).join("\n") || chalk.gray("No orgs"));
  });

// ── Helpers ──────────────────────────────────────────────────────────────────

function output(text: string) {
  console.log(text);
}

program.parse();
