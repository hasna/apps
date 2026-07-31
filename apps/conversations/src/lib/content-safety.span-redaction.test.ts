// This file is a secret-DETECTION fixture: every credential-shaped value in it
// is assembled from fragments at runtime so the scanner has something to find,
// and the one literal is a PEM banner line with no key material after it. The
// staged-secrets hook cannot tell a detection fixture from a leak, so the
// sanctioned per-file escape is declared here rather than per line.
// hasna:allow-secret-file
import { describe, test, expect } from "bun:test";
import {
  attachSendRedaction,
  describeSendRedaction,
  redactSensitiveText,
  redactSensitiveValue,
  redactSensitiveValueWithFindings,
  redactSensitiveTextWithFindings,
  scanSensitiveContent,
} from "./content-safety";

// ---------------------------------------------------------------------------
// Synthetic, structurally-valid fakes. Built by concatenation so this source
// file never contains a scannable credential literal. None of these are live.
// ---------------------------------------------------------------------------

function syntheticDatabaseUrl(): string {
  return ["postgres", "://", "span_user:synthetic-password", "@db.example.invalid:5432/app"].join("");
}

function syntheticLocalDatabaseUrl(): string {
  // The 608243 class: a quickstart-README connection string with no credential.
  return ["postgres", "://", "localhost:5432/appdb"].join("");
}

function syntheticAwsAccessKeyId(): string {
  return ["AK", "IA", "QRSTUVWX9012ABCD"].join("");
}

function syntheticOpenAiKey(): string {
  return ["sk-", "proj-", "A1b2C3d4E5f6G7h8I9j0K1l2M3"].join("");
}

function syntheticPat(): string {
  return ["gh", "p_", "A1b2C3d4E5f6G7h8I9j0K1l2M3n4"].join("");
}

function syntheticPrivateKeyBlock(): string {
  return [
    "-----BEGIN RSA PRIVATE KEY-----",
    "MIIBOgIBAAJBAKsyntheticnotarealkeyblockatallxyz0123456789abcdef",
    "-----END RSA PRIVATE KEY-----",
  ].join("\n");
}

/**
 * The #609657 fixture: the SANCTIONED credential presence test. Variable names
 * paired with a set/unset verdict. Contains no credential value of any kind —
 * this is the idiom the hygiene rules prescribe INSTEAD of printing values.
 */
function presenceTestReport(): string {
  return [
    "Correcting my earlier post: the host is only half repaired.",
    "I checked presence without printing any value:",
    "HASNA_TODOS_API_KEY=set",
    "HASNA_CONVERSATIONS_API_KEY=set",
    "HASNA_EMAILS_API_KEY=unset",
    "Reopening the incident — the earlier all-clear was wrong.",
  ].join("\n");
}

describe("positive controls — detection MUST NOT weaken", () => {
  test("a cloud key embedded in prose is still redacted, and the key never survives", () => {
    const secret = syntheticAwsAccessKeyId();
    const body = `Deploy failed. The task role printed ${secret} into the log. Rotating now.`;

    const out = redactSensitiveValue({ id: 1, content: body });

    expect(out.content).not.toContain(secret);
    expect(out.content).toContain("[REDACTED:CLOUD_KEY]");
  });

  test("a database URL with credentials embedded in prose is still redacted", () => {
    const secret = syntheticDatabaseUrl();
    const out = redactSensitiveValue({ id: 2, content: `The DSN is ${secret} and it leaked.` });

    expect(out.content).not.toContain(secret);
    expect(out.content).not.toContain("synthetic-password");
    expect(out.content).toContain("[REDACTED:DATABASE_URL]");
  });

  test("provider keys and personal access tokens are still redacted", () => {
    const key = syntheticOpenAiKey();
    const pat = syntheticPat();
    const out = redactSensitiveValue({ content: `key ${key} and token ${pat}` });

    expect(out.content).not.toContain(key);
    expect(out.content).not.toContain(pat);
    expect(out.content).toContain("[REDACTED:CLOUD_KEY]");
    expect(out.content).toContain("[REDACTED:PAT]");
  });

  test("a private key block is still redacted", () => {
    const block = syntheticPrivateKeyBlock();
    const out = redactSensitiveValue({ content: `here it is:\n${block}\nplease rotate` });

    expect(out.content).not.toContain("MIIBOgIBAAJBAK");
    expect(out.content).toContain("[REDACTED:PRIVATE_KEY]");
  });

  test("a genuine multi-line env dump with real values is still redacted", () => {
    const dump = [
      "Here is the env:",
      "SERVICE_TOKEN=A1b2C3d4E5f6G7h8I9j0",
      "SESSION_SECRET=Z9y8X7w6V5u4T3s2R1q0",
      "SIGNING_SEED=Q1w2E3r4T5y6U7i8O9p0",
    ].join("\n");

    const out = redactSensitiveValue({ content: dump });

    expect(out.content).not.toContain("A1b2C3d4E5f6G7h8I9j0");
    expect(out.content).not.toContain("Z9y8X7w6V5u4T3s2R1q0");
    expect(out.content).toContain("[REDACTED:ENV_DUMP]");
  });

  // MIN_ENV_DUMP_LINES is 3. Every case below deliberately carries FEWER than
  // three real secret lines, so the dump can only be detected if ordinary flag
  // values still COUNT toward the threshold.
  //
  // An earlier version of this test used three real values, which meets the
  // threshold on its own — so it passed whether flag lines were counted or
  // ignored, and could never fail for the reason it claimed to check. It hid a
  // real regression: with flags excluded from the count, these dumps were
  // neither redacted nor blocked at send, and the credential was persisted.
  const flagInterleavedDumps: Array<[string, string[]]> = [
    ["4 flag lines and 1 real secret", [
      "DEBUG=true",
      "VERBOSE=false",
      "CACHE=none",
      "STRICT=yes",
      "SERVICE_TOKEN=A1b2C3d4E5f6G7h8I9j0",
    ]],
    ["3 flag lines and 2 real secrets", [
      "DEBUG=true",
      "CACHE=none",
      "STRICT=yes",
      "SERVICE_TOKEN=A1b2C3d4E5f6G7h8I9j0",
      "SESSION_SECRET=Z9y8X7w6V5u4T3s2R1q0",
    ]],
    ["2 real secrets interleaved with 2 flags", [
      "DEBUG=true",
      "SERVICE_TOKEN=A1b2C3d4E5f6G7h8I9j0",
      "CACHE_ENABLED=false",
      "SESSION_SECRET=Z9y8X7w6V5u4T3s2R1q0",
    ]],
  ];

  for (const [name, lines] of flagInterleavedDumps) {
    test(`a real env dump is still caught: ${name}`, () => {
      const dump = lines.join("\n");

      // Must be FLAGGED, not merely redacted: the write-side reject gates
      // (messages.ts / api.ts) throw only when a finding exists, so a miss here
      // means the credential is accepted and stored.
      expect(scanSensitiveContent(dump).length).toBeGreaterThan(0);

      const out = redactSensitiveValue({ content: dump });
      expect(out.content).toContain("[REDACTED:ENV_DUMP]");
      expect(out.content).not.toContain("A1b2C3d4E5f6G7h8I9j0");
      expect(out.content).not.toContain("Z9y8X7w6V5u4T3s2R1q0");
    });
  }

  test("flag values are classified as values, not verdicts", () => {
    // The precise distinction that was lost: a flag must not TERMINATE a run,
    // but it must still COUNT toward one. Three flag lines and nothing else is
    // still an env dump.
    const flagsOnly = ["DEBUG=true", "VERBOSE=false", "CACHE=none"].join("\n");
    expect(scanSensitiveContent(flagsOnly).length).toBeGreaterThan(0);

    // Whereas three presence verdicts are not.
    const verdictsOnly = ["A_KEY=set", "B_KEY=unset", "C_KEY=missing"].join("\n");
    expect(scanSensitiveContent(verdictsOnly)).toHaveLength(0);
  });

  test("a key that DECLARES a credential still replaces the whole value", () => {
    // When the key itself names the field a credential, the entire value is the
    // secret and must not be span-redacted into partial survival.
    const secret = syntheticDatabaseUrl();
    const out = redactSensitiveValue({ DATABASE_URL: secret });

    expect(out.DATABASE_URL).toBe("[REDACTED:DATABASE_URL]");
    expect(JSON.stringify(out)).not.toContain("synthetic-password");
  });

  test("secrets nested in objects and arrays are still redacted", () => {
    const secret = syntheticDatabaseUrl();
    const out = redactSensitiveValue({
      content: "see below",
      metadata: { nested: { dsn: secret }, list: [`dsn ${secret}`] },
    });

    expect(JSON.stringify(out)).not.toContain(secret);
    expect(JSON.stringify(out)).not.toContain("synthetic-password");
  });
});

describe("negative controls — the message must survive", () => {
  test("#609657: the sanctioned presence test survives completely intact", () => {
    const body = presenceTestReport();

    // It must not be flagged at all: send-time assert and read-time redaction
    // both key off this scan, so a finding here is both a false rejection and
    // a false destruction.
    expect(scanSensitiveContent(body)).toHaveLength(0);
    expect(redactSensitiveText(body)).toBe(body);

    const out = redactSensitiveValue({ id: 609657, content: body });
    expect(out.content).toBe(body);
    expect(out.content).not.toContain("[REDACTED");
    expect(out.content).toContain("Reopening the incident");
  });

  test("a presence verdict is not a value, in either casing or spacing", () => {
    const body = [
      "AWS_SESSION_TOKEN = unset",
      "GH_TOKEN=SET",
      "STRIPE_SECRET_KEY=missing",
    ].join("\n");

    expect(scanSensitiveContent(body)).toHaveLength(0);
    expect(redactSensitiveText(body)).toBe(body);
  });

  test("#608243 class: a genuine match costs the span, never the message", () => {
    // This connection string is a defensible catch and stays caught. What must
    // change is the blast radius: the surrounding report has to survive.
    const url = syntheticLocalDatabaseUrl();
    const body = [
      "NO_GO on the release. Four blocking defects, all mine:",
      "1. the migration runs twice",
      `2. the quickstart still documents ${url} as the default`,
      "3. the rollback path was never exercised",
      "4. I approved my own change",
    ].join("\n");

    const out = redactSensitiveValue({ id: 608243, content: body });

    expect(out.content).not.toContain(url);
    expect(out.content).toContain("[REDACTED:DATABASE_URL]");
    // Every other line of the record survives — this is the whole point.
    expect(out.content).toContain("NO_GO on the release");
    expect(out.content).toContain("the migration runs twice");
    expect(out.content).toContain("the rollback path was never exercised");
    expect(out.content).toContain("I approved my own change");
  });

  test("ordinary prose that merely names env vars is untouched", () => {
    const body = [
      "HASNA_TODOS_API_URL and HASNA_CONVERSATIONS_API_URL are both configured.",
      'Check presence with [ -n "${HASNA_TODOS_API_KEY:-}" ] && echo set || echo unset',
      "Do not print the value.",
    ].join("\n");

    expect(redactSensitiveValue({ content: body }).content).toBe(body);
  });
});

describe("sender notification — redaction must be observable by the caller", () => {
  test("reports findings when a value was redacted", () => {
    const secret = syntheticDatabaseUrl();
    const outcome = redactSensitiveValueWithFindings({ content: `dsn ${secret}` });

    expect(outcome.redacted).toBe(true);
    expect(outcome.findings.length).toBeGreaterThan(0);
    expect(outcome.findings.map((f) => f.kind)).toContain("database_url");
    expect(outcome.value.content).not.toContain(secret);
  });

  test("reports NO redaction for clean content, so the signal is not noise", () => {
    const outcome = redactSensitiveValueWithFindings({ content: presenceTestReport() });

    expect(outcome.redacted).toBe(false);
    expect(outcome.findings).toHaveLength(0);
    expect(outcome.value.content).toBe(presenceTestReport());
  });

  test("the funnel attaches the notice, so a call site cannot forget it", () => {
    // Coverage came from hand-applying the notice per send path, which left
    // broadcast, send_to_session, MCP reply, edit_message and CLI edit silent.
    // attachSendRedaction runs inside ConversationsStore.sendMessage/.editMessage,
    // so the notice rides on the returned message whether or not the caller
    // remembers to look.
    const submitted = "the body of an incident correction";
    const destroyed = attachSendRedaction(submitted, { id: 1, content: "[REDACTED:DATABASE_URL]" });

    expect(destroyed.redaction?.redacted).toBe(true);
    expect(destroyed.redaction?.message).toContain("ENTIRE body was replaced");

    // Absence is a positive statement: the funnel checked and nothing changed.
    const clean = attachSendRedaction(submitted, { id: 2, content: submitted });
    expect(clean.redaction).toBeUndefined();
  });

  test("the notice describes what READERS see, not what was stored", () => {
    // The rows are written raw and rewritten at render time. Copy that says
    // "stored as" teaches the opposite of the finding and would send anyone
    // chasing a recovery in the wrong direction.
    const notice = describeSendRedaction("a full report", "[REDACTED:ENV_DUMP]");
    expect(notice.message).toContain("Readers will see");
    expect(notice.message).not.toContain("was stored as");
  });

  test("text-level outcome reports its own findings too", () => {
    const clean = redactSensitiveTextWithFindings("nothing to see here");
    expect(clean.redacted).toBe(false);
    expect(clean.text).toBe("nothing to see here");

    const dirty = redactSensitiveTextWithFindings(`dsn ${syntheticDatabaseUrl()}`);
    expect(dirty.redacted).toBe(true);
    expect(dirty.text).toContain("[REDACTED:DATABASE_URL]");
  });
});
