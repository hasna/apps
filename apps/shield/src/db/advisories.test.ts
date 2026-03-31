import { describe, test, expect, beforeEach } from "bun:test";
import { getTestDb, getDb } from "./database.js";
import {
  createAdvisory,
  getAdvisory,
  getAdvisoryByPackage,
  listAdvisories,
  searchAdvisories,
  isVersionAffected,
  createAdvisoryIOC,
  getIOCsForAdvisory,
  getAllIOCs,
  findIOCByValue,
  addMonitoredPackage,
  listMonitoredPackages,
  createRegistryEvent,
  listRegistryEvents,
} from "./advisories.js";
import { Severity, Ecosystem, AttackType, IOCType } from "../types/index.js";

// Note: these tests use the real DB since advisories module uses getDb()
// The seed data from previous test runs may be present

describe("advisories DB", () => {
  test("createAdvisory and getAdvisory", () => {
    const advisory = createAdvisory({
      package_name: "test-pkg",
      ecosystem: Ecosystem.Npm,
      affected_versions: ["1.0.0", "1.0.1"],
      safe_versions: ["0.9.9"],
      attack_type: AttackType.MaintainerHijack,
      severity: Severity.Critical,
      title: "Test advisory",
      description: "A test advisory",
      source: "https://example.com",
      threat_actor: "TestActor",
    });

    expect(advisory).toBeDefined();
    expect(advisory.id).toBeTruthy();
    expect(advisory.package_name).toBe("test-pkg");
    expect(advisory.affected_versions).toEqual(["1.0.0", "1.0.1"]);
    expect(advisory.safe_versions).toEqual(["0.9.9"]);
    expect(advisory.threat_actor).toBe("TestActor");

    const fetched = getAdvisory(advisory.id);
    expect(fetched).toBeDefined();
    expect(fetched!.title).toBe("Test advisory");
  });

  test("getAdvisoryByPackage returns matching advisories", () => {
    createAdvisory({
      package_name: "lookup-pkg",
      ecosystem: Ecosystem.Npm,
      affected_versions: ["2.0.0"],
      safe_versions: ["1.9.9"],
      attack_type: AttackType.MaliciousPackage,
      severity: Severity.High,
      title: "Lookup test",
      description: "",
      source: "",
    });

    const results = getAdvisoryByPackage("lookup-pkg", Ecosystem.Npm);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].package_name).toBe("lookup-pkg");
  });

  test("listAdvisories with filters", () => {
    const all = listAdvisories();
    expect(all.length).toBeGreaterThan(0);

    const npmOnly = listAdvisories({ ecosystem: Ecosystem.Npm });
    expect(npmOnly.every((a) => a.ecosystem === Ecosystem.Npm)).toBe(true);

    const criticalOnly = listAdvisories({ severity: Severity.Critical });
    expect(criticalOnly.every((a) => a.severity === Severity.Critical)).toBe(true);
  });

  test("searchAdvisories finds by name and description", () => {
    const results = searchAdvisories("axios");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((a) => a.package_name === "axios")).toBe(true);
  });

  test("isVersionAffected returns advisory for bad version", () => {
    const result = isVersionAffected("axios", "npm", "1.14.1");
    expect(result).not.toBeNull();
    expect(result!.package_name).toBe("axios");
  });

  test("isVersionAffected returns null for safe version", () => {
    const result = isVersionAffected("axios", "npm", "1.13.6");
    expect(result).toBeNull();
  });

  test("isVersionAffected works for litellm on pypi", () => {
    const result = isVersionAffected("litellm", "pypi", "1.82.8");
    expect(result).not.toBeNull();
    expect(result!.threat_actor).toBe("TeamPCP");
  });
});

describe("advisory IOCs", () => {
  test("createAdvisoryIOC and getIOCsForAdvisory", () => {
    const advisory = createAdvisory({
      package_name: "ioc-test-pkg",
      ecosystem: Ecosystem.Npm,
      affected_versions: ["1.0.0"],
      safe_versions: [],
      attack_type: AttackType.MaliciousPackage,
      severity: Severity.Critical,
      title: "IOC test",
      description: "",
      source: "",
    });

    createAdvisoryIOC({
      advisory_id: advisory.id,
      type: IOCType.Domain,
      value: "evil-test.example.com",
      context: "Test C2 domain",
    });

    createAdvisoryIOC({
      advisory_id: advisory.id,
      type: IOCType.IP,
      value: "10.0.0.1",
      context: "Test C2 IP",
      platform: "linux",
    });

    const iocs = getIOCsForAdvisory(advisory.id);
    expect(iocs.length).toBe(2);
    expect(iocs[0].type).toBe(IOCType.Domain);
    expect(iocs[1].type).toBe(IOCType.IP);
  });

  test("getAllIOCs returns all IOCs", () => {
    const all = getAllIOCs();
    expect(all.length).toBeGreaterThan(0);
  });

  test("findIOCByValue finds matching IOCs", () => {
    const results = findIOCByValue("sfrclak.com");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].value).toBe("sfrclak.com");
  });
});

describe("monitored packages", () => {
  test("addMonitoredPackage and listMonitoredPackages", () => {
    const uniqueName = `monitor-test-pkg-${Date.now()}`;
    addMonitoredPackage({
      name: uniqueName,
      ecosystem: Ecosystem.Npm,
      check_interval_ms: 60000,
    });

    const all = listMonitoredPackages();
    const found = all.find((p) => p.name === uniqueName);
    expect(found).toBeDefined();
    expect(found!.status).toBe("active");
  });
});

describe("registry events", () => {
  test("createRegistryEvent and listRegistryEvents", () => {
    createRegistryEvent({
      package_name: "event-test-pkg",
      version: "1.0.0",
      ecosystem: Ecosystem.Npm,
      event_type: "publish",
      suspicious: true,
      analysis: "Published by unknown maintainer",
    });

    const events = listRegistryEvents({ package_name: "event-test-pkg" });
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].suspicious).toBe(1);

    const suspicious = listRegistryEvents({ suspicious_only: true });
    expect(suspicious.length).toBeGreaterThanOrEqual(1);
  });
});
