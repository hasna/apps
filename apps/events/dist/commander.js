// @bun
// src/filter.ts
function getPathValue(input, path) {
  return path.split(".").reduce((value, part) => {
    if (value && typeof value === "object" && part in value) {
      return value[part];
    }
    return;
  }, input);
}
function getFieldValues(input, path) {
  const values = [];
  const push = (value) => {
    if (!values.some((item) => Object.is(item, value)))
      values.push(value);
  };
  if (path.includes(".") && path in input)
    push(input[path]);
  const nestedValue = getPathValue(input, path);
  if (nestedValue !== undefined || !path.includes("."))
    push(nestedValue);
  return values;
}
function wildcardToRegExp(pattern, options = {}) {
  let body = "";
  for (let index = 0;index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        body += ".*";
        index += 1;
      } else {
        body += options.segmentSafe ? "[^/]*" : ".*";
      }
    } else {
      body += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  return new RegExp(`^${body}$`);
}
function matchString(value, matcher, options = {}) {
  if (matcher === undefined)
    return true;
  if (value === undefined)
    return false;
  const matchers = Array.isArray(matcher) ? matcher : [matcher];
  return matchers.some((item) => wildcardToRegExp(item, options).test(value));
}
function matchRecord(input, matcher) {
  if (!matcher)
    return true;
  return Object.entries(matcher).every(([path, expected]) => {
    const actualValues = getFieldValues(input, path);
    return matchField(actualValues, expected, path);
  });
}
function matchField(actualValues, expected, path) {
  if (isNegativeMatcher(expected)) {
    return !actualValues.some((actual) => matchPositiveField(actual, expected.not, path));
  }
  return actualValues.some((actual) => matchPositiveField(actual, expected, path));
}
function matchPositiveField(actual, expected, path) {
  if (typeof expected === "string" || Array.isArray(expected)) {
    return stringCandidates(actual).some((candidate) => matchString(candidate, expected, {
      segmentSafe: path.endsWith("_path") || path.endsWith(".path")
    }));
  }
  if (Array.isArray(actual)) {
    return actual.some((item) => item === expected);
  }
  return actual === expected;
}
function stringCandidates(actual) {
  if (actual === undefined)
    return [];
  if (Array.isArray(actual)) {
    return actual.flatMap((item) => isPrimitiveFieldValue(item) ? [String(item)] : []);
  }
  return [String(actual)];
}
function isPrimitiveFieldValue(value) {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}
function isNegativeMatcher(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && "not" in value);
}
function eventMatchesFilter(event, filter) {
  return matchString(event.source, filter.source) && matchString(event.type, filter.type) && matchString(event.subject, filter.subject) && matchString(event.severity, filter.severity) && matchRecord(event.data, filter.data) && matchRecord(event.metadata, filter.metadata);
}
function channelMatchesEvent(channel, event) {
  if (!channel.enabled)
    return false;
  if (!channel.filters || channel.filters.length === 0)
    return true;
  return channel.filters.some((filter) => eventMatchesFilter(event, filter));
}

// src/storage.ts
import { chmod, mkdir, readFile, rename, writeFile } from "fs/promises";
import { Buffer as Buffer2 } from "buffer";
import { existsSync as existsSync2 } from "fs";
import { join as join2 } from "path";

// src/app-home.ts
import { existsSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";
import { homedir as pathsResolverHomedir } from "os";
import { join as pathsResolverJoin } from "path";
var PATHS_RESOLVER_KIND_ENV = {
  config: "HASNA_CONFIG_HOME",
  data: "HASNA_DATA_HOME",
  state: "HASNA_STATE_HOME",
  cache: "HASNA_CACHE_HOME"
};
var PATHS_RESOLVER_APP_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
function pathsResolverAssertApp(app) {
  if (typeof app !== "string" || app.length === 0) {
    throw new TypeError("paths: app must be a non-empty string");
  }
  if (!PATHS_RESOLVER_APP_SLUG_RE.test(app)) {
    throw new TypeError(`paths: invalid app slug "${app}" \u2014 expected lowercase kebab-case ([a-z0-9]+(-[a-z0-9]+)*)`);
  }
}
function pathsResolverAssertKind(kind) {
  if (!Object.keys(PATHS_RESOLVER_KIND_ENV).includes(kind)) {
    throw new TypeError(`paths: invalid path kind "${kind}" \u2014 expected one of ${Object.keys(PATHS_RESOLVER_KIND_ENV).join(", ")}`);
  }
}
function pathsResolverBaseDir(kind, options) {
  pathsResolverAssertKind(kind);
  const env = options.env ?? process.env;
  const override = env[PATHS_RESOLVER_KIND_ENV[kind]];
  if (typeof override === "string" && override.length > 0)
    return override;
  const home = options.home ?? pathsResolverHomedir();
  const platform = options.platform ?? process.platform;
  if (platform === "darwin") {
    switch (kind) {
      case "config":
      case "data":
        return pathsResolverJoin(home, "Library", "Application Support", "Hasna");
      case "cache":
        return pathsResolverJoin(home, "Library", "Caches", "Hasna");
      case "state":
        return pathsResolverJoin(home, "Library", "Logs", "Hasna");
    }
  }
  switch (kind) {
    case "config":
      return pathsResolverJoin(home, ".config", "hasna");
    case "data":
      return pathsResolverJoin(home, ".local", "share", "hasna");
    case "state":
      return pathsResolverJoin(home, ".local", "state", "hasna");
    case "cache":
      return pathsResolverJoin(home, ".cache", "hasna");
  }
}
function pathsResolverResolve(kind, options) {
  pathsResolverAssertApp(options.app);
  const appSegment = options.internal === true ? pathsResolverJoin("internal", options.app) : options.app;
  return pathsResolverJoin(pathsResolverBaseDir(kind, options), appSegment);
}
function dataDir(options) {
  return pathsResolverResolve("data", options);
}
var HASNA_EVENTS_DIR_ENV = "HASNA_EVENTS_DIR";
var HASNA_EVENTS_HOME_ENV = "HASNA_EVENTS_HOME";
var EVENTS_STORE_SENTINEL_FILE = "events.json";
function effectiveHome() {
  return process.env["HOME"] || process.env["USERPROFILE"] || homedir();
}
function legacyHomeDir() {
  return join(effectiveHome(), ".hasna", "events");
}
function resolverHome() {
  return dataDir({ app: "events", home: effectiveHome() || undefined });
}
function adoptResolverHome(resolved, env = process.env) {
  const dataOverride = env.HASNA_DATA_HOME;
  if (typeof dataOverride === "string" && dataOverride.trim().length > 0)
    return true;
  return existsSync(join(resolved, EVENTS_STORE_SENTINEL_FILE));
}
function exactEventsHome() {
  const dir = process.env[HASNA_EVENTS_DIR_ENV];
  if (dir && dir.trim())
    return dir.trim();
  const home = process.env[HASNA_EVENTS_HOME_ENV];
  if (home && home.trim())
    return home.trim();
  return;
}
function getEventsHome() {
  const exact = exactEventsHome();
  if (exact)
    return resolve(exact);
  const resolved = resolverHome();
  return adoptResolverHome(resolved) ? resolve(resolved) : resolve(legacyHomeDir());
}

// src/storage.ts
var LOCAL_JSON_EVENT_CURSOR_PREFIX = "local-json-v1:";
var DEFAULT_EVENT_PAGE_LIMIT = 100;
var MAX_EVENT_PAGE_LIMIT = 1000;
function getEventsDataDir(override) {
  return override || getEventsHome();
}
function getActiveEventsDirEnv() {
  if (process.env[HASNA_EVENTS_DIR_ENV])
    return HASNA_EVENTS_DIR_ENV;
  if (process.env[HASNA_EVENTS_HOME_ENV])
    return HASNA_EVENTS_HOME_ENV;
  return null;
}

class JsonEventsStore {
  dataDir;
  runtime;
  channelsPath;
  eventsPath;
  deliveriesPath;
  constructor(dataDir2 = getEventsDataDir()) {
    this.dataDir = dataDir2;
    this.runtime = localJsonRuntime(dataDir2);
    this.channelsPath = join2(dataDir2, "channels.json");
    this.eventsPath = join2(dataDir2, "events.json");
    this.deliveriesPath = join2(dataDir2, "deliveries.json");
  }
  async init() {
    await mkdir(this.dataDir, { recursive: true, mode: 448 });
    await chmod(this.dataDir, 448).catch(() => {
      return;
    });
    await this.ensureArrayFile(this.channelsPath);
    await this.ensureArrayFile(this.eventsPath);
    await this.ensureArrayFile(this.deliveriesPath);
  }
  async addChannel(channel) {
    await this.init();
    const channels = await this.readJson(this.channelsPath, []);
    const index = channels.findIndex((item) => item.id === channel.id);
    if (index >= 0) {
      channels[index] = { ...channel, createdAt: channels[index].createdAt, updatedAt: new Date().toISOString() };
    } else {
      channels.push(channel);
    }
    await this.writeJson(this.channelsPath, channels);
    return index >= 0 ? channels[index] : channel;
  }
  async listChannels() {
    await this.init();
    return this.readJson(this.channelsPath, []);
  }
  async getChannel(id) {
    const channels = await this.listChannels();
    return channels.find((channel) => channel.id === id);
  }
  async removeChannel(id) {
    await this.init();
    const channels = await this.readJson(this.channelsPath, []);
    const next = channels.filter((channel) => channel.id !== id);
    await this.writeJson(this.channelsPath, next);
    return next.length !== channels.length;
  }
  async appendEvent(event) {
    await this.init();
    const events = await this.readJson(this.eventsPath, []);
    events.push(event);
    await this.writeJson(this.eventsPath, events);
    return event;
  }
  async appendEventOnce(event, options = {}) {
    await this.init();
    const events = await this.readJson(this.eventsPath, []);
    const dedupe = options.dedupe !== false;
    if (dedupe) {
      const existing = findEventByIdentity(events, { id: event.id, dedupeKey: event.dedupeKey });
      if (existing) {
        return {
          event: existing,
          stored: false,
          deduped: true,
          identity: { id: existing.id, dedupeKey: existing.dedupeKey }
        };
      }
    }
    events.push(event);
    await this.writeJson(this.eventsPath, events);
    return {
      event,
      stored: true,
      deduped: false,
      identity: { id: event.id, dedupeKey: event.dedupeKey }
    };
  }
  async listEvents(options = {}) {
    await this.init();
    const events = await this.readJson(this.eventsPath, []);
    return queryEvents(events, options);
  }
  async listEventsPage(options = {}) {
    await this.init();
    const events = await this.readJson(this.eventsPath, []);
    const queried = queryEvents(events, {
      eventId: options.eventId,
      source: options.source,
      type: options.type
    });
    const offset = decodeLocalJsonEventCursor(options.cursor, options);
    const limit = normalizeEventPageLimit(options.limit);
    const pageEvents = queried.slice(offset, offset + limit);
    const nextOffset = offset + pageEvents.length;
    const hasMore = nextOffset < queried.length;
    return {
      events: pageEvents,
      cursor: options.cursor,
      nextCursor: hasMore ? encodeLocalJsonEventCursor(nextOffset, options) : undefined,
      hasMore
    };
  }
  async findEventByIdentity(identity) {
    const events = await this.listEvents();
    return findEventByIdentity(events, identity);
  }
  async appendDelivery(result) {
    await this.init();
    const deliveries = await this.readJson(this.deliveriesPath, []);
    deliveries.push(result);
    await this.writeJson(this.deliveriesPath, deliveries);
    return result;
  }
  async listDeliveries() {
    await this.init();
    return this.readJson(this.deliveriesPath, []);
  }
  async exportData() {
    return {
      channels: await this.listChannels(),
      events: await this.listEvents(),
      deliveries: await this.listDeliveries()
    };
  }
  async ensureArrayFile(path) {
    if (!existsSync2(path)) {
      await writeFile(path, `[]
`, { encoding: "utf-8", mode: 384 });
    }
    await chmod(path, 384).catch(() => {
      return;
    });
  }
  async readJson(path, fallback) {
    try {
      const raw = await readFile(path, "utf-8");
      if (!raw.trim())
        return fallback;
      return JSON.parse(raw);
    } catch (error) {
      if (error.code === "ENOENT")
        return fallback;
      throw error;
    }
  }
  async writeJson(path, value) {
    const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}
`, { encoding: "utf-8", mode: 384 });
    await rename(tempPath, path);
    await chmod(path, 384).catch(() => {
      return;
    });
  }
}
function localJsonRuntime(dataDir2 = getEventsDataDir()) {
  return {
    mode: "local-files",
    name: "json-events-store",
    remote: false,
    localFiles: true,
    localSqlite: false,
    postgres: false,
    s3: false,
    aws: false,
    durable: true,
    idempotency: "best-effort-local",
    replayCursors: true,
    description: `Local JSON files in ${dataDir2}; no SQLite, Postgres, S3, or AWS runtime is configured by this store.`
  };
}
function encodeLocalJsonEventCursor(offset, options = {}) {
  if (!Number.isInteger(offset) || offset < 0)
    throw new Error(`Invalid event cursor offset: ${offset}`);
  const payload = {
    offset,
    eventId: options.eventId,
    source: options.source,
    type: options.type
  };
  return `${LOCAL_JSON_EVENT_CURSOR_PREFIX}${Buffer2.from(JSON.stringify(payload), "utf-8").toString("base64url")}`;
}
function decodeLocalJsonEventCursor(cursor, options = {}) {
  if (!cursor)
    return 0;
  if (!cursor.startsWith(LOCAL_JSON_EVENT_CURSOR_PREFIX))
    throw new Error(`Invalid local JSON event cursor: ${cursor}`);
  const rawPayload = cursor.slice(LOCAL_JSON_EVENT_CURSOR_PREFIX.length);
  let payload;
  try {
    payload = JSON.parse(Buffer2.from(rawPayload, "base64url").toString("utf-8"));
  } catch {
    throw new Error(`Invalid local JSON event cursor: ${cursor}`);
  }
  const offset = payload.offset;
  if (!Number.isInteger(offset) || offset < 0)
    throw new Error(`Invalid local JSON event cursor: ${cursor}`);
  assertCursorFilter("eventId", payload.eventId, options.eventId);
  assertCursorFilter("source", payload.source, options.source);
  assertCursorFilter("type", payload.type, options.type);
  return offset;
}
function normalizeEventPageLimit(limit) {
  if (limit === undefined)
    return DEFAULT_EVENT_PAGE_LIMIT;
  if (!Number.isInteger(limit) || limit < 1)
    throw new Error(`Event page limit must be a positive integer, got ${limit}`);
  return Math.min(limit, MAX_EVENT_PAGE_LIMIT);
}
function queryEvents(events, options) {
  let rows = events;
  if (options.eventId)
    rows = rows.filter((event) => event.id === options.eventId);
  if (options.source)
    rows = rows.filter((event) => event.source === options.source);
  if (options.type)
    rows = rows.filter((event) => event.type === options.type);
  if (options.cursor) {
    const offset = decodeLocalJsonEventCursor(options.cursor, options);
    rows = rows.slice(offset);
  }
  if (options.limit !== undefined)
    rows = rows.slice(0, normalizeEventPageLimit(options.limit));
  return rows;
}
function assertCursorFilter(name, cursorValue, optionValue) {
  if (cursorValue !== optionValue)
    throw new Error(`Local JSON event cursor ${name} filter mismatch`);
}
function findEventByIdentity(events, identity) {
  return events.find((event) => identity.id !== undefined && event.id === identity.id || identity.dedupeKey !== undefined && event.dedupeKey === identity.dedupeKey);
}
async function getEventsStatus(dataDir2) {
  const store = new JsonEventsStore(dataDir2);
  await store.init();
  const [channels, events, deliveries] = await Promise.all([
    store.listChannels(),
    store.listEvents(),
    store.listDeliveries()
  ]);
  const transports = channels.reduce((counts, channel) => {
    counts[channel.transport] = (counts[channel.transport] ?? 0) + 1;
    return counts;
  }, {});
  return {
    service: "events",
    schemaVersion: "1.0",
    dataDir: store.dataDir,
    storage: store.runtime,
    env: {
      primary: HASNA_EVENTS_DIR_ENV,
      fallback: HASNA_EVENTS_HOME_ENV,
      active: getActiveEventsDirEnv()
    },
    files: {
      channels: statusFile(store.dataDir, "channels.json", channels.length),
      events: statusFile(store.dataDir, "events.json", events.length),
      deliveries: statusFile(store.dataDir, "deliveries.json", deliveries.length)
    },
    counts: {
      channels: channels.length,
      enabledChannels: channels.filter((channel) => channel.enabled).length,
      disabledChannels: channels.filter((channel) => !channel.enabled).length,
      events: events.length,
      deliveries: deliveries.length
    },
    transports,
    safety: {
      includesEventPayloads: false,
      includesWebhookSecrets: false,
      listOutputsRedactSecrets: true,
      statusOutputIsMetadataOnly: true
    }
  };
}
function statusFile(dataDir2, fileName, records) {
  const path = join2(dataDir2, fileName);
  return { path, exists: existsSync2(path), records };
}

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
  return new Promise((resolve2, reject) => {
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
        resolve2(new Response(Buffer.concat(chunks), { status: response.statusCode ?? 200, headers: headersRecord }));
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
  return new Promise((resolve2) => {
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
      resolve2({
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
      resolve2({
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

// src/catalog.ts
class EventValidationError extends Error {
  eventType;
  issues;
  constructor(eventType, issues) {
    const detail = issues.map((issue) => `${issue.path || "<root>"}: ${issue.message}`).join("; ");
    super(`Event validation failed for type "${eventType}": ${detail}`);
    this.name = "EventValidationError";
    this.eventType = eventType;
    this.issues = issues;
  }
}

class EventTypeCatalog {
  definitions = new Map;
  register(definition) {
    this.definitions.set(definition.type, definition);
    return this;
  }
  unregister(type) {
    return this.definitions.delete(type);
  }
  has(type) {
    return this.definitions.has(type);
  }
  get(type) {
    return this.definitions.get(type);
  }
  list() {
    return [...this.definitions.values()];
  }
  validateEvent(event) {
    const definition = this.definitions.get(event.type);
    if (!definition)
      return { ok: true };
    return definition.validate(event.data, event);
  }
  assertEventValid(event) {
    const result = this.validateEvent(event);
    if (!result.ok) {
      throw new EventValidationError(event.type, result.issues);
    }
  }
}
var defaultEventTypeCatalog = new EventTypeCatalog;
var DISTRIBUTION_EVENT_TYPES = {
  releasePublished: "release.published",
  rolloutStarted: "release.rollout.started",
  rolloutCompleted: "release.rollout.completed",
  rolloutFailed: "release.rollout.failed",
  appInstalled: "app.installed",
  announcementSent: "announcement.sent",
  feedbackCreated: "feedback.created",
  feedbackTriaged: "feedback.triaged"
};
var DISTRIBUTION_EVENT_CONTRACT_SCHEMAS = {
  "release.published": "hasna.release.v1",
  "release.rollout.started": "hasna.rollout_record.v1",
  "release.rollout.completed": "hasna.rollout_record.v1",
  "release.rollout.failed": "hasna.rollout_record.v1",
  "app.installed": "hasna.rollout_record.v1",
  "announcement.sent": "hasna.announcement.v1",
  "feedback.created": "hasna.feedback.v1",
  "feedback.triaged": "hasna.feedback.v1"
};
var PUBLISH_PATHS = ["skill", "ci", "backfilled"];
var ROLLOUT_ACTIONS = ["install", "update", "rollback", "freeze-blocked"];
function requireString(data, key, issues) {
  const value = data[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push({ path: key, message: "must be a non-empty string" });
  }
}
function optionalString(data, key, issues) {
  const value = data[key];
  if (value !== undefined && (typeof value !== "string" || value.trim().length === 0)) {
    issues.push({ path: key, message: "must be a non-empty string when present" });
  }
}
function optionalEnum(data, key, allowed, issues) {
  const value = data[key];
  if (value !== undefined && (typeof value !== "string" || !allowed.includes(value))) {
    issues.push({ path: key, message: `must be one of: ${allowed.join(", ")}` });
  }
}
function optionalStringArray(data, key, issues) {
  const value = data[key];
  if (value === undefined)
    return;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.trim().length === 0)) {
    issues.push({ path: key, message: "must be an array of non-empty strings when present" });
  }
}
function toResult(issues) {
  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}
var validateReleasePublishedData = (data) => {
  const issues = [];
  requireString(data, "appId", issues);
  requireString(data, "package", issues);
  requireString(data, "version", issues);
  optionalString(data, "gitSha", issues);
  optionalString(data, "publishedAt", issues);
  optionalEnum(data, "publishPath", PUBLISH_PATHS, issues);
  return toResult(issues);
};
var validateRolloutData = (data, event) => {
  const issues = [];
  requireString(data, "appId", issues);
  requireString(data, "package", issues);
  requireString(data, "version", issues);
  requireString(data, "machine", issues);
  optionalEnum(data, "action", ROLLOUT_ACTIONS, issues);
  if (event.type === "release.rollout.completed" || event.type === "release.rollout.failed") {
    requireString(data, "result", issues);
  }
  return toResult(issues);
};
var validateAppInstalledData = (data) => {
  const issues = [];
  requireString(data, "appId", issues);
  requireString(data, "package", issues);
  requireString(data, "version", issues);
  requireString(data, "machine", issues);
  return toResult(issues);
};
var validateAnnouncementSentData = (data) => {
  const issues = [];
  requireString(data, "campaignId", issues);
  optionalString(data, "appId", issues);
  optionalString(data, "audienceId", issues);
  optionalString(data, "releaseId", issues);
  optionalStringArray(data, "channels", issues);
  return toResult(issues);
};
var validateFeedbackCreatedData = (data) => {
  const issues = [];
  requireString(data, "feedbackId", issues);
  optionalString(data, "appId", issues);
  optionalString(data, "source", issues);
  optionalString(data, "summary", issues);
  return toResult(issues);
};
var validateFeedbackTriagedData = (data) => {
  const issues = [];
  requireString(data, "feedbackId", issues);
  requireString(data, "disposition", issues);
  optionalString(data, "appId", issues);
  optionalString(data, "triagedBy", issues);
  return toResult(issues);
};
function createDistributionEventDefinitions() {
  const bind = (type, validate, description) => ({
    type,
    contractSchemaId: DISTRIBUTION_EVENT_CONTRACT_SCHEMAS[type],
    description,
    validate
  });
  return [
    bind("release.published", validateReleasePublishedData, "A package version was published"),
    bind("release.rollout.started", validateRolloutData, "A rollout of a release to a machine started"),
    bind("release.rollout.completed", validateRolloutData, "A rollout of a release to a machine completed"),
    bind("release.rollout.failed", validateRolloutData, "A rollout of a release to a machine failed"),
    bind("app.installed", validateAppInstalledData, "An app was installed on a machine"),
    bind("announcement.sent", validateAnnouncementSentData, "An announcement campaign was sent"),
    bind("feedback.created", validateFeedbackCreatedData, "User or agent feedback was captured"),
    bind("feedback.triaged", validateFeedbackTriagedData, "Captured feedback was triaged")
  ];
}
function registerDistributionEventTypes(catalog = defaultEventTypeCatalog) {
  for (const definition of createDistributionEventDefinitions()) {
    catalog.register(definition);
  }
  return catalog;
}
// src/app-event.ts
var APP_EVENT_V1_SCHEMA_VERSION = "hasna.app_event.v1";
var APP_EVENT_V1_METADATA_KEY = "app_event";
var APP_EVENT_V1_MAX_SUMMARY_LENGTH = 512;
var APP_EVENT_V1_MAX_DATA_BYTES = 32 * 1024;
var APP_EVENT_V1_MAX_REFS = 32;
var APP_EVENT_V1_MAX_TARGETS = 16;

class AppEventValidationError extends Error {
  issues;
  constructor(issues) {
    super(`Invalid ${APP_EVENT_V1_SCHEMA_VERSION}: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`);
    this.name = "AppEventValidationError";
    this.issues = issues;
  }
}

class AppEventReplaySafetyError extends Error {
  eventId;
  constructor(eventId) {
    super(`App event ${eventId} is not marked replay-safe`);
    this.name = "AppEventReplaySafetyError";
    this.eventId = eventId;
  }
}
var SEVERITIES = ["debug", "info", "notice", "warning", "error", "critical"];
var ACTOR_KINDS = ["agent", "human", "service", "model", "workflow", "system"];
var SENSITIVITIES = ["public", "internal", "confidential", "restricted"];
var REDACTION_STATES = ["none", "partial", "full"];
var DELIVERY_INTENTS = ["notification", "state_sync", "audit", "command"];
var DELIVERY_MODES = ["at_most_once", "at_least_once"];
function validateAppEventV1(value) {
  const issues = [];
  if (!isRecord(value))
    return { ok: false, issues: [{ path: "<root>", message: "must be an object" }] };
  rejectUnknownKeys(value, [
    "event_id",
    "event_type",
    "schema_version",
    "source",
    "occurred_at",
    "severity",
    "idempotency",
    "correlation",
    "subject",
    "actor",
    "project_mappings",
    "summary",
    "data",
    "resource_refs",
    "evidence_refs",
    "sensitivity",
    "redaction",
    "delivery"
  ], "", issues);
  requireString2(value, "event_id", "event_id", issues, 200);
  requireString2(value, "event_type", "event_type", issues, 200);
  if (value.schema_version !== APP_EVENT_V1_SCHEMA_VERSION) {
    issues.push({ path: "schema_version", message: `must equal ${APP_EVENT_V1_SCHEMA_VERSION}` });
  }
  requireTimestamp(value, "occurred_at", issues);
  requireEnum(value, "severity", SEVERITIES, "severity", issues);
  requireString2(value, "summary", "summary", issues, APP_EVENT_V1_MAX_SUMMARY_LENGTH);
  const source = requireRecord(value, "source", issues);
  if (source) {
    rejectUnknownKeys(source, ["app", "version", "machine"], "source", issues);
    requireString2(source, "app", "source.app", issues, 200);
    requireString2(source, "version", "source.version", issues, 100);
    requireString2(source, "machine", "source.machine", issues, 200);
  }
  const idempotency = requireRecord(value, "idempotency", issues);
  if (idempotency) {
    rejectUnknownKeys(idempotency, ["dedupe_key", "replay_safe", "replay_of_event_id"], "idempotency", issues);
    requireString2(idempotency, "dedupe_key", "idempotency.dedupe_key", issues, 512);
    requireBoolean(idempotency, "replay_safe", "idempotency.replay_safe", issues);
    optionalString2(idempotency, "replay_of_event_id", "idempotency.replay_of_event_id", issues, 200);
    if (idempotency.replay_of_event_id === value.event_id) {
      issues.push({ path: "idempotency.replay_of_event_id", message: "must not reference the event itself" });
    }
  }
  const correlation = requireRecord(value, "correlation", issues);
  if (correlation) {
    rejectUnknownKeys(correlation, ["correlation_id", "causation_id", "trace_id"], "correlation", issues);
    requireString2(correlation, "correlation_id", "correlation.correlation_id", issues, 200);
    optionalString2(correlation, "causation_id", "correlation.causation_id", issues, 200);
    optionalString2(correlation, "trace_id", "correlation.trace_id", issues, 200);
  }
  validateSubject(value, issues);
  validateActor(value, issues);
  validateProjectMappings(value, issues);
  validateData(value.data, issues);
  validateResourceRefs(value.resource_refs, issues);
  validateEvidenceRefs(value.evidence_refs, issues);
  validateSensitivity(value, issues);
  validateRedaction(value, issues);
  validateDelivery(value, issues);
  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}
function assertAppEventV1(value) {
  const result = validateAppEventV1(value);
  if (!result.ok)
    throw new AppEventValidationError(result.issues);
}
function assertAppEventV1ReplaySafe(event) {
  assertAppEventV1(event);
  if (!event.idempotency.replay_safe)
    throw new AppEventReplaySafetyError(event.event_id);
}
function appEventV1ReplayIdentity(event) {
  assertAppEventV1ReplaySafe(event);
  return { eventId: event.event_id, dedupeKey: event.idempotency.dedupe_key };
}
function appEventV1ToEventInput(event) {
  assertAppEventV1(event);
  const metadata = {
    profile: APP_EVENT_V1_SCHEMA_VERSION,
    source_version: event.source.version,
    source_machine: event.source.machine,
    replay_safe: event.idempotency.replay_safe,
    replay_of_event_id: event.idempotency.replay_of_event_id,
    correlation: structuredClone(event.correlation),
    subject: structuredClone(event.subject),
    actor: structuredClone(event.actor),
    project_mappings: structuredClone(event.project_mappings),
    resource_refs: structuredClone(event.resource_refs),
    evidence_refs: structuredClone(event.evidence_refs),
    sensitivity: structuredClone(event.sensitivity),
    redaction: structuredClone(event.redaction),
    delivery: structuredClone(event.delivery)
  };
  return {
    id: event.event_id,
    source: event.source.app,
    type: event.event_type,
    time: event.occurred_at,
    subject: event.subject.uri ?? `${event.subject.kind}:${event.subject.id}`,
    severity: event.severity,
    data: structuredClone(event.data),
    message: event.summary,
    dedupeKey: event.idempotency.dedupe_key,
    schemaVersion: APP_EVENT_V1_SCHEMA_VERSION,
    metadata: { [APP_EVENT_V1_METADATA_KEY]: metadata }
  };
}
function appEventV1FromEventEnvelope(envelope) {
  const metadata = envelope.metadata[APP_EVENT_V1_METADATA_KEY];
  if (!isRecord(metadata) || metadata.profile !== APP_EVENT_V1_SCHEMA_VERSION) {
    throw new AppEventValidationError([{
      path: `metadata.${APP_EVENT_V1_METADATA_KEY}.profile`,
      message: `must equal ${APP_EVENT_V1_SCHEMA_VERSION}`
    }]);
  }
  const event = {
    event_id: envelope.id,
    event_type: envelope.type,
    schema_version: envelope.schemaVersion,
    source: {
      app: envelope.source,
      version: metadata.source_version,
      machine: metadata.source_machine
    },
    occurred_at: envelope.time,
    severity: envelope.severity,
    idempotency: {
      dedupe_key: envelope.dedupeKey,
      replay_safe: metadata.replay_safe,
      replay_of_event_id: metadata.replay_of_event_id
    },
    correlation: metadata.correlation,
    subject: metadata.subject,
    actor: metadata.actor,
    project_mappings: metadata.project_mappings,
    summary: envelope.message,
    data: structuredClone(envelope.data),
    resource_refs: metadata.resource_refs,
    evidence_refs: metadata.evidence_refs,
    sensitivity: metadata.sensitivity,
    redaction: metadata.redaction,
    delivery: metadata.delivery
  };
  assertAppEventV1(event);
  return structuredClone(event);
}
function validateSubject(value, issues) {
  const subject = requireRecord(value, "subject", issues);
  if (!subject)
    return;
  rejectUnknownKeys(subject, ["kind", "id", "uri"], "subject", issues);
  requireString2(subject, "kind", "subject.kind", issues, 100);
  requireString2(subject, "id", "subject.id", issues, 200);
  optionalString2(subject, "uri", "subject.uri", issues, 2048);
}
function validateActor(value, issues) {
  const actor = requireRecord(value, "actor", issues);
  if (!actor)
    return;
  rejectUnknownKeys(actor, ["kind", "id", "name"], "actor", issues);
  requireEnum(actor, "kind", ACTOR_KINDS, "actor.kind", issues);
  requireString2(actor, "id", "actor.id", issues, 200);
  optionalString2(actor, "name", "actor.name", issues, 200);
}
function validateProjectMappings(value, issues) {
  const project = requireRecord(value, "project_mappings", issues);
  if (!project)
    return;
  rejectUnknownKeys(project, ["canonical_id", "slug", "repository", "workspace", "external_ids"], "project_mappings", issues);
  requireString2(project, "canonical_id", "project_mappings.canonical_id", issues, 200);
  optionalString2(project, "slug", "project_mappings.slug", issues, 200);
  optionalString2(project, "repository", "project_mappings.repository", issues, 2048);
  optionalString2(project, "workspace", "project_mappings.workspace", issues, 2048);
  const externalIds = requireRecord(project, "external_ids", issues, "project_mappings.external_ids");
  if (externalIds) {
    if (Object.keys(externalIds).length > APP_EVENT_V1_MAX_TARGETS) {
      issues.push({ path: "project_mappings.external_ids", message: `must have at most ${APP_EVENT_V1_MAX_TARGETS} entries` });
    }
    for (const [key, entry] of Object.entries(externalIds)) {
      if (!key.trim() || typeof entry !== "string" || !entry.trim()) {
        issues.push({ path: `project_mappings.external_ids.${key}`, message: "keys and values must be non-empty strings" });
      }
    }
  }
}
function validateData(value, issues) {
  if (!isRecord(value)) {
    issues.push({ path: "data", message: "must be an object" });
    return;
  }
  try {
    const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
    if (bytes > APP_EVENT_V1_MAX_DATA_BYTES) {
      issues.push({ path: "data", message: `must serialize to at most ${APP_EVENT_V1_MAX_DATA_BYTES} UTF-8 bytes` });
    }
  } catch {
    issues.push({ path: "data", message: "must be JSON serializable" });
  }
}
function validateResourceRefs(value, issues) {
  validateRefArray(value, "resource_refs", issues, (ref, path) => {
    rejectUnknownKeys(ref, ["kind", "id", "uri", "source_package", "external_id"], path, issues);
    requireString2(ref, "kind", `${path}.kind`, issues, 100);
    requireString2(ref, "id", `${path}.id`, issues, 200);
    optionalString2(ref, "uri", `${path}.uri`, issues, 2048);
    optionalString2(ref, "source_package", `${path}.source_package`, issues, 200);
    optionalString2(ref, "external_id", `${path}.external_id`, issues, 200);
  });
}
function validateEvidenceRefs(value, issues) {
  validateRefArray(value, "evidence_refs", issues, (ref, path) => {
    rejectUnknownKeys(ref, ["kind", "id", "uri", "sha256", "redaction"], path, issues);
    requireString2(ref, "kind", `${path}.kind`, issues, 100);
    requireString2(ref, "id", `${path}.id`, issues, 200);
    requireString2(ref, "uri", `${path}.uri`, issues, 2048);
    optionalString2(ref, "sha256", `${path}.sha256`, issues, 64);
    if (typeof ref.sha256 === "string" && !/^[a-f0-9]{64}$/i.test(ref.sha256)) {
      issues.push({ path: `${path}.sha256`, message: "must be a 64-character hexadecimal digest" });
    }
    requireEnum(ref, "redaction", REDACTION_STATES, `${path}.redaction`, issues);
  });
}
function validateSensitivity(value, issues) {
  const sensitivity = requireRecord(value, "sensitivity", issues);
  if (!sensitivity)
    return;
  rejectUnknownKeys(sensitivity, ["classification", "contains_personal_data"], "sensitivity", issues);
  requireEnum(sensitivity, "classification", SENSITIVITIES, "sensitivity.classification", issues);
  requireBoolean(sensitivity, "contains_personal_data", "sensitivity.contains_personal_data", issues);
}
function validateRedaction(value, issues) {
  const redaction = requireRecord(value, "redaction", issues);
  if (!redaction)
    return;
  rejectUnknownKeys(redaction, ["state", "fields", "safe_for_logs"], "redaction", issues);
  requireEnum(redaction, "state", REDACTION_STATES, "redaction.state", issues);
  validateStringArray(redaction.fields, "redaction.fields", APP_EVENT_V1_MAX_REFS, issues, true);
  requireBoolean(redaction, "safe_for_logs", "redaction.safe_for_logs", issues);
  if (redaction.state === "none" && Array.isArray(redaction.fields) && redaction.fields.length > 0) {
    issues.push({ path: "redaction.fields", message: "must be empty when redaction.state is none" });
  }
}
function validateDelivery(value, issues) {
  const delivery = requireRecord(value, "delivery", issues);
  if (!delivery)
    return;
  rejectUnknownKeys(delivery, ["intent", "mode", "targets", "agent_conversation_injection"], "delivery", issues);
  requireEnum(delivery, "intent", DELIVERY_INTENTS, "delivery.intent", issues);
  requireEnum(delivery, "mode", DELIVERY_MODES, "delivery.mode", issues);
  validateStringArray(delivery.targets, "delivery.targets", APP_EVENT_V1_MAX_TARGETS, issues, false);
  if (delivery.agent_conversation_injection !== false) {
    issues.push({ path: "delivery.agent_conversation_injection", message: "must be false" });
  }
}
function validateRefArray(value, path, issues, validate) {
  if (!Array.isArray(value)) {
    issues.push({ path, message: "must be an array" });
    return;
  }
  if (value.length > APP_EVENT_V1_MAX_REFS) {
    issues.push({ path, message: `must contain at most ${APP_EVENT_V1_MAX_REFS} entries` });
  }
  value.forEach((entry, index) => {
    if (!isRecord(entry))
      issues.push({ path: `${path}.${index}`, message: "must be an object" });
    else
      validate(entry, `${path}.${index}`);
  });
}
function validateStringArray(value, path, maxItems, issues, allowEmpty) {
  if (!Array.isArray(value)) {
    issues.push({ path, message: "must be an array" });
    return;
  }
  if (!allowEmpty && value.length === 0)
    issues.push({ path, message: "must contain at least one entry" });
  if (value.length > maxItems)
    issues.push({ path, message: `must contain at most ${maxItems} entries` });
  value.forEach((entry, index) => {
    if (typeof entry !== "string" || !entry.trim()) {
      issues.push({ path: `${path}.${index}`, message: "must be a non-empty string" });
    }
  });
}
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function rejectUnknownKeys(value, allowed, path, issues) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key))
      issues.push({ path: path ? `${path}.${key}` : key, message: "is not allowed" });
  }
}
function requireRecord(value, key, issues, path = key) {
  const entry = value[key];
  if (!isRecord(entry)) {
    issues.push({ path, message: "must be an object" });
    return;
  }
  return entry;
}
function requireString2(value, key, path, issues, maxLength) {
  const entry = value[key];
  if (typeof entry !== "string" || !entry.trim())
    issues.push({ path, message: "must be a non-empty string" });
  else if (entry.length > maxLength)
    issues.push({ path, message: `must have at most ${maxLength} characters` });
}
function optionalString2(value, key, path, issues, maxLength) {
  if (value[key] === undefined)
    return;
  requireString2(value, key, path, issues, maxLength);
}
function requireBoolean(value, key, path, issues) {
  if (typeof value[key] !== "boolean")
    issues.push({ path, message: "must be a boolean" });
}
function requireEnum(value, key, allowed, path, issues) {
  if (typeof value[key] !== "string" || !allowed.includes(value[key])) {
    issues.push({ path, message: `must be one of: ${allowed.join(", ")}` });
  }
}
function requireTimestamp(value, key, issues) {
  const entry = value[key];
  if (typeof entry !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(entry) || Number.isNaN(Date.parse(entry))) {
    issues.push({ path: key, message: "must be an RFC 3339 date-time" });
  }
}

// src/index.ts
import { randomUUID as randomUUID2 } from "crypto";

// src/redaction.ts
function redactPaths(event, paths, replacement = "[REDACTED]") {
  if (paths.length === 0)
    return event;
  const copy = structuredClone(event);
  for (const path of paths) {
    setPath(copy, path, replacement);
  }
  return copy;
}
function redactSensitiveKeys(event, replacement = "[REDACTED]") {
  return redactValue(event, replacement);
}
function shouldRedactKey(key) {
  return /secret|token|password|api[_-]?key|authorization/i.test(key);
}
function redactValue(value, replacement) {
  if (Array.isArray(value))
    return value.map((item) => redactValue(item, replacement));
  if (!value || typeof value !== "object")
    return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    shouldRedactKey(key) ? replacement : redactValue(item, replacement)
  ]));
}
function setPath(input, path, replacement) {
  const parts = path.split(".");
  let cursor = input;
  for (const part of parts.slice(0, -1)) {
    const next = cursor[part];
    if (!next || typeof next !== "object")
      return;
    cursor = next;
  }
  const last = parts.at(-1);
  if (last && last in cursor)
    cursor[last] = replacement;
}
// ../contracts/dist/client/transport.js
import { isIP as isIP2 } from "net";
import { spawnSync } from "child_process";
import { closeSync, fstatSync, openSync, readFileSync } from "fs";
import { O_NOFOLLOW, O_NONBLOCK, O_RDONLY } from "constants";
import { createRequire } from "module";
import { hostname as osHostname } from "os";
import { isAbsolute, join as join3 } from "path";
function envToken(name) {
  return name.toUpperCase().replace(/-/g, "_");
}
function clientTransportEnvKeys(name) {
  const envSegment = envToken(name);
  return {
    apiUrlKeys: [`HASNA_${envSegment}_API_URL`, `${envSegment}_API_URL`],
    apiKeyKeys: [`HASNA_${envSegment}_API_KEY`, `${envSegment}_API_KEY`]
  };
}
function credentialOverrideEnvKey(name) {
  return `HASNA_${envToken(name)}_API_KEY_OVERRIDE`;
}
var CREDENTIAL_PROFILE_ENV_KEY = "HASNA_PROFILE";
function credentialPointerEnvKey(name) {
  return `HASNA_${envToken(name)}_API_KEY_REF`;
}

class CredentialResolutionError extends Error {
  appName;
  attempted;
  constructor(appName, message, attempted) {
    super(message);
    this.name = "CredentialResolutionError";
    this.appName = appName;
    this.attempted = attempted;
  }
}

class CredentialFileUnsafeError extends Error {
  path;
  constructor(path, reason) {
    super(`Refusing unsafe credential/config file ${path}: ${reason}.`);
    this.name = "CredentialFileUnsafeError";
    this.path = path;
  }
}
var HASNA_HOME_ENV_KEY = "HASNA_HOME";
var HASNA_CONFIG_HOME_ENV_KEY = "HASNA_CONFIG_HOME";
var KEYCHAIN_STATION_ENV_KEY = "HASNA_STATION";
var HASNA_HOME_DIR = ".hasna";
var CONFIG_SUBDIR = "config";
var CREDENTIALS_FILE = "credentials";
var KEYCHAIN_SECURITY_BIN = "/usr/bin/security";
var KEYCHAIN_SERVICE_PREFIX = "hasna.credentials";
var KEYCHAIN_ITEM_NOT_FOUND_STATUS = 44;
var KEYCHAIN_SPAWN_TIMEOUT_MS = 1e4;
var MAX_CREDENTIAL_FILE_BYTES = 64 * 1024;
var SAFE_APP_SLUG = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
var SAFE_PROFILE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
var ILLEGAL_IN_HEADER_VALUE = /[^\t\x20-\x7e]/;
var VAULT_POINTER_SHAPE = /^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-_.]*){2,}$/;
function homeDir(env) {
  const home = env.HOME?.trim();
  return home ? home : null;
}
function absoluteOverride(env, key) {
  const value = env[key]?.trim();
  return value && isAbsolute(value) ? value : null;
}
function hasnaHomeDir(env) {
  const override = absoluteOverride(env, HASNA_HOME_ENV_KEY);
  if (override)
    return override;
  const home = homeDir(env);
  return home ? join3(home, HASNA_HOME_DIR) : null;
}
function appConfigDir(name, env) {
  const configRoot = absoluteOverride(env, HASNA_CONFIG_HOME_ENV_KEY);
  if (configRoot)
    return join3(configRoot, name);
  const root = hasnaHomeDir(env);
  return root ? join3(root, name, CONFIG_SUBDIR) : null;
}
function credentialDiskSourceList(name, env, profile = null) {
  if (!SAFE_APP_SLUG.test(name))
    return [];
  const directory = appConfigDir(name, env);
  if (!directory)
    return [];
  const file = profile ? `${CREDENTIALS_FILE}-${profile}` : CREDENTIALS_FILE;
  return [{ path: join3(directory, file), tier: "disk" }];
}
function credentialDiskSources(name, env) {
  return credentialDiskSourceList(name, env, null).map((s) => s.path);
}
function profileDiskSources(name, env, profile) {
  return credentialDiskSourceList(name, env, profile).map((s) => s.path);
}
function parseEnvFile(text) {
  const values = new Map;
  const unusable = new Set;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#"))
      continue;
    const withoutExport = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const equals = withoutExport.indexOf("=");
    if (equals <= 0)
      continue;
    const key = withoutExport.slice(0, equals).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
      continue;
    let value = withoutExport.slice(equals + 1).trim();
    const quote = value[0];
    if (quote === '"' || quote === "'") {
      if (value.length < 2 || !value.endsWith(quote)) {
        unusable.add(key);
        continue;
      }
      value = value.slice(1, -1);
    }
    if (value.trim().length === 0) {
      unusable.add(key);
      continue;
    }
    if (values.has(key) && values.get(key) !== value)
      unusable.add(key);
    values.set(key, value);
  }
  return { values, unusable };
}
function configFileModeAllowed(mode) {
  const permissions = mode & 4095;
  return permissions === 256 || permissions === 384;
}
function configFileReadsCoherent(before, after) {
  return before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs;
}
function readAppConfigFile(path) {
  const unsafe = (reason) => {
    throw new CredentialFileUnsafeError(path, reason);
  };
  let fd = -1;
  try {
    fd = openSync(path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
  } catch (error) {
    const code = error.code;
    if (code === "ENOENT" || code === "ENOTDIR")
      return null;
    if (code === "ELOOP")
      unsafe("the path is a symlink");
    unsafe(`the path could not be opened (${code ?? "unknown error"})`);
  }
  try {
    const before = fstatSync(fd);
    if (!before.isFile())
      unsafe("the path is not a regular file");
    if (!configFileModeAllowed(before.mode)) {
      unsafe(`permission mode ${(before.mode & 4095).toString(8).padStart(4, "0")} is not owner-only 0400 or 0600`);
    }
    const uid = process.getuid?.() ?? process.geteuid?.();
    if (uid !== undefined && before.uid !== uid)
      unsafe("the file is not owned by the current user");
    if (before.size > MAX_CREDENTIAL_FILE_BYTES)
      unsafe("the file exceeds the size limit");
    const bytes = readFileSync(fd);
    const after = fstatSync(fd);
    if (!configFileReadsCoherent(before, after)) {
      unsafe("the file changed while being read");
    }
    return parseEnvFile(bytes.toString("utf8"));
  } finally {
    if (fd !== -1)
      closeSync(fd);
  }
}
function readCredentialFile(path, apiKeyKeys) {
  const parsed = readAppConfigFile(path);
  if (!parsed)
    return null;
  for (const key of apiKeyKeys) {
    if (parsed.unusable.has(key)) {
      throw new CredentialFileUnsafeError(path, `${key} is declared but blank or malformed`);
    }
  }
  const values = apiKeyKeys.map((key) => parsed.values.get(key)?.trim()).filter((value) => Boolean(value));
  if (new Set(values).size > 1) {
    throw new CredentialFileUnsafeError(path, "credential aliases disagree");
  }
  return values[0] ?? null;
}
var CREDENTIAL_SHAPED_KEY = /(?:^|_)(?:API_KEY|KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH)(?:_|$)/;
function appConfigDiskValue(name, env, keys) {
  const wanted = keys.filter((key) => !CREDENTIAL_SHAPED_KEY.test(key));
  if (wanted.length === 0)
    return null;
  for (const path of credentialDiskSources(name, env)) {
    const parsed = readAppConfigFile(path);
    if (!parsed)
      continue;
    if (wanted.some((key) => parsed.unusable.has(key))) {
      return { key: wanted.find((key) => parsed.unusable.has(key)), value: "", path, unusable: true };
    }
    const values = wanted.map((key) => parsed.values.get(key)?.trim()).filter((value) => Boolean(value));
    if (new Set(values).size > 1)
      throw new CredentialFileUnsafeError(path, "configuration aliases disagree");
    for (const key of wanted) {
      if (parsed.unusable.has(key))
        return { key, value: "", path, unusable: true };
      const value = parsed.values.get(key)?.trim();
      if (value)
        return { key, value, path };
    }
  }
  return null;
}
function assertUsableCredential(appName, source, value) {
  if (VAULT_POINTER_SHAPE.test(value)) {
    throw new CredentialResolutionError(appName, `The credential from ${source} looks like a secrets-vault pointer (a path-shaped reference like ` + `'namespace/app/live/api_key'). A vault path is NEVER accepted as a literal API key. ` + `Use ${credentialPointerEnvKey(appName)} to resolve the key through the vault, or provide the actual key value.`, [source]);
  }
  if (!ILLEGAL_IN_HEADER_VALUE.test(value))
    return;
  throw new CredentialResolutionError(appName, `The credential from ${source} contains characters that cannot be sent in an HTTP header ` + `(a control character or non-ASCII byte). A file written with CR-only line endings is the usual ` + `cause. Rewrite that credential file with one LF-terminated KEY=value line. ` + `The value is not shown here, and is deliberately never logged.`, [source]);
}
var INSPECT_CUSTOM = Symbol.for("nodejs.util.inspect.custom");
var CREDENTIAL_SEAL = Symbol.for("hasna:contracts:sealedCredential");
var CALLER_SUPPLIED_CREDENTIAL_PROVIDER_SOURCE = "caller-supplied CredentialProvider";
function sealCredential(fields) {
  const { apiKey } = fields;
  const visible = {
    tier: fields.tier,
    source: fields.source,
    deliberate: fields.deliberate,
    diskCandidates: Object.freeze([...fields.diskCandidates]),
    warning: fields.warning
  };
  const sealed = { ...visible };
  Object.defineProperty(sealed, "apiKey", {
    value: apiKey,
    enumerable: false,
    writable: false,
    configurable: false
  });
  if (fields.pointerVaultKey !== undefined) {
    Object.defineProperty(sealed, "pointerVaultKey", {
      value: fields.pointerVaultKey,
      enumerable: false,
      writable: false,
      configurable: false
    });
  }
  Object.defineProperty(sealed, INSPECT_CUSTOM, {
    value: () => ({ ...visible, apiKey: "[redacted]" }),
    enumerable: false,
    writable: false,
    configurable: false
  });
  Object.defineProperty(sealed, CREDENTIAL_SEAL, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false
  });
  return Object.freeze(sealed);
}
function isSealedCredential(credential) {
  return credential[CREDENTIAL_SEAL] === true;
}
function explicitCredential(appName, apiKey) {
  const source = "explicit apiKey option";
  assertUsableCredential(appName, source, apiKey);
  return sealCredential({
    apiKey,
    tier: "argument",
    source,
    deliberate: true,
    diskCandidates: [],
    warning: null
  });
}
function validateAndSealResolvedCredential(appName, credential) {
  const apiKey = credential.apiKey;
  assertUsableCredential(appName, CALLER_SUPPLIED_CREDENTIAL_PROVIDER_SOURCE, apiKey);
  if (!isSealedCredential(credential)) {
    return sealCredential({
      apiKey,
      tier: "argument",
      source: CALLER_SUPPLIED_CREDENTIAL_PROVIDER_SOURCE,
      deliberate: true,
      diskCandidates: [],
      warning: null
    });
  }
  return sealCredential({
    apiKey,
    tier: credential.tier,
    source: credential.source,
    deliberate: credential.deliberate,
    diskCandidates: credential.diskCandidates,
    warning: credential.warning,
    ...credential.pointerVaultKey !== undefined ? { pointerVaultKey: credential.pointerVaultKey } : {}
  });
}
function firstEnvValue(env, keys) {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(env, key))
      continue;
    const value = env[key]?.trim();
    if (value)
      return { key, value };
  }
  return null;
}
var AMBIENT_ENVIRONMENT = Symbol.for("hasna:contracts:ambientClientEnvironment");
function isAmbientEnvironment(env) {
  return env === process.env || env[AMBIENT_ENVIRONMENT] === true;
}
function defaultKeychainRunner(argv) {
  const result = spawnSync(KEYCHAIN_SECURITY_BIN, [...argv], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: KEYCHAIN_SPAWN_TIMEOUT_MS
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.error ? result.error.message : result.stderr ?? ""
  };
}
function keychainTierEnabled(env, options) {
  if ((options.platform ?? process.platform) !== "darwin")
    return false;
  if (options.enabled !== undefined)
    return options.enabled;
  return options.run !== undefined || isAmbientEnvironment(env);
}
function keychainAccount(env, options) {
  const station = env[KEYCHAIN_STATION_ENV_KEY]?.trim();
  if (station)
    return station;
  const host = (options.hostname ?? osHostname)().split(".")[0]?.trim() ?? "";
  if (host)
    return host;
  const user = env.USER?.trim();
  return user || null;
}
function keychainFailureHint(text) {
  const line = text.split(/\r?\n/).find((entry) => entry.trim().length > 0)?.trim() ?? "";
  const clean = line.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 200);
  return clean ? `: ${clean}` : "";
}
function readKeychainItem(name, env, kind, options) {
  if (!SAFE_APP_SLUG.test(name) || !keychainTierEnabled(env, options))
    return null;
  const account = keychainAccount(env, options);
  if (!account)
    return null;
  const service = `${KEYCHAIN_SERVICE_PREFIX}.${name}.${kind}`;
  const source = `keychain:${service}@${account}`;
  const run = options.run ?? defaultKeychainRunner;
  let result;
  try {
    result = run(["find-generic-password", "-a", account, "-s", service, "-w"]);
  } catch (error) {
    const reason = keychainFailureHint(error instanceof Error ? error.message : String(error));
    throw new CredentialResolutionError(name, `The Keychain lookup for ${source} could not run${reason}. A Keychain failure is never resolved ` + `around: fix the keychain, or delete the item to fall through to the credential on disk.`, [source]);
  }
  if (result.status === KEYCHAIN_ITEM_NOT_FOUND_STATUS)
    return null;
  if (result.status !== 0) {
    throw new CredentialResolutionError(name, `The Keychain lookup for ${source} failed (security exited ` + `${result.status ?? "without a status"}${keychainFailureHint(result.stderr)}). A Keychain item that ` + `exists but cannot be read is never resolved around: unlock the keychain, run from a session that ` + `may use it, or delete the item to fall through to the credential on disk.`, [source]);
  }
  const value = result.stdout.trim();
  if (!value) {
    throw new CredentialResolutionError(name, `${source} exists but holds an empty value; a declared item never falls through to another ` + `identity. Store a value in it or delete the item.`, [source]);
  }
  return { value, source };
}
function keychainConfigValue(name, env, options = {}) {
  return readKeychainItem(name, env, "api-url", options);
}
function snapshotClientEnvironment(name, env) {
  const keys = clientTransportEnvKeys(name);
  const ambient = isAmbientEnvironment(env);
  const snapshot = Object.create(null);
  for (const key of [
    ...keys.apiUrlKeys,
    ...keys.apiKeyKeys,
    credentialOverrideEnvKey(name),
    credentialPointerEnvKey(name),
    CREDENTIAL_PROFILE_ENV_KEY,
    "HOME",
    HASNA_HOME_ENV_KEY,
    HASNA_CONFIG_HOME_ENV_KEY,
    KEYCHAIN_STATION_ENV_KEY,
    "USER"
  ]) {
    const descriptor = Object.getOwnPropertyDescriptor(env, key);
    if (!descriptor)
      continue;
    if (!("value" in descriptor)) {
      throw new CredentialResolutionError(name, `${key} is accessor-backed; client configuration requires own data properties.`, [key]);
    }
    if (descriptor.value !== undefined && typeof descriptor.value !== "string") {
      throw new CredentialResolutionError(name, `${key} must be a string data property.`, [key]);
    }
    snapshot[key] = descriptor.value;
  }
  if (ambient) {
    Object.defineProperty(snapshot, AMBIENT_ENVIRONMENT, {
      value: true,
      enumerable: false,
      writable: false,
      configurable: false
    });
  }
  return Object.freeze(snapshot);
}
function resolveCredential(name, env, options = {}) {
  env = snapshotClientEnvironment(name, env);
  const { apiKeyKeys } = clientTransportEnvKeys(name);
  const diskPaths = credentialDiskSources(name, env);
  if (options.apiKey !== undefined) {
    const explicitKey = options.apiKey.trim();
    if (!explicitKey) {
      throw new CredentialResolutionError(name, "The explicit apiKey argument is blank; an explicit credential never falls through to another identity.", ["explicit apiKey argument"]);
    }
    assertUsableCredential(name, "the explicit apiKey argument", explicitKey);
    return sealCredential({
      apiKey: explicitKey,
      tier: "argument",
      source: "explicit apiKey argument",
      deliberate: true,
      diskCandidates: diskPaths,
      warning: null
    });
  }
  const overrideKeyName = credentialOverrideEnvKey(name);
  const overrideRaw = Object.prototype.hasOwnProperty.call(env, overrideKeyName) ? env[overrideKeyName] : undefined;
  if (overrideRaw !== undefined) {
    const override = overrideRaw.trim();
    if (!override) {
      throw new CredentialResolutionError(name, `${overrideKeyName} is set but empty. It is a deliberate override, so it is not resolved around: ` + `either give it a real key or unset it to fall back to the credential on disk.`, [overrideKeyName]);
    }
    assertUsableCredential(name, overrideKeyName, override);
    return sealCredential({
      apiKey: override,
      tier: "override",
      source: overrideKeyName,
      deliberate: true,
      diskCandidates: diskPaths,
      warning: null
    });
  }
  const pointerKeyName = credentialPointerEnvKey(name);
  const pointerRaw = Object.prototype.hasOwnProperty.call(env, pointerKeyName) ? env[pointerKeyName] : undefined;
  if (pointerRaw !== undefined) {
    const pointer = pointerRaw.trim();
    if (!pointer) {
      throw new CredentialResolutionError(name, `${pointerKeyName} is set but empty. It is a deliberate vault pointer, so it is not resolved around: ` + `either give it a vault item key or unset it to fall back to the credential on disk.`, [pointerKeyName]);
    }
    if (!VAULT_POINTER_SHAPE.test(pointer)) {
      throw new CredentialResolutionError(name, `${pointerKeyName} must name a vault ITEM KEY (a path-shaped reference like ` + `'namespace/app/live/api_key'), not a credential value. A pointer that carries a literal is refused.`, [pointerKeyName]);
    }
    return sealCredential({
      apiKey: "",
      pointerVaultKey: pointer,
      tier: "pointer",
      source: pointerKeyName,
      deliberate: true,
      diskCandidates: diskPaths,
      warning: null
    });
  }
  if (options.profile !== undefined && !options.profile.trim()) {
    throw new CredentialResolutionError(name, "The explicit profile argument is blank; an explicit identity selection never falls through.", ["explicit profile argument"]);
  }
  const profileRaw = Object.prototype.hasOwnProperty.call(env, CREDENTIAL_PROFILE_ENV_KEY) ? env[CREDENTIAL_PROFILE_ENV_KEY] : undefined;
  if (profileRaw !== undefined && !profileRaw.trim()) {
    throw new CredentialResolutionError(name, `${CREDENTIAL_PROFILE_ENV_KEY} is set but blank.`, [CREDENTIAL_PROFILE_ENV_KEY]);
  }
  const profile = options.profile?.trim() || profileRaw?.trim();
  if (profile) {
    const profileSource = options.profile?.trim() ? "explicit profile argument" : CREDENTIAL_PROFILE_ENV_KEY;
    if (!SAFE_PROFILE.test(profile)) {
      throw new CredentialResolutionError(name, `Profile name from ${profileSource} is not usable in a path. ` + `Use letters, digits, dot, dash, or underscore.`, [profileSource]);
    }
    const paths = profileDiskSources(name, env, profile);
    for (const path of paths) {
      const value = readCredentialFile(path, apiKeyKeys);
      if (value) {
        assertUsableCredential(name, path, value);
        return sealCredential({
          apiKey: value,
          tier: "profile",
          source: path,
          deliberate: true,
          diskCandidates: paths,
          warning: null
        });
      }
    }
    throw new CredentialResolutionError(name, `Profile '${profile}' (from ${profileSource}) has no ${apiKeyKeys[0]} for '${name}'. ` + `Looked in: ${paths.join(", ") || "<no HOME in this environment>"}. ` + `A profile names WHICH identity to use, so it is never resolved around \u2014 ` + `create the profile's credential file or unset ${CREDENTIAL_PROFILE_ENV_KEY}.`, paths);
  }
  const definedEnvEntries = apiKeyKeys.filter((key) => Object.prototype.hasOwnProperty.call(env, key) && env[key] !== undefined).map((key) => ({ key, value: String(env[key]).trim() }));
  const blankEnv = definedEnvEntries.find((entry) => entry.value.length === 0);
  if (blankEnv) {
    throw new CredentialResolutionError(name, `${blankEnv.key} is set but blank; a declared credential never falls through to another alias or identity.`, [blankEnv.key]);
  }
  if (definedEnvEntries.length > 1 && new Set(definedEnvEntries.map((entry) => entry.value)).size > 1) {
    throw new CredentialResolutionError(name, `${definedEnvEntries.map((entry) => entry.key).join(" and ")} disagree; credential aliases must be identical or only one may be set.`, definedEnvEntries.map((entry) => entry.key));
  }
  const envHit = firstEnvValue(env, apiKeyKeys);
  const keychainHit = readKeychainItem(name, env, "api-key", options.keychain ?? {});
  if (keychainHit) {
    assertUsableCredential(name, keychainHit.source, keychainHit.value);
    const warning = envHit && envHit.value !== keychainHit.value ? `Credential sources disagree for '${name}': ${keychainHit.source} and ${envHit.key} hold ` + `different keys. ${keychainHit.source} wins, because the Keychain is re-read on every call while ` + `an environment variable is a snapshot. Reconcile them \u2014 a rotation that updated only one leaves ` + `the other to fail 401 wherever it is loaded first.` : null;
    return sealCredential({
      apiKey: keychainHit.value,
      tier: "keychain",
      source: keychainHit.source,
      deliberate: false,
      diskCandidates: diskPaths,
      warning
    });
  }
  const diskSourceList = credentialDiskSourceList(name, env, null);
  const diskHits = diskSourceList.map((src) => ({ src, value: readCredentialFile(src.path, apiKeyKeys) })).filter((hit) => hit.value !== null);
  if (diskHits.length > 0) {
    const winner = diskHits[0];
    assertUsableCredential(name, winner.src.path, winner.value);
    const divergentSources = [
      ...diskHits.slice(1).filter((hit) => hit.value !== winner.value).map((hit) => hit.src.path),
      ...envHit && envHit.value !== winner.value ? [envHit.key] : []
    ];
    const warning = divergentSources.length > 0 ? `Credential sources disagree for '${name}': ${winner.src.path} and ` + `${divergentSources.join(", ")} hold different keys. ${winner.src.path} wins, because a file on ` + `disk is re-read on every call while an environment variable is a snapshot. Reconcile them \u2014 ` + `a rotation that updated only one leaves the other to fail 401 wherever it is loaded first.` : null;
    return sealCredential({
      apiKey: winner.value,
      tier: winner.src.tier,
      source: winner.src.path,
      deliberate: false,
      diskCandidates: diskPaths,
      warning
    });
  }
  if (envHit) {
    assertUsableCredential(name, envHit.key, envHit.value);
    return sealCredential({
      apiKey: envHit.value,
      tier: "env",
      source: envHit.key,
      deliberate: false,
      diskCandidates: diskPaths,
      warning: null
    });
  }
  return null;
}
var SECRETS_PACKAGE_SPECIFIER = "@hasna/" + "secrets";
var requireSecretsSdk = createRequire(import.meta.url);
async function completePointerCredential(name, pointerResolution, env = process.env) {
  const vaultKey = pointerResolution.pointerVaultKey;
  const pointerEnvKey = pointerResolution.source;
  if (!vaultKey) {
    throw new CredentialResolutionError(name, `Pointer resolution from ${pointerEnvKey} carries no vault item key; this is a defect in the resolver.`, [pointerEnvKey]);
  }
  let secretsSdk;
  try {
    secretsSdk = requireSecretsSdk(SECRETS_PACKAGE_SPECIFIER);
  } catch {
    throw new CredentialResolutionError(name, `${pointerEnvKey} names vault item '${vaultKey}', but the secrets SDK (@hasna/secrets) is not installed ` + `in this process. A vault pointer is TERMINAL: install @hasna/secrets to resolve it, or unset ${pointerEnvKey}.`, [pointerEnvKey]);
  }
  let client;
  try {
    client = secretsSdk.createSecretsClientFromEnv(env);
  } catch {
    throw new CredentialResolutionError(name, `${pointerEnvKey} names vault item '${vaultKey}', but the secrets client could not be configured from this ` + `environment (the secrets service URL and key env are missing or invalid). A vault pointer is TERMINAL and ` + `never falls through to a literal or disk credential.`, [pointerEnvKey]);
  }
  let secret;
  try {
    secret = await client.getSecret({ key: vaultKey });
  } catch {
    throw new CredentialResolutionError(name, `${pointerEnvKey} names vault item '${vaultKey}', but the vault could not be reached or the item is ` + `unavailable. A vault pointer is TERMINAL and never falls through to a literal or disk credential.`, [pointerEnvKey]);
  }
  const value = secret.value;
  if (!value) {
    throw new CredentialResolutionError(name, `${pointerEnvKey} resolved vault item '${vaultKey}', but it holds no value. A vault pointer is TERMINAL.`, [pointerEnvKey]);
  }
  assertUsableCredential(name, `${pointerEnvKey} -> vault:${vaultKey}`, value);
  return sealCredential({
    apiKey: value,
    tier: "pointer",
    source: `${pointerEnvKey} -> vault:${vaultKey}`,
    deliberate: true,
    diskCandidates: pointerResolution.diskCandidates,
    warning: null
  });
}
var DEFAULT_FLEET_GATEWAY_ORIGIN = "https://api.hasna.com";
var DEFAULT_AUTHORITY_SOURCE = "default";
function defaultFleetGatewayBaseUrl(name) {
  return `${DEFAULT_FLEET_GATEWAY_ORIGIN}/${validateAppSlug(name)}`;
}
var ASCII_CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;
var DNS_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
function isValidDnsDomain(value) {
  if (value.length === 0 || value.length > 253 || ASCII_CONTROL_PATTERN.test(value) || /[^\x00-\x7f]/.test(value)) {
    return false;
  }
  return value.split(".").every((label) => label.length <= 63 && !label.startsWith("xn--") && DNS_LABEL_PATTERN.test(label));
}
function validateAppSlug(name) {
  if (name.length > 63 || !DNS_LABEL_PATTERN.test(name)) {
    throw new Error("App name must be one lowercase DNS label.");
  }
  return name;
}
function rawAuthority(value) {
  const match = /^[a-z][a-z0-9+.-]*:\/\//i.exec(value);
  if (!match)
    throw new Error("API URL must be absolute.");
  const afterScheme = value.slice(match[0].length);
  const boundary = afterScheme.search(/[/?#]/);
  const authority = boundary === -1 ? afterScheme : afterScheme.slice(0, boundary);
  if (!authority)
    throw new Error("API URL must include a hostname.");
  return authority;
}
function assertCanonicalPort(port) {
  if (!/^[0-9]+$/.test(port) || port.length > 1 && port.startsWith("0")) {
    throw new Error("API URL authority must contain a canonical port between 1 and 65535.");
  }
  const numericPort = Number(port);
  if (!Number.isSafeInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
    throw new Error("API URL authority must contain a canonical port between 1 and 65535.");
  }
}
function canonicalAuthorityHostname(authority) {
  let rawHostname;
  if (authority.startsWith("[")) {
    const closingBracket = authority.indexOf("]");
    if (closingBracket === -1) {
      throw new Error("API URL authority must contain a canonical hostname.");
    }
    rawHostname = authority.slice(0, closingBracket + 1);
    const portSuffix = authority.slice(closingBracket + 1);
    if (portSuffix) {
      if (!portSuffix.startsWith(":")) {
        throw new Error("API URL authority must contain a canonical hostname and port.");
      }
      assertCanonicalPort(portSuffix.slice(1));
    }
    if (isIP2(rawHostname.slice(1, -1)) !== 6) {
      throw new Error("API URL authority must contain a canonical IPv6 literal.");
    }
  } else {
    const firstColon = authority.indexOf(":");
    const lastColon = authority.lastIndexOf(":");
    if (firstColon !== lastColon) {
      throw new Error("IPv6 API URL authorities must use brackets.");
    }
    if (lastColon !== -1) {
      const port = authority.slice(lastColon + 1);
      assertCanonicalPort(port);
      rawHostname = authority.slice(0, lastColon);
    } else {
      rawHostname = authority;
    }
    const ipVersion = isIP2(rawHostname);
    const numericAddressParts = rawHostname.split(".");
    const looksLikeNonCanonicalIpv4 = numericAddressParts.every((part) => /^(?:0x[0-9a-f]+|[0-9]+)$/i.test(part));
    if (ipVersion !== 4 && looksLikeNonCanonicalIpv4 || ipVersion !== 4 && !isValidDnsDomain(rawHostname.toLowerCase())) {
      throw new Error("API URL authority must contain a canonical ASCII hostname.");
    }
  }
  return rawHostname.toLowerCase();
}
function isDeliberateLoopbackHttpAuthority(authority) {
  return /^(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]+)?$/i.test(authority);
}
function toV1BaseUrl(apiUrl) {
  if (ASCII_CONTROL_PATTERN.test(apiUrl)) {
    throw new Error("API URL must not contain ASCII control characters.");
  }
  const input = apiUrl.trim();
  const authority = rawAuthority(input);
  if (authority.includes("@") || authority.includes("\\") || authority.includes("%") || /[^\x00-\x7f]/.test(authority)) {
    throw new Error("API URL authority must be canonical ASCII without credentials.");
  }
  const canonicalHostname = canonicalAuthorityHostname(authority);
  const url = new URL(input);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("API URL must use http or https.");
  }
  if (url.username || url.password) {
    throw new Error("API URL must not include credentials.");
  }
  if (!url.hostname || url.hostname.endsWith(".")) {
    throw new Error("API URL must include a canonical hostname.");
  }
  if (url.hostname.toLowerCase() !== canonicalHostname) {
    throw new Error("API URL authority must not rely on parser hostname normalization.");
  }
  if (url.hostname.split(".").some((label) => label.toLowerCase().startsWith("xn--"))) {
    throw new Error("API URL must not use IDN or punycode hostnames.");
  }
  if (url.protocol === "http:" && !isDeliberateLoopbackHttpAuthority(authority)) {
    throw new Error("API URL may use http only for an exact loopback authority.");
  }
  if (url.search || url.hash) {
    throw new Error("API URL must not include a query string or fragment.");
  }
  let path = url.pathname.replace(/\/+$/, "");
  if (path.endsWith("/v1"))
    path = path.slice(0, -"/v1".length);
  url.pathname = `${path}/v1`;
  return url.toString().replace(/\/+$/, "");
}
class ClientTransportConfigurationError extends Error {
  appName;
  sources;
  constructor(appName, message, sources = []) {
    super(message);
    this.name = "ClientTransportConfigurationError";
    this.appName = appName;
    this.sources = Object.freeze([...sources]);
  }
}
function resolveClientTransportSnapshot(name, env = process.env, options = {}) {
  env = snapshotClientEnvironment(name, env);
  const keys = clientTransportEnvKeys(name);
  const definedUrlEntries = keys.apiUrlKeys.filter((key) => Object.prototype.hasOwnProperty.call(env, key) && env[key] !== undefined).map((key) => ({ key, raw: String(env[key]) }));
  const blankUrl = definedUrlEntries.find((entry) => entry.raw.trim().length === 0);
  if (blankUrl) {
    throw new ClientTransportConfigurationError(name, `${blankUrl.key} is set but blank; public clients require an explicit HTTPS API URL and never select local storage.`, [blankUrl.key]);
  }
  const controlledUrl = definedUrlEntries.find((entry) => ASCII_CONTROL_PATTERN.test(entry.raw));
  if (controlledUrl) {
    throw new ClientTransportConfigurationError(name, `${controlledUrl.key} contains ASCII control characters.`, [controlledUrl.key]);
  }
  const usableUrlEntries = definedUrlEntries.map((entry) => ({ key: entry.key, value: entry.raw.trim() }));
  if (usableUrlEntries.length > 1 && new Set(usableUrlEntries.map((entry) => entry.value)).size > 1) {
    throw new ClientTransportConfigurationError(name, `${usableUrlEntries.map((entry) => entry.key).join(" and ")} disagree; client authority aliases must be identical or only one may be set.`, usableUrlEntries.map((entry) => entry.key));
  }
  const envUrlHit = usableUrlEntries[0] ?? null;
  const keychainUrlHit = keychainConfigValue(name, env, options.credentials?.keychain);
  const diskConfigUrlHit = appConfigDiskValue(name, env, keys.apiUrlKeys);
  if (diskConfigUrlHit?.unusable) {
    throw new ClientTransportConfigurationError(name, `${diskConfigUrlHit.key} in ${diskConfigUrlHit.path} is declared but blank or malformed; public clients require a valid HTTPS service authority.`, [diskConfigUrlHit.path]);
  }
  const urlCandidates = [
    ...envUrlHit ? [envUrlHit] : [],
    ...keychainUrlHit ? [{ key: keychainUrlHit.source, value: keychainUrlHit.value }] : [],
    ...diskConfigUrlHit ? [{ key: diskConfigUrlHit.path, value: diskConfigUrlHit.value.trim() }] : []
  ];
  const configuredUrl = urlCandidates[0] ?? null;
  const divergentUrls = urlCandidates.filter((candidate) => candidate.value !== configuredUrl?.value);
  if (configuredUrl && divergentUrls.length > 0) {
    throw new ClientTransportConfigurationError(name, `${configuredUrl.key} and ${divergentUrls.map((candidate) => candidate.key).join(" and ")} select different service authorities; refusing to send a credential written for one authority to the other.`, urlCandidates.map((candidate) => candidate.key));
  }
  const warnings = [];
  if (configuredUrl && !envUrlHit) {
    warnings.push(`No ${keys.apiUrlKeys[0]} in the environment; the server URL in ${configuredUrl.key} was used, so this client connects to the server. ` + `Keep that entry aligned with the intended service authority.`);
  }
  const credential = resolveCredential(name, env, options.credentials);
  if (!credential) {
    const diskHint = credentialDiskSourcesForMessage(name, env);
    const lead = configuredUrl ? `${configuredUrl.key} selects the HTTP server for '${name}', but no API key could be resolved` : `${keys.apiUrlKeys[0]} is not set and no API key could be resolved for '${name}'; a credential is required before the default fleet gateway authority applies`;
    warnings.push(`${lead}; refusing to create an unauthenticated client \u2014 public clients never fall back to SQLite or another local store. ` + `Looked in the Keychain (macOS only), then for a credential file at ${diskHint}, then for ${keys.apiKeyKeys[0]} in the environment.`);
    throw new ClientTransportConfigurationError(name, warnings.join(" "), [configuredUrl?.key ?? keys.apiUrlKeys[0]]);
  }
  if (credential.warning)
    warnings.push(credential.warning);
  let urlHit;
  if (configuredUrl) {
    urlHit = configuredUrl;
  } else {
    try {
      urlHit = { key: DEFAULT_AUTHORITY_SOURCE, value: defaultFleetGatewayBaseUrl(name) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ClientTransportConfigurationError(name, `No ${keys.apiUrlKeys[0]} is configured and the default fleet gateway authority cannot be composed for '${name}': ${message}`, [keys.apiUrlKeys[0]]);
    }
  }
  const apiUrlSource = urlHit.key;
  let baseUrl;
  try {
    baseUrl = toV1BaseUrl(urlHit.value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ClientTransportConfigurationError(name, `Invalid API URL from ${apiUrlSource}: ${message}`, [apiUrlSource]);
  }
  return {
    resolution: {
      transport: "http",
      transportSource: urlHit.key,
      baseUrl,
      apiUrlSource,
      apiKeyPresent: true,
      apiKeySource: credential.source,
      apiKeyTier: credential.tier,
      misconfigured: false,
      warning: warnings.length > 0 ? warnings.join(" ") : null
    },
    credential
  };
}
function credentialDiskSourcesForMessage(name, env) {
  const paths = credentialDiskSources(name, env);
  return paths.length > 0 ? paths.join(" or ") : "<no HOME or HASNA_HOME set in this environment, so no credential file was consulted>";
}

class HasnaHttpError extends Error {
  status;
  method;
  path;
  credentialSource;
  credentialTier;
  constructor(method, path, status, body, credential) {
    const guidance = credential ? `. ${credential.guidance}` : "";
    super(`Hasna cloud request failed: ${method} ${path} -> ${status}${guidance}`);
    this.name = "HasnaHttpError";
    this.status = status;
    this.method = method;
    this.path = path;
    Object.defineProperty(this, "body", {
      value: body,
      enumerable: status !== 401 && status !== 403,
      writable: false,
      configurable: false
    });
    this.credentialSource = credential?.source ?? null;
    this.credentialTier = credential?.tier ?? null;
  }
}
function currentCredential(name, apiKey) {
  if (typeof apiKey === "function") {
    return validateAndSealResolvedCredential(name, apiKey());
  }
  return explicitCredential(name, apiKey);
}
async function resolveRequestCredential(name, apiKey, env = process.env) {
  const resolved = currentCredential(name, apiKey);
  if (resolved.tier === "pointer") {
    return completePointerCredential(name, resolved, env);
  }
  return resolved;
}
function authFailureGuidance(credential) {
  const origin = `The API key for this request came from ${credential.source}`;
  if (credential.deliberate) {
    const remedy = credential.source === CALLER_SUPPLIED_CREDENTIAL_PROVIDER_SOURCE ? `Fix that provider so it returns the current key, or replace it with resolveCredential() ` + `so diagnostics can name the original source.` : `Rotate that key, or unset the override to use the credential on disk.`;
    return `${origin} \u2014 a credential you selected deliberately. It was NOT substituted with any other key: ` + `falling back here would authenticate as a different principal than the one you named, which is ` + `exactly the failure an override exists to prevent. ${remedy}`;
  }
  if (credential.tier === "env") {
    const target = credential.diskCandidates[0];
    const remedy = target ? `Store the CURRENT key in the Keychain or write it to ${target} \u2014 both are re-read on every call, so ` + `rotations take effect immediately and in every shell. Do not simply unset ${credential.source}: ` + `nothing was found in the Keychain or on disk, so that would leave this client with no credential at all.` : `This environment has no HOME or HASNA_HOME, so no credential file could be consulted; the disk tier is ` + `unavailable here and there is nothing to fall back to. Set HOME, or supply the key explicitly.`;
    return `${origin}, a variable in this process's environment. If a wrapper injected it for this one process, the ` + `wrapper re-reads its store on every invocation and the stored key itself is being rejected \u2014 rotate it. ` + `If this SHELL exported it, the export is a snapshot taken when the shell started: a STALE SHELL that ` + `exported the key before it was rotated keeps sending the old one until it exits. ${remedy}`;
  }
  if (credential.tier === "keychain") {
    return `${origin}, which was re-read from the Keychain on this very call \u2014 so a stale shell is NOT the cause ` + `here. The stored item is genuinely being rejected: update it with the current key, or re-run the fleet ` + `key distribution so this machine gets the current key.`;
  }
  return `${origin}, which was re-read from disk on this very call \u2014 so a stale shell is NOT the cause here. ` + `The stored credential is genuinely being rejected: rotate it, or re-run the fleet key distribution ` + `so this machine gets the current key.`;
}
var DEFAULT_RETRY_STATUSES = [408, 425, 429, 500, 502, 503, 504];
var IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "PUT", "DELETE", "OPTIONS"]);
var AUTHORITY_OVERRIDE_HEADERS = new Set([
  "host",
  ":authority",
  "forwarded",
  "x-forwarded-host",
  "x-original-host"
]);
function assertNoAuthorityOverrideHeaders(headers, source) {
  if (!headers)
    return;
  const forbidden = Object.keys(headers).find((name) => AUTHORITY_OVERRIDE_HEADERS.has(name.trim().toLowerCase()));
  if (forbidden) {
    throw new Error(`Authenticated ${source} headers must not set authority header '${forbidden}'.`);
  }
}
function appendQuery(path, query) {
  if (!query)
    return path;
  const params = query instanceof URLSearchParams ? query : new URLSearchParams;
  if (!(query instanceof URLSearchParams)) {
    for (const [key, value] of Object.entries(query)) {
      if (value === null || value === undefined)
        continue;
      if (Array.isArray(value)) {
        for (const v of value)
          params.append(key, String(v));
      } else {
        params.append(key, String(value));
      }
    }
  }
  const qs = params.toString();
  if (!qs)
    return path;
  return `${path}${path.includes("?") ? "&" : "?"}${qs}`;
}
var defaultSleep = (ms) => new Promise((resolve2) => setTimeout(resolve2, ms));
function createHasnaHttpTransportInternal(options, requestBindingProvider) {
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const base = toV1BaseUrl(options.baseUrl);
  const timeoutMs = options.timeoutMs ?? 30000;
  const sleep = options.sleepImpl ?? defaultSleep;
  const defaultRetry = options.retry;
  function resolveRetry(callRetry) {
    const chosen = callRetry !== undefined ? callRetry : defaultRetry;
    if (chosen === false)
      return null;
    const r = chosen ?? {};
    return {
      retries: r.retries ?? 2,
      baseDelayMs: r.baseDelayMs ?? 200,
      maxDelayMs: r.maxDelayMs ?? 2000,
      retryStatuses: r.retryStatuses ?? [...DEFAULT_RETRY_STATUSES]
    };
  }
  async function once(method, rel, url, body, opts, credential) {
    assertNoAuthorityOverrideHeaders(options.headers, "transport");
    assertNoAuthorityOverrideHeaders(opts.headers, "request");
    const headers = {
      "x-api-key": credential.apiKey,
      Authorization: `Bearer ${credential.apiKey}`,
      Accept: "application/json",
      ...options.headers ?? {},
      ...opts.headers ?? {}
    };
    if (opts.idempotencyKey)
      headers["Idempotency-Key"] = opts.idempotencyKey;
    const init = {
      method,
      headers,
      redirect: "manual"
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    const controller = new AbortController;
    const onAbort = () => controller.abort();
    if (opts.signal) {
      if (opts.signal.aborted)
        controller.abort();
      else
        opts.signal.addEventListener("abort", onAbort, { once: true });
    }
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? timeoutMs);
    init.signal = controller.signal;
    let response;
    try {
      response = await fetchImpl(url, init);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (opts.signal?.aborted)
        return { ok: false, retryable: false, error: err };
      return { ok: false, retryable: true, error: err };
    } finally {
      clearTimeout(timer);
      if (opts.signal)
        opts.signal.removeEventListener("abort", onAbort);
    }
    const authenticationFailure = response.status === 401 || response.status === 403;
    let parsed = undefined;
    if (authenticationFailure) {
      try {
        await response.body?.cancel();
      } catch {}
    } else {
      const text = await response.text();
      if (text.length > 0) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
      }
    }
    if (!response.ok) {
      if (response.status >= 300 && response.status < 400) {
        return {
          ok: false,
          retryable: false,
          error: new HasnaHttpError(method, rel, response.status, parsed)
        };
      }
      if (authenticationFailure) {
        return {
          ok: false,
          retryable: false,
          error: new HasnaHttpError(method, rel, response.status, undefined, {
            source: credential.source,
            tier: credential.tier,
            guidance: authFailureGuidance(credential)
          })
        };
      }
      const retry = resolveRetry(opts.retry);
      const retryable = retry ? retry.retryStatuses.includes(response.status) : false;
      return { ok: false, retryable, error: new HasnaHttpError(method, rel, response.status, parsed) };
    }
    return { ok: true, value: parsed };
  }
  async function request(method, path, body, opts = {}) {
    const upper = method.toUpperCase();
    const rel = appendQuery(path.startsWith("/") ? path : `/${path}`, opts.query);
    const retry = resolveRetry(opts.retry);
    const methodRetryable = IDEMPOTENT_METHODS.has(upper) || Boolean(opts.idempotencyKey);
    const maxAttempts = retry && methodRetryable ? retry.retries + 1 : 1;
    const binding = requestBindingProvider ? await requestBindingProvider() : {
      baseUrl: base,
      credential: await resolveRequestCredential(options.name, options.apiKey)
    };
    const url = `${binding.baseUrl}${rel}`;
    const credential = binding.credential;
    let last = null;
    for (let attempt = 1;attempt <= maxAttempts; attempt++) {
      const result = await once(upper, rel, url, body, opts, credential);
      if (result.ok)
        return result.value;
      last = result;
      const canRetry = retry !== null && methodRetryable && result.retryable && attempt < maxAttempts;
      if (!canRetry)
        break;
      const backoff = Math.min(retry.maxDelayMs, retry.baseDelayMs * 2 ** (attempt - 1));
      const jitter = Math.floor(Math.random() * (backoff / 2 + 1));
      await sleep(backoff + jitter);
    }
    throw last.error;
  }
  return {
    baseUrl: base,
    request,
    get: (path, opts) => request("GET", path, undefined, opts),
    post: (path, body, opts) => request("POST", path, body, opts),
    put: (path, body, opts) => request("PUT", path, body, opts),
    patch: (path, body, opts) => request("PATCH", path, body, opts),
    del: (path, body, opts) => request("DELETE", path, body, opts)
  };
}
function createClientTransport(name, env = process.env, overrides) {
  const credentialOptions = overrides?.credentials;
  const snapshotOptions = { ...credentialOptions ? { credentials: credentialOptions } : {} };
  const resolution = resolveClientTransportSnapshot(name, env, snapshotOptions).resolution;
  const sameBinding = (left, right) => left.resolution.baseUrl === right.resolution.baseUrl && left.credential.apiKey === right.credential.apiKey && left.credential.pointerVaultKey === right.credential.pointerVaultKey && left.credential.source === right.credential.source && left.credential.tier === right.credential.tier;
  const unstableConfiguration = () => new ClientTransportConfigurationError(name, "The configured service authority or credential changed while a request was being prepared; no authenticated request was sent.");
  const requestBindingProvider = async () => {
    const first = resolveClientTransportSnapshot(name, env, snapshotOptions);
    const reviewed = resolveClientTransportSnapshot(name, env, snapshotOptions);
    if (!sameBinding(first, reviewed))
      throw unstableConfiguration();
    if (reviewed.resolution.baseUrl !== resolution.baseUrl) {
      throw new ClientTransportConfigurationError(name, "The configured service authority changed; rebuild the client before sending credentials.");
    }
    const credential = await resolveRequestCredential(name, () => reviewed.credential, env);
    const immediatelyBeforeDispatch = resolveClientTransportSnapshot(name, env, snapshotOptions);
    if (!sameBinding(reviewed, immediatelyBeforeDispatch))
      throw unstableConfiguration();
    if (immediatelyBeforeDispatch.resolution.baseUrl !== resolution.baseUrl) {
      throw new ClientTransportConfigurationError(name, "The configured service authority changed; rebuild the client before sending credentials.");
    }
    return { baseUrl: immediatelyBeforeDispatch.resolution.baseUrl, credential };
  };
  return {
    transport: "http",
    client: createHasnaHttpTransportInternal({
      name,
      baseUrl: resolution.baseUrl,
      apiKey: () => {
        throw new Error("The authenticated request binding provider was not invoked.");
      },
      ...overrides?.fetchImpl ? { fetchImpl: overrides.fetchImpl } : {},
      ...overrides?.headers ? { headers: overrides.headers } : {},
      ...overrides?.timeoutMs ? { timeoutMs: overrides.timeoutMs } : {},
      ...overrides?.retry !== undefined ? { retry: overrides.retry } : {},
      ...overrides?.sleepImpl ? { sleepImpl: overrides.sleepImpl } : {}
    }, requestBindingProvider),
    resolution
  };
}

// src/intake/protocol.ts
import { createHash } from "crypto";
var INTAKE_PROTOCOL = "hasna.events.intake.v1";
var CANONICAL_ENCODING = "hasna.sorted-json.v1";
var MAX_ENVELOPE_BYTES = 256 * 1024;
var MAX_REQUEST_BYTES = MAX_ENVELOPE_BYTES * 2 + 8192;

class IntakeError extends Error {
  code;
  status;
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
function uuid(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value))
    throw new IntakeError("invalid_identity");
  return value;
}
function boundedText(value, limit = 512) {
  if (typeof value !== "string" || !value.length || value.length > limit || /[\u0000-\u001f\u007f]/.test(value))
    throw new IntakeError("invalid_text");
  return value;
}
function object(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    throw new IntakeError("invalid_object");
  return value;
}
function exactKeys(value, required, optional = []) {
  if (required.some((k) => !Object.hasOwn(value, k)) || Object.keys(value).some((k) => !required.includes(k) && !optional.includes(k)))
    throw new IntakeError("invalid_fields");
}
function canonicalJson(input) {
  const seen = new Set;
  let nodes = 0;
  let scalarBytes = 0;
  function scalar(text) {
    scalarBytes += Buffer.byteLength(text);
    if (scalarBytes > MAX_ENVELOPE_BYTES)
      throw new IntakeError("envelope_too_large", 413);
    return text;
  }
  function encode(value, depth) {
    if (++nodes > 20000 || depth > 32)
      throw new IntakeError("envelope_complexity_exceeded");
    if (value === null || typeof value === "boolean")
      return scalar(JSON.stringify(value));
    if (typeof value === "number") {
      if (!Number.isFinite(value))
        throw new IntakeError("non_json_value");
      return scalar(JSON.stringify(value));
    }
    if (typeof value === "string") {
      if (Buffer.from(value, "utf8").toString("utf8") !== value)
        throw new IntakeError("invalid_unicode");
      return scalar(JSON.stringify(value));
    }
    if (!value || typeof value !== "object" || seen.has(value))
      throw new IntakeError("non_json_value");
    seen.add(value);
    try {
      if (Array.isArray(value)) {
        if (Object.keys(value).length !== value.length)
          throw new IntakeError("non_json_value");
        return `[${Array.from({ length: value.length }, (_, i) => {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
          if (!descriptor || !Object.hasOwn(descriptor, "value"))
            throw new IntakeError("non_json_value");
          return encode(descriptor.value, depth + 1);
        }).join(",")}]`;
      }
      const record = object(value);
      if (Reflect.ownKeys(record).length !== Object.keys(record).length)
        throw new IntakeError("non_json_value");
      return `{${Object.keys(record).sort().map((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(record, key);
        if (!Object.hasOwn(descriptor, "value") || ["__proto__", "constructor", "prototype"].includes(key))
          throw new IntakeError("non_json_value");
        return `${encode(key, depth + 1)}:${encode(descriptor.value, depth + 1)}`;
      }).join(",")}}`;
    } finally {
      seen.delete(value);
    }
  }
  const encoded = encode(input, 0);
  if (Buffer.byteLength(encoded) > MAX_ENVELOPE_BYTES)
    throw new IntakeError("envelope_too_large", 413);
  return encoded;
}
function envelopeHash(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
function rejectSensitive(value) {
  if (typeof value === "string" && /(?:hasna_[a-z][a-z0-9-]*_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_.=-]{12,})/.test(value))
    throw new IntakeError("sensitive_envelope_rejected");
  if (Array.isArray(value)) {
    for (const item of value)
      rejectSensitive(item);
  } else if (value && typeof value === "object")
    for (const [key, item] of Object.entries(value)) {
      if (shouldRedactKey(key) && item !== "[REDACTED]" && item !== null)
        throw new IntakeError("sensitive_envelope_rejected");
      rejectSensitive(item);
    }
}
function validateEnvelope(text) {
  if (typeof text !== "string" || Buffer.byteLength(text) > MAX_ENVELOPE_BYTES)
    throw new IntakeError("envelope_too_large", 413);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new IntakeError("invalid_envelope_json");
  }
  if (canonicalJson(parsed) !== text)
    throw new IntakeError("noncanonical_envelope");
  const e = object(parsed);
  exactKeys(e, ["id", "source", "type", "time", "severity", "data", "dedupeKey", "schemaVersion", "metadata"], ["subject", "message"]);
  boundedText(e.id);
  boundedText(e.dedupeKey);
  boundedText(e.source, 128);
  boundedText(e.type, 256);
  if (e.schemaVersion !== "1.0" || !["debug", "info", "notice", "warning", "error", "critical"].includes(String(e.severity)))
    throw new IntakeError("unsupported_envelope");
  if (typeof e.time !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(e.time) || !Number.isFinite(Date.parse(e.time)) || new Date(e.time).toISOString() !== e.time)
    throw new IntakeError("invalid_event_time");
  object(e.data);
  object(e.metadata);
  if (Object.hasOwn(e, "subject"))
    boundedText(e.subject, 1024);
  if (Object.hasOwn(e, "message"))
    boundedText(e.message, 4096);
  rejectSensitive(e);
  return e;
}
function validateBinding(raw) {
  const b = object(raw);
  return { sink_id: uuid(b.sink_id), producer_id: uuid(b.producer_id), corpus_id: uuid(b.corpus_id), source_authority_id: uuid(b.source_authority_id) };
}
function validateRequest(raw) {
  const r = object(raw);
  exactKeys(r, ["protocol", "encoding", "sink_id", "producer_id", "corpus_id", "source_authority_id", "event_id", "dedupe_key", "envelope_sha256", "envelope_json"]);
  validateBinding(r);
  if (r.protocol !== INTAKE_PROTOCOL || r.encoding !== CANONICAL_ENCODING)
    throw new IntakeError("unsupported_intake_protocol");
  const e = validateEnvelope(r.envelope_json);
  if (e.id !== r.event_id || e.dedupeKey !== r.dedupe_key || r.envelope_sha256 !== envelopeHash(r.envelope_json))
    throw new IntakeError("envelope_identity_or_hash_mismatch");
  return r;
}
function prepareIntake(binding, envelope) {
  const envelope_json = canonicalJson(envelope);
  return validateRequest({ ...validateBinding(binding), protocol: INTAKE_PROTOCOL, encoding: CANONICAL_ENCODING, event_id: envelope.id, dedupe_key: envelope.dedupeKey, envelope_sha256: envelopeHash(envelope_json), envelope_json });
}
function validateReceipt(raw, request, tenant) {
  const r = object(raw);
  exactKeys(r, ["protocol", "sink_id", "producer_id", "corpus_id", "source_authority_id", "event_id", "dedupe_key", "envelope_sha256", "tenant_id", "receipt_id", "accepted_at", "status"]);
  for (const k of ["protocol", "sink_id", "producer_id", "corpus_id", "source_authority_id", "event_id", "dedupe_key", "envelope_sha256"])
    if (r[k] !== request[k])
      throw new IntakeError("receipt_identity_mismatch", 502);
  uuid(r.receipt_id);
  if (r.tenant_id !== tenant || r.status !== "accepted_durable" || typeof r.accepted_at !== "string" || !Number.isFinite(Date.parse(r.accepted_at)))
    throw new IntakeError("unconfirmed_intake_receipt", 502);
  return r;
}

// src/intake/generated.ts
function acceptEvent(client, body, options) {
  return client.request("POST", "/intake/events", body, options);
}
function intakeCapability(client, options) {
  return client.request("GET", "/intake/capability", undefined, options);
}
function readReceipt(client, options) {
  return client.request("GET", "/intake/receipts", undefined, options);
}

// src/intake/client.ts
function createIntakeClient(options) {
  const binding = Object.freeze(validateBinding(options.binding));
  const tenant = boundedText(options.tenantId, 256);
  const { client } = createClientTransport("events", options.env ?? process.env, { credentials: options.credentials, retry: false, timeoutMs: 15000 });
  const headers = { "x-events-sink-id": binding.sink_id, "x-events-producer-id": binding.producer_id, "x-events-corpus-id": binding.corpus_id, "x-events-source-authority-id": binding.source_authority_id, "x-events-tenant-id": tenant };
  return {
    async capability() {
      const r = object(await intakeCapability(client, { headers, retry: false }));
      if (r.protocol !== INTAKE_PROTOCOL || r.tenant_id !== tenant || JSON.stringify(validateBinding(r)) !== JSON.stringify(binding) || typeof r.kid !== "string" || !r.kid)
        throw new IntakeError("intake_capability_mismatch", 502);
    },
    async accept(raw, signal) {
      const request = Object.freeze({ ...validateRequest(raw) });
      if (JSON.stringify(validateBinding(request)) !== JSON.stringify(binding))
        throw new IntakeError("client_binding_mismatch");
      const response = await acceptEvent(client, request, { headers, retry: false, signal });
      return validateReceipt(response, request, tenant);
    },
    async receipt(raw, signal) {
      const request = Object.freeze({ ...validateRequest(raw) });
      if (JSON.stringify(validateBinding(request)) !== JSON.stringify(binding))
        throw new IntakeError("client_binding_mismatch");
      const response = await readReceipt(client, { headers, query: { event_id: request.event_id }, retry: false, signal });
      return validateReceipt(response, request, tenant);
    }
  };
}

// src/index.ts
function createEvent(input) {
  return {
    id: input.id ?? randomUUID2(),
    source: input.source,
    type: input.type,
    time: normalizeTime(input.time),
    subject: input.subject,
    severity: input.severity ?? "info",
    data: input.data ?? {},
    message: input.message,
    dedupeKey: input.dedupeKey,
    schemaVersion: input.schemaVersion ?? "1.0",
    metadata: input.metadata ?? {}
  };
}

class EventsClient {
  store;
  redactors;
  transportOptions;
  catalog;
  validateCatalogTypes;
  constructor(options = {}) {
    this.store = options.store ?? new JsonEventsStore(options.dataDir);
    this.redactors = options.redactors ?? [];
    this.transportOptions = {
      fetchImpl: options.fetchImpl,
      secretResolver: options.secretResolver,
      now: options.now,
      tls: options.tls,
      webhookTargetPolicy: options.webhookTargetPolicy
    };
    this.catalog = options.catalog ?? defaultEventTypeCatalog;
    this.validateCatalogTypes = options.validateCatalogTypes ?? false;
  }
  async addChannel(input) {
    const timestamp = new Date().toISOString();
    return this.store.addChannel({
      ...input,
      createdAt: input.createdAt ?? timestamp,
      updatedAt: input.updatedAt ?? timestamp
    });
  }
  async listChannels() {
    return this.store.listChannels();
  }
  async removeChannel(id) {
    return this.store.removeChannel(id);
  }
  async emit(input, options = {}) {
    const event = options.redactSensitiveData === false ? createEvent(input) : redactSensitiveKeys(createEvent(input));
    if (options.validate ?? this.validateCatalogTypes) {
      this.catalog.assertEventValid(event);
    }
    const append = await this.appendEvent(event, { dedupe: options.dedupe !== false });
    if (append.deduped) {
      return { event: append.event, deliveries: [], deduped: true };
    }
    const deliveries = options.deliver === false ? [] : await this.deliver(append.event);
    return { event: append.event, deliveries, deduped: false };
  }
  async listEvents(options = {}) {
    if (Object.keys(options).length === 0)
      return this.store.listEvents();
    return queryClientEvents(await this.store.listEvents(), options);
  }
  async listEventsPage(options = {}) {
    if (this.store.listEventsPage)
      return this.store.listEventsPage(options);
    const events = queryClientEvents(await this.store.listEvents(), {
      eventId: options.eventId,
      source: options.source,
      type: options.type
    });
    const offset = decodeLocalJsonEventCursor(options.cursor, options);
    const limit = normalizeEventPageLimit(options.limit);
    const pageEvents = events.slice(offset, offset + limit);
    const nextOffset = offset + pageEvents.length;
    const hasMore = nextOffset < events.length;
    return {
      events: pageEvents,
      cursor: options.cursor,
      nextCursor: hasMore ? encodeLocalJsonEventCursor(nextOffset, options) : undefined,
      hasMore
    };
  }
  async listDeliveries() {
    return this.store.listDeliveries();
  }
  async deliver(event) {
    const channels = await this.store.listChannels();
    const selected = channels.filter((channel) => channelMatchesEvent(channel, event));
    const deliveries = [];
    for (const channel of selected) {
      const eventForChannel = await this.applyRedaction(event, channel);
      const result = await this.deliverWithRetry(eventForChannel, channel);
      await this.store.appendDelivery(result);
      deliveries.push(result);
    }
    return deliveries;
  }
  async matchChannel(id, input = {}) {
    const channel = await this.store.getChannel(id);
    if (!channel)
      throw new Error(`Channel not found: ${id}`);
    const event = createEvent({
      source: input.source ?? "hasna.events",
      type: input.type ?? "events.test",
      subject: input.subject ?? id,
      severity: input.severity ?? "info",
      data: input.data ?? { test: true },
      message: input.message ?? "Hasna events test delivery",
      dedupeKey: input.dedupeKey,
      schemaVersion: input.schemaVersion,
      metadata: input.metadata,
      time: input.time,
      id: input.id
    });
    const matched = channelMatchesEvent(channel, event);
    return {
      channelId: channel.id,
      matched,
      event,
      filters: channel.filters,
      reason: matched ? undefined : channel.enabled ? "event did not match channel filters" : "channel is disabled"
    };
  }
  async testChannel(id, input = {}, options = {}) {
    const channel = await this.store.getChannel(id);
    if (!channel)
      throw new Error(`Channel not found: ${id}`);
    const match = await this.matchChannel(id, input);
    const event = match.event;
    if (options.honorFilters && !match.matched) {
      const timestamp = new Date().toISOString();
      const result2 = createDeliveryResult(event, channel, [{
        attempt: 1,
        status: "skipped",
        startedAt: timestamp,
        completedAt: timestamp,
        error: match.reason
      }]);
      result2.metadata = { reason: "filter_mismatch" };
      await this.store.appendDelivery(result2);
      return result2;
    }
    const eventForChannel = await this.applyRedaction(event, channel);
    const result = await this.deliverWithRetry(eventForChannel, channel);
    await this.store.appendDelivery(result);
    return result;
  }
  async replay(options = {}) {
    const page = options.cursor || options.limit !== undefined ? await this.listEventsPage(options) : { events: await this.listEvents(options), hasMore: false };
    if (options.dryRun)
      return { events: page.events, deliveries: [], cursor: page.cursor, nextCursor: page.nextCursor, hasMore: page.hasMore };
    const deliveries = [];
    for (const event of page.events) {
      deliveries.push(...await this.deliver(event));
    }
    return { events: page.events, deliveries, cursor: page.cursor, nextCursor: page.nextCursor, hasMore: page.hasMore };
  }
  async appendEvent(event, options) {
    if (this.store.appendEventOnce) {
      return this.store.appendEventOnce(event, { dedupe: options.dedupe });
    }
    if (options.dedupe) {
      const existing = await this.store.findEventByIdentity({ id: event.id, dedupeKey: event.dedupeKey });
      if (existing) {
        return {
          event: existing,
          stored: false,
          deduped: true,
          identity: { id: existing.id, dedupeKey: existing.dedupeKey }
        };
      }
    }
    const stored = await this.store.appendEvent(event);
    return {
      event: stored,
      stored: true,
      deduped: false,
      identity: { id: stored.id, dedupeKey: stored.dedupeKey }
    };
  }
  async applyRedaction(event, channel) {
    let next = redactPaths(event, channel.redact?.paths ?? [], channel.redact?.replacement ?? "[REDACTED]");
    for (const redactor of this.redactors) {
      next = await redactor(next, channel);
    }
    return next;
  }
  async deliverWithRetry(event, channel) {
    const policy = normalizeRetryPolicy(channel.retry);
    const attempts = [];
    for (let index = 0;index < policy.maxAttempts; index += 1) {
      const attempt = await dispatchChannel(event, channel, this.transportOptions);
      attempt.attempt = index + 1;
      if (attempt.status === "failed" && index + 1 < policy.maxAttempts) {
        attempt.nextBackoffMs = Math.round(policy.backoffMs * policy.multiplier ** index);
      }
      attempts.push(attempt);
      if (attempt.status !== "failed")
        break;
      if (attempt.nextBackoffMs)
        await Bun.sleep(attempt.nextBackoffMs);
    }
    return createDeliveryResult(event, channel, attempts);
  }
}
function sanitizeChannelForOutput(channel) {
  const copy = structuredClone(channel);
  if (copy.webhook?.secret)
    copy.webhook.secret = "[REDACTED]";
  if (copy.command?.env) {
    copy.command.env = Object.fromEntries(Object.entries(copy.command.env).map(([key, value]) => [key, shouldRedactKey(key) ? "[REDACTED]" : value]));
  }
  return copy;
}
function sanitizeChannelsForOutput(channels) {
  return channels.map(sanitizeChannelForOutput);
}
function queryClientEvents(events, options) {
  let rows = events;
  if (options.eventId)
    rows = rows.filter((event) => event.id === options.eventId);
  if (options.source)
    rows = rows.filter((event) => event.source === options.source);
  if (options.type)
    rows = rows.filter((event) => event.type === options.type);
  if (options.cursor)
    rows = rows.slice(decodeLocalJsonEventCursor(options.cursor, options));
  if (options.limit !== undefined)
    rows = rows.slice(0, normalizeEventPageLimit(options.limit));
  return rows;
}
function normalizeTime(value) {
  if (!value)
    return new Date().toISOString();
  return value instanceof Date ? value.toISOString() : value;
}
function normalizeRetryPolicy(policy) {
  return {
    maxAttempts: Math.max(1, policy?.maxAttempts ?? 1),
    backoffMs: Math.max(0, policy?.backoffMs ?? 250),
    multiplier: Math.max(1, policy?.multiplier ?? 2)
  };
}

// src/filter-options.ts
function parseFieldMatchers(values, label, typed = false) {
  if (!values?.length)
    return;
  const result = {};
  for (const value of values) {
    const parsed = parseMatcherExpression(value, label);
    const path = parsed.path;
    if (path in result)
      throw new Error(`Duplicate ${label} filter path: ${path}`);
    const matcherValue = typed ? parseTypedMatcherValue(parsed.rawValue, label) : parsed.rawValue;
    result[path] = parsed.negated ? { not: matcherValue } : matcherValue;
  }
  return result;
}
function parseFilterOptions(options) {
  const filter2 = {};
  if (options.source)
    filter2.source = options.source;
  if (options.type)
    filter2.type = options.type;
  if (options.subject)
    filter2.subject = options.subject;
  if (options.severity)
    filter2.severity = options.severity;
  const data = mergeMatchers(parseFieldMatchers(options.data, "data"), parseFieldMatchers(options.dataJson, "data-json", true));
  const metadata = mergeMatchers(parseFieldMatchers(options.metadata, "metadata"), parseFieldMatchers(options.metadataJson, "metadata-json", true));
  if (Object.keys(data).length > 0)
    filter2.data = data;
  if (Object.keys(metadata).length > 0)
    filter2.metadata = metadata;
  return Object.keys(filter2).length > 0 ? [filter2] : undefined;
}
function mergeMatchers(...records) {
  const result = {};
  for (const record of records) {
    if (!record)
      continue;
    for (const [path, value] of Object.entries(record)) {
      if (path in result)
        throw new Error(`Duplicate filter path: ${path}`);
      result[path] = value;
    }
  }
  return result;
}
function parseTypedMatcherValue(value, label) {
  const parsed = JSON.parse(value);
  if (parsed === null || typeof parsed === "string" || typeof parsed === "number" || typeof parsed === "boolean" || Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
    return parsed;
  }
  throw new Error(`${label} filter JSON values must be string, string[], number, boolean, or null`);
}
function parseMatcherExpression(value, label) {
  const negativeSeparator = value.indexOf("!=");
  if (negativeSeparator > 0) {
    return {
      path: value.slice(0, negativeSeparator),
      rawValue: value.slice(negativeSeparator + 2),
      negated: true
    };
  }
  const separator = value.indexOf("=");
  if (separator <= 0)
    throw new Error(`Invalid ${label} filter, expected path=value or path!=value: ${value}`);
  return {
    path: value.slice(0, separator),
    rawValue: value.slice(separator + 1),
    negated: false
  };
}

// src/cli-webhook-policy.ts
function webhookTargetPolicyFromEnv() {
  const value = process.env.HASNA_EVENTS_ALLOW_PRIVATE_WEBHOOK_TARGETS;
  if (!value)
    return;
  const hosts = value.split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  return hosts.length > 0 ? { allowPrivateHosts: hosts } : undefined;
}

// src/commander.ts
var DEFAULT_EVENT_LIST_LIMIT = 100;
function parseJsonObject(value, fallback) {
  if (!value)
    return fallback;
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected a JSON object");
  }
  return parsed;
}
function parseHeaders(values) {
  if (!values?.length)
    return;
  const headers = {};
  for (const value of values) {
    const separator = value.indexOf("=");
    if (separator === -1)
      throw new Error(`Invalid header, expected name=value: ${value}`);
    headers[value.slice(0, separator)] = value.slice(separator + 1);
  }
  return headers;
}
function createClient(options) {
  if (options.createClient)
    return options.createClient();
  return new EventsClient({ store: new JsonEventsStore(options.dataDir), webhookTargetPolicy: webhookTargetPolicyFromEnv() });
}
function print(value, json, text) {
  if (json)
    console.log(JSON.stringify(value, null, 2));
  else
    console.log(text);
}
function fail(error, json) {
  const message = error instanceof Error ? error.message : String(error);
  if (json)
    console.log(JSON.stringify({ error: message }, null, 2));
  else
    console.error(message);
  process.exitCode = 1;
}
function hasJsonOption(options) {
  return Boolean(options?.json || options?.opts?.().json || options?.optsWithGlobals?.().json || options?.parent?.opts?.().json || options?.parent?.optsWithGlobals?.().json);
}
function wantsJson(actionOptions, command) {
  return hasJsonOption(actionOptions) || hasJsonOption(command);
}
function registerChannelCommands(program, options) {
  const channels = program.command(options.channelsCommandName ?? "channels").description("Manage Hasna event channels");
  channels.command("add").description("Add or replace a channel").argument("<target>", "Webhook URL or command binary").requiredOption("--id <id>", "Channel identifier").option("--transport <kind>", "Transport kind: webhook or command", "webhook").option("--name <name>", "Display name").option("--type <pattern>", "Event type filter, e.g. todos.task.*").option("--source <pattern>", "Event source filter").option("--subject <pattern>", "Event subject filter").option("--severity <pattern>", "Event severity filter").option("--data <path=value...>", "Event data field filter; string values, path!=value negatives, array-member matching, dot paths, * segment wildcard, ** recursive wildcard", collectValues, []).option("--metadata <path=value...>", "Event metadata field filter; string values, path!=value negatives, array-member matching, dot paths, * segment wildcard, ** recursive wildcard", collectValues, []).option("--data-json <path=json...>", "Event data field filter with typed JSON value; path!=json negatives supported", collectValues, []).option("--metadata-json <path=json...>", "Event metadata field filter with typed JSON value; path!=json negatives supported", collectValues, []).option("--secret <secret>", "Webhook HMAC secret").option("--header <name=value...>", "Webhook header", collectValues, []).option("--arg <arg...>", "Command argument", collectValues, []).option("--timeout-ms <ms>", "Transport timeout in milliseconds", parseNumber).option("--retry-attempts <n>", "Maximum delivery attempts", parseNumber).option("--retry-backoff-ms <ms>", "Initial retry backoff in milliseconds", parseNumber).option("--redact <path...>", "Event field path to redact before delivery", collectValues, []).option("--disabled", "Create channel disabled", false).option("-j, --json", "Print JSON output", false).action(async (target, actionOptions, command) => {
    const timestamp = new Date().toISOString();
    const channel = {
      id: actionOptions.id,
      name: actionOptions.name,
      enabled: !actionOptions.disabled,
      transport: actionOptions.transport,
      filters: parseFilterOptions(actionOptions),
      retry: actionOptions.retryAttempts || actionOptions.retryBackoffMs ? { maxAttempts: actionOptions.retryAttempts, backoffMs: actionOptions.retryBackoffMs } : undefined,
      redact: actionOptions.redact?.length ? { paths: actionOptions.redact } : undefined,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    if (actionOptions.transport === "webhook") {
      channel.webhook = { url: target, secret: actionOptions.secret, headers: parseHeaders(actionOptions.header), timeoutMs: actionOptions.timeoutMs };
    } else if (actionOptions.transport === "command") {
      channel.command = { command: target, args: actionOptions.arg ?? [], timeoutMs: actionOptions.timeoutMs };
    } else {
      throw new Error(`Transport ${actionOptions.transport} is reserved for future use and cannot be added yet`);
    }
    const saved = await createClient(options).addChannel(channel);
    print(sanitizeChannelForOutput(saved), wantsJson(actionOptions, command), `Added ${saved.transport} channel ${saved.id}`);
  });
  channels.command("list").description("List configured channels").option("-j, --json", "Print JSON output", false).action(async (actionOptions, command) => {
    const channels2 = await createClient(options).listChannels();
    if (wantsJson(actionOptions, command)) {
      console.log(JSON.stringify(sanitizeChannelsForOutput(channels2), null, 2));
      return;
    }
    if (!channels2.length) {
      console.log("No channels configured.");
      return;
    }
    for (const channel of channels2) {
      console.log(`${channel.id}	${channel.enabled ? "enabled" : "disabled"}	${channel.transport}	${channel.webhook?.url ?? channel.command?.command ?? channel.transport}`);
    }
  });
  channels.command("status").description("Show events channel storage status").option("-j, --json", "Print JSON output", false).action(async (actionOptions, command) => {
    const status = await getEventsStatus(options.dataDir);
    print(status, wantsJson(actionOptions, command), `events dataDir: ${status.dataDir}`);
  });
  channels.command("remove").description("Remove a channel").argument("<id>", "Channel identifier").option("-j, --json", "Print JSON output", false).action(async (id, actionOptions, command) => {
    const removed = await createClient(options).removeChannel(id);
    print({ removed }, wantsJson(actionOptions, command), removed ? `Removed ${id}` : `Channel not found: ${id}`);
  });
  channels.command("test").description("Send a test event to one channel").argument("<id>", "Channel identifier").option("--source <source>", "Event source override").option("--type <type>", "Event type", "events.test").option("--subject <subject>", "Event subject").option("--message <message>", "Event message", "Hasna events test delivery").option("--data <json>", "Event data JSON object").option("--metadata <json>", "Event metadata JSON object").option("--honor-filters", "Skip delivery when the sample event does not match channel filters", false).option("-j, --json", "Print JSON output", false).action(async (id, actionOptions, command) => {
    const json = wantsJson(actionOptions, command);
    try {
      const result = await createClient(options).testChannel(id, {
        source: actionOptions.source ?? options.source,
        type: actionOptions.type,
        subject: actionOptions.subject ?? id,
        message: actionOptions.message,
        data: parseJsonObject(actionOptions.data, { test: true }),
        metadata: parseJsonObject(actionOptions.metadata, {})
      }, { honorFilters: actionOptions.honorFilters });
      print(result, json, `${result.status}: ${result.channelId}`);
      if (result.status === "failed")
        process.exitCode = 1;
    } catch (error) {
      fail(error, json);
    }
  });
  channels.command("match").description("Check whether a sample event matches one channel without delivering").argument("<id>", "Channel identifier").option("--source <source>", "Event source override").option("--type <type>", "Event type", "events.test").option("--subject <subject>", "Event subject").option("--message <message>", "Event message", "Hasna events match preview").option("--data <json>", "Event data JSON object").option("--metadata <json>", "Event metadata JSON object").option("-j, --json", "Print JSON output", false).action(async (id, actionOptions, command) => {
    const json = wantsJson(actionOptions, command);
    try {
      const result = await createClient(options).matchChannel(id, {
        source: actionOptions.source ?? options.source,
        type: actionOptions.type,
        subject: actionOptions.subject ?? id,
        message: actionOptions.message,
        data: parseJsonObject(actionOptions.data, { test: true }),
        metadata: parseJsonObject(actionOptions.metadata, {})
      });
      print(result, json, `${result.matched ? "matched" : "skipped"}: ${result.channelId}`);
    } catch (error) {
      fail(error, json);
    }
  });
  return channels;
}
function registerEventCommands(program, options) {
  const events = program.command(options.eventsCommandName ?? "events").description("Emit, list, and replay Hasna events");
  events.command("emit").description("Emit an event from this app").argument("<type>", "Event type").option("--source <source>", "Event source override").option("--subject <subject>", "Event subject").option("--severity <severity>", "Event severity", "info").option("--message <message>", "Event message").option("--dedupe-key <key>", "Dedupe key").option("--data <json>", "Event data JSON object").option("--metadata <json>", "Event metadata JSON object").option("--no-deliver", "Record without delivering").option("--no-dedupe", "Allow duplicate id/dedupeKey events").option("-j, --json", "Print JSON output", false).action(async (type, actionOptions, command) => {
    const result = await createClient(options).emit({
      source: actionOptions.source ?? options.source,
      type,
      subject: actionOptions.subject,
      severity: actionOptions.severity,
      message: actionOptions.message,
      dedupeKey: actionOptions.dedupeKey,
      data: parseJsonObject(actionOptions.data, {}),
      metadata: parseJsonObject(actionOptions.metadata, {})
    }, { deliver: actionOptions.deliver, dedupe: actionOptions.dedupe });
    print(result, wantsJson(actionOptions, command), `${result.deduped ? "Deduped" : "Emitted"} ${result.event.id} to ${result.deliveries.length} channel(s)`);
  });
  const defaultListLimit = options.defaultEventListLimit ?? DEFAULT_EVENT_LIST_LIMIT;
  events.command("list").description("List recorded events").option("--source <source>", "Filter by source").option("--type <type>", "Filter by type").option("--limit <n>", `Limit to the most recent <n> events (default ${defaultListLimit}; use 0 for all)`, parseNumber, defaultListLimit).option("-j, --json", "Print JSON output", false).action(async (actionOptions, command) => {
    let rows = await createClient(options).listEvents();
    if (actionOptions.source)
      rows = rows.filter((event) => event.source === actionOptions.source);
    if (actionOptions.type)
      rows = rows.filter((event) => event.type === actionOptions.type);
    if (actionOptions.limit)
      rows = rows.slice(-actionOptions.limit);
    if (wantsJson(actionOptions, command)) {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    if (!rows.length) {
      console.log("No events recorded.");
      return;
    }
    for (const event of rows)
      console.log(`${event.time}	${event.id}	${event.source}	${event.type}	${event.severity}`);
  });
  events.command("replay").description("Replay recorded events").option("--id <id>", "Replay one event id").option("--source <source>", "Filter by source").option("--type <type>", "Filter by type").option("--cursor <cursor>", "Opaque replay cursor from a previous page").option("--limit <n>", "Maximum events to replay", parseNumber).option("--dry-run", "Preview without delivery", false).option("-j, --json", "Print JSON output", false).action(async (actionOptions, command) => {
    const result = await createClient(options).replay({
      eventId: actionOptions.id,
      source: actionOptions.source,
      type: actionOptions.type,
      cursor: actionOptions.cursor,
      limit: actionOptions.limit,
      dryRun: actionOptions.dryRun
    });
    print(result, wantsJson(actionOptions, command), replaySummary(result.events.length, result.deliveries.length, result.nextCursor));
  });
  return events;
}
function registerEventsCommands(program, options) {
  registerChannelCommands(program, options);
  registerEventCommands(program, options);
}
function parseNumber(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed))
    throw new Error(`Expected a number, got ${value}`);
  return parsed;
}
function collectValues(value, previous) {
  previous.push(value);
  return previous;
}
function replaySummary(events, deliveries, nextCursor) {
  const suffix = nextCursor ? `, next cursor: ${nextCursor}` : "";
  return `Replayed ${events} event(s), ${deliveries} delivery result(s)${suffix}`;
}
export {
  registerEventsCommands,
  registerEventCommands,
  registerChannelCommands,
  DEFAULT_EVENT_LIST_LIMIT
};
