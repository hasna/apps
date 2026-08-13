import { beforeEach, describe, expect, mock, test } from "bun:test";

const createCalendar = mock(async (input: Record<string, unknown>) => ({
  id: "cal-1",
  org_id: input.org_id,
  name: input.name,
}));
const createAttendee = mock(async (input: Record<string, unknown>) => ({
  id: "attendee-1",
  event_id: input.event_id,
}));

const dependencies = {
  getCloudVerifier: () => ({
    authenticate: async () => ({ ok: true }),
  }) as never,
  getCloudStore: () => ({
    createCalendar,
    createAttendee,
  }) as never,
};

const { handleV1Request } = await import("./v1.js");

/**
 * The error Bun's SQL driver ACTUALLY throws on SQLSTATE 23503 — captured from
 * Bun 1.3.14 + PostgreSQL 16 driving CalendarPgStore against
 * migrations/0001_calendar_schema.sql, and matching the stack pasted in
 * hasna/calendar#13 field for field.
 *
 * The SQLSTATE lives on `errno`; `code` is Bun's own transport tag. A fixture
 * that puts "23503" on `code` describes a driver we do not run and lets a
 * mapping that never fires in production go green — which is exactly how the
 * first cut of this fix shipped broken.
 */
function postgresForeignKeyViolation(
  table: string,
  column: string,
  references: string,
): Error {
  const constraint = `${table}_${column}_fkey`;
  const error = new Error(
    `insert or update on table "${table}" violates foreign key constraint "${constraint}"`,
  ) as Error & Record<string, unknown>;
  error.name = "PostgresError";
  error.code = "ERR_POSTGRES_SERVER_ERROR";
  error.errno = "23503";
  error.detail = `Key (${column})=(missing) is not present in table "${references}".`;
  error.severity = "ERROR";
  error.schema = "public";
  error.table = table;
  error.constraint = constraint;
  error.routine = "ri_ReportViolation";
  error.sourceURL = "internal:sql/postgres";
  error.stack = `PostgresError: ${error.message}\n    at wrapPostgresError (internal:sql/postgres:171:27)`;
  return error;
}

/**
 * Every driver-internal fragment the response body must not carry. Derived FROM
 * the thrown error so it cannot drift away from the fixture: the message, the
 * SQLSTATE, the constraint name, the row detail and the internal source URL.
 */
function leakedFragments(e: Error): string[] {
  const pg = e as Error & Record<string, unknown>;
  return [
    e.name,
    e.message,
    String(pg.errno),
    String(pg.code),
    String(pg.constraint),
    String(pg.detail),
    String(pg.sourceURL),
    String(e.stack),
  ];
}

async function post(path: string, body: Record<string, unknown>): Promise<Response> {
  const request = new Request(`https://calendar.test${path}`, {
    method: "POST",
    headers: {
      Authorization: "Bearer authenticated-test-key",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return (await handleV1Request(request, new URL(request.url), dependencies))!;
}

beforeEach(() => {
  createCalendar.mockClear();
  createAttendee.mockClear();
});

describe("/v1 foreign key validation", () => {
  test("missing calendar org_id returns 400 without calling the store", async () => {
    const response = await post("/v1/calendars", { name: "No org" });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "org_id and name are required" });
    expect(createCalendar).not.toHaveBeenCalled();
  });

  test("a non-string calendar org_id returns 400 instead of a TypeError 500", async () => {
    createCalendar.mockImplementationOnce(async () => {
      throw new RangeError("org_id is required");
    });

    const response = await post("/v1/calendars", { org_id: 42, name: "Wrong FK type" });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "org_id is required" });
  });

  test("a remaining calendar FK violation returns 400 without leaking Postgres details", async () => {
    const thrown = postgresForeignKeyViolation("calendars", "org_id", "orgs");
    createCalendar.mockImplementationOnce(async () => {
      throw thrown;
    });

    const response = await post("/v1/calendars", { org_id: "missing-org", name: "Bad reference" });
    const text = await response.text();

    expect(response.status).toBe(400);
    expect(JSON.parse(text)).toEqual({ error: "referenced resource does not exist" });
    for (const secret of leakedFragments(thrown)) expect(text).not.toContain(secret);
  });

  test("the issue #13 payload (org_id: \"undefined\") returns 400, not a 500", async () => {
    createCalendar.mockImplementationOnce(async () => {
      throw postgresForeignKeyViolation("calendars", "org_id", "orgs");
    });

    const response = await post("/v1/calendars", { org_id: "undefined", name: "No org" });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "referenced resource does not exist" });
  });

  test("a remaining attendee FK violation returns 400 without leaking Postgres details", async () => {
    const thrown = postgresForeignKeyViolation("event_attendees", "event_id", "events");
    createAttendee.mockImplementationOnce(async () => {
      throw thrown;
    });

    const response = await post("/v1/attendees", {
      event_id: "missing-event",
      email: "person@example.com",
    });
    const text = await response.text();

    expect(response.status).toBe(400);
    expect(JSON.parse(text)).toEqual({ error: "referenced resource does not exist" });
    for (const secret of leakedFragments(thrown)) expect(text).not.toContain(secret);
  });

  test("valid calendar input still returns the created record", async () => {
    const response = await post("/v1/calendars", { org_id: "org-1", name: "Valid" });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      calendar: { id: "cal-1", org_id: "org-1", name: "Valid" },
    });
  });
});
