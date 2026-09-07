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
