export interface DomainMapping {
    domain: string;
    port: number;
    targetHost: string;
}
export declare function addDomainMapping(domain: string, port: number, targetHost?: string): DomainMapping[];
export declare function listDomainMappings(): DomainMapping[];
export declare function renderDomainMapping(domain: string): {
    hostsEntry: string;
    caddySnippet: string;
    certPath: string;
    keyPath: string;
};
