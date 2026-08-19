import { type TodosCapability, type TodosCapabilityManifest } from "./capability-schema";
import { type TodosOperationManifest } from "./operations";
export declare function deriveTodosCapabilities(manifest?: TodosOperationManifest): TodosCapability[];
export declare function createTodosCapabilityManifest(manifest?: TodosOperationManifest): TodosCapabilityManifest;
export declare const TODOS_CAPABILITY_MANIFEST: {
    schema: "hasna.todos.capability_manifest.v1";
    version: "1";
    manifestDigest: string;
    capabilities: {
        id: string;
        availability: "core" | "gated";
        operationIds: string[];
        audiences: ("customer" | "tenant_admin")[];
    }[];
};
