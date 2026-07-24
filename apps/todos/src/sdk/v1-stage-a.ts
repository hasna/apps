import {
  ApiError,
  type TodosV1Client as GeneratedTodosV1Client,
  type TodosV1ClientOptions,
} from "./v1.generated.js";

type GeneratedTodosV1ClientPublic = Pick<
  GeneratedTodosV1Client,
  keyof GeneratedTodosV1Client
>;

const PUBLIC_METHODS = [
  "importSnapshot",
  "listPlans",
  "createPlan",
  "getPlan",
  "deletePlan",
  "updatePlan",
  "listProjects",
  "createProject",
  "getProject",
  "deleteProject",
  "updateProject",
  "renameProject",
  "getStats",
  "listTaskLists",
  "createTaskList",
  "getTaskList",
  "deleteTaskList",
  "updateTaskList",
  "listTasks",
  "createTask",
  "getTask",
  "deleteTask",
  "updateTask",
  "listTaskComments",
  "createTaskComment",
  "completeTask",
  "startTask",
] as const satisfies readonly (keyof GeneratedTodosV1Client)[];

const RUNTIME_METHOD_LENGTHS: Record<"request" | typeof PUBLIC_METHODS[number], number> = {
  request: 3,
  importSnapshot: 2,
  listPlans: 2,
  createPlan: 2,
  getPlan: 2,
  deletePlan: 2,
  updatePlan: 3,
  listProjects: 1,
  createProject: 2,
  getProject: 2,
  deleteProject: 2,
  updateProject: 3,
  renameProject: 3,
  getStats: 1,
  listTaskLists: 2,
  createTaskList: 2,
  getTaskList: 2,
  deleteTaskList: 2,
  updateTaskList: 3,
  listTasks: 2,
  createTask: 2,
  getTask: 2,
  deleteTask: 2,
  updateTask: 3,
  listTaskComments: 3,
  createTaskComment: 3,
  completeTask: 2,
  startTask: 2,
};
const PUBLIC_METHODS_COMPLETE: Exclude<
  keyof GeneratedTodosV1Client,
  typeof PUBLIC_METHODS[number]
> extends never ? true : never = true;
void PUBLIC_METHODS_COMPLETE;

function unavailableV1Capability(): never {
  throw new ApiError(
    503,
    "HOSTED_AUTHORITY_UNAVAILABLE: authority_resolver_unavailable",
    {
      code: "HOSTED_AUTHORITY_UNAVAILABLE",
      reason: "authority_resolver_unavailable",
    },
  );
}

function installUnavailableMethods(target: object, methods: Readonly<Record<string, number>>): void {
  for (const [name, length] of Object.entries(methods)) {
    const method = async function (..._args: unknown[]): Promise<never> {
      return unavailableV1Capability();
    };
    Object.defineProperties(method, {
      name: { value: name, configurable: true },
      length: { value: length, configurable: true },
    });
    Object.defineProperty(target, name, {
      value: method,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }
}

/**
 * Stage A preserves the generated client's class/type/prototype contract while
 * removing every executable hosted operation. The constructor intentionally
 * does not inspect its argument, so credentials, headers, and fetch functions
 * are neither read nor retained.
 */
export class TodosV1Client {
  constructor(_options: TodosV1ClientOptions) {
    unavailableV1Capability();
  }
}

/** Public instance shape inherited from the generated client without its private fields. */
export interface TodosV1Client extends GeneratedTodosV1ClientPublic {}

installUnavailableMethods(TodosV1Client.prototype, RUNTIME_METHOD_LENGTHS);

export { ApiError };
