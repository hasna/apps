export type HostedReportChannel = "email" | "sms" | "logs";
export type HostedReportChannelService = "mailery" | "telephony" | "logs";

export interface HostedReportChannelRef {
  id: string;
  channel: HostedReportChannel;
  service: HostedReportChannelService;
  secretRef: string;
  targetRef?: string;
  workspaceId?: string;
  enabled?: boolean;
}

export interface HostedReportChannelRefCatalog {
  version: "open-uptime.report-channel-refs.v1";
  channels: HostedReportChannelRef[];
}

export interface HostedReportChannelRefSummary {
  configured: boolean;
  valid: boolean;
  version: string | null;
  workspaceId: string | null;
  total: number;
  enabled: number;
  enabledForWorkspace: number;
  enabledWithoutWorkspace: number;
  enabledForOtherWorkspaces: number;
  byChannel: Record<HostedReportChannel, number>;
  enabledByChannel: Record<HostedReportChannel, number>;
  errors: string[];
}

const EMPTY_COUNTS: Record<HostedReportChannel, number> = { email: 0, sms: 0, logs: 0 };
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const PHONE_LIKE_REF_PATTERN = /^[\d_.:-]+$/;
const SECRET_LIKE_REF_PATTERN = /(^Bearer\s+|=|postgres(?:ql)?:\/\/|^(esk|sk)_[A-Za-z0-9._~+/=-]{12,})/i;
const AWS_SECRETS_MANAGER_REF_PATTERN = /^arn:aws[a-z-]*:secretsmanager:[a-z0-9-]+:\d{12}:secret:[A-Za-z0-9/_+=.@:-]+$/;
const AWS_SSM_PARAMETER_REF_PATTERN = /^arn:aws[a-z-]*:ssm:[a-z0-9-]+:\d{12}:parameter\/[A-Za-z0-9/_+=.@:-]+$/;
const CATALOG_KEYS = new Set(["version", "channels"]);
const ALLOWED_KEYS = new Set(["id", "channel", "service", "secretRef", "targetRef", "workspaceId", "enabled"]);
const FORBIDDEN_KEYS = /apiUrl|url|token|key|password|credential|secretValue|recipient|to|from|phone|emailAddress/i;

export function summarizeHostedReportChannelRefs(input: string | undefined | null, options: { workspaceId?: string | null } = {}): HostedReportChannelRefSummary {
  const raw = input?.trim();
  if (!raw) return emptySummary(false, "missing HASNA_UPTIME_REPORT_CHANNEL_REFS_JSON");
  try {
    return summarizeHostedReportChannelRefCatalog(parseHostedReportChannelRefs(raw), options);
  } catch (error) {
    return {
      ...emptySummary(true),
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

export function parseHostedReportChannelRefs(input: string): HostedReportChannelRefCatalog {
  const parsed = JSON.parse(input) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("report channel refs catalog must be a JSON object");
  }
  const catalog = parsed as Record<string, unknown>;
  validateObjectKeys(catalog, CATALOG_KEYS, "report channel refs catalog");
  if (catalog.version !== "open-uptime.report-channel-refs.v1") {
    throw new Error("report channel refs catalog version must be open-uptime.report-channel-refs.v1");
  }
  if (!Array.isArray(catalog.channels)) {
    throw new Error("report channel refs catalog channels must be an array");
  }
  const channels = catalog.channels.map((value, index) => normalizeChannelRef(value, index));
  const ids = new Set<string>();
  for (const channel of channels) {
    if (ids.has(channel.id)) throw new Error("duplicate report channel ref id");
    ids.add(channel.id);
  }
  return { version: catalog.version, channels };
}

export function summarizeHostedReportChannelRefCatalog(catalog: HostedReportChannelRefCatalog, options: { workspaceId?: string | null } = {}): HostedReportChannelRefSummary {
  const workspaceId = options.workspaceId?.trim() || null;
  const byChannel = { ...EMPTY_COUNTS };
  const enabledByChannel = { ...EMPTY_COUNTS };
  let enabledForWorkspace = 0;
  let enabledWithoutWorkspace = 0;
  let enabledForOtherWorkspaces = 0;
  for (const channel of catalog.channels) {
    byChannel[channel.channel] += 1;
    if (channel.enabled !== false) {
      enabledByChannel[channel.channel] += 1;
      if (!channel.workspaceId) enabledWithoutWorkspace += 1;
      else if (workspaceId && channel.workspaceId === workspaceId) enabledForWorkspace += 1;
      else enabledForOtherWorkspaces += 1;
    }
  }
  return {
    configured: true,
    valid: true,
    version: catalog.version,
    workspaceId,
    total: catalog.channels.length,
    enabled: catalog.channels.filter((channel) => channel.enabled !== false).length,
    enabledForWorkspace,
    enabledWithoutWorkspace,
    enabledForOtherWorkspaces,
    byChannel,
    enabledByChannel,
    errors: [],
  };
}

function normalizeChannelRef(value: unknown, index: number): HostedReportChannelRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`report channel ref at index ${index} must be an object`);
  }
  const record = value as Record<string, unknown>;
  validateObjectKeys(record, ALLOWED_KEYS, "report channel ref");

  const id = normalizeOpaqueRefId(record.id, `report channel ref ${index} id`);
  const channel = normalizeChannel(record.channel);
  const service = normalizeService(record.service);
  const expectedService = expectedServiceForChannel(channel);
  if (service !== expectedService) {
    throw new Error(`report channel ref service must be ${expectedService} for ${channel}`);
  }
  const secretRef = normalizeSecretRef(record.secretRef);
  const targetRef = record.targetRef === undefined ? undefined : normalizeOpaqueRefId(record.targetRef, `report channel ref ${id} targetRef`);
  const workspaceId = record.workspaceId === undefined ? undefined : normalizeRefId(record.workspaceId, `report channel ref ${id} workspaceId`);
  const enabled = record.enabled === undefined ? undefined : normalizeBoolean(record.enabled);
  return { id, channel, service, secretRef, targetRef, workspaceId, enabled };
}

function validateObjectKeys(record: Record<string, unknown>, allowedKeys: Set<string>, label: string): void {
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) {
      if (FORBIDDEN_KEYS.test(key)) {
        throw new Error("report channel refs must not contain raw URLs, recipients, API keys, tokens, or secret values");
      }
      throw new Error(`unsupported ${label} field: ${key}`);
    }
  }
}

function normalizeRefId(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  const normalized = value.trim();
  if (!ID_PATTERN.test(normalized)) throw new Error(`${label} must use a safe ref id`);
  return normalized;
}

function normalizeOpaqueRefId(value: unknown, label: string): string {
  const normalized = normalizeRefId(value, label);
  if (PHONE_LIKE_REF_PATTERN.test(normalized) && normalized.replace(/\D/g, "").length >= 7) {
    throw new Error(`${label} must not look like a raw phone number`);
  }
  if (SECRET_LIKE_REF_PATTERN.test(normalized)) {
    throw new Error(`${label} must not look like secret material`);
  }
  return normalized;
}

function normalizeChannel(value: unknown): HostedReportChannel {
  if (value === "email" || value === "sms" || value === "logs") return value;
  throw new Error("report channel ref channel must be email, sms, or logs");
}

function normalizeService(value: unknown): HostedReportChannelService {
  if (value === "mailery" || value === "telephony" || value === "logs") return value;
  throw new Error("report channel ref service must be mailery, telephony, or logs");
}

function expectedServiceForChannel(channel: HostedReportChannel): HostedReportChannelService {
  if (channel === "email") return "mailery";
  if (channel === "sms") return "telephony";
  return "logs";
}

function normalizeSecretRef(value: unknown): string {
  if (typeof value !== "string") throw new Error("report channel ref secretRef must be a string");
  const normalized = value.trim();
  if (!AWS_SECRETS_MANAGER_REF_PATTERN.test(normalized) && !AWS_SSM_PARAMETER_REF_PATTERN.test(normalized)) {
    throw new Error("report channel ref secretRef must be an AWS Secrets Manager or SSM Parameter ARN");
  }
  return normalized;
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("report channel ref enabled must be boolean");
  return value;
}

function emptySummary(configured: boolean, error?: string): HostedReportChannelRefSummary {
  return {
    configured,
    valid: false,
    version: null,
    workspaceId: null,
    total: 0,
    enabled: 0,
    enabledForWorkspace: 0,
    enabledWithoutWorkspace: 0,
    enabledForOtherWorkspaces: 0,
    byChannel: { ...EMPTY_COUNTS },
    enabledByChannel: { ...EMPTY_COUNTS },
    errors: error ? [error] : [],
  };
}
