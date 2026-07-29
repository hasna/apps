import { TODOS_OPERATION_MANIFEST_DIGEST } from "@hasna/contracts/todos";
import { createTaskToPrProjectionCloudReader } from "../task-to-pr-projections/remote.js";
import type {
  TaskToPrProjection,
  TaskToPrProjectionListOptions,
  TaskToPrProjectionPage,
  TaskToPrProjectionRebuildInput,
  TaskToPrProjectionRebuildResult,
} from "../task-to-pr-projections/types.js";

type Env = Record<string, string | undefined>;

async function localStore() {
  const [{ getDatabase }, { SqliteTaskToPrProjectionStore }] = await Promise.all([
    import("../db/database.js"),
    import("../task-to-pr-projections/local-sqlite.js"),
  ]);
  return new SqliteTaskToPrProjectionStore(getDatabase());
}

export class TaskToPrProjectionSdkResource {
  constructor(private readonly env: Env = process.env as Env) {}

  async list(options: TaskToPrProjectionListOptions = {}): Promise<TaskToPrProjectionPage> {
    const remote = createTaskToPrProjectionCloudReader(this.env);
    return remote ? remote.list(options) : (await localStore()).list(options);
  }

  async get(ref: string): Promise<TaskToPrProjection | null> {
    const remote = createTaskToPrProjectionCloudReader(this.env);
    return remote ? remote.get(ref) : (await localStore()).get(ref);
  }

  async rebuild(
    input: Partial<TaskToPrProjectionRebuildInput> = {},
  ): Promise<TaskToPrProjectionRebuildResult> {
    if (createTaskToPrProjectionCloudReader(this.env)) {
      throw new Error(
        "REMOTE_OPERATION_UNSUPPORTED: taskToPrProjection.rebuild is local topology only; " +
          "local SQLite fallback is disabled",
      );
    }
    return (await localStore()).rebuild({
      taskRefs: input.taskRefs ?? [],
      expectedManifestDigest: input.expectedManifestDigest ?? TODOS_OPERATION_MANIFEST_DIGEST,
    });
  }
}

export class TaskToPrProjectionSdk {
  readonly taskToPrProjection: TaskToPrProjectionSdkResource;

  constructor(options: { env?: Env } = {}) {
    this.taskToPrProjection = new TaskToPrProjectionSdkResource(options.env);
  }
}

export function createTaskToPrProjectionSdk(
  options: { env?: Env } = {},
): TaskToPrProjectionSdk {
  return new TaskToPrProjectionSdk(options);
}

