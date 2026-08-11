import {
  TodosAiNeedsApprovalSignal,
  TodosAiNeedsInputSignal,
  type TodosAiPendingApproval,
  type TodosAiPendingInput,
} from "@hasna/todos";
import { types as utilTypes } from "node:util";

export type TodosAiControlSignal =
  | TodosAiNeedsInputSignal
  | TodosAiNeedsApprovalSignal;

interface CrossBundleSignalShape {
  name: string;
  message: string;
  payloadKey: "pending_input" | "pending_approval";
}

function ownDataValue(value: object, key: string): { found: true; value: unknown } | null {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !("value" in descriptor)) return null;
  return { found: true, value: descriptor.value };
}

function isObjectValue(value: unknown): value is object {
  return value !== null && typeof value === "object";
}

function containsProxy(value: unknown, ancestors: Set<object>, depth: number): boolean {
  if (!isObjectValue(value)) return false;
  if (utilTypes.isProxy(value)) return true;
  if (depth > 64 || ancestors.has(value)) return false;

  ancestors.add(value);
  try {
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor !== undefined && "value" in descriptor) {
        if (containsProxy(descriptor.value, ancestors, depth + 1)) return true;
      }
    }
  } catch {
    return false;
  } finally {
    ancestors.delete(value);
  }
  return false;
}

function crossBundlePayload(
  value: unknown,
  shape: CrossBundleSignalShape,
): unknown | null {
  if (!isObjectValue(value) || utilTypes.isProxy(value)) return null;
  if (!(value instanceof Error)) return null;
  try {
    const name = ownDataValue(value, "name");
    const message = ownDataValue(value, "message");
    const payload = ownDataValue(value, shape.payloadKey);
    if (
      name?.value !== shape.name ||
      message?.value !== shape.message ||
      payload === null ||
      containsProxy(payload.value, new Set<object>(), 0)
    ) {
      return null;
    }
    return payload.value;
  } catch {
    return null;
  }
}

export function normalizeTodosAiControlSignal(
  value: unknown,
): TodosAiControlSignal | null {
  if (isObjectValue(value) && utilTypes.isProxy(value)) return null;

  if (
    value instanceof TodosAiNeedsInputSignal ||
    value instanceof TodosAiNeedsApprovalSignal
  ) {
    return value;
  }

  const pendingInput = crossBundlePayload(value, {
    name: "TodosAiNeedsInputSignal",
    message: "Todos AI input required",
    payloadKey: "pending_input",
  });
  if (pendingInput !== null) {
    try {
      return new TodosAiNeedsInputSignal(pendingInput as TodosAiPendingInput);
    } catch {
      return null;
    }
  }

  const pendingApproval = crossBundlePayload(value, {
    name: "TodosAiNeedsApprovalSignal",
    message: "Todos AI approval required",
    payloadKey: "pending_approval",
  });
  if (pendingApproval !== null) {
    try {
      return new TodosAiNeedsApprovalSignal(
        pendingApproval as TodosAiPendingApproval,
      );
    } catch {
      return null;
    }
  }

  return null;
}
