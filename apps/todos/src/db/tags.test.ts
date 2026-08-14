import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeDatabase, getDatabase, resetDatabase } from "./database.js";
import { createTask, getTask, listTasks } from "./tasks.js";
import { createTag, deleteTag, getTag, listTags, updateTag } from "./tags.js";

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("tag metadata", () => {
  test("manages tag metadata while syncing task tag assignments", () => {
    const task = createTask({ title: "Tagged task", tags: ["bug"] });

    expect(listTags().map((tag) => ({ name: tag.name, count: tag.task_count }))).toEqual([
      { name: "bug", count: 1 },
    ]);

    const tag = createTag({ name: "bug", color: "#ff0000", description: "Bug reports" });
    expect(tag.task_count).toBe(1);
    expect(getTag("bug")?.color).toBe("#ff0000");

    const renamed = updateTag("bug", { name: "defect" });
    expect(renamed.name).toBe("defect");
    expect(listTasks({ tags: ["bug"] })).toHaveLength(0);
    expect(listTasks({ tags: ["defect"] })[0]?.id).toBe(task.id);
    expect(getTask(task.id)?.tags).toEqual(["defect"]);

    expect(deleteTag("defect")).toBe(true);
    expect(listTags()).toEqual([]);
    expect(getTask(task.id)?.tags).toEqual([]);
  });
});
