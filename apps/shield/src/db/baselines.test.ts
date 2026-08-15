import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  createBaseline,
  deleteBaseline,
  isBaselined,
  listBaselines,
} from "./baselines.js";
import { getCurrentTestDb, setupTestDb } from "./test-helpers.js";
import { opaqueIdentifierForStorage } from "../lib/finding-safety.js";

describe("baseline credential boundary", () => {
  let cleanup: () => void;

  beforeEach(() => {
    cleanup = setupTestDb();
  });

  afterEach(() => cleanup());

  test("sanitizes every caller-controlled string before persistence", () => {
    const marker = `gh${"p"}_${"Baseline_New_Write_".repeat(3)}`;
    const baseline = createBaseline(
      marker,
      `requested because the synthetic marker is ${marker}`,
      `agent-${marker}`,
    );

    expect(JSON.stringify(baseline)).not.toContain(marker);
    expect(isBaselined(marker)).toBe(true);
    expect(JSON.stringify(listBaselines())).not.toContain(marker);
    expect(JSON.stringify(getCurrentTestDb().prepare("SELECT * FROM baselines").all()))
      .not.toContain(marker);
  });

  test("listBaselines durably scrubs production-shaped legacy rows", () => {
    const marker = `sk_test_${"BaselineLegacy9876543210".repeat(2)}`;
    const db = getCurrentTestDb();
    db.prepare(
      `INSERT INTO baselines (id, finding_fingerprint, reason, created_by, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(marker, marker, `reason=${marker}`, `creator-${marker}`, marker);

    expect(JSON.stringify(listBaselines())).not.toContain(marker);
    expect(JSON.stringify(db.prepare("SELECT * FROM baselines").all())).not.toContain(marker);

    const [baseline] = listBaselines();
    expect(isBaselined(baseline.finding_fingerprint)).toBe(true);
    deleteBaseline(baseline.id);
    expect(listBaselines()).toEqual([]);
  });

  test("raw legacy IDs cannot delete an unrelated collision occupant", () => {
    const marker = `gh${"o"}_${"BaselineDeleteCollision_".repeat(3)}`;
    const occupiedId = opaqueIdentifierForStorage(marker, "BASELINE-ID");
    const db = getCurrentTestDb();
    db.prepare(
      `INSERT INTO baselines (id, finding_fingerprint, reason, created_by, created_at)
       VALUES (?, 'occupied-fingerprint', 'safe', 'safe', 'now')`,
    ).run(occupiedId);
    db.prepare(
      `INSERT INTO baselines (id, finding_fingerprint, reason, created_by, created_at)
       VALUES (?, 'legacy-fingerprint', 'safe', 'safe', 'now')`,
    ).run(marker);

    const scrubbed = listBaselines();
    expect(scrubbed).toHaveLength(2);
    deleteBaseline(marker);
    expect(listBaselines()).toHaveLength(2);

    for (const baseline of scrubbed) deleteBaseline(baseline.id);
    expect(listBaselines()).toEqual([]);
  });
});
