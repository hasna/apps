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

/** Build a fixture root that matches the ec2-rendered template exactly. */
function buildCleanFixture() {
  const root = mkdtempSync(join(tmpdir(), "station-template-check-"));
  const home = join(root, "home", "hasna");
  const effective = effectiveFor(["ec2"]);
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
    expect(effective.swap.sizeGb).toBe(0);
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
    // secret NAMES are allowed; secret VALUES have no path into a render
    expect(commands).toContain("stations/prod/tailscale/authkey");
    expect(commands).not.toContain("tskey-");
  });
});

describe("cloud-init render", () => {
  test("renders user-data from the same source with station identity", () => {
    const effective = effectiveFor(["ec2"]);
    const userData = renderCloudInit(effective, { station: "station17" });
    expect(userData.startsWith("#cloud-config")).toBe(true);
    expect(userData).toContain("hostname: station17");
    expect(userData).toContain("- earlyoom");
    expect(userData).toContain("--hostname station17");
    expect(userData).toContain("swapon /swapfile");
    // write_files carries the sysctl content base64-encoded
    const sysctl = effective.files.find((file) => file.kind === "sysctl")!;
    expect(userData).toContain(Buffer.from(sysctl.content, "utf8").toString("base64"));
    // secret is referenced by NAME through Secrets Manager, value never rendered
    expect(userData).toContain("secretsmanager get-secret-value --secret-id stations/prod/tailscale/authkey");
    expect(userData).not.toContain("tskey-");
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

  test("POSITIVE CONTROL: tailscaled active+enabled but logged out is drift, not ok (station17)", () => {
    const { root, home, effective } = buildCleanFixture();
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

  test("tailscale join reports ok only when the backend is actually Running", () => {
    const { root, home, effective } = buildCleanFixture();
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

  test("drop-ins use systemd's lexicographic order when later assignments restore compliance", () => {
    const { root, home, effective } = buildCleanFixture();
    const unitDir = join(home, ".config/systemd/user");
    const dropinDir = join(unitDir, "hasna-dropin-order.service.d");
    mkdirSync(dropinDir, { recursive: true });
    writeFileSync(
      join(unitDir, "hasna-dropin-order.service"),
      "[Unit]\nStartLimitIntervalSec=300\nStartLimitBurst=5\nOnFailure=hasna-unit-failure-notify@%n.service\n[Service]\nExecStart=/bin/true\n"
    );
    // Create these opposite to their systemd order. The 10- drop-in makes the
    // unit noncompliant, then the lexicographically later 90- drop-in fixes it.
    // Reading them in creation/readdir order would reverse the verdict.
    writeFileSync(join(dropinDir, "90-restore.conf"), "[Unit]\nStartLimitIntervalSec=300\n");
    writeFileSync(join(dropinDir, "10-lower.conf"), "[Unit]\nStartLimitIntervalSec=10\n");

    const result = checkStationTemplate(effective, { rootDir: root, homeDir: home, commandProbe: null });
    expect(result.items.find((candidate) => candidate.id === "unit:hasna-dropin-order.service")?.status).toBe("ok");
    expect(result.verdict).toBe("clean");
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
