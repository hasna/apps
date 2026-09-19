import { EventsClient } from "./index.js";
type CommanderLike = any;
type CommanderCommandLike = any;
export interface RegisterEventsCommandsOptions {
    source: string;
    dataDir?: string;
    createClient?: () => EventsClient;
    channelsCommandName?: string;
    eventsCommandName?: string;
    /**
     * Default row cap applied to `events list` when the caller does not pass an
     * explicit `--limit`. Ordinary output is always a compact, cursor-paged
     * envelope; `--full` is the explicit exact-record compatibility escape.
     * Defaults to {@link DEFAULT_EVENT_LIST_LIMIT}.
     */
    defaultEventListLimit?: number;
}
/**
 * Sane default number of most-recent events returned by `events list` when the
 * host does not configure {@link RegisterEventsCommandsOptions.defaultEventListLimit}
 * and the user does not pass an explicit `--limit`.
 */
export declare const DEFAULT_EVENT_LIST_LIMIT = 20;
export declare function registerChannelCommands(program: CommanderLike, options: RegisterEventsCommandsOptions): CommanderCommandLike;
export declare function registerEventCommands(program: CommanderLike, options: RegisterEventsCommandsOptions): CommanderCommandLike;
export declare function registerEventsCommands(program: CommanderLike, options: RegisterEventsCommandsOptions): void;
export {};
