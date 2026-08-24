// @bun
// src/signing.ts
import { createHmac, timingSafeEqual } from "crypto";
var DEFAULT_SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000;
function buildSignatureBase(timestamp, body) {
  return `${timestamp}.${body}`;
}
function signPayload(secret, timestamp, body) {
  const digest = createHmac("sha256", secret).update(buildSignatureBase(timestamp, body)).digest("hex");
  return `sha256=${digest}`;
}
function verifyPayloadSignature(secret, timestamp, body, signature) {
  const expected = signPayload(secret, timestamp, body);
  const actual = signature.trim();
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  if (expectedBuffer.length !== actualBuffer.length)
    return false;
  return timingSafeEqual(expectedBuffer, actualBuffer);
}
function isTimestampWithinTolerance(timestamp, toleranceMs, now = Date.now()) {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed))
    return false;
  const reference = now instanceof Date ? now.getTime() : now;
  return Math.abs(reference - parsed) <= toleranceMs;
}
function verifyWebhookSignature(secret, timestamp, body, signature, options = {}) {
  const toleranceMs = options.toleranceMs ?? DEFAULT_SIGNATURE_TOLERANCE_MS;
  if (!isTimestampWithinTolerance(timestamp, toleranceMs, options.now)) {
    return false;
  }
  return verifyPayloadSignature(secret, timestamp, body, signature);
}

// src/ssrf.ts
import { lookup as dnsLookup } from "dns/promises";
import { isIP } from "net";
var DEFAULT_MAX_REDIRECTS = 5;
var IPV4_PRIVATE_RANGES = [
  [0, 16777215],
  [167772160, 184549375],
  [1681915904, 1686110207],
  [2130706432, 2147483647],
  [2851995648, 2852061183],
  [2886729728, 2887778303],
  [3221225472, 3221225727],
  [3221225984, 3221226239],
  [3227017984, 3227018239],
  [3232235520, 3232301055],
  [3323068416, 3323199487],
  [3325256704, 3325256959],
  [3405803776, 3405804031],
  [3758096384, 4294967295]
];
var IPV6_SPECIAL_PREFIXES = [
  { groups: [0, 0, 0, 0, 0, 0, 0, 0], bits: 128 },
  { groups: [0, 0, 0, 0, 0, 0, 0, 1], bits: 128 },
  { groups: [0, 0, 0, 0, 0, 65535, 0, 0], bits: 96 },
  { groups: [100, 65435, 0, 0, 0, 0, 0, 0], bits: 96 },
  { groups: [256, 0, 0, 0, 0, 0, 0, 0], bits: 64 },
  { groups: [8193, 0, 0, 0, 0, 0, 0, 0], bits: 32 },
  { groups: [8193, 2, 0, 0, 0, 0, 0, 0], bits: 48 },
  { groups: [8193, 16, 0, 0, 0, 0, 0, 0], bits: 28 },
  { groups: [8193, 3512, 0, 0, 0, 0, 0, 0], bits: 32 },
  { groups: [8194, 0, 0, 0, 0, 0, 0, 0], bits: 16 },
  { groups: [16383, 0, 0, 0, 0, 0, 0, 0], bits: 20 },
  { groups: [64512, 0, 0, 0, 0, 0, 0, 0], bits: 7 },
  { groups: [65152, 0, 0, 0, 0, 0, 0, 0], bits: 10 },
  { groups: [65216, 0, 0, 0, 0, 0, 0, 0], bits: 10 },
  { groups: [65280, 0, 0, 0, 0, 0, 0, 0], bits: 8 }
];
function isPrivateAddress(address) {
  const normalized = stripZoneId(address);
  const version = isIP(normalized);
  if (version === 4) {
    const integer = ipv4ToInt(normalized);
    if (integer === undefined)
      return true;
    return IPV4_PRIVATE_RANGES.some(([low, high]) => integer >= low && integer <= high);
  }
  if (version === 6) {
    const groups = ipv6Groups(normalized);
    if (!groups)
      return true;
    for (const prefix of IPV6_SPECIAL_PREFIXES) {
      if (!ipv6MatchesPrefix(groups, prefix.groups, prefix.bits))
        continue;
      if (prefix.bits === 96 && groups[5] === 65535) {
        return isPrivateAddress(ipv4IntToString(groups[6] << 16 | groups[7]));
      }
      if (prefix.bits === 16 && groups[0] === 8194) {
        return isPrivateAddress(ipv4IntToString(groups[1] << 16 | groups[2]));
      }
      return true;
    }
    return false;
  }
  return true;
}
async function resolveWebhookTarget(url, policy = {}) {
  const hostname = normalizeHostname(url.hostname);
  const allowlist = (policy.allowPrivateHosts ?? []).map((entry) => normalizeHostname(entry.toLowerCase()));
  if (allowlist.includes(hostname)) {
    const version2 = isIP(hostname);
    if (version2 === 4 || version2 === 6) {
      return { hostname, addresses: [hostname] };
    }
    const lookup2 = policy.lookup ?? defaultTargetLookup;
    let resolved2;
    try {
      resolved2 = await lookup2(hostname);
    } catch {
      throw new Error(`Webhook target ${hostname} could not be resolved`);
    }
    if (!Array.isArray(resolved2) || resolved2.length === 0) {
      throw new Error(`Webhook target ${hostname} resolved to no addresses`);
    }
    const addresses = resolved2.map((entry) => normalizeHostname(entry.address));
    return { hostname, addresses };
  }
  const version = isIP(hostname);
  if (version === 4 || version === 6) {
    if (isPrivateAddress(hostname)) {
      throw new Error(`Webhook target ${hostname} is a private or special-use address`);
    }
    return { hostname, addresses: [hostname] };
  }
  const lookup = policy.lookup ?? defaultTargetLookup;
  let resolved;
  try {
    resolved = await lookup(hostname);
  } catch {
    throw new Error(`Webhook target ${hostname} could not be resolved`);
  }
  if (!Array.isArray(resolved) || resolved.length === 0) {
    throw new Error(`Webhook target ${hostname} resolved to no addresses`);
  }
  const allowed = [];
  for (const entry of resolved) {
    const address = normalizeHostname(entry.address);
    if (isPrivateAddress(address)) {
      if (allowlist.includes(address)) {
        allowed.push(address);
        continue;
      }
      throw new Error(`Webhook target ${hostname} resolves to private or special-use address ${address}`);
    }
    allowed.push(address);
  }
  if (allowed.length === 0) {
    throw new Error(`Webhook target ${hostname} resolved to no public addresses`);
  }
  return { hostname, addresses: allowed };
}
async function assertWebhookTargetAllowed(url, policy = {}) {
  await resolveWebhookTarget(url, policy);
}
function normalizeMaxRedirects(value) {
  if (value === undefined)
    return DEFAULT_MAX_REDIRECTS;
  if (!Number.isInteger(value) || value < 0)
    throw new Error("webhookTargetPolicy.maxRedirects must be a non-negative integer");
  return value;
}
var defaultTargetLookup = async (hostname) => {
  return dnsLookup(hostname, { all: true, verbatim: false });
};
function normalizeHostname(hostname) {
  const lower = hostname.toLowerCase();
  if (lower.startsWith("[") && lower.endsWith("]"))
    return lower.slice(1, -1);
  return lower;
}
function stripZoneId(address) {
  const percent = address.indexOf("%");
  return percent === -1 ? address : address.slice(0, percent);
}
function ipv4ToInt(address) {
  const parts = address.split(".");
  if (parts.length !== 4)
    return;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part))
      return;
    const octet = Number(part);
    if (octet > 255)
      return;
    value = value << 8 | octet;
  }
  return value >>> 0;
}
function ipv4IntToString(integer) {
  return [
    integer >>> 24 & 255,
    integer >>> 16 & 255,
    integer >>> 8 & 255,
    integer & 255
  ].join(".");
}
function ipv6Groups(address) {
  const raw = stripZoneId(address);
  const doubleColon = raw.indexOf("::");
  const headText = doubleColon === -1 ? raw : raw.slice(0, doubleColon);
  const tailText = doubleColon === -1 ? "" : raw.slice(doubleColon + 2);
  const parseGroups = (text) => {
    if (text === "")
      return [];
    const out = [];
    for (const part of text.split(":")) {
      if (part.includes(".")) {
        const v4 = ipv4ToInt(part);
        if (v4 === undefined)
          return;
        out.push(v4 >>> 16 & 65535, v4 & 65535);
      } else {
        if (!/^[0-9a-fA-F]{1,4}$/.test(part))
          return;
        out.push(parseInt(part, 16));
      }
    }
    return out;
  };
  const head = parseGroups(headText);
  if (!head)
    return;
  const tail = parseGroups(tailText);
  if (!tail)
    return;
  const total = head.length + tail.length;
  if (doubleColon === -1) {
    return total === 8 ? head : undefined;
  }
  if (total >= 8)
    return;
  return [...head, ...new Array(8 - total).fill(0), ...tail];
}
function ipv6MatchesPrefix(groups, prefixGroups, prefixBits) {
  let remaining = prefixBits;
  for (let index = 0;index < prefixGroups.length && remaining > 0; index += 1) {
    const take = Math.min(16, remaining);
    const mask = 65535 << 16 - take & 65535;
    if ((groups[index] & mask) !== (prefixGroups[index] & mask))
      return false;
    remaining -= take;
  }
  return true;
}

// src/transports.ts
import { randomUUID } from "crypto";
import { spawn } from "child_process";
import { request as nodeHttpRequest } from "http";
import { request as nodeHttpsRequest } from "https";
function now() {
  return new Date().toISOString();
}
function truncate(value, max = 4096) {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}
function buildWebhookRequest(event, channel, options = {}) {
  if (!channel.webhook)
    throw new Error(`Channel ${channel.id} has no webhook config`);
  for (const name of Object.keys(channel.webhook.headers ?? {})) {
    if (/^x-hasna-/i.test(name)) {
      throw new Error(`Webhook header ${name} is reserved for signed delivery metadata`);
    }
  }
  const body = JSON.stringify(event);
  const timestamp = options.timestamp ?? new Date().toISOString();
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": "@hasna/events",
    "X-Hasna-Event-Id": event.id,
    "X-Hasna-Event-Type": event.type,
    ...channel.webhook.headers,
    "X-Hasna-Timestamp": timestamp
  };
  const secret = options.secret ?? channel.webhook.secret;
  if (secret) {
    headers["X-Hasna-Signature"] = signPayload(secret, timestamp, body);
  }
  return { body, headers };
}
function normalizeWebhookUrl(raw) {
  const url = new URL(raw);
  if (url.username !== "" || url.password !== "") {
    url.username = "";
    url.password = "";
  }
  return url.toString();
}
async function dispatchWebhook(event, channel, options = {}) {
  if (!channel.webhook)
    throw new Error(`Channel ${channel.id} has no webhook config`);
  const webhookUrl = normalizeWebhookUrl(channel.webhook.url);
  const startedAt = now();
  let secret = channel.webhook.secret;
  if (channel.webhook.secretRef) {
    if (!options.secretResolver) {
      return failedAttempt(startedAt, "Webhook secret reference has no runtime resolver");
    }
    try {
      secret = await options.secretResolver(channel.webhook.secretRef);
    } catch {
      return failedAttempt(startedAt, "Webhook secret reference could not be resolved");
    }
    if (!secret)
      return failedAttempt(startedAt, "Webhook secret reference could not be resolved");
  }
  const timestamp = (options.now?.() ?? new Date).toISOString();
  const { body, headers } = buildWebhookRequest(event, channel, { secret, timestamp });
  const validateTargets = options.webhookTargetPolicy !== undefined || options.fetchImpl === undefined;
  if (validateTargets) {
    return dispatchValidatedWebhook(event, channel, { body, headers, startedAt, options });
  }
  const controller = new AbortController;
  const timeout = setTimeout(() => controller.abort(), channel.webhook.timeoutMs ?? 15000);
  try {
    const response = await (options.fetchImpl ?? fetch)(webhookUrl, {
      method: "POST",
      headers,
      body,
      signal: controller.signal
    });
    const responseBody = truncate(await response.text());
    return {
      attempt: 1,
      status: response.ok ? "success" : "failed",
      startedAt,
      completedAt: now(),
      responseStatus: response.status,
      responseBody,
      error: response.ok ? undefined : `Webhook returned HTTP ${response.status}`
    };
  } catch (error) {
    return {
      attempt: 1,
      status: "failed",
      startedAt,
      completedAt: now(),
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timeout);
  }
}
function isRedirectStatus(status) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}
function redirectKeepsBody(status) {
  return status === 307 || status === 308;
}
async function pinnedNativeRequest(target, addresses, method, headers, body, signal, tls) {
  const isHttps = target.protocol === "https:";
  if (!isHttps && target.protocol !== "http:") {
    throw new Error(`Webhook target uses unsupported protocol ${target.protocol}`);
  }
  const defaultPort = isHttps ? 443 : 80;
  const port = target.port ? Number(target.port) : defaultPort;
  const requestOptions = {
    hostname: target.hostname,
    port,
    path: `${target.pathname}${target.search}`,
    method,
    headers,
    ...tls?.ca ? { ca: tls.ca } : {},
    lookup: (hostname, _options, callback) => {
      const entries = addresses.map((address) => ({
        address,
        family: address.includes(":") ? 6 : 4
      }));
      callback(null, entries);
    }
  };
  return new Promise((resolve, reject) => {
    const request = isHttps ? nodeHttpsRequest(requestOptions, onResponse) : nodeHttpRequest(requestOptions, onResponse);
    const onAbort = () => {
      const error = new Error("The operation was aborted.");
      error.name = "AbortError";
      request.destroy(error);
    };
    if (signal.aborted)
      onAbort();
    else
      signal.addEventListener("abort", onAbort, { once: true });
    request.on("error", reject);
    if (body !== undefined)
      request.write(body);
    request.end();
    function onResponse(response) {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("error", reject);
      response.on("end", () => {
        const headersRecord = {};
        for (const [name, value] of Object.entries(response.headers)) {
          if (typeof value === "string")
            headersRecord[name] = value;
          else if (Array.isArray(value))
            headersRecord[name] = value.join(", ");
        }
        resolve(new Response(Buffer.concat(chunks), { status: response.statusCode ?? 200, headers: headersRecord }));
      });
    }
  });
}
async function dispatchValidatedWebhook(event, channel, input) {
  const { body, headers, startedAt, options } = input;
  const webhook = channel.webhook;
  if (!webhook)
    throw new Error(`Channel ${channel.id} has no webhook config`);
  const policy = options.webhookTargetPolicy ?? {};
  const maxRedirects = normalizeMaxRedirects(policy.maxRedirects);
  const controller = new AbortController;
  const timeout = setTimeout(() => controller.abort(), webhook.timeoutMs ?? 15000);
  try {
    let target = new URL(normalizeWebhookUrl(webhook.url));
    let requestHeaders = headers;
    let method = "POST";
    let requestBody = body;
    let redirectsFollowed = 0;
    for (;; ) {
      const resolved = await resolveWebhookTarget(target, policy).catch((error) => {
        throw new Error(`Webhook target rejected by SSRF guard: ${error.message}`);
      });
      const response = options.fetchImpl ? await options.fetchImpl(target, {
        method,
        headers: requestHeaders,
        body: requestBody,
        signal: controller.signal,
        redirect: "manual"
      }) : await pinnedNativeRequest(target, resolved.addresses, method, requestHeaders, requestBody, controller.signal, options.tls);
      const location = response.headers.get("location");
      if (isRedirectStatus(response.status) && location) {
        if (redirectsFollowed >= maxRedirects) {
          return failedAttempt(startedAt, `Webhook target exceeded ${maxRedirects} redirects`);
        }
        redirectsFollowed += 1;
        const next = new URL(location, target);
        target = next;
        if (!redirectKeepsBody(response.status)) {
          method = "GET";
          requestBody = undefined;
          requestHeaders = Object.fromEntries(Object.entries(requestHeaders).filter(([name]) => name.toLowerCase() !== "content-type" && name.toLowerCase() !== "content-length"));
        }
        continue;
      }
      const responseBody = truncate(await response.text());
      return {
        attempt: 1,
        status: response.ok ? "success" : "failed",
        startedAt,
        completedAt: now(),
        responseStatus: response.status,
        responseBody,
        error: response.ok ? undefined : `Webhook returned HTTP ${response.status}`
      };
    }
  } catch (error) {
    return {
      attempt: 1,
      status: "failed",
      startedAt,
      completedAt: now(),
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timeout);
  }
}
function failedAttempt(startedAt, error) {
  return {
    attempt: 1,
    status: "failed",
    startedAt,
    completedAt: now(),
    error
  };
}
async function dispatchCommand(event, channel) {
  if (!channel.command)
    throw new Error(`Channel ${channel.id} has no command config`);
  const startedAt = now();
  const eventJson = JSON.stringify(event);
  const env = {
    ...process.env,
    ...channel.command.env,
    HASNA_CHANNEL_ID: channel.id,
    HASNA_EVENT_ID: event.id,
    HASNA_EVENT_TYPE: event.type,
    HASNA_EVENT_SOURCE: event.source,
    HASNA_EVENT_SUBJECT: event.subject ?? "",
    HASNA_EVENT_SEVERITY: event.severity,
    HASNA_EVENT_TIME: event.time,
    HASNA_EVENT_DEDUPE_KEY: event.dedupeKey ?? "",
    HASNA_EVENT_SCHEMA_VERSION: event.schemaVersion,
    HASNA_EVENT_JSON: eventJson
  };
  return new Promise((resolve) => {
    const child = spawn(channel.command.command, channel.command.args ?? [], {
      cwd: channel.command.cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => child.kill("SIGTERM"), channel.command.timeoutMs ?? 15000);
    child.stdin.end(eventJson);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      resolve({
        attempt: 1,
        status: "failed",
        startedAt,
        completedAt: now(),
        stdout: truncate(stdout),
        stderr: truncate(stderr),
        error: error.message
      });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      const success = code === 0;
      resolve({
        attempt: 1,
        status: success ? "success" : "failed",
        startedAt,
        completedAt: now(),
        stdout: truncate(stdout),
        stderr: truncate(stderr),
        error: success ? undefined : `Command exited with ${signal ? `signal ${signal}` : `code ${code}`}`
      });
    });
  });
}
async function dispatchChannel(event, channel, options = {}) {
  if (channel.transport === "webhook")
    return dispatchWebhook(event, channel, options);
  if (channel.transport === "command")
    return dispatchCommand(event, channel);
  return {
    attempt: 1,
    status: "skipped",
    startedAt: now(),
    completedAt: now(),
    error: `Unsupported transport: ${channel.transport}`
  };
}
function createDeliveryResult(event, channel, attempts) {
  const status = attempts.some((attempt) => attempt.status === "success") ? "success" : attempts.every((attempt) => attempt.status === "skipped") ? "skipped" : "failed";
  return {
    id: randomUUID(),
    eventId: event.id,
    channelId: channel.id,
    transport: channel.transport,
    status,
    attempts,
    createdAt: attempts[0]?.startedAt ?? now(),
    completedAt: attempts.at(-1)?.completedAt ?? now()
  };
}
export {
  dispatchWebhook,
  dispatchCommand,
  dispatchChannel,
  createDeliveryResult,
  buildWebhookRequest
};
