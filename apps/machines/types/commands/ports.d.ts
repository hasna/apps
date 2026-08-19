export interface ListeningPort {
    protocol: string;
    host: string;
    port: number;
    process?: string;
}
export interface PortsResult {
    machineId: string;
    listeners: ListeningPort[];
}
export declare function parsePortOutput(output: string, format: "ss" | "lsof"): ListeningPort[];
export declare function listPorts(machineId?: string): PortsResult;
