import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readOperatorStatusObservations, type OperatorConfigDocument, type OperatorStatusConfigReader } from "./operator-status-observations.js";

const PRIVATE = "opaque-private-observation-sentinel";
const account = "1".repeat(12);
const queue = (name = "Case_sensitive-queue.fifo", region = "us-east-1") => ["https://sqs.", region, ".amazonaws.com/", account, "/", name].join("");
let scratch: string;
let file: string;
let reads: number;
let environment: NodeJS.ProcessEnv;
let stateRoots: string[];
let savedExitCode: typeof process.exitCode;
let savedExit: typeof process.exit;
let savedFetch: typeof fetch;

beforeEach(() => {
  environment = { ...process.env };
  savedExitCode = process.exitCode;
  savedExit = process.exit;
  savedFetch = globalThis.fetch;
  scratch = mkdtempSync(join(tmpdir(), "emails-operator-observations-"));
  file = join(scratch, "operator.json");
  reads = 0;
  stateRoots = [];
  for (const [key, name] of Object.entries({ HOME: "home", XDG_CONFIG_HOME: "config", XDG_DATA_HOME: "data", XDG_CACHE_HOME: "cache", XDG_STATE_HOME: "state", HASNA_EMAILS_HOME: "app" })) {
    const path = join(scratch, name); mkdirSync(path, { mode: 0o700 }); process.env[key] = path; stateRoots.push(path);
  }
});
afterEach(() => {
  try {
    for (const path of stateRoots) expect(readdirSync(path)).toEqual([]);
    expect(process.exit).toBe(savedExit);
    expect(globalThis.fetch).toBe(savedFetch);
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!Object.prototype.hasOwnProperty.call(environment, key)) delete process.env[key];
    }
    Object.assign(process.env, environment);
    process.exitCode = savedExitCode ?? 0;
    rmSync(scratch, { recursive: true, force: true });
  }
});

function reader(defaultRegion?: string): OperatorStatusConfigReader {
  return { defaultRegion, read() {
    reads++;
    try { return { state: "present", json: readFileSync(file, "utf8") }; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { state: "absent" };
      throw error;
    }
  } };
}
function observe(document: unknown) {
  writeFileSync(file, JSON.stringify(document), { mode: 0o600 });
  const before = readFileSync(file);
  const value = readOperatorStatusObservations(reader());
  expect(readFileSync(file).equals(before)).toBe(true);
  expect(JSON.stringify(value).includes(PRIVATE)).toBe(false);
  return value;
}
function failed(value: ReturnType<typeof readOperatorStatusObservations>) {
  expect(value.inboundBuckets.items).toBeNull();
  expect(value.inboundBuckets.total).toBeNull();
  expect(value.realtime.queue_configured).toBeNull();
  expect(value.realtime.last_error).toBeNull();
  expect(value.inboundBuckets.availability.available).toBe(false);
  expect(value.realtime.availability.available).toBe(false);
  expect(Object.keys(value.gaps)).toHaveLength(6);
  expect(JSON.stringify(value).includes(PRIVATE)).toBe(false);
}

describe("explicit operator document observations", () => {
  it("distinguishes no reader authority from a genuinely absent and then empty private document", () => {
    failed(readOperatorStatusObservations(null));
    expect(reads).toBe(0);
    const absent = readOperatorStatusObservations(reader());
    expect(absent.inboundBuckets.items).toEqual([]);
    expect(absent.realtime.queue_configured).toBe(false);
    expect(absent.realtime.availability.basis).toBe("local_config");
    expect(absent.gaps).toEqual({});
    const empty = observe({});
    expect(empty).toEqual(absent);
    expect(reads).toBe(2);
  });
  it("reads a real caller-owned FD once without closing it and rereads changed evidence", () => {
    writeFileSync(file, "{}", { mode: 0o600 });
    const fd = openSync(file, "r");
    try {
      const source: OperatorStatusConfigReader = { defaultRegion: undefined, read() { reads++; return { state: "present", json: readFileSync(fd, "utf8") }; } };
      expect(readOperatorStatusObservations(source).inboundBuckets.total).toBe(0);
      expect(reads).toBe(1);
      expect(readFileSync(fd, "utf8")).toBe("");
    } finally { closeSync(fd); }
    const changed = observe({ inbound_realtime_last_error: PRIVATE });
    expect(changed.realtime.last_error).toBe("Recorded realtime error (details redacted)");
    expect(reads).toBe(2);
  });
  it("uses first duplicate/list-over-single priority and only explicit default-region evidence", () => {
    const doc = { inbound_s3_buckets: [
      { bucket: "first", region: "eu-west-1", providerId: "provider-a", credentials: { value: PRIVATE } },
      { bucket: "first", region: "us-west-1", providerId: "provider-b" },
      { bucket: "second", region: "eu-west-2" },
    ], inbound_s3_bucket: "first", inbound_s3_region: "ap-east-1", extra: PRIVATE };
    const value = observe(doc);
    expect(value.inboundBuckets.items).toEqual([{ bucket: "first", region: "eu-west-1", providerId: "provider-a" }, { bucket: "second", region: "eu-west-2" }]);
    expect(value.inboundBuckets.total).toBe(2);
    process.env.AWS_REGION = "ambient-not-authority";
    writeFileSync(file, JSON.stringify({ inbound_s3_bucket: "single" }));
    expect(readOperatorStatusObservations(reader("eu-north-1")).inboundBuckets.items).toEqual([{ bucket: "single", region: "eu-north-1" }]);
    expect(readOperatorStatusObservations(reader()).inboundBuckets.items).toEqual([{ bucket: "single", region: "us-east-1" }]);
    writeFileSync(file, JSON.stringify({ inbound_s3_bucket: "single", inbound_s3_region: "ap-east-1" }));
    expect(readOperatorStatusObservations(reader("eu-north-1")).inboundBuckets.items).toEqual([{ bucket: "single", region: "ap-east-1" }]);
  });
  for (const [label, json] of [["syntax", "{"], ["array", "[]"], ["null", "null"], ["string", JSON.stringify(PRIVATE)]]) {
    it(`does not turn ${label} documents into measured empty configuration`, () => {
      writeFileSync(file, json!, { mode: 0o600 });
      failed(readOperatorStatusObservations(reader()));
      expect(reads).toBe(1);
    });
  }
  it("does not turn a genuine unreadable private FD into absence", () => {
    writeFileSync(file, "{}", { mode: 0o600 }); const fd = openSync(file, "r"); closeSync(fd);
    failed(readOperatorStatusObservations({ defaultRegion: undefined, read() { reads++; return { state: "present", json: readFileSync(fd, "utf8") }; } }));
    expect(reads).toBe(1);
  });
  for (const value of [null, { state: "unknown" }, { state: "present", json: 0 }, { state: "absent", json: PRIVATE }, { state: "present", json: "{}", extra: PRIVATE }]) {
    it("rejects invalid reader protocol without copying values", () => {
      failed(readOperatorStatusObservations({ defaultRegion: undefined, read: () => value as OperatorConfigDocument }));
    });
  }
  it("never reflects thrown objects, getters or non-Error values", () => {
    for (const value of [PRIVATE, { get message() { throw new Error(PRIVATE); } }, new Error(PRIVATE)]) {
      failed(readOperatorStatusObservations({ defaultRegion: undefined, read() { throw value; } }));
    }
  });
  it("does not accept inherited protocol fields in place of a raw document", () => {
    const inherited = Object.assign(Object.create({ state: "present", json: "{}" }), { first: PRIVATE, second: PRIVATE });
    failed(readOperatorStatusObservations({ defaultRegion: undefined, read: () => inherited }));
  });
  for (const value of [null, {}, [null], [{ bucket: "valid" }], [{ bucket: "", region: "us-east-1" }], [{ bucket: "valid", region: 3 }]]) {
    it("refuses malformed bucket shapes without erasing independent realtime observations", () => {
      const observed = observe({ inbound_s3_buckets: value, inbound_realtime_last_error: PRIVATE });
      expect(observed.inboundBuckets.total).toBeNull();
      expect(observed.inboundBuckets.availability.available).toBe(false);
      expect(observed.realtime.availability.available).toBe(true);
      expect(observed.realtime.last_error).toBe("Recorded realtime error (details redacted)");
    });
  }
});

describe("safe operator realtime value projection", () => {
  it("enforces the exact region length boundary without reinterpreting the queue", () => {
    const valid = queue("x", "us-" + "a".repeat(58) + "-1");
    expect(observe({ inbound_realtime_queue_url: valid }).realtime.queue_url === valid).toBe(true);
    const unsafe = observe({ inbound_realtime_queue_url: queue("x", "us-" + "a".repeat(59) + "-1") });
    expect(unsafe.realtime.queue_configured).toBe(true); expect(unsafe.realtime.queue_url).toBeNull();
  });
  for (const length of [11, 13]) it(`withholds a noncanonical ${length}-digit account segment`, () => {
    const result = observe({ inbound_realtime_queue_url: queue().replace(account, "1".repeat(length)) });
    expect(result.realtime.queue_configured).toBe(true); expect(result.realtime.queue_url).toBeNull();
  });
  it("isolates an unreadable default-region property from recorded realtime error presence", () => {
    writeFileSync(file, JSON.stringify({ inbound_realtime_last_error: PRIVATE }), { mode: 0o600 });
    const source = reader(); Object.defineProperty(source, "defaultRegion", { get() { throw new Error(PRIVATE); } });
    const observed = readOperatorStatusObservations(source);
    expect(observed.inboundBuckets.total).toBeNull(); expect(observed.realtime.availability.available).toBe(true);
    expect(observed.realtime.last_error).toBe("Recorded realtime error (details redacted)");
    expect(Object.keys(observed.gaps)).toHaveLength(2); expect(JSON.stringify(observed).includes(PRIVATE)).toBe(false); expect(reads).toBe(1);
  });
  for (const name of ["a", "Case_sensitive-queue", "f.fifo", "A".repeat(80), "A".repeat(75) + ".fifo"]) {
    it("preserves only an exact ordinary credential-free queue identity", () => {
      const url = queue(name), observed = observe({ inbound_realtime_queue_url: url });
      expect(observed.realtime.queue_configured).toBe(true);
      expect(observed.realtime.queue_url === url).toBe(true);
      expect(observed.gaps).toEqual({});
    });
  }
  const unsafe = [queue("A".repeat(81)), queue("x.fifo.fifo"), queue(""), queue("x/extra"), queue("x/"),
    queue("x%2fy"), queue("x\\y"), queue().replace("https:", "http:"), queue().replace("sqs.", PRIVATE + "@sqs."),
    queue().replace(".com/", ".com:443/"), queue().replace(".com/", ".com.spoof/"), queue() + "?v=" + PRIVATE,
    queue() + "#" + PRIVATE, " " + queue(), queue() + "\n", queue() + "\u0000", queue("x", "UPPER-region-1"),
    queue("x", "us-" + "a".repeat(60) + "-1"), PRIVATE];
  for (const [index, url] of unsafe.entries()) it(`withholds unsafe queue identity ${index} without claiming absence or reachability`, () => {
    const observed = observe({ inbound_realtime_queue_url: url, inbound_realtime_last_error: PRIVATE });
    expect(observed.realtime.queue_configured).toBe(true);
    expect(observed.realtime.queue_url).toBeNull();
    expect(observed.realtime.last_error).toBe("Recorded realtime error (details redacted)");
    expect(observed.gaps["inbox.realtime.queue_url"]?.reason).toBe("source_unreachable:operator_value_not_publishable — The queue setting is present, but its URL identity is withheld because it is not a recognized credential-free SQS URL; no reachability check was performed.");
  });
  for (const value of [null, "", " \n\t"]) it("keeps a measured absent queue separate from an old recorded error", () => {
    const observed = observe({ inbound_realtime_queue_url: value, inbound_realtime_last_error: PRIVATE });
    expect(observed.realtime.queue_configured).toBe(false);
    expect(observed.realtime.last_error).toBe("Recorded realtime error (details redacted)");
    expect(observed.gaps).toEqual({});
  });
  for (const value of [false, 0, {}, []]) it("keeps invalid queue type unknown while retaining independent error presence", () => {
    const observed = observe({ inbound_realtime_queue_url: value, inbound_realtime_last_error: PRIVATE });
    expect(observed.realtime.queue_configured).toBeNull();
    expect(observed.realtime.last_error).toBe("Recorded realtime error (details redacted)");
    expect(Object.keys(observed.gaps)).toEqual(["inbox.realtime.queue_configured", "inbox.realtime.queue_url"]);
  });
  for (const value of ["benign error", PRIVATE, "Error: " + PRIVATE, JSON.stringify({ safe: PRIVATE }), "\u0000\u001b" + PRIVATE]) it("projects every nonblank error to the identical presence marker", () => {
    const observed = observe({ inbound_realtime_last_error: value });
    expect(observed.realtime.last_error).toBe("Recorded realtime error (details redacted)");
    expect(observed.gaps).toEqual({});
  });
  for (const value of [null, "", " \n"]) it("does not claim health from absent recorded error text", () => {
    const observed = observe({ inbound_realtime_last_error: value });
    expect(observed.realtime.last_error).toBeNull();
    expect(observed.gaps).toEqual({});
    expect(JSON.stringify(observed).includes("healthy")).toBe(false);
  });
  for (const value of [false, 0, {}, []]) it("marks invalid error types unavailable, never healthy", () => {
    const observed = observe({ inbound_realtime_last_error: value });
    expect(observed.realtime.last_error).toBeNull();
    expect(observed.gaps["inbox.realtime.last_error"]?.reason).toMatch(/^source_unreachable:operator_value_invalid/);
  });
  for (const value of ["2026-09-03T00:00:00.000Z", "2024-02-29T23:59:59.123Z", "+010000-01-01T00:00:00.000Z"]) it("preserves canonical finite UTC producer timestamps exactly", () => {
    expect(observe({ inbound_realtime_last_poll_at: value }).realtime.last_poll_at).toBe(value);
  });
  for (const value of [PRIVATE, "2026-02-30T00:00:00.000Z", "2026-09-03T00:00:00Z", "2026-09-03T00:00:00.000+00:00", "2026-09-03t00:00:00.000z", false, 0]) it("nulls impossible, noncanonical or non-string poll evidence with a fixed field gap", () => {
    const observed = observe({ inbound_realtime_last_poll_at: value });
    expect(observed.realtime.last_poll_at).toBeNull();
    expect(observed.gaps["inbox.realtime.last_poll_at"]?.reason).toMatch(/^source_unreachable:operator_value_invalid/);
  });
});
