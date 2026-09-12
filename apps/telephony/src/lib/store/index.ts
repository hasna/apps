// ── The telephony Store abstraction ──────────────────────────────────────────
//
// ONE interface, TWO transports. Every CLI command, MCP tool, and SDK caller
// that reads or writes telephony DATA goes through `TelephonyStore`. There are
// exactly two implementations:
//
//   • LocalStore — on-box SQLite. A facade over ./local-store.ts, which is
//     loaded through the ONE gated runtime import in ./local-store-loader.ts
//     on the first operation, so the SQLite engine is never linked into the
//     CLI/MCP bundles and can never be reached without the explicit opt-in.
//     The implementation delegates to the query/mutation helpers in ../../db/*
//     and opens the database handle lazily, so the `sqlite` backend is
//     first-class and fully functional; the `postgres` backend never touches
//     sqlite.
//   • ApiStore   — the server's HTTP API at `<API_URL>/v1` with a bearer key.
//     Delegates to the vendored client-flip HTTP storage client.
//
// `getStore()` resolves which transport to use through the ONE shared
// @hasna/contracts client resolver (../client-transport.ts): any credential
// resolved from any tier (Keychain, ~/.hasna/telephony/config/credentials, or
// HASNA_TELEPHONY_API_KEY) selects the HTTP API; the LocalStore is reachable
// ONLY through the explicit opt-in `HASNA_TELEPHONY_LOCAL=1` (alias
// `TELEPHONY_LOCAL=1`) and only when nothing at all resolves. With no
// credential and no opt-in the resolver FAILS CLOSED (owner directive
// 2026-09-04): it throws an actionable error instead of silently serving
// on-box SQLite. Callers NEVER branch on the backend themselves and NEVER
// touch sqlite or fetch directly — that was the split-brain bug this module
// eliminates.
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
  type HasnaStorageClient,
} from "@hasna/contracts";
import {
  resolveTelephonyClientTransport,
  TELEPHONY_APP,
  TELEPHONY_API_KEY_ENV,
  TELEPHONY_API_URL_ENV,
  TELEPHONY_LOCAL_MODE_ENV,
  isLocalModeOptIn,
  telephonyStoreMisconfiguredError,
} from "../client-transport.js";

// The on-box SQLite store is NOT imported here. It lives in ./local-store.ts
// (the only module in the client graph that reaches `bun:sqlite`) and is
// opened through the single gated runtime import in ./local-store-loader.ts,
// so `dist/cli/index.js` and `dist/mcp/index.js` never carry a database engine.
import { loadLocalStore } from "./local-store-loader.js";
import type { Voice } from "../tts.js";

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

// @hasna/telephony — the app slug the fleet credential chain is keyed on.
export { TELEPHONY_APP } from "../client-transport.js";

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

/**
 * The on-box SQLite store, as the client graph sees it: a facade that owns the
 * ONE gated runtime import of the real implementation
 * (./local-store.ts, loaded through ./local-store-loader.ts) and forwards
 * every operation to it.
 *
 * WHY A FACADE AND NOT THE CLASS ITSELF. The real LocalStore reaches
 * `bun:sqlite` through ../../db/*, and a static import of it puts the whole
 * SQLite engine inside `dist/cli/index.js` and `dist/mcp/index.js` — a fleet
 * bin that carries an embedded database is one bad branch away from silently
 * serving on-box data to somebody who believes they are on the fleet. The
 * implementation is therefore loaded at runtime, from its own emitted module,
 * and only after the loader re-checks that the explicit opt-in (and nothing
 * resolving a credential) really selected local mode.
 *
 * The door opens on the FIRST OPERATION, not at construction: `getStore()`
 * stays synchronous, and a process that resolves the local transport but never
 * touches data never opens a database file.
 */
export class LocalStore implements TelephonyStore {
  readonly transport = "local" as const;

  /** The environment the gate is decided from — the one `getStore()` resolved. */
  private readonly env: NodeJS.ProcessEnv;
  /** The gated import, in flight or settled; null until the first operation. */
  private loading: Promise<TelephonyStore> | null = null;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.env = env;
  }

  /**
   * Open the gated door, once. Rejects (and imports nothing) unless the
   * explicit opt-in selected local mode for {@link env}.
   */
  private impl(): Promise<TelephonyStore> {
    this.loading ??= loadLocalStore(this.env);
    return this.loading;
  }

  // Agents
  async registerAgent(input: RegisterAgentInput) {
    return (await this.impl()).registerAgent(input);
  }
  async listAgents(projectId?: string) {
    return (await this.impl()).listAgents(projectId);
  }
  async getAgent(id: string) {
    return (await this.impl()).getAgent(id);
  }
  async getAgentByName(name: string) {
    return (await this.impl()).getAgentByName(name);
  }
  async heartbeat(agentId: string) {
    return (await this.impl()).heartbeat(agentId);
  }
  async releaseAgent(agentId: string) {
    return (await this.impl()).releaseAgent(agentId);
  }
  async setFocus(agentName: string, projectId: string) {
    return (await this.impl()).setFocus(agentName, projectId);
  }

  // Projects
  async createProject(input: CreateProjectInput) {
    return (await this.impl()).createProject(input);
  }
  async listProjects() {
    return (await this.impl()).listProjects();
  }
  async getProject(id: string) {
    return (await this.impl()).getProject(id);
  }
  async deleteProject(id: string) {
    return (await this.impl()).deleteProject(id);
  }

  // Phone numbers
  async listPhoneNumbers(filters?: { agent_id?: string; project_id?: string; status?: string }) {
    return (await this.impl()).listPhoneNumbers(filters);
  }
  async getPhoneNumberByNumber(number: string) {
    return (await this.impl()).getPhoneNumberByNumber(number);
  }
  async createPhoneNumber(input: CreatePhoneNumberInput) {
    return (await this.impl()).createPhoneNumber(input);
  }
  async assignPhoneNumber(id: string, agentId?: string, projectId?: string) {
    return (await this.impl()).assignPhoneNumber(id, agentId, projectId);
  }
  async releasePhoneNumber(id: string) {
    return (await this.impl()).releasePhoneNumber(id);
  }

  // Provider passthrough — in local mode this machine IS the server, so the
  // implementation calls Twilio/ElevenLabs with its own credentials.
  async searchAvailableNumbers(options: SearchAvailableOptions) {
    return (await this.impl()).searchAvailableNumbers(options);
  }
  async listTwilioNumbers() {
    return (await this.impl()).listTwilioNumbers();
  }
  async listVoices() {
    return (await this.impl()).listVoices();
  }

  // Messages
  async createMessage(input: CreateMessageInput) {
    return (await this.impl()).createMessage(input);
  }
  async updateMessageStatus(id: string, status: MessageStatus, errorMessage?: string) {
    return (await this.impl()).updateMessageStatus(id, status, errorMessage);
  }
  async updateMessageMedia(id: string, extra: { object_key: string; sha256: string }) {
    return (await this.impl()).updateMessageMedia(id, extra);
  }
  async listMessages(filters?: MessageFilters) {
    return (await this.impl()).listMessages(filters);
  }
  async searchMessages(query: string, limit?: number) {
    return (await this.impl()).searchMessages(query, limit);
  }
  async getConversation(phoneNumber: string, limit?: number) {
    return (await this.impl()).getConversation(phoneNumber, limit);
  }

  // Calls
  async createCall(input: CreateCallInput) {
    return (await this.impl()).createCall(input);
  }
  async updateCallStatus(
    id: string,
    status: CallStatus,
    extra?: { duration?: number; recording_url?: string; transcription?: string; object_key?: string; sha256?: string },
  ) {
    return (await this.impl()).updateCallStatus(id, status, extra);
  }
  async getCallByTwilioSid(twilioSid: string) {
    return (await this.impl()).getCallByTwilioSid(twilioSid);
  }
  async listCalls(filters?: CallFilters) {
    return (await this.impl()).listCalls(filters);
  }

  // Voicemails
  async createVoicemail(input: CreateVoicemailInput) {
    return (await this.impl()).createVoicemail(input);
  }
  async updateVoicemailMedia(id: string, extra: { object_key: string; sha256: string }) {
    return (await this.impl()).updateVoicemailMedia(id, extra);
  }
  async listVoicemails(filters?: VoicemailFilters) {
    return (await this.impl()).listVoicemails(filters);
  }
  async markVoicemailListened(id: string) {
    return (await this.impl()).markVoicemailListened(id);
  }

  // Contacts
  async createContact(input: CreateContactInput) {
    return (await this.impl()).createContact(input);
  }
  async listContacts(filters?: { agent_id?: string; project_id?: string }) {
    return (await this.impl()).listContacts(filters);
  }
  async searchContacts(query: string) {
    return (await this.impl()).searchContacts(query);
  }
  async deleteContact(id: string) {
    return (await this.impl()).deleteContact(id);
  }

  // Schedules
  async createSchedule(input: CreateScheduleInput) {
    return (await this.impl()).createSchedule(input);
  }
  async listSchedules(filters?: ScheduleFilters) {
    return (await this.impl()).listSchedules(filters);
  }
  async enableSchedule(id: string) {
    return (await this.impl()).enableSchedule(id);
  }
  async disableSchedule(id: string) {
    return (await this.impl()).disableSchedule(id);
  }
  async deleteSchedule(id: string) {
    return (await this.impl()).deleteSchedule(id);
  }
  async getDueSchedules() {
    return (await this.impl()).getDueSchedules();
  }
  async markScheduleRun(id: string) {
    return (await this.impl()).markScheduleRun(id);
  }

  // Webhooks
  async createWebhook(input: CreateWebhookInput) {
    return (await this.impl()).createWebhook(input);
  }
  async listWebhooks() {
    return (await this.impl()).listWebhooks();
  }
  async listWebhookDispatchTargets() {
    return (await this.impl()).listWebhookDispatchTargets();
  }
  async deleteWebhook(id: string) {
    return (await this.impl()).deleteWebhook(id);
  }

  // Feedback
  async saveFeedback(input: FeedbackInput) {
    return (await this.impl()).saveFeedback(input);
  }
}

// ── ApiStore (the server's HTTP /v1 API) ─────────────────────────────────────
//
// Every TelephonyStore operation is served over the HTTP API transport —
// nothing is "cloud unsupported": the server-side /v1 API implements the full
// store contract (CRUD + provider passthroughs), so no op falls back to the
// on-box store or raises a cloud-only refusal.

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
//
// The transport decision is delegated to the shared @hasna/contracts client
// resolver (src/lib/client-transport.ts): a credential resolving from any tier
// — an explicit pointer, the macOS Keychain, ~/.hasna/telephony/config/credentials,
// or HASNA_TELEPHONY_API_KEY — selects the hosted HTTP API at
// HASNA_TELEPHONY_API_URL (else the fleet gateway https://api.hasna.com/telephony).
// The on-box LocalStore is reachable ONLY through the explicit opt-in
// HASNA_TELEPHONY_LOCAL=1 (alias TELEPHONY_LOCAL=1) and only when nothing at
// all resolves; with no credential and no opt-in the resolver FAILS CLOSED
// (owner directive 2026-09-04): an actionable error naming the required
// variables, never a silent SQLite fallback and never a local-fallback event.
// The app's own env chain and its *_MODE / *_STORAGE_MODE switches are gone.

/**
 * The fail-closed error raised when a store-backed surface runs without any
 * resolvable credential and without the explicit local opt-in.
 */
export { telephonyStoreMisconfiguredError } from "../client-transport.js";

/** Canonical fleet API env var naming the telephony HTTP API base URL. */
export { TELEPHONY_API_URL_ENV } from "../client-transport.js";
/** Canonical fleet API env var naming the telephony API bearer key. */
export { TELEPHONY_API_KEY_ENV } from "../client-transport.js";
/** Canonical explicit local-mode opt-in env var. */
export { TELEPHONY_LOCAL_MODE_ENV } from "../client-transport.js";

export { isLocalModeOptIn } from "../client-transport.js";

/**
 * Resolve the telephony Store from the environment, FRESH on every call.
 *
 * The transport is decided by the shared @hasna/contracts credential chain:
 * any resolved credential selects the {@link ApiStore} (HTTP); the explicit
 * local opt-in (`HASNA_TELEPHONY_LOCAL=1` / `TELEPHONY_LOCAL=1`) with nothing
 * resolving anywhere selects the {@link LocalStore}; everything else throws an
 * actionable fail-closed error. The hosted transport re-resolves the
 * credential on every request, so a held client picks up a rotation without
 * being rebuilt.
 */
export function getStore(env: NodeJS.ProcessEnv = process.env): TelephonyStore {
  const resolved = resolveTelephonyClientTransport(env);
  // The facade carries the SAME env the transport was resolved from, so the
  // gate its first operation re-checks is the decision made here — never the
  // ambient process environment of some later call.
  if (resolved.mode === "local") return new LocalStore(env);
  return new ApiStore(resolved.client as HasnaStorageClient);
}

/**
 * Reset the cached Store (tests / env changes).
 *
 * Resolution is always fresh — there is no cache to clear — so this is a
 * compatibility no-op kept for callers that used it to forget a cached
 * transport between tests.
 */
export function resetStore(): void {
  // No-op: getStore() resolves the transport on every call, so there is
  // nothing to invalidate.
}

/** True when the resolved Store is the cloud HTTP transport. */
export function isCloudStore(env: NodeJS.ProcessEnv = process.env): boolean {
  return getStore(env).transport === "cloud-http";
}
