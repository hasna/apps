import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, cpSync } from "node:fs";
import { join, resolve } from "node:path";
import { hostname, tmpdir } from "node:os";
import {
  buildStationTemplateSteps,
  checkStationTemplate,
  defaultTemplatesDir,
  loadStationTemplate,
  parseTemplateSpec,
  renderCloudInit,
  resolveStationTemplate,
  type CommandProbe,
} from "../src/station-template/index.js";

const SHIPPED = defaultTemplatesDir();
const repoRoot = resolve(import.meta.dir, "..");
const cliPath = join(repoRoot, "src", "cli", "index.ts");

function runCli(args: string[], env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, [cliPath, ...args], { cwd: repoRoot, env, encoding: "utf8" });
}

function effectiveFor(overlays: string[] = []) {
  return resolveStationTemplate(overlays, { templatesDir: SHIPPED });
}

/** Build a fixture root that matches the rendered template exactly (ec2 by default). */
function buildCleanFixture(overlays: string[] = ["ec2"]) {
  const root = mkdtempSync(join(tmpdir(), "station-template-check-"));
  const home = join(root, "home", "hasna");
  const effective = effectiveFor(overlays);
  for (const file of effective.files) {
    const target = file.target.startsWith("~/") ? join(home, file.target.slice(2)) : join(root, file.target.slice(1));
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, file.content);
  }
  for (const [key, value] of Object.entries(effective.sysctls)) {
    const procPath = join(root, "proc/sys", key.replace(/\./g, "/"));
    mkdirSync(join(procPath, ".."), { recursive: true });
    writeFileSync(procPath, `${value}\n`);
  }
  for (const runtime of effective.runtimeValues) {
    const target = join(root, runtime.path.slice(1));
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, `${runtime.value}\n`);
  }
  for (const pkg of effective.packages.bun) {
    const dir = join(home, ".bun/install/global/node_modules", pkg);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: pkg, version: "9.9.9" }));
  }
  writeSwap(root, effective.swap.sizeGb);
  return { root, home, effective };
}

/** /proc/swaps as the kernel formats it: header line, then Size in KB. */
function writeSwap(root: string, sizeGb: number) {
  const procSwaps = join(root, "proc/swaps");
  mkdirSync(join(procSwaps, ".."), { recursive: true });
  const kb = Math.round(sizeGb * 1024 * 1024) - 4;
  writeFileSync(procSwaps, `Filename\t\t\t\tType\t\tSize\t\tUsed\t\tPriority\n/swapfile\tfile\t${kb}\t0\t-2\n`);
}

describe("station template loading", () => {
  test("shipped template loads, validates, and carries lessons", () => {
    const { template } = loadStationTemplate("station", { templatesDir: SHIPPED });
    expect(template.$schema).toBe("hasna.station_template.v1");
    expect(template.version).toMatch(/^\d+\.\d+\.\d+$/);
    for (const file of template.base.files) {
      expect(file.lesson.length).toBeGreaterThan(10);
    }
    expect(Object.keys(template.overlays)).toEqual(expect.arrayContaining(["dgx-spark", "ec2"]));
  });

  test("corrupt template.json is rejected naming the path", () => {
    const dir = mkdtempSync(join(tmpdir(), "station-template-corrupt-"));
    mkdirSync(join(dir, "station"), { recursive: true });
    writeFileSync(join(dir, "station", "template.json"), "{not json");
    expect(() => loadStationTemplate("station", { templatesDir: dir })).toThrow(/template\.json is not valid JSON/);
  });

  test("schema violation is rejected with the failing path", () => {
    const dir = mkdtempSync(join(tmpdir(), "station-template-badschema-"));
    mkdirSync(join(dir, "station"), { recursive: true });
    writeFileSync(
      join(dir, "station", "template.json"),
      JSON.stringify({ $schema: "hasna.station_template.v1", name: "station", version: "not-semver", description: "x", base: {} })
    );
    expect(() => loadStationTemplate("station", { templatesDir: dir })).toThrow(/version/);
  });

  test("ordering rule: sysctl file without 99-zz- prefix is rejected (the shipped 90- bug)", () => {
    const dir = mkdtempSync(join(tmpdir(), "station-template-ordering-"));
    cpSync(join(SHIPPED, "station"), join(dir, "station"), { recursive: true });
    const templatePath = join(dir, "station", "template.json");
    const template = JSON.parse(readFileSync(templatePath, "utf8"));
    template.base.files[0].target = "/etc/sysctl.d/90-hasna-station.conf";
    writeFileSync(templatePath, JSON.stringify(template));
    expect(() => resolveStationTemplate([], { templatesDir: dir })).toThrow(/99-zz-/);
  });

  test("unknown overlay names fail loudly", () => {
    expect(() => effectiveFor(["no-such-overlay"])).toThrow(/overlay not found/);
  });

  test("parseTemplateSpec splits name and overlays", () => {
    expect(parseTemplateSpec("station,ec2")).toEqual({ name: "station", overlays: ["ec2"] });
    expect(parseTemplateSpec("station")).toEqual({ name: "station", overlays: [] });
  });
});

describe("overlay merge", () => {
  test("ec2 overlay swaps slice values and adds swapfile + the aws CLI requirement", () => {
    const effective = effectiveFor(["ec2"]);
    const agentsSlice = effective.files.find((file) => file.target.endsWith("hasna-agents.slice"));
    expect(agentsSlice?.content).toContain("MemoryHigh=20G");
    expect(agentsSlice?.content).toContain("MemoryMax=24G");
    expect(effective.swap.sizeGb).toBe(8);
    expect(effective.layers).toEqual(["base", "ec2"]);
    // REGRESSION (station17, 2026-07-29): this used to be apt package "awscli",
    // which has no installation candidate on Ubuntu 24.04. The requirement is a
    // command, and it must never travel as an apt name again.
    expect(effective.packages.apt).not.toContain("awscli");
    const aws = effective.commands.find((command) => command.command === "aws");
    expect(aws).toBeDefined();
    expect(aws!.install).toContain("awscli.amazonaws.com");
    // station17 build 2 (2026-07-29): the 8G swapfile met an 8G AMI-default
    // root volume. The overlay now declares the root-volume floor the launcher
    // must honor and the drift check enforces.
    expect(effective.disk?.rootMinGb).toBe(64);
    expect(effective.disk?.lesson).toContain("i-0f522f0138a0411e1");
  });

  test("REGRESSION: no layer may declare an apt package that noble does not ship", () => {
    // Narrow and literal on purpose: the general "is this package in the
    // archive" question needs network. This pins the one name that burned us.
    for (const overlay of ["ec2", "dgx-spark"]) {
      expect(effectiveFor([overlay]).packages.apt).not.toContain("awscli");
    }
  });

  test("dgx-spark overlay keeps the measured 121G-class slice values", () => {
    const effective = effectiveFor(["dgx-spark"]);
    const agentsSlice = effective.files.find((file) => file.target.endsWith("hasna-agents.slice"));
    expect(agentsSlice?.content).toContain("MemoryHigh=54G");
    expect(agentsSlice?.content).toContain("MemoryMax=60G");
    const rosterUnit = effective.files.find((file) => file.target.endsWith("machines-roster.service"));
    expect(rosterUnit?.content).toContain("/home/hasna/.bun/bin/machines-agent roster daemon");
    expect(rosterUnit?.content).not.toContain("/opt/fixture");
    expect(effective.services).toContainEqual({
      name: "machines-roster.service",
      scope: "user",
      expectEnabled: true,
      expectActive: true,
    });
    expect(effective.swap.sizeGb).toBe(0);
  });

  test("physical overlay keeps tailscale — the 2026-07-30 ruling routes it, it does not delete it", () => {
    const effective = effectiveFor(["dgx-spark"]);
    expect(effective.tailscale?.join).toBe(true);
    expect(effective.tailscale?.authKeySecretName).toBe("stations/prod/tailscale/authkey");
    expect(effective.services.some((service) => service.name === "tailscaled")).toBe(true);
  });
});

describe("physical render", () => {
  test("renders idempotent steps covering every template concern", () => {
    const steps = buildStationTemplateSteps(effectiveFor(["dgx-spark"]), { station: "station01" });
    const commands = steps.map((step) => step.command).join("\n");
    expect(commands).toContain("/etc/sysctl.d/99-zz-hasna-station.conf");
    expect(commands).toContain("sysctl --system");
    expect(commands).toContain("systemd-tmpfiles --create");
    expect(commands).toContain("earlyoom");
    expect(commands).toContain("tailscale");
    expect(commands).toContain("bun install -g");
    expect(commands).toContain("systemctl --user enable --now 'machines-roster.service'");
    // secret NAMES are allowed; secret VALUES have no path into a render
    expect(commands).toContain("stations/prod/tailscale/authkey");
    expect(commands).not.toContain("tskey-");
  });

  test("stages the Tailscale auth key in a securely created temporary file", () => {
    const steps = buildStationTemplateSteps(effectiveFor(["dgx-spark"]));
    const join = steps.find((step) => step.id === "template-tailscale-join");
    expect(join?.command).toContain("auth_key_file=$(mktemp)");
    expect(join?.command).toContain('trap \'rm -f "$auth_key_file"\' EXIT');
    expect(join?.command).toContain('--auth-key "file:$auth_key_file"');
    expect(join?.command).not.toContain("/tmp/ts-authkey");
  });
});

describe("cloud-init render", () => {
  test("renders user-data from the same source with station identity", () => {
    const effective = effectiveFor(["ec2"]);
    const userData = renderCloudInit(effective, { station: "station17" });
    expect(userData.startsWith("#cloud-config")).toBe(true);
    expect(userData).toContain("hostname: station17");
    expect(userData).toContain("- earlyoom");
    expect(userData).toContain("swapon /swapfile");
    // write_files carries the sysctl content base64-encoded
    const sysctl = effective.files.find((file) => file.kind === "sysctl")!;
    expect(userData).toContain(Buffer.from(sysctl.content, "utf8").toString("base64"));
    // no secret value has any path into a render
    expect(userData).not.toContain("tskey-");
  });

  test("swapfile entry is convergent and space-guarded, not the test -f trap that stranded build 2", () => {
    const userData = renderCloudInit(effectiveFor(["ec2"]), { station: "station17" });
    // The guard is ACTIVE swap, never file existence: build 2's partial 4.2G
    // fallocate leftover satisfied `test -f` forever while swapon stayed empty.
    expect(userData).not.toContain("test -f /swapfile");
    expect(userData).toContain("swapon --noheadings --show=NAME");
    expect(userData).toContain("rm -f /swapfile");
    // 8G swap + 2G headroom = 10485760 KB must be free before allocating.
    expect(userData).toContain("-ge 10485760");
    // fstab append is deduplicated, and failure is loud but non-fatal.
    expect(userData).toContain("grep -q '^/swapfile ' /etc/fstab");
    expect(userData).toContain("swapfile skipped");
  });
});

describe("drift check", () => {
  test("clean fixture reports verdict clean", () => {
    const { root, home, effective } = buildCleanFixture();
    const result = checkStationTemplate(effective, { rootDir: root, homeDir: home, commandProbe: null });
    const failed = result.items.filter((item) => item.status === "drift" || item.status === "violation");
    expect(failed).toEqual([]);
    expect(result.verdict).toBe("clean");
  });

  test("POSITIVE CONTROL: a missing bun global is detected (12 CLIs were checked by nothing)", () => {
    const { root, home, effective } = buildCleanFixture();
    rmSync(join(home, ".bun/install/global/node_modules/@hasna/machines"), { recursive: true, force: true });
    const result = checkStationTemplate(effective, { rootDir: root, homeDir: home, commandProbe: null });
    expect(result.verdict).toBe("drift");
    const item = result.items.find((candidate) => candidate.id === "package:bun:@hasna/machines");
    expect(item?.status).toBe("drift");
    expect(item?.detail).toContain("not installed globally");
  });

  test("bun globals are reported with the version actually on disk", () => {
    const { root, home, effective } = buildCleanFixture();
    const result = checkStationTemplate(effective, { rootDir: root, homeDir: home, commandProbe: null });
    const item = result.items.find((candidate) => candidate.id === "package:bun:@hasna/todos");
    expect(item?.status).toBe("ok");
    expect(item?.detail).toContain("@9.9.9");
  });

  test("POSITIVE CONTROL: swap smaller than the overlay asks for is detected", () => {
    const { root, home, effective } = buildCleanFixture();
    writeSwap(root, 2);
    const result = checkStationTemplate(effective, { rootDir: root, homeDir: home, commandProbe: null });
    expect(result.verdict).toBe("drift");
    const item = result.items.find((candidate) => candidate.id === "swap:size");
    expect(item?.status).toBe("drift");
    expect(item?.detail).toContain("expected 8G");
  });

  test("swap check tolerates the swapfile header shortfall rather than flapping", () => {
    const { root, home, effective } = buildCleanFixture();
    const result = checkStationTemplate(effective, { rootDir: root, homeDir: home, commandProbe: null });
    expect(result.items.find((candidate) => candidate.id === "swap:size")?.status).toBe("ok");
  });

  test("POSITIVE CONTROL: tailscaled active+enabled but logged out is drift, not ok (physical classes)", () => {
    // dgx-spark: since the 2026-07-30 ruling only physical layers carry
    // tailscale, so only a physical check can exercise tailscale:join.
    const { root, home, effective } = buildCleanFixture(["dgx-spark"]);
    // Exactly what station17 returned on 2026-07-29: the daemon is healthy and
    // the node holds no key. Note the real CLI EXITS 0 here — ok:true is
    // faithful, and only BackendState may decide.
    const probe: CommandProbe = (command, args) => {
      if (command === "systemctl") {
        return { ok: true, stdout: args.includes("is-active") ? "active\n" : "enabled\n" };
      }
      if (command === "tailscale") {
        return { ok: true, stdout: JSON.stringify({ BackendState: "NeedsLogin", Self: { HostName: "station17" } }) };
      }
      return { ok: true, stdout: "install ok installed" };
    };
    const result = checkStationTemplate(effective, { rootDir: root, homeDir: home, commandProbe: probe });
    expect(result.items.find((candidate) => candidate.id === "service:tailscaled")?.status).toBe("ok");
    const join1 = result.items.find((candidate) => candidate.id === "tailscale:join");
    expect(join1?.status).toBe("drift");
    expect(join1?.detail).toContain("BackendState=NeedsLogin");
    expect(result.verdict).toBe("drift");
  });

  test("tailscale join reports ok only when the backend is actually Running (physical classes)", () => {
    const { root, home, effective } = buildCleanFixture(["dgx-spark"]);
    const probe: CommandProbe = (command, args) => {
      if (command === "systemctl") {
        return { ok: true, stdout: args.includes("is-active") ? "active\n" : "enabled\n" };
      }
      if (command === "tailscale") {
        return { ok: true, stdout: JSON.stringify({ BackendState: "Running", Self: { HostName: "station17" } }) };
      }
      if (command === "sh") return { ok: true, stdout: "/usr/local/bin/aws\n" };
      return { ok: true, stdout: "install ok installed" };
    };
    const result = checkStationTemplate(effective, { rootDir: root, homeDir: home, commandProbe: probe });
    const join1 = result.items.find((candidate) => candidate.id === "tailscale:join");
    expect(join1?.status).toBe("ok");
    expect(join1?.detail).toContain("station17");
    expect(result.verdict).toBe("clean");
  });

  test("POSITIVE CONTROL: a required command missing from PATH is detected", () => {
    const { root, home, effective } = buildCleanFixture();
    const probe: CommandProbe = (command) => {
      if (command === "sh") return { ok: false, stdout: "" };
      if (command === "tailscale") return { ok: true, stdout: JSON.stringify({ BackendState: "Running" }) };
      if (command === "systemctl") return { ok: true, stdout: "active\n" };
      return { ok: true, stdout: "install ok installed" };
    };
    const result = checkStationTemplate(effective, { rootDir: root, homeDir: home, commandProbe: probe });
    const item = result.items.find((candidate) => candidate.id === "command:aws-cli");
    expect(item?.status).toBe("drift");
    expect(item?.detail).toContain("aws not on PATH");
  });

  test("bun global probe never reads the coordinator's own tree during a fixture check", () => {
    const { root, home, effective } = buildCleanFixture();
    rmSync(join(home, ".bun"), { recursive: true, force: true });
    const previous = process.env["BUN_INSTALL"];
    process.env["BUN_INSTALL"] = join(repoRoot, "node_modules", "..");
    try {
      const result = checkStationTemplate(effective, { rootDir: root, homeDir: home, commandProbe: null });
      // Every bun package must be drift: the fixture has none, and the ambient
      // BUN_INSTALL must not be allowed to answer for it.
      for (const pkg of effective.packages.bun) {
        expect(result.items.find((candidate) => candidate.id === `package:bun:${pkg}`)?.status).toBe("drift");
      }
    } finally {
      if (previous === undefined) delete process.env["BUN_INSTALL"];
      else process.env["BUN_INSTALL"] = previous;
    }
  });

  test("POSITIVE CONTROL: planted content drift is detected and named", () => {
    const { root, home, effective } = buildCleanFixture();
    writeFileSync(join(root, "etc/sysctl.d/99-zz-hasna-station.conf"), "vm.swappiness = 1\n");
    const result = checkStationTemplate(effective, { rootDir: root, homeDir: home, commandProbe: null });
    expect(result.verdict).toBe("drift");
    const item = result.items.find((candidate) => candidate.id === "file:sysctl-reclaim");
    expect(item?.status).toBe("drift");
    expect(item?.detail).toContain("content mismatch");
  });

  test("POSITIVE CONTROL: later-sorting conflicting sysctl file is an ordering violation", () => {
    const { root, home, effective } = buildCleanFixture();
    // the Jul 28 class: a vendor file that redefines our key and wins ordering
    writeFileSync(join(root, "etc/sysctl.d/99-zz-zz-vendor.conf"), "vm.swappiness = 1\n");
    const result = checkStationTemplate(effective, { rootDir: root, homeDir: home, commandProbe: null });
    expect(result.verdict).toBe("drift");
    const item = result.items.find((candidate) => candidate.id === "ordering:sysctl-reclaim");
    expect(item?.status).toBe("violation");
    expect(item?.detail).toContain("99-zz-zz-vendor.conf");
    expect(item?.detail).toContain("vm.swappiness");
  });

  test("POSITIVE CONTROL: runtime sysctl drift is detected (file correct, kernel value wrong)", () => {
    const { root, home, effective } = buildCleanFixture();
    writeFileSync(join(root, "proc/sys/vm/swappiness"), "1\n");
    const result = checkStationTemplate(effective, { rootDir: root, homeDir: home, commandProbe: null });
    expect(result.verdict).toBe("drift");
    const item = result.items.find((candidate) => candidate.id === "sysctl:vm.swappiness");
    expect(item?.status).toBe("drift");
    expect(item?.detail).toContain("expected 60, found 1");
  });

  test("POSITIVE CONTROL: unit missing StartLimit/OnFailure/absolute ExecStart is flagged", () => {
    const { root, home, effective } = buildCleanFixture();
    const unitDir = join(home, ".config/systemd/user");
    mkdirSync(unitDir, { recursive: true });
    writeFileSync(
      join(unitDir, "hasna-broken-mcp.service"),
      "[Unit]\nDescription=broken\n[Service]\nExecStart=snapshots-agent\nRestart=always\n"
    );
    const result = checkStationTemplate(effective, { rootDir: root, homeDir: home, commandProbe: null });
    const item = result.items.find((candidate) => candidate.id === "unit:hasna-broken-mcp.service");
    expect(item?.status).toBe("violation");
    expect(item?.detail).toContain("StartLimitIntervalSec");
    expect(item?.detail).toContain("absolute path");

    // and the fixed form passes — the check can tell the two apart
    writeFileSync(
      join(unitDir, "hasna-fixed-mcp.service"),
      "[Unit]\nDescription=fixed\nStartLimitIntervalSec=300\nStartLimitBurst=5\nOnFailure=hasna-unit-failure-notify@%n.service\n[Service]\nExecStart=/home/hasna/.bun/bin/snapshots-agent\n"
    );
    const again = checkStationTemplate(effective, { rootDir: root, homeDir: home, commandProbe: null });
    expect(again.items.find((candidate) => candidate.id === "unit:hasna-fixed-mcp.service")?.status).toBe("ok");
  });

  test("POSITIVE CONTROL: unit with the incident's 10s window / wrong burst / wrong OnFailure target is flagged", () => {
    const { root, home, effective } = buildCleanFixture();
    const unitDir = join(home, ".config/systemd/user");
    mkdirSync(unitDir, { recursive: true });
    // Every key is PRESENT — only the values are wrong. This is verbatim the
    // 2026-07-28 shape: the systemd-default-class 10s window that resets at
    // >2s spacing, plus an OnFailure target that does not exist.
    writeFileSync(
      join(unitDir, "hasna-incident-repro.service"),
      "[Unit]\nDescription=repro\nStartLimitIntervalSec=10\nStartLimitBurst=99999\nOnFailure=totally-wrong-unit.service\n[Service]\nExecStart=/bin/true\n"
    );
    const result = checkStationTemplate(effective, { rootDir: root, homeDir: home, commandProbe: null });
    const item = result.items.find((candidate) => candidate.id === "unit:hasna-incident-repro.service");
    expect(item?.status).toBe("violation");
    expect(item?.detail).toContain("StartLimitIntervalSec=10, convention is 300");
    expect(item?.detail).toContain("StartLimitBurst=99999, convention is 5");
    expect(item?.detail).toContain("OnFailure=totally-wrong-unit.service, convention is hasna-unit-failure-notify@%n.service");
    expect(result.verdict).toBe("drift");
  });

  test("POSITIVE CONTROL: unit directives in the wrong systemd sections are flagged", () => {
    const { root, home, effective } = buildCleanFixture();
    const unitDir = join(home, ".config/systemd/user");
    mkdirSync(unitDir, { recursive: true });
    writeFileSync(
      join(unitDir, "hasna-wrong-sections.service"),
      "[Unit]\nExecStart=/bin/true\n[Service]\nStartLimitIntervalSec=300\nStartLimitBurst=5\nOnFailure=hasna-unit-failure-notify@%n.service\n"
    );
    const result = checkStationTemplate(effective, { rootDir: root, homeDir: home, commandProbe: null });
    const item = result.items.find((candidate) => candidate.id === "unit:hasna-wrong-sections.service");
    expect(item?.status).toBe("violation");
    expect(item?.detail).toContain("missing StartLimitIntervalSec");
    expect(item?.detail).toContain("missing StartLimitBurst");
    expect(item?.detail).toContain("missing OnFailure");
    expect(item?.detail).toContain("missing ExecStart");
  });

  test("systemd section names are not normalized", () => {
    const { root, home, effective } = buildCleanFixture();
    const unitDir = join(home, ".config/systemd/user");
    mkdirSync(unitDir, { recursive: true });
    // systemd treats these as unknown sections, including the spaces inside
    // the brackets. The drift parser must not accept them as Unit/Service.
    writeFileSync(
      join(unitDir, "hasna-invalid-sections.service"),
      "[ Unit ]\nStartLimitIntervalSec=300\nStartLimitBurst=5\nOnFailure=hasna-unit-failure-notify@%n.service\n[ Service ]\nExecStart=/bin/true\n"
    );
    const result = checkStationTemplate(effective, { rootDir: root, homeDir: home, commandProbe: null });
    const item = result.items.find((candidate) => candidate.id === "unit:hasna-invalid-sections.service");
    expect(item?.status).toBe("violation");
    expect(item?.detail).toContain("missing StartLimitIntervalSec");
    expect(item?.detail).toContain("missing StartLimitBurst");
    expect(item?.detail).toContain("missing OnFailure");
    expect(item?.detail).toContain("missing ExecStart");
  });

  test("drop-ins do not inherit the main unit's last section", () => {
    const { root, home, effective } = buildCleanFixture();
    const unitDir = join(home, ".config/systemd/user");
    mkdirSync(join(unitDir, "hasna-headerless-dropin.service.d"), { recursive: true });
    writeFileSync(
      join(unitDir, "hasna-headerless-dropin.service"),
      "[Service]\nExecStart=/bin/true\n[Unit]\nDescription=ends in Unit\n"
    );
    // A new file starts outside every section; systemd ignores these lines.
    writeFileSync(
      join(unitDir, "hasna-headerless-dropin.service.d", "10-invalid.conf"),
      "StartLimitIntervalSec=300\nStartLimitBurst=5\nOnFailure=hasna-unit-failure-notify@%n.service\n"
    );
    const result = checkStationTemplate(effective, { rootDir: root, homeDir: home, commandProbe: null });
    const item = result.items.find((candidate) => candidate.id === "unit:hasna-headerless-dropin.service");
    expect(item?.status).toBe("violation");
    expect(item?.detail).toContain("missing StartLimitIntervalSec");
    expect(item?.detail).toContain("missing StartLimitBurst");
    expect(item?.detail).toContain("missing OnFailure");
  });

  test("unit conventions accept equivalent systemd time spellings but not equivalent-looking wrong ones", () => {
    const { root, home, effective } = buildCleanFixture();
    const unitDir = join(home, ".config/systemd/user");
    mkdirSync(unitDir, { recursive: true });
    // 5min === 300s: the convention is the duration, not the literal text.
    writeFileSync(
      join(unitDir, "hasna-timespan-ok.service"),
      "[Unit]\nStartLimitIntervalSec=5min\nStartLimitBurst=5\nOnFailure=hasna-unit-failure-notify@%n.service\n[Service]\nExecStart=/bin/true\n"
    );
    // 300ms is NOT 300s — a raw string compare would wave this through.
    writeFileSync(
      join(unitDir, "hasna-timespan-bad.service"),
      "[Unit]\nStartLimitIntervalSec=300ms\nStartLimitBurst=5\nOnFailure=hasna-unit-failure-notify@%n.service\n[Service]\nExecStart=/bin/true\n"
    );
    const result = checkStationTemplate(effective, { rootDir: root, homeDir: home, commandProbe: null });
    expect(result.items.find((candidate) => candidate.id === "unit:hasna-timespan-ok.service")?.status).toBe("ok");
    const bad = result.items.find((candidate) => candidate.id === "unit:hasna-timespan-bad.service");
    expect(bad?.status).toBe("violation");
    expect(bad?.detail).toContain("StartLimitIntervalSec=300ms, convention is 300");
  });

  test("drop-in that lowers the window below convention is flagged even though the unit file is compliant", () => {
    const { root, home, effective } = buildCleanFixture();
    const unitDir = join(home, ".config/systemd/user");
    mkdirSync(join(unitDir, "hasna-dropin-downgrade.service.d"), { recursive: true });
    writeFileSync(
      join(unitDir, "hasna-dropin-downgrade.service"),
      "[Unit]\nStartLimitIntervalSec=300\nStartLimitBurst=5\nOnFailure=hasna-unit-failure-notify@%n.service\n[Service]\nExecStart=/bin/true\n"
    );
    // systemd takes the LAST scalar assignment, so the drop-in wins.
    writeFileSync(
      join(unitDir, "hasna-dropin-downgrade.service.d", "10-loosen.conf"),
      "[Unit]\nStartLimitIntervalSec=10\n"
    );
    const result = checkStationTemplate(effective, { rootDir: root, homeDir: home, commandProbe: null });
    const item = result.items.find((candidate) => candidate.id === "unit:hasna-dropin-downgrade.service");
    expect(item?.status).toBe("violation");
    expect(item?.detail).toContain("StartLimitIntervalSec=10, convention is 300");
  });

  test("OnFailure= reset in a drop-in drops the convention target (systemd list semantics)", () => {
    const { root, home, effective } = buildCleanFixture();
    const unitDir = join(home, ".config/systemd/user");
    mkdirSync(join(unitDir, "hasna-onfailure-reset.service.d"), { recursive: true });
    writeFileSync(
      join(unitDir, "hasna-onfailure-reset.service"),
      "[Unit]\nStartLimitIntervalSec=300\nStartLimitBurst=5\nOnFailure=hasna-unit-failure-notify@%n.service\n[Service]\nExecStart=/bin/true\n"
    );
    writeFileSync(
      join(unitDir, "hasna-onfailure-reset.service.d", "10-clear.conf"),
      "[Unit]\nOnFailure=\nOnFailure=some-other-unit.service\n"
    );
    const result = checkStationTemplate(effective, { rootDir: root, homeDir: home, commandProbe: null });
    const item = result.items.find((candidate) => candidate.id === "unit:hasna-onfailure-reset.service");
    expect(item?.status).toBe("violation");
    expect(item?.detail).toContain("OnFailure=some-other-unit.service, convention is hasna-unit-failure-notify@%n.service");
  });

  test("result names the machine it describes so a fleet sweep cannot mis-attribute it", () => {
    const { root, home, effective } = buildCleanFixture();
    const result = checkStationTemplate(effective, { rootDir: root, homeDir: home, commandProbe: null, machineId: "station17" });
    expect(result.machineId).toBe("station17");
    const defaulted = checkStationTemplate(effective, { rootDir: root, homeDir: home, commandProbe: null });
    expect(defaulted.machineId).toBe(process.env["HASNA_MACHINES_MACHINE_ID"] || hostname());
    expect(defaulted.machineId.length).toBeGreaterThan(0);
  });

  test("drop-in ExecStart= reset to an absolute path clears the bare-ExecStart flag (systemd semantics)", () => {
    const { root, home, effective } = buildCleanFixture();
    const unitDir = join(home, ".config/systemd/user");
    mkdirSync(join(unitDir, "hasna-reset-mcp.service.d"), { recursive: true });
    writeFileSync(
      join(unitDir, "hasna-reset-mcp.service"),
      "[Unit]\nDescription=bare in unit file\n[Service]\nExecStart=snapshots-agent run\n"
    );
    writeFileSync(
      join(unitDir, "hasna-reset-mcp.service.d", "10-fix.conf"),
      "[Unit]\nStartLimitIntervalSec=300\nStartLimitBurst=5\nOnFailure=hasna-unit-failure-notify@%n.service\n[Service]\nExecStart=\nExecStart=/home/hasna/.bun/bin/snapshots-agent run\n"
    );
    const result = checkStationTemplate(effective, { rootDir: root, homeDir: home, commandProbe: null });
    expect(result.items.find((candidate) => candidate.id === "unit:hasna-reset-mcp.service")?.status).toBe("ok");

    // positive control for the reset logic itself: drop-in WITHOUT the reset keeps the flag
    mkdirSync(join(unitDir, "hasna-noreset-mcp.service.d"), { recursive: true });
    writeFileSync(
      join(unitDir, "hasna-noreset-mcp.service"),
      "[Unit]\nDescription=bare in unit file\n[Service]\nExecStart=snapshots-agent run\n"
    );
    writeFileSync(
      join(unitDir, "hasna-noreset-mcp.service.d", "10-limits-only.conf"),
      "[Unit]\nStartLimitIntervalSec=300\nStartLimitBurst=5\nOnFailure=hasna-unit-failure-notify@%n.service\n"
    );
    const control = checkStationTemplate(effective, { rootDir: root, homeDir: home, commandProbe: null });
    const item = control.items.find((candidate) => candidate.id === "unit:hasna-noreset-mcp.service");
    expect(item?.status).toBe("violation");
    expect(item?.detail).toContain("absolute path");
  });

  test("check never mutates the fixture", () => {
    const { root, home, effective } = buildCleanFixture();
    const before = require("node:child_process").execSync(`find ${root} -type f | sort | xargs sha256sum`, { encoding: "utf8" });
    checkStationTemplate(effective, { rootDir: root, homeDir: home, commandProbe: null });
    const after = require("node:child_process").execSync(`find ${root} -type f | sort | xargs sha256sum`, { encoding: "utf8" });
    expect(after).toBe(before);
  });
});

describe("boot criticality (owner ruling 2026-07-29: tailscale must never be boot-critical)", () => {
  /**
   * Parse the runcmd entries out of rendered cloud-init user-data. yamlQuote
   * escapes exactly backslash and double-quote, so each `  - "..."` line is a
   * valid JSON string.
   */
  function runcmdEntries(userData: string): string[] {
    const lines = userData.split("\n");
    const start = lines.indexOf("runcmd:");
    expect(start).toBeGreaterThan(-1);
    const entries: string[] = [];
    for (const line of lines.slice(start + 1)) {
      if (!line.startsWith("  - ")) break;
      entries.push(JSON.parse(line.slice(4)) as string);
    }
    return entries;
  }

  function writeStub(dir: string, name: string, body: string) {
    writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  }

  test("ec2 overlay declares the SSM agent as its access floor; physical layers do not", () => {
    const effective = effectiveFor(["ec2"]);
    // The floor must depend only on identity the platform already grants (the
    // instance profile) — never on a credential fetched at boot.
    expect(effective.accessFloor?.service).toBe("snap.amazon-ssm-agent.amazon-ssm-agent");
    expect(effective.accessFloor?.lesson).toContain("station17");
    // A physical box's floor is its out-of-band path, not a template service.
    expect(effectiveFor(["dgx-spark"]).accessFloor).toBeUndefined();
  });

  test("runcmd order: access floor first, aws-cli install kept and early (0.2.4 fix is load-bearing)", () => {
    const entries = runcmdEntries(renderCloudInit(effectiveFor(["ec2"]), { station: "station17" }));
    const floor = entries.findIndex((entry) => entry.includes("amazon-ssm-agent"));
    const awsInstall = entries.findIndex((entry) => entry.includes("awscli.amazonaws.com"));
    // The floor is guaranteed before anything below it can fail. With
    // tailscale gone from EC2 (owner ruling 2026-07-30), SSM is not a floor
    // beneath something else — it is the whole access path.
    expect(floor).toBe(0);
    // The aws-cli command requirement survives the tailscale removal — it is
    // expressed as a command (never apt `awscli`, which noble does not ship)
    // and installs right after the floor.
    expect(awsInstall).toBe(1);
  });

  test("POSITIVE CONTROL: forced join failure (aws absent) cannot abort boot; floor enabled; failure loud — via a planted opt-in overlay, since no shipped cloud layer joins", () => {
    // Owner ruling 2026-07-30: station,ec2 renders no tailscale at all. The
    // cloud-init join path survives ONLY for a future deliberately-argued
    // single-box overlay, so exercise it from a planted template copy — which
    // keeps the never-boot-critical guarantee (2026-07-29 ruling) proven for
    // that path without putting tailscale back in any shipped layer.
    const planted = mkdtempSync(join(tmpdir(), "station-template-optin-"));
    cpSync(join(SHIPPED, "station"), join(planted, "station"), { recursive: true });
    const templatePath = join(planted, "station", "template.json");
    const template = JSON.parse(readFileSync(templatePath, "utf8"));
    template.overlays.ec2.tailscale = {
      join: true,
      authKeySecretName: "stations/prod/tailscale/authkey",
      hostnameFromStation: true,
      ssh: true,
    };
    writeFileSync(templatePath, JSON.stringify(template));
    const entries = runcmdEntries(
      renderCloudInit(resolveStationTemplate(["ec2"], { templatesDir: planted }), { station: "stationtest" })
    );
    const floorEntry = entries.find((entry) => entry.includes("amazon-ssm-agent"));
    const installEntries = entries.filter((entry) => entry.includes("awscli.amazonaws.com") || entry.includes("tailscale.com/install.sh"));
    const joinEntry = entries.find((entry) => entry.includes("secretsmanager get-secret-value"));
    expect(floorEntry).toBeDefined();
    expect(joinEntry).toBeDefined();

    const stubs = mkdtempSync(join(tmpdir(), "station-boot-stubs-"));
    const log = join(stubs, "invocations.log");
    writeFileSync(log, "");
    writeStub(stubs, "systemctl", `echo "systemctl $*" >> "${log}"`);
    writeStub(stubs, "snap", `echo "snap $*" >> "${log}"`);
    // IMDS answers; every other download (awscli installer, tailscale
    // installer) fails — a plain network hiccup at boot.
    writeStub(
      stubs,
      "curl",
      `case "$*" in *api/token*) echo dummy-imds-token ;; *placement/region*) echo us-east-1 ;; *) exit 7 ;; esac`
    );
    writeStub(stubs, "tailscale", `echo "tailscale $*" >> "${log}"\ncase "$1" in up) exit 1 ;; *) exit 0 ;; esac`);
    // `aws` is deliberately ABSENT from PATH — the exact station17 failure.

    // Only the entries this ruling governs are executed; the untouched middle
    // entries (sysctl/tmpfiles/swap/services) are exercised by the real boot
    // prove loop on station17. `sh -e` is the strictest shell semantics a
    // cloud-init change could ever run these under: surviving it proves the
    // entries cannot abort a boot.
    const script = [floorEntry!, ...installEntries, joinEntry!, "echo BOOT-CONTINUED-PAST-JOIN"].join("\n");
    const scriptPath = join(stubs, "runcmd-under-test.sh");
    writeFileSync(scriptPath, script);
    const result = spawnSync("sh", ["-e", scriptPath], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${stubs}:/usr/bin:/bin` },
    });
    // Reachability: the script survives every planted failure.
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("BOOT-CONTINUED-PAST-JOIN");
    // Never silent: the join failure is named on stderr (cloud-init logs it).
    expect(result.stderr).toContain("tailscale join failed");
    expect(result.stderr).toContain("NON-FATAL");
    // The floor was enabled before the join had any chance to fail.
    expect(readFileSync(log, "utf8")).toContain("enable --now snap.amazon-ssm-agent");
    // No secret material has a path into the exercised output.
    expect(result.stdout + result.stderr).not.toContain("tskey-");
  });

  test("POSITIVE CONTROL of the instrument: the sh -e harness detects a fatal entry", () => {
    // If this harness could not fail, the forced-join-failure control above
    // would be no evidence. Plant a fatal entry and assert it is fatal.
    const stubs = mkdtempSync(join(tmpdir(), "station-boot-harness-control-"));
    const scriptPath = join(stubs, "fatal.sh");
    writeFileSync(scriptPath, ["sh -c 'exit 3'", "echo BOOT-CONTINUED-PAST-JOIN"].join("\n"));
    const result = spawnSync("sh", ["-e", scriptPath], { encoding: "utf8", env: { ...process.env } });
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("BOOT-CONTINUED-PAST-JOIN");
  });

  test("POSITIVE CONTROL: access-floor service down is a violation naming the stranding risk", () => {
    const { root, home, effective } = buildCleanFixture();
    const probe: CommandProbe = (command, args) => {
      if (command === "systemctl" && args.includes("snap.amazon-ssm-agent.amazon-ssm-agent")) {
        return { ok: false, stdout: "inactive\n" };
      }
      if (command === "systemctl") {
        return { ok: true, stdout: args.includes("is-active") ? "active\n" : "enabled\n" };
      }
      if (command === "tailscale") {
        return { ok: true, stdout: JSON.stringify({ BackendState: "Running", Self: { HostName: "stationtest" } }) };
      }
      if (command === "sh") return { ok: true, stdout: "/usr/local/bin/aws\n" };
      return { ok: true, stdout: "install ok installed" };
    };
    const result = checkStationTemplate(effective, { rootDir: root, homeDir: home, commandProbe: probe });
    const item = result.items.find((candidate) => candidate.id === "access-floor:snap.amazon-ssm-agent.amazon-ssm-agent");
    expect(item?.status).toBe("violation");
    expect(item?.detail).toContain("access floor");
    expect(result.verdict).toBe("drift");
  });

  test("ec2 end-state: floor healthy, and NO tailscale item exists to be un-joined (2026-07-30 ruling)", () => {
    const { root, home, effective } = buildCleanFixture();
    const probe: CommandProbe = (command, args) => {
      if (command === "systemctl") {
        return { ok: true, stdout: args.includes("is-active") ? "active\n" : "enabled\n" };
      }
      if (command === "sh") return { ok: true, stdout: "/usr/local/bin/aws\n" };
      if (command === "df") {
        return { ok: true, stdout: "Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/root 66060288 4000000 62060288 6% /\n" };
      }
      return { ok: true, stdout: "install ok installed" };
    };
    const result = checkStationTemplate(effective, { rootDir: root, homeDir: home, commandProbe: probe });
    expect(result.items.find((candidate) => candidate.id === "access-floor:snap.amazon-ssm-agent.amazon-ssm-agent")?.status).toBe("ok");
    // A check for a thing we deliberately do not run is noise — an EC2 report
    // must carry no tailscale item in ANY status.
    expect(result.items.filter((candidate) => candidate.kind === "tailscale")).toEqual([]);
    expect(result.verdict).toBe("clean");
  });

  test("setup-steps render: ec2 floor step is first and carries NO tailscale steps; dgx-spark is the inverse", () => {
    const steps = buildStationTemplateSteps(effectiveFor(["ec2"]), { station: "station17" });
    expect(steps[0]!.id).toBe("template-access-floor");
    expect(steps[0]!.command).toContain("NON-FATAL");
    expect(steps.some((step) => step.id.includes("tailscale"))).toBe(false);
    // dgx-spark declares no floor service, and keeps its tailscale steps.
    const physical = buildStationTemplateSteps(effectiveFor(["dgx-spark"]), { station: "station01" });
    expect(physical.some((step) => step.id === "template-access-floor")).toBe(false);
    expect(physical.findIndex((step) => step.id === "template-tailscale-join")).toBeGreaterThan(0);
  });

  test("POSITIVE CONTROL: swap entry on a too-small disk skips loudly, cleans the stale file, and cannot abort boot (station17 build 2)", () => {
    const entries = runcmdEntries(renderCloudInit(effectiveFor(["ec2"]), { station: "stationtest" }));
    const swapEntry = entries.find((entry) => entry.includes("swapon --noheadings"));
    expect(swapEntry).toBeDefined();

    const stubs = mkdtempSync(join(tmpdir(), "station-swap-stubs-"));
    const log = join(stubs, "invocations.log");
    writeFileSync(log, "");
    // No active swap (empty --show), a stale partial file to clean up, and a
    // build-2-sized disk: 364K available on a 6.8G filesystem.
    writeStub(stubs, "swapon", `echo "swapon $*" >> "${log}"`);
    writeStub(stubs, "rm", `echo "rm $*" >> "${log}"`);
    writeStub(
      stubs,
      "df",
      `echo "Filesystem 1024-blocks Used Available Capacity Mounted on"\necho "/dev/root 7096304 7095940 364 100% /"`
    );
    writeStub(stubs, "fallocate", `echo "fallocate $*" >> "${log}"`);
    const result = spawnSync("sh", ["-e", "-c", swapEntry!], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${stubs}:/usr/bin:/bin` },
    });
    // Reachability: the strictest shell semantics cannot abort on this entry.
    expect(result.status).toBe(0);
    // Never silent: the refusal is named, with where to look.
    expect(result.stderr).toContain("swapfile skipped");
    expect(result.stderr).toContain("NON-FATAL");
    const invocations = readFileSync(log, "utf8");
    // The stale partial file (build 2's 4.2G fallocate leftover) is removed...
    expect(invocations).toContain("rm -f /swapfile");
    // ...and allocation is refused rather than re-filling the disk.
    expect(invocations).not.toContain("fallocate");
  });

  test("POSITIVE CONTROL: physical join step survives a vault hiccup, exits 0, and warns", () => {
    // runSetupPlan aborts the whole setup on the first non-zero step — so a
    // vault hiccup during the join must exit 0 or it takes the rest of the
    // provisioning down with it. And it must WARN, or the failure is silent.
    const steps = buildStationTemplateSteps(effectiveFor(["dgx-spark"]), { station: "station01" });
    const joinStep = steps.find((step) => step.id === "template-tailscale-join");
    expect(joinStep).toBeDefined();
    const stubs = mkdtempSync(join(tmpdir(), "station-setup-stubs-"));
    writeStub(stubs, "tailscale", "exit 1"); // not joined, and `up` fails
    writeStub(stubs, "secrets", "exit 1"); // the vault hiccup
    writeStub(stubs, "sudo", 'exec "$@"');
    const result = spawnSync("sh", ["-e", "-c", joinStep!.command], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${stubs}:/usr/bin:/bin` },
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("tailscale join failed");
    expect(result.stderr).toContain("NON-FATAL");
  });
});

describe("no tailscale on AWS stations (owner ruling 2026-07-30 — supersedes the 2026-07-29 non-critical ruling)", () => {
  // One pattern for every absence assertion in this suite, so the positive
  // control below proves the exact instrument the assertions use can go red.
  const TAILSCALE_PATTERN = /tailscale|tailnet|tailscaled|ts-authkey|tskey/i;

  test("the base layer carries no tailscale — the auth-key secret name is structurally unreachable from an EC2 render", () => {
    const { template } = loadStationTemplate("station", { templatesDir: SHIPPED });
    expect(template.base.tailscale).toBeUndefined();
    expect(template.base.services.some((service) => service.name === "tailscaled")).toBe(false);
    expect(template.overlays["ec2"]!.tailscale).toBeUndefined();
    expect(JSON.stringify(template.overlays["ec2"])).not.toContain("authKeySecretName");
  });

  test("ABSENCE: the station,ec2 cloud-init render contains no tailscale install, no join, no auth-key fetch", () => {
    const userData = renderCloudInit(effectiveFor(["ec2"]), { station: "station17" });
    expect(userData).not.toMatch(TAILSCALE_PATTERN);
    // The join was the only Secrets Manager consumer at boot; with it gone,
    // NOTHING on the boot path fetches a secret (the 2026-07-29 lesson, now
    // structural instead of guarded).
    expect(userData).not.toContain("secretsmanager");
  });

  test("ABSENCE: the station,ec2 setup-steps render and drift report carry no tailscale in any status", () => {
    const steps = buildStationTemplateSteps(effectiveFor(["ec2"]), { station: "station17" });
    expect(steps.map((step) => `${step.id} ${step.command}`).join("\n")).not.toMatch(TAILSCALE_PATTERN);
    const { root, home, effective } = buildCleanFixture();
    // Both probe modes — no-probe (skipped items are still noise) AND a live
    // probe (an ok/drift item would be worse). Reviewer finding P3-1: an
    // earlier version iterated [null, undefined] and tested null twice.
    const liveProbe: CommandProbe = (command, args) => {
      if (command === "systemctl") return { ok: true, stdout: args.includes("is-active") ? "active\n" : "enabled\n" };
      if (command === "sh") return { ok: true, stdout: "/usr/local/bin/aws\n" };
      if (command === "df") {
        return { ok: true, stdout: "Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/root 66060288 4000000 62060288 6% /\n" };
      }
      return { ok: true, stdout: "install ok installed" };
    };
    for (const probe of [null, liveProbe]) {
      const result = checkStationTemplate(effective, { rootDir: root, homeDir: home, commandProbe: probe });
      expect(result.items.filter((item) => item.kind === "tailscale")).toEqual([]);
      expect(result.items.filter((item) => item.id.includes("tailscale") || item.id.includes("tailscaled"))).toEqual([]);
    }
  });

  test("POSITIVE CONTROL: tailscale planted into a copied template turns every absence assertion red", () => {
    // An absence assertion that cannot fail is worth nothing (~10 vacuous
    // passes measured on this fleet in one day). Plant tailscale back into a
    // COPY of the shipped template — base first, the realistic regression
    // (uniformity argument re-adding it for everyone) — and prove the same
    // pattern and the same item filters the ABSENCE tests use now detect it.
    const planted = mkdtempSync(join(tmpdir(), "station-template-planted-"));
    cpSync(join(SHIPPED, "station"), join(planted, "station"), { recursive: true });
    const templatePath = join(planted, "station", "template.json");
    const template = JSON.parse(readFileSync(templatePath, "utf8"));
    template.base.tailscale = {
      join: true,
      authKeySecretName: "stations/prod/tailscale/authkey",
      hostnameFromStation: true,
      ssh: true,
    };
    template.base.services.push({ name: "tailscaled", scope: "system", expectEnabled: true, expectActive: true });
    writeFileSync(templatePath, JSON.stringify(template));

    const effective = resolveStationTemplate(["ec2"], { templatesDir: planted });
    const userData = renderCloudInit(effective, { station: "station17" });
    expect(userData).toMatch(TAILSCALE_PATTERN);
    expect(userData).toContain("secretsmanager get-secret-value --secret-id stations/prod/tailscale/authkey");
    const steps = buildStationTemplateSteps(effective, { station: "station17" });
    expect(steps.map((step) => `${step.id} ${step.command}`).join("\n")).toMatch(TAILSCALE_PATTERN);
    const report = checkStationTemplate(effective, { rootDir: mkdtempSync(join(tmpdir(), "planted-root-")), homeDir: mkdtempSync(join(tmpdir(), "planted-home-")), commandProbe: null });
    expect(report.items.filter((item) => item.kind === "tailscale").length).toBeGreaterThan(0);
  });
});

describe("root-volume floor (station17 build 2: 8G swapfile on an 8G AMI-default volume)", () => {
  test("POSITIVE CONTROL: a build-2-sized root filesystem is a violation naming the relaunch", () => {
    const { root, home, effective } = buildCleanFixture();
    const probe: CommandProbe = (command, args) => {
      if (command === "df") {
        // Verbatim shape of build 2: 6.8G filesystem, 364K available.
        return { ok: true, stdout: "Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/root 7096304 7095940 364 100% /\n" };
      }
      if (command === "systemctl") return { ok: true, stdout: args.includes("is-active") ? "active\n" : "enabled\n" };
      if (command === "sh") return { ok: true, stdout: "/usr/local/bin/aws\n" };
      return { ok: true, stdout: "install ok installed" };
    };
    const result = checkStationTemplate(effective, { rootDir: root, homeDir: home, commandProbe: probe });
    const item = result.items.find((candidate) => candidate.id === "disk:root");
    expect(item?.status).toBe("violation");
    expect(item?.detail).toContain("under the 64G floor");
    expect(item?.detail).toContain("relaunch");
    expect(result.verdict).toBe("drift");
  });

  test("a 64G-class root passes at the 90% filesystem-overhead tolerance; unreadable df is skipped, never guessed", () => {
    const { root, home, effective } = buildCleanFixture();
    const okProbe: CommandProbe = (command, args) => {
      if (command === "df") {
        // 62G filesystem on a 64G volume — partitioning/reserved-block overhead.
        return { ok: true, stdout: "Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/root 65011712 4000000 61011712 7% /\n" };
      }
      if (command === "systemctl") return { ok: true, stdout: args.includes("is-active") ? "active\n" : "enabled\n" };
      if (command === "sh") return { ok: true, stdout: "/usr/local/bin/aws\n" };
      return { ok: true, stdout: "install ok installed" };
    };
    const passing = checkStationTemplate(effective, { rootDir: root, homeDir: home, commandProbe: okProbe });
    expect(passing.items.find((candidate) => candidate.id === "disk:root")?.status).toBe("ok");

    const brokenDf: CommandProbe = (command, args) => {
      if (command === "df") return { ok: false, stdout: "" };
      if (command === "systemctl") return { ok: true, stdout: args.includes("is-active") ? "active\n" : "enabled\n" };
      if (command === "sh") return { ok: true, stdout: "/usr/local/bin/aws\n" };
      return { ok: true, stdout: "install ok installed" };
    };
    const skipped = checkStationTemplate(effective, { rootDir: root, homeDir: home, commandProbe: brokenDf });
    expect(skipped.items.find((candidate) => candidate.id === "disk:root")?.status).toBe("skipped");
  });

  test("physical layers declare no disk floor — no disk item for dgx-spark", () => {
    const effective = effectiveFor(["dgx-spark"]);
    expect(effective.disk).toBeUndefined();
    const { root, home } = buildCleanFixture(["dgx-spark"]);
    const result = checkStationTemplate(effectiveFor(["dgx-spark"]), { rootDir: root, homeDir: home, commandProbe: null });
    expect(result.items.filter((item) => item.kind === "disk")).toEqual([]);
  });
});

describe("setup --check targeting", () => {
  function checkEnv() {
    const dir = mkdtempSync(join(tmpdir(), "station-template-cli-"));
    return {
      ...process.env,
      HASNA_MACHINES_MANIFEST_PATH: join(dir, "machines.json"),
      HASNA_MACHINES_DB_PATH: join(dir, "machines.db"),
      HASNA_MACHINES_MACHINE_ID: "control",
    };
  }

  // Generous timeouts: these spawn the real CLI, and the accepted path probes
  // dpkg-query/systemctl for every package and service in the template.
  test("--check refuses another machine instead of reporting the local box under its name", () => {
    const result = runCli(["setup", "--machine", "totally-bogus-machine", "--template", "station", "--check"], checkEnv());
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("--machine totally-bogus-machine");
    expect(result.stderr).toContain("inspects the local box (control)");
    // and it must not have emitted a report that an operator could read as clean
    expect(result.stdout).not.toContain("\"verdict\"");
  }, 60_000);

  test("--check stamps the machine it actually inspected into the JSON", () => {
    const result = runCli(["setup", "--machine", "local", "--template", "station", "--check"], checkEnv());
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.machineId).toBe("control");
    expect(report.schemaId).toBe("hasna.station_template.v1");
  }, 60_000);
});
