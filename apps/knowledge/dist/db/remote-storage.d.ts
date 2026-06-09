export declare class PgAdapterAsync {
    private readonly pool;
    constructor(connectionString: string);
    run(sql: string, ...params: unknown[]): Promise<{
        changes: number;
    }>;
    all(sql: string, ...params: unknown[]): Promise<unknown[]>;
    close(): Promise<void>;
}
