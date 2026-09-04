import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildDoctorReport, localModeOptedIn } from "./index.js";

describe("feedback CLI diagnostics", () => {
  test("reports local runtime readiness when the on-box store is explicitly opted into", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "feedback-cli-"));
    const report = await buildDoctorReport({
      FEEDBACK_DATA_DIR: dataDir,
      FEEDBACK_LOCAL: "1",
      PATH: "",
    });

    expect(report).toMatchObject({
      ok: true,
      target: "local",
      blockers: [],
      runtime: {
        mode: "local",
        engine: "sqlite",
        activeStore: "local-sqlite",
        ok: true,
      },
      dataDirWritable: true,
      dataFileReadable: true,
      apiTokenConfigured: false,
    });
    expect(report.dataFile).toBe(join(dataDir, "feedback.db"));
  });

  test("reports the JSONL data file when the legacy engine is selected", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "feedback-cli-"));
    const report = await buildDoctorReport({
      FEEDBACK_DATA_DIR: dataDir,
      FEEDBACK_STORE: "jsonl",
      FEEDBACK_LOCAL: "true",
      PATH: "",
    });

    expect(report).toMatchObject({ ok: true, target: "local", runtime: { engine: "jsonl", activeStore: "local-jsonl" } });
    expect(report.dataFile).toBe(join(dataDir, "feedback.jsonl"));
  });

  test("fails closed when neither a hosted service nor an explicit local opt-in is configured", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "feedback-cli-"));
    const report = await buildDoctorReport({
      FEEDBACK_DATA_DIR: dataDir,
      PATH: "",
    });

    expect(report.ok).toBe(false);
    expect(report.target).toBe("none");
    // No store is probed in the fail-closed state: doctor must not create or
    // touch local storage when the run would not be allowed to use it.
    expect(report.dataFile).toBeUndefined();
    expect(report.dataDirWritable).toBeNull();
    expect(report.dataFileReadable).toBeNull();
    const blockers = report.blockers.join(" ");
    expect(blockers).toContain("FEEDBACK_API_URL");
    expect(blockers).toContain("FEEDBACK_LOCAL");
    expect(await readdir(dataDir)).toEqual([]);
  });

  test("a hosted FEEDBACK_API_URL makes doctor remote, whatever the local opt-in says", async () => {
    const report = await buildDoctorReport({
      FEEDBACK_API_URL: "https://feedback.example.test/",
      FEEDBACK_LOCAL: "1",
      FEEDBACK_TASK_SINK: "none",
      PATH: "",
    });
    expect(report.target).toBe("remote");
    expect(report.blockers).toEqual([]);
    expect(report.ok).toBe(true);
  });

  test("localModeOptedIn honours only explicit truthy values", () => {
    expect(localModeOptedIn({ FEEDBACK_LOCAL: "1" })).toBe(true);
    expect(localModeOptedIn({ HASNA_FEEDBACK_LOCAL: "1" })).toBe(true);
    expect(localModeOptedIn({ FEEDBACK_LOCAL: "true" })).toBe(true);
    expect(localModeOptedIn({ FEEDBACK_LOCAL: "0" })).toBe(false);
    expect(localModeOptedIn({ FEEDBACK_LOCAL: "" })).toBe(false);
    expect(localModeOptedIn({})).toBe(false);
  });

  test("reports cloud blockers without exposing configured values", async () => {
    const report = await buildDoctorReport({
      FEEDBACK_STORE: "cloud",
      FEEDBACK_API_TOKEN: "server-token",
      FEEDBACK_CLOUD_PROVIDER: "aws-rds",
      FEEDBACK_CLOUD_DATABASE_URL: "postgres://user:secret-value@example.test/feedback",
      FEEDBACK_CLOUD_SECRET_ARN: "arn:aws:secretsmanager:example:secret:secret-value",
      FEEDBACK_CLOUD_RESOURCE_ARN: "arn:aws:rds:example:cluster:feedback",
      FEEDBACK_CLOUD_TABLE: "feedback_items",
      PATH: "",
    });

    expect(report).toMatchObject({
      ok: false,
      runtime: {
        mode: "cloud",
        activeStore: "unavailable",
        ok: false,
        cloud: {
          provider: "aws-rds",
          databaseUrlConfigured: true,
          secretArnConfigured: true,
          resourceArnConfigured: true,
          tableNameConfigured: true,
          adapterProvided: false,
        },
      },
      dataDirWritable: null,
      dataFileReadable: null,
      apiTokenConfigured: true,
    });
    expect(report.runtime.blockers.join(" ")).toContain("host-provided FeedbackStore adapter");
    expect(JSON.stringify(report)).not.toContain("secret-value");
    expect(JSON.stringify(report)).not.toContain("postgres://");
  });

  test("does not echo invalid backend values", async () => {
    const report = await buildDoctorReport({
      FEEDBACK_STORAGE_BACKEND: "postgres://user:secret-value@example.test/feedback",
      PATH: "",
    });

    expect(report).toMatchObject({
      ok: false,
      runtime: {
        mode: "invalid",
        requestedMode: "invalid",
        activeStore: "unavailable",
        ok: false,
      },
    });
    expect(report.runtime.blockers.join(" ")).toContain("Unsupported FEEDBACK_STORE");
    expect(JSON.stringify(report)).not.toContain("secret-value");
    expect(JSON.stringify(report)).not.toContain("postgres://");
  });
});
