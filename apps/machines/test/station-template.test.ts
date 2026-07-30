import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, cpSync } from "node:fs";
import { join, resolve } from "node:path";
import { hostname, tmpdir } from "node:os";
import {
  BASHRC_BLOCK_BEGIN,
  BASHRC_BLOCK_END,
  buildBashrcSpliceCommand,
  buildStationTemplateSteps,
  checkExitCode,
  checkStationTemplate,
  compareVersions,
  defaultTemplatesDir,
  loadStationTemplate,
  parseTemplateSpec,
  renderCloudInit,
  resolveStationTemplate,
  type CommandProbe,
} from "../src/station-template/index.js";
import { sortSystemdDropinNames } from "../src/station-template/check.js";

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
  // Installed EXACTLY AT the declared floor, not comfortably above it. The
  // conforming case is the boundary: a fixture at 9.9.9 would pass a `>` check
  // as happily as a `>=` one and prove nothing about which was written.
  for (const pkg of effective.packages.bun) {
    writeBunGlobal(home, pkg.name, pkg.minVersion ?? "9.9.9");
  }
  writeSwap(root, effective.swap.sizeGb);
  return { root, home, effective };
}

function writeBunGlobal(home: string, name: string, version: string | null) {
  const dir = join(home, ".bun/install/global/node_modules", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify(version === null ? { name } : { name, version }));
}

/**
 * A probe answering as a CONFORMING ec2 station: services up, aws on PATH, and
 * — the part that matters since the 2026-07-30 ruling — no tailscale binary and
 * no tailscaled unit. A catch-all `sh -> /usr/local/bin/aws` would claim every
 * binary on earth resolves, tailscale included, so absence probes must be
 * answered explicitly rather than by falling through.
 */
function conformingEc2Probe(overrides: Record<string, { ok: boolean; stdout: string }> = {}): CommandProbe {
  return (command, args) => {
    const joined = args.join(" ");
    for (const [needle, response] of Object.entries(overrides)) {
      if (`${command} ${joined}`.includes(needle)) return response;
    }
    if (command === "sh") {
      if (joined.includes("tailscale")) return { ok: false, stdout: "" };
      return { ok: true, stdout: "/usr/local/bin/aws\n" };
    }
    if (command === "systemctl" && joined.includes("LoadState")) {
      return { ok: true, stdout: "not-found\n" };
    }
    if (command === "systemctl") {
      return { ok: true, stdout: args.includes("is-active") ? "active\n" : "enabled\n" };
    }
    if (command === "df") {
      return { ok: true, stdout: "Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/root 66060288 4000000 62060288 6% /\n" };
    }
    return { ok: true, stdout: "install ok installed" };
  };
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

  test("base layer ships the non-interactive PATH profile (station17 build 3: SSM automation got 127)", () => {
    const effective = effectiveFor(["ec2"]);
    const pathFile = effective.files.find((file) => file.id === "path-profile");
    expect(pathFile?.target).toBe("/etc/profile.d/99-zz-hasna-station-path.sh");
    expect(pathFile?.content).toContain(".bun/bin");
    expect(pathFile?.content).toContain("/usr/local/bin");
    // Idempotent under repeated sourcing: guarded by case on ":$PATH:".
    expect(pathFile?.content).toContain(':$PATH:');
    // Rendered into cloud-init like every base file.
    const userData = renderCloudInit(effective, { station: "station17" });
    expect(userData).toContain("/etc/profile.d/99-zz-hasna-station-path.sh");
    // And the physical render writes it too.
    const steps = buildStationTemplateSteps(effectiveFor(["dgx-spark"]), { station: "station01" });
    expect(steps.some((step) => step.id === "template-file-path-profile")).toBe(true);
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
    // ...and it reads /proc/swaps directly (review P2-B): a PATH without
    // /usr/sbin made a `swapon`-based guard fail open and delete live swap.
    expect(userData).toContain("grep -q '^/swapfile[[:space:]]' /proc/swaps");
    expect(userData).not.toContain("swapon --noheadings");
    expect(userData).toContain("rm -f /swapfile");
    // 8G swap + 2G headroom = 10485760 KB must be free before allocating.
    expect(userData).toContain("-ge 10485760");
    // An unmeasurable df is named as such, never reported as "insufficient",
    // and nothing is touched in that branch (review P3-A).
    expect(userData).toContain("could not measure free space");
    // fstab append is deduplicated on any whitespace (review P3-B), and
    // failure is loud but non-fatal.
    expect(userData).toContain("grep -q '^/swapfile[[:space:]]' /etc/fstab");
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

  // INVERTED 2026-07-31. The previous version of this test read:
  //
  //   test("bun globals are reported with the version actually on disk", ...)
  //     -> fixture planted at 9.9.9, expect(item.status).toBe("ok")
  //
  // and it was not a stale assertion — it was the version-blind contract,
  // written down and pinned. `package:bun:*` reported ok when the package was
  // present at ANY version, across 12 of the 42 items, so a station carrying a
  // CLI from before a fix was indistinguishable from one updated an hour ago.
  // The version is still REPORTED; it is now also JUDGED, against the floor
  // the template declares.
  test("POSITIVE CONTROL: a bun global BELOW the declared floor is drift, not ok-at-any-version", () => {
    const { root, home, effective } = buildCleanFixture();
    const floor = effective.packages.bun.find((pkg) => pkg.name === "@hasna/todos")!.minVersion!;
    writeBunGlobal(home, "@hasna/todos", "0.0.1");
    const result = checkStationTemplate(effective, { rootDir: root, homeDir: home, commandProbe: null });
    const item = result.items.find((candidate) => candidate.id === "package:bun:@hasna/todos");
    expect(item?.status).toBe("drift");
    expect(item?.detail).toContain("BELOW the declared floor");
    expect(item?.detail).toContain(floor);
    expect(result.verdict).toBe("drift");
  });

  test("a bun global at or above the declared floor is ok, and the version is still named", () => {
    const { root, home, effective } = buildCleanFixture();
    const floor = effective.packages.bun.find((pkg) => pkg.name === "@hasna/todos")!.minVersion!;
    // The clean fixture plants every package exactly AT its floor: >= not >.
    const atFloor = checkStationTemplate(effective, { rootDir: root, homeDir: home, commandProbe: null });
    const atFloorItem = atFloor.items.find((candidate) => candidate.id === "package:bun:@hasna/todos");
    expect(atFloorItem?.status).toBe("ok");
    expect(atFloorItem?.detail).toContain(`@hasna/todos@${floor}`);

    writeBunGlobal(home, "@hasna/todos", "99.0.0");
    const above = checkStationTemplate(effective, { rootDir: root, homeDir: home, commandProbe: null });
    const aboveItem = above.items.find((candidate) => candidate.id === "package:bun:@hasna/todos");
    expect(aboveItem?.status).toBe("ok");
    expect(aboveItem?.detail).toContain("@99.0.0");
  });

  test("POSITIVE CONTROL: an installed package whose version cannot be read is drift, never ok", () => {
    const { root, home, effective } = buildCleanFixture();
    writeBunGlobal(home, "@hasna/todos", null);
    const missing = checkStationTemplate(effective, { rootDir: root, homeDir: home, commandProbe: null });
    expect(missing.items.find((candidate) => candidate.id === "package:bun:@hasna/todos")?.detail).toContain(
      "no readable version"
    );

    // A dist-tag-shaped version is not semver and must not be waved through.
    writeBunGlobal(home, "@hasna/todos", "latest");
    const unparseable = checkStationTemplate(effective, { rootDir: root, homeDir: home, commandProbe: null });
    const item = unparseable.items.find((candidate) => candidate.id === "package:bun:@hasna/todos");
    expect(item?.status).toBe("drift");
    expect(item?.detail).toContain("not readable as semver");
  });

  // THE REGRESSION GUARD. If someone reverts a bun entry to the bare-string
  // form, the check goes back to presence-only for it and every assertion above
  // still passes — they only exercise @hasna/todos. This one fails.
  test("every bun global in the shipped template declares a minVersion floor", () => {
    for (const overlays of [[], ["ec2"], ["dgx-spark"]]) {
      for (const pkg of effectiveFor(overlays).packages.bun) {
        expect({ layers: overlays, pkg: pkg.name, minVersion: pkg.minVersion }).toEqual({
          layers: overlays,
          pkg: pkg.name,
          minVersion: expect.stringMatching(/^\d+\.\d+\.\d+$/),
        });
      }
    }
  });

  test("prerelease sorts below the release it precedes, and build metadata is ignored", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("1.2.3-rc.1", "1.2.3")!).toBeLessThan(0);
    expect(compareVersions("1.2.3+build.7", "1.2.3")).toBe(0);
    expect(compareVersions("1.10.0", "1.9.0")!).toBeGreaterThan(0);
    expect(compareVersions("nightly", "1.0.0")).toBeNull();
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
        expect(result.items.find((candidate) => candidate.id === `package:bun:${pkg.name}`)?.status).toBe("drift");
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

  test("drop-ins use systemd's lexicographic order when later assignments restore compliance", () => {
    // This assertion is independent of how the test filesystem happens to
    // enumerate entries, and fails if the production ordering step is lost.
    expect(sortSystemdDropinNames(["90-restore.conf", "README", "10-lower.conf"])).toEqual([
      "10-lower.conf",
      "90-restore.conf",
    ]);

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

  // REWRITTEN 2026-07-31. The previous version of this test asserted the ec2
  // report carried NO tailscale item in any status, and called that the end
  // state of the 2026-07-30 ruling — with a probe that answered "yes, it
  // resolves" to every `sh -c command -v` and "active/enabled" to every
  // systemctl. That combination is a box with a live tailscale, and the test
  // asserted verdict clean. It was not wrong about `tailscale:join` being
  // noise; it was wrong that removing the check discharged the ruling. Measured
  // consequence, 2026-07-30 22:02Z: `tailscale_items=[]` on an ec2 render, and
  // station18 with BackendState=Running reading clean 42/42.
  test("ec2 end-state: floor healthy, NO tailscale:join item, and tailscale's ABSENCE asserted", () => {
    const { root, home, effective } = buildCleanFixture();
    const result = checkStationTemplate(effective, { rootDir: root, homeDir: home, commandProbe: conformingEc2Probe() });
    expect(result.items.find((candidate) => candidate.id === "access-floor:snap.amazon-ssm-agent.amazon-ssm-agent")?.status).toBe("ok");
    // Still no tailnet-health item: asking whether the tailnet is healthy on a
    // box that must not have one is noise, and noise is how real drift gets
    // ignored.
    expect(result.items.filter((candidate) => candidate.kind === "tailscale")).toEqual([]);
    // But the absence is now a claim the report actually makes.
    const absence = result.items.find((candidate) => candidate.id === "absence:tailscale");
    expect(absence?.status).toBe("ok");
    expect(absence?.detail).toContain("absent as declared");
    expect(result.verdict).toBe("clean");
  });

  test("POSITIVE CONTROL: a LIVE tailscale on an ec2 station is caught — the station18 case that read clean 42/42", () => {
    const { root, home, effective } = buildCleanFixture();
    // Exactly station18 on 2026-07-30: daemon loaded and running, binary on
    // PATH, backend Running. Under the old check this produced no item at all.
    const probe = conformingEc2Probe({
      "sh -c command -v -- tailscale": { ok: true, stdout: "/usr/bin/tailscale\n" },
      "systemctl show -p LoadState --value tailscaled": { ok: true, stdout: "loaded\n" },
    });
    const result = checkStationTemplate(effective, { rootDir: root, homeDir: home, commandProbe: probe });
    const absence = result.items.find((candidate) => candidate.id === "absence:tailscale");
    expect(absence?.status).toBe("violation");
    expect(absence?.detail).toContain("/usr/bin/tailscale");
    expect(absence?.detail).toContain("LoadState=loaded");
    expect(result.verdict).toBe("drift");
    expect(checkExitCode(result)).toBe(1);
  });

  test("POSITIVE CONTROL: leftover tailscale STATE on disk is caught with no probe at all", () => {
    const { root, home, effective } = buildCleanFixture();
    // An uninstalled-but-not-purged tailscale leaves /var/lib/tailscale with
    // the node key in it. The daemon is gone; the box is still enrolled.
    mkdirSync(join(root, "var/lib/tailscale"), { recursive: true });
    const result = checkStationTemplate(effective, { rootDir: root, homeDir: home, commandProbe: conformingEc2Probe() });
    const absence = result.items.find((candidate) => candidate.id === "absence:tailscale");
    expect(absence?.status).toBe("violation");
    expect(absence?.detail).toContain("/var/lib/tailscale exists");
    expect(result.verdict).toBe("drift");
  });

  test("an absence whose command/service could not be probed is skipped, NEVER ok", () => {
    // The vacuous shape this item exists to end: with no probe we checked the
    // paths and nothing else, so we have not earned "absent".
    const { root, home, effective } = buildCleanFixture();
    const result = checkStationTemplate(effective, { rootDir: root, homeDir: home, commandProbe: null });
    const absence = result.items.find((candidate) => candidate.id === "absence:tailscale");
    expect(absence?.status).toBe("skipped");
    expect(absence?.detail).toContain("could not be probed");
    // Not a finding — but not a pass either: the check did not complete.
    expect(result.verdict).toBe("clean");
    expect(checkExitCode(result)).toBe(2);
  });

  test("physical stations that legitimately run tailscale are untouched by the ec2 absence", () => {
    const { root, home, effective } = buildCleanFixture(["dgx-spark"]);
    const probe: CommandProbe = (command, args) => {
      if (command === "tailscale") {
        return { ok: true, stdout: JSON.stringify({ BackendState: "Running", Self: { HostName: "station01" } }) };
      }
      if (command === "systemctl") return { ok: true, stdout: args.includes("is-active") ? "active\n" : "enabled\n" };
      if (command === "sh") return { ok: true, stdout: "/usr/local/bin/aws\n" };
      return { ok: true, stdout: "install ok installed" };
    };
    const result = checkStationTemplate(effective, { rootDir: root, homeDir: home, commandProbe: probe });
    // A running tailscale is CORRECT here: no absence item, and join is ok.
    expect(result.items.filter((candidate) => candidate.kind === "absence")).toEqual([]);
    expect(result.items.find((candidate) => candidate.id === "tailscale:join")?.status).toBe("ok");
    expect(result.verdict).toBe("clean");
  });

  test("a layer set that both requires and forbids tailscale fails to load, rather than reporting both", () => {
    // Reachable today: `--template station,dgx-spark,ec2`. The ruling's future
    // exception — one AWS box granted tailscale — has to be argued for in its
    // own overlay, and this is what makes "argued for" mean something.
    expect(() => effectiveFor(["dgx-spark", "ec2"])).toThrow(/absence "tailscale" while also requiring it/);
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

  /**
   * The rendered swap entry, with only its literal `/proc/swaps` redirected
   * to a fixture file so the scenario does not depend on the host's swap
   * state. Everything else — quoting, case/if structure, guards — is the
   * exact rendered text.
   */
  function swapEntryWithSwapsFixture(swapsContent: string): { entry: string; stubs: string; log: string } {
    const entries = runcmdEntries(renderCloudInit(effectiveFor(["ec2"]), { station: "stationtest" }));
    const rendered = entries.find((entry) => entry.includes("/proc/swaps"));
    expect(rendered).toBeDefined();
    const stubs = mkdtempSync(join(tmpdir(), "station-swap-stubs-"));
    const swapsPath = join(stubs, "proc-swaps");
    writeFileSync(swapsPath, swapsContent);
    const log = join(stubs, "invocations.log");
    writeFileSync(log, "");
    writeStub(stubs, "rm", `echo "rm $*" >> "${log}"`);
    writeStub(stubs, "fallocate", `echo "fallocate $*" >> "${log}"`);
    writeStub(stubs, "swapon", `echo "swapon $*" >> "${log}"`);
    return { entry: rendered!.replaceAll("/proc/swaps", swapsPath), stubs, log };
  }

  test("POSITIVE CONTROL: swap entry on a too-small disk skips loudly, cleans the stale file, and cannot abort boot (station17 build 2)", () => {
    // Swap active under ANOTHER name, a stale partial /swapfile, and a
    // build-2-sized disk: 364K available on a 6.8G filesystem.
    const { entry, stubs, log } = swapEntryWithSwapsFixture(
      "Filename\tType\tSize\tUsed\tPriority\n/swap.img file 4189180 0 -2\n"
    );
    writeStub(
      stubs,
      "df",
      `echo "Filesystem 1024-blocks Used Available Capacity Mounted on"\necho "/dev/root 7096304 7095940 364 100% /"`
    );
    const result = spawnSync("sh", ["-e", "-c", entry], {
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

  test("POSITIVE CONTROL: unmeasurable df touches NOTHING and says so (review P3-A), still exit 0", () => {
    const { entry, stubs, log } = swapEntryWithSwapsFixture("Filename\tType\tSize\tUsed\tPriority\n");
    writeStub(stubs, "df", "exit 1");
    const result = spawnSync("sh", ["-e", "-c", entry], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${stubs}:/usr/bin:/bin` },
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("could not measure free space");
    // The old shape removed /swapfile before discovering it could not
    // measure; now nothing at all is touched.
    expect(readFileSync(log, "utf8")).toBe("");
  });

  test("REGRESSION (review P2-B): active /swapfile is a no-op even on a PATH without /usr/sbin", () => {
    // The old guard resolved `swapon` from PATH; a login shell without
    // /usr/sbin failed it open, deleted the LIVE swapfile, and re-allocated
    // 8G against a kernel-held unlinked inode. The /proc/swaps guard needs no
    // binary beyond grep: with /swapfile active, nothing runs at all.
    const { entry, stubs, log } = swapEntryWithSwapsFixture(
      "Filename\tType\tSize\tUsed\tPriority\n/swapfile file 8388604 0 -2\n"
    );
    writeStub(stubs, "df", `echo "should never be called" >> "${log}"\nexit 1`);
    const result = spawnSync("sh", ["-e", "-c", entry], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${stubs}:/usr/bin:/bin` }, // no /usr/sbin, no /sbin
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(readFileSync(log, "utf8")).toBe("");
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

  test("SCHEMA GUARANTEE (review P3-D): a base-layer tailscale plant is refused at load time", () => {
    // The realistic regression is someone re-adding tailscale to base for
    // uniformity. That is no longer merely caught by the render assertions —
    // the schema refuses to load such a template at all, which is what makes
    // "structurally unreachable from an EC2 render" a true statement.
    for (const plant of ["tailscale", "tailscaled-service"] as const) {
      const planted = mkdtempSync(join(tmpdir(), "station-template-baseplant-"));
      cpSync(join(SHIPPED, "station"), join(planted, "station"), { recursive: true });
      const templatePath = join(planted, "station", "template.json");
      const template = JSON.parse(readFileSync(templatePath, "utf8"));
      if (plant === "tailscale") {
        template.base.tailscale = { join: true, authKeySecretName: "stations/prod/tailscale/authkey" };
      } else {
        template.base.services.push({ name: "tailscaled", scope: "system", expectEnabled: true, expectActive: true });
      }
      writeFileSync(templatePath, JSON.stringify(template));
      expect(() => resolveStationTemplate(["ec2"], { templatesDir: planted })).toThrow(/owner ruling 2026-07-30/);
    }
  });

  test("POSITIVE CONTROL: tailscale planted into a copied template turns every absence assertion red", () => {
    // An absence assertion that cannot fail is worth nothing (~10 vacuous
    // passes measured on this fleet in one day). A base-layer plant is now
    // refused by the schema (previous test), so plant into the ec2 OVERLAY —
    // the deliberate-opt-in path that remains schema-legal — and prove the
    // same pattern and the same item filters the ABSENCE tests use detect it.
    const planted = mkdtempSync(join(tmpdir(), "station-template-planted-"));
    cpSync(join(SHIPPED, "station"), join(planted, "station"), { recursive: true });
    const templatePath = join(planted, "station", "template.json");
    const template = JSON.parse(readFileSync(templatePath, "utf8"));
    template.overlays.ec2.tailscale = {
      join: true,
      authKeySecretName: "stations/prod/tailscale/authkey",
      hostnameFromStation: true,
      ssh: true,
    };
    template.overlays.ec2.services = [
      ...(template.overlays.ec2.services ?? []),
      { name: "tailscaled", scope: "system", expectEnabled: true, expectActive: true },
    ];
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

  // WAS `expect(result.status).toBe(0)`. That assertion held for the same
  // reason defect 2bfe61b0 held: `--check` exited 0 no matter what it found, so
  // a test could assert 0 while running on a box that is not a station at all.
  // The exit code is now the verdict, so the test asserts the CONTRACT rather
  // than a constant.
  test("--check stamps the machine it actually inspected into the JSON, and its rc matches the report", () => {
    const result = runCli(["setup", "--machine", "local", "--template", "station", "--check"], checkEnv());
    const report = JSON.parse(result.stdout);
    expect(report.machineId).toBe("control");
    expect(report.schemaId).toBe("hasna.station_template.v1");
    const findings = report.items.filter((item: { status: string }) => item.status === "drift" || item.status === "violation");
    const skipped = report.items.filter((item: { status: string }) => item.status === "skipped");
    expect(result.status).toBe(findings.length > 0 ? 1 : skipped.length > 0 ? 2 : 0);
  }, 60_000);
});

/**
 * The exit-code contract, end to end through the real CLI process.
 *
 * Driven by a purpose-built template rather than the shipped one so all three
 * codes are reachable deterministically: run against `station` on whatever box
 * CI happens to be, the answer depends on that box.
 */
describe("setup --check exit codes (0 clean / 1 findings / 2 incomplete)", () => {
  function exitCodeFixture(template: Record<string, unknown>) {
    const dir = mkdtempSync(join(tmpdir(), "station-template-rc-"));
    mkdirSync(join(dir, "templates", "station"), { recursive: true });
    writeFileSync(
      join(dir, "templates", "station", "template.json"),
      JSON.stringify({
        $schema: "hasna.station_template.v1",
        name: "station",
        version: "1.0.0",
        description: "exit-code contract fixture",
        ...template,
      })
    );
    const home = join(dir, "home");
    mkdirSync(home, { recursive: true });
    return {
      home,
      env: {
        ...process.env,
        HOME: home,
        BUN_INSTALL: join(home, ".bun"),
        HASNA_MACHINES_TEMPLATES_DIR: join(dir, "templates"),
        HASNA_MACHINES_MANIFEST_PATH: join(dir, "machines.json"),
        HASNA_MACHINES_DB_PATH: join(dir, "machines.db"),
        HASNA_MACHINES_MACHINE_ID: "control",
      } as NodeJS.ProcessEnv,
    };
  }

  const ONE_PACKAGE = { base: { packages: { apt: [], bun: [{ name: "rc-fixture-pkg", minVersion: "2.0.0" }] } } };

  test("conforming box exits 0", () => {
    const { home, env } = exitCodeFixture(ONE_PACKAGE);
    writeBunGlobal(home, "rc-fixture-pkg", "2.0.0");
    const result = runCli(["setup", "--template", "station", "--check"], env);
    expect(JSON.parse(result.stdout).verdict).toBe("clean");
    expect(result.status).toBe(0);
  }, 60_000);

  test("POSITIVE CONTROL: deviant box exits 1 — the gate that could not fail (defect 2bfe61b0)", () => {
    const { home, env } = exitCodeFixture(ONE_PACKAGE);
    writeBunGlobal(home, "rc-fixture-pkg", "1.0.0");
    const result = runCli(["setup", "--template", "station", "--check"], env);
    expect(JSON.parse(result.stdout).verdict).toBe("drift");
    expect(result.status).toBe(1);
  }, 60_000);

  test("a check that could not complete exits 2, not 0 — 'could not look' is not 'clean'", () => {
    const { home, env } = exitCodeFixture({
      base: {
        packages: ONE_PACKAGE.base.packages,
        // No such knob on any kernel: the item can only be `skipped`.
        sysctls: { "vm.hasna_rc_fixture_no_such_knob": "1" },
      },
    });
    writeBunGlobal(home, "rc-fixture-pkg", "2.0.0");
    const result = runCli(["setup", "--template", "station", "--check"], env);
    const report = JSON.parse(result.stdout);
    expect(report.verdict).toBe("clean");
    expect(report.items.some((item: { status: string }) => item.status === "skipped")).toBe(true);
    expect(result.status).toBe(2);
  }, 60_000);

  test("findings outrank incompleteness: a drifted AND incomplete check exits 1", () => {
    const { home, env } = exitCodeFixture({
      base: {
        packages: ONE_PACKAGE.base.packages,
        sysctls: { "vm.hasna_rc_fixture_no_such_knob": "1" },
      },
    });
    writeBunGlobal(home, "rc-fixture-pkg", "1.0.0");
    const result = runCli(["setup", "--template", "station", "--check"], env);
    expect(result.status).toBe(1);
  }, 60_000);

  test("--no-fail-on-findings restores the pre-0.3.0 always-0 behaviour for callers not ready to move", () => {
    const { home, env } = exitCodeFixture(ONE_PACKAGE);
    writeBunGlobal(home, "rc-fixture-pkg", "1.0.0");
    const result = runCli(["setup", "--template", "station", "--check", "--no-fail-on-findings"], env);
    // The report still says drift — the opt-out silences the rc, not the truth.
    expect(JSON.parse(result.stdout).verdict).toBe("drift");
    expect(result.status).toBe(0);
  }, 60_000);

  test("the report is still emitted in full when the rc is non-zero", () => {
    const { home, env } = exitCodeFixture(ONE_PACKAGE);
    writeBunGlobal(home, "rc-fixture-pkg", "1.0.0");
    const result = runCli(["setup", "--template", "station", "--check"], env);
    // process.exitCode, not process.exit(): a gate that fails without saying
    // what it found is only marginally better than one that cannot fail.
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).items[0].detail).toContain("BELOW the declared floor");
  }, 60_000);
});

describe("bashrc-block (station17 2026-07-30: ssh/mosh remote commands found no bun CLIs)", () => {
  // Ubuntu's stock ~/.bashrc shape: the early-return guard, then user content.
  const STOCK_BASHRC = [
    "# ~/.bashrc: executed by bash(1) for non-login shells.",
    "",
    "# If not running interactively, don't do anything",
    "case $- in",
    "    *i*) ;;",
    "      *) return;;",
    "esac",
    "",
    "alias ll='ls -l'",
    "",
  ].join("\n");

  function shippedBlock() {
    const file = effectiveFor(["ec2"]).files.find((candidate) => candidate.id === "bashrc-noninteractive-path");
    expect(file).toBeDefined();
    return file!;
  }

  test("base layer ships the ~/.bashrc block, marker-delimited, with both PATH entries", () => {
    const file = shippedBlock();
    expect(file.kind).toBe("bashrc-block");
    expect(file.target).toBe("~/.bashrc");
    expect(file.content.startsWith(BASHRC_BLOCK_BEGIN)).toBe(true);
    expect(file.content.trimEnd().endsWith(BASHRC_BLOCK_END)).toBe(true);
    expect(file.content).toContain(".bun/bin");
    expect(file.content).toContain(".local/bin");
    // Idempotent under repeated sourcing, same as the profile.d file.
    expect(file.content).toContain(':$PATH:');
  });

  test("physical render splices the block — it never whole-file writes ~/.bashrc", () => {
    const steps = buildStationTemplateSteps(effectiveFor(["ec2"]), { station: "station18" });
    const step = steps.find((candidate) => candidate.id === "template-file-bashrc-noninteractive-path");
    expect(step).toBeDefined();
    expect(step?.command).toContain(BASHRC_BLOCK_BEGIN);
    expect(step?.command).toContain("mktemp");
    // Runs as the login user — a sudo'd splice would write a root-owned bashrc.
    expect(step?.privileged).not.toBe(true);
    // The whole-file writer always chmods its target; the splice must not go
    // through that path for ~/.bashrc.
    const wholeFileWrites = steps.filter((candidate) => candidate.command.includes(`chmod 0644 "$HOME"/'.bashrc'`));
    expect(wholeFileWrites).toEqual([]);
  });

  test("cloud-init render keeps ~/.bashrc out of write_files and splices via runuser", () => {
    const file = shippedBlock();
    const userData = renderCloudInit(effectiveFor(["ec2"]), { station: "station18" });
    // A write_files entry would clobber the stock bashrc wholesale.
    expect(userData).not.toContain("path: /home/hasna/.bashrc");
    // The block content rides base64-encoded INSIDE the runuser splice line —
    // never as a write_files payload, and never as a literal newline that
    // would break the runcmd YAML scalar.
    const b64 = Buffer.from(file.content, "utf8").toString("base64");
    const carrier = userData.split("\n").filter((line) => line.includes(b64));
    expect(carrier.length).toBe(1);
    expect(carrier[0]).toContain("runuser -l hasna -c");
    expect(carrier[0]).toContain("base64 -d");
  });

  test("FUNCTIONAL: splice lands ABOVE the guard, is idempotent, heals drift, and prepends when no guard exists", () => {
    const file = shippedBlock();
    const command = buildBashrcSpliceCommand(file.target, file.content);
    const home = mkdtempSync(join(tmpdir(), "bashrc-splice-"));
    writeFileSync(join(home, ".bashrc"), STOCK_BASHRC);
    const run = () => spawnSync("bash", ["-c", command], { encoding: "utf8", env: { ...process.env, HOME: home } });

    let result = run();
    expect(result.status).toBe(0);
    const once = readFileSync(join(home, ".bashrc"), "utf8");
    expect(once).toContain(file.content);
    // ABOVE the guard — the entire point: non-interactive shells return at the
    // guard, so a block below it is dead code.
    expect(once.indexOf(BASHRC_BLOCK_BEGIN)).toBeLessThan(once.indexOf("# If not running interactively"));
    // The stock file survives around it.
    expect(once).toContain("alias ll='ls -l'");
    expect(once).toContain("*) return;;");

    // Idempotent: a second run changes nothing and never duplicates.
    result = run();
    expect(result.status).toBe(0);
    const twice = readFileSync(join(home, ".bashrc"), "utf8");
    expect(twice).toBe(once);
    expect(twice.split(BASHRC_BLOCK_BEGIN).length - 1).toBe(1);

    // Heals drift: hand-edits inside the markers are replaced on re-converge.
    writeFileSync(join(home, ".bashrc"), once.replace(".bun/bin", ".corrupted/bin"));
    result = run();
    expect(result.status).toBe(0);
    expect(readFileSync(join(home, ".bashrc"), "utf8")).toBe(once);

    // REGRESSION (review P1): an orphan BEGIN marker — a hand-edit deleted
    // the END line — must NOT turn the next converge into silent truncation
    // of everything below it. The strip buffers and restores when no END
    // closes the block.
    const orphanHome = mkdtempSync(join(tmpdir(), "bashrc-orphan-"));
    const orphanBashrc = [
      BASHRC_BLOCK_BEGIN,
      'export PATH="$HOME/.stale/bin:$PATH"',
      STOCK_BASHRC,
    ].join("\n");
    writeFileSync(join(orphanHome, ".bashrc"), orphanBashrc);
    result = spawnSync("bash", ["-c", command], { encoding: "utf8", env: { ...process.env, HOME: orphanHome } });
    expect(result.status).toBe(0);
    const healed = readFileSync(join(orphanHome, ".bashrc"), "utf8");
    // User content and the guard survive.
    expect(healed).toContain("alias ll='ls -l'");
    expect(healed).toContain("*) return;;");
    // A managed block is present above the guard.
    expect(healed).toContain(file.content);
    expect(healed.indexOf(file.content)).toBeLessThan(healed.indexOf("# If not running interactively"));

    // No guard anywhere: the block is prepended, not appended.
    const homeNoGuard = mkdtempSync(join(tmpdir(), "bashrc-noguard-"));
    writeFileSync(join(homeNoGuard, ".bashrc"), "alias x=1\n");
    result = spawnSync("bash", ["-c", command], { encoding: "utf8", env: { ...process.env, HOME: homeNoGuard } });
    expect(result.status).toBe(0);
    const noGuard = readFileSync(join(homeNoGuard, ".bashrc"), "utf8");
    expect(noGuard.startsWith(file.content)).toBe(true);
    expect(noGuard).toContain("alias x=1");
  });

  test("POSITIVE CONTROL: missing block is drift; block AFTER the guard is a violation; above it is ok", () => {
    const { root, home, effective } = buildCleanFixture();
    const file = shippedBlock();

    writeFileSync(join(home, ".bashrc"), STOCK_BASHRC);
    let result = checkStationTemplate(effective, { rootDir: root, homeDir: home, commandProbe: null });
    let item = result.items.find((candidate) => candidate.id === "file:bashrc-noninteractive-path");
    expect(item?.status).toBe("drift");
    expect(item?.detail).toContain("missing");

    // Present but AFTER the guard — dead code for the shells it serves, and it
    // is a violation (wrong position), never mere drift.
    writeFileSync(join(home, ".bashrc"), `${STOCK_BASHRC}\n${file.content}`);
    result = checkStationTemplate(effective, { rootDir: root, homeDir: home, commandProbe: null });
    item = result.items.find((candidate) => candidate.id === "file:bashrc-noninteractive-path");
    expect(item?.status).toBe("violation");
    expect(item?.detail).toContain("AFTER the interactive guard");

    writeFileSync(join(home, ".bashrc"), `${file.content}\n${STOCK_BASHRC}`);
    result = checkStationTemplate(effective, { rootDir: root, homeDir: home, commandProbe: null });
    item = result.items.find((candidate) => candidate.id === "file:bashrc-noninteractive-path");
    expect(item?.status).toBe("ok");
  });

  test("bashrc-block content without both markers is rejected at load", () => {
    const dir = mkdtempSync(join(tmpdir(), "station-template-badblock-"));
    cpSync(join(SHIPPED, "station"), join(dir, "station"), { recursive: true });
    writeFileSync(join(dir, "station", "files/base/home/bashrc-block-noninteractive-path.sh"), 'export PATH="$HOME/.bun/bin:$PATH"\n');
    expect(() => resolveStationTemplate([], { templatesDir: dir })).toThrow(/marker/);
  });

  test("bashrc-block with a non-home target is rejected at load", () => {
    const dir = mkdtempSync(join(tmpdir(), "station-template-badtarget-"));
    cpSync(join(SHIPPED, "station"), join(dir, "station"), { recursive: true });
    const templatePath = join(dir, "station", "template.json");
    const template = JSON.parse(readFileSync(templatePath, "utf8"));
    const entry = template.base.files.find((candidate: { id: string }) => candidate.id === "bashrc-noninteractive-path");
    entry.target = "/etc/bash.bashrc";
    writeFileSync(templatePath, JSON.stringify(template));
    expect(() => resolveStationTemplate([], { templatesDir: dir })).toThrow(/home-relative/);
  });
});

describe("journald cap (template 1.6.0)", () => {
  test("base layer ships the journal size cap as an ordering-safe drop-in", () => {
    const effective = effectiveFor(["ec2"]);
    const file = effective.files.find((candidate) => candidate.id === "journald-cap");
    expect(file?.kind).toBe("journald-dropin");
    expect(file?.target).toBe("/etc/systemd/journald.conf.d/99-zz-hasna-station.conf");
    expect(file?.content).toContain("SystemMaxUse=2G");
    expect(file?.content).toContain("SystemKeepFree=8G");
    // The physical class gets the same cap — journald is journald on 121G too.
    expect(effectiveFor(["dgx-spark"]).files.some((candidate) => candidate.id === "journald-cap")).toBe(true);
  });

  test("ordering rule: journald drop-in without the 99-zz- prefix is rejected at load", () => {
    const dir = mkdtempSync(join(tmpdir(), "station-template-journald-ordering-"));
    cpSync(join(SHIPPED, "station"), join(dir, "station"), { recursive: true });
    const templatePath = join(dir, "station", "template.json");
    const template = JSON.parse(readFileSync(templatePath, "utf8"));
    const entry = template.base.files.find((candidate: { id: string }) => candidate.id === "journald-cap");
    entry.target = "/etc/systemd/journald.conf.d/50-hasna-station.conf";
    writeFileSync(templatePath, JSON.stringify(template));
    expect(() => resolveStationTemplate([], { templatesDir: dir })).toThrow(/99-zz-/);
  });

  test("cloud-init render writes the drop-in and restarts journald (config is read only at start)", () => {
    const userData = renderCloudInit(effectiveFor(["ec2"]), { station: "station17" });
    expect(userData).toContain("/etc/systemd/journald.conf.d/99-zz-hasna-station.conf");
    expect(userData).toContain("systemctl restart systemd-journald");
  });

  test("physical render restarts journald AFTER writing the drop-in", () => {
    const steps = buildStationTemplateSteps(effectiveFor(["dgx-spark"]), { station: "station01" });
    const writeIndex = steps.findIndex((step) => step.id === "template-file-journald-cap");
    const restartIndex = steps.findIndex((step) => step.id === "template-journald-restart");
    expect(writeIndex).toBeGreaterThanOrEqual(0);
    expect(restartIndex).toBeGreaterThan(writeIndex);
    expect(steps[restartIndex]!.command).toContain("systemctl restart systemd-journald");
  });

  test("clean fixture reports the byte item AND both semantic directive items ok", () => {
    const { root, home, effective } = buildCleanFixture();
    const result = checkStationTemplate(effective, { rootDir: root, homeDir: home, commandProbe: null });
    expect(result.items.find((candidate) => candidate.id === "file:journald-cap")?.status).toBe("ok");
    expect(result.items.find((candidate) => candidate.id === "journald:SystemMaxUse")?.status).toBe("ok");
    expect(result.items.find((candidate) => candidate.id === "journald:SystemKeepFree")?.status).toBe("ok");
  });

  test("POSITIVE CONTROL: a later-sorting override defeats the cap and is NAMED while the byte check still reads ok", () => {
    const { root, home, effective } = buildCleanFixture();
    // The vacuous-pass shape this check exists to kill: OUR drop-in is intact
    // byte for byte, but a file sorting after it wins the systemd merge.
    writeFileSync(join(root, "etc/systemd/journald.conf.d/zz-zz-override.conf"), "[Journal]\nSystemMaxUse=8G\n");
    const result = checkStationTemplate(effective, { rootDir: root, homeDir: home, commandProbe: null });
    expect(result.verdict).toBe("drift");
    expect(result.items.find((candidate) => candidate.id === "file:journald-cap")?.status).toBe("ok");
    const item = result.items.find((candidate) => candidate.id === "journald:SystemMaxUse");
    expect(item?.status).toBe("drift");
    expect(item?.detail).toContain("expected 2G");
    expect(item?.detail).toContain("8G");
    // And the untouched directive stays ok — the check names the axis, not the file.
    expect(result.items.find((candidate) => candidate.id === "journald:SystemKeepFree")?.status).toBe("ok");
  });

  test("stock journald.conf does NOT defeat the drop-in — drop-ins win the merge", () => {
    const { root, home, effective } = buildCleanFixture();
    mkdirSync(join(root, "etc/systemd"), { recursive: true });
    writeFileSync(join(root, "etc/systemd/journald.conf"), "[Journal]\nSystemMaxUse=9G\n");
    const result = checkStationTemplate(effective, { rootDir: root, homeDir: home, commandProbe: null });
    expect(result.items.find((candidate) => candidate.id === "journald:SystemMaxUse")?.status).toBe("ok");
  });

  test("POSITIVE CONTROL: the station17/18 as-found state (no drop-in at all) is drift on BOTH layers", () => {
    const { root, home, effective } = buildCleanFixture();
    rmSync(join(root, "etc/systemd/journald.conf.d"), { recursive: true, force: true });
    const result = checkStationTemplate(effective, { rootDir: root, homeDir: home, commandProbe: null });
    expect(result.verdict).toBe("drift");
    expect(result.items.find((candidate) => candidate.id === "file:journald-cap")?.status).toBe("drift");
    const item = result.items.find((candidate) => candidate.id === "journald:SystemMaxUse");
    expect(item?.status).toBe("drift");
    expect(item?.detail).toContain("unset");
  });

  test("a directive commented out in our drop-in is not asserted", () => {
    // declaredDirectiveNames must skip comments: only real assignments in the
    // [Journal] section become semantic items.
    const shipped = effectiveFor([]).files.find((candidate) => candidate.id === "journald-cap");
    expect(shipped).toBeDefined();
    const { root, home, effective } = buildCleanFixture();
    const result = checkStationTemplate(effective, { rootDir: root, homeDir: home, commandProbe: null });
    const journaldItems = result.items.filter((candidate) => candidate.kind === "journald");
    expect(journaldItems.map((candidate) => candidate.id).sort()).toEqual(["journald:SystemKeepFree", "journald:SystemMaxUse"]);
  });
});
