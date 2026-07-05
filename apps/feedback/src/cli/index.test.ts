import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildDoctorReport } from "./index.js";

describe("feedback CLI diagnostics", () => {
  test("reports local runtime readiness", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "open-feedback-cli-"));
    const report = await buildDoctorReport({
      FEEDBACK_DATA_DIR: dataDir,
      PATH: "",
    });

    expect(report).toMatchObject({
      ok: true,
      runtime: {
        mode: "local",
        activeStore: "local-jsonl",
        ok: true,
      },
      dataDirWritable: true,
      dataFileReadable: true,
      apiTokenConfigured: false,
    });
    expect(report.dataFile).toBe(join(dataDir, "feedback.jsonl"));
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
