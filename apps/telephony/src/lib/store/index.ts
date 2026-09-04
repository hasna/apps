// ── The telephony Store abstraction ──────────────────────────────────────────
//
// ONE interface, TWO transports. Every CLI command, MCP tool, and SDK caller
// that reads or writes telephony DATA goes through `TelephonyStore`. There are
// exactly two implementations:
//
//   • LocalStore — on-box SQLite. Delegates to the query/mutation helpers in
//     ../../db/*. The database handle opens lazily on first use, so the `sqlite`
//     backend is first-class and fully functional; the `postgres` backend never
//     touches sqlite.
//   • ApiStore   — the server's HTTP API at `<API_URL>/v1` with a bearer key.
//     Delegates to the vendored client-flip HTTP storage client.
//
// `getStore()` resolves which transport to use from the API env pair
// (HASNA_TELEPHONY_API_URL + HASNA_TELEPHONY_API_KEY both set selects the HTTP
// API). With neither set the resolver FAILS CLOSED (owner directive 2026-09-04):
// it throws an actionable error naming the required env instead of silently
// serving on-box SQLite — the LocalStore is reachable ONLY through the explicit
// opt-in `HASNA_TELEPHONY_LOCAL=1` (alias `TELEPHONY_LOCAL=1`). A partial pair
// throws naming the missing variable; any retired STORAGE_MODE variable throws
// first. Callers NEVER branch on the backend themselves and NEVER touch sqlite
// or fetch directly — that was the split-brain bug this module eliminates.
//
// Who runs the server and what they pay for it is operation, not a storage
// branch: a user's own server and the hosted SaaS are the SAME client code
// (ApiStore); only the URL and key differ.
//
// SAFETY: the API key never leaves the transport; it is never logged, returned,
// or embedded in any value produced here. Only the HTTP transport ever holds it.
// There is NO database DSN on the client — the client never opens PostgreSQL; the
// server-backed transport is HTTP + key only.

import {
  HasnaHttpError,
  resolveStorageClient,
  type HasnaStorageClient,
} from "@hasna/contracts";
import { assertNoLegacyStorageMode } from "../retired-storage-mode.js";

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
import { fetchVoicesFromProvider, type Voice } from "../tts.js";

import type {
  Agent,
  AgentConflictError,
  Call,
  CallDirection,
  CallStatus,
  Contact,
  CreateContactInput,
  CreateProjectInput,
  CreateScheduleInput,
  CreateWebhookInput,
  Message,
  MessageStatus,
  MessageType,
  PhoneNumber,
  PhoneNumberCapability,
  Project,
  RegisterAgentInput,
  Schedule,
  Voicemail,
  Webhook,
  WebhookDispatchTarget,
} from "../../types/index.js";

export const TELEPHONY_APP = "telephony";

// ── Input shapes (mirror the db/* create signatures) ─────────────────────────

export interface CreateMessageInput {
  type: MessageType;
  from_number: string;
  to_number: string;
  body?: string;
  media_url?: string;
  object_key?: string | null;
  sha256?: string | null;
  status?: MessageStatus;
  agent_id?: string;
  project_id?: string;
  twilio_sid?: string;
}

export interface CreateCallInput {
  direction: CallDirection;
  from_number: string;
  to_number: string;
  agent_id?: string;
  project_id?: string;
  twilio_sid?: string;
}

export interface CreateVoicemailInput {
  call_id?: string;
  from_number: string;
  to_number: string;
  recording_url?: string;
  object_key?: string | null;
  sha256?: string | null;
  local_path?: string;
  transcription?: string;
  duration?: number;
  agent_id?: string;
  project_id?: string;
}

export interface CreatePhoneNumberInput {
  number: string;
  country?: string;
  capabilities?: PhoneNumberCapability[];
  agent_id?: string;
  project_id?: string;
  twilio_sid?: string;
  friendly_name?: string;
}

export interface FeedbackInput {
  message: string;
  email?: string;
  category?: string;
  version: string;
}

// ── Twilio provider passthrough shapes ───────────────────────────────────────
//
// `searchAvailableNumbers` and `listTwilioNumbers` are NOT stored data — they
// are live passthroughs to the Twilio API, which requires real Twilio
// credentials. Per the transport architecture the client NEVER holds real
// provider credentials or calls third-party APIs directly on the HTTP API
// transport, so ApiStore routes these through the server-side
// `/v1/numbers/{available,twilio}`
// proxy (the server holds the Twilio secret). LocalStore — which IS its own
// server on-box — calls Twilio directly with the machine's local credentials.

export interface AvailableNumber {
  phoneNumber: string;
  friendlyName: string;
  locality: string;
  region: string;
  capabilities: { voice: boolean; sms: boolean; mms: boolean };
}

export interface TwilioNumberRef {
  sid: string;
  phoneNumber: string;
  friendlyName: string;
}

export interface SearchAvailableOptions {
  country?: string;
  area_code?: string;
  contains?: string;
  sms_enabled?: boolean;
  voice_enabled?: boolean;
  limit?: number;
}

export interface MessageFilters {
  agent_id?: string;
  project_id?: string;
  type?: MessageType;
  limit?: number;
}

export interface CallFilters {
  agent_id?: string;
  project_id?: string;
  limit?: number;
}

export interface VoicemailFilters {
  agent_id?: string;
  project_id?: string;
  listened?: boolean;
}

export interface ScheduleFilters {
  agent_id?: string;
  project_id?: string;
  enabled?: boolean;
}

// ── The Store interface ──────────────────────────────────────────────────────

export interface TelephonyStore {
  /** Which transport backs this store (banners/diagnostics only). */
  readonly transport: "local" | "cloud-http";

  // Agents
  registerAgent(input: RegisterAgentInput): Promise<Agent | AgentConflictError>;
  listAgents(projectId?: string): Promise<Agent[]>;
  getAgent(id: string): Promise<Agent | null>;
  getAgentByName(name: string): Promise<Agent | null>;
  heartbeat(agentId: string): Promise<Agent | null>;
  releaseAgent(agentId: string): Promise<boolean>;
  setFocus(agentName: string, projectId: string): Promise<boolean>;

  // Projects
  createProject(input: CreateProjectInput): Promise<Project>;
  listProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project | null>;
  deleteProject(id: string): Promise<boolean>;

  // Phone numbers
  listPhoneNumbers(filters?: { agent_id?: string; project_id?: string; status?: string }): Promise<PhoneNumber[]>;
  getPhoneNumberByNumber(number: string): Promise<PhoneNumber | null>;
  createPhoneNumber(input: CreatePhoneNumberInput): Promise<PhoneNumber>;
  assignPhoneNumber(id: string, agentId?: string, projectId?: string): Promise<PhoneNumber | null>;
  releasePhoneNumber(id: string): Promise<boolean>;

  // Twilio provider passthrough (live Twilio API — server-side proxy on HTTP)
  searchAvailableNumbers(options: SearchAvailableOptions): Promise<AvailableNumber[]>;
  listTwilioNumbers(): Promise<TwilioNumberRef[]>;
  // ElevenLabs provider passthrough (non-stored data) — same transport contract
  // as the Twilio passthrough above: LocalStore calls ElevenLabs directly, ApiStore
  // routes through the server-side `/v1/voices` proxy so the credential stays
  // on the server.
  listVoices(): Promise<Voice[]>;

  // Messages
  createMessage(input: CreateMessageInput): Promise<Message>;
  updateMessageStatus(id: string, status: MessageStatus, errorMessage?: string): Promise<void>;
  /** Attach the media-copy pointers (object_key + sha256) to an existing message row. */
  updateMessageMedia(id: string, extra: { object_key: string; sha256: string }): Promise<void>;
  listMessages(filters?: MessageFilters): Promise<Message[]>;
  searchMessages(query: string, limit?: number): Promise<Message[]>;
  getConversation(phoneNumber: string, limit?: number): Promise<Message[]>;

  // Calls
  createCall(input: CreateCallInput): Promise<Call>;
  updateCallStatus(
    id: string,
    status: CallStatus,
    extra?: { duration?: number; recording_url?: string; transcription?: string; object_key?: string; sha256?: string },
  ): Promise<void>;
  /** Find a call row by its provider SID — what a Twilio webhook knows before it can address the row by id. */
  getCallByTwilioSid(twilioSid: string): Promise<Call | null>;
  listCalls(filters?: CallFilters): Promise<Call[]>;

  // Voicemails
  createVoicemail(input: CreateVoicemailInput): Promise<Voicemail>;
  /** Attach the media-copy pointers (object_key + sha256) to an existing voicemail row. */
  updateVoicemailMedia(id: string, extra: { object_key: string; sha256: string }): Promise<void>;
  listVoicemails(filters?: VoicemailFilters): Promise<Voicemail[]>;
  markVoicemailListened(id: string): Promise<boolean>;

  // Contacts
  createContact(input: CreateContactInput): Promise<Contact>;
  listContacts(filters?: { agent_id?: string; project_id?: string }): Promise<Contact[]>;
  searchContacts(query: string): Promise<Contact[]>;
  deleteContact(id: string): Promise<boolean>;

  // Schedules
  createSchedule(input: CreateScheduleInput): Promise<Schedule>;
  listSchedules(filters?: ScheduleFilters): Promise<Schedule[]>;
  enableSchedule(id: string): Promise<boolean>;
  disableSchedule(id: string): Promise<boolean>;
  deleteSchedule(id: string): Promise<boolean>;
  getDueSchedules(): Promise<Schedule[]>;
  markScheduleRun(id: string): Promise<void>;

  // Webhooks
  createWebhook(input: CreateWebhookInput): Promise<Webhook>;
  listWebhooks(): Promise<Webhook[]>;
  listWebhookDispatchTargets(): Promise<WebhookDispatchTarget[]>;
  deleteWebhook(id: string): Promise<boolean>;

  // Feedback
  saveFeedback(input: FeedbackInput): Promise<void>;
}

// ── LocalStore (on-box SQLite) ───────────────────────────────────────────────

export class LocalStore implements TelephonyStore {
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

// ── ApiStore (the server's HTTP /v1 API) ─────────────────────────────────────

/** Raised for a client op the cloud `/v1` API cannot serve. */
export class CloudUnsupportedError extends Error {
  constructor(op: string) {
    super(`telephony: '${op}' is not available against the cloud API.`);
    this.name = "CloudUnsupportedError";
  }
}

export class ApiStore implements TelephonyStore {
  readonly transport = "cloud-http" as const;
  constructor(private readonly cloud: HasnaStorageClient) {}

  private async listAll<T>(resource: string, query?: Record<string, string | number | undefined>): Promise<T[]> {
    const q: Record<string, string | number> = {};
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) q[k] = v;
      }
    }
    return (await this.cloud.list<T>(resource, { query: q })).items;
  }

  // Agents
  async registerAgent(input: RegisterAgentInput) {
    // Parity with LocalStore.registerAgent: the serve route enforces the same
    // name-normalization + active-session conflict / force-takeover semantics
    // and returns the AgentConflictError envelope with a 409 when the name is
    // held by a live session. Surface that as the conflict value (not a throw)
    // so CLI/MCP/SDK callers behave identically on either transport.
    try {
      return await this.cloud.create<Agent>("agents", input);
    } catch (error) {
      if (error instanceof HasnaHttpError && error.status === 409) {
        return error.body as AgentConflictError;
      }
      throw error;
    }
  }
  async listAgents(projectId?: string) {
    return this.listAll<Agent>("agents", { project_id: projectId });
  }
  async getAgent(id: string) {
    return this.cloud.get<Agent>("agents", id);
  }
  async getAgentByName(name: string) {
    // Case-insensitive match, mirroring LocalStore/db.getAgentByName (LOWER(name)).
    // Agent names are normalized to lowercase at registration, so compare lowered.
    const target = name.trim().toLowerCase();
    const items = await this.listAll<Agent>("agents");
    return items.find((a) => a.name.toLowerCase() === target) ?? null;
  }
  async heartbeat(agentId: string) {
    return this.cloud.update<Agent>("agents", agentId, { status: "active" });
  }
  async releaseAgent(agentId: string) {
    await this.cloud.update<Agent>("agents", agentId, { status: "inactive" });
    return true;
  }
  async setFocus(agentName: string, projectId: string) {
    const agent = await this.getAgentByName(agentName);
    if (!agent) return false;
    await this.cloud.update<Agent>("agents", agent.id, { project_id: projectId });
    return true;
  }

  // Projects
  async createProject(input: CreateProjectInput) {
    return this.cloud.create<Project>("projects", input);
  }
  async listProjects() {
    return this.listAll<Project>("projects");
  }
  async getProject(id: string) {
    return this.cloud.get<Project>("projects", id);
  }
  async deleteProject(id: string) {
    await this.cloud.delete("projects", id);
    return true;
  }

  // Phone numbers
  async listPhoneNumbers(filters?: { agent_id?: string; project_id?: string; status?: string }) {
    return this.listAll<PhoneNumber>("numbers", filters);
  }
  async getPhoneNumberByNumber(number: string) {
    // Exact `number` filter served DB-side — never a client-side scan of a
    // capped page (that missed numbers beyond the first page at scale).
    const items = await this.listAll<PhoneNumber>("numbers", { number });
    return items.find((n) => n.number === number) ?? null;
  }
  async createPhoneNumber(input: CreatePhoneNumberInput) {
    return this.cloud.create<PhoneNumber>("numbers", input);
  }
  async assignPhoneNumber(id: string, agentId?: string, projectId?: string) {
    return this.cloud.update<PhoneNumber>("numbers", id, { agent_id: agentId ?? null, project_id: projectId ?? null });
  }
  async releasePhoneNumber(id: string) {
    await this.cloud.update<PhoneNumber>("numbers", id, { status: "released" });
    return true;
  }

  // Twilio provider passthrough — routed through the server-side `/v1` proxy so
  // the real Twilio credential never leaves the server (Secrets Manager). These
  // are non-CRUD routes, so they use the transport escape hatch rather than a
  // resource-shaped list/get.
  async searchAvailableNumbers(options: SearchAvailableOptions) {
    const query: Record<string, string | number> = {};
    if (options.country) query.country = options.country;
    if (options.area_code) query.area_code = options.area_code;
    if (options.contains) query.contains = options.contains;
    if (options.sms_enabled !== undefined) query.sms_enabled = String(options.sms_enabled);
    if (options.voice_enabled !== undefined) query.voice_enabled = String(options.voice_enabled);
    if (options.limit !== undefined) query.limit = options.limit;
    const res = await this.cloud.transport.get<{ items?: AvailableNumber[] }>("/numbers/available", { query });
    return res.items ?? [];
  }
  async listTwilioNumbers() {
    const res = await this.cloud.transport.get<{ items?: TwilioNumberRef[] }>("/numbers/twilio");
    return res.items ?? [];
  }
  async listVoices() {
    // Routed through the server-side `/v1/voices` proxy so the real ElevenLabs
    // credential never leaves the server. Non-CRUD route → transport escape hatch.
    const res = await this.cloud.transport.get<{ items?: Voice[] }>("/voices");
    return res.items ?? [];
  }

  // Messages
  async createMessage(input: CreateMessageInput) {
    return this.cloud.create<Message>("messages", input);
  }
  async updateMessageStatus(id: string, status: MessageStatus, errorMessage?: string) {
    await this.cloud.update<Message>("messages", id, {
      status,
      ...(errorMessage ? { error_message: errorMessage } : {}),
    });
  }
  async updateMessageMedia(id: string, extra: { object_key: string; sha256: string }) {
    // The /v1 PATCH allowlist for messages carries object_key/sha256, so a
    // provider-media copy made after the row was created can be attached here.
    await this.cloud.update<Message>("messages", id, extra);
  }
  async listMessages(filters?: MessageFilters) {
    return this.listAll<Message>("messages", { ...filters });
  }
  async searchMessages(query: string, limit?: number) {
    // Full-table body search served DB-side (`search` param): case-insensitive
    // substring match on `body`, ordered newest-first. NOTE: LocalStore uses
    // SQLite FTS5 (tokenized MATCH, relevance-ranked), so cloud results are a
    // superset ordered by recency rather than relevance — same rows for
    // whole-token queries, but substring matches (partial tokens) also hit
    // here. Default limit mirrors local (50).
    return this.listAll<Message>("messages", { search: query, limit: limit ?? 50 });
  }
  async getConversation(phoneNumber: string, limit?: number) {
    // Conversation filter served DB-side (`number` param → from_number OR
    // to_number) — parity with LocalStore.getConversation. Default limit 50.
    return this.listAll<Message>("messages", { number: phoneNumber, limit: limit ?? 50 });
  }

  // Calls
  async createCall(input: CreateCallInput) {
    return this.cloud.create<Call>("calls", input);
  }
  async updateCallStatus(
    id: string,
    status: CallStatus,
    extra?: { duration?: number; recording_url?: string; transcription?: string; object_key?: string; sha256?: string },
  ) {
    await this.cloud.update<Call>("calls", id, { status, ...(extra ?? {}) });
  }
  async getCallByTwilioSid(twilioSid: string) {
    // Exact `twilio_sid` filter served DB-side (like getPhoneNumberByNumber's
    // `number` filter) — never a client-side scan of a capped page, which
    // would miss calls beyond the first page at fleet scale. Both list
    // transports order newest-first, mirroring LocalStore's LIMIT 1.
    const items = await this.listAll<Call>("calls", { twilio_sid: twilioSid });
    return items[0] ?? null;
  }
  async listCalls(filters?: CallFilters) {
    return this.listAll<Call>("calls", { ...filters });
  }

  // Voicemails
  async createVoicemail(input: CreateVoicemailInput) {
    return this.cloud.create<Voicemail>("voicemails", input);
  }
  async updateVoicemailMedia(id: string, extra: { object_key: string; sha256: string }) {
    // The /v1 PATCH allowlist for voicemails carries object_key/sha256.
    await this.cloud.update<Voicemail>("voicemails", id, extra);
  }
  async listVoicemails(filters?: VoicemailFilters) {
    const q: Record<string, string | number> = {};
    if (filters?.agent_id) q.agent_id = filters.agent_id;
    if (filters?.project_id) q.project_id = filters.project_id;
    // listened is a tri-state (undefined = no filter); send it DB-side so the
    // --unheard filter isn't silently dropped on the HTTP API transport.
    if (filters?.listened !== undefined) q.listened = String(filters.listened);
    return (await this.cloud.list<Voicemail>("voicemails", { query: q })).items;
  }
  async markVoicemailListened(id: string) {
    await this.cloud.update<Voicemail>("voicemails", id, { listened: true });
    return true;
  }

  // Contacts
  async createContact(input: CreateContactInput) {
    return this.cloud.create<Contact>("contacts", input);
  }
  async listContacts(filters?: { agent_id?: string; project_id?: string }) {
    return this.listAll<Contact>("contacts", filters);
  }
  async searchContacts(query: string) {
    return (await this.cloud.list<Contact>("contacts", { query: { search: query } })).items;
  }
  async deleteContact(id: string) {
    await this.cloud.delete("contacts", id);
    return true;
  }

  // Schedules
  async createSchedule(input: CreateScheduleInput) {
    return this.cloud.create<Schedule>("schedules", input);
  }
  async listSchedules(filters?: ScheduleFilters) {
    // enabled is a tri-state (undefined = no filter); send all three DB-side so
    // the CLI/MCP schedule-list filters aren't silently dropped on the HTTP API
    // transport.
    return this.listAll<Schedule>("schedules", {
      agent_id: filters?.agent_id,
      project_id: filters?.project_id,
      enabled: filters?.enabled === undefined ? undefined : String(filters.enabled),
    });
  }
  async enableSchedule(id: string) {
    await this.cloud.update<Schedule>("schedules", id, { enabled: true });
    return true;
  }
  async disableSchedule(id: string) {
    await this.cloud.update<Schedule>("schedules", id, { enabled: false });
    return true;
  }
  async deleteSchedule(id: string) {
    await this.cloud.delete("schedules", id);
    return true;
  }
  async getDueSchedules() {
    // The cloud API has no "due" filter; select enabled schedules whose
    // next_run has elapsed, client-side.
    const now = Date.now();
    const all = await this.listAll<Schedule>("schedules");
    return all.filter((s) => s.enabled && (!s.next_run || Date.parse(s.next_run) <= now));
  }
  async markScheduleRun(id: string) {
    await this.cloud.update<Schedule>("schedules", id, { last_run: new Date().toISOString() });
  }

  // Webhooks
  async createWebhook(input: CreateWebhookInput) {
    return this.cloud.create<Webhook>("webhooks", input);
  }
  async listWebhooks() {
    return this.listAll<Webhook>("webhooks");
  }
  async listWebhookDispatchTargets() {
    const res = await this.cloud.transport.get<{ items?: WebhookDispatchTarget[] }>("/internal/webhook-dispatch-targets");
    return res.items ?? [];
  }
  async deleteWebhook(id: string) {
    await this.cloud.delete("webhooks", id);
    return true;
  }

  // Feedback
  async saveFeedback(input: FeedbackInput) {
    await this.cloud.create("feedback", input);
  }
}

// ── Resolver ─────────────────────────────────────────────────────────────────

let cached: TelephonyStore | null = null;

const API_URL_KEYS = ["HASNA_TELEPHONY_API_URL", "TELEPHONY_API_URL"] as const;
const API_KEY_KEYS = ["HASNA_TELEPHONY_API_KEY", "TELEPHONY_API_KEY"] as const;

/** Canonical fleet API env var naming the telephony HTTP API base URL. */
export const TELEPHONY_API_URL_ENV = "HASNA_TELEPHONY_API_URL";
/** Canonical fleet API env var naming the telephony API bearer key. */
export const TELEPHONY_API_KEY_ENV = "HASNA_TELEPHONY_API_KEY";
/** Canonical explicit local-mode opt-in env var. */
export const TELEPHONY_LOCAL_MODE_ENV = "HASNA_TELEPHONY_LOCAL";
const LOCAL_MODE_OPT_IN_KEYS = [TELEPHONY_LOCAL_MODE_ENV, "TELEPHONY_LOCAL"] as const;

function firstEnvValue(env: NodeJS.ProcessEnv, keys: readonly string[]): { key: string; value: string } | null {
  for (const key of keys) {
    if (Object.hasOwn(env, key)) {
      const value = env[key]?.trim();
      if (value) return { key, value };
    }
  }
  return null;
}

/**
 * True when the explicit local-mode opt-in is set to a truthy value
 * (`HASNA_TELEPHONY_LOCAL=1` or its `TELEPHONY_LOCAL` alias). `1`/`true`/`yes`
 * opt in; `0`/`false`/`no`/`off` and blank values all count as absent, so a
 * wrapper cannot flip local mode on by accident with a stale variable.
 */
export function isLocalModeOptIn(env: NodeJS.ProcessEnv = process.env): boolean {
  return LOCAL_MODE_OPT_IN_KEYS.some((key) => {
    const raw = env[key];
    if (raw === undefined) return false;
    const value = raw.trim().toLowerCase();
    return value !== "" && value !== "0" && value !== "false" && value !== "no" && value !== "off";
  });
}

/**
 * The fail-closed error raised when a store-backed surface runs without the
 * fleet API env and without the explicit local opt-in. Actionable: names the
 * required variables and the opt-in, and never offers a silent local fallback.
 */
export function telephonyStoreMisconfiguredError(): Error {
  return new Error(
    `No telephony API environment is configured and local mode is not enabled. ` +
      `The telephony client fails closed instead of silently serving the local SQLite store: ` +
      `set ${TELEPHONY_API_URL_ENV} and ${TELEPHONY_API_KEY_ENV} (unprefixed ` +
      `TELEPHONY_API_URL / TELEPHONY_API_KEY aliases are accepted) to route CLI, MCP and SDK ` +
      `data operations through the telephony HTTP API, or set ${TELEPHONY_LOCAL_MODE_ENV}=1 ` +
      `(alias TELEPHONY_LOCAL=1) to explicitly opt in to the on-box local store.`,
  );
}

/**
 * Resolve (and cache) the telephony Store from the environment. Transport is
 * selected by the API env pair alone: both `HASNA_TELEPHONY_API_URL` and
 * `HASNA_TELEPHONY_API_KEY` set selects the {@link ApiStore} (HTTP). With
 * neither set the resolver FAILS CLOSED (owner directive 2026-09-04) — it
 * throws an actionable error naming the required env instead of silently
 * serving on-box SQLite — unless the explicit local opt-in
 * (`HASNA_TELEPHONY_LOCAL=1` / `TELEPHONY_LOCAL=1`) selects the
 * {@link LocalStore}. Exactly one side of the pair throws naming the missing
 * variable — no silent drift. Any retired storage-mode variable throws first
 * via `assertNoLegacyStorageMode`.
 */
export function getStore(env: NodeJS.ProcessEnv = process.env): TelephonyStore {
  // Cache only the default (process.env) resolution — the hot path for CLI/MCP/
  // lib actions. An explicit env override (e.g. SDK constructor) always resolves
  // fresh so callers can target a different transport in the same process.
  const isDefaultEnv = env === process.env;
  if (isDefaultEnv && cached) return cached;
  assertNoLegacyStorageMode(env);
  const urlHit = firstEnvValue(env, API_URL_KEYS);
  const keyHit = firstEnvValue(env, API_KEY_KEYS);
  let store: TelephonyStore;
  if (!urlHit && !keyHit) {
    if (isLocalModeOptIn(env)) {
      // Explicit opt-in only: the caller asked for the on-box SQLite store.
      // This is the ONLY path that serves local data — never a missing-env
      // default, never a fallback selected behind the caller's back.
      store = new LocalStore();
    } else {
      throw telephonyStoreMisconfiguredError();
    }
  } else if (!urlHit || !keyHit) {
    const present = urlHit ? TELEPHONY_API_URL_ENV : TELEPHONY_API_KEY_ENV;
    throw new Error(
      `API transport requires BOTH ${TELEPHONY_API_URL_ENV} and ${TELEPHONY_API_KEY_ENV}; only ` +
        `${present} is set. Set the missing variable to reach the telephony HTTP API, or unset ` +
        `the partial pair and set ${TELEPHONY_LOCAL_MODE_ENV}=1 to explicitly use the on-box ` +
        `local store.`,
    );
  } else {
    // Full pair: the client reads AND writes through the server's /v1 API. The
    // contracts seam resolves its transport from this same env pair. The
    // published seam type still admits a `sqlite` member (older contracts); it
    // must NEVER select the on-box store from the fleet path — both API
    // variables are set, so a non-http resolution is a seam fault and we fail
    // closed rather than silently serve the wrong dataset.
    const resolved = resolveStorageClient(TELEPHONY_APP, env);
    if (resolved.transport !== "http") {
      throw new Error(
        `Storage resolution did not select the HTTP transport even though ` +
          `${TELEPHONY_API_URL_ENV} and ${TELEPHONY_API_KEY_ENV} are set (resolved ` +
          `${resolved.transport}). Telephony never falls back to the on-box store from ` +
          `the fleet path — upgrade @hasna/contracts or check for a conflicting ` +
          `storage-mode variable.`,
      );
    }
    store = new ApiStore(resolved.client);
  }
  if (isDefaultEnv) cached = store;
  return store;
}

/** Reset the cached Store (tests / env changes). */
export function resetStore(): void {
  cached = null;
}

/** True when the resolved Store is the cloud HTTP transport. */
export function isCloudStore(env: NodeJS.ProcessEnv = process.env): boolean {
  return getStore(env).transport === "cloud-http";
}
