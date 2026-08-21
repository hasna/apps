import * as z from "zod/v4";
export declare const TODOS_DOMAIN_SCHEMA_IDS: {
    readonly ownerQualifiedRef: "hasna.todos.owner_qualified_ref.v1";
    readonly externalOwnerRef: "hasna.todos.external_owner_ref.v1";
    readonly task: "hasna.todos.task.v1";
    readonly project: "hasna.todos.project.v1";
    readonly taskList: "hasna.todos.task_list.v1";
    readonly plan: "hasna.todos.plan.v1";
    readonly agent: "hasna.todos.agent.v1";
    readonly comment: "hasna.todos.comment.v1";
    readonly dependency: "hasna.todos.dependency.v1";
    readonly activity: "hasna.todos.activity.v1";
    readonly savedView: "hasna.todos.saved_view.v1";
    readonly searchRequest: "hasna.todos.search_request.v1";
    readonly verificationEvidence: "hasna.todos.verification_evidence.v1";
    readonly taskFile: "hasna.todos.task_file.v1";
    readonly run: "hasna.todos.run.v1";
    readonly runEvent: "hasna.todos.run_event.v1";
    readonly runCommand: "hasna.todos.run_command.v1";
    readonly runFile: "hasna.todos.run_file.v1";
    readonly runArtifact: "hasna.todos.run_artifact.v1";
    readonly gitObjectId: "hasna.todos.git_object_id.v1";
    readonly gitCommit: "hasna.todos.git_commit.v1";
    readonly gitRef: "hasna.todos.git_ref.v1";
    readonly traceability: "hasna.todos.traceability.v1";
    readonly taskTemplate: "hasna.todos.task_template.v1";
    readonly approval: "hasna.todos.approval.v1";
    readonly deletionRecord: "hasna.todos.deletion_record.v1";
    readonly taskContext: "hasna.todos.task_context.v1";
    readonly stats: "hasna.todos.stats.v1";
};
export declare const TodosExternalOwnerRefSchema: z.ZodObject<{
    owner: z.ZodString;
    id: z.ZodString;
    digest: z.ZodString;
}, z.core.$strict>;
export type TodosExternalOwnerRef = z.infer<typeof TodosExternalOwnerRefSchema>;
export declare const TodosTaskStatusSchema: z.ZodEnum<{
    pending: "pending";
    failed: "failed";
    cancelled: "cancelled";
    blocked: "blocked";
    ready: "ready";
    in_progress: "in_progress";
    completed: "completed";
}>;
export type TodosTaskStatus = z.infer<typeof TodosTaskStatusSchema>;
export declare const TODOS_TERMINAL_TASK_STATUSES: readonly ["completed", "failed", "cancelled"];
export declare const TODOS_TASK_STATUS_TRANSITIONS: Readonly<Record<TodosTaskStatus, readonly TodosTaskStatus[]>>;
export type TodosTaskStatusTransitionValidation = {
    success: true;
    replayed: boolean;
    terminal: boolean;
} | {
    success: false;
    reason: "invalid_status" | "terminal_status" | "transition_not_allowed";
    allowedTargets: readonly TodosTaskStatus[];
};
export declare function isTodosTerminalTaskStatus(status: TodosTaskStatus): boolean;
/**
 * Portable task lifecycle validation only. It intentionally does not encode
 * worker assignment, queue selection, leases, retries, or other platform policy.
 */
export declare function validateTodosTaskStatusTransition(currentInput: unknown, targetInput: unknown): TodosTaskStatusTransitionValidation;
export declare const TodosTaskPrioritySchema: z.ZodEnum<{
    low: "low";
    medium: "medium";
    high: "high";
    critical: "critical";
}>;
export declare const TodosTaskSchema: z.ZodObject<{
    shortId: z.ZodNullable<z.ZodString>;
    title: z.ZodString;
    description: z.ZodNullable<z.ZodString>;
    status: z.ZodEnum<{
        pending: "pending";
        failed: "failed";
        cancelled: "cancelled";
        blocked: "blocked";
        ready: "ready";
        in_progress: "in_progress";
        completed: "completed";
    }>;
    priority: z.ZodEnum<{
        low: "low";
        medium: "medium";
        high: "high";
        critical: "critical";
    }>;
    projectId: z.ZodNullable<z.ZodString>;
    taskListId: z.ZodNullable<z.ZodString>;
    planId: z.ZodNullable<z.ZodString>;
    parentTaskId: z.ZodNullable<z.ZodString>;
    assignedAgentId: z.ZodNullable<z.ZodString>;
    fingerprint: z.ZodNullable<z.ZodString>;
    tags: z.ZodArray<z.ZodString>;
    acceptanceCriteria: z.ZodArray<z.ZodString>;
    dueAt: z.ZodNullable<z.ZodISODateTime>;
    completedAt: z.ZodNullable<z.ZodISODateTime>;
    externalOwnerRefs: z.ZodArray<z.ZodObject<{
        owner: z.ZodString;
        id: z.ZodString;
        digest: z.ZodString;
    }, z.core.$strict>>;
    id: z.ZodString;
    owner: z.ZodString;
    version: z.ZodNumber;
    createdAt: z.ZodISODateTime;
    updatedAt: z.ZodISODateTime;
}, z.core.$strict>;
export type TodosTask = z.infer<typeof TodosTaskSchema>;
export declare const TodosProjectSchema: z.ZodObject<{
    slug: z.ZodString;
    name: z.ZodString;
    description: z.ZodNullable<z.ZodString>;
    repositoryRef: z.ZodNullable<z.ZodObject<{
        owner: z.ZodString;
        id: z.ZodString;
        digest: z.ZodString;
    }, z.core.$strict>>;
    archivedAt: z.ZodNullable<z.ZodISODateTime>;
    id: z.ZodString;
    owner: z.ZodString;
    version: z.ZodNumber;
    createdAt: z.ZodISODateTime;
    updatedAt: z.ZodISODateTime;
}, z.core.$strict>;
export type TodosProject = z.infer<typeof TodosProjectSchema>;
export declare const TodosTaskListSchema: z.ZodObject<{
    projectId: z.ZodNullable<z.ZodString>;
    slug: z.ZodString;
    name: z.ZodString;
    description: z.ZodNullable<z.ZodString>;
    archivedAt: z.ZodNullable<z.ZodISODateTime>;
    id: z.ZodString;
    owner: z.ZodString;
    version: z.ZodNumber;
    createdAt: z.ZodISODateTime;
    updatedAt: z.ZodISODateTime;
}, z.core.$strict>;
export type TodosTaskList = z.infer<typeof TodosTaskListSchema>;
export declare const TodosPlanStatusSchema: z.ZodEnum<{
    draft: "draft";
    active: "active";
    archived: "archived";
    completed: "completed";
}>;
export declare const TodosPlanSchema: z.ZodObject<{
    slug: z.ZodString;
    projectId: z.ZodNullable<z.ZodString>;
    taskListId: z.ZodNullable<z.ZodString>;
    name: z.ZodString;
    description: z.ZodNullable<z.ZodString>;
    status: z.ZodEnum<{
        draft: "draft";
        active: "active";
        archived: "archived";
        completed: "completed";
    }>;
    objective: z.ZodString;
    taskIds: z.ZodArray<z.ZodString>;
    completedAt: z.ZodNullable<z.ZodISODateTime>;
    id: z.ZodString;
    owner: z.ZodString;
    version: z.ZodNumber;
    createdAt: z.ZodISODateTime;
    updatedAt: z.ZodISODateTime;
}, z.core.$strict>;
export type TodosPlan = z.infer<typeof TodosPlanSchema>;
export declare const TodosAgentStatusSchema: z.ZodEnum<{
    active: "active";
    inactive: "inactive";
    released: "released";
}>;
export declare const TodosAgentSchema: z.ZodObject<{
    displayName: z.ZodString;
    status: z.ZodEnum<{
        active: "active";
        inactive: "inactive";
        released: "released";
    }>;
    roles: z.ZodArray<z.ZodEnum<{
        tenant_admin: "tenant_admin";
        customer_member: "customer_member";
        customer_manager: "customer_manager";
    }>>;
    activeProjectId: z.ZodNullable<z.ZodString>;
    activeTaskListId: z.ZodNullable<z.ZodString>;
    lastHeartbeatAt: z.ZodNullable<z.ZodISODateTime>;
    releasedAt: z.ZodNullable<z.ZodISODateTime>;
    id: z.ZodString;
    owner: z.ZodString;
    version: z.ZodNumber;
    createdAt: z.ZodISODateTime;
    updatedAt: z.ZodISODateTime;
}, z.core.$strict>;
export type TodosAgent = z.infer<typeof TodosAgentSchema>;
export declare const TodosCommentKindSchema: z.ZodEnum<{
    comment: "comment";
    note: "note";
    progress: "progress";
}>;
export declare const TodosCommentSchema: z.ZodObject<{
    taskId: z.ZodString;
    authorRef: z.ZodObject<{
        owner: z.ZodString;
        id: z.ZodString;
        digest: z.ZodString;
    }, z.core.$strict>;
    kind: z.ZodEnum<{
        comment: "comment";
        note: "note";
        progress: "progress";
    }>;
    content: z.ZodString;
    progressPercent: z.ZodNullable<z.ZodNumber>;
    id: z.ZodString;
    owner: z.ZodString;
    version: z.ZodNumber;
    createdAt: z.ZodISODateTime;
    updatedAt: z.ZodISODateTime;
}, z.core.$strict>;
export type TodosComment = z.infer<typeof TodosCommentSchema>;
export declare const TodosDependencyKindSchema: z.ZodEnum<{
    requires: "requires";
    blocks: "blocks";
}>;
export declare const TodosDependencySchema: z.ZodObject<{
    sourceTaskId: z.ZodString;
    targetTaskId: z.ZodString;
    kind: z.ZodEnum<{
        requires: "requires";
        blocks: "blocks";
    }>;
    id: z.ZodString;
    owner: z.ZodString;
    version: z.ZodNumber;
    createdAt: z.ZodISODateTime;
    updatedAt: z.ZodISODateTime;
}, z.core.$strict>;
export type TodosDependency = z.infer<typeof TodosDependencySchema>;
export declare const TodosActivitySchema: z.ZodObject<{
    actorRef: z.ZodObject<{
        owner: z.ZodString;
        id: z.ZodString;
        digest: z.ZodString;
    }, z.core.$strict>;
    resourceRef: z.ZodObject<{
        owner: z.ZodString;
        kind: z.ZodString;
        id: z.ZodString;
        digest: z.ZodString;
    }, z.core.$strict>;
    action: z.ZodString;
    summary: z.ZodString;
    occurredAt: z.ZodISODateTime;
    id: z.ZodString;
    owner: z.ZodString;
    version: z.ZodNumber;
    createdAt: z.ZodISODateTime;
    updatedAt: z.ZodISODateTime;
}, z.core.$strict>;
export type TodosActivity = z.infer<typeof TodosActivitySchema>;
export declare const TodosSearchFilterSchema: z.ZodObject<{
    projectIds: z.ZodArray<z.ZodString>;
    taskListIds: z.ZodArray<z.ZodString>;
    planIds: z.ZodArray<z.ZodString>;
    agentIds: z.ZodArray<z.ZodString>;
    statuses: z.ZodArray<z.ZodEnum<{
        pending: "pending";
        failed: "failed";
        cancelled: "cancelled";
        blocked: "blocked";
        ready: "ready";
        in_progress: "in_progress";
        completed: "completed";
    }>>;
    priorities: z.ZodArray<z.ZodEnum<{
        low: "low";
        medium: "medium";
        high: "high";
        critical: "critical";
    }>>;
    tags: z.ZodArray<z.ZodString>;
    changedAfter: z.ZodNullable<z.ZodISODateTime>;
    dueBefore: z.ZodNullable<z.ZodISODateTime>;
}, z.core.$strict>;
export type TodosSearchFilter = z.infer<typeof TodosSearchFilterSchema>;
export declare const TodosSearchRequestSchema: z.ZodObject<{
    query: z.ZodString;
    filters: z.ZodObject<{
        projectIds: z.ZodArray<z.ZodString>;
        taskListIds: z.ZodArray<z.ZodString>;
        planIds: z.ZodArray<z.ZodString>;
        agentIds: z.ZodArray<z.ZodString>;
        statuses: z.ZodArray<z.ZodEnum<{
            pending: "pending";
            failed: "failed";
            cancelled: "cancelled";
            blocked: "blocked";
            ready: "ready";
            in_progress: "in_progress";
            completed: "completed";
        }>>;
        priorities: z.ZodArray<z.ZodEnum<{
            low: "low";
            medium: "medium";
            high: "high";
            critical: "critical";
        }>>;
        tags: z.ZodArray<z.ZodString>;
        changedAfter: z.ZodNullable<z.ZodISODateTime>;
        dueBefore: z.ZodNullable<z.ZodISODateTime>;
    }, z.core.$strict>;
    cursor: z.ZodNullable<z.ZodString>;
    limit: z.ZodNumber;
}, z.core.$strict>;
export type TodosSearchRequest = z.infer<typeof TodosSearchRequestSchema>;
export declare const TodosSavedViewSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodNullable<z.ZodString>;
    query: z.ZodObject<{
        query: z.ZodString;
        filters: z.ZodObject<{
            projectIds: z.ZodArray<z.ZodString>;
            taskListIds: z.ZodArray<z.ZodString>;
            planIds: z.ZodArray<z.ZodString>;
            agentIds: z.ZodArray<z.ZodString>;
            statuses: z.ZodArray<z.ZodEnum<{
                pending: "pending";
                failed: "failed";
                cancelled: "cancelled";
                blocked: "blocked";
                ready: "ready";
                in_progress: "in_progress";
                completed: "completed";
            }>>;
            priorities: z.ZodArray<z.ZodEnum<{
                low: "low";
                medium: "medium";
                high: "high";
                critical: "critical";
            }>>;
            tags: z.ZodArray<z.ZodString>;
            changedAfter: z.ZodNullable<z.ZodISODateTime>;
            dueBefore: z.ZodNullable<z.ZodISODateTime>;
        }, z.core.$strict>;
        cursor: z.ZodNullable<z.ZodString>;
        limit: z.ZodNumber;
    }, z.core.$strict>;
    audience: z.ZodEnum<{
        private: "private";
        organization: "organization";
    }>;
    id: z.ZodString;
    owner: z.ZodString;
    version: z.ZodNumber;
    createdAt: z.ZodISODateTime;
    updatedAt: z.ZodISODateTime;
}, z.core.$strict>;
export type TodosSavedView = z.infer<typeof TodosSavedViewSchema>;
export declare const TodosVerificationCommandSchema: z.ZodObject<{
    command: z.ZodString;
    exitCode: z.ZodNumber;
    durationMs: z.ZodNumber;
}, z.core.$strict>;
export declare const TodosVerificationCheckSchema: z.ZodObject<{
    name: z.ZodString;
    status: z.ZodEnum<{
        skipped: "skipped";
        failed: "failed";
        passed: "passed";
    }>;
    summary: z.ZodNullable<z.ZodString>;
    durationMs: z.ZodNullable<z.ZodNumber>;
}, z.core.$strict>;
export declare const TodosVerificationEvidenceSchema: z.ZodObject<{
    taskId: z.ZodNullable<z.ZodString>;
    runId: z.ZodNullable<z.ZodString>;
    verifierRef: z.ZodObject<{
        owner: z.ZodString;
        id: z.ZodString;
        digest: z.ZodString;
    }, z.core.$strict>;
    status: z.ZodEnum<{
        failed: "failed";
        passed: "passed";
        inconclusive: "inconclusive";
    }>;
    summary: z.ZodString;
    confidence: z.ZodNullable<z.ZodNumber>;
    commands: z.ZodArray<z.ZodObject<{
        command: z.ZodString;
        exitCode: z.ZodNumber;
        durationMs: z.ZodNumber;
    }, z.core.$strict>>;
    checks: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        status: z.ZodEnum<{
            skipped: "skipped";
            failed: "failed";
            passed: "passed";
        }>;
        summary: z.ZodNullable<z.ZodString>;
        durationMs: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strict>>;
    contentRefs: z.ZodArray<z.ZodObject<{
        algorithm: z.ZodLiteral<"sha256">;
        digest: z.ZodString;
        mediaType: z.ZodString;
        byteLength: z.ZodNumber;
    }, z.core.$strict>>;
    startedAt: z.ZodISODateTime;
    completedAt: z.ZodNullable<z.ZodISODateTime>;
    id: z.ZodString;
    owner: z.ZodString;
    version: z.ZodNumber;
    createdAt: z.ZodISODateTime;
    updatedAt: z.ZodISODateTime;
}, z.core.$strict>;
export type TodosVerificationEvidence = z.infer<typeof TodosVerificationEvidenceSchema>;
export declare const TodosTaskFileSchema: z.ZodObject<{
    taskId: z.ZodString;
    logicalName: z.ZodString;
    relativePath: z.ZodNullable<z.ZodString>;
    contentRef: z.ZodObject<{
        algorithm: z.ZodLiteral<"sha256">;
        digest: z.ZodString;
        mediaType: z.ZodString;
        byteLength: z.ZodNumber;
    }, z.core.$strict>;
    purpose: z.ZodEnum<{
        attachment: "attachment";
        evidence: "evidence";
        deliverable: "deliverable";
    }>;
    id: z.ZodString;
    owner: z.ZodString;
    version: z.ZodNumber;
    createdAt: z.ZodISODateTime;
    updatedAt: z.ZodISODateTime;
}, z.core.$strict>;
export type TodosTaskFile = z.infer<typeof TodosTaskFileSchema>;
export declare const TodosRunStatusSchema: z.ZodEnum<{
    running: "running";
    succeeded: "succeeded";
    failed: "failed";
    cancelled: "cancelled";
    queued: "queued";
}>;
export declare const TodosRunSchema: z.ZodObject<{
    objective: z.ZodString;
    status: z.ZodEnum<{
        running: "running";
        succeeded: "succeeded";
        failed: "failed";
        cancelled: "cancelled";
        queued: "queued";
    }>;
    taskIds: z.ZodArray<z.ZodString>;
    planId: z.ZodNullable<z.ZodString>;
    agentId: z.ZodNullable<z.ZodString>;
    startedAt: z.ZodNullable<z.ZodISODateTime>;
    completedAt: z.ZodNullable<z.ZodISODateTime>;
    ledgerDigest: z.ZodString;
    id: z.ZodString;
    owner: z.ZodString;
    version: z.ZodNumber;
    createdAt: z.ZodISODateTime;
    updatedAt: z.ZodISODateTime;
}, z.core.$strict>;
export type TodosRun = z.infer<typeof TodosRunSchema>;
export declare const TodosRunEventSchema: z.ZodObject<{
    runId: z.ZodString;
    sequence: z.ZodNumber;
    type: z.ZodString;
    summary: z.ZodString;
    occurredAt: z.ZodISODateTime;
    evidenceIds: z.ZodArray<z.ZodString>;
    id: z.ZodString;
    owner: z.ZodString;
    version: z.ZodNumber;
    createdAt: z.ZodISODateTime;
    updatedAt: z.ZodISODateTime;
}, z.core.$strict>;
export type TodosRunEvent = z.infer<typeof TodosRunEventSchema>;
export declare const TodosRunCommandSchema: z.ZodObject<{
    runId: z.ZodString;
    sequence: z.ZodNumber;
    command: z.ZodString;
    exitCode: z.ZodNullable<z.ZodNumber>;
    durationMs: z.ZodNullable<z.ZodNumber>;
    outputRefs: z.ZodArray<z.ZodObject<{
        algorithm: z.ZodLiteral<"sha256">;
        digest: z.ZodString;
        mediaType: z.ZodString;
        byteLength: z.ZodNumber;
    }, z.core.$strict>>;
    completedAt: z.ZodNullable<z.ZodISODateTime>;
    id: z.ZodString;
    owner: z.ZodString;
    version: z.ZodNumber;
    createdAt: z.ZodISODateTime;
    updatedAt: z.ZodISODateTime;
}, z.core.$strict>;
export type TodosRunCommand = z.infer<typeof TodosRunCommandSchema>;
export declare const TodosRunFileSchema: z.ZodObject<{
    runId: z.ZodString;
    logicalName: z.ZodString;
    relativePath: z.ZodNullable<z.ZodString>;
    contentRef: z.ZodObject<{
        algorithm: z.ZodLiteral<"sha256">;
        digest: z.ZodString;
        mediaType: z.ZodString;
        byteLength: z.ZodNumber;
    }, z.core.$strict>;
    role: z.ZodEnum<{
        output: "output";
        input: "input";
        evidence: "evidence";
    }>;
    id: z.ZodString;
    owner: z.ZodString;
    version: z.ZodNumber;
    createdAt: z.ZodISODateTime;
    updatedAt: z.ZodISODateTime;
}, z.core.$strict>;
export type TodosRunFile = z.infer<typeof TodosRunFileSchema>;
export declare const TodosRunArtifactSchema: z.ZodObject<{
    runId: z.ZodString;
    name: z.ZodString;
    kind: z.ZodString;
    contentRef: z.ZodObject<{
        algorithm: z.ZodLiteral<"sha256">;
        digest: z.ZodString;
        mediaType: z.ZodString;
        byteLength: z.ZodNumber;
    }, z.core.$strict>;
    verified: z.ZodBoolean;
    verificationEvidenceId: z.ZodNullable<z.ZodString>;
    id: z.ZodString;
    owner: z.ZodString;
    version: z.ZodNumber;
    createdAt: z.ZodISODateTime;
    updatedAt: z.ZodISODateTime;
}, z.core.$strict>;
export type TodosRunArtifact = z.infer<typeof TodosRunArtifactSchema>;
export declare const TodosGitObjectIdSchema: z.ZodObject<{
    algorithm: z.ZodEnum<{
        sha256: "sha256";
        sha1: "sha1";
    }>;
    value: z.ZodString;
}, z.core.$strict>;
export type TodosGitObjectId = z.infer<typeof TodosGitObjectIdSchema>;
export declare const TodosGitCommitSchema: z.ZodObject<{
    repositoryRef: z.ZodObject<{
        owner: z.ZodString;
        id: z.ZodString;
        digest: z.ZodString;
    }, z.core.$strict>;
    objectId: z.ZodObject<{
        algorithm: z.ZodEnum<{
            sha256: "sha256";
            sha1: "sha1";
        }>;
        value: z.ZodString;
    }, z.core.$strict>;
    message: z.ZodString;
    authorRef: z.ZodObject<{
        owner: z.ZodString;
        id: z.ZodString;
        digest: z.ZodString;
    }, z.core.$strict>;
    committedAt: z.ZodISODateTime;
    changedFiles: z.ZodArray<z.ZodString>;
    id: z.ZodString;
    owner: z.ZodString;
    version: z.ZodNumber;
    createdAt: z.ZodISODateTime;
    updatedAt: z.ZodISODateTime;
}, z.core.$strict>;
export type TodosGitCommit = z.infer<typeof TodosGitCommitSchema>;
export declare const TodosGitRefSchema: z.ZodObject<{
    repositoryRef: z.ZodObject<{
        owner: z.ZodString;
        id: z.ZodString;
        digest: z.ZodString;
    }, z.core.$strict>;
    type: z.ZodEnum<{
        branch: "branch";
        pull_request: "pull_request";
        tag: "tag";
    }>;
    name: z.ZodString;
    target: z.ZodObject<{
        algorithm: z.ZodEnum<{
            sha256: "sha256";
            sha1: "sha1";
        }>;
        value: z.ZodString;
    }, z.core.$strict>;
    published: z.ZodBoolean;
    providerObservedAt: z.ZodNullable<z.ZodISODateTime>;
    id: z.ZodString;
    owner: z.ZodString;
    version: z.ZodNumber;
    createdAt: z.ZodISODateTime;
    updatedAt: z.ZodISODateTime;
}, z.core.$strict>;
export type TodosGitRef = z.infer<typeof TodosGitRefSchema>;
export declare const TodosTraceabilitySchema: z.ZodObject<{
    taskId: z.ZodString;
    commitIds: z.ZodArray<z.ZodString>;
    gitRefIds: z.ZodArray<z.ZodString>;
    verificationEvidenceIds: z.ZodArray<z.ZodString>;
    projectionIds: z.ZodArray<z.ZodString>;
    id: z.ZodString;
    owner: z.ZodString;
    version: z.ZodNumber;
    createdAt: z.ZodISODateTime;
    updatedAt: z.ZodISODateTime;
}, z.core.$strict>;
export type TodosTraceability = z.infer<typeof TodosTraceabilitySchema>;
export declare const TodosTaskTemplateSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodNullable<z.ZodString>;
    titlePattern: z.ZodString;
    descriptionPattern: z.ZodNullable<z.ZodString>;
    priority: z.ZodEnum<{
        low: "low";
        medium: "medium";
        high: "high";
        critical: "critical";
    }>;
    tags: z.ZodArray<z.ZodString>;
    acceptanceCriteria: z.ZodArray<z.ZodString>;
    id: z.ZodString;
    owner: z.ZodString;
    version: z.ZodNumber;
    createdAt: z.ZodISODateTime;
    updatedAt: z.ZodISODateTime;
}, z.core.$strict>;
export type TodosTaskTemplate = z.infer<typeof TodosTaskTemplateSchema>;
export declare const TodosApprovalSchema: z.ZodObject<{
    resourceRef: z.ZodObject<{
        owner: z.ZodString;
        kind: z.ZodString;
        id: z.ZodString;
        digest: z.ZodString;
    }, z.core.$strict>;
    status: z.ZodEnum<{
        pending: "pending";
        rejected: "rejected";
        expired: "expired";
        approved: "approved";
    }>;
    reason: z.ZodString;
    requestedBy: z.ZodObject<{
        owner: z.ZodString;
        id: z.ZodString;
        digest: z.ZodString;
    }, z.core.$strict>;
    decidedBy: z.ZodNullable<z.ZodObject<{
        owner: z.ZodString;
        id: z.ZodString;
        digest: z.ZodString;
    }, z.core.$strict>>;
    requestedAt: z.ZodISODateTime;
    decidedAt: z.ZodNullable<z.ZodISODateTime>;
    expiresAt: z.ZodNullable<z.ZodISODateTime>;
    id: z.ZodString;
    owner: z.ZodString;
    version: z.ZodNumber;
    createdAt: z.ZodISODateTime;
    updatedAt: z.ZodISODateTime;
}, z.core.$strict>;
export type TodosApproval = z.infer<typeof TodosApprovalSchema>;
export declare const TodosDeletionRecordSchema: z.ZodObject<{
    id: z.ZodString;
    owner: z.ZodString;
    entityKind: z.ZodString;
    entityIdDigest: z.ZodString;
    priorRecordDigest: z.ZodString;
    tombstoneVersion: z.ZodNumber;
    redaction: z.ZodLiteral<"full">;
    reasonCode: z.ZodString;
    deletedAt: z.ZodISODateTime;
}, z.core.$strict>;
export type TodosDeletionRecord = z.infer<typeof TodosDeletionRecordSchema>;
export declare const TodosTaskContextSchema: z.ZodObject<{
    task: z.ZodObject<{
        shortId: z.ZodNullable<z.ZodString>;
        title: z.ZodString;
        description: z.ZodNullable<z.ZodString>;
        status: z.ZodEnum<{
            pending: "pending";
            failed: "failed";
            cancelled: "cancelled";
            blocked: "blocked";
            ready: "ready";
            in_progress: "in_progress";
            completed: "completed";
        }>;
        priority: z.ZodEnum<{
            low: "low";
            medium: "medium";
            high: "high";
            critical: "critical";
        }>;
        projectId: z.ZodNullable<z.ZodString>;
        taskListId: z.ZodNullable<z.ZodString>;
        planId: z.ZodNullable<z.ZodString>;
        parentTaskId: z.ZodNullable<z.ZodString>;
        assignedAgentId: z.ZodNullable<z.ZodString>;
        fingerprint: z.ZodNullable<z.ZodString>;
        tags: z.ZodArray<z.ZodString>;
        acceptanceCriteria: z.ZodArray<z.ZodString>;
        dueAt: z.ZodNullable<z.ZodISODateTime>;
        completedAt: z.ZodNullable<z.ZodISODateTime>;
        externalOwnerRefs: z.ZodArray<z.ZodObject<{
            owner: z.ZodString;
            id: z.ZodString;
            digest: z.ZodString;
        }, z.core.$strict>>;
        id: z.ZodString;
        owner: z.ZodString;
        version: z.ZodNumber;
        createdAt: z.ZodISODateTime;
        updatedAt: z.ZodISODateTime;
    }, z.core.$strict>;
    project: z.ZodNullable<z.ZodObject<{
        slug: z.ZodString;
        name: z.ZodString;
        description: z.ZodNullable<z.ZodString>;
        repositoryRef: z.ZodNullable<z.ZodObject<{
            owner: z.ZodString;
            id: z.ZodString;
            digest: z.ZodString;
        }, z.core.$strict>>;
        archivedAt: z.ZodNullable<z.ZodISODateTime>;
        id: z.ZodString;
        owner: z.ZodString;
        version: z.ZodNumber;
        createdAt: z.ZodISODateTime;
        updatedAt: z.ZodISODateTime;
    }, z.core.$strict>>;
    taskList: z.ZodNullable<z.ZodObject<{
        projectId: z.ZodNullable<z.ZodString>;
        slug: z.ZodString;
        name: z.ZodString;
        description: z.ZodNullable<z.ZodString>;
        archivedAt: z.ZodNullable<z.ZodISODateTime>;
        id: z.ZodString;
        owner: z.ZodString;
        version: z.ZodNumber;
        createdAt: z.ZodISODateTime;
        updatedAt: z.ZodISODateTime;
    }, z.core.$strict>>;
    plan: z.ZodNullable<z.ZodObject<{
        slug: z.ZodString;
        projectId: z.ZodNullable<z.ZodString>;
        taskListId: z.ZodNullable<z.ZodString>;
        name: z.ZodString;
        description: z.ZodNullable<z.ZodString>;
        status: z.ZodEnum<{
            draft: "draft";
            active: "active";
            archived: "archived";
            completed: "completed";
        }>;
        objective: z.ZodString;
        taskIds: z.ZodArray<z.ZodString>;
        completedAt: z.ZodNullable<z.ZodISODateTime>;
        id: z.ZodString;
        owner: z.ZodString;
        version: z.ZodNumber;
        createdAt: z.ZodISODateTime;
        updatedAt: z.ZodISODateTime;
    }, z.core.$strict>>;
    comments: z.ZodArray<z.ZodObject<{
        taskId: z.ZodString;
        authorRef: z.ZodObject<{
            owner: z.ZodString;
            id: z.ZodString;
            digest: z.ZodString;
        }, z.core.$strict>;
        kind: z.ZodEnum<{
            comment: "comment";
            note: "note";
            progress: "progress";
        }>;
        content: z.ZodString;
        progressPercent: z.ZodNullable<z.ZodNumber>;
        id: z.ZodString;
        owner: z.ZodString;
        version: z.ZodNumber;
        createdAt: z.ZodISODateTime;
        updatedAt: z.ZodISODateTime;
    }, z.core.$strict>>;
    dependencies: z.ZodArray<z.ZodObject<{
        sourceTaskId: z.ZodString;
        targetTaskId: z.ZodString;
        kind: z.ZodEnum<{
            requires: "requires";
            blocks: "blocks";
        }>;
        id: z.ZodString;
        owner: z.ZodString;
        version: z.ZodNumber;
        createdAt: z.ZodISODateTime;
        updatedAt: z.ZodISODateTime;
    }, z.core.$strict>>;
    verificationEvidence: z.ZodArray<z.ZodObject<{
        taskId: z.ZodNullable<z.ZodString>;
        runId: z.ZodNullable<z.ZodString>;
        verifierRef: z.ZodObject<{
            owner: z.ZodString;
            id: z.ZodString;
            digest: z.ZodString;
        }, z.core.$strict>;
        status: z.ZodEnum<{
            failed: "failed";
            passed: "passed";
            inconclusive: "inconclusive";
        }>;
        summary: z.ZodString;
        confidence: z.ZodNullable<z.ZodNumber>;
        commands: z.ZodArray<z.ZodObject<{
            command: z.ZodString;
            exitCode: z.ZodNumber;
            durationMs: z.ZodNumber;
        }, z.core.$strict>>;
        checks: z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            status: z.ZodEnum<{
                skipped: "skipped";
                failed: "failed";
                passed: "passed";
            }>;
            summary: z.ZodNullable<z.ZodString>;
            durationMs: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strict>>;
        contentRefs: z.ZodArray<z.ZodObject<{
            algorithm: z.ZodLiteral<"sha256">;
            digest: z.ZodString;
            mediaType: z.ZodString;
            byteLength: z.ZodNumber;
        }, z.core.$strict>>;
        startedAt: z.ZodISODateTime;
        completedAt: z.ZodNullable<z.ZodISODateTime>;
        id: z.ZodString;
        owner: z.ZodString;
        version: z.ZodNumber;
        createdAt: z.ZodISODateTime;
        updatedAt: z.ZodISODateTime;
    }, z.core.$strict>>;
    files: z.ZodArray<z.ZodObject<{
        taskId: z.ZodString;
        logicalName: z.ZodString;
        relativePath: z.ZodNullable<z.ZodString>;
        contentRef: z.ZodObject<{
            algorithm: z.ZodLiteral<"sha256">;
            digest: z.ZodString;
            mediaType: z.ZodString;
            byteLength: z.ZodNumber;
        }, z.core.$strict>;
        purpose: z.ZodEnum<{
            attachment: "attachment";
            evidence: "evidence";
            deliverable: "deliverable";
        }>;
        id: z.ZodString;
        owner: z.ZodString;
        version: z.ZodNumber;
        createdAt: z.ZodISODateTime;
        updatedAt: z.ZodISODateTime;
    }, z.core.$strict>>;
    traceability: z.ZodNullable<z.ZodObject<{
        taskId: z.ZodString;
        commitIds: z.ZodArray<z.ZodString>;
        gitRefIds: z.ZodArray<z.ZodString>;
        verificationEvidenceIds: z.ZodArray<z.ZodString>;
        projectionIds: z.ZodArray<z.ZodString>;
        id: z.ZodString;
        owner: z.ZodString;
        version: z.ZodNumber;
        createdAt: z.ZodISODateTime;
        updatedAt: z.ZodISODateTime;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type TodosTaskContext = z.infer<typeof TodosTaskContextSchema>;
export declare const TodosStatsSchema: z.ZodObject<{
    asOfDate: z.ZodISODate;
    tasks: z.ZodObject<{
        total: z.ZodNumber;
        pending: z.ZodNumber;
        ready: z.ZodNumber;
        inProgress: z.ZodNumber;
        blocked: z.ZodNumber;
        completed: z.ZodNumber;
        failed: z.ZodNumber;
        cancelled: z.ZodNumber;
    }, z.core.$strict>;
    projects: z.ZodNumber;
    plans: z.ZodNumber;
    activeAgents: z.ZodNumber;
    activeRuns: z.ZodNumber;
}, z.core.$strict>;
export type TodosStats = z.infer<typeof TodosStatsSchema>;
export declare const TODOS_DOMAIN_SCHEMAS: Readonly<{
    "hasna.todos.owner_qualified_ref.v1": z.ZodObject<{
        owner: z.ZodString;
        kind: z.ZodString;
        id: z.ZodString;
        digest: z.ZodString;
    }, z.core.$strict>;
    "hasna.todos.external_owner_ref.v1": z.ZodObject<{
        owner: z.ZodString;
        id: z.ZodString;
        digest: z.ZodString;
    }, z.core.$strict>;
    "hasna.todos.task.v1": z.ZodObject<{
        shortId: z.ZodNullable<z.ZodString>;
        title: z.ZodString;
        description: z.ZodNullable<z.ZodString>;
        status: z.ZodEnum<{
            pending: "pending";
            failed: "failed";
            cancelled: "cancelled";
            blocked: "blocked";
            ready: "ready";
            in_progress: "in_progress";
            completed: "completed";
        }>;
        priority: z.ZodEnum<{
            low: "low";
            medium: "medium";
            high: "high";
            critical: "critical";
        }>;
        projectId: z.ZodNullable<z.ZodString>;
        taskListId: z.ZodNullable<z.ZodString>;
        planId: z.ZodNullable<z.ZodString>;
        parentTaskId: z.ZodNullable<z.ZodString>;
        assignedAgentId: z.ZodNullable<z.ZodString>;
        fingerprint: z.ZodNullable<z.ZodString>;
        tags: z.ZodArray<z.ZodString>;
        acceptanceCriteria: z.ZodArray<z.ZodString>;
        dueAt: z.ZodNullable<z.ZodISODateTime>;
        completedAt: z.ZodNullable<z.ZodISODateTime>;
        externalOwnerRefs: z.ZodArray<z.ZodObject<{
            owner: z.ZodString;
            id: z.ZodString;
            digest: z.ZodString;
        }, z.core.$strict>>;
        id: z.ZodString;
        owner: z.ZodString;
        version: z.ZodNumber;
        createdAt: z.ZodISODateTime;
        updatedAt: z.ZodISODateTime;
    }, z.core.$strict>;
    "hasna.todos.project.v1": z.ZodObject<{
        slug: z.ZodString;
        name: z.ZodString;
        description: z.ZodNullable<z.ZodString>;
        repositoryRef: z.ZodNullable<z.ZodObject<{
            owner: z.ZodString;
            id: z.ZodString;
            digest: z.ZodString;
        }, z.core.$strict>>;
        archivedAt: z.ZodNullable<z.ZodISODateTime>;
        id: z.ZodString;
        owner: z.ZodString;
        version: z.ZodNumber;
        createdAt: z.ZodISODateTime;
        updatedAt: z.ZodISODateTime;
    }, z.core.$strict>;
    "hasna.todos.task_list.v1": z.ZodObject<{
        projectId: z.ZodNullable<z.ZodString>;
        slug: z.ZodString;
        name: z.ZodString;
        description: z.ZodNullable<z.ZodString>;
        archivedAt: z.ZodNullable<z.ZodISODateTime>;
        id: z.ZodString;
        owner: z.ZodString;
        version: z.ZodNumber;
        createdAt: z.ZodISODateTime;
        updatedAt: z.ZodISODateTime;
    }, z.core.$strict>;
    "hasna.todos.plan.v1": z.ZodObject<{
        slug: z.ZodString;
        projectId: z.ZodNullable<z.ZodString>;
        taskListId: z.ZodNullable<z.ZodString>;
        name: z.ZodString;
        description: z.ZodNullable<z.ZodString>;
        status: z.ZodEnum<{
            draft: "draft";
            active: "active";
            archived: "archived";
            completed: "completed";
        }>;
        objective: z.ZodString;
        taskIds: z.ZodArray<z.ZodString>;
        completedAt: z.ZodNullable<z.ZodISODateTime>;
        id: z.ZodString;
        owner: z.ZodString;
        version: z.ZodNumber;
        createdAt: z.ZodISODateTime;
        updatedAt: z.ZodISODateTime;
    }, z.core.$strict>;
    "hasna.todos.agent.v1": z.ZodObject<{
        displayName: z.ZodString;
        status: z.ZodEnum<{
            active: "active";
            inactive: "inactive";
            released: "released";
        }>;
        roles: z.ZodArray<z.ZodEnum<{
            tenant_admin: "tenant_admin";
            customer_member: "customer_member";
            customer_manager: "customer_manager";
        }>>;
        activeProjectId: z.ZodNullable<z.ZodString>;
        activeTaskListId: z.ZodNullable<z.ZodString>;
        lastHeartbeatAt: z.ZodNullable<z.ZodISODateTime>;
        releasedAt: z.ZodNullable<z.ZodISODateTime>;
        id: z.ZodString;
        owner: z.ZodString;
        version: z.ZodNumber;
        createdAt: z.ZodISODateTime;
        updatedAt: z.ZodISODateTime;
    }, z.core.$strict>;
    "hasna.todos.comment.v1": z.ZodObject<{
        taskId: z.ZodString;
        authorRef: z.ZodObject<{
            owner: z.ZodString;
            id: z.ZodString;
            digest: z.ZodString;
        }, z.core.$strict>;
        kind: z.ZodEnum<{
            comment: "comment";
            note: "note";
            progress: "progress";
        }>;
        content: z.ZodString;
        progressPercent: z.ZodNullable<z.ZodNumber>;
        id: z.ZodString;
        owner: z.ZodString;
        version: z.ZodNumber;
        createdAt: z.ZodISODateTime;
        updatedAt: z.ZodISODateTime;
    }, z.core.$strict>;
    "hasna.todos.dependency.v1": z.ZodObject<{
        sourceTaskId: z.ZodString;
        targetTaskId: z.ZodString;
        kind: z.ZodEnum<{
            requires: "requires";
            blocks: "blocks";
        }>;
        id: z.ZodString;
        owner: z.ZodString;
        version: z.ZodNumber;
        createdAt: z.ZodISODateTime;
        updatedAt: z.ZodISODateTime;
    }, z.core.$strict>;
    "hasna.todos.activity.v1": z.ZodObject<{
        actorRef: z.ZodObject<{
            owner: z.ZodString;
            id: z.ZodString;
            digest: z.ZodString;
        }, z.core.$strict>;
        resourceRef: z.ZodObject<{
            owner: z.ZodString;
            kind: z.ZodString;
            id: z.ZodString;
            digest: z.ZodString;
        }, z.core.$strict>;
        action: z.ZodString;
        summary: z.ZodString;
        occurredAt: z.ZodISODateTime;
        id: z.ZodString;
        owner: z.ZodString;
        version: z.ZodNumber;
        createdAt: z.ZodISODateTime;
        updatedAt: z.ZodISODateTime;
    }, z.core.$strict>;
    "hasna.todos.saved_view.v1": z.ZodObject<{
        name: z.ZodString;
        description: z.ZodNullable<z.ZodString>;
        query: z.ZodObject<{
            query: z.ZodString;
            filters: z.ZodObject<{
                projectIds: z.ZodArray<z.ZodString>;
                taskListIds: z.ZodArray<z.ZodString>;
                planIds: z.ZodArray<z.ZodString>;
                agentIds: z.ZodArray<z.ZodString>;
                statuses: z.ZodArray<z.ZodEnum<{
                    pending: "pending";
                    failed: "failed";
                    cancelled: "cancelled";
                    blocked: "blocked";
                    ready: "ready";
                    in_progress: "in_progress";
                    completed: "completed";
                }>>;
                priorities: z.ZodArray<z.ZodEnum<{
                    low: "low";
                    medium: "medium";
                    high: "high";
                    critical: "critical";
                }>>;
                tags: z.ZodArray<z.ZodString>;
                changedAfter: z.ZodNullable<z.ZodISODateTime>;
                dueBefore: z.ZodNullable<z.ZodISODateTime>;
            }, z.core.$strict>;
            cursor: z.ZodNullable<z.ZodString>;
            limit: z.ZodNumber;
        }, z.core.$strict>;
        audience: z.ZodEnum<{
            private: "private";
            organization: "organization";
        }>;
        id: z.ZodString;
        owner: z.ZodString;
        version: z.ZodNumber;
        createdAt: z.ZodISODateTime;
        updatedAt: z.ZodISODateTime;
    }, z.core.$strict>;
    "hasna.todos.search_request.v1": z.ZodObject<{
        query: z.ZodString;
        filters: z.ZodObject<{
            projectIds: z.ZodArray<z.ZodString>;
            taskListIds: z.ZodArray<z.ZodString>;
            planIds: z.ZodArray<z.ZodString>;
            agentIds: z.ZodArray<z.ZodString>;
            statuses: z.ZodArray<z.ZodEnum<{
                pending: "pending";
                failed: "failed";
                cancelled: "cancelled";
                blocked: "blocked";
                ready: "ready";
                in_progress: "in_progress";
                completed: "completed";
            }>>;
            priorities: z.ZodArray<z.ZodEnum<{
                low: "low";
                medium: "medium";
                high: "high";
                critical: "critical";
            }>>;
            tags: z.ZodArray<z.ZodString>;
            changedAfter: z.ZodNullable<z.ZodISODateTime>;
            dueBefore: z.ZodNullable<z.ZodISODateTime>;
        }, z.core.$strict>;
        cursor: z.ZodNullable<z.ZodString>;
        limit: z.ZodNumber;
    }, z.core.$strict>;
    "hasna.todos.verification_evidence.v1": z.ZodObject<{
        taskId: z.ZodNullable<z.ZodString>;
        runId: z.ZodNullable<z.ZodString>;
        verifierRef: z.ZodObject<{
            owner: z.ZodString;
            id: z.ZodString;
            digest: z.ZodString;
        }, z.core.$strict>;
        status: z.ZodEnum<{
            failed: "failed";
            passed: "passed";
            inconclusive: "inconclusive";
        }>;
        summary: z.ZodString;
        confidence: z.ZodNullable<z.ZodNumber>;
        commands: z.ZodArray<z.ZodObject<{
            command: z.ZodString;
            exitCode: z.ZodNumber;
            durationMs: z.ZodNumber;
        }, z.core.$strict>>;
        checks: z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            status: z.ZodEnum<{
                skipped: "skipped";
                failed: "failed";
                passed: "passed";
            }>;
            summary: z.ZodNullable<z.ZodString>;
            durationMs: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strict>>;
        contentRefs: z.ZodArray<z.ZodObject<{
            algorithm: z.ZodLiteral<"sha256">;
            digest: z.ZodString;
            mediaType: z.ZodString;
            byteLength: z.ZodNumber;
        }, z.core.$strict>>;
        startedAt: z.ZodISODateTime;
        completedAt: z.ZodNullable<z.ZodISODateTime>;
        id: z.ZodString;
        owner: z.ZodString;
        version: z.ZodNumber;
        createdAt: z.ZodISODateTime;
        updatedAt: z.ZodISODateTime;
    }, z.core.$strict>;
    "hasna.todos.task_file.v1": z.ZodObject<{
        taskId: z.ZodString;
        logicalName: z.ZodString;
        relativePath: z.ZodNullable<z.ZodString>;
        contentRef: z.ZodObject<{
            algorithm: z.ZodLiteral<"sha256">;
            digest: z.ZodString;
            mediaType: z.ZodString;
            byteLength: z.ZodNumber;
        }, z.core.$strict>;
        purpose: z.ZodEnum<{
            attachment: "attachment";
            evidence: "evidence";
            deliverable: "deliverable";
        }>;
        id: z.ZodString;
        owner: z.ZodString;
        version: z.ZodNumber;
        createdAt: z.ZodISODateTime;
        updatedAt: z.ZodISODateTime;
    }, z.core.$strict>;
    "hasna.todos.run.v1": z.ZodObject<{
        objective: z.ZodString;
        status: z.ZodEnum<{
            running: "running";
            succeeded: "succeeded";
            failed: "failed";
            cancelled: "cancelled";
            queued: "queued";
        }>;
        taskIds: z.ZodArray<z.ZodString>;
        planId: z.ZodNullable<z.ZodString>;
        agentId: z.ZodNullable<z.ZodString>;
        startedAt: z.ZodNullable<z.ZodISODateTime>;
        completedAt: z.ZodNullable<z.ZodISODateTime>;
        ledgerDigest: z.ZodString;
        id: z.ZodString;
        owner: z.ZodString;
        version: z.ZodNumber;
        createdAt: z.ZodISODateTime;
        updatedAt: z.ZodISODateTime;
    }, z.core.$strict>;
    "hasna.todos.run_event.v1": z.ZodObject<{
        runId: z.ZodString;
        sequence: z.ZodNumber;
        type: z.ZodString;
        summary: z.ZodString;
        occurredAt: z.ZodISODateTime;
        evidenceIds: z.ZodArray<z.ZodString>;
        id: z.ZodString;
        owner: z.ZodString;
        version: z.ZodNumber;
        createdAt: z.ZodISODateTime;
        updatedAt: z.ZodISODateTime;
    }, z.core.$strict>;
    "hasna.todos.run_command.v1": z.ZodObject<{
        runId: z.ZodString;
        sequence: z.ZodNumber;
        command: z.ZodString;
        exitCode: z.ZodNullable<z.ZodNumber>;
        durationMs: z.ZodNullable<z.ZodNumber>;
        outputRefs: z.ZodArray<z.ZodObject<{
            algorithm: z.ZodLiteral<"sha256">;
            digest: z.ZodString;
            mediaType: z.ZodString;
            byteLength: z.ZodNumber;
        }, z.core.$strict>>;
        completedAt: z.ZodNullable<z.ZodISODateTime>;
        id: z.ZodString;
        owner: z.ZodString;
        version: z.ZodNumber;
        createdAt: z.ZodISODateTime;
        updatedAt: z.ZodISODateTime;
    }, z.core.$strict>;
    "hasna.todos.run_file.v1": z.ZodObject<{
        runId: z.ZodString;
        logicalName: z.ZodString;
        relativePath: z.ZodNullable<z.ZodString>;
        contentRef: z.ZodObject<{
            algorithm: z.ZodLiteral<"sha256">;
            digest: z.ZodString;
            mediaType: z.ZodString;
            byteLength: z.ZodNumber;
        }, z.core.$strict>;
        role: z.ZodEnum<{
            output: "output";
            input: "input";
            evidence: "evidence";
        }>;
        id: z.ZodString;
        owner: z.ZodString;
        version: z.ZodNumber;
        createdAt: z.ZodISODateTime;
        updatedAt: z.ZodISODateTime;
    }, z.core.$strict>;
    "hasna.todos.run_artifact.v1": z.ZodObject<{
        runId: z.ZodString;
        name: z.ZodString;
        kind: z.ZodString;
        contentRef: z.ZodObject<{
            algorithm: z.ZodLiteral<"sha256">;
            digest: z.ZodString;
            mediaType: z.ZodString;
            byteLength: z.ZodNumber;
        }, z.core.$strict>;
        verified: z.ZodBoolean;
        verificationEvidenceId: z.ZodNullable<z.ZodString>;
        id: z.ZodString;
        owner: z.ZodString;
        version: z.ZodNumber;
        createdAt: z.ZodISODateTime;
        updatedAt: z.ZodISODateTime;
    }, z.core.$strict>;
    "hasna.todos.git_object_id.v1": z.ZodObject<{
        algorithm: z.ZodEnum<{
            sha256: "sha256";
            sha1: "sha1";
        }>;
        value: z.ZodString;
    }, z.core.$strict>;
    "hasna.todos.git_commit.v1": z.ZodObject<{
        repositoryRef: z.ZodObject<{
            owner: z.ZodString;
            id: z.ZodString;
            digest: z.ZodString;
        }, z.core.$strict>;
        objectId: z.ZodObject<{
            algorithm: z.ZodEnum<{
                sha256: "sha256";
                sha1: "sha1";
            }>;
            value: z.ZodString;
        }, z.core.$strict>;
        message: z.ZodString;
        authorRef: z.ZodObject<{
            owner: z.ZodString;
            id: z.ZodString;
            digest: z.ZodString;
        }, z.core.$strict>;
        committedAt: z.ZodISODateTime;
        changedFiles: z.ZodArray<z.ZodString>;
        id: z.ZodString;
        owner: z.ZodString;
        version: z.ZodNumber;
        createdAt: z.ZodISODateTime;
        updatedAt: z.ZodISODateTime;
    }, z.core.$strict>;
    "hasna.todos.git_ref.v1": z.ZodObject<{
        repositoryRef: z.ZodObject<{
            owner: z.ZodString;
            id: z.ZodString;
            digest: z.ZodString;
        }, z.core.$strict>;
        type: z.ZodEnum<{
            branch: "branch";
            pull_request: "pull_request";
            tag: "tag";
        }>;
        name: z.ZodString;
        target: z.ZodObject<{
            algorithm: z.ZodEnum<{
                sha256: "sha256";
                sha1: "sha1";
            }>;
            value: z.ZodString;
        }, z.core.$strict>;
        published: z.ZodBoolean;
        providerObservedAt: z.ZodNullable<z.ZodISODateTime>;
        id: z.ZodString;
        owner: z.ZodString;
        version: z.ZodNumber;
        createdAt: z.ZodISODateTime;
        updatedAt: z.ZodISODateTime;
    }, z.core.$strict>;
    "hasna.todos.traceability.v1": z.ZodObject<{
        taskId: z.ZodString;
        commitIds: z.ZodArray<z.ZodString>;
        gitRefIds: z.ZodArray<z.ZodString>;
        verificationEvidenceIds: z.ZodArray<z.ZodString>;
        projectionIds: z.ZodArray<z.ZodString>;
        id: z.ZodString;
        owner: z.ZodString;
        version: z.ZodNumber;
        createdAt: z.ZodISODateTime;
        updatedAt: z.ZodISODateTime;
    }, z.core.$strict>;
    "hasna.todos.task_template.v1": z.ZodObject<{
        name: z.ZodString;
        description: z.ZodNullable<z.ZodString>;
        titlePattern: z.ZodString;
        descriptionPattern: z.ZodNullable<z.ZodString>;
        priority: z.ZodEnum<{
            low: "low";
            medium: "medium";
            high: "high";
            critical: "critical";
        }>;
        tags: z.ZodArray<z.ZodString>;
        acceptanceCriteria: z.ZodArray<z.ZodString>;
        id: z.ZodString;
        owner: z.ZodString;
        version: z.ZodNumber;
        createdAt: z.ZodISODateTime;
        updatedAt: z.ZodISODateTime;
    }, z.core.$strict>;
    "hasna.todos.approval.v1": z.ZodObject<{
        resourceRef: z.ZodObject<{
            owner: z.ZodString;
            kind: z.ZodString;
            id: z.ZodString;
            digest: z.ZodString;
        }, z.core.$strict>;
        status: z.ZodEnum<{
            pending: "pending";
            rejected: "rejected";
            expired: "expired";
            approved: "approved";
        }>;
        reason: z.ZodString;
        requestedBy: z.ZodObject<{
            owner: z.ZodString;
            id: z.ZodString;
            digest: z.ZodString;
        }, z.core.$strict>;
        decidedBy: z.ZodNullable<z.ZodObject<{
            owner: z.ZodString;
            id: z.ZodString;
            digest: z.ZodString;
        }, z.core.$strict>>;
        requestedAt: z.ZodISODateTime;
        decidedAt: z.ZodNullable<z.ZodISODateTime>;
        expiresAt: z.ZodNullable<z.ZodISODateTime>;
        id: z.ZodString;
        owner: z.ZodString;
        version: z.ZodNumber;
        createdAt: z.ZodISODateTime;
        updatedAt: z.ZodISODateTime;
    }, z.core.$strict>;
    "hasna.todos.deletion_record.v1": z.ZodObject<{
        id: z.ZodString;
        owner: z.ZodString;
        entityKind: z.ZodString;
        entityIdDigest: z.ZodString;
        priorRecordDigest: z.ZodString;
        tombstoneVersion: z.ZodNumber;
        redaction: z.ZodLiteral<"full">;
        reasonCode: z.ZodString;
        deletedAt: z.ZodISODateTime;
    }, z.core.$strict>;
    "hasna.todos.task_context.v1": z.ZodObject<{
        task: z.ZodObject<{
            shortId: z.ZodNullable<z.ZodString>;
            title: z.ZodString;
            description: z.ZodNullable<z.ZodString>;
            status: z.ZodEnum<{
                pending: "pending";
                failed: "failed";
                cancelled: "cancelled";
                blocked: "blocked";
                ready: "ready";
                in_progress: "in_progress";
                completed: "completed";
            }>;
            priority: z.ZodEnum<{
                low: "low";
                medium: "medium";
                high: "high";
                critical: "critical";
            }>;
            projectId: z.ZodNullable<z.ZodString>;
            taskListId: z.ZodNullable<z.ZodString>;
            planId: z.ZodNullable<z.ZodString>;
            parentTaskId: z.ZodNullable<z.ZodString>;
            assignedAgentId: z.ZodNullable<z.ZodString>;
            fingerprint: z.ZodNullable<z.ZodString>;
            tags: z.ZodArray<z.ZodString>;
            acceptanceCriteria: z.ZodArray<z.ZodString>;
            dueAt: z.ZodNullable<z.ZodISODateTime>;
            completedAt: z.ZodNullable<z.ZodISODateTime>;
            externalOwnerRefs: z.ZodArray<z.ZodObject<{
                owner: z.ZodString;
                id: z.ZodString;
                digest: z.ZodString;
            }, z.core.$strict>>;
            id: z.ZodString;
            owner: z.ZodString;
            version: z.ZodNumber;
            createdAt: z.ZodISODateTime;
            updatedAt: z.ZodISODateTime;
        }, z.core.$strict>;
        project: z.ZodNullable<z.ZodObject<{
            slug: z.ZodString;
            name: z.ZodString;
            description: z.ZodNullable<z.ZodString>;
            repositoryRef: z.ZodNullable<z.ZodObject<{
                owner: z.ZodString;
                id: z.ZodString;
                digest: z.ZodString;
            }, z.core.$strict>>;
            archivedAt: z.ZodNullable<z.ZodISODateTime>;
            id: z.ZodString;
            owner: z.ZodString;
            version: z.ZodNumber;
            createdAt: z.ZodISODateTime;
            updatedAt: z.ZodISODateTime;
        }, z.core.$strict>>;
        taskList: z.ZodNullable<z.ZodObject<{
            projectId: z.ZodNullable<z.ZodString>;
            slug: z.ZodString;
            name: z.ZodString;
            description: z.ZodNullable<z.ZodString>;
            archivedAt: z.ZodNullable<z.ZodISODateTime>;
            id: z.ZodString;
            owner: z.ZodString;
            version: z.ZodNumber;
            createdAt: z.ZodISODateTime;
            updatedAt: z.ZodISODateTime;
        }, z.core.$strict>>;
        plan: z.ZodNullable<z.ZodObject<{
            slug: z.ZodString;
            projectId: z.ZodNullable<z.ZodString>;
            taskListId: z.ZodNullable<z.ZodString>;
            name: z.ZodString;
            description: z.ZodNullable<z.ZodString>;
            status: z.ZodEnum<{
                draft: "draft";
                active: "active";
                archived: "archived";
                completed: "completed";
            }>;
            objective: z.ZodString;
            taskIds: z.ZodArray<z.ZodString>;
            completedAt: z.ZodNullable<z.ZodISODateTime>;
            id: z.ZodString;
            owner: z.ZodString;
            version: z.ZodNumber;
            createdAt: z.ZodISODateTime;
            updatedAt: z.ZodISODateTime;
        }, z.core.$strict>>;
        comments: z.ZodArray<z.ZodObject<{
            taskId: z.ZodString;
            authorRef: z.ZodObject<{
                owner: z.ZodString;
                id: z.ZodString;
                digest: z.ZodString;
            }, z.core.$strict>;
            kind: z.ZodEnum<{
                comment: "comment";
                note: "note";
                progress: "progress";
            }>;
            content: z.ZodString;
            progressPercent: z.ZodNullable<z.ZodNumber>;
            id: z.ZodString;
            owner: z.ZodString;
            version: z.ZodNumber;
            createdAt: z.ZodISODateTime;
            updatedAt: z.ZodISODateTime;
        }, z.core.$strict>>;
        dependencies: z.ZodArray<z.ZodObject<{
            sourceTaskId: z.ZodString;
            targetTaskId: z.ZodString;
            kind: z.ZodEnum<{
                requires: "requires";
                blocks: "blocks";
            }>;
            id: z.ZodString;
            owner: z.ZodString;
            version: z.ZodNumber;
            createdAt: z.ZodISODateTime;
            updatedAt: z.ZodISODateTime;
        }, z.core.$strict>>;
        verificationEvidence: z.ZodArray<z.ZodObject<{
            taskId: z.ZodNullable<z.ZodString>;
            runId: z.ZodNullable<z.ZodString>;
            verifierRef: z.ZodObject<{
                owner: z.ZodString;
                id: z.ZodString;
                digest: z.ZodString;
            }, z.core.$strict>;
            status: z.ZodEnum<{
                failed: "failed";
                passed: "passed";
                inconclusive: "inconclusive";
            }>;
            summary: z.ZodString;
            confidence: z.ZodNullable<z.ZodNumber>;
            commands: z.ZodArray<z.ZodObject<{
                command: z.ZodString;
                exitCode: z.ZodNumber;
                durationMs: z.ZodNumber;
            }, z.core.$strict>>;
            checks: z.ZodArray<z.ZodObject<{
                name: z.ZodString;
                status: z.ZodEnum<{
                    skipped: "skipped";
                    failed: "failed";
                    passed: "passed";
                }>;
                summary: z.ZodNullable<z.ZodString>;
                durationMs: z.ZodNullable<z.ZodNumber>;
            }, z.core.$strict>>;
            contentRefs: z.ZodArray<z.ZodObject<{
                algorithm: z.ZodLiteral<"sha256">;
                digest: z.ZodString;
                mediaType: z.ZodString;
                byteLength: z.ZodNumber;
            }, z.core.$strict>>;
            startedAt: z.ZodISODateTime;
            completedAt: z.ZodNullable<z.ZodISODateTime>;
            id: z.ZodString;
            owner: z.ZodString;
            version: z.ZodNumber;
            createdAt: z.ZodISODateTime;
            updatedAt: z.ZodISODateTime;
        }, z.core.$strict>>;
        files: z.ZodArray<z.ZodObject<{
            taskId: z.ZodString;
            logicalName: z.ZodString;
            relativePath: z.ZodNullable<z.ZodString>;
            contentRef: z.ZodObject<{
                algorithm: z.ZodLiteral<"sha256">;
                digest: z.ZodString;
                mediaType: z.ZodString;
                byteLength: z.ZodNumber;
            }, z.core.$strict>;
            purpose: z.ZodEnum<{
                attachment: "attachment";
                evidence: "evidence";
                deliverable: "deliverable";
            }>;
            id: z.ZodString;
            owner: z.ZodString;
            version: z.ZodNumber;
            createdAt: z.ZodISODateTime;
            updatedAt: z.ZodISODateTime;
        }, z.core.$strict>>;
        traceability: z.ZodNullable<z.ZodObject<{
            taskId: z.ZodString;
            commitIds: z.ZodArray<z.ZodString>;
            gitRefIds: z.ZodArray<z.ZodString>;
            verificationEvidenceIds: z.ZodArray<z.ZodString>;
            projectionIds: z.ZodArray<z.ZodString>;
            id: z.ZodString;
            owner: z.ZodString;
            version: z.ZodNumber;
            createdAt: z.ZodISODateTime;
            updatedAt: z.ZodISODateTime;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    "hasna.todos.stats.v1": z.ZodObject<{
        asOfDate: z.ZodISODate;
        tasks: z.ZodObject<{
            total: z.ZodNumber;
            pending: z.ZodNumber;
            ready: z.ZodNumber;
            inProgress: z.ZodNumber;
            blocked: z.ZodNumber;
            completed: z.ZodNumber;
            failed: z.ZodNumber;
            cancelled: z.ZodNumber;
        }, z.core.$strict>;
        projects: z.ZodNumber;
        plans: z.ZodNumber;
        activeAgents: z.ZodNumber;
        activeRuns: z.ZodNumber;
    }, z.core.$strict>;
}>;
export type TodosTransferFieldClass = "portable" | "reference_only" | "excluded";
export declare const TODOS_DOMAIN_FIELD_CLASSIFICATION: Readonly<{
    "hasna.todos.owner_qualified_ref.v1": Record<string, TodosTransferFieldClass>;
    "hasna.todos.external_owner_ref.v1": Record<string, TodosTransferFieldClass>;
    "hasna.todos.task.v1": Record<string, TodosTransferFieldClass>;
    "hasna.todos.project.v1": Record<string, TodosTransferFieldClass>;
    "hasna.todos.task_list.v1": Record<string, TodosTransferFieldClass>;
    "hasna.todos.plan.v1": Record<string, TodosTransferFieldClass>;
    "hasna.todos.agent.v1": Record<string, TodosTransferFieldClass>;
    "hasna.todos.comment.v1": Record<string, TodosTransferFieldClass>;
    "hasna.todos.dependency.v1": Record<string, TodosTransferFieldClass>;
    "hasna.todos.activity.v1": Record<string, TodosTransferFieldClass>;
    "hasna.todos.saved_view.v1": Record<string, TodosTransferFieldClass>;
    "hasna.todos.search_request.v1": Record<string, TodosTransferFieldClass>;
    "hasna.todos.verification_evidence.v1": Record<string, TodosTransferFieldClass>;
    "hasna.todos.task_file.v1": Record<string, TodosTransferFieldClass>;
    "hasna.todos.run.v1": Record<string, TodosTransferFieldClass>;
    "hasna.todos.run_event.v1": Record<string, TodosTransferFieldClass>;
    "hasna.todos.run_command.v1": Record<string, TodosTransferFieldClass>;
    "hasna.todos.run_file.v1": Record<string, TodosTransferFieldClass>;
    "hasna.todos.run_artifact.v1": Record<string, TodosTransferFieldClass>;
    "hasna.todos.git_object_id.v1": Record<string, TodosTransferFieldClass>;
    "hasna.todos.git_commit.v1": Record<string, TodosTransferFieldClass>;
    "hasna.todos.git_ref.v1": Record<string, TodosTransferFieldClass>;
    "hasna.todos.traceability.v1": Record<string, TodosTransferFieldClass>;
    "hasna.todos.task_template.v1": Record<string, TodosTransferFieldClass>;
    "hasna.todos.approval.v1": Record<string, TodosTransferFieldClass>;
    "hasna.todos.deletion_record.v1": Record<string, TodosTransferFieldClass>;
    "hasna.todos.task_context.v1": Record<string, TodosTransferFieldClass>;
    "hasna.todos.stats.v1": Record<string, TodosTransferFieldClass>;
}>;
