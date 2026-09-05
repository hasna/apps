// Generated from openapi.json. Run bun run generate.
export interface paths {
    "/v1/providers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["listProviders"];
        put?: never;
        post: operations["createProvider"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/providers/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getProvider"];
        put: operations["updateProvider"];
        post?: never;
        delete: operations["deleteProvider"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/profiles": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["listProfiles"];
        put?: never;
        post: operations["createProfile"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/profiles/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getProfile"];
        put: operations["updateProfile"];
        post?: never;
        delete: operations["deleteProfile"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/providers/{id}/models": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["listModels"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/providers/{id}/refresh": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["refreshModels"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/launch-plans": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["launchPlan"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["listRuns"];
        put?: never;
        post: operations["createRun"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/runs/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getRun"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["finishRun"];
        trace?: never;
    };
    "/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["health"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/ready": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ready"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/version": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["version"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/openapi.json": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["openApi"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        ProviderInput: {
            id: string;
            name: string;
            baseUrl: string;
            /** @enum {string} */
            protocol: "anthropic-messages" | "openai-responses" | "openai-chat";
            credentialEnv?: string;
            /**
             * @default bearer
             * @enum {string}
             */
            authStyle: "bearer" | "x-api-key";
            /** @default models */
            modelsPath: string;
            /** @default [] */
            manualModels: {
                id: string;
                name: string;
                description?: string;
                contextWindow?: number;
                maxOutputTokens?: number;
                inputModalities?: string[];
                outputModalities?: string[];
                supportedParameters?: string[];
            }[];
        };
        Provider: {
            id: string;
            name: string;
            baseUrl: string;
            /** @enum {string} */
            protocol: "anthropic-messages" | "openai-responses" | "openai-chat";
            credentialEnv?: string;
            /**
             * @default bearer
             * @enum {string}
             */
            authStyle: "bearer" | "x-api-key";
            /** @default models */
            modelsPath: string;
            /** @default [] */
            manualModels: {
                id: string;
                name: string;
                description?: string;
                contextWindow?: number;
                maxOutputTokens?: number;
                inputModalities?: string[];
                outputModalities?: string[];
                supportedParameters?: string[];
            }[];
            version: number;
            updatedAt: string;
        };
        ProfileInput: {
            id: string;
            name: string;
            providerId: string;
            /** @enum {string} */
            harness: "claude" | "codex" | "grok" | "opencode2";
            model: string;
        };
        Profile: {
            id: string;
            name: string;
            providerId: string;
            /** @enum {string} */
            harness: "claude" | "codex" | "grok" | "opencode2";
            model: string;
            version: number;
            updatedAt: string;
        };
        Model: {
            id: string;
            name: string;
            description?: string;
            contextWindow?: number;
            maxOutputTokens?: number;
            inputModalities?: string[];
            outputModalities?: string[];
            supportedParameters?: string[];
        };
        ModelPage: {
            data: {
                id: string;
                name: string;
                description?: string;
                contextWindow?: number;
                maxOutputTokens?: number;
                inputModalities?: string[];
                outputModalities?: string[];
                supportedParameters?: string[];
                codingEligible: boolean;
            }[];
            total: number;
            limit: number;
            offset: number;
            refreshedAt: string;
            /** @enum {string} */
            source: "remote" | "manual";
        };
        Catalog: {
            models: {
                id: string;
                name: string;
                description?: string;
                contextWindow?: number;
                maxOutputTokens?: number;
                inputModalities?: string[];
                outputModalities?: string[];
                supportedParameters?: string[];
            }[];
            refreshedAt: string;
            /** @enum {string} */
            source: "remote" | "manual";
        };
        LaunchPlan: {
            provider: {
                id: string;
                name: string;
                baseUrl: string;
                /** @enum {string} */
                protocol: "anthropic-messages" | "openai-responses" | "openai-chat";
                credentialEnv?: string;
                /**
                 * @default bearer
                 * @enum {string}
                 */
                authStyle: "bearer" | "x-api-key";
                /** @default models */
                modelsPath: string;
                /** @default [] */
                manualModels: {
                    id: string;
                    name: string;
                    description?: string;
                    contextWindow?: number;
                    maxOutputTokens?: number;
                    inputModalities?: string[];
                    outputModalities?: string[];
                    supportedParameters?: string[];
                }[];
                version: number;
                updatedAt: string;
            };
            profile: {
                id: string;
                name: string;
                providerId: string;
                /** @enum {string} */
                harness: "claude" | "codex" | "grok" | "opencode2";
                model: string;
                version: number;
                updatedAt: string;
            };
            catalog: {
                models: {
                    id: string;
                    name: string;
                    description?: string;
                    contextWindow?: number;
                    maxOutputTokens?: number;
                    inputModalities?: string[];
                    outputModalities?: string[];
                    supportedParameters?: string[];
                }[];
                refreshedAt: string;
                /** @enum {string} */
                source: "remote" | "manual";
            };
            planToken: string;
            warnings: string[];
        };
        RunInput: {
            profileId: string;
            /** @enum {string} */
            harness: "claude" | "codex" | "grok" | "opencode2";
            model: string;
            planToken: string;
        };
        RunUpdate: {
            /** @enum {string} */
            status: "exited" | "failed" | "interrupted";
            exitCode: number;
        };
        Run: {
            profileId: string;
            /** @enum {string} */
            harness: "claude" | "codex" | "grok" | "opencode2";
            model: string;
            planToken: string;
            version: number;
            updatedAt: string;
            providerId: string;
            providerVersion: number;
            profileVersion: number;
            id: string;
            /** @enum {string} */
            status: "running" | "exited" | "failed" | "interrupted";
            startedAt: string;
            endedAt?: string;
            exitCode?: number;
        };
        Health: {
            /** @enum {string} */
            status: "ok" | "degraded" | "unavailable";
            version: string;
            /** @enum {string} */
            backend: "sqlite" | "postgresql";
        };
        Ready: {
            ready: boolean;
            reason?: string;
        };
        Version: {
            version: string;
        };
        LaunchInput: {
            profileId: string;
        };
        Empty: Record<string, never>;
        Error: {
            error: {
                code: string;
                message: string;
                requestId: string;
            };
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    listProviders: {
        parameters: {
            query?: {
                limit?: number;
                offset?: number;
                search?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["Provider"][];
                        total: number;
                        limit: number;
                        offset: number;
                    };
                };
            };
            /** @description Structured error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    createProvider: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ProviderInput"];
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Provider"];
                };
            };
            /** @description Structured error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getProvider: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Provider"];
                };
            };
            /** @description Structured error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    updateProvider: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "If-Match": number;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ProviderInput"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Provider"];
                };
            };
            /** @description Structured error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deleteProvider: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "If-Match": number;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        deleted: string;
                    };
                };
            };
            /** @description Structured error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listProfiles: {
        parameters: {
            query?: {
                limit?: number;
                offset?: number;
                search?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["Profile"][];
                        total: number;
                        limit: number;
                        offset: number;
                    };
                };
            };
            /** @description Structured error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    createProfile: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ProfileInput"];
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Profile"];
                };
            };
            /** @description Structured error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getProfile: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Profile"];
                };
            };
            /** @description Structured error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    updateProfile: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "If-Match": number;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ProfileInput"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Profile"];
                };
            };
            /** @description Structured error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deleteProfile: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "If-Match": number;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        deleted: string;
                    };
                };
            };
            /** @description Structured error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listModels: {
        parameters: {
            query?: {
                limit?: number;
                offset?: number;
                search?: string;
            };
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ModelPage"];
                };
            };
            /** @description Structured error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    refreshModels: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Empty"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Catalog"];
                };
            };
            /** @description Structured error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    launchPlan: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LaunchInput"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LaunchPlan"];
                };
            };
            /** @description Structured error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listRuns: {
        parameters: {
            query?: {
                limit?: number;
                offset?: number;
                search?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["Run"][];
                        total: number;
                        limit: number;
                        offset: number;
                    };
                };
            };
            /** @description Structured error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    createRun: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RunInput"];
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Run"];
                };
            };
            /** @description Structured error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getRun: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Run"];
                };
            };
            /** @description Structured error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    finishRun: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "If-Match": number;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RunUpdate"];
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Run"];
                };
            };
            /** @description Structured error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    health: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Health"];
                };
            };
            /** @description Structured error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    ready: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Ready"];
                };
            };
            /** @description Structured error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    version: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Version"];
                };
            };
            /** @description Structured error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    openApi: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Structured error */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
}
