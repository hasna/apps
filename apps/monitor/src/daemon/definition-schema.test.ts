/**
 * MON-V2-04 cycle-1 regression — the daemon path validates slug definitions
 * against a strict definition schema that embodies the MON-V2-01 contract
 * (CommandSpec argv-only commands; no shell strings, no shell mode, no
 * interpolation). A definition the wave's own schema accepts must register;
 * a definition carrying a shell string or shell mode must be refused at
 * registration, never executed.
 */

import { describe, it, expect } from "bun:test";
import { validateSlugDefinition } from "./definition-schema.js";

describe("validateSlugDefinition", () => {
  it("accepts a schema-valid definition with a CommandSpec check", () => {
    const result = validateSlugDefinition({
      schemaVersion: 2,
      name: "pulse",
      cadence: { type: "interval", seconds: 300 },
      execution: { maxAttempts: 1 },
      checks: [
        {
          id: "c1",
          command: { executable: "echo", args: ["ok"], timeoutSeconds: 30 },
          expect: { exit: 0 },
        },
      ],
      checksAggregate: { mode: "all" },
    });
    expect(result.ok).toBe(true);
  });

  it("accepts the wave schema's cron cadence shape (expression + timezone)", () => {
    const result = validateSlugDefinition({
      schemaVersion: 2,
      name: "pulse",
      cadence: { type: "cron", expression: "*/5 * * * *", timezone: "UTC" },
      checks: [
        {
          id: "c1",
          command: { executable: "echo", args: ["ok"], timeoutSeconds: 30 },
          expect: { exit: 0 },
        },
      ],
      checksAggregate: { mode: "all" },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a shell-string command", () => {
    const result = validateSlugDefinition({
      schemaVersion: 2,
      name: "pulse",
      cadence: { type: "interval", seconds: 300 },
      checks: [{ id: "c1", command: "echo ok", expect: { exit: 0 } }],
      checksAggregate: { mode: "all" },
    });
    expect(result.ok).toBe(false);
    expect((result as { errors: string[] }).errors.join("\n")).toContain("command");
  });

  it("rejects sh -c mode (executable sh with a -c flag)", () => {
    const result = validateSlugDefinition({
      schemaVersion: 2,
      name: "pulse",
      cadence: { type: "interval", seconds: 300 },
      checks: [
        {
          id: "c1",
          command: { executable: "sh", args: ["-c", "echo ok"], timeoutSeconds: 30 },
          expect: { exit: 0 },
        },
      ],
      checksAggregate: { mode: "all" },
    });
    expect(result.ok).toBe(false);
    expect((result as { errors: string[] }).errors.join("\n")).toContain("shell");
  });

  it("rejects shell interpolation inside argv", () => {
    const result = validateSlugDefinition({
      schemaVersion: 2,
      name: "pulse",
      cadence: { type: "interval", seconds: 300 },
      checks: [
        {
          id: "c1",
          command: { executable: "echo", args: ["$(id)"], timeoutSeconds: 30 },
          expect: { exit: 0 },
        },
      ],
      checksAggregate: { mode: "all" },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects the legacy every-string cadence shape", () => {
    const result = validateSlugDefinition({
      schemaVersion: 2,
      name: "pulse",
      cadence: { type: "interval", every: "5m" },
      checks: [
        {
          id: "c1",
          command: { executable: "echo", args: ["ok"], timeoutSeconds: 30 },
          expect: { exit: 0 },
        },
      ],
      checksAggregate: { mode: "all" },
    });
    expect(result.ok).toBe(false);
    expect((result as { errors: string[] }).errors.join("\n")).toContain("cadence");
  });
});
