import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "bun:test";
import { chmodSync, mkdirSync, rmSync, existsSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import {
  loadConfig, saveConfig, getConfigValue, setConfigValue,
  getDefaultProviderId, getFailoverProviderIds, getInboundAttachmentStorageConfig,
  CANONICAL_OPEN_EMAILS_S3_BUCKET,
  CANONICAL_OPEN_EMAILS_S3_REGION,
  CANONICAL_OPEN_EMAILS_SECRET_PATHS,
  CANONICAL_OPEN_EMAILS_RDS_CLUSTER,
  CANONICAL_OPEN_EMAILS_RDS_DATABASE,
  CANONICAL_OPEN_EMAILS_RDS_SECRET_PATH,
  getCanonicalOpenEmailsRdsConfig,
} from "./config.js";
import { resetSelfHostedConfigCache } from "../db/self-hosted-store.js";

let INHERITED_PROCESS_ENV: NodeJS.ProcessEnv;
let origHome: string | undefined;
function captureInheritedProcessEnv(): void {
  INHERITED_PROCESS_ENV = { ...process.env };
  origHome = process.env.HOME;
}
function restoreInheritedProcessEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!Object.prototype.hasOwnProperty.call(INHERITED_PROCESS_ENV, key)) delete process.env[key];
  }
  Object.assign(process.env, INHERITED_PROCESS_ENV);
}

// Use a temp dir unique per test run to isolate from real ~/.hasna/emails
const TMP_HOME = join("/tmp", `emails-config-test-${process.pid}`);

// The client-backend tests set the API credentials explicitly inside the tests
// that need the API context; everything else runs against the local SQLite
// default. The selector variable is gone and never read.
const SELF_HOSTED_URL = "https://emails.config.test";
const SELF_HOSTED_KEY = "config-test-api-key";
const SELF_HOSTED_ENV_KEYS = [
  "EMAILS_CLIENT_ENV_SECRET",
  "HASNA_EMAILS_API_URL",
  "HASNA_EMAILS_API_KEY",
  "EMAILS_SESSION_TOKEN",
  "EMAILS_IDP_TOKEN",
] as const;

beforeEach(() => {
  captureInheritedProcessEnv();
  // 0700, not the umask default: the store-seam selection resolves the default
  // database path under HOME, and the SQLite directory-safety check refuses a
  // world-writable tmp ancestor.
  mkdirSync(TMP_HOME, { recursive: true, mode: 0o700 });
  process.env.HOME = TMP_HOME;
  for (const key of SELF_HOSTED_ENV_KEYS) delete process.env[key];
  resetSelfHostedConfigCache();
});

afterEach(() => {
  if (origHome === undefined) delete process.env.HOME;
  else process.env.HOME = origHome;
  if (existsSync(TMP_HOME)) rmSync(TMP_HOME, { recursive: true, force: true });
  for (const key of SELF_HOSTED_ENV_KEYS) delete process.env[key];
  resetSelfHostedConfigCache();
  restoreInheritedProcessEnv();
});

describe("config", () => {
  it("loadConfig returns empty object when no file exists", () => {
    expect(loadConfig()).toEqual({});
  });

  it("saveConfig creates the file and directory", () => {
    saveConfig({ "my-key": "my-value" });
    expect(existsSync(join(TMP_HOME, ".hasna", "emails", "config.json"))).toBe(true);
  });

  it("stores config in a private directory and file", () => {
    saveConfig({ resend_api_key: "secret-key" });
    const dirMode = statSync(join(TMP_HOME, ".hasna", "emails")).mode & 0o777;
    const fileMode = statSync(join(TMP_HOME, ".hasna", "emails", "config.json")).mode & 0o777;
    expect(dirMode).toBe(0o700);
    expect(fileMode).toBe(0o600);
  });

  it("repairs loose permissions when loading an existing config", () => {
    const dir = join(TMP_HOME, ".hasna", "emails");
    const configPath = join(dir, "config.json");
    mkdirSync(dir, { recursive: true, mode: 0o755 });
    writeFileSync(configPath, JSON.stringify({ resend_api_key: "secret-key" }), { mode: 0o644 });
    chmodSync(dir, 0o755);
    chmodSync(configPath, 0o644);

    expect(loadConfig()["resend_api_key"]).toBe("secret-key");
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(configPath).mode & 0o777).toBe(0o600);
  });

  it("loadConfig reads back saved config", () => {
    saveConfig({ "test-key": 42 });
    expect(loadConfig()["test-key"]).toBe(42);
  });

  it("returns a defensive copy when serving cached config", () => {
    saveConfig({ nested: { value: 1 }, buckets: [{ bucket: "a", region: "us-east-1" }] });
    const first = loadConfig() as { nested: { value: number }; buckets: Array<{ bucket: string }> };
    first.nested.value = 2;
    first.buckets[0]!.bucket = "mutated";
    (first as Record<string, unknown>)["new-key"] = "leaked";

    expect(loadConfig()).toEqual({ nested: { value: 1 }, buckets: [{ bucket: "a", region: "us-east-1" }] });
  });

  it("notices external config file changes after a cached read", () => {
    saveConfig({ "test-key": "old" });
    expect(loadConfig()["test-key"]).toBe("old");

    const configPath = join(TMP_HOME, ".hasna", "emails", "config.json");
    writeFileSync(configPath, JSON.stringify({ "test-key": "new", "extra-padding": "changed-size" }, null, 2));

    expect(loadConfig()["test-key"]).toBe("new");
  });

  it("loadConfig returns empty object for malformed JSON", () => {
    const configPath = join(TMP_HOME, ".hasna", "emails", "config.json");
    mkdirSync(join(TMP_HOME, ".hasna", "emails"), { recursive: true });
    writeFileSync(configPath, "{not json", "utf-8");

    expect(loadConfig()).toEqual({});
  });

  it("loadConfig returns empty object for non-object JSON", () => {
    const configPath = join(TMP_HOME, ".hasna", "emails", "config.json");
    mkdirSync(join(TMP_HOME, ".hasna", "emails"), { recursive: true });
    writeFileSync(configPath, "[]", "utf-8");

    expect(loadConfig()).toEqual({});
  });

  it("getConfigValue returns value for existing key", () => {
    saveConfig({ "bounce-alert-threshold": 5 });
    expect(getConfigValue("bounce-alert-threshold")).toBe(5);
  });

  it("getConfigValue returns undefined for missing key", () => {
    expect(getConfigValue("nonexistent")).toBeUndefined();
  });

  it("setConfigValue creates and updates value", () => {
    setConfigValue("my-setting", "hello");
    expect(getConfigValue("my-setting")).toBe("hello");
    setConfigValue("my-setting", "updated");
    expect(getConfigValue("my-setting")).toBe("updated");
  });

  it("getDefaultProviderId returns undefined when not set", () => {
    expect(getDefaultProviderId()).toBeUndefined();
  });

  it("getDefaultProviderId returns set value", () => {
    setConfigValue("default_provider", "prov-abc");
    expect(getDefaultProviderId()).toBe("prov-abc");
  });

  it("getFailoverProviderIds returns empty array when not set", () => {
    expect(getFailoverProviderIds()).toEqual([]);
  });

  it("getFailoverProviderIds parses comma-separated IDs", () => {
    setConfigValue("failover-providers", "id1, id2, id3");
    expect(getFailoverProviderIds()).toEqual(["id1", "id2", "id3"]);
  });

  it("getFailoverProviderIds filters empty strings", () => {
    setConfigValue("failover-providers", "id1,,id2");
    expect(getFailoverProviderIds()).toEqual(["id1", "id2"]);
  });

  it("getInboundAttachmentStorageConfig defaults local attachments to the filesystem", () => {
    expect(getInboundAttachmentStorageConfig()).toMatchObject({
      attachment_storage: "local",
      s3_region: "us-east-1",
      s3_prefix: "emails",
    });
  });

  it("getInboundAttachmentStorageConfig defaults API-client attachments to S3 when a bucket is configured", () => {
    const previousUrl = process.env["HASNA_EMAILS_API_URL"];
    const previousKey = process.env["HASNA_EMAILS_API_KEY"];
    try {
      process.env["HASNA_EMAILS_API_URL"] = "https://emails.example.invalid";
      process.env["HASNA_EMAILS_API_KEY"] = "test-key";
      setConfigValue("inbound_s3_bucket", "self-hosted-inbound");

      expect(getInboundAttachmentStorageConfig()).toMatchObject({
        attachment_storage: "s3",
        s3_bucket: "self-hosted-inbound",
        s3_region: "us-east-1",
        s3_prefix: "emails",
      });
    } finally {
      if (previousUrl === undefined) delete process.env["HASNA_EMAILS_API_URL"];
      else process.env["HASNA_EMAILS_API_URL"] = previousUrl;
      if (previousKey === undefined) delete process.env["HASNA_EMAILS_API_KEY"];
      else process.env["HASNA_EMAILS_API_KEY"] = previousKey;
    }
  });

  it("getInboundAttachmentStorageConfig avoids local attachment files for the API client without a bucket", () => {
    const previousUrl = process.env["HASNA_EMAILS_API_URL"];
    const previousKey = process.env["HASNA_EMAILS_API_KEY"];
    try {
      process.env["HASNA_EMAILS_API_URL"] = "https://emails.example.invalid";
      process.env["HASNA_EMAILS_API_KEY"] = "test-key";

      expect(getInboundAttachmentStorageConfig()).toMatchObject({
        attachment_storage: "none",
        s3_region: "us-east-1",
        s3_prefix: "emails",
      });
    } finally {
      if (previousUrl === undefined) delete process.env["HASNA_EMAILS_API_URL"];
      else process.env["HASNA_EMAILS_API_URL"] = previousUrl;
      if (previousKey === undefined) delete process.env["HASNA_EMAILS_API_KEY"];
      else process.env["HASNA_EMAILS_API_KEY"] = previousKey;
    }
  });

  it("getInboundAttachmentStorageConfig does not allow explicit local attachment storage for the API client", () => {
    const previousUrl = process.env["HASNA_EMAILS_API_URL"];
    const previousKey = process.env["HASNA_EMAILS_API_KEY"];
    try {
      process.env["HASNA_EMAILS_API_URL"] = "https://emails.example.invalid";
      process.env["HASNA_EMAILS_API_KEY"] = "test-key";
      setConfigValue("attachment_storage", "local");
      setConfigValue("attachment_s3_bucket", "self-hosted-attachments");

      expect(getInboundAttachmentStorageConfig()).toMatchObject({
        attachment_storage: "s3",
        s3_bucket: "self-hosted-attachments",
      });
    } finally {
      if (previousUrl === undefined) delete process.env["HASNA_EMAILS_API_URL"];
      else process.env["HASNA_EMAILS_API_URL"] = previousUrl;
      if (previousKey === undefined) delete process.env["HASNA_EMAILS_API_KEY"];
      else process.env["HASNA_EMAILS_API_KEY"] = previousKey;
    }
  });

  it("does not export concrete self-hosted infrastructure defaults in the OSS package", () => {
    expect(CANONICAL_OPEN_EMAILS_S3_BUCKET).toBeNull();
    expect(CANONICAL_OPEN_EMAILS_S3_REGION).toBe("us-east-1");
    expect(CANONICAL_OPEN_EMAILS_SECRET_PATHS).toEqual({
      env: null,
      aws: null,
      s3: null,
      rds: null,
    });
    expect(CANONICAL_OPEN_EMAILS_RDS_CLUSTER).toBeNull();
    expect(CANONICAL_OPEN_EMAILS_RDS_DATABASE).toBeNull();
    expect(CANONICAL_OPEN_EMAILS_RDS_SECRET_PATH).toBeNull();
    expect(getCanonicalOpenEmailsRdsConfig()).toEqual({
      cluster: null,
      database: null,
      runtimePath: null,
      env: "HASNA_EMAILS_DATABASE_URL",
      fallbackEnv: "HASNA_EMAILS_DATABASE_URL",
    });
  });

  it("getInboundAttachmentStorageConfig fails closed for explicit S3 storage without a bucket for the API client", () => {
    const previousUrl = process.env["HASNA_EMAILS_API_URL"];
    const previousKey = process.env["HASNA_EMAILS_API_KEY"];
    try {
      process.env["HASNA_EMAILS_API_URL"] = "https://emails.example.invalid";
      process.env["HASNA_EMAILS_API_KEY"] = "test-key";
      setConfigValue("attachment_storage", "s3");

      expect(getInboundAttachmentStorageConfig()).toMatchObject({
        attachment_storage: "none",
        s3_region: "us-east-1",
        s3_prefix: "emails",
      });
    } finally {
      if (previousUrl === undefined) delete process.env["HASNA_EMAILS_API_URL"];
      else process.env["HASNA_EMAILS_API_URL"] = previousUrl;
      if (previousKey === undefined) delete process.env["HASNA_EMAILS_API_KEY"];
      else process.env["HASNA_EMAILS_API_KEY"] = previousKey;
    }
  });

  it("getInboundAttachmentStorageConfig reads explicit inbound attachment overrides", () => {
    setConfigValue("attachment_storage", "s3");
    setConfigValue("attachment_s3_bucket", "attachments");
    setConfigValue("attachment_s3_region", "eu-west-1");
    setConfigValue("attachment_s3_prefix", "mail");

    expect(getInboundAttachmentStorageConfig()).toMatchObject({
      attachment_storage: "s3",
      s3_bucket: "attachments",
      s3_region: "eu-west-1",
      s3_prefix: "mail",
    });
  });

});

import { getInboundBuckets, addInboundBucket } from "./config.js";
describe("inbound buckets (multi-account)", () => {
  it("adds, dedupes, and backfills providerId", () => {
    addInboundBucket("bkt-a", "us-east-1", "prov-a");
    addInboundBucket("bkt-b", "eu-west-1", "prov-b");
    addInboundBucket("bkt-a", "us-east-1");            // dup, keep providerId
    const list = getInboundBuckets();
    const a = list.find((b) => b.bucket === "bkt-a")!;
    const b = list.find((b) => b.bucket === "bkt-b")!;
    expect(a.providerId).toBe("prov-a");
    expect(b.region).toBe("eu-west-1");
    expect(list.filter((x) => x.bucket === "bkt-a")).toHaveLength(1);
  });
});
