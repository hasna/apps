import { STATIONS_CONSUMER_SCHEMA_URI, type MachineResolverSnapshot, type MachineRouteResolution, type MachineTopology, type MachineWorkspaceResolution } from "./topology.js";
import type { MachineCompatibilityReport } from "./compatibility.js";
import type { MachineProjectAssignments } from "./projects.js";
import type { MachineTrashPolicies, NoteMachineContext } from "./notes.js";
import type { MachineDetails } from "./details.js";
import type { CommandMatrixReport, FleetLoopPreflightReport, FleetRoutingReport, MachineHealthReport } from "./agent-abstractions.js";
import { type BrowserPlanFleet } from "./browserplan.js";
export type StationsConsumerSchemaEnvelope = "contract" | "topology" | "route" | "workspace" | "compatibility" | "resolver_snapshot" | "project_assignments" | "note_machine_context" | "machine_trash_policies" | "machine_details" | "browserplan_fleet" | "machine_health" | "routing" | "command_matrix" | "loop_preflight";
export interface StationsConsumerValidationResult {
    ok: boolean;
    envelope: StationsConsumerSchemaEnvelope;
    schema_id: typeof STATIONS_CONSUMER_SCHEMA_URI;
    errors: string[];
}
export interface StationsConsumerSchemaBundle {
    $schema: "https://json-schema.org/draft/2020-12/schema";
    $id: typeof STATIONS_CONSUMER_SCHEMA_URI;
    title: string;
    type: "object";
    $defs: Record<string, unknown>;
}
export declare const STATIONS_CONSUMER_SCHEMA_BUNDLE: StationsConsumerSchemaBundle;
export declare function getStationsConsumerSchemaBundle(): StationsConsumerSchemaBundle;
export declare function validateStationsConsumerEnvelope(envelope: StationsConsumerSchemaEnvelope, value: unknown): StationsConsumerValidationResult;
export type StationsConsumerEnvelopeValue = MachineTopology | MachineRouteResolution | MachineWorkspaceResolution | MachineCompatibilityReport | MachineResolverSnapshot | MachineProjectAssignments | NoteMachineContext | MachineTrashPolicies | MachineDetails | BrowserPlanFleet | MachineHealthReport | FleetRoutingReport | CommandMatrixReport | FleetLoopPreflightReport;
