/**
 * Typed client SDK for the @hasna/logs hosted API (`/v1`).
 *
 * Generated from the serve OpenAPI document — see `scripts/generate-sdk-api.ts`.
 * Usage:
 *
 *   import { LogsClient } from "@hasna/logs/api";
 *   const logs = new LogsClient({
 *     baseUrl: process.env.LOGS_API_URL!,
 *     apiKey: process.env.LOGS_API_KEY!,
 *   });
 *   await logs.ingestLog({ level: "info", message: "hello" });
 */

export * from "./sdk-api/client.ts";
