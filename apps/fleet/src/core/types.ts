export type VerificationStatus = "pass" | "incomplete" | "control_failed" | "invalid";

export interface HostObservation {
  id: string;
  source?: string;
  reachable?: boolean;
  evidence?: Record<string, unknown>;
}

export interface FleetSource {
  name: string;
  observedAt?: string;
  command?: string;
  uri?: string;
  hosts: HostObservation[];
}

export interface ProbeObservation {
  host: string;
  ok: boolean;
  observedAt?: string;
  source?: string;
  evidence?: Record<string, unknown>;
}

export interface PositiveControl {
  source: string;
  observed: boolean;
  evidence: string;
}

export interface FleetVerificationInput {
  sources: FleetSource[];
  probes?: ProbeObservation[];
  requiredSources?: string[];
  positiveControls?: PositiveControl[];
  observedAt?: string;
  omittedAxis?: string;
}

export interface SourceProvenance {
  source: string;
  observedAt: string;
  hostCount: number;
  hostIds: string[];
  command?: string;
  uri?: string;
  positiveControl?: PositiveControl;
}

export interface FleetVerificationResult {
  id: string;
  status: VerificationStatus;
  fraction: string;
  coveredHosts: string[];
  missingHosts: string[];
  totalHosts: string[];
  controlFailures: string[];
  provenance: {
    observedAt: string;
    axes: string[];
    omittedAxis: string;
    sources: SourceProvenance[];
    positiveControls: PositiveControl[];
  };
}

export interface FractionInput {
  numerator: number;
  denominator: number;
  source: string;
  observedAt: string;
  axes: string[];
  omittedAxis: string;
}
