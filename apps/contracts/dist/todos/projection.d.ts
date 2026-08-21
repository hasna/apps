import * as z from "zod/v4";
import { type TodosGitObjectId } from "./domain";
import { type TodosError } from "./errors";
export declare const TODOS_PROJECTION_SCHEMA_IDS: {
    readonly projection: "hasna.todos.task_to_pr_projection.v1";
    readonly transitionIssue: "hasna.todos.task_to_pr_transition_issue.v1";
};
export declare const TaskToPrOwnerRefSchema: z.ZodObject<{
    owner: z.ZodString;
    kind: z.ZodString;
    id: z.ZodString;
    digest: z.ZodString;
}, z.core.$strict>;
export type TaskToPrOwnerRef = z.infer<typeof TaskToPrOwnerRefSchema>;
export declare const TaskToPrTaskRefSchema: z.ZodObject<{
    owner: z.ZodString;
    id: z.ZodString;
    digest: z.ZodString;
    kind: z.ZodLiteral<"task">;
}, z.core.$strict>;
export declare const TaskToPrRepositoryRefSchema: z.ZodObject<{
    owner: z.ZodString;
    id: z.ZodString;
    digest: z.ZodString;
    kind: z.ZodLiteral<"repository">;
}, z.core.$strict>;
export declare const TaskToPrWorktreeRefSchema: z.ZodObject<{
    owner: z.ZodString;
    id: z.ZodString;
    digest: z.ZodString;
    kind: z.ZodLiteral<"worktree">;
}, z.core.$strict>;
export declare const TaskToPrBranchRefSchema: z.ZodObject<{
    owner: z.ZodString;
    id: z.ZodString;
    digest: z.ZodString;
    kind: z.ZodLiteral<"branch">;
}, z.core.$strict>;
export declare const TaskToPrPullRequestRefSchema: z.ZodObject<{
    owner: z.ZodString;
    id: z.ZodString;
    digest: z.ZodString;
    kind: z.ZodLiteral<"pull_request">;
}, z.core.$strict>;
export declare const TaskToPrProofRefSchema: z.ZodObject<{
    owner: z.ZodString;
    id: z.ZodString;
    digest: z.ZodString;
    kind: z.ZodLiteral<"proof_bundle">;
}, z.core.$strict>;
export declare const TaskToPrProjectionPredecessorSchema: z.ZodObject<{
    kind: z.ZodLiteral<"task_to_pr_projection">;
    projectionId: z.ZodString;
    owner: z.ZodString;
    version: z.ZodNumber;
    digest: z.ZodString;
}, z.core.$strict>;
export type TaskToPrProjectionPredecessor = z.infer<typeof TaskToPrProjectionPredecessorSchema>;
export declare const TaskToPrProjectionIdentitySchema: z.ZodObject<{
    taskRef: z.ZodObject<{
        owner: z.ZodString;
        id: z.ZodString;
        digest: z.ZodString;
        kind: z.ZodLiteral<"task">;
    }, z.core.$strict>;
    repositoryRef: z.ZodObject<{
        owner: z.ZodString;
        id: z.ZodString;
        digest: z.ZodString;
        kind: z.ZodLiteral<"repository">;
    }, z.core.$strict>;
    worktreeRef: z.ZodObject<{
        owner: z.ZodString;
        id: z.ZodString;
        digest: z.ZodString;
        kind: z.ZodLiteral<"worktree">;
    }, z.core.$strict>;
    branchRef: z.ZodObject<{
        owner: z.ZodString;
        id: z.ZodString;
        digest: z.ZodString;
        kind: z.ZodLiteral<"branch">;
    }, z.core.$strict>;
    baseHead: z.ZodObject<{
        algorithm: z.ZodEnum<{
            sha256: "sha256";
            sha1: "sha1";
        }>;
        value: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>;
export type TaskToPrProjectionIdentity = z.infer<typeof TaskToPrProjectionIdentitySchema>;
export declare const TaskToPrProofKindSchema: z.ZodEnum<{
    ci: "ci";
    review: "review";
    head_equality: "head_equality";
}>;
export declare const TaskToPrProofSchema: z.ZodObject<{
    ref: z.ZodObject<{
        owner: z.ZodString;
        id: z.ZodString;
        digest: z.ZodString;
        kind: z.ZodLiteral<"proof_bundle">;
    }, z.core.$strict>;
    kind: z.ZodEnum<{
        ci: "ci";
        review: "review";
        head_equality: "head_equality";
    }>;
    head: z.ZodObject<{
        algorithm: z.ZodEnum<{
            sha256: "sha256";
            sha1: "sha1";
        }>;
        value: z.ZodString;
    }, z.core.$strict>;
    observedAt: z.ZodISODateTime;
}, z.core.$strict>;
export type TaskToPrProof = z.infer<typeof TaskToPrProofSchema>;
export declare const TaskToPrHeadBindingSchema: z.ZodObject<{
    branchHead: z.ZodObject<{
        algorithm: z.ZodEnum<{
            sha256: "sha256";
            sha1: "sha1";
        }>;
        value: z.ZodString;
    }, z.core.$strict>;
    publishedHead: z.ZodNullable<z.ZodObject<{
        algorithm: z.ZodEnum<{
            sha256: "sha256";
            sha1: "sha1";
        }>;
        value: z.ZodString;
    }, z.core.$strict>>;
    providerObservedHead: z.ZodNullable<z.ZodObject<{
        algorithm: z.ZodEnum<{
            sha256: "sha256";
            sha1: "sha1";
        }>;
        value: z.ZodString;
    }, z.core.$strict>>;
    equalityProof: z.ZodNullable<z.ZodObject<{
        ref: z.ZodObject<{
            owner: z.ZodString;
            id: z.ZodString;
            digest: z.ZodString;
            kind: z.ZodLiteral<"proof_bundle">;
        }, z.core.$strict>;
        kind: z.ZodEnum<{
            ci: "ci";
            review: "review";
            head_equality: "head_equality";
        }>;
        head: z.ZodObject<{
            algorithm: z.ZodEnum<{
                sha256: "sha256";
                sha1: "sha1";
            }>;
            value: z.ZodString;
        }, z.core.$strict>;
        observedAt: z.ZodISODateTime;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type TaskToPrHeadBinding = z.infer<typeof TaskToPrHeadBindingSchema>;
export interface TaskToPrProjectionUnsigned {
    schema: typeof TODOS_PROJECTION_SCHEMA_IDS.projection;
    id: string;
    owner: string;
    version: number;
    sequence: number;
    predecessor: TaskToPrProjectionPredecessor | null;
    identity: TaskToPrProjectionIdentity;
    pullRequestRef: TaskToPrOwnerRef | null;
    head: TaskToPrHeadBinding;
    proofs: TaskToPrProof[];
    derivedAt: string;
}
export declare const TaskToPrProjectionSchema: z.ZodType<TaskToPrProjection>;
export interface TaskToPrProjection extends TaskToPrProjectionUnsigned {
    digest: string;
}
export declare const TaskToPrTransitionIssueSchema: z.ZodObject<{
    path: z.ZodString;
    reason: z.ZodString;
}, z.core.$strict>;
export type TaskToPrTransitionIssue = z.infer<typeof TaskToPrTransitionIssueSchema>;
export type TaskToPrTransitionResult = {
    success: true;
    replayed: boolean;
} | {
    success: false;
    error: TodosError;
    issues: TaskToPrTransitionIssue[];
};
export declare function sameTodosGitObjectId(left: TodosGitObjectId, right: TodosGitObjectId): boolean;
export declare function computeTaskToPrProjectionDigest(value: TaskToPrProjectionUnsigned): string;
export declare function createTaskToPrProjection(value: TaskToPrProjectionUnsigned): TaskToPrProjection;
export declare function validateTaskToPrProjectionTransition(previousInput: unknown, currentInput: unknown): TaskToPrTransitionResult;
export interface TaskToPrProjectionHistoryOptions {
    expectedOwner?: string;
    expectedHead?: TodosGitObjectId;
}
export type TaskToPrProjectionHistoryResult = {
    success: true;
    head: TaskToPrProjection;
} | {
    success: false;
    error: TodosError;
    issues: TaskToPrTransitionIssue[];
};
export declare function validateTaskToPrProjectionHistory(historyInput: unknown, options?: TaskToPrProjectionHistoryOptions): TaskToPrProjectionHistoryResult;
export declare const TODOS_PROJECTION_SCHEMAS: Readonly<{
    "hasna.todos.task_to_pr_projection.v1": z.ZodType<TaskToPrProjection, unknown, z.core.$ZodTypeInternals<TaskToPrProjection, unknown>>;
    "hasna.todos.task_to_pr_transition_issue.v1": z.ZodObject<{
        path: z.ZodString;
        reason: z.ZodString;
    }, z.core.$strict>;
}>;
