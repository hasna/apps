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
import * as os from "node:os";
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
  planMint,
  probeUrlFor,
  renderIncidentReport,
  repoRoot,
  resolveEntry,
  rotationNotice,
  rotationRefusedMessage,
  runMintTask,
  type FleetApp,
  type Io,
  type KeyAssessment,
} from "../../../fleet/key-provisioning.ts";
import { main } from "../../../fleet/fleet-key.ts";

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

  test("messages carries the note that this repo cannot finish its rollout", () => {
    // messages has NO deploy lane here, so nothing in this repository can
    // provision its key: the gate reaches production through an out-of-repo
    // deploy, and until it does the daily report names messages every day.
    // That is the check working, and the entry has to say so — otherwise the
    // first reader concludes the checker is broken and stops trusting it.
    const notes = registry.find((a) => a.app === "messages")!.notes ?? "";
    expect(notes).toContain("no deploy lane");
    expect(notes).toContain("API_KEY_SIGNING_SECRET");
    expect(notes).toContain("hasna-ops-mint-key-messages");
    expect(fs.existsSync(path.join(ROOT, ".github", "workflows", "deploy-messages.yml"))).toBe(false);
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

describe("rotation policy — what may overwrite a key every station holds", () => {
  const assessed = (state: string, app = "widgets"): KeyAssessment =>
    ({ app, state, detail: `${state} detail` }) as KeyAssessment;

  test("a missing secret is minted: there is nothing to invalidate", () => {
    expect(planMint(assessed("missing"))).toEqual({ action: "mint", cause: "missing" });
  });

  test("a REFUSED key that exists is NOT overwritten by default", () => {
    // The finding this pins: `rejected` is reached from a keyed 401 OR 403, and
    // a 403 is also what a valid key outside the probed path's scope returns
    // (loops answers 403 on the default probe path). Rotating on that reading
    // would take a live app away from every station to fix a permission that
    // was never broken.
    const plan = planMint(assessed("rejected", "loops"));
    expect(plan.action).toBe("refuse");
    expect(plan.action === "refuse" && plan.reason).toContain("--allow-rotate");
    expect(plan.action === "refuse" && plan.reason).toContain("probePath");
  });

  test("...and IS overwritten when the caller explicitly opts in", () => {
    expect(planMint(assessed("rejected"), { allowRotate: true })).toEqual({
      action: "rotate",
      cause: "rejected",
    });
  });

  test("opting in cannot resurrect the cases that prove nothing", () => {
    // --allow-rotate authorises replacing a key the origin REFUSED. It is not a
    // licence to write over a secret whose probe never completed, nor to churn
    // a key that is working.
    expect(planMint(assessed("unverifiable"), { allowRotate: true }).action).toBe("refuse");
    expect(planMint(assessed("missing"), { allowRotate: true })).toEqual({ action: "mint", cause: "missing" });
    expect(planMint(assessed("verified"), { allowRotate: true }).action).toBe("none");
    expect(planMint(assessed("exempt"), { allowRotate: true }).action).toBe("none");
  });

  test("every plan is decided for every state — no state falls through to a write", () => {
    const states = ["verified", "exempt", "missing", "rejected", "unverifiable"] as const;
    for (const state of states) {
      for (const allowRotate of [false, true]) {
        const plan = planMint(assessed(state), { allowRotate });
        expect(["none", "mint", "rotate", "refuse"]).toContain(plan.action);
      }
    }
  });

  test("a rotation notice tells stations their hand-copied key is now stale, and carries no key", () => {
    const notice = rotationNotice("widgets");
    expect(notice).toContain("hasna/oss/widgets/api-key");
    expect(notice).toContain("Keychain");
    expect(notice).toContain("hasna.credentials.widgets.api-key");
    // Instructions only: names, the secret id, and the two commands. Nothing
    // that could be mistaken for a value.
    expect(notice).not.toMatch(/hasna_[a-z]+_[A-Za-z0-9+/=]{8,}/);
  });

  test("the refusal message says what to decide, not just that it refused", () => {
    const message = rotationRefusedMessage("widgets");
    expect(message).toContain("hasna/oss/widgets/api-key");
    expect(message).toContain("hasna-ops-mint-key-widgets");
    expect(message).toContain("hosted-apps.json");
  });
});

describe("provision, end to end, with the real command path", () => {
  /**
   * A scripted {@link Io}: one secret, a queue of two-sided probe readings (one
   * pair per assessment), and a recorder for every `aws` invocation. What the
   * tests below actually assert is what is NOT in that recorder — a command
   * that never ran cannot have overwritten a key.
   */
  function scriptedIo(script: { secret: string | null; probes: [number | null, number | null][] }) {
    const awsCalls: string[][] = [];
    const probes = [...script.probes];
    let pair: [number | null, number | null] | undefined;
    let half = 0;
    let minted = false;
    const io: Io = {
      // After a successful mint the secret exists, as it would in Secrets
      // Manager — that is what the post-mint verification re-reads.
      readSecret: async () => (minted ? "freshly-minted-key" : script.secret),
      probe: async () => {
        if (half === 0) pair = probes.shift() ?? [null, null];
        const value = pair![half]!;
        half = half === 0 ? 1 : 0;
        return value;
      },
      aws: async (args) => {
        awsCalls.push([...args]);
        if (args[0] === "ssm") {
          return JSON.stringify({
            cluster: "hasna-prod",
            mint_key_task_family: "hasna-ops-mint-key-widgets",
            subnets: ["subnet-a"],
            security_groups: ["sg-1"],
            assign_public_ip: "DISABLED",
          });
        }
        if (args[0] === "ecs" && args[1] === "run-task") {
          minted = true;
          return "arn:aws:ecs:us-east-1:0:task/t1\n";
        }
        if (args[0] === "ecs" && args[1] === "describe-tasks") return "0\n";
        return "";
      },
    };
    return { io, awsCalls };
  }

  /** Run `main` with its console silenced and GitHub's two sinks redirected. */
  async function run(argv: string[], io: Io): Promise<{ code: number; summary: string; output: string }> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-key-"));
    const summary = path.join(dir, "summary.md");
    const output = path.join(dir, "output.txt");
    fs.writeFileSync(summary, "");
    fs.writeFileSync(output, "");
    const previous = { summary: process.env.GITHUB_STEP_SUMMARY, output: process.env.GITHUB_OUTPUT };
    const log = console.log;
    const error = console.error;
    process.env.GITHUB_STEP_SUMMARY = summary;
    process.env.GITHUB_OUTPUT = output;
    console.log = () => {};
    console.error = () => {};
    try {
      const code = await main(argv, io);
      return { code, summary: fs.readFileSync(summary, "utf8"), output: fs.readFileSync(output, "utf8") };
    } finally {
      console.log = log;
      console.error = error;
      if (previous.summary === undefined) delete process.env.GITHUB_STEP_SUMMARY;
      else process.env.GITHUB_STEP_SUMMARY = previous.summary;
      if (previous.output === undefined) delete process.env.GITHUB_OUTPUT;
      else process.env.GITHUB_OUTPUT = previous.output;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  const wrote = (calls: string[][]) => calls.filter((c) => c[0] === "ecs" && c[1] === "run-task");

  test("a MISSING key is minted with no flag at all — nothing can be invalidated", async () => {
    const { io, awsCalls } = scriptedIo({ secret: null, probes: [[401, 200]] });
    const { code } = await run(["provision", "--app", "messages"], io);
    expect(wrote(awsCalls)).toHaveLength(1);
    expect(code).toBe(0);
  });

  test("a REFUSED key is left alone: the mint task is never started", async () => {
    // loops answers 403 on the default probe path today, which is exactly the
    // reading a valid-but-out-of-scope key produces. Nothing may be written on
    // the strength of it.
    const { io, awsCalls } = scriptedIo({ secret: "live-key", probes: [[403, 403]] });
    const { code, summary } = await run(["provision", "--app", "loops"], io);
    expect(awsCalls).toEqual([]);
    expect(code).toBe(1);
    // Red AND explained: the operator is told both ways out.
    expect(summary).toContain("--allow-rotate");
  });

  test("--allow-rotate still refuses when the CONFIRMING probe disagrees", async () => {
    // One refusal can be a rollout still settling or a single unlucky request.
    const { io, awsCalls } = scriptedIo({ secret: "live-key", probes: [[401, 401], [401, 200]] });
    const { code } = await run(["provision", "--app", "loops", "--allow-rotate"], io);
    expect(awsCalls).toEqual([]);
    expect(code).toBe(1);
  });

  test("--allow-rotate with a confirmed refusal rotates, and says so where stations will see it", async () => {
    const { io, awsCalls } = scriptedIo({
      secret: "dead-key",
      probes: [
        [401, 401],
        [401, 401],
        [401, 200],
      ],
    });
    const { code, summary, output } = await run(["provision", "--app", "loops", "--allow-rotate"], io);
    expect(wrote(awsCalls)).toHaveLength(1);
    expect(code).toBe(0);
    expect(summary).toContain("ROTATED hasna/oss/loops/api-key");
    expect(summary).toContain("Keychain");
    expect(output).toContain("rotated=true");
    // The notice is instructions, never a value: neither the old key nor the
    // new one may appear in anything published.
    expect(summary).not.toContain("dead-key");
    expect(output).not.toContain("dead-key");
  });

  test("an UNVERIFIABLE probe writes nothing, with or without the flag", async () => {
    for (const argv of [
      ["provision", "--app", "loops"],
      ["provision", "--app", "loops", "--allow-rotate"],
    ]) {
      // 200 unkeyed: /v1/* is not gated at all, so the probe proved nothing.
      const { io, awsCalls } = scriptedIo({ secret: "live-key", probes: [[200, 200], [200, 200]] });
      const { code } = await run(argv, io);
      expect(awsCalls).toEqual([]);
      expect(code).toBe(1);
    }
  });

  test("--dry-run never starts a mint task", async () => {
    const { io, awsCalls } = scriptedIo({ secret: null, probes: [[401, 401]] });
    const { code } = await run(["provision", "--app", "messages", "--dry-run"], io);
    expect(awsCalls).toEqual([]);
    expect(code).toBe(1);
  });
});

describe("the lanes actually call the checker", () => {
  const workflows = path.join(ROOT, ".github", "workflows");
  const read = (name: string) => fs.readFileSync(path.join(workflows, name), "utf8");

  /**
   * Every root deploy lane, DERIVED from the files on disk.
   *
   * Not a hardcoded list: the failure this suite exists to prevent is "a
   * service ships with nobody checking its key", and a list written by hand
   * would let the sixth lane added next month omit the provisioning job and
   * still go green — the same failure, one directory over.
   */
  const PORTED = fs
    .readdirSync(workflows)
    .filter((f) => /^deploy-[a-z][a-z0-9-]*\.yml$/.test(f))
    .map((f) => f.slice("deploy-".length, -".yml".length))
    .sort();

  test("the reusable provisioning workflow exists and runs the checker", () => {
    const wf = read("fleet-key-provision.yml");
    expect(wf).toContain("workflow_call");
    expect(wf).toContain("tooling/fleet/fleet-key.ts");
    expect(wf).toContain("provision --app");
    // Pinned toolchain, and the third-party action set up BEFORE credentials.
    expect(wf).toContain("bun-version: 1.3.14");
    expect(wf.indexOf("setup-bun")).toBeLessThan(wf.indexOf("configure-aws-credentials"));
  });

  test("rotation is opt-in at the workflow boundary too, and off for every caller", () => {
    const wf = read("fleet-key-provision.yml");
    expect(wf).toContain("allow_rotate");
    expect(wf).toMatch(/allow_rotate:[\s\S]*?default: false/);
    expect(wf).toContain("--allow-rotate");
    // No in-repo lane may hand it `true`: replacing a key every station holds
    // is a decision a human makes, not a deploy-time default.
    for (const app of PORTED) {
      expect(read(`deploy-${app}.yml`)).not.toContain("allow_rotate: true");
    }
  });

  test("the manifest name is derived from the app, never from a repo-wide variable", () => {
    const wf = read("fleet-key-provision.yml");
    // vars.* is REPOSITORY-scoped while this workflow is called for many apps:
    // one variable would point every lane at one app's manifest and mint
    // through the wrong task family.
    expect(wf).not.toContain("vars.DEPLOY_MANIFEST");
    expect(wf).toContain("DEPLOY_MANIFEST: /hasna/deploy/${{ inputs.app }}");
  });

  /**
   * The lines of every `run: |` block scalar in a workflow — i.e. the text the
   * shell actually receives. A block scalar owns the lines indented deeper than
   * its own key, so the `env:` mapping that follows it is not part of it.
   */
  const runBodies = (yaml: string): string[] => {
    const lines = yaml.split("\n");
    const bodies: string[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      const match = /^(\s*)run:\s*[|>]/.exec(lines[i] ?? "");
      if (!match) continue;
      const indent = match[1]!.length;
      const body: string[] = [];
      for (let j = i + 1; j < lines.length; j += 1) {
        const line = lines[j]!;
        if (line.trim() !== "" && line.search(/\S/) <= indent) break;
        body.push(line);
      }
      bodies.push(body.join("\n"));
    }
    return bodies;
  };

  test("no run: body pastes an expression straight into the shell", () => {
    // The Actions script-injection shape. Values reach a script through env:,
    // where the shell sees a variable rather than text spliced into the source.
    for (const name of ["fleet-key-provision.yml", "fleet-key-drift.yml"]) {
      const bodies = runBodies(read(name));
      expect(bodies.length).toBeGreaterThan(0);
      for (const body of bodies) expect(body).not.toContain("${{");
    }
  });

  test("both new lanes are switched OFF until their AWS prerequisites exist, and say so out loud", () => {
    // Merging must not paint five production deploy lanes and a nightly job red
    // for a role that does not exist yet. But a check that is quiet while
    // disabled is the very failure #1595 is about, so each disabled path must
    // annotate the run and name the variable that turns it on.
    const provision = read("fleet-key-provision.yml");
    expect(provision).toContain("vars.FLEET_KEY_PROVISION_ENABLED == 'true'");
    expect(provision).toContain("vars.FLEET_KEY_PROVISION_ENABLED != 'true'");
    expect(provision).toContain("::warning title=fleet key unchecked::");

    const drift = read("fleet-key-drift.yml");
    expect(drift).toContain("vars.FLEET_KEY_DRIFT_ENABLED == 'true'");
    expect(drift).toContain("vars.FLEET_KEY_DRIFT_ENABLED != 'true'");
    expect(drift).toContain("::warning title=fleet key drift not enabled::");

    // The checker's own self-test is NOT behind the switch: a rotted checker
    // must be caught even while the fleet half is waiting on infra. So the step
    // that runs it carries no `if:` at all.
    const selfTestStep = drift
      .split(/\n\s+- name: /)
      .find((step) => step.includes("bun test tooling/ci/tests/standard/fleet-key-provisioning.test.ts"));
    expect(selfTestStep).toBeDefined();
    expect(selfTestStep).not.toContain("if:");
  });

  test("the daily audit is not gated on a deployment environment", () => {
    // A scheduled audit that a deploy approval gate can hold is an audit that
    // silently stops running; 06:17 has nobody to approve it.
    expect(read("fleet-key-drift.yml")).not.toMatch(/^\s+environment:/m);
    // The deploy-time job keeps it: <app>-prod-gha-deploy trusts the OIDC
    // subject repo:hasna/apps:environment:production.
    expect(read("fleet-key-provision.yml")).toMatch(/^\s+environment: production$/m);
  });

  test("the daily lane never writes: drift reads and reports, it does not mint", () => {
    const drift = read("fleet-key-drift.yml");
    expect(drift).not.toContain("fleet-key.ts provision");
    expect(drift).not.toContain("--allow-rotate");
  });

  test("the deploy lanes on disk are the ones this suite checks", () => {
    // A guard on the derivation above: if the glob ever matches nothing, every
    // loop below would pass vacuously.
    expect(PORTED.length).toBeGreaterThan(0);
    const registered = new Set(loadRegistry(ROOT).map((a) => a.app));
    for (const app of PORTED) {
      // A lane deploying an app nobody registered is an app nobody checks.
      expect({ app, registered: registered.has(app) }).toEqual({ app, registered: true });
    }
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
