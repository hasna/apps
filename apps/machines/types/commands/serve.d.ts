export interface ServeOptions {
    host?: string;
    port?: number;
}
export interface ServeInfo {
    host: string;
    port: number;
    url: string;
    routes: string[];
}
export declare function getServeInfo(options?: ServeOptions): ServeInfo;
export declare function renderDashboardHtml(): string;
export declare function startDashboardServer(options?: ServeOptions): ReturnType<typeof Bun.serve>;
