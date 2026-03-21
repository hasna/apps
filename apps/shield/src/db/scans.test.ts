import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { setupTestDb, getCurrentTestDb } from "./test-helpers.js";
import { createProject } from "./projects.js";
import { createScan, getScan, listScans, updateScanStatus, completeScan, deleteScan } from "./scans.js";
import { ScanStatus, ScannerType } from "../types/index.js";

describe("scans", () => {
  let cleanup: () => void;
  let projectId: string;

  beforeEach(() => {
    cleanup = setupTestDb();
    const project = createProject("scan-test-project", "/tmp/scan-test");
    projectId = project.id;
  });

  afterEach(() => {
    cleanup();
  });

  test("createScan returns a scan with pending status", () => {
    const scan = createScan(projectId, [ScannerType.Secrets, ScannerType.Code]);
    expect(scan.id).toBeDefined();
    expect(scan.project_id).toBe(projectId);
    expect(scan.status).toBe(ScanStatus.Pending);
    expect(scan.scanner_types).toEqual([ScannerType.Secrets, ScannerType.Code]);
    expect(scan.findings_count).toBe(0);
    expect(scan.completed_at).toBeNull();
    expect(scan.duration_ms).toBeNull();
    expect(scan.error).toBeNull();
  });

  test("getScan retrieves a scan by id", () => {
    const created = createScan(projectId, [ScannerType.Secrets]);
    const fetched = getScan(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.scanner_types).toEqual([ScannerType.Secrets]);
  });

  test("getScan returns null for unknown id", () => {
    expect(getScan("nonexistent")).toBeNull();
  });

  test("listScans returns all scans for project", () => {
    createScan(projectId, [ScannerType.Secrets]);
    createScan(projectId, [ScannerType.Code]);
    createScan(projectId, [ScannerType.Dependencies]);

    const scans = listScans(projectId);
    expect(scans.length).toBe(3);
    const types = scans.map((s) => s.scanner_types[0]).sort();
    expect(types).toEqual([ScannerType.Code, ScannerType.Dependencies, ScannerType.Secrets]);
  });

  test("listScans filters by project_id", () => {
    const project2 = createProject("other-project", "/tmp/other");
    createScan(projectId, [ScannerType.Secrets]);
    createScan(project2.id, [ScannerType.Code]);

    const scans1 = listScans(projectId);
    expect(scans1.length).toBe(1);

    const scans2 = listScans(project2.id);
    expect(scans2.length).toBe(1);
  });

  test("listScans without project_id returns all scans", () => {
    const project2 = createProject("other", "/tmp/other");
    createScan(projectId, [ScannerType.Secrets]);
    createScan(project2.id, [ScannerType.Code]);

    const allScans = listScans();
    expect(allScans.length).toBe(2);
  });

  test("listScans respects limit parameter", () => {
    createScan(projectId, [ScannerType.Secrets]);
    createScan(projectId, [ScannerType.Code]);
    createScan(projectId, [ScannerType.Dependencies]);

    const scans = listScans(projectId, 2);
    expect(scans.length).toBe(2);
  });

  test("updateScanStatus updates status and findings_count", () => {
    const scan = createScan(projectId, [ScannerType.Secrets]);
    updateScanStatus(scan.id, ScanStatus.Running);

    const updated = getScan(scan.id);
    expect(updated!.status).toBe(ScanStatus.Running);
  });

  test("updateScanStatus updates findings_count when provided", () => {
    const scan = createScan(projectId, [ScannerType.Secrets]);
    updateScanStatus(scan.id, ScanStatus.Running, 5);

    const updated = getScan(scan.id);
    expect(updated!.findings_count).toBe(5);
  });

  test("updateScanStatus sets error when provided", () => {
    const scan = createScan(projectId, [ScannerType.Secrets]);
    updateScanStatus(scan.id, ScanStatus.Failed, undefined, "Something went wrong");

    const updated = getScan(scan.id);
    expect(updated!.status).toBe(ScanStatus.Failed);
    expect(updated!.error).toBe("Something went wrong");
  });

  test("completeScan sets completed status, timestamp, and duration", () => {
    const scan = createScan(projectId, [ScannerType.Secrets]);
    completeScan(scan.id, 10);

    const completed = getScan(scan.id);
    expect(completed!.status).toBe(ScanStatus.Completed);
    expect(completed!.findings_count).toBe(10);
    expect(completed!.completed_at).not.toBeNull();
    expect(completed!.duration_ms).not.toBeNull();
    expect(completed!.duration_ms).toBeGreaterThanOrEqual(0);
  });

  test("deleteScan removes the scan", () => {
    const scan = createScan(projectId, [ScannerType.Secrets]);
    deleteScan(scan.id);
    expect(getScan(scan.id)).toBeNull();
  });

  test("scanner_types JSON round-trips correctly", () => {
    const types = [ScannerType.Secrets, ScannerType.Code, ScannerType.AiSafety];
    const scan = createScan(projectId, types);
    const fetched = getScan(scan.id);
    expect(fetched!.scanner_types).toEqual(types);
  });
});
