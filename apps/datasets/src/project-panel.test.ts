import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ProjectPanelSchema, SCHEMA_IDS } from "@hasna/contracts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatasetsProjectPanel } from "./project-panel.js";
import { DATASETS_DB_PATH_ENV, DATASETS_HOME_ENV, ingestDataset } from "./storage.js";

const ENV_KEYS = [DATASETS_HOME_ENV, DATASETS_DB_PATH_ENV] as const;
const savedEnv = new Map<string, string | undefined>();
let testDir: string | undefined;

for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "datasets-panel-"));
  process.env[DATASETS_HOME_ENV] = testDir;
  process.env[DATASETS_DB_PATH_ENV] = join(testDir, "datasets.db");
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (testDir) rmSync(testDir, { recursive: true, force: true });
  testDir = undefined;
});

describe("createDatasetsProjectPanel", () => {
  test("emits a contract-valid custom project panel", () => {
    ingestDataset({
      name: "Bank shortlist",
      projectId: "swiss-bank-account",
      rows: [
        { bank: "Mirabaud", status: "research" },
        { bank: "UBS", status: "research" },
      ],
    });

    const panel = createDatasetsProjectPanel("Swiss Bank Account", { limit: 5 });
    const parsed = ProjectPanelSchema.safeParse(panel);

    expect(parsed.success).toBe(true);
    expect(panel.schema).toBe(SCHEMA_IDS.projectPanel);
    expect(panel.projectId).toBe("swiss-bank-account");
    expect(panel.provider.kind).toBe("custom");
    expect(panel.kind).toBe("custom");
    expect(panel.title).toBe("Datasets");
    expect(panel.state).toBe("ready");
    expect(panel.metrics.find((metric) => metric.id === "datasets")?.value).toBe(1);
    expect(panel.metrics.find((metric) => metric.id === "rows")?.value).toBe(2);
    expect(panel.items[0]?.resourceRefs[0]?.uri).toStartWith("artifact://datasets/");
    expect(panel.renderFragment?.spec).toMatchObject({ component: "project.datasets.summary" });
  });

  test("emits an empty state for projects without datasets", () => {
    const panel = createDatasetsProjectPanel("Swiss Bank Account");

    expect(ProjectPanelSchema.safeParse(panel).success).toBe(true);
    expect(panel.projectId).toBe("swiss-bank-account");
    expect(panel.state).toBe("empty");
    expect(panel.summary).toContain("No project datasets");
  });

  test("warns about sensitive datasets and marks their items high priority", () => {
    ingestDataset({
      name: "Sensitive Records",
      projectId: "swiss-bank-account",
      classification: "sensitive",
      rows: [{ id: "s1" }],
    });

    const panel = createDatasetsProjectPanel("Swiss Bank Account");

    expect(panel.warnings).toEqual([
      "One or more datasets are marked sensitive; previews must stay redacted and bounded.",
    ]);
    expect(panel.items[0]?.priority).toBe("high");
  });

  test("clamps a zero item limit up to one", () => {
    ingestDataset({
      name: "One",
      projectId: "swiss-bank-account",
      rows: [{ id: "1" }],
    });

    const panel = createDatasetsProjectPanel("Swiss Bank Account", { limit: 0 });

    expect(panel.items).toHaveLength(1);
  });

  test("reports freshness unknown without versions and fresh once a dataset has one", () => {
    expect(createDatasetsProjectPanel("No Data").freshness).toBe("unknown");

    ingestDataset({
      name: "One",
      projectId: "swiss-bank-account",
      rows: [{ id: "1" }],
    });

    expect(createDatasetsProjectPanel("Swiss Bank Account").freshness).toBe("fresh");
  });

  test("uses singular wording for exactly one dataset with one row", () => {
    ingestDataset({
      name: "One",
      projectId: "swiss-bank-account",
      rows: [{ id: "1" }],
    });

    const panel = createDatasetsProjectPanel("Swiss Bank Account");

    expect(panel.summary).toBe("1 dataset with 1 row.");
  });
});
