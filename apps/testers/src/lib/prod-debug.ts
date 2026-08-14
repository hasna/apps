import { isCredentialReference, resolveCredential } from "./secrets-resolver.js";

export interface ProdDebugInput {
  target: string;
  app?: string;
  profile?: string;
  actor?: string;
  reason?: string;
  supportUrl?: string;
  supportGrantId?: string;
  ttlMinutes?: number;
  includeBrowser?: boolean;
  includeLogs?: boolean;
  allowWrites?: boolean;
}

export interface ProdDebugAppProfile {
  name?: string;
  origins?: string[];
  supportUrl?: string;
  supportUrlRef?: string;
  supportUrlTemplate?: string;
  supportGrantId?: string;
  supportGrantRef?: string;
  piiOrigin?: string;
  logCommand?: string;
}

export interface ProdDebugConfig {
  defaultProfile?: string;
  apps?: Record<string, ProdDebugAppProfile>;
}

export interface ProdDebugIdentifiers {
  url: string | null;
  origin: string | null;
  orgSlug: string | null;
  projectRef: string | null;
  sessionId: string | null;
  agentId: string | null;
  requestId: string | null;
  rawId: string | null;
}

export interface ProdDebugCheck {
  id: string;
  status: "ready" | "blocked";
  description: string;
  command?: string;
  reason?: string;
}

export interface ProdDebugPlan {
  target: ProdDebugIdentifiers;
  app: string;
  actor: string;
  reason: string;
  ttlMinutes: number;
  setup: {
    profile: string | null;
    matchedOrigin: string | null;
    configured: {
      supportUrl: boolean;
      supportGrant: boolean;
      piiOrigin: boolean;
      logCommand: boolean;
    };
    missing: string[];
  };
  supportAccess: {
    required: boolean;
    grantId: string | null;
    browserReady: boolean;
    note: string;
  };
  safety: string[];
  checks: ProdDebugCheck[];
  blocked: string[];
}

type ResolvedProfile = {
  key: string | null;
  profile: ProdDebugAppProfile | null;
  matchedOrigin: string | null;
};

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
const SENSITIVE_PARAM_RE = /token|secret|key|password|code|state|cookie|session|grant|credential|auth|jwt|access/i;
const SENSITIVE_TEXT_RE =
  /\b(Bearer\s+[A-Za-z0-9._-]{12,}|sk-[A-Za-z0-9]{12,}|pk_[A-Za-z0-9]{12,}|eyJ[A-Za-z0-9._-]{12,})\b/g;
const URL_TEXT_RE = /https?:\/\/[^\s"'<>]+/g;
const SENSITIVE_FIELD_NAME = String.raw`(?:bearer[_-]?token|bearer|api[_-]?key|client[_-]?secret|authorization[_-]?code|oauth[_-]?code|access[_-]?token|refresh[_-]?token|id[_-]?token|auth[_-]?token|token|secret|password|passwd|pwd|cookie|session|grant|credential|jwt|code|state|auth|access)`;
const SENSITIVE_PATH_SEGMENT_RE = new RegExp(
  String.raw`(?:^|[-_.])(?:api[_-]?key|client[_-]?secret|authorization[_-]?code|oauth[_-]?code|access[_-]?token|refresh[_-]?token|id[_-]?token|auth[_-]?token|token|secret|password|passwd|pwd|cookie|grant|credential|jwt)(?:[-_.]|$)`,
  "i",
);
const SENSITIVE_PATH_LABEL_RE = /^(?:api[_-]?key|client[_-]?secret|authorization[_-]?code|oauth[_-]?code|access[_-]?token|refresh[_-]?token|id[_-]?token|auth[_-]?token|token|secret|password|passwd|pwd|cookie|grant|credential|jwt|code|state|auth|access)$/i;
const SESSION_COLLECTION_PATH_LABEL_RE = /^sessions$/i;
const COMPOUND_GRANT_PATH_LABEL_RE = /[-_.]grant$/i;
const SECRET_LIKE_VALUE_RE = /^(?:Bearer\s+[A-Za-z0-9._-]{12,}|sk-[A-Za-z0-9._-]{12,}|pk_[A-Za-z0-9._-]{12,}|eyJ[A-Za-z0-9._-]{12,})[.!?),;:]*$/i;
const SECRET_VALUE_PATTERN = String.raw`(?:Bearer\s+[A-Za-z0-9._-]{12,}|"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}&]+)`;
const SENSITIVE_ASSIGNMENT_RE = new RegExp(
  String.raw`(["']?\b${SENSITIVE_FIELD_NAME}\b["']?\s*[:=]\s*)(${SECRET_VALUE_PATTERN})`,
  "gi",
);
const SENSITIVE_OPTION_RE = new RegExp(
  String.raw`(^|\s)(--${SENSITIVE_FIELD_NAME}\s+)(${SECRET_VALUE_PATTERN})`,
  "gi",
);
const URL_PLACEHOLDER_RE = /__TESTERS_PROD_DEBUG_URL_(\d+)__/g;

function safeUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

function normalizeOrigin(raw: string): string | null {
  const url = safeUrl(raw);
  if (url) return url.origin;
  const hostUrl = safeUrl(`https://${raw}`);
  return hostUrl?.origin ?? null;
}

export function redactProdDebugText(value: string): string {
  const urls: string[] = [];
  const textWithoutUrls = value.replace(URL_TEXT_RE, (match) => {
    const url = safeUrl(match);
    if (!url) return match;

    const placeholder = `__TESTERS_PROD_DEBUG_URL_${urls.length}__`;
    urls.push(redactUrl(url));
    return placeholder;
  });

  return redactPlainProdDebugText(textWithoutUrls)
    .replace(URL_PLACEHOLDER_RE, (match, index: string) => urls[Number(index)] ?? match);
}

function redactPlainProdDebugText(value: string): string {
  return value
    .replace(SENSITIVE_ASSIGNMENT_RE, (_match, prefix: string, secret: string) => {
      return `${prefix}${redactedSecretValue(secret)}`;
    })
    .replace(SENSITIVE_OPTION_RE, (_match, leading: string, option: string, secret: string) => {
      return `${leading}${option}${redactedSecretValue(secret)}`;
    })
    .replace(SENSITIVE_TEXT_RE, (match) => {
      if (match.startsWith("Bearer ")) return "Bearer [redacted]";
      return "[redacted]";
    });
}

function redactedSecretValue(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) return '"[redacted]"';
  if (value.startsWith("'") && value.endsWith("'")) return "'[redacted]'";
  return "[redacted]";
}

function redactUrl(url: URL): string {
  const clone = new URL(url.toString());
  clone.pathname = redactPathname(clone.pathname);
  for (const key of Array.from(clone.searchParams.keys())) {
    const value = clone.searchParams.get(key) ?? "";
    if (shouldRedactUrlParam(key, value)) {
      clone.searchParams.set(key, "[redacted]");
    }
  }
  if (clone.hash) {
    clone.hash = redactUrlFragment(clone.hash.slice(1));
  }
  return clone.toString();
}

function redactUrlFragment(fragment: string): string {
  if (!fragment) return fragment;

  const queryIndex = fragment.indexOf("?");
  if (queryIndex >= 0) {
    const prefix = fragment.slice(0, queryIndex);
    const query = fragment.slice(queryIndex + 1);
    return looksLikeParamString(query)
      ? `${redactFragmentPath(prefix)}?${redactParamString(query)}`
      : redactPlainProdDebugText(fragment);
  }

  if (fragment.startsWith("/")) return redactFragmentPath(fragment);

  const paramText = fragment.startsWith("?") ? fragment.slice(1) : fragment;
  if (!looksLikeParamString(paramText)) return redactPlainProdDebugText(fragment);

  const redacted = redactParamString(paramText);
  return fragment.startsWith("?") ? `?${redacted}` : redacted;
}

function redactFragmentPath(path: string): string {
  return fragmentPathNeedsRedaction(path)
    ? redactPathname(path)
    : redactPlainProdDebugText(path);
}

function fragmentPathNeedsRedaction(path: string): boolean {
  return path
    .split("/")
    .some((segment) => segment && isSensitivePathSegment(safeDecodeURIComponent(segment)));
}

function redactParamString(value: string): string {
  const params = new URLSearchParams(value);
  let redacted = false;
  for (const key of Array.from(params.keys())) {
    const paramValue = params.get(key) ?? "";
    if (shouldRedactUrlParam(key, paramValue)) {
      params.set(key, "[redacted]");
      redacted = true;
    }
  }

  return redacted ? params.toString() : value;
}

function looksLikeParamString(value: string): boolean {
  return /^[A-Za-z0-9_.-]+=/.test(value);
}

function shouldRedactUrlParam(key: string, value: string): boolean {
  return SENSITIVE_PARAM_RE.test(key) || SECRET_LIKE_VALUE_RE.test(value);
}

function redactPathname(pathname: string): string {
  let redactNextSegment = false;
  return pathname
    .split("/")
    .map((segment) => {
      if (!segment) return segment;
      const decoded = safeDecodeURIComponent(segment);
      const shouldRedact = redactNextSegment || isSensitivePathSegment(decoded);
      redactNextSegment = isSensitivePathLabel(decoded);
      return shouldRedact ? encodeURIComponent("[redacted]") : segment;
    })
    .join("/");
}

function isSensitivePathLabel(segment: string): boolean {
  return (
    SENSITIVE_PATH_LABEL_RE.test(segment) ||
    SESSION_COLLECTION_PATH_LABEL_RE.test(segment) ||
    COMPOUND_GRANT_PATH_LABEL_RE.test(segment)
  );
}

function isSensitivePathSegment(segment: string): boolean {
  return SENSITIVE_PATH_SEGMENT_RE.test(segment) || SECRET_LIKE_VALUE_RE.test(segment);
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function redactUrlString(value: string): string {
  const url = safeUrl(value);
  return url ? redactUrl(url) : redactProdDebugText(value);
}

export function parseProdDebugTarget(target: string): ProdDebugIdentifiers {
  const input = target.trim();
  const url = safeUrl(input);
  if (!url) {
    const id = (input.match(UUID_RE)?.[0] ?? input) || null;
    return {
      url: null,
      origin: null,
      orgSlug: null,
      projectRef: null,
      sessionId: null,
      agentId: null,
      requestId: input.startsWith("req_") ? input : null,
      rawId: id,
    };
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const projectsIndex = parts.indexOf("projects");
  const sessionsIndex = parts.indexOf("sessions");
  const orgSlug = projectsIndex > 0 ? parts[0] ?? null : null;
  const projectRef = projectsIndex >= 0 ? parts[projectsIndex + 1] ?? null : null;
  const sessionId = redactedSessionId(
    url.searchParams.get("session") ??
    (sessionsIndex >= 0 ? parts[sessionsIndex + 1] ?? null : null),
  );

  return {
    url: redactUrl(url),
    origin: url.origin,
    orgSlug,
    projectRef,
    sessionId,
    agentId: url.searchParams.get("agent"),
    requestId: url.searchParams.get("requestId") ?? url.searchParams.get("request_id"),
    rawId: input.match(UUID_RE)?.[0] ?? null,
  };
}

function boundedTtl(value: number | undefined): number {
  if (!Number.isFinite(value)) return 15;
  return Math.min(Math.max(Math.round(value ?? 15), 1), 60);
}

function makeCommand(command: string): string {
  return command.replace(/\s+/g, " ").trim();
}

function hostnameFromOrigin(origin: string | null): string | null {
  if (!origin) return null;
  return safeUrl(origin)?.hostname ?? null;
}

function originMatches(pattern: string, origin: string | null): boolean {
  if (!origin) return false;
  const normalizedPattern = normalizeOrigin(pattern);
  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) return false;

  if (normalizedPattern === normalizedOrigin) return true;

  const targetHost = hostnameFromOrigin(normalizedOrigin);
  const patternHost = normalizedPattern ? hostnameFromOrigin(normalizedPattern) : pattern.replace(/^https?:\/\//, "");
  if (!targetHost || !patternHost) return false;
  if (patternHost.startsWith("*.")) {
    const suffix = patternHost.slice(1);
    return targetHost.endsWith(suffix);
  }
  return targetHost === patternHost;
}

function resolveProfile(input: ProdDebugInput, target: ProdDebugIdentifiers, config?: ProdDebugConfig): ResolvedProfile {
  const apps = config?.apps ?? {};
  const explicitKey = input.profile?.trim() || input.app?.trim() || config?.defaultProfile;
  if (explicitKey && apps[explicitKey]) {
    return {
      key: explicitKey,
      profile: apps[explicitKey],
      matchedOrigin: target.origin,
    };
  }

  for (const [key, profile] of Object.entries(apps)) {
    const match = profile.origins?.find((origin) => originMatches(origin, target.origin));
    if (match) {
      return { key, profile, matchedOrigin: match };
    }
  }

  return { key: null, profile: null, matchedOrigin: null };
}

function firstResolvedCredential(...values: Array<string | undefined>): string | null {
  for (const value of values) {
    if (!value?.trim()) continue;
    const resolved = resolveCredential(value);
    if (resolved) return resolved;
  }
  return null;
}

function displaySupportGrant(value: string | null, source?: string): string | null {
  if (!value) return null;
  if (source && isCredentialReference(source)) return "[configured]";
  return "[redacted]";
}

function redactedSessionId(value: string | null): string | null {
  if (!value) return null;
  if (UUID_RE.test(value)) return value;
  return "[redacted]";
}

function replacementValues(
  target: ProdDebugIdentifiers,
  input: ProdDebugInput,
  supportGrant: string | null,
): Record<string, string> {
  const values: Record<string, string> = {
    targetUrl: target.url ?? input.target,
    origin: target.origin ?? "",
    org: target.orgSlug ?? "",
    project: target.projectRef ?? "",
    session: target.sessionId ?? "",
    agent: target.agentId ?? "",
    request: target.requestId ?? "",
    rawId: target.rawId ?? "",
    reason: input.reason ?? "",
    supportGrant: supportGrant ? "[redacted]" : "",
  };

  for (const [key, value] of Object.entries({ ...values })) {
    values[`${key}Encoded`] = encodeURIComponent(value);
  }

  return values;
}

function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key: string) => values[key] ?? "");
}

function resolveSupportGrant(input: ProdDebugInput, profile: ProdDebugAppProfile | null): {
  value: string | null;
  display: string | null;
  source: string | null;
} {
  if (input.supportGrantId?.trim()) {
    return {
      value: input.supportGrantId.trim(),
      display: displaySupportGrant(input.supportGrantId.trim()),
      source: "input",
    };
  }

  const source = profile?.supportGrantRef ?? profile?.supportGrantId ?? null;
  const value = firstResolvedCredential(profile?.supportGrantRef, profile?.supportGrantId);
  return { value, display: displaySupportGrant(value, source ?? undefined), source };
}

function resolveSupportUrl(
  input: ProdDebugInput,
  target: ProdDebugIdentifiers,
  profile: ProdDebugAppProfile | null,
  supportGrant: string | null,
): string | null {
  if (input.supportUrl?.trim()) return input.supportUrl.trim();

  const direct = firstResolvedCredential(profile?.supportUrlRef, profile?.supportUrl);
  if (direct) return direct;

  if (profile?.supportUrlTemplate) {
    const rendered = renderTemplate(
      profile.supportUrlTemplate,
      replacementValues(target, input, supportGrant),
    ).trim();
    return rendered || null;
  }

  return null;
}

function resolvePiiOrigin(profile: ProdDebugAppProfile | null, target: ProdDebugIdentifiers): string | null {
  if (!profile?.piiOrigin) return target.origin;
  return redactUrlString(renderTemplate(profile.piiOrigin, replacementValues(target, { target: target.url ?? "" }, null)));
}

function resolveSupportRunTarget(supportUrl: string | null, input: ProdDebugInput, target: ProdDebugIdentifiers): string {
  if (supportUrl) return redactUrlString(supportUrl);
  return target.url ?? target.origin ?? redactProdDebugText(input.target);
}

function supportScenarioDescription(reason: string): string {
  return `Prod debug: ${reason}. Reproduce the user-visible issue, capture console and network errors, and do not enter secrets.`;
}

function configuredMissing(
  profile: ProdDebugAppProfile | null,
  supportUrl: string | null,
  supportGrant: string | null,
  includeLogs: boolean,
): string[] {
  const missing: string[] = [];
  if (!profile) {
    missing.push("optional: add prodDebug.apps.<profile>.origins to match this app automatically");
  }
  if (!supportUrl) {
    missing.push("supportUrl/supportUrlRef/supportUrlTemplate for scoped browser debugging");
  }
  if (!supportGrant) {
    missing.push("supportGrantId/supportGrantRef for auditable support access");
  }
  if (includeLogs && !profile?.logCommand) {
    missing.push("logCommand for sanitized app/provider log lookup");
  }
  return missing;
}

export function createProdDebugPlan(input: ProdDebugInput, config?: ProdDebugConfig): ProdDebugPlan {
  const target = parseProdDebugTarget(input.target);
  const browserRequested = input.includeBrowser !== false;
  const resolvedProfile = resolveProfile(input, target, config);
  const supportGrant = resolveSupportGrant(input, resolvedProfile.profile);
  const app =
    input.app?.trim() ||
    resolvedProfile.profile?.name ||
    resolvedProfile.key ||
    (target.origin ? new URL(target.origin).hostname : "app");
  const reason = input.reason?.trim()
    ? redactProdDebugText(input.reason.trim())
    : "production debug requested";
  const sanitizedInput = { ...input, reason };
  const supportUrl = resolveSupportUrl(sanitizedInput, target, resolvedProfile.profile, supportGrant.value);
  const supportBrowserReady = Boolean(supportUrl);
  const actor = input.actor?.trim() || process.env["USER"] || "agent";
  const ttlMinutes = boundedTtl(input.ttlMinutes);
  const piiOrigin = resolvePiiOrigin(resolvedProfile.profile, target);
  const logCommand = resolvedProfile.profile?.logCommand
    ? redactUrlString(renderTemplate(
      resolvedProfile.profile.logCommand,
      replacementValues(target, sanitizedInput, supportGrant.value),
    ))
    : null;

  const safety = [
    "read-only by default",
    "no customer passwords or raw cookies",
    "redact tokens, OAuth codes, session values, support grants, and secrets",
    "verify org/user/session scope before reading data",
    "require explicit approval for production writes",
    `support access TTL capped at ${ttlMinutes} minutes`,
  ];

  const checks: ProdDebugCheck[] = [];
  const blocked: string[] = [];

  if (target.url) {
    checks.push({
      id: "public-route-smoke",
      status: "ready",
      description: "Open the supplied production URL and capture console/network errors without credentials.",
      command: makeCommand(`testers scan all ${JSON.stringify(target.url)} --json`),
    });
  }

  checks.push({
    id: "pii-redaction-scan",
    status: piiOrigin ? "ready" : "blocked",
    description: "Scan public/API responses for accidental sensitive data leakage.",
    command: piiOrigin
      ? makeCommand(`testers scan pii ${JSON.stringify(piiOrigin)} --json`)
      : undefined,
    reason: piiOrigin ? undefined : "Need a URL origin or prodDebug app profile piiOrigin to run the PII scan.",
  });

  if (browserRequested) {
    if (supportBrowserReady) {
      checks.push({
        id: "support-browser-repro",
        status: "ready",
        description: "Use an audited support browser/session URL to reproduce the user-visible issue.",
        command: makeCommand(
          `testers run ${JSON.stringify(resolveSupportRunTarget(supportUrl, input, target))} ${JSON.stringify(supportScenarioDescription(reason))} --headed --json --overall-timeout 600000`,
        ),
      });
    } else {
      const reasonText = supportGrant.value
        ? "An audited support grant was supplied, but open-testers still needs supportUrl/supportUrlRef/supportUrlTemplate or an app adapter to open a scoped browser session."
        : "No audited support browser/session grant was supplied. Do not use customer passwords, copied cookies, bearer tokens, or magic links.";
      blocked.push(reasonText);
      checks.push({
        id: "support-browser-repro",
        status: "blocked",
        description: "Browser reproduction as the target user requires a short-lived audited support session.",
        reason: reasonText,
      });
    }
  }

  if (input.includeLogs) {
    if (logCommand) {
      checks.push({
        id: "log-timeline",
        status: "ready",
        description: "Read sanitized app/provider logs by request ID, session ID, project ID, or support access ID.",
        command: makeCommand(logCommand),
      });
    } else {
      checks.push({
        id: "log-timeline",
        status: "blocked",
        description: "Read sanitized app/provider logs by request ID, session ID, project ID, or support access ID.",
        reason:
          "Configure prodDebug.apps.<profile>.logCommand or use an app-specific log MCP. Do not paste raw provider logs with headers/secrets.",
      });
    }
  }

  if (input.allowWrites) {
    blocked.push("Production writes are not part of prod-debug. Require a separate explicit approval and app-specific write tool.");
  }

  return {
    target,
    app,
    actor,
    reason,
    ttlMinutes,
    setup: {
      profile: resolvedProfile.key,
      matchedOrigin: resolvedProfile.matchedOrigin,
      configured: {
        supportUrl: Boolean(supportUrl),
        supportGrant: Boolean(supportGrant.value),
        piiOrigin: Boolean(piiOrigin),
        logCommand: Boolean(logCommand),
      },
      missing: configuredMissing(resolvedProfile.profile, supportUrl, supportGrant.value, Boolean(input.includeLogs)),
    },
    supportAccess: {
      required: browserRequested,
      grantId: supportGrant.display,
      browserReady: supportBrowserReady,
      note: supportBrowserReady
        ? "Use the provided audited support access; never print token/cookie values."
        : "Configure an audited support-browser/session URL, URL ref, or template before user-scoped browser debugging.",
    },
    safety,
    checks,
    blocked,
  };
}

export function formatProdDebugPlan(plan: ProdDebugPlan): string {
  const lines: string[] = [];
  lines.push(`Prod debug plan for ${plan.app}`);
  lines.push("");
  lines.push("Target");
  lines.push(`- url: ${plan.target.url ?? "(none)"}`);
  lines.push(`- org: ${plan.target.orgSlug ?? "(unknown)"}`);
  lines.push(`- project: ${plan.target.projectRef ?? "(unknown)"}`);
  lines.push(`- session: ${plan.target.sessionId ?? "(unknown)"}`);
  lines.push(`- agent: ${plan.target.agentId ?? "(unknown)"}`);
  lines.push(`- request: ${plan.target.requestId ?? "(unknown)"}`);
  lines.push("");
  lines.push("Setup");
  lines.push(`- profile: ${plan.setup.profile ?? "(none)"}`);
  lines.push(`- matched origin: ${plan.setup.matchedOrigin ?? "(none)"}`);
  if (plan.setup.missing.length > 0) {
    for (const item of plan.setup.missing) lines.push(`- missing: ${item}`);
  }
  lines.push("");
  lines.push("Support access");
  lines.push(`- actor: ${plan.actor}`);
  lines.push(`- reason: ${plan.reason}`);
  lines.push(`- ttl: ${plan.ttlMinutes} minutes`);
  lines.push(`- grant: ${plan.supportAccess.grantId ?? "(none)"}`);
  lines.push(`- browser ready: ${plan.supportAccess.browserReady ? "yes" : "no"}`);
  lines.push(`- note: ${plan.supportAccess.note}`);
  lines.push("");
  lines.push("Checks");
  for (const check of plan.checks) {
    lines.push(`- ${check.id}: ${check.status} - ${check.description}`);
    if (check.command) lines.push(`  command: ${check.command}`);
    if (check.reason) lines.push(`  blocked: ${check.reason}`);
  }
  if (plan.blocked.length > 0) {
    lines.push("");
    lines.push("Blocked");
    for (const item of plan.blocked) lines.push(`- ${item}`);
  }
  lines.push("");
  lines.push("Safety");
  for (const item of plan.safety) lines.push(`- ${item}`);
  return lines.join("\n");
}
