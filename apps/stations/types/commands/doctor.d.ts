import { type ManifestSourceAdapter } from "../manifests.js";
import { type MachineCommandRunner } from "../remote.js";
import type { DoctorCheck, DoctorReport, FleetManifest, ManifestLoadInfo } from "../types.js";
export declare const DOCTOR_OPTIONAL_ADAPTER_DOMAINS: readonly ["secrets", "configs", "monitor", "repos", "mcps", "shield"];
export type DoctorOptionalAdapterDomain = typeof DOCTOR_OPTIONAL_ADAPTER_DOMAINS[number];
export interface DoctorAdapterContext {
    machineId: string;
    manifest: FleetManifest;
    manifestSource: ManifestLoadInfo;
    commandDetails: Record<string, string>;
    now: Date;
}
export type DoctorAdapterHook = (context: DoctorAdapterContext) => DoctorCheck | DoctorCheck[] | null | undefined;
export interface DoctorAdapter {
    id: string;
    checks?: Partial<Record<DoctorOptionalAdapterDomain, DoctorAdapterHook>>;
}
export interface DoctorOptions {
    now?: Date;
    manifestAdapter?: ManifestSourceAdapter | null;
    adapters?: DoctorAdapter[];
    includeOptionalAdapters?: boolean;
    commandRunner?: MachineCommandRunner;
}
export declare function doctorExitCode(report: DoctorReport): number;
export declare function runDoctor(machineId?: string, options?: DoctorOptions): DoctorReport;
