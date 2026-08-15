/**
 * The deterministic half of the incident-projection equivalence gate.
 *
 * This runs ./incident-projection-scenarios.ts against the SQLite engine. The
 * live-PostgreSQL half runs the SAME scenario list against the public HTTP
 * routes (`bun run test:incident-pg`). Both assert the same outcome per
 * scenario, so a Postgres divergence is a diff in one column of one table
 * rather than a difference of opinion about what was tested.
 *
 * This lane is always runnable. The live lane requires a database the repository
 * does not own; when it is unavailable it DECLINES loudly rather than reporting
 * a pass, and this file is the substitute evidence named in that decline.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { closeDb } from "../lib/db.js";
import { appendIncidentProjection, getIncidentProjection } from "../lib/incident-projections.js";
import { IncidentProjectionConflictError } from "../lib/incident-projection-contract.js";
import {
  appendScenarios,
  lookupScenarios,
  SCENARIO_CONTEXT,
} from "./incident-projection-scenarios.js";
import { pinStoreToDb, restoreStoreEnv } from "../lib/store/isolated-test-env.js";

const TEST_DB = join(tmpdir(), `conversations-incident-equivalence-${Date.now()}.db`);

beforeEach(() => {
  pinStoreToDb(TEST_DB);
  closeDb();
});

afterEach(() => {
  closeDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { unlinkSync(`${TEST_DB}${suffix}`); } catch {}
  }
  restoreStoreEnv();
});

describe("G7 incident projection scenarios on the local engine", () => {
  test("every append scenario produces its declared outcome", () => {
    const observed: Array<{ name: string; kind: string }> = [];

    for (const scenario of appendScenarios()) {
      let kind: string;
      try {
        const record = appendIncidentProjection(scenario.request, SCENARIO_CONTEXT);
        kind = record.replayed ? "replayed" : "created";
      } catch (error) {
        if (!(error instanceof IncidentProjectionConflictError)) throw error;
        kind = "conflict";
      }
      observed.push({ name: scenario.name, kind });
      expect({ name: scenario.name, kind }).toEqual({ name: scenario.name, kind: scenario.expect.kind });
    }

    // The list must actually discriminate — a suite of eight "created" would
    // pass against an engine that never refuses anything.
    const kinds = new Set(observed.map((row) => row.kind));
    expect(kinds).toEqual(new Set(["created", "replayed", "conflict"]));
  });

  test("a replay returns the same canonical identity, not a second projection", () => {
    const [first] = appendScenarios();
    const created = appendIncidentProjection(first.request, SCENARIO_CONTEXT);
    const replayed = appendIncidentProjection(first.request, SCENARIO_CONTEXT);

    expect(created.replayed).toBe(false);
    expect(replayed.replayed).toBe(true);
    expect(replayed.id).toBe(created.id);
    expect(replayed.message_id).toBe(created.message_id);
    expect(replayed.payload_hash).toBe(created.payload_hash);
    expect(replayed.event_id).toBe(created.event_id);
  });

  test("event lookup resolves exactly the projected events", () => {
    for (const scenario of appendScenarios()) {
      try {
        appendIncidentProjection(scenario.request, SCENARIO_CONTEXT);
      } catch (error) {
        if (!(error instanceof IncidentProjectionConflictError)) throw error;
      }
    }

    for (const lookup of lookupScenarios()) {
      const found = getIncidentProjection(lookup.event_id, SCENARIO_CONTEXT) !== null;
      expect({ name: lookup.name, found }).toEqual({ name: lookup.name, found: lookup.found });
    }
  });

  test("a projection under another authority is not visible to this one", () => {
    const [first] = appendScenarios();
    appendIncidentProjection(first.request, SCENARIO_CONTEXT);

    const otherTenant = { ...SCENARIO_CONTEXT, tenant_id: "some-other-tenant" };
    expect(getIncidentProjection(first.request.event_id, otherTenant)).toBeNull();
  });
});
