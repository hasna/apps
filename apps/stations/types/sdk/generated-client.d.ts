export interface Machine {
    "id": string;
    "friendlyName"?: string | null;
    "platform"?: string | null;
    "arch"?: string | null;
    "status": string;
    "labels": Record<string, unknown>;
    "metadata": Record<string, unknown>;
    "createdAt": string;
    "updatedAt": string;
}
export interface Heartbeat {
    "machineId": string;
    "pid": number;
    "status": string;
    "updatedAt": string;
    "daemonVersion"?: string | null;
    "agentMode"?: string | null;
    "platform"?: string | null;
    "arch"?: string | null;
    "uptimeSeconds"?: number | null;
    "observedAt"?: string | null;
}
export interface RegisterMachineRequest {
    "id": string;
    "friendlyName"?: string | null;
    "platform"?: string | null;
    "arch"?: string | null;
    "status"?: string;
    "labels"?: Record<string, unknown>;
    "metadata"?: Record<string, unknown>;
}
export interface UpdateMachineRequest {
    "friendlyName"?: string | null;
    "platform"?: string | null;
    "arch"?: string | null;
    "status"?: string;
    "labels"?: Record<string, unknown>;
    "metadata"?: Record<string, unknown>;
}
export interface MachineList {
    "stations": Array<Machine>;
    "count": number;
}
export interface HeartbeatList {
    "heartbeats": Array<Heartbeat>;
    "count": number;
}
export interface DeleteResult {
    "deleted": boolean;
    "id": string;
}
export interface HealthResponse {
    "status": string;
    "version": string;
    "mode": string;
}
export interface ReadyResponse {
    "status": string;
    "version": string;
    "mode": string;
    "pendingMigrations"?: Array<string>;
    "latencyMs"?: number;
}
export interface ErrorResponse {
    "error": string;
    "reason"?: string;
}
export interface StationsClientOptions {
    /** Base URL, e.g. process.env.APP_API_URL. */
    baseUrl: string;
    /** API key, e.g. process.env.APP_API_KEY. Sent as the 'x-api-key' header. */
    apiKey?: string;
    /** Custom fetch (defaults to global fetch). */
    fetch?: typeof fetch;
    /** Extra headers merged into every request. */
    headers?: Record<string, string>;
}
export declare class ApiError extends Error {
    readonly status: number;
    readonly body: unknown;
    constructor(status: number, message: string, body: unknown);
}
export declare class StationsClient {
    private readonly baseUrl;
    private readonly apiKey;
    private readonly fetchImpl;
    private readonly baseHeaders;
    constructor(options: StationsClientOptions);
    private request;
    /** Liveness probe (no auth). */
    health(init?: RequestInit): Promise<HealthResponse>;
    /** Readiness probe: reachable RDS and schema migrated (no auth). */
    ready(init?: RequestInit): Promise<ReadyResponse>;
    /** List agent heartbeats across the fleet. */
    listHeartbeats(query?: {
        "machineId"?: string;
        "limit"?: number;
    }, init?: RequestInit): Promise<HeartbeatList>;
    /** List registered stations. */
    listStations(query?: {
        "status"?: string;
        "limit"?: number;
        "offset"?: number;
    }, init?: RequestInit): Promise<MachineList>;
    /** Register (upsert) a machine. */
    registerMachine(body: RegisterMachineRequest, init?: RequestInit): Promise<Machine>;
    /** Fetch one machine by id. */
    getMachine(id: string, init?: RequestInit): Promise<Machine>;
    /** Deregister a machine. */
    deleteMachine(id: string, init?: RequestInit): Promise<DeleteResult>;
    /** Partially update a machine. */
    updateMachine(id: string, body: UpdateMachineRequest, init?: RequestInit): Promise<Machine>;
    /** Service version and mode (no auth). */
    version(init?: RequestInit): Promise<HealthResponse>;
}
