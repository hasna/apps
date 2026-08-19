/** Minimal process-environment shape shared by backend and transport resolvers. */
export type Env = Record<string, string | undefined>;
/** Upper-snake env token for an app name, e.g. `mailery` -> `MAILERY`. */
export declare function envToken(name: string): string;
