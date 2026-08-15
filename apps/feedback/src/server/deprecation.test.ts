import { describe, expect, test } from "bun:test";
import {
  DEPRECATED_BIN,
  REMOVAL_VERSION,
  REPLACEMENT_COMMAND,
  SERVE_DESCRIPTION,
  deprecationNotice,
} from "./deprecation.js";
import { main } from "./cli.js";

describe("feedback-serve deprecation notice", () => {
  test("names the bin being deprecated, the replacement, and the removal version", () => {
    const notice = deprecationNotice();

    expect(notice).toContain(DEPRECATED_BIN);
    expect(notice).toContain(REPLACEMENT_COMMAND);
    expect(notice).toContain(REMOVAL_VERSION);
  });

  test("removal version is a later version than the one that ships the stub", async () => {
    // The stub ships in 0.3.0; removal must be a strictly later boundary, or the
    // notice is telling users about a release that has already happened.
    const pkg = JSON.parse(
      await Bun.file(new URL("../../package.json", import.meta.url)).text(),
    ) as { version: string };

    const rank = (v: string): number => {
      const parts = v.split(".");
      const major = Number.parseInt(parts[0] ?? "0", 10);
      const minor = Number.parseInt(parts[1] ?? "0", 10);
      return major * 1000 + minor;
    };

    expect(rank(REMOVAL_VERSION)).toBeGreaterThan(rank(pkg.version));
  });

  test("states that the HTTP server has no PostgreSQL support", () => {
    // This is the measured reason the bin is going away: src/server/cli.ts passes
    // only { host, port }, startFeedbackServer falls back to createFeedbackStore()
    // with no options, and createFeedbackStore throws in cloud mode without a
    // host-injected adapter (src/storage.ts). The notice must not imply the bin
    // is being withdrawn for cosmetic reasons.
    expect(deprecationNotice().toLowerCase()).toContain("postgres");
  });
});

describe("feedback-serve stub behaviour", () => {
  test("writes the deprecation notice to stderr, never stdout", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const origLog = console.log;
    const origErr = console.error;
    console.log = (...a: unknown[]) => void out.push(a.join(" "));
    console.error = (...a: unknown[]) => void err.push(a.join(" "));

    try {
      await main(["--help"]);
    } finally {
      console.log = origLog;
      console.error = origErr;
    }

    // Scripted callers parse stdout. Putting the notice there would break them,
    // which is the one thing a deprecation stub must not do.
    expect(err.join("\n")).toContain(DEPRECATED_BIN);
    expect(err.join("\n")).toContain(REPLACEMENT_COMMAND);
    expect(out.join("\n")).not.toContain("deprecated");
  });

  test("--version still prints exactly the version on stdout", async () => {
    const out: string[] = [];
    const origLog = console.log;
    const origErr = console.error;
    console.log = (...a: unknown[]) => void out.push(a.join(" "));
    console.error = () => {};

    try {
      await main(["--version"]);
    } finally {
      console.log = origLog;
      console.error = origErr;
    }

    // A caller doing `feedback-serve --version` must keep getting a bare version.
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("--help still prints the usage block on stdout", async () => {
    const out: string[] = [];
    const origLog = console.log;
    const origErr = console.error;
    console.log = (...a: unknown[]) => void out.push(a.join(" "));
    console.error = () => {};

    try {
      await main(["--help"]);
    } finally {
      console.log = origLog;
      console.error = origErr;
    }

    // Deprecated does not mean broken: the stub keeps working.
    expect(out.join("\n")).toContain("Usage: feedback-serve");
    expect(out.join("\n")).toContain("--port");
  });
});

describe("`feedback serve` subcommand is scoped to local development", () => {
  test("its description says local development and disclaims PostgreSQL", () => {
    // The subcommand runs the IDENTICAL startFeedbackServer and is therefore
    // exactly as incapable of PostgreSQL as the bin. Dropping the bin while
    // leaving the subcommand advertising an unqualified "HTTP API" would move
    // the conformance report without changing what ships.
    const lowered = SERVE_DESCRIPTION.toLowerCase();

    expect(lowered).toContain("local development");
    expect(lowered).toContain("postgres");
  });
});
