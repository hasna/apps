/**
 * Fleet client-API-key provisioning + drift detection (hasna/apps#1595).
 *
 * The defect: nothing provisioned `hasna/oss/<app>/api-key`, so a service could
 * deploy, route and answer /health while no station could call it (messages),
 * and a Secrets Manager copy could hold a value the origin had already REVOKED
 * (projects, knowledge) with nothing noticing. This suite pins the two things
 * that make the new check trustworthy: the registry describes the real fleet,
 * and the probe classification cannot report a dead key as healthy.
 *
 * Every rule is tested two-sided — the pass case AND the fail case — because a
 * key check that cannot fail is worse than no key check at all: it is believed.
 */
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  FAILING_STATES,
  KEY_PROBE_PATH,
  REGISTRY_PATH,
  assessKey,
  classifyProbe,
  checkApp,
  defaultBaseUrlFor,
  keySecretIdFor,
  loadRegistry,
  mintTargetFrom,
  missingMintTargetMessage,
  parseRegistry,
  partition,
  probeUrlFor,
  renderIncidentReport,
  repoRoot,
  resolveEntry,
  runMintTask,
  type FleetApp,
  type Io,
  type KeyAssessment,
} from "../../../fleet/key-provisioning.ts";

const ROOT = repoRoot();

function entry(overrides: Record<string, unknown> = {}) {
  return { app: "widgets", source: "monorepo" as const, ...overrides };
}

describe("registry: the written inventory of hosted apps", () => {
  const registry = loadRegistry(ROOT);

  test("the registry file exists at the documented path and resolves", () => {
    expect(fs.existsSync(path.join(ROOT, REGISTRY_PATH))).toBe(true);
    expect(registry.length).toBeGreaterThan(20);
  });

  test("every monorepo entry names a real apps/<app> member", () => {
    const missing = registry
      .filter((a) => a.source === "monorepo")
      .filter((a) => !fs.existsSync(path.join(ROOT, "apps", a.app, "package.json")))
      .map((a) => a.app);
    expect(missing).toEqual([]);
  });

  test("messages — the app the issue was filed for — is registered", () => {
    const messages = registry.find((a) => a.app === "messages");
    expect(messages).toBeDefined();
    expect(messages!.keySecretId).toBe("hasna/oss/messages/api-key");
  });

  test("defaults are applied, and only exceptions are written down", () => {
    const calendar = registry.find((a) => a.app === "calendar")!;
    expect(calendar.baseUrl).toBe(defaultBaseUrlFor("calendar"));
    expect(calendar.probePath).toBe(KEY_PROBE_PATH);
    expect(calendar.keyCheck).toBe("probe");
    // todos is pinned to its origin hostname until hasna/apps#1512.
    expect(registry.find((a) => a.app === "todos")!.baseUrl).toBe("https://todos.hasna.xyz");
  });

  test("every key secret sits in the hasna/oss/<app>/api-key namespace", () => {
    for (const app of registry) expect(app.keySecretId).toBe(keySecretIdFor(app.app));
  });

  test("every probe path is absolute and every base URL is https", () => {
    for (const app of registry) {
      expect(app.probePath.startsWith("/")).toBe(true);
      expect(app.baseUrl.startsWith("https://")).toBe(true);
      expect(app.baseUrl.endsWith("/")).toBe(false);
    }
  });
});

describe("registry validation refuses the shapes that would make the check lie", () => {
  test("an invalid slug, source, base URL or probe path is refused", () => {
    expect(() => resolveEntry(entry({ app: "Widgets" }) as never)).toThrow(/invalid app slug/);
    expect(() => resolveEntry(entry({ source: "elsewhere" }) as never)).toThrow(/source must be/);
    expect(() => resolveEntry(entry({ baseUrl: "http://widgets.example" }) as never)).toThrow(/must be https/);
    expect(() => resolveEntry(entry({ probePath: "v1/x" }) as never)).toThrow(/must start with/);
    // Two-sided control: the clean entry resolves.
    expect(resolveEntry(entry() as never).app).toBe("widgets");
  });

  test("an external app must say where it is built", () => {
    expect(() => resolveEntry(entry({ source: "external" }) as never)).toThrow(/must carry "notes"/);
    expect(resolveEntry(entry({ source: "external", notes: "internal-apps" }) as never).source).toBe("external");
  });

  test("a probe exemption must be documented, and cannot also configure a probe", () => {
    expect(() => resolveEntry(entry({ keyCheck: "none" }) as never)).toThrow(/must carry "notes"/);
    expect(() => resolveEntry(entry({ keyCheck: "none", notes: "why", probePath: "/v1/x" }) as never)).toThrow(
      /cannot also set probePath/,
    );
    expect(resolveEntry(entry({ keyCheck: "none", notes: "signature auth" }) as never).keyCheck).toBe("none");
  });

  test("duplicates and unsorted groups are refused", () => {
    const dup = JSON.stringify({
      apps: [entry({ app: "a" }), entry({ app: "a" })],
    });
    expect(() => parseRegistry(dup)).toThrow(/duplicate entry/);
    const unsorted = JSON.stringify({ apps: [entry({ app: "b" }), entry({ app: "a" })] });
    expect(() => parseRegistry(unsorted)).toThrow(/alphabetical/);
    const sorted = JSON.stringify({ apps: [entry({ app: "a" }), entry({ app: "b" })] });
    expect(parseRegistry(sorted).map((a) => a.app)).toEqual(["a", "b"]);
  });

  test("an empty registry is refused rather than reported clean", () => {
    expect(() => parseRegistry(JSON.stringify({ apps: [] }))).toThrow(/non-empty/);
  });
});

describe("probe classification — the part that must not report a dead key as healthy", () => {
  test("refused unkeyed + served keyed is the only 'authenticated' verdict", () => {
    expect(classifyProbe(401, 404)).toBe("authenticated");
    expect(classifyProbe(403, 200)).toBe("authenticated");
    expect(classifyProbe(401, 500)).toBe("authenticated");
  });

  test("refused with the key means the key is dead — the projects/knowledge failure", () => {
    expect(classifyProbe(401, 401)).toBe("rejected");
    expect(classifyProbe(401, 403)).toBe("rejected");
    expect(classifyProbe(403, 401)).toBe("rejected");
  });

  test("a service that does not refuse an UNKEYED call is 'ungated', never 'authenticated'", () => {
    // This is the control that stops a false green: without it, a service that
    // 404s every unknown path would make any string look like a working key.
    expect(classifyProbe(404, 404)).toBe("ungated");
    expect(classifyProbe(200, 200)).toBe("ungated");
    expect(classifyProbe(404, 401)).toBe("ungated");
  });

  test("an incomplete probe concludes nothing", () => {
    expect(classifyProbe(null, 404)).toBe("unreachable");
    expect(classifyProbe(401, null)).toBe("unreachable");
    expect(classifyProbe(null, null)).toBe("unreachable");
  });
});

describe("assessment and partitioning", () => {
  test("an absent secret is 'missing' whatever the probe said — the messages failure", () => {
    for (const verdict of ["authenticated", "rejected", "ungated", "unreachable"] as const) {
      expect(assessKey({ app: "messages", secretPresent: false, verdict }).state).toBe("missing");
    }
  });

  test("verdicts map onto the states that drive action", () => {
    expect(assessKey({ app: "a", secretPresent: true, verdict: "authenticated" }).state).toBe("verified");
    expect(assessKey({ app: "a", secretPresent: true, verdict: "rejected" }).state).toBe("rejected");
    expect(assessKey({ app: "a", secretPresent: true, verdict: "ungated" }).state).toBe("unverifiable");
    expect(assessKey({ app: "a", secretPresent: true, verdict: "unreachable" }).state).toBe("unverifiable");
  });

  test("a documented exemption still requires the key to exist", () => {
    expect(assessKey({ app: "hooks", secretPresent: true, verdict: "unreachable", keyCheck: "none" }).state).toBe(
      "exempt",
    );
    expect(assessKey({ app: "hooks", secretPresent: false, verdict: "unreachable", keyCheck: "none" }).state).toBe(
      "missing",
    );
  });

  test("missing and rejected fail; unverifiable warns, and --strict promotes it", () => {
    const assessments: KeyAssessment[] = [
      { app: "gone", state: "missing", detail: "" },
      { app: "dead", state: "rejected", detail: "" },
      { app: "flaky", state: "unverifiable", detail: "" },
      { app: "good", state: "verified", detail: "" },
      { app: "hooks", state: "exempt", detail: "" },
    ];
    const lenient = partition(assessments);
    expect(lenient.failures.map((a) => a.app)).toEqual(["gone", "dead"]);
    expect(lenient.warnings.map((a) => a.app)).toEqual(["flaky"]);
    expect(lenient.passes.map((a) => a.app)).toEqual(["good"]);
    expect(lenient.exempt.map((a) => a.app)).toEqual(["hooks"]);

    const strict = partition(assessments, { strict: true });
    expect(strict.failures.map((a) => a.app)).toEqual(["gone", "dead", "flaky"]);
    expect(strict.warnings).toEqual([]);

    expect([...FAILING_STATES]).toEqual(["missing", "rejected"]);
  });

  test("no assessment detail can carry a key value — they are built from app names and statuses", () => {
    const detail = assessKey({
      app: "messages",
      secretPresent: true,
      verdict: "rejected",
      statuses: { withoutKey: 401, withKey: 401 },
    }).detail;
    expect(detail).toContain("hasna/oss/messages/api-key");
    expect(detail).toContain("401");
    expect(detail).not.toMatch(/hasna_[a-z]+_/);
  });
});

describe("the #incidents report", () => {
  test("names every finding, counts every bucket, and ends with a remedy", () => {
    const report = renderIncidentReport({
      failures: [{ app: "messages", state: "missing", detail: "no secret" }],
      warnings: [{ app: "loops", state: "unverifiable", detail: "no answer" }],
      passes: [{ app: "todos", state: "verified", detail: "ok" }],
      exempt: [{ app: "hooks", state: "exempt", detail: "signature auth" }],
      runUrl: "https://github.com/hasna/apps/actions/runs/1",
    });
    expect(report).toContain("1 failing");
    expect(report).toContain("1 unverified");
    expect(report).toContain("1 healthy");
    expect(report).toContain("1 exempt");
    expect(report).toContain("FAIL messages: no secret");
    expect(report).toContain("WARN loops: no answer");
    expect(report).toContain("EXEMPT hooks: signature auth");
    expect(report).toContain("hasna/apps#1595");
    expect(report).toContain("https://github.com/hasna/apps/actions/runs/1");
  });

  test("a clean run still renders a report (the workflow only posts on failure)", () => {
    const report = renderIncidentReport({ failures: [], warnings: [], passes: [], exempt: [] });
    expect(report).toContain("0 failing");
  });
});

describe("checkApp drives the probe two-sidedly", () => {
  const app: FleetApp = {
    app: "messages",
    source: "monorepo",
    baseUrl: "https://api.hasna.com/messages",
    keySecretId: "hasna/oss/messages/api-key",
    probePath: KEY_PROBE_PATH,
    keyCheck: "probe",
  };

  function io(overrides: Partial<Io>): Io {
    return {
      readSecret: async () => "hasna_messages_body.sig",
      probe: async () => 404,
      aws: async () => "",
      ...overrides,
    };
  }

  test("a missing secret short-circuits: no request is made at all", async () => {
    let probed = 0;
    const result = await checkApp(
      app,
      io({
        readSecret: async () => null,
        probe: async () => {
          probed += 1;
          return 404;
        },
      }),
      "us-east-1",
    );
    expect(result.state).toBe("missing");
    expect(probed).toBe(0);
  });

  test("the unkeyed call really is unkeyed, and the keyed call really carries the key", async () => {
    const seen: Array<{ url: string; keyed: boolean }> = [];
    const result = await checkApp(
      app,
      io({
        probe: async (url, key) => {
          seen.push({ url, keyed: key !== null });
          return key === null ? 401 : 404;
        },
      }),
      "us-east-1",
    );
    expect(result.state).toBe("verified");
    expect(seen).toEqual([
      { url: probeUrlFor(app.baseUrl, app.probePath), keyed: false },
      { url: probeUrlFor(app.baseUrl, app.probePath), keyed: true },
    ]);
  });

  test("a revoked key at the origin is reported as rejected even though the secret exists", async () => {
    const result = await checkApp(app, io({ probe: async () => 401 }), "us-east-1");
    expect(result.state).toBe("rejected");
    expect(result.detail).toContain("revoked");
  });

  test("an exempt app checks the secret and skips the probe", async () => {
    let probed = 0;
    const result = await checkApp(
      { ...app, app: "hooks", keyCheck: "none" },
      io({
        probe: async () => {
          probed += 1;
          return 404;
        },
      }),
      "us-east-1",
    );
    expect(result.state).toBe("exempt");
    expect(probed).toBe(0);
  });
});

describe("minting from the deploy lane", () => {
  test("a manifest without every mint input yields no target, and a complete one does", () => {
    const complete = {
      cluster: "oss-fleet-prod",
      mint_key_task_family: "hasna-ops-mint-key-messages",
      subnets: ["subnet-a", "subnet-b"],
      security_groups: ["sg-1"],
      assign_public_ip: "DISABLED",
    };
    expect(mintTargetFrom(complete)).toEqual({
      cluster: "oss-fleet-prod",
      taskFamily: "hasna-ops-mint-key-messages",
      subnets: ["subnet-a", "subnet-b"],
      securityGroups: ["sg-1"],
      assignPublicIp: "DISABLED",
    });
    for (const key of ["cluster", "mint_key_task_family", "subnets", "security_groups", "assign_public_ip"]) {
      const partial: Record<string, unknown> = { ...complete };
      delete partial[key];
      expect(mintTargetFrom(partial)).toBeNull();
    }
  });

  test("the 'cannot mint' message names the app, the secret and the manifest key to add", () => {
    const message = missingMintTargetMessage("messages", "/hasna/deploy/messages");
    expect(message).toContain("hasna/oss/messages/api-key");
    expect(message).toContain("mint_key_task_family");
    expect(message).toContain("/hasna/deploy/messages");
  });

  test("the mint task is started in the VPC, waited on, and its exit code returned", async () => {
    const calls: string[][] = [];
    const io: Io = {
      readSecret: async () => null,
      probe: async () => null,
      aws: async (args) => {
        calls.push([...args]);
        if (args[1] === "run-task") return "arn:aws:ecs:us-east-1:1:task/abc\n";
        if (args[1] === "describe-tasks") return "0\n";
        return "";
      },
    };
    const exit = await runMintTask(
      {
        cluster: "oss-fleet-prod",
        taskFamily: "hasna-ops-mint-key-messages",
        subnets: ["subnet-a"],
        securityGroups: ["sg-1"],
        assignPublicIp: "DISABLED",
      },
      io,
      "us-east-1",
      "fleet-key-messages",
    );
    expect(exit).toBe(0);
    expect(calls.map((c) => c.slice(0, 2))).toEqual([
      ["ecs", "run-task"],
      ["ecs", "wait"],
      ["ecs", "describe-tasks"],
    ]);
    const runTask = calls[0]!.join(" ");
    expect(runTask).toContain("subnets=[subnet-a]");
    expect(runTask).toContain("securityGroups=[sg-1]");
    expect(runTask).toContain("assignPublicIp=DISABLED");
  });

  test("a task that never starts is an error, not a silent success", async () => {
    const io: Io = {
      readSecret: async () => null,
      probe: async () => null,
      aws: async (args) => (args[1] === "run-task" ? "None\n" : ""),
    };
    await expect(
      runMintTask(
        { cluster: "c", taskFamily: "f", subnets: ["s"], securityGroups: ["g"], assignPublicIp: "DISABLED" },
        io,
        "us-east-1",
        "x",
      ),
    ).rejects.toThrow(/failed to start/);
  });

  test("a non-zero mint task exit is reported as non-zero", async () => {
    const io: Io = {
      readSecret: async () => null,
      probe: async () => null,
      aws: async (args) => {
        if (args[1] === "run-task") return "arn:task\n";
        if (args[1] === "describe-tasks") return "1\n";
        return "";
      },
    };
    const exit = await runMintTask(
      { cluster: "c", taskFamily: "f", subnets: ["s"], securityGroups: ["g"], assignPublicIp: "DISABLED" },
      io,
      "us-east-1",
      "x",
    );
    expect(exit).toBe(1);
  });
});

describe("the lanes actually call the checker", () => {
  const workflows = path.join(ROOT, ".github", "workflows");
  const read = (name: string) => fs.readFileSync(path.join(workflows, name), "utf8");

  /** Deploy lanes that must provision their key. Mirrors PORTED_DEPLOY_LANES. */
  const PORTED = ["conversations", "mementos", "projects", "skills", "todos"] as const;

  test("the reusable provisioning workflow exists and runs the checker", () => {
    const wf = read("fleet-key-provision.yml");
    expect(wf).toContain("workflow_call");
    expect(wf).toContain("tooling/fleet/fleet-key.ts provision");
    // Pinned toolchain, and the third-party action set up BEFORE credentials.
    expect(wf).toContain("bun-version: 1.3.14");
    expect(wf.indexOf("setup-bun")).toBeLessThan(wf.indexOf("configure-aws-credentials"));
  });

  test("every ported deploy lane calls it after a successful deploy", () => {
    for (const app of PORTED) {
      const wf = read(`deploy-${app}.yml`);
      expect(wf).toContain("uses: ./.github/workflows/fleet-key-provision.yml");
      expect(wf).toContain(`app: ${app}`);
      // It must run AFTER the deploy and only behind the same ci gate — a key
      // check on an ungated commit would mint against an unverified rollout.
      expect(wf).toContain("needs: [gate, deploy]");
      expect(wf).toContain("needs.gate.outputs.proceed == 'true'");
    }
  });

  test("the daily drift workflow is scheduled, self-tests, and posts to #incidents", () => {
    const wf = read("fleet-key-drift.yml");
    expect(wf).toMatch(/cron:\s*"[^"]+"/);
    expect(wf).toContain("tooling/fleet/fleet-key.ts");
    // It proves the checker can fail before it is trusted with a verdict.
    expect(wf).toContain("bun test tooling/ci/tests/standard/fleet-key-provisioning.test.ts");
    expect(wf).toContain("/v1/messages");
    expect(wf).toContain("hasna/oss/conversations/api-key");
    // It must post only when there are findings — a daily green message trains
    // people to ignore the channel.
    expect(wf).toContain("steps.check.outputs.failures != '0'");
  });

  test("no workflow echoes a secret value it reads", () => {
    for (const name of ["fleet-key-provision.yml", "fleet-key-drift.yml"]) {
      const wf = read(name);
      expect(wf).not.toMatch(/echo\s+"?\$\{?key\b/);
      expect(wf).not.toMatch(/echo\s+.*SecretString/);
    }
  });
});
