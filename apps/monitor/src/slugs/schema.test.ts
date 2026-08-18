/**
 * MON-V2-01 — strict-schema fixtures for slug definitions (design section 3).
 *
 * Positive fixtures parse and are returned by SlugDefinitionSchema; negative
 * fixtures are rejected by `safeParse` with `success === false`. The schema is
 * strict: unknown keys are rejected, shell-shaped commands are rejected, and
 * only the supported predicate sets are accepted.
 */

import { describe, it, expect } from "bun:test";
import { SlugDefinitionSchema } from "./schema";

/**
 * Mutability-friendly fixture type: the schema under test is strict, so
 * fixtures intentionally carry values the schema would reject (unknown keys,
 * non-string labels, wrong types). Extra keys are permitted by the index
 * signature; declared leaves that tests mutate stay `unknown`-valued.
 */
interface FixtureCheck {
  id: string;
  command: Record<string, unknown>;
  expect: Record<string, unknown>;
  required?: boolean;
  [key: string]: unknown;
}

interface FixtureDefinition {
  schemaVersion: number;
  name: string;
  description?: string;
  tags?: string[];
  cadence: Record<string, unknown>;
  targets: { machineIds?: string[]; labels: Record<string, unknown> };
  execution: Record<string, unknown>;
  /** Tuple with a required head: `checks[0]` is never undefined under noUncheckedIndexedAccess. */
  checks: [FixtureCheck, ...FixtureCheck[]];
  checksAggregate: { mode: string; minPass?: number };
  outputs?: unknown[];
  actions?: unknown[];
  integrations?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
}

function validBase(): FixtureDefinition {
  return {
    schemaVersion: 2,
    name: "disk-usage",
    description: "Check disk usage on the local machine",
    tags: ["infra", "disk"],
    cadence: {
      type: "interval",
      seconds: 300,
      jitterSeconds: 30,
    },
    targets: {
      machineIds: ["local"],
      labels: { tier: "prod" },
    },
    execution: {
      timeoutSeconds: 60,
      maxConcurrency: 1,
      overlap: "skip",
      maxAttempts: 3,
      retryBackoffSeconds: [5, 30, 120],
      retryOn: ["failed", "timeout", "unknown", "worker_lost"],
    },
    checks: [
      {
        id: "disk-under-threshold",
        command: {
          executable: "/usr/bin/df",
          args: ["-h", "/"],
          timeoutSeconds: 30,
        },
        expect: {
          exit: 0,
          stdout: [{ op: "contains", expected: "/" }],
        },
        required: true,
      },
    ],
    checksAggregate: { mode: "all" },
    outputs: [
      { type: "stdout", maxBytes: 4096, retain: "excerpt", redact: true },
      { type: "exit" },
    ],
    actions: [
      {
        event: "on_failure",
        integration: "todos",
        operation: "createTask",
        payload: { projectId: "monitor" },
      },
    ],
    integrations: {
      todos: { projectId: "monitor" },
    },
  };
}

describe("SlugDefinitionSchema — positive fixtures", () => {
  it("parses a full valid interval definition with defaults", () => {
    const result = SlugDefinitionSchema.safeParse(validBase());
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.schemaVersion).toBe(2);
    expect(result.data.checks).toHaveLength(1);
    expect(result.data.checksAggregate).toEqual({ mode: "all" });
  });

  it("parses a cron cadence with a valid expression and timezone", () => {
    const input = validBase();
    input.cadence = {
      type: "cron",
      expression: "*/10 * * * *",
      timezone: "Europe/Bucharest",
    };
    const result = SlugDefinitionSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.cadence).toEqual({
      type: "cron",
      expression: "*/10 * * * *",
      timezone: "Europe/Bucharest",
    });
  });

  it("parses exit as a number array", () => {
    const input = validBase();
    input.checks[0].expect.exit = [0, 1];
    const result = SlugDefinitionSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("parses a check with only JSON predicates", () => {
    const input = validBase();
    input.checks[0].expect = {
      json: [
        { op: "exists", path: "status" },
        { op: "type", path: "status", expected: "string" },
        { op: "equals", path: "status", expected: "READY" },
        { op: "not_equals", path: "mode", expected: "maintenance" },
        { op: "greater_than", path: "metrics.load", expected: 0 },
        { op: "greater_or_equal", path: "metrics.load", expected: 0 },
        { op: "less_than", path: "metrics.load", expected: 8 },
        { op: "less_or_equal", path: "metrics.load", expected: 8 },
        { op: "matches", path: "version", expected: "^v?\\d+\\.\\d+" },
      ],
    };
    const result = SlugDefinitionSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("parses a string predicate set including equals, not_contains and regex", () => {
    const input = validBase();
    input.checks[0].expect = {
      stdout: [
        { op: "equals", expected: "READY" },
        { op: "not_contains", expected: "ERROR" },
        { op: "regex", expected: "^READY\\s*$" },
      ],
    };
    const result = SlugDefinitionSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("parses all output kinds and all action events", () => {
    const input = validBase();
    input.outputs = [
      { type: "stdout", maxBytes: 1024, retain: "full", redact: false },
      { type: "stderr", maxBytes: 1024, retain: "excerpt", redact: true },
      { type: "exit" },
      { type: "artifact", pathGlob: "/tmp/out/*.json", maxBytes: 65536, store: "files" },
    ];
    input.actions = [
      { event: "on_failure", integration: "conversations", operation: "sendMessage", payload: { channelId: "ops" } },
      { event: "on_recovery", integration: "mementos", operation: "saveMemory", payload: { bucket: "monitor" } },
      { event: "on_success", integration: "knowledge", operation: "createItem", payload: {} },
      { event: "on_change", integration: "hooks", operation: "runHook", payload: { hookId: "monitor-hook" } },
    ];
    const result = SlugDefinitionSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("parses an all-integration map", () => {
    const input = validBase();
    input.integrations = {
      todos: { projectId: "p1", taskTemplate: "Monitor: {{slug}}" },
      conversations: { channelId: "ops" },
      mementos: { bucket: "monitor", keyTemplate: "slug/{{slug}}" },
      knowledge: { collectionId: "coll1", tags: ["monitor"] },
      skills: { skillId: "monitor-skill" },
      hooks: { hookId: "monitor-hook" },
      loops: { ownerScope: "monitor" },
      files: { artifactCollection: "monitor-artifacts" },
    };
    const result = SlugDefinitionSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("parses an explicit threshold aggregate", () => {
    const input = validBase();
    input.checksAggregate = { mode: "threshold", minPass: 1 };
    const result = SlugDefinitionSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.checksAggregate).toEqual({ mode: "threshold", minPass: 1 });
  });

  it("parses envRefs as opaque identifiers only", () => {
    const input = validBase();
    input.checks[0].command.envRefs = ["MONITOR_API_KEY_REF", "DB_PATH_REF"];
    const result = SlugDefinitionSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("parses a minimal definition with no optional sections", () => {
    const input = {
      schemaVersion: 2,
      name: "minimal",
      cadence: { type: "interval", seconds: 60 },
      checks: [
        {
          id: "c1",
          command: { executable: "true", args: [], timeoutSeconds: 10 },
          expect: { exit: 0 },
        },
      ],
    };
    const result = SlugDefinitionSchema.safeParse(input);
    expect(result.success).toBe(true);
  });
});

describe("SlugDefinitionSchema — negative fixtures", () => {
  it("rejects a schemaVersion other than 2", () => {
    const input = validBase();
    input.schemaVersion = 1;
    expect(SlugDefinitionSchema.safeParse(input).success).toBe(false);
  });

  it("rejects unknown top-level keys (strict schema)", () => {
    const input = validBase();
    input.mode = "cloud";
    expect(SlugDefinitionSchema.safeParse(input).success).toBe(false);
  });

  it("rejects unknown keys inside checks (strict schema)", () => {
    const input = validBase();
    input.checks[0].note = "prose pass/fail is not accepted";
    expect(SlugDefinitionSchema.safeParse(input).success).toBe(false);
  });

  it("rejects an empty checks array", () => {
    const input = validBase();
    input.checks = [] as unknown as [FixtureCheck, ...FixtureCheck[]];
    expect(SlugDefinitionSchema.safeParse(input).success).toBe(false);
  });

  it("rejects missing checks", () => {
    const input: Record<string, unknown> = validBase();
    delete input.checks;
    expect(SlugDefinitionSchema.safeParse(input).success).toBe(false);
  });

  it("rejects duplicate check ids", () => {
    const input = validBase();
    const first = input.checks[0];
    input.checks = [first, { ...first }];
    expect(SlugDefinitionSchema.safeParse(input).success).toBe(false);
  });

  it("rejects a check with no expectations (vacuous pass/fail)", () => {
    const input = validBase();
    input.checks[0].expect = {};
    expect(SlugDefinitionSchema.safeParse(input).success).toBe(false);
  });

  it("rejects a check with an empty command args entry", () => {
    const input = validBase();
    input.checks[0].command.args = [""];
    expect(SlugDefinitionSchema.safeParse(input).success).toBe(false);
  });

  describe("slug name validation", () => {
    const invalidNames = [
      "0leading-digit",
      "Uppercase",
      "snake_case",
      "double--hyphen",
      "trailing-",
      "-leading",
      "with space",
      "",
      "dots.in.name",
      "ünïcode",
    ];
    for (const name of invalidNames) {
      it(`rejects slug name ${JSON.stringify(name)}`, () => {
        const input = validBase();
        input.name = name;
        expect(SlugDefinitionSchema.safeParse(input).success).toBe(false);
      });
    }

    it("accepts the canonical slug shape (one segment)", () => {
      const input = validBase();
      input.name = "disk";
      expect(SlugDefinitionSchema.safeParse(input).success).toBe(true);
    });
  });

  describe("shell-shaped commands are rejected", () => {
    const shellShapes: Array<[string, Record<string, unknown>]> = [
      ["executable with embedded whitespace", { executable: "echo hello", args: [], timeoutSeconds: 10 }],
      ["executable with pipe metacharacter", { executable: "ls | grep foo", args: [], timeoutSeconds: 10 }],
      ["executable with semicolon", { executable: "df;uptime", args: [], timeoutSeconds: 10 }],
      ["executable with ampersand", { executable: "true &", args: [], timeoutSeconds: 10 }],
      ["executable with redirect", { executable: "df > /tmp/x", args: [], timeoutSeconds: 10 }],
      ["sh -c invocation", { executable: "sh", args: ["-c", "echo hi"], timeoutSeconds: 10 }],
      ["bash -c invocation", { executable: "/bin/bash", args: ["-c", "df -h"], timeoutSeconds: 10 }],
      ["dash -c invocation", { executable: "dash", args: ["-c", "true"], timeoutSeconds: 10 }],
      ["cmd /c invocation", { executable: "cmd", args: ["/c", "dir"], timeoutSeconds: 10 }],
      ["powershell -Command invocation", { executable: "powershell", args: ["-Command", "Get-Process"], timeoutSeconds: 10 }],
      ["command substitution in args", { executable: "echo", args: ["$(date)"], timeoutSeconds: 10 }],
      ["backtick interpolation in args", { executable: "echo", args: ["`date`"], timeoutSeconds: 10 }],
      ["dollar-brace interpolation in args", { executable: "echo", args: ["${HOME}"], timeoutSeconds: 10 }],
      ["executable with dollar-paren", { executable: "echo $(hostname)", args: [], timeoutSeconds: 10 }],
    ];
    for (const [label, command] of shellShapes) {
      it(`rejects ${label}`, () => {
        const input = validBase();
        input.checks[0].command = command;
        expect(SlugDefinitionSchema.safeParse(input).success).toBe(false);
      });
    }

    it("rejects an executable that is an absolute path to a shell with -c", () => {
      const input = validBase();
      input.checks[0].command = {
        executable: "/usr/bin/zsh",
        args: ["-c", "df"],
        timeoutSeconds: 10,
      };
      expect(SlugDefinitionSchema.safeParse(input).success).toBe(false);
    });

    it("accepts a plain shell binary invocation without -c (not shell mode)", () => {
      const input = validBase();
      input.checks[0].command = {
        executable: "/bin/sh",
        args: ["--version"],
        timeoutSeconds: 10,
      };
      expect(SlugDefinitionSchema.safeParse(input).success).toBe(true);
    });
  });

  describe("unsupported predicates are rejected", () => {
    it("rejects a string predicate op outside the supported set", () => {
      const input = validBase();
      input.checks[0].expect = {
        stdout: [{ op: "matches_regex", expected: "x" }],
      };
      expect(SlugDefinitionSchema.safeParse(input).success).toBe(false);
    });

    it("rejects numeric comparison on stdout strings", () => {
      const input = validBase();
      input.checks[0].expect = {
        stdout: [{ op: "greater_than", expected: 1 }],
      };
      expect(SlugDefinitionSchema.safeParse(input).success).toBe(false);
    });

    it("rejects exists on stdout strings", () => {
      const input = validBase();
      input.checks[0].expect = {
        stdout: [{ op: "exists", expected: "x" }],
      };
      expect(SlugDefinitionSchema.safeParse(input).success).toBe(false);
    });

    it("rejects a JSON predicate op outside the supported set", () => {
      const input = validBase();
      input.checks[0].expect = {
        json: [{ op: "matches_regex", path: "status", expected: "x" }],
      };
      expect(SlugDefinitionSchema.safeParse(input).success).toBe(false);
    });

    it("rejects an empty expected value for regex", () => {
      const input = validBase();
      input.checks[0].expect = {
        stdout: [{ op: "regex", expected: "" }],
      };
      expect(SlugDefinitionSchema.safeParse(input).success).toBe(false);
    });

    it("rejects an invalid regex pattern at schema time", () => {
      const input = validBase();
      input.checks[0].expect = {
        stdout: [{ op: "regex", expected: "([unclosed" }],
      };
      expect(SlugDefinitionSchema.safeParse(input).success).toBe(false);
    });

    it("rejects an invalid JSON matches pattern at schema time", () => {
      const input = validBase();
      input.checks[0].expect = {
        json: [{ op: "matches", path: "version", expected: "([unclosed" }],
      };
      expect(SlugDefinitionSchema.safeParse(input).success).toBe(false);
    });
  });

  describe("cadence validation", () => {
    it("rejects an unknown cadence type", () => {
      const input = validBase();
      input.cadence = { type: "weekly", seconds: 60 };
      expect(SlugDefinitionSchema.safeParse(input).success).toBe(false);
    });

    it("rejects a non-positive interval", () => {
      const input = validBase();
      input.cadence = { type: "interval", seconds: 0 };
      expect(SlugDefinitionSchema.safeParse(input).success).toBe(false);
    });

    it("rejects a non-integer interval", () => {
      const input = validBase();
      input.cadence = { type: "interval", seconds: 60.5 };
      expect(SlugDefinitionSchema.safeParse(input).success).toBe(false);
    });

    it("rejects a negative jitter", () => {
      const input = validBase();
      input.cadence = { type: "interval", seconds: 60, jitterSeconds: -1 };
      expect(SlugDefinitionSchema.safeParse(input).success).toBe(false);
    });

    it("rejects an invalid cron expression", () => {
      const input = validBase();
      input.cadence = { type: "cron", expression: "not a cron", timezone: "UTC" };
      expect(SlugDefinitionSchema.safeParse(input).success).toBe(false);
    });

    it("rejects an unknown timezone", () => {
      const input = validBase();
      input.cadence = { type: "cron", expression: "*/5 * * * *", timezone: "Mars/Olympus" };
      expect(SlugDefinitionSchema.safeParse(input).success).toBe(false);
    });

    it("rejects a cadence carrying both union arms", () => {
      const input = validBase();
      input.cadence = {
        type: "interval",
        seconds: 60,
        expression: "*/5 * * * *",
        timezone: "UTC",
      };
      expect(SlugDefinitionSchema.safeParse(input).success).toBe(false);
    });
  });

  describe("execution validation", () => {
    it("rejects a zero timeoutSeconds", () => {
      const input = validBase();
      input.checks[0].command.timeoutSeconds = 0;
      expect(SlugDefinitionSchema.safeParse(input).success).toBe(false);
    });

    it("rejects zero maxConcurrency", () => {
      const input = validBase();
      input.execution.maxConcurrency = 0;
      expect(SlugDefinitionSchema.safeParse(input).success).toBe(false);
    });

    it("rejects an unknown overlap mode", () => {
      const input = validBase();
      input.execution.overlap = "once";
      expect(SlugDefinitionSchema.safeParse(input).success).toBe(false);
    });

    it("rejects an unknown retryOn value", () => {
      const input = validBase();
      input.execution.retryOn = ["failed_external"];
      expect(SlugDefinitionSchema.safeParse(input).success).toBe(false);
    });

    it("rejects negative retry backoff", () => {
      const input = validBase();
      input.execution.retryBackoffSeconds = [5, -1];
      expect(SlugDefinitionSchema.safeParse(input).success).toBe(false);
    });

    it("rejects zero maxAttempts", () => {
      const input = validBase();
      input.execution.maxAttempts = 0;
      expect(SlugDefinitionSchema.safeParse(input).success).toBe(false);
    });
  });

  describe("output and action validation", () => {
    it("rejects an unknown output type", () => {
      const input = validBase();
      input.outputs = [{ type: "syslog", maxBytes: 1024, retain: "excerpt", redact: true }];
      expect(SlugDefinitionSchema.safeParse(input).success).toBe(false);
    });

    it("rejects an unknown retain mode", () => {
      const input = validBase();
      input.outputs = [{ type: "stdout", maxBytes: 1024, retain: "partial", redact: true }];
      expect(SlugDefinitionSchema.safeParse(input).success).toBe(false);
    });

    it("rejects a non-files artifact store", () => {
      const input = validBase();
      input.outputs = [{ type: "artifact", pathGlob: "/tmp/*.json", maxBytes: 1024, store: "s3" }];
      expect(SlugDefinitionSchema.safeParse(input).success).toBe(false);
    });

    it("rejects zero maxBytes on an output", () => {
      const input = validBase();
      input.outputs = [{ type: "stdout", maxBytes: 0, retain: "excerpt", redact: true }];
      expect(SlugDefinitionSchema.safeParse(input).success).toBe(false);
    });

    it("rejects an unknown action event", () => {
      const input = validBase();
      input.actions = [{ event: "on_always", integration: "todos", operation: "createTask", payload: {} }];
      expect(SlugDefinitionSchema.safeParse(input).success).toBe(false);
    });

    it("rejects an unknown integration name in an action", () => {
      const input = validBase();
      input.actions = [{ event: "on_failure", integration: "zoom", operation: "call", payload: {} }];
      expect(SlugDefinitionSchema.safeParse(input).success).toBe(false);
    });
  });

  describe("integration map validation", () => {
    it("rejects a todos integration without projectId", () => {
      const input = validBase();
      input.integrations = { todos: { taskTemplate: "x" } };
      expect(SlugDefinitionSchema.safeParse(input).success).toBe(false);
    });

    it("rejects a conversations integration without channelId", () => {
      const input = validBase();
      input.integrations = { conversations: {} };
      expect(SlugDefinitionSchema.safeParse(input).success).toBe(false);
    });

    it("rejects a mementos integration without bucket and keyTemplate", () => {
      const input = validBase();
      input.integrations = { mementos: { bucket: "monitor" } };
      expect(SlugDefinitionSchema.safeParse(input).success).toBe(false);
    });

    it("rejects an unknown integration key", () => {
      const input = validBase();
      input.integrations = { zoom: { projectId: "p" } };
      expect(SlugDefinitionSchema.safeParse(input).success).toBe(false);
    });

    it("rejects unknown keys inside an integration entry", () => {
      const input = validBase();
      input.integrations = { todos: { projectId: "p", secretToken: "not-a-value" } };
      expect(SlugDefinitionSchema.safeParse(input).success).toBe(false);
    });
  });

  describe("targets and envRefs validation", () => {
    it("rejects a non-string label value", () => {
      const input = validBase();
      input.targets.labels = { tier: 1 };
      expect(SlugDefinitionSchema.safeParse(input).success).toBe(false);
    });

    it("rejects envRefs that look like values", () => {
      const input = validBase();
      input.checks[0].command.envRefs = ["opaque-token-value"];
      expect(SlugDefinitionSchema.safeParse(input).success).toBe(false);
    });

    it("rejects envRefs with shell interpolation", () => {
      const input = validBase();
      input.checks[0].command.envRefs = ["$(id)"];
      expect(SlugDefinitionSchema.safeParse(input).success).toBe(false);
    });
  });
});
