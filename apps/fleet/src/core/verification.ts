import { createHash, randomUUID } from "node:crypto";
import { assertNoNumeratorKeys } from "./fraction";
import type {
  FleetSource,
  FleetVerificationInput,
  FleetVerificationResult,
  HostObservation,
  PositiveControl,
  ProbeObservation,
} from "./types";

export const DEFAULT_REQUIRED_SOURCES = ["manifest", "aws-ec2", "tailscale"] as const;
export const CORPUS_AXES = [
  "inventory source",
  "normalized host identity",
  "reachability observation",
  "observation timestamp",
] as const;
export const DEFAULT_OMITTED_AXIS = "credential state between observations";

export function verifyFleet(input: FleetVerificationInput): FleetVerificationResult {
  const observedAt = input.observedAt ?? new Date().toISOString();
  const requiredSources = input.requiredSources ?? [...DEFAULT_REQUIRED_SOURCES];
  const positiveControls = input.positiveControls ?? [];
  const sourcesByName = new Map(input.sources.map((source) => [source.name, source]));
  const controlFailures = collectControlFailures(requiredSources, sourcesByName, positiveControls);

  const totalHosts = normalizeHostSet(input.sources.flatMap((source) => source.hosts));
  if (totalHosts.length === 0 && !hasObservedControl("fleet-union", positiveControls)) {
    controlFailures.push("fleet-union returned zero hosts without an observed positive control");
  }

  const coveredHosts = coveredHostSet(totalHosts, input.sources, input.probes ?? []);
  const missingHosts = totalHosts.filter((host) => !coveredHosts.includes(host));
  const status = statusFor(totalHosts.length, missingHosts.length, controlFailures.length);
  const result: FleetVerificationResult = {
    id: stableVerificationId(input, observedAt),
    status,
    fraction: `${coveredHosts.length}/${totalHosts.length}`,
    coveredHosts,
    missingHosts,
    totalHosts,
    controlFailures,
    provenance: {
      observedAt,
      axes: [...CORPUS_AXES],
      omittedAxis: input.omittedAxis ?? DEFAULT_OMITTED_AXIS,
      sources: requiredSources.map((name) => {
        const source = sourcesByName.get(name) ?? { name, hosts: [] };
        return {
          source: name,
          observedAt: source.observedAt ?? observedAt,
          hostCount: source.hosts.length,
          hostIds: normalizeHostSet(source.hosts),
          command: source.command,
          uri: source.uri,
          positiveControl: positiveControls.find((control) => control.source === name),
        };
      }),
      positiveControls,
    },
  };

  assertNoNumeratorKeys(result);
  return result;
}

export function exitCodeForResult(result: FleetVerificationResult): number {
  if (result.status === "pass") return 0;
  if (result.status === "incomplete") return 1;
  if (result.status === "invalid") return 2;
  return 3;
}

export function normalizeHostId(id: string): string {
  return id.trim().toLowerCase();
}

function normalizeHostSet(hosts: HostObservation[]): string[] {
  return [...new Set(hosts.map((host) => normalizeHostId(host.id)).filter(Boolean))].sort();
}

function coveredHostSet(
  totalHosts: string[],
  sources: FleetSource[],
  probes: ProbeObservation[],
): string[] {
  const covered = new Set<string>();
  for (const probe of probes) {
    if (probe.ok) covered.add(normalizeHostId(probe.host));
  }
  if (probes.length === 0) {
    for (const source of sources) {
      for (const host of source.hosts) {
        if (host.reachable === true) covered.add(normalizeHostId(host.id));
      }
    }
  }
  return totalHosts.filter((host) => covered.has(host));
}

function collectControlFailures(
  requiredSources: string[],
  sourcesByName: Map<string, FleetSource>,
  controls: PositiveControl[],
): string[] {
  const failures: string[] = [];
  for (const sourceName of requiredSources) {
    const hostCount = sourcesByName.get(sourceName)?.hosts.length ?? 0;
    if (hostCount === 0 && !hasObservedControl(sourceName, controls)) {
      failures.push(`${sourceName} returned zero hosts without an observed positive control`);
    }
  }
  return failures;
}

function hasObservedControl(source: string, controls: PositiveControl[]): boolean {
  return controls.some((control) => control.source === source && control.observed);
}

function statusFor(total: number, missing: number, controls: number) {
  if (controls > 0) return "control_failed";
  if (total === 0) return "invalid";
  return missing === 0 ? "pass" : "incomplete";
}

function stableVerificationId(input: FleetVerificationInput, observedAt: string): string {
  const material = JSON.stringify({ ...input, observedAt });
  const hash = createHash("sha256").update(material).digest("hex").slice(0, 12);
  return `fleet_${hash}_${randomUUID().slice(0, 8)}`;
}
