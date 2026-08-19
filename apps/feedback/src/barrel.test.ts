// Sol-guided coverage — Priority 5: barrel smoke test.
//
// Every public export named in src/index.ts must resolve to a defined value;
// a renamed or broken re-export fails this test at import time and at
// assertion time. The two-sided control: an export name that does NOT exist in
// the barrel is asserted to be absent, so the probe can fail in both
// directions.
import { describe, expect, test } from "bun:test";
import * as feedback from "./index.js";

const EXPECTED_EXPORTS = [
  "createFeedbackHandler",
  "FeedbackClient",
  "createFeedbackClient",
  "collectBrowserFeedbackContext",
  "FeedbackStoreBase",
  "FeedbackStoreBusyError",
  "LocalFeedbackStore",
  "SqliteFeedbackStore",
  "applyFeedbackFilter",
  "buildFeedbackSearchHaystack",
  "computeFeedbackStats",
  "createFeedbackStore",
  "describeFeedbackStoreRuntime",
  "migrateJsonlIntoSqlite",
  "resolveFeedbackDataDir",
  "resolveFeedbackFilePath",
  "resolveFeedbackMigrationSource",
  "resolveFeedbackSqlitePath",
  "serialiseFeedbackJsonl",
  "FEEDBACK_EVENT_CONTRACT_SCHEMA",
  "FEEDBACK_EVENT_SOURCE",
  "FEEDBACK_EVENT_TYPES",
  "buildFeedbackCreatedEvent",
  "buildFeedbackTriagedEvent",
  "createDefaultFeedbackEventSink",
  "emitFeedbackEvent",
  "feedbackInputSchema",
  "feedbackItemSchema",
  "feedbackKinds",
  "feedbackSeverities",
  "feedbackStatusSchema",
  "feedbackStatuses",
  "parseFeedbackInput",
  "parseFeedbackStatus",
  "parseStoredFeedbackItem",
  "redactSecretsInText",
  "redactSensitiveJson",
  "VERSION",
];

describe("feedback barrel exports", () => {
  test("every public export resolves to a defined value", () => {
    for (const name of EXPECTED_EXPORTS) {
      expect(name in feedback, `missing barrel export: ${name}`).toBe(true);
      expect((feedback as unknown as Record<string, unknown>)[name]).toBeDefined();
    }
  });

  test("the probe discriminates: a name the barrel never exports is absent", () => {
    expect("createFeedbackHandler".length).toBeGreaterThan(0);
    expect("notARealExport" in feedback).toBe(false);
  });
});
