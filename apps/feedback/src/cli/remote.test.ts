import { describe, expect, test } from "bun:test";
import { buildDoctorReport, resolveApiTarget } from "./index.js";

describe("resolveApiTarget — a fleet-wide 'the service lives here' setting", () => {
  test("with nothing configured the CLI stays local", () => {
    expect(resolveApiTarget({}, {})).toBeNull();
  });

  test("FEEDBACK_API_URL selects the remote path without retyping --api-url every call", () => {
    const target = resolveApiTarget({}, { FEEDBACK_API_URL: "https://feedback.example.test/" });
    expect(target?.apiUrl).toBe("https://feedback.example.test/");
  });

  test("an explicit --api-url beats the environment", () => {
    const target = resolveApiTarget(
      { apiUrl: "https://override.example.test/" },
      { FEEDBACK_API_URL: "https://feedback.example.test/" },
    );
    expect(target?.apiUrl).toBe("https://override.example.test/");
  });

  test("--token beats FEEDBACK_API_TOKEN", () => {
    const target = resolveApiTarget(
      { apiUrl: "https://feedback.example.test/", token: "flag-token" },
      { FEEDBACK_API_TOKEN: "env-token" },
    );
    expect(target?.token).toBe("flag-token");
  });

  test("a blank FEEDBACK_API_URL is treated as unset, not as an empty base URL", () => {
    expect(resolveApiTarget({}, { FEEDBACK_API_URL: "   " })).toBeNull();
  });
});

describe("doctor reports the task sink so an open loop is visible", () => {
  test("shows the resolved sink and that it is enabled", async () => {
    const report = await buildDoctorReport({ PATH: "", FEEDBACK_TASK_SINK: "none" });
    expect(report.taskSink.kind).toBe("none");
    expect(report.taskSink.enabled).toBe(false);
    // A disabled sink is a deliberate configuration, not a fault.
    expect(report.ok).toBe(true);
  });

  test("an explicitly requested sink that cannot run makes doctor NOT ok", async () => {
    const report = await buildDoctorReport({ PATH: "", FEEDBACK_TASK_SINK: "todos" });
    expect(report.taskSink.ok).toBe(false);
    expect(report.ok).toBe(false);
  });

  test("reports the remote target when one is configured, and never the token value", async () => {
    const report = await buildDoctorReport({
      PATH: "",
      FEEDBACK_TASK_SINK: "none",
      FEEDBACK_API_URL: "https://feedback.example.test/",
      FEEDBACK_API_TOKEN: "super-secret-token",
    });
    expect(report.apiUrl).toBe("https://feedback.example.test/");
    expect(report.apiTokenConfigured).toBe(true);
    expect(JSON.stringify(report)).not.toContain("super-secret-token");
  });
});

describe("doctor must describe the store the CLI will actually use", () => {
  test("with a remote configured it reports the remote as the target, not a local file", async () => {
    const report = await buildDoctorReport({
      PATH: "",
      FEEDBACK_TASK_SINK: "none",
      FEEDBACK_API_URL: "https://feedback.example.test/",
    });
    expect(report.target).toBe("remote");
    // Claiming a local data file the CLI will never write to is what made
    // doctor gate the wrong thing.
    expect(report.dataFile).toBeUndefined();
    expect(report.dataDirWritable).toBeNull();
    expect(report.dataFileReadable).toBeNull();
  });

  test("with no remote it reports local", async () => {
    const report = await buildDoctorReport({ PATH: "", FEEDBACK_TASK_SINK: "none" });
    expect(report.target).toBe("local");
    expect(report.dataFile).toBeTruthy();
  });
});
