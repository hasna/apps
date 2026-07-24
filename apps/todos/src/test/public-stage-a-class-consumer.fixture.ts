import { TodosV1Client } from "@hasna/todos/sdk";
import { TodosShadowMirror, TodosShadowOutbox } from "@hasna/todos/storage";

/**
 * External-consumer compile fixture. This file is typechecked with no emit and
 * never executed; each public class must remain usable in the instance/type
 * namespace as well as the runtime/value namespace.
 */
export type PublicStageAClassInstances = [
  TodosV1Client,
  TodosShadowMirror,
  TodosShadowOutbox,
];

export function consumePublicStageAClassInstances(
  client: TodosV1Client,
  mirror: TodosShadowMirror,
  outbox: TodosShadowOutbox,
) {
  return [
    client.listTasks(),
    mirror.getMetrics(),
    outbox.getStats(),
  ] as const;
}
