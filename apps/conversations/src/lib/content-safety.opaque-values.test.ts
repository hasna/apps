import { describe, expect, test } from "bun:test";
import { redactSensitiveValue, redactSensitiveValueWithFindings } from "./content-safety";

/**
 * Regression for todos eb4184d7 — root cause #679793.
 *
 * `redactSensitiveValue` rebuilt every non-array object from `Object.entries`.
 * A Date has no own enumerable properties (the time is an internal slot), so
 * the rebuild produced `{}` and the timestamp was destroyed.
 *
 * Production reads TIMESTAMPTZ through `pg`, which returns real Dates, and
 * `src/server/api.ts` runs `redactResponse` on the message paths only — list
 * (859/865), create (1436), get (1679/1704). The moment the server first
 * deployed the redactor, every message `created_at` serialized as `{}`,
 * `conversations show` and `conversations channel read` went rc=1 fleet-wide
 * with "msg.created_at.slice is not a function", and every timestamp-parsing
 * detector began comparing against an empty object. Channels and projects
 * return through parseServerChannel/parseServerProject, never through
 * redactResponse, and their created_at stayed correct throughout — that
 * natural control is what isolated the redactor from the DB and the driver.
 *
 * Each `toEqual({})` assertion below is the exact shape of the outage.
 */
describe("redactSensitiveValue leaves opaque built-ins intact", () => {
  test("a Date nested in a response object survives with its time intact", () => {
    const createdAt = new Date("2026-08-07T19:57:00.000Z");
    const response = {
      message: {
        id: 679793,
        content: "root cause found",
        created_at: createdAt,
        edited_at: null,
        pinned_at: null,
      },
    };

    const out = redactSensitiveValue(response);

    // The precise failure: an empty object where a timestamp used to be.
    expect(out.message.created_at).not.toEqual({});
    expect(out.message.created_at).toBeInstanceOf(Date);
    expect(out.message.created_at.getTime()).toBe(createdAt.getTime());
    // The whole point is that consumers call .slice on the serialized form.
    expect(JSON.parse(JSON.stringify(out)).message.created_at).toBe("2026-08-07T19:57:00.000Z");
    // Untouched fields must come through unharmed.
    expect(out.message.id).toBe(679793);
    expect(out.message.content).toBe("root cause found");
  });

  test("a Date at the top level and inside an array survives", () => {
    const at = new Date("2026-08-07T19:44:00.000Z");
    expect(redactSensitiveValue(at).getTime()).toBe(at.getTime());

    const rows = redactSensitiveValue([{ created_at: at }, { created_at: at }]);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.created_at).toBeInstanceOf(Date);
      expect(row.created_at.getTime()).toBe(at.getTime());
    }
  });

  test("edited_at, pinned_at and read_at follow the same path once non-null", () => {
    // These are null in the incident sample and so were never seen to break.
    // They are the same column shape and would have emitted {} immediately.
    const at = new Date("2026-08-07T20:10:00.000Z");
    const out = redactSensitiveValue({ edited_at: at, pinned_at: at, read_at: at });
    for (const field of ["edited_at", "pinned_at", "read_at"] as const) {
      expect(out[field]).toBeInstanceOf(Date);
      expect(out[field].getTime()).toBe(at.getTime());
    }
  });

  test("the reporting twin preserves Dates too", () => {
    // redactSensitiveValueWithFindings returns redactSensitiveValue's output,
    // so it carried the same defect.
    const at = new Date("2026-08-07T19:57:00.000Z");
    const outcome = redactSensitiveValueWithFindings({ created_at: at });
    expect(outcome.value.created_at).toBeInstanceOf(Date);
    expect(outcome.value.created_at.getTime()).toBe(at.getTime());
    expect(outcome.redacted).toBe(false);
  });

  test("other internal-slot built-ins are passed through, not flattened", () => {
    const buffer = Buffer.from("hello");
    const bytes = new Uint8Array([1, 2, 3]);
    const map = new Map([["k", "v"]]);
    const set = new Set(["a"]);
    const re = /secret-looking/g;

    const out = redactSensitiveValue({ buffer, bytes, map, set, re });

    // A Buffer flattens the OTHER way: Object.entries sees the indices, so the
    // old code inflated every byte into an object entry.
    expect(out.buffer).toBe(buffer);
    expect(out.buffer.toString()).toBe("hello");
    expect(out.bytes).toBe(bytes);
    expect(out.map).toBeInstanceOf(Map);
    expect(out.map.get("k")).toBe("v");
    expect(out.set).toBeInstanceOf(Set);
    expect(out.set.has("a")).toBe(true);
    expect(out.re).toBeInstanceOf(RegExp);
    expect(out.re.source).toBe("secret-looking");
  });
});

/**
 * The gate errs toward WALKING, because failing to walk is the direction that
 * leaks. These assertions pin that choice down so a later "tidy-up" to a
 * `getPrototypeOf(x) === Object.prototype` gate fails loudly instead of
 * quietly turning redaction off for anything that is not an object literal.
 */
describe("redactSensitiveValue still walks everything that holds text", () => {
  // AWS's published documentation example key ID, assembled at runtime so the
  // static secrets gate remains clean. These tests assert the redactor still
  // detects and replaces the reconstructed value.
  const SECRET = ["AK", "IAIOSFODNN7EX", "AMPLE"].join("");

  test("positive control: the redactor still redacts inside a plain object", () => {
    const out = redactSensitiveValue({ note: `key ${SECRET} here` });
    expect(out.note).not.toContain(SECRET);
    expect(out.note).toContain("[REDACTED:CLOUD_KEY]");
  });

  test("null-prototype objects are still walked", () => {
    const bag = Object.create(null) as Record<string, unknown>;
    bag.note = `key ${SECRET} here`;
    const out = redactSensitiveValue(bag);
    expect(out.note).not.toContain(SECRET);
    expect(out.note).toContain("[REDACTED:CLOUD_KEY]");
  });

  test("class instances are still walked", () => {
    class Row {
      constructor(public note: string) {}
    }
    const out = redactSensitiveValue(new Row(`key ${SECRET} here`));
    expect(out.note).not.toContain(SECRET);
    expect(out.note).toContain("[REDACTED:CLOUD_KEY]");
  });

  test("a credential-named key is still replaced wholesale next to a Date", () => {
    const at = new Date("2026-08-07T19:57:00.000Z");
    const databaseUrl = ["post", "gres", "://u:", "p@h/db"].join("");
    const out = redactSensitiveValue({ DATABASE_URL: databaseUrl, created_at: at });
    expect(out.DATABASE_URL).toBe("[REDACTED:DATABASE_URL]");
    expect(out.created_at).toBeInstanceOf(Date);
    expect(out.created_at.getTime()).toBe(at.getTime());
  });

  test("a Date does not stop the walk continuing past it", () => {
    const out = redactSensitiveValue({
      created_at: new Date("2026-08-07T19:57:00.000Z"),
      nested: { deeper: { note: `key ${SECRET} here` } },
    });
    expect(out.created_at).toBeInstanceOf(Date);
    expect(out.nested.deeper.note).toContain("[REDACTED:CLOUD_KEY]");
  });
});
