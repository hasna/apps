#!/usr/bin/env bun
import { registerEventsCommands } from "@hasna/events/commander";
import { Command } from "commander";
import pkg from "../../package.json";
// The single Store abstraction routes every read+write to the server's /v1 API
// when HASNA_TELEPHONY_API_URL + HASNA_TELEPHONY_API_KEY are set. Without the
// API env the CLI FAILS CLOSED (owner directive 2026-09-04): a store-backed
// command exits non-zero with an error naming the required env — the on-box
// SQLite store is reachable only through the explicit opt-in
// HASNA_TELEPHONY_LOCAL=1, never as a silent default. No CLI command touches
// sqlite or fetch directly. See ../lib/store/index.ts.
import { getStore } from "../lib/store/index.js";
import { HasnaHttpError } from "@hasna/contracts";
import { sendSms } from "../lib/sms.js";
import { sendWhatsApp, sendWhatsAppAudio } from "../lib/whatsapp.js";
import { makeCall } from "../lib/voice.js";
import { searchAvailableNumbers, provisionNumber, releaseNumber, configureNumber, listTwilioNumbers } from "../lib/provisioning.js";
import { generateSpeech, listVoices } from "../lib/tts.js";
import { transcribe } from "../lib/stt.js";
import { generateSchedule, generateMessage } from "../lib/cerebras.js";
import { setGreeting } from "../lib/voicemail.js";
import { tick } from "../lib/scheduler.js";
import { getConfig } from "../lib/config.js";
import {
  collectionPage,
  windowPage,
  compactAgent,
  compactCall,
  compactContact,
  compactMessage,
  compactPhoneNumber,
  compactProject,
  compactSchedule,
  compactVoicemail,
  compactWebhook,
} from "../lib/compact-output.js";

const program = new Command();
program
  .name("telephony")
  .description("Telephony platform for AI agents — SMS, WhatsApp, voice, TTS/STT")
  .version(pkg.version);

/**
 * Accept `--json` on a data command. Every telephony data command already
 * prints JSON, so the flag is a no-op — but scripts pass it on any
 * list/read/whoami surface and commander rejects unknown options
 * (hasna/apps#1602).
 */
function withJsonFlag(cmd: Command): Command {
  return cmd.option("--json", "Output as JSON (already the only output format)");
}

function withCollectionFlags(cmd: Command): Command {
  return withJsonFlag(cmd)
    .option("--limit <n>", "Maximum compact rows", "20")
    .option("--cursor <n>", "Zero-based row offset", "0")
    .option("--verbose", "Return full fields within the selected page")
    .option("--full", "Return the legacy response shape");
}

function pageOptions(opts: { limit?: string; cursor?: string; verbose?: boolean }) {
  const limit = Number(opts.limit ?? 20); const cursor = Number(opts.cursor ?? 0);
  if (!Number.isInteger(limit) || limit <= 0) throw new Error("--limit must be a positive integer");
  if (!Number.isInteger(cursor) || cursor < 0) throw new Error("--cursor must be a non-negative integer");
  return { limit, cursor, verbose: opts.verbose };
}
function printCollection<T, U>(key: string, rows: T[], opts: { limit?: string; cursor?: string; verbose?: boolean; full?: boolean }, summarize: (row: T) => U): void {
  console.log(JSON.stringify(opts.full ? rows : collectionPage(key, rows, pageOptions(opts), summarize)));
}

// ---------------------------------------------------------------------------
// SMS
// ---------------------------------------------------------------------------
const smsCmd = program.command("sms").description("SMS messaging");

withJsonFlag(smsCmd.command("send"))
  .description("Send an SMS")
  .requiredOption("--to <number>", "Recipient phone number")
  .requiredOption("--body <text>", "Message body")
  .option("--from <number>", "Sender phone number")
  .option("--agent <id>", "Agent ID")
  .option("--project <id>", "Project ID")
  .action(async (opts) => {
    const msg = await sendSms({ to: opts.to, body: opts.body, from: opts.from, agent_id: opts.agent, project_id: opts.project });
    console.log(JSON.stringify(msg, null, 2));
  });

withCollectionFlags(smsCmd.command("list"))
  .description("List SMS messages")
  .option("--agent <id>", "Filter by agent")
  .option("--project <id>", "Filter by project")
  .action(async (opts) => {
    if (opts.full) {
      const msgs = await getStore().listMessages({ agent_id: opts.agent, project_id: opts.project, limit: 50 });
      console.log(JSON.stringify(msgs));
      return;
    }
    const page = pageOptions(opts);
    const messagePage = await getStore().listMessagesPage({ agent_id: opts.agent, project_id: opts.project, limit: page.limit + 1, offset: page.cursor });
    console.log(JSON.stringify(windowPage("messages", messagePage.items, { ...page, total: messagePage.total }, compactMessage)));
  });

withCollectionFlags(smsCmd.command("search <query>"))
  .description("Search messages")
  .action(async (query, opts) => {
    if (opts.full) { console.log(JSON.stringify(await getStore().searchMessages(query, 50))); return; }
    const page = pageOptions(opts);
    if (page.cursor !== 0) throw new Error("sms search does not support --cursor; refine the query or use --full");
    const msgs = await getStore().searchMessages(query, page.limit + 1);
    console.log(JSON.stringify(windowPage("messages", msgs, page, compactMessage)));
  });

// ---------------------------------------------------------------------------
// WhatsApp
// ---------------------------------------------------------------------------
const waCmd = program.command("whatsapp").description("WhatsApp messaging");

withJsonFlag(waCmd.command("send"))
  .description("Send a WhatsApp message")
  .requiredOption("--to <number>", "Recipient phone number")
  .requiredOption("--body <text>", "Message body")
  .option("--from <number>", "Sender")
  .option("--agent <id>", "Agent ID")
  .action(async (opts) => {
    const msg = await sendWhatsApp({ to: opts.to, body: opts.body, from: opts.from, agent_id: opts.agent });
    console.log(JSON.stringify(msg, null, 2));
  });

withJsonFlag(waCmd.command("send-audio"))
  .description("Send a WhatsApp audio message")
  .requiredOption("--to <number>", "Recipient")
  .requiredOption("--media-url <url>", "Audio URL")
  .option("--body <text>", "Caption")
  .option("--from <number>", "Sender")
  .action(async (opts) => {
    const msg = await sendWhatsAppAudio({ to: opts.to, media_url: opts.mediaUrl, body: opts.body, from: opts.from });
    console.log(JSON.stringify(msg, null, 2));
  });

withCollectionFlags(waCmd.command("list"))
  .description("List WhatsApp messages")
  .option("--agent <id>", "Filter by agent")
  .action(async (opts) => {
    if (opts.full) { console.log(JSON.stringify(await getStore().listMessages({ agent_id: opts.agent, type: "whatsapp_outbound", limit: 50 }))); return; }
    const page = pageOptions(opts);
    const messagePage = await getStore().listMessagesPage({ agent_id: opts.agent, type: "whatsapp_outbound", limit: page.limit + 1, offset: page.cursor });
    console.log(JSON.stringify(windowPage("messages", messagePage.items, { ...page, total: messagePage.total }, compactMessage)));
  });

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------
const callCmd = program.command("call").description("Voice calls");

withJsonFlag(callCmd.command("make"))
  .description("Make a call")
  .requiredOption("--to <number>", "Number to call")
  .option("--from <number>", "Caller ID")
  .option("--twiml <xml>", "TwiML instructions")
  .option("--agent <id>", "Agent ID")
  .action(async (opts) => {
    const call = await makeCall({ to: opts.to, from: opts.from, twiml: opts.twiml, agent_id: opts.agent });
    console.log(JSON.stringify(call, null, 2));
  });

withCollectionFlags(callCmd.command("list"))
  .description("List calls")
  .option("--agent <id>", "Filter by agent")
  .action(async (opts) => {
    if (opts.full) { console.log(JSON.stringify(await getStore().listCalls({ agent_id: opts.agent, limit: 50 }))); return; }
    const page = pageOptions(opts);
    const callPage = await getStore().listCallsPage({ agent_id: opts.agent, limit: page.limit + 1, offset: page.cursor });
    console.log(JSON.stringify(windowPage("calls", callPage.items, { ...page, total: callPage.total }, compactCall)));
  });

// ---------------------------------------------------------------------------
// Voicemail
// ---------------------------------------------------------------------------
const vmCmd = program.command("voicemail").description("Voicemail management");

withCollectionFlags(vmCmd.command("list"))
  .description("List voicemails")
  .option("--agent <id>", "Filter by agent")
  .option("--unheard", "Only unheard")
  .action(async (opts) => {
    const vms = await getStore().listVoicemails({ agent_id: opts.agent, listened: opts.unheard ? false : undefined });
    printCollection("voicemails", vms, opts, compactVoicemail);
  });

vmCmd
  .command("listen <id>")
  .description("Mark voicemail as listened")
  .action(async (id) => {
    await getStore().markVoicemailListened(id);
    console.log("Marked as listened.");
  });

vmCmd
  .command("set-greeting")
  .description("Set voicemail greeting (TTS)")
  .requiredOption("--agent <id>", "Agent ID")
  .requiredOption("--text <text>", "Greeting text")
  .option("--voice <id>", "ElevenLabs voice ID")
  .action(async (opts) => {
    const result = await setGreeting({ agent_id: opts.agent, text: opts.text, voice_id: opts.voice });
    console.log("Greeting saved:", result.path);
  });

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------
const numCmd = program.command("number").description("Phone number management");

withJsonFlag(numCmd.command("search-available"))
  .description("Search available phone numbers")
  .option("--country <code>", "Country code", "US")
  .option("--area-code <code>", "Area code")
  .option("--limit <n>", "Limit", "10")
  .action(async (opts) => {
    const numbers = await searchAvailableNumbers({ country: opts.country, area_code: opts.areaCode, limit: parseInt(opts.limit) });
    console.log(JSON.stringify(numbers));
  });

withJsonFlag(numCmd.command("provision <number>"))
  .description("Buy a phone number")
  .option("--agent <id>", "Assign to agent")
  .option("--project <id>", "Assign to project")
  .option("--name <name>", "Friendly name")
  .action(async (number, opts) => {
    const pn = await provisionNumber({ phone_number: number, agent_id: opts.agent, project_id: opts.project, friendly_name: opts.name });
    console.log(JSON.stringify(pn, null, 2));
  });

numCmd
  .command("release <number>")
  .description("Release a phone number")
  .action(async (number) => {
    await releaseNumber(number);
    console.log("Number released.");
  });

withCollectionFlags(numCmd.command("list"))
  .description("List phone numbers")
  .option("--agent <id>", "Filter by agent")
  .option("--project <id>", "Filter by project")
  .action(async (opts) => {
    const numbers = await getStore().listPhoneNumbers({ agent_id: opts.agent, project_id: opts.project });
    printCollection("numbers", numbers, opts, compactPhoneNumber);
  });

numCmd
  .command("assign <id>")
  .description("Assign number to agent/project")
  .option("--agent <id>", "Agent ID")
  .option("--project <id>", "Project ID")
  .action(async (id, opts) => {
    await getStore().assignPhoneNumber(id, opts.agent, opts.project);
    console.log("Number assigned.");
  });

withJsonFlag(numCmd.command("twilio-list"))
  .description("List numbers from Twilio account")
  .action(async () => {
    const numbers = await listTwilioNumbers();
    console.log(JSON.stringify(numbers, null, 2));
  });

numCmd
  .command("configure <sid>")
  .description("Configure a Twilio number")
  .option("--sms-url <url>", "SMS webhook URL")
  .option("--voice-url <url>", "Voice webhook URL")
  .option("--name <name>", "Friendly name")
  .action(async (sid, opts) => {
    await configureNumber(sid, { sms_url: opts.smsUrl, voice_url: opts.voiceUrl, friendly_name: opts.name });
    console.log("Number configured.");
  });

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------
const agentCmd = program.command("agent").description("Agent management");

withJsonFlag(agentCmd.command("register"))
  .description("Register an agent")
  .requiredOption("--name <name>", "Agent name")
  .option("--description <desc>", "Description")
  .option("--project <id>", "Project ID")
  .option("--force", "Force takeover")
  .action(async (opts) => {
    const result = await getStore().registerAgent({ name: opts.name, description: opts.description, project_id: opts.project, force: opts.force });
    console.log(JSON.stringify(result, null, 2));
  });

withCollectionFlags(agentCmd.command("list"))
  .description("List agents")
  .option("--project <id>", "Filter by project")
  .action(async (opts) => {
    const agents = await getStore().listAgents(opts.project);
    printCollection("agents", agents, opts, compactAgent);
  });

withJsonFlag(agentCmd.command("get <id>"))
  .description("Get agent details")
  .action(async (id) => {
    const agent = (await getStore().getAgent(id)) || (await getStore().getAgentByName(id));
    console.log(JSON.stringify(agent, null, 2));
  });

withJsonFlag(agentCmd.command("heartbeat <id>"))
  .description("Send agent heartbeat")
  .action(async (id) => {
    const agent = await getStore().heartbeat(id);
    console.log(JSON.stringify(agent, null, 2));
  });

agentCmd
  .command("release <id>")
  .description("Release an agent")
  .action(async (id) => {
    await getStore().releaseAgent(id);
    console.log("Agent released.");
  });

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------
const projCmd = program.command("project").description("Project management");

withJsonFlag(projCmd.command("create"))
  .description("Create a project")
  .requiredOption("--name <name>", "Project name")
  .requiredOption("--path <path>", "Project path")
  .option("--description <desc>", "Description")
  .action(async (opts) => {
    const proj = await getStore().createProject({ name: opts.name, path: opts.path, description: opts.description });
    console.log(JSON.stringify(proj, null, 2));
  });

withCollectionFlags(projCmd.command("list"))
  .description("List projects")
  .action(async (opts) => {
    const projects = await getStore().listProjects(); printCollection("projects", projects, opts, compactProject);
  });

withJsonFlag(projCmd.command("get <id>"))
  .description("Get project details")
  .action(async (id) => {
    console.log(JSON.stringify(await getStore().getProject(id), null, 2));
  });

projCmd
  .command("delete <id>")
  .description("Delete a project")
  .action(async (id) => {
    await getStore().deleteProject(id);
    console.log("Project deleted.");
  });

// ---------------------------------------------------------------------------
// Schedules
// ---------------------------------------------------------------------------
const schedCmd = program.command("schedule").description("Cron schedules");

withJsonFlag(schedCmd.command("create"))
  .description("Create a schedule")
  .requiredOption("--name <name>", "Schedule name")
  .requiredOption("--cron <expr>", "Cron expression (5-field)")
  .requiredOption("--action <type>", "Action type")
  .requiredOption("--command <cmd>", "Command to run")
  .option("--agent <id>", "Agent ID")
  .option("--project <id>", "Project ID")
  .action(async (opts) => {
    const sched = await getStore().createSchedule({
      name: opts.name,
      cron_expression: opts.cron,
      action: opts.action,
      command: opts.command,
      agent_id: opts.agent,
      project_id: opts.project,
    });
    console.log(JSON.stringify(sched, null, 2));
  });

withJsonFlag(schedCmd.command("ai <description>"))
  .description("Create schedule from natural language (Cerebras AI)")
  .option("--agent <id>", "Agent ID")
  .action(async (description, opts) => {
    const parsed = await generateSchedule(description);
    console.log("AI parsed schedule:", JSON.stringify(parsed, null, 2));
    const sched = await getStore().createSchedule({
      name: parsed.description,
      cron_expression: parsed.cron_expression,
      action: parsed.action as any,
      command: parsed.command,
      parameters: parsed.parameters,
      agent_id: opts.agent,
    });
    console.log("Created:", JSON.stringify(sched, null, 2));
  });

withCollectionFlags(schedCmd.command("list"))
  .description("List schedules")
  .option("--agent <id>", "Filter by agent")
  .action(async (opts) => {
    const schedules = await getStore().listSchedules({ agent_id: opts.agent }); printCollection("schedules", schedules, opts, compactSchedule);
  });

schedCmd
  .command("enable <id>")
  .action(async (id) => { await getStore().enableSchedule(id); console.log("Enabled."); });

schedCmd
  .command("disable <id>")
  .action(async (id) => { await getStore().disableSchedule(id); console.log("Disabled."); });

schedCmd
  .command("delete <id>")
  .action(async (id) => { await getStore().deleteSchedule(id); console.log("Deleted."); });

withJsonFlag(schedCmd.command("run"))
  .description("Run all due schedules now")
  .action(async () => {
    const results = await tick();
    console.log(JSON.stringify(results, null, 2));
  });

// ---------------------------------------------------------------------------
// TTS / STT
// ---------------------------------------------------------------------------
program
  .command("tts")
  .description("Text-to-speech (ElevenLabs)")
  .requiredOption("--text <text>", "Text to convert")
  .option("--voice <id>", "Voice ID")
  .option("--out <file>", "Output filename")
  .action(async (opts) => {
    const result = await generateSpeech({ text: opts.text, voice_id: opts.voice, output_path: opts.out });
    console.log("Audio saved:", result.path, `(${result.size} bytes)`);
  });

withJsonFlag(program.command("stt"))
  .description("Speech-to-text (ElevenLabs)")
  .requiredOption("--file <path>", "Audio file path")
  .action(async (opts) => {
    const result = await transcribe(opts.file);
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command("voices")
  .description("List available TTS voices")
  .action(async () => {
    const voices = await listVoices();
    for (const v of voices) {
      console.log(`${v.voice_id}  ${v.name}  [${v.category}]`);
    }
  });

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------
const contactCmd = program.command("contact").description("Contact management");

withJsonFlag(contactCmd.command("add"))
  .requiredOption("--name <name>", "Contact name")
  .requiredOption("--phone <number>", "Phone number")
  .option("--email <email>", "Email")
  .option("--agent <id>", "Agent ID")
  .option("--notes <text>", "Notes")
  .action(async (opts) => {
    const c = await getStore().createContact({ name: opts.name, phone: opts.phone, email: opts.email, agent_id: opts.agent, notes: opts.notes });
    console.log(JSON.stringify(c, null, 2));
  });

withCollectionFlags(contactCmd.command("list"))
  .option("--agent <id>", "Filter by agent")
  .action(async (opts) => {
    const contacts = await getStore().listContacts({ agent_id: opts.agent }); printCollection("contacts", contacts, opts, compactContact);
  });

withCollectionFlags(contactCmd.command("search <query>"))
  .action(async (query, opts) => {
    const contacts = await getStore().searchContacts(query); printCollection("contacts", contacts, opts, compactContact);
  });

contactCmd
  .command("delete <id>")
  .action(async (id) => { await getStore().deleteContact(id); console.log("Deleted."); });

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------
const whCmd = program.command("webhook").description("Webhook management");

withJsonFlag(whCmd.command("create"))
  .requiredOption("--url <url>", "Webhook URL")
  .option("--events <events>", "Comma-separated events")
  .option("--secret <secret>", "Signing secret")
  .action(async (opts) => {
    const wh = await getStore().createWebhook({ url: opts.url, events: opts.events?.split(","), secret: opts.secret });
    console.log(JSON.stringify(wh, null, 2));
  });

withCollectionFlags(whCmd.command("list")).action(async (opts) => { const webhooks = await getStore().listWebhooks(); printCollection("webhooks", webhooks, opts, compactWebhook); });
whCmd.command("delete <id>").action(async (id) => { await getStore().deleteWebhook(id); console.log("Deleted."); });

// ---------------------------------------------------------------------------
// AI Message Generation
// ---------------------------------------------------------------------------
program
  .command("ai-message")
  .description("Generate a message using Cerebras AI")
  .requiredOption("--context <text>", "Context")
  .requiredOption("--instruction <text>", "Instruction")
  .option("--tone <tone>", "Tone")
  .action(async (opts) => {
    const msg = await generateMessage({ context: opts.context, instruction: opts.instruction, tone: opts.tone });
    console.log(msg);
  });

// ---------------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------------
withCollectionFlags(program.command("conversation <phone>"))
  .description("View conversation with a phone number")
  .action(async (phone, opts) => {
    if (opts.full) { console.log(JSON.stringify(await getStore().getConversation(phone, 50))); return; }
    const page = pageOptions(opts);
    if (page.cursor !== 0) throw new Error("conversation does not support --cursor; use --full for the legacy response");
    const msgs = await getStore().getConversation(phone, page.limit + 1);
    console.log(JSON.stringify(windowPage("messages", msgs, page, compactMessage)));
  });

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
withJsonFlag(program.command("config"))
  .description("Show current configuration")
  .action(() => {
    const config = getConfig();
    const safe = {
      ...config,
      twilio_auth_token: config.twilio_auth_token ? "***" : undefined,
      elevenlabs_api_key: config.elevenlabs_api_key ? "***" : undefined,
      openai_api_key: config.openai_api_key ? "***" : undefined,
      cerebras_api_key: config.cerebras_api_key ? "***" : undefined,
    };
    console.log(JSON.stringify(safe, null, 2));
  });

// ---------------------------------------------------------------------------
// Serve
// ---------------------------------------------------------------------------
program
  .command("serve")
  .description("Start REST API + webhook server")
  .option("--port <port>", "Port number", "19451")
  .action(async (opts) => {
    // The local serve surface stores through the same resolver as every other
    // command: without the fleet API env AND without the explicit local opt-in
    // this fails closed with an actionable error instead of booting a server
    // whose data routes would serve against a phantom local database.
    getStore();
    process.env["TELEPHONY_PORT"] = opts.port;
    await import("../server/index.js");
  });
registerEventsCommands(program, { source: "telephony" });

// ---------------------------------------------------------------------------
// Graceful top-level error handling
// ---------------------------------------------------------------------------
// Every command action is async; `parseAsync` surfaces a rejected action as a
// rejected promise so we can print a clean, one-line diagnostic instead of a
// raw Bun/Node stack trace. This is what turns a dead-upstream provider call
// (e.g. the server's Twilio credential being rejected → 502 twilio_error) or a
// missing local credential into an actionable message rather than a crash dump.
// Never prints secret values — only the provider/HTTP error code + message.
function formatCliError(err: unknown): string {
  if (err instanceof HasnaHttpError) {
    const body = err.body as { error?: string; message?: string } | null;
    const detail =
      body && (body.message || body.error)
        ? `${body.error ?? "error"}${body.message ? `: ${body.message}` : ""}`
        : err.message;
    return `telephony: cloud request failed (HTTP ${err.status}): ${detail}`;
  }
  if (err && typeof err === "object") {
    const e = err as { status?: number; code?: number | string; message?: string };
    // Twilio REST exceptions (local transport direct provider call) carry code+status.
    if (e.code !== undefined && e.status !== undefined && e.message) {
      return `telephony: Twilio error ${e.code} (HTTP ${e.status}): ${e.message}`;
    }
    if (typeof e.message === "string" && e.message) return `telephony: ${e.message}`;
  }
  return `telephony: ${String(err)}`;
}

program.parseAsync().catch((err) => {
  console.error(formatCliError(err));
  process.exitCode = 1;
});
