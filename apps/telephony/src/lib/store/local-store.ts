// ── The on-box SQLite store, in its own module and its own bundle ────────────
//
// WHY THIS FILE EXISTS SEPARATELY FROM ../store/index.ts. This is the ONLY
// module in the telephony client graph that reaches `bun:sqlite` (through
// ../../db/*), and the shipped CLI and MCP bins must not contain the SQLite
// engine at all: a fleet bin that carries an embedded database is one bad
// branch away from silently serving on-box data to somebody who believes they
// are on the fleet. So the door is a single RUNTIME import behind the explicit
// opt-in (../store/local-store-loader.ts), and the bundler emits this module
// as its own artifact (`dist/local/local-store.js`) instead of folding it into
// `dist/cli/index.js` / `dist/mcp/index.js`.
//
// Nothing imports this file statically except that loader's `import()` and the
// build script's entry list. Import it directly and you put `bun:sqlite` back
// in whatever bundle you did it from.
//
// The behaviour is unchanged from when this class lived in ../store/index.ts:
// it is the same LocalStore, delegating to the query/mutation helpers in
// ../../db/*, opening the database handle lazily on first use, and calling the
// Twilio/ElevenLabs providers directly because in local mode this machine IS
// the server.
import * as dbAgents from "../../db/agents.js";
import * as dbProjects from "../../db/projects.js";
import * as dbNumbers from "../../db/phone-numbers.js";
import * as dbMessages from "../../db/messages.js";
import * as dbCalls from "../../db/calls.js";
import * as dbVoicemails from "../../db/voicemails.js";
import * as dbContacts from "../../db/contacts.js";
import * as dbSchedules from "../../db/schedules.js";
import * as dbWebhooks from "../../db/webhooks.js";
import { getDatabase } from "../../db/database.js";
import { getTwilioClient } from "../twilio.js";
import { fetchVoicesFromProvider } from "../tts.js";

import type {
  CallFilters,
  CreateCallInput,
  CreateMessageInput,
  CreatePhoneNumberInput,
  CreateVoicemailInput,
  FeedbackInput,
  MessageFilters,
  ScheduleFilters,
  SearchAvailableOptions,
  TelephonyStore,
  VoicemailFilters,
} from "./index.js";
import type {
  CallStatus,
  CreateContactInput,
  CreateProjectInput,
  CreateScheduleInput,
  CreateWebhookInput,
  MessageStatus,
  RegisterAgentInput,
} from "../../types/index.js";

export class SqliteLocalStore implements TelephonyStore {
  readonly transport = "local" as const;

  // Agents
  async registerAgent(input: RegisterAgentInput) {
    return dbAgents.registerAgent(input);
  }
  async listAgents(projectId?: string) {
    return dbAgents.listAgents(projectId);
  }
  async getAgent(id: string) {
    return dbAgents.getAgent(id);
  }
  async getAgentByName(name: string) {
    return dbAgents.getAgentByName(name);
  }
  async heartbeat(agentId: string) {
    return dbAgents.heartbeat(agentId);
  }
  async releaseAgent(agentId: string) {
    return dbAgents.releaseAgent(agentId);
  }
  async setFocus(agentName: string, projectId: string) {
    const db = getDatabase();
    const res = db.run("UPDATE agents SET project_id = ?, updated_at = datetime('now') WHERE LOWER(name) = ?", [
      projectId,
      agentName.toLowerCase(),
    ]);
    return res.changes > 0;
  }

  // Projects
  async createProject(input: CreateProjectInput) {
    return dbProjects.createProject(input);
  }
  async listProjects() {
    return dbProjects.listProjects();
  }
  async getProject(id: string) {
    return dbProjects.getProject(id);
  }
  async deleteProject(id: string) {
    return dbProjects.deleteProject(id);
  }

  // Phone numbers
  async listPhoneNumbers(filters?: { agent_id?: string; project_id?: string; status?: string }) {
    return dbNumbers.listPhoneNumbers(filters);
  }
  async getPhoneNumberByNumber(number: string) {
    return dbNumbers.getPhoneNumberByNumber(number);
  }
  async createPhoneNumber(input: CreatePhoneNumberInput) {
    return dbNumbers.createPhoneNumber(input);
  }
  async assignPhoneNumber(id: string, agentId?: string, projectId?: string) {
    return dbNumbers.assignPhoneNumber(id, agentId, projectId);
  }
  async releasePhoneNumber(id: string) {
    return dbNumbers.releasePhoneNumberDb(id);
  }

  // Twilio provider passthrough — local machine calls Twilio directly with its
  // own configured credentials (local IS the server in this mode).
  async searchAvailableNumbers(options: SearchAvailableOptions) {
    const client = getTwilioClient();
    const country = options.country || "US";
    const limit = options.limit || 10;
    const params: Record<string, unknown> = { limit };
    if (options.area_code) params.areaCode = parseInt(options.area_code, 10);
    if (options.contains) params.contains = options.contains;
    if (options.sms_enabled !== undefined) params.smsEnabled = options.sms_enabled;
    if (options.voice_enabled !== undefined) params.voiceEnabled = options.voice_enabled;
    const numbers = await client.availablePhoneNumbers(country).local.list(params);
    return numbers.map((n) => ({
      phoneNumber: n.phoneNumber,
      friendlyName: n.friendlyName,
      locality: n.locality,
      region: n.region,
      capabilities: { voice: n.capabilities.voice, sms: n.capabilities.sms, mms: n.capabilities.mms },
    }));
  }
  async listTwilioNumbers() {
    const client = getTwilioClient();
    const numbers = await client.incomingPhoneNumbers.list({ limit: 100 });
    return numbers.map((n) => ({ sid: n.sid, phoneNumber: n.phoneNumber, friendlyName: n.friendlyName }));
  }
  async listVoices() {
    // Local machine calls ElevenLabs directly with its own credential.
    return fetchVoicesFromProvider();
  }

  // Messages
  async createMessage(input: CreateMessageInput) {
    return dbMessages.createMessage(input);
  }
  async updateMessageStatus(id: string, status: MessageStatus, errorMessage?: string) {
    dbMessages.updateMessageStatus(id, status, errorMessage);
  }
  async updateMessageMedia(id: string, extra: { object_key: string; sha256: string }) {
    dbMessages.updateMessageMedia(id, extra);
  }
  async listMessages(filters?: MessageFilters) {
    return dbMessages.listMessages(filters);
  }
  async searchMessages(query: string, limit?: number) {
    return dbMessages.searchMessages(query, limit);
  }
  async getConversation(phoneNumber: string, limit?: number) {
    return dbMessages.getConversation(phoneNumber, limit);
  }

  // Calls
  async createCall(input: CreateCallInput) {
    return dbCalls.createCall(input);
  }
  async updateCallStatus(
    id: string,
    status: CallStatus,
    extra?: { duration?: number; recording_url?: string; transcription?: string; object_key?: string; sha256?: string },
  ) {
    dbCalls.updateCallStatus(id, status, extra);
  }
  async getCallByTwilioSid(twilioSid: string) {
    return dbCalls.getCallByTwilioSid(twilioSid);
  }
  async listCalls(filters?: CallFilters) {
    return dbCalls.listCalls(filters);
  }

  // Voicemails
  async createVoicemail(input: CreateVoicemailInput) {
    return dbVoicemails.createVoicemail(input);
  }
  async updateVoicemailMedia(id: string, extra: { object_key: string; sha256: string }) {
    dbVoicemails.updateVoicemailMedia(id, extra);
  }
  async listVoicemails(filters?: VoicemailFilters) {
    return dbVoicemails.listVoicemails(filters);
  }
  async markVoicemailListened(id: string) {
    return dbVoicemails.markVoicemailListened(id);
  }

  // Contacts
  async createContact(input: CreateContactInput) {
    return dbContacts.createContact(input);
  }
  async listContacts(filters?: { agent_id?: string; project_id?: string }) {
    return dbContacts.listContacts(filters);
  }
  async searchContacts(query: string) {
    return dbContacts.searchContacts(query);
  }
  async deleteContact(id: string) {
    return dbContacts.deleteContact(id);
  }

  // Schedules
  async createSchedule(input: CreateScheduleInput) {
    return dbSchedules.createSchedule(input);
  }
  async listSchedules(filters?: ScheduleFilters) {
    return dbSchedules.listSchedules(filters);
  }
  async enableSchedule(id: string) {
    return dbSchedules.enableSchedule(id);
  }
  async disableSchedule(id: string) {
    return dbSchedules.disableSchedule(id);
  }
  async deleteSchedule(id: string) {
    return dbSchedules.deleteSchedule(id);
  }
  async getDueSchedules() {
    return dbSchedules.getDueSchedules();
  }
  async markScheduleRun(id: string) {
    dbSchedules.markScheduleRun(id);
  }

  // Webhooks
  async createWebhook(input: CreateWebhookInput) {
    return dbWebhooks.createWebhook(input);
  }
  async listWebhooks() {
    return dbWebhooks.listWebhooks();
  }
  async listWebhookDispatchTargets() {
    return dbWebhooks.listWebhookDispatchTargets();
  }
  async deleteWebhook(id: string) {
    return dbWebhooks.deleteWebhook(id);
  }

  // Feedback
  async saveFeedback(input: FeedbackInput) {
    const db = getDatabase();
    db.prepare("INSERT INTO feedback (message, email, category, version) VALUES (?, ?, ?, ?)").run(
      input.message,
      input.email || null,
      input.category || "general",
      input.version,
    );
  }
}

/**
 * Construct the on-box store. The loader calls this rather than `new`ing the
 * class across a module boundary, so the exported shape of this module stays
 * one function the loader can type without importing the class.
 */
export function createSqliteLocalStore(): TelephonyStore {
  return new SqliteLocalStore();
}
