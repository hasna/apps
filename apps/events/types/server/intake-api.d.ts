import { type IntakeBinding } from "../intake/protocol.js";
import { IntakePostgres } from "./intake-postgres.js";
export declare function bindingHeaders(binding: IntakeBinding): Record<string, string>;
export declare function createIntakeHandler(store: IntakePostgres, signingSecret: string | Buffer): (request: Request) => Promise<Response>;
