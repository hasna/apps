import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

interface EvidenceReference {
  reference: string;
  summary: string;
}

interface PositiveControl {
  name: string;
  command: string;
  exitStatus: number;
  artifactReference: string;
}

interface MachineEvidence {
  machine?: string;
  commitSha?: string;
  command?: string;
  exitStatus?: number;
  timestamp?: string;
  artifactReference?: string;
  positiveControls?: PositiveControl[];
}

interface LedgerItem {
  key: string;
  title: string;
  todosTaskId?: string;
  status?: "pending" | "in_progress" | "blocked" | "done";
  dependsOn: string[];
  blockers: Array<{ key: string; reason: string }>;
  evidence?: {
    implementation?: EvidenceReference[];
    tests?: EvidenceReference[];
    docs?: EvidenceReference[];
    machine011?: MachineEvidence;
  };
}

interface TestLedger {
  $schema: string;
  schemaVersion: number;
  roadmap: string;
  closurePolicy: {
    umbrellaKey: string;
    workstreamKeys: string[];
    requiredEvidence: string[];
    machineValidation: {
      machine: string;
      minimumPositiveControls: number;
    };
  };
  items: LedgerItem[];
}

interface ValidationOutput {
  valid: boolean;
  mode: "consistency" | "require-complete";
  summary: {
    expectedItemCount: number;
    actualItemCount: number;
    readyWorkstreams: number;
    totalWorkstreams: number;
    umbrellaDone: boolean;
    closureReady: boolean;
  };
  errors: string[];
  crossPlanBlockers: Array<{
    item: string;
    unreadyDependencies: string[];
    declaredBlockers: Array<{ key: string; reason: string }>;
  }>;
  evidenceGaps: Array<{ item: string; missing: string[] }>;
}

interface ValidatorRun {
  exitCode: number;
  stderr: string;
  output: ValidationOutput;
}

const repositoryRoot = resolve(import.meta.dir, "..");
const ledgerPath = join(repositoryRoot, "ops", "hardening-roadmap.json");
const validatorPath = join(repositoryRoot, "scripts", "validate-hardening-ledger.ts");
const fixtureRoot = mkdtempSync(join(tmpdir(), "snapshots-hardening-ledger-"));
const sourceLedger = JSON.parse(readFileSync(ledgerPath, "utf8")) as TestLedger;
function resolveCommit(revision: string): string {
  const result = Bun.spawnSync({
    cmd: ["git", "-C", repositoryRoot, "rev-parse", revision],
    stdout: "pipe",
    stderr: "pipe"
  });
  const commit = new TextDecoder().decode(result.stdout).trim();
  if (result.exitCode !== 0 || !/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error("Unable to resolve " + revision + " for hardening-ledger fixtures");
  }
  return commit;
}
const repositoryCommit = resolveCommit("HEAD");
const gitPrefix = (() => {
  const result = Bun.spawnSync({
    cmd: ["git", "-C", repositoryRoot, "rev-parse", "--show-prefix"],
    stdout: "pipe",
    stderr: "pipe"
  });
  return new TextDecoder().decode(result.stdout).trim();
})();
const repositoryParentCommit = resolveCommit("HEAD^");
let fixtureSequence = 0;

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

function getItem(ledger: TestLedger, key: string): LedgerItem {
  const item = ledger.items.find((candidate) => candidate.key === key);
  if (!item) throw new Error("Missing fixture item " + key);
  return item;
}

function completeEvidence(key: string): NonNullable<LedgerItem["evidence"]> {
  return {
    implementation: [
      {
        reference: "git:" + repositoryCommit + ":" + gitPrefix + "src/index.ts",
        summary: "Pinned implementation evidence for " + key
      }
    ],
    tests: [
      {
        reference: "git:" + repositoryCommit + ":" + gitPrefix + "tests/storage.test.ts",
        summary: "Pinned test evidence for " + key
      }
    ],
    docs: [
      {
        reference: "git:" + repositoryCommit + ":" + gitPrefix + "README.md",
        summary: "Pinned documentation evidence for " + key
      }
    ],
    machine011: {
      machine: "machine011",
      commitSha: repositoryCommit,
      command: "bun run check",
      exitStatus: 0,
      timestamp: "2026-08-01T00:00:00Z",
      artifactReference: "git:" + repositoryCommit + ":" + gitPrefix + "package.json",
      positiveControls: [
        {
          name: "closure-positive-control-" + key,
          command: "bun run validate:hardening",
          exitStatus: 0,
          artifactReference: "git:" + repositoryCommit + ":" + gitPrefix + "bun.lock"
        }
      ]
    }
  };
}

function fixture(name: string, mutate: (ledger: TestLedger) => void): string {
  const ledger = structuredClone(sourceLedger);
  mutate(ledger);
  fixtureSequence += 1;
  const path = join(fixtureRoot, String(fixtureSequence).padStart(2, "0") + "-" + name + ".json");
  writeFileSync(path, JSON.stringify(ledger, null, 2) + "\n");
  return path;
}

function completeWorkstream(ledger: TestLedger, key: string): LedgerItem {
  const item = getItem(ledger, key);
  item.status = "done";
  item.blockers = [];
  item.evidence = completeEvidence(key);
  return item;
}

function completeLedger(ledger: TestLedger): void {
  for (const item of ledger.items) {
    item.status = "done";
    item.blockers = [];
    if (item.key !== ledger.closurePolicy.umbrellaKey) item.evidence = completeEvidence(item.key);
  }
}

function runValidator(path: string, requireComplete = false): ValidatorRun {
  const command = [process.execPath, validatorPath, "--ledger", path];
  if (requireComplete) command.push("--require-complete");
  const result = Bun.spawnSync({
    cmd: command,
    cwd: repositoryRoot,
    stdout: "pipe",
    stderr: "pipe"
  });
  const stdout = new TextDecoder().decode(result.stdout);
  const stderr = new TextDecoder().decode(result.stderr);
  let output: ValidationOutput;
  try {
    output = JSON.parse(stdout) as ValidationOutput;
  } catch (error) {
    throw new Error("Validator emitted invalid JSON. stdout=" + stdout + " stderr=" + stderr, { cause: error });
  }
  return { exitCode: result.exitCode, stderr, output };
}

describe("hardening roadmap ledger CLI", () => {
  test("enforces the exact 17-item scope and full umbrella dependency closure", () => {
    const current = runValidator(ledgerPath);
    const expectedKeys = ["SNA-umbrella", ...sourceLedger.closurePolicy.workstreamKeys];
    const umbrella = getItem(sourceLedger, sourceLedger.closurePolicy.umbrellaKey);

    expect(current.exitCode).toBe(0);
    expect(current.output.summary.expectedItemCount).toBe(17);
    expect(current.output.summary.actualItemCount).toBe(17);
    expect(sourceLedger.items.map((item) => item.key)).toEqual(expectedKeys);
    expect(new Set(sourceLedger.items.map((item) => item.key)).size).toBe(17);
    expect(umbrella.dependsOn).toEqual(sourceLedger.closurePolicy.workstreamKeys);

    const shortLedger = fixture("short-scope", (ledger) => {
      ledger.items = ledger.items.filter((item) => item.key !== "SNA-00016");
    });
    const shortResult = runValidator(shortLedger);
    expect(shortResult.exitCode).toBe(1);
    expect(shortResult.output.valid).toBe(false);
    expect(shortResult.output.errors.join("\n")).toContain("$.items must contain at least 17 item(s)");

    const partialUmbrella = fixture("partial-umbrella", (ledger) => {
      getItem(ledger, "SNA-umbrella").dependsOn = ledger.closurePolicy.workstreamKeys.slice(0, -1);
    });
    const partialResult = runValidator(partialUmbrella);
    expect(partialResult.exitCode).toBe(1);
    expect(partialResult.output.errors).toContain("umbrella must depend on every canonical workstream in order and no others");
  });

  test("cannot replace the canonical schema or shrink the canonical closure policy", () => {
    const path = fixture("alternate-schema-empty-policy", (ledger) => {
      ledger.$schema = "../ops/hardening-roadmap.json";
      ledger.closurePolicy.workstreamKeys = [];
      ledger.items = [{
        key: "SNA-umbrella",
        title: "Bypass candidate",
        status: "done",
        dependsOn: [],
        blockers: []
      }];
    });
    const result = runValidator(path, true);

    expect(result.exitCode).toBe(1);
    expect(result.output.valid).toBe(false);
    expect(result.output.summary.expectedItemCount).toBe(17);
    expect(result.output.summary.totalWorkstreams).toBe(16);
    expect(result.output.summary.closureReady).toBe(false);
    expect(result.output.errors.join("\n")).toContain("$.$schema must equal \"./hardening-roadmap.schema.json\"");
  });

  test("accepts current consistency while require-complete truthfully blocks", () => {
    const consistency = runValidator(ledgerPath);
    const closure = runValidator(ledgerPath, true);

    expect(consistency.exitCode).toBe(0);
    expect(consistency.output.valid).toBe(true);
    expect(consistency.output.summary.closureReady).toBe(false);
    expect(closure.exitCode).toBe(1);
    expect(closure.output.valid).toBe(true);
    expect(closure.output.summary.readyWorkstreams).toBe(0);
    expect(closure.output.summary.closureReady).toBe(false);
    expect(closure.output.evidenceGaps).toHaveLength(16);
  });

  const missingEvidenceCases: Array<{
    name: string;
    expectedGap: string;
    remove: (item: LedgerItem) => void;
  }> = [
    {
      name: "implementation",
      expectedGap: "evidence:implementation",
      remove: (item) => {
        delete item.evidence?.implementation;
      }
    },
    {
      name: "tests",
      expectedGap: "evidence:tests",
      remove: (item) => {
        delete item.evidence?.tests;
      }
    },
    {
      name: "docs",
      expectedGap: "evidence:docs",
      remove: (item) => {
        delete item.evidence?.docs;
      }
    },
    {
      name: "machine011",
      expectedGap: "evidence:machine011",
      remove: (item) => {
        delete item.evidence?.machine011;
      }
    }
  ];

  for (const testCase of missingEvidenceCases) {
    test("rejects a done workstream missing " + testCase.name + " evidence", () => {
      const path = fixture("missing-" + testCase.name, (ledger) => {
        testCase.remove(completeWorkstream(ledger, "SNA-00001"));
      });
      const result = runValidator(path);
      const gap = result.output.evidenceGaps.find((entry) => entry.item === "SNA-00001");

      expect(result.exitCode).toBe(1);
      expect(result.output.valid).toBe(false);
      expect(result.output.errors.join("\n")).toContain("SNA-00001 claims done without required evidence");
      expect(gap?.missing).toContain(testCase.expectedGap);
    });
  }

  const invalidMachineCases: Array<{
    name: string;
    expectedError: string;
    mutate: (evidence: MachineEvidence) => void;
  }> = [
    {
      name: "wrong machine",
      expectedError: "machine must equal \"machine011\"",
      mutate: (evidence) => {
        evidence.machine = "machine010";
      }
    },
    {
      name: "bad commit SHA",
      expectedError: "commitSha must match ^[0-9a-f]{40}$",
      mutate: (evidence) => {
        evidence.commitSha = "abc123";
      }
    },
    {
      name: "missing commit SHA",
      expectedError: "commitSha is required",
      mutate: (evidence) => {
        delete evidence.commitSha;
      }
    },
    {
      name: "nonzero exit",
      expectedError: "exitStatus must equal 0",
      mutate: (evidence) => {
        evidence.exitStatus = 1;
      }
    },
    {
      name: "missing artifact reference",
      expectedError: "artifactReference is required",
      mutate: (evidence) => {
        delete evidence.artifactReference;
      }
    },
    {
      name: "missing timestamp",
      expectedError: "timestamp is required",
      mutate: (evidence) => {
        delete evidence.timestamp;
      }
    },
    {
      name: "missing positive control",
      expectedError: "positiveControls must contain at least 1 item(s)",
      mutate: (evidence) => {
        evidence.positiveControls = [];
      }
    }
  ];

  for (const testCase of invalidMachineCases) {
    test("rejects machine011 evidence with " + testCase.name, () => {
      const path = fixture("machine-" + testCase.name.replaceAll(" ", "-"), (ledger) => {
        const item = completeWorkstream(ledger, "SNA-00001");
        testCase.mutate(item.evidence?.machine011 ?? {});
      });
      const result = runValidator(path);

      expect(result.exitCode).toBe(1);
      expect(result.output.valid).toBe(false);
      expect(result.output.summary.closureReady).toBe(false);
      expect(result.output.errors.join("\n")).toContain(testCase.expectedError);
    });
  }

  test("rejects placeholder evidence descriptions", () => {
    const path = fixture("placeholder-evidence", (ledger) => {
      const item = completeWorkstream(ledger, "SNA-00001");
      item.evidence!.implementation![0].summary = "placeholder evidence";
    });
    const result = runValidator(path);

    expect(result.exitCode).toBe(1);
    expect(result.output.valid).toBe(false);
    expect(result.output.summary.closureReady).toBe(false);
    expect(result.output.errors).toContain("SNA-00001 implementation evidence[0] summary must not be placeholder evidence");
  });

  test("rejects unqualified evidence references", () => {
    const path = fixture("unqualified-evidence-reference", (ledger) => {
      const item = completeWorkstream(ledger, "SNA-00001");
      item.evidence!.implementation![0].reference = "artifact.log";
    });
    const result = runValidator(path);

    expect(result.exitCode).toBe(1);
    expect(result.output.valid).toBe(false);
    expect(result.output.errors.join("\n")).toContain("reference must match");
  });

  test("rejects a syntactically valid machine commit that is absent from the repository", () => {
    const path = fixture("nonexistent-machine-commit", (ledger) => {
      const item = completeWorkstream(ledger, "SNA-00001");
      item.evidence!.machine011!.commitSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    });
    const result = runValidator(path);

    expect(result.exitCode).toBe(1);
    expect(result.output.valid).toBe(false);
    expect(result.output.errors.join("\n")).toContain("machine011 commitSha must resolve to a commit in this repository");
  });

  test("rejects future machine validation timestamps", () => {
    const path = fixture("future-machine-timestamp", (ledger) => {
      const item = completeWorkstream(ledger, "SNA-00001");
      item.evidence!.machine011!.timestamp = "2999-01-01T00:00:00Z";
    });
    const result = runValidator(path);

    expect(result.exitCode).toBe(1);
    expect(result.output.valid).toBe(false);
    expect(result.output.errors).toContain("SNA-00001 machine011 timestamp must not be in the future");
    expect(result.output.summary.readyWorkstreams).toBe(0);
    for (const key of ["SNA-umbrella", "SNA-00007", "SNA-00013", "SNA-00016"]) {
      const blocker = result.output.crossPlanBlockers.find((entry) => entry.item === key);
      expect(blocker?.unreadyDependencies).toContain("SNA-00001");
    }
  });

  test("rejects calendar-invalid machine validation timestamps", () => {
    const path = fixture("invalid-machine-timestamp", (ledger) => {
      const item = completeWorkstream(ledger, "SNA-00001");
      item.evidence!.machine011!.timestamp = "2026-02-30T00:00:00Z";
    });
    const result = runValidator(path);

    expect(result.exitCode).toBe(1);
    expect(result.output.valid).toBe(false);
    expect(result.output.errors.join("\n")).toContain("timestamp must use date-time format");
  });

  test("rejects malformed durable artifact references", () => {
    const path = fixture("malformed-artifact-reference", (ledger) => {
      const item = completeWorkstream(ledger, "SNA-00001");
      item.evidence!.machine011!.artifactReference = "git:" + repositoryCommit + ":../outside.log";
    });
    const result = runValidator(path);

    expect(result.exitCode).toBe(1);
    expect(result.output.valid).toBe(false);
    expect(result.output.errors).toContain("SNA-00001 machine011 artifactReference must use a repository-relative path without traversal");
  });

  test("requires positive-control artifacts to be unique and bound to the tested commit", () => {
    const path = fixture("unbound-duplicate-positive-controls", (ledger) => {
      const item = completeWorkstream(ledger, "SNA-00001");
      const machine = item.evidence!.machine011!;
      machine.positiveControls = [
        machine.positiveControls![0],
        {
          ...machine.positiveControls![0],
          name: "second-positive-control"
        }
      ];
    });
    const result = runValidator(path);

    expect(result.exitCode).toBe(1);
    expect(result.output.valid).toBe(false);
    expect(result.output.errors).toContain("SNA-00001 has duplicate machine011 positive-control commands");
    expect(result.output.errors).toContain("SNA-00001 has duplicate machine011 positive-control artifacts");
  });

  test("rejects a resolvable artifact pinned to a commit other than the tested commit", () => {
    const path = fixture("artifact-wrong-commit", (ledger) => {
      const item = completeWorkstream(ledger, "SNA-00001");
      item.evidence!.machine011!.artifactReference = "git:" + repositoryParentCommit + ":" + gitPrefix + "package.json";
    });
    const result = runValidator(path);

    expect(result.exitCode).toBe(1);
    expect(result.output.valid).toBe(false);
    expect(result.output.errors).toContain("SNA-00001 machine011 artifactReference must bind to machine011 commitSha");
  });

  test("declared blockers prevent a done workstream", () => {
    const path = fixture("declared-workstream-blocker", (ledger) => {
      const item = completeWorkstream(ledger, "SNA-00002");
      item.blockers = [{ key: "SNA-00001", reason: "explicit cross-plan blocker" }];
    });
    const result = runValidator(path);
    const blocker = result.output.crossPlanBlockers.find((entry) => entry.item === "SNA-00002");

    expect(result.exitCode).toBe(1);
    expect(result.output.valid).toBe(false);
    expect(result.output.errors).toContain("SNA-00002 claims done while cross-plan blockers remain");
    expect(blocker?.declaredBlockers).toEqual([
      { key: "SNA-00001", reason: "explicit cross-plan blocker" }
    ]);
  });

  test("derived dependency blockers prevent a done workstream", () => {
    const path = fixture("derived-workstream-blocker", (ledger) => {
      completeWorkstream(ledger, "SNA-00007");
    });
    const result = runValidator(path);
    const blocker = result.output.crossPlanBlockers.find((entry) => entry.item === "SNA-00007");

    expect(result.exitCode).toBe(1);
    expect(result.output.valid).toBe(false);
    expect(result.output.errors).toContain("SNA-00007 claims done while cross-plan blockers remain");
    expect(blocker?.unreadyDependencies).toEqual(["SNA-00001"]);
  });

  test("declared umbrella blockers prevent otherwise complete closure", () => {
    const path = fixture("declared-umbrella-blocker", (ledger) => {
      completeLedger(ledger);
      getItem(ledger, "SNA-umbrella").blockers = [
        { key: "SNA-00001", reason: "explicit umbrella blocker" }
      ];
    });
    const result = runValidator(path, true);

    expect(result.exitCode).toBe(1);
    expect(result.output.valid).toBe(false);
    expect(result.output.summary.readyWorkstreams).toBe(16);
    expect(result.output.summary.closureReady).toBe(false);
    expect(result.output.errors).toContain("umbrella cannot be done while declared blockers remain");
  });

  for (const kind of ["dependency", "blocker"] as const) {
    test("rejects an unknown " + kind + " reference", () => {
      const path = fixture("unknown-" + kind, (ledger) => {
        const item = getItem(ledger, "SNA-00002");
        if (kind === "dependency") {
          item.dependsOn = ["SNA-99999"];
        } else {
          item.blockers = [{ key: "SNA-99999", reason: "unknown negative control" }];
        }
      });
      const result = runValidator(path);

      expect(result.exitCode).toBe(1);
      expect(result.output.valid).toBe(false);
      expect(result.output.errors).toContain("SNA-00002 references unknown dependency/blocker SNA-99999");
    });
  }

  test("rejects dependency cycles without recursing indefinitely", () => {
    const path = fixture("dependency-cycle", (ledger) => {
      getItem(ledger, "SNA-00001").dependsOn = ["SNA-00007"];
    });
    const result = runValidator(path);

    expect(result.exitCode).toBe(1);
    expect(result.output.valid).toBe(false);
    expect(result.output.errors).toContain("dependency/blocker cycle: SNA-00001 -> SNA-00007 -> SNA-00001");
  });

  test("accepts a fully evidenced acyclic 16-workstream closure", () => {
    const path = fixture("complete-positive-control", completeLedger);
    const result = runValidator(path, true);

    expect(result.exitCode).toBe(0);
    expect(result.output.valid).toBe(true);
    expect(result.output.mode).toBe("require-complete");
    expect(result.output.summary.readyWorkstreams).toBe(16);
    expect(result.output.summary.totalWorkstreams).toBe(16);
    expect(result.output.summary.umbrellaDone).toBe(true);
    expect(result.output.summary.closureReady).toBe(true);
    expect(result.output.errors).toEqual([]);
    expect(result.output.crossPlanBlockers).toEqual([]);
    expect(result.output.evidenceGaps).toEqual([]);
  });
});
