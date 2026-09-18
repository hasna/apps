import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import pkg from "../../package.json";
// Storage routed through the single Store abstraction: the server's /v1 HTTP
// API when HASNA_TELEPHONY_API_URL + HASNA_TELEPHONY_API_KEY are set, or the
// on-box SQLite store under the EXPLICIT local opt-in HASNA_TELEPHONY_LOCAL=1
// only. Without either the resolver fails closed, so no tool can silently
// read/write the on-box island. This mirrors the CLI wiring
// (src/cli/index.ts -> ../lib/store). No MCP tool touches sqlite or fetch
// directly.
import { getStore } from "../lib/store/index.js";
import { sendSms } from "../lib/sms.js";
import { sendWhatsApp, sendWhatsAppAudio } from "../lib/whatsapp.js";
import { makeCall } from "../lib/voice.js";
import { searchAvailableNumbers, provisionNumber, releaseNumber, configureNumber } from "../lib/provisioning.js";
import { generateSpeech, listVoices } from "../lib/tts.js";
import { transcribe } from "../lib/stt.js";
import { generateSchedule, generateMessage, analyzeIncomingMessage } from "../lib/cerebras.js";
import { setGreeting } from "../lib/voicemail.js";
import { tick } from "../lib/scheduler.js";
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

const collectionSchema = {
  limit: z.number().int().positive().max(100).optional().describe("Max returned rows (default 20)"),
  cursor: z.number().int().nonnegative().optional().describe("Zero-based row offset"),
  verbose: z.boolean().optional().describe("Return full fields within the selected page"),
  full: z.boolean().optional().describe("Return the legacy response shape"),
};
const text = (value: unknown) => ({ content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value) }] });

export function buildServer(): McpServer {
  const server = new McpServer({ name: "telephony", version: pkg.version });

  // --- Agents ---
  server.tool("telephony_register_agent", "Register an agent", {
    name: z.string(), description: z.string().optional(), session_id: z.string().optional(),
    project_id: z.string().optional(), capabilities: z.array(z.string()).optional(), force: z.boolean().optional(),
  }, async (args) => ({ content: [{ type: "text" as const, text: JSON.stringify(await getStore().registerAgent(args), null, 2) }] }));

  server.tool("telephony_list_agents", "List registered agents", {
    project_id: z.string().optional(), ...collectionSchema,
  }, async (args) => {
    const rows = await getStore().listAgents(args.project_id);
    return text(args.full ? rows : collectionPage("agents", rows, args, compactAgent));
  });

  server.tool("telephony_get_agent", "Get agent by ID or name", { id: z.string() }, async (args) => {
    const agent = (await getStore().getAgent(args.id)) || (await getStore().getAgentByName(args.id));
    return { content: [{ type: "text" as const, text: JSON.stringify(agent, null, 2) }] };
  });

  server.tool("telephony_heartbeat", "Send agent heartbeat", { agent_id: z.string() },
    async (args) => ({ content: [{ type: "text" as const, text: JSON.stringify(await getStore().heartbeat(args.agent_id), null, 2) }] }));

  // --- Projects ---
  server.tool("telephony_create_project", "Create a project", {
    name: z.string(), path: z.string(), description: z.string().optional(),
  }, async (args) => ({ content: [{ type: "text" as const, text: JSON.stringify(await getStore().createProject(args), null, 2) }] }));

  server.tool("telephony_list_projects", "List projects", collectionSchema, async (args) => {
    const rows = await getStore().listProjects();
    return text(args.full ? rows : collectionPage("projects", rows, args, compactProject));
  });

  // --- SMS ---
  server.tool("telephony_send_sms", "Send an SMS message", {
    to: z.string().describe("Recipient phone (E.164)"), body: z.string(),
    from: z.string().optional(), agent_id: z.string().optional(), project_id: z.string().optional(),
  }, async (args) => ({ content: [{ type: "text" as const, text: JSON.stringify(await sendSms(args), null, 2) }] }));

  // --- WhatsApp ---
  server.tool("telephony_send_whatsapp", "Send a WhatsApp text message", {
    to: z.string(), body: z.string(), from: z.string().optional(), agent_id: z.string().optional(),
  }, async (args) => ({ content: [{ type: "text" as const, text: JSON.stringify(await sendWhatsApp(args), null, 2) }] }));

  server.tool("telephony_send_audio", "Send a WhatsApp audio message", {
    to: z.string(), media_url: z.string(), body: z.string().optional(), from: z.string().optional(),
  }, async (args) => ({ content: [{ type: "text" as const, text: JSON.stringify(await sendWhatsAppAudio(args), null, 2) }] }));

  // --- Messages ---
  server.tool("telephony_list_messages", "List messages", {
    agent_id: z.string().optional(), project_id: z.string().optional(), ...collectionSchema,
  }, async (args) => {
    if (args.full) return text(await getStore().listMessages({ agent_id: args.agent_id, project_id: args.project_id, limit: 50 }));
    const limit = args.limit ?? 20; const cursor = args.cursor ?? 0;
    const page = await getStore().listMessagesPage({ agent_id: args.agent_id, project_id: args.project_id, limit: limit + 1, offset: cursor });
    return text(windowPage("messages", page.items, { limit, cursor, verbose: args.verbose, total: page.total }, compactMessage));
  });

  server.tool("telephony_search_messages", "Search messages by text", {
    query: z.string(), ...collectionSchema,
  }, async (args) => {
    if (args.full) return text(await getStore().searchMessages(args.query, 50));
    if ((args.cursor ?? 0) !== 0) return { ...text("Search does not support cursor pagination; refine the query or use full=true."), isError: true };
    const limit = args.limit ?? 20; const rows = await getStore().searchMessages(args.query, limit + 1);
    return text(windowPage("messages", rows, { limit, cursor: 0, verbose: args.verbose }, compactMessage));
  });

  server.tool("telephony_get_conversation", "Get conversation with a phone number", {
    phone_number: z.string(), ...collectionSchema,
  }, async (args) => {
    if (args.full) return text(await getStore().getConversation(args.phone_number, 50));
    if ((args.cursor ?? 0) !== 0) return { ...text("Conversation does not support cursor pagination; use full=true for the legacy response."), isError: true };
    const limit = args.limit ?? 20; const rows = await getStore().getConversation(args.phone_number, limit + 1);
    return text(windowPage("messages", rows, { limit, cursor: 0, verbose: args.verbose }, compactMessage));
  });

  // --- Calls ---
  server.tool("telephony_make_call", "Make an outbound call", {
    to: z.string(), from: z.string().optional(), twiml: z.string().optional(), agent_id: z.string().optional(),
  }, async (args) => ({ content: [{ type: "text" as const, text: JSON.stringify(await makeCall(args), null, 2) }] }));

  server.tool("telephony_list_calls", "List call log", {
    agent_id: z.string().optional(), project_id: z.string().optional(), ...collectionSchema,
  }, async (args) => {
    if (args.full) return text(await getStore().listCalls({ agent_id: args.agent_id, project_id: args.project_id, limit: 50 }));
    const limit = args.limit ?? 20; const cursor = args.cursor ?? 0;
    const page = await getStore().listCallsPage({ agent_id: args.agent_id, project_id: args.project_id, limit: limit + 1, offset: cursor });
    return text(windowPage("calls", page.items, { limit, cursor, verbose: args.verbose, total: page.total }, compactCall));
  });

  // --- Phone Numbers ---
  server.tool("telephony_search_available_numbers", "Search available phone numbers to buy", {
    country: z.string().optional(), area_code: z.string().optional(), limit: z.number().optional(),
  }, async (args) => ({ content: [{ type: "text" as const, text: JSON.stringify(await searchAvailableNumbers(args), null, 2) }] }));

  server.tool("telephony_provision_number", "Buy a phone number from Twilio", {
    phone_number: z.string(), agent_id: z.string().optional(), project_id: z.string().optional(), friendly_name: z.string().optional(),
  }, async (args) => ({ content: [{ type: "text" as const, text: JSON.stringify(await provisionNumber(args), null, 2) }] }));

  server.tool("telephony_release_number", "Release a phone number", { number: z.string() },
    async (args) => { await releaseNumber(args.number); return { content: [{ type: "text" as const, text: "Number released." }] }; });

  server.tool("telephony_list_numbers", "List provisioned phone numbers", {
    agent_id: z.string().optional(), project_id: z.string().optional(), ...collectionSchema,
  }, async (args) => { const rows = await getStore().listPhoneNumbers(args); return text(args.full ? rows : collectionPage("numbers", rows, args, compactPhoneNumber)); });

  server.tool("telephony_assign_number", "Assign phone number to agent/project", {
    id: z.string(), agent_id: z.string().optional(), project_id: z.string().optional(),
  }, async (args) => ({ content: [{ type: "text" as const, text: JSON.stringify(await getStore().assignPhoneNumber(args.id, args.agent_id, args.project_id), null, 2) }] }));

  server.tool("telephony_configure_number", "Configure a Twilio phone number", {
    sid: z.string(), sms_url: z.string().optional(), voice_url: z.string().optional(), friendly_name: z.string().optional(),
  }, async (args) => { await configureNumber(args.sid, args); return { content: [{ type: "text" as const, text: "Number configured." }] }; });

  // --- TTS / STT ---
  server.tool("telephony_tts", "Generate speech from text (ElevenLabs)", {
    text: z.string(), voice_id: z.string().optional(), output_path: z.string().optional(),
  }, async (args) => ({ content: [{ type: "text" as const, text: JSON.stringify(await generateSpeech(args), null, 2) }] }));

  server.tool("telephony_stt", "Transcribe audio file to text (ElevenLabs)", { file_path: z.string() },
    async (args) => ({ content: [{ type: "text" as const, text: JSON.stringify(await transcribe(args.file_path), null, 2) }] }));

  server.tool("telephony_list_voices", "List available TTS voices", {}, async () =>
    ({ content: [{ type: "text" as const, text: JSON.stringify(await listVoices(), null, 2) }] }));

  // --- Voicemail ---
  server.tool("telephony_list_voicemails", "List voicemails", {
    agent_id: z.string().optional(), project_id: z.string().optional(), ...collectionSchema,
  }, async (args) => { const rows = await getStore().listVoicemails(args); return text(args.full ? rows : collectionPage("voicemails", rows, args, compactVoicemail)); });

  server.tool("telephony_set_greeting", "Set voicemail greeting using TTS", {
    agent_id: z.string(), text: z.string(), voice_id: z.string().optional(),
  }, async (args) => ({ content: [{ type: "text" as const, text: JSON.stringify(await setGreeting(args), null, 2) }] }));

  // --- Contacts ---
  server.tool("telephony_add_contact", "Add a contact", {
    name: z.string(), phone: z.string(), email: z.string().optional(),
    agent_id: z.string().optional(), project_id: z.string().optional(), notes: z.string().optional(),
  }, async (args) => ({ content: [{ type: "text" as const, text: JSON.stringify(await getStore().createContact(args), null, 2) }] }));

  server.tool("telephony_list_contacts", "List contacts", {
    agent_id: z.string().optional(), project_id: z.string().optional(), ...collectionSchema,
  }, async (args) => { const rows = await getStore().listContacts(args); return text(args.full ? rows : collectionPage("contacts", rows, args, compactContact)); });

  server.tool("telephony_search_contacts", "Search contacts", { query: z.string(), ...collectionSchema },
    async (args) => { const rows = await getStore().searchContacts(args.query); return text(args.full ? rows : collectionPage("contacts", rows, args, compactContact)); });

  // --- Schedules ---
  server.tool("telephony_create_schedule", "Create a cron schedule", {
    name: z.string(), cron_expression: z.string(),
    action: z.enum(["send_sms", "send_whatsapp", "make_call", "tts", "custom"]),
    command: z.string(), parameters: z.record(z.unknown()).optional(),
    agent_id: z.string().optional(), project_id: z.string().optional(),
  }, async (args) => ({ content: [{ type: "text" as const, text: JSON.stringify(await getStore().createSchedule(args as any), null, 2) }] }));

  server.tool("telephony_create_schedule_ai", "Create schedule from natural language (Cerebras AI)", {
    description: z.string().describe("e.g. 'send SMS to +1234 every day at 9am'"), agent_id: z.string().optional(),
  }, async (args) => {
    const parsed = await generateSchedule(args.description);
    const sched = await getStore().createSchedule({ name: parsed.description, cron_expression: parsed.cron_expression, action: parsed.action as any, command: parsed.command, parameters: parsed.parameters, agent_id: args.agent_id });
    return { content: [{ type: "text" as const, text: JSON.stringify({ parsed, schedule: sched }, null, 2) }] };
  });

  server.tool("telephony_list_schedules", "List schedules", {
    agent_id: z.string().optional(), project_id: z.string().optional(), ...collectionSchema,
  }, async (args) => { const rows = await getStore().listSchedules(args); return text(args.full ? rows : collectionPage("schedules", rows, args, compactSchedule)); });

  server.tool("telephony_run_schedules", "Run all due schedules now", {}, async () =>
    ({ content: [{ type: "text" as const, text: JSON.stringify(await tick(), null, 2) }] }));

  // --- AI ---
  server.tool("telephony_ai_message", "Generate a message using Cerebras AI", {
    context: z.string(), instruction: z.string(), tone: z.string().optional(),
  }, async (args) => ({ content: [{ type: "text" as const, text: await generateMessage(args) }] }));

  server.tool("telephony_ai_analyze", "Analyze an incoming message with AI", { message: z.string() },
    async (args) => ({ content: [{ type: "text" as const, text: JSON.stringify(await analyzeIncomingMessage(args.message), null, 2) }] }));

  // --- Webhooks ---
  server.tool("telephony_create_webhook", "Register a webhook", {
    url: z.string(), events: z.array(z.string()).optional(), secret: z.string().optional(),
  }, async (args) => ({ content: [{ type: "text" as const, text: JSON.stringify(await getStore().createWebhook(args), null, 2) }] }));

  server.tool("telephony_list_webhooks", "List webhooks", collectionSchema, async (args) => {
    const rows = await getStore().listWebhooks(); return text(args.full ? rows : collectionPage("webhooks", rows, args, compactWebhook));
  });

  // --- Meta ---
  server.tool("telephony_describe_tools", "List all available telephony tools", {}, async () => {
    const tools = ["telephony_register_agent", "telephony_list_agents", "telephony_get_agent", "telephony_heartbeat", "telephony_create_project", "telephony_list_projects", "telephony_send_sms", "telephony_send_whatsapp", "telephony_send_audio", "telephony_list_messages", "telephony_search_messages", "telephony_get_conversation", "telephony_make_call", "telephony_list_calls", "telephony_search_available_numbers", "telephony_provision_number", "telephony_release_number", "telephony_list_numbers", "telephony_assign_number", "telephony_configure_number", "telephony_tts", "telephony_stt", "telephony_list_voices", "telephony_list_voicemails", "telephony_set_greeting", "telephony_add_contact", "telephony_list_contacts", "telephony_search_contacts", "telephony_create_schedule", "telephony_create_schedule_ai", "telephony_list_schedules", "telephony_run_schedules", "telephony_ai_message", "telephony_ai_analyze", "telephony_create_webhook", "telephony_list_webhooks", "telephony_send_feedback"];
    return { content: [{ type: "text" as const, text: tools.join("\n") }] };
  });

  server.tool("telephony_send_feedback", "Send feedback about this service", {
    message: z.string(), email: z.string().optional(), category: z.enum(["bug", "feature", "general"]).optional(),
  }, async (args) => {
    try {
      await getStore().saveFeedback({ message: args.message, email: args.email, category: args.category, version: pkg.version });
      return { content: [{ type: "text" as const, text: "Feedback saved. Thank you!" }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: String(e) }], isError: true };
    }
  });

  server.tool("telephony_set_focus", "Set agent focus to a project", {
    project_id: z.string(), from: z.string().optional(),
  }, async (args) => {
    const agent = args.from || "unknown";
    const focused = await getStore().setFocus(agent, args.project_id);
    return { content: [{ type: "text" as const, text: JSON.stringify({ agent, focused, project_id: args.project_id }) }] };
  });

  return server;
}
