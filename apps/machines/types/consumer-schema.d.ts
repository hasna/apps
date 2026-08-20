import { MACHINES_CONSUMER_SCHEMA_URI, type MachineResolverSnapshot, type MachineRouteResolution, type MachineTopology, type MachineWorkspaceResolution } from "./topology.js";
import type { MachineCompatibilityReport } from "./compatibility.js";
import type { MachineProjectAssignments } from "./projects.js";
import type { MachineTrashPolicies, NoteMachineContext } from "./notes.js";
import type { MachineDetails } from "./details.js";
import type { CommandMatrixReport, FleetLoopPreflightReport, FleetRoutingReport, MachineHealthReport } from "./agent-abstractions.js";
import { type BrowserPlanFleet } from "./browserplan.js";
export type MachinesConsumerSchemaEnvelope = "contract" | "topology" | "route" | "workspace" | "compatibility" | "resolver_snapshot" | "project_assignments" | "note_machine_context" | "machine_trash_policies" | "machine_details" | "browserplan_fleet" | "machine_health" | "routing" | "command_matrix" | "loop_preflight";
export interface MachinesConsumerValidationResult {
    ok: boolean;
    envelope: MachinesConsumerSchemaEnvelope;
    schema_id: typeof MACHINES_CONSUMER_SCHEMA_URI;
    errors: string[];
}
export interface MachinesConsumerSchemaBundle {
    $schema: "https://json-schema.org/draft/2020-12/schema";
    $id: typeof MACHINES_CONSUMER_SCHEMA_URI;
    title: string;
    type: "object";
    $defs: Record<string, unknown>;
}
export declare const MACHINES_CONSUMER_SCHEMA_BUNDLE: MachinesConsumerSchemaBundle;
export declare function getMachinesConsumerSchemaBundle(): MachinesConsumerSchemaBundle;
export declare function validateMachinesConsumerEnvelope(envelope: MachinesConsumerSchemaEnvelope, value: unknown): MachinesConsumerValidationResult;
export type MachinesConsumerEnvelopeValue = MachineTopology | MachineRouteResolution | MachineWorkspaceResolution | MachineCompatibilityReport | MachineResolverSnapshot | MachineProjectAssignments | NoteMachineContext | MachineTrashPolicies | MachineDetails | BrowserPlanFleet | MachineHealthReport | FleetRoutingReport | CommandMatrixReport | FleetLoopPreflightReport;
