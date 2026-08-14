import { useState } from "react";
import { Box, Text, useInput } from "ink";

interface TaskFormProps {
  onSubmit: (data: { title: string; description?: string; priority?: string }) => void;
  onCancel: () => void;
  initialTitle?: string;
  initialDescription?: string;
  initialPriority?: string;
  mode: "add" | "edit";
}

type Field = "title" | "description" | "priority";

const PRIORITIES = ["low", "medium", "high", "critical"];

export function TaskForm({
  onSubmit,
  onCancel,
  initialTitle = "",
  initialDescription = "",
  initialPriority = "medium",
  mode,
}: TaskFormProps) {
  const [field, setField] = useState<Field>("title");
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [priorityIdx, setPriorityIdx] = useState(
    Math.max(0, PRIORITIES.indexOf(initialPriority)),
  );

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (field === "priority") {
      if (key.leftArrow || input === "h") {
        setPriorityIdx((i) => Math.max(0, i - 1));
      } else if (key.rightArrow || input === "l") {
        setPriorityIdx((i) => Math.min(PRIORITIES.length - 1, i + 1));
      } else if (key.return) {
        onSubmit({
          title,
          description: description || undefined,
          priority: PRIORITIES[priorityIdx],
        });
      } else if (key.tab) {
        setField("title");
      }
      return;
    }

    const [value, setter] =
      field === "title" ? [title, setTitle] : [description, setDescription];

    if (key.return) {
      if (field === "title") {
        setField("description");
      } else {
        setField("priority");
      }
    } else if (key.backspace || key.delete) {
      setter(value.slice(0, -1));
    } else if (key.tab) {
      if (field === "title") setField("description");
      else setField("priority");
    } else if (input && !key.ctrl && !key.meta) {
      setter(value + input);
    }
  });

  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Text bold>{mode === "add" ? "Add Task" : "Edit Task"}</Text>
      <Text dimColor>[tab] next field  [enter] confirm  [esc] cancel</Text>
      <Box marginTop={1}>
        <Text dimColor>Title:    </Text>
        <Text color={field === "title" ? "cyan" : undefined}>
          {title}
          {field === "title" ? "▌" : ""}
        </Text>
      </Box>
      <Box>
        <Text dimColor>Desc:     </Text>
        <Text color={field === "description" ? "cyan" : undefined}>
          {description}
          {field === "description" ? "▌" : ""}
        </Text>
      </Box>
      <Box>
        <Text dimColor>Priority: </Text>
        {PRIORITIES.map((p, i) => (
          <Text
            key={p}
            color={i === priorityIdx && field === "priority" ? "cyan" : undefined}
            bold={i === priorityIdx}
          >
            {i === priorityIdx ? `[${p}]` : ` ${p} `}
            {" "}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
