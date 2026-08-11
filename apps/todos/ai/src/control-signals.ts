import {
  TodosAiNeedsApprovalSignal,
  TodosAiNeedsInputSignal,
  type TodosAiPendingApproval,
  type TodosAiPendingInput,
} from "@hasna/todos";

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

function crossBundlePayload(
  value: unknown,
  shape: CrossBundleSignalShape,
): unknown | null {
  if (!(value instanceof Error)) return null;
  try {
    const name = ownDataValue(value, "name");
    const message = ownDataValue(value, "message");
    const payload = ownDataValue(value, shape.payloadKey);
    if (
      name?.value !== shape.name ||
      message?.value !== shape.message ||
      payload === null
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
