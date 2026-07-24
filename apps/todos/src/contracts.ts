/** Generated dependency-light Stage A public boundary. */
import type * as Runtime from "./contracts.runtime.js";
import { assertTodosLocalStorageRole as assertStageALocalStorageRole } from "./storage/config.js";
export type * from "./contracts.runtime.js";

function loadRuntime(): typeof Runtime {
  assertStageALocalStorageRole(process.env);
  const runtimeSpecifier = import.meta.url.endsWith(".ts") ? "./contracts.runtime.ts" : "./contracts.runtime.js";
  return require(runtimeSpecifier) as typeof Runtime;
}

function assertPublicSqliteBoundaryArguments(args: readonly unknown[]): void {
  const databaseSpecifier = import.meta.url.endsWith(".ts") ? "./db/database.ts" : "./db/database.js";
  const owner = require(databaseSpecifier) as typeof import("./db/database.js");
  owner.assertPublicSqliteBoundaryArguments(args);
}

type LazyPublicValueKind = "array" | "date" | "map" | "null-object" | "object" | "regexp" | "set";

function lazyPublicValue(name: keyof typeof Runtime, kind: LazyPublicValueKind): unknown {
  const target: object = kind === "array" ? []
    : kind === "date" ? new Date(0)
      : kind === "map" ? new Map()
        : kind === "null-object" ? Object.create(null)
          : kind === "regexp" ? new RegExp("")
            : kind === "set" ? new Set()
              : {};
  let resolved: object | undefined;
  const resolve = (): object => {
    assertStageALocalStorageRole(process.env);
    if (resolved) return resolved;
    const value = Reflect.get(loadRuntime(), name);
    if (value === null || typeof value !== "object") throw new TypeError(`public export ${String(name)} is not an object`);
    resolved = value;
    return value;
  };
  const operationReceiver = (): object => {
    const value = resolve();
    return Reflect.isExtensible(target) ? value : target;
  };
  const materializeTarget = (): boolean => {
    const value = resolve();
    if (!Reflect.isExtensible(target)) return true;
    if (kind === "map") {
      for (const [entryKey, entryValue] of value as Map<unknown, unknown>)
        (target as Map<unknown, unknown>).set(entryKey, entryValue);
    } else if (kind === "set") {
      for (const entryValue of value as Set<unknown>) (target as Set<unknown>).add(entryValue);
    } else if (kind === "date") {
      (target as Date).setTime((value as Date).getTime());
    }
    for (const property of Reflect.ownKeys(value)) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, property);
      if (!descriptor) continue;
      const current = Reflect.getOwnPropertyDescriptor(target, property);
      if (current && !current.configurable) {
        if ("value" in descriptor && "value" in current) {
          if (!Reflect.defineProperty(target, property, { value: descriptor.value, writable: descriptor.writable })) return false;
        } else if (descriptor.get !== current.get || descriptor.set !== current.set) return false;
        continue;
      }
      if (!Reflect.defineProperty(target, property, descriptor)) return false;
    }
    return Reflect.preventExtensions(target);
  };
  return new Proxy(target, {
    get(_target, property) {
      const receiver = operationReceiver();
      const value = Reflect.get(receiver, property, receiver);
      if (typeof value !== "function") return value;
      return new Proxy(value, {
        apply(_method, _thisArg, args) { return Reflect.apply(value, operationReceiver(), args); },
        construct(_method, args, newTarget) { resolve(); return Reflect.construct(value, args, newTarget); },
      });
    },
    set(_target, property, value) { const receiver = operationReceiver(); return Reflect.set(receiver, property, value, receiver); },
    has(_target, property) { return Reflect.has(operationReceiver(), property); },
    ownKeys() { return Reflect.ownKeys(operationReceiver()); },
    getOwnPropertyDescriptor(_target, property) {
      if (!Reflect.isExtensible(target)) return Reflect.getOwnPropertyDescriptor(target, property);
      if (kind === "array" && property === "length") {
        (target as unknown[]).length = (resolve() as unknown[]).length;
        return Reflect.getOwnPropertyDescriptor(target, property);
      }
      const descriptor = Reflect.getOwnPropertyDescriptor(resolve(), property);
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
    defineProperty(_target, property, descriptor) { return Reflect.defineProperty(operationReceiver(), property, descriptor); },
    deleteProperty(_target, property) { return Reflect.deleteProperty(operationReceiver(), property); },
    preventExtensions() { return materializeTarget(); },
  });
}

export const DEFAULT_ENCRYPTION_KEY_ENV = ("TODOS_ENCRYPTION_KEY") as unknown as typeof Runtime.DEFAULT_ENCRYPTION_KEY_ENV;
export const DEFAULT_ENCRYPTION_PROFILE = ("default") as unknown as typeof Runtime.DEFAULT_ENCRYPTION_PROFILE;
export const EXTERNAL_ISSUE_IMPORT_SCHEMA_VERSION = 1 as unknown as typeof Runtime.EXTERNAL_ISSUE_IMPORT_SCHEMA_VERSION;
export const LOCAL_AUDIT_LEDGER_HASH_ALGORITHM = ("sha256") as unknown as typeof Runtime.LOCAL_AUDIT_LEDGER_HASH_ALGORITHM;
export const LOCAL_AUDIT_LEDGER_SCHEMA_VERSION = 1 as unknown as typeof Runtime.LOCAL_AUDIT_LEDGER_SCHEMA_VERSION;
export const LOCAL_BACKUP_CHECKSUM_ALGORITHM = ("sha256") as unknown as typeof Runtime.LOCAL_BACKUP_CHECKSUM_ALGORITHM;
export const LOCAL_NOTIFICATION_SCHEMA_VERSION = 1 as unknown as typeof Runtime.LOCAL_NOTIFICATION_SCHEMA_VERSION;
export const LOCAL_RELEASE_COMPATIBILITY_SCHEMA_VERSION = 1 as unknown as typeof Runtime.LOCAL_RELEASE_COMPATIBILITY_SCHEMA_VERSION;
export const LOCAL_REPORT_SCHEMA_VERSION = 1 as unknown as typeof Runtime.LOCAL_REPORT_SCHEMA_VERSION;
export const LOCAL_REPORT_TYPES = lazyPublicValue("LOCAL_REPORT_TYPES", "array") as typeof Runtime.LOCAL_REPORT_TYPES;
export const LOCAL_ROADMAP_SCHEMA_VERSION = 1 as unknown as typeof Runtime.LOCAL_ROADMAP_SCHEMA_VERSION;
export const LOCAL_USAGE_LEDGER_SCHEMA_VERSION = 1 as unknown as typeof Runtime.LOCAL_USAGE_LEDGER_SCHEMA_VERSION;
export const TESTERS_ISSUE_REPORT_BATCH_RESULT_SCHEMA_VERSION = ("todos.tester_issue_report_batch_result.v1") as unknown as typeof Runtime.TESTERS_ISSUE_REPORT_BATCH_RESULT_SCHEMA_VERSION;
export const TESTERS_ISSUE_REPORT_RESULT_SCHEMA_VERSION = ("todos.tester_issue_report_result.v1") as unknown as typeof Runtime.TESTERS_ISSUE_REPORT_RESULT_SCHEMA_VERSION;
export const TESTERS_ISSUE_REPORT_SCHEMA_VERSION = ("testers.issue_report.v1") as unknown as typeof Runtime.TESTERS_ISSUE_REPORT_SCHEMA_VERSION;
export const TODOS_API_ROUTES = lazyPublicValue("TODOS_API_ROUTES", "array") as typeof Runtime.TODOS_API_ROUTES;
export const TODOS_CONTRACTS = lazyPublicValue("TODOS_CONTRACTS", "object") as typeof Runtime.TODOS_CONTRACTS;
export const TODOS_ENCRYPTED_BRIDGE_KIND = ("hasna.todos.encrypted-bridge") as unknown as typeof Runtime.TODOS_ENCRYPTED_BRIDGE_KIND;
export const TODOS_ENCRYPTED_VALUE_KIND = ("hasna.todos.encrypted-value") as unknown as typeof Runtime.TODOS_ENCRYPTED_VALUE_KIND;
export const TODOS_ENCRYPTION_SCHEMA_VERSION = 1 as unknown as typeof Runtime.TODOS_ENCRYPTION_SCHEMA_VERSION;
export const TODOS_ERROR_CODES = lazyPublicValue("TODOS_ERROR_CODES", "array") as typeof Runtime.TODOS_ERROR_CODES;
export const TODOS_JSON_CONTRACTS = lazyPublicValue("TODOS_JSON_CONTRACTS", "array") as typeof Runtime.TODOS_JSON_CONTRACTS;
export const TODOS_JSON_CONTRACTS_MANIFEST = lazyPublicValue("TODOS_JSON_CONTRACTS_MANIFEST", "object") as typeof Runtime.TODOS_JSON_CONTRACTS_MANIFEST;
export const TODOS_LOCAL_BACKUP_KIND = ("hasna.todos.local-backup") as unknown as typeof Runtime.TODOS_LOCAL_BACKUP_KIND;
export const TODOS_LOCAL_BACKUP_SCHEMA_VERSION = 1 as unknown as typeof Runtime.TODOS_LOCAL_BACKUP_SCHEMA_VERSION;
export const TODOS_LOCAL_BRIDGE_KIND = ("hasna.todos.local-bridge") as unknown as typeof Runtime.TODOS_LOCAL_BRIDGE_KIND;
export const TODOS_LOCAL_BRIDGE_SCHEMA_VERSION = 1 as unknown as typeof Runtime.TODOS_LOCAL_BRIDGE_SCHEMA_VERSION;
export const TODOS_LOCAL_INTEGRITY_KIND = ("hasna.todos.local-integrity") as unknown as typeof Runtime.TODOS_LOCAL_INTEGRITY_KIND;
export const TODOS_LOCAL_INTEGRITY_SCHEMA_VERSION = 1 as unknown as typeof Runtime.TODOS_LOCAL_INTEGRITY_SCHEMA_VERSION;
export const TODOS_LOCAL_SNAPSHOT_SCHEMA_VERSION = 1 as unknown as typeof Runtime.TODOS_LOCAL_SNAPSHOT_SCHEMA_VERSION;
export const TODOS_ONBOARDING_FIXTURE_LIBRARY_VERSION = ("2026-05-22") as unknown as typeof Runtime.TODOS_ONBOARDING_FIXTURE_LIBRARY_VERSION;
export const TODOS_ONBOARDING_FIXTURE_SOURCE = ("bundled-local-onboarding-fixtures") as unknown as typeof Runtime.TODOS_ONBOARDING_FIXTURE_SOURCE;
export const TODOS_SDK_INTEGRATION_FIXTURE_GENERATED_AT = ("2026-05-22T00:00:00.000Z") as unknown as typeof Runtime.TODOS_SDK_INTEGRATION_FIXTURE_GENERATED_AT;
export const TODOS_SDK_INTEGRATION_FIXTURE_SCHEMA_VERSION = 1 as unknown as typeof Runtime.TODOS_SDK_INTEGRATION_FIXTURE_SCHEMA_VERSION;
export const approveReviewItem = function approveReviewItem(this: unknown, a0: any, a1: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, a1, ...args]); return Reflect.apply(loadRuntime().approveReviewItem, this, [a0, a1, ...args]); } as unknown as typeof Runtime.approveReviewItem;
Object.defineProperties(approveReviewItem, { name: { value: "approveReviewItem", configurable: true }, length: { value: 2, configurable: true } });
export const checkLocalIntegrity = function checkLocalIntegrity(this: unknown, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(loadRuntime().checkLocalIntegrity, this, [...args]); } as unknown as typeof Runtime.checkLocalIntegrity;
Object.defineProperties(checkLocalIntegrity, { name: { value: "checkLocalIntegrity", configurable: true }, length: { value: 0, configurable: true } });
export const checkLocalNotifications = async function checkLocalNotifications(this: unknown, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(loadRuntime().checkLocalNotifications, this, [...args]); } as unknown as typeof Runtime.checkLocalNotifications;
Object.defineProperties(checkLocalNotifications, { name: { value: "checkLocalNotifications", configurable: true }, length: { value: 0, configurable: true } });
export const claimReviewItem = function claimReviewItem(this: unknown, a0: any, a1: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, a1, ...args]); return Reflect.apply(loadRuntime().claimReviewItem, this, [a0, a1, ...args]); } as unknown as typeof Runtime.claimReviewItem;
Object.defineProperties(claimReviewItem, { name: { value: "claimReviewItem", configurable: true }, length: { value: 2, configurable: true } });
export const createContractsManifest = function createContractsManifest(this: unknown, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(loadRuntime().createContractsManifest, this, [...args]); } as unknown as typeof Runtime.createContractsManifest;
Object.defineProperties(createContractsManifest, { name: { value: "createContractsManifest", configurable: true }, length: { value: 0, configurable: true } });
export const createEncryptedBridgeBundle = function createEncryptedBridgeBundle(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().createEncryptedBridgeBundle, this, [a0, ...args]); } as unknown as typeof Runtime.createEncryptedBridgeBundle;
Object.defineProperties(createEncryptedBridgeBundle, { name: { value: "createEncryptedBridgeBundle", configurable: true }, length: { value: 1, configurable: true } });
export const createJsonContractsManifest = function createJsonContractsManifest(this: unknown, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(loadRuntime().createJsonContractsManifest, this, [...args]); } as unknown as typeof Runtime.createJsonContractsManifest;
Object.defineProperties(createJsonContractsManifest, { name: { value: "createJsonContractsManifest", configurable: true }, length: { value: 0, configurable: true } });
export const createLocalBackup = function createLocalBackup(this: unknown, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(loadRuntime().createLocalBackup, this, [...args]); } as unknown as typeof Runtime.createLocalBackup;
Object.defineProperties(createLocalBackup, { name: { value: "createLocalBackup", configurable: true }, length: { value: 0, configurable: true } });
export const createLocalBridgeBundle = function createLocalBridgeBundle(this: unknown, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(loadRuntime().createLocalBridgeBundle, this, [...args]); } as unknown as typeof Runtime.createLocalBridgeBundle;
Object.defineProperties(createLocalBridgeBundle, { name: { value: "createLocalBridgeBundle", configurable: true }, length: { value: 0, configurable: true } });
export const createLocalReport = function createLocalReport(this: unknown, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(loadRuntime().createLocalReport, this, [...args]); } as unknown as typeof Runtime.createLocalReport;
Object.defineProperties(createLocalReport, { name: { value: "createLocalReport", configurable: true }, length: { value: 0, configurable: true } });
export const createLocalUsageLedger = function createLocalUsageLedger(this: unknown, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(loadRuntime().createLocalUsageLedger, this, [...args]); } as unknown as typeof Runtime.createLocalUsageLedger;
Object.defineProperties(createLocalUsageLedger, { name: { value: "createLocalUsageLedger", configurable: true }, length: { value: 0, configurable: true } });
export const createMilestone = function createMilestone(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().createMilestone, this, [a0, ...args]); } as unknown as typeof Runtime.createMilestone;
Object.defineProperties(createMilestone, { name: { value: "createMilestone", configurable: true }, length: { value: 1, configurable: true } });
export const createReleaseCompatibilityReport = function createReleaseCompatibilityReport(this: unknown, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(loadRuntime().createReleaseCompatibilityReport, this, [...args]); } as unknown as typeof Runtime.createReleaseCompatibilityReport;
Object.defineProperties(createReleaseCompatibilityReport, { name: { value: "createReleaseCompatibilityReport", configurable: true }, length: { value: 0, configurable: true } });
export const createRoadmap = function createRoadmap(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().createRoadmap, this, [a0, ...args]); } as unknown as typeof Runtime.createRoadmap;
Object.defineProperties(createRoadmap, { name: { value: "createRoadmap", configurable: true }, length: { value: 1, configurable: true } });
export const createSdkIntegrationFixturePack = function createSdkIntegrationFixturePack(this: unknown, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(loadRuntime().createSdkIntegrationFixturePack, this, [...args]); } as unknown as typeof Runtime.createSdkIntegrationFixturePack;
Object.defineProperties(createSdkIntegrationFixturePack, { name: { value: "createSdkIntegrationFixturePack", configurable: true }, length: { value: 0, configurable: true } });
export const decryptBridgeBundle = function decryptBridgeBundle(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().decryptBridgeBundle, this, [a0, ...args]); } as unknown as typeof Runtime.decryptBridgeBundle;
Object.defineProperties(decryptBridgeBundle, { name: { value: "decryptBridgeBundle", configurable: true }, length: { value: 1, configurable: true } });
export const decryptString = function decryptString(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().decryptString, this, [a0, ...args]); } as unknown as typeof Runtime.decryptString;
Object.defineProperties(decryptString, { name: { value: "decryptString", configurable: true }, length: { value: 1, configurable: true } });
export const decryptValue = function decryptValue(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().decryptValue, this, [a0, ...args]); } as unknown as typeof Runtime.decryptValue;
Object.defineProperties(decryptValue, { name: { value: "decryptValue", configurable: true }, length: { value: 1, configurable: true } });
export const deleteMilestone = function deleteMilestone(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().deleteMilestone, this, [a0, ...args]); } as unknown as typeof Runtime.deleteMilestone;
Object.defineProperties(deleteMilestone, { name: { value: "deleteMilestone", configurable: true }, length: { value: 1, configurable: true } });
export const deleteRoadmap = function deleteRoadmap(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().deleteRoadmap, this, [a0, ...args]); } as unknown as typeof Runtime.deleteRoadmap;
Object.defineProperties(deleteRoadmap, { name: { value: "deleteRoadmap", configurable: true }, length: { value: 1, configurable: true } });
export const encryptSensitiveFields = function encryptSensitiveFields(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().encryptSensitiveFields, this, [a0, ...args]); } as unknown as typeof Runtime.encryptSensitiveFields;
Object.defineProperties(encryptSensitiveFields, { name: { value: "encryptSensitiveFields", configurable: true }, length: { value: 1, configurable: true } });
export const encryptString = function encryptString(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().encryptString, this, [a0, ...args]); } as unknown as typeof Runtime.encryptString;
Object.defineProperties(encryptString, { name: { value: "encryptString", configurable: true }, length: { value: 1, configurable: true } });
export const encryptValue = function encryptValue(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().encryptValue, this, [a0, ...args]); } as unknown as typeof Runtime.encryptValue;
Object.defineProperties(encryptValue, { name: { value: "encryptValue", configurable: true }, length: { value: 1, configurable: true } });
export const encryptionProfileStatus = function encryptionProfileStatus(this: unknown, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(loadRuntime().encryptionProfileStatus, this, [...args]); } as unknown as typeof Runtime.encryptionProfileStatus;
Object.defineProperties(encryptionProfileStatus, { name: { value: "encryptionProfileStatus", configurable: true }, length: { value: 0, configurable: true } });
export const exportRoadmapBundle = function exportRoadmapBundle(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().exportRoadmapBundle, this, [a0, ...args]); } as unknown as typeof Runtime.exportRoadmapBundle;
Object.defineProperties(exportRoadmapBundle, { name: { value: "exportRoadmapBundle", configurable: true }, length: { value: 1, configurable: true } });
export const fingerprintTesterIssueReport = function fingerprintTesterIssueReport(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().fingerprintTesterIssueReport, this, [a0, ...args]); } as unknown as typeof Runtime.fingerprintTesterIssueReport;
Object.defineProperties(fingerprintTesterIssueReport, { name: { value: "fingerprintTesterIssueReport", configurable: true }, length: { value: 1, configurable: true } });
export const getJsonContract = function getJsonContract(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().getJsonContract, this, [a0, ...args]); } as unknown as typeof Runtime.getJsonContract;
Object.defineProperties(getJsonContract, { name: { value: "getJsonContract", configurable: true }, length: { value: 1, configurable: true } });
export const getLocalAuditLedger = function getLocalAuditLedger(this: unknown, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(loadRuntime().getLocalAuditLedger, this, [...args]); } as unknown as typeof Runtime.getLocalAuditLedger;
Object.defineProperties(getLocalAuditLedger, { name: { value: "getLocalAuditLedger", configurable: true }, length: { value: 0, configurable: true } });
export const getLocalSnapshot = function getLocalSnapshot(this: unknown, a0: any, a1: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, a1, ...args]); return Reflect.apply(loadRuntime().getLocalSnapshot, this, [a0, a1, ...args]); } as unknown as typeof Runtime.getLocalSnapshot;
Object.defineProperties(getLocalSnapshot, { name: { value: "getLocalSnapshot", configurable: true }, length: { value: 2, configurable: true } });
export const getOnboardingFixture = function getOnboardingFixture(this: unknown, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(loadRuntime().getOnboardingFixture, this, [...args]); } as unknown as typeof Runtime.getOnboardingFixture;
Object.defineProperties(getOnboardingFixture, { name: { value: "getOnboardingFixture", configurable: true }, length: { value: 0, configurable: true } });
export const getOnboardingFixtureBundle = function getOnboardingFixtureBundle(this: unknown, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(loadRuntime().getOnboardingFixtureBundle, this, [...args]); } as unknown as typeof Runtime.getOnboardingFixtureBundle;
Object.defineProperties(getOnboardingFixtureBundle, { name: { value: "getOnboardingFixtureBundle", configurable: true }, length: { value: 0, configurable: true } });
export const getRoadmap = function getRoadmap(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().getRoadmap, this, [a0, ...args]); } as unknown as typeof Runtime.getRoadmap;
Object.defineProperties(getRoadmap, { name: { value: "getRoadmap", configurable: true }, length: { value: 1, configurable: true } });
export const importExternalIssues = function importExternalIssues(this: unknown, a0: any, a1: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, a1, ...args]); return Reflect.apply(loadRuntime().importExternalIssues, this, [a0, a1, ...args]); } as unknown as typeof Runtime.importExternalIssues;
Object.defineProperties(importExternalIssues, { name: { value: "importExternalIssues", configurable: true }, length: { value: 2, configurable: true } });
export const importLocalBridgeBundle = function importLocalBridgeBundle(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().importLocalBridgeBundle, this, [a0, ...args]); } as unknown as typeof Runtime.importLocalBridgeBundle;
Object.defineProperties(importLocalBridgeBundle, { name: { value: "importLocalBridgeBundle", configurable: true }, length: { value: 1, configurable: true } });
export const importOnboardingFixture = function importOnboardingFixture(this: unknown, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(loadRuntime().importOnboardingFixture, this, [...args]); } as unknown as typeof Runtime.importOnboardingFixture;
Object.defineProperties(importOnboardingFixture, { name: { value: "importOnboardingFixture", configurable: true }, length: { value: 0, configurable: true } });
export const importRoadmapBundle = function importRoadmapBundle(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().importRoadmapBundle, this, [a0, ...args]); } as unknown as typeof Runtime.importRoadmapBundle;
Object.defineProperties(importRoadmapBundle, { name: { value: "importRoadmapBundle", configurable: true }, length: { value: 1, configurable: true } });
export const isEncryptedBridgeBundle = function isEncryptedBridgeBundle(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().isEncryptedBridgeBundle, this, [a0, ...args]); } as unknown as typeof Runtime.isEncryptedBridgeBundle;
Object.defineProperties(isEncryptedBridgeBundle, { name: { value: "isEncryptedBridgeBundle", configurable: true }, length: { value: 1, configurable: true } });
export const isEncryptedValue = function isEncryptedValue(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().isEncryptedValue, this, [a0, ...args]); } as unknown as typeof Runtime.isEncryptedValue;
Object.defineProperties(isEncryptedValue, { name: { value: "isEncryptedValue", configurable: true }, length: { value: 1, configurable: true } });
export const listEncryptionProfiles = function listEncryptionProfiles(this: unknown, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(loadRuntime().listEncryptionProfiles, this, [...args]); } as unknown as typeof Runtime.listEncryptionProfiles;
Object.defineProperties(listEncryptionProfiles, { name: { value: "listEncryptionProfiles", configurable: true }, length: { value: 0, configurable: true } });
export const listLocalAuditLedgerCheckpoints = function listLocalAuditLedgerCheckpoints(this: unknown, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(loadRuntime().listLocalAuditLedgerCheckpoints, this, [...args]); } as unknown as typeof Runtime.listLocalAuditLedgerCheckpoints;
Object.defineProperties(listLocalAuditLedgerCheckpoints, { name: { value: "listLocalAuditLedgerCheckpoints", configurable: true }, length: { value: 0, configurable: true } });
export const listLocalReportTypes = function listLocalReportTypes(this: unknown, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(loadRuntime().listLocalReportTypes, this, [...args]); } as unknown as typeof Runtime.listLocalReportTypes;
Object.defineProperties(listLocalReportTypes, { name: { value: "listLocalReportTypes", configurable: true }, length: { value: 0, configurable: true } });
export const listLocalSnapshotResources = function listLocalSnapshotResources(this: unknown, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(loadRuntime().listLocalSnapshotResources, this, [...args]); } as unknown as typeof Runtime.listLocalSnapshotResources;
Object.defineProperties(listLocalSnapshotResources, { name: { value: "listLocalSnapshotResources", configurable: true }, length: { value: 0, configurable: true } });
export const listMilestones = function listMilestones(this: unknown, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(loadRuntime().listMilestones, this, [...args]); } as unknown as typeof Runtime.listMilestones;
Object.defineProperties(listMilestones, { name: { value: "listMilestones", configurable: true }, length: { value: 0, configurable: true } });
export const listOnboardingFixtures = function listOnboardingFixtures(this: unknown, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(loadRuntime().listOnboardingFixtures, this, [...args]); } as unknown as typeof Runtime.listOnboardingFixtures;
Object.defineProperties(listOnboardingFixtures, { name: { value: "listOnboardingFixtures", configurable: true }, length: { value: 0, configurable: true } });
export const listReleaseGroups = function listReleaseGroups(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().listReleaseGroups, this, [a0, ...args]); } as unknown as typeof Runtime.listReleaseGroups;
Object.defineProperties(listReleaseGroups, { name: { value: "listReleaseGroups", configurable: true }, length: { value: 1, configurable: true } });
export const listReviewQueue = function listReviewQueue(this: unknown, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(loadRuntime().listReviewQueue, this, [...args]); } as unknown as typeof Runtime.listReviewQueue;
Object.defineProperties(listReviewQueue, { name: { value: "listReviewQueue", configurable: true }, length: { value: 0, configurable: true } });
export const listReviewRoutingRules = function listReviewRoutingRules(this: unknown, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(loadRuntime().listReviewRoutingRules, this, [...args]); } as unknown as typeof Runtime.listReviewRoutingRules;
Object.defineProperties(listReviewRoutingRules, { name: { value: "listReviewRoutingRules", configurable: true }, length: { value: 0, configurable: true } });
export const listRoadmaps = function listRoadmaps(this: unknown, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(loadRuntime().listRoadmaps, this, [...args]); } as unknown as typeof Runtime.listRoadmaps;
Object.defineProperties(listRoadmaps, { name: { value: "listRoadmaps", configurable: true }, length: { value: 0, configurable: true } });
export const listSdkIntegrationExamples = function listSdkIntegrationExamples(this: unknown, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(loadRuntime().listSdkIntegrationExamples, this, [...args]); } as unknown as typeof Runtime.listSdkIntegrationExamples;
Object.defineProperties(listSdkIntegrationExamples, { name: { value: "listSdkIntegrationExamples", configurable: true }, length: { value: 0, configurable: true } });
export const normalizeTesterIssueReport = function normalizeTesterIssueReport(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().normalizeTesterIssueReport, this, [a0, ...args]); } as unknown as typeof Runtime.normalizeTesterIssueReport;
Object.defineProperties(normalizeTesterIssueReport, { name: { value: "normalizeTesterIssueReport", configurable: true }, length: { value: 1, configurable: true } });
export const pollLocalSnapshots = function pollLocalSnapshots(this: unknown, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(loadRuntime().pollLocalSnapshots, this, [...args]); } as unknown as typeof Runtime.pollLocalSnapshots;
Object.defineProperties(pollLocalSnapshots, { name: { value: "pollLocalSnapshots", configurable: true }, length: { value: 0, configurable: true } });
export const readLocalBackupFile = function readLocalBackupFile(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().readLocalBackupFile, this, [a0, ...args]); } as unknown as typeof Runtime.readLocalBackupFile;
Object.defineProperties(readLocalBackupFile, { name: { value: "readLocalBackupFile", configurable: true }, length: { value: 1, configurable: true } });
export const readTesterIssueReportsPayload = function readTesterIssueReportsPayload(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().readTesterIssueReportsPayload, this, [a0, ...args]); } as unknown as typeof Runtime.readTesterIssueReportsPayload;
Object.defineProperties(readTesterIssueReportsPayload, { name: { value: "readTesterIssueReportsPayload", configurable: true }, length: { value: 1, configurable: true } });
export const removeEncryptionProfile = function removeEncryptionProfile(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().removeEncryptionProfile, this, [a0, ...args]); } as unknown as typeof Runtime.removeEncryptionProfile;
Object.defineProperties(removeEncryptionProfile, { name: { value: "removeEncryptionProfile", configurable: true }, length: { value: 1, configurable: true } });
export const removeReviewRoutingRule = function removeReviewRoutingRule(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().removeReviewRoutingRule, this, [a0, ...args]); } as unknown as typeof Runtime.removeReviewRoutingRule;
Object.defineProperties(removeReviewRoutingRule, { name: { value: "removeReviewRoutingRule", configurable: true }, length: { value: 1, configurable: true } });
export const renderLocalAuditLedgerMarkdown = function renderLocalAuditLedgerMarkdown(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().renderLocalAuditLedgerMarkdown, this, [a0, ...args]); } as unknown as typeof Runtime.renderLocalAuditLedgerMarkdown;
Object.defineProperties(renderLocalAuditLedgerMarkdown, { name: { value: "renderLocalAuditLedgerMarkdown", configurable: true }, length: { value: 1, configurable: true } });
export const renderLocalReportMarkdown = function renderLocalReportMarkdown(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().renderLocalReportMarkdown, this, [a0, ...args]); } as unknown as typeof Runtime.renderLocalReportMarkdown;
Object.defineProperties(renderLocalReportMarkdown, { name: { value: "renderLocalReportMarkdown", configurable: true }, length: { value: 1, configurable: true } });
export const renderLocalSnapshotMarkdown = function renderLocalSnapshotMarkdown(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().renderLocalSnapshotMarkdown, this, [a0, ...args]); } as unknown as typeof Runtime.renderLocalSnapshotMarkdown;
Object.defineProperties(renderLocalSnapshotMarkdown, { name: { value: "renderLocalSnapshotMarkdown", configurable: true }, length: { value: 1, configurable: true } });
export const renderLocalUsageLedgerMarkdown = function renderLocalUsageLedgerMarkdown(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().renderLocalUsageLedgerMarkdown, this, [a0, ...args]); } as unknown as typeof Runtime.renderLocalUsageLedgerMarkdown;
Object.defineProperties(renderLocalUsageLedgerMarkdown, { name: { value: "renderLocalUsageLedgerMarkdown", configurable: true }, length: { value: 1, configurable: true } });
export const renderReleaseCompatibilityMarkdown = function renderReleaseCompatibilityMarkdown(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().renderReleaseCompatibilityMarkdown, this, [a0, ...args]); } as unknown as typeof Runtime.renderReleaseCompatibilityMarkdown;
Object.defineProperties(renderReleaseCompatibilityMarkdown, { name: { value: "renderReleaseCompatibilityMarkdown", configurable: true }, length: { value: 1, configurable: true } });
export const renderRoadmapMarkdown = function renderRoadmapMarkdown(this: unknown, a0: any, a1: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, a1, ...args]); return Reflect.apply(loadRuntime().renderRoadmapMarkdown, this, [a0, a1, ...args]); } as unknown as typeof Runtime.renderRoadmapMarkdown;
Object.defineProperties(renderRoadmapMarkdown, { name: { value: "renderRoadmapMarkdown", configurable: true }, length: { value: 2, configurable: true } });
export const reopenReviewItem = function reopenReviewItem(this: unknown, a0: any, a1: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, a1, ...args]); return Reflect.apply(loadRuntime().reopenReviewItem, this, [a0, a1, ...args]); } as unknown as typeof Runtime.reopenReviewItem;
Object.defineProperties(reopenReviewItem, { name: { value: "reopenReviewItem", configurable: true }, length: { value: 2, configurable: true } });
export const requestReviewQueue = function requestReviewQueue(this: unknown, a0: any, a1: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, a1, ...args]); return Reflect.apply(loadRuntime().requestReviewQueue, this, [a0, a1, ...args]); } as unknown as typeof Runtime.requestReviewQueue;
Object.defineProperties(requestReviewQueue, { name: { value: "requestReviewQueue", configurable: true }, length: { value: 2, configurable: true } });
export const restoreLocalBackup = function restoreLocalBackup(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().restoreLocalBackup, this, [a0, ...args]); } as unknown as typeof Runtime.restoreLocalBackup;
Object.defineProperties(restoreLocalBackup, { name: { value: "restoreLocalBackup", configurable: true }, length: { value: 1, configurable: true } });
export const returnReviewItem = function returnReviewItem(this: unknown, a0: any, a1: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, a1, ...args]); return Reflect.apply(loadRuntime().returnReviewItem, this, [a0, a1, ...args]); } as unknown as typeof Runtime.returnReviewItem;
Object.defineProperties(returnReviewItem, { name: { value: "returnReviewItem", configurable: true }, length: { value: 2, configurable: true } });
export const sealLocalAuditLedger = function sealLocalAuditLedger(this: unknown, a0: any, a1: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, a1, ...args]); return Reflect.apply(loadRuntime().sealLocalAuditLedger, this, [a0, a1, ...args]); } as unknown as typeof Runtime.sealLocalAuditLedger;
Object.defineProperties(sealLocalAuditLedger, { name: { value: "sealLocalAuditLedger", configurable: true }, length: { value: 2, configurable: true } });
export const summarizeMilestone = function summarizeMilestone(this: unknown, a0: any, a1: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, a1, ...args]); return Reflect.apply(loadRuntime().summarizeMilestone, this, [a0, a1, ...args]); } as unknown as typeof Runtime.summarizeMilestone;
Object.defineProperties(summarizeMilestone, { name: { value: "summarizeMilestone", configurable: true }, length: { value: 2, configurable: true } });
export const summarizeRoadmap = function summarizeRoadmap(this: unknown, a0: any, a1: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, a1, ...args]); return Reflect.apply(loadRuntime().summarizeRoadmap, this, [a0, a1, ...args]); } as unknown as typeof Runtime.summarizeRoadmap;
Object.defineProperties(summarizeRoadmap, { name: { value: "summarizeRoadmap", configurable: true }, length: { value: 2, configurable: true } });
export const updateMilestone = function updateMilestone(this: unknown, a0: any, a1: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, a1, ...args]); return Reflect.apply(loadRuntime().updateMilestone, this, [a0, a1, ...args]); } as unknown as typeof Runtime.updateMilestone;
Object.defineProperties(updateMilestone, { name: { value: "updateMilestone", configurable: true }, length: { value: 2, configurable: true } });
export const updateRoadmap = function updateRoadmap(this: unknown, a0: any, a1: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, a1, ...args]); return Reflect.apply(loadRuntime().updateRoadmap, this, [a0, a1, ...args]); } as unknown as typeof Runtime.updateRoadmap;
Object.defineProperties(updateRoadmap, { name: { value: "updateRoadmap", configurable: true }, length: { value: 2, configurable: true } });
export const upsertEncryptionProfile = function upsertEncryptionProfile(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().upsertEncryptionProfile, this, [a0, ...args]); } as unknown as typeof Runtime.upsertEncryptionProfile;
Object.defineProperties(upsertEncryptionProfile, { name: { value: "upsertEncryptionProfile", configurable: true }, length: { value: 1, configurable: true } });
export const upsertReleaseGroup = function upsertReleaseGroup(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().upsertReleaseGroup, this, [a0, ...args]); } as unknown as typeof Runtime.upsertReleaseGroup;
Object.defineProperties(upsertReleaseGroup, { name: { value: "upsertReleaseGroup", configurable: true }, length: { value: 1, configurable: true } });
export const upsertReviewRoutingRule = function upsertReviewRoutingRule(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().upsertReviewRoutingRule, this, [a0, ...args]); } as unknown as typeof Runtime.upsertReviewRoutingRule;
Object.defineProperties(upsertReviewRoutingRule, { name: { value: "upsertReviewRoutingRule", configurable: true }, length: { value: 1, configurable: true } });
export const upsertTesterIssueReport = function upsertTesterIssueReport(this: unknown, a0: any, a1: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, a1, ...args]); return Reflect.apply(loadRuntime().upsertTesterIssueReport, this, [a0, a1, ...args]); } as unknown as typeof Runtime.upsertTesterIssueReport;
Object.defineProperties(upsertTesterIssueReport, { name: { value: "upsertTesterIssueReport", configurable: true }, length: { value: 2, configurable: true } });
export const upsertTesterIssueReports = function upsertTesterIssueReports(this: unknown, a0: any, a1: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, a1, ...args]); return Reflect.apply(loadRuntime().upsertTesterIssueReports, this, [a0, a1, ...args]); } as unknown as typeof Runtime.upsertTesterIssueReports;
Object.defineProperties(upsertTesterIssueReports, { name: { value: "upsertTesterIssueReports", configurable: true }, length: { value: 2, configurable: true } });
export const validateJsonContract = function validateJsonContract(this: unknown, a0: any, a1: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, a1, ...args]); return Reflect.apply(loadRuntime().validateJsonContract, this, [a0, a1, ...args]); } as unknown as typeof Runtime.validateJsonContract;
Object.defineProperties(validateJsonContract, { name: { value: "validateJsonContract", configurable: true }, length: { value: 2, configurable: true } });
export const validateLocalBridgeBundle = function validateLocalBridgeBundle(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().validateLocalBridgeBundle, this, [a0, ...args]); } as unknown as typeof Runtime.validateLocalBridgeBundle;
Object.defineProperties(validateLocalBridgeBundle, { name: { value: "validateLocalBridgeBundle", configurable: true }, length: { value: 1, configurable: true } });
export const verifyLocalAuditLedger = function verifyLocalAuditLedger(this: unknown, a0: any, a1: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, a1, ...args]); return Reflect.apply(loadRuntime().verifyLocalAuditLedger, this, [a0, a1, ...args]); } as unknown as typeof Runtime.verifyLocalAuditLedger;
Object.defineProperties(verifyLocalAuditLedger, { name: { value: "verifyLocalAuditLedger", configurable: true }, length: { value: 2, configurable: true } });
export const verifyLocalBackup = function verifyLocalBackup(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().verifyLocalBackup, this, [a0, ...args]); } as unknown as typeof Runtime.verifyLocalBackup;
Object.defineProperties(verifyLocalBackup, { name: { value: "verifyLocalBackup", configurable: true }, length: { value: 1, configurable: true } });
export const writeLocalBackupFile = function writeLocalBackupFile(this: unknown, a0: any, a1: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, a1, ...args]); return Reflect.apply(loadRuntime().writeLocalBackupFile, this, [a0, a1, ...args]); } as unknown as typeof Runtime.writeLocalBackupFile;
Object.defineProperties(writeLocalBackupFile, { name: { value: "writeLocalBackupFile", configurable: true }, length: { value: 2, configurable: true } });
export const writeOnboardingFixtureFiles = function writeOnboardingFixtureFiles(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().writeOnboardingFixtureFiles, this, [a0, ...args]); } as unknown as typeof Runtime.writeOnboardingFixtureFiles;
Object.defineProperties(writeOnboardingFixtureFiles, { name: { value: "writeOnboardingFixtureFiles", configurable: true }, length: { value: 1, configurable: true } });
export const writeSdkIntegrationFixtures = function writeSdkIntegrationFixtures(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().writeSdkIntegrationFixtures, this, [a0, ...args]); } as unknown as typeof Runtime.writeSdkIntegrationFixtures;
Object.defineProperties(writeSdkIntegrationFixtures, { name: { value: "writeSdkIntegrationFixtures", configurable: true }, length: { value: 1, configurable: true } });
